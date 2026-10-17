using B2B.Erp.Api.Data;
using B2B.Erp.Api.DTOs.Pages;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class PagesController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly MasterDbContext _masterDb;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public PagesController(AppDbContext dbContext, MasterDbContext masterDb, IHttpContextAccessor httpContextAccessor)
    {
        _dbContext = dbContext;
        _masterDb = masterDb;
        _httpContextAccessor = httpContextAccessor;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(CancellationToken cancellationToken)
    {
        await EnsureGenelAyarlarPageExistsAsync(cancellationToken);
        var tenantId = await ResolveTenantIdAsync(cancellationToken);
        if (tenantId is null)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var visibility = await Data.Services.TenantPageVisibility.ResolveAsync(_masterDb, _dbContext, tenantId.Value, cancellationToken);
        var hasAnyConfig = visibility.HasAnyConfig;
        var enabledIds = visibility.EnabledPageIds;

        if (hasAnyConfig && enabledIds.Count == 0)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var pages = await _dbContext.Pages
            .AsNoTracking()
            .Where(p => (!hasAnyConfig || enabledIds.Contains(p.Id)) && p.IsActive)
            .OrderBy(p => p.ModuleKey)
            .ThenBy(p => p.SortOrder)
            .ToListAsync(cancellationToken);

        var data = pages.Select(p => new PageResponse
        {
            Id = p.Id,
            ModuleKey = p.ModuleKey,
            Key = p.Key,
            DisplayName = p.DisplayName,
            SortOrder = p.SortOrder,
            IsActive = p.IsActive
        }).ToList();

        return Ok(new { success = true, data });
    }

    [HttpGet("all")]
    public async Task<IActionResult> GetAllPagesForSsa(CancellationToken cancellationToken)
    {
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        if (!isSsa)
        {
            return StatusCode(403, new { success = false, message = "Yetkiniz yok" });
        }

        await EnsureGenelAyarlarPageExistsAsync(cancellationToken);

        var pages = await _dbContext.Pages
            .AsNoTracking()
            .Where(p => p.IsActive)
            .OrderBy(p => p.ModuleKey)
            .ThenBy(p => p.SortOrder)
            .ToListAsync(cancellationToken);

        var data = pages.Select(p => new PageResponse
        {
            Id = p.Id,
            ModuleKey = p.ModuleKey,
            Key = p.Key,
            DisplayName = p.DisplayName,
            SortOrder = p.SortOrder,
            IsActive = p.IsActive
        }).ToList();

        return Ok(new { success = true, data });
    }

    [HttpGet("enabled-keys")]
    public async Task<IActionResult> GetEnabledKeys(CancellationToken cancellationToken)
    {
        await EnsureGenelAyarlarPageExistsAsync(cancellationToken);
        var tenantId = await ResolveTenantIdAsync(cancellationToken);
        if (tenantId is null)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        await SyncEcommercePagesForTenantAsync(tenantId.Value, cancellationToken);

        var visibility = await Data.Services.TenantPageVisibility.ResolveAsync(_masterDb, _dbContext, tenantId.Value, cancellationToken);
        var hasAnyConfig = visibility.HasAnyConfig;
        var enabledIds = visibility.EnabledPageIds;

        if (hasAnyConfig && enabledIds.Count == 0)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var items = await _dbContext.Pages
            .AsNoTracking()
            .Where(p => (!hasAnyConfig || enabledIds.Contains(p.Id)) && p.IsActive)
            .Select(p => new
            {
                moduleKey = p.ModuleKey,
                pageKey = p.Key
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = items });
    }

    private async Task<int?> ResolveTenantIdAsync(CancellationToken cancellationToken)
    {
        var ctx = _httpContextAccessor.HttpContext;
        if (ctx is null) return null;

        var tenantIdStr = ctx.User.FindFirst("TenantId")?.Value;
        if (int.TryParse(tenantIdStr, out var tenantId) && tenantId > 0) return tenantId;

        if (ctx.Request.Headers.TryGetValue("X-Tenant-Code", out var codeValues))
        {
            var code = codeValues.ToString().Trim();
            if (!string.IsNullOrWhiteSpace(code))
            {
                var id = await _masterDb.Tenants
                    .AsNoTracking()
                    .Where(x => x.Code == code)
                    .Select(x => (int?)x.Id)
                    .FirstOrDefaultAsync(cancellationToken);
                return id;
            }
        }

        return null;
    }

    /// <summary>E-ticaret modülünün sayfa kimlikleri (bkz. <see cref="EnsureGenelAyarlarPageExistsAsync"/>).</summary>
    private static readonly int[] EcommercePageIds = { 5200, 5201, 5202, 5203, 5204, 5205, 5206 };

    /// <summary>
    /// Firmanın e-ticaret modülünü açık/kapalı hâline göre e-ticaret sayfalarını firmaya açar.
    ///
    /// NEDEN GEREKLİ: firmanın hangi sayfaları görebileceği master veritabanında satır satır
    /// tutuluyor. Yeni eklenen bir sayfa o listede olmadığı için, yetkisi olsa bile hiç kimseye
    /// görünmüyor. Sonuç, sessiz bir "menü yok" durumu olurdu ve sebebi hiçbir ekranda yazmazdı.
    ///
    /// Bağ FİRMA AYARINA kuruluyor, elle işaretlemeye değil: e-ticareti Proje Yönetimi'nden
    /// açan kişi ikinci bir yerde daha sayfa işaretlemek zorunda kalmamalı. Kapatınca da
    /// kapanıyor — açık kalan bir menü, kapalı olduğu sanılan bir modül demek.
    /// </summary>
    private async Task SyncEcommercePagesForTenantAsync(int tenantId, CancellationToken cancellationToken)
    {
        try
        {
            var tenant = await _masterDb.Tenants
                .AsNoTracking()
                .Where(x => x.Id == tenantId)
                .Select(x => new { x.IsEcommerceEnabled })
                .FirstOrDefaultAsync(cancellationToken);

            if (tenant is null) return;

            var existing = await _masterDb.TenantEnabledPages
                .Where(x => x.TenantId == tenantId && EcommercePageIds.Contains(x.PageId))
                .ToListAsync(cancellationToken);

            var changed = false;

            foreach (var pageId in EcommercePageIds)
            {
                var row = existing.FirstOrDefault(x => x.PageId == pageId);

                if (row is null)
                {
                    // Kapalıyken satır hiç açılmıyor: gereksiz satır, "kapalı" bilgisini taşımıyor.
                    if (!tenant.IsEcommerceEnabled) continue;

                    _masterDb.TenantEnabledPages.Add(new Entities.TenantEnabledPage
                    {
                        TenantId = tenantId,
                        PageId = pageId,
                        IsEnabled = true
                    });
                    changed = true;
                }
                else if (row.IsEnabled != tenant.IsEcommerceEnabled)
                {
                    row.IsEnabled = tenant.IsEcommerceEnabled;
                    changed = true;
                }
            }

            if (changed) await _masterDb.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            // Menü listesi bu eşitleme yüzünden hiç dönmemeli: hata yutuluyor, menü eski hâliyle gelir.
            Console.WriteLine($"[Pages] E-ticaret sayfa eşitlemesi başarısız: {ex.Message}");
        }
    }

    /// <summary>
    /// Eksik sayfa/izin satırlarını tamamlayan, tekrar çalıştırılabilir tohumlama.
    ///
    /// HATASI YUTULUYOR VE LOG'A YAZILIYOR. Sebebi yaşanmış: içindeki tek bir ifade (firmada
    /// bulunmayan bir rol kimliğine yazmaya çalışan bir INSERT) yabancı anahtar hatası verince
    /// bütün parti düşüyor, onu çağıran <c>enabled-keys</c> ucu 500 dönüyor ve ön yüz boş yanıtı
    /// "bu firmada hiçbir sayfa açık değil" diye yorumluyordu. Sonuç: SSA dışındaki her kullanıcı
    /// için menü tamamen boş. Bir yardımcı tohumlama, uygulamanın açılışını engelleyemez —
    /// eksik satır olsa bile menü mevcut haliyle dönmelidir.
    /// </summary>
    /// <summary>
    /// Tohumlama VERİTABANI BAŞINA BİR KEZ çalışır.
    ///
    /// Bu metot üç GET ucunun da başında çağrılıyor — `enabled-keys` ise ön yüzün her menü
    /// yüklemesinde istediği en sıcak uç. İçeride onlarca `INSERT ... WHERE NOT EXISTS` var:
    /// hiçbir satır eklemese bile her istek bir YAZMA işlemi açıyor ve okuma yolunu
    /// gereksiz yere kilit/WAL trafiğine sokuyordu. Nöbetçi bağlantı dizesine göre tutuluyor
    /// (her firmanın kendi veritabanı var); hata olursa nöbetçi İŞARETLENMEZ, bir sonraki
    /// istek yeniden dener — eksik tohum kalıcı hâle gelmesin.
    /// </summary>
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, bool> SeededDatabases = new();

    private async Task EnsureGenelAyarlarPageExistsAsync(CancellationToken cancellationToken)
    {
        var seedKey = _dbContext.Database.GetConnectionString() ?? "default";
        if (SeededDatabases.ContainsKey(seedKey)) return;

        try
        {
            await EnsureGenelAyarlarPageExistsCoreAsync(cancellationToken);
            SeededDatabases[seedKey] = true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Pages] Sayfa/izin tohumlaması başarısız (menü mevcut haliyle döner): {ex.Message}");
        }
    }

    private async Task EnsureGenelAyarlarPageExistsCoreAsync(CancellationToken cancellationToken)
    {
        // ÖNCE ONARIM, SONRA TOHUMLAMA — gerekçesi RolesController'daki eşiyle aynı,
        // ayrıntısı PagePermissionRepair'de.
        await PagePermissionRepair.MergeDuplicatePagesAsync(_dbContext, cancellationToken);

        await _dbContext.Database.ExecuteSqlRawAsync(@"
INSERT INTO ""Pages"" (""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 'Genel Ayarlar', TRUE, 'genelAyarlar', 'users', 14
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='users' AND ""Key""='genelAyarlar');

INSERT INTO ""Pages"" (""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 'Taksit Oranları', TRUE, 'taksitOranlari', 'pos', 3
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='pos' AND ""Key""='taksitOranlari');

INSERT INTO ""Pages"" (""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 'Cari Borç / Alacak Raporu', TRUE, 'cariBorcAlacak', 'reports', 2
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='reports' AND ""Key""='cariBorcAlacak');

UPDATE ""Pages""
SET ""DisplayName"" = 'Fatura Dökümü'
WHERE ""ModuleKey"" = 'invoice' AND ""Key"" = 'faturaDokum';

UPDATE ""Pages""
SET ""DisplayName"" = 'Satış Faturası'
WHERE ""ModuleKey"" = 'invoice' AND ""Key"" = 'satisFatura';
 
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 400, 'Çalışan', TRUE, 'calisan', 'employee', 1
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='calisan' OR ""Id""=400);

UPDATE ""Pages""
SET ""ModuleKey""='employee', ""SortOrder""=1
WHERE (""Id""=400 OR ""Key""='calisan') AND ""ModuleKey"" <> 'employee';

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 402, 'Kampanya Tanım', TRUE, 'kampanya', 'users', 19
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE (""ModuleKey""='users' AND ""Key""='kampanya') OR ""Id""=402);

