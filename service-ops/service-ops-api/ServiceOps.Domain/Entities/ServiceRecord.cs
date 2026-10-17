using System;
using System.Collections.Generic;

namespace ServiceOps.Domain.Entities;

public class ServiceRecord
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string ServiceNumber { get; set; } = string.Empty;

    /// <summary>
    /// KAĞIT FİŞ NUMARASI — elle girilir, sistemin ürettiği numaradan AYRIDIR.
    ///
    /// <para><see cref="ServiceNumber"/> sistemin kendi sayacından gelir (SH-0000042) ve
    /// değiştirilemez. Serviste ürünle birlikte bir de basılı fiş dolduruluyor ve o fişin
    /// numarası bugüne kadar hiçbir yerde tutulmuyordu: müşteri elindeki kağıtla arayınca
    /// kaydı bulmanın yolu yoktu.</para>
    ///
    /// <para>Eski sistemden aktarılan kayıtların fiş numarası da buraya yazılır; böylece
    /// aktarım sonrası eski kağıtlarla sistem arasındaki bağ korunur.</para>
    ///
    /// <para>Serbest metin ve TEKİL DEĞİL: aynı numara elle iki kez girilebilir. Tekillik
    /// dayatmak, eski defterlerde zaten tekrar eden numaralar yüzünden aktarımı durdururdu.</para>
    /// </summary>
    public string? ManualReceiptNo { get; set; }
    public ServiceStatus Status { get; set; } = ServiceStatus.New;
    public ServiceType Type { get; set; } = ServiceType.Repair;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public DateTime? EstimatedDeliveryDate { get; set; }
    public DateTime? PlannedAt { get; set; }
    
    // Customer Info
    public Guid? CustomerId { get; set; }
    public Customer? Customer { get; set; }
    public string? CustomerName { get; set; }
    public string? CustomerPhone { get; set; }
    public string? CustomerEmail { get; set; }
    public string? CustomerAddress { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    
    // Product Info
    public string ProductName { get; set; } = string.Empty;
    public string? ProductStockCode { get; set; }
    public string? ProductModel { get; set; }
    public string? SerialNumber { get; set; }
    public string? Barcode { get; set; }
    public bool IsUnderWarranty { get; set; }

    /// <summary>
    /// GARANTİ BAŞLANGIÇ TARİHİ. Kolon adı tarihsel: "satın alma tarihi" diye açılmıştı ve
    /// bugüne kadar hiçbir yerde yazılmıyor/okunmuyordu (ölü kolon). Kabul ekranlarındaki
    /// "Garanti Başlangıç Tarihi" alanının kalıcı yeri artık burasıdır.
    ///
    /// Yeni kolon AÇILMADI: bu kolon zaten her veritabanında var, tipi doğru (nullable
    /// timestamptz) ve kimse kullanmıyor — göç gerektirmeden gerçek bir alan kazanıldı.
    /// Dışarıya <c>WarrantyStartDate</c> adıyla çıkar (bkz. ServiceRecordDto).
    ///
    /// GÜN KAYMASI: gelen değer takvim günüdür (yyyy-MM-dd), saat değil. UTC gece yarısı
    /// olarak yazılır ve istemci ISO metnin ilk 10 karakterini okur; ikisi de yerel saate
    /// çevirmediği için gün hiçbir yönde kaymaz.
    /// </summary>
    public DateTime? PurchaseDate { get; set; }
    
    // Dealer Info
    public Guid? DealerId { get; set; }
    public Dealer? Dealer { get; set; }
    public string? DealerName { get; set; }
    public string? DealerCode { get; set; }  // B2B Cari Kodu (ör: 120-01-00001)
    public string? DealerPhone { get; set; }
    public string? DealerAddress { get; set; }
    
    // Service Details
    public string? ProblemDescription { get; set; }
    public string? ReceivingNote { get; set; }
    public string? TechnicianNotes { get; set; }
    public string? SolutionDescription { get; set; }
    public decimal? ServiceCost { get; set; }
    public decimal? PartsCost { get; set; }
    
    // Product Category (Large/Small product distinction)
    public ProductCategory ProductCategory { get; set; } = ProductCategory.Large;

    // Assignment
    public Guid? AssignedTechnicianId { get; set; }
    public Technician? AssignedTechnician { get; set; }

    // Workshop Technician (who performed the repair in workshop)
    public Guid? WorkshopTechnicianId { get; set; }

    // Delivery Technician (who delivers the product back)
    public Guid? DeliveryTechnicianId { get; set; }

    // Completed By (who completed the field job)
    public Guid? CompletedByTechnicianId { get; set; }
    
    // Region
    public Guid? RegionId { get; set; }
    public Region? Region { get; set; }
    
    // Priority
    public PriorityLevel Priority { get; set; } = PriorityLevel.Normal;
    
    // User daily routing / planning fields
    public bool UserRouteTick { get; set; } = false;
    public string? UserRouteHour { get; set; }
    public int UserRouteSortOrder { get; set; } = 0;

    // Official / Admin route planning fields
    public int? RouteOrder { get; set; }
    public string? PlannedStartTime { get; set; }
    public string? PlannedEndTime { get; set; }
    public string? RouteDate { get; set; }
    public Guid? TechnicianId { get; set; }
    public Technician? Technician { get; set; }

    // Navigation
    public ICollection<WorkOrder> WorkOrders { get; set; } = new List<WorkOrder>();
    public ICollection<InventoryUsage> InventoryUsages { get; set; } = new List<InventoryUsage>();
    public ICollection<ServiceNote> Notes { get; set; } = new List<ServiceNote>();
    public ICollection<InstallationTask> InstallationTasks { get; set; } = new List<InstallationTask>();
    public ICollection<ServiceRecordItem> Items { get; set; } = new List<ServiceRecordItem>();
    public ICollection<Activity> Activities { get; set; } = new List<Activity>();

    /// <summary>
    /// ÜRÜN NEREDEN TESLİM ALINACAK (2026-08-27 kullanıcı isteği:
    /// "mağazadan mı teslim alınacak diye yeni kolon, id ile tut, ileride başka şeyler de
    /// ekleriz").
    ///
    /// <para>Bilerek <c>bool</c> DEĞİL: soru bugün "mağazadan mı" ama yarın başka kaynaklar
    /// eklenecek. Kimlik değerli tutulunca yeni seçenek eklemek tek satır olur; bool olsaydı
    /// ikinci seçenekte ikinci bir kolon açmak gerekirdi.</para>
    ///
    /// <para>Değerler: <c>null</c> = belirtilmedi (varsayılan akış, bayiden/müşteriden) ·
    /// <c>1</c> = Mağazadan teslim alınacak · <c>2</c> = Bayiye teslim edilecek. Yeni değer
    /// eklenince <c>utils/customerType.ts</c> ve kabul ekranındaki seçim de güncellenmeli.</para>
    ///
    /// <para>Müşteri tipini de bu alan belirler: 1 ise kayıt listelerde "Mağaza", 2 ise
    /// kırmızı "Bayiye Teslim" görünür ve bu, cari kodundan çıkarılan tipin ÖNÜNE geçer —
    /// açık seçim, çıkarıma üstündür. Tek kolon olduğu için iki seçim birbirini dışlar.</para>
    /// </summary>
    public int? PickupSourceId { get; set; }

    public bool IsPrinted { get; set; } = false;

    public int? SatisfactionScore { get; set; }
    public string? SatisfactionNotes { get; set; }
    public string? SatisfactionBy { get; set; }
    public DateTime? SatisfactionCreatedAt { get; set; }

    public string? InstallationType { get; set; }

    // Invoice / Billing
    public string? InvoiceReference { get; set; }
    public bool IsInvoiced { get; set; } = false;

    /// <summary>
    /// Kaydın FATURALANMADAN HEMEN ÖNCEKİ durumu.
    ///
    /// Fatura silinince kayıt bu duruma geri döner — sahadaysa sahaya, atölyedeyse atölyeye.
    /// Faturalama anında damgalanır (<c>ErpController.CreateServiceInvoice</c>), geri alınırken
    /// okunup temizlenir (<c>ServiceRecordsController.RevertToReady</c>).
    ///
    /// NULL = ya hiç faturalanmamış ya da bu alan eklenmeden önce faturalanmış eski bir kayıt;
    /// ikinci durumda geri alma eski tahmin yoluna (sayfa adına bakan dal) düşer.
    /// </summary>
    public ServiceStatus? PreInvoiceStatus { get; set; }

    // Soft delete fields
    public bool IsDeleted { get; set; } = false;
    public DateTime? DeletedAt { get; set; }
    public string? DeletedBy { get; set; }
}

