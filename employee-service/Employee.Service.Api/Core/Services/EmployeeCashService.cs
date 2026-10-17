using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

/// <summary>
/// Personel kasasının tek yazma/okuma kapısı.
///
/// <para>ERP'nin <c>CashAccounts</c> / <c>CashAccountTransactions</c> tablolarına DOKUNMAZ.
/// employee-service ana ERP ile aynı tenant veritabanında olduğu için personel maaş çıkışları
/// bir süre <c>SELECT Id FROM "CashAccounts" LIMIT 1</c> ile bayinin gerçek kasasına yazılıyordu.
/// Kullanıcı kararı (2026-08-18): personel kasası ayrı tablolarda dursun, ileride gerçek bayi
/// kasa/banka yapısına bağlanacağı için bağımsız kalsın.</para>
///
/// <para>ERP'nin gerçek hesap hareketlerini yazan yol ayrıdır ve
/// <see cref="AccountMovementSettings"/> ile KAPALIDIR; buradaki personel kasası ondan
/// bağımsız olarak her zaman yazar.</para>
/// </summary>
public sealed class EmployeeCashService
{
    private readonly AppDbContext _dbContext;
    private readonly ErpPaymentAccountService _erp;

    public EmployeeCashService(AppDbContext dbContext, ErpPaymentAccountService erp)
    {
        _dbContext = dbContext;
        _erp = erp;
    }

    /// <summary>Varsayılan personel kasasını döner, yoksa oluşturur. Bakiye eksiye düşebilir.</summary>
    public async Task<EmployeeCashAccount> GetOrCreateDefaultAccountAsync(
        int? requestedId,
        CancellationToken cancellationToken)
    {
        if (requestedId is > 0)
        {
            var requested = await _dbContext.EmployeeCashAccounts
                .FirstOrDefaultAsync(x => x.Id == requestedId.Value, cancellationToken);
            if (requested is not null) return requested;
        }

        var existing = await _dbContext.EmployeeCashAccounts
            .OrderBy(x => x.Id)
            .FirstOrDefaultAsync(x => x.IsActive, cancellationToken);

        if (existing is not null) return existing;

        var created = new EmployeeCashAccount
        {
            Code = "PERSONEL-KASA-01",
            Name = "Personel Ana Kasa",
            CurrencyTypeId = 1,
            IsActive = true,
            CreateUser = "System",
            CreateTime = DateTime.UtcNow
        };

        _dbContext.EmployeeCashAccounts.Add(created);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return created;
    }

    /// <summary>Tekil ödeme için kasa çıkışı yazar.</summary>
    public EmployeeCashTransaction AddSingleOut(
        int cashAccountId,
        EmployeePayment payment,
        string counterpartyName,
        string description,
        string username)
    {
        var tx = new EmployeeCashTransaction
        {
            EmployeeCashAccountId = cashAccountId,
            Date = payment.PaymentDate,
            Direction = EmployeeCashDirection.Out,
            Amount = payment.Amount,
            EmployeeId = payment.EmployeeId,
            PaymentId = payment.Id,
            PaymentType = (int)payment.Type,
            SalaryPeriod = payment.SalaryPeriod,
            ReferenceNo = payment.ReferenceNo,
            IsBulk = false,
            CounterpartyName = counterpartyName,
            Description = description,
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        };

        _dbContext.EmployeeCashTransactions.Add(tx);
        return tx;
    }

    /// <summary>
    /// Toplu ödemenin ÜST kasa kaydını yazar. Kasa bakiyesine sayılan satır budur;
    /// personel kırılımı <see cref="AddBulkChild"/> ile bu satıra bağlanır.
    /// </summary>
    public EmployeeCashTransaction AddBulkParent(
        int cashAccountId,
        DateTime date,
        decimal totalAmount,
        int paymentType,
        string? salaryPeriod,
        string referenceNo,
        string description,
        string username)
    {
        var tx = new EmployeeCashTransaction
        {
            EmployeeCashAccountId = cashAccountId,
            Date = date,
            Direction = EmployeeCashDirection.Out,
            Amount = totalAmount,
            EmployeeId = null,
            PaymentId = null,
            PaymentType = paymentType,
            SalaryPeriod = salaryPeriod,
            ReferenceNo = referenceNo,
            IsBulk = true,
            CounterpartyName = description,
            Description = description,
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        };

        _dbContext.EmployeeCashTransactions.Add(tx);
        return tx;
    }