-- FİYATLANDIRMA EKRANLARININ SAYFA ANAHTARLARI.
--
-- Bu üç ekran menüde vardı ama `Pages` tablosunda KARŞILIĞI YOKTU; dolayısıyla uçlarını
-- [AuthorizePage] ile korumak imkânsızdı (yetki satırı olmayan sayfa herkesi kilitler).
-- Anahtarlar menüdeki id'lerle birebir aynı (AppLayout: atiliFiyatlandirma / topluFiyatAtama /
-- fiyatKategorileri). Id verilmiyor — çakışma riski olmasın diye sıra numarası otomatik.
INSERT INTO ""Pages"" (""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 'Fiyat Atama', TRUE, 'atiliFiyatlandirma', 'users', 20
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='users' AND ""Key""='atiliFiyatlandirma');

INSERT INTO ""Pages"" (""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 'Toplu Fiyat Atama', TRUE, 'topluFiyatAtama', 'users', 21
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='users' AND ""Key""='topluFiyatAtama');

INSERT INTO ""Pages"" (""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 'Fiyat Kategorileri', TRUE, 'fiyatKategorileri', 'users', 22
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='users' AND ""Key""='fiyatKategorileri');

-- Yetki SÜPER ADMİN ROLLERİNE verilir (kullanıcı kararı: SSA claim'den girer, superadmin
-- yetkiden). Rol kimlikleri FİRMADAN FİRMAYA DEĞİŞTİĞİ için sabit ARRAY[1,2,3] yazılamaz —
-- roller `IsSuperAdmin` bayrağından bulunuyor. Diğer roller için yetki Rol Yetkileri
-- ekranından açılır; `ON CONFLICT DO NOTHING` elle yapılan değişikliği ezmez.
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT role.""Id"", p.""Id"", TRUE
FROM ""Roles"" role
CROSS JOIN ""Pages"" p
WHERE role.""IsSuperAdmin"" = TRUE
  AND p.""ModuleKey"" = 'users'
  AND p.""Key"" IN ('atiliFiyatlandirma', 'topluFiyatAtama', 'fiyatKategorileri')
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

