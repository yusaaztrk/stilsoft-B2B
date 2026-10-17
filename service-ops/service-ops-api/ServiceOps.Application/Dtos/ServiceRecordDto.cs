using System.ComponentModel.DataAnnotations;
using ServiceOps.Domain.Entities;

namespace ServiceOps.Application.Dtos;

public class ServiceRecordDto
{
    public Guid Id { get; set; }
    public string ServiceNumber { get; set; } = string.Empty;
    /// <summary>Kağıt fiş numarası — elle girilir, sistem numarasından ayrıdır.</summary>
    public string? ManualReceiptNo { get; set; }
    public ServiceStatus Status { get; set; }
    public string StatusLabel => Status.ToTurkishString();
    public ServiceType Type { get; set; }
    public string TypeLabel => Type.ToTurkishString();
    public DateTime CreatedAt { get; set; }
    public DateTime? EstimatedDeliveryDate { get; set; }
    public DateTime? PlannedAt { get; set; }
    public bool IsPlanned => Status == ServiceStatus.Planned || PlannedAt.HasValue;
    // Customer
    public string? CustomerName { get; set; }
    public string? CustomerPhone { get; set; }
    public string? CustomerAddress { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    
    // Product
    public string ProductName { get; set; } = string.Empty;
    public string? ProductStockCode { get; set; }
    public string? SerialNumber { get; set; }
    public bool IsUnderWarranty { get; set; }

    /// <summary>
    /// Garanti başlangıç tarihi (yyyy-MM-dd). Depodaki karşılığı <c>ServiceRecord.PurchaseDate</c>.
    /// Garanti YOKSA boştur. Listelerde "Garanti: Evet" rozetinin altında gösterilir.
    /// </summary>
    public DateTime? WarrantyStartDate { get; set; }

    /// <summary>Teslim şekli; 1 = Mağazadan alınacak, 2 = Bayiye teslim edilecek. Bkz. ServiceRecord.PickupSourceId.</summary>
    public int? PickupSourceId { get; set; }
    public string? Category { get; set; }
    
    // Dealer
    public string? DealerName { get; set; }
    public string? DealerPhone { get; set; }
    public string? DealerAddress { get; set; }
    public string? DealerCode { get; set; }
    
    // Assignment
    public Guid? AssignedTechnicianId { get; set; }
    public string? AssignedTechnicianName { get; set; }
    public string? AssignedTechnicianAvatar { get; set; }
    public List<string>? AssignedTechnicians { get; set; }
    
    // Region
    public Guid? RegionId { get; set; }
    public string? RegionName { get; set; }
    
    // Priority
    public PriorityLevel Priority { get; set; }
    public string PriorityLabel => Priority.ToTurkishString();
    
    // Description
    public string? ProblemDescription { get; set; }
    public string? ReceivingNote { get; set; }
    public string? LastAction { get; set; }
    
    // Notes
    public List<ServiceNoteDto>? Notes { get; set; }
    public List<InstallationTaskDto>? InstallationTasks { get; set; }

    /// <summary>
    /// Kalemlerden türetilmiş genel durum: kalemlerin hepsi aynı durumdaysa o durum, karışıksa
    /// <c>Mixed</c> ("İşlemde"). Kaydın kendi <see cref="Status"/> alanı yaşam döngüsü akışını
    /// (Atölye, Teslimat…) taşıdığı için montaj listesinde bu gösterilir.
    /// </summary>
    public string? DerivedState { get; set; }
    public string? DerivedStateLabel { get; set; }

    /// <summary>Kabul kaleminin satırları. Planlama bunların üzerinden yapılır.</summary>
    public List<ServiceRecordItemDto> Items { get; set; } = new();
    /// <summary>Kalemlerin miktar toplamı — eski "Miktar: N" metninin yerini alır.</summary>
    public int TotalQuantity { get; set; }
 
    // User daily routing / planning fields
    public bool UserRouteTick { get; set; }
    public string? UserRouteHour { get; set; }
    public int UserRouteSortOrder { get; set; }

    // Official / Admin route planning fields
    public int? RouteOrder { get; set; }
    public string? PlannedStartTime { get; set; }
    public string? PlannedEndTime { get; set; }
    public string? RouteDate { get; set; }
    public Guid? TechnicianId { get; set; }
    public bool IsPrinted { get; set; }

    /// <summary>
    /// Faturalandı mı ve hangi fiş/sipariş numarasıyla.
    ///
    /// DTO'da YOKTU: ekran `isInvoiced`'ı okumaya çalışıyor ama alan hiç dönmediği için hep
    /// tanımsızdı — kullanıcıya "zaten faturalandı" bilgisi gösterilemiyor ve fatura düğmesi
    /// kapatılamıyordu. Sunucudaki tekillik kilidi ikinci faturayı zaten engelliyor, ama
    /// kullanıcının bunu ekranda görmesi gerekiyor.
    /// </summary>
    public bool IsInvoiced { get; set; }
    public string? InvoiceReference { get; set; }
    public int? SatisfactionScore { get; set; }
    public string? SatisfactionNotes { get; set; }
    public string? SatisfactionBy { get; set; }
    public DateTime? SatisfactionCreatedAt { get; set; }
    public string? InstallationType { get; set; }
    public bool HasWorkOrder { get; set; }

    /// <summary>
    /// DURUM TARİHİ (2026-09-18 kullanıcı isteği: "durum sütununda altta o duruma alınma
    /// tarihi de gelsin"). Kaydın son işlem anı; kapanmışsa <see cref="CompletedAt"/> daha
    /// doğru tarihtir. Geriye dönük işlenen işlerde (EffectiveDate) bu alanlar SEÇİLEN güne
    /// yazılır, "şimdi"ye değil.
    /// </summary>
    public DateTime? UpdatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }

