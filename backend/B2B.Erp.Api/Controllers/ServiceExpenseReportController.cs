using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

/// <summary>
/// HİZMET HARCAMA RAPORU — "hangi hizmete ne kadar harcadım" (2026-09-18).
///
/// <para>
/// <b>İKİ KAYNAK.</b> İlk sürüm yalnızca alış faturasının İÇİNDEKİ hizmet satırlarına bakıyordu
/// ve canlıda rapor bomboş çıktı: bu firmada hizmet harcamaları zaten ayrı bir belge türüyle,
/// <c>Kind = Service</c> ("Hizmet" tipi fatura) olarak giriliyor. Rapor artık ikisini birden
/// topluyor:
/// </para>
/// <list type="number">
///   <item><b>Hizmet faturaları</b> (<c>Kind = Service</c>) — belgenin tamamı bir hizmet
///     harcamasıdır, başlık neti alınır. Satırlara inilmez: bu belgelerde kalemler çoğunlukla
///     serbest metindir ("JENERATÖR BAK. BED."), stok kartına bağlı değildir.</item>
///   <item><b>Alış faturasındaki hizmet satırları</b> (<c>Kind = Purchase</c> + satır niteliği
///     <c>Service</c>) — 2026-09-18'de eklenen "Hizmet Ekle" yolundan gelen nakliye/işçilik
///     satırları.</item>
/// </list>
///
/// <para>
/// <b>GRUPLAMA — "hizmet türü" nereden okunur.</b> Sırayla: hizmet kataloğu kodu
/// (<c>PurchaseInvoice.ServiceCode</c>) doluysa katalog adı; değilse belgenin GİDER CARİSİ
/// (<c>770-…</c>) — bu firmada cari adı fiilen gider türüdür (MUTFAK GİDERLERİ, DİĞER MUHTELİF
/// GİDERLER); alış satırlarında ise hizmet kartının adı. Tek bir alana bel bağlamak, verinin
/// bir kısmını "(tanımsız)" kovasına düşürürdü.
/// </para>
///
/// <para>
/// <b>Para birimi:</b> belgeler farklı dövizlerde olabildiği için toplamlar TL'ye çevrilir
/// (<c>ExchangeRate</c> belgede donmuştur). Tutarlar KDV HARİÇ nettir.
/// </para>
/// </summary>
[ApiController]
[Route("api/service-expense-report")]
[Authorize]
public sealed class ServiceExpenseReportController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly CompanyClock _clock;

    public ServiceExpenseReportController(AppDbContext db, CompanyClock clock)
    {
        _db = db;
        _clock = clock;
    }

    public sealed class ServiceSupplierDto
    {
        public string SupplierCode { get; set; } = string.Empty;
        public string SupplierName { get; set; } = string.Empty;
        public decimal Amount { get; set; }
        public int InvoiceCount { get; set; }
    }

    public sealed class ServiceRowDto
    {
        public string Key { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public int InvoiceCount { get; set; }
        public decimal Amount { get; set; }
        public decimal SharePercent { get; set; }
        public DateTime? LastDate { get; set; }
        public List<ServiceSupplierDto> Suppliers { get; set; } = new();
    }

    public sealed class ServiceDetailDto
    {
        public int InvoiceId { get; set; }
        public string DocumentNo { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public string Key { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string SupplierCode { get; set; } = string.Empty;
        public string SupplierName { get; set; } = string.Empty;
        public decimal Amount { get; set; }
        public string CurrencyCode { get; set; } = "TRY";
        public decimal CurrencyAmount { get; set; }
        /// <summary>"Hizmet Faturası" ya da "Alış Faturası" — satırın hangi yoldan geldiği.</summary>
        public string Source { get; set; } = string.Empty;
        public string? Description { get; set; }
    }

    [HttpGet]
    [AuthorizePage("reports", "hizmetHarcamaRaporu")]
    public async Task<IActionResult> Get(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? supplierCode,
        CancellationToken cancellationToken)
    {
        var today = _clock.TodayCompanyDate();
        var fromDate = DateTime.SpecifyKind((from ?? new DateTime(today.Year, 1, 1)).Date, DateTimeKind.Utc);
        var toDate = DateTime.SpecifyKind((to ?? today).Date, DateTimeKind.Utc);
        if (toDate < fromDate) (fromDate, toDate) = (toDate, fromDate);
        var toExclusive = toDate.AddDays(1);

        var supplierFilter = string.IsNullOrWhiteSpace(supplierCode) ? null : supplierCode.Trim();

        static decimal ToTry(decimal amount, int currencyTypeId, decimal rate)
        {
            if (CurrencyTypeHelper.IsTry(currencyTypeId)) return Math.Round(amount, 2);
            var r = rate > 0m ? rate : 1m;
            return Math.Round(amount * r, 2);
        }

        var details = new List<ServiceDetailDto>();

        // ---- 1) HİZMET FATURALARI (belgenin tamamı hizmet harcamasıdır) ----
        var serviceInvoiceQuery = _db.Set<PurchaseInvoice>()
            .AsNoTracking()
            .Where(x => x.Kind == PurchaseInvoiceKind.Service
                        && x.Date >= fromDate && x.Date < toExclusive);

        if (supplierFilter != null)
        {
            serviceInvoiceQuery = serviceInvoiceQuery.Where(x =>
                x.CustomerCode == supplierFilter || x.SupplierCode == supplierFilter);
        }

        var serviceInvoices = await serviceInvoiceQuery
            .Select(x => new
            {
                x.Id,
                x.DocumentNo,
                x.Date,
                x.ServiceCode,
                x.CustomerCode,
                x.SupplierCode,
                x.Description,
                x.NetTotal,
                x.CurrencyTypeId,
                x.ExchangeRate
            })
            .ToListAsync(cancellationToken);

        // ---- 2) ALIŞ FATURASINDAKİ HİZMET SATIRLARI ----
        var purchaseLineQuery = _db.Set<PurchaseInvoiceLine>()
            .AsNoTracking()
            .Where(l => l.Nature == Core.Accounting.InvoiceLineNature.Service
                        && l.PurchaseInvoice.Kind == PurchaseInvoiceKind.Purchase
                        && l.PurchaseInvoice.Date >= fromDate
                        && l.PurchaseInvoice.Date < toExclusive);

        if (supplierFilter != null)
        {
            purchaseLineQuery = purchaseLineQuery.Where(l => l.PurchaseInvoice.SupplierCode == supplierFilter);
        }

        var purchaseLines = await purchaseLineQuery
            .Select(l => new
            {
                l.PurchaseInvoiceId,
                l.StockCode,
                l.Description,
                l.Quantity,
                l.UnitPrice,
                l.CurrencyUnitPrice,
                l.DiscountType,
                l.DiscountValue,
                ProductName = l.Product != null ? l.Product.Name : null,
                InvoiceDate = l.PurchaseInvoice.Date,
                InvoiceDocumentNo = l.PurchaseInvoice.DocumentNo,
                SupplierCode = l.PurchaseInvoice.SupplierCode,
                CurrencyTypeId = l.PurchaseInvoice.CurrencyTypeId,
                ExchangeRate = l.PurchaseInvoice.ExchangeRate
            })
            .ToListAsync(cancellationToken);

        // ---- Ad çözümleri: hizmet kataloğu + cari/tedarikçi adları ----
        // Katalog kodlari iki yerden gelir: hizmet faturasinin ServiceCode'u ve alis
        // faturasindaki hizmet satirinin stok kodu ("Hizmet Ekle" katalogdan seciyor).
        var serviceCodes = serviceInvoices
            .Select(x => (x.ServiceCode ?? string.Empty).Trim())
            .Concat(purchaseLines.Select(x => (x.StockCode ?? string.Empty).Trim()))
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var serviceNames = serviceCodes.Count == 0
            ? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            : (await _db.Set<ServiceCatalogItem>()
                    .AsNoTracking()
                    .Where(x => serviceCodes.Contains(x.Code))
                    .Select(x => new { x.Code, x.Name })
                    .ToListAsync(cancellationToken))
                .GroupBy(x => x.Code, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().Name, StringComparer.OrdinalIgnoreCase);

        var partyCodes = serviceInvoices
            .SelectMany(x => new[] { x.CustomerCode, x.SupplierCode })
            .Concat(purchaseLines.Select(x => x.SupplierCode))
            .Select(x => (x ?? string.Empty).Trim())
            .Where(x => x.Length > 0)
            .Distinct()
            .ToList();

        var supplierNames = partyCodes.Count == 0
            ? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            : (await _db.Set<Supplier>()
                    .AsNoTracking()
                    .Where(x => partyCodes.Contains(x.SupplierCode))
                    .Select(x => new { x.SupplierCode, x.FullName })
                    .ToListAsync(cancellationToken))
                .GroupBy(x => x.SupplierCode, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().FullName, StringComparer.OrdinalIgnoreCase);

        // Gider carileri (770-…) Customers tarafında durabiliyor; adı oradan da arıyoruz.
        var customerNames = partyCodes.Count == 0
            ? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            : (await _db.Set<Customer>()
                    .AsNoTracking()
                    .Where(x => partyCodes.Contains(x.CustomerCode))
                    .Select(x => new { x.CustomerCode, x.Name })
                    .ToListAsync(cancellationToken))
                .GroupBy(x => x.CustomerCode, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().Name, StringComparer.OrdinalIgnoreCase);

        string PartyName(string? code)
        {
            var c = (code ?? string.Empty).Trim();
            if (c.Length == 0) return "—";
            if (customerNames.TryGetValue(c, out var cn) && !string.IsNullOrWhiteSpace(cn)) return cn;
            if (supplierNames.TryGetValue(c, out var sn) && !string.IsNullOrWhiteSpace(sn)) return sn;
            return c;
        }

        foreach (var inv in serviceInvoices)
        {
            var partyCode = !string.IsNullOrWhiteSpace(inv.CustomerCode)
                ? inv.CustomerCode!.Trim()
                : (inv.SupplierCode ?? string.Empty).Trim();

            var svcCode = (inv.ServiceCode ?? string.Empty).Trim();

            // Hizmet türü: katalog adı > gider carisi adı > "(tanımsız)"
            string key, name;
            if (svcCode.Length > 0)
            {
                key = "SVC:" + svcCode;
                name = serviceNames.TryGetValue(svcCode, out var sn2) && !string.IsNullOrWhiteSpace(sn2) ? sn2 : svcCode;
            }
            else if (partyCode.Length > 0)
            {
                key = "CARI:" + partyCode;
                name = PartyName(partyCode);
            }
            else
            {
                key = "YOK";
                name = "(tanımsız)";
            }

            details.Add(new ServiceDetailDto
            {
                InvoiceId = inv.Id,
                DocumentNo = inv.DocumentNo ?? string.Empty,
                Date = inv.Date,
                Key = key,
                Name = name,
                SupplierCode = partyCode,
                SupplierName = PartyName(partyCode),
                Amount = ToTry(inv.NetTotal, inv.CurrencyTypeId, inv.ExchangeRate),
                CurrencyCode = CurrencyTypeHelper.ToCodeOrTry(inv.CurrencyTypeId),
                CurrencyAmount = Math.Round(inv.NetTotal, 2),
                Source = "Hizmet Faturası",
                Description = inv.Description
            });
        }

        foreach (var l in purchaseLines)
        {
            var rate = l.ExchangeRate > 0m ? l.ExchangeRate : 1m;

            // Satır neti belgenin kendi parasında hesaplanır, sonra TL'ye çevrilir.
            var docUnit = l.CurrencyUnitPrice > 0m ? l.CurrencyUnitPrice : l.UnitPrice;
            var docBase = l.Quantity * docUnit;
            var docDisc = l.DiscountType switch
            {
                PurchaseInvoiceLineDiscountType.Percentage => docBase * (l.DiscountValue / 100m),
                PurchaseInvoiceLineDiscountType.Amount => l.DiscountValue,
                _ => 0m
            };
            var docNet = Math.Round(Math.Max(0m, docBase - docDisc), 2);

            var code = string.IsNullOrWhiteSpace(l.StockCode) ? "(kodsuz)" : l.StockCode.Trim();

            /*
              AYNI HIZMET TEK SATIRDA TOPLANIR.

              Alis faturasina eklenen hizmet satiri da katalogdan seciliyor (HIZ-NAKLIYE...).
              Anahtari hizmet faturalariyla AYNI ("SVC:<kod>") vermezsek ayni nakliye bedeli
              raporda iki ayri satira bolunur ve "hangi hizmete ne harcadim" sorusu yanlis
              cevaplanir. Katalogda olmayan kod (urun kartli hizmet, or. MONTAJ-BEDELI)
              kendi anahtarinda kalir.
            */
            var katalogda = serviceNames.ContainsKey(code);
            var name = katalogda
                ? serviceNames[code]
                : (!string.IsNullOrWhiteSpace(l.ProductName)
                    ? l.ProductName!
                    : (!string.IsNullOrWhiteSpace(l.Description) ? l.Description! : code));

            details.Add(new ServiceDetailDto
            {
                InvoiceId = l.PurchaseInvoiceId,
                DocumentNo = l.InvoiceDocumentNo ?? string.Empty,
                Date = l.InvoiceDate,
                Key = katalogda ? "SVC:" + code : "URUN:" + code,
                Name = name,
                SupplierCode = (l.SupplierCode ?? string.Empty).Trim(),
                SupplierName = PartyName(l.SupplierCode),
                Amount = ToTry(docNet, l.CurrencyTypeId, rate),
                CurrencyCode = CurrencyTypeHelper.ToCodeOrTry(l.CurrencyTypeId),
                CurrencyAmount = docNet,
                Source = "Alış Faturası",
                Description = l.Description
            });
        }

        var totalAmount = details.Sum(x => x.Amount);

        var services = details
            .GroupBy(x => x.Key)
            .Select(g =>
            {
                var amount = g.Sum(x => x.Amount);
                return new ServiceRowDto
                {
                    Key = g.Key,
                    Name = g.OrderByDescending(x => x.Date).Select(x => x.Name).First(),
                    InvoiceCount = g.Select(x => x.InvoiceId).Distinct().Count(),
                    Amount = amount,
                    SharePercent = totalAmount <= 0m ? 0m : Math.Round(amount / totalAmount * 100m, 2),
                    LastDate = g.Max(x => x.Date),
                    Suppliers = g
                        .GroupBy(x => x.SupplierCode)
                        .Select(sg => new ServiceSupplierDto
                        {
                            SupplierCode = sg.Key,
                            SupplierName = sg.Select(x => x.SupplierName).First(),
                            Amount = sg.Sum(x => x.Amount),
                            InvoiceCount = sg.Select(x => x.InvoiceId).Distinct().Count()
                        })
                        .OrderByDescending(x => x.Amount)
                        .ToList()
                };
            })
            .OrderByDescending(x => x.Amount)
            .ToList();

        var monthly = details
            .GroupBy(x => new { x.Date.Year, x.Date.Month })
            .Select(g => new
            {
                month = $"{g.Key.Year:0000}-{g.Key.Month:00}",
                amount = g.Sum(x => x.Amount)
            })
            .OrderBy(x => x.month)
            .ToList();

        return Ok(new
        {
            success = true,
            data = new
            {
                from = fromDate,
                to = toDate,
                totalAmount,
                serviceCount = services.Count,
                lineCount = details.Count,
                invoiceCount = details.Select(x => x.InvoiceId).Distinct().Count(),
                services,
                monthly,
                details = details.OrderByDescending(x => x.Date).ThenByDescending(x => x.InvoiceId).ToList()
            }
        });
    }
}