-- Bildirim sayfaları 'users' değil kendi modülünde açılır (aşağıdaki taşıma bloğuna bakın).
INSERT INTO ""Pages"" (""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 'Bildirimler', TRUE, 'bildirimler', 'bildirimler', 1
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='bildirimler');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 403, 'Gelen Bildirimler', TRUE, 'bildirimlerGelen', 'bildirimler', 2
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='bildirimlerGelen' OR ""Id""=403);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 404, 'Bildirim Gönder', TRUE, 'bildirimlerGonder', 'bildirimler', 3
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='bildirimlerGonder' OR ""Id""=404);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 405, 'Kullanıcı Hareketleri', TRUE, 'userActivities', 'users', 20
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='userActivities' OR ""Id""=405);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 406, 'Hata Logları', TRUE, 'systemErrorLogs', 'users', 21
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='systemErrorLogs' OR ""Id""=406);

-- BİLDİRİM YETKİLERİ — TEK SEFERLİK DURUM AYARI + MODÜL TAŞIMA
-- (Aynısı RolesController.EnsureGenelAyarlarPageExistsCoreAsync içinde de var; bu dosyadaki
--  blokla BİRLİKTE güncellenmeli, yoksa hangisi önce koşarsa o kazanır ve tenant'lar ayrışır.)
--
-- Sıra önemli: ilk iki blok sayfa hâlâ 'users' modülündeyken çalışır, üçüncüsü modülü taşıyıp
-- koşulu kalıcı olarak yanlışa çevirir. Böylece ayrı bir uygulandi-damgasi tablosuna gerek kalmadan
-- her tenant'ta TAM BİR KEZ çalışır. Tek seferlik olması şart: her açılışta zorlansaydı,
-- Rol Yetkileri ekranından yapılan değişiklik bir sonraki yeniden başlatmada geri alınırdı.

-- 1) Bildirim ALMA: her role açık. Sabit 1..12 dizisi değil tenant'ın KENDİ rolleri —
--    firmaya özel roller de kapsansın diye.
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT role.""Id"", 403, TRUE
FROM ""Roles"" role
WHERE EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='bildirimlerGelen' AND ""ModuleKey""='users')
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

UPDATE ""RolePagePermissions"" SET ""CanAccess"" = TRUE
WHERE ""PageId"" = 403
  AND EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='bildirimlerGelen' AND ""ModuleKey""='users');

-- 2) Bildirim GÖNDERME: şimdilik kapalı. SSA'nın hakkı bu tablodan değil, koddaki
--    süper admin kontrolünden geliyor.
UPDATE ""RolePagePermissions"" SET ""CanAccess"" = FALSE
WHERE ""PageId"" = 404
  AND EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='bildirimlerGonder' AND ""ModuleKey""='users');

-- 3) Modülü taşı — hem asıl amaç (Bildirimler artık Ayarlar'ın altı değil) hem de
--    yukarıdaki blokların bir daha çalışmamasını sağlayan anahtar.
UPDATE ""Pages"" SET ""ModuleKey"" = 'bildirimler', ""SortOrder"" = CASE ""Key""
        WHEN 'bildirimler' THEN 1
        WHEN 'bildirimlerGelen' THEN 2
        WHEN 'bildirimlerGonder' THEN 3
        ELSE ""SortOrder"" END
WHERE ""ModuleKey"" = 'users'
  AND ""Key"" IN ('bildirimler', 'bildirimlerGelen', 'bildirimlerGonder');

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.r, 405, TRUE
FROM unnest(ARRAY[1,2,3,6]) AS r(r)
JOIN ""Roles"" role ON role.""Id"" = r.r
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.r, 406, TRUE
FROM unnest(ARRAY[1,2,6]) AS r(r)
JOIN ""Roles"" role ON role.""Id"" = r.r
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 4999, 'Dashboard / Gösterge Paneli', TRUE, 'dashboard', 'serviceOps', 0
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 4999 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'dashboard'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5000, 'Montaj Kabul', TRUE, 'montajKabul', 'serviceOps', 1
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5000 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'montajKabul'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5001, 'Montaj Yönetimi', TRUE, 'montajYonetimi', 'serviceOps', 2
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5001 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'montajYonetimi'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5002, 'Büyük Ev Aletleri Kabul', TRUE, 'buyukEvAletleriKabul', 'serviceOps', 3
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5002 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukEvAletleriKabul'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5003, 'Büyük Ürün (Saha Arıza)', TRUE, 'buyukUrun', 'serviceOps', 4
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5003 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukUrun'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5004, 'Küçük Ev Aletleri Kabul', TRUE, 'kucukUrunKabul', 'serviceOps', 5
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5004 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'kucukUrunKabul'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5005, 'Küçük Ürün (Atölye Arıza)', TRUE, 'atolyeAriza', 'serviceOps', 6
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5005 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'atolyeAriza'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5006, 'Kargo Takibi', TRUE, 'kargoTakibi', 'serviceOps', 7
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5006 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'kargoTakibi'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5007, 'Kargo Planlama', TRUE, 'kargoPlanlama', 'serviceOps', 8
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5007 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'kargoPlanlama'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5008, 'Teknisyenler', TRUE, 'teknisyenler', 'serviceOps', 9
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5008 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'teknisyenler'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5009, 'Takvim', TRUE, 'takvim', 'serviceOps', 10
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5009 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'takvim'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5010, 'Rota', TRUE, 'rota', 'serviceOps', 11
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5010 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'rota'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5011, 'Müşteriler & Bayiler', TRUE, 'musterilerBayiler', 'serviceOps', 12
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5011 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'musterilerBayiler'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5012, 'Stok', TRUE, 'stok', 'serviceOps', 13
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5012 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'stok'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5013, 'Araç Depoları', TRUE, 'aracDepolari', 'serviceOps', 14
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5013 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'aracDepolari'));

