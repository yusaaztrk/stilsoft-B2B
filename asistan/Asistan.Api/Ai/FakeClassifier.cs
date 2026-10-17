using System.Globalization;

namespace Asistan.Api.Ai;

/// <summary>
/// SAHTE ASİSTAN — yalnız deneme (Ai:Provider = "fake", ya da Development'ta boş). Ücretsiz, ağa çıkmaz:
/// anahtar kelimeyle birim seçer, kalıp taslak yazar. Akışın (kuyruk, yönlendirme, taslak onayı,
/// ekran) gerçek model bağlanmadan uçtan uca denenmesi için. Canlıda KULLANILMAZ.
///
/// Metinde "[yz-hata]" geçerse hata fırlatır (hata gösterimini denemek için).
/// </summary>
public sealed class FakeClassifier : IAiClassifier
{
    public string? Provider => "fake";
    public string Model => "sahte-asistan";

    private static readonly (string Code, string[] Words)[] Rules =
    {
        ("teknik_servis", new[] { "arıza", "bozuk", "çalışmıyor", "ses yapıyor", "tamir", "garanti", "servis" }),
        ("montaj", new[] { "montaj", "kurulum", "kurmaya" }),
        ("muhasebe", new[] { "fatura", "ödeme", "borç", "ekstre", "havale", "bakiye", "taksit" }),
        ("planlama", new[] { "ne zaman gel", "teslim", "sipariş", "kargo", "sevkiyat" }),
        ("kurumsal_satis", new[] { "kurumsal", "firmamız", "toplu alım", "bayi" }),
        ("magaza_satis", new[] { "fiyat", "stok", "model", "kampanya", "var mı" }),
        ("mudurluk", new[] { "şikayet", "şikâyet", "müdür", "yönetici" })
    };

    private static readonly string[] HumanWords = { "iskonto", "indirim", "pazarlık", "iade", "taksit", "vade" };
    private static readonly string[] ImportantWords = { "acil", "şikayet", "şikâyet", "rezalet", "avukat", "su kaçağı", "hala", "hâlâ" };

    public async Task<AiDecision> ClassifyAsync(AiInput input, CancellationToken ct)
    {
        var tr = CultureInfo.GetCultureInfo("tr-TR");
        var lastCustomer = input.Transcript.Reverse().TakeWhile(l => l.Direction == "in").Reverse().Select(l => l.Text);
        var text = string.Join(" ", lastCustomer).ToLower(tr);

        if (text.Contains("[yz-hata]")) throw new AiException("Sahte asistan: istenen deneme hatası.");

        var code = Rules.FirstOrDefault(r => r.Words.Any(text.Contains)).Code;
        if (code is not null && !input.Departments.Any(d => d.Code == code)) code = null;
        var needsHuman = HumanWords.Any(text.Contains);
        var important = ImportantWords.Any(text.Contains);
        var dep = input.Departments.FirstOrDefault(d => d.Code == code);

        var reply = needsHuman
            ? "Talebinizi aldık, ilgili arkadaşımız en kısa sürede size dönüş yapacak."
            : dep is null
                ? "Merhaba, size nasıl yardımcı olabiliriz?"
                : $"Merhaba, mesajınızı {dep.Name} birimimize ilettik; en kısa sürede dönüş yapacağız.";

        // 3. aşama: araç zincirini (ERP/Servis uçları, kapsam, iz kaydı) gerçek model olmadan denemek
        // için anahtar kelimeyle araç çağırır ve sonucu taslağa ham olarak ekler.
        if (input.Tools is { } tools)
        {
            var wanted = new List<string>();
            if (text.Contains("bakiye") || text.Contains("borcum") || text.Contains("borç")) wanted.Add(Tools.AiToolbox.Balance);
            if (text.Contains("sipariş")) wanted.Add(Tools.AiToolbox.Orders);
            if (text.Contains("fatura")) wanted.Add(Tools.AiToolbox.Invoices);
            if (text.Contains("servis") || text.Contains("montaj") || text.Contains("arıza")) wanted.Add(Tools.AiToolbox.Records);
            var no = System.Text.RegularExpressions.Regex.Match(text, @"\b(mnt|at|sh)-\d+", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            var parts = new List<string>();
            foreach (var name in wanted.Where(w => tools.Definitions.Any(d => d.Name == w)))
            {
                var arg = name == Tools.AiToolbox.Records && no.Success
                    ? System.Text.Json.JsonSerializer.SerializeToElement(new { kayit_no = no.Value.ToUpperInvariant() })
                    : System.Text.Json.JsonSerializer.SerializeToElement(new { });
                var r = await tools.ExecuteAsync(name, arg, ct);
                parts.Add($"[{name}] {(r.Content.Length > 300 ? r.Content[..300] + "…" : r.Content)}");
            }
            if (parts.Count > 0) reply += "\n\n(Sahte asistan — kayıtlar)\n" + string.Join("\n", parts);
        }

        var decision = new AiDecision(
            code, important, needsHuman,
            dep?.Name ?? "Genel",
            "Müşteri: " + (text.Length > 120 ? text[..120] + "…" : text),
            needsHuman ? "İnisiyatif konusu (sahte kural)" : "Anahtar kelime (sahte kural)",
            reply, Model, null, null) { ToolCalls = input.Tools?.Calls.ToList() ?? new List<Tools.AiToolCall>() };
        return decision;
    }
}

/// <summary>Sağlayıcı seçilmemiş: asistan devre dışı, gelen kutusu normal çalışır.</summary>
public sealed class DisabledClassifier : IAiClassifier
{
    public string? Provider => null;
    public string Model => string.Empty;
    public Task<AiDecision> ClassifyAsync(AiInput input, CancellationToken ct) =>
        throw new AiException("Yapay zekâ sağlayıcısı seçilmedi (Ai:Provider boş).");
}
