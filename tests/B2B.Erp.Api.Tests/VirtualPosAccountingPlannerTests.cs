using System;
using System.Collections.Generic;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.VirtualPos.Core;
using Xunit;

namespace B2B.Erp.Api.Tests;

public class VirtualPosAccountingPlannerTests
{
    /// <summary>
    /// Hesap numarası bilinçli olarak dolu: numarasız bir tanım artık muhasebeleştirilmiyor
    /// (bkz. <see cref="VirtualPosAccountingPlanner.IsPlaceholderAccountNo"/>). Kurgu veri
    /// bu alanı boş bıraktığı için testler gerçekte olmayan bir durumu doğruluyordu.
    /// </summary>
    private static BankAccountDefinition PosAccount(int id = 10, string accountNo = "1234567890") =>
        new() { Id = id, AccountCode = "ZIRAATPOS", AccountName = "ZİRAAT POS", AccountNo = accountNo, CurrencyTypeId = 1 };

    private static VirtualPosTransaction Paid(int bankCode = 10) => new()
    {
        OrderNo = "SPABC123",
        BankCode = bankCode,
        BankName = "ZİRAAT BANKASI",
        CustomerCode = "120-01-000001",
        Amount = 250.00m,
        CurrencyCode = "TRY",
        IsSuccess = true,
        Status = (int)VirtualPosPaymentStatus.Authorized
    };

    // --- 1: an authorized payment is postable ---------------------------------------------

    [Fact]
    public void Authorized_payment_is_ready()
    {
        var decision = VirtualPosAccountingPlanner.Decide(Paid(), PosAccount());

        Assert.Equal(AccountingEligibility.Ready, decision.Eligibility);
        Assert.Equal("VP-SPABC123", decision.Reference);
        Assert.True(decision.Reference.Length <= VirtualPosAccountingPlanner.MaxReferenceLength);
        Assert.Equal(1, decision.CurrencyTypeId);
    }

    // --- 7-11, 23, 24: nothing else may post ------------------------------------------------

    [Theory]
    [InlineData(VirtualPosPaymentStatus.Failed)]
    [InlineData(VirtualPosPaymentStatus.ThreeDVerified)]
    [InlineData(VirtualPosPaymentStatus.ThreeDSecurePending)]
    [InlineData(VirtualPosPaymentStatus.AuthorizationPending)]
    [InlineData(VirtualPosPaymentStatus.ProviderError)]
    [InlineData(VirtualPosPaymentStatus.RedirectPrepared)]
    [InlineData(VirtualPosPaymentStatus.Created)]
    [InlineData(VirtualPosPaymentStatus.Cancelled)]
    [InlineData(VirtualPosPaymentStatus.Unknown)]
    public void Unauthorized_states_never_post(VirtualPosPaymentStatus status)
    {
        var tx = Paid();
        tx.Status = (int)status;
        tx.IsSuccess = false;

        var decision = VirtualPosAccountingPlanner.Decide(tx, PosAccount());

        Assert.Equal(AccountingEligibility.PaymentNotAuthorized, decision.Eligibility);
    }

    [Fact]
    public void Success_flag_alone_is_not_enough()
    {
        // A three-D verified payment that still carries IsSuccess must not slip through
        var tx = Paid();
        tx.Status = (int)VirtualPosPaymentStatus.ThreeDVerified;

        Assert.Equal(AccountingEligibility.PaymentNotAuthorized,
            VirtualPosAccountingPlanner.Decide(tx, PosAccount()).Eligibility);
    }

    [Fact]
    public void Authorized_status_without_success_flag_does_not_post()
    {
        var tx = Paid();
        tx.IsSuccess = false;

        Assert.Equal(AccountingEligibility.PaymentNotAuthorized,
            VirtualPosAccountingPlanner.Decide(tx, PosAccount()).Eligibility);
    }

    // --- 20: already posted is a no-op --------------------------------------------------------

