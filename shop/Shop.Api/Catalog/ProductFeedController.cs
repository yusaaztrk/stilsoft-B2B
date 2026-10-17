using System.Globalization;
using System.Text;
using System.Xml;
using Microsoft.AspNetCore.Mvc;
using Shop.Api.Infrastructure;

namespace Shop.Api.Catalog;

/// <summary>
/// ÜRÜN FEED'İ — Google Merchant Center ve Meta (Facebook/Instagram) kataloğu (2026-09-20).
///
/// Kıbrıs'ta alışveriş Facebook'ta başlıyor; bu adres Meta Katalog'a ve Google Merchant'a
/// "URL ile beslenen ürün kaynağı" olarak verilir, ürünler otomatik listelenir. RSS 2.0 +
/// <c>g:</c> alanları: iki platform da aynı biçimi okur. Yalnız vitrinde yayında olan ürünler
/// (kataloğun kendi kuralları) ve varsa kampanyalı fiyat (<c>g:sale_price</c>).
///
/// Adresler <c>Shop:StorefrontBaseUrl</c> ve <c>Shop:PublicApiBaseUrl</c> ayarlarından; yoksa
/// canlı adresler varsayılır.
/// </summary>
[ApiController]
[Route("api/catalog")]
public sealed class ProductFeedController : ControllerBase
{
    private readonly CatalogQueries _catalog;
    private readonly IConfiguration _configuration;

    public ProductFeedController(CatalogQueries catalog, IConfiguration configuration)
    {
        _catalog = catalog;
        _configuration = configuration;
    }

    [HttpGet("feed.xml")]
    [ResponseCache(Duration = 900)]
    public async Task<IActionResult> Feed(CancellationToken ct)
    {
        var siteBase = (_configuration["Shop:StorefrontBaseUrl"] ?? "https://example.com").TrimEnd('/');
        var apiBase = (_configuration["Shop:PublicApiBaseUrl"] ?? "https://example.com/shopapi").TrimEnd('/');

        var items = new List<CatalogItem>();
        for (var page = 1; page <= 50; page++)
        {
            var result = await _catalog.ListAsync(null, null, "yeni", page, 96, ct);
            if (result.Items.Count == 0) break;
            items.AddRange(result.Items);
            if (items.Count >= result.TotalCount) break;
        }

        var settings = new XmlWriterSettings { Encoding = new UTF8Encoding(false), Indent = true, Async = true };
        using var buffer = new MemoryStream();
        await using (var w = XmlWriter.Create(buffer, settings))
        {
            const string g = "http://base.google.com/ns/1.0";
            await w.WriteStartDocumentAsync();
            await w.WriteStartElementAsync(null, "rss", null);
            await w.WriteAttributeStringAsync(null, "version", null, "2.0");
            await w.WriteAttributeStringAsync("xmlns", "g", null, g);
            await w.WriteStartElementAsync(null, "channel", null);
            await w.WriteElementStringAsync(null, "title", null, "STILSOFT DEMO");
            await w.WriteElementStringAsync(null, "link", null, siteBase);
            await w.WriteElementStringAsync(null, "description", null, "STILSOFT DEMO ürün kataloğu");

            foreach (var it in items)
            {
                if (string.IsNullOrWhiteSpace(it.ImageUrl)) continue;

                var link = $"{siteBase}/urun/{it.Slug}";
                var image = it.ImageUrl.StartsWith("http", StringComparison.OrdinalIgnoreCase)
                    ? it.ImageUrl
                    : $"{apiBase}/api/media{(it.ImageUrl.StartsWith('/') ? "" : "/")}{it.ImageUrl}";

                await w.WriteStartElementAsync(null, "item", null);
                await w.WriteElementStringAsync("g", "id", g, it.StockCode);
                await w.WriteElementStringAsync(null, "title", null, it.Name);
                await w.WriteElementStringAsync(null, "description", null, $"{it.Name} — STILSOFT DEMO, ücretsiz teslimat ve yetkili montaj.");
                await w.WriteElementStringAsync(null, "link", null, link);
                await w.WriteElementStringAsync("g", "image_link", g, image);
                await w.WriteElementStringAsync("g", "brand", g, "STILSOFT");
                await w.WriteElementStringAsync("g", "condition", g, "new");
                await w.WriteElementStringAsync("g", "availability", g, it.InStock ? "in stock" : "out of stock");

                var regular = it.OriginalGrossPrice ?? it.GrossPrice;
                await w.WriteElementStringAsync("g", "price", g, regular.ToString("0.00", CultureInfo.InvariantCulture) + " TRY");
                if (it.OriginalGrossPrice.HasValue && it.OriginalGrossPrice.Value > it.GrossPrice)
                {
                    await w.WriteElementStringAsync("g", "sale_price", g, it.GrossPrice.ToString("0.00", CultureInfo.InvariantCulture) + " TRY");
                }
                if (!string.IsNullOrWhiteSpace(it.CategoryName))
                {
                    await w.WriteElementStringAsync("g", "product_type", g, it.CategoryName);
                }
                await w.WriteEndElementAsync();
            }

            await w.WriteEndElementAsync();
            await w.WriteEndElementAsync();
            await w.WriteEndDocumentAsync();
        }

        return File(buffer.ToArray(), "application/rss+xml; charset=utf-8");
    }
}
