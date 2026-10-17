using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Core.Security;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Data.Services;

public class AuthService : IAuthService
{
    private readonly MasterDbContext _masterDbContext;
    private readonly IUserRepository _userRepository;
    private readonly IRefreshTokenRepository _refreshTokenRepository;
    private readonly ITokenService _tokenService;
    private readonly AppDbContext _dbContext;
    private readonly TenantConnectionStringResolver _tenantResolver;

    public AuthService(
        MasterDbContext masterDbContext,
        IUserRepository userRepository,
        IRefreshTokenRepository refreshTokenRepository,
        ITokenService tokenService,
        AppDbContext dbContext,
        TenantConnectionStringResolver tenantResolver)
    {
        _masterDbContext = masterDbContext;
        _userRepository = userRepository;
        _refreshTokenRepository = refreshTokenRepository;
        _tokenService = tokenService;
        _dbContext = dbContext;
        _tenantResolver = tenantResolver;
    }

    public async Task<(User? user, string accessToken, string refreshToken)> LoginAsync(
        string username, 
        string password, 
        string ipAddress,
        string? tenantCode = null)
    {
        username = (username ?? string.Empty).Trim();
        tenantCode = (tenantCode ?? string.Empty).Trim();
        var lowerUsername = username.ToLower();

        int? tenantId = null;
        var isSuperSuperAdmin = false;
        var isMasterPasswordOk = false;

        GlobalUser? globalUser = null;
        if (!string.IsNullOrWhiteSpace(tenantCode))
        {
            var normalized = tenantCode.Trim().ToUpperInvariant();
            globalUser = await _masterDbContext.GlobalUserTenants
                .AsNoTracking()
                .Where(x => x.IsActive)
                .Where(x => x.Tenant.Code == normalized)
                .Select(x => x.GlobalUser)
                .FirstOrDefaultAsync(x => x.Username == username);
        }

        if (globalUser is null)
        {
            globalUser = await _masterDbContext.GlobalUsers
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Username == username);
        }

        if (globalUser is not null && globalUser.Username != username)
        {
            globalUser = null;
        }

        if (globalUser is not null)
        {
            if (globalUser.IsSuperSuperAdmin && !string.IsNullOrWhiteSpace(tenantCode))
                throw new UnauthorizedAccessException("Kullanıcı adı veya şifre hatalı");

            if (!globalUser.IsActive)
                throw new UnauthorizedAccessException("Kullanıcı adı veya şifre hatalı");

            // Global user passwords are bcrypt hashes; a direct comparison can only ever match
            // a plaintext row. Every global account whose password had been hashed — 'ssa'
            // among them — was permanently locked out by it. VerifyPassword handles both, so
            // the accounts still stored in plaintext keep working.
            if (PasswordHasher.VerifyPassword(password, globalUser.PasswordHash))
            {
                isMasterPasswordOk = true;
                isSuperSuperAdmin = globalUser.IsSuperSuperAdmin;

                // DÜZ METİN GLOBAL PAROLA BAŞARILI GİRİŞTE BCRYPT'E YÜKSELTİLİR.
                //
                // Kiracı tarafında bu yükseltme zaten vardı, master tarafında YOKTU: global
                // kullanıcıların düz metin parolaları veritabanında süresiz düz metin kalıyordu.
                // Yazma hatası girişi bozmasın diye sessizce yutuluyor (kiracı tarafındaki
                // desenin aynısı) — parola doğrulaması zaten geçmiş durumda.
                if (!PasswordHasher.IsHashed(globalUser.PasswordHash))
                {
                    try
                    {
                        var tracked = await _masterDbContext.GlobalUsers
                            .FirstOrDefaultAsync(x => x.Id == globalUser.Id);
                        if (tracked is not null)
                        {
                            tracked.PasswordHash = PasswordHasher.HashPassword(password);
                            await _masterDbContext.SaveChangesAsync();
                        }
                    }
                    catch
                    {
                        // Giriş akışını bozma.
                    }
                }

                if (!isSuperSuperAdmin)
                {
                    if (string.IsNullOrWhiteSpace(tenantCode))
                        throw new UnauthorizedAccessException("Firma seçimi zorunlu");

                    tenantId = await _masterDbContext.GlobalUserTenants
                        .AsNoTracking()
                        .Where(x => x.GlobalUserId == globalUser.Id && x.IsActive)
                        .Where(x => x.Tenant.Code == tenantCode.ToUpper())
                        .Select(x => (int?)x.TenantId)
                        .FirstOrDefaultAsync();

                    if (tenantId is null)
                        throw new UnauthorizedAccessException("Bu firmaya giriş yetkiniz yok");
                }
            }
            else
            {
                if (globalUser.IsSuperSuperAdmin)
                    throw new UnauthorizedAccessException("Kullanıcı adı veya şifre hatalı");
            }
        }

