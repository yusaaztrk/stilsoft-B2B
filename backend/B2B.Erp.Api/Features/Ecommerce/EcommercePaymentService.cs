using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.VirtualPos;
using B2B.Erp.Api.Features.VirtualPos.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace B2B.Erp.Api.Features.Ecommerce;

public sealed record EcommercePaymentStartResult(
    bool Success,
    string? Message,
    string? HtmlForm,
    string? MerchantOrderId);

/// <summary>
/// <paramref name="OrderTotal"/> siparişin ŞU ANKİ tutarı — ödenecek olan bu.
/// <paramref name="Amount"/> ise son denemenin tutarı; ödeme sürerken sipariş düzenlenmişse
/// ikisi ayrışır ve bu ayrışma tahsilatın kapanmasını engelleyen bir durumdur.
/// </summary>
public sealed record EcommercePaymentStatusResult(
    string SalesOrderNo,
    bool IsPaid,
    string Status,
    decimal OrderTotal,
    decimal Amount,
    string CurrencyCode,
    DateTime? PaidAtUtc,
    string AuthCode,
    string Message);

/// <summary>Callback sonrası ödemenin siparişe yansıması. Mağaza değil, banka yanıtı belirler.</summary>
public sealed record EcommerceSettlementResult(string SalesOrderNo, bool IsPaid, bool NeedsReview);

/// <summary>
/// E-ticaret siparişlerinin sanal POS ile tahsilatı.
///
/// Var olma sebebi: sanal POS'un kendi ucu (<c>/api/virtual-pos/pay-3d</c>) bayi oturumu
/// istiyor, e-ticaret müşterisinin ise B2B kullanıcısı yok. İkinci bir POS entegrasyonu
/// yazmak yerine doğrulaması kanıtlanmış olanın üstüne, e-ticarete özgü üç kural konuyor:
///
///   1. İMZA — bankanın "ödeme başarılı" demesi tek başına yeterli değil. Banka callback'i
///      hangi adrese gittiğini denetlemez; sonucun gerçekten bankadan geldiğinin ve yolda
///      değişmediğinin TEK kanıtı imza doğrulaması. Bu doğrulama sağlayıcıların içinde
///      (NestPayCallbackVerifier / GarantiCallbackVerifier) ve kapalı-başarısız çalışıyor:
///      imza yoksa ya da tutmuyorsa ödeme başarısız sayılır. Burada bir "ama başarılı yazıyor"
///      istisnası AÇILMAZ.
///
///   2. TUTAR — karttan çekilecek tutar İSTEMCİDEN ALINMAZ. Sipariş numarası alınır, tutar
///      siparişin kendisinden okunur. Böylece "tutar eşleşmeli" kuralı bir karşılaştırmaya
///      değil, tek bir kaynağa dayanıyor: eşleşmemesi mümkün değil. Bankadan dönen tutar ayrıca
///      VirtualPosService içinde bu tutarla karşılaştırılıyor, tahsilat anında da sipariş tutarı
///      bir daha okunuyor (arada sipariş düzenlenmiş olabilir).
///
///   3. TEKİLLİK — bir sipariş en fazla bir kez ödenmiş sayılır. Kontrol hem burada (ödeme
///      başlatılmadan) hem veritabanında (kısmi tekil indeks) var; ikincisi eşzamanlı iki
///      callback'in ikisinin birden yazmasını imkânsız kılıyor.
///
/// Üçü de olmazsa doğrudan para kaybı: testte fark edilmez, canlıda edilir.
/// </summary>
public sealed class EcommercePaymentService
{
    private readonly AppDbContext _dbContext;
    private readonly IVirtualPosService _virtualPos;
    private readonly EcommerceFulfilmentService _fulfilment;
    private readonly ILogger<EcommercePaymentService> _logger;

    /// <summary>
    /// Bir denemenin "hâlâ sürüyor" sayılacağı süre. Müşteri banka sayfasındayken ikinci bir
    /// deneme başlatılırsa iki ödeme birden onaylanabilir; 3D oturumları bu süreden kısa.
    /// </summary>
    private static readonly TimeSpan InFlightWindow = TimeSpan.FromMinutes(15);

    /// <summary>E-ticaret carilerinin kod öneki. Bu ucun dokunabileceği tek cari grubu.</summary>
    private const string EcommerceCustomerPrefix = "120-11-";

