using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.VirtualPos.Core;

namespace B2B.Erp.Api.Features.VirtualPos.Providers;

public sealed class NestPayProvider : IVirtualPosProvider
{
    private const string NotImplementedMessage =
        "NestPay iade/iptal işlemi henüz bankaya bağlanmadı. İşlem BANKAYA İLETİLMEDİ; " +
        "iade veya iptali banka ekranından yapın.";

    public VirtualPosProviderType ProviderType => VirtualPosProviderType.NestPay;

    public Task<VirtualPosStartResult> StartPaymentAsync(
        VirtualPosPaymentRequest request,
        VirtualPosConfiguration configuration,
        string merchantOrderId,
        CancellationToken cancellationToken = default)
    {
        var clientId = (configuration.ClientId ?? "").Trim();
        var storeKey = (configuration.StoreKeyEncrypted ?? "").Trim(); // decrypted if needed
        var amountStr = request.Amount.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture);
        var oid = (merchantOrderId ?? "").Trim();
        var callbackUrl = !string.IsNullOrWhiteSpace(request.CallbackUrl) ? request.CallbackUrl.Trim() : "http://localhost:5200/api/virtual-pos/callback-3d";
        var okUrl = callbackUrl;
        var failUrl = callbackUrl;
        var rnd = Guid.NewGuid().ToString("N").Substring(0, 20).ToUpper();

        var month = request.ExpMonth.Trim().PadLeft(2, '0');
        var year = request.ExpYear.Trim().Length == 4 ? request.ExpYear.Trim().Substring(2) : request.ExpYear.Trim();
        var instStr = request.InstallmentCount > 1 ? request.InstallmentCount.ToString() : "";

        // The gateway address comes from trusted server-side configuration only. A hardcoded
        // fallback would silently send a payment to a bank the definition never named.
        // MAGAZA TIPI TANIMDAN GELIR, kodda sabit DEGIL (2026-08-23). Yanlis model bankadan
        // "Isyeri kullanim tipi desteklenmiyor" reddi getiriyor ve dogrusunu yalnizca banka
        // soyleyebiliyor; tanimda durunca yeni derleme beklemeden degistirilebiliyor.
        // Bos ise eski davranis korunur.
        var storeType = (configuration.StoreType ?? string.Empty).Trim();
        if (storeType.Length == 0) storeType = "3D_PAY_HOSTING";

        var gatewayUrl = (configuration.GatewayUrl ?? string.Empty).Trim();
        if (gatewayUrl.Length == 0)
        {
            return Task.FromResult(new VirtualPosStartResult
            {
                Success = false,
                Status = VirtualPosPaymentStatus.Failed,
                MerchantOrderId = oid,
                Message = "Sanal POS gateway adresi yapılandırılmamış."
            });
        }

        // The form declares hashAlgorithm=ver3, so the digest must actually be the Version 3
        // construction: every posted parameter sorted by name, values escaped, joined with
        // '|', store key appended. The previous fixed-order concatenation was the Version 1
        // formula sent under a ver3 label, which the gateway rejects.
        //
        // Fields are collected first and the hash is derived from that exact collection, so
        // adding a field to the form can never silently fall out of the signature.
        var formFields = new List<KeyValuePair<string, string>>
        {
            new("clientid", clientId),
            new("storetype", storeType),
            new("islemtipi", "Auth"),
            new("hashAlgorithm", NestPayVer3Hash.HashAlgorithmValue),
            new("rnd", rnd),
            new("oid", oid),
            new("amount", amountStr),
            new("okUrl", okUrl),
            new("failUrl", failUrl),
            new("currency", "949"),
            new("lang", "tr"),
            new("pan", request.CardNumber.Replace(" ", "").Trim()),
            new("Emonth", month),
            new("Eyear", year),
            new("Ecom_Payment_Card_ExpDate_Month", month),
            new("Ecom_Payment_Card_ExpDate_Year", year),
            new("cv2", request.Cvc.Trim()),
            new("cardHolderName", request.CardHolderName.Trim()),
            new("email", request.Email.Trim()),
            new("tel", request.Phone.Trim()),
            new("BillToName", string.IsNullOrWhiteSpace(request.CardHolderName) ? "name" : request.CardHolderName.Trim()),
            new("BillToCompany", string.IsNullOrWhiteSpace(request.CustomerCode) ? "billToCompany" : request.CustomerCode.Trim()),
            new("refreshtime", "1")
        };

