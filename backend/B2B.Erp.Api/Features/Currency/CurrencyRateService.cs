using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;

namespace B2B.Erp.Api.Features.Currency;

/// <summary>
/// Kur kaynağı. Sıralama: bellek önbelleği → TCMB → <c>ExchangeRates</c> tablosundaki
/// SON BİLİNEN kur → (yalnızca tablo hiç dolmamışsa) sabit değerler.
///
/// Öncesinde önbellek yalnızca bellekteydi ve TCMB'ye erişilemediğinde devreye giren sabit
/// değerler (USD 36,50 / EUR 38,20 / GBP 46,10) faturaya yazılıp KALICI olarak donuyordu.
/// Artık her başarılı çekim tabloya yazılıyor; erişim kesilirse en son gerçek kur kullanılıyor.
///
/// Tablo VARSAYILAN veritabanındadır — kurlar firmaya özel değildir, tenant başına
/// kopyalanmaz. Bu yüzden servis DbContext yerine doğrudan varsayılan bağlantıyı kullanır
/// (servis singleton, DbContext scoped; ayrıca kur çözümlemesinin tenant bağlamı yoktur).
/// </summary>
public sealed class CurrencyRateService : ICurrencyRateService
{
    private readonly ICurrencyApiClient _apiClient;
    private readonly IMemoryCache _cache;
    private readonly CurrencyOptions _options;
    private readonly ILogger<CurrencyRateService> _logger;
    private readonly string? _connectionString;

    private const string CacheKey = "currency_rates_latest";

    public CurrencyRateService(
        ICurrencyApiClient apiClient,
        IMemoryCache cache,
        IOptions<CurrencyOptions> options,
        ILogger<CurrencyRateService> logger,
        IConfiguration configuration)
    {
        _apiClient = apiClient;
        _cache = cache;
        _options = options.Value;
        _logger = logger;
        _connectionString = configuration.GetConnectionString("DefaultConnection");
    }

    /// <summary>
    /// Son çare. Tablo hiç dolmadıysa (ilk açılış + TCMB erişilemiyor) kullanılır.
    /// Buraya düşmek bir ARIZA göstergesidir; tutarlar güvenilmezdir.
    /// </summary>
    private static IReadOnlyList<CurrencyRateDto> GetHardcodedRates()
    {
        var now = DateTime.UtcNow.Date;
        return new List<CurrencyRateDto>
        {
            new() { CurrencyCode = "TRY", BuyingRate = 1.0m, SellingRate = 1.0m, EffectiveBuyingRate = 1.0m, EffectiveSellingRate = 1.0m, RateDate = now, Provider = "Fallback" },
            new() { CurrencyCode = "USD", BuyingRate = 36.50m, SellingRate = 36.50m, EffectiveBuyingRate = 36.50m, EffectiveSellingRate = 36.50m, RateDate = now, Provider = "Fallback" },
            new() { CurrencyCode = "EUR", BuyingRate = 38.20m, SellingRate = 38.20m, EffectiveBuyingRate = 38.20m, EffectiveSellingRate = 38.20m, RateDate = now, Provider = "Fallback" },
            new() { CurrencyCode = "GBP", BuyingRate = 46.10m, SellingRate = 46.10m, EffectiveBuyingRate = 46.10m, EffectiveSellingRate = 46.10m, RateDate = now, Provider = "Fallback" }
        };
    }

    private static CurrencyRateDto TryRate(DateTime date) => new()
    {
        CurrencyCode = "TRY",
        BuyingRate = 1.0m,
        SellingRate = 1.0m,
        EffectiveBuyingRate = 1.0m,
        EffectiveSellingRate = 1.0m,
        RateDate = date,
        Provider = "System"
    };

    // ---------------------------------------------------------------- kalıcılık

    private async Task PersistAsync(IReadOnlyList<CurrencyRateDto> rates, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(_connectionString) || rates.Count == 0) return;

