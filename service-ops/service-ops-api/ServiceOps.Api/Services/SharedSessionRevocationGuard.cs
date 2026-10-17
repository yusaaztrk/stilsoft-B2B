using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Caching.Memory;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace ServiceOps.Api.Services;

/// <summary>
/// Bayi tarafından (ya da başka bir cihazdan) yapılan çıkışın burada da geçerli olmasını sağlar.
///
/// Ekranın yoklaması kullanıcıyı giriş sayfasına atar, ama elde kalan token API'ye istek atmaya
/// devam edebilirdi. Burada, doğrulanmış her token için ortak oturum kaydına bakılır ve çıkıştan
/// ÖNCE üretilmiş token'lar reddedilir.
///
/// Karar `iat` üzerinden verilir; böylece çıkıştan sonra yeniden giriş yapan kullanıcı, kısa ömürlü
/// önbellekte hâlâ "kapatıldı" kaydı dursa bile engellenmez.
///
/// Kayda ulaşılamıyorsa istek GEÇER — paylaşılan defterin erişilemez olması, sahadaki teknisyenleri
/// sistemden atmak için sebep değil.
/// </summary>
public static class SharedSessionRevocationGuard
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(5);

    public static async Task RejectRevokedAsync(TokenValidatedContext context)
    {
        var principal = context.Principal;
        var username = principal?.FindFirst(ClaimTypes.Name)?.Value;
        var tenantCode = principal?.FindFirst("tenantCode")?.Value;

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(tenantCode)) return;

        // SignalR el sıkışmasında token sorgu parametresiyle geliyor; başlık boş olabilir.
        var rawToken = context.Request.Headers.Authorization.ToString();
        if (string.IsNullOrWhiteSpace(rawToken)) rawToken = context.Request.Query["access_token"].ToString();

        var issuedAt = ReadIssuedAtUtc(rawToken);
        if (issuedAt is null) return;

        var services = context.HttpContext.RequestServices;
        var cache = services.GetService<IMemoryCache>();
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
    /// JwtBearer gelen claim adlarını eşliyor; `iat` gibi kayıtlı alanların principal üzerinde
    /// hangi adla duracağı sürüme bağlı. Ham token'ı çözmek bu belirsizliği ortadan kaldırıyor —
    /// aksi halde kapı sessizce hiçbir şeyi reddetmezdi.
    /// </summary>
    private static DateTime? ReadIssuedAtUtc(string? rawToken)
    {
        var raw = (rawToken ?? string.Empty).Trim();
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
