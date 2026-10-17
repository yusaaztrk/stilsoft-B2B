using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Core.Http;
using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
[AuthorizePage("invoice", "irsaliye")]
public sealed class IrsaliyeController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly Core.Interfaces.IMoneyServiceClient _money;


    /// <summary>
    /// FİRMANIN SAATİ (2026-08-20 kullanıcı kararı, denetim md. D1). "Bugün" UTC takvim
    /// gününden okunuyordu; KKTC (UTC+3) gibi bir yerde yerel 00:00–03:00 arasında yapılan
    /// işlem BİR ÖNCEKİ güne damgalanıyordu.
    /// </summary>
    private readonly B2B.Erp.Api.Core.Helpers.CompanyClock _clock;

    public IrsaliyeController(
        AppDbContext dbContext,
        Core.Interfaces.IMoneyServiceClient money,
        B2B.Erp.Api.Core.Helpers.CompanyClock clock)
    {
        _dbContext = dbContext;
        _money = money;
        _clock = clock;
    }

    /// <summary>
    /// İrsaliye fiyatının para birimi ve TL karşılığı.
    ///
    /// <para>
    /// Birim fiyat <c>ProductPrices.Price</c>'tan geliyor ve o değer <b>ÜRÜNÜN SATIŞ
    /// dövizindedir</b> (fiyat satırları <c>Product.SalesCurrencyCode</c>'a göre yazılır,
    /// bkz. <c>BulkPricingController</c>). Buna rağmen tutar hem sipariş hem fatura satırının
    /// TL kolonuna HAM yazılıyor, döviz alanlarına ise hiç dokunulmuyordu: 500 $'lık bir ürünün
    /// irsaliyesi deftere 500 ₺ olarak düşüyordu. Bütün raporlar ve kredi limiti TL kolonunu
    /// okuduğu için bu bir görüntü sorunu değildi.
    /// </para>
    ///
    /// <para>
    /// Kur alınamazsa 1'e düşülür — irsaliye kesilememesindense bugünkü davranış korunur; satır
    /// <c>CurrencyRate = 1</c> ile damgalandığı için sonradan ayırt edilebilir kalır.
    /// </para>
    /// </summary>
    private async Task<(int CurrencyTypeId, decimal Rate, decimal TryUnitPrice)> ResolveLinePriceAsync(
        int salesCurrencyCode, decimal unitPrice, CancellationToken cancellationToken)
    {
        var currencyTypeId = Core.Helpers.CurrencyTypeHelper.Normalize(salesCurrencyCode);
        if (Core.Helpers.CurrencyTypeHelper.IsTry(currencyTypeId))
        {
            return (currencyTypeId, 1m, unitPrice);
        }

        var rate = 1m;
        var code = Core.Helpers.CurrencyTypeHelper.ToCode(currencyTypeId);
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

        return (currencyTypeId, rate, Math.Round(unitPrice * rate, 4, MidpointRounding.AwayFromZero));
    }

    public sealed class CreateIrsaliyeRequest
    {
        [StringLength(50)]
        public string? IrsaliyeNo { get; set; }

        [Required]
        [StringLength(50)]
        public string CustomerCode { get; set; } = string.Empty;

        [Required]
        public Guid ProductId { get; set; }

        [Required]
        [Range(0.0001d, 999999999d, ErrorMessage = "Quantity must be between 0.0001 and 999999999")]
        public decimal Quantity { get; set; }

        [StringLength(2000)]
        public string? Description { get; set; }

        [Required]
        public string Date { get; set; } = string.Empty;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(CancellationToken cancellationToken = default)
    {
        var query = _dbContext.Set<Irsaliye>().AsNoTracking();

        // CARİ KAPSAMI: liste, kullanıcının portföyüyle sınırlanır. Sayfa yetkisi (sınıf
        // seviyesinde `irsaliye`) "hangi ekranı açabilir" sorusunu cevaplıyor, "kimin belgesini
        // görebilir" sorusunu değil — portföyü sınırlı bir plasiyer ya da bayi, yetki verildiği
        // anda bütün firmaların sevk irsaliyelerini, teslimat bilgilerini ve miktarlarını
        // görebiliyordu. Kapsam boş/'*' ise (ofis kullanıcısı) davranış eskisiyle aynı.
        if (!CustomerScope.IsUnrestrictedFor(User))
        {
            var allowed = await CustomerScope.ExpandAsync(
                _dbContext.Customers.AsNoTracking(), CustomerScope.Of(User), cancellationToken);

            query = query.Where(x => allowed.Contains(x.CustomerCode));
        }

        var data = await query
            .OrderByDescending(x => x.Date)
            .ThenByDescending(x => x.Id)
            .Select(x => new
            {
                id = x.Id,
                irsaliyeNo = x.IrsaliyeNo,
                customerCode = x.CustomerCode,
                customerName = x.Customer != null ? x.Customer.Name : x.CustomerCode,
                productCode = x.Product != null ? x.Product.StockCode : string.Empty,
                productName = x.Product != null ? x.Product.Name : string.Empty,
                quantity = x.Quantity,
                shippedQuantity = x.ShippedQuantity,
                date = x.Date.ToString("yyyy-MM-dd"),
                description = x.Description ?? string.Empty,
                transferredSalesOrderId = x.TransferredSalesOrderId,
                status = x.Status == IrsaliyeStatus.Onaylandi ? "onaylandi" : x.Status == IrsaliyeStatus.SevkEdildi ? "sevkEdildi" : "beklemede",
                createUser = x.CreateUser,
                createUserRole = x.CreateUserRole
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById([FromRoute] int id, CancellationToken cancellationToken = default)
    {
        var data = await _dbContext.Set<Irsaliye>()
            .AsNoTracking()
            .Where(x => x.Id == id)
            .Select(x => new
            {
                id = x.Id,
                irsaliyeNo = x.IrsaliyeNo,
                customerCode = x.CustomerCode,
                date = x.Date.ToString("yyyy-MM-dd")
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (data is null)
        {
            return NotFound(new { success = false, message = "İrsaliye bulunamadı" });
        }

        return Ok(new { success = true, data });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateIrsaliyeRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var irsaliyeNo = (request.IrsaliyeNo ?? string.Empty).Trim();
        var customerCode = (request.CustomerCode ?? string.Empty).Trim();
        var desc = request.Description?.Trim();

        if (string.IsNullOrWhiteSpace(irsaliyeNo))
        {
            irsaliyeNo = await NextIrsaliyeNoAsync(cancellationToken);
        }

        var existingCount = await _dbContext.Set<Irsaliye>()
            .CountAsync(x => x.IrsaliyeNo == irsaliyeNo, cancellationToken);
        if (existingCount >= 17)
        {
            return BadRequest(new { success = false, message = "Bir konsinye belgesinde en fazla 17 kalem ürün bulunabilir." });
        }

        if (string.IsNullOrWhiteSpace(customerCode)) ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode is required.");
        if (request.Quantity <= 0) ModelState.AddModelError(nameof(request.Quantity), "Quantity must be > 0.");

        if (!DateTime.TryParse(request.Date, out var parsedDate))
        {
            ModelState.AddModelError(nameof(request.Date), "Date is invalid.");
        }

        var dateUtc = DateTime.SpecifyKind(parsedDate.Date, DateTimeKind.Utc);

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var customerExists = await _dbContext.Customers
            .AsNoTracking()
            .AnyAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (!customerExists)
        {
            ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode is invalid.");
            return ValidationProblem(ModelState);
        }

        var productExists = await _dbContext.Products
            .AsNoTracking()
            .AnyAsync(x => x.Id == request.ProductId && x.IsActive, cancellationToken);

        if (!productExists)
        {
            ModelState.AddModelError(nameof(request.ProductId), "ProductId is invalid.");
            return ValidationProblem(ModelState);
        }

        var role = User.FindFirst(ClaimTypes.Role)?.Value;
        role = string.IsNullOrWhiteSpace(role) ? string.Empty : role.Trim();

        var entity = new Irsaliye
        {
            IrsaliyeNo = irsaliyeNo,
            CustomerCode = customerCode,
            ProductId = request.ProductId,
            Quantity = request.Quantity,
            Description = string.IsNullOrWhiteSpace(desc) ? null : desc,
            Date = dateUtc,
            Status = IrsaliyeStatus.Beklemede,
            CreateUser = User.Identity?.Name ?? "System",
            CreateUserRole = role,
            CreateTime = DateTime.UtcNow
        };

        _dbContext.Set<Irsaliye>().Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return CreatedAtAction(nameof(GetAll), new { id = entity.Id }, new { success = true, data = new { id = entity.Id, irsaliyeNo = entity.IrsaliyeNo } });
    }

    public sealed class TransferToSalesOrderRequest
    {
        [Required]
        [Range(0.0001, 999999999)]
        public decimal SoldQuantity { get; set; }

        public DateTime? Date { get; set; }

        [StringLength(2000)]
        public string? Description { get; set; }
    }

    [HttpPost("{id:int}/transfer-to-sales-order")]
    [AuthorizePage("invoice", "irsaliye")]
    public async Task<IActionResult> TransferToSalesOrder(
        [FromRoute] int id,
        [FromBody] TransferToSalesOrderRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        // AKTARIM KİLİTLİ OKUNUR (denetim md. 226).
        //
        // "Zaten aktarıldı mı" kontrolü `AsNoTracking` ile okunuyor, damga ise metodun EN
        // SONUNDA basılıyordu: aynı irsaliyeyi açan iki muhasebeci "Faturaya Dönüştür"e aynı
        // anda bastığında ikisi de kontrolden geçip İKİ AYRI satış siparişi üretiyordu.
        // Satır `FOR UPDATE` ile kilitleniyor; ikinci istek birincinin bitmesini bekliyor ve
        // damgayı görüp dostça hata alıyor. Kilit işlem (transaction) boyunca sürer, o yüzden
        // bütün metot tek transaction'a alındı — erken dönüşlerde `using` geri sarıyor.
        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        // Kilit AYRI bir ifadeyle alınıyor, satır normal LINQ ile okunuyor.
        //
        // `FromSqlRaw("SELECT * …")` ile okumak, dönen sütunların varlığın eşlenmiş bütün
        // özellikleriyle birebir örtüşmesini şart koşar; ileride tabloya/varlığa eklenen tek
        // bir alan bu ucu çalışma zamanında kırardı. `FOR UPDATE` satırı transaction boyunca
        // zaten kilitler, sonucu okumak gerekmez.
        await _dbContext.Database.ExecuteSqlRawAsync(
            @"SELECT 1 FROM ""Irsaliye"" WHERE ""Id"" = {0} FOR UPDATE", id);

        var irsaliye = await _dbContext.Set<Irsaliye>()
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (irsaliye is null)
        {
            return NotFound(new { success = false, message = "İrsaliye bulunamadı" });
        }

        if (irsaliye.TransferredSalesOrderId.HasValue)
        {
            return BadRequest(new { success = false, message = "Bu irsaliye zaten satış siparişine aktarıldı" });
        }

        if (irsaliye.ShippedQuantity is null || irsaliye.ShippedQuantity <= 0)
        {
            return BadRequest(new { success = false, message = "Sevk adedi girilmeden satış faturasına aktarılamaz" });
        }

        var sold = request.SoldQuantity;
        if (sold <= 0)
        {
            return BadRequest(new { success = false, message = "Satılan adet 0'dan büyük olmalıdır" });
        }
        if (sold > irsaliye.ShippedQuantity.Value)
        {
            return BadRequest(new { success = false, message = "Satılan adet sevk adedinden büyük olamaz" });
        }

        var customer = await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == irsaliye.CustomerCode, cancellationToken);

        if (customer is null)
        {
            return BadRequest(new { success = false, message = "Cari bulunamadı" });
        }

        var product = await _dbContext.Products
            .FirstOrDefaultAsync(x => x.Id == irsaliye.ProductId, cancellationToken);

        if (product is null)
        {
            return BadRequest(new { success = false, message = "Ürün bulunamadı" });
        }

        if (!customer.PriceGroupId.HasValue || customer.PriceGroupId.Value == Guid.Empty)
        {
            return BadRequest(new { success = false, message = "Cari için fiyat grubu tanımlı değil" });
        }

        var priceGroupId = customer.PriceGroupId;
        decimal unitPrice = 0m;

        if (priceGroupId.HasValue)
        {
            // Şubede özel fiyat BAĞLI CARİDEN okunur; bkz. CustomerPriceOwner.
            var overrideCustomerCode = await Core.Helpers.CustomerPriceOwner.ResolveAsync(
                _dbContext, customer.CustomerCode, cancellationToken);

            var overridePrice = await _dbContext.CustomerProductPriceOverrides
                .AsNoTracking()
                .Where(x => x.IsActive)
                .Where(x => x.CustomerCode == overrideCustomerCode)
                .Where(x => x.ProductId == product.Id)
                .Where(x => x.PriceGroupId == priceGroupId.Value)
                .Select(x => (decimal?)x.Price)
                .FirstOrDefaultAsync(cancellationToken);

            if (overridePrice.HasValue)
            {
                unitPrice = overridePrice.Value;
            }
            else
            {
                var pgPrice = await _dbContext.ProductPrices
                    .AsNoTracking()
                    .Where(x => x.ProductId == product.Id)
                    .Where(x => x.PriceGroupId == priceGroupId.Value)
                    .Select(x => (decimal?)x.Price)
                    .OrderBy(x => x)
                    .FirstOrDefaultAsync(cancellationToken);

                if (pgPrice.HasValue)
                {
                    unitPrice = pgPrice.Value;
                }
            }
        }

        if (unitPrice <= 0)
        {
            var anyPrice = await _dbContext.ProductPrices
                .AsNoTracking()
                .Where(x => x.ProductId == product.Id)
                .Select(x => (decimal?)x.Price)
                .OrderBy(x => x)
                .FirstOrDefaultAsync(cancellationToken);

            unitPrice = anyPrice ?? 0m;
        }

        if (unitPrice <= 0)
        {
            return BadRequest(new { success = false, message = "Ürün için fiyat bulunamadı" });
        }

        var vatRate = (decimal)Math.Max(0, product.TaxRate);

        // Fiyat ürünün satış dövizinde; TL çapası buradan itibaren kullanılıyor.
        var (lineCurrencyTypeId, lineCurrencyRate, tryUnitPrice) =
            await ResolveLinePriceAsync(product.SalesCurrencyCode, unitPrice, cancellationToken);
        var currencyUnitPrice = unitPrice;

        var subtotal = sold * tryUnitPrice;
        var vatTotal = subtotal * (vatRate / 100m);
        var grandTotal = subtotal + vatTotal;

        var now = DateTime.UtcNow;
        var username = User.Identity?.Name ?? "System";

        async Task<string> GenerateSiparisNo(CancellationToken ct)
        {
            for (var i = 0; i < 5; i++)
            {
                var candidate = "S" + DateTime.UtcNow.ToString("yyMMddHHmmssff");
                var existsOrder = await _dbContext.Set<SalesOrder>()
                    .AsNoTracking()
                    .AnyAsync(x => x.OrderNo == candidate, ct);

                if (!existsOrder)
                {
                    return candidate;
                }

                await Task.Delay(25, ct);
            }

            return "S" + DateTime.UtcNow.ToString("yyMMddHHmmssff");
        }

        var siparisNo = await GenerateSiparisNo(cancellationToken);

        var order = new SalesOrder
        {
            CustomerCode = customer.CustomerCode,
            DeliveryCustomerCode = customer.CustomerCode,
            Subtotal = subtotal,
            VatTotal = vatTotal,
            GrandTotal = grandTotal,
            CampaignDiscount = 0m,
            CampaignDetailsJson = null,
            Status = 0,
            OrderNo = siparisNo,
            ProcessedBy = username,
            ProcessedAt = now,
            CreateUser = username,
            CreateTime = now,
            EditUser = null,
            EditTime = null
        };

        var orderLine = new SalesOrderLine
        {
            SalesOrder = order,
            InstallationId = null,
            StockCode = product.StockCode,
            Description = string.IsNullOrWhiteSpace(request.Description) ? (string.IsNullOrWhiteSpace(irsaliye.Description) ? null : irsaliye.Description) : request.Description.Trim(),
            Quantity = sold,
            // TL çapa + kendi dövizi (bkz. ResolveLinePriceAsync). Öncesinde döviz alanlarına
            // hiç dokunulmuyordu: satır 0/0/0 ile yazılıyor, dolarlı fiyat TL sanılıyordu.
            UnitPrice = tryUnitPrice,
            CurrencyTypeId = lineCurrencyTypeId,
            CurrencyRate = lineCurrencyRate,
            CurrencyUnitPrice = currencyUnitPrice,
            VatRate = vatRate,
            LineNo = 1,
            CampaignCode = null,
            Montage = false,
            GroupId = null,
            OrderNo = siparisNo,
            CreateUser = username,
            CreateTime = now,
            EditUser = null,
            EditTime = null
        };

        order.Lines.Add(orderLine);
        _dbContext.Set<SalesOrder>().Add(order);

        var returnedQty = irsaliye.ShippedQuantity.Value - sold;
        if (returnedQty > 0)
        {
            var warehouseCode = await _dbContext.Warehouses
                .OrderBy(x => x.WarehouseCode)
                .Select(x => x.WarehouseCode)
                .FirstOrDefaultAsync(cancellationToken);
            if (warehouseCode == 0) warehouseCode = 1;

            var returnMovement = new StockMovement
            {
                InvoiceNo = "KONS-IADE-" + irsaliye.IrsaliyeNo,
                CustomerCode = irsaliye.CustomerCode,
                DeliveryCustomerCode = irsaliye.CustomerCode,
                StockCode = product.StockCode,
                Direction = StockMovementDirection.In,
                Quantity = returnedQty,
                // İADE HAREKETİ MALİYETSİZ YAZILAMAZ. `UnitPrice = 0` ile geri giren mal,
                // deponun ağırlıklı ortalama maliyetini aşağı çekiyordu (aynı hata depo
                // transferinde de vardı, orada da düzeltildi). Satırın TL çapa fiyatı zaten
                // çözülmüş durumda — mal hangi değerle çıktıysa o değerle geri girer.
                UnitPrice = tryUnitPrice,
                // TL çapa + kendi dövizi; stok hareketi de artık para birimi taşıyor (2026-08-19).
                CurrencyTypeId = lineCurrencyTypeId,
                CurrencyRate = lineCurrencyRate <= 0m ? 1m : lineCurrencyRate,
                CurrencyUnitPrice = currencyUnitPrice,
                NetUnitPrice = tryUnitPrice,
                VatRate = vatRate,
                Delivered = true,
                Date = _clock.TodayAsDocumentDate(),
                WarehouseCode = warehouseCode,
                LineNo = 1,
                CreateUser = username,
                CreateTime = now
            };
            _dbContext.Set<StockMovement>().Add(returnMovement);

            if (product != null)
            {
                product.Stock += (int)Math.Round(returnedQty, MidpointRounding.AwayFromZero);
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        var editEntity = await _dbContext.Set<Irsaliye>()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (editEntity is not null)
        {
            editEntity.TransferredSalesOrderId = order.Id;

            var marker = "FATURAYA_AKTARILDI";
            var existingDesc = (editEntity.Description ?? string.Empty).Trim();
            if (!existingDesc.Contains(marker, StringComparison.OrdinalIgnoreCase))
            {
                editEntity.Description = string.IsNullOrWhiteSpace(existingDesc) ? marker : (existingDesc + " | " + marker);
            }
            editEntity.EditUser = username;
            editEntity.EditTime = now;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, data = new { siparisNo, id = order.Id } });
    }

    public sealed class UpdateIrsaliyeRequest
    {
        [Required]
        public string Status { get; set; } = string.Empty;

        [Range(0.0001, 999999999)]
        public decimal? Quantity { get; set; }

        public decimal? ShippedQuantity { get; set; }

        public int? WarehouseCode { get; set; }
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update([FromRoute] int id, [FromBody] UpdateIrsaliyeRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var entity = await _dbContext.Set<Irsaliye>()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (entity is null)
        {
            return NotFound(new { success = false, message = "İrsaliye bulunamadı" });
        }

        var statusRaw = (request.Status ?? string.Empty).Trim();
        var nextStatus = statusRaw switch
        {
            "beklemede" => IrsaliyeStatus.Beklemede,
            "onaylandi" => IrsaliyeStatus.Onaylandi,
            "sevkEdildi" => IrsaliyeStatus.SevkEdildi,
            _ => (IrsaliyeStatus?)null
        };

        if (nextStatus is null)
        {
            ModelState.AddModelError(nameof(request.Status), "Status is invalid.");
            return ValidationProblem(ModelState);
        }

        var shipped = request.ShippedQuantity;
        var qty = request.Quantity;
        if (qty is not null)
        {
            if (qty <= 0)
            {
                ModelState.AddModelError(nameof(request.Quantity), "Quantity must be > 0.");
            }
        }

        var effectiveQty = qty ?? entity.Quantity;

        if (shipped is not null)
        {
            if (shipped <= 0)
            {
                ModelState.AddModelError(nameof(request.ShippedQuantity), "ShippedQuantity must be > 0.");
            }
            if (shipped > effectiveQty)
            {
                ModelState.AddModelError(nameof(request.ShippedQuantity), "ShippedQuantity cannot be greater than Quantity.");
            }
        }

        if (nextStatus == IrsaliyeStatus.SevkEdildi && shipped is null)
        {
            ModelState.AddModelError(nameof(request.ShippedQuantity), "ShippedQuantity is required when status is SevkEdildi.");
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        entity.Status = nextStatus.Value;
        if (qty is not null)
        {
            entity.Quantity = qty.Value;
        }
        entity.ShippedQuantity = shipped;
        entity.EditUser = User.Identity?.Name ?? "System";
        entity.EditTime = DateTime.UtcNow;

        if (nextStatus.Value == IrsaliyeStatus.SevkEdildi)
        {
            var product = await _dbContext.Products
                .FirstOrDefaultAsync(x => x.Id == entity.ProductId, cancellationToken);
            var stockCode = product?.StockCode ?? string.Empty;
            var vatRate = product?.TaxRate ?? 20m;

            var currentUsername = User.Identity?.Name ?? "System";
            int warehouseCode;
            if (request.WarehouseCode.HasValue && request.WarehouseCode.Value > 0)
            {
                warehouseCode = request.WarehouseCode.Value;
            }
            else
            {
                warehouseCode = await GetUserWarehouseFallbackAsync(currentUsername, cancellationToken);
            }

            var existingMovement = await _dbContext.Set<StockMovement>()
                .FirstOrDefaultAsync(x => x.InvoiceNo == "KONS-" + entity.IrsaliyeNo && x.StockCode == stockCode, cancellationToken);

            var newQty = shipped ?? entity.Quantity;

            if (existingMovement is not null)
            {
                if (product != null)
                {
                    var delta = newQty - existingMovement.Quantity;
                    // Kırpma kaldırıldı (2026-08-20 kullanıcı kararı): stok eksiye düşebilir,
                    // sıfıra çekmek aşırı satışı gizliyordu. Bkz. InvoicesController'daki aynı not.
                    product.Stock = product.Stock - (int)Math.Round(delta, MidpointRounding.AwayFromZero);
                }
                existingMovement.Quantity = newQty;
                existingMovement.WarehouseCode = warehouseCode;
                existingMovement.EditUser = User.Identity?.Name ?? "System";
                existingMovement.EditTime = DateTime.UtcNow;
            }
            else
            {
                if (product != null)
                {
                    product.Stock = product.Stock - (int)Math.Round(newQty, MidpointRounding.AwayFromZero);
                }
                var movement = new StockMovement
                {
                    InvoiceNo = "KONS-" + entity.IrsaliyeNo,
                    CustomerCode = entity.CustomerCode,
                    DeliveryCustomerCode = entity.CustomerCode,
                    StockCode = stockCode,
                    Direction = StockMovementDirection.Out,
                    Quantity = newQty,
                    UnitPrice = 0,
                    NetUnitPrice = 0,
                    VatRate = vatRate,
                    Delivered = true,
                    Date = _clock.TodayAsDocumentDate(),
                    WarehouseCode = warehouseCode,
                    LineNo = 1,
                    CreateUser = User.Identity?.Name ?? "System",
                    CreateTime = DateTime.UtcNow
                };
                _dbContext.Set<StockMovement>().Add(movement);
            }
        }
        else
        {
            var product = await _dbContext.Products
                .FirstOrDefaultAsync(x => x.Id == entity.ProductId, cancellationToken);
            var stockCode = product?.StockCode ?? string.Empty;

            var existingMovement = await _dbContext.Set<StockMovement>()
                .FirstOrDefaultAsync(x => x.InvoiceNo == "KONS-" + entity.IrsaliyeNo && x.StockCode == stockCode, cancellationToken);

            if (existingMovement is not null)
            {
                if (product != null)
                {
                    product.Stock += (int)Math.Round(existingMovement.Quantity, MidpointRounding.AwayFromZero);
                }
                _dbContext.Set<StockMovement>().Remove(existingMovement);
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpDelete("by-no/{irsaliyeNo}")]
    public async Task<IActionResult> DeleteByNo([FromRoute] string irsaliyeNo, CancellationToken cancellationToken)
    {
        var no = (irsaliyeNo ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(no))
        {
            return BadRequest(new { success = false, message = "İrsaliyeNo gerekli" });
        }

        var entities = await _dbContext.Set<Irsaliye>()
            .Where(x => x.IrsaliyeNo == no)
            .ToListAsync(cancellationToken);

        if (entities.Count == 0)
        {
            return NotFound(new { success = false, message = "İrsaliye bulunamadı" });
        }

        if (entities.Any(x => x.Status == IrsaliyeStatus.SevkEdildi))
        {
            return BadRequest(new { success = false, message = "Sevk edilmiş kalemler silinemez. Önce 'Konsinye Geri Al' işlemini yapın." });
        }

        foreach (var entity in entities)
        {
            var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, entity, "deleteRule/irsaliye", cancellationToken);
            if (silmeKurali is not null) return silmeKurali;
        }

        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        var details = new
        {
            irsaliyeNo = no,
            count = entities.Count,
            items = entities.Select(entity => new
            {
                id = entity.Id,
                irsaliyeNo = entity.IrsaliyeNo,
                customerCode = entity.CustomerCode,
                productId = entity.ProductId,
                quantity = entity.Quantity,
                shippedQuantity = entity.ShippedQuantity,
                description = entity.Description,
                date = entity.Date,
                status = (int)entity.Status,
                transferredSalesOrderId = entity.TransferredSalesOrderId,
                createUserRole = entity.CreateUserRole,
                createUser = entity.CreateUser,
                createTime = entity.CreateTime
            }).ToList()
        };

        _dbContext.Set<DeletionLog>().Add(new DeletionLog
        {
            ModuleKey = "invoice",
            PageKey = "irsaliye",
            RecordType = "IrsaliyeBatch",
            RecordId = no,
            ParentType = null,
            ParentId = null,
            Description = $"İrsaliye silindi: {no} (satır: {entities.Count}). [Etki: İrsaliye silindiği için stoklar eski haline getirildi.]",
            DetailsJson = JsonSerializer.Serialize(details),
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        });

        var movements = await _dbContext.Set<StockMovement>()
            .Where(x => x.InvoiceNo == "KONS-" + no)
            .ToListAsync(cancellationToken);
        if (movements.Count > 0)
        {
            _dbContext.Set<StockMovement>().RemoveRange(movements);
        }

        _dbContext.Set<Irsaliye>().RemoveRange(entities);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.Set<Irsaliye>()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (entity is null)
        {
            return NotFound(new { success = false, message = "İrsaliye bulunamadı" });
        }

        if (entity.Status == IrsaliyeStatus.SevkEdildi)
        {
            return BadRequest(new { success = false, message = "Sevk edilmiş kalemler silinemez. Önce 'Konsinye Geri Al' işlemini yapın." });
        }

        var silmeKurali = await this.DeleteRuleViolationAsync(_dbContext, entity, "deleteRule/irsaliye", cancellationToken);
        if (silmeKurali is not null) return silmeKurali;

        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        var details = new
        {
            id = entity.Id,
            irsaliyeNo = entity.IrsaliyeNo,
            customerCode = entity.CustomerCode,
            productId = entity.ProductId,
            quantity = entity.Quantity,
            shippedQuantity = entity.ShippedQuantity,
            description = entity.Description,
            date = entity.Date,
            status = (int)entity.Status,
            transferredSalesOrderId = entity.TransferredSalesOrderId,
            createUserRole = entity.CreateUserRole,
            createUser = entity.CreateUser,
            createTime = entity.CreateTime
        };

        _dbContext.Set<DeletionLog>().Add(new DeletionLog
        {
            ModuleKey = "invoice",
            PageKey = "irsaliye",
            RecordType = "Irsaliye",
            RecordId = entity.Id.ToString(),
            ParentType = null,
            ParentId = null,
            Description = $"İrsaliye silindi: {entity.IrsaliyeNo}. [Etki: İrsaliye silindiği için stoklar eski haline getirildi.]",
            DetailsJson = JsonSerializer.Serialize(details),
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        });

        var product = await _dbContext.Products
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == entity.ProductId, cancellationToken);
        var stockCode = product?.StockCode ?? string.Empty;
        var movement = await _dbContext.Set<StockMovement>()
            .FirstOrDefaultAsync(x => x.InvoiceNo == "KONS-" + entity.IrsaliyeNo && x.StockCode == stockCode, cancellationToken);
        if (movement is not null)
        {
            _dbContext.Set<StockMovement>().Remove(movement);
        }

        _dbContext.Set<Irsaliye>().Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpPost("by-no/{irsaliyeNo}/revert")]
    public async Task<IActionResult> RevertByNo([FromRoute] string irsaliyeNo, CancellationToken cancellationToken)
    {
        var no = (irsaliyeNo ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(no))
        {
            return BadRequest(new { success = false, message = "İrsaliyeNo gerekli" });
        }

        var entities = await _dbContext.Set<Irsaliye>()
            .Include(x => x.Product)
            .Where(x => x.IrsaliyeNo == no)
            .ToListAsync(cancellationToken);

        if (entities.Count == 0)
        {
            return NotFound(new { success = false, message = "İrsaliye bulunamadı" });
        }

        // Allow revert if any item has been dispatched (SevkEdildi), has a shipped quantity,
        // or has been transferred to a sales order — covering all non-initial states.
        var hasAnythingToRevert = entities.Any(x =>
            x.Status == IrsaliyeStatus.SevkEdildi ||
            x.ShippedQuantity.HasValue ||
            x.TransferredSalesOrderId.HasValue);

        if (!hasAnythingToRevert)
        {
            return BadRequest(new { success = false, message = "Konsinye zaten başlangıç durumunda, geri alacak işlem yok." });
        }

        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "System";

        // Check if the transferred sales order has been invoiced
        var salesOrderIds = entities
            .Where(x => x.TransferredSalesOrderId.HasValue)
            .Select(x => x.TransferredSalesOrderId!.Value)
            .Distinct()
            .ToList();

        if (salesOrderIds.Count > 0)
        {
            // Get all SalesOrderLine IDs for these orders
            var salesOrderLineIds = await _dbContext.Set<SalesOrderLine>()
                .AsNoTracking()
                .Where(x => salesOrderIds.Contains(x.SalesOrderId))
                .Select(x => x.Id)
                .ToListAsync(cancellationToken);

            // Check if any InvoiceLine references these SalesOrderLines
            if (salesOrderLineIds.Count > 0)
            {
                var isInvoiced = await _dbContext.Set<InvoiceLine>()
                    .AsNoTracking()
                    .AnyAsync(x => x.SalesOrderLineId.HasValue && salesOrderLineIds.Contains(x.SalesOrderLineId.Value), cancellationToken);

                if (isInvoiced)
                {
                    return BadRequest(new { success = false, message = "Bu konsinye için fatura kesilmiş. Faturayı iptal etmeden konsinye geri alınamaz." });
                }
            }

            // Delete SalesOrders and their lines
            var salesOrders = await _dbContext.Set<SalesOrder>()
                .Include(x => x.Lines)
                .Where(x => salesOrderIds.Contains(x.Id))
                .ToListAsync(cancellationToken);

            foreach (var order in salesOrders)
            {
                _dbContext.Set<SalesOrderLine>().RemoveRange(order.Lines);
            }
            _dbContext.Set<SalesOrder>().RemoveRange(salesOrders);
        }

        // Remove outgoing stock movements (KONS-{no})
        var outMovements = await _dbContext.Set<StockMovement>()
            .Where(x => x.InvoiceNo == "KONS-" + no)
            .ToListAsync(cancellationToken);
        if (outMovements.Count > 0)
        {
            _dbContext.Set<StockMovement>().RemoveRange(outMovements);
        }

        // Remove return stock movements (KONS-IADE-{no})
        var returnMovements = await _dbContext.Set<StockMovement>()
            .Where(x => x.InvoiceNo == "KONS-IADE-" + no)
            .ToListAsync(cancellationToken);
        if (returnMovements.Count > 0)
        {
            _dbContext.Set<StockMovement>().RemoveRange(returnMovements);
        }

        // Reset all consignment line items and restore Product.Stock
        var marker = "FATURAYA_AKTARILDI";
        foreach (var entity in entities)
        {
            if (entity.ShippedQuantity.HasValue)
            {
                var returnedQty = returnMovements
                    .Where(x => x.StockCode == entity.Product?.StockCode || (entity.Product != null && x.StockCode == entity.Product.StockCode))
                    .Sum(x => x.Quantity);
                var netDeducted = entity.ShippedQuantity.Value - returnedQty;
                if (netDeducted > 0)
                {
                    var product = await _dbContext.Products
                        .FirstOrDefaultAsync(p => p.Id == entity.ProductId, cancellationToken);
                    if (product != null)
                    {
                        product.Stock += (int)Math.Round(netDeducted, MidpointRounding.AwayFromZero);
                    }
                }
            }

            entity.Status = IrsaliyeStatus.Beklemede;
            entity.ShippedQuantity = null;
            entity.TransferredSalesOrderId = null;

            if (!string.IsNullOrWhiteSpace(entity.Description))
            {
                entity.Description = entity.Description
                    .Replace(" | " + marker, "", StringComparison.OrdinalIgnoreCase)
                    .Replace(marker + " | ", "", StringComparison.OrdinalIgnoreCase)
                    .Replace(marker, "", StringComparison.OrdinalIgnoreCase)
                    .Trim();
                if (string.IsNullOrWhiteSpace(entity.Description))
                    entity.Description = null;
            }

            entity.EditUser = username;
            entity.EditTime = DateTime.UtcNow;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }

    public sealed class CreateSalesInvoiceFromIrsaliyeRequest
    {
        [Required]
        [Range(0.0001, 999999999)]
        public decimal SoldQuantity { get; set; }

        [StringLength(1)]
        public string? InvoiceSerie { get; set; }

        public string? InvoiceNumber { get; set; }

        public DateTime? Date { get; set; }

        [StringLength(2000)]
        public string? Description { get; set; }
    }

    [AtomicRequest]
    [HttpPost("{id:int}/create-sales-invoice")]
    [AuthorizePage("invoice", "irsaliye")]
    public async Task<IActionResult> CreateSalesInvoiceFromIrsaliye(
        [FromRoute] int id,
        [FromBody] CreateSalesInvoiceFromIrsaliyeRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var irsaliye = await _dbContext.Set<Irsaliye>()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (irsaliye is null)
        {
            return NotFound(new { success = false, message = "İrsaliye bulunamadı" });
        }

        if (irsaliye.ShippedQuantity is null || irsaliye.ShippedQuantity <= 0)
        {
            return BadRequest(new { success = false, message = "Sevk adedi girilmeden faturaya aktarılamaz" });
        }

        var sold = request.SoldQuantity;
        if (sold <= 0)
        {
            return BadRequest(new { success = false, message = "Satılan adet 0'dan büyük olmalıdır" });
        }
        if (sold > irsaliye.ShippedQuantity.Value)
        {
            return BadRequest(new { success = false, message = "Satılan adet sevk adedinden büyük olamaz" });
        }

        var customer = await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == irsaliye.CustomerCode, cancellationToken);

        if (customer is null)
        {
            return BadRequest(new { success = false, message = "Cari bulunamadı" });
        }

        var product = await _dbContext.Products
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == irsaliye.ProductId, cancellationToken);

        if (product is null)
        {
            return BadRequest(new { success = false, message = "Ürün bulunamadı" });
        }

        var customerInvoiceTypeNormalized = (customer.InvoiceType ?? string.Empty).Trim().ToUpperInvariant();
        var isOpenCustomer = customerInvoiceTypeNormalized == "ACIK"
                             || customerInvoiceTypeNormalized == "AÇIK"
                             || customerInvoiceTypeNormalized.Contains("ACIK")
                             || customerInvoiceTypeNormalized.Contains("AÇIK");

        var serie = (request.InvoiceSerie ?? string.Empty).Trim().ToUpperInvariant();

        var invoiceNumberRaw = (request.InvoiceNumber ?? string.Empty).Trim();
        if (!string.IsNullOrWhiteSpace(invoiceNumberRaw))
        {
            var digitsOnly = new string(invoiceNumberRaw.Where(char.IsDigit).ToArray());
            if (digitsOnly.Length > 14)
            {
                return BadRequest(new { success = false, message = "Fatura no en fazla 14 hane olmalıdır" });
            }
            invoiceNumberRaw = digitsOnly;
        }

        if (!isOpenCustomer)
        {
            if (serie.Length != 1)
            {
                return BadRequest(new { success = false, message = "Fatura seri 1 karakter olmalıdır" });
            }
        }

        string invoiceNo;
        if (isOpenCustomer)
        {
            serie = "1";

            var existing = await _dbContext.Set<Invoice>()
                .AsNoTracking()
                .Where(x => x.InvoiceNo.StartsWith(serie) && x.InvoiceNo.Length == 15)
                .Select(x => x.InvoiceNo)
                .ToListAsync(cancellationToken);

            long max = -1;
            foreach (var invNo in existing)
            {
                if (string.IsNullOrWhiteSpace(invNo) || invNo.Length != 15) continue;
                var tail = invNo.Substring(1);
                if (long.TryParse(tail, out var n))
                {
                    if (n > max) max = n;
                }
            }

            var next = max + 1;
            invoiceNo = serie + next.ToString().PadLeft(14, '0');
        }
        else
        {
            long n = 0;
            if (!string.IsNullOrWhiteSpace(invoiceNumberRaw))
            {
                if (!long.TryParse(invoiceNumberRaw, out n))
                {
                    return BadRequest(new { success = false, message = "Fatura no geçersiz" });
                }
            }

            if (n < 0) n = 0;
            invoiceNo = serie + n.ToString().PadLeft(14, '0');
        }

        var exists = await _dbContext.Set<Invoice>()
            .AsNoTracking()
            .AnyAsync(x => x.InvoiceNo == invoiceNo, cancellationToken);

        if (exists)
        {
            return Conflict(new { success = false, message = "Fatura no zaten mevcut" });
        }

        var priceGroupId = customer.PriceGroupId;
        decimal unitPrice = 0m;

        if (priceGroupId.HasValue)
        {
            // Şubede özel fiyat BAĞLI CARİDEN okunur; bkz. CustomerPriceOwner.
            var overrideCustomerCode = await Core.Helpers.CustomerPriceOwner.ResolveAsync(
                _dbContext, customer.CustomerCode, cancellationToken);

            var overridePrice = await _dbContext.CustomerProductPriceOverrides
                .AsNoTracking()
                .Where(x => x.IsActive)
                .Where(x => x.CustomerCode == overrideCustomerCode)
                .Where(x => x.ProductId == product.Id)
                .Where(x => x.PriceGroupId == priceGroupId.Value)
                .Select(x => (decimal?)x.Price)
                .FirstOrDefaultAsync(cancellationToken);

            if (overridePrice.HasValue)
            {
                unitPrice = overridePrice.Value;
            }
            else
            {
                var pgPrice = await _dbContext.ProductPrices
                    .AsNoTracking()
                    .Where(x => x.ProductId == product.Id)
                    .Where(x => x.PriceGroupId == priceGroupId.Value)
                    .Select(x => (decimal?)x.Price)
                    .OrderBy(x => x)
                    .FirstOrDefaultAsync(cancellationToken);

                if (pgPrice.HasValue)
                {
                    unitPrice = pgPrice.Value;
                }
            }
        }

        if (unitPrice <= 0)
        {
            var anyPrice = await _dbContext.ProductPrices
                .AsNoTracking()
                .Where(x => x.ProductId == product.Id)
                .Select(x => (decimal?)x.Price)
                .OrderBy(x => x)
                .FirstOrDefaultAsync(cancellationToken);

            unitPrice = anyPrice ?? 0m;
        }

        if (unitPrice <= 0)
        {
            return BadRequest(new { success = false, message = "Ürün için fiyat bulunamadı" });
        }

        var vatRate = (decimal)Math.Max(0, product.TaxRate);

        // Fiyat ürünün satış dövizinde; TL çapası buradan itibaren kullanılıyor.
        var (lineCurrencyTypeId, lineCurrencyRate, tryUnitPrice) =
            await ResolveLinePriceAsync(product.SalesCurrencyCode, unitPrice, cancellationToken);
        var currencyUnitPrice = unitPrice;

        var subtotal = sold * tryUnitPrice;
        var vatTotal = subtotal * (vatRate / 100m);
        var grandTotal = subtotal + vatTotal;

        var now = DateTime.UtcNow;
        var username = User.Identity?.Name ?? "System";

        async Task<string> GenerateSiparisNo(CancellationToken ct)
        {
            for (var i = 0; i < 5; i++)
            {
                var candidate = "S" + DateTime.UtcNow.ToString("yyMMddHHmmssff");
                var existsOrder = await _dbContext.Set<SalesOrder>()
                    .AsNoTracking()
                    .AnyAsync(x => x.OrderNo == candidate, ct);

                if (!existsOrder)
                {
                    return candidate;
                }

                await Task.Delay(25, ct);
            }

            return "S" + DateTime.UtcNow.ToString("yyMMddHHmmssff");
        }

        var siparisNo = await GenerateSiparisNo(cancellationToken);

        var order = new SalesOrder
        {
            CustomerCode = customer.CustomerCode,
            DeliveryCustomerCode = customer.CustomerCode,
            Subtotal = subtotal,
            VatTotal = vatTotal,
            GrandTotal = grandTotal,
            CampaignDiscount = 0m,
            CampaignDetailsJson = null,
            Status = 0,
            OrderNo = siparisNo,
            ProcessedBy = username,
            ProcessedAt = now,
            CreateUser = username,
            CreateTime = now,
            EditUser = null,
            EditTime = null
        };

        var orderLine = new SalesOrderLine
        {
            SalesOrder = order,
            InstallationId = null,
            StockCode = product.StockCode,
            Description = string.IsNullOrWhiteSpace(irsaliye.Description) ? null : irsaliye.Description,
            Quantity = sold,
            // TL çapa + kendi dövizi (bkz. ResolveLinePriceAsync). Öncesinde döviz alanlarına
            // hiç dokunulmuyordu: satır 0/0/0 ile yazılıyor, dolarlı fiyat TL sanılıyordu.
            UnitPrice = tryUnitPrice,
            CurrencyTypeId = lineCurrencyTypeId,
            CurrencyRate = lineCurrencyRate,
            CurrencyUnitPrice = currencyUnitPrice,
            VatRate = vatRate,
            LineNo = 1,
            CampaignCode = null,
            Montage = false,
            GroupId = null,
            OrderNo = siparisNo,
            CreateUser = username,
            CreateTime = now,
            EditUser = null,
            EditTime = null
        };

        order.Lines.Add(orderLine);

        _dbContext.Set<SalesOrder>().Add(order);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var invoiceDate = request.Date.HasValue && request.Date.Value != default
            ? request.Date.Value
            : DateTime.SpecifyKind(irsaliye.Date.Date, DateTimeKind.Utc);

        var invoice = new Invoice
        {
            Type = InvoiceType.SalesInvoice,
            InvoiceNo = invoiceNo,
            CustomerCode = customer.CustomerCode,
            DeliveryCustomerCode = customer.CustomerCode,
            Date = invoiceDate,
            VatIncluded = false,
            Subtotal = subtotal,
            Discount = 0m,
            NetTotal = subtotal,
            VatTotal = vatTotal,
            GrandTotal = grandTotal,
            CampaignDiscount = 0m,
            CampaignDetailsJson = null,
            SalesmanCode = customer.SalesmanCode,
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            // Faturanın para birimi ve kuru başlıkta donduruluyor.
            //
            // Buradaki eski not ("bu denetleyicide döviz altyapısı yok, kur servisi enjekte
            // edilmemiş") ARTIK GEÇERSİZ: kur servisi bağlandı ve kalem kendi dövizini taşıyor.
            // Belge dövizi kalemin dövizidir — bu yolda tek ürün var, dolayısıyla karışık
            // döviz ihtimali yok. Kur, kalemle AYNI çözümlemeden gelir; ikisinin ayrı kur
            // kullanması fatura ile kalem toplamını birbirinden ayırırdı.
            CurrencyTypeId = lineCurrencyTypeId,
            ExchangeRate = lineCurrencyRate <= 0 ? 1m : lineCurrencyRate,
            RateSource = Core.Helpers.CurrencyTypeHelper.IsTry(lineCurrencyTypeId) ? null : "TCMB",
            InstallationName = null,
            InstallationPhone = null,
            CreateUser = username,
            CreateTime = now,
            EditUser = null,
            EditTime = null
        };

        _dbContext.Set<Invoice>().Add(invoice);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // Link the irsaliye record
        if (irsaliye is not null)
        {
            irsaliye.TransferredSalesOrderId = order.Id;
            var marker = "FATURAYA_AKTARILDI";
            var existingDesc = (irsaliye.Description ?? string.Empty).Trim();
            if (!existingDesc.Contains(marker, StringComparison.OrdinalIgnoreCase))
            {
                irsaliye.Description = string.IsNullOrWhiteSpace(existingDesc) ? marker : (existingDesc + " | " + marker);
            }
            irsaliye.EditUser = username;
            irsaliye.EditTime = now;
        }

        var line = new InvoiceLine
        {
            InvoiceId = invoice.Id,
            SalesOrderLineId = orderLine.Id,
            StockCode = product.StockCode,
            Description = string.IsNullOrWhiteSpace(irsaliye?.Description) ? null : irsaliye.Description,
            Quantity = sold,
            UnitPrice = tryUnitPrice,
            CurrencyTypeId = lineCurrencyTypeId,
            CurrencyRate = lineCurrencyRate,
            CurrencyUnitPrice = currencyUnitPrice,
            VatRate = vatRate,
            LineNo = 1,
            CreateUser = username,
            CreateTime = now,
            EditUser = null,
            EditTime = null
        };

        _dbContext.Set<InvoiceLine>().Add(line);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // If returned qty > 0, update Product.Stock to restore the returned qty
        var returnedQty = (irsaliye?.ShippedQuantity ?? 0m) - sold;
        if (returnedQty > 0)
        {
            // Yalnızca `Product.Stock` artırılıyordu; STOK HAREKETİ yazılmıyordu. Stok
            // dökümü ve muhasebe giriş/çıkış raporları `StockMovements` tablosunu okuduğu
            // için depoya geri giren mal raporlarda hiç görünmüyor, `Product.Stock` ile
            // hareket defteri kalıcı olarak ayrışıyordu. Toplu aktarım kardeşi
            // (BatchTransferToSalesOrder) bu hareketi zaten yazıyor — aynı desen.
            var outgoing = await _dbContext.Set<StockMovement>()
                .AsNoTracking()
                .Where(x => x.InvoiceNo == "KONS-" + irsaliye!.IrsaliyeNo && x.StockCode == product.StockCode)
                .Select(x => new { x.WarehouseCode, x.UnitPrice, x.NetUnitPrice })
                .FirstOrDefaultAsync(cancellationToken);

            var outgoingWarehouse = outgoing?.WarehouseCode ?? 0;
            var targetWarehouse = outgoingWarehouse > 0
                ? outgoingWarehouse
                : await GetUserWarehouseFallbackAsync(username, cancellationToken);

            _dbContext.Set<StockMovement>().Add(new StockMovement
            {
                InvoiceNo = "KONS-IADE-" + irsaliye!.IrsaliyeNo,
                CustomerCode = irsaliye.CustomerCode,
                DeliveryCustomerCode = irsaliye.CustomerCode,
                StockCode = product.StockCode,
                Direction = StockMovementDirection.In,
                Quantity = returnedQty,
                // Geri dönen mal çıktığı maliyetle girer; 0 yazmak depo ortalamasını bozar.
                UnitPrice = outgoing?.UnitPrice ?? 0m,
                NetUnitPrice = outgoing?.NetUnitPrice ?? outgoing?.UnitPrice ?? 0m,
                VatRate = vatRate,
                Delivered = true,
                Date = _clock.TodayAsDocumentDate(),
                WarehouseCode = targetWarehouse,
                LineNo = 1,
                CreateUser = username,
                CreateTime = now
            });

            var trackedProduct = await _dbContext.Products
                .FirstOrDefaultAsync(p => p.Id == product.Id, cancellationToken);
            if (trackedProduct != null)
            {
                trackedProduct.Stock += (int)Math.Round(returnedQty, MidpointRounding.AwayFromZero);
            }
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return Ok(new { success = true, data = new { id = invoice.Id, invoiceNo = invoice.InvoiceNo } });
    }

    public sealed class BatchTransferLineItem
    {
        public int IrsaliyeId { get; set; }
        public decimal SoldQuantity { get; set; }
    }

    public sealed class BatchTransferToSalesOrderRequest
    {
        public List<int>? IrsaliyeIds { get; set; }
        public List<BatchTransferLineItem>? Items { get; set; }
    }

    [AtomicRequest]
    [HttpPost("batch-transfer-to-sales-order")]
    [AuthorizePage("invoice", "irsaliye")]
    public async Task<IActionResult> BatchTransferToSalesOrder(
        [FromBody] BatchTransferToSalesOrderRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var lineQuantities = new Dictionary<int, decimal>();
        var targetIrsaliyeIds = new List<int>();

        if (request.Items != null && request.Items.Any())
        {
            foreach (var item in request.Items)
            {
                lineQuantities[item.IrsaliyeId] = item.SoldQuantity;
                targetIrsaliyeIds.Add(item.IrsaliyeId);
            }
        }
        else if (request.IrsaliyeIds != null && request.IrsaliyeIds.Any())
        {
            foreach (var id in request.IrsaliyeIds)
            {
                targetIrsaliyeIds.Add(id);
            }
        }
        else
        {
            return BadRequest(new { success = false, message = "İrsaliye listesi boş olamaz" });
        }

        var irsaliyeler = await _dbContext.Set<Irsaliye>()
            .Where(x => targetIrsaliyeIds.Contains(x.Id))
            .ToListAsync(cancellationToken);

        if (irsaliyeler.Count != targetIrsaliyeIds.Count)
        {
            return BadRequest(new { success = false, message = "Bazı irsaliye kayıtları bulunamadı" });
        }

        if (irsaliyeler.Any(x => x.TransferredSalesOrderId.HasValue))
        {
            return BadRequest(new { success = false, message = "Seçilen bazı irsaliyeler zaten faturaya/siparişe aktarılmış" });
        }

        if (irsaliyeler.Any(x => x.ShippedQuantity == null || x.ShippedQuantity <= 0))
        {
            return BadRequest(new { success = false, message = "Sevk adedi girilmemiş ürünler faturaya aktarılamaz" });
        }

        foreach (var irs in irsaliyeler)
        {
            if (!lineQuantities.ContainsKey(irs.Id))
            {
                lineQuantities[irs.Id] = irs.ShippedQuantity ?? 0m;
            }

            var sold = lineQuantities[irs.Id];
            if (sold < 0)
            {
                return BadRequest(new { success = false, message = $"[{irs.IrsaliyeNo}] için satılan adet negatif olamaz" });
            }
            if (sold > (irs.ShippedQuantity ?? 0m))
            {
                return BadRequest(new { success = false, message = $"[{irs.IrsaliyeNo}] için satılan adet sevk adedinden ({irs.ShippedQuantity}) büyük olamaz" });
            }
        }

        var customerCodes = irsaliyeler.Select(x => x.CustomerCode).Distinct().ToList();
        if (customerCodes.Count > 1)
        {
            return BadRequest(new { success = false, message = "Aynı anda sadece tek bir cariye ait irsaliyeler aktarılabilir" });
        }

        var customerCode = customerCodes.First();
        var customer = await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (customer is null)
        {
            return BadRequest(new { success = false, message = "Cari bulunamadı" });
        }

        if (!customer.PriceGroupId.HasValue || customer.PriceGroupId.Value == Guid.Empty)
        {
            return BadRequest(new { success = false, message = "Cari için fiyat grubu tanımlı değil" });
        }

        var priceGroupId = customer.PriceGroupId.Value;
        var productIds = irsaliyeler.Select(x => x.ProductId).Distinct().ToList();
        var products = await _dbContext.Products
            .AsNoTracking()
            .Where(x => productIds.Contains(x.Id))
            .ToDictionaryAsync(x => x.Id, x => x, cancellationToken);

        var unitPrices = new Dictionary<Guid, decimal>();
        // Ürün başına TL karşılığı ve kendi dövizi — tek ürünlü yollardaki kuralın aynısı.
        var linePricing = new Dictionary<Guid, (int CurrencyTypeId, decimal Rate, decimal TryUnitPrice)>();
        // Şubede özel fiyat BAĞLI CARİDEN okunur; bkz. CustomerPriceOwner.
        var overrideCustomerCode = await Core.Helpers.CustomerPriceOwner.ResolveAsync(
            _dbContext, customer.CustomerCode, cancellationToken);

        foreach (var productId in productIds)
        {
            if (!products.TryGetValue(productId, out var product))
            {
                return BadRequest(new { success = false, message = $"Ürün bulunamadı: {productId}" });
            }

            decimal unitPrice = 0m;
            var overridePrice = await _dbContext.CustomerProductPriceOverrides
                .AsNoTracking()
                .Where(x => x.IsActive)
                .Where(x => x.CustomerCode == overrideCustomerCode)
                .Where(x => x.ProductId == product.Id)
                .Where(x => x.PriceGroupId == priceGroupId)
                .Select(x => (decimal?)x.Price)
                .FirstOrDefaultAsync(cancellationToken);

            if (overridePrice.HasValue)
            {
                unitPrice = overridePrice.Value;
            }
            else
            {
                var pgPrice = await _dbContext.ProductPrices
                    .AsNoTracking()
                    .Where(x => x.ProductId == product.Id)
                    .Where(x => x.PriceGroupId == priceGroupId)
                    .Select(x => (decimal?)x.Price)
                    .OrderBy(x => x)
                    .FirstOrDefaultAsync(cancellationToken);

                if (pgPrice.HasValue)
                {
                    unitPrice = pgPrice.Value;
                }
            }

            if (unitPrice <= 0)
            {
                var anyPrice = await _dbContext.ProductPrices
                    .AsNoTracking()
                    .Where(x => x.ProductId == product.Id)
                    .Select(x => (decimal?)x.Price)
                    .OrderBy(x => x)
                    .FirstOrDefaultAsync(cancellationToken);

                unitPrice = anyPrice ?? 0m;
            }

            if (unitPrice <= 0)
            {
                return BadRequest(new { success = false, message = $"[{product.StockCode}] {product.Name} ürünü için fiyat bulunamadı" });
            }

            unitPrices[productId] = unitPrice;
            linePricing[productId] = await ResolveLinePriceAsync(
                product.SalesCurrencyCode, unitPrice, cancellationToken);
        }

        var now = DateTime.UtcNow;
        var username = User.Identity?.Name ?? "System";

        async Task<string> GenerateSiparisNo(CancellationToken ct)
        {
            for (var i = 0; i < 5; i++)
            {
                var candidate = "S" + DateTime.UtcNow.ToString("yyMMddHHmmssff");
                var existsOrder = await _dbContext.Set<SalesOrder>()
                    .AsNoTracking()
                    .AnyAsync(x => x.OrderNo == candidate, ct);

                if (!existsOrder)
                {
                    return candidate;
                }

                await Task.Delay(25, ct);
            }

            return "S" + DateTime.UtcNow.ToString("yyMMddHHmmssff");
        }

        var orderNos = new List<string>();
        var chunks = irsaliyeler
            .Select((x, i) => new { Index = i, Value = x })
            .GroupBy(x => x.Index / 17)
            .Select(x => x.Select(v => v.Value).ToList())
            .ToList();

        foreach (var chunk in chunks)
        {
            var chunkSold = chunk.Sum(irs => lineQuantities[irs.Id]);

            var siparisNo = "";
            SalesOrder? order = null;
            if (chunkSold > 0m)
            {
                siparisNo = await GenerateSiparisNo(cancellationToken);
                orderNos.Add(siparisNo);

                order = new SalesOrder
                {
                    CustomerCode = customer.CustomerCode,
                    DeliveryCustomerCode = customer.CustomerCode,
                    Subtotal = 0m,
                    VatTotal = 0m,
                    GrandTotal = 0m,
                    CampaignDiscount = 0m,
                    CampaignDetailsJson = null,
                    Status = 0,
                    OrderNo = siparisNo,
                    ProcessedBy = username,
                    ProcessedAt = now,
                    CreateUser = username,
                    CreateTime = now,
                    EditUser = null,
                    EditTime = null
                };
            }

            decimal totalSubtotal = 0m;
            decimal totalVatTotal = 0m;
            var lineNo = 1;

            foreach (var irs in chunk)
            {
                var product = products[irs.ProductId];
                var unitPrice = unitPrices[irs.ProductId];
                var sold = lineQuantities[irs.Id];

                var vatRate = (decimal)Math.Max(0, product.TaxRate);
                var pricing = linePricing[irs.ProductId];

                if (sold > 0m && order != null)
                {
                    // Toplamlar TL çapasından; kalem kendi dövizini de taşıyor.
                    var subtotal = sold * pricing.TryUnitPrice;
                    var vatTotal = subtotal * (vatRate / 100m);

                    totalSubtotal += subtotal;
                    totalVatTotal += vatTotal;

                    var orderLine = new SalesOrderLine
                    {
                        SalesOrder = order,
                        InstallationId = null,
                        StockCode = product.StockCode,
                        Description = irs.Description,
                        Quantity = sold,
                        UnitPrice = pricing.TryUnitPrice,
                        CurrencyTypeId = pricing.CurrencyTypeId,
                        CurrencyRate = pricing.Rate,
                        CurrencyUnitPrice = unitPrice,
                        VatRate = vatRate,
                        LineNo = lineNo++,
                        CampaignCode = null,
                        Montage = false,
                        GroupId = null,
                        OrderNo = siparisNo,
                        CreateUser = username,
                        CreateTime = now,
                        EditUser = null,
                        EditTime = null
                    };

                    order.Lines.Add(orderLine);
                }

                // If returned quantity > 0, create return stock movement and update stock
                var returnedQty = (irs.ShippedQuantity ?? 0m) - sold;
                if (returnedQty > 0)
                {
                    // Çıkış hareketinin deposu VE MALİYETİ birlikte okunur: iade 0 ₺ maliyetle
                    // giriliyordu ve depodaki ağırlıklı ortalama maliyeti yapay olarak aşağı
                    // çekiyordu. Geri dönen mal, çıktığı maliyetle geri girer.
                    var outgoing = await _dbContext.Set<StockMovement>()
                        .AsNoTracking()
                        .Where(x => x.InvoiceNo == "KONS-" + irs.IrsaliyeNo && x.StockCode == product.StockCode)
                        .Select(x => new { x.WarehouseCode, x.UnitPrice, x.NetUnitPrice })
                        .FirstOrDefaultAsync(cancellationToken);

                    var outgoingWarehouse = outgoing?.WarehouseCode ?? 0;
                    var targetWarehouse = outgoingWarehouse > 0 ? outgoingWarehouse : await GetUserWarehouseFallbackAsync(username, cancellationToken);

                    var returnMovement = new StockMovement
                    {
                        InvoiceNo = "KONS-IADE-" + irs.IrsaliyeNo,
                        CustomerCode = irs.CustomerCode,
                        DeliveryCustomerCode = irs.CustomerCode,
                        StockCode = product.StockCode,
                        Direction = StockMovementDirection.In,
                        Quantity = returnedQty,
                        UnitPrice = outgoing?.UnitPrice ?? 0m,
                        NetUnitPrice = outgoing?.NetUnitPrice ?? outgoing?.UnitPrice ?? 0m,
                        VatRate = vatRate,
                        Delivered = true,
                        Date = _clock.TodayAsDocumentDate(),
                        WarehouseCode = targetWarehouse,
                        LineNo = 1,
                        CreateUser = username,
                        CreateTime = now
                    };
                    _dbContext.Set<StockMovement>().Add(returnMovement);

                    var trackedProduct = await _dbContext.Products
                        .FirstOrDefaultAsync(p => p.Id == product.Id, cancellationToken);
                    if (trackedProduct != null)
                    {
                        trackedProduct.Stock += (int)Math.Round(returnedQty, MidpointRounding.AwayFromZero);
                    }
                }
            }

            if (order != null)
            {
                order.Subtotal = totalSubtotal;
                order.VatTotal = totalVatTotal;
                order.GrandTotal = totalSubtotal + totalVatTotal;

                _dbContext.Set<SalesOrder>().Add(order);
                await _dbContext.SaveChangesAsync(cancellationToken);
            }

            foreach (var irs in chunk)
            {
                var editEntity = await _dbContext.Set<Irsaliye>()
                    .FirstOrDefaultAsync(x => x.Id == irs.Id, cancellationToken);

                if (editEntity is not null)
                {
                    editEntity.TransferredSalesOrderId = order != null ? order.Id : -1;

                    var marker = "FATURAYA_AKTARILDI";
                    var existingDesc = (editEntity.Description ?? string.Empty).Trim();
                    if (!existingDesc.Contains(marker, StringComparison.OrdinalIgnoreCase))
                    {
                        editEntity.Description = string.IsNullOrWhiteSpace(existingDesc) ? marker : (existingDesc + " | " + marker);
                    }
                    editEntity.EditUser = username;
                    editEntity.EditTime = now;
                }
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return Ok(new { success = true, data = new { siparisNos = orderNos } });
    }

    private async Task<int> GetUserWarehouseFallbackAsync(string currentUsername, CancellationToken ct)
    {
        var user = await _dbContext.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Username == currentUsername, ct);
        // NEGATİF DEPO KODU GEÇERLİDİR (ör. -21 YP SİPARİŞ); kontroller `!= 0`.
        if (user?.DefaultWarehouseCode.HasValue == true && user.DefaultWarehouseCode.Value != 0)
        {
            return user.DefaultWarehouseCode.Value;
        }

        var firstAllowed = await _dbContext.UserWarehouses
            .AsNoTracking()
            .Where(x => x.UserId == (user != null ? user.Id : 0))
            .Select(x => x.WarehouseCode)
            .FirstOrDefaultAsync(ct);
        if (firstAllowed != 0) return firstAllowed;

        var firstDb = await _dbContext.Warehouses
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.WarehouseCode)
            .Select(x => x.WarehouseCode)
            .FirstOrDefaultAsync(ct);
        return firstDb == 0 ? 1 : firstDb;
    }

    /// <summary>
    /// Sıradaki irsaliye numarasını ATOMİK olarak üretir.
    ///
    /// Önceden tüm irsaliye numaraları belleğe çekilip "en büyük + 1" yapılıyordu. İki kişi
    /// aynı anda irsaliye kestiğinde ikisi de aynı en büyük değeri okuyup AYNI numarayı
    /// alıyordu — üstelik irsaliye numarasının tekil olması zorunlu değil (bir belgede 17
    /// kaleme kadar aynı numara paylaşılıyor), o yüzden veritabanı da uyarı vermeden iki ayrı
    /// belgeyi tek belge gibi birleştiriyordu.
    ///
    /// Kasa/banka belge numaralarındaki desenin aynısı: tek `INSERT ... ON CONFLICT ...
    /// RETURNING` ifadesi numarayı veritabanı seviyesinde kilitliyor. Sayaç ilk kullanımda
    /// mevcut en büyük numaradan başlatılıyor ki eski belgelerle çakışmasın. Numara
    /// üretilemezse eski davranışa (en büyük + 1) düşülüyor — kaydı düşürmek daha kötü olur.
    /// </summary>
    private async Task<string> NextIrsaliyeNoAsync(CancellationToken cancellationToken)
    {
        const string seriesKey = "irsaliye:no";

        var currentMax = 0;
        var existing = await _dbContext.Set<Irsaliye>()
            .AsNoTracking()
            .Select(x => x.IrsaliyeNo)
            .ToListAsync(cancellationToken);

        foreach (var x in existing)
        {
            if (int.TryParse((x ?? string.Empty).Trim(), out var n) && n > currentMax) currentMax = n;
        }

        try
        {
            // Sayacı yalnızca YOKSA oluştur; varsa dokunma (eski numaraların üstüne yazmasın).
            await _dbContext.Database.ExecuteSqlRawAsync(
                @"INSERT INTO ""NumberSeries"" (""Key"", ""LastValue"") VALUES ({0}, {1})
                  ON CONFLICT (""Key"") DO NOTHING",
                seriesKey, (long)currentMax);

            var rows = await _dbContext.Database
                .SqlQueryRaw<long>(
                    @"INSERT INTO ""NumberSeries"" (""Key"", ""LastValue"") VALUES ({0}, 1)
                      ON CONFLICT (""Key"") DO UPDATE SET ""LastValue"" = ""NumberSeries"".""LastValue"" + 1
                      RETURNING ""LastValue"" AS ""Value""", seriesKey)
                .ToListAsync(cancellationToken);

            if (rows.Count > 0 && rows[0] > 0) return rows[0].ToString();
        }
        catch
        {
            // Sayaç tablosu yoksa/erişilemezse aşağıdaki eski yola düşülür.
        }

        return (currentMax + 1).ToString();
    }
}

