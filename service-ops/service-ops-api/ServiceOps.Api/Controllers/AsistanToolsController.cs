using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ServiceOps.Api.Filters;
using ServiceOps.Application.Services;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;

namespace ServiceOps.Api.Controllers;

/// <summary>
/// WHATSAPP ASİSTANI'NIN OKUMA UCU (2026-10-08, asistan 3. aşama) — YALNIZ OKUMA.
///
/// Müşteri WhatsApp'tan "servisim ne oldu / montaj ne zaman" diye sorunca asistan taslak yazarken
/// buraya sorar. Kayıt iki yoldan bulunur:
///  - TELEFON: kaydın ya da montaj kaleminin müşteri telefonu (son 10 hane) WhatsApp numarasıyla aynı.
///  - BAYİ: kaydın <c>DealerCode</c>'u numaranın eşleştiği ERP carilerinden biri (ya da alt hesabı).
/// Telefonu ve cari kodlarını ASİSTAN SUNUCUSU verir; yapay zekâ modeli veremez. Kayıt numarasıyla
/// arama da yalnız bu kümenin içinde yapılır.
///
/// Teknisyen notu, ücret ve adres DÖNMEZ: taslağa girmesi gereken bilgi değil.
/// Kimlik: <see cref="AsistanApiKeyAttribute"/> + <c>X-Tenant-Code</c>.
/// </summary>
[ApiController]
[Route("api/asistan-tools")]
[AsistanApiKey]
public sealed class AsistanToolsController : ControllerBase
{
    private readonly ApplicationDbContext _db;

    public AsistanToolsController(ApplicationDbContext db)
    {
        _db = db;
    }

    [HttpGet("records")]
    public async Task<IActionResult> Records([FromQuery] string? phone, [FromQuery] string? codes, [FromQuery] string? q,
        [FromQuery] int take = 8, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(Request.Headers["X-Tenant-Code"].FirstOrDefault()))
            return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var digits = new string((phone ?? string.Empty).Where(char.IsDigit).ToArray());
        var last10 = digits.Length >= 10 ? digits[^10..] : null;
        var dealerCodes = (codes ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Take(20).ToArray();
        if (last10 is null && dealerCodes.Length == 0)
            return BadRequest(new { success = false, message = "Telefon ya da cari kodu zorunlu." });
        take = Math.Clamp(take, 1, 20);
        var term = (q ?? string.Empty).Trim();

        // Telefon karşılaştırması rakamlara indirilmiş SON 10 HANE ile (kayıtta "0533 …", "+90 533…"
        // gibi serbest metin var) — EF bunu çeviremediği için kimlikler ham SQL ile seçilir.
        var conn = (NpgsqlConnection)_db.Database.GetDbConnection();
        if (conn.State != System.Data.ConnectionState.Open) await conn.OpenAsync(ct);
        var ids = new List<(Guid Id, bool ByPhone)>();
        await using (var cmd = new NpgsqlCommand("""
            SELECT r."Id",
                   (@p IS NOT NULL AND (
                      right(regexp_replace(COALESCE(r."CustomerPhone", ''), '\D', '', 'g'), 10) = @p
                      OR EXISTS (SELECT 1 FROM "ServiceRecordItems" i
                                 WHERE i."ServiceId" = r."Id"
                                   AND right(regexp_replace(COALESCE(i."CustomerPhone", ''), '\D', '', 'g'), 10) = @p))) AS by_phone
            FROM "ServiceRecords" r
            WHERE NOT r."IsDeleted"
              AND (@q = '' OR r."ServiceNumber" ILIKE '%' || @q || '%' OR COALESCE(r."ManualReceiptNo", '') ILIKE '%' || @q || '%')
              AND (
                   (@p IS NOT NULL AND (
                      right(regexp_replace(COALESCE(r."CustomerPhone", ''), '\D', '', 'g'), 10) = @p
                      OR EXISTS (SELECT 1 FROM "ServiceRecordItems" i
                                 WHERE i."ServiceId" = r."Id"
                                   AND right(regexp_replace(COALESCE(i."CustomerPhone", ''), '\D', '', 'g'), 10) = @p)))
                OR EXISTS (SELECT 1 FROM unnest(@codes) c WHERE r."DealerCode" = c OR r."DealerCode" LIKE c || '-%'))
            ORDER BY r."CreatedAt" DESC
            LIMIT @take
            """, conn))
        {
            cmd.Parameters.Add(new NpgsqlParameter("p", NpgsqlTypes.NpgsqlDbType.Text) { Value = (object?)last10 ?? DBNull.Value });
            cmd.Parameters.Add(new NpgsqlParameter("codes", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Text) { Value = dealerCodes });
            cmd.Parameters.AddWithValue("q", term);
            cmd.Parameters.AddWithValue("take", take);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) ids.Add((r.GetGuid(0), r.GetBoolean(1)));
        }
        if (ids.Count == 0) return Ok(new { items = Array.Empty<object>() });

        var idList = ids.Select(x => x.Id).ToList();
        var records = await _db.ServiceRecords.AsNoTracking()
            .Where(s => idList.Contains(s.Id))
            .Include(s => s.Items)
            .Include(s => s.InstallationTasks)
            .ToListAsync(ct);

