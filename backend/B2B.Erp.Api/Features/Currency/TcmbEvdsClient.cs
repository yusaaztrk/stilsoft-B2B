using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Xml.Linq;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace B2B.Erp.Api.Features.Currency;

public sealed class TcmbEvdsClient : ICurrencyApiClient
{
    private readonly HttpClient _http;
    private readonly CurrencyOptions _options;
    private readonly ILogger<TcmbEvdsClient> _logger;

    public TcmbEvdsClient(HttpClient http, IOptions<CurrencyOptions> options, ILogger<TcmbEvdsClient> logger)
    {
        _http = http;
        _options = options.Value;
        _logger = logger;
    }

    public async Task<IReadOnlyList<CurrencyRateDto>> GetLatestRatesAsync(CancellationToken cancellationToken)
    {
        // 1. Try EVDS API if key configured
        if (!string.IsNullOrWhiteSpace(_options.EvdsApiKey))
        {
            try
            {
                var evdsRates = await FetchFromEvdsAsync(cancellationToken);
                if (evdsRates.Count > 0) return evdsRates;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "TCMB EVDS API request failed; attempting TCMB XML feed fallback.");
            }
        }

        // 2. Fallback to TCMB XML Feed (today.xml)
        try
        {
            var xmlRates = await FetchFromTcmbXmlAsync(cancellationToken);
            if (xmlRates.Count > 0) return xmlRates;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "TCMB XML feed request failed.");
        }

        return Array.Empty<CurrencyRateDto>();
    }

    private async Task<IReadOnlyList<CurrencyRateDto>> FetchFromEvdsAsync(CancellationToken cancellationToken)
    {
        var end = DateOnly.FromDateTime(DateTime.UtcNow);
        var start = end.AddDays(-7);
        var s = start.ToString("dd-MM-yyyy", CultureInfo.InvariantCulture);
        var e = end.ToString("dd-MM-yyyy", CultureInfo.InvariantCulture);

        var series = "TP.DK.USD.A-TP.DK.USD.S-TP.DK.EUR.A-TP.DK.EUR.S-TP.DK.GBP.A-TP.DK.GBP.S";
        var url = $"series={series}&startDate={s}&endDate={e}&type=json";

        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.TryAddWithoutValidation("key", _options.EvdsApiKey.Trim());

        using var res = await _http.SendAsync(req, cancellationToken);
        if (!res.IsSuccessStatusCode) return Array.Empty<CurrencyRateDto>();

        var json = await res.Content.ReadAsStringAsync(cancellationToken);
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("items", out var items) || items.ValueKind != JsonValueKind.Array)
            return Array.Empty<CurrencyRateDto>();

        var rates = new Dictionary<string, CurrencyRateDto>(StringComparer.OrdinalIgnoreCase);

        var itemsList = items.EnumerateArray().ToList();
        for (int i = itemsList.Count - 1; i >= 0; i--)
        {
            var item = itemsList[i];
            if (!item.TryGetProperty("Tarih", out var tarihProp)) continue;
            var dateStr = tarihProp.GetString();
            if (!DateOnly.TryParseExact(dateStr, "dd-MM-yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
                continue;

            var dt = date.ToDateTime(TimeOnly.MinValue);

            // USD
            ParseEvdsPair(item, new[] { "TP_DK_USD_A", "TP.DK.USD.A", "TP_DK_USD_A_YTL" }, new[] { "TP_DK_USD_S", "TP.DK.USD.S", "TP_DK_USD_S_YTL" }, "USD", dt, rates);
            // EUR
            ParseEvdsPair(item, new[] { "TP_DK_EUR_A", "TP.DK.EUR.A", "TP_DK_EUR_A_YTL" }, new[] { "TP_DK_EUR_S", "TP.DK.EUR.S", "TP_DK_EUR_S_YTL" }, "EUR", dt, rates);
            // GBP
            ParseEvdsPair(item, new[] { "TP_DK_GBP_A", "TP.DK.GBP.A", "TP_DK_GBP_A_YTL" }, new[] { "TP_DK_GBP_S", "TP.DK.GBP.S", "TP_DK_GBP_S_YTL" }, "GBP", dt, rates);

            if (rates.ContainsKey("USD") && rates.ContainsKey("EUR")) break;
        }

        return new List<CurrencyRateDto>(rates.Values);
    }

    private static void ParseEvdsPair(
        JsonElement item,
        string[] buyProps,
        string[] sellProps,
        string ccy,
        DateTime date,
        Dictionary<string, CurrencyRateDto> rates)
    {
        if (rates.ContainsKey(ccy)) return;

        var buy = TryParseDecimal(item, buyProps);
        var sell = TryParseDecimal(item, sellProps);

        if (buy > 0 || sell > 0)
        {
            rates[ccy] = new CurrencyRateDto
            {
                CurrencyCode = ccy,
                BuyingRate = buy > 0 ? buy : sell,
                SellingRate = sell > 0 ? sell : buy,
                EffectiveBuyingRate = buy > 0 ? buy : sell,
                EffectiveSellingRate = sell > 0 ? sell : buy,
                RateDate = date,
                Provider = "TCMB EVDS"
            };
        }
    }

    private static decimal TryParseDecimal(JsonElement el, string[] propNames)
    {
        foreach (var propName in propNames)
        {
            if (el.TryGetProperty(propName, out var p))
            {
                var str = p.ValueKind == JsonValueKind.String ? p.GetString() : p.GetRawText();
                if (!string.IsNullOrWhiteSpace(str))
                {
                    str = str.Trim().Replace(',', '.');
                    if (decimal.TryParse(str, NumberStyles.Any, CultureInfo.InvariantCulture, out var val) && val > 0)
                    {
                        return val;
                    }
                }
            }
        }
        return 0m;
    }

    private async Task<IReadOnlyList<CurrencyRateDto>> FetchFromTcmbXmlAsync(CancellationToken cancellationToken)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
        var xmlBytes = await client.GetByteArrayAsync("https://www.tcmb.gov.tr/kurlar/today.xml", cancellationToken);
        using var ms = new MemoryStream(xmlBytes);
        var xdoc = XDocument.Load(ms);

        var list = new List<CurrencyRateDto>();
        var date = DateTime.UtcNow.Date;

        foreach (var el in xdoc.Descendants("Currency"))
        {
            var code = el.Attribute("CurrencyCode")?.Value;
            if (string.IsNullOrWhiteSpace(code)) continue;

            var forexBuying = ParseDecimal(el.Element("ForexBuying")?.Value);
            var forexSelling = ParseDecimal(el.Element("ForexSelling")?.Value);
            var banknoteBuying = ParseDecimal(el.Element("BanknoteBuying")?.Value);
            var banknoteSelling = ParseDecimal(el.Element("BanknoteSelling")?.Value);

            if (forexBuying > 0 || forexSelling > 0)
            {
                list.Add(new CurrencyRateDto
                {
                    CurrencyCode = code.Trim().ToUpperInvariant(),
                    BuyingRate = forexBuying,
                    SellingRate = forexSelling > 0 ? forexSelling : forexBuying,
                    EffectiveBuyingRate = banknoteBuying > 0 ? banknoteBuying : forexBuying,
                    EffectiveSellingRate = banknoteSelling > 0 ? banknoteSelling : (forexSelling > 0 ? forexSelling : forexBuying),
                    RateDate = date,
                    Provider = "TCMB XML"
                });
            }
        }

        return list;
    }

    private static decimal ParseDecimal(string? val)
    {
        if (string.IsNullOrWhiteSpace(val)) return 0m;
        val = val.Trim().Replace(',', '.');
        if (decimal.TryParse(val, NumberStyles.Any, CultureInfo.InvariantCulture, out var result))
        {
            return result;
        }
        return 0m;
    }
}