        if (!string.IsNullOrEmpty(instStr))
        {
            formFields.Add(new KeyValuePair<string, string>("taksit", instStr));
        }

        var hash = NestPayVer3Hash.Compute(formFields, storeKey);

        var sb = new StringBuilder();
        sb.AppendLine($"<form id=\"nestpay_form\" method=\"POST\" action=\"{gatewayUrl}\">");
        foreach (var field in formFields)
        {
            sb.AppendLine($"<input type=\"hidden\" name=\"{field.Key}\" value=\"{System.Net.WebUtility.HtmlEncode(field.Value)}\" />");
        }
        // The store key signs the form server-side and is never rendered into it. The old
        // markup carried a "key" field, which handed the secret to the browser.
        sb.AppendLine($"<input type=\"hidden\" name=\"hash\" value=\"{System.Net.WebUtility.HtmlEncode(hash)}\" />");
        sb.AppendLine("</form>");
        sb.AppendLine("<script>document.getElementById('nestpay_form').submit();</script>");

        return Task.FromResult(new VirtualPosStartResult
        {
            Success = true,
            HtmlForm = sb.ToString(),
            GatewayUrl = gatewayUrl,
            MerchantOrderId = oid,
            Status = VirtualPosPaymentStatus.RedirectPrepared
        });
    }


    public Task<VirtualPosCallbackResult> ProcessCallbackAsync(
        VirtualPosCallbackRequest request,
        VirtualPosConfiguration configuration,
        CancellationToken cancellationToken = default)
    {
        var callback = new VirtualPosCallbackData(request.FormData);
        var oid = callback.Get("oid", "OrderNo", "orderid");

        // --- Gate 1: did NestPay produce this, unmodified? ----------------------------
        var integrity = NestPayCallbackVerifier.Verify(request.FormData, configuration.StoreKeyEncrypted);
        if (!integrity.IsValid)
        {
            // ProviderError, Failed DEĞİL. Bu dal "banka reddetti" demiyor, "bankanın ne
            // dediğine güvenemiyoruz" diyor — imza yoksa ya da tutmuyorsa kartın çekilip
            // çekilmediği BİLİNMEZ. Failed yazmak, parası alınmış bir tahsilatı raporda
            // kesin başarısız gösterip kimsenin bakmayacağı bir yere gömüyordu.
            return Task.FromResult(new VirtualPosCallbackResult
            {
                IsSuccess = false,
                Status = VirtualPosPaymentStatus.ProviderError,
                MerchantOrderId = oid,
                ErrorCode = "INTEGRITY_" + integrity.Status.ToString().ToUpperInvariant(),
                // Bankanin METNI de aciklamaya ekleniyor (2026-08-23). Creditwest CardPlus
                // kendi REDDETTIGI istegi imzalamiyor: `hash` gelmiyor, Kapi 1 takiliyor ve
                // bankanin ne dedigini okuyan Kapi 2'ye hic gelinmiyordu. `ErrMsg` cope
                // gidiyor, ekranda yalnizca "Dogrulanamadi" yaziyordu — 18 basarisiz denemenin
                // sebebini ("Isyeri kullanim tipi desteklenmiyor") gormek icin veritabanina
                // inmek gerekti. Garanti'de ayni sey zaten boyle cozulmustu.
                ErrorDescription = DescribeUnverifiedCallback(callback, integrity.Reason)
            });
        }

        // --- Gate 2: what did the bank decide? -----------------------------------------
        var responseCode = callback.Get("Response");
        var mdStatus = callback.Get("mdStatus");
        var errMsg = callback.Get("ErrMsg", "mderrMsg", "errmsg", "mdErrorMsg");
        var authCode = callback.Get("AuthCode");
        var procReturnCode = callback.Get("ProcReturnCode");
        var transId = callback.Get("TransId");
        var hostRefNum = callback.Get("HostRefNum");

        bool is3dValid = mdStatus is "1" or "2" or "3" or "4";

        /*
          MAĞAZA TİPİ, GERİ ÇAĞRININ NE ANLATTIĞINI DEĞİŞTİRİR (2026-08-23).

          `3d_pay` / `3d_pay_hosting` modelinde parayı BANKA çeker: geri çağrı hem 3D sonucunu
          hem tahsilat sonucunu (`Response`, `ProcReturnCode`) taşır ve ikisi birden aranmalıdır.

          `3d` (tam 3D) modelinde ise banka YALNIZCA kimliği doğrular; parayı üye işyeri ikinci
          bir sunucu-sunucu isteğiyle kendisi çeker (bkz. CardPlusCompletionService). O geri
          çağrıda tahsilat alanları BOŞ gelir. Eski kural bu boş alanları "onay yok" sayıp
          doğrulaması başarılı olmuş her işlemi reddediyordu — ekranda
          "Ödeme Reddedildi: ... (Kod: /)" diye görünen buydu; boş bölü işareti, iki alanın da
          boş olmasıydı.

          Burada `true` dönmek "para alındı" demek DEĞİL: yalnızca "3D geçti, provizyona
          gidilebilir" demek. Kararı CardPlus yanıtı verir ve işlem o ana kadar
          `ThreeDVerified` durumunda bekler.
        */
        var storeType = (configuration.StoreType ?? string.Empty).Trim();
        var merchantCaptures = storeType.Equals("3d", StringComparison.OrdinalIgnoreCase)
                               || storeType.Equals("3d_full", StringComparison.OrdinalIgnoreCase)
                               || storeType.Equals("3D_FULL", StringComparison.OrdinalIgnoreCase);

        // Both must agree. Accepting "Approved" OR "00" let a callback carrying a success
        // word alongside a declining code through.
        bool bankCaptured = procReturnCode == "00"
                            && string.Equals(responseCode, "Approved", StringComparison.OrdinalIgnoreCase)
                            && is3dValid;

        bool isApproved = merchantCaptures ? is3dValid : bankCaptured;

        string errDesc;
        if (isApproved)
        {
            // Tam 3D'de bu aşamada henüz para çekilmedi; "Başarılı Tahsilat" yazmak
            // muhasebeye ve ekrana yalan söylerdi.
            errDesc = merchantCaptures
                ? "3D doğrulaması başarılı, banka provizyonu bekleniyor."
                : "Başarılı Tahsilat";
        }
        else
        {
            var rawErr = !string.IsNullOrWhiteSpace(errMsg) ? errMsg : (!string.IsNullOrWhiteSpace(responseCode) ? responseCode : "Banka İşlemi Reddetti");
            if (rawErr.Contains("Wrong security code", StringComparison.OrdinalIgnoreCase) || rawErr.Contains("Güvenlik Kodu", StringComparison.OrdinalIgnoreCase))
            {
                errDesc = "Banka Hatası: Girilen Kart Güvenlik Kodu (CVC/CVV) veya SKT bilgisi banka kayıtlarıyla eşleşmedi (Wrong security code). Lütfen CVC kodunu kontrol edin.";
            }
            else if (rawErr.Contains("Taksit tablosu", StringComparison.OrdinalIgnoreCase))
            {
                // Merchant tarafında aktif görünen bir taksit seçeneği, kartı çıkaran bankanın
                // Ziraat'in bu kampanyaya katılmamış olmasından ötürü reddedilebiliyor —
                // sistemde bozuk bir kural yok, karta özel bir banka kısıtı bu (2026-09-14
                // müşteri bulgusu: aynı hata farklı gerçek kartlarda tekrarlandı, "5 taksit"
                // kuralı başka kartlarda sorunsuz çalışıyor). Ham bankacılık jargonu yerine
                // müşteriye doğrudan ne yapması gerektiği söyleniyor.
                errDesc = "Ödeme Reddedildi: Bu kart, seçtiğiniz taksit seçeneğini desteklemiyor. Lütfen Tek Çekim ile tekrar deneyin ya da başka bir kart kullanın.";
            }
            else if (!is3dValid)
            {
                errDesc = $"3D Güvenlik Doğrulaması Başarısız (mdStatus: {mdStatus}): {rawErr}";
            }
            else
            {
                errDesc = $"Ödeme Reddedildi: {rawErr} (Kod: {responseCode}/{procReturnCode})";
            }
        }

        var result = new VirtualPosCallbackResult
        {
            IsSuccess = isApproved,
            Status = isApproved ? VirtualPosPaymentStatus.Authorized : VirtualPosPaymentStatus.Failed,
            MerchantOrderId = oid,
            BankTransactionId = transId,
            AuthorizationCode = authCode,
            HostReferenceNumber = hostRefNum,
            ErrorCode = string.IsNullOrEmpty(responseCode) ? procReturnCode : responseCode,
            ErrorDescription = errDesc
        };

        return Task.FromResult(result);
    }

    /// <summary>
    /// İade HENÜZ UYGULANMADI ve bilerek BAŞARISIZ dönüyor (2026-08-23).
    ///
    /// <para>Önceki hâli bankaya tek bir istek atmadan <c>Success = true</c> dönüyordu:
    /// parası hiç iade edilmemiş bir işlem, çağıran tarafa "iade edildi" diye raporlanırdı.
    /// Para hareketinde sessiz başarı, sessiz hatadan beterdir — müşteriye ödenmemiş bir
    /// para ödendi sanılır ve kimse bakmaz. Bu yüzden gerçek CC5 <c>Credit</c> isteği
    /// yazılana kadar kapı KAPALI: çağıran açık bir "yapılmadı" cevabı alır.</para>
    ///
    /// <para>Gerçek uygulama için gereken altyapı hazır: <see cref="Core.CardPlusClient"/>
    /// aynı CC5Request/ISO-8859-9 biçimini zaten konuşuyor. Eksik olan tanım verisi —
    /// <c>XmlUrl</c> yalnız Creditwest'te dolu, API kullanıcı/parolası ise banka tarafından
    /// verilmeli. Bankada sınanmamış bir iade kodunu canlıya koymak, sahte başarıyı gerçek
    /// para kaybına çevirir.</para>
    /// </summary>
    public Task<VirtualPosOperationResult> RefundAsync(
        VirtualPosRefundRequest request,
        VirtualPosConfiguration configuration,
        CancellationToken cancellationToken = default)
    {
        return Task.FromResult(new VirtualPosOperationResult
        {
            Success = false,
            Message = NotImplementedMessage,
            TransactionId = request.BankTransactionId
        });
    }

    /// <summary>
    /// İptal HENÜZ UYGULANMADI. Gerekçe için bkz. <see cref="RefundAsync"/>; iptal de
    /// bankada CC5 <c>Void</c> isteği ister ve o istek atılmıyor.
    /// </summary>
    public Task<VirtualPosOperationResult> CancelAsync(
        VirtualPosCancelRequest request,
        VirtualPosConfiguration configuration,
        CancellationToken cancellationToken = default)
    {
        return Task.FromResult(new VirtualPosOperationResult
        {
            Success = false,
            Message = NotImplementedMessage,
            TransactionId = request.BankTransactionId
        });
    }

    /// <summary>
    /// Imzasi dogrulanamayan bir geri cagrinin aciklamasi.
    ///
    /// <para>Bankanin metni EKLENIR ama "dogrulanmamis" etiketiyle: imzasiz bir mesaj
    /// odemeyi ne onaylayabilir ne de kesin reddedebilir. Bu yuzden yalnizca ACIKLAMA
    /// zenginlesiyor; statu <c>ProviderError</c> olarak KALIYOR ve o ayrim bilinclidir.
    /// Metni "banka boyle dedi" diye kesin dogru saymak, imzasiz bir yaniti imzali gibi
    /// islemek olurdu.</para>
    /// </summary>
    private static string DescribeUnverifiedCallback(VirtualPosCallbackData callback, string integrityReason)
    {
        var bankMessage = callback.Get("ErrMsg", "errmsg", "mderrmsg", "mdErrorMsg", "HostMsg");
        if (string.IsNullOrWhiteSpace(bankMessage))
        {
            return integrityReason;
        }

        var procReturnCode = callback.Get("ProcReturnCode", "procreturncode");
        var mdStatus = callback.Get("mdStatus", "mdstatus");

        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(procReturnCode)) parts.Add($"ProcReturnCode: {procReturnCode}");
        if (!string.IsNullOrWhiteSpace(mdStatus)) parts.Add($"mdStatus: {mdStatus}");
        var suffix = parts.Count > 0 ? $" ({string.Join(", ", parts)})" : string.Empty;

        return $"{integrityReason} Bankanın bildirdiği hata (doğrulanmamış): {bankMessage}{suffix}";
    }

    private static string CalculateSha512Hash(string text)
    {
        using var sha512 = SHA512.Create();
        var bytes = Encoding.UTF8.GetBytes(text);
        var hashBytes = sha512.ComputeHash(bytes);
        return Convert.ToBase64String(hashBytes);
    }
}
