using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using ServiceOps.Application.Dtos;
using ServiceOps.Domain.Entities;
using ServiceOps.Infrastructure.Data;
using ServiceOps.Api.Hubs;
using ServiceOps.Api.Services;
using SixLabors.ImageSharp;

namespace ServiceOps.Api.Controllers;

public class CargoHistoryEntry
{
    public CargoTrackingStatus Status { get; set; }
    public string StatusLabel { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; }
    public string Actor { get; set; } = string.Empty;
    public string? Detail { get; set; }
}

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class CargoTrackingController : ControllerBase
{
    private readonly ApplicationDbContext _context;
    private readonly IHubContext<ServiceOpsHub> _hub;
    private readonly IServiceOpsPermissionService _permissions;
    private static readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    private readonly IJobAssignmentNotifier _assignmentNotifier;

    public CargoTrackingController(
        ApplicationDbContext context,
        IHubContext<ServiceOpsHub> hub,
        IServiceOpsPermissionService permissions,
        IJobAssignmentNotifier assignmentNotifier)
    {
        _context = context;
        _hub = hub;
        _permissions = permissions;
        _assignmentNotifier = assignmentNotifier;
    }

    /// <summary>
    /// Teslimat kaydını açar. İki çağıran var:
    ///  1. Kargo Kabul ekranı (personel oturumu, <c>kargoTakibi</c> yetkisi).
    ///  2. ERP fatura webhook'u (sunucu-sunucu anahtarı) — e-ticaret siparişi faturalanınca.
    ///
    /// İkincisi için <see cref="ServiceOps.Api.Filters.InternalApiKeyOrUserAttribute"/> şart:
    /// webhook'un arkasında kullanıcı oturumu yok, sınıf düzeyindeki <c>[Authorize]</c> onu
    /// yetki kontrolüne hiç ulaşmadan 401'e düşürüyordu.
    ///
    /// FİRMA KODU ZORUNLU: başlıksız istekte tenant çözücü VARSAYILAN veritabanına düşüyor,
    /// kayıt sessizce yanlış firmaya yazılırdı. Hata yerine sessiz yanlış davranış olduğu için
    /// burada açıkça reddediliyor.
    /// </summary>
    [HttpPost]
    [ServiceOps.Api.Filters.InternalApiKeyOrUser]
    public async Task<IActionResult> Create([FromBody] CreateCargoTrackingTaskDto request)
    {
        var isInternalCall = HttpContext.Items.ContainsKey(ServiceOps.Api.Filters.InternalApiKeyOrUserAttribute.InternalCallItemKey);

        if (!isInternalCall)
        {
            var scope = await _permissions.GetScopeAsync(User, "kargoTakibi");
            if (!scope.CanViewAll) return Forbid();
        }
        else if (string.IsNullOrWhiteSpace(Request.Headers["X-Tenant-Code"].FirstOrDefault()))
        {
            return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });
        }

        if (string.IsNullOrWhiteSpace(request.OrderNumber))
        {
            return BadRequest(new { success = false, message = "OrderNumber zorunlu." });
        }

        /*
         * AYNI SİPARİŞ İÇİN İKİNCİ KAYIT AÇILMAZ — ama var olan GÜNCELLENİR (2026-09-09).
         *
         * Eskiden kayıt varsa istek sessizce yok sayılıyordu. Akış değişince bu yetmez oldu:
         * kayıt artık ÖDEME anında açılıyor (fatura henüz yok), fatura kesilince ERP aynı
         * numarayla tekrar çağırıyor ve o çağrıda fatura numarası ile güncel paket dökümü
         * geliyor. Yok sayılsaydı kuryenin ekranında fatura numarası hiç görünmezdi.
         *
         * Yalnızca DOLU gelen alanlar yazılıyor: kısmi gövde geri kalanı boşaltmamalı.
         * Durum, planlanan tarih, atanan personel ve tarihçeye BURADAN DOKUNULMAZ — onlar
         * sahanın verisi; ERP'nin bir güncellemesi "Dağıtımda" olan bir teslimatı başa
         * döndürmemeli.
         */
        var existing = await _context.CargoTrackingTasks
            .FirstOrDefaultAsync(t => t.OrderNumber == request.OrderNumber);

        if (existing != null)
        {
            var details = ComposeProductDetails(request);

            if (!string.IsNullOrWhiteSpace(details)) existing.ProductDetails = details;
            if (!string.IsNullOrWhiteSpace(request.CustomerName)) existing.CustomerName = request.CustomerName;
            if (!string.IsNullOrWhiteSpace(request.CustomerPhone)) existing.CustomerPhone = request.CustomerPhone;
            if (!string.IsNullOrWhiteSpace(request.DeliveryAddress)) existing.DeliveryAddress = request.DeliveryAddress;

            existing.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();
            await _hub.Clients.All.SendAsync("cargo_updated", new { id = existing.Id, action = "updated" });

            return Ok(new { Id = existing.Id, Message = "Cargo tracking task updated.", Updated = true });
        }

        var history = new List<CargoHistoryEntry>
        {
            new CargoHistoryEntry
            {
                Status = CargoTrackingStatus.Received,
                StatusLabel = "Siparişiniz Alındı",
                Timestamp = DateTime.UtcNow,
                Actor = "Sistem",
                Detail = "Sipariş e-ticaret sisteminden başarıyla alındı."
            }
        };

        var entity = new CargoTrackingTask
        {
            OrderNumber = request.OrderNumber,
            ProductDetails = ComposeProductDetails(request),
            CustomerName = request.CustomerName,
            CustomerPhone = request.CustomerPhone,
            DeliveryAddress = request.DeliveryAddress,
            OrderDate = request.OrderDate,
            Status = CargoTrackingStatus.Received,
            HistoryJson = JsonSerializer.Serialize(history, _jsonOptions),
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _context.CargoTrackingTasks.Add(entity);
        await _context.SaveChangesAsync();
        await _hub.Clients.All.SendAsync("cargo_updated", new { id = entity.Id, action = "created" });

        return Ok(new { Id = entity.Id });
    }

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var scope = await _permissions.GetScopeAsync(User, "kargoTakibi");
        if (!scope.CanAccess) return Forbid();

        var tasks = await _permissions.ApplyCargoScope(_context.CargoTrackingTasks, scope)
            .Include(t => t.AssignedTechnician)
            .OrderByDescending(t => t.OrderDate)
            .Select(t => new CargoTrackingTaskDto
            {
                Id = t.Id,
                OrderNumber = t.OrderNumber,
                ProductDetails = t.ProductDetails,
                CustomerName = t.CustomerName,
                CustomerPhone = t.CustomerPhone,
                DeliveryAddress = t.DeliveryAddress,
                OrderDate = t.OrderDate,
                AssignedTechnicianId = t.AssignedTechnicianId,
                AssignedTechnicianName = t.AssignedTechnician != null ? $"{t.AssignedTechnician.FirstName} {t.AssignedTechnician.LastName}" : null,
                Status = (int)t.Status,
                PlannedDate = t.PlannedDate,
                HistoryJson = t.HistoryJson,
                ReceiverName = t.ReceiverName,
                DeliveryProofPhotoUrl = t.DeliveryProofPhotoUrl,
                Latitude = t.Latitude,
                Longitude = t.Longitude,
                CreatedAt = t.CreatedAt,
                UpdatedAt = t.UpdatedAt
            })
            .ToListAsync();

        return Ok(tasks);
    }

    [HttpGet("{orderNumber}")]
    public async Task<IActionResult> GetByOrderNumber(string orderNumber)
    {
        var scope = await _permissions.GetScopeAsync(User, "kargoTakibi");
        if (!scope.CanAccess) return Forbid();

        var task = await _permissions.ApplyCargoScope(_context.CargoTrackingTasks, scope)
            .Include(t => t.AssignedTechnician)
            .Where(t => t.OrderNumber == orderNumber)
            .Select(t => new CargoTrackingTaskDto
            {
                Id = t.Id,
                OrderNumber = t.OrderNumber,
                ProductDetails = t.ProductDetails,
                CustomerName = t.CustomerName,
                CustomerPhone = t.CustomerPhone,
                DeliveryAddress = t.DeliveryAddress,
                OrderDate = t.OrderDate,
                AssignedTechnicianId = t.AssignedTechnicianId,
                AssignedTechnicianName = t.AssignedTechnician != null ? $"{t.AssignedTechnician.FirstName} {t.AssignedTechnician.LastName}" : null,
                Status = (int)t.Status,
                PlannedDate = t.PlannedDate,
                HistoryJson = t.HistoryJson,
                ReceiverName = t.ReceiverName,
                DeliveryProofPhotoUrl = t.DeliveryProofPhotoUrl,
                Latitude = t.Latitude,
                Longitude = t.Longitude,
                CreatedAt = t.CreatedAt,
                UpdatedAt = t.UpdatedAt
            })
            .FirstOrDefaultAsync();

        if (task == null) return NotFound();

        return Ok(task);
    }

    /// <summary>
    /// Mağazanın (e-ticaret vitrini) teslimat takibi için ihtiyacı olan en az bilgi.
    ///
    /// Neden ayrı bir uç: <see cref="GetByOrderNumber"/> personel oturumu ve <c>kargoTakibi</c>
    /// sayfa yetkisi istiyor; e-ticaret müşterisinin ServiceOps kullanıcısı yok. Mağazaya
    /// personel hesabı açmak yerine sunucu-sunucu anahtarıyla dar bir kapı veriliyor.
    ///
    /// Dönen alanlar bilerek kısıtlı: durum, planlanan tarih ve müşteriye gösterilebilir tarihçe.
    /// Teknisyen adı, teslim fotoğrafı, alıcı adı ve KONUM (enlem/boylam) dışarı VERİLMEZ —
    /// bunlar operasyonun ve başka insanların verisi, siparişini takip eden müşterinin değil.
    ///
    /// SİPARİŞİN SAHİPLİĞİ BURADA DENETLENMİYOR, denetlenemez de: ServiceOps hangi mağaza
    /// üyesinin hangi siparişi verdiğini bilmiyor. Bu yüzden kontrol çağıran tarafta —
    /// mağaza API'si, sipariş numarasının oturumdaki üyeye ait olduğunu ERP'den doğrulamadan
    /// buraya gelmiyor. Anahtar da bu yüzden yalnızca sunucuda durur; tarayıcıya verilirse
    /// sipariş numarasını bilen herkes başkasının teslimat durumunu okuyabilir.
    /// </summary>
    [HttpGet("public/{orderNumber}")]
    [ServiceOps.Api.Filters.InternalApiKeyOrUser]
    public async Task<IActionResult> GetPublicTracking(string orderNumber)
    {
        // Öznitelik "anahtar VEYA giriş yapmış kullanıcı" diyor; burada yalnızca anahtar
        // kabul ediliyor. Aksi halde yalnızca kendi işini görmesi gereken bir kurye, bu uçtan
        // sayfa yetkisini atlayarak herhangi bir siparişin teslimat bilgisini okuyabilirdi.
        if (!HttpContext.Items.ContainsKey(ServiceOps.Api.Filters.InternalApiKeyOrUserAttribute.InternalCallItemKey))
        {
            return Forbid();
        }

        var code = (orderNumber ?? string.Empty).Trim();
        if (code.Length == 0) return NotFound();

        var task = await _context.CargoTrackingTasks
            .AsNoTracking()
            .Where(t => t.OrderNumber == code)
            .Select(t => new { t.Status, t.PlannedDate, t.HistoryJson, t.UpdatedAt })
            .FirstOrDefaultAsync();

        // Kayıt yok = "henüz kargoya verilmedi". 404 değil: sipariş var, teslimat aşamasına
        // gelmemiş. Mağaza bunu "Hazırlanıyor" olarak gösteriyor.
        if (task == null)
        {
            return Ok(new
            {
                success = true,
                data = new
                {
                    exists = false,
                    status = -1,
                    statusLabel = "Hazırlanıyor",
                    plannedDate = (DateTime?)null,
                    updatedAt = (DateTime?)null,
                    history = Array.Empty<object>()
                }
            });
        }

        var history = string.IsNullOrEmpty(task.HistoryJson)
            ? new List<CargoHistoryEntry>()
            : JsonSerializer.Deserialize<List<CargoHistoryEntry>>(task.HistoryJson, _jsonOptions) ?? new List<CargoHistoryEntry>();

        return Ok(new
        {
            success = true,
            data = new
            {
                exists = true,
                status = (int)task.Status,
                statusLabel = PublicStatusLabel(task.Status),
                plannedDate = task.PlannedDate,
                updatedAt = task.UpdatedAt,

                // Tarihçeden yalnızca "ne oldu, ne zaman". `Actor` ve `Detail` dışarıda:
                // ikisi de personel adı, teslim konumu ve iç notlar taşıyabiliyor.
                history = history
                    .OrderBy(h => h.Timestamp)
                    .Select(h => new
                    {
                        status = (int)h.Status,
                        statusLabel = PublicStatusLabel(h.Status),
                        timestamp = h.Timestamp
                    })
                    .ToList()
            }
        });
    }

    /// <summary>
    /// Sipariş numarasına göre teslimat kaydını siler. Çağıran ERP'dir: e-ticaret siparişinin
    /// son faturası silindiğinde teslimat da düşer.
    ///
    /// YALNIZCA SUNUCU-SUNUCU. Öznitelik "anahtar VEYA kullanıcı" diyor ama burada kullanıcı dalı
    /// kapatılıyor: aksi halde yalnızca kendi işini gören bir kurye, sayfa yetkisini atlayarak
    /// herhangi bir teslimatı silebilirdi. Personelin silme işi kendi ekranından yapılır.
    ///
    /// Kayıt yoksa 200 döner — ERP açısından "artık yok" istenen sonuçtur, hata değil. Aksi halde
    /// hiç kargoya çıkmamış bir siparişin faturası silindiğinde ERP günlüğü boş yere 404 dolardı.
    ///
    /// DİKKAT: silme geri alınamaz; teslim kanıtı (alıcı adı, fotoğraf, konum) ve tarihçe de gider.
    /// Durum kontrolü (teslim edilmişse koruma) bilerek konmadı — istenen davranış bu.
    /// </summary>
    [HttpDelete("order/{orderNumber}")]
    [ServiceOps.Api.Filters.InternalApiKeyOrUser]
    public async Task<IActionResult> DeleteByOrderNumber(string orderNumber)
    {
        if (!HttpContext.Items.ContainsKey(ServiceOps.Api.Filters.InternalApiKeyOrUserAttribute.InternalCallItemKey))
        {
            return Forbid();
        }

        if (string.IsNullOrWhiteSpace(Request.Headers["X-Tenant-Code"].FirstOrDefault()))
        {
            return BadRequest(new { success = false, message = "Firma kodu (X-Tenant-Code) eksik." });
        }

        var code = (orderNumber ?? string.Empty).Trim();
        if (code.Length == 0) return BadRequest(new { success = false, message = "Sipariş numarası zorunlu." });

        var task = await _context.CargoTrackingTasks.FirstOrDefaultAsync(t => t.OrderNumber == code);
        if (task == null)
        {
            return Ok(new { success = true, deleted = false });
        }

        var lastStatus = task.Status;
        _context.CargoTrackingTasks.Remove(task);
        await _context.SaveChangesAsync();
        await _hub.Clients.All.SendAsync("cargo_updated", new { id = task.Id, action = "deleted" });

        // Kaydın hangi aşamada silindiği günlüğe yazılıyor: "dağıtımdaki teslimat kayboldu"
        // sorusunun cevabı başka hiçbir yerde kalmıyor.
        Console.WriteLine($"[CargoTracking] Sipariş {code} teslimat kaydı ERP fatura silme akışıyla kaldırıldı (son durum: {lastStatus}).");

        return Ok(new { success = true, deleted = true, lastStatus = (int)lastStatus });
    }

    /// <summary>
    /// Paket dökümü + (varsa) fatura numarası.
    ///
    /// Fatura numarası için ayrı kolon açılmadı; ERP döküme zaten "Fatura: ..." satırını
    /// ekliyor. Buradaki ek, ERP'nin numarayı yalnızca alan olarak gönderdiği durumu da
    /// karşılıyor — iki taraftan biri değişse bile numara ekranda kalıyor.
    /// </summary>
    private static string? ComposeProductDetails(CreateCargoTrackingTaskDto request)
    {
        var details = request.ProductDetails ?? string.Empty;

        if (!string.IsNullOrWhiteSpace(request.InvoiceNo)
            && !details.Contains(request.InvoiceNo, StringComparison.OrdinalIgnoreCase))
        {
            details = string.IsNullOrWhiteSpace(details)
                ? $"Fatura: {request.InvoiceNo}"
                : $"{details}\nFatura: {request.InvoiceNo}";
        }

        return string.IsNullOrWhiteSpace(details) ? null : details;
    }

    private static string PublicStatusLabel(CargoTrackingStatus status) => status switch
    {
        CargoTrackingStatus.Received => "Siparişiniz Alındı",
        CargoTrackingStatus.Planned => "Planlandı",
        CargoTrackingStatus.Preparing => "Hazırlanıyor",
        CargoTrackingStatus.OutForDelivery => "Dağıtımda",
        CargoTrackingStatus.Delivered => "Teslim Edildi",
        _ => "Bilinmeyen"
    };

    [HttpGet("{id:guid}/details")]
    public async Task<IActionResult> GetDetails(Guid id)
    {
        var scope = await _permissions.GetScopeAsync(User, "kargoTakibi");
        if (!scope.CanAccess) return Forbid();

        var task = await _permissions.ApplyCargoScope(_context.CargoTrackingTasks, scope)
            .Include(t => t.AssignedTechnician)
            .FirstOrDefaultAsync(t => t.Id == id);

        if (task == null) return NotFound();

        var dto = new CargoTrackingTaskDto
        {
            Id = task.Id,
            OrderNumber = task.OrderNumber,
            ProductDetails = task.ProductDetails,
            CustomerName = task.CustomerName,
            CustomerPhone = task.CustomerPhone,
            DeliveryAddress = task.DeliveryAddress,
            OrderDate = task.OrderDate,
            AssignedTechnicianId = task.AssignedTechnicianId,
            AssignedTechnicianName = task.AssignedTechnician != null ? $"{task.AssignedTechnician.FirstName} {task.AssignedTechnician.LastName}" : null,
            Status = (int)task.Status,
            PlannedDate = task.PlannedDate,
            HistoryJson = task.HistoryJson,
            ReceiverName = task.ReceiverName,
            DeliveryProofPhotoUrl = task.DeliveryProofPhotoUrl,
            Latitude = task.Latitude,
            Longitude = task.Longitude,
            CreatedAt = task.CreatedAt,
            UpdatedAt = task.UpdatedAt
        };

        // `Order` alanı eski e-ticaret servisinden (:5288) çekiliyordu; o servis kullanılmıyor.
        // Yeni mağazanın kendi API'si var ama sipariş dökümünü ServiceOps'a açmıyor: kalem ve
        // fiyat bilgisi ERP'nin verisi, kuryenin işi değil. Kaleme dair ihtiyaç duyulan bilgi
        // kaydın `ProductDetails` alanında zaten geliyor (fatura webhook'u dolduruyor).
        // Alan, ön yüz sözleşmesi bozulmasın diye null olarak korunuyor.
        return Ok(new { Cargo = dto, Order = (object?)null });
    }

    /// <summary>
    /// Kargo kaydının müşteri / adres / ürün bilgisini düzenler.
    ///
    /// Bu uç YOKTU: Planlama ekranındaki düzenleme formu `PUT .../details` çağırıyor, sunucuda
    /// yalnızca GET tanımlı olduğu için her kaydetme 405 alıyordu — düğme hiç çalışmıyordu.
    ///
    /// Yetki, atama ucuyla aynı: kargo planlamada tüm kayıtları görme yetkisi. Sadece kendi
    /// işini gören kurye başkasının teslimat adresini değiştirememeli.
    /// </summary>
    [HttpPut("{id:guid}/details")]
    public async Task<IActionResult> UpdateDetails(Guid id, [FromBody] UpdateCargoDetailsDto request)
    {
        var scope = await _permissions.GetScopeAsync(User, "kargoPlanlama");
        if (!scope.CanViewAll) return Forbid();

        var task = await _context.CargoTrackingTasks.FirstOrDefaultAsync(t => t.Id == id);
        if (task == null) return NotFound();

        // Yalnızca gönderilen alanlar güncelleniyor: form kısmi gönderdiğinde geri kalanı
        // boşaltmak, düzeltilen tek alan uğruna adresi silmek anlamına gelirdi.
        if (request.CustomerName != null) task.CustomerName = request.CustomerName.Trim();
        if (request.CustomerPhone != null) task.CustomerPhone = request.CustomerPhone.Trim();
        if (request.DeliveryAddress != null) task.DeliveryAddress = request.DeliveryAddress.Trim();
        if (request.ProductDetails != null) task.ProductDetails = request.ProductDetails.Trim();

        task.UpdatedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();

        return Ok(new { success = true });
    }

    [HttpPut("{id}/assign")]
    public async Task<IActionResult> Assign(Guid id, [FromBody] AssignCargoDto request)
    {
        var scope = await _permissions.GetScopeAsync(User, "kargoPlanlama");
        if (!scope.CanViewAll) return Forbid();

        var task = await _context.CargoTrackingTasks.FindAsync(id);
        if (task == null) return NotFound();

        // Aynı kişiye yeniden atama (tarih düzeltme) bildirim üretmez.
        var technicianChanged = task.AssignedTechnicianId != request.TechnicianId;

        task.AssignedTechnicianId = request.TechnicianId;
        task.PlannedDate = request.PlannedDate;
        task.UpdatedAt = DateTime.UtcNow;

        var history = string.IsNullOrEmpty(task.HistoryJson)
            ? new List<CargoHistoryEntry>()
            : JsonSerializer.Deserialize<List<CargoHistoryEntry>>(task.HistoryJson, _jsonOptions) ?? new List<CargoHistoryEntry>();

        var techName = request.TechnicianName ?? "Teknisyen";
        history.Add(new CargoHistoryEntry
        {
            Status = CargoTrackingStatus.Received,
            StatusLabel = "Siparişiniz Alındı",
            Timestamp = DateTime.UtcNow,
            Actor = "Admin",
            Detail = $"Teknisyen/Kurye atandı: {techName} (Planlanan Tarih: {request.PlannedDate:dd.MM.yyyy})"
        });
        task.HistoryJson = JsonSerializer.Serialize(history, _jsonOptions);

        await _context.SaveChangesAsync();
        await _hub.Clients.All.SendAsync("cargo_updated", new { id = task.Id, action = "assigned" });

        if (technicianChanged && request.TechnicianId != Guid.Empty)
        {
            var subjectParts = new[] { task.OrderNumber, task.CustomerName, task.DeliveryAddress }
                .Where(p => !string.IsNullOrWhiteSpace(p));
            await _assignmentNotifier.NotifyAsync(new[]
            {
                new JobAssignment(
                    request.TechnicianId,
                    JobKind.Cargo,
                    task.Id,
                    string.Join(" · ", subjectParts),
                    1,
                    request.PlannedDate)
            }, HttpContext.RequestAborted);
        }

        return Ok();
    }

    [HttpPut("{id}/status")]
    public async Task<IActionResult> UpdateStatus(Guid id, [FromBody] UpdateCargoStatusDto request)
    {
        var scope = await _permissions.GetScopeAsync(User, "kargoTakibi");
        if (!scope.CanAccess) return Forbid();
        if (!await _permissions.ApplyCargoScope(_context.CargoTrackingTasks.Where(t => t.Id == id), scope).AnyAsync()) return Forbid();

        var task = await _context.CargoTrackingTasks.FindAsync(id);
        if (task == null) return NotFound();

        task.Status = (CargoTrackingStatus)request.Status;
        task.UpdatedAt = DateTime.UtcNow;

        if (task.Status == CargoTrackingStatus.Delivered)
        {
            task.ReceiverName = request.ReceiverName;
            task.DeliveryProofPhotoUrl = request.DeliveryProofPhotoUrl;
            task.Latitude = request.Latitude;
            task.Longitude = request.Longitude;
        }

        string label = task.Status switch
        {
            CargoTrackingStatus.Received => "Siparişiniz Alındı",
            CargoTrackingStatus.Planned => "Planlandı",
            CargoTrackingStatus.Preparing => "Hazırlanıyor",
            CargoTrackingStatus.OutForDelivery => "Dağıtımda",
            CargoTrackingStatus.Delivered => "Teslim Edildi",
            _ => "Bilinmeyen"
        };

        var history = string.IsNullOrEmpty(task.HistoryJson)
            ? new List<CargoHistoryEntry>()
            : JsonSerializer.Deserialize<List<CargoHistoryEntry>>(task.HistoryJson, _jsonOptions) ?? new List<CargoHistoryEntry>();

        string detail = request.Detail ?? $"Kargo durumu '{label}' olarak güncellendi.";
        if (task.Status == CargoTrackingStatus.Delivered)
        {
            var detailParts = new List<string>();
            if (!string.IsNullOrEmpty(request.ReceiverName)) detailParts.Add($"Alıcı: {request.ReceiverName}");
            if (request.Latitude.HasValue && request.Longitude.HasValue) detailParts.Add($"Konum: {request.Latitude}, {request.Longitude}");
            if (detailParts.Count > 0)
            {
                detail = $"Teslim Edildi. ({string.Join(", ", detailParts)})";
            }
        }

        history.Add(new CargoHistoryEntry
        {
            Status = task.Status,
            StatusLabel = label,
            Timestamp = DateTime.UtcNow,
            Actor = request.Actor ?? "Sistem",
            Detail = detail
        });
        task.HistoryJson = JsonSerializer.Serialize(history, _jsonOptions);

        await _context.SaveChangesAsync();
        await _hub.Clients.All.SendAsync("cargo_updated", new { id = task.Id, action = "status_updated" });
        return Ok();
    }

    [HttpPost("{id:guid}/proof")]
    [RequestSizeLimit(15_000_000)]
    public async Task<IActionResult> UploadProofPhoto(Guid id, IFormFile file, CancellationToken cancellationToken)
    {
        var scope = await _permissions.GetScopeAsync(User, "kargoTakibi", cancellationToken);
        if (!scope.CanAccess) return Forbid();
        if (!await _permissions.ApplyCargoScope(_context.CargoTrackingTasks.Where(t => t.Id == id), scope).AnyAsync(cancellationToken)) return Forbid();

        if (file == null || file.Length == 0) return BadRequest("Dosya zorunludur");
        if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)) return BadRequest("Sadece resim yüklenebilir");

        var taskExists = await _context.CargoTrackingTasks.AsNoTracking().AnyAsync(t => t.Id == id, cancellationToken);
        if (!taskExists) return NotFound();

        var safeName = $"{id:N}-{Guid.NewGuid():N}.webp";
        var folder = Path.Combine(AppContext.BaseDirectory, "uploads", "cargo-proofs");
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, safeName);
        using (var imageStream = file.OpenReadStream())
        using (var image = await SixLabors.ImageSharp.Image.LoadAsync(imageStream, cancellationToken))
        {
            await image.SaveAsWebpAsync(path, cancellationToken);
        }

        var relativeUrl = $"/uploads/cargo-proofs/{safeName}";
        return Ok(new { success = true, url = relativeUrl });
    }

}
