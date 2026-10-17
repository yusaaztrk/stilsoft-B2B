using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Features.Ecommerce;

/// <summary>
/// HAVALE / EFT ile e-ticaret ödemesi (2026-09-20 kullanıcı kararı: kapıda ödeme YOK, havale VAR).
///
/// <para>
/// Akış: müşteri ödeme adımında "Havale/EFT" seçer → sipariş için <see cref="EcommercePaymentStatus.BankTransferRequested"/>
/// satırı açılır ("Havale/EFT istendi") → IBAN'lar ve sipariş numarası ekranda/SMS'te → müşteri
/// parayı gönderince "Gönderdim" der → <see cref="EcommercePaymentStatus.BankTransferSent"/> (onay
/// bekliyor) → bayi panelde banka hesabını seçip "Ödeme alındı" der → satır <see cref="EcommercePaymentStatus.Paid"/>
/// olur ve kart ödemesiyle AYNI tamamlama (montaj/kargo/SMS) koşar. Banka hareketi (cari tahsilat)
/// panel tarafından mevcut banka hareketi ucuyla yazılır; burada muhasebe tekrar edilmez.
/// </para>
///
/// <para>
/// "Gönderdim" gelmeyen sipariş <c>timeoutHours</c> sonunda kendiliğinden düşer (<see cref="ExpireAsync"/>);
/// süre mağaza ayarında. Müşteri vazgeçip kartla öderse kart yolu normal çalışır: havale satırı
/// Paid'e engel değildir, onay anında sipariş zaten ödenmişse havale kaydı Failed'a çekilir.
/// </para>
/// </summary>
public sealed class EcommerceBankTransferService
{
    private const string EcommerceCustomerPrefix = "120-11-";
    private const string EcommerceProcessedBy = "ETICARET";

    private readonly AppDbContext _dbContext;
    private readonly EcommerceFulfilmentService _fulfilment;
    private readonly ILogger<EcommerceBankTransferService> _logger;

    public EcommerceBankTransferService(AppDbContext dbContext, EcommerceFulfilmentService fulfilment, ILogger<EcommerceBankTransferService> logger)
    {
        _dbContext = dbContext;
        _fulfilment = fulfilment;
        _logger = logger;
    }

    public sealed record BankTransferResult(bool Success, string? Error, string? Status, decimal Amount, string OrderNo);

    private static bool IsBankTransfer(EcommerceOrderPayment p)
        => p.Status == (int)EcommercePaymentStatus.BankTransferRequested || p.Status == (int)EcommercePaymentStatus.BankTransferSent;

    /// <summary>Müşteri "Havale/EFT" seçti: sipariş için havale kaydı açılır (varsa aynen döner).</summary>
    public async Task<BankTransferResult> RequestAsync(string customerCode, string orderNo, CancellationToken ct)
    {
        customerCode = (customerCode ?? string.Empty).Trim();
        orderNo = (orderNo ?? string.Empty).Trim();

        var order = await ResolveOrderAsync(customerCode, orderNo, ct);
        if (order is null) return new BankTransferResult(false, "Sipariş bulunamadı.", null, 0m, orderNo);

        var attempts = await _dbContext.EcommerceOrderPayments.Where(x => x.SalesOrderNo == orderNo).ToListAsync(ct);
        if (attempts.Any(x => x.Status == (int)EcommercePaymentStatus.Paid))
            return new BankTransferResult(false, "Bu sipariş zaten ödenmiş.", "Paid", order.GrandTotal, orderNo);

        var existing = attempts.FirstOrDefault(IsBankTransfer);
        if (existing is not null)
            return new BankTransferResult(true, null, ((EcommercePaymentStatus)existing.Status).ToString(), existing.Amount, orderNo);

        _dbContext.EcommerceOrderPayments.Add(new EcommerceOrderPayment
        {
            MerchantOrderId = $"HAVALE-{orderNo}-{DateTime.UtcNow:yyyyMMddHHmmss}",
            SalesOrderNo = orderNo,
            CustomerCode = order.CustomerCode,
            Amount = order.GrandTotal,
            CurrencyCode = "TRY",
            Status = (int)EcommercePaymentStatus.BankTransferRequested,
            AuthCode = "HAVALE",
            CreatedAtUtc = DateTime.UtcNow
        });
        await _dbContext.SaveChangesAsync(ct);

        return new BankTransferResult(true, null, EcommercePaymentStatus.BankTransferRequested.ToString(), order.GrandTotal, orderNo);
    }

