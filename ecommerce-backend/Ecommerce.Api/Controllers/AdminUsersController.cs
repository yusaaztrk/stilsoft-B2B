using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Authorize(Policy = "perm:users")]
[Route("api/admin/users")]
public sealed class AdminUsersController : ControllerBase
{
    private readonly EcommerceUsersRepository _users;

    public AdminUsersController(EcommerceUsersRepository users)
    {
        _users = users;
    }

    public sealed class CreateAdminUserRequest
    {
        public string FullName { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
        public string Role { get; set; } = "Admin";
        public string[] Permissions { get; set; } = Array.Empty<string>();
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var data = (await _users.ListAsync(cancellationToken)).Select(u => new
        {
            u.Id,
            u.Email,
            u.FullName,
            u.Role,
            u.IsActive,
            u.CreatedAtUtc,
            permissions = u.PermissionsCsv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        });
        return Ok(new { success = true, data });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateAdminUserRequest request, CancellationToken cancellationToken)
    {
        if (request.Password.Length < 8)
            return BadRequest(new { success = false, message = "Sifre en az 8 karakter olmali" });

        var user = await _users.CreateAsync(new EcommerceUser
        {
            Email = request.Email,
            FullName = request.FullName,
            PasswordHash = EcommerceUsersRepository.HashPassword(request.Password),
            Role = request.Role,
            PermissionsCsv = string.Join(',', request.Permissions.Distinct(StringComparer.OrdinalIgnoreCase)),
            IsActive = true
        }, cancellationToken);

        return Ok(new { success = true, data = new { user.Id, user.Email, user.FullName, user.Role, user.IsActive } });
    }

    [HttpPut("{id:guid}/active")]
    public async Task<IActionResult> Active(Guid id, [FromBody] Dictionary<string, bool> body, CancellationToken cancellationToken)
    {
        await _users.SetActiveAsync(id, body.TryGetValue("isActive", out var active) && active, cancellationToken);
        return Ok(new { success = true });
    }
}