public enum ServiceStatus
{
    New = 0,
    Workshop = 1,
    InRepair = 2,
    WaitingForParts = 3,
    Ready = 4,
    Delivered = 5,
    Cancelled = 6,
    Delayed = 7,
    Planned = 8,
    FieldPlanned = 9,
    InDelivery = 10,

    // New lifecycle statuses (non-breaking – appended)
    SmallProductAcceptance = 11,  // Küçük ürün kabul aşamasında
    WorkshopReady = 12,           // Atölye tamamlandı, teslimat planlaması bekliyor
    DeliveryPlanning = 13,        // Hazır Ürün Teslimat Planlama aşamasında
    FieldCompleted = 14,          // Sahada tamamlandı (fatura bekliyor)
    LargeProductPlanning = 15,    // Büyük ürün planlama (servis müdürü atayacak)

    /// <summary>
    /// ERTELENDİ — saha planlamasından geri çekilmiş, planlamada bekleyen kayıt
    /// (2026-08-27 kullanıcı isteği).
    ///
    /// <para>Neden yeni bir durum: kayıt planlamaya geri dönmeli AMA "Yeni Kayıt" gibi
    /// görünmemeli — planlamacı bunun bir kez planlanıp ertelendiğini görmek zorunda.
    /// Mevcut <see cref="Delayed"/> ("Gecikti") kullanılamazdı: o durum ATÖLYE sekmesinin
    /// sorgusunda da var, kayıt aynı anda iki sekmede birden görünürdü.</para>
    ///
    /// <para>Enum sonuna eklendi ve kolon tamsayı; göç gerekmez.</para>
    /// </summary>
    Postponed = 16
}

public enum ServiceType
{
    Repair = 0,
    Installation = 1,
    Maintenance = 2,
    Warranty = 3
}

public enum PriorityLevel
{
    Low = 0,
    Normal = 1,
    High = 2,
    Critical = 3
}

public enum ProductCategory
{
    Large = 0,   // Büyük ürün (buzdolabı, çamaşır makinesi vb.)
    Small = 1    // Küçük ürün (süpürge, tost makinesi vb.)
}
