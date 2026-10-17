using System;
using System.Threading.Tasks;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace B2B.Erp.Api.Tests.Integration;

/// <summary>
/// Proves that the fields the money path reads back actually survive a round trip through
/// PostgreSQL.
///
/// These exist because CurrencyCode, HostReferenceNumber and CompletedAtUtc were [NotMapped]:
/// every write looked correct in memory and every reload silently returned the property
/// default. A test that asserts on the same context that wrote the value cannot catch that,
/// so each case here disposes the writing context and reads through a new one.
/// </summary>
[Collection("postgres")]
public sealed class VirtualPosPersistenceTests
{
    private readonly PostgresTestFixture _fixture;

    public VirtualPosPersistenceTests(PostgresTestFixture fixture) => _fixture = fixture;

    private bool PostgresUnavailable => !_fixture.IsAvailable;

    private static VirtualPosTransaction NewTransaction() => new()
    {
        OrderNo = "SP" + Guid.NewGuid().ToString("N").ToUpperInvariant(),
        CustomerCode = "120-01-000999",
        BankCode = 10,
        Amount = 250.00m,
        InstallmentCount = 1,
        Status = (int)VirtualPosPaymentStatus.Authorized,
        IsSuccess = true,
        CreateTime = DateTime.UtcNow
    };

    /// <summary>Writes the transaction, drops the context, and reads it back through a new one.</summary>
    private async Task<VirtualPosTransaction> RoundTripAsync(VirtualPosTransaction tx)
    {
        await using (var write = _fixture.CreateContext())
        {
            write.VirtualPosTransactions.Add(tx);
            await write.SaveChangesAsync();
        }

        await using var read = _fixture.CreateContext();
        return await read.VirtualPosTransactions.AsNoTracking().FirstAsync(x => x.Id == tx.Id);
    }

    [SkippableFact]
    public async Task Currency_code_survives_a_reload()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");

        var tx = NewTransaction();
        tx.CurrencyCode = "EUR";

        var reloaded = await RoundTripAsync(tx);

        Assert.Equal("EUR", reloaded.CurrencyCode);
    }

    [SkippableFact]
    public async Task Currency_code_is_not_silently_replaced_by_the_base_currency()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");

        // The exact failure this column was added for: a non-TRY payment coming back as TRY
        // and being booked in the wrong currency.
        foreach (var code in new[] { "USD", "GBP", "EUR" })
        {
            var tx = NewTransaction();
            tx.CurrencyCode = code;

            var reloaded = await RoundTripAsync(tx);

            Assert.Equal(code, reloaded.CurrencyCode);
            Assert.NotEqual("TRY", reloaded.CurrencyCode);
        }
    }

    [SkippableFact]
    public async Task Host_reference_number_survives_a_reload()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");

        var tx = NewTransaction();
        tx.HostReferenceNumber = "HOSTREF-0099887766";

        var reloaded = await RoundTripAsync(tx);

        Assert.Equal("HOSTREF-0099887766", reloaded.HostReferenceNumber);
    }

    [SkippableFact]
    public async Task Completed_at_survives_a_reload()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");

        var settled = new DateTime(2026, 8, 4, 12, 30, 0, DateTimeKind.Utc);

        var tx = NewTransaction();
        tx.CompletedAtUtc = settled;

        var reloaded = await RoundTripAsync(tx);

        Assert.NotNull(reloaded.CompletedAtUtc);
        Assert.Equal(settled, reloaded.CompletedAtUtc!.Value.ToUniversalTime());
    }

    [SkippableFact]
    public async Task An_undecided_payment_keeps_a_null_completion_time()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");

        // Null is a real state — "the bank never gave a final answer" — and must not be
        // rounded off to a timestamp by the round trip.
        var tx = NewTransaction();
        tx.Status = (int)VirtualPosPaymentStatus.AuthorizationPending;
        tx.IsSuccess = false;
        tx.CompletedAtUtc = null;

        var reloaded = await RoundTripAsync(tx);

        Assert.Null(reloaded.CompletedAtUtc);
    }

    [SkippableFact]
    public async Task A_transaction_written_without_a_currency_defaults_to_the_base_currency()
    {
        Skip.If(PostgresUnavailable, "PostgreSQL unavailable");

        var tx = NewTransaction(); // CurrencyCode left at its initial value

        var reloaded = await RoundTripAsync(tx);

        Assert.Equal("TRY", reloaded.CurrencyCode);
    }
}