    [Fact]
    public void Already_posted_is_a_no_op_not_an_error()
    {
        var tx = Paid();
        tx.Status = (int)VirtualPosPaymentStatus.AccountingPosted;

        Assert.Equal(AccountingEligibility.AlreadyPosted,
            VirtualPosAccountingPlanner.Decide(tx, PosAccount()).Eligibility);
    }

    // --- 19: a previously deferred payment can be retried ---------------------------------------

    [Fact]
    public void Accounting_pending_payment_can_be_retried()
    {
        var tx = Paid();
        tx.Status = (int)VirtualPosPaymentStatus.AccountingPending;

        Assert.Equal(AccountingEligibility.Ready,
            VirtualPosAccountingPlanner.Decide(tx, PosAccount()).Eligibility);
    }

    // --- 16, 17, 18: missing ERP data defers, never fails the payment -----------------------------

    [Fact]
    public void Missing_pos_bank_account_defers()
    {
        var decision = VirtualPosAccountingPlanner.Decide(Paid(), posAccount: null);

        Assert.Equal(AccountingEligibility.Deferred, decision.Eligibility);
        Assert.NotEqual(AccountingEligibility.PaymentNotAuthorized, decision.Eligibility);
    }

    [Fact]
    public void Missing_customer_code_defers()
    {
        var tx = Paid();
        tx.CustomerCode = "";

        Assert.Equal(AccountingEligibility.Deferred,
            VirtualPosAccountingPlanner.Decide(tx, PosAccount()).Eligibility);
    }

    [Fact]
    public void Unmappable_currency_defers()
    {
        var tx = Paid();
        tx.CurrencyCode = "XYZ";

        Assert.Equal(AccountingEligibility.Deferred,
            VirtualPosAccountingPlanner.Decide(tx, PosAccount()).Eligibility);
    }

    [Fact]
    public void Non_positive_amount_defers()
    {
        var tx = Paid();
        tx.Amount = 0m;

        Assert.Equal(AccountingEligibility.Deferred,
            VirtualPosAccountingPlanner.Decide(tx, PosAccount()).Eligibility);
    }

    // --- 2-6: every processing bank is handled the same way -----------------------------------------

    [Theory]
    [InlineData(10)]  // Ziraat — also where Koop and unknown BINs land
    [InlineData(12)]  // Halkbank
    [InlineData(62)]  // Garanti
    [InlineData(64)]  // İş Bankası
    [InlineData(136)] // CreditWest
    public void Every_processing_bank_posts_through_the_same_rules(int bankCode)
    {
        var decision = VirtualPosAccountingPlanner.Decide(Paid(bankCode), PosAccount());

        Assert.Equal(AccountingEligibility.Ready, decision.Eligibility);
    }

    // --- 21: deterministic reference -------------------------------------------------------------------

    [Fact]
    public void Reference_is_deterministic_across_retries()
    {
        var first = VirtualPosAccountingPlanner.BuildReference("SPABC123");
        var second = VirtualPosAccountingPlanner.BuildReference("SPABC123");

        Assert.Equal(first, second);
        Assert.Equal("VP-SPABC123", first);
    }

    [Fact]
    public void Different_payments_get_different_references()
    {
        Assert.NotEqual(
            VirtualPosAccountingPlanner.BuildReference("SPAAA"),
            VirtualPosAccountingPlanner.BuildReference("SPBBB"));
    }

    // --- currency mapping ------------------------------------------------------------------------------

    [Theory]
    [InlineData("TRY", 1)]
    [InlineData("", 1)]
    [InlineData("EUR", 2)]
    [InlineData("USD", 3)]
    [InlineData("GBP", 4)]
    public void Currency_maps_onto_the_erp_type(string code, int expected)
    {
        Assert.Equal(expected, VirtualPosAccountingPlanner.ResolveCurrencyTypeId(code));
    }

