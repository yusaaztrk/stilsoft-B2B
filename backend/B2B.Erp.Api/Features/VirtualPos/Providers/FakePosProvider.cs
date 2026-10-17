using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.VirtualPos.Core;
using Microsoft.Extensions.Hosting;

namespace B2B.Erp.Api.Features.VirtualPos.Providers;

/// <summary>
/// SAHTE SANAL POS — YALNIZCA LOKAL TEST İÇİN. HİÇBİR BANKAYA BAĞLANMAZ.
///
/// <para>
/// <b>Neden var:</b> ödeme zinciri (sipariş → 3D formu → banka geri çağrısı → imza
/// doğrulaması → "ödendi" damgası → montaj kaydı → sipariş postası → faturalanabilirlik)
/// bugüne kadar tek bir kez bile uçtan uca koşturulamamıştı; gerçek POS bir banka
/// sandbox'ı, gerçek bir üye işyeri numarası ve dışa açık https bir geri çağrı adresi
/// istiyor. Bu sağlayıcı o zinciri lokalde, para hareketi olmadan çalıştırılabilir kılar.
/// </para>
///
/// <para>
/// <b>ÜÇ BAĞIMSIZ KAPI</b> — üçü birden açık değilse sağlayıcı hiçbir şey yapmaz:
/// </para>
/// <list type="number">
///   <item>Ortam <c>Development</c> olacak (bu sınıf, her metodunda kontrol eder).</item>
///   <item><c>VirtualPos:EnableFakeProvider</c> ayarı <c>true</c> olacak.</item>
///   <item>DI kaydı da aynı iki koşula bağlı (<c>Program.cs</c>) — üretimde sınıf
///         konteynere hiç girmez, dolayısıyla <c>VirtualPosGateway</c> onu bulamaz.</item>
/// </list>
///
/// <para>
/// Kapıların HEPSİ kapalı başarısız: kapalıyken metotlar "başarısız" döner, sessizce
/// başarılı olmaz. Bu bilinçli — bir test sağlayıcısının yanlışlıkla üretimde ödemeyi
/// "onaylaması", ödemeyi hiç almamaktan çok daha kötüdür.
/// </para>
///
/// <para>
/// <b>Gerçekçilik:</b> imza (HMAC-SHA256) gerçek bir POS gibi doğrulanıyor. Geri çağrının
/// alanları kurcalanırsa imza tutmaz ve ödeme reddedilir; yani bu sağlayıcı ile yapılan
/// test, imza doğrulama yolunu da gerçekten sınar. Tutar ve para birimi kontrolü zaten
/// <c>VirtualPosService</c> tarafında, sağlayıcıdan bağımsız çalışıyor.
/// </para>
///
/// <para>
/// <b>Sonucu kart numarası belirler</b> — arayüzde düğmeye basmaya gerek kalmadan
/// otomatik testler yazılabilsin diye:
/// </para>
/// <list type="bullet">
///   <item><c>4111 1111 1111 1111</c> (ya da 0000 ile bitmeyen her kart) → <b>onaylanır</b></item>
///   <item>Kart numarası <c>0000</c> ile bitiyorsa → <b>reddedilir</b></item>
/// </list>
/// </summary>
public sealed class FakePosProvider : IVirtualPosProvider
{
    /// <summary>Ayarın adı; <c>Program.cs</c>'teki DI kaydı da aynı anahtarı okuyor.</summary>
    public const string EnabledConfigKey = "VirtualPos:EnableFakeProvider";

    /// <summary>Sahte POS'un banka kodu. Gerçek hiçbir bankanın kodu değil.</summary>
    public const int FakeBankCode = 999;

    /// <summary>Yapılandırmada anahtar boşsa kullanılacak imza sırrı (yalnızca lokal).</summary>
    private const string FallbackStoreKey = "LOKAL-TEST-SAHTE-POS";