    /// <summary>
    /// Toplu ödemenin personel kırılım satırı. Bakiyeye SAYILMAZ — üst kayıt zaten toplamı
    /// düşüyor, ikisi birden sayılırsa kasadan iki kat para çıkmış görünür.
    /// </summary>
    public EmployeeCashTransaction AddBulkChild(
        int cashAccountId,
        int parentTransactionId,
        EmployeePayment payment,
        string counterpartyName,
        string description,
        string username)
    {
        var tx = new EmployeeCashTransaction
        {
            EmployeeCashAccountId = cashAccountId,
            Date = payment.PaymentDate,
            Direction = EmployeeCashDirection.Out,
            Amount = payment.Amount,
            EmployeeId = payment.EmployeeId,
            PaymentId = payment.Id,
            PaymentType = (int)payment.Type,
            SalaryPeriod = payment.SalaryPeriod,
            ReferenceNo = payment.ReferenceNo,
            ParentTransactionId = parentTransactionId,
            IsBulk = false,
            CounterpartyName = counterpartyName,
            Description = description,
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        };

        _dbContext.EmployeeCashTransactions.Add(tx);
        return tx;
    }

    /// <summary>
    /// Bir ödeme geri alındığında kasa tarafını temizler.
    ///
    /// <para>Kullanıcı kararı: geri al = kaydı sil (hard delete). Toplu ödemenin bir satırı
    /// silinirse ÜST kaydın tutarı silinen kadar azaltılır; alt kayıt kalmadıysa üst kayıt da
    /// kaldırılır. Aksi hâlde kasadan çıkmış görünen para geri dönmezdi.</para>
    /// </summary>
    public async Task RemoveByPaymentIdAsync(int paymentId, CancellationToken cancellationToken, string username = "System")
    {
        var rows = await _dbContext.EmployeeCashTransactions
            .Where(x => x.PaymentId == paymentId)
            .ToListAsync(cancellationToken);

        if (rows.Count == 0) return;

        // Tekil ödemenin B2B kasa/banka satırı da silinir (bkz. ErpPaymentAccountService).
        foreach (var single in rows.Where(x => !x.ParentTransactionId.HasValue))
        {
            await _erp.DeleteAsync(single, cancellationToken);
        }

        var parentIds = rows.Where(x => x.ParentTransactionId.HasValue)
            .Select(x => x.ParentTransactionId!.Value)
            .Distinct()
            .ToList();

        _dbContext.EmployeeCashTransactions.RemoveRange(rows);

        foreach (var parentId in parentIds)
        {
            var parent = await _dbContext.EmployeeCashTransactions
                .FirstOrDefaultAsync(x => x.Id == parentId, cancellationToken);
            if (parent is null) continue;

            var removedTotal = rows.Where(x => x.ParentTransactionId == parentId).Sum(x => x.Amount);
            parent.Amount -= removedTotal;

            var remaining = await _dbContext.EmployeeCashTransactions
                .CountAsync(x => x.ParentTransactionId == parentId && !rows.Select(r => r.Id).Contains(x.Id), cancellationToken);

            if (remaining <= 0 || parent.Amount <= 0m)
            {
                _dbContext.EmployeeCashTransactions.Remove(parent);
                await _erp.DeleteAsync(parent, cancellationToken);
            }
            else
            {
                // Toplu ödemeden bir kişi geri alındı: B2B'deki toplam satır da o kadar düşer.
                await _erp.SyncAsync(parent, username, cancellationToken);
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// ÖDEME DÜZENLEME (2026-09-27): ödemenin kasa satırını yeni tutar/tarihle günceller ve B2B
    /// kasa/banka satırını senkronlar. Toplu ödemedeki bir kişinin tutarı değişirse ÜST kaydın
    /// toplamı farkı kadar değişir ve B2B'deki toplam satır ona göre güncellenir; üst kaydın
    /// tarihi toplu işlemin tarihi olarak kalır.
    /// </summary>
    public async Task UpdateByPaymentAsync(EmployeePayment payment, string username, CancellationToken cancellationToken)
    {
        var rows = await _dbContext.EmployeeCashTransactions
            .Where(x => x.PaymentId == payment.Id)
            .ToListAsync(cancellationToken);

        foreach (var row in rows)
        {
            var delta = payment.Amount - row.Amount;
            row.Amount = payment.Amount;
            row.Date = payment.PaymentDate;
            row.SalaryPeriod = payment.SalaryPeriod;
            row.EditUser = username;
            row.EditTime = DateTime.UtcNow;

            if (row.ParentTransactionId.HasValue)
            {
                var parent = await _dbContext.EmployeeCashTransactions
                    .FirstOrDefaultAsync(x => x.Id == row.ParentTransactionId.Value, cancellationToken);
                if (parent is null) continue;
                parent.Amount += delta;
                parent.EditUser = username;
                parent.EditTime = DateTime.UtcNow;
                await _erp.SyncAsync(parent, username, cancellationToken);
            }
            else
            {
                await _erp.SyncAsync(row, username, cancellationToken);
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
    }
}