        var items = ids
            .Select(x => (Record: records.FirstOrDefault(s => s.Id == x.Id), x.ByPhone))
            .Where(x => x.Record is not null)
            .Select(x => ToDto(x.Record!, x.ByPhone));
        return Ok(new { items });
    }

    private static object ToDto(ServiceRecord s, bool byPhone)
    {
        var isMontaj = s.Type == ServiceType.Installation || s.ServiceNumber.StartsWith("MNT", StringComparison.OrdinalIgnoreCase);
        return new
        {
            number = s.ServiceNumber,
            kind = isMontaj ? "Montaj" : s.Type switch
            {
                ServiceType.Maintenance => "Bakım",
                ServiceType.Warranty => "Garanti",
                _ => s.ProductCategory == ProductCategory.Small || s.ServiceNumber.StartsWith("AT-", StringComparison.OrdinalIgnoreCase)
                    ? "Arıza (küçük ürün / atölye)"
                    : "Arıza (büyük ürün)"
            },
            matchedBy = byPhone ? "telefon" : "bayi",
            // Montajda kaydın kendi durumu ("Yeni kayıt") kalemleri yansıtmaz; ekran durumu kalemlerden
            // türetiyor — aynı kural (ServiceRecordService.DeriveRecordState) burada da.
            status = isMontaj && ServiceRecordService.DeriveRecordState(s) is { } derived
                ? ServiceRecordService.StateLabel(derived)
                : StatusLabel(s.Status),
            createdAt = s.CreatedAt,
            plannedAt = s.PlannedAt,
            estimatedDelivery = s.EstimatedDeliveryDate,
            completedAt = s.CompletedAt,
            customerName = s.CustomerName,
            dealerName = s.DealerName,
            product = string.Join(" ", new[] { s.ProductName, s.ProductModel }.Where(p => !string.IsNullOrWhiteSpace(p))),
            underWarranty = s.IsUnderWarranty,
            problem = Cut(s.ProblemDescription, 200),
            solution = s.Status is ServiceStatus.Ready or ServiceStatus.Delivered or ServiceStatus.FieldCompleted or ServiceStatus.WorkshopReady
                ? Cut(s.SolutionDescription, 200)
                : null,
            invoiceNo = s.InvoiceReference is { } inv && !inv.StartsWith("PENDING:", StringComparison.Ordinal) ? inv : null,
            // Montaj: kalem kalem durum. Bir kalemin adetleri ayrı ilerler (2'si planlandı, 1'i gerçekleşti).
            lines = isMontaj
                ? s.Items.OrderBy(i => i.SortOrder).Select(i => new
                {
                    product = i.ProductName,
                    quantity = i.Quantity,
                    state = i.CancelledAt is not null ? "İptal" : TaskSummary(s.InstallationTasks.Where(t => t.ServiceRecordItemId == i.Id).ToList(), i.Quantity)
                })
                : null
        };
    }

    /// <summary>Kalemin görev satırlarından tek cümlelik durum: "1 adet planlandı (14.10), 1 adet gerçekleşti".</summary>
    private static string TaskSummary(List<InstallationTask> tasks, int quantity)
    {
        if (tasks.Count == 0) return "Planlanmayı bekliyor";
        string Label(InstallationTask t) => t.Status switch
        {
            InstallationTaskStatus.Completed or InstallationTaskStatus.Delivered => "gerçekleşti",
            InstallationTaskStatus.Cancelled => "iptal",
            InstallationTaskStatus.Unreachable => "müşteriye ulaşılamadı",
            InstallationTaskStatus.Postponed => "ertelendi",
            InstallationTaskStatus.InProgress => "devam ediyor",
            InstallationTaskStatus.Deferred => "planlanmayı bekliyor",
            InstallationTaskStatus.Planned when t.PlannedAt is null => "planlanmayı bekliyor",
            InstallationTaskStatus.Planned when t.TransferredAt is not null => $"sahaya aktarıldı ({Day(t.PlannedAt)})",
            InstallationTaskStatus.Planned => $"planlandı ({Day(t.PlannedAt)})",
            _ => t.Status.ToString()
        };
        return string.Join(", ", tasks.GroupBy(Label).Select(g => $"{g.Sum(t => Math.Max(1, t.Quantity))} adet {g.Key}"));
    }

    private static string Day(DateTime? d) =>
        d is null ? "" : TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(d.Value, DateTimeKind.Utc), Tz).ToString("dd.MM.yyyy");

    private static readonly TimeZoneInfo Tz = FindTz();

    private static TimeZoneInfo FindTz()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById("Europe/Istanbul"); }
        catch { return TimeZoneInfo.CreateCustomTimeZone("TR", TimeSpan.FromHours(3), "TR", "TR"); }
    }

    /// <summary>Ekrandaki Türkçe karşılıklar (service-ops-frontend statusChangeGate.STATUS_LABELS ile aynı).</summary>
    private static string StatusLabel(ServiceStatus s) => s switch
    {
        ServiceStatus.New => "Yeni kayıt (henüz planlanmadı)",
        ServiceStatus.FieldPlanned => "Saha planlamasında",
        ServiceStatus.Workshop => "Atölyede",
        ServiceStatus.InRepair => "Tamir devam ediyor",
        ServiceStatus.WaitingForParts => "Parça bekliyor",
        ServiceStatus.Ready => "Gerçekleşti",
        ServiceStatus.InDelivery => "Teslimatta",
        ServiceStatus.Delivered => "Teslim edildi",
        ServiceStatus.Cancelled => "İptal",
        ServiceStatus.Delayed or ServiceStatus.Postponed => "Ertelendi",
        ServiceStatus.Planned => "Planlandı",
        ServiceStatus.SmallProductAcceptance => "Küçük ürün kabulde",
        ServiceStatus.WorkshopReady => "Atölyede tamamlandı, teslimat bekliyor",
        ServiceStatus.DeliveryPlanning => "Teslimat planlanıyor",
        ServiceStatus.FieldCompleted => "Sahada tamamlandı",
        ServiceStatus.LargeProductPlanning => "Planlama bekliyor",
        _ => s.ToString()
    };

    private static string? Cut(string? s, int max) =>
        string.IsNullOrWhiteSpace(s) ? null : s.Length <= max ? s.Trim() : s[..max].Trim() + "…";
}
