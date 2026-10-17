using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Helpers;

/// <summary>
/// PERSONEL PROGRAMINDAN GELEN KASA/BANKA SATIRI KİLİTLİDİR (2026-09-27 kullanıcı kararı).
///
/// <para>Personel ödemeleri B2B kasa/bankasına tek "Personel Ödemesi" satırı olarak yazılıyor
/// (personel servisi, <c>ErpPaymentAccountService</c>); personel kırılımı personel programındaki
/// <c>EmployeeCashTransactions</c> tablosunda duruyor ve satırla <c>ErpTransactionId</c> ile bağlı.
/// Satır buradan düzenlenir ya da silinirse iki taraf ayrışır: personel "ödendi" görünür ama kasa
/// eski tutarda kalır, ya da tersi. Değişiklik personel programından yapılır (düzenle / geri al);
/// o taraf bu satırı kendisi günceller ya da siler. Kredi taksidi hareketindeki kilitle aynı mantık.</para>
///
/// <para>Tablo personel servisi olmayan firmada hiç yoktur. Kolonun varlığı AYRI bir sorguyla
/// yoklanır: aynı sorguda <c>information_schema</c> koşulu PostgreSQL'in eksik kolon hatasını önlemez.</para>
/// </summary>
public static class PersonnelPaymentLock
{
    public const int KindCash = 1;
    public const int KindBank = 2;

    public const string Message =
        "Bu satır personel programından gelen bir personel ödemesidir. Buradan düzenlenemez ve silinemez; " +
        "personel programında ödemeyi düzenleyin ya da geri alın, kasa/banka satırı kendiliğinden güncellenir.";

    public static async Task<bool> IsLockedAsync(AppDbContext dbContext, int kind, int transactionId, CancellationToken cancellationToken)
    {
        var columnExists = await dbContext.Database.SqlQuery<int>($@"
SELECT 1 AS ""Value"" FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'EmployeeCashTransactions' AND column_name = 'ErpTransactionId'")
            .ToListAsync(cancellationToken);
        if (columnExists.Count == 0) return false;

        var hit = await dbContext.Database.SqlQuery<int>($@"
SELECT 1 AS ""Value"" FROM ""EmployeeCashTransactions""
WHERE ""ErpAccountKind"" = {kind} AND ""ErpTransactionId"" = {transactionId}
LIMIT 1").ToListAsync(cancellationToken);
        return hit.Count > 0;
    }
}
