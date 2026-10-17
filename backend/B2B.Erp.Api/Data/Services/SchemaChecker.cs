using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace B2B.Erp.Api.Data.Services;

/// <summary>
/// EF MODELİ ile GERÇEK ŞEMAYI karşılaştırır ve eksikleri yazar.
///
/// <para>
/// <b>Neden gerekli:</b> bu projede şema EF migration'larıyla taşınmıyor. Migration
/// dosyalarının çoğunda <c>[Migration]</c> özniteliği yok, dolayısıyla EF onları hiç
/// keşfetmiyor; kolonlar <c>Program.cs</c>'teki idempotent drift-fix blokları ile ekleniyor.
/// Bu düzenin iki sessiz açığı var:
/// </para>
/// <list type="number">
///   <item>
///     Drift blokları <c>MigrateAsync</c>'ten ÖNCE ve <c>IF EXISTS (tablo)</c> kapısıyla
///     çalışıyor — TAZE bir veritabanında tablolar henüz yokken hepsi atlanıyor.
///     (Bunun için <c>BackfillDriftColumnsAsync</c> eklendi.)
///   </item>
///   <item>
///     Bir varlığa yeni bir özellik eklenip ne migration ne de drift bloğu yazılırsa,
///     kolon HİÇBİR yerde oluşmuyor. Kod derleniyor, uygulama açılıyor, hata ancak o
///     varlık kaydedilmeye çalışıldığında <c>DbUpdateException</c> olarak çıkıyor.
///     (Canlı örnek: <c>Customers.CategoryAccessMode</c> — e-ticaret üyeliği bu yüzden
///     503 veriyordu ve sebebi hata kaydına bakmadan görünmüyordu.)
///   </item>
/// </list>
///
/// <para>
/// Bu sınıf ikinci açığı GÖRÜNÜR kılıyor: modeldeki her tablo ve kolon için veritabanında
/// karşılığı var mı diye bakar, eksikleri ve onları kapatacak <c>ALTER TABLE</c>
/// ifadelerini yazar. Hiçbir şeyi DEĞİŞTİRMEZ — salt okunur bir teşhis aracıdır; ne
/// uygulanacağına insan karar verir.
/// </para>
///
/// <para>Kullanım: <c>dotnet run -- schema-check</c></para>
/// </summary>
public static class SchemaChecker
{
    public sealed record MissingColumn(string Table, string Column, string ColumnType, bool IsNullable);

    public sealed record MissingTable(string Table, string CreateScript);

    public sealed record Report(
        string DatabaseName,
        IReadOnlyList<MissingTable> MissingTables,
        IReadOnlyList<MissingColumn> MissingColumns);

    /// <summary>
    /// Modeli veritabanıyla karşılaştırır.
    ///
    /// Görünümler ve anahtarsız türler atlanıyor: onların arkasında bir tablo yok, "eksik"
    /// saymak yanlış alarm üretirdi.
    /// </summary>
    public static async Task<Report> InspectAsync(DbContext context, CancellationToken ct = default)
    {
        var connectionString = context.Database.GetConnectionString() ?? string.Empty;
        var dbName = new NpgsqlConnectionStringBuilder(connectionString).Database ?? "?";

        var existing = await ReadSchemaAsync(connectionString, ct);

        var missingTables = new List<MissingTable>();
        var missingColumns = new List<MissingColumn>();

        foreach (var entity in context.Model.GetEntityTypes())
        {
            var table = entity.GetTableName();
            if (string.IsNullOrWhiteSpace(table)) continue;          // görünüm / sahipli tip
            if (entity.FindPrimaryKey() is null) continue;           // anahtarsız sorgu tipi

            if (!existing.TryGetValue(table, out var columns))
            {
                if (missingTables.All(x => x.Table != table))
                {
                    missingTables.Add(new MissingTable(table, BuildCreateTable(entity, table)));
                }
                continue;
            }

            var storeObject = Microsoft.EntityFrameworkCore.Metadata.StoreObjectIdentifier
                .Table(table, entity.GetSchema());

            foreach (var property in entity.GetProperties())
            {
                var column = property.GetColumnName(storeObject);
                if (string.IsNullOrWhiteSpace(column)) continue;
                if (columns.Contains(column)) continue;

                missingColumns.Add(new MissingColumn(
                    table,
                    column,
                    property.GetColumnType(storeObject) ?? "text",
                    property.IsColumnNullable(storeObject)));
            }
        }

        return new Report(
            dbName,
            missingTables.OrderBy(x => x.Table, StringComparer.Ordinal).ToList(),
            missingColumns
                .OrderBy(x => x.Table, StringComparer.Ordinal)
                .ThenBy(x => x.Column, StringComparer.Ordinal)
                .ToList());
    }

