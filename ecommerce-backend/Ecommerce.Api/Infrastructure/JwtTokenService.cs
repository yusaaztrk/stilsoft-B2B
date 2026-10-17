using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Ecommerce.Api.Infrastructure;

public sealed class JwtTokenService
{
    private readonly IConfiguration _config;

    public JwtTokenService(IConfiguration config)
    {
        _config = config;
    }

    public string CreateToken(string subject, string role, IEnumerable<string>? permissions = null, Guid? userId = null)
    {
        var secret = _config["Jwt:Secret"] ?? string.Empty;
        if (string.IsNullOrWhiteSpace(secret) || secret.Length < 32)
            throw new InvalidOperationException("Jwt:Secret must be at least 32 characters.");

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new(ClaimTypes.Name, subject),
            new(ClaimTypes.Email, subject),
            new(ClaimTypes.Role, role)
        };

        if (userId is not null)
            claims.Add(new Claim(ClaimTypes.NameIdentifier, userId.Value.ToString()));

        foreach (var permission in permissions ?? Array.Empty<string>())
            claims.Add(new Claim("permission", permission));

        var token = new JwtSecurityToken(
            claims: claims,
            expires: DateTime.UtcNow.AddHours(8),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public string CreateAdminToken(string username) => CreateToken(username, "Owner", new[] { "dashboard", "products", "categories", "orders", "customers", "campaigns", "design", "reports", "settings", "users" });
}
