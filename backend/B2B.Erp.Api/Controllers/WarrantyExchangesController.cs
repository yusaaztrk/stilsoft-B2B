using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Core.Logging;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using B2B.Erp.Api.Features.Currency;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Controllers;

/// <summary>
/// GARANTİ DEĞİŞİM (kullanıcı kuralı, 2026-08-14).
///
/// Müşteri arızalı ürünü getirir, yerine başka ürün alır. FATURA KESİLMEZ — işlem yalnızca:
///   1. arızalı ürün → garanti deposuna GİRİŞ,
///   2. verilen ürün → seçilen depodan ÇIKIŞ,
///   3. (isteğe bağlı) fark → cari ekstreye tek satır.
///
/// Bu yüzden burada <c>Invoice</c>/<c>SalesOrder</c> hiç oluşturulmuyor. Fatura üretmek,
/// olmayan bir satışı muhasebeye sokardı.
/// </summary>
[ApiController]
[Route("api/warranty-exchanges")]
[Authorize]
public sealed class WarrantyExchangesController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly IUserActivityLogger _userActivityLogger;
    private readonly ICurrencyRateService _money;
    private readonly B2B.Erp.Api.Core.Services.ICustomerAccountService _customerAccountService;

    public WarrantyExchangesController(
        AppDbContext dbContext,
        IUserActivityLogger userActivityLogger,
        ICurrencyRateService money,
        B2B.Erp.Api.Core.Services.ICustomerAccountService customerAccountService)
    {
        _dbContext = dbContext;
        _userActivityLogger = userActivityLogger;
        _money = money;
        _customerAccountService = customerAccountService;
    }

    private string Username => User.Identity?.Name ?? "System";

    private bool IsSuperAdmin =>
        User.FindFirst("IsSuperAdmin")?.Value == "1" || User.FindFirst("IsSuperSuperAdmin")?.Value == "1";

    // ---------------------------------------------------------------------------------
    // AYAR — Ayarlar → Garanti Deposu
    // ---------------------------------------------------------------------------------

    /// <summary>
    /// Seçili garanti deposunu döner.
    ///
    /// İKİ YETKİDEN BİRİ YETERLİ (öznitelikler VEYA ile değerlendiriliyor):
    ///  - işlem sayfası, çünkü değişimi yapan kullanıcının hangi depoya gireceğini GÖRMESİ
    ///    gerekiyor — ayarı değiştirmesi gerekmiyor;
    ///  - ayar sayfası, çünkü ayar ekranı da mevcut seçimi okumak zorunda. Yalnızca işlem
    ///    yetkisine bağlansaydı, sadece ayar sayfasına yetkili bir rol kendi ekranını açar
    ///    açmaz 403 alırdı.
    /// </summary>
    [HttpGet("settings")]
    [AuthorizePage("invoice", "garantiDegisim")]
    [AuthorizePage("users", "garantiDeposu")]
    public async Task<IActionResult> GetSettings(CancellationToken cancellationToken = default)
    {
        var setting = await _dbContext.WarrantyExchangeSettings
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == 1, cancellationToken);

        var code = setting?.WarehouseCode ?? 0;

        string? name = null;
        if (code != 0)
        {
            name = await _dbContext.Set<Warehouse>()
                .AsNoTracking()
                .Where(x => x.WarehouseCode == code)
                .Select(x => x.Name)
                .FirstOrDefaultAsync(cancellationToken);
        }

        return Ok(new { success = true, data = new { warehouseCode = code, warehouseName = name } });
    }

    public sealed class UpdateSettingsRequest
    {
        public int WarehouseCode { get; set; }
    }

    /// <summary>
    /// Garanti deposunu seçer. Yalnızca ayar sayfasına yetkili roller (varsayılan: SuperAdmin).
    ///
    /// Geçmiş kayıtlara DOKUNMAZ: her işlem kendi deposunu damgalıyor
    /// (<see cref="WarrantyExchange.WarrantyWarehouseCode"/>). Ayarı değiştirmek eski stok
    /// hareketlerini başka bir depoya taşımaz — taşısaydı iki depo birden bozulurdu.
    /// </summary>
    [HttpPut("settings")]
    [AuthorizePage("users", "garantiDeposu")]
    public async Task<IActionResult> UpdateSettings(
        [FromBody] UpdateSettingsRequest request,
        CancellationToken cancellationToken = default)
    {
        var code = request?.WarehouseCode ?? 0;

        // NEGATİF DEPO KODU GEÇERLİDİR (ör. -21 YP SİPARİŞ); 0 = "seçilmedi".
        if (code != 0)
        {
            var exists = await _dbContext.Set<Warehouse>()
                .AsNoTracking()
                .AnyAsync(x => x.IsActive && x.WarehouseCode == code, cancellationToken);

            if (!exists)
            {
                return BadRequest(new { success = false, message = "Depo bulunamadı veya aktif değil" });
            }
        }

        var now = DateTime.UtcNow;
        var setting = await _dbContext.WarrantyExchangeSettings.FirstOrDefaultAsync(x => x.Id == 1, cancellationToken);

        if (setting is null)
        {
            setting = new WarrantyExchangeSetting
            {
                Id = 1,
                WarehouseCode = code,
                CreateUser = Username,
                CreateTime = now
            };
            _dbContext.WarrantyExchangeSettings.Add(setting);
        }
        else
        {
            setting.WarehouseCode = code;
            setting.EditUser = Username;
            setting.EditTime = now;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        await _userActivityLogger.LogAsync(
            "users", "garantiDeposu", "Update",
            $"Garanti deposu değiştirildi: {code}",
            recordId: "1",
            details: new { warehouseCode = code },
            cancellationToken: cancellationToken);

        return Ok(new { success = true, data = new { warehouseCode = code } });
    }

    // ---------------------------------------------------------------------------------
    // İŞLEM — Fatura İşlemleri → Garanti Değişim
    // ---------------------------------------------------------------------------------

    public sealed class CreateWarrantyExchangeRequest
    {
        public DateTime? Date { get; set; }
        public string CustomerCode { get; set; } = string.Empty;
        public string? InvoiceNo { get; set; }

        /// <summary>Sağlam ürünün çıkacağı depo. Kullanıcının yetkili olduğu depolardan biri.</summary>
        public int OutWarehouseCode { get; set; }

        public string ReturnedStockCode { get; set; } = string.Empty;
        public decimal ReturnedQuantity { get; set; } = 1m;
        public decimal ReturnedUnitPrice { get; set; }
        public string? ReturnedSerialNo { get; set; }

        public string GivenStockCode { get; set; } = string.Empty;
        public decimal GivenQuantity { get; set; } = 1m;
        public decimal GivenUnitPrice { get; set; }
        public string? GivenSerialNo { get; set; }

        public decimal DiscountAmount { get; set; }

        /// <summary>
        /// Ekranda girilen fiyatların para birimi (1=TRY 2=EUR 3=USD 4=GBP).
        /// GÖNDERİLMEZSE TL — eski istemciler bugünkü davranışı birebir korur.
        ///
        /// Carinin para biriminden TÜRETİLMEZ: değişim fiyatlarını kullanıcı elle giriyor,
        /// cariyle aynı olmak zorunda değil. Varsaymak, TL girilen bir farkı dolar
        /// damgalardı.
        /// </summary>
        public int CurrencyTypeId { get; set; }

        /// <summary>
        /// Girilen para biriminin TL kuru. 0/boş gelirse günün kuru çekilir; TL'de daima 1.
        /// </summary>
        public decimal CurrencyRate { get; set; }

        /// <summary>
        /// Fark cari ekstreye yansıtılsın mı. Kullanıcının açık kararı: "istersem borçlandırırım,
        /// istersem üste para veririm, istersem hiçbir şey düşmez".
        /// </summary>
        public bool PostToLedger { get; set; }

        public string? Description { get; set; }
    }

    [HttpPost]
    [AuthorizePage("invoice", "garantiDegisim")]
    public async Task<IActionResult> Create(
        [FromBody] CreateWarrantyExchangeRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Geçersiz istek" });
        }

        var customerCode = (request.CustomerCode ?? string.Empty).Trim();
        var returnedStock = (request.ReturnedStockCode ?? string.Empty).Trim();
        var givenStock = (request.GivenStockCode ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(customerCode))
        {
            return BadRequest(new { success = false, message = "Cari seçimi zorunludur" });
        }
        if (string.IsNullOrWhiteSpace(returnedStock) || string.IsNullOrWhiteSpace(givenStock))
        {
            return BadRequest(new { success = false, message = "Gelen ve verilen ürün seçimi zorunludur" });
        }
        if (request.ReturnedQuantity <= 0 || request.GivenQuantity <= 0)
        {
            return BadRequest(new { success = false, message = "Miktar sıfırdan büyük olmalıdır" });
        }
        if (request.DiscountAmount < 0)
        {
            return BadRequest(new { success = false, message = "İndirim negatif olamaz" });
        }

        // Para birimi: gönderilmezse TL (0 → 1), böylece eski istemciler aynen çalışır.
        var currencyTypeId = CurrencyTypeHelper.Normalize(request.CurrencyTypeId);
        if (!CurrencyTypeHelper.IsKnown(currencyTypeId))
        {
            return BadRequest(new { success = false, message = "Geçersiz para birimi" });
        }

        var currencyRate = 1m;
        if (!CurrencyTypeHelper.IsTry(currencyTypeId))
        {
            currencyRate = request.CurrencyRate;
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

        var setting = await _dbContext.WarrantyExchangeSettings
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == 1, cancellationToken);

        var warrantyWarehouseCode = setting?.WarehouseCode ?? 0;
        if (warrantyWarehouseCode == 0)
        {
            // Bir yere yazmak, yanlış yere yazmaktır: depo seçilmeden işlem kabul edilmiyor.
            return BadRequest(new { success = false, message = "Garanti deposu seçilmemiş. Ayarlar → Garanti Deposu sayfasından seçin." });
        }

        var outWarehouseCode = request.OutWarehouseCode;
        if (outWarehouseCode == 0)
        {
            return BadRequest(new { success = false, message = "Ürünün çıkacağı depoyu seçiniz" });
        }

        var warehouses = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .Where(x => x.IsActive && (x.WarehouseCode == warrantyWarehouseCode || x.WarehouseCode == outWarehouseCode))
            .Select(x => new { x.WarehouseCode, x.Name, x.NegativeBalanceControl })
            .ToListAsync(cancellationToken);

        var warrantyWarehouse = warehouses.FirstOrDefault(x => x.WarehouseCode == warrantyWarehouseCode);
        var outWarehouse = warehouses.FirstOrDefault(x => x.WarehouseCode == outWarehouseCode);

        if (warrantyWarehouse is null)
        {
            return BadRequest(new { success = false, message = "Garanti deposu bulunamadı veya aktif değil" });
        }
        if (outWarehouse is null)
        {
            return BadRequest(new { success = false, message = "Çıkış deposu bulunamadı veya aktif değil" });
        }

        // ÇIKIŞ DEPOSU YETKİ KONTROLÜ. Bu alan olmasaydı, başkasının deposundan stok düşürmenin
        // serbest kapısı olurdu. Garanti deposuna GİRİŞ için yetki aranmaz: giriş kimseyi
        // eksiye düşürmez ve deponun hangisi olduğunu kullanıcı değil ayar belirliyor.
        if (!IsSuperAdmin)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!int.TryParse(userIdClaim, out var uid) || uid <= 0)
            {
                return BadRequest(new { success = false, message = "Kullanıcı bulunamadı" });
            }

            var allowed = await _dbContext.UserWarehouses
                .AsNoTracking()
                .AnyAsync(x => x.UserId == uid && x.WarehouseCode == outWarehouseCode, cancellationToken);

            if (!allowed)
            {
                return BadRequest(new { success = false, message = "Seçilen çıkış deposu için yetkiniz yok" });
            }
        }

        var customer = await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (customer is null)
        {
            return BadRequest(new { success = false, message = "Cari bulunamadı" });
        }

        var stockCodes = new[] { returnedStock, givenStock };
        var products = await _dbContext.Products
            .AsNoTracking()
            .Where(x => stockCodes.Contains(x.StockCode))
            .Select(x => new { x.StockCode, x.Name, x.TaxRate })
            .ToListAsync(cancellationToken);

        var returnedProduct = products.FirstOrDefault(x => x.StockCode == returnedStock);
        var givenProduct = products.FirstOrDefault(x => x.StockCode == givenStock);

        if (returnedProduct is null || givenProduct is null)
        {
            return BadRequest(new { success = false, message = "Seçilen ürün bulunamadı" });
        }

        // Negatif bakiye kontrolü açık depoda, verilecek ürünün stoğu yetmiyorsa işlem reddedilir.
        if (outWarehouse.NegativeBalanceControl)
        {
            var balance = await GetWarehouseBalanceAsync(outWarehouseCode, givenStock, cancellationToken);
            if (balance < request.GivenQuantity)
            {
                return BadRequest(new { success = false, message = $"Depo stoğu yetersiz: {givenStock} (Mevcut: {balance}, İstenen: {request.GivenQuantity})" });
            }
        }

        var now = DateTime.UtcNow;
        var date = request.Date.HasValue
            ? DateTime.SpecifyKind(request.Date.Value, DateTimeKind.Utc)
            : now;

        var exchangeNo = "GD" + now.ToString("yyMMddHHmmssff");

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            var entity = new WarrantyExchange
            {
                ExchangeNo = exchangeNo,
                Date = date,
                CustomerCode = customerCode,
                InvoiceNo = string.IsNullOrWhiteSpace(request.InvoiceNo) ? null : request.InvoiceNo.Trim(),
                WarrantyWarehouseCode = warrantyWarehouseCode,
                OutWarehouseCode = outWarehouseCode,
                ReturnedStockCode = returnedStock,
                ReturnedProductName = returnedProduct.Name,
                ReturnedQuantity = request.ReturnedQuantity,
                ReturnedUnitPrice = request.ReturnedUnitPrice,
                ReturnedSerialNo = string.IsNullOrWhiteSpace(request.ReturnedSerialNo) ? null : request.ReturnedSerialNo.Trim(),
                GivenStockCode = givenStock,
                GivenProductName = givenProduct.Name,
                GivenQuantity = request.GivenQuantity,
                GivenUnitPrice = request.GivenUnitPrice,
                GivenSerialNo = string.IsNullOrWhiteSpace(request.GivenSerialNo) ? null : request.GivenSerialNo.Trim(),
                DiscountAmount = request.DiscountAmount,
                // Para birimi EKRANDAN gelir, carinin dövizinden türetilmez: değişim
                // fiyatlarını kullanıcı elle giriyor ve carininkiyle aynı olmak zorunda değil.
                // Gönderilmezse TL — eski kayıtların davranışı değişmez.
                CurrencyTypeId = currencyTypeId,
                CurrencyRate = currencyRate,
                Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
                CreateUser = Username,
                CreateTime = now
            };

            _dbContext.WarrantyExchanges.Add(entity);
            await _dbContext.SaveChangesAsync(cancellationToken);

            // STOK HAREKETİ DAİMA TL. StockMovement'ta para birimi alanı yok; dövizli bir
            // değişimde girilen fiyatı olduğu gibi yazmak, 500 dolarlık ürünü stok
            // değerlemesinde 500 TL göstermek olurdu. Ekstre satırı zaten dövizi ayrıca
            // taşıyor, burada yalnızca TL karşılığı duruyor.
            var returnedTryUnitPrice = Math.Round(request.ReturnedUnitPrice * currencyRate, 2, MidpointRounding.AwayFromZero);
            var givenTryUnitPrice = Math.Round(request.GivenUnitPrice * currencyRate, 2, MidpointRounding.AwayFromZero);
            var discountTryAmount = Math.Round(request.DiscountAmount * currencyRate, 2, MidpointRounding.AwayFromZero);

            // 1) Arızalı ürün garanti deposuna GİRER.
            _dbContext.Set<StockMovement>().Add(new StockMovement
            {
                InvoiceNo = exchangeNo,
                CustomerCode = customerCode,
                DeliveryCustomerCode = customerCode,
                StockCode = returnedStock,
                Direction = StockMovementDirection.In,
                Quantity = request.ReturnedQuantity,
                UnitPrice = returnedTryUnitPrice,
                NetUnitPrice = returnedTryUnitPrice,
                VatRate = returnedProduct.TaxRate,
                BagNo = string.Empty,
                WarehouseCode = warrantyWarehouseCode,
                Delivered = true,
                Date = date,
                LineNo = 1,
                CreateUser = Username,
                CreateTime = now
            });

            // 2) Sağlam ürün seçilen depodan ÇIKAR.
            _dbContext.Set<StockMovement>().Add(new StockMovement
            {
                InvoiceNo = exchangeNo,
                CustomerCode = customerCode,
                DeliveryCustomerCode = customerCode,
                StockCode = givenStock,
                Direction = StockMovementDirection.Out,
                Quantity = request.GivenQuantity,
                UnitPrice = givenTryUnitPrice,
                // NET BİRİM FİYAT SIFIRIN ALTINA DÜŞMEZ (denetim md. 23).
                //
                // İndirim tutarı satır tutarından büyük girildiğinde çıkarma negatife
                // dönüyordu ve stok hareketine EKSİ birim fiyat yazılıyordu; envanter
                // değerlemesi negatif maliyetle bozuluyordu. Bir malın birim maliyeti
                // hiçbir durumda negatif olamaz — taban 0'a çekildi. (İndirimin satır
                // tutarını aşması ayrı bir giriş hatasıdır; burada sessizce kırpmak yerine
                // en azından defteri bozmuyoruz.)
                NetUnitPrice = request.GivenQuantity == 0
                    ? givenTryUnitPrice
                    : Math.Max(0m, givenTryUnitPrice - (discountTryAmount / request.GivenQuantity)),
                VatRate = givenProduct.TaxRate,
                BagNo = string.Empty,
                WarehouseCode = outWarehouseCode,
                Delivered = true,
                Date = date,
                LineNo = 2,
                CreateUser = Username,
                CreateTime = now
            });

            // 3) Fark — İSTEĞE BAĞLI cari hareketi.
            //
            // Fark sıfırsa satır YAZILMAZ: sıfır tutarlı bir ekstre satırı kimseye bilgi
            // vermez ama "bu işlem ekstreye yansıdı" izlenimi bırakır.
            var difference = entity.DifferenceAmount;
            if (request.PostToLedger && difference != 0m)
            {
                var isDebit = difference > 0m;
                var amount = Math.Abs(difference);

                // MAL HAREKETİ ALT HESABA YAZILIR (kullanıcı kuralı, 2026-08-19).
                //
                // Garanti değişiminin farkı bir MAL hareketidir (müşteri daha pahalı/ucuz ürün
                // aldı), tahsilat değil. Sistem kuralı: mal satışları carinin tipine göre
                // `-1` (resmi fatura) / `-2` (açık cari) / `-3` (muaf) alt hesabına, hesaba
                // alınan PARA ise ana cariye yazılır. Burada ana cari kodu yazılıyordu, yani
                // fark satırı faturaların düştüğü hesapla ayrı yerde birikiyordu.
                var ledgerCustomerCode = await _customerAccountService
                    .ResolveTargetInvoiceCustomerCodeAsync(customerCode, null, cancellationToken);
                if (string.IsNullOrWhiteSpace(ledgerCustomerCode)) ledgerCustomerCode = customerCode;

                var ledger = new CustomerLedgerEntry
                {
                    CustomerCode = ledgerCustomerCode,
                    Date = date,
                    // Pozitif fark = müşteri daha pahalı ürün aldı → BORÇ.
                    // Negatif fark = daha ucuz ürün aldı, üste para vereceğiz → ALACAK.
                    Direction = isDebit ? CustomerLedgerEntryDirection.Debit : CustomerLedgerEntryDirection.Credit,
                    Amount = Math.Round(amount * (entity.CurrencyRate <= 0 ? 1m : entity.CurrencyRate), 2, MidpointRounding.AwayFromZero),
                    // Döviz DEĞİŞİM KAYDINDAN okunur, sabit yazılmaz. Bugün değişim kaydı
                    // TL oluşturuluyor (aşağıdaki nota bakınız), ama oraya para birimi
                    // geldiğinde ekstre kendiliğinden doğru çalışır.
                    CurrencyTypeId = entity.CurrencyTypeId,
                    CurrencyRate = entity.CurrencyRate <= 0 ? 1m : entity.CurrencyRate,
                    CurrencyAmount = amount,
                    PaymentCurrencyTypeId = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Normalize(entity.CurrencyTypeId),
                    PaymentCurrencyRate = entity.CurrencyRate <= 0 ? 1m : entity.CurrencyRate,
                    PaymentCurrencyAmount = amount,
                    DocumentNo = exchangeNo,
                    Description = $"Garanti Değişim Farkı ({returnedStock} → {givenStock})",
                    TransactionType = "Garanti Değişim",
                    // ReferenceType.Manual: bu bir fatura/çek/kasa hareketi değil. ReferenceId
                    // değişim kaydına işaret ediyor ki silme tek kapıdan geri alabilsin.
                    ReferenceType = CustomerLedgerEntryReferenceType.Manual,
                    ReferenceId = entity.Id,
                    CreateUser = Username,
                    CreateTime = now
                };

                _dbContext.CustomerLedgerEntries.Add(ledger);
                await _dbContext.SaveChangesAsync(cancellationToken);

                entity.CustomerLedgerEntryId = ledger.Id;
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);

            await _userActivityLogger.LogAsync(
                "invoice", "garantiDegisim", "Create",
                $"Garanti değişim yapıldı: {exchangeNo} — {customerCode} ({returnedStock} → {givenStock})",
                recordId: entity.Id.ToString(),
                details: new
                {
                    exchangeNo,
                    customerCode,
                    returnedStock,
                    givenStock,
                    difference,
                    postedToLedger = entity.CustomerLedgerEntryId.HasValue,
                    warrantyWarehouseCode,
                    outWarehouseCode
                },
                cancellationToken: cancellationToken);

            return Ok(new
            {
                success = true,
                data = new { id = entity.Id, exchangeNo, difference, postedToLedger = entity.CustomerLedgerEntryId.HasValue }
            });
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync(cancellationToken);
            return StatusCode(500, new { success = false, message = "Garanti değişim kaydedilemedi: " + ex.Message });
        }
    }

    /// <summary>
    /// DEĞİŞİMİ DÜZENLER (2026-09-02 kullanıcı isteği).
    ///
    /// <para>
    /// Kayıt fatura değil; muhasebeye giren bir belge numarası yok. Bu yüzden düzeltme
    /// ters kayıtla değil, ETKİYİ GERİ ALIP YENİDEN YAZARAK yapılıyor — silmenin kullandığı
    /// yolun aynısı, ardından oluşturmanın yazdığı hareketler. Aksi hâlde tek bir yanlış
    /// adet için kullanıcı silip yeniden girmek zorunda kalır ve işlem numarası değişirdi.
    /// </para>
    ///
    /// <para>
    /// <b>İŞLEM NUMARASI VE KAYIT SAHİBİ KORUNUR.</b> <c>ExchangeNo</c> stok hareketlerini
    /// bağlayan anahtar; değiştirilseydi eski hareketler öksüz kalırdı. <c>CreateUser</c> ve
    /// <c>CreateTime</c> de korunur — kim ne zaman girdi izi düzenlemeyle silinmemeli;
    /// düzenleyen ayrıca <c>EditUser</c> alanına yazılır.
    /// </para>
    ///
    /// <para>
    /// Kapı silmeyle AYNI (2026-09-14 kullanıcı kararı — "aynı Fatura Dökümü'ndeki gibi
    /// olacak şekilde ayarla"): <see cref="ControllerExtensions.CanDeleteRecordAsync"/> +
    /// rolde <c>deleteRule/garantiDegisim</c> kısıtı açıksa 1 günden eski kayıt kapanır.
    /// SSA/SuperAdmin her iki kapıdan da muaf. Düzenleme de stok ve ekstre değiştiriyor;
    /// silmeden daha hafif bir yetki olamaz.
    /// </para>
    /// </summary>
    [HttpPut("{id:int}")]
    [AuthorizePage("invoice", "garantiDegisim")]
    public async Task<IActionResult> Update(
        int id,
        [FromBody] CreateWarrantyExchangeRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request is null)
        {
            return BadRequest(new { success = false, message = "Geçersiz istek" });
        }

        var entity = await _dbContext.WarrantyExchanges.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound(new { success = false, message = "Garanti değişim kaydı bulunamadı" });
        }

        if (!await this.CanDeleteRecordAsync(_dbContext, entity, cancellationToken))
        {
            return BadRequest(new { success = false, message = "Sadece kendi oluşturduğunuz işlemleri düzenleyebilirsiniz." });
        }

        // Silmeyle AYNI ikinci kapı — bkz. Delete. Düzenleme de stok ve ekstre değiştiriyor,
        // silmeden daha hafif bir yetki olamaz.
        var isSsaForUpdate = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var isSuperAdminForUpdate = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var roleIdClaimForUpdate = User.Claims.FirstOrDefault(c => string.Equals(c.Type, "RoleId", StringComparison.OrdinalIgnoreCase))?.Value;
        if (!isSsaForUpdate && !isSuperAdminForUpdate && int.TryParse(roleIdClaimForUpdate, out var roleIdForUpdate))
        {
            var hasRestrictionForUpdate = await _dbContext.RolePagePermissions
                .AsNoTracking()
                .AnyAsync(rpp => rpp.RoleId == roleIdForUpdate && rpp.CanAccess && rpp.Page.ModuleKey == "deleteRule" && rpp.Page.Key == "deleteRule/garantiDegisim", cancellationToken);
            if (hasRestrictionForUpdate && DateTime.UtcNow - entity.CreateTime > TimeSpan.FromDays(1))
            {
                return BadRequest(new { success = false, message = "Bu kayıt düzenlenemez" });
            }
        }

        var customerCode = (request.CustomerCode ?? string.Empty).Trim();
        var returnedStock = (request.ReturnedStockCode ?? string.Empty).Trim();
        var givenStock = (request.GivenStockCode ?? string.Empty).Trim();

        if (string.IsNullOrWhiteSpace(customerCode))
            return BadRequest(new { success = false, message = "Cari seçimi zorunludur" });
        if (string.IsNullOrWhiteSpace(returnedStock) || string.IsNullOrWhiteSpace(givenStock))
            return BadRequest(new { success = false, message = "Gelen ve verilen ürün seçimi zorunludur" });
        if (request.ReturnedQuantity <= 0 || request.GivenQuantity <= 0)
            return BadRequest(new { success = false, message = "Miktar sıfırdan büyük olmalıdır" });
        if (request.DiscountAmount < 0)
            return BadRequest(new { success = false, message = "İndirim negatif olamaz" });

        // Para birimi ve kur: OLUŞTURMADAKİ kuralın aynısı.
        var currencyTypeId = CurrencyTypeHelper.Normalize(request.CurrencyTypeId);
        if (!CurrencyTypeHelper.IsKnown(currencyTypeId))
            return BadRequest(new { success = false, message = "Geçersiz para birimi" });

        var currencyRate = 1m;
        if (!CurrencyTypeHelper.IsTry(currencyTypeId))
        {
            currencyRate = request.CurrencyRate;
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

            // Kur uydurulmaz. 1 yazmak dövizli tutarı TL sanmak olurdu; oluşturma ucu da
            // burada 503 döndürüp kullanıcıdan elle kur istiyor.
            if (currencyRate <= 0)
            {
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    success = false,
                    message = "Kur bilgisi alınamadı. Lütfen kuru elle girin."
                });
            }
        }

        // Garanti deposu AYARDAN okunur: hareketler yeniden yazılıyor, ayar o an hangi
        // depoysa oraya girmeli.
        var setting = await _dbContext.WarrantyExchangeSettings
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == 1, cancellationToken);

        var warrantyWarehouseCode = setting?.WarehouseCode ?? 0;
        if (warrantyWarehouseCode == 0)
            return BadRequest(new { success = false, message = "Garanti deposu seçilmemiş. Ayarlar → Garanti Deposu sayfasından seçin." });

        var outWarehouseCode = request.OutWarehouseCode;
        if (outWarehouseCode == 0)
            return BadRequest(new { success = false, message = "Ürünün çıkacağı depoyu seçiniz" });

        var warehouses = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .Where(x => x.IsActive && (x.WarehouseCode == warrantyWarehouseCode || x.WarehouseCode == outWarehouseCode))
            .ToListAsync(cancellationToken);

        var warrantyWarehouse = warehouses.FirstOrDefault(x => x.WarehouseCode == warrantyWarehouseCode);
        var outWarehouse = warehouses.FirstOrDefault(x => x.WarehouseCode == outWarehouseCode);

        if (warrantyWarehouse is null)
            return BadRequest(new { success = false, message = "Garanti deposu bulunamadı veya aktif değil" });
        if (outWarehouse is null)
            return BadRequest(new { success = false, message = "Çıkış deposu bulunamadı veya aktif değil" });

        // Çıkış deposu yetkisi — oluşturmadaki kuralın aynısı.
        if (!IsSuperAdmin)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!int.TryParse(userIdClaim, out var uid) || uid <= 0)
                return BadRequest(new { success = false, message = "Kullanıcı bulunamadı" });

            var allowed = await _dbContext.UserWarehouses
                .AsNoTracking()
                .AnyAsync(x => x.UserId == uid && x.WarehouseCode == outWarehouseCode, cancellationToken);

            if (!allowed)
                return BadRequest(new { success = false, message = "Seçilen çıkış deposu için yetkiniz yok" });
        }

        var customer = await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);
        if (customer is null)
            return BadRequest(new { success = false, message = "Cari bulunamadı" });

        var stockCodes = new[] { returnedStock, givenStock };
        var products = await _dbContext.Products
            .AsNoTracking()
            .Where(x => stockCodes.Contains(x.StockCode))
            .Select(x => new { x.StockCode, x.Name, x.TaxRate })
            .ToListAsync(cancellationToken);

        var returnedProduct = products.FirstOrDefault(x => x.StockCode == returnedStock);
        var givenProduct = products.FirstOrDefault(x => x.StockCode == givenStock);
        if (returnedProduct is null || givenProduct is null)
            return BadRequest(new { success = false, message = "Seçilen ürün bulunamadı" });

        /*
          STOK YETERLİLİĞİ ESKİ ÇIKIŞ GERİ VERİLEREK ÖLÇÜLÜR.

          Bakiye şu an eski çıkışı İÇERİYOR. Düzenlemede o çıkış geri alınacağı için
          kullanılabilir miktar (bakiye + eski çıkış) kadardır. Ham bakiyeye bakmak,
          1 adedi 2 adede çıkarmak isteyen kullanıcıya stok yetersiz derdi.
        */
        if (outWarehouse.NegativeBalanceControl)
        {
            var balance = await GetWarehouseBalanceAsync(outWarehouseCode, givenStock, cancellationToken);
            var eskiCikis = (entity.OutWarehouseCode == outWarehouseCode
                             && string.Equals(entity.GivenStockCode, givenStock, StringComparison.OrdinalIgnoreCase))
                ? entity.GivenQuantity
                : 0m;

            if (balance + eskiCikis < request.GivenQuantity)
            {
                return BadRequest(new { success = false, message = $"Depo stoğu yetersiz: {givenStock} (Kullanılabilir: {balance + eskiCikis}, İstenen: {request.GivenQuantity})" });
            }
        }

        var now = DateTime.UtcNow;
        var date = request.Date.HasValue
            ? DateTime.SpecifyKind(request.Date.Value, DateTimeKind.Utc)
            : entity.Date;

        var exchangeNo = entity.ExchangeNo;

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            // 1) ESKİ ETKİ GERİ ALINIR — silmenin kullandığı yolun aynısı.
            var eskiHareketler = await _dbContext.Set<StockMovement>()
                .Where(x => x.InvoiceNo == exchangeNo)
                .ToListAsync(cancellationToken);
            _dbContext.Set<StockMovement>().RemoveRange(eskiHareketler);

            if (entity.CustomerLedgerEntryId.HasValue)
            {
                var eskiEkstre = await _dbContext.CustomerLedgerEntries
                    .FirstOrDefaultAsync(x => x.Id == entity.CustomerLedgerEntryId.Value, cancellationToken);
                if (eskiEkstre is not null) _dbContext.CustomerLedgerEntries.Remove(eskiEkstre);
                entity.CustomerLedgerEntryId = null;
            }

            // 2) KAYIT GÜNCELLENİR. ExchangeNo, CreateUser ve CreateTime KORUNUR.
            entity.Date = date;
            entity.CustomerCode = customerCode;
            entity.InvoiceNo = string.IsNullOrWhiteSpace(request.InvoiceNo) ? null : request.InvoiceNo.Trim();
            entity.WarrantyWarehouseCode = warrantyWarehouseCode;
            entity.OutWarehouseCode = outWarehouseCode;
            entity.ReturnedStockCode = returnedStock;
            entity.ReturnedProductName = returnedProduct.Name;
            entity.ReturnedQuantity = request.ReturnedQuantity;
            entity.ReturnedUnitPrice = request.ReturnedUnitPrice;
            entity.ReturnedSerialNo = string.IsNullOrWhiteSpace(request.ReturnedSerialNo) ? null : request.ReturnedSerialNo.Trim();
            entity.GivenStockCode = givenStock;
            entity.GivenProductName = givenProduct.Name;
            entity.GivenQuantity = request.GivenQuantity;
            entity.GivenUnitPrice = request.GivenUnitPrice;
            entity.GivenSerialNo = string.IsNullOrWhiteSpace(request.GivenSerialNo) ? null : request.GivenSerialNo.Trim();
            entity.DiscountAmount = request.DiscountAmount;
            entity.CurrencyTypeId = currencyTypeId;
            entity.CurrencyRate = currencyRate;
            entity.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
            entity.EditUser = Username;
            entity.EditTime = now;

            await _dbContext.SaveChangesAsync(cancellationToken);

            // 3) YENİ ETKİ YAZILIR — oluşturmadaki hesabın aynısı.
            var returnedTryUnitPrice = Math.Round(request.ReturnedUnitPrice * currencyRate, 2, MidpointRounding.AwayFromZero);
            var givenTryUnitPrice = Math.Round(request.GivenUnitPrice * currencyRate, 2, MidpointRounding.AwayFromZero);
            var discountTryAmount = Math.Round(request.DiscountAmount * currencyRate, 2, MidpointRounding.AwayFromZero);

            _dbContext.Set<StockMovement>().Add(new StockMovement
            {
                InvoiceNo = exchangeNo,
                CustomerCode = customerCode,
                DeliveryCustomerCode = customerCode,
                StockCode = returnedStock,
                Direction = StockMovementDirection.In,
                Quantity = request.ReturnedQuantity,
                UnitPrice = returnedTryUnitPrice,
                NetUnitPrice = returnedTryUnitPrice,
                VatRate = returnedProduct.TaxRate,
                BagNo = string.Empty,
                WarehouseCode = warrantyWarehouseCode,
                Delivered = true,
                Date = date,
                LineNo = 1,
                CreateUser = Username,
                CreateTime = now
            });

            _dbContext.Set<StockMovement>().Add(new StockMovement
            {
                InvoiceNo = exchangeNo,
                CustomerCode = customerCode,
                DeliveryCustomerCode = customerCode,
                StockCode = givenStock,
                Direction = StockMovementDirection.Out,
                Quantity = request.GivenQuantity,
                UnitPrice = givenTryUnitPrice,
                // Net birim fiyat sıfırın altına düşmez — oluşturmadaki kuralın aynısı.
                NetUnitPrice = request.GivenQuantity == 0
                    ? givenTryUnitPrice
                    : Math.Max(0m, givenTryUnitPrice - (discountTryAmount / request.GivenQuantity)),
                VatRate = givenProduct.TaxRate,
                BagNo = string.Empty,
                WarehouseCode = outWarehouseCode,
                Delivered = true,
                Date = date,
                LineNo = 2,
                CreateUser = Username,
                CreateTime = now
            });

            var difference = entity.DifferenceAmount;
            if (request.PostToLedger && difference != 0m)
            {
                var isDebit = difference > 0m;
                var amount = Math.Abs(difference);

                var ledgerCustomerCode = await _customerAccountService
                    .ResolveTargetInvoiceCustomerCodeAsync(customerCode, null, cancellationToken);
                if (string.IsNullOrWhiteSpace(ledgerCustomerCode)) ledgerCustomerCode = customerCode;

                var ledger = new CustomerLedgerEntry
                {
                    CustomerCode = ledgerCustomerCode,
                    Date = date,
                    Direction = isDebit ? CustomerLedgerEntryDirection.Debit : CustomerLedgerEntryDirection.Credit,
                    Amount = Math.Round(amount * currencyRate, 2, MidpointRounding.AwayFromZero),
                    CurrencyTypeId = currencyTypeId,
                    CurrencyRate = currencyRate,
                    CurrencyAmount = amount,
                    PaymentCurrencyTypeId = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Normalize(currencyTypeId),
                    PaymentCurrencyRate = currencyRate,
                    PaymentCurrencyAmount = amount,
                    DocumentNo = exchangeNo,
                    Description = $"Garanti Değişim Farkı ({returnedStock} / {givenStock})",
                    TransactionType = "Garanti Değişim",
                    ReferenceType = CustomerLedgerEntryReferenceType.Manual,
                    ReferenceId = entity.Id,
                    CreateUser = Username,
                    CreateTime = now
                };

                _dbContext.CustomerLedgerEntries.Add(ledger);
                await _dbContext.SaveChangesAsync(cancellationToken);
                entity.CustomerLedgerEntryId = ledger.Id;
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);

            await _userActivityLogger.LogAsync(
                "invoice", "garantiDegisim", "Update",
                $"Garanti değişim düzenlendi: {exchangeNo} - {customerCode}",
                recordId: entity.Id.ToString(),
                details: new
                {
                    exchangeNo,
                    customerCode,
                    returnedStock,
                    givenStock,
                    difference,
                    postedToLedger = entity.CustomerLedgerEntryId.HasValue,
                    warrantyWarehouseCode,
                    outWarehouseCode
                },
                cancellationToken: cancellationToken);

            return Ok(new
            {
                success = true,
                data = new { id = entity.Id, exchangeNo, difference, postedToLedger = entity.CustomerLedgerEntryId.HasValue }
            });
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync(cancellationToken);
            return StatusCode(500, new { success = false, message = "Garanti değişim güncellenemedi: " + ex.Message });
        }
    }

    /// <summary>
    /// Değişimi siler ve İZİNİ TAMAMEN GERİ ALIR: iki stok hareketi + varsa cari ekstre satırı.
    ///
    /// Ters hareket yazmak yerine silme tercih edildi — kullanıcının isteği bu ("o değişimi
    /// silersem cari ekstreden de silinmesi gerekiyor"). Kaydın kendisi zaten fatura değil;
    /// muhasebeye giren bir belge numarası yok. İşlemin izi <c>UserActivityLogs</c>'ta kalıyor.
    /// </summary>
    [HttpDelete("{id:int}")]
    [AuthorizePage("invoice", "garantiDegisimSil")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken = default)
    {
        var entity = await _dbContext.WarrantyExchanges.FirstOrDefaultAsync(x => x.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound(new { success = false, message = "Garanti değişim kaydı bulunamadı" });
        }

        if (!await this.CanDeleteRecordAsync(_dbContext, entity, cancellationToken))
        {
            return BadRequest(new { success = false, message = "Sadece kendi oluşturduğunuz işlemleri silebilirsiniz." });
        }

        // Fatura Dökümü'yle AYNI ikinci kapı (bkz. InvoicesController.DeleteInvoice): rol bu
        // sayfa için özellikle kısıtlanmışsa (deleteRule/garantiDegisim), kendi kaydı olsa
        // bile 1 günden eski bir işlem silinemez. SSA/SuperAdmin bu kapıdan da muaf.
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var roleIdClaim = User.Claims.FirstOrDefault(c => string.Equals(c.Type, "RoleId", StringComparison.OrdinalIgnoreCase))?.Value;
        if (!isSsa && !isSuperAdmin && int.TryParse(roleIdClaim, out var roleId))
        {
            var hasRestriction = await _dbContext.RolePagePermissions
                .AsNoTracking()
                .AnyAsync(rpp => rpp.RoleId == roleId && rpp.CanAccess && rpp.Page.ModuleKey == "deleteRule" && rpp.Page.Key == "deleteRule/garantiDegisim", cancellationToken);
            if (hasRestriction && DateTime.UtcNow - entity.CreateTime > TimeSpan.FromDays(1))
            {
                return BadRequest(new { success = false, message = "Bu kayıt silinemez" });
            }
        }

        // GENEL AYARLAR — SİLME KİLİT TARİHİ.
        //
        // Bu belge de stok hareketi ve (fark varsa) cari hareketi üretiyor, ama kilit kontrolü
        // yalnız fatura/çek/depo transferine konmuştu: geçmiş döneme ait bir garanti değişimi
        // silinerek kapanmış dönem sessizce bozulabiliyordu. Kilit tarihi ÖNTANIMLI NULL'dır —
        // ayarlanmadıysa davranış birebir aynı. (Silme yetkisi ayrıca kendi sayfa anahtarıyla
        // korunuyor: `garantiDegisimSil`.)
        var deleteLockDate = await _dbContext.Set<JwtSessionSetting>()
            .AsNoTracking()
            .OrderBy(x => x.Id)
            .Select(x => x.InvoiceDeleteLockDate)
            .FirstOrDefaultAsync(cancellationToken);

        if (deleteLockDate.HasValue && entity.Date.Date < deleteLockDate.Value.Date)
        {
            return BadRequest(new { success = false, message = $"Belge tarihi ({entity.Date:dd.MM.yyyy}), Genel Ayarlar'daki silme kilit tarihinden ({deleteLockDate.Value:dd.MM.yyyy}) önce olduğu için silinemez." });
        }

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            // Stok hareketleri işlem numarasıyla bağlı. `ExchangeNo` tekil, bu yüzden başka bir
            // belgenin hareketini yakalama riski yok.
            var movements = await _dbContext.Set<StockMovement>()
                .Where(x => x.InvoiceNo == entity.ExchangeNo)
                .ToListAsync(cancellationToken);

            _dbContext.Set<StockMovement>().RemoveRange(movements);

            if (entity.CustomerLedgerEntryId.HasValue)
            {
                var ledger = await _dbContext.CustomerLedgerEntries
                    .FirstOrDefaultAsync(x => x.Id == entity.CustomerLedgerEntryId.Value, cancellationToken);

                if (ledger is not null)
                {
                    _dbContext.CustomerLedgerEntries.Remove(ledger);
                }
            }

            // SİLME İZİ (kullanıcı kararı, 2026-08-17).
            _dbContext.Set<DeletionLog>().Add(new DeletionLog
            {
                ModuleKey = "invoice",
                PageKey = "garantiDegisim",
                RecordType = "GarantiDegisim",
                RecordId = entity.Id.ToString(),
                Description = $"Garanti değişimi silindi: {entity.ExchangeNo} · {entity.CustomerCode}",
                DetailsJson = System.Text.Json.JsonSerializer.Serialize(new
                {
                    entity.Id,
                    entity.ExchangeNo,
                    entity.Date,
                    entity.CustomerCode,
                    entity.ReturnedStockCode,
                    entity.ReturnedQuantity,
                    entity.GivenStockCode,
                    entity.GivenQuantity,
                    entity.DifferenceAmount
                }),
                CreateUser = User.FindFirst(ClaimTypes.Name)?.Value ?? "System",
                CreateTime = DateTime.UtcNow
            });

            _dbContext.WarrantyExchanges.Remove(entity);

            await _dbContext.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);

            await _userActivityLogger.LogAsync(
                "invoice", "garantiDegisim", "Delete",
                $"Garanti değişim silindi: {entity.ExchangeNo} — {entity.CustomerCode}",
                recordId: id.ToString(),
                details: new
                {
                    entity.ExchangeNo,
                    entity.CustomerCode,
                    entity.ReturnedStockCode,
                    entity.GivenStockCode,
                    removedStockMovements = movements.Count,
                    removedLedgerEntryId = entity.CustomerLedgerEntryId
                },
                cancellationToken: cancellationToken);

            return Ok(new { success = true, message = "Garanti değişim kaydı silindi" });
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync(cancellationToken);
            return StatusCode(500, new { success = false, message = "Garanti değişim silinemedi: " + ex.Message });
        }
    }

    // ---------------------------------------------------------------------------------
    // RAPOR — Raporlar → Garanti Değişim Raporu
    // ---------------------------------------------------------------------------------

    /// <summary>
    /// Yapılan bütün değişimler: kime, ne zaman, ne verilmiş, farkı ne olmuş.
    ///
    /// İki yetkiden biri yeterli: işlem sayfasının listesi de bu ucu kullanıyor
    /// (<c>AuthorizePage</c> öznitelikleri VEYA ile değerlendiriliyor — bkz. PagesController
    /// tarafındaki kredi/rapor örnekleri).
    /// </summary>
    [HttpGet]
    [AuthorizePage("reports", "garantiDegisimRaporu")]
    [AuthorizePage("invoice", "garantiDegisim")]
    public async Task<IActionResult> GetList(
        [FromQuery] string? search,
        [FromQuery] string? customerCode,
        [FromQuery] DateTime? startDate,
        [FromQuery] DateTime? endDate,
        CancellationToken cancellationToken = default)
    {
        var query = _dbContext.WarrantyExchanges.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(customerCode))
        {
            var cc = customerCode.Trim();
            query = query.Where(x => x.CustomerCode == cc);
        }

        if (startDate.HasValue)
        {
            var startUtc = DateTime.SpecifyKind(startDate.Value.Date, DateTimeKind.Utc);
            query = query.Where(x => x.Date >= startUtc);
        }

        if (endDate.HasValue)
        {
            var endUtc = DateTime.SpecifyKind(endDate.Value.Date.AddDays(1).AddTicks(-1), DateTimeKind.Utc);
            query = query.Where(x => x.Date <= endUtc);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var s = search.Trim().ToLower();
            query = query.Where(x =>
                x.ExchangeNo.ToLower().Contains(s) ||
                x.CustomerCode.ToLower().Contains(s) ||
                x.ReturnedStockCode.ToLower().Contains(s) ||
                x.GivenStockCode.ToLower().Contains(s) ||
                (x.ReturnedProductName != null && x.ReturnedProductName.ToLower().Contains(s)) ||
                (x.GivenProductName != null && x.GivenProductName.ToLower().Contains(s)) ||
                (x.InvoiceNo != null && x.InvoiceNo.ToLower().Contains(s)) ||
                (x.ReturnedSerialNo != null && x.ReturnedSerialNo.ToLower().Contains(s)) ||
                (x.GivenSerialNo != null && x.GivenSerialNo.ToLower().Contains(s)));
        }

        var rows = await query
            .OrderByDescending(x => x.Date)
            .ThenByDescending(x => x.Id)
            .Take(2000)
            .ToListAsync(cancellationToken);

        // Cari adı ve depo adları tek seferde çözülüyor; satır başına sorgu N+1 üretirdi.
        var customerCodes = rows.Select(x => x.CustomerCode).Distinct().ToList();
        var customerNames = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => customerCodes.Contains(x.CustomerCode))
            .Select(x => new { x.CustomerCode, x.Name })
            .ToListAsync(cancellationToken);
        var nameByCustomer = customerNames
            .GroupBy(x => x.CustomerCode)
            .ToDictionary(g => g.Key, g => g.First().Name);

        var warehouseCodes = rows.Select(x => x.WarrantyWarehouseCode)
            .Concat(rows.Select(x => x.OutWarehouseCode))
            .Distinct()
            .ToList();
        var warehouseRows = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .Where(x => warehouseCodes.Contains(x.WarehouseCode))
            .Select(x => new { x.WarehouseCode, x.Name })
            .ToListAsync(cancellationToken);
        var nameByWarehouse = warehouseRows.ToDictionary(x => x.WarehouseCode, x => x.Name);

        // canModify BİR KEZ hesaplanıyor (satır başına değil): CanDeleteRecordAsync ile
        // Delete/Update uçlarındaki AYNI iki kapı — SSA/SuperAdmin her zaman geçer, kendi
        // kaydı ya da "Tüm İşlemleri Silebilsin" izni tabanı açar, "Garanti Değişim" özel
        // kısıtı rolde açıksa 1 günden eski kayıt yine de kapanır. Rol izinleri kullanıcı
        // boyunca sabit; yalnız CreateUser satır satır değişiyor.
        var currentUsername = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
        var isSsaForList = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var isSuperAdminForList = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var canDeleteOthers = false;
        var hasGarantiDegisimRestriction = false;
        var roleIdClaimForList = User.Claims.FirstOrDefault(c => string.Equals(c.Type, "RoleId", StringComparison.OrdinalIgnoreCase))?.Value;
        if (!isSsaForList && !isSuperAdminForList && int.TryParse(roleIdClaimForList, out var roleIdForList))
        {
            canDeleteOthers = await _dbContext.RolePagePermissions
                .AsNoTracking()
                .AnyAsync(rpp => rpp.RoleId == roleIdForList && rpp.CanAccess && rpp.Page.ModuleKey == "deleteRule" && rpp.Page.Key == "deleteRule/tumIslemleriSilebilsin", cancellationToken);

            hasGarantiDegisimRestriction = await _dbContext.RolePagePermissions
                .AsNoTracking()
                .AnyAsync(rpp => rpp.RoleId == roleIdForList && rpp.CanAccess && rpp.Page.ModuleKey == "deleteRule" && rpp.Page.Key == "deleteRule/garantiDegisim", cancellationToken);
        }

        bool CanModify(WarrantyExchange x)
        {
            var baseAllowed = isSsaForList || isSuperAdminForList
                || string.Equals(x.CreateUser ?? string.Empty, currentUsername, StringComparison.OrdinalIgnoreCase)
                || canDeleteOthers;
            if (!baseAllowed) return false;

            if (!isSsaForList && !isSuperAdminForList && hasGarantiDegisimRestriction
                && DateTime.UtcNow - x.CreateTime > TimeSpan.FromDays(1))
            {
                return false;
            }

            return true;
        }

        var data = rows.Select(x => new
        {
            id = x.Id,
            exchangeNo = x.ExchangeNo,
            date = x.Date,
            customerCode = x.CustomerCode,
            customerName = nameByCustomer.TryGetValue(x.CustomerCode, out var cn) ? cn : null,
            invoiceNo = x.InvoiceNo,

            warrantyWarehouseCode = x.WarrantyWarehouseCode,
            warrantyWarehouseName = nameByWarehouse.TryGetValue(x.WarrantyWarehouseCode, out var wn) ? wn : null,
            outWarehouseCode = x.OutWarehouseCode,
            outWarehouseName = nameByWarehouse.TryGetValue(x.OutWarehouseCode, out var on) ? on : null,

            returnedStockCode = x.ReturnedStockCode,
            returnedProductName = x.ReturnedProductName,
            returnedQuantity = x.ReturnedQuantity,
            returnedUnitPrice = x.ReturnedUnitPrice,
            returnedSerialNo = x.ReturnedSerialNo,

            givenStockCode = x.GivenStockCode,
            givenProductName = x.GivenProductName,
            givenQuantity = x.GivenQuantity,
            givenUnitPrice = x.GivenUnitPrice,
            givenSerialNo = x.GivenSerialNo,

            discountAmount = x.DiscountAmount,
            differenceAmount = x.DifferenceAmount,

            // Tutarlar kaydın KENDİ para biriminde. Kod da gönderilmezse ekran hepsini
            // ₺ diye biçimlendirir — bu raporun eski hâlindeki hataydı.
            currencyTypeId = CurrencyTypeHelper.Normalize(x.CurrencyTypeId),
            currencyCode = CurrencyTypeHelper.ToCodeOrTry(x.CurrencyTypeId),
            currencyRate = x.CurrencyRate <= 0 ? 1m : x.CurrencyRate,
            tryDifferenceAmount = Math.Round(x.DifferenceAmount * (x.CurrencyRate <= 0 ? 1m : x.CurrencyRate), 2, MidpointRounding.AwayFromZero),
            postedToLedger = x.CustomerLedgerEntryId.HasValue,

            description = x.Description,
            createUser = x.CreateUser,
            createTime = x.CreateTime,
            editUser = x.EditUser,
            editTime = x.EditTime,

            /*
              DÜZENLEME/SİLME HAKKI SUNUCUDAN GELİR (2026-09-02).

              Kural "kendi kaydı + bugün". Ekran bunu kendi başına hesaplasaydı iki kopya
              olurdu: kullanıcı adını istemcide karşılaştırmak (büyük/küçük harf, oturum
              adının farklı gelmesi) ve "bugün"ü tarayıcı saatiyle ölçmek — ikisi de
              sunucununkinden ayrışabilir. Düğmeler bu bayrağa bakar, uç zaten aynı
              kuralı yeniden uyguluyor.
            */
            canModify = CanModify(x)
        }).ToList();

        return Ok(new { success = true, data });
    }

    /// <summary>
    /// Bir deponun tek stok kalemindeki bakiyesi (giriş − çıkış). Envanter ucuyla aynı kural.
    /// </summary>
    private async Task<decimal> GetWarehouseBalanceAsync(int warehouseCode, string stockCode, CancellationToken cancellationToken)
    {
        var rows = await _dbContext.Set<StockMovement>()
            .AsNoTracking()
            .Where(x => x.WarehouseCode == warehouseCode && x.StockCode == stockCode)
            .GroupBy(x => x.Direction)
            .Select(g => new { Direction = g.Key, Qty = g.Sum(x => x.Quantity) })
            .ToListAsync(cancellationToken);

        var inQty = rows.FirstOrDefault(x => x.Direction == StockMovementDirection.In)?.Qty ?? 0m;
        var outQty = rows.FirstOrDefault(x => x.Direction == StockMovementDirection.Out)?.Qty ?? 0m;
        return inQty - outQty;
    }
}