    /// <summary>
    /// Eksikleri kapatacak SQL. NOT NULL kolonlara varsayılan ŞART: dolu bir tabloya
    /// varsayılansız NOT NULL kolon eklemek hata verir. Varsayılan tipten türetiliyor —
    /// sayısal 0, mantıksal false, metinsel boş.
    /// </summary>
    public static string BuildFixScript(Report report)
    {
        if (report.MissingColumns.Count == 0 && report.MissingTables.Count == 0) return string.Empty;

        var lines = new List<string>();

        // ÖNCE TABLOLAR: eksik bir tabloya kolon eklenemez, sıra tersine dönerse ikinci
        // adım hiç çalışmaz.
        foreach (var t in report.MissingTables)
        {
            lines.Add(t.CreateScript);
        }

        if (report.MissingColumns.Count == 0)
        {
            return string.Join(Environment.NewLine, lines);
        }

        lines.Add("DO $$");
        lines.Add("BEGIN");

        foreach (var group in report.MissingColumns.GroupBy(x => x.Table))
        {
            lines.Add($"  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='{group.Key}') THEN");
            foreach (var c in group)
            {
                var nullability = c.IsNullable ? "NULL" : $"NOT NULL DEFAULT {DefaultFor(c.ColumnType)}";
                lines.Add($"    ALTER TABLE \"{group.Key}\" ADD COLUMN IF NOT EXISTS \"{c.Column}\" {c.ColumnType} {nullability};");
            }
            lines.Add("  END IF;");
        }

        lines.Add("END $$;");
        return string.Join(Environment.NewLine, lines);
    }

    /// <summary>
    /// Modelden <c>CREATE TABLE IF NOT EXISTS</c> üretir.
    ///
    /// Yabancı anahtar ve indeks BİLEREK yazılmıyor: sıralama bağımlılığı doğururlar ve
    /// eksik tablo genellikle tek başına duran, geç eklenmiş bir tablodur. Amaç şemayı
    /// baştan kurmak değil, EF'in sorgu üretebilmesi için tabloyu var etmek.
    /// </summary>
    private static string BuildCreateTable(
        Microsoft.EntityFrameworkCore.Metadata.IEntityType entity, string table)
    {
        var storeObject = Microsoft.EntityFrameworkCore.Metadata.StoreObjectIdentifier
            .Table(table, entity.GetSchema());

        var columns = new List<string>();
        foreach (var property in entity.GetProperties())
        {
            var name = property.GetColumnName(storeObject);
            if (string.IsNullOrWhiteSpace(name)) continue;

            var type = property.GetColumnType(storeObject) ?? "text";
            var nullable = property.IsColumnNullable(storeObject) ? "NULL" : "NOT NULL";

            // Kimlik kolonu: EF int PK'leri veritabanından bekliyor.
            var identity = property.ValueGenerated == Microsoft.EntityFrameworkCore.Metadata.ValueGenerated.OnAdd
                           && (type.Contains("int", StringComparison.OrdinalIgnoreCase))
                ? " GENERATED BY DEFAULT AS IDENTITY"
                : string.Empty;

            columns.Add($"  \"{name}\" {type}{identity} {nullable}");
        }

        var pk = entity.FindPrimaryKey();
        if (pk is not null)
        {
            var pkColumns = pk.Properties
                .Select(p => "\"" + p.GetColumnName(storeObject) + "\"")
                .ToList();
            columns.Add($"  PRIMARY KEY ({string.Join(", ", pkColumns)})");
        }

        var body = string.Join("," + Environment.NewLine, columns);
        return "CREATE TABLE IF NOT EXISTS \"" + table + "\" ("
               + Environment.NewLine + body + Environment.NewLine + ");";
    }

    private static string DefaultFor(string columnType)
    {
        var t = (columnType ?? string.Empty).ToLowerInvariant();
        if (t.Contains("bool")) return "FALSE";
        if (t.Contains("int") || t.Contains("numeric") || t.Contains("decimal")
            || t.Contains("real") || t.Contains("double") || t.Contains("money")) return "0";
        if (t.Contains("timestamp") || t.Contains("date")) return "now()";
        if (t.Contains("uuid")) return "'00000000-0000-0000-0000-000000000000'::uuid";
        if (t.Contains("json")) return "'{}'";
        return "''";
    }

    private static async Task<Dictionary<string, HashSet<string>>> ReadSchemaAsync(
        string connectionString, CancellationToken ct)
    {
        var map = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync(ct);

        await using var cmd = new NpgsqlCommand(
            "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
            conn);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var table = reader.GetString(0);
            var column = reader.GetString(1);
            if (!map.TryGetValue(table, out var set))
            {
                set = new HashSet<string>(StringComparer.Ordinal);
                map[table] = set;
            }
            set.Add(column);
        }

        return map;
    }
}
