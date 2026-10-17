using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ServiceOps.Api.Hubs;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Services;

/// <summary>
/// Bir işin kime atandığını o kişiye duyuran tek kapı.
///
/// İş ataması dört ayrı yerden yapılıyor (montaj dağıtımı, planlama satırı düzenleme, kargo
/// görevi, servis kaydı teknisyen ataması). Bildirimi her birinin kendi içinde üretmek,
/// "biri eklenince öbürü unutulur" demekti; hepsi buradan geçiyor.
/// </summary>
public interface IJobAssignmentNotifier
{
    /// <summary>
    /// Atamaları KİŞİ BAŞINA TEK bildirime toplayıp yazar ve canlı iletir.
    /// Aynı çağrıda aynı kişiye 17 satır atanmışsa 17 bildirim değil 1 bildirim çıkar.
    /// </summary>
    Task NotifyAsync(IEnumerable<JobAssignment> assignments, CancellationToken cancellationToken = default);

    /// <summary>
    /// Atama dışındaki tekil bildirimler (planlama saati değişikliği gibi) için aynı kapı.
    ///
    /// Ayrı bir yol açılmadı bilerek: canlı iletim, bayi tarafına köprüleme ve sesli okuma
    /// metni burada tek yerde kuruluyor; ikinci bir yazma yolu bunların birinde geri kalırdı.
    /// </summary>
    /// <param name="mirrorToB2B">
    /// Bildirim bayi tarafına da yazılsın mı. Bildirim ZATEN B2B'den geliyorsa false verilir:
    /// aksi halde B2B → servis → B2B → servis diye sonsuz bir yankı başlar.
    /// </param>
    Task NotifyTechnicianAsync(
        Guid technicianId,
        string title,
        string message,
        string jobType,
        Guid? jobId,
        bool mirrorToB2B = true,
        CancellationToken cancellationToken = default);
}

/// <summary>Tek bir atama olayı: kime, hangi iş, ne hakkında.</summary>
public sealed record JobAssignment(
    Guid TechnicianId,
    JobKind Kind,
    Guid? JobId,
    string Subject,
    int Quantity = 1,
    DateTime? PlannedAt = null);

public enum JobKind
{
    Installation,
    Service,
    Cargo,
}

public sealed class JobAssignmentNotifier : IJobAssignmentNotifier
{
    private readonly ApplicationDbContext _context;
    private readonly IHubContext<ServiceOpsHub> _hub;
    private readonly INotificationBridge _bridge;
    private readonly IPushSender _push;
    private readonly ILogger<JobAssignmentNotifier> _logger;

    /// <summary>Saha saati (KKTC/Türkiye = UTC+3). Bildirim metnindeki tarih yerel gösterilir.</summary>
    private const int LocalOffsetHours = 3;

    public JobAssignmentNotifier(
        ApplicationDbContext context,
        IHubContext<ServiceOpsHub> hub,
        INotificationBridge bridge,
        IPushSender push,
        ILogger<JobAssignmentNotifier> logger)
    {
        _context = context;
        _hub = hub;
        _bridge = bridge;
        _push = push;
        _logger = logger;
    }

