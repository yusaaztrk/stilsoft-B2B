using System.Security.Claims;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Core.Interfaces;

public interface ITokenService
{
    /// <param name="expiresAtUtcOverride">
    /// Token'ın tam bitiş anı. Ortak oturumda (B2B + ServiceOps) bitiş dakika cinsinden değil,
    /// saniyesi saniyesine paylaşılan kayıttan alınır; dakikaya yuvarlamak iki taraftaki bitişi
    /// birbirinden kaydırır ve istemci sürekli token yenilemeye çalışır.
    /// </param>
    string GenerateAccessToken(User user, int? tenantId = null, bool isSuperSuperAdmin = false, int? accessTokenExpirationMinutesOverride = null, DateTime? expiresAtUtcOverride = null);
    RefreshToken GenerateRefreshToken(string ipAddress);
    ClaimsPrincipal? ValidateToken(string token);
    int? GetUserIdFromToken(string token);
}