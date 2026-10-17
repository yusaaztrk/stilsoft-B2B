using System;

namespace ServiceOps.Domain.Entities;

public class TechnicianEarning
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string? TenantCode { get; set; }
    public Guid TechnicianId { get; set; }
    public Technician Technician { get; set; } = null!;
    public string TechnicianName { get; set; } = string.Empty;
    public string? TechnicianCariCode { get; set; }
    public EarningSourceType SourceType { get; set; }
    public Guid SourceId { get; set; }
    public string? SourceNumber { get; set; }
    public string? CustomerName { get; set; }
    public string? ProductName { get; set; }
    public DateTime CompletedAt { get; set; }
    /// <summary>Hak edilen tutar, KENDİ para biriminde. Hiçbir zaman TL'ye çevrilip ezilmez.</summary>
    public decimal Amount { get; set; }
    public string Currency { get; set; } = "TRY";

    /// <summary>TL karşılığı gerektiğinde kullanılan kur; bilgi amaçlı, Amount'u değiştirmez.</summary>
    public decimal? ExchangeRate { get; set; }
    public decimal? LocalAmount { get; set; }
    public DateTime? ExchangeRateDate { get; set; }
    public EarningStatus Status { get; set; } = EarningStatus.Pending;
    public string? PostedLedgerReference { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string? CreatedBy { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public string? ApprovedBy { get; set; }
    public DateTime? PostedAt { get; set; }
    public string? PostedBy { get; set; }
}

public enum EarningSourceType
{
    ServiceRecord = 0,
    InstallationTask = 1,
    CargoTrackingTask = 2
}

public enum EarningStatus
{
    Pending = 0,
    Approved = 1,
    PostedToLedger = 2,
    Cancelled = 3
}
