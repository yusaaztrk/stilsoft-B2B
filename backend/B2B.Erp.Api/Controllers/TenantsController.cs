using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.DTOs.Tenants;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;
using System.Security.Claims;


namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class TenantsController : ControllerBase
{
    private readonly MasterDbContext _masterDb;
    private readonly ITenantProvisioningService _tenantProvisioning;
    private readonly IConfiguration _configuration;

    /// <summary>
    /// `Tenants` tablosundaki eksik kolonları tamamlayan DDL — SÜREÇ BAŞINA BİR KEZ.
    ///
    /// Bu iki `ALTER TABLE` üç ayrı uçta, İSTEK BAŞINA çalışıyordu; en kötüsü
    /// <see cref="PublicList"/>: giriş ekranının firma listesini çektiği **anonim** uç.
    /// Yani her ziyaretçi, daha giriş yapmadan master veritabanında iki DDL tetikliyordu
    /// (PostgreSQL katalog kilidi). Master tek veritabanı olduğu için nöbetçi de tek;
    /// hata hâlinde işaretlenmez, sonraki istek yeniden dener.
    /// </summary>
    private static int _tenantSchemaEnsured;

    private async Task EnsureTenantColumnsAsync(CancellationToken cancellationToken)
    {
        if (System.Threading.Volatile.Read(ref _tenantSchemaEnsured) == 1) return;

        await _masterDb.Database.ExecuteSqlRawAsync(@"
ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""ServiceOpsEnabled"" boolean NOT NULL DEFAULT FALSE;
ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""ServiceOpsDbName"" text NULL;
", cancellationToken);

        System.Threading.Volatile.Write(ref _tenantSchemaEnsured, 1);
    }

    public TenantsController(MasterDbContext masterDb, ITenantProvisioningService tenantProvisioning, IConfiguration configuration)
    {
        _masterDb = masterDb;
        _tenantProvisioning = tenantProvisioning;
        _configuration = configuration;
    }

    public sealed class TenantBrandingDto
    {
        public string? LogoUrl { get; set; }
        public string? HeaderGradientFrom { get; set; }
        public string? HeaderGradientTo { get; set; }
        public string? CampaignGradientFrom { get; set; }
        public string? CampaignGradientTo { get; set; }
        public string? CampaignTextColor { get; set; }
        public bool IsEcommerceEnabled { get; set; }
    }

    public sealed class UpdateTenantBrandingRequest
    {
        public IFormFile? Logo { get; set; }
        public string? HeaderGradientFrom { get; set; }
        public string? HeaderGradientTo { get; set; }
        public string? CampaignGradientFrom { get; set; }
        public string? CampaignGradientTo { get; set; }
        public string? CampaignTextColor { get; set; }
    }

    [HttpGet("branding")]
    public async Task<IActionResult> GetBranding(CancellationToken cancellationToken)
    {
        var tenant = await ResolveCurrentTenantAsync(cancellationToken);
        if (tenant is null)
        {
            return BadRequest(new { success = false, message = "Tenant bulunamadı" });
        }

        var logoUrl = string.IsNullOrWhiteSpace(tenant.LogoPath)
            ? null
            : $"{B2B.Erp.Api.Core.Helpers.PublicOrigin.Of(Request)}{tenant.LogoPath}";

        return Ok(new
        {
            success = true,
            data = new TenantBrandingDto
            {
                LogoUrl = logoUrl,
                HeaderGradientFrom = tenant.HeaderGradientFrom,
                HeaderGradientTo = tenant.HeaderGradientTo,
                CampaignGradientFrom = tenant.CampaignGradientFrom,
                CampaignGradientTo = tenant.CampaignGradientTo,
                CampaignTextColor = tenant.CampaignTextColor,
                IsEcommerceEnabled = tenant.IsEcommerceEnabled
            }
        });
    }

    [HttpPut("branding")]
    public async Task<IActionResult> UpdateBranding([FromForm] UpdateTenantBrandingRequest request, CancellationToken cancellationToken)
    {
        // Branding is the firm's public identity — logo, colours, the login screen every user
        // of the tenant sees. This endpoint carried no check at all, so any authenticated
        // account could rewrite it. Restricted to the platform owner and the firm's own
        // super admin; both are proven by master-issued claims, not by tenant data.
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        if (!isSsa && !isSuperAdmin)
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                new { success = false, message = "Bu işlem için yetkiniz yok." });
        }

        var tenant = await ResolveCurrentTenantAsync(cancellationToken);
        if (tenant is null)
        {
            return BadRequest(new { success = false, message = "Tenant bulunamadı" });
        }

        var from = (request.HeaderGradientFrom ?? string.Empty).Trim();
        var to = (request.HeaderGradientTo ?? string.Empty).Trim();
        tenant.HeaderGradientFrom = string.IsNullOrWhiteSpace(from) ? null : from;
        tenant.HeaderGradientTo = string.IsNullOrWhiteSpace(to) ? null : to;

        var campFrom = (request.CampaignGradientFrom ?? string.Empty).Trim();
        var campTo = (request.CampaignGradientTo ?? string.Empty).Trim();
        var campText = (request.CampaignTextColor ?? string.Empty).Trim();
        tenant.CampaignGradientFrom = string.IsNullOrWhiteSpace(campFrom) ? null : campFrom;
        tenant.CampaignGradientTo = string.IsNullOrWhiteSpace(campTo) ? null : campTo;
        tenant.CampaignTextColor = string.IsNullOrWhiteSpace(campText) ? null : campText;

        if (request.Logo is not null && request.Logo.Length > 0)
        {
            var (ok, err) = ValidateLogoFile(request.Logo);
            if (!ok)
            {
                return BadRequest(new { success = false, message = err });
            }

            var ext = Path.GetExtension(request.Logo.FileName);
            ext = string.IsNullOrWhiteSpace(ext) ? ".png" : ext;
            ext = ext.Length > 10 ? ext[..10] : ext;

            var safeTenantCode = (tenant.Code ?? string.Empty).Trim().ToUpperInvariant();
            var folder = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "tenant-assets", safeTenantCode);
            Directory.CreateDirectory(folder);

            var fileName = $"logo_{Guid.NewGuid():N}{ext}";
            var fullPath = Path.Combine(folder, fileName);

            await using (var stream = System.IO.File.Create(fullPath))
            {
                await request.Logo.CopyToAsync(stream, cancellationToken);
            }

            tenant.LogoPath = $"/tenant-assets/{safeTenantCode}/{fileName}";
        }

        await _masterDb.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    private async Task<Tenant?> ResolveCurrentTenantAsync(CancellationToken cancellationToken)
    {
        string? tenantCode = null;
        if (Request.Headers.TryGetValue("X-Tenant-Code", out var codeValues))
        {
            tenantCode = codeValues.ToString();
        }

        tenantCode = (tenantCode ?? string.Empty).Trim();
        if (!string.IsNullOrWhiteSpace(tenantCode))
        {
            var normalized = tenantCode.ToUpperInvariant();
            return await _masterDb.Tenants.FirstOrDefaultAsync(x => x.Code == normalized, cancellationToken);
        }

        var tenantIdStr = User.FindFirst("TenantId")?.Value ?? User.FindFirst("tenantId")?.Value;
        if (int.TryParse(tenantIdStr, out var tenantId) && tenantId > 0)
        {
            return await _masterDb.Tenants.FirstOrDefaultAsync(x => x.Id == tenantId, cancellationToken);
        }

        return null;
    }

    private static (bool ok, string error) ValidateLogoFile(IFormFile file)
    {
        var ext = (Path.GetExtension(file.FileName) ?? string.Empty).Trim().ToLowerInvariant();
        var contentType = (file.ContentType ?? string.Empty).Trim().ToLowerInvariant();

        var allowedExt = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".png", ".jpg", ".jpeg", ".webp" };
        var allowedContentTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "image/png",
            "image/jpeg",
            "image/webp"
        };

        if (!allowedExt.Contains(ext)) return (false, "Sadece png/jpg/jpeg/webp dosyaları kabul edilir");
        if (!allowedContentTypes.Contains(contentType)) return (false, "Geçersiz dosya tipi");

        var maxBytes = 2 * 1024 * 1024;
        if (file.Length > maxBytes) return (false, "Logo dosyası en fazla 2MB olabilir");

        return (true, string.Empty);
    }

    [HttpGet("public-branding")]
    [AllowAnonymous]
    public async Task<IActionResult> GetPublicBranding([FromQuery] string? tenantCode, CancellationToken cancellationToken)
    {
        var code = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(code))
        {
            return BadRequest(new { success = false, message = "Tenant kodu zorunludur" });
        }

        var tenant = await _masterDb.Tenants.FirstOrDefaultAsync(x => x.Code == code, cancellationToken);
        if (tenant is null)
        {
            return NotFound(new { success = false, message = "Tenant bulunamadı" });
        }

        var logoUrl = string.IsNullOrWhiteSpace(tenant.LogoPath)
            ? null
            : $"{B2B.Erp.Api.Core.Helpers.PublicOrigin.Of(Request)}{tenant.LogoPath}";

        return Ok(new
        {
            success = true,
            data = new TenantBrandingDto
            {
                LogoUrl = logoUrl,
                HeaderGradientFrom = tenant.HeaderGradientFrom,
                HeaderGradientTo = tenant.HeaderGradientTo,
                IsEcommerceEnabled = tenant.IsEcommerceEnabled
            }
        });
    }

    [HttpGet("public")]
    [AllowAnonymous]
    public async Task<IActionResult> PublicList([FromQuery] bool serviceOpsOnly = false, CancellationToken cancellationToken = default)
    {
        var where = serviceOpsOnly
            ? "t.\"IsActive\" = TRUE AND t.\"ServiceOpsEnabled\" = TRUE"
            : "t.\"IsActive\" = TRUE";

        // 1) Prefer Master DB.
        List<TenantPublicItem> tenantsFromMaster = new();
        try
        {
            await EnsureTenantColumnsAsync(cancellationToken);

            var query = _masterDb.Tenants.AsNoTracking().Where(t => t.IsActive);
            if (serviceOpsOnly)
            {
                query = query.Where(t => t.ServiceOpsEnabled);
            }

            tenantsFromMaster = await query
                .OrderBy(t => t.Name)
                .Select(t => new TenantPublicItem
                {
                    Code = t.Code,
                    Name = t.Name
                })
                .ToListAsync(cancellationToken);
        }
        catch
        {
            // ignore
        }

        if (tenantsFromMaster.Count > 0)
        {
            return Ok(new { success = true, data = tenantsFromMaster.Select(x => new { code = x.Code, name = x.Name }) });
        }

        // 2) Fallback for legacy setups: tenants might exist in DefaultConnection DB.
        try
        {
            var defaultConn = _configuration.GetConnectionString("DefaultConnection") ?? string.Empty;
            if (string.IsNullOrWhiteSpace(defaultConn))
            {
                return Ok(new { success = true, data = Array.Empty<object>() });
            }

            await using var conn = new NpgsqlConnection(defaultConn);
            await conn.OpenAsync(cancellationToken);

            await using (var ensureCmd = conn.CreateCommand())
            {
                ensureCmd.CommandText = @"
ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""ServiceOpsEnabled"" boolean NOT NULL DEFAULT FALSE;
ALTER TABLE ""Tenants"" ADD COLUMN IF NOT EXISTS ""ServiceOpsDbName"" text NULL;";
                await ensureCmd.ExecuteNonQueryAsync(cancellationToken);
            }

            var sql = $@"
SELECT t.""Code"" AS ""Code"", t.""Name"" AS ""Name""
FROM ""Tenants"" AS t
WHERE {where}
ORDER BY t.""Name"";";

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;

            var result = new List<TenantPublicItem>();
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                result.Add(new TenantPublicItem
                {
                    Code = reader.IsDBNull(0) ? string.Empty : reader.GetString(0),
                    Name = reader.IsDBNull(1) ? string.Empty : reader.GetString(1)
                });
            }

            return Ok(new { success = true, data = result.Where(x => !string.IsNullOrWhiteSpace(x.Code)).Select(x => new { code = x.Code, name = x.Name }) });
        }
        catch
        {
            // If ServiceOps-only filtering is requested but schema isn't ready (e.g. missing column),
            // NEVER fall back to returning all tenants. Service Ops login must only show enabled firms.
            if (serviceOpsOnly)
            {
                return Ok(new { success = true, data = Array.Empty<object>() });
            }

            // ERP login: best-effort fallback to show all active tenants.
            try
            {
                var tenants = await _masterDb.Tenants
                    .AsNoTracking()
                    .Where(t => t.IsActive)
                    .OrderBy(t => t.Name)
                    .Select(t => new TenantPublicItem
                    {
                        Code = t.Code,
                        Name = t.Name
                    })
                    .ToListAsync(cancellationToken);

                return Ok(new { success = true, data = tenants.Select(x => new { code = x.Code, name = x.Name }) });
            }
            catch
            {
                return Ok(new { success = true, data = Array.Empty<object>() });
            }
        }
    }

    private sealed class TenantPublicItem
    {
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
    }

    [HttpGet("public-employees")]
    [AllowAnonymous]
    public async Task<IActionResult> PublicEmployeesList(CancellationToken cancellationToken)
    {
        const int CalisanPageId = 400;

        var tenantIds = await _masterDb.TenantEnabledPages
            .AsNoTracking()
            .Where(x => x.IsEnabled && x.PageId == CalisanPageId)
            .Select(x => x.TenantId)
            .Distinct()
            .ToListAsync(cancellationToken);

        if (tenantIds.Count == 0)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var tenants = await _masterDb.Tenants
            .AsNoTracking()
            .Where(x => x.IsActive && tenantIds.Contains(x.Id))
            .OrderBy(x => x.Name)
            .Select(x => new
            {
                code = x.Code,
                name = x.Name
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = tenants });
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        if (!isSsa)
        {
            return StatusCode(403, new { success = false, message = "Yetkiniz yok" });
        }

        var tenants = await _masterDb.Tenants
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .Select(x => new
            {
                tenantId = x.Id,
                code = x.Code,
                name = x.Name,
                dbName = x.DbName,
                isActive = x.IsActive,
                isEcommerceEnabled = x.IsEcommerceEnabled,

                // KURULUM DURUMU (denetim md. E2). Yarım kalmış firma listede sağlam
                // görünüyordu; artık ayırt edilebiliyor. Damgası olmayan firmanın
                // veritabanı eksik olabilir — silme YOK, yalnız uyarı.
                setupCompletedAt = x.SetupCompletedAt,
                setupIncomplete = x.SetupCompletedAt == null
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = tenants });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateTenantRequest request, CancellationToken cancellationToken)
    {
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        if (!isSsa)
        {
            return StatusCode(403, new { success = false, message = "Yetkiniz yok" });
        }

        int tenantId;
        try
        {
            tenantId = await _tenantProvisioning.CreateTenantAsync(
                request.Code,
                request.Name,
                request.IsEcommerceEnabled,
                request.EnabledPageIds,
                request.SuperAdminUsername,
                request.SuperAdminMail,
                request.SuperAdminPassword,
                request.ServiceOpsEnabled,
                request.ServiceOpsSuperAdminUsername,
                request.ServiceOpsSuperAdminMail,
                request.ServiceOpsSuperAdminPassword,
                cancellationToken);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { success = false, message = ex.Message });
        }

        var tenant = await _masterDb.Tenants
            .AsNoTracking()
            .Where(x => x.Id == tenantId)
            .Select(x => new CreateTenantResponse
            {
                TenantId = x.Id,
                Code = x.Code,
                Name = x.Name,
                DbName = x.DbName
            })
            .FirstAsync(cancellationToken);

        return Ok(new { success = true, data = tenant });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateTenantRequest request, CancellationToken cancellationToken)
    {
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        if (!isSsa)
        {
            return StatusCode(403, new { success = false, message = "Yetkiniz yok" });
        }

        try
        {
            await EnsureTenantColumnsAsync(cancellationToken);
        }
        catch
        {
            // ignore
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var tenant = await _masterDb.Tenants.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (tenant is null)
        {
            return NotFound(new { success = false, message = "Firma bulunamadı" });
        }

        tenant.Name = request.Name.Trim();
        tenant.IsActive = request.IsActive;
        tenant.IsEcommerceEnabled = request.IsEcommerceEnabled;
        var wasServiceOpsEnabled = tenant.ServiceOpsEnabled;
        tenant.ServiceOpsEnabled = request.ServiceOpsEnabled;

        await _masterDb.SaveChangesAsync(cancellationToken);

        if (request.ServiceOpsEnabled)
        {
            var soUser = (request.ServiceOpsSuperAdminUsername ?? string.Empty).Trim();
            var soMail = (request.ServiceOpsSuperAdminMail ?? string.Empty).Trim();
            var soPass = request.ServiceOpsSuperAdminPassword ?? string.Empty;

            if (string.IsNullOrWhiteSpace(soUser) || string.IsNullOrWhiteSpace(soMail) || string.IsNullOrWhiteSpace(soPass))
            {
                return BadRequest(new { success = false, message = "Servis SuperAdmin bilgileri zorunlu" });
            }

            try
            {
                await _tenantProvisioning.EnsureServiceOpsTenantAsync(
                    tenant.Code,
                    soUser,
                    soMail,
                    soPass,
                    cancellationToken);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { success = false, message = ex.Message });
            }
        }

        return Ok(new { success = true });
    }

    [HttpGet("{id:int}/enabled-pages")]
    public async Task<IActionResult> GetEnabledPages(int id, CancellationToken cancellationToken)
    {
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        if (!isSsa)
        {
            return StatusCode(403, new { success = false, message = "Yetkiniz yok" });
        }

        var exists = await _masterDb.Tenants.AsNoTracking().AnyAsync(x => x.Id == id, cancellationToken);
        if (!exists)
        {
            return NotFound(new { success = false, message = "Firma bulunamadı" });
        }

        var enabledIds = await _masterDb.TenantEnabledPages
            .AsNoTracking()
            .Where(x => x.TenantId == id && x.IsEnabled)
            .Select(x => x.PageId)
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = enabledIds });
    }

    public sealed class UpdateTenantEnabledPagesRequest
    {
        public List<int> EnabledPageIds { get; set; } = new();
    }

    [HttpPut("{id:int}/enabled-pages")]
    public async Task<IActionResult> UpdateEnabledPages(int id, [FromBody] UpdateTenantEnabledPagesRequest request, CancellationToken cancellationToken)
    {
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        if (!isSsa)
        {
            return StatusCode(403, new { success = false, message = "Yetkiniz yok" });
        }

        var tenant = await _masterDb.Tenants.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (tenant is null)
        {
            return NotFound(new { success = false, message = "Firma bulunamadı" });
        }

        var newIds = (request.EnabledPageIds ?? new List<int>()).Distinct().ToList();

        var existing = await _masterDb.TenantEnabledPages
            .Where(x => x.TenantId == id)
            .ToListAsync(cancellationToken);

        // Disable pages not in the new set
        foreach (var row in existing)
        {
            row.IsEnabled = newIds.Contains(row.PageId);
        }

        // Add new rows for pages not seen before
        var existingIds = existing.Select(x => x.PageId).ToHashSet();
        foreach (var pageId in newIds)
        {
            if (existingIds.Contains(pageId)) continue;
            _masterDb.TenantEnabledPages.Add(new TenantEnabledPage { TenantId = id, PageId = pageId, IsEnabled = true });
        }

        await _masterDb.SaveChangesAsync(cancellationToken);

        // Dynamically run database migrations on the tenant database to ensure all tables exist
        var baseConnStr = _configuration.GetConnectionString("DefaultConnection");
        var dbName = (tenant.DbName ?? string.Empty).Trim();
        if (!string.IsNullOrWhiteSpace(baseConnStr) && !string.IsNullOrWhiteSpace(dbName))
        {
            try
            {
                var csb = new NpgsqlConnectionStringBuilder(baseConnStr)
                {
                    Database = dbName
                };

                // Pre-flight check: ensure columns and migrations are correctly marked to avoid duplicate column/table errors
                await using (var preConn = new NpgsqlConnection(csb.ConnectionString))
                {
                    await preConn.OpenAsync(cancellationToken);
                    await using (var preCmd = preConn.CreateCommand())
                    {
                        preCmd.CommandText = @"
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='__EFMigrationsHistory') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='PurchaseInvoices' AND column_name='TerminStatus') THEN
      INSERT INTO ""__EFMigrationsHistory"" (""MigrationId"", ""ProductVersion"")
      VALUES ('20260525235726_AddTerminStatusToPurchaseInvoices', '8.0.0')
      ON CONFLICT (""MigrationId"") DO NOTHING;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='JwtSessionSettings' AND column_name='CampaignGiftAccountingMode') THEN
      INSERT INTO ""__EFMigrationsHistory"" (""MigrationId"", ""ProductVersion"")
      VALUES ('20260625233152_AddCampaignGiftSettings', '8.0.0')
      ON CONFLICT (""MigrationId"") DO NOTHING;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Invoices' AND column_name='IsManuallyPaid') THEN
      INSERT INTO ""__EFMigrationsHistory"" (""MigrationId"", ""ProductVersion"")
      VALUES ('20260627172222_AddInvoiceIsManuallyPaid', '8.0.0')
      ON CONFLICT (""MigrationId"") DO NOTHING;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='CampaignBuyRules') THEN
      INSERT INTO ""__EFMigrationsHistory"" (""MigrationId"", ""ProductVersion"")
      VALUES ('20260707161749_AddCampaignBuyRulesBack', '8.0.0')
      ON CONFLICT (""MigrationId"") DO NOTHING;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='Virmans') THEN
      INSERT INTO ""__EFMigrationsHistory"" (""MigrationId"", ""ProductVersion"")
      VALUES ('20260707151232_AddVirman', '8.0.0')
      ON CONFLICT (""MigrationId"") DO NOTHING;
    END IF;
  END IF;
