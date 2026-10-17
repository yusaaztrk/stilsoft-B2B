using B2B.Erp.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

/// <summary>
/// Firma markası — personel portalının giriş ekranında ve üst şeridinde kullandığı logo ve
/// renkler.
///
/// <para>Bu uçlar ana API'de (bayi) yaşıyordu. Personel portalı tek başına yayına alınacağı ve
/// ana API canlıya çıkmayacağı için portalın ihtiyaç duyduğu İKİ okuma ucu buraya taşındı.
/// Marka DÜZENLEME (PUT) ucu taşınmadı: firma logosu/rengi bayi panelinden yönetiliyor ve o
/// panel yayına girmiyor.</para>
///
/// <para>Marka bilgisi kiracı veritabanında değil <see cref="MasterDbContext"/> içindeki
/// <c>Tenants</c> satırında durur; bu yüzden kiracı bağlantısı çözülmeden de okunabilir.</para>
/// </summary>
[ApiController]
[Route("api/[controller]")]
public sealed class TenantsController : ControllerBase
{
    private readonly MasterDbContext _masterDb;

    public TenantsController(MasterDbContext masterDb)
    {
        _masterDb = masterDb;
    }

    public sealed class TenantBrandingDto
    {
        public string? LogoUrl { get; set; }
        public string? HeaderGradientFrom { get; set; }
        public string? HeaderGradientTo { get; set; }

        /// <summary>
        /// Portal bu alanı okuyor ama personel tarafında hiçbir yerde kullanmıyor; e-ticaret
        /// bayi modülüne ait. Sözleşme bozulmasın diye alan duruyor, değeri her zaman false.
        /// </summary>
        public bool IsEcommerceEnabled { get; set; }
    }

    /// <summary>
    /// İsteğin DIŞARIDAN görünen adresi. Ters vekil TLS'i kendisi sonlandırdığında uygulamaya
    /// düz http geliyor ve <c>Request.Scheme</c> "http" kalıyor; HTTPS sayfada tarayıcı bu
    /// adresle üretilen logoyu karma içerik kuralıyla engelliyor. Vekilin bildirdiği şema
    /// varsa o kullanılır.
    /// </summary>
    private string PublicOrigin()
    {
        var scheme = Request.Scheme;
        if (Request.Headers.TryGetValue("X-Forwarded-Proto", out var proto))
        {
            var first = proto.ToString().Split(',')[0].Trim().ToLowerInvariant();
            if (first == "https" || first == "http") scheme = first;
        }

        return $"{scheme}://{Request.Host.Value}";
    }

    private IActionResult BrandingOf(Entities.Tenant tenant)
    {
        var logoUrl = string.IsNullOrWhiteSpace(tenant.LogoPath)
            ? null
            : $"{PublicOrigin()}{tenant.LogoPath}";

        return Ok(new
        {
            success = true,
            data = new TenantBrandingDto
            {
                LogoUrl = logoUrl,
                HeaderGradientFrom = tenant.HeaderGradientFrom,
                HeaderGradientTo = tenant.HeaderGradientTo,
                IsEcommerceEnabled = false
            }
        });
    }

    /// <summary>Giriş ekranı için: oturum açılmadan önce çağrılır.</summary>
    [HttpGet("public-branding")]
    [AllowAnonymous]
    public async Task<IActionResult> GetPublicBranding([FromQuery] string? tenantCode, CancellationToken cancellationToken)
    {
        var code = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(code))
        {
            return BadRequest(new { success = false, message = "Tenant kodu zorunludur" });
        }

        var tenant = await _masterDb.Tenants.FirstOrDefaultAsync(x => x.Code == code, cancellationToken);
        if (tenant is null)
        {
            return NotFound(new { success = false, message = "Tenant bulunamadı" });
        }

        return BrandingOf(tenant);
    }

    /// <summary>Oturum açıldıktan sonra: firma kodu başlıktan okunur.</summary>
    [HttpGet("branding")]
    [Authorize]
    public async Task<IActionResult> GetBranding(CancellationToken cancellationToken)
    {
        var code = Request.Headers["X-Tenant-Code"].ToString().Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(code))
        {
            return BadRequest(new { success = false, message = "Tenant bulunamadı" });
        }

        var tenant = await _masterDb.Tenants.FirstOrDefaultAsync(x => x.Code == code, cancellationToken);
        if (tenant is null)
        {
            return NotFound(new { success = false, message = "Tenant bulunamadı" });
        }

        return BrandingOf(tenant);
    }
}
