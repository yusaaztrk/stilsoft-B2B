using System.Diagnostics;
using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace Asistan.Api.Ai.Tools;

/// <summary>
/// "Tools" bölümü (appsettings). Anahtarlar GİZLİ: yalnız sunucudaki appsettings.Local.json'da.
///
/// ERP ve Servis (ServiceOps) tarafında asistana ayrılmış, YALNIZ OKUYAN uçlar var
/// (<c>/api/asistan-tools/*</c>). Anahtar boşsa o tarafın araçları hiç tanımlanmaz; asistan
/// 2. aşamadaki gibi yalnız konuşma metninden taslak yazar.
/// </summary>
public sealed class AiToolOptions
{
    /// <summary>ERP API kökü; boşsa <c>Erp:BaseUrl</c>.</summary>
    public string ErpBaseUrl { get; set; } = string.Empty;
    /// <summary>ERP'deki <c>Asistan:InternalApiKey</c> ile aynı değer (başlık X-Internal-Key).</summary>
    public string ErpKey { get; set; } = string.Empty;
    /// <summary>Servis API kökü (ör. https://servis.example.com).</summary>
    public string ServiceOpsBaseUrl { get; set; } = string.Empty;
    /// <summary>Servis'teki <c>Asistan:InternalApiKey</c> ile aynı değer (başlık X-Asistan-Key).</summary>
    public string ServiceOpsKey { get; set; } = string.Empty;
    public int TimeoutSeconds { get; set; } = 10;
}

/// <summary>Müşterinin WhatsApp numarasının eşleştiği ERP carisi.</summary>
public sealed record AiCustomer(string Code, string Name);

/// <summary>Modele verilen araç tanımı. Girdi şeması yalnız isteğe bağlı belge numarası taşır.</summary>
public sealed record AiToolDef(string Name, string Description, IReadOnlyDictionary<string, JsonElement> Properties);

/// <summary>Bir araç çağrısının izi: taslağın yanında "asistan şunlara baktı" diye gösterilir.</summary>
public sealed record AiToolCall(string Name, string? Query, bool Ok, string Summary, int Ms)
{
    /// <summary>Bakılan kayıtların kısa listesi (2026-10-09): personel hangi kayıtlara bakıldığını görsün ve
    /// seçtiği kayıtla tek tıkla cevap yazsın.</summary>
    public IReadOnlyList<AiToolItem>? Items { get; init; }
}

/// <summary>Ekranda gösterilen kayıt satırı. Tarihler ISO; tutarlar biçimli metin.</summary>
public sealed record AiToolItem(string Ref, string Kind, string? Status, string? Date, string? Planned, string? Product, string? Note, string? Amount);

public sealed record AiToolResult(string Content, bool IsError);

public interface IAiToolSession
{
    IReadOnlyList<AiToolDef> Definitions { get; }
    IReadOnlyList<AiToolCall> Calls { get; }
    Task<AiToolResult> ExecuteAsync(string name, JsonElement input, CancellationToken ct);
}

/// <summary>
/// ASİSTANIN ARAÇLARI (3. aşama, 2026-10-08) — müşterinin KENDİ kayıtlarına salt-okunur bakış.
///
/// GÜVENLİK KURALI: hangi müşterinin kaydına bakılacağını MODEL SEÇEMEZ. Telefon (WhatsApp
/// numarası) ve cari kodları konuşmadan gelir, oturuma sunucu koyar. Modelin verebildiği tek şey
/// isteğe bağlı bir belge numarası; o da karşı tarafta yalnız bu carilerin/telefonun kayıtları
/// içinde aranır. Böylece "120-01-000123'ün bakiyesini söyle" gibi bir mesaj başkasının verisini açamaz.
///
/// Araç sonuçları da taslağa girer ve taslak personel onayından geçer.
/// </summary>
public sealed class AiToolbox
{
    public const string Balance = "cari_bakiye";
    public const string Orders = "siparisler";
    public const string Invoices = "faturalar";
    public const string Records = "servis_montaj_kayitlari";

