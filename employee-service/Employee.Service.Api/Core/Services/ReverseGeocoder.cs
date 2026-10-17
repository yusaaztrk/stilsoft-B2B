using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

/// <summary>
/// Giriş/çıkış koordinatını il / ilçeye çevirir (OpenStreetMap Nominatim) ve kayda yazar (2026-10-16).
///
/// <para><b>Neden:</b> giriş konumunun il/ilçesi ana ERP'deki bir arka plan işiyle dolduruluyordu,
/// çıkış konumu için hiç tutulmuyordu. Ekran her satır için tarayıcıdan Nominatim'e gidiyor,
/// Nominatim'in saniyede 1 istek sınırına takılınca çıkış konumu yalnızca koordinat ya da
/// "Konum Bilgisi Yok" görünüyordu. Artık kayıt anında sunucuda çözülür ve saklanır.</para>
///
/// <para>Sonuç ~1 km'lik yuvarlanmış koordinatla <c>ReverseGeocodeCaches</c>'e yazılır; aynı
/// işyerinden gelen kayıtlar dışarı çıkmaz. Servis cevap vermezse kayıt YİNE oluşur
/// (kısa zaman aşımı), il/ilçe boş kalır — mesai kaydı adres yüzünden reddedilmez.</para>
/// </summary>
public sealed class ReverseGeocoder
{
    public const string HttpClientName = "Nominatim";

    private readonly AppDbContext _dbContext;
    private readonly IHttpClientFactory _httpClientFactory;

    public ReverseGeocoder(AppDbContext dbContext, IHttpClientFactory httpClientFactory)
    {
        _dbContext = dbContext;
        _httpClientFactory = httpClientFactory;
    }

    public sealed record Place(string? City, string? District);

    /// <summary>Giriş konumunun il/ilçesini doldurur (boşsa).</summary>
    public async Task FillCheckInAsync(EmployeeCheckIn row, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(row.City) || !string.IsNullOrWhiteSpace(row.District)) return;
        var place = await ResolveAsync(row.Latitude, row.Longitude, cancellationToken);
        if (place is null) return;
        row.City = place.City;
        row.District = place.District;
    }

    /// <summary>Çıkış konumunun il/ilçesini doldurur.</summary>
    public async Task FillCheckOutAsync(EmployeeCheckIn row, CancellationToken cancellationToken)
    {
        var place = await ResolveAsync(row.CheckOutLatitude ?? 0m, row.CheckOutLongitude ?? 0m, cancellationToken);
        if (place is null) return;
        row.CheckOutCity = place.City;
        row.CheckOutDistrict = place.District;
    }

    public async Task<Place?> ResolveAsync(decimal latitude, decimal longitude, CancellationToken cancellationToken)
    {
        if (latitude == 0m || longitude == 0m) return null;

        var rLat = Math.Round(latitude, 2, MidpointRounding.AwayFromZero);
        var rLng = Math.Round(longitude, 2, MidpointRounding.AwayFromZero);

        try
        {
            var cached = await _dbContext.ReverseGeocodeCaches
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.RoundedLatitude == rLat && x.RoundedLongitude == rLng, cancellationToken);
            // İli boş önbellek satırı (KKTC'de il eskiden hiç çözülemiyordu) yeniden sorgulanır.
            if (cached is not null && !string.IsNullOrWhiteSpace(cached.City))
            {
                return new Place(cached.City, cached.District);
            }

            var place = await FetchAsync(latitude, longitude, cancellationToken);
            if (place is null) return null;

            if (cached is null)
            {
                // Takip edilen varlık olarak EKLENMEZ: çağıranın SaveChanges'ı mesai kaydını
                // yazıyor; aynı anda iki kişi aynı noktadan geldiğinde tekil indeks çakışması
                // mesai kaydını da düşürürdü. Doğrudan ve çakışmaya dayanıklı yazılır.
                await _dbContext.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO ""ReverseGeocodeCaches"" (""RoundedLatitude"", ""RoundedLongitude"", ""City"", ""District"", ""LastFetchedUtc"")
VALUES ({rLat}, {rLng}, {place.City}, {place.District}, {DateTime.UtcNow})
ON CONFLICT (""RoundedLatitude"", ""RoundedLongitude"") DO NOTHING", cancellationToken);
            }
            else
            {
                await _dbContext.ReverseGeocodeCaches
                    .Where(x => x.Id == cached.Id)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(x => x.City, place.City)
                        .SetProperty(x => x.District, place.District)
                        .SetProperty(x => x.LastFetchedUtc, DateTime.UtcNow), cancellationToken);
            }

            return place;
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            Console.Error.WriteLine("[WARN] ReverseGeocoder: " + ex.Message);
            return null;
        }
    }

    private async Task<Place?> FetchAsync(decimal latitude, decimal longitude, CancellationToken cancellationToken)
    {
        var http = _httpClientFactory.CreateClient(HttpClientName);
        var url = "https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=tr"
                  + $"&lat={latitude.ToString(CultureInfo.InvariantCulture)}&lon={longitude.ToString(CultureInfo.InvariantCulture)}";

        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.UserAgent.Add(new ProductInfoHeaderValue("Stilsoft-Personel", "1.0"));

        // Kayıt bekletilmez: 3 sn içinde cevap yoksa adres boş kalır.
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(TimeSpan.FromSeconds(3));

        using var res = await http.SendAsync(req, cts.Token);
        if (!res.IsSuccessStatusCode) return null;

        await using var stream = await res.Content.ReadAsStreamAsync(cts.Token);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: cts.Token);
        if (!doc.RootElement.TryGetProperty("address", out var addr)) return null;

        static string? Pick(JsonElement a, params string[] keys)
        {
            foreach (var k in keys)
            {
                if (a.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.String)
                {
                    var s = v.GetString();
                    if (!string.IsNullOrWhiteSpace(s)) return s.Trim();
                }
            }
            return null;
        }

        // Portaldaki eski istemci çözümüyle aynı öncelik: il (province/city/town/state), ilçe (suburb/district/...).
        // KKTC (2026-10-16 canlı örnek): Nominatim ili yalnız `state_district`te veriyor ("Lefkoşa ilçesi")
        // ve province/city/state hiç yok — il boş kalıyordu. İlçe yerine de "…Belediyesi" yazılıyordu;
        // köy adı (village) belediyeden önce gelir.
        var city = Pick(addr, "province", "city", "town", "state", "county")
                   ?? StripIlce(Pick(addr, "state_district"));
        var district = Pick(addr, "suburb", "district", "city_district", "township", "county", "village", "municipality");
        if (city is null && district is null) return null;

        return new Place(Trim120(city), Trim120(district));
    }

    /// <summary>"Lefkoşa ilçesi" → "Lefkoşa".</summary>
    private static string? StripIlce(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var t = s.Trim();
        foreach (var suffix in new[] { " ilçesi", " İlçesi", " District" })
        {
            if (t.EndsWith(suffix, StringComparison.Ordinal)) return t[..^suffix.Length].Trim();
        }
        return t;
    }

    private static string? Trim120(string? s) => s is null ? null : s.Length <= 120 ? s : s[..120];
}
