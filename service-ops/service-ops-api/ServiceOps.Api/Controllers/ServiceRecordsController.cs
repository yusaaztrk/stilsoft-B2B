using Npgsql;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using ServiceOps.Application.Dtos;
using ServiceOps.Application.Interfaces;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;
using ServiceOps.Api.Hubs;
using ServiceOps.Api.Services;
using System.Text.Json;
using SixLabors.ImageSharp;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ServiceRecordsController : ControllerBase
{
    private readonly IServiceRecordService _service;
    private readonly ApplicationDbContext _context;
    private readonly IHubContext<ServiceOpsHub> _hub;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly IServiceOpsPermissionService _permissions;
    private readonly IJobAssignmentNotifier _assignmentNotifier;

    /// <summary>
    /// İşlem geçmişi / zaman çizelgesi görme yetkisi. İstemcideki ikizi
    /// <c>pagePermissions.ts → HISTORY_PAGE_KEY</c>; ikisi ayrışırsa buton görünür ama uç 403 verir.
    /// </summary>
    private const string HistoryPageKey = "servisGecmisi";

    public ServiceRecordsController(
        IServiceRecordService service,
        ApplicationDbContext context,
        IHubContext<ServiceOpsHub> hub,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        IServiceOpsPermissionService permissions,
        IJobAssignmentNotifier assignmentNotifier)
    {
        _service = service;
        _context = context;
        _hub = hub;
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _permissions = permissions;
        _assignmentNotifier = assignmentNotifier;
    }

    /// <summary>
    /// Servis kaydının atandığı teknisyene bildirim yollar.
    ///
    /// Atama <see cref="IServiceRecordService"/> içinde yapılıyor ama bildirim BURADA üretiliyor:
    /// bildirimci SignalR'a (Api katmanı) bağlı, Application katmanı ise Api'yi tanımıyor.
    /// Kaydın kendisi taze okunur — servis katmanı DTO döndürüyor ve alan adları tutmayabiliyor.
    /// </summary>
    private Task NotifyServiceAssignmentAsync(Guid serviceId, Guid? technicianId)
        => NotifyServiceAssignmentsAsync(new[] { (serviceId, technicianId) });

    /// <summary>
    /// Toplu atamayı TEK çağrıda duyurur.
    ///
    /// Kayıt kayıt çağırmak, bildirimcinin "kişi başına tek mesaj" toplamasını boşa çıkarırdı:
    /// 20 kaydı aynı teknisyene veren bir rota planı, telefonda 20 ayrı sesli okuma demekti.
    /// </summary>
    private async Task NotifyServiceAssignmentsAsync(IEnumerable<(Guid ServiceId, Guid? TechnicianId)> pairs)
    {
        var valid = pairs
            .Where(p => p.TechnicianId.HasValue && p.TechnicianId.Value != Guid.Empty)
            .ToList();
        if (valid.Count == 0) return;

        var serviceIds = valid.Select(p => p.ServiceId).Distinct().ToList();
        var records = await _context.ServiceRecords
            .AsNoTracking()
            .Where(r => serviceIds.Contains(r.Id))
            .Select(r => new { r.Id, r.ServiceNumber, r.CustomerName, r.ProductName, r.PlannedAt })
            .ToListAsync();
        var byId = records.ToDictionary(r => r.Id);

        var assignments = new List<JobAssignment>();
        foreach (var (serviceId, technicianId) in valid)
        {
            if (!byId.TryGetValue(serviceId, out var record)) continue;

            var parts = new[] { record.ServiceNumber, record.ProductName, record.CustomerName }
                .Where(p => !string.IsNullOrWhiteSpace(p));

            assignments.Add(new JobAssignment(
                technicianId!.Value,
                JobKind.Service,
                serviceId,
                string.Join(" · ", parts),
                1,
                record.PlannedAt));
        }

        await _assignmentNotifier.NotifyAsync(assignments, HttpContext.RequestAborted);
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

    private async Task<string> ResolvePerformerNameAsync()
    {
        // 1. Check Claims first (fullName / GivenName)
        var fullNameClaim = User.FindFirstValue("fullName") 
            ?? User.FindFirstValue(ClaimTypes.GivenName);

        if (!string.IsNullOrWhiteSpace(fullNameClaim))
        {
            return fullNameClaim.Trim();
        }

        var username = User.FindFirstValue(ClaimTypes.Name) 
            ?? User.FindFirstValue("name") 
            ?? User.Identity?.Name 
            ?? "";

        var techId = await GetCurrentTechnicianIdAsync();

        // 2. Check Technician by TechId
        if (techId.HasValue)
        {
            var tech = await _context.Technicians
                .AsNoTracking()
                .Where(t => t.Id == techId.Value)
                .Select(t => new { t.FirstName, t.LastName })
                .FirstOrDefaultAsync();
            if (tech != null && !string.IsNullOrWhiteSpace(tech.FirstName))
            {
                return $"{tech.FirstName} {tech.LastName}".Trim();
            }
        }

        if (!string.IsNullOrWhiteSpace(username))
        {
            var uLower = username.Trim().ToLowerInvariant();

            // 3. Check Technicians table by username / employee number
            var techByUser = await _context.Technicians
                .AsNoTracking()
                .Where(t => 
                    (t.UserId != null && t.UserId.ToLower() == uLower) || 
                    t.FirstName.ToLower() == uLower || 
                    t.EmployeeNumber.ToLower() == uLower)
                .Select(t => new { t.FirstName, t.LastName })
                .FirstOrDefaultAsync();

            if (techByUser != null && !string.IsNullOrWhiteSpace(techByUser.FirstName))
            {
                return $"{techByUser.FirstName} {techByUser.LastName}".Trim();
            }

            // 4. Check ServiceUsers table
            var serviceUser = await _context.ServiceUsers
                .AsNoTracking()
                .Include(u => u.Technician)
                .FirstOrDefaultAsync(u => u.Username.ToLower() == uLower);

            if (serviceUser?.Technician != null && !string.IsNullOrWhiteSpace(serviceUser.Technician.FirstName))
            {
                return $"{serviceUser.Technician.FirstName} {serviceUser.Technician.LastName}".Trim();
            }

            // 5. Query B2B ERP Users table
            try
            {
                var defaultConn = _configuration.GetConnectionString("DefaultConnection");
                if (!string.IsNullOrWhiteSpace(defaultConn))
                {
                    using var conn = new Npgsql.NpgsqlConnection(defaultConn);
                    await conn.OpenAsync();
                    using var cmd = conn.CreateCommand();
                    cmd.CommandText = @"SELECT ""Unvan"", ""FirstName"", ""LastName"" FROM ""Users"" 
                                        WHERE LOWER(""Username"") = @u OR LOWER(""Code"") = @u LIMIT 1;";
                    cmd.Parameters.AddWithValue("u", uLower);
                    using var reader = await cmd.ExecuteReaderAsync();
                    if (await reader.ReadAsync())
                    {
                        var unvan = reader.IsDBNull(0) ? null : reader.GetString(0);
                        var fName = reader.IsDBNull(1) ? null : reader.GetString(1);
                        var lName = reader.IsDBNull(2) ? null : reader.GetString(2);
                        if (!string.IsNullOrWhiteSpace(unvan)) return unvan.Trim();
                        if (!string.IsNullOrWhiteSpace(fName)) return $"{fName} {lName}".Trim();
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[ResolvePerformerName_B2B_Err] {ex.Message}");
            }

            // 6. Generic Title Case conversion for any username (e.g. hayri_demirci -> Hayri Demirci)
            var parts = uLower.Split(new[] { '.', '_', ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length > 0)
            {
                return string.Join(" ", parts.Select(p => System.Globalization.CultureInfo.CurrentCulture.TextInfo.ToTitleCase(p)));
            }
        }

        return "Hayri Demirci";
    }

    /// <summary>
    /// İstemcinin hangi sekmeyi sorduğunu bildirebildiği anahtarlar.
    ///
    /// Kapsam artık sekme başına tanımlı olduğu için ("atölyede her şeyi gör, teslimatta sadece
    /// kendini"), sunucunun hangi sekmenin sorulduğunu bilmesi gerekiyor. İstemciden gelen değer
    /// doğrudan yetki sorgusuna girdiği için serbest metin kabul edilmez: listede yoksa yok sayılır
    /// ve sayfanın kök anahtarına düşülür.
    /// </summary>
    private static readonly HashSet<string> AllowedScopeKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "buyukUrun.planlama",
        "buyukUrun.sahaPlanlama",
        "buyukUrun.atolye",
        "buyukUrun.hazirTeslimat",
        "buyukUrun.teslimattakiler",
        "atolyeAriza.atolye",
        "atolyeAriza.hazirTeslimat",
        "atolyeAriza.teslimattakiler",
        "montajYonetimi.planlama",
        "montajYonetimi.teslimat",
        "buyukEvAletleriKabul",
        "kucukUrunKabul",
        "montajKabul"
    };

    /// <summary>
    /// AYNI VERİYİ gösteren sayfa kökleri.
    ///
    /// Her satır bir "aile": aynı kayıt kümesini gösteren ama ayrı sayfa anahtarları ve ayrı
    /// yetkileri olan ekranlar. Kabul ekranı ile yönetim ekranı aynı kayıtlara bakar; hangisinde
    /// olduğunuz sunucudan anlaşılamaz (istemcinin gönderdiği tip/kategori süzgeçleri ikisinde de
    /// aynıdır), bu yüzden ekranın KENDİ anahtarını bildirmesi gerekir.
    ///
    /// Kapsama kuralı eskiden yalnızca "aynı kökün altındaki sekme"yi kabul ediyordu. Kabul
    /// ekranları kardeş köklerdir, alt sekme değil — dolayısıyla gönderdikleri anahtar sessizce
    /// yok sayılıyor ve kapsam yanlış sayfanın yetkisinden hesaplanıyordu. Görünen sonuç: yetkisi
    /// olan kullanıcıya "Kayıt bulunamadı" (doğrulandı 2026-08-10: Beyaz Eşya Kabul ve Küçük Ürün
    /// Kabul boş, aynı kayıtlar Beyaz Eşya ekranında görünüyordu).
    ///
    /// Aile DIŞINA çıkış hâlâ kapalı: bu, dar yetkili bir rolün başka bir sayfadaki geniş
    /// yetkisini buraya taşımasını engelleyen kontrol.
    /// </summary>
    private static readonly string[][] ScopeRootFamilies =
    {
        new[] { "montajKabul", "montajYonetimi" },
        new[] { "buyukEvAletleriKabul", "buyukUrun" },
        new[] { "kucukUrunKabul", "atolyeAriza" },
    };

    private static bool SameScopeFamily(string rootA, string rootB)
    {
        if (string.Equals(rootA, rootB, StringComparison.OrdinalIgnoreCase)) return true;

        foreach (var family in ScopeRootFamilies)
        {
            var hasA = family.Contains(rootA, StringComparer.OrdinalIgnoreCase);
            var hasB = family.Contains(rootB, StringComparer.OrdinalIgnoreCase);
            if (hasA && hasB) return true;
        }

        return false;
    }

    /// <summary>İstenen sekme anahtarı geçerliyse onu, değilse sayfanın kök anahtarını verir.</summary>
    private static string ResolveScopeKey(string? requested, string fallbackRootKey)
    {
        if (string.IsNullOrWhiteSpace(requested)) return fallbackRootKey;
        var trimmed = requested.Trim();
        if (!AllowedScopeKeys.Contains(trimmed)) return fallbackRootKey;

        // Sekme, sorulan sayfanın altında olmalı: '/atolye-ariza' ekranı 'buyukUrun.*' kapsamı
        // isteyemesin diye. Aksi halde dar yetkili bir rol, geniş yetkisi olduğu başka bir
        // sayfanın kapsamını bu ekrana taşıyabilirdi.
        var root = fallbackRootKey.Split('.')[0];
        if (trimmed.StartsWith($"{root}.", StringComparison.OrdinalIgnoreCase)) return trimmed;

        // Aynı aileden kardeş kök (kabul ekranı ↔ yönetim ekranı) kabul edilir.
        var requestedRoot = trimmed.Split('.')[0];
        if (SameScopeFamily(root, requestedRoot)) return trimmed;

        return fallbackRootKey;
    }

    /// <summary>
    /// Kullanıcı TEK bir cariye bağlıysa o kod, değilse null.
    ///
    /// Cari yetkisi tek bir değer değil: virgülle ayrılmış liste ve '*' "tüm cariler" demek
    /// (bkz. ServiceOpsScope.ParseDealerCodes). "Bu kullanıcının carisi" diye bir varsayılan
    /// ancak seçenek tekse anlamlıdır.
    /// </summary>
    private static string? ResolveSingleDealerCode(string? rawDealerCode)
    {
        var codes = ServiceOpsScope.ParseDealerCodes(rawDealerCode);
        if (codes.Count != 1) return null;
        return codes[0] == "*" ? null : codes[0];
    }

    /// <summary>
    /// Bir kök sayfanın kendisi + altındaki bütün sekmeler. Kapsam sorarken kök anahtarı TEK
    /// BAŞINA sormak yanlış sonuç verir, çünkü bu kurulumda "tümünü görme" kök sayfada değil
    /// ALT SEKMEDE veriliyor (ör. atolyeAriza.teslimattakiler.tumIsleriGorme var,
    /// atolyeAriza.tumIsleriGorme yok). Kök anahtara bakan kod müdürü "kendi işleri"ne düşürür,
    /// müdürün teknisyen kaydı da olmadığı için kapsam None olur ve liste SESSİZCE boş döner.
    /// </summary>
    private static string[] ExpandScopeKeys(string rootKey)
    {
        // Zaten bir sekme istenmişse genişletme: ekran hangi kapsamda çalıştığını bildirmiştir,
        // onu başka bir sekmenin daha geniş yetkisiyle şişirmek yetki taşıması olurdu.
        if (rootKey.Contains('.')) return new[] { rootKey };

        var keys = new List<string> { rootKey };
        keys.AddRange(AllowedScopeKeys.Where(k =>
            k.StartsWith($"{rootKey}.", StringComparison.OrdinalIgnoreCase)));
        return keys.ToArray();
    }

    /// <summary>
    /// Verilen anahtarların EN GENİŞİNİ seçer; InstallationsController.GetWidestScopeAsync ile
    /// aynı desen. Kapsamı genişletmez — kullanıcının zaten sahip olduğu en geniş yetkiyi bulur.
    /// Hiçbirinde yetkisi yoksa sonuç yine None'dır.
    /// </summary>
    private async Task<ServiceOpsScope> GetWidestRecordScopeAsync(params string[] pageKeys)
    {
        ServiceOpsScope? widest = null;

        foreach (var pageKey in pageKeys)
        {
            var scope = await _permissions.GetScopeAsync(User, pageKey);
            if (scope.CanViewAll) return scope;
            if (scope.CanAccess && widest is null) widest = scope;
        }

        return widest ?? new ServiceOpsScope(ServiceOpsScopeKind.None, null, null);
    }

    private async Task<(bool canViewAll, Guid? techFilter, string? dealerFilter)> GetRecordScopeFilterAsync(string moduleSubKey)
    {
        var pageKey = moduleSubKey
            .Replace(".tumIsleriGorme", "", StringComparison.OrdinalIgnoreCase)
            .Replace(".sadeceKendiIsleri", "", StringComparison.OrdinalIgnoreCase);

        // Kök anahtar geldiyse alt sekmeler de sorulur; sebebi ExpandScopeKeys'te yazılı.
        // Eskiden burada tek bir GetScopeAsync(pageKey) çağrısı vardı ve scopeKey göndermeyen
        // her çağrı (yeni bir ekran, bir betik, bir entegrasyon) müdür hesabıyla bile 200 + 0
        // kayıt alıyordu — hata bile vermediği için "veri yok" sanılıyordu.
        var scope = await GetWidestRecordScopeAsync(ExpandScopeKeys(pageKey));

        return scope.Kind switch
        {
            ServiceOpsScopeKind.All => (true, null, null),
            ServiceOpsScopeKind.OwnAssigned when scope.TechnicianId.HasValue => (false, scope.TechnicianId.Value, null),
            ServiceOpsScopeKind.OwnDealer when !string.IsNullOrWhiteSpace(scope.DealerCode) => (false, null, scope.DealerCode),
            _ => (false, Guid.Empty, "__NO_ACCESS__")
        };
    }

    /// <summary>
    /// Erişim reddinin SEBEBİ. İki durumu ayırmak, doğru HTTP kodunu seçebilmek için gerekli:
    ///
    ///   NoPagePermission -> 403. Kullanıcının o ekrana yetkisi yok; "yetkin yok" demek doğru
    ///                       ve bir bilgi sızdırmıyor, çünkü kaydın varlığından bağımsız.
    ///   OutOfScope       -> 404. Kayıt VAR ama bu kullanıcının kapsamında değil. Burada 403
    ///                       dönmek "böyle bir kayıt gerçekten var" bilgisini doğrular ve
    ///                       kimlik taramasına kapı açar; 404 hiçbir şey söylemez.
    ///
    /// İkisi tek bir bool'a katlanmıştı ve her çağrı yeri Forbid() dönüyordu. Sonuç tutarsızdı:
    /// aynı duruma /installations/items 404, /servicerecords/{id}/timeline 403 veriyordu ve
    /// istemci aynı olaya iki farklı tepki yazmak zorunda kalıyordu.
    /// </summary>
    private enum RecordAccess { Granted, NoPagePermission, OutOfScope }

    private async Task<RecordAccess> GetRecordAccessAsync(Guid id, string pageKey)
    {
        var scope = await _permissions.GetScopeAsync(User, pageKey);
        if (!scope.CanAccess) return RecordAccess.NoPagePermission;

        var query = _context.ServiceRecords
            .AsNoTracking()
            .Include(s => s.Dealer)
            .Include(s => s.InstallationTasks)
            .Where(s => s.Id == id);

        return await _permissions.ApplyServiceRecordScope(query, scope).AnyAsync()
            ? RecordAccess.Granted
            : RecordAccess.OutOfScope;
    }

    private async Task<bool> CanAccessServiceRecordAsync(Guid id, string pageKey)
        => await GetRecordAccessAsync(id, pageKey) == RecordAccess.Granted;

    /// <summary>
    /// Kaydı gösteren sayfalardan HERHANGİ BİRİ erişim veriyor mu?
    ///
    /// Sonuç Granted değilse sebebi de taşır: sayfalardan en az birine yetkisi VARDI ama kayıt
    /// hiçbirinin kapsamına girmediyse OutOfScope (404); hiçbirine yetkisi yoksa
    /// NoPagePermission (403).
    /// </summary>
    /// <summary>
    /// Kaydın YAZMA kapısı: kullanıcı bu kaydı herhangi bir sayfa/sekmeden görebiliyorsa geçer.
    ///
    /// SEKME ANAHTARLARI DA DENENİR (2026-08-25). Burada yalnızca ÇIPLAK sayfa anahtarları
    /// (`atolyeAriza`, `buyukUrun`, ...) deneniyordu. Oysa ekranlar sekme anahtarlarıyla
    /// korunuyor (`atolyeAriza.atolye`, `buyukUrun.sahaPlanlama`, ...) ve liste uçları da
    /// `scopeKey` olarak SEKME anahtarını gönderiyor.
    ///
    /// Sonuç: sekme anahtarı verilmiş ama ana anahtarı verilmemiş bir role (tipik "Servis
    /// Personeli") kayıtlar LİSTELENİYOR, ama durum güncellemesi 403 dönüyordu — kullanıcı
    /// işi ekranda görüyor, dokunamıyordu. Diğer roller (Müdür/Yönetim) ana anahtara da
    /// sahip olduğu için sorun görünmüyordu.
    ///
    /// Kapı GENİŞLEMİYOR: eklenen anahtarlar, aynı kaydı okumak için zaten yeterli olan
    /// anahtarların ta kendisi. "Görebiliyorsan durumunu güncelleyebilirsin" kuralı korunuyor;
    /// kapsam süzgeci (`ApplyServiceRecordScope`) her anahtar için ayrıca uygulanıyor.
    /// </summary>
    private static readonly string[] RecordAccessPageKeys = new[]
    {
        // Ana sayfa anahtarları
        "buyukUrun", "atolyeAriza", "montajYonetimi", "buyukEvAletleriKabul", "kucukUrunKabul",
        // Sekme anahtarları — ekranların ve liste uçlarının gerçekte kullandıkları
        "buyukUrun.planlama", "buyukUrun.sahaPlanlama", "buyukUrun.atolye",
        "buyukUrun.hazirTeslimat", "buyukUrun.teslimattakiler",
        "atolyeAriza.atolye", "atolyeAriza.hazirTeslimat", "atolyeAriza.teslimattakiler",
        "montajYonetimi.planlama", "montajYonetimi.teslimat"
    };

    private async Task<RecordAccess> GetRecordAccessFromAnyPageAsync(Guid id)
    {
        var sawPagePermission = false;

        foreach (var pageKey in RecordAccessPageKeys)
        {
            var access = await GetRecordAccessAsync(id, pageKey);
            if (access == RecordAccess.Granted) return RecordAccess.Granted;
            if (access == RecordAccess.OutOfScope) sawPagePermission = true;
        }

        return sawPagePermission ? RecordAccess.OutOfScope : RecordAccess.NoPagePermission;
    }

    /// <summary>
    /// Reddi doğru HTTP koduna çevirir; null dönerse erişim vardır.
    ///
    /// 403 SEBEBİNİ TAŞIR (2026-08-26). Çıplak <c>Forbid()</c> gövdesiz döndüğü için ekranda
    /// yalnızca "İstek başarısız (403)" görünüyordu; kullanıcı da, koda bakan da bunun sayfa
    /// yetkisinden mi başka bir kuraldan mı geldiğini ayırt edemiyordu. Mesaj hangi kapının
    /// kapandığını söyler, hangi kaydın olduğunu SÖYLEMEZ — görmeye yetkisi olmayan birine
    /// kaydın varlığını sızdırmaz.
    /// </summary>
    private ActionResult? DenyForRecord(RecordAccess access) => access switch
    {
        RecordAccess.Granted => null,
        RecordAccess.OutOfScope => NotFound(),
        _ => StatusCode(StatusCodes.Status403Forbidden, new
        {
            success = false,
            message = "Bu işlem için sayfa yetkiniz yok. Servis kayıtlarını gösteren sayfalardan (Beyaz Eşya Arıza, Atölye Arıza, Montaj Yönetimi, Kabul) en az birine yetki verilmelidir."
        })
    };

    private async Task<bool> CanAccessServiceRecordFromAnyPageAsync(Guid id)
        => await GetRecordAccessFromAnyPageAsync(id) == RecordAccess.Granted;

    /// <summary>
    /// Planlama / atama / silme gibi YÖNETİM işlemleri için kapı.
    ///
    /// Bu uçlarda tek kontrol `IsTechnicianUser()` idi ve bu AÇIK-BAŞARISIZ bir kuraldı:
    /// soru "yetkin var mı" değil "teknisyen misin" olduğu için, teknisyen olmayan ama hiçbir
    /// yetkisi de bulunmayan herkes (rolü tanınmayan kullanıcılar dahil) başkasının işini
    /// planlayabiliyor, kendine atayabiliyor ve kaydı silebiliyordu.
    ///
    /// Yeni kural: bu işlemler, servis yönetim sayfalarından en az birinde "tüm kayıtlar"
    /// kapsamı ister. Kendi işini gören saha personeli ya da kendi carisini gören bayi yetmez.
    /// </summary>
    private async Task<bool> CanManageRecordsAsync()
    {
        foreach (var pageKey in new[] { "buyukUrun", "atolyeAriza", "montajYonetimi", "buyukEvAletleriKabul", "kucukUrunKabul" })
        {
            var scope = await _permissions.GetScopeAsync(User, pageKey);
            if (scope.Kind == ServiceOpsScopeKind.All) return true;
        }
        return false;
    }

    /// <summary>
    /// Yönetim kapısının reddi — SEBEBİYLE birlikte.
    ///
    /// Çıplak <c>Forbid()</c> gövdesiz döndüğü için ekranda yalnızca "İstek başarısız (403)"
    /// görünüyordu. 2026-08-26'da tam bu yüzden bir gün kaybedildi: saha teknisyeni durum
    /// değiştiremiyordu, 403'ün hangi uçtan ve neden geldiği anlaşılamıyordu.
    /// </summary>
    private ActionResult DenyManage(string islem) =>
        StatusCode(StatusCodes.Status403Forbidden, new
        {
            success = false,
            message = $"Bu işlem ({islem}) yönetim yetkisi ister: servis sayfalarından birinde «Tüm İşleri Görme Yetkisi» açık olmalı."
        });

    private async Task<bool> CanAccessAnyPageAsync(params string[] pageKeys)
    {
        foreach (var pageKey in pageKeys)
        {
            var scope = await _permissions.GetScopeAsync(User, pageKey);
            if (scope.CanAccess) return true;
        }
        return false;
    }

    private async Task<bool> CheckUserSubPermissionAsync(string username, string tenantCode, string subKey)
    {
        try
        {
            var baseConn = _configuration.GetConnectionString("DefaultConnection") 
                           ?? _configuration.GetConnectionString("ServiceOpsBase");
            if (string.IsNullOrWhiteSpace(baseConn)) return false;

            var masterConnBuilder = new NpgsqlConnectionStringBuilder(baseConn) { Database = "b2b_erp_master" };
            string? b2bDbName = null;

            using (var conn = new NpgsqlConnection(masterConnBuilder.ConnectionString))
            {
                await conn.OpenAsync();
                using var cmd = new NpgsqlCommand("SELECT \"DbName\" FROM public.\"Tenants\" WHERE LOWER(\"Code\") = @tenantCode LIMIT 1", conn);
                cmd.Parameters.AddWithValue("tenantCode", tenantCode.ToLowerInvariant());
                b2bDbName = await cmd.ExecuteScalarAsync() as string;
            }

            if (string.IsNullOrWhiteSpace(b2bDbName)) b2bDbName = "b2b_erp";
            var tenantConnBuilder = new NpgsqlConnectionStringBuilder(baseConn) { Database = b2bDbName };

            using (var conn = new NpgsqlConnection(tenantConnBuilder.ConnectionString))
            {
                await conn.OpenAsync();
                using var cmd = new NpgsqlCommand(@"
                    SELECT COUNT(1)
                    FROM public.""Users"" u
                    INNER JOIN public.""RolePagePermissions"" rp ON u.""RoleId"" = rp.""RoleId""
                    INNER JOIN public.""Pages"" p ON rp.""PageId"" = p.""Id""
                    WHERE LOWER(u.""Username"") = @username 
                      AND u.""IsActive"" = true 
                      AND rp.""CanAccess"" = true 
                      AND p.""IsActive"" = true 
                      AND (p.""Key"" = @subKey OR p.""Key"" = @parentKey)", conn);

                var parentKey = subKey.Contains('.') ? subKey.Split('.')[0] + ".tumIsleriGorme" : subKey;
                cmd.Parameters.AddWithValue("username", username.ToLowerInvariant());
                cmd.Parameters.AddWithValue("subKey", subKey);
                cmd.Parameters.AddWithValue("parentKey", parentKey);

                var count = Convert.ToInt32(await cmd.ExecuteScalarAsync());
                return count > 0;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error checking sub-permission '{subKey}' for '{username}': {ex.Message}");
            return false;
        }
    }

    private async Task<bool> CanTechnicianAccessServiceAsync(Guid serviceId, Guid technicianId)
    {
        return await _context.ServiceRecords.AsNoTracking().AnyAsync(s => s.Id == serviceId && s.AssignedTechnicianId == technicianId)
            || await _context.InstallationTasks.AsNoTracking().AnyAsync(t => t.ServiceId == serviceId && t.AssignedTechnicianId == technicianId);
    }

    private static string GetTurkishStatus(string? status) => status switch
    {
        "New" => "Yeni Kayıt",
        "FieldPlanned" => "Saha Planlamasında",
        "Workshop" => "Atölyede",
        "InRepair" => "Tamirde",
        "WaitingForParts" => "Parça Bekliyor",
        "Ready" => "Hazır",
        "InDelivery" => "Teslimatta",
        "Delivered" => "Teslim Edildi",
        "Cancelled" => "İptal",
        "Delayed" => "Gecikti",
        "Planned" => "Saha Planlamasında",
        "SmallProductAcceptance" => "Küçük Ev Kabul",
        "WorkshopReady" => "Atölye Tamamlandı",
        "DeliveryPlanning" => "Teslimat Planlaması",
        "FieldCompleted" => "Sahada Tamamlandı",
        "LargeProductPlanning" => "Büyük Ürün Planlama",
        _ => status ?? "Bilinmiyor"
    };

    /// <summary>
    /// Durum/fotoğraf dışındaki bir <c>Activity</c> alanını okunabilir bir başlığa çevirir.
    ///
    /// Geçmiş listesi eskiden yalnızca durum ve fotoğraf olaylarını tanıyor, geri kalanı sessizce
    /// atıyordu. Tanımadığı alanı da göstermesi gerekiyor; kullanıcıya "InstallationTask.Edit"
    /// yazmak da bir şey anlatmadığı için tanınan alanlar isimlendiriliyor, tanınmayanlar
    /// genel bir başlığa düşüyor (kaybolmaktansa "Kayıt Güncellendi" demek yeğdir).
    ///
    /// Alan adı `InstallationTask.{guid}.X` biçiminde de gelebiliyor — GUID'i başlığa basmamak
    /// için son parça alınıyor.
    /// </summary>
    private static string DescribeActivityField(string? field, ActivityType type)
    {
        var leaf = field;
        if (!string.IsNullOrEmpty(leaf))
        {
            var lastDot = leaf.LastIndexOf('.');
            if (lastDot >= 0 && lastDot < leaf.Length - 1) leaf = leaf[(lastDot + 1)..];
        }

        return leaf switch
        {
            "AssignedTechnician" => "Teknisyen Atandı",
            "TechnicianId" => "Teknisyen Atandı",
            "PlannedAt" => "Planlama Tarihi Değişti",
            "PlannedDate" => "Planlama Tarihi Değişti",
            "CustomAddress" => "Adres Güncellendi",
            "Address" => "Adres Güncellendi",
            "Notes" => "Not Güncellendi",
            "Quantity" => "Miktar Güncellendi",
            "Edit" => "Kayıt Düzenlendi",
            "Invoice" => "Faturalandı",
            "InvoiceReference" => "Faturalandı",
            "TransferredAt" => "Sahaya Aktarıldı",
            "IsPrinted" => "Servis Fişi Basıldı",
            "Satisfaction" => "Memnuniyet Anketi",
            "SatisfactionScore" => "Memnuniyet Anketi",
            // Silme olayı bilerek `.PhotoUrl` ile BİTMİYOR: o son ek geçmişte "fotoğraf
            // kartı" dalını tetikliyor ve silinen görseli yeniden basmaya çalışırdı.
            "PhotoDeleted" => "Fotoğraf Silindi",
            _ => type switch
            {
                ActivityType.PhotoUploaded => "Fotoğraf Yüklendi",
                ActivityType.StatusChanged => "Durum Güncellendi",
                _ => "Kayıt Güncellendi"
            }
        };
    }

    /// <summary>
    /// Teknisyen atama olaylarında <c>newValue</c> ham GUID geliyor; geçmişte okunabilir olması
    /// için isme çevrilir. Çözülemezse <c>null</c> döner, çağıran ham değeri kullanır.
    /// </summary>
    private static string? ResolveTechnicianName(string? value, Dictionary<Guid, string> technicians)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        return Guid.TryParse(value, out var id) && technicians.TryGetValue(id, out var name) ? name : null;
    }

    /// <summary>
    /// Servis kaydının birleşik geçmişi. `taskId` verilirse yalnızca O KALEMİN adımları döner —
    /// montaj kayıtlarında bir fatura birden çok kalem taşıyabildiği için (bkz. "bir fatura = bir
    /// montaj kaydı" kuralı) kalem satırındaki "i" butonu artık kaydın TÜMÜNÜ değil, tıklanan
    /// kalemin kendi tarihçesini gösteriyor. Notlar/fotoğraflar kaleme bağlı tutulmadığı için
    /// `taskId` verildiğinde listeye girmez — yalnızca o kalemin durum geçişleri görünür.
    /// </summary>
    // Unified timeline for a service record: Activities + Notes + Photos
    [HttpGet("{id:guid}/timeline")]
    public async Task<ActionResult<List<object>>> GetTimeline(Guid id, [FromQuery] Guid? taskId = null)
    {
        // GEÇMİŞ GÖRME AYRI BİR YETKİ (kullanıcı kararı, 2026-08-13).
        //
        // Kaydı görebiliyor olmak, o kayıtta kimin neyi ne zaman değiştirdiğini görmeye yetmez:
        // servis personeli / klima / saha ekibi ve bayiler için `servisGecmisi` kapalı başlar.
        // Kapı SUNUCUDA: istemcideki "i" butonunu gizlemek yalnızca görünürlük, uç açık kalırsa
        // adres çubuğundan okunabilir.
        if (!await _permissions.HasPageAsync(User, HistoryPageKey))
        {
            return Forbid();
        }

        if (IsTechnicianUser())
        {
            var techId = await GetCurrentTechnicianIdAsync();
            if (!techId.HasValue) return Forbid();
            if (!await CanTechnicianAccessServiceAsync(id, techId.Value)) return NotFound();
        }

        var record = await _context.ServiceRecords
            .AsNoTracking()
            .Include(s => s.AssignedTechnician)
            .FirstOrDefaultAsync(s => s.Id == id);

        if (record == null) return NotFound();

        var techniciansDict = await _context.Technicians
            .AsNoTracking()
            .ToDictionaryAsync(t => t.Id, t => t.FullName);

        var activitiesRaw = await _context.Activities
            .AsNoTracking()
            .Where(a => a.ServiceId == id)
            .OrderBy(a => a.CreatedAt)
            .ToListAsync();

        var notesRaw = await _context.ServiceNotes
            .AsNoTracking()
            .Where(n => n.ServiceId == id)
            .OrderBy(n => n.CreatedAt)
            .ToListAsync();

        var events = new List<object>();

        foreach (var a in activitiesRaw)
        {
            string actorName = !string.IsNullOrWhiteSpace(a.ActorUserName) 
                ? a.ActorUserName 
                : (!string.IsNullOrWhiteSpace(a.ActorTechnicianName) 
                    ? a.ActorTechnicianName 
                    : (a.ActorTechnicianId.HasValue && techniciansDict.TryGetValue(a.ActorTechnicianId.Value, out var tName) ? tName : "Sistem"));

            string? field = null;
            string? oldValue = null;
            string? newValue = null;
            string? reason = null;
            Guid? eventTaskId = null;

            if (!string.IsNullOrWhiteSpace(a.Payload))
            {
                try
                {
                    using var doc = JsonDocument.Parse(a.Payload);
                    var root = doc.RootElement;
                    if (root.TryGetProperty("field", out var f)) field = f.GetString();
                    if (root.TryGetProperty("oldValue", out var ov)) oldValue = ov.GetString();
                    if (root.TryGetProperty("newValue", out var nv)) newValue = nv.GetString();
                    if (root.TryGetProperty("reason", out var r)) reason = r.GetString();
                    if (root.TryGetProperty("performedBy", out var pb) && !string.IsNullOrEmpty(pb.GetString()) && pb.GetString() != "Sistem") actorName = pb.GetString()!;
                    if (root.TryGetProperty("metadata", out var meta) && meta.ValueKind == JsonValueKind.Object
                        && meta.TryGetProperty("taskId", out var tidProp) && tidProp.TryGetGuid(out var parsedTaskId))
                    {
                        eventTaskId = parsedTaskId;
                    }
                }
                catch { }
            }

            if (string.IsNullOrWhiteSpace(actorName) || actorName == "Sistem")
            {
                actorName = !string.IsNullOrWhiteSpace(record.AssignedTechnician?.FullName) ? record.AssignedTechnician.FullName : "Sistem";
            }

            // KALEM GÖRÜNÜMÜ: yalnızca BAŞKA kalemlerin olayları elenir.
            //
            // Eskiden koşul `eventTaskId != taskId` idi ve bu, kaleme bağlı OLMAYAN her olayı da
            // (İlk Ürün Kabulü, "Montaj sahaya aktarıldı", faturalama, kaydın durum geçişleri)
            // eliyordu. Sonuç kullanıcının bildirdiği hataydı: teknisyen "Ertelendi"ye bastıktan
            // sonra kalemin geçmişinde yalnızca o tek satır kalıyor, ondan önce yapılmış her şey
            // ekrandan siliniyordu — veri duruyor, gösterim yutuyordu.
            // (DEMOTEST'te doğrulandı: MNT-0000051'in kabul + aktarım + planlama olayları
            // Activities'te duruyor ama kalem geçmişinde hiç görünmüyordu.)
            //
            // Yeni kural: kaleme bağlı olay YALNIZCA kendi kalemine, kayıt geneli olay HER
            // keleme girer — çünkü kaydın kabulü ve sahaya aktarımı o kalemin de geçmişidir.
            var belongsToAnotherTask = taskId.HasValue && eventTaskId.HasValue && eventTaskId != taskId.Value;
            if (belongsToAnotherTask) continue;

            // Kayıt geneli olay mı (kaleme bağlı değil) — ekranda ayrı rozetle gösterilir ki
            // kullanıcı "bu adım bu kaleme mi ait, faturanın tamamına mı" diye ayırt edebilsin.
            var isRecordLevel = taskId.HasValue && !eventTaskId.HasValue;

            // FOTOĞRAF ÖNCE SINANIR.
            //
            // Fotoğraf yükleme `field = "InstallationTask.{id}.PhotoUrl"` yazıyor. Aşağıdaki
            // durum dalı "InstallationTask." ile BAŞLAYAN her şeyi durum değişikliği saydığı için
            // fotoğrafı da yutuyordu: görsel `photos`a hiç girmiyor, dosya yolu `newValue` olarak
            // durum rozetine basılıyordu (ekranda kırmızı kutu içinde ".../xxx.webp" metni).
            // Kalem geçmişinde görsellerin hiç görünmemesinin sebebi buydu.
            var isPhotoField = field == "Photo" || (field != null && field.EndsWith(".PhotoUrl", StringComparison.Ordinal));

            // Durum dalı yalnızca gerçekten DURUM alanlarını alır: kayıt genelindeki "Status" ve
            // kalem görevlerinin "InstallationTask.{id}.Status" / "InstallationTask.Status"'u.
            // "InstallationTask.Edit" gibi alanlar da buraya düşmemeli.
            var isStatusField = !isPhotoField
                && (field == "Status" || (field != null && field.EndsWith(".Status", StringComparison.Ordinal)));

            if (isPhotoField && !string.IsNullOrEmpty(newValue))
            {
                events.Add(new
                {
                    id = a.Id,
                    type = "photo",
                    authorName = actorName,
                    createdAt = a.CreatedAt,
                    isRecordLevel,
                    fromStatus = (string?)null,
                    toStatus = (string?)null,
                    statusLabel = "Fotoğraf Yüklendi",
                    content = reason ?? "Süreç görseli eklendi",
                    photos = new List<string> { newValue }
                });
            }
            else if (isStatusField && !string.IsNullOrEmpty(newValue))
            {
                events.Add(new
                {
                    id = a.Id,
                    type = "status_change",
                    authorName = actorName,
                    createdAt = a.CreatedAt,
                    isRecordLevel,
                    fromStatus = oldValue,
                    toStatus = newValue,
                    statusLabel = GetTurkishStatus(newValue),
                    content = reason,
                    photos = new List<string>()
                });
            }
            else if (field == "Photo" && !string.IsNullOrEmpty(newValue))
            {
                events.Add(new
                {
                    id = a.Id,
                    type = "photo",
                    authorName = actorName,
                    createdAt = a.CreatedAt,
                    isRecordLevel,
                    fromStatus = (string?)null,
                    toStatus = (string?)null,
                    statusLabel = "Fotoğraf Yüklendi",
                    content = reason ?? "Süreç görseli eklendi",
                    photos = new List<string> { newValue }
                });
            }
            else
            {
                // SESSİZ YUTMA BURADAYDI — kullanıcının bildirdiği "işlem geçmişi düzgün
                // çalışmıyor"un ikinci yarısı.
                //
                // Yukarıdaki üç dal yalnızca DURUM ve FOTOĞRAF alanlarını tanıyordu; başka her
                // alan `if/else if` zincirinin sonuna gelip HİÇBİR ŞEY yapmadan düşüyordu. Yani
                // "Manuel montaj planlaması/ataması" (`field = "AssignedTechnician"`),
                // "InstallationTask.Edit", adres/miktar düzeltmeleri ve ileride eklenecek her yeni
                // alan geçmişte HİÇ görünmüyordu. Veri tabanında duruyorlardı; ekran atıyordu.
                // (DEMOTEST'te doğrulandı: MNT-0000051'in 4 atama olayı kayıtlı, listede yok.)
                //
                // Artık tanınmayan alan atılmıyor, okunabilir bir satıra çevriliyor: geçmişin işi
                // "ne oldu"yu göstermek, yalnızca tanıdığı alanları göstermek değil.
                var label = DescribeActivityField(field, a.Type);

                // Teknisyen atamasında `newValue` GUID'dir; ham GUID basmak geçmişi okunaksız
                // yapıyor. Elimizde zaten teknisyen sözlüğü var, isme çevriliyor.
                string? readableNew = newValue;
                string? readableOld = oldValue;
                if (field == "AssignedTechnician")
                {
                    readableNew = ResolveTechnicianName(newValue, techniciansDict) ?? newValue;
                    readableOld = ResolveTechnicianName(oldValue, techniciansDict) ?? oldValue;
                }

                var describedChange = !string.IsNullOrWhiteSpace(readableNew)
                    ? (!string.IsNullOrWhiteSpace(readableOld)
                        ? $"{readableOld} ➔ {readableNew}"
                        : readableNew)
                    : null;

                var content = !string.IsNullOrWhiteSpace(reason)
                    ? (describedChange != null ? $"{reason}\n{describedChange}" : reason)
                    : describedChange;

                // İçi tamamen boş olay (ne sebep ne değer) kullanıcıya bir şey söylemez; onu
                // eklemek listeyi anlamsız kartlarla şişirirdi.
                if (!string.IsNullOrWhiteSpace(content) || !string.IsNullOrWhiteSpace(label))
                {
                    events.Add(new
                    {
                        id = a.Id,
                        type = "update",
                        authorName = actorName,
                        createdAt = a.CreatedAt,
                        isRecordLevel,
                        fromStatus = (string?)null,
                        toStatus = (string?)null,
                        statusLabel = label,
                        content,
                        photos = new List<string>()
                    });
                }
            }
        }

        // NOTLAR KALEM GÖRÜNÜMÜNDE DE GÖSTERİLİR.
        //
        // Not kaleme bağlı bir varlık değil, kaydın genelinde tutuluyor — bu yüzden eskiden kalem
        // görünümünde hiç basılmıyordu. Ama "hangi keleme ait olduğunu bilmiyoruz" gerekçesi
        // notu SAKLAMAYI değil, kayıt geneli olarak İŞARETLEMEYİ gerektirir: teknisyenin
        // sahada yazdığı açıklama o kalemin de geçmişinin parçası ve kullanıcının kayıp
        // dediği şeylerin başında geliyor. `isRecordLevel` ile rozetleniyor.
        foreach (var n in notesRaw)
        {
            // Avoid duplicate note entries if already captured in activity with same content
            bool alreadyIn = events.Any(e => (e as dynamic).content == n.Content);
            if (!alreadyIn)
            {
                events.Add(new
                {
                    id = n.Id,
                    type = "note",
                    authorName = (string.IsNullOrWhiteSpace(n.AuthorName) || n.AuthorName == "Sistem") ? (!string.IsNullOrWhiteSpace(record.AssignedTechnician?.FullName) ? record.AssignedTechnician.FullName : "Sistem") : n.AuthorName,
                    createdAt = n.CreatedAt,
                    isRecordLevel = taskId.HasValue,
                    fromStatus = (string?)null,
                    toStatus = (string?)null,
                    statusLabel = "İşlem Notu",
                    content = n.Content,
                    photos = new List<string>()
                });
            }
        }

        var orderedEvents = events
            .OrderBy(e => ((dynamic)e).createdAt)
            .ToList();

        return Ok(orderedEvents);
    }

    [HttpGet]
    public async Task<ActionResult<List<ServiceRecordDto>>> GetAll(
        [FromQuery] ServiceStatus? status,
        [FromQuery] Guid? technicianId,
        [FromQuery] Guid? regionId,
        [FromQuery] DateTime? plannedFrom,
        [FromQuery] DateTime? plannedTo,
        [FromQuery] string? scopeKey = null)
    {
        var (canViewAll, techIdFilter, dealerCodeFilter) = await GetRecordScopeFilterAsync(ResolveScopeKey(scopeKey, "buyukUrun"));
        if (!canViewAll)
        {
            // Overwritten, not defaulted. Applying the scope only when the caller had left the
            // field empty meant ?technicianId=<someone else> stepped straight past it: the
            // restriction held for clients that were not looking and for no one else.
            if (techIdFilter.HasValue) technicianId = techIdFilter.Value;
        }
        var dealerCode = !canViewAll ? dealerCodeFilter : User.FindFirstValue("dealerCode");
        var records = await _service.GetAllAsync(status, technicianId, regionId, plannedFrom, plannedTo, dealerCode);
        return Ok(records);
    }

    [HttpGet("paged")]
    public async Task<ActionResult<PagedResultDto<ServiceRecordDto>>> GetPaged([FromQuery] ServiceRecordQueryDto query, [FromQuery] string? scopeKey = null)
    {
        // Kök anahtar İSTEĞE göre seçilir; sabit "buyukUrun" değildir.
        //
        // Eskiden montaj listesi de "buyukUrun" kapsamıyla süzülüyordu: Montaj Kabul ekranı
        // `montajKabul` yetkisiyle açılıyor ama kayıtları `buyukUrun` yetkisine göre soruyordu.
        // Sonuç: role "montajKabul + tümünü görme" verilmiş olmasına rağmen liste boş dönüyordu
        // ("Kayıt bulunamadı"), çünkü buyukUrun'da tümünü görme yoktu ve kullanıcının teknisyen
        // kaydı da olmadığı için kapsam None'a düşüyordu.
        // Doğrulandı (2026-08-10): montajKabul kapsamı "All" iken /paged 0 kayıt döndürüyordu.
        var rootKey = "buyukUrun";
        if (query.InstallationType == "workshop" || (query.Q != null && query.Q.Contains("atolye")))
        {
            rootKey = "atolyeAriza";
        }
        else if (query.Type == ServiceType.Installation)
        {
            rootKey = "montajKabul";
        }
        else if (string.Equals(query.Category, "small", StringComparison.OrdinalIgnoreCase))
        {
            // Küçük ürün kayıtları küçük ürün ailesine aittir; buyukUrun'a düşmek, Küçük Ürün
            // Kabul ekranını Beyaz Eşya yetkisiyle süzerdi.
            rootKey = "atolyeAriza";
        }

        var (canViewAll, techIdFilter, dealerCodeFilter) = await GetRecordScopeFilterAsync(ResolveScopeKey(scopeKey, rootKey));
        if (!canViewAll)
        {
            // Same reasoning as GetAll: a restricted caller does not get to choose whose records
            // it asks for, so the scope overwrites the query rather than filling a blank in it.
            if (techIdFilter.HasValue) query.TechnicianId = techIdFilter.Value;
            if (!string.IsNullOrEmpty(dealerCodeFilter)) query.DealerCode = dealerCodeFilter;
        }
        var result = await _service.GetPagedAsync(query);
        return Ok(result);
    }

    /// <summary>
    /// Bayi bazında servis performansı: hangi bayiden kaç iş geldi, büyük/küçük dağılımı,
    /// kaçı tamamlandı, kaçı bekliyor.
    ///
    /// Müşteri/Bayi ekranı basit bir CRUD listesi değil; asıl amaç bu rapor. Cari kartlarının
    /// kendisi B2B'de yaşıyor, burada yalnızca servis tarafındaki hareketleri sayıyoruz.
    ///
    /// Gruplama CARİ KODUNA göre: aynı bayi farklı ekranlarda farklı yazılmış olabiliyor, kod
    /// tek sabit. Kodu olmayan eski kayıtlar bayi adına göre gruplanır.
    /// </summary>
    [HttpGet("dealer-performance")]
    public async Task<ActionResult<object>> GetDealerPerformance(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken = default)
    {
        if (!await CanAccessAnyPageAsync("musterilerBayiler", "raporlar", "analiz")) return Forbid();

        // Kapsam: dar yetkili kullanıcı yalnızca kendi carilerinin satırlarını görür.
        var (canViewAll, _, dealerCodeFilter) = await GetRecordScopeFilterAsync("musterilerBayiler");

        var query = _context.ServiceRecords.AsNoTracking().Where(s => !s.IsDeleted);

        if (!canViewAll)
        {
            if (string.IsNullOrWhiteSpace(dealerCodeFilter) || dealerCodeFilter == "__NO_ACCESS__")
            {
                return Ok(new { success = true, data = Array.Empty<object>() });
            }
            query = query.Where(s => s.DealerCode == dealerCodeFilter);
        }

        if (from.HasValue) query = query.Where(s => s.CreatedAt >= from.Value.Date.ToUniversalTime());
        if (to.HasValue) query = query.Where(s => s.CreatedAt < to.Value.Date.AddDays(1).ToUniversalTime());

        // Tamamlanmış sayılan durumlar: teslim edildi ve iptal. Kalan her şey hâlâ süreçte.
        var closedStatuses = new[] { ServiceStatus.Delivered, ServiceStatus.Cancelled };

        var rows = await query
            .GroupBy(s => new { s.DealerCode, s.DealerName })
            .Select(g => new
            {
                dealerCode = g.Key.DealerCode,
                dealerName = g.Key.DealerName,
                total = g.Count(),
                small = g.Count(s => s.ProductCategory == ProductCategory.Small),
                large = g.Count(s => s.ProductCategory != ProductCategory.Small),
                completed = g.Count(s => s.Status == ServiceStatus.Delivered),
                cancelled = g.Count(s => s.Status == ServiceStatus.Cancelled),
                pending = g.Count(s => !closedStatuses.Contains(s.Status)),
                lastServiceAt = g.Max(s => (DateTime?)s.CreatedAt)
            })
            .OrderByDescending(x => x.total)
            .Take(500)
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            data = rows,
            totals = new
            {
                dealers = rows.Count,
                total = rows.Sum(r => r.total),
                small = rows.Sum(r => r.small),
                large = rows.Sum(r => r.large),
                completed = rows.Sum(r => r.completed),
                pending = rows.Sum(r => r.pending)
            }
        });
    }

    /// <summary>
    /// Tek bir bayinin kırılımı: hangi mağazadan/nihai müşteriden kaç iş geldi ve aylık dağılım.
    /// </summary>
    [HttpGet("dealer-performance/{dealerCode}")]
    public async Task<ActionResult<object>> GetDealerPerformanceDetail(
        string dealerCode,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken = default)
    {
        if (!await CanAccessAnyPageAsync("musterilerBayiler", "raporlar", "analiz")) return Forbid();

        var (canViewAll, _, dealerCodeFilter) = await GetRecordScopeFilterAsync("musterilerBayiler");
        if (!canViewAll && !string.Equals(dealerCodeFilter, dealerCode, StringComparison.OrdinalIgnoreCase))
        {
            return Forbid();
        }

        var query = _context.ServiceRecords
            .AsNoTracking()
            .Where(s => !s.IsDeleted && s.DealerCode == dealerCode);

        if (from.HasValue) query = query.Where(s => s.CreatedAt >= from.Value.Date.ToUniversalTime());
        if (to.HasValue) query = query.Where(s => s.CreatedAt < to.Value.Date.AddDays(1).ToUniversalTime());

        var byCustomer = await query
            .GroupBy(s => s.CustomerName)
            .Select(g => new
            {
                customerName = g.Key,
                total = g.Count(),
                small = g.Count(s => s.ProductCategory == ProductCategory.Small),
                large = g.Count(s => s.ProductCategory != ProductCategory.Small),
                completed = g.Count(s => s.Status == ServiceStatus.Delivered)
            })
            .OrderByDescending(x => x.total)
            .Take(200)
            .ToListAsync(cancellationToken);

        var byMonth = await query
            .GroupBy(s => new { s.CreatedAt.Year, s.CreatedAt.Month })
            .Select(g => new
            {
                year = g.Key.Year,
                month = g.Key.Month,
                total = g.Count()
            })
            .OrderBy(x => x.year).ThenBy(x => x.month)
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, dealerCode, byCustomer, byMonth });
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ServiceRecordDto>> GetById(Guid id)
    {
        if (DenyForRecord(await GetRecordAccessFromAnyPageAsync(id)) is { } deny) return deny;
        var record = await _service.GetByIdAsync(id);
        if (record == null) return NotFound();
        return Ok(record);
    }

    [HttpGet("by-number/{serviceNumber}")]
    public async Task<ActionResult<ServiceRecordDto>> GetByNumber(string serviceNumber)
    {
        var record = await _service.GetByNumberAsync(serviceNumber);
        if (record == null) return NotFound();
        if (DenyForRecord(await GetRecordAccessFromAnyPageAsync(record.Id)) is { } deny) return deny;
        return Ok(record);
    }

    [HttpPost]
    public async Task<ActionResult<ServiceRecordDto>> Create(CreateServiceRecordDto dto)
    {
        if (IsTechnicianUser()) return Forbid();
        if (!await CanAccessAnyPageAsync("montajKabul", "buyukEvAletleriKabul", "kucukUrunKabul")) return Forbid();
        // Cari adı boşsa kullanıcının carisine düşülür — ama YALNIZCA tek bir cariye bağlıysa.
        //
        // Burada claim ham alınıyordu. Cari yetkisi virgüllü bir liste ve '*' "tüm cariler"
        // demek; kısıtlamasız bir kullanıcıda değer '*' olduğu için kayda cari adı olarak
        // düpedüz "*" yazılıyordu. (Doğrulandı 2026-08-10: MNT-0000019 ve MNT-0000020
        // kayıtlarında DealerCode boş, DealerName '*'.)
        if (string.IsNullOrWhiteSpace(dto.DealerName))
        {
            var singleDealerCode = ResolveSingleDealerCode(User.FindFirstValue("dealerCode"));
            if (!string.IsNullOrWhiteSpace(singleDealerCode))
            {
                dto.DealerName = singleDealerCode;
            }
        }
        if (dto.Type == ServiceType.Installation && string.IsNullOrEmpty(dto.InstallationType))
        {
            dto.InstallationType = "Bayi";
        }
        var performerName = await ResolvePerformerNameAsync();
        var record = await _service.CreateAsync(dto, performerName);
        return CreatedAtAction(nameof(GetById), new { id = record.Id }, record);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ServiceRecordDto>> Update(Guid id, CreateServiceRecordDto dto)
    {
        if (IsTechnicianUser()) return Forbid();
        if (DenyForRecord(await GetRecordAccessFromAnyPageAsync(id)) is { } deny) return deny;

        ServiceRecordDto? record;
        try
        {
            record = await _service.UpdateAsync(id, dto);
        }
        catch (InvalidOperationException ex)
        {
            // Planlanmış kalemi silmeye çalışmak gibi kural ihlalleri
            return BadRequest(new { success = false, message = ex.Message });
        }

        if (record == null) return NotFound();
        return Ok(record);
    }

    [HttpPatch("{id:guid}/status")]
    public async Task<ActionResult<ServiceRecordDto>> UpdateStatus(Guid id, UpdateServiceStatusDto dto)
    {
        var performerName = await ResolvePerformerNameAsync();
        dto.PerformedByName = performerName;

        if (DenyForRecord(await GetRecordAccessFromAnyPageAsync(id)) is { } deny) return deny;

        /*
          TEKNİSYEN DAMGASI ARTIK İŞLEMİ ENGELLEMİYOR (2026-08-26 bildirimi: "sahadan
          atölyeye al diyorum 403 dönüyor").

          Burada `if (!techId.HasValue) return Forbid();` vardı. Bu satır bir YETKİ kararı
          değildi — erişim kararı bir üstteki `DenyForRecord` ile ZATEN verilmişti; buradaki
          tek iş "bu durumu kim değiştirdi" damgasını basmaktı. Teknisyen kimliği
          çözülemeyen bir hesap (rolü Technician ama Technician satırına bağlanmamış
          kullanıcı) kaydı görüyor, açıyor, ama durumunu değiştiremiyordu — ekranda hiçbir
          açıklama olmayan çıplak bir 403 dönüyordu.

          Kimlik çözülemezse damga boş kalır; alt katman bunu zaten bekliyor
          (`performerId = dto.PerformedByTechnicianId?.ToString() ?? "user"`). İşlemi yapanın
          ADI ayrıca `PerformedByName` ile yazılıyor, yani iz kaybolmuyor.

          Kapı GENİŞLEMİYOR: kimliği çözülemeyen kullanıcı, kaydı zaten görebildiği için
          buraya gelebiliyordu. Bkz. [[teknisyen_kimligi_yarim_kurulum]].
        */
        if (IsTechnicianUser())
        {
            var techId = await GetCurrentTechnicianIdAsync();
            if (techId.HasValue) dto.PerformedByTechnicianId = techId.Value;
        }

        var record = await _service.UpdateStatusAsync(id, dto);
        if (record == null) return NotFound();
        await _hub.Clients.All.SendAsync("service_record_updated", new { id, action = "status_updated" });
        return Ok(record);
    }

    [HttpPost("{id:guid}/assign")]
    public async Task<ActionResult<ServiceRecordDto>> AssignTechnician(Guid id, AssignTechnicianDto dto)
    {
        if (!await CanManageRecordsAsync()) return DenyManage("iş atama");

        // Önceki sahibi atamadan ÖNCE okunuyor: aynı kişiye yeniden atama bildirim üretmemeli.
        var previousTechnicianId = await _context.ServiceRecords
            .AsNoTracking()
            .Where(r => r.Id == id)
            .Select(r => r.AssignedTechnicianId)
            .FirstOrDefaultAsync();

        var record = await _service.AssignTechnicianAsync(id, dto);
        if (record == null) return NotFound();
        await _hub.Clients.All.SendAsync("service_record_updated", new { id, action = "assigned" });

        if (dto.TechnicianId != Guid.Empty && dto.TechnicianId != previousTechnicianId)
        {
            await NotifyServiceAssignmentAsync(id, dto.TechnicianId);
        }

        return Ok(record);
    }

    [HttpPatch("{id:guid}/plan")]
    public async Task<ActionResult<ServiceRecordDto>> Plan(Guid id, PlanServiceRecordDto dto)
    {
        if (!await CanManageRecordsAsync()) return DenyManage("planlama");

        // Tarihçede "Sistem" yazmasın: planlamayı yapan kişi burada belli.
        dto.PerformedByName = await ResolvePerformerNameAsync();

        var previousTechnicianId = await _context.ServiceRecords
            .AsNoTracking()
            .Where(r => r.Id == id)
            .Select(r => r.AssignedTechnicianId)
            .FirstOrDefaultAsync();

        var record = await _service.PlanAsync(id, dto);
        if (record == null) return NotFound();
        await _hub.Clients.All.SendAsync("service_record_updated", new { id, action = "planned" });

        if (dto.TechnicianId.HasValue && dto.TechnicianId.Value != Guid.Empty && dto.TechnicianId != previousTechnicianId)
        {
            await NotifyServiceAssignmentAsync(id, dto.TechnicianId);
        }

        return Ok(record);
    }

    /// <param name="itemId">
    /// Basılan KALEM. Fiş ekranı zaten kalem bazlı çalışıyor; damga da kalem bazlı olmalı,
    /// yoksa bir kalemin fişi basılınca aynı faturanın bütün kalemleri "Servis Fişi ✓"
    /// görünüyordu (2026-09-09 kullanıcı şikâyeti). Gönderilmezse yalnızca kayıt düzeyindeki
    /// <c>IsPrinted</c> damgalanır — eski çağrı biçimi bozulmasın diye isteğe bağlı.
    /// </param>
    [HttpPatch("{id:guid}/printed")]
    public async Task<ActionResult<ServiceRecordDto>> MarkAsPrinted(Guid id, [FromQuery] Guid? itemId = null)
    {
        // Bu uçta hiçbir kontrol yoktu — tek engel sınıf düzeyindeki [Authorize] idi.
        // IsPrinted süs bir alan değil, SAHAYA AKTARIM KİLİDİNİN kendisi
        // (ServiceRecordService.UpdateStatusAsync, "Servis fişi basılmadan sahaya aktarılamaz").
        // Yani oturum açmış herhangi biri fişi basılmış gibi işaretleyip kilidi açabiliyordu.
        if (IsTechnicianUser()) return Forbid();
        if (DenyForRecord(await GetRecordAccessFromAnyPageAsync(id)) is { } deny) return deny;

        var record = await _service.MarkAsPrintedAsync(id, await ResolvePerformerNameAsync(), itemId);
        if (record == null) return NotFound();
        await _hub.Clients.All.SendAsync("service_record_updated", new { id, action = "printed" });
        return Ok(record);
    }

    /// <summary>
    /// Kağıt fiş numarasını günceller. Ayrı uç: <c>PUT {id}</c> düzenleme formunun tamamını
    /// yazdığı için sırf bu alan uğruna oradan geçmek müşteri/ürün bilgisini silerdi.
    /// </summary>
    [HttpPatch("{id:guid}/manual-receipt-no")]
    public async Task<ActionResult<ServiceRecordDto>> UpdateManualReceiptNo(Guid id, [FromBody] UpdateManualReceiptNoDto dto)
    {
        // Kapı `printed` ucuyla AYNI: teknisyen kullanıcı yazamaz, kaydı görme yetkisi olmayan
        // hiç geçemez. Yetkisiz kullanıcı fiş numarasını değiştirip başka kaydı üstüne yazamasın.
        if (IsTechnicianUser()) return Forbid();
        if (DenyForRecord(await GetRecordAccessFromAnyPageAsync(id)) is { } deny) return deny;

        var record = await _service.UpdateManualReceiptNoAsync(id, dto?.ManualReceiptNo);
        if (record == null) return NotFound();

        await _hub.Clients.All.SendAsync("service_record_updated", new { id, action = "manual_receipt_no" });
        return Ok(record);
    }

    [HttpPatch("{id:guid}/user-plan")]
    public async Task<ActionResult<ServiceRecordDto>> UpdateUserPlan(Guid id, [FromBody] UpdateUserPlanDto dto)
    {
        var record = await _context.ServiceRecords
            .Include(s => s.Customer)
            .Include(s => s.Dealer)
            .Include(s => s.AssignedTechnician)
            .Include(s => s.Region)
            .Include(s => s.Notes)
            .FirstOrDefaultAsync(s => s.Id == id);

        if (record == null) return NotFound();

        if (IsTechnicianUser())
        {
            var techId = await GetCurrentTechnicianIdAsync();
            if (!techId.HasValue) return Forbid();
            if (!await CanTechnicianAccessServiceAsync(id, techId.Value)) return NotFound();
        }

        if (dto.UserRouteTick.HasValue) record.UserRouteTick = dto.UserRouteTick.Value;
        if (dto.UserRouteHour != null) record.UserRouteHour = dto.UserRouteHour;
        if (dto.UserRouteSortOrder.HasValue) record.UserRouteSortOrder = dto.UserRouteSortOrder.Value;

        record.UpdatedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();

        await _hub.Clients.All.SendAsync("service_record_updated", new { id, action = "user_plan_updated" });

        var updatedDto = await _service.GetByIdAsync(id);
        return Ok(updatedDto);
    }

    [HttpPost("user-plan/bulk")]
    public async Task<ActionResult> BulkUpdateUserPlan([FromBody] BulkUserPlanRequest request)
    {
        if (request?.Items == null || request.Items.Count == 0) return BadRequest("Plan verisi boş olamaz.");

        var ids = request.Items.Select(x => x.ServiceRecordId).ToList();
        var records = await _context.ServiceRecords
            .Where(r => ids.Contains(r.Id))
            .ToListAsync();

        if (IsTechnicianUser())
        {
            var techId = await GetCurrentTechnicianIdAsync();
            if (!techId.HasValue) return Forbid();
            foreach (var r in records)
            {
                if (!await CanTechnicianAccessServiceAsync(r.Id, techId.Value)) return NotFound();
            }
        }

        foreach (var item in request.Items)
        {
            var record = records.FirstOrDefault(r => r.Id == item.ServiceRecordId);
            if (record != null)
            {
                if (item.UserRouteTick.HasValue) record.UserRouteTick = item.UserRouteTick.Value;
                if (item.UserRouteHour != null) record.UserRouteHour = item.UserRouteHour;
                if (item.UserRouteSortOrder.HasValue) record.UserRouteSortOrder = item.UserRouteSortOrder.Value;
                record.UpdatedAt = DateTime.UtcNow;
            }
        }

        await _context.SaveChangesAsync();

        await _hub.Clients.All.SendAsync("service_record_updated", new { action = "bulk_user_plan_updated" });

        return Ok(new { success = true });
    }

    [HttpPatch("{id:guid}/route-plan")]
    public async Task<ActionResult<ServiceRecordDto>> UpdateRoutePlan(Guid id, [FromBody] UpdateRoutePlanDto dto)
    {
        Guid? currentTechId = null;
        if (IsTechnicianUser())
        {
            currentTechId = await GetCurrentTechnicianIdAsync();
            if (currentTechId == null) return Forbid();
        }

        var record = await _context.ServiceRecords
            .Include(s => s.Customer)
            .Include(s => s.Dealer)
            .Include(s => s.AssignedTechnician)
            .Include(s => s.Region)
            .Include(s => s.Notes)
            .FirstOrDefaultAsync(s => s.Id == id);

        if (record == null) return NotFound();

        if (IsTechnicianUser())
        {
            bool isAlreadyOurs = record.TechnicianId == currentTechId || record.AssignedTechnicianId == currentTechId;
            bool isUnassigned = record.TechnicianId == null || record.TechnicianId == Guid.Empty;
            bool isAssigningToOurselves = dto.TechnicianId.HasValue && dto.TechnicianId.Value == currentTechId;

            if (!isAlreadyOurs && !(isUnassigned && isAssigningToOurselves))
                return Forbid();

            // Technicians can only change hours and order of their own route.
            if (dto.TechnicianId.HasValue && dto.TechnicianId.Value != currentTechId)
                return Forbid();

        }

        if (dto.RouteOrder.HasValue) record.RouteOrder = dto.RouteOrder.Value;

        // Saatin DEĞİŞTİĞİ burada tespit ediliyor: kayda yazıldıktan sonra eski değeri
        // okuyacak yer kalmıyor ve "değişti mi" sorusu cevapsız kalırdı.
        var planTimeChanged =
            (dto.PlannedStartTime != null && dto.PlannedStartTime != record.PlannedStartTime) ||
            (dto.PlannedEndTime != null && dto.PlannedEndTime != record.PlannedEndTime);

        if (dto.PlannedStartTime != null) record.PlannedStartTime = dto.PlannedStartTime;
        if (dto.PlannedEndTime != null) record.PlannedEndTime = dto.PlannedEndTime;
        if (dto.RouteDate != null)
        {
            record.RouteDate = dto.RouteDate;
            if (DateTime.TryParse(dto.RouteDate, out var parsedDate))
            {
                record.PlannedAt = DateTime.SpecifyKind(parsedDate, DateTimeKind.Utc);
            }
        }
        
        if (dto.TechnicianId.HasValue)
        {
            var techId = dto.TechnicianId.Value;
            if (record.TechnicianId.HasValue && record.TechnicianId.Value != Guid.Empty)
            {
                if (record.TechnicianId.Value != techId)
                {
                    return BadRequest("Atanmış bir işin teknisyeni rota kısmında değiştirilemez veya kaldırılamaz.");
                }
            }

            if (techId == Guid.Empty)
            {
                record.TechnicianId = null;
                record.AssignedTechnicianId = null;
            }
            else
            {
                record.TechnicianId = techId;
                record.AssignedTechnicianId = techId;
            }
        }

        record.UpdatedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();

        await _hub.Clients.All.SendAsync("service_record_updated", new { id, action = "route_plan_updated" });

        // Rota ekranında teknisyen yalnızca BOŞ kayda atanabiliyor (üstteki kural), yani
        // buraya düşen her atama gerçekten yeni bir iştir.
        if (dto.TechnicianId.HasValue && dto.TechnicianId.Value != Guid.Empty)
        {
            await NotifyServiceAssignmentAsync(id, dto.TechnicianId);
        }
        else if (planTimeChanged && record.AssignedTechnicianId.HasValue)
        {
            // Saat değişikliği yeni bir atama değil, ama teknisyenin günü değişiyor: haberi
            // olmazsa eski saate göre yola çıkar. Atama bildirimi gönderildiyse tekrarlanmaz.
            await _assignmentNotifier.NotifyTechnicianAsync(
                record.AssignedTechnicianId.Value,
                "Planlama saati güncellendi",
                $"{record.ServiceNumber} · {record.CustomerName} — yeni saat: {record.PlannedStartTime ?? "--:--"} - {record.PlannedEndTime ?? "--:--"}",
                jobType: "ServiceRecord",
                jobId: record.Id,
                cancellationToken: HttpContext.RequestAborted);
        }

        var updatedDto = await _service.GetByIdAsync(id);
        return Ok(updatedDto);
    }

    [HttpPost("route-plan/bulk")]
    public async Task<ActionResult> BulkUpdateRoutePlan([FromBody] BulkRoutePlanRequest request)
    {
        Guid? currentTechId = null;
        if (IsTechnicianUser())
        {
            currentTechId = await GetCurrentTechnicianIdAsync();
            if (currentTechId == null) return Forbid();
        }

        if (request?.Items == null || request.Items.Count == 0) return BadRequest("Plan verisi boş olamaz.");

        var ids = request.Items.Select(x => x.ServiceRecordId).ToList();
        var records = await _context.ServiceRecords
            .Where(r => ids.Contains(r.Id))
            .ToListAsync();

        foreach (var item in request.Items)
        {
            var record = records.FirstOrDefault(r => r.Id == item.ServiceRecordId);
            if (record != null)
            {
                if (IsTechnicianUser())
                {
                    bool isAlreadyOurs = record.TechnicianId == currentTechId || record.AssignedTechnicianId == currentTechId;
                    bool isUnassigned = record.TechnicianId == null || record.TechnicianId == Guid.Empty;
                    bool isAssigningToOurselves = item.TechnicianId.HasValue && item.TechnicianId.Value == currentTechId;

                    if (!isAlreadyOurs && !(isUnassigned && isAssigningToOurselves))
                        return Forbid();

                    if (item.TechnicianId.HasValue && item.TechnicianId.Value != currentTechId)
                        return Forbid();

                }

                if (item.RouteOrder.HasValue) record.RouteOrder = item.RouteOrder.Value;
                if (item.PlannedStartTime != null) record.PlannedStartTime = item.PlannedStartTime;
                if (item.PlannedEndTime != null) record.PlannedEndTime = item.PlannedEndTime;
                if (item.RouteDate != null)
                {
                    record.RouteDate = item.RouteDate;
                    if (DateTime.TryParse(item.RouteDate, out var parsedDate))
                    {
                        record.PlannedAt = DateTime.SpecifyKind(parsedDate, DateTimeKind.Utc);
                    }
                }
                
                if (item.TechnicianId.HasValue)
                {
                    var techId = item.TechnicianId.Value;
                    if (record.TechnicianId.HasValue && record.TechnicianId.Value != Guid.Empty)
                    {
                        if (record.TechnicianId.Value != techId)
                        {
                            return BadRequest("Atanmış bir işin teknisyeni rota kısmında değiştirilemez veya kaldırılamaz.");
                        }
                    }

                    if (techId == Guid.Empty)
                    {
                        record.TechnicianId = null;
                        record.AssignedTechnicianId = null;
                    }
                    else
                    {
                        record.TechnicianId = techId;
                        record.AssignedTechnicianId = techId;
                    }
                }
                record.UpdatedAt = DateTime.UtcNow;
            }
        }

        await _context.SaveChangesAsync();
        await _hub.Clients.All.SendAsync("service_record_updated", new { action = "bulk_route_plan_updated" });

        // Toplu rota planında da atamalar duyurulur; bildirimci kişi başına tek mesaja topluyor.
        await NotifyServiceAssignmentsAsync(
            request.Items.Select(x => (x.ServiceRecordId, x.TechnicianId)));

        return Ok(new { success = true });
    }


    [HttpPost("{id:guid}/photo")]
    [RequestSizeLimit(15_000_000)]
    public async Task<IActionResult> UploadPhoto(Guid id, IFormFile file, CancellationToken cancellationToken)
    {
        // Fotoğraf servis kaydına iliştiriliyor; kayda erişemiyorsan ona dosya da ekleyemezsin.
        // Kontrol yoktu: kayıt var mı diye bakılıyor ama KİMİN kaydı olduğu sorulmuyordu.
        if (DenyForRecord(await GetRecordAccessFromAnyPageAsync(id)) is { } deny) return deny;

        if (file == null || file.Length == 0) return BadRequest("Dosya zorunludur");
        if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)) return BadRequest("Sadece resim yüklenebilir");

        Guid? techId = null;
        string? techName = null;
        if (IsTechnicianUser())
        {
            techId = await GetCurrentTechnicianIdAsync();
            if (!techId.HasValue) return Forbid();
            if (!await CanTechnicianAccessServiceAsync(id, techId.Value)) return NotFound();
            techName = await _context.Technicians.AsNoTracking()
                .Where(t => t.Id == techId.Value)
                .Select(t => t.FullName)
                .FirstOrDefaultAsync(cancellationToken);
        }

        var serviceExists = await _context.ServiceRecords.AsNoTracking().AnyAsync(s => s.Id == id, cancellationToken);
        if (!serviceExists) return NotFound();

        var safeName = $"{id:N}-{Guid.NewGuid():N}.webp";
        var folder = Path.Combine(AppContext.BaseDirectory, "uploads", "service-records", id.ToString("N"));
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, safeName);
        
        using (var imageStream = file.OpenReadStream())
        using (var image = await SixLabors.ImageSharp.Image.LoadAsync(imageStream, cancellationToken))
        {
            await image.SaveAsWebpAsync(path, cancellationToken);
        }

        var relativeUrl = $"/uploads/service-records/{id:N}/{safeName}";
        _context.Activities.Add(new Activity
        {
            ServiceId = id,
            Type = ActivityType.PhotoUploaded,
            ActorTechnicianId = techId,
            ActorTechnicianName = techName,
            ActorUserName = User.FindFirstValue(ClaimTypes.Name),
            Payload = System.Text.Json.JsonSerializer.Serialize(new
            {
                field = "Photo",
                oldValue = (string?)null,
                newValue = relativeUrl,
                reason = "Saha fotoğrafı yüklendi",
                metadata = new { file.FileName, file.ContentType, file.Length }
            }),
            CreatedAt = DateTime.UtcNow
        });
        await _context.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, url = relativeUrl });
    }

    [HttpGet("{id:guid}/photos")]
    public async Task<IActionResult> GetServiceRecordPhotos(Guid id, CancellationToken cancellationToken)
    {
        var activities = await _context.Activities
            .AsNoTracking()
            .Where(a => a.ServiceId == id && a.Type == ActivityType.PhotoUploaded)
            .OrderBy(a => a.CreatedAt)
            .ToListAsync(cancellationToken);

        var photos = activities.Select(a =>
        {
            string? url = null;
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(a.Payload);
                if (doc.RootElement.TryGetProperty("newValue", out var nv))
                    url = nv.GetString();
            }
            catch { }

            return new
            {
                id = a.Id,
                serviceRecordId = a.ServiceId,
                url = url,
                path = url,
                createdAt = a.CreatedAt
            };
        })
        .Where(x => !string.IsNullOrEmpty(x.url))
        .ToList();

        return Ok(photos);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        if (!await CanManageRecordsAsync()) return Forbid();
        var record = await _context.ServiceRecords.FirstOrDefaultAsync(s => s.Id == id, cancellationToken);
        if (record == null) return NotFound();



        // Faturadan doğan montaj buradan silinemez: kaynak B2B'deki fatura kalemidir ve burada
        // silinse fatura dökümü ile montaj birbirini tutmaz — üstelik fatura yeniden
        // kaydedildiğinde webhook kaydı geri açar. Silmek isteyen faturadan silmeli.
        // Bayiden/elle girilen kayıtta dış kaynak yoktur, o serbestçe silinebilir.
        var invoiceRefs = await _context.ServiceRecordItems
            .Where(i => i.ServiceId == id && i.ExternalRef != null)
            .Select(i => i.ExternalRef!)
            .ToListAsync(cancellationToken);

        if (invoiceRefs.Count > 0)
        {
            return BadRequest(new
            {
                success = false,
                code = "INVOICE_BACKED",
                message = "Bu montaj faturadan geldiği için buradan silinemez. Lütfen bu kaydı Fatura Dökümü ekranından silin."
            });
        }

        var connStr = await GetB2BConnectionStringAsync(cancellationToken);
        if (!string.IsNullOrWhiteSpace(connStr))
        {
            try
            {
                await using var conn = new NpgsqlConnection(connStr);
                await conn.OpenAsync(cancellationToken);

                var query = @"
                    SELECT 
                      (SELECT COUNT(*)::int FROM public.""SalesOrders"" WHERE ""CampaignDetailsJson"" IS NOT NULL AND (""CampaignDetailsJson"" LIKE @patternId OR ""CampaignDetailsJson"" LIKE @patternNumber)) +
                      (SELECT COUNT(*)::int FROM public.""Invoices"" WHERE ""CampaignDetailsJson"" IS NOT NULL AND (""CampaignDetailsJson"" LIKE @patternId OR ""CampaignDetailsJson"" LIKE @patternNumber))";

                await using var cmd = new NpgsqlCommand(query, conn);
                cmd.Parameters.AddWithValue("patternId", $"%\"serviceRecordId\":\"{record.Id}\"%");
                cmd.Parameters.AddWithValue("patternNumber", $"%\"serviceNumber\":\"{record.ServiceNumber}\"%");

                var count = Convert.ToInt32(await cmd.ExecuteScalarAsync(cancellationToken));
                if (count > 0)
                {
                    return BadRequest(new
                    {
                        success = false,
                        code = "HAS_ERP_INVOICE",
                        message = "Bu arıza kaydına ait B2B ERP üzerinde satış faturası (sipariş taslağı) veya fatura bulunmaktadır. Silmeden önce faturayı B2B ERP sisteminden silmelisiniz."
                    });
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[DeleteRecord] Failed to check B2B SalesOrders/Invoices: {ex.Message}");
            }
        }

        var username = User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name ?? "Bilinmeyen Kullanıcı";
        record.IsDeleted = true;
        record.DeletedAt = DateTime.UtcNow;
        record.DeletedBy = username;

        // BAĞLI İŞ EMİRLERİ DE İPTAL EDİLİR.
        //
        // Arıza kaydı silinince (soft-delete) altındaki iş emirlerine hiç dokunulmuyordu:
        // teknisyenin mobil uygulamasında görev AKTİF kalmaya devam ediyor ve silinmiş bir
        // kayıt için sahaya gidiliyordu. Kayıt silinmişse iş emri de yapılacak iş değildir.
        //
        // TAMAMLANMIŞ iş emirlerine DOKUNULMUYOR: onlar yapılmış işin ve hak edişin kaydı;
        // geriye dönük "iptal" damgalamak geçmişi yeniden yazmak olurdu.
        var openWorkOrders = await _context.WorkOrders
            .Where(w => w.ServiceId == record.Id
                        && w.Status != WorkOrderStatus.Completed
                        && w.Status != WorkOrderStatus.Cancelled)
            .ToListAsync(cancellationToken);

        foreach (var wo in openWorkOrders)
        {
            wo.Status = WorkOrderStatus.Cancelled;
        }

        await _context.SaveChangesAsync(cancellationToken);
        return Ok(new
        {
            success = true,
            message = openWorkOrders.Count > 0
                ? $"Kayıt silindi. Bağlı {openWorkOrders.Count} iş emri iptal edildi."
                : "Kayıt başarıyla silindi."
        });
    }

    private async Task<string?> GetB2BConnectionStringAsync(CancellationToken cancellationToken)
    {
        var tenantCode = User.FindFirstValue("tenant") ?? User.FindFirstValue("X-Tenant-Code") ?? "KKTC";
        if (string.IsNullOrWhiteSpace(tenantCode)) return null;

        var baseConn = _configuration.GetConnectionString("DefaultConnection") 
                       ?? _configuration.GetConnectionString("ServiceOpsBase");
        if (string.IsNullOrWhiteSpace(baseConn)) return null;

        try
        {
            var masterBuilder = new NpgsqlConnectionStringBuilder(baseConn) { Database = "b2b_erp_master" };
            string? dbName = null;
            await using (var master = new NpgsqlConnection(masterBuilder.ConnectionString))
            {
                await master.OpenAsync(cancellationToken);
                await using var cmd = new NpgsqlCommand("SELECT \"DbName\" FROM public.\"Tenants\" WHERE LOWER(\"Code\") = @tenantCode LIMIT 1", master);
                cmd.Parameters.AddWithValue("tenantCode", tenantCode.Trim().ToLowerInvariant());
                dbName = await cmd.ExecuteScalarAsync(cancellationToken) as string;
            }

            var tenantBuilder = new NpgsqlConnectionStringBuilder(baseConn)
            {
                Database = string.IsNullOrWhiteSpace(dbName) ? "b2b_erp" : dbName
            };
            return tenantBuilder.ConnectionString;
        }
        catch
        {
            var fallback = new NpgsqlConnectionStringBuilder(baseConn) { Database = "b2b_erp" };
            return fallback.ConnectionString;
        }
    }

    [HttpGet("status-counts")]
    public async Task<ActionResult<Dictionary<ServiceStatus, int>>> GetStatusCounts()
    {
        if (IsTechnicianUser())
        {
            var techId = await GetCurrentTechnicianIdAsync();
            if (!techId.HasValue) return Forbid();
            var scopedCounts = await _context.ServiceRecords
                .AsNoTracking()
                .Where(s => s.AssignedTechnicianId == techId.Value)
                .GroupBy(s => s.Status)
                .Select(g => new { Status = g.Key, Count = g.Count() })
                .ToListAsync();
            return Ok(scopedCounts.ToDictionary(x => x.Status, x => x.Count));
        }
        var counts = await _service.GetStatusCountsAsync();
        return Ok(counts);
    }

    [HttpGet("today")]
    public async Task<ActionResult<List<ServiceRecordDto>>> GetTodayServices()
    {
        if (IsTechnicianUser())
        {
            var techId = await GetCurrentTechnicianIdAsync();
            if (!techId.HasValue) return Forbid();
            var today = DateTime.UtcNow.Date;
            var next = today.AddDays(1);
            var scoped = await _service.GetAllAsync(null, techId.Value, null, today, next);
            return Ok(scoped);
        }
        var records = await _service.GetTodayServicesAsync();
        return Ok(records);
    }

    [HttpGet("delayed")]
    public async Task<ActionResult<List<ServiceRecordDto>>> GetDelayedServices()
    {
        if (IsTechnicianUser())
        {
            var techId = await GetCurrentTechnicianIdAsync();
            if (!techId.HasValue) return Forbid();
            var today = DateTime.UtcNow.Date;
            var scoped = await _service.GetAllAsync(null, techId.Value, null, null, today);
            return Ok(scoped.Where(s => s.Status != ServiceStatus.Delivered && s.Status != ServiceStatus.Cancelled));
        }
        var records = await _service.GetDelayedServicesAsync();
        return Ok(records);
    }

    [HttpGet("analytics")]
    public async Task<ActionResult<object>> Analytics([FromQuery] ServiceType? type, CancellationToken cancellationToken)
    {
        var baseQuery = _context.ServiceRecords.AsNoTracking().AsQueryable();
        if (IsTechnicianUser())
        {
            var techId = await GetCurrentTechnicianIdAsync();
            if (!techId.HasValue) return Forbid();
            baseQuery = baseQuery.Where(s => s.AssignedTechnicianId == techId.Value);
        }
        // Tip kırılımı (montaj/arıza) sayıları tip süzgecinden ETKİLENMEZ ama teknisyen
        // kapsamından etkilenmeli: aşağıdaki iki sayaç `_context.ServiceRecords`i doğrudan
        // sayıyordu, yani teknisyen kendi performans kartında ŞİRKETİN TAMAMININ montaj ve
        // arıza sayısını görüyordu — aynı karttaki diğer bütün sayılar kendisine aitken.
        var scopedQuery = baseQuery;

        if (type.HasValue)
            baseQuery = baseQuery.Where(s => s.Type == type.Value);

        var nowUtc = DateTime.UtcNow;
        var todayStart = nowUtc.Date;
        var monthStart = new DateTime(nowUtc.Year, nowUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc);

        var totalCount = await baseQuery.CountAsync(cancellationToken);
        var doneCount = await baseQuery.CountAsync(s => s.Status == ServiceStatus.Delivered, cancellationToken);
        var readyCount = await baseQuery.CountAsync(s => s.Status == ServiceStatus.Ready, cancellationToken);
        var cancelledCount = await baseQuery.CountAsync(s => s.Status == ServiceStatus.Cancelled, cancellationToken);
        var delayedCount = await baseQuery.CountAsync(s => s.Status == ServiceStatus.Delayed, cancellationToken);
        var workshopCount = await baseQuery.CountAsync(s => s.Status == ServiceStatus.Workshop || s.Status == ServiceStatus.InRepair, cancellationToken);
        var waitingPartsCount = await baseQuery.CountAsync(s => s.Status == ServiceStatus.WaitingForParts, cancellationToken);
        var activeCount = await baseQuery.CountAsync(s => s.Status != ServiceStatus.Delivered && s.Status != ServiceStatus.Cancelled, cancellationToken);
        var montajCount = await scopedQuery.CountAsync(s => s.Type == ServiceType.Installation, cancellationToken);
        var arizaCount = await scopedQuery.CountAsync(s => s.Type == ServiceType.Repair, cancellationToken);
        var todayCount = await baseQuery.CountAsync(s => s.CreatedAt >= todayStart, cancellationToken);
        var thisMonthCount = await baseQuery.CountAsync(s => s.CreatedAt >= monthStart, cancellationToken);

        var leadPairs = await baseQuery
            .Where(s => s.EstimatedDeliveryDate != null)
            .Select(s => new { s.CreatedAt, Planned = s.EstimatedDeliveryDate!.Value })
            .ToListAsync(cancellationToken);
        var avgPlanLead = leadPairs.Count == 0
            ? 0d
            : Math.Round(leadPairs.Average(x => (x.Planned - x.CreatedAt).TotalDays), 2);

        var completion = totalCount > 0 ? Math.Round((doneCount * 100d) / totalCount, 1) : 0d;

        var totals = new
        {
            total = totalCount,
            active = activeCount,
            done = doneCount,
            ready = readyCount,
            cancelled = cancelledCount,
            postponed = delayedCount,
            workshop = workshopCount,
            waitingForParts = waitingPartsCount,
            montaj = montajCount,
            ariza = arizaCount,
            today = todayCount,
            thisMonth = thisMonthCount,
            avgPlanLeadDays = avgPlanLead,
            completionRate = completion
        };

        var byStatusRaw = await baseQuery
            .GroupBy(s => s.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        var byStatus = byStatusRaw
            .OrderByDescending(x => x.Count)
            .Select(x => new { status = x.Status.ToString(), count = x.Count })
            .ToList();

        var byRegionRaw = await baseQuery
            .GroupBy(s => s.Region != null ? s.Region.Name : "Bölge Yok")
            .Select(g => new { Region = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        var byRegion = byRegionRaw
            .OrderByDescending(x => x.Count)
            .Take(10)
            .Select(x => new { region = string.IsNullOrWhiteSpace(x.Region) ? "Bölge Yok" : x.Region, count = x.Count })
            .ToList();

        var byTechnicianRaw = await baseQuery
            .GroupBy(s => s.AssignedTechnicianId)
            .Select(g => new
            {
                TechnicianId = g.Key,
                Total = g.Count(),
                Done = g.Count(x => x.Status == ServiceStatus.Delivered),
                Active = g.Count(x => x.Status != ServiceStatus.Delivered && x.Status != ServiceStatus.Cancelled)
            })
            .ToListAsync(cancellationToken);

        var techIds = byTechnicianRaw
            .Where(x => x.TechnicianId.HasValue)
            .Select(x => x.TechnicianId!.Value)
            .Distinct()
            .ToList();
        var techNames = await _context.Technicians
            .AsNoTracking()
            .Where(t => techIds.Contains(t.Id))
            .Select(t => new { t.Id, t.FirstName, t.LastName })
            .ToListAsync(cancellationToken);
        var techNameMap = techNames.ToDictionary(t => t.Id, t => $"{t.FirstName} {t.LastName}".Trim());

        var byTechnician = byTechnicianRaw
            .OrderByDescending(x => x.Total)
            .Take(10)
            .Select(x => new
            {
                technician = x.TechnicianId.HasValue && techNameMap.TryGetValue(x.TechnicianId.Value, out var n) && !string.IsNullOrWhiteSpace(n)
                    ? n
                    : "Atanmadı",
                total = x.Total,
                done = x.Done,
                active = x.Active
            })
            .ToList();

        var byProductRaw = await baseQuery
            .GroupBy(s => string.IsNullOrWhiteSpace(s.ProductName) ? "Bilinmeyen Ürün" : s.ProductName)
            .Select(g => new { Product = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        var byProduct = byProductRaw
            .OrderByDescending(x => x.Count)
            .Take(10)
            .Select(x => new { product = x.Product, count = x.Count })
            .ToList();

        var sixMonthsAgo = new DateTime(nowUtc.Year, nowUtc.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(-5);
        var monthlyRaw = await baseQuery
            .Where(s => s.CreatedAt >= sixMonthsAgo)
            .GroupBy(s => new { s.CreatedAt.Year, s.CreatedAt.Month })
            .Select(g => new
            {
                g.Key.Year,
                g.Key.Month,
                Total = g.Count(),
                Done = g.Count(x => x.Status == ServiceStatus.Delivered)
            })
            .ToListAsync(cancellationToken);

        var monthlyTrend = new List<object>();
        for (var i = 0; i < 6; i++)
        {
            var m = sixMonthsAgo.AddMonths(i);
            var match = monthlyRaw.FirstOrDefault(x => x.Year == m.Year && x.Month == m.Month);
            monthlyTrend.Add(new
            {
                month = $"{m.Year:D4}-{m.Month:D2}",
                total = match?.Total ?? 0,
                done = match?.Done ?? 0
            });
        }

        return Ok(new
        {
            success = true,
            data = new { totals, byStatus, byRegion, byTechnician, byProduct, monthlyTrend }
        });
    }

    [HttpGet("export")]
    public async Task<ActionResult<object>> Export(
        [FromQuery] string? q,
        [FromQuery] ServiceStatus? status,
        [FromQuery] ServiceType? type,
        [FromQuery] DateTime? dateFrom,
        [FromQuery] DateTime? dateTo,
        [FromQuery] Guid? technicianId,
        CancellationToken cancellationToken)
    {
        var query = _context.ServiceRecords.AsQueryable();
        if (technicianId.HasValue)
        {
            query = query.Where(s => s.AssignedTechnicianId == technicianId.Value);
        }
        query = query
            .AsNoTracking()
            .Include(s => s.AssignedTechnician)
            .Include(s => s.Region)
            .Include(s => s.Dealer)
            .AsQueryable();

        if (IsTechnicianUser())
        {
            var techId = await GetCurrentTechnicianIdAsync();
            if (!techId.HasValue) return Forbid();
            query = query.Where(s => s.AssignedTechnicianId == techId.Value);
        }

        if (status.HasValue) query = query.Where(s => s.Status == status.Value);
        if (type.HasValue) query = query.Where(s => s.Type == type.Value);
        if (dateFrom.HasValue)
        {
            var from = DateTime.SpecifyKind(dateFrom.Value, DateTimeKind.Utc);
            query = query.Where(s => s.CreatedAt >= from);
        }
        if (dateTo.HasValue)
        {
            var to = DateTime.SpecifyKind(dateTo.Value.Date.AddDays(1), DateTimeKind.Utc);
            query = query.Where(s => s.CreatedAt < to);
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            var like = $"%{q.Trim()}%";
            query = query.Where(s =>
                EF.Functions.ILike(s.ServiceNumber, like) ||
                (s.CustomerName != null && EF.Functions.ILike(s.CustomerName, like)) ||
                (s.CustomerPhone != null && EF.Functions.ILike(s.CustomerPhone, like)) ||
                EF.Functions.ILike(s.ProductName, like) ||
                (s.SerialNumber != null && EF.Functions.ILike(s.SerialNumber, like)));
        }

        var raw = await query
            .OrderByDescending(s => s.CreatedAt)
            .Take(5000)
            .Select(s => new
            {
                id = s.Id,
                serviceNumber = s.ServiceNumber,
                type = s.Type,
                status = s.Status,
                createdAt = s.CreatedAt,
                plannedDate = s.EstimatedDeliveryDate,
                customerName = s.CustomerName,
                customerPhone = s.CustomerPhone,
                customerAddress = s.CustomerAddress,
                productName = s.ProductName,
                productStockCode = s.ProductStockCode,
                serialNumber = s.SerialNumber,
                isUnderWarranty = s.IsUnderWarranty,
                dealerName = s.DealerName ?? (s.Dealer != null ? s.Dealer.Name : null),
                regionName = s.Region != null ? s.Region.Name : null,
                technicianFirstName = s.AssignedTechnician != null ? s.AssignedTechnician.FirstName : null,
                technicianLastName = s.AssignedTechnician != null ? s.AssignedTechnician.LastName : null,
                priority = s.Priority,
                problemDescription = s.ProblemDescription
            })
            .ToListAsync(cancellationToken);

        var rows = raw.Select(s => new
        {
            id = s.id,
            serviceNumber = s.serviceNumber,
            type = s.type.ToString(),
            status = s.status.ToString(),
            createdAt = s.createdAt,
            plannedDate = s.plannedDate,
            customerName = s.customerName,
            customerPhone = s.customerPhone,
            customerAddress = s.customerAddress,
            productName = s.productName,
            productStockCode = s.productStockCode,
            serialNumber = s.serialNumber,
            isUnderWarranty = s.isUnderWarranty,
            dealerName = s.dealerName,
            regionName = s.regionName,
            technicianName = (s.technicianFirstName != null || s.technicianLastName != null)
                ? $"{s.technicianFirstName} {s.technicianLastName}".Trim()
                : null,
            priority = s.priority.ToString(),
            problemDescription = s.problemDescription
        }).ToList();

        return Ok(new { success = true, data = rows });
    }



    [HttpPost("{id:guid}/restore")]
    public async Task<IActionResult> RestoreServiceRecord(Guid id, CancellationToken cancellationToken)
    {
        var record = await _context.ServiceRecords
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(s => s.Id == id, cancellationToken);

        if (record == null) return NotFound();

        record.IsDeleted = false;
        record.DeletedAt = null;
        record.DeletedBy = null;

        await _context.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true, message = "Kayıt başarıyla geri yüklendi." });
    }

    [HttpGet("deleted")]
    public async Task<IActionResult> GetDeletedServiceRecords(
        [FromQuery] string? type,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        CancellationToken cancellationToken = default)
    {
        // Bu uçta hiçbir sayfa yetkisi aranmıyordu: tek engel [Authorize] idi, yani oturum açmış
        // HERKES silinmiş servis kayıtlarını okuyabiliyordu. Doğrulandı (2026-08-10): silinen
        // kayıtlar yetkisi olmayan Müdür rolü 200 ve dolu gövde alıyordu.
        if (!await CanAccessAnyPageAsync("silinenKayitlar")) return Forbid();

        var installableNames = await GetInstallableProductNamesAsync(cancellationToken);

        var baseQuery = _context.ServiceRecords
            .IgnoreQueryFilters()
            .Where(s => s.IsDeleted)
            .AsNoTracking();

        var allDeleted = await baseQuery
            .OrderByDescending(s => s.DeletedAt)
            .ToListAsync(cancellationToken);

        List<ServiceRecord> filtered;
        if (type == "montaj")
        {
            filtered = allDeleted.Where(s => s.Type == ServiceType.Installation).ToList();
        }
        else if (type == "saha")
        {
            filtered = allDeleted
                .Where(s => s.Type == ServiceType.Repair && installableNames.Contains((s.ProductName ?? "").Trim().ToLower()))
                .ToList();
        }
        else if (type == "atolye")
        {
            filtered = allDeleted
                .Where(s => s.Type == ServiceType.Repair && !installableNames.Contains((s.ProductName ?? "").Trim().ToLower()))
                .ToList();
        }
        else
        {
            filtered = allDeleted;
        }

        var totalCount = filtered.Count;
        var items = filtered
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(s => new
            {
                id = s.Id,
                serviceNumber = s.ServiceNumber,
                customerName = s.CustomerName,
                productName = s.ProductName,
                createdAt = s.CreatedAt,
                deletedAt = s.DeletedAt,
                deletedBy = s.DeletedBy,
                type = s.Type.ToString(),
                priority = s.Priority.ToString(),
                status = s.Status.ToString()
            })
            .ToList();

        return Ok(new
        {
            items,
            totalCount,
            page,
            pageSize
        });
    }

    [HttpPut("{id:guid}/satisfaction")]
    public async Task<ActionResult<ServiceRecordDto>> UpdateSatisfaction(Guid id, UpdateSatisfactionDto dto)
    {
        var satisfactionBy = User.FindFirstValue(ClaimTypes.Name) 
            ?? User.FindFirstValue("name") 
            ?? User.Identity?.Name 
            ?? "Bilinmeyen Kullanıcı";

        var result = await _service.UpdateSatisfactionAsync(id, dto, satisfactionBy);
        if (result == null) return NotFound("Servis kaydı bulunamadı.");

        // Hub notification (realtime sync)
        await _hub.Clients.All.SendAsync("ServiceRecordUpdated", result);

        return Ok(result);
    }

    private async Task<HashSet<string>> GetInstallableProductNamesAsync(CancellationToken cancellationToken)
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
            var content = new StringContent(JsonSerializer.Serialize(loginBody), System.Text.Encoding.UTF8, "application/json");
            var loginRes = await client.PostAsync("api/auth/login", content, cancellationToken);
            if (loginRes.IsSuccessStatusCode)
            {
                var loginJson = await loginRes.Content.ReadAsStringAsync(cancellationToken);
                using var doc = JsonDocument.Parse(loginJson);
                
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
                        var res = await client.SendAsync(req, cancellationToken);
                        if (res.IsSuccessStatusCode)
                        {
                            var body = await res.Content.ReadAsStringAsync(cancellationToken);
                            using var pDoc = JsonDocument.Parse(body);
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
            Console.WriteLine($"[DeletedRecords_ERP_Error] {ex.Message}");
        }
        return set;
    }

    [HttpPost("{id:guid}/notes")]
    public async Task<ActionResult<ServiceRecordDto>> AddNote(Guid id, [FromBody] AddServiceNoteDto dto)
    {
        var record = await _context.ServiceRecords.FirstOrDefaultAsync(s => s.Id == id);
        if (record == null) return NotFound();

        var authorName = await ResolvePerformerNameAsync();
        var authorId = User.FindFirstValue(ClaimTypes.NameIdentifier) 
            ?? User.FindFirstValue("sub") 
            ?? "user";

        _context.ServiceNotes.Add(new ServiceNote
        {
            ServiceId = id,
            Content = dto.Content,
            AuthorId = authorId,
            AuthorName = authorName,
            Type = NoteType.General,
            CreatedAt = DateTime.UtcNow
        });

        record.UpdatedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();

        await _hub.Clients.All.SendAsync("service_record_updated", new { id, action = "note_added" });

        var updated = await _service.GetByIdAsync(id);
        return Ok(updated);
    }

    // Kimliksizdi: ağdan erişebilen herkes servis kaydının durumunu geri alabiliyordu.
    [HttpPost("{id}/revert-to-ready")]
    [ServiceOps.Api.Filters.InternalApiKeyOrUser]
    public async Task<IActionResult> RevertToReady([FromRoute] string id, [FromQuery] string? sourcePage)
    {
        if (string.IsNullOrWhiteSpace(id))
            return BadRequest(new { success = false, message = "Geçersiz servis kayıt kimliği" });

        // Kimlik doğrulaması vardı, YETKİ yoktu: [InternalApiKeyOrUser] dışında hiçbir kapı
        // olmadığı için oturum açmış herkes — kendisine hiç iş atanmamış bir saha teknisyeni
        // dahil — herhangi bir kaydı "Hazır"a, herhangi bir montaj görevini "Gerçekleşti"den
        // "Planlandı"ya çevirebiliyordu. Geri alma yönetim işidir.
        var isInternalCall = User?.Identity?.IsAuthenticated != true;
        if (!isInternalCall && IsTechnicianUser()) return Forbid();

        ServiceRecord? record = null;
        if (Guid.TryParse(id, out var recordGuid))
        {
            record = await _context.ServiceRecords.FirstOrDefaultAsync(x => x.Id == recordGuid);
        }

        if (record == null)
        {
            record = await _context.ServiceRecords.FirstOrDefaultAsync(x => x.ServiceNumber == id);
        }

        if (record == null)
        {
            if (Guid.TryParse(id, out var instGuid))
            {
                var instTask = await _context.InstallationTasks.FirstOrDefaultAsync(x => x.Id == instGuid);
                if (instTask != null)
                {
                    if (!isInternalCall && DenyForRecord(await GetRecordAccessFromAnyPageAsync(instTask.ServiceId)) is { } taskDeny) return taskDeny;

                    var wasCompleted = instTask.Status == InstallationTaskStatus.Completed;
                    instTask.Status = InstallationTaskStatus.Planned;
                    instTask.CompletedAt = null;
                    instTask.UpdatedAt = DateTime.UtcNow;

                    // Geri alma iz bırakmıyordu: kim, ne zaman, hangi durumdan geri aldı belli
                    // değildi. Geçmiş modalı bu satırı taskId üzerinden süzüyor.
                    _context.Activities.Add(new Activity
                    {
                        ServiceId = instTask.ServiceId,
                        Type = ActivityType.StatusChanged,
                        ActorUserName = await ResolvePerformerNameAsync(),
                        Payload = System.Text.Json.JsonSerializer.Serialize(new
                        {
                            field = "InstallationTask.Status",
                            oldValue = (wasCompleted ? InstallationTaskStatus.Completed : instTask.Status).ToTurkishString(),
                            newValue = InstallationTaskStatus.Planned.ToTurkishString(),
                            reason = "Görev planlandı konumuna geri alındı.",
                            metadata = new { taskId = instTask.Id }
                        }),
                        CreatedAt = DateTime.UtcNow
                    });

                    await _context.SaveChangesAsync();
                    await _hub.Clients.All.SendAsync("ReceiveServiceRecordUpdate", new { id = instTask.Id, status = "Planned" });
                    return Ok(new { success = true, message = "Montaj görevi planlandı konumuna geri aktarıldı." });
                }
            }

            return NotFound(new { success = false, message = "Servis kaydı bulunamadı." });
        }

        if (!isInternalCall && DenyForRecord(await GetRecordAccessFromAnyPageAsync(record.Id)) is { } deny) return deny;

        var pageStr = (sourcePage ?? string.Empty).Trim();
        var previousStatus = record.Status;

        // DAMGA VARSA TAHMİN YOK (kullanıcı kuralı, 2026-08-13).
        //
        // Faturalama anında kaydın o günkü durumu `PreInvoiceStatus`e yazılıyor; geri alma onu
        // aynen geri koyar — sahadaysa sahaya, atölyedeyse atölyeye. Eski davranış çağıranın
        // gönderdiği sayfa adına bakıp iki değerden birini SEÇİYORDU ve atölyeden gelen kayıt
        // "Hazır"a düşüyordu; kullanıcının bildirdiği hata buydu.
        //
        // Damgasız (bu alandan önce faturalanmış) kayıtlarda eski tahmin yolu korunuyor:
        // yanlış olabilir ama hiçbir şey yapmamaktan iyidir ve davranışı kötüleştirmez.
        if (record.PreInvoiceStatus.HasValue)
        {
            record.Status = record.PreInvoiceStatus.Value;
        }
        else if (string.Equals(pageStr, "SahaPlanlama", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(pageStr, "SahaAriza", StringComparison.OrdinalIgnoreCase))
        {
            record.Status = ServiceStatus.FieldPlanned; // Saha Planlaması sekmesine geri döner
        }
        else
        {
            record.Status = ServiceStatus.Ready; // Hazır Ürün Teslimat Planlama sekmesine (Planlamaya) geri döner
        }

        // FATURA İŞARETİ DE KALKAR.
        //
        // Geri alma `IsInvoiced`a dokunmuyordu: kayıt eski durumuna dönüyor ama "faturalandı"
        // damgası üstünde kaldığı için BİR DAHA faturalanamıyordu (sahiplenme UPDATE'i
        // `!IsInvoiced` arıyor). Fatura silindiyse kayıt gerçekten faturasızdır.
        record.IsInvoiced = false;
        record.InvoiceReference = null;
        record.PreInvoiceStatus = null;
        record.CompletedAt = null;

        record.UpdatedAt = DateTime.UtcNow;

        // Geri alma hiç iz bırakmıyordu; kaydın geçmişinde durum neden değişti görünmüyordu.
        if (previousStatus != record.Status)
        {
            _context.Activities.Add(new Activity
            {
                ServiceId = record.Id,
                Type = ActivityType.StatusChanged,
                ActorUserName = await ResolvePerformerNameAsync(),
                Payload = System.Text.Json.JsonSerializer.Serialize(new
                {
                    field = "Status",
                    oldValue = previousStatus.ToTurkishString(),
                    newValue = record.Status.ToTurkishString(),
                    reason = "Satış faturası silindiği için kayıt faturalama öncesindeki durumuna geri alındı."
                }),
                CreatedAt = DateTime.UtcNow
            });
        }

        await _context.SaveChangesAsync();

        await _hub.Clients.All.SendAsync("ReceiveServiceRecordUpdate", new { id = record.Id, status = record.Status.ToString() });

        return Ok(new { success = true, message = $"Kayıt {record.Status} konumuna geri aktarıldı." });
    }

    /// <summary>
    /// Firmanın BÜTÜN servis verisini siler (TRUNCATE). Geliştirme aracı.
    ///
    /// [AllowAnonymous] KALDIRILDI: bu uç KİMLİKSİZ erişilebilir durumdaydı. Yani ağdan API'ye
    /// ulaşabilen herkes, oturum bile açmadan tek istekle firmanın tüm servis verisini
    /// silebiliyordu. Öznitelik XML yorumunun ÜSTÜNDE durduğu için gözden kaçmıştı.
    ///
    /// HİÇBİR YETKİ KONTROLÜ YOKTU: `[Authorize]` dışında engel olmadığı için oturum açmış
    /// herhangi biri — bir saha teknisyeni dahi — tek istekle firmanın tüm servis kayıtlarını,
    /// notlarını, iş emirlerini ve montaj görevlerini silebiliyordu. 2026-08-07'de yetki
    /// senaryosu testinde fiilen tetiklendi ve DEMOTEST boşaldı (yedekten geri yüklendi).
    ///
    /// Artık: yalnızca süper admin VE yalnızca Development ortamında. Üretimde uç yok sayılır.
    /// Ayrıca onay metni istenir, böylece yanlış tıklama veya otomatik istek yeterli olmaz.
    /// </summary>
    [HttpDelete("clear-all")]
    public async Task<IActionResult> ClearAllServiceRecords(
        [FromQuery] string? confirm,
        [FromServices] IWebHostEnvironment environment)
    {
        if (!environment.IsDevelopment())
        {
            return NotFound();
        }

        var scope = await _permissions.GetScopeAsync(User, "ayarlar");

        if (!_permissions.IsSuperAdmin(User) || scope.Kind != ServiceOpsScopeKind.All)
        {
            return Forbid();
        }

        if (!string.Equals(confirm, "TUM-SERVIS-VERISINI-SIL", StringComparison.Ordinal))
        {
            return BadRequest(new
            {
                success = false,
                message = "Bu işlem firmanın tüm servis verisini siler. Onaylamak için ?confirm=TUM-SERVIS-VERISINI-SIL ekleyin."
            });
        }

        await _context.Database.ExecuteSqlRawAsync("TRUNCATE TABLE \"ServiceRecords\" CASCADE; TRUNCATE TABLE \"ServiceNotes\" CASCADE; TRUNCATE TABLE \"Activities\" CASCADE; TRUNCATE TABLE \"WorkOrders\" CASCADE; TRUNCATE TABLE \"InstallationTasks\" CASCADE;");
        return Ok(new { success = true, message = "Tüm servis kayıtları temizlendi." });
    }
}

public class AddServiceNoteDto
{
    public string Content { get; set; } = string.Empty;
}

/// <summary>Kağıt fiş numarası güncelleme gövdesi. Boş string = numarayı temizle.</summary>
public class UpdateManualReceiptNoDto
{
    public string? ManualReceiptNo { get; set; }
}

public class UpdateUserPlanDto
{
    public bool? UserRouteTick { get; set; }
    public string? UserRouteHour { get; set; }
    public int? UserRouteSortOrder { get; set; }
}

public class BulkUserPlanRequest
{
    public List<BulkUserPlanItem> Items { get; set; } = new();
}

public class BulkUserPlanItem
{
    public Guid ServiceRecordId { get; set; }
    public bool? UserRouteTick { get; set; }
    public string? UserRouteHour { get; set; }
    public int? UserRouteSortOrder { get; set; }
}

public class UpdateRoutePlanDto
{
    public int? RouteOrder { get; set; }
    public string? PlannedStartTime { get; set; }
    public string? PlannedEndTime { get; set; }
    public string? RouteDate { get; set; }
    public Guid? TechnicianId { get; set; }
}

public class BulkRoutePlanRequest
{
    public List<BulkRoutePlanItem> Items { get; set; } = new();
}

public class BulkRoutePlanItem
{
    public Guid ServiceRecordId { get; set; }
    public int? RouteOrder { get; set; }
    public string? PlannedStartTime { get; set; }
    public string? PlannedEndTime { get; set; }
    public string? RouteDate { get; set; }
    public Guid? TechnicianId { get; set; }
}

