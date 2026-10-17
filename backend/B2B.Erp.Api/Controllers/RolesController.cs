using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Roles;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class RolesController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly MasterDbContext _masterDb;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public RolesController(AppDbContext dbContext, MasterDbContext masterDb, IHttpContextAccessor httpContextAccessor)
    {
        _dbContext = dbContext;
        _masterDb = masterDb;
        _httpContextAccessor = httpContextAccessor;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(CancellationToken cancellationToken)
    {
        var roles = await _dbContext.Roles
            .AsNoTracking()
            .OrderBy(r => r.Id)
            .ToListAsync(cancellationToken);

        var data = roles.Select(r => new RoleResponse
        {
            Id = r.Id,
            Code = r.Code,
            Name = r.Name,
            DisplayName = r.DisplayName,
            IsActive = r.IsActive,
            IsSuperAdmin = r.IsSuperAdmin,
            CampaignsEnabled = r.CampaignsEnabled,
            OverLimitApprovalEnabled = r.OverLimitApprovalEnabled
        }).ToList();

        return Ok(new
        {
            success = true,
            data
        });
    }

    [HttpGet("{id:int}/permissions")]
    public async Task<IActionResult> GetRolePermissions(int id, CancellationToken cancellationToken)
    {
        await EnsureGenelAyarlarPageExistsAsync(cancellationToken);
        var role = await _dbContext.Roles
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);

        if (role is null)
        {
            return NotFound(new { success = false, message = "Rol bulunamadı" });
        }

        var tenantId = await ResolveTenantIdAsync(cancellationToken);
        if (tenantId is null)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var visibility = await Data.Services.TenantPageVisibility.ResolveAsync(_masterDb, _dbContext, tenantId.Value, cancellationToken);
        var hasAnyConfig = visibility.HasAnyConfig;
        var enabledPageIds = visibility.EnabledPageIds;

        if (hasAnyConfig && enabledPageIds.Count == 0)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var pages = await _dbContext.Pages
            .AsNoTracking()
            .Where(p => (!hasAnyConfig || enabledPageIds.Contains(p.Id)) && p.IsActive)
            .OrderBy(p => p.ModuleKey)
            .ThenBy(p => p.SortOrder)
            .ToListAsync(cancellationToken);

        var existingPermissions = await _dbContext.RolePagePermissions
            .AsNoTracking()
            .Where(rp => rp.RoleId == id)
            .ToListAsync(cancellationToken);

        var permissionMap = existingPermissions
            .GroupBy(x => x.PageId)
            .ToDictionary(g => g.Key, g => g.First().CanAccess);

        var data = pages.Select(p => new RolePagePermissionResponse
        {
            PageId = p.Id,
            ModuleKey = p.ModuleKey,
            PageKey = p.Key,
            DisplayName = p.DisplayName,
            CanAccess = permissionMap.TryGetValue(p.Id, out var canAccess) && canAccess
        }).ToList();

        return Ok(new { success = true, data });
    }

    [HttpPut("{id:int}/permissions")]
    public async Task<IActionResult> UpdateRolePermissions(int id, [FromBody] UpdateRolePermissionsRequest request, CancellationToken cancellationToken)
    {
        await EnsureGenelAyarlarPageExistsAsync(cancellationToken);
        if (!GetRequesterIsSuperAdmin())
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Yetkiniz yok" });
        }

        var tenantId = await ResolveTenantIdAsync(cancellationToken);
        if (tenantId is null)
        {
            return BadRequest(new { success = false, message = "Firma seçimi zorunlu" });
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var role = await _dbContext.Roles
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);

        if (role is null)
        {
            return NotFound(new { success = false, message = "Rol bulunamadı" });
        }

        var requestPageIds = request.Permissions.Select(x => x.PageId).Distinct().ToList();
        var pagesExist = await _dbContext.Pages
            .AsNoTracking()
            .CountAsync(p => requestPageIds.Contains(p.Id), cancellationToken);

        if (pagesExist != requestPageIds.Count)
        {
            return BadRequest(new { success = false, message = "Geçersiz sayfa seçimi" });
        }

        // Listesi olan firmada yalnız firmaya açık sayfaya yetki verilebilir; listesi olmayan
        // firmada her sayfa açıktır (GET ile aynı kural — TenantPageVisibility).
        var visibility = await Data.Services.TenantPageVisibility.ResolveAsync(_masterDb, _dbContext, tenantId.Value, cancellationToken);

        var invalidGrant = request.Permissions
            .Where(x => x.CanAccess)
            .Select(x => x.PageId)
            .Distinct()
            .FirstOrDefault(pid => !visibility.IsVisible(pid));

        if (invalidGrant != 0)
        {
            return BadRequest(new { success = false, message = "Bu sayfa projede aktif değil" });
        }

        var existing = await _dbContext.RolePagePermissions
            .Where(rp => rp.RoleId == id)
            .ToListAsync(cancellationToken);

        var incoming = request.Permissions
            .GroupBy(x => x.PageId)
            .ToDictionary(g => g.Key, g => g.First().CanAccess);

        foreach (var rp in existing)
        {
            rp.CanAccess = incoming.TryGetValue(rp.PageId, out var canAccess) && canAccess;
        }

        var existingPageIds = existing.Select(x => x.PageId).ToHashSet();
        foreach (var (pageId, canAccess) in incoming)
        {
            if (existingPageIds.Contains(pageId)) continue;
            _dbContext.RolePagePermissions.Add(new RolePagePermission
            {
                RoleId = id,
                PageId = pageId,
                CanAccess = canAccess
            });
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, message = "Yetkiler güncellendi" });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateRoleRequest request, CancellationToken cancellationToken)
    {
        if (!GetRequesterIsSuperAdmin())
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Yetkiniz yok" });
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var code = request.Code.Trim();
        var name = request.Name.Trim();
        var displayName = request.DisplayName.Trim();

        if (code.Length == 0) ModelState.AddModelError(nameof(request.Code), "Code is required.");
        if (name.Length == 0) ModelState.AddModelError(nameof(request.Name), "Name is required.");
        if (displayName.Length == 0) ModelState.AddModelError(nameof(request.DisplayName), "DisplayName is required.");

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var codeExists = await _dbContext.Roles
            .AsNoTracking()
            .AnyAsync(r => r.Code == code, cancellationToken);

        if (codeExists)
        {
            ModelState.AddModelError(nameof(request.Code), "Code must be unique.");
            return ValidationProblem(ModelState);
        }

        var nameExists = await _dbContext.Roles
            .AsNoTracking()
            .AnyAsync(r => r.Name == name, cancellationToken);

        if (nameExists)
        {
            ModelState.AddModelError(nameof(request.Name), "Name must be unique.");
            return ValidationProblem(ModelState);
        }

        var role = new Role
        {
            Code = code,
            Name = name,
            DisplayName = displayName,
            Description = request.Description?.Trim() ?? string.Empty,
            IsActive = request.IsActive,
            IsSuperAdmin = false,
            CreatedAt = DateTime.UtcNow
        };

        _dbContext.Roles.Add(role);
        await _dbContext.SaveChangesAsync(cancellationToken);


        return Ok(new
        {
            success = true,
            message = "Rol oluşturuldu",
            data = new RoleResponse
            {
                Id = role.Id,
                Code = role.Code,
                Name = role.Name,
                DisplayName = role.DisplayName,
                IsActive = role.IsActive,
                IsSuperAdmin = role.IsSuperAdmin,
                CampaignsEnabled = role.CampaignsEnabled
            }
        });
    }

    public sealed class UpdateRoleCampaignsRequest
    {
        public bool CampaignsEnabled { get; set; }
    }

    /// <summary>
    /// Rolün kampanya anahtarını açar/kapatır.
    ///
    /// Sayfa yetkilerinden AYRI bir uç: kampanya bir sayfa değil, bir ticari kural.
    /// <c>RolePagePermissions</c>'a sahte bir "sayfa" satırı olarak eklenseydi, sayfa listesinde
    /// görünüp menüye çıkmaya çalışırdı.
    ///
    /// Süper Admin rolü hariç tutulur: onun kampanyası kapatılabilseydi yönetici kendi kendini
    /// kilitleyip test edemez hale gelirdi.
    /// </summary>
    [HttpPatch("{id:int}/campaigns")]
    public async Task<IActionResult> UpdateCampaigns(int id, [FromBody] UpdateRoleCampaignsRequest request, CancellationToken cancellationToken)
    {
        if (!GetRequesterIsSuperAdmin())
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Yetkiniz yok" });
        }

        if (request is null)
        {
            return BadRequest(new { success = false, message = "Geçersiz istek" });
        }

        var role = await _dbContext.Roles.FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (role is null)
        {
            return NotFound(new { success = false, message = "Rol bulunamadı" });
        }

        if (role.IsSuperAdmin)
        {
            return BadRequest(new { success = false, message = "Süper Admin rolünün kampanya ayarı değiştirilemez" });
        }

        role.CampaignsEnabled = request.CampaignsEnabled;
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            message = request.CampaignsEnabled ? "Kampanyalar bu role açıldı" : "Kampanyalar bu role kapatıldı",
            data = new { id = role.Id, campaignsEnabled = role.CampaignsEnabled }
        });
    }

    public sealed class UpdateRoleOverLimitApprovalRequest
    {
        public bool OverLimitApprovalEnabled { get; set; }
    }

    /// <summary>
    /// Rolün "limit aşımıyla sipariş onayı" yetkisini açar/kapatır (2026-10-14).
    /// Kampanya anahtarı gibi sayfa yetkisi değil, bir işlem yetkisi; kendi ucuna anında yazılır.
    /// Süper Admin rolü zaten her zaman yetkili olduğu için değiştirilmez.
    /// </summary>
    [HttpPatch("{id:int}/over-limit-approval")]
    public async Task<IActionResult> UpdateOverLimitApproval(int id, [FromBody] UpdateRoleOverLimitApprovalRequest request, CancellationToken cancellationToken)
    {
        if (!GetRequesterIsSuperAdmin())
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Yetkiniz yok" });
        }

        if (request is null)
        {
            return BadRequest(new { success = false, message = "Geçersiz istek" });
        }

        var role = await _dbContext.Roles.FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
        if (role is null)
        {
            return NotFound(new { success = false, message = "Rol bulunamadı" });
        }

        if (role.IsSuperAdmin)
        {
            return BadRequest(new { success = false, message = "Süper Admin rolü her zaman yetkilidir" });
        }

        role.OverLimitApprovalEnabled = request.OverLimitApprovalEnabled;
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            message = request.OverLimitApprovalEnabled
                ? "Bu rol limit aşımıyla sipariş onaylayabilir"
                : "Bu rolün limit aşımı onay yetkisi kapatıldı",
            data = new { id = role.Id, overLimitApprovalEnabled = role.OverLimitApprovalEnabled }
        });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateRoleRequest request, CancellationToken cancellationToken)
    {
        if (!GetRequesterIsSuperAdmin())
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Yetkiniz yok" });
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var role = await _dbContext.Roles
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);

        if (role is null)
        {
            return NotFound(new { success = false, message = "Rol bulunamadı" });
        }

        if (role.IsSuperAdmin)
        {
            return BadRequest(new { success = false, message = "Süper Admin rolü değiştirilemez" });
        }

        var code = request.Code.Trim();
        var name = request.Name.Trim();
        var displayName = request.DisplayName.Trim();

        if (code.Length == 0) ModelState.AddModelError(nameof(request.Code), "Code is required.");
        if (name.Length == 0) ModelState.AddModelError(nameof(request.Name), "Name is required.");
        if (displayName.Length == 0) ModelState.AddModelError(nameof(request.DisplayName), "DisplayName is required.");

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var codeExists = await _dbContext.Roles
            .AsNoTracking()
            .AnyAsync(r => r.Id != id && r.Code == code, cancellationToken);

        if (codeExists)
        {
            ModelState.AddModelError(nameof(request.Code), "Code must be unique.");
            return ValidationProblem(ModelState);
        }

        var nameExists = await _dbContext.Roles
            .AsNoTracking()
            .AnyAsync(r => r.Id != id && r.Name == name, cancellationToken);

        if (nameExists)
        {
            ModelState.AddModelError(nameof(request.Name), "Name must be unique.");
            return ValidationProblem(ModelState);
        }

        role.Code = code;
        role.Name = name;
        role.DisplayName = displayName;
        role.Description = request.Description?.Trim() ?? string.Empty;
        role.IsActive = request.IsActive;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, message = "Rol güncellendi" });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        if (!GetRequesterIsSuperAdmin())
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Yetkiniz yok" });
        }

        var role = await _dbContext.Roles
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);

        if (role is null)
        {
            return NotFound(new { success = false, message = "Rol bulunamadı" });
        }

        if (role.IsSuperAdmin)
        {
            return BadRequest(new { success = false, message = "Süper Admin rolü silinemez" });
        }

        var hasUsers = await _dbContext.Users
            .AsNoTracking()
            .AnyAsync(u => u.RoleId == id, cancellationToken);

        if (hasUsers)
        {
            return BadRequest(new { success = false, message = "Bu role tanımlı kullanıcılar bulunduğu için silinemez. Önce kullanıcıların rolünü değiştirin." });
        }

        var permissions = await _dbContext.RolePagePermissions
            .Where(rp => rp.RoleId == id)
            .ToListAsync(cancellationToken);

        if (permissions.Count > 0)
        {
            _dbContext.RolePagePermissions.RemoveRange(permissions);
        }

        _dbContext.Roles.Remove(role);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, message = "Rol başarıyla silindi" });
    }

    private bool GetRequesterIsSuperAdmin()
    {
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        return isSuperAdmin || isSsa;
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
                return await _masterDb.Tenants
                    .AsNoTracking()
                    .Where(x => x.Code == code)
                    .Select(x => (int?)x.Id)
                    .FirstOrDefaultAsync(cancellationToken);
            }
        }

        return null;
    }

    /// <summary>
    /// Eksik sayfa/izin satırlarını tamamlayan, tekrar çalıştırılabilir tohumlama.
    ///
    /// Hatası yutuluyor ve log'a yazılıyor — bkz. <c>PagesController</c>'daki ikizi: oradaki
    /// aynı tohumlama, firmada bulunmayan bir rol kimliğine yazmaya çalıştığı için patlamış ve
    /// rol izinleri ucunu düşürerek SSA dışındaki herkesin menüsünü boşaltmıştı. Bu uç da rol
    /// izinlerini besliyor, yani aynı hasarı verebilecek konumda.
    /// </summary>
    private async Task EnsureGenelAyarlarPageExistsAsync(CancellationToken cancellationToken)
    {
        try
        {
            await EnsureGenelAyarlarPageExistsCoreAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Roles] Sayfa/izin tohumlaması başarısız (izinler mevcut haliyle döner): {ex.Message}");
        }
    }

    private async Task EnsureGenelAyarlarPageExistsCoreAsync(CancellationToken cancellationToken)
    {
        // ÖNCE ONARIM, SONRA TOHUMLAMA.
        //
        // Aşağıdaki INSERT'lerin korumaları kimliğe bakıyor (WHERE NOT EXISTS ... "Id"=403).
        // Tekil indeks yoksa bu koruma yetmez ve aynı sayfa ikinci kez eklenir. Onarım, çiftleri
        // birleştirip indeksi kurduğu için buradan sonraki her INSERT güvende olur.
        // Ayrıntılı gerekçe: PagePermissionRepair.
        await PagePermissionRepair.MergeDuplicatePagesAsync(_dbContext, cancellationToken);

        await _dbContext.Database.ExecuteSqlRawAsync(@"
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 115, 'Satış Tipi', TRUE, 'faturaDokumTipSatis', 'invoice', 115
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='faturaDokumTipSatis');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 116, 'Tamir Tipi', TRUE, 'faturaDokumTipTamir', 'invoice', 116
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='faturaDokumTipTamir');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 117, 'İade Tipi', TRUE, 'faturaDokumTipIade', 'invoice', 117
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='faturaDokumTipIade');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 118, 'Alış Tipi', TRUE, 'faturaDokumTipAlis', 'invoice', 118
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='faturaDokumTipAlis');

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 119, 'Hizmet Tipi', TRUE, 'faturaDokumTipHizmet', 'invoice', 119
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='invoice' AND ""Key""='faturaDokumTipHizmet');

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT r.""Id"", p.""Id"", TRUE
FROM ""Roles"" r
CROSS JOIN ""Pages"" p
WHERE r.""Code"" IN ('SuperAdmin', 'Yonetim')
  AND p.""ModuleKey""='invoice'
  AND p.""Key"" IN ('faturaDokumTipSatis', 'faturaDokumTipTamir', 'faturaDokumTipIade', 'faturaDokumTipAlis', 'faturaDokumTipHizmet')
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT rpp.""RoleId"", p.""Id"", TRUE
FROM ""RolePagePermissions"" rpp
JOIN ""Pages"" parent ON parent.""Id"" = rpp.""PageId"" AND parent.""ModuleKey""='invoice' AND parent.""Key""='faturaDokum'
JOIN ""Roles"" r ON r.""Id"" = rpp.""RoleId""
CROSS JOIN ""Pages"" p
WHERE rpp.""CanAccess"" = TRUE
  AND r.""Code"" NOT IN ('SuperAdmin', 'Yonetim')
  AND p.""ModuleKey""='invoice'
  AND p.""Key"" IN ('faturaDokumTipSatis', 'faturaDokumTipTamir', 'faturaDokumTipIade', 'faturaDokumTipHizmet')
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;
");

        await _dbContext.Database.ExecuteSqlRawAsync(@"
INSERT INTO ""Pages"" (""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 'Genel Ayarlar', TRUE, 'genelAyarlar', 'users', 14
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='users' AND ""Key""='genelAyarlar');

INSERT INTO ""Pages"" (""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 'Taksit Oranları', TRUE, 'taksitOranlari', 'pos', 3
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""ModuleKey""='pos' AND ""Key""='taksitOranlari');
 
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 400, 'Çalışan', TRUE, 'calisan', 'employee', 16
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id""=400);

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 402, 'Kampanya Tanım', TRUE, 'kampanya', 'users', 19
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE (""ModuleKey""='users' AND ""Key""='kampanya') OR ""Id""=402);

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
--
-- Aşağıdaki üç blok BİRLİKTE çalışır ve SIRASI ÖNEMLİDİR. İlk ikisi, sayfa hâlâ 'users'
-- modülündeyken (yani bu düzeltme o veritabanında henüz koşmamışken) çalışır; üçüncüsü
-- modülü taşıyarak koşulu kalıcı olarak yanlışa çevirir. Böylece ayrı bir uygulandi-damgasi
-- tablosuna gerek kalmadan blok her tenant'ta TAM BİR KEZ çalışır.
--
-- Tek seferlik olması ŞART: her açılışta zorlansaydı, Rol Yetkileri ekranından yapılan
-- her değişiklik bir sonraki yeniden başlatmada sessizce geri alınırdı. Amaç yetkiyi
-- koda gömmek değil, veritabanındaki başlangıç durumunu bir kez doğru kurmak.