    /// <summary>Müşteri "Gönderdim" dedi.</summary>
    public async Task<BankTransferResult> MarkSentAsync(string customerCode, string orderNo, string? note, CancellationToken ct)
    {
        customerCode = (customerCode ?? string.Empty).Trim();
        orderNo = (orderNo ?? string.Empty).Trim();

        var order = await ResolveOrderAsync(customerCode, orderNo, ct);
        if (order is null) return new BankTransferResult(false, "Sipariş bulunamadı.", null, 0m, orderNo);

        var row = await _dbContext.EcommerceOrderPayments
            .Where(x => x.SalesOrderNo == orderNo)
            .OrderByDescending(x => x.CreatedAtUtc)
            .FirstOrDefaultAsync(x => x.Status == (int)EcommercePaymentStatus.BankTransferRequested
                                   || x.Status == (int)EcommercePaymentStatus.BankTransferSent, ct);
        if (row is null) return new BankTransferResult(false, "Bu sipariş için havale kaydı yok.", null, order.GrandTotal, orderNo);

        if (row.Status == (int)EcommercePaymentStatus.BankTransferRequested)
        {
            row.Status = (int)EcommercePaymentStatus.BankTransferSent;
            row.FailureMessage = Truncate(note, 500);
            row.SettledAtUtc = null;
            await _dbContext.SaveChangesAsync(ct);
        }

        return new BankTransferResult(true, null, EcommercePaymentStatus.BankTransferSent.ToString(), row.Amount, orderNo);
    }

    /// <summary>Bayi "Ödeme alındı" dedi: kart ödemesiyle aynı tamamlama koşar.</summary>
    public async Task<BankTransferResult> ConfirmAsync(string orderNo, string? reference, CancellationToken ct)
    {
        orderNo = (orderNo ?? string.Empty).Trim();

        var order = await _dbContext.Set<SalesOrder>().AsNoTracking().FirstOrDefaultAsync(x => x.OrderNo == orderNo, ct);
        if (order is null) return new BankTransferResult(false, "Sipariş bulunamadı.", null, 0m, orderNo);

        var attempts = await _dbContext.EcommerceOrderPayments.Where(x => x.SalesOrderNo == orderNo).ToListAsync(ct);
        var row = attempts.Where(IsBankTransfer).OrderByDescending(x => x.CreatedAtUtc).FirstOrDefault();
        if (row is null) return new BankTransferResult(false, "Bu sipariş için havale kaydı yok.", null, order.GrandTotal, orderNo);

        if (attempts.Any(x => x.Status == (int)EcommercePaymentStatus.Paid))
        {
            // Müşteri bu arada kartla ödemiş: havale kaydı düşer, çift tahsilat olmaz.
            row.Status = (int)EcommercePaymentStatus.Failed;
            row.FailureMessage = "Sipariş kartla ödendi; havale kaydı kapatıldı.";
            row.SettledAtUtc = DateTime.UtcNow;
            await _dbContext.SaveChangesAsync(ct);
            return new BankTransferResult(false, "Bu sipariş zaten kartla ödenmiş.", "Paid", order.GrandTotal, orderNo);
        }

        // Kart yolundaki kural: tutar değiştiyse otomatik kapatma.
        if (Math.Round(order.GrandTotal, 2) != Math.Round(row.Amount, 2))
        {
            return new BankTransferResult(false,
                $"Sipariş tutarı değişmiş (havale kaydı {row.Amount:N2}, sipariş {order.GrandTotal:N2}). Kaydı reddedip yeniden açın.",
                ((EcommercePaymentStatus)row.Status).ToString(), row.Amount, orderNo);
        }

        row.Status = (int)EcommercePaymentStatus.Paid;
        row.AuthCode = Truncate(string.IsNullOrWhiteSpace(reference) ? "HAVALE" : $"HAVALE {reference}", 50);
        row.FailureMessage = string.Empty;
        row.SettledAtUtc = DateTime.UtcNow;

        try
        {
            await _dbContext.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            _logger.LogError(ex, "[Ecommerce] Havale onayı: {OrderNo} için ikinci Paid satırı reddedildi.", orderNo);
            _dbContext.Entry(row).State = EntityState.Detached;
            return new BankTransferResult(false, "Bu sipariş zaten ödenmiş görünüyor.", "Paid", order.GrandTotal, orderNo);
        }

        // Kart ödemesiyle aynı tamamlama: montaj/kargo kaydı ve "siparişiniz alındı" mesajı.
        await _fulfilment.RunAsync(orderNo, ct);

        return new BankTransferResult(true, null, EcommercePaymentStatus.Paid.ToString(), row.Amount, orderNo);
    }

