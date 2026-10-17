using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.DTOs.Notifications;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class NotificationsController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly B2B.Erp.Api.Core.Services.IServiceOpsNotificationBridge _serviceOpsBridge;

    public NotificationsController(
        AppDbContext dbContext,
        B2B.Erp.Api.Core.Services.IServiceOpsNotificationBridge serviceOpsBridge)
    {
        _dbContext = dbContext;
        _serviceOpsBridge = serviceOpsBridge;
    }

    public sealed class InternalNotificationRequest
    {
        /// <summary>Alıcının kullanıcı adı. İki program arasında ortak olan tek kimlik bu.</summary>
        public string? Username { get; set; }
        public string? Title { get; set; }
        public string? Content { get; set; }
        public string? SenderName { get; set; }
    }

    /// <summary>
    /// Serviste (ServiceOps) üretilen bildirimi bayi tarafına yazar.
    ///
    /// Kullanıcı oturumu değil, sunucu-sunucu anahtarı ile korunur: çağıranın arkasında bir
    /// insan yok. Buraya yazılan bildirim servise GERİ köprülenmez — kaynağı zaten orası;
    /// aksi halde iki program birbirine sonsuz bildirim yollardı.
    /// </summary>
    [HttpPost("internal")]
    [InternalApiKey("ServiceOps:InternalApiKey")]
    public async Task<IActionResult> CreateInternal(
        [FromBody] InternalNotificationRequest request,
        CancellationToken cancellationToken)
    {
        var username = (request?.Username ?? string.Empty).Trim();
        var title = (request?.Title ?? string.Empty).Trim();
        var content = (request?.Content ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(title))
        {
            return BadRequest(new { success = false, message = "Kullanıcı adı ve başlık zorunludur." });
        }

        var userId = await _dbContext.Users
            .AsNoTracking()
            .Where(u => u.IsActive && u.Username == username)
            .Select(u => (int?)u.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (userId is null)
        {
            // Servisteki her teknisyenin bu firmada kullanıcısı olmak zorunda değil.
            return Ok(new { success = true, delivered = false, reason = "Kullanıcı bulunamadı." });
        }

        _dbContext.Notifications.Add(new Notification
        {
            UserId = userId.Value,
            Title = title,
            Content = content,
            IsRead = false,
            // Servis bildirimleri açılır pencere olarak zorlanmaz: teknisyen sahadayken bayi
            // ekranının önüne pencere çıkarmak işini böler.
            IsPopup = false,
            SenderName = string.IsNullOrWhiteSpace(request?.SenderName) ? "Servis" : request!.SenderName!.Trim(),
            CreateUser = "ServiceOps",
            CreateTime = DateTime.UtcNow
        });

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, delivered = true });
    }

    [HttpGet]
    public async Task<IActionResult> GetMyNotifications(CancellationToken cancellationToken)
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdClaim) || !int.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized();
        }

        var list = await _dbContext.Notifications
            .AsNoTracking()
            .Where(n => n.UserId == userId)
            .OrderByDescending(n => n.CreateTime)
            .Select(n => new NotificationResponse
            {
                Id = n.Id,
                UserId = n.UserId,
                UserDisplayName = n.User.Unvan,
                UserUsername = n.User.Username,
                Title = n.Title,
                Content = n.Content,
                IsRead = n.IsRead,
                ReadTime = n.ReadTime,
                IsPopup = n.IsPopup,
                SenderName = n.SenderName,
                CreateTime = n.CreateTime,
                CreateUser = n.CreateUser
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = list });
    }

    [HttpGet("unread-count")]
    public async Task<IActionResult> GetUnreadCount(CancellationToken cancellationToken)
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdClaim) || !int.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized();
        }

        var count = await _dbContext.Notifications
            .AsNoTracking()
            .CountAsync(n => n.UserId == userId && !n.IsRead, cancellationToken);

        return Ok(new { success = true, count = count });
    }

    [HttpGet("sent")]
    [AuthorizePage("bildirimler", "bildirimler")]
    public async Task<IActionResult> GetSentNotifications(CancellationToken cancellationToken)
    {
        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "System";

        var list = await _dbContext.Notifications
            .AsNoTracking()
            .Where(n => n.CreateUser == username)
            .OrderByDescending(n => n.CreateTime)
            .Select(n => new NotificationResponse
            {
                Id = n.Id,
                UserId = n.UserId,
                UserDisplayName = n.User.Unvan,
                UserUsername = n.User.Username,
                Title = n.Title,
                Content = n.Content,
                IsRead = n.IsRead,
                ReadTime = n.ReadTime,
                IsPopup = n.IsPopup,
                SenderName = n.SenderName,
                CreateTime = n.CreateTime,
                CreateUser = n.CreateUser
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = list });
    }

    [HttpPost("resolve-recipients")]
    [AuthorizePage("bildirimler", "bildirimler")]
    public async Task<IActionResult> ResolveRecipients([FromBody] ResolveRecipientsRequest request, CancellationToken cancellationToken)
    {
        var usersToNotifySet = new HashSet<int>();
        if (request?.Targets != null && request.Targets.Count > 0)
        {
            foreach (var t in request.Targets)
            {
                var resolved = await ResolveUsersForTargetAsync(t, cancellationToken);
                foreach (var id in resolved)
                {
                    usersToNotifySet.Add(id);
                }
            }
        }

        return Ok(new
        {
            success = true,
            uniqueRecipientCount = usersToNotifySet.Count
        });
    }

    [HttpGet("target-options")]
    [AuthorizePage("bildirimler", "bildirimler")]
    public async Task<IActionResult> GetTargetOptions(CancellationToken cancellationToken)
    {
        var users = await _dbContext.Users
            .AsNoTracking()
            .Where(u => u.IsActive)
            .Select(u => new
            {
                u.Id,
                u.Unvan,
                u.Username,
                u.RoleId,
                RoleName = u.Role != null ? (u.Role.DisplayName ?? u.Role.Name) : "",
                u.Carikodu,
                u.IsActive
            })
            .ToListAsync(cancellationToken);

        var roles = await _dbContext.Roles
            .AsNoTracking()
            .Where(r => r.IsActive)
            .Select(r => new
            {
                r.Id,
                r.Code,
                r.Name,
                DisplayName = r.DisplayName ?? r.Name,
                r.IsActive,
                UserCount = _dbContext.Users.Count(u => u.IsActive && u.RoleId == r.Id)
            })
            .ToListAsync(cancellationToken);

        var priceGroups = await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(pg => pg.IsActive)
            .Select(pg => new
            {
                pg.Id,
                pg.Code,
                pg.Name,
                pg.IsActive,
                UserCount = _dbContext.Users
                    .Where(u => u.IsActive && u.Carikodu != null && u.Carikodu != "")
                    .Join(_dbContext.Customers.Where(c => c.PriceGroupId == pg.Id),
                          u => u.Carikodu,
                          c => c.CustomerCode,
                          (u, c) => u.Id)
                    .Count()
            })
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            data = new
            {
                users,
                roles,
                priceGroups,
                totalActiveUsers = users.Count
            }
        });
    }

    private async Task<List<int>> ResolveUsersForTargetAsync(string targetStr, CancellationToken cancellationToken)
    {
        var usersToNotify = new List<int>();
        if (string.IsNullOrWhiteSpace(targetStr)) return usersToNotify;

        var parts = targetStr.Split(':', 2);
        var type = parts[0].ToLower().Trim();
        var value = parts.Length > 1 ? parts[1].Trim() : string.Empty;

        if (type == "all")
        {
            usersToNotify = await _dbContext.Users
                .AsNoTracking()
                .Where(u => u.IsActive)
                .Select(u => u.Id)
                .ToListAsync(cancellationToken);
        }
        else if (type == "user" && int.TryParse(value, out var userId))
        {
            var userExists = await _dbContext.Users.AsNoTracking().AnyAsync(u => u.Id == userId, cancellationToken);
            if (userExists)
            {
                usersToNotify.Add(userId);
            }
        }
        else if (type == "role" && !string.IsNullOrEmpty(value))
        {
            if (int.TryParse(value, out var roleId))
            {
                usersToNotify = await _dbContext.Users
                    .AsNoTracking()
                    .Where(u => u.IsActive && u.RoleId == roleId)
                    .Select(u => u.Id)
                    .ToListAsync(cancellationToken);

                if (usersToNotify.Count == 0)
                {
                    var role = await _dbContext.Roles.AsNoTracking().FirstOrDefaultAsync(r => r.Id == roleId, cancellationToken);
                    if (role != null)
                    {
                        usersToNotify = await _dbContext.Users
                            .AsNoTracking()
                            .Where(u => u.IsActive && 
                                       (EF.Functions.ILike(u.Role.Code, role.Code) || 
                                        EF.Functions.ILike(u.Role.Name, role.Name) ||
                                        EF.Functions.ILike(u.Role.DisplayName, role.DisplayName)))
                            .Select(u => u.Id)
                            .ToListAsync(cancellationToken);
                    }
                }
            }
            else
            {
                usersToNotify = await _dbContext.Users
                    .AsNoTracking()
                    .Where(u => u.IsActive && 
                               (EF.Functions.ILike(u.Role.Code, value) || 
                                EF.Functions.ILike(u.Role.Name, value) ||
                                EF.Functions.ILike(u.Role.DisplayName, value)))
                    .Select(u => u.Id)
                    .ToListAsync(cancellationToken);
            }
        }
        else if (type == "pricegroup" && Guid.TryParse(value, out var pgId))
        {
            usersToNotify = await _dbContext.Users
                .AsNoTracking()
                .Where(u => u.IsActive && u.Carikodu != null && u.Carikodu != "")
                .Join(_dbContext.Customers.Where(c => c.PriceGroupId == pgId),
                      u => u.Carikodu,
                      c => c.CustomerCode,
                      (u, c) => u.Id)
                .ToListAsync(cancellationToken);
        }
        else if (type == "salesman" && !string.IsNullOrEmpty(value))
        {
            usersToNotify = await _dbContext.Users
                .AsNoTracking()
                .Where(u => u.IsActive && u.Carikodu != null && u.Carikodu != "")
                .Join(_dbContext.Customers.Where(c => c.SalesmanCode == value),
                      u => u.Carikodu,
                      c => c.CustomerCode,
                      (u, c) => u.Id)
                .ToListAsync(cancellationToken);
        }

        return usersToNotify;
    }

    [HttpPost]
    [AuthorizePage("bildirimler", "bildirimler")]
    public async Task<IActionResult> SendNotification([FromBody] CreateNotificationRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || string.IsNullOrWhiteSpace(request.Content))
        {
            return BadRequest(new { success = false, message = "Başlık ve içerik alanları boş olamaz." });
        }

        var senderUsername = User.FindFirst(ClaimTypes.Name)?.Value ?? "System";
        var senderUser = await _dbContext.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Username == senderUsername, cancellationToken);
        var senderDisplayName = senderUser?.Unvan ?? senderUsername;

        var usersToNotifySet = new HashSet<int>();

        if (request.Targets != null && request.Targets.Count > 0)
        {
            foreach (var t in request.Targets)
            {
                var resolved = await ResolveUsersForTargetAsync(t, cancellationToken);
                foreach (var id in resolved)
                {
                    usersToNotifySet.Add(id);
                }
            }
        }
        else if (!string.IsNullOrWhiteSpace(request.Target))
        {
            var resolved = await ResolveUsersForTargetAsync(request.Target, cancellationToken);
            foreach (var id in resolved)
            {
                usersToNotifySet.Add(id);
            }
        }
        else if (request.TargetUserId.HasValue && request.TargetUserId.Value > 0)
        {
            var userExists = await _dbContext.Users.AsNoTracking().AnyAsync(u => u.Id == request.TargetUserId.Value, cancellationToken);
            if (!userExists)
            {
                return BadRequest(new { success = false, message = "Seçilen hedef kullanıcı sistemde bulunamadı." });
            }
            usersToNotifySet.Add(request.TargetUserId.Value);
        }
        else
        {
            var allUsers = await _dbContext.Users
                .AsNoTracking()
                .Where(u => u.IsActive)
                .Select(u => u.Id)
                .ToListAsync(cancellationToken);
            foreach (var id in allUsers)
            {
                usersToNotifySet.Add(id);
            }
        }

        if (usersToNotifySet.Count == 0)
        {
            return BadRequest(new { success = false, message = "Bildirim gönderilecek aktif kullanıcı bulunamadı." });
        }

        var notifications = usersToNotifySet.Select(userId => new Notification
        {
            UserId = userId,
            Title = request.Title.Trim(),
            Content = request.Content.Trim(),
            IsRead = false,
            IsPopup = request.IsPopup,
            SenderName = senderDisplayName,
            CreateUser = senderUsername,
            CreateTime = DateTime.UtcNow
        }).ToList();

        _dbContext.Notifications.AddRange(notifications);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // Aynı bildirim serviste de görünsün — teknisyen sahadayken bayi panelini açmıyor.
        // Kullanıcı adları burada çözülüyor: köprü int kimliği değil kullanıcı adını taşır.
        var usernames = await _dbContext.Users
            .AsNoTracking()
            .Where(u => usersToNotifySet.Contains(u.Id))
            .Select(u => u.Username)
            .ToListAsync(cancellationToken);

        await _serviceOpsBridge.MirrorAsync(usernames, request.Title.Trim(), request.Content.Trim(), cancellationToken);

        return Ok(new { success = true, message = $"{notifications.Count} kullanıcıya bildirim gönderildi." });
    }

    [HttpPost("{id:int}/read")]
    public async Task<IActionResult> MarkAsRead(int id, CancellationToken cancellationToken)
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdClaim) || !int.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized();
        }

        var notification = await _dbContext.Notifications
            .FirstOrDefaultAsync(n => n.Id == id && n.UserId == userId, cancellationToken);

        if (notification == null)
        {
            return NotFound(new { success = false, message = "Bildirim bulunamadı." });
        }

        if (!notification.IsRead)
        {
            notification.IsRead = true;
            notification.ReadTime = DateTime.UtcNow;
            notification.EditUser = User.FindFirst(ClaimTypes.Name)?.Value;
            notification.EditTime = DateTime.UtcNow;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return Ok(new { success = true });
    }

    [HttpPost("mark-all-read")]
    public async Task<IActionResult> MarkAllAsRead(CancellationToken cancellationToken)
    {
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(userIdClaim) || !int.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized();
        }

        var unread = await _dbContext.Notifications
            .Where(n => n.UserId == userId && !n.IsRead)
            .ToListAsync(cancellationToken);

        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        var now = DateTime.UtcNow;

        foreach (var notification in unread)
        {
            notification.IsRead = true;
            notification.ReadTime = now;
            notification.EditUser = username;
            notification.EditTime = now;
        }

        if (unread.Count > 0)
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return Ok(new { success = true, count = unread.Count });
    }

    [HttpDelete("{id:int}")]
    [AuthorizePage("bildirimler", "bildirimler")]
    public async Task<IActionResult> DeleteNotification(int id, CancellationToken cancellationToken)
    {
        // SAHİPLİK KONTROLÜ.
        //
        // Buradaki `[AuthorizePage("bildirimler","bildirimler")]` yetki kapısı DEĞİL:
        // bildirim kutusu tasarım gereği HER role açık (bkz. PagesController tohumu,
        // "Bildirim ALMA: her role açık"). Dolayısıyla kimlik doğrulaması olan herkes,
        // id'yi değiştirerek BAŞKASININ bildirimini silebiliyordu.
        // Kardeş uç "okundu işaretle" bunu zaten `n.UserId == userId` ile sınırlıyor.
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrWhiteSpace(userIdClaim) || !int.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized(new { success = false, message = "Kullanıcı doğrulanamadı." });
        }

        var notification = await _dbContext.Notifications
            .FirstOrDefaultAsync(n => n.Id == id && n.UserId == userId, cancellationToken);

        if (notification == null)
        {
            return NotFound(new { success = false, message = "Bildirim bulunamadı." });
        }

        _dbContext.Notifications.Remove(notification);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, message = "Bildirim silindi." });
    }
}
