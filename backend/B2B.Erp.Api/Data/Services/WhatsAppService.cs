using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace B2B.Erp.Api.Data.Services;

public interface IWhatsAppService
{
    Task<bool> SendOtpCodeAsync(string phoneNumber, string code);
}

public class WhatsAppService : IWhatsAppService
{
    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;
    private readonly ILogger<WhatsAppService> _logger;

    /*
      KİMLİK BİLGİLERİ ARTIK YAPILANDIRMADAN OKUNUYOR (denetim md. 209).

      Meta erişim anahtarı ve telefon kimliği kaynak koda `const` olarak gömülüydü. İki sonucu
      vardı: (a) depoya erişen herkes şirketin WhatsApp gönderim yetkisini eline geçiriyordu,
      (b) Meta anahtarı süresi dolduğunda ya da yenilendiğinde kodu yeniden derleyip yayına
      almadan HİÇ KİMSE OTP ile giriş yapamıyordu.

      Sıra: `WhatsApp:AccessToken` / `WhatsApp:PhoneNumberId` yapılandırması varsa O kullanılır;
      yoksa aşağıdaki eski gömülü değere düşülür ki bu değişiklik canlıyı ANINDA kırmasın.
      ⚠️ YAPILACAK: değerleri `appsettings.Local.json`/ortam değişkenine taşıyıp Meta panelinden
      anahtarı YENİLE — bu anahtar depoda göründüğü için yanmış sayılmalı.
    */
    private const string LegacyPhoneNumberId = "1247657675100362";
    private const string LegacyAccessToken = "EAAfmD0LpLVYBSKjZAveQSeTTcYzya6cqyBZCUIs1VoFWYdAssWWhjIQcPUEZBZCgnCPZBZCQFy9tAXBRfUvUoPTQRS8u2jTaAr4lofmudDv8SXYUhUMROJ7pZBkjPthwZCLGpntyySWiLcGS9QL2cxVPjKvOpZADhzYNrKOMZCi7mXK7RPJkEltlT0Wa1CCPpnOIp5DwAZAYxJtVU52TOLGYWL7BRiY9DCq6RNluLTPQOBYkhFb21pP8I3LVSvOy9hpU3yvgtZAjO67vCqZBEJh45ZA4sypVng";

    public WhatsAppService(HttpClient httpClient, IConfiguration configuration, ILogger<WhatsAppService> logger)
    {
        _httpClient = httpClient;
        _configuration = configuration;
        _logger = logger;

        // ZAMAN AŞIMI (denetim md. 215). Varsayılan `HttpClient` 100 saniye bekliyor; Meta
        // yavaşladığında giriş isteği o kadar süre thread'i tutuyordu. OTP gönderimi ya
        // saniyeler içinde olur ya da olmaz.
        if (_httpClient.Timeout == TimeSpan.FromSeconds(100))
        {
            _httpClient.Timeout = TimeSpan.FromSeconds(15);
        }
    }

    private string AccessToken
    {
        get
        {
            var configured = (_configuration["WhatsApp:AccessToken"] ?? string.Empty).Trim();
            return configured.Length > 0 ? configured : LegacyAccessToken;
        }
    }

    private string PhoneNumberId
    {
        get
        {
            var configured = (_configuration["WhatsApp:PhoneNumberId"] ?? string.Empty).Trim();
            return configured.Length > 0 ? configured : LegacyPhoneNumberId;
        }
    }

