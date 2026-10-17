using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data.Services;
using B2B.Erp.Api.Features.Ecommerce;
using B2B.Erp.Api.Features.VirtualPos;
using B2B.Erp.Api.Features.VirtualPos.Core;
using Microsoft.AspNetCore.Mvc;

namespace B2B.Erp.Api.Controllers;

/// <summary>
/// Mağazanın ödeme uçları. Servis anahtarıyla çağrılır (arkasında bayi oturumu yok) ve kapsam
/// dar: yalnızca <c>120-11-</c> carilerinin kendi e-ticaret siparişleri.
///
/// TUTAR PARAMETRESİ YOK — bilerek. Sipariş numarası veriliyor, karttan çekilecek tutar
/// siparişten okunuyor. Gövdeye tutar yazılsa bile dikkate alınmaz.
/// </summary>
[ApiController]
[Route("api/ecommerce/payments")]
public sealed class EcommercePaymentsController : ControllerBase
{
    private readonly EcommercePaymentService _payments;
    private readonly IVirtualPosService _virtualPos;
    private readonly TenantConnectionStringResolver _tenantResolver;
    private readonly IConfiguration _configuration;
    private readonly EcommerceBankTransferService _bankTransfer;

    public EcommercePaymentsController(
        EcommercePaymentService payments,
        IVirtualPosService virtualPos,
        TenantConnectionStringResolver tenantResolver,
        IConfiguration configuration,
        EcommerceBankTransferService bankTransfer)
    {
        _payments = payments;
        _virtualPos = virtualPos;
        _tenantResolver = tenantResolver;
        _configuration = configuration;
        _bankTransfer = bankTransfer;
    }

    /* ---------------------------------------------------------------------------------
       HAVALE / EFT (2026-09-20) — bkz. EcommerceBankTransferService. Hepsi mağaza API'sinden
       (X-Internal-Key) çağrılır; müşteri ve bayi işlemleri orada ayrışır.
       --------------------------------------------------------------------------------- */
    public sealed class BankTransferRequestBody
    {
        [Required, MaxLength(50)] public string CustomerCode { get; set; } = string.Empty;
        [Required, MaxLength(50)] public string OrderNo { get; set; } = string.Empty;
        [MaxLength(500)] public string? Note { get; set; }
    }

    public sealed class BankTransferAdminBody
    {
        [Required, MaxLength(50)] public string OrderNo { get; set; } = string.Empty;
        [MaxLength(200)] public string? Reference { get; set; }
        [MaxLength(500)] public string? Reason { get; set; }
    }

    [HttpPost("bank-transfer/request")]
    [InternalApiKey]
    public async Task<IActionResult> BankTransferRequest([FromBody] BankTransferRequestBody body, CancellationToken ct)
    {
        var r = await _bankTransfer.RequestAsync(body.CustomerCode, body.OrderNo, ct);
        return r.Success ? Ok(new { success = true, data = r }) : BadRequest(new { success = false, message = r.Error, data = r });
    }

    [HttpPost("bank-transfer/sent")]
    [InternalApiKey]
    public async Task<IActionResult> BankTransferSent([FromBody] BankTransferRequestBody body, CancellationToken ct)
    {
        var r = await _bankTransfer.MarkSentAsync(body.CustomerCode, body.OrderNo, body.Note, ct);
        return r.Success ? Ok(new { success = true, data = r }) : BadRequest(new { success = false, message = r.Error, data = r });
    }

    [HttpPost("bank-transfer/confirm")]
    [InternalApiKey]
    public async Task<IActionResult> BankTransferConfirm([FromBody] BankTransferAdminBody body, CancellationToken ct)
    {
        var r = await _bankTransfer.ConfirmAsync(body.OrderNo, body.Reference, ct);
        return r.Success ? Ok(new { success = true, data = r }) : BadRequest(new { success = false, message = r.Error, data = r });
    }

    [HttpPost("bank-transfer/reject")]
    [InternalApiKey]
    public async Task<IActionResult> BankTransferReject([FromBody] BankTransferAdminBody body, CancellationToken ct)
    {
        var r = await _bankTransfer.RejectAsync(body.OrderNo, body.Reason, ct);
        return r.Success ? Ok(new { success = true, data = r }) : BadRequest(new { success = false, message = r.Error, data = r });
    }