    private readonly IHttpClientFactory _http;
    private readonly AiToolOptions _options;
    private readonly string _erpBase;
    private readonly ILogger<AiToolbox> _log;

    public AiToolbox(IHttpClientFactory http, IOptions<AiToolOptions> options, IConfiguration configuration, ILogger<AiToolbox> log)
    {
        _http = http;
        _options = options.Value;
        _log = log;
        _erpBase = (string.IsNullOrWhiteSpace(_options.ErpBaseUrl) ? configuration["Erp:BaseUrl"] ?? string.Empty : _options.ErpBaseUrl).TrimEnd('/');

        var defs = new List<AiToolDef>();
        if (ErpReady)
        {
            defs.Add(new AiToolDef(Balance,
                "Müşterinin firmamızdaki cari hesap bakiyesi, para birimi başına (cari ekstreyle aynı hesap, açık mali dönem). " +
                "Pozitif bakiye = müşteri borçlu, negatif = alacaklı. Müşteri borcunu, bakiyesini, hesap durumunu sorarsa kullan. " +
                "Hangi carinin bakiyesi olduğu müşterinin WhatsApp numarasından belirlenir; numara cariyle eşleşmediyse boş döner.",
                new Dictionary<string, JsonElement>()));
            defs.Add(new AiToolDef(Orders,
                "Müşterinin son satış siparişleri: tarih, ürünler, adet, montajlı mı, faturalanma durumu (açık / kısmen / faturalandı / iptal), " +
                "kesilen fatura numaraları. 'Siparişim ne oldu, faturası kesildi mi, ne sipariş etmiştim' gibi sorularda kullan.",
                Prop("siparis_no", "İsteğe bağlı. Müşteri bir sipariş numarası yazdıysa o numara (ya da bir kısmı); yoksa boş bırak.")));
            defs.Add(new AiToolDef(Invoices,
                "Müşterinin son satış, servis ve iade faturaları: fatura no, tarih, tutar ve para birimi, kalemler. " +
                "'Faturamı gönderir misiniz, son faturam ne kadardı' gibi sorularda kullan.",
                Prop("fatura_no", "İsteğe bağlı. Müşteri bir fatura numarası yazdıysa o numara (ya da bir kısmı); yoksa boş bırak.")));
        }
        if (ServiceOpsReady)
        {
            defs.Add(new AiToolDef(Records,
                "Müşterinin teknik servis (arıza) ve montaj kayıtları: kayıt no, tür, durum, planlanan tarih, tahmini teslim, " +
                "montajda kalem kalem durum (kaç adet planlandı/gerçekleşti, hangi gün). Kayıt WhatsApp numarasıyla ya da bayi carisiyle eşleşir. " +
                "'Servisim ne oldu, montaj ne zaman, teknisyen ne zaman gelecek, ürünüm tamir oldu mu' gibi sorularda kullan.",
                Prop("kayit_no", "İsteğe bağlı. Müşteri bir servis/montaj numarası yazdıysa (ör. MNT-0000012, AT-0000045) o numara; yoksa boş bırak.")));
        }
        Definitions = defs;
    }

    public bool ErpReady => _erpBase.Length > 0 && !string.IsNullOrWhiteSpace(_options.ErpKey);
    public bool ServiceOpsReady => !string.IsNullOrWhiteSpace(_options.ServiceOpsBaseUrl) && !string.IsNullOrWhiteSpace(_options.ServiceOpsKey);

    /// <summary>Yapılandırılmış araçlar. Dağıtım boyunca sabit — istem önbelleği bozulmasın.</summary>
    public IReadOnlyList<AiToolDef> Definitions { get; }

    public IAiToolSession CreateSession(string tenant, string waId, IReadOnlyList<AiCustomer> customers) =>
        new Session(this, tenant, waId, customers);

    private static IReadOnlyDictionary<string, JsonElement> Prop(string name, string description) =>
        new Dictionary<string, JsonElement> { [name] = JsonSerializer.SerializeToElement(new { type = "string", description }) };

