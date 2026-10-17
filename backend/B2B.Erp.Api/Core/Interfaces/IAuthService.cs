using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Core.Interfaces;

public interface IAuthService
{
    Task<(User? user, string accessToken, string refreshToken)> LoginAsync(string username, string password, string ipAddress, string? tenantCode = null);
    Task<(string accessToken, string refreshToken)?> RefreshTokenAsync(string token, string ipAddress);
    Task<bool> RevokeTokenAsync(string token, string ipAddress);
    Task<bool> LogoutAsync(int userId, string ipAddress);
}