using Npgsql;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class ProductSettingsRepository
{
    private readonly string _connStr;

    public ProductSettingsRepository(IConfiguration config)
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
CREATE TABLE IF NOT EXISTS product_settings (
  tenant_code text NOT NULL,
  product_id uuid NOT NULL,
  is_featured boolean NOT NULL DEFAULT FALSE,
  override_price numeric(18,2) NULL,
  override_currency text NULL,
  updated_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

ALTER TABLE product_settings ADD COLUMN IF NOT EXISTS tenant_code text;

UPDATE product_settings
SET tenant_code = 'DEMO'
WHERE tenant_code IS NULL OR tenant_code = '';

ALTER TABLE product_settings ALTER COLUMN tenant_code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name='product_settings'
      AND constraint_type='PRIMARY KEY'
      AND constraint_name='pk_product_settings'
  ) THEN
    ALTER TABLE product_settings DROP CONSTRAINT IF EXISTS product_settings_pkey;
    ALTER TABLE product_settings ADD CONSTRAINT pk_product_settings PRIMARY KEY (tenant_code, product_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_product_settings_is_featured ON product_settings (is_featured);
CREATE INDEX IF NOT EXISTS ix_product_settings_tenant_code ON product_settings (tenant_code);
CREATE INDEX IF NOT EXISTS ix_product_settings_tenant_code_is_featured ON product_settings (tenant_code, is_featured);
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<Dictionary<Guid, ProductSetting>> GetAllByProductIdAsync(string tenantCode, CancellationToken cancellationToken)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenantCode))
            return new Dictionary<Guid, ProductSetting>();

        var result = new Dictionary<Guid, ProductSetting>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT tenant_code, product_id, is_featured, override_price, override_currency, updated_at_utc FROM product_settings WHERE tenant_code=@tenant";
        cmd.Parameters.AddWithValue("tenant", tenantCode);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var s = new ProductSetting
            {
                TenantCode = reader.GetString(0),
                ProductId = reader.GetGuid(1),
                IsFeatured = reader.GetBoolean(2),
                OverridePrice = reader.IsDBNull(3) ? null : reader.GetDecimal(3),
                OverrideCurrency = reader.IsDBNull(4) ? null : reader.GetString(4),
                UpdatedAtUtc = reader.GetFieldValue<DateTimeOffset>(5)
            };
            result[s.ProductId] = s;
        }

        return result;
    }

    public async Task<List<ProductSetting>> ListAllAsync(int take, CancellationToken cancellationToken)
    {
        take = take < 1 ? 200 : take;
        take = take > 5000 ? 5000 : take;

        var result = new List<ProductSetting>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT tenant_code, product_id, is_featured, override_price, override_currency, updated_at_utc FROM product_settings ORDER BY updated_at_utc DESC LIMIT @take";
        cmd.Parameters.AddWithValue("take", take);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new ProductSetting
            {
                TenantCode = reader.GetString(0),
                ProductId = reader.GetGuid(1),
                IsFeatured = reader.GetBoolean(2),
                OverridePrice = reader.IsDBNull(3) ? null : reader.GetDecimal(3),
                OverrideCurrency = reader.IsDBNull(4) ? null : reader.GetString(4),
                UpdatedAtUtc = reader.GetFieldValue<DateTimeOffset>(5)
            });
        }

        return result;
    }

    public async Task<ProductSetting?> GetAsync(string tenantCode, Guid productId, CancellationToken cancellationToken)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenantCode)) return null;

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT tenant_code, product_id, is_featured, override_price, override_currency, updated_at_utc FROM product_settings WHERE tenant_code=@tenant AND product_id=@id";
        cmd.Parameters.AddWithValue("tenant", tenantCode);
        cmd.Parameters.AddWithValue("id", productId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;

        return new ProductSetting
        {
            TenantCode = reader.GetString(0),
            ProductId = reader.GetGuid(1),
            IsFeatured = reader.GetBoolean(2),
            OverridePrice = reader.IsDBNull(3) ? null : reader.GetDecimal(3),
            OverrideCurrency = reader.IsDBNull(4) ? null : reader.GetString(4),
            UpdatedAtUtc = reader.GetFieldValue<DateTimeOffset>(5)
        };
    }

    public async Task UpsertAsync(ProductSetting setting, CancellationToken cancellationToken)
    {
        setting.TenantCode = (setting.TenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(setting.TenantCode))
            throw new InvalidOperationException("TenantCode is required");

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO product_settings (tenant_code, product_id, is_featured, override_price, override_currency, updated_at_utc)
VALUES (@tenant, @id, @featured, @price, @cur, (now() AT TIME ZONE 'utc'))
ON CONFLICT (tenant_code, product_id) DO UPDATE SET
  is_featured = EXCLUDED.is_featured,
  override_price = EXCLUDED.override_price,
  override_currency = EXCLUDED.override_currency,
  updated_at_utc = EXCLUDED.updated_at_utc;
";

        cmd.Parameters.AddWithValue("tenant", setting.TenantCode);
        cmd.Parameters.AddWithValue("id", setting.ProductId);
        cmd.Parameters.AddWithValue("featured", setting.IsFeatured);
        cmd.Parameters.AddWithValue("price", (object?)setting.OverridePrice ?? DBNull.Value);
        cmd.Parameters.AddWithValue("cur", (object?)setting.OverrideCurrency ?? DBNull.Value);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<HashSet<Guid>> GetFeaturedIdsAsync(string tenantCode, CancellationToken cancellationToken)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenantCode))
            return new HashSet<Guid>();

        var result = new HashSet<Guid>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"SELECT product_id FROM product_settings WHERE tenant_code=@tenant AND is_featured = TRUE";
        cmd.Parameters.AddWithValue("tenant", tenantCode);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(reader.GetGuid(0));
        }

        return result;
    }
}
