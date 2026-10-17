using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[AllowAnonymous]
public class HealthController : ControllerBase
{
    [HttpGet]
    public IActionResult Get()
    {
        return Ok(new { status = "ok" });
    }

    /// <summary>
    /// Çalışan derlemenin kimliği — "yeni DLL gerçekten atıldı mı" sorusunu kesin cevaplar.
    /// `buildUtc` = B2B.Erp.Api.dll dosyasının son yazılma zamanı.
    /// </summary>
    [HttpGet("version")]
    public IActionResult Version()
    {
        var asm = System.Reflection.Assembly.GetExecutingAssembly();
        DateTime? buildUtc = null;
        try
        {
            var path = asm.Location;
            if (!string.IsNullOrEmpty(path) && System.IO.File.Exists(path))
            {
                buildUtc = System.IO.File.GetLastWriteTimeUtc(path);
            }
        }
        catch { /* yok say */ }

        return Ok(new
        {
            status = "ok",
            assemblyVersion = asm.GetName().Version?.ToString(),
            buildUtc,
            serverTimeUtc = DateTime.UtcNow,
            // Bu metin her yeni pakette elle degistirilir; deploy dogrulamasinin en basit yolu.
            marker = "2026-09-04-v9"
        });
    }
}
