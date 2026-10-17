using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;
using Microsoft.AspNetCore.SignalR;
using ServiceOps.Api.Hubs;
// ToTurkishString: iptal Activity'lerinde durum adları Türkçe yazılıyor; geçmiş modalı bu
// metinleri olduğu gibi gösteriyor.
using ServiceOps.Application.Dtos;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class MontajController : ControllerBase
{
    private readonly IConfiguration _configuration;
    private readonly ServiceOps.Application.Interfaces.IServiceRecordService _serviceRecordService;
    private readonly ApplicationDbContext _dbContext;
    private readonly IHubContext<ServiceOpsHub> _hub;

    public MontajController(IConfiguration configuration, ServiceOps.Application.Interfaces.IServiceRecordService serviceRecordService, ApplicationDbContext dbContext, IHubContext<ServiceOpsHub> hub)
    {
        _configuration = configuration;
        _serviceRecordService = serviceRecordService;
        _dbContext = dbContext;
        _hub = hub;
    }

    public record CreateMontajRequest(
        string? DealerCode,
        string? DealerName,
        string ProductName,
        decimal Quantity,
        string CustomerName,
        string Phone,
        string Address,
        string Region,
        string? Note,
        string? Type,
        // B2B tarafındaki montaj kaydının kimliği ("B2B-INST-{id}"). Aynı montaj iki kez
        // gönderildiğinde kalem çoğalmasın, silinirken doğru kalem bulunsun diye.
        string? ExternalRef = null,
        string? InvoiceNo = null,
        string? ProductStockCode = null
    );

    public record PlanMontajRequest(string PlannedDateUtc, string Technician);

    public record UpdateStatusRequest(string Status);

    [HttpGet("list")]
    public async Task<ActionResult<object>> List(CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
        await EnsureMontajTablesAsync(conn, cancellationToken);

        var list = await ReadInstallationsAsync(conn, cancellationToken);
        return Ok(new { success = true, data = list });
    }

    [HttpGet("report")]
    public async Task<ActionResult<object>> Report(CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
        await EnsureMontajTablesAsync(conn, cancellationToken);

        var list = await ReadInstallationsAsync(conn, cancellationToken);
        return Ok(new { success = true, data = list });
    }

    /// <summary>
    /// B2B fatura montajını ServiceOps'a taşır. Eskiden [AllowAnonymous] idi: ağdan erişebilen
    /// herkes montaj kaydı oluşturabiliyordu.
    ///
    /// Her çağrı bir FATURA KALEMİ montajıdır, bir kayıt değil. Kural şu:
    ///  1. Aynı montaj (ExternalRef) daha önce geldiyse kalem GÜNCELLENİR — kopya açılmaz.
    ///  2. Aynı faturanın hâlâ "Yeni Kayıt" aşamasındaki (planlanmamış) kaydı varsa ve müşteri /
    ///     adres aynıysa montaj o kayda KALEM olarak eklenir.
    ///  3. Kayıt planlamayı geçtiyse (ya da başka müşteri/adres) YENİ KAYIT açılır.
    ///
    /// Planlama satırları burada üretilmez: InstallationsController kalemlerden türetiyor
    /// (EnsureDeferredTasksForItemsAsync). Eskiden burada kalem bağı olmayan görevler açılıyordu
    /// ve o görevler kalem üretimini tamamen kilitliyordu — kayıt planlamada boş görünüyordu.
    /// </summary>
    [HttpPost]
    [ServiceOps.Api.Filters.InternalApiKeyOrUser]
    public async Task<ActionResult<object>> Create([FromBody] CreateMontajRequest req, CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        if (string.IsNullOrWhiteSpace(req.ProductName)) return BadRequest(new { success = false, message = "ProductName zorunlu" });
        if (string.IsNullOrWhiteSpace(req.CustomerName)) return BadRequest(new { success = false, message = "CustomerName zorunlu" });

        var quantity = req.Quantity <= 0 ? 1 : (int)Math.Ceiling(req.Quantity);
        var externalRef = Trimmed(req.ExternalRef);
        var invoiceNo = Trimmed(req.InvoiceNo);
        var productName = req.ProductName.Trim();
        var stockCode = Trimmed(req.ProductStockCode);
        var dealerNote = Trimmed(req.Note);
        var now = DateTime.UtcNow;

        // 1) Bu montaj daha önce geldiyse kalemi tazele, yeni kayıt açma.
        if (externalRef is not null)
        {
            var existingItem = await _dbContext.ServiceRecordItems
                .Include(i => i.Service)
                .FirstOrDefaultAsync(i => i.ExternalRef == externalRef, cancellationToken);

            if (existingItem is not null)
            {
                existingItem.ProductName = productName;
                existingItem.ProductStockCode = stockCode;
                existingItem.Notes = dealerNote;
                ApplyCustomerInfo(existingItem, req);
                existingItem.UpdatedAt = now;

                // KALDIRILIP TEKRAR EKLENEN MONTAJ. B2B'de "Montajı Kaldır" denip sonra aynı
                // kalem yeniden montajlanınca buraya düşülüyordu — ama iptal damgası
                // temizlenmiyor, iptal edilmiş görevler açılmıyor, kayıt Cancelled'da kalıyordu.
                // Sonuç: B2B "montaj eklendi" (success/updated) diyor, ServiceOps'ta HİÇBİR ŞEY
                // görünmüyordu. Kalem ve kaydı gerçekten geri açıyoruz.
                var revived = existingItem.CancelledAt != null;
                if (revived)
                {
                    existingItem.CancelledAt = null;
                    existingItem.CancelReason = null;
                }

                if (existingItem.Service is not null && existingItem.Service.Status == ServiceStatus.Cancelled)
                {
                    // Kayıt yeniden planlanabilir olmalı; sahada gerçekleşmiş satır varsa
                    // Workshop, yoksa baştan planlanacak demektir.
                    var hasFieldWork = await _dbContext.InstallationTasks
                        .AnyAsync(t => t.ServiceId == existingItem.ServiceId
                                       && t.TransferredAt != null
                                       && t.Status != InstallationTaskStatus.Cancelled, cancellationToken);

                    existingItem.Service.Status = hasFieldWork ? ServiceStatus.Workshop : ServiceStatus.New;
                    existingItem.Service.UpdatedAt = now;
                    revived = true;
                }

                if (revived)
                {
                    _dbContext.Activities.Add(new Activity
                    {
                        ServiceId = existingItem.ServiceId,
                        Type = ActivityType.StatusChanged,
                        ActorUserName = "B2B Fatura",
                        Payload = System.Text.Json.JsonSerializer.Serialize(new
                        {
                            field = "ServiceRecordItem.Cancelled",
                            oldValue = "İptal",
                            newValue = "Aktif",
                            reason = $"Fatura kalemi B2B'de yeniden montajlandı: {productName}",
                            metadata = new { itemId = existingItem.Id }
                        }),
                        CreatedAt = now
                    });
                }

                // Adet yalnızca hiç planlanmamışken değişebilir; planlanmış satırlar varsa
                // adedi düşürmek o satırları sahipsiz bırakırdı.
                var plannedQty = await _dbContext.InstallationTasks
                    .Where(t => t.ServiceRecordItemId == existingItem.Id
                                && t.Status != InstallationTaskStatus.Deferred
                                && t.Status != InstallationTaskStatus.Cancelled)
                    .SumAsync(t => t.Quantity, cancellationToken);

                existingItem.Quantity = Math.Max(quantity, plannedQty);

                // Kaydın kendi müşteri bilgisine DOKUNULMAZ: aynı kayıtta başka adreslere ait
                // kalemler olabilir, kayıt düzeyini güncellemek onların adresini de değiştirirdi.
                if (existingItem.Service is not null && existingItem.Service.Status == ServiceStatus.New)
                {
                    existingItem.Service.UpdatedAt = now;
                }

                await SyncDeferredTasksForItemAsync(existingItem, cancellationToken);
                await _dbContext.SaveChangesAsync(cancellationToken);
                await BroadcastAsync("updated", invoiceNo, cancellationToken);

                return Ok(new { success = true, data = new { id = existingItem.ServiceId, itemId = existingItem.Id, mode = "updated" } });
            }
        }

        // 2) Aynı faturanın hâlâ planlamada bekleyen kaydına ekle.
        var target = await FindOpenInvoiceRecordAsync(invoiceNo, cancellationToken);
        if (target is not null)
        {
            var sortOrder = await _dbContext.ServiceRecordItems
                .Where(i => i.ServiceId == target.Id)
                .CountAsync(cancellationToken);

            var item = new ServiceRecordItem
            {
                ServiceId = target.Id,
                ProductName = productName,
                ProductStockCode = stockCode,
                Quantity = quantity,
                Notes = dealerNote,
                ExternalRef = externalRef,
                SortOrder = sortOrder,
                CreatedAt = now,
                UpdatedAt = now
            };
            ApplyCustomerInfo(item, req);

            _dbContext.ServiceRecordItems.Add(item);
            target.UpdatedAt = now;
            // Kayda yeni kalem girdi: fişin yeniden basılması gerekiyor, aksi halde eksik
            // fişle sahaya aktarılabilirdi.
            target.IsPrinted = false;

            await _dbContext.SaveChangesAsync(cancellationToken);
            await BroadcastAsync("updated", invoiceNo, cancellationToken);

            return Ok(new { success = true, data = new { id = target.Id, itemId = item.Id, mode = "merged" } });
        }

        // 3) Yeni kayıt.
        var dto = new ServiceOps.Application.Dtos.CreateServiceRecordDto
        {
            Type = ServiceOps.Domain.Entities.ServiceType.Installation,
            CustomerName = req.CustomerName?.Trim(),
            CustomerPhone = Trimmed(req.Phone),
            CustomerAddress = Trimmed(req.Address),
            ProductName = productName,
            ProductStockCode = stockCode,
            DealerName = Trimmed(req.DealerName) ?? Trimmed(req.DealerCode),
            DealerCode = Trimmed(req.DealerCode),
            InstallationType = "Fatura",
            ProblemDescription = BuildProblemDescription(dealerNote, invoiceNo),
            RegionId = await ResolveRegionIdAsync(req.Region, cancellationToken),
            Priority = ServiceOps.Domain.Entities.PriorityLevel.Normal,
            Items = new List<ServiceOps.Application.Dtos.CreateServiceRecordItemDto>
            {
                new()
                {
                    ProductName = productName,
                    ProductStockCode = stockCode,
                    Quantity = quantity,
                    Notes = dealerNote,
                    ExternalRef = externalRef,
                    // İlk kalemde de doldurulur: kayda sonradan başka adresli kalem eklenince
                    // bunun adresi kayıt düzeyinden okunmaya devam etmesin.
                    CustomerName = Trimmed(req.CustomerName),
                    CustomerPhone = Trimmed(req.Phone),
                    CustomerAddress = Trimmed(req.Address)
                }
            }
        };

        var record = await _serviceRecordService.CreateAsync(dto);
        await BroadcastAsync("created", invoiceNo, cancellationToken);

        return Ok(new { success = true, data = new { id = record.Id, mode = "created" } });
    }

    private static string? Trimmed(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>Fatura izi köşeli parantezle kapatılır: "A0001" araması "A00011"i yakalamasın.</summary>
    private static string InvoiceMarker(string invoiceNo) => $"[Fatura No: {invoiceNo}]";

    private static string BuildProblemDescription(string? dealerNote, string? invoiceNo)
    {
        var note = string.IsNullOrWhiteSpace(dealerNote) ? "Fatura üzerinden otomatik oluşturuldu" : dealerNote;
        return invoiceNo is null ? note : $"{note} {InvoiceMarker(invoiceNo)}".Trim();
    }

    private static string Normalize(string? value)
        => (value ?? string.Empty).Trim().ToLowerInvariant();

    /// <summary>Müşteri/adres KALEME yazılır; aynı kayıtta her kalemin adresi farklı olabilir.</summary>
    private static void ApplyCustomerInfo(ServiceRecordItem item, CreateMontajRequest req)
    {
        item.CustomerName = Trimmed(req.CustomerName);
        item.CustomerPhone = Trimmed(req.Phone);
        item.CustomerAddress = Trimmed(req.Address);
    }

    /// <summary>
    /// Aynı faturanın hâlâ "Yeni Kayıt" aşamasındaki kaydını bulur.
    ///
    /// Kural: **bir fatura = bir montaj kaydı**, her montajlı fatura kalemi o kaydın bir kalemi.
    /// Müşteri adı/adresi eşleşmesi ARANMAZ — aynı faturada farklı son müşterilere montaj olabilir
    /// ve bunlar yine tek kayıtta toplanır; adres kayıt düzeyinde değil kalem düzeyinde
    /// (<see cref="ServiceRecordItem.CustomerAddress"/>) tutulduğu için kaybolmaz.
    ///
    /// Kayıt planlamayı geçtiyse (Status != New) birleştirilmez; o zaman yeni kayıt açılır.
    /// </summary>
    private async Task<ServiceRecord?> FindOpenInvoiceRecordAsync(string? invoiceNo, CancellationToken ct)
    {
        if (invoiceNo is null) return null;

        var marker = InvoiceMarker(invoiceNo);
        return await _dbContext.ServiceRecords
            .Where(s => !s.IsDeleted
                        && s.Type == ServiceType.Installation
                        && s.Status == ServiceStatus.New
                        && s.ProblemDescription != null
                        && s.ProblemDescription.Contains(marker))
            .OrderBy(s => s.CreatedAt)
            .FirstOrDefaultAsync(ct);
    }

    private async Task<Guid?> ResolveRegionIdAsync(string? regionName, CancellationToken ct)
    {
        var name = Trimmed(regionName);
        if (name is null || name == "-") return null;

        var regions = await _dbContext.Regions
            .Where(r => r.IsActive)
            .Select(r => new { r.Id, r.Name })
            .ToListAsync(ct);

        return regions.FirstOrDefault(r => Normalize(r.Name) == Normalize(name))?.Id;
    }

    /// <summary>
    /// Kalemin adedi değiştiğinde bekleyen (Deferred) planlama satırlarını eşitler; planlanmış
    /// satırlara dokunmaz.
    /// </summary>
    private async Task SyncDeferredTasksForItemAsync(ServiceRecordItem item, CancellationToken ct)
    {
        // İptal edilmiş kaleme satır üretilmez; iptal geri alındıysa (kalem yeniden montajlandı)
        // üretilmeli — çağıran o durumda CancelledAt'i zaten temizlemiş oluyor.
        if (item.CancelledAt != null) return;

        var tasks = await _dbContext.InstallationTasks
            .Where(t => t.ServiceRecordItemId == item.Id && t.Status != InstallationTaskStatus.Cancelled)
            .ToListAsync(ct);

        // `tasks.Count == 0` ERKEN ÇIKIŞI KALDIRILDI. Kaldırılıp yeniden eklenen kalemin bütün
        // satırları Cancelled olduğu için buradan hemen dönülüyordu: kalem geri açılıyor ama
        // planlanacak tek bir satırı olmuyordu, yani ekranda hiçbir şey belirmiyordu.
        var deferred = tasks.Where(t => t.Status == InstallationTaskStatus.Deferred).ToList();
        var covered = tasks.Sum(t => t.Quantity);

        if (covered > item.Quantity)
        {
            var excess = covered - item.Quantity;
            foreach (var task in deferred)
            {
                if (excess <= 0) break;
                _dbContext.InstallationTasks.Remove(task);
                excess -= task.Quantity;
            }
            return;
        }

        for (var i = covered; i < item.Quantity; i++)
        {
            _dbContext.InstallationTasks.Add(new InstallationTask
            {
                ServiceId = item.ServiceId,
                ServiceRecordItemId = item.Id,
                Status = InstallationTaskStatus.Deferred,
                Quantity = 1,
                SerialNumber = item.SerialNumber,
                // Kalemin kendi adresi varsa o geçerli; teknisyen kaydın ilk müşterisinin
                // adresine değil, bu kalemin adresine gider.
                CustomAddress = item.CustomerAddress ?? item.Service?.CustomerAddress,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
                // Notes KOPYALANMAZ: item.Notes faturanın TÜM kalemlerine yazılan tek bir bayi
                // açıklamasıdır, kopyalanınca her satır aynı notu gösteriyor ve kalemin kendi
                // notu sanılıyordu. Aynı düzeltme InstallationsController'daki iki üreticide de var.
            });
        }
    }

    private async Task BroadcastAsync(string action, string? invoiceNo, CancellationToken ct)
    {
        await _hub.Clients.All.SendAsync("service_record_updated", new { action, invoiceNo }, ct);
        await _hub.Clients.All.SendAsync("installation_updated", new { action, invoiceNo }, ct);
    }

    [HttpPut("{id:int}/plan")]
    public async Task<ActionResult<object>> Plan(int id, [FromBody] PlanMontajRequest req, CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        if (string.IsNullOrWhiteSpace(req.PlannedDateUtc)) return BadRequest(new { success = false, message = "plannedDateUtc zorunlu" });
        if (string.IsNullOrWhiteSpace(req.Technician)) return BadRequest(new { success = false, message = "technician zorunlu" });

        if (!DateTimeOffset.TryParse(req.PlannedDateUtc, out var planned))
            return BadRequest(new { success = false, message = "plannedDateUtc formatı geçersiz" });

        await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
        await EnsureMontajTablesAsync(conn, cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
UPDATE public.""Installations""
SET ""PlannedDateUtc"" = @PlannedDateUtc,
    ""Technician"" = @Technician,
    ""Status"" = 'Planlandı',
    ""EditUser"" = @EditUser,
    ""EditTime"" = now()
WHERE ""Id"" = @Id;
";
        cmd.Parameters.AddWithValue("PlannedDateUtc", planned);
        cmd.Parameters.AddWithValue("Technician", req.Technician);
        cmd.Parameters.AddWithValue("EditUser", User.FindFirstValue(ClaimTypes.Name) ?? "user");
        cmd.Parameters.AddWithValue("Id", id);

        var affected = await cmd.ExecuteNonQueryAsync(cancellationToken);
        if (affected == 0) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        return Ok(new { success = true });
    }

    [HttpPut("{id:int}/status")]
    public async Task<ActionResult<object>> UpdateStatus(int id, [FromBody] UpdateStatusRequest req, CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var status = (req.Status ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(status)) return BadRequest(new { success = false, message = "status zorunlu" });

        await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
        await EnsureMontajTablesAsync(conn, cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
UPDATE public.""Installations""
SET ""Status"" = @Status,
    ""EditUser"" = @EditUser,
    ""EditTime"" = now()
WHERE ""Id"" = @Id;
";
        cmd.Parameters.AddWithValue("Status", status);
        cmd.Parameters.AddWithValue("EditUser", User.FindFirstValue(ClaimTypes.Name) ?? "user");
        cmd.Parameters.AddWithValue("Id", id);

        var affected = await cmd.ExecuteNonQueryAsync(cancellationToken);
        if (affected == 0) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        return Ok(new { success = true });
    }

    [HttpGet("analytics")]
    public async Task<ActionResult<object>> Analytics(CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
        await EnsureMontajTablesAsync(conn, cancellationToken);

        var totals = new
        {
            total = 0,
            active = 0,
            done = 0,
            cancelled = 0,
            postponed = 0,
            workshop = 0,
            montaj = 0,
            ariza = 0,
            today = 0,
            thisMonth = 0,
            avgPlanLeadDays = 0d,
            completionRate = 0d
        };

        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
SELECT
  COUNT(*) AS ""Total"",
  COUNT(*) FILTER (WHERE ""Status"" NOT IN ('Gerçekleşti','İptal')) AS ""Active"",
  COUNT(*) FILTER (WHERE ""Status"" = 'Gerçekleşti') AS ""Done"",
  COUNT(*) FILTER (WHERE ""Status"" = 'İptal') AS ""Cancelled"",
  COUNT(*) FILTER (WHERE ""Status"" = 'Ertelendi') AS ""Postponed"",
  COUNT(*) FILTER (WHERE ""Status"" IN ('Atölyeye Alındı','Atölye Hazır')) AS ""Workshop"",
  COUNT(*) FILTER (WHERE LOWER(""Type"") LIKE 'm%') AS ""Montaj"",
  COUNT(*) FILTER (WHERE LOWER(""Type"") LIKE 'ar%') AS ""Ariza"",
  COUNT(*) FILTER (WHERE ""CreateTime""::date = (now() at time zone 'utc')::date) AS ""Today"",
  COUNT(*) FILTER (WHERE date_trunc('month', ""CreateTime"") = date_trunc('month', now() at time zone 'utc')) AS ""ThisMonth"",
  COALESCE(AVG(EXTRACT(EPOCH FROM (""PlannedDateUtc"" - ""CreateTime""))/86400.0)
           FILTER (WHERE ""PlannedDateUtc"" IS NOT NULL), 0) AS ""AvgPlanLead""
FROM public.""Installations"";
";
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                var totalCount = Convert.ToInt32(reader["Total"]);
                var doneCount = Convert.ToInt32(reader["Done"]);
                var completion = totalCount > 0 ? Math.Round((doneCount * 100d) / totalCount, 1) : 0d;
                totals = new
                {
                    total = totalCount,
                    active = Convert.ToInt32(reader["Active"]),
                    done = doneCount,
                    cancelled = Convert.ToInt32(reader["Cancelled"]),
                    postponed = Convert.ToInt32(reader["Postponed"]),
                    workshop = Convert.ToInt32(reader["Workshop"]),
                    montaj = Convert.ToInt32(reader["Montaj"]),
                    ariza = Convert.ToInt32(reader["Ariza"]),
                    today = Convert.ToInt32(reader["Today"]),
                    thisMonth = Convert.ToInt32(reader["ThisMonth"]),
                    avgPlanLeadDays = Math.Round(Convert.ToDouble(reader["AvgPlanLead"]), 2),
                    completionRate = completion
                };
            }
        }

        var byStatus = new List<object>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
SELECT ""Status"", COUNT(*) AS ""Count""
FROM public.""Installations""
GROUP BY ""Status""
ORDER BY ""Count"" DESC;
";
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                byStatus.Add(new
                {
                    status = reader.GetString(0),
                    count = Convert.ToInt32(reader.GetInt64(1))
                });
            }
        }

        var byRegion = new List<object>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
SELECT COALESCE(NULLIF(TRIM(""Region""), ''), 'Bölge Yok') AS ""Region"", COUNT(*) AS ""Count""
FROM public.""Installations""
GROUP BY COALESCE(NULLIF(TRIM(""Region""), ''), 'Bölge Yok')
ORDER BY ""Count"" DESC
LIMIT 10;
";
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                byRegion.Add(new
                {
                    region = reader.GetString(0),
                    count = Convert.ToInt32(reader.GetInt64(1))
                });
            }
        }

        var byTechnician = new List<object>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
