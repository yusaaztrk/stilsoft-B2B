using Npgsql;
using System.Text;

namespace Ecommerce.Api.Infrastructure.Data;

public sealed class CategoriesRepository
{
    public const string DefaultCatalogCode = "DEMO";

    private readonly string _connStr;

    public CategoriesRepository(IConfiguration config)
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
CREATE TABLE IF NOT EXISTS categories (
  tenant_code text NOT NULL,
  id uuid NOT NULL,
  parent_id uuid NULL,
  name text NOT NULL,
  slug text NOT NULL,
  image_url text NOT NULL DEFAULT '',
  show_in_header boolean NOT NULL DEFAULT TRUE,
  show_in_footer boolean NOT NULL DEFAULT FALSE,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT TRUE,
  created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  PRIMARY KEY (tenant_code, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_tenant_slug ON categories (tenant_code, slug);
CREATE INDEX IF NOT EXISTS ix_categories_tenant_parent ON categories (tenant_code, parent_id);
CREATE INDEX IF NOT EXISTS ix_categories_tenant_sort ON categories (tenant_code, sort_order);

CREATE TABLE IF NOT EXISTS product_categories (
  tenant_code text NOT NULL,
  product_id uuid NOT NULL,
  category_id uuid NOT NULL,
  is_primary boolean NOT NULL DEFAULT FALSE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  PRIMARY KEY (tenant_code, product_id, category_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_categories_primary_per_product
ON product_categories (tenant_code, product_id)
WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS ix_product_categories_tenant_category ON product_categories (tenant_code, category_id);
CREATE INDEX IF NOT EXISTS ix_product_categories_tenant_product ON product_categories (tenant_code, product_id);

CREATE TABLE IF NOT EXISTS product_category_map (
  product_tenant_code text NOT NULL,
  product_id uuid NOT NULL,
  category_tenant_code text NOT NULL,
  category_id uuid NOT NULL,
  is_primary boolean NOT NULL DEFAULT FALSE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  PRIMARY KEY (product_tenant_code, product_id, category_tenant_code, category_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_category_map_primary_per_product
ON product_category_map (product_tenant_code, product_id)
WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS ix_product_category_map_category
ON product_category_map (category_tenant_code, category_id);

CREATE INDEX IF NOT EXISTS ix_product_category_map_product
ON product_category_map (product_tenant_code, product_id);
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);

        await using var alter = conn.CreateCommand();
        alter.CommandText = @"
ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS show_in_header boolean NOT NULL DEFAULT TRUE;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS show_in_footer boolean NOT NULL DEFAULT FALSE;
";
        await alter.ExecuteNonQueryAsync(cancellationToken);

        await using var seedCheck = conn.CreateCommand();
        seedCheck.CommandText = @"SELECT COUNT(*) FROM categories WHERE tenant_code=@tenant;";
        seedCheck.Parameters.AddWithValue("tenant", DefaultCatalogCode);
        var count = Convert.ToInt64(await seedCheck.ExecuteScalarAsync(cancellationToken));
        if (count > 0) return;

        var seeds = new (string Name, string Slug, string ImageUrl, bool ShowInHeader, bool ShowInFooter, int SortOrder)[]
        {
            ("Mutfak", "mutfak", "https://lh3.googleusercontent.com/aida-public/AB6AXuA0dOLQ0vHchtcr_Yydg5OaKWWWROXHHonx8J19W8IVxQYutRdUK7aJlVKLtz4n6SEku7eKUrq__bcP-bx071sC7ylrA7vMXe79yfDkLZkReswfV0dAxYRj9Qu56rrjJYwB2CBwxX2pviYSbqorrdICmOsRB9-VBc53rTnx7Ibg7cNdZABivo2OZHI8lJWAuDWYrdX1nmch4t-jCCjK1r-iKNr0cTb9GnW7k64Sxej_5PcXPfNiQvrf6attZSdeJZv4eyF-DvJlyZY", true, false, 10),
            ("Süpürge", "supurge", "https://lh3.googleusercontent.com/aida-public/AB6AXuB6KOv_-Wu_YZIVABX62pcwVfPINDaTDcC7X5_T8PrWBYwJC1-TH4stvaxqAqdynYQDH2dpmaxYz-DJ-NfMXBDdk9txs4oXA4SnDTtgt7DyndDsJcvW1dXSf6ruUstuTfQtbuGc7vaAStnvNSEuj19gvxRcZ0o8ZHchf7qzbLe-nDYRK_G4cCnmHkwd3YuKVVqqFJ3JArs1toiBY7Ymzst7gaMS0TZwLWHcZCP7jyBCNtBMjbHtnsMTijXk_mgj6G3V5VCB4fysH1w", true, false, 20),
            ("Kişisel Bakım", "kisisel-bakim", "https://lh3.googleusercontent.com/aida-public/AB6AXuC1nMbK3JS10O0DMdkQ7QH3GtXCekl6gljeBt2okXnmhwWImCUtsX7_tQoDA35lNccWifKw03Th7Ye_1zHA8HXAjYlIrpdX3EeRr7GkbxXxJ7Tntezvjr5AZLL4W6M1sBkRdMXG4xeaGM6UCyO57tcJ1O7fBM7sdqjM5tIJLAiMjKcQHeMurdvGbS9ry_QwMUIA__3H2jSuBB3M0r5Hd5eR8MGUXJ9W2q8j5Qa_aab2LdoFdAbFtNcJjzxsewPrEFsN2DZtulgQrNE", true, true, 30),
            ("Ütü Grubu", "utu-grubu", "", true, true, 40),
            ("İçecek Hazırlama", "icecek-hazirlama", "", true, true, 50),
        };

        foreach (var s in seeds)
        {
            await UpsertAsync(new Category
            {
                TenantCode = DefaultCatalogCode,
                Id = Guid.NewGuid(),
                ParentId = null,
                Name = s.Name,
                Slug = s.Slug,
                ImageUrl = s.ImageUrl,
                ShowInHeader = s.ShowInHeader,
                ShowInFooter = s.ShowInFooter,
                SortOrder = s.SortOrder,
                IsActive = true,
                UpdatedAtUtc = DateTimeOffset.UtcNow
            }, cancellationToken);
        }
    }

    public async Task<List<Category>> ListAsync(string tenantCode, CancellationToken cancellationToken)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenantCode))
            return new List<Category>();

        var result = new List<Category>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT tenant_code, id, parent_id, name, slug, image_url, show_in_header, show_in_footer, sort_order, is_active, created_at_utc, updated_at_utc
FROM categories
WHERE tenant_code=@tenant
ORDER BY parent_id NULLS FIRST, sort_order ASC, name ASC;
";
        cmd.Parameters.AddWithValue("tenant", tenantCode);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new Category
            {
                TenantCode = reader.GetString(0),
                Id = reader.GetGuid(1),
                ParentId = reader.IsDBNull(2) ? null : reader.GetGuid(2),
                Name = reader.GetString(3),
                Slug = reader.GetString(4),
                ImageUrl = reader.IsDBNull(5) ? string.Empty : reader.GetString(5),
                ShowInHeader = !reader.IsDBNull(6) && reader.GetBoolean(6),
                ShowInFooter = !reader.IsDBNull(7) && reader.GetBoolean(7),
                SortOrder = reader.GetInt32(8),
                IsActive = reader.GetBoolean(9),
                CreatedAtUtc = reader.GetFieldValue<DateTimeOffset>(10),
                UpdatedAtUtc = reader.GetFieldValue<DateTimeOffset>(11)
            });
        }

