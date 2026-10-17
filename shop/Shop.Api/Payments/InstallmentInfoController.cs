using Microsoft.AspNetCore.Mvc;
using Npgsql;
using Shop.Api.Infrastructure;

namespace Shop.Api.Payments;

/// <summary>
/// TAKSİT SEÇENEKLERİ — herkese açık, ürün sayfası için (2026-09-21).
///
/// Kıbrıs'ta büyük alışverişin ilk sorusu "kaç taksit?". Vitrin bunu "bankanıza göre taksit"
/// diye geçiştiriyordu; oysa ERP'de banka bazlı taksit kuralları zaten tanımlı
/// (<c>VirtualPosInstallmentRules</c> + <c>VirtualPosDefinitions</c>) ve ödeme adımında kart
/// numarasına göre bunlar uygulanıyor. Aynı kurallar ürün sayfasında da gösterilsin ki müşteri
/// karar anında "İş Bankası 3 taksit, Ziraat 5 taksit" görsün.
///
/// Yalnız OKUR; tutar üzerinden aylık taksit tutarı hesaplar (vade farkı yok — kurallar öyle;
/// vade farkı eklenirse burası da ödeme adımıyla aynı hesabı kullanmalı).
/// Kurallar 10 dakika bellekte tutulur: ürün sayfası başına ERP sorgusu gereksiz.
/// </summary>
[ApiController]
[Route("api/catalog/installments")]
public sealed class InstallmentInfoController : ControllerBase
{
    private readonly TenantResolver _tenant;
    private static readonly object Gate = new();
    private static (DateTime LoadedUtc, string Tenant, List<Rule> Rules)? _cache;

    public InstallmentInfoController(TenantResolver tenant)
    {
        _tenant = tenant;
    }

    private sealed record Rule(int BankCode, string BankName, int Count, int Bonus, decimal MinAmount, decimal MaxAmount, string Text);

    /// <summary>
    /// <c>?tutar=18400</c> verilirse yalnız o tutara uyan seçenekler ve aylık tutar döner;
    /// verilmezse kural listesi (vitrin kartları kendi hesaplar).
    /// </summary>
    [HttpGet]
    [ResponseCache(Duration = 300)]
    public async Task<IActionResult> Get([FromQuery] decimal? tutar, CancellationToken ct)
    {
        var rules = await LoadAsync(ct);
        if (rules.Count == 0) return Ok(new { banks = Array.Empty<object>(), maxInstallment = 0 });

        var amount = tutar.GetValueOrDefault();
        var eligible = amount > 0
            ? rules.Where(r => amount >= r.MinAmount && amount <= r.MaxAmount).ToList()
            : rules;

        var banks = eligible
            .GroupBy(r => new { r.BankCode, r.BankName })
            .Select(g => new
            {
                bankCode = g.Key.BankCode,
                bankName = g.Key.BankName,
                // Aylık tutar ERP ile AYNI hesap (VirtualPosService.GetInstallmentOptionsAsync): tutar / bayi taksidi.
                // Banka hediyesi (+N) toplam taksit sayısını artırır, aylık tutarı ERP değiştirmiyor.
                options = g.OrderBy(r => r.Count).Select(r => new
                {
                    count = r.Count + r.Bonus,
                    text = r.Bonus > 0 ? $"{r.Count} + {r.Bonus} taksit" : $"{r.Count} taksit",
                    minAmount = r.MinAmount,
                    monthly = amount > 0 ? Math.Round(amount / r.Count, 2, MidpointRounding.AwayFromZero) : (decimal?)null
                })
            })
            .OrderBy(b => b.bankName)
            .ToList();

        return Ok(new
        {
            banks,
            maxInstallment = eligible.Count == 0 ? 0 : eligible.Max(r => r.Count + r.Bonus)
        });
    }

    private async Task<List<Rule>> LoadAsync(CancellationToken ct)
    {
        var tenant = _tenant.TenantCode;
        lock (Gate)
        {
            if (_cache is { } c && c.Tenant == tenant && DateTime.UtcNow - c.LoadedUtc < TimeSpan.FromMinutes(10))
                return c.Rules;
        }

        var rules = new List<Rule>();
        try
        {
            await using var conn = new NpgsqlConnection(_tenant.ErpConnectionString());
            await conn.OpenAsync(ct);
            // Taksitsiz ("TEK ÇEKİM") satırlar dışarıda: müşteriye "taksit seçeneği" olarak anlamı yok.
            await using var cmd = new NpgsqlCommand("""
                SELECT r."BankCode", COALESCE(NULLIF(d."BankName", ''), 'Banka'), r."MerchantInstallment", r."BankInstallment",
                       r."MinAmount", r."MaxAmount", r."InstallmentText"
                FROM "VirtualPosInstallmentRules" r
                LEFT JOIN "VirtualPosDefinitions" d ON d."BankCode" = r."BankCode" AND d."IsActive"
                WHERE r."IsActive" AND r."MerchantInstallment" > 1
                  AND (r."BankCode" = 0 OR d."Id" IS NOT NULL)
                ORDER BY r."BankCode", r."MerchantInstallment"
                """, conn);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                rules.Add(new Rule(
                    reader.GetInt32(0),
                    PrettyBank(reader.GetString(1)),
                    reader.GetInt32(2),
                    reader.GetInt32(3),
                    reader.GetDecimal(4),
                    reader.GetDecimal(5),
                    reader.GetString(6)));
            }
        }
        catch
        {
            // ERP okunamazsa taksit bloğu hiç görünmez; sayfa çökmez.
            rules = new List<Rule>();
        }

        lock (Gate) _cache = (DateTime.UtcNow, tenant, rules);
        return rules;
    }

    /// <summary>"ZİRAAT BANKASI" → "Ziraat Bankası"; "İŞ BANKASI" → "İş Bankası"; kısaltmalar (BBVA) kalır.</summary>
    private static string PrettyBank(string raw)
    {
        var words = raw.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var tr = new System.Globalization.CultureInfo("tr-TR");
        for (var i = 0; i < words.Length; i++)
        {
            var w = words[i];
            if (w is "BBVA" or "TEB" or "QNB" or "ING" or "HSBC") continue;
            // ASCII "I" içeren yabancı adlar ("CREDITWEST", "CARDPLUS") tr-TR ile "Credıtwest" olur;
            // Türkçe olmayan harf yoksa ve kelime bilinen Türkçe banka adı değilse I → i.
            var isTurkish = w.Any(ch => ch is 'Ç' or 'Ğ' or 'İ' or 'Ö' or 'Ş' or 'Ü') || w is "BANKASI" or "KATILIM" or "YATIRIM" or "HALKBANK" or "KOOPBANK";
            var lower = (isTurkish ? w : w.Replace('I', 'i')).ToLower(tr);
            words[i] = char.ToUpper(lower[0], tr) + lower[1..];
        }
        return string.Join(' ', words);
    }
}
