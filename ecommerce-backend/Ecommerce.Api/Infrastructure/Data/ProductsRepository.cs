using Npgsql;
using System.Text.Json;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class ProductsRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _connStr;

    public ProductsRepository(IConfiguration config)
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
CREATE TABLE IF NOT EXISTS products (
  tenant_code text NOT NULL,
  erp_product_id uuid NOT NULL,
  stock_code text NULL,
  name text NULL,
  unit_price numeric(18,2) NULL,
  currency text NULL,
  stock integer NULL,
  is_active boolean NULL,
  image_url text NULL,
  image_urls_json text NULL,
  updated_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  PRIMARY KEY (tenant_code, erp_product_id)
);

CREATE INDEX IF NOT EXISTS ix_products_tenant_code ON products (tenant_code);
CREATE INDEX IF NOT EXISTS ix_products_tenant_code_name ON products (tenant_code, name);
CREATE INDEX IF NOT EXISTS ix_products_tenant_code_stock_code ON products (tenant_code, stock_code);
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_urls_json text NULL;
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task UpsertManyAsync(string tenantCode, IEnumerable<EcommerceProduct> products, CancellationToken cancellationToken)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenantCode))
            throw new InvalidOperationException("tenantCode is required");

        var list = products?.ToList() ?? new List<EcommerceProduct>();
        if (list.Count == 0) return;

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var tx = await conn.BeginTransactionAsync(cancellationToken);

        foreach (var p in list)
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = @"
INSERT INTO products (
  tenant_code,
  erp_product_id,
  stock_code,
  name,
  unit_price,
  currency,
  stock,
  is_active,
  image_url,
  image_urls_json,
  updated_at_utc
)
VALUES (
  @tenant,
  @erp_id,
  @stock_code,
  @name,
  @unit_price,
  @currency,
  @stock,
  @is_active,
  @image_url,
  @image_urls_json,
  (now() AT TIME ZONE 'utc')
)
ON CONFLICT (tenant_code, erp_product_id) DO UPDATE SET
  stock_code = EXCLUDED.stock_code,
  name = EXCLUDED.name,
  unit_price = EXCLUDED.unit_price,
  currency = EXCLUDED.currency,
  stock = EXCLUDED.stock,
  is_active = EXCLUDED.is_active,
  image_url = EXCLUDED.image_url,
  image_urls_json = EXCLUDED.image_urls_json,
  updated_at_utc = EXCLUDED.updated_at_utc;
";

            cmd.Parameters.AddWithValue("tenant", tenantCode);
            cmd.Parameters.AddWithValue("erp_id", p.ErpProductId);
            cmd.Parameters.AddWithValue("stock_code", (object?)NormalizeNullableText(p.StockCode) ?? DBNull.Value);
            cmd.Parameters.AddWithValue("name", (object?)NormalizeNullableText(p.Name) ?? DBNull.Value);
            cmd.Parameters.AddWithValue("unit_price", (object?)p.UnitPrice ?? DBNull.Value);
            cmd.Parameters.AddWithValue("currency", (object?)NormalizeNullableText(p.Currency) ?? DBNull.Value);
            cmd.Parameters.AddWithValue("stock", (object?)p.Stock ?? DBNull.Value);
            cmd.Parameters.AddWithValue("is_active", (object?)p.IsActive ?? DBNull.Value);
            cmd.Parameters.AddWithValue("image_url", (object?)NormalizeNullableText(p.ImageUrl) ?? DBNull.Value);
            cmd.Parameters.AddWithValue("image_urls_json", (object?)SerializeImageUrls(p.ImageUrls) ?? DBNull.Value);

            await cmd.ExecuteNonQueryAsync(cancellationToken);
        }

        await tx.CommitAsync(cancellationToken);
    }

    public async Task<List<EcommerceProduct>> ListAsync(string tenantCode, int take, CancellationToken cancellationToken)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenantCode))
            return new List<EcommerceProduct>();

        take = take < 1 ? 20 : take;
        take = take > 500 ? 500 : take;

        var result = new List<EcommerceProduct>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT tenant_code, erp_product_id, stock_code, name, unit_price, currency, stock, is_active, image_url, image_urls_json, updated_at_utc