-- Tahsilat (2026-08-12). Saha ekibinin TEK isi para almak; eskiden Arac Depolari
-- sayfasindaki bir dugmeydi ve depoya bagli teknisyene bagliydi, o yuzden Merkez/Sube
-- deposunda hic acilmiyordu. Artik kendi sayfasi ve kendi yetkisi var.
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5400, 'Tahsilat', TRUE, 'tahsilat', 'serviceOps', 15
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5400 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'tahsilat'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5014, 'Silinen Kayıtlar', TRUE, 'silinenKayitlar', 'serviceOps', 15
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5014 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'silinenKayitlar'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5015, 'Teknisyen Takip', TRUE, 'teknisyenTakip', 'serviceOps', 16
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5015 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'teknisyenTakip'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5016, 'Teknisyen Notu', TRUE, 'teknisyenNotu', 'serviceOps', 17
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5016 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'teknisyenNotu'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5017, 'Raporlar', TRUE, 'raporlar', 'serviceOps', 18
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5017 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'raporlar'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5018, 'Analiz', TRUE, 'analiz', 'serviceOps', 19
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5018 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'analiz'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5019, 'Ayarlar', TRUE, 'ayarlar', 'serviceOps', 20
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5019 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'ayarlar'));

/* SUB-PERMISSIONS (ALT YETKİLER) */

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5020, 'Planlama Sekmesi', TRUE, 'montajYonetimi.planlama', 'serviceOps', 21
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5020 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'montajYonetimi.planlama'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5021, 'Teslimattakiler Sekmesi', TRUE, 'montajYonetimi.teslimat', 'serviceOps', 22
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5021 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'montajYonetimi.teslimat'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5022, 'Yeniden Planlama Modalı', TRUE, 'montajYonetimi.geriPlanlama', 'serviceOps', 23
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5022 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'montajYonetimi.geriPlanlama'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5023, 'Planlama Sekmesi', TRUE, 'buyukUrun.planlama', 'serviceOps', 24
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5023 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukUrun.planlama'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5024, 'Saha Planlaması Sekmesi', TRUE, 'buyukUrun.sahaPlanlama', 'serviceOps', 25
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5024 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukUrun.sahaPlanlama'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5025, 'Atölye Sekmesi', TRUE, 'buyukUrun.atolye', 'serviceOps', 26
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5025 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukUrun.atolye'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5026, 'Hazır Ürün Teslimat Planlama Sekmesi', TRUE, 'buyukUrun.hazirTeslimat', 'serviceOps', 27
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5026 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukUrun.hazirTeslimat'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5027, 'Teslimattakiler Sekmesi', TRUE, 'buyukUrun.teslimattakiler', 'serviceOps', 28
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5027 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukUrun.teslimattakiler'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5028, 'İşlem Kaydet / Teslim Et Modalı', TRUE, 'buyukUrun.islemKaydet', 'serviceOps', 29
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5028 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukUrun.islemKaydet'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5029, 'Yedek Parça Modalı', TRUE, 'buyukUrun.yedekParca', 'serviceOps', 30
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5029 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukUrun.yedekParca'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5030, 'Küçük Ürün Atölyesi Sekmesi', TRUE, 'atolyeAriza.atolye', 'serviceOps', 31
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5030 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'atolyeAriza.atolye'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5031, 'Hazır Ürün Teslimat Planlama Sekmesi', TRUE, 'atolyeAriza.hazirTeslimat', 'serviceOps', 32
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5031 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'atolyeAriza.hazirTeslimat'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5032, 'Teslimattakiler Sekmesi', TRUE, 'atolyeAriza.teslimattakiler', 'serviceOps', 33
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5032 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'atolyeAriza.teslimattakiler'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5033, 'İşlem Kaydet Modalı', TRUE, 'atolyeAriza.islemKaydet', 'serviceOps', 34
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5033 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'atolyeAriza.islemKaydet'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5034, 'Yedek Parça Modalı', TRUE, 'atolyeAriza.yedekParca', 'serviceOps', 35
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5034 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'atolyeAriza.yedekParca'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5035, 'Yeni Montaj Kabul Modalı', TRUE, 'montajKabul.yeniKabul', 'serviceOps', 36
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5035 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'montajKabul.yeniKabul'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5036, 'Montaj Kabul Düzenleme Modalı', TRUE, 'montajKabul.kabulDuzenle', 'serviceOps', 37
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5036 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'montajKabul.kabulDuzenle'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5037, 'Yeni Ürün Kabul Modalı', TRUE, 'buyukEvAletleriKabul.yeniKabul', 'serviceOps', 38
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5037 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukEvAletleriKabul.yeniKabul'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5038, 'Yeni Ürün Kabul Modalı', TRUE, 'kucukUrunKabul.yeniKabul', 'serviceOps', 39
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5038 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'kucukUrunKabul.yeniKabul'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5039, 'Yeni Teknisyen Modalı', TRUE, 'teknisyenler.yeniTeknisyen', 'serviceOps', 40
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5039 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'teknisyenler.yeniTeknisyen'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5040, 'Teknisyen Düzenleme Modalı', TRUE, 'teknisyenler.teknisyenDuzenle', 'serviceOps', 41
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5040 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'teknisyenler.teknisyenDuzenle'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5041, 'Teknisyen Şifre Değiştirme Modalı', TRUE, 'teknisyenler.sifreDegistir', 'serviceOps', 42
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5041 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'teknisyenler.sifreDegistir'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5042, 'Yeni Müşteri/Bayi Modalı', TRUE, 'musterilerBayiler.yeniMusteri', 'serviceOps', 43
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5042 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'musterilerBayiler.yeniMusteri'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5043, 'Müşteri Düzenleme Modalı', TRUE, 'musterilerBayiler.musteriDuzenle', 'serviceOps', 44
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5043 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'musterilerBayiler.musteriDuzenle'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5044, 'Yeni Stok/Yedek Parça Modalı', TRUE, 'stok.yeniStok', 'serviceOps', 45
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5044 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'stok.yeniStok'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5045, 'Stok Düzenleme Modalı', TRUE, 'stok.stokGuncelle', 'serviceOps', 46
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5045 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'stok.stokGuncelle'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5046, 'Araç Depo Transfer Modalı', TRUE, 'aracDepolari.depoTransfer', 'serviceOps', 47
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5046 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'aracDepolari.depoTransfer'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5047, 'Kargo Durum Güncelleme Modalı', TRUE, 'kargoTakibi.durumGuncelle', 'serviceOps', 48
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5047 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'kargoTakibi.durumGuncelle'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5048, 'Yeni Kargo Planlama Modalı', TRUE, 'kargoPlanlama.yeniPlan', 'serviceOps', 49
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5048 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'kargoPlanlama.yeniPlan'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5050, 'Tüm İşleri Görme Yetkisi', TRUE, 'montajKabul.tumIsleriGorme', 'serviceOps', 50
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5050 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'montajKabul.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5051, 'Tüm İşleri Görme Yetkisi', TRUE, 'montajYonetimi.tumIsleriGorme', 'serviceOps', 51
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5051 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'montajYonetimi.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5052, 'Tüm İşleri Görme Yetkisi', TRUE, 'buyukEvAletleriKabul.tumIsleriGorme', 'serviceOps', 52
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5052 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukEvAletleriKabul.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5053, 'Tüm İşleri Görme Yetkisi', TRUE, 'buyukUrun.tumIsleriGorme', 'serviceOps', 53
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5053 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukUrun.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5054, 'Tüm İşleri Görme Yetkisi', TRUE, 'kucukUrunKabul.tumIsleriGorme', 'serviceOps', 54
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5054 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'kucukUrunKabul.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5055, 'Tüm İşleri Görme Yetkisi', TRUE, 'atolyeAriza.tumIsleriGorme', 'serviceOps', 55
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5055 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'atolyeAriza.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5056, 'Tüm İşleri Görme Yetkisi', TRUE, 'kargoTakibi.tumIsleriGorme', 'serviceOps', 56
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5056 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'kargoTakibi.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5057, 'Tüm İşleri Görme Yetkisi', TRUE, 'kargoPlanlama.tumIsleriGorme', 'serviceOps', 57
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5057 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'kargoPlanlama.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5058, 'Tüm İşleri Görme Yetkisi', TRUE, 'teknisyenler.tumIsleriGorme', 'serviceOps', 58
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5058 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'teknisyenler.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5059, 'Tüm İşleri Görme Yetkisi', TRUE, 'stok.tumIsleriGorme', 'serviceOps', 59
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5059 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'stok.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5060, 'Tüm İşleri Görme Yetkisi', TRUE, 'aracDepolari.tumIsleriGorme', 'serviceOps', 60
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5060 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'aracDepolari.tumIsleriGorme'));

