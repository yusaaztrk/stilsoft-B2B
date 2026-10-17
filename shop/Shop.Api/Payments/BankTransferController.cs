using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Shop.Api.Admin;
using Shop.Api.Infrastructure;
using Shop.Api.Members;

namespace Shop.Api.Payments;

/// <summary>Havale/EFT — müşteri uçları (oturum) ve bayi uçları (B2B token). Bkz. <see cref="BankTransferService"/>.</summary>
[ApiController]
public sealed class BankTransferController : ControllerBase
{
    private readonly BankTransferService _service;
    private readonly MemberStore _members;

    public BankTransferController(BankTransferService service, MemberStore members)
    {
        _service = service;
        _members = members;
    }

    private async Task<Member?> CurrentMemberAsync(CancellationToken ct)
    {
        var token = Request.Headers[AccountController.SessionHeader].ToString();
        return string.IsNullOrWhiteSpace(token) ? null : await _members.FindBySessionAsync(token, ct);
    }

    public sealed class RequestBody
    {
        [MaxLength(1000)] public string? DeliveryNote { get; set; }
    }

    public sealed class SentBody
    {
        [MaxLength(500)] public string? Note { get; set; }
    }

    /// <summary>Müşteri "Havale / EFT" seçti.</summary>
    [HttpPost("api/payments/bank-transfer/request")]
    [EnableRateLimiting(RateLimitPolicies.Payment)]
    public async Task<IActionResult> StartBankTransfer([FromBody] RequestBody body, CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });
        if (string.IsNullOrWhiteSpace(member.CustomerCode))
            return StatusCode(StatusCodes.Status409Conflict, new { message = "Hesabınız henüz tamamlanmamış. Lütfen bizimle irtibata geçin." });

        var r = await _service.RequestAsync(member.Id, member.CustomerCode, body?.DeliveryNote, ct);
        if (!r.Success) return BadRequest(new { message = r.Error ?? "Havale kaydı açılamadı." });
        return Ok(r);
    }

    /// <summary>Müşteri "Gönderdim" dedi.</summary>
    [HttpPost("api/payments/bank-transfer/{orderNo}/sent")]
    [EnableRateLimiting(RateLimitPolicies.Payment)]
    public async Task<IActionResult> Sent(string orderNo, [FromBody] SentBody body, CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });
        if (string.IsNullOrWhiteSpace(member.CustomerCode)) return NotFound(new { message = "Sipariş bulunamadı." });

        var r = await _service.MarkSentAsync(member.Id, member.CustomerCode, orderNo, body?.Note, ct);
        if (!r.Success) return BadRequest(new { message = r.Error ?? "Bildirim kaydedilemedi." });
        return Ok(r);
    }

    /// <summary>Havale seçeneği açık mı + hesaplar (ödeme sayfası).</summary>
    [HttpGet("api/payments/bank-transfer/options")]
    public async Task<IActionResult> Options(CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });
        var enabled = await _service.IsEnabledAsync(ct);
        return Ok(new { enabled });
    }

    // ------------------------------------------------------------------ bayi

    public sealed class AdminActionBody
    {
        [Required, MaxLength(50)] public string CustomerCode { get; set; } = string.Empty;
        [MaxLength(200)] public string? Reference { get; set; }
        [MaxLength(500)] public string? Reason { get; set; }
    }

    [HttpGet("api/admin/bank-transfers")]
    [B2BAdminAuth]
    public async Task<IActionResult> AdminList(CancellationToken ct)
    {
        var data = await _service.ListOpenAsync(ct);
        if (data is null) return StatusCode(StatusCodes.Status502BadGateway, new { message = "ERP'ye ulaşılamadı." });
        return Ok(data);
    }

    [HttpPost("api/admin/bank-transfers/{orderNo}/confirm")]
    [B2BAdminAuth]
    public async Task<IActionResult> AdminConfirm(string orderNo, [FromBody] AdminActionBody body, CancellationToken ct)
    {
        var (ok, err) = await _service.ConfirmAsync(orderNo, body.CustomerCode, body.Reference, ct);
        return ok ? Ok(new { success = true }) : BadRequest(new { success = false, message = err });
    }

    [HttpPost("api/admin/bank-transfers/{orderNo}/reject")]
    [B2BAdminAuth]
    public async Task<IActionResult> AdminReject(string orderNo, [FromBody] AdminActionBody body, CancellationToken ct)
    {
        var (ok, err) = await _service.RejectAsync(orderNo, body.CustomerCode, body.Reason, ct);
        return ok ? Ok(new { success = true }) : BadRequest(new { success = false, message = err });
    }
}
