using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.CustomerLedger;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

/// <summary>
/// WHATSAPP ASİSTANI'NIN OKUMA UÇLARI (2026-10-08, asistan 3. aşama) — YALNIZ OKUMA.
///
/// Asistan (asistan.example.com, ayrı program) müşterinin "siparişim ne oldu, borcum ne kadar"
/// sorusuna taslak yazarken bu uçlara sorar. Kullanıcı oturumu YOK: sunucudan sunucuya,
/// <c>X-Internal-Key</c> (yapılandırma <c>Asistan:InternalApiKey</c>) + <c>X-Tenant-Code</c>.
/// Anahtar tanımlı değilse uçlar 503 döner (kapalı başarısız).
///
/// KAPSAM KURALI: cari kodunu ASİSTAN SUNUCUSU verir (WhatsApp numarasının eşleştiği cariler);
/// yapay zekâ modeli veremez. Belge numarasıyla arama da yalnız bu carilerin içinde yapılır —
/// müşteri başkasının sipariş numarasını yazsa da sonuç dönmez.
///
/// BAKİYE ekstreyle BİREBİR aynı olmalı: hesap burada yeniden yazılmaz, Cari Ekstre ucu
/// (<see cref="CustomerLedgerController.List"/>) ilk kapanmamış dönemle çağrılır — ekran da aynı
/// kuralı kullanıyor (CariEkstreModal: ilk !isClosed dönem, yoksa listenin ilki).
/// </summary>
[ApiController]
[Route("api/asistan-tools")]
[InternalApiKey("Asistan:InternalApiKey")]
public sealed class AsistanToolsController : ControllerBase
{
    private const int CancelledOrderStatus = 9;

    private readonly AppDbContext _db;
    private readonly Core.Services.ICustomerAccountService _accounts;

    public AsistanToolsController(AppDbContext db, Core.Services.ICustomerAccountService accounts)
    {
        _db = db;
        _accounts = accounts;
    }

    /// <summary>Carinin döviz başına bakiyesi (ekstre ile aynı hesap, ilk kapanmamış dönem).</summary>
    [HttpGet("balance")]
    public async Task<IActionResult> Balance([FromQuery] string code, CancellationToken ct)
    {
        code = (code ?? string.Empty).Trim();
        if (code.Length == 0) return BadRequest(new { message = "Cari kodu zorunlu." });

        var period = await _db.AccountingPeriods.AsNoTracking()
            .OrderBy(x => x.FiscalYear).ThenBy(x => x.StartDate)
            .Select(x => new { x.Id, x.Name, x.IsClosed })
            .ToListAsync(ct);
        var current = period.FirstOrDefault(x => !x.IsClosed) ?? period.FirstOrDefault();

        // Ekstre ucunu süreç içinde çağır: hesap tek yerde kalsın. Oturum olmadığı için ucun
        // içindeki cari kapsamı "hepsi" sayar; kapsamı asistan sunucusu zaten daralttı.
        var ledger = ActivatorUtilities.CreateInstance<CustomerLedgerController>(HttpContext.RequestServices);
        ledger.ControllerContext = ControllerContext;
        var result = await ledger.List(code, null, null, null, current?.Id, ct);

        var dto = (result as ObjectResult)?.Value is { } v
            ? v.GetType().GetProperty("data")?.GetValue(v) as CustomerLedgerListResponseDto
            : null;
        if (dto is null || string.IsNullOrEmpty(dto.CustomerName) && dto.CurrencyBalances.Count == 0)
            return NotFound(new { message = "Cari bulunamadı." });

        return Ok(new
        {
            customerCode = dto.CustomerCode,
            customerName = dto.CustomerName,
            period = current?.Name,
            // Pozitif bakiye = müşteri BORÇLU (borç - alacak). Para birimleri birbirine çevrilmez.
            currencies = dto.CurrencyBalances.Select(c => new
            {
                currency = c.CurrencyCode,
                symbol = c.CurrencySymbol,
                balance = c.Balance,
                state = c.Balance > 0.005m ? "borçlu" : c.Balance < -0.005m ? "alacaklı" : "kapalı",
                totalDebit = c.TotalDebit,
                totalCredit = c.TotalCredit
            }),
            lastMovementAt = dto.Items.Count == 0 ? (DateTime?)null : dto.Items.Max(i => i.Date)
        });
    }

