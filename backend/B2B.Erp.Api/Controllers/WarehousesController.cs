using B2B.Erp.Api.Core.Helpers;
using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class WarehousesController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public WarehousesController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet("low-stock")]
    [AuthorizePage("users", "depolar")]
    public async Task<IActionResult> LowStock(
        [FromQuery] int take = 50,
        CancellationToken cancellationToken = default)
    {
        take = Math.Max(1, Math.Min(200, take));

        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";

        List<int> allowedWarehouseCodes;
        if (isSuperAdmin)
        {
            allowedWarehouseCodes = await _dbContext.Set<Warehouse>()
                .AsNoTracking()
                .Where(x => x.IsActive)
                .OrderBy(x => x.WarehouseCode)
                .Select(x => x.WarehouseCode)
                .ToListAsync(cancellationToken);
        }
        else
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!int.TryParse(userIdClaim, out var userId) || userId <= 0)
            {
                return Ok(new { success = true, data = new { items = Array.Empty<object>() } });
            }

            allowedWarehouseCodes = await _dbContext.UserWarehouses
                .AsNoTracking()
                .Where(x => x.UserId == userId)
                .Select(x => x.WarehouseCode)
                .Distinct()
                .ToListAsync(cancellationToken);

            if (allowedWarehouseCodes.Count == 0)
            {
                return Ok(new { success = true, data = new { items = Array.Empty<object>() } });
            }
        }

        var products = await _dbContext.Products
            .AsNoTracking()
            .Where(x => x.IsActive)
            .Select(x => new { x.StockCode, x.Name, x.MinStock })
            .ToListAsync(cancellationToken);

        var productByStockCode = products
            .Where(x => !string.IsNullOrWhiteSpace(x.StockCode))
            .GroupBy(x => x.StockCode)
            .ToDictionary(x => x.Key, x => new { x.First().Name, x.First().MinStock }, StringComparer.OrdinalIgnoreCase);

        var warehouses = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .Where(x => x.IsActive && allowedWarehouseCodes.Contains(x.WarehouseCode))
            .Select(x => new { x.WarehouseCode, x.Name })
            .ToListAsync(cancellationToken);

        var whNameByCode = warehouses.ToDictionary(x => x.WarehouseCode, x => x.Name);

        var balances = await _dbContext.Set<StockMovement>()
            .AsNoTracking()
            .Where(x => allowedWarehouseCodes.Contains(x.WarehouseCode))
            .GroupBy(x => new { x.WarehouseCode, x.StockCode })
            .Select(g => new
            {
                g.Key.WarehouseCode,
                g.Key.StockCode,
                InQty = g.Where(x => x.Direction == StockMovementDirection.In).Sum(x => x.Quantity),
                OutQty = g.Where(x => x.Direction == StockMovementDirection.Out).Sum(x => x.Quantity)
            })
            .ToListAsync(cancellationToken);

        var items = balances
            .Select(x =>
            {
                var stockCode = (x.StockCode ?? string.Empty).Trim();
                var balance = x.InQty - x.OutQty;
                var meta = productByStockCode.TryGetValue(stockCode, out var m) ? m : null;
                var minStock = meta?.MinStock ?? 0;
                return new
                {
                    warehouseCode = x.WarehouseCode,
                    warehouseName = whNameByCode.TryGetValue(x.WarehouseCode, out var wn) ? wn : null,
                    stockCode,
                    stockName = meta?.Name,
                    balance,
                    minStock
                };
            })
            .Where(x => x.minStock > 0 && x.balance <= x.minStock)
            .OrderBy(x => x.warehouseCode)
            .ThenBy(x => x.stockCode)
            .Take(take)
            .ToList();

        return Ok(new { success = true, data = new { items } });
    }

    [HttpGet]
    [AuthorizePage("users", "depolar")]
    public async Task<IActionResult> List([FromQuery] bool includeInactive = false, CancellationToken cancellationToken = default)
    {
        var q = _dbContext.Set<Warehouse>().AsNoTracking();
        if (!includeInactive)
        {
            q = q.Where(x => x.IsActive);
        }

        var data = await q
            .OrderBy(x => x.WarehouseCode)
            .Select(x => new
            {
                warehouseCode = x.WarehouseCode,
                name = x.Name,
                salesmanCode = x.SalesmanCode,
                isVehicle = x.IsVehicle,
                plate = x.Plate,
                driverName = x.DriverName,
                vehicleType = x.VehicleType,
                vehicleModel = x.VehicleModel,
                negativeBalanceControl = x.NegativeBalanceControl,
                isActive = x.IsActive
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [HttpGet("authorized-stock-balances")]
    [AuthorizePage("invoice", "satisFatura")]
    [AuthorizePage("invoice", "proforma")]
    public async Task<IActionResult> AuthorizedStockBalances(
        [FromQuery] string? stockCodes,
        [FromQuery] bool includeAll = false,
        CancellationToken cancellationToken = default)
    {
        var codes = (stockCodes ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(x => x.Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(200)
            .ToList();

        if (codes.Count == 0)
        {
            return Ok(new { success = true, data = new { warehouses = Array.Empty<object>(), items = Array.Empty<object>() } });
        }

        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var hasStockInfoPermission = isSuperAdmin;
        if (!isSuperAdmin)
        {
            var roleIdStr = User.FindFirst("RoleId")?.Value;
            if (int.TryParse(roleIdStr, out var roleId))
            {
                hasStockInfoPermission = await _dbContext.RolePagePermissions
                    .AsNoTracking()
                    .AnyAsync(rpp => rpp.RoleId == roleId && rpp.CanAccess && rpp.Page.Key == "satisFaturaDepoBakiyeGorsun", cancellationToken);
            }
        }

        /*
          TAM KIRILIM (includeAll=true).

          Varsayılan davranış: yalnız AKTİF + yetkili depolar, bakiye 0 altına kırpılır ve
          yetkisiz kullanıcıda 12 üstü "13" olarak maskelenir (bayiden gerçek stoğu saklamak
          için — bu kasıtlı, DEĞİŞMEDİ).

          Toplu Fiyat Atama'daki "Depo Stok Dağılımı" penceresi bir yönetim aracı: orada
          kırılımın ürün kartındaki toplamla bire bir oturması gerekiyor. `includeAll=true`
          YALNIZ tam stok yetkisi olan kullanıcıda (SuperAdmin ya da satisFaturaDepoBakiyeGorsun)
          etkili olur; pasif depoları da, negatif bakiyeyi de, gerçek rakamı da gösterir.
        */
        var showEverything = includeAll && hasStockInfoPermission;

        List<int> allowedWarehouseCodes;
        if (isSuperAdmin || showEverything)
        {
            allowedWarehouseCodes = await _dbContext.Set<Warehouse>()
                .AsNoTracking()
                .Where(x => showEverything || x.IsActive)
                .OrderBy(x => x.WarehouseCode)
                .Select(x => x.WarehouseCode)
                .ToListAsync(cancellationToken);
        }
        else
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!int.TryParse(userIdClaim, out var userId) || userId <= 0)
            {
                return Ok(new { success = true, data = new { warehouses = Array.Empty<object>(), items = Array.Empty<object>() } });
            }

            allowedWarehouseCodes = await _dbContext.UserWarehouses
                .AsNoTracking()
                .Where(x => x.UserId == userId)
                .Select(x => x.WarehouseCode)
                .Distinct()
                .ToListAsync(cancellationToken);

            if (allowedWarehouseCodes.Count == 0)
            {
                return Ok(new { success = true, data = new { warehouses = Array.Empty<object>(), items = Array.Empty<object>() } });
            }
        }

        var warehouses = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .Where(x => (showEverything || x.IsActive) && allowedWarehouseCodes.Contains(x.WarehouseCode))
            .OrderBy(x => x.WarehouseCode)
            .Select(x => new { warehouseCode = x.WarehouseCode, name = x.Name, isActive = x.IsActive })
            .ToListAsync(cancellationToken);

        var balances = await _dbContext.Set<StockMovement>()
            .AsNoTracking()
            .Where(x => allowedWarehouseCodes.Contains(x.WarehouseCode) && codes.Contains(x.StockCode))
            .GroupBy(x => new { x.WarehouseCode, x.StockCode })
            .Select(g => new
            {
                g.Key.WarehouseCode,
                g.Key.StockCode,
                InQty = g.Where(x => x.Direction == StockMovementDirection.In).Sum(x => x.Quantity),
                OutQty = g.Where(x => x.Direction == StockMovementDirection.Out).Sum(x => x.Quantity)
            })
            .ToListAsync(cancellationToken);

        var balanceMap = balances
            .GroupBy(x => x.StockCode, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => g.ToDictionary(x => x.WarehouseCode, x => x.InQty - x.OutQty),
                StringComparer.OrdinalIgnoreCase);

        var items = codes.Select(sc =>
        {
            var stockBalances = balanceMap.TryGetValue(sc, out var m) ? m : null;
            return new
            {
                stockCode = sc,
                // Tüm depoların (pasif dahil) ham net toplamı — kırpma/maske yok. Yalnız tam
                // kırılımda döner; kısıtlı kullanıcıya gerçek toplamı sızdırmaz.
                trueTotal = showEverything && stockBalances is not null
                    ? (decimal?)stockBalances.Values.Sum()
                    : null,
                balances = warehouses.Select(w =>
                {
                    var raw = stockBalances is not null && stockBalances.TryGetValue(w.warehouseCode, out var b) ? b : 0m;
                    decimal finalBalance;
                    if (showEverything)
                        finalBalance = raw; // gerçek rakam, negatif olabilir
                    else if (hasStockInfoPermission)
                        finalBalance = Math.Max(0m, raw);
                    else
                        finalBalance = Math.Max(0m, raw) > 12m ? 13m : Math.Max(0m, raw);

                    return new
                    {
                        warehouseCode = w.warehouseCode,
                        balance = finalBalance
                    };
                })
            };
        });

        return Ok(new { success = true, data = new { warehouses, items } });
    }

    [HttpGet("authorized-dropdown")]
    [AuthorizePage("invoice", "satisFatura")]
    [AuthorizePage("invoice", "proforma")]
    public async Task<IActionResult> AuthorizedDropdown(CancellationToken cancellationToken = default)
    {
        /*
          VARSAYILAN DEPO İŞARETLİ VE EN BAŞTA (2026-09-27).

          Liste yalnız koda göre sıralıydı ve arayüz birden fazla depoda `[0]`'ı seçiyordu:
          en küçük kod `-21 YP SİPARİŞ` olduğu için proformadan faturaya aktarımda stok
          kullanılmayan bu depodan düşüyordu (DEMO_CANLI). Kullanıcının `DefaultWarehouseCode`'u
          artık `isDefault` ile işaretleniyor; arayüz varsayılan yoksa depoyu SEÇTİRİYOR.
        */
        var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        int.TryParse(userIdClaim, out var userId);
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var isSuperSuperAdmin = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";

        // SSA'nın kiracı `Users` satırı yok: varsayılanı `/auth/me` ile AYNI yoldan, depo adıyla
        // (HASPOLAT) çözülür. Diğer herkes `Users.DefaultWarehouseCode`.
        var defaultCode = isSuperSuperAdmin
            ? await PrivilegedDefaultWarehouse.ResolveAsync(_dbContext, cancellationToken)
            : userId > 0
                ? await _dbContext.Users.AsNoTracking()
                    .Where(x => x.Id == userId)
                    .Select(x => x.DefaultWarehouseCode)
                    .FirstOrDefaultAsync(cancellationToken)
                : null;
        if (isSuperAdmin || isSuperSuperAdmin)
        {
            var all = await _dbContext.Set<Warehouse>()
                .AsNoTracking()
                .Where(x => x.IsActive)
                .OrderByDescending(x => x.WarehouseCode == defaultCode)
                .ThenBy(x => x.WarehouseCode)
                .Select(x => new { warehouseCode = x.WarehouseCode, name = x.Name, isDefault = x.WarehouseCode == defaultCode })
                .ToListAsync(cancellationToken);

            return Ok(new { success = true, data = all });
        }

        if (userId <= 0)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var allowedCodes = await _dbContext.UserWarehouses
            .AsNoTracking()
            .Where(x => x.UserId == userId)
            .Select(x => x.WarehouseCode)
            .Distinct()
            .ToListAsync(cancellationToken);

        if (allowedCodes.Count == 0)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var data = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .Where(x => x.IsActive && allowedCodes.Contains(x.WarehouseCode))
            .OrderByDescending(x => x.WarehouseCode == defaultCode)
            .ThenBy(x => x.WarehouseCode)
            .Select(x => new { warehouseCode = x.WarehouseCode, name = x.Name, isDefault = x.WarehouseCode == defaultCode })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [HttpGet("dropdown-for-stock")]
    [AuthorizePage("invoice", "depoStock")]
    public async Task<IActionResult> DropdownForStock(CancellationToken cancellationToken = default)
    {
        var data = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.WarehouseCode)
            .Select(x => new
            {
                warehouseCode = x.WarehouseCode,
                name = x.Name
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    /// <summary>
    /// Başlangıç tarihinden ÖNCEKİ net stok (devir), stok kodu başına.
    ///
    /// Tarih filtresi verilmediğinde boş sözlük döner — o durumda dönem içi hareketlerin farkı
    /// zaten tüm geçmişi kapsıyor ve ayrıca devir eklemek stoğu ikiye katlardı.
    /// </summary>
    private async Task<Dictionary<string, decimal>> GetOpeningBalancesAsync(
        int warehouseCode,
        DateTime? fromUtc,
        CancellationToken cancellationToken)
    {
        if (!fromUtc.HasValue) return new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);

        var rows = await _dbContext.Set<StockMovement>()
            .AsNoTracking()
            .Where(x => x.WarehouseCode == warehouseCode && x.Date < fromUtc.Value)
            .GroupBy(x => x.StockCode)
            .Select(g => new
            {
                stockCode = g.Key,
                inQty = g.Where(x => x.Direction == StockMovementDirection.In).Sum(x => x.Quantity),
                outQty = g.Where(x => x.Direction == StockMovementDirection.Out).Sum(x => x.Quantity)
            })
            .ToListAsync(cancellationToken);

        return rows.ToDictionary(x => x.stockCode, x => x.inQty - x.outQty, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// NEGATİF DEPO KODU GEÇERLİDİR — bu dosyadaki bütün kod kontrolleri bu yüzden `== 0`.
    ///
    /// Eskiden `<= 0` reddediliyordu, ama kaynak ERP sipariş/sanal depolarını negatif kodla
    /// tutuyor: DEMOTEST'te `-20 SİPARİŞ` ve `-21 YP SİPARİŞ` **aktif** depolar. Sonuç,
    /// API'nin kendi listelediği depoyu kendisinin reddetmesiydi: `my-warehouses` -21'i
    /// döndürüyor, ekran onu seçiyor, envanter ucu "Geçersiz depo kodu" diye 400 veriyordu
    /// (Teknisyen Deposu sayfasındaki konsol hatası buydu). Sıfır hâlâ reddedilir: o "kod
    /// atanmamış" demek. Asıl doğrulama zaten hemen altındaki `Warehouses` varlık kontrolü.
    /// </summary>
    [HttpGet("{warehouseCode:int}/inventory")]
    [AuthorizePage("users", "depolar")]
    public async Task<IActionResult> Inventory(
        [FromRoute] int warehouseCode,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? q,
        CancellationToken cancellationToken)
    {
        if (warehouseCode == 0) return BadRequest(new { success = false, message = "Geçersiz depo kodu" });

        var exists = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .AnyAsync(x => x.WarehouseCode == warehouseCode, cancellationToken);

        if (!exists) return NotFound(new { success = false, message = "Depo bulunamadı" });

        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        if (!isSuperAdmin)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!int.TryParse(userIdClaim, out var userId) || userId <= 0)
            {
                return BadRequest(new { success = false, message = "Kullanıcı bulunamadı" });
            }

            var allowed = await _dbContext.UserWarehouses
                .AsNoTracking()
                .AnyAsync(x => x.UserId == userId && x.WarehouseCode == warehouseCode, cancellationToken);

            if (!allowed)
            {
                return BadRequest(new { success = false, message = "Bu depo için yetkiniz yok" });
            }
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

        var movQ = _dbContext.Set<StockMovement>()
            .AsNoTracking()
            .Where(x => x.WarehouseCode == warehouseCode);

        if (fromUtc.HasValue) movQ = movQ.Where(x => x.Date >= fromUtc.Value);
        if (toUtc.HasValue) movQ = movQ.Where(x => x.Date <= toUtc.Value);

        var grouped = movQ
            .GroupBy(x => x.StockCode)
            .Select(g => new
            {
                stockCode = g.Key,
                totalIn = g.Where(x => x.Direction == StockMovementDirection.In).Sum(x => x.Quantity),
                totalOut = g.Where(x => x.Direction == StockMovementDirection.Out).Sum(x => x.Quantity)
            });

        var list = await grouped.ToListAsync(cancellationToken);
        var stockCodes = list.Select(x => x.stockCode).Distinct().ToList();

        var opening = await GetOpeningBalancesAsync(warehouseCode, fromUtc, cancellationToken);

        var products = await _dbContext.Products
            .AsNoTracking()
            .Where(x => stockCodes.Contains(x.StockCode))
            .Select(x => new { x.StockCode, x.Name, x.MinStock })
            .ToListAsync(cancellationToken);

        var productByCode = products
            .GroupBy(x => x.StockCode)
            .ToDictionary(x => x.Key, x => new { x.First().Name, x.First().MinStock });

        var query = string.IsNullOrWhiteSpace(q) ? null : q.Trim().ToLowerInvariant();

        var data = list
            .Select(x => new
            {
                stockCode = x.stockCode,
                stockName = productByCode.TryGetValue(x.stockCode, out var meta) ? meta.Name : null,
                minStock = productByCode.TryGetValue(x.stockCode, out var meta2) ? meta2.MinStock : 0,
                totalIn = x.totalIn,
                totalOut = x.totalOut,
                // BAKİYE DEVİRLE BİRLİKTE. Dönem içi giriş/çıkış farkı bakiye DEĞİLDİR: başlangıç
                // tarihi seçildiğinde depoda zaten duran stok hesaba katılmıyor, ay içinde yalnız
                // çıkış görmüş bir ürün rafta 450 adet dururken raporda "−50" görünüyordu.
                openingBalance = opening.TryGetValue(x.stockCode, out var op) ? op : 0m,
                balance = (opening.TryGetValue(x.stockCode, out var op2) ? op2 : 0m) + x.totalIn - x.totalOut
            })
            .Where(x => query == null
                        || (x.stockCode ?? string.Empty).ToLowerInvariant().Contains(query)
                        || (x.stockName ?? string.Empty).ToLowerInvariant().Contains(query))
            .OrderBy(x => x.stockCode)
            .ToList();

        var totals = new
        {
            totalIn = data.Sum(x => x.totalIn),
            totalOut = data.Sum(x => x.totalOut),
            openingBalance = data.Sum(x => x.openingBalance),
            balance = data.Sum(x => x.balance)
        };

        return Ok(new { success = true, data = new { warehouseCode, from = fromUtc, to = toUtc, items = data, totals } });
    }

    [HttpGet("{warehouseCode:int}/inventory-for-stock")]
    [AuthorizePage("invoice", "depoStock")]
    public async Task<IActionResult> InventoryForStock(
        [FromRoute] int warehouseCode,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] string? q,
        CancellationToken cancellationToken)
    {
        if (warehouseCode == 0) return BadRequest(new { success = false, message = "Geçersiz depo kodu" });

        var exists = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .AnyAsync(x => x.WarehouseCode == warehouseCode, cancellationToken);

        if (!exists) return NotFound(new { success = false, message = "Depo bulunamadı" });

        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        if (!isSuperAdmin)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!int.TryParse(userIdClaim, out var userId) || userId <= 0)
            {
                return BadRequest(new { success = false, message = "Kullanıcı bulunamadı" });
            }

            var allowed = await _dbContext.UserWarehouses
                .AsNoTracking()
                .AnyAsync(x => x.UserId == userId && x.WarehouseCode == warehouseCode, cancellationToken);

            if (!allowed)
            {
                return BadRequest(new { success = false, message = "Bu depo için yetkiniz yok" });
            }
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

        var movQ = _dbContext.Set<StockMovement>()
            .AsNoTracking()
            .Where(x => x.WarehouseCode == warehouseCode);

        if (fromUtc.HasValue) movQ = movQ.Where(x => x.Date >= fromUtc.Value);
        if (toUtc.HasValue) movQ = movQ.Where(x => x.Date <= toUtc.Value);

        var grouped = movQ
            .GroupBy(x => x.StockCode)
            .Select(g => new
            {
                stockCode = g.Key,
                totalIn = g.Where(x => x.Direction == StockMovementDirection.In).Sum(x => x.Quantity),
                totalOut = g.Where(x => x.Direction == StockMovementDirection.Out).Sum(x => x.Quantity)
            });

        var list = await grouped.ToListAsync(cancellationToken);
        var stockCodes = list.Select(x => x.stockCode).Distinct().ToList();

        var opening = await GetOpeningBalancesAsync(warehouseCode, fromUtc, cancellationToken);

        var products = await _dbContext.Products
            .AsNoTracking()
            .Where(x => stockCodes.Contains(x.StockCode))
            .Select(x => new { x.StockCode, x.Name, x.MinStock })
            .ToListAsync(cancellationToken);

        var productByCode = products
            .GroupBy(x => x.StockCode)
            .ToDictionary(x => x.Key, x => new { x.First().Name, x.First().MinStock });

        var query = string.IsNullOrWhiteSpace(q) ? null : q.Trim().ToLowerInvariant();

        var data = list
            .Select(x => new
            {
                stockCode = x.stockCode,
                stockName = productByCode.TryGetValue(x.stockCode, out var meta) ? meta.Name : null,
                minStock = productByCode.TryGetValue(x.stockCode, out var meta2) ? meta2.MinStock : 0,
                totalIn = x.totalIn,
                totalOut = x.totalOut,
                // BAKİYE DEVİRLE BİRLİKTE. Dönem içi giriş/çıkış farkı bakiye DEĞİLDİR: başlangıç
                // tarihi seçildiğinde depoda zaten duran stok hesaba katılmıyor, ay içinde yalnız
                // çıkış görmüş bir ürün rafta 450 adet dururken raporda "−50" görünüyordu.
                openingBalance = opening.TryGetValue(x.stockCode, out var op) ? op : 0m,
                balance = (opening.TryGetValue(x.stockCode, out var op2) ? op2 : 0m) + x.totalIn - x.totalOut
            })
            .Where(x => query == null
                        || (x.stockCode ?? string.Empty).ToLowerInvariant().Contains(query)
                        || (x.stockName ?? string.Empty).ToLowerInvariant().Contains(query))
            .OrderBy(x => x.stockCode)
            .ToList();

        var totals = new
        {
            totalIn = data.Sum(x => x.totalIn),
            totalOut = data.Sum(x => x.totalOut),
            openingBalance = data.Sum(x => x.openingBalance),
            balance = data.Sum(x => x.balance)
        };

        return Ok(new { success = true, data = new { warehouseCode, from = fromUtc, to = toUtc, items = data, totals } });
    }

    [HttpGet("{warehouseCode:int}/movements")]
    [AuthorizePage("users", "depolar")]
    public async Task<IActionResult> Movements(
        [FromRoute] int warehouseCode,
        [FromQuery] string? stockCode,
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        [FromQuery] int take = 200,
        [FromQuery] int skip = 0,
        CancellationToken cancellationToken = default)
    {
        if (warehouseCode == 0) return BadRequest(new { success = false, message = "Geçersiz depo kodu" });
        take = Math.Max(1, Math.Min(1000, take));
        // Sayfalı okuma (2026-10-08): depo detayı son 200 hareketi gösteriyordu; ekran artık skip ile hepsini çekiyor.
        skip = Math.Max(0, skip);

        var exists = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .AnyAsync(x => x.WarehouseCode == warehouseCode, cancellationToken);

        if (!exists) return NotFound(new { success = false, message = "Depo bulunamadı" });

        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        if (!isSuperAdmin)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!int.TryParse(userIdClaim, out var userId) || userId <= 0)
            {
                return BadRequest(new { success = false, message = "Kullanıcı bulunamadı" });
            }

            var allowed = await _dbContext.UserWarehouses
                .AsNoTracking()
                .AnyAsync(x => x.UserId == userId && x.WarehouseCode == warehouseCode, cancellationToken);

            if (!allowed)
            {
                return BadRequest(new { success = false, message = "Bu depo için yetkiniz yok" });
            }
        }

        var sc = string.IsNullOrWhiteSpace(stockCode) ? null : stockCode.Trim();

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

        var qMov = _dbContext.Set<StockMovement>()
            .AsNoTracking()
            .Where(x => x.WarehouseCode == warehouseCode);

        if (sc != null) qMov = qMov.Where(x => x.StockCode == sc);
        if (fromUtc.HasValue) qMov = qMov.Where(x => x.Date >= fromUtc.Value);
        if (toUtc.HasValue) qMov = qMov.Where(x => x.Date <= toUtc.Value);

        var items = await qMov
            .OrderByDescending(x => x.Date)
            .ThenByDescending(x => x.Id)
            .Skip(skip).Take(take)
            .Select(x => new
            {
                id = x.Id,
                date = x.Date,
                invoiceNo = x.InvoiceNo,
                customerCode = x.CustomerCode,
                deliveryCustomerCode = x.DeliveryCustomerCode,
                stockCode = x.StockCode,
                direction = ((char)x.Direction).ToString(),
                quantity = x.Quantity,
                netUnitPrice = x.NetUnitPrice,
                vatRate = x.VatRate,
                bagNo = x.BagNo,
                lineNo = x.LineNo
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data = new { warehouseCode, stockCode = sc, from = fromUtc, to = toUtc, items } });
    }

    [HttpGet("dropdown")]
    [Authorize]
    public async Task<IActionResult> Dropdown(CancellationToken cancellationToken = default)
    {
        var data = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.WarehouseCode)
            .Select(x => new
            {
                warehouseCode = x.WarehouseCode,
                name = x.Name,
                // Teknisyenin ARAÇ DEPOSU seçicisi yalnızca araç depolarını listeleyebilsin diye
                // gerekli: araç olmayan bir depo seçilirse doğrudan satış ucu ("araç deposu
                // değildir") reddediyor ve hata ancak fatura anında görülüyordu.
                isVehicle = x.IsVehicle
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    public sealed class UpsertWarehouseRequest
    {
        [Required]
        public int WarehouseCode { get; set; }

        [StringLength(255)]
        public string? Name { get; set; }

        [StringLength(50)]
        public string? SalesmanCode { get; set; }

        public bool IsVehicle { get; set; }

        [StringLength(30)]
        public string? Plate { get; set; }

        [StringLength(100)]
        public string? DriverName { get; set; }

        [StringLength(50)]
        public string? VehicleType { get; set; }

        [StringLength(100)]
        public string? VehicleModel { get; set; }

        public bool NegativeBalanceControl { get; set; }

        public bool IsActive { get; set; } = true;
    }

    [HttpPost]
    [AuthorizePage("users", "depolar")]
    public async Task<IActionResult> Create([FromBody] UpsertWarehouseRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        if (request.WarehouseCode <= 0)
        {
            ModelState.AddModelError(nameof(request.WarehouseCode), "WarehouseCode must be > 0.");
            return ValidationProblem(ModelState);
        }

        var exists = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .AnyAsync(x => x.WarehouseCode == request.WarehouseCode, cancellationToken);

        if (exists)
        {
            return Conflict(new { success = false, message = "Depo kodu zaten var" });
        }

        if (request.IsVehicle && string.IsNullOrWhiteSpace(request.Plate))
        {
            ModelState.AddModelError(nameof(request.Plate), "Plaka zorunludur.");
            return ValidationProblem(ModelState);
        }

        var username = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        var entity = new Warehouse
        {
            WarehouseCode = request.WarehouseCode,
            Name = string.IsNullOrWhiteSpace(request.Name) ? null : request.Name.Trim(),
            SalesmanCode = string.IsNullOrWhiteSpace(request.SalesmanCode) ? null : request.SalesmanCode.Trim(),
            IsVehicle = request.IsVehicle,
            Plate = string.IsNullOrWhiteSpace(request.Plate) ? null : request.Plate.Trim(),
            DriverName = string.IsNullOrWhiteSpace(request.DriverName) ? null : request.DriverName.Trim(),
            VehicleType = string.IsNullOrWhiteSpace(request.VehicleType) ? null : request.VehicleType.Trim(),
            VehicleModel = string.IsNullOrWhiteSpace(request.VehicleModel) ? null : request.VehicleModel.Trim(),
            NegativeBalanceControl = request.NegativeBalanceControl,
            IsActive = request.IsActive,
            CreateUser = username,
            CreateTime = now
        };

        _dbContext.Set<Warehouse>().Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new { warehouseCode = entity.WarehouseCode } });
    }

    [HttpPut("{warehouseCode:int}")]
    [AuthorizePage("users", "depolar")]
    public async Task<IActionResult> Update([FromRoute] int warehouseCode, [FromBody] UpsertWarehouseRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        if (warehouseCode == 0) return BadRequest(new { success = false, message = "Geçersiz depo kodu" });

        var entity = await _dbContext.Set<Warehouse>()
            .FirstOrDefaultAsync(x => x.WarehouseCode == warehouseCode, cancellationToken);

        if (entity is null)
        {
            return NotFound(new { success = false, message = "Depo bulunamadı" });
        }

        if (request.IsVehicle && string.IsNullOrWhiteSpace(request.Plate))
        {
            ModelState.AddModelError(nameof(request.Plate), "Plaka zorunludur.");
            return ValidationProblem(ModelState);
        }

        var username = User.Identity?.Name ?? "System";
        var now = DateTime.UtcNow;

        entity.Name = string.IsNullOrWhiteSpace(request.Name) ? null : request.Name.Trim();
        entity.SalesmanCode = string.IsNullOrWhiteSpace(request.SalesmanCode) ? null : request.SalesmanCode.Trim();
        entity.IsVehicle = request.IsVehicle;
        entity.Plate = string.IsNullOrWhiteSpace(request.Plate) ? null : request.Plate.Trim();
        entity.DriverName = string.IsNullOrWhiteSpace(request.DriverName) ? null : request.DriverName.Trim();
        entity.VehicleType = string.IsNullOrWhiteSpace(request.VehicleType) ? null : request.VehicleType.Trim();
        entity.VehicleModel = string.IsNullOrWhiteSpace(request.VehicleModel) ? null : request.VehicleModel.Trim();
        entity.NegativeBalanceControl = request.NegativeBalanceControl;
        entity.IsActive = request.IsActive;
        entity.EditUser = username;
        entity.EditTime = now;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpDelete("{warehouseCode:int}")]
    [AuthorizePage("users", "depolar")]
    public async Task<IActionResult> Delete([FromRoute] int warehouseCode, CancellationToken cancellationToken)
    {
        if (warehouseCode == 0) return BadRequest(new { success = false, message = "Geçersiz depo kodu" });

        var entity = await _dbContext.Set<Warehouse>()
            .FirstOrDefaultAsync(x => x.WarehouseCode == warehouseCode, cancellationToken);

        if (entity is null)
        {
            return NotFound(new { success = false, message = "Depo bulunamadı" });
        }

        var username = User.Identity?.Name ?? "System";
        entity.IsActive = false;
        entity.EditUser = username;
        entity.EditTime = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }
}
