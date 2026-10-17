using Npgsql;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class PdfCatalogItemEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string? CoverImageUrl { get; set; }
    public string PdfUrl { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class PdfCatalogRepository
{
    private readonly string _connStr;

    public PdfCatalogRepository(IConfiguration config)
    {
        _connStr = config.GetConnectionString("EcommerceDb") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(_connStr))
            throw new InvalidOperationException("ConnectionStrings:EcommerceDb must be configured.");
    }

    public async Task EnsureCreatedAsync(CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
CREATE TABLE IF NOT EXISTS pdf_catalogs (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  cover_image_url text NULL,
  pdf_url text NOT NULL,
  description text NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_pdf_catalogs_sort ON pdf_catalogs (sort_order);
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<List<PdfCatalogItemEntity>> ListAllAsync(CancellationToken cancellationToken)
    {
        var result = new List<PdfCatalogItemEntity>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, name, cover_image_url, pdf_url, description, sort_order, is_active, created_at FROM pdf_catalogs ORDER BY sort_order ASC, name ASC";

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new PdfCatalogItemEntity
            {
                Id = reader.GetGuid(0),
                Name = reader.GetString(1),
                CoverImageUrl = reader.IsDBNull(2) ? null : reader.GetString(2),
                PdfUrl = reader.GetString(3),
                Description = reader.IsDBNull(4) ? null : reader.GetString(4),
                SortOrder = reader.GetInt32(5),
                IsActive = reader.GetBoolean(6),
                CreatedAt = reader.GetFieldValue<DateTimeOffset>(7).UtcDateTime
            });
        }
        return result;
    }

    public async Task UpsertAsync(PdfCatalogItemEntity item, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO pdf_catalogs (id, name, cover_image_url, pdf_url, description, sort_order, is_active, created_at)
VALUES (@id, @name, @cover_image_url, @pdf_url, @description, @sort_order, @is_active, @created_at)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  cover_image_url = EXCLUDED.cover_image_url,
  pdf_url = EXCLUDED.pdf_url,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;
";
        cmd.Parameters.AddWithValue("id", item.Id == Guid.Empty ? Guid.NewGuid() : item.Id);
        cmd.Parameters.AddWithValue("name", item.Name);
        cmd.Parameters.AddWithValue("cover_image_url", (object?)item.CoverImageUrl ?? DBNull.Value);
        cmd.Parameters.AddWithValue("pdf_url", item.PdfUrl);
        cmd.Parameters.AddWithValue("description", (object?)item.Description ?? DBNull.Value);
        cmd.Parameters.AddWithValue("sort_order", item.SortOrder);
        cmd.Parameters.AddWithValue("is_active", item.IsActive);
        cmd.Parameters.AddWithValue("created_at", new DateTimeOffset(item.CreatedAt));

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM pdf_catalogs WHERE id = @id";
        cmd.Parameters.AddWithValue("id", id);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }
}