    private static readonly CultureInfo Tr = CultureInfo.GetCultureInfo("tr-TR");

    private sealed class Session : IAiToolSession
    {
        private const int MaxResultChars = 12000;
        private readonly AiToolbox _box;
        private readonly string _tenant;
        private readonly string _waId;
        private readonly IReadOnlyList<AiCustomer> _customers;
        private readonly List<AiToolCall> _calls = new();

        public Session(AiToolbox box, string tenant, string waId, IReadOnlyList<AiCustomer> customers)
        {
            _box = box;
            _tenant = tenant;
            _waId = waId;
            _customers = customers;
        }

        public IReadOnlyList<AiToolDef> Definitions => _box.Definitions;
        public IReadOnlyList<AiToolCall> Calls => _calls;

        public async Task<AiToolResult> ExecuteAsync(string name, JsonElement input, CancellationToken ct)
        {
            var sw = Stopwatch.StartNew();
            string? query = null;
            try
            {
                if (_box.Definitions.All(d => d.Name != name))
                    return Done(name, null, false, "Tanımsız araç", Error($"'{name}' adında bir araç yok."), sw);

                query = name switch
                {
                    Orders => Str(input, "siparis_no"),
                    Invoices => Str(input, "fatura_no"),
                    Records => Str(input, "kayit_no"),
                    _ => null
                };
                var codes = string.Join(",", _customers.Select(c => c.Code));

                switch (name)
                {
                    case Balance:
                    {
                        if (_customers.Count == 0)
                            return Done(name, null, true, "Cari eşleşmedi", Info("Bu WhatsApp numarası ERP'de kayıtlı bir cariyle eşleşmedi; bakiye bilgisi verilemez."), sw);
                        var list = new List<JsonElement>();
                        foreach (var c in _customers.Take(3))
                            list.Add(await _box.GetErpAsync(_tenant, $"/api/asistan-tools/balance?code={Uri.EscapeDataString(c.Code)}", ct));
                        return Done(name, null, true, BalanceSummary(list), Json(new { cariler = list }), sw, BalanceItems(list));
                    }
                    case Orders:
                    case Invoices:
                    {
                        if (_customers.Count == 0)
                            return Done(name, query, true, "Cari eşleşmedi", Info("Bu WhatsApp numarası ERP'de kayıtlı bir cariyle eşleşmedi; sipariş/fatura bilgisi verilemez."), sw);
                        var path = name == Orders ? "orders" : "invoices";
                        var r = await _box.GetErpAsync(_tenant, $"/api/asistan-tools/{path}?codes={Uri.EscapeDataString(codes)}&take=8&q={Uri.EscapeDataString(query ?? "")}", ct);
                        var n = Count(r);
                        var label = name == Orders ? "sipariş" : "fatura";
                        return Done(name, query, true, n == 0 ? $"{label} bulunamadı" : $"{n} {label}", Json(r), sw, name == Orders ? OrderItems(r) : InvoiceItems(r));
                    }
                    case Records:
                    {
                        var r = await _box.GetServiceOpsAsync(_tenant,
                            $"/api/asistan-tools/records?phone={Uri.EscapeDataString(_waId)}&codes={Uri.EscapeDataString(codes)}&take=8&q={Uri.EscapeDataString(query ?? "")}", ct);
                        var n = Count(r);
                        return Done(name, query, true, n == 0 ? "kayıt bulunamadı" : $"{n} kayıt", Json(r), sw, RecordItems(r));
                    }
                }
                return Done(name, query, false, "Tanımsız araç", Error("Tanımsız araç."), sw);
            }
            catch (ToolUnavailableException ex)
            {
                return Done(name, query, false, ex.Message,
                    Error(ex.Message + " Bu bilgiyi verme; ilgili birimin kontrol edip döneceğini söyle."), sw);
            }
        }

