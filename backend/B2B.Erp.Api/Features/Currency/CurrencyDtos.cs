using System;

namespace B2B.Erp.Api.Features.Currency;

public enum CurrencyRateType
{
    Buying,
    Selling,
    EffectiveBuying,
    EffectiveSelling
}

public sealed class CurrencyRateDto
{
    public string CurrencyCode { get; set; } = string.Empty;
    public decimal BuyingRate { get; set; }
    public decimal SellingRate { get; set; }
    public decimal EffectiveBuyingRate { get; set; }
    public decimal EffectiveSellingRate { get; set; }
    public DateTime RateDate { get; set; }
    public string Provider { get; set; } = "TCMB";
}

public sealed class ConvertCurrencyRequest
{
    public decimal Amount { get; set; }
    public string SourceCurrency { get; set; } = "TRY";
    public string TargetCurrency { get; set; } = "USD";
    public CurrencyRateType RateType { get; set; } = CurrencyRateType.Selling;
}

public sealed class ConvertCurrencyResponse
{
    public decimal SourceAmount { get; set; }
    public string SourceCurrency { get; set; } = string.Empty;
    public string TargetCurrency { get; set; } = string.Empty;
    public CurrencyRateType RateType { get; set; }
    public decimal SourceRate { get; set; }
    public decimal TargetRate { get; set; }
    public decimal ConvertedAmount { get; set; }
    public DateTime RateDate { get; set; }
    public string Provider { get; set; } = "TCMB";
}
