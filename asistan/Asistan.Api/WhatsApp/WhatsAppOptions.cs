namespace Asistan.Api.WhatsApp;

/// <summary><c>WhatsApp</c> yapılandırma bölümü. Gizli değerler appsettings.Local.json'dan gelir.</summary>
public sealed class WhatsAppOptions
{
    public string GraphApiVersion { get; set; } = "v23.0";
    public string VerifyToken { get; set; } = string.Empty;
    public string AppSecret { get; set; } = string.Empty;
    public string AccessToken { get; set; } = string.Empty;

    /// <summary>Phone Number ID → firma kodu.</summary>
    public Dictionary<string, string> Numbers { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public bool CanSend => !string.IsNullOrWhiteSpace(AccessToken);

    public string? TenantFor(string? phoneNumberId)
    {
        if (string.IsNullOrWhiteSpace(phoneNumberId)) return null;
        return Numbers.TryGetValue(phoneNumberId.Trim(), out var t) && !string.IsNullOrWhiteSpace(t) ? t.Trim().ToUpperInvariant() : null;
    }

    /// <summary>Bir firmanın numarası (gönderimde konuşmanın numarası yoksa).</summary>
    public string? PhoneNumberIdFor(string tenantCode) =>
        Numbers.FirstOrDefault(x => string.Equals(x.Value?.Trim(), tenantCode, StringComparison.OrdinalIgnoreCase)).Key;
}
