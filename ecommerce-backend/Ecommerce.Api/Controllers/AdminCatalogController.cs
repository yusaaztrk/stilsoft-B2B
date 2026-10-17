using System.Globalization;
using System.Text;
using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/catalog")]
[Authorize(Roles = "Owner,Admin")]
public sealed class AdminCatalogController : ControllerBase
{
    private readonly string _connStr;

    public AdminCatalogController(IConfiguration config)
    {
        _connStr = config.GetConnectionString("EcommerceDb") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(_connStr))
            throw new InvalidOperationException("ConnectionStrings:EcommerceDb must be configured.");
    }

    [HttpGet("export")]
    public async Task<IActionResult> ExportCsv(CancellationToken cancellationToken)
    {
        var sb = new StringBuilder();
        // Write header
        sb.AppendLine("tenant_code,erp_product_id,stock_code,name,original_price,override_price,stock,category_id,category_name,is_active");

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT 
  p.tenant_code,
  p.erp_product_id,
  p.stock_code,
  p.name,
  p.unit_price,
  ps.override_price,
  p.stock,
  pcm.category_id,
  cat.name AS category_name,
  p.is_active
FROM products p
LEFT JOIN product_settings ps ON ps.tenant_code = p.tenant_code AND ps.product_id = p.erp_product_id
LEFT JOIN product_category_map pcm ON pcm.product_tenant_code = p.tenant_code AND pcm.product_id = p.erp_product_id AND pcm.is_primary = TRUE
LEFT JOIN categories cat ON cat.tenant_code = pcm.category_tenant_code AND cat.id = pcm.category_id
ORDER BY p.tenant_code, p.name;
";

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var tenantCode = reader.GetString(0);
            var productId = reader.GetGuid(1);
            var stockCode = reader.IsDBNull(2) ? "" : reader.GetString(2);
            var name = reader.IsDBNull(3) ? "" : reader.GetString(3);
            var originalPrice = reader.IsDBNull(4) ? 0m : reader.GetDecimal(4);
            var overridePrice = reader.IsDBNull(5) ? (decimal?)null : reader.GetDecimal(5);
            var stock = reader.IsDBNull(6) ? 0 : reader.GetInt32(6);
            var categoryId = reader.IsDBNull(7) ? "" : reader.GetGuid(7).ToString();
            var categoryName = reader.IsDBNull(8) ? "" : reader.GetString(8);
            var isActive = reader.IsDBNull(9) ? false : reader.GetBoolean(9);

            // Escape fields for CSV if they contain quotes or commas
            var escapedName = EscapeCsv(name);
            var escapedStockCode = EscapeCsv(stockCode);
            var escapedCategoryName = EscapeCsv(categoryName);

            var overridePriceStr = overridePrice.HasValue ? overridePrice.Value.ToString(CultureInfo.InvariantCulture) : "";
            var originalPriceStr = originalPrice.ToString(CultureInfo.InvariantCulture);

            sb.AppendLine($"{tenantCode},{productId},{escapedStockCode},{escapedName},{originalPriceStr},{overridePriceStr},{stock},{categoryId},{escapedCategoryName},{isActive}");
        }

        var csvBytes = Encoding.UTF8.GetBytes(sb.ToString());
        return File(csvBytes, "text/csv", "catalog_export.csv");
    }

    [HttpPost("import")]
    public async Task<IActionResult> ImportCsv([FromForm] IFormFile file, CancellationToken cancellationToken)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { success = false, message = "Lütfen geçerli bir CSV dosyası yükleyin." });

        using var stream = file.OpenReadStream();
        using var reader = new StreamReader(stream, Encoding.UTF8);

        var headerLine = await reader.ReadLineAsync(cancellationToken);
        if (headerLine == null)
            return BadRequest(new { success = false, message = "Dosya boş." });

        var headers = headerLine.Split(',').Select(h => h.Trim().ToLowerInvariant()).ToList();
        int idxTenant = headers.indexOfName("tenant_code");
        int idxId = headers.indexOfName("erp_product_id");
        int idxOverridePrice = headers.indexOfName("override_price");
        int idxStock = headers.indexOfName("stock");
        int idxCategoryId = headers.indexOfName("category_id");

        if (idxTenant == -1 || idxId == -1)
        {
            return BadRequest(new { success = false, message = "CSV dosyası 'tenant_code' ve 'erp_product_id' sütunlarını içermelidir." });
        }

        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync(cancellationToken);
        await using var tx = await conn.BeginTransactionAsync(cancellationToken);

        int updatedCount = 0;
        int lineNumber = 1;

        try
        {
            while (!reader.EndOfStream)
            {
                var line = await reader.ReadLineAsync(cancellationToken);
                lineNumber++;
                if (string.IsNullOrWhiteSpace(line)) continue;

                var fields = ParseCsvLine(line);
                if (fields.Count <= Math.Max(idxTenant, idxId)) continue;

                var tenantCode = fields[idxTenant].Trim().ToUpperInvariant();
                var productIdStr = fields[idxId].Trim();

                if (!Guid.TryParse(productIdStr, out var productId))
                {
                    continue; // Skip invalid UUIDs
                }

                // Update override price if column exists
                if (idxOverridePrice != -1 && idxOverridePrice < fields.Count)
                {
                    var priceStr = fields[idxOverridePrice].Trim();
                    decimal? overridePrice = null;
                    if (!string.IsNullOrWhiteSpace(priceStr) && decimal.TryParse(priceStr, NumberStyles.Any, CultureInfo.InvariantCulture, out var priceVal))
                    {
                        overridePrice = priceVal;
                    }

                    await using var cmdPrice = conn.CreateCommand();
                    cmdPrice.Transaction = tx;
                    cmdPrice.CommandText = @"
INSERT INTO product_settings (tenant_code, product_id, is_featured, override_price, override_currency, updated_at_utc)
VALUES (@tenant, @id, FALSE, @price, 'TRY', (now() AT TIME ZONE 'utc'))
ON CONFLICT (tenant_code, product_id) DO UPDATE SET
  override_price = EXCLUDED.override_price,
  updated_at_utc = EXCLUDED.updated_at_utc;
";
                    cmdPrice.Parameters.AddWithValue("tenant", tenantCode);
                    cmdPrice.Parameters.AddWithValue("id", productId);
                    cmdPrice.Parameters.AddWithValue("price", (object?)overridePrice ?? DBNull.Value);
                    await cmdPrice.ExecuteNonQueryAsync(cancellationToken);
                }

                // Update stock if column exists
                if (idxStock != -1 && idxStock < fields.Count)
                {
                    var stockStr = fields[idxStock].Trim();
                    if (int.TryParse(stockStr, out var stockVal))
                    {
                        await using var cmdStock = conn.CreateCommand();
                        cmdStock.Transaction = tx;
                        cmdStock.CommandText = @"
UPDATE products 
SET stock = @stock, updated_at_utc = (now() AT TIME ZONE 'utc')
WHERE tenant_code = @tenant AND erp_product_id = @id;
";
                        cmdStock.Parameters.AddWithValue("tenant", tenantCode);
                        cmdStock.Parameters.AddWithValue("id", productId);
                        cmdStock.Parameters.AddWithValue("stock", stockVal);
                        await cmdStock.ExecuteNonQueryAsync(cancellationToken);
                    }
                }

                // Update Category Mapping if column exists
                if (idxCategoryId != -1 && idxCategoryId < fields.Count)
                {
                    var catIdStr = fields[idxCategoryId].Trim();
                    if (Guid.TryParse(catIdStr, out var categoryId) && categoryId != Guid.Empty)
                    {
                        // 1. Clear existing primary categories for this product
                        await using var cmdClearCat = conn.CreateCommand();
                        cmdClearCat.Transaction = tx;
                        cmdClearCat.CommandText = @"
UPDATE product_category_map 
SET is_primary = FALSE 
WHERE product_tenant_code = @tenant AND product_id = @id;
";
                        cmdClearCat.Parameters.AddWithValue("tenant", tenantCode);
                        cmdClearCat.Parameters.AddWithValue("id", productId);
                        await cmdClearCat.ExecuteNonQueryAsync(cancellationToken);

                        // 2. Insert or update category mapping
                        await using var cmdMapCat = conn.CreateCommand();
                        cmdMapCat.Transaction = tx;
                        cmdMapCat.CommandText = @"
INSERT INTO product_category_map (product_tenant_code, product_id, category_tenant_code, category_id, is_primary, sort_order, created_at_utc)
VALUES (@tenant, @id, 'DEMO', @category_id, TRUE, 0, (now() AT TIME ZONE 'utc'))
ON CONFLICT (product_tenant_code, product_id, category_tenant_code, category_id) DO UPDATE SET
  is_primary = TRUE;
";
                        cmdMapCat.Parameters.AddWithValue("tenant", tenantCode);
                        cmdMapCat.Parameters.AddWithValue("id", productId);
                        cmdMapCat.Parameters.AddWithValue("category_id", categoryId);
                        await cmdMapCat.ExecuteNonQueryAsync(cancellationToken);
                    }
                    else if (string.IsNullOrWhiteSpace(catIdStr))
                    {
                        // If empty, clear category mapping
                        await using var cmdClearCat = conn.CreateCommand();
                        cmdClearCat.Transaction = tx;
                        cmdClearCat.CommandText = @"
DELETE FROM product_category_map 
WHERE product_tenant_code = @tenant AND product_id = @id;
";
                        cmdClearCat.Parameters.AddWithValue("tenant", tenantCode);
                        cmdClearCat.Parameters.AddWithValue("id", productId);
                        await cmdClearCat.ExecuteNonQueryAsync(cancellationToken);
                    }
                }

                updatedCount++;
            }

            await tx.CommitAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync(cancellationToken);
            return StatusCode(500, new { success = false, message = $"CSV işlenirken hata oluştu (Satır {lineNumber}): {ex.Message}" });
        }

        return Ok(new { success = true, message = $"{updatedCount} ürün başarıyla güncellendi." });
    }

    private static string EscapeCsv(string val)
    {
        if (string.IsNullOrEmpty(val)) return "";
        if (val.Contains(",") || val.Contains("\"") || val.Contains("\n") || val.Contains("\r"))
        {
            return "\"" + val.Replace("\"", "\"\"") + "\"";
        }
        return val;
    }

    private static List<string> ParseCsvLine(string line)
    {
        var result = new List<string>();
        var currentField = new StringBuilder();
        bool inQuotes = false;

        for (int i = 0; i < line.Length; i++)
        {
            char c = line[i];
            if (c == '"')
            {
                if (inQuotes && i + 1 < line.Length && line[i + 1] == '"')
                {
                    currentField.Append('"');
                    i++; // skip next quote
                }
                else
                {
                    inQuotes = !inQuotes;
                }
            }
            else if (c == ',' && !inQuotes)
            {
                result.Add(currentField.ToString());
                currentField.Clear();
            }
            else
            {
                currentField.Append(c);
            }
        }
        result.Add(currentField.ToString());
        return result;
    }
}

public static class ListExtensions
{
    public static int indexOfName(this List<string> list, string name)
    {
        for (int i = 0; i < list.Count; i++)
        {
            if (list[i].Trim().Equals(name, StringComparison.OrdinalIgnoreCase))
                return i;
        }
        return -1;
    }
}
