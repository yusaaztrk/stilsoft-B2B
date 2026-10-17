using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
using ServiceOps.Application.Dtos;
using ServiceOps.Application.Interfaces;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Microsoft.Extensions.Configuration;
using ServiceOps.Api.Services;

namespace ServiceOps.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class TechniciansController : ControllerBase
{
    private readonly ITechnicianService _service;
    private readonly ApplicationDbContext _context;
    private readonly IConfiguration _configuration;
    private readonly IServiceOpsPermissionService _permissions;

    public TechniciansController(ITechnicianService service, ApplicationDbContext context, IConfiguration configuration, IServiceOpsPermissionService permissions)
    {
        _service = service;
        _context = context;
        _configuration = configuration;
        _permissions = permissions;
    }

    /// <summary>
    /// Çağıran teknisyenin kendisi mi?
    ///
    /// Burası `return false;` diye SABİT bir taslaktı — yani bu controller'daki bütün teknisyen
    /// kontrolleri (silme, güncelleme, "müsait teknisyenler", başkasının kartını okuma ve
    /// listeyi kendine daraltma) hiçbir zaman devreye girmiyordu. Tek kaynak
    /// <see cref="IServiceOpsPermissionService.IsTechnicianUser"/>: rol "Technician" ise ya da
    /// oturumda technicianId claim'i varsa doğru, süper admin için ise her zaman yanlış döner.
    /// </summary>
    private bool IsTechnicianUser()
    {
        return _permissions.IsTechnicianUser(User);
    }

    private Guid? CurrentTechnicianId()
    {
        var claimValue = User.FindFirstValue("technicianId");
        return Guid.TryParse(claimValue, out var id) ? id : null;
    }

    /// <summary>
    /// Sahanın saat farkı (KKTC/Türkiye = UTC+3). Zaman damgaları UTC saklanıyor; "bugün",
    /// "bu ay" gibi GÜN sınırı çeken her hesap yerel saate göre yapılmalı, yoksa gece yarısı
    /// ile 03:00 arasında rapor bir gün geride kalır. Aynı sabit
    /// <see cref="Services.ApproachingJobsNotificationService"/> içinde de kullanılıyor.
    /// </summary>
    private const int LocalOffsetHours = 3;

    private static DateTime LocalNow() => DateTime.UtcNow.AddHours(LocalOffsetHours);

    /// <summary>
    /// Bir zaman damgasının SAHADAKİ günü. Kayıtlar UTC geldiği için önce yerel saate çevrilir,
    /// sonra gün kırpılır. Sayaç ve takvim uç noktaları bu tek fonksiyonu kullanır — iki ekranın
    /// aynı işi farklı güne yazması böyle engelleniyor.
    /// </summary>
    private static DateTime LocalDay(DateTime stamp)
        => DateTime.SpecifyKind(stamp.ToUniversalTime().AddHours(LocalOffsetHours).Date, DateTimeKind.Unspecified);

    private string GetTenantCode()
    {
        // Jeton firma kodunu iki yazımla taşıyabiliyor; yalnız küçük harfli biçim arandığında
        // ve başlık da yokken metot boş dönüyordu (bkz. SparePartsController'daki aynı düzeltme).
        return User?.FindFirst("TenantCode")?.Value
               ?? User?.FindFirst("tenantCode")?.Value
               ?? User?.FindFirst("tenant")?.Value
               ?? Request.Headers["X-Tenant-Code"].FirstOrDefault()
               ?? string.Empty;
    }

    private async Task<string?> GetB2BConnectionStringAsync(CancellationToken cancellationToken)
    {
        var tenantCode = GetTenantCode();
        if (string.IsNullOrWhiteSpace(tenantCode)) return null;

        var baseConn = _configuration.GetConnectionString("DefaultConnection") 
                       ?? _configuration.GetConnectionString("ServiceOpsBase");
        if (string.IsNullOrWhiteSpace(baseConn)) return null;

        try
        {
            var masterBuilder = new NpgsqlConnectionStringBuilder(baseConn) { Database = "b2b_erp_master" };
            string? dbName = null;
            await using (var master = new NpgsqlConnection(masterBuilder.ConnectionString))
            {
                await master.OpenAsync(cancellationToken);
                await using var cmd = new NpgsqlCommand("SELECT \"DbName\" FROM public.\"Tenants\" WHERE LOWER(\"Code\") = @tenantCode LIMIT 1", master);
                cmd.Parameters.AddWithValue("tenantCode", tenantCode.Trim().ToLowerInvariant());
                dbName = await cmd.ExecuteScalarAsync(cancellationToken) as string;
            }

            var tenantBuilder = new NpgsqlConnectionStringBuilder(baseConn)
            {
                Database = string.IsNullOrWhiteSpace(dbName) ? "b2b_erp" : dbName
            };
            return tenantBuilder.ConnectionString;
        }
        catch
        {
            var fallback = new NpgsqlConnectionStringBuilder(baseConn) { Database = "b2b_erp" };
            return fallback.ConnectionString;
        }
    }

