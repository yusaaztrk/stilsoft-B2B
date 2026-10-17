using ServiceOps.Domain.Entities;

namespace ServiceOps.Application.Dtos;

public static class EnumExtensions
{
    public static string ToTurkishString(this ServiceStatus status) => status switch
    {
        ServiceStatus.New => "Yeni Kayıt",
        ServiceStatus.Planned => "Planlandı",
        ServiceStatus.Workshop => "Atölyede",
        ServiceStatus.InRepair => "Tamirde",
        ServiceStatus.WaitingForParts => "Parça Bekliyor",
        ServiceStatus.Ready => "Hazır",
        ServiceStatus.Delivered => "Teslim Edildi",
        ServiceStatus.Cancelled => "İptal",
        ServiceStatus.Delayed => "Gecikti",
        ServiceStatus.FieldPlanned => "Saha Planlamasında",

        // ALTI DURUM ÇEVRİLMEMİŞTİ ve `_ => status.ToString()` yüzünden ekranda ham enum adı
        // olarak görünüyordu ("LargeProductPlanning", 2026-08-27 kullanıcı bildirimi).
        // Yaşam döngüsüne sonradan eklenen durumlar buraya işlenmemiş; enum'a yeni durum
        // eklenince BURASI da güncellenmeli.
        //
        // `LargeProductPlanning` bilerek "Planlandı": yeni bir aşama değil, planlama
        // sekmesinin kapsadığı kaydın ta kendisi — Saha Arıza ekranı da yıllardır bu kaydı
        // "Planlandı" diye gösteriyor. Aynı duruma iki ekranda iki ad vermek olmaz.
        ServiceStatus.LargeProductPlanning => "Planlandı",
        ServiceStatus.InDelivery => "Teslimatta",
        ServiceStatus.WorkshopReady => "Atölye Tamamlandı",
        ServiceStatus.DeliveryPlanning => "Teslimat Planlamasında",
        ServiceStatus.FieldCompleted => "Sahada Tamamlandı",
        ServiceStatus.SmallProductAcceptance => "Küçük Ürün Kabulünde",
        ServiceStatus.Postponed => "Ertelendi",

        _ => status.ToString()
    };

    public static string ToTurkishString(this ServiceType type) => type switch
    {
        ServiceType.Repair => "Onarım",
        ServiceType.Installation => "Montaj",
        ServiceType.Maintenance => "Bakım",
        ServiceType.Warranty => "Garanti",
        _ => type.ToString()
    };

    public static string ToTurkishString(this PriorityLevel priority) => priority switch
    {
        PriorityLevel.Low => "Düşük",
        PriorityLevel.Normal => "Normal",
        PriorityLevel.High => "Acil",
        PriorityLevel.Critical => "Kritik",
        _ => priority.ToString()
    };

    public static string ToTurkishString(this TechnicianStatus status) => status switch
    {
        TechnicianStatus.Available => "Müsait",
        TechnicianStatus.OnField => "Sahada",
        TechnicianStatus.OnBreak => "Molada",
        TechnicianStatus.OffDuty => "Mesai Dışı",
        TechnicianStatus.Inactive => "Aktif Değil",
        _ => status.ToString()
    };

    public static string ToTurkishString(this RouteStatus status) => status switch
    {
        RouteStatus.Planned => "Planlandı",
        RouteStatus.InProgress => "Yolda",
        RouteStatus.Completed => "Tamamlandı",
        RouteStatus.Cancelled => "İptal",
        RouteStatus.Delayed => "Gecikti",
        _ => status.ToString()
    };

    public static string ToTurkishString(this StopStatus status) => status switch
    {
        StopStatus.Pending => "Bekliyor",
        StopStatus.InProgress => "İşlemde",
        StopStatus.Completed => "Tamamlandı",
        StopStatus.Skipped => "Atlandı",
        StopStatus.Delayed => "Gecikti",
        _ => status.ToString()
    };

    public static string ToTurkishString(this WorkOrderStatus status) => status switch
    {
        WorkOrderStatus.Pending => "Bekliyor",
        WorkOrderStatus.InProgress => "İşlemde",
        WorkOrderStatus.Paused => "Duraklatıldı",
        WorkOrderStatus.Completed => "Tamamlandı",
        WorkOrderStatus.Cancelled => "İptal",
        WorkOrderStatus.Delayed => "Gecikti",
        _ => status.ToString()
    };

    public static string ToTurkishString(this InventoryStatus status) => status switch
    {
        InventoryStatus.InStock => "Stokta",
        InventoryStatus.LowStock => "Kritik Stok",
        InventoryStatus.OutOfStock => "Stok Yok",
        InventoryStatus.Discontinued => "Satış Dışı",
        InventoryStatus.OnOrder => "Siparişte",
        _ => status.ToString()
    };

    /// <summary>
    /// Montaj satırı durum etiketleri.
    ///
    /// BU LİSTE ÜÇ YERLE BİREBİR AYNI OLMALI: <c>InstallationsController.StateLabel</c>,
    /// istemcideki <c>montajPlanRows.STATE_LABELS</c> ve buradaki eşleme. Ayrıştıklarında aynı
    /// satır ekranın bir yerinde başka, başka yerinde başka görünüyor.
    ///
    /// Düzeltilenler (2026-08-12, MONTAJ-DEVIR §8.3): <c>Completed</c> "Tamamlandı" diyordu,
    /// oysa her ekranda "Gerçekleşti" yazıyor — Montaj Geçmişi satır tablosu bu metni sunucudan
    /// aldığı için orada "Tamamlandı" görünüyordu. <c>InProgress</c> de "İşlemde" idi; "İşlemde"
    /// KARIŞIK durumun (Mixed) etiketi, tek bir satırın devam etmesi "Devam Ediyor".
    /// </summary>
    public static string ToTurkishString(this InstallationTaskStatus status) => status switch
    {
        InstallationTaskStatus.Planned => "Planlandı",
        InstallationTaskStatus.InProgress => "Devam Ediyor",
        InstallationTaskStatus.Completed => "Gerçekleşti",
        InstallationTaskStatus.Cancelled => "İptal",
        InstallationTaskStatus.Deferred => "Yeni Kayıt",
        InstallationTaskStatus.Unreachable => "Ulaşılamadı",
        InstallationTaskStatus.Delivered => "Teslim Edildi (Planlama Bekliyor)",
        InstallationTaskStatus.Postponed => "Ertelendi",
        _ => status.ToString()
    };
}