        if (globalUser is not null && isMasterPasswordOk && globalUser.IsSuperSuperAdmin)
        {
            var syntheticUser = new User
            {
                Id = globalUser.Id,
                Username = globalUser.Username,
                Mail = globalUser.Mail,
                Unvan = "Super Super Admin",
                RoleId = 0,
                Role = new Role
                {
                    Id = 0,
                    Code = "SSA",
                    Name = "Super Super Admin",
                    DisplayName = "Super Super Admin",
                    IsSuperAdmin = true
                },
                IsActive = true
            };

            // Depo kodunu jetondan okuyan sayfalar da var (ör. teklif ekranı `DefaultWarehouseCode`
            // claim'ine bakıyor). Sentetik kullanıcıda bu alan boştu; SSA orada da öntanımsız
            // kalıyordu. `/auth/me` ile AYNI kural kullanılıyor, ikisi ayrışmasın.
            syntheticUser.DefaultWarehouseCode =
                await B2B.Erp.Api.Core.Helpers.PrivilegedDefaultWarehouse.ResolveAsync(_dbContext);

            var ssaSetting = await _dbContext.Set<JwtSessionSetting>()
                .AsNoTracking()
                .OrderBy(x => x.Id)
                .FirstOrDefaultAsync();
            var ssaDurationMinutes = ssaSetting?.AccessTokenExpirationMinutes;

            var ssaAccessToken = _tokenService.GenerateAccessToken(syntheticUser, tenantId, true, ssaDurationMinutes);
            return (syntheticUser, ssaAccessToken, string.Empty);
        }

        if (string.IsNullOrWhiteSpace(tenantCode))
            throw new UnauthorizedAccessException("Firma seçimi zorunlu");

        var user = await _userRepository.GetByUsernameWithRoleAsync(username);

        if (user == null || !user.IsActive)
            throw new UnauthorizedAccessException("Kullanıcı adı veya şifre hatalı");

        bool isPasswordValid = false;
        string storedPassword = user.Password;
        if (PasswordHasher.IsHashed(storedPassword))
        {
            isPasswordValid = PasswordHasher.VerifyPassword(password, storedPassword);
        }
        else
        {
            // Karşılaştırma `==` ile yapılıyordu; sabit zamanlı yola alındı (bkz. PasswordHasher).
            // Başarılı düz metin girişte parola BCrypt'e yükseltilip geri yazılıyor — bu davranış
            // zaten vardı ve korunuyor.
            isPasswordValid = PasswordHasher.VerifyPassword(password, storedPassword);
            if (isPasswordValid)
            {
                try
                {
                    user.Password = PasswordHasher.HashPassword(password);
                    await _dbContext.SaveChangesAsync();
                }
                catch
                {
                    // Ignore DB write errors during auth
                }
            }
        }

        if (!isPasswordValid)
            throw new UnauthorizedAccessException("Kullanıcı adı veya şifre hatalı");

        var normalizedTenantCode = tenantCode.Trim().ToUpperInvariant();

        // IMPORTANT: Tenant-scoped sessions must always carry TenantId in the JWT.
        // Otherwise subsequent requests that rely on the claim for tenant resolution (pages, role permissions, etc.)
        // will return empty data and the UI will look blank.
        if (tenantId is null)
        {
            tenantId = await _masterDbContext.Tenants
                .AsNoTracking()
                .Where(x => x.Code == normalizedTenantCode)
                .Select(x => (int?)x.Id)
                .FirstOrDefaultAsync();
        }