SELECT COALESCE(NULLIF(TRIM(""Technician""), ''), 'Atanmadı') AS ""Technician"",
       COUNT(*) AS ""Total"",
       COUNT(*) FILTER (WHERE ""Status"" = 'Gerçekleşti') AS ""Done"",
       COUNT(*) FILTER (WHERE ""Status"" NOT IN ('Gerçekleşti','İptal')) AS ""Active""
FROM public.""Installations""
GROUP BY COALESCE(NULLIF(TRIM(""Technician""), ''), 'Atanmadı')
ORDER BY ""Total"" DESC
LIMIT 10;
";
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                byTechnician.Add(new
                {
                    technician = reader.GetString(0),
                    total = Convert.ToInt32(reader.GetInt64(1)),
                    done = Convert.ToInt32(reader.GetInt64(2)),
                    active = Convert.ToInt32(reader.GetInt64(3))
                });
            }
        }

        var monthlyTrend = new List<object>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
WITH months AS (
  SELECT generate_series(
    date_trunc('month', (now() at time zone 'utc')) - interval '5 months',
    date_trunc('month', (now() at time zone 'utc')),
    interval '1 month'
  )::date AS ""Month""
)
SELECT m.""Month"" AS ""Month"",
       COALESCE(COUNT(i.""Id""), 0) AS ""Total"",
       COALESCE(COUNT(i.""Id"") FILTER (WHERE i.""Status"" = 'Gerçekleşti'), 0) AS ""Done""