FROM products
WHERE tenant_code = @tenant
ORDER BY updated_at_utc DESC
LIMIT @take;
";

        cmd.Parameters.AddWithValue("tenant", tenantCode);
        cmd.Parameters.AddWithValue("take", take);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new EcommerceProduct
            {
                TenantCode = reader.GetString(0),
                ErpProductId = reader.GetGuid(1),
                StockCode = reader.IsDBNull(2) ? null : reader.GetString(2),
                Name = reader.IsDBNull(3) ? null : reader.GetString(3),
                UnitPrice = reader.IsDBNull(4) ? null : reader.GetDecimal(4),
                Currency = reader.IsDBNull(5) ? null : reader.GetString(5),
                Stock = reader.IsDBNull(6) ? null : reader.GetInt32(6),
                IsActive = reader.IsDBNull(7) ? null : reader.GetBoolean(7),
                ImageUrl = reader.IsDBNull(8) ? null : reader.GetString(8),
                ImageUrls = reader.IsDBNull(9) ? null : DeserializeImageUrls(reader.GetString(9)),
                UpdatedAtUtc = reader.GetFieldValue<DateTimeOffset>(10)
            });
        }

        return result;
    }

    public async Task<EcommerceProduct?> GetAsync(string tenantCode, Guid erpProductId, CancellationToken cancellationToken)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenantCode)) return null;

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT tenant_code, erp_product_id, stock_code, name, unit_price, currency, stock, is_active, image_url, image_urls_json, updated_at_utc
FROM products
WHERE tenant_code=@tenant AND erp_product_id=@id
LIMIT 1;
";
        cmd.Parameters.AddWithValue("tenant", tenantCode);
        cmd.Parameters.AddWithValue("id", erpProductId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;

        return new EcommerceProduct
        {
            TenantCode = reader.GetString(0),
            ErpProductId = reader.GetGuid(1),
            StockCode = reader.IsDBNull(2) ? null : reader.GetString(2),
            Name = reader.IsDBNull(3) ? null : reader.GetString(3),
            UnitPrice = reader.IsDBNull(4) ? null : reader.GetDecimal(4),
            Currency = reader.IsDBNull(5) ? null : reader.GetString(5),
            Stock = reader.IsDBNull(6) ? null : reader.GetInt32(6),
            IsActive = reader.IsDBNull(7) ? null : reader.GetBoolean(7),
            ImageUrl = reader.IsDBNull(8) ? null : reader.GetString(8),
            ImageUrls = reader.IsDBNull(9) ? null : DeserializeImageUrls(reader.GetString(9)),
            UpdatedAtUtc = reader.GetFieldValue<DateTimeOffset>(10)
        };
    }

    public async Task SetImagesAsync(string tenantCode, Guid erpProductId, string? coverImageUrl, List<string>? imageUrls, CancellationToken cancellationToken)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenantCode))
            throw new InvalidOperationException("tenantCode is required");
        if (erpProductId == Guid.Empty)
            throw new InvalidOperationException("erpProductId is required");

        var cover = NormalizeNullableText(coverImageUrl);
        var urlsJson = SerializeImageUrls(imageUrls);

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
UPDATE products
SET image_url=@cover,
    image_urls_json=@urls,
    updated_at_utc=(now() AT TIME ZONE 'utc')
