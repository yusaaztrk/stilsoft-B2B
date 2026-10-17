using Npgsql;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class FavoritesRepository
{
    private readonly string _connStr;

    public FavoritesRepository(IConfiguration config)
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
CREATE TABLE IF NOT EXISTS favorites (
  customer_id uuid NOT NULL,
  tenant_code text NOT NULL,
  erp_product_id uuid NOT NULL,
  created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  PRIMARY KEY (customer_id, tenant_code, erp_product_id)
);

CREATE INDEX IF NOT EXISTS ix_favorites_customer ON favorites (customer_id);
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<List<(string TenantCode, Guid ProductId)>> ListKeysAsync(Guid customerId, int take, CancellationToken cancellationToken)
    {
        if (customerId == Guid.Empty) return new List<(string, Guid)>();
        take = Math.Clamp(take, 10, 500);

        var result = new List<(string TenantCode, Guid ProductId)>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT tenant_code, erp_product_id
FROM favorites
WHERE customer_id=@cid
ORDER BY created_at_utc DESC
LIMIT @take;
";
        cmd.Parameters.AddWithValue("cid", customerId);
        cmd.Parameters.AddWithValue("take", take);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var tenant = reader.GetString(0);
            var pid = reader.GetGuid(1);
            result.Add((tenant, pid));
        }

        return result;
    }

    public async Task<bool> ToggleAsync(Guid customerId, string tenantCode, Guid productId, CancellationToken cancellationToken)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (customerId == Guid.Empty) throw new InvalidOperationException("customerId is required");
        if (string.IsNullOrWhiteSpace(tenantCode)) throw new InvalidOperationException("tenantCode is required");
        if (productId == Guid.Empty) throw new InvalidOperationException("productId is required");

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        // Try delete first.
        await using (var del = conn.CreateCommand())
        {
            del.CommandText = @"DELETE FROM favorites WHERE customer_id=@cid AND tenant_code=@tc AND erp_product_id=@pid";
            del.Parameters.AddWithValue("cid", customerId);
            del.Parameters.AddWithValue("tc", tenantCode);
            del.Parameters.AddWithValue("pid", productId);
            var affected = await del.ExecuteNonQueryAsync(cancellationToken);
            if (affected > 0) return false; // removed
        }

        await using (var ins = conn.CreateCommand())
        {
            ins.CommandText = @"
INSERT INTO favorites (customer_id, tenant_code, erp_product_id, created_at_utc)
VALUES (@cid, @tc, @pid, (now() AT TIME ZONE 'utc'))
ON CONFLICT DO NOTHING;
";
            ins.Parameters.AddWithValue("cid", customerId);
            ins.Parameters.AddWithValue("tc", tenantCode);
            ins.Parameters.AddWithValue("pid", productId);
            await ins.ExecuteNonQueryAsync(cancellationToken);
            return true; // added
        }
    }
}
