using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

/// <summary>
/// Personel fotoğrafı (2026-10-16). Görsel istemcide küçültülüp (en uzun kenar 600 px, JPEG)
/// base64 olarak gelir; sunucu yalnız biçimi ve boyutu denetler. Toplu ilk yükleme SQL ile yapılır
/// (maaş ödeme formundaki resimler).
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize]
[AuthorizePage("employee", "calisan")]
[AuthorizePage("users", "calisan")]
public sealed class EmployeePhotosController : ControllerBase
{
    private const int MaxBytes = 3 * 1024 * 1024;
    private readonly AppDbContext _dbContext;

    public EmployeePhotosController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    /// <summary>Fotoğrafı olan personeller (liste ekranı yalnız bunlar için görsel ister).</summary>
    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var data = await _dbContext.EmployeePhotos.AsNoTracking()
            .Select(x => new { x.EmployeeId, x.UpdatedAt })
            .ToListAsync(cancellationToken);
        return Ok(new { success = true, data });
    }

    [HttpGet("{employeeId:int}")]
    public async Task<IActionResult> Get([FromRoute] int employeeId, CancellationToken cancellationToken)
    {
        var photo = await _dbContext.EmployeePhotos.AsNoTracking()
            .FirstOrDefaultAsync(x => x.EmployeeId == employeeId, cancellationToken);
        if (photo is null) return NotFound(new { success = false, message = "Fotoğraf yok" });
        Response.Headers.CacheControl = "private, max-age=300";
        return File(photo.Data, photo.ContentType);
    }

    public sealed class UploadRequest
    {
        /// <summary>"data:image/jpeg;base64,..." ya da düz base64.</summary>
        public string? ImageBase64 { get; set; }
    }

    [HttpPut("{employeeId:int}")]
    public async Task<IActionResult> Upload([FromRoute] int employeeId, [FromBody] UploadRequest request, CancellationToken cancellationToken)
    {
        if (!await _dbContext.Employees.AnyAsync(x => x.Id == employeeId, cancellationToken))
            return NotFound(new { success = false, message = "Personel bulunamadı" });

        var raw = (request?.ImageBase64 ?? string.Empty).Trim();
        var comma = raw.IndexOf(',');
        if (raw.StartsWith("data:", StringComparison.OrdinalIgnoreCase) && comma > 0) raw = raw[(comma + 1)..];

        byte[] bytes;
        try { bytes = Convert.FromBase64String(raw); }
        catch (FormatException) { return BadRequest(new { success = false, message = "Görsel okunamadı" }); }

        if (bytes.Length == 0) return BadRequest(new { success = false, message = "Görsel boş" });
        if (bytes.Length > MaxBytes) return BadRequest(new { success = false, message = "Görsel 3 MB'tan büyük olamaz" });

        var contentType = Sniff(bytes);
        if (contentType is null) return BadRequest(new { success = false, message = "Yalnız JPEG, PNG ya da WEBP yüklenebilir" });

        var user = User.Identity?.Name ?? "System";
        var photo = await _dbContext.EmployeePhotos.FirstOrDefaultAsync(x => x.EmployeeId == employeeId, cancellationToken);
        if (photo is null)
        {
            photo = new EmployeePhoto { EmployeeId = employeeId };
            _dbContext.EmployeePhotos.Add(photo);
        }
        photo.Data = bytes;
        photo.ContentType = contentType;
        photo.UpdatedAt = DateTime.UtcNow;
        photo.UpdatedBy = user.Length <= 50 ? user : user[..50];
        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true, data = new { employeeId, photo.UpdatedAt } });
    }

    [HttpDelete("{employeeId:int}")]
    public async Task<IActionResult> Delete([FromRoute] int employeeId, CancellationToken cancellationToken)
    {
        var n = await _dbContext.EmployeePhotos.Where(x => x.EmployeeId == employeeId).ExecuteDeleteAsync(cancellationToken);
        return Ok(new { success = true, deleted = n });
    }

    private static string? Sniff(byte[] b)
    {
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return "image/jpeg";
        if (b.Length >= 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return "image/png";
        if (b.Length >= 12 && b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46 && b[8] == 0x57 && b[9] == 0x45 && b[10] == 0x42 && b[11] == 0x50) return "image/webp";
        return null;
    }
}