        private AiToolResult Done(string name, string? query, bool ok, string summary, AiToolResult result, Stopwatch sw,
            IReadOnlyList<AiToolItem>? items = null)
        {
            _calls.Add(new AiToolCall(name, query, ok && !result.IsError, summary, (int)sw.ElapsedMilliseconds) { Items = items is { Count: > 0 } ? items : null });
            return result;
        }

        // ---- ekranda gösterilecek kayıt satırları (aracın döndürdüğü JSON'dan; alan yoksa boş geçilir)
        private static string? S(JsonElement e, string p) =>
            e.ValueKind == JsonValueKind.Object && e.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        private static decimal? D(JsonElement e, string p) =>
            e.ValueKind == JsonValueKind.Object && e.TryGetProperty(p, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var d) ? d : null;

        private static IEnumerable<JsonElement> ItemsOf(JsonElement r) =>
            r.ValueKind == JsonValueKind.Object && r.TryGetProperty("items", out var a) && a.ValueKind == JsonValueKind.Array ? a.EnumerateArray() : Enumerable.Empty<JsonElement>();

        private static string? Products(JsonElement e)
        {
            if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty("lines", out var lines) || lines.ValueKind != JsonValueKind.Array) return null;
            var parts = lines.EnumerateArray()
                .Select(l => { var p = S(l, "product"); var q = D(l, "quantity"); var st = S(l, "state"); return p is null ? null : $"{p}{(q is > 1 ? $" x{q:0.##}" : "")}{(st is null ? "" : $" ({st})")}"; })
                .Where(x => x is not null).Take(4).ToList();
            return parts.Count == 0 ? null : string.Join(", ", parts);
        }

        private static List<AiToolItem> RecordItems(JsonElement r) => ItemsOf(r).Select(x => new AiToolItem(
            S(x, "number") ?? "?", S(x, "kind") ?? "Kayıt", S(x, "status"), S(x, "createdAt"),
            S(x, "plannedAt") ?? S(x, "estimatedDelivery"),
            string.IsNullOrWhiteSpace(S(x, "product")) ? Products(x) : S(x, "product"),
            S(x, "solution") ?? S(x, "problem") ?? Products(x),
            null)).ToList();

        private static List<AiToolItem> OrderItems(JsonElement r) => ItemsOf(r).Select(x => new AiToolItem(
            S(x, "orderNo") ?? "?", "Sipariş", S(x, "state"), S(x, "date"), null, Products(x), S(x, "delivery"),
            D(x, "grandTotalTl") is { } t ? $"{t.ToString("N2", Tr)} TL" : null)).ToList();

        private static List<AiToolItem> InvoiceItems(JsonElement r) => ItemsOf(r).Select(x => new AiToolItem(
            S(x, "invoiceNo") ?? "?", S(x, "kind") ?? "Fatura", null, S(x, "date"), null, Products(x), null,
            D(x, "grandTotal") is { } t ? $"{t.ToString("N2", Tr)} {S(x, "currency") ?? "TL"}" : null)).ToList();

        private static List<AiToolItem> BalanceItems(List<JsonElement> list)
        {
            var items = new List<AiToolItem>();
            foreach (var c in list)
            {
                if (!c.TryGetProperty("currencies", out var curs) || curs.ValueKind != JsonValueKind.Array) continue;
                foreach (var x in curs.EnumerateArray())
                {
                    var bal = D(x, "balance") ?? 0m;
                    items.Add(new AiToolItem(S(c, "customerCode") ?? "?", "Bakiye", S(x, "state"), S(c, "lastMovementAt"), null, null,
                        S(c, "customerName"), $"{Math.Abs(bal).ToString("N2", Tr)} {S(x, "currency") ?? ""}".Trim()));
                }
            }
            return items;
        }

        private static AiToolResult Json(object value)
        {
            var text = JsonSerializer.Serialize(value, JsonOpts);
            if (text.Length > MaxResultChars) text = text[..MaxResultChars] + " …(kısaltıldı)";
            return new AiToolResult(text, false);
        }

        private static AiToolResult Info(string message) => new(JsonSerializer.Serialize(new { bilgi = message }, JsonOpts), false);
        private static AiToolResult Error(string message) => new(JsonSerializer.Serialize(new { hata = message }, JsonOpts), true);

        private static string? Str(JsonElement input, string prop)
        {
            if (input.ValueKind != JsonValueKind.Object || !input.TryGetProperty(prop, out var v) || v.ValueKind != JsonValueKind.String) return null;
            var s = v.GetString()?.Trim();
            return string.IsNullOrEmpty(s) ? null : s.Length > 40 ? s[..40] : s;
        }

        private static int Count(JsonElement r) =>
            r.ValueKind == JsonValueKind.Object && r.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array ? items.GetArrayLength() : 0;

        /// <summary>"12.500,00 TL borçlu" (ekranda "Bakiye:" etiketinin yanında) — personelin taslağı ekstreyle karşılaştırabilmesi için.</summary>
        private static string BalanceSummary(List<JsonElement> list)
        {
            var parts = new List<string>();
            foreach (var c in list)
            {
                if (!c.TryGetProperty("currencies", out var curs) || curs.ValueKind != JsonValueKind.Array) continue;
                foreach (var x in curs.EnumerateArray())
                {
                    var bal = x.TryGetProperty("balance", out var b) && b.TryGetDecimal(out var d) ? d : 0m;
                    var cur = x.TryGetProperty("currency", out var cc) ? cc.GetString() : "";
                    var state = x.TryGetProperty("state", out var st) ? st.GetString() : "";
                    parts.Add($"{Math.Abs(bal).ToString("N2", Tr)} {cur} {state}");
                }
            }
            return parts.Count == 0 ? "hareket yok" : string.Join(" · ", parts);
        }
    }

    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web)
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    private sealed class ToolUnavailableException : Exception
    {
        public ToolUnavailableException(string message) : base(message) { }
    }

