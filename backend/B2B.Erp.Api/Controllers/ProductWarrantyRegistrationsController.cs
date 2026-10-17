using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.RegularExpressions;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/product-warranty-registrations")]
[Authorize]
public sealed class ProductWarrantyRegistrationsController : ControllerBase
{

    private readonly AppDbContext _dbContext;


    /// <summary>
    /// FİRMANIN SAATİ (2026-08-20 kullanıcı kararı, denetim md. D1). "Bugün" UTC takvim
    /// gününden okunuyordu; KKTC (UTC+3) gibi bir yerde yerel 00:00–03:00 arasında yapılan
    /// işlem BİR ÖNCEKİ güne damgalanıyordu.
    /// </summary>
    private readonly B2B.Erp.Api.Core.Helpers.CompanyClock _clock;

    public ProductWarrantyRegistrationsController(
        AppDbContext dbContext,
        B2B.Erp.Api.Core.Helpers.CompanyClock clock)
    {
        _dbContext = dbContext;
        _clock = clock;
    }

    [HttpGet]
    [AuthorizePage("reports", "garantiKayitlari")]
    public async Task<IActionResult> GetRegistrations(
        [FromQuery] string? search,
        CancellationToken cancellationToken = default)
    {
        var query = _dbContext.ProductWarrantyRegistrations.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLower();
            query = query.Where(x =>
                x.ProductCode.ToLower().Contains(s) ||
                x.ProductName.ToLower().Contains(s) ||
                x.SerialNumber.ToLower().Contains(s) ||
                x.CustomerFullName.ToLower().Contains(s) ||
                x.PhoneNumber.ToLower().Contains(s) ||
                (x.Email != null && x.Email.ToLower().Contains(s)) ||
                (x.City != null && x.City.ToLower().Contains(s)) ||
                x.CreateUser.ToLower().Contains(s));
        }

