using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class StockController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly IConfiguration _configuration;

    public StockController(ApplicationDbContext context, IConfiguration configuration)
    {
        _context = context;
        _configuration = configuration;
    }

    /// <summary>
    /// Firma kodu → B2B veritabanı bağlantı dizesi. Eşleme SÜREÇ ÖMRÜ BOYUNCA önbelleklenir.
    ///
    /// <para>
    /// Öncesinde HER stok isteği önce `b2b_erp_master`a bağlanıp `Tenants` tablosundan
    /// `DbName` okuyordu: değişmeyen bir eşleme için istek başına fazladan bir bağlantı ve
    /// bir sorgu. Yoğun ekranlarda (stok arama her tuş vuruşunda) bu tek başına veritabanına
    /// giden istek sayısını ikiye katlıyordu.
    /// </para>
    ///
    /// <para>
    /// Yalnız BAŞARILI çözümleme önbelleğe alınır; hata yolundaki `b2b_erp` yedeği
    /// önbelleklenmez, yoksa geçici bir master arızası kalıcı olarak yanlış veritabanına
    /// çivilenirdi. Bir firmanın `DbName`i değişirse servisin yeniden başlatılması gerekir.
    /// </para>
    /// </summary>
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, string> _b2bConnStringByTenant =
        new(StringComparer.OrdinalIgnoreCase);

    private async Task<string?> GetB2BConnectionStringAsync(CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return null;

        var baseConn = _configuration.GetConnectionString("DefaultConnection")
                       ?? _configuration.GetConnectionString("ServiceOpsBase");
        if (string.IsNullOrWhiteSpace(baseConn)) return null;

        var cacheKey = tenantCode.Trim().ToLowerInvariant();
        if (_b2bConnStringByTenant.TryGetValue(cacheKey, out var cached))
        {
            return cached;
        }

        try
        {
            var masterBuilder = new NpgsqlConnectionStringBuilder(baseConn) { Database = "b2b_erp_master" };
            string? dbName = null;
            await using (var master = new NpgsqlConnection(masterBuilder.ConnectionString))
            {
                await master.OpenAsync(cancellationToken);
                await using var cmd = new NpgsqlCommand("SELECT \"DbName\" FROM public.\"Tenants\" WHERE LOWER(\"Code\") = @tenantCode LIMIT 1", master);
                cmd.Parameters.AddWithValue("tenantCode", cacheKey);
                dbName = await cmd.ExecuteScalarAsync(cancellationToken) as string;
            }

            var tenantBuilder = new NpgsqlConnectionStringBuilder(baseConn)
            {
                Database = string.IsNullOrWhiteSpace(dbName) ? "b2b_erp" : dbName
            };

            var resolved = tenantBuilder.ConnectionString;
            _b2bConnStringByTenant[cacheKey] = resolved;
            return resolved;
        }
        catch
        {
            var fallback = new NpgsqlConnectionStringBuilder(baseConn) { Database = "b2b_erp" };
            return fallback.ConnectionString;
        }
    }

    [HttpGet("categories")]
    public async Task<ActionResult<object>> GetCategories(CancellationToken cancellationToken)
    {
        var connStr = await GetB2BConnectionStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(connStr)) return BadRequest(new { success = false, message = "Veritabanı bağlantısı kurulamadı." });

        var categories = new List<object>();
        await using (var conn = new NpgsqlConnection(connStr))
        {
            await conn.OpenAsync(cancellationToken);
            var sql = "SELECT \"Id\", \"Name\" FROM public.\"ProductCategories\" WHERE \"IsActive\" = true AND \"ParentId\" IS NULL ORDER BY \"Name\" ASC";
            await using var cmd = new NpgsqlCommand(sql, conn);
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                categories.Add(new
                {
                    id = reader.GetGuid(0).ToString(),
                    name = reader.GetString(1)
                });
            }
        }

        return Ok(new { success = true, data = categories });
    }

    [HttpGet("summary")]
    public async Task<ActionResult<object>> GetSummary(CancellationToken cancellationToken)
    {
        var connStr = await GetB2BConnectionStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(connStr)) return BadRequest(new { success = false, message = "Veritabanı bağlantısı kurulamadı." });

        int totalProducts = 0;
        int totalSpareParts = 0;
        int criticalStock = 0;
        int outOfStock = 0;

        await using (var conn = new NpgsqlConnection(connStr))
        {
            await conn.OpenAsync(cancellationToken);

            // Total Products
            using (var cmd = new NpgsqlCommand("SELECT COUNT(*) FROM public.\"Products\" WHERE \"IsActive\" = true AND (\"ProductType\" IS NULL OR LOWER(\"ProductType\") = 'urun' OR LOWER(\"ProductType\") = 'ürün')", conn))
            {
                totalProducts = Convert.ToInt32(await cmd.ExecuteScalarAsync(cancellationToken));
            }

            // Total Spare Parts
            using (var cmd = new NpgsqlCommand("SELECT COUNT(*) FROM public.\"Products\" WHERE \"IsActive\" = true AND (LOWER(\"ProductType\") LIKE '%yedek%' OR LOWER(\"ProductType\") LIKE '%parca%' OR LOWER(\"ProductType\") LIKE '%parça%' OR LOWER(\"ProductType\") = 'yedek_parca')", conn))
            {
                totalSpareParts = Convert.ToInt32(await cmd.ExecuteScalarAsync(cancellationToken));
            }

            // Critical Stock (MinStock > 0 and Stock > 0 and Stock <= MinStock)
            using (var cmd = new NpgsqlCommand("SELECT COUNT(*) FROM public.\"Products\" WHERE \"IsActive\" = true AND (LOWER(\"ProductType\") LIKE '%yedek%' OR LOWER(\"ProductType\") LIKE '%parca%' OR LOWER(\"ProductType\") LIKE '%parça%' OR LOWER(\"ProductType\") = 'yedek_parca') AND \"MinStock\" > 0 AND \"Stock\" > 0 AND \"Stock\" <= \"MinStock\"", conn))
            {
                criticalStock = Convert.ToInt32(await cmd.ExecuteScalarAsync(cancellationToken));
            }

            // Out of Stock (Stock == 0)
            using (var cmd = new NpgsqlCommand("SELECT COUNT(*) FROM public.\"Products\" WHERE \"IsActive\" = true AND (LOWER(\"ProductType\") LIKE '%yedek%' OR LOWER(\"ProductType\") LIKE '%parca%' OR LOWER(\"ProductType\") LIKE '%parça%' OR LOWER(\"ProductType\") = 'yedek_parca') AND \"Stock\" = 0", conn))
            {
                outOfStock = Convert.ToInt32(await cmd.ExecuteScalarAsync(cancellationToken));
            }
        }

        return Ok(new
        {
            success = true,
            totalProducts,
            totalSpareParts,
            criticalStock,
            outOfStock
        });
    }

    [HttpGet("products")]
    public async Task<ActionResult<object>> GetProducts(
        [FromQuery] string? search,
        [FromQuery] string? categoryId,
        [FromQuery] string? stockStatus,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? sortBy = "name",
        [FromQuery] string? sortDirection = "asc",
        CancellationToken cancellationToken = default)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu eksik." });

        var connStr = await GetB2BConnectionStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(connStr)) return BadRequest(new { success = false, message = "Veritabanı bağlantısı kurulamadı." });

        page = page < 1 ? 1 : page;
        pageSize = pageSize < 1 ? 50 : pageSize;

        var items = new List<dynamic>();
        int totalCount = 0;

        await using (var conn = new NpgsqlConnection(connStr))
        {
            await conn.OpenAsync(cancellationToken);

            string baseCte = @"
                WITH CTE AS (
                    SELECT 
                        p.""Id"" AS ""ProductId"",
                        p.""StockCode"",
                        p.""Name"" AS ""ProductName"",
                        c.""Name"" AS ""CategoryName"",
                        c.""Id"" AS ""CategoryId"",
                        p.""ImageUrl"",
                        (SELECT COUNT(*) FROM public.""Products"" sp 
                         WHERE sp.""IsActive"" = true 
                           AND (LOWER(sp.""ProductType"") LIKE '%yedek%' OR LOWER(sp.""ProductType"") LIKE '%parca%' OR LOWER(sp.""ProductType"") LIKE '%parça%' OR LOWER(sp.""ProductType"") = 'yedek_parca')
                           AND sp.""Kod4"" = p.""StockCode"") AS ""SparePartCount"",
                        
                        CASE 
                            WHEN EXISTS (
                                SELECT 1 FROM public.""Products"" sp 
                                WHERE sp.""IsActive"" = true 
                                  AND (LOWER(sp.""ProductType"") LIKE '%yedek%' OR LOWER(sp.""ProductType"") LIKE '%parca%' OR LOWER(sp.""ProductType"") LIKE '%parça%' OR LOWER(sp.""ProductType"") = 'yedek_parca')
                                  AND sp.""Kod4"" = p.""StockCode""
                                  AND sp.""Stock"" = 0
                            ) THEN 'out'
                            
                            WHEN EXISTS (
                                SELECT 1 FROM public.""Products"" sp 
                                WHERE sp.""IsActive"" = true 
                                  AND (LOWER(sp.""ProductType"") LIKE '%yedek%' OR LOWER(sp.""ProductType"") LIKE '%parca%' OR LOWER(sp.""ProductType"") LIKE '%parça%' OR LOWER(sp.""ProductType"") = 'yedek_parca')
                                  AND sp.""Kod4"" = p.""StockCode""
                                  AND sp.""MinStock"" > 0 
                                  AND sp.""Stock"" > 0 
                                  AND sp.""Stock"" <= sp.""MinStock""
                            ) THEN 'critical'
                            
                            ELSE 'ok'
                        END AS ""StockStatus""
                    FROM public.""Products"" p
                    LEFT JOIN public.""ProductCategories"" c ON p.""MainCategoryId"" = c.""Id""
                    WHERE p.""IsActive"" = true 
                      AND (p.""ProductType"" IS NULL OR LOWER(p.""ProductType"") = 'urun' OR LOWER(p.""ProductType"") = 'ürün')
                )";

            var whereClauses = new List<string>();
            if (!string.IsNullOrWhiteSpace(search))
            {
                whereClauses.Add("(\"ProductName\" ILIKE @search OR \"StockCode\" ILIKE @search)");
            }
            if (Guid.TryParse(categoryId, out var catGuid))
            {
                whereClauses.Add("\"CategoryId\" = @categoryId");
            }
            if (!string.IsNullOrWhiteSpace(stockStatus))
            {
                whereClauses.Add("\"StockStatus\" = @stockStatus");
            }

            string whereSql = whereClauses.Count > 0 ? "WHERE " + string.Join(" AND ", whereClauses) : "";

            // 1. Get Count
            var countSql = $"{baseCte} SELECT COUNT(*) FROM CTE {whereSql}";
            await using (var cmd = new NpgsqlCommand(countSql, conn))
            {
                if (!string.IsNullOrWhiteSpace(search)) cmd.Parameters.AddWithValue("search", $"%{search.Trim()}%");
                if (catGuid != Guid.Empty) cmd.Parameters.AddWithValue("categoryId", catGuid);
                if (!string.IsNullOrWhiteSpace(stockStatus)) cmd.Parameters.AddWithValue("stockStatus", stockStatus.Trim());
                totalCount = Convert.ToInt32(await cmd.ExecuteScalarAsync(cancellationToken));
            }

            // 2. Get Data
            string orderClause = "p.\"Name\" ASC";
            if (!string.IsNullOrWhiteSpace(sortBy))
            {
                var dir = (sortDirection ?? "asc").Trim().ToLowerInvariant() == "desc" ? "DESC" : "ASC";
                orderClause = sortBy.Trim().ToLowerInvariant() switch
                {
                    "name" => $"\"ProductName\" {dir}",
                    "stockcode" => $"\"StockCode\" {dir}",
                    "categoryname" => $"\"CategoryName\" {dir}",
                    "sparepartcount" => $"\"SparePartCount\" {dir}",
                    "stockstatus" => $"\"StockStatus\" {dir}",
                    _ => $"\"ProductName\" {dir}"
                };
            }

            var dataSql = $"{baseCte} SELECT * FROM CTE {whereSql} ORDER BY {orderClause} LIMIT @pageSize OFFSET @offset";
            await using (var cmd = new NpgsqlCommand(dataSql, conn))
            {
                if (!string.IsNullOrWhiteSpace(search)) cmd.Parameters.AddWithValue("search", $"%{search.Trim()}%");
                if (catGuid != Guid.Empty) cmd.Parameters.AddWithValue("categoryId", catGuid);
                if (!string.IsNullOrWhiteSpace(stockStatus)) cmd.Parameters.AddWithValue("stockStatus", stockStatus.Trim());
                cmd.Parameters.AddWithValue("pageSize", pageSize);
                cmd.Parameters.AddWithValue("offset", (page - 1) * pageSize);

                await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    items.Add(new
                    {
                        productId = reader.GetGuid(0).ToString(),
                        stockCode = reader.IsDBNull(1) ? "" : reader.GetString(1),
                        productName = reader.GetString(2),
                        categoryName = reader.IsDBNull(3) ? "-" : reader.GetString(3),
                        imageUrl = reader.IsDBNull(5) ? null : reader.GetString(5),
                        sparePartCount = Convert.ToInt32(reader.GetValue(6)),
                        stockStatus = reader.GetString(7)
                    });
                }
            }
        }

        // Attach local exploded diagram URLs
        var stockCodes = items.Select(x => (string)x.stockCode).ToList();
        var localDiagrams = await _context.ExplodedDiagrams
            .AsNoTracking()
            .Where(d => d.IsActive && d.TenantCode == tenantCode && stockCodes.Contains(d.Product.StockCode))
            .OrderByDescending(d => d.UploadedAt)
            .Select(d => new { d.Id, d.Product.StockCode })
            .ToListAsync(cancellationToken);

        var diagramMap = localDiagrams
            .Where(d => d.StockCode != null)
            .GroupBy(d => d.StockCode!)
            .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);

        var finalItems = items.Select(x => new
        {
            x.productId,
            x.stockCode,
            x.productName,
            x.categoryName,
            x.imageUrl,
            x.sparePartCount,
            x.stockStatus,
            explodedDiagramUrl = diagramMap.ContainsKey(x.stockCode) 
                ? $"/api/serviceproducts/diagram/{diagramMap[x.stockCode]}" 
                : null
        }).ToList();

        var totalPages = (int)Math.Ceiling((double)totalCount / pageSize);

        return Ok(new
        {
            success = true,
            items = finalItems,
            totalCount,
            totalPages,
            currentPage = page,
            pageSize
        });
    }

    [HttpGet("products/{id:guid}")]
    public async Task<ActionResult<object>> GetProductDetail(Guid id, CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu eksik." });

        var connStr = await GetB2BConnectionStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(connStr)) return BadRequest(new { success = false, message = "Veritabanı bağlantısı kurulamadı." });

        object? product = null;
        await using (var conn = new NpgsqlConnection(connStr))
        {
            await conn.OpenAsync(cancellationToken);
            var sql = @"
                SELECT 
                    p.""Id"", 
                    p.""StockCode"", 
                    p.""Name"", 
                    c.""Name"" AS ""CategoryName"", 
                    p.""ImageUrl"", 
                    p.""Description""
                FROM public.""Products"" p
                LEFT JOIN public.""ProductCategories"" c ON p.""MainCategoryId"" = c.""Id""
                WHERE p.""Id"" = @id AND p.""IsActive"" = true LIMIT 1";
            
            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("id", id);
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                var stockCode = reader.IsDBNull(1) ? null : reader.GetString(1);
                var name = reader.GetString(2);
                var categoryName = reader.IsDBNull(3) ? null : reader.GetString(3);
                var imageUrl = reader.IsDBNull(4) ? null : reader.GetString(4);
                var description = reader.IsDBNull(5) ? null : reader.GetString(5);

                product = new
                {
                    id = id.ToString(),
                    stockCode,
                    name,
                    categoryName,
                    imageUrl,
                    description
                };
            }
        }

        if (product == null) return NotFound(new { success = false, message = "Ürün bulunamadı." });

        // Match local exploded diagram
        string? explodedDiagramUrl = null;
        var pDto = (dynamic)product;
        string? sCode = pDto.stockCode;
        if (!string.IsNullOrWhiteSpace(sCode))
        {
            var diagId = await _context.ExplodedDiagrams
                .AsNoTracking()
                .Where(d => d.IsActive && d.TenantCode == tenantCode && d.Product.StockCode == sCode.Trim())
                .OrderByDescending(d => d.UploadedAt)
                .Select(d => (Guid?)d.Id)
                .FirstOrDefaultAsync(cancellationToken);
            if (diagId.HasValue)
            {
                explodedDiagramUrl = $"/api/serviceproducts/diagram/{diagId.Value}";
            }
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                pDto.id,
                pDto.stockCode,
                pDto.name,
                pDto.categoryName,
                pDto.imageUrl,
                pDto.description,
                explodedDiagramUrl
            }
        });
    }

    [HttpGet("products/{id:guid}/spare-parts")]
    public async Task<ActionResult<object>> GetProductSpareParts(Guid id, CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu eksik." });

        var connStr = await GetB2BConnectionStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(connStr)) return BadRequest(new { success = false, message = "Veritabanı bağlantısı kurulamadı." });

        string? parentStockCode = null;
        await using (var conn = new NpgsqlConnection(connStr))
        {
            await conn.OpenAsync(cancellationToken);
            await using (var cmd = new NpgsqlCommand("SELECT \"StockCode\" FROM public.\"Products\" WHERE \"Id\" = @id LIMIT 1", conn))
            {
                cmd.Parameters.AddWithValue("id", id);
                parentStockCode = await cmd.ExecuteScalarAsync(cancellationToken) as string;
            }
        }

        if (string.IsNullOrWhiteSpace(parentStockCode))
        {
            return Ok(new { success = true, data = new List<object>() });
        }

        var spareParts = new List<object>();
        await using (var conn = new NpgsqlConnection(connStr))
        {
            await conn.OpenAsync(cancellationToken);
            var sql = @"
                SELECT 
                    p.""Id"", 
                    p.""Name"", 
                    p.""StockCode"" AS ""PartNumber"", 
                    p.""Stock"" AS ""Quantity"", 
                    p.""MinStock"" AS ""MinStockLevel"", 
                    p.""Kod4"", 
                    p.""Kod5"", 
                    p.""ImageUrl""
                FROM public.""Products"" p
                WHERE p.""IsActive"" = true 
                  AND (LOWER(p.""ProductType"") LIKE '%yedek%' OR LOWER(p.""ProductType"") LIKE '%parca%' OR LOWER(p.""ProductType"") LIKE '%parça%' OR LOWER(p.""ProductType"") = 'yedek_parca')
                  AND p.""Kod4"" = @parentStockCode
                ORDER BY p.""Name"" ASC";
            
            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("parentStockCode", parentStockCode.Trim());
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var pId = reader.GetGuid(0);
                var name = reader.GetString(1);
                var partNumber = reader.IsDBNull(2) ? null : reader.GetString(2);
                var quantity = reader.GetInt32(3);
                var minStockLevel = reader.GetInt32(4);
                var kod4 = reader.IsDBNull(5) ? null : reader.GetString(5);
                var kod5 = reader.IsDBNull(6) ? null : reader.GetString(6);
                var imageUrl = reader.IsDBNull(7) ? null : reader.GetString(7);

                var explodedNumber = "";
                if (!string.IsNullOrWhiteSpace(kod5) && !kod5.Contains(":") && kod5.Length < 10)
                {
                    explodedNumber = kod5.Trim();
                }

                spareParts.Add(new
                {
                    id = pId.ToString(),
                    name,
                    partNumber,
                    quantity,
                    minStockLevel,
                    explodedViewPartNumber = explodedNumber,
                    imageUrl
                });
            }
        }

        return Ok(new { success = true, data = spareParts });
    }

    [HttpGet("items")]
    public async Task<ActionResult<object>> GetStockItems([FromQuery] string? q)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var queryProducts = _context.ServiceProducts
            .Where(p => p.IsActive && p.TenantCode == tenantCode)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(q))
        {
            var s = q.Trim();
            queryProducts = queryProducts.Where(p => p.Name.Contains(s) || (p.StockCode != null && p.StockCode.Contains(s)));
        }

        var diagramMap = await _context.ExplodedDiagrams
            .Where(d => d.IsActive && d.TenantCode == tenantCode)
            .GroupBy(d => d.ProductId)
            .Select(g => new { ProductId = g.Key, DiagramId = g.OrderBy(d => d.UploadedAt).Select(d => d.Id).FirstOrDefault() })
            .ToDictionaryAsync(x => x.ProductId, x => x.DiagramId);

        var products = await queryProducts
            .OrderBy(p => p.Name)
            .Select(p => new
            {
                type = "Product",
                id = p.Id,
                productId = p.Id,
                productName = p.Name,
                name = p.Name,
                partNumber = p.StockCode,
                quantity = (int?)null,
                minStockLevel = (int?)null,
                explodedViewPartNumber = (string?)null
            })
            .ToListAsync();

        var productsWithDiagram = products.Select(p => new
        {
            p.type,
            id = p.id.ToString(),
            productId = p.productId.ToString(),
            p.productName,
            p.name,
            p.partNumber,
            p.quantity,
            p.minStockLevel,
            p.explodedViewPartNumber,
            explodedDiagramUrl = diagramMap.ContainsKey(p.id)
                ? $"/api/serviceproducts/diagram/{diagramMap[p.id]}"
                : (string?)null
        }).ToList();

        var queryParts = _context.SpareParts
            .Where(s => s.IsActive && s.TenantCode == tenantCode)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(q))
        {
            var s = q.Trim();
            queryParts = queryParts.Where(p => p.Name.Contains(s) || (p.PartNumber != null && p.PartNumber.Contains(s)));
        }

        var parts = await queryParts
            .Join(
                _context.ServiceProducts.Where(p => p.IsActive && p.TenantCode == tenantCode),
                sp => sp.ProductId,
                p => p.Id,
                (sp, p) => new { sp, p })
            .OrderBy(x => x.p.Name)
            .ThenBy(x => x.sp.Name)
            .Select(x => new
            {
                type = "SparePart",
                id = x.sp.Id.ToString(),
                productId = x.p.Id.ToString(),
                productName = x.p.Name,
                name = x.sp.Name,
                partNumber = x.sp.PartNumber,
                quantity = (int?)x.sp.StockQuantity,
                minStockLevel = (int?)x.sp.MinStockLevel,
                explodedViewPartNumber = x.sp.ExplodedViewPartNumber,
                explodedDiagramUrl = (string?)null
            })
            .ToListAsync();

        return Ok(new { success = true, data = productsWithDiagram.Concat<object>(parts) });
    }

    private string GetTenantCode()
    {
        // Jetondaki firma kodu iki yazımla gelebiliyor (bkz. SparePartsController/TechniciansController).
        return User?.FindFirst("TenantCode")?.Value
               ?? User?.FindFirst("tenantCode")?.Value
               ?? User?.FindFirst("tenant")?.Value
               ?? Request.Headers["X-Tenant-Code"].FirstOrDefault()
               ?? string.Empty;
    }
}
