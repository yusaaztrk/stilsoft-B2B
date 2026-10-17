using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Npgsql;

namespace Asistan.Api.Infrastructure;

/// <summary>Panel isteğinin kimliği: hangi firma, hangi kullanıcı.</summary>
public sealed record PanelUser(string TenantCode, string UserName, bool IsSsa, int? RoleId = null);

/// <summary>
/// Asistan ekranının uçlarının kapısı: asistanın KENDİ token'ı (bkz. AsistanTokens) + sayfa
/// yetkisi (bkz. PageAccess). B2B token'ı burada kabul EDİLMEZ — yalnız giriş/devir ucunda
/// bir kez doğrulanıp asistan token'ına çevrilir.
///
/// Firma token'dan gelir; istemciden (başlık, sorgu) alınmaz.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class PanelAuthAttribute : Attribute, IAsyncAuthorizationFilter, IAllowAnonymous
{
    public const string ItemKey = "Asistan.PanelUser";

    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var http = context.HttpContext;
        var tokens = http.RequestServices.GetRequiredService<AsistanTokens>();

        var raw = http.Request.Headers.Authorization.ToString();
        if (raw.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) raw = raw[7..].Trim();

        var who = tokens.ValidateOwn(raw);
        if (who is null)
        {
            context.Result = new UnauthorizedResult();
            return;
        }

        var (user, roleId, _) = who.Value;
        try
        {
            var access = http.RequestServices.GetRequiredService<PageAccess>();
            if (!await access.IsAllowedAsync(user.TenantCode, user.IsSsa, user.UserName, http.RequestAborted))
            {
                context.Result = new ObjectResult(new { success = false, message = "Asistan ekranına yetkiniz yok." }) { StatusCode = StatusCodes.Status403Forbidden };
                return;
            }
        }
        catch (Exception ex) when (ex is NpgsqlException or InvalidOperationException)
        {
            // Yetki okunamıyorsa KAPALI: müşteri yazışmaları belirsizlikte açılmaz.
            http.RequestServices.GetRequiredService<ILogger<PanelAuthAttribute>>().LogError(ex, "Sayfa yetkisi okunamadı ({Tenant})", user.TenantCode);
            context.Result = new ObjectResult(new { message = "Yetki kontrol edilemedi." }) { StatusCode = StatusCodes.Status503ServiceUnavailable };
            return;
        }

        http.Items[ItemKey] = user with { RoleId = roleId };
    }

    public static PanelUser Current(HttpContext http) =>
        http.Items[ItemKey] as PanelUser ?? throw new InvalidOperationException("PanelAuth çalışmadı.");
}
