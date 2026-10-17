using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.ProductPrices;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/product-prices")]
// There is no global fallback authorization policy, so a controller without [Authorize]
// is reachable anonymously. These endpoints read and rewrite pricing.
[Authorize]
public sealed class ProductPricesController : ControllerBase
{
    // DESTEKLENEN PARA BİRİMLERİ (2026-08-14).
    // Önceki desen `^[A-Z]{2,3}$` idi: "XXX", "ZZ", "JPY" gibi kur karşılığı OLMAYAN her kodu
    // kabul ediyordu. Böyle bir fiyat kaydedilir ama kura çevrilemez — fatura kesilirken
    // sessizce 1 kuruna düşer. Sistem dört para birimi destekliyor, doğrulama da onu yansıtmalı.
    private static readonly Regex CurrencyRegex = new("^(TL|TRY|USD|EUR|GBP)$", RegexOptions.Compiled);

    private readonly AppDbContext _dbContext;

    public ProductPricesController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet("by-products")]
    [ProducesResponseType(typeof(List<ProductPriceResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<ProductPriceResponse>>> GetByProducts([FromQuery] string productIds, CancellationToken cancellationToken)
    {
        var ids = ParseGuids(productIds);
        if (ids.Count == 0)
        {
            return Ok(new List<ProductPriceResponse>());
        }

        var prices = await _dbContext.ProductPrices
            .AsNoTracking()
            .Where(x => ids.Contains(x.ProductId))
            .ToListAsync(cancellationToken);

        return Ok(prices.Select(ToResponse).ToList());
    }

    [HttpPost("by-products")]
    [ProducesResponseType(typeof(List<ProductPriceResponse>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<ProductPriceResponse>>> GetByProductsPost([FromBody] List<Guid> productIds, CancellationToken cancellationToken)
    {
        if (productIds == null || productIds.Count == 0)
        {
            return Ok(new List<ProductPriceResponse>());
        }

        var prices = await _dbContext.ProductPrices
            .AsNoTracking()
            .Where(x => productIds.Contains(x.ProductId))
            .ToListAsync(cancellationToken);

        return Ok(prices.Select(ToResponse).ToList());
    }

    [HttpGet("{id:guid}")]
    [ProducesResponseType(typeof(ProductPriceResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProductPriceResponse>> GetById(Guid id, CancellationToken cancellationToken)
    {
        var productPrice = await _dbContext.ProductPrices
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (productPrice is null)
        {
            return NotFound();
        }

        return Ok(ToResponse(productPrice));
    }

    [AuthorizePage("users", "atiliFiyatlandirma")]
    [HttpPost]
    [ProducesResponseType(typeof(ProductPriceResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<ProductPriceResponse>> Create(CreateProductPriceRequest request, CancellationToken cancellationToken)
    {
        if (request.Price <= 0)
        {
            ModelState.AddModelError(nameof(request.Price), "Price must be greater than 0.");
        }

        var currency = NormalizeCurrency(request.Currency);
        if (currency is null)
        {
            ModelState.AddModelError(nameof(request.Currency), "Para birimi TL, USD, EUR veya GBP olmalıdır.");
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var productExists = await _dbContext.Products
            .AsNoTracking()
            .AnyAsync(x => x.Id == request.ProductId, cancellationToken);

        if (!productExists)
        {
            ModelState.AddModelError(nameof(request.ProductId), "ProductId is invalid.");
            return ValidationProblem(ModelState);
        }

        var priceGroupExists = await _dbContext.PriceGroups
            .AsNoTracking()
            .AnyAsync(x => x.Id == request.PriceGroupId, cancellationToken);

        if (!priceGroupExists)
        {
            ModelState.AddModelError(nameof(request.PriceGroupId), "PriceGroupId is invalid.");
            return ValidationProblem(ModelState);
        }

        var duplicateExists = await _dbContext.ProductPrices
            .AsNoTracking()
            .AnyAsync(x => x.ProductId == request.ProductId && x.PriceGroupId == request.PriceGroupId, cancellationToken);

        if (duplicateExists)
        {
            ModelState.AddModelError(nameof(request.PriceGroupId), "A price already exists for the given ProductId and PriceGroupId.");
            return ValidationProblem(ModelState);
        }

        var productPrice = new ProductPrice
        {
            Id = Guid.NewGuid(),
            ProductId = request.ProductId,
            PriceGroupId = request.PriceGroupId,
            Price = request.Price,
            Currency = currency!
        };

        _dbContext.ProductPrices.Add(productPrice);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var response = ToResponse(productPrice);
        return CreatedAtAction(nameof(GetById), new { id = response.Id }, response);
    }

    [AuthorizePage("users", "atiliFiyatlandirma")]
    [HttpPost("upsert")]
    [ProducesResponseType(typeof(ProductPriceResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<ProductPriceResponse>> Upsert(CreateProductPriceRequest request, CancellationToken cancellationToken)
    {
        if (request.Price <= 0)
        {
            ModelState.AddModelError(nameof(request.Price), "Price must be greater than 0.");
        }

        var currency = NormalizeCurrency(request.Currency);
        if (currency is null)
        {
            ModelState.AddModelError(nameof(request.Currency), "Para birimi TL, USD, EUR veya GBP olmalıdır.");
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var productExists = await _dbContext.Products
            .AsNoTracking()
            .AnyAsync(x => x.Id == request.ProductId, cancellationToken);

        if (!productExists)
        {
            ModelState.AddModelError(nameof(request.ProductId), "ProductId is invalid.");
            return ValidationProblem(ModelState);
        }

        var priceGroupExists = await _dbContext.PriceGroups
            .AsNoTracking()
            .AnyAsync(x => x.Id == request.PriceGroupId, cancellationToken);

        if (!priceGroupExists)
        {
            ModelState.AddModelError(nameof(request.PriceGroupId), "PriceGroupId is invalid.");
            return ValidationProblem(ModelState);
        }

        var existing = await _dbContext.ProductPrices
            .FirstOrDefaultAsync(x => x.ProductId == request.ProductId && x.PriceGroupId == request.PriceGroupId, cancellationToken);

        if (existing is null)
        {
            var created = new ProductPrice
            {
                Id = Guid.NewGuid(),
                ProductId = request.ProductId,
                PriceGroupId = request.PriceGroupId,
                Price = request.Price,
                Currency = currency!
            };

            _dbContext.ProductPrices.Add(created);
            await _dbContext.SaveChangesAsync(cancellationToken);
            return Ok(ToResponse(created));
        }

        existing.Price = request.Price;
        existing.Currency = currency!;
        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(ToResponse(existing));
    }

    /// <summary>
    /// Birden çok fiyat satırını TEK istekte yazar — "Fiyat 4'e Göre Toplu Güncelle" için.
    ///
    /// <para>
    /// Neden <c>import</c> kullanılmıyor: orası mevcut satırı (ürün, grup, <b>döviz</b>)
    /// üçlüsüyle eşliyor. Ekrandan gelen döviz kodu kayıttakinden farklı yazılırsa
    /// ("TL" ↔ "TRY") güncelleme yerine İKİNCİ BİR SATIR açılır ve ürünün o grupta iki
    /// fiyatı olur. Burası <c>upsert</c> ile aynı kuralı kullanır: eşleşme yalnız
    /// (ürün, grup) üzerinden, döviz sadece yazılır.
    /// </para>
    ///
    /// <para>
    /// Fiyat gerçekten değiştiyse <c>ProductPriceHistories</c>'e satır düşer; toplu bir
    /// işlemin "neyi neye çevirdiği" sonradan okunabilsin diye. Değişmeyen satır için
    /// geçmiş yazılmaz, yoksa her çalıştırma defteri şişirirdi.
    /// </para>
    /// </summary>
    [AuthorizePage("users", "atiliFiyatlandirma")]
    [HttpPost("bulk-upsert")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> BulkUpsert([FromBody] BulkUpsertProductPricesRequest request, CancellationToken cancellationToken)
    {
        var rows = request?.Rows ?? new List<BulkUpsertProductPriceRow>();
        if (rows.Count == 0)
        {
            return Ok(new { success = true, data = new { total = 0, created = 0, updated = 0, unchanged = 0, failed = 0 } });
        }

        // Tek üründe bir grup iki kez gelirse SONUNCUSU geçerli olur; aksi halde aynı satıra
        // iki kez yazıp hangisinin kaldığı çağrı sırasına kalırdı.
        var normalized = rows
            .Where(r => r.ProductId != Guid.Empty && r.PriceGroupId != Guid.Empty)
            .GroupBy(r => new { r.ProductId, r.PriceGroupId })
            .Select(g => g.Last())
            .ToList();

        var invalid = normalized.Count(r => r.Price <= 0m || NormalizeCurrency(r.Currency) is null);
        var valid = normalized
            .Where(r => r.Price > 0m && NormalizeCurrency(r.Currency) is not null)
            .ToList();

        if (valid.Count == 0)
        {
            return Ok(new { success = true, data = new { total = rows.Count, created = 0, updated = 0, unchanged = 0, failed = invalid } });
        }

        var productIds = valid.Select(x => x.ProductId).Distinct().ToList();
        var groupIds = valid.Select(x => x.PriceGroupId).Distinct().ToList();

        var knownProducts = await _dbContext.Products
            .AsNoTracking()
            .Where(x => productIds.Contains(x.Id))
            .Select(x => new { x.Id, x.StockCode })
            .ToDictionaryAsync(x => x.Id, x => x.StockCode, cancellationToken);

        var knownGroups = await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(x => groupIds.Contains(x.Id))
            .Select(x => new { x.Id, x.Code })
            .ToDictionaryAsync(x => x.Id, x => x.Code, cancellationToken);

        var existing = await _dbContext.ProductPrices
            .Where(x => productIds.Contains(x.ProductId) && groupIds.Contains(x.PriceGroupId))
            .ToListAsync(cancellationToken);

        var existingIndex = existing.ToDictionary(x => (x.ProductId, x.PriceGroupId), x => x);

        var username = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;
        var created = 0;
        var updated = 0;
        var unchanged = 0;
        var failed = invalid;

        foreach (var r in valid)
        {
            if (!knownProducts.TryGetValue(r.ProductId, out var stockCode) || !knownGroups.TryGetValue(r.PriceGroupId, out var groupCode))
            {
                failed++;
                continue;
            }

            var currency = NormalizeCurrency(r.Currency)!;
            var price = Math.Round(r.Price, 2, MidpointRounding.AwayFromZero);

            if (existingIndex.TryGetValue((r.ProductId, r.PriceGroupId), out var pp))
            {
                if (pp.Price == price && string.Equals(pp.Currency, currency, StringComparison.OrdinalIgnoreCase))
                {
                    unchanged++;
                    continue;
                }

                if (pp.Price != price)
                {
                    _dbContext.Set<ProductPriceHistory>().Add(new ProductPriceHistory
                    {
                        Id = Guid.NewGuid(),
                        ProductId = r.ProductId,
                        StockCode = stockCode ?? string.Empty,
                        PriceGroupCode = groupCode,
                        OldPrice = pp.Price,
                        NewPrice = price,
                        ChangeRate = pp.Price > 0m ? (price - pp.Price) / pp.Price : null,
                        ChangedAt = now,
                        ChangedBy = username,
                        Source = "Fiyat4TopluGuncelleme"
                    });
                }

                pp.Price = price;
                pp.Currency = currency;
                updated++;
            }
            else
            {
                _dbContext.ProductPrices.Add(new ProductPrice
                {
                    Id = Guid.NewGuid(),
                    ProductId = r.ProductId,
                    PriceGroupId = r.PriceGroupId,
                    Price = price,
                    Currency = currency
                });
                created++;
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, data = new { total = rows.Count, created, updated, unchanged, failed } });
    }

    [AuthorizePage("users", "atiliFiyatlandirma")]
    [HttpPost("import")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Import([FromBody] ImportProductPricesRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var rows = request.Rows ?? new List<ImportProductPriceRow>();
        if (rows.Count == 0)
        {
            return Ok(new { success = true, data = new { total = 0, created = 0, updated = 0, failed = 0, errors = Array.Empty<object>() } });
        }

        var errors = new List<object>();

        var normalizedRows = rows
            .Select((r, idx) => new
            {
                index = idx,
                stockCode = (r.StockCode ?? string.Empty).Trim(),
                priceGroupCode = r.PriceGroupCode,
                price = r.Price,
                currency = string.IsNullOrWhiteSpace(r.Currency) ? "TL" : r.Currency!.Trim().ToUpperInvariant()
            })
            .ToList();

        foreach (var r in normalizedRows)
        {
            if (string.IsNullOrWhiteSpace(r.stockCode))
            {
                errors.Add(new { index = r.index, stockCode = r.stockCode, message = "StockCode boş olamaz" });
            }
            if (r.priceGroupCode <= 0)
            {
                errors.Add(new { index = r.index, stockCode = r.stockCode, priceGroupCode = r.priceGroupCode, message = "PriceGroupCode 0 dan büyük olmalıdır" });
            }
            if (r.price <= 0)
            {
                errors.Add(new { index = r.index, stockCode = r.stockCode, priceGroupCode = r.priceGroupCode, message = "Price 0 dan büyük olmalıdır" });
            }
            if (NormalizeCurrency(r.currency) is null)
            {
                errors.Add(new { index = r.index, stockCode = r.stockCode, priceGroupCode = r.priceGroupCode, message = "Currency geçersiz (ör: TL, USD, EUR)" });
            }
        }

        var wantedStockCodes = normalizedRows
            .Select(x => x.stockCode)
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var wantedGroupCodes = normalizedRows
            .Select(x => x.priceGroupCode)
            .Where(x => x > 0)
            .Distinct()
            .ToList();

        var products = await _dbContext.Products
            .AsNoTracking()
            .Where(x => wantedStockCodes.Contains(x.StockCode))
            .Select(x => new { x.Id, x.StockCode })
            .ToListAsync(cancellationToken);

        var productIdByStockCode = products
            .GroupBy(x => x.StockCode, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);

        var groups = await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(x => wantedGroupCodes.Contains(x.Code))
            .Select(x => new { x.Id, x.Code })
            .ToListAsync(cancellationToken);

        var groupIdByCode = groups.ToDictionary(x => x.Code, x => x.Id);

        foreach (var r in normalizedRows)
        {
            if (string.IsNullOrWhiteSpace(r.stockCode)) continue;
            if (r.priceGroupCode <= 0) continue;
            if (r.price <= 0) continue;

            if (!productIdByStockCode.ContainsKey(r.stockCode))
            {
                errors.Add(new { index = r.index, stockCode = r.stockCode, message = $"Ürün bulunamadı. StockCode: {r.stockCode}" });
                continue;
            }

            if (!groupIdByCode.ContainsKey(r.priceGroupCode))
            {
                var known = string.Join(", ", wantedGroupCodes.OrderBy(x => x));
                errors.Add(new { index = r.index, stockCode = r.stockCode, priceGroupCode = r.priceGroupCode, message = $"Geçersiz fiyat kodu: {r.priceGroupCode}. Tanımlı kodlar: {known}" });
                continue;
            }
        }

        var valid = normalizedRows
            .Where(r =>
                !string.IsNullOrWhiteSpace(r.stockCode)
                && r.priceGroupCode > 0
                && r.price > 0
                && productIdByStockCode.ContainsKey(r.stockCode)
                && groupIdByCode.ContainsKey(r.priceGroupCode)
                && NormalizeCurrency(r.currency) is not null)
            .Select(r => new
            {
                r.index,
                stockCode = r.stockCode,
                productId = productIdByStockCode[r.stockCode],
                priceGroupId = groupIdByCode[r.priceGroupCode],
                price = r.price,
                currency = NormalizeCurrency(r.currency)!
            })
            .ToList();

        var created = 0;
        var updated = 0;

        if (valid.Count > 0)
        {
            var productIds = valid.Select(x => x.productId).Distinct().ToList();
            var groupIds = valid.Select(x => x.priceGroupId).Distinct().ToList();
            var currencies = valid.Select(x => x.currency).Distinct().ToList();

            var existing = await _dbContext.ProductPrices
                .Where(x => productIds.Contains(x.ProductId) && groupIds.Contains(x.PriceGroupId) && currencies.Contains(x.Currency))
                .ToListAsync(cancellationToken);

            var existingIndex = existing
                .GroupBy(x => new { x.ProductId, x.PriceGroupId, x.Currency })
                .ToDictionary(g => g.Key, g => g.First());

            foreach (var r in valid)
            {
                var key = new { ProductId = r.productId, PriceGroupId = r.priceGroupId, Currency = r.currency };
                if (existingIndex.TryGetValue(key, out var pp))
                {
                    pp.Price = r.price;
                    updated++;
                }
                else
                {
                    _dbContext.ProductPrices.Add(new ProductPrice
                    {
                        Id = Guid.NewGuid(),
                        ProductId = r.productId,
                        PriceGroupId = r.priceGroupId,
                        Price = r.price,
                        Currency = r.currency
                    });
                    created++;
                }
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                total = rows.Count,
                created,
                updated,
                failed = errors.Count,
                errors
            }
        });
    }

    [AuthorizePage("users", "atiliFiyatlandirma")]
    [HttpPut("{id:guid}")]
    [ProducesResponseType(typeof(ProductPriceResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ProductPriceResponse>> Update(Guid id, UpdateProductPriceRequest request, CancellationToken cancellationToken)
    {
        var productPrice = await _dbContext.ProductPrices
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (productPrice is null)
        {
            return NotFound();
        }

        if (request.ProductId != productPrice.ProductId)
        {
            ModelState.AddModelError(nameof(request.ProductId), "ProductId cannot be changed.");
        }

        if (request.Price <= 0)
        {
            ModelState.AddModelError(nameof(request.Price), "Price must be greater than 0.");
        }

        var currency = NormalizeCurrency(request.Currency);
        if (currency is null)
        {
            ModelState.AddModelError(nameof(request.Currency), "Para birimi TL, USD, EUR veya GBP olmalıdır.");
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var priceGroupExists = await _dbContext.PriceGroups
            .AsNoTracking()
            .AnyAsync(x => x.Id == request.PriceGroupId, cancellationToken);

        if (!priceGroupExists)
        {
            ModelState.AddModelError(nameof(request.PriceGroupId), "PriceGroupId is invalid.");
            return ValidationProblem(ModelState);
        }

        var duplicateExists = await _dbContext.ProductPrices
            .AsNoTracking()
            .AnyAsync(x => x.Id != id && x.ProductId == productPrice.ProductId && x.PriceGroupId == request.PriceGroupId, cancellationToken);

        if (duplicateExists)
        {
            ModelState.AddModelError(nameof(request.PriceGroupId), "A price already exists for the given ProductId and PriceGroupId.");
            return ValidationProblem(ModelState);
        }

        productPrice.PriceGroupId = request.PriceGroupId;
        productPrice.Price = request.Price;
        productPrice.Currency = currency!;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(ToResponse(productPrice));
    }

    [AuthorizePage("users", "atiliFiyatlandirma")]
    [HttpDelete("{id:guid}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        var productPrice = await _dbContext.ProductPrices
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (productPrice is null)
        {
            return NotFound();
        }

        _dbContext.ProductPrices.Remove(productPrice);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return NoContent();
    }

    private static string? NormalizeCurrency(string? currency)
    {
        var value = string.IsNullOrWhiteSpace(currency) ? "TL" : currency.Trim().ToUpperInvariant();
        if (!CurrencyRegex.IsMatch(value))
        {
            return null;
        }

        return value;
    }

    private static List<Guid> ParseGuids(string value)
    {
        var list = new List<Guid>();
        if (string.IsNullOrWhiteSpace(value))
        {
            return list;
        }

        var parts = value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        foreach (var part in parts)
        {
            if (Guid.TryParse(part, out var id))
            {
                list.Add(id);
            }
        }

        return list;
    }

    private static ProductPriceResponse ToResponse(ProductPrice productPrice)
    {
        return new ProductPriceResponse
        {
            Id = productPrice.Id,
            ProductId = productPrice.ProductId,
            PriceGroupId = productPrice.PriceGroupId,
            Price = productPrice.Price,
            Currency = productPrice.Currency
        };
    }
}