    /// <summary>
    /// ATÖLYEYE İLK GİRİŞ ANI (2026-10-04 kullanıcı isteği: arıza ekranlarında ikinci gün
    /// sayacı). Kaydın durumu İLK KEZ atölye durumlarından birine (Atölyede, Tamirde, Parça
    /// Bekliyor) geçtiği an; durum sonradan değişse de bu tarih kalır, sayaç iş bitene kadar
    /// sayar. Hiç atölyeye girmediyse boş — ekran "Atölyeye girmedi" yazar.
    ///
    /// Kolon değil, işlem geçmişinden (Activities) türetilir: geçmiş kayıtlar da ilk günden
    /// doğru sayılsın diye. Yalnız liste ucu (GetPagedAsync) doldurur.
    /// </summary>
    public DateTime? WorkshopEnteredAt { get; set; }
    public List<string> PhotoUrls { get; set; } = new();
}

public class ServiceNoteDto
{
    public Guid Id { get; set; }
    public string Content { get; set; } = string.Empty;
    public string AuthorName { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

public class InstallationTaskDto
{
    public Guid Id { get; set; }
    public Guid? AssignedTechnicianId { get; set; }
    public string? AssignedTechnicianName { get; set; }
    public DateTime? PlannedAt { get; set; }
    public int Status { get; set; }
    public string StatusLabel { get; set; } = string.Empty;
    public int Quantity { get; set; }
    public string? Notes { get; set; }
    public string? CustomAddress { get; set; }
    public string? PhotoUrl { get; set; }
    public string? SerialNumber { get; set; }
    public Guid? ServiceRecordItemId { get; set; }
    public string? ItemProductName { get; set; }
    /// <summary>Satır sahaya aktarıldıysa aktarım anı. Planlama / Teslimattakiler ayrımı buradan.</summary>
    public DateTime? TransferredAt { get; set; }

    /// <summary>
    /// Satırın DURUM TARİHİ için (2026-09-18). `CompletedAt` gerçekleşme anı — geriye dönük
    /// işlenen işte SEÇİLEN gün —, `UpdatedAt` ise son dokunuş. Ekran gerçekleşmiş satırda
    /// `CompletedAt`'i, diğerlerinde `UpdatedAt`'i gösterir.
    /// </summary>
    public DateTime? CompletedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

public class ServiceRecordItemDto
{
    public Guid Id { get; set; }
    public string ProductName { get; set; } = string.Empty;
    public string? ProductStockCode { get; set; }
    public string? SerialNumber { get; set; }
    public int Quantity { get; set; }
    public string? Notes { get; set; }
    public int SortOrder { get; set; }
    public string? ExternalRef { get; set; }

    /// <summary>Kalemin kendi montaj adresi; boşsa kaydın müşteri bilgisi geçerlidir.</summary>
    public string? CustomerName { get; set; }
    public string? CustomerPhone { get; set; }
    public string? CustomerAddress { get; set; }

    /// <summary>Kalem iptal edildiyse dolu. İptal kalem seviyesinde; kaydın diğer kalemleri işler.</summary>
    public DateTime? CancelledAt { get; set; }
    public string? CancelReason { get; set; }

    /// <summary>
    /// Bu kalemin servis fişinin en son basıldığı an; hiç basılmadıysa boş. Listedeki
    /// "Servis Fişi ✓" tik'i ve yanındaki tarih bundan okunur — kaydın <c>IsPrinted</c>
    /// bayrağından değil (o bayrak kayıt geneli ve bütün kalemleri basılmış gösteriyordu).
    /// </summary>
    public DateTime? SlipPrintedAt { get; set; }
}

public class CreateServiceRecordItemDto
{
    public Guid? Id { get; set; }
    public string ProductName { get; set; } = string.Empty;
    public string? ProductStockCode { get; set; }
    public string? SerialNumber { get; set; }
    public int Quantity { get; set; } = 1;
    public string? Notes { get; set; }
    public string? ExternalRef { get; set; }
    public string? CustomerName { get; set; }
    public string? CustomerPhone { get; set; }
    public string? CustomerAddress { get; set; }
}

public class CreateServiceRecordDto
{
    public ServiceType Type { get; set; }
    public string? Category { get; set; } // "small" or "large"
    /// <summary>Kağıt fiş numarası; kabul sırasında elle girilebilir, boş bırakılabilir.</summary>
    public string? ManualReceiptNo { get; set; }
    public string? CustomerName { get; set; }
    public string? CustomerPhone { get; set; }
    public string? CustomerEmail { get; set; }
    public string? CustomerAddress { get; set; }
    public Guid? CustomerId { get; set; }
    public string ProductName { get; set; } = string.Empty;
    public string? ProductStockCode { get; set; }
    public string? ProductModel { get; set; }
    public string? SerialNumber { get; set; }
    public bool IsUnderWarranty { get; set; }

    /// <summary>
    /// Garanti başlangıç tarihi — "yyyy-MM-dd" METNİ olarak taşınır.
    ///
    /// Tip bilerek <c>DateTime?</c> DEĞİL: bu nesne hem oluşturma hem GÜNCELLEME (PUT) yolunda
    /// kullanılıyor ve alanı hiç göndermeyen çağıranlar var (mobil, montaj ekranı). Tarih tipiyle
    /// "gönderilmedi" ile "temizle" ayırt edilemez, dolayısıyla alanı bilmeyen her istemci
    /// girilmiş tarihi sessizce SİLERDİ — <c>ManualReceiptNo</c>'da aynı tuzağa düşülmüştü.
    ///
    /// Kural aynı: <c>null</c> = dokunma, boş metin = temizle, dolu = yaz.
    /// </summary>
    public string? WarrantyStartDate { get; set; }

    /// <summary>
    /// Teslim alma kaynağı; 1 = Mağazadan. <c>null</c> gelirse DOKUNULMAZ — alanı bilmeyen
    /// eski istemciler (mobil, montaj ekranı) seçimi silmesin.
    /// </summary>
    public int? PickupSourceId { get; set; }
    public Guid? DealerId { get; set; }
    public string? DealerName { get; set; }
    public string? DealerCode { get; set; }
    public string? DealerPhone { get; set; }
    public string? DealerAddress { get; set; }
    public string? InstallationType { get; set; }
    public string? ProblemDescription { get; set; }
    public string? ReceivingNote { get; set; }
    public PriorityLevel Priority { get; set; } = PriorityLevel.Normal;
    [Required(ErrorMessage = "Bölge seçimi zorunludur.")]
    public Guid? RegionId { get; set; }
    // UI'de "planlanan tarih" olarak kullanılıyor
    public DateTime? PlannedDate { get; set; }

    // Geriye uyumluluk: mevcut alanı da desteklemeye devam ediyoruz
    public DateTime? EstimatedDeliveryDate { get; set; }

    // Optional initial assignment
    public Guid? TechnicianId { get; set; }

    /// <summary>
    /// Montaj kalemleri. Boş gelirse ProductName/SerialNumber'dan tek kalem üretilir, böylece
    /// kalemi olmayan eski istemciler çalışmaya devam eder.
    /// </summary>
    public List<CreateServiceRecordItemDto>? Items { get; set; }
}

public class PlanServiceRecordDto
{
    public DateTime PlannedDate { get; set; }
    public Guid? TechnicianId { get; set; }
    public string? Status { get; set; }

    /// <summary>
    /// Planlamayı yapan kişinin adı. İSTEMCİDEN GELMEZ, controller doldurur — istemciye
    /// bırakılsaydı kim olduğu uydurulabilirdi. Boş kalırsa tarihçe "Sistem" yazar ve
    /// planlamayı bir insanın yaptığı bilgisi kaybolur (2026-08-27 bildirimi).
    /// </summary>
    public string? PerformedByName { get; set; }
}

public class ServiceRecordQueryDto
{
    public string? Q { get; set; }
    public ServiceStatus? Status { get; set; }
    public string? Statuses { get; set; }
    public ServiceType? Type { get; set; }
    public Guid? TechnicianId { get; set; }
    public Guid? RegionId { get; set; }
    public DateTime? DateFrom { get; set; }
    public DateTime? DateTo { get; set; }
    public DateTime? PlannedFrom { get; set; }
    public DateTime? PlannedTo { get; set; }
    public string? PlannedDate { get; set; }
    public int? SatisfactionScore { get; set; }
    public string? InstallationType { get; set; }
    public string? DealerCode { get; set; }
    public string? Category { get; set; }

    /// <summary>
    /// PASİF KAYITLARI DA GETİR (2026-08-23, kullanıcı isteği).
    ///
    /// <para>Kaydın açılışından bu yana <see cref="ServiceRecordService.PassiveAfterDays"/>
    /// günden fazla geçmişse kayıt "pasif" sayılır ve varsayılan listede GÖRÜNMEZ. Eski
    /// sistemden aktarılan yıllar öncesine ait kayıtlar kabul/planlama ekranlarını
    /// dolduruyordu; günlük işi görebilmek için liste güncel kayıtlara indirgeniyor.</para>
    ///
    /// <para>Süzgeç SUNUCUDA uygulanır. İstemcide süzmek işe yaramazdı: sayfalama sunucuda
    /// yapıldığı için ilk sayfa baştan aşağı eski kayıtlarla dolar, ekranda birkaç satır
    /// kalırdı.</para>
    ///
    /// <para>Arama yapılırken (<see cref="Q"/> dolu) bu süzgeç UYGULANMAZ: kullanıcı eski bir
    /// fiş numarasını aradığında kaydı bulamamak, listeyi kısaltmaktan daha kötüdür.</para>
    /// </summary>
    public bool IncludePassive { get; set; } = false;

    /// <summary>
    /// YALNIZ SAYI (2026-10-05). Menü rozetleri listeyi değil yalnız toplamı istiyor; eskiden
    /// `pageSize=1` ile tam liste sorgusu çalışıyordu (notlar, kalemler, görevler, fotoğraflar —
    /// bölünmüş sorguda ~10 ayrı SQL). true ise yalnız COUNT çalışır, `Items` boş döner.
    /// </summary>
    public bool CountOnly { get; set; } = false;

    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 20;
}

public class PagedResultDto<T>
{
    public List<T> Items { get; set; } = new();
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int TotalCount { get; set; }
    public int TotalPages { get; set; }
}

public class UpdateServiceStatusDto
{
    public ServiceStatus Status { get; set; }
    public string? Notes { get; set; }
    public Guid? PerformedByTechnicianId { get; set; }
    public string? PerformedByName { get; set; }

    /// <summary>
    /// Kısmi aktarım: yalnızca bu planlama satırları sahaya aktarılır, kalanlar kayıtta kalır.
    /// Boş bırakılırsa planlanmış tüm satırlar aktarılır (eski davranış).
    /// </summary>
    public List<Guid>? TaskIds { get; set; }

    /// <summary>
    /// "Planlamaya geri gönder"de GERÇEKLEŞMİŞ satırların da geri alınmasını ister.
    ///
    /// Varsayılan olarak kapalıdır çünkü aktarımı geri almak ile yapılmış işi geri almak aynı şey
    /// değil. Ama iş sahada tamamlandıktan sonra "yanlış girildi" denmesi gerçek bir durum ve
    /// bunun BAŞKA hiçbir yolu yoktu: geri gönderme gerçekleşmişleri atlıyor, kalem çekmecesindeki
    /// durum listesi de tek tek satır gerektiriyordu. Açıkken tamamlanma damgası silinir ve
    /// satırların hak edişi iptale çekilir.
    /// </summary>
    public bool IncludeCompleted { get; set; }
}

public class AssignTechnicianDto
{
    public Guid TechnicianId { get; set; }
    public string? Notes { get; set; }
}

public class UpdateSatisfactionDto
{
    public int SatisfactionScore { get; set; }
    public string? SatisfactionNotes { get; set; }
}