-- 1) Bildirim ALMA: her role açık. Rol listesi sabit dizi değil, tenant'ın KENDİ rolleri —
--    firmaya özel roller de kapsansın diye (hardcode edilmiş 1..12 listesi onları atlıyordu).
INSERT INTO ""RolePagePermissions"" (""RoleId"", ""PageId"", ""CanAccess"")
SELECT role.""Id"", 403, TRUE
FROM ""Roles"" role
WHERE EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='bildirimlerGelen' AND ""ModuleKey""='users')
ON CONFLICT (""RoleId"", ""PageId"") DO NOTHING;

UPDATE ""RolePagePermissions"" SET ""CanAccess"" = TRUE
WHERE ""PageId"" = 403
  AND EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='bildirimlerGelen' AND ""ModuleKey""='users');

-- 2) Bildirim GÖNDERME: şimdilik kapalı. SSA'nın gönderme hakkı bu tablodan değil,
--    koddaki süper admin kontrolünden geliyor.
UPDATE ""RolePagePermissions"" SET ""CanAccess"" = FALSE
WHERE ""PageId"" = 404
  AND EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Key""='bildirimlerGonder' AND ""ModuleKey""='users');

-- 3) Modülü taşı: Bildirimler artık Ayarlar'ın altı değil, kendi başlığı. Bu aynı zamanda
--    yukarıdaki iki bloğun bir daha çalışmamasını sağlayan anahtardır.
--    Sayfa KİMLİKLERİ korunuyor; yalnızca ModuleKey değişiyor.
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