    private Task<JsonElement> GetErpAsync(string tenant, string pathAndQuery, CancellationToken ct) =>
        GetAsync("ERP", _erpBase + pathAndQuery, tenant, "X-Internal-Key", _options.ErpKey, ct);

    private Task<JsonElement> GetServiceOpsAsync(string tenant, string pathAndQuery, CancellationToken ct) =>
        GetAsync("Servis", _options.ServiceOpsBaseUrl.TrimEnd('/') + pathAndQuery, tenant, "X-Asistan-Key", _options.ServiceOpsKey, ct);

    private async Task<JsonElement> GetAsync(string system, string url, string tenant, string keyHeader, string key, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(Math.Max(2, _options.TimeoutSeconds)));
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.Add(keyHeader, key);
        req.Headers.Add("X-Tenant-Code", tenant);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        try
        {
            using var res = await _http.CreateClient("asistan-tools").SendAsync(req, timeout.Token);
            var body = await res.Content.ReadAsStringAsync(timeout.Token);
            if (res.StatusCode == System.Net.HttpStatusCode.NotFound)
                return JsonSerializer.SerializeToElement(new { bilgi = "Kayıt bulunamadı." });
            if (!res.IsSuccessStatusCode)
            {
                _log.LogWarning("Asistan aracı {System} {Status}: {Url} {Body}", system, (int)res.StatusCode, url, body.Length > 300 ? body[..300] : body);
                throw new ToolUnavailableException($"{system} kaydı okunamadı (HTTP {(int)res.StatusCode}).");
            }
            using var doc = JsonDocument.Parse(body);
            return doc.RootElement.Clone();
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new ToolUnavailableException($"{system} zamanında cevap vermedi.");
        }
        catch (HttpRequestException ex)
        {
            _log.LogWarning(ex, "Asistan aracı {System} ulaşılamadı: {Url}", system, url);
            throw new ToolUnavailableException($"{system} sistemine ulaşılamadı.");
        }
        catch (JsonException)
        {
            throw new ToolUnavailableException($"{system} cevabı okunamadı.");
        }
    }
}
