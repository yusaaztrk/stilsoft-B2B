using System;
using System.ComponentModel.DataAnnotations;

namespace ServiceOps.Domain.Entities;

public class CargoTrackingTask
{
    public Guid Id { get; set; } = Guid.NewGuid();

    [Required]
    [MaxLength(100)]
    public string OrderNumber { get; set; } = null!;

    public string? ProductDetails { get; set; }

    [MaxLength(200)]
    public string? CustomerName { get; set; }

    /// <summary>
    /// Müşterinin telefonu — kuryenin adrese yaklaşınca arayacağı numara.
    ///
    /// <para>Eskiden bu alan YOKTU: kargo listesinde yalnız ad ve adres vardı, kurye
    /// müşteriye ulaşmak için siparişi ayrıca e-ticaret panelinden aratmak zorundaydı
    /// (2026-09-10 kullanıcı isteği: "adamın telefon numarası da gelmesi lazımdı").</para>
    ///
    /// <para>Kaynak e-ticaret siparişi; ödeme onaylandığında kayıtla birlikte geliyor.
    /// Elle açılan kargo kayıtlarında boş kalabilir — o yüzden zorunlu değil.</para>
    /// </summary>
    [MaxLength(40)]
    public string? CustomerPhone { get; set; }

    public string? DeliveryAddress { get; set; }

    public DateTime OrderDate { get; set; }

    // Technician assignment
    public Guid? AssignedTechnicianId { get; set; }
    public Technician? AssignedTechnician { get; set; }

    public CargoTrackingStatus Status { get; set; } = CargoTrackingStatus.Received;

    public DateTime? PlannedDate { get; set; }
    public string? HistoryJson { get; set; }

    [MaxLength(200)]
    public string? ReceiverName { get; set; }

    [MaxLength(500)]
    public string? DeliveryProofPhotoUrl { get; set; }

    public double? Latitude { get; set; }
    public double? Longitude { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public enum CargoTrackingStatus
{
    Received = 0,
    Planned = 1,
    Preparing = 2,
    OutForDelivery = 3,
    Delivered = 4
}
