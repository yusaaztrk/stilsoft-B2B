using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Asistan.Api.Infrastructure;

/// <summary>
/// Asistanın KENDİ oturum token'ı ve B2B token'ının doğrulanması.
///
/// Neden ayrı token (ServiceOps'taki takasla aynı karar, bkz. b2b-serviceops-sso):
/// B2B token'ını her panel isteğinde kabul etmek, asistanın B2B'nin anahtarına sürekli
/// bağımlı kalması ve B2B'de üretilen HER token'ın (bayi dahil) burada da bir kimlik sayılması
/// demekti. B2B token'ı yalnız iki kapıda — şifreli girişin sonunda ve "Asistan'a Geç"
/// devrinde — BİR KEZ doğrulanır, karşılığında asistan kendi token'ını imzalar.
///
/// Süre: B2B oturumunun bitişini DEVRALIR (ortak oturum mantığı), en fazla 12 saat.
/// </summary>
public sealed class AsistanTokens
{
    private readonly IConfiguration _configuration;
    private static readonly TimeSpan MaxLifetime = TimeSpan.FromHours(12);

    public AsistanTokens(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    private string OwnKey => _configuration["AsistanJwt:SecretKey"] ?? string.Empty;
    private string OwnIssuer => _configuration["AsistanJwt:Issuer"] ?? "asistan-api";
    private string OwnAudience => _configuration["AsistanJwt:Audience"] ?? "asistan-frontend";

    public bool IsConfigured => OwnKey.Length >= 32 && !string.IsNullOrWhiteSpace(_configuration["B2BJwt:SecretKey"]);

    /// <summary>B2B'nin imzaladığı token'ı doğrular (imza, süre, issuer/audience).</summary>
    public (ClaimsPrincipal Principal, DateTime ExpiresUtc)? ValidateB2B(string token)
    {
        var key = _configuration["B2BJwt:SecretKey"];
        if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(token)) return null;
        try
        {
            var issuer = _configuration["B2BJwt:Issuer"];
            var audience = _configuration["B2BJwt:Audience"];
            var principal = new JwtSecurityTokenHandler().ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
                ValidateIssuer = !string.IsNullOrWhiteSpace(issuer),
                ValidIssuer = issuer,
                ValidateAudience = !string.IsNullOrWhiteSpace(audience),
                ValidAudience = audience,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromMinutes(1)
            }, out var validated);
            return (principal, validated.ValidTo);
        }
        catch
        {
            return null;
        }
    }

    public string Issue(PanelUser user, int? roleId, DateTime b2bExpiresUtc)
    {
        var now = DateTime.UtcNow;
        var expires = b2bExpiresUtc > now ? (b2bExpiresUtc - now > MaxLifetime ? now + MaxLifetime : b2bExpiresUtc) : now + TimeSpan.FromMinutes(5);

        var claims = new List<Claim>
        {
            new("tenant", user.TenantCode),
            new("user", user.UserName),
            new("ssa", user.IsSsa ? "1" : "0")
        };
        if (roleId is not null) claims.Add(new Claim("roleId", roleId.Value.ToString()));

        var token = new JwtSecurityToken(
            issuer: OwnIssuer,
            audience: OwnAudience,
            claims: claims,
            notBefore: now,
            expires: expires,
            signingCredentials: new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(OwnKey)), SecurityAlgorithms.HmacSha256));

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>Asistanın kendi token'ı → kimlik. Geçersizse null.</summary>
    public (PanelUser User, int? RoleId, DateTime ExpiresUtc)? ValidateOwn(string token)
    {
        if (OwnKey.Length < 32 || string.IsNullOrWhiteSpace(token)) return null;
        try
        {
            var handler = new JwtSecurityTokenHandler { MapInboundClaims = false };
            var principal = handler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(OwnKey)),
                ValidIssuer = OwnIssuer,
                ValidAudience = OwnAudience,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.FromMinutes(1)
            }, out var validated);

            var tenant = principal.FindFirst("tenant")?.Value;
            var user = principal.FindFirst("user")?.Value;
            if (string.IsNullOrWhiteSpace(tenant) || string.IsNullOrWhiteSpace(user)) return null;
            int? roleId = int.TryParse(principal.FindFirst("roleId")?.Value, out var r) ? r : null;
            return (new PanelUser(TenantDb.Normalize(tenant), user, principal.FindFirst("ssa")?.Value == "1"), roleId, validated.ValidTo);
        }
        catch
        {
            return null;
        }
    }
}
