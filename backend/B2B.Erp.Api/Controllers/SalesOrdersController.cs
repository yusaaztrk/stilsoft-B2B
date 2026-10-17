using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using B2B.Erp.Api.Core.Http;
using System.Linq;
using System.Text.Json;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Enums;
using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Core.Logging;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Campaigns;
using B2B.Erp.Api.Dtos.SalesOrders;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class SalesOrdersController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly ICampaignService _campaignService;
    private readonly IMoneyServiceClient _money;
    private readonly IConfiguration _configuration;
    private readonly ICreditLimitService _creditLimitService;
    private readonly IUserActivityLogger _userActivityLogger;

    private readonly B2B.Erp.Api.Features.Ecommerce.ServiceOpsCargoClient _cargo;

    public SalesOrdersController(
        AppDbContext dbContext,
        ICampaignService campaignService,
        IMoneyServiceClient money,
        IConfiguration configuration,
        ICreditLimitService creditLimitService,
        IUserActivityLogger userActivityLogger,
        B2B.Erp.Api.Features.Ecommerce.ServiceOpsCargoClient cargo)
    {
        _dbContext = dbContext;
        _campaignService = campaignService;
        _money = money;
        _configuration = configuration;
        _creditLimitService = creditLimitService;
        _userActivityLogger = userActivityLogger;
        _cargo = cargo;
    }

    /// <summary>
    /// İşlemi kimin yaptığı.
    ///
    /// Normalde token'daki kullanıcıdır. Ama ServiceOps vekili B2B'ye KENDİ servis hesabıyla
    /// (ssa) gelir; o hâlde sipariş "ssa" adına yazılıyor ve Satış Faturası ekranındaki
    /// "İşlemi Yapan" sütununda sahadaki teknisyen yerine ssa görünüyordu.
    ///
    /// Vekil, gerçek kullanıcıyı <c>X-Acting-User</c> ile bildirir. Bu başlık YALNIZCA
    /// paylaşılan iç anahtar (<c>ServiceOps:InternalApiKey</c>) doğruysa dikkate alınır —
    /// aksi hâlde herhangi bir istemci denetim kaydına istediği adı yazdırabilirdi.
    /// </summary>
    private string ResolveActingUser() => ResolveActingUserWithOrigin().User;

    /// <summary>
    /// İşlemi yapan kullanıcı ve isteğin SERVİS PROGRAMINDAN gelip gelmediği.
    ///
    /// Doğrulanmış <c>X-Acting-User</c> başlığı yalnızca ServiceOps vekilinin gönderebileceği
    /// bir şeydir (paylaşılan iç anahtarla korunur), dolayısıyla aynı zamanda güvenilir bir
    /// KÖKEN işaretidir: "Günlük Tahsilatlar" bu sayede yalnızca servisteki satışları süzebiliyor.
    /// </summary>
    private (string User, bool FromServiceApp) ResolveActingUserWithOrigin()
    {
        var tokenUser = User.FindFirst(ClaimTypes.Name)?.Value ?? string.Empty;

        var acting = Request.Headers["X-Acting-User"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(acting))
        {
            var expectedKey = _configuration["ServiceOps:InternalApiKey"];
            var providedKey = Request.Headers["X-ServiceOps-Key"].FirstOrDefault();
            if (!string.IsNullOrWhiteSpace(expectedKey) && providedKey == expectedKey)
            {
                return (acting.Trim(), true);
            }
        }

        return (string.IsNullOrWhiteSpace(tokenUser) ? "System" : tokenUser, false);
    }

    /// <summary>
    /// Ürün kartı ile ekstre/fatura ARTIK AYNI kodlamayı kullanıyor (1=TRY 2=EUR 3=USD 4=GBP);
    /// çeviri yalnızca 0'ı TL'ye normalize eder. Eskiden 43=USD, 3=GBP idi.
    /// </summary>
    private static int MapProductCurrencyCodeToCurrencyTypeId(int productCurrencyCode)
        => B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Normalize(productCurrencyCode);

    private static string? MapCurrencyTypeIdToCode(int currencyTypeId)
    {
        return currencyTypeId switch
        {
            1 => "TRY",
            2 => "EUR",
            3 => "USD",
            4 => "GBP",
            _ => null
        };
    }

    private async Task<decimal> ResolveTryRateAsync(int currencyTypeId, CancellationToken cancellationToken)
    {
        // GBP (4) bir ara USD'ye (3) katlanıyordu; MapCurrencyTypeIdToCode zaten GBP'yi
        // biliyor, katlama yalnızca sterlini dolar kuruyla değerlendiriyordu.
        if (currencyTypeId is 0 or 1) return 1m;

        var code = MapCurrencyTypeIdToCode(currencyTypeId);
        if (string.IsNullOrWhiteSpace(code)) return 0m;

        try
        {
            return await _money.GetLatestTryRateAsync(code, cancellationToken);
        }
        catch
        {
            return 0m;
        }
    }

    public sealed class UpsertInstallationRequest
    {
        public string DealerName { get; set; } = string.Empty;
        public string ProductName { get; set; } = string.Empty;
        public decimal Quantity { get; set; }
        public string? InstallationName { get; set; }
        public string? InstallationPhone { get; set; }
        public string Address { get; set; } = string.Empty;
        public string Region { get; set; } = string.Empty;
        public string? DealerDescription { get; set; }
    }

    /// <summary>
    /// GÜNLÜK SATIŞLAR — kim, hangi cariye, ne sattı ve kaç para.
    ///
    /// Servis modülündeki "Günlük Tahsilatlar" ekranını besler. Gün, siparişin OLUŞTURULDUĞU
    /// tarihtir ve gün sınırı firma saatiyle hesaplanır (UTC ile hesaplanınca gece yarısına
    /// yakın satışlar bir önceki/sonraki güne kayıyordu — bkz. CompanyClock).
    ///
    /// Kalem seviyesinde döner; toplama ekranda yapılır ki müdür hem kişi toplamını hem tek
    /// tek ne satıldığını görebilsin.
    /// </summary>
    [HttpGet("daily-by-user")]
    [AuthorizePage("users", "gunlukTahsilat")]
    public async Task<IActionResult> DailyByUser(
        [FromQuery] DateTime date,
        [FromQuery] string? username,
        CancellationToken cancellationToken)
    {
        var clock = new B2B.Erp.Api.Core.Helpers.CompanyClock(_configuration);
        // `from`/`to` ADI KULLANILAMAZ: `from` LINQ sorgu ifadesinde anahtar kelimedir ve
        // `>= from` bir sorgu yan tümcesi gibi ayrıştırılıp derlemeyi kırar.
        var dayStart = clock.CompanyDayStartUtc(date);
        var dayEnd = clock.CompanyDayEndUtc(date);

        var query = from line in _dbContext.Set<SalesOrderLine>().AsNoTracking()
                    join order in _dbContext.Set<SalesOrder>().AsNoTracking()
                        on line.SalesOrderId equals order.Id
                    // YALNIZCA SERVİS PROGRAMINDAKİ SATIŞLAR (kullanıcı kararı, 2026-08-21).
                    // Damga `ServicePerformerName`: siparişi servis uygulamasından geleni
                    // (doğrulanmış X-Acting-User) işaretler. Bayide elle girilen siparişler bu
                    // alanı taşımaz ve rapora karışmaz.
                    where order.CreateTime >= dayStart && order.CreateTime < dayEnd
                          && line.ServicePerformerName != null
                    select new { line, order };

        if (!string.IsNullOrWhiteSpace(username))
        {
            var u = username.Trim().ToLower();
            query = query.Where(x => (x.order.CreateUser ?? string.Empty).ToLower() == u);
        }

        var raw = await query
            .OrderBy(x => x.order.CreateTime)
            .ThenBy(x => x.line.LineNo)
            .Select(x => new
            {
                user = x.order.CreateUser,
                orderNo = x.order.OrderNo,
                customerCode = x.order.CustomerCode,
                createTime = x.order.CreateTime,
                stockCode = x.line.StockCode,
                description = x.line.Description,
                quantity = x.line.Quantity,
                unitPrice = x.line.UnitPrice,
                discountAmount = x.line.DiscountAmount,
                vatRate = x.line.VatRate,
                warehouseCode = x.line.SourceWarehouseCode
            })
            .ToListAsync(cancellationToken);

        // Cari adı ayrı sorguda: satır başına join, aynı cariyi onlarca kez getirirdi.
        var codes = raw.Select(x => x.customerCode).Distinct().ToList();
        var names = await _dbContext.Customers
            .AsNoTracking()
            .Where(c => codes.Contains(c.CustomerCode))
            .Select(c => new { c.CustomerCode, c.Name })
            .ToDictionaryAsync(x => x.CustomerCode, x => x.Name, cancellationToken);

        var rows = raw.Select(x =>
        {
            // Satır tutarı KDV HARİÇ nettir: (adet × birim) − indirim. İndirim satırın
            // tamamından düşer, birim fiyattan değil.
            var net = (x.quantity * x.unitPrice) - x.discountAmount;
            if (net < 0m) net = 0m;
            return new
            {
                x.user,
                x.orderNo,
                x.customerCode,
                customerName = names.TryGetValue(x.customerCode, out var n) ? n : null,
                x.createTime,
                x.stockCode,
                x.description,
                x.quantity,
                x.unitPrice,
                x.discountAmount,
                x.vatRate,
                x.warehouseCode,
                netAmount = net,
                grossAmount = net * (1m + (x.vatRate / 100m))
            };
        }).ToList();

        return Ok(new { success = true, data = rows });
    }

    [HttpGet("customers-with-orders")]
    [AuthorizePage("invoice", "satisFatura")]
    public async Task<IActionResult> GetCustomersWithOrders([FromQuery] bool includeInactive = false, CancellationToken cancellationToken = default)
    {
        var roleCode = (User.FindFirst("RoleCode")?.Value ?? User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? string.Empty).Trim();
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var roleIdStr = User.FindFirst("RoleId")?.Value;
        var currentCode = User.FindFirst("Carikodu")?.Value?.Trim();
        var isAllCaris = isSsa || isSuperAdmin || string.IsNullOrEmpty(currentCode) || currentCode == "*" || string.Equals(currentCode, "ALL", StringComparison.OrdinalIgnoreCase);

        List<string>? scopedCustomerCodes = null;
        if (!isAllCaris)
        {
            var salesmanCode = User.FindFirst("SalesmanCode")?.Value?.Trim();
            if (!string.IsNullOrEmpty(salesmanCode))
            {
                var directCustomerCodes = await _dbContext.Customers
                    .AsNoTracking()
                    .Where(x => x.SalesmanCode == salesmanCode)
                    .Select(x => x.CustomerCode)
                    .ToListAsync(cancellationToken);

                scopedCustomerCodes = await _dbContext.Customers
                    .AsNoTracking()
                    // ŞUBE PAYLAŞILMAZ (2026-09-06 kullanıcı kararı): şubenin KENDİ plasiyeri
                    // varsa şube onundur, ana carinin plasiyerine açılmaz. Ana cari bir
                    // plasiyerde, şubesi başka plasiyerde olabiliyor (canlıda 4 şube böyle) ve
                    // eski kural ikisini de birbirine gösteriyordu.
                    // Plasiyeri BOŞ şube ana cariden miras alır — yoksa sahipsiz kalırdı.
                    .Where(x => x.SalesmanCode == salesmanCode ||
                                (x.ParentCustomerCode != null
                                 && directCustomerCodes.Contains(x.ParentCustomerCode)
                                 && (x.SalesmanCode == null || x.SalesmanCode == "")))
                    .Select(x => x.CustomerCode)
                    .ToListAsync(cancellationToken);
            }
            else if (!string.IsNullOrEmpty(currentCode))
            {
                scopedCustomerCodes = await _dbContext.Customers
                    .AsNoTracking()
                    .Where(x => x.CustomerCode == currentCode || x.ParentCustomerCode == currentCode)
                    .Select(x => x.CustomerCode)
                    .ToListAsync(cancellationToken);
            }
        }

        var orderQuery = _dbContext.Set<SalesOrder>().AsNoTracking().AsQueryable();
        if (scopedCustomerCodes is not null)
        {
            // Teslim carisi de kapsama girer: şubeli bayide sipariş ana firmaya yazılır ama
            // teslimat şubeye gider ve ikisinin plasiyeri farklı olabilir. Aşağıdaki satır
            // (345) zaten şube kodunu tercih ediyor; süzgeç o gerçeği görmüyordu.
            orderQuery = orderQuery.Where(x =>
                scopedCustomerCodes.Contains(x.CustomerCode) ||
                (x.DeliveryCustomerCode != null && scopedCustomerCodes.Contains(x.DeliveryCustomerCode)));
        }

        // ÖDENMEMİŞ E-TİCARET SİPARİŞİ FATURALANAMAZ (2026-09-09).
        // Bayi siparişi vadeli açılır, e-ticaret siparişi peşin. Kural EcommerceInvoiceGate'te.
        var paidEcommerceOrderNos = B2B.Erp.Api.Features.Ecommerce.EcommerceInvoiceGate.PaidOrderNos(_dbContext);

        // BAYI SIPARISI BU SUZGECTEN HIC ETKILENMEZ: ilk iki kosuldan biri bayi siparisinde
        // her zaman dogru oldugu icin OR kisa devre yapar ve siparis aynen gecer. Iptal (Status)
        // kontrolu de BILEREK e-ticaret dalinin ICINDE — bayi siparisinin Status alanina hicbir
        // yerde yazilmiyor ve ileride yazilirsa bayi siparisleri sessizce listeden dusmemeli.
        orderQuery = orderQuery.Where(x =>
            x.ProcessedBy == null
            || x.ProcessedBy.ToUpper() != B2B.Erp.Api.Features.Ecommerce.EcommerceInvoiceGate.OrderMarker
            || (x.Status != B2B.Erp.Api.Features.Ecommerce.EcommerceFulfilmentService.CancelledStatus && paidEcommerceOrderNos.Contains(x.OrderNo)));

        var rawLines = await (
                from order in orderQuery
                join line in _dbContext.Set<SalesOrderLine>().AsNoTracking() on order.Id equals line.SalesOrderId
                where line.Quantity > (_dbContext.Set<InvoiceLine>().AsNoTracking()
                    .Where(il => il.SalesOrderLineId == line.Id)
                    .Select(il => (decimal?)il.Quantity)
                    .Sum() ?? 0m)
                select new 
                {
                    OrderId = order.Id,
                    CustomerCode = order.CustomerCode,
                    DeliveryCustomerCode = order.DeliveryCustomerCode,
                    StockCode = line.StockCode,
                    Description = line.Description,
                    InstallationId = line.InstallationId,
                    CampaignDetailsJson = order.CampaignDetailsJson
                }
            )
            .ToListAsync(cancellationToken);

        var orderIds = rawLines.Select(x => x.OrderId).Distinct().ToList();
        var consignmentOrderIds = await _dbContext.Set<Irsaliye>()
            .AsNoTracking()
            .Where(x => x.TransferredSalesOrderId != null && orderIds.Contains(x.TransferredSalesOrderId.Value))
            .Select(x => x.TransferredSalesOrderId!.Value)
            .Distinct()
            .ToListAsync(cancellationToken);

        var custCodes = rawLines.Select(x => x.CustomerCode).Concat(rawLines.Select(x => x.DeliveryCustomerCode)).Distinct().ToList();
        var storeCustomers = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => custCodes.Contains(x.CustomerCode) && (x.CustomerType == "Mağaza" || x.CustomerType == "Magaza"))
            .Select(x => x.CustomerCode)
            .ToListAsync(cancellationToken);

        var roleIdVal = string.IsNullOrEmpty(roleIdStr) ? 0 : int.Parse(roleIdStr);
        var hasFullAccess = isSsa;

        var allowedKeys = hasFullAccess ? new List<string>() : await _dbContext.Set<RolePagePermission>()
            .AsNoTracking()
            .Where(rpp => rpp.RoleId == roleIdVal && rpp.CanAccess && rpp.Page.ModuleKey == "invoice")
            .Select(rpp => rpp.Page.Key)
            .ToListAsync(cancellationToken);

        var hasSiparis = hasFullAccess || allowedKeys.Contains("satisFaturaSiparisGorsun");
        var hasMagazaSiparis = hasFullAccess || allowedKeys.Contains("satisFaturaMagazaSiparisGorsun");
        var hasServis = hasFullAccess || allowedKeys.Contains("satisFaturaServisGorsun");
        var hasKonsinye = hasFullAccess || allowedKeys.Contains("satisFaturaKonsinyeGorsun");

        var customerCodes = rawLines.Where(line =>
        {
            var isServisLine = line.InstallationId.HasValue || 
                               (line.StockCode != null && line.StockCode.StartsWith("HİZ-TAMİR", StringComparison.OrdinalIgnoreCase)) ||
                               (line.Description != null && (line.Description.Contains("Servis Onarım", StringComparison.OrdinalIgnoreCase) || line.Description.Contains("Garantili Bedelsiz", StringComparison.OrdinalIgnoreCase))) ||
                               (line.CampaignDetailsJson != null && line.CampaignDetailsJson.Contains("\"isServiceInvoice\":true"));

            if (isServisLine) return hasServis;

            var isKonsinyeLine = consignmentOrderIds.Contains(line.OrderId);
            if (isKonsinyeLine) return hasKonsinye;

            var isMagazaLine = storeCustomers.Contains(line.CustomerCode) || storeCustomers.Contains(line.DeliveryCustomerCode);
            if (isMagazaLine) return hasMagazaSiparis;

            return hasSiparis;
        })
        .Select(x => !string.IsNullOrEmpty(x.DeliveryCustomerCode) && x.DeliveryCustomerCode.StartsWith("01-", StringComparison.OrdinalIgnoreCase) ? x.DeliveryCustomerCode : x.CustomerCode)
        .Where(x => !string.IsNullOrEmpty(x))
        .Distinct()
        .OrderBy(x => x)
        .ToList();

        var customersQuery = _dbContext.Customers.AsNoTracking().AsQueryable();
        if (!includeInactive)
        {
            customersQuery = customersQuery.Where(x => x.IsActive);
        }

        var customerMap = await customersQuery
            .Where(x => customerCodes.Contains(x.CustomerCode))
            .Select(x => new
            {
                x.CustomerCode,
                x.Name,
                x.InvoiceType,
                PriceGroupCode = x.PriceGroupEntity != null ? (int?)x.PriceGroupEntity.Code : null
            })
            .ToDictionaryAsync(x => x.CustomerCode, x => new { x.Name, x.InvoiceType, x.PriceGroupCode }, cancellationToken);

        var data = customerCodes
            .Select(code => new
            {
                CustomerCode = code,
                Name = customerMap.TryGetValue(code, out var c) ? c.Name : string.Empty,
                InvoiceType = customerMap.TryGetValue(code, out var c2) ? c2.InvoiceType : string.Empty,
                PriceGroupCode = customerMap.TryGetValue(code, out var c3) ? (c3.PriceGroupCode ?? 0) : 0
            })
            .ToList();

        return Ok(new { success = true, data });
    }

    [HttpGet("lines-for-invoice")]
    [AuthorizePage("invoice", "satisFatura")]
    public async Task<IActionResult> GetLinesForInvoice([FromQuery] string customerCode, CancellationToken cancellationToken = default)
    {
        customerCode = (customerCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(customerCode))
        {
            return Ok(new { success = true, data = Array.Empty<SalesOrderInvoiceLineResponse>() });
        }

        var roleCode = (User.FindFirst("RoleCode")?.Value ?? User.FindFirst(System.Security.Claims.ClaimTypes.Role)?.Value ?? string.Empty).Trim();
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var roleIdStr = User.FindFirst("RoleId")?.Value;
        var currentCode = User.FindFirst("Carikodu")?.Value?.Trim();
        var isAllCaris = isSsa || isSuperAdmin || string.IsNullOrEmpty(currentCode) || currentCode == "*" || string.Equals(currentCode, "ALL", StringComparison.OrdinalIgnoreCase);

        List<string>? scopedCustomerCodes = null;
        if (!isAllCaris)
        {
            var salesmanCode = User.FindFirst("SalesmanCode")?.Value?.Trim();
            if (!string.IsNullOrEmpty(salesmanCode))
            {
                var directCustomerCodes = await _dbContext.Customers
                    .AsNoTracking()
                    .Where(x => x.SalesmanCode == salesmanCode)
                    .Select(x => x.CustomerCode)
                    .ToListAsync(cancellationToken);

                scopedCustomerCodes = await _dbContext.Customers
                    .AsNoTracking()
                    // ŞUBE PAYLAŞILMAZ (2026-09-06 kullanıcı kararı): şubenin KENDİ plasiyeri
                    // varsa şube onundur, ana carinin plasiyerine açılmaz. Ana cari bir
                    // plasiyerde, şubesi başka plasiyerde olabiliyor (canlıda 4 şube böyle) ve
                    // eski kural ikisini de birbirine gösteriyordu.
                    // Plasiyeri BOŞ şube ana cariden miras alır — yoksa sahipsiz kalırdı.
                    .Where(x => x.SalesmanCode == salesmanCode ||
                                (x.ParentCustomerCode != null
                                 && directCustomerCodes.Contains(x.ParentCustomerCode)
                                 && (x.SalesmanCode == null || x.SalesmanCode == "")))
                    .Select(x => x.CustomerCode)
                    .ToListAsync(cancellationToken);
            }
            else if (!string.IsNullOrEmpty(currentCode))
            {
                scopedCustomerCodes = await _dbContext.Customers
                    .AsNoTracking()
                    .Where(x => x.CustomerCode == currentCode || x.ParentCustomerCode == currentCode)
                    .Select(x => x.CustomerCode)
                    .ToListAsync(cancellationToken);
            }
        }

        if (scopedCustomerCodes is not null && !scopedCustomerCodes.Contains(customerCode))
        {
            return Ok(new { success = true, data = Array.Empty<SalesOrderInvoiceLineResponse>() });
        }

        var invoiceLinesQuery = _dbContext.Set<InvoiceLine>().AsNoTracking();

        // ÖDENMEMİŞ E-TİCARET SİPARİŞİ FATURALANAMAZ (2026-09-09). Bkz. EcommerceInvoiceGate:
        // müşteri sepeti onaylayıp ödeme sayfasını kapatınca sipariş açılıyor ama parası
        // çekilmiyor; o sipariş buraya düşerse parası alınmamış mal faturalanıp sevk edilebilir.
        var paidEcommerceOrderNos = B2B.Erp.Api.Features.Ecommerce.EcommerceInvoiceGate.PaidOrderNos(_dbContext);

        var query =
            from line in _dbContext.Set<SalesOrderLine>().AsNoTracking()
            join order in _dbContext.Set<SalesOrder>().AsNoTracking() on line.SalesOrderId equals order.Id
            join product in _dbContext.Set<Product>().AsNoTracking() on line.StockCode equals product.StockCode into productJoin
            from product in productJoin.DefaultIfEmpty()
            join installation in _dbContext.Set<Installation>().AsNoTracking() on line.InstallationId equals installation.Id into installationJoin
            from installation in installationJoin.DefaultIfEmpty()
            let invoicedQty = invoiceLinesQuery.Where(il => il.SalesOrderLineId == line.Id).Select(il => (decimal?)il.Quantity).Sum() ?? 0m
            let remainingQty = line.Quantity - invoicedQty
            // Bayi siparisi degismez; kosul yalnizca ETICARET damgali siparise iner.
            where remainingQty > 0 &&
                  (order.ProcessedBy == null
                   || order.ProcessedBy.ToUpper() != B2B.Erp.Api.Features.Ecommerce.EcommerceInvoiceGate.OrderMarker
                   || (order.Status != B2B.Erp.Api.Features.Ecommerce.EcommerceFulfilmentService.CancelledStatus
                       && paidEcommerceOrderNos.Contains(order.OrderNo))) &&
                  (order.CustomerCode == customerCode || order.DeliveryCustomerCode == customerCode) &&
                  (scopedCustomerCodes == null || scopedCustomerCodes.Contains(order.CustomerCode) || (order.DeliveryCustomerCode != null && scopedCustomerCodes.Contains(order.DeliveryCustomerCode)))
            orderby order.ProcessedAt descending, order.OrderNo descending, line.LineNo
            select new SalesOrderInvoiceLineResponse
            {
                SalesOrderLineId = line.Id,
                SalesOrderId = order.Id,

                OrderSubtotal = order.Subtotal,
                OrderGrandTotal = order.GrandTotal,

                OrderDate = order.ProcessedAt,
                OrderNo = order.OrderNo,

                CustomerCode = order.CustomerCode,
                DeliveryCustomerCode = order.DeliveryCustomerCode,

                StockCode = line.StockCode,
                ProductName = product != null ? product.Name : string.Empty,

                Description = line.Description,

                OrderQuantity = line.Quantity,
                DeliveredQuantity = invoicedQty,
                RemainingQuantity = remainingQty,

                SerialNo = null,

                UnitPrice = line.UnitPrice,
                CurrencyTypeId = line.CurrencyTypeId,
                CurrencyRate = line.CurrencyRate,
                CurrencyUnitPrice = line.CurrencyUnitPrice,
                VatRate = line.VatRate,

                IsGift = line.IsGift,
                DiscountAmount = line.DiscountAmount,

                ProcessedBy = order.ProcessedBy,

                InstallationId = line.InstallationId,
                InstallationName = installation != null ? installation.InstallationName : null,
                CampaignDiscount = order.CampaignDiscount,
                CampaignDetailsJson = order.CampaignDetailsJson,

                // KALEM BAZLI ÇIKIŞ DEPOSU (2026-08-13). Servisten gelen kalemde işlemi yapan
                // teknisyenin araç deposu damgalı; satış faturası ekranı bunu o satırın
                // öntanımlı deposu yapıyor ve satırı "SERVİS" rozetiyle işaretliyor.
                SourceWarehouseCode = line.SourceWarehouseCode,
                ServicePerformerName = line.ServicePerformerName,

                // Kalemi GİREN kişi. Sipariş başlığının `ProcessedBy`'ı değil satırın kendi
                // `CreateUser`'ı esas alınır: bir siparişe sonradan başka bir kullanıcı da kalem
                // ekleyebiliyor ve çıkış deposu satır satır o kişinin deposu olmalı. Boşsa
                // aşağıda `ProcessedBy`'a düşülüyor (bellekte — SQL'e çevrilmesine gerek yok).
                CreatedByUsername = line.CreateUser
            };

        var results = await query.ToListAsync(cancellationToken);

        var orderIds = results.Select(x => x.SalesOrderId).Distinct().ToList();
        var consignmentOrderIds = await _dbContext.Set<Irsaliye>()
            .AsNoTracking()
            .Where(x => x.TransferredSalesOrderId != null && orderIds.Contains(x.TransferredSalesOrderId.Value))
            .Select(x => x.TransferredSalesOrderId!.Value)
            .Distinct()
            .ToListAsync(cancellationToken);

        var custCodes = results.Select(x => x.CustomerCode).Concat(results.Select(x => x.DeliveryCustomerCode)).Distinct().ToList();
        var storeCustomers = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => custCodes.Contains(x.CustomerCode) && (x.CustomerType == "Mağaza" || x.CustomerType == "Magaza"))
            .Select(x => x.CustomerCode)
            .ToListAsync(cancellationToken);

        var roleIdVal = string.IsNullOrEmpty(roleIdStr) ? 0 : int.Parse(roleIdStr);
        var hasFullAccess = isSsa;

        var allowedKeys = hasFullAccess ? new List<string>() : await _dbContext.Set<RolePagePermission>()
            .AsNoTracking()
            .Where(rpp => rpp.RoleId == roleIdVal && rpp.CanAccess && rpp.Page.ModuleKey == "invoice")
            .Select(rpp => rpp.Page.Key)
            .ToListAsync(cancellationToken);

        var hasSiparis = hasFullAccess || allowedKeys.Contains("satisFaturaSiparisGorsun");
        var hasMagazaSiparis = hasFullAccess || allowedKeys.Contains("satisFaturaMagazaSiparisGorsun");
        var hasServis = hasFullAccess || allowedKeys.Contains("satisFaturaServisGorsun");
        var hasKonsinye = hasFullAccess || allowedKeys.Contains("satisFaturaKonsinyeGorsun");

        var data = results.Where(line =>
        {
            var isServisLine = line.InstallationId.HasValue || 
                               (line.StockCode != null && line.StockCode.StartsWith("HİZ-TAMİR", StringComparison.OrdinalIgnoreCase)) ||
                               (line.Description != null && (line.Description.Contains("Servis Onarım", StringComparison.OrdinalIgnoreCase) || line.Description.Contains("Garantili Bedelsiz", StringComparison.OrdinalIgnoreCase))) ||
                               (line.CampaignDetailsJson != null && line.CampaignDetailsJson.Contains("\"isServiceInvoice\":true"));

            if (isServisLine) return hasServis;

            var isKonsinyeLine = consignmentOrderIds.Contains(line.SalesOrderId);
            if (isKonsinyeLine) return hasKonsinye;

            var isMagazaLine = storeCustomers.Contains(line.CustomerCode) || storeCustomers.Contains(line.DeliveryCustomerCode);
            if (isMagazaLine) return hasMagazaSiparis;

            return hasSiparis;
        }).ToList();

        // Resolve standard prices for zero-priced gift lines
        var giftLinesWithZeroPrice = data.Where(x => x.IsGift && x.UnitPrice == 0m).ToList();
        if (giftLinesWithZeroPrice.Count > 0)
        {
            var customer = await _dbContext.Customers
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);
            var priceGroupId = customer?.PriceGroupId;

            var stockCodesForGifts = giftLinesWithZeroPrice.Select(x => x.StockCode).Distinct().ToList();
            var productsForGifts = await _dbContext.Products
                .AsNoTracking()
                .Where(x => stockCodesForGifts.Contains(x.StockCode))
                .Select(x => new { x.Id, x.StockCode })
                .ToListAsync(cancellationToken);

            var productIds = productsForGifts.Select(x => x.Id).ToList();
            var prices = await _dbContext.ProductPrices
                .AsNoTracking()
                .Where(x => productIds.Contains(x.ProductId))
                .ToListAsync(cancellationToken);

            var priceMap = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            foreach (var p in productsForGifts)
            {
                decimal price = 0m;
                if (priceGroupId.HasValue)
                {
                    price = prices.FirstOrDefault(x => x.ProductId == p.Id && x.PriceGroupId == priceGroupId.Value)?.Price ?? 0m;
                }
                if (price <= 0m)
                {
                    price = prices.FirstOrDefault(x => x.ProductId == p.Id)?.Price ?? 0m;
                }
                priceMap[p.StockCode] = price;
            }

            foreach (var line in giftLinesWithZeroPrice)
            {
                if (priceMap.TryGetValue(line.StockCode, out var standardPrice))
                {
                    line.UnitPrice = standardPrice;
                    line.CurrencyUnitPrice = standardPrice;
                    line.DiscountAmount = standardPrice * line.OrderQuantity;
                }
            }
        }

        // Align gift line CurrencyTypeId and CurrencyRate with order non-gift lines if currencyTypeId is default/TRY
        var orderCurrencyMap = data
            .Where(x => x.CurrencyTypeId > 1)
            .GroupBy(x => x.SalesOrderId)
            .ToDictionary(g => g.Key, g => new { CurrencyTypeId = g.First().CurrencyTypeId, CurrencyRate = g.First().CurrencyRate });

        foreach (var line in data)
        {
            if (line.IsGift && orderCurrencyMap.TryGetValue(line.SalesOrderId, out var curInfo))
            {
                if (line.CurrencyTypeId <= 1)
                {
                    line.CurrencyTypeId = curInfo.CurrencyTypeId;
                }
                if (line.CurrencyRate <= 0m)
                {
                    line.CurrencyRate = curInfo.CurrencyRate;
                }
            }
        }

        await FillDefaultWarehousesAsync(data, cancellationToken);

        return Ok(new { success = true, data });
    }

    /// <summary>
    /// KALEMİN ÖNTANIMLI ÇIKIŞ DEPOSUNU DOLDURUR (kullanıcı kuralı, 2026-08-14).
    ///
    /// Kural: "satış, işlemi en son kim yaptıysa onun deposundan çıksın". Bu, kalemi giren
    /// kullanıcının <c>Users.DefaultWarehouseCode</c> alanıdır — faturayı kesen kişinin değil.
    ///
    /// Sıra: (1) servis damgası, (2) girenin varsayılan deposu, (3) girenin TEK depo yetkisi.
    /// Üçü de yoksa alan null kalır ve ekran "Depo seçiniz" der. Tahmin edip bir yere yazmak,
    /// yanlış yere yazmaktır: bu ekran daha önce tam da bunu yapıyordu — seçicide hiçbir seçenek
    /// eşleşmediği için tarayıcı listenin ilk deposunu (kod sırasıyla -21 YP SİPARİŞ) gösteriyor,
    /// arkada ise hiçbir depo seçili olmuyordu.
    ///
    /// Kullanıcı adı eşleştirmesi `Username` VEYA `Unvan` üzerinden yapılır; sipariş kaynağına
    /// göre `CreateUser` alanına ikisinden biri yazılabiliyor.
    /// </summary>
    private async Task FillDefaultWarehousesAsync(
        List<SalesOrderInvoiceLineResponse> lines,
        CancellationToken cancellationToken)
    {
        if (lines.Count == 0) return;

        foreach (var line in lines)
        {
            if (string.IsNullOrWhiteSpace(line.CreatedByUsername))
            {
                line.CreatedByUsername = line.ProcessedBy;
            }
        }

        var creatorNames = lines
            .Select(x => (x.CreatedByUsername ?? string.Empty).Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var warehouseByCreator = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

        if (creatorNames.Count > 0)
        {
            var loweredNames = creatorNames.Select(x => x.ToLower()).ToList();

            var users = await _dbContext.Users
                .AsNoTracking()
                .Where(u => loweredNames.Contains(u.Username.ToLower())
                            || (u.Unvan != null && loweredNames.Contains(u.Unvan.ToLower())))
                .Select(u => new { u.Id, u.Username, u.Unvan, u.DefaultWarehouseCode })
                .ToListAsync(cancellationToken);

            if (users.Count > 0)
            {
                // Varsayılanı olmayan kullanıcılar için "tek yetkili depo" kuralı. Tek sorguda
                // toplanıp bellekte gruplanıyor; kullanıcı başına sorgu atmanın anlamı yok.
                var userIds = users.Select(u => u.Id).ToList();
                var userWarehouses = await _dbContext.UserWarehouses
                    .AsNoTracking()
                    .Where(uw => userIds.Contains(uw.UserId))
                    .Select(uw => new { uw.UserId, uw.WarehouseCode })
                    .ToListAsync(cancellationToken);

                var singleWarehouseByUserId = userWarehouses
                    .GroupBy(x => x.UserId)
                    .Where(g => g.Select(x => x.WarehouseCode).Distinct().Count() == 1)
                    .ToDictionary(g => g.Key, g => g.First().WarehouseCode);

                foreach (var u in users)
                {
                    // NEGATİF DEPO KODU GEÇERLİDİR (bkz. WarehousesController); kontrol `!= 0`.
                    int? code = u.DefaultWarehouseCode.HasValue && u.DefaultWarehouseCode.Value != 0
                        ? u.DefaultWarehouseCode.Value
                        : (singleWarehouseByUserId.TryGetValue(u.Id, out var only) ? only : (int?)null);

                    if (code is null) continue;

                    if (!string.IsNullOrWhiteSpace(u.Username))
                    {
                        warehouseByCreator[u.Username.Trim()] = code.Value;
                    }
                    if (!string.IsNullOrWhiteSpace(u.Unvan))
                    {
                        // Ünvan birden fazla kullanıcıda aynı olabilir; ilk eşleşme kalır ve
                        // asıl anahtar zaten `Username`.
                        warehouseByCreator.TryAdd(u.Unvan.Trim(), code.Value);
                    }
                }
            }
        }

        foreach (var line in lines)
        {
            if (line.SourceWarehouseCode.HasValue && line.SourceWarehouseCode.Value != 0)
            {
                line.DefaultWarehouseCode = line.SourceWarehouseCode.Value;
                line.DefaultWarehouseSource = "servis";
                continue;
            }

            var creator = (line.CreatedByUsername ?? string.Empty).Trim();
            if (creator.Length > 0 && warehouseByCreator.TryGetValue(creator, out var code))
            {
                line.DefaultWarehouseCode = code;
                line.DefaultWarehouseSource = "kullanici";
            }
        }

        var neededCodes = lines
            .Where(x => x.DefaultWarehouseCode.HasValue)
            .Select(x => x.DefaultWarehouseCode!.Value)
            .Distinct()
            .ToList();

        if (neededCodes.Count == 0) return;

        var names = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .Where(w => neededCodes.Contains(w.WarehouseCode))
            .Select(w => new { w.WarehouseCode, w.Name })
            .ToListAsync(cancellationToken);

        var nameByCode = names.ToDictionary(x => x.WarehouseCode, x => x.Name);

        foreach (var line in lines)
        {
            if (line.DefaultWarehouseCode.HasValue && nameByCode.TryGetValue(line.DefaultWarehouseCode.Value, out var wname))
            {
                line.DefaultWarehouseName = wname;
            }
        }
    }

    [HttpGet("uninvoiced-report")]
    [AuthorizePage("reports", "siparisRaporu")]
    public async Task<IActionResult> GetUninvoicedOrdersReport([FromQuery] string? query, CancellationToken cancellationToken = default)
    {
        var q = string.IsNullOrWhiteSpace(query) ? null : query.Trim().ToLowerInvariant();

        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var currentCode = User.FindFirst("Carikodu")?.Value?.Trim();
        var isAllCaris = isSsa || isSuperAdmin || string.IsNullOrEmpty(currentCode) || currentCode == "*" || string.Equals(currentCode, "ALL", StringComparison.OrdinalIgnoreCase);

        var orderQuery = _dbContext.Set<SalesOrder>().AsNoTracking().AsQueryable();

        if (!isAllCaris)
        {
            var salesmanCode = User.FindFirst("SalesmanCode")?.Value?.Trim();
            if (!string.IsNullOrEmpty(salesmanCode))
            {
                var directCustomerCodes = await _dbContext.Customers
                    .AsNoTracking()
                    .Where(x => x.SalesmanCode == salesmanCode)
                    .Select(x => x.CustomerCode)
                    .ToListAsync(cancellationToken);

                var allowedCustomerCodes = await _dbContext.Customers
                    .AsNoTracking()
                    // ŞUBE PAYLAŞILMAZ (2026-09-06 kullanıcı kararı): şubenin KENDİ plasiyeri
                    // varsa şube onundur, ana carinin plasiyerine açılmaz. Ana cari bir
                    // plasiyerde, şubesi başka plasiyerde olabiliyor (canlıda 4 şube böyle) ve
                    // eski kural ikisini de birbirine gösteriyordu.
                    // Plasiyeri BOŞ şube ana cariden miras alır — yoksa sahipsiz kalırdı.
                    .Where(x => x.SalesmanCode == salesmanCode ||
                                (x.ParentCustomerCode != null
                                 && directCustomerCodes.Contains(x.ParentCustomerCode)
                                 && (x.SalesmanCode == null || x.SalesmanCode == "")))
                    .Select(x => x.CustomerCode)
                    .ToListAsync(cancellationToken);

                /*
                  TESLİM CARİSİ DE KAPSAMA GİRER (2026-09-06 kullanıcı bildirimi).

                  Şubeli bayide sipariş ANA firmaya yazılır, teslimat şubeye yapılır: fatura
                  carisi `CustomerCode` = 120-01-000515 (CHINA BAZAAR ana firma), teslim carisi
                  `DeliveryCustomerCode` = 01-000515-005 (Gazimağusa şubesi). İkisinin plasiyeri
                  FARKLI olabiliyor — ana firma bir plasiyerde, şube başka plasiyerde.

                  Süzgeç yalnız `CustomerCode`'a bakıyordu: şubenin plasiyeri kendi girdiği
                  siparişi raporda göremiyordu (ana firma onun portföyünde değil). Aynı dosyadaki
                  fatura kesme ucu (`GetInvoiceLines`) bunu zaten iki cari üzerinden süzüyor;
                  bu rapor o desenden ayrışmıştı.
                */
                orderQuery = orderQuery.Where(x =>
                    allowedCustomerCodes.Contains(x.CustomerCode) ||
                    (x.DeliveryCustomerCode != null && allowedCustomerCodes.Contains(x.DeliveryCustomerCode)));
            }
            else if (!string.IsNullOrEmpty(currentCode))
            {
                orderQuery = orderQuery.Where(x =>
                    x.CustomerCode == currentCode || x.DeliveryCustomerCode == currentCode);
            }
        }

        var invoiceLinesQuery = _dbContext.Set<InvoiceLine>().AsNoTracking();

        // Bkz. EcommerceInvoiceGate — parası çekilmiş e-ticaret siparişleri.
        var paidUninvoicedEcommerceOrderNos = B2B.Erp.Api.Features.Ecommerce.EcommerceInvoiceGate.PaidOrderNos(_dbContext);

        var lineRowsQuery =
            from line in _dbContext.Set<SalesOrderLine>().AsNoTracking()
            join order in orderQuery on line.SalesOrderId equals order.Id
            join cust in _dbContext.Customers.AsNoTracking() on order.CustomerCode equals cust.CustomerCode into custJoin
            from cust in custJoin.DefaultIfEmpty()
            // TESLİM CARİSİ (2026-09-06): sipariş ana firmaya yazılır, mal şubeye gider. Rapor
            // yalnız fatura carisini gösteriyordu; şube plasiyeri listede kendi müşterisini
            // göremeyip "bu satır neden bende" diye soruyordu.
            join dcust in _dbContext.Customers.AsNoTracking() on order.DeliveryCustomerCode equals dcust.CustomerCode into dcustJoin
            from dcust in dcustJoin.DefaultIfEmpty()
            join product in _dbContext.Set<Product>().AsNoTracking() on line.StockCode equals product.StockCode into productJoin
            from product in productJoin.DefaultIfEmpty()
            join installation in _dbContext.Set<Installation>().AsNoTracking() on line.InstallationId equals installation.Id into installationJoin
            from installation in installationJoin.DefaultIfEmpty()
            let invoicedQty = invoiceLinesQuery.Where(il => il.SalesOrderLineId == line.Id).Select(il => (decimal?)il.Quantity).Sum() ?? 0m
            let remainingQty = line.Quantity - invoicedQty
            // Bkz. EcommerceInvoiceGate — ödenmemiş/iptal e-ticaret siparişi bu raporda da
            // "faturalanmayı bekliyor" diye görünmemeli.
            where remainingQty > 0
                  && (order.ProcessedBy == null
                      || order.ProcessedBy.ToUpper() != B2B.Erp.Api.Features.Ecommerce.EcommerceInvoiceGate.OrderMarker
                      || (order.Status != B2B.Erp.Api.Features.Ecommerce.EcommerceFulfilmentService.CancelledStatus
                          && paidUninvoicedEcommerceOrderNos.Contains(order.OrderNo)))
            select new
            {
                OrderId = order.Id,
                order.ProcessedAt,
                order.OrderNo,
                CustomerName = cust != null ? cust.Name : string.Empty,
                CustomerInvoiceType = cust != null ? cust.InvoiceType : string.Empty,
                Plasiyer = cust != null ? cust.SalesmanCode : null,
                // Teslim carisi ana cariden FARKLIYSA anlamlı (şubeye teslim). Aynıysa ekranda
                // gösterilmez; her satıra aynı ismi iki kez yazmanın faydası yok.
                DeliveryCustomerCode = order.DeliveryCustomerCode,
                DeliveryCustomerName = dcust != null ? dcust.Name : string.Empty,
                DeliveryPlasiyer = dcust != null ? dcust.SalesmanCode : null,
                order.ProcessedBy,
                order.CampaignDiscount,
                SalesOrderLineId = line.Id,
                line.LineNo,
                line.StockCode,
                ProductName = product != null ? product.Name : string.Empty,
                line.Description,
                OrderQuantity = line.Quantity,
                DeliveredQuantity = invoicedQty,
                RemainingQuantity = remainingQty,
                UnitPrice = line.UnitPrice,
                // BELGENİN KENDİ PARA BİRİMİ (2026-08-19). `UnitPrice` TL çapasıdır; dolarla
                // satılan bir siparişin raporda TL faturadan ayırt edilebilmesi için satırın
                // para birimi ve dövizli fiyatı da gönderiliyor. Kur BURADA kullanılmıyor —
                // dövizli değer kalemin kendi alanından okunuyor.
                CurrencyTypeId = line.CurrencyTypeId,
                CurrencyUnitPrice = line.CurrencyUnitPrice,
                CurrencyRate = line.CurrencyRate,
                VatRate = line.VatRate,
                InstallationName = installation != null ? installation.InstallationName : null,
                // Kampanya hesabı için (bkz. aşağıda "KAMPANYA KDV MATRAHINDAN DÜŞER").
                line.DiscountAmount,
                line.IsGift,
                OrderSubtotal = order.Subtotal
            };

        if (q is not null)
        {
            lineRowsQuery = lineRowsQuery.Where(x =>
                x.OrderNo.ToLower().Contains(q) ||
                x.CustomerName.ToLower().Contains(q) ||
                x.StockCode.ToLower().Contains(q) ||
                x.ProductName.ToLower().Contains(q) ||
                (x.Description ?? string.Empty).ToLower().Contains(q)
            );
        }

        var lineRows = await lineRowsQuery
            .OrderByDescending(x => x.ProcessedAt)
            .ThenByDescending(x => x.OrderNo)
            .ThenBy(x => x.LineNo)
            .ToListAsync(cancellationToken);

        // Siparişin BÜTÜN kalemlerinin kampanya toplamı (faturalanmış olanlar dahil): sipariş
        // geneli kampanyanın "saf" payı = başlıktaki kampanya − kalem kampanyaları. Satış
        // faturasındaki hesabın aynısı (InvoicesController.CreateSalesInvoice).
        var kampanyaliSiparisIdleri = lineRows.Where(x => x.CampaignDiscount > 0m).Select(x => x.OrderId).Distinct().ToList();
        var kalemKampanyaToplami = kampanyaliSiparisIdleri.Count == 0
            ? new Dictionary<int, decimal>()
            : await _dbContext.Set<SalesOrderLine>()
                .AsNoTracking()
                .Where(l => kampanyaliSiparisIdleri.Contains(l.SalesOrderId))
                .GroupBy(l => l.SalesOrderId)
                // Hediyenin indirimi de kalem kampanyasıdır (bkz. InvoicesController, HEDİYE KALEMİNİN İNDİRİMİ).
                .Select(gr => new { gr.Key, Toplam = gr.Sum(l => l.DiscountAmount) })
                .ToDictionaryAsync(x => x.Key, x => x.Toplam, cancellationToken);

        var items = lineRows
            .GroupBy(x => new { x.OrderId, x.ProcessedAt, x.OrderNo, x.CustomerName, x.CustomerInvoiceType, x.Plasiyer, x.DeliveryCustomerCode, x.DeliveryCustomerName, x.DeliveryPlasiyer, x.ProcessedBy, x.CampaignDiscount })
            .OrderByDescending(g => g.Key.ProcessedAt)
            .ThenByDescending(g => g.Key.OrderNo)
            .Select(g =>
            {
                var subtotal = g.Sum(x => x.RemainingQuantity * x.UnitPrice);
                var vatTotal = g.Sum(x => (x.RemainingQuantity * x.UnitPrice) * (x.VatRate / 100m));
                var grandTotal = subtotal + vatTotal;

                // ====================================================================
                // BELGENİN KENDİ PARASINDAKİ TOPLAMLAR (2026-08-19).
                //
                // Yukarıdaki üç toplam TL çapasıdır ve öyle kalıyor ("TL Karşılığı" sütunu
                // onları basıyor). Rapor dolarlı siparişi kendi parasında da göstersin diye
                // kalemin `CurrencyUnitPrice`ı ayrıca toplanıyor — TL tutarını KURA BÖLMEK YOK
                // (rapor döviz kuralı: bölme, kalemin döviz alanını oku).
                //
                // Başlıktaki `CampaignDiscount` TL olduğu için ONA istisna: indirim kaleme bağlı
                // olmadığından siparişin donmuş kuruyla belgenin parasına indiriliyor.
                // Karışık dövizli sipariş yok (sepet izin vermiyor); yine de gelirse TL sayılır.
                // ====================================================================
                var lineCurrencies = g
                    .Select(x => B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(x.CurrencyTypeId))
                    .Distinct()
                    .ToList();

                var orderCurrencyTypeId = lineCurrencies.Count == 1
                    ? lineCurrencies[0]
                    : B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try;

                var isForeignOrder = !B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(orderCurrencyTypeId);

                var orderRate = 1m;
                if (isForeignOrder)
                {
                    var firstRate = g.Select(x => x.CurrencyRate).FirstOrDefault(r => r > 0m);
                    if (firstRate > 0m) orderRate = firstRate;
                }

                decimal DocPrice(decimal unitPrice, decimal currencyUnitPrice)
                    => isForeignOrder && currencyUnitPrice > 0m ? currencyUnitPrice : unitPrice;

                var docSubtotal = g.Sum(x => x.RemainingQuantity * DocPrice(x.UnitPrice, x.CurrencyUnitPrice));
                var docVatTotal = g.Sum(x => (x.RemainingQuantity * DocPrice(x.UnitPrice, x.CurrencyUnitPrice)) * (x.VatRate / 100m));
                var docDiscount = isForeignOrder && orderRate > 0m
                    ? Math.Round(g.Key.CampaignDiscount / orderRate, 2, MidpointRounding.AwayFromZero)
                    : g.Key.CampaignDiscount;

                // Kampanyasız siparişte aşağıdaki eski hesap AYNEN kalır.
                var discount = g.Key.CampaignDiscount;
                var netTotal = subtotal - g.Key.CampaignDiscount;
                var grand = (subtotal + vatTotal) - g.Key.CampaignDiscount;
                var docNet = docSubtotal - docDiscount;
                var docGrand = (docSubtotal + docVatTotal) - docDiscount;

                /*
                  KAMPANYA KDV MATRAHINDAN DÜŞER (2026-10-01, kullanıcı bildirimi: S26093023452112 —
                  brüt 24.761,90, kampanya 4.761,90, net 20.000,00 ama KDV 1.238,10 / genel 21.238,10).

                  Kampanya başlıkta KDV DAHİL gibi genel toplamdan düşülüyor, KDV ise indirimsiz
                  brütten alınıyordu: kampanyanın KDV'si fazladan görünüyordu. Kesilecek fatura
                  (InvoicesController, 2026-09-30) ile birebir: kalem kampanyası (`DiscountAmount`,
                  KDV HARİÇ) kendi kalemini ve kendi oranıyla KDV'sini küçültür; sipariş geneli
                  kampanyanın saf payı KDV dahil kalır. Yalnız KALAN (faturalanmamış) adet
                  sayılır. 20.000 + %5 = 21.000,00.
                */
                if (g.Key.CampaignDiscount > 0m)
                {
                    decimal satirNet = 0m, satirKdv = 0m, docSatirNet = 0m, docSatirKdv = 0m;
                    foreach (var x in g)
                    {
                        // Hediye kaleminin indirimi de kendi kalemini küçültür ("indirim satırı" modu).
                        if (x.DiscountAmount <= 0m || x.OrderQuantity <= 0m) continue;
                        var oran = Math.Min(1m, x.RemainingQuantity / x.OrderQuantity);
                        var tl = Math.Min(x.DiscountAmount * oran, x.RemainingQuantity * x.UnitPrice);
                        satirNet += tl;
                        satirKdv += tl * (x.VatRate / 100m);
                        var belge = isForeignOrder && x.CurrencyRate > 0m ? x.DiscountAmount / x.CurrencyRate : x.DiscountAmount;
                        var docTl = Math.Min(belge * oran, x.RemainingQuantity * DocPrice(x.UnitPrice, x.CurrencyUnitPrice));
                        docSatirNet += docTl;
                        docSatirKdv += docTl * (x.VatRate / 100m);
                    }

                    var saf = g.Key.CampaignDiscount - (kalemKampanyaToplami.TryGetValue(g.Key.OrderId, out var kt) ? kt : 0m);
                    var siparisSubtotal = g.First().OrderSubtotal;
                    var kalanBrut = g.Where(x => !x.IsGift).Sum(x => x.RemainingQuantity * x.UnitPrice);
                    var siparisGeneli = saf > 0m && siparisSubtotal > 0m
                        ? saf * Math.Min(1m, kalanBrut / siparisSubtotal)
                        : 0m;
                    var docSiparisGeneli = isForeignOrder && orderRate > 0m ? siparisGeneli / orderRate : siparisGeneli;

                    var tlSonuc = B2B.Erp.Api.Core.Accounting.InvoiceDiscountMath.Hesapla(
                        subtotal - Math.Min(satirNet, subtotal), vatTotal - Math.Min(satirKdv, vatTotal), siparisGeneli);
                    netTotal = tlSonuc.NetToplam;
                    vatTotal = tlSonuc.KdvToplam;
                    grand = tlSonuc.GenelToplam;
                    discount = decimal.Round(subtotal - netTotal, 2, MidpointRounding.AwayFromZero);

                    var docSonuc = B2B.Erp.Api.Core.Accounting.InvoiceDiscountMath.Hesapla(
                        docSubtotal - Math.Min(docSatirNet, docSubtotal), docVatTotal - Math.Min(docSatirKdv, docVatTotal), docSiparisGeneli);
                    docNet = docSonuc.NetToplam;
                    docVatTotal = docSonuc.KdvToplam;
                    docGrand = docSonuc.GenelToplam;
                    docDiscount = decimal.Round(docSubtotal - docNet, 2, MidpointRounding.AwayFromZero);
                }

                return new
                {
                    Id = g.Key.OrderId,
                    g.Key.ProcessedAt,
                    g.Key.OrderNo,
                    g.Key.CustomerName,
                    g.Key.CustomerInvoiceType,
                    g.Key.Plasiyer,
                    g.Key.DeliveryCustomerCode,
                    g.Key.DeliveryCustomerName,
                    g.Key.DeliveryPlasiyer,
                    Subtotal = subtotal,
                    Discount = discount,
                    NetTotal = netTotal,
                    VatTotal = vatTotal,
                    GrandTotal = grand,
                    CurrencyTypeId = orderCurrencyTypeId,
                    CurrencyCode = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.ToCodeOrTry(orderCurrencyTypeId),
                    CurrencyRate = orderRate,
                    DovizSubtotal = docSubtotal,
                    DovizDiscount = docDiscount,
                    DovizNetTotal = docNet,
                    DovizVatTotal = docVatTotal,
                    DovizGrandTotal = docGrand,
                    g.Key.ProcessedBy,
                    Lines = g.Select(x => new
                    {
                        x.SalesOrderLineId,
                        x.LineNo,
                        x.StockCode,
                        x.ProductName,
                        x.Description,
                        x.OrderQuantity,
                        x.DeliveredQuantity,
                        Quantity = x.RemainingQuantity,
                        x.RemainingQuantity,
                        x.UnitPrice,
                        x.CurrencyTypeId,
                        x.CurrencyRate,
                        x.CurrencyUnitPrice,
                        x.VatRate,
                        x.InstallationName,
                        LineTotal = x.RemainingQuantity * x.UnitPrice
                    }).ToList()
                };
            })
            .ToList();

        // Genel toplamlar TL çapasından (dört para birimi tek ölçüde toplanabilsin diye);
        // para birimi başına kırılım ayrı ve ÇEVRİLMEDEN.
        var totals = new
        {
            BrutTutar = items.Sum(x => x.Subtotal),
            Iskonto = items.Sum(x => x.Discount),
            NetTutar = items.Sum(x => x.NetTotal),
            KdvTutari = items.Sum(x => x.VatTotal),
            GenelToplam = items.Sum(x => x.GrandTotal),
            ByCurrency = items
                .GroupBy(x => x.CurrencyTypeId)
                .OrderBy(g => g.Key)
                .Select(g => new
                {
                    CurrencyTypeId = g.Key,
                    CurrencyCode = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.ToCodeOrTry(g.Key),
                    BrutTutar = g.Sum(x => x.DovizSubtotal),
                    Iskonto = g.Sum(x => x.DovizDiscount),
                    NetTutar = g.Sum(x => x.DovizNetTotal),
                    KdvTutari = g.Sum(x => x.DovizVatTotal),
                    GenelToplam = g.Sum(x => x.DovizGrandTotal),
                    TlKarsiligi = g.Sum(x => x.GrandTotal)
                })
                .ToList()
        };

        return Ok(new { success = true, data = new { items, totals } });
    }

    [AtomicRequest]
    [HttpDelete("lines/{salesOrderLineId:int}")]
    [AuthorizePage("reports", "siparisRaporu")]
    [AuthorizePage("invoice", "satisFatura")]
    public async Task<IActionResult> DeleteSalesOrderLine([FromRoute] int salesOrderLineId, [FromQuery] decimal? quantity, CancellationToken cancellationToken)
    {
        var line = await _dbContext.Set<SalesOrderLine>()
            .FirstOrDefaultAsync(x => x.Id == salesOrderLineId, cancellationToken);

        if (line is null)
        {
            return NotFound(new { success = false, message = "Sipariş satırı bulunamadı" });
        }

        var invoicedQty = await _dbContext.Set<InvoiceLine>()
            .AsNoTracking()
            .Where(x => x.SalesOrderLineId == salesOrderLineId)
            .Select(x => (decimal?)x.Quantity)
            .SumAsync(cancellationToken) ?? 0m;

        var remainingQty = line.Quantity - invoicedQty;
        if (remainingQty <= 0)
        {
            return BadRequest(new { success = false, message = "Kalem zaten tamamen faturalanmış" });
        }

        var reduceQty = quantity;
        if (reduceQty is not null)
        {
            if (reduceQty <= 0)
            {
                return BadRequest(new { success = false, message = "Miktar 0'dan büyük olmalıdır" });
            }
            if (reduceQty > remainingQty)
            {
                return BadRequest(new { success = false, message = "Silinecek miktar kalan miktardan büyük olamaz" });
            }
        }

        var order = await _dbContext.Set<SalesOrder>()
            .Include(x => x.Lines)
            .FirstOrDefaultAsync(x => x.Id == line.SalesOrderId, cancellationToken);

        if (order is null)
        {
            return NotFound(new { success = false, message = "Sipariş bulunamadı" });
        }

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, order, "deleteRule/siparis", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        Installation? installation = null;
        if (line.InstallationId is not null)
        {
            installation = await _dbContext.Set<Installation>()
                .FirstOrDefaultAsync(x => x.Id == line.InstallationId.Value, cancellationToken);
        }

        var deleteWholeLine = reduceQty is null || reduceQty.Value >= remainingQty;

        if (deleteWholeLine)
        {
            // If line has invoiced quantity, we only clear the remaining (uninvoiced) part.
            // Keep the line so that if invoice lines are deleted later, it can re-appear in Satış Faturası.
            if (invoicedQty > 0)
            {
                var details = new
                {
                    salesOrderId = line.SalesOrderId,
                    salesOrderLineId = line.Id,
                    stockCode = line.StockCode,
                    previousQty = line.Quantity,
                    invoicedQty,
                    removedRemainingQty = remainingQty,
                    mode = "clamp_to_invoiced"
                };

                var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
                if (string.IsNullOrWhiteSpace(username)) username = "System";

                _dbContext.Set<DeletionLog>().Add(new DeletionLog
                {
                    ModuleKey = "reports",
                    PageKey = "siparisRaporu",
                    RecordType = "SiparisKalemi",
                    RecordId = line.Id.ToString(),
                    ParentType = "Siparis",
                    ParentId = line.SalesOrderId.ToString(),
                    Description = $"Sipariş kalemi kalan miktar silindi (faturalı kısım korunur): {line.StockCode} / {remainingQty}",
                    DetailsJson = JsonSerializer.Serialize(details),
                    CreateUser = username,
                    CreateTime = DateTime.UtcNow
                });

                order.CampaignDiscount -= KalemAdediniDegistir(line, invoicedQty);
                if (installation is not null)
                {
                    installation.Quantity = invoicedQty;
                }

                await _dbContext.SaveChangesAsync(cancellationToken);
            }
            else
            {
                var details = new
                {
                    salesOrderId = line.SalesOrderId,
                    salesOrderLineId = line.Id,
                    stockCode = line.StockCode,
                    qty = line.Quantity,
                    mode = "hard_delete"
                };

                var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
                if (string.IsNullOrWhiteSpace(username)) username = "System";

                _dbContext.Set<DeletionLog>().Add(new DeletionLog
                {
                    ModuleKey = "reports",
                    PageKey = "siparisRaporu",
                    RecordType = "SiparisKalemi",
                    RecordId = line.Id.ToString(),
                    ParentType = "Siparis",
                    ParentId = line.SalesOrderId.ToString(),
                    Description = $"Sipariş kalemi silindi: {line.StockCode} / {line.Quantity}",
                    DetailsJson = JsonSerializer.Serialize(details),
                    CreateUser = username,
                    CreateTime = DateTime.UtcNow
                });

                // Kalemin kampanyası siparişin kampanya toplamından da düşer.
                order.CampaignDiscount -= line.DiscountAmount;
                _dbContext.Set<SalesOrderLine>().Remove(line);
                if (installation is not null)
                {
                    _dbContext.Set<Installation>().Remove(installation);
                }

                await _dbContext.SaveChangesAsync(cancellationToken);
            }
        }
        else
        {
            order.CampaignDiscount -= KalemAdediniDegistir(line, line.Quantity - reduceQty!.Value);
            if (installation is not null)
            {
                installation.Quantity = Math.Max(0, installation.Quantity - reduceQty.Value);
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        var remaining = await _dbContext.Set<SalesOrderLine>()
            .Where(x => x.SalesOrderId == order.Id)
            .OrderBy(x => x.LineNo)
            .ToListAsync(cancellationToken);

        if (remaining.Count == 0)
        {
            _dbContext.Set<SalesOrder>().Remove(order);
            await _dbContext.SaveChangesAsync(cancellationToken);
            return Ok(new { success = true });
        }

        for (var i = 0; i < remaining.Count; i++)
        {
            remaining[i].LineNo = i + 1;
        }

        SiparisToplamlariniKur(order, remaining);

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    /*
      SİPARİŞ KALEMİNİN ADEDİ DÜŞERKEN KAMPANYASI DA DÜŞER (2026-10-01).

      `DiscountAmount` kalemin TÜM adedi için tutulur; fatura onu "fatura adedi / kalem adedi"
      oranında alır. Kalan adet silinip kalem adedi küçültülünce indirim eski adede göre kalıyordu:
      2 adet / 600 TL kampanyalı kalem 1 adede inince fatura 600'ün tamamını tek adede düşüyordu.
      İndirim adetle aynı oranda küçülür (adet başına indirim korunur); düşen tutar döner, çağıran
      siparişin `CampaignDiscount` toplamından düşer. Kampanya YENİDEN DEĞERLENMEZ (koşul
      artık sağlanmıyor olabilir — o ayrı karar), yalnız tutarlılık korunur.
    */
    private static decimal KalemAdediniDegistir(SalesOrderLine line, decimal yeniAdet)
    {
        var eskiIndirim = line.DiscountAmount;
        if (line.Quantity > 0m && line.DiscountAmount > 0m && yeniAdet < line.Quantity)
        {
            line.DiscountAmount = decimal.Round(line.DiscountAmount * yeniAdet / line.Quantity, 2, MidpointRounding.AwayFromZero);
        }
        line.Quantity = yeniAdet;
        return eskiIndirim - line.DiscountAmount;
    }

    /*
      SİPARİŞ TOPLAMLARI KAMPANYA MOTORUNUN FORMÜLÜYLE (2026-10-01).

      Kalem silinince başlık toplamı yeniden kuruluyordu ama iki yol iki ayrı yanlış yapıyordu:
      biri kampanyayı hiç düşmüyor (toplam şişiyordu), öteki KDV'yi indirimsiz brütten alıp
      kampanyayı KDV dahil düşüyordu. Doğrusu `CampaignService.BuildResponse` ile aynı: kalemin
      KDV'si kampanyası düşülmüş tutarından, genel toplam = brüt − kampanya + KDV.
      Kampanyasız siparişte sonuç eskisiyle birebir aynıdır.
    */
    private static void SiparisToplamlariniKur(SalesOrder order, IReadOnlyCollection<SalesOrderLine> lines)
    {
        if (order.CampaignDiscount < 0m) order.CampaignDiscount = 0m;

        var subtotal = lines.Sum(x => x.Quantity * x.UnitPrice);
        var vatTotal = lines.Sum(x => Math.Max(0m, x.Quantity * x.UnitPrice - x.DiscountAmount) * (x.VatRate / 100m));
        var grandTotal = subtotal - order.CampaignDiscount + vatTotal;
        if (grandTotal < 0m) grandTotal = 0m;

        order.Subtotal = subtotal;
        order.VatTotal = vatTotal;
        order.GrandTotal = grandTotal;
    }

    [HttpGet("lines/{salesOrderLineId:int}/installation")]
    [AuthorizePage("invoice", "faturaDokum")]
    public async Task<IActionResult> GetLineInstallation([FromRoute] int salesOrderLineId, CancellationToken cancellationToken = default)
    {
        var line = await (
                from l in _dbContext.Set<SalesOrderLine>().AsNoTracking()
                join o in _dbContext.Set<SalesOrder>().AsNoTracking() on l.SalesOrderId equals o.Id
                join c in _dbContext.Customers.AsNoTracking() on o.CustomerCode equals c.CustomerCode into custJoin
                from c in custJoin.DefaultIfEmpty()
                join p in _dbContext.Set<Product>().AsNoTracking() on l.StockCode equals p.StockCode into prodJoin
                from p in prodJoin.DefaultIfEmpty()
                where l.Id == salesOrderLineId
                select new
                {
                    LineId = l.Id,
                    l.InstallationId,
                    DealerName = c != null ? c.Name : string.Empty,
                    ProductName = p != null ? p.Name : l.StockCode,
                    Quantity = l.Quantity
                }
            )
            .FirstOrDefaultAsync(cancellationToken);

        if (line is null)
        {
            return NotFound(new { success = false, message = "Sipariş satırı bulunamadı" });
        }

        Installation? installation = null;
        if (line.InstallationId is not null)
        {
            installation = await _dbContext.Set<Installation>()
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == line.InstallationId.Value, cancellationToken);
        }

        if (installation is null)
        {
            return Ok(new
            {
                success = true,
                data = new
                {
                    installationId = (int?)null,
                    dealerName = line.DealerName,
                    productName = line.ProductName,
                    quantity = line.Quantity,
                    installationName = (string?)null,
                    installationPhone = (string?)null,
                    address = string.Empty,
                    region = string.Empty,
                    dealerDescription = (string?)null
                }
            });
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                installationId = installation.Id,
                dealerName = installation.DealerName,
                productName = installation.ProductName,
                quantity = installation.Quantity,
                installationName = installation.InstallationName,
                installationPhone = installation.InstallationPhone,
                address = installation.Address,
                region = installation.Region,
                dealerDescription = installation.DealerDescription
            }
        });
    }

    [AtomicRequest]
    [HttpPut("lines/{salesOrderLineId:int}/installation")]
    [AuthorizePage("invoice", "faturaDokum")]
    public async Task<IActionResult> UpsertLineInstallation([FromRoute] int salesOrderLineId, [FromBody] UpsertInstallationRequest request, CancellationToken cancellationToken = default)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var line = await _dbContext.Set<SalesOrderLine>()
            .FirstOrDefaultAsync(x => x.Id == salesOrderLineId, cancellationToken);

        if (line is null)
        {
            return NotFound(new { success = false, message = "Sipariş satırı bulunamadı" });
        }

        var now = DateTime.UtcNow;
        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        Installation? installation = null;
        if (line.InstallationId is not null)
        {
            installation = await _dbContext.Set<Installation>()
                .FirstOrDefaultAsync(x => x.Id == line.InstallationId.Value, cancellationToken);
        }

        if (installation is null)
        {
            installation = new Installation
            {
                DealerName = (request.DealerName ?? string.Empty).Trim(),
                ProductName = (request.ProductName ?? string.Empty).Trim(),
                Quantity = request.Quantity,
                InstallationName = string.IsNullOrWhiteSpace(request.InstallationName) ? null : request.InstallationName.Trim(),
                InstallationPhone = string.IsNullOrWhiteSpace(request.InstallationPhone) ? null : request.InstallationPhone.Trim(),
                Address = (request.Address ?? string.Empty).Trim(),
                Region = (request.Region ?? string.Empty).Trim(),
                DealerDescription = string.IsNullOrWhiteSpace(request.DealerDescription) ? null : request.DealerDescription.Trim(),
                CreateUser = username,
                CreateTime = now,
                EditUser = null,
                EditTime = null
            };

            _dbContext.Set<Installation>().Add(installation);
            await _dbContext.SaveChangesAsync(cancellationToken);

            line.InstallationId = installation.Id;
            line.EditUser = username;
            line.EditTime = now;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        else
        {
            installation.DealerName = (request.DealerName ?? string.Empty).Trim();
            installation.ProductName = (request.ProductName ?? string.Empty).Trim();
            installation.Quantity = request.Quantity;
            installation.InstallationName = string.IsNullOrWhiteSpace(request.InstallationName) ? null : request.InstallationName.Trim();
            installation.InstallationPhone = string.IsNullOrWhiteSpace(request.InstallationPhone) ? null : request.InstallationPhone.Trim();
            installation.Address = (request.Address ?? string.Empty).Trim();
            installation.Region = (request.Region ?? string.Empty).Trim();
            installation.DealerDescription = string.IsNullOrWhiteSpace(request.DealerDescription) ? null : request.DealerDescription.Trim();
            installation.EditUser = username;
            installation.EditTime = now;

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return Ok(new { success = true, data = new { installationId = installation.Id } });
    }

    [AtomicRequest]
    [HttpDelete("{salesOrderId:int}")]
    [AuthorizePage("reports", "siparisRaporu")]
    [AuthorizePage("reports", "aktifSepetRaporu")]
    public async Task<IActionResult> DeleteSalesOrder([FromRoute] int salesOrderId, CancellationToken cancellationToken)
    {
        var linkedIrsaliye = await _dbContext.Set<Irsaliye>()
            .Where(x => x.TransferredSalesOrderId == salesOrderId)
            .ToListAsync(cancellationToken);

        var order = await _dbContext.Set<SalesOrder>()
            .Include(x => x.Lines)
            .FirstOrDefaultAsync(x => x.Id == salesOrderId, cancellationToken);

        if (order is null)
        {
            return NotFound(new { success = false, message = "Sipariş bulunamadı" });
        }

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, order, "deleteRule/siparis", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        // Yedek (geri yükleme) siparişin ORİJİNAL kampanya toplamını taşımalı; aşağıda kalemler
        // silindikçe `CampaignDiscount` küçülüyor.
        var ilkKampanyaIndirimi = order.CampaignDiscount;

        var originalLines = order.Lines.Select(l => new SalesOrderLine
        {
            Id = l.Id,
            SalesOrderId = l.SalesOrderId,
            InstallationId = l.InstallationId,
            StockCode = l.StockCode,
            Description = l.Description,
            Quantity = l.Quantity,
            UnitPrice = l.UnitPrice,
            CurrencyTypeId = l.CurrencyTypeId,
            CurrencyRate = l.CurrencyRate,
            CurrencyUnitPrice = l.CurrencyUnitPrice,
            VatRate = l.VatRate,
            IsGift = l.IsGift,
            DiscountAmount = l.DiscountAmount,
            LineNo = l.LineNo,
            CampaignCode = l.CampaignCode,
            Montage = l.Montage,
            GroupId = l.GroupId,
            OrderNo = l.OrderNo,
            CreateUser = l.CreateUser,
            CreateTime = l.CreateTime
        }).ToList();

        var lineIds = order.Lines.Select(x => x.Id).ToList();
        var invoicedMap = new Dictionary<int, decimal>();
        if (lineIds.Count > 0)
        {
            invoicedMap = await _dbContext.Set<InvoiceLine>()
                .AsNoTracking()
                .Where(x => x.SalesOrderLineId.HasValue && lineIds.Contains(x.SalesOrderLineId.Value))
                .GroupBy(x => x.SalesOrderLineId!.Value)
                .Select(g => new { SalesOrderLineId = g.Key, Qty = g.Sum(x => (decimal?)x.Quantity) ?? 0m })
                .ToDictionaryAsync(x => x.SalesOrderLineId, x => x.Qty, cancellationToken);
        }

        var installationIdsToRemove = new List<int>();

        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        foreach (var line in order.Lines.ToList())
        {
            var invoicedQty = invoicedMap.TryGetValue(line.Id, out var q) ? q : 0m;
            var remainingQty = line.Quantity - invoicedQty;

            if (remainingQty <= 0)
            {
                continue;
            }

            if (invoicedQty <= 0)
            {
                var details = new
                {
                    salesOrderId = order.Id,
                    salesOrderLineId = line.Id,
                    stockCode = line.StockCode,
                    qty = line.Quantity,
                    mode = "hard_delete"
                };

                _dbContext.Set<DeletionLog>().Add(new DeletionLog
                {
                    ModuleKey = "reports",
                    PageKey = "siparisRaporu",
                    RecordType = "SiparisKalemi",
                    RecordId = line.Id.ToString(),
                    ParentType = "Siparis",
                    ParentId = order.Id.ToString(),
                    Description = $"Sipariş kalemi silindi (sipariş sil): {line.StockCode} / {line.Quantity}",
                    DetailsJson = JsonSerializer.Serialize(details),
                    CreateUser = username,
                    CreateTime = DateTime.UtcNow
                });

                if (line.InstallationId is not null)
                {
                    installationIdsToRemove.Add(line.InstallationId.Value);
                }
                order.CampaignDiscount -= line.DiscountAmount;
                _dbContext.Set<SalesOrderLine>().Remove(line);
                order.Lines.Remove(line);
            }
            else
            {
                var details = new
                {
                    salesOrderId = order.Id,
                    salesOrderLineId = line.Id,
                    stockCode = line.StockCode,
                    previousQty = line.Quantity,
                    invoicedQty,
                    removedRemainingQty = remainingQty,
                    mode = "clamp_to_invoiced"
                };

                _dbContext.Set<DeletionLog>().Add(new DeletionLog
                {
                    ModuleKey = "reports",
                    PageKey = "siparisRaporu",
                    RecordType = "SiparisKalemi",
                    RecordId = line.Id.ToString(),
                    ParentType = "Siparis",
                    ParentId = order.Id.ToString(),
                    Description = $"Sipariş kalemi kalan miktar silindi (sipariş sil): {line.StockCode} / {remainingQty}",
                    DetailsJson = JsonSerializer.Serialize(details),
                    CreateUser = username,
                    CreateTime = DateTime.UtcNow
                });

                order.CampaignDiscount -= KalemAdediniDegistir(line, invoicedQty);
                if (line.InstallationId is not null)
                {
                    var inst = await _dbContext.Set<Installation>()
                        .FirstOrDefaultAsync(x => x.Id == line.InstallationId.Value, cancellationToken);
                    if (inst is not null)
                    {
                        inst.Quantity = invoicedQty;
                    }
                }
            }
        }

        if (installationIdsToRemove.Count > 0)
        {
            var installations = await _dbContext.Set<Installation>()
                .Where(x => installationIdsToRemove.Contains(x.Id))
                .ToListAsync(cancellationToken);
            foreach (var inst in installations)
            {
                inst.Status = "Planlandı";
            }
        }

        if (linkedIrsaliye.Count > 0)
        {
            var marker = "FATURAYA_AKTARILDI";
            foreach (var irs in linkedIrsaliye)
            {
                irs.TransferredSalesOrderId = null;

                var desc = (irs.Description ?? string.Empty);
                if (!string.IsNullOrWhiteSpace(desc) && desc.Contains(marker, StringComparison.OrdinalIgnoreCase))
                {
                    var cleaned = string.Join(
                        " | ",
                        desc.Split('|')
                            .Select(p => p.Trim())
                            .Where(p => !string.IsNullOrWhiteSpace(p) && !string.Equals(p, marker, StringComparison.OrdinalIgnoreCase))
                    );
                    irs.Description = string.IsNullOrWhiteSpace(cleaned) ? null : cleaned;
                }
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        var remainingLines = await _dbContext.Set<SalesOrderLine>()
            .Where(x => x.SalesOrderId == order.Id)
            .OrderBy(x => x.LineNo)
            .ToListAsync(cancellationToken);

        if (remainingLines.Count == 0)
        {
            var backupData = new
            {
                order.CustomerCode,
                order.DeliveryCustomerCode,
                order.Subtotal,
                order.VatTotal,
                order.GrandTotal,
                CampaignDiscount = ilkKampanyaIndirimi,
                order.CampaignDetailsJson,
                order.Status,
                order.OrderNo,
                order.ProcessedBy,
                order.ProcessedAt,
                order.CreateUser,
                order.CreateTime,
                Lines = originalLines.Select(l => new
                {
                    l.InstallationId,
                    l.StockCode,
                    l.Description,
                    l.Quantity,
                    l.UnitPrice,
                    l.CurrencyTypeId,
                    l.CurrencyRate,
                    l.CurrencyUnitPrice,
                    l.VatRate,
                    l.IsGift,
                    l.DiscountAmount,
                    l.LineNo,
                    l.CampaignCode,
                    l.Montage,
                    l.GroupId,
                    l.OrderNo,
                    l.CreateUser,
                    l.CreateTime
                }).ToList()
            };

            _dbContext.Set<DeletionLog>().Add(new DeletionLog
            {
                ModuleKey = "reports",
                PageKey = "siparisRaporu",
                RecordType = "Siparis",
                RecordId = order.Id.ToString(),
                ParentType = null,
                ParentId = null,
                Description = $"Sipariş silindi: {order.OrderNo}. [Etki: Sipariş silindi.]",
                DetailsJson = JsonSerializer.Serialize(backupData),
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            });

            string? linkedServiceRecordId = null;
            string sourcePage = "AtolyeAriza";
            if (!string.IsNullOrWhiteSpace(order.CampaignDetailsJson))
            {
                try
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(order.CampaignDetailsJson);
                    if (doc.RootElement.TryGetProperty("serviceRecordId", out var sIdProp))
                    {
                        linkedServiceRecordId = sIdProp.GetString();
                    }
                    if (string.IsNullOrWhiteSpace(linkedServiceRecordId) && doc.RootElement.TryGetProperty("serviceNumber", out var sNoProp))
                    {
                        linkedServiceRecordId = sNoProp.GetString();
                    }
                    if (doc.RootElement.TryGetProperty("sourcePage", out var srcProp))
                    {
                        sourcePage = srcProp.GetString() ?? "AtolyeAriza";
                    }
                }
                catch { }
            }

            _dbContext.Set<SalesOrder>().Remove(order);
            await _dbContext.SaveChangesAsync(cancellationToken);

            if (!string.IsNullOrWhiteSpace(linkedServiceRecordId))
            {
                try
                {
                    var serviceOpsBaseUrl = _configuration["ServiceOps:BaseUrl"] ?? "http://localhost:5137";
                    if (!serviceOpsBaseUrl.EndsWith("/")) serviceOpsBaseUrl += "/";

                    using var client = new System.Net.Http.HttpClient();
                    var dummyContent = new System.Net.Http.StringContent("{}", System.Text.Encoding.UTF8, "application/json");
                    await client.PostAsync($"{serviceOpsBaseUrl}api/servicerecords/{linkedServiceRecordId}/revert-to-ready?sourcePage={sourcePage}", dummyContent, cancellationToken);
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"[ServiceOps Integration] Revert ServiceRecord error: {ex.Message}");
                }
            }

            return Ok(new { success = true });
        }

        for (var i = 0; i < remainingLines.Count; i++)
        {
            remainingLines[i].LineNo = i + 1;
        }

        // Kampanya motorunun formülüyle (bkz. SiparisToplamlariniKur). Önceki hâl kampanyayı KDV
        // dahil düşüp KDV'yi indirimsiz brütten alıyordu.
        SiparisToplamlariniKur(order, remainingLines);

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPost("confirm")]
    [AuthorizePage("invoice", "siparis")]
    public async Task<IActionResult> Confirm([FromBody] ConfirmSalesOrderRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var cariKodu = (request.CariKodu ?? string.Empty).Trim();
        var teslimCariKodu = (request.TeslimCariKodu ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(cariKodu))
        {
            ModelState.AddModelError(nameof(request.CariKodu), "CARI_KODU zorunludur");
        }

        if (string.IsNullOrWhiteSpace(teslimCariKodu))
        {
            ModelState.AddModelError(nameof(request.TeslimCariKodu), "TESLIM_CARI_KODU zorunludur");
        }

        if (request.Lines == null || request.Lines.Count == 0)
        {
            ModelState.AddModelError(nameof(request.Lines), "En az 1 kalem zorunludur");
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var lines = request.Lines!;

        var stockCodes = lines
            .Select(x => (x.StokKodu ?? string.Empty).Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.Ordinal)
            .ToList();

        var productsForCurrency = await _dbContext.Products
            .AsNoTracking()
            .Where(x => stockCodes.Contains(x.StockCode))
            .Select(x => new
            {
                x.StockCode,
                x.SalesCurrencyCode,
                SellingCurrency = x.ProductPrices.Select(pp => pp.Currency).FirstOrDefault(),
                x.CurrencyCode
            })
            .ToListAsync(cancellationToken);

        // SATIŞ DÖVİZİNİN ÇAPASI `Product.SalesCurrencyCode`tir.
        // Önceden fiyat satırlarından FİLTRESİZ `FirstOrDefault()` alınıyordu: hangi fiyat
        // grubunun para birimi geleceği rastgele. Üstelik hiç fiyat satırı yoksa (ya da
        // `Currency` boşsa) doğrudan 0 = TL'ye düşülüyor, ürünün kendi satış dövizi hiç
        // sorulmuyordu: 100 $'lık ürün siparişe `CurrencyTypeId = 0, kur 1` ile girip
        // 100 ₺'ye satılıyordu. Fiyat satırı yalnızca ÇAPA BOŞSA yedek olarak kullanılır.
        var currencyCodeByStockCode = productsForCurrency.ToDictionary(
            x => x.StockCode,
            x =>
            {
                var anchor = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(x.SalesCurrencyCode);
                if (!B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(anchor)) return anchor;

                return !string.IsNullOrWhiteSpace(x.SellingCurrency)
                    ? B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyStringToProductCurrencyCode(x.SellingCurrency, 0)
                    : anchor;
            },
            StringComparer.OrdinalIgnoreCase);

        var installableByStockCode = await _dbContext.Products
            .AsNoTracking()
            .Where(x => stockCodes.Contains(x.StockCode))
            .Select(x => new { x.StockCode, x.IsInstallable })
            .ToDictionaryAsync(x => x.StockCode, x => x.IsInstallable, cancellationToken);

        foreach (var line in lines)
        {
            if (!line.Montaj) continue;
            var stockCode = (line.StokKodu ?? string.Empty).Trim();
            if (!installableByStockCode.TryGetValue(stockCode, out var isInstallable) || !isInstallable)
            {
                return BadRequest(new { success = false, message = $"Bu ürün için montaj seçeneği yok: {stockCode}" });
            }
        }

        var (username, fromServiceApp) = ResolveActingUserWithOrigin();

        var now = DateTime.UtcNow;

        var siparisNo = await GenerateSiparisNo(cancellationToken);

        var orderedLines = lines.OrderBy(x => x.Sira).ToList();

        var teslimCustomerType = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == teslimCariKodu)
            .Select(x => x.CustomerType)
            .FirstOrDefaultAsync(cancellationToken);

        var isTeslimMagaza = !string.IsNullOrWhiteSpace(teslimCustomerType) &&
                             (string.Equals(teslimCustomerType.Trim(), "Mağaza", StringComparison.OrdinalIgnoreCase) ||
                              string.Equals(teslimCustomerType.Trim(), "Magaza", StringComparison.OrdinalIgnoreCase));

        var pricingCustomerCode = isTeslimMagaza ? teslimCariKodu : cariKodu;

        var orderCustomer = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == cariKodu || x.CustomerCode == pricingCustomerCode)
            .FirstOrDefaultAsync(cancellationToken);

        int? orderCustomerPgCode = null;
        if (orderCustomer?.PriceGroupId != null)
        {
            orderCustomerPgCode = await _dbContext.PriceGroups
                .AsNoTracking()
                .Where(pg => pg.Id == orderCustomer.PriceGroupId.Value)
                .Select(pg => (int?)pg.Code)
                .FirstOrDefaultAsync(cancellationToken);
        }

        var isAskeriyeOrder = orderCustomer != null && (
            (orderCustomer.InvoiceType != null && (orderCustomer.InvoiceType.Equals("ASKERIYE", StringComparison.OrdinalIgnoreCase) || orderCustomer.InvoiceType.Equals("ASKERİYE", StringComparison.OrdinalIgnoreCase))) ||
            (orderCustomerPgCode.HasValue && orderCustomerPgCode.Value == 7)
        );

        var isAcikOrder = orderCustomer != null && (
            (orderCustomer.InvoiceType != null && (orderCustomer.InvoiceType.Equals("ACIK", StringComparison.OrdinalIgnoreCase) || orderCustomer.InvoiceType.Equals("AÇIK", StringComparison.OrdinalIgnoreCase))) ||
            (orderCustomerPgCode.HasValue && orderCustomerPgCode.Value >= 4 && orderCustomerPgCode.Value <= 6)
        );

        var isNoVatOrder = isAskeriyeOrder || isAcikOrder;

        var tryRateCache = new Dictionary<int, decimal>();

        var evalLines = new List<EvaluateSalesOrderLineRequest>();

        // Siparişin para birimi — kredi limiti buna göre ölçülür. Kalemlerin fiyatı
        // (`l.Fiyat`) kalemin KENDİ parasındadır, dolayısıyla `genelToplam` da o paradadır.
        var evalLineCurrencies = new HashSet<int>();

        // Para birimi başına DONMUŞ kur. `tryRateCache` yetmez: kur istekle geldiyse
        // (`l.CurrencyRate`) oraya hiç yazılmıyor.
        var orderRateByCurrency = new Dictionary<int, decimal>();

        foreach (var l in orderedLines)
        {
            var stockCode = (l.StokKodu ?? string.Empty).Trim();
            var productCurrencyCode = currencyCodeByStockCode.TryGetValue(stockCode, out var pcc) ? pcc : 0;
            var inferredCurrencyTypeId = MapProductCurrencyCodeToCurrencyTypeId(productCurrencyCode);
            var currencyTypeId = l.CurrencyTypeId.HasValue ? Math.Max(1, l.CurrencyTypeId.Value) : inferredCurrencyTypeId;

            var rate = l.CurrencyRate.HasValue ? l.CurrencyRate.Value : 0m;
            if (currencyTypeId == 1)
            {
                rate = 1m;
            }
            else
            {
                if (rate <= 0m)
                {
                    if (!tryRateCache.TryGetValue(currencyTypeId, out rate))
                    {
                        rate = await ResolveTryRateAsync(currencyTypeId, cancellationToken);
                        tryRateCache[currencyTypeId] = rate;
                    }
                }
            }

            if (rate <= 0m) rate = 1m;

            var unitPrice = l.Fiyat;

            // 0 ile 1'in ikisi de TL: normalize edilmezse TL sepet "karışık" sayılıp
            // limit kontrolü ve çapa kuru yanlış dala giriyor.
            evalLineCurrencies.Add(B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(currencyTypeId));
            if (currencyTypeId > 1 && rate > 0m && !orderRateByCurrency.ContainsKey(currencyTypeId))
            {
                orderRateByCurrency[currencyTypeId] = rate;
            }

            evalLines.Add(new EvaluateSalesOrderLineRequest
            {
                StockCode = stockCode,
                Quantity = l.Miktar,
                UnitPrice = unitPrice,
                VatRate = isNoVatOrder ? 0m : l.KdvOran
            });
        }

        var evalRequest = new EvaluateSalesOrderRequest
        {
            CustomerCode = pricingCustomerCode,
            Lines = evalLines,
            PriceGroupCode = null
        };

        var eval = await _campaignService.EvaluateSalesOrder(evalRequest, cancellationToken);

        var kdvTutar = isNoVatOrder ? 0m : eval.TaxTotal;
        var campaignDiscount = eval.DiscountTotal;
        var araToplam = eval.Subtotal - campaignDiscount;

        // VAT is calculated on gross amount (pre-discount)
        var genelToplam = araToplam + kdvTutar;
        if (genelToplam < 0m) genelToplam = 0m;

        // ============================================================================
        // TL ÇAPASI — BELGENİN PARASININ YANINDA, YERİNE DEĞİL (2026-08-19).
        //
        // Yukarıdaki bütün hesap (kampanya motoru, indirim payları, KDV) SİPARİŞİN KENDİ
        // PARASINDA yürür ve öyle KALIR — motora dokunulmuyor. Yalnızca KAYDEDİLEN alanlar
        // TL'ye çevrilir:
        //   SalesOrderLine.UnitPrice / DiscountAmount, SalesOrder.* toplamları -> TL karşılığı
        //   SalesOrderLine.CurrencyUnitPrice                                   -> belgenin kendi parası
        //
        // NEDEN ŞART: `UnitPrice` sistemin GERİ KALANINDA TL çapası kabul ediliyor —
        // irsaliye, servis siparişi ve e-ticaret yolları TL yazıyor, sipariş raporu ₺ ile
        // basıyor, faturaya aktarımda `DiscountAmount` ile satır tabanının AYNI ölçüde olması
        // gerekiyor. Bu alanı belgenin parasında bırakmak dolarlı siparişi raporda 48 kat
        // küçük bir TL tutarı gibi gösteriyordu.
        //
        // Kur siparişin DONMUŞ kurudur, sonradan yeniden hesaplanmaz: geçmiş belgeyi kaydırır.
        // Karışık dövizli sepete izin yok; yine de gelirse çevrim YAPILMAZ (kur 1) — limit
        // kontrolünün ve belge başlığının davranışıyla aynı.
        // ============================================================================
        var orderCurrencyTypeId = evalLineCurrencies.Count == 1
            ? evalLineCurrencies.First()
            : B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try;

        var orderAnchorRate = 1m;
        if (!B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(orderCurrencyTypeId)
            && orderRateByCurrency.TryGetValue(orderCurrencyTypeId, out var resolvedAnchorRate)
            && resolvedAnchorRate > 0m)
        {
            orderAnchorRate = resolvedAnchorRate;
        }

        // Kampanya açıklaması satırın parasında yazılır; sabit "TL" etiketi dolarlı siparişte
        // yanlış para birimi gösteriyordu.
        var orderCurrencyLabel = orderCurrencyTypeId switch
        {
            2 => "EUR",
            3 => "USD",
            4 => "GBP",
            _ => "TL"
        };

        // Tutarlar 2, birim fiyatlar 4 hane — fatura yoluyla aynı.
        decimal ToTry(decimal docAmount)
            => orderAnchorRate == 1m ? docAmount : Math.Round(docAmount * orderAnchorRate, 2, MidpointRounding.AwayFromZero);

        decimal ToTryUnit(decimal docUnitPrice)
            => orderAnchorRate == 1m ? docUnitPrice : Math.Round(docUnitPrice * orderAnchorRate, 4, MidpointRounding.AwayFromZero);

        // LİMİT SİPARİŞİN KENDİ PARASINDA ÖLÇÜLÜR (2026-08-19): her para biriminin ayrı
        // limiti var, çevirme yok. `genelToplam` belgenin parasında olduğu için burada
        // ÇEVRİLMEZ.
        var limitCurrencyTypeId = orderCurrencyTypeId;

        /*
          KREDİ LİMİTİ YARIŞI (2026-08-20 kullanıcı kararı, denetim md. B1).

          Limit kontrolü ile siparişin yazılması arasında yüzlerce satır vardı ve arada HİÇBİR
          kilit yoktu: aynı carinin iki siparişi eşzamanlı geldiğinde ikisi de aynı "kalan
          limit"i okuyup ikisi de geçiyordu. Sonuç, limiti neredeyse iki katına çıkaran bir
          çift sipariş — kontrol vardı ama yalnızca tek kullanıcı varsayımıyla çalışıyordu.

          Çözüm klasik: kontrol ile yazma AYNI işlemin içine alınır ve cari satırı
          `FOR UPDATE` ile kilitlenir. Aynı cariye ikinci istek, birincisi bitene kadar
          burada bekler; sırası geldiğinde limit hesabını birincinin siparişi DAHİL okur.
          Kilit cari bazında olduğu için farklı carilerin siparişleri birbirini beklemez.

          Kilit yalnız cari kodu VARSA alınır: muhtelif/mağaza satışında cari satırı yoktur
          ve zaten limite de tabi değildir.
        */
        await using var creditLimitTx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        if (!string.IsNullOrWhiteSpace(cariKodu))
        {
            await _dbContext.Database.ExecuteSqlRawAsync(
                @"SELECT 1 FROM ""Customers"" WHERE ""CustomerCode"" = {0} FOR UPDATE",
                new object[] { cariKodu }, cancellationToken);
        }

        var limitEvaluation = await _creditLimitService.EvaluateAsync(
            cariKodu,
            genelToplam,
            limitCurrencyTypeId,
            cancellationToken);

        var limitAsimiOnaylandi = false;
        switch (limitEvaluation.Status)
        {
            case CreditLimitStatus.Exceeded:
                // LİMİT AŞIMIYLA ONAY (2026-10-14): yalnız yetkili rol + açık istekle geçilir.
                // Bayrak tek başına hiçbir şey açmaz; yetkisiz kullanıcıda engel aynen çalışır.
                if (request.LimitAsimiOnay && await CanApproveOverLimitAsync(cancellationToken))
                {
                    limitAsimiOnaylandi = true;
                    break;
                }
                return BadRequest(new
                {
                    success = false,
                    code = "CREDIT_LIMIT_EXCEEDED",
                    message = "Limitiniz yetersiz",
                    data = new
                    {
                        customerCode = cariKodu,
                        creditLimit = limitEvaluation.CreditLimit,
                        currencyTypeId = limitEvaluation.CurrencyTypeId,
                        currencySymbol = limitEvaluation.CurrencySymbol,
                        balance = limitEvaluation.Balance,
                        exposureBalance = limitEvaluation.ExposureBalance,
                        openOrdersRisk = limitEvaluation.OpenOrdersRisk,
                        openInvoicesRisk = limitEvaluation.OpenInvoicesRisk,
                        orderTotal = limitEvaluation.DocumentTotal,
                        projected = limitEvaluation.Projected
                    }
                });

            case CreditLimitStatus.SchemaOutdated:
                return BadRequest(new
                {
                    success = false,
                    code = "DB_SCHEMA_OUTDATED",
                    message = "Sipariş limit kontrolü için veritabanı şeması güncel değil. Lütfen migration'ları uygulayıp tekrar deneyin.",
                    data = new
                    {
                        customerCode = cariKodu,
                        sqlState = limitEvaluation.SqlState,
                        error = limitEvaluation.Error
                    }
                });

            case CreditLimitStatus.CalculationFailed:
                return BadRequest(new
                {
                    success = false,
                    code = "CREDIT_LIMIT_CALCULATION_FAILED",
                    message = "Sipariş limit kontrolü hesaplanırken hata oluştu.",
                    data = new
                    {
                        customerCode = cariKodu,
                        errorType = limitEvaluation.ErrorType,
                        error = limitEvaluation.Error,
                        innerError = limitEvaluation.InnerError
                    }
                });
        }

        var campaignDetailsJson = !string.IsNullOrWhiteSpace(request.CampaignDetailsJson)
            ? request.CampaignDetailsJson
            : JsonSerializer.Serialize(new
            {
                appliedCampaignIds = eval.AppliedCampaignIds,
                appliedPriceGroupId = eval.AppliedPriceGroupId,
                lines = eval.Lines,
                appliedCampaignDetails = eval.AppliedCampaignDetails
            });

        var order = new SalesOrder
        {
            CustomerCode = cariKodu,
            DeliveryCustomerCode = teslimCariKodu,
            // Başlık toplamları TL çapası (bkz. TL ÇAPASI notu). Kalem silme/azaltma yolu
            // toplamı `Quantity * UnitPrice`tan yeniden kuruyor; o da TL olduğu için ikisi
            // aynı ölçüde kalıyor.
            Subtotal = ToTry(eval.Subtotal),
            VatTotal = ToTry(kdvTutar),
            GrandTotal = ToTry(genelToplam),
            CampaignDiscount = ToTry(campaignDiscount),
            CampaignDetailsJson = campaignDetailsJson,
            Status = 0,
            OrderNo = siparisNo,
            ProcessedBy = username,
            ProcessedAt = now,
            CreateUser = username,
            CreateTime = now,
            EditUser = null,
            EditTime = null
        };

        var nonGiftEvalLines = eval.Lines.Where(x => !x.IsGift).ToList();
        var giftLines = eval.Lines.Where(x => x.IsGift).ToList();

        // Motor satırı ile SİPARİŞ satırı stok koduyla ve SIRAYLA eşleştirilir.
        // Önceden düz indeksle (`nonGiftEvalLines[i]`) eşleştiriliyordu: sipariş satırları
        // arasında hediye/promosyon kalemi varsa indeks kayıyor ve A ürününün indirimi
        // 0 ₺'lik hediye satırına yazılıp satırı NEGATİFE düşürüyordu.
        var nonGiftEvalQueues = new Dictionary<string, Queue<EvaluateSalesOrderLineResponse>>(StringComparer.OrdinalIgnoreCase);
        foreach (var el in nonGiftEvalLines)
        {
            var elCode = (el.StockCode ?? string.Empty).Trim();
            if (!nonGiftEvalQueues.TryGetValue(elCode, out var q))
            {
                q = new Queue<EvaluateSalesOrderLineResponse>();
                nonGiftEvalQueues[elCode] = q;
            }
            q.Enqueue(el);
        }

        // ─── Ön hesaplamalar ──────────────────────────────────────────────────
        // Sipariş düzeyindeki kampanya indirimi toplamı (Tip 2 ve 6 buraya düşüyor)
        var linesSumDiscount = eval.Lines.Sum(x => x.DiscountAmount);
        var orderLevelDiscountOnly = Math.Max(0m, eval.DiscountTotal - linesSumDiscount);
        var evalBasketTotal = nonGiftEvalLines.Sum(x => x.LineTotal);
        var distributedOrderDiscount = 0m; // Kuruş farkı takibi

        for (var i = 0; i < orderedLines.Count; i++)
        {
            var line = orderedLines[i];
            Installation? installation = null;
            var lineageId = Guid.NewGuid();
            if (line.Montaj)
            {
                var hasAnyInstallationDetail =
                    !string.IsNullOrWhiteSpace(line.MontajIsimSoyisim) ||
                    !string.IsNullOrWhiteSpace(line.MontajTelefon) ||
                    !string.IsNullOrWhiteSpace(line.MontajAdres) ||
                    !string.IsNullOrWhiteSpace(line.MontajBolge) ||
                    !string.IsNullOrWhiteSpace(line.MontajBayiAdi) ||
                    !string.IsNullOrWhiteSpace(line.MontajUrunAdi) ||
                    !string.IsNullOrWhiteSpace(line.MontajBayiAciklama);

                if (hasAnyInstallationDetail)
                {
                    installation = new Installation
                    {
                        LineageId = lineageId,
                        DealerName = (line.MontajBayiAdi ?? string.Empty).Trim(),
                        ProductName = (line.MontajUrunAdi ?? string.Empty).Trim(),
                        Quantity = line.Miktar,
                        InstallationName = string.IsNullOrWhiteSpace(line.MontajIsimSoyisim) ? null : line.MontajIsimSoyisim.Trim(),
                        InstallationPhone = string.IsNullOrWhiteSpace(line.MontajTelefon) ? null : line.MontajTelefon.Trim(),
                        Address = (line.MontajAdres ?? string.Empty).Trim(),
                        Region = (line.MontajBolge ?? string.Empty).Trim(),
                        DealerDescription = string.IsNullOrWhiteSpace(line.MontajBayiAciklama) ? null : line.MontajBayiAciklama.Trim(),
                        CreateUser = username,
                        CreateTime = now,
                        EditUser = null,
                        EditTime = null
                    };

                    _dbContext.Set<Installation>().Add(installation);
                }
            }

            var stockCode = (line.StokKodu ?? string.Empty).Trim();
            var productCurrencyCode = currencyCodeByStockCode.TryGetValue(stockCode, out var pcc) ? pcc : 0;
            var inferredCurrencyTypeId = MapProductCurrencyCodeToCurrencyTypeId(productCurrencyCode);
            var currencyTypeId = line.CurrencyTypeId.HasValue ? Math.Max(1, line.CurrencyTypeId.Value) : inferredCurrencyTypeId;

            var rate = line.CurrencyRate.HasValue ? line.CurrencyRate.Value : 0m;
            if (currencyTypeId == 1)
            {
                rate = 1m;
            }
            else
            {
                if (rate <= 0m)
                {
                    if (!tryRateCache.TryGetValue(currencyTypeId, out rate))
                    {
                        rate = await ResolveTryRateAsync(currencyTypeId, cancellationToken);
                        tryRateCache[currencyTypeId] = rate;
                    }
                }
            }

            if (rate <= 0m) rate = 1m;

            // ⚠️ HESAP BURADA BELGENİN PARASINDA YÜRÜR — bu satırda TL'ye ÇEVİRME.
            //
            // `line.Fiyat` sepetten kalemin KENDİ parasında gelir ve kampanya motoru
            // (`EvaluateSalesOrder`) da aynı para üzerinden çalışır: `evalLine.UnitPrice`,
            // `evalBasketTotal`, indirim payları hep o paradadır. Burada çevirmek yalnız bir
            // alanı çevirir, indirim payı dövizde kalır — belge kendi içinde tutarsızlaşır
            // (denendi, geri alındı). Çevrim KAYIT anında, tek yerde yapılıyor:
            // `ToTry`/`ToTryUnit` (bkz. yukarıdaki TL ÇAPASI notu).
            var currencyUnitPrice = line.Fiyat;
            var unitPrice = currencyUnitPrice;

            EvaluateSalesOrderLineResponse? evalLine = null;
            if (nonGiftEvalQueues.TryGetValue((line.StokKodu ?? string.Empty).Trim(), out var evalQueue) && evalQueue.Count > 0)
            {
                evalLine = evalQueue.Dequeue();
            }
            var lineTotal = evalLine != null ? evalLine.UnitPrice * line.Miktar : unitPrice * line.Miktar;

            // 1. Toplam satır indirimi
            decimal lineDirectDiscount = evalLine?.DiscountAmount ?? 0m;  // Tip 1+4+5
            decimal lineOrderShare = 0m;                                    // Tip 2+6 payı
            if (orderLevelDiscountOnly > 0m && evalBasketTotal > 0m && lineTotal > 0m)
            {
                var isLastNonGiftLine = (i == orderedLines.Count - 1) ||
                    (evalLine != null && evalLine == nonGiftEvalLines[^1]);
                if (isLastNonGiftLine)
                    lineOrderShare = orderLevelDiscountOnly - distributedOrderDiscount; // Kalan fark son satıra
                else
                    lineOrderShare = Math.Round(orderLevelDiscountOnly * (lineTotal / evalBasketTotal), 2);
                distributedOrderDiscount += lineOrderShare;
            }

            decimal totalLineDiscount = lineDirectDiscount + lineOrderShare;

            // 2. Net birim fiyat
            decimal netUnitPrice = Math.Max(0m, unitPrice - (line.Miktar > 0m ? totalLineDiscount / line.Miktar : 0m));

            // 3. Kampanya açıklaması
            string? campaignDesc = null;
            if (totalLineDiscount > 0m && eval.AppliedCampaignDetails.Any())
            {
                var parts = new List<string>();
                foreach (var detail in eval.AppliedCampaignDetails.Where(d => d.AppliedDiscountAmount > 0m))
                {
                    decimal detailShare = (evalBasketTotal > 0m && lineTotal > 0m)
                        ? Math.Round(detail.AppliedDiscountAmount * (lineTotal / evalBasketTotal), 2)
                        : detail.AppliedDiscountAmount;
                    if (detailShare <= 0m) continue;
                    string typeText = detail.DiscountType == "Oran"
                        ? $"%{detail.DiscountValue:N0}" : $"{detail.DiscountValue:N2} TL";
                    parts.Add($"{detail.CampaignName} ({typeText}) -{detailShare:N2} {orderCurrencyLabel}");
                }
                if (parts.Any())
                    campaignDesc = $"[Kampanya] Orj: {unitPrice:N2} {orderCurrencyLabel} > {string.Join(", ", parts)}";
            }

            // 4. CampaignCode — kampanya ID'leri virgülle
            var campaignCode = eval.AppliedCampaignIds.Any()
                ? string.Join(",", eval.AppliedCampaignIds.Take(5).Select(id => id.ToString("N")[..8]))
                : (string.IsNullOrWhiteSpace(line.KampanyaKodu) ? null : line.KampanyaKodu.Trim());

            // 5. Description birleştirme
            var baseNote = string.IsNullOrWhiteSpace(line.Aciklama) ? null : line.Aciklama.Trim();
            var finalDesc = (baseNote, campaignDesc) switch
            {
                (null, null) => null,
                (string b, null) => b,
                (null, string c) => c,
                (string b, string c) => $"{b}\n{c}"
            };

            order.Lines.Add(new SalesOrderLine
            {
                StockCode = stockCode,
                Description = finalDesc,
                Quantity = line.Miktar,
                // TL çapası; belgenin kendi parasındaki fiyat `CurrencyUnitPrice`ta.
                UnitPrice = ToTryUnit(unitPrice),
                CurrencyTypeId = currencyTypeId,
                CurrencyRate = rate,
                CurrencyUnitPrice = currencyUnitPrice,
                VatRate = isNoVatOrder ? 0m : line.KdvOran,
                IsGift = false,
                // İndirim FİYATLA AYNI ÖLÇÜDE olmak zorunda: faturaya aktarımda satır
                // tabanıyla karşılaştırılıyor, ölçü ayrışırsa indirim satırı sıfırlıyor.
                DiscountAmount = ToTry(totalLineDiscount),
                LineNo = line.Sira,
                CampaignCode = campaignCode,
                Montage = line.Montaj,
                GroupId = line.GrupId,
                // Çıkış deposu sipariş anında belliyse damgalanır; boşsa faturaya aktarımda
                // eskisi gibi giren kişinin varsayılan deposundan çözülür. 0 "atanmamış".
                SourceWarehouseCode = line.DepoKodu.HasValue && line.DepoKodu.Value != 0
                    ? line.DepoKodu.Value
                    : null,
                // SERVİS KÖKENİ. Satış Faturası ekranındaki "SERVİS" rozetini de bu alan kurar;
                // "Günlük Tahsilatlar" yalnızca bu damgayı taşıyan satırları sayar, yani bayide
                // elle girilen siparişler o rapora karışmaz.
                ServicePerformerName = fromServiceApp ? username : null,
                OrderNo = siparisNo,
                Installation = installation,
                LineageId = lineageId,
                CreateUser = username,
                CreateTime = now,
                EditUser = null,
                EditTime = null
            });
        }

        var appendedGiftLines = eval.Lines.Where(x => x.IsGift).ToList();
        if (appendedGiftLines.Count > 0)
        {
            var nextLineNo = order.Lines.Count == 0 ? 1 : order.Lines.Max(x => x.LineNo) + 1;

            // Promosyon satırı siparişin KENDİ dövizini alır. Öncesinde sabit TL yazılıyor,
            // düzeltme yalnızca OKUMA anında yapılıyordu (listeleme sorgusunda hizalama) —
            // yani veritabanında dövizli siparişin promosyon satırı TL duruyordu.
            var orderLineCurrency = order.Lines.FirstOrDefault(x => !x.IsGift && x.CurrencyTypeId > 1);
            var giftCurrencyTypeId = orderLineCurrency?.CurrencyTypeId ?? 0;
            var giftCurrencyRate = orderLineCurrency?.CurrencyRate ?? 1m;

            foreach (var g in appendedGiftLines)
            {
                order.Lines.Add(new SalesOrderLine
                {
                    StockCode = g.StockCode,
                    Description = null,
                    Quantity = g.Quantity,
                    UnitPrice = ToTryUnit(g.UnitPrice),
                    CurrencyTypeId = giftCurrencyTypeId,
                    CurrencyRate = giftCurrencyRate <= 0 ? 1m : giftCurrencyRate,
                    CurrencyUnitPrice = g.UnitPrice,
                    VatRate = g.VatRate,
                    IsGift = true,
                    DiscountAmount = ToTry(g.DiscountAmount),
                    LineNo = nextLineNo++,
                    CampaignCode = null,
                    Montage = false,
                    GroupId = null,
                    OrderNo = siparisNo,
                    Installation = null,
                    CreateUser = username,
                    CreateTime = now,
                    EditUser = null,
                    EditTime = null
                });
            }
        }

        _dbContext.Set<SalesOrder>().Add(order);

        // YALNIZ SEPETİN SAHİBİ (2026-09-27, "her şubenin sepeti ayrı"). Sepet teslim carisine
        // (seçilen şubeye) aittir; istemci onu `TeslimCariKodu` olarak gönderiyor. Fatura carisi
        // (`cariKodu`) şube siparişinde ANA CARİ olduğu için eskiden ana carinin KENDİ sepeti de
        // siliniyordu. Sipariş verisi ve tutarlar bu satırdan etkilenmez.
        var basketItemsToClear = await _dbContext.UserBasketItems
            .Where(x => x.CustomerCode == teslimCariKodu)
            .ToListAsync(cancellationToken);
        if (basketItemsToClear.Count > 0)
        {
            _dbContext.UserBasketItems.RemoveRange(basketItemsToClear);
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Kilit burada bırakılır: sıradaki sipariş artık bu siparişi de görerek limit hesaplar.
        await creditLimitTx.CommitAsync(cancellationToken);

        // Kayıt COMMIT'TEN SONRA yazılır; ayrıntısı için bkz. LogSiparisSepetSilmeAsync.
        await LogSiparisSepetSilmeAsync(siparisNo, cariKodu, username, basketItemsToClear, cancellationToken);

        if (limitAsimiOnaylandi)
        {
            // Kimin, hangi limiti aşarak onayladığı iz olarak kalır.
            await _userActivityLogger.LogAsync(
                "fatura", "aktifSepetRaporu", "LimitAsimiOnay",
                $"{siparisNo} numaralı sipariş LİMİT AŞIMIYLA onaylandı: {cariKodu} — limit {limitEvaluation.CreditLimit:N2}, sonrası {limitEvaluation.Projected:N2} {limitEvaluation.CurrencySymbol}",
                recordId: siparisNo,
                details: new
                {
                    siparisNo,
                    cari = cariKodu,
                    onaylayan = username,
                    limit = limitEvaluation.CreditLimit,
                    bakiye = limitEvaluation.Balance,
                    acikSiparis = limitEvaluation.OpenOrdersRisk,
                    siparisTutari = limitEvaluation.DocumentTotal,
                    sonrasi = limitEvaluation.Projected,
                    paraBirimi = limitEvaluation.CurrencySymbol
                },
                cancellationToken: cancellationToken);
        }

        return Ok(new
        {
            success = true,
            message = $"{siparisNo} numaralı siparişiniz oluştu",
            data = new { siparisNo, id = order.Id }
        });
    }

    /// <summary>
    /// Kullanıcı limit aşımıyla sipariş onaylayabilir mi: SSA, Süper Admin rolü ya da rolünde
    /// <c>OverLimitApprovalEnabled</c> açık olan (2026-10-14).
    /// </summary>
    private async Task<bool> CanApproveOverLimitAsync(CancellationToken cancellationToken)
    {
        if (User.FindFirst("IsSuperSuperAdmin")?.Value == "1") return true;

        var roleIdClaim = User.Claims
            .FirstOrDefault(c => string.Equals(c.Type, "RoleId", StringComparison.OrdinalIgnoreCase))
            ?.Value;
        if (!int.TryParse(roleIdClaim, out var roleId)) return false;

        var role = await _dbContext.Roles
            .AsNoTracking()
            .Where(r => r.Id == roleId)
            .Select(r => new { r.IsSuperAdmin, r.OverLimitApprovalEnabled })
            .FirstOrDefaultAsync(cancellationToken);
        return role != null && (role.IsSuperAdmin || role.OverLimitApprovalEnabled);
    }

    /// <summary>Aktif Sepet Raporu düğmeyi yalnız yetkiliye göstersin diye.</summary>
    [HttpGet("over-limit-approval/permission")]
    [AuthorizePage("reports", "aktifSepetRaporu")]
    public async Task<IActionResult> OverLimitApprovalPermission(CancellationToken cancellationToken)
        => Ok(new { success = true, data = new { allowed = await CanApproveOverLimitAsync(cancellationToken) } });

    public sealed class ConfirmBasketOverLimitRequest
    {
        public string? CustomerCode { get; set; }
    }

    /// <summary>
    /// AKTİF SEPET RAPORU — LİMİT AŞIMIYLA ONAY (2026-10-14 kullanıcı isteği: "sepet onaylarken
    /// limitiniz yetersiz yazısı doğru; ama aktif sepet raporunda rol yetkisine bağlı yeni bir
    /// düğmeyle yetkili, limit engeline takılmadan satışı onaylayabilsin").
    ///
    /// Carinin sunucudaki sepeti, sepet ekranının sipariş gövdesini kurduğu kurallarla siparişe
    /// çevrilir ve normal <see cref="Confirm"/> yolundan geçer — fiyat, kampanya, montaj, kredi
    /// kilidi, sepet temizliği hepsi aynı. Tek fark limit aşımında durmaması; bu da yalnız
    /// yetkili rolde ve iz kaydıyla olur. Sepetteki "Limitiniz yetersiz" akışına dokunulmadı.
    /// </summary>
    [HttpPost("confirm-basket-over-limit")]
    [AuthorizePage("reports", "aktifSepetRaporu")]
    public async Task<IActionResult> ConfirmBasketOverLimit([FromBody] ConfirmBasketOverLimitRequest body, CancellationToken cancellationToken)
    {
        if (!await CanApproveOverLimitAsync(cancellationToken))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Limit aşımıyla onay için rol yetkiniz yok." });
        }

        var customerCode = (body?.CustomerCode ?? string.Empty).Trim();
        if (customerCode.Length == 0)
        {
            return BadRequest(new { success = false, message = "Cari kodu zorunlu" });
        }

        var items = await _dbContext.UserBasketItems
            .AsNoTracking()
            .Where(x => x.CustomerCode == customerCode && x.Quantity > 0 && !x.IsGift)
            .OrderBy(x => x.CreateTime)
            .ToListAsync(cancellationToken);
        if (items.Count == 0)
        {
            return BadRequest(new { success = false, message = "Bu carinin sepetinde ürün yok" });
        }

        // KDV kararı sepetle aynı (kdvKarari.ts): grup 7 → Askeriye, 4-6 → Açık, değilse grubun tipi.
        var customer = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == customerCode)
            .Select(x => new { x.PriceGroupId })
            .FirstOrDefaultAsync(cancellationToken);
        var pg = customer?.PriceGroupId is Guid pgId
            ? await _dbContext.PriceGroups.AsNoTracking().Where(x => x.Id == pgId)
                .Select(x => new { x.Code, x.InvoiceType }).FirstOrDefaultAsync(cancellationToken)
            : null;
        var pgType = (pg?.InvoiceType ?? string.Empty).Trim().ToUpperInvariant();
        var isAcik = pg != null && pg.Code != 7 && (pg.Code is >= 4 and <= 6 || pgType is "ACIK" or "AÇIK");

        var stockCodes = items.Select(x => x.StockCode).Distinct().ToList();
        var productInfo = (await _dbContext.Products
                .AsNoTracking()
                .Where(p => stockCodes.Contains(p.StockCode))
                .Select(p => new { p.StockCode, p.TaxRate, p.InstallationFee })
                .ToListAsync(cancellationToken))
            .GroupBy(p => p.StockCode, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        static int CurrencyTypeIdOf(string? currency)
        {
            var c = (currency ?? string.Empty).Trim().ToUpperInvariant();
            return c switch { "EUR" => 2, "USD" => 3, "GBP" => 4, _ => 1 };
        }

        static string? Cut(string? value, int max)
        {
            var v = (value ?? string.Empty).Trim();
            return v.Length == 0 ? null : (v.Length > max ? v[..max] : v);
        }

        static string? MontajField(System.Text.Json.JsonElement? root, string name)
        {
            if (root is not { } r || r.ValueKind != System.Text.Json.JsonValueKind.Object) return null;
            return r.TryGetProperty(name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : null;
        }

        var lines = new List<ConfirmSalesOrderLineRequest>();
        var sira = 0;
        foreach (var it in items)
        {
            var wantsMontaj = (it.Montaj ?? string.Empty).Contains("montaj istiyorum", StringComparison.OrdinalIgnoreCase);
            var info = productInfo.TryGetValue(it.StockCode, out var pi) ? pi : null;
            var taxRate = info != null ? (decimal)info.TaxRate : it.VatRate;

            // Sepet ekranıyla aynı birim fiyat: montajlı satırda montaj bedelinin NET karşılığı
            // ürün fiyatına katılır (bkz. SiparisCartSection: realUnitWithInstallNet).
            var unit = it.UnitPrice;
            var fee = info?.InstallationFee ?? 0m;
            if (wantsMontaj && fee > 0m)
            {
                unit += taxRate > 0m ? fee / (1m + taxRate / 100m) : fee;
            }

            System.Text.Json.JsonElement? montaj = null;
            if (wantsMontaj && !string.IsNullOrWhiteSpace(it.MontajSnapshotJson))
            {
                try
                {
                    using var doc = System.Text.Json.JsonDocument.Parse(it.MontajSnapshotJson);
                    montaj = doc.RootElement.Clone();
                }
                catch (System.Text.Json.JsonException)
                {
                    montaj = null;
                }
            }

            lines.Add(new ConfirmSalesOrderLineRequest
            {
                StokKodu = it.StockCode,
                Aciklama = Cut(it.Note, 500),
                MontajIsimSoyisim = Cut(MontajField(montaj, "isimSoyisim"), 255),
                MontajTelefon = Cut(MontajField(montaj, "telefon"), 255),
                MontajAdres = Cut(MontajField(montaj, "adres"), 255),
                MontajBolge = Cut(MontajField(montaj, "bolge"), 255),
                MontajBayiAdi = Cut(MontajField(montaj, "bayiAdi"), 255),
                MontajUrunAdi = Cut(MontajField(montaj, "urunAdi"), 255),
                MontajBayiAciklama = Cut(MontajField(montaj, "bayiAciklama"), 255),
                Miktar = it.Quantity,
                Fiyat = unit,
                CurrencyTypeId = CurrencyTypeIdOf(it.Currency),
                KdvOran = isAcik ? 0m : taxRate,
                Sira = ++sira,
                Montaj = wantsMontaj
            });
        }

        var request = new ConfirmSalesOrderRequest
        {
            CariKodu = customerCode,
            TeslimCariKodu = customerCode,
            Lines = lines,
            LimitAsimiOnay = true
        };

        return await Confirm(request, cancellationToken);
    }

    /// <summary>
    /// SİPARİŞ OLUŞUNCA SİLİNEN SEPET SATIRLARININ İZİ.
    ///
    /// <para>
    /// Sipariş kesilirken o carinin sepeti temizleniyor ve süzgeçte <b>kullanıcı yok</b> —
    /// yalnız cari kodu var. Yani bir kullanıcının verdiği sipariş, aynı cariye ürün toplayan
    /// BAŞKA kullanıcıların sepet satırlarını da siliyor. <c>UserBasketItem</c> merkezî hareket
    /// kaydının dışında ve tabloda soft-delete yok; siparişin kendi kaydı yazılsa bile hangi
    /// sepet satırlarının öldüğü geriye dönük hiçbir yerden okunamıyordu.
    /// </para>
    ///
    /// <para>
    /// Kayıt <b>işlemin dışında</b>, <c>creditLimitTx.CommitAsync</c>'ten sonra yazılır: sipariş
    /// kesinleşmeden iz bırakılmaz, ayrıca kayıt yazımı geri alma riski doğurmaz.
    /// <see cref="UserActivityLogger"/> gövdesi baştan sona <c>try/catch</c> içinde olduğu için
    /// buradaki bir hata siparişi düşürmez.
    /// </para>
    ///
    /// <para>
    /// <c>silen</c> ayrıca yazılır çünkü kaydedicinin <c>Username</c> sütunu TOKEN'daki kullanıcıdır:
    /// istek ServiceOps vekilinden geldiğinde orada servis hesabı (<c>ssa</c>) durur, sahadaki
    /// gerçek kullanıcı ise <see cref="ResolveActingUserWithOrigin"/> ile çözülen bu addır.
    /// </para>
    /// </summary>
    private async Task LogSiparisSepetSilmeAsync(
        string siparisNo,
        string cariKodu,
        string silen,
        IReadOnlyCollection<UserBasketItem> silinenler,
        CancellationToken cancellationToken)
    {
        if (silinenler is null || silinenler.Count == 0) return;

        var sahipler = silinenler
            .Select(x => (x.Username ?? string.Empty).Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        var baskasininSatiri = sahipler.Any(o => !string.Equals(o, silen, StringComparison.OrdinalIgnoreCase));
        var cariKodlari = silinenler
            .Select(x => (x.CustomerCode ?? string.Empty).Trim())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        await _userActivityLogger.LogAsync(
            "fatura", "sepet", "Delete",
            $"{siparisNo} siparişi oluştu, sepetten {silinenler.Count} kalem silindi ({cariKodu})"
                + (baskasininSatiri ? " — BAŞKA KULLANICININ SATIRLARI DA SİLİNDİ" : string.Empty),
            recordId: siparisNo,
            details: new
            {
                kaynak = "Sipariş oluşturma",
                siparisNo,
                silen,
                satirSahipleri = sahipler,
                baskasininSatiri,
                cariKodlari,
                kalemSayisi = silinenler.Count,
                kalemler = silinenler.Select(x => new
                {
                    cari = x.CustomerCode,
                    cariAdi = x.CustomerName,
                    sahibi = x.Username,
                    stok = x.StockCode,
                    urun = x.ProductName,
                    adet = x.Quantity,
                    fiyat = x.UnitPrice,
                    doviz = x.Currency,
                    eklenme = x.CreateTime
                }).ToList()
            },
            cancellationToken: cancellationToken);
    }

    private async Task<string> GenerateSiparisNo(CancellationToken cancellationToken)
    {
        // Çakışma ihtimaline karşı (aynı ms içinde iki istek) küçük retry
        for (var i = 0; i < 5; i++)
        {
            var candidate = "S" + DateTime.UtcNow.ToString("yyMMddHHmmssff");
            var exists = await _dbContext.Set<SalesOrder>()
                .AsNoTracking()
                .AnyAsync(x => x.OrderNo == candidate, cancellationToken);

            if (!exists)
            {
                return candidate;
            }

            await Task.Delay(25, cancellationToken);
        }

        return "S" + DateTime.UtcNow.ToString("yyMMddHHmmssff");
    }

    // ---------------------------------------------------------------------------------------
    // MONTAJ BEDELİ SİPARİŞİ (ServiceOps montaj kabulünden, sunucu-sunucu)
    //
    // ServiceOps'ta ELLE montaj kabul kaydı açılınca çağrılır. Montaj fiyatı
    // (`Products.InstallationFee`) tanımlı ürünler için o bayiye BEKLEYEN sipariş taslağı
    // oluşur; ofis Satış Faturası ekranından faturaya çevirir.
    //
    // - Montaj bedeli AYRI bir satır değil, ürün fiyatına katılı olan yol
    //   ([[tv-montaj-bedeli]]) BURADA GEÇERSİZ: burada montaj kabulde ürün SATILMIYOR,
    //   sadece montaj HİZMETİ faturalanıyor. Bu yüzden satır stoksuz "MONTAJ-BEDELI"
    //   hizmet ürününe (ProductType=HIZMET) yazılır — faturaya çevrilince envanter oynamaz
    //   (InvoicesController hizmet kartlı satıra stok hareketi yazmıyor).
    // - `InstallationFee` KDV DAHİL kabul edilir, ürünün kendi oranıyla net'e ayrıştırılır
    //   (servis tarafıyla aynı kural).
    // - Faturadan/siparişten doğan montajlar bu ucu ÇAĞIRMAZ (orada bedel zaten ürün
    //   fiyatında). Çağrı yalnız ServiceOps'un elle kabul akışından gelir.
    // ---------------------------------------------------------------------------------------

    public sealed class MontajBedeliSiparisRequest
    {
        [Required, MaxLength(50)]
        public string CariKodu { get; set; } = string.Empty;

        [Required, MinLength(1)]
        public List<MontajBedeliSiparisItem> Items { get; set; } = new();
    }

    public sealed class MontajBedeliSiparisItem
    {
        [Required, MaxLength(50)]
        public string StokKodu { get; set; } = string.Empty;

        [Range(0.001, 100000)]
        public decimal Adet { get; set; }

        /// <summary>
        /// Montajın yapılacağı SON MÜŞTERİ (bayi değil). Fatura bayiye kesildiği için satır
        /// açıklamasında "kime gitti" bilgisi yoksa bayi hangi montajın bedeli olduğunu
        /// ayırt edemiyordu (2026-09-07 kullanıcı isteği). Boş gelebilir — eski istemciler
        /// göndermiyor, o zaman açıklama eskisi gibi yalnız ürün adını taşır.
        /// </summary>
        [MaxLength(200)]
        public string? MusteriAdi { get; set; }
    }

    private const string MontajBedeliStokKodu = "MONTAJ-BEDELI";

    /// <summary>
    /// Montaj bedeli satırının açıklaması: "Montaj Bedeli - ÜRÜN (MÜŞTERİ)".
    /// Fatura bayiye kesiliyor; müşteri adı olmadan bayi hangi montajın bedeli olduğunu
    /// ayırt edemiyor. Alan 500 karakterle sınırlı, uzun listede müşteri kısmı kırpılır —
    /// kırpma ürün adını değil müşteri kısmını yer, ürün adı her zaman tam kalır.
    /// </summary>
    private static string BuildMontajBedeliAciklama(string? urunAdi, string? musteriAdi)
    {
        const int MaxUzunluk = 500;
        var taban = $"Montaj Bedeli - {(urunAdi ?? string.Empty).Trim()}".Trim();

        var musteri = (musteriAdi ?? string.Empty).Trim();
        if (musteri.Length == 0) return taban;

        var tam = $"{taban} ({musteri})";
        if (tam.Length <= MaxUzunluk) return tam;

        var kalan = MaxUzunluk - taban.Length - 5; // " (" + "…" + ")"
        if (kalan <= 0) return taban;
        return $"{taban} ({musteri.Substring(0, kalan)}…)";
    }

    /// <summary>Stoksuz "MONTAJ BEDELİ" hizmet kartını garanti eder (firmada bir kez oluşur).</summary>
    private async Task EnsureMontajBedeliProductAsync(CancellationToken cancellationToken)
    {
        var exists = await _dbContext.Products
            .AsNoTracking()
            .AnyAsync(x => x.StockCode == MontajBedeliStokKodu, cancellationToken);
        if (exists) return;

        _dbContext.Products.Add(new Product
        {
            Id = Guid.NewGuid(),
            CreatedAt = DateTimeOffset.UtcNow,
            StockCode = MontajBedeliStokKodu,
            Name = "MONTAJ BEDELİ",
            Description = "Montaj hizmeti bedeli (stoksuz hizmet kalemi).",
            Unit = "ADET",
            ProductType = "HIZMET",
            TaxRate = 0,
            BsyVisibleFlag = "H",
            IsInstallable = false,
            InstallationFee = 0m,
            SalesCurrencyCode = 1,
            CurrencyCode = 1,
            IsActive = true,
            Stock = 0
        });
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    // MONTAJ BEDELİ KDV'Sİ SABİT %16. `Products.InstallationFee` KDV DAHİL, SABİT fiyattır
    // (yedek parça gibi). Cari FİYAT GRUBU MANTIĞIYLA yazılır:
    //   * AÇIK / ASKERİYE cari (KDV muaf)  -> satıra fee OLDUĞU GİBİ, KDV %0
    //   * FATURALI cari                    -> satıra fee/1,16 (net), KDV %16
    // Her iki hâlde de cari TAM `fee` kadar borçlanır; kayıt biçimi değişir.
    private const decimal MontajBedeliKdvOran = 16m;

    /// <summary>
    /// Cari AÇIK/ASKERİYE (KDV muaf) mı, FATURALI mı? `Confirm`'deki `isAcikOrder` /
    /// `isAskeriyeOrder` kuralının aynısı: InvoiceType ACIK/ASKERIYE ya da fiyat grubu kodu
    /// 7 (askeriye) / 4-6 (açık).
    /// </summary>
    private async Task<bool> MontajBedeliKdvMuafMi(string cariKodu, CancellationToken cancellationToken)
    {
        var mainCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(cariKodu);
        var cust = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == cariKodu || x.CustomerCode == mainCode)
            .OrderByDescending(x => x.CustomerCode == cariKodu)   // birebir eşleşen önce
            .Select(x => new { x.InvoiceType, x.PriceGroupId })
            .FirstOrDefaultAsync(cancellationToken);
        if (cust is null) return false;

        var it = (cust.InvoiceType ?? string.Empty).Trim();
        if (it.Equals("ACIK", StringComparison.OrdinalIgnoreCase) || it.Equals("AÇIK", StringComparison.OrdinalIgnoreCase)
            || it.Equals("ASKERIYE", StringComparison.OrdinalIgnoreCase) || it.Equals("ASKERİYE", StringComparison.OrdinalIgnoreCase))
            return true;

        if (cust.PriceGroupId.HasValue)
        {
            var pgCode = await _dbContext.PriceGroups
                .AsNoTracking()
                .Where(pg => pg.Id == cust.PriceGroupId.Value)
                .Select(pg => (int?)pg.Code)
                .FirstOrDefaultAsync(cancellationToken);
            if (pgCode.HasValue && (pgCode.Value == 7 || (pgCode.Value >= 4 && pgCode.Value <= 6)))
                return true;
        }

        return false;
    }

    /// <summary>
    /// İstenen kalemlerden montaj bedeli sipariş satırlarını ve KDV DAHİL brüt toplamı çıkarır.
    /// `kdvMuaf` cariye göre KDV %0 + tam fiyat, aksi halde %16 + net fiyat yazılır.
    /// Brüt toplam (kredi limiti kontrolü) her iki hâlde de `fee × adet`.
    /// </summary>
    private async Task<(List<ConfirmSalesOrderLineRequest> Lines, decimal GrossTotal)> BuildMontajBedeliLinesAsync(
        IReadOnlyList<MontajBedeliSiparisItem> items,
        bool kdvMuaf,
        CancellationToken cancellationToken)
    {
        var adetByStok = items
            .Where(x => !string.IsNullOrWhiteSpace(x.StokKodu) && x.Adet > 0)
            .GroupBy(x => x.StokKodu.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Adet), StringComparer.OrdinalIgnoreCase);

        // Aynı stok koduna birden çok montaj satırı gelebilir (iki ayrı müşteriye aynı ürün).
        // Adet toplanırken müşteri adları da birleştiriliyor, yoksa biri kaybolurdu.
        var musteriByStok = items
            .Where(x => !string.IsNullOrWhiteSpace(x.StokKodu) && x.Adet > 0)
            .GroupBy(x => x.StokKodu.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => string.Join(", ", g
                    .Select(x => (x.MusteriAdi ?? string.Empty).Trim())
                    .Where(s => s.Length > 0)
                    .Distinct(StringComparer.OrdinalIgnoreCase)),
                StringComparer.OrdinalIgnoreCase);

        var lines = new List<ConfirmSalesOrderLineRequest>();
        var gross = 0m;
        if (adetByStok.Count == 0) return (lines, gross);

        var urunler = await _dbContext.Products
            .AsNoTracking()
            .Where(p => adetByStok.Keys.Contains(p.StockCode))
            .Select(p => new { p.StockCode, p.Name, p.InstallationFee })
            .ToListAsync(cancellationToken);

        var sira = 1;
        foreach (var p in urunler)
        {
            var fee = p.InstallationFee ?? 0m;
            if (fee <= 0m) continue;
            if (!adetByStok.TryGetValue(p.StockCode, out var adet) || adet <= 0m) continue;

            gross += fee * adet;

            // AÇIK/ASKERİYE -> fee olduğu gibi + KDV %0.  FATURALI -> fee/1,16 + KDV %16.
            var fiyat = kdvMuaf
                ? decimal.Round(fee, 2, MidpointRounding.AwayFromZero)
                : decimal.Round(fee / (1m + (MontajBedeliKdvOran / 100m)), 2, MidpointRounding.AwayFromZero);

            lines.Add(new ConfirmSalesOrderLineRequest
            {
                StokKodu = MontajBedeliStokKodu,
                Aciklama = BuildMontajBedeliAciklama(
                    p.Name,
                    musteriByStok.TryGetValue(p.StockCode, out var musteri) ? musteri : null),
                Miktar = adet,
                Fiyat = fiyat,
                KdvOran = kdvMuaf ? 0m : MontajBedeliKdvOran,
                Montaj = false,
                Sira = sira++
            });
        }

        return (lines, decimal.Round(gross, 2, MidpointRounding.AwayFromZero));
    }

    /// <summary>
    /// MONTAJ BEDELİ KREDİ LİMİTİ ÖN KONTROLÜ. ServiceOps montaj kabul kaydını AÇMADAN ÖNCE
    /// çağırır: bayinin limiti montaj bedelini karşılamıyorsa kayıt hiç oluşturulmaz
    /// ("önce ödeme alın" uyarısı). Hiçbir şey yazmaz.
    /// </summary>
    [HttpPost("montaj-bedeli/kontrol")]
    [AuthorizePage("invoice", "siparis")]
    public async Task<IActionResult> MontajBedeliKontrol(
        [FromBody] MontajBedeliSiparisRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var cariKodu = (request.CariKodu ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(cariKodu))
        {
            return BadRequest(new { success = false, message = "Cari kodu zorunludur." });
        }

        var kdvMuaf = await MontajBedeliKdvMuafMi(cariKodu, cancellationToken);
        var (lines, gross) = await BuildMontajBedeliLinesAsync(request.Items, kdvMuaf, cancellationToken);
        if (lines.Count == 0 || gross <= 0m)
        {
            // Bedeli olan ürün yok — engel yok.
            return Ok(new { success = true, ok = true, hasFee = false });
        }

        var eval = await _creditLimitService.EvaluateAsync(cariKodu, gross, 1, cancellationToken);

        if (eval.Status == CreditLimitStatus.Exceeded)
        {
            return Ok(new
            {
                success = true,
                ok = false,
                hasFee = true,
                code = "CREDIT_LIMIT_EXCEEDED",
                data = new
                {
                    customerCode = cariKodu,
                    creditLimit = eval.CreditLimit,
                    currencySymbol = eval.CurrencySymbol,
                    orderTotal = gross,
                    projected = eval.Projected,
                    requiredPayment = eval.RequiredPayment
                }
            });
        }

        return Ok(new { success = true, ok = true, hasFee = true, orderTotal = gross });
    }

    [HttpPost("montaj-bedeli")]
    [AuthorizePage("invoice", "siparis")]
    public async Task<IActionResult> MontajBedeliSiparis(
        [FromBody] MontajBedeliSiparisRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var cariKodu = (request.CariKodu ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(cariKodu))
        {
            return BadRequest(new { success = false, message = "Cari kodu zorunludur." });
        }

        var kdvMuaf = await MontajBedeliKdvMuafMi(cariKodu, cancellationToken);
        var (lines, _) = await BuildMontajBedeliLinesAsync(request.Items, kdvMuaf, cancellationToken);

        if (lines.Count == 0)
        {
            return Ok(new { success = true, created = false, message = "Montaj fiyatı tanımlı ürün yok; sipariş oluşturulmadı." });
        }

        await EnsureMontajBedeliProductAsync(cancellationToken);

        var confirmReq = new ConfirmSalesOrderRequest
        {
            CariKodu = cariKodu,
            TeslimCariKodu = cariKodu,
            Lines = lines
        };

        // Tüm sipariş kurma mantığı (fiyat grubu, alt hesap, döviz, taslak kaydı) Confirm'de;
        // burada kendi kopyamızı taşımıyoruz.
        return await Confirm(confirmReq, cancellationToken);
    }

    // ---------------------------------------------------------------------------------------
    // E-TİCARET SİPARİŞİ (sunucu-sunucu)
    //
    // Mağaza bu ucu servis anahtarıyla çağırır; arkasında bayi oturumu yok. Kapsam dar:
    // yalnızca 120-11- carileri için, yalnızca stok kodu ve adet alınır.
    //
    // FİYAT İSTEMCİDEN GELMEZ. Satır fiyatı carinin fiyat grubundan (e-ticarette kod 1,
    // "KATALOG F"), KDV oranı ürün kartından okunur. Gövdeye fiyat yazılsa bile dikkate
    // alınmaz — e-ticaretin en klasik açığı budur.
    // ---------------------------------------------------------------------------------------

    public sealed class EcommerceOrderRequest
    {
        [Required, MaxLength(50)]
        public string CustomerCode { get; set; } = string.Empty;

        [MaxLength(1000)]
        public string? DeliveryNote { get; set; }

        [Required, MinLength(1)]
        public List<EcommerceOrderLine> Lines { get; set; } = new();
    }

    public sealed class EcommerceOrderLine
    {
        [Required, MaxLength(50)]
        public string StockCode { get; set; } = string.Empty;

        [Range(0.001, 9999)]
        public decimal Quantity { get; set; }

        /// <summary>
        /// Müşteri bu satır için montaj istedi mi.
        ///
        /// Önceden böyle bir alan yoktu: montajı olan HER ürün otomatik montajlı sayılıyor,
        /// bedeli müşteriye soru sorulmadan ekleniyor ve ödeme onaylanınca montaj kaydı
        /// açılıyordu. B2B sipariş ekranında seçim baştan beri var; vitrin de aynı davranışa
        /// getirildi (2026-09-09 kullanıcı kararı).
        ///
        /// Alan gelmezse (eski mağaza sürümü) varsayılan <c>false</c> — yani montajsız.
        /// Müşterinin onaylamadığı bir bedeli yazmaktansa montajı hiç açmamak doğru.
        /// </summary>
        public bool WantsInstallation { get; set; }
    }

    [HttpPost("/api/ecommerce/orders")]
    [InternalApiKey]
    public async Task<IActionResult> CreateEcommerceOrder([FromBody] EcommerceOrderRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var customerCode = (request.CustomerCode ?? string.Empty).Trim();

        if (!customerCode.StartsWith("120-11-", StringComparison.Ordinal))
        {
            // Bu uçla bayi ya da başka bir cari adına sipariş açılamaz.
            return Forbid();
        }

        var customer = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == customerCode && x.IsActive)
            .Select(x => new
            {
                x.CustomerCode,
                x.PriceGroupId,
                x.SalesmanCode,
                x.Name,
                x.Phone,
                x.Address,
                x.City,
                x.District
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (customer is null) return NotFound(new { success = false, message = "Cari bulunamadı." });

        /*
         * FİYAT, CARİNİN GRUBUNDAN DEĞİL, VİTRİNİN GRUBUNDAN OKUNUR (Kod = 1).
         *
         * Önceki hâlde satır fiyatı `customer.PriceGroupId` ile aranıyordu. Vitrin ise fiyatı
         * HER ZAMAN kod 1 grubundan gösteriyor (Shop:CatalogPriceGroupCode, mağaza katalog
         * sorgusu `pg."Code" = 1` ile bağlanıyor). İki kaynak ayrı olduğu sürece müşteri
         * ekranda bir tutar görüp KARTINDAN BAŞKA bir tutarın çekilmesi mümkündü:
         *
         *   - cari başka bir gruba taşındıysa (elle düzeltme, toplu aktarım, bayiden dönüşen
         *     cari) fiyat sessizce değişiyordu;
         *   - dahası `PriceGroupId` bir KİMLİK, katalogdaki 1 ise KOD. Kimliği 1 olan grubun
         *     kodu 1 olmak zorunda değil — eşleşme tesadüfe kalmıştı.
         *
         * Müşteri kararı: "tüm müşteriler B2B'deki fiyat 1 üzerinden alacak". Artık gösterilen
         * fiyatla tahsil edilen fiyatın tek bir kaynağı var. Grup bulunamazsa sipariş hiç
         * açılmıyor: yanlış fiyatla sipariş açmaktansa açmamak doğru.
         */
        var catalogPriceGroupId = await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(x => x.Code == B2B.Erp.Api.Features.Ecommerce.EcommerceCatalog.PriceGroupCode && x.IsActive)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (catalogPriceGroupId is null)
        {
            return BadRequest(new
            {
                success = false,
                message = $"Vitrin fiyat grubu (Kod {B2B.Erp.Api.Features.Ecommerce.EcommerceCatalog.PriceGroupCode}) tanımlı değil. Sipariş açılamaz."
            });
        }

        var stockCodes = request.Lines
            .Select(x => (x.StockCode ?? string.Empty).Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var products = await _dbContext.Products
            .AsNoTracking()
            .Where(x => stockCodes.Contains(x.StockCode) && x.IsActive)
            .Select(x => new
            {
                x.Id,
                x.StockCode,
                x.Name,
                x.TaxRate,
                x.SalesCurrencyCode,
                x.IsInstallable,
                x.InstallationFee,
                x.MainCategoryId,
                x.CategoryId,
                x.Kod4,
                x.Kod5
            })
            .ToListAsync(cancellationToken);

        if (products.Count != stockCodes.Count)
        {
            return BadRequest(new { success = false, message = "Sipariş satırlarından biri artık satışta değil." });
        }

        var productIds = products.Select(x => x.Id).ToList();

        /*
          VİTRİN KAMPANYASI SİPARİŞE DE UYGULANIR (2026-09-19) — bkz. EcommerceCampaignPricing.
          Vitrin indirimli fiyatı gösteriyor; sipariş burada fiyatlandığı için aynı indirim
          burada da düşülmezse müşteriden ekranda gördüğünden fazlası çekilir. Açık kampanya
          yoksa `liveCampaigns` boş, hesap eskisi gibi.
        */
        var liveCampaigns = await B2B.Erp.Api.Features.Ecommerce.EcommerceCampaignPricing.LoadLiveAsync(_dbContext, cancellationToken);
        var catalogF4ByProductId = new Dictionary<Guid, decimal>();
        var categoryKeyById = new Dictionary<Guid, string>();
        if (liveCampaigns.Count > 0)
        {
            catalogF4ByProductId = await _dbContext.ProductPrices
                .AsNoTracking()
                .Where(x => productIds.Contains(x.ProductId) && x.PriceGroup.Code == 4)
                .GroupBy(x => x.ProductId)
                .Select(g => new { g.Key, Price = g.Max(x => x.Price) })
                .ToDictionaryAsync(x => x.Key, x => x.Price, cancellationToken);
            categoryKeyById = await _dbContext.ProductCategories
                .AsNoTracking()
                .Select(x => new { x.Id, x.Key })
                .ToDictionaryAsync(x => x.Id, x => x.Key ?? string.Empty, cancellationToken);
        }

        var prices = await _dbContext.ProductPrices
            .AsNoTracking()
            .Where(x => productIds.Contains(x.ProductId) && x.PriceGroupId == catalogPriceGroupId)
            .ToDictionaryAsync(x => x.ProductId, x => x.Price, cancellationToken);

        var now = DateTime.UtcNow;
        var orderNo = await GenerateSiparisNo(cancellationToken);

        var order = new SalesOrder
        {
            CustomerCode = customerCode,
            DeliveryCustomerCode = customerCode,
            Status = 0,
            OrderNo = orderNo,
            ProcessedBy = "ETICARET",
            ProcessedAt = now,

            /*
             * TESLİMAT ADRESİ SİPARİŞE KOPYALANIYOR.
             *
             * Cari kartındaki adres değişkendir: müşteri profilinden istediği zaman
             * güncelliyor. Kopya alınmazsa, bugün yapılan bir adres değişikliği aylar önce
             * teslim edilmiş siparişin de adresini değiştirir ve malın gerçekte nereye
             * gittiği kaybolur. Kargo ve montaj kayıtları da bu kopyayı okuyor.
             */
            DeliveryName = customer.Name,
            DeliveryPhone = customer.Phone,
            DeliveryAddress = customer.Address,
            DeliveryCity = customer.City,
            DeliveryDistrict = customer.District,

            CreateUser = "ETICARET",
            CreateTime = now
        };

        decimal subtotal = 0m;
        decimal vatTotal = 0m;
        var lineNo = 1;

        foreach (var requested in request.Lines)
        {
            var code = (requested.StockCode ?? string.Empty).Trim();
            var product = products.First(x => string.Equals(x.StockCode, code, StringComparison.OrdinalIgnoreCase));

            if (!prices.TryGetValue(product.Id, out var unitPrice) || unitPrice <= 0)
            {
                return BadRequest(new { success = false, message = $"{code} için fiyat tanımlı değil." });
            }

            // Kampanya: KDV dahil fark F4'ten, satır fiyatı KDV hariç → farkın neti düşer.
            decimal campaignUnitNetDiscount = 0m;
            string? campaignName = null;
            if (liveCampaigns.Count > 0)
            {
                var facts = new B2B.Erp.Api.Features.Ecommerce.EcommerceCampaignPricing.ProductFacts(
                    product.StockCode,
                    catalogF4ByProductId.TryGetValue(product.Id, out var f4) ? f4 : (decimal?)null,
                    product.MainCategoryId.HasValue && categoryKeyById.TryGetValue(product.MainCategoryId.Value, out var mk) ? mk : null,
                    product.CategoryId.HasValue && categoryKeyById.TryGetValue(product.CategoryId.Value, out var sk) ? sk : null,
                    product.Kod4,
                    product.Kod5);
                var grossDiscount = B2B.Erp.Api.Features.Ecommerce.EcommerceCampaignPricing.GrossUnitDiscount(facts, liveCampaigns, out campaignName);
                if (grossDiscount > 0m)
                {
                    campaignUnitNetDiscount = Math.Round(
                        B2B.Erp.Api.Features.Ecommerce.EcommerceLineMath.ToNet(grossDiscount, product.TaxRate), 4, MidpointRounding.AwayFromZero);
                    unitPrice = Math.Max(0m, Math.Round(unitPrice - campaignUnitNetDiscount, 2, MidpointRounding.AwayFromZero));
                }
            }

            var quantity = requested.Quantity;

            // Fiyat ürünün fiyat listesinden geliyor ve ÜRÜNÜN SATIŞ dövizindedir.
            //
            // Önceki hâlde para birimi doğru damgalanıyor ama kur 1 bırakılıp döviz tutarın
            // KENDİSİ `UnitPrice`a yazılıyordu ("TL karşılığı faturaya dönüşürken hesaplanır").
            // Sonuç: `SalesOrder.GrandTotal` bu yolda TL DEĞİLDİ — oysa sipariş raporu onu ₺
            // olarak gösteriyor ve sistemin geri kalanı bu kolonu TL çapası kabul ediyor.
            // Sipariş faturaya hiç dönmese bile rapor yanlış okuyordu. Artık diğer yollarla
            // aynı: TL çapa + kalemin kendi dövizi ayrı kolonlarda.
            var lineCurrencyTypeId = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Normalize(product.SalesCurrencyCode);
            var lineRate = await ResolveTryRateAsync(lineCurrencyTypeId, cancellationToken);
            if (lineRate <= 0m) lineRate = 1m;

            var tryUnitPrice = Math.Round(unitPrice * lineRate, 4, MidpointRounding.AwayFromZero);
            var currencyUnitPrice = unitPrice;

            /*
             * MONTAJ BEDELİ — B2B sipariş ekranıyla AYNI KURAL (SiparisCartSection).
             *
             * `Products.InstallationFee` KDV DAHİL sabit bir tutardır. Satır fiyatına
             * eklenmeden ÖNCE ürünün kendi KDV oranıyla nete çevriliyor; aksi hâlde bu
             * satıra KDV bir kez daha uygulandığı için montajın KDV'si İKİ KEZ sayılır.
             * B2B'de aynı hata 2026-08-26'da düzeltildi (ürün 7.285,71 + montaj 300 →
             * 7.965 çıkıyordu, doğrusu 7.950); vitrin yolunda tekrarlanmaması için hesap
             * birebir buraya taşındı.
             *
             * Bedel HEM TL çapasına HEM satırın kendi döviz tutarına ekleniyor:
             * `UnitPrice = CurrencyUnitPrice × CurrencyRate` bağıntısı bozulursa dövizli
             * raporlar ve fatura basımı ayrışır.
             *
             * `Montage = true` damgası ŞART: "bu satırda montaj var mı" sorusunun tek sağlam
             * cevabı fiyat farkı değil bu bayraktır (kampanyalı satırda fiyat farkı yanıltır).
             * Ödeme onaylandığında montaj kaydı bu damgaya bakarak açılıyor.
             */
            // MONTAJ ARTIK SEÇİME BAĞLI. `IsInstallable` yalnızca "montaj SEÇİLEBİLİR" demek;
            // seçilip seçilmediğini müşteri söylüyor. İkisi birlikte doğru olmalı: montajı
            // olmayan üründe istemcinin gönderdiği seçim yok sayılır.
            var wantsInstallation = requested.WantsInstallation && product.IsInstallable;

            var installFeeGross = wantsInstallation && product.InstallationFee.HasValue
                ? Math.Max(0m, product.InstallationFee.Value)
                : 0m;

            if (installFeeGross > 0m)
            {
                // Hesap `EcommerceLineMath`te: aynı formül mağazanın sepetinde ve fatura
                // yolunda da geçerli, üçünün ayrışmaması için tek yerde duruyor ve
                // testlerle çivili (EcommerceLineMathTests).
                var withInstall = B2B.Erp.Api.Features.Ecommerce.EcommerceLineMath
                    .UnitNetWithInstallation(tryUnitPrice, product.TaxRate, installFeeGross);

                var installNetTry = withInstall - tryUnitPrice;

                tryUnitPrice = withInstall;
                currencyUnitPrice = Math.Round(
                    currencyUnitPrice + installNetTry / lineRate, 4, MidpointRounding.AwayFromZero);
            }

            var lineNet = Math.Round(tryUnitPrice * quantity, 2, MidpointRounding.AwayFromZero);
            var lineVat = Math.Round(lineNet * product.TaxRate / 100m, 2, MidpointRounding.AwayFromZero);

            subtotal += lineNet;
            vatTotal += lineVat;

            order.Lines.Add(new SalesOrderLine
            {
                StockCode = product.StockCode,
                Quantity = quantity,
                UnitPrice = tryUnitPrice,
                VatRate = product.TaxRate,
                CurrencyTypeId = lineCurrencyTypeId,
                CurrencyRate = lineRate,
                CurrencyUnitPrice = currencyUnitPrice,
                Montage = wantsInstallation,
                LineNo = lineNo++,
                Description = request.DeliveryNote,
                CreateUser = "ETICARET",
                CreateTime = now
            });
        }

        order.Subtotal = subtotal;
        order.VatTotal = vatTotal;
        order.GrandTotal = subtotal + vatTotal;

        _dbContext.Set<SalesOrder>().Add(order);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            data = new
            {
                orderId = order.Id,
                orderNo = order.OrderNo,
                subtotal = order.Subtotal,
                vatTotal = order.VatTotal,
                grandTotal = order.GrandTotal
            }
        });
    }

    public sealed class UpdateEcommerceOrderNoteRequest
    {
        [MaxLength(1000)]
        public string? DeliveryNote { get; set; }
    }

    /// <summary>
    /// Mağazanın "bekleyen sipariş aynıysa yeniden kullan" kuralının kör noktasını kapatır
    /// (2026-09-13 kullanıcı bulgusu: notu değiştirip yeniden ödemeye bastığında sipariş
    /// aynı kaldığı için not hiç güncellenmiyordu).
    ///
    /// <c>OrderService.CreateFromCartAsync</c> sepetin parmak izi (ürün/adet/montaj)
    /// DEĞİŞMEDİYSE var olan bekleyen siparişi aynen geri veriyor — sepetin içeriği aynıysa
    /// yeni bir sipariş açmak yanlış olurdu. Ama parmak izi teslimat notundan hiç
    /// hesaplanmıyor; müşteri notu değiştirip tekrar ödeme denediğinde eski notu taşıyan
    /// bekleyen sipariş aynen geri veriliyor ve YENİ not hiçbir yere yazılmıyordu. Mağaza
    /// artık bekleyen siparişi geri verirken bu ucu da çağırıyor.
    /// </summary>
    [HttpPost("/api/ecommerce/orders/{orderNo}/delivery-note")]
    [InternalApiKey]
    public async Task<IActionResult> UpdateEcommerceOrderNote(
        string orderNo, [FromBody] UpdateEcommerceOrderNoteRequest request, CancellationToken cancellationToken)
    {
        var code = (orderNo ?? string.Empty).Trim();
        if (code.Length == 0) return BadRequest(new { success = false, message = "Sipariş numarası zorunlu." });

        var order = await _dbContext.Set<SalesOrder>()
            .Include(x => x.Lines)
            .FirstOrDefaultAsync(x => x.OrderNo == code && x.ProcessedBy.ToUpper() == "ETICARET", cancellationToken);

        if (order is null) return NotFound(new { success = false, message = "Sipariş bulunamadı." });

        // Sipariş ÖDENMİŞSE not artık değiştirilemez — fatura kesilmiş ya da kesilmek üzere
        // olan bir belgenin arkasından notu değiştirmek yanıltıcı olurdu.
        var isPaid = await _dbContext.EcommerceOrderPayments
            .AsNoTracking()
            .AnyAsync(x => x.SalesOrderNo == code && x.Status == (int)EcommercePaymentStatus.Paid, cancellationToken);
        if (isPaid) return Ok(new { success = true });

        var now = DateTime.UtcNow;
        foreach (var line in order.Lines)
        {
            line.Description = request.DeliveryNote;
            line.EditUser = "ETICARET";
            line.EditTime = now;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    /// <summary>
    /// Müşterinin kendi siparişleri — mağazadaki "Siparişlerim" ekranı için.
    ///
    /// Siparişin yanında ÖDEME ve FATURA durumu da veriliyor. Sebep: müşterinin ekranında
    /// "sipariş verdim, ne oldu?" sorusunun cevabı bu üçünün birlikte okunmasıyla çıkıyor ve
    /// üçü de ERP'nin verisi. Mağazanın bunları ayrı ayrı sorup birleştirmesi, hem üç tur
    /// demek hem de mağazada ikinci bir "sipariş durumu" yorumu doğurmak olurdu.
    ///
    /// Ödeme durumu <c>EcommerceOrderPayments</c>'tan; fatura bağı ERP'nin kendi bağından
    /// (<c>InvoiceLine.SalesOrderLineId</c>) — tahmin edilmiyor.
    /// </summary>
    [HttpGet("/api/ecommerce/orders/{customerCode}")]
    [InternalApiKey]
    public async Task<IActionResult> ListEcommerceOrders(string customerCode, CancellationToken cancellationToken)
    {
        var code = (customerCode ?? string.Empty).Trim();
        if (!code.StartsWith("120-11-", StringComparison.Ordinal)) return Forbid();

        var orders = await _dbContext.Set<SalesOrder>()
            .AsNoTracking()
            .Where(x => x.CustomerCode == code)
            .OrderByDescending(x => x.ProcessedAt)
            .Take(100)
            .Select(x => new
            {
                x.Id,
                x.OrderNo,
                x.ProcessedAt,
                x.Subtotal,
                x.VatTotal,
                x.GrandTotal,
                Lines = x.Lines.Select(l => new
                {
                    l.Id,
                    l.StockCode,
                    l.Quantity,
                    l.UnitPrice,
                    // Belgenin kendi para birimi de dönüyor (2026-08-17). `UnitPrice` TL
                    // çapasıdır; müşteri "Siparişlerim" ekranı fiyatı siparişin dövizinin
                    // simgesiyle bastığında 3.800 ₺'lik satır "3.800 $" görünüyordu. Yönetim
                    // ucunda bu alanlar zaten dönüyordu, müşteri ucu atlanmıştı.
                    l.CurrencyTypeId,
                    l.CurrencyRate,
                    l.CurrencyUnitPrice,
                    l.VatRate,

                    // Montaj artık müşterinin SEÇİMİ (2026-09-09). Mağaza bu damgayı
                    // okumadan "hangi satırda montaj var" sorusuna cevap veremez; fiyat
                    // farkından çıkarmak yanıltır (bedelsiz montaj da seçilebiliyor).
                    l.Montage
                }).ToList()
            })
            .ToListAsync(cancellationToken);

        if (orders.Count == 0)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var orderNos = orders.Select(x => x.OrderNo).ToList();

        // Ödeme: bir sipariş için birden çok deneme olabilir. Ödenmiş olan varsa cevap odur,
        // yoksa en son deneme — "son deneme başarısız" ile "hiç denenmemiş" farklı şeyler.
        var payments = await _dbContext.EcommerceOrderPayments
            .AsNoTracking()
            .Where(x => orderNos.Contains(x.SalesOrderNo))
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var paymentByOrder = payments
            .GroupBy(x => x.SalesOrderNo)
            .ToDictionary(
                g => g.Key,
                g => g.FirstOrDefault(x => x.Status == (int)EcommercePaymentStatus.Paid) ?? g.First());

        // Fatura: sipariş satırından fatura satırına giden bağ üzerinden. Fatura numarasını
        // sipariş numarasından türetmek gibi bir kısayol YOK — bayi faturayı elle de kesebilir,
        // bir siparişten birden çok fatura da çıkabilir.
        var lineIds = orders.SelectMany(o => o.Lines.Select(l => l.Id)).ToList();

        var invoiceLinks = await _dbContext.Set<InvoiceLine>()
            .AsNoTracking()
            .Where(l => l.SalesOrderLineId != null && lineIds.Contains(l.SalesOrderLineId!.Value))
            .Join(_dbContext.Set<Invoice>().AsNoTracking(),
                l => l.InvoiceId, i => i.Id,
                (l, i) => new { l.SalesOrderLineId, i.InvoiceNo, i.Date })
            .ToListAsync(cancellationToken);

        var invoiceByLineId = invoiceLinks
            .Where(x => x.SalesOrderLineId != null)
            .GroupBy(x => x.SalesOrderLineId!.Value)
            .ToDictionary(g => g.Key, g => g.First());

        var data = orders.Select(order =>
        {
            paymentByOrder.TryGetValue(order.OrderNo, out var payment);

            var invoice = order.Lines
                .Select(l => invoiceByLineId.TryGetValue(l.Id, out var inv) ? inv : null)
                .FirstOrDefault(x => x != null);

            return new
            {
                order.Id,
                order.OrderNo,
                order.ProcessedAt,
                order.Subtotal,
                order.VatTotal,
                order.GrandTotal,
                order.Lines,

                PaymentStatus = payment is null
                    ? EcommercePaymentStatus.Pending.ToString()
                    : ((EcommercePaymentStatus)payment.Status).ToString(),
                IsPaid = payment is not null && payment.Status == (int)EcommercePaymentStatus.Paid,
                PaidAt = payment is not null && payment.Status == (int)EcommercePaymentStatus.Paid
                    ? payment.SettledAtUtc
                    : null,

                InvoiceNo = invoice?.InvoiceNo,
                InvoiceDate = invoice?.Date
            };
        }).ToList();

        return Ok(new { success = true, data });
    }

    /// <summary>
    /// BAYİ PANELİ için e-ticaret siparişlerinin tamamı — müşteri bazlı değil.
    ///
    /// Müşteri ucundan (<see cref="ListEcommerceOrders"/>) ayrı duruyor çünkü soruları farklı:
    /// müşteri "benim siparişim ne oldu" diye sorar, bayi "bugün hangi siparişler geldi, hangisi
    /// ödendi, hangisi faturalanacak" diye. İkisini tek uca sığdırmak, müşteri ucuna cari kodu
    /// parametresi eklemek demek olurdu — yani başkasının siparişini okumanın kapısı.
    /// </summary>
    [HttpGet("/api/ecommerce/admin/orders")]
    [InternalApiKey]
    public async Task<IActionResult> ListAllEcommerceOrders(
        [FromQuery] int days,
        [FromQuery] string? ara,
        CancellationToken cancellationToken)
    {
        var window = days <= 0 ? 30 : Math.Min(days, 365);
        var since = DateTime.UtcNow.AddDays(-window);
        var search = (ara ?? string.Empty).Trim();

        var query = _dbContext.Set<SalesOrder>()
            .AsNoTracking()
            .Where(x => x.ProcessedBy.ToUpper() == "ETICARET" && x.ProcessedAt >= since);

        if (search.Length > 0)
        {
            query = query.Where(x => x.OrderNo.Contains(search) || x.CustomerCode.Contains(search));
        }

        var orders = await query
            .OrderByDescending(x => x.ProcessedAt)
            .Take(300)
            .Select(x => new
            {
                x.OrderNo,
                x.CustomerCode,
                x.ProcessedAt,
                x.GrandTotal,
                x.Status,
                LineCount = x.Lines.Count(),
                // Montaj seçilen kalem sayısı. Kargo kaydına GİRMEYEN kalemler bunlar:
                // montajlı ürünü montaj ekibi götürüyor (2026-09-09 kullanıcı kararı).
                MontageCount = x.Lines.Count(l => l.Montage),
                LineIds = x.Lines.Select(l => l.Id).ToList()
            })
            .ToListAsync(cancellationToken);

        if (orders.Count == 0)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var orderNos = orders.Select(x => x.OrderNo).ToList();
        var customerCodes = orders.Select(x => x.CustomerCode).Distinct().ToList();
        var lineIds = orders.SelectMany(x => x.LineIds).ToList();

        var payments = await _dbContext.EcommerceOrderPayments
            .AsNoTracking()
            .Where(x => orderNos.Contains(x.SalesOrderNo))
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var paymentByOrder = payments
            .GroupBy(x => x.SalesOrderNo)
            .ToDictionary(
                g => g.Key,
                g => g.FirstOrDefault(x => x.Status == (int)EcommercePaymentStatus.Paid) ?? g.First());

        var invoiceByLineId = (await _dbContext.Set<InvoiceLine>()
            .AsNoTracking()
            .Where(l => l.SalesOrderLineId != null && lineIds.Contains(l.SalesOrderLineId!.Value))
            .Join(_dbContext.Set<Invoice>().AsNoTracking(),
                l => l.InvoiceId, i => i.Id,
                (l, i) => new { l.SalesOrderLineId, i.InvoiceNo, i.Date })
            .ToListAsync(cancellationToken))
            .Where(x => x.SalesOrderLineId != null)
            .GroupBy(x => x.SalesOrderLineId!.Value)
            .ToDictionary(g => g.Key, g => g.First());

        var customerNames = await _dbContext.Customers
            .AsNoTracking()
            .Where(c => customerCodes.Contains(c.CustomerCode))
            .Select(c => new { c.CustomerCode, c.Name, c.Phone })
            .ToDictionaryAsync(x => x.CustomerCode, x => x, cancellationToken);

        var data = orders.Select(order =>
        {
            paymentByOrder.TryGetValue(order.OrderNo, out var payment);
            customerNames.TryGetValue(order.CustomerCode, out var customer);

            var invoice = order.LineIds
                .Select(id => invoiceByLineId.TryGetValue(id, out var inv) ? inv : null)
                .FirstOrDefault(x => x != null);

            return new
            {
                order.OrderNo,
                order.CustomerCode,
                CustomerName = customer?.Name,
                CustomerPhone = customer?.Phone,
                order.ProcessedAt,
                order.GrandTotal,
                order.LineCount,
                order.MontageCount,
                // Teslimat kaydı YALNIZCA montajsız kalem varsa açılıyor; panel "kargo yok"
                // ile "kargo açılamadı"yı ayırabilsin diye bu bilgi listede veriliyor.
                HasCargo = order.LineCount > order.MontageCount,
                IsCancelled = order.Status == B2B.Erp.Api.Features.Ecommerce.EcommerceFulfilmentService.CancelledStatus,
                PaymentStatus = payment is null
                    ? EcommercePaymentStatus.Pending.ToString()
                    : ((EcommercePaymentStatus)payment.Status).ToString(),
                IsPaid = payment is not null && payment.Status == (int)EcommercePaymentStatus.Paid,
                PaidAt = payment is not null && payment.Status == (int)EcommercePaymentStatus.Paid
                    ? payment.SettledAtUtc
                    : null,
                InvoiceNo = invoice?.InvoiceNo,
                InvoiceDate = invoice?.Date
            };
        }).ToList();

        return Ok(new { success = true, data });
    }

    /// <summary>
    /// CARİ KARTINDAKİ "E-Ticaret siparişleri" bölümü için.
    ///
    /// <see cref="ListEcommerceOrders"/>'dan farkı: o uç mağazanın sunucu-sunucu anahtarıyla
    /// çağırdığı, müşterinin kendi siparişlerini gösteren uç. Bu ise ERP PANELİNDEN, oturum
    /// açmış bir kullanıcı tarafından çağrılıyor — cari kartını açan kişi o carinin
    /// internetten kaç sipariş verdiğini kartı kapatmadan görebilmeli.
    ///
    /// KAPSAM DAR TUTULDU: yalnızca 120-11- (e-ticaret) carileri. Bayi carilerine de açık
    /// olsaydı, "cari kodu ver, siparişlerini al" diyen genel bir uç olurdu; bayi siparişleri
    /// zaten kendi ekranında ve kendi yetki kapısının arkasında.
    /// </summary>
    [HttpGet("/api/ecommerce/panel/customer-orders/{customerCode}")]
    public async Task<IActionResult> GetCustomerEcommerceOrders(string customerCode, CancellationToken cancellationToken)
    {
        var code = (customerCode ?? string.Empty).Trim();

        if (!code.StartsWith("120-11-", StringComparison.Ordinal))
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var orders = await _dbContext.Set<SalesOrder>()
            .AsNoTracking()
            .Where(x => x.CustomerCode == code && x.ProcessedBy.ToUpper() == "ETICARET")
            .OrderByDescending(x => x.ProcessedAt)
            .Take(50)
            .Select(x => new
            {
                x.OrderNo,
                x.ProcessedAt,
                x.GrandTotal,
                x.Status,
                LineCount = x.Lines.Count(),
                MontageCount = x.Lines.Count(l => l.Montage),
                LineIds = x.Lines.Select(l => l.Id).ToList()
            })
            .ToListAsync(cancellationToken);

        if (orders.Count == 0) return Ok(new { success = true, data = Array.Empty<object>() });

        var orderNos = orders.Select(x => x.OrderNo).ToList();
        var lineIds = orders.SelectMany(x => x.LineIds).ToList();

        var paidOrders = await _dbContext.EcommerceOrderPayments
            .AsNoTracking()
            .Where(x => orderNos.Contains(x.SalesOrderNo) && x.Status == (int)EcommercePaymentStatus.Paid)
            .Select(x => x.SalesOrderNo)
            .Distinct()
            .ToListAsync(cancellationToken);

        var paidSet = new HashSet<string>(paidOrders, StringComparer.Ordinal);

        var invoiceByLineId = (await _dbContext.Set<InvoiceLine>()
            .AsNoTracking()
            .Where(l => l.SalesOrderLineId != null && lineIds.Contains(l.SalesOrderLineId!.Value))
            .Join(_dbContext.Set<Invoice>().AsNoTracking(),
                l => l.InvoiceId, i => i.Id,
                (l, i) => new { l.SalesOrderLineId, i.InvoiceNo })
            .ToListAsync(cancellationToken))
            .Where(x => x.SalesOrderLineId != null)
            .GroupBy(x => x.SalesOrderLineId!.Value)
            .ToDictionary(g => g.Key, g => g.First().InvoiceNo);

        var data = orders.Select(o => new
        {
            o.OrderNo,
            o.ProcessedAt,
            o.GrandTotal,
            o.LineCount,
            o.MontageCount,
            IsPaid = paidSet.Contains(o.OrderNo),
            IsCancelled = o.Status == B2B.Erp.Api.Features.Ecommerce.EcommerceFulfilmentService.CancelledStatus,
            InvoiceNo = o.LineIds
                .Select(id => invoiceByLineId.TryGetValue(id, out var no) ? no : null)
                .FirstOrDefault(x => x != null)
        }).ToList();

        return Ok(new { success = true, data });
    }

    /// <summary>
    /// E-TİCARET SİPARİŞİNİ İPTAL EDER.
    ///
    /// NE YAPAR: siparişi iptal damgalar, teslimat (kargo) kaydını ServiceOps'tan düşürür ve
    /// açılmış montaj kayıtlarını "İptal" durumuna alır. Sipariş SİLİNMEZ — geçmiş kalmalı.
    ///
    /// PARA İADESİ BURADA YAPILMAZ (2026-09-09 kullanıcı kararı): bayi parayı bankadan kendisi
    /// iade ediyor ve cari ekstresine ödemeyi elle işliyor. Buradan otomatik bir muhasebe
    /// hareketi yazmak, iki yerden aynı iadeyi üretme riskiydi.
    ///
    /// FATURALANMIŞ SİPARİŞ İPTAL EDİLEMEZ. Fatura stok düşürmüş ve cariye borç yazmıştır;
    /// önce faturanın silinmesi gerekir (o akış teslimat kaydını da zaten düşürüyor). Aksi
    /// hâlde sipariş "iptal" görünürken faturası ortada kalırdı.
    ///
    /// Sipariş <see cref="SalesOrder.Status"/> 9 ile damgalanıyor. Alan bugüne kadar hiç
    /// kullanılmıyordu; yan etkisi doğru yönde: limit/risk raporu açık siparişi Status == 0
    /// ile süzdüğü için iptal edilen sipariş müşterinin riskinden de düşüyor.
    /// </summary>
    [HttpPost("/api/ecommerce/admin/orders/{orderNo}/cancel")]
    [InternalApiKey]
    public async Task<IActionResult> CancelEcommerceOrder(
        string orderNo,
        [FromBody] CancelEcommerceOrderRequest? request,
        CancellationToken cancellationToken)
    {
        var code = (orderNo ?? string.Empty).Trim();
        if (code.Length == 0) return BadRequest(new { success = false, message = "Sipariş numarası zorunlu." });

        var order = await _dbContext.Set<SalesOrder>()
            .Include(x => x.Lines)
            .FirstOrDefaultAsync(x => x.OrderNo == code && x.ProcessedBy.ToUpper() == "ETICARET", cancellationToken);

        if (order is null) return NotFound(new { success = false, message = "Sipariş bulunamadı." });

        if (order.Status == B2B.Erp.Api.Features.Ecommerce.EcommerceFulfilmentService.CancelledStatus)
        {
            return Ok(new { success = true, alreadyCancelled = true, message = "Sipariş zaten iptal edilmiş." });
        }

        var lineIds = order.Lines.Select(l => l.Id).ToList();

        var invoiceNos = await _dbContext.Set<InvoiceLine>()
            .AsNoTracking()
            .Where(l => l.SalesOrderLineId != null && lineIds.Contains(l.SalesOrderLineId!.Value))
            .Join(_dbContext.Set<Invoice>().AsNoTracking(),
                l => l.InvoiceId, i => i.Id, (l, i) => i.InvoiceNo)
            .Distinct()
            .ToListAsync(cancellationToken);

        if (invoiceNos.Count > 0)
        {
            return Conflict(new
            {
                success = false,
                message = $"Bu siparişin faturası kesilmiş ({string.Join(", ", invoiceNos)}). " +
                          "Önce faturayı silin, sonra siparişi iptal edin."
            });
        }

        var now = DateTime.UtcNow;
        var actor = ResolveActingUser();

        order.Status = B2B.Erp.Api.Features.Ecommerce.EcommerceFulfilmentService.CancelledStatus;
        order.EditUser = actor;
        order.EditTime = now;

        var reason = (request?.Reason ?? string.Empty).Trim();
        var note = string.IsNullOrWhiteSpace(reason) ? "E-ticaret siparişi iptal edildi." : $"İPTAL: {reason}";

        // Montaj kayıtları da kapanıyor: sipariş iptal edilmişken saha ekibinin listesinde
        // durmaya devam etmesi, teslim edilmeyecek bir iş için randevu demekti.
        var installationIds = order.Lines
            .Where(l => l.InstallationId.HasValue)
            .Select(l => l.InstallationId!.Value)
            .ToList();

        var cancelledInstallations = 0;

        if (installationIds.Count > 0)
        {
            var installations = await _dbContext.Set<Installation>()
                .Where(x => installationIds.Contains(x.Id))
                .ToListAsync(cancellationToken);

            foreach (var installation in installations)
            {
                if (string.Equals(installation.Status, "İptal", StringComparison.OrdinalIgnoreCase)) continue;

                installation.Status = "İptal";
                installation.DealerDescription = string.IsNullOrWhiteSpace(installation.DealerDescription)
                    ? note
                    : $"{installation.DealerDescription} | {note}";
                installation.EditUser = actor;
                installation.EditTime = now;
                cancelledInstallations++;
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Teslimat kaydı ServiceOps'ta; silinemese bile sipariş iptal edilmiş sayılır.
        // Sonuç geri veriliyor ki panel "kargo kaydı elle kapatılmalı" diyebilsin.
        var cargoRemoved = await _cargo.DeleteAsync(order.OrderNo, cancellationToken);

        return Ok(new
        {
            success = true,
            cargoRemoved,
            cancelledInstallations,
            message = "Sipariş iptal edildi."
        });
    }

    public sealed class CancelEcommerceOrderRequest
    {
        [MaxLength(500)]
        public string? Reason { get; set; }
    }

    /// <summary>
    /// BAYİ PANELİ için tek siparişin tam dökümü: kalemler, ürün adları, ödeme ve fatura.
    ///
    /// Liste ucundan ayrı duruyor çünkü liste 300 sipariş dönebiliyor; her birinin kalemlerini de
    /// taşımak listeyi ürün sayısı kadar büyütürdü. Detay yalnızca açılan sipariş için isteniyor.
    ///
    /// Ürün ADI katalogdan, FİYAT siparişten okunuyor. Fiyatı bugünkü katalogdan almak, aylar
    /// önce verilmiş bir siparişte müşterinin ödemediği bir tutarı göstermek olurdu.
    /// </summary>
    [HttpGet("/api/ecommerce/admin/orders/{orderNo}")]
    [InternalApiKey]
    public async Task<IActionResult> GetEcommerceOrderDetail(string orderNo, CancellationToken cancellationToken)
    {
        var code = (orderNo ?? string.Empty).Trim();
        if (code.Length == 0) return BadRequest(new { success = false, message = "Sipariş numarası zorunlu." });

        var order = await _dbContext.Set<SalesOrder>()
            .AsNoTracking()
            .Where(x => x.OrderNo == code && x.ProcessedBy.ToUpper() == "ETICARET")
            .Select(x => new
            {
                x.Id,
                x.OrderNo,
                x.CustomerCode,
                x.ProcessedAt,
                x.Subtotal,
                x.VatTotal,
                x.GrandTotal,
                x.DeliveryName,
                x.DeliveryPhone,
                x.DeliveryAddress,
                x.DeliveryCity,
                x.DeliveryDistrict,
                x.Status,
                Lines = x.Lines.Select(l => new
                {
                    l.Id,
                    l.LineNo,
                    l.StockCode,
                    l.Quantity,
                    l.Montage,
                    l.InstallationId,
                    l.UnitPrice,
                    // Belgenin kendi para birimi de dönmeli: `UnitPrice` TL çapasıdır ve
                    // e-ticaret paneli fiyatı carinin döviz simgesiyle basınca 3.800 ₺'lik
                    // satır "3.800 $" görünüyordu.
                    l.CurrencyTypeId,
                    l.CurrencyRate,
                    l.CurrencyUnitPrice,
                    l.VatRate,
                    l.Description
                }).OrderBy(l => l.LineNo).ToList()
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (order is null) return NotFound(new { success = false, message = "Sipariş bulunamadı." });

        var stockCodes = order.Lines.Select(l => l.StockCode).Distinct().ToList();

        var productNames = await _dbContext.Products
            .AsNoTracking()
            .Where(p => stockCodes.Contains(p.StockCode))
            .Select(p => new { p.StockCode, p.Name })
            .ToDictionaryAsync(x => x.StockCode, x => x.Name, cancellationToken);

        var payment = await _dbContext.EcommerceOrderPayments
            .AsNoTracking()
            .Where(x => x.SalesOrderNo == code)
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        var settled = payment.FirstOrDefault(x => x.Status == (int)EcommercePaymentStatus.Paid) ?? payment.FirstOrDefault();

        var lineIds = order.Lines.Select(l => l.Id).ToList();

        var invoices = await _dbContext.Set<InvoiceLine>()
            .AsNoTracking()
            .Where(l => l.SalesOrderLineId != null && lineIds.Contains(l.SalesOrderLineId!.Value))
            .Join(_dbContext.Set<Invoice>().AsNoTracking(),
                l => l.InvoiceId, i => i.Id,
                (l, i) => new { i.InvoiceNo, i.Date })
            .Distinct()
            .ToListAsync(cancellationToken);

        var customer = await _dbContext.Customers
            .AsNoTracking()
            .Where(c => c.CustomerCode == order.CustomerCode)
            .Select(c => new { c.Name, c.Phone, c.Address, c.District, c.City })
            .FirstOrDefaultAsync(cancellationToken);

        // Montaj kayıtlarının o anki durumu: panel "montaj istendi" ile "montaj yapıldı"yı
        // ayırabilmeli, yoksa bayi her seferinde Montaj Yönetimi'ni açmak zorunda kalır.
        var installationIds = order.Lines
            .Where(l => l.InstallationId.HasValue)
            .Select(l => l.InstallationId!.Value)
            .ToList();

        var installationStatusById = installationIds.Count == 0
            ? new Dictionary<int, string>()
            : await _dbContext.Set<Installation>()
                .AsNoTracking()
                .Where(x => installationIds.Contains(x.Id))
                .ToDictionaryAsync(x => x.Id, x => x.Status, cancellationToken);

        var cargo = await _cargo.GetTrackingAsync(order.OrderNo, cancellationToken);

        return Ok(new
        {
            success = true,
            data = new
            {
                order.OrderNo,
                order.CustomerCode,

                /*
                 * TESLİMAT BİLGİSİ ÖNCE SİPARİŞİN ANLIK GÖRÜNTÜSÜNDEN.
                 *
                 * Cari kartındaki adres müşteri tarafından her an değiştirilebiliyor. Panel
                 * onu okuduğu sürece, altı ay önce teslim edilmiş bir siparişin dökümü de
                 * BUGÜNKÜ adresi gösteriyordu; malın gerçekte nereye gittiği hiçbir yerde
                 * kalmıyordu. Anlık görüntü yoksa (alanlar eklenmeden önce açılmış sipariş)
                 * eskisi gibi cari kartına düşülüyor.
                 */
                CustomerName = order.DeliveryName ?? customer?.Name,
                CustomerPhone = order.DeliveryPhone ?? customer?.Phone,
                CustomerAddress = !string.IsNullOrWhiteSpace(order.DeliveryAddress)
                    ? string.Join(" ", new[] { order.DeliveryAddress, order.DeliveryDistrict, order.DeliveryCity }
                        .Where(x => !string.IsNullOrWhiteSpace(x)))
                    : string.Join(" ", new[] { customer?.Address, customer?.District, customer?.City }
                        .Where(x => !string.IsNullOrWhiteSpace(x))),
                AddressIsSnapshot = !string.IsNullOrWhiteSpace(order.DeliveryAddress),
                order.ProcessedAt,
                order.Subtotal,
                order.VatTotal,
                order.GrandTotal,

                Lines = order.Lines.Select(l => new
                {
                    l.LineNo,
                    l.StockCode,
                    ProductName = productNames.TryGetValue(l.StockCode, out var name) ? name : null,
                    l.Quantity,
                    // UnitPrice/LineTotal TL çapasıdır; satırın kendi parasındaki karşılığı
                    // ayrı alanlarda veriliyor ki panel doğru simgeyle doğru sayıyı bassın.
                    l.UnitPrice,
                    CurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(l.CurrencyTypeId),
                    CurrencyCode = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.ToCodeOrTry(l.CurrencyTypeId),
                    CurrencyRate = l.CurrencyRate <= 0m ? 1m : l.CurrencyRate,
                    CurrencyUnitPrice = l.CurrencyUnitPrice > 0m
                        ? l.CurrencyUnitPrice
                        : (l.CurrencyRate > 0m
                            ? Math.Round(l.UnitPrice / l.CurrencyRate, 4, MidpointRounding.AwayFromZero)
                            : l.UnitPrice),
                    l.VatRate,
                    LineTotal = Math.Round(l.Quantity * l.UnitPrice * (1 + l.VatRate / 100m), 2, MidpointRounding.AwayFromZero),
                    l.Description,

                    // Montaj artık MÜŞTERİ SEÇİMİ. Panelin bunu satır satır göstermesi şart:
                    // montajlı kalem kargoya girmiyor, montaj ekibine gidiyor.
                    l.Montage,
                    InstallationStatus = l.InstallationId.HasValue && installationStatusById.TryGetValue(l.InstallationId.Value, out var instStatus)
                        ? instStatus
                        : null
                }).ToList(),

                PaymentStatus = settled is null
                    ? EcommercePaymentStatus.Pending.ToString()
                    : ((EcommercePaymentStatus)settled.Status).ToString(),
                IsPaid = settled is not null && settled.Status == (int)EcommercePaymentStatus.Paid,
                PaidAt = settled is not null && settled.Status == (int)EcommercePaymentStatus.Paid ? settled.SettledAtUtc : null,
                PaidAmount = settled?.Amount,
                PaymentAttempts = payment.Count,

                IsCancelled = order.Status == B2B.Erp.Api.Features.Ecommerce.EcommerceFulfilmentService.CancelledStatus,

                /*
                 * TESLİMAT DURUMU.
                 *
                 * Yalnızca DETAY ucunda okunuyor, listede değil: her satır için ServiceOps'a
                 * ayrı bir istek demek olurdu ve liste 300 sipariş dönebiliyor. Servise
                 * ulaşılamazsa boş anlık görüntü dönüyor — panel teslimat bilgisi yok diye
                 * sipariş dökümünü göstermemezlik etmemeli.
                 */
                Cargo = new
                {
                    cargo.Exists,
                    cargo.Status,
                    cargo.StatusLabel,
                    cargo.PlannedDate,
                    cargo.UpdatedAt,
                    History = cargo.History.Select(h => new { h.Status, h.StatusLabel, h.Timestamp }).ToList()
                },

                // Kargo kaydı beklenip beklenmeyeceği: siparişin TAMAMI montajlıysa kayıt
                // hiç açılmıyor ve "kargo yok" bir eksiklik değil.
                CargoExpected = order.Lines.Any(l => !l.Montage),
                MontageCount = order.Lines.Count(l => l.Montage),

                Invoices = invoices.Select(x => new { x.InvoiceNo, x.Date }).ToList()
            }
        });
    }

    /// <summary>
    /// Müşterinin kendi faturaları — mağazadaki "Faturalarım" ekranı için.
    ///
    /// Yalnızca SATIŞ faturaları veriliyor. Alış, hizmet, iade, proforma ve teklif belgeleri bu
    /// carinin ekranında işi olmayan belgeler; tip filtresi olmadan cari koduna bakmak, müşteriye
    /// kendisiyle ilgisi olmayan bir belgeyi göstermenin en kolay yolu olurdu.
    ///
    /// Hangi siparişten çıktığı da veriliyor (fatura satırı → sipariş satırı → sipariş), böylece
    /// müşteri "hangi siparişimin faturası bu" sorusunu ekranda cevaplayabiliyor.
    /// </summary>
    [HttpGet("/api/ecommerce/invoices/{customerCode}")]
    [InternalApiKey]
    public async Task<IActionResult> ListEcommerceInvoices(string customerCode, CancellationToken cancellationToken)
    {
        var code = (customerCode ?? string.Empty).Trim();
        if (!code.StartsWith("120-11-", StringComparison.Ordinal)) return Forbid();

        var invoices = await _dbContext.Set<Invoice>()
            .AsNoTracking()
            .Where(x => x.CustomerCode == code && x.Type == InvoiceType.SalesInvoice)
            .OrderByDescending(x => x.Date)
            .Take(100)
            .Select(x => new
            {
                x.Id,
                x.InvoiceNo,
                x.Date,
                x.Subtotal,
                x.Discount,
                x.NetTotal,
                x.VatTotal,
                x.GrandTotal
            })
            .ToListAsync(cancellationToken);

        if (invoices.Count == 0)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var invoiceIds = invoices.Select(x => x.Id).ToList();

        var lines = await _dbContext.Set<InvoiceLine>()
            .AsNoTracking()
            .Where(l => invoiceIds.Contains(l.InvoiceId))
            .Select(l => new
            {
                l.InvoiceId,
                l.StockCode,
                l.Quantity,
                l.UnitPrice,
                l.VatRate,
                l.SalesOrderLineId
            })
            .ToListAsync(cancellationToken);

        var orderLineIds = lines
            .Where(l => l.SalesOrderLineId != null)
            .Select(l => l.SalesOrderLineId!.Value)
            .Distinct()
            .ToList();

        var orderNoByLineId = orderLineIds.Count == 0
            ? new Dictionary<int, string>()
            : await _dbContext.Set<SalesOrderLine>()
                .AsNoTracking()
                .Where(l => orderLineIds.Contains(l.Id))
                .Join(_dbContext.Set<SalesOrder>().AsNoTracking(),
                    l => l.SalesOrderId, o => o.Id,
                    (l, o) => new { l.Id, o.OrderNo })
                .ToDictionaryAsync(x => x.Id, x => x.OrderNo, cancellationToken);

        var linesByInvoice = lines.GroupBy(l => l.InvoiceId).ToDictionary(g => g.Key, g => g.ToList());

        var data = invoices.Select(inv =>
        {
            linesByInvoice.TryGetValue(inv.Id, out var invLines);
            invLines ??= new();

            var orderNo = invLines
                .Where(l => l.SalesOrderLineId != null && orderNoByLineId.ContainsKey(l.SalesOrderLineId!.Value))
                .Select(l => orderNoByLineId[l.SalesOrderLineId!.Value])
                .FirstOrDefault();

            return new
            {
                inv.InvoiceNo,
                inv.Date,
                inv.Subtotal,
                inv.Discount,
                inv.NetTotal,
                inv.VatTotal,
                inv.GrandTotal,
                OrderNo = orderNo,
                Lines = invLines.Select(l => new { l.StockCode, l.Quantity, l.UnitPrice, l.VatRate }).ToList()
            };
        }).ToList();

        return Ok(new { success = true, data });
    }
}
