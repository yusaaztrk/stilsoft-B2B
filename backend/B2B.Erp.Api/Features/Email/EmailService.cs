using System.Net;
using System.Net.Mail;
using System.Text;
using Microsoft.Extensions.Options;

namespace B2B.Erp.Api.Features.Email;

public interface IEmailService
{
    Task SendEmailAsync(string toEmail, string subject, string bodyHtml, string? attachmentFileName = null, byte[]? attachmentBytes = null);
}

public class EmailService : IEmailService
{
    private readonly SmtpSettings _settings;
    private readonly ILogger<EmailService> _logger;

    public EmailService(IOptions<SmtpSettings> settings, ILogger<EmailService> logger)
    {
        _settings = settings.Value;
        _logger = logger;
    }

    public async Task SendEmailAsync(string toEmail, string subject, string bodyHtml, string? attachmentFileName = null, byte[]? attachmentBytes = null)
    {
        if (string.IsNullOrWhiteSpace(_settings.Host))
        {
            throw new InvalidOperationException("SMTP sunucu adresi (Host) yapılandırılmamış.");
        }

        if (string.IsNullOrWhiteSpace(_settings.SenderEmail) || string.IsNullOrWhiteSpace(_settings.Password))
        {
            throw new InvalidOperationException("Gönderici e-posta adresi veya şifresi appsettings.json içerisinde eksik.");
        }

        var enableSsl = _settings.EnableSsl;

        try
        {
            await SendInternalAsync(toEmail, subject, bodyHtml, attachmentFileName, attachmentBytes, enableSsl);
        }
        catch (Exception ex) when (ex.Message.Contains("secure connections") || ex.Message.Contains("SSL") || ex.Message.Contains("TLS"))
        {
            _logger.LogWarning("Retrying email send with inverted SSL mode ({InvertedSsl})...", !enableSsl);
            await SendInternalAsync(toEmail, subject, bodyHtml, attachmentFileName, attachmentBytes, !enableSsl);
        }
    }

    private async Task SendInternalAsync(string toEmail, string subject, string bodyHtml, string? attachmentFileName, byte[]? attachmentBytes, bool enableSsl)
    {
        using var client = new SmtpClient(_settings.Host, _settings.Port)
        {
            EnableSsl = enableSsl,
            Credentials = new NetworkCredential(_settings.Username, _settings.Password),
            Timeout = 30000
        };

        using var mail = new MailMessage
        {
            From = new MailAddress(_settings.SenderEmail, _settings.SenderName ?? "B2B ERP"),
            Subject = subject,
            Body = bodyHtml,
            IsBodyHtml = true,
            BodyEncoding = Encoding.UTF8,
            SubjectEncoding = Encoding.UTF8
        };

        mail.To.Add(toEmail);

        if (!string.IsNullOrWhiteSpace(attachmentFileName) && attachmentBytes != null && attachmentBytes.Length > 0)
        {
            var stream = new MemoryStream(attachmentBytes);
            // MailMessage.Dispose ekleri de kapatır, ek de kendi akışını kapatır — sızıntı yok.
            // Sabit olan MIME tipiydi: PDF/ZIP eki Excel tipiyle gidince istemci dosyayı bozuk açıyordu.
            mail.Attachments.Add(new Attachment(stream, attachmentFileName, ResolveMediaType(attachmentFileName)));
        }

        try
        {
            _logger.LogInformation("Sending email to {ToEmail} via {Host}:{Port} (SSL={EnableSsl})...", toEmail, _settings.Host, _settings.Port, enableSsl);
            await client.SendMailAsync(mail);
            _logger.LogInformation("Email successfully sent to {ToEmail}", toEmail);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send email to {ToEmail}: {Message}", toEmail, ex.Message);
            throw new InvalidOperationException($"E-posta gönderilemedi: {ex.Message}", ex);
        }
    }

    /// <summary>
    /// Ekin MIME tipini dosya uzantısından çözer. Sabit Excel tipi yazılıydı: PDF ya da ZIP
    /// gönderilince istemci dosyayı Excel sanıp bozuk açıyordu. Bilinmeyen uzantı için
    /// genel ikili tip döner — yanlış bir tip söylemektense söylememek daha doğru.
    /// </summary>
    private static string ResolveMediaType(string fileName) =>
        Path.GetExtension(fileName ?? string.Empty).ToLowerInvariant() switch
        {
            ".xls" => "application/vnd.ms-excel",
            ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".pdf" => "application/pdf",
            ".csv" => "text/csv",
            ".zip" => "application/zip",
            ".doc" => "application/msword",
            ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".html" or ".htm" => "text/html",
            ".txt" => "text/plain",
            _ => "application/octet-stream"
        };
}