    private const string DisabledMessage =
        "Sahte sanal POS yalnızca geliştirme ortamında ve VirtualPos:EnableFakeProvider açıkken çalışır.";

    private readonly IHostEnvironment _environment;
    private readonly IConfiguration _configuration;
    private readonly ILogger<FakePosProvider> _logger;

    public FakePosProvider(
        IHostEnvironment environment,
        IConfiguration configuration,
        ILogger<FakePosProvider> logger)
    {
        _environment = environment;
        _configuration = configuration;
        _logger = logger;
    }

    public VirtualPosProviderType ProviderType => VirtualPosProviderType.Fake;

    /// <summary>
    /// Sağlayıcı çalışabilir mi. DI kaydı zaten aynı koşula bağlı; burada TEKRAR bakılıyor
    /// çünkü kaydın ileride yanlışlıkla koşulsuz hâle getirilmesi tek bir satırlık bir hata,
    /// ve o hatanın bedeli üretimde sahte onaydır.
    /// </summary>
    public static bool IsEnabled(IHostEnvironment environment, IConfiguration configuration)
        => environment.IsDevelopment() && configuration.GetValue<bool>(EnabledConfigKey);

    private bool Enabled => IsEnabled(_environment, _configuration);

    public Task<VirtualPosStartResult> StartPaymentAsync(
        VirtualPosPaymentRequest request,
        VirtualPosConfiguration configuration,
        string merchantOrderId,
        CancellationToken cancellationToken = default)
    {
        if (!Enabled)
        {
            _logger.LogError("[FakePos] Kapalı ortamda çağrıldı; ödeme başlatılmadı.");
            return Task.FromResult(new VirtualPosStartResult
            {
                Success = false,
                Status = VirtualPosPaymentStatus.Failed,
                MerchantOrderId = merchantOrderId,
                Message = DisabledMessage
            });
        }

        var amount = request.Amount.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture);
        var currency = VirtualPosCallbackData.ToNumericCurrencyCode(request.CurrencyCode) ?? "949";

        // Sonuç KART NUMARASINDAN belirleniyor: otomatik testin bir düğmeye basmadan hem
        // onay hem red yolunu koşturabilmesi için.
        var declined = (request.CardNumber ?? string.Empty).Replace(" ", string.Empty).EndsWith("0000",
            StringComparison.Ordinal);
        var response = declined ? "Declined" : "Approved";

        var storeKey = ResolveStoreKey(configuration);
        var hash = ComputeHash(merchantOrderId, amount, currency, response, storeKey);

        var callbackUrl = (request.CallbackUrl ?? string.Empty).Trim();
        if (callbackUrl.Length == 0)
        {
            return Task.FromResult(new VirtualPosStartResult
            {
                Success = false,
                Status = VirtualPosPaymentStatus.Failed,
                MerchantOrderId = merchantOrderId,
                Message = "Sahte POS: geri çağrı adresi boş."
            });
        }

        _logger.LogWarning(
            "[FakePos] SAHTE ödeme formu üretildi (gerçek banka YOK). Sipariş {OrderNo}, tutar {Amount}, sonuç {Response}.",
            merchantOrderId, amount, response);

        var html = BuildForm(callbackUrl, merchantOrderId, amount, currency, response, hash, declined);

