using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Caching.Memory;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace B2B.Erp.Api.Core.Sessions;

/// <summary>
/// Çıkışın DİĞER uygulamada da gerçekten geçerli olmasını sağlayan kapı.
///
/// Ekranların yoklaması kullanıcıyı giriş sayfasına atar, ama token elde kaldığı sürece API'ye
/// istek atmaya devam edebilir. Burada her doğrulanmış token için ortak oturum kaydına bakılır ve
/// çıkıştan ÖNCE üretilmiş token'lar reddedilir.
///
/// Karar `iat` üzerinden verilir (token ne zaman üretildi), böylece çıkıştan sonra yeniden giriş
/// yapan kullanıcı, önbellekte eski "kapatıldı" kaydı dursa bile engellenmez.
///
/// Ortak kayda ulaşılamıyorsa istek GEÇER: paylaşılan defterin erişilemez olması tüm kullanıcıları
/// dışarı atmak için sebep değil.
/// </summary>
public static class SharedSessionRevocationGuard
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(5);

    public static async Task RejectRevokedAsync(TokenValidatedContext context)
    {
        var username = context.Principal?.FindFirst(ClaimTypes.Name)?.Value;
        if (string.IsNullOrWhiteSpace(username)) return;

        var issuedAt = ReadIssuedAtUtc(context.Request.Headers.Authorization.ToString());
        if (issuedAt is null) return;

        var services = context.HttpContext.RequestServices;
        var cache = services.GetService<IMemoryCache>();

        // Firma kodu isteğin başlığından çözülür. Bu olay kimlik doğrulaması TAMAMLANMADAN önce
        // çalıştığı için HttpContext.User henüz dolu değil; TenantId claim'i üzerinden çözüm bu
        // aşamada güvenilir değil. Kod bulunamazsa aşağıda satır da bulunamaz ve istek geçer —
        // yani kapı yalnızca kesin bilgiyle reddeder.
        var tenantCode = services.GetService<B2B.Erp.Api.Data.Services.TenantConnectionStringResolver>()?.GetCurrentTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return;

        var cacheKey = $"sharedsession:{tenantCode}:{SharedSessionStore.NormalizeKey(username)}";

        DateTime? revokedAtUtc;
        if (cache is not null && cache.TryGetValue<DateTime?>(cacheKey, out var cached))
        {
            revokedAtUtc = cached;
        }
        else
        {
            try
            {
                var store = services.GetService<ISharedSessionStore>();
                if (store is null) return;

                var state = await store.GetAsync(tenantCode, username, context.HttpContext.RequestAborted);
                revokedAtUtc = state?.RevokedAtUtc;
                cache?.Set(cacheKey, revokedAtUtc, CacheTtl);
            }
            catch
            {
                return;
            }
        }

        if (revokedAtUtc.HasValue && issuedAt.Value < revokedAtUtc.Value)
        {
            context.Fail("Oturum kapatılmış");
        }
    }

    /// <summary>
    /// `iat`, doğrulanmış principal'dan DEĞİL, token'ın kendisinden okunur.
    ///
    /// JwtBearer gelen claim adlarını eşliyor ("sub" → nameidentifier gibi); `iat` gibi kayıtlı
    /// alanların principal üzerinde hangi adla duracağı sürüme bağlı. Ham token'ı çözmek bu
    /// belirsizliği tamamen ortadan kaldırıyor — aksi halde kapı sessizce hiçbir şeyi reddetmezdi.
    /// </summary>
    private static DateTime? ReadIssuedAtUtc(string? authorizationHeader)
    {
        var raw = (authorizationHeader ?? string.Empty).Trim();
        if (raw.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) raw = raw.Substring(7).Trim();
        if (string.IsNullOrWhiteSpace(raw)) return null;

        try
        {
            var token = new JwtSecurityTokenHandler().ReadJwtToken(raw);
            var iat = token.Claims.FirstOrDefault(x => x.Type == JwtRegisteredClaimNames.Iat)?.Value;
            if (long.TryParse(iat, out var seconds) && seconds > 0)
            {
                return DateTimeOffset.FromUnixTimeSeconds(seconds).UtcDateTime;
            }
        }
        catch
        {
        }

        return null;
    }
}
