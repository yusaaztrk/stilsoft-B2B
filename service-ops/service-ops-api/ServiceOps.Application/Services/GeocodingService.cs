using System.Net.Http.Json;
using Microsoft.Extensions.Logging;

namespace ServiceOps.Application.Services;

public class GeocodingService
{
    private readonly HttpClient _http;
    private readonly ILogger<GeocodingService> _logger;

    public GeocodingService(HttpClient http, ILogger<GeocodingService> logger)
    {
        _http = http;
        _logger = logger;
        
        // Nominatim requires a User-Agent
        _http.DefaultRequestHeaders.Add("User-Agent", "ServiceOps-App");
    }

    public async Task<(double lat, double lon)?> GetCoordinatesAsync(string address)
    {
        if (string.IsNullOrWhiteSpace(address)) return null;

        try
        {
            var url = $"https://nominatim.openstreetmap.org/search?q={Uri.EscapeDataString(address)}&format=json&limit=1";
            var result = await _http.GetFromJsonAsync<List<NominatimResult>>(url);

            var item = result?.FirstOrDefault();
            if (item == null)
            {
                _logger.LogWarning("Address not found: {Address}", address);
                return null;
            }

            return (
                double.Parse(item.lat, System.Globalization.CultureInfo.InvariantCulture),
                double.Parse(item.lon, System.Globalization.CultureInfo.InvariantCulture)
            );
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting coordinates for address: {Address}", address);
            return null;
        }
    }
}

public class NominatimResult
{
    public string lat { get; set; } = string.Empty;
    public string lon { get; set; } = string.Empty;
    public string display_name { get; set; } = string.Empty;
}
