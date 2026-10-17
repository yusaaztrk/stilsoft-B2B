using Npgsql;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class ProductManualItemEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? ProductId { get; set; }
    public string? ProductName { get; set; }
    public string PdfUrl { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Language { get; set; } = "tr";
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class ProductManualRepository
{
    private readonly string _connStr;

    public ProductManualRepository(IConfiguration config)
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
CREATE TABLE IF NOT EXISTS product_manuals (
  id uuid PRIMARY KEY,
  product_id uuid NULL,
  product_name text NULL,
  pdf_url text NOT NULL,
  title text NOT NULL,
  language text NOT NULL DEFAULT 'tr',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS ix_product_manuals_product_id ON product_manuals (product_id);
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<List<ProductManualItemEntity>> ListAllAsync(CancellationToken cancellationToken)
    {
        var result = new List<ProductManualItemEntity>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, product_id, product_name, pdf_url, title, language, is_active, created_at FROM product_manuals ORDER BY created_at DESC";

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new ProductManualItemEntity
            {
                Id = reader.GetGuid(0),
                ProductId = reader.IsDBNull(1) ? null : reader.GetGuid(1),
                ProductName = reader.IsDBNull(2) ? null : reader.GetString(2),
                PdfUrl = reader.GetString(3),
                Title = reader.GetString(4),
                Language = reader.GetString(5),
                IsActive = reader.GetBoolean(6),
                CreatedAt = reader.GetFieldValue<DateTimeOffset>(7).UtcDateTime
            });
        }
        return result;
    }

    public async Task UpsertAsync(ProductManualItemEntity item, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO product_manuals (id, product_id, product_name, pdf_url, title, language, is_active, created_at)
VALUES (@id, @product_id, @product_name, @pdf_url, @title, @language, @is_active, @created_at)
ON CONFLICT (id) DO UPDATE SET
  product_id = EXCLUDED.product_id,
  product_name = EXCLUDED.product_name,
  pdf_url = EXCLUDED.pdf_url,
  title = EXCLUDED.title,
  language = EXCLUDED.language,
  is_active = EXCLUDED.is_active;
";
        cmd.Parameters.AddWithValue("id", item.Id == Guid.Empty ? Guid.NewGuid() : item.Id);
        cmd.Parameters.AddWithValue("product_id", (object?)item.ProductId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("product_name", (object?)item.ProductName ?? DBNull.Value);
        cmd.Parameters.AddWithValue("pdf_url", item.PdfUrl);
        cmd.Parameters.AddWithValue("title", item.Title);
        cmd.Parameters.AddWithValue("language", string.IsNullOrWhiteSpace(item.Language) ? "tr" : item.Language);
        cmd.Parameters.AddWithValue("is_active", item.IsActive);
        cmd.Parameters.AddWithValue("created_at", new DateTimeOffset(item.CreatedAt));

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM product_manuals WHERE id = @id";
        cmd.Parameters.AddWithValue("id", id);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }
}
