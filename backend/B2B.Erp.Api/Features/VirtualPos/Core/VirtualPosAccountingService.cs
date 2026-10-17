using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

public interface IVirtualPosAccountingService
{
    /// <summary>
    /// Posts the financial records for a captured virtual POS payment. Idempotent and safe
    /// to call again after a failure. Never turns a captured payment into a failed one.
    /// </summary>
    Task<AccountingDecision> FinalizeAccountingAsync(Guid virtualPosTransactionId, CancellationToken cancellationToken = default);
}

/// <summary>
/// The single authoritative path that turns a successful virtual POS payment into ERP
/// financial records. Providers know nothing about the ledger; the callback delegates here.
///
/// Two truths are kept apart:
///   payment truth    — did the bank take the money (owned by the provider/callback)
///   accounting truth — did the ERP record it (owned by this service)
/// A failure of the second never rewrites the first.
/// </summary>
public sealed class VirtualPosAccountingService : IVirtualPosAccountingService
{
    private readonly AppDbContext _dbContext;
    private readonly ILogger<VirtualPosAccountingService> _logger;
    private readonly B2B.Erp.Api.Core.Interfaces.IMoneyServiceClient _money;

    public VirtualPosAccountingService(
        AppDbContext dbContext,
        ILogger<VirtualPosAccountingService> logger,
        B2B.Erp.Api.Core.Interfaces.IMoneyServiceClient money)
    {
        _dbContext = dbContext;
        _logger = logger;
        _money = money;
    }

