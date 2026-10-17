using Ecommerce.Api.Infrastructure;
using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/auth")]
public sealed class AdminAuthController : ControllerBase
{
    private readonly JwtTokenService _jwt;
    private readonly EcommerceUsersRepository _users;

    public AdminAuthController(JwtTokenService jwt, EcommerceUsersRepository users)
    {
        _jwt = jwt;
        _users = users;
    }

    public sealed class LoginRequest
    {
        public string Username { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { success = false, message = "Kullanici adi ve sifre zorunlu" });

        var login = request.Username.Trim();
        var email = login.Contains('@', StringComparison.Ordinal) ? login : $"{login}@site.local";
        var user = await _users.GetByEmailAsync(email, cancellationToken);
        if (user is null || !user.IsActive || user.Role == "Customer" || !EcommerceUsersRepository.VerifyPassword(request.Password, user.PasswordHash))
            return Unauthorized(new { success = false, message = "Kullanici adi veya sifre hatali" });

        var permissions = user.PermissionsCsv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var token = _jwt.CreateToken(user.Email, user.Role, permissions, user.Id);
        return Ok(new { success = true, data = new { accessToken = token, user = new { user.Id, user.Email, user.FullName, user.Role, permissions } } });
    }
}
