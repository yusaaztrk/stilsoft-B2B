using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Shop.Api.Infrastructure;
using Shop.Api.Members;

namespace Shop.Api.Cart;

/// <summary>
/// Sepet uçları. Hepsi üye oturumu ister: sepet kişiye ait.
///
/// Hiçbir uç fiyat KABUL ETMEZ — yalnızca stok kodu ve adet. Fiyat sunucuda çözülür.
/// </summary>
[ApiController]
[Route("api/cart")]
public sealed class CartController : ControllerBase
{
    private readonly CartService _cart;
    private readonly MemberStore _members;

    public CartController(CartService cart, MemberStore members)
    {
        _cart = cart;
        _members = members;
    }

    private async Task<Member?> CurrentMemberAsync(CancellationToken ct)
    {
        var token = Request.Headers[AccountController.SessionHeader].ToString();
        return string.IsNullOrWhiteSpace(token) ? null : await _members.FindBySessionAsync(token, ct);
    }

    public sealed class AddRequest
    {
        [Required, MaxLength(60)] public string StockCode { get; set; } = string.Empty;
        public int Quantity { get; set; } = 1;

        /// <summary>
        /// "Montaj istiyorum" seçimi. B2B sipariş ekranındaki seçimin vitrindeki karşılığı.
        /// Sunucu ürünün gerçekten montajlı olduğunu ayrıca doğruluyor.
        /// </summary>
        public bool WantsInstallation { get; set; }
    }

    public sealed class QuantityRequest
    {
        public int Quantity { get; set; }
    }

    public sealed class InstallationRequest
    {
        public bool WantsInstallation { get; set; }
    }

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        return Ok(await _cart.GetAsync(member.Id, ct));
    }

    [HttpPost("items")]
    [EnableRateLimiting(RateLimitPolicies.Write)]
    public async Task<IActionResult> Add([FromBody] AddRequest request, CancellationToken ct)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Sepete eklemek için giriş yapın." });

        var result = await _cart.AddAsync(
            member.Id, request.StockCode.Trim(), request.Quantity, ct, request.WantsInstallation);

        // Her hâl için ayrı cevap: müşteri "neden eklenmedi" sorusunun cevabını ekranda
        // görmeli. Hepsine tek metin vermek, stoğu biten ürünü katalogdan kalkmış gibi
        // gösterirdi.
        switch (result)
        {
            case CartService.AddResult.NotPublished:
                return NotFound(new { message = "Ürün şu anda satışta değil." });
            case CartService.AddResult.OutOfStock:
                return Conflict(new { message = "Bu ürün şu anda stokta yok." });
            case CartService.AddResult.NotEnoughStock:
                return Conflict(new { message = "Stokta yeterli adet kalmadı. Sepetinizdeki adedi azaltmayı deneyin." });
        }

        return Ok(await _cart.GetAsync(member.Id, ct));
    }

    [HttpPut("items/{stockCode}")]
    [EnableRateLimiting(RateLimitPolicies.Write)]
    public async Task<IActionResult> SetQuantity(string stockCode, [FromBody] QuantityRequest request, CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        await _cart.SetQuantityAsync(member.Id, stockCode, request.Quantity, ct);
        return Ok(await _cart.GetAsync(member.Id, ct));
    }

    /// <summary>
    /// Sepetteki satırın montaj seçimini değiştirir.
    ///
    /// Adet ucundan ayrı: müşteri sepette montajı açıp kaparken adedi göndermek zorunda
    /// olmamalı, adedi değiştirirken de montaj seçimi kaybolmamalı.
    /// </summary>
    [HttpPut("items/{stockCode}/montaj")]
    [EnableRateLimiting(RateLimitPolicies.Write)]
    public async Task<IActionResult> SetInstallation(
        string stockCode, [FromBody] InstallationRequest request, CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        var applied = await _cart.SetInstallationAsync(member.Id, stockCode, request.WantsInstallation, ct);
        if (!applied)
        {
            return Conflict(new { message = "Bu ürün için montaj seçeneği yok." });
        }

        return Ok(await _cart.GetAsync(member.Id, ct));
    }

    [HttpDelete("items/{stockCode}")]
    public async Task<IActionResult> Remove(string stockCode, CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        await _cart.RemoveManyAsync(member.Id, new[] { stockCode }, ct);
        return Ok(await _cart.GetAsync(member.Id, ct));
    }

    [HttpDelete]
    public async Task<IActionResult> Clear(CancellationToken ct)
    {
        var member = await CurrentMemberAsync(ct);
        if (member is null) return Unauthorized(new { message = "Oturum bulunamadı." });

        await _cart.ClearAsync(member.Id, ct);
        return Ok(new CartView());
    }
}