    public async Task<AccountingDecision> FinalizeAccountingAsync(
        Guid virtualPosTransactionId,
        CancellationToken cancellationToken = default)
    {
        var tx = await _dbContext.VirtualPosTransactions
            .FirstOrDefaultAsync(x => x.Id == virtualPosTransactionId, cancellationToken);

        if (tx == null)
        {
            return new AccountingDecision(AccountingEligibility.PaymentNotAuthorized, "İşlem bulunamadı.");
        }

        // The processing bank was decided at initiation and stored. Routing is never
        // recalculated here — the collection belongs to the POS that actually charged it.
        var (posAccount, bankName) = await ResolvePosBankAsync(tx.BankCode, cancellationToken);

        var decision = VirtualPosAccountingPlanner.Decide(tx, posAccount);

        // Sanal POS işleminin para birimi ZATEN çözülüyor (`VirtualPosTransaction.CurrencyCode`),
        // ama kur sabit 1 yazılıyordu: dolarla çekilen 100'lük işlem deftere 100 TL düşerdi.
        var posRate = 1m;
        if (B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Normalize(decision.CurrencyTypeId) != 1)
        {
            try
            {
                var posCode = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyTypeIdToIsoCode(decision.CurrencyTypeId);
                var fetched = await _money.GetLatestTryRateAsync(posCode, cancellationToken);
                if (fetched > 0m) posRate = fetched;
            }
            catch { posRate = 1m; }
        }
        var posTlAmount = Math.Round(tx.Amount * posRate, 2, MidpointRounding.AwayFromZero);
        if (decision.Eligibility != AccountingEligibility.Ready)
        {
            if (decision.Eligibility == AccountingEligibility.Deferred)
            {
                await MarkPendingAsync(tx, decision.Reason, cancellationToken);
            }
            return decision;
        }

        // Win the right to post. A concurrent caller loses on this conditional update and
        // returns without writing anything, so only one financial set can ever be created.
        var claimed = await _dbContext.VirtualPosTransactions
            .Where(x => x.Id == tx.Id && x.Status != (int)VirtualPosPaymentStatus.AccountingPosted)
            .ExecuteUpdateAsync(
                s => s.SetProperty(x => x.Status, (int)VirtualPosPaymentStatus.AccountingPending),
                cancellationToken);

        if (claimed != 1)
        {
            return new AccountingDecision(AccountingEligibility.AlreadyPosted, "Muhasebe kaydı zaten oluşturulmuş.");
        }

        var reference = decision.Reference;

        await using var dbTransaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            // Second guard, inside the transaction: if a previous attempt got partway and
            // committed, the rows are already there and must not be duplicated.
            var ledgerExists = await _dbContext.CustomerLedgerEntries
                .AnyAsync(x => x.DocumentNo == reference
                            && x.TransactionType == VirtualPosAccountingPlanner.TransactionTypeTag,
                          cancellationToken);

            var bankMovementExists = await _dbContext.BankAccountTransactions
                .AnyAsync(x => x.DocumentNo == reference, cancellationToken);

            var description = VirtualPosAccountingPlanner.BuildDescription(tx, bankName);
            var now = B2B.Erp.Api.Core.Helpers.SystemTime.UtcNow;

            /*
              MUHASEBE TARİHİ İŞLEMİN KENDİ GÜNÜDÜR, MUHASEBELEŞTİRME GÜNÜ DEĞİL (2026-08-31).

              Kayıt ve banka hareketi `now` ile yazılıyordu: yani düğmeye basıldığı gün.
              Normal tahsilatta fark yok — 3D geri çağrısı saniyeler içinde geliyor. Ama geri
              çağrısı hiç gelmemiş bir tahsilat günler sonra elle muhasebeleştirildiğinde para
              YANLIŞ GÜNE düşüyordu: 29.08'de çekilen 42.120 ₺, 31.08'e yazılıyordu.

              Sonuçları: banka ekstresiyle karşılaştırma tutmuyor, POS→vadesiz süpürmesi
              hareketi yanlış günün havuzunda buluyor ve valör hesabı kayıyor.

              `CreateTime` işlemin başlatıldığı andır — paranın çekildiği gün. Süpürücü geç
              gelen hareketi zaten yakalıyor (14 gün geriye bakıyor ve o günün mevcut
              aktarımına ekliyor), bu yüzden geçmiş bir güne yazmak sorun değil.

              `CreateTime`/`EditTime` alanları `now` KALIYOR: onlar denetim damgası, kaydın ne
              zaman oluşturulduğunu söyler. Muhasebe tarihiyle karıştırılmamalı.
            */
            var islemTarihi = tx.CreateTime > new DateTime(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc)
                ? tx.CreateTime
                : now;

            // Banka hareketinin karşı tarafı CARİDİR: `CounterpartyCode` zaten cari kodu yazıyor,
            // ada kart sahibinin adı yazılınca aynı satırda kod ve ad iki farklı kişiyi gösteriyordu
            // (şirket ortağı şahsi kartıyla ödeyince ekstrede kurumsal cari bulunamıyor).
            // Kart sahibi bilgisi silinmiyor, açıklamaya taşınıyor.
            var counterpartyName = await _dbContext.Customers.AsNoTracking()
                .Where(c => c.CustomerCode == tx.CustomerCode)
                .Select(c => c.Name)
                .FirstOrDefaultAsync(cancellationToken);

            if (string.IsNullOrWhiteSpace(counterpartyName)) counterpartyName = tx.CardHolderName;

            var bankDescription = string.IsNullOrWhiteSpace(tx.CardHolderName)
                ? description
                : $"{description} - Kart Sahibi: {tx.CardHolderName}";

            if (!ledgerExists)
            {
                // Money coming in reduces what the customer owes. Direction confirmed against
                // the existing cash and bank collection flows, which both credit on an inflow.
                _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
                {
                    CustomerCode = tx.CustomerCode,
                    Date = islemTarihi,
                    DueDate = islemTarihi,
                    Direction = CustomerLedgerEntryDirection.Credit,
                    Amount = posTlAmount,
                    CurrencyTypeId = decision.CurrencyTypeId,
                    CurrencyRate = posRate,
                    CurrencyAmount = tx.Amount,
                    PaymentCurrencyTypeId = decision.CurrencyTypeId,
                    PaymentCurrencyRate = posRate,
                    PaymentCurrencyAmount = tx.Amount,
                    DocumentNo = reference,
                    Description = description,
                    TransactionType = VirtualPosAccountingPlanner.TransactionTypeTag,
                    ReferenceType = CustomerLedgerEntryReferenceType.Bank,
                    CreateUser = "VIRTUALPOS",
                    CreateTime = now
                });
            }