-- Kapsam artık alt sekme seviyesinde. Montaj Yönetimi, Büyük Ürün ve Küçük Ürün sekmelere
-- bölündüğü için her sekme kendi 'tüm işleri görme' anahtarını taşır; anahtar kapalıysa o
-- sekmede yalnızca kullanıcıya atanmış işler listelenir.

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5061, 'Tüm İşleri Görme Yetkisi', TRUE, 'montajYonetimi.planlama.tumIsleriGorme', 'serviceOps', 61
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5061 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'montajYonetimi.planlama.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5062, 'Tüm İşleri Görme Yetkisi', TRUE, 'montajYonetimi.teslimat.tumIsleriGorme', 'serviceOps', 62
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5062 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'montajYonetimi.teslimat.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5063, 'Tüm İşleri Görme Yetkisi', TRUE, 'buyukUrun.planlama.tumIsleriGorme', 'serviceOps', 63
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5063 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukUrun.planlama.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5064, 'Tüm İşleri Görme Yetkisi', TRUE, 'buyukUrun.sahaPlanlama.tumIsleriGorme', 'serviceOps', 64
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5064 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukUrun.sahaPlanlama.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5065, 'Tüm İşleri Görme Yetkisi', TRUE, 'buyukUrun.atolye.tumIsleriGorme', 'serviceOps', 65
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5065 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukUrun.atolye.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5066, 'Tüm İşleri Görme Yetkisi', TRUE, 'buyukUrun.hazirTeslimat.tumIsleriGorme', 'serviceOps', 66
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5066 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukUrun.hazirTeslimat.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5067, 'Tüm İşleri Görme Yetkisi', TRUE, 'buyukUrun.teslimattakiler.tumIsleriGorme', 'serviceOps', 67
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5067 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukUrun.teslimattakiler.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5068, 'Tüm İşleri Görme Yetkisi', TRUE, 'atolyeAriza.atolye.tumIsleriGorme', 'serviceOps', 68
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5068 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'atolyeAriza.atolye.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5069, 'Tüm İşleri Görme Yetkisi', TRUE, 'atolyeAriza.hazirTeslimat.tumIsleriGorme', 'serviceOps', 69
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5069 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'atolyeAriza.hazirTeslimat.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5070, 'Tüm İşleri Görme Yetkisi', TRUE, 'atolyeAriza.teslimattakiler.tumIsleriGorme', 'serviceOps', 70
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5070 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'atolyeAriza.teslimattakiler.tumIsleriGorme'));

-- HAKEDİŞ. Sayfa hiç tanımlanmamıştı: ServiceOps istemcisi /hakedis rotasını 'hakedis'
-- anahtarına bağlıyor (pagePermissions.ts) ve EarningsController da aynı anahtarla kapsam
-- soruyor. Anahtar Pages'te olmayınca hiçbir role verilemiyor, dolayısıyla süper admin dışında
-- herkeste menüde görünmüyor ve açılmıyordu. ""Hakediş sayfası görünmüyor"" bunun sonucuydu.
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5071, 'Hakediş', TRUE, 'hakedis', 'serviceOps', 71
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5071 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'hakedis'));

-- Kapsam anahtarları: hangisi de verilmezse kullanıcı yalnızca kendi hakedişini görür.
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5072, 'Tüm Personelin Hakedişini Görme', TRUE, 'hakedis.tumIsleriGorme', 'serviceOps', 72
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5072 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'hakedis.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5073, 'Yalnızca Kendi Hakedişi', TRUE, 'hakedis.sadeceKendiIsleri', 'serviceOps', 73
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5073 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'hakedis.sadeceKendiIsleri'));

-- HIZLI SERVİS. Teknisyenin sahada yedek parça satıp doğrudan satış faturasına gönderdiği ekran.
-- Kimlik 5120 seçildi: 5070-5073 aralığı bu dosyada İKİ KEZ kullanılmış (hakediş ile kabul
-- sayfalarının alt anahtarları çakışıyor) ve 5074-5115 arası da doluluk gösteriyor.
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5120, 'Hızlı Servis', TRUE, 'hizliServis', 'serviceOps', 120
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5120 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'hizliServis'));