        try
        {
            await using var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync(ct);

            foreach (var r in rates)
            {
                if (string.IsNullOrWhiteSpace(r.CurrencyCode)) continue;
                if (r.CurrencyCode.Equals("TRY", StringComparison.OrdinalIgnoreCase)) continue;
                if (r.SellingRate <= 0m && r.BuyingRate <= 0m) continue;

                await using var cmd = conn.CreateCommand();
                cmd.CommandText = @"
INSERT INTO ""ExchangeRates""
  (""CurrencyCode"", ""RateDate"", ""BuyingRate"", ""SellingRate"",
   ""EffectiveBuyingRate"", ""EffectiveSellingRate"", ""Source"")
VALUES (@code, @date, @buy, @sell, @ebuy, @esell, @src)
ON CONFLICT (""CurrencyCode"", ""RateDate"") DO UPDATE SET
  ""BuyingRate"" = EXCLUDED.""BuyingRate"",
  ""SellingRate"" = EXCLUDED.""SellingRate"",
  ""EffectiveBuyingRate"" = EXCLUDED.""EffectiveBuyingRate"",
  ""EffectiveSellingRate"" = EXCLUDED.""EffectiveSellingRate"",
  ""Source"" = EXCLUDED.""Source"";";
                cmd.Parameters.AddWithValue("code", r.CurrencyCode.Trim().ToUpperInvariant());
                cmd.Parameters.AddWithValue("date", r.RateDate.Date);
                cmd.Parameters.AddWithValue("buy", r.BuyingRate);
                cmd.Parameters.AddWithValue("sell", r.SellingRate);
                cmd.Parameters.AddWithValue("ebuy", r.EffectiveBuyingRate);
                cmd.Parameters.AddWithValue("esell", r.EffectiveSellingRate);
                cmd.Parameters.AddWithValue("src", string.IsNullOrWhiteSpace(r.Provider) ? "TCMB" : r.Provider);
                await cmd.ExecuteNonQueryAsync(ct);
            }
        }
        catch (Exception ex)
        {
            // Kur okumayı kalıcılık hatası yüzünden düşürme.
            _logger.LogWarning(ex, "Kur tablosuna yazılamadı.");
        }
    }

    /// <summary>
    /// Verilen tarihte GEÇERLİ kurları döndürür: o tarihe ait satır yoksa ondan ÖNCEKİ en yakın
    /// tarih kullanılır (hafta sonu / tatil günlerinde TCMB kur yayınlamaz).
    /// <paramref name="asOf"/> null ise tablodaki en son kur.
    /// </summary>
    private async Task<IReadOnlyList<CurrencyRateDto>> ReadStoredAsync(DateTime? asOf, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(_connectionString)) return Array.Empty<CurrencyRateDto>();

        try
        {
            await using var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync(ct);

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
SELECT DISTINCT ON (""CurrencyCode"")
       ""CurrencyCode"", ""RateDate"", ""BuyingRate"", ""SellingRate"",
       ""EffectiveBuyingRate"", ""EffectiveSellingRate"", ""Source""
FROM ""ExchangeRates""
WHERE (@asOf::date IS NULL OR ""RateDate"" <= @asOf::date)
ORDER BY ""CurrencyCode"", ""RateDate"" DESC;";
            cmd.Parameters.AddWithValue("asOf", (object?)asOf?.Date ?? DBNull.Value);

            var list = new List<CurrencyRateDto>();
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                list.Add(new CurrencyRateDto
                {
                    CurrencyCode = reader.GetString(0),
                    RateDate = reader.GetDateTime(1),
                    BuyingRate = reader.GetDecimal(2),
                    SellingRate = reader.GetDecimal(3),
                    EffectiveBuyingRate = reader.GetDecimal(4),
                    EffectiveSellingRate = reader.GetDecimal(5),
                    Provider = reader.GetString(6)
                });
            }
            return list;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Kur tablosu okunamadı.");
            return Array.Empty<CurrencyRateDto>();
        }
    }

    // ---------------------------------------------------------------- okuma

    public async Task<IReadOnlyList<CurrencyRateDto>> GetLatestRatesAsync(CancellationToken cancellationToken = default)
    {
        if (_cache.TryGetValue(CacheKey, out IReadOnlyList<CurrencyRateDto>? cached) && cached != null && cached.Count > 0)
        {
            return cached;
        }

        try
        {
            var rates = await _apiClient.GetLatestRatesAsync(cancellationToken);
            if (rates != null && rates.Count > 0)
            {
                var list = new List<CurrencyRateDto>(rates);
                if (!list.Any(r => r.CurrencyCode.Equals("TRY", StringComparison.OrdinalIgnoreCase)))
                {
                    list.Add(TryRate(DateTime.UtcNow.Date));
                }

                await PersistAsync(list, cancellationToken);

                _cache.Set(CacheKey, (IReadOnlyList<CurrencyRateDto>)list, TimeSpan.FromMinutes(_options.CacheMinutes));
                return list;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "TCMB'den kur alınamadı; son bilinen kura düşülüyor.");
        }

        // TCMB yok: tablodaki SON BİLİNEN kur. Sabit değerlere düşmeden önceki gerçek kur budur.
        var stored = await ReadStoredAsync(null, cancellationToken);
        if (stored.Count > 0)
        {
            var list = new List<CurrencyRateDto>(stored);
            if (!list.Any(r => r.CurrencyCode.Equals("TRY", StringComparison.OrdinalIgnoreCase)))
            {
                list.Add(TryRate(DateTime.UtcNow.Date));
            }

            _logger.LogWarning(
                "Kur TCMB'den alınamadı; {Date} tarihli son bilinen kur kullanılıyor.",
                stored.Max(r => r.RateDate).ToString("yyyy-MM-dd"));

            // Kısa önbellek: TCMB düzelir düzelmez taze kura dönülsün.
            _cache.Set(CacheKey, (IReadOnlyList<CurrencyRateDto>)list, TimeSpan.FromMinutes(5));
            return list;
        }

        _logger.LogError(
            "Kur tablosu BOŞ ve TCMB'ye erişilemiyor. SABİT kurlara düşülüyor — " +
            "bu kurlarla kesilen belgeler güvenilmezdir.");

        var hardcoded = GetHardcodedRates();
        _cache.Set(CacheKey, hardcoded, TimeSpan.FromMinutes(5));
        return hardcoded;
    }

    public async Task<CurrencyRateDto?> GetRateAsync(string currencyCode, DateTime? date = null, CancellationToken cancellationToken = default)
    {
        var code = (currencyCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(code)) return null;

        if (code is "TRY" or "TL")
        {
            return TryRate(date ?? DateTime.UtcNow.Date);
        }

        // GEÇMİŞ TARİH: tabloya bakılır. Öncesinde bu parametre YOK SAYILIYORDU ve geriye dönük
        // her kayıt BUGÜNÜN kuruyla donuyordu — açılış fişi ve dönem sonu değerlemesi yanlış çıkardı.
        if (date.HasValue && date.Value.Date < DateTime.UtcNow.Date)
        {
            var stored = await ReadStoredAsync(date.Value, cancellationToken);
            var hit = stored.FirstOrDefault(r => r.CurrencyCode.Equals(code, StringComparison.OrdinalIgnoreCase));
            if (hit != null) return hit;

            _logger.LogWarning(
                "{Code} için {Date} tarihli kur tabloda yok; güncel kura düşülüyor.",
                code, date.Value.ToString("yyyy-MM-dd"));
        }

        var all = await GetLatestRatesAsync(cancellationToken);
        return all.FirstOrDefault(r => r.CurrencyCode.Equals(code, StringComparison.OrdinalIgnoreCase));
    }

    public async Task<decimal> GetLatestTryRateAsync(string currencyCode, CancellationToken cancellationToken = default)
    {
        var code = (currencyCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(code) || code is "TRY" or "TL") return 1.0m;

        var rate = await GetRateAsync(code, null, cancellationToken);
        if (rate != null)
        {
            return rate.SellingRate > 0 ? rate.SellingRate : rate.BuyingRate;
        }

        return 0m;
    }

    public async Task<decimal> GetCrossRateAsync(string sourceCurrency, string targetCurrency, DateTime? date = null, CancellationToken cancellationToken = default)
    {
        var srcCode = (sourceCurrency ?? "TRY").Trim().ToUpperInvariant();
        var tgtCode = (targetCurrency ?? "TRY").Trim().ToUpperInvariant();
        if (srcCode == "TL") srcCode = "TRY";
        if (tgtCode == "TL") tgtCode = "TRY";

        if (srcCode == tgtCode) return 1.0m;

        var srcRate = srcCode == "TRY" ? 1.0m : await GetLatestTryRateAsync(srcCode, cancellationToken);
        var tgtRate = tgtCode == "TRY" ? 1.0m : await GetLatestTryRateAsync(tgtCode, cancellationToken);

        if (srcRate <= 0m) srcRate = 1.0m;
        if (tgtRate <= 0m) tgtRate = 1.0m;

        return Math.Round(srcRate / tgtRate, 6, MidpointRounding.AwayFromZero);
    }

    public async Task<ConvertCurrencyResponse> ConvertAsync(ConvertCurrencyRequest request, CancellationToken cancellationToken = default)
    {
        var srcCode = (request.SourceCurrency ?? "TRY").Trim().ToUpperInvariant();
        var tgtCode = (request.TargetCurrency ?? "TRY").Trim().ToUpperInvariant();

        var srcRateDto = await GetRateAsync(srcCode, null, cancellationToken);
        var tgtRateDto = await GetRateAsync(tgtCode, null, cancellationToken);

        decimal GetSelectedRate(CurrencyRateDto? dto, CurrencyRateType type)
        {
            if (dto == null) return 1.0m;
            return type switch
            {
                CurrencyRateType.Buying => dto.BuyingRate > 0 ? dto.BuyingRate : 1.0m,
                CurrencyRateType.Selling => dto.SellingRate > 0 ? dto.SellingRate : 1.0m,
                CurrencyRateType.EffectiveBuying => dto.EffectiveBuyingRate > 0 ? dto.EffectiveBuyingRate : (dto.BuyingRate > 0 ? dto.BuyingRate : 1.0m),
                CurrencyRateType.EffectiveSelling => dto.EffectiveSellingRate > 0 ? dto.EffectiveSellingRate : (dto.SellingRate > 0 ? dto.SellingRate : 1.0m),
                _ => dto.SellingRate > 0 ? dto.SellingRate : 1.0m
            };
        }

        var srcRate = srcCode is "TRY" or "TL" ? 1.0m : GetSelectedRate(srcRateDto, request.RateType);
        var tgtRate = tgtCode is "TRY" or "TL" ? 1.0m : GetSelectedRate(tgtRateDto, request.RateType);

        decimal converted;
        if (srcCode == tgtCode)
        {
            converted = request.Amount;
        }
        else if (tgtCode is "TRY" or "TL")
        {
            converted = request.Amount * srcRate;
        }
        else if (srcCode is "TRY" or "TL")
        {
            converted = tgtRate > 0 ? request.Amount / tgtRate : request.Amount;
        }
        else
        {
            var amountInTry = request.Amount * srcRate;
            converted = tgtRate > 0 ? amountInTry / tgtRate : amountInTry;
        }

        converted = Math.Round(converted, 4, MidpointRounding.AwayFromZero);

        return new ConvertCurrencyResponse
        {
            SourceAmount = request.Amount,
            SourceCurrency = srcCode,
            TargetCurrency = tgtCode,
            RateType = request.RateType,
            SourceRate = srcRate,
            TargetRate = tgtRate,
            ConvertedAmount = converted,
            RateDate = srcRateDto?.RateDate ?? tgtRateDto?.RateDate ?? DateTime.UtcNow.Date,
            Provider = srcRateDto?.Provider ?? tgtRateDto?.Provider ?? "TCMB"
        };
    }
}
