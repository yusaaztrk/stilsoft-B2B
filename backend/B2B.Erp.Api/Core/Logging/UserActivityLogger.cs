using System;
using System.Security.Claims;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Logging;

public sealed class UserActivityLogger : IUserActivityLogger
{
    /// <summary>
    /// ELLE YAZILAN KAYITLARIN MODÜL ADI, MERKEZÎ KAYITLARLA AYNI OLMAK ZORUNDA.
    ///
    /// <para>
    /// Tabloda iki ayrı sözlük birikmişti: <c>AppDbContext</c> otomatik kaydı <c>"fatura"</c> /
    /// <c>"ayarlar"</c> yazarken, uçlardan elle çağrılan bu kaydedici <c>"invoice"</c> /
    /// <c>"users"</c> yazıyordu. Sonucu ekranda görünüyordu: aynı fatura ekranında yapılan iki
    /// işlemden biri "Fatura İşlemleri" diye, diğeri ham <c>invoice</c> diye listeleniyor ve
    /// modül sekmesiyle süzülünce yarısı KAYBOLUYORDU.
    /// </para>
    ///
    /// <para>
    /// Çeviri çağıran uçlarda değil BURADA yapılıyor: yedi ayrı çağrı yerini tek tek düzeltmek
    /// sekizincisinin yine eski adı yazmasını engellemezdi.
    /// </para>
    /// </summary>
    private static readonly Dictionary<string, string> ModuleAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["invoice"] = "fatura",
        ["users"] = "ayarlar",
        ["settings"] = "ayarlar",
        ["cash"] = "kasa",
        ["bank"] = "banka",
        ["check"] = "cekSenet",
    };

    /// <summary>
    /// İşlem tipi de aynı sebeple çevrilir: uçlar <c>"Create"/"Update"/"Delete"</c> yazıyordu,
    /// merkezî kayıt Türkçe. Ekrandaki "İşlem Tipi" süzgeci ikisini ayrı seçenek olarak
    /// listeliyor, renkli rozet de İngilizce olanı tanımıyordu.
    /// </summary>
    private static readonly Dictionary<string, string> ActionAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Create"] = "Oluşturma",
        ["Created"] = "Oluşturma",
        ["Add"] = "Oluşturma",
        ["Update"] = "Güncelleme",
        ["Updated"] = "Güncelleme",
        ["Edit"] = "Güncelleme",
        ["Delete"] = "Silme",
        ["Deleted"] = "Silme",
        ["Remove"] = "Silme",
        ["Transfer"] = "Aktarma",
    };

    private static string NormalizeModule(string? moduleKey)
    {
        var key = (moduleKey ?? string.Empty).Trim();
        return ModuleAliases.TryGetValue(key, out var mapped) ? mapped : key;
    }

    private static string NormalizeAction(string? actionType)
    {
        var key = (actionType ?? string.Empty).Trim();
        return ActionAliases.TryGetValue(key, out var mapped) ? mapped : key;
    }

    private readonly AppDbContext _dbContext;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public UserActivityLogger(AppDbContext dbContext, IHttpContextAccessor httpContextAccessor)
    {
        _dbContext = dbContext;
        _httpContextAccessor = httpContextAccessor;
    }

    public async Task LogAsync(
        string moduleKey,
        string pageKey,
        string actionType,
        string description,
        string? recordId = null,
        object? details = null,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var httpContext = _httpContextAccessor.HttpContext;
            var username = httpContext?.User?.FindFirst(ClaimTypes.Name)?.Value ?? "System";
            var displayName = username;

            if (httpContext?.User != null)
            {
                displayName = httpContext.User.FindFirst("Unvan")?.Value ?? username;
                if (string.IsNullOrWhiteSpace(displayName))
                {
                    displayName = username;
                }
            }

            string? detailsJson = null;
            if (details != null)
            {
                if (details is string str)
                {
                    detailsJson = str;
                }
                else
                {
                    detailsJson = JsonSerializer.Serialize(details, new JsonSerializerOptions
                    {
                        WriteIndented = false,
                        ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles
                    });
                }
            }

            var log = new UserActivityLog
            {
                Username = username,
                UserDisplayName = displayName,
                ModuleKey = NormalizeModule(moduleKey),
                PageKey = pageKey,
                ActionType = NormalizeAction(actionType),
                Description = description,
                RecordId = recordId,
                DetailsJson = detailsJson,
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            };

            // Add directly and save immediately so we don't interfere with main SaveChanges
            _dbContext.UserActivityLogs.Add(log);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            // Fail-safe: write to console but do not throw to block main business transactions
            Console.Error.WriteLine($"[UserActivityLogger ERROR] Logging failed: {ex.Message}");
        }
    }
}