    private async Task<List<int>> GetAssignedWarehouseCodesAsync(CancellationToken cancellationToken)
    {
        var list = new List<int>();
        var userRole = User.FindFirstValue(ClaimTypes.Role) ?? User.FindFirstValue("role") ?? "";
        
        var isTech = string.Equals(userRole, "Technician", StringComparison.OrdinalIgnoreCase);
        if (isTech)
        {
            var techId = CurrentTechnicianId();
            if (techId.HasValue)
            {
                var tech = await _context.Technicians
                    .AsNoTracking()
                    .FirstOrDefaultAsync(t => t.Id == techId.Value && t.IsActive, cancellationToken);
                if (tech != null && tech.WarehouseCode.HasValue && tech.WarehouseCode.Value > 0)
                {
                    list.Add(tech.WarehouseCode.Value);
                    return list;
                }
            }
        }

        var username = User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name ?? "";
        if (string.IsNullOrWhiteSpace(username)) return list;

        var connStr = await GetB2BConnectionStringAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(connStr)) return list;

        try
        {
            await using (var conn = new NpgsqlConnection(connStr))
            {
                await conn.OpenAsync(cancellationToken);
                var sql = @"
                    SELECT uw.""WarehouseCode"" 
                    FROM public.""UserWarehouses"" uw
                    JOIN public.""Users"" u ON uw.""UserId"" = u.""Id""
                    WHERE LOWER(u.""Username"") = @username AND u.""IsActive"" = true
                    
                    UNION
                    
                    SELECT u.""DefaultWarehouseCode""
                    FROM public.""Users"" u
                    WHERE LOWER(u.""Username"") = @username AND u.""IsActive"" = true AND u.""DefaultWarehouseCode"" IS NOT NULL";
                
                await using var cmd = new NpgsqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("username", username.Trim().ToLowerInvariant());
                await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    list.Add(reader.GetInt32(0));
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[Technicians] Failed to fetch UserWarehouses: {ex.Message}");
        }

        return list;
    }

    /// <summary>
    /// Genel teknisyen listesi — montaj/arıza/kargo planlamasında "kime atansın" sorusunun
    /// TEK kaynağı. Depo yetkisiyle SINIRLANMAZ: depo, Araç Depoları sayfasının kendi ekseni
    /// (kullanıcının hangi depoları görebildiği), teknisyene iş atanıp atanamayacağıyla ilgisiz.
    ///
    /// Bir ara burada depo yetkisi olmayan (çoğu Admin/User — depo ataması saha personeline
    /// değil, deposu olan kullanıcıya yapılır) her rol için listeyi boşa düşüren bir kısıtlama
    /// vardı; montaj planlaması dahil teknisyen seçilen HER ekranı kırıyordu. Araç Depoları
    /// sayfasının gerçek sorunu bu değildi (MONTAJ-DEVIR.md §2.2: hiçbir teknisyende
    /// WarehouseCode yok, süzgeç veriye değil yetkiye bakıyordu) — o sayfa kendi ekseninde,
    /// ayrı bir uçla çözülmeli; bu genel liste hepsi için ortak kalmalı.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<List<TechnicianDto>>> GetAll([FromQuery] TechnicianStatus? status, [FromQuery] string? role = null)
    {
        var userRole = User.FindFirstValue(ClaimTypes.Role) ?? User.FindFirstValue("role") ?? "";
        var tenantCode = GetTenantCode();
        var technicianId = CurrentTechnicianId();

        var technicians = await _service.GetAllAsync(status, role);

        // "Tüm tenant'ları gör" yalnızca claim'e dayalı gerçek süper admin için — rol adı
        // "SuperAdmin" stringi tek başına artık yeterli değil.
        if (_permissions.IsSuperAdmin(User))
        {
            return Ok(technicians);
        }

        // Teknisyen yalnızca kendini görür.
        if (IsTechnicianUser())
        {
            return Ok(technicians.Where(t => t.Id == technicianId).ToList());
        }

        // GERİ KALAN HERKES firmanın teknisyen listesini görür.
        //
        // Burada eskiden bir ROL ADI BEYAZ LİSTESİ vardı (`Admin` / `User`) ve listede olmayan
        // her rol sessizce BOŞ liste alıyordu. Rol adı bu kararın dayanağı olamaz, çünkü aynı
        // kullanıcı iki farklı yoldan girdiğinde iki farklı ad taşıyor:
        //   - Doğrudan ServiceOps girişi  → role claim'i "Admin"
        //   - B2B'den devir (SSO)         → role claim'i B2B'deki rol kodu ("Mudur", "ServisMudur"…)
        // Sonuç: bayiden geçen bir müdüre montaj planlamada teknisyen listesi hiç gelmiyordu,
        // hata da vermiyordu — açılır liste boştu.
        //
        // Bu uç, teknisyen seçilen HER ekranın tek kaynağı; doğru soru "hangi rol adı" değil,
        // "bu kullanıcı teknisyenin kendisi mi, yoksa iş atayan taraf mı". Firma sınırı aşağıda
        // ayrıca uygulanıyor, yani liste yine kullanıcının firmasıyla sınırlı.
        if (!string.IsNullOrWhiteSpace(tenantCode))
        {
            // Firması boş olan eski kayıtlar da dahil — aksi halde tenant kolonu eklenmeden
            // önce açılmış teknisyenler hiçbir listede görünmezdi.
            var filtered = technicians.Where(t =>
                string.IsNullOrWhiteSpace(t.TenantCode) ||
                string.Equals(t.TenantCode, tenantCode, StringComparison.OrdinalIgnoreCase)
            ).ToList();
            return Ok(filtered);
        }

        return Ok(technicians);
    }


