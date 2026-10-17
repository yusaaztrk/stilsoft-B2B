using System.Text.Json;
using Npgsql;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class StoreDesignRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _connStr;

    public StoreDesignRepository(IConfiguration config)
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
CREATE TABLE IF NOT EXISTS store_design (
  id integer PRIMARY KEY,
  settings_json text NOT NULL,
  updated_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);

        // Check if row with id=1 exists
        await using var selectCmd = conn.CreateCommand();
        selectCmd.CommandText = "SELECT settings_json FROM store_design WHERE id=1";
        var existingJson = await selectCmd.ExecuteScalarAsync(cancellationToken) as string;

        if (string.IsNullOrWhiteSpace(existingJson))
        {
            await using var seed = conn.CreateCommand();
            seed.CommandText = @"
INSERT INTO store_design (id, settings_json, updated_at_utc)
VALUES (1, @json, (now() AT TIME ZONE 'utc'))
ON CONFLICT (id) DO NOTHING;";
            seed.Parameters.AddWithValue("json", JsonSerializer.Serialize(new StoreDesign(), JsonOptions));
            await seed.ExecuteNonQueryAsync(cancellationToken);
        }
        else
        {
            var design = JsonSerializer.Deserialize<StoreDesign>(existingJson, JsonOptions);
            if (design != null && (design.BrandName == "Stilsoft Kıbrıs" || design.BrandName == "B2B Store" || string.IsNullOrWhiteSpace(design.BrandName)))
            {
                design.BrandName = "Stilsoft KKTC";
                if (design.SeoTitle == "Stilsoft Kıbrıs | Mutfak ve Ev Aletleri" || design.SeoTitle == "B2B Store | Teknoloji Marketiniz" || string.IsNullOrWhiteSpace(design.SeoTitle))
                {
                    design.SeoTitle = "Stilsoft KKTC | Mutfak ve Ev Aletleri";
                }
                if (design.SeoDescription == "Kıbrıs'ta Stilsoft küçük ev aletleri, mutfak robotları, süpürgeler ve ev teknolojisi ürünleri." || string.IsNullOrWhiteSpace(design.SeoDescription))
                {
                    design.SeoDescription = "KKTC'de Stilsoft küçük ev aletleri, mutfak robotları, süpürgeler ve ev teknolojisi ürünleri.";
                }

                await using var updateCmd = conn.CreateCommand();
                updateCmd.CommandText = "UPDATE store_design SET settings_json=@json, updated_at_utc=(now() AT TIME ZONE 'utc') WHERE id=1";
                updateCmd.Parameters.AddWithValue("json", JsonSerializer.Serialize(design, JsonOptions));
                await updateCmd.ExecuteNonQueryAsync(cancellationToken);
            }
        }
    }

    public async Task<StoreDesign> GetAsync(CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT settings_json FROM store_design WHERE id=1";
        var json = await cmd.ExecuteScalarAsync(cancellationToken) as string;
        if (string.IsNullOrWhiteSpace(json)) return new StoreDesign();
        return JsonSerializer.Deserialize<StoreDesign>(json, JsonOptions) ?? new StoreDesign();
    }

    public async Task UpsertAsync(StoreDesign design, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO store_design (id, settings_json, updated_at_utc)
VALUES (1, @json, (now() AT TIME ZONE 'utc'))
ON CONFLICT (id) DO UPDATE SET settings_json=EXCLUDED.settings_json, updated_at_utc=EXCLUDED.updated_at_utc;";
        cmd.Parameters.AddWithValue("json", JsonSerializer.Serialize(design, JsonOptions));
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }
}
