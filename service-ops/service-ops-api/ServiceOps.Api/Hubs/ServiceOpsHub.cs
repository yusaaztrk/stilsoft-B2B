using System;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Hubs;

/// <summary>
/// ServiceOps canlı olay hub'ı: kargo, servis kaydı ve montaj değişiklikleri buradan yayılır.
///
/// KİMLİK İSTER. Öncesinde anonimdi ve "bağlanan her istemci bütün olayları alır" diye
/// belgelenmişti; ağdan erişebilen herkes bütün firmaların canlı güncellemelerini
/// dinleyebiliyordu. Token, WebSocket el sıkışmasında `access_token` sorgu parametresiyle
/// geliyor (bkz. Program.cs'teki JwtBearerEvents.OnMessageReceived).
///
/// NOT: veri tazeleme olayları (`*_updated`) hâlâ Clients.All ile yayınlanıyor, yani firma
/// bazında ayrıştırılmış DEĞİL. Yayınlanan gövde yalnızca kimlik ve durum taşıyor, veriyi
/// istemci ayrıca yetkili uçtan çekiyor; yine de firma başına grup kullanmak doğru adım olur.
///
/// KİŞİSEL BİLDİRİM bunun istisnasıdır: "sana iş atandı" mesajı yalnızca o teknisyenin grubuna
/// gider (<see cref="TechnicianGroup"/>), çünkü mobilde sesli okunuyor — Clients.All ile herkesin
/// telefonu başkasının işini okurdu.
/// </summary>
[Authorize]
public class ServiceOpsHub : Hub
{
    private readonly ApplicationDbContext _context;

    public ServiceOpsHub(ApplicationDbContext context)
    {
        _context = context;
    }

    /// <summary>Bir teknisyenin kişisel bildirim grubunun adı. Tek kaynak — üretici de bunu kullanır.</summary>
    public static string TechnicianGroup(Guid technicianId) => $"technician:{technicianId}";

    public override async Task OnConnectedAsync()
    {
        // GRUBA KATILAMAMAK BAĞLANTIYI DÜŞÜRMEZ.
        //
        // Kimlik çözümü firma veritabanına düşebiliyor (claim yoksa kullanıcı kaydından okunuyor)
        // ve o veritabanı el sıkışma anında çözülemeyebilir. Burada fırlayan bir hata, canlı
        // güncelleme alan BÜTÜN ekranların bağlantısını koparırdı — kişisel bildirim uğruna
        // kargo/servis tazelemelerini feda etmek olurdu bu.
        Guid? technicianId = null;
        try
        {
            technicianId = await ResolveTechnicianIdAsync();
            if (technicianId.HasValue)
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, TechnicianGroup(technicianId.Value));
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[SignalR] Teknisyen grubu bağlanamadı ({Context.ConnectionId}): {ex.Message}");
        }

        Console.WriteLine($"[SignalR] Client connected: {Context.ConnectionId} (technician: {technicianId?.ToString() ?? "-"})");
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        // Gruptan çıkarma SignalR tarafından bağlantı kapanınca kendiliğinden yapılır.
        Console.WriteLine($"[SignalR] Client disconnected: {Context.ConnectionId}");
        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>
    /// Oturumun teknisyen kimliği. `technicianId` claim'i varsa o kullanılır; yoksa kullanıcı
    /// kaydından okunur — NotificationsController ile AYNI kural, yoksa bildirimi yazan ile
    /// dinleyen taraf farklı kimliğe bakar ve mesaj hiç ulaşmaz.
    /// </summary>
    private async Task<Guid?> ResolveTechnicianIdAsync()
    {
        var user = Context.User;
        if (user == null) return null;

        var claimValue = user.FindFirstValue("technicianId");
        if (Guid.TryParse(claimValue, out var claimTechId)) return claimTechId;

        var sub = user.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(sub, out var userId)) return null;

        return await _context.ServiceUsers
            .AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => u.TechnicianId)
            .FirstOrDefaultAsync();
    }
}
