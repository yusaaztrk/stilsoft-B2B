using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

/// <summary>
/// E-ticaret mutabakatı: POS ↔ sipariş ↔ fatura üçlüsünün birbirini tutmadığı yerler.
///
/// NEDEN GEREKLİ: bu üç kayıt üç ayrı anda ve üç ayrı aktör tarafından doğuyor — banka, müşteri,
/// bayi. Aralarındaki bağ her koşulda kurulmuş olsa bile bir tanesi eksik kalabiliyor: callback
/// hiç gelmez, bayi faturayı elle keser, eşzamanlı iki callback tekil indekse takılır. Bunların
/// hiçbiri hata olarak patlamaz; sessizce durur. Rapor tam da o sessiz halleri arıyor.
///
/// RAPOR HİÇBİR ŞEYİ DÜZELTMEZ, yalnızca gösterir. Para hareketiyle ilgili bir kaydı otomatik
/// düzeltmek, yanlış tespitte parayı ikinci kez oynatmak demek olurdu; kararı insan verir.
///
/// Uç sunucu-sunucu anahtarıyla korunuyor: bayi paneli mağaza API'si üzerinden geliyor ve o da
/// kendi tarafındaki olay kaydını bu sonuca ekliyor.
/// </summary>
[ApiController]
[Authorize]
public sealed class EcommerceReconciliationController : ControllerBase
{
    private readonly AppDbContext _db;

    /// <summary>Siparişin e-ticaretten geldiğini gösteren işaret (<c>SalesOrder.ProcessedBy</c>).</summary>
    private const string EcommerceMarker = "ETICARET";

    /// <summary>
    /// Bu süreden eski bir <c>Pending</c> deneme artık "müşteri banka sayfasında" değildir.
    /// Ödeme servisindeki 15 dakikalık pencerenin üstünde tutuluyor: pencere içindeki bekleme
    /// normal işleyiş, rapor onu sorun diye göstermemeli.
    /// </summary>
    private static readonly TimeSpan StaleAttempt = TimeSpan.FromMinutes(30);

    public EcommerceReconciliationController(AppDbContext db)
    {
        _db = db;
    }

    public sealed class Finding
    {
        /// <summary>Makine tarafı: ekran gruplama ve filtreleme buna bakar.</summary>
        public string Kind { get; set; } = string.Empty;

        /// <summary>kritik | uyari | bilgi</summary>
        public string Severity { get; set; } = "bilgi";

        public string OrderNo { get; set; } = string.Empty;
        public string CustomerCode { get; set; } = string.Empty;
        public string? CustomerName { get; set; }
        public decimal OrderTotal { get; set; }
        public decimal? PaidAmount { get; set; }
        public string? InvoiceNo { get; set; }
        public DateTime OrderedAt { get; set; }

        /// <summary>Ekranda okunan cümle. Rapor teknik bilgi değil, yapılacak iş anlatmalı.</summary>
        public string Message { get; set; } = string.Empty;
    }

