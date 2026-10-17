using System;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers
{
    [ApiController]
    [Route("api/system-error-logs")]
    [Authorize]
    public sealed class SystemErrorLogsController : ControllerBase
    {
        private readonly AppDbContext _dbContext;

        public SystemErrorLogsController(AppDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        [HttpGet]
        [AuthorizePage("users", "systemErrorLogs")]
        public async Task<IActionResult> GetAll(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 50,
            [FromQuery] bool? isResolved = null,
            [FromQuery] string? search = null,
            [FromQuery] string? sourceModule = null,
            CancellationToken cancellationToken = default)
        {
            try
            {
                await EnsureTableExistsAsync();

                var query = _dbContext.SystemErrorLogs.AsNoTracking().AsQueryable();

                if (isResolved.HasValue)
                {
                    query = query.Where(x => x.IsResolved == isResolved.Value);
                }

                if (!string.IsNullOrWhiteSpace(sourceModule))
                {
                    query = query.Where(x => x.SourceModule.ToLower() == sourceModule.Trim().ToLower());
                }

                if (!string.IsNullOrWhiteSpace(search))
                {
                    var s = search.Trim().ToLower();
                    query = query.Where(x =>
                        x.Username.ToLower().Contains(s) ||
                        x.UserDisplayName.ToLower().Contains(s) ||
                        x.ErrorMessage.ToLower().Contains(s) ||
                        x.ExceptionType.ToLower().Contains(s) ||
                        x.RequestPath.ToLower().Contains(s) ||
                        (x.InnerExceptionMessage != null && x.InnerExceptionMessage.ToLower().Contains(s))
                    );
                }

                var totalCount = await query.CountAsync(cancellationToken);
                var items = await query
                    .OrderByDescending(x => x.CreatedAt)
                    .Skip((page - 1) * pageSize)
                    .Take(pageSize)
                    .ToListAsync(cancellationToken);

                return Ok(new
                {
                    success = true,
                    totalCount,
                    page,
                    pageSize,
                    items
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { success = false, message = ex.Message });
            }
        }

        [HttpPost("client")]
        [AllowAnonymous]
        // Kimlik istemeyen YAZMA ucu: dışarıdan sınırsız çağrılabildiği için hata tablosu
        // (ve dolayısıyla disk) şişirilebiliyordu. Sınır cömert — bozuk bir sayfanın hata
        // yağmuru meşru olabilir, amaç otomatik kötüye kullanımı kırmak.
        [Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("public")]
        public async Task<IActionResult> CreateClientLog([FromBody] ClientErrorPayload? payload, CancellationToken cancellationToken)
        {
            try
            {
                if (payload == null) return Ok(new { success = false, message = "Payload is null" });

                await EnsureTableExistsAsync();

                var username = User.FindFirst("username")?.Value
                    ?? User.FindFirst(ClaimTypes.Name)?.Value
                    ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                    ?? "Anonim";
                var displayName = User.FindFirst("unvan")?.Value
                    ?? User.FindFirst("Unvan")?.Value
                    ?? User.FindFirst("fullName")?.Value
                    ?? User.FindFirst("name")?.Value
                    ?? username;
                var roleName = User.FindFirst("role")?.Value ?? User.FindFirst(ClaimTypes.Role)?.Value ?? string.Empty;
                var cariKodu = User.FindFirst("cariKodu")?.Value ?? User.FindFirst("CariKodu")?.Value;
                int? userId = null;
                var userIdClaim = User.FindFirst("id")?.Value ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                if (int.TryParse(userIdClaim, out var parsedUserId)) userId = parsedUserId;

                var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? string.Empty;
                if (Request.Headers.TryGetValue("X-Forwarded-For", out var fwd))
                {
                    ip = fwd.ToString().Split(',')[0].Trim();
                }

                var tenantCode = Request.Headers["X-Tenant-Code"].FirstOrDefault()
                    ?? User.FindFirst("TenantCode")?.Value
                    ?? User.FindFirst("tenantCode")?.Value
                    ?? "DEMO";

                var message = string.IsNullOrWhiteSpace(payload.Message) ? "Frontend client error" : payload.Message.Trim();
                var details = string.Join("\n", new[]
                {
                    string.IsNullOrWhiteSpace(payload.Source) ? null : "Source: " + payload.Source,
                    string.IsNullOrWhiteSpace(payload.Url) ? null : "Url: " + payload.Url,
                    string.IsNullOrWhiteSpace(payload.UserAgent) ? null : "UserAgent: " + payload.UserAgent,
                    string.IsNullOrWhiteSpace(payload.Stack) ? null : payload.Stack
                }.Where(x => !string.IsNullOrWhiteSpace(x)));

                var log = new SystemErrorLog
                {
                    CreatedAt = DateTime.UtcNow,
                    LocalTime = DateTime.UtcNow,
                    UserId = userId,
                    Username = username,
                    UserDisplayName = displayName,
                    RoleName = roleName,
                    CariKodu = cariKodu,
                    UserIp = ip,
                    HttpMethod = "CLIENT",
                    RequestPath = string.IsNullOrWhiteSpace(payload.Url) ? Request.Path.Value ?? string.Empty : payload.Url,
                    QueryString = null,
                    RequestBodySummary = null,
                    ExceptionType = string.IsNullOrWhiteSpace(payload.Level) ? "ClientError" : "Client." + payload.Level.Trim(),
                    ErrorMessage = message.Length > 4000 ? message.Substring(0, 4000) + "..." : message,
                    InnerExceptionMessage = details.Length > 4000 ? details.Substring(0, 4000) + "..." : details,
                    StackTrace = string.IsNullOrWhiteSpace(payload.Stack) ? null : payload.Stack,
                    StatusCode = 0,
                    SourceModule = "Client.Console",
                    TenantCode = tenantCode,
                    IsResolved = false
                };

                _dbContext.SystemErrorLogs.Add(log);
                await _dbContext.SaveChangesAsync(cancellationToken);

                return Ok(new { success = true, id = log.Id });
            }
            catch (Exception ex)
            {
                return Ok(new { success = false, message = ex.Message });
            }
        }

        [HttpGet("{id:long}")]
        [AuthorizePage("users", "systemErrorLogs")]
        public async Task<IActionResult> GetById(long id, CancellationToken cancellationToken)
        {
            var log = await _dbContext.SystemErrorLogs.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
            if (log == null) return NotFound(new { success = false, message = "Hata kaydı bulunamadı." });

            return Ok(new { success = true, data = log });
        }

        [HttpPut("{id:long}/resolve")]
        [AuthorizePage("users", "systemErrorLogs")]
        public async Task<IActionResult> Resolve(long id, [FromBody] ResolvePayload payload, CancellationToken cancellationToken)
        {
            var log = await _dbContext.SystemErrorLogs.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
            if (log == null) return NotFound(new { success = false, message = "Hata kaydı bulunamadı." });

            var username = User.FindFirst("username")?.Value 
                ?? User.FindFirst(ClaimTypes.Name)?.Value 
                ?? User.FindFirst("unvan")?.Value 
                ?? "Admin";

            log.IsResolved = payload.IsResolved;
            log.ResolutionNotes = payload.ResolutionNotes;
            log.ResolvedAt = payload.IsResolved ? DateTime.UtcNow : null;
            log.ResolvedBy = payload.IsResolved ? username : null;

            await _dbContext.SaveChangesAsync(cancellationToken);

            return Ok(new { success = true, message = log.IsResolved ? "Hata çözüldü olarak işaretlendi." : "Hata durumu güncellendi.", data = log });
        }

        [HttpDelete("{id:long}")]
        [AuthorizePage("users", "systemErrorLogs")]
        public async Task<IActionResult> Delete(long id, CancellationToken cancellationToken)
        {
            var log = await _dbContext.SystemErrorLogs.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
            if (log == null) return NotFound(new { success = false, message = "Hata kaydı bulunamadı." });

            _dbContext.SystemErrorLogs.Remove(log);
            await _dbContext.SaveChangesAsync(cancellationToken);

            return Ok(new { success = true, message = "Hata kaydı silindi." });
        }

        [HttpDelete("clear-resolved")]
        [AuthorizePage("users", "systemErrorLogs")]
        public async Task<IActionResult> ClearResolved(CancellationToken cancellationToken)
        {
            // Kayıtlar önce belleğe çekilip sonra tek tek siliniyordu; hata tablosu yüz binlerce
            // satıra çıkabildiği için bu isteğin kendisi bellek şişirip zaman aşımına düşüyordu.
            var deleted = await _dbContext.SystemErrorLogs
                .Where(x => x.IsResolved)
                .ExecuteDeleteAsync(cancellationToken);

            return Ok(new { success = true, message = $"{deleted} adet çözülmüş hata kaydı temizlendi." });
        }

        [HttpDelete("clear-all")]
        [AuthorizePage("users", "systemErrorLogs")]
        public async Task<IActionResult> ClearAll(CancellationToken cancellationToken)
        {
            // Aynı sebeple toplu silme SQL tarafında yapılıyor (bkz. ClearResolved).
            var deleted = await _dbContext.SystemErrorLogs.ExecuteDeleteAsync(cancellationToken);

            return Ok(new { success = true, message = $"Tüm hata kayıtları temizlendi ({deleted} kayıt)." });
        }

        // Şema DDL'i her listeleme isteğinde değil, veritabanı başına bir kez çalışır —
        // bkz. B2B.Erp.Api.Core.Services.SystemErrorLogSchema.
        private Task EnsureTableExistsAsync()
            => B2B.Erp.Api.Core.Services.SystemErrorLogSchema.EnsureAsync(_dbContext);

        public sealed class ClientErrorPayload
        {
            public string? Level { get; set; }
            public string? Message { get; set; }
            public string? Stack { get; set; }
            public string? Source { get; set; }
            public string? Url { get; set; }
            public string? UserAgent { get; set; }
        }

        public sealed class ResolvePayload
        {
            public bool IsResolved { get; set; } = true;
            public string? ResolutionNotes { get; set; }
        }
    }
}
