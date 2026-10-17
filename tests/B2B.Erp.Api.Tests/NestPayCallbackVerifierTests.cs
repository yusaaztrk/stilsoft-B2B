using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using B2B.Erp.Api.Features.VirtualPos.Core;
using Xunit;

namespace B2B.Erp.Api.Tests;

public class NestPayCallbackVerifierTests
{
    private const string StoreKey = "TEST-STORE-KEY-NOT-A-REAL-SECRET";

    /// <summary>
    /// Independent implementation of NestPay Hash Version 3, written from the specification
    /// rather than by calling the production code. If the verifier's algorithm drifts, these
    /// tests fail instead of drifting along with it.
    /// </summary>
    private static string SignLikeBank(IEnumerable<KeyValuePair<string, string>> parameters, string storeKey)
    {
        static string Escape(string? v) => (v ?? string.Empty).Replace("\\", "\\\\").Replace("|", "\\|");

        var excluded = new[] { "encoding", "hash", "countdown" };

        var values = parameters
            .Where(p => !excluded.Contains(p.Key, StringComparer.OrdinalIgnoreCase))
            .OrderBy(p => p.Key, StringComparer.OrdinalIgnoreCase)
            .Select(p => Escape(p.Value));

        var plaintext = string.Join("|", values) + "|" + Escape(storeKey);
        return Convert.ToBase64String(SHA512.HashData(Encoding.UTF8.GetBytes(plaintext)));
    }

    private static List<KeyValuePair<string, string>> ApprovedCallback(string clientId = "190381656") => new()
    {
        new("clientid", clientId),
        new("oid", "SPTEST0001"),
        new("Response", "Approved"),
        new("ProcReturnCode", "00"),
        new("mdStatus", "1"),
        new("AuthCode", "123456"),
        new("TransId", "TRX-1"),
        new("HostRefNum", "HOST-1"),
        new("amount", "100.00"),
        new("currency", "949"),
        new("rnd", "RANDOMVALUE"),
        new("storetype", "3D_PAY_HOSTING"),
        new("cavv", "AAABBBCCC"),
        new("eci", "05"),
        new("xid", "XID-1")
    };

    private static List<KeyValuePair<string, string>> Signed(
        List<KeyValuePair<string, string>> fields, string storeKey = StoreKey)
    {
        var signed = new List<KeyValuePair<string, string>>(fields)
        {
            new("hash", SignLikeBank(fields, storeKey))
        };
        return signed;
    }

    // --- 1: valid signed callback ---------------------------------------------------------

    [Fact]
    public void Valid_ver3_signed_callback_passes_integrity()
    {
        var result = NestPayCallbackVerifier.Verify(Signed(ApprovedCallback()), StoreKey);
        Assert.True(result.IsValid);
    }

    // --- 2-8: tampering is detected --------------------------------------------------------

    [Theory]
    [InlineData("Response", "Declined")]
    [InlineData("ProcReturnCode", "99")]
    [InlineData("oid", "SOMEONE-ELSES-ORDER")]
    [InlineData("amount", "1.00")]
    [InlineData("mdStatus", "0")]
    [InlineData("rnd", "TAMPERED")]
    [InlineData("clientid", "999999999")]
    [InlineData("AuthCode", "000000")]
    public void Tampering_with_any_signed_field_is_detected(string field, string tamperedValue)
    {
        var signed = Signed(ApprovedCallback());
        var tampered = signed
            .Select(p => p.Key == field ? new KeyValuePair<string, string>(field, tamperedValue) : p)
            .ToList();

        Assert.False(NestPayCallbackVerifier.Verify(tampered, StoreKey).IsValid);
    }

    [Fact]
    public void Invalid_hash_is_rejected()
    {
        var fields = ApprovedCallback();
        fields.Add(new KeyValuePair<string, string>("hash", Convert.ToBase64String(new byte[64])));

        Assert.False(NestPayCallbackVerifier.Verify(fields, StoreKey).IsValid);
    }

    // --- 9: an added parameter changes the digest (all returned parameters participate) -----