    [HttpGet("available")]
    public async Task<ActionResult<List<TechnicianDto>>> GetAvailable([FromQuery] DateTime? date = null)
    {
        if (IsTechnicianUser()) return Forbid();
        var technicians = await _service.GetAvailableAsync(date);
        return Ok(technicians);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<TechnicianDto>> GetById(Guid id)
    {
        if (IsTechnicianUser() && CurrentTechnicianId() != id) return Forbid();
        var tech = await _service.GetByIdAsync(id);
        if (tech == null) return NotFound();

        var role = User.FindFirstValue(ClaimTypes.Role) ?? User.FindFirstValue("role") ?? "";
        var tenantCode = User.FindFirstValue("tenantCode") ?? User.FindFirstValue("tenant") ?? "";
        if (!_permissions.IsSuperAdmin(User))
        {
            if (string.Equals(role, "Admin", StringComparison.OrdinalIgnoreCase) && !string.Equals(tech.TenantCode, tenantCode, StringComparison.OrdinalIgnoreCase))
            {
                return Forbid();
            }
        }

        return Ok(tech);
    }

    [HttpPost]
    public async Task<ActionResult<TechnicianDto>> Create(CreateTechnicianDto dto)
    {
        if (IsTechnicianUser()) return Forbid();
        var tenantCode = User.FindFirstValue("tenantCode") ?? User.FindFirstValue("tenant") ?? "";
        dto.TenantCode = tenantCode;
        var tech = await _service.CreateAsync(dto);
        return CreatedAtAction(nameof(GetById), new { id = tech.Id }, tech);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<TechnicianDto>> Update(Guid id, CreateTechnicianDto dto)
    {
        if (IsTechnicianUser()) return Forbid();
        var tech = await _service.UpdateAsync(id, dto);
        if (tech == null) return NotFound();
        return Ok(tech);
    }

    // PUT {id}/password KALDIRILDI. ServiceOps artık şifre tutmuyor; bu uç çağrıldığında
    // ServiceOps'taki kopyayı güncelliyor, B2B'deki gerçek şifre eski kalıyordu. Şifre
    // değiştirme tek yerden: B2B `ServiceOpsTechniciansController.UpdatePassword`.

    [HttpPatch("{id:guid}/status")]
    public async Task<ActionResult<TechnicianDto>> UpdateStatus(Guid id, [FromBody] UpdateTechnicianStatusRequest request)
    {
        if (IsTechnicianUser() && CurrentTechnicianId() != id) return Forbid();
        var tech = await _service.UpdateStatusAsync(id, request.Status);
        if (tech == null) return NotFound();
        return Ok(tech);
    }

    [HttpPatch("{id:guid}/online")]
    public async Task<ActionResult<TechnicianDto>> UpdateOnlineStatus(Guid id, [FromBody] UpdateTechnicianOnlineRequest request)
    {
        if (IsTechnicianUser() && CurrentTechnicianId() != id) return Forbid();
        var tech = await _service.UpdateOnlineStatusAsync(id, request.IsOnline);
        if (tech == null) return NotFound();
        return Ok(tech);
    }

    [HttpPost("{id:guid}/location")]
    public async Task<ActionResult<TechnicianDto>> UpdateLocation(Guid id, UpdateTechnicianLocationDto dto)
    {
        if (IsTechnicianUser() && CurrentTechnicianId() != id) return Forbid();
        var tech = await _service.UpdateLocationAsync(id, dto);
        if (tech == null) return NotFound();
        return Ok(tech);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        if (IsTechnicianUser()) return Forbid();
        var result = await _service.DeleteAsync(id);
        if (!result) return NotFound();
        return NoContent();
    }

    [HttpGet("locations")]
    public async Task<ActionResult<List<TechnicianLocationDto>>> GetLocations()
    {
        var role = User.FindFirstValue(ClaimTypes.Role) ?? User.FindFirstValue("role") ?? "";
        var tenantCode = User.FindFirstValue("tenantCode") ?? User.FindFirstValue("tenant") ?? "";
        var technicianId = CurrentTechnicianId();

        var locations = await _service.GetLocationsAsync();

        if (_permissions.IsSuperAdmin(User))
        {
            return Ok(locations);
        }

        // Teknisyen yalnızca kendi konumunu görür.
        if (IsTechnicianUser())
        {
            return Ok(locations.Where(l => l.Id == technicianId).ToList());
        }

        // GetAll ile aynı gerekçe: rol ADI beyaz listesi, B2B'den devirle gelen kullanıcıyı
        // (rol claim'i "Mudur", "ServisMudur"…) sessizce boş listeye düşürüyordu. Karar rol
        // adına değil "teknisyen mi, iş atayan taraf mı" sorusuna bağlı; firma sınırı duruyor.
        if (!string.IsNullOrWhiteSpace(tenantCode))
        {
            var filtered = locations.Where(l =>
                string.IsNullOrWhiteSpace(l.TenantCode) ||
                string.Equals(l.TenantCode, tenantCode, StringComparison.OrdinalIgnoreCase)
            ).ToList();
            return Ok(filtered);
        }

        return Ok(locations);
    }

    [HttpGet("status-counts")]
    public async Task<ActionResult<Dictionary<TechnicianStatus, int>>> GetStatusCounts()
    {
        if (IsTechnicianUser()) return Forbid();
        var counts = await _service.GetStatusCountsAsync();
        return Ok(counts);
    }

    /// <summary>
    /// Bütün teknisyenlerin iş sayacı: bugün, bu ay ve tüm zamanlar.
    ///
    /// Liste ekranı her satır için ayrı istek atmasın diye TEK çağrıda döner. Sayım
    /// InstallationTasks üzerinden yapılır: bir montaj kaydı birden çok kişiye bölünebildiği
    /// için "kimin ne kadar iş yaptığı" sorusunun doğru birimi kayıt değil GÖREV satırıdır.
    /// Adet de ayrıca toplanır — 20 adetlik tek satır, 1 adetlik satırla aynı yük değil.
    ///
    /// İptal (Cancelled) ve planlamaya geri alınan (Deferred) satırlar hiçbir sayaca girmez.
    /// Gün ayrımı planlanan güne göre yapılır; tamamlananlarda tamamlanma günü varsa o kullanılır.
    /// </summary>
    [HttpGet("work-stats")]
    public async Task<IActionResult> GetWorkStats(CancellationToken cancellationToken)
    {
        if (IsTechnicianUser()) return Forbid();

        // "Bugün" KULLANICININ GÜNÜ, sunucunun UTC günü değil.
        //
        // Saatler UTC saklanıyor; ekranda gün ayrımı yapan her yerde yerel saate çevrilmesi
        // gerekiyor (ApproachingJobsNotificationService de aynı +3'ü kullanıyor). UTC gününe
        // göre sayınca yerel saat 00:00-03:00 arasında "Bugün" kolonu bir önceki günü, akşam
        // 21:00'den sonra biten işler ise ertesi günü gösteriyordu.
        var localNow = LocalNow();
        var today = localNow.Date;
        var monthStart = new DateTime(today.Year, today.Month, 1, 0, 0, 0, DateTimeKind.Unspecified);

        var rows = await _context.InstallationTasks
            .AsNoTracking()
            // SİLİNMİŞ KAYDIN GÖREVİ SAYILMAZ.
            //
            // InstallationTasks'ta silinme bayrağı yok; o bayrak ServiceRecords'ta ve global
            // sorgu süzgeci (`!IsDeleted`) yalnızca ServiceRecords sorgulandığında devreye
            // giriyor. Görev tablosuna doğrudan bakan bir sorgu, silinmiş kaydın görevlerini de
            // sayar: kullanıcı bir montajı sildikten sonra teknisyenin sayacı yerinde kalıyordu.
            // `t.Service` referansı verilerek süzgeç bu sorguya da uygulatılıyor — takvim uç
            // noktası zaten kaydın alanlarını okuduğu için orada kendiliğinden uygulanıyordu ve
            // iki uç nokta AYNI teknisyen için farklı sayı gösteriyordu.
            .Where(t => !t.Service.IsDeleted
                        && t.AssignedTechnicianId != null
                        && t.Status != InstallationTaskStatus.Cancelled
                        && t.Status != InstallationTaskStatus.Deferred)
            // Gün hesabı SQL'e yollanmıyor: ham zaman damgası çekilip gün belleğe alındıktan
            // sonra bulunuyor. Saat kaydırma + gün kırpma işlemini Npgsql'in timestamptz için
            // nasıl çevireceği sürüme bağlı; gruplama zaten bellekte yapıldığı için sorguya
            // taşımanın bir kazancı yok.
            .Select(t => new
            {
                TechnicianId = t.AssignedTechnicianId!.Value,
                Stamp = t.Status == InstallationTaskStatus.Completed && t.CompletedAt != null
                        ? t.CompletedAt!.Value
                        : (t.PlannedAt ?? t.CreatedAt),
                t.Quantity,
                Completed = t.Status == InstallationTaskStatus.Completed,
            })
            .ToListAsync(cancellationToken);

        var result = rows
            .Select(r => new { r.TechnicianId, Day = LocalDay(r.Stamp), r.Quantity, r.Completed })
            .GroupBy(r => r.TechnicianId)
            .Select(g => new
            {
                technicianId = g.Key,
                today = new
                {
                    tasks = g.Count(x => x.Day == today),
                    quantity = g.Where(x => x.Day == today).Sum(x => x.Quantity),
                    completed = g.Count(x => x.Day == today && x.Completed),
                },
                month = new
                {
                    tasks = g.Count(x => x.Day >= monthStart),
                    quantity = g.Where(x => x.Day >= monthStart).Sum(x => x.Quantity),
                    completed = g.Count(x => x.Day >= monthStart && x.Completed),
                },
                total = new
                {
                    tasks = g.Count(),
                    quantity = g.Sum(x => x.Quantity),
                    completed = g.Count(x => x.Completed),
                },
            })
            .ToList();

        return Ok(result);
    }

    /// <summary>
    /// Tek teknisyenin takvimi: istenen ayın gün gün dökümü + son 12 ayın aylık özeti.
    ///
    /// Takvim hücresine basınca o günün işleri de görünsün diye günlük kırılımda kayıt/ürün
    /// bilgisi de taşınır. Ay parametresi verilmezse içinde bulunulan ay döner.
    /// </summary>
    [HttpGet("{id:guid}/work-calendar")]
    public async Task<IActionResult> GetWorkCalendar(
        Guid id,
        [FromQuery] int? year,
        [FromQuery] int? month,
        CancellationToken cancellationToken)
    {
        // Teknisyen kendi takvimini görebilir; başkasınınkini göremez.
        if (IsTechnicianUser() && CurrentTechnicianId() != id) return Forbid();

        var now = LocalNow();
        var y = year ?? now.Year;
        var m = month ?? now.Month;
        if (m < 1 || m > 12) return BadRequest(new { message = "Ay 1-12 arasında olmalı." });

        var monthStart = new DateTime(y, m, 1, 0, 0, 0, DateTimeKind.Unspecified);
        var monthEnd = monthStart.AddMonths(1);
        var historyStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Unspecified).AddMonths(-11);

        var raw = await _context.InstallationTasks
            .AsNoTracking()
            // SİLİNMİŞ KAYIT SÜZGECİ BURADA DA AÇIKÇA YAZILI.
            //
            // Bu sorgu aşağıda `t.Service.ServiceNumber` okuduğu için EF, ServiceRecords'un
            // global `!IsDeleted` süzgecini kendiliğinden uyguluyordu — sayaç uç noktası ise
            // uygulamıyordu ve iki ekran aynı teknisyen için farklı sayı gösteriyordu. Kural
            // örtük kalırsa, projeksiyondan `Service` alanları çıkarıldığı gün süzgeç de sessizce
            // kaybolur. İki uç noktanın süzgeci artık BİREBİR aynı ve gözle görülür.
            .Where(t => !t.Service.IsDeleted
                        && t.AssignedTechnicianId == id
                        && t.Status != InstallationTaskStatus.Cancelled
                        && t.Status != InstallationTaskStatus.Deferred)
            .Select(t => new
            {
                // Gün, sayaç uç noktasındaki ile AYNI kuralla bellekte bulunur (bkz. LocalDay).
                Stamp = t.Status == InstallationTaskStatus.Completed && t.CompletedAt != null
                        ? t.CompletedAt!.Value
                        : (t.PlannedAt ?? t.CreatedAt),
                t.Quantity,
                Completed = t.Status == InstallationTaskStatus.Completed,
                ServiceNumber = t.Service.ServiceNumber,
                ProductName = t.Item != null ? t.Item.ProductName : t.Service.ProductName,
                CustomerName = t.Item != null && t.Item.CustomerName != null ? t.Item.CustomerName : t.Service.CustomerName,
                RegionName = t.Service.Region != null ? t.Service.Region.Name : null,
            })
            .ToListAsync(cancellationToken);

        var rows = raw
            .Select(r => new
            {
                Day = LocalDay(r.Stamp),
                r.Quantity,
                r.Completed,
                r.ServiceNumber,
                r.ProductName,
                r.CustomerName,
                r.RegionName,
            })
            .ToList();

        var days = rows
            .Where(r => r.Day >= monthStart && r.Day < monthEnd)
            .GroupBy(r => r.Day)
            .OrderBy(g => g.Key)
            .Select(g => new
            {
                date = g.Key.ToString("yyyy-MM-dd"),
                tasks = g.Count(),
                quantity = g.Sum(x => x.Quantity),
                completed = g.Count(x => x.Completed),
                items = g.Select(x => new
                {
                    serviceNumber = x.ServiceNumber,
                    productName = x.ProductName,
                    customerName = x.CustomerName,
                    regionName = x.RegionName,
                    quantity = x.Quantity,
                    completed = x.Completed,
                }).ToList(),
            })
            .ToList();

        var months = rows
            .Where(r => r.Day >= historyStart)
            .GroupBy(r => new { r.Day.Year, r.Day.Month })
            .OrderBy(g => g.Key.Year).ThenBy(g => g.Key.Month)
            .Select(g => new
            {
                year = g.Key.Year,
                month = g.Key.Month,
                tasks = g.Count(),
                quantity = g.Sum(x => x.Quantity),
                completed = g.Count(x => x.Completed),
            })
            .ToList();

        return Ok(new
        {
            technicianId = id,
            year = y,
            month = m,
            days,
            months,
            total = new
            {
                tasks = rows.Count,
                quantity = rows.Sum(x => x.Quantity),
                completed = rows.Count(x => x.Completed),
            },
        });
    }

    [HttpPut("{id:guid}/warehouse")]
    public async Task<ActionResult<TechnicianDto>> AssignWarehouse(Guid id, [FromBody] AssignWarehouseRequest request)
    {
        if (IsTechnicianUser()) return Forbid();
        try
        {
            var tech = await _service.AssignWarehouseAsync(
                id, 
                request.WarehouseCode, request.WarehouseName, 
                request.CashAccountId, request.CashAccountName, 
                request.BankAccountId, request.BankAccountName, 
                request.PosAccountId, request.PosAccountName);
            if (tech == null) return NotFound();
            return Ok(tech);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(new { success = false, message = ex.Message });
        }
    }

    public sealed class AssignWarehouseRequest
    {
        public int? WarehouseCode { get; set; }
        public string? WarehouseName { get; set; }
        public int? CashAccountId { get; set; }
        public string? CashAccountName { get; set; }
        public int? BankAccountId { get; set; }
        public string? BankAccountName { get; set; }
        public int? PosAccountId { get; set; }
        public string? PosAccountName { get; set; }
    }

    public sealed class UpdateTechnicianStatusRequest
    {
        public TechnicianStatus Status { get; set; }
    }

    public sealed class UpdateTechnicianOnlineRequest
    {
        public bool IsOnline { get; set; }
    }
}
