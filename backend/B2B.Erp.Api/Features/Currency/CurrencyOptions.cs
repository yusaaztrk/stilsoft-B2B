namespace B2B.Erp.Api.Features.Currency;

public sealed class CurrencyOptions
{
    public string BaseUrl { get; set; } = "https://evds3.tcmb.gov.tr/igmevdsms-dis/";
    public string EvdsApiKey { get; set; } = string.Empty;
    public int TimeoutSeconds { get; set; } = 15;
    public int CacheMinutes { get; set; } = 60;
}