    /// <summary>Son satış siparişleri (iptal dahil) ve faturalanma durumu.</summary>
    [HttpGet("orders")]
    public async Task<IActionResult> Orders([FromQuery] string codes, [FromQuery] string? q, [FromQuery] int take = 8, CancellationToken ct = default)
    {
        var related = await RelatedCodesAsync(codes, ct);
        if (related.Count == 0) return BadRequest(new { message = "Cari kodu zorunlu." });
        take = Math.Clamp(take, 1, 20);
        var term = (q ?? string.Empty).Trim();

        var query = _db.SalesOrders.AsNoTracking().Where(o => related.Contains(o.CustomerCode));
        if (term.Length > 0) query = query.Where(o => o.OrderNo.Contains(term));

        var orders = await query
            .OrderByDescending(o => o.CreateTime).ThenByDescending(o => o.Id)
            .Take(take)
            .Select(o => new { o.Id, o.OrderNo, o.CustomerCode, o.CreateTime, o.Status, o.GrandTotal, o.DeliveryName, o.DeliveryCity })
            .ToListAsync(ct);
        var ids = orders.Select(o => o.Id).ToList();

        var lines = await _db.SalesOrderLines.AsNoTracking()
            .Where(l => ids.Contains(l.SalesOrderId))
            .Select(l => new { l.Id, l.SalesOrderId, l.StockCode, l.Description, l.Quantity, l.Montage, l.IsGift, l.CurrencyTypeId })
            .ToListAsync(ct);
        var lineIds = lines.Select(l => l.Id).ToList();

        // Faturalanan miktar ve fatura numarası: InvoiceLines.SalesOrderLineId (sipariş iptal kapısıyla aynı bağ).
        var invoiced = await _db.InvoiceLines.AsNoTracking()
            .Where(l => l.SalesOrderLineId != null && lineIds.Contains(l.SalesOrderLineId!.Value))
            .Select(l => new { LineId = l.SalesOrderLineId!.Value, l.Quantity, l.Invoice.InvoiceNo, l.Invoice.Date })
            .ToListAsync(ct);

        var names = await ProductNamesAsync(lines.Select(l => l.StockCode), ct);

        var items = orders.Select(o =>
        {
            var own = lines.Where(l => l.SalesOrderId == o.Id).ToList();
            var ownIds = own.Select(l => l.Id).ToHashSet();
            var inv = invoiced.Where(i => ownIds.Contains(i.LineId)).ToList();
            var ordered = own.Where(l => !l.IsGift).Sum(l => l.Quantity);
            var billed = inv.Sum(i => i.Quantity);
            var state = o.Status == CancelledOrderStatus ? "İptal"
                : inv.Count == 0 ? "Açık (henüz faturalanmadı)"
                : billed + 0.0001m >= ordered ? "Faturalandı"
                : "Kısmen faturalandı";
            var foreign = own.Select(l => l.CurrencyTypeId).Where(c => c > 1).Distinct().ToList();
            return new
            {
                orderNo = o.OrderNo,
                customerCode = o.CustomerCode,
                date = o.CreateTime,
                state,
                // Sipariş toplamı TL çapasıdır; dövizli kalemde TL karşılığı olduğu ayrıca söylenir.
                grandTotalTl = o.GrandTotal,
                lineCurrencies = foreign.Select(ProductCurrencyHelper.MapCurrencyTypeIdToCode),
                delivery = string.Join(", ", new[] { o.DeliveryName, o.DeliveryCity }.Where(s => !string.IsNullOrWhiteSpace(s))),
                invoices = inv.GroupBy(i => i.InvoiceNo).Select(g => new { invoiceNo = g.Key, date = g.First().Date }),
                lines = own.Select(l => new
                {
                    product = names.TryGetValue(l.StockCode, out var n) ? n : (l.Description ?? l.StockCode),
                    quantity = l.Quantity,
                    montage = l.Montage,
                    gift = l.IsGift
                })
            };
        });
        return Ok(new { items });
    }

