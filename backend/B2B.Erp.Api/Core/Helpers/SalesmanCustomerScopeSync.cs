using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// Bir cari açıldığında / plasiyeri değiştiğinde, o plasiyerin KULLANICI hesabındaki cari
/// kapsamını (<c>Users.Carikodu</c>) günceller.
///
/// <para>
/// Neden gerekli: plasiyerin göreceği cariler kullanıcı kaydındaki virgüllü portföyden
/// süzülüyor. Yeni cari bu listeye yazılmazsa, cariyi AÇAN plasiyer bile onu ekranında
/// göremiyor — kayıt duruyor ama kimse bulamıyor.
/// </para>
///
/// <para>
/// Gövde 2026-09-18'e kadar <c>CustomersController</c> içinde private bir metottu. Müşteri
/// Teklifi ekranının "Cari Ekle" ucu da aynı senkrona ihtiyaç duyunca kopyalamak yerine
/// buraya alındı: iki kopya ayrışırsa cari bir ekrandan açıldığında görünür, diğerinden
/// açıldığında görünmez olurdu. <c>CustomersController</c> artık buraya delege ediyor,
/// davranış birebir aynı.
/// </para>
/// </summary>
public static class SalesmanCustomerScopeSync
{
    public static async Task SyncAsync(
        AppDbContext dbContext,
        string customerCode,
        string? newSalesmanCode,
        string? previousSalesmanCode,
        CancellationToken cancellationToken)
    {
        var code = (customerCode ?? string.Empty).Trim();
        if (code.Length == 0) return;

        var next = (newSalesmanCode ?? string.Empty).Trim();
        var prev = (previousSalesmanCode ?? string.Empty).Trim();
        if (string.Equals(next, prev, StringComparison.OrdinalIgnoreCase)) prev = string.Empty;

        var touched = new[] { next, prev }.Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (touched.Count == 0) return;

        var users = await dbContext.Users
            .Where(u => u.SalesmanCode != null && touched.Contains(u.SalesmanCode))
            .ToListAsync(cancellationToken);

        var changed = false;

        foreach (var user in users)
        {
            // Sınırsız kapsamlı kullanıcıya dokunma.
            if (CustomerScope.IsUnrestricted(user.Carikodu)) continue;

            var list = CustomerScope.Parse(user.Carikodu).ToList();
            var has = list.Any(c => string.Equals(c, code, StringComparison.OrdinalIgnoreCase));
            var isNewOwner = string.Equals(user.SalesmanCode, next, StringComparison.OrdinalIgnoreCase) && next.Length > 0;

            if (isNewOwner && !has)
            {
                list.Add(code);
                user.Carikodu = CustomerScope.Format(list);
                changed = true;
            }
            else if (!isNewOwner && has)
            {
                list.RemoveAll(c => string.Equals(c, code, StringComparison.OrdinalIgnoreCase));
                // Liste boşalırsa Format(...) '*' üretir; bu, kısıtlı kullanıcıyı SINIRSIZ yapardı.
                user.Carikodu = list.Count == 0 ? string.Empty : CustomerScope.Format(list);
                changed = true;
            }
        }

        if (changed)
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
    }
}
