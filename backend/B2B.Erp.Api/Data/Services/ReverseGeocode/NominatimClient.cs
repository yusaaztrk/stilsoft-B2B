using System.Net.Http.Headers;
using System.Text.Json;

namespace B2B.Erp.Api.Data.Services.ReverseGeocode;

public sealed class NominatimClient
{
    private readonly HttpClient _http;

    public NominatimClient(HttpClient http)
    {
        _http = http;
        if (!_http.DefaultRequestHeaders.UserAgent.Any())
        {
            _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("B2B-ERP", "1.0"));
        }
    }

    public sealed class ReverseResult
    {
        public string? City { get; set; }
        public string? District { get; set; }
    }

    public async Task<ReverseResult?> ReverseAsync(decimal latitude, decimal longitude, CancellationToken cancellationToken)
    {
        var url = $"https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat={latitude.ToString(System.Globalization.CultureInfo.InvariantCulture)}&lon={longitude.ToString(System.Globalization.CultureInfo.InvariantCulture)}";

        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        using var res = await _http.SendAsync(req, cancellationToken);
        if (!res.IsSuccessStatusCode) return null;

        await using var stream = await res.Content.ReadAsStreamAsync(cancellationToken);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);

        if (!doc.RootElement.TryGetProperty("address", out var addr)) return null;

        string? city = null;
        if (addr.TryGetProperty("city", out var vCity)) city = vCity.GetString();
        else if (addr.TryGetProperty("town", out var vTown)) city = vTown.GetString();
        else if (addr.TryGetProperty("county", out var vCounty)) city = vCounty.GetString();
        else if (addr.TryGetProperty("state", out var vState)) city = vState.GetString();

        string? district = null;
        if (addr.TryGetProperty("suburb", out var vSuburb)) district = vSuburb.GetString();
        else if (addr.TryGetProperty("city_district", out var vCityDist)) district = vCityDist.GetString();
        else if (addr.TryGetProperty("district", out var vDist)) district = vDist.GetString();
        else if (addr.TryGetProperty("municipality", out var vMunicipality)) district = vMunicipality.GetString();

        return new ReverseResult
        {
            City = string.IsNullOrWhiteSpace(city) ? null : city.Trim(),
            District = string.IsNullOrWhiteSpace(district) ? null : district.Trim()
        };
    }
}
