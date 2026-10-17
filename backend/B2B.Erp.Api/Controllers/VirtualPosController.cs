using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.VirtualPos;
using B2B.Erp.Api.Features.VirtualPos.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/virtual-pos")]
[Authorize]
public sealed class VirtualPosController : ControllerBase
{
    private readonly IVirtualPosService _virtualPosService;
    private readonly B2B.Erp.Api.Features.VirtualPos.Core.IVirtualPosAccountingRetryService _accountingRetryService;
    private readonly B2B.Erp.Api.Data.Services.TenantConnectionStringResolver _tenantResolver;
    private readonly IConfiguration _configuration;
    private readonly AppDbContext _dbContext;
    private readonly B2B.Erp.Api.Features.Ecommerce.EcommercePaymentService _ecommercePayments;

    public VirtualPosController(
        IVirtualPosService virtualPosService,
        B2B.Erp.Api.Features.VirtualPos.Core.IVirtualPosAccountingRetryService accountingRetryService,
        B2B.Erp.Api.Data.Services.TenantConnectionStringResolver tenantResolver,
        IConfiguration configuration,
        AppDbContext dbContext,
        B2B.Erp.Api.Features.Ecommerce.EcommercePaymentService ecommercePayments)
    {
        _virtualPosService = virtualPosService;
        _accountingRetryService = accountingRetryService;
        _tenantResolver = tenantResolver;
        _configuration = configuration;
        _dbContext = dbContext;
        _ecommercePayments = ecommercePayments;
    }

    [HttpGet("definitions")]
    public async Task<IActionResult> GetDefinitions(CancellationToken cancellationToken)
    {
        var data = await _virtualPosService.GetPosDefinitionsAsync(cancellationToken);
        return Ok(new { success = true, data });
    }

    [HttpGet("bins/{binNumber}")]
    public async Task<IActionResult> LookupBin(
        [FromRoute] string binNumber,
        [FromQuery] decimal amount = 100m,
        CancellationToken cancellationToken = default)
    {
        var data = await _virtualPosService.LookupBinAsync(binNumber, amount, cancellationToken);
        return Ok(new { success = true, data });
    }

    [HttpGet("installments")]
    public async Task<IActionResult> GetInstallments(
        [FromQuery] int bankCode = 10,
        [FromQuery] decimal amount = 100m,
        CancellationToken cancellationToken = default)
    {
        var data = await _virtualPosService.GetInstallmentOptionsAsync(bankCode, amount, cancellationToken);
        return Ok(new { success = true, data });
    }

    [HttpPost("pay-3d")]
    public async Task<IActionResult> Initiate3DPayment(
        [FromBody] VirtualPosPaymentRequest request,
        CancellationToken cancellationToken)
    {
        if (request == null)
        {
            return BadRequest(new { success = false, message = "Geçersiz ödeme isteği." });
        }

        // The payment row is written to this tenant's database, and the bank will post the
        // result back with no header and no token — so the tenant has to travel inside the URL
        // the bank is given, or the callback lands on the default database and cannot find the
        // payment it just authorized.
        var tenantCode = _tenantResolver.GetCurrentTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            // Refusing here costs nothing. Starting the payment anyway would take the money and
            // then strand the callback, which is the failure this check exists to prevent.
            return BadRequest(new { success = false, message = "Ödeme başlatılamadı: firma bilgisi çözümlenemedi." });
        }

        // The rule lives in VirtualPosCallbackUrl so that this endpoint and the storefront's
        // own payment endpoint tell the bank the same thing.
        var callbackUrl = B2B.Erp.Api.Features.VirtualPos.Core.VirtualPosCallbackUrl.Build(
            _configuration, B2B.Erp.Api.Core.Helpers.PublicOrigin.Of(Request), tenantCode);

        // Always the server-built URL: a client-supplied callback address would let the caller
        // choose where the bank posts the authorization result.
        request.CallbackUrl = callbackUrl;

