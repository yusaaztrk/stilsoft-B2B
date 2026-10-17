using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.VirtualPos.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace B2B.Erp.Api.Tests.Integration;

/// <summary>
/// Relational guarantees of virtual POS accounting, verified against real PostgreSQL:
/// partial unique indexes, transaction rollback, and concurrent conditional updates.
/// These cannot be trusted on an in-memory provider.
/// </summary>
[Collection("postgres")]
public sealed class AccountingIntegrationTests
{
    private readonly PostgresTestFixture _fixture;

    public AccountingIntegrationTests(PostgresTestFixture fixture) => _fixture = fixture;

    private bool PostgresUnavailable => !_fixture.IsAvailable;

    private static readonly CapturingLogger<VirtualPosAccountingService> _capturingLogger = new();

    /// <summary>
    /// Sabit kur: bu testler ilişkisel garantileri ölçüyor, kur servisini değil. Ağa çıkmadan
    /// deterministik kalsın diye TL 1, diğerleri 30 döner.
    /// </summary>
    private sealed class FixedRateMoneyClient : B2B.Erp.Api.Core.Interfaces.IMoneyServiceClient
    {
        public Task<decimal> GetLatestTryRateAsync(string currencyCode, CancellationToken cancellationToken)
            => Task.FromResult(string.Equals(currencyCode, "TRY", StringComparison.OrdinalIgnoreCase) ? 1m : 30m);
    }

    private static readonly FixedRateMoneyClient _money = new();

    private VirtualPosAccountingService NewService(AppDbContext db)
        => new(db, _capturingLogger, _money);

    // --- fixtures -------------------------------------------------------------------------

    private const string CustomerCode = "120-01-000999";

    /// <summary>Test-only values; no production credential is ever used.</summary>
    private static readonly (int BankCode, string Nethes, string Name)[] PosBanks =
    {
        (10, "ZIRAATPOS", "ZİRAAT BANKASI POS HESABI"),
        (12, "HALKPOS", "HALK BANKASI POS HESABI"),
        (62, "GARANTIPOS", "GARANTİ BANKASI POS HESABI"),
        (64, "ISPOS", "İŞBANK POS HESABI"),
        (136, "CREDITPOS", "CREDITWEST POS HESABI")
    };

    private async Task<string> SeedAsync(
        bool withCustomer = true,
        bool withBankAccounts = true,
        int[]? onlyBankCodes = null)
    {
        var suffix = Guid.NewGuid().ToString("N").Substring(0, 8).ToUpperInvariant();
        await using var db = _fixture.CreateContext();

        if (withCustomer && !await db.Customers.AnyAsync(x => x.CustomerCode == CustomerCode))
        {
            db.Customers.Add(new Customer
            {
                CustomerCode = CustomerCode,
                Name = "TEST CARİ",
                CustomerType = "Bayi",
                InvoiceType = "ACIK",
                IsActive = true,
                CreateUser = "TEST",
                CreateTime = DateTime.UtcNow
            });
        }

        var detail = await db.Set<BankDetail>().FirstOrDefaultAsync();
        if (detail == null)
        {
            detail = new BankDetail { Name = "TEST BANKASI", BankDetailCode = "T" + suffix, IsActive = true };
            db.Set<BankDetail>().Add(detail);
            await db.SaveChangesAsync();
        }

        foreach (var (bankCode, nethes, name) in PosBanks)
        {
            if (onlyBankCodes != null && !onlyBankCodes.Contains(bankCode)) continue;

            if (!await db.VirtualPosDefinitions.AnyAsync(x => x.BankCode == bankCode))
            {
                db.VirtualPosDefinitions.Add(new VirtualPosDefinition
                {
                    BankCode = bankCode,
                    BankName = name,
                    PosType = "NESTPAY",
                    NethesCode = nethes,
                    IsActive = true
                });
            }

            if (withBankAccounts && !await db.BankAccountDefinitions.AnyAsync(x => x.AccountCode == nethes))
            {
                db.BankAccountDefinitions.Add(new BankAccountDefinition
                {
                    BankDetailId = detail.Id,
                    AccountCode = nethes,
                    AccountName = name,
                    AccountNo = "TEST-" + bankCode,
                    AccountType = 14,
                    CurrencyTypeId = 1,
                    CreateUser = "TEST",
                    CreateTime = DateTime.UtcNow
                });
            }
        }

        await db.SaveChangesAsync();
        return suffix;
    }