-- Tahsilat (2026-08-12). Bu blogun IKINCI KOPYASI PagesController'da; ikisi 5060'tan sonra
-- ayrismis durumda, yeni anahtar IKISINE BIRDEN yazilmali.
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

-- HAKEDİŞ. Sayfa hiç tanımlanmamıştı; ServiceOps /hakedis rotası ve EarningsController bu
-- anahtarı soruyor, Pages'te olmadığı için hiçbir role verilemiyor ve sayfa süper admin dışında
-- kimsede açılmıyordu. (Bu blok PagesController'daki eşiyle birlikte güncellenmeli — iki kopya
-- var ve zaten 5060'tan sonra ayrışmış durumdalar.)
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5071, 'Hakediş', TRUE, 'hakedis', 'serviceOps', 71
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5071 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'hakedis'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5072, 'Tüm Personelin Hakedişini Görme', TRUE, 'hakedis.tumIsleriGorme', 'serviceOps', 72
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5072 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'hakedis.tumIsleriGorme'));

INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5073, 'Yalnızca Kendi Hakedişi', TRUE, 'hakedis.sadeceKendiIsleri', 'serviceOps', 73
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5073 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'hakedis.sadeceKendiIsleri'));

-- HIZLI SERVİS. Bu seed'in İKİ KOPYASI var (PagesController + RolesController) ve yeni anahtar
-- ikisine birden yazılmalı, yoksa hangi controller önce çalışırsa ona göre anahtar bazen oluşup
-- bazen oluşmuyor.
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5120, 'Hızlı Servis', TRUE, 'hizliServis', 'serviceOps', 120
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5120 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'hizliServis'));