    /// <summary>E-ticaret siparişlerinin işaretlendiği alan; bayi siparişi bu uçtan ödenemez.</summary>
    private const string EcommerceProcessedBy = "ETICARET";

    public EcommercePaymentService(
        AppDbContext dbContext,
        IVirtualPosService virtualPos,
        EcommerceFulfilmentService fulfilment,
        ILogger<EcommercePaymentService> logger)
    {
        _dbContext = dbContext;
        _virtualPos = virtualPos;
        _fulfilment = fulfilment;
        _logger = logger;
    }

    /// <summary>
    /// Siparişin ödenebilir olup olmadığını ve tutarını çözer.
    ///
    /// Cari kodu isteğe göre değil, siparişin sahibine göre denetleniyor: başkasının sipariş
    /// numarasını bilen biri o siparişi ödeyemez — ve daha önemlisi, ödeme ekranında
    /// başkasının sipariş tutarını göremez.
    /// </summary>
    private async Task<(SalesOrder? Order, string? Error)> ResolvePayableOrderAsync(
        string customerCode,
        string salesOrderNo,
        CancellationToken ct)
    {
        if (!customerCode.StartsWith(EcommerceCustomerPrefix, StringComparison.Ordinal))
        {
            return (null, "Bu cari e-ticaret ödemesi yapamaz.");
        }

        var order = await _dbContext.Set<SalesOrder>()
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.OrderNo == salesOrderNo, ct);

        // Bulunamadı ile "sana ait değil" aynı cevabı veriyor: aksi hâlde sipariş numaraları
        // denenerek hangilerinin var olduğu öğrenilebilirdi.
        if (order is null || !string.Equals(order.CustomerCode, customerCode, StringComparison.Ordinal))
        {
            return (null, "Sipariş bulunamadı.");
        }

        if (!string.Equals(order.ProcessedBy, EcommerceProcessedBy, StringComparison.Ordinal))
        {
            return (null, "Bu sipariş e-ticaret siparişi değil.");
        }

        if (order.GrandTotal <= 0)
        {
            return (null, "Sipariş tutarı geçersiz.");
        }

