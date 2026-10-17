using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Data.Services;
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

/// <summary>
/// STOK GİRİŞ/ÇIKIŞ RAPORU — 2026-10-11 baştan düzenlendi (kullanıcı: "giriş çıkışlar, bakiyeler,
/// montaj bekleyenler doğru çalışmıyor; depo transferleri giriş/çıkışı etkiliyor").
///
/// <para>Her hareket ÜÇ türden birine ayrılır, tek kural <see cref="Tur"/>:</para>
/// <list type="bullet">
/// <item><b>Transfer</b> (<c>BagNo = DEPO_TRANSFER</c>): malın depo değiştirmesi. Ürün düzeyinde net
///   sıfır; TOP GİRİŞ/ÇIKIŞ'a ve ay kolonlarına GİRMEZ. Depo kırılımında ayrı sütunda görünür.</item>
/// <item><b>Devir</b> (<c>InvoiceNo = DEVIR-…</c>): programa geçişte girilen açılış stoğu. Tarihi 2026
///   içinde olduğu için eskiden TOP GİRİŞ'e ve Ağustos girişine sayılıyordu — alış gibi görünüyordu.
///   Artık DEVİR sütununda (önceki yılların net hareketiyle birlikte).</item>
/// <item><b>Normal</b>: fatura, alış, iade, irsaliye, garanti değişimi, sayım/düzeltme.</item>
/// </list>
/// <para>BAKİYE = DEVİR + GİRİŞ − ÇIKIŞ. Tıklanınca açılan pencere AYNI kümeyi kullanır; satırdaki
/// rakamla penceredeki toplam birebir tutar (eskiden pencere transferleri de sayıyordu).</para>
/// <para>Yıl/ay sınırı FİRMANIN saatinde (<see cref="CompanyClock"/>), UTC değil.</para>
/// </summary>
[ApiController]
[Route("api/reports/stock-in-out")]
[Authorize]
public sealed class StockInOutReportController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly CompanyClock _clock;
    private readonly TenantConnectionStringResolver _tenantResolver;
    private readonly MasterDbContext _master;
    private readonly ILogger<StockInOutReportController> _log;

    public StockInOutReportController(
        AppDbContext dbContext,
        CompanyClock clock,
        TenantConnectionStringResolver tenantResolver,
        MasterDbContext master,
        ILogger<StockInOutReportController> log)
    {
        _dbContext = dbContext;
        _clock = clock;
        _tenantResolver = tenantResolver;
        _master = master;
        _log = log;
    }

    private const int TurNormal = 0;
    private const int TurDevir = 1;
    private const int TurTransfer = 2;
    private const string TransferDamgasi = "DEPO_TRANSFER";
    private const string DevirOnEki = "DEVIR-";

    /// <summary>Hareketin türü — rapor ve pencere bu tek kuralı kullanır.</summary>
    private static int Tur(string? bagNo, string? invoiceNo) =>
        bagNo == TransferDamgasi ? TurTransfer
        : invoiceNo != null && invoiceNo.StartsWith(DevirOnEki) ? TurDevir
        : TurNormal;

    private (DateTime BasUtc, DateTime SonUtc) YilPenceresi(int yil) =>
        (_clock.CompanyDayStartUtc(new DateTime(yil, 1, 1)), _clock.CompanyDayStartUtc(new DateTime(yil + 1, 1, 1)));

    [HttpGet]
    [AuthorizePage("reports", "muhasebeStokGirisCikisRaporu")]
    public async Task<IActionResult> GetReport(
        [FromQuery] int? year,
        CancellationToken cancellationToken = default)
    {
        var targetYear = year ?? _clock.TodayCompanyDate().Year;
        var (yilBasi, yilSonu) = YilPenceresi(targetYear);

        var categories = await _dbContext.ProductCategories.AsNoTracking().ToListAsync(cancellationToken);
        var catNameMap = categories.ToDictionary(c => c.Id, c => c.Name);

        var products = await _dbContext.Products
            .AsNoTracking()
            .Include(x => x.Supplier)
            .OrderBy(x => x.StockCode)
            .ToListAsync(cancellationToken);

        // Yıl sonuna kadarki bütün hareketler, (stok, yön, tür, an) bazında toplanmış. Ay ve yıl
        // ataması firma saatine çevrilerek bellekte yapılır.
        var hamToplamlar = await _dbContext.StockMovements
            .AsNoTracking()
            .Where(x => x.Date < yilSonu)
            .GroupBy(x => new
            {
                x.StockCode,
                x.Direction,
                Tur = x.BagNo == TransferDamgasi ? TurTransfer
                    : (x.InvoiceNo != null && x.InvoiceNo.StartsWith(DevirOnEki)) ? TurDevir
                    : TurNormal,
                x.Date
            })
            .Select(g => new { g.Key.StockCode, g.Key.Direction, g.Key.Tur, g.Key.Date, Qty = g.Sum(x => x.Quantity) })
            .ToListAsync(cancellationToken);

        var devirDict = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        var girisDict = new Dictionary<string, decimal[]>(StringComparer.OrdinalIgnoreCase);
        var cikisDict = new Dictionary<string, decimal[]>(StringComparer.OrdinalIgnoreCase);

        foreach (var h in hamToplamlar)
        {
            if (h.Tur == TurTransfer) continue; // ürün düzeyinde net sıfır
            var kod = (h.StockCode ?? string.Empty).Trim();
            var isaret = h.Direction == StockMovementDirection.In ? 1m : -1m;

            if (h.Date < yilBasi || h.Tur == TurDevir)
            {
                devirDict[kod] = (devirDict.TryGetValue(kod, out var d) ? d : 0m) + isaret * h.Qty;
                continue;
            }

            var ay = _clock.ToCompanyTime(h.Date).Month - 1;
            var hedef = h.Direction == StockMovementDirection.In ? girisDict : cikisDict;
            if (!hedef.TryGetValue(kod, out var aylar)) hedef[kod] = aylar = new decimal[12];
            aylar[ay] += h.Qty;
        }

        var terminStokKodlari = products.Select(x => x.StockCode).Where(x => !string.IsNullOrWhiteSpace(x)).ToList();
        var terminDict = await TerminStockQuery.ToplamlarAsync(_dbContext, terminStokKodlari, cancellationToken);
        var terminTarihDict = await TerminStockQuery.EnYakinGelisTarihleriAsync(_dbContext, terminStokKodlari, cancellationToken);

        // MONTAJ BEKLEYEN — ServiceOps'tan (bkz. MontajBekleyenQuery). null = okunamadı.
        var montajDict = await MontajBekleyenQuery.ToplamlarAsync(_dbContext, _tenantResolver, _master, _log, cancellationToken);

        var results = products.Select(p =>
        {
            var pCode = (p.StockCode ?? string.Empty).Trim();
            var monthlyIn = girisDict.TryGetValue(pCode, out var gi) ? gi : new decimal[12];
            var monthlyOut = cikisDict.TryGetValue(pCode, out var co) ? co : new decimal[12];
            var totalIn = monthlyIn.Sum();
            var totalOut = monthlyOut.Sum();
            var opening = devirDict.TryGetValue(pCode, out var dv) ? dv : 0m;

            return new
            {
                stockCode = p.StockCode,
                stockName = p.Name,
                groupCode = p.MainCategoryId.HasValue && catNameMap.TryGetValue(p.MainCategoryId.Value, out var m) ? m : string.Empty,
                subGroupCode = p.CategoryId.HasValue && catNameMap.TryGetValue(p.CategoryId.Value, out var s) ? s : string.Empty,
                supplierName = p.Supplier != null ? p.Supplier.FullName : string.Empty,
                // DEVİR = önceki yılların net hareketi + programa geçişteki açılış stoğu (DEVIR-…).
                openingBalance = opening,
                totalIn,
                totalOut,
                balance = opening + totalIn - totalOut,
                // null: ServiceOps okunamadı → ekranda "—".
                pendingMontage = montajDict is null ? (decimal?)null : (montajDict.TryGetValue(pCode, out var mb) ? mb : 0m),
                termin = terminDict.TryGetValue(p.StockCode ?? string.Empty, out var trm) ? trm : 0m,
                terminEstimatedArrivalDate = terminTarihDict.TryGetValue(p.StockCode ?? string.Empty, out var trmDate)
                    ? (DateTime?)trmDate
                    : null,
                monthlyIn,
                monthlyOut
            };
        }).ToList();

        return Ok(new
        {
            success = true,
            data = results,
            montajKaynagiOkunamadi = montajDict is null
        });
    }

    [HttpGet("pending-details")]
    [AuthorizePage("reports", "muhasebeStokGirisCikisRaporu")]
    public async Task<IActionResult> GetPendingDetails(
        [FromQuery] string stockCode,
        CancellationToken cancellationToken = default)
    {
        stockCode = (stockCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(stockCode))
        {
            return BadRequest(new { success = false, message = "Stok kodu parametresi zorunludur" });
        }

        var list = await MontajBekleyenQuery.DetayAsync(_dbContext, _tenantResolver, _master, _log, stockCode, cancellationToken);
        if (list is null)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { success = false, message = "Montaj kayıtları (Servis veritabanı) okunamadı." });
        }

        var data = list.Select(x => new
        {
            id = x.Id,
            serviceNumber = x.ServiceNumber,
            dealerName = x.DealerName ?? string.Empty,
            installationName = x.CustomerName,
            installationPhone = x.CustomerPhone,
            plannedDate = x.PlannedAt,
            createdAt = x.CreatedAt,
            status = DurumAdi(x.Status),
            quantity = x.Quantity,
            address = x.Address ?? string.Empty,
            region = string.Empty
        }).ToList();

        return Ok(new { success = true, data });
    }

    private static string DurumAdi(int status) => status switch
    {
        0 => "Yeni Kayıt",
        5 => "Teslim Edildi (montaj bekliyor)",
        7 => "Gecikti",
        8 or 9 => "Planlandı",
        10 => "Teslimatta",
        _ => "Planlama Bekliyor"
    };

    /// <summary>
    /// Bir stok kodunun TERMİN kırılımı: hangi alış siparişinde ne kadar bekliyor.
    /// Kolondaki sayıya tıklanınca açılan pencere bunu gösterir.
    ///
    /// Sorgu <see cref="TerminStockQuery"/> içinde tek yerde;
    /// yetki ise her ekranın KENDİ sayfa anahtarıyla — bu uç Stok Giriş/Çıkış Raporu ekranına aittir.
    /// </summary>
    [HttpGet("termin-detay")]
    [AuthorizePage("reports", "muhasebeStokGirisCikisRaporu")]
    public async Task<IActionResult> TerminDetay([FromQuery] string stockCode, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(stockCode))
        {
            return BadRequest(new { success = false, message = "Stok kodu zorunludur." });
        }

        var satirlar = await TerminStockQuery.KirilimAsync(
            _dbContext, stockCode, cancellationToken);

        // Tedarikçi adı kodla birlikte gösteriliyor: yalnız kod ekranda anlamsız kalıyor.
        var kodlar = satirlar.Select(x => x.SupplierCode).Where(x => !string.IsNullOrWhiteSpace(x)).Distinct().ToList();
        var adlar = await _dbContext.Suppliers
            .AsNoTracking()
            .Where(x => kodlar.Contains(x.SupplierCode))
            .Select(x => new { x.SupplierCode, x.FullName })
            .ToListAsync(cancellationToken);
        var adByKod = adlar
            .GroupBy(x => x.SupplierCode)
            .ToDictionary(g => g.Key, g => g.First().FullName ?? string.Empty);

        var veri = satirlar.Select(x => new
        {
            purchaseInvoiceId = x.PurchaseInvoiceId,
            documentNo = x.DocumentNo,
            date = x.Date,
            supplierCode = x.SupplierCode,
            supplierName = adByKod.TryGetValue(x.SupplierCode ?? string.Empty, out var ad) ? ad : string.Empty,
            quantity = x.Quantity,
            warehouseCode = x.WarehouseCode
        }).ToList();

        return Ok(new
        {
            success = true,
            data = new { stockCode, totalQuantity = satirlar.Sum(x => x.Quantity), items = veri }
        });
    }

    /// <summary>
    /// TOP GİRİŞ / TOP ÇIKIŞ / DEVİR / BAKİYE kırılımı (pencere).
    ///
    /// <para>Rapor satırıyla AYNI küme (bkz. sınıf notu): özet şeridindeki Devir/Giriş/Çıkış/Bakiye
    /// satırdaki rakamlarla birebir. Depo kırılımında transferler ayrı sütunda — mal o depoya gerçekten
    /// girdi/çıktı, ama firmaya girmedi/çıkmadı; bu yüzden toplamlara dahil değil, depo bakiyesine dahil.</para>
    /// <para>Hareket dökümü: 'in'/'out' yalnız NORMAL hareketler (sütundaki sayıyı oluşturanlar);
    /// 'balance' hepsi — devir ve transfer satırları etiketli.</para>
    /// </summary>
    [HttpGet("hareket-detay")]
    [AuthorizePage("reports", "muhasebeStokGirisCikisRaporu")]
    public async Task<IActionResult> HareketDetay(
        [FromQuery] string stockCode,
        [FromQuery] int? year,
        [FromQuery] string? kind,
        CancellationToken cancellationToken = default)
    {
        stockCode = (stockCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(stockCode))
        {
            return BadRequest(new { success = false, message = "Stok kodu zorunludur." });
        }

        var hedefYil = year ?? _clock.TodayCompanyDate().Year;
        var (yilBasi, yilSonu) = YilPenceresi(hedefYil);

        var tur = (kind ?? string.Empty).Trim().ToLowerInvariant();
        if (tur != "in" && tur != "out") tur = "balance";

        var stokAdi = await _dbContext.Products
            .AsNoTracking()
            .Where(x => x.StockCode == stockCode)
            .Select(x => x.Name)
            .FirstOrDefaultAsync(cancellationToken);

        // Tek stok kodu: yıl sonuna kadarki bütün hareketler belleğe alınır, kural bellekte uygulanır.
        var tum = await _dbContext.StockMovements
            .AsNoTracking()
            .Where(x => x.StockCode == stockCode && x.Date < yilSonu)
            .Select(x => new
            {
                x.Id,
                x.Date,
                x.Direction,
                x.Quantity,
                x.WarehouseCode,
                x.InvoiceNo,
                x.CustomerCode,
                x.BagNo
            })
            .ToListAsync(cancellationToken);

        var siniflanmis = tum.Select(x => new
        {
            h = x,
            Tur = Tur(x.BagNo, x.InvoiceNo),
            Giris = x.Direction == StockMovementDirection.In,
            YilIcinde = x.Date >= yilBasi
        }).ToList();

        var depoKodlari = siniflanmis.Select(x => x.h.WarehouseCode).Distinct().ToList();
        var depolar = await _dbContext.Warehouses
            .AsNoTracking()
            .Where(x => depoKodlari.Contains(x.WarehouseCode))
            .Select(x => new { x.WarehouseCode, x.Name, x.IsVehicle })
            .ToListAsync(cancellationToken);
        var depoAdi = depolar.ToDictionary(x => x.WarehouseCode, x => x.Name ?? string.Empty);
        var depoArac = depolar.ToDictionary(x => x.WarehouseCode, x => x.IsVehicle);

        static decimal Net(IEnumerable<decimal> giris, IEnumerable<decimal> cikis) => giris.Sum() - cikis.Sum();

        var depoKirilimi = siniflanmis
            .GroupBy(x => x.h.WarehouseCode)
            .Select(g =>
            {
                // Depo devri: önceki yıllar (transfer DAHİL — depo düzeyinde gerçek) + yıl içi açılış stoğu.
                var devir = Net(
                    g.Where(x => (!x.YilIcinde || x.Tur == TurDevir) && x.Giris).Select(x => x.h.Quantity),
                    g.Where(x => (!x.YilIcinde || x.Tur == TurDevir) && !x.Giris).Select(x => x.h.Quantity));
                var yilGiris = g.Where(x => x.YilIcinde && x.Tur == TurNormal && x.Giris).Sum(x => x.h.Quantity);
                var yilCikis = g.Where(x => x.YilIcinde && x.Tur == TurNormal && !x.Giris).Sum(x => x.h.Quantity);
                var trGiris = g.Where(x => x.YilIcinde && x.Tur == TurTransfer && x.Giris).Sum(x => x.h.Quantity);
                var trCikis = g.Where(x => x.YilIcinde && x.Tur == TurTransfer && !x.Giris).Sum(x => x.h.Quantity);
                return new
                {
                    warehouseCode = g.Key,
                    warehouseName = depoAdi.TryGetValue(g.Key, out var ad) ? ad : string.Empty,
                    isVehicle = depoArac.TryGetValue(g.Key, out var arac) && arac,
                    openingBalance = devir,
                    yearIn = yilGiris,
                    yearOut = yilCikis,
                    transferIn = trGiris,
                    transferOut = trCikis,
                    balance = devir + yilGiris - yilCikis + trGiris - trCikis
                };
            })
            .Where(x => x.openingBalance != 0 || x.yearIn != 0 || x.yearOut != 0 || x.transferIn != 0 || x.transferOut != 0)
            .OrderByDescending(x => x.balance)
            .ThenBy(x => x.warehouseCode)
            .ToList();

        // Ürün düzeyi (satırla aynı): önceki yılların transferleri depolar arasında net sıfır.
        var toplamDevir = Net(
            siniflanmis.Where(x => x.Tur != TurTransfer && (!x.YilIcinde || x.Tur == TurDevir) && x.Giris).Select(x => x.h.Quantity),
            siniflanmis.Where(x => x.Tur != TurTransfer && (!x.YilIcinde || x.Tur == TurDevir) && !x.Giris).Select(x => x.h.Quantity));
        var toplamGiris = depoKirilimi.Sum(x => x.yearIn);
        var toplamCikis = depoKirilimi.Sum(x => x.yearOut);

        // HAREKET DÖKÜMÜ — yıl içi; tıklanan sütuna göre.
        var dokumKumesi = siniflanmis.Where(x => x.YilIcinde);
        if (tur == "in") dokumKumesi = dokumKumesi.Where(x => x.Tur == TurNormal && x.Giris);
        else if (tur == "out") dokumKumesi = dokumKumesi.Where(x => x.Tur == TurNormal && !x.Giris);

        var dokum = dokumKumesi.OrderByDescending(x => x.h.Date).ThenByDescending(x => x.h.Id).ToList();
        const int Limit = 500;
        var kesik = dokum.Take(Limit).ToList();

        var cariKodlari = kesik
            .Select(x => CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(x.h.CustomerCode ?? string.Empty))
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct()
            .ToList();
        var cariAdByKod = (await _dbContext.Customers
                .AsNoTracking()
                .Where(x => cariKodlari.Contains(x.CustomerCode))
                .Select(x => new { x.CustomerCode, x.Name })
                .ToListAsync(cancellationToken))
            .GroupBy(x => x.CustomerCode)
            .ToDictionary(g => g.Key, g => g.First().Name ?? string.Empty);

        var hareketler = kesik.Select(x =>
        {
            var anaKod = CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(x.h.CustomerCode ?? string.Empty);
            return new
            {
                id = x.h.Id,
                date = x.h.Date,
                direction = x.Giris ? "in" : "out",
                movementKind = x.Tur == TurTransfer ? "transfer" : x.Tur == TurDevir ? "devir" : "normal",
                quantity = x.h.Quantity,
                warehouseCode = x.h.WarehouseCode,
                warehouseName = depoAdi.TryGetValue(x.h.WarehouseCode, out var ad) ? ad : string.Empty,
                invoiceNo = x.h.InvoiceNo ?? string.Empty,
                customerCode = x.h.CustomerCode ?? string.Empty,
                customerName = cariAdByKod.TryGetValue(anaKod, out var cad) ? cad : string.Empty
            };
        }).ToList();

        return Ok(new
        {
            success = true,
            data = new
            {
                stockCode,
                stockName = stokAdi ?? string.Empty,
                year = hedefYil,
                kind = tur,
                openingBalance = toplamDevir,
                totalIn = toplamGiris,
                totalOut = toplamCikis,
                transferIn = depoKirilimi.Sum(x => x.transferIn),
                transferOut = depoKirilimi.Sum(x => x.transferOut),
                balance = toplamDevir + toplamGiris - toplamCikis,
                warehouses = depoKirilimi,
                movements = hareketler,
                movementTotalCount = dokum.Count,
                movementTruncated = dokum.Count > Limit
            }
        });
    }
}
