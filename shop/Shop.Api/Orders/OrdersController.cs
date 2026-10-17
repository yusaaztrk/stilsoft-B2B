using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Shop.Api.Infrastructure;
using Shop.Api.Members;

namespace Shop.Api.Orders;

/// <summary>
/// Sipariş uçları. Üye oturumu ister ve müşteri YALNIZCA kendi carisi adına işlem yapabilir:
/// cari kodu istekten değil, oturumdaki üyeden okunur.
/// </summary>
[ApiController]
[Route("api/orders")]
public sealed class OrdersController : ControllerBase
{
    private readonly OrderService _orders;
    private readonly MemberStore _members;
    private readonly AccountDataService _accountData;

    public OrdersController(OrderService orders, MemberStore members, AccountDataService accountData)
    {
        _orders = orders;
        _members = members;
        _accountData = accountData;
    }

    private async Task<Member?> CurrentMemberAsync(CancellationToken ct)
    {
        var token = Request.Headers[AccountController.SessionHeader].ToString();
        return string.IsNullOrWhiteSpace(token) ? null : await _members.FindBySessionAsync(token, ct);
    }

    public sealed class CheckoutRequest
    {
        [MaxLength(1000)] public string? DeliveryNote { get; set; }
    }

    [HttpPost]
    [EnableRateLimiting(RateLimitPolicies.Write)]
    public async Task<IActionResult> Create([FromBody] CheckoutRequest request, CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        if (string.IsNullOrWhiteSpace(member.CustomerCode))
        {
            // Cari açılmadan sipariş verilemez; kayıt sırasında açılıyor, burada olmaması
            // veri tutarsızlığıdır ve sessizce geçilmemeli.
            return StatusCode(StatusCodes.Status409Conflict, new
            {
                message = "Hesabınız henüz tamamlanmamış. Lütfen bizimle irtibata geçin."
            });
        }

        var result = await _orders.CreateFromCartAsync(member.Id, member.CustomerCode, request?.DeliveryNote, ct);

        if (!result.Success)
        {
            return BadRequest(new { message = result.Error ?? "Sipariş oluşturulamadı." });
        }

        return Ok(new { orderNo = result.OrderNo, grandTotal = result.GrandTotal });
    }

    /// <summary>
    /// "Siparişlerim". Ödeme durumu, fatura numarası ve ürün adlarıyla birlikte —
    /// müşterinin ekranda okuduğu hâliyle.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        if (string.IsNullOrWhiteSpace(member.CustomerCode)) return Ok(Array.Empty<AccountOrder>());

        return Ok(await _accountData.ListOrdersAsync(member.CustomerCode, ct));
    }

    /// <summary>Tek siparişin ayrıntısı + teslimat durumu.</summary>
    [HttpGet("{orderNo}")]
    public async Task<IActionResult> Detail(string orderNo, CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        if (string.IsNullOrWhiteSpace(member.CustomerCode))
        {
            return NotFound(new { message = "Sipariş bulunamadı." });
        }

        var detail = await _accountData.GetOrderDetailAsync(member.CustomerCode, orderNo ?? string.Empty, ct);

        // "Yok" ile "senin değil" aynı cevabı veriyor: aksi hâlde sipariş numaraları denenerek
        // hangilerinin var olduğu öğrenilebilirdi.
        if (detail is null) return NotFound(new { message = "Sipariş bulunamadı." });

        return Ok(detail);
    }
}

/// <summary>
/// ÜYELİKSİZ SİPARİŞ TAKİBİ (2026-09-20): sipariş no + telefon. Eskiden takip yalnız girişliydi;
/// "siparişim nerede" sorusu telefona düşüyordu. Telefon SORGU DİZİSİNDE DEĞİL gövdede gelir;
/// eşleşme numaranın son 10 hanesiyle (biçim farkı yutulur). Yanlış numarada "bulunamadı"
/// döner, sipariş numarasının varlığı ele verilmez. Hız sınırı `auth` (numara deneme yüzeyi).
/// </summary>
[ApiController]
[Route("api/orders/track")]
public sealed class OrderTrackingController : ControllerBase
{
    private readonly AccountDataService _accountData;
    private readonly MemberStore _members;

    public OrderTrackingController(AccountDataService accountData, MemberStore members)
    {
        _accountData = accountData;
        _members = members;
    }

    public sealed class TrackRequest
    {
        [Required, MaxLength(50)] public string OrderNo { get; set; } = string.Empty;
        [Required, MaxLength(30)] public string Phone { get; set; } = string.Empty;
    }

    [HttpPost]
    [EnableRateLimiting(RateLimitPolicies.Auth)]
    public async Task<IActionResult> Track([FromBody] TrackRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        // Numaraya bağlı BÜTÜN cariler taranıyor (2026-10-05): üyesiz siparişte aynı numaraya
        // ayrı cari açılabiliyor, sipariş o carilerden birinde.
        var codes = await _members.ListCustomerCodesByPhoneAsync(request.Phone, ct);
        if (codes.Count == 0)
            return NotFound(new { message = "Bu telefon ve sipariş numarasıyla kayıt bulunamadı." });

        var orderNo = request.OrderNo.Trim();
        AccountOrder? order = null;
        foreach (var code in codes)
        {
            var orders = await _accountData.ListOrdersAsync(code, ct);
            order = orders.FirstOrDefault(o => string.Equals(o.OrderNo, orderNo, StringComparison.OrdinalIgnoreCase));
            if (order is not null) break;
        }
        if (order is null)
            return NotFound(new { message = "Bu telefon ve sipariş numarasıyla kayıt bulunamadı." });

        return Ok(new
        {
            order.OrderNo,
            order.ProcessedAt,
            order.GrandTotal,
            order.IsPaid,
            order.PaymentStatus,
            order.Stage,
            order.StageLabel,
            order.InvoiceNo,
            lines = order.Lines.Select(l => new { l.Name, l.Quantity })
        });
    }
}

/// <summary>
/// "Faturalarım". Ayrı bir controller değil aynı dosyada: sipariş ve fatura aynı ekranın
/// iki sekmesi ve aynı sahiplik kuralına tabi.
/// </summary>
[ApiController]
[Route("api/invoices")]
public sealed class InvoicesController : ControllerBase
{
    private readonly AccountDataService _accountData;
    private readonly MemberStore _members;

    public InvoicesController(AccountDataService accountData, MemberStore members)
    {
        _accountData = accountData;
        _members = members;
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var token = Request.Headers[AccountController.SessionHeader].ToString();
        var member = string.IsNullOrWhiteSpace(token) ? null : await _members.FindBySessionAsync(token, ct);

        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });
        if (string.IsNullOrWhiteSpace(member.CustomerCode)) return Ok(Array.Empty<AccountInvoice>());

        return Ok(await _accountData.ListInvoicesAsync(member.CustomerCode, ct));
    }
}