        return Task.FromResult(new VirtualPosStartResult
        {
            Success = true,
            Status = VirtualPosPaymentStatus.RedirectPrepared,
            MerchantOrderId = merchantOrderId,
            HtmlForm = html,
            GatewayUrl = callbackUrl,
            Message = "Sahte POS formu üretildi (LOKAL TEST)."
        });
    }

    public Task<VirtualPosCallbackResult> ProcessCallbackAsync(
        VirtualPosCallbackRequest request,
        VirtualPosConfiguration configuration,
        CancellationToken cancellationToken = default)
    {
        if (!Enabled)
        {
            _logger.LogError("[FakePos] Kapalı ortamda geri çağrı geldi; reddedildi.");
            return Task.FromResult(new VirtualPosCallbackResult
            {
                IsSuccess = false,
                Status = VirtualPosPaymentStatus.ProviderError,
                ErrorCode = "FAKE_POS_DISABLED",
                ErrorDescription = DisabledMessage
            });
        }

        var form = request.FormData;
        string Field(string key) => form.TryGetValue(key, out var v) ? (v ?? string.Empty).Trim() : string.Empty;

        var oid = Field("oid");
        var amount = Field("amount");
        var currency = Field("currency");
        var response = Field("Response");
        var incomingHash = Field("hash");

        /*
         * İMZA DOĞRULAMASI GERÇEKTEN YAPILIYOR.
         *
         * Sahte de olsa bu adım atlanmamalı: geri çağrı ucu kimliksiz (AllowAnonymous) ve
         * imzayı doğrulamayan bir sağlayıcı, testin "imza kontrolü çalışıyor mu" sorusunu
         * hiç sormaması demek olurdu. Alanlardan biri kurcalanırsa buradan geçemez.
         */
        var expected = ComputeHash(oid, amount, currency, response, ResolveStoreKey(configuration));

        if (!CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(expected),
                Encoding.UTF8.GetBytes(incomingHash)))
        {
            _logger.LogError("[FakePos] Geri çağrı imzası tutmadı. Sipariş {OrderNo}", oid);
            return Task.FromResult(new VirtualPosCallbackResult
            {
                IsSuccess = false,
                Status = VirtualPosPaymentStatus.ProviderError,
                MerchantOrderId = oid,
                ErrorCode = "HASH_MISMATCH",
                ErrorDescription = "Sahte POS: geri çağrı imzası doğrulanamadı."
            });
        }

        var approved = string.Equals(response, "Approved", StringComparison.OrdinalIgnoreCase);

        return Task.FromResult(new VirtualPosCallbackResult
        {
            IsSuccess = approved,
            Status = approved ? VirtualPosPaymentStatus.Authorized : VirtualPosPaymentStatus.Failed,
            MerchantOrderId = oid,
            BankTransactionId = approved ? "FAKE-TX-" + oid : string.Empty,
            AuthorizationCode = approved ? "FAKE" + DateTime.UtcNow.ToString("HHmmss") : string.Empty,
            HostReferenceNumber = approved ? "FAKEHOST" + oid : string.Empty,
            ErrorCode = approved ? string.Empty : "DECLINED",
            ErrorDescription = approved
                ? "Sahte POS: ödeme onaylandı (LOKAL TEST — para hareketi yok)."
                : "Sahte POS: ödeme reddedildi (LOKAL TEST)."
        });
    }

    /// <summary>
    /// İade ve iptal BİLEREK yazılmadı. Sahte sağlayıcının varlık sebebi ödeme zincirini
    /// koşturmak; iade akışının kendi iş kuralları var ve onları sahte bir "başarılı" ile
    /// geçmek, çalışmayan bir iadeyi çalışıyor sanmaya yol açar.
    /// </summary>
    public Task<VirtualPosOperationResult> RefundAsync(
        VirtualPosRefundRequest request,
        VirtualPosConfiguration configuration,
        CancellationToken cancellationToken = default)
        => Task.FromResult(new VirtualPosOperationResult
        {
            Success = false,
            Message = "Sahte POS iade desteklemiyor."
        });

    public Task<VirtualPosOperationResult> CancelAsync(
        VirtualPosCancelRequest request,
        VirtualPosConfiguration configuration,
        CancellationToken cancellationToken = default)
        => Task.FromResult(new VirtualPosOperationResult
        {
            Success = false,
            Message = "Sahte POS iptal desteklemiyor."
        });

    // ------------------------------------------------------------------ yardımcılar

    private static string ResolveStoreKey(VirtualPosConfiguration configuration)
    {
        var key = (configuration.StoreKeyEncrypted ?? string.Empty).Trim();
        return key.Length > 0 ? key : FallbackStoreKey;
    }

    /// <summary>
    /// İmza: HMAC-SHA256(oid|amount|currency|response, storeKey) → Base64.
    /// Alan sırası sabit ve ayraçlı: ayraçsız birleştirme, iki alanın sınırını kaydırarak
    /// aynı imzayı üreten girdilere kapı açar.
    /// </summary>
    private static string ComputeHash(string oid, string amount, string currency, string response, string storeKey)
    {
        var payload = string.Join("|", oid, amount, currency, response);
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(storeKey));
        return Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload)));
    }

    /// <summary>
    /// Bankanın 3D sayfasının yerine geçen form.
    ///
    /// KENDİLİĞİNDEN GÖNDERİLMEZ: test eden kişi "Onayla" ya da "Vazgeç" diyebilsin diye.
    /// Otomatik testler ise formdaki gizli alanları okuyup doğrudan geri çağrı adresine
    /// POST ediyor — bankanın yaptığının aynısı.
    ///
    /// Alan adları gerçek POS'lardaki adlarla aynı (<c>oid</c>, <c>amount</c>,
    /// <c>currency</c>, <c>Response</c>): <c>VirtualPosService</c>'in tutar/para birimi
    /// doğrulaması bu adları okuyor ve sahte akışın o kontrolleri de geçmesi gerekiyor.
    /// </summary>
    private static string BuildForm(
        string callbackUrl, string oid, string amount, string currency,
        string response, string hash, bool declined)
    {
        static string E(string value) => System.Net.WebUtility.HtmlEncode(value);

        var durum = declined
            ? "<p style=\"color:#b91c1c;font-weight:700\">Bu kart REDDEDİLECEK (numarası 0000 ile bitiyor).</p>"
            : "<p style=\"color:#15803d;font-weight:700\">Bu kart ONAYLANACAK.</p>";

        return $@"<!DOCTYPE html>
<html lang=""tr"">
<head><meta charset=""utf-8""><title>SAHTE POS — LOKAL TEST</title></head>
<body style=""font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"">
  <form method=""POST"" action=""{E(callbackUrl)}"" style=""background:#1e293b;padding:32px;border-radius:16px;max-width:460px;border:2px dashed #f59e0b"">
    <div style=""background:#f59e0b;color:#0f172a;font-weight:800;padding:6px 12px;border-radius:6px;display:inline-block;margin-bottom:16px"">
      SAHTE POS — GERÇEK BANKA YOK
    </div>
    <h2 style=""margin:0 0 8px;font-size:18px"">3D Güvenli Ödeme Simülasyonu</h2>
    <p style=""margin:0 0 4px;color:#94a3b8;font-size:13px"">Sipariş: <b>{E(oid)}</b></p>
    <p style=""margin:0 0 4px;color:#94a3b8;font-size:13px"">Tutar: <b>{E(amount)}</b> ({E(currency)})</p>
    {durum}
    <input type=""hidden"" name=""oid"" value=""{E(oid)}"" />
    <input type=""hidden"" name=""amount"" value=""{E(amount)}"" />
    <input type=""hidden"" name=""currency"" value=""{E(currency)}"" />
    <input type=""hidden"" name=""Response"" value=""{E(response)}"" />
    <input type=""hidden"" name=""hash"" value=""{E(hash)}"" />
    <button type=""submit"" style=""margin-top:16px;width:100%;background:#22c55e;color:#052e16;border:0;padding:12px;border-radius:8px;font-weight:800;cursor:pointer"">
      Bankaya dön (sonucu gönder)
    </button>
    <p style=""margin:14px 0 0;color:#64748b;font-size:11px"">
      Bu sayfa yalnızca geliştirme ortamında üretilir. Hiçbir karttan para çekilmez.
    </p>
  </form>
</body>
</html>";
    }
}
