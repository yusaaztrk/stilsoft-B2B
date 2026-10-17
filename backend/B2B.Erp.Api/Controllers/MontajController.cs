using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.DTOs.Montaj;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/montaj")]
[Authorize]
public sealed class MontajController : ControllerBase
{
    /// <summary>
    /// Montaj evrakı olarak kabul edilen uzantılar. Bkz. UploadDocument: dosya wwwroot altına
    /// düşüp statik servis edildiği için uzantı istemciden olduğu gibi alınamaz.
    /// </summary>
    private static readonly HashSet<string> AllowedDocumentExtensions =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ".pdf",
            ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic",
            ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt"
        };

    private const long MaxDocumentBytes = 50L * 1024 * 1024;

    private readonly AppDbContext _dbContext;

    public MontajController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    private bool GetRequesterIsSuperAdmin()
    {
        return User.FindFirst("IsSuperAdmin")?.Value == "1";
    }

    private string GetRequesterUsername()
    {
        var claimName = User.FindFirst(ClaimTypes.Name)?.Value;
        if (!string.IsNullOrWhiteSpace(claimName)) return claimName.Trim();

        var identityName = User.Identity?.Name;
        if (!string.IsNullOrWhiteSpace(identityName)) return identityName.Trim();

        return "System";
    }

    private string? GetRequesterCustomerCode()
    {
        var code = User.FindFirst("Carikodu")?.Value;
        return string.IsNullOrWhiteSpace(code) ? null : code.Trim();
    }

    private static string NormalizeStatus(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
    }

    private static bool IsTerminalStatus(string status)
    {
        return string.Equals(status, "Gerçekleşti", StringComparison.OrdinalIgnoreCase) ||
               string.Equals(status, "İptal", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsArizaType(string? type)
    {
        var t = string.IsNullOrWhiteSpace(type) ? string.Empty : type.Trim();
        return string.Equals(t, "Arıza", StringComparison.OrdinalIgnoreCase) ||
               string.Equals(t, "Ariza", StringComparison.OrdinalIgnoreCase);
    }

    private static HashSet<string> AllowedNextStatuses(string currentStatus, bool isAriza)
    {
        currentStatus = NormalizeStatus(currentStatus);

        if (string.Equals(currentStatus, "Yeni Kayıt", StringComparison.OrdinalIgnoreCase))
        {
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Planlandı", "İptal" };
        }

        if (string.Equals(currentStatus, "Planlandı", StringComparison.OrdinalIgnoreCase))
        {
            var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Gerçekleşti", "Ertelendi", "İptal" };
            if (isAriza) set.Add("Atölyeye Alındı");
            return set;
        }

        if (string.Equals(currentStatus, "Ertelendi", StringComparison.OrdinalIgnoreCase))
        {
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Planlandı", "İptal" };
        }

        if (string.Equals(currentStatus, "Atölyeye Alındı", StringComparison.OrdinalIgnoreCase))
        {
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Atölye Hazır" };
        }

        if (string.Equals(currentStatus, "Atölye Hazır", StringComparison.OrdinalIgnoreCase))
        {
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "Planlandı" };
        }

        if (IsTerminalStatus(currentStatus))
        {
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }

        // Deny by default for unknown statuses
        return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    }

    private async Task<Installation?> ResolveScopedInstallation(int id, CancellationToken cancellationToken)
    {
        var inst = await _dbContext.Installations
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (inst is null) return null;

        if (GetRequesterIsSuperAdmin()) return inst;

        // KAPSAM SÖZLEŞMESİ: `Carikodu` BOŞ ya da '*'/'ALL' ise kapsam SINIRSIZDIR (ofis
        // kullanıcısı). Burada boş kod "hiçbir şey görme" sayılıyordu: bayi olmayan şirket içi
        // montaj/servis personeli kendi kaydını bile açamıyor, listede boş ekran görüyordu.
        // Ayrıca tek koda karşılaştırma yapılıyordu — plasiyerin virgüllü portföyü de eleniyordu.
        if (CustomerScope.IsUnrestrictedFor(User)) return inst;

        var scopeCodes = CustomerScope.Of(User);
        return scopeCodes.Contains(inst.DealerCode ?? string.Empty, StringComparer.OrdinalIgnoreCase)
            ? inst
            : null;
    }

    private async Task<List<MontajListItemDto>> QueryInstallations(CancellationToken cancellationToken)
    {
        var isSuperAdmin = GetRequesterIsSuperAdmin();
        var requesterCari = GetRequesterCustomerCode();

        var q = _dbContext.Installations.AsNoTracking();

        // Kardeş yol: tekil okumayla aynı kapsam kuralı (bkz. ResolveScopedInstallation).
        // Boş kapsam = sınırsız; sınırlı kullanıcıda portföydeki BÜTÜN kodlar geçerli.
        if (!isSuperAdmin && !CustomerScope.IsUnrestrictedFor(User))
        {
            var scopeCodes = CustomerScope.Of(User);
            if (scopeCodes.Count == 0)
            {
                return new List<MontajListItemDto>();
            }

            q = q.Where(x => x.DealerCode != null && scopeCodes.Contains(x.DealerCode));
        }

        return await q
            .OrderByDescending(x => x.CreateTime)
            .Take(500)
            .Select(x => new MontajListItemDto
            {
                Id = x.Id,
                DealerCode = x.DealerCode,
                Type = x.Type,
                Status = x.Status,
                DealerName = x.DealerName,
                ProductName = x.ProductName,
                Quantity = x.Quantity,
                CustomerName = x.InstallationName,
                CustomerPhone = x.InstallationPhone,
                Address = x.Address,
                Region = x.Region,
                PlannedDateUtc = x.PlannedDateUtc,
                Technician = x.Technician,
                DealerDescription = x.DealerDescription,
                CreateUser = x.CreateUser,
                CreateTime = x.CreateTime
            })
            .ToListAsync(cancellationToken);
    }

    [HttpGet("list")]
    [AuthorizePage("service", "montajListesi")]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        var items = await QueryInstallations(cancellationToken);
        return Ok(new { success = true, data = items });
    }

    [HttpGet("report")]
    [AuthorizePage("service", "montajRapor")]
    public async Task<IActionResult> Report(CancellationToken cancellationToken)
    {
        var items = await QueryInstallations(cancellationToken);
        return Ok(new { success = true, data = items });
    }

    [HttpPost]
    [AuthorizePage("service", "montajListesi")]
    public async Task<IActionResult> Create([FromBody] CreateMontajRequest request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Geçersiz istek" });
        }

        var isSuperAdmin = GetRequesterIsSuperAdmin();
        var requesterCari = GetRequesterCustomerCode();

        var dealerCode = string.IsNullOrWhiteSpace(request.DealerCode) ? null : request.DealerCode.Trim();
        if (!isSuperAdmin)
        {
            dealerCode = string.IsNullOrWhiteSpace(requesterCari) ? null : requesterCari;
        }

        if (string.IsNullOrWhiteSpace(dealerCode))
        {
            return BadRequest(new { success = false, message = "Bayi (Cari Kodu) çözümlenemedi" });
        }

        var typeRaw = string.IsNullOrWhiteSpace(request.Type) ? "Montaj" : request.Type.Trim();
        var type = string.Equals(typeRaw, "Arıza", StringComparison.OrdinalIgnoreCase) || string.Equals(typeRaw, "Ariza", StringComparison.OrdinalIgnoreCase)
            ? "Arıza"
            : "Montaj";

        var now = DateTime.UtcNow;
        var username = GetRequesterUsername();

        var entity = new Entities.Installation
        {
            DealerCode = dealerCode,
            DealerName = string.IsNullOrWhiteSpace(request.DealerName) ? dealerCode : request.DealerName.Trim(),
            ProductName = string.IsNullOrWhiteSpace(request.ProductName) ? "-" : request.ProductName.Trim(),
            Quantity = request.Quantity <= 0 ? 1 : request.Quantity,
            InstallationName = string.IsNullOrWhiteSpace(request.CustomerName) ? null : request.CustomerName.Trim(),
            InstallationPhone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim(),
            Address = string.IsNullOrWhiteSpace(request.Address) ? "-" : request.Address.Trim(),
            Region = string.IsNullOrWhiteSpace(request.Region) ? "-" : request.Region.Trim(),
            DealerDescription = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim(),
            Type = type,
            Status = "Yeni Kayıt",
            PlannedDateUtc = null,
            Technician = null,
            CreateUser = username,
            CreateTime = now,
            EditUser = null,
            EditTime = null
        };

        _dbContext.Installations.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, data = new { id = entity.Id } });
    }

    [HttpPut("{id:int}/plan")]
    [AuthorizePage("service", "montajListesi")]
    public async Task<IActionResult> Plan([FromRoute] int id, [FromBody] PlanMontajRequest request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Geçersiz istek" });
        }

        if (!request.PlannedDateUtc.HasValue)
        {
            return BadRequest(new { success = false, message = "Plan tarihi zorunlu" });
        }

        var tech = string.IsNullOrWhiteSpace(request.Technician) ? null : request.Technician.Trim();
        if (string.IsNullOrWhiteSpace(tech))
        {
            return BadRequest(new { success = false, message = "Teknisyen zorunlu" });
        }

        var inst = await ResolveScopedInstallation(id, cancellationToken);
        if (inst is null)
        {
            return NotFound(new { success = false, message = "Kayıt bulunamadı" });
        }

        var currentStatus = NormalizeStatus(inst.Status);
        if (!(string.Equals(currentStatus, "Yeni Kayıt", StringComparison.OrdinalIgnoreCase) ||
              string.Equals(currentStatus, "Ertelendi", StringComparison.OrdinalIgnoreCase) ||
              string.Equals(currentStatus, "Atölye Hazır", StringComparison.OrdinalIgnoreCase)))
        {
            return BadRequest(new { success = false, message = "Bu kayıt planlanamaz (geçersiz durum geçişi)." });
        }

        inst.PlannedDateUtc = DateTime.SpecifyKind(request.PlannedDateUtc.Value, DateTimeKind.Utc);
        inst.Technician = tech;
        inst.Status = "Planlandı";
        inst.EditUser = GetRequesterUsername();
        inst.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpGet("{id:int}/documents")]
    [AuthorizePage("service", "montajListesi")]
    public async Task<IActionResult> GetDocuments([FromRoute] int id, CancellationToken cancellationToken)
    {
        var inst = await ResolveScopedInstallation(id, cancellationToken);
        if (inst is null)
        {
            return NotFound(new { success = false, message = "Kayıt bulunamadı" });
        }

        var docs = await _dbContext.InstallationDocuments
            .AsNoTracking()
            .Where(x => x.InstallationId == id)
            .OrderByDescending(x => x.UploadedDateUtc)
            .Select(x => new InstallationDocumentDto
            {
                Id = x.Id,
                InstallationId = x.InstallationId,
                DocumentUrl = x.DocumentUrl,
                UploadedDateUtc = x.UploadedDateUtc
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = docs });
    }

    [HttpPost("{id:int}/document")]
    [AuthorizePage("service", "montajListesi")]
    public async Task<IActionResult> UploadDocument([FromRoute] int id, [FromForm] IFormFile file, CancellationToken cancellationToken)
    {
        var inst = await ResolveScopedInstallation(id, cancellationToken);
        if (inst is null)
        {
            return NotFound(new { success = false, message = "Kayıt bulunamadı" });
        }

        if (file is null || file.Length == 0)
        {
            return BadRequest(new { success = false, message = "Dosya zorunlu" });
        }

        if (file.Length > MaxDocumentBytes)
        {
            return BadRequest(new { success = false, message = "Dosya en fazla 50 MB olabilir" });
        }

        // Uzantı istemcinin dosya adından olduğu gibi alınıyordu; dosya wwwroot altına düşüp
        // statik olarak servis edildiği için `.html` / `.svg` yükleyip API origin'inde script
        // çalıştırmak mümkündü. Liste montaj evrakı için gerçekçi olacak kadar geniş tutuldu.
        var ext = Path.GetExtension(file.FileName ?? string.Empty).ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(ext) || !AllowedDocumentExtensions.Contains(ext))
        {
            return BadRequest(new { success = false, message = "Bu dosya türü yüklenemez (izin verilenler: PDF, görsel, Office belgeleri)" });
        }

        var folder = Path.Combine(Directory.GetCurrentDirectory(), "wwwroot", "uploads", "montaj");
        Directory.CreateDirectory(folder);

        var fileName = $"{Guid.NewGuid():N}{ext}";
        var fullPath = Path.Combine(folder, fileName);

        await using (var stream = System.IO.File.Create(fullPath))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        var relativeUrl = $"/uploads/montaj/{fileName}";
        var absoluteUrl = $"{B2B.Erp.Api.Core.Helpers.PublicOrigin.Of(Request)}{relativeUrl}";

        var doc = new InstallationDocument
        {
            InstallationId = id,
            DocumentUrl = absoluteUrl,
            UploadedDateUtc = DateTime.UtcNow,
            CreateUser = GetRequesterUsername(),
            CreateTime = DateTime.UtcNow,
            EditUser = null,
            EditTime = null
        };

        _dbContext.InstallationDocuments.Add(doc);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, data = new { id = doc.Id, url = absoluteUrl } });
    }

    [HttpPut("{id:int}/status")]
    [AuthorizePage("service", "montajListesi")]
    public async Task<IActionResult> UpdateStatus([FromRoute] int id, [FromBody] UpdateMontajStatusRequest request, CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Geçersiz istek" });
        }

        var nextStatus = NormalizeStatus(request.Status);
        if (string.IsNullOrWhiteSpace(nextStatus))
        {
            return BadRequest(new { success = false, message = "Durum zorunlu" });
        }

        var inst = await ResolveScopedInstallation(id, cancellationToken);
        if (inst is null)
        {
            return NotFound(new { success = false, message = "Kayıt bulunamadı" });
        }

        var currentStatus = NormalizeStatus(inst.Status);
        var isAriza = IsArizaType(inst.Type);

        // Enforce state machine transitions (with SuperAdmin override)
        var allowedNext = AllowedNextStatuses(currentStatus, isAriza);
        var canOverride = GetRequesterIsSuperAdmin() && request.ForceOverride;
        if (!allowedNext.Contains(nextStatus) && !canOverride)
        {
            return BadRequest(new { success = false, message = "Geçersiz durum geçişi" });
        }

        // TAMAMLANMIŞ MONTAJ GERİ ALINIRKEN STOK: koda "stok iadesi tetikle" diye bir not
        // bırakılmıştı. İNCELENDİ (2026-08-17) ve o notun varsaydığı şey bu modelde YOK —
        // montaj durumu stok hareketi ÜRETMİYOR. Mal stoktan FATURA ile çıkıyor
        // (montaj → sipariş satırı → fatura → stok hareketi). Dolayısıyla durum geri alınırken
        // körlemesine stok girişi yazmak, faturası duran malı depoya İKİNCİ kez koyar; yani
        // "eksik iade" değil "hayali stok" üretirdi.
        //
        // Doğrusu: faturası varken geri alma engellenir, kullanıcı önce faturayı silsin
        // (fatura silme yolu servis kaydını zaten eski durumuna döndürüyor). Faturası yoksa
        // stoktan bir şey çıkmamıştır, geri alınacak hareket de yoktur.
        if (!allowedNext.Contains(nextStatus) && canOverride)
        {
            var linkedInvoiceNo = await (
                from il in _dbContext.Set<InvoiceLine>().AsNoTracking()
                join sol in _dbContext.Set<SalesOrderLine>().AsNoTracking() on il.SalesOrderLineId equals sol.Id
                join inv in _dbContext.Set<Invoice>().AsNoTracking() on il.InvoiceId equals inv.Id
                where sol.InstallationId == inst.Id
                select inv.InvoiceNo).FirstOrDefaultAsync(cancellationToken);

            if (!string.IsNullOrWhiteSpace(linkedInvoiceNo))
            {
                return BadRequest(new
                {
                    success = false,
                    message = $"Bu kayıt {linkedInvoiceNo} numaralı faturaya bağlı. Durumu geri almadan önce faturayı silmeniz gerekir; aksi halde fatura ile stok çelişir."
                });
            }
        }

        inst.Status = nextStatus;

        // When workshop repair is finished, planner must re-plan the return visit.
        if (string.Equals(nextStatus, "Atölye Hazır", StringComparison.OrdinalIgnoreCase))
        {
            inst.PlannedDateUtc = null;
            inst.Technician = null;
        }

        inst.EditUser = GetRequesterUsername();
        inst.EditTime = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }
}
