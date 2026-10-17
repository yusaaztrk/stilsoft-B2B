namespace B2B.Erp.Api.Entities;

public enum InvoiceTrackingStatus
{
    /// <summary>Planlanmamış — ya hiç atanmadı ya da teslim edilemeyip listeye döndü.</summary>
    Unplanned = 0,
    Planned = 1,
    Completed = 2
}

/// <summary>Faturanın imzalatılıp geri getirilmesinin şu anki durumu. Fatura başına tek satır.</summary>
public sealed class InvoiceTracking
{
    public int Id { get; set; }
    public int InvoiceId { get; set; }
    public string InvoiceNo { get; set; } = string.Empty;
    public InvoiceTrackingStatus Status { get; set; }

    /// <summary>ServiceOps teknisyen kimliği — teknisyenin kendi ekranı buna göre süzülüyor.</summary>
    public Guid? TechnicianId { get; set; }

    /// <summary>Atama anındaki ad; teknisyen sonradan silinse de kimin götürdüğü kalsın diye.</summary>
    public string? TechnicianName { get; set; }

    /// <summary>Servise bildirim bu kullanıcı adıyla gönderiliyor.</summary>
    public string? TechnicianUsername { get; set; }

    public DateTime? PlannedDate { get; set; }
    public DateTime? CompletedAt { get; set; }
    public string? CompletedBy { get; set; }

    /// <summary>Son teslim edilemediği rota günü — planlama listesinde rozet olarak görünür.</summary>
    public DateTime? LastFailedDate { get; set; }

    public string CreateUser { get; set; } = string.Empty;
    public DateTime CreateTime { get; set; }
    public string? EditUser { get; set; }
    public DateTime? EditTime { get; set; }
}

public static class InvoiceTrackingEventTypes
{
    public const string Planned = "PLANLANDI";
    public const string Replanned = "YENIDEN_PLANLANDI";
    public const string Unplanned = "PLAN_KALDIRILDI";
    public const string Delivered = "TESLIM_EDILDI";
    public const string Failed = "TESLIM_EDILEMEDI";
    public const string Reopened = "DURUM_GERI_ALINDI";
    public const string Note = "NOT";
}

public static class InvoiceTrackingSources
{
    public const string B2B = "B2B";
    public const string Field = "SERVIS";
}

public sealed class InvoiceTrackingEvent
{
    public long Id { get; set; }
    public int InvoiceId { get; set; }
    public string InvoiceNo { get; set; } = string.Empty;
    public string EventType { get; set; } = string.Empty;

    /// <summary>
    /// Olayın ait olduğu rota günü. Teslim edildi / edilemedi olaylarında o günün planı:
    /// fatura sonradan başka güne alınsa bile eski günün basımı bu alandan kurulur.
    /// </summary>
    public DateTime? RouteDate { get; set; }

    public DateTime? NewPlannedDate { get; set; }
    public Guid? TechnicianId { get; set; }
    public string? TechnicianName { get; set; }
    public string? Note { get; set; }
    public string Source { get; set; } = InvoiceTrackingSources.B2B;
    public string Actor { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

public sealed class InvoiceTrackingPhoto
{
    public long Id { get; set; }
    public int InvoiceId { get; set; }
    public long? EventId { get; set; }
    public string FileName { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public string Source { get; set; } = InvoiceTrackingSources.Field;
    public string UploadedBy { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}
