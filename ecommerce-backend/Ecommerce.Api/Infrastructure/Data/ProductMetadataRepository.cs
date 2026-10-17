using System.Text.Json;
using Npgsql;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class ProductMetadataRepository
{
    private readonly string _connStr;

    public ProductMetadataRepository(IConfiguration config)
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
CREATE TABLE IF NOT EXISTS product_metadata (
  product_tenant_code text NOT NULL,
  product_id uuid NOT NULL,
  description text NULL,
  features_json text NULL,
  updated_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  PRIMARY KEY (product_tenant_code, product_id)
);

CREATE INDEX IF NOT EXISTS ix_product_metadata_product ON product_metadata (product_tenant_code, product_id);
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS variants_json text NULL;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS slug text NULL;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS brand text NULL;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS short_description text NULL;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS technical_specs_json text NULL;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS manual_pdf_url text NULL;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS catalog_pdf_url text NULL;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS seo_title text NULL;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS seo_description text NULL;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS labels_json text NULL;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS show_on_home boolean NOT NULL DEFAULT FALSE;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS is_campaign boolean NOT NULL DEFAULT FALSE;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS related_product_ids_json text NULL;

ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Draft';
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS description_en text NULL;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS features_en_json text NULL;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS short_description_en text NULL;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS technical_specs_en_json text NULL;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS seo_title_en text NULL;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS seo_description_en text NULL;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS warranty_months integer NOT NULL DEFAULT 0;
ALTER TABLE product_metadata ADD COLUMN IF NOT EXISTS is_free_shipping boolean NOT NULL DEFAULT FALSE;
";

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<ProductMetadata?> GetAsync(string productTenantCode, Guid productId, CancellationToken cancellationToken)
    {
        productTenantCode = (productTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(productTenantCode)) return null;
        if (productId == Guid.Empty) return null;

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT 
  product_tenant_code, 
  product_id, 
  description, 
  features_json, 
  variants_json, 
  slug,
  brand,
  short_description,
  technical_specs_json,
  manual_pdf_url,
  catalog_pdf_url,
  seo_title,
  seo_description,
  labels_json,
  show_on_home,
  is_campaign,
  status,
  description_en,
  features_en_json,
  short_description_en,
  technical_specs_en_json,
  seo_title_en,
  seo_description_en,
  related_product_ids_json,
  warranty_months,
  is_free_shipping,
  updated_at_utc
FROM product_metadata
WHERE product_tenant_code=@pt AND product_id=@pid
LIMIT 1;
";
        cmd.Parameters.AddWithValue("pt", productTenantCode);
        cmd.Parameters.AddWithValue("pid", productId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;

        var featuresJson = reader.IsDBNull(3) ? null : reader.GetString(3);
        var features = ParseFeatures(featuresJson);
        var variantsJson = reader.IsDBNull(4) ? null : reader.GetString(4);

        var featuresEnJson = reader.IsDBNull(18) ? null : reader.GetString(18);
        var featuresEn = ParseFeatures(featuresEnJson);

        return new ProductMetadata
        {
            ProductTenantCode = reader.GetString(0),
            ProductId = reader.GetGuid(1),
            Description = reader.IsDBNull(2) ? null : reader.GetString(2),
            Features = features,
            VariantsJson = variantsJson,
            Slug = reader.IsDBNull(5) ? null : reader.GetString(5),
            Brand = reader.IsDBNull(6) ? null : reader.GetString(6),
            ShortDescription = reader.IsDBNull(7) ? null : reader.GetString(7),
            TechnicalSpecsJson = reader.IsDBNull(8) ? null : reader.GetString(8),
            ManualPdfUrl = reader.IsDBNull(9) ? null : reader.GetString(9),
            CatalogPdfUrl = reader.IsDBNull(10) ? null : reader.GetString(10),
            SeoTitle = reader.IsDBNull(11) ? null : reader.GetString(11),
            SeoDescription = reader.IsDBNull(12) ? null : reader.GetString(12),
            LabelsJson = reader.IsDBNull(13) ? null : reader.GetString(13),
            ShowOnHome = reader.GetBoolean(14),
            IsCampaign = reader.GetBoolean(15),
            Status = reader.IsDBNull(16) ? "Draft" : reader.GetString(16),
            DescriptionEn = reader.IsDBNull(17) ? null : reader.GetString(17),
            FeaturesEn = featuresEn,
            ShortDescriptionEn = reader.IsDBNull(19) ? null : reader.GetString(19),
            TechnicalSpecsEnJson = reader.IsDBNull(20) ? null : reader.GetString(20),
            SeoTitleEn = reader.IsDBNull(21) ? null : reader.GetString(21),
            SeoDescriptionEn = reader.IsDBNull(22) ? null : reader.GetString(22),
            RelatedProductIds = ParseRelatedProductIds(reader.IsDBNull(23) ? null : reader.GetString(23)),
            WarrantyMonths = reader.IsDBNull(24) ? 0 : reader.GetInt32(24),
            IsFreeShipping = reader.GetBoolean(25),
            UpdatedAtUtc = reader.GetFieldValue<DateTimeOffset>(26)
        };
    }

    public async Task<List<ProductMetadata>> ListAllAsync(CancellationToken cancellationToken)
    {
        var result = new List<ProductMetadata>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT 
  product_tenant_code, 
  product_id, 
  description, 
  features_json, 
  variants_json, 
  slug,
  brand,
  short_description,
  technical_specs_json,
  manual_pdf_url,
  catalog_pdf_url,
  seo_title,
  seo_description,
  labels_json,
  show_on_home,
  is_campaign,
  status,
  description_en,
  features_en_json,
  short_description_en,
  technical_specs_en_json,
  seo_title_en,
  seo_description_en,
  related_product_ids_json,
  warranty_months,
  is_free_shipping,
  updated_at_utc
FROM product_metadata;
";
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var featuresJson = reader.IsDBNull(3) ? null : reader.GetString(3);
            var features = ParseFeatures(featuresJson);
            var variantsJson = reader.IsDBNull(4) ? null : reader.GetString(4);

            var featuresEnJson = reader.IsDBNull(18) ? null : reader.GetString(18);
            var featuresEn = ParseFeatures(featuresEnJson);

            result.Add(new ProductMetadata
            {
                ProductTenantCode = reader.GetString(0),
                ProductId = reader.GetGuid(1),
                Description = reader.IsDBNull(2) ? null : reader.GetString(2),
                Features = features,
                VariantsJson = variantsJson,
                Slug = reader.IsDBNull(5) ? null : reader.GetString(5),
                Brand = reader.IsDBNull(6) ? null : reader.GetString(6),
                ShortDescription = reader.IsDBNull(7) ? null : reader.GetString(7),
                TechnicalSpecsJson = reader.IsDBNull(8) ? null : reader.GetString(8),
                ManualPdfUrl = reader.IsDBNull(9) ? null : reader.GetString(9),
                CatalogPdfUrl = reader.IsDBNull(10) ? null : reader.GetString(10),
                SeoTitle = reader.IsDBNull(11) ? null : reader.GetString(11),
                SeoDescription = reader.IsDBNull(12) ? null : reader.GetString(12),
                LabelsJson = reader.IsDBNull(13) ? null : reader.GetString(13),
                ShowOnHome = reader.GetBoolean(14),
                IsCampaign = reader.GetBoolean(15),
                Status = reader.IsDBNull(16) ? "Draft" : reader.GetString(16),
                DescriptionEn = reader.IsDBNull(17) ? null : reader.GetString(17),
                FeaturesEn = featuresEn,
                ShortDescriptionEn = reader.IsDBNull(19) ? null : reader.GetString(19),
                TechnicalSpecsEnJson = reader.IsDBNull(20) ? null : reader.GetString(20),
                SeoTitleEn = reader.IsDBNull(21) ? null : reader.GetString(21),
                SeoDescriptionEn = reader.IsDBNull(22) ? null : reader.GetString(22),
                RelatedProductIds = ParseRelatedProductIds(reader.IsDBNull(23) ? null : reader.GetString(23)),
                WarrantyMonths = reader.IsDBNull(24) ? 0 : reader.GetInt32(24),
                IsFreeShipping = reader.GetBoolean(25),
                UpdatedAtUtc = reader.GetFieldValue<DateTimeOffset>(26)
            });
        }
        return result;
    }

    public async Task<HashSet<Guid>> GetUnpublishedProductIdsAsync(CancellationToken cancellationToken)
    {
        var ids = new HashSet<Guid>();
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT product_id FROM product_metadata WHERE status != 'Published'";
        
        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            ids.Add(reader.GetGuid(0));
        }
        return ids;
    }

    public async Task UpsertAsync(ProductMetadata meta, CancellationToken cancellationToken)
    {
        meta.ProductTenantCode = (meta.ProductTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(meta.ProductTenantCode))
            throw new InvalidOperationException("ProductTenantCode is required");

        if (meta.ProductId == Guid.Empty)
            throw new InvalidOperationException("ProductId is required");

        var featuresJson = SerializeFeatures(meta.Features);
        var featuresEnJson = SerializeFeatures(meta.FeaturesEn);

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO product_metadata (
  product_tenant_code, 
  product_id, 
  description, 
  features_json, 
  variants_json,
  slug,
  brand,
  short_description,
  technical_specs_json,
  manual_pdf_url,
  catalog_pdf_url,
  seo_title,
  seo_description,
  labels_json,
  show_on_home,
  is_campaign,
  status,
  description_en,
  features_en_json,
  short_description_en,
  technical_specs_en_json,
  seo_title_en,
  seo_description_en,
  related_product_ids_json,
  warranty_months,
  is_free_shipping,
  updated_at_utc
)
VALUES (
  @pt, 
  @pid, 
  @desc, 
  @features, 
  @variants,
  @slug,
  @brand,
  @short_desc,
  @tech_specs,
  @manual_url,
  @catalog_url,
  @seo_t,
  @seo_d,
  @labels,
  @show_home,
  @is_camp,
  @status,
  @desc_en,
  @features_en,
  @short_desc_en,
  @tech_specs_en,
  @seo_t_en,
  @seo_d_en,
  @related_ids,
  @warranty_months,
  @is_free_shipping,
  (now() AT TIME ZONE 'utc')
)
ON CONFLICT (product_tenant_code, product_id) DO UPDATE SET
  description = EXCLUDED.description,
  features_json = EXCLUDED.features_json,
  variants_json = EXCLUDED.variants_json,
  slug = EXCLUDED.slug,
  brand = EXCLUDED.brand,
  short_description = EXCLUDED.short_description,
  technical_specs_json = EXCLUDED.technical_specs_json,
  manual_pdf_url = EXCLUDED.manual_pdf_url,
  catalog_pdf_url = EXCLUDED.catalog_pdf_url,
  seo_title = EXCLUDED.seo_title,
  seo_description = EXCLUDED.seo_description,
  labels_json = EXCLUDED.labels_json,
  show_on_home = EXCLUDED.show_on_home,
  is_campaign = EXCLUDED.is_campaign,
  status = EXCLUDED.status,
  description_en = EXCLUDED.description_en,
  features_en_json = EXCLUDED.features_en_json,
  short_description_en = EXCLUDED.short_description_en,
  technical_specs_en_json = EXCLUDED.technical_specs_en_json,
  seo_title_en = EXCLUDED.seo_title_en,
  seo_description_en = EXCLUDED.seo_description_en,
  related_product_ids_json = EXCLUDED.related_product_ids_json,
  warranty_months = EXCLUDED.warranty_months,
  is_free_shipping = EXCLUDED.is_free_shipping,
  updated_at_utc = EXCLUDED.updated_at_utc;
";

        cmd.Parameters.AddWithValue("pt", meta.ProductTenantCode);
        cmd.Parameters.AddWithValue("pid", meta.ProductId);
        cmd.Parameters.AddWithValue("desc", (object?)NormalizeNullableText(meta.Description) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("features", (object?)featuresJson ?? DBNull.Value);
        cmd.Parameters.AddWithValue("variants", (object?)meta.VariantsJson ?? DBNull.Value);
        cmd.Parameters.AddWithValue("slug", (object?)NormalizeNullableText(meta.Slug) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("brand", (object?)NormalizeNullableText(meta.Brand) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("short_desc", (object?)NormalizeNullableText(meta.ShortDescription) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("tech_specs", (object?)NormalizeNullableText(meta.TechnicalSpecsJson) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("manual_url", (object?)NormalizeNullableText(meta.ManualPdfUrl) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("catalog_url", (object?)NormalizeNullableText(meta.CatalogPdfUrl) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("seo_t", (object?)NormalizeNullableText(meta.SeoTitle) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("seo_d", (object?)NormalizeNullableText(meta.SeoDescription) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("labels", (object?)NormalizeNullableText(meta.LabelsJson) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("show_home", meta.ShowOnHome);
        cmd.Parameters.AddWithValue("is_camp", meta.IsCampaign);
        cmd.Parameters.AddWithValue("status", string.IsNullOrWhiteSpace(meta.Status) ? "Draft" : meta.Status);
        cmd.Parameters.AddWithValue("desc_en", (object?)NormalizeNullableText(meta.DescriptionEn) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("features_en", (object?)featuresEnJson ?? DBNull.Value);
        cmd.Parameters.AddWithValue("short_desc_en", (object?)NormalizeNullableText(meta.ShortDescriptionEn) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("tech_specs_en", (object?)NormalizeNullableText(meta.TechnicalSpecsEnJson) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("seo_t_en", (object?)NormalizeNullableText(meta.SeoTitleEn) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("seo_d_en", (object?)NormalizeNullableText(meta.SeoDescriptionEn) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("related_ids", (object?)SerializeRelatedProductIds(meta.RelatedProductIds) ?? DBNull.Value);
        cmd.Parameters.AddWithValue("warranty_months", meta.WarrantyMonths);
        cmd.Parameters.AddWithValue("is_free_shipping", meta.IsFreeShipping);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    private static List<string> ParseFeatures(string? json)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(json)) return new List<string>();
            var arr = JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>();
            return arr.Select(x => (x ?? string.Empty).Trim()).Where(x => !string.IsNullOrWhiteSpace(x)).Take(30).ToList();
        }
        catch
        {
            return new List<string>();
        }
    }

    private static string? SerializeFeatures(IEnumerable<string> features)
    {
        var list = features
            ?.Select(x => (x ?? string.Empty).Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct()
            .Take(30)
            .ToList() ?? new List<string>();

        if (list.Count == 0) return null;
        return JsonSerializer.Serialize(list);
    }

    private static string? NormalizeNullableText(string? value)
    {
        var v = (value ?? string.Empty).Trim();
        return string.IsNullOrWhiteSpace(v) ? null : v;
    }

    private static List<Guid> ParseRelatedProductIds(string? json)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(json)) return new List<Guid>();
            return JsonSerializer.Deserialize<List<Guid>>(json) ?? new List<Guid>();
        }
        catch
        {
            return new List<Guid>();
        }
    }

    private static string? SerializeRelatedProductIds(IEnumerable<Guid>? ids)
    {
        if (ids is null) return null;
        var list = ids.Distinct().ToList();
        if (list.Count == 0) return null;
        return JsonSerializer.Serialize(list);
    }
}