    [HttpGet("/api/ecommerce/reconciliation")]
    [InternalApiKey]
    public async Task<IActionResult> Get([FromQuery] int days, CancellationToken ct)
    {
        // Sınır: rapor bütün tarihi tarayarak açılmamalı, ama tek günlük pencere de gerçek
        // sorunları gözden kaçırır (fatura günler sonra kesilebiliyor).
        var window = days <= 0 ? 30 : Math.Min(days, 365);
        var since = DateTime.UtcNow.AddDays(-window);

        var orders = await _db.Set<SalesOrder>()
            .AsNoTracking()
            .Where(o => o.ProcessedBy.ToUpper() == EcommerceMarker && o.ProcessedAt >= since)
            .Select(o => new
            {
                o.Id,
                o.OrderNo,
                o.CustomerCode,
                o.GrandTotal,
                o.ProcessedAt,
                LineIds = o.Lines.Select(l => l.Id).ToList()
            })
            .ToListAsync(ct);

        if (orders.Count == 0)
        {
            // Boş sonuç da dolu sonuçla AYNI şekli döner: ekran "counts yoksa" diye ikinci bir
            // hâl bilmek zorunda kalmamalı.
            return Ok(new
            {
                success = true,
                data = new
                {
                    window,
                    generatedAt = DateTime.UtcNow,
                    counts = new { kritik = 0, uyari = 0, bilgi = 0 },
                    findings = Array.Empty<Finding>()
                }
            });
        }

        var orderNos = orders.Select(x => x.OrderNo).ToList();
        var customerCodes = orders.Select(x => x.CustomerCode).Distinct().ToList();
        var allLineIds = orders.SelectMany(x => x.LineIds).ToList();

        var payments = await _db.EcommerceOrderPayments
            .AsNoTracking()
            .Where(p => orderNos.Contains(p.SalesOrderNo))
            .ToListAsync(ct);

        // POS işlemi tahsilat satırına sipariş numarasıyla DEĞİL, bankaya verilen numarayla
        // bağlanıyor (MerchantOrderId ↔ VirtualPosTransaction.OrderNo). Bu ayrım önemli:
        // bankanın elinde ERP sipariş numarası hiç yok.
        var merchantIds = payments.Select(p => p.MerchantOrderId).Where(x => !string.IsNullOrEmpty(x)).ToList();

        var posByMerchantId = merchantIds.Count == 0
            ? new Dictionary<string, (bool IsSuccess, decimal Amount)>()
            : (await _db.Set<VirtualPosTransaction>()
                .AsNoTracking()
                .Where(t => merchantIds.Contains(t.OrderNo))
                .Select(t => new { t.OrderNo, t.IsSuccess, t.Amount })
                .ToListAsync(ct))
              .GroupBy(x => x.OrderNo)
              // Aynı numara için birden çok satır varsa başarılı olan belirleyicidir.
              .ToDictionary(g => g.Key, g =>
              {
                  var win = g.FirstOrDefault(x => x.IsSuccess) ?? g.First();
                  return (win.IsSuccess, win.Amount);
              });

        var invoiceByLineId = (await _db.Set<InvoiceLine>()
            .AsNoTracking()
            .Where(l => l.SalesOrderLineId != null && allLineIds.Contains(l.SalesOrderLineId!.Value))
            .Join(_db.Set<Invoice>().AsNoTracking(),
                l => l.InvoiceId, i => i.Id,
                (l, i) => new { l.SalesOrderLineId, i.InvoiceNo })
            .ToListAsync(ct))
            .Where(x => x.SalesOrderLineId != null)
            .GroupBy(x => x.SalesOrderLineId!.Value)
            .ToDictionary(g => g.Key, g => g.First().InvoiceNo);

        var customerNames = await _db.Customers
            .AsNoTracking()
            .Where(c => customerCodes.Contains(c.CustomerCode))
            .Select(c => new { c.CustomerCode, c.Name })
            .ToDictionaryAsync(x => x.CustomerCode, x => x.Name, ct);

        var findings = new List<Finding>();
        var now = DateTime.UtcNow;

        foreach (var order in orders)
        {
            var attempts = payments.Where(p => p.SalesOrderNo == order.OrderNo).ToList();
            var paid = attempts.FirstOrDefault(p => p.Status == (int)EcommercePaymentStatus.Paid);
            var invoiceNo = order.LineIds
                .Select(id => invoiceByLineId.TryGetValue(id, out var no) ? no : null)
                .FirstOrDefault(x => x is not null);

            Finding New(string kind, string severity, string message) => new()
            {
                Kind = kind,
                Severity = severity,
                OrderNo = order.OrderNo,
                CustomerCode = order.CustomerCode,
                CustomerName = customerNames.TryGetValue(order.CustomerCode, out var n) ? n : null,
                OrderTotal = order.GrandTotal,
                PaidAmount = paid?.Amount,
                InvoiceNo = invoiceNo,
                OrderedAt = order.ProcessedAt,
                Message = message
            };

            // 1. İnsan bakması gereken tahsilat. Listenin en tepesindeki iş bu.
            foreach (var review in attempts.Where(p => p.Status == (int)EcommercePaymentStatus.NeedsReview))
            {
                findings.Add(New("inceleme-bekleyen", "kritik",
                    $"Tahsilat inceleme bekliyor: {review.FailureMessage}. İade gerekip gerekmediğine bakılmalı."));
            }

            // 2. Mal çıktı, para yok. Faturalı ama ödenmemiş sipariş.
            if (invoiceNo is not null && paid is null)
            {
                findings.Add(New("faturali-odenmemis", "kritik",
                    $"{invoiceNo} numaralı fatura kesilmiş ama bu siparişin onaylanmış tahsilatı yok."));
            }

            if (paid is not null)
            {
                posByMerchantId.TryGetValue(paid.MerchantOrderId, out var pos);
                var hasPos = posByMerchantId.ContainsKey(paid.MerchantOrderId);

                // 3. ERP "ödendi" diyor ama bankaya giden işlem başarılı görünmüyor.
                if (!hasPos)
                {
                    findings.Add(New("tahsilat-pos-kaydi-yok", "kritik",
                        "Sipariş ödenmiş görünüyor ama karşılığında sanal POS işlemi bulunamadı."));
                }
                else if (!pos.IsSuccess)
                {
                    findings.Add(New("tahsilat-pos-basarisiz", "kritik",
                        "Sipariş ödenmiş görünüyor ama sanal POS işlemi başarısız kayıtlı."));
                }
                else if (Math.Abs(pos.Amount - paid.Amount) > 0.01m)
                {
                    findings.Add(New("pos-tutar-farki", "kritik",
                        $"Bankadan geçen tutar {pos.Amount:0.00}, siparişe yazılan tahsilat {paid.Amount:0.00}."));
                }

                // 4. Sipariş ödeme sonrasında düzenlenmiş olabilir.
                if (Math.Abs(paid.Amount - order.GrandTotal) > 0.01m)
                {
                    findings.Add(New("siparis-tutar-farki", "uyari",
                        $"Tahsil edilen {paid.Amount:0.00}, siparişin şu anki tutarı {order.GrandTotal:0.00}. Sipariş ödemeden sonra değişmiş olabilir."));
                }

                // 5. Ödendi, faturası yok. Normal bir aşama — ama beklerse iş takılmıştır.
                if (invoiceNo is null)
                {
                    var age = (int)(now - (paid.SettledAtUtc ?? paid.CreatedAtUtc)).TotalDays;
                    findings.Add(New("odendi-faturasiz", age >= 3 ? "uyari" : "bilgi",
                        age >= 3
                            ? $"Ödeme alınalı {age} gün oldu, fatura hâlâ kesilmemiş."
                            : "Ödeme alındı, sevkiyat faturası bekleniyor."));
                }
            }
            else
            {
                // 6. Bankaya gitmiş ama sonucu hiç öğrenilememiş deneme.
                foreach (var stuck in attempts.Where(p =>
                             p.Status == (int)EcommercePaymentStatus.Pending &&
                             now - p.CreatedAtUtc > StaleAttempt))
                {
                    var hasPos = posByMerchantId.TryGetValue(stuck.MerchantOrderId, out var pos);

                    // POS başarılı ama tahsilat satırı hâlâ bekliyorsa para gitmiş, sipariş
                    // kapanmamıştır: bu, raporun bulabileceği en pahalı hâl.
                    findings.Add(hasPos && pos.IsSuccess
                        ? New("pos-basarili-siparis-kapanmamis", "kritik",
                            "Sanal POS işlemi başarılı ama sipariş ödenmiş olarak kapanmamış. Para tahsil edilmiş olabilir.")
                        : New("askida-deneme", "uyari",
                            $"Ödeme denemesi {(int)(now - stuck.CreatedAtUtc).TotalHours} saattir sonuçsuz duruyor."));
                }
            }
        }

        // 7. E-ticaret carisine ait başarılı POS işlemi olup hiçbir siparişe bağlanmayanlar.
        // Buradaki para nereye yazılacağı belli olmayan paradır.
        var knownMerchantIds = payments.Select(p => p.MerchantOrderId).ToHashSet(StringComparer.Ordinal);

        var orphanPos = await _db.Set<VirtualPosTransaction>()
            .AsNoTracking()
            .Where(t => t.IsSuccess
                        && t.CreateTime >= since
                        && t.CustomerCode.StartsWith("120-11-"))
            .Select(t => new { t.OrderNo, t.CustomerCode, t.Amount, t.CreateTime })
            .ToListAsync(ct);

        foreach (var pos in orphanPos.Where(x => !knownMerchantIds.Contains(x.OrderNo)))
        {
            findings.Add(new Finding
            {
                Kind = "sahipsiz-tahsilat",
                Severity = "kritik",
                OrderNo = pos.OrderNo,
                CustomerCode = pos.CustomerCode,
                CustomerName = customerNames.TryGetValue(pos.CustomerCode, out var n) ? n : null,
                OrderTotal = 0m,
                PaidAmount = pos.Amount,
                OrderedAt = pos.CreateTime,
                Message = $"{pos.Amount:0.00} tutarında başarılı POS işlemi hiçbir e-ticaret siparişine bağlı değil."
            });
        }

        var order2 = new Dictionary<string, int> { ["kritik"] = 0, ["uyari"] = 1, ["bilgi"] = 2 };

        return Ok(new
        {
            success = true,
            data = new
            {
                window,
                generatedAt = DateTime.UtcNow,
                counts = new
                {
                    kritik = findings.Count(x => x.Severity == "kritik"),
                    uyari = findings.Count(x => x.Severity == "uyari"),
                    bilgi = findings.Count(x => x.Severity == "bilgi")
                },
                findings = findings
                    .OrderBy(x => order2.TryGetValue(x.Severity, out var v) ? v : 3)
                    .ThenByDescending(x => x.OrderedAt)
                    .ToList()
            }
        });
    }
}
