using System;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

public static class ControllerExtensions
{
    public static async Task<bool> CanDeleteRecordAsync(
        this ControllerBase controller,
        AppDbContext dbContext,
        AuditableEntity entity,
        CancellationToken cancellationToken)
    {
        var user = controller.User;
        
        var isSsa = user.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var isSuperAdmin = user.FindFirst("IsSuperAdmin")?.Value == "1";
        if (isSsa || isSuperAdmin)
        {
            return true;
        }

        var username = user.FindFirst(ClaimTypes.Name)?.Value ?? "";
        if (!string.IsNullOrEmpty(username) && string.Equals(entity.CreateUser, username, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var roleIdClaim = user.Claims.FirstOrDefault(c => string.Equals(c.Type, "RoleId", StringComparison.OrdinalIgnoreCase))?.Value;
        if (int.TryParse(roleIdClaim, out var roleId))
        {
            var canDeleteOthers = await dbContext.RolePagePermissions
                .AsNoTracking()
                .AnyAsync(rpp => rpp.RoleId == roleId && rpp.CanAccess && rpp.Page.ModuleKey == "deleteRule" && rpp.Page.Key == "deleteRule/tumIslemleriSilebilsin", cancellationToken);
            if (canDeleteOthers)
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// SİLME KURALI — Fatura Dökümü'ndeki iki kontrolün tek kapısı (2026-09-16 kullanıcı isteği:
    /// "kasa banka işlemlerinde ve silme gereken her sayfada 24 saat kuralı ve başkasının
    /// yaptığını silememe olması lazım").
    ///
    /// <list type="number">
    /// <item><b>Başkasının kaydı</b> — <see cref="CanDeleteRecordAsync"/>: kendi kaydını herkes
    /// siler; başkasınınkini yalnız SSA, SuperAdmin ve <c>deleteRule/tumIslemleriSilebilsin</c>
    /// yetkili rol.</item>
    /// <item><b>24 saat</b> — rolde <paramref name="ruleKey"/> (ör. <c>deleteRule/kasaHareket</c>)
    /// AÇIKSA kayıt oluşturulduktan 24 saat sonra silinemez. Düğme yetki değil KISITTIR; kapalıyken
    /// süre sınırı yok. SSA ve SuperAdmin'e uygulanmaz (Fatura Dökümü'ndeki gibi).</item>
    /// </list>
    ///
    /// Kural yoksa <c>null</c>, ihlal varsa kullanıcıya dönecek 400 sonucu verir. Silmeye benzeyen
    /// her işlem (iptal, montaj kaldırma) aynı kapıdan geçer; kayıt olarak BELGENİN kendisi verilir
    /// (ör. montaj için fatura), çünkü sahiplik ve süre belgeye aittir.
    /// </summary>
    public static async Task<IActionResult?> DeleteRuleViolationAsync(
        this ControllerBase controller,
        AppDbContext dbContext,
        AuditableEntity entity,
        string ruleKey,
        CancellationToken cancellationToken)
    {
        if (!await controller.CanDeleteRecordAsync(dbContext, entity, cancellationToken))
        {
            return controller.BadRequest(new { success = false, message = "Sadece kendi oluşturduğunuz işlemleri silebilirsiniz." });
        }

        var user = controller.User;
        if (user.FindFirst("IsSuperSuperAdmin")?.Value == "1" || user.FindFirst("IsSuperAdmin")?.Value == "1")
        {
            return null;
        }

        var roleIdClaim = user.Claims.FirstOrDefault(c => string.Equals(c.Type, "RoleId", StringComparison.OrdinalIgnoreCase))?.Value;
        if (!int.TryParse(roleIdClaim, out var roleId))
        {
            return null;
        }

        var hasRestriction = await dbContext.RolePagePermissions
            .AsNoTracking()
            .AnyAsync(rpp => rpp.RoleId == roleId && rpp.CanAccess && rpp.Page.ModuleKey == "deleteRule" && rpp.Page.Key == ruleKey, cancellationToken);

        if (hasRestriction && DateTime.UtcNow - entity.CreateTime > TimeSpan.FromDays(1))
        {
            return controller.BadRequest(new { success = false, message = "Bu kayıt oluşturulduktan 24 saat sonra silinemez." });
        }

        return null;
    }
}
