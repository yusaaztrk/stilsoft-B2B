using System;

namespace ServiceOps.Domain.Entities;

/// <summary>
/// Bir teknisyenin telefonundaki uygulamanın bildirim adresi (FCM kayıt anahtarı).
///
/// Bildirim şimdiye kadar yalnızca SignalR ile gidiyordu: uygulama AÇIKKEN duyulan bir kanal.
/// Teknisyen telefonu cebine koyup uygulamadan çıktığında atanan iş sessizce bekliyordu. Push
/// için işletim sisteminin cihaza verdiği anahtarın sunucuda durması gerekiyor; tablo bunun için.
///
/// Bir kişinin birden fazla cihazı olabilir (telefon + tablet), bir cihaz da el değiştirebilir.
/// Bu yüzden benzersiz olan <see cref="Token"/>; kime ait olduğu ise değişebilen bir alan.
/// </summary>
public class DeviceToken
{
    public Guid Id { get; set; }

    /// <summary>Cihazın sahibi. Kişi değişirse aynı satır güncellenir, yenisi açılmaz.</summary>
    public Guid TechnicianId { get; set; }

    /// <summary>FCM kayıt anahtarı. Tablodaki benzersiz alan.</summary>
    public string Token { get; set; } = string.Empty;

    /// <summary>"android" | "ios". Gönderim yükü platforma göre farklılaşıyor.</summary>
    public string Platform { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; }

    /// <summary>
    /// Cihazın en son ne zaman kendini bildirdiği.
    ///
    /// FCM anahtarları uygulama silinince ya da uzun süre kullanılmayınca ölür ve gönderim
    /// `UNREGISTERED` döner. Ölü anahtar silinir; bu alan silinmeyenler arasında hangisinin
    /// gerçekten canlı olduğunu görmek için duruyor.
    /// </summary>
    public DateTime LastSeenAt { get; set; }
}
