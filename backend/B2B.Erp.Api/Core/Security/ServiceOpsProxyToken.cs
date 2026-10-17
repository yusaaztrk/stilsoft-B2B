using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace B2B.Erp.Api.Core.Security;

/// <summary>
/// ServiceOps'a B2B adına yapılan sunucu-sunucu çağrılarının kısa ömürlü token'ı.
/// Teknisyen yönetim ekranı ve Fatura Takip aynı token'ı kullanıyor; imzalama kodu tek yerde.
/// </summary>
public static class ServiceOpsProxyToken
{
    public static string Create(IConfiguration configuration, string tenantCode)
    {
        var keyStr = configuration["ServiceOps:JwtKey"] ?? "CHANGE_ME_IN_PRODUCTION_CHANGE_ME_IN_PRODUCTION";
        var issuer = configuration["ServiceOps:JwtIssuer"] ?? "service-ops-api";
        var audience = configuration["ServiceOps:JwtAudience"] ?? "service-ops-frontend";

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, Guid.NewGuid().ToString()),
            new(ClaimTypes.Name, "B2B_Admin_Proxy"),
            new("tenantCode", tenantCode),
            new("isSuperAdmin", "true"),
            new("IsSuperSuperAdmin", "1")
        };

        var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(keyStr));
        var creds = new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(15),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
