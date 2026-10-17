using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;
using ServiceOps.Application.Dtos;
using ServiceOps.Api.Services;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using SixLabors.ImageSharp;
// Mutate/Resize genişletme yöntemleri bu ad alanında.
using SixLabors.ImageSharp.Processing;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class InstallationsController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly IServiceOpsPermissionService _permissions;
    private const string SmartAssignVersion = "installations/1.0.0";

    /// <summary>
    /// Montaj fotoğrafının saklanacağı en uzun kenar (piksel) ve WebP kalitesi.
    /// Bu görseller belge amaçlı; tam çözünürlük saklamanın karşılığı yok, maliyeti ise
    /// fotoğraf başına ~2 MB. Yüz binlerce kayıtta fark yüzlerce GB'a çıkıyor.
    /// </summary>
    private const int PhotoMaxEdge = 1600;
    private const int PhotoQuality = 75;

    private readonly IJobAssignmentNotifier _assignmentNotifier;

    public InstallationsController(
        ApplicationDbContext context,
        IServiceOpsPermissionService permissions,
        IJobAssignmentNotifier assignmentNotifier)
    {
        _context = context;
        _permissions = permissions;
        _assignmentNotifier = assignmentNotifier;
    }

    /// <summary>
    /// Oluşturulan montaj görevlerini sahibine duyurur.
    ///
    /// Konu metni kalemin ürün ve müşterisinden kurulur; teknisyenin telefonunda sesli okunacağı
    /// için "hangi kaydın hangi ürünü" bilgisi olmadan mesajın hiçbir kıymeti olmuyor.
    /// Kişi başına tek bildirim üretilmesini <see cref="IJobAssignmentNotifier"/> hallediyor.
    /// </summary>
    private async Task NotifyTaskAssignmentsAsync(IReadOnlyCollection<InstallationTask> tasks, CancellationToken ct)
    {
        var assigned = tasks.Where(t => t.AssignedTechnicianId.HasValue).ToList();
        if (assigned.Count == 0) return;

        var serviceIds = assigned.Select(t => t.ServiceId).Distinct().ToList();
        var services = await _context.ServiceRecords
            .AsNoTracking()
            .Where(s => serviceIds.Contains(s.Id))
            .Select(s => new { s.Id, s.ServiceNumber, s.CustomerName, s.ProductName })
            .ToListAsync(ct);
        var serviceById = services.ToDictionary(s => s.Id);

        var itemIds = assigned.Where(t => t.ServiceRecordItemId.HasValue)
            .Select(t => t.ServiceRecordItemId!.Value).Distinct().ToList();
        var items = itemIds.Count == 0
            ? new List<(Guid Id, string? ProductName, string? CustomerName)>()
            : (await _context.ServiceRecordItems
                .AsNoTracking()
                .Where(i => itemIds.Contains(i.Id))
                .Select(i => new { i.Id, i.ProductName, i.CustomerName })
                .ToListAsync(ct))
              .Select(i => (i.Id, i.ProductName, i.CustomerName)).ToList();
        var itemById = items.ToDictionary(i => i.Id);

        var assignments = assigned.Select(t =>
        {
            serviceById.TryGetValue(t.ServiceId, out var svc);
            var product = t.ServiceRecordItemId.HasValue && itemById.TryGetValue(t.ServiceRecordItemId.Value, out var it)
                ? (it.ProductName ?? svc?.ProductName)
                : svc?.ProductName;
            var customer = t.ServiceRecordItemId.HasValue && itemById.TryGetValue(t.ServiceRecordItemId.Value, out var it2)
                ? (it2.CustomerName ?? svc?.CustomerName)
                : svc?.CustomerName;

            var parts = new[] { svc?.ServiceNumber, product, customer }
                .Where(p => !string.IsNullOrWhiteSpace(p));
            return new JobAssignment(
                t.AssignedTechnicianId!.Value,
                JobKind.Installation,
                t.Id,
                string.Join(" · ", parts),
                Math.Max(1, t.Quantity),
                t.PlannedAt);
        }).ToList();

        await _assignmentNotifier.NotifyAsync(assignments, ct);
    }

    private bool IsTechnicianUser()
    {
        return _permissions.IsTechnicianUser(User);
    }

    private async Task<Guid?> GetCurrentTechnicianIdAsync()
    {
        var current = _permissions.GetTechnicianId(User);
        if (current.HasValue) return current;

        var claimValue = User.FindFirstValue("technicianId");
        if (Guid.TryParse(claimValue, out var claimTechId)) return claimTechId;

        var sub = User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(sub, out var userId)) return null;

        return await _context.ServiceUsers
            .AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => u.TechnicianId)
            .FirstOrDefaultAsync();
    }

    private static double ToRad(double deg) => deg * Math.PI / 180.0;
    private static double Haversine(double lat1, double lon1, double lat2, double lon2)
    {
        var R = 6371.0; // km
        var dLat = ToRad(lat2 - lat1);
        var dLon = ToRad(lon2 - lon1);
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) + Math.Cos(ToRad(lat1)) * Math.Cos(ToRad(lat2)) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        var c = 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
        return R * c;
    }

    /// <summary>
    /// Verilen sayfalar arasından EN GENİŞ kapsam.
    ///
    /// Bir montaj kaydının iş satırları tek bir sayfaya ait değil: aynı satırlar Planlama,
    /// Teslimat, Servis Fişi, Sahaya Aktar ve Montaj Kabul ekranlarında görünür. Kapsam tek bir
    /// sayfa anahtarından okunduğunda, o sayfada dar yetkisi olan ama BAŞKA bir sekmede geniş
    /// yetkisi olan kullanıcı kapıda kalıyordu.
    ///
    /// Somut arıza: okuma `montajYonetimi` (üst sayfa) soruyordu, aynı modaldaki YAZMA uçları
    /// ise `montajYonetimi.planlama`. Müdür rolünde ikincisi açık, birincisinde "tümünü görme"
    /// kapalı; kullanıcı teknisyen olmadığı için "kendi işleri" hiçbir şeye denk gelmiyor ve
    /// kapsam None'a düşüyordu. Sonuç: planlama yapabiliyor ama listeyi okuyamıyor — modal
    /// "İstek başarısız (403)" veriyordu. (Doğrulandı 2026-08-10; aynı boşluk referans firma
    /// DEMO'da de var.)
    ///
    /// Yetki GENİŞLETİLMİYOR: kullanıcının zaten sahip olduğu sayfalardan hangisi daha genişse o
    /// kullanılıyor. Hiçbirinde yetki yoksa sonuç yine None ve uç 403 döner.
    /// </summary>
    private async Task<ServiceOpsScope> GetWidestScopeAsync(params string[] pageKeys)
    {
        ServiceOpsScope? widest = null;

        foreach (var pageKey in pageKeys)
        {
            var scope = await _permissions.GetScopeAsync(User, pageKey);
            if (scope.CanViewAll) return scope;
            if (scope.CanAccess && widest is null) widest = scope;
        }

        return widest ?? new ServiceOpsScope(
            ServiceOpsScopeKind.None,
            _permissions.GetTechnicianId(User),
            _permissions.GetDealerCode(User));
    }

    /// <summary>Bir montaj kaydının iş satırlarını gösteren ekranlar.</summary>
    private static readonly string[] MontajTaskReadPages =
    {
        "montajYonetimi",
        "montajYonetimi.planlama",
        "montajYonetimi.teslimat",
        "montajKabul"
    };

    /// <summary>Yazma tarafı: kabul ekranı buraya dahil değil, iş satırını orası değiştirmiyor.</summary>
    private static readonly string[] MontajTaskWritePages =
    {
        "montajYonetimi",
        "montajYonetimi.planlama",
        "montajYonetimi.teslimat"
    };

    [HttpGet("tasks")]
    public async Task<ActionResult<List<object>>> GetTasks([FromQuery] Guid? serviceId, [FromQuery] Guid? technicianId)
    {
        var scope = await GetWidestScopeAsync(MontajTaskReadPages);
        if (!scope.CanAccess) return Forbid();

        var q = _context.InstallationTasks
            .Include(t => t.Service)
            .ThenInclude(s => s.Dealer)
            // Bölge adı kalem tablosunda gösteriliyor; yüklenmezse yanıt her satırda null döner.
            .Include(t => t.Service)
            .ThenInclude(s => s.Region)
            .Include(t => t.AssignedTechnician)
            .Include(t => t.Item)
            .AsQueryable();

        q = _permissions.ApplyInstallationTaskScope(q, scope);

        if (serviceId.HasValue) q = q.Where(t => t.ServiceId == serviceId);
        if (technicianId.HasValue) q = q.Where(t => t.AssignedTechnicianId == technicianId);

        var items = await q.OrderByDescending(t => t.CreatedAt).Take(500).ToListAsync();

        // Henüz görevi olmayan kalemler için "Yeni Kayıt" (Deferred) satırları üretilir.
        // Eskiden bu, açıklama metnindeki "Miktar: N" regex'inden tek üründen türetiliyordu;
        // artık kaydın kalemleri kaynak: her kalemin her adedi ayrı bir satır.
        if (!IsTechnicianUser() && serviceId.HasValue)
        {
            var created = await EnsureDeferredTasksForItemsAsync(serviceId.Value);
            if (created) items = await q.OrderByDescending(t => t.CreatedAt).Take(500).ToListAsync();
        }

        return Ok(items.Select(t => new
        {
            t.Id,
            t.ServiceId,
            Status = (int)t.Status,
            StatusLabel = t.Status.ToTurkishString(),
            t.PlannedAt,
            t.Priority,
            t.EstimatedDurationMinutes,
            t.Notes,
            t.StartedAt,
            t.CompletedAt,
            t.Quantity,
            t.CreatedAt,
            ServiceNumber = t.Service.ServiceNumber,
            TechnicianName = t.AssignedTechnician != null ? t.AssignedTechnician.FullName : null,
            AssignedTechnicianId = t.AssignedTechnicianId,
            PhotoUrl = t.PhotoUrl,
            CustomAddress = t.CustomAddress,
            SerialNumber = t.SerialNumber ?? (t.Item != null ? t.Item.SerialNumber : null),
            ServiceRecordItemId = t.ServiceRecordItemId,
            ItemProductName = t.Item != null ? t.Item.ProductName : t.Service.ProductName,
            ItemSortOrder = t.Item != null ? t.Item.SortOrder : 0,
            // Sahaya aktarıldı mı: aktarım kaydı bölmediği için ayrım bu damgadan okunuyor.
            t.TransferredAt,

            // Kalem tablosunda bölge/müşteri sütunları için. Müşteri KALEMİN kendi müşterisidir;
            // bir montaj kaydındaki kalemler farklı müşterilere gidebiliyor. Kalemde yoksa
            // kaydın müşterisine düşülür.
            RegionName = t.Service.Region != null ? t.Service.Region.Name : null,
            ItemCustomerName = (t.Item != null ? t.Item.CustomerName : null) ?? t.Service.CustomerName,
            ItemCustomerPhone = (t.Item != null ? t.Item.CustomerPhone : null) ?? t.Service.CustomerPhone,

            /*
              KALEMİN ADRESİ DE GÖNDERİLİR (2026-09-02 canlı hata).

              Ad ve telefon gönderiliyordu, ADRES ATLANMIŞTI. Servis fişi kalemin adresini
              bulamayınca kaydınkine düşüyor ve bir montaj kaydının farklı adreslere giden
              kalemleri için AYNI adresi basıyordu — teknisyen yanlış eve gidiyordu.

              Sıra görevin kendi geçersiz kılması, sonra kalem, sonra kayıt: `CustomAddress`
              sahada elle girilen adrestir ve en günceli odur.
            */
            ItemCustomerAddress = t.CustomAddress
                                  ?? (t.Item != null ? t.Item.CustomerAddress : null)
                                  ?? t.Service.CustomerAddress
        }));
    }

    /// <summary>
    /// Bir montaj kaydının KALEMLERİNİ döner — görevlerini değil.
    ///
    /// "Kalem" = faturada o ürüne girilen montaj (<see cref="ServiceRecordItem"/>). Ekran eskiden
    /// `tasks` ucunu çağırıyordu; o uç 1 adetlik iş satırları döndüğü için tabloda ürün, müşteri
    /// ve not boş görünüyordu. Ürün/müşteri/not kalemin kendi alanları.
    ///
    /// Durum kuralı her iki seviyede de AYNI: alttakilerin hepsi aynı durumdaysa o durum
    /// gösterilir, karışıksa "İşlemde". Yani kalem kendi gerçek durumunu (Planlandı, Teslimde,
    /// Gerçekleşti…) korur — indirgenmez. Fatura seviyesinde ise yeni açılmış kayıtta bütün
    /// kalemler "Yeni Kayıt" olduğu için kayıt da "Yeni Kayıt", hepsi bitince "Gerçekleşti",
    /// arada kalanlarda "İşlemde" görünür.
    /// </summary>
    [HttpGet("items")]
    public async Task<IActionResult> GetItems([FromQuery] Guid serviceId, CancellationToken cancellationToken)
    {
        if (serviceId == Guid.Empty) return BadRequest("serviceId zorunludur");

        // Bu uçta HİÇBİR yetki kontrolü yoktu: tek engel sınıf düzeyindeki [Authorize] idi, yani
        // oturum açmış herkes — başka bayinin kullanıcısı, kendisine hiç iş atanmamış bir saha
        // teknisyeni — elindeki bir serviceId ile o kaydın müşteri adını, telefonunu ve adresini
        // okuyabiliyordu. Kardeş uç GetTasks kapsamı zaten uyguluyordu; ayrışma gözden kaçmıştı.
        var scope = await GetWidestScopeAsync(MontajTaskReadPages);
        if (!scope.CanAccess) return Forbid();

        var service = await _permissions
            .ApplyServiceRecordScope(
                _context.ServiceRecords.AsNoTracking()
                    .Include(s => s.Dealer)
                    .Include(s => s.InstallationTasks)
                    .Where(s => s.Id == serviceId),
                scope)
            .FirstOrDefaultAsync(cancellationToken);

        // Kapsam dışı kayıt "yok" sayılır: 403 dönmek, kaydın var olduğunu doğrulayıp kimlik
        // numarası taramasına kapı açardı.
        if (service == null) return NotFound();

        // Kalemleri olmayan eski kayıtlarda görev üretimi kalemleri de doğuruyor.
        // Teknisyen oturumunda ÜRETİLMEZ: okuma isteği veri yazmamalı ve teknisyenin kapsamı
        // zaten kendi satırları, eksik adet üretmek onun işi değil (GetTasks'taki kural).
        if (!IsTechnicianUser()) await EnsureDeferredTasksForItemsAsync(serviceId);

        var items = await _context.ServiceRecordItems
            .AsNoTracking()
            .Where(i => i.ServiceId == serviceId)
            .OrderBy(i => i.SortOrder)
            .ToListAsync(cancellationToken);

        var itemIds = items.Select(i => i.Id).ToList();

        var tasks = await _context.InstallationTasks
            .AsNoTracking()
            .Include(t => t.AssignedTechnician)
            .Where(t => t.ServiceId == serviceId)
            .ToListAsync(cancellationToken);

        var result = items.Select(i =>
        {
            var itemTasks = tasks.Where(t => t.ServiceRecordItemId == i.Id).ToList();
            var live = itemTasks.Where(t => t.Status != InstallationTaskStatus.Cancelled).ToList();

            var completed = live.Count(t => t.Status == InstallationTaskStatus.Completed);
            var planned = live.Count(t => t.Status == InstallationTaskStatus.Planned
                                          || t.Status == InstallationTaskStatus.InProgress);

            // Kalemin durumu görevlerinin durumu: hepsi aynıysa o, karışıksa "İşlemde".
            // İptal KALEMİN kendi damgasından okunur — görev satırlarına bakmak yetmez, çünkü
            // `live` iptalleri zaten eliyor ve iptal edilmiş kalem "Yeni Kayıt" görünürdü.
            var isItemCancelled = i.CancelledAt != null || service.Status == ServiceStatus.Cancelled;
            var state = isItemCancelled
                ? nameof(InstallationTaskStatus.Cancelled)
                : CombineStates(live.Select(t => t.Status.ToString()));

            return new
            {
                i.Id,
                i.SortOrder,
                i.Quantity,
                i.ProductName,
                i.ProductStockCode,
                i.SerialNumber,
                i.Notes,

                // Kalemin kendi müşterisi yoksa kaydınki geçerli (tek adresli ve eski kayıtlar).
                CustomerName = i.CustomerName ?? service.CustomerName,
                CustomerPhone = i.CustomerPhone ?? service.CustomerPhone,
                CustomerAddress = i.CustomerAddress ?? service.CustomerAddress,

                // Dolu ise kalem faturadan geldi; ekran buna bakıp silmeyi kapatıyor.
                i.ExternalRef,
                IsInvoiceBacked = i.ExternalRef != null,

                i.CancelledAt,
                i.CancelReason,
                IsCancelled = isItemCancelled,

                // Bu KALEMİN fişi en son ne zaman basıldı; hiç basılmadıysa null.
                // Kayıt geneli IsPrinted ile karıştırma — bkz. ServiceRecordItem.SlipPrintedAt.
                i.SlipPrintedAt,

                State = state,
                StateLabel = StateLabel(state),
                TaskCount = live.Count,
                CompletedCount = completed,
                PlannedCount = planned,
                PlannedAt = live.Where(t => t.PlannedAt != null).Min(t => t.PlannedAt),
                TechnicianNames = live
                    .Where(t => t.AssignedTechnician != null)
                    .Select(t => t.AssignedTechnician!.FullName)
                    .Distinct()
                    .ToList(),
                PhotoUrl = string.Join(",", live
                    .Where(t => !string.IsNullOrWhiteSpace(t.PhotoUrl))
                    .Select(t => t.PhotoUrl!))
            };
        }).ToList();

        // Fatura seviyesinde de aynı kural, iptaller hariç tutularak: bir kalemin iptali
        // faturanın tamamını "İptal" göstermez. Hepsi iptalse İptal, iş bitmiş ama içinde iptal
        // varsa "Gerçekleşti !".
        var recordState = CombineStatesWithCancellations(result.Select(r => r.State));

        return Ok(new
        {
            serviceId,
            state = recordState,
            stateLabel = StateLabel(recordState),
            items = result
        });
    }

    public record UpdateMontajItemRequest(
        string? ProductName,
        string? ProductStockCode,
        string? SerialNumber,
        int? Quantity,
        string? Notes,
        string? CustomerName,
        string? CustomerPhone,
        string? CustomerAddress
    );

    /// <summary>
    /// Tek bir montaj kalemini günceller. Düzenleme kayıt seviyesinde değil KALEM seviyesinde:
    /// bir kayıtta farklı ürün/müşteri/adres taşıyan kalemler var, kaydı topluca düzenlemek
    /// hepsini aynı değere çekiyordu.
    ///
    /// Faturadan gelen kalemde (<c>ExternalRef</c> dolu) ÜRÜN ve MİKTAR değiştirilemez: kaynak
    /// B2B fatura kalemidir, burada değiştirilse fatura yeniden kaydedildiğinde webhook geri
    /// yazar ve iki taraf birbirini tutmaz. Müşteri/adres/not/seri no montajın kendi verisi,
    /// serbestçe düzenlenir.
    /// </summary>
    [HttpPut("items/{id:guid}")]
    public async Task<IActionResult> UpdateItem(Guid id, [FromBody] UpdateMontajItemRequest req, CancellationToken cancellationToken)
    {
        var scope = await _permissions.GetScopeAsync(User, "montajYonetimi.planlama");
        if (!scope.CanViewAll) return Forbid();

        var item = await _dbItems().FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (item == null) return NotFound();

        var isInvoiceBacked = item.ExternalRef != null;

        if (req.Quantity is int qty)
        {
            if (qty < 1) return BadRequest(new { success = false, message = "Miktar en az 1 olmalı." });

            if (isInvoiceBacked && qty != item.Quantity)
            {
                return BadRequest(new
                {
                    success = false,
                    message = "Bu kalem faturadan geldiği için miktarı buradan değiştirilemez. Fatura Dökümü'nden düzenleyin."
                });
            }

            // Planlanmış satırların altı boşaltılamaz.
            var plannedQty = await _context.InstallationTasks
                .Where(t => t.ServiceRecordItemId == id
                            && t.Status != InstallationTaskStatus.Deferred
                            && t.Status != InstallationTaskStatus.Cancelled)
                .SumAsync(t => t.Quantity, cancellationToken);

            if (qty < plannedQty)
            {
                return BadRequest(new
                {
                    success = false,
                    message = $"Miktar {plannedQty} adedin altına indirilemez: bu kadarı zaten planlanmış."
                });
            }

            item.Quantity = qty;
        }

        if (req.ProductName != null)
        {
            if (isInvoiceBacked && req.ProductName.Trim() != item.ProductName)
            {
                return BadRequest(new
                {
                    success = false,
                    message = "Bu kalem faturadan geldiği için ürünü buradan değiştirilemez. Fatura Dökümü'nden düzenleyin."
                });
            }
            if (!string.IsNullOrWhiteSpace(req.ProductName)) item.ProductName = req.ProductName.Trim();
        }

        if (req.ProductStockCode != null) item.ProductStockCode = Blank(req.ProductStockCode);
        if (req.SerialNumber != null) item.SerialNumber = Blank(req.SerialNumber);
        if (req.Notes != null) item.Notes = Blank(req.Notes);
        if (req.CustomerName != null) item.CustomerName = Blank(req.CustomerName);
        if (req.CustomerPhone != null) item.CustomerPhone = Blank(req.CustomerPhone);

        var addressChanged = req.CustomerAddress != null && Blank(req.CustomerAddress) != item.CustomerAddress;
        if (req.CustomerAddress != null) item.CustomerAddress = Blank(req.CustomerAddress);

        item.UpdatedAt = DateTime.UtcNow;

        if (addressChanged)
        {
            // Adres değişince teknisyenin gideceği yer de değişmeli. Tamamlanan/iptal edilen
            // görevlere DOKUNULMAZ: onlar geçmiş kaydı, gerçekte gidilen adresi taşıyorlar.
            var openTasks = await _context.InstallationTasks
                .Where(t => t.ServiceRecordItemId == id
                            && t.Status != InstallationTaskStatus.Completed
                            && t.Status != InstallationTaskStatus.Cancelled)
                .ToListAsync(cancellationToken);

            foreach (var t in openTasks)
            {
                t.CustomAddress = item.CustomerAddress;
                t.UpdatedAt = DateTime.UtcNow;
            }
        }

        _context.Activities.Add(new Activity
        {
            ServiceId = item.ServiceId,
            Type = ActivityType.StatusChanged,
            ActorUserName = User.FindFirstValue(ClaimTypes.Name),
            Payload = System.Text.Json.JsonSerializer.Serialize(new
            {
                field = "ServiceRecordItem.Edit",
                reason = $"Montaj kalemi düzenlendi: {item.ProductName}",
                metadata = new { itemId = item.Id }
            }),
            CreatedAt = DateTime.UtcNow
        });

        await _context.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    public record CancelMontajItemRequest(string? Reason, string? CorrelationId);

    /// <summary>
    /// Tek bir montaj KALEMİNİ iptal eder — kaydı değil.
    ///
    /// Eskiden iptal kayıt seviyesindeydi: bir kalemi iptal etmek faturanın bütün kalemlerini
    /// "İptal" gösteriyor, kayıt her iki sekmeden birden düşüyordu. Oysa 3 kalemlik bir faturanın
    /// bir kalemi iptal olduğunda diğer ikisi işlemeye devam etmeli.
    ///
    /// İptal edilen kalemin BÜTÜN görev satırları da iptale çekilir (15 adetlik kalemde 15 satır)
    /// ve iptal nedeni HER SATIRIN geçmişine ayrı ayrı yazılır: geçmiş modalı olayları
    /// <c>metadata.taskId</c> ile süzüyor, tek bir kayıt-seviyesi olay yazılırsa hiçbir satırın
    /// altında görünmez.
    ///
    /// Kayıt yalnızca TÜM kalemleri iptal olduğunda <c>Cancelled</c>'a düşer.
    /// </summary>
    [HttpPatch("items/{id:guid}/cancel")]
    public async Task<IActionResult> CancelItem(Guid id, [FromBody] CancelMontajItemRequest req, CancellationToken cancellationToken)
    {
        var scope = await _permissions.GetScopeAsync(User, "montajYonetimi.planlama");
        if (!scope.CanViewAll) return Forbid();

        var reason = Blank(req?.Reason);
        if (reason == null)
            return BadRequest(new { success = false, message = "İptal nedeni zorunludur." });

        var item = await _dbItems().FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
        if (item == null) return NotFound();

        if (item.CancelledAt != null)
            return BadRequest(new { success = false, message = "Bu kalem zaten iptal edilmiş." });

        var actorUserName = User.FindFirstValue(ClaimTypes.Name) ?? User.FindFirstValue("name") ?? User.Identity?.Name;
        var now = DateTime.UtcNow;

        var tasks = await _context.InstallationTasks
            .Where(t => t.ServiceRecordItemId == id)
            .ToListAsync(cancellationToken);

        foreach (var t in tasks.Where(t => t.Status != InstallationTaskStatus.Cancelled))
        {
            var oldStatus = t.Status;
            t.Status = InstallationTaskStatus.Cancelled;
            t.UpdatedAt = now;

            _context.Activities.Add(new Activity
            {
                ServiceId = item.ServiceId,
                Type = ActivityType.StatusChanged,
                CorrelationId = req?.CorrelationId,
                ActorUserName = actorUserName,
                Payload = System.Text.Json.JsonSerializer.Serialize(new
                {
                    field = $"InstallationTask.{t.Id}.Status",
                    oldValue = oldStatus.ToTurkishString(),
                    newValue = InstallationTaskStatus.Cancelled.ToTurkishString(),
                    reason = $"İptal Nedeni: {reason}",
                    // taskId ŞART: geçmiş modalı olayları buna göre süzüyor, yoksa iptal nedeni
                    // hiçbir satırın altında görünmez.
                    metadata = new { taskId = t.Id, itemId = item.Id }
                }),
                CreatedAt = now
            });
        }

        item.CancelledAt = now;
        item.CancelReason = reason;
        item.UpdatedAt = now;

        // Kalem seviyesindeki olay: kaydın genel geçmişinde (taskId süzgeci olmadan) görünür.
        _context.Activities.Add(new Activity
        {
            ServiceId = item.ServiceId,
            Type = ActivityType.StatusChanged,
            CorrelationId = req?.CorrelationId,
            ActorUserName = actorUserName,
            Payload = System.Text.Json.JsonSerializer.Serialize(new
            {
                field = "ServiceRecordItem.Cancelled",
                oldValue = "",
                newValue = InstallationTaskStatus.Cancelled.ToTurkishString(),
                reason = $"Montaj kalemi iptal edildi ({item.ProductName}) — İptal Nedeni: {reason}",
                metadata = new { itemId = item.Id }
            }),
            CreatedAt = now
        });

        await _context.SaveChangesAsync(cancellationToken);

        // Kayıt ancak HİÇ yaşayan kalemi kalmadıysa iptale düşer.
        var siblings = await _context.ServiceRecordItems
            .Where(i => i.ServiceId == item.ServiceId)
            .Select(i => new { i.Id, i.CancelledAt })
            .ToListAsync(cancellationToken);

        var allCancelled = siblings.Count > 0 && siblings.All(i => i.CancelledAt != null);

        var record = await _context.ServiceRecords.FirstOrDefaultAsync(s => s.Id == item.ServiceId, cancellationToken);
        if (record != null && allCancelled && record.Status != ServiceStatus.Cancelled)
        {
            var oldSrStatus = record.Status;
            record.Status = ServiceStatus.Cancelled;
            record.UpdatedAt = now;

            _context.Activities.Add(new Activity
            {
                ServiceId = record.Id,
                Type = ActivityType.StatusChanged,
                CorrelationId = req?.CorrelationId,
                ActorUserName = actorUserName,
                Payload = System.Text.Json.JsonSerializer.Serialize(new
                {
                    field = "Status",
                    oldValue = oldSrStatus.ToString(),
                    newValue = ServiceStatus.Cancelled.ToString(),
                    reason = "Kaydın bütün kalemleri iptal edildiği için montaj durumu 'İptal' yapıldı.",
                    metadata = new { serviceId = record.Id }
                }),
                CreatedAt = now
            });

            await _context.SaveChangesAsync(cancellationToken);
        }

        return Ok(new
        {
            success = true,
            cancelledTasks = tasks.Count,
            recordCancelled = allCancelled
        });
    }

    private IQueryable<ServiceRecordItem> _dbItems() => _context.ServiceRecordItems;

    private static string? Blank(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();

    /// <summary>
    /// Alt seviyedeki durumları tek bir duruma indirger: hepsi aynıysa o durum, karışıksa
    /// <c>Mixed</c> ("İşlemde"). Hem görev→kalem hem kalem→kayıt için aynı kural.
    ///
    /// <c>Mixed</c> ayrı bir değer; <c>InProgress</c> ("Devam Ediyor") zaten GERÇEK bir görev
    /// durumu, ikisi karıştırılırsa "tek görev devam ediyor" ile "kalemler karışık" ayırt edilemez.
    /// </summary>
    private static string CombineStates(IEnumerable<string> states)
    {
        var distinct = states.Distinct().ToList();
        if (distinct.Count == 0) return InstallationTaskStatus.Deferred.ToString();
        return distinct.Count == 1 ? distinct[0] : "Mixed";
    }

    /// <summary>
    /// Üst seviyeye (kalem→kayıt) çıkarken iptalleri hesaba katar.
    ///
    /// <see cref="CombineStates"/> tek başına yetmez: iptal edilmiş bir kalem "İptal" durumuyla
    /// karışıma girince 2 kalemi biten 3 kalemlik fatura "İşlemde" takılıp kalıyordu, iptali
    /// tamamen görmezden gelmek ise bu faturayı sorunsuz bitmiş gibi gösteriyordu.
    ///
    /// Kural: hepsi iptalse İptal. Değilse iptal OLMAYANLARIN ortak durumu (karışıksa "İşlemde"),
    /// ama iş bitmiş ve içeride iptal varsa <c>CompletedWithCancellations</c> — "Gerçekleşti !"
    /// diye ünlemle çıkar ki bitti sanılıp içindeki kayıp gözden kaçmasın.
    /// </summary>
    internal const string CompletedWithCancellations = "CompletedWithCancellations";

    private static string CombineStatesWithCancellations(IEnumerable<string> states)
    {
        var all = states.ToList();
        if (all.Count == 0) return InstallationTaskStatus.Deferred.ToString();

        var cancelledCount = all.Count(s => s == nameof(InstallationTaskStatus.Cancelled));
        if (cancelledCount == all.Count) return nameof(InstallationTaskStatus.Cancelled);

        var combined = CombineStates(all.Where(s => s != nameof(InstallationTaskStatus.Cancelled)));

        return cancelledCount > 0 && combined == nameof(InstallationTaskStatus.Completed)
            ? CompletedWithCancellations
            : combined;
    }

    private static string StateLabel(string state) => state switch
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
    /// Kaydın her kalemi için, o kalemde eksik kalan adet kadar "Yeni Kayıt" görevi açar.
    /// Zaten planlanmış/ertelenmiş adetleri sayar, fazladan satır üretmez.
    ///
    /// BU BİR YAZMA İŞİ AMA OKUMA UÇLARINDAN ÇAĞRILIYOR (GET items / GET tasks): kalem kavramından
    /// önce açılmış kayıtların satırları ancak böyle doğuyor. Sorun, "kaç tane var / kaç tane
    /// lazım" hesabının okuma ile yazma arasında başkası tarafından değiştirilebilmesiydi — aynı
    /// kaydı iki sekmede açmak (ya da liste + modalın eşzamanlı istekleri) aynı kalem için iki kez
    /// satır üretebiliyordu. Kayıt başına danışmanlık kilidi (advisory lock) ile aynı anda tek
    /// çağrı çalışıyor; kilit işlem sonunda kendiliğinden bırakılıyor.
    /// </summary>
    private async Task<bool> EnsureDeferredTasksForItemsAsync(Guid serviceId)
    {
        await using var tx = await _context.Database.BeginTransactionAsync();

        // Guid'in ilk 8 baytından 64-bit anahtar: pg_advisory_xact_lock bigint istiyor.
        var lockKey = BitConverter.ToInt64(serviceId.ToByteArray(), 0);
        await _context.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({lockKey})");

        var created = await EnsureDeferredTasksForItemsCoreAsync(serviceId);
        await tx.CommitAsync();
        return created;
    }

    private async Task<bool> EnsureDeferredTasksForItemsCoreAsync(Guid serviceId)
    {
        var service = await _context.ServiceRecords
            .Include(s => s.Items)
            .FirstOrDefaultAsync(s => s.Id == serviceId);

        if (service == null || service.Type != ServiceType.Installation) return false;

        // İptal edilmiş kayda satır üretilmez: fatura düşmüşken planlanacak adet de yoktur.
        if (service.Status == ServiceStatus.Cancelled) return false;

        // İptal edilen kalem dışarıda: aşağıdaki "eksik adedi tamamla" döngüsü iptal satırlarını
        // saymadığı için, iptal edilmiş bir kalem her liste yenilemesinde tertemiz "Yeni Kayıt"
        // satırlarıyla geri dirilirdi.
        var items = service.Items.Where(i => i.CancelledAt == null).OrderBy(i => i.SortOrder).ToList();
        if (items.Count == 0) return false;

        var existing = await _context.InstallationTasks
            .Where(t => t.ServiceId == serviceId && t.Status != InstallationTaskStatus.Cancelled)
            .ToListAsync();

        // Kalem bağı olmayan eski görevler varsa, kayıt zaten planlanmış demektir; dokunma.
        if (existing.Any(t => t.ServiceRecordItemId == null)) return false;

        var anyCreated = false;
        foreach (var item in items)
        {
            var covered = existing
                .Where(t => t.ServiceRecordItemId == item.Id)
                .Sum(t => t.Quantity);

            for (var i = covered; i < item.Quantity; i++)
            {
                _context.InstallationTasks.Add(new InstallationTask
                {
                    ServiceId = service.Id,
                    ServiceRecordItemId = item.Id,
                    Status = InstallationTaskStatus.Deferred,
                    Quantity = 1,
                    SerialNumber = item.SerialNumber,
                    // Kalemin kendi adresi varsa o geçerli: bir fatura tek kayda düşüyor ama
                    // aynı kayıtta farklı adreslere montaj olabiliyor.
                    CustomAddress = item.CustomerAddress ?? service.CustomerAddress,
                    CreatedAt = DateTime.UtcNow,
                    UpdatedAt = DateTime.UtcNow,
                    // GÖREVE not burada kasıtlı olarak yazılmıyor. `item.Notes` faturadaki tek bir
                    // bayi açıklamasıdır (webhook'ta AYNI metin faturanın TÜM kalemlerine yazılır,
                    // bkz. MontajController.cs "dealerNote") — buraya kopyalanırsa her kalemin
                    // her adedi tıpatıp aynı notu taşır ve göreve özel not girme alanı anlamsızlaşır.
                    // Bayi açıklaması zaten kaydın/kalemin kendi alanında görünür durumda kalıyor.
                });
                anyCreated = true;
            }
        }

        if (anyCreated) await _context.SaveChangesAsync();
        return anyCreated;
    }

    public class PlanBulkRequest
    {
        public DateTime? PlannedDateUtc { get; set; }
        public Guid? RegionId { get; set; }
        public List<PlanItem> Items { get; set; } = new();
        public int? MaxToCreate { get; set; }
    }
    public class PlanItem
    {
        public Guid ServiceId { get; set; }
        public Guid? ServiceRecordItemId { get; set; }
        public int Quantity { get; set; }
        public int? Priority { get; set; }
        public int? EstimatedDurationMinutes { get; set; }
        public string? Notes { get; set; }
    }

    [HttpPost("plan-bulk")]
    public async Task<ActionResult<object>> PlanBulk([FromBody] PlanBulkRequest request, CancellationToken ct)
    {
        var scope = await _permissions.GetScopeAsync(User, "montajYonetimi.planlama", ct);
        if (!scope.CanViewAll) return Forbid();
        var day = (request.PlannedDateUtc ?? DateTime.UtcNow).Date;
        var next = day.AddDays(1);

        // Candidate technicians (hard constraints): active, CanInstall, region match (if provided), within working hours (if time provided)
        var techQuery = _context.Technicians.Where(t => t.IsActive);
        if (request.RegionId.HasValue)
            techQuery = techQuery.Where(t => t.PrimaryRegionId == request.RegionId);
        var allTechs = await techQuery.Take(200).ToListAsync(ct);
        if (request.PlannedDateUtc.HasValue)
        {
            var tod = request.PlannedDateUtc.Value.TimeOfDay;
            allTechs = allTechs.Where(t => t.WorkStartTime <= tod && tod <= t.WorkEndTime).ToList();
        }

        // Capacity map: services + route stops + installation tasks (each task = 1)
        var techIds = allTechs.Select(t => t.Id).ToList();

        var serviceLoads = await _context.ServiceRecords.AsNoTracking()
            .Where(s => s.AssignedTechnicianId != null && techIds.Contains(s.AssignedTechnicianId!.Value)
                        && s.PlannedAt != null && s.PlannedAt >= day && s.PlannedAt < next
                        && s.Status != ServiceStatus.Delivered && s.Status != ServiceStatus.Cancelled)
            .GroupBy(s => s.AssignedTechnicianId!.Value)
            .Select(g => new { TechnicianId = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        var routeLoads = await _context.Routes.AsNoTracking()
            .Where(r => r.TechnicianId != null && techIds.Contains(r.TechnicianId!.Value)
                        && r.PlannedDate >= day && r.PlannedDate < next)
            .GroupBy(r => r.TechnicianId!.Value)
            .Select(g => new { TechnicianId = g.Key, Stops = g.Sum(x => x.TotalStops) })
            .ToListAsync(ct);

        var installLoads = await _context.InstallationTasks.AsNoTracking()
            // Plansız durumlar (Yeni Kayıt / Teslim Edildi / Ertelendi / Ulaşılamadı) HARİÇ:
            // o satırlar planlamaya geri düşerken teknisyenini ve son planlanan gününü artık
            // koruyor (bkz. InstallationTaskStatusSets.Unplanned). Süzülmezlerse geri çekilmiş
            // bir satır teknisyenin o günkü kapasitesini yemeye devam eder.
            .Where(t => t.AssignedTechnicianId != null && techIds.Contains(t.AssignedTechnicianId!.Value)
                        && t.PlannedAt != null && t.PlannedAt >= day && t.PlannedAt < next
                        && t.Status != InstallationTaskStatus.Completed && t.Status != InstallationTaskStatus.Cancelled
                        && !InstallationTaskStatusSets.Unplanned.Contains(t.Status))
            .GroupBy(t => t.AssignedTechnicianId!.Value)
            .Select(g => new { TechnicianId = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        var svcMap = serviceLoads.ToDictionary(x => x.TechnicianId, x => x.Count);
        var routeMap = routeLoads.ToDictionary(x => x.TechnicianId, x => x.Stops);
        var instMap = installLoads.ToDictionary(x => x.TechnicianId, x => x.Count);

        var poolWithLoad = allTechs
            .Select(t => new
            {
                Tech = t,
                Load = (svcMap.TryGetValue(t.Id, out var c1) ? c1 : 0)
                       + (routeMap.TryGetValue(t.Id, out var c2) ? c2 : 0)
                       + (instMap.TryGetValue(t.Id, out var c3) ? c3 : 0),
                Cap = t.MaxDailyTasks <= 0 ? 8 : t.MaxDailyTasks
            })
            .ToList();

        // Capacity check removed by user request
        var pool = poolWithLoad.OrderBy(x => x.Load).Select(x => x.Tech).ToList();

        if (pool.Count == 0)
        {
            return Ok(new { success = true, created = 0, message = "Müsait (CanInstall) teknisyen yok" });
        }

        // Proximity + balanced scoring params
        var distanceWeight = 0.7;
        var loadWeight = 0.3;

        // Preload last job coordinates per technician for the day
        var dayStart = day;
        var dayEnd = next;
        var lastJobs = await _context.ServiceRecords.AsNoTracking()
            .Where(x => x.AssignedTechnicianId != null && pool.Select(p => p.Id).Contains(x.AssignedTechnicianId!.Value)
                        && x.PlannedAt != null && x.PlannedAt >= dayStart && x.PlannedAt < dayEnd
                        && x.Latitude != null && x.Longitude != null)
            .OrderByDescending(x => x.PlannedAt)
            .Select(x => new { x.AssignedTechnicianId, x.Latitude, x.Longitude })
            .ToListAsync(ct);
        var lastJobMap = lastJobs.GroupBy(x => x.AssignedTechnicianId!.Value)
            .ToDictionary(g => g.Key, g => (Lat: g.First().Latitude!.Value, Lon: g.First().Longitude!.Value));

        // Track loads to balance during staging
        var stagedCounts = poolWithLoad.ToDictionary(x => x.Tech.Id, x => 0);
        double totalDistance = 0.0; int distCount = 0;
        var debug = new List<object>();

        // Round-robin + score per quantity with cluster-aware bias
        var toCreate = new List<InstallationTask>();
        var created = 0;
        foreach (var item in request.Items)
        {
            if (item.Quantity <= 0) continue;
            var service = await _context.ServiceRecords.FirstOrDefaultAsync(s => s.Id == item.ServiceId, ct);
            if (service == null) continue;
            var hasCoord = service.Latitude != null && service.Longitude != null;

            // Planlanan kalemin kendi adresi varsa görev ona gider; aynı kayıtta farklı
            // adreslere ait kalemler olabiliyor.
            var itemAddress = item.ServiceRecordItemId is Guid sriId
                ? await _context.ServiceRecordItems
                    .Where(i => i.Id == sriId)
                    .Select(i => i.CustomerAddress)
                    .FirstOrDefaultAsync(ct)
                : null;

            int remainingToAssign = item.Quantity;
            while (remainingToAssign > 0)
            {
                // Build eligible candidates with hard constraints
                var candidates = new List<(Technician tech, double score, double? distanceKm, int projectedLoad)>();
                foreach (var t in pool)
                {
                    var cap = t.MaxDailyTasks <= 0 ? 8 : t.MaxDailyTasks;
                    var baseLoad = (svcMap.TryGetValue(t.Id, out var l1) ? l1 : 0)
                                 + (routeMap.TryGetValue(t.Id, out var l2) ? l2 : 0)
                                 + (instMap.TryGetValue(t.Id, out var l3) ? l3 : 0);
                    var projected = baseLoad + stagedCounts[t.Id];
                    // Capacity check removed by user request
                    // if (projected >= cap) continue;

                    double? refLat = null, refLon = null;
                    if (lastJobMap.TryGetValue(t.Id, out var p)) { refLat = p.Lat; refLon = p.Lon; }
                    else if (t.CurrentLatitude.HasValue && t.CurrentLongitude.HasValue) { refLat = t.CurrentLatitude.Value; refLon = t.CurrentLongitude.Value; }

                    double distanceKm = 0; double distanceScore = 0.5;
                    if (hasCoord && refLat.HasValue && refLon.HasValue)
                    {
                        distanceKm = Haversine(service.Latitude!.Value, service.Longitude!.Value, refLat.Value, refLon.Value);
                        distanceScore = Math.Max(0.0, 1.0 - Math.Min(distanceKm, 30.0) / 30.0);
                    }

                    var loadScore = 1.0 - Math.Min(1.0, (double)projected / Math.Max(1, cap));
                    var score = distanceWeight * distanceScore + loadWeight * loadScore;
                    candidates.Add((t, score, hasCoord ? distanceKm : null, projected));
                }

                if (candidates.Count == 0) break; // No more capacity

                var best = candidates.OrderByDescending(c => c.score).First();
                var tech = best.tech;
                // Capacity check removed by user request
                var qtyForThisTech = remainingToAssign;

                for (int i = 0; i < qtyForThisTech; i++)
                {
                    var task = new InstallationTask
                    {
                        ServiceId = item.ServiceId,
                        ServiceRecordItemId = item.ServiceRecordItemId,
                        AssignedTechnicianId = tech.Id,
                        PlannedAt = request.PlannedDateUtc ?? DateTime.UtcNow,
                        Status = InstallationTaskStatus.Planned,
                        Quantity = 1,
                        Priority = item.Priority ?? 0,
                        EstimatedDurationMinutes = item.EstimatedDurationMinutes,
                        Notes = item.Notes,
                        CustomAddress = itemAddress ?? service.CustomerAddress,
                        CreatedAt = DateTime.UtcNow,
                        UpdatedAt = DateTime.UtcNow
                    };
                    toCreate.Add(task);
                }
                created += qtyForThisTech;
                remainingToAssign -= qtyForThisTech;
                stagedCounts[tech.Id] += qtyForThisTech;

                if (request.MaxToCreate.HasValue && created >= request.MaxToCreate.Value) break;
            }
            if (request.MaxToCreate.HasValue && created >= request.MaxToCreate.Value) break;
        }

        if (toCreate.Count == 0)
            return Ok(new { success = true, created = 0, message = "Oluşturulacak task yok" });

        _context.InstallationTasks.AddRange(toCreate);
        await _context.SaveChangesAsync(ct);

        // Produce Activity: Assigned per created task
        var activities = toCreate
            .Where(t => t.AssignedTechnicianId != null)
            .Select(t => new Activity
            {
                ServiceId = t.ServiceId,
                Type = ActivityType.Assigned,
                Payload = System.Text.Json.JsonSerializer.Serialize(new
                {
                    field = "AssignedTechnician",
                    oldValue = (string?)null,
                    newValue = t.AssignedTechnicianId?.ToString(),
                    reason = "Montaj görevi planlandı ve atandı",
                    metadata = new { taskId = t.Id }
                }),
                CreatedAt = DateTime.UtcNow
            }).ToList();
        if (activities.Count > 0)
        {
            _context.Activities.AddRange(activities);
            await _context.SaveChangesAsync(ct);
        }

        await NotifyTaskAssignmentsAsync(toCreate, ct);

        // Summary metrics
        var loads = stagedCounts.Select(kv => kv.Value + (poolWithLoad.First(x => x.Tech.Id == kv.Key).Load)).ToList();
        var maxLoad = loads.Count == 0 ? 0 : loads.Max();
        var minLoad = loads.Count == 0 ? 0 : loads.Min();
        var balancedScore = loads.Count <= 1 ? 1.0 : 1.0 - ((double)(maxLoad - minLoad) / Math.Max(1, maxLoad));
        var summary = new
        {
            created = toCreate.Count,
            averageDistance = distCount == 0 ? (double?)null : totalDistance / distCount,
            balancedScore = Math.Round(balancedScore, 2),
            maxTechnicianLoad = maxLoad,
            minTechnicianLoad = minLoad
        };

        return Ok(new { success = true, created = toCreate.Count, summary, debug, SmartAssignVersion });
    }

    public class UpdateTaskStatusRequest
    {
        public string Status { get; set; } = string.Empty;
        public string? Reason { get; set; }
        public string? CorrelationId { get; set; }
        public string? CustomAddress { get; set; }

        /// <summary>
        /// TEKNİSYEN VE PLANLANAN GÜN KORUNSUN (Montaj Geçmişi ekranı, 2026-08-27 kullanıcı
        /// isteği: "durumu güncellerken işlem geçmişleri sıfırlanmaz").
        ///
        /// <para>Varsayılan davranış (false) DEĞİŞMEDİ: planlamaya geri düşüren dört durumda
        /// (Yeni Kayıt / Teslim Edildi / Ertelendi / Ulaşılamadı) satırın teknisyeni ve
        /// planlanan günü silinir — bu 2026-08-12'de konmuş bir kullanıcı kuralı ve planlama
        /// akışında böyle kalmalı.</para>
        ///
        /// <para>Montaj Geçmişi bir DEFTERDİR: oradaki amaç işi yeniden planlamak değil, yanlış
        /// işaretlenmiş bir durumu düzeltmek. Kim yaptı / ne zaman planlandı bilgisi silinirse
        /// defterin kendisi bozulur.</para>
        ///
        /// <para>SAHAYA AKTARIM DAMGASI BU BAYRAKLA DA SİLİNİR, kasıtlı: sekme ayrımını
        /// (<c>isPlanningTask</c> / <c>isFieldTask</c>) o damga yapıyor. Korunsaydı ertelenmiş
        /// satır ne planlamada ne teslimatta görünürdü — hiçbir listede olmayan öksüz satır.</para>
        /// </summary>
        public bool PreserveAssignment { get; set; }

        /// <summary>
        /// İŞLEM TARİHİ — geçmişe dönük veri toparlama (2026-09-17 kullanıcı isteği: "tarih
        /// seçilebilecek şekilde, geçmişe dönük eksik girilen veriler toparlanabilecek").
        ///
        /// <para>Boşsa davranış DEĞİŞMEZ: tarihler şu an olarak yazılır. Doluysa satırın iş
        /// tarihleri (başlama / tamamlanma) bu değerle yazılır; "Gerçekleşti"de hak ediş senkronu
        /// da <c>CompletedAt</c>'i okuduğu için hak ediş o güne düşer.</para>
        ///
        /// <para>Geçmiş kaydı (Activity) ŞU ANIN tarihiyle yazılmaya devam eder — kaydın ne zaman
        /// girildiği denetim bilgisidir, değiştirilmez; işlem tarihi metne ve metadata'ya eklenir.
        /// Gelecek tarih reddedilir.</para>
        /// </summary>
        public DateTime? EffectiveDate { get; set; }
    }

    [HttpPatch("tasks/{id:guid}/status")]
    public async Task<IActionResult> UpdateTaskStatus(Guid id, [FromBody] UpdateTaskStatusRequest request)
    {
        var task = await _context.InstallationTasks.Include(t => t.Service).Include(t => t.AssignedTechnician).FirstOrDefaultAsync(t => t.Id == id);
        if (task == null) return NotFound();
        // Durum güncellemesi Planlama ve Teslimat sekmelerinden yapılıyor; kapsam yalnızca üst
        // sayfadan okununca, o sekmelerde yetkili olan kullanıcı 403 alıyordu.
        var scope = await GetWidestScopeAsync(MontajTaskWritePages);

        // İKİ AYRI RET, İKİ AYRI KOD — karıştırılmamalı:
        //   sayfa yetkisi yok   -> 403. Kullanıcı "yetkin yok" mesajını görmeli; bu cevap
        //                          kaydın var olup olmadığı hakkında hiçbir şey söylemiyor.
        //   kayıt kapsam dışı   -> 404. Burada 403 dönmek kaydın GERÇEKTEN VAR olduğunu
        //                          doğrular ve kimlik taramasına kapı açar.
        // Bu ayrım tüm uçlarda aynı; ServiceRecordsController'daki RecordAccess ile aynı kural.
        if (!scope.CanAccess) return Forbid();
        if (!_permissions.ApplyInstallationTaskScope(_context.InstallationTasks.Where(t => t.Id == id), scope).Any()) return NotFound();

        var oldStatus = task.Status;
        if (!Enum.TryParse<InstallationTaskStatus>(request.Status, true, out var newStatus)) return BadRequest("Geçersiz status");

        // İptal ve "Ulaşılamadı" SEBEPSİZ yazılamaz: ikisi de sonradan "neden böyle oldu" diye
        // sorulan durumlar ve tek kaynağı bu alan. İptalde sebep zorunluluğu kalem ucunda
        // (CancelItem) zaten vardı; satır ucundan iptal edilince sebepsiz geçebiliyordu.
        if ((newStatus == InstallationTaskStatus.Cancelled || newStatus == InstallationTaskStatus.Unreachable)
            && string.IsNullOrWhiteSpace(request.Reason))
        {
            return BadRequest(new
            {
                success = false,
                message = newStatus == InstallationTaskStatus.Cancelled
                    ? "İptal sebebi zorunludur."
                    : "Ulaşılamama sebebi zorunludur (kapı açılmadı, adres yanlış, müşteri erteledi…)."
            });
        }

        // NOT ALANINA YALNIZCA GÖNDERİLDİYSE DOKUNULUR.
        //
        // Eskiden `null` gelmesi "notu sil" demekti: `reason` göndermeyen her çağrı (mobil, bir
        // betik, alanı boş bırakan ekran) PLANLAMADA girilen açıklamayı siliyordu. Ekran tarafı da
        // boş kalmasın diye sabit bir metin ("Montaj kalemi durumu güncellendi.") yolluyordu ve
        // kalemin gerçek notunun üstüne o sistem mesajı biniyordu — Teslimattakiler ve Montaj
        // Geçmişi'nde görülen buydu (MONTAJ-DEVIR §8.1). Alan gönderilmediyse not korunur;
        // boş string gönderilirse (kullanıcı kutuyu temizlemiştir) not silinir.
        var noteChanged = request.Reason != null
            && !string.Equals(task.Notes ?? "", request.Reason, StringComparison.Ordinal);
        if (noteChanged) task.Notes = Blank(request.Reason);

        var addressChanged = !string.Equals(task.CustomAddress ?? "", request.CustomAddress ?? "", StringComparison.Ordinal);
        if (addressChanged) task.CustomAddress = request.CustomAddress;

        DateTime? effectiveDate = request.EffectiveDate.HasValue
            ? (request.EffectiveDate.Value.Kind == DateTimeKind.Unspecified
                ? DateTime.SpecifyKind(request.EffectiveDate.Value, DateTimeKind.Utc)
                : request.EffectiveDate.Value.ToUniversalTime())
            : null;
        // Saat farkı payı: istemci yerel öğleni gönderiyor, "bugün" hiç gönderilmiyor.
        if (effectiveDate.HasValue && effectiveDate.Value > DateTime.UtcNow.AddHours(14))
        {
            return BadRequest(new { success = false, message = "İşlem tarihi ileri bir gün olamaz." });
        }

        // Aynı durumda yalnızca TAMAMLANMA TARİHİ düzeltmesi: "Gerçekleşti" satırını doğru güne çek.
        var completedDateFix = effectiveDate.HasValue
            && oldStatus == InstallationTaskStatus.Completed
            && newStatus == InstallationTaskStatus.Completed
            && task.CompletedAt?.Date != effectiveDate.Value.Date;

        if (oldStatus == newStatus && !noteChanged && !addressChanged && !completedDateFix)
            return NoContent(); // duplicate guard

        var actionTime = effectiveDate ?? DateTime.UtcNow;
        task.Status = newStatus;
        task.UpdatedAt = DateTime.UtcNow;
        if (newStatus == InstallationTaskStatus.InProgress && (task.StartedAt == null || effectiveDate.HasValue)) task.StartedAt = actionTime;
        if (newStatus == InstallationTaskStatus.Completed && (task.CompletedAt == null || effectiveDate.HasValue)) task.CompletedAt = actionTime;
        if (completedDateFix) await MoveEarningDateForTaskAsync(task.Id, actionTime);
        // PLANLAMAYA GERİ DÜŞEN DURUMLAR (kullanıcı kuralı, 2026-08-12 — MONTAJ-DEVIR §8.8):
        //   Yeni Kayıt (Deferred)   -> planlamaya düşer
        //   Teslim Edildi (Delivered) -> planlamaya geri döner, statüsü "Teslim Edildi" kalır
        //   Ertelendi (Postponed)   -> planlamaya düşer
        //   Ulaşılamadı (Unreachable) -> gidildi yapılamadı; planlamaya geri düşer
        //
        // Dördünde de AKTARIM DAMGASI düşer — satır Teslimattakiler'den çıkıp planlamaya döner.
        // Sekme ayrımını yapan tek şey o damga ve satırın DURUMU; karşılığı istemcide
        // `montajPlanRows.UNPLANNED_STATES`, iki liste ayrışırsa satır iki sekmede birden ya da
        // hiçbirinde görünür.
        //
        // TEKNİSYEN VE PLANLANAN GÜN SİLİNMEZ (2026-09-09 kullanıcı kuralı: "teknisyen ve tarih
        // silinmesin").
        //
        // Eskiden bu dört durumda `AssignedTechnicianId` ve `PlannedAt` null'lanıyordu. Sonucu:
        // planlanmış, sahaya çıkmış, fişi basılmış bir satır geri çekildiğinde üzerinde tek bir
        // iz kalmıyor, ekranda hiç dokunulmamış bir satırdan ayırt edilemiyordu ("dünyanın işi
        // yapılmış ama Yeni Kayıt'ta görünüyor" şikâyeti — MNT-0000417-1, 09.09.2026). Artık
        // satır planlamaya son atanan kişisi ve son planlanan günüyle döner; planlamacı işi kime
        // geri vereceğini ve en son ne zamana verildiğini görür.
        //
        // BU BİR GÖSTERİM İZİDİR, CANLI PLAN DEĞİL. Satır durumu gereği plansız sayıldığı için
        // gün bazlı sorgular (kapasite/yük, gün süzgeci) korunan `PlannedAt`'i saymamalı —
        // `UnplannedTaskStates` o sorgularda süzgeç olarak kullanılıyor.
        var wasTransferred = task.TransferredAt != null;
        var assignmentCleared = false;

        if (newStatus == InstallationTaskStatus.Deferred || newStatus == InstallationTaskStatus.Delivered || newStatus == InstallationTaskStatus.Postponed || newStatus == InstallationTaskStatus.Unreachable)
        {
            // Geçmişe yazılacak TEK olay kaldı: satırın sahadan planlamaya dönmesi. Teknisyen
            // ve planlanan gün silinmediği için "kaldırıldı" diyecek bir şey yok.
            assignmentCleared = wasTransferred;

            task.TransferredAt = null;
            task.StartedAt = null;
            task.CompletedAt = null;
        }

        // Tamamlanma geri alındıysa damga da kalkar. Kalmasaydı "Planlandı ama tamamlanma tarihi
        // olan" satırlar oluşuyordu; hak ediş senkronu da o tarihi kullanıyor.
        if (oldStatus == InstallationTaskStatus.Completed && newStatus != InstallationTaskStatus.Completed)
        {
            task.CompletedAt = null;
            await ReverseEarningForTaskAsync(task.Id, $"Görev durumu {newStatus.ToTurkishString()} yapıldı.");
        }

        // Log Activity for task status change
        var siblingTasksForActivity = await _context.InstallationTasks
            .Where(t => t.ServiceId == task.ServiceId)
            .ToListAsync();

        var sortedTasks = siblingTasksForActivity
            .Where(t => t.Status != InstallationTaskStatus.Cancelled)
            .OrderBy(t => t.CreatedAt)
            .ToList();
        var index = sortedTasks.FindIndex(t => t.Id == task.Id);
        var suffixStr = index >= 0 && sortedTasks.Count > 1 ? $"-{index + 1}" : "";
        var taskDisplay = $"{task.Service.ServiceNumber}{suffixStr}";

        Guid? actorTechId = null;
        string? actorTechName = null;
        string? actorUserName = null;
        if (IsTechnicianUser())
        {
            actorTechId = await GetCurrentTechnicianIdAsync();
            actorTechName = task.AssignedTechnician?.FullName;
        }
        else
        {
            actorUserName = User.FindFirstValue(ClaimTypes.Name) ?? User.FindFirstValue("name") ?? User.Identity?.Name;
        }

        _context.Activities.Add(new Activity
        {
            ServiceId = task.ServiceId,
            Type = ActivityType.StatusChanged,
            CorrelationId = request.CorrelationId,
            ActorTechnicianId = actorTechId,
            ActorTechnicianName = actorTechName,
            ActorUserName = actorUserName,
            Payload = System.Text.Json.JsonSerializer.Serialize(new
            {
                field = $"InstallationTask.{task.Id}.Status",
                oldValue = oldStatus.ToTurkishString(),
                newValue = newStatus.ToTurkishString(),
                // Geçmiş satırının metni: not YOKSA "Not:" diye boş bir kuyruk bırakılmaz —
                // kullanıcı geçmişte açıklama arıyor, sistem cümlesi değil (§8.1).
                reason = (newStatus == InstallationTaskStatus.Cancelled
                    ? $"İptal Nedeni: {Blank(request.Reason) ?? "-"}"
                    : Blank(request.Reason) is string note
                        ? $"{taskDisplay}: {newStatus.ToTurkishString()} — {note}"
                        : $"{taskDisplay}: {newStatus.ToTurkishString()}")
                    + (effectiveDate.HasValue ? $" (işlem tarihi: {effectiveDate.Value.ToLocalTime():dd.MM.yyyy})" : ""),
                metadata = new { taskId = task.Id, taskDisplay = taskDisplay, customAddress = request.CustomAddress, effectiveDate }
            }),
            CreatedAt = DateTime.UtcNow
        });

        // Satır sahadan geri çekildiyse bunu geçmişe TEK bir cümle olarak yazar.
        //
        // Eskiden burası "teknisyen (X), planlanan gün (…) kaldırıldı" diye de yazıyordu; o
        // temizlik 2026-09-09'da kaldırıldığı için (yukarıdaki nota bak) artık kaldırılan tek
        // şey aktarım damgası. Atanan kişi ve gün satırda DURUYOR — geçmişe "kaldırıldı" diye
        // yazmak, ekranda hâlâ görünen veriyle çelişirdi.
        if (assignmentCleared)
        {
            var korunanTechName = task.AssignedTechnicianId.HasValue
                ? (await _context.Technicians.AsNoTracking()
                    .Where(t => t.Id == task.AssignedTechnicianId.Value)
                    .Select(t => t.FullName)
                    .FirstOrDefaultAsync())
                : null;

            var kuyruk = new List<string>();
            if (!string.IsNullOrWhiteSpace(korunanTechName)) kuyruk.Add($"teknisyen ({korunanTechName})");
            if (task.PlannedAt.HasValue) kuyruk.Add($"planlanan gün ({task.PlannedAt.Value.ToLocalTime():dd.MM.yyyy})");

            _context.Activities.Add(new Activity
            {
                ServiceId = task.ServiceId,
                Type = ActivityType.StatusChanged,
                CorrelationId = request.CorrelationId,
                ActorTechnicianId = actorTechId,
                ActorTechnicianName = actorTechName,
                ActorUserName = actorUserName,
                Payload = System.Text.Json.JsonSerializer.Serialize(new
                {
                    field = $"InstallationTask.{task.Id}.TransferredAt",
                    oldValue = "transferred",
                    newValue = (string?)null,
                    reason = kuyruk.Count > 0
                        ? $"{taskDisplay}: {newStatus.ToTurkishString()} olduğu için sahadan planlamaya geri döndü; {string.Join(" ve ", kuyruk)} korundu."
                        : $"{taskDisplay}: {newStatus.ToTurkishString()} olduğu için sahadan planlamaya geri döndü.",
                    metadata = new { taskId = task.Id, taskDisplay = taskDisplay }
                }),
                CreatedAt = DateTime.UtcNow
            });
        }

        // Kalemin son yaşayan satırı da iptale düştüyse KALEMİ damgala. Damgasız bırakılırsa
        // `EnsureDeferredTasksForItemsAsync` eksik adedi görüp kalemi yeni "Yeni Kayıt"
        // satırlarıyla geri diriltir; iki iptal yolu (satır ve kalem) aynı yere varmalı.
        if (newStatus == InstallationTaskStatus.Cancelled && task.ServiceRecordItemId is Guid cancelledItemId)
        {
            var itemTasks = await _context.InstallationTasks
                .Where(t => t.ServiceRecordItemId == cancelledItemId)
                .ToListAsync();

            if (itemTasks.All(t => t.Status == InstallationTaskStatus.Cancelled))
            {
                var parentItem = await _context.ServiceRecordItems
                    .FirstOrDefaultAsync(i => i.Id == cancelledItemId);

                if (parentItem != null && parentItem.CancelledAt == null)
                {
                    parentItem.CancelledAt = DateTime.UtcNow;
                    parentItem.CancelReason = Blank(request.Reason) ?? "Kalemin bütün satırları iptal edildi.";
                    parentItem.UpdatedAt = DateTime.UtcNow;
                }
            }
        }

        /*
          İPTAL DAMGASI GERİ ALINABİLİR OLMALI (2026-09-10 kullanıcı bildirimi:
          "alttaki montaj satırını yeni kayda çekiyorum ama üst iptalde kalmaya devam ediyor").

          Yukarıdaki blok damgayı yalnızca KOYUYORDU; hiçbir yol onu kaldırmıyordu. Sonuç:
          kalemin son satırı iptal edilip damga basıldıktan sonra satır "Yeni Kayıt"a geri
          çekilse bile kalem sonsuza kadar iptal görünüyordu. Liste satırın durumuna değil
          kalemin damgasına bakıyor (`montajPlanRows`: `isCancelled = !!item?.cancelledAt`),
          dolayısıyla ekranda üst satır "İptal", alt satır "Yeni Kayıt" diye çelişiyordu.

          Kural simetrik: kalemin İPTAL DIŞINDA en az bir satırı varsa kalem iptal değildir.
          Damga da, sebebi de temizleniyor — sebep kalırsa bir sonraki iptalde eski gerekçe
          yeniden görünürdü.
        */
        if (newStatus != InstallationTaskStatus.Cancelled && task.ServiceRecordItemId is Guid revivedItemId)
        {
            var parentItem = await _context.ServiceRecordItems
                .FirstOrDefaultAsync(i => i.Id == revivedItemId);

            if (parentItem is { CancelledAt: not null })
            {
                parentItem.CancelledAt = null;
                parentItem.CancelReason = null;
                parentItem.UpdatedAt = DateTime.UtcNow;

                _context.Activities.Add(new Activity
                {
                    ServiceId = task.ServiceId,
                    Type = ActivityType.StatusChanged,
                    CorrelationId = request.CorrelationId,
                    ActorTechnicianId = actorTechId,
                    ActorTechnicianName = actorTechName,
                    ActorUserName = actorUserName,
                    Payload = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        field = $"ServiceRecordItem.{parentItem.Id}.CancelledAt",
                        oldValue = "cancelled",
                        newValue = (string?)null,
                        reason = $"{taskDisplay}: satır {newStatus.ToTurkishString()} yapıldığı için kalemin iptali geri alındı.",
                        metadata = new { itemId = parentItem.Id, taskId = task.Id }
                    }),
                    CreatedAt = DateTime.UtcNow
                });
            }
        }

        await _context.SaveChangesAsync();

        // Auto-update parent ServiceRecord's Status
        var serviceId = task.ServiceId;
        var siblingTasks = await _context.InstallationTasks
            .Where(t => t.ServiceId == serviceId)
            .ToListAsync();

        var activeTasks = siblingTasks
            .Where(t => t.Status != InstallationTaskStatus.Cancelled && t.Status != InstallationTaskStatus.Deferred)
            .ToList();

        // KAYIT "BİTTİ" SAYILMAZ — İŞİN TAMAMI BİTMEDEN.
        //
        // Kullanıcı hatası (2026-08-12): "montaj kabul ve montaj planlamadan direkt silindi;
        // oralardan sadece iş biterse silinir." Sebep aşağıdaki `activeTasks`in **Deferred'ı
        // DIŞARIDA bırakması**: 4 adetlik bir kaydın 1 adedi gerçekleşip kalan 3'ü hiç
        // planlanmamışsa (hepsi "Yeni Kayıt" = Deferred) `activeTasks` yalnızca [Completed]
        // oluyor, "hepsi tamamlandı" sanılıp kayıt `Ready`ye çekiliyordu. `Ready` Montaj
        // Planlama'nın durum listesinde YOK ve Montaj Kabul de onu varsayılan olarak gizliyor —
        // yani kayıt, 3 adetlik işi dururken iki ekrandan birden kayboluyordu.
        // Gerçek veriyle doğrulandı: MNT-0000042 → 1 Completed + 3 Deferred, kayıt Status=Ready.
        //
        // Doğru ölçüt: İPTAL DIŞINDAKİ HİÇBİR SATIR açık kalmamalı (Deferred / Teslim Edildi /
        // Ertelendi / Ulaşılamadı hepsi AÇIK sayılır — planlama bekliyorlar) VE kalemlerin
        // toplam adedi gerçekleşmiş olmalı. İkinci koşul, kalem adedi kadar satırın henüz
        // üretilmediği (EnsureDeferred okuma anında üretiyor) durumlara karşı.
        var liveTasks = siblingTasks
            .Where(t => t.Status != InstallationTaskStatus.Cancelled)
            .ToList();

        var openItemQuantity = await _context.ServiceRecordItems
            .Where(i => i.ServiceId == serviceId && i.CancelledAt == null)
            .SumAsync(i => i.Quantity);

        var completedQuantity = liveTasks
            .Where(t => t.Status == InstallationTaskStatus.Completed)
            .Sum(t => t.Quantity);

        var everythingDone = liveTasks.Count > 0
            && liveTasks.All(t => t.Status == InstallationTaskStatus.Completed)
            && (openItemQuantity == 0 || completedQuantity >= openItemQuantity);

        var serviceRecord = await _context.ServiceRecords.FirstOrDefaultAsync(s => s.Id == serviceId);
        if (serviceRecord != null)
        {
            var oldSrStatus = serviceRecord.Status;

            if (siblingTasks.All(t => t.Status == InstallationTaskStatus.Cancelled))
            {
                // All tasks are cancelled: set parent status to Cancelled
                if (serviceRecord.Status != ServiceStatus.Cancelled)
                {
                    serviceRecord.Status = ServiceStatus.Cancelled;
                    serviceRecord.UpdatedAt = DateTime.UtcNow;
                    
                    _context.Activities.Add(new Activity
                    {
                        ServiceId = serviceId,
                        Type = ActivityType.StatusChanged,
                        CorrelationId = request.CorrelationId,
                        ActorTechnicianId = task.AssignedTechnicianId,
                        ActorTechnicianName = task.AssignedTechnician?.FullName ?? "Sistem",
                        Payload = System.Text.Json.JsonSerializer.Serialize(new
                        {
                            field = "Status",
                            oldValue = oldSrStatus.ToString(),
                            newValue = ServiceStatus.Cancelled.ToString(),
                            reason = "Tüm montaj görevleri iptal edildiği için montaj durumu otomatik olarak 'İptal' yapıldı.",
                            metadata = new { serviceId = serviceId }
                        }),
                        CreatedAt = DateTime.UtcNow
                    });
                    await _context.SaveChangesAsync();
                }
            }
            else if (everythingDone)
            {
                if (serviceRecord.Status != ServiceStatus.Ready)
                {
                    serviceRecord.Status = ServiceStatus.Ready;
                    // Geçmiş tarihle kapatılan işte kayıt da o güne kapanır: satırların en geç
                    // tamamlanma anı. Normal akışta bu zaten "şimdi".
                    serviceRecord.CompletedAt = liveTasks.Max(t => t.CompletedAt) ?? DateTime.UtcNow;
                    serviceRecord.UpdatedAt = DateTime.UtcNow;
                    
                    _context.Activities.Add(new Activity
                    {
                        ServiceId = serviceId,
                        Type = ActivityType.StatusChanged,
                        CorrelationId = request.CorrelationId,
                        ActorTechnicianId = task.AssignedTechnicianId,
                        ActorTechnicianName = task.AssignedTechnician?.FullName ?? "Sistem",
                        Payload = System.Text.Json.JsonSerializer.Serialize(new
                        {
                            field = "Status",
                            oldValue = oldSrStatus.ToString(),
                            newValue = ServiceStatus.Ready.ToString(),
                            reason = "Tüm aktif montaj görevleri tamamlandığı için montaj durumu otomatik olarak 'Gerçekleşti' yapıldı.",
                            metadata = new { serviceId = serviceId }
                        }),
                        CreatedAt = DateTime.UtcNow
                    });
                    await _context.SaveChangesAsync();
                }
            }
            else if (activeTasks.Any() && activeTasks.Any(t => t.Status == InstallationTaskStatus.Postponed))
            {
                if (serviceRecord.Status != ServiceStatus.Delayed)
                {
                    serviceRecord.Status = ServiceStatus.Delayed;
                    serviceRecord.CompletedAt = null;
                    serviceRecord.UpdatedAt = DateTime.UtcNow;
                    
                    _context.Activities.Add(new Activity
                    {
                        ServiceId = serviceId,
                        Type = ActivityType.StatusChanged,
                        CorrelationId = request.CorrelationId,
                        ActorTechnicianId = task.AssignedTechnicianId,
                        ActorTechnicianName = task.AssignedTechnician?.FullName ?? "Sistem",
                        Payload = System.Text.Json.JsonSerializer.Serialize(new
                        {
                            field = "Status",
                            oldValue = oldSrStatus.ToString(),
                            newValue = ServiceStatus.Delayed.ToString(),
                            reason = "En az bir montaj görevi ertelendiği için durum otomatik olarak 'Ertelendi' yapıldı.",
                            metadata = new { serviceId = serviceId }
                        }),
                        CreatedAt = DateTime.UtcNow
                    });
                    await _context.SaveChangesAsync();
                }
            }
            // `Delivered` de kaydı Montaj Kabul'ün varsayılan görünümünden DÜŞÜRÜYOR (orası
            // Ready/Delivered kayıtları gizliyor). Bu yüzden "en az bir satır teslim edildi"
            // yetmez — Ready ile aynı kural: kaydın canlı satırlarının HEPSİ teslim edilmiş
            // olmalı. Aksi halde tek bir "Teslim Edildi" işareti, kalan işi olan kaydı ekrandan
            // siliyordu (Ready'deki hatanın ikizi).
            else if (liveTasks.Count > 0 && liveTasks.All(t => t.Status == InstallationTaskStatus.Delivered))
            {
                if (serviceRecord.Status != ServiceStatus.Delivered)
                {
                    serviceRecord.Status = ServiceStatus.Delivered;
                    serviceRecord.CompletedAt = null;
                    serviceRecord.UpdatedAt = DateTime.UtcNow;
                    
                    _context.Activities.Add(new Activity
                    {
                        ServiceId = serviceId,
                        Type = ActivityType.StatusChanged,
                        CorrelationId = request.CorrelationId,
                        ActorTechnicianId = task.AssignedTechnicianId,
                        ActorTechnicianName = task.AssignedTechnician?.FullName ?? "Sistem",
                        Payload = System.Text.Json.JsonSerializer.Serialize(new
                        {
                            field = "Status",
                            oldValue = oldSrStatus.ToString(),
                            newValue = ServiceStatus.Delivered.ToString(),
                            reason = "En az bir montaj görevi teslim edildiği için durum otomatik olarak 'Teslim Edildi' yapıldı.",
                            metadata = new { serviceId = serviceId }
                        }),
                        CreatedAt = DateTime.UtcNow
                    });
                    await _context.SaveChangesAsync();
                }
            }
            /*
              İPTALDEN GERİ DÖNÜŞ (2026-09-10 kullanıcı bildirimi: "alttaki montaj satırını
              yeni kayda çekiyorum ama üst iptalde kalmaya devam ediyor").

              Aşağıdaki kurtarma dalının koşulunda `Cancelled` YOKTU: kayıt bir kez iptale
              düştükten sonra satır canlandırılsa bile durumu hiç değişmiyordu. Ekranda üst
              satır "İptal", alt satır "Yeni Kayıt" diye çelişiyordu (liste kaydın durumuna da
              bakıyor: `montajPlanRows` → `record.status === 'Cancelled'`).

              Hedef durum satırların gerçek hâlinden türetiliyor — hepsini `Devam Ediyor`
              yapmak yanlış olurdu: yalnızca "Yeni Kayıt" satırı olan bir kayıtta hiçbir iş
              başlamamıştır, o kaydın Montaj Kabul/Planlama'da `Yeni Kayıt` olarak görünmesi
              gerekir.
            */
            else if (serviceRecord.Status == ServiceStatus.Cancelled && liveTasks.Count > 0)
            {
                var hedef =
                    liveTasks.Any(t => t.Status == InstallationTaskStatus.InProgress
                                    || t.Status == InstallationTaskStatus.Completed)
                        ? ServiceStatus.InRepair
                        : liveTasks.Any(t => t.Status == InstallationTaskStatus.Planned)
                            ? ServiceStatus.Planned
                            : ServiceStatus.New;

                serviceRecord.Status = hedef;
                serviceRecord.CompletedAt = null;
                serviceRecord.UpdatedAt = DateTime.UtcNow;

                _context.Activities.Add(new Activity
                {
                    ServiceId = serviceId,
                    Type = ActivityType.StatusChanged,
                    CorrelationId = request.CorrelationId,
                    ActorTechnicianId = task.AssignedTechnicianId,
                    ActorTechnicianName = task.AssignedTechnician?.FullName ?? "Sistem",
                    Payload = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        field = "Status",
                        oldValue = oldSrStatus.ToString(),
                        newValue = hedef.ToString(),
                        reason = $"İptal edilmiş kaydın bir satırı yeniden açıldığı için durum otomatik olarak '{hedef.ToTurkishString()}' yapıldı.",
                        metadata = new { serviceId = serviceId }
                    }),
                    CreatedAt = DateTime.UtcNow
                });
                await _context.SaveChangesAsync();
            }
            else
            {
                // If any active task is InProgress or Completed, but not all are completed:
                // Update service status to InRepair (2 - Devam Ediyor).
                if (serviceRecord.Status == ServiceStatus.Ready || serviceRecord.Status == ServiceStatus.Workshop || serviceRecord.Status == ServiceStatus.Delivered || serviceRecord.Status == ServiceStatus.Delayed)
                {
                    serviceRecord.Status = ServiceStatus.InRepair;
                    serviceRecord.CompletedAt = null;
                    serviceRecord.UpdatedAt = DateTime.UtcNow;
 
                    _context.Activities.Add(new Activity
                    {
                        ServiceId = serviceId,
                        Type = ActivityType.StatusChanged,
                        CorrelationId = request.CorrelationId,
                        ActorTechnicianId = task.AssignedTechnicianId,
                        ActorTechnicianName = task.AssignedTechnician?.FullName ?? "Sistem",
                        Payload = System.Text.Json.JsonSerializer.Serialize(new
                        {
                            field = "Status",
                            oldValue = oldSrStatus.ToString(),
                            newValue = ServiceStatus.InRepair.ToString(),
                            reason = "Bir veya daha fazla montaj görevi tekrar işleme alındığı için durum otomatik olarak 'Devam Ediyor' yapıldı.",
                            metadata = new { serviceId = serviceId }
                        }),
                        CreatedAt = DateTime.UtcNow
                    });
                    await _context.SaveChangesAsync();
                }
            }
        }

        // Buradaki İKİNCİ StatusChanged kaydı kaldırıldı.
        //
        // Tek bir durum değişikliği iki Activity yazıyordu (yukarıdaki ayrıntılı olan + buradaki),
        // ikisi de metadata.taskId taşıdığı için kalem geçmişi modalı ikisini birden listeliyor ve
        // her adım kullanıcıya ÇİFT görünüyordu. Ayrıntılı olan (taskDisplay, Türkçe durum adları,
        // iptalde "İptal Nedeni:" ön eki) korundu; bu sadeleştirilmiş kopya gereksizdi.
        return NoContent();
    }

    /// <summary>
    /// Tamamlanması geri alınan görevin hak edişini ters kayıtla kapatır.
    ///
    /// Hak ediş tek yönlüydü: görev tamamlanınca <c>TechnicianEarning</c> yazılıyor, tamamlanma
    /// geri alınınca satır olduğu yerde kalıyordu. İki sonucu vardı — (1) yapılmamış iş ödenmiş
    /// görünüyordu, (2) görev başka teknisyene atanıp tekrar tamamlandığında hak ediş senkronu
    /// aynı <c>SourceId</c>'yi zaten kayıtlı bulup İKİNCİ kişiye hiç satır açmıyordu; yani işi
    /// yapan hiç alamıyordu.
    ///
    /// Satır SİLİNMEZ, iptale çekilir: hak edişin doğup geri alındığı defterde okunabilir kalmalı.
    /// MUHASEBEYE İŞLENMİŞ (<see cref="EarningStatus.PostedToLedger"/>) satıra dokunulmaz —
    /// onu geri almak bir muhasebe kararıdır, ekranın kendiliğinden yapacağı iş değil; yalnızca
    /// üzerine uyarı notu düşülür ki hak ediş ekranında gözden kaçmasın.
    /// </summary>
    private async Task ReverseEarningForTaskAsync(Guid taskId, string reason)
    {
        var earnings = await _context.TechnicianEarnings
            .Where(e => e.SourceType == EarningSourceType.InstallationTask
                        && e.SourceId == taskId
                        && e.Status != EarningStatus.Cancelled)
            .ToListAsync();

        if (earnings.Count == 0) return;

        void AppendNote(TechnicianEarning e, string text) =>
            e.Notes = string.IsNullOrWhiteSpace(e.Notes) ? text : $"{e.Notes}\n{text}";

        var cancelledIds = new List<Guid>();
        foreach (var earning in earnings)
        {
            if (earning.Status == EarningStatus.PostedToLedger)
            {
                AppendNote(earning, $"UYARI: iş geri alındı ({reason}) ancak hak ediş muhasebeye işlenmiş — elle düzeltilmeli.");
                continue;
            }

            earning.Status = EarningStatus.Cancelled;
            AppendNote(earning, $"Otomatik iptal: {reason}");
            cancelledIds.Add(earning.Id);
        }

        if (cancelledIds.Count == 0) return;

        // Defterdeki karşılığı da kapanmalı, aksi halde personel ekstresi hâlâ alacak gösterir.
        // Bağ EarningsController.SyncLedgerForEarningAsync ile aynı: (EntryType, SourceId).
        var ledgerRows = await _context.TechnicianLedgerEntries
            .Where(l => l.EntryType == LedgerEntryType.Earning
                        && l.SourceId != null
                        && cancelledIds.Contains(l.SourceId.Value))
            .ToListAsync();
        _context.TechnicianLedgerEntries.RemoveRange(ledgerRows);
    }

    /// <summary>
    /// Tamamlanma tarihi düzeltilen görevin hak edişini de aynı güne taşır.
    ///
    /// Hak ediş satırı görev tamamlandığında (senkronla) eski tarihle yazılmış olabilir; yalnız
    /// görevin tarihi değişirse personel ekstresi ile montaj geçmişi farklı gün gösterir.
    /// Muhasebeye işlenmiş satıra dokunulmaz (bkz. <see cref="ReverseEarningForTaskAsync"/>).
    /// </summary>
    private async Task MoveEarningDateForTaskAsync(Guid taskId, DateTime completedAt)
    {
        var earnings = await _context.TechnicianEarnings
            .Where(e => e.SourceType == EarningSourceType.InstallationTask
                        && e.SourceId == taskId
                        && e.Status != EarningStatus.Cancelled
                        && e.Status != EarningStatus.PostedToLedger)
            .ToListAsync();
        if (earnings.Count == 0) return;

        foreach (var earning in earnings) earning.CompletedAt = completedAt;

        var ids = earnings.Select(e => e.Id).ToList();
        var ledgerRows = await _context.TechnicianLedgerEntries
            .Where(l => l.EntryType == LedgerEntryType.Earning && l.SourceId != null && ids.Contains(l.SourceId.Value))
            .ToListAsync();
        foreach (var row in ledgerRows) row.EntryDate = completedAt;
    }

    // Manual allocation: explicit quantities per technician
    public class ManualAllocateRequest
    {
        public DateTime? PlannedDateUtc { get; set; }
        public Guid? RegionId { get; set; }
        public List<AllocationItem> Allocations { get; set; } = new();
        public int? TotalQuantity { get; set; }
    }
    public class AllocationItem
    {
        public Guid ServiceId { get; set; }
        /// <summary>Planlanan kalem. Boş gelirse kaydın ilk kalemine yazılır.</summary>
        public Guid? ServiceRecordItemId { get; set; }
        /// <summary>
        /// Atanan teknisyen. BOŞ/NULL GELEBİLİR (2026-08-25, kullanıcı isteği: "montaj ve
        /// arızada personel atamadan planlama yapabilmem lazım ki günü geldiğinde atayayım").
        /// Boşsa görev planlanır ama kimseye atanmaz; `InstallationTask.AssignedTechnicianId`
        /// zaten nullable olduğu için veritabanı tarafında değişiklik gerekmiyor.
        /// </summary>
        public Guid? TechnicianId { get; set; }
        public int Quantity { get; set; }
        public DateTime? PlannedDateUtc { get; set; }
        public int? Priority { get; set; }
        public int? EstimatedDurationMinutes { get; set; }
        public string? Notes { get; set; }
        public string? CustomAddress { get; set; }
    }

    /// <summary>
    /// Kaydın kalemlerindeki eksik adetleri "Yeni Kayıt" (Deferred) satırlarıyla eşitler:
    /// fazla kalanları siler, eksikleri açar. Eskiden bu hesap açıklamadaki "Miktar: N"
    /// üzerinden yapılıyordu ve her serviste kalan adet kadar satır üretildiği için
    /// birden fazla kayıt planlanınca satırlar çoğalıyordu.
    /// </summary>
    private async Task SyncDeferredTasksAsync(List<Guid> serviceIds, CancellationToken ct = default)
    {
        if (serviceIds.Count == 0) return;

        // İPTAL EDİLEN KALEM BURADAN DİRİLİYORDU. Kardeş metot EnsureDeferredTasksForItemsAsync
        // iptalleri eliyor, bu metot elemiyordu: kalemin bütün satırları Cancelled olduğu için
        // aşağıdaki hesap "hiç planlanmamış" sonucuna varıp eksik adedi yeni "Yeni Kayıt"
        // satırlarıyla geri açıyordu. Somut yol: bir kalemi iptal et → aynı faturanın başka bir
        // kalemini planla (Allocate bu metodu çağırır) → iptal edilen kalem planlamaya geri gelir.
        var items = await _context.ServiceRecordItems
            .Where(i => serviceIds.Contains(i.ServiceId) && i.CancelledAt == null)
            .ToListAsync(ct);

        var tasks = await _context.InstallationTasks
            .Where(t => serviceIds.Contains(t.ServiceId) && t.Status != InstallationTaskStatus.Cancelled)
            .ToListAsync(ct);

        var addresses = await _context.ServiceRecords
            .Where(s => serviceIds.Contains(s.Id))
            .Select(s => new { s.Id, s.CustomerAddress })
            .ToDictionaryAsync(x => x.Id, x => x.CustomerAddress, ct);

        var changed = false;
        foreach (var item in items)
        {
            var itemTasks = tasks.Where(t => t.ServiceRecordItemId == item.Id).ToList();
            var plannedQty = itemTasks.Where(t => t.Status != InstallationTaskStatus.Deferred 
                                              && t.Status != InstallationTaskStatus.Delivered 
                                              && t.Status != InstallationTaskStatus.Postponed
                                              && t.Status != InstallationTaskStatus.Unreachable).Sum(t => t.Quantity);
            
            var unplanned = itemTasks.Where(t => t.Status == InstallationTaskStatus.Deferred 
                                              || t.Status == InstallationTaskStatus.Delivered 
                                              || t.Status == InstallationTaskStatus.Postponed
                                              || t.Status == InstallationTaskStatus.Unreachable)
                                     .OrderBy(t => t.Status == InstallationTaskStatus.Deferred ? 0 
                                                 : t.Status == InstallationTaskStatus.Postponed ? 1 
                                                 : t.Status == InstallationTaskStatus.Unreachable ? 2 : 3)
                                     .ToList();

            var needed = Math.Max(0, item.Quantity - plannedQty);
            var have = unplanned.Sum(t => t.Quantity);

            if (have > needed)
            {
                // FAZLA SATIR SİLİNİRKEN GEÇMİŞİ OLAN EN SONA BIRAKILIR.
                //
                // `Activity` satırları göreve yalnızca `Payload.metadata.taskId` ile bağlı —
                // yabancı anahtar yok, yani görev silinince geçmiş satırı ortada kalır ve o
                // kalemin tarihçesi ekranda boşalır. Silinecek adayları "hiç dokunulmamış"
                // (oluşturulduğundan beri güncellenmemiş, dolayısıyla tarihçesi de olmayan)
                // satırlardan başlatmak, adet düşürüldüğünde gerçek iş geçmişinin yok olmasını
                // engelliyor. Sıra içindeki mevcut öncelik (Deferred → Postponed → Unreachable →
                // Delivered) korunuyor, yalnızca önüne bu ölçüt ekleniyor.
                var toRemove = have - needed;
                var removalOrder = unplanned
                    .OrderBy(t => t.UpdatedAt > t.CreatedAt ? 1 : 0)
                    .ToList();

                foreach (var u in removalOrder)
                {
                    if (toRemove <= 0) break;
                    _context.InstallationTasks.Remove(u);
                    toRemove -= u.Quantity;
                    changed = true;
                }
            }
            else if (have < needed)
            {
                addresses.TryGetValue(item.ServiceId, out var address);
                for (var i = have; i < needed; i++)
                {
                    _context.InstallationTasks.Add(new InstallationTask
                    {
                        ServiceId = item.ServiceId,
                        ServiceRecordItemId = item.Id,
                        Status = InstallationTaskStatus.Deferred,
                        Quantity = 1,
                        SerialNumber = item.SerialNumber,
                        CustomAddress = address,
                        CreatedAt = DateTime.UtcNow,
                        UpdatedAt = DateTime.UtcNow
                        // Notes KOPYALANMAZ. ServiceRecordItem.Notes webhook'ta TEK bir bayi
                        // açıklamasıdır ve faturanın bütün kalemlerine aynı metin yazılır
                        // (MontajController.dealerNote); kopyalanınca bir faturanın dört farklı
                        // kalemi Teslimattakiler'de birebir aynı notu gösteriyordu. Görev notu boş
                        // başlar, planlama/atama sırasında kasıtlı girilmedikçe dolmaz.
                    });
                    changed = true;
                }
            }
        }

        if (changed) await _context.SaveChangesAsync(ct);
    }

    [HttpPost("allocate")]
    public async Task<ActionResult<object>> Allocate([FromBody] ManualAllocateRequest request, CancellationToken ct)
    {
        // KAPI KURALI, aynı modalın diğer uçlarıyla AYNI olmalı.
        //
        // Burada `CanViewAll` aranıyordu, yani planlama yetkisi verilmiş ama "tüm işleri görme"
        // verilmemiş bir kullanıcı (tipik Servis Müdürü) butonları GÖRÜYOR, her tıklamada 403
        // alıyordu — üstelik durum güncelleme ucu (UpdateTaskStatus) aynı kullanıcıyı geçiriyordu.
        // Artık dört yazma ucu da aynı kapıdan geçiyor: sayfa açık mı + dokunulan kayıt kapsamda mı.
        var scope = await GetWidestScopeAsync(MontajTaskWritePages);
        if (!scope.CanAccess) return Forbid();

        var touchedServiceIds = request.Allocations.Select(a => a.ServiceId).Distinct().ToList();
        if (touchedServiceIds.Count == 0) return BadRequest(new { success = false, message = "Planlanacak satır yok." });

        var visibleServiceIds = await _permissions
            .ApplyServiceRecordScope(
                _context.ServiceRecords.AsNoTracking()
                    .Include(s => s.Dealer)
                    .Include(s => s.InstallationTasks)
                    .Where(s => touchedServiceIds.Contains(s.Id)),
                scope)
            .Select(s => s.Id)
            .ToListAsync(ct);

        if (visibleServiceIds.Count != touchedServiceIds.Count) return Forbid();

        // KAYIT BAŞINA KİLİT + TEK İŞLEM.
        //
        // Aşağıdaki "kalemde kaç adet kaldı" hesabı okunduktan sonra satırlar yazılana kadar
        // araya başka bir planlama girebiliyordu: iki planlayıcının ekranı da "3 kaldı" der,
        // ikisi de geçer, kalem 6 adet planlanmış olurdu. Kilit aynı kayıt için ikinci çağrıyı
        // bekletiyor. Ayrıca metot birkaç kez SaveChanges çağırıyor; tek işlem olmadan ortada
        // bir hata görevleri yazılmış ama kayıt durumu güncellenmemiş hâlde bırakıyordu.
        await using var tx = await _context.Database.BeginTransactionAsync(ct);
        foreach (var lockedId in touchedServiceIds.OrderBy(x => x))
        {
            // Sıralı kilitleme: iki istek farklı sırayla kilit alırsa karşılıklı beklemeye girer.
            var lockKey = BitConverter.ToInt64(lockedId.ToByteArray(), 0);
            await _context.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({lockKey})", ct);
        }

        // Load technicians referenced
        var techIds = request.Allocations
            .Where(a => a.TechnicianId.HasValue && a.TechnicianId.Value != Guid.Empty)
            .Select(a => a.TechnicianId!.Value)
            .Distinct()
            .ToList();
        var techs = await _context.Technicians.Where(t => techIds.Contains(t.Id)).ToListAsync(ct);
        var techMap = techs.ToDictionary(t => t.Id, t => t);

        // TEKNİSYEN KAPASİTESİ BURADA HESAPLANMAZ.
        //
        // Atama sınırı kullanıcı isteğiyle kaldırıldı (bkz. PlanBulk'tan farkı: ORASI kapasiteyi
        // hâlâ kullanıyor, çünkü otomatik dağıtımda teknisyen SEÇMEK için skor gerekiyor. Burada
        // teknisyeni kullanıcı seçiyor, dolayısıyla skora da sınıra da ihtiyaç yok).
        //
        // Sınır kalktıktan sonra hesap bir süre yerinde kaldı: günlük yük için üç ayrı sorgu
        // (servis + rota durağı + montaj görevi) her planlama isteğinde koşuyor, sonuç hiçbir
        // yerde kullanılmıyor ve yanıttaki `unassignedReasons.capacity` hep 0 dönüyordu.
        // Üç sorgu da, hep-0 alanlar da kaldırıldı.

        int created = 0;
        int rejectedMissingTech = 0;

        var tasks = new List<InstallationTask>();
        var rejectedAllocations = new List<object>();
        int acceptedCount = 0, rejectedCount = 0;

        var allocServiceIds = request.Allocations.Select(a => a.ServiceId).Distinct().ToList();
        var services = await _context.ServiceRecords
            .Where(s => allocServiceIds.Contains(s.Id))
            .Select(s => new { s.Id, s.CustomerAddress })
            .ToListAsync(ct);
        var serviceAddressMap = services.ToDictionary(s => s.Id, s => s.CustomerAddress);

        // Kalem gönderilmeyen istekler (eski istemci) kaydın ilk kalemine yazılır.
        var allocItems = await _context.ServiceRecordItems
            .Where(i => allocServiceIds.Contains(i.ServiceId))
            .OrderBy(i => i.SortOrder)
            .ToListAsync(ct);
        var firstItemByService = allocItems
            .GroupBy(i => i.ServiceId)
            .ToDictionary(g => g.Key, g => g.First());
        var itemById = allocItems.ToDictionary(i => i.Id);

        // KALEM BAŞINA KALAN ADET — sunucu tarafı sınır.
        //
        // Buraya kadar tek sınır istemcinin gönderdiği sayıydı (`toMake = group.Quantity`), yani
        // kalemin kendi adedi hiç kontrol edilmiyordu. İki sonucu vardı: (1) iki planlayıcı aynı
        // kalemi aynı anda planlayınca ikisinin de ekranı "3 kaldı" dediği için toplam 6 görev
        // açılıyordu, (2) uca elle quantity:999 yazan biri kalemi istediği kadar çoğaltabiliyordu.
        // Fazlalık ekranda GÖRÜNMÜYORDU da: remainingQuantity = max(0, adet - planlanan).
        // Load tracked tasks for touched services (non-cancelled) to reuse them and keep their history/IDs.
        var dbTasks = await _context.InstallationTasks
            .Where(t => allocServiceIds.Contains(t.ServiceId) && t.Status != InstallationTaskStatus.Cancelled)
            .ToListAsync(ct);

        var plannedByItem = dbTasks
            .Where(t => t.ServiceRecordItemId != null
                        && t.Status != InstallationTaskStatus.Deferred
                        && t.Status != InstallationTaskStatus.Delivered
                        && t.Status != InstallationTaskStatus.Postponed
                        && t.Status != InstallationTaskStatus.Unreachable)
            .GroupBy(t => t.ServiceRecordItemId!.Value)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Quantity));

        // Bu istek içinde birden çok satır aynı kaleme yazabiliyor (20 adedi 3 kişiye bölmek);
        // kalan, istek boyunca azalarak taşınmalı, yoksa her satır aynı kalanı görür.
        var remainingByItem = allocItems.ToDictionary(
            i => i.Id,
            i => Math.Max(0, i.Quantity - (plannedByItem.TryGetValue(i.Id, out var q) ? q : 0)));

        var newTasks = new List<InstallationTask>();
        var updatedTaskIds = new HashSet<Guid>();
        int rejectedOverAllocation = 0, rejectedUnknownItem = 0, rejectedCancelledItem = 0;

        foreach (var group in request.Allocations)
        {
            // PERSONELSIZ PLANLAMAYA IZIN VAR.
            //
            // Burasi eskiden kosulsuz "teknisyeni bulamadiysan satiri reddet" diyordu. Sonucu:
            // is bir gune planlanacaksa MUTLAKA o an bir kisi secilmek zorundaydi; kullanici
            // gunu gelince atamak istedigi isleri hic planlayamiyordu.
            //
            // Ayrim onemli: teknisyen GONDERILMEDIYSE (bos) bu bir tercih, gecerli. Teknisyen
            // GONDERILDI ama veritabaninda YOKSA bu bir hata -- eski reddi orada koruyoruz,
            // yoksa silinmis bir teknisyene planlanan is sessizce atanmamis hale duserdi.
            Technician? tech = null;
            var teknisyenIstendi = group.TechnicianId.HasValue && group.TechnicianId.Value != Guid.Empty;
            if (teknisyenIstendi && !techMap.TryGetValue(group.TechnicianId!.Value, out tech))
            {
                rejectedMissingTech += group.Quantity;
                rejectedAllocations.Add(new { technicianId = group.TechnicianId, requested = group.Quantity, accepted = 0, rejected = group.Quantity, reason = "MissingTechnician" });
                rejectedCount += group.Quantity;
                continue;
            }

            // Gönderilen kalem BU KAYDIN kalemi değilse istek reddedilir. Eskiden sessizce
            // kaydın İLK kalemine yazılıyordu: yanlış ürünü planlamış oluyordunuz ve hiçbir
            // uyarı almıyordunuz. Kalem hiç gönderilmediyse (eski istemci) ilk kaleme düşmek
            // hâlâ geçerli — o zaman kayıtta zaten tek kalem vardı.
            if (group.ServiceRecordItemId.HasValue
                && (!itemById.TryGetValue(group.ServiceRecordItemId.Value, out var requestedItem)
                    || requestedItem.ServiceId != group.ServiceId))
            {
                rejectedUnknownItem += group.Quantity;
                rejectedCount += group.Quantity;
                rejectedAllocations.Add(new { technicianId = group.TechnicianId, requested = group.Quantity, accepted = 0, rejected = group.Quantity, reason = "UnknownItem" });
                continue;
            }

            // CanInstall and region constraints are soft — log but don't hard-reject
            // (CanInstall may not be set correctly in DB; region check is informational)
            // Working hours check — soft constraint, log but don't reject
            // (removed hard rejection to allow planning at any time)

            var toMake = group.Quantity;

            var targetItemId = group.ServiceRecordItemId.HasValue
                ? group.ServiceRecordItemId
                : (firstItemByService.TryGetValue(group.ServiceId, out var firstItem) ? firstItem.Id : (Guid?)null);
            var targetItem = targetItemId.HasValue && itemById.TryGetValue(targetItemId.Value, out var ti) ? ti : null;

            // İptal edilmiş kalem planlanamaz. Ekran tarafında da süzülüyor ama tek kapı orası
            // olamaz: iptal ile planlama arasında geçen sürede başkası kalemi iptal etmiş olabilir.
            if (targetItem?.CancelledAt != null)
            {
                rejectedCancelledItem += group.Quantity;
                rejectedCount += group.Quantity;
                rejectedAllocations.Add(new { technicianId = group.TechnicianId, requested = group.Quantity, accepted = 0, rejected = group.Quantity, reason = "CancelledItem" });
                continue;
            }

            // Kalanı aşan kısım kırpılır ve rapor edilir; istek tümden reddedilmez, çünkü
            // toplu planlamada bir satırın fazlası yüzünden diğerlerini de kaybetmek istemiyoruz.
            if (targetItemId.HasValue && remainingByItem.TryGetValue(targetItemId.Value, out var itemRemaining))
            {
                if (toMake > itemRemaining)
                {
                    var over = toMake - itemRemaining;
                    rejectedOverAllocation += over;
                    rejectedCount += over;
                    rejectedAllocations.Add(new { technicianId = group.TechnicianId, requested = group.Quantity, accepted = itemRemaining, rejected = over, reason = "ExceedsItemQuantity" });
                    toMake = itemRemaining;
                }
                remainingByItem[targetItemId.Value] = itemRemaining - toMake;
            }

            if (toMake > 0)
            {
                // Find unplanned tasks of this item that haven't been reused in this request yet
                var availableTasks = dbTasks
                    .Where(t => t.ServiceRecordItemId == targetItemId
                                && !updatedTaskIds.Contains(t.Id)
                                && (t.Status == InstallationTaskStatus.Deferred
                                    || t.Status == InstallationTaskStatus.Delivered
                                    || t.Status == InstallationTaskStatus.Postponed
                                    || t.Status == InstallationTaskStatus.Unreachable))
                    .OrderBy(t => t.Status == InstallationTaskStatus.Deferred ? 0 
                                : t.Status == InstallationTaskStatus.Postponed ? 1 
                                : t.Status == InstallationTaskStatus.Unreachable ? 2 : 3)
                    .ToList();

                // Split into individual tasks of quantity 1
                for (int i = 0; i < toMake; i++)
                {
                    if (i < availableTasks.Count)
                    {
                        // Reuse existing task to preserve GUID (and thus timeline history)
                        var existingTask = availableTasks[i];
                        existingTask.AssignedTechnicianId = tech?.Id;
                        existingTask.PlannedAt = group.PlannedDateUtc ?? request.PlannedDateUtc ?? DateTime.UtcNow;
                        existingTask.Status = InstallationTaskStatus.Planned;
                        existingTask.Priority = group.Priority ?? 0;
                        existingTask.EstimatedDurationMinutes = group.EstimatedDurationMinutes;
                        existingTask.Notes = group.Notes;
                        existingTask.CustomAddress = !string.IsNullOrWhiteSpace(group.CustomAddress)
                            ? group.CustomAddress
                            : (serviceAddressMap.TryGetValue(group.ServiceId, out var addr) ? addr : null);
                        existingTask.UpdatedAt = DateTime.UtcNow;

                        tasks.Add(existingTask);
                        updatedTaskIds.Add(existingTask.Id);
                    }
                    else
                    {
                        // Create brand new task if we run out of unplanned tasks
                        var newTask = new InstallationTask
                        {
                            ServiceId = group.ServiceId,
                            ServiceRecordItemId = targetItemId,
                            AssignedTechnicianId = tech?.Id,
                            PlannedAt = group.PlannedDateUtc ?? request.PlannedDateUtc ?? DateTime.UtcNow,
                            Status = InstallationTaskStatus.Planned,
                            Quantity = 1,
                            Priority = group.Priority ?? 0,
                            EstimatedDurationMinutes = group.EstimatedDurationMinutes,
                            Notes = group.Notes,
                            SerialNumber = targetItem?.SerialNumber,
                            CustomAddress = !string.IsNullOrWhiteSpace(group.CustomAddress)
                                ? group.CustomAddress
                                : (serviceAddressMap.TryGetValue(group.ServiceId, out var addr) ? addr : null),
                            CreatedAt = DateTime.UtcNow,
                            UpdatedAt = DateTime.UtcNow
                        };
                        newTasks.Add(newTask);
                        tasks.Add(newTask);
                    }
                }
                created += toMake;
            }
            acceptedCount += toMake;
        }

        var serviceIdsInAlloc = request.Allocations.Select(a => a.ServiceId).Distinct().ToList();

        // Toplam talep artık kalemlerin miktar toplamı; kalan da bu toplamdan hesaplanıyor.
        var requestedTotal = allocItems.Count > 0
            ? allocItems.Sum(i => i.Quantity)
            : (request.TotalQuantity ?? request.Allocations.Sum(a => a.Quantity));

        var alreadyPlannedQty = await _context.InstallationTasks.AsNoTracking()
            .Where(t => serviceIdsInAlloc.Contains(t.ServiceId)
                     && t.Status != InstallationTaskStatus.Deferred
                     && t.Status != InstallationTaskStatus.Delivered
                     && t.Status != InstallationTaskStatus.Postponed
                     && t.Status != InstallationTaskStatus.Unreachable
                     && t.Status != InstallationTaskStatus.Cancelled)
            .SumAsync(t => t.Quantity, ct);

        var plannedQty = tasks.Sum(t => t.Quantity);
        var remaining = Math.Max(0, requestedTotal - (alreadyPlannedQty + plannedQty));

        if (tasks.Count == 0)
        {
            return Ok(new
            {
                success = true,
                created = 0,
                summary = new { created = 0 },
                // capacity / region / workingHours / skill alanları kaldırıldı: hiçbir yerde
                // artırılmıyorlardı, yani yanıtta hep 0 duruyor ve "hiç reddedilmedi" diye
                // okunuyorlardı. Kalanların hepsi gerçekten sayılıyor.
                unassignedReasons = new { missingTechnician = rejectedMissingTech, overAllocation = rejectedOverAllocation, unknownItem = rejectedUnknownItem, cancelledItem = rejectedCancelledItem },
                acceptedCount = 0,
                rejectedCount,
                partialSuccess = false,
                rejectedAllocations,
                plannedCount = 0,
                deferredCount = remaining,
                SmartAssignVersion
            });
        }

        if (newTasks.Count > 0)
        {
            _context.InstallationTasks.AddRange(newTasks);
        }
        await _context.SaveChangesAsync(ct);

        // Bildirim COMMIT SONRASINA bırakıldı (aşağıda): işlem geri alınırsa teknisyenin
        // telefonu var olmayan bir işi okumuş olurdu — geri alınamaz tek yan etki bu.

        // Kalan adetler kalem bazında "Yeni Kayıt" satırı olarak durur.
        await SyncDeferredTasksAsync(serviceIdsInAlloc, ct);

        // If all quantity planned (remaining == 0), move ServiceRecord to Workshop (active installation)
        var serviceIds = tasks.Select(t => t.ServiceId).Distinct().ToList();
        var serviceRecords = await _context.ServiceRecords
            .Where(s => serviceIds.Contains(s.Id))
            .ToListAsync(ct);

        // Sahada satırı olan kayıt Planned'a DÜŞÜRÜLMEZ.
        //
        // Burası koşulsuz `sr.Status = Planned` yapıyordu. Kayıt durumu 2026-08-10'dan beri tek
        // bir soruyu yanıtlıyor: "bu faturanın sahada işi var mı" (bkz. MONTAJ-DEVIR §5.2). Kısmen
        // aktarılmış (Workshop) bir kaydın ikinci kalemini planlamak, kaydı "sahada işi yok"a
        // çekiyordu — mobilin bekleyen sekmesi (New,Planned) ve sahadaki iş sayan her ekran
        // bundan etkileniyordu. Aktarımı geri almanın yolu "Planlamaya Geri Gönder", planlama değil.
        var stillInFieldByService = (await _context.InstallationTasks.AsNoTracking()
                .Where(t => serviceIds.Contains(t.ServiceId)
                            && t.TransferredAt != null
                            && t.Status != InstallationTaskStatus.Cancelled)
                .Select(t => t.ServiceId)
                .Distinct()
                .ToListAsync(ct))
            .ToHashSet();

        foreach (var sr in serviceRecords)
        {
            // Do NOT auto-promote to Workshop either: the user must click "Sahaya Aktar".
            if (!stillInFieldByService.Contains(sr.Id))
            {
                sr.Status = ServiceStatus.Planned;
            }

            if (request.PlannedDateUtc != null)
            {
                sr.PlannedAt = request.PlannedDateUtc;
                sr.EstimatedDeliveryDate = request.PlannedDateUtc;
            }
            sr.UpdatedAt = DateTime.UtcNow;
        }
        await _context.SaveChangesAsync(ct);

        /*
          "İŞLEMİ YAPAN PERSONEL: Sistem" HATASI (2026-08-27 kullanıcı bildirimi:
          "burda neden sistem diyor").

          Atama hareketi hiçbir aktör alanı doldurmuyordu; okuma tarafı
          (`ServiceRecordsController`) sırayla `ActorUserName` → `ActorTechnicianName` →
          teknisyen adı arıyor, üçü de boş kalınca "Sistem" yazıyordu. Planlamayı bir insan
          yapmıştı ama tarihçede izi yoktu.
        */
        Guid? aktorTechId = null;
        string? aktorUserName = null;
        if (IsTechnicianUser())
        {
            aktorTechId = await GetCurrentTechnicianIdAsync();
        }
        else
        {
            aktorUserName = User.FindFirstValue(ClaimTypes.Name)
                ?? User.FindFirstValue("name")
                ?? User.Identity?.Name;
        }

        // Produce activities for assignments
        var activities = tasks.Select(t => new Activity
        {
            ServiceId = t.ServiceId,
            Type = ActivityType.Assigned,
            ActorTechnicianId = aktorTechId,
            ActorUserName = aktorUserName,
            Payload = System.Text.Json.JsonSerializer.Serialize(new
            {
                field = "AssignedTechnician",
                oldValue = (string?)null,
                newValue = t.AssignedTechnicianId?.ToString(),
                reason = "Manuel montaj planlaması/ataması",
                metadata = new { taskId = t.Id }
            }),
            CreatedAt = DateTime.UtcNow
        }).ToList();
        _context.Activities.AddRange(activities);
        await _context.SaveChangesAsync(ct);

        // per-tech counts
        var perTech = tasks.Where(t => t.AssignedTechnicianId != null).GroupBy(t => t.AssignedTechnicianId!.Value).Select(g => new { technicianId = g.Key, count = g.Count() });
        var plannedCount = await _context.InstallationTasks.CountAsync(t => serviceIdsInAlloc.Contains(t.ServiceId) 
            && t.Status != InstallationTaskStatus.Deferred 
            && t.Status != InstallationTaskStatus.Delivered
            && t.Status != InstallationTaskStatus.Postponed
            && t.Status != InstallationTaskStatus.Unreachable
            && t.Status != InstallationTaskStatus.Cancelled, ct);
        var deferredCount = await _context.InstallationTasks.CountAsync(t => serviceIdsInAlloc.Contains(t.ServiceId) 
            && (t.Status == InstallationTaskStatus.Deferred 
                || t.Status == InstallationTaskStatus.Delivered
                || t.Status == InstallationTaskStatus.Postponed
                || t.Status == InstallationTaskStatus.Unreachable), ct);

        // Buraya kadar gelen her şey tek seferde kalıcı olur; kilit de burada bırakılır.
        await tx.CommitAsync(ct);

        // Ancak iş gerçekten kaydedildikten sonra duyurulur.
        await NotifyTaskAssignmentsAsync(tasks, ct);

        return Ok(new
        {
            success = true,
            created,
            distribution = perTech,
            // Hep 0 dönen capacity/region/workingHours/skill alanları kaldırıldı; yukarıdaki
            // erken dönüşteki gerekçenin aynısı.
            unassignedReasons = new { missingTechnician = rejectedMissingTech, overAllocation = rejectedOverAllocation, unknownItem = rejectedUnknownItem, cancelledItem = rejectedCancelledItem },
            acceptedCount,
            rejectedCount,
            partialSuccess = acceptedCount > 0 && rejectedCount > 0,
            rejectedAllocations,
            plannedCount,
            deferredCount,
            SmartAssignVersion
        });
    }

    public class UpdateInstallationTaskRequest
    {
        public Guid AssignedTechnicianId { get; set; }
        public DateTime PlannedAt { get; set; }
        public string? CustomAddress { get; set; }
        public string? Notes { get; set; }
    }

    [HttpPut("tasks/{id:guid}")]
    public async Task<IActionResult> UpdateInstallationTask(Guid id, [FromBody] UpdateInstallationTaskRequest request)
    {
        // UpdateTaskStatus ile aynı kapı: sayfa açık mı + bu satır kapsamda mı.
        var scope = await GetWidestScopeAsync(MontajTaskWritePages);
        if (!scope.CanAccess) return Forbid();
        if (!await _permissions.ApplyInstallationTaskScope(_context.InstallationTasks.Where(t => t.Id == id), scope).AnyAsync()) return NotFound();

        var task = await _context.InstallationTasks
            .Include(t => t.Service)
            .FirstOrDefaultAsync(t => t.Id == id);

        if (task == null) return NotFound();

        // İPTAL EDİLMİŞ satır bu uçtan DİRİLTİLEMEZ. Aşağıdaki blok Cancelled'ı da Planned'a
        // çeviriyordu: satırı düzenlemek (adres/not/teknisyen) iptali sessizce geri alıyordu.
        // İptali geri almak ayrı ve bilinçli bir karar olmalı, düzenlemenin yan etkisi değil.
        if (task.Status == InstallationTaskStatus.Cancelled)
        {
            return BadRequest(new { success = false, message = "İptal edilmiş satır düzenlenemez." });
        }

        // Tamamlanmış satırın ataması değiştirilemez: hak ediş o teknisyene yazılmış durumda,
        // kişiyi değiştirmek geçmişi yeniden yazmak olurdu. Önce tamamlanma geri alınmalı.
        if (task.Status == InstallationTaskStatus.Completed && task.AssignedTechnicianId != request.AssignedTechnicianId)
        {
            return BadRequest(new { success = false, message = "Gerçekleşmiş satırın teknisyeni değiştirilemez. Önce durumu geri alın." });
        }

        // Check if the technician exists
        var tech = await _context.Technicians.FindAsync(request.AssignedTechnicianId);
        if (tech == null) return BadRequest("Teknisyen bulunamadı.");

        // Bildirim yalnızca KİŞİ DEĞİŞTİYSE gider. Aynı satırın notunu/adresini düzeltmek de bu
        // ucu çağırıyor; her kayıtta bildirim üretmek teknisyenin telefonunu aynı işi defalarca
        // okutur hale getirirdi.
        var technicianChanged = task.AssignedTechnicianId != request.AssignedTechnicianId;

        // Apply changes
        task.AssignedTechnicianId = request.AssignedTechnicianId;
        task.PlannedAt = request.PlannedAt;
        task.CustomAddress = request.CustomAddress;
        task.Notes = request.Notes;
        task.UpdatedAt = DateTime.UtcNow;

        // Plansız satıra kişi/tarih verilmesi onu planlanmış yapar. Cancelled buradan ÇIKARILDI
        // (yukarıda zaten reddediliyor) — düzenleme iptali geri almamalı.
        if (task.Status == InstallationTaskStatus.Deferred)
        {
            task.Status = InstallationTaskStatus.Planned;
        }

        await _context.SaveChangesAsync();

        // Add activity log
        _context.Activities.Add(new Activity
        {
            ServiceId = task.ServiceId,
            Type = ActivityType.StatusChanged,
            ActorUserName = User.FindFirstValue(ClaimTypes.Name),
            Payload = System.Text.Json.JsonSerializer.Serialize(new
            {
                field = "InstallationTask.Edit",
                reason = "Planlama satırı düzenlendi",
                metadata = new { taskId = task.Id }
            }),
            CreatedAt = DateTime.UtcNow
        });
        await _context.SaveChangesAsync();

        if (technicianChanged)
        {
            await NotifyTaskAssignmentsAsync(new[] { task }, HttpContext.RequestAborted);
        }

        return NoContent();
    }

    [HttpDelete("tasks/{id:guid}")]
    public async Task<IActionResult> DeleteInstallationTask(Guid id)
    {
        var scope = await GetWidestScopeAsync(MontajTaskWritePages);
        if (!scope.CanAccess) return Forbid();
        if (!await _permissions.ApplyInstallationTaskScope(_context.InstallationTasks.Where(t => t.Id == id), scope).AnyAsync()) return NotFound();

        var task = await _context.InstallationTasks
            .Include(t => t.Service)
            .FirstOrDefaultAsync(t => t.Id == id);

        if (task == null) return NotFound();

        var serviceId = task.ServiceId;
        _context.InstallationTasks.Remove(task);
        await _context.SaveChangesAsync();

        // Check if we need to add a Deferred task to cover the demand
        var service = await _context.ServiceRecords
            .Include(s => s.InstallationTasks)
            .FirstOrDefaultAsync(s => s.Id == serviceId);

        if (service != null)
        {
            // Silinen satırın adedi kaleme geri döner: eksik kalan adet "Yeni Kayıt" olarak açılır.
            await SyncDeferredTasksAsync(new List<Guid> { serviceId });

            var remainingTasks = await _context.InstallationTasks
                .Where(t => t.ServiceId == serviceId)
                .ToListAsync();

            // If there are no planned tasks left, reset the ServiceRecord status to New
            var hasPlanned = remainingTasks.Any(t => t.Status != InstallationTaskStatus.Deferred && t.Status != InstallationTaskStatus.Cancelled);
            if (!hasPlanned)
            {
                service.Status = ServiceStatus.New;
                service.PlannedAt = null;
                service.EstimatedDeliveryDate = null;
                await _context.SaveChangesAsync();
            }
        }

        return NoContent();
    }


    [HttpPost("tasks/{id:guid}/photo")]
    [RequestSizeLimit(15_000_000)]
    public async Task<IActionResult> UploadTaskPhoto(Guid id, IFormFile file, CancellationToken cancellationToken)
    {
        if (file == null || file.Length == 0) return BadRequest("Dosya zorunludur");
        if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)) return BadRequest("Sadece resim yüklenebilir");

        Guid? techId = null;
        string? techName = null;
        if (IsTechnicianUser())
        {
            techId = await GetCurrentTechnicianIdAsync();
            if (!techId.HasValue) return Forbid();
            var hasAccess = await _context.InstallationTasks.AnyAsync(t => t.Id == id && t.AssignedTechnicianId == techId.Value, cancellationToken);
            if (!hasAccess) return Forbid();
            techName = await _context.Technicians.AsNoTracking()
                .Where(t => t.Id == techId.Value)
                .Select(t => t.FullName)
                .FirstOrDefaultAsync(cancellationToken);
        }

        var task = await _context.InstallationTasks.Include(t => t.Service).FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (task == null) return NotFound();

        var safeName = $"{id:N}-{Guid.NewGuid():N}.webp";
        var folder = Path.Combine(AppContext.BaseDirectory, "uploads", "installation-tasks", id.ToString("N"));
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, safeName);
        using (var imageStream = file.OpenReadStream())
        using (var image = await SixLabors.ImageSharp.Image.LoadAsync(imageStream, cancellationToken))
        {
            // Eskiden yalnızca WebP'ye çevriliyordu, YENİDEN BOYUTLANDIRILMIYORDU: telefon
            // fotoğrafı (12 MP) tam çözünürlükte ~2 MB kalıyordu. Bu ölçekte (yüz binlerce
            // montaj fotoğrafı) diski tek başına şişiren şey buydu.
            //
            // Uzun kenar PhotoMaxEdge'e indiriliyor; küçük görsel BÜYÜTÜLMÜYOR (Max modu).
            // Tipik saha fotoğrafı ~150-250 KB'a düşüyor — belge amaçlı fazlasıyla yeterli.
            image.Mutate(x => x.Resize(new SixLabors.ImageSharp.Processing.ResizeOptions
            {
                Mode = SixLabors.ImageSharp.Processing.ResizeMode.Max,
                Size = new SixLabors.ImageSharp.Size(PhotoMaxEdge, PhotoMaxEdge)
            }));

            // EXIF atılıyor: hem yer kaplıyor hem de fotoğrafın GPS konumunu/cihaz bilgisini
            // taşıyor — bu görseller bayilere de açılabiliyor.
            image.Metadata.ExifProfile = null;

            await image.SaveAsWebpAsync(path, new SixLabors.ImageSharp.Formats.Webp.WebpEncoder
            {
                Quality = PhotoQuality
            }, cancellationToken);
        }

        var relativeUrl = $"/uploads/installation-tasks/{id:N}/{safeName}";
        
        if (string.IsNullOrWhiteSpace(task.PhotoUrl))
        {
            task.PhotoUrl = relativeUrl;
        }
        else
        {
            task.PhotoUrl = $"{task.PhotoUrl},{relativeUrl}";
        }
        
        task.UpdatedAt = DateTime.UtcNow;

        _context.Activities.Add(new Activity
        {
            ServiceId = task.ServiceId,
            Type = ActivityType.PhotoUploaded,
            ActorTechnicianId = techId,
            ActorTechnicianName = techName,
            ActorUserName = User.FindFirstValue(ClaimTypes.Name),
            Payload = System.Text.Json.JsonSerializer.Serialize(new
            {
                field = $"InstallationTask.{id}.PhotoUrl",
                oldValue = (string?)null,
                newValue = relativeUrl,
                reason = $"Montaj kalemi fotoğrafı yüklendi (Görev: {task.Notes ?? ""})",
                metadata = new { file.FileName, file.ContentType, file.Length, taskId = task.Id }
            }),
            CreatedAt = DateTime.UtcNow
        });
        await _context.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, url = relativeUrl });
    }

    /// <summary>
    /// Montaj kalemine yuklenmis TEK bir fotografi siler.
    /// </summary>
    /// <remarks>
    /// (2026-08-24, kullanici bildirimi: "fotograf silme yok, burada nasil silecegim".)
    ///
    /// Yukleme ucu <see cref="InstallationTask.PhotoUrl"/> alanina virgulle ekleme yapiyor;
    /// silme de ayni listeden TEK bir adresi cikariyor. Arayuz tarafinda cozulemezdi:
    /// gorsel zaten sunucuda ve kayda islenmis durumda.
    ///
    /// Yetki, yukleme ucuyla AYNI: teknisyen yalnizca kendi uzerine atanmis kalemin
    /// fotografini silebilir.
    ///
    /// Dosya diskten de siliniyor (montaj fotograflari disk maliyetinin buyuk kismi).
    /// Yol tuzagi: <paramref name="url"/> istemciden geliyor, dolayisiyla dogrudan dosya
    /// yolu olarak KULLANILAMAZ. Silinecek dosya, yalnizca bu kalemin kendi klasorunun
    /// altindaysa ve adi kayittaki adresle birebir esitse siliniyor.
    /// </remarks>
    [HttpDelete("tasks/{id:guid}/photo")]
    public async Task<IActionResult> DeleteTaskPhoto(Guid id, [FromQuery] string? url, CancellationToken cancellationToken)
    {
        var hedef = (url ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(hedef)) return BadRequest("Silinecek gorselin adresi zorunludur");

        Guid? techId = null;
        string? techName = null;
        if (IsTechnicianUser())
        {
            techId = await GetCurrentTechnicianIdAsync();
            if (!techId.HasValue) return Forbid();
            var hasAccess = await _context.InstallationTasks
                .AnyAsync(t => t.Id == id && t.AssignedTechnicianId == techId.Value, cancellationToken);
            if (!hasAccess) return Forbid();
            techName = await _context.Technicians.AsNoTracking()
                .Where(t => t.Id == techId.Value)
                .Select(t => t.FullName)
                .FirstOrDefaultAsync(cancellationToken);
        }

        var task = await _context.InstallationTasks.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
        if (task == null) return NotFound();

        var mevcut = (task.PhotoUrl ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .ToList();

        // Adres kayitta YOKSA 404: "sildim" deyip hicbir sey yapmamak, kullaniciyi
        // gorsel gitti sanmasina yol acar.
        if (!mevcut.Any(x => string.Equals(x, hedef, StringComparison.Ordinal)))
        {
            return NotFound("Bu gorsel kayitta bulunamadi");
        }

        var kalan = mevcut.Where(x => !string.Equals(x, hedef, StringComparison.Ordinal)).ToList();
        task.PhotoUrl = kalan.Count > 0 ? string.Join(",", kalan) : null;
        task.UpdatedAt = DateTime.UtcNow;

        _context.Activities.Add(new Activity
        {
            ServiceId = task.ServiceId,
            Type = ActivityType.System,
            ActorTechnicianId = techId,
            ActorTechnicianName = techName,
            ActorUserName = User.FindFirstValue(ClaimTypes.Name),
            Payload = System.Text.Json.JsonSerializer.Serialize(new
            {
                field = $"InstallationTask.{id}.PhotoDeleted",
                oldValue = hedef,
                newValue = (string?)null,
                reason = "Montaj kalemi fotografi silindi",
                metadata = new { taskId = task.Id, kalanGorsel = kalan.Count }
            }),
            CreatedAt = DateTime.UtcNow
        });

        await _context.SaveChangesAsync(cancellationToken);

        // Kayit guncellendikten SONRA dosya siliniyor: dosya silinip kayit yazilamazsa
        // ekranda duran ama acilmayan bir gorsel kalirdi.
        TryDeleteTaskPhotoFile(id, hedef);

        return Ok(new { success = true, remaining = kalan });
    }

    /// <summary>
    /// Fotograf dosyasini diskten siler. Silinemezse SESSIZ gecer: kayit zaten guncellendi,
    /// artik hicbir yerden gosterilmiyor; yetim dosya yuzunden istegi hataya dusurmek
    /// kullaniciya "silinmedi" dedirtirdi.
    /// </summary>
    private static void TryDeleteTaskPhotoFile(Guid taskId, string relativeUrl)
    {
        try
        {
            var klasor = Path.Combine(AppContext.BaseDirectory, "uploads", "installation-tasks", taskId.ToString("N"));
            var dosyaAdi = Path.GetFileName(relativeUrl);
            if (string.IsNullOrWhiteSpace(dosyaAdi)) return;

            var yol = Path.Combine(klasor, dosyaAdi);

            // YOL TUZAGI: `relativeUrl` istemciden geliyor. `Path.GetFileName` ".." gibi
            // parcalari zaten atiyor ama tam yol yine de kalemin kendi klasorunun altinda
            // mi diye sinaniyor — iki kapi, cunku yanlis dosya silmek geri alinamaz.
            var tamKlasor = Path.GetFullPath(klasor + Path.DirectorySeparatorChar);
            var tamYol = Path.GetFullPath(yol);
            if (!tamYol.StartsWith(tamKlasor, StringComparison.Ordinal)) return;

            if (System.IO.File.Exists(tamYol)) System.IO.File.Delete(tamYol);
        }
        catch
        {
            // yetim dosya birakmak, istegi patlatmaktan iyidir
        }
    }
}
