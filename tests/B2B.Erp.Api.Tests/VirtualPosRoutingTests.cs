using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.VirtualPos.Core;
using Xunit;

namespace B2B.Erp.Api.Tests;

public class VirtualPosRoutingTests
{
    // --- Tests 1-8: which bank may process a payment ---------------------------------------

    [Theory]
    [InlineData(10)]  // Ziraat
    [InlineData(12)]  // Halkbank
    [InlineData(62)]  // Garanti
    [InlineData(64)]  // İş Bankası
    [InlineData(136)] // CreditWest
    public void Contracted_banks_can_process_payments(int bankCode)
    {
        Assert.True(VirtualPosRouting.CanProcessPayments(bankCode));
    }

    [Fact]
    public void Koopbank_cannot_process_payments_so_its_cards_fall_back()
    {
        // Test 6: a Koop card must not reach KoopbankProvider; routing sends it to the default POS
        Assert.False(VirtualPosRouting.CanProcessPayments(120));
    }

    [Fact]
    public void Default_payment_bank_is_ziraat()
    {
        // Tests 7 and 8: any other bank, and an unknown BIN, are charged through Ziraat
        Assert.Equal(10, VirtualPosRouting.DefaultPaymentBankCode);
        Assert.True(VirtualPosRouting.CanProcessPayments(VirtualPosRouting.DefaultPaymentBankCode));
    }

    // --- Candidate order: own bank first, Ziraat for the rest -------------------------------

    [Fact]
    public void Issuing_bank_leads_so_a_card_is_charged_through_its_own_pos()
    {
        // A Garanti card reaches the Garanti POS, not the default one
        Assert.Equal(new[] { 62, 10 }, VirtualPosRouting.BuildBankCandidates(0, 62));
    }

    [Fact]
    public void Cards_without_their_own_pos_fall_back_to_ziraat_only()
    {
        // Vakıfbank (32) — no POS contract. The only fallback is the default POS; the BIN
        // table's installment redirect must not pull it onto Garanti.
        Assert.Equal(new[] { 32, 10 }, VirtualPosRouting.BuildBankCandidates(0, 32));
    }

    [Fact]
    public void Unknown_bin_is_charged_through_ziraat()
    {
        Assert.Equal(new[] { 10 }, VirtualPosRouting.BuildBankCandidates(0, 0));
    }

    [Fact]
    public void Explicitly_requested_bank_wins_over_the_issuer()
    {
        // The payment modal echoes back the bank the BIN lookup reported; honouring it keeps
        // the POS the customer was shown and the POS that takes the money identical.
        Assert.Equal(new[] { 64, 62, 10 }, VirtualPosRouting.BuildBankCandidates(64, 62));
    }

    // --- Test 19: 136 needs a second authorization -----------------------------------------

    [Fact]
    public void Creditwest_requires_completion_after_three_d()
    {
        Assert.True(VirtualPosRouting.RequiresPostThreeDCompletion(136));
    }

    [Theory]
    [InlineData(10)]
    [InlineData(12)]
    [InlineData(62)]
    [InlineData(64)]
    public void Other_banks_complete_within_the_three_d_callback(int bankCode)
    {
        Assert.False(VirtualPosRouting.RequiresPostThreeDCompletion(bankCode));
    }

    // --- Provider resolution is configuration driven ---------------------------------------

    [Theory]
    [InlineData("NESTPAY", VirtualPosProviderType.NestPay)]
    [InlineData("nestpay", VirtualPosProviderType.NestPay)]
    [InlineData("GARANTI", VirtualPosProviderType.Garanti)]
    [InlineData("GARANTİ", VirtualPosProviderType.Garanti)]
    [InlineData("KOOP", VirtualPosProviderType.Koopbank)]
    public void ResolveProviderType_maps_configured_pos_types(string posType, VirtualPosProviderType expected)
    {
        Assert.Equal(expected, VirtualPosRouting.ResolveProviderType(posType));
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("SOMETHING_ELSE")]
    public void ResolveProviderType_returns_null_for_unknown_so_callback_fails_closed(string? posType)
    {
        // Test 11: an unresolvable provider must reject, never default to NestPay
        Assert.Null(VirtualPosRouting.ResolveProviderType(posType));
    }
}
