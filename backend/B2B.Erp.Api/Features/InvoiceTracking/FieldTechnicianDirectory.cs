using System.Net.Http.Headers;
using System.Text.Json;
using B2B.Erp.Api.Core.Security;
using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Features.FaturaTakip;

public sealed record FieldTechnician(Guid Id, string Name, string? Username, string? EmployeeNumber, string? Phone);

/// <summary>
/// Fatura götürebilecek SAHA teknisyenleri.
///
/// Kaynak ServiceOps'un kendi teknisyen listesi, çünkü teknisyenin ekranı ServiceOps kimliğiyle
/// süzülüyor. B2B'deki teknisyen ekranı ServiceOps'a ulaşamayınca B2B kullanıcılarından
/// TÜRETİLMİŞ kimliklerle bir yedek liste döndürüyor; o kimlikler ServiceOps'ta yok. Buraya
/// o yedeğe düşmek, teknisyene hiç görünmeyecek atamalar yazmak demek — o yüzden ServiceOps
/// yanıt vermezse liste YOK sayılır ve ekran bunu açıkça söyler.
///
/// Müdür rolleri listede yok (kullanıcı kararı 2026-09-15: "müdür götürmüyor"). Süzgeç,
/// ServiceOps'un saha teknisyeni tanımıyla aynı rol kümesi (AuthController.FieldTechnicianRoleCodes).
/// </summary>
public sealed class FieldTechnicianDirectory
{
    private static readonly HashSet<string> FieldTechnicianRoleCodes = new(StringComparer.OrdinalIgnoreCase)
    {
        "ServisPersonel",
        "Technician",
        "Teknisyen",
        "KlimaEkibi",
        "SahaMontajEkibi"
    };

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly AppDbContext _dbContext;
    private readonly ILogger<FieldTechnicianDirectory> _logger;

    public FieldTechnicianDirectory(
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        AppDbContext dbContext,
        ILogger<FieldTechnicianDirectory> logger)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _dbContext = dbContext;
        _logger = logger;
    }

    /// <returns>Liste alınamazsa <c>null</c>.</returns>
    public async Task<IReadOnlyList<FieldTechnician>?> GetAsync(string tenantCode, CancellationToken cancellationToken)
    {
        var baseUrl = (_configuration["ServiceOps:BaseUrl"] ?? "http://localhost:5137").Trim();
        if (!baseUrl.EndsWith('/')) baseUrl += "/";

        string body;
        try
        {
            var client = _httpClientFactory.CreateClient();
            client.BaseAddress = new Uri(baseUrl);
            client.Timeout = TimeSpan.FromSeconds(8);

            using var request = new HttpRequestMessage(HttpMethod.Get, "api/technicians");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ServiceOpsProxyToken.Create(_configuration, tenantCode));
            request.Headers.Add("X-Tenant-Code", tenantCode);

            using var response = await client.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("[FaturaTakip] Teknisyen listesi alınamadı: {Status}", response.StatusCode);
                return null;
            }

            body = await response.Content.ReadAsStringAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[FaturaTakip] Teknisyen listesi alınamadı (ServiceOps'a ulaşılamadı).");
            return null;
        }

        var raw = new List<(Guid Id, string Name, string? Username, string? EmployeeNumber, string? Phone)>();
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return null;

            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (!item.TryGetProperty("id", out var idEl) || !Guid.TryParse(idEl.GetString(), out var id)) continue;
                if (item.TryGetProperty("isActive", out var activeEl) && activeEl.ValueKind == JsonValueKind.False) continue;

                var itemTenant = Str(item, "tenantCode");
                if (!string.IsNullOrWhiteSpace(itemTenant) && !string.Equals(itemTenant, tenantCode, StringComparison.OrdinalIgnoreCase)) continue;

                var name = $"{Str(item, "firstName")} {Str(item, "lastName")}".Trim();
                raw.Add((id, string.IsNullOrWhiteSpace(name) ? (Str(item, "username") ?? id.ToString()) : name,
                    Str(item, "username"), Str(item, "employeeNumber"), Str(item, "phone")));
            }
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "[FaturaTakip] Teknisyen listesi çözümlenemedi.");
            return null;
        }

        var usernames = raw.Where(x => !string.IsNullOrWhiteSpace(x.Username))
            .Select(x => x.Username!.Trim().ToLower())
            .Distinct()
            .ToList();

        var fieldUsernames = (await _dbContext.Users
                .AsNoTracking()
                .Where(u => u.IsActive && usernames.Contains(u.Username.ToLower()))
                .Select(u => new { u.Username, u.Role.Code, u.Role.Name })
                .ToListAsync(cancellationToken))
            .Where(u => FieldTechnicianRoleCodes.Contains(u.Code ?? string.Empty) || FieldTechnicianRoleCodes.Contains(u.Name ?? string.Empty))
            .Select(u => u.Username.Trim().ToLowerInvariant())
            .ToHashSet();

        return raw
            .Where(x => x.Username != null && fieldUsernames.Contains(x.Username.Trim().ToLowerInvariant()))
            .OrderBy(x => x.Name, StringComparer.Create(new System.Globalization.CultureInfo("tr-TR"), true))
            .Select(x => new FieldTechnician(x.Id, x.Name, x.Username, x.EmployeeNumber, x.Phone))
            .ToList();

        static string? Str(JsonElement el, string prop) =>
            el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    }
}
