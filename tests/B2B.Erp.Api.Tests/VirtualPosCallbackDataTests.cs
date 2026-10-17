using System.Collections.Generic;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.VirtualPos.Core;
using Xunit;

namespace B2B.Erp.Api.Tests;

public class VirtualPosCallbackDataTests
{
    private static VirtualPosCallbackData Build(params (string Key, string Value)[] fields)
    {
        var list = new List<KeyValuePair<string, string>>();
        foreach (var (key, value) in fields) list.Add(new KeyValuePair<string, string>(key, value));
        return new VirtualPosCallbackData(list);
    }

    // --- Test 16: casing must not let a security field slip through -----------------------

    [Theory]
    [InlineData("ProcReturnCode")]
    [InlineData("procreturncode")]
    [InlineData("PROCRETURNCODE")]
    public void Get_finds_field_regardless_of_casing(string key)
    {
        var callback = Build((key, "00"));
        Assert.Equal("00", callback.Get("ProcReturnCode"));
    }

    [Fact]
    public void Get_returns_first_present_alias()
    {
        var callback = Build(("orderid", "ORDER-1"));
        Assert.Equal("ORDER-1", callback.Get("oid", "orderid"));
    }

    [Fact]
    public void Get_returns_empty_when_absent()
    {
        Assert.Equal(string.Empty, Build().Get("oid"));
    }

    // --- Amount parsing across bank formats ----------------------------------------------

    [Theory]
    [InlineData("1000.00", 1000.00)]
    [InlineData("1.000,00", 1000.00)]
    [InlineData("1000,00", 1000.00)]
    [InlineData("1234567.89", 1234567.89)]
    [InlineData("150", 150)]
    public void ParseBankAmount_handles_bank_formats(string raw, double expected)
    {
        var parsed = VirtualPosCallbackData.ParseBankAmount(raw, VirtualPosProviderType.NestPay);
        Assert.NotNull(parsed);
        Assert.Equal((decimal)expected, parsed!.Value);
    }

    /// <summary>
    /// Garanti states txnamount in kuruş, so a separator-less "100" is 1,00 TL and not
    /// 100,00 TL. Reading it as major units made the callback amount check reject every
    /// Garanti payment the bank had already authorized.
    /// </summary>
    [Theory]
    [InlineData("100", 1.00)]
    [InlineData("150000", 1500.00)]
    [InlineData("1", 0.01)]
    public void ParseBankAmount_reads_garanti_values_as_minor_units(string raw, double expected)
    {
        var parsed = VirtualPosCallbackData.ParseBankAmount(raw, VirtualPosProviderType.Garanti);
        Assert.NotNull(parsed);
        Assert.Equal((decimal)expected, parsed!.Value);
    }

    /// <summary>A separator says the value is already in major units, whoever sent it.</summary>
    [Fact]
    public void ParseBankAmount_keeps_separated_garanti_values_as_major_units()
    {
        Assert.Equal(100.00m, VirtualPosCallbackData.ParseBankAmount("100.00", VirtualPosProviderType.Garanti));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("abc")]
    [InlineData(null)]
    public void ParseBankAmount_returns_null_when_unparsable(string? raw)
    {
        Assert.Null(VirtualPosCallbackData.ParseBankAmount(raw, VirtualPosProviderType.NestPay));
    }

    [Fact]
    public void AmountsMatch_compares_at_two_decimals()
    {
        Assert.True(VirtualPosCallbackData.AmountsMatch(100.00m, 100.004m));
        Assert.False(VirtualPosCallbackData.AmountsMatch(100.00m, 100.01m));
    }

    // --- Currency mapping ------------------------------------------------------------------

    [Theory]
    [InlineData("TRY", "949")]
    [InlineData("", "949")]
    [InlineData("EUR", "978")]
    [InlineData("USD", "840")]
    public void ToNumericCurrencyCode_maps_supported_currencies(string code, string expected)
    {
        Assert.Equal(expected, VirtualPosCallbackData.ToNumericCurrencyCode(code));
    }

    [Fact]
    public void ToNumericCurrencyCode_returns_null_for_unknown_so_caller_fails_closed()
    {
        Assert.Null(VirtualPosCallbackData.ToNumericCurrencyCode("XYZ"));
    }

    // --- Test 21: sensitive fields never reach storage -------------------------------------

    [Fact]
    public void BuildStorablePayload_keeps_only_allow_listed_fields()
    {
        var callback = Build(
            ("oid", "ORDER-1"),
            ("Response", "Approved"),
            ("ProcReturnCode", "00"),
            ("mdStatus", "1"),
            ("amount", "100.00"));

        var payload = callback.BuildStorablePayload();

        Assert.Contains("oid=ORDER-1", payload);
        Assert.Contains("Response=Approved", payload);
        Assert.Contains("ProcReturnCode=00", payload);
    }

    [Theory]
    [InlineData("cavv", "AAABBBCCC")]
    [InlineData("xid", "XID-VALUE")]
    [InlineData("eci", "05")]
    [InlineData("md", "MD-VALUE")]
    [InlineData("HASH", "HASH-VALUE")]
    [InlineData("HASHPARAMSVAL", "PARAMS-VALUE")]
    [InlineData("secure3dhash", "SECURE-HASH")]
    [InlineData("pan", "4355084355084358")]
    [InlineData("cardnumber", "4355084355084358")]
    [InlineData("cv2", "000")]
    [InlineData("cardcvv2", "000")]
    [InlineData("MaskedPan", "435508****4358")]
    [InlineData("rnd", "RANDOM")]
    public void BuildStorablePayload_never_stores_sensitive_field(string key, string value)
    {
        var payload = Build(("oid", "ORDER-1"), (key, value)).BuildStorablePayload();

        Assert.DoesNotContain(value, payload);
        Assert.DoesNotContain(key + "=", payload);
    }

    [Fact]
    public void BuildStorablePayload_caps_long_error_messages()
    {
        var longMessage = new string('x', 500);
        var payload = Build(("oid", "O"), ("ErrMsg", longMessage)).BuildStorablePayload();

        Assert.True(payload.Length < 400);
    }
}