        return result;
    }

    public async Task<List<(string ProductTenantCode, Guid ProductId)>> ListProductKeysByCategoryIdsAsync(
        string categoryTenantCode,
        IReadOnlyCollection<Guid> categoryIds,
        CancellationToken cancellationToken)
    {
        categoryTenantCode = (categoryTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(categoryTenantCode))
            return new List<(string, Guid)>();

        var ids = categoryIds?.Where(x => x != Guid.Empty).Distinct().ToArray() ?? Array.Empty<Guid>();
        if (ids.Length == 0)
            return new List<(string, Guid)>();

        var result = new List<(string ProductTenantCode, Guid ProductId)>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT DISTINCT product_tenant_code, product_id
FROM product_category_map
WHERE category_tenant_code=@cat_tenant AND category_id = ANY(@cat_ids)
ORDER BY product_tenant_code ASC, product_id ASC;
";
        cmd.Parameters.AddWithValue("cat_tenant", categoryTenantCode);
        cmd.Parameters.AddWithValue("cat_ids", ids);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add((reader.GetString(0), reader.GetGuid(1)));
        }

        return result;
    }

    public async Task<List<Category>> ListAllAsync(int take, CancellationToken cancellationToken)
    {
        take = take < 1 ? 200 : take;
        take = take > 5000 ? 5000 : take;

        var result = new List<Category>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT tenant_code, id, parent_id, name, slug, image_url, show_in_header, show_in_footer, sort_order, is_active, created_at_utc, updated_at_utc
FROM categories
ORDER BY tenant_code ASC, parent_id NULLS FIRST, sort_order ASC, name ASC
LIMIT @take;
";
        cmd.Parameters.AddWithValue("take", take);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new Category
            {
                TenantCode = reader.GetString(0),
                Id = reader.GetGuid(1),
                ParentId = reader.IsDBNull(2) ? null : reader.GetGuid(2),
                Name = reader.GetString(3),
                Slug = reader.GetString(4),
                ImageUrl = reader.IsDBNull(5) ? string.Empty : reader.GetString(5),
                ShowInHeader = !reader.IsDBNull(6) && reader.GetBoolean(6),
                ShowInFooter = !reader.IsDBNull(7) && reader.GetBoolean(7),
                SortOrder = reader.GetInt32(8),
                IsActive = reader.GetBoolean(9),
                CreatedAtUtc = reader.GetFieldValue<DateTimeOffset>(10),
                UpdatedAtUtc = reader.GetFieldValue<DateTimeOffset>(11)
            });
        }

        return result;
    }

    public async Task<Category?> GetBySlugAsync(string tenantCode, string slug, CancellationToken cancellationToken)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        slug = (slug ?? string.Empty).Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(tenantCode) || string.IsNullOrWhiteSpace(slug))
            return null;

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT tenant_code, id, parent_id, name, slug, image_url, show_in_header, show_in_footer, sort_order, is_active, created_at_utc, updated_at_utc
FROM categories
WHERE tenant_code=@tenant AND slug=@slug
LIMIT 1;
";
        cmd.Parameters.AddWithValue("tenant", tenantCode);
        cmd.Parameters.AddWithValue("slug", slug);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;

        return new Category
        {
            TenantCode = reader.GetString(0),
            Id = reader.GetGuid(1),
            ParentId = reader.IsDBNull(2) ? null : reader.GetGuid(2),
            Name = reader.GetString(3),
            Slug = reader.GetString(4),
            ImageUrl = reader.IsDBNull(5) ? string.Empty : reader.GetString(5),
            ShowInHeader = !reader.IsDBNull(6) && reader.GetBoolean(6),
            ShowInFooter = !reader.IsDBNull(7) && reader.GetBoolean(7),
            SortOrder = reader.GetInt32(8),
            IsActive = reader.GetBoolean(9),
            CreatedAtUtc = reader.GetFieldValue<DateTimeOffset>(10),
            UpdatedAtUtc = reader.GetFieldValue<DateTimeOffset>(11)
        };
    }

    public async Task<List<Guid>> GetCategoryAndChildIdsAsync(string tenantCode, Guid categoryId, CancellationToken cancellationToken)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenantCode))
            return new List<Guid>();

        if (categoryId == Guid.Empty)
            return new List<Guid>();

        var ids = new List<Guid>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
