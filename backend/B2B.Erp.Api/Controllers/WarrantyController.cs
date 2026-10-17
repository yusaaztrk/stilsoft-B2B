using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.Currency;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/warranty")]
[Authorize]
public sealed class WarrantyController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly ICurrencyRateService _money;

    public WarrantyController(AppDbContext dbContext, ICurrencyRateService money)
    {
        _dbContext = dbContext;
        _money = money;
    }

    [HttpGet]
    [AuthorizePage("reports", "garantiRaporlari")]
    public async Task<IActionResult> GetWarranties(
        [FromQuery] string? search,
        [FromQuery] string? status,
        [FromQuery] DateTime? startDate,
        [FromQuery] DateTime? endDate,
        CancellationToken cancellationToken = default)
    {
        var query = _dbContext.WarrantyRecords.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(x => x.Status == status);
        }

        if (startDate.HasValue)
        {
            var startUtc = DateTime.SpecifyKind(startDate.Value.Date, DateTimeKind.Utc);
            query = query.Where(x => x.RecordDate >= startUtc);
        }

        if (endDate.HasValue)
        {
            var endUtc = DateTime.SpecifyKind(endDate.Value.Date.AddDays(1).AddTicks(-1), DateTimeKind.Utc);
            query = query.Where(x => x.RecordDate <= endUtc);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLower();
            query = query.Where(x =>
                x.WarrantyNo.ToLower().Contains(s) ||
                x.CustomerName.ToLower().Contains(s) ||
                x.CustomerCode.ToLower().Contains(s) ||
                x.ProductName.ToLower().Contains(s) ||
                x.ProductCode.ToLower().Contains(s) ||
                (x.SerialNo != null && x.SerialNo.ToLower().Contains(s)) ||
                (x.BrandModel != null && x.BrandModel.ToLower().Contains(s))
            );
        }

        var results = await query
            .OrderByDescending(x => x.RecordDate)
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = results });
    }

    [HttpGet("{id:int}")]
    [AuthorizePage("reports", "garantiRaporlari")]
    public async Task<IActionResult> GetWarranty(int id, CancellationToken cancellationToken = default)
    {
        var record = await _dbContext.WarrantyRecords
            .AsNoTracking()
            .Include(x => x.Histories)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (record == null)
        {
            return NotFound(new { success = false, message = "Garanti kaydı bulunamadı" });
        }

        // Sort histories client-side/in-memory or we can trust EF Core ordering if we want.
        var sortedHistories = record.Histories.OrderBy(h => h.CreatedTime).ToList();

        return Ok(new { success = true, data = record, histories = sortedHistories });
    }

    [HttpPost]
    [AuthorizePage("reports", "garantiRaporlari")]
    public async Task<IActionResult> CreateWarranty(
        [FromBody] CreateWarrantyDto dto,
        CancellationToken cancellationToken = default)
    {
        if (dto == null)
        {
            return BadRequest(new { success = false, message = "Geçersiz veri" });
        }

        if (string.IsNullOrWhiteSpace(dto.CustomerCode) || string.IsNullOrWhiteSpace(dto.ProductCode))
        {
            return BadRequest(new { success = false, message = "Cari/Müşteri seçimi ve Ürün seçimi zorunludur" });
        }

        var customer = await _dbContext.Customers.AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == dto.CustomerCode, cancellationToken);
        var product = await _dbContext.Products.AsNoTracking()
            .FirstOrDefaultAsync(x => x.StockCode == dto.ProductCode, cancellationToken);

        if (customer == null)
        {
            return BadRequest(new { success = false, message = "Cari/Müşteri bulunamadı" });
        }
        if (product == null)
        {
            return BadRequest(new { success = false, message = "Ürün bulunamadı" });
        }

        // Para birimi ekrandan gelir (product-price uç noktası söylüyor); gelmezse TL.
        var currencyTypeId = CurrencyTypeHelper.Normalize(dto.CurrencyTypeId);
        if (!CurrencyTypeHelper.IsKnown(currencyTypeId))
        {
            return BadRequest(new { success = false, message = "Geçersiz para birimi" });
        }

        var currencyRate = 1m;
        if (!CurrencyTypeHelper.IsTry(currencyTypeId))
        {
            currencyRate = dto.CurrencyRate;
            if (currencyRate <= 0)
            {
                try
                {
                    currencyRate = await _money.GetLatestTryRateAsync(CurrencyTypeHelper.ToCode(currencyTypeId)!, cancellationToken);
                }
                catch
                {
                    currencyRate = 0m;
                }
            }

            if (currencyRate <= 0)
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    success = false,
                    message = "Kur bilgisi alınamadı. Lütfen kuru elle girin."
                });
            }
        }

        var username = User.Identity?.Name ?? "System";
        var warrantyNo = await ReserveNextWarrantyNo(cancellationToken);

        var record = new WarrantyRecord
        {
            TransactionType = dto.TransactionType ?? "GARANTİ",
            RecordDate = DateTime.UtcNow,
            WarrantyNo = warrantyNo,
            CustomerCode = customer.CustomerCode,
            CustomerName = customer.Name,
            Status = "AÇIK",
            GrossAmount = dto.GrossAmount,
            DiscountAmount = dto.DiscountAmount,
            NetAmount = dto.NetAmount,
            VatAmount = dto.VatAmount,
            TotalAmount = dto.TotalAmount,
            CurrencyTypeId = currencyTypeId,
            CurrencyRate = currencyRate,
            SalesmanCode = dto.SalesmanCode,
            CreatedByUserName = username,
            // CİHAZIN GERÇEK SERİ NUMARASI KORUNUR. Kullanıcının girdiği seri no çöpe atılıp
            // yerine sistemin ürettiği sayaç yazılıyordu; oysa takip numarası zaten ayrı bir
            // alanda duruyor (`WarrantyNo`, yukarıda). Sonuç: servise gelen cihazın üretici
            // seri numarası kalıcı olarak kayboluyor, mükerrer cihaz kontrolü yapılamıyordu.
            // Kullanıcı boş bıraktıysa eski davranış korunur (sayaçtan numara verilir).
            SerialNo = string.IsNullOrWhiteSpace(dto.SerialNo)
                ? await ReserveNextSerialNo(cancellationToken)
                : dto.SerialNo.Trim(),
            ProductCode = product.StockCode,
            ProductName = product.Name,
            BrandModel = dto.BrandModel ?? product.Name,
            WarrantyStatus = "AÇIK",
            LastStatusDate = DateTime.UtcNow,
            FaultDescription = dto.FaultDescription,
            WarrantyPeriodMonths = dto.WarrantyPeriodMonths > 0 ? dto.WarrantyPeriodMonths : 12,
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        };

        record.Histories.Add(new WarrantyHistory
        {
            Status = "AÇIK",
            Description = "Yeni garanti kaydı oluşturuldu.",
            CreatedTime = DateTime.UtcNow,
            CreatedByUser = username
        });

        _dbContext.WarrantyRecords.Add(record);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, data = record });
    }

    [HttpPost("{id:int}/status")]
    [AuthorizePage("reports", "garantiRaporlari")]
    public async Task<IActionResult> UpdateStatus(
        int id,
        [FromBody] UpdateStatusDto dto,
        CancellationToken cancellationToken = default)
    {
        if (dto == null || string.IsNullOrWhiteSpace(dto.Status))
        {
            return BadRequest(new { success = false, message = "Durum alanı zorunludur" });
        }

        var record = await _dbContext.WarrantyRecords
            .Include(x => x.Histories)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (record == null)
        {
            return NotFound(new { success = false, message = "Garanti kaydı bulunamadı" });
        }

        var username = User.Identity?.Name ?? "System";
        var previousStatus = record.Status;

        record.Status = dto.Status;
        record.WarrantyStatus = dto.Status;
        record.LastStatusDate = DateTime.UtcNow;
        record.EditUser = username;
        record.EditTime = DateTime.UtcNow;

        if (dto.Status == "TAMAMLANDI" || dto.Status == "DEĞİŞİM YAPILDI" || dto.Status == "İPTAL")
        {
            if (!record.CompletedDate.HasValue)
            {
                record.CompletedDate = DateTime.UtcNow;
            }
        }
        else
        {
            record.CompletedDate = null;
        }

        var historyDesc = string.IsNullOrWhiteSpace(dto.Description)
            ? $"Durum güncellendi: {previousStatus} -> {dto.Status}."
            : dto.Description;

        record.Histories.Add(new WarrantyHistory
        {
            Status = dto.Status,
            Description = historyDesc,
            CreatedTime = DateTime.UtcNow,
            CreatedByUser = username
        });

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, data = record });
    }

    [HttpGet("kpi")]
    [AuthorizePage("reports", "garantiRaporlari")]
    public async Task<IActionResult> GetKpis(CancellationToken cancellationToken = default)
    {
        var allRecords = await _dbContext.WarrantyRecords.AsNoTracking().ToListAsync(cancellationToken);

        int totalCount = allRecords.Count;
        int openCount = allRecords.Count(x => x.Status == "AÇIK" || x.Status == "SERVİSTE" || x.Status == "BEKLEMEDE");
        int inServiceCount = allRecords.Count(x => x.Status == "SERVİSTE");
        int completedCount = allRecords.Count(x => x.Status == "TAMAMLANDI");
        int changedProductCount = allRecords.Count(x => x.Status == "DEĞİŞİM YAPILDI");

        double averageResolutionDays = 0.0;
        var completedRecords = allRecords.Where(x => x.CompletedDate.HasValue).ToList();
        if (completedRecords.Count > 0)
        {
            var totalDays = completedRecords.Sum(x => (x.CompletedDate!.Value - x.RecordDate).TotalDays);
            averageResolutionDays = Math.Round(totalDays / completedRecords.Count, 1);
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                totalCount,
                openCount,
                inServiceCount,
                completedCount,
                changedProductCount,
                averageResolutionDays
            }
        });
    }

    [HttpGet("next-serial-no")]
    [AuthorizePage("reports", "garantiRaporlari")]
    public async Task<IActionResult> GetNextSerialNoPreview(CancellationToken cancellationToken = default)
    {
        var seriesKey = "warranty-serial-no";
        var series = await _dbContext.NumberSeries
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Key == seriesKey, cancellationToken);

        var existingSerials = await _dbContext.WarrantyRecords
            .AsNoTracking()
            .Where(x => x.SerialNo != null && x.SerialNo.StartsWith("G1"))
            .Select(x => x.SerialNo)
            .ToListAsync(cancellationToken);

        long maxExisting = 0;
        foreach (var serial in existingSerials)
        {
            if (serial != null && serial.Length == 15 && long.TryParse(serial.Substring(2), out var num))
            {
                if (num > maxExisting) maxExisting = num;
            }
        }

        long lastValue = maxExisting;
        var nextValue = lastValue + 1;
        return Ok(new { success = true, serialNo = $"G1{nextValue.ToString("D13")}" });
    }

    [HttpGet("product-price")]
    [AuthorizePage("reports", "garantiRaporlari")]
    public async Task<IActionResult> GetProductPrice(
        [FromQuery] string customerCode,
        [FromQuery] string productCode,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(customerCode) || string.IsNullOrWhiteSpace(productCode))
        {
            return BadRequest(new { success = false, message = "Cari/Müşteri kodu ve Ürün kodu zorunludur" });
        }

        var customer = await _dbContext.Customers.AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);
        
        var product = await _dbContext.Products.AsNoTracking()
            .FirstOrDefaultAsync(x => x.StockCode == productCode, cancellationToken);

        if (customer == null || product == null)
        {
            return Ok(new { success = true, price = 0m });
        }

        var priceGroupId = customer.PriceGroupId;
        decimal unitPrice = 0m;

        // FİYATIN PARA BİRİMİ DE DÖNER. Yalnızca sayı dönerse ekran onu ₺ sanar ve
        // dolar fiyatlı bir ürünün garanti kaydı 500 $ yerine 500 ₺ olarak yazılır.
        string priceCurrency = "TRY";

        if (priceGroupId.HasValue && priceGroupId.Value != Guid.Empty)
        {
            var overrideRow = await _dbContext.CustomerProductPriceOverrides
                .AsNoTracking()
                .Where(x => x.IsActive)
                .Where(x => x.CustomerCode == customer.CustomerCode)
                .Where(x => x.ProductId == product.Id)
                .Where(x => x.PriceGroupId == priceGroupId.Value)
                .Select(x => new { x.Price, x.Currency })
                .FirstOrDefaultAsync(cancellationToken);

            if (overrideRow is not null)
            {
                unitPrice = overrideRow.Price;
                priceCurrency = overrideRow.Currency;
            }
            else
            {
                var pgRow = await _dbContext.ProductPrices
                    .AsNoTracking()
                    .Where(x => x.ProductId == product.Id)
                    .Where(x => x.PriceGroupId == priceGroupId.Value)
                    .Select(x => new { x.Price, x.Currency })
                    .FirstOrDefaultAsync(cancellationToken);

                if (pgRow is not null)
                {
                    unitPrice = pgRow.Price;
                    priceCurrency = pgRow.Currency;
                }
            }
        }

        var currencyTypeId = ProductCurrencyHelper.MapCurrencyStringToCurrencyTypeId(priceCurrency);

        return Ok(new
        {
            success = true,
            price = unitPrice,
            currencyTypeId,
            currencyCode = CurrencyTypeHelper.ToCodeOrTry(currencyTypeId)
        });
    }

    private async Task<string> ReserveNextWarrantyNo(CancellationToken cancellationToken)
    {
        await using var tx = await _dbContext.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken);

        var seriesKey = "warranty-no";
        var series = await _dbContext.NumberSeries
            .FirstOrDefaultAsync(x => x.Key == seriesKey, cancellationToken);

        // NUMARATÖR ARTIK KAYNAK; tablo yalnız BİR KEZ taranıp seed ediliyor.
        //
        // Öncesinde her garanti kaydında bütün `WarrantyRecords` numaraları belleğe çekilip
        // maksimum hesaplanıyor ve `NumberSeries` üzerine YAZILIYORDU — numaratörün var olma
        // sebebi bu taramadan kurtulmaktı. On binlerce kayıtta her açılış yüzlerce MB.
        if (series is null)
        {
            var existingCodes = await _dbContext.WarrantyRecords
                .AsNoTracking()
                .Where(x => x.WarrantyNo.StartsWith("GR-"))
                .Select(x => x.WarrantyNo)
                .ToListAsync(cancellationToken);

            long maxExisting = 0;
            foreach (var code in existingCodes)
            {
                if (code.Length > 3 && long.TryParse(code.Substring(3), out var num))
                {
                    if (num > maxExisting) maxExisting = num;
                }
            }

            series = new NumberSeries
            {
                Key = seriesKey,
                LastValue = maxExisting
            };
            _dbContext.NumberSeries.Add(series);
        }

        // Numaratörün gerisinde kalma ihtimaline karşı (numarayı bu yoldan geçmeden yazan
        // bir kod olursa) üretilen aday tekil olana kadar ilerletiliyor. Serializable
        // işlem zaten eşzamanlı iki rezervasyonu sıraya sokuyor.
        string candidate;
        do
        {
            series.LastValue += 1;
            candidate = $"GR-{((long)series.LastValue).ToString("D12")}";
        }
        while (await _dbContext.WarrantyRecords.AsNoTracking()
            .AnyAsync(x => x.WarrantyNo == candidate, cancellationToken));

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return candidate;
    }

    private async Task<string> ReserveNextSerialNo(CancellationToken cancellationToken)
    {
        await using var tx = await _dbContext.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken);

        var seriesKey = "warranty-serial-no";
        var series = await _dbContext.NumberSeries
            .FirstOrDefaultAsync(x => x.Key == seriesKey, cancellationToken);

        // Bkz. ReserveNextWarrantyNo: tarama yalnız numaratör YOKKEN, bir kez.
        if (series is null)
        {
            var existingSerials = await _dbContext.WarrantyRecords
                .AsNoTracking()
                .Where(x => x.SerialNo != null && x.SerialNo.StartsWith("G1"))
                .Select(x => x.SerialNo)
                .ToListAsync(cancellationToken);

            long maxExisting = 0;
            foreach (var serial in existingSerials)
            {
                if (serial != null && serial.Length == 15 && long.TryParse(serial.Substring(2), out var num))
                {
                    if (num > maxExisting) maxExisting = num;
                }
            }

            series = new NumberSeries
            {
                Key = seriesKey,
                LastValue = maxExisting
            };
            _dbContext.NumberSeries.Add(series);
        }

        string candidate;
        do
        {
            series.LastValue += 1;
            candidate = $"G1{((long)series.LastValue).ToString("D13")}";
        }
        while (await _dbContext.WarrantyRecords.AsNoTracking()
            .AnyAsync(x => x.SerialNo == candidate, cancellationToken));

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return candidate;
    }
}

public class CreateWarrantyDto
{
    public string? TransactionType { get; set; }
    public string CustomerCode { get; set; } = string.Empty;
    public string ProductCode { get; set; } = string.Empty;
    public string? SerialNo { get; set; }
    public string? BrandModel { get; set; }
    public string? FaultDescription { get; set; }
    public int WarrantyPeriodMonths { get; set; }
    public decimal GrossAmount { get; set; }
    public decimal DiscountAmount { get; set; }
    public decimal NetAmount { get; set; }
    public decimal VatAmount { get; set; }
    public decimal TotalAmount { get; set; }

    /// <summary>
    /// Tutarların para birimi. Gönderilmezse TL — eski istemciler aynen çalışır.
    /// Ekran bunu <c>product-price</c> uç noktasından gelen kodla doldurur.
    /// </summary>
    public int CurrencyTypeId { get; set; }

    /// <summary>TL kuru; 0/boş gelirse günün kuru çekilir, TL'de daima 1.</summary>
    public decimal CurrencyRate { get; set; }

    public string? SalesmanCode { get; set; }
}

public class UpdateStatusDto
{
    public string Status { get; set; } = string.Empty;
    public string? Description { get; set; }
}