    private async Task<Guid> CreatePaymentAsync(
        int bankCode = 10,
        VirtualPosPaymentStatus status = VirtualPosPaymentStatus.Authorized,
        bool isSuccess = true,
        string customerCode = CustomerCode,
        string currency = "TRY")
    {
        await using var db = _fixture.CreateContext();

        var tx = new VirtualPosTransaction
        {
            OrderNo = "SP" + Guid.NewGuid().ToString("N").ToUpperInvariant(),
            CustomerCode = customerCode,
            BankCode = bankCode,
            BankName = "TEST",
            Amount = 250.00m,
            CurrencyCode = currency,
            InstallmentCount = 1,
            Status = (int)status,
            IsSuccess = isSuccess,
            CreateTime = DateTime.UtcNow
        };

        db.VirtualPosTransactions.Add(tx);
        await db.SaveChangesAsync();
        return tx.Id;
    }

    private async Task<(int Ledger, int Bank, VirtualPosPaymentStatus Status, bool IsSuccess)> ReadStateAsync(Guid id)
    {
        await using var db = _fixture.CreateContext();
        var tx = await db.VirtualPosTransactions.AsNoTracking().FirstAsync(x => x.Id == id);
        var reference = VirtualPosAccountingPlanner.BuildReference(tx.OrderNo);

        var ledger = await db.CustomerLedgerEntries.CountAsync(x => x.DocumentNo == reference);
        var bank = await db.BankAccountTransactions.CountAsync(x => x.DocumentNo == reference);

        return (ledger, bank, (VirtualPosPaymentStatus)tx.Status, tx.IsSuccess);
    }

    // --- 2, 4: migration applied and predicates real ------------------------------------------

    [SkippableFact]
    public async Task Partial_unique_indexes_exist_with_expected_predicates()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");

        await using var db = _fixture.CreateContext();
        var rows = await db.Database
            .SqlQueryRaw<string>(@"SELECT indexdef AS ""Value"" FROM pg_indexes
                                   WHERE indexname IN ('IX_CustomerLedgerEntries_VirtualPosReference',
                                                       'IX_BankAccountTransactions_VirtualPosReference')")
            .ToListAsync();

        Assert.Equal(2, rows.Count);
        Assert.Contains(rows, r => r.Contains("UNIQUE") && r.Contains("Sanal POS Tahsilat"));
        Assert.Contains(rows, r => r.Contains("UNIQUE") && r.Contains("VP-"));
    }

    // --- 3: happy path -----------------------------------------------------------------------

    [SkippableFact]
    public async Task Authorized_payment_posts_exactly_one_ledger_and_one_bank_movement()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");
        await SeedAsync();

        var id = await CreatePaymentAsync();

        await using (var db = _fixture.CreateContext())
        {
            await NewService(db).FinalizeAccountingAsync(id);
        }

        var state = await ReadStateAsync(id);

        Assert.True(state.Ledger == 1, "Ledger=" + state.Ledger + " Status=" + state.Status + " LOG: " + _capturingLogger.LastError);
        Assert.Equal(1, state.Bank);
        Assert.Equal(VirtualPosPaymentStatus.AccountingPosted, state.Status);
        Assert.True(state.IsSuccess);

        // Direction: an inflow credits the customer and enters the bank
        await using var check = _fixture.CreateContext();
        var tx = await check.VirtualPosTransactions.AsNoTracking().FirstAsync(x => x.Id == id);
        var reference = VirtualPosAccountingPlanner.BuildReference(tx.OrderNo);

        var ledger = await check.CustomerLedgerEntries.AsNoTracking().FirstAsync(x => x.DocumentNo == reference);
        var bank = await check.BankAccountTransactions.AsNoTracking().FirstAsync(x => x.DocumentNo == reference);