-- GÜNLÜK TAHSİLATLAR (bu seed'in ikinci kopyası — yeni anahtar ikisine de yazılmalı).
INSERT INTO ""Pages"" (""Id"", ""DisplayName"", ""IsActive"", ""Key"", ""ModuleKey"", ""SortOrder"")
SELECT 5121, 'Günlük Tahsilatlar', TRUE, 'gunlukTahsilat', 'serviceOps', 121
WHERE NOT EXISTS (SELECT 1 FROM ""Pages"" WHERE ""Id"" = 5121 OR (""ModuleKey"" = 'serviceOps' AND ""Key"" = 'gunlukTahsilat'));


-- Dashboard ekranı KALDIRILDI (rota da bileşen de yok). Yetki listesinde açılamayan bir satır
-- görünmesin diye pasife çekiliyor; silinmiyor ki rollerdeki izin satırları bozulmasın.
UPDATE ""Pages"" SET ""IsActive"" = FALSE
WHERE ""ModuleKey"" = 'serviceOps' AND ""Key"" = 'dashboard' AND ""IsActive"" = TRUE;

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

/* RAPOR ALT YETKILERI -- PagesController'daki blogun aynisi.
   Iki yerde durmasinin sebebi mevcut desen: hangi ekran once acilirsa seed orada calisiyor. */

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

/* Kok anahtari (5017) olan rollere alt raporlar acilir; 'tumIsleriGorme' HARIC -- o, kac kaydin
   gorunecegini belirleyen kapsam anahtari, otomatik verilmesi erisimi genisletirdi. */
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





