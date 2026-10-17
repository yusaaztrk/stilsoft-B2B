using B2B.Erp.Api.Data;
using B2B.Erp.Api.Core.Http;
using B2B.Erp.Api.Core.Security;
using B2B.Erp.Api.DTOs.GlobalUsers;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class GlobalUsersController : ControllerBase
{
    private readonly MasterDbContext _masterDb;
    private readonly IConfiguration _configuration;
    private readonly Core.Sessions.ISharedSessionStore _sharedSessions;
    private readonly ILogger<GlobalUsersController> _logger;

    private sealed record TenantRef(string Code, string Name);

    public GlobalUsersController(
        MasterDbContext masterDb,
        IConfiguration configuration,
        Core.Sessions.ISharedSessionStore sharedSessions,
        ILogger<GlobalUsersController> logger)
    {
        _masterDb = masterDb;
        _configuration = configuration;
        _sharedSessions = sharedSessions;
        _logger = logger;
    }

    /// <summary>
    /// Firma veritabanına bağlanır. Kalıp <c>SsaUsersController</c> ile aynı: temel bağlantı
    /// dizesinin yalnız veritabanı adı değiştirilir.
    /// </summary>
    private AppDbContext CreateTenantDbContext(string tenantDbName)
    {
        var baseConnStr = _configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(baseConnStr))
        {
            throw new InvalidOperationException("DefaultConnection bulunamadı");
        }

        var csb = new Npgsql.NpgsqlConnectionStringBuilder(baseConnStr) { Database = tenantDbName };

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(csb.ConnectionString)
            .Options;

        return new AppDbContext(options);
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        if (!isSsa) return StatusCode(403, new { success = false, message = "Yetkiniz yok" });

        var items = await _masterDb.GlobalUsers
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .Select(x => new
            {
                id = x.Id,
                username = x.Username,
                mail = x.Mail,
                isSuperSuperAdmin = x.IsSuperSuperAdmin,
                isActive = x.IsActive
            })
            .ToListAsync(cancellationToken);

        var userIds = items.Select(x => x.id).ToList();

        var links = await _masterDb.GlobalUserTenants
            .AsNoTracking()
            .Where(x => userIds.Contains(x.GlobalUserId) && x.IsActive)
            .Select(x => new { x.GlobalUserId, tenantCode = x.Tenant.Code, tenantName = x.Tenant.Name })
            .ToListAsync(cancellationToken);

        var map = links
            .GroupBy(x => x.GlobalUserId)
            .ToDictionary(
                g => g.Key,
                g => g
                    .Select(t => new TenantRef(t.tenantCode, t.tenantName))
                    .OrderBy(t => t.Code)
                    .ToList());

        var data = items.Select(u => new
        {
            u.id,
            u.username,
            u.mail,
            u.isSuperSuperAdmin,
            u.isActive,
            tenants = map.TryGetValue(u.id, out var ts) ? ts : new List<TenantRef>()
        }).ToList();

        return Ok(new { success = true, data });
    }

    [AtomicRequest]
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateGlobalUserRequest request, CancellationToken cancellationToken)
    {
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        if (!isSsa) return StatusCode(403, new { success = false, message = "Yetkiniz yok" });

        var username = (request.Username ?? string.Empty).Trim();
        var mail = (request.Mail ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(mail) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { success = false, message = "Eksik bilgi" });

        var exists = await _masterDb.GlobalUsers.AsNoTracking().AnyAsync(x => x.Username == username, cancellationToken);
        if (exists) return BadRequest(new { success = false, message = "Bu kullanıcı adı zaten var" });

        // BCRYPT SINIRI DOĞRULANIR (2026-08-20 kullanıcı kararı, denetim md. 16/C3).
        //
        // BCrypt parolanın ilk 72 BAYTINI hesaba katar, gerisini sessizce atar: 80 karakterlik
        // bir parolada son karakterler hiçbir şey ifade etmez ve kullanıcı onları yanlış yazsa
        // bile giriş açılır. Sessiz kırpma yerine açık hata veriliyor.
        if (PasswordHasher.ExceedsBcryptLimit(request.Password))
        {
            return BadRequest(new
            {
                success = false,
                message = $"Parola en fazla {PasswordHasher.MaxPasswordBytes} bayt olabilir (Türkçe karakterler 2 bayt sayılır). Lütfen daha kısa bir parola girin."
            });
        }
        var user = new GlobalUser
        {
            Username = username,
            Mail = mail,
            PasswordHash = PasswordHasher.HashPassword(request.Password),
            IsSuperSuperAdmin = request.IsSuperSuperAdmin,
            IsActive = true
        };

        _masterDb.GlobalUsers.Add(user);
        await _masterDb.SaveChangesAsync(cancellationToken);

        if (!user.IsSuperSuperAdmin && request.TenantCodes.Count > 0)
        {
            var codes = request.TenantCodes.Select(x => (x ?? string.Empty).Trim().ToUpperInvariant()).Where(x => x.Length > 0).Distinct().ToList();
            var tenants = await _masterDb.Tenants
                .AsNoTracking()
                .Where(t => codes.Contains(t.Code))
                .Select(t => new { t.Id, t.Code })
                .ToListAsync(cancellationToken);

            foreach (var t in tenants)
            {
                _masterDb.GlobalUserTenants.Add(new GlobalUserTenant
                {
                    GlobalUserId = user.Id,
                    TenantId = t.Id,
                    IsActive = true
                });
            }

            await _masterDb.SaveChangesAsync(cancellationToken);
        }

        return Ok(new { success = true, data = new { id = user.Id } });
    }

    [HttpPost("assign-tenants")]
    public async Task<IActionResult> AssignTenants([FromBody] AssignUserTenantsRequest request, CancellationToken cancellationToken)
    {
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        if (!isSsa) return StatusCode(403, new { success = false, message = "Yetkiniz yok" });

        var user = await _masterDb.GlobalUsers.FirstOrDefaultAsync(x => x.Id == request.GlobalUserId, cancellationToken);
        if (user is null) return NotFound(new { success = false, message = "Kullanıcı bulunamadı" });

        if (user.IsSuperSuperAdmin)
            return BadRequest(new { success = false, message = "SSA kullanıcıya firma atanmaz" });

        var codes = (request.TenantCodes ?? new List<string>())
            .Select(x => (x ?? string.Empty).Trim().ToUpperInvariant())
            .Where(x => x.Length > 0)
            .Distinct()
            .ToList();

        var tenantIds = await _masterDb.Tenants
            .AsNoTracking()
            .Where(t => codes.Contains(t.Code))
            .Select(t => t.Id)
            .ToListAsync(cancellationToken);

        var existing = await _masterDb.GlobalUserTenants
            .Where(x => x.GlobalUserId == user.Id)
            .ToListAsync(cancellationToken);

        foreach (var link in existing)
        {
            link.IsActive = tenantIds.Contains(link.TenantId);
        }

        var existingTenantIds = existing.Select(x => x.TenantId).ToHashSet();
        foreach (var tid in tenantIds)
        {
            if (existingTenantIds.Contains(tid)) continue;
            _masterDb.GlobalUserTenants.Add(new GlobalUserTenant
            {
                GlobalUserId = user.Id,
                TenantId = tid,
                IsActive = true
            });
        }

        await _masterDb.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [AtomicRequest]
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        if (!isSsa) return StatusCode(403, new { success = false, message = "Yetkiniz yok" });

        var user = await _masterDb.GlobalUsers
            .Include(x => x.Tenants)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (user is null) return NotFound(new { success = false, message = "Kullanıcı bulunamadı" });

        // SON SSA SİLİNEMEZ.
        //
        // Bu uca yalnız SSA girebiliyor; dolayısıyla son SSA kendini silebiliyordu ve
        // sistemde SSA yetkisi olan kimse kalmıyordu — geri dönüşü elle veritabanı
        // müdahalesi olan bir kilitlenme. (Kendi kaydını silmek de aynı sonuca çıkıyor.)
        if (user.IsSuperSuperAdmin && user.IsActive)
        {
            var otherActiveSsaCount = await _masterDb.GlobalUsers
                .CountAsync(x => x.Id != user.Id && x.IsSuperSuperAdmin && x.IsActive, cancellationToken);

            if (otherActiveSsaCount == 0)
            {
                return BadRequest(new
                {
                    success = false,
                    message = "Sistemdeki son süper admin silinemez. Önce başka bir süper admin tanımlayın."
                });
            }
        }

        /*
          FİRMA İÇİNDEKİ EŞLERİ DE KAPANIR (2026-08-20 kullanıcı kararı, denetim md. C2).

          Global kullanıcı silindiğinde YALNIZ master kaydı gidiyordu. Oysa aynı kullanıcı
          adı firma veritabanlarında ayrıca duruyor ve giriş oradan da yapılabiliyor:
          "kullanıcıyı sildim" denilen kişi firma kodunu yazarak sisteme girmeye devam
          edebiliyordu. Silme, erişimin bittiği anlamına gelmelidir.

          Firma içindeki kayıt SİLİNMEZ, PASİFE alınır. Silinseydi o kullanıcının attığı
          imzalar (fatura kesen, tahsilat yapan, teklif veren) sahipsiz kalırdı; geçmiş
          bozulmasın diye kayıt kalır, erişim kapanır.

          Bir firmaya ulaşılamazsa (veritabanı kapalı, ağ hatası) silme İPTAL EDİLMEZ —
          master kaydı gider, o firma uyarı olarak bildirilir. Aksi hâlde tek erişilemeyen
          firma yüzünden kullanıcı hiç silinemez ve diğer firmalarda da açık kalırdı.
        */
        var tenantCodes = user.Tenants.Select(x => x.TenantId).ToList();
        var tenants = await _masterDb.Tenants
            .AsNoTracking()
            .Where(x => tenantCodes.Contains(x.Id))
            .Select(x => new { x.Code, x.Name, x.DbName })
            .ToListAsync(cancellationToken);

        var uyarilar = new List<string>();
        var pasifeAlinan = 0;

        foreach (var tenant in tenants)
        {
            if (string.IsNullOrWhiteSpace(tenant.DbName)) continue;

            try
            {
                await using var tenantDb = CreateTenantDbContext(tenant.DbName);

                var localUsers = await tenantDb.Users
                    .Where(x => x.Username == user.Username && x.IsActive)
                    .ToListAsync(cancellationToken);

                foreach (var localUser in localUsers)
                {
                    localUser.IsActive = false;
                }

                if (localUsers.Count > 0)
                {
                    await tenantDb.SaveChangesAsync(cancellationToken);
                    pasifeAlinan += localUsers.Count;
                }

                // Açık oturum pasifleştirmeden SONRA da yaşamaya devam ederdi: elindeki
                // token süresi dolana kadar geçerli kalırdı. Ortak oturum kapatılır.
                await _sharedSessions.RevokeAsync(tenant.Code, user.Username, cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Global kullanıcı {Username} silinirken {Tenant} firmasındaki eşi pasife alınamadı.",
                    user.Username, tenant.Code);

                uyarilar.Add($"{tenant.Name} ({tenant.Code}) firmasındaki kullanıcı kaydı kapatılamadı — o firmada erişim hâlâ açık olabilir, elle kontrol edin.");
            }
        }

        // Bağlı firma eşleşmeleri önce temizlenir; aksi halde silme yabancı anahtar
        // kısıtına takılıp yakalanmamış 500 dönüyordu.
        if (user.Tenants.Count > 0)
        {
            _masterDb.RemoveRange(user.Tenants);
        }

        _masterDb.GlobalUsers.Remove(user);
        await _masterDb.SaveChangesAsync(cancellationToken);

        // Master oturumu da kapanır (firma kodu yok = global oturum satırı).
        try
        {
            await _sharedSessions.RevokeAsync(null, user.Username, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Global kullanıcı {Username} silindi ama global oturumu kapatılamadı.", user.Username);
        }

        return Ok(new
        {
            success = true,
            deactivatedTenantUsers = pasifeAlinan,
            warnings = uyarilar
        });
    }
}
