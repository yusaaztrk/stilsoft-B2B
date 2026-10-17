using Npgsql;
using Shop.Api.Infrastructure;
using Shop.Api.Members;

namespace Shop.Api.Storefront;

public sealed class EcommerceCatalogDto
{
    public Guid Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string? CoverFileName { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; }
}

/// <summary>
/// Vitrin ana sayfasındaki "Kataloglarımız" bölümü. Kaydın kendisi (başlık, sıra, aktiflik)
/// burada; PDF'in ham baytları <see cref="StorefrontMediaStore"/> içinde — aynı deponun
/// tekrar kurulmasını önlemek için.
/// </summary>
public sealed class EcommerceCatalogStore
{
    private readonly TenantResolver _tenant;
    private readonly ShopSchema _schema;

    public EcommerceCatalogStore(TenantResolver tenant, ShopSchema schema)
    {
        _tenant = tenant;
        _schema = schema;
    }

    private async Task<NpgsqlConnection> OpenAsync(CancellationToken ct)
    {
        await _schema.EnsureAsync(ct);
        var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);
        return conn;
    }

    private static EcommerceCatalogDto Read(NpgsqlDataReader r) => new()
    {
        Id = r.GetGuid(0),
        Title = r.GetString(1),
        FileName = r.GetString(2),
        CoverFileName = r.IsDBNull(3) ? null : r.GetString(3),
        SortOrder = r.GetInt32(4),
        IsActive = r.GetBoolean(5)
    };

    private const string SelectColumns = "id, title, file_name, cover_file_name, sort_order, is_active";

    /// <summary>Yönetim listesi — pasif olanlar dahil.</summary>
    public async Task<IReadOnlyList<EcommerceCatalogDto>> ListAllAsync(CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(
            $"SELECT {SelectColumns} FROM public.ecommerce_catalogs ORDER BY sort_order, created_at DESC", conn);

        var list = new List<EcommerceCatalogDto>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) list.Add(Read(reader));
        return list;
    }

    /// <summary>Vitrinin okuduğu liste — yalnız aktif olanlar.</summary>
    public async Task<IReadOnlyList<EcommerceCatalogDto>> ListActiveAsync(CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(
            $"SELECT {SelectColumns} FROM public.ecommerce_catalogs WHERE is_active = true ORDER BY sort_order, created_at DESC", conn);

        var list = new List<EcommerceCatalogDto>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) list.Add(Read(reader));
        return list;
    }

    public async Task<EcommerceCatalogDto> CreateAsync(string title, string fileName, string? coverFileName, int sortOrder, bool isActive, string updatedBy, CancellationToken ct)
    {
        var id = Guid.NewGuid();
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO public.ecommerce_catalogs (id, title, file_name, cover_file_name, sort_order, is_active, created_at, updated_at, updated_by)
            VALUES (@id, @title, @file, @cover, @sort, @active, now(), now(), @by)
            """, conn);

        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("title", title);
        cmd.Parameters.AddWithValue("file", fileName);
        cmd.Parameters.AddWithValue("cover", (object?)coverFileName ?? DBNull.Value);
        cmd.Parameters.AddWithValue("sort", sortOrder);
        cmd.Parameters.AddWithValue("active", isActive);
        cmd.Parameters.AddWithValue("by", updatedBy);

        await cmd.ExecuteNonQueryAsync(ct);
        return new EcommerceCatalogDto { Id = id, Title = title, FileName = fileName, CoverFileName = coverFileName, SortOrder = sortOrder, IsActive = isActive };
    }

    public async Task<bool> UpdateAsync(Guid id, string title, string fileName, string? coverFileName, int sortOrder, bool isActive, string updatedBy, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            UPDATE public.ecommerce_catalogs
            SET title = @title, file_name = @file, cover_file_name = @cover, sort_order = @sort,
                is_active = @active, updated_at = now(), updated_by = @by
            WHERE id = @id
            """, conn);

        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("title", title);
        cmd.Parameters.AddWithValue("file", fileName);
        cmd.Parameters.AddWithValue("cover", (object?)coverFileName ?? DBNull.Value);
        cmd.Parameters.AddWithValue("sort", sortOrder);
        cmd.Parameters.AddWithValue("active", isActive);
        cmd.Parameters.AddWithValue("by", updatedBy);

        return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("DELETE FROM public.ecommerce_catalogs WHERE id = @id", conn);
        cmd.Parameters.AddWithValue("id", id);
        return await cmd.ExecuteNonQueryAsync(ct) > 0;
    }
}
