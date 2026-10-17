using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Processing;

namespace B2B.Erp.Api.Features.FaturaTakip;

/// <summary>
/// İmzalı fatura görselleri.
///
/// HERKESE AÇIK KLASÖRDE DEĞİL: ürün görselleri wwwroot'tan servis ediliyor ama bu görsellerde
/// müşterinin adı, adresi ve tutarı var. Dosya içerik kökünün altındaki App_Data'da duruyor ve
/// yalnızca yetki kontrolü yapan uçtan veriliyor. Dosya adı sunucuda üretiliyor; istemciden
/// gelen ad hiç kullanılmıyor (yol geçişi yok).
/// </summary>
public sealed class InvoiceTrackingPhotoStore
{
    public const long MaxBytes = 15L * 1024 * 1024;

    // Diskte 5 MB olup bellekte gigabaytlar tutan "sıkıştırma bombası" çözülmeden reddedilir.
    private const long MaxPixels = 80L * 1000 * 1000;

    // Telefon fotoğrafı 4000px'i geçiyor; faturayı okumak için 2400px fazlasıyla yeterli ve
    // dosya boyutu dörtte birine iniyor.
    private const int MaxEdge = 2400;

    private readonly string _root;

    public InvoiceTrackingPhotoStore(IWebHostEnvironment env)
    {
        var contentRoot = string.IsNullOrWhiteSpace(env.ContentRootPath) ? Directory.GetCurrentDirectory() : env.ContentRootPath;
        _root = Path.Combine(contentRoot, "App_Data", "invoice-tracking");
    }

    public sealed record SavedPhoto(string FileName, long SizeBytes);

    /// <exception cref="InvalidDataException">Dosya görsel değilse ya da sınırı aşıyorsa; mesaj ekrana basılabilir.</exception>
    public async Task<SavedPhoto> SaveAsync(IFormFile file, CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0) throw new InvalidDataException("Görsel boş.");
        if (file.Length > MaxBytes) throw new InvalidDataException("Görsel en fazla 15 MB olabilir.");

        await using (var probe = file.OpenReadStream())
        {
            int width, height;
            try
            {
                var info = await Image.IdentifyAsync(probe, cancellationToken);
                if (info is null) throw new InvalidDataException("Dosya bir görsel değil.");
                width = info.Width;
                height = info.Height;
            }
            catch (InvalidDataException)
            {
                throw;
            }
            catch (Exception)
            {
                throw new InvalidDataException("Dosya bir görsel değil.");
            }

            if ((long)width * height > MaxPixels)
                throw new InvalidDataException($"Görsel çözünürlüğü çok yüksek ({width}x{height}).");
        }

        var now = DateTime.UtcNow;
        var relative = Path.Combine(now.ToString("yyyy"), now.ToString("MM"), $"{Guid.NewGuid():N}.webp");
        var fullPath = Path.Combine(_root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        await using (var input = file.OpenReadStream())
        using (var image = await Image.LoadAsync(input, cancellationToken))
        {
            // Telefon görseli yan yatık gelmesin: EXIF yönü uygulanıp atılıyor.
            image.Mutate(x => x.AutoOrient());
            if (image.Width > MaxEdge || image.Height > MaxEdge)
            {
                image.Mutate(x => x.Resize(new ResizeOptions { Mode = ResizeMode.Max, Size = new Size(MaxEdge, MaxEdge) }));
            }

            await image.SaveAsync(fullPath, new WebpEncoder { Quality = 82 }, cancellationToken);
        }

        return new SavedPhoto(relative.Replace('\\', '/'), new FileInfo(fullPath).Length);
    }

    /// <returns>Dosya yoksa <c>null</c>.</returns>
    public string? ResolvePath(string fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName) || fileName.Contains("..")) return null;
        var full = Path.GetFullPath(Path.Combine(_root, fileName.Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(Path.GetFullPath(_root), StringComparison.OrdinalIgnoreCase)) return null;
        return File.Exists(full) ? full : null;
    }
}