    [Fact]
    public void Adding_a_parameter_after_signing_is_detected()
    {
        var signed = Signed(ApprovedCallback());
        signed.Add(new KeyValuePair<string, string>("injectedField", "injectedValue"));

        Assert.False(NestPayCallbackVerifier.Verify(signed, StoreKey).IsValid);
    }

    // --- 10: insertion order is irrelevant, sorting is by name ------------------------------

    [Fact]
    public void Parameter_insertion_order_does_not_change_the_result()
    {
        var signed = Signed(ApprovedCallback());
        var shuffled = signed.AsEnumerable().Reverse().ToList();

        Assert.True(NestPayCallbackVerifier.Verify(shuffled, StoreKey).IsValid);
    }

    // --- 11: empty values still occupy a segment --------------------------------------------

    [Fact]
    public void Empty_value_participates_as_an_empty_segment()
    {
        var fields = ApprovedCallback();
        fields.Add(new KeyValuePair<string, string>("emptyField", ""));

        Assert.True(NestPayCallbackVerifier.Verify(Signed(fields), StoreKey).IsValid);
    }

    [Fact]
    public void Removing_an_empty_field_changes_the_digest()
    {
        // Proves the empty segment really is part of the plaintext
        var fields = ApprovedCallback();
        fields.Add(new KeyValuePair<string, string>("emptyField", ""));
        var signed = Signed(fields);

        var withoutEmpty = signed.Where(p => p.Key != "emptyField").ToList();

        Assert.False(NestPayCallbackVerifier.Verify(withoutEmpty, StoreKey).IsValid);
    }

    // --- 12-14: escaping ---------------------------------------------------------------------

    [Theory]
    [InlineData("value|with|pipes")]
    [InlineData("value\\with\\backslashes")]
    [InlineData("both\\and|mixed")]
    [InlineData("\\|")]
    [InlineData("|\\")]
    public void Special_characters_are_escaped_consistently(string trickyValue)
    {
        var fields = ApprovedCallback();
        fields.Add(new KeyValuePair<string, string>("trickyField", trickyValue));

        Assert.True(NestPayCallbackVerifier.Verify(Signed(fields), StoreKey).IsValid);
    }

    [Fact]
    public void Escape_applies_backslash_before_pipe()
    {
        // "\|" must become "\\\|" — pipe-first ordering would yield "\\|" and diverge
        Assert.Equal("\\\\\\|", NestPayVer3Hash.EscapeHashValue("\\|"));
    }

    [Fact]
    public void Pipe_injection_cannot_forge_a_segment_boundary()
    {
        // Without escaping, a value containing '|' could impersonate two parameters
        var fields = ApprovedCallback();
        fields.Add(new KeyValuePair<string, string>("aaa", "x|y"));
        var signed = Signed(fields);

        var split = signed.Where(p => p.Key != "aaa").ToList();
        split.Add(new KeyValuePair<string, string>("aaa", "x"));
        split.Add(new KeyValuePair<string, string>("aab", "y"));

        Assert.False(NestPayCallbackVerifier.Verify(split, StoreKey).IsValid);
    }

    // --- 15-17: excluded fields ---------------------------------------------------------------

    [Theory]
    [InlineData("encoding", "UTF-8")]
    [InlineData("countdown", "30")]
    [InlineData("ENCODING", "ISO-8859-9")]
    [InlineData("CountDown", "10")]
    public void Excluded_fields_do_not_participate(string field, string value)
    {
        var signed = Signed(ApprovedCallback());
        signed.Add(new KeyValuePair<string, string>(field, value));

        // Added after signing, yet the signature still validates
        Assert.True(NestPayCallbackVerifier.Verify(signed, StoreKey).IsValid);
    }

    [Fact]
    public void Hash_field_itself_is_excluded()
    {
        Assert.True(NestPayVer3Hash.IsExcluded("hash"));
        Assert.True(NestPayVer3Hash.IsExcluded("HASH"));
    }

    // --- 18: deterministic case-insensitive sorting -------------------------------------------

