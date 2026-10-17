using Npgsql;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class BrandsRepository
{
    private readonly string _connStr;

    public BrandsRepository(IConfiguration config)
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
CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  logo_url text NULL,
  description text NULL,
  updated_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<List<Brand>> ListAsync(CancellationToken cancellationToken)
    {
        var result = new List<Brand>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, name, logo_url, description, updated_at_utc FROM brands ORDER BY name ASC";

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new Brand
            {
                Id = reader.GetGuid(0),
                Name = reader.GetString(1),
                LogoUrl = reader.IsDBNull(2) ? null : reader.GetString(2),
                Description = reader.IsDBNull(3) ? null : reader.GetString(3),
                UpdatedAtUtc = reader.GetFieldValue<DateTimeOffset>(4)
            });
        }

        return result;
    }

    public async Task<Brand?> GetAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, name, logo_url, description, updated_at_utc FROM brands WHERE id = @id LIMIT 1";
        cmd.Parameters.AddWithValue("id", id);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;

        return new Brand
        {
            Id = reader.GetGuid(0),
            Name = reader.GetString(1),
            LogoUrl = reader.IsDBNull(2) ? null : reader.GetString(2),
            Description = reader.IsDBNull(3) ? null : reader.GetString(3),
            UpdatedAtUtc = reader.GetFieldValue<DateTimeOffset>(4)
        };
    }

    public async Task UpsertAsync(Brand brand, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO brands (id, name, logo_url, description, updated_at_utc)
VALUES (@id, @name, @logo, @desc, (now() AT TIME ZONE 'utc'))
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  logo_url = EXCLUDED.logo_url,
  description = EXCLUDED.description,
  updated_at_utc = EXCLUDED.updated_at_utc;
";
        cmd.Parameters.AddWithValue("id", brand.Id);
        cmd.Parameters.AddWithValue("name", brand.Name.Trim());
        cmd.Parameters.AddWithValue("logo", (object?)brand.LogoUrl ?? DBNull.Value);
        cmd.Parameters.AddWithValue("desc", (object?)brand.Description ?? DBNull.Value);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM brands WHERE id = @id";
        cmd.Parameters.AddWithValue("id", id);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }
}