-- GÜNLÜK TAHSİLATLAR. Kimin ne sattığının günlük dökümü; yönetim ekranı olduğu için
-- teknisyen rollerine VERİLMEZ (kullanıcı kararı: yalnızca SSA/superadmin/yönetim/müdür).
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5121, 'Günlük Tahsilatlar', TRUE, 'gunlukTahsilat', 'serviceOps', 121
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5121 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'gunlukTahsilat'));

-- Sekmeye inen kapsam, kök kapsamı geçersiz kılar. Silinmiyor, pasife çekiliyor: rol izinleri
-- satırda duruyor, karar geri alınmak istenirse IsActive'i açmak yetiyor. İki yerden çelişkili
-- cevap gelmesin diye kök anahtar listelerden ve yetki sorgularından düşer.
UPDATE ""Pages"" SET ""IsActive"" = FALSE
WHERE ""ModuleKey"" = 'serviceOps'
  AND ""Key"" IN ('montajYonetimi.tumIsleriGorme', 'buyukUrun.tumIsleriGorme', 'atolyeAriza.tumIsleriGorme')
  AND ""IsActive"" = TRUE;


-- Dashboard ekranı KALDIRILDI (rota da bileşen de yok). Yetki listesinde açılamayan bir satır
-- görünmesin diye pasife çekiliyor; silinmiyor ki rollerdeki izin satırları bozulmasın.
UPDATE ""Pages"" SET ""IsActive"" = FALSE
WHERE ""ModuleKey"" = 'serviceOps' AND ""Key"" = 'dashboard' AND ""IsActive"" = TRUE;

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT 1, p.""Id"", TRUE
FROM ""Pages"" p
CROSS JOIN ""Roles"" role WHERE role.""Id"" = 1 AND p.""ModuleKey"" = 'serviceOps'
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

DELETE FROM ""RolePagePermissions"" WHERE ""PageId"" IN (SELECT ""Id"" FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='etiket');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='TenantEnabledPages') THEN
    DELETE FROM ""TenantEnabledPages"" WHERE ""PageId"" IN (SELECT ""Id"" FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='etiket');
  END IF;
END $$;
DELETE FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='etiket';

/* KAMPANYA TANIM ARTIK YALNIZCA SİSTEM AYARLARI'NDA (2026-08-13, kullanıcı isteği).
   Ekran 'users/kampanya' (Id 402) anahtarına taşındı; fatura modülündeki kopya hiçbir yerde
   kontrol edilmiyor, rol yetkileri ekranında işe yaramayan bir kutu olarak duruyordu.
   Silme sırası ZORUNLU: önce yetki satırları, sonra firma-sayfa eşlemesi, en son sayfanın
   kendisi — ters sırada yabancı anahtar kısıtı düşer. ('invoice/etiket' ile aynı kalıp.) */
DELETE FROM ""RolePagePermissions"" WHERE ""PageId"" IN (SELECT ""Id"" FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='kampanya');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='TenantEnabledPages') THEN
    DELETE FROM ""TenantEnabledPages"" WHERE ""PageId"" IN (SELECT ""Id"" FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='kampanya');
  END IF;
END $$;
DELETE FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='kampanya';

/* 'invoice/satis' (Satış Faturaları) KALDIRILDI (2026-08-20, kullanıcı isteği).
   Gerçek ekranın anahtarı 'invoice/satisFatura' (Satış Faturası, Id 2); bu çoğul kopya
   hiçbir yerde kontrol edilmiyordu — ne AuthorizePage, ne allowedKeys, ne menü/rota kapısı.
   Rol yetkileri ekranında boşta duran bir kutuydu, üstelik rollere atanmıştı: açık olması da
   kapalı olması da hiçbir şeyi değiştirmiyordu.
   Silme sırası ZORUNLU: önce yetki satırları, sonra firma-sayfa eşlemesi, en son sayfanın
   kendisi — ters sırada yabancı anahtar kısıtı düşer. ('invoice/kampanya' ile aynı kalıp.)
   Sayfa kimliği firmadan firmaya değişiyor (12 / 11), o yüzden ANAHTARLA siliniyor. */
DELETE FROM ""RolePagePermissions"" WHERE ""PageId"" IN (SELECT ""Id"" FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='satis');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='TenantEnabledPages') THEN
    DELETE FROM ""TenantEnabledPages"" WHERE ""PageId"" IN (SELECT ""Id"" FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='satis');
  END IF;
END $$;
DELETE FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='satis';

/* RAPOR ADLARI ONARIMI (2026-08-13).

   Bazı firmalarda `Pages.DisplayName` kaymış: DEMOTEST'te 'satisPazarlamaRaporu' satırının
   adı 'Stok Giriş/Çıkış Raporu' yazıyordu, b2b_erp ve DEMO'da aynı yanlış ad
   'aktifSepetRaporu'ndaydı. Sonuç: rol yetkileri ekranında AYNI başlıklı iki kart çıkıyor ve
   kullanıcı aradığı sayfanın (Satış Pazarlama Raporu) yetkide olmadığını sanıyor — sayfa
   listede, yalnızca adı yanlış.

   Ad, anahtarın kendisinden türetilmiyor; doğru değerler `PageConfiguration`'daki seed'den
   alındı. Yalnızca YANLIŞ olan satır güncelleniyor, dolayısıyla tekrar çalıştırılabilir ve
   kasıtlı yeniden adlandırmalara dokunmaz (bu iki anahtar dışında hiçbir satıra bakmıyor). */
UPDATE ""Pages"" SET ""DisplayName"" = 'Satış Pazarlama Raporu'
WHERE ""ModuleKey"" = 'reports' AND ""Key"" = 'satisPazarlamaRaporu' AND ""DisplayName"" <> 'Satış Pazarlama Raporu';

UPDATE ""Pages"" SET ""DisplayName"" = 'Aktif Sepet Raporu'
WHERE ""ModuleKey"" = 'reports' AND ""Key"" = 'aktifSepetRaporu' AND ""DisplayName"" <> 'Aktif Sepet Raporu';

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 160, 'Etiket Basım (Fiyatlı)', TRUE, 'etiketFiyatli', 'invoice', 6
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 160 OR (""ModuleKey"" = 'invoice' AND ""Key"" = 'etiketFiyatli'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 161, 'Etiket Basım (Fiyatsız)', TRUE, 'etiketFiyatsiz', 'invoice', 7
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 161 OR (""ModuleKey"" = 'invoice' AND ""Key"" = 'etiketFiyatsiz'));

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.""Id"", p.""Id"", TRUE
FROM ""Pages"" p
CROSS JOIN ""Roles"" r
WHERE p.""Key"" IN ('etiketFiyatli', 'etiketFiyatsiz')
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

