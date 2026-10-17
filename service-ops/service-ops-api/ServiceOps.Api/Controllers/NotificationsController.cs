using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.IdentityModel.Tokens.Jwt;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;

using ServiceOps.Api.Filters;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[AllowWriteWithoutPageScope("Bildirim okundu/silme işlemleri kullanıcının kendi kişisel bildirimleridir ve sayfa yetkisi gerektirmez.")]
public class NotificationsController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly ServiceOps.Api.Services.IJobAssignmentNotifier _notifier;

    public NotificationsController(
        ApplicationDbContext context,
        ServiceOps.Api.Services.IJobAssignmentNotifier notifier)
    {
        _context = context;
        _notifier = notifier;
    }

    public sealed class InternalNotificationRequest
    {
        /// <summary>B2B kullanıcı adı. İki program arasında ortak olan tek kimlik bu.</summary>
        public string? Username { get; set; }
        public string? Title { get; set; }
        public string? Message { get; set; }
    }

    /// <summary>
    /// Bayi (B2B) tarafında üretilen bildirimi servise taşır.
    ///
    /// Kullanıcı oturumu değil, sunucu-sunucu anahtarı ile korunur: çağıranın arkasında bir
    /// insan yok. Kullanıcı adının teknisyen karşılığı yoksa 200 döner ve hiçbir şey yazılmaz —
    /// B2B'deki her bildirimin serviste bir karşılığı olmak zorunda değil, bu bir hata değil.
    ///
    /// Yazma <see cref="ServiceOps.Api.Services.IJobAssignmentNotifier"/> üzerinden yapılır:
    /// canlı iletim ve sesli okuma metni orada tek yerde kuruluyor.
    /// </summary>
    [HttpPost("internal")]
    [ServiceOps.Api.Filters.InternalApiKeyOrUser]
    public async Task<IActionResult> CreateInternal(
        [FromBody] InternalNotificationRequest request,
        CancellationToken cancellationToken)
    {
        var username = (request?.Username ?? string.Empty).Trim();
        var title = (request?.Title ?? string.Empty).Trim();
        var message = (request?.Message ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(title))
        {
            return BadRequest(new { success = false, message = "Kullanıcı adı ve başlık zorunludur." });
        }

        var technicianId = await _context.Technicians
            .AsNoTracking()
            .Where(t => t.IsActive && t.UserId != null && t.UserId.ToLower() == username.ToLower())
            .Select(t => (Guid?)t.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (technicianId is null)
        {
            return Ok(new { success = true, delivered = false, reason = "Kullanıcının teknisyen karşılığı yok." });
        }

        await _notifier.NotifyTechnicianAsync(
            technicianId.Value,
            title,
            message,
            jobType: "B2B",
            jobId: null,
            // Kaynak zaten B2B: geri yazılırsa iki program birbirine sonsuz bildirim yollar.
            mirrorToB2B: false,
            cancellationToken);

        return Ok(new { success = true, delivered = true });
    }

    private async Task<List<Guid>> GetUserTargetIdsAsync()
    {
        var ids = new List<Guid>();

        var claimValue = User.FindFirstValue("technicianId");
        if (Guid.TryParse(claimValue, out var claimTechId) && claimTechId != Guid.Empty)
        {
            ids.Add(claimTechId);
        }

        var sub = User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (Guid.TryParse(sub, out var userId) && userId != Guid.Empty)
        {
            ids.Add(userId);

            var user = await _context.ServiceUsers
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userId);

            if (user?.TechnicianId != null && user.TechnicianId != Guid.Empty)
            {
                ids.Add(user.TechnicianId.Value);
            }

            var username = user?.Username ?? User.Identity?.Name;
            if (!string.IsNullOrWhiteSpace(username))
            {
                var techIds = await _context.Technicians
                    .AsNoTracking()
                    .Where(t => t.UserId != null && t.UserId.ToLower() == username.ToLower())
                    .Select(t => t.Id)
                    .ToListAsync();
                ids.AddRange(techIds);
            }
        }

        return ids.Distinct().ToList();
    }

    [HttpGet]
    public async Task<ActionResult<List<Notification>>> GetNotifications()
    {
        var targetIds = await GetUserTargetIdsAsync();

        // HEDEF YOKSA LİSTE BOŞ. Süzgeç `targetIds.Count > 0` koşuluna bağlıydı: hedefi
        // çözülemeyen bir kullanıcıda sorgu HİÇ süzülmüyor ve herkesin bildirimlerinin son
        // 100'ü dönüyordu. Kardeş uç (`unread-count`) bu durumda zaten 0 dönüyor.
        if (targetIds.Count == 0)
        {
            return Ok(new List<Notification>());
        }

        IQueryable<Notification> query = _context.Notifications
            .AsNoTracking()
            .Where(n => targetIds.Contains(n.TechnicianId));

        var list = await query
            .OrderByDescending(n => n.CreatedAt)
            .Take(100)
            .ToListAsync();

        return Ok(list);
    }

    [HttpGet("unread-count")]
    public async Task<ActionResult<int>> GetUnreadCount()
    {
        var targetIds = await GetUserTargetIdsAsync();
        if (targetIds.Count == 0) return Ok(0);

        var count = await _context.Notifications
            .CountAsync(n => targetIds.Contains(n.TechnicianId) && !n.IsRead);

        return Ok(count);
    }

    [HttpPatch("{id}/read")]
    [HttpPost("{id}/read")]
    public async Task<IActionResult> MarkAsRead(string id)
    {
        if (!Guid.TryParse(id, out var guidId))
        {
            return BadRequest("Invalid Notification ID format.");
        }

        var notification = await _context.Notifications.FirstOrDefaultAsync(n => n.Id == guidId);
        if (notification != null)
        {
            notification.IsRead = true;
            await _context.SaveChangesAsync();
            Console.WriteLine($"[NotificationsController] Notification {guidId} marked as READ in DB.");
        }
        else
        {
            Console.WriteLine($"[NotificationsController] Notification {guidId} NOT FOUND in DB.");
        }
        return NoContent();
    }

    [HttpPost("read-all")]
    [HttpPatch("read-all")]
    public async Task<IActionResult> MarkAllAsRead()
    {
        var targetIds = await GetUserTargetIdsAsync();

        List<Notification> unread;
        if (targetIds.Count > 0)
        {
            unread = await _context.Notifications
                .Where(n => !n.IsRead && targetIds.Contains(n.TechnicianId))
                .ToListAsync();
        }
        else
        {
            unread = new List<Notification>();
        }

        if (unread.Count == 0)
        {
            unread = await _context.Notifications.Where(n => !n.IsRead).ToListAsync();
        }

        foreach (var item in unread)
        {
            item.IsRead = true;
        }

        await _context.SaveChangesAsync();
        Console.WriteLine($"[NotificationsController] MarkAllAsRead: {unread.Count} notifications marked as READ in DB.");
        return NoContent();
    }

    [HttpDelete("{id}")]
    [HttpPost("{id}/delete")]
    public async Task<IActionResult> Delete(string id)
    {
        if (!Guid.TryParse(id, out var guidId))
        {
            return BadRequest("Invalid Notification ID format.");
        }

        var notification = await _context.Notifications.FirstOrDefaultAsync(n => n.Id == guidId);
        if (notification != null)
        {
            _context.Notifications.Remove(notification);
            await _context.SaveChangesAsync();
            Console.WriteLine($"[NotificationsController] Notification {guidId} DELETED from DB.");
        }
        else
        {
            Console.WriteLine($"[NotificationsController] Notification {guidId} NOT FOUND for deletion in DB.");
        }
        return NoContent();
    }

    [HttpDelete("delete-all")]
    [HttpPost("delete-all")]
    public async Task<IActionResult> DeleteAll()
    {
        var targetIds = await GetUserTargetIdsAsync();

        List<Notification> list;
        if (targetIds.Count > 0)
        {
            list = await _context.Notifications
                .Where(n => targetIds.Contains(n.TechnicianId))
                .ToListAsync();
        }
        else
        {
            list = new List<Notification>();
        }

        if (list.Count == 0)
        {
            list = await _context.Notifications.ToListAsync();
        }

        _context.Notifications.RemoveRange(list);
        await _context.SaveChangesAsync();
        Console.WriteLine($"[NotificationsController] DeleteAll: {list.Count} notifications DELETED from DB.");
        return NoContent();
    }
}
