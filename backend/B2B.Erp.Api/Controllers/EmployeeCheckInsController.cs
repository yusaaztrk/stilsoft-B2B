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
public sealed class EmployeeCheckInsController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public EmployeeCheckInsController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet("by-employee/{employeeId:int}")]
    public async Task<IActionResult> GetByEmployee(
        [FromRoute] int employeeId,
        [FromQuery] int take = 200,
        CancellationToken cancellationToken = default)
    {
        if (employeeId <= 0) return BadRequest(new { success = false, message = "Geçersiz employeeId" });

        take = Math.Clamp(take, 1, 2000);

        var exists = await _dbContext.Employees
            .AsNoTracking()
            .AnyAsync(x => x.Id == employeeId, cancellationToken);

        if (!exists) return NotFound(new { success = false, message = "Çalışan bulunamadı" });

        var items = await _dbContext.EmployeeCheckIns
            .AsNoTracking()
            .Where(x => x.EmployeeId == employeeId)
            .OrderByDescending(x => x.CheckInTime)
            .Take(take)
            .Select(x => new EmployeeCheckInDtos.ListItemResponse
            {
                Id = x.Id,
                EmployeeId = x.EmployeeId,
                CheckInTime = x.CheckInTime,
                CheckOutTime = x.CheckOutTime,
                Latitude = x.Latitude,
                Longitude = x.Longitude,
                CheckOutLatitude = x.CheckOutLatitude,
                CheckOutLongitude = x.CheckOutLongitude,
                City = x.City,
                District = x.District,
                CreateUser = x.CreateUser,
                CreateTime = x.CreateTime
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = items });
    }

    [HttpPost("by-employee/{employeeId:int}")]
    public async Task<IActionResult> Create(
        [FromRoute] int employeeId,
        [FromBody] EmployeeCheckInDtos.UpsertRequest request,
        CancellationToken cancellationToken = default)
    {
        if (employeeId <= 0) return BadRequest(new { success = false, message = "Geçersiz employeeId" });

        var exists = await _dbContext.Employees
            .AsNoTracking()
            .AnyAsync(x => x.Id == employeeId, cancellationToken);

        if (!exists) return NotFound(new { success = false, message = "Çalışan bulunamadı" });

        var now = DateTime.UtcNow;
        var checkInTime = DateTime.SpecifyKind(request.CheckInTime, DateTimeKind.Utc);

        var entity = new EmployeeCheckIn
        {
            EmployeeId = employeeId,
            CheckInTime = checkInTime,
            Latitude = 0,
            Longitude = 0,
            City = null,
            District = null,
            CreateUser = User.Identity?.Name ?? "System",
            CreateTime = now
        };

        _dbContext.EmployeeCheckIns.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, data = new { id = entity.Id } });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(
        [FromRoute] int id,
        [FromBody] EmployeeCheckInDtos.UpsertRequest request,
        CancellationToken cancellationToken = default)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.EmployeeCheckIns.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        entity.CheckInTime = DateTime.SpecifyKind(request.CheckInTime, DateTimeKind.Utc);
        entity.EditUser = User.Identity?.Name ?? "System";
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPut("{id:int}/check-out")]
    public async Task<IActionResult> UpdateCheckOut(
        [FromRoute] int id,
        [FromBody] EmployeeCheckInDtos.UpsertCheckOutRequest request,
        CancellationToken cancellationToken = default)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.EmployeeCheckIns.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        var checkOut = DateTime.SpecifyKind(request.CheckOutTime, DateTimeKind.Utc);

        // Çıkış girişten önce olamaz. Kontrol yokken 09:00 girişli personele yanlışlıkla 08:00
        // çıkış yazıldığında puantaj negatif çalışma süresi hesaplıyordu.
        if (checkOut < entity.CheckInTime)
        {
            return BadRequest(new { success = false, message = "Çıkış saati giriş saatinden önce olamaz." });
        }

        entity.CheckOutTime = checkOut;
        if (request.CheckOutLatitude.HasValue) entity.CheckOutLatitude = request.CheckOutLatitude.Value;
        if (request.CheckOutLongitude.HasValue) entity.CheckOutLongitude = request.CheckOutLongitude.Value;
        entity.EditUser = User.Identity?.Name ?? "System";
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(
        [FromRoute] int id,
        CancellationToken cancellationToken = default)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.EmployeeCheckIns.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        _dbContext.EmployeeCheckIns.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }
}