    public async Task NotifyTechnicianAsync(
        Guid technicianId,
        string title,
        string message,
        string jobType,
        Guid? jobId,
        bool mirrorToB2B = true,
        CancellationToken cancellationToken = default)
    {
        if (technicianId == Guid.Empty) return;

        try
        {
            var notification = new Notification
            {
                Id = Guid.NewGuid(),
                TechnicianId = technicianId,
                Title = title,
                Message = message,
                IsRead = false,
                CreatedAt = DateTime.UtcNow,
                JobType = jobType,
                JobId = jobId,
            };

            _context.Notifications.Add(notification);
            await _context.SaveChangesAsync(cancellationToken);

            await PushAsync(notification, mirrorToB2B, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Bildirim gönderilemedi — asıl işlem etkilenmedi.");
        }
    }

    /// <summary>Canlı iletim + bayi tarafına köprüleme. İki tarafın da tek çıkış noktası.</summary>
    private async Task PushAsync(Notification n, bool mirrorToB2B, CancellationToken cancellationToken)
    {
        // Yalnızca İLGİLİ teknisyenin grubuna gider. `Clients.All` kullanılsaydı herkesin
        // telefonu başkasının işini sesli okurdu.
        await _hub.Clients.Group(ServiceOpsHub.TechnicianGroup(n.TechnicianId)).SendAsync(
            "notification_created",
            new
            {
                id = n.Id,
                technicianId = n.TechnicianId,
                title = n.Title,
                message = n.Message,
                jobType = n.JobType,
                jobId = n.JobId,
                createdAt = n.CreatedAt,
                // Mobilde sesli okunacak metin. Başlık + mesajı istemcide birleştirmek
                // yerine sunucudan tek parça geliyor ki ses metni her istemcide aynı olsun.
                speech = $"{n.Title}. {n.Message}",
            },
            cancellationToken);

        // Telefonun kendisi. SignalR yalnızca uygulama açıkken duyuluyor; teknisyen ekranı
        // kapattığında iş ataması sessizce bekliyordu. Push kanalı bunun ÜSTÜNE geliyor, yerine
        // değil: uygulama açıksa kullanıcı iki kanaldan da aynı bildirimi alır, mobil taraf
        // kimliğe bakıp aynı bildirimi iki kez okumaz.
        //
        // Hata yutuluyor: gönderim ağ ucundaki üçüncü bir servise bağlı ve buradaki bir istisna
        // veritabanına ZATEN yazılmış bildirimi geri almaz, yalnızca atama isteğini düşürürdü.
        try
        {
            await _push.SendToTechnicianAsync(
                n.TechnicianId,
                n.Title,
                n.Message,
                new Dictionary<string, string>
                {
                    ["notificationId"] = n.Id.ToString(),
                    ["jobType"] = n.JobType ?? string.Empty,
                    ["jobId"] = n.JobId?.ToString() ?? string.Empty
                },
                cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Telefon bildirimi gönderilemedi — bildirim yine de kaydedildi.");
        }

        // Aynı bildirim bayi panelinde de görünsün: teknisyen iki programı da kullanıyor.
        // Bildirim zaten B2B'den geldiyse geri yazılmaz — yankı orada kırılıyor.
        if (mirrorToB2B)
        {
            await _bridge.MirrorToB2BAsync(n.TechnicianId, n.Title, n.Message, cancellationToken);
        }
    }

    public async Task NotifyAsync(IEnumerable<JobAssignment> assignments, CancellationToken cancellationToken = default)
    {
        var list = assignments?.Where(a => a.TechnicianId != Guid.Empty).ToList() ?? new List<JobAssignment>();
        if (list.Count == 0) return;

        // BİLDİRİM ASLA ASIL İŞİ DÜŞÜRMEZ.
        //
        // Atama zaten kaydedilmiş oluyor; burada çıkan bir hata yüzünden isteğin 500 dönmesi,
        // kullanıcının atamayı tekrar yapmasına ve işin ikiye katlanmasına yol açardı.
        try
        {
            var created = new List<Notification>();

            foreach (var group in list.GroupBy(a => new { a.TechnicianId, a.Kind }))
            {
                var items = group.ToList();
                var totalQty = items.Sum(x => Math.Max(1, x.Quantity));
                var kindLabel = KindLabel(group.Key.Kind);

                var title = items.Count == 1
                    ? $"Yeni {kindLabel} işi"
                    : $"{items.Count} yeni {kindLabel} işi";

                var message = BuildMessage(kindLabel, items, totalQty);

                var notification = new Notification
                {
                    Id = Guid.NewGuid(),
                    TechnicianId = group.Key.TechnicianId,
                    Title = title,
                    Message = message,
                    IsRead = false,
                    CreatedAt = DateTime.UtcNow,
                    JobType = JobTypeCode(group.Key.Kind),
                    // Tek işlik atamada kayda gidebilmek için iş kimliği taşınır; toplu atamada
                    // tek bir kimlik yanıltıcı olacağı için boş bırakılır (liste ekranı açılır).
                    JobId = items.Count == 1 ? items[0].JobId : null,
                };

                created.Add(notification);
            }

            _context.Notifications.AddRange(created);
            await _context.SaveChangesAsync(cancellationToken);

            foreach (var n in created)
            {
                await PushAsync(n, mirrorToB2B: true, cancellationToken);
            }

            _logger.LogInformation("Atama bildirimi: {Count} kişiye gönderildi.", created.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Atama bildirimi gönderilemedi — atama işlemi etkilenmedi.");
        }
    }

    private static string KindLabel(JobKind kind) => kind switch
    {
        JobKind.Installation => "montaj",
        JobKind.Cargo => "kargo",
        _ => "servis",
    };

    private static string JobTypeCode(JobKind kind) => kind switch
    {
        JobKind.Installation => "InstallationTask",
        JobKind.Cargo => "CargoTrackingTask",
        _ => "ServiceRecord",
    };

    private string BuildMessage(string kindLabel, List<JobAssignment> items, int totalQty)
    {
        var when = items
            .Select(x => x.PlannedAt)
            .Where(x => x.HasValue)
            .OrderBy(x => x!.Value)
            .FirstOrDefault();

        var whenText = when.HasValue
            ? $" Planlanan tarih: {when.Value.AddHours(LocalOffsetHours):dd.MM.yyyy}."
            : string.Empty;

        if (items.Count == 1)
        {
            var qtyText = totalQty > 1 ? $"{totalQty} adet " : string.Empty;
            return $"Size {qtyText}{kindLabel} işi atandı: {items[0].Subject}.{whenText}";
        }

        // Konu satırları uzun olabiliyor; sesli okumada dinlenebilir kalsın diye ilk üçü sayılır.
        var subjects = items.Select(x => x.Subject).Where(s => !string.IsNullOrWhiteSpace(s)).Distinct().ToList();
        var preview = string.Join(", ", subjects.Take(3));
        if (subjects.Count > 3) preview += $" ve {subjects.Count - 3} kayıt daha";

        return $"Size toplam {totalQty} adet {kindLabel} işi atandı: {preview}.{whenText}";
    }
}