    /// <summary>Bayi reddetti ya da para gelmedi: kayıt Failed, müşteri isterse yeniden dener.</summary>
    public async Task<BankTransferResult> RejectAsync(string orderNo, string? reason, CancellationToken ct)
    {
        orderNo = (orderNo ?? string.Empty).Trim();
        var row = await _dbContext.EcommerceOrderPayments
            .Where(x => x.SalesOrderNo == orderNo)
            .OrderByDescending(x => x.CreatedAtUtc)
            .FirstOrDefaultAsync(x => x.Status == (int)EcommercePaymentStatus.BankTransferRequested
                                   || x.Status == (int)EcommercePaymentStatus.BankTransferSent, ct);
        if (row is null) return new BankTransferResult(false, "Açık havale kaydı yok.", null, 0m, orderNo);

        row.Status = (int)EcommercePaymentStatus.Failed;
        row.FailureMessage = Truncate(string.IsNullOrWhiteSpace(reason) ? "Havale onaylanmadı." : reason, 500);
        row.SettledAtUtc = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(ct);
        return new BankTransferResult(true, null, EcommercePaymentStatus.Failed.ToString(), row.Amount, orderNo);
    }

    /// <summary>
    /// "Gönderdim" gelmemiş, süresi dolmuş havale isteklerini kapatır. Zamanlayıcı yok; mağaza
    /// sipariş listesini her okuyuşunda çağırır (tembel süre aşımı). Döndürdüğü liste SMS için.
    /// </summary>
    public async Task<IReadOnlyList<(string OrderNo, string CustomerCode)>> ExpireAsync(int timeoutHours, CancellationToken ct)
    {
        if (timeoutHours < 1) timeoutHours = 72;
        var limit = DateTime.UtcNow.AddHours(-timeoutHours);

        var stale = await _dbContext.EcommerceOrderPayments
            .Where(x => x.Status == (int)EcommercePaymentStatus.BankTransferRequested && x.CreatedAtUtc < limit)
            .ToListAsync(ct);

        foreach (var row in stale)
        {
            row.Status = (int)EcommercePaymentStatus.Failed;
            row.FailureMessage = $"Havale {timeoutHours} saat içinde bildirilmedi; sipariş kendiliğinden kapatıldı.";
            row.SettledAtUtc = DateTime.UtcNow;
        }
        if (stale.Count > 0) await _dbContext.SaveChangesAsync(ct);

        return stale.Select(x => (x.SalesOrderNo, x.CustomerCode)).ToList();
    }

    /// <summary>Panel listesi: açık havale kayıtları (istendi / gönderildi).</summary>
    public async Task<IReadOnlyList<object>> ListOpenAsync(CancellationToken ct)
    {
        var rows = await _dbContext.EcommerceOrderPayments
            .AsNoTracking()
            .Where(x => x.Status == (int)EcommercePaymentStatus.BankTransferRequested || x.Status == (int)EcommercePaymentStatus.BankTransferSent)
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(ct);

        var orderNos = rows.Select(x => x.SalesOrderNo).ToList();
        var orders = await _dbContext.Set<SalesOrder>()
            .AsNoTracking()
            .Where(x => orderNos.Contains(x.OrderNo))
            .Select(x => new { x.OrderNo, x.CustomerCode, x.DeliveryName, x.DeliveryPhone, x.GrandTotal, x.CreateTime })
            .ToListAsync(ct);
        var byNo = orders.ToDictionary(x => x.OrderNo, x => x);

        return rows.Select(r =>
        {
            byNo.TryGetValue(r.SalesOrderNo, out var o);
            return (object)new
            {
                orderNo = r.SalesOrderNo,
                customerCode = r.CustomerCode,
                customerName = o?.DeliveryName,
                phone = o?.DeliveryPhone,
                amount = r.Amount,
                status = ((EcommercePaymentStatus)r.Status).ToString(),
                note = r.FailureMessage,
                requestedAtUtc = r.CreatedAtUtc,
                orderedAtUtc = o?.CreateTime
            };
        }).ToList();
    }

    private async Task<SalesOrder?> ResolveOrderAsync(string customerCode, string orderNo, CancellationToken ct)
    {
        if (!customerCode.StartsWith(EcommerceCustomerPrefix, StringComparison.Ordinal)) return null;
        var order = await _dbContext.Set<SalesOrder>().AsNoTracking().FirstOrDefaultAsync(x => x.OrderNo == orderNo, ct);
        if (order is null || !string.Equals(order.CustomerCode, customerCode, StringComparison.Ordinal)) return null;
        if (!string.Equals(order.ProcessedBy, EcommerceProcessedBy, StringComparison.Ordinal)) return null;
        if (order.GrandTotal <= 0) return null;
        return order;
    }

    private static string Truncate(string? value, int max)
    {
        var text = (value ?? string.Empty).Trim();
        return text.Length <= max ? text : text.Substring(0, max);
    }
}
