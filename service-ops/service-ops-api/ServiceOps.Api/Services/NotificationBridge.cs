using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Services;

/// <summary>
/// Serviste üretilen bildirimi bayi (B2B) tarafına da yazan köprü.
///
/// İki programın kullanıcı kimliği farklı: burada teknisyen bir Guid, orada kullanıcı bir int.
/// Ortak nokta KULLANICI ADI — <c>Technician.UserId</c> zaten B2B kullanıcı adını tutuyor.
/// Köprü bu yüzden id değil kullanıcı adı taşır; iki tarafta da id eşlemesi tutmaya çalışmak,
/// teknisyen silinip yeniden açıldığında sessizce yanlış kişiye bildirim göndermek olurdu.
///
/// Ağ hatası bildirimi düşürür ama İŞİ DÜŞÜRMEZ: atama zaten kaydedilmiş oluyor.
/// </summary>
public interface INotificationBridge
{
    Task MirrorToB2BAsync(Guid technicianId, string title, string message, CancellationToken cancellationToken = default);
}

public sealed class NotificationBridge : INotificationBridge
{
    private readonly ApplicationDbContext _context;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<NotificationBridge> _logger;

    public NotificationBridge(
        ApplicationDbContext context,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILogger<NotificationBridge> logger)
    {
        _context = context;
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task MirrorToB2BAsync(Guid technicianId, string title, string message, CancellationToken cancellationToken = default)
    {
        try
        {
            var technician = await _context.Technicians
                .AsNoTracking()
                .Where(t => t.Id == technicianId)
                .Select(t => new { t.UserId, t.TenantCode, t.FirstName, t.LastName })
                .FirstOrDefaultAsync(cancellationToken);

            // Teknisyenin B2B karşılığı yoksa köprülenecek bir şey yok — sessizce geçilir,
            // servis tarafındaki bildirim zaten yazıldı.
            if (technician is null || string.IsNullOrWhiteSpace(technician.UserId))
            {
                return;
            }

            var internalKey = _configuration["ServiceOps:InternalApiKey"];
            if (string.IsNullOrWhiteSpace(internalKey))
            {
                _logger.LogWarning("Bildirim köprüsü: ServiceOps:InternalApiKey tanımlı değil, B2B'ye yazılmadı.");
                return;
            }

            var client = _httpClientFactory.CreateClient("ErpApi");

            using var request = new HttpRequestMessage(HttpMethod.Post, "api/notifications/internal")
            {
                Content = JsonContent.Create(new
                {
                    username = technician.UserId,
                    title,
                    content = message,
                    senderName = "Servis"
                })
            };

            request.Headers.Add("X-Internal-Key", internalKey);

            if (!string.IsNullOrWhiteSpace(technician.TenantCode))
            {
                request.Headers.Add("X-Tenant-Code", technician.TenantCode);
            }

            var response = await client.SendAsync(request, cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogWarning("Bildirim köprüsü B2B'ye yazamadı ({Status}): {Body}", (int)response.StatusCode, body);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Bildirim köprüsü hatası — servis tarafındaki bildirim etkilenmedi.");
        }
    }
}
