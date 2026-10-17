using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Core.Interfaces;

public interface IRefreshTokenRepository
{
    Task<RefreshToken> AddAsync(RefreshToken refreshToken);
    Task<RefreshToken?> GetByTokenAsync(string token);
    Task UpdateAsync(RefreshToken refreshToken);
    Task RevokeAllUserTokensAsync(int userId, string ipAddress);
}