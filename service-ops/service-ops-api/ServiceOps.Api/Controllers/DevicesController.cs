using System;
using System.IdentityModel.Tokens.Jwt;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Controllers;

/// <summary>
/// Telefonun bildirim adresini kaydeden uç.
///
/// Uygulama her açılışta kendi FCM anahtarını buraya yazar; çıkışta siler. Anahtar olmadan
/// uygulama kapalıyken bildirim gönderilemez.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class DevicesController : ControllerBase
{
    private readonly ApplicationDbContext _context;

    public DevicesController(ApplicationDbContext context)
    {
        _context = context;
    }

    public sealed class RegisterDeviceRequest
    {
        public string? Token { get; set; }
        /// <summary>"android" | "ios".</summary>
        public string? Platform { get; set; }
    }

    /// <summary>
    /// Kimlik çözümü <see cref="NotificationsController"/> ile BİREBİR aynı olmak zorunda.
    ///
    /// Bildirimi YAZAN taraf teknisyen kimliğini oradan, cihaz kaydını yapan taraf buradan
    /// çözüyor. İkisi farklı davranırsa cihaz bir kimliğe kaydedilir, bildirim başka bir
    /// kimliğe gönderilir ve mesaj hiç ulaşmaz — SignalR grubu katılımında yaşanan tuzağın
    /// aynısı.
    /// </summary>
    private async Task<Guid?> GetCurrentTechnicianIdAsync()
    {
        var claimValue = User.FindFirstValue("technicianId");
        if (Guid.TryParse(claimValue, out var claimTechId)) return claimTechId;

        var sub = User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(sub, out var userId)) return null;

        return await _context.ServiceUsers
            .AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => u.TechnicianId)
            .FirstOrDefaultAsync();
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterDeviceRequest request, CancellationToken cancellationToken)
    {
        var token = (request?.Token ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(token))
        {
            return BadRequest(new { success = false, message = "Cihaz anahtarı zorunludur." });
        }

        var technicianId = await GetCurrentTechnicianIdAsync();
        // Teknisyen karşılığı olmayan oturum (yönetici) bildirim almıyor. Bu bir hata değil:
        // 401/403 dönmek istemcinin genel hata işleyicisini tetikleyip kullanıcıyı girişe
        // atardı, oysa uygulamanın geri kalanı sorunsuz çalışıyor.
        if (!technicianId.HasValue || technicianId.Value == Guid.Empty)
        {
            return Ok(new { success = true, registered = false, reason = "Oturumun teknisyen karşılığı yok." });
        }

        var platform = (request?.Platform ?? string.Empty).Trim().ToLowerInvariant();
        if (platform != "android" && platform != "ios") platform = "android";

        var now = DateTime.UtcNow;
        var existing = await _context.DeviceTokens.FirstOrDefaultAsync(d => d.Token == token, cancellationToken);

        if (existing is null)
        {
            _context.DeviceTokens.Add(new DeviceToken
            {
                Id = Guid.NewGuid(),
                TechnicianId = technicianId.Value,
                Token = token,
                Platform = platform,
                CreatedAt = now,
                LastSeenAt = now
            });
        }
        else
        {
            // Cihaz el değiştirmiş olabilir: aynı telefona başka bir teknisyen giriyorsa satırın
            // SAHİBİ güncellenir. Yeni satır açmak, eski sahibin yeni sahibin işlerini duymaya
            // devam etmesi demek olurdu.
            existing.TechnicianId = technicianId.Value;
            existing.Platform = platform;
            existing.LastSeenAt = now;
        }

        await _context.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true, registered = true });
    }

    /// <summary>Çıkışta çağrılır: telefon artık bu kullanıcının bildirimlerini almasın.</summary>
    [HttpPost("unregister")]
    public async Task<IActionResult> Unregister([FromBody] RegisterDeviceRequest request, CancellationToken cancellationToken)
    {
        var token = (request?.Token ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(token)) return Ok(new { success = true });

        // SİLME YALNIZ KENDİ CİHAZ KAYDINDA. Anahtar sahipliği hiç doğrulanmıyordu: başkasının
        // FCM anahtarını gönderen biri o teknisyenin bildirim aboneliğini kapatabilir, iş emri
        // bildirimlerini almasını engelleyebilirdi. Teknisyen kimliği çözülemeyen çağrılarda
        // (ofis kullanıcısı, eski istemci) davranış eskisi gibi bırakıldı: aynı anahtarın
        // kaydını temizlemek, cihaz el değiştirdiğinde bayat satır kalmasını önlüyor.
        var currentTechnicianId = await GetCurrentTechnicianIdAsync();

        var rows = currentTechnicianId.HasValue
            ? await _context.DeviceTokens
                .Where(d => d.Token == token && d.TechnicianId == currentTechnicianId.Value)
                .ToListAsync(cancellationToken)
            : await _context.DeviceTokens.Where(d => d.Token == token).ToListAsync(cancellationToken);

        if (rows.Count > 0)
        {
            _context.DeviceTokens.RemoveRange(rows);
            await _context.SaveChangesAsync(cancellationToken);
        }

        return Ok(new { success = true });
    }
}