WHERE tenant_code=@tenant AND erp_product_id=@id;";
        cmd.Parameters.AddWithValue("tenant", tenantCode);
        cmd.Parameters.AddWithValue("id", erpProductId);
        cmd.Parameters.AddWithValue("cover", (object?)cover ?? DBNull.Value);
        cmd.Parameters.AddWithValue("urls", (object?)urlsJson ?? DBNull.Value);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    private static string? SerializeImageUrls(List<string>? urls)
    {
        if (urls is null || urls.Count == 0) return null;
        var cleaned = urls
            .Select(x => NormalizeNullableText(x))
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.Ordinal)
            .Take(20)
            .ToList();
        if (cleaned.Count == 0) return null;
        return JsonSerializer.Serialize(cleaned, JsonOptions);
    }

    private static List<string> DeserializeImageUrls(string? json)
    {
        var t = (json ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(t)) return new List<string>();
        try
        {
            var items = JsonSerializer.Deserialize<List<string>>(t, JsonOptions) ?? new List<string>();
            return items.Select(x => (x ?? string.Empty).Trim()).Where(x => x.Length > 0).ToList();
        }
        catch
        {
            return new List<string>();
        }
    }

    public async Task<EcommerceProduct?> GetAnyAsync(Guid erpProductId, CancellationToken cancellationToken)
    {
        if (erpProductId == Guid.Empty) return null;

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT tenant_code, erp_product_id, stock_code, name, unit_price, currency, stock, is_active, image_url, image_urls_json, updated_at_utc
FROM products
WHERE erp_product_id=@id
ORDER BY updated_at_utc DESC
LIMIT 1;
";
        cmd.Parameters.AddWithValue("id", erpProductId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;

        return new EcommerceProduct
        {
            TenantCode = reader.GetString(0),
            ErpProductId = reader.GetGuid(1),
            StockCode = reader.IsDBNull(2) ? null : reader.GetString(2),
            Name = reader.IsDBNull(3) ? null : reader.GetString(3),
            UnitPrice = reader.IsDBNull(4) ? null : reader.GetDecimal(4),
            Currency = reader.IsDBNull(5) ? null : reader.GetString(5),
            Stock = reader.IsDBNull(6) ? null : reader.GetInt32(6),
            IsActive = reader.IsDBNull(7) ? null : reader.GetBoolean(7),
            ImageUrl = reader.IsDBNull(8) ? null : reader.GetString(8),
            ImageUrls = reader.IsDBNull(9) ? null : DeserializeImageUrls(reader.GetString(9)),
            UpdatedAtUtc = reader.GetFieldValue<DateTimeOffset>(10)
        };
    }

    public async Task<List<EcommerceProduct>> ListAllAsync(int take, CancellationToken cancellationToken)
    {
        take = take < 1 ? 20 : take;
        take = take > 500 ? 500 : take;

        var result = new List<EcommerceProduct>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT tenant_code, erp_product_id, stock_code, name, unit_price, currency, stock, is_active, image_url, image_urls_json, updated_at_utc
FROM products
ORDER BY updated_at_utc DESC
LIMIT @take;
";
        cmd.Parameters.AddWithValue("take", take);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new EcommerceProduct
            {
                TenantCode = reader.GetString(0),
                ErpProductId = reader.GetGuid(1),
                StockCode = reader.IsDBNull(2) ? null : reader.GetString(2),
                Name = reader.IsDBNull(3) ? null : reader.GetString(3),
                UnitPrice = reader.IsDBNull(4) ? null : reader.GetDecimal(4),
                Currency = reader.IsDBNull(5) ? null : reader.GetString(5),
                Stock = reader.IsDBNull(6) ? null : reader.GetInt32(6),
                IsActive = reader.IsDBNull(7) ? null : reader.GetBoolean(7),
                ImageUrl = reader.IsDBNull(8) ? null : reader.GetString(8),
                ImageUrls = reader.IsDBNull(9) ? null : DeserializeImageUrls(reader.GetString(9)),
                UpdatedAtUtc = reader.GetFieldValue<DateTimeOffset>(10)
            });
        }

        return result;
    }

    public async Task UpdateStockAsync(string tenantCode, Guid erpProductId, int stock, CancellationToken cancellationToken)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
UPDATE products
SET stock=@stock,
    updated_at_utc=(now() AT TIME ZONE 'utc')
WHERE tenant_code=@tenant AND erp_product_id=@id;";
        cmd.Parameters.AddWithValue("tenant", tenantCode);
        cmd.Parameters.AddWithValue("id", erpProductId);
        cmd.Parameters.AddWithValue("stock", stock);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<List<EcommerceProduct>> GetManyByIdsAsync(string tenantCode, IEnumerable<Guid> ids, CancellationToken cancellationToken)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenantCode) || ids == null)
            return new List<EcommerceProduct>();

        var idList = ids.Distinct().ToList();
        if (idList.Count == 0)
            return new List<EcommerceProduct>();

        var result = new List<EcommerceProduct>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT tenant_code, erp_product_id, stock_code, name, unit_price, currency, stock, is_active, image_url, image_urls_json, updated_at_utc
FROM products
WHERE tenant_code = @tenant AND erp_product_id = ANY(@ids)
";
        cmd.Parameters.AddWithValue("tenant", tenantCode);
        cmd.Parameters.AddWithValue("ids", idList);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new EcommerceProduct
            {
                TenantCode = reader.GetString(0),
                ErpProductId = reader.GetGuid(1),
                StockCode = reader.IsDBNull(2) ? null : reader.GetString(2),
                Name = reader.IsDBNull(3) ? null : reader.GetString(3),
                UnitPrice = reader.IsDBNull(4) ? null : reader.GetDecimal(4),
                Currency = reader.IsDBNull(5) ? null : reader.GetString(5),
                Stock = reader.IsDBNull(6) ? null : reader.GetInt32(6),
                IsActive = reader.IsDBNull(7) ? null : reader.GetBoolean(7),
                ImageUrl = reader.IsDBNull(8) ? null : reader.GetString(8),
                ImageUrls = reader.IsDBNull(9) ? null : DeserializeImageUrls(reader.GetString(9)),
                UpdatedAtUtc = reader.GetFieldValue<DateTimeOffset>(10)
            });
        }

        return result;
    }

    private static string? NormalizeNullableText(string? value)
    {
        var v = (value ?? string.Empty).Trim();
        return string.IsNullOrWhiteSpace(v) ? null : v;
    }
}