            if (!bankMovementExists)
            {
                // Banka hareketi POS HESABININ para birimindedir, işlemin değil: TL POS
                // hesabına gelen 100 $'lık (3.800 ₺) tahsilat satıra "USD" yazınca TL banka
                // ekstresi süzgecinde (0/1) kayboluyor, bakiye ise 3.800 ₺ yerine 100 artıyordu.
                // Cari ekstresi tarafı işlemin dövizini taşımaya devam ediyor (yukarıda).
                (int CurrencyTypeId, decimal Rate, decimal CurrencyAmount) bankMv;
                try
                {
                    bankMv = await B2B.Erp.Api.Core.Helpers.AccountMovementCurrency.ResolveAsync(
                        _money, posAccount!.CurrencyTypeId, posTlAmount, cancellationToken);
                }
                catch (InvalidOperationException)
                {
                    // Kur alınamadıysa hareketi POS hesabının para biriminde ama kur 1 ile
                    // yazmak bakiyeyi bozar; işlemin kendi kuruna düşmek en az zararlısı.
                    bankMv = (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(posAccount!.CurrencyTypeId),
                              posRate > 0m ? posRate : 1m,
                              tx.Amount);
                }

                _dbContext.BankAccountTransactions.Add(new BankAccountTransaction
                {
                    BankAccountDefinitionId = posAccount!.Id,
                    Date = islemTarihi,
                    Direction = BankAccountTransactionDirection.In,
                    Amount = posTlAmount,
                    CurrencyTypeId = bankMv.CurrencyTypeId,
                    CurrencyRate = bankMv.Rate,
                    CurrencyAmount = bankMv.CurrencyAmount,
                    CounterpartyType = BankAccountTransactionCounterpartyType.Customer,
                    CounterpartyCode = tx.CustomerCode,
                    CounterpartyName = counterpartyName ?? string.Empty,
                    DocumentNo = reference,
                    Description = bankDescription,
                    IsPosFee = false,
                    CreateUser = "VIRTUALPOS",
                    CreateTime = now
                });
            }

            tx.Status = (int)VirtualPosPaymentStatus.AccountingPosted;
            tx.IsSuccess = true; // payment truth is preserved

            await _dbContext.SaveChangesAsync(cancellationToken);
            await dbTransaction.CommitAsync(cancellationToken);

