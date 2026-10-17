using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/ssa-users")]
[Authorize]
public sealed class SsaUsersController : ControllerBase
{
    private readonly MasterDbContext _masterDb;
    private readonly IConfiguration _configuration;

    public SsaUsersController(MasterDbContext masterDb, IConfiguration configuration)
    {
        _masterDb = masterDb;
        _configuration = configuration;
    }

    private bool RequesterIsSsa() => User.FindFirst("IsSuperSuperAdmin")?.Value == "1";

    private string BuildTenantConnectionString(string tenantDbName)
    {
        var baseConnStr = _configuration.GetConnectionString("DefaultConnection");
        if (string.IsNullOrWhiteSpace(baseConnStr))
        {
            throw new InvalidOperationException("DefaultConnection bulunamadı");
        }

        var csb = new NpgsqlConnectionStringBuilder(baseConnStr)
        {
            Database = tenantDbName
        };

        return csb.ConnectionString;
    }

    private AppDbContext CreateTenantDbContext(string tenantDbName)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(BuildTenantConnectionString(tenantDbName))
            .Options;

        return new AppDbContext(options);
    }

    private async Task EnsureFirmaCodeColumnAsync(string tenantDbName, CancellationToken cancellationToken)
    {
        try
        {
            var connStr = BuildTenantConnectionString(tenantDbName);
            await using var conn = new NpgsqlConnection(connStr);
            await conn.OpenAsync(cancellationToken);

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = "ALTER TABLE \"Users\" ADD COLUMN IF NOT EXISTS \"FirmaCode\" character varying(50);";
            await cmd.ExecuteNonQueryAsync(cancellationToken);
        }
        catch
        {
            // best-effort: if this fails we fall back to the existing behavior and return the underlying error
        }
    }

    private static async Task<bool> TenantHasFirmaCodeColumnAsync(AppDbContext db, CancellationToken cancellationToken)
    {
        try
        {
            var connStr = db.Database.GetDbConnection().ConnectionString;
            await using var conn = new NpgsqlConnection(connStr);
            await conn.OpenAsync(cancellationToken);

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
SELECT 1
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'Users'
  AND column_name = 'FirmaCode'
LIMIT 1;";

            var result = await cmd.ExecuteScalarAsync(cancellationToken);
            return result is not null && result != DBNull.Value;
        }
        catch
        {
            return false;
        }
    }

    public sealed record SsaTenantUserRow(
        int TenantId,
        string TenantCode,
        string TenantName,
        int UserId,
        string Username,
        string Mail,
        string Unvan,
        string? Gsm,
        int RoleId,
        string RoleCode,
        string RoleName,
        bool IsActive,
        string? FirmaCode
    );

    public sealed record SsaUserTenantInstance(
        int TenantId,
        string TenantCode,
        string TenantName,
        int UserId,
        int RoleId,
        string RoleCode,
        string RoleName,
        bool IsActive,
        string? FirmaCode
    );

    public sealed record SsaGlobalUserRow(
        string UserKey,
        string Username,
        string Mail,
        string Unvan,
        bool IsActive,
        List<SsaUserTenantInstance> Tenants
    );

    [HttpGet]
    public async Task<IActionResult> ListAll(CancellationToken cancellationToken)
    {
        if (!RequesterIsSsa()) return StatusCode(403, new { success = false, message = "Yetkiniz yok" });

        var tenants = await _masterDb.Tenants
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.Id)
            .Select(x => new { x.Id, x.Code, x.Name, x.DbName })
            .ToListAsync(cancellationToken);

        var rows = new List<SsaTenantUserRow>();

        foreach (var t in tenants)
        {
            await using var db = CreateTenantDbContext(t.DbName);

            var users = await db.Users
                .AsNoTracking()
                .OrderBy(u => u.Id)
                .Select(u => new
                {
                    u.Id,
                    u.Username,
                    u.Mail,
                    u.Unvan,
                    u.Gsm,
                    u.RoleId,
                    RoleCode = u.Role.Code,
                    RoleName = u.Role.Name,
                    u.IsActive
                })
                .ToListAsync(cancellationToken);

            foreach (var u in users)
            {
                rows.Add(new SsaTenantUserRow(
                    t.Id,
                    t.Code,
                    t.Name,
                    u.Id,
                    u.Username,
                    u.Mail,
                    u.Unvan,
                    u.Gsm,
                    u.RoleId,
                    u.RoleCode ?? string.Empty,
                    u.RoleName ?? string.Empty,
                    u.IsActive,
                    null
                ));
            }
        }

        return Ok(new { success = true, data = rows });
    }

    [HttpGet("grouped")]
    public async Task<IActionResult> ListGrouped(CancellationToken cancellationToken)
    {
        if (!RequesterIsSsa()) return StatusCode(403, new { success = false, message = "Yetkiniz yok" });

        try
        {
            var tenants = await _masterDb.Tenants
                .AsNoTracking()
                .Where(x => x.IsActive)
                .OrderBy(x => x.Id)
                .Select(x => new { x.Id, x.Code, x.Name, x.DbName })
                .ToListAsync(cancellationToken);

            var byKey = new Dictionary<string, (string Username, string Mail, string Unvan, bool IsActive, List<SsaUserTenantInstance> Instances)>(StringComparer.OrdinalIgnoreCase);
            var errors = new List<object>();

            foreach (var t in tenants)
            {
                var dbName = string.IsNullOrWhiteSpace(t.DbName) ? $"b2b_erp_tenant_{t.Code}" : t.DbName;

                try
                {
                    await using var db = CreateTenantDbContext(dbName);

                    var users = await db.Users
                        .AsNoTracking()
                        .OrderBy(u => u.Id)
                        .Select(u => new
                        {
                            u.Id,
                            u.Username,
                            u.Mail,
                            u.Unvan,
                            u.RoleId,
                            RoleCode = u.Role.Code,
                            RoleName = u.Role.Name,
                            u.IsActive
                        })
                        .ToListAsync(cancellationToken);

                    foreach (var u in users)
                    {
                        var key = (u.Username ?? string.Empty).Trim();
                        if (string.IsNullOrWhiteSpace(key)) continue;

                        var usernameVal = (u.Username ?? string.Empty).Trim();
                        var mailVal = u.Mail ?? string.Empty;
                        var unvanVal = u.Unvan ?? string.Empty;

                        if (!byKey.TryGetValue(key, out var agg))
                        {
                            agg = (
                                Username: usernameVal,
                                Mail: mailVal,
                                Unvan: unvanVal,
                                IsActive: u.IsActive,
                                Instances: new List<SsaUserTenantInstance>()
                            );
                            byKey[key] = agg;
                        }
                        else
                        {
                            if (string.IsNullOrWhiteSpace(agg.Mail) && !string.IsNullOrWhiteSpace(mailVal))
                                agg.Mail = mailVal;
                            if (string.IsNullOrWhiteSpace(agg.Unvan) && !string.IsNullOrWhiteSpace(unvanVal))
                                agg.Unvan = unvanVal;
                            agg.IsActive = agg.IsActive || u.IsActive;
                            byKey[key] = agg;
                        }

                        agg.Instances.Add(new SsaUserTenantInstance(
                            t.Id,
                            t.Code,
                            t.Name,
                            u.Id,
                            u.RoleId,
                            u.RoleCode ?? string.Empty,
                            u.RoleName ?? string.Empty,
                            u.IsActive,
                            null
                        ));
                    }
                }
                catch (Exception ex)
                {
                    errors.Add(new
                    {
                        tenantCode = t.Code,
                        tenantName = t.Name,
                        dbName,
                        error = ex.Message
                    });
                }
            }

            var data = byKey
                .OrderBy(x => x.Value.Username)
                .Select(x => new SsaGlobalUserRow(
                    UserKey: x.Key,
                    Username: x.Value.Username,
                    Mail: x.Value.Mail,
                    Unvan: x.Value.Unvan,
                    IsActive: x.Value.IsActive,
                    Tenants: x.Value.Instances
                        .OrderBy(i => i.TenantCode)
                        .ToList()
                ))
                .ToList();

            return Ok(new { success = true, data, errors });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new
            {
                success = false,
                message = "SSA kullanıcıları okunurken hata oluştu",
                error = ex.Message,
                stackTrace = ex.StackTrace
            });
        }
    }

    public sealed class AssignTenantsRequest
    {
        public string SourceTenantCode { get; set; } = string.Empty;
        public int SourceUserId { get; set; }
        public List<string> TargetTenantCodes { get; set; } = new();
    }

    [HttpPost("assign")]
    public async Task<IActionResult> Assign([FromBody] AssignTenantsRequest request, CancellationToken cancellationToken)
    {
        if (!RequesterIsSsa()) return StatusCode(403, new { success = false, message = "Yetkiniz yok" });

        var sourceTenantCode = (request.SourceTenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(sourceTenantCode) || request.SourceUserId <= 0)
        {
            return BadRequest(new { success = false, message = "Eksik bilgi" });
        }

        var sourceTenant = await _masterDb.Tenants
            .AsNoTracking()
            .Where(x => x.Code == sourceTenantCode)
            .Select(x => new { x.Id, x.Code, x.Name, x.DbName })
            .FirstOrDefaultAsync(cancellationToken);

        if (sourceTenant is null)
        {
            return NotFound(new { success = false, message = "Kaynak firma bulunamadı" });
        }

        // Some tenant DBs may not have the FirmaCode column yet; ensure it's present before EF queries.
        await EnsureFirmaCodeColumnAsync(sourceTenant.DbName, cancellationToken);

        await using var sourceDb = CreateTenantDbContext(sourceTenant.DbName);
        var sourceUser = await sourceDb.Users
            .AsNoTracking()
            .Include(u => u.Role)
            .FirstOrDefaultAsync(x => x.Id == request.SourceUserId, cancellationToken);

        if (sourceUser is null)
        {
            return NotFound(new { success = false, message = "Kaynak kullanıcı bulunamadı" });
        }

        var sourceRoleCode = sourceUser.Role?.Code;

        var targetCodes = (request.TargetTenantCodes ?? new List<string>())
            .Select(x => (x ?? string.Empty).Trim().ToUpperInvariant())
            .Where(x => x.Length > 0)
            .Distinct()
            .ToList();

        if (targetCodes.Count == 0)
        {
            return BadRequest(new { success = false, message = "Hedef firma seçiniz" });
        }

        var targetTenants = await _masterDb.Tenants
            .AsNoTracking()
            .Where(x => x.IsActive && targetCodes.Contains(x.Code))
            .Select(x => new { x.Id, x.Code, x.Name, x.DbName })
            .ToListAsync(cancellationToken);

        foreach (var t in targetTenants)
        {
            if (t.Code == sourceTenant.Code) continue;

            await EnsureFirmaCodeColumnAsync(t.DbName, cancellationToken);

            await using var targetDb = CreateTenantDbContext(t.DbName);
            var targetHasFirmaCode = await TenantHasFirmaCodeColumnAsync(targetDb, cancellationToken);

            var existing = await targetDb.Users
                .Include(u => u.Role)
                .FirstOrDefaultAsync(x => x.Username == sourceUser.Username, cancellationToken);

            // CARİ KODU HEDEF FİRMADA DOĞRULANIR (kullanıcı kararı, 2026-08-17).
            //
            // Kod olduğu gibi kopyalanıyordu: hedef firmada AYNI kod başka bir müşteriye ait
            // olabilir ve kullanıcı o müşterinin verisini görürdü. Kodu TEMİZLEMEK daha kötü
            // olurdu — bu sistemde boş `Carikodu` "sınırsız" demek. O yüzden kod aynen
            // kopyalanır ama karşılığı yoksa kullanıcı hedef firmada PASİF açılır; yetkili
            // bakıp doğru cariyi yazınca aktif eder.
            var scopeIsUnrestricted = CustomerScope.IsUnrestricted(sourceUser.Carikodu);
            var scopeResolvesInTarget = true;

            if (!scopeIsUnrestricted)
            {
                var wantedCodes = (sourceUser.Carikodu ?? string.Empty)
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .ToList();

                if (wantedCodes.Count > 0)
                {
                    var foundCount = await targetDb.Customers
                        .AsNoTracking()
                        .CountAsync(c => wantedCodes.Contains(c.CustomerCode), cancellationToken);

                    scopeResolvesInTarget = foundCount == wantedCodes.Count;
                }
            }

            var targetRoleId = sourceUser.RoleId;
            if (!string.IsNullOrWhiteSpace(sourceRoleCode))
            {
                var role = await targetDb.Roles
                    .AsNoTracking()
                    .Where(r => r.Code == sourceRoleCode)
                    .Select(r => new { r.Id })
                    .FirstOrDefaultAsync(cancellationToken);

                if (role is not null)
                {
                    targetRoleId = role.Id;
                }
            }

            if (existing is null)
            {
                var created = new User
                {
                    Username = sourceUser.Username,
                    Mail = sourceUser.Mail,
                    Password = sourceUser.Password,
                    FirmaCode = (targetHasFirmaCode ? t.Code : null),
                    Gsm = sourceUser.Gsm,
                    Unvan = sourceUser.Unvan,
                    Carikodu = sourceUser.Carikodu,
                    SalesmanCode = sourceUser.SalesmanCode,
                    DefaultWarehouseCode = null,
                    // Cari kodunun hedef firmada karşılığı yoksa kullanıcı KAPALI açılır.
                    IsActive = sourceUser.IsActive && scopeResolvesInTarget,
                    RoleId = targetRoleId,
                    CreateUser = User.Identity?.Name ?? "System",
                    CreateTime = DateTime.UtcNow
                };

                targetDb.Users.Add(created);
            }
            else
            {
                existing.Mail = sourceUser.Mail;
                existing.Gsm = sourceUser.Gsm;
                existing.Unvan = sourceUser.Unvan;
                existing.Carikodu = sourceUser.Carikodu;
                existing.SalesmanCode = sourceUser.SalesmanCode;
                // Var olan kullanıcı da aynı kurala tabi: kaynaktan gelen cari kodu hedefte
                // çözülmüyorsa hesap kapatılır, yanlış müşterinin verisini görmesin.
                existing.IsActive = sourceUser.IsActive && scopeResolvesInTarget;
                existing.RoleId = targetRoleId;
                if (targetHasFirmaCode)
                {
                    existing.FirmaCode = t.Code;
                }
                existing.UpdatedAt = DateTime.UtcNow;
                existing.EditUser = User.Identity?.Name;
                existing.EditTime = DateTime.UtcNow;
            }

            await targetDb.SaveChangesAsync(cancellationToken);
        }

        return Ok(new { success = true });
    }
}