-- Kabul ve takip ekranlarında memnuniyet ve fiş oluşturma alt yetkileri
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5070, 'Büyük Ev Kabul - Memnuniyet Sütunu', TRUE, 'buyukEvAletleriKabul.memnuniyet', 'serviceOps', 70
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5070 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukEvAletleriKabul.memnuniyet'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5071, 'Büyük Ev Kabul - Fiş Oluşturma Yetkisi', TRUE, 'buyukEvAletleriKabul.fisOlustur', 'serviceOps', 71
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5071 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'buyukEvAletleriKabul.fisOlustur'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5072, 'Küçük Ev Kabul - Memnuniyet Sütunu', TRUE, 'kucukUrunKabul.memnuniyet', 'serviceOps', 72
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5072 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'kucukUrunKabul.memnuniyet'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5073, 'Küçük Ev Kabul - Fiş Oluşturma Yetkisi', TRUE, 'kucukUrunKabul.fisOlustur', 'serviceOps', 73
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5073 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'kucukUrunKabul.fisOlustur'));

-- SuperAdmin, Admin, Yonetim, Mudur, ServisMudur, ServisPersonel rollerine izinleri ver (Bayi ve AltBayi hariç)
--
-- ROL KİMLİKLERİ FİRMADAN FİRMAYA DEĞİŞİR: her firmanın kendi veritabanı, kendi ""Roles""
-- tablosu var ve aynı rol her yerde aynı kimliği taşımıyor. Buradaki listede olup o firmada
-- bulunmayan bir kimlik (ör. DEMOTEST'te 6 = Admin YOK) yabancı anahtar hatası veriyordu;
-- hata bu toplu SQL'in tamamını düşürdüğü için /api/pages/enabled-keys 500 dönüyor, ön yüz de
-- boş listeyi ""hiçbir sayfa açık değil"" diye yorumlayıp SSA dışındaki HERKESE boş menü
-- gösteriyordu. Aynı dosyadaki diğer eklemeler gibi burada da ""Roles"" ile eşleşme aranıyor.
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.r, p.""Id"", TRUE
FROM unnest(ARRAY[1,2,3,4,5,6,7,10,11]) AS r(r)
JOIN ""Roles"" role ON role.""Id"" = r.r
CROSS JOIN ""Pages"" p
WHERE p.""Key"" IN ('buyukEvAletleriKabul.memnuniyet', 'buyukEvAletleriKabul.fisOlustur', 'kucukUrunKabul.memnuniyet', 'kucukUrunKabul.fisOlustur')
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

-- Bayi ve AltBayi (RoleId = 8, 9) için bu yetkilerin kapalı olduğundan emin ol
DELETE FROM ""RolePagePermissions""
WHERE ""RoleId"" IN (8, 9)
  AND ""PageId"" IN (SELECT ""Id"" FROM ""Pages"" WHERE ""Key"" IN ('buyukEvAletleriKabul.memnuniyet', 'buyukEvAletleriKabul.fisOlustur', 'kucukUrunKabul.memnuniyet', 'kucukUrunKabul.fisOlustur'));

/* E-TİCARET
 *
 * Bu sayfalar KAYITLI DEĞİLDİ ve sonucu şuydu: menü yalnızca süper admin'e görünüyor, başka
 * hiçbir role VERİLEMİYORDU — yetki ekranında seçilecek bir satır yoktu. Mağazayı yöneten
 * kişinin süper admin olmak zorunda kalması, mağaza için ERP'nin tamamını açmak demekti.
 *
 * Kimlik aralığı 5200+: serviceOps 4999-5073'ü kullanıyor, çakışmasın.
 *
 * Varsayılan olarak yalnızca SuperAdmin (1) ve Yönetim (2) rollerine açılıyor. Bayi (8) ve
 * AltBayi (9) bilerek DIŞARIDA: mağaza mutabakatı ve üye listesi bayinin işi değil.
 */
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5200, 'Vitrin Yönetimi', TRUE, 'vitrin', 'eticaret', 1
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5200 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'vitrin'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5201, 'Görseller', TRUE, 'gorseller', 'eticaret', 2
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5201 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'gorseller'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5202, 'Ürün Yayını', TRUE, 'urunYayin', 'eticaret', 3
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5202 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'urunYayin'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5203, 'E-Ticaret Siparişleri', TRUE, 'siparisler', 'eticaret', 4
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5203 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'siparisler'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5204, 'Mağaza Üyeleri', TRUE, 'uyeler', 'eticaret', 5
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5204 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'uyeler'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5205, 'Mutabakat (POS / Sipariş / Fatura)', TRUE, 'mutabakat', 'eticaret', 6
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5205 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'mutabakat'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5206, 'İçerik Sayfaları', TRUE, 'sayfalar', 'eticaret', 4
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5206 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'sayfalar'));

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.r, p.p, TRUE
FROM unnest(ARRAY[1,2]) AS r(r)
CROSS JOIN unnest(ARRAY[5200,5201,5202,5203,5204,5205,5206]) AS p(p)
JOIN ""Roles"" role ON role.""Id"" = r.r
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

