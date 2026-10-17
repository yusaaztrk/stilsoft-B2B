using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Shop.Api.Infrastructure;
using Shop.Api.Members;

namespace Shop.Api.Payments;

/// <summary>
/// Ödeme uçları. Üye oturumu ister ve müşteri YALNIZCA kendi carisi adına ödeme yapabilir:
/// cari kodu istekten değil, oturumdaki üyeden okunur.
///
/// Gövdede TUTAR ALANI YOK. Karttan çekilecek tutar siparişten okunuyor; istemcinin
/// söyleyeceği bir rakam bu akışın hiçbir yerinde kullanılmıyor.
/// </summary>
[ApiController]
[Route("api/payments")]
public sealed class PaymentsController : ControllerBase
{
    private readonly PaymentService _payments;
    private readonly MemberStore _members;

    public PaymentsController(PaymentService payments, MemberStore members)
    {
        _payments = payments;
        _members = members;
    }

    private async Task<Member?> CurrentMemberAsync(CancellationToken ct)
    {
        var token = Request.Headers[AccountController.SessionHeader].ToString();
        return string.IsNullOrWhiteSpace(token) ? null : await _members.FindBySessionAsync(token, ct);
    }

    public sealed class StartRequest
    {
        [Required, MaxLength(100)]
        public string CardHolderName { get; set; } = string.Empty;

        [Required, MaxLength(25)]
        public string CardNumber { get; set; } = string.Empty;

        [Required, MaxLength(2)]
        public string ExpMonth { get; set; } = string.Empty;

        [Required, MaxLength(4)]
        public string ExpYear { get; set; } = string.Empty;

        [Required, MaxLength(4)]
        public string Cvc { get; set; } = string.Empty;

        [Range(0, 36)]
        public int InstallmentCount { get; set; }

        /// <summary>0 = kartın BIN'inden çöz.</summary>
        public int BankCode { get; set; }

        [MaxLength(1000)]
        public string? DeliveryNote { get; set; }
    }

    /// <summary>
    /// Sepeti siparişe çevirip ödemeyi başlatır. Bankanın 3D formunu döner; tarayıcı onu
    /// gönderir ve müşteri bankaya gider.
    /// </summary>
    [HttpPost("start")]
    [EnableRateLimiting(RateLimitPolicies.Payment)]
    public async Task<IActionResult> Start([FromBody] StartRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        if (string.IsNullOrWhiteSpace(member.CustomerCode))
        {
            return StatusCode(StatusCodes.Status409Conflict, new
            {
                message = "Hesabınız henüz tamamlanmamış. Lütfen bizimle irtibata geçin."
            });
        }

        var card = new CardInput(
            request.CardHolderName,
            request.CardNumber,
            request.ExpMonth,
            request.ExpYear,
            request.Cvc,
            request.InstallmentCount,
            request.BankCode,
            member.Email,
            member.Phone ?? string.Empty);

        var result = await _payments.StartAsync(member.Id, member.CustomerCode, card, request.DeliveryNote, ct);

        if (!result.Success)
        {
            return BadRequest(new { message = result.Error ?? "Ödeme başlatılamadı." });
        }

        return Ok(new { orderNo = result.OrderNo, htmlForm = result.HtmlForm });
    }

    /// <summary>
    /// Siparişin ödeme durumu. Sonuç sayfası bunu sorar — bankadan dönen adrese değil.
    /// </summary>
    [HttpGet("{orderNo}")]
    public async Task<IActionResult> Status(string orderNo, CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        if (string.IsNullOrWhiteSpace(member.CustomerCode))
        {
            return NotFound(new { message = "Sipariş bulunamadı." });
        }

        var status = await _payments.GetStatusAsync(member.Id, member.CustomerCode, orderNo, ct);
        if (status is null) return NotFound(new { message = "Sipariş bulunamadı." });

        return Ok(status);
    }

    /// <summary>Kart numarasının ilk 6 hanesine göre banka ve taksit seçenekleri.</summary>
    [HttpGet("card-options")]
    public async Task<IActionResult> CardOptions(
        [FromQuery] string bin,
        [FromQuery] string orderNo,
        CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        if (string.IsNullOrWhiteSpace(member.CustomerCode))
        {
            return NotFound(new { message = "Sipariş bulunamadı." });
        }

        var data = await _payments.GetCardOptionsAsync(member.CustomerCode, orderNo ?? string.Empty, bin ?? string.Empty, ct);
        if (data is null) return NotFound(new { message = "Taksit seçenekleri alınamadı." });

        return Ok(data);
    }
}
