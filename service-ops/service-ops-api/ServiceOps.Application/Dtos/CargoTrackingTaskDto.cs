using System;
using ServiceOps.Domain.Entities;

namespace ServiceOps.Application.Dtos;

public class CargoTrackingTaskDto
{
    public Guid Id { get; set; }
    public string OrderNumber { get; set; } = string.Empty;
    public string? ProductDetails { get; set; }
    public string? CustomerName { get; set; }
    /// <summary>Kuryenin arayacağı numara; bkz. CargoTrackingTask.CustomerPhone.</summary>
    public string? CustomerPhone { get; set; }
    public string? DeliveryAddress { get; set; }
    public DateTime OrderDate { get; set; }
    public Guid? AssignedTechnicianId { get; set; }
    public string? AssignedTechnicianName { get; set; }
    public int Status { get; set; }
    public DateTime? PlannedDate { get; set; }
    public string? HistoryJson { get; set; }
    public string? ReceiverName { get; set; }
    public string? DeliveryProofPhotoUrl { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class CreateCargoTrackingTaskDto
{
    public string OrderNumber { get; set; } = string.Empty;
    public string? ProductDetails { get; set; }
    public string? CustomerName { get; set; }
    public string? CustomerPhone { get; set; }
    public string? DeliveryAddress { get; set; }
    public DateTime OrderDate { get; set; }

    /// <summary>
    /// Fatura numarasi (ERP fatura webhook'u doldurur; odeme aninda bos gelir).
    ///
    /// AYRI KOLON ACILMADI: numara paket dokumunun altina yaziliyor, kuryenin ekraninda
    /// gorunmesi yeterli. Kolon acmak ServiceOps'ta bir goc daha demekti ve bu tabloya
    /// dokunan alan uygulamasi da guncellenmek zorunda kalirdi.
    /// </summary>
    public string? InvoiceNo { get; set; }
}

public class AssignCargoDto
{
    public Guid TechnicianId { get; set; }
    public string? TechnicianName { get; set; }
    public DateTime PlannedDate { get; set; }
}

/// <summary>
/// Kargo kaydının düzenlenebilir alanları. Alanlar null bırakılırsa DOKUNULMAZ — form kısmi
/// gönderdiğinde geri kalanı boşaltmamak için.
/// </summary>
public class UpdateCargoDetailsDto
{
    public string? CustomerName { get; set; }
    /// <summary>Elle düzeltilebilir; e-ticaret siparişinden gelen numara yanlışsa kurye düzeltir.</summary>
    public string? CustomerPhone { get; set; }
    public string? DeliveryAddress { get; set; }
    public string? ProductDetails { get; set; }
}

public class UpdateCargoStatusDto
{
    public int Status { get; set; }
    public string? Actor { get; set; }
    public string? Detail { get; set; }
    public string? ReceiverName { get; set; }
    public string? DeliveryProofPhotoUrl { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
}