            return new AccountingDecision(AccountingEligibility.AlreadyPosted, "Muhasebe kaydı oluşturuldu.", reference, decision.CurrencyTypeId);
        }
        catch (Exception ex)
        {
            // Roll the half-written financial records back, then leave the payment exactly as
            // the bank left it. The customer paid; only our bookkeeping is behind.
            await dbTransaction.RollbackAsync(cancellationToken);

            // Structured, non-sensitive detail: without the SqlState and constraint name a
            // deferred posting is impossible to diagnose. No parameter values, no customer
            // data — only what identifies the failing rule.
            var pg = ExtractPostgresDetail(ex);

            _logger.LogError(ex,
                "[VirtualPosAccounting] Accounting failed for payment {OrderNo}; payment stays successful. " +
                "SqlState={SqlState} Constraint={Constraint} Table={Table} Column={Column} Exception={ExceptionType}",
                tx.OrderNo, pg.SqlState, pg.ConstraintName, pg.TableName, pg.ColumnName, ex.GetType().Name);

            await MarkPendingAsync(tx, "Muhasebe kaydı oluşturulamadı, tekrar denenecek.", cancellationToken);

            return new AccountingDecision(AccountingEligibility.Deferred, "Muhasebe kaydı oluşturulamadı.");
        }
    }

    /// <summary>
    /// Pulls the identifying parts of a PostgreSQL error out of an exception chain.
    /// Deliberately limited to schema-level names — never parameter values or row data.
    /// </summary>
    private static (string SqlState, string ConstraintName, string TableName, string ColumnName) ExtractPostgresDetail(Exception ex)
    {
        for (var current = ex; current != null; current = current.InnerException)
        {
            if (current is Npgsql.PostgresException pg)
            {
                return (pg.SqlState ?? "", pg.ConstraintName ?? "", pg.TableName ?? "", pg.ColumnName ?? "");
            }
        }
        return ("", "", "", "");
    }

    /// <summary>
    /// Finds the ERP account a provider's collections land in. Two links exist and the
    /// explicit one wins:
    ///
    ///   1. <c>PosAccountSettings.VirtualPosBankCode</c> — stated as data on the POS Hesap
    ///      Ayarları screen. Survives a rename of either side.
    ///   2. <c>VirtualPosDefinitions.NethesCode</c> matching <c>BankAccountDefinitions.AccountCode</c>
    ///      — the original naming convention, kept so tenants that never touched the screen
    ///      keep working.
    ///
    /// The convention alone was a silent trap: renaming the Ziraat POS account code to
    /// 'ZIRAAT-POS' unbound it from NethesCode 'ZIRAATPOS', and because Ziraat is the default
    /// routing target every card without its own POS stopped posting. Nothing failed loudly —
    /// the postings simply deferred. An explicit binding cannot be broken by an edit that
    /// looks cosmetic.
    ///
    /// Still no fallback beyond these two: an unresolved account defers the posting rather
    /// than guessing an account to put money in.
    ///
    /// The definition's display name comes back in the same round trip. It is the
    /// authoritative name for the processing bank and is only needed for the ledger
    /// description, so it is read here rather than duplicated onto every transaction row.
    /// </summary>
    private async Task<(BankAccountDefinition? Account, string BankName)> ResolvePosBankAsync(
        int bankCode,
        CancellationToken cancellationToken)
    {
        var definition = await _dbContext.VirtualPosDefinitions
            .AsNoTracking()
            .Where(x => x.BankCode == bankCode)
            .Select(x => new { x.NethesCode, x.BankName })
            .FirstOrDefaultAsync(cancellationToken);

        var bankName = definition?.BankName ?? string.Empty;

        var boundAccountId = await _dbContext.PosAccountSettings
            .AsNoTracking()
            .Where(x => x.VirtualPosBankCode == bankCode && x.IsActive)
            .Select(x => (int?)x.PosBankAccountDefinitionId)
            .FirstOrDefaultAsync(cancellationToken);

        if (boundAccountId.HasValue)
        {
            var bound = await _dbContext.BankAccountDefinitions
                .FirstOrDefaultAsync(x => x.Id == boundAccountId.Value, cancellationToken);

            if (bound != null) return (bound, bankName);
        }

        if (string.IsNullOrWhiteSpace(definition?.NethesCode)) return (null, bankName);

        var account = await _dbContext.BankAccountDefinitions
            .FirstOrDefaultAsync(x => x.AccountCode == definition.NethesCode, cancellationToken);

        return (account, bankName);
    }

    /// <summary>
    /// Records that the payment is captured but not yet booked. Written outside the failed
    /// transaction and deliberately not through the payment's own failure fields — an
    /// accounting problem is not a declined payment.
    /// </summary>
    private async Task MarkPendingAsync(VirtualPosTransaction tx, string reason, CancellationToken cancellationToken)
    {
        if (!tx.IsSuccess) return; // nothing captured, nothing to book

        try
        {
            await _dbContext.VirtualPosTransactions
                .Where(x => x.Id == tx.Id && x.Status != (int)VirtualPosPaymentStatus.AccountingPosted)
                .ExecuteUpdateAsync(
                    s => s.SetProperty(x => x.Status, (int)VirtualPosPaymentStatus.AccountingPending),
                    cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[VirtualPosAccounting] Could not flag payment {OrderNo} as accounting-pending.", tx.OrderNo);
        }
    }
}
