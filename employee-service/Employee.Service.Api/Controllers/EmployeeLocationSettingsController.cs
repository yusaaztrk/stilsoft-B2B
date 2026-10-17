using System;
using System.Threading;
using System.Threading.Tasks;
using System.ComponentModel.DataAnnotations;
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
[AuthorizePage("employee", "calisan")]
[AuthorizePage("users", "calisan")]
public sealed class EmployeeLocationSettingsController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public EmployeeLocationSettingsController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public sealed class SaveRequest
    {
        /// <summary>Var olan konumu günceller; 0/boş ise yeni konum açar.</summary>
        public int Id { get; set; }

        [Required(ErrorMessage = "Konum adı gereklidir.")]
        [StringLength(100)]
        public string Name { get; set; } = string.Empty;

        [Range(-90.0, 90.0, ErrorMessage = "Geçersiz enlem değeri.")]
        public decimal Latitude { get; set; }

        [Range(-180.0, 180.0, ErrorMessage = "Geçersiz boylam değeri.")]
        public decimal Longitude { get; set; }

        [Range(1.0, 1000000.0, ErrorMessage = "İzin verilen maksimum mesafe en az 1 metre olmalıdır.")]
        public double MaxDistanceInMeters { get; set; }

        public bool IsActive { get; set; }

        /// <summary>Bölge dışından çıkışa izin (konum yine zorunlu, çıkış işaretlenir).</summary>
        public bool AllowOffsiteCheckOut { get; set; }
    }

    /// <summary>
    /// Tanımlı tüm konumlar. Tek kayıt döndüren sürümdü; firmanın birden fazla noktası olduğu
    /// için listeye çevrildi. Hiç konum yoksa boş liste döner — eski sürüm sahte bir "0
    /// numaralı" kayıt uydurup ekranı yanıltıyordu.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        var data = await _dbContext.Set<EmployeeLocationSetting>()
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .Select(x => new
            {
                x.Id,
                x.Name,
                x.Latitude,
                x.Longitude,
                x.MaxDistanceInMeters,
                x.IsActive,
                x.AllowOffsiteCheckOut,
                employeeCount = _dbContext.Employees.Count(e => e.LocationSettingId == x.Id && e.IsActive)
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    /// <summary>Konum ekler ya da günceller.</summary>
    [HttpPost]
    public async Task<IActionResult> Save([FromBody] SaveRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var now = DateTime.UtcNow;
        var userName = User.Identity?.Name ?? "System";

        EmployeeLocationSetting? setting = null;
        if (request.Id > 0)
        {
            setting = await _dbContext.Set<EmployeeLocationSetting>()
                .FirstOrDefaultAsync(x => x.Id == request.Id, cancellationToken);

            if (setting is null) return NotFound(new { success = false, message = "Konum bulunamadı." });
        }

        if (setting is null)
        {
            setting = new EmployeeLocationSetting
            {
                Name = request.Name.Trim(),
                Latitude = request.Latitude,
                Longitude = request.Longitude,
                MaxDistanceInMeters = Math.Max(1, request.MaxDistanceInMeters),
                IsActive = request.IsActive,
                AllowOffsiteCheckOut = request.AllowOffsiteCheckOut,
                CreateUser = userName,
                CreateTime = now
            };
            _dbContext.Set<EmployeeLocationSetting>().Add(setting);
        }
        else
        {
            setting.Name = request.Name.Trim();
            setting.Latitude = request.Latitude;
            setting.Longitude = request.Longitude;
            setting.MaxDistanceInMeters = Math.Max(1, request.MaxDistanceInMeters);
            setting.IsActive = request.IsActive;
            setting.AllowOffsiteCheckOut = request.AllowOffsiteCheckOut;
            setting.EditUser = userName;
            setting.EditTime = now;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, data = setting });
    }

    /// <summary>
    /// ŞÜPHELİ İŞLEMLER (2026-10-16): sahte konum izleri (bkz. AttendanceSuspicionDetector).
    /// Varsayılan: son 30 gün, incelenmemişler. Konum ayarları ekranında listelenir.
    /// </summary>
    [HttpGet("suspicions")]
    public async Task<IActionResult> Suspicions([FromQuery] int days = 30, [FromQuery] bool includeReviewed = false, CancellationToken cancellationToken = default)
    {
        days = Math.Clamp(days, 1, 366);
        var since = DateTime.UtcNow.AddDays(-days);

        var q = _dbContext.EmployeeAttendanceSuspicions.AsNoTracking().Where(x => x.CreateTime >= since);
        if (!includeReviewed) q = q.Where(x => x.ReviewedAt == null);

        var rows = await (
            from s in q
            join e in _dbContext.Employees.AsNoTracking() on s.EmployeeId equals e.Id into ej
            from e in ej.DefaultIfEmpty()
            orderby s.CreateTime descending
            select new
            {
                s.Id,
                s.EmployeeId,
                employeeName = e != null ? (e.FirstName + " " + e.LastName).Trim() : "",
                employeeCode = e != null ? e.EmployeeCode : "",
                s.CheckInId,
                s.EventKind,
                s.RuleCode,
                s.Detail,
                s.Source,
                s.Latitude,
                s.Longitude,
                s.Accuracy,
                s.CreateTime,
                s.ReviewedBy,
                s.ReviewedAt,
                s.ReviewNote
            })
            .Take(1000)
            .ToListAsync(cancellationToken);

        var data = rows.Select(x => new
        {
            x.Id,
            x.EmployeeId,
            x.employeeName,
            x.employeeCode,
            x.CheckInId,
            x.EventKind,
            x.RuleCode,
            ruleLabel = Core.Services.AttendanceSuspicionDetector.RuleLabel(x.RuleCode),
            x.Detail,
            x.Source,
            x.Latitude,
            x.Longitude,
            x.Accuracy,
            x.CreateTime,
            x.ReviewedBy,
            x.ReviewedAt,
            x.ReviewNote
        });

        return Ok(new { success = true, data });
    }

    public sealed class ReviewRequest
    {
        [StringLength(500)]
        public string? Note { get; set; }
    }

    /// <summary>Şüpheli işlemi "incelendi" işaretler; liste varsayılan olarak incelenmemişleri gösterir.</summary>
    [HttpPost("suspicions/{id:int}/review")]
    public async Task<IActionResult> ReviewSuspicion([FromRoute] int id, [FromBody] ReviewRequest? request, CancellationToken cancellationToken)
    {
        var row = await _dbContext.EmployeeAttendanceSuspicions.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (row is null) return NotFound(new { success = false, message = "Kayıt bulunamadı." });

        var user = User.Identity?.Name ?? "System";
        row.ReviewedBy = user.Length <= 50 ? user : user[..50];
        row.ReviewedAt = DateTime.UtcNow;
        row.ReviewNote = string.IsNullOrWhiteSpace(request?.Note) ? null : request!.Note!.Trim();
        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    /// <summary>
    /// Konumu siler. Konuma bağlı personel varsa silmez — sessizce silmek o personelleri
    /// "konumsuz" bırakır ve herhangi bir noktadan giriş yapabilir hâle getirirdi.
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        var setting = await _dbContext.Set<EmployeeLocationSetting>()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (setting is null) return NotFound(new { success = false, message = "Konum bulunamadı." });

        var assigned = await _dbContext.Employees
            .CountAsync(x => x.LocationSettingId == id && x.IsActive, cancellationToken);

        if (assigned > 0)
        {
            return BadRequest(new
            {
                success = false,
                message = $"Bu konuma bağlı {assigned} personel var. Önce başka konuma taşıyın."
            });
        }

        _dbContext.Set<EmployeeLocationSetting>().Remove(setting);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, message = "Konum silindi." });
    }

    public sealed class AssignRequest
    {
        public List<int> EmployeeIds { get; set; } = new();

        /// <summary>NULL ise atama kaldırılır; personel aktif konumların herhangi birinden girer.</summary>
        public int? LocationSettingId { get; set; }
    }

    /// <summary>Seçilen personelleri bir konuma bağlar.</summary>
    [HttpPost("assign")]
    public async Task<IActionResult> Assign([FromBody] AssignRequest request, CancellationToken cancellationToken)
    {
        var ids = (request.EmployeeIds ?? new List<int>()).Where(x => x > 0).Distinct().ToList();
        if (ids.Count == 0) return BadRequest(new { success = false, message = "Personel seçilmedi." });

        if (request.LocationSettingId is > 0)
        {
            var exists = await _dbContext.Set<EmployeeLocationSetting>()
                .AnyAsync(x => x.Id == request.LocationSettingId.Value, cancellationToken);
            if (!exists) return BadRequest(new { success = false, message = "Konum bulunamadı." });
        }

        var employees = await _dbContext.Employees.Where(x => ids.Contains(x.Id)).ToListAsync(cancellationToken);
        foreach (var e in employees)
        {
            e.LocationSettingId = request.LocationSettingId is > 0 ? request.LocationSettingId : null;
            e.EditUser = User.Identity?.Name ?? "System";
            e.EditTime = DateTime.UtcNow;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, updatedCount = employees.Count });
    }
}
