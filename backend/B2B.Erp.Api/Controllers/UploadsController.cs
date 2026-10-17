using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using B2B.Erp.Api.Core.Authorization;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/uploads")]
[Authorize]
public sealed class UploadsController : ControllerBase
{
    private readonly IWebHostEnvironment _env;

    public UploadsController(IWebHostEnvironment env)
    {
        _env = env;
    }

    /// <summary>Dışarıya duyurulacak şema — bkz. <see cref="Core.Helpers.PublicOrigin"/>.</summary>
    private string PublicScheme() => Core.Helpers.PublicOrigin.SchemeOf(Request);

    /// <summary>
    /// YÜKLEME KLASÖRÜ ÇALIŞMA DİZİNİNDEN DEĞİL, WEB KÖKÜNDEN ÇÖZÜLÜR (denetim md. 216).
    ///
    /// <para>
    /// Yol <c>Directory.GetCurrentDirectory()</c> ile kuruluyordu. Konsoldan çalıştırıldığında
    /// bu proje klasörüdür ama IIS ya da Windows Service altında çalışma dizini bambaşka bir
    /// yer olabilir (<c>C:\Windows\System32</c> gibi): dosyalar sitenin dışına yazılır ve
    /// vitrinde 404 verir. <c>WebRootPath</c> barındırma ortamının bildirdiği gerçek kök;
    /// tanımsızsa içerik kökünün altındaki <c>wwwroot</c>'a düşülür.
    /// </para>
    /// </summary>
    private string ResolveUploadFolder(params string[] segments)
    {
        var root = _env.WebRootPath;
        if (string.IsNullOrWhiteSpace(root))
        {
            root = Path.Combine(
                string.IsNullOrWhiteSpace(_env.ContentRootPath) ? Directory.GetCurrentDirectory() : _env.ContentRootPath,
                "wwwroot");
        }

        var all = new List<string> { root };
        all.AddRange(segments);
        return Path.Combine(all.ToArray());
    }

    /// <summary>
    /// Görsel yükleme üst sınırı. Video ucunda sınır vardı, görselde YOKTU: gelen dosya
    /// ImageSharp ile çözülüp WebP'ye dönüştürüldüğü için çok büyük bir görsel sunucunun
    /// belleğini tüketebiliyordu. 20 MB, ürün/dekont fotoğrafları için fazlasıyla geniş.
    /// </summary>
    private const long MaxImageBytes = 20L * 1024 * 1024;

    // YÜKLEME YETKİSİ (denetim md. 217).
    //
    // Uçta yalnızca `[Authorize]` vardı: sisteme giren EN KISITLI bayi bile 20 MB'lık
    // görselleri sınırsız sayıda yükleyebiliyordu — dosya başına sınır var ama TOPLAMDA yok,
    // yani sunucu diski doldurulabilirdi. Tek çağıran ürün yönetimi ekranı olduğu için
    // (`ProductGridPage`) o ekranın yetkisine bağlandı; ürün kartına görsel yükleyebilen
    // zaten ürünü düzenleyebilen kullanıcıdır.
    [AuthorizePage("users", "urunYonetimi")]
    [HttpPost("images")]
    [RequestSizeLimit(MaxImageBytes)]
    public async Task<IActionResult> UploadImage([FromForm] IFormFile file, CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return BadRequest(new { message = "File is required" });
        }

        if (file.Length > MaxImageBytes)
        {
            return BadRequest(new { message = "Görsel en fazla 20 MB olabilir" });
        }

        var ext = Path.GetExtension(file.FileName ?? string.Empty).ToLowerInvariant();
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp" };
        if (string.IsNullOrWhiteSpace(ext) || !allowed.Contains(ext))
        {
            return BadRequest(new { message = "Sadece görsel dosyaları (.jpg, .png, .webp vb.) yüklenebilir" });
        }

        var folder = ResolveUploadFolder("uploads", "images");
        Directory.CreateDirectory(folder);

        var fileName = $"{Guid.NewGuid():N}.webp";
        var fullPath = Path.Combine(folder, fileName);

