using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Entities;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;

namespace B2B.Erp.Api.Data.Services;

public class TokenService : ITokenService
{
    private readonly IConfiguration _configuration;
    private readonly string _secretKey;
    private readonly string _issuer;
    private readonly string _audience;
    private readonly int _accessTokenExpiration;
    private readonly int _refreshTokenExpiration;
    private readonly ILogger<TokenService> _logger;

    /// <summary>Ayar okunamazsa kullanılan güvenli varsayılanlar.</summary>
    private const int DefaultAccessTokenMinutes = 60;
    private const int DefaultRefreshTokenDays = 7;

    public TokenService(IConfiguration configuration, ILogger<TokenService> logger)
    {
        _configuration = configuration;
        _logger = logger;
        _secretKey = _configuration["JwtSettings:SecretKey"]!;
        _issuer = _configuration["JwtSettings:Issuer"]!;
        _audience = _configuration["JwtSettings:Audience"]!;

        // SÜRE AYARLARI ÇÖKERTMEZ.
        //
        // Eskiden `int.Parse(config[...]!)` idi: ayar eksik, boş ya da yanlış yazılmışsa
        // (" 60" gibi bir boşluk bile yeter) TokenService KURULURKEN patlıyor ve token üreten
        // her uç 500 veriyordu — yani kimse giriş yapamıyordu. Artık ayar bozuksa uyarı
        // loglanıp varsayılana düşülüyor; sistem ayakta kalıyor.
        _accessTokenExpiration = ReadPositiveInt("JwtSettings:AccessTokenExpirationMinutes", DefaultAccessTokenMinutes);
        _refreshTokenExpiration = ReadPositiveInt("JwtSettings:RefreshTokenExpirationDays", DefaultRefreshTokenDays);
    }

    private int ReadPositiveInt(string key, int fallback)
    {
        var raw = _configuration[key];
        if (int.TryParse((raw ?? string.Empty).Trim(), out var value) && value > 0)
        {
            return value;
        }

        _logger.LogWarning(
            "JWT ayarı okunamadı: {Key} = '{Raw}'. Varsayılan {Fallback} kullanılıyor.",
            key,
            raw,
            fallback);
        return fallback;
    }

    public string GenerateAccessToken(User user, int? tenantId = null, bool isSuperSuperAdmin = false, int? accessTokenExpirationMinutesOverride = null, DateTime? expiresAtUtcOverride = null)
    {
        var claims = new List<Claim>
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Name, user.Username),
            new Claim(ClaimTypes.Email, user.Mail),
            new Claim("Mail", user.Mail),
            new Claim("Unvan", user.Unvan),
            new Claim("Carikodu", user.Carikodu ?? ""),
            new Claim("SalesmanCode", user.SalesmanCode ?? ""),
            new Claim("DefaultWarehouseCode", user.DefaultWarehouseCode?.ToString() ?? ""),
            new Claim(ClaimTypes.Role, user.Role.Name),
            new Claim("RoleId", user.RoleId.ToString()),
            new Claim("RoleCode", user.Role.Code),
            new Claim("IsSuperAdmin", user.Role.IsSuperAdmin ? "1" : "0"),
            new Claim("IsSuperSuperAdmin", isSuperSuperAdmin ? "1" : "0"),
            new Claim("DiscountRate", user.DiscountRate?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? ""),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            // Açıkça yazılıyor: ortak oturumda "bu token çıkıştan önce mi üretildi" kararı buna
            // bakıyor (bkz. SharedSessionRevocationGuard).
            new Claim(JwtRegisteredClaimNames.Iat, DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64)
        };

        if (tenantId.HasValue)
        {
            claims.Add(new Claim("TenantId", tenantId.Value.ToString()));
        }

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_secretKey));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var expiresMinutes = accessTokenExpirationMinutesOverride.HasValue && accessTokenExpirationMinutesOverride.Value > 0
            ? accessTokenExpirationMinutesOverride.Value
            : _accessTokenExpiration;

        var expiresAt = expiresAtUtcOverride.HasValue && expiresAtUtcOverride.Value > DateTime.UtcNow
            ? expiresAtUtcOverride.Value.ToUniversalTime()
            : DateTime.UtcNow.AddMinutes(expiresMinutes);

        var token = new JwtSecurityToken(
            issuer: _issuer,
            audience: _audience,
            claims: claims,
            expires: expiresAt,
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public RefreshToken GenerateRefreshToken(string ipAddress)
    {
        var randomBytes = new byte[64];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(randomBytes);

        return new RefreshToken
        {
            Token = Convert.ToBase64String(randomBytes),
            ExpiresAt = DateTime.UtcNow.AddDays(_refreshTokenExpiration),
            CreatedAt = DateTime.UtcNow,
            CreatedByIp = ipAddress
        };
    }

    public ClaimsPrincipal? ValidateToken(string token)
    {
        var tokenHandler = new JwtSecurityTokenHandler();
        var key = Encoding.UTF8.GetBytes(_secretKey);

        try
        {
            var principal = tokenHandler.ValidateToken(token, new TokenValidationParameters
            {
                ValidateIssuerSigningKey = true,
                IssuerSigningKey = new SymmetricSecurityKey(key),
                ValidateIssuer = true,
                ValidIssuer = _issuer,
                ValidateAudience = true,
                ValidAudience = _audience,
                ValidateLifetime = true,
                ClockSkew = TimeSpan.Zero
            }, out SecurityToken validatedToken);

            return principal;
        }
        catch (SecurityTokenExpiredException)
        {
            // Süresi dolmuş token normal bir durumdur (yenileme akışı bunu bekler) — gürültü
            // yapmasın diye Debug seviyesinde.
            _logger.LogDebug("Token doğrulaması başarısız: süresi dolmuş.");
            return null;
        }
        catch (Exception ex)
        {
            // İMZA HATASI / BOZUK FORMAT SESSİZCE YUTULMAZ.
            //
            // Eskiden `catch { return null; }` idi: token manipülasyonu denemeleri hiçbir iz
            // bırakmıyordu. Token'ın KENDİSİ loglanmaz (sızdırma riski), yalnızca hata türü.
            _logger.LogWarning("Token doğrulaması başarısız: {ErrorType} - {Message}", ex.GetType().Name, ex.Message);
            return null;
        }
    }

    public int? GetUserIdFromToken(string token)
    {
        var principal = ValidateToken(token);
        var userIdClaim = principal?.FindFirst(ClaimTypes.NameIdentifier);

        return userIdClaim != null && int.TryParse(userIdClaim.Value, out var userId) 
            ? userId 
            : null;
    }
}