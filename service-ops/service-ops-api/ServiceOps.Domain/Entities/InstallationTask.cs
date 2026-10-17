using System;

namespace ServiceOps.Domain.Entities;

public class InstallationTask
{
    public Guid Id { get; set; } = Guid.NewGuid();

    // Relations
    public Guid ServiceId { get; set; }
    public ServiceRecord Service { get; set; } = null!;

    /// <summary>Görevin ait olduğu kalem. Eski kayıtlarda boş olabilir.</summary>
    public Guid? ServiceRecordItemId { get; set; }
    public ServiceRecordItem? Item { get; set; }

    public Guid? AssignedTechnicianId { get; set; }
    public Technician? AssignedTechnician { get; set; }

    // Planning / Status
    public DateTime? PlannedAt { get; set; }
    public InstallationTaskStatus Status { get; set; } = InstallationTaskStatus.Planned;

    // Extra fields for optimization and SLA
    public int Quantity { get; set; } = 1;
    public int? EstimatedDurationMinutes { get; set; }
    public string? Notes { get; set; }
    public string? CustomAddress { get; set; }
    public int Priority { get; set; } = 0;

    /// <summary>
    /// Satır sahaya aktarıldıysa aktarım anı; aktarılmadıysa boş.
    ///
    /// Eskiden "sahaya aktarıldı" bilgisi satırda DEĞİL, kayıtta tutuluyordu: kısmen aktarılan
    /// bir kayıt MNT-xxxxxxx-N diye ikiye bölünüyor, aktarılan satırlar yeni kayda taşınıyordu.
    /// Bölme kaldırıldı (kullanıcı kararı, 2026-08-10) — bir fatura tek kayıt kalır, satırlar
    /// birbirinden bağımsız ilerler. Bunun tek koşulu aktarımın satırda işaretlenmesi.
    ///
    /// <see cref="StartedAt"/> ile karıştırma: o, teknisyenin işe fiilen başladığı an.
    /// </summary>
    public DateTime? TransferredAt { get; set; }

    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? PhotoUrl { get; set; }
    public string? SerialNumber { get; set; }

    // Audit
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public enum InstallationTaskStatus
{
    Planned = 0,
    InProgress = 1,
    Completed = 2,
    Cancelled = 3,
    Deferred = 4,

    /// <summary>
    /// Teknisyen gitti ama iş yapılamadı: müşteriye ulaşılamadı, adres yanlış, kapı açılmadı,
    /// müşteri randevuyu erteledi.
    ///
    /// Bu durum eskiden YOKTU ve karşılığı olmadığı için saha iki kötü seçenekten birine
    /// zorlanıyordu: ya İptal (iş gerçekten iptal olmadığı hâlde fatura kaleminin ölmesi) ya da
    /// "Ertelendi"/Deferred — o da teknisyeni, tarihi ve aktarım damgasını silip satırı sessizce
    /// planlamaya düşürüyor, "neden" yalnızca not alanında kalıyordu.
    ///
    /// <summary>
    /// Ulaşılamadı CANLI bir satırdır: teknisyende ve sahada kalır, tamamlanmış sayılmaz,
    /// hak ediş doğurmaz. Planlamacı ya yeni bir güne çeker ya iptal eder.
    /// </summary>
    Unreachable = 5,

    /// <summary>
    /// Ürün teslim edildi ama henüz montaj yapılmadı (planlama bekliyor).
    /// </summary>
    Delivered = 6,

    /// <summary>
    /// Ürün teslim edildi / montaj ertelendi (planlama bekliyor).
    /// </summary>
    Postponed = 7
}

/// <summary>
/// Durum kümelerinin TEK kaynağı — aynı liste birden çok sorguda elle yazılınca ayrışıyordu.
/// </summary>
public static class InstallationTaskStatusSets
{
    /// <summary>
    /// "Planlamada bekliyor" sayılan durumlar: satır Teslimattakiler'de değil, planlama
    /// listesindedir. İstemcideki karşılığı <c>montajPlanRows.UNPLANNED_STATES</c>.
    ///
    /// <para><b>NEDEN GÜN SORGULARINDA SÜZGEÇ:</b> 2026-09-09'dan beri satır planlamaya geri
    /// düşerken atanan teknisyeni ve son planlanan gününü KORUYOR (kullanıcı kuralı: "teknisyen
    /// ve tarih silinmesin"). O alanlar artık bir GÖSTERİM İZİ — "bu iş en son kime, hangi güne
    /// verilmişti" sorusunun cevabı — canlı bir plan değil. Gün bazlı yük/kapasite ve gün
    /// süzgeci sorguları bunları saymamalı, yoksa geri çekilmiş bir satır teknisyenin o günkü
    /// kapasitesini yemeye ve kayıt "bugün planlananlar" listesinde durmaya devam eder.</para>
    /// </summary>
    public static readonly InstallationTaskStatus[] Unplanned =
    {
        InstallationTaskStatus.Deferred,
        InstallationTaskStatus.Delivered,
        InstallationTaskStatus.Postponed,
        InstallationTaskStatus.Unreachable
    };
}
