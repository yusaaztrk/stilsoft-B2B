using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// CARİ-ÖZEL FİYATIN SAHİBİ (2026-08-20).
///
/// <c>CustomerProductPriceOverrides</c> satırları cari koduna bağlı ve sorgular bugüne kadar
/// ekrandaki cari kodunu doğrudan kullanıyordu. Şubede bu yanlış sonuç veriyor: şube
/// (<c>01-000046-001</c>) ana carinin bir ADRESİ, ayrı bir fiyat müşterisi değil — fiyat grubu
/// da ondan türetiliyor (bkz. <c>CustomersController.ResolveBranchPriceGroupIdAsync</c>). Ana
/// cariye tanımlı özel fiyat şubede uygulanmayınca aynı ürün iki koda iki tutar gösteriyordu.
///
/// Bu yüzden fiyat sahibi şubede BAĞLI CARİDİR; şubeye ayrıca özel fiyat tanımlanmaz
/// (<c>CustomerProductPriceOverridesController</c> şube kodunu reddeder).
///
/// Alt hesaplar (-1/-2/-3) buraya girmez: onlar carinin kendi hesap kırılımı, kod olarak zaten
/// ana carinin altında ve özel fiyat ana cari koduyla tutuluyor.
/// </summary>
public static class CustomerPriceOwner
{
    /// <summary>
    /// Verilen cari şubeyse bağlı carinin kodunu, değilse kodun kendisini döner.
    /// Boş kod ve bulunamayan cari olduğu gibi geri verilir — çağıran taraftaki
    /// "kod yoksa özel fiyat da yok" davranışı korunsun diye.
    /// </summary>
    public static async Task<string?> ResolveAsync(
        AppDbContext dbContext,
        string? customerCode,
        CancellationToken cancellationToken = default)
    {
        if (dbContext is null) return customerCode;

        var code = (customerCode ?? string.Empty).Trim();
        if (code.Length == 0) return customerCode;

        var row = await dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == code)
            .Select(x => new { x.ParentCustomerCode, x.CustomerType })
            .FirstOrDefaultAsync(cancellationToken);

        if (row is null) return customerCode;

        var parent = (row.ParentCustomerCode ?? string.Empty).Trim();
        if (parent.Length == 0) return customerCode;
        if (string.Equals(parent, code, StringComparison.OrdinalIgnoreCase)) return customerCode;

        // Şube ölçütü CustomerAccountService ile aynı: tip alanı ya da kod ön eki. Tip serbest
        // metin ("Şube"/"sube") olduğu için tek başına güvenilmiyor.
        var type = (row.CustomerType ?? string.Empty).Trim().ToLowerInvariant();
        var isBranch = type == "sube"
            || type == "şube"
            || code.StartsWith("01-", StringComparison.OrdinalIgnoreCase);

        return isBranch ? parent : customerCode;
    }
}
