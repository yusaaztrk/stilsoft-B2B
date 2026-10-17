using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Ecommerce.Api.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Hosting;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Processing;
using SixLabors.ImageSharp.Formats.Webp;

namespace Ecommerce.Api.Controllers;

[ApiController]
[Route("api/admin/media")]
[Authorize(Roles = "Owner,Admin")]
public sealed class AdminMediaController : ControllerBase
{
    private readonly MediaRepository _mediaRepo;
    private readonly AdminLogsRepository _logsRepo;
    private readonly IWebHostEnvironment _env;

    public AdminMediaController(MediaRepository mediaRepo, AdminLogsRepository logsRepo, IWebHostEnvironment env)
    {
        _mediaRepo = mediaRepo;
        _logsRepo = logsRepo;
        _env = env;
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var items = await _mediaRepo.ListAllAsync(cancellationToken);
        return Ok(new { success = true, data = items });
    }

    [HttpPost]
    [RequestSizeLimit(15_000_000)]
    public async Task<IActionResult> Upload([FromForm] IFormFile file, [FromForm] string folder = "Genel", CancellationToken cancellationToken = default)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { success = false, message = "Dosya yüklenmedi." });

        var uploadsFolder = Path.Combine(_env.ContentRootPath, "wwwroot", "uploads", "ecommerce", "media");
        Directory.CreateDirectory(uploadsFolder);

        var fileId = Guid.NewGuid().ToString("N");
        var originalExt = Path.GetExtension(file.FileName);
        
        var isImage = file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ||
                      (originalExt != null && originalExt.ToLower() is ".jpg" or ".jpeg" or ".png" or ".webp");
        var targetExt = isImage ? ".webp" : originalExt;
        
        var fileName = $"{fileId}{targetExt}";
        var physicalPath = Path.Combine(uploadsFolder, fileName);

        long finalSize = file.Length;
        string finalContentType = file.ContentType;

        if (isImage)
        {
            try
            {
                using (var image = await SixLabors.ImageSharp.Image.LoadAsync(file.OpenReadStream(), cancellationToken))
                {
                    int maxDimension = 1920;
                    if (image.Width > maxDimension || image.Height > maxDimension)
                    {
                        var options = new ResizeOptions
                        {
                            Size = new Size(maxDimension, maxDimension),
                            Mode = ResizeMode.Max
                        };
                        image.Mutate(x => x.Resize(options));
                    }

                    var encoder = new WebpEncoder
                    {
                        Quality = 75,
                        Method = WebpEncodingMethod.BestQuality
                    };
                    await image.SaveAsync(physicalPath, encoder, cancellationToken);
                }

                var fi = new FileInfo(physicalPath);
                finalSize = fi.Length;
                finalContentType = "image/webp";
            }
            catch (Exception)
            {
                await using (var fs = System.IO.File.Create(physicalPath))
                {
                    await file.CopyToAsync(fs, cancellationToken);
                }
            }
        }
        else
        {
            await using (var fs = System.IO.File.Create(physicalPath))
            {
                await file.CopyToAsync(fs, cancellationToken);
            }
        }

        var publicUrl = $"/uploads/ecommerce/media/{fileName}";

        var mediaItem = new MediaItemEntity
        {
            Id = fileId,
            Name = Path.GetFileNameWithoutExtension(file.FileName),
            Url = publicUrl,
            Type = finalContentType,
            Size = finalSize,
            UploadedAt = DateTime.UtcNow,
            Folder = string.IsNullOrWhiteSpace(folder) ? "Genel" : folder.Trim()
        };

        await _mediaRepo.InsertAsync(mediaItem, cancellationToken);

        // Log upload
        var userEmail = User.Identity?.Name ?? "admin";
        await _logsRepo.LogAsync(
            userEmail,
            "MediaUpload",
            $"Uploaded media file: {mediaItem.Name} (Folder: {mediaItem.Folder})",
            Request.HttpContext.Connection.RemoteIpAddress?.ToString() ?? "127.0.0.1",
            cancellationToken
        );

        return Ok(new { success = true, data = mediaItem });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete([FromRoute] string id, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(id))
            return BadRequest(new { success = false, message = "Kimlik (id) zorunlu." });

        var items = await _mediaRepo.ListAllAsync(cancellationToken);
        var item = items.FirstOrDefault(x => x.Id == id);
        
        if (item is null)
            return NotFound(new { success = false, message = "Medya dosyası bulunamadı." });

        var filename = Path.GetFileName(item.Url);
        var physicalPath = Path.Combine(_env.ContentRootPath, "wwwroot", "uploads", "ecommerce", "media", filename);

        if (System.IO.File.Exists(physicalPath))
        {
            try
            {
                System.IO.File.Delete(physicalPath);
            }
            catch (Exception)
            {
                // ignore or log
            }
        }

        await _mediaRepo.DeleteAsync(id, cancellationToken);

        // Log delete
        var userEmail = User.Identity?.Name ?? "admin";
        await _logsRepo.LogAsync(
            userEmail,
            "MediaDelete",
            $"Deleted media file: {item.Name} from folder: {item.Folder}",
            Request.HttpContext.Connection.RemoteIpAddress?.ToString() ?? "127.0.0.1",
            cancellationToken
        );

        return Ok(new { success = true, message = "Dosya silindi." });
    }

    [HttpPost("{id}/rename")]
    public async Task<IActionResult> Rename([FromRoute] string id, [FromBody] RenameMediaDto dto, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(id))
            return BadRequest(new { success = false, message = "Kimlik (id) zorunlu." });

        if (dto == null || string.IsNullOrWhiteSpace(dto.Name))
            return BadRequest(new { success = false, message = "Dosya adı zorunlu." });

        var newName = dto.Name.Trim();

        var items = await _mediaRepo.ListAllAsync(cancellationToken);
        var item = items.FirstOrDefault(x => x.Id == id);
        if (item is null)
            return NotFound(new { success = false, message = "Medya dosyası bulunamadı." });

        await _mediaRepo.RenameAsync(id, newName, cancellationToken);

        // Audit Logging
        var userEmail = User.Identity?.Name ?? "admin";
        await _logsRepo.LogAsync(
            userEmail,
            "MediaRename",
            $"Renamed media file: '{item.Name}' to '{newName}' in folder: {item.Folder}",
            Request.HttpContext.Connection.RemoteIpAddress?.ToString() ?? "127.0.0.1",
            cancellationToken
        );

        return Ok(new { success = true, message = "Dosya adı güncellendi." });
    }
}

public sealed class RenameMediaDto
{
    public string Name { get; set; } = string.Empty;
}
