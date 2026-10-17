using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Services;

/// <summary>
/// Bildirimi telefonun kendisine — uygulama kapalıyken bile — ulaştıran taraf.
///
/// SignalR yalnızca uygulama AÇIKKEN çalışıyor. Teknisyen telefonu cebine koyduğunda atanan iş
/// duyulmuyordu; işletim sisteminin bildirim kanalına (FCM) ihtiyaç var.
/// </summary>
public interface IPushSender
{
    Task SendToTechnicianAsync(
        Guid technicianId,
        string title,
        string body,
        IDictionary<string, string>? data = null,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// FCM HTTP v1 gönderici.
///
/// <para>
/// KURULMAMIŞKEN SESSİZ: Firebase servis hesabı verilmediyse gönderim hiç denenmez, uyarı bir
/// kez günlüğe düşer ve çağrı normal döner. Bildirim zaten veritabanına yazılıp SignalR ile de
/// iletiliyor; push bunların ÜSTÜNE gelen bir kanal. Yapılandırma eksik diye atama akışının
/// gürültü çıkarması ya da durması yanlış olurdu.
/// </para>
/// <para>
/// Eski "server key" yolu Google tarafından kapatıldı; v1 ucu servis hesabıyla alınmış bir
/// OAuth erişim anahtarı istiyor. Anahtar burada elle üretiliyor (imzalı JWT → token takası):
/// projede zaten <c>System.IdentityModel.Tokens.Jwt</c> var, yeni bir paket eklemek iki csproj'u
/// da ilgilendiren bir sürüm işine dönüşürdü.
/// </para>
/// </summary>
public sealed class FcmPushSender : IPushSender
{
    private const string TokenEndpoint = "https://oauth2.googleapis.com/token";
    private const string MessagingScope = "https://www.googleapis.com/auth/firebase.messaging";

    private static readonly SemaphoreSlim TokenLock = new(1, 1);
    private static string? _cachedAccessToken;
    private static DateTime _cachedAccessTokenExpiresAtUtc = DateTime.MinValue;
    private static bool _missingConfigLogged;

    private readonly ApplicationDbContext _context;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<FcmPushSender> _logger;

    public FcmPushSender(
        ApplicationDbContext context,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILogger<FcmPushSender> logger)
    {
        _context = context;
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _logger = logger;
    }

    private sealed record ServiceAccount(string ProjectId, string ClientEmail, string PrivateKeyPem);

    /// <summary>
    /// Servis hesabını okur. Dosya yolu <c>Fcm:ServiceAccountPath</c> ile verilir.
    /// Yoksa null döner — gönderim yapılmaz.
    /// </summary>
    private ServiceAccount? ReadServiceAccount()
    {
        var path = _configuration["Fcm:ServiceAccountPath"];
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            if (!_missingConfigLogged)
            {
                _missingConfigLogged = true;
                _logger.LogWarning(
                    "FCM servis hesabı bulunamadı (Fcm:ServiceAccountPath). Telefon bildirimi gönderilmeyecek; " +
                    "bildirimler yalnızca uygulama açıkken SignalR ile iletilir.");
            }
            return null;
        }

        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            var projectId = root.GetProperty("project_id").GetString();
            var clientEmail = root.GetProperty("client_email").GetString();
            var privateKey = root.GetProperty("private_key").GetString();

            if (string.IsNullOrWhiteSpace(projectId) || string.IsNullOrWhiteSpace(clientEmail) || string.IsNullOrWhiteSpace(privateKey))
            {
                _logger.LogError("FCM servis hesabı dosyası eksik alan içeriyor: {Path}", path);
                return null;
            }

            return new ServiceAccount(projectId!, clientEmail!, privateKey!);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "FCM servis hesabı okunamadı: {Path}", path);
            return null;
        }
    }

    /// <summary>
    /// Erişim anahtarını alır; süresi dolana kadar (bir saat) yeniden istenmez.
    ///
    /// Önbellek STATİK: gönderici istek başına yaratılıyor, her bildirim için Google'dan yeni bir
    /// anahtar istemek gönderimi gereksiz yere yavaşlatır ve kotayı yer.
    /// </summary>
    private async Task<string?> GetAccessTokenAsync(ServiceAccount account, CancellationToken cancellationToken)
    {
        if (_cachedAccessToken is not null && DateTime.UtcNow < _cachedAccessTokenExpiresAtUtc)
        {
            return _cachedAccessToken;
        }

        await TokenLock.WaitAsync(cancellationToken);
        try
        {
            if (_cachedAccessToken is not null && DateTime.UtcNow < _cachedAccessTokenExpiresAtUtc)
            {
                return _cachedAccessToken;
            }

            using var rsa = RSA.Create();
            rsa.ImportFromPem(account.PrivateKeyPem);

            var now = DateTime.UtcNow;
            var handler = new JwtSecurityTokenHandler();
            var assertion = handler.CreateEncodedJwt(new SecurityTokenDescriptor
            {
                Issuer = account.ClientEmail,
                Audience = TokenEndpoint,
                IssuedAt = now,
                NotBefore = now,
                Expires = now.AddMinutes(60),
                Subject = new ClaimsIdentity(new[] { new Claim("scope", MessagingScope) }),
                SigningCredentials = new SigningCredentials(new RsaSecurityKey(rsa), SecurityAlgorithms.RsaSha256)
            });

            var client = _httpClientFactory.CreateClient();
            using var request = new HttpRequestMessage(HttpMethod.Post, TokenEndpoint)
            {
                Content = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["grant_type"] = "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    ["assertion"] = assertion
                })
            };

            using var response = await client.SendAsync(request, cancellationToken);
            var payload = await response.Content.ReadAsStringAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError("FCM erişim anahtarı alınamadı: {Status} {Payload}", (int)response.StatusCode, payload);
                return null;
            }

            using var doc = JsonDocument.Parse(payload);
            var accessToken = doc.RootElement.GetProperty("access_token").GetString();
            var expiresIn = doc.RootElement.TryGetProperty("expires_in", out var exp) ? exp.GetInt32() : 3600;

            _cachedAccessToken = accessToken;
            // Beş dakikalık pay: anahtar tam sınırdayken gönderime girip 401 almasın.
            _cachedAccessTokenExpiresAtUtc = DateTime.UtcNow.AddSeconds(Math.Max(60, expiresIn - 300));
            return accessToken;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "FCM erişim anahtarı üretilemedi.");
            return null;
        }
        finally
        {
            TokenLock.Release();
        }
    }

    public async Task SendToTechnicianAsync(
        Guid technicianId,
        string title,
        string body,
        IDictionary<string, string>? data = null,
        CancellationToken cancellationToken = default)
    {
        if (technicianId == Guid.Empty) return;

        var account = ReadServiceAccount();
        if (account is null) return;

        var devices = await _context.DeviceTokens
            .Where(d => d.TechnicianId == technicianId)
            .ToListAsync(cancellationToken);

        if (devices.Count == 0) return;

        var accessToken = await GetAccessTokenAsync(account, cancellationToken);
        if (accessToken is null) return;

        var client = _httpClientFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        var endpoint = $"https://fcm.googleapis.com/v1/projects/{account.ProjectId}/messages:send";
        var deadTokens = new List<Domain.Entities.DeviceToken>();

        foreach (var device in devices)
        {
            try
            {
                var payload = BuildMessage(device.Token, title, body, data);
                using var content = new StringContent(payload, Encoding.UTF8, "application/json");
                using var response = await client.PostAsync(endpoint, content, cancellationToken);

                if (response.IsSuccessStatusCode) continue;

                var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);

                // Uygulama silinmiş / anahtar ölmüş. Satır kalırsa her bildirimde tekrar denenip
                // gönderimi yavaşlatır, üstelik cihaz sayısı hiç azalmaz.
                if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone
                    || responseBody.Contains("UNREGISTERED", StringComparison.OrdinalIgnoreCase)
                    || responseBody.Contains("INVALID_ARGUMENT", StringComparison.OrdinalIgnoreCase))
                {
                    deadTokens.Add(device);
                    continue;
                }

                _logger.LogWarning("FCM gönderimi başarısız: {Status} {Body}", (int)response.StatusCode, responseBody);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "FCM gönderimi sırasında hata (cihaz {DeviceId}).", device.Id);
            }
        }

        if (deadTokens.Count > 0)
        {
            _context.DeviceTokens.RemoveRange(deadTokens);
            await _context.SaveChangesAsync(cancellationToken);
        }
    }

    /// <summary>
    /// FCM v1 mesaj gövdesi.
    ///
    /// Veri alanları HEM `notification` HEM `data` içinde gidiyor: `notification` uygulama
    /// kapalıyken işletim sisteminin bildirimi kendisinin göstermesini sağlıyor, `data` ise
    /// bildirime dokunulduğunda hangi ekranın açılacağını taşıyor.
    /// </summary>
    private static string BuildMessage(string token, string title, string body, IDictionary<string, string>? data)
    {
        var dataDict = new Dictionary<string, string>();
        if (data is not null)
        {
            foreach (var kv in data)
            {
                if (!string.IsNullOrWhiteSpace(kv.Value)) dataDict[kv.Key] = kv.Value;
            }
        }
        // Mobil tarafta sesli okunan metin. Başlık ve gövdeyi istemcide birleştirmek yerine
        // sunucudan tek parça geliyor — SignalR yolundaki `speech` alanıyla aynı kural.
        dataDict["speech"] = $"{title}. {body}";

        var message = new
        {
            message = new
            {
                token,
                notification = new { title, body },
                data = dataDict,
                android = new
                {
                    priority = "high",
                    notification = new
                    {
                        channel_id = "job-assignments",
                        sound = "default"
                    }
                },
                apns = new
                {
                    payload = new
                    {
                        // "content-available" C# tanımlayıcısı olamaz; sözlükle yazılıyor.
                        aps = new Dictionary<string, object>
                        {
                            ["sound"] = "default",
                            ["content-available"] = 1
                        }
                    }
                }
            }
        };

        return JsonSerializer.Serialize(message);
    }
}
