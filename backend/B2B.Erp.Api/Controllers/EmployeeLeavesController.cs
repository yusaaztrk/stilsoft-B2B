using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Employees;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[AuthorizePage("employee", "calisan")]
public sealed class EmployeeLeavesController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public EmployeeLeavesController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    private static DateTime NormalizeUtc(DateTime dt)
    {
        if (dt == default) return DateTime.UtcNow;
        return dt.Kind == DateTimeKind.Utc ? dt : DateTime.SpecifyKind(dt, DateTimeKind.Utc);
    }

    private string GetUsername()
    {
        var username = User.FindFirst(ClaimTypes.Name)?.Value;
        return string.IsNullOrWhiteSpace(username) ? "System" : username;
    }

    [HttpGet("by-employee/{employeeId:int}")]
    public async Task<IActionResult> ByEmployee([FromRoute] int employeeId, [FromQuery] int take = 500, CancellationToken cancellationToken = default)
    {
        if (employeeId <= 0) return BadRequest(new { success = false, message = "Geçersiz çalışan" });
        take = Math.Clamp(take, 1, 2000);

        var data = await _dbContext.Set<EmployeeLeave>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId)
            .OrderByDescending(x => x.LeaveStartTime)
            .ThenByDescending(x => x.Id)
            .Take(take)
            .Select(x => new EmployeeLeaveListItemResponse
            {
                Id = x.Id,
                EmployeeId = x.EmployeeId,
                LeaveStartTime = x.LeaveStartTime,
                ReturnTime = x.ReturnTime,
                Description = x.Description,
                CreateUser = x.CreateUser,
                CreateTime = x.CreateTime
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateEmployeeLeaveRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        if (request.EmployeeId <= 0) return BadRequest(new { success = false, message = "Geçersiz çalışan" });

        var start = NormalizeUtc(request.LeaveStartTime);
        var end = NormalizeUtc(request.ReturnTime);
        if (end <= start) return BadRequest(new { success = false, message = "Dönüş tarihi çıkış tarihinden büyük olmalıdır" });

        var employeeExists = await _dbContext.Employees.AsNoTracking().AnyAsync(x => x.Id == request.EmployeeId, cancellationToken);
        if (!employeeExists) return BadRequest(new { success = false, message = "Çalışan bulunamadı" });

        // ÇAKIŞAN İZİN ENGELLENİR (kullanıcı kararı, 2026-08-17).
        //
        // Aynı personele aynı günler için ikinci bir izin girilebiliyordu; puantaj ve hak ediş
        // o günleri iki kez sayıyordu. İki aralık, biri diğerinin bitişinden ÖNCE başlıyorsa
        // çakışır (`start < mevcut.Dönüş && mevcut.Başlangıç < end`); uç uca eklenen izinler
        // (birinin bitişi = diğerinin başlangıcı) çakışma sayılmaz.
        var overlapping = await _dbContext.Set<EmployeeLeave>()
            .AsNoTracking()
            .Where(x => x.EmployeeId == request.EmployeeId)
            .Where(x => start < x.ReturnTime && x.LeaveStartTime < end)
            .Select(x => new { x.LeaveStartTime, x.ReturnTime })
            .FirstOrDefaultAsync(cancellationToken);

        if (overlapping is not null)
        {
            return BadRequest(new
            {
                success = false,
                message = $"Bu personelin {overlapping.LeaveStartTime:dd.MM.yyyy} - {overlapping.ReturnTime:dd.MM.yyyy} tarihleri arasında zaten izni var. Tarihler çakışıyor."
            });
        }

        var now = DateTime.UtcNow;
        var username = GetUsername();

        var entity = new EmployeeLeave
        {
            EmployeeId = request.EmployeeId,
            LeaveStartTime = start,
            ReturnTime = end,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = username,
            CreateTime = now
        };

        _dbContext.Set<EmployeeLeave>().Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new { id = entity.Id } });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken = default)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz izin" });

        var entity = await _dbContext.Set<EmployeeLeave>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "İzin kaydı bulunamadı" });

        _dbContext.Set<EmployeeLeave>().Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }
}
