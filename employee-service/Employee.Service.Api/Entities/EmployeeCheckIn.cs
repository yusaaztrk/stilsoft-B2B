namespace B2B.Erp.Api.Entities;

public sealed class EmployeeCheckIn : AuditableEntity
{
    public int Id { get; set; }

    public int EmployeeId { get; set; }

    public Employee? Employee { get; set; }

    public DateTime CheckInTime { get; set; }

    public DateTime? CheckOutTime { get; set; }

    public decimal Latitude { get; set; }

    public decimal Longitude { get; set; }

    public decimal? CheckOutLatitude { get; set; }

    public decimal? CheckOutLongitude { get; set; }

    public string? City { get; set; }

    public string? District { get; set; }

    /// <summary>Çıkış konumunun ili — kayıt anında sunucuda çözülür (2026-10-16).</summary>
    public string? CheckOutCity { get; set; }

    /// <summary>Çıkış konumunun ilçesi.</summary>
    public string? CheckOutDistrict { get; set; }

    /// <summary>Çıkış bölge dışından, konumun "konum dışı çıkış" izniyle yapıldı (2026-10-16).</summary>
    public bool CheckOutOffsite { get; set; }

    /// <summary>Çıkışı personel basmadı; gece otomatik kapatıldı (bkz. AutoCheckOutWorker, 2026-10-16).</summary>
    public bool CheckOutAuto { get; set; }

    /// <summary>Telefonun bildirdiği konum hassasiyeti (m) — sahte konum tespitinde kullanılır.</summary>
    public double? CheckInAccuracy { get; set; }
    public double? CheckOutAccuracy { get; set; }
}
