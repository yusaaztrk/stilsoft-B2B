using System.Text;
using System.Text.Json;
using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
// Yuz uclari "auth" politikasindaydi (dakikada 10). Yuz ile giris ekrani 1200 ms'de bir
// kare gonderdigi icin ekran acildiktan saniyeler sonra her istek 429 doner ve kullaniciya
// "yuz eslesmedi" gibi gorunurdu. Ayri ve daha genis politika: bkz. Program.cs "face".
[Microsoft.AspNetCore.RateLimiting.EnableRateLimiting("face")]
public sealed class FaceAuthController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly HttpClient _httpClient;
    private readonly string _faceServiceBaseUrl;
    private readonly ReverseGeocoder _geocoder;

    public FaceAuthController(AppDbContext dbContext, IConfiguration configuration, IHttpClientFactory httpClientFactory, ReverseGeocoder geocoder)
    {
        _dbContext = dbContext;
        _geocoder = geocoder;
        _httpClient = httpClientFactory.CreateClient("FaceService");
        _faceServiceBaseUrl = (configuration["FaceService:BaseUrl"] ?? "http://localhost:5300").TrimEnd('/');
    }

    // ── DTOs ─────────────────────────────────────────────────────

    public sealed class EnrollRequest
    {
        /// <summary>Min 1, max 5 base64-encoded images.</summary>
        public List<string> Images { get; set; } = new();
        public int EmployeeId { get; set; }
    }

    public sealed class FaceCheckInRequest
    {
        [Required]
        public string ImageBase64 { get; set; } = string.Empty;

        [Range(-90.0, 90.0, ErrorMessage = "Geçersiz enlem değeri.")]
        public decimal Latitude { get; set; }

        [Range(-180.0, 180.0, ErrorMessage = "Geçersiz boylam değeri.")]
        public decimal Longitude { get; set; }

        /// <summary>Telefonun bildirdiği konum hassasiyeti (m); sahte konum tespitinde kullanılır.</summary>
        public double? Accuracy { get; set; }
    }

    public sealed class FaceCheckOutRequest
    {
        [Required]
        public string ImageBase64 { get; set; } = string.Empty;

        [Range(-90.0, 90.0, ErrorMessage = "Geçersiz enlem değeri.")]
        public decimal Latitude { get; set; }

        [Range(-180.0, 180.0, ErrorMessage = "Geçersiz boylam değeri.")]
        public decimal Longitude { get; set; }

        /// <summary>Telefonun bildirdiği konum hassasiyeti (m); sahte konum tespitinde kullanılır.</summary>
        public double? Accuracy { get; set; }
    }

    // DTOs for Python service communication
    private sealed class PyEncodeRequest { public string image_base64 { get; set; } = ""; }
    private sealed class PyEncodeResponse { public bool success { get; set; } public List<double>? embedding { get; set; } public string message { get; set; } = ""; }

    private sealed class PyGalleryItem { public int employeeId { get; set; } public List<double> embedding { get; set; } = new(); }
    private sealed class PyCompareRequest { public List<double> probe_embedding { get; set; } = new(); public List<PyGalleryItem> gallery { get; set; } = new(); public double tolerance { get; set; } = 0.45; }
    private sealed class PyCompareResponse { public bool matched { get; set; } public int? employeeId { get; set; } public double? distance { get; set; } public string message { get; set; } = ""; }

    private static readonly JsonSerializerOptions _jsonOpts = new() { PropertyNameCaseInsensitive = true };

    // ── Helpers ──────────────────────────────────────────────────

    private async Task<PyEncodeResponse?> CallEncode(string imageBase64, CancellationToken ct)
    {
        var body = JsonSerializer.Serialize(new PyEncodeRequest { image_base64 = imageBase64 });
        var content = new StringContent(body, Encoding.UTF8, "application/json");
        var resp = await _httpClient.PostAsync($"{_faceServiceBaseUrl}/encode", content, ct);
        var json = await resp.Content.ReadAsStringAsync(ct);
        return JsonSerializer.Deserialize<PyEncodeResponse>(json, _jsonOpts);
    }

    private async Task<PyCompareResponse?> CallCompare(List<double> probe, List<PyGalleryItem> gallery, double tolerance, CancellationToken ct)
    {
        var body = JsonSerializer.Serialize(new PyCompareRequest { probe_embedding = probe, gallery = gallery, tolerance = tolerance });
        var content = new StringContent(body, Encoding.UTF8, "application/json");
        var resp = await _httpClient.PostAsync($"{_faceServiceBaseUrl}/compare", content, ct);
        var json = await resp.Content.ReadAsStringAsync(ct);
        return JsonSerializer.Deserialize<PyCompareResponse>(json, _jsonOpts);
    }

    // ── Endpoints ────────────────────────────────────────────────

    /// <summary>Enroll face embeddings for an employee (replaces existing).</summary>
    [HttpPost("enroll")]
    [Authorize]
    // BİYOMETRİK KAYIT PERSONEL EKRANININ YETKİSİNE BAĞLI. Yalnız `[Authorize]` varken, oturum
    // açabilen HERKES (bayi, teknisyen) istediği `employeeId` için yüz vektörü yazabiliyordu —
    // yani kendi yüzünü başka bir personelin kimliğine tanımlayıp onun adına PDKS girişi
    // yapabilirdi. Tek çağıran ekran `EmployeesPage`, o da bu yetkiyle korunuyor
    // (`EmployeesController` aynı özniteliği taşıyor), dolayısıyla meşru akış etkilenmiyor.
    [AuthorizePage("employee", "calisan")]
    public async Task<IActionResult> Enroll([FromBody] EnrollRequest request, CancellationToken ct)
    {
        if (request.EmployeeId <= 0)
            return BadRequest(new { success = false, message = "Geçersiz employeeId" });

        if (request.Images == null || request.Images.Count < 1 || request.Images.Count > 5)
            return BadRequest(new { success = false, message = "En az 1, en fazla 5 fotoğraf gerekli" });

        var employee = await _dbContext.Employees.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == request.EmployeeId && x.IsActive, ct);

        if (employee is null)
            return NotFound(new { success = false, message = "Çalışan bulunamadı" });

        // Fotograflari tek tek isle.
        //
        // TEK KARE YUZUNDEN TUM KAYIT IPTAL EDILMEZ: kullanici 5 kare cekiyor, biri bulanik ya
        // da yuz aci disinda kaliyor ve eskiden o tek kare butun kaydi 400 ile reddediyordu —
        // hicbir sey kaydedilmiyor, ekranda da bir sey olmuyordu. Artik yuzu bulunan kareler
        // kaydedilir, bulunamayanlar rapor edilir. Hicbiri tutmazsa hata doner.
        var embeddings = new List<List<double>>();
        var failures = new List<string>();

        for (var i = 0; i < request.Images.Count; i++)
        {
            var img = request.Images[i];
            if (string.IsNullOrWhiteSpace(img))
            {
                failures.Add($"Fotoğraf {i + 1}: boş");
                continue;
            }

            PyEncodeResponse? encResult;
            try
            {
                encResult = await CallEncode(img, ct);
            }
            catch (Exception ex)
            {
                // Servis erisilemiyorsa devam etmenin anlami yok; hepsi ayni sekilde patlar.
                return StatusCode(502, new { success = false, message = $"Yüz servisi hatası: {ex.Message}" });
            }

            if (encResult is null || !encResult.success || encResult.embedding is null || encResult.embedding.Count != 128)
            {
                failures.Add($"Fotoğraf {i + 1}: {encResult?.message ?? "yüz bulunamadı"}");
                continue;
            }

            embeddings.Add(encResult.embedding);
        }

        if (embeddings.Count == 0)
        {
            return BadRequest(new
            {
                success = false,
                message = "Hiçbir fotoğrafta yüz bulunamadı. Yüzünüz net görünecek şekilde tekrar deneyin.",
                failures
            });
        }

        // Delete existing embeddings for this employee
        await _dbContext.EmployeeFaceEmbeddings
            .Where(x => x.EmployeeId == request.EmployeeId)
            .ExecuteDeleteAsync(ct);

        // Save new embeddings
        var now = DateTime.UtcNow;
        var userName = User.Identity?.Name ?? "System";
        foreach (var emb in embeddings)
        {
            _dbContext.EmployeeFaceEmbeddings.Add(new EmployeeFaceEmbedding
            {
                EmployeeId = request.EmployeeId,
                EmbeddingJson = JsonSerializer.Serialize(emb),
                CreateUser = userName,
                CreateTime = now
            });
        }

        await _dbContext.SaveChangesAsync(ct);

        var okMessage = failures.Count == 0
            ? $"{embeddings.Count} yüz kaydı oluşturuldu"
            : $"{embeddings.Count} yüz kaydı oluşturuldu, {failures.Count} fotoğrafta yüz bulunamadı";

        return Ok(new { success = true, message = okMessage, count = embeddings.Count, failures });
    }

    /// <summary>Face-based check-in (anonymous – like QR check-in).</summary>
    [HttpPost("check-in")]
    [AllowAnonymous]
    public async Task<IActionResult> FaceCheckIn([FromBody] FaceCheckInRequest request, CancellationToken ct)
    {
        var tenantCode = Request.Headers["X-Tenant-Code"].ToString();
        if (string.IsNullOrWhiteSpace(tenantCode))
            return BadRequest(new { success = false, message = "Tenant bulunamadı" });

        if (string.IsNullOrWhiteSpace(request.ImageBase64))
            return BadRequest(new { success = false, message = "Fotoğraf gerekli" });

        // GEOFENCE BURADA YAPILMAZ: personele atanmis konum kisinin kim oldugu bilinmeden
        // secilemez. Kontrol, yuz eslesmesinden SONRA matchedEmployee ile yapilir.

        // 1. Encode probe face
        PyEncodeResponse? probeResult;
        try
        {
            probeResult = await CallEncode(request.ImageBase64, ct);
        }
        catch (Exception ex)
        {
            return StatusCode(502, new { success = false, message = $"Yüz servisi hatası: {ex.Message}" });
        }

        if (probeResult is null || !probeResult.success || probeResult.embedding is null || probeResult.embedding.Count != 128)
        {
            var msg = probeResult?.message ?? "Yüz algılanamadı";
            return BadRequest(new { success = false, code = "no_face", message = msg });
        }

        // 2. Load all active employee embeddings
        var allEmbeddings = await _dbContext.EmployeeFaceEmbeddings
            .AsNoTracking()
            .Include(x => x.Employee)
            .Where(x => x.Employee != null && x.Employee.IsActive)
            .Select(x => new { x.EmployeeId, x.EmbeddingJson })
            .ToListAsync(ct);

        if (allEmbeddings.Count == 0)
            return BadRequest(new { success = false, message = "Sistemde kayıtlı yüz bulunamadı" });

        // Build gallery – for each employee, pick the best embedding (closest to probe)
        // We send all embeddings and let Python find the best match
        var gallery = new List<PyGalleryItem>();
        foreach (var item in allEmbeddings)
        {
            try
            {
                var emb = JsonSerializer.Deserialize<List<double>>(item.EmbeddingJson);
                if (emb != null && emb.Count == 128)
                {
                    gallery.Add(new PyGalleryItem { employeeId = item.EmployeeId, embedding = emb });
                }
            }
            catch
            {
                // skip malformed embeddings
            }
        }

        if (gallery.Count == 0)
            return BadRequest(new { success = false, message = "Geçerli yüz kaydı bulunamadı" });

        // 3. Compare
        PyCompareResponse? compareResult;
        try
        {
            compareResult = await CallCompare(probeResult.embedding, gallery, 0.45, ct);
        }
        catch (Exception ex)
        {
            return StatusCode(502, new { success = false, message = $"Yüz karşılaştırma hatası: {ex.Message}" });
        }

        if (compareResult is null || !compareResult.matched || compareResult.employeeId is null)
        {
            var msg = compareResult?.message ?? "Yüz eşleşmedi";
            return Ok(new { success = false, code = "no_match", message = msg, distance = compareResult?.distance });
        }

        // 4. Create check-in record
        var matchedEmployee = await _dbContext.Employees.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == compareResult.employeeId.Value && x.IsActive, ct);

        if (matchedEmployee is null)
            return Ok(new { success = false, message = "Eşleşen çalışan bulunamadı veya aktif değil" });

        var empName = $"{matchedEmployee.FirstName} {matchedEmployee.LastName}".Trim();
        var now = DateTime.UtcNow;

        // DURUM KONUMDAN ÖNCE (2026-10-16): kişi tanındıysa önce ne durumda olduğu söylenir.
        // Bu yanıt eskiden ekranda sessizce yutuluyordu; "Yüz aranıyor…" sonsuza kadar dönüyordu.
        var latestCheckIn = await _dbContext.EmployeeCheckIns
            .AsNoTracking()
            .Where(x => x.EmployeeId == matchedEmployee.Id)
            .OrderByDescending(x => x.CheckInTime)
            .FirstOrDefaultAsync(ct);

        if (latestCheckIn is not null && latestCheckIn.CheckOutTime is null)
        {
            var sameDay = Core.Time.TurkeyTime.LocalDate(latestCheckIn.CheckInTime) == Core.Time.TurkeyTime.LocalDate(now);
            return Ok(new
            {
                success = false,
                code = "already_checked_in",
                employeeName = empName,
                checkInTime = latestCheckIn.CheckInTime,
                message = sameDay
                    ? $"{empName}, girişiniz zaten yapıldı (saat {AttendanceLocation.LocalStamp(latestCheckIn.CheckInTime)}). Mesai bitince çıkış yapın."
                    : $"{empName}, {AttendanceLocation.LocalStamp(latestCheckIn.CheckInTime)} tarihli girişiniz kapatılmamış. Önce çıkış yapın ya da yöneticinize bildirin."
            });
        }

        // Konum zorunlu; bölge tanımlıysa içinde olunmalı (AttendanceLocation).
        var geo = await AttendanceLocation.ValidateAsync(_dbContext, matchedEmployee, request.Latitude, request.Longitude, isCheckOut: false, ct);
        if (!geo.Ok)
        {
            return Ok(new { success = false, code = geo.Code, employeeName = empName, message = geo.Error });
        }

        var createUserRaw = $"face:{matchedEmployee.Username ?? matchedEmployee.FirstName}";
        var createUser = createUserRaw.Length <= 50 ? createUserRaw : createUserRaw.Substring(0, 50);
        var newRow = new EmployeeCheckIn
        {
            EmployeeId = matchedEmployee.Id,
            CheckInTime = now,
            Latitude = request.Latitude,
            Longitude = request.Longitude,
            // Cikis koordinatlari NULL BIRAKILMAZ.
            //
            // Kolonlar veritabaninda `numeric(9,6) NOT NULL DEFAULT 0.0`. Bu varlikta alanlar
            // `decimal?` oldugu icin EF, atanmadiklarinda acikca NULL gonderiyor ve insert
            // NOT NULL kisitina takiliyor: yuz eslesse bile giris kaydi olusmuyor, uc 500
            // donuyordu. (Ana ERP'de ayni alanlar `decimal`, yani orada sorun cikmiyor —
            // bu controller oradan kopyalandigi icin fark gozden kacti.)
            //
            // Ayni duzeltme `EmployeeCheckInsController` icinde zaten vardi.
            CheckOutLatitude = 0,
            CheckOutLongitude = 0,
            CheckInAccuracy = request.Accuracy,
            CreateUser = createUser,
            CreateTime = now
        };
        await _geocoder.FillCheckInAsync(newRow, ct);
        _dbContext.EmployeeCheckIns.Add(newRow);

        try
        {
            await _dbContext.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new
            {
                success = false,
                message = "Check-in kaydı oluşturulamadı",
                error = ex.GetBaseException().Message
            });
        }

        // Sahte konum izleri — kaydı engellemez, yöneticinin listesine düşer.
        await AttendanceSuspicionDetector.InspectAsync(_dbContext, matchedEmployee.Id, newRow, false, request.Latitude, request.Longitude, request.Accuracy, "yuz", ct);

        return Ok(new
        {
            success = true,
            data = new
            {
                employeeId = matchedEmployee.Id,
                employeeName = empName,
                checkInTime = now,
                distance = compareResult.distance
            }
        });
    }

    /// <summary>Face-based check-out (anonymous – like QR check-in/out).</summary>
    [HttpPost("check-out")]
    [AllowAnonymous]
    public async Task<IActionResult> FaceCheckOut([FromBody] FaceCheckOutRequest request, CancellationToken ct)
    {
        var tenantCode = Request.Headers["X-Tenant-Code"].ToString();
        if (string.IsNullOrWhiteSpace(tenantCode))
            return BadRequest(new { success = false, message = "Tenant bulunamadı" });

        if (string.IsNullOrWhiteSpace(request.ImageBase64))
            return BadRequest(new { success = false, message = "Fotoğraf gerekli" });

        PyEncodeResponse? probeResult;
        try
        {
            probeResult = await CallEncode(request.ImageBase64, ct);
        }
        catch (Exception ex)
        {
            return StatusCode(502, new { success = false, message = $"Yüz servisi hatası: {ex.Message}" });
        }

        if (probeResult is null || !probeResult.success || probeResult.embedding is null || probeResult.embedding.Count != 128)
        {
            var msg = probeResult?.message ?? "Yüz algılanamadı";
            return BadRequest(new { success = false, code = "no_face", message = msg });
        }

        var allEmbeddings = await _dbContext.EmployeeFaceEmbeddings
            .AsNoTracking()
            .Include(x => x.Employee)
            .Where(x => x.Employee != null && x.Employee.IsActive)
            .Select(x => new { x.EmployeeId, x.EmbeddingJson })
            .ToListAsync(ct);

        if (allEmbeddings.Count == 0)
            return BadRequest(new { success = false, message = "Sistemde kayıtlı yüz bulunamadı" });

        var gallery = new List<PyGalleryItem>();
        foreach (var item in allEmbeddings)
        {
            try
            {
                var emb = JsonSerializer.Deserialize<List<double>>(item.EmbeddingJson);
                if (emb != null && emb.Count == 128)
                {
                    gallery.Add(new PyGalleryItem { employeeId = item.EmployeeId, embedding = emb });
                }
            }
            catch
            {
                // skip
            }
        }

        if (gallery.Count == 0)
            return BadRequest(new { success = false, message = "Geçerli yüz kaydı bulunamadı" });

        PyCompareResponse? compareResult;
        try
        {
            compareResult = await CallCompare(probeResult.embedding, gallery, 0.45, ct);
        }
        catch (Exception ex)
        {
            return StatusCode(502, new { success = false, message = $"Yüz karşılaştırma hatası: {ex.Message}" });
        }

        if (compareResult is null || !compareResult.matched || compareResult.employeeId is null)
        {
            var msg = compareResult?.message ?? "Yüz eşleşmedi";
            return Ok(new { success = false, code = "no_match", message = msg, distance = compareResult?.distance });
        }

        var matchedEmployee = await _dbContext.Employees.AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == compareResult.employeeId.Value && x.IsActive, ct);

        if (matchedEmployee is null)
            return Ok(new { success = false, message = "Eşleşen çalışan bulunamadı veya aktif değil" });

        var now = DateTime.UtcNow;
        var empName = $"{matchedEmployee.FirstName} {matchedEmployee.LastName}".Trim();

        var latestCheckIn = await _dbContext.EmployeeCheckIns
            .Where(x => x.EmployeeId == matchedEmployee.Id)
            .OrderByDescending(x => x.CheckInTime)
            .FirstOrDefaultAsync(ct);

        // DURUM KONUMDAN ÖNCE (2026-10-16): çıkış yapmış personel tekrar okuttuğunda adıyla
        // "çıkışınız zaten yapıldı" görür. Eskiden bu yanıt ekranda yutuluyordu.
        if (latestCheckIn is null)
        {
            return Ok(new
            {
                success = false,
                code = "no_open_checkin",
                employeeName = empName,
                message = $"{empName}, açık bir giriş kaydınız yok. Önce giriş yapmalısınız."
            });
        }

        if (latestCheckIn.CheckOutTime is not null)
        {
            return Ok(new
            {
                success = false,
                code = "already_checked_out",
                employeeName = empName,
                checkOutTime = latestCheckIn.CheckOutTime,
                message = $"{empName}, çıkışınız zaten yapıldı (saat {AttendanceLocation.LocalStamp(latestCheckIn.CheckOutTime.Value)}). Yeni giriş yapmadan tekrar çıkış yapılamaz."
            });
        }

        // ÇIKIŞTA DA KONUM (2026-10-16): yüzle çıkış konuma hiç bakmıyordu; giriş bölgede
        // yapılıp çıkış her yerden basılabiliyordu. Kural girişle aynı.
        var geo = await AttendanceLocation.ValidateAsync(_dbContext, matchedEmployee, request.Latitude, request.Longitude, isCheckOut: true, ct, latestCheckIn);
        if (!geo.Ok)
        {
            return Ok(new { success = false, code = geo.Code, employeeName = empName, message = geo.Error });
        }

        latestCheckIn.CheckOutTime = now;
        latestCheckIn.CheckOutLatitude = request.Latitude;
        latestCheckIn.CheckOutLongitude = request.Longitude;
        latestCheckIn.CheckOutOffsite = geo.Offsite;
        latestCheckIn.CheckOutAccuracy = request.Accuracy;
        latestCheckIn.EditUser = $"face:{matchedEmployee.Username ?? matchedEmployee.FirstName}";
        latestCheckIn.EditTime = now;
        await _geocoder.FillCheckOutAsync(latestCheckIn, ct);

        try
        {
            await _dbContext.SaveChangesAsync(ct);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new
            {
                success = false,
                message = "Check-out kaydı oluşturulamadı",
                error = ex.GetBaseException().Message
            });
        }

        await AttendanceSuspicionDetector.InspectAsync(_dbContext, matchedEmployee.Id, latestCheckIn, true, request.Latitude, request.Longitude, request.Accuracy, "yuz", ct);

        return Ok(new
        {
            success = true,
            data = new
            {
                employeeId = matchedEmployee.Id,
                employeeName = empName,
                checkOutTime = now,
                offsite = geo.Offsite,
                distance = compareResult.distance
            }
        });
    }

    /// <summary>Check if an employee has face enrollment.</summary>
    [HttpGet("has-face/{employeeId:int}")]
    [Authorize]
    public async Task<IActionResult> HasFace([FromRoute] int employeeId, CancellationToken ct)
    {
        var count = await _dbContext.EmployeeFaceEmbeddings
            .AsNoTracking()
            .CountAsync(x => x.EmployeeId == employeeId, ct);

        return Ok(new { success = true, hasFace = count > 0, count });
    }

    /// <summary>Delete all face embeddings for an employee (KVKK right to erasure).</summary>
    [HttpDelete("embeddings/{employeeId:int}")]
    [Authorize]
    // Kardeş uç: silme de aynı yetkiye bağlı (enroll ile aynı gerekçe).
    [AuthorizePage("employee", "calisan")]
    public async Task<IActionResult> DeleteEmbeddings([FromRoute] int employeeId, CancellationToken ct)
    {
        var deleted = await _dbContext.EmployeeFaceEmbeddings
            .Where(x => x.EmployeeId == employeeId)
            .ExecuteDeleteAsync(ct);

        return Ok(new { success = true, message = $"{deleted} yüz kaydı silindi", deletedCount = deleted });
    }

    /// <summary>Health check for the Python face service.</summary>
    [HttpGet("service-health")]
    [Authorize]
    public async Task<IActionResult> ServiceHealth(CancellationToken ct)
    {
        try
        {
            var resp = await _httpClient.GetAsync($"{_faceServiceBaseUrl}/health", ct);
            var body = await resp.Content.ReadAsStringAsync(ct);
            return Ok(new { success = resp.IsSuccessStatusCode, status = body });
        }
        catch (Exception ex)
        {
            return Ok(new { success = false, status = "unavailable", error = ex.Message });
        }
    }
}
