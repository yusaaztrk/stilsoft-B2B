namespace B2B.Erp.Api.Core.Helpers;

public static class CustomerAccountHelper
{
    public const string InvoiceAccountSuffix = "-1";
    public const string OpenAccountSuffix = "-2";
    public const string AskeriyeAccountSuffix = "-3";

    public static bool IsInvoiceAccountCode(string? customerCode)
    {
        if (string.IsNullOrWhiteSpace(customerCode)) return false;
        var s = customerCode.Trim();
        return s.EndsWith(InvoiceAccountSuffix, StringComparison.OrdinalIgnoreCase) && s.Length > InvoiceAccountSuffix.Length;
    }

    public static bool IsOpenAccountCode(string? customerCode)
    {
        if (string.IsNullOrWhiteSpace(customerCode)) return false;
        var s = customerCode.Trim();
        return s.EndsWith(OpenAccountSuffix, StringComparison.OrdinalIgnoreCase) && s.Length > OpenAccountSuffix.Length;
    }

    public static bool IsAskeriyeAccountCode(string? customerCode)
    {
        if (string.IsNullOrWhiteSpace(customerCode)) return false;
        var s = customerCode.Trim();
        return s.EndsWith(AskeriyeAccountSuffix, StringComparison.OrdinalIgnoreCase) && s.Length > AskeriyeAccountSuffix.Length;
    }

    public static bool IsSubAccountCode(string? customerCode)
    {
        return IsInvoiceAccountCode(customerCode) || IsOpenAccountCode(customerCode) || IsAskeriyeAccountCode(customerCode);
    }

    public static string GetMainCodeFromInvoiceAccountCode(string? customerCode)
    {
        if (string.IsNullOrWhiteSpace(customerCode)) return string.Empty;
        var s = customerCode.Trim();
        if (IsInvoiceAccountCode(s)) return s.Substring(0, s.Length - InvoiceAccountSuffix.Length);
        if (IsOpenAccountCode(s)) return s.Substring(0, s.Length - OpenAccountSuffix.Length);
        if (IsAskeriyeAccountCode(s)) return s.Substring(0, s.Length - AskeriyeAccountSuffix.Length);
        return s;
    }

    public static string BuildInvoiceAccountCode(string mainCustomerCode)
    {
        var s = GetMainCodeFromInvoiceAccountCode(mainCustomerCode);
        if (string.IsNullOrWhiteSpace(s)) return string.Empty;
        return $"{s}{InvoiceAccountSuffix}";
    }

    public static string BuildOpenAccountCode(string mainCustomerCode)
    {
        var s = GetMainCodeFromInvoiceAccountCode(mainCustomerCode);
        if (string.IsNullOrWhiteSpace(s)) return string.Empty;
        return $"{s}{OpenAccountSuffix}";
    }

    public static string BuildAskeriyeAccountCode(string mainCustomerCode)
    {
        var s = GetMainCodeFromInvoiceAccountCode(mainCustomerCode);
        if (string.IsNullOrWhiteSpace(s)) return string.Empty;
        return $"{s}{AskeriyeAccountSuffix}";
    }

    public static bool TryParseParentForBranchCode(string parentCustomerCode, out string branchBasePrefix)
    {
        branchBasePrefix = string.Empty;
        var p = (parentCustomerCode ?? string.Empty).Trim();
        p = GetMainCodeFromInvoiceAccountCode(p);

        var parts = p.Split('-', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length != 3) return false;
        if (parts[0].Length == 0) return false;

        var mid = parts[1];
        var last6 = parts[2];
        if (mid.Length != 2) return false;
        if (last6.Length != 6) return false;
        if (!mid.All(char.IsDigit)) return false;
        if (!last6.All(char.IsDigit)) return false;

        branchBasePrefix = $"{mid}-{last6}-";
        return true;
    }

    public static long ParseLast6DigitsOrZero(string code, string prefix)
    {
        var s = (code ?? string.Empty).Trim();
        s = GetMainCodeFromInvoiceAccountCode(s);
        if (string.IsNullOrWhiteSpace(prefix) || !s.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return 0;
        var suffix = s.Substring(prefix.Length);
        if (suffix.Length != 6) return 0;
        return long.TryParse(suffix, out var n) ? n : 0;
    }
}
