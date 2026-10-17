using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;
using System.Net.Http;
using System.Globalization;
using System.Text.Json;
using ServiceOps.Application.Dtos;
using ServiceOps.Application.Interfaces;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Application.Services;

public class ServiceRecordService : IServiceRecordService
{
    /// <summary>
    /// Garanti başlangıç tarihi metnini (yyyy-MM-dd) depolanacak değere çevirir.
    ///
    /// UTC gece yarısına sabitlenir: değer bir TAKVİM GÜNÜ, an değil. Sunucunun ya da
    /// istemcinin yerel saatine göre çevrilseydi +03'te gece yarısı bir önceki güne düşer,
    /// ekranda girilenden bir gün eksik tarih görünürdü.
    ///
    /// Ayrıştırılamayan metin sessizce boş sayılır; kabul ekranı zaten &lt;input type="date"&gt;
    /// kullanıyor, buraya serbest metin gelmesi ancak eski/yanlış bir istemciden olur ve
    /// yüzünden kaydın tamamının reddedilmesi doğru olmaz.
    /// </summary>
    private static DateTime? ParseWarrantyStartDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;

        var text = value.Trim();
        if (text.Length > 10) text = text.Substring(0, 10);

        return DateTime.TryParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? DateTime.SpecifyKind(parsed, DateTimeKind.Utc)
            : null;
    }

    /// <summary>
    /// Kaç günden sonra kayıt "pasif" sayılır (2026-08-23, kullanıcı: "3 ay geçtiyse").
    ///
    /// <para>Pasif kayıt SİLİNMEZ, durumu DEĞİŞMEZ — yalnızca varsayılan listede görünmez.
    /// Ekrandaki "Pasife Alınanları Göster" kutusu işaretlenince hepsi geri gelir.</para>
    ///
    /// <para>Aynı sayı arayüzde de kullanılıyor (satırdaki "Pasif" rozeti); ikisi değişirse
    /// birlikte değişmeli.</para>
    /// </summary>
    public const int PassiveAfterDays = 90;

    private readonly ApplicationDbContext _context;
    private readonly GeocodingService _geocodingService;
    private readonly ITechnicianService _technicianService;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;

    public ServiceRecordService(
        ApplicationDbContext context, 
        GeocodingService geocodingService, 
        ITechnicianService technicianService,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration)
    {
        _context = context;
        _geocodingService = geocodingService;
        _technicianService = technicianService;
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
    }

    public async Task<ServiceRecordDto?> GetByIdAsync(Guid id)
    {
        var service = await _context.ServiceRecords
            .Include(s => s.Customer)
            .Include(s => s.Dealer)
            .Include(s => s.AssignedTechnician)
            .Include(s => s.Region)
            .Include(s => s.Notes)
            /*
              IS EMRINDEN TEK SATIR YETER (2026-08-25, kullanici: "servis tarafi cok yavas").

              `MapToDto` bu koleksiyondan SADECE `HasWorkOrder = s.WorkOrders.Any()` uretiyor.
              Duz `Include` ise kaydin BUTUN is emirlerini cekiyordu; `AsSplitQuery` yuzunden
              bu, 1000 kayitlik sayfada ayri bir sorgu + binlerce gereksiz satir demek.
              `Take(1)` bool'u dogru uretmeye yeter, veri hacmini kayit basina 1 satira indirir.
            */
            .Include(s => s.WorkOrders.OrderBy(w => w.Id).Take(1))
            .Include(s => s.InstallationTasks).ThenInclude(it => it.AssignedTechnician)
            .Include(s => s.Items)
            .Include(s => s.Activities)
            .AsSplitQuery()
            .FirstOrDefaultAsync(s => s.Id == id);

        return service == null ? null : MapToDto(service);
    }

    public async Task<ServiceRecordDto?> GetByNumberAsync(string serviceNumber)
    {
        var service = await _context.ServiceRecords
            .Include(s => s.Customer)
            .Include(s => s.Dealer)
            .Include(s => s.AssignedTechnician)
            .Include(s => s.Region)
            .Include(s => s.Notes)
            .Include(s => s.Activities)
            .FirstOrDefaultAsync(s => s.ServiceNumber == serviceNumber);

        return service == null ? null : MapToDto(service);
    }

    /// <summary>
    /// Cari kapsamı filtresi. Gelen değer tek bir kod olabileceği gibi virgülle ayrılmış bir
    /// liste de olabilir — B2B'de bir kullanıcıya birden çok cari (hatta '*' ile hepsi)
    private static readonly System.Text.RegularExpressions.Regex DealerCodeRegex = 
        new(@"120-[0-9]{2}-[0-9]{5,6}(?:-[0-9]+)?", System.Text.RegularExpressions.RegexOptions.Compiled | System.Text.RegularExpressions.RegexOptions.IgnoreCase);

    private static string? ExtractDealerCode(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var match = DealerCodeRegex.Match(text);
        return match.Success ? match.Value : null;
    }

    /// <summary>
    /// Servis kayıtları için cari yetkisi filtresi.
    ///
    /// Plasiyer/Bayi kullanıcılarına virgülle ayrılmış birden fazla cari kodu (ör. "120-01-000570,120-01-000571")
    /// atanabiliyor. Liste tek değer gibi karşılaştırıldığında hiçbir kayıtla eşleşmiyordu.
    /// </summary>
    private static IQueryable<ServiceRecord> ApplyDealerCodeFilter(IQueryable<ServiceRecord> query, string? dealerCode)
    {
        if (string.IsNullOrWhiteSpace(dealerCode)) return query;

        var codes = dealerCode
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (codes.Length == 0) return query;
        // '*' listenin herhangi bir yerinde olabilir: teknisyenin kendi cari kodu da aynı listede.
        if (codes.Contains("*")) return query;

        var predicate = PredicateBuilder.False<ServiceRecord>();

        // Exact match on DealerCode, Dealer.DealerCode, full DealerName or CustomerName
        predicate = predicate.Or(s =>
            (s.DealerCode != null && codes.Contains(s.DealerCode)) ||
            (s.Dealer != null && s.Dealer.DealerCode != null && codes.Contains(s.Dealer.DealerCode)) ||
            (s.DealerName != null && codes.Contains(s.DealerName)) ||
            (s.CustomerName != null && codes.Contains(s.CustomerName)));

        // Substring / ILIKE match for each dealer code on DealerName and CustomerName
        // Handles "[120-01-000570] BAYİ ADI" (fatura döküm) and "BAYİ ADI (120-01-000570)" (bayi sipariş)
        foreach (var code in codes)
        {
            var c = code;
            predicate = predicate.Or(s => s.DealerName != null && EF.Functions.ILike(s.DealerName, $"%{c}%"));
            predicate = predicate.Or(s => s.CustomerName != null && EF.Functions.ILike(s.CustomerName, $"%{c}%"));
        }

        return query.Where(predicate);
    }

    public async Task<List<ServiceRecordDto>> GetAllAsync(ServiceStatus? status = null, Guid? technicianId = null, Guid? regionId = null, DateTime? plannedFrom = null, DateTime? plannedTo = null, string? dealerCode = null)
    {
        var query = _context.ServiceRecords
            .Include(s => s.Customer)
            .Include(s => s.Dealer)
            .Include(s => s.AssignedTechnician)
            .Include(s => s.Region)
            .Include(s => s.Notes)
            .Include(s => s.WorkOrders)
            .Include(s => s.InstallationTasks).ThenInclude(it => it.AssignedTechnician)
            .Include(s => s.Items)
            .AsSplitQuery()
            .AsQueryable();

        if (status.HasValue)
            query = query.Where(s => s.Status == status.Value);

        query = ApplyDealerCodeFilter(query, dealerCode);

        if (technicianId.HasValue)
        {
            var techId = technicianId.Value;
            query = query.Where(s =>
                s.AssignedTechnicianId == techId ||
                s.InstallationTasks.Any(t => t.AssignedTechnicianId == techId));
        }

        if (regionId.HasValue)
            query = query.Where(s => s.RegionId == regionId.Value);

        // TARİHLER UTC'YE ÇEVRİLMEDEN SORGUYA GİREMEZ.
        //
        // Sorgu dizesinden gelen DateTime'ın Kind'ı Unspecified'dır ve Npgsql bunu
        // `timestamp with time zone` kolonuyla karşılaştırmayı REDDEDİYOR:
        // "Cannot write DateTime with Kind=Unspecified ... only UTC is supported" → uç 500 döner.
        // Sonuç: Fatura Planlama'daki "Seçilen Gündeki İşleri" paneli her seferinde hata alıp
        // "Planlanmış görevi bulunmuyor" gösteriyordu (MONTAJ-DEVIR §8.4).
        // Kardeş metot GetPagedAsync bu dönüşümü zaten yapıyordu; ayrışma gözden kaçmıştı.
        // `RouteDate` metin ve YEREL günü tutuyor; gün dizesi bu yüzden dönüşümden ÖNCE alınır,
        // yoksa UTC kayması (00:00 yerel → önceki gün 21:00Z) rota tarihini bir gün geriye atardı.
        var routeDateStr = plannedFrom?.ToString("yyyy-MM-dd");
        if (plannedFrom.HasValue) plannedFrom = plannedFrom.Value.ToUniversalTime();
        if (plannedTo.HasValue) plannedTo = plannedTo.Value.ToUniversalTime();

        if (plannedFrom.HasValue)
        {
            var fromDate = plannedFrom.Value;
            var fromDateStr = routeDateStr!;
            if (plannedTo.HasValue)
            {
                var toDate = plannedTo.Value;
                query = query.Where(s => 
                    (s.PlannedAt >= fromDate && s.PlannedAt <= toDate) || 
                    (s.EstimatedDeliveryDate >= fromDate && s.EstimatedDeliveryDate <= toDate) ||
                    s.RouteDate == fromDateStr ||
                    s.InstallationTasks.Any(t => t.PlannedAt >= fromDate && t.PlannedAt <= toDate
                                                 && !InstallationTaskStatusSets.Unplanned.Contains(t.Status))
                );
            }
            else
            {
                query = query.Where(s => 
                    s.PlannedAt >= fromDate || 
                    s.EstimatedDeliveryDate >= fromDate ||
                    s.RouteDate == fromDateStr ||
                    s.InstallationTasks.Any(t => t.PlannedAt >= fromDate
                                                 && !InstallationTaskStatusSets.Unplanned.Contains(t.Status))
                );
            }
        }
        else if (plannedTo.HasValue)
        {
            query = query.Where(s => 
                s.PlannedAt <= plannedTo.Value ||
                s.EstimatedDeliveryDate <= plannedTo.Value ||
                s.InstallationTasks.Any(t => t.PlannedAt <= plannedTo.Value
                                             && !InstallationTaskStatusSets.Unplanned.Contains(t.Status))
            );
        }

        var services = await query.OrderByDescending(s => s.CreatedAt).ToListAsync();
        return services.Select(MapToDto).ToList();
    }

    public async Task<PagedResultDto<ServiceRecordDto>> GetPagedAsync(ServiceRecordQueryDto queryDto)
    {
        /*
          LİSTE SORGUSU — HIZ (2026-08-24, kullanıcı bildirimi: "servis genelinde tablolar
          aşırı yavaş geliyor, sunucu durmuş durumda").

          İki pahalı şey vardı:

          1. `Include(s => s.Activities)` — kaydın BÜTÜN işlem geçmişi çekiliyordu: her durum
             değişikliği, her not, her atama. Oysa `MapToDto` bu koleksiyondan yalnızca
             `PhotoUploaded` olaylarını okuyor (fotoğraf adresleri için); geri kalanı
             yüklenip atılıyordu. Süzgeçli Include ile yalnızca gereken satırlar geliyor.
             Eski kayıtlarda olay sayısı zamanla büyüdüğü için bu, en çok büyüyen maliyetti.

          2. İZLEME AÇIKTI. Liste salt okunur ama EF her kaydı ve bütün alt nesnelerini
             (notlar, kalemler, görevler, olaylar) değişiklik izleyicisine alıyordu; 500-1000
             kayıtlık sayfada bu on binlerce nesne demek.

          `AsNoTrackingWithIdentityResolution` seçildi, düz `AsNoTracking` DEĞİL: bölünmüş
          sorguda (`AsSplitQuery`) kimlik çözümlemesi olmadan aynı üst kayıt birden çok
          parçada tekrarlanabiliyor ve koleksiyonlar yanlış dolabiliyor. Kimlik çözümlemeli
          hâli izleme maliyetini kaldırır ama nesne grafiğini doğru kurar.
        */
        var query = _context.ServiceRecords
            .Include(s => s.Customer)
            .Include(s => s.Dealer)
            .Include(s => s.AssignedTechnician)
            .Include(s => s.Region)
            /*
              NOTLARDAN YALNIZ SONUNCUSU (2026-10-05, "servis genel olarak çok yavaş"). Listede
              notlar yalnız `LastAction` (en son not) için okunuyor; düz Include her kaydın BÜTÜN
              notlarını çekiyordu ve eski kayıtlarda not sayısı durmadan büyüyor.
            */
            .Include(s => s.Notes.OrderByDescending(n => n.CreatedAt).Take(1))
            /*
              İŞ EMRİNDEN TEK SATIR YETER (2026-09-18) — `GetByIdAsync`'teki ile aynı gerekçe.
              `MapToDto` bu koleksiyondan yalnız `HasWorkOrder = Any()` üretiyor; düz Include
              ise kaydın BÜTÜN iş emirlerini çekiyordu. 5000 kayıtlık sayfada bu, ayrı bir
              sorguda on binlerce gereksiz satır demek.
            */
            .Include(s => s.WorkOrders.OrderBy(w => w.Id).Take(1))
            .Include(s => s.InstallationTasks).ThenInclude(it => it.AssignedTechnician)
            .Include(s => s.Items)
            .Include(s => s.Activities.Where(a => a.Type == ActivityType.PhotoUploaded))
            .AsSplitQuery()
            .AsNoTrackingWithIdentityResolution()
            .AsQueryable();

        if (queryDto.Status.HasValue && string.IsNullOrWhiteSpace(queryDto.Q))
            query = query.Where(s => s.Status == queryDto.Status.Value);

        if (!string.IsNullOrWhiteSpace(queryDto.Statuses) && string.IsNullOrWhiteSpace(queryDto.Q))
        {
            var statusStrings = queryDto.Statuses.Split(',', StringSplitOptions.RemoveEmptyEntries);
            var parsedStatuses = statusStrings
                .Where(s => Enum.TryParse<ServiceStatus>(s, true, out _))
                .Select(s => Enum.Parse<ServiceStatus>(s, true))
                .ToList();
            if (parsedStatuses.Any())
            {
                query = query.Where(s => parsedStatuses.Contains(s.Status));
            }
        }
        if (queryDto.Type.HasValue)
            query = query.Where(s => s.Type == queryDto.Type.Value);
        if (!string.IsNullOrWhiteSpace(queryDto.Category))
        {
            var catLower = queryDto.Category.Trim().ToLowerInvariant();
            // "Küçük ürün" iki kaynaktan okunur ve İKİ SÜZGEÇ BİRBİRİNİN TÜMLEYENİ OLMALIDIR.
            // Kolon eklendiğinde varsayılanı Large olduğu için "large" dalını
            // `ProductCategory == Large || !AT-` diye yazmak bütün eski atölye kayıtlarını da
            // büyük ürün listesine sokuyordu (OR'un sol tarafı onlar için de doğru).
            // Migration eski kayıtları backfill ediyor; buradaki önek kontrolü, kategoriyi hiç
            // göndermeyen ekranlardan gelen yeni kayıtlar için emniyet payı olarak duruyor.
            if (catLower == "large" || catLower == "buyuk")
            {
                query = query.Where(s => s.ProductCategory != ProductCategory.Small && !s.ServiceNumber.StartsWith("AT-"));
            }
            else if (catLower == "small" || catLower == "kucuk")
            {
                query = query.Where(s => s.ProductCategory == ProductCategory.Small || s.ServiceNumber.StartsWith("AT-"));
            }
        }
        /*
          PASİF KAYITLAR (2026-08-23, kullanıcı isteği).

          90 günden eski kayıtlar varsayılan listede görünmez. Eski sistemden aktarılan
          834 kaydın bir kısmı 2023'e kadar gidiyor ve kabul/planlama ekranlarını doldurup
          günlük işi görünmez hâle getiriyordu.

          İKİ İSTİSNA:
           - `IncludePassive` işaretliyse (ekrandaki "Pasife Alınanları Göster" kutusu) hepsi gelir.
           - ARAMA yapılıyorsa süzgeç uygulanmaz: kullanıcı elindeki eski kağıt fişin numarasını
             aradığında kaydı bulamamak, listeyi kısaltmaktan çok daha kötü.

          Ölçü `CreatedAt` — ekranda "Geçen Gün" sütununun saydığı tarihin aynısı, dolayısıyla
          kullanıcı hangi kaydın neden düştüğünü listede görebiliyor.
        */
        if (!queryDto.IncludePassive && string.IsNullOrWhiteSpace(queryDto.Q))
        {
            var passiveCutoff = DateTime.UtcNow.AddDays(-PassiveAfterDays);
            query = query.Where(s => s.CreatedAt >= passiveCutoff);
        }

        query = ApplyDealerCodeFilter(query, queryDto.DealerCode);
        if (!string.IsNullOrWhiteSpace(queryDto.InstallationType))
        {
            if (queryDto.InstallationType == "Bayi")
            {
                query = query.Where(s => s.InstallationType == "Bayi" || string.IsNullOrEmpty(s.InstallationType));
            }
            else
            {
                query = query.Where(s => s.InstallationType == queryDto.InstallationType);
            }
        }
        if (queryDto.TechnicianId.HasValue)
        {
            var techId = queryDto.TechnicianId.Value;
            query = query.Where(s =>
                s.AssignedTechnicianId == techId ||
                s.InstallationTasks.Any(t => t.AssignedTechnicianId == techId));
        }
        if (queryDto.RegionId.HasValue)
            query = query.Where(s => s.RegionId == queryDto.RegionId.Value);

        if (queryDto.DateFrom.HasValue)
            query = query.Where(s => s.CreatedAt >= queryDto.DateFrom.Value.Date.ToUniversalTime());

        if (queryDto.DateTo.HasValue)
        {
            // BİTİŞ GÜNÜ DAHİL. İstemci 'YYYY-MM-DD' gönderiyor, bu da gece yarısına bağlanıyordu;
            // `CreatedAt <= 00:00` o günün bütün kayıtlarını dışarıda bırakıyordu. "Bugünden
            // bugüne" süzmek bu yüzden her zaman boş liste veriyordu.
            var endExclusive = queryDto.DateTo.Value.Date.AddDays(1).ToUniversalTime();
            query = query.Where(s => s.CreatedAt < endExclusive);
        }

        if (!string.IsNullOrWhiteSpace(queryDto.PlannedDate))
        {
            var pDateStr = queryDto.PlannedDate.Trim();
            if (DateTime.TryParse(pDateStr, out var parsedDate))
            {
                var dayStart = parsedDate.Date.ToUniversalTime();
                var dayEnd = dayStart.AddDays(1);
                query = query.Where(s =>
                    (s.PlannedAt.HasValue && s.PlannedAt.Value >= dayStart && s.PlannedAt.Value < dayEnd) ||
                    (s.EstimatedDeliveryDate.HasValue && s.EstimatedDeliveryDate.Value >= dayStart && s.EstimatedDeliveryDate.Value < dayEnd) ||
                    (s.RouteDate != null && s.RouteDate == pDateStr) ||
                    s.InstallationTasks.Any(t => t.PlannedAt.HasValue && t.PlannedAt.Value >= dayStart && t.PlannedAt.Value < dayEnd));
            }
        }
        else
        {
            if (queryDto.PlannedFrom.HasValue)
            {
                var pFrom = queryDto.PlannedFrom.Value.ToUniversalTime();
                query = query.Where(s =>
                    (s.PlannedAt.HasValue && s.PlannedAt >= pFrom) ||
                    (s.EstimatedDeliveryDate.HasValue && s.EstimatedDeliveryDate >= pFrom) ||
                    s.InstallationTasks.Any(t => t.PlannedAt.HasValue && t.PlannedAt >= pFrom
                                                 && !InstallationTaskStatusSets.Unplanned.Contains(t.Status)));
            }
            if (queryDto.PlannedTo.HasValue)
            {
                var pTo = queryDto.PlannedTo.Value.ToUniversalTime();
                query = query.Where(s =>
                    (s.PlannedAt.HasValue && s.PlannedAt <= pTo) ||
                    (s.EstimatedDeliveryDate.HasValue && s.EstimatedDeliveryDate <= pTo) ||
                    s.InstallationTasks.Any(t => t.PlannedAt.HasValue && t.PlannedAt <= pTo
                                                 && !InstallationTaskStatusSets.Unplanned.Contains(t.Status)));
            }
        }

        if (queryDto.SatisfactionScore.HasValue)
        {
            if (queryDto.SatisfactionScore == 0)
                query = query.Where(s => s.SatisfactionScore == null);
            else
                query = query.Where(s => s.SatisfactionScore == queryDto.SatisfactionScore.Value);
        }

        var q = (queryDto.Q ?? string.Empty).Trim();
        if (!string.IsNullOrWhiteSpace(q))
        {
            var qLower = q.ToLower();
            var matchedStatuses = new List<ServiceStatus>();
            if (qLower.Contains("yeni")) matchedStatuses.Add(ServiceStatus.New);
            if (qLower.Contains("plan") || qLower.Contains("rota")) matchedStatuses.Add(ServiceStatus.Planned);
            if (qLower.Contains("atölye") || qLower.Contains("atolye")) matchedStatuses.Add(ServiceStatus.Workshop);
            if (qLower.Contains("tamir")) matchedStatuses.Add(ServiceStatus.InRepair);
            if (qLower.Contains("parça") || qLower.Contains("parca") || qLower.Contains("bekliyor")) matchedStatuses.Add(ServiceStatus.WaitingForParts);
            if (qLower.Contains("hazır") || qLower.Contains("hazir") || qLower.Contains("gerçekleş") || qLower.Contains("gercekles")) matchedStatuses.Add(ServiceStatus.Ready);
            if (qLower.Contains("teslim")) matchedStatuses.Add(ServiceStatus.Delivered);
            if (qLower.Contains("iptal")) matchedStatuses.Add(ServiceStatus.Cancelled);
            if (qLower.Contains("ertel")) matchedStatuses.Add(ServiceStatus.Delayed);

            query = query.Where(s =>
                (s.ServiceNumber != null && s.ServiceNumber.ToLower().Contains(qLower)) ||
                // Kağıt fişle gelen müşterinin kaydı elindeki numaradan bulunabilsin —
                // alanın var olma sebebi bu.
                (s.ManualReceiptNo != null && s.ManualReceiptNo.ToLower().Contains(qLower)) ||
                (s.CustomerName != null && s.CustomerName.ToLower().Contains(qLower)) ||
                (s.CustomerPhone != null && s.CustomerPhone.ToLower().Contains(qLower)) ||
                (s.CustomerAddress != null && s.CustomerAddress.ToLower().Contains(qLower)) ||
                (s.ProductName != null && s.ProductName.ToLower().Contains(qLower)) ||
                (s.SerialNumber != null && s.SerialNumber.ToLower().Contains(qLower)) ||
                (s.DealerName != null && s.DealerName.ToLower().Contains(qLower)) ||
                matchedStatuses.Contains(s.Status)
            );
        }

        /*
          ÜST SINIR 200'DEN 2000'E (2026-08-23).

          Kabul/atölye/planlama ekranları listeyi İSTEMCİDE süzüyor ve sayfalıyor (kolon
          süzgeçleri sunucuya gitmiyor). Sunucu sayfa başına kesince o ekranlarda hem sayfa
          gezinme hem de kolon süzgeci YALAN söylüyor: kullanıcı "834 kayıt aktardım" diyor
          ama ekran ilk sayfadan ötesini hiç görmüyor, süzgeç de yalnız o sayfayı arıyor.

          Kesin çözüm bu ekranları sunucu tarafı süzgeç+sayfalamaya geçirmek; o daha büyük bir
          iş. Bu arada sınır, tek firmanın gerçek kayıt hacmini karşılayacak kadar yükseltildi.
          Sınır KALDIRILMADI: sınırsız istek tek sorguda bütün tabloyu çekebilir.
        */
        // ÜST SINIR 5000 (2026-09-18 kullanıcı isteği). Montaj Geçmişi defterin TAMAMINI
        // istiyor; 2000'lik sınır eski numaralı kayıtları listeden düşürüyordu. Maliyeti
        // dengelemek için sorgu sadeleştirildi (bkz. WorkOrders Take(1)).
        var pageSize = queryDto.PageSize <= 0 ? 20 : Math.Min(queryDto.PageSize, 5000);
        var page = queryDto.Page <= 0 ? 1 : queryDto.Page;

        var totalCount = await query.CountAsync();
        var totalPages = (int)Math.Ceiling(totalCount / (double)pageSize);

        // Menü rozetleri yalnız sayıyı istiyor (bkz. ServiceRecordQueryDto.CountOnly).
        if (queryDto.CountOnly)
        {
            return new PagedResultDto<ServiceRecordDto>
            {
                Items = new List<ServiceRecordDto>(),
                Page = page,
                PageSize = pageSize,
                TotalCount = totalCount,
                TotalPages = totalPages
            };
        }

        var items = await query
            .OrderByDescending(s => s.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        var dtos = items.Select(MapToDto).ToList();
        await FillWorkshopEnteredAtAsync(dtos);

        return new PagedResultDto<ServiceRecordDto>
        {
            Items = dtos,
            Page = page,
            PageSize = pageSize,
            TotalCount = totalCount,
            TotalPages = totalPages
        };
    }

    /// <summary>Atölye sayacını başlatan durumlar: ürün fiziken atölyede.</summary>
    private static readonly ServiceStatus[] WorkshopStatuses =
        { ServiceStatus.Workshop, ServiceStatus.InRepair, ServiceStatus.WaitingForParts };

    /// <summary>
    /// <see cref="ServiceRecordDto.WorkshopEnteredAt"/>'i doldurur: kaydın durumunun İLK kez
    /// atölye durumlarından birine geçtiği an, işlem geçmişindeki durum olaylarından.
    ///
    /// `Payload` kolonu JSONB: veritabanı metni yeniden biçimlendiriyor (`"newValue": "Workshop"`,
    /// iki noktadan sonra boşlukla), yani metin araması yazıldığı biçimi tutturamaz. Bu yüzden
    /// JSONB kapsama (`@>`) kullanılıyor; `field = Status` şartı kalem/görev durumlarını
    /// (`InstallationTask.{id}.Status`) dışarıda bırakır. Tek sorgu, sayfadaki bütün kayıtlar için.
    ///
    /// GEÇMİŞİ OLMAYAN KAYIT: eski sistemden aktarılan kayıtların durum olayı yok. Şu an atölye
    /// durumundaysa açılış anı esas alınır — "atölyeye girmedi" demek yanlış olurdu.
    /// </summary>
    private async Task FillWorkshopEnteredAtAsync(List<ServiceRecordDto> dtos)
    {
        if (dtos.Count == 0) return;

        var ids = dtos.Select(d => d.Id).ToList();
        var j0 = $"{{\"field\":\"Status\",\"newValue\":\"{WorkshopStatuses[0]}\"}}";
        var j1 = $"{{\"field\":\"Status\",\"newValue\":\"{WorkshopStatuses[1]}\"}}";
        var j2 = $"{{\"field\":\"Status\",\"newValue\":\"{WorkshopStatuses[2]}\"}}";

        /*
          Sayaç yardımcı bilgi: sorgusu ne sebeple olursa olsun düşerse (ör. kolon tipi beklenenden
          farklı bir firma veritabanı) LİSTE DÜŞMEMELİ. O durumda sayaç yalnız bugünkü duruma bakar.
        */
        Dictionary<Guid, DateTime> ilkGirisler;
        try
        {
            ilkGirisler = await _context.Activities
            .AsNoTracking()
            .Where(a => ids.Contains(a.ServiceId)
                        && a.Type == ActivityType.StatusChanged
                        && (EF.Functions.JsonContains(a.Payload, j0)
                            || EF.Functions.JsonContains(a.Payload, j1)
                            || EF.Functions.JsonContains(a.Payload, j2)))
            .GroupBy(a => a.ServiceId)
            .Select(g => new { ServiceId = g.Key, Ilk = g.Min(a => a.CreatedAt) })
            .ToDictionaryAsync(x => x.ServiceId, x => x.Ilk);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[WorkshopEnteredAt] atölye giriş tarihleri okunamadı: {ex.Message}");
            ilkGirisler = new Dictionary<Guid, DateTime>();
        }

        foreach (var dto in dtos)
        {
            if (ilkGirisler.TryGetValue(dto.Id, out var ilk))
                dto.WorkshopEnteredAt = ilk;
            else if (WorkshopStatuses.Contains(dto.Status))
                dto.WorkshopEnteredAt = dto.CreatedAt;
        }
    }

    public async Task<ServiceRecordDto> CreateAsync(CreateServiceRecordDto dto, string? performerName = null)
    {
        var planned = dto.PlannedDate ?? dto.EstimatedDeliveryDate;
        var dealerCode = dto.DealerCode;
        if (string.IsNullOrWhiteSpace(dealerCode))
        {
            dealerCode = ExtractDealerCode(dto.DealerName) ?? ExtractDealerCode(dto.CustomerName);
        }
        var service = new ServiceRecord
        {
            Id = Guid.NewGuid(),
            ServiceNumber = await GenerateServiceNumber(dto.Type, dto.ProductName, dto.Category),
            // Kağıt fiş numarası: boş bırakılabilir, kırpılır (kullanıcı boşlukla giriyor).
            ManualReceiptNo = string.IsNullOrWhiteSpace(dto.ManualReceiptNo) ? null : dto.ManualReceiptNo.Trim(),
            Type = dto.Type,
            Status = ServiceStatus.New,
            CustomerId = dto.CustomerId,
            CustomerName = dto.CustomerName,
            CustomerPhone = dto.CustomerPhone,
            CustomerEmail = dto.CustomerEmail,
            CustomerAddress = dto.CustomerAddress,
            ProductName = dto.ProductName,
            ProductStockCode = dto.ProductStockCode,
            ProductModel = dto.ProductModel,
            SerialNumber = dto.SerialNumber,
            IsUnderWarranty = dto.IsUnderWarranty,
            // Garanti yoksa tarih de yok: "Hayır" yazan satırın altında tarih görünmesin.
            PurchaseDate = dto.IsUnderWarranty ? ParseWarrantyStartDate(dto.WarrantyStartDate) : null,
            PickupSourceId = dto.PickupSourceId,
            DealerId = dto.DealerId,
            DealerName = dto.DealerName,
            DealerCode = dealerCode,
            DealerPhone = dto.DealerPhone,
            DealerAddress = dto.DealerAddress,
            ProblemDescription = dto.ProblemDescription,
            ReceivingNote = dto.ReceivingNote,
            Priority = dto.Priority,
            RegionId = dto.RegionId,
            EstimatedDeliveryDate = planned,
            PlannedAt = planned,
            AssignedTechnicianId = dto.TechnicianId,
            InstallationType = dto.InstallationType,
            ProductCategory = string.Equals(dto.Category, "small", StringComparison.OrdinalIgnoreCase)
                ? ProductCategory.Small
                : ProductCategory.Large,
            CreatedAt = DateTime.UtcNow
        };

        if (!string.IsNullOrWhiteSpace(service.CustomerAddress))
        {
            var coords = await _geocodingService.GetCoordinatesAsync(service.CustomerAddress);
            if (coords != null)
            {
                service.Latitude = coords.Value.lat;
                service.Longitude = coords.Value.lon;
                
                if (!service.RegionId.HasValue)
                {
                    service.RegionId = await GetClosestRegionIdAsync(coords.Value.lat, coords.Value.lon);
                }
            }
        }

        _context.ServiceRecords.Add(service);

        foreach (var item in BuildItems(dto, service.Id))
        {
            _context.ServiceRecordItems.Add(item);
        }

        var actorName = !string.IsNullOrWhiteSpace(performerName) ? performerName : "Servis Kabul";
        _context.Activities.Add(new Activity
        {
            ServiceId = service.Id,
            Type = ActivityType.StatusChanged,
            ActorUserName = actorName,
            Payload = System.Text.Json.JsonSerializer.Serialize(new
            {
                field = "Status",
                oldValue = (string?)null,
                newValue = service.Status.ToString(),
                reason = "İlk Ürün Kabulü Yapıldı",
                performedBy = actorName
            }),
            CreatedAt = service.CreatedAt
        });

        await _context.SaveChangesAsync();

        var created = await _context.ServiceRecords
            .Include(s => s.Region)
            .Include(s => s.Items)
            .FirstOrDefaultAsync(s => s.Id == service.Id);

        return MapToDto(created ?? service);
    }

    /// <summary>
    /// Gelen kalemleri normalize eder. Kalem gönderilmediyse kaydın kendi ürün alanlarından
    /// tek kalem üretir — böylece kalem kavramını bilmeyen eski istemciler de çalışır.
    /// </summary>
    private static List<ServiceRecordItem> BuildItems(CreateServiceRecordDto dto, Guid serviceId)
    {
        var now = DateTime.UtcNow;
        var source = (dto.Items ?? new List<CreateServiceRecordItemDto>())
            .Where(x => !string.IsNullOrWhiteSpace(x.ProductName))
            .ToList();

        if (source.Count == 0)
        {
            return new List<ServiceRecordItem>
            {
                new()
                {
                    ServiceId = serviceId,
                    ProductName = dto.ProductName,
                    ProductStockCode = dto.ProductStockCode,
                    SerialNumber = dto.SerialNumber,
                    Quantity = 1,
                    SortOrder = 0,
                    CreatedAt = now,
                    UpdatedAt = now
                }
            };
        }

        return source.Select((x, index) => new ServiceRecordItem
        {
            ServiceId = serviceId,
            ProductName = x.ProductName.Trim(),
            ProductStockCode = x.ProductStockCode,
            SerialNumber = x.SerialNumber,
            Quantity = Math.Max(1, x.Quantity),
            Notes = x.Notes,
            ExternalRef = string.IsNullOrWhiteSpace(x.ExternalRef) ? null : x.ExternalRef.Trim(),
            CustomerName = x.CustomerName,
            CustomerPhone = x.CustomerPhone,
            CustomerAddress = x.CustomerAddress,
            SortOrder = index,
            CreatedAt = now,
            UpdatedAt = now
        }).ToList();
    }

    public async Task<ServiceRecordDto?> UpdateAsync(Guid id, CreateServiceRecordDto dto)
    {
        var service = await _context.ServiceRecords.FindAsync(id);
        if (service == null) return null;

        /*
          KAĞIT FİŞ NUMARASI — NULL "DOKUNMA" DEMEK.

          Bu uç düzenleme formunun tamamını taşıyor; alanı hiç göndermeyen eski çağıranlar
          (mobil, montaj ekranı) boş gönderdiğinde girilmiş numarayı SİLERDİ. Boş string
          bilerek "temizle" sayılıyor: kullanıcı alanı silip kaydettiğinde numara gitmeli.
        */
        if (dto.ManualReceiptNo != null)
        {
            service.ManualReceiptNo = string.IsNullOrWhiteSpace(dto.ManualReceiptNo) ? null : dto.ManualReceiptNo.Trim();
        }

        service.CustomerName = dto.CustomerName;
        service.CustomerPhone = dto.CustomerPhone;
        service.CustomerEmail = dto.CustomerEmail;
        service.CustomerAddress = dto.CustomerAddress;
        var oncekiUrunAdi = service.ProductName;
        var oncekiStokKodu = service.ProductStockCode;
        var oncekiSeriNo = service.SerialNumber;
        service.ProductName = dto.ProductName;
        service.ProductStockCode = dto.ProductStockCode;
        service.ProductModel = dto.ProductModel;
        service.SerialNumber = dto.SerialNumber;
        service.IsUnderWarranty = dto.IsUnderWarranty;

        // null = alanı bilmeyen istemci, dokunma.
        if (dto.PickupSourceId.HasValue) service.PickupSourceId = dto.PickupSourceId;

        // Garanti kaldırıldıysa tarih de düşer — alan gönderilmemiş olsa bile. Aksi hâlde
        // "Garanti: Hayır" satırının altında eski bir tarih asılı kalırdı.
        if (!dto.IsUnderWarranty)
        {
            service.PurchaseDate = null;
        }
        else if (dto.WarrantyStartDate != null)
        {
            // null = alanı bilmeyen istemci, dokunma. Boş metin = kullanıcı sildi, temizle.
            service.PurchaseDate = ParseWarrantyStartDate(dto.WarrantyStartDate);
        }
        var updatedDealerCode = dto.DealerCode;
        if (string.IsNullOrWhiteSpace(updatedDealerCode))
        {
            updatedDealerCode = ExtractDealerCode(dto.DealerName) ?? ExtractDealerCode(dto.CustomerName) ?? service.DealerCode;
        }
        service.DealerId = dto.DealerId;
        service.DealerName = dto.DealerName;
        service.DealerCode = updatedDealerCode;
        service.DealerPhone = dto.DealerPhone;
        service.DealerAddress = dto.DealerAddress;
        service.InstallationType = dto.InstallationType;
        service.ProblemDescription = dto.ProblemDescription;
        service.ReceivingNote = dto.ReceivingNote;
        service.Priority = dto.Priority;
        service.RegionId = dto.RegionId;
        service.EstimatedDeliveryDate = dto.PlannedDate ?? dto.EstimatedDeliveryDate;
        service.PlannedAt = service.EstimatedDeliveryDate;
        if (!string.IsNullOrEmpty(dto.Category))
        {
            service.ProductCategory = string.Equals(dto.Category, "small", StringComparison.OrdinalIgnoreCase)
                ? ProductCategory.Small
                : ProductCategory.Large;
        }
        service.UpdatedAt = DateTime.UtcNow;

        if (!string.IsNullOrWhiteSpace(service.CustomerAddress))
        {
            var coords = await _geocodingService.GetCoordinatesAsync(service.CustomerAddress);
            if (coords != null)
            {
                service.Latitude = coords.Value.lat;
                service.Longitude = coords.Value.lon;

                if (!service.RegionId.HasValue)
                {
                    service.RegionId = await GetClosestRegionIdAsync(coords.Value.lat, coords.Value.lon);
                }
            }
        }

        await SyncItemsAsync(service.Id, dto);

        /*
          TEK ÜRÜNLÜ KAYITTA KALEM DE GÜNCELLENİR (2026-10-14 canlı bildirim, SH-0001234: "ürünü
          güncelledim, servis fişi hâlâ eskisi gibi basıyor").
          Fişin ürün tablosu KALEMLERDEN basılıyor. Arıza düzenleme ekranı kalem göndermiyor
          (dto.Items null = kalemlere dokunma), bu yüzden kaydın ürünü değişiyor, tek kalemi eski
          ürünü taşımaya devam ediyordu. Kural dar: kalem listesi gönderilmediyse, kayıtta TEK
          (iptal edilmemiş) kalem varsa, o kalem kaydın ESKİ ürünüyle eşleşiyorsa ve faturadan
          gelmiyorsa ürün adı / stok kodu / seri no kayıttakiyle eşitlenir. Çok kalemli montaj
          kayıtlarına dokunulmaz.
        */
        if (dto.Items is null)
        {
            var tekKalem = await _context.ServiceRecordItems
                .Where(i => i.ServiceId == service.Id && i.CancelledAt == null)
                .ToListAsync();
            if (tekKalem.Count == 1 && tekKalem[0].ExternalRef == null)
            {
                var k = tekKalem[0];
                var eskiyleEsles = string.Equals((k.ProductName ?? "").Trim(), (oncekiUrunAdi ?? "").Trim(), StringComparison.OrdinalIgnoreCase)
                    || (!string.IsNullOrWhiteSpace(k.ProductStockCode)
                        && string.Equals(k.ProductStockCode.Trim(), (oncekiStokKodu ?? "").Trim(), StringComparison.OrdinalIgnoreCase));
                // Arıza / bakım / garanti kaydı TEK ürünlüdür: kalem her zaman kayda uyar — daha önce
                // ayrışmış kayıtlar da (canlı SH-0001234) bir kez kaydedilince düzelir. Montajda yalnız
                // eski ürünle eşleşen kalem güncellenir.
                if ((eskiyleEsles || service.Type != ServiceType.Installation) && !string.IsNullOrWhiteSpace(service.ProductName))
                {
                    k.ProductName = service.ProductName.Trim();
                    k.ProductStockCode = service.ProductStockCode;
                    if (string.IsNullOrWhiteSpace(k.SerialNumber)
                        || string.Equals(k.SerialNumber?.Trim(), (oncekiSeriNo ?? "").Trim(), StringComparison.OrdinalIgnoreCase))
                    {
                        k.SerialNumber = service.SerialNumber;
                    }
                    k.UpdatedAt = DateTime.UtcNow;
                }
            }
        }

        await _context.SaveChangesAsync();

        var updated = await _context.ServiceRecords
            .Include(s => s.Region)
            .Include(s => s.Items)
            .FirstOrDefaultAsync(s => s.Id == service.Id);

        return MapToDto(updated ?? service);
    }

    /// <summary>
    /// Kalemleri gelen listeye göre eşitler. dto.Items null ise hiç dokunmaz — kalem kavramını
    /// kullanmayan ekranların (ürün kabul vb.) güncellemesi kalemleri silmesin diye.
    /// Planlanmış bir kalem silinemez; önce planının kaldırılması gerekir.
    /// </summary>
    private async Task SyncItemsAsync(Guid serviceId, CreateServiceRecordDto dto)
    {
        if (dto.Items is null) return;

        var incoming = dto.Items.Where(x => !string.IsNullOrWhiteSpace(x.ProductName)).ToList();
        if (incoming.Count == 0) return;

        var now = DateTime.UtcNow;
        var existing = await _context.ServiceRecordItems
            .Where(i => i.ServiceId == serviceId)
            .ToListAsync();

        var keptIds = incoming.Where(x => x.Id.HasValue).Select(x => x.Id!.Value).ToHashSet();
        var removed = existing.Where(i => !keptIds.Contains(i.Id)).ToList();

        if (removed.Count > 0)
        {
            var removedIds = removed.Select(i => i.Id).ToList();
            var blocked = await _context.InstallationTasks
                .Where(t => removedIds.Contains(t.ServiceRecordItemId!.Value)
                            && t.Status != InstallationTaskStatus.Deferred
                            && t.Status != InstallationTaskStatus.Cancelled)
                .AnyAsync();

            if (blocked)
            {
                throw new InvalidOperationException(
                    "Planlanmış bir kalem silinemez. Önce ilgili planlama satırlarını kaldırın.");
            }

            var orphanTasks = await _context.InstallationTasks
                .Where(t => removedIds.Contains(t.ServiceRecordItemId!.Value))
                .ToListAsync();
            _context.InstallationTasks.RemoveRange(orphanTasks);
            _context.ServiceRecordItems.RemoveRange(removed);
        }

        var byId = existing.ToDictionary(i => i.Id);
        for (var index = 0; index < incoming.Count; index++)
        {
            var incomingItem = incoming[index];
            if (incomingItem.Id.HasValue && byId.TryGetValue(incomingItem.Id.Value, out var current))
            {
                var newQuantity = Math.Max(1, incomingItem.Quantity);
                var newProductName = incomingItem.ProductName.Trim();

                // Faturadan gelen kalemde ürün ve miktar KAYNAK faturaya aittir; burada
                // değiştirilirse fatura yeniden kaydedildiğinde webhook geri yazar ve iki taraf
                // birbirini tutmaz. `UpdateItem` bunu zaten engelliyordu; kayıt seviyesindeki bu
                // yol açık kalmıştı ve aynı değişikliği sessizce geçiriyordu.
                if (current.ExternalRef != null
                    && (newQuantity != current.Quantity || newProductName != current.ProductName))
                {
                    throw new InvalidOperationException(
                        "Bu kalem faturadan geldiği için ürünü ve miktarı buradan değiştirilemez. Lütfen faturanızdan düzenleyin.");
                }

                // Miktar planlanmış satır sayısının altına indirilemez: aksi halde kalem "2 adet"
                // derken altında 5 planlanmış iş satırı kalırdı.
                if (newQuantity < current.Quantity)
                {
                    var plannedQty = await _context.InstallationTasks
                        .Where(t => t.ServiceRecordItemId == current.Id
                                    && t.Status != InstallationTaskStatus.Deferred
                                    && t.Status != InstallationTaskStatus.Cancelled)
                        .SumAsync(t => t.Quantity);

                    if (newQuantity < plannedQty)
                    {
                        throw new InvalidOperationException(
                            $"'{current.ProductName}' kaleminin miktarı {plannedQty} adedin altına indirilemez: bu kadarı zaten planlanmış.");
                    }

                    // Fazla kalan "Yeni Kayıt" satırlarını kaldır. `EnsureDeferredTasksForItemsAsync`
                    // yalnızca EKSİK adedi tamamlar, fazlasını hiç silmez — temizlenmezse miktar
                    // düşürülen kalem planlamada eski adediyle görünmeye devam ederdi.
                    var surplus = newQuantity - plannedQty;
                    var deferred = await _context.InstallationTasks
                        .Where(t => t.ServiceRecordItemId == current.Id
                                    && t.Status == InstallationTaskStatus.Deferred)
                        .OrderByDescending(t => t.CreatedAt)
                        .ToListAsync();

                    var toRemove = deferred.Skip(Math.Max(0, surplus)).ToList();
                    if (toRemove.Count > 0) _context.InstallationTasks.RemoveRange(toRemove);
                }

                current.ProductName = newProductName;
                current.ProductStockCode = incomingItem.ProductStockCode;
                current.SerialNumber = incomingItem.SerialNumber;
                current.Quantity = newQuantity;
                current.Notes = incomingItem.Notes;
                current.SortOrder = index;
                current.UpdatedAt = now;
                continue;
            }

            _context.ServiceRecordItems.Add(new ServiceRecordItem
            {
                ServiceId = serviceId,
                ProductName = incomingItem.ProductName.Trim(),
                ProductStockCode = incomingItem.ProductStockCode,
                SerialNumber = incomingItem.SerialNumber,
                Quantity = Math.Max(1, incomingItem.Quantity),
                Notes = incomingItem.Notes,
                ExternalRef = string.IsNullOrWhiteSpace(incomingItem.ExternalRef) ? null : incomingItem.ExternalRef.Trim(),
                CustomerName = incomingItem.CustomerName,
                CustomerPhone = incomingItem.CustomerPhone,
                CustomerAddress = incomingItem.CustomerAddress,
                SortOrder = index,
                CreatedAt = now,
                UpdatedAt = now
            });
        }
    }

    private async Task<Guid?> GetClosestRegionIdAsync(double lat, double lon)
    {
        var regions = await _context.Regions
            .Where(r => r.IsActive && r.CenterLatitude != null && r.CenterLongitude != null)
            .ToListAsync();

        if (!regions.Any()) return null;

        Region? closestRegion = null;
        double minDistance = double.MaxValue;

        foreach (var region in regions)
        {
            var distance = CalculateHaversineDistance(lat, lon, region.CenterLatitude!.Value, region.CenterLongitude!.Value);
            if (distance < minDistance)
            {
                minDistance = distance;
                closestRegion = region;
            }
        }

        return closestRegion?.Id;
    }

    private static double CalculateHaversineDistance(double lat1, double lon1, double lat2, double lon2)
    {
        var R = 6371; // Earth radius in kilometers
        var dLat = ToRadians(lat2 - lat1);
        var dLon = ToRadians(lon2 - lon1);

        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                Math.Cos(ToRadians(lat1)) * Math.Cos(ToRadians(lat2)) *
                Math.Sin(dLon / 2) * Math.Sin(dLon / 2);

        var c = 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
        return R * c;
    }

    private static double ToRadians(double angle) => Math.PI * angle / 180.0;

    public async Task<bool> DeleteAsync(Guid id)
    {
        var service = await _context.ServiceRecords.FindAsync(id);
        if (service == null) return false;

        _context.ServiceRecords.Remove(service);
        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<ServiceRecordDto?> UpdateStatusAsync(Guid id, UpdateServiceStatusDto dto)
    {
        _context.ChangeTracker.Clear();

        var service = await _context.ServiceRecords.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id);
        if (service == null) return null;

        // Aktarımı geri alma yolundan gelindiyse aşağıdaki "sahaya aktar" bloğu ÇALIŞMAMALI:
        // kayıt hâlâ sahada iş taşıdığı için durum Workshop'a çekiliyor ve o blok bunu yeni bir
        // aktarım isteği sanıp az önce geri aldığımız satırları tekrar damgalardı.
        var revertedTransfer = false;

        if (service.Type == ServiceType.Installation && dto.Status == ServiceStatus.Planned)
        {
            revertedTransfer = true;
            // "Planlamaya geri gönder": aktarım damgası kalkar, satır tekrar planlama sekmesinde
            // görünür. Satır seçilmediyse kaydın aktarılmış TÜM satırları geri alınır.
            //
            // GERÇEKLEŞMİŞ ve İPTAL EDİLMİŞ satırlar dışarıda. Süzgeç yalnızca TransferredAt'e
            // bakıyordu, yani geri gönderme:
            //  - Completed satırı Planned'a düşürüyor ama CompletedAt'i bırakıyordu (yapılmış iş
            //    "planlanmış" görünüyor, hak edişi ortada kalıyordu),
            //  - Cancelled satırı Planned yapıp İPTALİ DİRİLTİYORDU.
            // Yapılmış işi geri almanın yeri satırın kendi durum güncellemesi; bu uç aktarımı
            // geri alır, işin sonucunu değil.
            //
            // GERÇEKLEŞMİŞLER yalnızca `IncludeCompleted` ile gelir. Bu ayrım şart: satırların
            // hepsi sahada tamamlanmışsa geri gönderme sessizce HİÇBİR ŞEY yapmıyordu (süzgeç
            // hepsini eliyordu) — kullanıcı düğmeye basıyor, hiçbir şey olmuyordu. Artık ya
            // aktarım geri alınır (varsayılan) ya da açıkça "gerçekleşmişleri de geri al" denir.
            var toRevert = await _context.InstallationTasks
                .Where(t => t.ServiceId == id
                            && t.TransferredAt != null
                            && t.Status != InstallationTaskStatus.Cancelled
                            && (dto.IncludeCompleted || t.Status != InstallationTaskStatus.Completed))
                .ToListAsync();

            if (dto.TaskIds is { Count: > 0 })
            {
                var selected = dto.TaskIds.ToHashSet();
                toRevert = toRevert.Where(t => selected.Contains(t.Id)).ToList();
            }

            if (toRevert.Count > 0)
            {
                var undoneCompleted = toRevert
                    .Where(t => t.Status == InstallationTaskStatus.Completed)
                    .Select(t => t.Id)
                    .ToList();

                foreach (var task in toRevert)
                {
                    task.TransferredAt = null;
                    task.Status = InstallationTaskStatus.Planned; // Reset task status back to Planned
                    // Sahada başlanmış/bitirilmiş iş geri alınıyor: damgalar da kalkar, yoksa
                    // satır "planlanmış ama tamamlanmış" diye tutarsız kalır.
                    task.StartedAt = null;
                    task.CompletedAt = null;
                    task.UpdatedAt = DateTime.UtcNow;
                }

                // Gerçekleşmesi geri alınan satırın hak edişi de kapanmalı.
                await ReverseEarningsAsync(
                    EarningSourceType.InstallationTask,
                    undoneCompleted,
                    "Satır sahadan planlamaya geri çekildi.");

                await _context.SaveChangesAsync();
            }

            // Kaydın başka kalemleri hâlâ sahadaysa kayıt "Planlandı"ya çekilmez: kayıt durumu
            // "bu faturanın sahada işi var mı" sorusunun yanıtı ve geri çekilen tek kalem
            // yüzünden sahadaki diğer kalemler teknisyenin listesinden düşerdi.
            var stillInField = await _context.InstallationTasks
                .AnyAsync(t => t.ServiceId == id && t.TransferredAt != null
                               && t.Status != InstallationTaskStatus.Cancelled);
            if (stillInField)
            {
                dto.Status = ServiceStatus.Workshop;
            }
        }

        if (service.Type == ServiceType.Installation && dto.Status == ServiceStatus.Workshop && !revertedTransfer)
        {
            // "Tamamlanmayı Geri Al": kayıt zaten Ready (hepsi Gerçekleşti) ise bu bir YENİ
            // aktarım değil, hatalı tamamlamayı düzeltmek için Teslimattakiler'e dönüş. Fiş/
            // kısmi aktarım kontrolleri (aşağıda) yalnızca New/Planned → Workshop geçişi için
            // anlamlı; buraya girerlerse "aktarılacak planlanmış görev yok" diye hata verirdi
            // (kalemler zaten Completed, Planned değil). Görevlere DOKUNULMAZ — hatalı işaretlenen
            // varsa kullanıcı Teslimattakiler'de o kalemi kendisi düzeltir.
            if (service.Status == ServiceStatus.Ready || service.Status == ServiceStatus.Delivered)
            {
                await _context.ServiceRecords
                    .Where(s => s.Id == id)
                    .ExecuteUpdateAsync(setters => setters
                        .SetProperty(s => s.Status, ServiceStatus.Workshop)
                        .SetProperty(s => s.CompletedAt, (DateTime?)null)
                        .SetProperty(s => s.UpdatedAt, DateTime.UtcNow));

                // Also reset completed tasks of this record back to InProgress so they appear in deliveries
                var completedTasks = await _context.InstallationTasks
                    .Where(t => t.ServiceId == id && t.Status == InstallationTaskStatus.Completed)
                    .ToListAsync();
                foreach (var task in completedTasks)
                {
                    task.Status = InstallationTaskStatus.InProgress;
                    task.CompletedAt = null;
                    task.UpdatedAt = DateTime.UtcNow;
                }

                // Tamamlanma geri alındıysa hak ediş de geri alınmalı: aksi halde yapılmamış iş
                // personelin ekstresinde alacak olarak durmaya devam ediyordu.
                await ReverseEarningsAsync(
                    EarningSourceType.InstallationTask,
                    completedTasks.Select(t => t.Id).ToList(),
                    "Kaydın tamamlanması geri alındı.");
                await ReverseEarningsAsync(
                    EarningSourceType.ServiceRecord,
                    new List<Guid> { id },
                    "Kaydın tamamlanması geri alındı.");

                await _context.SaveChangesAsync();

                _context.Activities.Add(new Activity
                {
                    ServiceId = id,
                    Type = ActivityType.StatusChanged,
                    Payload = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        field = "Status",
                        oldValue = ServiceStatus.Ready.ToString(),
                        newValue = ServiceStatus.Workshop.ToString(),
                        reason = dto.Notes ?? "Tamamlanma geri alındı, kayıt teslimattakilere gönderildi.",
                        performedBy = "Sistem"
                    }),
                    CreatedAt = DateTime.UtcNow
                });
                await _context.SaveChangesAsync();

                var revertedRecord = await _context.ServiceRecords
                    .Include(s => s.Customer)
                    .Include(s => s.Dealer)
                    .Include(s => s.AssignedTechnician)
                    .Include(s => s.Region)
                    .Include(s => s.Notes)
                    .FirstOrDefaultAsync(s => s.Id == id);
                return revertedRecord != null ? MapToDto(revertedRecord) : null;
            }

            var hasWorkOrder = await _context.WorkOrders.AnyAsync(w => w.ServiceId == id);
            if (!hasWorkOrder)
            {
                throw new InvalidOperationException("Servis fişi oluşturulmadan sahaya aktarılamaz.");
            }

            // Fiş yalnızca oluşturulmuş değil, basılmış da olmalı. Basım Montaj Yönetimi'nde
            // yapılıyor ve kaydı IsPrinted olarak işaretliyor.
            if (!service.IsPrinted)
            {
                throw new InvalidOperationException("Servis fişi basılmadan sahaya aktarılamaz.");
            }

            var tasks = await _context.InstallationTasks.Where(t => t.ServiceId == id).ToListAsync();
            var plannedTasks = tasks
                .Where(t => t.Status == InstallationTaskStatus.Planned || t.Status == InstallationTaskStatus.InProgress)
                .Where(t => t.TransferredAt == null)
                .ToList();

            // Kısmi aktarım: satır seçildiyse yalnızca onlar aktarılır, kalanlar kayıtta durur.
            if (dto.TaskIds is { Count: > 0 })
            {
                var selected = dto.TaskIds.ToHashSet();
                var selectable = plannedTasks.Where(t => selected.Contains(t.Id)).ToList();

                if (selectable.Count == 0)
                {
                    throw new InvalidOperationException("Seçilen satırlar arasında aktarılabilir planlanmış görev yok.");
                }

                plannedTasks = selectable;
            }

            if (!plannedTasks.Any())
            {
                throw new InvalidOperationException("Aktarılacak planlanmış bir görev bulunamadı.");
            }

            // AKTARIM ARTIK KAYDI BÖLMÜYOR (kullanıcı kararı, 2026-08-10).
            //
            // Eskiden kısmi aktarım kaydı MNT-xxxxxxx-N diye ikiye ayırıyordu: aktarılan satırlar
            // yeni bir kayda taşınıyor, kalemler klonlanıyor, adetler bölünüyordu. Bir fatura
            // ekranda iki-üç kayda dağılınca hangi ürünün nerede olduğu takip edilemez oluyordu.
            // Artık bir fatura = tek kayıt: aktarım SATIRA damgalanır (TransferredAt), kalan
            // satırlar aynı kayıtta planlanmaya devam eder. Planlama / Teslimattakiler ayrımı bu
            // damgadan türetilir, kaydın durumundan DEĞİL — kayıt durumu artık yalnızca "bu
            // faturanın sahada işi var mı" sorusunu yanıtlıyor.
            var transferNow = DateTime.UtcNow;
            foreach (var task in plannedTasks)
            {
                task.TransferredAt = transferNow;
                task.UpdatedAt = transferNow;
            }

            /*
              FİŞ İŞARETİ BİR KEZ BASILDIKTAN SONRA DÜŞMEZ (2026-08-27 kullanıcı kuralı:
              "bir kere fiş yazdırdıysak o fiş olduğu gibi kalsın; ertelenen bir ürün tekrar
              planlamaya giderse tekrar fiş yazdırmasına gerek kalmaz").

              Burada `IsPrinted`, aktarılmayı bekleyen satır kaldığında SIFIRLANIYORDU:
              "kalan parti için yeni fiş basılsın" düşüncesiyle. Pratikte bunun bedeli ağır
              çıkıyor — bir satır ertelenip planlamaya geri döndüğünde ya da kalemin bir kısmı
              sahaya çıktığında, kayıt "fiş basılmadı" durumuna dönüyor ve kullanıcı aynı
              fişi baştan basmak zorunda kalıyor. Fişin içeriği değişmemişti; sadece damga
              düşmüştü.

              Damga artık yalnızca kayda YENİ KALEM eklendiğinde düşüyor (MontajController) —
              orada fişin içeriği gerçekten eksik kalıyor.
            */
            await _context.SaveChangesAsync();

            await _context.ServiceRecords
                .Where(s => s.Id == id)
                .ExecuteUpdateAsync(setters => setters
                    .SetProperty(s => s.AssignedTechnicianId, plannedTasks[0].AssignedTechnicianId)
                    .SetProperty(s => s.UpdatedAt, DateTime.UtcNow)
                );
        }

        var oldStatus = service.Status;
        var now = DateTime.UtcNow;
        var completedAt = (dto.Status == ServiceStatus.Delivered || dto.Status == ServiceStatus.Ready)
            ? now
            : (DateTime?)null;

        // Resolve performer technician name
        string performerName = !string.IsNullOrWhiteSpace(dto.PerformedByName)
            ? dto.PerformedByName
            : (service.AssignedTechnician?.FullName ?? "Sistem");
        string performerId = dto.PerformedByTechnicianId?.ToString() ?? "user";

        if (dto.PerformedByTechnicianId.HasValue && string.IsNullOrWhiteSpace(dto.PerformedByName))
        {
            var tech = await _context.Technicians.AsNoTracking()
                .Where(t => t.Id == dto.PerformedByTechnicianId.Value)
                .Select(t => new { t.Id, t.FullName })
                .FirstOrDefaultAsync();
            if (tech != null)
            {
                performerName = tech.FullName;
                performerId = tech.Id.ToString();
            }
        }

        var targetParentStatus = dto.Status;
        if (service.Type == ServiceType.Installation && dto.Status == ServiceStatus.Cancelled)
        {
            var siblingTasks = await _context.InstallationTasks
                .Where(t => t.ServiceId == id)
                .ToListAsync();

            var tasksToCancel = siblingTasks
                .Where(t => t.Status != InstallationTaskStatus.Cancelled);

            if (dto.TaskIds is { Count: > 0 })
            {
                var selected = dto.TaskIds.ToHashSet();
                tasksToCancel = tasksToCancel.Where(t => selected.Contains(t.Id));
            }

            var tasksToCancelList = tasksToCancel.ToList();
            foreach (var task in tasksToCancelList)
            {
                var oldTaskStatus = task.Status;
                task.Status = InstallationTaskStatus.Cancelled;
                task.UpdatedAt = now;

                _context.Activities.Add(new Activity
                {
                    ServiceId = id,
                    Type = ActivityType.StatusChanged,
                    ActorUserName = performerName,
                    Payload = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        field = $"InstallationTask.{task.Id}.Status",
                        oldValue = oldTaskStatus.ToString(),
                        newValue = InstallationTaskStatus.Cancelled.ToString(),
                        reason = $"İptal Nedeni: {dto.Notes ?? ""}",
                        metadata = new { taskId = task.Id }
                    }),
                    CreatedAt = now
                });
            }

            await _context.SaveChangesAsync();

            // Refresh sibling tasks list after our updates
            var updatedSiblingTasks = await _context.InstallationTasks
                .Where(t => t.ServiceId == id)
                .ToListAsync();

            var allCancelled = updatedSiblingTasks.All(t => t.Status == InstallationTaskStatus.Cancelled);
            if (!allCancelled)
            {
                // Parent should NOT be cancelled if there are active tasks left.
                targetParentStatus = oldStatus;
            }
        }

        var targetParentCompletedAt = (targetParentStatus == ServiceStatus.Delivered || targetParentStatus == ServiceStatus.Ready)
            ? now
            : (targetParentStatus == oldStatus ? service.CompletedAt : (DateTime?)null);

        var affected = await _context.ServiceRecords
            .Where(s => s.Id == id)
            .ExecuteUpdateAsync(setters =>
                setters
                    .SetProperty(s => s.Status, targetParentStatus)
                    .SetProperty(s => s.UpdatedAt, now)
                    .SetProperty(s => s.CompletedAt, targetParentCompletedAt)
            );

        if (affected == 0) return null;

        // Create Activity for the status change of the parent record (if it changed)
        if (targetParentStatus != oldStatus)
        {
            _context.Activities.Add(new Activity
            {
                ServiceId = id,
                Type = ActivityType.StatusChanged,
                ActorUserName = performerName,
                Payload = System.Text.Json.JsonSerializer.Serialize(new
                {
                    field = "Status",
                    oldValue = oldStatus.ToString(),
                    newValue = targetParentStatus.ToString(),
                    reason = dto.Notes,
                    performedBy = performerName
                }),
                CreatedAt = now
            });
        }

        await _context.SaveChangesAsync();

        if (!string.IsNullOrWhiteSpace(dto.Notes))
        {
            _context.ServiceNotes.Add(new ServiceNote
            {
                ServiceId = id,
                Content = dto.Notes,
                AuthorId = performerId,
                AuthorName = performerName,
                Type = NoteType.General,
                CreatedAt = now
            });
            await _context.SaveChangesAsync();
        }

        if (service.AssignedTechnicianId.HasValue)
        {
            var isCompletedTransition = (oldStatus != ServiceStatus.Delivered && oldStatus != ServiceStatus.Ready) &&
                                       (dto.Status == ServiceStatus.Delivered || dto.Status == ServiceStatus.Ready);
            var isCancelledTransition = oldStatus != ServiceStatus.Cancelled && dto.Status == ServiceStatus.Cancelled;

            if (isCompletedTransition)
            {
                await _technicianService.IncrementCompletedTasksAsync(service.AssignedTechnicianId.Value);
            }
            else if (isCancelledTransition)
            {
                await _technicianService.IncrementCancelledTasksAsync(service.AssignedTechnicianId.Value);
            }
        }

        var updated = await _context.ServiceRecords
            .Include(s => s.Customer)
            .Include(s => s.Dealer)
            .Include(s => s.AssignedTechnician)
            .Include(s => s.Region)
            .Include(s => s.Notes)
            .Include(s => s.Activities)
            .FirstOrDefaultAsync(s => s.Id == id);

        return updated == null ? null : MapToDto(updated);
    }

    public async Task<ServiceRecordDto?> AssignTechnicianAsync(Guid id, AssignTechnicianDto dto)
    {
        for (int i = 0; i < 3; i++)
        {
            try
            {
                var service = await _context.ServiceRecords.FindAsync(id);
                if (service == null) return null;

                var targetTechId = dto.TechnicianId == Guid.Empty ? null : (Guid?)dto.TechnicianId;
                var isNewAssignment = service.AssignedTechnicianId != targetTechId;

                service.AssignedTechnicianId = targetTechId;
                service.UpdatedAt = DateTime.UtcNow;

                await _context.SaveChangesAsync();

                if (isNewAssignment && targetTechId.HasValue)
                {
                    await _technicianService.IncrementTotalTasksAsync(targetTechId.Value);
                }

                return MapToDto(service);
            }
            catch (DbUpdateConcurrencyException ex)
            {
                if (i == 2) throw;
                foreach (var entry in ex.Entries)
                {
                    await entry.ReloadAsync();
                }
            }
        }
        return null;
    }

    public async Task<ServiceRecordDto?> PlanAsync(Guid id, PlanServiceRecordDto dto)
    {
        for (int i = 0; i < 3; i++)
        {
            try
            {
                var service = await _context.ServiceRecords.FindAsync(id);
                if (service == null) return null;

                var oldStatus = service.Status;
                service.EstimatedDeliveryDate = dto.PlannedDate;
                service.PlannedAt = dto.PlannedDate;
                if (dto.TechnicianId.HasValue)
                {
                    service.AssignedTechnicianId = dto.TechnicianId.Value;
                }
                ServiceStatus targetStatus = ServiceStatus.FieldPlanned;
                // Küçük ürün sahaya çıkmaz, atölyede planlanır. ProductCategory bir ENUM
                // (Large/Small) — metin olarak karşılaştırılamaz; öyle yazıldığında dosya
                // derlenmiyordu.
                if (service.ProductCategory == ProductCategory.Small)
                {
                    targetStatus = ServiceStatus.Planned;
                }

                if (!string.IsNullOrWhiteSpace(dto.Status) && Enum.TryParse<ServiceStatus>(dto.Status, true, out var parsedStatus))
                {
                    targetStatus = parsedStatus;
                }
                service.Status = targetStatus;
                service.UpdatedAt = DateTime.UtcNow;

                _context.Activities.Add(new Activity
                {
                    ServiceId = id,
                    Type = ActivityType.StatusChanged,
                    Payload = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        field = "Status",
                        oldValue = oldStatus.ToString(),
                        newValue = targetStatus.ToString(),
                        reason = (targetStatus == ServiceStatus.InDelivery || targetStatus == ServiceStatus.Planned) ? "Hazır ürün teslimat planlandı." : "Saha planlaması yapıldı.",
                        // İsim gelmediyse "Sistem"e düşer; controller dolduruyor.
                        performedBy = string.IsNullOrWhiteSpace(dto.PerformedByName) ? "Sistem" : dto.PerformedByName
                    }),
                    ActorUserName = string.IsNullOrWhiteSpace(dto.PerformedByName) ? null : dto.PerformedByName,
                    CreatedAt = DateTime.UtcNow
                });

                _context.ServiceNotes.Add(new ServiceNote
                {
                    ServiceId = id,
                    Content = "Hazır ürün teslimatı planlandı.",
                    AuthorId = "system",
                    AuthorName = string.IsNullOrWhiteSpace(dto.PerformedByName) ? "Sistem" : dto.PerformedByName,
                    Type = NoteType.General,
                    CreatedAt = DateTime.UtcNow
                });

                await _context.SaveChangesAsync();

                return MapToDto(service);
            }
            catch (DbUpdateConcurrencyException ex)
            {
                if (i == 2) throw;
                foreach (var entry in ex.Entries)
                {
                    await entry.ReloadAsync();
                }
            }
        }
        return null;
    }

    public async Task<Dictionary<ServiceStatus, int>> GetStatusCountsAsync()
    {
        var counts = await _context.ServiceRecords
            .GroupBy(s => s.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync();

        return counts.ToDictionary(x => x.Status, x => x.Count);
    }

    public async Task<List<ServiceRecordDto>> GetTodayServicesAsync()
    {
        var today = DateTime.UtcNow.Date;
        var services = await _context.ServiceRecords
            .Include(s => s.Customer)
            .Include(s => s.AssignedTechnician)
            .Where(s => s.CreatedAt.Date == today || s.EstimatedDeliveryDate == today)
            .OrderByDescending(s => s.Priority)
            .ThenBy(s => s.CreatedAt)
            .ToListAsync();

        return services.Select(MapToDto).ToList();
    }

    public async Task<List<ServiceRecordDto>> GetDelayedServicesAsync()
    {
        var today = DateTime.UtcNow.Date;
        var services = await _context.ServiceRecords
            .Include(s => s.Customer)
            .Include(s => s.AssignedTechnician)
            .Where(s => s.Status != ServiceStatus.Delivered && 
                       s.Status != ServiceStatus.Cancelled &&
                       s.EstimatedDeliveryDate < today)
            .OrderBy(s => s.EstimatedDeliveryDate)
            .ToListAsync();

        return services.Select(MapToDto).ToList();
    }

    /// <param name="performedByName">
    /// Fişi basan kişi. Controller dolduruyor; boş kalırsa tarihçe satırı yine yazılır ama
    /// kim bastığı görünmez.
    /// </param>
    /// <param name="itemId">
    /// Basılan KALEM; boşsa yalnızca kayıt damgalanır (eski çağrı biçimi).
    /// Kalem damgası <see cref="ServiceRecordItem.SlipPrintedAt"/>'e yazılır — bkz. oradaki not.
    /// </param>
    public async Task<ServiceRecordDto?> MarkAsPrintedAsync(Guid id, string? performedByName = null, Guid? itemId = null)
    {
        var record = await _context.ServiceRecords
            .Include(s => s.Customer)
            .Include(s => s.Dealer)
            .Include(s => s.AssignedTechnician)
            .Include(s => s.Region)
            .Include(s => s.Notes)
            .Include(s => s.InstallationTasks)
            .Include(s => s.Items)
            .FirstOrDefaultAsync(s => s.Id == id);
            
        if (record == null) return null;

        /*
          BASIM TARİHÇEYE YAZILIR (2026-08-27).

          `IsPrinted` bugüne kadar sessizce set ediliyordu: hiçbir hareket kaydı üretmiyordu.
          Sonucu, damganın sonradan düştüğü kayıtları geriye dönük bulmanın hiçbir yolunun
          olmamasıydı — "bu fiş basıldı mı" sorusuna veriyle cevap verilemiyordu.

          Okuma tarafı bu alanı zaten tanıyor (`"IsPrinted" => "Servis Fişi Basıldı"`),
          yazan yoktu. Yalnızca DURUM DEĞİŞİYORSA yazılır; aynı fişi ikinci kez basmak
          tarihçeyi şişirmesin.
        */
        var ilkBasim = !record.IsPrinted;
        record.IsPrinted = true;

        /*
          KALEM DAMGASI (2026-09-09 kullanıcı isteği: "servis fişleri kalem bazlı olacak…
          fiş yazdırıldıysa tik olsun, yazdırılma tarihi de yazsın").

          `IsPrinted` KAYIT düzeyinde ve öyle kalıyor — sahaya aktarım kilidi o. Ama fiş
          basımı kalem bazlı yapıldığı için (fiş ekranı `itemId` alıyor) tik de kalem bazlı
          olmalıydı: tek alan olduğu sürece bir kalemin fişini basmak aynı faturadaki bütün
          kalemleri basılmış gösteriyordu.

          Yeniden basımda tarih GÜNCELLENİR: sorulan şey "en son ne zaman basıldı". Basımların
          tamamı zaten aşağıdaki hareket kaydında birikiyor.
        */
        ServiceRecordItem? basilanKalem = null;
        if (itemId.HasValue)
        {
            basilanKalem = record.Items.FirstOrDefault(i => i.Id == itemId.Value);
            if (basilanKalem != null)
            {
                basilanKalem.SlipPrintedAt = DateTime.UtcNow;
                basilanKalem.UpdatedAt = DateTime.UtcNow;
            }
        }

        // HAREKET KAYDI: kalem bazlı basımda HER basım yazılır, kayıt bazlı basımda yalnızca
        // ilki. Kalemde "ilk basım" ölçütü kaydın bayrağı olamaz — ikinci kalemin ilk basımı
        // kayıt zaten IsPrinted olduğu için sessiz kalırdı, oysa o basım gerçekten yeni.
        if (ilkBasim || basilanKalem != null)
        {
            _context.Activities.Add(new Activity
            {
                ServiceId = record.Id,
                Type = ActivityType.StatusChanged,
                ActorUserName = string.IsNullOrWhiteSpace(performedByName) ? null : performedByName,
                Payload = System.Text.Json.JsonSerializer.Serialize(new
                {
                    field = "IsPrinted",
                    oldValue = ilkBasim ? "false" : "true",
                    newValue = "true",
                    reason = basilanKalem != null
                        ? $"Servis fişi basıldı: {basilanKalem.ProductName}."
                        : "Servis fişi basıldı.",
                    performedBy = string.IsNullOrWhiteSpace(performedByName) ? "Sistem" : performedByName,
                    metadata = basilanKalem != null ? new { itemId = basilanKalem.Id } : null
                }),
                CreatedAt = DateTime.UtcNow
            });
        }

        await _context.SaveChangesAsync();
        
        return MapToDto(record);
    }

    /// <summary>
    /// Kağıt fiş numarasını TEK BAŞINA günceller.
    ///
    /// <para><see cref="UpdateAsync"/> düzenleme formunun tamamını taşır ve gönderilmeyen her
    /// alanı null'lar; sırf fiş numarası için oradan geçmek müşteri/ürün bilgisini silerdi.
    /// Bu yüzden ayrı bir yol var.</para>
    ///
    /// <para>Boş/boşluk gelirse numara TEMİZLENİR (kullanıcı alanı silip kaydedebilmeli).
    /// Tekillik aranmaz: eski defterlerde tekrar eden numaralar var.</para>
    /// </summary>
    public async Task<ServiceRecordDto?> UpdateManualReceiptNoAsync(Guid id, string? manualReceiptNo)
    {
        var record = await _context.ServiceRecords
            .Include(s => s.Customer)
            .Include(s => s.Dealer)
            .Include(s => s.AssignedTechnician)
            .Include(s => s.Region)
            .Include(s => s.Notes)
            .Include(s => s.InstallationTasks)
            .Include(s => s.Items)
            .FirstOrDefaultAsync(s => s.Id == id);

        if (record == null) return null;

        record.ManualReceiptNo = string.IsNullOrWhiteSpace(manualReceiptNo) ? null : manualReceiptNo.Trim();
        record.UpdatedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();

        return MapToDto(record);
    }

    private async Task<HashSet<string>> GetInstallableProductNamesAsync()
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var client = _httpClientFactory.CreateClient("ErpApi");
            var tCode = _configuration["ErpApi:ServiceAccount:TenantCode"] ?? "SERVIS";
            var user = _configuration["ErpApi:ServiceAccount:Username"] ?? "ssa";
            var pass = _configuration["ErpApi:ServiceAccount:Password"] ?? "123";
            if (string.Equals(user, "ssa", StringComparison.OrdinalIgnoreCase)) tCode = "";

            var loginBody = new { tenantCode = tCode, username = user, password = pass };
            var content = new StringContent(System.Text.Json.JsonSerializer.Serialize(loginBody), System.Text.Encoding.UTF8, "application/json");
            var loginRes = await client.PostAsync("api/auth/login", content);
            if (loginRes.IsSuccessStatusCode)
            {
                var loginJson = await loginRes.Content.ReadAsStringAsync();
                using var doc = System.Text.Json.JsonDocument.Parse(loginJson);
                
                var token = doc.RootElement.TryGetProperty("accessToken", out var t1) ? t1.GetString()
                    : doc.RootElement.TryGetProperty("data", out var d) && d.TryGetProperty("accessToken", out var t2) ? t2.GetString()
                    : null;

                if (!string.IsNullOrEmpty(token))
                {
                    var tenants = new List<string> { "DEMO", "DEMOTEST" };
                    foreach (var tenant in tenants)
                    {
                        var req = new HttpRequestMessage(HttpMethod.Get, "api/products?pageSize=1000");
                        req.Headers.Add("X-Tenant-Code", tenant);
                        req.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
                        var res = await client.SendAsync(req);
                        if (res.IsSuccessStatusCode)
                        {
                            var body = await res.Content.ReadAsStringAsync();
                            using var pDoc = System.Text.Json.JsonDocument.Parse(body);
                            if (pDoc.RootElement.TryGetProperty("data", out var dataProp) && dataProp.TryGetProperty("items", out var itemsProp))
                            {
                                foreach (var item in itemsProp.EnumerateArray())
                                {
                                    var isInstallable = item.TryGetProperty("isInstallable", out var inst) && inst.GetBoolean();
                                    var name = item.TryGetProperty("name", out var n) ? n.GetString() : null;
                                    if (isInstallable && !string.IsNullOrEmpty(name))
                                    {
                                        set.Add(name.Trim().ToLower());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[ServiceRecordService_ERP_Error] {ex.Message}");
        }
        return set;
    }

    private async Task<string> GenerateServiceNumber(ServiceType type, string productName, string? category = null)
    {
        string prefix;
        if (type == ServiceType.Installation)
        {
            prefix = "MNT-";
        }
        else
        {
            var catLower = (category ?? "").Trim().ToLower();
            if (catLower == "small" || catLower == "kucuk")
            {
                prefix = "AT-";
            }
            else if (catLower == "large" || catLower == "buyuk")
            {
                prefix = "SH-";
            }
            else
            {
                // Fallback keywords check
                var smallApplianceKeywords = new[] 
                { 
                    "airfryer", "air fryer", "blender", "çay", "kahve", "tost", "mixer", 
                    "mikser", "ütü", "süpürge", "saç kurutma", "epilatör", "tıraş", 
                    "tartı", "rondo", "kettle", "su ısıtıcı", "mutfak robotu"
                };
                
                var nameLower = (productName ?? "").Trim().ToLower();
                bool isSmallAppliance = false;
                foreach (var kw in smallApplianceKeywords)
                {
                    if (nameLower.Contains(kw))
                    {
                        isSmallAppliance = true;
                        break;
                    }
                }
                prefix = isSmallAppliance ? "AT-" : "SH-";
            }
        }

        return await NextServiceNumberAsync(prefix);
    }

    /// <summary>
    /// Servis numarasını veritabanı dizisinden (sequence) üretir.
    ///
    /// Eskiden "mevcut en büyüğü bul + 1" idi. İki sorun vardı:
    ///  1. Sorgu global `!IsDeleted` süzgecinden geçiyordu, oysa `IX_ServiceRecords_ServiceNumber`
    ///     benzersizlik kısıtı SİLİNMİŞ satırları da kapsar. Silinmiş bir numara yeniden dağıtılıp
    ///     kayıt "duplicate key" ile 500 dönüyordu.
    ///  2. Süzgeç düzeltilse bile oku-ve-yaz arası açıktı: aynı anda iki kayıt açılırsa ikisi de
    ///     aynı max'ı okuyup aynı numarayı isterdi.
    ///
    /// `nextval` atomiktir ve asla aynı değeri iki kez vermez; işlem geri alınsa bile numara
    /// tüketilir. Yani numaralarda boşluk olabilir — benzersizlik boşluksuzluktan önemli.
    /// </summary>
    private async Task<string> NextServiceNumberAsync(string prefix)
    {
        // Dizi adı SABİT listeden türetiliyor (MNT-/AT-/SH-), dışarıdan gelen veri değil.
        var sequenceName = $"ServiceNumberSeq_{prefix.TrimEnd('-')}";

        for (var attempt = 0; attempt < 50; attempt++)
        {
            long next;
            try
            {
                next = await NextSequenceValueAsync(sequenceName);
            }
            catch (PostgresException ex) when (ex.SqlState == "42P01")
            {
                // Dizi yok: firma bu adımı henüz almamış olabilir (her firma ayrı veritabanı ve
                // hepsi zincirin aynı noktasında değil). Kendini onaracak şekilde oluşturulup
                // mevcut en büyük numaranın üstüne çekiliyor.
                await EnsureServiceNumberSequenceAsync(prefix, sequenceName);
                next = await NextSequenceValueAsync(sequenceName);
            }

            var candidate = $"{prefix}{next:D7}";

            // Dizi öncesinde elle/eski yolla üretilmiş numaralar diziyi aşmış olabilir. Böyle bir
            // çakışmada bir sonraki değere geçilir; `nextval` tekrar etmediği için bu adım
            // eşzamanlı çağrılar arasında yeni bir yarış açmaz.
            var taken = await _context.ServiceRecords
                .IgnoreQueryFilters()
                .AsNoTracking()
                .AnyAsync(s => s.ServiceNumber == candidate);

            if (!taken) return candidate;
        }

        throw new InvalidOperationException(
            $"'{prefix}' için boş servis numarası bulunamadı: dizi 50 kez denendi ve hepsi doluydu.");
    }

    private async Task<long> NextSequenceValueAsync(string sequenceName)
    {
        var values = await _context.Database
            .SqlQueryRaw<long>($"SELECT nextval('\"{sequenceName}\"')")
            .ToListAsync();

        return values[0];
    }

    /// <summary>
    /// Diziyi oluşturur ve mevcut en büyük numaranın (SİLİNMİŞLER DAHİL) üstüne çeker.
    /// Migration ile aynı işi yapar; migration'ı almamış firmada ilk kayıtta devreye girer.
    /// </summary>
    private async Task EnsureServiceNumberSequenceAsync(string prefix, string sequenceName)
    {
        var bare = prefix.TrimEnd('-');

        await _context.Database.ExecuteSqlRawAsync($@"
DO $do$
DECLARE mx bigint;
BEGIN
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I AS bigint START 1 MINVALUE 1', '{sequenceName}');
    SELECT COALESCE(MAX(SUBSTRING(""ServiceNumber"" FROM '^{bare}-(\d+)')::bigint), 0)
      INTO mx
      FROM ""ServiceRecords""
     WHERE ""ServiceNumber"" ~ '^{bare}-\d+';
    -- Ad tırnak İÇİNDE veriliyor: setval metni regclass'a çevirirken tırnaksız adı küçük
    -- harfe katlar ve büyük harf içeren diziyi bulamaz.
    PERFORM setval('""{sequenceName}""', GREATEST(mx, 1), mx > 0);
END
$do$;");
    }

    /// <summary>
    /// Alt seviyedeki durumları tek duruma indirger: hepsi aynıysa o durum, karışıksa "İşlemde".
    /// Görev→kalem ve kalem→kayıt için aynı kural. `Mixed` ayrı bir değer, çünkü `InProgress`
    /// ("Devam Ediyor") zaten gerçek bir görev durumu.
    /// </summary>
    private static string? CombineStates(IEnumerable<string> states)
    {
        var distinct = states.Distinct().ToList();
        if (distinct.Count == 0) return null;
        return distinct.Count == 1 ? distinct[0] : "Mixed";
    }

    /// <summary>
    /// Kalem→kayıt birleştirmesi. İptaller diğer kalemleri "İptal" göstermemeli:
    /// hepsi iptalse İptal, değilse iptal olmayanların ortak durumu (karışıksa "İşlemde"),
    /// iş bitmiş ama içinde iptal varsa "Gerçekleşti !" (<c>CompletedWithCancellations</c>).
    /// Kural <c>InstallationsController</c>'daki eşiyle AYNI olmalı — ayrışırsa aynı kayıt
    /// listede ve detayda iki farklı durum gösterir.
    /// </summary>
    internal const string CompletedWithCancellations = "CompletedWithCancellations";

    private static string? CombineStatesWithCancellations(IEnumerable<string> states)
    {
        var all = states.ToList();
        if (all.Count == 0) return null;

        var cancelledCount = all.Count(s => s == nameof(InstallationTaskStatus.Cancelled));
        if (cancelledCount == all.Count) return nameof(InstallationTaskStatus.Cancelled);

        var combined = CombineStates(all.Where(s => s != nameof(InstallationTaskStatus.Cancelled)));

        return cancelledCount > 0 && combined == nameof(InstallationTaskStatus.Completed)
            ? CompletedWithCancellations
            : combined;
    }

    /// <remarks>public: WhatsApp asistanının okuma ucu (AsistanToolsController) da aynı etiketi kullanır.</remarks>
    public static string StateLabel(string state) => state switch
    {
        "Mixed" => "İşlemde",
        CompletedWithCancellations => "Gerçekleşti !",
        nameof(InstallationTaskStatus.Deferred) => "Yeni Kayıt",
        nameof(InstallationTaskStatus.Planned) => "Planlandı",
        nameof(InstallationTaskStatus.InProgress) => "Devam Ediyor",
        nameof(InstallationTaskStatus.Completed) => "Gerçekleşti",
        nameof(InstallationTaskStatus.Cancelled) => "İptal",
        nameof(InstallationTaskStatus.Unreachable) => "Ulaşılamadı",
        nameof(InstallationTaskStatus.Delivered) => "Teslim Edildi (Planlama Bekliyor)",
        nameof(InstallationTaskStatus.Postponed) => "Ertelendi",
        _ => state
    };

    /// <summary>
    /// Kaydın kalemlerinden genel durumu türetir. Görevler yüklenmemişse null döner; ekran o
    /// zaman kaydın kendi durumuna düşer — yanlış "Yeni Kayıt" göstermektense boş bırakmak yeğ.
    /// </summary>
    /// <remarks>public: WhatsApp asistanının okuma ucu da montaj durumunu ekranla AYNI kuraldan türetsin.</remarks>
    public static string? DeriveRecordState(ServiceRecord s)
    {
        if (s.Status == ServiceStatus.Cancelled) return nameof(InstallationTaskStatus.Cancelled);
        if (s.Items == null || s.Items.Count == 0) return null;
        if (s.InstallationTasks == null || s.InstallationTasks.Count == 0) return null;

        var itemStates = new List<string>();
        foreach (var item in s.Items)
        {
            // İptal kalemin KENDİ damgasından okunur: aşağıdaki süzgeç iptal görevlerini zaten
            // eliyor, dolayısıyla damgaya bakılmazsa tümü iptal olmuş bir kalem "Yeni Kayıt"
            // sayılır ve fatura sonsuza kadar "İşlemde" takılır.
            if (item.CancelledAt != null)
            {
                itemStates.Add(nameof(InstallationTaskStatus.Cancelled));
                continue;
            }

            var live = s.InstallationTasks
                .Where(t => t.ServiceRecordItemId == item.Id && t.Status != InstallationTaskStatus.Cancelled)
                .Select(t => t.Status.ToString())
                .ToList();

            // Görevi olmayan kalem henüz hiç ele alınmamış demektir.
            itemStates.Add(CombineStates(live) ?? nameof(InstallationTaskStatus.Deferred));
        }

        return CombineStatesWithCancellations(itemStates);
    }

    private static ServiceRecordDto MapToDto(ServiceRecord s)
    {
        var derivedState = DeriveRecordState(s);

        return new ServiceRecordDto
        {
            Id = s.Id,
            DerivedState = derivedState,
            DerivedStateLabel = derivedState == null ? null : StateLabel(derivedState),
            ServiceNumber = s.ServiceNumber,
            ManualReceiptNo = s.ManualReceiptNo,
            Status = s.Status,
            Type = s.Type,
            CreatedAt = s.CreatedAt,
            EstimatedDeliveryDate = s.EstimatedDeliveryDate,
            PlannedAt = s.PlannedAt,
            CustomerName = s.CustomerName ?? s.Customer?.FullName,
            CustomerPhone = s.CustomerPhone ?? s.Customer?.Phone,
            CustomerAddress = s.CustomerAddress ?? s.Customer?.Address,
            Latitude = s.Latitude,
            Longitude = s.Longitude,
            ProductName = s.ProductName,
            ProductStockCode = s.ProductStockCode,
            SerialNumber = s.SerialNumber,
            IsUnderWarranty = s.IsUnderWarranty,
            WarrantyStartDate = s.PurchaseDate,
            PickupSourceId = s.PickupSourceId,
            DealerName = s.DealerName ?? s.Dealer?.Name,
            DealerPhone = s.DealerPhone ?? s.Dealer?.Phone,
            DealerAddress = s.DealerAddress ?? s.Dealer?.Address,
            DealerCode = s.DealerCode ?? s.Dealer?.DealerCode,
            AssignedTechnicianId = s.AssignedTechnicianId ?? s.InstallationTasks?.Where(t => t.AssignedTechnicianId != null).Select(t => t.AssignedTechnicianId).FirstOrDefault(),
            AssignedTechnicianName = s.AssignedTechnician?.FullName ?? s.InstallationTasks?.Where(t => t.AssignedTechnician != null).Select(t => t.AssignedTechnician!.FullName).FirstOrDefault(),
            AssignedTechnicianAvatar = s.AssignedTechnician?.AvatarUrl ?? s.InstallationTasks?.Where(t => t.AssignedTechnician != null).Select(t => t.AssignedTechnician!.AvatarUrl).FirstOrDefault(),
            AssignedTechnicians = s.InstallationTasks?.Where(t => t.AssignedTechnician != null)
                                    .Select(t => t.AssignedTechnician!.FullName)
                                    .Distinct().ToList(),
            RegionId = s.RegionId,
            RegionName = s.Region?.Name,
            Priority = s.Priority,
            ProblemDescription = s.ProblemDescription,
            UserRouteTick = s.UserRouteTick,
            UserRouteHour = s.UserRouteHour,
            UserRouteSortOrder = s.UserRouteSortOrder,
            RouteOrder = s.RouteOrder,
            PlannedStartTime = s.PlannedStartTime,
            PlannedEndTime = s.PlannedEndTime,
            RouteDate = s.RouteDate,
            TechnicianId = s.TechnicianId,
            IsPrinted = s.IsPrinted,
            IsInvoiced = s.IsInvoiced,
            InvoiceReference = s.InvoiceReference,
            SatisfactionScore = s.SatisfactionScore,
            SatisfactionNotes = s.SatisfactionNotes,
            SatisfactionBy = s.SatisfactionBy,
            SatisfactionCreatedAt = s.SatisfactionCreatedAt,
            InstallationType = s.InstallationType,
            // Süzgeçle aynı kural (bkz. GetPagedAsync): kolon backfill edilmeden önce açılmış ya da
            // kategorisi hiç gönderilmemiş kayıtlarda servis numarası önekine düşülür.
            Category = s.ProductCategory == ProductCategory.Small || s.ServiceNumber.StartsWith("AT-") ? "small" : "large",
            HasWorkOrder = s.WorkOrders != null && s.WorkOrders.Any(),
            UpdatedAt = s.UpdatedAt,
            CompletedAt = s.CompletedAt,
            PhotoUrls = s.Activities?
                .Where(a => a.Type == ActivityType.PhotoUploaded)
                .Select(a => {
                    try {
                        using var doc = System.Text.Json.JsonDocument.Parse(a.Payload);
                        if (doc.RootElement.TryGetProperty("field", out var f) && f.GetString() == "Photo")
                        {
                            if (doc.RootElement.TryGetProperty("newValue", out var nv))
                                return nv.GetString();
                        }
                    } catch { }
                    return null;
                })
                .Where(url => !string.IsNullOrEmpty(url))
                .Select(url => url!)
                .ToList() ?? new List<string>(),
            ReceivingNote = s.ReceivingNote,
            InstallationTasks = s.InstallationTasks?.Select(t => new InstallationTaskDto
            {
                Id = t.Id,
                AssignedTechnicianId = t.AssignedTechnicianId,
                AssignedTechnicianName = t.AssignedTechnician?.FullName,
                PlannedAt = t.PlannedAt,
                Status = (int)t.Status,
                StatusLabel = t.Status.ToTurkishString(),
                Quantity = t.Quantity,
                Notes = t.Notes,
                CustomAddress = t.CustomAddress,
                PhotoUrl = t.PhotoUrl,
                SerialNumber = t.SerialNumber,
                ServiceRecordItemId = t.ServiceRecordItemId,
                TransferredAt = t.TransferredAt,
                CompletedAt = t.CompletedAt,
                UpdatedAt = t.UpdatedAt,
                // Kalem adı, ayrıca Include etmemek için yüklü kalem listesinden çözülüyor.
                ItemProductName = t.Item?.ProductName
                    ?? s.Items?.FirstOrDefault(i => i.Id == t.ServiceRecordItemId)?.ProductName
            }).ToList(),
            Items = s.Items?.OrderBy(i => i.SortOrder).Select(i => new ServiceRecordItemDto
            {
                Id = i.Id,
                ProductName = i.ProductName,
                ProductStockCode = i.ProductStockCode,
                SerialNumber = i.SerialNumber,
                Quantity = i.Quantity,
                Notes = i.Notes,
                SortOrder = i.SortOrder,
                ExternalRef = i.ExternalRef,
                CustomerName = i.CustomerName,
                CustomerPhone = i.CustomerPhone,
                CustomerAddress = i.CustomerAddress,
                CancelledAt = i.CancelledAt,
                CancelReason = i.CancelReason,
                SlipPrintedAt = i.SlipPrintedAt
            }).ToList() ?? new List<ServiceRecordItemDto>(),
            // Kalem yoksa (kalem kavramından önce açılmış kayıt) kaydın kendisi 1 adet sayılır.
            TotalQuantity = s.Items != null && s.Items.Count > 0 ? s.Items.Sum(i => i.Quantity) : 1,
            LastAction = s.Notes?.OrderByDescending(n => n.CreatedAt).Select(n => $"[{n.CreatedAt.ToLocalTime():dd.MM.yyyy HH:mm}] {n.Content}").FirstOrDefault() ?? GetLastAction(s.Status),
            Notes = s.Notes?.OrderByDescending(n => n.CreatedAt).Select(n => new ServiceNoteDto
            {
                Id = n.Id,
                Content = n.Content,
                AuthorName = n.AuthorName,
                CreatedAt = n.CreatedAt
            }).ToList()
        };
    }

    public async Task<ServiceRecordDto?> UpdateSatisfactionAsync(Guid id, UpdateSatisfactionDto dto, string satisfactionBy)
    {
        var service = await _context.ServiceRecords
            .Include(s => s.Customer)
            .Include(s => s.Dealer)
            .Include(s => s.AssignedTechnician)
            .Include(s => s.Region)
            .Include(s => s.Notes)
            .FirstOrDefaultAsync(s => s.Id == id);

        if (service == null) return null;

        service.SatisfactionScore = dto.SatisfactionScore;
        service.SatisfactionNotes = dto.SatisfactionNotes;
        service.SatisfactionBy = satisfactionBy;
        service.SatisfactionCreatedAt = DateTime.UtcNow;
        service.UpdatedAt = DateTime.UtcNow;

        await _context.SaveChangesAsync();
        return MapToDto(service);
    }

    private static string GetLastAction(ServiceStatus status) => status switch
    {
        ServiceStatus.New => "Kayıt Oluşturuldu",
        ServiceStatus.Workshop => "Atölyeye Alındı",
        ServiceStatus.InRepair => "Tamirde",
        ServiceStatus.WaitingForParts => "Parça Bekleniyor",
        ServiceStatus.Ready => "Hazır",
        ServiceStatus.Delivered => "Teslim Edildi",
        ServiceStatus.Cancelled => "İptal Edildi",
        ServiceStatus.Delayed => "Gecikti",
        _ => "-"
    };

    /// <summary>
    /// Geri alınan işlerin hak edişlerini iptale çeker ve defter satırlarını kaldırır.
    ///
    /// Hak ediş tek yönlüydü: iş tamamlanınca satır doğuyor, tamamlanma geri alınınca satır
    /// olduğu yerde kalıyordu. Sonuç: yapılmamış iş personelin ekstresinde alacak olarak duruyor,
    /// üstelik iş başka kişiye devredilip tekrar tamamlandığında hak ediş senkronu aynı kaynağı
    /// "zaten yazılmış" bulup İKİNCİ kişiye hiç satır açmıyordu.
    ///
    /// Muhasebeye işlenmiş (<see cref="EarningStatus.PostedToLedger"/>) satır otomatik
    /// kapatılmaz; üzerine uyarı notu düşülür — o bir muhasebe kararıdır.
    /// Aynı kural <c>InstallationsController.ReverseEarningForTaskAsync</c>'te de geçerli;
    /// ikisi ayrışırsa aynı işin iki geri alma yolu iki farklı sonuç verir.
    /// </summary>
    private async Task ReverseEarningsAsync(EarningSourceType sourceType, IReadOnlyCollection<Guid> sourceIds, string reason)
    {
        if (sourceIds.Count == 0) return;

        var earnings = await _context.TechnicianEarnings
            .Where(e => e.SourceType == sourceType
                        && sourceIds.Contains(e.SourceId)
                        && e.Status != EarningStatus.Cancelled)
            .ToListAsync();

        if (earnings.Count == 0) return;

        var cancelledIds = new List<Guid>();
        foreach (var earning in earnings)
        {
            var note = earning.Status == EarningStatus.PostedToLedger
                ? $"UYARI: iş geri alındı ({reason}) ancak hak ediş muhasebeye işlenmiş — elle düzeltilmeli."
                : $"Otomatik iptal: {reason}";

            earning.Notes = string.IsNullOrWhiteSpace(earning.Notes) ? note : $"{earning.Notes}\n{note}";

            if (earning.Status != EarningStatus.PostedToLedger)
            {
                earning.Status = EarningStatus.Cancelled;
                cancelledIds.Add(earning.Id);
            }
        }

        if (cancelledIds.Count == 0) return;

        var ledgerRows = await _context.TechnicianLedgerEntries
            .Where(l => l.EntryType == LedgerEntryType.Earning
                        && l.SourceId != null
                        && cancelledIds.Contains(l.SourceId.Value))
            .ToListAsync();
        _context.TechnicianLedgerEntries.RemoveRange(ledgerRows);
    }
}
