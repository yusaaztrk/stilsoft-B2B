using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace B2B.Erp.Api.Features.Email;

[ApiController]
[Route("api/[controller]")]
public class EmailController : ControllerBase
{
    private readonly IEmailService _emailService;
    private readonly ILogger<EmailController> _logger;

    public EmailController(IEmailService emailService, ILogger<EmailController> logger)
    {
        _emailService = emailService;
        _logger = logger;
    }

    public record SendCariEkstreEmailRequest(
        string ToEmail,
        string Subject,
        string CustomerCode,
        string CustomerName,
        string? FromDate,
        string? ToDate,
        string HtmlContent,
        string? ExcelBase64,
        string? ExcelFileName
    );

    [HttpPost("send-cari-ekstre")]
    // Gövde tamamen çağırandan geliyor (alıcı adresi, HTML gövde, ek dosya). Anonim bırakılırsa
    // bu uç şirketin SMTP'si üzerinden açık bir posta rölesidir: dışarıdan herkes şirketin
    // adresinden istediği kişiye istediği içeriği yollayabilir. Tek çağıran (frontend
    // emailService.ts) zaten Bearer token gönderiyor.
    [Authorize]
    public async Task<IActionResult> SendCariEkstreEmail([FromBody] SendCariEkstreEmailRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.ToEmail))
        {
            return BadRequest(new { success = false, message = "Alıcı e-posta adresi (ToEmail) gereklidir." });
        }

        try
        {
            byte[]? attachmentBytes = null;
            if (!string.IsNullOrWhiteSpace(request.ExcelBase64))
            {
                attachmentBytes = Convert.FromBase64String(request.ExcelBase64);
            }

            var subject = string.IsNullOrWhiteSpace(request.Subject)
                ? $"Cari Ekstre Raporu - {request.CustomerName} ({request.CustomerCode})"
                : request.Subject;

            await _emailService.SendEmailAsync(
                toEmail: request.ToEmail.Trim(),
                subject: subject,
                bodyHtml: request.HtmlContent,
                attachmentFileName: request.ExcelFileName ?? $"cari-ekstre-{request.CustomerCode}.xls",
                attachmentBytes: attachmentBytes
            );

            return Ok(new { success = true, message = $"{request.ToEmail} adresine e-posta başarıyla gönderildi." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Cari ekstre e-postası gönderilirken hata oluştu: {Message}", ex.Message);
            return StatusCode(500, new { success = false, message = ex.Message });
        }
    }

    [HttpGet("status")]
    [AllowAnonymous]
    public IActionResult GetStatus()
    {
        return Ok(new { success = true, message = "E-posta servisi hazır." });
    }
}
