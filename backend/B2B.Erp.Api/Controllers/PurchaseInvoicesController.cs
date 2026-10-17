using System.Security.Cryptography;
using System.Security.Claims;
using B2B.Erp.Api.Core.Http;
using System.Text.Json;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Services;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.PurchaseInvoices;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

using B2B.Erp.Api.Core.Interfaces;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/purchase-invoices")]
[Authorize]
public sealed class PurchaseInvoicesController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly IMoneyServiceClient _money;
    private readonly B2B.Erp.Api.Core.Services.ICustomerAccountService _customerAccountService;


    /// <summary>
    /// FİRMANIN SAATİ (2026-08-20 kullanıcı kararı, denetim md. D1). "Bugün" UTC takvim
    /// gününden okunuyordu; KKTC (UTC+3) gibi bir yerde yerel 00:00–03:00 arasında yapılan
    /// işlem BİR ÖNCEKİ güne damgalanıyordu.
    /// </summary>
    private readonly B2B.Erp.Api.Core.Helpers.CompanyClock _clock;

    public PurchaseInvoicesController(
        AppDbContext dbContext,
        IMoneyServiceClient money,
        B2B.Erp.Api.Core.Helpers.CompanyClock clock,
        B2B.Erp.Api.Core.Services.ICustomerAccountService customerAccountService)
    {
        _dbContext = dbContext;
        _money = money;
        _clock = clock;
        _customerAccountService = customerAccountService;
    }

    /// <summary>
    /// İADE, BİR MAL HAREKETİDİR — EKSTRE SATIRI CARİNİN TİPİNE GÖRE ALT HESABA YAZILIR
    /// (2026-08-20).
    ///
    /// Kullanıcı kuralı: "mal satışları -1/-2/-3'ten yapılır, hesaba alınan paralar normal
    /// carisinden yapılır; sistem genelinde böyle olmalı." Satış faturası, teklif→fatura ve
    /// garanti değişimi bu kuralı uyguluyordu; ALIŞ İADE faturası uygulamıyor, ekstre satırını
    /// ANA cariye yazıyordu. Sonuç: aynı malın çıkışı `120-01-000001-1`de, iadesi
    /// `120-01-000001`de duruyor — alt hesap hiç kapanmıyor, iade "ekstreye uğramamış" gibi
    /// görünüyordu.
    ///
    /// Hedefi çözen tek yer <see cref="Core.Services.ICustomerAccountService"/>: carinin
    /// `InvoiceType`i ve fiyat grubu kodundan karar verir (pg 7 muaf → -3, pg 4-6 açık → -2,
    /// diğeri resmi fatura → -1). Burada kural KOPYALANMIYOR, çağrılıyor.
    ///
    /// HİZMET faturası bilerek dışarıda: hizmet bir mal hareketi değildir, ana cariye yazılır.
    /// Çözülemezse gelen kod aynen döner — fail-open değil, davranış eskisiyle birebir aynı.
    /// </summary>
    private async Task<string> ResolveGoodsLedgerCustomerCodeAsync(
        PurchaseInvoice purchase,
        string customerCode,
        CancellationToken cancellationToken)
    {
        if (purchase.Kind != PurchaseInvoiceKind.Return) return customerCode;
        if (string.IsNullOrWhiteSpace(customerCode)) return customerCode;

        var resolved = await _customerAccountService
            .ResolveTargetInvoiceCustomerCodeAsync(customerCode, cancellationToken: cancellationToken);

        return string.IsNullOrWhiteSpace(resolved) ? customerCode : resolved;
    }

    /// <summary>
    /// Alış faturası toplamını ekstre satırının iki kolonuna çevirir.
    ///
    /// <para>
    /// <b>`PurchaseInvoice.GrandTotal` TL DEĞİLDİR</b> — faturanın kendi para birimindedir
    /// (<c>RecalculateTotals</c> satırları önce TL'ye, sonra hedef para birimine çevirip
    /// toplar). Ekstre satırında ise <c>Amount</c> TL çapası, <c>CurrencyAmount</c> CARİNİN
    /// para birimindeki karşılıktır.
    /// </para>
    ///
    /// <para>
    /// <b>Kapatılan hata:</b> bu dosyada dört yazma noktası var. Onay yolundaki ikisi çeviriyi
    /// doğru yapıyordu; diğer ikisi <c>entryAmount = GrandTotal</c> deyip TL kolonuna faturanın
    /// DÖVİZ tutarını yazıyor, üstüne bir de onu kura BÖLÜP döviz kolonuna koyuyordu. 500 $'lık
    /// bir alış/iade faturası ekstreye <b>500 ₺ ve 16,67 $</b> olarak düşüyordu — iki kolon da
    /// yanlış, üstelik ters yönde. Aynı dosyada iki doğru iki yanlış: kardeş yol asimetrisi.
    /// Dördü de artık buradan geçiyor.
    /// </para>
    /// </summary>
    private static (decimal TryAmount, decimal CustomerCurrencyAmount) ConvertPurchaseTotalForLedger(
        decimal grandTotal,
        int invoiceCurrencyTypeId,
        decimal invoiceRate,
        int customerCurrencyTypeId,
        decimal customerRate)
    {
        // Hesap TEK KAYNAKTAN: Core/Accounting/PurchaseInvoiceMath — birim testi var.
        return B2B.Erp.Api.Core.Accounting.PurchaseInvoiceMath.Ledger(
            grandTotal, invoiceCurrencyTypeId, invoiceRate, customerCurrencyTypeId, customerRate);
    }

    /// <summary>Verilen para birimi için TL kuru; TL'de 1.</summary>
    private static decimal PickRate(int currencyTypeId, decimal usdRate, decimal eurRate, decimal gbpRate)
        => B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(currencyTypeId) switch
        {
            B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Usd => usdRate,
            B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Eur => eurRate,
            B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Gbp => gbpRate,
            _ => 1m
        };

    /// <summary>
    /// Alış faturasının para birimi.
    ///
    /// <para>
    /// <b>Bu kolon hiç YAZILMIYORDU.</b> <c>PurchaseInvoice.CurrencyTypeId</c> varlıkta duruyor
    /// ve tedarikçi ekstresinin kalem detayı (<c>SupplierLedgerController</c>) onu okuyor — ama
    /// hiçbir yazma yolu değer koymadığı için hep 0 kalıyor, yani dövizli alış faturasının
    /// kalemleri ekstre detayında HER ZAMAN TL görünüyordu. Okuyucu düzeltilmiş, yazan
    /// eklenmemişti.
    /// </para>
    ///
    /// <para>
    /// Kural listeleme ucundakiyle AYNI tutuluyor ki ekran ile detay çelişmesin:
    /// iade/hizmet faturasında para birimi CARİNİN kartından, normal alışta ÜRÜNÜN ALIŞ
    /// dövizinden (<c>Product.CurrencyCode</c>) gelir. Satırlar farklı dövizli ürünler
    /// içeriyorsa tek bir belge para birimi yoktur; o hâlde TL'ye düşülür — uydurma bir döviz
    /// damgalamaktansa bugünkü davranışı korumak yeğdir.
    /// </para>
    /// </summary>
    /// <summary>
    /// Para birimi + O ANDAKİ DONMUŞ KUR.
    ///
    /// <para>
    /// <c>PurchaseInvoice.ExchangeRate</c> kolonu vardı ama <b>hiçbir yerde yazılmıyordu</b>,
    /// yani hep 1 kalıyordu. Tedarikçi ekstresi onu okuyup <c>GrandTotal / ExchangeRate</c>
    /// yapıyor; kur 1 olduğu için dövizli fatura ekstreye kursuz düşüyordu. Para birimini
    /// damgalayıp kuru damgalamamak, belgeyi yarı yarıya tanımlı bırakmaktı.
    /// </para>
    /// </summary>
    /// <summary>
    /// BELGENİN DÖVİZİ ARTIK BEYAN EDİLİR, TAHMİN EDİLMEZ (2026-08-29 kullanıcı isteği:
    /// "alış kurunu seç diye bir buton olsun, biz genelde TL alıyoruz ama seçime bağlı olmalı").
    ///
    /// Eski davranış dövizi ÜRÜN KARTINDAN türetiyordu. Tedarikçinin elindeki fatura gerçek bir
    /// belgedir; üstündeki para birimi ve kur veridir, tahmin edilecek bir şey değil. Ekranda da
    /// hiçbir şey görünmediği için kullanıcı hangi para biriminde yazdığını bilmiyordu — canlıda
    /// USD tedarikçiye TL tutar girilmesine yol açtı (belge no "1", Id 50).
    ///
    /// Sıra: istekte döviz geldiyse O geçerlidir. Gelmediyse eski tahmin yedek olarak çalışır —
    /// böylece güncellenmemiş istemciler kırılmaz.
    ///
    /// Kur: istekte geldiyse elle girilmiş sayılır ve <c>RateSource="Manuel"</c> damgalanır;
    /// gelmediyse günün TCMB kuru alınır ve <c>"TCMB"</c> damgalanır.
    /// </summary>
    private async Task<(int CurrencyTypeId, decimal Rate, string RateSource)> ResolveDeclaredCurrencyAsync(
        CreatePurchaseInvoiceRequest request,
        PurchaseInvoiceKind kind,
        string? customerCode,
        IEnumerable<Guid?> lineProductIds,
        IReadOnlyDictionary<Guid, int> productCurrencyById,
        CancellationToken cancellationToken)
    {
        var beyanEdilen = request.CurrencyTypeId.HasValue
            && B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsKnown(request.CurrencyTypeId.Value);

        if (!beyanEdilen)
        {
            var tahmin = await ResolvePurchaseInvoiceCurrencyAndRateAsync(
                kind, customerCode, lineProductIds, productCurrencyById, cancellationToken);
            return (tahmin.CurrencyTypeId, tahmin.Rate, "TCMB");
        }

        var doviz = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(request.CurrencyTypeId!.Value);

        if (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(doviz))
        {
            return (doviz, 1m, "TCMB");
        }

        // Elle girilen kur: 0 ya da eksi kabul edilmez — belgeyi tanımsız bırakır.
        if (request.ExchangeRate.HasValue && request.ExchangeRate.Value > 0m)
        {
            return (doviz, decimal.Round(request.ExchangeRate.Value, 4, MidpointRounding.AwayFromZero), "Manuel");
        }

        var kod = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.ToCode(doviz);
        var kur = 1m;
        if (!string.IsNullOrWhiteSpace(kod))
        {
            try
            {
                var cekilen = await _money.GetLatestTryRateAsync(kod, cancellationToken);
                if (cekilen > 0m) kur = cekilen;
            }
            catch { kur = 1m; }
        }

        return (doviz, kur, "TCMB");
    }

    private async Task<(int CurrencyTypeId, decimal Rate)> ResolvePurchaseInvoiceCurrencyAndRateAsync(
        PurchaseInvoiceKind kind,
        string? customerCode,
        IEnumerable<Guid?> lineProductIds,
        IReadOnlyDictionary<Guid, int> productCurrencyById,
        CancellationToken cancellationToken)
    {
        var currencyTypeId = await ResolvePurchaseInvoiceCurrencyAsync(
            kind, customerCode, lineProductIds, productCurrencyById, cancellationToken);

        if (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(currencyTypeId))
        {
            return (currencyTypeId, 1m);
        }

        var code = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.ToCode(currencyTypeId);
        var rate = 1m;
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

        return (currencyTypeId, rate);
    }

    private async Task<int> ResolvePurchaseInvoiceCurrencyAsync(
        PurchaseInvoiceKind kind,
        string? customerCode,
        IEnumerable<Guid?> lineProductIds,
        IReadOnlyDictionary<Guid, int> productCurrencyById,
        CancellationToken cancellationToken)
    {
        if (kind == PurchaseInvoiceKind.Return || kind == PurchaseInvoiceKind.Service)
        {
            if (string.IsNullOrWhiteSpace(customerCode)) return B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try;

            var customerCurrency = await _dbContext.Customers
                .AsNoTracking()
                .Where(x => x.CustomerCode == customerCode)
                .Select(x => (int?)x.CurrencyTypeId)
                .FirstOrDefaultAsync(cancellationToken);

            return B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(customerCurrency ?? B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try);
        }

        var currencies = lineProductIds
            .Where(x => x.HasValue && x.Value != Guid.Empty)
            .Select(x => productCurrencyById.TryGetValue(x!.Value, out var c)
                ? B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(c)
                : B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try)
            .Distinct()
            .ToList();

        return currencies.Count == 1 ? currencies[0] : B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try;
    }

    /// <summary>
    /// Rolün GÖREBİLECEĞİ alış faturası türleri. <c>null</c> = kısıt yok (SSA / süper admin).
    ///
    /// <para>
    /// <b>Kullanıcı kararı (2026-08-20):</b> Rol Yetkileri'ndeki "Alış Tipi / Hizmet Tipi /
    /// İade Tipi" anahtarları yalnızca fatura KESMEYİ değil, kesilmiş faturaları GÖRMEYİ de
    /// belirler. Bugüne kadar bu üç anahtar sadece yeni kayıt ekranındaki tip seçicisini
    /// süzüyordu; liste tür ayırmadan hepsini gösteriyordu — yani yalnız hizmet faturası
    /// kesebilen bir rol bütün alış faturalarını okuyabiliyordu.
    /// </para>
    ///
    /// <para>
    /// <b>Hiç tip yetkisi yoksa hiçbir şey görünmez</b> (kullanıcı kararı, açık-kapanır).
    /// Kural tek cümle: "hangi tipler açıksa o tipler görünür". Fail-open bir dal
    /// bırakılsaydı yetki vermeyi unutmak tam görüş anlamına gelirdi.
    /// </para>
    ///
    /// <para>
    /// Süzgeç EKRANDA DEĞİL burada: liste süzgeci bir yetki kapısı değildir, uç açık
    /// kaldığında istek elle atılıp bütün satırlar okunabilir.
    /// </para>
    /// </summary>
    private async Task<List<PurchaseInvoiceKind>?> GetAllowedPurchaseKindsAsync(CancellationToken cancellationToken)
    {
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        if (isSsa || isSuperAdmin) return null;

        var roleIdClaim = User.Claims
            .FirstOrDefault(c => string.Equals(c.Type, "RoleId", StringComparison.OrdinalIgnoreCase))?.Value;

        if (!int.TryParse(roleIdClaim, out var roleId)) return new List<PurchaseInvoiceKind>();

        var keyByKind = new (string Key, PurchaseInvoiceKind Kind)[]
        {
            ("alisTipAlis", PurchaseInvoiceKind.Purchase),
            ("alisTipHizmet", PurchaseInvoiceKind.Service),
            ("alisTipIade", PurchaseInvoiceKind.Return)
        };

        var wantedKeys = keyByKind.Select(x => x.Key).ToList();

        var grantedKeys = await _dbContext.RolePagePermissions
            .AsNoTracking()
            .Where(rpp => rpp.RoleId == roleId
                          && rpp.CanAccess
                          && rpp.Page.ModuleKey == "invoice"
                          && wantedKeys.Contains(rpp.Page.Key))
            .Select(rpp => rpp.Page.Key)
            .ToListAsync(cancellationToken);

        return keyByKind
            .Where(x => grantedKeys.Contains(x.Key))
            .Select(x => x.Kind)
            .ToList();
    }

    [HttpGet]
    [AuthorizePage("invoice", "alis")]
    public async Task<IActionResult> List(
        [FromQuery] int take = 200,
        [FromQuery] int? kind = null,
        [FromQuery] int skip = 0,
        CancellationToken cancellationToken = default)
    {
        var allowedKinds = await GetAllowedPurchaseKindsAsync(cancellationToken);

        // Tek bir tip bile açık değilse liste boştur (bkz. GetAllowedPurchaseKindsAsync).
        if (allowedKinds is { Count: 0 })
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        return await BuildListAsync(take, kind, allowedKinds, cancellationToken, skip);
    }

    /// <summary>
    /// Termin ekranının listesi — YALNIZ alış (Kind=0) faturaları, tip yetkisi süzgeci YOK.
    ///
    /// <para>
    /// Termin ayrı bir sayfa ve ayrı bir yetkidir (<c>invoice/termin</c>): iş anlamı
    /// "hangi siparişim yolda", "hangi tipte fatura kesebilirim" değil. Alış Faturaları
    /// listesiyle aynı ucu paylaşmaya devam etseydi, tip yetkisi verilmemiş ama termini olan
    /// roller (ana veritabanında Bayi, Kurumsal, Mudur, Plasiyer) termin ekranını boş
    /// görürdü. Bu yüzden ayrı uç: bypass'ın bedeli <c>invoice/termin</c> yetkisidir.
    /// </para>
    /// </summary>
    [HttpGet("termin")]
    [AuthorizePage("invoice", "termin")]
    public Task<IActionResult> TerminList(
        [FromQuery] int take = 500,
        [FromQuery] int skip = 0,
        CancellationToken cancellationToken = default)
        => BuildListAsync(take, (int)PurchaseInvoiceKind.Purchase, null, cancellationToken, skip);

    private async Task<IActionResult> BuildListAsync(
        int take,
        int? kind,
        List<PurchaseInvoiceKind>? allowedKinds,
        CancellationToken cancellationToken,
        int skip = 0)
    {
        take = Math.Clamp(take, 1, 500);
        // SAYFALI OKUMA (2026-10-08, kullanıcı: "alış faturalarında 200'den eskisi görünmüyor").
        // Liste yalnız "son N" döndürüyordu; ekran 200 istiyor, arama/süzgeç de tarayıcıda o 200'ün
        // içinde çalışıyordu — 25.08'deki fatura Fatura Dökümü'nde ve ekstrede görünürken burada
        // HİÇ bulunamıyordu. Ekran artık skip ile sayfa sayfa hepsini çekiyor.
        skip = Math.Max(0, skip);

        // TÜR SÜZGECİ (2026-08-19). Termin ekranı yalnızca ALIŞ (Kind=0) faturalarını
        // gösteriyor ama liste tür ayırmadan "son N fatura"yı döndürüyordu: araya giren
        // hizmet/iade faturaları pencereyi doldurunca alış faturaları termine hiç
        // düşmüyordu. Süzgeç artık sorguda, pencere de istenen türe ayrılıyor.
        var query = _dbContext.Set<PurchaseInvoice>().AsNoTracking();

        // ROL SÜZGECİ ÖNCE: istekteki `kind` yalnızca izin verilen kümenin İÇİNİ daraltabilir,
        // dışına çıkamaz. Sıra ters olsaydı `?kind=0` isteği yetkisi olmayan türü açardı.
        if (allowedKinds != null)
        {
            query = query.Where(x => allowedKinds.Contains(x.Kind));
        }

        if (kind.HasValue && Enum.IsDefined(typeof(PurchaseInvoiceKind), kind.Value))
        {
            var kindValue = (PurchaseInvoiceKind)kind.Value;
            if (allowedKinds != null && !allowedKinds.Contains(kindValue))
            {
                return Ok(new { success = true, data = Array.Empty<object>() });
            }
            query = query.Where(x => x.Kind == kindValue);
        }

        var items = await query
            .OrderByDescending(x => x.Id)
            .Skip(skip)
            .Take(take)
            .Select(x => new
            {
                x.Id,
                x.Approved,
                x.Date,
                x.DocumentNo,
                x.Kind,
                x.TerminStatus,
                x.EstimatedArrivalDate,
                x.SupplierCode,
                x.ServiceCode,
                x.CustomerCode,
                x.CashAccountId,
                MuhtelifName = x.CustomerCode == null ? (x.MuhtelifCustomer != null ? x.MuhtelifCustomer.Name : null) : null,
                x.MuhtelifCustomerId,
                x.Description,
                x.VatExempt,
                // Belgenin damgali para birimi + kuru; ekran artik BUNU okuyor.
                x.CurrencyTypeId,
                x.ExchangeRate,
                x.RateSource,
                x.Subtotal,
                x.DiscountTotal,
                x.NetTotal,
                x.VatTotal,
                x.GrandTotal,
                x.SalesmanCode,
                x.CreateUser,
                Lines = x.Lines
                    .OrderBy(l => l.LineNo)
                    .Select(l => new
                    {
                        l.Id,
                        l.ProductId,
                        l.StockCode,
                        l.WarehouseCode,
                        StockName = l.Product != null ? l.Product.Name : string.Empty,
                        l.Description,
                        l.Quantity,
                        l.UnitPrice,
                        l.VatRate,
                        DiscountType = (int)l.DiscountType,
                        l.DiscountValue,
                        l.DeliveryStatus,
                        l.DeliveryTeam,
                        l.DeliveryDispatchDate,
                        l.DeliveryCompletedDate,
                        l.LineNo,
                        l.CurrencyUnitPrice,
                        CurrencyCode = l.Product != null ? l.Product.CurrencyCode : 0
                    })
                    .ToList()
            })
            .ToListAsync(cancellationToken);

        // HİZMET faturaları da buraya dahil (2026-08-20): bu sözlük yalnız İade'yi topluyordu,
        // dolayısıyla hizmet faturasının carisi hiç sorgulanmıyordu. Hem "Cari Adı" boş
        // kalıyordu hem de aşağıdaki kalem döviz araması (`Return || Service`) hizmet
        // tarafında hiçbir zaman eşleşmiyordu.
        var customerCodes = items
            .Where(x => (x.Kind == PurchaseInvoiceKind.Return || x.Kind == PurchaseInvoiceKind.Service)
                && !string.IsNullOrWhiteSpace(x.CustomerCode))
            .Select(x => x.CustomerCode!)
            .Distinct()
            .ToList();

        var supplierCodes = items
            .Where(x => x.Kind == PurchaseInvoiceKind.Purchase && !string.IsNullOrWhiteSpace(x.SupplierCode))
            .Select(x => x.SupplierCode!)
            .Distinct()
            .ToList();

        var serviceCodes = items
            .Where(x => x.Kind == PurchaseInvoiceKind.Service && !string.IsNullOrWhiteSpace(x.ServiceCode))
            .Select(x => x.ServiceCode!)
            .Distinct()
            .ToList();

        var customerInfoByCode = customerCodes.Count == 0
            ? new Dictionary<string, (string Name, int CurrencyTypeId)>()
            : await _dbContext.Customers
                .AsNoTracking()
                .Where(x => customerCodes.Contains(x.CustomerCode))
                .Select(x => new { x.CustomerCode, x.Name, x.CurrencyTypeId })
                .ToDictionaryAsync(x => x.CustomerCode, x => (x.Name, x.CurrencyTypeId), cancellationToken);

        var supplierNameByCode = supplierCodes.Count == 0
            ? new Dictionary<string, string>()
            : await _dbContext.Set<Supplier>()
                .AsNoTracking()
                .Where(x => supplierCodes.Contains(x.SupplierCode))
                .Select(x => new { x.SupplierCode, x.FullName })
                .ToDictionaryAsync(x => x.SupplierCode, x => x.FullName, cancellationToken);

        var serviceNameByCode = serviceCodes.Count == 0
            ? new Dictionary<string, string>()
            : await _dbContext.Set<ServiceCatalogItem>()
                .AsNoTracking()
                .Where(x => serviceCodes.Contains(x.Code))
                .Select(x => new { x.Code, x.Name })
                .ToDictionaryAsync(x => x.Code, x => x.Name, cancellationToken);

        var data = items.Select(x => new PurchaseInvoiceListItemResponse
        {
            Id = x.Id,
            Approved = x.Approved,
            Date = x.Date,
            DocumentNo = x.DocumentNo,
            Kind = x.Kind,
            TerminStatus = x.TerminStatus,
            SupplierCode = x.SupplierCode,
            ServiceCode = x.ServiceCode,
            CashAccountId = x.CashAccountId,
            // CARİ KODU HER ZAMAN CARİNİN KODUDUR (2026-08-20).
            //
            // Hizmet faturasında bu alana `ServiceCode` basılıyordu: listede "Cari Kodu"
            // sütununda 770-01-000001 yerine HIZ-ELEKTRIK, "Cari Adı"nda da carinin adı
            // yerine hizmetin adı görünüyordu — faturanın kime kesildiği ekranda kayboluyordu.
            // Hizmet bilgisi zaten ayrı `ServiceCode` alanında ve kalem satırında (`StockName`)
            // duruyor, o yüzden bir şey kaybolmuyor.
            CustomerCode = x.Kind == PurchaseInvoiceKind.Purchase
                ? x.SupplierCode
                : x.CustomerCode,
            CustomerName = x.Kind == PurchaseInvoiceKind.Purchase
                ? (x.SupplierCode != null && supplierNameByCode.TryGetValue(x.SupplierCode, out var sn) ? sn : null)
                : (x.CustomerCode != null && customerInfoByCode.TryGetValue(x.CustomerCode, out var val) ? val.Name : x.MuhtelifName),
            SalesmanCode = x.SalesmanCode,
            Description = x.Description,
            VatExempt = x.VatExempt,
            Subtotal = x.Subtotal,
            DiscountTotal = x.DiscountTotal,
            NetTotal = x.NetTotal,
            VatTotal = x.VatTotal,
            GrandTotal = x.GrandTotal,
            /*
              BELGENİN PARA BİRİMİ VE KURU (2026-09-01 düzeltmesi).

              Bu iki alan DTO'da tanımlıydı ve sorgu da onları çekiyordu, ama BURADA
              ATANMIYORDU: yanıt her faturayı `currencyTypeId = 0` (TL) olarak gönderiyordu.
              Kayıtta USD (3) yazan fatura ekranda TL görünüyor, düzenlemeye açınca da TL
              seçili geliyordu — kaydedilince belge gerçekten TL'ye dönüyordu.

              Satır seviyesindeki `CurrencyCode` zaten belgenin damgasından türetiliyordu
              (aşağıdaki `docCurrency`); eksik olan yalnızca BAŞLIK alanlarıydı, bu yüzden
              hata tutarlarda değil ETİKETTE görünüyordu.
            */
            CurrencyTypeId = x.CurrencyTypeId,
            ExchangeRate = x.ExchangeRate,
            RateSource = x.RateSource,
            CreateUser = x.CreateUser,
            EstimatedArrivalDate = x.EstimatedArrivalDate,
            Lines = x.Lines.Select(l => {
                /*
                  OKUMA NOKTASI: BELGENİN KENDİ PARA BİRİMİ (2026-08-29 kullanıcı isteği:
                  "biz okuma noktasını değiştirmemiz lazım, bu program genelinde değişmesi
                  lazımdı").

                  Ekran para birimini KAYITTAN değil, satırın ÜRÜN KARTINDAN okuyordu. Sonucu
                  canlıda görüldü (belge no "1", Id 50): kayıtta belge TL damgalı olduğu hâlde
                  ekran USD gösteriyor, üstelik aynı faturanın 5 satırı $ 2 satırı ₺ çıkıyordu —
                  her satır kendi ürününün kartına baktığı için. Kullanıcı TL yazdığını
                  göremediğinden tutarları yanlış girdi.

                  Artık belgenin damgalı para birimi esastır. Damga yoksa (kolon yazılmadan
                  önce kesilmiş eski faturalar) ESKİ davranışa düşülür — o kayıtlarda başka
                  bilgi yok, ürün kartı elimizdeki tek ipucu.
                */
                var docCurrency = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsKnown(x.CurrencyTypeId)
                    ? B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(x.CurrencyTypeId)
                    : 0;

                if (docCurrency == 0)
                {
                    if (x.Kind == PurchaseInvoiceKind.Return || x.Kind == PurchaseInvoiceKind.Service)
                    {
                        if (x.CustomerCode != null && customerInfoByCode.TryGetValue(x.CustomerCode, out var cInfo))
                        {
                            // Cari dövizi ile ürün kartı dövizi ARTIK AYNI kodlamada;
                            // eskiden burada 3(USD) -> 43 ve 4(GBP) -> 3 çevriliyordu.
                            docCurrency = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Normalize(cInfo.CurrencyTypeId);
                        }
                    }
                    else
                    {
                        docCurrency = l.CurrencyCode;
                    }
                }
                return new PurchaseInvoiceLineResponse
                {
                    Id = l.Id,
                    ProductId = l.ProductId,
                    StockCode = l.StockCode,
                    WarehouseCode = l.WarehouseCode,
                    StockName = x.Kind == PurchaseInvoiceKind.Service
                        ? (x.ServiceCode != null && serviceNameByCode.TryGetValue(x.ServiceCode, out var sName) ? sName : l.StockName)
                        : l.StockName,
                    Description = l.Description,
                    Quantity = l.Quantity,
                    // `UnitPrice` TL çapası, `CurrencyUnitPrice` belgenin kendi parası.
                    // Eski kayıtlarda ikincisi 0'dır; o hâlde TL çapası gösterilir.
                    UnitPrice = l.UnitPrice,
                    CurrencyUnitPrice = l.CurrencyUnitPrice > 0m ? l.CurrencyUnitPrice : l.UnitPrice,
                    VatRate = l.VatRate,
                    DiscountType = l.DiscountType,
                    DiscountValue = l.DiscountValue,
                    DeliveryStatus = l.DeliveryStatus,
                    DeliveryTeam = l.DeliveryTeam,
                    DeliveryDispatchDate = l.DeliveryDispatchDate,
                    DeliveryCompletedDate = l.DeliveryCompletedDate,
                    LineNo = l.LineNo,
                    CurrencyCode = docCurrency
                };
            }).ToList()
        });

        return Ok(new { success = true, data });
    }

    /// <summary>
    /// Yazma yolunda tip kapısı. Ekrandaki tip seçicisini süzmek YETMEZ — istek elle
    /// atıldığında yetkisi olmayan türde fatura kesilebiliyordu.
    /// </summary>
    private async Task<IActionResult?> EnsurePurchaseKindAllowedAsync(PurchaseInvoiceKind kind, CancellationToken cancellationToken)
    {
        var allowedKinds = await GetAllowedPurchaseKindsAsync(cancellationToken);
        if (allowedKinds == null || allowedKinds.Contains(kind)) return null;

        var label = kind switch
        {
            PurchaseInvoiceKind.Service => "Hizmet",
            PurchaseInvoiceKind.Return => "İade",
            _ => "Alış"
        };

        return StatusCode(StatusCodes.Status403Forbidden,
            new { success = false, message = $"{label} tipi faturalar için yetkiniz yok." });
    }

    [HttpGet("new-document-no")]
    [AuthorizePage("invoice", "alis")]
    public async Task<IActionResult> GetNewDocumentNo(CancellationToken cancellationToken)
    {
        var no = await GenerateUniqueDocumentNo(cancellationToken);
        return Ok(new { success = true, data = new { documentNo = no } });
    }

    [AtomicRequest]
    [HttpPost]
    [AuthorizePage("invoice", "alis")]
    public async Task<IActionResult> Create([FromBody] CreatePurchaseInvoiceRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        if (request.Lines.Count == 0)
        {
            ModelState.AddModelError(nameof(request.Lines), "En az 1 satır eklemelisiniz.");
            return ValidationProblem(ModelState);
        }

        if (request.Lines.Count > 17)
        {
            ModelState.AddModelError(nameof(request.Lines), "En fazla 17 kalem sipariş edebilirsiniz.");
            return ValidationProblem(ModelState);
        }

        var kind = request.Kind;

        // Tip yetkisi (2026-08-20): rolün açık olmayan bir tipte fatura kesmesi reddedilir.
        if (await EnsurePurchaseKindAllowedAsync(kind, cancellationToken) is IActionResult kindDenied)
        {
            return kindDenied;
        }

        var supplierCode = string.IsNullOrWhiteSpace(request.SupplierCode) ? null : request.SupplierCode.Trim();
        var serviceCode = string.IsNullOrWhiteSpace(request.ServiceCode) ? null : request.ServiceCode.Trim();
        var customerCodeRaw = string.IsNullOrWhiteSpace(request.CustomerCode) ? null : request.CustomerCode.Trim();

        if (kind == PurchaseInvoiceKind.Purchase)
        {
            if (string.IsNullOrWhiteSpace(supplierCode))
            {
                ModelState.AddModelError(nameof(request.SupplierCode), "SupplierCode zorunludur.");
            }
        }
        else if (kind == PurchaseInvoiceKind.Service)
        {
            if (string.IsNullOrWhiteSpace(serviceCode))
            {
                ModelState.AddModelError(nameof(request.ServiceCode), "ServiceCode zorunludur.");
            }
            if (string.IsNullOrWhiteSpace(customerCodeRaw))
            {
                ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode zorunludur.");
            }
        }
        else if (kind == PurchaseInvoiceKind.Return)
        {
            if (string.IsNullOrWhiteSpace(customerCodeRaw))
            {
                ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode zorunludur.");
            }
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        int? muhtelifCustomerId = null;
        string? customerCode = null;

        if (kind == PurchaseInvoiceKind.Return || kind == PurchaseInvoiceKind.Service)
        {
            customerCode = customerCodeRaw;

            if (string.IsNullOrWhiteSpace(customerCode))
            {
                ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode zorunludur.");
                return ValidationProblem(ModelState);
            }

            var exists = await _dbContext.Customers
                .AsNoTracking()
                .AnyAsync(x => x.CustomerCode == customerCode, cancellationToken);

            if (!exists)
            {
                ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode geçersiz.");
                return ValidationProblem(ModelState);
            }
        }

        // Faturanın para birimi burada damgalanıyor — bkz. ResolvePurchaseInvoiceCurrencyAsync.
        Dictionary<Guid, string> productStockCodeById = new();
        Dictionary<Guid, int> productCurrencyById = new();
        /*
          HİZMET SATIRI ÜRÜN KARTI İSTEMEZ (2026-09-18).

          "Hizmet Ekle" ile eklenen satır HİZMET KATALOĞUNDAN seçiliyor (HIZ-NAKLIYE…) ve bu
          kodların `Products` tablosunda karşılığı yok. "Her satırda ürün olsun" kuralı onları
          da kapsayınca fatura "Tüm satırlarda ürün seçmelisiniz" diyerek kaydedilemiyordu.

          Kararı SUNUCU veriyor: satır ancak kodu KATALOGDA GERÇEKTEN VARSA muaf tutulur.
          İstemcinin "bu hizmettir" demesi yeterli olsaydı, ürün kartı denetimi tamamen
          atlatılabilirdi.
        */
        var katalogKodlari = (await _dbContext.Set<ServiceCatalogItem>()
                .AsNoTracking()
                .Select(x => x.Code)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        bool KatalogHizmetSatiri(CreatePurchaseInvoiceLineRequest l)
            => (!l.ProductId.HasValue || l.ProductId.Value == Guid.Empty)
               && !string.IsNullOrWhiteSpace(l.StockCode)
               && katalogKodlari.Contains(l.StockCode.Trim());

        if (kind != PurchaseInvoiceKind.Service)
        {
            if (request.Lines.Any(x => (!x.ProductId.HasValue || x.ProductId.Value == Guid.Empty) && !KatalogHizmetSatiri(x)))
            {
                return BadRequest(new { success = false, message = "Tüm satırlarda ürün seçmelisiniz." });
            }

            var productIds = request.Lines
                .Where(x => x.ProductId.HasValue && x.ProductId.Value != Guid.Empty)
                .Select(x => x.ProductId!.Value)
                .Distinct()
                .ToList();

            var products = await _dbContext.Products
                .AsNoTracking()
                .Where(x => productIds.Contains(x.Id))
                .Select(x => new { x.Id, x.StockCode, x.CurrencyCode })
                .ToListAsync(cancellationToken);

            if (products.Count != productIds.Count)
            {
                return BadRequest(new { success = false, message = "Ürün listesinde geçersiz kayıt var." });
            }

            productStockCodeById = products.ToDictionary(x => x.Id, x => x.StockCode);
            productCurrencyById = products.ToDictionary(x => x.Id, x => x.CurrencyCode);
        }

        var dateRaw = request.Date?.Date ?? _clock.TodayCompanyDate();
        var date = DateTime.SpecifyKind(dateRaw, DateTimeKind.Utc);
        var username = User.Identity?.Name ?? "System";

        var docNo = (request.DocumentNo ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(docNo))
        {
            ModelState.AddModelError(nameof(request.DocumentNo), "Belge No zorunludur.");
            return ValidationProblem(ModelState);
        }

        var docNoExists = await _dbContext.PurchaseInvoices
            .AsNoTracking()
            .AnyAsync(x => x.DocumentNo == docNo, cancellationToken);

        if (docNoExists)
        {
            ModelState.AddModelError(nameof(request.DocumentNo), "Bu Belge No zaten kullanılmaktadır.");
            return ValidationProblem(ModelState);
        }

        var createCurrency = await ResolveDeclaredCurrencyAsync(
            request, kind, customerCode, request.Lines.Select(x => x.ProductId), productCurrencyById, cancellationToken);

        var entity = new PurchaseInvoice
        {
            DocumentNo = docNo,
            Date = date,
            Kind = kind,
            // `RateSource` kolonu alış faturasında YOK (yalnızca satış faturasında var);
            // eklemedim, çünkü şema göç bloklarında da tanımlı değil.
            CurrencyTypeId = createCurrency.CurrencyTypeId,
            ExchangeRate = createCurrency.Rate,
            RateSource = createCurrency.RateSource,
            SupplierCode = supplierCode,
            ServiceCode = serviceCode,
            CustomerCode = customerCode,
            MuhtelifCustomerId = muhtelifCustomerId,
            VatExempt = request.VatExempt,
            Approved = false,
            TerminStatus = PurchaseInvoiceTerminStatus.Waiting,
            SalesmanCode = string.IsNullOrWhiteSpace(request.SalesmanCode) ? null : request.SalesmanCode.Trim(),
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CashAccountId = request.CashAccountId,
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        };

        var lines = new List<PurchaseInvoiceLine>();
        var lineNo = 1;

        foreach (var line in request.Lines)
        {
            var qty = line.Quantity;
            // Kullanıcının belge para biriminde girdiği fiyat. Eski istemciler bu alanı
            // göndermez; o hâlde `UnitPrice` zaten TL'dir ve ikisi aynı olur.
            var belgeFiyati = line.CurrencyUnitPrice ?? line.UnitPrice;
            var unitPrice = B2B.Erp.Api.Core.Accounting.PurchaseInvoiceMath.TlCapasi(
                belgeFiyati, createCurrency.CurrencyTypeId, createCurrency.Rate);
            var vatRate = line.VatRate;

            Guid? productId = null;
            string stockCode;
            int? warehouseCode = null;

            if (kind == PurchaseInvoiceKind.Service)
            {
                stockCode = serviceCode ?? string.Empty;
                vatRate = 0m;
                warehouseCode = null;
            }
            else if (!line.ProductId.HasValue || line.ProductId.Value == Guid.Empty)
            {
                // Katalogdan gelen hizmet satırı: ürün kartı yok, stok kodu katalog kodudur,
                // envanteri hareket ettirmediği için deposu da yoktur.
                stockCode = (line.StockCode ?? string.Empty).Trim();
                warehouseCode = null;
            }
            else
            {
                stockCode = productStockCodeById[line.ProductId!.Value];
                productId = line.ProductId!.Value;
                // stockCode already resolved
                warehouseCode = line.WarehouseCode;
            }

            lines.Add(new PurchaseInvoiceLine
            {
                PurchaseInvoice = entity,
                ProductId = productId,
                StockCode = stockCode,
                WarehouseCode = warehouseCode,
                Description = string.IsNullOrWhiteSpace(line.Description) ? null : line.Description.Trim(),
                Quantity = qty,
                /*
                  İKİ FİYAT BİRLİKTE YAZILIR (2026-08-29).

                  `CurrencyUnitPrice` kullanıcının BELGE PARA BİRİMİNDE girdiği fiyattır —
                  tedarikçinin faturasında gerçekte yazan tutar. `UnitPrice` ise TL ÇAPASIDIR:
                  raporlar, stok maliyeti ve tedarikçi ekstresi onu okur.

                  TL belgede ikisi aynı sayıdır; TL alışların davranışı hiç değişmez. Dövizli
                  belgede TL karşılığı BELGENİN KENDİ kuruyla türetilir, günün kuruyla değil —
                  fatura kesildikten sonra kur oynayınca geçmiş maliyet kaymasın.
                */
                CurrencyUnitPrice = belgeFiyati,
                UnitPrice = unitPrice,
                VatRate = vatRate,
                DiscountType = line.DiscountType,
                DiscountValue = line.DiscountValue,
                DeliveryStatus = line.DeliveryStatus,
                DeliveryTeam = string.IsNullOrWhiteSpace(line.DeliveryTeam) ? null : line.DeliveryTeam.Trim(),
                DeliveryDispatchDate = NormalizeUtc(line.DeliveryDispatchDate),
                DeliveryCompletedDate = NormalizeUtc(line.DeliveryCompletedDate),
                LineNo = lineNo++,
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            });
        }

        entity.Lines = lines;

        await ApplyTotalsAsync(entity, cancellationToken);

        _dbContext.Set<PurchaseInvoice>().Add(entity);

        var stockMovements = BuildStockMovementsForPurchaseInvoice(entity);
        if (stockMovements.Count > 0)
        {
            _dbContext.Set<StockMovement>().AddRange(stockMovements);
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        await SyncPurchaseInvoiceLedgerEntryAsync(entity, cancellationToken);
        await _dbContext.SaveChangesAsync(cancellationToken);

        await UpsertInvoiceFromPurchase(entity.Id, cancellationToken);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = new { id = entity.Id, documentNo = entity.DocumentNo } });
    }

    [AtomicRequest]
    [HttpPut("{id:int}")]
    [AuthorizePage("invoice", "alisDuzenle")]
    public async Task<IActionResult> Update([FromRoute] int id, [FromBody] CreatePurchaseInvoiceRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var purchase = await _dbContext.Set<PurchaseInvoice>()
            .Include(x => x.Lines)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (purchase is null)
        {
            return NotFound(new { success = false, message = "Kayıt bulunamadı" });
        }

        if (request.Lines.Count == 0)
        {
            ModelState.AddModelError(nameof(request.Lines), "En az 1 satır eklemelisiniz.");
            return ValidationProblem(ModelState);
        }

        if (request.Lines.Count > 17)
        {
            ModelState.AddModelError(nameof(request.Lines), "En fazla 17 kalem sipariş edebilirsiniz.");
            return ValidationProblem(ModelState);
        }

        var kind = request.Kind;

        // Tip yetkisi (2026-08-20): rolün açık olmayan bir tipte fatura kesmesi reddedilir.
        if (await EnsurePurchaseKindAllowedAsync(kind, cancellationToken) is IActionResult kindDenied)
        {
            return kindDenied;
        }

        var supplierCode = string.IsNullOrWhiteSpace(request.SupplierCode) ? null : request.SupplierCode.Trim();
        var serviceCode = string.IsNullOrWhiteSpace(request.ServiceCode) ? null : request.ServiceCode.Trim();
        var customerCodeRaw = string.IsNullOrWhiteSpace(request.CustomerCode) ? null : request.CustomerCode.Trim();

        if (kind == PurchaseInvoiceKind.Purchase)
        {
            if (string.IsNullOrWhiteSpace(supplierCode))
            {
                ModelState.AddModelError(nameof(request.SupplierCode), "SupplierCode zorunludur.");
            }
        }
        else if (kind == PurchaseInvoiceKind.Service)
        {
            if (string.IsNullOrWhiteSpace(serviceCode))
            {
                ModelState.AddModelError(nameof(request.ServiceCode), "ServiceCode zorunludur.");
            }
            if (string.IsNullOrWhiteSpace(customerCodeRaw))
            {
                ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode zorunludur.");
            }
        }
        else if (kind == PurchaseInvoiceKind.Return)
        {
            if (string.IsNullOrWhiteSpace(customerCodeRaw))
            {
                ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode zorunludur.");
            }
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        int? muhtelifCustomerId = null;
        string? customerCode = null;

        if (kind == PurchaseInvoiceKind.Return || kind == PurchaseInvoiceKind.Service)
        {
            customerCode = customerCodeRaw;

            if (string.IsNullOrWhiteSpace(customerCode))
            {
                ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode zorunludur.");
                return ValidationProblem(ModelState);
            }

            var exists = await _dbContext.Customers
                .AsNoTracking()
                .AnyAsync(x => x.CustomerCode == customerCode, cancellationToken);

            if (!exists)
            {
                ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode geçersiz.");
                return ValidationProblem(ModelState);
            }
        }

        Dictionary<Guid, string> productStockCodeById = new();
        Dictionary<Guid, int> productCurrencyById = new();
        /*
          HİZMET SATIRI ÜRÜN KARTI İSTEMEZ (2026-09-18).

          "Hizmet Ekle" ile eklenen satır HİZMET KATALOĞUNDAN seçiliyor (HIZ-NAKLIYE…) ve bu
          kodların `Products` tablosunda karşılığı yok. "Her satırda ürün olsun" kuralı onları
          da kapsayınca fatura "Tüm satırlarda ürün seçmelisiniz" diyerek kaydedilemiyordu.

          Kararı SUNUCU veriyor: satır ancak kodu KATALOGDA GERÇEKTEN VARSA muaf tutulur.
          İstemcinin "bu hizmettir" demesi yeterli olsaydı, ürün kartı denetimi tamamen
          atlatılabilirdi.
        */
        var katalogKodlariU = (await _dbContext.Set<ServiceCatalogItem>()
                .AsNoTracking()
                .Select(x => x.Code)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        bool KatalogHizmetSatiriU(CreatePurchaseInvoiceLineRequest l)
            => (!l.ProductId.HasValue || l.ProductId.Value == Guid.Empty)
               && !string.IsNullOrWhiteSpace(l.StockCode)
               && katalogKodlariU.Contains(l.StockCode.Trim());

        if (kind != PurchaseInvoiceKind.Service)
        {
            if (request.Lines.Any(x => (!x.ProductId.HasValue || x.ProductId.Value == Guid.Empty) && !KatalogHizmetSatiriU(x)))
            {
                return BadRequest(new { success = false, message = "Tüm satırlarda ürün seçmelisiniz." });
            }

            var productIds = request.Lines
                .Where(x => x.ProductId.HasValue && x.ProductId.Value != Guid.Empty)
                .Select(x => x.ProductId!.Value)
                .Distinct()
                .ToList();

            var products = await _dbContext.Products
                .AsNoTracking()
                .Where(x => productIds.Contains(x.Id))
                .Select(x => new { x.Id, x.StockCode, x.CurrencyCode })
                .ToListAsync(cancellationToken);

            if (products.Count != productIds.Count)
            {
                return BadRequest(new { success = false, message = "Ürün listesinde geçersiz kayıt var." });
            }
            productStockCodeById = products.ToDictionary(x => x.Id, x => x.StockCode);
            productCurrencyById = products.ToDictionary(x => x.Id, x => x.CurrencyCode);
        }
        var username = User.Identity?.Name ?? "System";

        var newDocumentNo = (request.DocumentNo ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(newDocumentNo))
        {
            ModelState.AddModelError(nameof(request.DocumentNo), "Belge No zorunludur.");
            return ValidationProblem(ModelState);
        }

        var docNoExists = await _dbContext.PurchaseInvoices
            .AsNoTracking()
            .AnyAsync(x => x.DocumentNo == newDocumentNo && x.Id != id, cancellationToken);

        if (docNoExists)
        {
            ModelState.AddModelError(nameof(request.DocumentNo), "Bu Belge No zaten kullanılmaktadır.");
            return ValidationProblem(ModelState);
        }

        // Eski numara SAKLANIR: cari/stok satırları henüz eski numarayı taşıyor; yeni numarayla
        // aranırsa bulunamaz ve yanına ikincisi eklenir (bkz. SyncPurchaseInvoiceLedgerEntryAsync).
        var previousDocumentNo = purchase.DocumentNo;
        purchase.DocumentNo = newDocumentNo;

        if (request.Date.HasValue)
        {
            var updatedRaw = request.Date.Value.Date;
            purchase.Date = DateTime.SpecifyKind(updatedRaw, DateTimeKind.Utc);
        }
        purchase.Kind = kind;
        // Satırlar tümüyle yeniden yazıldığı için para birimi de yeniden çözülmeli:
        // kalemler dolarlı üründen TL ürüne çevrildiğinde belge dövizi eski değerde kalmamalı.
        var updateCurrency = await ResolveDeclaredCurrencyAsync(
            request,
            kind, customerCode, request.Lines.Select(x => x.ProductId), productCurrencyById, cancellationToken);
        purchase.CurrencyTypeId = updateCurrency.CurrencyTypeId;
        purchase.ExchangeRate = updateCurrency.Rate;
        purchase.RateSource = updateCurrency.RateSource;
        purchase.SupplierCode = supplierCode;
        purchase.ServiceCode = serviceCode;
        purchase.CustomerCode = customerCode;
        purchase.MuhtelifCustomerId = muhtelifCustomerId;
        purchase.VatExempt = request.VatExempt;
        purchase.SalesmanCode = string.IsNullOrWhiteSpace(request.SalesmanCode) ? null : request.SalesmanCode.Trim();
        purchase.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        purchase.CashAccountId = kind == PurchaseInvoiceKind.Return ? request.CashAccountId : null;
        purchase.EditUser = username;
        purchase.EditTime = DateTime.UtcNow;

        _dbContext.Set<PurchaseInvoiceLine>().RemoveRange(purchase.Lines);

        var lines = new List<PurchaseInvoiceLine>();
        var lineNo = 1;
        foreach (var line in request.Lines)
        {
            Guid? productId = null;
            string stockCode;
            var vatRate = line.VatRate;
            int? warehouseCode = null;

            if (kind == PurchaseInvoiceKind.Service)
            {
                stockCode = serviceCode ?? string.Empty;
                vatRate = 0m;
                warehouseCode = null;
            }
            else if (!line.ProductId.HasValue || line.ProductId.Value == Guid.Empty)
            {
                // Katalogdan gelen hizmet satırı: ürün kartı yok, stok kodu katalog kodudur,
                // envanteri hareket ettirmediği için deposu da yoktur.
                stockCode = (line.StockCode ?? string.Empty).Trim();
                warehouseCode = null;
            }
            else
            {
                stockCode = productStockCodeById[line.ProductId!.Value];
                productId = line.ProductId!.Value;
                warehouseCode = line.WarehouseCode;
            }

            lines.Add(new PurchaseInvoiceLine
            {
                PurchaseInvoiceId = purchase.Id,
                ProductId = productId,
                StockCode = stockCode,
                WarehouseCode = warehouseCode,
                Description = string.IsNullOrWhiteSpace(line.Description) ? null : line.Description.Trim(),
                Quantity = line.Quantity,
                /*
                  İKİ FİYAT BİRLİKTE YAZILIR (2026-08-29).

                  `CurrencyUnitPrice` kullanıcının BELGE PARA BİRİMİNDE girdiği fiyattır —
                  tedarikçinin faturasında gerçekte yazan tutar. `UnitPrice` ise TL ÇAPASIDIR:
                  raporlar, stok maliyeti ve tedarikçi ekstresi onu okur.

                  TL belgede ikisi aynı sayıdır; TL alışların davranışı hiç değişmez. Dövizli
                  belgede TL karşılığı BELGENİN KENDİ kuruyla türetilir, günün kuruyla değil —
                  fatura kesildikten sonra kur oynayınca geçmiş maliyet kaymasın.
                */
                CurrencyUnitPrice = line.CurrencyUnitPrice ?? line.UnitPrice,
                UnitPrice = B2B.Erp.Api.Core.Accounting.PurchaseInvoiceMath.TlCapasi(
                    line.CurrencyUnitPrice ?? line.UnitPrice, updateCurrency.CurrencyTypeId, updateCurrency.Rate),
                VatRate = vatRate,
                DiscountType = line.DiscountType,
                DiscountValue = line.DiscountValue,
                DeliveryStatus = line.DeliveryStatus,
                DeliveryTeam = string.IsNullOrWhiteSpace(line.DeliveryTeam) ? null : line.DeliveryTeam.Trim(),
                DeliveryDispatchDate = NormalizeUtc(line.DeliveryDispatchDate),
                DeliveryCompletedDate = NormalizeUtc(line.DeliveryCompletedDate),
                LineNo = lineNo++,
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            });
        }

        purchase.Lines = lines;
        await ApplyTotalsAsync(purchase, cancellationToken);

        await ReplaceStockMovementsForPurchaseInvoice(purchase, cancellationToken, previousDocumentNo);

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Sync Ledgers
        if (purchase.Kind == PurchaseInvoiceKind.Purchase)
        {
            var existingCashTx = await _dbContext.CashAccountTransactions
                .FirstOrDefaultAsync(x => x.ReferenceType == CashAccountTransactionReferenceType.Invoice && x.ReferenceId == purchase.Id, cancellationToken);
            if (existingCashTx != null)
            {
                _dbContext.CashAccountTransactions.Remove(existingCashTx);
            }

            await SyncPurchaseInvoiceLedgerEntryAsync(purchase, cancellationToken, previousDocumentNo);
        }
        else if (purchase.Kind == PurchaseInvoiceKind.Service)
        {
            var existingSupLedger = await _dbContext.SupplierLedgerEntries
                .FirstOrDefaultAsync(x => x.ReferenceType == SupplierLedgerEntryReferenceType.Invoice && x.ReferenceId == purchase.Id, cancellationToken);
            if (existingSupLedger != null)
            {
                _dbContext.SupplierLedgerEntries.Remove(existingSupLedger);
            }

            var existingCashTx = await _dbContext.CashAccountTransactions
                .FirstOrDefaultAsync(x => x.ReferenceType == CashAccountTransactionReferenceType.Invoice && x.ReferenceId == purchase.Id, cancellationToken);
            if (existingCashTx != null)
            {
                _dbContext.CashAccountTransactions.Remove(existingCashTx);
            }

            var custCode = (purchase.CustomerCode ?? string.Empty).Trim();
            if (!string.IsNullOrWhiteSpace(custCode))
            {
                var usdRate = await _money.GetLatestTryRateAsync("USD", cancellationToken);
                var eurRate = await _money.GetLatestTryRateAsync("EUR", cancellationToken);
                var gbpRate = await _money.GetLatestTryRateAsync("GBP", cancellationToken);

                var customer = await _dbContext.Customers
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.CustomerCode == custCode, cancellationToken);
                var targetCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(customer?.CurrencyTypeId ?? 1);

                var entryRate = targetCurrencyTypeId switch
                {
                    3 => usdRate, // USD
                    2 => eurRate, // EUR
                    4 => gbpRate, // GBP
                    _ => 1m
                };

                // Faturanın para birimi BAŞLIKTAN okunur (yukarıda damgalandı), ilk KALEMİN
                // ürününden türetilmez: hizmet ve iade faturasında kalemlerin `ProductId`si
                // null olabildiği için tür zorla TL'ye düşüyordu ve 1.000 $'lık hizmet
                // faturası carinin dolar ekstresine 1.000/38 = 26,31 $ olarak yazılıyordu.
                // Kural tek yerde: ResolvePurchaseInvoiceCurrencyAsync (hizmet/iade → carinin
                // dövizi), matematik tek yerde: ConvertPurchaseTotalForLedger.
                var invoiceCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(purchase.CurrencyTypeId);
                var invoiceRate = purchase.ExchangeRate > 0m
                    ? purchase.ExchangeRate
                    : PickRate(invoiceCurrencyTypeId, usdRate, eurRate, gbpRate);

                var (entryAmount, entryCurrencyAmount) = ConvertPurchaseTotalForLedger(
                    purchase.GrandTotal, invoiceCurrencyTypeId, invoiceRate, targetCurrencyTypeId, entryRate);

                // ⚠️ BELGE NO KAPISI — `ReferenceId` TEK BAŞINA KİMLİK DEĞİL (2026-08-22, canlıda veri bozdu).
                // `Invoices` (satış) ve `PurchaseInvoices` (alış) cari deftere AYNI `ReferenceType`
                // ile yazıyor ama id dizileri AYRI: iki tabloda da 1 numaralı kayıt var.
                // Yalnız `ReferenceId`ye bakan bu arama, alış faturası kesilirken BAŞKA BİR SATIŞ
                // faturasının defter satırını buluyor ve üzerine yazıyordu.
                // Canlı kanıt: satır 486 — 21.08'de GULERO'nun satış faturasıyla oluşmuş,
                // 22.08'de alış faturası kesilirken mesutD tarafından ezilmiş; tutarı 370.000'e,
                // belge no'su HZ260822125428'e çevrilmiş, ama açıklaması ve teslim carisi eski
                // faturadan kalmış. Satış faturasının ekstre satırı böylece KAYBOLDU.
                // Belge numarası da tutmadıkça satır bu belgeye ait sayılmaz; tutmuyorsa yenisi açılır.
                var existingCustLedger = await _dbContext.CustomerLedgerEntries
                    .FirstOrDefaultAsync(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice
                                              && x.ReferenceId == purchase.Id
                                              && (x.DocumentNo == purchase.DocumentNo
                                                  || (x.DocumentNo == previousDocumentNo
                                                      && (x.TransactionType == "Alış Faturası" || x.TransactionType == "İade Faturası"))),
                                         cancellationToken);

                if (existingCustLedger != null)
                {
                    existingCustLedger.CustomerCode = custCode;
                    existingCustLedger.Date = purchase.Date;
                    existingCustLedger.DueDate = purchase.Date;
                    existingCustLedger.Amount = entryAmount;
                    existingCustLedger.CurrencyTypeId = targetCurrencyTypeId;
                    existingCustLedger.CurrencyRate = entryRate <= 0 ? 1m : entryRate;
                    existingCustLedger.CurrencyAmount = entryCurrencyAmount;
                    existingCustLedger.DocumentNo = purchase.DocumentNo;
                    existingCustLedger.Description = "Faturamız";
                    _dbContext.CustomerLedgerEntries.Update(existingCustLedger);
                }
                else
                {
                    _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
                    {
                        CustomerCode = custCode,
                        Date = purchase.Date,
                        DueDate = purchase.Date,
                        Direction = CustomerLedgerEntryDirection.Credit,
                        Amount = entryAmount,
                        CurrencyTypeId = targetCurrencyTypeId,
                        CurrencyRate = entryRate <= 0 ? 1m : entryRate,
                        CurrencyAmount = entryCurrencyAmount,
                        DocumentNo = purchase.DocumentNo,
                        Description = "Faturamız",
                        TransactionType = "Alış Faturası",
                        ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                        ReferenceId = purchase.Id,
                        CreateUser = username,
                        CreateTime = DateTime.UtcNow
                    });
                }
            }
        }
        else if (purchase.Kind == PurchaseInvoiceKind.Return)
        {
            var existingSupLedger = await _dbContext.SupplierLedgerEntries
                .FirstOrDefaultAsync(x => x.ReferenceType == SupplierLedgerEntryReferenceType.Invoice && x.ReferenceId == purchase.Id, cancellationToken);
            if (existingSupLedger != null)
            {
                _dbContext.SupplierLedgerEntries.Remove(existingSupLedger);
            }

            var custCode = (purchase.CustomerCode ?? string.Empty).Trim();
            if (!string.IsNullOrWhiteSpace(custCode))
            {
                var custName = await _dbContext.Customers
                    .AsNoTracking()
                    .Where(x => x.CustomerCode == custCode)
                    .Select(x => x.Name)
                    .FirstOrDefaultAsync(cancellationToken) ?? string.Empty;

                var usdRate = await _money.GetLatestTryRateAsync("USD", cancellationToken);
                var eurRate = await _money.GetLatestTryRateAsync("EUR", cancellationToken);
                var gbpRate = await _money.GetLatestTryRateAsync("GBP", cancellationToken);

                var customer = await _dbContext.Customers
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.CustomerCode == custCode, cancellationToken);
                var targetCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(customer?.CurrencyTypeId ?? 1);

                var entryRate = targetCurrencyTypeId switch
                {
                    3 => usdRate, // USD
                    2 => eurRate, // EUR
                    4 => gbpRate, // GBP
                    _ => 1m
                };

                // Faturanın para birimi BAŞLIKTAN okunur (yukarıda damgalandı), ilk KALEMİN
                // ürününden türetilmez: hizmet ve iade faturasında kalemlerin `ProductId`si
                // null olabildiği için tür zorla TL'ye düşüyordu ve 1.000 $'lık hizmet
                // faturası carinin dolar ekstresine 1.000/38 = 26,31 $ olarak yazılıyordu.
                // Kural tek yerde: ResolvePurchaseInvoiceCurrencyAsync (hizmet/iade → carinin
                // dövizi), matematik tek yerde: ConvertPurchaseTotalForLedger.
                var invoiceCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(purchase.CurrencyTypeId);
                var invoiceRate = purchase.ExchangeRate > 0m
                    ? purchase.ExchangeRate
                    : PickRate(invoiceCurrencyTypeId, usdRate, eurRate, gbpRate);

                var (entryAmount, entryCurrencyAmount) = ConvertPurchaseTotalForLedger(
                    purchase.GrandTotal, invoiceCurrencyTypeId, invoiceRate, targetCurrencyTypeId, entryRate);

                // İade = MAL hareketi; ekstre satırı carinin tipine göre alt hesaba yazılır.
                var ledgerCustomerCode = await ResolveGoodsLedgerCustomerCodeAsync(purchase, custCode, cancellationToken);

                // Mevcut satır ARANIRKEN cari koduna BAKILMAZ: eskiden ana cariye yazılmış bir
                // satır, çözülen alt hesapla aranırsa bulunamaz ve aynı iade ekstreye İKİ KEZ
                // düşerdi. Bağ referansın kendisidir.
                var existingCustLedger = await _dbContext.CustomerLedgerEntries
                    .FirstOrDefaultAsync(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice
                                              && x.ReferenceId == purchase.Id
                                              && (x.DocumentNo == purchase.DocumentNo || x.DocumentNo == previousDocumentNo)
                                              && x.TransactionType == "İade Faturası", cancellationToken);

                if (existingCustLedger != null)
                {
                    existingCustLedger.CustomerCode = ledgerCustomerCode;
                    existingCustLedger.Date = purchase.Date;
                    existingCustLedger.DueDate = purchase.Date;
                    existingCustLedger.Amount = entryAmount;
                    existingCustLedger.CurrencyTypeId = targetCurrencyTypeId;
                    existingCustLedger.CurrencyRate = entryRate <= 0 ? 1m : entryRate;
                    existingCustLedger.CurrencyAmount = entryCurrencyAmount;
                    existingCustLedger.DocumentNo = purchase.DocumentNo;
                    existingCustLedger.Description = $"İade Faturası ({purchase.DocumentNo})";
                    _dbContext.CustomerLedgerEntries.Update(existingCustLedger);
                }
                else
                {
                    _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
                    {
                        CustomerCode = ledgerCustomerCode,
                        Date = purchase.Date,
                        DueDate = purchase.Date,
                        Direction = CustomerLedgerEntryDirection.Credit,
                        Amount = entryAmount,
                        CurrencyTypeId = targetCurrencyTypeId,
                        CurrencyRate = entryRate <= 0 ? 1m : entryRate,
                        CurrencyAmount = entryCurrencyAmount,
                        DocumentNo = purchase.DocumentNo,
                        Description = $"İade Faturası ({purchase.DocumentNo})",
                        TransactionType = "İade Faturası",
                        ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                        ReferenceId = purchase.Id,
                        CreateUser = username,
                        CreateTime = DateTime.UtcNow
                    });
                }

                var existingCashTx = await _dbContext.CashAccountTransactions
                    .FirstOrDefaultAsync(x => x.ReferenceType == CashAccountTransactionReferenceType.Invoice && x.ReferenceId == purchase.Id, cancellationToken);

                if (existingCashTx != null)
                {
                    _dbContext.CashAccountTransactions.Remove(existingCashTx);
                }
            }
        }
        else
        {
            var existingCustLedger = await _dbContext.CustomerLedgerEntries
                .FirstOrDefaultAsync(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice 
                                          && x.ReferenceId == purchase.Id 
                                          && x.TransactionType == "İade Faturası", cancellationToken);
            if (existingCustLedger != null)
            {
                _dbContext.CustomerLedgerEntries.Remove(existingCustLedger);
            }

            var existingSupLedger = await _dbContext.SupplierLedgerEntries
                .FirstOrDefaultAsync(x => x.ReferenceType == SupplierLedgerEntryReferenceType.Invoice && x.ReferenceId == purchase.Id, cancellationToken);
            if (existingSupLedger != null)
            {
                _dbContext.SupplierLedgerEntries.Remove(existingSupLedger);
            }

            var existingCashTx = await _dbContext.CashAccountTransactions
                .FirstOrDefaultAsync(x => x.ReferenceType == CashAccountTransactionReferenceType.Invoice && x.ReferenceId == purchase.Id, cancellationToken);
            if (existingCashTx != null)
            {
                _dbContext.CashAccountTransactions.Remove(existingCashTx);
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        await UpsertInvoiceFromPurchase(purchase.Id, cancellationToken);
        return Ok(new { success = true });
    }

    [AtomicRequest]
    [HttpPut("{id:int}/header")]
    [AuthorizePage("invoice", "alisUstBilgiGuncelle")]
    public async Task<IActionResult> UpdateHeader([FromRoute] int id, [FromBody] UpdatePurchaseInvoiceHeaderRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var purchase = await _dbContext.Set<PurchaseInvoice>()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (purchase is null)
        {
            return NotFound(new { success = false, message = "Kayıt bulunamadı" });
        }

        var newDocumentNo = request.DocumentNo is null ? null : request.DocumentNo.Trim();
        if (newDocumentNo is not null && string.IsNullOrWhiteSpace(newDocumentNo)) newDocumentNo = null;

        var kind = request.Kind;

        // Tip yetkisi (2026-08-20): üst bilgiden tip DEĞİŞTİRİLEBİLİYOR; yetkisi olmayan
        // bir türe çevirmek, yetki kapısını dolanmanın en kolay yoluydu.
        if (await EnsurePurchaseKindAllowedAsync(kind, cancellationToken) is IActionResult headerKindDenied)
        {
            return headerKindDenied;
        }

        var supplierCode = string.IsNullOrWhiteSpace(request.SupplierCode) ? null : request.SupplierCode.Trim();
        var serviceCode = string.IsNullOrWhiteSpace(request.ServiceCode) ? null : request.ServiceCode.Trim();
        var customerCode = string.IsNullOrWhiteSpace(request.CustomerCode) ? null : request.CustomerCode.Trim();

        if (kind == PurchaseInvoiceKind.Purchase)
        {
            if (string.IsNullOrWhiteSpace(supplierCode))
            {
                return BadRequest(new { success = false, message = "Tedarikçi seçimi zorunlu" });
            }
        }
        else if (kind == PurchaseInvoiceKind.Service)
        {
            if (string.IsNullOrWhiteSpace(serviceCode))
            {
                return BadRequest(new { success = false, message = "Hizmet seçimi zorunlu" });
            }
        }
        else if (kind == PurchaseInvoiceKind.Return)
        {
            if (string.IsNullOrWhiteSpace(customerCode))
            {
                return BadRequest(new { success = false, message = "Cari seçimi zorunlu" });
            }

            var exists = await _dbContext.Customers
                .AsNoTracking()
                .AnyAsync(x => x.CustomerCode == customerCode, cancellationToken);

            if (!exists)
            {
                return BadRequest(new { success = false, message = "Geçersiz cari" });
            }
        }

        if (newDocumentNo is not null)
        {
            var exists = await _dbContext.Set<PurchaseInvoice>()
                .AsNoTracking()
                .AnyAsync(x => x.DocumentNo == newDocumentNo && x.Id != purchase.Id, cancellationToken);

            if (exists)
            {
                return Conflict(new { success = false, message = "Belge no zaten mevcut" });
            }
        }

        var previousDocumentNo = purchase.DocumentNo;
        var previousCustomerCode = purchase.CustomerCode;
        var shouldUpdateDocumentNo = newDocumentNo is not null && !string.Equals(previousDocumentNo, newDocumentNo, StringComparison.Ordinal);

        var newResolvedCustomerCode = kind == PurchaseInvoiceKind.Purchase
            ? supplierCode!
            : (kind == PurchaseInvoiceKind.Service || kind == PurchaseInvoiceKind.Return)
                ? customerCode!
                : string.Empty;

        var shouldUpdateResolvedCustomerCode = !string.Equals(previousCustomerCode ?? string.Empty, newResolvedCustomerCode, StringComparison.Ordinal);

        var username = User.Identity?.Name ?? "System";

        purchase.Kind = kind;
        purchase.SupplierCode = kind == PurchaseInvoiceKind.Purchase ? supplierCode : null;
        purchase.ServiceCode = kind == PurchaseInvoiceKind.Service ? serviceCode : null;
        purchase.CustomerCode = (kind == PurchaseInvoiceKind.Return || kind == PurchaseInvoiceKind.Service) ? customerCode : null;
        purchase.MuhtelifCustomerId = null;

        if (shouldUpdateDocumentNo)
        {
            purchase.DocumentNo = newDocumentNo!;
        }

        purchase.EditUser = username;
        purchase.EditTime = DateTime.UtcNow;

        // Sync the ledger entries representing the invoice itself if they exist
        await SyncPurchaseInvoiceLedgerEntryAsync(purchase, cancellationToken, previousDocumentNo);

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Sync the derived invoice so Fatura Döküm reflects header changes
        var invoice = await _dbContext.Set<Invoice>()
            .FirstOrDefaultAsync(x => x.SourcePurchaseInvoiceId == purchase.Id, cancellationToken);

        if (invoice is not null)
        {
            if (shouldUpdateDocumentNo)
            {
                invoice.InvoiceNo = purchase.DocumentNo;
            }

            if (shouldUpdateResolvedCustomerCode)
            {
                invoice.CustomerCode = newResolvedCustomerCode;
                invoice.DeliveryCustomerCode = newResolvedCustomerCode;

                if (kind == PurchaseInvoiceKind.Purchase)
                {
                    var supName = await _dbContext.Set<Supplier>()
                        .AsNoTracking()
                        .Where(x => x.SupplierCode == newResolvedCustomerCode)
                        .Select(x => x.FullName)
                        .FirstOrDefaultAsync(cancellationToken);

                    invoice.CustomerNameOverride = string.IsNullOrWhiteSpace(supName) ? null : supName;
                    invoice.CustomerInvoiceTypeOverride = "ACIK";
                }
                else if (kind == PurchaseInvoiceKind.Service)
                {
                    var custName = await _dbContext.Customers
                        .AsNoTracking()
                        .Where(x => x.CustomerCode == newResolvedCustomerCode)
                        .Select(x => x.Name)
                        .FirstOrDefaultAsync(cancellationToken);

                    invoice.CustomerNameOverride = string.IsNullOrWhiteSpace(custName) ? null : custName;
                    invoice.CustomerInvoiceTypeOverride = "ACIK";
                }
                else
                {
                    invoice.CustomerNameOverride = null;
                    var invType = await _dbContext.Customers
                        .AsNoTracking()
                        .Where(x => x.CustomerCode == newResolvedCustomerCode)
                        .Select(x => x.InvoiceType)
                        .FirstOrDefaultAsync(cancellationToken);

                    invoice.CustomerInvoiceTypeOverride = string.IsNullOrWhiteSpace(invType) ? null : invType;
                }
            }

            invoice.Type = kind == PurchaseInvoiceKind.Purchase
                ? InvoiceType.PurchaseInvoice
                : kind == PurchaseInvoiceKind.Service
                    ? InvoiceType.ServiceInvoice
                    : InvoiceType.ReturnInvoice;

            invoice.EditUser = username;
            invoice.EditTime = DateTime.UtcNow;

            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        // Sync stock movements: they are keyed by purchase DocumentNo and store the resolved customer code
        if (shouldUpdateDocumentNo || shouldUpdateResolvedCustomerCode)
        {
            var movements = await _dbContext.Set<StockMovement>()
                .Where(x => x.InvoiceNo == previousDocumentNo && x.Direction == StockMovementDirection.In)
                .ToListAsync(cancellationToken);

            foreach (var m in movements)
            {
                if (shouldUpdateDocumentNo) m.InvoiceNo = purchase.DocumentNo;
                if (shouldUpdateResolvedCustomerCode)
                {
                    m.CustomerCode = newResolvedCustomerCode;
                    m.DeliveryCustomerCode = newResolvedCustomerCode;
                }
                m.EditUser = username;
                m.EditTime = DateTime.UtcNow;
            }

            if (movements.Count > 0)
            {
                await _dbContext.SaveChangesAsync(cancellationToken);
            }
        }

        return Ok(new { success = true });
    }

    private async Task UpsertInvoiceFromPurchase(int purchaseInvoiceId, CancellationToken cancellationToken)
    {
        var purchase = await _dbContext.Set<PurchaseInvoice>()
            .Include(x => x.Lines)
                .ThenInclude(l => l.Product)
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == purchaseInvoiceId, cancellationToken);

        if (purchase is null) return;

        if (purchase.Kind == PurchaseInvoiceKind.Purchase && purchase.TerminStatus == PurchaseInvoiceTerminStatus.Waiting)
        {
            var existingInvoice = await _dbContext.Set<Invoice>()
                .FirstOrDefaultAsync(x => x.SourcePurchaseInvoiceId == purchaseInvoiceId, cancellationToken);

            if (existingInvoice is not null)
            {
                var linesToDelete = await _dbContext.Set<InvoiceLine>()
                    .Where(x => x.InvoiceId == existingInvoice.Id)
                    .ToListAsync(cancellationToken);

                if (linesToDelete.Count > 0)
                {
                    _dbContext.Set<InvoiceLine>().RemoveRange(linesToDelete);
                }

                _dbContext.Set<Invoice>().Remove(existingInvoice);
                await _dbContext.SaveChangesAsync(cancellationToken);
            }
            return;
        }

        var invoice = await _dbContext.Set<Invoice>()
            .FirstOrDefaultAsync(x => x.SourcePurchaseInvoiceId == purchaseInvoiceId, cancellationToken);

        var now = DateTime.UtcNow;
        var username = User.Identity?.Name ?? "System";

        var invoiceType = purchase.Kind == PurchaseInvoiceKind.Purchase
            ? InvoiceType.PurchaseInvoice
            : purchase.Kind == PurchaseInvoiceKind.Service
                ? InvoiceType.ServiceInvoice
                : InvoiceType.ReturnInvoice;

        string customerCode;
        string? customerNameOverride = null;
        string? invoiceTypeOverride = null;

        if (purchase.Kind == PurchaseInvoiceKind.Purchase)
        {
            customerCode = (purchase.SupplierCode ?? string.Empty).Trim();
            var sup = await _dbContext.Set<Supplier>()
                .AsNoTracking()
                .Where(x => x.SupplierCode == customerCode)
                .Select(x => x.FullName)
                .FirstOrDefaultAsync(cancellationToken);

            customerNameOverride = string.IsNullOrWhiteSpace(sup) ? null : sup;
            invoiceTypeOverride = "ACIK";
        }
        else if (purchase.Kind == PurchaseInvoiceKind.Service)
        {
            customerCode = (purchase.CustomerCode ?? string.Empty).Trim();
            var custName = await _dbContext.Customers
                .AsNoTracking()
                .Where(x => x.CustomerCode == customerCode)
                .Select(x => x.Name)
                .FirstOrDefaultAsync(cancellationToken);

            customerNameOverride = string.IsNullOrWhiteSpace(custName) ? null : custName;
            invoiceTypeOverride = "ACIK";
        }
        else
        {
            customerCode = (purchase.CustomerCode ?? string.Empty).Trim();
            var invType = await _dbContext.Customers
                .AsNoTracking()
                .Where(x => x.CustomerCode == customerCode)
                .Select(x => x.InvoiceType)
                .FirstOrDefaultAsync(cancellationToken);

            invoiceTypeOverride = string.IsNullOrWhiteSpace(invType) ? null : invType;
        }

        int targetCurrencyTypeId = 1;

        // ALIŞ FATURASININ KENDİ PARA BİRİMİ VE DONMUŞ KURU. Alış dalında para birimi TL'ye
        // sabitlenmişti: kalem fiyatı `PurchaseInvoiceLine.UnitPrice` BELGENİN parasında
        // tutuluyor (500 $), ama üretilen faturaya `UnitPrice = 500` TL ve `CurrencyTypeId = 1`
        // yazılıyordu. Yani 500 $'lık alış, türetilen faturada ve ondan beslenen her yerde
        // 500 ₺ oluyordu. Kur olarak GÜNCEL kur değil belgedeki DONMUŞ kur kullanılır —
        // fatura başlığı kuru zaten damgalıyor (2026-08-14 kararı).
        decimal? documentRate = null;
        if (purchase.Kind == PurchaseInvoiceKind.Return || purchase.Kind == PurchaseInvoiceKind.Service)
        {
            var cust = await _dbContext.Customers.AsNoTracking().FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);
            targetCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(cust?.CurrencyTypeId ?? 1);
        }
        else
        {
            targetCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(purchase.CurrencyTypeId);
            if (purchase.ExchangeRate > 0m) documentRate = purchase.ExchangeRate;
        }

        decimal subtotal = 0m;
        decimal discountTotal = 0m;
        decimal netTotal = 0m;
        decimal vatTotal = 0m;

        var newLines = new List<InvoiceLine>();
        var idx = 0;
        // Kur döngü içinde çözülüyor ama fatura BAŞLIĞINA da yazılması gerekiyor; bütün
        // kalemler aynı para birimini (carinin dövizi) kullandığı için tek değer yeterli.
        decimal invoiceRate = 1m;
        foreach (var l in purchase.Lines.OrderBy(x => x.LineNo))
        {
            /*
              FİYATIN KAYNAĞI `CurrencyUnitPrice` (2026-09-01 düzeltmesi).

              Burası `l.UnitPrice`ı alıp kurla çarpıyordu. Bu, 2026-08-29 öncesinin
              varsayımıydı: o zaman satır fiyatı belgenin KENDİ parasında tutuluyordu.
              Döviz damgası geldiğinden beri `UnitPrice` TL ÇAPASIDIR; kurla bir kez daha
              çarpmak ÇİFTE ÇEVRİMDİR.

              Canlıdaki sonuç: 211.475 $'lık teslimat faturası fatura dökümünde
              492.557.554,56 $ göründü (10.206.058 TL çapası x 48,2613).

              Doğru kaynak `CurrencyUnitPrice` — belgenin kendi parasındaki fiyat.
              Damgasız ESKİ satırlarda o alan 0'dır; orada `UnitPrice` zaten belgenin
              parasındadır ve eski davranış korunur.
            */
            var unitPrice = l.CurrencyUnitPrice > 0m ? l.CurrencyUnitPrice : l.UnitPrice;
            string? currencyStr = targetCurrencyTypeId switch
            {
                3 => "USD",
                2 => "EUR",
                4 => "GBP",
                _ => null
            };

            decimal rate = 1m;
            if (documentRate.HasValue)
            {
                // Belgenin donmuş kuru varsa güncel kur SORULMAZ: alış faturası geçmiş tarihli
                // olabilir ve bugünün kuruyla yeniden değerlemek belgeyi değiştirmek olurdu.
                rate = documentRate.Value;
            }
            else if (currencyStr != null)
            {
                try
                {
                    var fetchedRate = await _money.GetLatestTryRateAsync(currencyStr, cancellationToken);
                    if (fetchedRate > 0)
                    {
                        rate = fetchedRate;
                    }
                }
                catch
                {
                    // Fallback to 1m if MoneyService fails
                }
            }

            invoiceRate = rate;

            var tryUnitPrice = Math.Round(unitPrice * rate, 4);
            var qty = l.Quantity;
            var lineBase = qty * tryUnitPrice;

            decimal lineDiscount = 0m;
            if (l.DiscountType == PurchaseInvoiceLineDiscountType.Percentage)
            {
                lineDiscount = Math.Round((lineBase * l.DiscountValue) / 100m, 4);
            }
            else if (l.DiscountType == PurchaseInvoiceLineDiscountType.Amount)
            {
                // Tutar iskontosu ADET BAŞINADIR (bkz. PurchaseInvoiceMath.Satir) — qty ile
                // çarpılmazsa iskonto olması gerekenin 1/qty'si kadar düşer (2026-09-10).
                lineDiscount = Math.Round(l.DiscountValue * rate * qty, 4);
            }
            lineDiscount = Math.Min(lineDiscount, lineBase);

            var lineNet = lineBase - lineDiscount;
            var lineVatRate = purchase.VatExempt ? 0m : l.VatRate;
            var lineVat = Math.Round((lineNet * lineVatRate) / 100m, 4);

            subtotal += lineBase;
            discountTotal += lineDiscount;
            netTotal += lineNet;
            vatTotal += lineVat;

            newLines.Add(new InvoiceLine
            {
                SalesOrderLineId = null,
                SourcePurchaseInvoiceLineId = l.Id,
                StockCode = l.StockCode,
                Description = l.Description,
                Quantity = qty,
                UnitPrice = tryUnitPrice,
                CurrencyTypeId = targetCurrencyTypeId,
                CurrencyRate = rate,
                CurrencyUnitPrice = unitPrice,
                VatRate = lineVatRate,
                LineNo = idx + 1,
                CreateUser = username,
                CreateTime = now,
                EditUser = null,
                EditTime = null
            });
            idx++;
        }

        var grandTotal = netTotal + vatTotal;

        if (invoice is null)
        {
            invoice = new Invoice
            {
                Type = invoiceType,
                SourceCustomerOfferId = null,
                SourcePurchaseInvoiceId = purchaseInvoiceId,
                InvoiceNo = purchase.DocumentNo,
                CustomerCode = customerCode,
                CustomerNameOverride = customerNameOverride,
                CustomerInvoiceTypeOverride = invoiceTypeOverride,
                DeliveryCustomerCode = customerCode,
                Date = purchase.Date,
                VatIncluded = false,
                Subtotal = subtotal,
                Discount = discountTotal,
                NetTotal = netTotal,
                VatTotal = vatTotal,
                GrandTotal = grandTotal,
                // Para birimi ve alış anındaki kur başlıkta dondurulur (2026-08-14).
                CurrencyTypeId = targetCurrencyTypeId <= 1 ? 0 : targetCurrencyTypeId,
                ExchangeRate = targetCurrencyTypeId <= 1 ? 1m : (invoiceRate <= 0 ? 1m : invoiceRate),
                RateSource = targetCurrencyTypeId <= 1 ? null : "TCMB",
                CampaignDiscount = 0m,
                CampaignDetailsJson = null,
                SalesmanCode = purchase.SalesmanCode,
                Description = purchase.Description,
                InstallationName = null,
                InstallationPhone = null,
                CreateUser = username,
                CreateTime = now,
                EditUser = null,
                EditTime = null
            };

            _dbContext.Set<Invoice>().Add(invoice);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        else
        {
            invoice.Type = invoiceType;
            invoice.InvoiceNo = purchase.DocumentNo;
            invoice.CustomerCode = customerCode;
            invoice.CustomerNameOverride = customerNameOverride;
            invoice.CustomerInvoiceTypeOverride = invoiceTypeOverride;
            invoice.DeliveryCustomerCode = customerCode;
            invoice.Date = purchase.Date;
            invoice.Subtotal = subtotal;
            invoice.Discount = discountTotal;
            invoice.NetTotal = netTotal;
            invoice.VatTotal = vatTotal;
            invoice.GrandTotal = grandTotal;
            invoice.SalesmanCode = purchase.SalesmanCode;
            invoice.Description = purchase.Description;
            invoice.EditUser = username;
            invoice.EditTime = now;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        var existingLines = await _dbContext.Set<InvoiceLine>()
            .Where(x => x.InvoiceId == invoice.Id)
            .ToListAsync(cancellationToken);

        if (existingLines.Count > 0)
        {
            _dbContext.Set<InvoiceLine>().RemoveRange(existingLines);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        foreach (var nl in newLines)
        {
            nl.InvoiceId = invoice.Id;
        }

        if (newLines.Count > 0)
        {
            _dbContext.Set<InvoiceLine>().AddRange(newLines);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
    }

    [HttpPut("{id:int}/termin-status")]
    [AuthorizePage("invoice", "alisTermin")]
    [AuthorizePage("invoice", "terminDurumDegistir")]
    public async Task<IActionResult> UpdateTerminStatus([FromRoute] int id, [FromBody] UpdateTerminStatusRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var purchase = await _dbContext.Set<PurchaseInvoice>()
            .Include(x => x.Lines)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (purchase is null)
        {
            return NotFound(new { success = false, message = "Kayıt bulunamadı" });
        }

        if (purchase.Kind != PurchaseInvoiceKind.Purchase)
        {
            return BadRequest(new { success = false, message = "Sadece Alış tipli faturaların termin durumu güncellenebilir." });
        }

        var newStatus = (PurchaseInvoiceTerminStatus)request.Status;
        if (!Enum.IsDefined(typeof(PurchaseInvoiceTerminStatus), newStatus))
        {
            return BadRequest(new { success = false, message = "Geçersiz termin durumu." });
        }

        var oldStatus = purchase.TerminStatus;

        if (oldStatus != newStatus)
        {
            purchase.TerminStatus = newStatus;
            purchase.EditUser = User.Identity?.Name ?? "System";
            purchase.EditTime = DateTime.UtcNow;

            if (newStatus == PurchaseInvoiceTerminStatus.Delivered)
            {
                if (request.LineWarehouses == null || request.LineWarehouses.Count == 0)
                {
                    return BadRequest(new { success = false, message = "Teslim edilen fatura için depo seçimleri zorunludur." });
                }

                foreach (var lw in request.LineWarehouses)
                {
                    var line = purchase.Lines.FirstOrDefault(x => x.Id == lw.LineId);
                    if (line != null)
                    {
                        line.WarehouseCode = lw.WarehouseCode;
                        line.EditUser = User.Identity?.Name ?? "System";
                        line.EditTime = DateTime.UtcNow;
                    }
                }
            }
            else if (newStatus == PurchaseInvoiceTerminStatus.Waiting)
            {
                foreach (var line in purchase.Lines)
                {
                    line.WarehouseCode = null;
                    line.EditUser = User.Identity?.Name ?? "System";
                    line.EditTime = DateTime.UtcNow;
                }
            }

            await ReplaceStockMovementsForPurchaseInvoice(purchase, cancellationToken);
            await _dbContext.SaveChangesAsync(cancellationToken);

            /*
              EKSTRE SATIRI BURADA DOĞAR (2026-09-01).

              Alış, terminde beklerken ekstreye yazılmıyor (bkz. SyncPurchaseInvoiceLedgerEntryAsync).
              Mal "Teslim Edildi" olduğu an borç gerçekleşir ve satır yazılır; durum geri
              "Bekliyor"a alınırsa aynı metot satırı siler. Bu çağrı olmadan teslim edilen
              fatura ekstrede hiç görünmezdi.
            */
            await SyncPurchaseInvoiceLedgerEntryAsync(purchase, cancellationToken);
            await _dbContext.SaveChangesAsync(cancellationToken);

            await UpsertInvoiceFromPurchase(purchase.Id, cancellationToken);
        }

        return Ok(new { success = true });
    }

    [HttpPut("{id:int}/estimated-arrival-date")]
    [AuthorizePage("invoice", "alisTermin")]
    [AuthorizePage("invoice", "terminDurumDegistir")]
    public async Task<IActionResult> UpdateEstimatedArrivalDate([FromRoute] int id, [FromBody] UpdateEstimatedArrivalDateRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var purchase = await _dbContext.Set<PurchaseInvoice>()
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (purchase is null)
        {
            return NotFound(new { success = false, message = "Kayıt bulunamadı" });
        }

        if (purchase.Kind != PurchaseInvoiceKind.Purchase)
        {
            return BadRequest(new { success = false, message = "Sadece Alış tipli faturaların tahmini geliş tarihi güncellenebilir." });
        }

        if (purchase.TerminStatus != PurchaseInvoiceTerminStatus.Waiting)
        {
            return BadRequest(new { success = false, message = "Sadece durumu 'Bekliyor' olan terminlerin tahmini geliş tarihi güncellenebilir." });
        }

        var arrivalDate = request.EstimatedArrivalDate;
        if (arrivalDate.HasValue)
        {
            var date = arrivalDate.Value.Kind == DateTimeKind.Utc ? arrivalDate.Value : DateTime.SpecifyKind(arrivalDate.Value, DateTimeKind.Utc);
            if (date.Date < purchase.Date.Date)
            {
                return BadRequest(new { success = false, message = "Tahmini geliş tarihi, termin tarihinden önce olamaz." });
            }
            purchase.EstimatedArrivalDate = date;
        }
        else
        {
            purchase.EstimatedArrivalDate = null;
        }

        purchase.EditUser = User.Identity?.Name ?? "System";
        purchase.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }

    /// <summary>
    /// Bir siparişin TESLİMAT GEÇMİŞİ (2026-08-29 kullanıcı isteği: "kısmi teslim seçince
    /// ne kadarı hangi stoğa girdi gösterecek").
    ///
    /// Siparişten bölünmüş bütün partileri, kalem kırılımıyla döndürür: hangi üründen ne
    /// kadar, hangi depoya, hangi birim fiyat ve kurla girdiği. Bağ `SplitFromPurchaseInvoiceId`
    /// üzerinden kurulur; açıklama metnine bakılmaz.
    /// </summary>
    [HttpGet("{id:int}/teslimat-gecmisi")]
    [AuthorizePage("invoice", "alisTermin")]
    public async Task<IActionResult> TeslimatGecmisi([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var partiler = await _dbContext.Set<PurchaseInvoice>()
            .AsNoTracking()
            .Include(x => x.Lines).ThenInclude(l => l.Product)
            .Where(x => x.SplitFromPurchaseInvoiceId == id)
            .OrderBy(x => x.CreateTime)
            .ToListAsync(cancellationToken);

        var depoAdlari = await _dbContext.Set<Warehouse>()
            .AsNoTracking()
            .Select(x => new { x.WarehouseCode, x.Name })
            .ToDictionaryAsync(x => x.WarehouseCode, x => x.Name, cancellationToken);

        var sonuc = partiler.Select(p => new
        {
            id = p.Id,
            documentNo = p.DocumentNo,
            date = p.Date,
            createTime = p.CreateTime,
            createUser = p.CreateUser,
            currencyTypeId = p.CurrencyTypeId,
            exchangeRate = p.ExchangeRate,
            rateSource = p.RateSource,
            grandTotal = p.GrandTotal,
            lines = p.Lines.OrderBy(l => l.LineNo).Select(l => new
            {
                stockCode = l.StockCode,
                // Ürün adı satırda tutulmuyor; ürün kartından okunur, yoksa stok kodu yazar.
                stockName = l.Product != null ? l.Product.Name : l.StockCode,
                quantity = l.Quantity,
                warehouseCode = l.WarehouseCode,
                warehouseName = l.WarehouseCode.HasValue && depoAdlari.TryGetValue(l.WarehouseCode.Value, out var wn) ? wn : null,
                unitPrice = l.UnitPrice,
                currencyUnitPrice = l.CurrencyUnitPrice > 0m ? l.CurrencyUnitPrice : l.UnitPrice
            }).ToList()
        }).ToList();

        return Ok(new { success = true, data = sonuc });
    }

    [AtomicRequest]
    [HttpPost("{id:int}/kismi-teslim")]
    [AuthorizePage("invoice", "alisTermin")]
    [AuthorizePage("invoice", "terminDurumDegistir")]
    public async Task<IActionResult> KismiTeslim([FromRoute] int id, [FromBody] KismiTeslimRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);
        if (request.Items == null || request.Items.Count == 0)
        {
            return BadRequest(new { success = false, message = "Teslim edilen ürün miktar bilgisi gönderilmelidir." });
        }

        var original = await _dbContext.Set<PurchaseInvoice>()
            .Include(x => x.Lines)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (original is null)
        {
            return NotFound(new { success = false, message = "Kayıt bulunamadı" });
        }

        if (original.Kind != PurchaseInvoiceKind.Purchase)
        {
            return BadRequest(new { success = false, message = "Sadece Alış tipli faturalar için kısmi teslimat yapılabilir." });
        }

        if (original.TerminStatus != PurchaseInvoiceTerminStatus.Waiting)
        {
            return BadRequest(new { success = false, message = "Sadece 'Bekliyor' durumundaki faturalar kısmi teslim edilebilir." });
        }

        // Validate quantities
        var originalLinesMap = original.Lines.ToDictionary(l => l.Id);
        decimal totalDelivered = 0m;
        bool isFullDelivery = true;

        foreach (var item in request.Items)
        {
            if (item.DeliveredQuantity < 0m)
            {
                return BadRequest(new { success = false, message = "Teslim edilen miktar negatif olamaz." });
            }

            if (item.DeliveredQuantity > 0m)
            {
                if (!originalLinesMap.TryGetValue(item.LineId, out var line))
                {
                    return BadRequest(new { success = false, message = $"Faturaya ait olmayan lineId: {item.LineId}" });
                }

                if (item.DeliveredQuantity > line.Quantity)
                {
                    return BadRequest(new { success = false, message = $"{line.StockCode} ürünü için teslim edilen miktar kalan miktardan ({line.Quantity}) fazla olamaz." });
                }

                if (!item.WarehouseCode.HasValue || item.WarehouseCode.Value <= 0)
                {
                    return BadRequest(new { success = false, message = $"{line.StockCode} ürünü için depo seçimi zorunludur." });
                }

                totalDelivered += item.DeliveredQuantity;
            }
        }

        // "Kalanı dahil et" işaretliyse miktarlar AŞAĞIDA kalanın tamamına çekilecek; burada
        // sıfır olmaları normaldir. Bu kontrol o durumda çalışırsa kullanıcı hiçbir şey
        // yazmadan kalanı teslim alamaz.
        if (totalDelivered <= 0m && !request.IncludeRemainder)
        {
            return BadRequest(new { success = false, message = "Teslim edilen toplam miktar 0'dan büyük olmalıdır." });
        }

        /*
          KALANI DA BU TESLİMATA DAHİL ET (2026-08-29).

          İşaretliyse sipariş tümüyle teslim alınmış sayılır: her satırın miktarı kalanın
          tamamına çekilir, bölme yapılmaz, siparişte bekleyen mal kalmaz. Kullanıcı "geri
          kalan malları o faturaya dahil edebileceğiz" derken bunu istedi.

          Depo bilgisi ZORUNLU kalır — mal bir yere girmek zorunda. İstekte olmayan satır
          varsa hata verilir; sessizce varsayılan depo seçmek stoğu yanlış yere yazardı.
        */
        if (request.IncludeRemainder)
        {
            foreach (var line in original.Lines)
            {
                var item = request.Items.FirstOrDefault(x => x.LineId == line.Id);
                if (item == null)
                {
                    return BadRequest(new { success = false, message = $"Kalan dahil edilecekse {line.StockCode} satırı da gönderilmelidir (depo seçimi gerekli)." });
                }
                if (!item.WarehouseCode.HasValue || item.WarehouseCode.Value <= 0)
                {
                    return BadRequest(new { success = false, message = $"{line.StockCode} ürünü için depo seçimi zorunludur." });
                }
                item.DeliveredQuantity = line.Quantity;
            }
        }

        // Check if it's a full delivery
        foreach (var line in original.Lines)
        {
            var reqItem = request.Items.FirstOrDefault(x => x.LineId == line.Id);
            var deliveredQty = reqItem?.DeliveredQuantity ?? 0m;
            if (deliveredQty != line.Quantity)
            {
                isFullDelivery = false;
            }
        }

        var username = User.Identity?.Name ?? "System";

        /*
          MEVCUT FATURAYA EKLEME, TAM TESLİMDE DE GEÇERLİDİR (2026-08-30 kullanıcı bildirimi:
          "faturaya dahil et dememe rağmen etmedi, ayrı ayrı yaptı").

          `isFullDelivery` dalı aşağıda ERKEN DÖNÜYOR ve birleştirme mantığına hiç ulaşmıyordu.
          Kullanıcı kalanın tamamını teslim alıp "mevcuda ekle" seçtiğinde seçim sessizce yok
          sayılıyor, sipariş olduğu yerde kapanıyordu.

          Belge numarası verilmişse tam teslim de BÖLME/EKLEME yolundan geçmeli: mal fiziken
          o irsaliyeyle geldi ve o faturaya yazılmalı.
        */
        var birlestirmeIstendi = !string.IsNullOrWhiteSpace(request.DocumentNo);
        if (birlestirmeIstendi)
        {
            isFullDelivery = false;
        }

        /*
          PARTİNİN KENDİ DÖVİZİ, KURU VE FİYATLARI (2026-08-29 kullanıcı isteği).

          Kısmi teslimat bugüne kadar siparişin para birimini, kurunu ve fiyatlarını AYNEN
          kopyalıyordu. Gerçek hayatta her parti farklı gelebiliyor: ikinci sevkiyat başka
          kurla, başka birim fiyatla gelir. Artık istekte gelen değerler bu partiye uygulanır;
          gelmezse siparişinki kullanılır (eski davranış birebir korunur).

          Fiyatlar TESLİMATIN para birimindedir; TL çapası partinin KENDİ kuruyla türetilir.
          Böylece her partinin maliyeti kendi faturasında donar.
        */
        var teslimDoviz = request.CurrencyTypeId.HasValue
                          && B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsKnown(request.CurrencyTypeId.Value)
            ? B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(request.CurrencyTypeId.Value)
            : original.CurrencyTypeId;

        var kurElleGeldi = request.ExchangeRate.HasValue && request.ExchangeRate.Value > 0m;
        var teslimKur = kurElleGeldi
            ? decimal.Round(request.ExchangeRate!.Value, 4, MidpointRounding.AwayFromZero)
            : (original.ExchangeRate <= 0m ? 1m : original.ExchangeRate);
        var teslimKurKaynak = kurElleGeldi
            ? "Manuel"
            : (string.IsNullOrWhiteSpace(original.RateSource) ? "TCMB" : original.RateSource);

        // Partinin belge para birimindeki birim fiyatı: istekte varsa o, yoksa siparişteki.
        decimal BelgeFiyati(KismiTeslimLineRequest item, PurchaseInvoiceLine ol)
            => item.UnitPrice.HasValue && item.UnitPrice.Value >= 0m
                ? item.UnitPrice.Value
                : (ol.CurrencyUnitPrice > 0m ? ol.CurrencyUnitPrice : ol.UnitPrice);

        // TL çapası: partinin KENDİ kuruyla. Günün kuruyla değil — parti maliyeti donmalı.
        decimal TlFiyati(decimal belgeFiyati)
            => B2B.Erp.Api.Core.Accounting.PurchaseInvoiceMath.TlCapasi(belgeFiyati, teslimDoviz, teslimKur);

        if (isFullDelivery)
        {
            original.TerminStatus = PurchaseInvoiceTerminStatus.Delivered;
            original.EditUser = username;
            original.EditTime = DateTime.UtcNow;

            // Tam teslimde de partinin dövizi/kuru ve düzeltilen fiyatlar geçerlidir:
            // sipariş tek seferde kapanıyor olsa bile mal başka fiyata gelmiş olabilir.
            original.CurrencyTypeId = teslimDoviz;
            original.ExchangeRate = teslimKur;
            original.RateSource = teslimKurKaynak;

            foreach (var item in request.Items)
            {
                var line = original.Lines.FirstOrDefault(x => x.Id == item.LineId);
                if (line != null)
                {
                    line.WarehouseCode = item.WarehouseCode;
                    var bf = BelgeFiyati(item, line);
                    line.CurrencyUnitPrice = bf;
                    line.UnitPrice = TlFiyati(bf);
                    line.EditUser = username;
                    line.EditTime = DateTime.UtcNow;
                }
            }

            await ApplyTotalsAsync(original, cancellationToken);

            await ReplaceStockMovementsForPurchaseInvoice(original, cancellationToken);
            await _dbContext.SaveChangesAsync(cancellationToken);

            /*
              TEDARİKÇİ DEFTERİ BU DALDA HİÇ SENKRONLANMIYORDU (2026-08-30 kullanıcı bildirimi:
              "kısmi teslimde fiyatı güncelledim olmamıştı").

              Tam teslim dalı fiyatları ve toplamları güncelliyor ama defteri güncellemiyordu.
              Eskiden zararsızdı çünkü bu dalda fiyat DEĞİŞMİYORDU — yalnızca depo yazılıp
              durum "Teslim Edildi" yapılıyordu. Parti fiyatı düzenlenebilir hale gelince
              (2026-08-29) hata açığa çıktı: fatura 25.000'e güncellendi, defter 7.500'de kaldı.

              Canlı kanıt (ALDENE): fatura EditTime 19:20:05, defter EditTime 19:19:25 —
              yani düzenleme deftere hiç ulaşmamıştı.

              Bölme ve birleştirme dalları bu çağrıyı zaten yapıyordu; eksik olan tek dal buydu.
            */
            await SyncPurchaseInvoiceLedgerEntryAsync(original, cancellationToken);
            await _dbContext.SaveChangesAsync(cancellationToken);

            await UpsertInvoiceFromPurchase(original.Id, cancellationToken);

            return Ok(new { success = true, fullyDelivered = true });
        }

        /*
          BELGE NUMARASI ELLE GİRİLEBİLİR — VARSA O FATURAYA EKLENİR (2026-08-29).

          Kullanıcı kararı: "mükerrer olursa bu var deyip o faturaya atacak, ama fiyat farklıysa
          söyleyecek, ayrı bir kalem gibi atacak." Yani numara çakışması HATA DEĞİL, birleştirme
          işaretidir — aynı irsaliye numarasına birden fazla sevkiyat gelmesi olağandır.

          Birleştirme kuralı aşağıda `mevcutTeslimat` dalında; eşleşme ürün + FİYAT üzerinden
          yapılır. Fiyat farklıysa miktar toplanmaz, yeni kalem açılır ve kullanıcı uyarılır.
        */
        var istenenDocNo = (request.DocumentNo ?? string.Empty).Trim();
        PurchaseInvoice? mevcutTeslimat = null;

        if (!string.IsNullOrWhiteSpace(istenenDocNo))
        {
            mevcutTeslimat = await _dbContext.Set<PurchaseInvoice>()
                .Include(x => x.Lines)
                .FirstOrDefaultAsync(x => x.DocumentNo == istenenDocNo, cancellationToken);

            if (mevcutTeslimat != null)
            {
                if (mevcutTeslimat.Id == original.Id)
                {
                    return BadRequest(new { success = false, message = "Teslimat belge numarası siparişin kendi numarasıyla aynı olamaz." });
                }
                if (mevcutTeslimat.Kind != PurchaseInvoiceKind.Purchase)
                {
                    return BadRequest(new { success = false, message = $"{istenenDocNo} numaralı belge alış faturası değil; teslimat oraya eklenemez." });
                }
                var mevcutTedarikci = (mevcutTeslimat.SupplierCode ?? string.Empty).Trim();
                var siparisTedarikci = (original.SupplierCode ?? string.Empty).Trim();
                if (!string.Equals(mevcutTedarikci, siparisTedarikci, StringComparison.OrdinalIgnoreCase))
                {
                    return BadRequest(new { success = false, message = $"{istenenDocNo} numaralı belge BAŞKA bir tedarikçiye ait; teslimat oraya eklenemez." });
                }
            }
        }

        var newDocNo = !string.IsNullOrWhiteSpace(istenenDocNo)
            ? istenenDocNo
            : await GenerateUniqueDocumentNo(cancellationToken);
        /*
          MEVCUT FATURAYA EKLEME DALI.

          Aynı ürün + AYNI FİYAT → miktar mevcut kaleme eklenir.
          Aynı ürün + FARKLI FİYAT → yeni kalem açılır ve kullanıcı uyarılır (fiyatlar
          birleştirilirse partinin gerçek maliyeti kaybolur; ikisi ayrı durmalı).

          Depo da eşleşme ölçütüdür: aynı fiyatlı mal farklı depoya girdiyse ayrı kalem
          olmalı, yoksa stok hangi depoya girdi bilinemez.
        */
        if (mevcutTeslimat != null)
        {
            var uyarilar = new List<string>();
            var sonrakiLineNo = mevcutTeslimat.Lines.Count == 0 ? 1 : mevcutTeslimat.Lines.Max(x => x.LineNo) + 1;

            foreach (var item in request.Items)
            {
                if (item.DeliveredQuantity <= 0m) continue;
                var ol = originalLinesMap[item.LineId];
                var bf = BelgeFiyati(item, ol);
                var tl = TlFiyati(bf);

                var esles = mevcutTeslimat.Lines.FirstOrDefault(x =>
                    x.ProductId == ol.ProductId
                    && x.WarehouseCode == item.WarehouseCode
                    && Math.Abs((x.CurrencyUnitPrice > 0m ? x.CurrencyUnitPrice : x.UnitPrice) - bf) < 0.0001m);

                if (esles != null)
                {
                    esles.Quantity += item.DeliveredQuantity;
                    esles.EditUser = username;
                    esles.EditTime = DateTime.UtcNow;
                    continue;
                }

                var ayniUrunFarkliFiyat = mevcutTeslimat.Lines.Any(x => x.ProductId == ol.ProductId);
                if (ayniUrunFarkliFiyat)
                {
                    uyarilar.Add($"{ol.StockCode}: fiyat/depo farklı olduğu için ayrı kalem olarak eklendi.");
                }

                mevcutTeslimat.Lines.Add(new PurchaseInvoiceLine
                {
                    PurchaseInvoiceId = mevcutTeslimat.Id,
                    ProductId = ol.ProductId,
                    StockCode = ol.StockCode,
                    WarehouseCode = item.WarehouseCode,
                    Description = ol.Description,
                    Quantity = item.DeliveredQuantity,
                    CurrencyUnitPrice = bf,
                    UnitPrice = tl,
                    VatRate = ol.VatRate,
                    DiscountType = ol.DiscountType,
                    DiscountValue = ol.DiscountValue,
                    DeliveryStatus = PurchaseInvoiceLineDeliveryStatus.Delivered,
                    DeliveryTeam = ol.DeliveryTeam,
                    DeliveryDispatchDate = ol.DeliveryDispatchDate,
                    DeliveryCompletedDate = DateTime.UtcNow,
                    LineNo = sonrakiLineNo++,
                    CreateUser = username,
                    CreateTime = DateTime.UtcNow
                });
            }

            // Siparişten düş
            foreach (var item in request.Items)
            {
                if (item.DeliveredQuantity <= 0m) continue;
                var ol = originalLinesMap[item.LineId];
                ol.Quantity -= item.DeliveredQuantity;
                ol.EditUser = username;
                ol.EditTime = DateTime.UtcNow;
            }
            foreach (var l in original.Lines.Where(l => l.Quantity <= 0m).ToList())
            {
                original.Lines.Remove(l);
                _dbContext.Set<PurchaseInvoiceLine>().Remove(l);
            }

            // Mevcut faturaya ilk kez bu siparişten mal ekleniyorsa bağ kurulur.
            /*
              SİPARİŞTE MAL KALMADIYSA ARTIK BEKLEMİYOR (2026-08-30).

              Tam teslim de artık bölme/ekleme yolundan geçebiliyor (belge no verildiğinde).
              O durumda siparişin bütün satırları düşüyor ve geriye boş bir kayıt kalıyor.
              Durumu "Bekliyor" bırakmak yanlış olurdu: bekleyen mal yok.
            */
            if (original.Lines.Count == 0)
            {
                original.TerminStatus = PurchaseInvoiceTerminStatus.Delivered;
            }

            mevcutTeslimat.SplitFromPurchaseInvoiceId ??= original.Id;
            mevcutTeslimat.EditUser = username;
            mevcutTeslimat.EditTime = DateTime.UtcNow;

            await ApplyTotalsAsync(mevcutTeslimat, cancellationToken);
            await ApplyTotalsAsync(original, cancellationToken);
            original.EditUser = username;
            original.EditTime = DateTime.UtcNow;

            await _dbContext.SaveChangesAsync(cancellationToken);

            await SyncPurchaseInvoiceLedgerEntryAsync(mevcutTeslimat, cancellationToken);
            await SyncPurchaseInvoiceLedgerEntryAsync(original, cancellationToken);
            await _dbContext.SaveChangesAsync(cancellationToken);

            // Stok hareketleri YENİDEN kurulur: miktar değiştiği için eskiler geçersiz.
            await ReplaceStockMovementsForPurchaseInvoice(mevcutTeslimat, cancellationToken);
            await _dbContext.SaveChangesAsync(cancellationToken);

            await UpsertInvoiceFromPurchase(mevcutTeslimat.Id, cancellationToken);
            await UpsertInvoiceFromPurchase(original.Id, cancellationToken);

            return Ok(new
            {
                success = true,
                fullyDelivered = false,
                mergedIntoInvoiceId = mevcutTeslimat.Id,
                documentNo = mevcutTeslimat.DocumentNo,
                warnings = uyarilar,
                message = uyarilar.Count > 0
                    ? $"Teslimat {mevcutTeslimat.DocumentNo} numaralı faturaya eklendi. " + string.Join(" ", uyarilar)
                    : $"Teslimat {mevcutTeslimat.DocumentNo} numaralı mevcut faturaya eklendi."
            });
        }

        var deliveredInvoice = new PurchaseInvoice
        {
            DocumentNo = newDocNo,
            Date = original.Date,
            Kind = original.Kind,
            SupplierCode = original.SupplierCode,
            ServiceCode = original.ServiceCode,
            CustomerCode = original.CustomerCode,
            MuhtelifCustomerId = original.MuhtelifCustomerId,
            VatExempt = original.VatExempt,
            Approved = original.Approved,
            TerminStatus = PurchaseInvoiceTerminStatus.Delivered,
            // BELGENİN PARASI VE DONMUŞ KURU KOPYALANMALI. Kopyalanmadığında bölünen fatura
            // varsayılan TL (CurrencyTypeId = 0, kur 1) doğuyordu: 10.000 $'lık siparişten
            // teslim alınan 5.000 $, stok maliyetine ve tedarikçi ekstresine 5.000 ₺ olarak
            // giriyordu. Kısmi teslimat faturayı BÖLER, para birimini değiştirmez.
            // Partinin KENDİ dövizi/kuru (istekte gelmediyse siparişinki).
            CurrencyTypeId = teslimDoviz,
            ExchangeRate = teslimKur,
            RateSource = teslimKurKaynak,
            // Teslimat geçmişi bu bağdan okunuyor; açıklama metnine güvenilmiyor.
            SplitFromPurchaseInvoiceId = original.Id,
            SalesmanCode = original.SalesmanCode,
            Description = string.IsNullOrWhiteSpace(original.Description)
                ? $"Kısmi Teslimat - {original.DocumentNo}"
                : $"{original.Description} (Kısmi Teslimat - {original.DocumentNo})",
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        };

        var deliveredLines = new List<PurchaseInvoiceLine>();
        var lineNo = 1;

        foreach (var item in request.Items)
        {
            if (item.DeliveredQuantity <= 0m) continue;
            var originalLine = originalLinesMap[item.LineId];

            deliveredLines.Add(new PurchaseInvoiceLine
            {
                PurchaseInvoice = deliveredInvoice,
                ProductId = originalLine.ProductId,
                StockCode = originalLine.StockCode,
                WarehouseCode = item.WarehouseCode,
                Description = originalLine.Description,
                Quantity = item.DeliveredQuantity,
                CurrencyUnitPrice = BelgeFiyati(item, originalLine),
                UnitPrice = TlFiyati(BelgeFiyati(item, originalLine)),
                VatRate = originalLine.VatRate,
                DiscountType = originalLine.DiscountType,
                DiscountValue = originalLine.DiscountValue,
                DeliveryStatus = PurchaseInvoiceLineDeliveryStatus.Delivered,
                DeliveryTeam = originalLine.DeliveryTeam,
                DeliveryDispatchDate = originalLine.DeliveryDispatchDate,
                DeliveryCompletedDate = DateTime.UtcNow,
                LineNo = lineNo++,
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            });
        }

        deliveredInvoice.Lines = deliveredLines;
        await ApplyTotalsAsync(deliveredInvoice, cancellationToken);

        _dbContext.Set<PurchaseInvoice>().Add(deliveredInvoice);

        // Reduce quantities on original invoice
        foreach (var item in request.Items)
        {
            if (item.DeliveredQuantity <= 0m) continue;
            var originalLine = originalLinesMap[item.LineId];
            originalLine.Quantity -= item.DeliveredQuantity;
            originalLine.EditUser = username;
            originalLine.EditTime = DateTime.UtcNow;
        }

        // Delete original lines with 0 quantity
        var linesToDelete = original.Lines.Where(l => l.Quantity <= 0m).ToList();
        foreach (var l in linesToDelete)
        {
            original.Lines.Remove(l);
            _dbContext.Set<PurchaseInvoiceLine>().Remove(l);
        }

        // Siparişte mal kalmadıysa artık beklemiyor (bkz. birleştirme dalındaki açıklama).
        if (original.Lines.Count == 0)
        {
            original.TerminStatus = PurchaseInvoiceTerminStatus.Delivered;
        }

        // Recalculate original totals
        await ApplyTotalsAsync(original, cancellationToken);
        original.EditUser = username;
        original.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Update original ledger entry total
        await SyncPurchaseInvoiceLedgerEntryAsync(original, cancellationToken);

        // Add ledger entry for the new delivered invoice
        var supCode = (deliveredInvoice.SupplierCode ?? string.Empty).Trim();
        if (!string.IsNullOrWhiteSpace(supCode))
        {
            await SyncPurchaseInvoiceLedgerEntryAsync(deliveredInvoice, cancellationToken);
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Generate stock movements for new delivered invoice
        var movements = BuildStockMovementsForPurchaseInvoice(deliveredInvoice);
        if (movements.Count > 0)
        {
            _dbContext.Set<StockMovement>().AddRange(movements);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        // Sync new delivered invoice to Invoice
        await UpsertInvoiceFromPurchase(deliveredInvoice.Id, cancellationToken);

        // Sync original invoice to Invoice (making sure no Invoice exists for it as it's still Waiting)
        await UpsertInvoiceFromPurchase(original.Id, cancellationToken);

        return Ok(new { success = true, fullyDelivered = false, newInvoiceId = deliveredInvoice.Id, newDocumentNo = deliveredInvoice.DocumentNo });
    }

    /*
      İADE — KAYNAK FATURADAN OTOMATİK DOLDURMA (2026-10-14 kullanıcı isteği: "iade seçildiğinde
      fatura dökümünden fatura seçip satırları otomatik doldurabilelim; ne kadardan aldıysa ona
      göre ayarlansın; seçilen fatura aynı kalacak").

      İki uç da YALNIZ OKUR: seçilen satış faturasına, satırlarına ve fatura dökümüne hiçbir şey
      yazılmaz. Ekran dönen satırları iade taslağına koyar; kullanıcı silip ekleyebilir, kayıt
      her zamanki iade yolundan geçer.

      FİYAT = MÜŞTERİNİN ÖDEDİĞİ NET BİRİM. Satış faturasında indirim/kampanya satırda değil
      başlıkta duruyor (Subtotal − indirimler = NetTotal); satırın liste fiyatıyla iade almak
      müşteriye fazla ödeme yapmak olurdu. Başlıktaki oran (NetTotal / Subtotal) satırlara
      dağıtılır; fiyat faturanın KENDİ para biriminde döner (CurrencyUnitPrice).
    */
    private static readonly InvoiceType[] ReturnSourceTypes = { InvoiceType.SalesInvoice, InvoiceType.ServiceInvoice };

    [HttpGet("return-sources")]
    [AuthorizePage("invoice", "alisTipIade")]
    public async Task<IActionResult> ReturnSources([FromQuery] string? customerCode, [FromQuery] string? q, CancellationToken cancellationToken)
    {
        var code = (customerCode ?? string.Empty).Trim();
        if (code.Length == 0) return BadRequest(new { success = false, message = "Cari kodu zorunlu" });

        // Fatura alt hesaplara (-1/-2/-3) kesilir; ana cari seçilse de hepsi listelenir.
        var codes = await _customerAccountService.GetRelatedCustomerCodesForLedgerAsync(code, cancellationToken);
        if (!codes.Contains(code, StringComparer.OrdinalIgnoreCase)) codes.Add(code);

        var query = _dbContext.Invoices
            .AsNoTracking()
            .Where(x => ReturnSourceTypes.Contains(x.Type) && codes.Contains(x.CustomerCode));

        var term = (q ?? string.Empty).Trim();
        if (term.Length > 0)
        {
            query = query.Where(x => x.InvoiceNo.Contains(term));
        }

        var data = await query
            .OrderByDescending(x => x.Date)
            .ThenByDescending(x => x.Id)
            .Take(200)
            .Select(x => new
            {
                id = x.Id,
                invoiceNo = x.InvoiceNo,
                date = x.Date,
                customerCode = x.CustomerCode,
                currencyTypeId = x.CurrencyTypeId,
                grandTotal = x.GrandTotal,
                lineCount = _dbContext.InvoiceLines.Count(l => l.InvoiceId == x.Id)
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [HttpGet("return-sources/{invoiceId:int}/lines")]
    [AuthorizePage("invoice", "alisTipIade")]
    public async Task<IActionResult> ReturnSourceLines([FromRoute] int invoiceId, CancellationToken cancellationToken)
    {
        var inv = await _dbContext.Invoices
            .AsNoTracking()
            .Where(x => x.Id == invoiceId && ReturnSourceTypes.Contains(x.Type))
            .Select(x => new { x.Id, x.InvoiceNo, x.CustomerCode, x.CurrencyTypeId, x.ExchangeRate, x.Subtotal, x.NetTotal })
            .FirstOrDefaultAsync(cancellationToken);
        if (inv is null) return NotFound(new { success = false, message = "Fatura bulunamadı" });

        var ratio = inv.Subtotal > 0m && inv.NetTotal > 0m && inv.NetTotal <= inv.Subtotal
            ? inv.NetTotal / inv.Subtotal
            : 1m;

        var lines = await _dbContext.InvoiceLines
            .AsNoTracking()
            .Where(x => x.InvoiceId == invoiceId)
            .OrderBy(x => x.LineNo)
            .ThenBy(x => x.Id)
            .Select(x => new { x.StockCode, x.Description, x.Quantity, x.UnitPrice, x.CurrencyUnitPrice, x.CurrencyTypeId, x.CurrencyRate, x.VatRate, x.WarehouseCode })
            .ToListAsync(cancellationToken);

        /*
          PARA BİRİMİ SATIRDAN VE KURDAN (2026-10-14 canlı bildirim: "fiyatlar neden euro geldi").
          Başlıktaki CurrencyTypeId eski faturalarda satırlardan AYRIŞABİLİYOR (bkz. fatura tek döviz
          kuralı); TL satırlı bir fatura başlıkta EUR görünüyordu ve iade TL tutarları € diye
          dolduruyordu. Kural: satır gerçekten dövizliyse (kod > 1 VE gerçek bir kur > 1,5 VE döviz
          fiyatı dolu) o dövizle; bütün satırlar AYNI dövizde değilse ya da şüpheliyse TL çapası
          (UnitPrice) ile TL döner. TL çapası her satırda her zaman geçerlidir.
        */
        int LineCurrency(int lineCur, decimal lineRate, decimal lineCurPrice)
        {
            var cur = lineCur > 0 ? lineCur : inv.CurrencyTypeId;
            var rate = lineRate > 0m ? lineRate : inv.ExchangeRate;
            return cur > 1 && rate > 1.5m && lineCurPrice > 0m ? cur : 1;
        }
        var lineCurrencies = lines.Where(x => x.Quantity > 0m)
            .Select(x => LineCurrency(x.CurrencyTypeId, x.CurrencyRate, x.CurrencyUnitPrice))
            .Distinct()
            .ToList();
        var docCurrency = lineCurrencies.Count == 1 ? lineCurrencies[0] : 1;

        var stockCodes = lines.Select(x => x.StockCode).Distinct().ToList();
        var products = (await _dbContext.Products
                .AsNoTracking()
                .Where(p => stockCodes.Contains(p.StockCode))
                .Select(p => new { p.Id, p.StockCode, p.Name })
                .ToListAsync(cancellationToken))
            .GroupBy(p => p.StockCode, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        var data = lines
            .Where(x => x.Quantity > 0m)
            .Select(x =>
            {
                var unit = docCurrency > 1 ? x.CurrencyUnitPrice : x.UnitPrice;
                products.TryGetValue(x.StockCode, out var prod);
                return new
                {
                    productId = prod?.Id.ToString(),
                    stockCode = x.StockCode,
                    stockName = prod?.Name ?? x.Description ?? x.StockCode,
                    quantity = x.Quantity,
                    listUnitPrice = unit,
                    netUnitPrice = Math.Round(unit * ratio, 4, MidpointRounding.AwayFromZero),
                    vatRate = x.VatRate,
                    warehouseCode = x.WarehouseCode
                };
            })
            .ToList();

        return Ok(new
        {
            success = true,
            data = new
            {
                invoiceId = inv.Id,
                invoiceNo = inv.InvoiceNo,
                customerCode = inv.CustomerCode,
                currencyTypeId = docCurrency,
                discountRatio = ratio,
                lines = data
            }
        });
    }

    [HttpDelete("{id:int}")]
    [AuthorizePage("invoice", "alisSil")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var invoice = await _dbContext.Set<PurchaseInvoice>()
            .Include(x => x.Lines)
            .Include(x => x.MuhtelifCustomer)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (invoice is null)
        {
            return NotFound(new { success = false, message = "Kayıt bulunamadı" });
        }

        // Tip yetkisi (2026-08-20): göremediğin türü silemezsin. Silme yalnız `alisSil` ile
        // korunuyordu; listede hiç görünmeyen bir hizmet faturası kimliği bilinerek
        // silinebiliyordu.
        if (await EnsurePurchaseKindAllowedAsync(invoice.Kind, cancellationToken) is IActionResult deleteKindDenied)
        {
            return deleteKindDenied;
        }

        if (!await this.CanDeleteRecordAsync(_dbContext, invoice, cancellationToken))
        {
            return BadRequest(new { success = false, message = "Sadece kendi oluşturduğunuz işlemleri silebilirsiniz." });
        }

        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var roleIdClaim = User.Claims.FirstOrDefault(c => string.Equals(c.Type, "RoleId", StringComparison.OrdinalIgnoreCase))?.Value;
        if (!isSsa && !isSuperAdmin && int.TryParse(roleIdClaim, out var roleId))
        {
            var hasRestriction = await _dbContext.RolePagePermissions
                .AsNoTracking()
                .AnyAsync(rpp => rpp.RoleId == roleId && rpp.CanAccess && rpp.Page.ModuleKey == "deleteRule" && rpp.Page.Key == "deleteRule/alis", cancellationToken);
            if (hasRestriction && DateTime.UtcNow - invoice.CreateTime > TimeSpan.FromDays(1))
            {
                /*
                  MESAJ NEDEN BU KADAR UZUN (2026-08-24).

                  Eskiden yalnızca "Bu kayıt silinemez" yazıyordu ve kullanıcı sebebini
                  bulamıyordu: kural bir HATA gibi görünüyor, oysa rolüne bilerek konmuş bir
                  kısıt. Üstelik kısıt TERS okunuyor — Rol Yetkileri'nde "Silme Kuralı →
                  Alış Faturaları" kutusu İŞARETLİYSE silme kısıtlanır, işaretli değilse
                  serbesttir. Bu ters mantık, mesajda söylenmediğinde kimsenin kendi başına
                  çözemeyeceği bir şey.
                */
                var gunSayisi = (int)Math.Floor((DateTime.UtcNow - invoice.CreateTime).TotalDays);
                return BadRequest(new
                {
                    success = false,
                    message =
                        $"Bu fatura {gunSayisi} gün önce oluşturulmuş. Rolünüzde " +
                        "\"Silme Kuralı → Alış Faturaları\" kısıtı açık olduğu için yalnızca " +
                        "son 1 gün içinde oluşturulan alış faturaları silinebilir. " +
                        "Kısıtı Ayarlar → Rol Yetkileri'nden kaldırabilirsiniz.",
                });
            }
        }

        var backupData = new
        {
            invoice.DocumentNo,
            invoice.Date,
            invoice.Kind,
            invoice.TerminStatus,
            invoice.SupplierCode,
            invoice.ServiceCode,
            invoice.CustomerCode,
            invoice.VatExempt,
            invoice.Approved,
            invoice.Subtotal,
            invoice.DiscountTotal,
            invoice.NetTotal,
            invoice.VatTotal,
            invoice.GrandTotal,
            // Toplamlar faturanın KENDİ para birimindedir; para birimi ve donmuş kur olmadan
            // silme kaydındaki rakamların ne anlama geldiği okunamaz. (Aynı boşluk satış
            // faturasının silme yedeğinde de vardı.)
            invoice.CurrencyTypeId,
            invoice.ExchangeRate,
            invoice.SalesmanCode,
            invoice.Description,
            invoice.CreateUser,
            invoice.CreateTime,
            MuhtelifCustomer = invoice.MuhtelifCustomer != null ? new
            {
                invoice.MuhtelifCustomer.OwnerCustomerCode,
                invoice.MuhtelifCustomer.CustomerCode,
                invoice.MuhtelifCustomer.Name,
                invoice.MuhtelifCustomer.City,
                invoice.MuhtelifCustomer.District,
                invoice.MuhtelifCustomer.Address,
                invoice.MuhtelifCustomer.Phone,
                invoice.MuhtelifCustomer.Email,
                invoice.MuhtelifCustomer.TaxOffice,
                invoice.MuhtelifCustomer.TaxNumber,
                invoice.MuhtelifCustomer.CreateUser,
                invoice.MuhtelifCustomer.CreateTime
            } : null,
            Lines = invoice.Lines.Select(l => new
            {
                l.ProductId,
                l.StockCode,
                l.WarehouseCode,
                l.Description,
                l.Quantity,
                l.UnitPrice,
                l.VatRate,
                l.DiscountType,
                l.DiscountValue,
                l.DeliveryStatus,
                l.DeliveryTeam,
                l.DeliveryDispatchDate,
                l.DeliveryCompletedDate,
                l.LineNo,
                l.CreateUser,
                l.CreateTime
            }).ToList()
        };

        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        var impactNote = invoice.Kind == PurchaseInvoiceKind.Purchase
            ? " [Etki: Alış Faturası silindiği için ilgili ürünlerin stok miktarları düştü. İlişkili cari/satıcı hareketleri silindi.]"
            : " [Etki: Hizmet/İade Alış Faturası silindi. İlişkili cari/satıcı hareketleri silindi.]";

        _dbContext.Set<DeletionLog>().Add(new DeletionLog
        {
            ModuleKey = "invoice",
            PageKey = "alisSil",
            RecordType = "PurchaseInvoice",
            RecordId = invoice.Id.ToString(),
            ParentType = null,
            ParentId = null,
            Description = $"Alış faturası silindi: {invoice.DocumentNo}.{impactNote}",
            DetailsJson = JsonSerializer.Serialize(backupData),
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        });

        await DeleteStockMovementsForPurchaseInvoice(invoice, cancellationToken);

        var linkedInvoice = await _dbContext.Set<Invoice>()
            .FirstOrDefaultAsync(x => x.SourcePurchaseInvoiceId == id, cancellationToken);

        if (linkedInvoice is not null)
        {
            var lines = await _dbContext.Set<InvoiceLine>()
                .Where(x => x.InvoiceId == linkedInvoice.Id)
                .ToListAsync(cancellationToken);

            if (lines.Count > 0)
            {
                _dbContext.Set<InvoiceLine>().RemoveRange(lines);
            }

            // Clean up associated payment ledger entries, cash/bank transactions
            //
            // AÇIKLAMA METNİNDE ARAMA KALDIRILDI. Eskiden bu dört sorgu
            // `Description.Contains(InvoiceNo)` de diyordu: fatura numarası kısa ya da başka bir
            // numaranın ÖN EKİ olduğunda ("12", "FAT-1", "AL2508161" ⊂ "AL25081612"), açıklamasında
            // o metin geçen ALAKASIZ kasa/banka hareketleri, personel ödemeleri ve başka carilerin
            // tahsilatları da faturayla birlikte kalıcı olarak siliniyordu. Bağ artık yalnız
            // referans (ReferenceType + ReferenceId) ve TAM belge numarası eşitliğiyle kuruluyor;
            // metin benzerliği bir bağ değildir.
            var linkedLedgerEntries = await _dbContext.CustomerLedgerEntries
                .Where(x => (x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice && x.ReferenceId == linkedInvoice.Id)
                            || (!string.IsNullOrEmpty(x.DocumentNo) && x.DocumentNo == linkedInvoice.InvoiceNo))
                .ToListAsync(cancellationToken);
            if (linkedLedgerEntries.Count > 0)
            {
                _dbContext.CustomerLedgerEntries.RemoveRange(linkedLedgerEntries);
            }

            var linkedCashTx = await _dbContext.CashAccountTransactions
                .Where(x => (x.ReferenceType == CashAccountTransactionReferenceType.Invoice && x.ReferenceId == linkedInvoice.Id)
                            || (!string.IsNullOrEmpty(x.DocumentNo) && x.DocumentNo == linkedInvoice.InvoiceNo))
                .ToListAsync(cancellationToken);
            if (linkedCashTx.Count > 0)
            {
                _dbContext.CashAccountTransactions.RemoveRange(linkedCashTx);
            }

            if (!string.IsNullOrWhiteSpace(linkedInvoice.InvoiceNo))
            {
                var linkedBankTx = await _dbContext.BankAccountTransactions
                    .Where(x => x.DocumentNo == linkedInvoice.InvoiceNo)
                    .ToListAsync(cancellationToken);
                if (linkedBankTx.Count > 0)
                {
                    _dbContext.BankAccountTransactions.RemoveRange(linkedBankTx);
                }

                var linkedSupplierEntries = await _dbContext.SupplierLedgerEntries
                    .Where(x => x.DocumentNo == linkedInvoice.InvoiceNo
                                || (x.ReferenceType == SupplierLedgerEntryReferenceType.Invoice && x.ReferenceId == linkedInvoice.Id))
                    .ToListAsync(cancellationToken);
                if (linkedSupplierEntries.Count > 0)
                {
                    _dbContext.SupplierLedgerEntries.RemoveRange(linkedSupplierEntries);
                }
            }

            _dbContext.Set<Invoice>().Remove(linkedInvoice);
        }

        // Remove ledger entries — BELGE NO KAPISI (bkz. satır ~1202).
        //
        // `Invoices` (satış) ve `PurchaseInvoices` (alış) cari deftere AYNI `ReferenceType`
        // ile yazıyor ama id dizileri AYRI: iki tabloda da aynı numaralı kayıt var. Yalnız
        // `ReferenceId`ye bakan bu silme, aynı id'li BİR SATIŞ faturasının ekstre satırını
        // buluyor ve siliyordu. Canlı kanıt: 2026-09-08 11:40 EZKOC alış faturası 131'i
        // (No 17547) silince, satış faturası 131'in (100000000000046 / EMİNE KILINÇ 15.400)
        // ekstre satırı DeletionLog bile bırakmadan kayboldu; müşteri 15.399,50 alacaklı
        // göründü. Bu alış faturasının kendi defter satırı `DocumentNo == purchase.DocumentNo`
        // taşır (bkz. satır 1242); belge no tutmayan satır bu faturaya ait değildir.
        var existingCustLedgers = await _dbContext.CustomerLedgerEntries
            .Where(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice
                        && x.ReferenceId == invoice.Id
                        && x.DocumentNo == invoice.DocumentNo)
            .ToListAsync(cancellationToken);
        if (existingCustLedgers.Count > 0)
        {
            _dbContext.CustomerLedgerEntries.RemoveRange(existingCustLedgers);
        }

        var existingSupLedger = await _dbContext.SupplierLedgerEntries
            .FirstOrDefaultAsync(x => x.ReferenceType == SupplierLedgerEntryReferenceType.Invoice && x.ReferenceId == invoice.Id, cancellationToken);
        if (existingSupLedger != null)
        {
            _dbContext.SupplierLedgerEntries.Remove(existingSupLedger);
        }

        _dbContext.Set<PurchaseInvoice>().Remove(invoice);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }

    private async Task<string> GenerateUniqueDocumentNo(CancellationToken cancellationToken)
    {
        var localNow = DateTime.UtcNow.AddHours(3);
        var no = "AL" + localNow.ToString("yyddMMHHmmss");
        
        var exists = await _dbContext.Set<PurchaseInvoice>()
            .AsNoTracking()
            .AnyAsync(x => x.DocumentNo == no, cancellationToken);
            
        if (!exists) return no;
        
        for (var i = 1; i <= 10; i++)
        {
            var altNo = "AL" + localNow.AddSeconds(i).ToString("yyddMMHHmmss");
            var altExists = await _dbContext.Set<PurchaseInvoice>()
                .AsNoTracking()
                .AnyAsync(x => x.DocumentNo == altNo, cancellationToken);
            if (!altExists) return altNo;
        }
        
        return no;
    }

    private static string GenerateRandomDigits(int length)
    {
        Span<byte> bytes = stackalloc byte[length];
        RandomNumberGenerator.Fill(bytes);
        var chars = new char[length];
        for (var i = 0; i < length; i++)
        {
            chars[i] = (char)('0' + (bytes[i] % 10));
        }
        return new string(chars);
    }

    private async Task ApplyTotalsAsync(PurchaseInvoice invoice, CancellationToken cancellationToken)
    {
        // Eager load products to a temporary local dictionary if not loaded
        var missingProductIds = invoice.Lines
            .Where(l => l.ProductId.HasValue && l.Product == null)
            .Select(l => l.ProductId!.Value)
            .Distinct()
            .ToList();

        var productsMap = new Dictionary<Guid, Product>();
        if (missingProductIds.Count > 0)
        {
            productsMap = await _dbContext.Set<Product>()
                .AsNoTracking()
                .Where(x => missingProductIds.Contains(x.Id))
                .ToDictionaryAsync(x => x.Id, cancellationToken);
        }

        // Helper to resolve product currency code without attaching navigation properties
        int GetCurrencyCode(PurchaseInvoiceLine line)
        {
            if (line.Product != null)
            {
                return line.Product.CurrencyCode;
            }
            if (line.ProductId.HasValue && productsMap.TryGetValue(line.ProductId.Value, out var prod))
            {
                return prod.CurrencyCode;
            }
            return 0;
        }

        decimal subtotal = 0m;
        decimal discountTotal = 0m;
        decimal netTotal = 0m;
        decimal vatTotal = 0m;

        /*
          BEYAN EDİLMİŞ DÖVİZ VARSA TOPLAMLAR TL ÇAPASINDAN HESAPLANIR (2026-08-29).

          Aşağıdaki eski yol para birimini HER SATIRIN ÜRÜN KARTINDAN okuyor, her satır için
          ayrı kur çekiyor ve satırı önce TL'ye sonra "hedef" para birimine çeviriyor. Üç sorun:

            1. Belgenin para birimi kullanıcının beyanı değil, ürün kartlarının rastlantısı
               oluyordu. Karışık dövizli satırlarda "TL varsa TL, yoksa ilk satırın dövizi"
               gibi bir kural devreye giriyordu — belge no "1" (Id 50) tam olarak böyle
               oluştu: 5 satır $, 2 satır ₺.
            2. Kur KAYIT ANINDA yeniden çekiliyordu. Fatura düzenlendiğinde o günün kuru
               uygulanıp geçmiş maliyet kayıyordu.
            3. Başlık toplamı ile kalem toplamı tutmuyordu (denetim B3 bulgusu), çünkü başlık
               çevrilmiş, kalem çevrilmemiş değerden geliyordu.

          Yeni kayıtlarda `UnitPrice` zaten TL ÇAPASIDIR — belgenin KENDİ kuruyla, kaydedildiği
          anda hesaplanmış olarak durur. Dolayısıyla toplam düz toplamdır; çevrim yok, kur
          çekme yok, satırla başlık birebir tutar.

          Eski kayıtlarda `CurrencyTypeId` damgalanmamıştır (0); onlar aşağıdaki eski yoldan
          geçmeye devam eder. Elde başka bilgi yok, davranışlarını değiştirmek geçmişi bozar.
        */
        if (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsKnown(invoice.CurrencyTypeId))
        {
            foreach (var l in invoice.Lines.OrderBy(x => x.LineNo))
            {
                // Hesap TEK KAYNAKTAN: PurchaseInvoiceMath.Satir — birim testi var.
                var sonuc = B2B.Erp.Api.Core.Accounting.PurchaseInvoiceMath.Satir(
                    l.Quantity,
                    l.UnitPrice,
                    l.DiscountType switch
                    {
                        PurchaseInvoiceLineDiscountType.Amount => B2B.Erp.Api.Core.Accounting.PurchaseInvoiceMath.IskontoTipi.Tutar,
                        PurchaseInvoiceLineDiscountType.Percentage => B2B.Erp.Api.Core.Accounting.PurchaseInvoiceMath.IskontoTipi.Yuzde,
                        _ => B2B.Erp.Api.Core.Accounting.PurchaseInvoiceMath.IskontoTipi.Yok
                    },
                    l.DiscountValue,
                    invoice.CurrencyTypeId,
                    invoice.ExchangeRate,
                    l.VatRate,
                    invoice.VatExempt);

                subtotal += sonuc.Brut;
                discountTotal += sonuc.Iskonto;
                netTotal += sonuc.Net;
                vatTotal += sonuc.Kdv;
            }

            invoice.Subtotal = Math.Max(0m, Math.Round(subtotal, 4));
            invoice.DiscountTotal = Math.Max(0m, Math.Round(discountTotal, 4));
            invoice.NetTotal = Math.Max(0m, Math.Round(netTotal, 4));
            invoice.VatTotal = Math.Max(0m, Math.Round(vatTotal, 4));
            invoice.GrandTotal = invoice.VatExempt ? invoice.NetTotal : invoice.NetTotal + invoice.VatTotal;
            return;
        }

        // Determine target currency of the invoice
        int targetCurrency = 0; // Default TRY
        if (invoice.Kind == PurchaseInvoiceKind.Return || invoice.Kind == PurchaseInvoiceKind.Service)
        {
            var custCode = (invoice.CustomerCode ?? string.Empty).Trim();
            if (!string.IsNullOrWhiteSpace(custCode))
            {
                var customer = await _dbContext.Customers
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.CustomerCode == custCode, cancellationToken);
                var targetCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(customer?.CurrencyTypeId ?? 1);
                targetCurrency = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Normalize(targetCurrencyTypeId);
            }
        }
        else
        {
            var currencies = new HashSet<int>();
            foreach (var l in invoice.Lines)
            {
                currencies.Add(GetCurrencyCode(l));
            }

            if (currencies.Count == 1)
            {
                targetCurrency = currencies.First();
            }
            else if (currencies.Count > 1)
            {
                // If TRY is present, convert to TRY
                if (currencies.Contains(0))
                {
                    targetCurrency = 0;
                }
                else
                {
                    // If no TRY, return first line currency
                    var firstLine = invoice.Lines.OrderBy(x => x.LineNo).FirstOrDefault();
                    targetCurrency = firstLine != null ? GetCurrencyCode(firstLine) : 0;
                }
            }
        }

        string? targetCurrencyStr = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Normalize(targetCurrency) switch
        {
            B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Usd => "USD",
            B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Eur => "EUR",
            B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Gbp => "GBP",
            _ => null
        };

        decimal targetRate = 1m;
        if (targetCurrencyStr != null)
        {
            try
            {
                var rate = await _money.GetLatestTryRateAsync(targetCurrencyStr, cancellationToken);
                if (rate > 0) targetRate = rate;
            }
            catch { }
        }

        foreach (var l in invoice.Lines.OrderBy(x => x.LineNo))
        {
            var qty = l.Quantity;
            var originalPrice = l.UnitPrice;
            var productCurrencyCode = GetCurrencyCode(l);
            string? sourceCurrencyStr = B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Normalize(productCurrencyCode) switch
            {
                B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Usd => "USD",
                B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Eur => "EUR",
                B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.Gbp => "GBP",
                _ => null
            };

            decimal sourceRate = 1m;
            if (invoice.Kind == PurchaseInvoiceKind.Return || invoice.Kind == PurchaseInvoiceKind.Service)
            {
                sourceRate = targetRate;
            }
            else if (sourceCurrencyStr != null)
            {
                try
                {
                    var rate = await _money.GetLatestTryRateAsync(sourceCurrencyStr, cancellationToken);
                    if (rate > 0) sourceRate = rate;
                }
                catch { }
            }

            // Convert original price to TRY first
            var tryPrice = originalPrice * sourceRate;

            // Convert TRY price to target currency
            var price = targetRate > 0m ? tryPrice / targetRate : 0m;

            var baseTotal = qty * price;
            var disc = 0m;
            if (l.DiscountType == PurchaseInvoiceLineDiscountType.Amount)
            {
                // Convert discount value (in original currency) to target currency.
                // Tutar iskontosu ADET BAŞINADIR — qty ile çarpılmazsa iskonto olması
                // gerekenin 1/qty'si kadar düşer (2026-09-10, PurchaseInvoiceMath.Satir ile aynı hata).
                var tryDiscVal = l.DiscountValue * sourceRate * qty;
                var targetDiscVal = targetRate > 0m ? tryDiscVal / targetRate : 0m;
                disc = Math.Max(0m, targetDiscVal);
            }
            if (l.DiscountType == PurchaseInvoiceLineDiscountType.Percentage)
            {
                disc = Math.Max(0m, (baseTotal * l.DiscountValue) / 100m);
            }
            if (disc > baseTotal) disc = baseTotal;

            var net = baseTotal - disc;
            var vat = invoice.VatExempt ? 0m : (net * l.VatRate) / 100m;

            subtotal += baseTotal;
            discountTotal += disc;
            netTotal += net;
            vatTotal += vat;
        }

        invoice.Subtotal = Math.Max(0m, Math.Round(subtotal, 4));
        invoice.DiscountTotal = Math.Max(0m, Math.Round(discountTotal, 4));
        invoice.NetTotal = Math.Max(0m, Math.Round(netTotal, 4));
        invoice.VatTotal = Math.Max(0m, Math.Round(vatTotal, 4));
        invoice.GrandTotal = invoice.VatExempt ? invoice.NetTotal : invoice.NetTotal + invoice.VatTotal;
    }

    private static DateTime? NormalizeUtc(DateTime? value)
    {
        if (!value.HasValue) return null;

        var v = value.Value;
        if (v.Kind == DateTimeKind.Utc) return v;

        if (v.Kind == DateTimeKind.Local)
        {
            return v.ToUniversalTime();
        }

        return DateTime.SpecifyKind(v, DateTimeKind.Utc);
    }

    private List<StockMovement> BuildStockMovementsForPurchaseInvoice(PurchaseInvoice invoice)
    {
        if (invoice.Kind == PurchaseInvoiceKind.Purchase && invoice.TerminStatus == PurchaseInvoiceTerminStatus.Waiting)
        {
            return new List<StockMovement>();
        }

        var docNo = (invoice.DocumentNo ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(docNo)) return new List<StockMovement>();

        var customerCode = (invoice.CustomerCode ?? string.Empty).Trim();
        var date = invoice.Date.Kind == DateTimeKind.Utc ? invoice.Date : DateTime.SpecifyKind(invoice.Date, DateTimeKind.Utc);

        var username = User.Identity?.Name ?? "System";
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        // STOK HAREKETİ TL'DİR. `StockMovement`'ta para birimi kolonu YOK — tasarım gereği
        // TL çapasıdır. Alış faturasının satır fiyatı ise faturanın KENDİ para birimindedir,
        // dolayısıyla ham yazmak 500 $'lık girişi stok kaydına 500 ₺ olarak düşürüyordu.
        // Kur artık başlıkta donmuş durumda (`ExchangeRate`), o kullanılıyor.
        var stockRate = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(invoice.CurrencyTypeId)
            ? 1m
            : (invoice.ExchangeRate <= 0m ? 1m : invoice.ExchangeRate);

        var movements = new List<StockMovement>();
        foreach (var l in invoice.Lines.OrderBy(x => x.LineNo))
        {
            /*
              HİZMET SATIRI ENVANTERİ HAREKET ETTİRMEZ (2026-09-18).

              Alış faturasına nakliye/işçilik gibi hizmet bedeli satırı eklenebiliyor. O satırın
              stok girişi yazması, olmayan bir malı depoya sokardı: stok adedi ve stok değeri
              ikisi birden şişerdi. Nitelik satıra kesim anında damgalanıyor
              (`AppDbContext.StampPurchaseInvoiceLineNaturesAsync`), burada yeniden
              hesaplanmıyor — kart sonradan silinse bile geçmiş belge yerinde kalsın.

              Depo kodu boş satır zaten aşağıda eleniyor; bu kontrol ONA GÜVENMİYOR, çünkü
              ekranda yanlışlıkla depo seçilmiş bir hizmet satırı sessizce stok yazardı.
            */
            if (l.Nature == B2B.Erp.Api.Core.Accounting.InvoiceLineNature.Service) continue;

            if (!l.WarehouseCode.HasValue) continue;

            var qty = l.Quantity;
            /*
              STOK MALİYETİ DE `CurrencyUnitPrice`TEN TÜRER (2026-09-01 düzeltmesi).

              Yukarıdaki `UpsertInvoiceFromPurchase` ile AYNI hata buradaydı: `l.UnitPrice`
              TL çapası olduğu hâlde bir kez daha kurla çarpılıyordu. Dövizli alışta stok
              maliyeti kur katı şişiyordu (117,50 $ ürün 273.674 ₺ maliyetle giriyordu,
              doğrusu 5.670,70 ₺).

              İndirim (`DiscountValue`) belgenin para biriminde SAKLANIYOR (bkz. Create:
              ham yazılıyor), o yüzden onun kurla çarpımı DOĞRU — dokunulmadı.
            */
            var belgeFiyati = l.CurrencyUnitPrice > 0m ? l.CurrencyUnitPrice : l.UnitPrice;
            var unitPrice = belgeFiyati * stockRate;

            var baseTotal = qty * unitPrice;
            var disc = 0m;
            // Tutar iskontosu ADET BAŞINADIR — qty ile çarpılmazsa stok maliyeti (netUnitPrice)
            // olması gerekenden yüksek çıkar (2026-09-10, PurchaseInvoiceMath.Satir ile aynı hata).
            if (l.DiscountType == PurchaseInvoiceLineDiscountType.Amount) disc = Math.Max(0m, l.DiscountValue * stockRate * qty);
            if (l.DiscountType == PurchaseInvoiceLineDiscountType.Percentage) disc = Math.Max(0m, (baseTotal * l.DiscountValue) / 100m);
            if (disc > baseTotal) disc = baseTotal;

            var netTotal = baseTotal - disc;
            var netUnitPrice = qty == 0m ? unitPrice : netTotal / qty;

            movements.Add(new StockMovement
            {
                InvoiceNo = docNo,
                CustomerCode = customerCode,
                DeliveryCustomerCode = customerCode,
                StockCode = l.StockCode,
                Direction = StockMovementDirection.In,
                Quantity = qty,
                UnitPrice = unitPrice,
                // `unitPrice` yukarıda kurla TL'ye çevrildi; belgenin kendi parası ham
                // satır fiyatıdır (2026-08-19).
                CurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(invoice.CurrencyTypeId),
                CurrencyRate = stockRate <= 0m ? 1m : stockRate,
                CurrencyUnitPrice = l.UnitPrice,
                NetUnitPrice = netUnitPrice,
                VatRate = l.VatRate,
                BagNo = string.Empty,
                SalesmanCode = invoice.SalesmanCode,
                WarehouseCode = l.WarehouseCode.Value,
                Delivered = true,
                Date = date,
                LineNo = l.LineNo,
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            });
        }

        return movements;
    }

    private async Task ReplaceStockMovementsForPurchaseInvoice(PurchaseInvoice invoice, CancellationToken cancellationToken, string? previousDocumentNo = null)
    {
        await DeleteStockMovementsForPurchaseInvoice(invoice, cancellationToken, previousDocumentNo);

        var movements = BuildStockMovementsForPurchaseInvoice(invoice);
        if (movements.Count > 0)
        {
            _dbContext.Set<StockMovement>().AddRange(movements);
        }
    }

    private async Task DeleteStockMovementsForPurchaseInvoice(PurchaseInvoice invoice, CancellationToken cancellationToken, string? previousDocumentNo = null)
    {
        var docNo = (invoice.DocumentNo ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(docNo)) return;

        // Belge no değiştiyse stok girişleri hâlâ ESKİ numarayla duruyor; yalnız yenisiyle
        // aranırsa silinmez ve yeniden yazılanlarla birlikte stok İKİ KEZ girer.
        // `DocumentNo` tekil olduğu için eski numara başka bir alış faturasına ait olamaz.
        var prevNo = (previousDocumentNo ?? string.Empty).Trim();
        if (prevNo.Length == 0) prevNo = docNo;

        var existing = await _dbContext.Set<StockMovement>()
            .Where(x => (x.InvoiceNo == docNo || x.InvoiceNo == prevNo) && x.Direction == StockMovementDirection.In)
            .ToListAsync(cancellationToken);

        if (existing.Count > 0)
        {
            _dbContext.Set<StockMovement>().RemoveRange(existing);
        }
    }

    /// <param name="previousDocumentNo">
    /// BELGE NO DEĞİŞİKLİĞİNDE ÇİFT CARİ SATIRI (2026-09-24, canlı: CEMREM TURİZM, HZ260907092752E →
    /// 5767, 178.500 TL iki kez alacak). Çağıranlar numarayı DEĞİŞTİRDİKTEN sonra buraya geliyor;
    /// mevcut satır belge no kapısıyla (bkz. 2026-08-22 notu) YENİ numarayla aranınca bulunamıyor,
    /// ikinci satır ekleniyor, eskisi sahipsiz kalıyordu. Eski numara da aranır — ama yalnız
    /// alış/iade satırlarında; yoksa aynı Id'li bir satış faturasının satırı yine yakalanabilirdi.
    /// </param>
    private async Task SyncPurchaseInvoiceLedgerEntryAsync(PurchaseInvoice entity, CancellationToken cancellationToken, string? previousDocumentNo = null)
    {
        var prevNo = string.IsNullOrWhiteSpace(previousDocumentNo) ? entity.DocumentNo : previousDocumentNo.Trim();
        var username = User.Identity?.Name ?? "System";

        if (entity.Kind == PurchaseInvoiceKind.Service || entity.Kind == PurchaseInvoiceKind.Return)
        {
            var existingSup = await _dbContext.SupplierLedgerEntries
                .FirstOrDefaultAsync(x => x.ReferenceType == SupplierLedgerEntryReferenceType.Invoice && x.ReferenceId == entity.Id, cancellationToken);
            if (existingSup != null)
            {
                _dbContext.SupplierLedgerEntries.Remove(existingSup);
            }

            var custCode = (entity.CustomerCode ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(custCode)) return;

            // İade bir MAL hareketidir: ekstre satırı carinin tipine göre -1/-2/-3'e yazılır.
            var ledgerCustomerCode = await ResolveGoodsLedgerCustomerCodeAsync(entity, custCode, cancellationToken);

            var existingCust = await _dbContext.CustomerLedgerEntries
                .FirstOrDefaultAsync(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice
                                              && x.ReferenceId == entity.Id
                                              && (x.DocumentNo == entity.DocumentNo
                                                  || (x.DocumentNo == prevNo
                                                      && (x.TransactionType == "Alış Faturası" || x.TransactionType == "İade Faturası"))),
                                         cancellationToken);

            var usdRate = await _money.GetLatestTryRateAsync("USD", cancellationToken);
            var eurRate = await _money.GetLatestTryRateAsync("EUR", cancellationToken);
            var gbpRate = await _money.GetLatestTryRateAsync("GBP", cancellationToken);

            var customer = await _dbContext.Customers
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.CustomerCode == custCode, cancellationToken);
            var targetCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(customer?.CurrencyTypeId ?? 1);

            var entryRate = targetCurrencyTypeId switch
            {
                3 => usdRate,
                2 => eurRate,
                4 => gbpRate,
                _ => 1m
            };

            // Faturanın kendi para birimi başlıkta duruyor; TL çapası ve carinin karşılığı
            // tek yerden üretiliyor (bkz. ConvertPurchaseTotalForLedger).
            var (entryAmount, entryCurrencyAmount) = ConvertPurchaseTotalForLedger(
                entity.GrandTotal,
                entity.CurrencyTypeId,
                PickRate(entity.CurrencyTypeId, usdRate, eurRate, gbpRate),
                targetCurrencyTypeId,
                entryRate);

            var direction = CustomerLedgerEntryDirection.Credit;
            var desc = entity.Kind == PurchaseInvoiceKind.Return
                ? $"İade Faturası ({entity.DocumentNo})"
                : "Faturamız";

            var txType = entity.Kind == PurchaseInvoiceKind.Return
                ? "İade Faturası"
                : "Alış Faturası";

            if (existingCust != null)
            {
                existingCust.CustomerCode = ledgerCustomerCode;
                existingCust.Date = entity.Date;
                existingCust.DueDate = entity.Date;
                existingCust.Direction = direction;
                existingCust.Amount = entryAmount;
                // Para birimi TİPİ de güncellenir: tutar ve kur carinin GÜNCEL dövizinden
                // hesaplanıyordu ama tip ilk yazımdaki değerde kalıyordu — cari TL'den USD'ye
                // çevrildiğinde satır "dolar tutar, TL etiket" olarak donuyordu.
                existingCust.CurrencyTypeId = targetCurrencyTypeId;
                existingCust.CurrencyRate = entryRate <= 0 ? 1m : entryRate;
                existingCust.CurrencyAmount = entryCurrencyAmount;
                existingCust.DocumentNo = entity.DocumentNo;
                existingCust.Description = desc;
                existingCust.EditUser = username;
                existingCust.EditTime = DateTime.UtcNow;
                _dbContext.CustomerLedgerEntries.Update(existingCust);
            }
            else
            {
                _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
                {
                    CustomerCode = ledgerCustomerCode,
                    Date = entity.Date,
                    DueDate = entity.Date,
                    Direction = direction,
                    Amount = entryAmount,
                    CurrencyTypeId = targetCurrencyTypeId,
                    CurrencyRate = entryRate <= 0 ? 1m : entryRate,
                    CurrencyAmount = entryCurrencyAmount,
                    DocumentNo = entity.DocumentNo,
                    Description = desc,
                    TransactionType = txType,
                    ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                    ReferenceId = entity.Id,
                    CreateUser = username,
                    CreateTime = DateTime.UtcNow
                });
            }
        }
        else if (entity.Kind == PurchaseInvoiceKind.Purchase)
        {
            /*
              TERMİNDE BEKLEYEN ALIŞ EKSTREYE YAZILMAZ (2026-09-01 kullanıcı kararı).

              Belge "Bekliyor" durumundayken bu bir SİPARİŞTİR: mal henüz gelmemiştir,
              stoğa da girmez (bkz. UpsertInvoiceFromPurchase — aynı koşulla fatura
              üretmiyor). Borç doğmadan tedarikçi ekstresine satır yazmak, ödenmemiş ve
              hatta teslim alınmamış malı borç gösteriyordu.

              Ekstre satırı, belge "Teslim Edildi" yapıldığında yazılır; o an
              UpdateTerminStatus bu metodu yeniden çağırır. Durum geri "Bekliyor"a
              alınırsa daha önce yazılmış satır BURADA SİLİNİR — yoksa iptal edilen bir
              teslimden sonra ekstrede hayalet borç kalırdı.
            */
            if (entity.TerminStatus == PurchaseInvoiceTerminStatus.Waiting)
            {
                /*
                  Temizlik ORTAK: aynı geri dönüş fatura dökümünden silme yolunda da
                  oluyor (InvoicesController.DeleteInvoice). İki kopya yazılırsa biri
                  değişip diğeri kalır — kullanıcının bildirdiği hata tam olarak buydu.
                */
                await PurchaseLedgerCleanup.RemoveLedgerEntriesForPurchaseAsync(
                    _dbContext, entity.Id, entity.DocumentNo, cancellationToken);
                if (!string.Equals(prevNo, entity.DocumentNo, StringComparison.Ordinal))
                {
                    await PurchaseLedgerCleanup.RemoveLedgerEntriesForPurchaseAsync(
                        _dbContext, entity.Id, prevNo, cancellationToken);
                }
                return;
            }

            var supCode = (entity.SupplierCode ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(supCode)) return;

            var isCustomer = await _dbContext.Customers.AnyAsync(x => x.CustomerCode == supCode, cancellationToken);

            if (isCustomer)
            {
                var existingSup = await _dbContext.SupplierLedgerEntries
                    .FirstOrDefaultAsync(x => x.ReferenceType == SupplierLedgerEntryReferenceType.Invoice && x.ReferenceId == entity.Id, cancellationToken);
                if (existingSup != null)
                {
                    _dbContext.SupplierLedgerEntries.Remove(existingSup);
                }

                var existingCust = await _dbContext.CustomerLedgerEntries
                    .FirstOrDefaultAsync(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice
                                              && x.ReferenceId == entity.Id
                                              && (x.DocumentNo == entity.DocumentNo
                                                  || (x.DocumentNo == prevNo
                                                      && (x.TransactionType == "Alış Faturası" || x.TransactionType == "İade Faturası"))),
                                         cancellationToken);

                var usdRate = await _money.GetLatestTryRateAsync("USD", cancellationToken);
                var eurRate = await _money.GetLatestTryRateAsync("EUR", cancellationToken);
                var gbpRate = await _money.GetLatestTryRateAsync("GBP", cancellationToken);

                var customer = await _dbContext.Customers
                    .AsNoTracking()
                    .FirstOrDefaultAsync(x => x.CustomerCode == supCode, cancellationToken);
                var targetCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(customer?.CurrencyTypeId ?? 1);

                var entryRate = targetCurrencyTypeId switch
                {
                    3 => usdRate,
                    2 => eurRate,
                    4 => gbpRate,
                    _ => 1m
                };

                var (entryAmount, entryCurrencyAmount) = ConvertPurchaseTotalForLedger(
                    entity.GrandTotal,
                    entity.CurrencyTypeId,
                    PickRate(entity.CurrencyTypeId, usdRate, eurRate, gbpRate),
                    targetCurrencyTypeId,
                    entryRate);

                if (existingCust != null)
                {
                    existingCust.CustomerCode = supCode;
                    existingCust.Date = entity.Date;
                    existingCust.DueDate = entity.Date;
                    existingCust.Direction = CustomerLedgerEntryDirection.Credit;
                    existingCust.Amount = entryAmount;
                    existingCust.CurrencyRate = entryRate <= 0 ? 1m : entryRate;
                    existingCust.CurrencyAmount = entryCurrencyAmount;
                    existingCust.DocumentNo = entity.DocumentNo;
                    existingCust.Description = "Faturamız";
                    existingCust.EditUser = username;
                    existingCust.EditTime = DateTime.UtcNow;
                    _dbContext.CustomerLedgerEntries.Update(existingCust);
                }
                else
                {
                    _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
                    {
                        CustomerCode = supCode,
                        Date = entity.Date,
                        DueDate = entity.Date,
                        Direction = CustomerLedgerEntryDirection.Credit,
                        Amount = entryAmount,
                        CurrencyTypeId = targetCurrencyTypeId,
                        CurrencyRate = entryRate <= 0 ? 1m : entryRate,
                        CurrencyAmount = entryCurrencyAmount,
                        DocumentNo = entity.DocumentNo,
                        Description = "Faturamız",
                        TransactionType = "Alış Faturası",
                        ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
                        ReferenceId = entity.Id,
                        CreateUser = username,
                        CreateTime = DateTime.UtcNow
                    });
                }
            }
            else
            {
                var existingCust = await _dbContext.CustomerLedgerEntries
                    .FirstOrDefaultAsync(x => x.ReferenceType == CustomerLedgerEntryReferenceType.Invoice
                                              && x.ReferenceId == entity.Id
                                              && (x.DocumentNo == entity.DocumentNo
                                                  || (x.DocumentNo == prevNo
                                                      && (x.TransactionType == "Alış Faturası" || x.TransactionType == "İade Faturası"))),
                                         cancellationToken);
                if (existingCust != null)
                {
                    _dbContext.CustomerLedgerEntries.Remove(existingCust);
                }

                var existingSup = await _dbContext.SupplierLedgerEntries
                    .FirstOrDefaultAsync(x => x.ReferenceType == SupplierLedgerEntryReferenceType.Invoice && x.ReferenceId == entity.Id, cancellationToken);

                // TL çapası + belgenin kendi dövizi. `GrandTotal` faturanın PARA BİRİMİNDEDİR,
                // TL değil (bkz. ConvertPurchaseTotalForLedger).
                var supRate = entity.ExchangeRate <= 0m ? 1m : entity.ExchangeRate;

                /*
                  ÇİFTE ÇEVRİM DÜZELTMESİ (2026-09-01).

                  Burası `GrandTotal`ı faturanın KENDİ parasında sanıp kurla çarpıyordu. Bu
                  varsayım 2026-08-29'da döviz damgası geldiğinde geçersiz oldu: `GrandTotal`
                  ARTIK TL ÇAPASIDIR (bkz. PurchaseInvoiceMath sınıf açıklaması). Müşteri
                  defteri dalı o gün `PurchaseInvoiceMath.Ledger` ile düzeltilmişti; tedarikçi
                  defteri dalı eski varsayımla kaldı.

                  Canlıdaki sonuç: 348.250 $'lık teslimat faturası ekstreye
                    Amount         = 16.806.997,76 x 48,2613 = 811.127.560 TL   (kur katı şişik)
                    CurrencyAmount = 16.806.997,76 "USD"      (aslında TL değeri, $ etiketli)
                  olarak yazıldı.

                  Doğrusu, müşteri defteriyle AYNI matematik:
                    TL çapası      = GrandTotal (damgalıysa çarpılmaz)
                    Döviz karşılığı = TL çapası / belgenin kuru
                */
                var (supTryAmount, supCurrencyAmount) = B2B.Erp.Api.Core.Accounting.PurchaseInvoiceMath.Ledger(
                    entity.GrandTotal,
                    entity.CurrencyTypeId,
                    supRate,
                    entity.CurrencyTypeId,
                    supRate);

                if (existingSup != null)
                {
                    existingSup.SupplierCode = supCode;
                    existingSup.Date = entity.Date;
                    existingSup.DueDate = entity.Date;
                    existingSup.Amount = supTryAmount;
                    // Bu üç alan güncelleme dalında HİÇ yazılmıyordu: faturanın para birimi
                    // sonradan değişse bile ekstre satırı eski dövizde/kurda kalıyordu.
                    existingSup.CurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(entity.CurrencyTypeId);
                    existingSup.CurrencyRate = supRate;
                    existingSup.CurrencyAmount = supCurrencyAmount;
                    existingSup.DocumentNo = entity.DocumentNo;
                    existingSup.Description = $"Alış Faturası ({entity.DocumentNo})";
                    existingSup.EditUser = username;
                    existingSup.EditTime = DateTime.UtcNow;
                    _dbContext.SupplierLedgerEntries.Update(existingSup);
                }
                else
                {
                    _dbContext.SupplierLedgerEntries.Add(new SupplierLedgerEntry
                    {
                        SupplierCode = supCode,
                        Date = entity.Date,
                        DueDate = entity.Date,
                        Direction = SupplierLedgerEntryDirection.Credit,
                        // `Amount` TL çapası, `CurrencyAmount` belgenin kendi parası.
                        // İkisi de PurchaseInvoiceMath.Ledger'dan gelir — çifte çevrim kapısı orada.
                        Amount = supTryAmount,
                        // Alış faturasına para birimi eklendi (2026-08-14); tedarikçi ekstresi
                        // artık faturanın KENDİ dövizinden ve donmuş kurundan okuyor.
                        // `Supplier` varlığında takip dövizi hâlâ yok — belgenin dövizi esas alınır.
                        CurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(entity.CurrencyTypeId),
                        CurrencyRate = supRate,
                        CurrencyAmount = supCurrencyAmount,
                        DocumentNo = entity.DocumentNo,
                        Description = $"Alış Faturası ({entity.DocumentNo})",
                        TransactionType = "Alış Faturası",
                        ReferenceType = SupplierLedgerEntryReferenceType.Invoice,
                        ReferenceId = entity.Id,
                        CreateUser = username,
                        CreateTime = DateTime.UtcNow
                    });
                }
            }
        }
    }
}
