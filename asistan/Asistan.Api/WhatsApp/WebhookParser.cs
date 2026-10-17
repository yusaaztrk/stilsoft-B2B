using System.Text.Json;

namespace Asistan.Api.WhatsApp;

/// <summary>Webhook'tan çıkan gelen mesaj.</summary>
public sealed record InboundMessage(
    string PhoneNumberId,
    string WaId,
    string? ContactName,
    string Wamid,
    string Type,
    string? Body,
    string? MediaId,
    string? MediaMime,
    string? MediaFilename,
    DateTimeOffset? Timestamp,
    string RawJson);

/// <summary>Gönderdiğimiz mesajın durum bildirimi (gönderildi / iletildi / okundu / başarısız).</summary>
public sealed record StatusUpdate(
    string PhoneNumberId,
    string Wamid,
    string Status,
    string? ErrorText,
    DateTimeOffset? Timestamp);

/// <summary>
/// WhatsApp Cloud API webhook gövdesini çözer:
/// <c>entry[].changes[].value.{metadata.phone_number_id, contacts[], messages[], statuses[]}</c>.
///
/// Sınıf yerine JsonDocument: Meta yeni mesaj türleri ekledikçe katı bir model sessizce alan
/// düşürürdü. Tanımadığımız tür 'unsupported' olarak YİNE KAYDEDİLİR — personel en azından
/// "müşteri bir şey gönderdi" görür, mesaj kaybolmaz.
/// </summary>
public static class WebhookParser
{
    public static (List<InboundMessage> Messages, List<StatusUpdate> Statuses) Parse(JsonElement root)
    {
        var messages = new List<InboundMessage>();
        var statuses = new List<StatusUpdate>();

        if (!root.TryGetProperty("entry", out var entries) || entries.ValueKind != JsonValueKind.Array)
            return (messages, statuses);

        foreach (var entry in entries.EnumerateArray())
        {
            if (!entry.TryGetProperty("changes", out var changes) || changes.ValueKind != JsonValueKind.Array) continue;

            foreach (var change in changes.EnumerateArray())
            {
                if (!change.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.Object) continue;

                var phoneNumberId = Str(value, "metadata", "phone_number_id") ?? string.Empty;

                // wa_id → profil adı
                var names = new Dictionary<string, string?>();
                if (value.TryGetProperty("contacts", out var contacts) && contacts.ValueKind == JsonValueKind.Array)
                {
                    foreach (var c in contacts.EnumerateArray())
                    {
                        var waId = Str(c, "wa_id");
                        if (waId is not null) names[waId] = Str(c, "profile", "name");
                    }
                }

                if (value.TryGetProperty("messages", out var msgs) && msgs.ValueKind == JsonValueKind.Array)
                {
                    foreach (var m in msgs.EnumerateArray())
                    {
                        var from = Str(m, "from");
                        var id = Str(m, "id");
                        if (string.IsNullOrWhiteSpace(from) || string.IsNullOrWhiteSpace(id)) continue;

                        var type = Str(m, "type") ?? "unsupported";
                        var (body, mediaId, mime, filename) = ExtractContent(m, type);
                        names.TryGetValue(from, out var name);

                        messages.Add(new InboundMessage(phoneNumberId, from, name, id, type, body, mediaId, mime, filename,
                            UnixTime(Str(m, "timestamp")), m.GetRawText()));
                    }
                }

                if (value.TryGetProperty("statuses", out var sts) && sts.ValueKind == JsonValueKind.Array)
                {
                    foreach (var s in sts.EnumerateArray())
                    {
                        var id = Str(s, "id");
                        var status = Str(s, "status");
                        if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(status)) continue;

                        string? error = null;
                        if (s.TryGetProperty("errors", out var errs) && errs.ValueKind == JsonValueKind.Array)
                        {
                            error = string.Join(" | ", errs.EnumerateArray().Select(e =>
                                $"{Str(e, "code")} {Str(e, "title")} {Str(e, "error_data", "details")}".Trim()));
                        }

                        statuses.Add(new StatusUpdate(phoneNumberId, id, status, error, UnixTime(Str(s, "timestamp"))));
                    }
                }
            }
        }

        return (messages, statuses);
    }

    private static (string? Body, string? MediaId, string? Mime, string? Filename) ExtractContent(JsonElement m, string type)
    {
        switch (type)
        {
            case "text":
                return (Str(m, "text", "body"), null, null, null);
            case "image":
            case "video":
            case "audio":
            case "sticker":
            case "document":
                return (Str(m, type, "caption"), Str(m, type, "id"), Str(m, type, "mime_type"), Str(m, type, "filename"));
            case "location":
                {
                    var lat = Str(m, "location", "latitude");
                    var lng = Str(m, "location", "longitude");
                    var label = string.Join(" ", new[] { Str(m, "location", "name"), Str(m, "location", "address") }.Where(x => !string.IsNullOrWhiteSpace(x)));
                    var link = lat is null || lng is null ? null : $"https://maps.google.com/?q={lat},{lng}";
                    return (string.Join("\n", new[] { label, link }.Where(x => !string.IsNullOrWhiteSpace(x))), null, null, null);
                }
            case "button":
                return (Str(m, "button", "text"), null, null, null);
            case "interactive":
                return (Str(m, "interactive", "button_reply", "title") ?? Str(m, "interactive", "list_reply", "title"), null, null, null);
            case "reaction":
                return (Str(m, "reaction", "emoji"), null, null, null);
            case "contacts":
                {
                    if (m.TryGetProperty("contacts", out var cs) && cs.ValueKind == JsonValueKind.Array)
                    {
                        var parts = cs.EnumerateArray().Select(c =>
                        {
                            var n = Str(c, "name", "formatted_name");
                            var phones = c.TryGetProperty("phones", out var ps) && ps.ValueKind == JsonValueKind.Array
                                ? string.Join(", ", ps.EnumerateArray().Select(p => Str(p, "phone")).Where(x => x is not null))
                                : null;
                            return $"{n} {phones}".Trim();
                        });
                        return ("Kişi kartı: " + string.Join("; ", parts), null, null, null);
                    }
                    return ("Kişi kartı", null, null, null);
                }
            default:
                return (null, null, null, null);
        }
    }

    private static string? Str(JsonElement el, params string[] path)
    {
        var cur = el;
        foreach (var p in path)
        {
            if (cur.ValueKind != JsonValueKind.Object || !cur.TryGetProperty(p, out cur)) return null;
        }
        return cur.ValueKind switch
        {
            JsonValueKind.String => cur.GetString(),
            JsonValueKind.Number => cur.GetRawText(),
            _ => null
        };
    }

    private static DateTimeOffset? UnixTime(string? raw) =>
        long.TryParse(raw, out var s) ? DateTimeOffset.FromUnixTimeSeconds(s) : null;
}