        try
        {
            /*
              PİKSEL BOMBASINA KARŞI ÖN KONTROL (denetim md. 220).

              Dosya BOYUTU sınırlı (20 MB) ama açıldığında kapladığı bellek boyutuyla orantılı
              değil: yüksek oranda sıkışmış bir görsel diskte 5 MB olup RAM'de gigabaytlar
              tutabiliyor ("decompression bomb"). Çözmeden ÖNCE yalnız başlığı okuyup
              (`IdentifyAsync`) piksel sayısına bakılıyor; sınırı aşan dosya hiç çözülmüyor.
              80 MP, ürün/dekont fotoğrafları için fazlasıyla geniş (ör. 10000 x 8000).
            */
            const long maxPixels = 80L * 1000 * 1000;

            await using (var probeStream = file.OpenReadStream())
            {
                var info = await SixLabors.ImageSharp.Image.IdentifyAsync(probeStream, cancellationToken);
                if (info is not null && (long)info.Width * info.Height > maxPixels)
                {
                    return BadRequest(new
                    {
                        message = $"Görsel çözünürlüğü çok yüksek ({info.Width}x{info.Height}). Lütfen küçültüp tekrar yükleyin."
                    });
                }
            }

            using (var image = await SixLabors.ImageSharp.Image.LoadAsync(file.OpenReadStream(), cancellationToken))
            using (var fs = System.IO.File.Create(fullPath))
            {
                await image.SaveAsync(fs, new SixLabors.ImageSharp.Formats.Webp.WebpEncoder(), cancellationToken);
            }
        }
        catch (Exception ex)
        {
            return BadRequest(new { message = "Görsel formatı dönüştürülemedi: " + ex.Message });
        }

        var relativeUrl = $"/uploads/images/{fileName}";
        var absoluteUrl = $"{PublicScheme()}://{Request.Host}{relativeUrl}";
        return Ok(new { url = absoluteUrl });
    }

    /// <summary>
    /// Kabul edilen video uzantıları.
    ///
    /// Eskiden uzantı istemcinin gönderdiği dosya adından OLDUĞU GİBİ alınıyordu (yalnızca 10
    /// karaktere kırpılarak). Yüklenen dosya wwwroot altına düşüyor ve UseStaticFiles ile
    /// servis ediliyor; yani `.html` ya da `.svg` yükleyip API'nin kendi origin'inde script
    /// çalıştırmak mümkündü. Token localStorage'da tutulduğu için bu doğrudan oturum çalmaya
    /// açılan bir kapıydı. Uzantı artık beyaz listeden geçiyor.
    /// </summary>
    private static readonly HashSet<string> AllowedVideoExtensions =
        new(StringComparer.OrdinalIgnoreCase) { ".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv" };

    private const long MaxVideoBytes = 200L * 1024 * 1024;

    [AuthorizePage("users", "urunYonetimi")]
    [HttpPost("videos")]
    [RequestSizeLimit(MaxVideoBytes)]
    public async Task<IActionResult> UploadVideo([FromForm] IFormFile file, CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return BadRequest(new { message = "File is required" });
        }

        if (file.Length > MaxVideoBytes)
        {
            return BadRequest(new { message = "Video en fazla 200 MB olabilir" });
        }

        var ext = Path.GetExtension(file.FileName ?? string.Empty).ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(ext) || !AllowedVideoExtensions.Contains(ext))
        {
            return BadRequest(new { message = "Sadece video dosyaları (.mp4, .webm, .mov vb.) yüklenebilir" });
        }

        var folder = ResolveUploadFolder("uploads", "videos");
        Directory.CreateDirectory(folder);

        /*
          İÇERİK GERÇEKTEN VİDEO MU? (denetim md. 218)

          Yalnız uzantıya bakılıyordu: `.mp4` adıyla HTML/script yüklenip wwwroot üzerinden
          servis ettirilebiliyordu. Dosyanın ilk baytlarına (magic bytes) bakılıyor:
          MP4/MOV ailesinde 4. bayttan itibaren "ftyp", WebM/MKV'de EBML imzası bulunur.
          Tanınmayan imza reddediliyor — uzantı isim, imza ise içeriğin kendisidir.
        */
        await using (var signatureStream = file.OpenReadStream())
        {
            var header = new byte[12];
            var read = await signatureStream.ReadAsync(header.AsMemory(0, header.Length), cancellationToken);

            var isMp4Family = read >= 8
                              && header[4] == (byte)'f' && header[5] == (byte)'t'
                              && header[6] == (byte)'y' && header[7] == (byte)'p';

            var isMatroska = read >= 4
                             && header[0] == 0x1A && header[1] == 0x45
                             && header[2] == 0xDF && header[3] == 0xA3;

            if (!isMp4Family && !isMatroska)
            {
                return BadRequest(new { message = "Dosya içeriği video değil. Lütfen gerçek bir video dosyası yükleyin." });
            }
        }

        var fileName = $"{Guid.NewGuid():N}{ext}";
        var fullPath = Path.Combine(folder, fileName);

        await using (var stream = System.IO.File.Create(fullPath))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        var relativeUrl = $"/uploads/videos/{fileName}";
        var absoluteUrl = $"{PublicScheme()}://{Request.Host}{relativeUrl}";
        return Ok(new { url = absoluteUrl });
    }
}
