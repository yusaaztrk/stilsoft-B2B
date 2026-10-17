using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using B2B.Erp.Api.Features.VirtualPos.Core;
using Xunit;

namespace B2B.Erp.Api.Tests;

public class GarantiCallbackVerifierTests
{
    private const string StoreKey = "TEST-STORE-KEY-NOT-A-REAL-SECRET";

    static GarantiCallbackVerifierTests()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    }

    /// <summary>
    /// Independent implementation of the bank's documented rule, written from the spec
    /// rather than by calling the production code, so the test would still fail if the
    /// verifier's algorithm drifted.
    /// </summary>
    private static string SignLikeBank(IDictionary<string, string> fields, string hashParams, string storeKey)
    {
        var source = new StringBuilder();
        foreach (var name in hashParams.Split(':', StringSplitOptions.RemoveEmptyEntries))
        {
            source.Append(fields.TryGetValue(name, out var v) ? v : string.Empty);
        }
        source.Append(storeKey);

        var bytes = Encoding.GetEncoding(28599).GetBytes(source.ToString());
        return Convert.ToHexString(SHA512.HashData(bytes));
    }

    private const string HashParams = "clientid:oid:authcode:procreturncode:response:mdstatus:cavv:eci:md:rnd:";

    private static Dictionary<string, string> ApprovedFields() => new()
    {
        ["clientid"] = "100100000",
        ["oid"] = "SPTEST0001",
        ["authcode"] = "123456",
        ["procreturncode"] = "00",
        ["response"] = "Approved",
        ["mdstatus"] = "1",
        ["cavv"] = "AAABBBCCCDDD",
        ["eci"] = "05",
        ["md"] = "MD-VALUE",
        ["rnd"] = "RANDOMVALUE",
        ["txnamount"] = "100.00",
        ["txncurrencycode"] = "949"
    };

    private static VirtualPosCallbackData BuildCallback(
        IDictionary<string, string> fields,
        string? hashParams = HashParams,
        string? hash = null,
        string? hashParamsVal = null)
    {
        var list = new List<KeyValuePair<string, string>>();
        foreach (var kv in fields) list.Add(new KeyValuePair<string, string>(kv.Key, kv.Value));
        if (hashParams != null) list.Add(new KeyValuePair<string, string>("hashparams", hashParams));
        if (hash != null) list.Add(new KeyValuePair<string, string>("hash", hash));
        if (hashParamsVal != null) list.Add(new KeyValuePair<string, string>("hashparamsval", hashParamsVal));
        return new VirtualPosCallbackData(list);
    }

    // --- Positive ---------------------------------------------------------------------

    [Fact]
    public void Valid_signature_is_accepted()
    {
        var fields = ApprovedFields();
        var hash = SignLikeBank(fields, HashParams, StoreKey);

        var result = GarantiCallbackVerifier.Verify(BuildCallback(fields, hash: hash), StoreKey);

        Assert.True(result.IsValid);
        Assert.Equal(CallbackIntegrityStatus.Valid, result.Status);
    }

    [Fact]
    public void Signature_comparison_is_case_insensitive_on_hex()
    {
        var fields = ApprovedFields();
        var hash = SignLikeBank(fields, HashParams, StoreKey).ToLowerInvariant();

        Assert.True(GarantiCallbackVerifier.Verify(BuildCallback(fields, hash: hash), StoreKey).IsValid);
    }

    [Fact]
    public void Turkish_characters_are_hashed_as_latin5()
    {
        // Would silently diverge if the verifier fell back to UTF-8
        var fields = ApprovedFields();
        fields["md"] = "ŞİĞÜÖÇ";
        var hash = SignLikeBank(fields, HashParams, StoreKey);

        Assert.True(GarantiCallbackVerifier.Verify(BuildCallback(fields, hash: hash), StoreKey).IsValid);
    }

    // --- Tampering ---------------------------------------------------------------------

    [Theory]
    [InlineData("procreturncode", "99")]
    [InlineData("response", "Declined")]
    [InlineData("mdstatus", "0")]
    [InlineData("authcode", "999999")]
    [InlineData("oid", "SOMEONE-ELSES-ORDER")]
    [InlineData("clientid", "999999999")]
    public void Tampering_with_any_signed_field_is_detected(string field, string tamperedValue)
    {
        var fields = ApprovedFields();
        var hash = SignLikeBank(fields, HashParams, StoreKey);

        fields[field] = tamperedValue;

        var result = GarantiCallbackVerifier.Verify(BuildCallback(fields, hash: hash), StoreKey);

        Assert.False(result.IsValid);
        Assert.Equal(CallbackIntegrityStatus.Mismatch, result.Status);
    }

    [Fact]
    public void Wrong_store_key_is_rejected()
    {
        var fields = ApprovedFields();
        var hash = SignLikeBank(fields, HashParams, StoreKey);

        Assert.False(GarantiCallbackVerifier.Verify(BuildCallback(fields, hash: hash), "DIFFERENT-KEY").IsValid);
    }

    [Fact]
    public void Attacker_supplied_hashparamsval_is_not_trusted()
    {
        // Both halves of the comparison come from the request, so hashparamsval must never
        // be used as the digest source. Supplying a consistent pair still fails.
        var fields = ApprovedFields();
        var forgedSource = "clientid-oid-whatever";
        var forgedHash = Convert.ToHexString(
            SHA512.HashData(Encoding.GetEncoding(28599).GetBytes(forgedSource + StoreKey)));

        var callback = BuildCallback(fields, hash: forgedHash, hashParamsVal: forgedSource);

        Assert.False(GarantiCallbackVerifier.Verify(callback, StoreKey).IsValid);
    }

    // --- Missing inputs: fail closed ----------------------------------------------------

    [Fact]
    public void Missing_hash_is_rejected()
    {
        var result = GarantiCallbackVerifier.Verify(BuildCallback(ApprovedFields()), StoreKey);
        Assert.Equal(CallbackIntegrityStatus.MissingHash, result.Status);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Missing_or_empty_hashparams_is_rejected(string? hashParams)
    {
        // An empty field list would otherwise hash the store key alone — forgeable
        var fields = ApprovedFields();
        var callback = BuildCallback(fields, hashParams: hashParams, hash: "ABCDEF");

        var result = GarantiCallbackVerifier.Verify(callback, StoreKey);

        Assert.False(result.IsValid);
        Assert.Equal(CallbackIntegrityStatus.MissingHashParams, result.Status);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Missing_store_key_is_rejected(string? storeKey)
    {
        var fields = ApprovedFields();
        var callback = BuildCallback(fields, hash: "ABCDEF");

        var result = GarantiCallbackVerifier.Verify(callback, storeKey);

        Assert.False(result.IsValid);
        Assert.Equal(CallbackIntegrityStatus.MissingStoreKey, result.Status);
    }

    [Fact]
    public void Field_named_in_hashparams_but_absent_contributes_empty()
    {
        var fields = ApprovedFields();
        fields.Remove("cavv");
        var hash = SignLikeBank(fields, HashParams, StoreKey);

        Assert.True(GarantiCallbackVerifier.Verify(BuildCallback(fields, hash: hash), StoreKey).IsValid);
    }
}