        return (order, null);
    }

    /// <summary>
    /// Ödeme başlatmadan önceki tekillik kapısı.
    ///
    /// Veritabanındaki kısmi tekil indeks son sözü söylüyor; buradaki kontrol kullanıcıya
    /// anlaşılır bir cevap vermek ve ödenmiş bir siparişin bankaya hiç gitmemesini sağlamak
    /// için. İkisi birbirinin yedeği değil, ikisi de gerekli: burası parayı hareket etmeden
    /// durduruyor, indeks hareket ettikten sonra kaydı koruyor.
    /// </summary>
    private async Task<string?> RejectIfNotPayableAsync(string salesOrderNo, CancellationToken ct)
    {
        var attempts = await _dbContext.EcommerceOrderPayments
            .AsNoTracking()
            .Where(x => x.SalesOrderNo == salesOrderNo)
            .ToListAsync(ct);

        if (attempts.Any(x => x.Status == (int)EcommercePaymentStatus.Paid))
        {
            return "Bu sipariş zaten ödenmiş.";
        }

        if (attempts.Any(x => x.Status == (int)EcommercePaymentStatus.NeedsReview))
        {
            // Para hareket etmiş ama kayıt kapanmamış. Üstüne ikinci bir tahsilat eklemek
            // çözülecek karışıklığı büyütür.
            return "Bu sipariş için bekleyen bir ödeme incelemesi var. Lütfen bizimle irtibata geçin.";
        }

        var inFlightSince = DateTime.UtcNow.Subtract(InFlightWindow);
        if (attempts.Any(x => x.Status == (int)EcommercePaymentStatus.Pending && x.CreatedAtUtc > inFlightSince))
        {
            return "Bu sipariş için bir ödeme işlemi sürüyor. Lütfen biraz bekleyip tekrar deneyin.";
        }

        return null;
    }

    /// <summary>
    /// Ödemeyi başlatır ve bankanın 3D formunu döner.
    ///
    /// Tutar parametrede YOK — bilerek. Sipariş numarası veriliyor, tutar siparişten okunuyor.
    /// </summary>
    public async Task<EcommercePaymentStartResult> StartAsync(
        string customerCode,
        string salesOrderNo,
        VirtualPosPaymentRequest card,
        string callbackUrl,
        CancellationToken ct)
    {
        customerCode = (customerCode ?? string.Empty).Trim();
        salesOrderNo = (salesOrderNo ?? string.Empty).Trim();

        var (order, orderError) = await ResolvePayableOrderAsync(customerCode, salesOrderNo, ct);
        if (order is null)
        {
            return new EcommercePaymentStartResult(false, orderError, null, null);
        }

        var blocked = await RejectIfNotPayableAsync(salesOrderNo, ct);
        if (blocked is not null)
        {
            return new EcommercePaymentStartResult(false, blocked, null, null);
        }

        var merchantOrderId = MerchantOrderId.New();

        // Bağ, bankaya gitmeden ÖNCE yazılıyor. Banka callback'i, sonradan yapılacak bir
        // yazmanın commit olmasından hızlı gelebilir; kaydı bulamayan bir callback ödemeyi
        // sahipsiz bırakırdı.
        var attempt = new EcommerceOrderPayment
        {
            MerchantOrderId = merchantOrderId,
            SalesOrderNo = order.OrderNo,
            CustomerCode = order.CustomerCode,
            Amount = order.GrandTotal,
            CurrencyCode = "TRY",
            Status = (int)EcommercePaymentStatus.Pending,
            CreatedAtUtc = DateTime.UtcNow
        };

        _dbContext.EcommerceOrderPayments.Add(attempt);
        await _dbContext.SaveChangesAsync(ct);

        // Tutar ve cari İSTEKTEN DEĞİL, siparişten. İstemcinin gönderdiği tutar alanı varsa
        // burada üzerine yazılıyor — e-ticaretin en klasik açığı bu.
        card.Amount = order.GrandTotal;
        card.CustomerCode = order.CustomerCode;
        card.CallbackUrl = callbackUrl;

        // Siparişin kendi para birimi alanı yok: satırları CurrencyTypeId = 0 ile, yani ERP'nin
        // ANA para biriminde açılıyor (bkz. /api/ecommerce/orders). "TRY" bu gerçeğin karşılığı,
        // serbest bir varsayılan değil. Mağaza bir gün ana para birimi TRY olmayan bir firmaya
        // açılırsa burası ve sipariş ucu birlikte değişmeli — yalnızca birini değiştirmek,
        // bankadan farklı bir para birimi istemek demek olur.
        card.CurrencyCode = "TRY";

        VirtualPos3DHtmlResponse started;
        try
        {
            started = await _virtualPos.Initiate3DPaymentAsync(card, callbackUrl, ct, merchantOrderId);
        }
        catch (Exception ex)
        {
            // Banka isteği patladıysa deneme kapanmalı: Pending kalırsa müşteri 15 dakika
            // boyunca yeniden deneyemez.
            _logger.LogError(ex, "[Ecommerce] Ödeme başlatılamadı. Sipariş {OrderNo}", salesOrderNo);
            await MarkAttemptFailedAsync(merchantOrderId, "Ödeme başlatılamadı.", ct);
            return new EcommercePaymentStartResult(false, "Ödeme başlatılamadı.", null, null);
        }

        if (!started.Success)
        {
            await MarkAttemptFailedAsync(merchantOrderId, started.Message ?? "Ödeme başlatılamadı.", ct);
            return new EcommercePaymentStartResult(false, started.Message ?? "Ödeme başlatılamadı.", null, null);
        }

        return new EcommercePaymentStartResult(true, null, started.HtmlForm, merchantOrderId);
    }

    private async Task MarkAttemptFailedAsync(string merchantOrderId, string message, CancellationToken ct)
    {
        var attempt = await _dbContext.EcommerceOrderPayments
            .FirstOrDefaultAsync(x => x.MerchantOrderId == merchantOrderId, ct);

        if (attempt is null || attempt.Status != (int)EcommercePaymentStatus.Pending) return;

        attempt.Status = (int)EcommercePaymentStatus.Failed;
        attempt.FailureMessage = Truncate(message, 500);
        attempt.SettledAtUtc = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Sanal POS callback'i işlendikten SONRA çağrılır: bu ödeme bir e-ticaret siparişine
    /// aitse siparişi kapatır.
    ///
    /// <paramref name="isSuccess"/> bankadan geleni değil, imza doğrulamasından geçmiş sonucu
    /// taşır — callback'i işleyen servis imzayı doğrulamadan hiçbir şeyi başarılı saymıyor.
    /// Bu metot o kararı yeniden yorumlamaz.
    ///
    /// E-ticaret ödemesi değilse null döner ve çağıran hiçbir şey değiştirmez.
    /// </summary>
    public async Task<EcommerceSettlementResult?> SettleAsync(
        string merchantOrderId,
        bool isSuccess,
        string authCode,
        string failureMessage,
        CancellationToken ct)
    {
        merchantOrderId = (merchantOrderId ?? string.Empty).Trim();
        if (merchantOrderId.Length == 0) return null;

        var attempt = await _dbContext.EcommerceOrderPayments
            .FirstOrDefaultAsync(x => x.MerchantOrderId == merchantOrderId, ct);

        if (attempt is null) return null;

        // Zaten sonuçlanmış: callback ikinci kez gelmiş olabilir (banka tekrarlar). Var olan
        // sonuç aynen döner, ikinci bir etki üretilmez.
        if (attempt.Status != (int)EcommercePaymentStatus.Pending)
        {
            return new EcommerceSettlementResult(
                attempt.SalesOrderNo,
                attempt.Status == (int)EcommercePaymentStatus.Paid,
                attempt.Status == (int)EcommercePaymentStatus.NeedsReview);
        }

        if (!isSuccess)
        {
            attempt.Status = (int)EcommercePaymentStatus.Failed;
            attempt.FailureMessage = Truncate(failureMessage, 500);
            attempt.SettledAtUtc = DateTime.UtcNow;
            await _dbContext.SaveChangesAsync(ct);

            return new EcommerceSettlementResult(attempt.SalesOrderNo, false, false);
        }

        // Sipariş tutarı ödeme sürerken değişmiş olabilir (bayi ERP'den düzenlemiş olabilir).
        // Çekilen tutar artık siparişi karşılamıyorsa sipariş "ödendi" sayılamaz: eksik tahsilat
        // sessizce kapanmış bir sipariş olarak görünürdü.
        var currentTotal = await _dbContext.Set<SalesOrder>()
            .AsNoTracking()
            .Where(x => x.OrderNo == attempt.SalesOrderNo)
            .Select(x => (decimal?)x.GrandTotal)
            .FirstOrDefaultAsync(ct);

        if (currentTotal is null || Math.Round(currentTotal.Value, 2) != Math.Round(attempt.Amount, 2))
        {
            _logger.LogError(
                "[Ecommerce] Tahsilat yapıldı ama sipariş tutarı değişmiş. Sipariş {OrderNo}: ödenen {Paid}, güncel {Current}",
                attempt.SalesOrderNo, attempt.Amount, currentTotal);

            attempt.Status = (int)EcommercePaymentStatus.NeedsReview;
            attempt.AuthCode = Truncate(authCode, 50);
            attempt.FailureMessage = Truncate(
                $"Tahsilat yapıldı ancak sipariş tutarı değişti (ödenen {attempt.Amount}, güncel {currentTotal}).", 500);
            attempt.SettledAtUtc = DateTime.UtcNow;

            await _dbContext.SaveChangesAsync(ct);
            return new EcommerceSettlementResult(attempt.SalesOrderNo, false, true);
        }

        attempt.Status = (int)EcommercePaymentStatus.Paid;
        attempt.AuthCode = Truncate(authCode, 50);
        attempt.FailureMessage = string.Empty;
        attempt.SettledAtUtc = DateTime.UtcNow;

        try
        {
            await _dbContext.SaveChangesAsync(ct);

            /*
             * ÖDEME KAYDEDİLDİKTEN SONRA tamamlama adımları (bugün: montaj kaydı).
             *
             * SIRA ÖNEMLİ: önce ödeme yazılır, sonra bunlar denenir. Ters sırada ya da aynı
             * kaydetmede olsaydı, montaj kaydı açılamayan bir sipariş yüzünden TAHSİLAT
             * kaydı da geri alınırdı — parası çekilmiş müşteri sistemde ödememiş görünürdü.
             *
             * Buraya yalnızca `Pending → Paid` geçişinde geliniyor; ikinci kez gelen banka
             * geri çağrısı yukarıdaki "zaten sonuçlanmış" dalında dönüyor. Yine de tamamlama
             * adımlarının kendisi de tekrar çalıştırılabilir (bkz. EcommerceFulfilmentService).
             */
            await _fulfilment.RunAsync(attempt.SalesOrderNo, ct);

            return new EcommerceSettlementResult(attempt.SalesOrderNo, true, false);
        }
        catch (DbUpdateException ex)
        {
            // Kısmi tekil indeks devreye girdi: bu sipariş BAŞKA bir denemeyle zaten ödenmiş.
            // Yani banka iki kez tahsil etmiş. Kaydı "ödendi" yapamayız (sipariş bir kez
            // ödenir) ama "başarısız" da diyemeyiz (para gitti) — iade gerektiren bir durum,
            // insan bakmalı olarak işaretleniyor.
            _logger.LogError(ex,
                "[Ecommerce] ÇİFT TAHSİLAT: {OrderNo} siparişi zaten ödenmişken {MerchantOrderId} denemesi de onaylandı. İade gerekebilir.",
                attempt.SalesOrderNo, attempt.MerchantOrderId);

            _dbContext.Entry(attempt).State = EntityState.Detached;

            var reloaded = await _dbContext.EcommerceOrderPayments
                .FirstOrDefaultAsync(x => x.MerchantOrderId == merchantOrderId, ct);

            if (reloaded is not null)
            {
                reloaded.Status = (int)EcommercePaymentStatus.NeedsReview;
                reloaded.AuthCode = Truncate(authCode, 50);
                reloaded.FailureMessage = "Bu sipariş başka bir ödemeyle zaten kapatılmıştı; çift tahsilat incelenmeli.";
                reloaded.SettledAtUtc = DateTime.UtcNow;
                await _dbContext.SaveChangesAsync(ct);
            }

            return new EcommerceSettlementResult(attempt.SalesOrderNo, false, true);
        }
    }

    /// <summary>
    /// Sonucu bankadan doğrulanamamış ve KENDİLİĞİNDEN DOĞRULANMAYACAK bir tahsilatı
    /// "insan bakmalı" olarak işaretler.
    ///
    /// <para>
    /// Neden ayrı bir metot: <see cref="SettleAsync"/> bir KARAR yazıyor — ödendi ya da
    /// ödenmedi. Burada karar yok. CardPlus provizyonu zaman aşımına uğradığında ya da kart
    /// verisi bulunamadığında banka parayı çekmiş olabilir; <c>Failed</c> yazmak çekilmiş
    /// parayı yok saymak, <c>Paid</c> yazmak da çekilmemiş olabilecek bir parayla sipariş
    /// açmak olurdu. İkisi de yanlış, üçüncü bir durum gerekiyor.
    /// </para>
    ///
    /// <para>
    /// <b>Neden yeniden denemeye kapatıyor:</b> kayıt <c>Pending</c> bırakılsaydı müşteri 15
    /// dakika sonra tekrar ödeyebilirdi (bkz. <c>InFlightWindow</c>) — ilk provizyon aslında
    /// tutmuşsa bu ÇİFT TAHSİLAT olurdu. <c>NeedsReview</c> hem yeni denemeyi durdurur hem de
    /// panelde görünür.
    /// </para>
    /// </summary>
    public async Task<EcommerceSettlementResult?> MarkNeedsReviewAsync(
        string merchantOrderId,
        string reason,
        CancellationToken ct)
    {
        merchantOrderId = (merchantOrderId ?? string.Empty).Trim();
        if (merchantOrderId.Length == 0) return null;

        var attempt = await _dbContext.EcommerceOrderPayments
            .FirstOrDefaultAsync(x => x.MerchantOrderId == merchantOrderId, ct);

        // E-ticaret ödemesi değil (bayi panelinden başlatılmış): burada yapacak bir şey yok.
        if (attempt is null) return null;

        // Zaten sonuçlanmışsa dokunulmuyor. Özellikle Paid: geç gelen belirsiz bir geri çağrı,
        // tahsil edilmiş ve siparişi açmış bir ödemeyi incelemeye düşüremez.
        if (attempt.Status != (int)EcommercePaymentStatus.Pending)
        {
            return new EcommerceSettlementResult(
                attempt.SalesOrderNo,
                attempt.Status == (int)EcommercePaymentStatus.Paid,
                attempt.Status == (int)EcommercePaymentStatus.NeedsReview);
        }

        _logger.LogError(
            "[Ecommerce] Sonucu dogrulanamayan tahsilat incelemeye alindi. Siparis {OrderNo}, deneme {MerchantOrderId}: {Reason}",
            attempt.SalesOrderNo, attempt.MerchantOrderId, reason);

        attempt.Status = (int)EcommercePaymentStatus.NeedsReview;
        attempt.FailureMessage = Truncate(
            string.IsNullOrWhiteSpace(reason)
                ? "Bankadan kesin sonuç alınamadı; tahsilatın gerçekleşip gerçekleşmediği kontrol edilmeli."
                : reason,
            500);
        attempt.SettledAtUtc = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(ct);

        // Tamamlama adımları (montaj, kargo) ÇALIŞTIRILMIYOR: tahsilat kesin değil.
        return new EcommerceSettlementResult(attempt.SalesOrderNo, false, true);
    }

    /// <summary>
    /// Bir banka sipariş numarasının hangi e-ticaret siparişine ait olduğunu söyler.
    /// Hiçbir şeyi değiştirmez.
    ///
    /// Müşteriyi mağazaya geri yollayabilmek için var: sonuç belirsiz kaldığında da müşteri
    /// ERP'nin bayi sonuç sayfasında bırakılmamalı. E-ticaret ödemesi değilse null döner.
    /// </summary>
    public async Task<string?> FindSalesOrderNoAsync(string merchantOrderId, CancellationToken ct)
    {
        merchantOrderId = (merchantOrderId ?? string.Empty).Trim();
        if (merchantOrderId.Length == 0) return null;

        return await _dbContext.EcommerceOrderPayments
            .AsNoTracking()
            .Where(x => x.MerchantOrderId == merchantOrderId)
            .Select(x => x.SalesOrderNo)
            .FirstOrDefaultAsync(ct);
    }

    /// <summary>
    /// Siparişin ödeme durumu. Mağaza "ödendi mi" sorusunu tarayıcıya değil buraya soruyor:
    /// bankanın müşteriyi geri yolladığı adres bir kanıt değil, yalnızca bir yönlendirmedir.
    /// </summary>
    public async Task<EcommercePaymentStatusResult?> GetStatusAsync(
        string customerCode,
        string salesOrderNo,
        CancellationToken ct)
    {
        customerCode = (customerCode ?? string.Empty).Trim();
        salesOrderNo = (salesOrderNo ?? string.Empty).Trim();

        var (order, _) = await ResolvePayableOrderAsync(customerCode, salesOrderNo, ct);
        if (order is null) return null;

        var attempts = await _dbContext.EcommerceOrderPayments
            .AsNoTracking()
            .Where(x => x.SalesOrderNo == salesOrderNo)
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(ct);

        // Ödenmiş satır varsa cevap odur; yoksa en son deneme. "En son deneme başarısız" ile
        // "sipariş ödenmemiş" aynı şey değil ama müşteriye gösterilecek olan sonuncusu.
        var paid = attempts.FirstOrDefault(x => x.Status == (int)EcommercePaymentStatus.Paid);
        var current = paid ?? attempts.FirstOrDefault();

        if (current is null)
        {
            return new EcommercePaymentStatusResult(
                order.OrderNo, false, "None", order.GrandTotal, order.GrandTotal, "TRY", null, string.Empty,
                "Bu sipariş için henüz ödeme başlatılmamış.");
        }

        var status = (EcommercePaymentStatus)current.Status;

        return new EcommercePaymentStatusResult(
            order.OrderNo,
            status == EcommercePaymentStatus.Paid,
            status.ToString(),
            order.GrandTotal,
            current.Amount,
            current.CurrencyCode,
            status == EcommercePaymentStatus.Paid ? current.SettledAtUtc : null,
            current.AuthCode ?? string.Empty,
            status switch
            {
                EcommercePaymentStatus.Paid => "Ödeme alındı.",
                EcommercePaymentStatus.Pending => "Ödeme sonucu bekleniyor.",
                EcommercePaymentStatus.NeedsReview => "Ödemeniz inceleniyor. Lütfen bizimle irtibata geçin.",
                EcommercePaymentStatus.BankTransferRequested => "Havale/EFT bekleniyor. Gönderdiğinizde 'Gönderdim' düğmesine basın.",
                EcommercePaymentStatus.BankTransferSent => "Havale bildiriminiz alındı; hesabımıza ulaşınca siparişiniz onaylanacak.",
                _ => string.IsNullOrWhiteSpace(current.FailureMessage) ? "Ödeme tamamlanamadı." : current.FailureMessage
            });
    }

    private static string Truncate(string? value, int max)
    {
        var text = (value ?? string.Empty).Trim();
        return text.Length <= max ? text : text.Substring(0, max);
    }
}
