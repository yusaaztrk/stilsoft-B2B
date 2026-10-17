using Npgsql;
using Shop.Api.Infrastructure;
using Shop.Api.Members;

namespace Shop.Api.Storefront;

/// <summary>
/// Bayiden yüklenen vitrin görselleri (banner, kampanya görseli).
///
/// Dosya sisteminde değil veritabanında tutuluyor: mağaza ileride ikinci bir sunucuya
/// taşınırsa ya da yedekten dönülürse görsellerin yanında gelmesi gerekiyor. Ürün fotoğrafları
/// bunun dışında — onlar ERP'nin verisi ve orada kalıyor.
///
/// Kabul edilen tipler beyaz listeyle sınırlı ve dosya adı bizim ürettiğimiz bir değer:
/// yüklenen adın kendisi asla yola konmuyor.
/// </summary>
public sealed class StorefrontMediaStore
{
    private readonly TenantResolver _tenant;
    private readonly ShopSchema _schema;

    public const long MaxBytes = 4 * 1024 * 1024;

    /// <summary>Katalog PDF'leri için ayrı, daha yüksek sınır — aynı depoyu (storefront_media) kullanır.</summary>
    public const long MaxPdfBytes = 30 * 1024 * 1024;

    private static readonly Dictionary<string, string> Allowed = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/webp"] = ".webp",
        ["image/jpeg"] = ".jpg",
        ["image/png"] = ".png",
        ["application/pdf"] = ".pdf",
    };

    public StorefrontMediaStore(TenantResolver tenant, ShopSchema schema)
    {
        _tenant = tenant;
        _schema = schema;
    }

    public static bool IsAllowed(string? contentType) =>
        !string.IsNullOrWhiteSpace(contentType) && Allowed.ContainsKey(contentType);

    private async Task<NpgsqlConnection> OpenAsync(CancellationToken ct)
    {
        await _schema.EnsureAsync(ct);
        var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);
        return conn;
    }

    public async Task<string> SaveAsync(byte[] bytes, string contentType, string uploadedBy, CancellationToken ct)
    {
        var extension = Allowed[contentType];
        var fileName = $"{Guid.NewGuid():n}{extension}";

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO public.storefront_media (file_name, content_type, bytes, uploaded_at, uploaded_by)
            VALUES (@f, @c, @b, now(), @u)
            """, conn);

        cmd.Parameters.AddWithValue("f", fileName);
        cmd.Parameters.AddWithValue("c", contentType);
        cmd.Parameters.AddWithValue("b", bytes);
        cmd.Parameters.AddWithValue("u", uploadedBy);

        await cmd.ExecuteNonQueryAsync(ct);
        return fileName;
    }

    public async Task<(byte[] Bytes, string ContentType)?> GetAsync(string fileName, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT bytes, content_type FROM public.storefront_media WHERE file_name = @f", conn);
        cmd.Parameters.AddWithValue("f", fileName);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return ((byte[])reader[0], reader.GetString(1));
    }

    public async Task<IReadOnlyList<string>> ListAsync(CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT file_name FROM public.storefront_media ORDER BY uploaded_at DESC LIMIT 100", conn);

        var list = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) list.Add(reader.GetString(0));
        return list;
    }
}
