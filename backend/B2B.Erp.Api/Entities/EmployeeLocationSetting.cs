using System;

namespace B2B.Erp.Api.Entities;

public sealed class EmployeeLocationSetting : AuditableEntity
{
    public int Id { get; set; }

    /// <summary>Konumun adı — "Mağaza", "Depo" gibi. Personel servisi tarafından yönetilir.</summary>
    public string Name { get; set; } = string.Empty;

    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
    public double MaxDistanceInMeters { get; set; }
    public bool IsActive { get; set; } = true;
}
