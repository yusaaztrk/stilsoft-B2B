using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Shop.Api.Admin;
using Shop.Api.Infrastructure;

namespace Shop.Api.Marketing;

/// <summary>
/// Panel pazarlama uçları (2026-09-20): üyelere toplu SMS ve sepet hatırlatma.
/// Kimlik: bayinin B2B token'ı (<see cref="B2BAdminAuthAttribute"/>).
/// </summary>
[ApiController]
[Route("api/admin/marketing")]
[B2BAdminAuth]
public sealed class MarketingController : ControllerBase
{
    private readonly CampaignSmsService _campaign;
    private readonly ISmsService _sms;
    private readonly CartReminderWorker _cartReminder;

    public MarketingController(CampaignSmsService campaign, ISmsService sms, CartReminderWorker cartReminder)
    {
        _campaign = campaign;
        _sms = sms;
        _cartReminder = cartReminder;
    }

    private string Actor =>
        (HttpContext.Items[B2BAdminAuthAttribute.PrincipalItemKey] as ClaimsPrincipal)?
            .FindFirst(ClaimTypes.Name)?.Value ?? "bayi";

    /// <summary>Gönderim öncesi: SMS açık mı, kredi kaç, kaç üyeye gidecek.</summary>
    [HttpGet("sms-audience")]
    public async Task<IActionResult> Audience(CancellationToken ct)
    {
        var configured = _sms.IsConfigured;
        int? credit = null;
        if (configured)
        {
            try { credit = await _sms.GetCreditAsync(ct); } catch { credit = null; }
        }
        var count = await _campaign.CountAudienceAsync(ct);
        return Ok(new
        {
            success = true,
            data = new
            {
                configured,
                credit,
                audience = count,
                maxRecipients = CampaignSmsService.MaxRecipients,
                maxLength = CampaignSmsService.MaxMessageLength,
                running = _campaign.IsRunning
            }
        });
    }

    public sealed class SendBody
    {
        [Required, MaxLength(CampaignSmsService.MaxMessageLength)]
        public string Message { get; set; } = string.Empty;

        /// <summary>Doluysa yalnız bu numaraya deneme gönderilir, üyelere gitmez.</summary>
        [MaxLength(30)]
        public string? TestPhone { get; set; }
    }

    /// <summary>Toplu gönderimi başlatır (arka planda) ya da tek numaraya deneme atar.</summary>
    [HttpPost("sms")]
    public async Task<IActionResult> Send([FromBody] SendBody body, CancellationToken ct)
    {
        if (!string.IsNullOrWhiteSpace(body.TestPhone))
        {
            if (!_sms.IsConfigured) return BadRequest(new { success = false, message = "SMS servisi kapalı." });
            var phone = _sms.NormalizeMsisdn(body.TestPhone);
            if (phone.Length == 0) return BadRequest(new { success = false, message = "Deneme numarası geçersiz." });
            var r = await _sms.SendAsync(phone, SmsText.Ascii(body.Message.Trim()), ct);
            return r.Success
                ? Ok(new { success = true, message = "Deneme SMS'i gönderildi." })
                : BadRequest(new { success = false, message = $"Deneme SMS'i gitmedi: {r.ErrorCode}" });
        }

        var (started, error, state) = await _campaign.StartAsync(body.Message, Actor, ct);
        if (!started)
        {
            return state is { Finished: false }
                ? Conflict(new { success = false, message = error, data = View(state) })
                : BadRequest(new { success = false, message = error });
        }
        return Ok(new { success = true, data = View(state!) });
    }

    /// <summary>İlerleme + son gönderimler.</summary>
    [HttpGet("sms/status")]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
        var recent = await _campaign.RecentAsync(10, ct);
        return Ok(new
        {
            success = true,
            data = new
            {
                current = _campaign.Current is { } c ? View(c) : null,
                recent = recent.Select(r => new
                {
                    id = r.Id,
                    sentAtUtc = r.SentAtUtc,
                    sentBy = r.SentBy,
                    message = r.Message,
                    recipients = r.Recipients,
                    succeeded = r.Succeeded,
                    failed = r.Failed,
                    finishedAtUtc = r.FinishedAtUtc
                })
            }
        });
    }

    /// <summary>Sepet hatırlatma turunu şimdi koştur (test/teşhis). Kaç SMS gittiğini döner.</summary>
    [HttpPost("cart-reminder/run")]
    public async Task<IActionResult> RunCartReminder(CancellationToken ct)
    {
        if (!_sms.IsConfigured) return Ok(new { success = true, data = new { sent = 0 }, message = "SMS servisi kapalı; hiçbir şey gönderilmedi." });
        var sent = await _cartReminder.RunOnceAsync(ct);
        return Ok(new { success = true, data = new { sent } });
    }

    private static object View(CampaignSmsService.JobState s) => new
    {
        logId = s.LogId,
        message = s.Message,
        startedBy = s.StartedBy,
        startedAtUtc = s.StartedAtUtc,
        total = s.Total,
        sent = s.Sent,
        failed = s.Failed,
        finished = s.Finished,
        error = s.Error
    };
}
