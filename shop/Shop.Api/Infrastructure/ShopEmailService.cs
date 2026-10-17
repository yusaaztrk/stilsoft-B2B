using System.Net;
using System.Net.Mail;
using System.Text;

namespace Shop.Api.Infrastructure;

/// <summary>
/// Varsayılanlar BİLEREK boş: gerçek posta hesabı ve şifresi yalnızca
/// <c>appsettings.Local.json</c>'da durur (git'e girmez, bkz. .gitignore). Buradaki alanlar
/// önceden gerçek bir SMTP şifresini sabit kod olarak taşıyordu — commit geçmişinde hâlâ
/// duruyor (2026-09-05 denetiminde bulundu). O hesabın şifresi DEĞİŞTİRİLMELİ; git geçmişi
/// bir dosyayı "düzeltmekle" temizlenmez.
/// </summary>
public sealed class SmtpSettings
{
    public string Host { get; set; } = string.Empty;
    public int Port { get; set; } = 587;
    public bool EnableSsl { get; set; } = false;
    public string SenderEmail { get; set; } = string.Empty;
    public string SenderName { get; set; } = "Stilsoft KKTC Mağaza";
    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
}

public sealed class ShopEmailService
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<ShopEmailService> _logger;

    public ShopEmailService(IConfiguration configuration, ILogger<ShopEmailService> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    private SmtpSettings GetSettings()
    {
        var settings = new SmtpSettings();
        var section = _configuration.GetSection("SmtpSettings");
        if (section.Exists())
        {
            section.Bind(settings);
        }
        return settings;
    }

    public async Task SendPasswordResetEmailAsync(string toEmail, string fullName, string resetLink)
    {
        var settings = GetSettings();
        if (string.IsNullOrWhiteSpace(settings.Host) || string.IsNullOrWhiteSpace(settings.SenderEmail))
        {
            _logger.LogWarning("SMTP yapılandırması eksik, şifre sıfırlama e-postası gönderilemedi: {ToEmail}", toEmail);
            return;
        }

        var subject = "Stilsoft KKTC - Şifre Sıfırlama Talebi";
        var bodyHtml = $"""
            <!DOCTYPE html>
            <html lang="tr">
            <head>
              <meta charset="utf-8">
              <title>Şifre Sıfırlama</title>
            </head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b;">
              <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                <tr>
                  <td style="padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
                    <h2 style="margin: 0; font-size: 22px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">STILSOFT DEMO</h2>
                    <p style="margin: 6px 0 0; font-size: 13.5px; color: #64748b;">Müşteri Hesabı Güvenliği</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 32px;">
                    <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #334155;">
                      Merhaba <strong>{WebUtility.HtmlEncode(fullName)}</strong>,
                    </p>
                    <p style="margin: 0 0 24px; font-size: 14.5px; line-height: 1.6; color: #475569;">
                      Hesabınız için bir şifre sıfırlama talebinde bulundunuz. Yeni bir şifre belirlemek için lütfen aşağıdaki bağlantıya tıklayınız:
                    </p>
                    <table align="center" border="0" cellpadding="0" cellspacing="0" style="margin: 28px auto;">
                      <tr>
                        <td align="center" style="border-radius: 8px; background-color: #0f172a;">
                          <a href="{resetLink}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
                            Şifremi Sıfırla
                          </a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin: 24px 0 8px; font-size: 13px; line-height: 1.5; color: #64748b;">
                      Bu bağlantı güvenlik nedeniyle <strong>15 dakika</strong> boyunca geçerlidir.
                    </p>
                    <p style="margin: 0 0 24px; font-size: 12.5px; line-height: 1.5; color: #94a3b8;">
                      Buton çalışmıyorsa aşağıdaki bağlantıyı tarayıcınıza kopyalayabilirsiniz:<br>
                      <a href="{resetLink}" style="color: #2563eb; word-break: break-all;">{resetLink}</a>
                    </p>
                    <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0 16px;">
                    <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #94a3b8;">
                      Eğer bu talebi siz yapmadıysanız, bu e-postayı güvenle silebilirsiniz. Mevcut şifreniz değişmeyecektir.
                    </p>
                  </td>
                </tr>
              </table>
            </body>
            </html>
            """;

        await SendEmailInternalAsync(settings, toEmail, subject, bodyHtml, replyTo: null);
    }

    /// <summary>
    /// Sipariş onay e-postası — ödeme DOĞRULANDIKTAN sonra, bir kez.
    ///
    /// NEDEN ÖDEMEDEN SONRA: sipariş kart ekranından ÖNCE açılıyor (karttan çekilecek tutarın
    /// tek kaynağı siparişin kendisi olsun diye). Sipariş açılır açılmaz posta atılsaydı,
    /// ödemesi yarıda kalan her denemede müşteriye "siparişiniz alındı" yazardık.
    ///
    /// NEDEN BİR KEZ: çağıran taraf bunu yalnızca bekleyen sipariş kaydı İLK KEZ kapandığında
    /// tetikliyor. Sonuç sayfası her yenilendiğinde durum sorgusu tekrar çalışıyor; tekillik
    /// kapısı orada.
    ///
    /// Tutarlar SİPARİŞTEN okunuyor, sepetten değil: sepet bu noktada zaten temizlenmiş
    /// oluyor ve zaten resmi kaynak siparişin kendisi.
    /// </summary>
    public async Task SendOrderConfirmationEmailAsync(
        string toEmail,
        string fullName,
        Orders.AccountOrder order,
        string? deliveryAddress,
        decimal installationTotal)
    {
        var settings = GetSettings();
        if (string.IsNullOrWhiteSpace(settings.Host) || string.IsNullOrWhiteSpace(settings.SenderEmail))
        {
            _logger.LogWarning(
                "SMTP yapılandırması eksik, sipariş onay e-postası gönderilemedi: {OrderNo}", order.OrderNo);
            return;
        }

        static string Money(decimal value) =>
            value.ToString("N2", System.Globalization.CultureInfo.GetCultureInfo("tr-TR")) + " TL";

        var rows = new System.Text.StringBuilder();
        foreach (var line in order.Lines)
        {
            rows.Append(
                "<tr>" +
                "<td style=\"padding:10px 8px;border-bottom:1px solid #f1f5f9;font-size:13.5px;color:#334155;\">" +
                WebUtility.HtmlEncode(line.Name) +
                "<span style=\"display:block;font-size:11.5px;color:#94a3b8;\">" +
                WebUtility.HtmlEncode(line.StockCode) + "</span></td>" +
                "<td style=\"padding:10px 8px;border-bottom:1px solid #f1f5f9;font-size:13.5px;color:#475569;text-align:center;\">" +
                line.Quantity.ToString("0.##") + "</td>" +
                "<td style=\"padding:10px 8px;border-bottom:1px solid #f1f5f9;font-size:13.5px;color:#475569;text-align:right;\">%" +
                line.VatRate.ToString("0.##") + "</td>" +
                "<td style=\"padding:10px 8px;border-bottom:1px solid #f1f5f9;font-size:13.5px;color:#0f172a;text-align:right;font-weight:600;\">" +
                Money(line.LineGross) + "</td></tr>");
        }

        /*
         * MONTAJ BEDELİ BURADA TOPLANAN BİR SATIR DEĞİL, BİLGİ NOTUDUR.
         *
         * Sepet ekranında montaj ayrı satırdır ve genel toplama eklenir; orada KDV matrahı
         * yalnızca ürün tarafıdır. SİPARİŞTE ise bedel satır fiyatının İÇİNE katılmış
         * durumda (B2B'deki kural), dolayısıyla `Subtotal` ve `VatTotal` onu zaten içeriyor.
         * İki genel toplam birebir aynı çıkıyor, sadece kırılım farklı.
         *
         * Bu yüzden postada montajı "Ara toplam + KDV + montaj" gibi ekleyen bir satır
         * olarak göstermek tutarı İKİ KEZ saymak olurdu. Müşterinin bedeli görmesi yine
         * gerekli — toplamın altında, dahil olduğu belirtilerek yazılıyor.
         */
        var installationRow = installationTotal > 0
            ? "<tr><td colspan=\"3\" style=\"padding:6px 8px;font-size:12.5px;color:#94a3b8;\">" +
              "Genel toplama dahil montaj / kurulum bedeli</td>" +
              "<td style=\"padding:6px 8px;font-size:12.5px;color:#94a3b8;text-align:right;\">" +
              Money(installationTotal) + "</td></tr>"
            : string.Empty;

        var addressBlock = string.IsNullOrWhiteSpace(deliveryAddress)
            ? string.Empty
            : "<p style=\"margin:20px 0 4px;font-size:12.5px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.04em;\">Teslimat adresi</p>" +
              "<p style=\"margin:0;font-size:13.5px;line-height:1.6;color:#475569;\">" +
              WebUtility.HtmlEncode(deliveryAddress) + "</p>";

        var subject = "Stilsoft KKTC - Siparişiniz alındı (" + order.OrderNo + ")";

        var bodyHtml =
            "<!DOCTYPE html><html lang=\"tr\"><head><meta charset=\"utf-8\"><title>Siparişiniz alındı</title></head>" +
            "<body style=\"font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#f8fafc;margin:0;padding:24px;color:#1e293b;\">" +
            "<table align=\"center\" border=\"0\" cellpadding=\"0\" cellspacing=\"0\" width=\"100%\" style=\"max-width:620px;background-color:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;\">" +
            "<tr><td style=\"padding:32px 32px 20px;text-align:center;border-bottom:1px solid #f1f5f9;\">" +
            "<h2 style=\"margin:0;font-size:22px;font-weight:700;color:#0f172a;\">STILSOFT DEMO</h2>" +
            "<p style=\"margin:6px 0 0;font-size:13.5px;color:#64748b;\">Siparişiniz alındı</p></td></tr>" +
            "<tr><td style=\"padding:28px 32px;\">" +
            "<p style=\"margin:0 0 14px;font-size:15px;color:#334155;\">Merhaba <strong>" +
            WebUtility.HtmlEncode(fullName) + "</strong>,</p>" +
            "<p style=\"margin:0 0 22px;font-size:14.5px;line-height:1.6;color:#475569;\">Ödemeniz onaylandı ve siparişiniz hazırlanmaya alındı.</p>" +
            "<table width=\"100%\" style=\"border-collapse:collapse;background:#f8fafc;border-radius:8px;\">" +
            "<tr><td style=\"padding:12px 14px;font-size:13px;color:#64748b;\">Sipariş numarası</td>" +
            "<td style=\"padding:12px 14px;font-size:13px;color:#0f172a;text-align:right;font-weight:700;\">" +
            WebUtility.HtmlEncode(order.OrderNo) + "</td></tr>" +
            "<tr><td style=\"padding:0 14px 12px;font-size:13px;color:#64748b;\">Sipariş tarihi</td>" +
            "<td style=\"padding:0 14px 12px;font-size:13px;color:#0f172a;text-align:right;\">" +
            order.ProcessedAt.ToString("dd.MM.yyyy HH:mm") + "</td></tr>" +
            "<tr><td style=\"padding:0 14px 12px;font-size:13px;color:#64748b;\">Ödeme durumu</td>" +
            "<td style=\"padding:0 14px 12px;font-size:13px;color:#15803d;text-align:right;font-weight:700;\">Ödendi</td></tr></table>" +
            "<table width=\"100%\" style=\"border-collapse:collapse;margin-top:22px;\"><thead><tr>" +
            "<th align=\"left\" style=\"padding:8px;font-size:11.5px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #e2e8f0;\">Ürün</th>" +
            "<th align=\"center\" style=\"padding:8px;font-size:11.5px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #e2e8f0;\">Adet</th>" +
            "<th align=\"right\" style=\"padding:8px;font-size:11.5px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #e2e8f0;\">KDV</th>" +
            "<th align=\"right\" style=\"padding:8px;font-size:11.5px;color:#94a3b8;text-transform:uppercase;border-bottom:1px solid #e2e8f0;\">Tutar</th>" +
            "</tr></thead><tbody>" + rows + "</tbody><tfoot>" +
            "<tr><td colspan=\"3\" style=\"padding:12px 8px 4px;font-size:13.5px;color:#475569;\">Ara toplam (KDV hariç)</td>" +
            "<td style=\"padding:12px 8px 4px;font-size:13.5px;color:#0f172a;text-align:right;\">" + Money(order.Subtotal) + "</td></tr>" +
            "<tr><td colspan=\"3\" style=\"padding:4px 8px;font-size:13.5px;color:#475569;\">KDV</td>" +
            "<td style=\"padding:4px 8px;font-size:13.5px;color:#0f172a;text-align:right;\">" + Money(order.VatTotal) + "</td></tr>" +
            "<tr><td colspan=\"3\" style=\"padding:12px 8px;font-size:15px;color:#0f172a;font-weight:700;border-top:2px solid #0f172a;\">Genel toplam</td>" +
            "<td style=\"padding:12px 8px;font-size:15px;color:#0f172a;text-align:right;font-weight:700;border-top:2px solid #0f172a;\">" +
            Money(order.GrandTotal) + "</td></tr>" +
            installationRow + "</tfoot></table>" +
            addressBlock +
            "<hr style=\"border:none;border-top:1px solid #f1f5f9;margin:26px 0 16px;\">" +
            "<p style=\"margin:0;font-size:12.5px;line-height:1.6;color:#94a3b8;\">Siparişinizin durumunu hesabınızdaki " +
            "<strong>Siparişlerim</strong> sayfasından takip edebilirsiniz. Kargo veya montaj randevunuz " +
            "oluşturulduğunda ayrıca bilgilendirileceksiniz.</p>" +
            "</td></tr></table></body></html>";

        await SendEmailInternalAsync(settings, toEmail, subject, bodyHtml, replyTo: null);
    }

    /// <summary>
    /// İletişim sayfasındaki formu bayinin kendi e-postasına iletir.
    ///
    /// Form daha önce hiçbir yere gönderilmiyordu (`onSubmit` boştu) — müşteri mesajını yazıp
    /// gönder'e bastığında hiçbir şey olmuyordu, bayi hiçbir zaman haberdar olmuyordu
    /// (2026-09-05 denetiminde bulundu, canlı testte doğrulandı).
    ///
    /// `Reply-To` müşterinin e-postasına ayarlanır (verildiyse): bayi mail programında
    /// doğrudan "Yanıtla" diyebilsin, müşteriye ayrıca yazmak zorunda kalmasın.
    /// </summary>
    public async Task SendContactMessageAsync(
        string toEmail, string customerName, string customerPhone, string? customerEmail, string subject, string message)
    {
        var settings = GetSettings();
        if (string.IsNullOrWhiteSpace(settings.Host) || string.IsNullOrWhiteSpace(settings.SenderEmail))
        {
            _logger.LogWarning("SMTP yapılandırması eksik, iletişim formu e-postası gönderilemedi: {From}", customerName);
            return;
        }

        var subjectLabel = subject switch
        {
            "siparis" => "Sipariş & Teslimat",
            "urun" => "Ürün Bilgisi",
            "servis" => "Servis & Garanti",
            "kurumsal" => "Toptan & Kurumsal",
            _ => "Diğer",
        };

        var emailSubject = $"İletişim Formu: {subjectLabel} — {customerName}";
        var bodyHtml = $"""
            <!DOCTYPE html>
            <html lang="tr">
            <head><meta charset="utf-8"><title>İletişim Formu</title></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b;">
              <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
                <tr>
                  <td style="padding: 24px 32px; border-bottom: 1px solid #f1f5f9;">
                    <h2 style="margin: 0; font-size: 18px; color: #0f172a;">Web sitesi iletişim formu</h2>
                    <p style="margin: 4px 0 0; font-size: 13px; color: #64748b;">Konu: {WebUtility.HtmlEncode(subjectLabel)}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 24px 32px;">
                    <p style="margin: 0 0 6px; font-size: 14px;"><b>Ad Soyad:</b> {WebUtility.HtmlEncode(customerName)}</p>
                    <p style="margin: 0 0 6px; font-size: 14px;"><b>Telefon:</b> {WebUtility.HtmlEncode(customerPhone)}</p>
                    <p style="margin: 0 0 16px; font-size: 14px;"><b>E-posta:</b> {WebUtility.HtmlEncode(customerEmail ?? "(belirtilmedi)")}</p>
                    <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 0 0 16px;">
                    <p style="margin: 0; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">{WebUtility.HtmlEncode(message)}</p>
                  </td>
                </tr>
              </table>
            </body>
            </html>
            """;

        await SendEmailInternalAsync(settings, toEmail, emailSubject, bodyHtml, replyTo: customerEmail);
    }

    /// <summary>
    /// /servis sayfasındaki online servis kaydı formunu bayinin e-postasına iletir.
    ///
    /// Aynı hataya sahipti: form dolduruluyor, "Servis Talebini Gönder" tıklanıyor ve hiçbir
    /// yere gitmiyordu (2026-09-05 denetiminde bulundu, iletişim formuyla aynı desen).
    /// Kasıtlı olarak ServiceOps'ta doğrudan bir arıza kaydı AÇMIYOR — sayfanın kendi metni
    /// ("Formu doldurarak VEYA telefonla bildirin") bunun çağrı hattıyla eşdeğer, insan
    /// eliyle işlenen bir ilk bildirim olduğunu varsayıyor; bayi arayıp teyit ettikten sonra
    /// asıl arıza kaydını kendi ekranından açıyor.
    /// </summary>
    public async Task SendServiceRequestEmailAsync(
        string toEmail,
        string customerName,
        string customerPhone,
        string region,
        string productCategory,
        string? model,
        string? invoiceNo,
        string address,
        string description,
        string? productStockCode = null,
        string? warranty = null,
        string? purchaseDate = null)
    {
        // Garanti seçeneğinin ekrandaki karşılığı. Servis e-postasını okuyan kişi
        // "garanti-disi" gibi teknik bir değer değil, cümleyi görmeli.
        var warrantyText = warranty switch
        {
            "garantili" => "Garanti kapsamında (müşteri beyanı)",
            "garanti-disi" => "Garanti süresi dolmuş (müşteri beyanı)",
            "bilmiyorum" => "Müşteri bilmiyor — faturadan kontrol edilmeli",
            _ => "(belirtilmedi)"
        };

        var settings = GetSettings();
        if (string.IsNullOrWhiteSpace(settings.Host) || string.IsNullOrWhiteSpace(settings.SenderEmail))
        {
            _logger.LogWarning("SMTP yapılandırması eksik, servis talebi e-postası gönderilemedi: {From}", customerName);
            return;
        }

        var emailSubject = $"Servis Talebi: {customerName} ({region})";
        var bodyHtml = $"""
            <!DOCTYPE html>
            <html lang="tr">
            <head><meta charset="utf-8"><title>Servis Talebi</title></head>
            <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b;">
              <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden;">
                <tr>
                  <td style="padding: 24px 32px; border-bottom: 1px solid #f1f5f9;">
                    <h2 style="margin: 0; font-size: 18px; color: #0f172a;">Online servis kaydı</h2>
                    <p style="margin: 4px 0 0; font-size: 13px; color: #64748b;">Bölge: {WebUtility.HtmlEncode(region)} · Ürün grubu: {WebUtility.HtmlEncode(productCategory)}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 24px 32px;">
                    <p style="margin: 0 0 6px; font-size: 14px;"><b>Ad Soyad:</b> {WebUtility.HtmlEncode(customerName)}</p>
                    <p style="margin: 0 0 6px; font-size: 14px;"><b>Telefon:</b> {WebUtility.HtmlEncode(customerPhone)}</p>
                    <p style="margin: 0 0 6px; font-size: 14px;"><b>Ürün:</b> {WebUtility.HtmlEncode(model ?? "(belirtilmedi)")}</p>
                    <p style="margin: 0 0 6px; font-size: 14px;"><b>Stok Kodu:</b> {WebUtility.HtmlEncode(string.IsNullOrWhiteSpace(productStockCode) ? "(katalogdan seçilmedi — müşteri elle yazdı)" : productStockCode)}</p>
                    <p style="margin: 0 0 6px; font-size: 14px;"><b>Garanti:</b> {WebUtility.HtmlEncode(warrantyText)}</p>
                    <p style="margin: 0 0 6px; font-size: 14px;"><b>Satın Alma Tarihi:</b> {WebUtility.HtmlEncode(string.IsNullOrWhiteSpace(purchaseDate) ? "(belirtilmedi)" : purchaseDate)}</p>
                    <p style="margin: 0 0 6px; font-size: 14px;"><b>Fatura/Sipariş No:</b> {WebUtility.HtmlEncode(invoiceNo ?? "(belirtilmedi)")}</p>
                    <p style="margin: 0 0 16px; font-size: 14px;"><b>Adres:</b> {WebUtility.HtmlEncode(address)}</p>
                    <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 0 0 16px;">
                    <p style="margin: 0; font-size: 14px; line-height: 1.6; white-space: pre-wrap;">{WebUtility.HtmlEncode(description)}</p>
                  </td>
                </tr>
              </table>
            </body>
            </html>
            """;

        await SendEmailInternalAsync(settings, toEmail, emailSubject, bodyHtml, replyTo: null);
    }

    private async Task SendEmailInternalAsync(SmtpSettings settings, string toEmail, string subject, string bodyHtml, string? replyTo)
    {
        var enableSsl = settings.EnableSsl;
        try
        {
            await ExecuteSendAsync(settings, toEmail, subject, bodyHtml, enableSsl, replyTo);
        }
        catch (Exception ex) when (ex.Message.Contains("secure connections") || ex.Message.Contains("SSL") || ex.Message.Contains("TLS"))
        {
            _logger.LogWarning("Ters SSL modunda e-posta gönderimi tekrar deneniyor ({InvertedSsl})...", !enableSsl);
            await ExecuteSendAsync(settings, toEmail, subject, bodyHtml, !enableSsl, replyTo);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "E-posta gönderilemedi: {ToEmail}", toEmail);
        }
    }

    private static async Task ExecuteSendAsync(SmtpSettings settings, string toEmail, string subject, string bodyHtml, bool enableSsl, string? replyTo = null)
    {
        using var client = new SmtpClient(settings.Host, settings.Port)
        {
            EnableSsl = enableSsl,
            Credentials = new NetworkCredential(settings.Username, settings.Password),
            Timeout = 20000
        };

        using var mail = new MailMessage
        {
            From = new MailAddress(settings.SenderEmail, settings.SenderName ?? "Stilsoft KKTC Mağaza"),
            Subject = subject,
            Body = bodyHtml,
            IsBodyHtml = true,
            BodyEncoding = Encoding.UTF8,
            SubjectEncoding = Encoding.UTF8
        };

        mail.To.Add(toEmail);
        if (!string.IsNullOrWhiteSpace(replyTo) && MailAddress.TryCreate(replyTo, out var replyAddr))
        {
            mail.ReplyToList.Add(replyAddr);
        }

        await client.SendMailAsync(mail);
    }
}
