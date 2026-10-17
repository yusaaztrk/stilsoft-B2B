using Npgsql;
using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class CampaignsRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _connStr;

    public CampaignsRepository(IConfiguration config)
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
CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  description text NULL,
  type text NOT NULL, -- 'Percentage', 'FixedAmount', 'FreeShipping', 'GiftProduct'
  scope text NOT NULL DEFAULT 'Product', -- 'Product', 'Cart'
  is_active boolean NOT NULL DEFAULT true,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  image_url text NULL,
  min_order_amount numeric(18,2) NOT NULL DEFAULT 0,
  max_discount_amount numeric(18,2) NULL,
  discount_value numeric(18,2) NOT NULL DEFAULT 0,
  gift_product_id uuid NULL,
  brand_rules_json text NULL,
  created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE TABLE IF NOT EXISTS campaign_products (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  PRIMARY KEY (campaign_id, product_id)
);

CREATE TABLE IF NOT EXISTS campaign_categories (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  PRIMARY KEY (campaign_id, category_id)
);

CREATE TABLE IF NOT EXISTS campaign_brands (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  brand_name text NOT NULL,
  PRIMARY KEY (campaign_id, brand_name)
);

CREATE TABLE IF NOT EXISTS campaign_usages (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  user_id uuid NULL,
  discount_amount numeric(18,2) NOT NULL DEFAULT 0,
  created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);