FROM months m
LEFT JOIN public.""Installations"" i
  ON date_trunc('month', i.""CreateTime"")::date = m.""Month""
GROUP BY m.""Month""
ORDER BY m.""Month"" ASC;
";
            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                monthlyTrend.Add(new
                {
                    month = reader.GetDateTime(0).ToString("yyyy-MM"),
                    total = Convert.ToInt32(reader.GetInt64(1)),
                    done = Convert.ToInt32(reader.GetInt64(2))
                });
            }
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                totals,
                byStatus,
                byRegion,
                byTechnician,
                monthlyTrend
            }
        });
    }

    [HttpGet("{id:int}/documents")]
    public async Task<ActionResult<object>> Documents(int id, CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
        await EnsureMontajTablesAsync(conn, cancellationToken);

        var list = new List<object>();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT ""Id"", ""InstallationId"", ""DocumentUrl"", ""UploadedDateUtc""
FROM public.""InstallationDocuments""
WHERE ""InstallationId"" = @Id
ORDER BY ""UploadedDateUtc"" DESC
LIMIT 200;
";
        cmd.Parameters.AddWithValue("Id", id);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var docId = reader.GetInt32(0);
            list.Add(new
            {
                id = docId,
                installationId = reader.GetInt32(1),
                documentUrl = $"/api/montaj/document/{docId}",
                fileName = TryGetFileName(reader.GetString(2)),
                uploadedDateUtc = reader.GetDateTime(3)
            });
        }

        return Ok(new { success = true, data = list });
    }

    [HttpGet("document/{docId:int}")]
    public async Task<IActionResult> GetDocument(int docId, CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
        await EnsureMontajTablesAsync(conn, cancellationToken);

        string? storedUrl;
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = @"
SELECT ""DocumentUrl""
FROM public.""InstallationDocuments""
WHERE ""Id"" = @Id
LIMIT 1;
";
            cmd.Parameters.AddWithValue("Id", docId);
            var obj = await cmd.ExecuteScalarAsync(cancellationToken);
            storedUrl = obj as string;
        }

        if (string.IsNullOrWhiteSpace(storedUrl))
            return NotFound(new { success = false, message = "Belge bulunamadı" });

        var uploadsRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "uploads"));
        var tenantRoot = Path.GetFullPath(Path.Combine(uploadsRoot, "montaj", tenantCode));

        var relative = storedUrl.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        var absolute = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, relative));

        if (!absolute.StartsWith(tenantRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(absolute, tenantRoot, StringComparison.OrdinalIgnoreCase))
            return Forbid();

        if (!System.IO.File.Exists(absolute))
            return NotFound(new { success = false, message = "Belge dosyası bulunamadı" });

        var provider = new FileExtensionContentTypeProvider();
        if (!provider.TryGetContentType(absolute, out var contentType))
            contentType = "application/octet-stream";

        var stream = System.IO.File.OpenRead(absolute);
        return File(stream, contentType, Path.GetFileName(absolute));
    }

    private static string TryGetFileName(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) return string.Empty;
        var slash = url.LastIndexOf('/');
        return slash >= 0 && slash < url.Length - 1 ? url[(slash + 1)..] : url;
    }

    [HttpPost("{id:int}/document")]
    [RequestSizeLimit(50_000_000)]
    public async Task<ActionResult<object>> UploadDocument(int id, IFormFile file, CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        if (file == null || file.Length <= 0)
            return BadRequest(new { success = false, message = "file zorunlu" });

        var uploadsRoot = Path.Combine(AppContext.BaseDirectory, "uploads", "montaj", tenantCode);
        Directory.CreateDirectory(uploadsRoot);

        var ext = Path.GetExtension(file.FileName);
        if (string.IsNullOrWhiteSpace(ext)) ext = ".bin";

        var safeName = $"{id}_{DateTime.UtcNow:yyyyMMddHHmmssfff}{ext}";
        var absPath = Path.Combine(uploadsRoot, safeName);

        await using (var fs = System.IO.File.Create(absPath))
        {
            await file.CopyToAsync(fs, cancellationToken);
        }

        var urlPath = $"/uploads/montaj/{tenantCode}/{safeName}";

        await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
        await EnsureMontajTablesAsync(conn, cancellationToken);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
INSERT INTO public.""InstallationDocuments""(
  ""InstallationId"", ""DocumentUrl"", ""UploadedDateUtc"", ""CreateUser"", ""CreateTime""
)
VALUES (
  @InstallationId, @DocumentUrl, now(), @CreateUser, now()
);
";
        cmd.Parameters.AddWithValue("InstallationId", id);
        cmd.Parameters.AddWithValue("DocumentUrl", urlPath);
        cmd.Parameters.AddWithValue("CreateUser", User.FindFirstValue(ClaimTypes.Name) ?? "user");

        await cmd.ExecuteNonQueryAsync(cancellationToken);

        return Ok(new { success = true });
    }

    private async Task<List<object>> ReadInstallationsAsync(NpgsqlConnection conn, CancellationToken cancellationToken)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
