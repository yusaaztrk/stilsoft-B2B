using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.VirtualPos.Core;
using Microsoft.Extensions.Caching.Memory;
using Xunit;

namespace B2B.Erp.Api.Tests;

public class CardPlusCompletionServiceTests
{
    // --- doubles ---------------------------------------------------------------------------

    private sealed class FakeCardPlusClient : ICardPlusClient
    {
        private readonly Func<CardPlusAuthorizationRequest, CardPlusResult> _responder;
        public int CallCount;
        public CardPlusAuthorizationRequest? LastRequest;

        public FakeCardPlusClient(Func<CardPlusAuthorizationRequest, CardPlusResult> responder)
            => _responder = responder;

        public Task<CardPlusResult> AuthorizeAsync(CardPlusAuthorizationRequest request, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref CallCount);
            LastRequest = request;
            return Task.FromResult(_responder(request));
        }
    }

    /// <summary>Mimics the database's conditional update: the first caller wins, once.</summary>
    private sealed class FakeAuthorizationClaim : IPaymentAuthorizationClaim
    {
        private int _claimed;
        public bool AlwaysDeny { get; init; }

        public Task<bool> TryClaimAsync(Guid transactionId, CancellationToken cancellationToken = default)
        {
            if (AlwaysDeny) return Task.FromResult(false);
            return Task.FromResult(Interlocked.CompareExchange(ref _claimed, 1, 0) == 0);
        }
    }

    private static CardPlusResult Approved() => new(
        CardPlusOutcome.Approved, "00", "AUTH123", "HOSTREF1", "TRANS1", "ORDER-136", "CardPlus provizyonu onaylandı.");

    private static CardPlusResult Declined() => new(
        CardPlusOutcome.Declined, "51", "", "", "", "ORDER-136", "Yetersiz bakiye");

    private static CardPlusResult Unknown() => new(
        CardPlusOutcome.Unknown, "", "", "", "", "", "CardPlus bağlantısı zaman aşımına uğradı.");

    private static CardPlusResult ProviderError() => new(
        CardPlusOutcome.ProviderError, "", "", "", "", "", "CardPlus yanıtı çözümlenemedi.");

    // --- fixtures ---------------------------------------------------------------------------

    private static VirtualPosTransaction Transaction(int bankCode = 136) => new()
    {
        Id = Guid.NewGuid(),
        OrderNo = "ORDER-136",
        BankCode = bankCode,
        Amount = 150.75m,
        InstallmentCount = 1,
        CurrencyCode = "TRY",
        Status = (int)VirtualPosPaymentStatus.ThreeDVerified
    };

    private static VirtualPosDefinition PosDefinition() => new()
    {
        BankCode = 136,
        PosType = "NESTPAY",
        UserCode = "USER",
        Password = "PASS",
        ClientId = "CLIENT136",
        XmlUrl = "https://sanalpos.example-test.invalid/fim/api"
    };

    private static VirtualPosCallbackData Callback(
        string cavv = "CAVV", string xid = "XID", string eci = "05")
    {
        var fields = new List<KeyValuePair<string, string>>
        {
            new("oid", "ORDER-136"), new("Response", "Approved"),
            new("ProcReturnCode", "00"), new("mdStatus", "1")
        };
        if (cavv != null) fields.Add(new KeyValuePair<string, string>("cavv", cavv));
        if (xid != null) fields.Add(new KeyValuePair<string, string>("xid", xid));
        if (eci != null) fields.Add(new KeyValuePair<string, string>("eci", eci));
        return new VirtualPosCallbackData(fields);
    }

    private static (CardPlusCompletionService Service, FakeCardPlusClient Client, ITransientPaymentCardStore Store)
        Build(Func<CardPlusAuthorizationRequest, CardPlusResult>? responder = null,
              bool storeCard = true,
              IPaymentAuthorizationClaim? claim = null)
    {
        var client = new FakeCardPlusClient(responder ?? (_ => Approved()));
        var store = new MemoryTransientPaymentCardStore(new MemoryCache(new MemoryCacheOptions { SizeLimit = 100 }));
        if (storeCard) store.Store("ORDER-136", new TransientCardData("4355084355084358", "12", "26"));

        return (new CardPlusCompletionService(client, store, claim ?? new FakeAuthorizationClaim()), client, store);
    }

    // --- 1, 8: happy path ---------------------------------------------------------------------

    [Fact]
    public async Task Valid_callback_calls_cardplus_exactly_once_and_pays()
    {
        var (service, client, _) = Build();
        var tx = Transaction();

        var result = await service.CompleteAsync(tx, PosDefinition(), Callback());

        Assert.Equal(1, client.CallCount);
        Assert.Equal(CardPlusCompletionOutcome.Paid, result.Outcome);
        Assert.Equal((int)VirtualPosPaymentStatus.Authorized, tx.Status);
        Assert.True(tx.IsSuccess);
        Assert.NotNull(tx.CompletedAtUtc);
        Assert.Equal("AUTH123", tx.AuthorizationCode);
        Assert.Equal("HOSTREF1", tx.HostReferenceNumber);
    }

    // --- 7: missing 3D authentication data ------------------------------------------------------

    [Theory]
    [InlineData("", "XID", "05")]
    [InlineData("CAVV", "", "05")]
    [InlineData("CAVV", "XID", "")]
    public async Task Missing_3d_data_never_reaches_the_bank(string cavv, string xid, string eci)
    {
        var (service, client, _) = Build();
        var tx = Transaction();

        var result = await service.CompleteAsync(tx, PosDefinition(), Callback(cavv, xid, eci));

        Assert.Equal(0, client.CallCount);
        Assert.Equal(CardPlusCompletionOutcome.ProviderError, result.Outcome);
        Assert.False(tx.IsSuccess);
    }

    // --- 17, 18: other banks never trigger CardPlus ---------------------------------------------

    [Theory]
    [InlineData(10)]  // Ziraat
    [InlineData(12)]  // Halkbank
    [InlineData(64)]  // İş Bankası
    [InlineData(62)]  // Garanti
    [InlineData(120)] // Koop (routed to Ziraat, never itself)
    public async Task Non_136_banks_never_call_cardplus(int bankCode)
    {
        var (service, client, _) = Build();
        var tx = Transaction(bankCode);

        var result = await service.CompleteAsync(tx, PosDefinition(), Callback());

        Assert.Equal(0, client.CallCount);
        Assert.Equal(CardPlusCompletionOutcome.NotEligible, result.Outcome);
    }

    // --- 9: decline ------------------------------------------------------------------------------

    [Fact]
    public async Task Bank_decline_marks_failed()
    {
        var (service, _, _) = Build(_ => Declined());
        var tx = Transaction();

        var result = await service.CompleteAsync(tx, PosDefinition(), Callback());

        Assert.Equal(CardPlusCompletionOutcome.Declined, result.Outcome);
        Assert.Equal((int)VirtualPosPaymentStatus.Failed, tx.Status);
        Assert.False(tx.IsSuccess);
        Assert.Equal("51", tx.FailureCode);
    }

    // --- 10: timeout is not a failure -------------------------------------------------------------

    [Fact]
    public async Task Timeout_stays_authorization_pending_not_failed()
    {
        var (service, client, _) = Build(_ => Unknown());
        var tx = Transaction();

        var result = await service.CompleteAsync(tx, PosDefinition(), Callback());

        Assert.Equal(CardPlusCompletionOutcome.AuthorizationPending, result.Outcome);
        Assert.Equal((int)VirtualPosPaymentStatus.AuthorizationPending, tx.Status);
        Assert.NotEqual((int)VirtualPosPaymentStatus.Failed, tx.Status);
        Assert.False(tx.IsSuccess);
        Assert.Null(tx.CompletedAtUtc);   // undecided payments do not complete
        Assert.Equal(1, client.CallCount); // no automatic retry
    }

    // --- 11, 12: untrusted answers -----------------------------------------------------------------

    [Fact]
    public async Task Malformed_response_does_not_pay()
    {
        var (service, _, _) = Build(_ => ProviderError());
        var tx = Transaction();

        var result = await service.CompleteAsync(tx, PosDefinition(), Callback());

        Assert.Equal(CardPlusCompletionOutcome.ProviderError, result.Outcome);
        Assert.False(tx.IsSuccess);
        Assert.NotEqual((int)VirtualPosPaymentStatus.Authorized, tx.Status);
    }

    // --- 13, 15, 16: duplicate callbacks -------------------------------------------------------------

    [Fact]
    public async Task Duplicate_callback_sends_only_one_authorization()
    {
        var (service, client, _) = Build();
        var tx = Transaction();
        var posDef = PosDefinition();

        await service.CompleteAsync(tx, posDef, Callback());
        var second = await service.CompleteAsync(tx, posDef, Callback());

        Assert.Equal(1, client.CallCount);
        Assert.Equal(CardPlusCompletionOutcome.AlreadyInProgress, second.Outcome);
    }

    [Fact]
    public async Task Callback_arriving_while_claim_is_held_sends_nothing()
    {
        var (service, client, _) = Build(claim: new FakeAuthorizationClaim { AlwaysDeny = true });
        var tx = Transaction();

        var result = await service.CompleteAsync(tx, PosDefinition(), Callback());

        Assert.Equal(0, client.CallCount);
        Assert.Equal(CardPlusCompletionOutcome.AlreadyInProgress, result.Outcome);
    }

    // --- 14: parallel duplicates ---------------------------------------------------------------------

    [Fact]
    public async Task Parallel_callbacks_send_only_one_authorization()
    {
        var (service, client, _) = Build();
        var tx = Transaction();
        var posDef = PosDefinition();

        var tasks = new Task[8];
        for (var i = 0; i < tasks.Length; i++)
        {
            tasks[i] = service.CompleteAsync(tx, posDef, Callback());
        }
        await Task.WhenAll(tasks);

        Assert.Equal(1, client.CallCount);
    }

    // --- 19: card data unavailable is not a decline ----------------------------------------------------

    [Fact]
    public async Task Missing_transient_card_does_not_call_bank_and_is_not_a_decline()
    {
        var (service, client, _) = Build(storeCard: false);
        var tx = Transaction();

        var result = await service.CompleteAsync(tx, PosDefinition(), Callback());

        Assert.Equal(0, client.CallCount);
        Assert.Equal(CardPlusCompletionOutcome.AuthorizationPending, result.Outcome);
        Assert.Equal((int)VirtualPosPaymentStatus.AuthorizationPending, tx.Status);
        Assert.NotEqual((int)VirtualPosPaymentStatus.Failed, tx.Status);
        Assert.False(tx.IsSuccess);
    }

    // --- card data is consumed and cleared -------------------------------------------------------------

    [Fact]
    public async Task Card_is_removed_after_the_call()
    {
        var (service, _, store) = Build();
        await service.CompleteAsync(Transaction(), PosDefinition(), Callback());

        Assert.Null(store.Consume("ORDER-136"));
    }

    [Fact]
    public async Task Card_is_removed_even_when_the_bank_declines()
    {
        var (service, _, store) = Build(_ => Declined());
        await service.CompleteAsync(Transaction(), PosDefinition(), Callback());

        Assert.Null(store.Consume("ORDER-136"));
    }

    // --- 20: PAN and 3D values never land on the transaction ----------------------------------------------

    [Fact]
    public async Task Pan_and_authentication_values_never_touch_the_transaction()
    {
        var (service, _, _) = Build();
        var tx = Transaction();

        await service.CompleteAsync(tx, PosDefinition(), Callback());

        var persisted = string.Join("|",
            tx.MaskedPan, tx.RequestPayloadMasked, tx.ResponsePayloadMasked,
            tx.FailureMessage, tx.FailureCode, tx.AuthorizationCode,
            tx.HostReferenceNumber, tx.BankTransactionId);

        Assert.DoesNotContain("4355084355084358", persisted);
        Assert.DoesNotContain("CAVV", persisted);
        Assert.DoesNotContain("XID", persisted);
    }

    [Fact]
    public async Task Pan_reaches_only_the_bank_request()
    {
        var (service, client, _) = Build();

        await service.CompleteAsync(Transaction(), PosDefinition(), Callback());

        Assert.Equal("4355084355084358", client.LastRequest!.Pan);
        Assert.Equal("CAVV", client.LastRequest.Cavv);
        Assert.Equal("XID", client.LastRequest.Xid);
        Assert.Equal("05", client.LastRequest.Eci);
    }

    [Fact]
    public async Task Endpoint_and_credentials_come_from_the_pos_definition()
    {
        var (service, client, _) = Build();

        await service.CompleteAsync(Transaction(), PosDefinition(), Callback());

        Assert.Equal("https://sanalpos.example-test.invalid/fim/api", client.LastRequest!.XmlUrl);
        Assert.Equal("CLIENT136", client.LastRequest.ClientId);
    }
}
