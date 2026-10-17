using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class SessionSettingsController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly IConfiguration _configuration;

    public SessionSettingsController(AppDbContext dbContext, IConfiguration configuration)
    {
        _dbContext = dbContext;
        _configuration = configuration;
    }

    public sealed class SessionSettingsDto
    {
        public int? AccessTokenExpirationMinutes { get; set; }
        public int? AlertBeforeMinutes { get; set; }
        public int? CampaignGiftAccountingMode { get; set; }
        public decimal? CampaignGiftSymbolicPrice { get; set; }
        public DateTime? InvoiceDeleteLockDate { get; set; }

        /// <summary>
        /// Silme kilidini KALDIRMA niyetini açıkça bildirir.
        ///
        /// Alanın kendisi boş gelince "kilidi kaldır" saymak, ayarların yalnız bir bölümünü
        /// gönderen ekranlarda kilidi sessizce siliyordu (kampanya ayarları ekranı dört alan
        /// gönderiyor). Diğer alanlar zaten "gönderilmediyse dokunma" davranışında; kilit
        /// tarihi de artık öyle. Kaldırmak isteyen ekran bu bayrağı açıkça gönderir.
        /// </summary>
        public bool? ClearInvoiceDeleteLockDate { get; set; }

        /// <summary>Fatura Takip başlangıç günü. Kilit tarihiyle aynı "gönderilmediyse dokunma" kuralı.</summary>
        public DateTime? InvoiceTrackingStartDate { get; set; }
        public bool? ClearInvoiceTrackingStartDate { get; set; }
    }

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        await EnsureTableExistsAsync(cancellationToken);
        var entity = await _dbContext.Set<JwtSessionSetting>().AsNoTracking().OrderBy(x => x.Id).FirstOrDefaultAsync(cancellationToken);

        if (entity is null)
        {
            var defaultMinutes = ParsePositiveInt(_configuration["JwtSettings:AccessTokenExpirationMinutes"], 60);
            entity = new JwtSessionSetting
            {
                AccessTokenExpirationMinutes = defaultMinutes,
                AlertBeforeMinutes = 3,
                CampaignGiftAccountingMode = 2,
                CampaignGiftSymbolicPrice = 0.01m,
                UpdatedAtUtc = DateTime.UtcNow,
                UpdatedByUserId = ResolveUserId()
            };

            _dbContext.Set<JwtSessionSetting>().Add(entity);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return Ok(new
        {
            success = true,
            data = new SessionSettingsDto
            {
                AccessTokenExpirationMinutes = entity.AccessTokenExpirationMinutes,
                AlertBeforeMinutes = entity.AlertBeforeMinutes,
                CampaignGiftAccountingMode = entity.CampaignGiftAccountingMode,
                CampaignGiftSymbolicPrice = entity.CampaignGiftSymbolicPrice,
                InvoiceDeleteLockDate = entity.InvoiceDeleteLockDate,
                InvoiceTrackingStartDate = entity.InvoiceTrackingStartDate
            }
        });
    }

    [HttpPut]
    [AuthorizePage("users", "genelAyarlar")]
    [AuthorizePage("users", "rolYetkileri")]
    public async Task<IActionResult> Upsert([FromBody] SessionSettingsDto request, CancellationToken cancellationToken)
    {
        await EnsureTableExistsAsync(cancellationToken);

        var entity = await _dbContext.Set<JwtSessionSetting>().OrderBy(x => x.Id).FirstOrDefaultAsync(cancellationToken);
        if (entity is null)
        {
            var duration = request.AccessTokenExpirationMinutes.HasValue 
                ? Math.Max(1, Math.Min(24 * 60, request.AccessTokenExpirationMinutes.Value)) 
                : 60;
            var alert = request.AlertBeforeMinutes.HasValue 
                ? Math.Max(0, Math.Min(duration - 1, request.AlertBeforeMinutes.Value)) 
                : 3;

            entity = new JwtSessionSetting 
            { 
                AccessTokenExpirationMinutes = duration, 
                AlertBeforeMinutes = alert,
                CampaignGiftAccountingMode = request.CampaignGiftAccountingMode ?? 2,
                CampaignGiftSymbolicPrice = request.CampaignGiftSymbolicPrice ?? 0.01m,
                InvoiceDeleteLockDate = request.InvoiceDeleteLockDate,
                InvoiceTrackingStartDate = request.InvoiceTrackingStartDate
            };
            _dbContext.Set<JwtSessionSetting>().Add(entity);
        }
        else
        {
            if (request.AccessTokenExpirationMinutes.HasValue)
            {
                entity.AccessTokenExpirationMinutes = Math.Max(1, Math.Min(24 * 60, request.AccessTokenExpirationMinutes.Value));
            }
            if (request.AlertBeforeMinutes.HasValue)
            {
                entity.AlertBeforeMinutes = Math.Max(0, Math.Min(entity.AccessTokenExpirationMinutes - 1, request.AlertBeforeMinutes.Value));
            }
            if (request.CampaignGiftAccountingMode.HasValue)
            {
                entity.CampaignGiftAccountingMode = request.CampaignGiftAccountingMode.Value;
            }
            if (request.CampaignGiftSymbolicPrice.HasValue)
            {
                entity.CampaignGiftSymbolicPrice = request.CampaignGiftSymbolicPrice.Value;
            }
            // KİLİT TARİHİ "GÖNDERİLMEDİYSE DOKUNMA" KURALINA BAĞLANDI (kardeşleri gibi).
            // Öncesinde koşulsuz atanıyordu: ayarların yalnız bir bölümünü gönderen her ekran
            // (ör. kampanya ayarları) kilidi sessizce NULL yapıyordu — yani geçmiş dönem
            // belgelerini silmeye karşı konan koruma, alakasız bir kaydetme ile kalkıyordu.
            if (request.InvoiceDeleteLockDate.HasValue)
            {
                entity.InvoiceDeleteLockDate = request.InvoiceDeleteLockDate;
            }
            else if (request.ClearInvoiceDeleteLockDate == true)
            {
                entity.InvoiceDeleteLockDate = null;
            }

            if (request.InvoiceTrackingStartDate.HasValue)
            {
                entity.InvoiceTrackingStartDate = DateTime.SpecifyKind(request.InvoiceTrackingStartDate.Value.Date, DateTimeKind.Utc);
            }
            else if (request.ClearInvoiceTrackingStartDate == true)
            {
                entity.InvoiceTrackingStartDate = null;
            }
        }

        entity.UpdatedAtUtc = DateTime.UtcNow;
        entity.UpdatedByUserId = ResolveUserId();

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpGet("system-time")]
    public IActionResult GetSystemTime()
    {
        return Ok(new
        {
            success = true,
            overrideTimeUtc = B2B.Erp.Api.Core.Helpers.SystemTime.OverrideTimeUtc,
            currentTimeUtc = B2B.Erp.Api.Core.Helpers.SystemTime.UtcNow
        });
    }

    [HttpPost("system-time")]
    [AuthorizePage("users", "genelAyarlar")]
    public IActionResult SetSystemTime([FromBody] SystemTimeOverrideRequest request)
    {
        if (request == null) return BadRequest(new { success = false, message = "Geçersiz istek." });

        // SAAT KAYDIRMASI SÜREÇ GENELİNDEDİR, FİRMAYA ÖZEL DEĞİL. `SystemTime.SetOverride`
        // static bir değer yazıyor: bir firmanın yöneticisi test için saati kaydırdığında
        // AYNI SUNUCUDAKİ BÜTÜN firmaların tarihleri kayıyor (fatura tarihi, dönem kontrolü,
        // POS süpürme saati hepsi bu saati okuyor). Sayfa yetkisi firma yöneticisinde de var;
        // bu yüzden işlem SSA/süper admine bağlandı.
        var canOverrideTime = User.FindFirst("IsSuperSuperAdmin")?.Value == "1"
                              || User.FindFirst("IsSuperAdmin")?.Value == "1";

        if (!canOverrideTime)
        {
            return Forbid();
        }

        B2B.Erp.Api.Core.Helpers.SystemTime.SetOverride(request.OverrideTimeUtc);

        return Ok(new
        {
            success = true,
            overrideTimeUtc = B2B.Erp.Api.Core.Helpers.SystemTime.OverrideTimeUtc,
            currentTimeUtc = B2B.Erp.Api.Core.Helpers.SystemTime.UtcNow
        });
    }

    public sealed class SystemTimeOverrideRequest
    {
        public DateTime? OverrideTimeUtc { get; set; }
    }

    private int? ResolveUserId()
    {
        var raw = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return int.TryParse(raw, out var id) ? id : null;
    }

    private static int ParsePositiveInt(string? raw, int fallback)
    {
        var text = (raw ?? string.Empty).Trim();
        if (int.TryParse(text, out var v) && v > 0) return v;
        return fallback;
    }

    private async Task EnsureTableExistsAsync(CancellationToken cancellationToken)
    {
        await _dbContext.Database.ExecuteSqlRawAsync(@"
CREATE TABLE IF NOT EXISTS public.""JwtSessionSettings"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""AccessTokenExpirationMinutes"" integer NOT NULL,
  ""AlertBeforeMinutes"" integer NOT NULL,
  ""UpdatedAtUtc"" timestamp with time zone NOT NULL,
  ""UpdatedByUserId"" integer NULL,
  CONSTRAINT ""PK_JwtSessionSettings"" PRIMARY KEY (""Id"")
);
ALTER TABLE public.""JwtSessionSettings"" ADD COLUMN IF NOT EXISTS ""CampaignGiftAccountingMode"" integer NOT NULL DEFAULT 0;
ALTER TABLE public.""JwtSessionSettings"" ADD COLUMN IF NOT EXISTS ""CampaignGiftSymbolicPrice"" numeric NOT NULL DEFAULT 0.16;
ALTER TABLE public.""JwtSessionSettings"" ADD COLUMN IF NOT EXISTS ""InvoiceDeleteLockDate"" timestamp with time zone NULL;
ALTER TABLE public.""JwtSessionSettings"" ADD COLUMN IF NOT EXISTS ""InvoiceTrackingStartDate"" timestamp with time zone NULL;
", cancellationToken);
    }
}
