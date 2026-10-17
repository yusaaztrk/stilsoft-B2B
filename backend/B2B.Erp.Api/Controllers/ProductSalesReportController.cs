using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
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
[Route("api/reports/product-sales")]
[Authorize]
public sealed class ProductSalesReportController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public ProductSalesReportController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet("detailed")]
    [AuthorizePage("reports", "urunSatisRaporuDetayli")]
    public async Task<IActionResult> GetDetailedReport(
        [FromQuery] int? currencyTypeId,
        CancellationToken cancellationToken = default)
    {
        // CARİ KAPSAMI. Rapor satır satır MÜŞTERİ ADI, BİRİM FİYAT ve NET FİYAT gösteriyor;
        // kapsam uygulanmadığında raporu açabilen bir bayi/plasiyer bütün carilerin hangi
        // ürünü kaç liraya aldığını görebiliyordu.
        //
        // `CustomerScope` sözleşmesi gereği BOŞ / '*' / 'ALL' = SINIRSIZ olduğu için iç
        // personel (kapsamı boş olanlar) bu filtreden etkilenmez; yalnız zaten kapsamlı olan
        // hesaplar daralır. Desen `CustomerAgeingReportController`dan alındı.
        List<string>? scopeCodes = null;
        if (!CustomerScope.IsUnrestrictedFor(User))
        {
            var userScopeCodes = CustomerScope.Of(User);
            scopeCodes = await CustomerScope.ExpandAsync(
                _dbContext.Customers.AsNoTracking(), userScopeCodes, cancellationToken);

            if (scopeCodes.Count == 0)
            {
                return Ok(new { success = true, data = Array.Empty<object>(), availableCurrencyTypeIds = Array.Empty<int>() });
            }
        }

        var query =
            from m in _dbContext.StockMovements.AsNoTracking()
            join p in _dbContext.Products.AsNoTracking() on m.StockCode equals p.StockCode
            join c in _dbContext.Customers.AsNoTracking() on m.CustomerCode equals c.CustomerCode into customers
            from customer in customers.DefaultIfEmpty()
            join dc in _dbContext.Customers.AsNoTracking() on m.DeliveryCustomerCode equals dc.CustomerCode into deliveryCustomers
            from deliveryCustomer in deliveryCustomers.DefaultIfEmpty()
            join w in _dbContext.Warehouses.AsNoTracking() on m.WarehouseCode equals w.WarehouseCode into warehouses
            from warehouse in warehouses.DefaultIfEmpty()
            where m.Direction == StockMovementDirection.Out
            // DEPO TRANSFERİ SATIŞ DEĞİLDİR. Transferin çıkış bacağı da `Out` hareketi olduğu
            // için merkezden şubeye gönderilen mal bu raporda satılmış gibi görünüyordu
            // (kapsamı sınırlı kullanıcılarda süzgeç zaten eliyordu; ofis kullanıcısında
            // elemiyordu). Transfer hareketleri açıkça damgalı: `CustomerCode = "TRANSFER"`,
            // `BagNo = "DEPO_TRANSFER"` (WarehouseTransfersController).
            //
            // SAYIM DÜZELTMESİ DE SATIŞ DEĞİLDİR (2026-09-05). Depo sayımında eksik çıkan mal
            // `Out` hareketiyle düşülüyor; damgası `CustomerCode = "SAYIM"`. Elenmezse fiziksel
            // sayım farkı bu raporda satış gibi görünür ve ürün satış rakamlarını şişirir.
            where m.CustomerCode != "TRANSFER" && m.BagNo != "DEPO_TRANSFER"
            where m.CustomerCode != "SAYIM"
            where scopeCodes == null
                  || scopeCodes.Contains(m.CustomerCode)
                  || scopeCodes.Contains(m.DeliveryCustomerCode)
            select new
            {
                Tarih = m.Date,
                FisNo = m.InvoiceNo,
                CustomerCode = m.CustomerCode,
                CustomerName = customer != null ? customer.Name : m.CustomerCode,
                DeliveryCustomerCode = m.DeliveryCustomerCode,
                DeliveryCustomerName = deliveryCustomer != null ? deliveryCustomer.Name : m.DeliveryCustomerCode,
                StockCode = m.StockCode,
                StockName = p.Name,
                MainCategoryId = p.MainCategoryId,
                Quantity = m.Quantity,
                UnitPrice = m.UnitPrice,
                NetUnitPrice = m.NetUnitPrice,
                // HAREKETİN KENDİ PARA BİRİMİ (2026-08-19). `UnitPrice` TL çapasıdır;
                // dolarlı satış TL satıştan ayırt edilebilsin diye hareketin kendi parası
                // ve donmuş kuru da gönderiliyor. Hiçbir yerde çevrim YOK.
                CurrencyTypeId = m.CurrencyTypeId,
                CurrencyRate = m.CurrencyRate,
                CurrencyUnitPrice = m.CurrencyUnitPrice,
                VatRate = m.VatRate,
                WarehouseCode = m.WarehouseCode,
                WarehouseName = warehouse != null ? warehouse.Name : m.WarehouseCode.ToString()
            };

        // ═══════════════════════════════════════════════════════════════════════════
        // PARA BİRİMİ SÜZGECİ (2026-08-19). Hareketin KENDİ para birimine göre süzer;
        // çevrim YOK. Düğme listesi süzgeçten BAĞIMSIZ kapsamdan çıkar — süzgeçten sonra
        // hesaplansaydı USD seçildiği anda diğer düğmeler kaybolur, kullanıcı geri dönemezdi.
        // ═══════════════════════════════════════════════════════════════════════════
        var availableCurrencyTypeIds = await query
            .Select(x => x.CurrencyTypeId)
            .Distinct()
            .ToListAsync(cancellationToken);

        var normalizedAvailableCurrencies = availableCurrencyTypeIds
            .Select(CurrencyTypeHelper.Normalize)
            .Distinct()
            .OrderBy(x => x)
            .ToList();

        var filterCurrencyTypeId = currencyTypeId.HasValue && currencyTypeId.Value > 0
            ? CurrencyTypeHelper.Normalize(currencyTypeId.Value)
            : (int?)null;

        if (filterCurrencyTypeId.HasValue)
        {
            var wanted = filterCurrencyTypeId.Value;
            query = CurrencyTypeHelper.IsTry(wanted)
                ? query.Where(x => x.CurrencyTypeId == 0 || x.CurrencyTypeId == 1)
                : query.Where(x => x.CurrencyTypeId == wanted);
        }

        var rawMovements = await query.ToListAsync(cancellationToken);
        var categories = await _dbContext.ProductCategories.AsNoTracking().ToDictionaryAsync(c => c.Id, c => c.Name, cancellationToken);

        var movements = rawMovements.Select(m => new
        {
            m.Tarih,
            m.FisNo,
            m.CustomerCode,
            m.CustomerName,
            m.DeliveryCustomerCode,
            m.DeliveryCustomerName,
            m.StockCode,
            m.StockName,
            GroupCode = m.MainCategoryId.HasValue && categories.TryGetValue(m.MainCategoryId.Value, out var cName) ? cName : string.Empty,
            m.Quantity,
            m.UnitPrice,
            m.NetUnitPrice,
            ParaBirimi = CurrencyTypeHelper.ToCodeOrTry(m.CurrencyTypeId),
            ParaBirimiTipi = CurrencyTypeHelper.Normalize(m.CurrencyTypeId),
            Kur = m.CurrencyRate <= 0m ? 1m : m.CurrencyRate,
            // Belgenin kendi parasındaki birim fiyat. TL harekette bu ZATEN `UnitPrice`tır;
            // eskiden null dönüyor ve ekran o sütuna 0,00 basıyordu (damgasız eski
            // hareketlerin hepsi böyle görünüyordu). Damga yoksa TL tutara düşülür.
            DovizBirimFiyat = m.CurrencyUnitPrice > 0m ? m.CurrencyUnitPrice : m.UnitPrice,
            m.VatRate,
            m.WarehouseCode,
            m.WarehouseName
        }).ToList();

        return Ok(new
        {
            success = true,
            data = movements,
            // Ekrandaki para birimi düğmeleri bu listeden kurulur (yukarıdaki nota bakınız).
            availableCurrencyTypeIds = normalizedAvailableCurrencies,
            selectedCurrencyTypeId = filterCurrencyTypeId
        });
    }

    [HttpGet("monthly")]
    [AuthorizePage("reports", "urunSatisRaporuAylik")]
    public async Task<IActionResult> GetMonthlyReport([FromQuery] int? year, CancellationToken cancellationToken = default)
    {
        // Kova anahtarında yalnız AY vardı: 2025 Ocak ile 2026 Ocak aynı kovada toplanıyor,
        // rapor iki yılın satışını tek ay gibi gösteriyordu. Şekil bozulmasın diye (ekran 12 ay
        // basıyor) yıl kovaya değil SÜZGECE eklendi; parametre verilmezse içinde bulunulan yıl.
        var targetYear = year is > 0 ? year.Value : B2B.Erp.Api.Core.Helpers.SystemTime.UtcNow.Year;

        List<string>? monthlyScopeCodes = null;
        if (!CustomerScope.IsUnrestrictedFor(User))
        {
            var userScopeCodes = CustomerScope.Of(User);
            monthlyScopeCodes = await CustomerScope.ExpandAsync(
                _dbContext.Customers.AsNoTracking(), userScopeCodes, cancellationToken);

            if (monthlyScopeCodes.Count == 0)
            {
                return Ok(new { success = true, data = new { year = targetYear, items = Array.Empty<object>(), warehouses = Array.Empty<object>() } });
            }
        }

        var query =
            from m in _dbContext.StockMovements.AsNoTracking()
            join p in _dbContext.Products.AsNoTracking() on m.StockCode equals p.StockCode
            join w in _dbContext.Warehouses.AsNoTracking() on m.WarehouseCode equals w.WarehouseCode into warehouses
            from warehouse in warehouses.DefaultIfEmpty()
            where m.Direction == StockMovementDirection.Out && m.Date.Year == targetYear
            // Kardeş yol: detaylı raporda olduğu gibi depo transferleri ve sayım düzeltmeleri
            // satış sayılmaz.
            where m.CustomerCode != "TRANSFER" && m.BagNo != "DEPO_TRANSFER"
            where m.CustomerCode != "SAYIM"
            // Aylık rapor da aynı kapsamdan geçer; depo/ay bazlı çıkış miktarları da
            // rakip tüketim trendini ele veriyordu.
            where monthlyScopeCodes == null
                  || monthlyScopeCodes.Contains(m.CustomerCode)
                  || monthlyScopeCodes.Contains(m.DeliveryCustomerCode)
            group m by new
            {
                m.StockCode,
                StockName = p.Name,
                Month = m.Date.Month,
                m.WarehouseCode,
                WarehouseName = warehouse != null ? warehouse.Name : m.WarehouseCode.ToString()
            } into g
            select new
            {
                StockCode = g.Key.StockCode,
                StockName = g.Key.StockName,
                Month = g.Key.Month,
                WarehouseCode = g.Key.WarehouseCode,
                WarehouseName = g.Key.WarehouseName,
                Quantity = g.Sum(x => x.Quantity)
            };

        var grouped = await query.ToListAsync(cancellationToken);

        var warehousesList = await _dbContext.Warehouses
            .AsNoTracking()
            .Where(x => x.IsActive)
            .Select(x => new { x.WarehouseCode, x.Name })
            .ToListAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            data = new
            {
                year = targetYear,
                items = grouped,
                warehouses = warehousesList
            }
        });
    }
}