-- E-TICARET SAYFALARI (2026-09-21): tek 'Vitrin Yonetimi' formu ayri sayfalara dagitildi.
-- Kim 'vitrin'(5200) sayfasini gorebiliyorsa yeni sayfalari da gorur (kimse erisim kaybetmesin);
-- kampanyalar/arama sekmeleri Pages'te HIC yoktu (yalniz SSA goruyordu) — artik rol yetkisinde.
UPDATE ""Pages"" SET ""DisplayName"" = 'Anasayfa & Vitrin', ""SortOrder"" = 10 WHERE ""ModuleKey"" = 'eticaret' AND ""Key"" = 'vitrin' AND ""DisplayName"" = 'Vitrin Yönetimi';
UPDATE ""Pages"" SET ""DisplayName"" = 'Ürün Yönetimi' WHERE ""ModuleKey"" = 'eticaret' AND ""Key"" = 'urunYayin' AND ""DisplayName"" = 'Ürün Yayını';

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5207, 'Vitrin Kategorileri', TRUE, 'kategoriler', 'eticaret', 9
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5207 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'kategoriler'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5208, 'Firma & İletişim', TRUE, 'firmaBilgileri', 'eticaret', 11
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5208 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'firmaBilgileri'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5209, 'Ödeme & Havale', TRUE, 'odeme', 'eticaret', 12
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5209 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'odeme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5210, 'Pazarlama & Güven', TRUE, 'pazarlama', 'eticaret', 13
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5210 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'pazarlama'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5211, 'E-Ticaret Kampanyaları', TRUE, 'kampanyalar', 'eticaret', 4
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5211 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'kampanyalar'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5212, 'Talep Raporu', TRUE, 'arama', 'eticaret', 5
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5212 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'arama'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5213, 'Ziyaret Analizi', TRUE, 'analitik', 'eticaret', 6
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5213 OR (""ModuleKey"" = 'eticaret' AND ""Key"" = 'analitik'));

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT rp.""RoleId"", p.""Id"", TRUE
FROM ""RolePagePermissions"" rp
JOIN ""Pages"" v ON v.""Id"" = rp.""PageId"" AND v.""ModuleKey"" = 'eticaret' AND v.""Key"" = 'vitrin'
CROSS JOIN ""Pages"" p
WHERE rp.""CanAccess"" = TRUE AND p.""Id"" IN (5207,5208,5209,5210,5211,5212)
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.""Id"", p.""Id"", TRUE
FROM ""Roles"" r CROSS JOIN ""Pages"" p
WHERE r.""IsSuperAdmin"" = TRUE AND p.""Id"" IN (5207,5208,5209,5210,5211,5212)
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

-- Montaj Gecmisi Page
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5080, 'Montaj Geçmişi', TRUE, 'montajGecmisi', 'serviceOps', 7
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5080 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'montajGecmisi'));

-- Grant Montaj Gecmisi permission (PageId = 5080) to everyone who has Montaj Kabul permission (PageId = 5000)
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT ""RoleId"", 5080, TRUE
FROM ""RolePagePermissions""
WHERE ""PageId"" = 5000 AND ""CanAccess"" = TRUE
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

-- Grant Montaj Gecmisi permission (PageId = 5080) to Mudur role explicitly
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.""Id"", 5080, TRUE
FROM ""Roles"" r
WHERE r.""Code"" = 'Mudur'
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

/* RAPOR ALT YETKILERI
   Kok anahtar 'raporlar' (5017) zaten var. Her rapor sayfasi kendi anahtariyla aciliyor:
   birine bayi performansini acmak, teknisyen performansini da acmak anlamina gelmesin.
   Id araligi 5090+ -- 5071..5073 iki ayri blokta farkli anahtarlarla kullanilmis durumda. */

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5090, 'Rapor - Montaj', TRUE, 'raporlar.montaj', 'serviceOps', 90
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5090 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'raporlar.montaj'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5091, 'Rapor - Büyük Ürün Arıza', TRUE, 'raporlar.buyukUrun', 'serviceOps', 91
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5091 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'raporlar.buyukUrun'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5092, 'Rapor - Küçük Ürün Arıza', TRUE, 'raporlar.kucukUrun', 'serviceOps', 92
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5092 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'raporlar.kucukUrun'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5093, 'Rapor - Kargo', TRUE, 'raporlar.kargo', 'serviceOps', 93
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5093 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'raporlar.kargo'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5094, 'Rapor - Bayi Performansı', TRUE, 'raporlar.bayi', 'serviceOps', 94
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5094 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'raporlar.bayi'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5095, 'Rapor - Teknisyen Performansı', TRUE, 'raporlar.teknisyen', 'serviceOps', 95
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5095 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'raporlar.teknisyen'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5096, 'Rapor - Ürün Analizleri', TRUE, 'raporlar.urun', 'serviceOps', 96
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5096 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'raporlar.urun'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5097, 'Rapor - Süre Analizleri', TRUE, 'raporlar.sureler', 'serviceOps', 97
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5097 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'raporlar.sureler'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5098, 'Rapor - İptal Analizi', TRUE, 'raporlar.iptal', 'serviceOps', 98
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5098 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'raporlar.iptal'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5099, 'Rapor - Yedek Parça', TRUE, 'raporlar.yedekParca', 'serviceOps', 99
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5099 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'raporlar.yedekParca'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5100, 'Rapor - Trend ve Karşılaştırma', TRUE, 'raporlar.trend', 'serviceOps', 100
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5100 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'raporlar.trend'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5101, 'Rapor - Dışa Aktarma', TRUE, 'raporlar.disaAktar', 'serviceOps', 101
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5101 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'raporlar.disaAktar'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5102, 'Rapor - Tüm Kayıtları Görme', TRUE, 'raporlar.tumIsleriGorme', 'serviceOps', 102
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5102 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'raporlar.tumIsleriGorme'));

/* Raporlar (5017) zaten acik olan rollere alt raporlar da acilir. Aksi halde surum sonrasi
   herkesin rapor ekrani bosalirdi: kok anahtar duruyor ama her sekme kendi anahtarini ister. */
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT rpp.""RoleId"", p.""Id"", TRUE
FROM ""RolePagePermissions"" rpp
CROSS JOIN ""Pages"" p
WHERE rpp.""PageId"" = 5017 AND rpp.""CanAccess"" = TRUE
  AND p.""ModuleKey"" = 'serviceOps'
  AND p.""Key"" LIKE 'raporlar.%'
  AND p.""Key"" <> 'raporlar.tumIsleriGorme'
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

" + ServiceOpsPermissionSeed.Sql + @"
", cancellationToken);

        var tenantId = await ResolveTenantIdAsync(cancellationToken);
        if (tenantId != null)
        {
            var localPageIds = await _dbContext.Pages
                .AsNoTracking()
                .Select(x => x.Id)
                .ToListAsync(cancellationToken);

            var existingEnabled = await _masterDb.TenantEnabledPages
                .Where(x => x.TenantId == tenantId.Value && localPageIds.Contains(x.PageId))
                .Select(x => x.PageId)
                .ToListAsync(cancellationToken);

            var missing = localPageIds.Except(existingEnabled).ToList();
            if (missing.Any())
            {
                foreach (var pid in missing)
                {
                    _masterDb.TenantEnabledPages.Add(new B2B.Erp.Api.Entities.TenantEnabledPage
                    {
                        TenantId = tenantId.Value,
                        PageId = pid,
                        IsEnabled = true
                    });
                }
                await _masterDb.SaveChangesAsync(cancellationToken);
            }
        }
    }
}