CREATE INDEX IF NOT EXISTS ix_campaigns_dates ON campaigns (start_date, end_date, is_active);
CREATE INDEX IF NOT EXISTS ix_campaign_usages_campaign ON campaign_usages (campaign_id);

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS brand_rules_json text NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'Product';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS buy_x_get_y_type text NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS buy_quantity integer NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS gift_quantity integer NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS buy_x_get_y_scale boolean NULL;
"	;
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<List<Campaign>> ListAllAsync(CancellationToken cancellationToken)
    {
        var campaigns = new List<Campaign>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        // 1. Get all campaigns
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT id, name, description, type, is_active, start_date, end_date, 
                       priority, image_url, min_order_amount, max_discount_amount, 
                       discount_value, gift_product_id, created_at_utc, brand_rules_json, scope,
                       buy_x_get_y_type, buy_quantity, gift_quantity, buy_x_get_y_scale
                FROM campaigns 
                ORDER BY priority DESC, created_at_utc DESC";

            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                campaigns.Add(new Campaign
                {
                    Id = reader.GetGuid(0),
                    Name = reader.GetString(1),
                    Description = reader.IsDBNull(2) ? null : reader.GetString(2),
                    Type = reader.GetString(3),
                    IsActive = reader.GetBoolean(4),
                    StartDate = reader.GetDateTime(5),
                    EndDate = reader.GetDateTime(6),
                    Priority = reader.GetInt32(7),
                    ImageUrl = reader.IsDBNull(8) ? null : reader.GetString(8),
                    MinOrderAmount = reader.GetDecimal(9),
                    MaxDiscountAmount = reader.IsDBNull(10) ? null : reader.GetDecimal(10),
                    DiscountValue = reader.GetDecimal(11),
                    GiftProductId = reader.IsDBNull(12) ? null : reader.GetGuid(12),
                    CreatedAtUtc = reader.GetDateTime(13),
                    BrandRules = reader.IsDBNull(14)
                        ? new List<BrandDiscountRule>()
                        : JsonSerializer.Deserialize<List<BrandDiscountRule>>(reader.GetString(14), JsonOptions) ?? new List<BrandDiscountRule>(),
                    Scope = reader.GetString(15),
                    BuyXGetYType = reader.IsDBNull(16) ? null : reader.GetString(16),
                    BuyQuantity = reader.IsDBNull(17) ? null : reader.GetInt32(17),
                    GiftQuantity = reader.IsDBNull(18) ? null : reader.GetInt32(18),
                    BuyXGetYScale = reader.IsDBNull(19) ? null : reader.GetBoolean(19)
                });
            }
        }

        if (campaigns.Count == 0) return campaigns;

        // 2. Load all relation mappings in bulk to avoid N+1 query issue
        var productMaps = new Dictionary<Guid, List<Guid>>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT campaign_id, product_id FROM campaign_products";
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var cid = reader.GetGuid(0);
                var pid = reader.GetGuid(1);
                if (!productMaps.TryGetValue(cid, out var list))
                {
                    list = new List<Guid>();
                    productMaps[cid] = list;
                }
                list.Add(pid);
            }
        }

        var catMaps = new Dictionary<Guid, List<Guid>>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT campaign_id, category_id FROM campaign_categories";
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var cid = reader.GetGuid(0);
                var catId = reader.GetGuid(1);
                if (!catMaps.TryGetValue(cid, out var list))
                {
                    list = new List<Guid>();
                    catMaps[cid] = list;
                }
                list.Add(catId);
            }
        }

        var brandMaps = new Dictionary<Guid, List<string>>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT campaign_id, brand_name FROM campaign_brands";
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var cid = reader.GetGuid(0);
                var brandName = reader.GetString(1);
                if (!brandMaps.TryGetValue(cid, out var list))
                {
                    list = new List<string>();
                    brandMaps[cid] = list;
                }
                list.Add(brandName);
            }
        }

        // 3. Map relations back to the object
        foreach (var c in campaigns)
        {
            if (productMaps.TryGetValue(c.Id, out var pids)) c.TargetProductIds = pids;
            if (catMaps.TryGetValue(c.Id, out var catIds)) c.TargetCategoryIds = catIds;
            if (brandMaps.TryGetValue(c.Id, out var brands)) c.TargetBrandNames = brands;
        }

        return campaigns;
    }

    public async Task<List<Campaign>> GetActiveCampaignsAsync(CancellationToken cancellationToken)
    {
        var campaigns = new List<Campaign>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        // Get campaigns that are active and current date falls within range
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT id, name, description, type, is_active, start_date, end_date, 
                       priority, image_url, min_order_amount, max_discount_amount, 
                       discount_value, gift_product_id, created_at_utc, brand_rules_json, scope,
                       buy_x_get_y_type, buy_quantity, gift_quantity, buy_x_get_y_scale
                FROM campaigns 
                WHERE is_active = true AND start_date <= @now AND end_date >= @now
                ORDER BY priority DESC, created_at_utc DESC";
            
            cmd.Parameters.AddWithValue("now", DateTime.UtcNow);

            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                campaigns.Add(new Campaign
                {
                    Id = reader.GetGuid(0),
                    Name = reader.GetString(1),
                    Description = reader.IsDBNull(2) ? null : reader.GetString(2),
                    Type = reader.GetString(3),
                    IsActive = reader.GetBoolean(4),
                    StartDate = reader.GetDateTime(5),
                    EndDate = reader.GetDateTime(6),
                    Priority = reader.GetInt32(7),
                    ImageUrl = reader.IsDBNull(8) ? null : reader.GetString(8),
                    MinOrderAmount = reader.GetDecimal(9),
                    MaxDiscountAmount = reader.IsDBNull(10) ? null : reader.GetDecimal(10),
                    DiscountValue = reader.GetDecimal(11),
                    GiftProductId = reader.IsDBNull(12) ? null : reader.GetGuid(12),
                    CreatedAtUtc = reader.GetDateTime(13),
                    BrandRules = reader.IsDBNull(14)
                        ? new List<BrandDiscountRule>()
                        : JsonSerializer.Deserialize<List<BrandDiscountRule>>(reader.GetString(14), JsonOptions) ?? new List<BrandDiscountRule>(),
                    Scope = reader.GetString(15),
                    BuyXGetYType = reader.IsDBNull(16) ? null : reader.GetString(16),
                    BuyQuantity = reader.IsDBNull(17) ? null : reader.GetInt32(17),
                    GiftQuantity = reader.IsDBNull(18) ? null : reader.GetInt32(18),
                    BuyXGetYScale = reader.IsDBNull(19) ? null : reader.GetBoolean(19)
                });
            }
        }

        if (campaigns.Count == 0) return campaigns;

        // Load mappings for active campaigns only
        var activeIds = campaigns.Select(x => x.Id).ToList();

        var productMaps = new Dictionary<Guid, List<Guid>>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT campaign_id, product_id FROM campaign_products WHERE campaign_id = ANY(@ids)";
            cmd.Parameters.AddWithValue("ids", activeIds);
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var cid = reader.GetGuid(0);
                var pid = reader.GetGuid(1);
                if (!productMaps.TryGetValue(cid, out var list))
                {
                    list = new List<Guid>();
                    productMaps[cid] = list;
                }
                list.Add(pid);
            }
        }

        var catMaps = new Dictionary<Guid, List<Guid>>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT campaign_id, category_id FROM campaign_categories WHERE campaign_id = ANY(@ids)";
            cmd.Parameters.AddWithValue("ids", activeIds);
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var cid = reader.GetGuid(0);
                var catId = reader.GetGuid(1);
                if (!catMaps.TryGetValue(cid, out var list))
                {
                    list = new List<Guid>();
                    catMaps[cid] = list;
                }
                list.Add(catId);
            }
        }

        var brandMaps = new Dictionary<Guid, List<string>>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT campaign_id, brand_name FROM campaign_brands WHERE campaign_id = ANY(@ids)";
            cmd.Parameters.AddWithValue("ids", activeIds);
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var cid = reader.GetGuid(0);
                var brandName = reader.GetString(1);
                if (!brandMaps.TryGetValue(cid, out var list))
                {
                    list = new List<string>();
                    brandMaps[cid] = list;
                }
                list.Add(brandName);
            }
        }

        foreach (var c in campaigns)
        {
            if (productMaps.TryGetValue(c.Id, out var pids)) c.TargetProductIds = pids;
            if (catMaps.TryGetValue(c.Id, out var catIds)) c.TargetCategoryIds = catIds;
            if (brandMaps.TryGetValue(c.Id, out var brands)) c.TargetBrandNames = brands;
        }

        return campaigns;
    }

    public async Task<Campaign?> GetAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        Campaign? c = null;

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
                SELECT id, name, description, type, is_active, start_date, end_date, 
                       priority, image_url, min_order_amount, max_discount_amount, 
                       discount_value, gift_product_id, created_at_utc, brand_rules_json, scope,
                       buy_x_get_y_type, buy_quantity, gift_quantity, buy_x_get_y_scale
                FROM campaigns 
                WHERE id = @id LIMIT 1";
            cmd.Parameters.AddWithValue("id", id);

            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                c = new Campaign
                {
                    Id = reader.GetGuid(0),
                    Name = reader.GetString(1),
                    Description = reader.IsDBNull(2) ? null : reader.GetString(2),
                    Type = reader.GetString(3),
                    IsActive = reader.GetBoolean(4),
                    StartDate = reader.GetDateTime(5),
                    EndDate = reader.GetDateTime(6),
                    Priority = reader.GetInt32(7),
                    ImageUrl = reader.IsDBNull(8) ? null : reader.GetString(8),
                    MinOrderAmount = reader.GetDecimal(9),
                    MaxDiscountAmount = reader.IsDBNull(10) ? null : reader.GetDecimal(10),
                    DiscountValue = reader.GetDecimal(11),
                    GiftProductId = reader.IsDBNull(12) ? null : reader.GetGuid(12),
                    CreatedAtUtc = reader.GetDateTime(13),
                    BrandRules = reader.IsDBNull(14)
                        ? new List<BrandDiscountRule>()
                        : JsonSerializer.Deserialize<List<BrandDiscountRule>>(reader.GetString(14), JsonOptions) ?? new List<BrandDiscountRule>(),
                    Scope = reader.GetString(15),
                    BuyXGetYType = reader.IsDBNull(16) ? null : reader.GetString(16),
                    BuyQuantity = reader.IsDBNull(17) ? null : reader.GetInt32(17),
                    GiftQuantity = reader.IsDBNull(18) ? null : reader.GetInt32(18),
                    BuyXGetYScale = reader.IsDBNull(19) ? null : reader.GetBoolean(19)
                };
            }
        }

        if (c == null) return null;

        // Load targets
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT product_id FROM campaign_products WHERE campaign_id = @id";
            cmd.Parameters.AddWithValue("id", id);
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                c.TargetProductIds.Add(reader.GetGuid(0));
            }
        }

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT category_id FROM campaign_categories WHERE campaign_id = @id";
            cmd.Parameters.AddWithValue("id", id);
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                c.TargetCategoryIds.Add(reader.GetGuid(0));
            }
        }

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT brand_name FROM campaign_brands WHERE campaign_id = @id";
            cmd.Parameters.AddWithValue("id", id);
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                c.TargetBrandNames.Add(reader.GetString(0));
            }
        }

        return c;
    }

    public async Task SaveAsync(Campaign c, CancellationToken cancellationToken)
    {
        if (c.Type == "Brand" && c.BrandRules != null)
        {
            c.TargetBrandNames = c.BrandRules.Select(r => r.BrandName).ToList();
        }

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var tx = await conn.BeginTransactionAsync(cancellationToken);

        try
        {
            // 1. Upsert campaigns main record
            await using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = @"
                    INSERT INTO campaigns (id, name, description, type, is_active, start_date, 
                                           end_date, priority, image_url, min_order_amount, 
                                           max_discount_amount, discount_value, gift_product_id, brand_rules_json, scope, created_at_utc,
                                           buy_x_get_y_type, buy_quantity, gift_quantity, buy_x_get_y_scale)
                    VALUES (@id, @name, @desc, @type, @is_active, @start, @end, @priority, 
                            @image_url, @min, @max, @val, @gift, @brand_rules_json, @scope, (now() AT TIME ZONE 'utc'),
                            @buy_x_get_y_type, @buy_quantity, @gift_quantity, @buy_x_get_y_scale)
                    ON CONFLICT (id) DO UPDATE SET
                      name = EXCLUDED.name,
                      description = EXCLUDED.description,
                      type = EXCLUDED.type,
                      scope = EXCLUDED.scope,
                      is_active = EXCLUDED.is_active,
                      start_date = EXCLUDED.start_date,
                      end_date = EXCLUDED.end_date,
                      priority = EXCLUDED.priority,
                      image_url = EXCLUDED.image_url,
                      min_order_amount = EXCLUDED.min_order_amount,
                      max_discount_amount = EXCLUDED.max_discount_amount,
                      discount_value = EXCLUDED.discount_value,
                      gift_product_id = EXCLUDED.gift_product_id,
                      brand_rules_json = EXCLUDED.brand_rules_json,
                      buy_x_get_y_type = EXCLUDED.buy_x_get_y_type,
                      buy_quantity = EXCLUDED.buy_quantity,
                      gift_quantity = EXCLUDED.gift_quantity,
                      buy_x_get_y_scale = EXCLUDED.buy_x_get_y_scale;";

                cmd.Parameters.AddWithValue("id", c.Id);
                cmd.Parameters.AddWithValue("name", c.Name.Trim());
                cmd.Parameters.AddWithValue("desc", (object?)c.Description ?? DBNull.Value);
                cmd.Parameters.AddWithValue("type", c.Type);
                cmd.Parameters.AddWithValue("is_active", c.IsActive);
                cmd.Parameters.AddWithValue("start", c.StartDate);
                cmd.Parameters.AddWithValue("end", c.EndDate);
                cmd.Parameters.AddWithValue("priority", c.Priority);
                cmd.Parameters.AddWithValue("image_url", (object?)c.ImageUrl ?? DBNull.Value);
                cmd.Parameters.AddWithValue("min", c.MinOrderAmount);
                cmd.Parameters.AddWithValue("max", (object?)c.MaxDiscountAmount ?? DBNull.Value);
                cmd.Parameters.AddWithValue("val", c.DiscountValue);
                cmd.Parameters.AddWithValue("gift", (object?)c.GiftProductId ?? DBNull.Value);
                cmd.Parameters.AddWithValue("brand_rules_json", JsonSerializer.Serialize(c.BrandRules ?? new List<BrandDiscountRule>(), JsonOptions));
                cmd.Parameters.AddWithValue("scope", c.Scope);
                cmd.Parameters.AddWithValue("buy_x_get_y_type", (object?)c.BuyXGetYType ?? DBNull.Value);
                cmd.Parameters.AddWithValue("buy_quantity", (object?)c.BuyQuantity ?? DBNull.Value);
                cmd.Parameters.AddWithValue("gift_quantity", (object?)c.GiftQuantity ?? DBNull.Value);
                cmd.Parameters.AddWithValue("buy_x_get_y_scale", (object?)c.BuyXGetYScale ?? DBNull.Value);

                await cmd.ExecuteNonQueryAsync(cancellationToken);
            }

            // 2. Clear existing relation maps
            await using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = "DELETE FROM campaign_products WHERE campaign_id = @id";
                cmd.Parameters.AddWithValue("id", c.Id);
                await cmd.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = "DELETE FROM campaign_categories WHERE campaign_id = @id";
                cmd.Parameters.AddWithValue("id", c.Id);
                await cmd.ExecuteNonQueryAsync(cancellationToken);
            }

            await using (var cmd = conn.CreateCommand())
            {
                cmd.Transaction = tx;
                cmd.CommandText = "DELETE FROM campaign_brands WHERE campaign_id = @id";
                cmd.Parameters.AddWithValue("id", c.Id);
                await cmd.ExecuteNonQueryAsync(cancellationToken);
            }

            // 3. Write new relation maps
            if (c.TargetProductIds?.Count > 0)
            {
                foreach (var pid in c.TargetProductIds.Distinct())
                {
                    await using var cmd = conn.CreateCommand();
                    cmd.Transaction = tx;
                    cmd.CommandText = "INSERT INTO campaign_products (campaign_id, product_id) VALUES (@cid, @pid)";
                    cmd.Parameters.AddWithValue("cid", c.Id);
                    cmd.Parameters.AddWithValue("pid", pid);
                    await cmd.ExecuteNonQueryAsync(cancellationToken);
                }
            }

            if (c.TargetCategoryIds?.Count > 0)
            {
                foreach (var catId in c.TargetCategoryIds.Distinct())
                {
                    await using var cmd = conn.CreateCommand();
                    cmd.Transaction = tx;
                    cmd.CommandText = "INSERT INTO campaign_categories (campaign_id, category_id) VALUES (@cid, @catId)";
                    cmd.Parameters.AddWithValue("cid", c.Id);
                    cmd.Parameters.AddWithValue("catId", catId);
                    await cmd.ExecuteNonQueryAsync(cancellationToken);
                }
            }

            if (c.TargetBrandNames?.Count > 0)
            {
                foreach (var brandName in c.TargetBrandNames.Select(x => x.Trim()).Where(x => !string.IsNullOrEmpty(x)).Distinct())
                {
                    await using var cmd = conn.CreateCommand();
                    cmd.Transaction = tx;
                    cmd.CommandText = "INSERT INTO campaign_brands (campaign_id, brand_name) VALUES (@cid, @brand)";
                    cmd.Parameters.AddWithValue("cid", c.Id);
                    cmd.Parameters.AddWithValue("brand", brandName);
                    await cmd.ExecuteNonQueryAsync(cancellationToken);
                }
            }

            await tx.CommitAsync(cancellationToken);
        }
        catch
        {
            await tx.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM campaigns WHERE id = @id";
        cmd.Parameters.AddWithValue("id", id);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task RecordUsageAsync(Guid campaignId, Guid orderId, Guid? userId, decimal discountAmount, CancellationToken cancellationToken)
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            INSERT INTO campaign_usages (id, campaign_id, order_id, user_id, discount_amount, created_at_utc)
            VALUES (@id, @campaign_id, @order_id, @user_id, @discount, (now() AT TIME ZONE 'utc'))";
        
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("campaign_id", campaignId);
        cmd.Parameters.AddWithValue("order_id", orderId);
        cmd.Parameters.AddWithValue("user_id", (object?)userId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("discount", discountAmount);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<List<CampaignStatDto>> GetStatsAsync(CancellationToken cancellationToken)
    {
        var stats = new List<CampaignStatDto>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        // Calculate dynamic product counts, usage metrics, and total discount value for each campaign
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            SELECT 
                c.id AS campaign_id,
                COALESCE(u.usage_count, 0) AS usage_count,
                COALESCE(u.total_discount, 0) AS total_discount,
                (
                    SELECT COUNT(DISTINCT p.erp_product_id) 
                    FROM products p
                    LEFT JOIN product_category_map pcm ON p.erp_product_id = pcm.product_id
                    LEFT JOIN product_metadata pm ON p.erp_product_id = pm.product_id
                    WHERE 
                        -- Check product target mappings
                        EXISTS (SELECT 1 FROM campaign_products cp WHERE cp.campaign_id = c.id AND cp.product_id = p.erp_product_id)
                        OR
                        -- Check category target mappings
                        (pcm.category_id IS NOT NULL AND EXISTS (SELECT 1 FROM campaign_categories cc WHERE cc.campaign_id = c.id AND cc.category_id = pcm.category_id))
                        OR
                        -- Check brand target mappings
                        (pm.brand IS NOT NULL AND EXISTS (SELECT 1 FROM campaign_brands cb WHERE cb.campaign_id = c.id AND LOWER(cb.brand_name) = LOWER(pm.brand)))
                        OR
                        -- If campaign has no targets, it applies globally to all products (unless type is free shipping or cart-wide specific)
                        (
                            NOT EXISTS (SELECT 1 FROM campaign_products cp WHERE cp.campaign_id = c.id) AND
                            NOT EXISTS (SELECT 1 FROM campaign_categories cc WHERE cc.campaign_id = c.id) AND
                            NOT EXISTS (SELECT 1 FROM campaign_brands cb WHERE cb.campaign_id = c.id)
                        )
                ) AS applied_products_count
            FROM campaigns c
            LEFT JOIN (
                SELECT campaign_id, COUNT(*) AS usage_count, SUM(discount_amount) AS total_discount 
                FROM campaign_usages 
                GROUP BY campaign_id
            ) u ON c.id = u.campaign_id";

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            stats.Add(new CampaignStatDto
            {
                CampaignId = reader.GetGuid(0),
                UsageCount = reader.GetInt64(1),
                TotalDiscount = reader.GetDecimal(2),
                AppliedProductsCount = reader.GetInt32(3)
            });
        }

        return stats;
    }
}

public sealed class CampaignStatDto
{
    public Guid CampaignId { get; set; }
    public long UsageCount { get; set; }
    public decimal TotalDiscount { get; set; }
    public int AppliedProductsCount { get; set; }
}