    [Fact]
    public void Unknown_currency_returns_null_so_caller_defers()
    {
        Assert.Null(VirtualPosAccountingPlanner.ResolveCurrencyTypeId("XYZ"));
    }

    // --- 22: no sensitive data in the description --------------------------------------------------------

    [Fact]
    public void Description_carries_no_card_or_authentication_data()
    {
        var tx = Paid();
        tx.MaskedPan = "435508****4358";
        tx.CardHolderName = "TEST USER";

        var description = VirtualPosAccountingPlanner.BuildDescription(tx);

        Assert.DoesNotContain("435508", description);
        Assert.DoesNotContain("****", description);
        Assert.Contains("SPABC123", description);
        Assert.Contains("ZİRAAT", description);
    }

    // --- Kurulumu tamamlanmamış POS hesabı --------------------------------------------------
    //
    // Ziraat, POS'umuz olmayan HER kartın düştüğü varsayılan yol. Hesap numarası kurulum
    // yer tutucusunda kalırsa tahsilat, bankada karşılığı olmayan bir hesaba işlenirdi.

    [Theory]
    [InlineData("TANIMLANACAK")]
    [InlineData("tanimlanacak")]
    [InlineData("TBD")]
    [InlineData("-")]
    [InlineData("")]
    [InlineData("   ")]
    public void Placeholder_account_number_defers_instead_of_posting(string accountNo)
    {
        var decision = VirtualPosAccountingPlanner.Decide(Paid(), PosAccount(accountNo: accountNo));

        Assert.Equal(AccountingEligibility.Deferred, decision.Eligibility);
        Assert.Contains("hesap numarası", decision.Reason);
    }

    [Fact]
    public void Deferred_placeholder_does_not_fail_the_payment()
    {
        // Para bankada çekilmiş olur; ERP eksiği yüzünden ödeme başarısız sayılmaz.
        var decision = VirtualPosAccountingPlanner.Decide(Paid(), PosAccount(accountNo: "TANIMLANACAK"));

        Assert.NotEqual(AccountingEligibility.PaymentNotAuthorized, decision.Eligibility);
    }
}

public class VirtualPosAccountingReferenceTests
{
    // DocumentNo is varchar(30); a longer reference fails with SqlState 22001 at insert time
    [Fact]
    public void Reference_never_exceeds_the_document_no_column()
    {
        var realWorldOrderNo = "SP" + Guid.NewGuid().ToString("N").ToUpperInvariant(); // 34 chars
        var reference = VirtualPosAccountingPlanner.BuildReference(realWorldOrderNo);

        Assert.True(reference.Length <= VirtualPosAccountingPlanner.MaxReferenceLength,
            $"Reference was {reference.Length} characters: {reference}");
    }

    [Fact]
    public void Long_order_ids_still_produce_a_stable_reference()
    {
        var orderNo = "SP" + Guid.NewGuid().ToString("N").ToUpperInvariant();

        Assert.Equal(
            VirtualPosAccountingPlanner.BuildReference(orderNo),
            VirtualPosAccountingPlanner.BuildReference(orderNo));
    }

    [Fact]
    public void Distinct_order_ids_keep_distinct_references_after_truncation()
    {
        var references = new HashSet<string>();
        for (var i = 0; i < 2000; i++)
        {
            references.Add(VirtualPosAccountingPlanner.BuildReference(
                "SP" + Guid.NewGuid().ToString("N").ToUpperInvariant()));
        }

        Assert.Equal(2000, references.Count);
    }

    [Fact]
    public void Real_account_number_is_not_treated_as_placeholder()
    {
        // Harf içeren gerçek hesap kodları elenmemeli: "sayı yoksa yer tutucudur" gibi bir
        // kural tahsilatı sebepsiz bekletirdi.
        Assert.False(VirtualPosAccountingPlanner.IsPlaceholderAccountNo("TR330006100519786457841326"));
        Assert.False(VirtualPosAccountingPlanner.IsPlaceholderAccountNo("0123-45678"));
    }
}
