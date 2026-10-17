using B2B.Erp.Api.Data;
using B2B.Erp.Api.Core.Security;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("auth")]
public sealed class EmployeeAuthController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public EmployeeAuthController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public sealed class EmployeeLoginRequest
    {
        public string Username { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
        public string? TenantCode { get; set; }
    }

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<IActionResult> Login([FromBody] EmployeeLoginRequest request, CancellationToken cancellationToken)
    {
        var tenantCode = Request.Headers["X-Tenant-Code"].ToString();
        if (string.IsNullOrWhiteSpace(tenantCode)) tenantCode = (request.TenantCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(tenantCode))
        {
            return BadRequest(new { success = false, message = "Tenant bulunamadı" });
        }

        var username = (request.Username ?? string.Empty).Trim();
        var password = (request.Password ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
        {
            return BadRequest(new { success = false, message = "Kullanıcı adı ve şifre zorunludur" });
        }

        var emp = await _dbContext.Set<Employee>()
            .FirstOrDefaultAsync(x => x.IsActive
                                     && x.Username != null
                                     && x.Username == username, cancellationToken);

        if (emp is null || string.IsNullOrWhiteSpace(emp.Password))
        {
            return Unauthorized(new { success = false, message = "Hatalı kullanıcı adı veya şifre" });
        }

        bool isPasswordValid = false;
        string storedPassword = emp.Password;
        if (PasswordHasher.IsHashed(storedPassword))
        {
            isPasswordValid = PasswordHasher.VerifyPassword(password, storedPassword);
        }
        else
        {
            isPasswordValid = (password == storedPassword);
            if (isPasswordValid)
            {
                try
                {
                    emp.Password = PasswordHasher.HashPassword(password);
                    await _dbContext.SaveChangesAsync(cancellationToken);
                }
                catch
                {
                    // Ignore
                }
            }
        }

        if (!isPasswordValid)
        {
            return Unauthorized(new { success = false, message = "Hatalı kullanıcı adı veya şifre" });
        }

        return Ok(new
        {
            success = true,
            message = "Giriş başarılı",
            data = new
            {
                employeeId = emp.Id,
                employeeName = $"{emp.FirstName} {emp.LastName}".Trim()
            }
        });
    }
}