END $$;
";
                        await preCmd.ExecuteNonQueryAsync(cancellationToken);
                    }
                }

                var options = new DbContextOptionsBuilder<AppDbContext>()
                    .UseNpgsql(csb.ConnectionString)
                    .Options;

                await using var tenantDb = new AppDbContext(options);
                try
                {
                    await tenantDb.Database.ExecuteSqlRawAsync(@"DROP INDEX IF EXISTS ""IX_Pages_ModuleKey_Key"";", cancellationToken);
                }
                catch {}

                await tenantDb.Database.MigrateAsync(cancellationToken);

                try
                {
                    await tenantDb.Database.ExecuteSqlRawAsync(@"CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Pages_ModuleKey_Key"" ON ""Pages"" (""ModuleKey"", ""Key"");", cancellationToken);
                }
                catch {}
            }
            catch (Exception ex)
            {
                return BadRequest(new { success = false, message = $"Firma veritabanı güncellenemedi (Göç Hatası): {ex.Message}" });
            }
        }

        return Ok(new { success = true });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        if (!isSsa)
        {
            return StatusCode(403, new { success = false, message = "Yetkiniz yok" });
        }

        var tenant = await _masterDb.Tenants.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (tenant is null)
        {
            return NotFound(new { success = false, message = "Firma bulunamadı" });
        }

        tenant.IsActive = false;
        await _masterDb.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpDelete("{id:int}/purge")]
    public async Task<IActionResult> Purge(int id, CancellationToken cancellationToken)
    {
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        if (!isSsa)
        {
            return StatusCode(403, new { success = false, message = "Yetkiniz yok" });
        }

        var tenant = await _masterDb.Tenants.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (tenant is null)
        {
            return NotFound(new { success = false, message = "Firma bulunamadı" });
        }

        var dbName = (tenant.DbName ?? string.Empty).Trim();
        var tenantCode = (tenant.Code ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(dbName))
        {
            return BadRequest(new { success = false, message = "Firma DB adı bulunamadı" });
        }

        // Defensive: only allow dropping known tenant DB names.
        //
        // ⚠️ Burada ANA MASTER veritabanının adı (`b2b_erp`) da beyaz listedeydi: nöbetçi
        // vardı ama korunması gereken tek adı dışlamıyordu. `DbName`i `b2b_erp` olan bir
        // tenant satırı (elle girilmiş ya da göçten kalmış) purge edildiğinde tek istekle
        // `DROP DATABASE "b2b_erp"` çalışıp bütün sistem kalıcı olarak siliniyordu.
        // Master DB bir kiracı veritabanı değildir; bu uçtan asla silinemez.
        if (!dbName.StartsWith("b2b_erp_tenant_", StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { success = false, message = "DB adı doğrulanamadı" });
        }

        if (string.Equals(dbName, "b2b_erp", StringComparison.OrdinalIgnoreCase)
            || string.Equals(dbName, "postgres", StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { success = false, message = "Ana veritabanı bu uçtan silinemez." });
        }

        await using var tx = await _masterDb.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            var masterConnStr = _configuration.GetConnectionString("MasterConnection");
            if (string.IsNullOrWhiteSpace(masterConnStr))
            {
                return StatusCode(500, new { success = false, message = "MasterConnection bulunamadı" });
            }

            var csb = new NpgsqlConnectionStringBuilder(masterConnStr)
            {
                Database = "postgres"
            };

            await using (var conn = new NpgsqlConnection(csb.ConnectionString))
            {
                await conn.OpenAsync(cancellationToken);

                // terminate connections before dropping
                await using (var killCmd = conn.CreateCommand())
                {
                    killCmd.CommandText = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid();";
                    killCmd.Parameters.AddWithValue("db", dbName);
                    await killCmd.ExecuteNonQueryAsync(cancellationToken);
                }

                // db name cannot be parameterized; validated above + quote
                await using (var dropCmd = conn.CreateCommand())
                {
                    dropCmd.CommandText = $"DROP DATABASE IF EXISTS \"{dbName}\"";
                    await dropCmd.ExecuteNonQueryAsync(cancellationToken);
                }
            }

            var enabledRows = await _masterDb.TenantEnabledPages
                .Where(x => x.TenantId == id)
                .ToListAsync(cancellationToken);

            if (enabledRows.Count > 0)
            {
                _masterDb.TenantEnabledPages.RemoveRange(enabledRows);
            }

            _masterDb.Tenants.Remove(tenant);
            await _masterDb.SaveChangesAsync(cancellationToken);

            // remove tenant assets (best-effort)
            if (!string.IsNullOrWhiteSpace(tenantCode))
            {
                try
                {
                    var folder = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "tenant-assets", tenantCode);
                    if (Directory.Exists(folder)) Directory.Delete(folder, true);
                }
                catch
                {
                    // ignore
                }
            }

            await tx.CommitAsync(cancellationToken);
            return Ok(new { success = true });
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync(cancellationToken);
            return StatusCode(500, new { success = false, message = "Firma silinirken hata oluştu", details = ex.Message });
        }
    }
}
