using System.Linq.Expressions;
using ServiceOps.Domain.Entities;

namespace ServiceOps.Api.Reports;

/// <summary>
/// Raporlarda "tamamlandı / iptal / devam ediyor / bekliyor" ne demek — TEK yer.
///
/// 16 durumlu bir enum'da bu eşlemeyi her sorguda ayrı yazmak, kartta 143 yazarken listede 138
/// çıkmasının en yaygın sebebi. KPI kartı da drill-down listesi de buradaki aynı ifadeyi kullanır.
/// </summary>
public static class ReportDefinitions
{
    /// <summary>İş bitti: sahada tamamlandı ya da müşteriye teslim edildi.</summary>
    public static readonly ServiceStatus[] CompletedStatuses =
    {
        ServiceStatus.Delivered,
        ServiceStatus.FieldCompleted
    };

    /// <summary>Üzerinde fiilen çalışılıyor.</summary>
    public static readonly ServiceStatus[] InProgressStatuses =
    {
        ServiceStatus.Workshop,
        ServiceStatus.InRepair,
        ServiceStatus.InDelivery
    };

    /// <summary>Açık ama henüz çalışılmaya başlanmamış.</summary>
    public static readonly ServiceStatus[] PendingStatuses =
    {
        ServiceStatus.New,
        ServiceStatus.WaitingForParts,
        ServiceStatus.Ready,
        ServiceStatus.Delayed,
        ServiceStatus.Planned,
        ServiceStatus.FieldPlanned,
        ServiceStatus.SmallProductAcceptance,
        ServiceStatus.WorkshopReady,
        ServiceStatus.DeliveryPlanning,
        ServiceStatus.LargeProductPlanning
    };

    public static Expression<Func<ServiceRecord, bool>> IsCompleted =>
        s => s.Status == ServiceStatus.Delivered || s.Status == ServiceStatus.FieldCompleted;

    public static Expression<Func<ServiceRecord, bool>> IsCancelled =>
        s => s.Status == ServiceStatus.Cancelled;

    /// <summary>
    /// Tekrar servis penceresi: bir ürün tamamlandıktan sonra kaç gün içinde tekrar kayıt
    /// açılırsa "tekrar servis" sayılır. Saklanan bir alan değil, türetilen bir ölçü — bu yüzden
    /// pencere açıkça burada duruyor ve ekranda da yazılıyor.
    /// </summary>
    public const int RepeatServiceWindowDays = 30;

    /// <summary>Ayın teknisyeni sıralamasına girmek için gereken en az tamamlanmış iş.</summary>
    public const int TechnicianOfMonthMinimumJobs = 5;

    public static string StatusLabel(ServiceStatus status) => status switch
    {
        ServiceStatus.New => "Yeni",
        ServiceStatus.Workshop => "Atölyede",
        ServiceStatus.InRepair => "Tamirde",
        ServiceStatus.WaitingForParts => "Parça Bekliyor",
        ServiceStatus.Ready => "Hazır",
        ServiceStatus.Delivered => "Teslim Edildi",
        ServiceStatus.Cancelled => "İptal",
        ServiceStatus.Delayed => "Gecikti",
        ServiceStatus.Planned => "Planlandı",
        ServiceStatus.FieldPlanned => "Saha Planlandı",
        ServiceStatus.InDelivery => "Teslimatta",
        ServiceStatus.SmallProductAcceptance => "Küçük Ürün Kabul",
        ServiceStatus.WorkshopReady => "Atölye Tamamlandı",
        ServiceStatus.DeliveryPlanning => "Teslimat Planlama",
        ServiceStatus.FieldCompleted => "Sahada Tamamlandı",
        ServiceStatus.LargeProductPlanning => "Büyük Ürün Planlama",
        _ => status.ToString()
    };

    public static string CargoStatusLabel(CargoTrackingStatus status) => status switch
    {
        CargoTrackingStatus.Received => "Alındı",
        CargoTrackingStatus.Planned => "Planlandı",
        CargoTrackingStatus.Preparing => "Hazırlanıyor",
        CargoTrackingStatus.OutForDelivery => "Dağıtımda",
        CargoTrackingStatus.Delivered => "Teslim Edildi",
        _ => status.ToString()
    };
}