        var result = await _virtualPosService.Initiate3DPaymentAsync(request, callbackUrl, cancellationToken);
        return Ok(result);
    }

    /// <summary>
    /// ÖDEMENİN SONUCU — TEK DOĞRU KAYNAK (2026-09-16 kullanıcı bildirimi: "bayi parayı çektik
    /// sanar, mal beleşe gider").
    ///
    /// <para>
    /// Ekran sonucu 3D penceresinden gelen <c>POS_PAYMENT_COMPLETE</c> mesajıyla öğreniyordu.
    /// O mesaj sonuç sayfasındaki "Tamam" düğmesine basılınca gidiyor — BAŞARIDA DA
    /// BAŞARISIZLIKTA DA. Bayi ekranında banka reddettiği hâlde yeşil "Ödeme Başarılı" kutusu
    /// çıkabiliyordu. Pencereden gelen mesaj artık yalnızca "bir şey oldu, durumu sor" sinyali;
    /// karar buradan, veritabanındaki damgadan okunur.
    /// </para>
    ///
    /// <para>
    /// Kapsam: kullanıcı yalnız görebildiği carilerin işlemini sorgulayabilir (rapor ucuyla aynı
    /// kural). Kart numarası, imza, banka ham cevabı DÖNMEZ; yalnız karar ve banka mesajı.
    /// </para>
    /// </summary>
    [HttpGet("payment-status/{orderNo}")]
    public async Task<IActionResult> GetPaymentStatus([FromRoute] string orderNo, CancellationToken cancellationToken)
    {
        var no = (orderNo ?? string.Empty).Trim();
        if (no.Length == 0) return BadRequest(new { success = false, message = "İşlem numarası gerekli." });

        var tx = await _dbContext.VirtualPosTransactions
            .AsNoTracking()
            .Where(x => x.OrderNo == no)
            .Select(x => new { x.OrderNo, x.CustomerCode, x.Status, x.IsSuccess, x.Amount, x.AuthCode, x.ErrorDescription, x.CreateTime })
            .FirstOrDefaultAsync(cancellationToken);

        if (tx is null) return NotFound(new { success = false, message = "İşlem bulunamadı." });

        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        if (!isSsa && !CustomerScope.IsUnrestrictedFor(User))
        {
            var scopeCodes = CustomerScope.Of(User);
            var allowed = scopeCodes.Count > 0
                ? await CustomerScope.ExpandAsync(_dbContext.Customers.AsNoTracking(), scopeCodes, cancellationToken)
                : new List<string>();

            if (!allowed.Contains(tx.CustomerCode)) return Forbid();
        }

        /*
          BANKA HENÜZ KONUŞMADIYSA KARAR YOKTUR.

          `VirtualPosOutcome.Classify` bir GERİ ÇAĞRININ sonucunu sınıflandırmak için yazıldı ve
          tanımadığı durumu `Declined` sayar. Burada ise kayıt geri çağrı gelmeden de okunuyor:
          `Created/RedirectPrepared/Redirected/ThreeDSecurePending` "müşteri hâlâ banka ekranında"
          demek. Bunlara "reddedildi" demek, ödeme sürerken bayiye kırmızı ekran gösterip aynı
          kartı tekrar denetir — çift çekim riski. O yüzden karar öncesi ayrı ele alınır.
        */
        var beklemede = tx.Status is (int)VirtualPosPaymentStatus.Created
            or (int)VirtualPosPaymentStatus.RedirectPrepared
            or (int)VirtualPosPaymentStatus.Redirected
            or (int)VirtualPosPaymentStatus.ThreeDSecurePending;

        // Sınıflandırma tek yerden: rapor, e-ticaret köprüsü ve bu uç aynı kararı vermeli.
        var outcome = beklemede
            ? B2B.Erp.Api.Features.VirtualPos.Core.VirtualPosOutcomeKind.Undecided
            : B2B.Erp.Api.Features.VirtualPos.Core.VirtualPosOutcome.Classify(tx.IsSuccess, tx.Status);

        var durum = outcome switch
        {
            B2B.Erp.Api.Features.VirtualPos.Core.VirtualPosOutcomeKind.Paid => "basarili",
            B2B.Erp.Api.Features.VirtualPos.Core.VirtualPosOutcomeKind.Declined => "basarisiz",
            B2B.Erp.Api.Features.VirtualPos.Core.VirtualPosOutcomeKind.NeedsHuman => "dogrulanamadi",
            _ => "bekliyor"
        };

        return Ok(new
        {
            success = true,
            data = new
            {
                orderNo = tx.OrderNo,
                durum,
                status = tx.Status,
                isSuccess = tx.IsSuccess,
                amount = tx.Amount,
                authCode = tx.AuthCode ?? string.Empty,
                message = tx.ErrorDescription ?? string.Empty,
                createTime = tx.CreateTime
            }
        });
    }

    /// <summary>
    /// The tenant segment is what makes this endpoint resolve to the database that holds the
    /// payment. It is read off the path by VirtualPosCallbackTenantMiddleware before this
    /// controller is activated — by the time an action runs, AppDbContext has already chosen
    /// its connection — so the parameter is declared only to make the route shape explicit and
    /// is deliberately not used in the body.
    /// </summary>
    [HttpPost("callback-3d/{tenantCode}")]
    [AllowAnonymous]
    public Task<IActionResult> Process3DCallbackForTenant(string tenantCode, CancellationToken cancellationToken)
        => Process3DCallback(cancellationToken);

    /// <summary>
    /// The tenant-less form, kept so that a payment started before this change still gets a
    /// rendered answer rather than a 404. It cannot resolve a tenant, so it reaches the default
    /// database and will report the payment as not found — the log line says why.
    /// </summary>
    [HttpPost("callback-3d")]
    [AllowAnonymous]
    public async Task<IActionResult> Process3DCallback(CancellationToken cancellationToken)
    {
        if (!Request.Headers.ContainsKey("X-Tenant-Code"))
        {
            Console.WriteLine(
                "[VirtualPos] 3D callback arrived without a tenant segment; it will be served from the default database. " +
                "Expected /api/virtual-pos/callback-3d/{tenantCode}.");
        }

        // The bank posts card and authentication material back on this form (masked PAN,
        // HASH, cavv/xid/eci, HASHPARAMSVAL …). Dumping the whole collection wrote that
        // straight into the console log, so only a non-sensitive subset is traced here.
        LogCallbackSafely(Request.Form);

        var result = await _virtualPosService.Process3DCallbackAsync(Request.Form, cancellationToken);

        /*
         * DOĞRULANAMAYAN GERİ ÇAĞRI SİPARİŞİ KAPATMAZ (2026-09-08).
         *
         * Bu uç kimlik istemiyor (AllowAnonymous) — istemek de mümkün değil, çağıran banka.
         * Sipariş numarasını bilen biri buraya uydurma bir form POST edebilir.
         *
         * Önceki hâlde böyle bir form da `SettleAsync(..., isSuccess: false, ...)` çağırıyordu
         * ve ödeme kaydı KALICI olarak "Başarısız" damgalanıyordu. `SettleAsync` yalnızca
         * `Pending` durumdaki kaydı ilerletiyor; bir kez Failed olduktan sonra BANKANIN GERÇEK
         * onayı bile o siparişi açamıyordu. Yani üçüncü bir kişi, yalnızca sipariş numarasını
         * bilerek başkasının ödemesini öldürebiliyordu — ve müşterinin kartından para çekilip
         * sipariş yine de "ödenmedi" görünebilirdi.
         *
         * `ProviderError` "banka konuştu ama söylediğini doğrulayamadık" demek: imza tutmadı,
         * tutar/para birimi eşleşmedi ya da POS tanımı çözülemedi. Bu bir RED değildir.
         * `VirtualPosService` de aynı sebeple bu durumda `CompletedAtUtc` yazmıyor — işlem
         * bitmiş sayılmıyor ki sonradan gelen geçerli bir çağrı üzerine yazabilsin. Mağaza
         * tarafı da artık aynı şekilde davranıyor: kayıt `Pending` kalır.
         *
         * Gerçek bir banka reddi (`Failed`) ise normal yoldan kapatılır.
         */
        /*
         * BANKANIN SONUCU ÜÇ DEĞİL DÖRT ŞEY OLABİLİR (2026-09-09).
         *
         * Sınıflandırma `VirtualPosOutcome`'a taşındı. Buradaki eski kural yalnızca
         * `ProviderError`'ü "karar verilmedi" sayıyordu; `AuthorizationPending` (CardPlus
         * provizyonu zaman aşımına uğradı / kart verisi bulunamadı) ve `ThreeDVerified`
         * (eşzamanlı ikinci geri çağrı, provizyon yarışını kaybetti) ise `IsSuccess == false`
         * oldukları için doğrudan "başarısız" muamelesi görüyordu.
         *
         * `SettleAsync` yalnızca `Pending` kaydı ilerletir; bir kez `Failed` damgalanan ödeme
         * bir daha açılamaz. Yani banka parayı çekmişken sipariş KALICI olarak ölü kalıyordu —
         * `AuthorizationPending`'de para gerçekten gitmiş olabilir, `ThreeDVerified`'da ise
         * yarışı kazanan istek birazdan "ödendi" yazacakken bu istek onu engelliyordu.
         *
         * Aynı ayrım bu dosyada `SaveReceiptNo` içinde zaten DOĞRU yazılmıştı. İki kopya vardı,
         * biri güncellendi diğeri unutuldu; artık ikisi de tek yerden okuyor.
         */
        var outcome = VirtualPosOutcome.Classify(result.IsSuccess, result.Status);
        var merchantOrderId = result.OrderNo ?? string.Empty;

        if (outcome != VirtualPosOutcomeKind.Paid && outcome != VirtualPosOutcomeKind.Declined)
        {
            Console.WriteLine(
                $"[VirtualPos] Karar verilemeyen geri cagri ({outcome}); siparis BASARISIZ SAYILMADI. " +
                $"OrderNo={merchantOrderId}, durum={result.Status}, sebep={result.ErrorDescription}");
        }

        // result.IsSuccess is the verified outcome, not what the bank's form claimed: the
        // callback is only treated as a payment after signature, amount and currency have all
        // been checked. Nothing here re-opens that decision.
        var settlement = outcome switch
        {
            // Karar kesin: ödendi ya da banka reddetti.
            VirtualPosOutcomeKind.Paid or VirtualPosOutcomeKind.Declined
                => await _ecommercePayments.SettleAsync(
                    merchantOrderId,
                    result.IsSuccess,
                    result.AuthCode ?? string.Empty,
                    result.ErrorDescription ?? string.Empty,
                    cancellationToken),

            // Para hareket etmiş olabilir ve kendiliğinden netleşmeyecek: insan bakmalı.
            // Yeniden denemeye de kapanıyor, yoksa çift tahsilat riski doğar.
            VirtualPosOutcomeKind.NeedsHuman
                => await _ecommercePayments.MarkNeedsReviewAsync(
                    merchantOrderId,
                    result.ErrorDescription ?? "Bankadan kesin sonuç alınamadı.",
                    cancellationToken),

            // Kendiliğinden netleşecek: kayıt Pending kalır, hiçbir şey yazılmaz.
            _ => null
        };

        /*
         * MÜŞTERİ HER DURUMDA MAĞAZAYA DÖNER.
         *
         * Eskiden yalnızca `settlement` doluysa yönlendiriliyordu; karar verilemeyen durumda
         * e-ticaret müşterisi ERP'nin BAYİ sonuç sayfasında kalıyordu. O sayfa kırmızı bir
         * "Ödeme Başarısız" yazıyor (parası çekilmiş olabilecek biri için yanlış bilgi) ve
         * `window.close()` düğmesi normal bir sekmede hiçbir şey yapmıyor.
         *
         * Sipariş numarası `settlement` yoksa da bulunabiliyor: bu ödeme e-ticarete aitse
         * mağazaya gönderilir, mağaza da "gerçekten ödendi mi" sorusunu API'ye sorar.
         */
        var salesOrderNo = settlement?.SalesOrderNo
            ?? await _ecommercePayments.FindSalesOrderNoAsync(merchantOrderId, cancellationToken);

        if (!string.IsNullOrWhiteSpace(salesOrderNo))
        {
            var storefrontUrl = ResolveStorefrontReturnUrl(salesOrderNo);
            if (storefrontUrl is not null)
            {
                // Only the order number travels in the URL — never "paid" or an amount. The
                // shop asks this API what actually happened; an address the customer's browser
                // carried is not evidence of a payment.
                return Redirect(storefrontUrl);
            }
        }

        // These three carry bank-supplied text, and an unsigned callback is something anyone
        // can post — so they are encoded rather than interpolated. Without this, a crafted
        // error message would execute as markup on this page.
        var description = System.Net.WebUtility.HtmlEncode(result.ErrorDescription ?? string.Empty);
        var orderNo = System.Net.WebUtility.HtmlEncode(result.OrderNo ?? string.Empty);
        var authCode = System.Net.WebUtility.HtmlEncode(result.AuthCode ?? string.Empty);

        var html = $@"
<!DOCTYPE html>
<html>
<head>
    <meta charset=""utf-8"" />
    <title>Ödeme Sonucu</title>
    <style>
        body {{ font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; }}
        .card {{ background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }}
        .icon {{ font-size: 3rem; margin-bottom: 1rem; }}
        .success {{ color: #16a34a; }}
        .error {{ color: #dc2626; }}
        button {{ margin-top: 1.5rem; background: #0f172a; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 0.5rem; cursor: pointer; font-weight: 600; }}
    </style>
</head>
<body>
    <div class=""card"">
        <div class=""icon {(result.IsSuccess ? "success" : "error")}"">{(result.IsSuccess ? "✓" : "✕")}</div>
        <h2>{(result.IsSuccess ? "Ödeme Başarılı!" : "Ödeme Başarısız")}</h2>
        <p>{description}</p>
        {(result.IsSuccess ? $"<p><strong>Sipariş No:</strong> {orderNo}</p><p><strong>Onay Kodu:</strong> {authCode}</p>" : "")}
        <button onclick=""if (window.parent) {{ window.parent.postMessage('POS_PAYMENT_COMPLETE', '*'); }} if (window.opener) {{ window.opener.postMessage('POS_PAYMENT_COMPLETE', '*'); window.close(); }}"">Tamam</button>
        <script>
            if ({(result.IsSuccess ? "true" : "false")}) {{
                setTimeout(function() {{
                    if (window.parent) {{ window.parent.postMessage('POS_PAYMENT_COMPLETE', '*'); }}
                    if (window.opener) {{ window.opener.postMessage('POS_PAYMENT_COMPLETE', '*'); window.close(); }}
                }}, 1500);
            }}
        </script>
    </div>
</body>
</html>";

        return Content(html, "text/html");
    }

    /// <summary>
    /// Where a storefront customer is sent after the bank posts back.
    ///
    /// Server-side configuration, never derived from the callback: the bank does not check the
    /// address it was given, so an address that could be influenced from outside would be a
    /// way to steer customers off the shop. A missing or malformed setting falls back to the
    /// ERP's own result page rather than to a guessed address.
    /// </summary>
    private string? ResolveStorefrontReturnUrl(string salesOrderNo)
    {
        var configured = (_configuration["Ecommerce:StorefrontBaseUrl"] ?? string.Empty).Trim().TrimEnd('/');

        if (configured.Length == 0
            || !Uri.TryCreate(configured, UriKind.Absolute, out var parsed)
            || (parsed.Scheme != Uri.UriSchemeHttps && parsed.Scheme != Uri.UriSchemeHttp))
        {
            if (configured.Length > 0)
            {
                Console.WriteLine(
                    $"[Ecommerce] Ecommerce:StorefrontBaseUrl ('{configured}') mutlak bir http(s) adresi değil; " +
                    "müşteri ERP sonuç sayfasında kalıyor.");
            }

            return null;
        }

        return $"{configured}/odeme/sonuc?siparis={Uri.EscapeDataString(salesOrderNo)}";
    }

    public sealed class SaveReceiptRequest
    {
        public string ReceiptNo { get; set; } = string.Empty;
    }

    /// <summary>
    /// Records the accounting receipt number for a collection.
    ///
    /// Its own page permission rather than the report's: reading which payments came in and
    /// stamping one with a receipt number are different acts, and the second is the one that
    /// closes a record. Only a captured payment can carry a receipt — a failed or still
    /// pending one has nothing to issue a receipt against.
    /// </summary>
    [HttpPut("transactions/{id:guid}/receipt")]
    [AuthorizePage("pos", "posMakbuzGir")]
    public async Task<IActionResult> SaveReceiptNo(
        Guid id,
        [FromBody] SaveReceiptRequest request,
        CancellationToken cancellationToken)
    {
        var receiptNo = (request?.ReceiptNo ?? string.Empty).Trim();

        // 30 characters is the column width; refusing here beats a truncation error.
        if (receiptNo.Length > 30)
        {
            return BadRequest(new { success = false, message = "Makbuz numarası en fazla 30 karakter olabilir." });
        }

        var tx = await _dbContext.VirtualPosTransactions
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (tx == null)
        {
            return NotFound(new { success = false, message = "İşlem bulunamadı." });
        }

        // Kural VirtualPosOutcome'da; bu satırların kopyası e-ticaret köprüsünde eksik kalmış
        // ve parası çekilmiş ödemeleri "başarısız" damgalıyordu (2026-09-09).
        var isCaptured = VirtualPosOutcome.IsCaptured(tx.IsSuccess, tx.PaymentStatus);

        if (!isCaptured)
        {
            // Karar verilmemiş işlemin mesajı ayrı: "başarısız" demek, parası çekilmiş
            // olabilecek bir tahsilata kesin bir yargı yüklemek olurdu.
            var undecided = VirtualPosOutcome.IsUndecided(tx.PaymentStatus);

            return BadRequest(new
            {
                success = false,
                message = undecided
                    ? "Bu işlemin sonucu bankadan doğrulanamadı; tahsilat teyit edilmeden makbuz girilemez."
                    : "Başarısız işleme makbuz girilemez."
            });
        }

        // Empty clears it: a receipt entered against the wrong row has to be removable.
        tx.ReceiptNo = receiptNo.Length == 0 ? null : receiptNo;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, data = new { id = tx.Id, receiptNo = tx.ReceiptNo ?? string.Empty } });
    }

    [AuthorizePage("pos", "posReport")]
    [HttpGet("transactions")]
    public async Task<IActionResult> GetTransactions(
        [FromQuery] string? customerCode = null,
        [FromQuery] bool? needsAttentionOnly = null,
        CancellationToken cancellationToken = default)
    {
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var scopeCodes = CustomerScope.Of(User);
        var isInternalUser = isSsa || CustomerScope.IsUnrestrictedFor(User);

        List<string>? allowedCustomerCodes = null;
        if (!isInternalUser)
        {
            if (scopeCodes.Count > 0)
            {
                allowedCustomerCodes = await CustomerScope.ExpandAsync(
                    _dbContext.Customers.AsNoTracking(), scopeCodes, cancellationToken);
            }
            else
            {
                return Ok(new { success = true, data = Array.Empty<VirtualPosTransactionDto>() });
            }
        }

        var data = await _virtualPosService.GetTransactionsAsync(customerCode, needsAttentionOnly, allowedCustomerCodes, cancellationToken);
        return Ok(new { success = true, data });
    }

    /// <summary>
    /// Re-attempts ledger posting for payments the bank captured but the ERP has not booked
    /// (typically a missing POS bank account). Idempotent — a payment already posted is
    /// skipped. Restricted to the virtual POS report page permission; never anonymous.
    /// </summary>
    // YETKI: `users/genelAyarlar` — `pos/posReport` DEGIL (2026-08-23).
    //
    // POS Cekim Raporu bayilere de acik. Bu uc bir MUTABAKAT islemi: bayinin kendi
    // tahsilatini muhasebelestirebilmesi dogru degil. Dugme de ayni sayfaya (Genel Ayarlar)
    // tasindi, ama kapi burada duruyor — arayuzde bir seyi gizlemek yetki denetimi degildir.
    //
    // Anahtar UYDURULMAZ: olmayan bir sayfa adi `PageAuthorizationFilter` icinde hicbir
    // sayfaya cozulmez ve filtre bunu "sayfa kayitli degil, gecir" diye yorumlar — yani
    // koruma sanilan sey aslinda kapiyi herkese acar. `users/genelAyarlar` mevcut bir sayfa.
    [HttpPost("accounting/retry-pending")]
    [AuthorizePage("users", "genelAyarlar")]
    public async Task<IActionResult> RetryPendingAccounting(
        [FromQuery] int maxBatchSize = 50,
        CancellationToken cancellationToken = default)
    {
        var summary = await _accountingRetryService.RetryPendingAccountingAsync(maxBatchSize, cancellationToken);
        return Ok(new { success = true, data = summary });
    }

    /// <summary>
    /// Fields that are safe to trace from a 3D callback. Everything else — card data,
    /// hashes, and the 3D authentication values (cavv/xid/eci) that could be replayed —
    /// stays out of the log. Allow-list rather than deny-list so a new bank field is
    /// never leaked by accident.
    /// </summary>
    private static readonly string[] LoggableCallbackFields =
    {
        "oid", "orderid", "Response", "ProcReturnCode", "procreturncode",
        "mdStatus", "mdstatus", "ErrMsg", "errmsg", "AuthCode", "authcode",
        "TransId", "transid", "HostRefNum", "hostrefnum", "clientid", "amount",
        "txnamount", "currency", "txncurrencycode", "txnstatus"
    };

    private static void LogCallbackSafely(IFormCollection form)
    {
        var traced = LoggableCallbackFields
            .Where(f => form.ContainsKey(f))
            .Select(f => $"{f}={form[f]}");

        Console.WriteLine($"[VirtualPos] 3D callback received: {string.Join(", ", traced)}");
    }
}
