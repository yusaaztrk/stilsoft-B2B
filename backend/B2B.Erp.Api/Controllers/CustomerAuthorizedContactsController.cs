using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.CustomerAuthorizedContacts;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class CustomerAuthorizedContactsController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public CustomerAuthorizedContactsController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    /// <summary>
    /// Kullanıcının bu cariyi görmeye yetkisi var mı.
    ///
    /// Kapsam boş/'*' ise sınırsızdır (ofis kullanıcısı). Sınırlıysa cari kodu kullanıcının
    /// portföyünde OLMALI — şube (<c>ParentCustomerCode</c>) ve alt hesaplar
    /// (<c>MainCustomerCode</c>) dahil, çünkü bir cari tek satır değil.
    ///
    /// Öncesinde hiçbir kontrol yoktu: adres çubuğuna başka bir bayinin cari kodunu yazan her
    /// oturumlu kullanıcı o firmanın yetkilisinin adını ve cep telefonunu okuyabiliyor,
    /// `cariEkle` yetkisi olan biri de üzerine yazabiliyordu.
    /// </summary>
    private async Task<bool> CanAccessCustomerAsync(string customerCode, CancellationToken cancellationToken)
    {
        if (CustomerScope.IsUnrestrictedFor(User)) return true;

        var scope = CustomerScope.Of(User);
        var allowed = await CustomerScope.ExpandAsync(_dbContext.Customers.AsNoTracking(), scope, cancellationToken);

        return allowed.Contains(customerCode, StringComparer.OrdinalIgnoreCase);
    }

    [HttpGet("{customerCode}")]
    public async Task<IActionResult> Get([FromRoute] string customerCode, CancellationToken cancellationToken)
    {
        customerCode = customerCode.Trim();
        if (customerCode.Length == 0)
        {
            return BadRequest(new { success = false, message = "Geçersiz cari kodu" });
        }

        if (!await CanAccessCustomerAsync(customerCode, cancellationToken))
        {
            return Forbid();
        }

        var contact = await _dbContext.CustomerAuthorizedContacts
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (contact is null)
        {
            return Ok(new
            {
                success = true,
                data = (CustomerAuthorizedContactResponse?)null
            });
        }

        return Ok(new
        {
            success = true,
            data = new CustomerAuthorizedContactResponse
            {
                CustomerCode = contact.CustomerCode,
                FullName = contact.FullName,
                Phone = contact.Phone
            }
        });
    }

    [AuthorizePage("users", "cariEkle")]
    [HttpPut]
    [Authorize]
    public async Task<IActionResult> Upsert([FromBody] UpsertCustomerAuthorizedContactRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var customerCode = request.CustomerCode.Trim();
        var fullName = request.FullName.Trim();
        var phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim();

        if (customerCode.Length == 0) ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode is required.");
        if (fullName.Length == 0) ModelState.AddModelError(nameof(request.FullName), "FullName is required.");

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var customerExists = await _dbContext.Customers
            .AsNoTracking()
            .AnyAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (!customerExists)
        {
            ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode is invalid.");
            return ValidationProblem(ModelState);
        }

        if (!await CanAccessCustomerAsync(customerCode, cancellationToken))
        {
            return Forbid();
        }

        var entity = await _dbContext.CustomerAuthorizedContacts
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (entity is null)
        {
            entity = new CustomerAuthorizedContact
            {
                CustomerCode = customerCode,
                FullName = fullName,
                Phone = phone,
                CreateUser = User.Identity?.Name ?? "System",
                CreateTime = DateTime.UtcNow
            };

            _dbContext.CustomerAuthorizedContacts.Add(entity);
        }
        else
        {
            entity.FullName = fullName;
            entity.Phone = phone;
            entity.EditUser = User.Identity?.Name ?? "System";
            entity.EditTime = DateTime.UtcNow;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            data = new CustomerAuthorizedContactResponse
            {
                CustomerCode = entity.CustomerCode,
                FullName = entity.FullName,
                Phone = entity.Phone
            }
        });
    }
}