    public async Task<bool> SendOtpCodeAsync(string phoneNumber, string code)
    {
        try
        {
            var cleanPhone = new string((phoneNumber ?? string.Empty).Where(char.IsDigit).ToArray());
            if (string.IsNullOrWhiteSpace(cleanPhone)) return false;

            // ULUSLARARASI ÖN EK TEMİZLİĞİ (denetim md. 211).
            //
            // "0090533..." biçiminde girilen numaralarda baştaki "00" duruyordu ve Meta'ya
            // "0090..." gidip 400 dönüyordu; başında 00 yazan bayilere kod hiç ulaşmıyordu.
            if (cleanPhone.StartsWith("00"))
            {
                cleanPhone = cleanPhone.Substring(2);
            }

            // "90" ÖN EKİ YALNIZCA TÜRK CEP NUMARASI UZUNLUĞUNDA EKLENİR (2026-08-20).
            //
            // Kural eskiden "05 ile başlıyorsa 90 ekle" idi ve uzunluğa bakmıyordu. Telefon
            // alanı 11 haneye kırpıldığı sürece bu güvenliydi: 05 ile başlayan her numara
            // zorunlu olarak Türk cebiydi. Alan yurt dışı numaraları için uzatılınca kural
            // tehlikeli hâle geldi — "05" ile başlayan 14 haneli bir numaraya da "90"
            // yapıştırıp Meta'ya var olmayan bir numara gönderirdi ve OTP sessizce ulaşmazdı.
            //
            // Türk/KKTC cep numarası daima 0 + 10 hanedir; kural artık tam bu uzunlukta
            // çalışıyor. Yurt dışı numarası "00<ülke kodu>" ile yazılır ve yukarıdaki "00"
            // temizliği onu zaten doğru E.164 biçimine çeviriyor.
            if (cleanPhone.Length == 11 && cleanPhone.StartsWith("05"))
            {
                cleanPhone = "90" + cleanPhone.Substring(1);
            }
            else if (cleanPhone.Length == 10 && cleanPhone.StartsWith("5"))
            {
                cleanPhone = "90" + cleanPhone;
            }

            var url = $"https://graph.facebook.com/v20.0/{PhoneNumberId}/messages";

            // 1. Try sending official Turkish OTP template (stilsoft_otp)
            var otpTemplatePayload = new
            {
                messaging_product = "whatsapp",
                to = cleanPhone,
                type = "template",
                template = new
                {
                    name = "stilsoft_otp",
                    language = new { code = "tr" },
                    components = new object[]
                    {
                        new
                        {
                            type = "body",
                            parameters = new object[]
                            {
                                new { type = "text", text = code }
                            }
                        },
                        new
                        {
                            type = "button",
                            sub_type = "url",
                            index = "0",
                            parameters = new object[]
                            {
                                new { type = "text", text = code }
                            }
                        }
                    }
                }
            };

            var otpReq = new HttpRequestMessage(HttpMethod.Post, url);
            otpReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AccessToken);
            otpReq.Content = new StringContent(JsonSerializer.Serialize(otpTemplatePayload), Encoding.UTF8, "application/json");

            var otpRes = await _httpClient.SendAsync(otpReq);
            if (otpRes.IsSuccessStatusCode)
            {
                return true;
            }

            // 2. Fallback: Send hello_world template first to open conversation window
            var templatePayload = new
            {
                messaging_product = "whatsapp",
                to = cleanPhone,
                type = "template",
                template = new
                {
                    name = "hello_world",
                    language = new { code = "en_US" }
                }
            };

            var req = new HttpRequestMessage(HttpMethod.Post, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AccessToken);
            req.Content = new StringContent(JsonSerializer.Serialize(templatePayload), Encoding.UTF8, "application/json");
            await _httpClient.SendAsync(req);

            // 3. Send the actual 6-digit OTP code text message immediately after
            var textPayload = new
            {
                messaging_product = "whatsapp",
                to = cleanPhone,
                type = "text",
                text = new { body = $"🔒 STILSOFT B2B Giriş Kodunuz: {code}\n\nDoğrulama kodunuz 3 dakika geçerlidir. Lütfen kimseyle paylaşmayın." }
            };

            var textReq = new HttpRequestMessage(HttpMethod.Post, url);
            textReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AccessToken);
            textReq.Content = new StringContent(JsonSerializer.Serialize(textPayload), Encoding.UTF8, "application/json");
            var textRes = await _httpClient.SendAsync(textReq);

            if (!textRes.IsSuccessStatusCode)
            {
                // META'NIN SEBEBİ LOGLANIR (denetim md. 210).
                //
                // Hata sessizce yutulduğu için "giriş başarısız" diyen sistemin arkasında
                // bakiye bitmesi mi, şablon reddi mi, hesap kısıtı mı olduğu anlaşılamıyordu.
                // Yanıt gövdesi Meta'nın hata kodunu taşır; token loglanmaz.
                var body = await textRes.Content.ReadAsStringAsync();
                _logger.LogWarning(
                    "WhatsApp OTP gönderilemedi. HTTP {StatusCode}. Meta yanıtı: {Body}",
                    (int)textRes.StatusCode,
                    body);
            }

            return textRes.IsSuccessStatusCode;
        }
        catch (TaskCanceledException ex)
        {
            _logger.LogWarning(ex, "WhatsApp OTP gönderimi zaman aşımına uğradı.");
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "WhatsApp OTP gönderiminde beklenmeyen hata.");
            return false;
        }
    }
}