    [Fact]
    public void Sorting_is_case_insensitive_by_parameter_name()
    {
        var fields = new List<KeyValuePair<string, string>>
        {
            new("Beta", "2"), new("alpha", "1"), new("GAMMA", "3")
        };

        var plaintext = NestPayVer3Hash.BuildPlaintext(fields, StoreKey);

        Assert.StartsWith("1|2|3|", plaintext);
    }

    // --- 19-21: fail closed --------------------------------------------------------------------

    [Fact]
    public void Invalid_base64_hash_is_a_validation_failure()
    {
        var fields = ApprovedCallback();
        fields.Add(new KeyValuePair<string, string>("hash", "!!!not-base64!!!"));

        var result = NestPayCallbackVerifier.Verify(fields, StoreKey);

        Assert.False(result.IsValid);
        Assert.Equal(CallbackIntegrityStatus.Mismatch, result.Status);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Empty_store_key_fails_closed(string? storeKey)
    {
        var result = NestPayCallbackVerifier.Verify(Signed(ApprovedCallback()), storeKey);

        Assert.False(result.IsValid);
        Assert.Equal(CallbackIntegrityStatus.MissingStoreKey, result.Status);
    }

    [Fact]
    public void Missing_hash_fails_closed()
    {
        var result = NestPayCallbackVerifier.Verify(ApprovedCallback(), StoreKey);

        Assert.False(result.IsValid);
        Assert.Equal(CallbackIntegrityStatus.MissingHash, result.Status);
    }

    // --- 22-23: Version 1/2 fields must not be required ------------------------------------------

    [Fact]
    public void Missing_hashparams_does_not_by_itself_fail()
    {
        // Ver3 uses all returned parameters; HASHPARAMS belongs to the older algorithm
        Assert.True(NestPayCallbackVerifier.Verify(Signed(ApprovedCallback()), StoreKey).IsValid);
    }

    [Fact]
    public void Legacy_hashparams_fields_are_treated_as_ordinary_parameters()
    {
        // If the gateway still echoes them they take part in the digest like anything else,
        // and are never interpreted as a field list to follow.
        var fields = ApprovedCallback();
        fields.Add(new KeyValuePair<string, string>("HASHPARAMS", "clientid:oid:"));
        fields.Add(new KeyValuePair<string, string>("HASHPARAMSVAL", "somethingelse"));

        Assert.True(NestPayCallbackVerifier.Verify(Signed(fields), StoreKey).IsValid);
    }

    [Fact]
    public void Attacker_cannot_use_hashparamsval_to_forge()
    {
        var fields = ApprovedCallback();
        var forged = Convert.ToBase64String(SHA512.HashData(Encoding.UTF8.GetBytes("anything" + StoreKey)));
        fields.Add(new KeyValuePair<string, string>("HASHPARAMSVAL", "anything"));
        fields.Add(new KeyValuePair<string, string>("hash", forged));

        Assert.False(NestPayCallbackVerifier.Verify(fields, StoreKey).IsValid);
    }

    // --- 24-26: every NestPay bank uses the same verifier -------------------------------------------

    [Theory]
    [InlineData(10)]  // Ziraat
    [InlineData(12)]  // Halkbank
    [InlineData(64)]  // İş Bankası
    [InlineData(136)] // CreditWest — 3D leg is NestPay
    public void All_nestpay_banks_share_one_verifier(int bankCode)
    {
        var fields = ApprovedCallback(clientId: "CLIENT-" + bankCode);

        Assert.True(NestPayCallbackVerifier.Verify(Signed(fields), StoreKey).IsValid);
    }

    // --- 27: 136 is verified but not yet paid ---------------------------------------------------------

    [Fact]
    public void Creditwest_valid_callback_still_requires_cardplus_completion()
    {
        Assert.True(NestPayCallbackVerifier.Verify(Signed(ApprovedCallback()), StoreKey).IsValid);

        // Integrity and 3D success do not make bank 136 paid
        Assert.True(VirtualPosRouting.RequiresPostThreeDCompletion(136));
    }
}