        Assert.Equal(CustomerLedgerEntryDirection.Credit, ledger.Direction);
        Assert.Equal(BankAccountTransactionDirection.In, bank.Direction);
        Assert.Equal(250.00m, ledger.Amount);
        Assert.Equal(250.00m, bank.Amount);
    }

    // --- 4: duplicate finalize ------------------------------------------------------------------

    [SkippableFact]
    public async Task Finalizing_twice_produces_one_financial_set()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");
        await SeedAsync();

        var id = await CreatePaymentAsync();

        for (var i = 0; i < 2; i++)
        {
            await using var db = _fixture.CreateContext();
            await NewService(db).FinalizeAccountingAsync(id);
        }

        var state = await ReadStateAsync(id);

        Assert.Equal(1, state.Ledger);
        Assert.Equal(1, state.Bank);
        Assert.Equal(VirtualPosPaymentStatus.AccountingPosted, state.Status);
    }

    // --- 5: eight-way concurrency ------------------------------------------------------------------

    [SkippableFact]
    public async Task Eight_parallel_finalizations_produce_one_financial_set()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");
        await SeedAsync();

        var id = await CreatePaymentAsync();

        // Each task gets its own context: DbContext is not thread safe
        var tasks = Enumerable.Range(0, 8).Select(async _ =>
        {
            try
            {
                await using var db = _fixture.CreateContext();
                await NewService(db).FinalizeAccountingAsync(id);
            }
            catch (Exception ex)
            {
                // Losing the race must not surface as an unhandled failure
                return ex;
            }
            return null;
        });

        var errors = (await Task.WhenAll(tasks)).Where(e => e != null).ToList();
        var state = await ReadStateAsync(id);

        Assert.Empty(errors);
        Assert.Equal(1, state.Ledger);
        Assert.Equal(1, state.Bank);
        Assert.Equal(VirtualPosPaymentStatus.AccountingPosted, state.Status);
        Assert.True(state.IsSuccess);
    }

    // --- 6: the database itself refuses a duplicate ----------------------------------------------

    [SkippableFact]
    public async Task Database_rejects_a_duplicate_ledger_reference_even_bypassing_the_service()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");
        await SeedAsync();

        var reference = "VP-DIRECT-" + Guid.NewGuid().ToString("N").Substring(0, 8);

        async Task InsertAsync()
        {
            await using var db = _fixture.CreateContext();
            db.CustomerLedgerEntries.Add(new CustomerLedgerEntry
            {
                CustomerCode = CustomerCode,
                Date = DateTime.UtcNow,
                Direction = CustomerLedgerEntryDirection.Credit,
                Amount = 10m,
                CurrencyTypeId = 1,
                CurrencyRate = 1m,
                CurrencyAmount = 10m,
                DocumentNo = reference,
                TransactionType = VirtualPosAccountingPlanner.TransactionTypeTag,
                ReferenceType = CustomerLedgerEntryReferenceType.Bank,
                CreateUser = "TEST",
                CreateTime = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await InsertAsync();
        await Assert.ThrowsAnyAsync<DbUpdateException>(InsertAsync);
    }

    [SkippableFact]
    public async Task Database_rejects_a_duplicate_bank_movement_reference()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");
        await SeedAsync();

        await using var seed = _fixture.CreateContext();
        var accountId = await seed.BankAccountDefinitions.Where(x => x.AccountCode == "ZIRAATPOS").Select(x => x.Id).FirstAsync();

        var reference = "VP-BANKDUP-" + Guid.NewGuid().ToString("N").Substring(0, 8);

        async Task InsertAsync()
        {
            await using var db = _fixture.CreateContext();
            db.BankAccountTransactions.Add(new BankAccountTransaction
            {
                BankAccountDefinitionId = accountId,
                Date = DateTime.UtcNow,
                Direction = BankAccountTransactionDirection.In,
                Amount = 10m,
                CurrencyTypeId = 1,
                CurrencyRate = 1m,
                CurrencyAmount = 10m,
                CounterpartyType = BankAccountTransactionCounterpartyType.Customer,
                CounterpartyCode = CustomerCode,
                CounterpartyName = "TEST",
                DocumentNo = reference,
                CreateUser = "TEST",
                CreateTime = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await InsertAsync();
        await Assert.ThrowsAnyAsync<DbUpdateException>(InsertAsync);
    }

    [SkippableFact]
    public async Task Ordinary_document_numbers_may_still_repeat()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");
        await SeedAsync();

        // The indexes are partial; normal ERP documents must be unaffected
        async Task InsertAsync()
        {
            await using var db = _fixture.CreateContext();
            db.CustomerLedgerEntries.Add(new CustomerLedgerEntry
            {
                CustomerCode = CustomerCode,
                Date = DateTime.UtcNow,
                Direction = CustomerLedgerEntryDirection.Debit,
                Amount = 10m,
                CurrencyTypeId = 1,
                CurrencyRate = 1m,
                CurrencyAmount = 10m,
                DocumentNo = "FTR-SHARED-001",
                TransactionType = "Fatura",
                ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                CreateUser = "TEST",
                CreateTime = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await InsertAsync();
        await InsertAsync(); // must not throw

        await using var check = _fixture.CreateContext();
        Assert.Equal(2, await check.CustomerLedgerEntries.CountAsync(x => x.DocumentNo == "FTR-SHARED-001"));
    }

    // --- 10, 11, 12: missing ERP data defers, payment survives ---------------------------------------

    [SkippableFact]
    public async Task Missing_bank_account_leaves_payment_successful_and_writes_nothing()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");
        await SeedAsync(withBankAccounts: false, onlyBankCodes: new[] { 999 });

        // Bank 999 has neither POS definition nor bank account
        var id = await CreatePaymentAsync(bankCode: 999);

        await using (var db = _fixture.CreateContext())
        {
            await NewService(db).FinalizeAccountingAsync(id);
        }

        var state = await ReadStateAsync(id);

        Assert.Equal(0, state.Ledger);
        Assert.Equal(0, state.Bank);
        Assert.True(state.IsSuccess);
        Assert.Equal(VirtualPosPaymentStatus.AccountingPending, state.Status);
    }

    [SkippableFact]
    public async Task Unmappable_currency_leaves_payment_successful_and_writes_nothing()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");
        await SeedAsync();

        var id = await CreatePaymentAsync(currency: "XYZ");

        await using (var db = _fixture.CreateContext())
        {
            await NewService(db).FinalizeAccountingAsync(id);
        }

        var state = await ReadStateAsync(id);

        Assert.Equal(0, state.Ledger);
        Assert.Equal(0, state.Bank);
        Assert.True(state.IsSuccess);
        Assert.Equal(VirtualPosPaymentStatus.AccountingPending, state.Status);
    }

    // --- 8: retry after the data problem is fixed ------------------------------------------------------

    [SkippableFact]
    public async Task Retry_after_a_deferral_posts_exactly_once()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");
        await SeedAsync(onlyBankCodes: new[] { 10 });

        // Bank 77 has a POS definition but no bank account yet
        await using (var db = _fixture.CreateContext())
        {
            db.VirtualPosDefinitions.Add(new VirtualPosDefinition
            {
                BankCode = 77, BankName = "GEÇİCİ", PosType = "NESTPAY", NethesCode = "LATEPOS", IsActive = true
            });
            await db.SaveChangesAsync();
        }

        var id = await CreatePaymentAsync(bankCode: 77);

        await using (var db = _fixture.CreateContext())
        {
            await NewService(db).FinalizeAccountingAsync(id);
        }

        var deferred = await ReadStateAsync(id);
        Assert.Equal(0, deferred.Ledger);
        Assert.Equal(VirtualPosPaymentStatus.AccountingPending, deferred.Status);

        // Operator creates the missing account, then retries
        await using (var db = _fixture.CreateContext())
        {
            var detailId = await db.Set<BankDetail>().Select(x => x.Id).FirstAsync();
            db.BankAccountDefinitions.Add(new BankAccountDefinition
            {
                BankDetailId = detailId, AccountCode = "LATEPOS", AccountName = "GEÇ TANIMLANAN POS",
                AccountNo = "TEST-77", AccountType = 14, CurrencyTypeId = 1,
                CreateUser = "TEST", CreateTime = DateTime.UtcNow
            });
            await db.SaveChangesAsync();
        }

        await using (var db = _fixture.CreateContext())
        {
            var retry = new VirtualPosAccountingRetryService(db, NewService(db), NullLogger<VirtualPosAccountingRetryService>.Instance);
            await retry.RetryPendingAccountingAsync();
        }

        var final = await ReadStateAsync(id);
        Assert.Equal(1, final.Ledger);
        Assert.Equal(1, final.Bank);
        Assert.Equal(VirtualPosPaymentStatus.AccountingPosted, final.Status);
    }

    // --- 9: posting again is a no-op ----------------------------------------------------------------------

    [SkippableFact]
    public async Task Finalizing_an_already_posted_payment_changes_nothing()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");
        await SeedAsync();

        var id = await CreatePaymentAsync();

        await using (var db = _fixture.CreateContext())
        {
            await NewService(db).FinalizeAccountingAsync(id);
        }

        var before = await ReadStateAsync(id);

        await using (var db = _fixture.CreateContext())
        {
            var decision = await NewService(db).FinalizeAccountingAsync(id);
            Assert.Equal(AccountingEligibility.AlreadyPosted, decision.Eligibility);
        }

        var after = await ReadStateAsync(id);

        Assert.Equal(before.Ledger, after.Ledger);
        Assert.Equal(before.Bank, after.Bank);
        Assert.Equal(VirtualPosPaymentStatus.AccountingPosted, after.Status);
    }

    // --- 13: every processing bank maps to its own POS account ------------------------------------------------

    [SkippableTheory]
    [InlineData(10, "ZIRAATPOS")]
    [InlineData(12, "HALKPOS")]
    [InlineData(62, "GARANTIPOS")]
    [InlineData(64, "ISPOS")]
    [InlineData(136, "CREDITPOS")]
    public async Task Each_bank_code_posts_to_its_own_pos_account(int bankCode, string expectedAccountCode)
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");
        await SeedAsync();

        var id = await CreatePaymentAsync(bankCode: bankCode);

        await using (var db = _fixture.CreateContext())
        {
            await NewService(db).FinalizeAccountingAsync(id);
        }

        await using var check = _fixture.CreateContext();
        var tx = await check.VirtualPosTransactions.AsNoTracking().FirstAsync(x => x.Id == id);
        var reference = VirtualPosAccountingPlanner.BuildReference(tx.OrderNo);

        var movement = await check.BankAccountTransactions.AsNoTracking().FirstAsync(x => x.DocumentNo == reference);
        var account = await check.BankAccountDefinitions.AsNoTracking().FirstAsync(x => x.Id == movement.BankAccountDefinitionId);

        Assert.Equal(expectedAccountCode, account.AccountCode);
    }

    // --- 14: CardPlus ordering ---------------------------------------------------------------------------------

    [SkippableTheory]
    [InlineData(VirtualPosPaymentStatus.ThreeDVerified)]
    [InlineData(VirtualPosPaymentStatus.AuthorizationPending)]
    [InlineData(VirtualPosPaymentStatus.ProviderError)]
    [InlineData(VirtualPosPaymentStatus.Failed)]
    public async Task Creditwest_posts_nothing_before_cardplus_authorizes(VirtualPosPaymentStatus status)
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");
        await SeedAsync();

        var id = await CreatePaymentAsync(bankCode: 136, status: status, isSuccess: false);

        await using (var db = _fixture.CreateContext())
        {
            await NewService(db).FinalizeAccountingAsync(id);
        }

        var state = await ReadStateAsync(id);

        Assert.Equal(0, state.Ledger);
        Assert.Equal(0, state.Bank);
        Assert.NotEqual(VirtualPosPaymentStatus.AccountingPosted, state.Status);
    }

    [SkippableFact]
    public async Task Creditwest_posts_once_cardplus_has_authorized()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");
        await SeedAsync();

        var id = await CreatePaymentAsync(bankCode: 136, status: VirtualPosPaymentStatus.Authorized, isSuccess: true);

        await using (var db = _fixture.CreateContext())
        {
            await NewService(db).FinalizeAccountingAsync(id);
        }

        var state = await ReadStateAsync(id);

        Assert.Equal(1, state.Ledger);
        Assert.Equal(1, state.Bank);
        Assert.Equal(VirtualPosPaymentStatus.AccountingPosted, state.Status);
    }
}