SELECT
  ""Id"",
  ""DealerCode"",
  ""Type"",
  ""Status"",
  ""DealerName"",
  ""ProductName"",
  ""Quantity"",
  ""InstallationName"" AS ""CustomerName"",
  ""InstallationPhone"" AS ""CustomerPhone"",
  ""Address"",
  ""Region"",
  ""PlannedDateUtc"",
  ""Technician"",
  ""DealerDescription"",
  ""CreateUser"",
  ""CreateTime""
FROM public.""Installations""
ORDER BY ""CreateTime"" DESC
LIMIT 500;
";

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        var list = new List<object>();
        while (await reader.ReadAsync(cancellationToken))
        {
            list.Add(new
            {
                id = reader.GetInt32(reader.GetOrdinal("Id")),
                dealerCode = reader.GetString(reader.GetOrdinal("DealerCode")),
                type = reader.GetString(reader.GetOrdinal("Type")),
                status = reader.GetString(reader.GetOrdinal("Status")),
                dealerName = reader.GetString(reader.GetOrdinal("DealerName")),
                productName = reader.GetString(reader.GetOrdinal("ProductName")),
                quantity = reader.GetDecimal(reader.GetOrdinal("Quantity")),
                customerName = reader.IsDBNull(reader.GetOrdinal("CustomerName")) ? null : reader.GetString(reader.GetOrdinal("CustomerName")),
                customerPhone = reader.IsDBNull(reader.GetOrdinal("CustomerPhone")) ? null : reader.GetString(reader.GetOrdinal("CustomerPhone")),
                address = reader.GetString(reader.GetOrdinal("Address")),
                region = reader.GetString(reader.GetOrdinal("Region")),
                plannedDateUtc = reader.IsDBNull(reader.GetOrdinal("PlannedDateUtc")) ? (DateTime?)null : reader.GetDateTime(reader.GetOrdinal("PlannedDateUtc")),
                technician = reader.IsDBNull(reader.GetOrdinal("Technician")) ? null : reader.GetString(reader.GetOrdinal("Technician")),
                dealerDescription = reader.IsDBNull(reader.GetOrdinal("DealerDescription")) ? null : reader.GetString(reader.GetOrdinal("DealerDescription")),
                createUser = reader.GetString(reader.GetOrdinal("CreateUser")),
                createTime = reader.GetDateTime(reader.GetOrdinal("CreateTime"))
            });
        }

        return list;
    }

    private string GetTenantCode()
    {
        return User?.FindFirst("tenantCode")?.Value
               ?? User?.FindFirst("tenant")?.Value
               ?? Request.Headers["X-Tenant-Code"].FirstOrDefault()
               ?? string.Empty;
    }

    private async Task<NpgsqlConnection> OpenTenantConnectionAsync(string tenantCode, CancellationToken cancellationToken)
    {
        var template = _configuration.GetConnectionString("ServiceOpsBase");
        if (string.IsNullOrWhiteSpace(template))
            throw new InvalidOperationException("ConnectionStrings:ServiceOpsBase bulunamadı");

        var dbName = $"b2b_serviceops_tenant_{NormalizeTenantCode(tenantCode)}";
        var connStr = template.Replace("{DB_NAME}", dbName, StringComparison.Ordinal);

        var conn = new NpgsqlConnection(connStr);
        await conn.OpenAsync(cancellationToken);
        return conn;
    }

    private static string NormalizeTenantCode(string? tenantCode)
    {
        var code = (tenantCode ?? string.Empty).Trim().ToUpperInvariant();
        if (code.Length == 0) return string.Empty;

        var sb = new System.Text.StringBuilder(code.Length);
        foreach (var ch in code)
        {
            if ((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_')
            {
                sb.Append(ch);
            }
            else
            {
                sb.Append('_');
            }
        }

        var normalized = sb.ToString();
        while (normalized.Contains("__", StringComparison.Ordinal)) normalized = normalized.Replace("__", "_", StringComparison.Ordinal);
        normalized = normalized.Trim('_');
        return normalized;
    }

    /// <summary>
    /// Şema garantisi VERİTABANI BAŞINA BİR KEZ.
    ///
    /// Bu metot montaj uçlarının neredeyse hepsinin başında çağrılıyordu; her istek iki
    /// `CREATE TABLE IF NOT EXISTS` çalıştırıyor, yani hiçbir şey değiştirmese bile
    /// PostgreSQL katalog kilidi alıyordu. Nöbetçi bağlantı dizesine göre tutuluyor
    /// (her firmanın kendi veritabanı var); hata hâlinde işaretlenmez, sonraki istek yeniden dener.
    /// </summary>
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, bool> MontajTablesEnsured = new();

    private static async Task EnsureMontajTablesAsync(NpgsqlConnection conn, CancellationToken cancellationToken)
    {
        var ensureKey = conn.ConnectionString ?? "default";
        if (MontajTablesEnsured.ContainsKey(ensureKey)) return;

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
CREATE TABLE IF NOT EXISTS public.""Installations"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""DealerCode"" character varying(50) NOT NULL DEFAULT '',
  ""DealerName"" character varying(200) NOT NULL DEFAULT '',
  ""ProductName"" character varying(400) NOT NULL DEFAULT '',
  ""Quantity"" numeric(18,2) NOT NULL DEFAULT 1,
  ""InstallationName"" character varying(200) NULL,
  ""InstallationPhone"" character varying(50) NULL,
  ""Address"" character varying(2000) NOT NULL DEFAULT '',
  ""Region"" character varying(200) NOT NULL DEFAULT '',
  ""DealerDescription"" character varying(4000) NULL,
  ""Type"" character varying(30) NOT NULL DEFAULT 'Montaj',
  ""Status"" character varying(50) NOT NULL DEFAULT 'Yeni Kayıt',
  ""PlannedDateUtc"" timestamp with time zone NULL,
  ""Technician"" character varying(120) NULL,
  ""CreateUser"" character varying(80) NOT NULL DEFAULT '',
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(80) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_Installations"" PRIMARY KEY (""Id"")
);

CREATE INDEX IF NOT EXISTS ""IX_Installations_CreateTime"" ON public.""Installations"" (""CreateTime"" DESC);
CREATE INDEX IF NOT EXISTS ""IX_Installations_DealerCode"" ON public.""Installations"" (""DealerCode"");
CREATE INDEX IF NOT EXISTS ""IX_Installations_Status"" ON public.""Installations"" (""Status"");
CREATE INDEX IF NOT EXISTS ""IX_Installations_Region"" ON public.""Installations"" (""Region"");
CREATE INDEX IF NOT EXISTS ""IX_Installations_Technician"" ON public.""Installations"" (""Technician"");
CREATE INDEX IF NOT EXISTS ""IX_Installations_Type"" ON public.""Installations"" (""Type"");
CREATE INDEX IF NOT EXISTS ""IX_Installations_PlannedDateUtc"" ON public.""Installations"" (""PlannedDateUtc"");

CREATE TABLE IF NOT EXISTS public.""InstallationDocuments"" (
  ""Id"" integer GENERATED BY DEFAULT AS IDENTITY,
  ""InstallationId"" integer NOT NULL,
  ""DocumentUrl"" character varying(2000) NOT NULL,
  ""UploadedDateUtc"" timestamp with time zone NOT NULL,
  ""CreateUser"" character varying(80) NOT NULL DEFAULT '',
  ""CreateTime"" timestamp with time zone NOT NULL,
  ""EditUser"" character varying(80) NULL,
  ""EditTime"" timestamp with time zone NULL,
  CONSTRAINT ""PK_InstallationDocuments"" PRIMARY KEY (""Id""),
  CONSTRAINT ""FK_InstallationDocuments_Installations"" FOREIGN KEY (""InstallationId"") REFERENCES public.""Installations""(""Id"") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ""IX_InstallationDocuments_InstallationId"" ON public.""InstallationDocuments"" (""InstallationId"");
";
        await cmd.ExecuteNonQueryAsync(cancellationToken);

        MontajTablesEnsured[ensureKey] = true;
    }

    // Fatura iptalinde B2B webhook'u çağırır. Eskiden [AllowAnonymous] idi: ağdan erişebilen
    // HERKES fatura numarasını yazıp o faturanın montaj kayıtlarını SİLEBİLİYORDU.
    /// <summary>
    /// Faturanın NUMARASI değiştiğinde montaj kayıtlarındaki izi yeniler.
    ///
    /// B2B'de "Üst Bilgi Güncelle" ile fatura no değiştirilebiliyor (fatura iptal edilip yeni
    /// numarayla yazıldığında yapılan şey bu). Montaj tarafı fatura numarasını bir KOLONDA
    /// tutmuyor; iz, kaydın açıklamasına `[Fatura No: X]` olarak yazılıyor ve Montaj Planlama
    /// listesindeki "Fatura No" sütunu oradan okunuyor. Numara değişince bu iz eski numarada
    /// kalıyor, ekranda artık var olmayan bir faturaya işaret ediyordu.
    ///
    /// Eşleşme silme ucuyla AYNI kuralı kullanır: iz köşeli parantezle kapalı aranır, böylece
    /// "A0001" araması "A00011"i yakalamaz. Parantezten önce yazılmış eski kayıtlar için satır
    /// sonu / metin sonu biçimleri de karşılanıyor.
    ///
    /// Eşleşme yoksa hata değil: her faturanın montajı olmak zorunda değil.
    /// </summary>
    [HttpPut("invoice/{invoiceNo}/renumber")]
    [ServiceOps.Api.Filters.InternalApiKeyOrUser]
    public async Task<ActionResult<object>> RenumberInvoice(
        string invoiceNo,
        [FromBody] RenumberInvoiceRequest request,
        CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var oldNo = Trimmed(invoiceNo);
        if (string.Equals(oldNo, "none", StringComparison.OrdinalIgnoreCase)) oldNo = null;
        var newNo = Trimmed(request?.NewInvoiceNo);
        if (newNo is null)
        {
            return BadRequest(new { success = false, message = "Yeni fatura no zorunlu." });
        }

        var externalRefs = request?.ExternalRefs?
            .Where(r => !string.IsNullOrWhiteSpace(r))
            .Select(r => r.Trim())
            .Distinct()
            .ToList() ?? new List<string>();

        // Cari kodu ALT HESAP EKİYLE gelebilir (120-01-000544-1). Montaj kaydı ana cariyi
        // tutar; ek atılmazsa bayi listesi kodu tanımaz ([[cari-alt-hesap-kurali]]).
        var dealerCode = Trimmed(request?.DealerCode);
        if (dealerCode is not null)
        {
            dealerCode = System.Text.RegularExpressions.Regex.Replace(dealerCode, @"-[123]$", string.Empty);
        }
        var dealerName = Trimmed(request?.DealerName);

        var oldMarker = !string.IsNullOrWhiteSpace(oldNo) ? InvoiceMarker(oldNo) : null;
        var newMarker = InvoiceMarker(newNo);

        List<Guid> serviceIdsFromRefs = new();
        if (externalRefs.Count > 0)
        {
            serviceIdsFromRefs = await _dbContext.ServiceRecordItems
                .AsNoTracking()
                .Where(x => externalRefs.Contains(x.ExternalRef))
                .Select(x => x.ServiceId)
                .Distinct()
                .ToListAsync(cancellationToken);
        }

        var records = await _dbContext.ServiceRecords
            .Where(x => (serviceIdsFromRefs.Count > 0 && serviceIdsFromRefs.Contains(x.Id))
                        || (oldMarker != null && x.ProblemDescription != null
                            && (x.ProblemDescription.Contains(oldMarker)
                                || x.ProblemDescription.Contains($"Fatura No: {oldNo}\n")
                                || x.ProblemDescription.EndsWith($"Fatura No: {oldNo}"))))
            .ToListAsync(cancellationToken);

        var now = DateTime.UtcNow;
        var updated = 0;

        foreach (var record in records)
        {
            var text = record.ProblemDescription ?? string.Empty;
            string next;

            if (oldMarker != null && text.Contains(oldMarker, StringComparison.Ordinal))
            {
                next = text.Replace(oldMarker, newMarker, StringComparison.Ordinal);
            }
            else if (oldMarker != null && text.Contains($"Fatura No: {oldNo}", StringComparison.Ordinal))
            {
                next = text.Replace($"Fatura No: {oldNo}", newMarker, StringComparison.Ordinal);
            }
            else if (System.Text.RegularExpressions.Regex.IsMatch(text, @"\[Fatura No:\s*[^\]]+\]"))
            {
                next = System.Text.RegularExpressions.Regex.Replace(text, @"\[Fatura No:\s*[^\]]+\]", newMarker);
            }
            else
            {
                next = string.IsNullOrWhiteSpace(text) ? newMarker : $"{text} {newMarker}".Trim();
            }

            /*
              FATURA NO ve BAYİ AYRI AYRI DEĞERLENDİRİLİR (2026-09-03).

              Önceden burada "açıklama değişmediyse `continue`" vardı. Fatura numarası aynı
              kalıp yalnızca cari değiştiğinde — ki üst bilgi güncellemesinin en sık hâli
              budur — kayıt atlanıyor ve bayi eski cariye bağlı kalıyordu.
            */
            var degisti = false;

            if (!string.Equals(next, text, StringComparison.Ordinal))
            {
                record.ProblemDescription = next;
                degisti = true;

                _dbContext.Activities.Add(new Activity
                {
                    ServiceId = record.Id,
                    Type = ActivityType.StatusChanged,
                    Payload = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        field = "InvoiceNo",
                        oldValue = oldNo,
                        newValue = newNo,
                        reason = $"Fatura numarası {oldNo ?? "-"} → {newNo} olarak güncellendi (satış faturası üst bilgi güncellemesi).",
                        metadata = new { serviceId = record.Id }
                    }),
                    CreatedAt = now
                });
            }

            // BAYİ: yalnız ERP gönderdiyse ve gerçekten değiştiyse yazılır.
            // Ad boş gelirse koda düşülür - kayıt oluşturma yolundaki kuralın aynısı.
            if (!string.IsNullOrWhiteSpace(dealerCode)
                && !string.Equals(record.DealerCode, dealerCode, StringComparison.Ordinal))
            {
                var eskiKod = record.DealerCode;
                var eskiAd = record.DealerName;

                record.DealerCode = dealerCode;
                record.DealerName = string.IsNullOrWhiteSpace(dealerName) ? dealerCode : dealerName;
                degisti = true;

                _dbContext.Activities.Add(new Activity
                {
                    ServiceId = record.Id,
                    Type = ActivityType.StatusChanged,
                    Payload = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        field = "Dealer",
                        oldValue = $"{eskiKod} {eskiAd}".Trim(),
                        newValue = $"{record.DealerCode} {record.DealerName}".Trim(),
                        reason = $"Bayi {eskiAd ?? eskiKod ?? "-"} → {record.DealerName} olarak güncellendi (satış faturası üst bilgi güncellemesi).",
                        metadata = new { serviceId = record.Id }
                    }),
                    CreatedAt = now
                });
            }

            if (!degisti) continue;

            record.UpdatedAt = now;
            updated++;
        }

        if (updated > 0)
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
            await BroadcastAsync("updated", newNo, cancellationToken);
        }

        return Ok(new { success = true, updatedCount = updated });
    }

    /// <summary>
    /// Satış faturası üst bilgisi güncellenince ERP'nin gönderdiği senkron paketi.
    ///
    /// <para>
    /// <c>DealerCode</c> / <c>DealerName</c> 2026-09-03'te eklendi: fatura üst bilgisinden
    /// cari değiştirildiğinde montaj kaydı ESKİ bayide kalıyordu. Fatura no izi güncelleniyor
    /// ama bayi güncellenmiyordu — kayıt oluşturulurken yazılıp bir daha hiç dokunulmuyordu.
    /// İkisi de isteğe bağlı: gönderilmezse bayi alanına dokunulmaz.
    /// </para>
    /// </summary>
    public sealed record RenumberInvoiceRequest(
        string? NewInvoiceNo,
        List<string>? ExternalRefs = null,
        string? DealerCode = null,
        string? DealerName = null);

    [HttpDelete("invoice/{invoiceNo}")]
    [ServiceOps.Api.Filters.InternalApiKeyOrUser]
    public async Task<ActionResult<object>> DeleteByInvoiceNo(string invoiceNo, CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            // 1. Bu faturaya ait montaj kayıtları. İz köşeli parantezle kapalı arandığı için
            //    "A0001" araması "A00011" faturasının montajını silmez.
            var searchPattern = InvoiceMarker(invoiceNo);
            var records = await _dbContext.ServiceRecords
                .Where(x => x.ProblemDescription != null
                            && (x.ProblemDescription.Contains(searchPattern)
                                || x.ProblemDescription.Contains($"Fatura No: {invoiceNo}\n")
                                || x.ProblemDescription.EndsWith($"Fatura No: {invoiceNo}")))
                .ToListAsync(cancellationToken);

            var keptCompleted = 0;
            if (records.Any())
            {
                var now = DateTime.UtcNow;
                var serviceIds = records.Select(r => r.Id).ToList();

                var tasksToCancel = await _dbContext.InstallationTasks
                    .Where(t => serviceIds.Contains(t.ServiceId) && t.Status != InstallationTaskStatus.Cancelled)
                    .ToListAsync(cancellationToken);

                // YAPILMIŞ İŞ İPTALE ÇEKİLMEZ — bkz. DeleteByExternalRef'teki aynı gerekçe.
                var completed = tasksToCancel.Where(t => t.Status == InstallationTaskStatus.Completed).ToList();
                keptCompleted = completed.Count;

                foreach (var task in tasksToCancel.Where(t => t.Status != InstallationTaskStatus.Completed))
                {
                    task.Status = InstallationTaskStatus.Cancelled;
                    task.UpdatedAt = now;

                    _dbContext.Activities.Add(new Activity
                    {
                        ServiceId = task.ServiceId,
                        Type = ActivityType.StatusChanged,
                        ActorUserName = "B2B Fatura",
                        Payload = System.Text.Json.JsonSerializer.Serialize(new
                        {
                            field = $"InstallationTask.{task.Id}.Status",
                            oldValue = task.Status.ToTurkishString(),
                            newValue = InstallationTaskStatus.Cancelled.ToTurkishString(),
                            reason = $"İptal Nedeni: {invoiceNo} numaralı fatura iptal edildi.",
                            metadata = new { taskId = task.Id }
                        }),
                        CreatedAt = now
                    });
                }

                // KALEM DAMGASI: damgasız kalan kalemler EnsureDeferredTasksForItemsAsync
                // tarafından yeni "Yeni Kayıt" satırlarıyla diriltiliyordu.
                var invoiceItems = await _dbContext.ServiceRecordItems
                    .Where(i => serviceIds.Contains(i.ServiceId) && i.CancelledAt == null)
                    .ToListAsync(cancellationToken);
                foreach (var item in invoiceItems)
                {
                    item.CancelledAt = now;
                    item.CancelReason = $"{invoiceNo} numaralı fatura iptal edildi.";
                    item.UpdatedAt = now;
                }

                foreach (var record in records)
                {
                    record.Status = ServiceStatus.Cancelled;
                    record.UpdatedAt = now;
                }

                await _dbContext.SaveChangesAsync(cancellationToken);
            }

            // 2. Delete legacy installations in the tenant database
            await using var conn = await OpenTenantConnectionAsync(tenantCode, cancellationToken);
            await EnsureMontajTablesAsync(conn, cancellationToken);

            await using var cmd = conn.CreateCommand();
            // Fatura izi KÖŞELİ PARANTEZLE kapatılmış aranır. Bu sorgu `%Fatura No: A0001%`
            // kullanıyordu ve A0001 aramasıyla A00011'in kayıtlarını da siliyordu — üstteki
            // ServiceRecords sorgusu bunu InvoiceMarker() ile zaten yapıyordu, legacy tarafı
            // eski hâlinde kalmıştı.
            cmd.CommandText = @"
DELETE FROM public.""Installations""
WHERE ""DealerDescription"" LIKE @exact
   OR ""DealerDescription"" LIKE @suffix;
";
            cmd.Parameters.AddWithValue("exact", $"%{InvoiceMarker(invoiceNo)}%");
            // Köşeli parantezten önce yazılmış eski kayıtlar: iz satır sonunda ya da metnin sonunda.
            cmd.Parameters.AddWithValue("suffix", $"%Fatura No: {invoiceNo}");
            var affectedLegacy = await cmd.ExecuteNonQueryAsync(cancellationToken);

            await transaction.CommitAsync(cancellationToken);

            // 3. Broadcast SignalR events so web and mobile apps update instantly
            await _hub.Clients.All.SendAsync("service_record_updated", new { action = "updated", invoiceNo = invoiceNo }, cancellationToken);
            await _hub.Clients.All.SendAsync("installation_updated", new { action = "updated", invoiceNo = invoiceNo }, cancellationToken);

            return Ok(new { success = true, cancelledCount = records.Count, deletedLegacyCount = affectedLegacy, keptCompletedTaskCount = keptCompleted });
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync(cancellationToken);
            return StatusCode(500, new { success = false, message = "Montaj kayıtları silinirken hata oluştu: " + ex.Message });
        }
    }

    /// <summary>
    /// Tek bir fatura montajını (B2B Installation kaydını) düşürür.
    ///
    /// Eskiden bu iş "fatura no + ÜRÜN ADI" ile yapılıyordu: aynı faturada aynı üründen iki
    /// montaj varsa ikisini birden siliyor, ürün adı ERP'de değiştiyse hiçbirini bulamıyordu.
    /// Artık kalemin dış kimliği üzerinden gidiliyor.
    /// </summary>
    [HttpDelete("external/{externalRef}")]
    [ServiceOps.Api.Filters.InternalApiKeyOrUser]
    public async Task<ActionResult<object>> DeleteByExternalRef(string externalRef, CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });

        var reference = Trimmed(externalRef);
        if (reference is null) return BadRequest(new { success = false, message = "externalRef zorunlu" });

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            var items = await _dbContext.ServiceRecordItems
                .Where(i => i.ExternalRef == reference)
                .ToListAsync(cancellationToken);

            if (items.Count == 0)
            {
                await transaction.CommitAsync(cancellationToken);
                return Ok(new { success = true, cancelledItemCount = 0, cancelledRecordCount = 0 });
            }

            // İPTAL KALEM SEVİYESİNDE. Bu uç kalemi ExternalRef ile buluyor, sonra o kalemin
            // ServiceId'sini alıp KAYDIN TAMAMINI ve bütün görevlerini iptale çekiyordu: B2B'de
            // 4 kalemlik bir faturanın tek satırının montajı kaldırılınca diğer 3 kalem de
            // iptal oluyordu. "Bir fatura = bir montaj kaydı, iptal kalem bazlı" kuralının
            // tam tersi (bkz. MONTAJ-DEVIR §6).
            var now = DateTime.UtcNow;
            var itemIds = items.Select(i => i.Id).ToList();
            var serviceIds = items.Select(i => i.ServiceId).Distinct().ToList();

            var tasksToCancel = await _dbContext.InstallationTasks
                .Where(t => t.ServiceRecordItemId != null
                            && itemIds.Contains(t.ServiceRecordItemId.Value)
                            && t.Status != InstallationTaskStatus.Cancelled)
                .ToListAsync(cancellationToken);

            // YAPILMIŞ İŞ İPTALE ÇEKİLMEZ. Eskiden Completed satırlar da iptal ediliyordu:
            // gerçekten monte edilmiş ürün "iptal" görünüyor, hak edişi ortada kalıyor, iptal
            // analizi raporu şişiyordu. Fatura düşse de sahada olan olmuştur; gerçekleşen satır
            // olduğu gibi kalır ve yanıtta B2B'ye bildirilir.
            var completed = tasksToCancel.Where(t => t.Status == InstallationTaskStatus.Completed).ToList();
            var cancellable = tasksToCancel.Where(t => t.Status != InstallationTaskStatus.Completed).ToList();

            foreach (var task in cancellable)
            {
                task.Status = InstallationTaskStatus.Cancelled;
                task.UpdatedAt = now;
            }

            // KALEM DAMGASI ŞART. Damgasız kalan kalemi EnsureDeferredTasksForItemsAsync eksik
            // adet sanıp yeni "Yeni Kayıt" satırlarıyla diriltiyor (MONTAJ-DEVIR §6).
            var cancelReason = completed.Count > 0
                ? $"Fatura kalemi B2B'de kaldırıldı. {completed.Count} adet zaten gerçekleşmişti, o satırlar korundu."
                : "Fatura kalemi B2B'de kaldırıldı.";

            foreach (var item in items.Where(i => i.CancelledAt == null))
            {
                item.CancelledAt = now;
                item.CancelReason = cancelReason;
                item.UpdatedAt = now;
            }

            // Kayıt ancak SON yaşayan kalemi de düştüyse iptale gider.
            var records = await _dbContext.ServiceRecords
                .Where(r => serviceIds.Contains(r.Id))
                .ToListAsync(cancellationToken);

            var siblingItems = await _dbContext.ServiceRecordItems
                .Where(i => serviceIds.Contains(i.ServiceId))
                .Select(i => new { i.ServiceId, i.Id, i.CancelledAt })
                .ToListAsync(cancellationToken);

            var cancelledRecordCount = 0;
            foreach (var record in records)
            {
                var siblings = siblingItems.Where(i => i.ServiceId == record.Id).ToList();
                var allCancelled = siblings.Count > 0
                    && siblings.All(i => i.CancelledAt != null || itemIds.Contains(i.Id));

                if (!allCancelled) { record.UpdatedAt = now; continue; }

                record.Status = ServiceStatus.Cancelled;
                record.UpdatedAt = now;
                cancelledRecordCount++;
            }

            // Her iptal edilen SATIR için ayrı Activity: geçmiş modalı olayları metadata.taskId
            // ile süzüyor, tek kayıt seviyesi olay yazılırsa sebep hiçbir satırın altında görünmez.
            foreach (var task in cancellable)
            {
                _dbContext.Activities.Add(new Activity
                {
                    ServiceId = task.ServiceId,
                    Type = ActivityType.StatusChanged,
                    ActorUserName = "B2B Fatura",
                    Payload = System.Text.Json.JsonSerializer.Serialize(new
                    {
                        field = $"InstallationTask.{task.Id}.Status",
                        oldValue = InstallationTaskStatus.Planned.ToTurkishString(),
                        newValue = InstallationTaskStatus.Cancelled.ToTurkishString(),
                        reason = $"İptal Nedeni: {cancelReason}",
                        metadata = new { taskId = task.Id }
                    }),
                    CreatedAt = now
                });
            }

            await _dbContext.SaveChangesAsync(cancellationToken);

            await transaction.CommitAsync(cancellationToken);

            await BroadcastAsync("updated", null, cancellationToken);

            return Ok(new
            {
                success = true,
                cancelledItemCount = items.Count,
                cancelledRecordCount,
                cancelledTaskCount = cancellable.Count,
                // B2B bunu kullanıcıya göstermeli: fatura kalemi kaldırıldı ama montajın bir
                // kısmı fiilen yapılmış.
                keptCompletedTaskCount = completed.Count
            });
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync(cancellationToken);
            return StatusCode(500, new { success = false, message = "Montaj kaydı silinirken hata oluştu: " + ex.Message });
        }
    }
}

