using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class SuppliersController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public SuppliersController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public sealed class NextSupplierCodeResponse
    {
        public string SupplierCode { get; set; } = string.Empty;
    }

    private const string SupplierPrefix = "320-01-";

    private static long ParseLast6DigitsOrZero(string code)
    {
        var s = (code ?? string.Empty).Trim();
        if (!s.StartsWith(SupplierPrefix, StringComparison.OrdinalIgnoreCase)) return 0;
        var suffix = s.Substring(SupplierPrefix.Length);
        if (suffix.Length != 6) return 0;
        return long.TryParse(suffix, out var n) ? n : 0;
    }

    private async Task<string> ReserveNextSupplierCode(CancellationToken cancellationToken)
    {
        await using var tx = await _dbContext.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken);

        const string seriesKey = "supplier:320-01";
        var series = await _dbContext.NumberSeries
            .FirstOrDefaultAsync(x => x.Key == seriesKey, cancellationToken);

        var existingCodes = await _dbContext.Set<Supplier>()
            .AsNoTracking()
            .Where(x => x.SupplierCode.StartsWith(SupplierPrefix))
            .Select(x => x.SupplierCode)
            .ToListAsync(cancellationToken);

        var maxExisting = existingCodes.Count == 0 ? 0 : existingCodes.Max(ParseLast6DigitsOrZero);

        if (series is null)
        {
            series = new NumberSeries
            {
                Key = seriesKey,
                LastValue = maxExisting
            };

            _dbContext.NumberSeries.Add(series);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        else if (series.LastValue < maxExisting)
        {
            series.LastValue = maxExisting;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        series.LastValue += 1;
        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return SupplierPrefix + series.LastValue.ToString("D6");
    }

    public sealed class CreateSupplierRequest
    {
        [StringLength(50)]
        public string? SupplierCode { get; set; }

        [Required]
        [StringLength(200)]
        public string FullName { get; set; } = string.Empty;

        [StringLength(30)]
        public string? PhoneNumber { get; set; }

        [StringLength(100)]
        public string? Region { get; set; }

        [StringLength(500)]
        public string? Address { get; set; }
    }

    public sealed class UpdateSupplierRequest
    {
        [Required]
        [StringLength(50)]
        public string SupplierCode { get; set; } = string.Empty;

        [Required]
        [StringLength(200)]
        public string FullName { get; set; } = string.Empty;

        [StringLength(30)]
        public string? PhoneNumber { get; set; }

        [StringLength(100)]
        public string? Region { get; set; }

        [StringLength(500)]
        public string? Address { get; set; }
    }

    private static string? NormalizePhone(string? raw)
    {
        var s = (raw ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(s)) return null;
        var digits = new string(s.Where(char.IsDigit).ToArray());
        if (digits.Length == 11 && digits.StartsWith("0"))
        {
            return $"{digits.Substring(0, 4)} {digits.Substring(4, 3)} {digits.Substring(7, 4)}";
        }
        return string.IsNullOrWhiteSpace(digits) ? null : digits;
    }

    [HttpGet]
    [AuthorizePage("invoice", "alis")]
    public async Task<IActionResult> GetAll(
        [FromQuery] bool includeCustomers = false,
        [FromQuery] bool onlyWithProducts = false,
        [FromQuery] string? q = null,
        [FromQuery] int limit = 0,
        CancellationToken cancellationToken = default)
    {
        // ARAMA VE SINIR SUNUCUDA (2026-08-22). Kardeş uç `customers/dropdown` ile aynı kural.
        //
        // Cari Ekstre açılışta bu ucu `includeCustomers=true` ile çağırıyordu; o bayrakla
        // liste BÜTÜN carileri de kapsıyor ve müşteri listesinin ikinci bir kopyası tel
        // üzerinden geçiyordu (5855 satır). Seçim kutusu veri gelene kadar tıklanamıyordu.
        //
        // `limit` VARSAYILAN 0 = SINIRSIZ: bu ucu listeyi tümüyle isteyen ekranlar da
        // kullanıyor (alış faturası, karşı hesap seçimleri...), onların davranışı değişmemeli.
        // Sınırı yalnızca arama kutusu gönderir.
        //
        // Normalleştirme `CustomersController.GetDropdown` içindekiyle AYNI olmalı: farklı
        // olsaydı aynı yazı iki uçta farklı sonuç verir, kullanıcı aradığı cariyi bir listede
        // görüp diğerinde göremezdi.
        static string Norm(string? value)
        {
            if (string.IsNullOrEmpty(value)) return string.Empty;
            var lowered = value.ToLower(System.Globalization.CultureInfo.GetCultureInfo("tr-TR"));
            var sb = new System.Text.StringBuilder(lowered.Length);
            foreach (var ch in lowered)
            {
                switch (ch)
                {
                    case 'ı': sb.Append('i'); break;
                    case 'ğ': sb.Append('g'); break;
                    case 'ü': sb.Append('u'); break;
                    case 'ş': sb.Append('s'); break;
                    case 'ö': sb.Append('o'); break;
                    case 'ç': sb.Append('c'); break;
                    case ' ':
                    case '-':
                    case '(':
                    case ')':
                    case '.':
                    case ',':
                    case '/':
                    case '̇':
                        break;
                    default: sb.Append(ch); break;
                }
            }
            return sb.ToString();
        }

        var query = _dbContext.Set<Supplier>().AsNoTracking();

        if (!includeCustomers)
        {
            query = query.Where(x => !x.SupplierCode.StartsWith("120-"));
        }

        // SADECE ÜRÜNÜ OLAN TEDARİKÇİLER (2026-08-19 kullanıcı kararı).
        //
        // Alış faturası ekranı `includeCustomers=true` ile bütün carileri de çekiyordu;
        // listede mal alınmayan yüzlerce cari çıkıyordu. Mal alınan tedarikçi = üzerine
        // ÜRÜN tanımlanmış tedarikçi (`Product.SupplierId`). Ürünü yoksa önce ürün
        // tanımlanmalı, o yüzden listede de görünmüyor.
        if (onlyWithProducts)
        {
            var supplierIdsWithProducts = _dbContext.Set<Product>()
                .AsNoTracking()
                .Where(p => p.SupplierId != null)
                .Select(p => p.SupplierId!.Value);

            query = query.Where(x => supplierIdsWithProducts.Contains(x.Id));
        }

        var rows = await query
            .OrderByDescending(x => x.Id)
            .Select(x => new
            {
                id = x.Id,
                supplierCode = x.SupplierCode,
                fullName = x.FullName,
                phoneNumber = x.PhoneNumber,
                region = x.Region,
                address = x.Address,
                createTime = x.CreateTime,
                createUser = x.CreateUser
            })
            .ToListAsync(cancellationToken);

        IEnumerable<object> data = rows;

        var needle = Norm(q);
        if (needle.Length > 0)
        {
            var needleDigits = new string(needle.Where(char.IsDigit).ToArray());
            var words = (q ?? string.Empty)
                .Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(Norm)
                .Where(w => w.Length > 0)
                .ToList();

            data = rows.Where(x =>
            {
                var full = Norm($"{x.supplierCode} {x.fullName} {x.phoneNumber}");
                if (full.Contains(needle, StringComparison.Ordinal)) return true;

                if (needleDigits.Length >= 3)
                {
                    var phoneDigits = new string((x.phoneNumber ?? string.Empty).Where(char.IsDigit).ToArray());
                    if (phoneDigits.Contains(needleDigits, StringComparison.Ordinal)) return true;
                }

                // Birden çok kelime: hepsi geçmeli ("12001 ali" gibi tür+isim aramaları için).
                if (words.Count > 1 && words.All(w => full.Contains(w, StringComparison.Ordinal))) return true;

                return false;
            });
        }

        if (limit > 0) data = data.Take(limit);

        return Ok(new { success = true, data = data.ToList() });
    }

    [HttpGet("next-code")]
    [AuthorizePage("invoice", "alis")]
    public async Task<IActionResult> GetNextCode(CancellationToken cancellationToken = default)
    {
        // Preview only: do NOT increment series here.
        const string seriesKey = "supplier:320-01";
        var seriesLast = await _dbContext.NumberSeries
            .AsNoTracking()
            .Where(x => x.Key == seriesKey)
            .Select(x => (long?)x.LastValue)
            .FirstOrDefaultAsync(cancellationToken);

        var existingCodes = await _dbContext.Set<Supplier>()
            .AsNoTracking()
            .Where(x => x.SupplierCode.StartsWith(SupplierPrefix))
            .Select(x => x.SupplierCode)
            .ToListAsync(cancellationToken);

        var maxExisting = existingCodes.Count == 0 ? 0 : existingCodes.Max(ParseLast6DigitsOrZero);
        var last = Math.Max(seriesLast ?? 0, maxExisting);
        var code = SupplierPrefix + (last + 1).ToString("D6");
        return Ok(new { success = true, data = new NextSupplierCodeResponse { SupplierCode = code } });
    }

    [HttpPost]
    [AuthorizePage("users", "tedarikciEkle")]
    public async Task<IActionResult> Create([FromBody] CreateSupplierRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var supplierCode = (request.SupplierCode ?? string.Empty).Trim();
        var fullName = (request.FullName ?? string.Empty).Trim();
        var phoneNumber = NormalizePhone(request.PhoneNumber);
        var region = request.Region?.Trim();
        var address = request.Address?.Trim();

        if (string.IsNullOrWhiteSpace(supplierCode))
        {
            supplierCode = await ReserveNextSupplierCode(cancellationToken);
        }

        if (string.IsNullOrWhiteSpace(fullName)) ModelState.AddModelError(nameof(request.FullName), "FullName is required.");
        if (phoneNumber is not null && !B2B.Erp.Api.Core.Helpers.PhoneFormat.IsValid(phoneNumber)) ModelState.AddModelError(nameof(request.PhoneNumber), B2B.Erp.Api.Core.Helpers.PhoneFormat.Message);

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var exists = await _dbContext.Set<Supplier>()
            .AsNoTracking()
            .AnyAsync(x => x.SupplierCode == supplierCode, cancellationToken);

        if (exists)
        {
            supplierCode = await ReserveNextSupplierCode(cancellationToken);
        }

        var entity = new Supplier
        {
            SupplierCode = supplierCode,
            FullName = fullName,
            PhoneNumber = phoneNumber,
            Region = string.IsNullOrWhiteSpace(region) ? null : region,
            Address = string.IsNullOrWhiteSpace(address) ? null : address,
            CreateUser = User.Identity?.Name ?? "System",
            CreateTime = DateTime.UtcNow
        };

        _dbContext.Set<Supplier>().Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            message = "Tedarikçi oluşturuldu",
            data = new
            {
                id = entity.Id,
                supplierCode = entity.SupplierCode,
                fullName = entity.FullName,
                phoneNumber = entity.PhoneNumber,
                region = entity.Region,
                address = entity.Address,
                createTime = entity.CreateTime,
                createUser = entity.CreateUser
            }
        });
    }

    [HttpPut("{id:int}")]
    [AuthorizePage("users", "tedarikciEkle")]
    public async Task<IActionResult> Update([FromRoute] int id, [FromBody] UpdateSupplierRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var entity = await _dbContext.Set<Supplier>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        var supplierCode = (request.SupplierCode ?? string.Empty).Trim();
        var fullName = (request.FullName ?? string.Empty).Trim();
        var phoneNumber = NormalizePhone(request.PhoneNumber);
        var region = request.Region?.Trim();
        var address = request.Address?.Trim();

        if (string.IsNullOrWhiteSpace(supplierCode)) ModelState.AddModelError(nameof(request.SupplierCode), "SupplierCode is required.");
        if (string.IsNullOrWhiteSpace(fullName)) ModelState.AddModelError(nameof(request.FullName), "FullName is required.");
        if (phoneNumber is not null && !B2B.Erp.Api.Core.Helpers.PhoneFormat.IsValid(phoneNumber)) ModelState.AddModelError(nameof(request.PhoneNumber), B2B.Erp.Api.Core.Helpers.PhoneFormat.Message);

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var codeExists = await _dbContext.Set<Supplier>()
            .AsNoTracking()
            .AnyAsync(x => x.Id != id && x.SupplierCode == supplierCode, cancellationToken);

        if (codeExists)
        {
            ModelState.AddModelError(nameof(request.SupplierCode), "SupplierCode must be unique.");
            return ValidationProblem(ModelState);
        }

        entity.SupplierCode = supplierCode;
        entity.FullName = fullName;
        entity.PhoneNumber = phoneNumber;
        entity.Region = string.IsNullOrWhiteSpace(region) ? null : region;
        entity.Address = string.IsNullOrWhiteSpace(address) ? null : address;
        entity.EditUser = User.Identity?.Name ?? "System";
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            message = "Tedarikçi güncellendi",
            data = new
            {
                id = entity.Id,
                supplierCode = entity.SupplierCode,
                fullName = entity.FullName,
                phoneNumber = entity.PhoneNumber,
                region = entity.Region,
                address = entity.Address,
                createTime = entity.CreateTime,
                createUser = entity.CreateUser
            }
        });
    }

    [HttpDelete("{id:int}")]
    [AuthorizePage("users", "tedarikciEkle")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.Set<Supplier>().FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        // BAĞLI KAYIT VARSA SİLİNMEZ.
        //
        // Tedarikçi kartı hiçbir kontrol olmadan siliniyordu: üzerinde alış faturası,
        // ekstre hareketi ya da çek/senet bulunan bir tedarikçi silindiğinde o kayıtlar
        // artık var olmayan bir koda bağlı kalıyor (yetim), ekstre ve borç raporları
        // eksik çıkıyordu. Cari tarafında bu koruma zaten var; tedarikçi tarafı atlanmış.
        var supplierCode = (entity.SupplierCode ?? string.Empty).Trim();
        if (supplierCode.Length > 0)
        {
            var hasPurchaseInvoice = await _dbContext.Set<PurchaseInvoice>()
                .AsNoTracking()
                .AnyAsync(x => x.SupplierCode == supplierCode, cancellationToken);

            var hasLedger = await _dbContext.SupplierLedgerEntries
                .AsNoTracking()
                .AnyAsync(x => x.SupplierCode == supplierCode, cancellationToken);

            if (hasPurchaseInvoice || hasLedger)
            {
                return BadRequest(new
                {
                    success = false,
                    message = "Bu tedarikçinin alış faturası veya cari hareketi var; silinemez. Kartı pasife alabilirsiniz."
                });
            }
        }

        _dbContext.Set<Supplier>().Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, message = "Tedarikçi silindi" });
    }
}