    /// <summary>Son satış/servis faturaları (proforma, teklif, alış ve depo transferi hariç).</summary>
    [HttpGet("invoices")]
    public async Task<IActionResult> Invoices([FromQuery] string codes, [FromQuery] string? q, [FromQuery] int take = 8, CancellationToken ct = default)
    {
        var related = await RelatedCodesAsync(codes, ct);
        if (related.Count == 0) return BadRequest(new { message = "Cari kodu zorunlu." });
        take = Math.Clamp(take, 1, 20);
        var term = (q ?? string.Empty).Trim();

        var kinds = new[] { InvoiceType.SalesInvoice, InvoiceType.OpenInvoice, InvoiceType.ServiceInvoice, InvoiceType.ReturnInvoice };
        var query = _db.Invoices.AsNoTracking().Where(i => related.Contains(i.CustomerCode) && kinds.Contains(i.Type));
        if (term.Length > 0) query = query.Where(i => i.InvoiceNo.Contains(term));

        var invoices = await query
            .OrderByDescending(i => i.Date).ThenByDescending(i => i.Id)
            .Take(take)
            .Select(i => new { i.Id, i.InvoiceNo, i.CustomerCode, i.Date, i.Type, i.GrandTotal, i.CurrencyTypeId })
            .ToListAsync(ct);
        var ids = invoices.Select(i => i.Id).ToList();

        var lines = await _db.InvoiceLines.AsNoTracking()
            .Where(l => ids.Contains(l.InvoiceId))
            .Select(l => new { l.InvoiceId, l.StockCode, l.Description, l.Quantity })
            .ToListAsync(ct);
        var names = await ProductNamesAsync(lines.Select(l => l.StockCode), ct);

        var items = invoices.Select(i => new
        {
            invoiceNo = i.InvoiceNo,
            customerCode = i.CustomerCode,
            date = i.Date,
            kind = i.Type switch
            {
                InvoiceType.ServiceInvoice => "Servis faturası",
                InvoiceType.ReturnInvoice => "İade faturası",
                _ => "Satış faturası"
            },
            // Fatura başlığının kendi parası (tek döviz kuralı); tutar o parada.
            grandTotal = i.GrandTotal,
            currency = ProductCurrencyHelper.MapCurrencyTypeIdToCode(i.CurrencyTypeId),
            lines = lines.Where(l => l.InvoiceId == i.Id).Select(l => new
            {
                product = names.TryGetValue(l.StockCode, out var n) ? n : (l.Description ?? l.StockCode),
                quantity = l.Quantity
            })
        });
        return Ok(new { items });
    }

    /// <summary>Ana cari + alt hesaplar (-1/-2/-3) — ekstrenin kullandığı kümeyle aynı.</summary>
    private async Task<List<string>> RelatedCodesAsync(string? codes, CancellationToken ct)
    {
        var all = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var c in (codes ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(20))
        {
            all.Add(c);
            foreach (var r in await _accounts.GetRelatedCustomerCodesForLedgerAsync(c, ct)) all.Add(r);
        }
        return all.ToList();
    }

    private async Task<Dictionary<string, string>> ProductNamesAsync(IEnumerable<string> stockCodes, CancellationToken ct)
    {
        var list = stockCodes.Where(s => !string.IsNullOrWhiteSpace(s)).Distinct().ToList();
        if (list.Count == 0) return new Dictionary<string, string>();
        return await _db.Products.AsNoTracking()
            .Where(p => list.Contains(p.StockCode))
            .GroupBy(p => p.StockCode)
            .Select(g => new { g.Key, Name = g.Min(p => p.Name) })
            .ToDictionaryAsync(x => x.Key, x => x.Name, ct);
    }
}