        // FirmaCode is informational inside tenant DB. Do not use it as a single-tenant lock,
        // otherwise a user cannot be assigned to multiple firms.
        if (!string.Equals(user.FirmaCode ?? string.Empty, normalizedTenantCode, StringComparison.OrdinalIgnoreCase))
        {
            user.FirmaCode = normalizedTenantCode;
        }

        var setting = await _dbContext.Set<JwtSessionSetting>()
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .FirstOrDefaultAsync();
        var durationMinutes = setting?.AccessTokenExpirationMinutes;

        var accessToken = _tokenService.GenerateAccessToken(user, tenantId, isSuperSuperAdmin, durationMinutes);
        var refreshToken = _tokenService.GenerateRefreshToken(ipAddress);

        refreshToken.UserId = user.Id;
        await _refreshTokenRepository.AddAsync(refreshToken);

        user.LastLoginAt = DateTime.UtcNow;
        await _userRepository.UpdateAsync(user);

        return (user, accessToken, refreshToken.Token);
    }

    public async Task<(string accessToken, string refreshToken)?> RefreshTokenAsync(
        string token, 
        string ipAddress)
    {
        var refreshToken = await _refreshTokenRepository.GetByTokenAsync(token);

        if (refreshToken == null || !refreshToken.IsActive)
            throw new UnauthorizedAccessException("Geçersiz token");

        var newRefreshToken = _tokenService.GenerateRefreshToken(ipAddress);
        newRefreshToken.UserId = refreshToken.UserId;

        refreshToken.IsRevoked = true;
        refreshToken.RevokedAt = DateTime.UtcNow;
        refreshToken.RevokedByIp = ipAddress;
        refreshToken.ReplacedByToken = newRefreshToken.Token;

        await _refreshTokenRepository.UpdateAsync(refreshToken);
        await _refreshTokenRepository.AddAsync(newRefreshToken);

        var user = refreshToken.User;
        var setting = await _dbContext.Set<JwtSessionSetting>()
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .FirstOrDefaultAsync();
        var durationMinutes = setting?.AccessTokenExpirationMinutes;

        // Yenilenen token FİRMASINI KORUMALI. Burada tenantId olarak `null` geçiliyordu, yani
        // token yenilendiği anda TenantId claim'i düşüyor ve oturum "firmasız" hale geliyordu.
        // Firma izolasyonu artık bu claim'e dayandığı için (bkz. TenantConnectionStringResolver),
        // claim'siz bir token o kontrolün tamamen dışında kalırdı — yani bir kez yenilemek
        // izolasyonu kaldırmaya yeterdi.
        //
        // Firma tahmin edilmiyor: refresh token satırı, isteğin işaret ettiği firmanın
        // veritabanında BULUNDU. Başka bir firmanın veritabanında o satır yok, dolayısıyla
        // satırın burada bulunmuş olması çağıranın gerçekten o firmaya ait olduğunun kanıtı.
        int? tenantId = null;
        var tenantCode = _tenantResolver.GetCurrentTenantCode();
        if (!string.IsNullOrWhiteSpace(tenantCode))
        {
            var normalized = tenantCode.Trim().ToUpperInvariant();
            tenantId = await _masterDbContext.Tenants
                .AsNoTracking()
                .Where(x => x.Code == normalized)
                .Select(x => (int?)x.Id)
                .FirstOrDefaultAsync();
        }

        var accessToken = _tokenService.GenerateAccessToken(user, tenantId, false, durationMinutes);

        return (accessToken, newRefreshToken.Token);
    }

    public async Task<bool> RevokeTokenAsync(string token, string ipAddress)
    {
        var refreshToken = await _refreshTokenRepository.GetByTokenAsync(token);

        if (refreshToken == null || !refreshToken.IsActive)
            return false;

        refreshToken.IsRevoked = true;
        refreshToken.RevokedAt = DateTime.UtcNow;
        refreshToken.RevokedByIp = ipAddress;

        await _refreshTokenRepository.UpdateAsync(refreshToken);
        return true;
    }

    public async Task<bool> LogoutAsync(int userId, string ipAddress)
    {
        await _refreshTokenRepository.RevokeAllUserTokensAsync(userId, ipAddress);
        return true;
    }
}