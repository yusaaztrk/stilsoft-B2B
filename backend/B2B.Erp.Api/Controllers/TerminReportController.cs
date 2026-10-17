using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

/// <summary>
/// TERMİN RAPORU (2026-09-17 kullanıcı isteği: "gelen giden ne aldık, kaçı geldi kaçı gelmedi
/// hepsini görebilelim; önceden Excel'de tutuluyordu").
///
/// <para>
/// Yetki TERMİN SAYFASININ yetkisidir (<c>invoice/termin</c>) — ayrı bir sayfa yetkisi açılmadı,
/// kullanıcı kararı. Termin listesini gören herkes raporunu da görür.
/// </para>
///
/// <para><b>Sipariş ve teslimat nasıl okunuyor.</b> Termin ekranında kısmi teslim alındığında
/// (<c>PurchaseInvoicesController.KismiTeslim</c>) gelen miktar SİPARİŞİN KALEMİNDEN DÜŞÜLÜR ve
/// ayrı bir "parti" faturasına yazılır; partinin <c>SplitFromPurchaseInvoiceId</c>'si siparişi
/// gösterir. Dolayısıyla:</para>
/// <list type="bullet">
///   <item>Sipariş = kök alış faturası (<c>SplitFromPurchaseInvoiceId == null</c>).</item>
///   <item>Gelen = partilerin miktarı + sipariş "Teslim Edildi" ise kendi kalan kalemleri.</item>
///   <item>Gelmeyen = sipariş "Bekliyor" ise kendi kalemlerinde kalan miktar.</item>
///   <item>Sipariş edilen = Gelen + Gelmeyen.</item>
/// </list>
///
/// <para><b>Tutarlar</b> KDV HARİÇ, iskonto düşülmüş, siparişin KENDİ para birimindedir.
/// Parti başka para biriminde geldiyse TL çapası (<c>UnitPrice</c>) üzerinden siparişin kuruyla
/// çevrilir. Farklı para birimleri hiçbir yerde toplanmaz; özetler para birimi başına ayrı durur.</para>
///
/// <para><b>Ödemeler</b> tedarikçi defterinden gelir: fatura dışındaki borç satırları (kasa,
/// banka, manuel) "ödenen", tüm satırların farkı "bakiye" (borcumuz). Bakiye tarih süzgecinden
/// BAĞIMSIZDIR — tedarikçiye bugün ne borçlu olduğumuz dönemle değişmez.</para>
/// </summary>
[ApiController]
[Route("api/termin-rapor")]
[Authorize]
public sealed class TerminReportController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly CompanyClock _clock;

    public TerminReportController(AppDbContext db, CompanyClock clock)
    {
        _db = db;
        _clock = clock;
    }

    [HttpGet]
    [AuthorizePage("invoice", "termin")]
    public async Task<IActionResult> Get(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? supplierCode,
        CancellationToken cancellationToken)
    {
        // Belge tarihi firma gününün UTC gece yarısı olarak damgalı (CompanyClock.TodayAsDocumentDate).
        var today = _clock.TodayCompanyDate();
        var fromDate = DateTime.SpecifyKind((from ?? new DateTime(today.Year, 1, 1)).Date, DateTimeKind.Utc);
        var toDate = DateTime.SpecifyKind((to ?? today).Date, DateTimeKind.Utc);
        if (toDate < fromDate) (fromDate, toDate) = (toDate, fromDate);
        var toExclusive = toDate.AddDays(1);
        var supplierFilter = string.IsNullOrWhiteSpace(supplierCode) ? null : supplierCode.Trim();

        var rootQuery = _db.Set<PurchaseInvoice>()
            .AsNoTracking()
            .Where(x => x.Kind == PurchaseInvoiceKind.Purchase
                        && x.SplitFromPurchaseInvoiceId == null
                        && x.Date >= fromDate && x.Date < toExclusive);
        if (supplierFilter != null) rootQuery = rootQuery.Where(x => x.SupplierCode == supplierFilter);

        var roots = await rootQuery
            .Include(x => x.Lines).ThenInclude(l => l.Product)
            .OrderByDescending(x => x.Date).ThenByDescending(x => x.Id)
            .Take(2000)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        var rootIds = roots.Select(x => x.Id).ToList();
        var parties = rootIds.Count == 0
            ? new List<PurchaseInvoice>()
            : await _db.Set<PurchaseInvoice>()
                .AsNoTracking()
                .Include(x => x.Lines).ThenInclude(l => l.Product)
                .Where(x => x.SplitFromPurchaseInvoiceId != null && rootIds.Contains(x.SplitFromPurchaseInvoiceId.Value))
                .AsSplitQuery()
                .ToListAsync(cancellationToken);
        var partiesByRoot = parties
            .GroupBy(x => x.SplitFromPurchaseInvoiceId!.Value)
            .ToDictionary(g => g.Key, g => g.OrderBy(p => p.Date).ThenBy(p => p.CreateTime).ToList());

        var supplierCodes = roots
            .Select(x => (x.SupplierCode ?? string.Empty).Trim())
            .Where(x => x.Length > 0)
            .Distinct()
            .ToList();
        var supplierNames = await _db.Set<Supplier>()
            .AsNoTracking()
            .Where(x => supplierCodes.Contains(x.SupplierCode))
            .Select(x => new { x.SupplierCode, x.FullName })
            .ToDictionaryAsync(x => x.SupplierCode, x => x.FullName, cancellationToken);

        /*
          HİZMET SATIRININ ADI KATALOGDAN OKUNUR (2026-09-18).

          Hizmet satırının ürün kartı yok; adı çözülemeyince kalem listesinde ham kod
          ("HIZ-NAKLIYE") görünüyordu. Katalogdaki ad ("NAKLİYE ÖDEMELER") okunabilir olan.
        */
        var serviceCatalogNames = (await _db.Set<ServiceCatalogItem>()
                .AsNoTracking()
                .Select(x => new { x.Code, x.Name })
                .ToListAsync(cancellationToken))
            .GroupBy(x => x.Code, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Name, StringComparer.OrdinalIgnoreCase);

        var orders = new List<OrderDto>();
        foreach (var root in roots)
        {
            var currency = DocumentCurrency(root);
            var rate = root.ExchangeRate > 0m ? root.ExchangeRate : 1m;
            var rootParties = partiesByRoot.TryGetValue(root.Id, out var ps) ? ps : new List<PurchaseInvoice>();
            var rootDelivered = root.TerminStatus == PurchaseInvoiceTerminStatus.Delivered;

            // Ürün anahtarı: ürün kimliği, yoksa stok kodu. Parti kalemleri siparişinkiyle bununla eşleşir.
            var lines = new Dictionary<string, LineDto>();
            LineDto LineFor(PurchaseInvoiceLine l)
            {
                var key = l.ProductId?.ToString() ?? $"sc:{l.StockCode}";
                if (!lines.TryGetValue(key, out var dto))
                {
                    var kod = (l.StockCode ?? string.Empty).Trim();
                    var katalogAdi = kod.Length > 0 && serviceCatalogNames.TryGetValue(kod, out var kn) ? kn : null;

                    dto = new LineDto
                    {
                        StockCode = l.StockCode,
                        StockName = l.Product?.Name ?? katalogAdi ?? l.Description ?? l.StockCode,
                        UnitPrice = Math.Round(DocumentUnitPrice(l, root), 4)
                    };
                    lines[key] = dto;
                }
                return dto;
            }

            foreach (var l in root.Lines.OrderBy(x => x.LineNo))
            {
                var dto = LineFor(l);
                var amount = NetInOwnCurrency(l, root);

                // Hizmet satırı: tutarı yazılır ve öyle gösterilir; gelen/kalan kovalarına
                // konmaz, böylece aşağıdaki adet ve durum hesapları yalnız MALI sayar.
                if (l.Nature == B2B.Erp.Api.Core.Accounting.InvoiceLineNature.Service)
                {
                    dto.IsService = true;
                    dto.OrderedAmount += amount;
                    continue;
                }

                if (rootDelivered)
                {
                    dto.DeliveredQuantity += l.Quantity;
                    dto.DeliveredAmount += amount;
                }
                else
                {
                    dto.RemainingQuantity += l.Quantity;
                    dto.RemainingAmount += amount;
                }
            }

            var deliveries = new List<DeliveryDto>();
            foreach (var p in rootParties)
            {
                var sameCurrency = CurrencyTypeHelper.SameCurrency(DocumentCurrency(p), currency);
                decimal partyQty = 0m, partyAmount = 0m;
                foreach (var l in p.Lines.OrderBy(x => x.LineNo))
                {
                    var dto = LineFor(l);
                    var amount = sameCurrency
                        ? NetInOwnCurrency(l, p)
                        : (CurrencyTypeHelper.IsTry(currency) ? NetInTry(l, p) : NetInTry(l, p) / rate);

                    // Teslimat partisindeki hizmet satırı da teslim edilen MAL sayılmaz.
                    if (l.Nature == B2B.Erp.Api.Core.Accounting.InvoiceLineNature.Service)
                    {
                        dto.IsService = true;
                        dto.OrderedAmount += amount;
                        continue;
                    }

                    dto.DeliveredQuantity += l.Quantity;
                    dto.DeliveredAmount += amount;
                    partyQty += l.Quantity;
                    partyAmount += amount;
                }
                deliveries.Add(new DeliveryDto
                {
                    Id = p.Id,
                    DocumentNo = p.DocumentNo,
                    Date = p.Date,
                    CreateTime = p.CreateTime,
                    CreateUser = p.CreateUser,
                    Quantity = partyQty,
                    Amount = Math.Round(partyAmount, 2)
                });
            }

            var lineList = lines.Values.ToList();
            foreach (var dto in lineList)
            {
                // Hizmet satırının tutarı zaten yazıldı; adet/teslimat kovaları boş kalır.
                if (dto.IsService)
                {
                    dto.OrderedAmount = Math.Round(dto.OrderedAmount, 2);
                    continue;
                }

                dto.OrderedQuantity = dto.DeliveredQuantity + dto.RemainingQuantity;
                dto.DeliveredAmount = Math.Round(dto.DeliveredAmount, 2);
                dto.RemainingAmount = Math.Round(dto.RemainingAmount, 2);
                dto.OrderedAmount = dto.DeliveredAmount + dto.RemainingAmount;
            }

            // Adet ve durum YALNIZ MALDAN hesaplanır (hizmetin teslimatı yoktur).
            var delivered = lineList.Where(x => !x.IsService).Sum(x => x.DeliveredQuantity);
            var remaining = lineList.Where(x => !x.IsService).Sum(x => x.RemainingQuantity);
            var serviceAmount = Math.Round(lineList.Where(x => x.IsService).Sum(x => x.OrderedAmount), 2);
            var status = remaining <= 0m && (rootDelivered || delivered > 0m)
                ? "Geldi"
                : delivered > 0m ? "KismiGeldi" : "Bekliyor";

            var lastDelivery = rootParties.Count > 0
                ? rootParties.Max(x => x.Date)
                : rootDelivered ? root.Date : (DateTime?)null;

            int? overdueDays = null;
            if (remaining > 0m && root.EstimatedArrivalDate.HasValue && root.EstimatedArrivalDate.Value.Date < today)
            {
                overdueDays = (int)(today - root.EstimatedArrivalDate.Value.Date).TotalDays;
            }

            var code = (root.SupplierCode ?? string.Empty).Trim();
            orders.Add(new OrderDto
            {
                Id = root.Id,
                DocumentNo = root.DocumentNo,
                Date = root.Date,
                SupplierCode = code,
                SupplierName = supplierNames.TryGetValue(code, out var sn) ? sn : code,
                Description = root.Description,
                CurrencyCode = CurrencyTypeHelper.ToCodeOrTry(currency),
                EstimatedArrivalDate = root.EstimatedArrivalDate,
                Status = status,
                OverdueDays = overdueDays,
                LastDeliveryDate = lastDelivery,
                CreateUser = root.CreateUser,
                OrderedQuantity = delivered + remaining,
                DeliveredQuantity = delivered,
                RemainingQuantity = remaining,
                /*
                  SİPARİŞ TUTARI BELGENİN TOPLAMIDIR (mal + hizmet) — kullanıcı kararı
                  2026-09-18. Ekranda yanında `ServiceAmount` düşülmüş "hizmet hariç" hâli de
                  yazılıyor; gelen/kalan tutarlar yalnız MALI saydığı için aradaki fark tam
                  olarak hizmet bedelidir.
                */
                OrderedAmount = lineList.Sum(x => x.OrderedAmount),
                ServiceAmount = serviceAmount,
                DeliveredAmount = lineList.Where(x => !x.IsService).Sum(x => x.DeliveredAmount),
                RemainingAmount = lineList.Where(x => !x.IsService).Sum(x => x.RemainingAmount),
                Lines = lineList,
                Deliveries = deliveries
            });
        }

        // --- Tedarikçi defteri: ödenen (dönemde) ve güncel bakiye, para birimi başına ---
        var ledgerSupplierCodes = orders.Select(x => x.SupplierCode).Where(x => x.Length > 0).Distinct().ToList();
        var ledgerRows = ledgerSupplierCodes.Count == 0
            ? new List<LedgerRow>()
            : await _db.Set<SupplierLedgerEntry>()
                .AsNoTracking()
                .Where(x => ledgerSupplierCodes.Contains(x.SupplierCode))
                .Select(x => new LedgerRow(x.SupplierCode, x.Date, x.Direction, x.ReferenceType, x.CurrencyTypeId, x.Amount, x.CurrencyAmount))
                .ToListAsync(cancellationToken);

        var suppliers = orders
            .GroupBy(x => x.SupplierCode)
            .Select(g =>
            {
                var rows = ledgerRows.Where(r => r.SupplierCode == g.Key).ToList();
                var currencies = g.Select(o => o.CurrencyCode)
                    .Concat(rows.Select(r => CurrencyTypeHelper.ToCodeOrTry(r.CurrencyTypeId)))
                    .Distinct()
                    .OrderBy(c => c == "TRY" ? 1 : 0).ThenBy(c => c)
                    .ToList();

                return new SupplierDto
                {
                    SupplierCode = g.Key,
                    SupplierName = g.First().SupplierName,
                    OrderCount = g.Count(),
                    OpenOrderCount = g.Count(o => o.Status != "Geldi"),
                    OverdueOrderCount = g.Count(o => o.OverdueDays.HasValue),
                    OrderedQuantity = g.Sum(o => o.OrderedQuantity),
                    DeliveredQuantity = g.Sum(o => o.DeliveredQuantity),
                    RemainingQuantity = g.Sum(o => o.RemainingQuantity),
                    Totals = currencies.Select(cur =>
                    {
                        var curOrders = g.Where(o => o.CurrencyCode == cur).ToList();
                        var curRows = rows.Where(r => CurrencyTypeHelper.ToCodeOrTry(r.CurrencyTypeId) == cur).ToList();
                        decimal Value(LedgerRow r) => CurrencyTypeHelper.IsTry(r.CurrencyTypeId) || r.CurrencyAmount == 0m ? r.Amount : r.CurrencyAmount;
                        var paid = curRows
                            .Where(r => r.Direction == SupplierLedgerEntryDirection.Debit
                                        && r.ReferenceType != SupplierLedgerEntryReferenceType.Invoice
                                        && r.Date >= fromDate && r.Date < toExclusive)
                            .Sum(Value);
                        var balance = curRows.Where(r => r.Direction == SupplierLedgerEntryDirection.Credit).Sum(Value)
                                      - curRows.Where(r => r.Direction == SupplierLedgerEntryDirection.Debit).Sum(Value);
                        return new CurrencyTotalDto
                        {
                            CurrencyCode = cur,
                            OrderedAmount = curOrders.Sum(o => o.OrderedAmount),
                            DeliveredAmount = curOrders.Sum(o => o.DeliveredAmount),
                            RemainingAmount = curOrders.Sum(o => o.RemainingAmount),
                            PaidInPeriod = Math.Round(paid, 2),
                            Balance = Math.Round(balance, 2)
                        };
                    }).ToList()
                };
            })
            .OrderByDescending(s => s.RemainingQuantity)
            .ThenBy(s => s.SupplierName)
            .ToList();

        var totals = orders
            .GroupBy(o => o.CurrencyCode)
            .Select(g => new CurrencyTotalDto
            {
                CurrencyCode = g.Key,
                OrderedAmount = g.Sum(o => o.OrderedAmount),
                DeliveredAmount = g.Sum(o => o.DeliveredAmount),
                RemainingAmount = g.Sum(o => o.RemainingAmount),
                PaidInPeriod = suppliers.SelectMany(s => s.Totals).Where(t => t.CurrencyCode == g.Key).Sum(t => t.PaidInPeriod),
                Balance = suppliers.SelectMany(s => s.Totals).Where(t => t.CurrencyCode == g.Key).Sum(t => t.Balance)
            })
            .OrderBy(t => t.CurrencyCode == "TRY" ? 1 : 0).ThenBy(t => t.CurrencyCode)
            .ToList();

        return Ok(new
        {
            success = true,
            data = new
            {
                from = fromDate,
                to = toDate,
                today,
                summary = new
                {
                    orderCount = orders.Count,
                    waitingCount = orders.Count(o => o.Status == "Bekliyor"),
                    partialCount = orders.Count(o => o.Status == "KismiGeldi"),
                    deliveredCount = orders.Count(o => o.Status == "Geldi"),
                    overdueCount = orders.Count(o => o.OverdueDays.HasValue),
                    orderedQuantity = orders.Sum(o => o.OrderedQuantity),
                    deliveredQuantity = orders.Sum(o => o.DeliveredQuantity),
                    remainingQuantity = orders.Sum(o => o.RemainingQuantity),
                    totals
                },
                suppliers,
                orders,
                truncated = roots.Count >= 2000
            }
        });
    }

    /// <summary>
    /// Belgenin para birimi. Damgalı değilse (eski kayıt, 0) kalemlerin ürün kartı dövizine bakılır —
    /// Termin ekranının eski kayıtlarda uyguladığı kuralın aynısı; tek döviz yoksa TL.
    /// </summary>
    private static int DocumentCurrency(PurchaseInvoice invoice)
    {
        if (CurrencyTypeHelper.IsKnown(invoice.CurrencyTypeId) && invoice.CurrencyTypeId != 0) return CurrencyTypeHelper.Normalize(invoice.CurrencyTypeId);
        var productCurrencies = invoice.Lines
            .Select(l => CurrencyTypeHelper.Normalize(l.Product?.CurrencyCode ?? 1))
            .Distinct()
            .ToList();
        return productCurrencies.Count == 1 && CurrencyTypeHelper.IsKnown(productCurrencies[0])
            ? productCurrencies[0]
            : CurrencyTypeHelper.Try;
    }

    private static bool IsStamped(PurchaseInvoice invoice)
        => invoice.CurrencyTypeId != 0 && CurrencyTypeHelper.IsKnown(invoice.CurrencyTypeId);

    /// <summary>Belgenin kendi para birimindeki birim fiyat.</summary>
    private static decimal DocumentUnitPrice(PurchaseInvoiceLine line, PurchaseInvoice invoice)
    {
        if (IsStamped(invoice) && !CurrencyTypeHelper.IsTry(invoice.CurrencyTypeId))
        {
            if (line.CurrencyUnitPrice > 0m) return line.CurrencyUnitPrice;
            var rate = invoice.ExchangeRate > 0m ? invoice.ExchangeRate : 1m;
            return line.UnitPrice / rate;
        }
        // TL belge ya da damgasız eski kayıt: fiyat satırda olduğu gibi durur.
        return line.CurrencyUnitPrice > 0m ? line.CurrencyUnitPrice : line.UnitPrice;
    }

    /// <summary>KDV hariç, iskonto düşülmüş satır tutarı — belgenin kendi para biriminde.</summary>
    private static decimal NetInOwnCurrency(PurchaseInvoiceLine line, PurchaseInvoice invoice)
    {
        var price = DocumentUnitPrice(line, invoice);
        var gross = line.Quantity * price;
        // Tutar iskontosu ADET BAŞINA ve belgenin para biriminde girilir (PurchaseInvoiceMath.Satir).
        var discount = line.DiscountType switch
        {
            PurchaseInvoiceLineDiscountType.Amount => line.DiscountValue * line.Quantity,
            PurchaseInvoiceLineDiscountType.Percentage => gross * line.DiscountValue / 100m,
            _ => 0m
        };
        if (discount < 0m) discount = 0m;
        if (discount > gross) discount = gross;
        return gross - discount;
    }

    /// <summary>Satır tutarının TL karşılığı (belgenin kendi donmuş kuruyla).</summary>
    private static decimal NetInTry(PurchaseInvoiceLine line, PurchaseInvoice invoice)
    {
        var own = NetInOwnCurrency(line, invoice);
        var currency = DocumentCurrency(invoice);
        if (CurrencyTypeHelper.IsTry(currency)) return own;
        var rate = invoice.ExchangeRate > 0m ? invoice.ExchangeRate : 1m;
        return own * rate;
    }

    private sealed record LedgerRow(
        string SupplierCode,
        DateTime Date,
        SupplierLedgerEntryDirection Direction,
        SupplierLedgerEntryReferenceType ReferenceType,
        int CurrencyTypeId,
        decimal Amount,
        decimal CurrencyAmount);

    private sealed class LineDto
    {
        public string StockCode { get; set; } = string.Empty;
        public string StockName { get; set; } = string.Empty;
        public decimal UnitPrice { get; set; }
        public decimal OrderedQuantity { get; set; }
        public decimal DeliveredQuantity { get; set; }
        public decimal RemainingQuantity { get; set; }
        public decimal OrderedAmount { get; set; }
        public decimal DeliveredAmount { get; set; }
        public decimal RemainingAmount { get; set; }

        /// <summary>
        /// Nakliye/işçilik gibi HİZMET satırı (2026-09-18 kullanıcı kararı: "geldi olayı olmasın
        /// ama yazması lazım"). Kalem listesinde GÖRÜNÜR — belgede ne ödendiği okunabilsin diye —
        /// ama teslimat takibine girmez: adetleri, gelen/kalan tutarları ve sipariş durumu mal
        /// satırlarından hesaplanır. Hizmetin "3'ü geldi, 7'si gelmedi" hâli yoktur.
        /// </summary>
        public bool IsService { get; set; }
    }

    private sealed class DeliveryDto
    {
        public int Id { get; set; }
        public string DocumentNo { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public DateTime CreateTime { get; set; }
        public string? CreateUser { get; set; }
        public decimal Quantity { get; set; }
        public decimal Amount { get; set; }
    }

    private sealed class OrderDto
    {
        /// <summary>Belgedeki hizmet (nakliye/işçilik) toplamı; "hizmet hariç" tutar bundan türer.</summary>
        public decimal ServiceAmount { get; set; }

        public int Id { get; set; }
        public string DocumentNo { get; set; } = string.Empty;
        public DateTime Date { get; set; }
        public string SupplierCode { get; set; } = string.Empty;
        public string SupplierName { get; set; } = string.Empty;
        public string? Description { get; set; }
        public string CurrencyCode { get; set; } = "TRY";
        public DateTime? EstimatedArrivalDate { get; set; }
        public string Status { get; set; } = "Bekliyor";
        public int? OverdueDays { get; set; }
        public DateTime? LastDeliveryDate { get; set; }
        public string? CreateUser { get; set; }
        public decimal OrderedQuantity { get; set; }
        public decimal DeliveredQuantity { get; set; }
        public decimal RemainingQuantity { get; set; }
        public decimal OrderedAmount { get; set; }
        public decimal DeliveredAmount { get; set; }
        public decimal RemainingAmount { get; set; }
        public List<LineDto> Lines { get; set; } = new();
        public List<DeliveryDto> Deliveries { get; set; } = new();
    }

    private sealed class CurrencyTotalDto
    {
        public string CurrencyCode { get; set; } = "TRY";
        public decimal OrderedAmount { get; set; }
        public decimal DeliveredAmount { get; set; }
        public decimal RemainingAmount { get; set; }
        public decimal PaidInPeriod { get; set; }
        public decimal Balance { get; set; }
    }

    private sealed class SupplierDto
    {
        public string SupplierCode { get; set; } = string.Empty;
        public string SupplierName { get; set; } = string.Empty;
        public int OrderCount { get; set; }
        public int OpenOrderCount { get; set; }
        public int OverdueOrderCount { get; set; }
        public decimal OrderedQuantity { get; set; }
        public decimal DeliveredQuantity { get; set; }
        public decimal RemainingQuantity { get; set; }
        public List<CurrencyTotalDto> Totals { get; set; } = new();
    }
}