        var items = await query
            .OrderByDescending(x => x.CreateTime)
            .ThenByDescending(x => x.Id)
            .Take(1000)
            .Select(x => new ProductWarrantyRegistrationDto(
                x.Id,
                x.ProductId,
                x.ProductCode,
                x.ProductName,
                x.SerialNumber,
                x.CustomerFullName,
                x.PhoneNumber,
                x.Email,
                x.City,
                x.Description,
                x.WarrantyStartDate,
                x.CreateUser,
                x.CreateTime))
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = items });
    }

    [HttpPost]
    [AuthorizePage("reports", "garantiFormu")]
    public async Task<IActionResult> CreateRegistration(
        [FromBody] CreateProductWarrantyRegistrationRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Geçersiz veri." });
        }

        var serialNumber = (request.SerialNumber ?? string.Empty).Trim();
        var fullName = (request.CustomerFullName ?? string.Empty).Trim();
        var phone = (request.PhoneNumber ?? string.Empty).Trim();

        if (request.ProductId == Guid.Empty)
        {
            return BadRequest(new { success = false, message = "Ürün seçimi zorunludur." });
        }

        if (string.IsNullOrWhiteSpace(serialNumber) ||
            string.IsNullOrWhiteSpace(fullName) ||
            string.IsNullOrWhiteSpace(phone))
        {
            return BadRequest(new { success = false, message = "Seri numarası, ad soyad ve telefon zorunludur." });
        }

        if (!B2B.Erp.Api.Core.Helpers.PhoneFormat.IsValid(phone))
        {
            return BadRequest(new { success = false, message = B2B.Erp.Api.Core.Helpers.PhoneFormat.Message });
        }

        var product = await _dbContext.Products
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == request.ProductId, cancellationToken);

        if (product is null)
        {
            return BadRequest(new { success = false, message = "Ürün bulunamadı." });
        }

        // Kullanıcının girdiği garanti başlangıcı KULLANILIR. İstek DTO'sunda alan vardı ama
        // yok sayılıp daima bugün yazılıyordu: altı ay önceki fatura tarihiyle açılan kayıt,
        // müşteriye altı ay fazla garanti süresi tanıyordu. Gelecek tarih kabul edilmez —
        // henüz satılmamış bir ürüne garanti başlatmak kaydı ileriye taşımak olurdu.
        var today = _clock.TodayCompanyDate();
        var startDate = request.WarrantyStartDate.HasValue
            ? request.WarrantyStartDate.Value.Date
            : today;

        if (startDate > today) startDate = today;

        var username = GetCurrentUserName();

        var registration = new ProductWarrantyRegistration
        {
            ProductId = product.Id,
            ProductCode = product.StockCode,
            ProductName = product.Name,
            SerialNumber = serialNumber,
            CustomerFullName = fullName,
            PhoneNumber = phone,
            Email = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim(),
            City = string.IsNullOrWhiteSpace(request.City) ? null : request.City.Trim(),
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            WarrantyStartDate = DateTime.SpecifyKind(startDate, DateTimeKind.Utc),
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        };

        _dbContext.ProductWarrantyRegistrations.Add(registration);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, data = registration });
    }

    [HttpPut("{id:int}")]
    [AuthorizePage("reports", "garantiKayitlari")]
    public async Task<IActionResult> UpdateRegistration(
        [FromRoute] int id,
        [FromBody] UpdateProductWarrantyRegistrationRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Geçersiz veri." });
        }

        var registration = await _dbContext.ProductWarrantyRegistrations
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (registration is null)
        {
            return NotFound(new { success = false, message = "Garanti kaydı bulunamadı." });
        }

        var serialNumber = (request.SerialNumber ?? string.Empty).Trim();
        var fullName = (request.CustomerFullName ?? string.Empty).Trim();
        var phone = (request.PhoneNumber ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(serialNumber) ||
            string.IsNullOrWhiteSpace(fullName) ||
            string.IsNullOrWhiteSpace(phone))
        {
            return BadRequest(new { success = false, message = "Seri numarası, ad soyad ve telefon zorunludur." });
        }

        if (!B2B.Erp.Api.Core.Helpers.PhoneFormat.IsValid(phone))
        {
            return BadRequest(new { success = false, message = B2B.Erp.Api.Core.Helpers.PhoneFormat.Message });
        }

        if (request.ProductId.HasValue && request.ProductId.Value != Guid.Empty && request.ProductId.Value != registration.ProductId)
        {
            var product = await _dbContext.Products
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == request.ProductId.Value, cancellationToken);

            if (product is not null)
            {
                registration.ProductId = product.Id;
                registration.ProductCode = product.StockCode;
                registration.ProductName = product.Name;
            }
        }

        registration.SerialNumber = serialNumber;
        registration.CustomerFullName = fullName;
        registration.PhoneNumber = phone;
        registration.Email = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim();
        registration.City = string.IsNullOrWhiteSpace(request.City) ? null : request.City.Trim();
        registration.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, data = registration });
    }

    [HttpDelete("{id:int}")]
    [AuthorizePage("reports", "garantiKayitlari")]
    public async Task<IActionResult> DeleteRegistration(
        [FromRoute] int id,
        CancellationToken cancellationToken = default)
    {
        var registration = await _dbContext.ProductWarrantyRegistrations
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (registration is null)
        {
            return NotFound(new { success = false, message = "Garanti kaydı bulunamadı." });
        }

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, registration, "deleteRule/garantiKayit", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        _dbContext.ProductWarrantyRegistrations.Remove(registration);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, message = "Garanti kaydı başarıyla silindi." });
    }

    private string GetCurrentUserName()
    {
        return User.FindFirstValue(ClaimTypes.Name)
            ?? User.FindFirstValue("unique_name")
            ?? User.FindFirstValue("name")
            ?? User.Identity?.Name
            ?? "System";
    }

    public sealed record CreateProductWarrantyRegistrationRequest(
        Guid ProductId,
        string? SerialNumber,
        string? CustomerFullName,
        string? PhoneNumber,
        string? Email,
        string? City,
        string? Description,
        DateTime? WarrantyStartDate);

    public sealed record UpdateProductWarrantyRegistrationRequest(
        Guid? ProductId,
        string? SerialNumber,
        string? CustomerFullName,
        string? PhoneNumber,
        string? Email,
        string? City,
        string? Description);

    public sealed record ProductWarrantyRegistrationDto(
        int Id,
        Guid ProductId,
        string ProductCode,
        string ProductName,
        string SerialNumber,
        string CustomerFullName,
        string PhoneNumber,
        string? Email,
        string? City,
        string? Description,
        DateTime WarrantyStartDate,
        string CreateUser,
        DateTime CreateTime);
}
