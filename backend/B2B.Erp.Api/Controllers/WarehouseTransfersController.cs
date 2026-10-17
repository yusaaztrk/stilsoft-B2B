using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.WarehouseTransfers;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class WarehouseTransfersController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly B2B.Erp.Api.Features.Currency.ICurrencyRateService _money;

    public WarehouseTransfersController(
        AppDbContext dbContext,
        B2B.Erp.Api.Features.Currency.ICurrencyRateService money)
    {
        _dbContext = dbContext;
        _money = money;
    }

    /// <summary>
    /// Transfer edilen malın TL birim maliyeti (stok kodu → TL fiyat).
    ///
    /// <para>
    /// Transferin iki bacağı da <c>UnitPrice = 0</c> ile yazılıyordu: mal kaynak depodan
    /// 0 ₺ değerle çıkıp hedef depoya 0 ₺ değerle giriyor, dolayısıyla DEPO BAZLI envanter
    /// değerlemesi bozuluyordu (çıkan deponun değeri azalmıyor, girenin artmıyor).
    /// </para>
    ///
    /// <para>
    /// Maliyet ürünün alış fiyatından, ürünün ALIŞ para birimi kuruyla TL'ye çevrilerek
    /// alınır — açılış stoğundaki (<c>ProductsController</c>) kuralın aynısı.
    /// <c>StockMovement</c>'ta para birimi kolonu yok, tasarım gereği TL taşır.
    /// </para>
    /// </summary>
    /// <summary>
    /// Stok kodu -> urun adi. Kodu bulunmayan urun sozlukte yer almaz; cagiran taraf bos ada duser.
    /// </summary>
    private async Task<Dictionary<string, string>> ResolveStockNamesAsync(
        IReadOnlyCollection<string> stockCodes,
        CancellationToken cancellationToken)
    {
        var distinct = stockCodes
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (distinct.Count == 0) return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        var products = await _dbContext.Products
            .AsNoTracking()
            .Where(p => distinct.Contains(p.StockCode))
            .Select(p => new { p.StockCode, p.Name })
            .ToListAsync(cancellationToken);

        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var p in products) result[p.StockCode] = p.Name ?? string.Empty;
        return result;
    }

    private async Task<Dictionary<string, decimal>> ResolveTransferUnitCostsAsync(
        IReadOnlyCollection<string> stockCodes,
        CancellationToken cancellationToken)
    {
        var result = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        if (stockCodes.Count == 0) return result;

        var products = await _dbContext.Products
            .AsNoTracking()
            .Where(p => stockCodes.Contains(p.StockCode))
            .Select(p => new { p.StockCode, p.PurchasePrice, p.CurrencyCode })
            .ToListAsync(cancellationToken);

        var rateByCurrency = new Dictionary<int, decimal>();
        foreach (var p in products)
        {
            var currencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(p.CurrencyCode);

            if (!rateByCurrency.TryGetValue(currencyTypeId, out var rate))
            {
                rate = 1m;
                if (!B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(currencyTypeId))
                {
                    var code = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.ToCode(currencyTypeId);
                    if (!string.IsNullOrWhiteSpace(code))
                    {
                        try
                        {
                            var fetched = await _money.GetLatestTryRateAsync(code, cancellationToken);
                            if (fetched > 0m) rate = fetched;
                        }
                        catch
                        {
                            rate = 1m;
                        }
                    }
                }
                rateByCurrency[currencyTypeId] = rate;
            }

            result[p.StockCode] = Math.Round(p.PurchasePrice * rate, 4, MidpointRounding.AwayFromZero);
        }

        return result;
    }

    [HttpGet]
    [AuthorizePage("invoice", "depoTransfer")]
    public async Task<IActionResult> List([FromQuery] int take = 200, [FromQuery] int skip = 0, CancellationToken cancellationToken = default)
    {
        take = Math.Max(1, Math.Min(1000, take));
        // Sayfalı okuma (2026-10-08): ekran 'son N' yerine skip ile hepsini çekiyor; eski kayıtlar
        // aramada/süzgeçte görünmüyordu (alış faturalarında 25.08 faturası bulunamadı).
        skip = Math.Max(0, skip);

        var rows = await _dbContext.Set<WarehouseTransfer>()
            .AsNoTracking()
            .OrderByDescending(x => x.Date)
            .ThenByDescending(x => x.Id)
            .Skip(skip).Take(take)
            .Select(x => new
            {
                id = x.Id,
                transferNo = x.TransferNo,
                date = x.Date,
                description = x.Description,
                deliveryAddress = x.DeliveryAddress,
                fromWarehouseCode = x.FromWarehouseCode,
                toWarehouseCode = x.ToWarehouseCode,
                isConsignment = x.IsConsignment,
                lineCount = x.Lines.Count,
                createUser = x.CreateUser,
                // KALEMLER LISTEDE DE DONUYOR (2026-08-23). Liste yalnizca "Kalem: 1" diyordu;
                // hangi urunden kac adet gittigi hicbir yerde gorunmuyordu ve belgeyi basmak
                // icin ayrica detay ucuna gitmek gerekiyordu. Transfer basina kalem sayisi
                // kucuk oldugu icin listeyle birlikte donmesi ucuz.
                lines = x.Lines
                    .OrderBy(l => l.LineNo)
                    .Select(l => new { l.StockCode, l.Quantity, l.LineNo })
                    .ToList()
            })
            .ToListAsync(cancellationToken);

        // Urun adlari TEK sorguda cozulur; satir basina sorgu (N+1) acilmaz.
        var nameByStockCode = await ResolveStockNamesAsync(
            rows.SelectMany(r => r.lines).Select(l => l.StockCode).ToList(),
            cancellationToken);

        var data = rows.Select(r => new
        {
            r.id,
            r.transferNo,
            r.date,
            r.description,
            r.deliveryAddress,
            r.fromWarehouseCode,
            r.toWarehouseCode,
            r.isConsignment,
            r.lineCount,
            r.createUser,
            lines = r.lines.Select(l => new
            {
                stockCode = l.StockCode,
                stockName = nameByStockCode.TryGetValue(l.StockCode, out var n) ? n : string.Empty,
                quantity = l.Quantity,
                lineNo = l.LineNo
            }).ToList()
        }).ToList();

        return Ok(new { success = true, data });
    }

    [HttpGet("{id:int}")]
    [AuthorizePage("invoice", "depoTransfer")]
    public async Task<IActionResult> Detail([FromRoute] int id, CancellationToken cancellationToken = default)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.Set<WarehouseTransfer>()
            .AsNoTracking()
            .Include(x => x.Lines)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        var detailNames = await ResolveStockNamesAsync(
            entity.Lines.Select(l => l.StockCode).ToList(),
            cancellationToken);

        var data = new
        {
            id = entity.Id,
            transferNo = entity.TransferNo,
            date = entity.Date,
            description = entity.Description,
            deliveryAddress = entity.DeliveryAddress,
            fromWarehouseCode = entity.FromWarehouseCode,
            toWarehouseCode = entity.ToWarehouseCode,
            isConsignment = entity.IsConsignment,
            lines = entity.Lines.OrderBy(x => x.LineNo).Select(l => new
            {
                id = l.Id,
                stockCode = l.StockCode,
                // Belge basiminda stok KODU degil ADI okunuyor; kod tek basina kimseye
                // ne gonderildigini soylemiyor.
                stockName = detailNames.TryGetValue(l.StockCode, out var n) ? n : string.Empty,
                quantity = l.Quantity,
                lineNo = l.LineNo
            }).ToList()
        };

        return Ok(new { success = true, data });
    }

    [HttpPost]
    [AuthorizePage("invoice", "depoTransfer")]
    public async Task<IActionResult> Create([FromBody] CreateWarehouseTransferRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        if (request.FromWarehouseCode == request.ToWarehouseCode)
        {
            return BadRequest(new { success = false, message = "Çıkış depo ve giriş depo aynı olamaz" });
        }

        var fromExists = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .AnyAsync(x => x.WarehouseCode == request.FromWarehouseCode, cancellationToken);

        var toExists = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .AnyAsync(x => x.WarehouseCode == request.ToWarehouseCode, cancellationToken);

        if (!fromExists) return BadRequest(new { success = false, message = "Çıkış depo bulunamadı" });
        if (!toExists) return BadRequest(new { success = false, message = "Giriş depo bulunamadı" });

        var stockCodes = request.Lines
            .Select(x => (x.StockCode ?? string.Empty).Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct()
            .ToList();

        if (stockCodes.Count == 0)
        {
            return BadRequest(new { success = false, message = "En az 1 stok kalemi giriniz" });
        }

        var existingProducts = await _dbContext.Products
            .AsNoTracking()
            .Where(x => stockCodes.Contains(x.StockCode))
            .Select(x => x.StockCode)
            .ToListAsync(cancellationToken);

        var existingSet = existingProducts.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var missing = stockCodes.FirstOrDefault(x => !existingSet.Contains(x));
        if (!string.IsNullOrWhiteSpace(missing))
        {
            return BadRequest(new { success = false, message = $"Stok bulunamadı: {missing}" });
        }

        // KAYNAK DEPODA STOK KONTROLÜ (denetim md. 37).
        //
        // Transfer, çıkış hareketini kaynak deponun bakiyesine hiç bakmadan yazıyordu: stoğu
        // olmayan depodan mal çıkıp hedef depoda HAYALİ stok oluşabiliyordu. Bu YENİ bir kural
        // değil — deponun `NegativeBalanceControl` ayarı zaten var ve satış faturası yolu
        // (`InvoicesController`) ona uyuyor; transfer yolu bu ayarı görmezden geliyordu.
        // Ayar kapalı depolarda davranış aynen eskisi gibi (eksiye izin verilir).
        var fromWarehouse = await _dbContext.Warehouses
            .AsNoTracking()
            .Where(x => x.WarehouseCode == request.FromWarehouseCode)
            .Select(x => new { x.WarehouseCode, x.NegativeBalanceControl, x.Name })
            .FirstOrDefaultAsync(cancellationToken);

        if (fromWarehouse is not null && fromWarehouse.NegativeBalanceControl)
        {
            var requestedByStockCode = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            foreach (var l in request.Lines)
            {
                var code = (l.StockCode ?? string.Empty).Trim();
                if (code.Length == 0) continue;
                requestedByStockCode[code] = requestedByStockCode.TryGetValue(code, out var q) ? q + l.Quantity : l.Quantity;
            }

            var balanceRows = await _dbContext.Set<StockMovement>()
                .AsNoTracking()
                .Where(x => x.WarehouseCode == request.FromWarehouseCode && stockCodes.Contains(x.StockCode))
                .GroupBy(x => x.StockCode)
                .Select(g => new
                {
                    StockCode = g.Key,
                    InQty = g.Where(x => x.Direction == StockMovementDirection.In).Sum(x => x.Quantity),
                    OutQty = g.Where(x => x.Direction == StockMovementDirection.Out).Sum(x => x.Quantity)
                })
                .ToListAsync(cancellationToken);

            var balanceByCode = balanceRows.ToDictionary(x => x.StockCode, x => x.InQty - x.OutQty, StringComparer.OrdinalIgnoreCase);

            foreach (var (stockCode, reqQty) in requestedByStockCode)
            {
                var balance = balanceByCode.TryGetValue(stockCode, out var b) ? b : 0m;
                if (balance < reqQty)
                {
                    return BadRequest(new
                    {
                        success = false,
                        message = $"Kaynak depoda stok yetersiz: {stockCode} (Mevcut: {balance}, İstenen: {reqQty})"
                    });
                }
            }
        }

        var now = DateTime.UtcNow;
        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        string GenerateTransferNo()
        {
            return "DT" + DateTime.UtcNow.ToString("yyMMddHHmmssff");
        }

        var transferNo = GenerateTransferNo();
        for (var i = 0; i < 3; i++)
        {
            var exists = await _dbContext.Set<WarehouseTransfer>()
                .AsNoTracking()
                .AnyAsync(x => x.TransferNo == transferNo, cancellationToken);

            if (!exists) break;
            await Task.Delay(15, cancellationToken);
            transferNo = GenerateTransferNo();
        }

        var date = request.Date.HasValue ? request.Date.Value : now;
        if (date.Kind != DateTimeKind.Utc) date = DateTime.SpecifyKind(date, DateTimeKind.Utc);

        var entity = new WarehouseTransfer
        {
            TransferNo = transferNo,
            Date = date,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            DeliveryAddress = string.IsNullOrWhiteSpace(request.DeliveryAddress) ? null : request.DeliveryAddress.Trim(),
            FromWarehouseCode = request.FromWarehouseCode,
            ToWarehouseCode = request.ToWarehouseCode,
            IsConsignment = request.IsConsignment,
            CreateUser = username,
            CreateTime = now
        };

        var lines = request.Lines
            .Select((l, idx) => new WarehouseTransferLine
            {
                StockCode = (l.StockCode ?? string.Empty).Trim(),
                Quantity = l.Quantity,
                LineNo = idx + 1,
                CreateUser = username,
                CreateTime = now
            })
            .ToList();

        entity.Lines.AddRange(lines);

        // TEK PARÇA İŞLEM (2026-08-20).
        //
        // Burada iki ayrı kayıt vardı: önce transfer BELGESİ, sonra iki stok hareketi. İkisinin
        // arasında elektrik ya da bağlantı kesilirse belge "mal taşındı" diyor, iki depo da
        // hiçbir şey görmüyordu — hem çıkış hem giriş hareketi eksik. Kıbrıs'ta bu kesintiler
        // olağan; yarım kalan belge de sessizdi, kimse fark etmiyordu.
        //
        // Belge ve iki bacağı artık tek işlemde: kesinti hâlinde HİÇBİRİ yazılmaz. Yarım bir
        // transferden, hiç olmamış bir transfer iyidir — kullanıcı ikincisini görür ve
        // tekrar dener.
        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        _dbContext.Set<WarehouseTransfer>().Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // Transferin iki bacağı da AYNI maliyetle yazılır: mal değer değiştirmeden yer
        // değiştiriyor. Sıfır yazmak depo bazlı envanter değerlemesini bozuyordu.
        var transferUnitCosts = await ResolveTransferUnitCostsAsync(
            lines.Select(x => x.StockCode).Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
            cancellationToken);

        var movements = new List<StockMovement>();
        foreach (var l in lines)
        {
            var unitCost = transferUnitCosts.TryGetValue(l.StockCode, out var cost) ? cost : 0m;

            // Para birimi alanları AÇIKÇA TL yazılır. Öncesinde set edilmiyordu; CurrencyRate
            // 0 kalıyor, hareketin kendi parasındaki değeri CurrencyUnitPrice'tan okuyup kura
            // bölen raporlarda 0'a bölme / NaN riski doğuyordu. Transfer daima TL maliyettir.
            movements.Add(new StockMovement
            {
                InvoiceNo = entity.TransferNo,
                CustomerCode = "TRANSFER",
                DeliveryCustomerCode = "TRANSFER",
                StockCode = l.StockCode,
                Direction = StockMovementDirection.Out,
                Quantity = l.Quantity,
                UnitPrice = unitCost,
                NetUnitPrice = unitCost,
                CurrencyTypeId = 1,
                CurrencyRate = 1m,
                CurrencyUnitPrice = unitCost,
                VatRate = 0m,
                BagNo = "DEPO_TRANSFER",
                SalesmanCode = null,
                WarehouseCode = entity.FromWarehouseCode,
                Delivered = true,
                Date = entity.Date,
                LineNo = l.LineNo,
                CreateUser = username,
                CreateTime = now
            });

            movements.Add(new StockMovement
            {
                InvoiceNo = entity.TransferNo,
                CustomerCode = "TRANSFER",
                DeliveryCustomerCode = "TRANSFER",
                StockCode = l.StockCode,
                Direction = StockMovementDirection.In,
                Quantity = l.Quantity,
                UnitPrice = unitCost,
                NetUnitPrice = unitCost,
                CurrencyTypeId = 1,
                CurrencyRate = 1m,
                CurrencyUnitPrice = unitCost,
                VatRate = 0m,
                BagNo = "DEPO_TRANSFER",
                SalesmanCode = null,
                WarehouseCode = entity.ToWarehouseCode,
                Delivered = true,
                Date = entity.Date,
                LineNo = l.LineNo,
                CreateUser = username,
                CreateTime = now
            });
        }

        _dbContext.Set<StockMovement>().AddRange(movements);
        await _dbContext.SaveChangesAsync(cancellationToken);

        await tx.CommitAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new { id = entity.Id, transferNo = entity.TransferNo } });
    }

    public sealed class DeleteRequest
    {
        [Required]
        [MaxLength(30)]
        public string TransferNo { get; set; } = string.Empty;
    }

    [HttpDelete("{id:int}")]
    [AuthorizePage("invoice", "depoTransfer")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var entity = await _dbContext.Set<WarehouseTransfer>()
            .Include(x => x.Lines)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (entity is null) return NotFound(new { success = false, message = "Kayıt bulunamadı" });

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, entity, "deleteRule/depoTransfer", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        // GENEL AYARLAR — SİLME KİLİT TARİHİ.
        //
        // Bu belge de kasa/banka ve stok bakiyelerini etkiliyor ama kilit kontrolü yalnız
        // faturalarda vardı (geçmiş döneme ait stok transferi silinerek geçmiş dönem sessizce bozulabiliyordu).
        // Kilit tarihi ÖNTANIMLI NULL'dır: ayarlanmadıysa davranış birebir aynı kalır,
        // ayarlandıysa kullanıcının açık talimatı bu belgeyi de kapsar.
        var deleteLockDate = await _dbContext.Set<JwtSessionSetting>()
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .Select(x => x.InvoiceDeleteLockDate)
            .FirstOrDefaultAsync(cancellationToken);

        if (deleteLockDate.HasValue && entity.Date.Date < deleteLockDate.Value.Date)
        {
            return BadRequest(new { success = false, message = $"Belge tarihi ({entity.Date:dd.MM.yyyy}), Genel Ayarlar'daki silme kilit tarihinden ({deleteLockDate.Value:dd.MM.yyyy}) önce olduğu için silinemez." });
        }

        var invNo = (entity.TransferNo ?? string.Empty).Trim();
        if (!string.IsNullOrWhiteSpace(invNo))
        {
            var movements = await _dbContext.Set<StockMovement>()
                .Where(x => x.InvoiceNo == invNo && x.BagNo == "DEPO_TRANSFER")
                .ToListAsync(cancellationToken);

            if (movements.Count > 0) _dbContext.Set<StockMovement>().RemoveRange(movements);
        }

        // SİLME İZİ (kullanıcı kararı, 2026-08-17). Transfer stok hareketi üretiyor; silinince
        // hangi depodan hangi depoya ne taşındığı kaydı da gitmesin.
        _dbContext.Set<DeletionLog>().Add(new DeletionLog
        {
            ModuleKey = "invoice",
            PageKey = "depoTransfer",
            RecordType = "DepoTransfer",
            RecordId = entity.Id.ToString(),
            Description = $"Depo transferi silindi: {entity.TransferNo} · {entity.FromWarehouseCode} → {entity.ToWarehouseCode}",
            DetailsJson = System.Text.Json.JsonSerializer.Serialize(new
            {
                entity.Id,
                entity.TransferNo,
                entity.Date,
                entity.FromWarehouseCode,
                entity.ToWarehouseCode,
                entity.IsConsignment,
                entity.Description
            }),
            CreateUser = User.FindFirst(ClaimTypes.Name)?.Value ?? "System",
            CreateTime = DateTime.UtcNow
        });

        _dbContext.Set<WarehouseTransfer>().Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }
}