    [HttpGet("bank-transfer/open")]
    [InternalApiKey]
    public async Task<IActionResult> BankTransferOpen([FromQuery] int timeoutHours, CancellationToken ct)
    {
        // Tembel süre aşımı: liste her okunduğunda eskiler kapanır.
        var expired = await _bankTransfer.ExpireAsync(timeoutHours <= 0 ? 72 : timeoutHours, ct);
        var open = await _bankTransfer.ListOpenAsync(ct);
        return Ok(new { success = true, data = open, expired = expired.Select(x => new { orderNo = x.OrderNo, customerCode = x.CustomerCode }) });
    }

    public sealed class StartPaymentRequest
    {
        [Required, MaxLength(50)]
        public string CustomerCode { get; set; } = string.Empty;

        [Required, MaxLength(50)]
        public string OrderNo { get; set; } = string.Empty;

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

        /// <summary>0 = kartın BIN'inden çöz. Yönlendirme kuralı VirtualPosRouting'de.</summary>
        public int BankCode { get; set; }

        [MaxLength(150)]
        public string? Email { get; set; }

        [MaxLength(30)]
        public string? Phone { get; set; }
    }

    [HttpPost("start")]
    [InternalApiKey]
    public async Task<IActionResult> Start([FromBody] StartPaymentRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        // Ödeme kaydı bu firmanın veritabanına yazılıyor ve banka sonucu ne başlık ne token ile
        // geri gönderiyor: firma, bankaya verilen adresin İÇİNDE taşınmak zorunda.
        var tenantCode = _tenantResolver.GetCurrentTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            // Burada reddetmenin bedeli yok. Yine de başlatmak, parayı alıp callback'i
            // sahipsiz bırakmak olurdu.
            return BadRequest(new { success = false, message = "Ödeme başlatılamadı: firma bilgisi çözümlenemedi." });
        }

        // Yapılandırılmış `VirtualPos:CallbackBaseUrl` yoksa istek adresine düşülüyor; ters vekil
        // arkasında `Request.Scheme` http kalıyor ve banka http callback'i reddediyor.
        var callbackUrl = VirtualPosCallbackUrl.Build(
            _configuration, B2B.Erp.Api.Core.Helpers.PublicOrigin.Of(Request), tenantCode);

        var card = new VirtualPosPaymentRequest
        {
            CardHolderName = request.CardHolderName,
            CardNumber = request.CardNumber,
            ExpMonth = request.ExpMonth,
            ExpYear = request.ExpYear,
            Cvc = request.Cvc,
            InstallmentCount = request.InstallmentCount,
            BankCode = request.BankCode,
            Email = request.Email ?? string.Empty,
            Phone = request.Phone ?? string.Empty
        };

        var result = await _payments.StartAsync(
            request.CustomerCode, request.OrderNo, card, callbackUrl, cancellationToken);

        if (!result.Success)
        {
            return BadRequest(new { success = false, message = result.Message ?? "Ödeme başlatılamadı." });
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                htmlForm = result.HtmlForm,
                merchantOrderId = result.MerchantOrderId
            }
        });
    }

    /// <summary>
    /// Siparişin ödeme durumu — mağazanın "gerçekten ödendi mi" sorusunun tek geçerli cevabı.
    /// Bankanın müşteriyi geri yolladığı adres kanıt değildir; bu uç kanıttır.
    /// </summary>
    [HttpGet("{orderNo}")]
    [InternalApiKey]
    public async Task<IActionResult> GetStatus(
        string orderNo,
        [FromQuery] string customerCode,
        CancellationToken cancellationToken)
    {
        var status = await _payments.GetStatusAsync(customerCode, orderNo, cancellationToken);

        if (status is null)
        {
            return NotFound(new { success = false, message = "Sipariş bulunamadı." });
        }

        return Ok(new { success = true, data = status });
    }

    /// <summary>
    /// Kartın bankası ve o siparişin tutarı için geçerli taksit seçenekleri.
    ///
    /// Tutar yine istekten değil siparişten okunuyor: taksit tutarları da müşteriye gösterilen
    /// para rakamları ve istemcinin belirlediği bir tutar üzerinden hesaplanmamalı.
    /// </summary>
    [HttpGet("card-options")]
    [InternalApiKey]
    public async Task<IActionResult> CardOptions(
        [FromQuery] string bin,
        [FromQuery] string orderNo,
        [FromQuery] string customerCode,
        CancellationToken cancellationToken)
    {
        var status = await _payments.GetStatusAsync(customerCode, orderNo, cancellationToken);
        if (status is null)
        {
            return NotFound(new { success = false, message = "Sipariş bulunamadı." });
        }

        var data = await _virtualPos.LookupBinAsync(bin ?? string.Empty, status.OrderTotal, cancellationToken);
        return Ok(new { success = true, data });
    }
}
