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
public sealed class StockMovementsController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public StockMovementsController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet("report")]
    [AuthorizePage("invoice", "stokHareket")]
    public async Task<IActionResult> Report(
        [FromQuery] string stockCode,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken)
    {
        var sc = (stockCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(sc))
        {
            return BadRequest(new { success = false, message = "Stok kodu zorunludur" });
        }

        DateTime? fromUtc = null;
        if (from.HasValue)
        {
            var d = from.Value.Date;
            fromUtc = DateTime.SpecifyKind(d, DateTimeKind.Utc);
        }

        DateTime? toUtc = null;
        if (to.HasValue)
        {
            var d = to.Value.Date.AddDays(1).AddTicks(-1);
            toUtc = DateTime.SpecifyKind(d, DateTimeKind.Utc);
        }

        var q = _dbContext.Set<StockMovement>()
            .AsNoTracking()
            .Include(x => x.Warehouse)
            .Where(x => x.StockCode == sc);

        if (fromUtc.HasValue)
        {
            q = q.Where(x => x.Date >= fromUtc.Value);
        }

        if (toUtc.HasValue)
        {
            q = q.Where(x => x.Date <= toUtc.Value);
        }

        var movements = await q
            .OrderByDescending(x => x.Date)
            .ThenByDescending(x => x.Id)
            .Select(x => new
            {
                id = x.Id,
                date = x.Date,
                invoiceNo = x.InvoiceNo,
                customerCode = x.CustomerCode,
                deliveryCustomerCode = x.DeliveryCustomerCode,
                bagNo = x.BagNo,
                warehouseCode = x.WarehouseCode,
                warehouseName = x.Warehouse != null ? x.Warehouse.Name : null,
                direction = x.Direction,
                quantity = x.Quantity,
                unitPrice = x.UnitPrice,
                netUnitPrice = x.NetUnitPrice,
                vatRate = x.VatRate,
                lineNo = x.LineNo
            })
            .ToListAsync(cancellationToken);

        // CARİ ADI (2026-10-14): hareket yalnız cari KODUNU taşıyor; dökümde kodun yanında adı da
        // görünsün diye kodlar müşteri, yoksa tedarikçi kartından tek sorguda çözülür.
        var cariCodes = movements
            .SelectMany(x => new[] { x.customerCode, x.deliveryCustomerCode })
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Select(c => c!.Trim())
            .Distinct()
            .ToList();
        var cariNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (cariCodes.Count > 0)
        {
            var customerNames = await _dbContext.Customers.AsNoTracking()
                .Where(c => cariCodes.Contains(c.CustomerCode))
                .Select(c => new { c.CustomerCode, c.Name })
                .ToListAsync(cancellationToken);
            foreach (var c in customerNames)
                if (!string.IsNullOrWhiteSpace(c.Name)) cariNames.TryAdd(c.CustomerCode.Trim(), c.Name.Trim());

            var missing = cariCodes.Where(c => !cariNames.ContainsKey(c)).ToList();
            if (missing.Count > 0)
            {
                var supplierNames = await _dbContext.Suppliers.AsNoTracking()
                    .Where(s => missing.Contains(s.SupplierCode))
                    .Select(s => new { s.SupplierCode, s.FullName })
                    .ToListAsync(cancellationToken);
                foreach (var s in supplierNames)
                    if (!string.IsNullOrWhiteSpace(s.FullName)) cariNames.TryAdd(s.SupplierCode.Trim(), s.FullName.Trim());
            }
        }
        string? NameOf(string? code) =>
            !string.IsNullOrWhiteSpace(code) && cariNames.TryGetValue(code.Trim(), out var n) ? n : null;

        var movementRows = movements.Select(x => new
        {
            x.id,
            x.date,
            x.invoiceNo,
            x.customerCode,
            customerName = NameOf(x.customerCode),
            x.deliveryCustomerCode,
            deliveryCustomerName = NameOf(x.deliveryCustomerCode),
            x.bagNo,
            x.warehouseCode,
            x.warehouseName,
            x.direction,
            x.quantity,
            x.unitPrice,
            x.netUnitPrice,
            x.vatRate,
            x.lineNo
        }).ToList();

        // DEVİR: başlangıç tarihinden önceki net stok, DEPO BAZINDA.
        //
        // Özetteki "bakiye" yalnız seçilen aralığın giriş/çıkış farkıydı: geçen aydan devreden
        // stok hiç sayılmadığı için, ay içinde yalnız çıkış görmüş bir ürün depoda dururken
        // ekranda eksi bakiye görünüyordu. Tarih verilmediğinde devir yok — dönem zaten tüm
        // geçmişi kapsıyor. (Aynı düzeltme depo envanteri ve muhasebe stok raporunda da yapıldı.)
        var openingByWarehouse = new Dictionary<int, decimal>();
        if (fromUtc.HasValue)
        {
            var openingRows = await _dbContext.Set<StockMovement>()
                .AsNoTracking()
                .Where(x => x.StockCode == sc && x.Date < fromUtc.Value)
                .GroupBy(x => x.WarehouseCode)
                .Select(g => new
                {
                    warehouseCode = g.Key,
                    inQty = g.Where(x => x.Direction == StockMovementDirection.In).Sum(x => x.Quantity),
                    outQty = g.Where(x => x.Direction == StockMovementDirection.Out).Sum(x => x.Quantity)
                })
                .ToListAsync(cancellationToken);

            openingByWarehouse = openingRows.ToDictionary(x => x.warehouseCode, x => x.inQty - x.outQty);
        }

        var summary = movements
            .GroupBy(x => new { x.warehouseCode, x.warehouseName })
            .Select(g => new
            {
                warehouseCode = g.Key.warehouseCode,
                warehouseName = g.Key.warehouseName,
                totalIn = g.Where(x => x.direction == StockMovementDirection.In).Sum(x => x.quantity),
                totalOut = g.Where(x => x.direction == StockMovementDirection.Out).Sum(x => x.quantity),
                openingBalance = openingByWarehouse.TryGetValue(g.Key.warehouseCode, out var op) ? op : 0m,
                balance = (openingByWarehouse.TryGetValue(g.Key.warehouseCode, out var op2) ? op2 : 0m)
                          + g.Where(x => x.direction == StockMovementDirection.In).Sum(x => x.quantity)
                          - g.Where(x => x.direction == StockMovementDirection.Out).Sum(x => x.quantity)
            })
            .OrderBy(x => x.warehouseCode)
            .ToList();

        var totals = new
        {
            totalIn = summary.Sum(x => x.totalIn),
            totalOut = summary.Sum(x => x.totalOut),
            openingBalance = summary.Sum(x => x.openingBalance),
            balance = summary.Sum(x => x.balance)
        };

        return Ok(new { success = true, data = new { stockCode = sc, from = fromUtc, to = toUtc, summary, movements = movementRows, totals } });
    }
}