WITH RECURSIVE cat_tree AS (
  SELECT id FROM categories WHERE tenant_code=@tenant AND id=@root AND is_active = TRUE
  UNION ALL
  SELECT c.id FROM categories c INNER JOIN cat_tree ct ON c.parent_id = ct.id WHERE c.tenant_code=@tenant AND c.is_active = TRUE
)
SELECT id FROM cat_tree;
";
        cmd.Parameters.AddWithValue("tenant", tenantCode);
        cmd.Parameters.AddWithValue("root", categoryId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            ids.Add(reader.GetGuid(0));
        }

        return ids;
    }

    public async Task<List<Guid>> ListProductIdsByCategoryIdsAsync(string tenantCode, IReadOnlyCollection<Guid> categoryIds, CancellationToken cancellationToken)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenantCode))
            return new List<Guid>();

        var ids = categoryIds?.Where(x => x != Guid.Empty).Distinct().ToArray() ?? Array.Empty<Guid>();
        if (ids.Length == 0)
            return new List<Guid>();

        var result = new List<Guid>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT DISTINCT product_id
FROM product_categories
WHERE tenant_code=@tenant AND category_id = ANY(@cat_ids)
ORDER BY product_id;
";
        cmd.Parameters.AddWithValue("tenant", tenantCode);
        cmd.Parameters.AddWithValue("cat_ids", ids);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(reader.GetGuid(0));
        }

        return result;
    }

    public async Task UpsertAsync(Category category, CancellationToken cancellationToken)
    {
        category.TenantCode = (category.TenantCode ?? string.Empty).Trim().ToUpperInvariant();
        category.Name = (category.Name ?? string.Empty).Trim();
        category.Slug = NormalizeSlug(category.Slug, category.Name);

        if (string.IsNullOrWhiteSpace(category.TenantCode))
            throw new InvalidOperationException("TenantCode is required");

        if (category.Id == Guid.Empty)
            category.Id = Guid.NewGuid();

        if (string.IsNullOrWhiteSpace(category.Name))
            throw new InvalidOperationException("Name is required");

        if (string.IsNullOrWhiteSpace(category.Slug))
            throw new InvalidOperationException("Slug is required");

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO categories (
  tenant_code, id, parent_id, name, slug, image_url, show_in_header, show_in_footer, sort_order, is_active, created_at_utc, updated_at_utc
)
VALUES (
  @tenant, @id, @parent, @name, @slug, @image, @show_in_header, @show_in_footer, @sort, @active, (now() AT TIME ZONE 'utc'), (now() AT TIME ZONE 'utc')
)
ON CONFLICT (tenant_code, id) DO UPDATE SET
  parent_id = EXCLUDED.parent_id,
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  image_url = EXCLUDED.image_url,
  show_in_header = EXCLUDED.show_in_header,
  show_in_footer = EXCLUDED.show_in_footer,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  updated_at_utc = (now() AT TIME ZONE 'utc');
";

        cmd.Parameters.AddWithValue("tenant", category.TenantCode);
        cmd.Parameters.AddWithValue("id", category.Id);
        cmd.Parameters.AddWithValue("parent", (object?)category.ParentId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("name", category.Name);
        cmd.Parameters.AddWithValue("slug", category.Slug);
        cmd.Parameters.AddWithValue("image", (category.ImageUrl ?? string.Empty).Trim());
        cmd.Parameters.AddWithValue("show_in_header", category.ShowInHeader);
        cmd.Parameters.AddWithValue("show_in_footer", category.ShowInFooter);
        cmd.Parameters.AddWithValue("sort", category.SortOrder);
        cmd.Parameters.AddWithValue("active", category.IsActive);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task UpdateImageUrlAsync(string tenantCode, Guid categoryId, string imageUrl, CancellationToken cancellationToken)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(tenantCode))
            throw new InvalidOperationException("TenantCode is required");

        if (categoryId == Guid.Empty)
            throw new InvalidOperationException("CategoryId is required");

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"UPDATE categories SET image_url=@img, updated_at_utc=(now() AT TIME ZONE 'utc') WHERE tenant_code=@tenant AND id=@id";
        cmd.Parameters.AddWithValue("tenant", tenantCode);
        cmd.Parameters.AddWithValue("id", categoryId);
        cmd.Parameters.AddWithValue("img", (imageUrl ?? string.Empty).Trim());
        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task SetProductPrimaryCategoryAsync(string productTenantCode, Guid productId, string categoryTenantCode, Guid categoryId, CancellationToken cancellationToken)
    {
        productTenantCode = (productTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(productTenantCode))
            throw new InvalidOperationException("ProductTenantCode is required");

        categoryTenantCode = (categoryTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(categoryTenantCode))
            throw new InvalidOperationException("CategoryTenantCode is required");

        if (productId == Guid.Empty)
            throw new InvalidOperationException("ProductId is required");

        if (categoryId == Guid.Empty)
            throw new InvalidOperationException("CategoryId is required");

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var tx = await conn.BeginTransactionAsync(cancellationToken);

        await using (var clear = conn.CreateCommand())
        {
            clear.Transaction = tx;
            clear.CommandText = @"UPDATE product_category_map SET is_primary = FALSE WHERE product_tenant_code=@pt AND product_id=@pid;";
            clear.Parameters.AddWithValue("pt", productTenantCode);
            clear.Parameters.AddWithValue("pid", productId);
            await clear.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var upsert = conn.CreateCommand())
        {
            upsert.Transaction = tx;
            upsert.CommandText = @"
INSERT INTO product_category_map (product_tenant_code, product_id, category_tenant_code, category_id, is_primary, sort_order, created_at_utc)
VALUES (@pt, @pid, @ct, @cid, TRUE, 0, (now() AT TIME ZONE 'utc'))
ON CONFLICT (product_tenant_code, product_id, category_tenant_code, category_id) DO UPDATE SET
  is_primary = TRUE;
";
            upsert.Parameters.AddWithValue("pt", productTenantCode);
            upsert.Parameters.AddWithValue("pid", productId);
            upsert.Parameters.AddWithValue("ct", categoryTenantCode);
            upsert.Parameters.AddWithValue("cid", categoryId);
            await upsert.ExecuteNonQueryAsync(cancellationToken);
        }

        await tx.CommitAsync(cancellationToken);
    }

    public async Task AddProductCategoryAsync(string productTenantCode, Guid productId, string categoryTenantCode, Guid categoryId, bool isPrimary, int sortOrder, CancellationToken cancellationToken)
    {
        productTenantCode = (productTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(productTenantCode))
            throw new InvalidOperationException("ProductTenantCode is required");

        categoryTenantCode = (categoryTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(categoryTenantCode))
            throw new InvalidOperationException("CategoryTenantCode is required");

        if (productId == Guid.Empty)
            throw new InvalidOperationException("ProductId is required");

        if (categoryId == Guid.Empty)
            throw new InvalidOperationException("CategoryId is required");

        sortOrder = sortOrder < 0 ? 0 : sortOrder;

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO product_category_map (product_tenant_code, product_id, category_tenant_code, category_id, is_primary, sort_order, created_at_utc)
VALUES (@pt, @pid, @ct, @cid, @primary, @sort, (now() AT TIME ZONE 'utc'))
ON CONFLICT (product_tenant_code, product_id, category_tenant_code, category_id) DO UPDATE SET
  is_primary = EXCLUDED.is_primary,
  sort_order = EXCLUDED.sort_order;
";

        cmd.Parameters.AddWithValue("pt", productTenantCode);
        cmd.Parameters.AddWithValue("pid", productId);
        cmd.Parameters.AddWithValue("ct", categoryTenantCode);
        cmd.Parameters.AddWithValue("cid", categoryId);
        cmd.Parameters.AddWithValue("primary", isPrimary);
        cmd.Parameters.AddWithValue("sort", sortOrder);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task RemoveProductCategoryAsync(string productTenantCode, Guid productId, string categoryTenantCode, Guid categoryId, CancellationToken cancellationToken)
    {
        productTenantCode = (productTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(productTenantCode))
            throw new InvalidOperationException("ProductTenantCode is required");

        categoryTenantCode = (categoryTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(categoryTenantCode))
            throw new InvalidOperationException("CategoryTenantCode is required");

        if (productId == Guid.Empty)
            throw new InvalidOperationException("ProductId is required");

        if (categoryId == Guid.Empty)
            throw new InvalidOperationException("CategoryId is required");

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
DELETE FROM product_category_map
WHERE product_tenant_code=@pt AND product_id=@pid AND category_tenant_code=@ct AND category_id=@cid;
";
        cmd.Parameters.AddWithValue("pt", productTenantCode);
        cmd.Parameters.AddWithValue("pid", productId);
        cmd.Parameters.AddWithValue("ct", categoryTenantCode);
        cmd.Parameters.AddWithValue("cid", categoryId);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task RemoveAllProductCategoriesAsync(string productTenantCode, Guid productId, CancellationToken cancellationToken)
    {
        productTenantCode = (productTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(productTenantCode))
            throw new InvalidOperationException("ProductTenantCode is required");

        if (productId == Guid.Empty)
            throw new InvalidOperationException("ProductId is required");

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
DELETE FROM product_category_map
WHERE product_tenant_code=@pt AND product_id=@pid;
";
        cmd.Parameters.AddWithValue("pt", productTenantCode);
        cmd.Parameters.AddWithValue("pid", productId);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<List<(Guid CategoryId, bool IsPrimary, int SortOrder)>> ListProductCategoriesAsync(
        string productTenantCode,
        Guid productId,
        string categoryTenantCode,
        CancellationToken cancellationToken)
    {
        productTenantCode = (productTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        categoryTenantCode = (categoryTenantCode ?? string.Empty).Trim().ToUpperInvariant();

        if (string.IsNullOrWhiteSpace(productTenantCode) || string.IsNullOrWhiteSpace(categoryTenantCode))
            return new List<(Guid, bool, int)>();

        if (productId == Guid.Empty)
            return new List<(Guid, bool, int)>();

        var result = new List<(Guid CategoryId, bool IsPrimary, int SortOrder)>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT category_id, is_primary, sort_order
FROM product_category_map
WHERE product_tenant_code=@pt AND product_id=@pid AND category_tenant_code=@ct
ORDER BY is_primary DESC, sort_order ASC, category_id ASC;
";
        cmd.Parameters.AddWithValue("pt", productTenantCode);
        cmd.Parameters.AddWithValue("pid", productId);
        cmd.Parameters.AddWithValue("ct", categoryTenantCode);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add((reader.GetGuid(0), reader.GetBoolean(1), reader.GetInt32(2)));
        }

        return result;
    }

    public async Task<List<(Guid ProductId, Guid CategoryId, bool IsPrimary, int SortOrder)>> ListAllProductCategoryMapsAsync(
        string productTenantCode,
        string categoryTenantCode,
        CancellationToken cancellationToken)
    {
        productTenantCode = (productTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        categoryTenantCode = (categoryTenantCode ?? string.Empty).Trim().ToUpperInvariant();

        var result = new List<(Guid, Guid, bool, int)>();

        if (string.IsNullOrWhiteSpace(productTenantCode) || string.IsNullOrWhiteSpace(categoryTenantCode))
            return result;

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT product_id, category_id, is_primary, sort_order
FROM product_category_map
WHERE product_tenant_code=@pt AND category_tenant_code=@ct;
";
        cmd.Parameters.AddWithValue("pt", productTenantCode);
        cmd.Parameters.AddWithValue("ct", categoryTenantCode);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add((reader.GetGuid(0), reader.GetGuid(1), reader.GetBoolean(2), reader.GetInt32(3)));
        }

        return result;
    }

    public async Task<Dictionary<Guid, int>> GetCategoryProductCountsAsync(string tenantCode, bool onlyPublished, CancellationToken cancellationToken)
    {
        tenantCode = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        var result = new Dictionary<Guid, int>();

        var categories = await ListAsync(tenantCode, cancellationToken);
        var children = categories
            .Where(x => x.ParentId.HasValue)
            .GroupBy(x => x.ParentId!.Value)
            .ToDictionary(g => g.Key, g => g.ToList());

        var directProducts = new Dictionary<Guid, HashSet<Guid>>();

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        if (onlyPublished)
        {
            cmd.CommandText = @"
SELECT m.category_id, m.product_id
FROM product_category_map m
JOIN product_metadata pm ON pm.product_tenant_code = m.product_tenant_code AND pm.product_id = m.product_id
WHERE m.product_tenant_code = @tenant AND m.category_tenant_code = @tenant AND pm.status = 'Published';
";
        }
        else
        {
            cmd.CommandText = @"
SELECT category_id, product_id
FROM product_category_map
WHERE product_tenant_code = @tenant AND category_tenant_code = @tenant;
";
        }
        cmd.Parameters.AddWithValue("tenant", tenantCode);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var catId = reader.GetGuid(0);
            var prodId = reader.GetGuid(1);
            if (!directProducts.TryGetValue(catId, out var set))
            {
                set = new HashSet<Guid>();
                directProducts[catId] = set;
            }
            set.Add(prodId);
        }

        HashSet<Guid> GetProductsRecursive(Guid catId, HashSet<Guid> visited)
        {
            if (!visited.Add(catId))
            {
                return new HashSet<Guid>();
            }
            var set = new HashSet<Guid>();
            if (!visited.Add(catId))
            {
                return set;
            }
            if (directProducts.TryGetValue(catId, out var direct))
            {
                set.UnionWith(direct);
            }
            if (children.TryGetValue(catId, out var subs))
            {
                foreach (var sub in subs)
                {
                    set.UnionWith(GetProductsRecursive(sub.Id, visited));
                }
            }
            return set;
        }

        foreach (var cat in categories)
        {
            result[cat.Id] = GetProductsRecursive(cat.Id, new HashSet<Guid>()).Count;
        }

        return result;
    }

    private static string NormalizeSlug(string slug, string fallbackName)
    {
        var s = (slug ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(s)) s = fallbackName;
        s = (s ?? string.Empty).Trim().ToLowerInvariant();

        var sb = new StringBuilder();
        foreach (var ch in s)
        {
            var c = ch;
            if (c == 'ı') c = 'i';
            if (c == 'ğ') c = 'g';
            if (c == 'ü') c = 'u';
            if (c == 'ş') c = 's';
            if (c == 'ö') c = 'o';
            if (c == 'ç') c = 'c';

            if (char.IsLetterOrDigit(c))
            {
                sb.Append(c);
                continue;
            }

            if (c == ' ' || c == '_' || c == '-')
            {
                if (sb.Length > 0 && sb[^1] != '-') sb.Append('-');
            }
        }

        var outSlug = sb.ToString().Trim('-');
        return outSlug;
    }
}
