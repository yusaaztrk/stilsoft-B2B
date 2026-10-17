using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Core.Interfaces;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.Customers;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using System.Security.Claims;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public sealed class CustomersController : ControllerBase
{
    private readonly AppDbContext _dbContext;
    private readonly ICustomerExcelService _customerExcelService;
    private readonly Core.Services.ICustomerAccountService _customerAccountService;
    private readonly Core.Services.IPriceGroupMappingService _priceGroupMappingService;
    private readonly Core.Interfaces.IMoneyServiceClient _money;
    private readonly ILogger<CustomersController> _logger;

    public CustomersController(
        AppDbContext dbContext,
        ICustomerExcelService customerExcelService,
        Core.Services.ICustomerAccountService customerAccountService,
        Core.Services.IPriceGroupMappingService priceGroupMappingService,
        Core.Interfaces.IMoneyServiceClient money,
        ILogger<CustomersController> logger)
    {
        _dbContext = dbContext;
        _customerExcelService = customerExcelService;
        _customerAccountService = customerAccountService;
        _priceGroupMappingService = priceGroupMappingService;
        _money = money;
        _logger = logger;
    }

    public sealed class NextCustomerCodeResponse
    {
        public string CustomerCode { get; set; } = string.Empty;
    }

    /// <summary>
    /// Para biriminin güncel TL kuru; TL'de 1.
    ///
    /// <para>
    /// Kur servisi yanıt vermezse 1'e düşülür: cari kaydını kur servisine bağlı hâle getirmek,
    /// bir dış servis arızasında cari açılamaması demek olurdu. 1 ile düşmek bugünkü
    /// davranıştan kötü değil — ama satır <c>CurrencyRate = 1</c> ile damgalandığı için
    /// sonradan gözle ayırt edilebilir kalır.
    /// </para>
    /// </summary>
    private async Task<decimal> ResolveTryRateAsync(int currencyTypeId, CancellationToken cancellationToken)
    {
        if (CurrencyTypeHelper.IsTry(currencyTypeId)) return 1m;

        var code = CurrencyTypeHelper.ToCode(currencyTypeId);
        if (string.IsNullOrWhiteSpace(code)) return 1m;

        try
        {
            var rate = await _money.GetLatestTryRateAsync(code, cancellationToken);
            return rate > 0m ? rate : 1m;
        }
        catch
        {
            return 1m;
        }
    }

    private static string NormalizeCustomerType(string raw)
    {
        var s = (raw ?? string.Empty).Trim().ToLowerInvariant();
        /*
          TÜRKÇE HARF EKSİKLİĞİNE TOLERANS (2026-08-31 canlı hata).

          ServiceOps'un hızlı müşteri ekleme ekranı "müsteri" gönderiyordu — ü var, ş YOK.
          Buradaki iki yazıma da uymadığı için ön ek çözülemiyor, uç kod üretemiyor ve
          çağıran taraf kodu boş alıyordu. Sonuç: cari oluşuyor ama servis kaydına
          bağlanmıyor; 40 kayıt carisiz kaldı ve teslimde faturaları kesilemedi.

          Çağıran düzeltildi (artık ASCII "musteri" gönderiyor), ama burada da kabul
          ediliyor: kaç farklı istemcinin hangi yazımı gönderdiğini bilmiyoruz ve bir harf
          yüzünden sessizce kod üretmemek kabul edilemez bir kırılganlık.

          Aynı tolerans diğer tiplerde de var: yalnızca eksik/yanlış Türkçe harf varyantları
          eklendi, YENİ TİP tanımlanmadı.
        */
        if (s == "müşteri" || s == "musteri" || s == "müsteri" || s == "musşteri") return "musteri";
        if (s == "bayi") return "bayi";
        if (s == "çalışan" || s == "calisan" || s == "çalisan" || s == "calışan") return "calisan";
        if (s == "şube" || s == "sube") return "sube";
        if (s == "parekende" || s == "perakende") return "parekende";
        if (s == "mağaza" || s == "magaza" || s == "mağza") return "magaza";
        if (s == "alt bayi" || s == "altbayi") return "altbayi";
        if (s == "hizmet") return "hizmet";
        // E-ticaret üyeleri kendi ön ekini alır (120-11-): internetten gelen müşteriyi
        // raporlarda ve ekstrede ayırt edebilmek için. Fatura tipi yine FATURA kalır —
        // o alan ekstre ve muhasebe raporunu yönlendirdiği için dokunulmuyor.
        if (s == "eticaret" || s == "e-ticaret") return "eticaret";
        return s;
    }

    private static string ResolveCustomerPrefixByType(string normalizedType)
    {
        // MUST match requested formats:
        // - Müşteri: 120-03-xxxxxx
        // - Bayi: 120-01-xxxxxx
        // - Çalışan: 120-07-xxxxxx
        // - Parekende/Mağaza: 120-04-xxxxxx
        // - Alt Bayi: 120-10-xxxxxx
        return normalizedType switch
        {
            "bayi" => "120-01-",
            "altbayi" => "120-10-",
            "musteri" => "120-03-",
            "calisan" => "120-07-",
            "sube" => "120-04-",
            "parekende" => "120-04-",
            "magaza" => "120-04-",
            "hizmet" => "770-01-",
            "eticaret" => "120-11-",
            _ => ""
        };
    }

    private static long ParseLast6DigitsOrZero(string code, string prefix)
    {
        return B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.ParseLast6DigitsOrZero(code, prefix);
    }

    private static bool TryParseParentForBranchCode(string parentCustomerCode, out string branchBasePrefix)
    {
        return B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.TryParseParentForBranchCode(parentCustomerCode, out branchBasePrefix);
    }

    /// <summary>
    /// Şube mi? Alt hesaplar (-1/-2/-3) şube SAYILMAZ; onlar carinin kendi hesap kırılımıdır.
    /// Tip alanına ek olarak kod ön eki de okunur (CustomerAccountService ile aynı ölçüt):
    /// şube kodu bağlı carinin ortasından türer, ör. 120-01-000046 → 01-000046-001.
    /// </summary>
    private static bool IsBranchCustomer(Customer? c)
    {
        if (c is null) return false;
        if (string.IsNullOrWhiteSpace(c.ParentCustomerCode)) return false;

        var code = (c.CustomerCode ?? string.Empty).Trim();
        if (code.Length == 0) return false;
        if (CustomerAccountHelper.IsSubAccountCode(code)) return false;

        return NormalizeCustomerType(c.CustomerType ?? string.Empty) == "sube"
            || code.StartsWith("01-", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// ANA CARİNİN GRUBU DEĞİŞİRSE ŞUBELERİ DE TAŞINIR (2026-08-20).
    ///
    /// Türetme yalnız kayıt anında yapılsaydı, ana cari sonradan başka bir gruba çekildiğinde
    /// şubeler eski grupta kalır ve aynı ürün için ana cariden farklı tutar göstermeye devam
    /// ederdi. Alt hesaplara (-1/-2/-3) DOKUNULMAZ ve şubenin <c>InvoiceType</c> alanı da
    /// değiştirilmez: fatura hedefi zaten şubeden ana cariye yönlendiriliyor
    /// (CustomerAccountService.ResolveTargetInvoiceCustomerCodeAsync), alt hesapların tipi ise
    /// kasten FATURA/ACIK/ASKERIYE diye ayrışıyor.
    ///
    /// Ana carinin grubu BOŞSA hiçbir şey yapılmaz — şubeleri gruptan etmek, onları fiyatsız
    /// bırakmak olurdu.
    /// </summary>
    /// <summary>
    /// FİYAT GRUBU DEĞİŞİNCE CARİ BÜTÜN OLARAK HİZALANIR (2026-10-14 kullanıcı bildirimi: "carinin
    /// fiyat grubunu açıktan faturaya aldım, sepette doğru ama fatura oluşunca fiyatlar bozuluyor;
    /// iki yönde de dene").
    ///
    /// Bir carinin "açık mı faturalı mı" olduğu DÖRT yerde yazılı: fiyat grubu, cari kartının
    /// <c>InvoiceType</c>'ı, <c>AccountRole</c> (OPEN_MAIN) ve alt hesapların (-1 Fatura / -2 Açık)
    /// kendi fiyat grupları. Grup değişince yalnız ilki değişiyordu:
    ///  - Sepet KDV kararını GRUPTAN verir → doğru görünür.
    ///  - Sipariş ve fatura ise <c>InvoiceType</c>'a ve alt hesaba bakar. Açıktan faturaya alınan
    ///    caride kart hâlâ ACIK dediği için sipariş KDV'siz kaydediliyor, fatura -2'ye gidiyordu.
    ///  - Satış faturası ekranı fiyatı FATURANIN KESİLDİĞİ ALT HESABIN grubundan yeniden çekiyor;
    ///    alt hesap eski grupta kaldığı için fatura eski grubun fiyatıyla (net ↔ KDV dahil) çıkıyordu.
    ///
    /// Kural (yeni cari açılırken uygulananın aynısı, bkz. EnsureSubAccountsCreatedAsync):
    ///  - <c>InvoiceType</c> grubun kendi fatura tipinden; 4-6 her zaman ACIK.
    ///  - ACIK → OPEN_MAIN; değilse OPEN_MAIN kalkar (NORMAL).
    ///  - Grup GERÇEKTEN değiştiyse: -1 yeni grubun fatura karşılığına, -2 yeni gruba taşınır.
    ///    -3 (Askeriye/Muaf) bilerek elle ayarlanabildiği için ellenmez. Grup değişmediyse alt
    ///    hesaplara hiç dokunulmaz (elle yapılmış ayar korunur).
    /// </summary>
    private async Task AlignCustomerToPriceGroupAsync(Customer entity, Guid? previousPriceGroupId, bool takeInvoiceTypeFromGroup, CancellationToken cancellationToken)
    {
        if (!entity.PriceGroupId.HasValue) return;

        var pg = await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(x => x.Id == entity.PriceGroupId.Value)
            .Select(x => new { x.Code, x.InvoiceType })
            .FirstOrDefaultAsync(cancellationToken);
        if (pg is null) return;

        if (takeInvoiceTypeFromGroup && !string.IsNullOrWhiteSpace(pg.InvoiceType))
        {
            entity.InvoiceType = pg.InvoiceType.Trim().ToUpperInvariant();
        }
        if (_priceGroupMappingService.IsOpenGroupCode(pg.Code))
        {
            entity.InvoiceType = "ACIK";
        }

        var isAcik = string.Equals(entity.InvoiceType, "ACIK", StringComparison.OrdinalIgnoreCase)
                     || string.Equals(entity.InvoiceType, "AÇIK", StringComparison.OrdinalIgnoreCase);
        if (isAcik)
        {
            entity.AccountRole = CustomerAccountRole.OpenMain;
        }
        else if (entity.AccountRole == CustomerAccountRole.OpenMain)
        {
            entity.AccountRole = CustomerAccountRole.Normal;
        }

        if (previousPriceGroupId != entity.PriceGroupId)
        {
            var mainCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(entity.CustomerCode.Trim());
            var invoiceGroupId = await _priceGroupMappingService.GetMappedInvoiceGroupIdAsync(entity.PriceGroupId.Value, cancellationToken)
                                 ?? entity.PriceGroupId;

            var subs = await _dbContext.Customers
                .Where(x => x.MainCustomerCode == mainCode && x.CustomerCode != mainCode)
                .ToListAsync(cancellationToken);

            foreach (var sub in subs)
            {
                if (sub.AccountRole == CustomerAccountRole.InvoiceAccount || sub.CustomerCode.EndsWith("-1"))
                {
                    sub.PriceGroupId = invoiceGroupId;
                }
                else if (sub.AccountRole == CustomerAccountRole.OpenAccount || sub.CustomerCode.EndsWith("-2"))
                {
                    sub.PriceGroupId = entity.PriceGroupId;
                }
            }
        }

        /*
          ALT HESABIN TİPİ ROLÜNDEN (2026-10-14 canlı bildirim, 120-03-004623): cari açıktan faturaya
          alındıktan sonra -1 hesabın kaydı ACIK / grup 4'te kalmıştı. Bu blok grup DEĞİŞMESE de çalışır,
          yani daha önce bozulmuş bir cari "Güncelle" ile kendiliğinden düzelir. Yalnız kesin yanlışı
          düzeltir: -1 her zaman FATURA, -2 ACIK, -3 ASKERIYE; ana cari faturalıyken -1 açık bir grupta
          (4-7) duruyorsa faturalı karşılığına alınır. Elle verilmiş başka bir grup korunur.
        */
        {
            var mainCodeAll = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(entity.CustomerCode.Trim());
            var allSubs = await _dbContext.Customers
                .Where(x => x.MainCustomerCode == mainCodeAll && x.CustomerCode != mainCodeAll)
                .ToListAsync(cancellationToken);
            var openGroupIds = await _dbContext.PriceGroups
                .AsNoTracking()
                .Where(g => g.Code >= 4 && g.Code <= 7)
                .Select(g => g.Id)
                .ToListAsync(cancellationToken);
            Guid? invoiceGroupForMain = null;
            if (!isAcik)
            {
                invoiceGroupForMain = await _priceGroupMappingService.GetMappedInvoiceGroupIdAsync(entity.PriceGroupId.Value, cancellationToken)
                                      ?? entity.PriceGroupId;
            }

            foreach (var sub in allSubs)
            {
                var c = sub.CustomerCode.Trim();
                if (B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.IsInvoiceAccountCode(c))
                {
                    sub.InvoiceType = "FATURA";
                    if (invoiceGroupForMain.HasValue && sub.PriceGroupId.HasValue && openGroupIds.Contains(sub.PriceGroupId.Value))
                    {
                        sub.PriceGroupId = invoiceGroupForMain;
                    }
                }
                else if (B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.IsOpenAccountCode(c))
                {
                    sub.InvoiceType = "ACIK";
                }
                else if (B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.IsAskeriyeAccountCode(c))
                {
                    sub.InvoiceType = "ASKERIYE";
                }
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task SyncBranchPriceGroupsAsync(Customer parent, CancellationToken cancellationToken)
    {
        if (parent is null) return;
        if (!parent.PriceGroupId.HasValue) return;
        if (IsBranchCustomer(parent)) return;

        var parentCode = (parent.CustomerCode ?? string.Empty).Trim();
        if (parentCode.Length == 0) return;

        var branches = await _dbContext.Customers
            .Where(x => x.ParentCustomerCode == parentCode
                        && x.PriceGroupId != parent.PriceGroupId
                        && !x.CustomerCode.EndsWith("-1")
                        && !x.CustomerCode.EndsWith("-2")
                        && !x.CustomerCode.EndsWith("-3"))
            .ToListAsync(cancellationToken);

        if (branches.Count == 0) return;

        foreach (var branch in branches)
        {
            branch.PriceGroupId = parent.PriceGroupId;
            branch.EditUser = User.Identity?.Name ?? "System";
            branch.EditTime = DateTime.UtcNow;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// ŞUBENİN FİYAT GRUBU BAĞLI CARİDEN TÜRETİLİR (2026-08-20); formdan gelen değer yok sayılır.
    ///
    /// Şube, ana carinin bir ADRESİ — ayrı bir fiyat müşterisi değil. Fiyat grubu formda serbest
    /// bırakılınca şube ana cariden farklı bir gruba (ya da hiçbirine) düşüyor, sonra aynı ürün
    /// için sepette başka tutar çıkıyordu. Fatura tipi de grubun tipinden türediği için grup
    /// hizalanınca tip kendiliğinden hizalanır.
    ///
    /// BAĞLI CARİNİN GRUBU BOŞSA formdaki değere DOKUNULMAZ: aksi halde grubu hiç atanmamış bir
    /// ana cariye bağlı şubeler çalışan fiyat gruplarını kaybederdi (fiyat grubu olmayan cari
    /// ProductsController tarafında bütün gruplar içinden EN UCUZ fiyata düşer).
    /// </summary>
    private async Task<Guid?> ResolveBranchPriceGroupIdAsync(
        string normalizedType,
        string? parentCustomerCode,
        Guid? requestedPriceGroupId,
        CancellationToken cancellationToken)
    {
        if (normalizedType != "sube") return requestedPriceGroupId;

        var parent = (parentCustomerCode ?? string.Empty).Trim();
        if (parent.Length == 0) return requestedPriceGroupId;

        var parentPriceGroupId = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == parent)
            .Select(x => x.PriceGroupId)
            .FirstOrDefaultAsync(cancellationToken);

        return parentPriceGroupId ?? requestedPriceGroupId;
    }

    private static int ParseLast3DigitsOrZero(string code, string prefix)
    {
        var s = (code ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(prefix) || !s.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return 0;
        var suffix = s.Substring(prefix.Length);
        if (suffix.Length != 3) return 0;
        return int.TryParse(suffix, out var n) ? n : 0;
    }

    private async Task<string> ReserveNextBranchCustomerCode(string branchBasePrefix, CancellationToken cancellationToken)
    {
        await using var tx = await _dbContext.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken);

        var keySafe = branchBasePrefix.TrimEnd('-');
        var seriesKey = $"customer-branch:{keySafe}";
        var series = await _dbContext.NumberSeries
            .FirstOrDefaultAsync(x => x.Key == seriesKey, cancellationToken);

        var existingCodes = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode.StartsWith(branchBasePrefix))
            .Select(x => x.CustomerCode)
            .ToListAsync(cancellationToken);

        var maxExisting = existingCodes.Count == 0 ? 0 : existingCodes.Max(c => ParseLast3DigitsOrZero(c, branchBasePrefix));

        if (series is null)
        {
            series = new NumberSeries
            {
                Key = seriesKey,
                LastValue = maxExisting
            };

            _dbContext.NumberSeries.Add(series);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        else if (series.LastValue < maxExisting)
        {
            series.LastValue = maxExisting;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        series.LastValue += 1;
        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        var n = (int)series.LastValue;
        if (n < 1) n = 1;
        if (n > 999) n = 999;
        return branchBasePrefix + n.ToString("D3");
    }

    private async Task<string> ReserveNextCustomerCode(string prefix, CancellationToken cancellationToken)
    {
        await using var tx = await _dbContext.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken);

        var seriesKey = $"customer:{prefix.TrimEnd('-')}";
        var series = await _dbContext.NumberSeries
            .FirstOrDefaultAsync(x => x.Key == seriesKey, cancellationToken);

        // Always initialize from existing max, because series might be missing or out-of-date.
        var existingCodes = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode.StartsWith(prefix))
            .Select(x => x.CustomerCode)
            .ToListAsync(cancellationToken);

        var maxExisting = existingCodes.Count == 0 ? 0 : existingCodes.Max(c => ParseLast6DigitsOrZero(c, prefix));

        if (series is null)
        {
            series = new NumberSeries
            {
                Key = seriesKey,
                LastValue = maxExisting
            };

            _dbContext.NumberSeries.Add(series);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        else if (series.LastValue < maxExisting)
        {
            series.LastValue = maxExisting;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        series.LastValue += 1;
        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return prefix + series.LastValue.ToString("D6");
    }

    [HttpGet]
    [AuthorizePage("users", "cariEkle")]
    public async Task<IActionResult> GetAll([FromQuery] string? q, [FromQuery] bool includeInactive = true, [FromQuery] bool includeSystemAccounts = false, CancellationToken cancellationToken = default)
    {
        var query = _dbContext.Customers.AsNoTracking().AsQueryable();

        if (!includeInactive)
        {
            query = query.Where(x => x.IsActive);
        }

        if (!includeSystemAccounts)
        {
            query = query.Where(x => (x.MainCustomerCode == null || x.MainCustomerCode == "" || x.MainCustomerCode == x.CustomerCode) && !x.CustomerCode.EndsWith("-1") && !x.CustomerCode.EndsWith("-2") && !x.CustomerCode.EndsWith("-3"));
        }

        var qValue = string.IsNullOrWhiteSpace(q) ? null : q.Trim().ToLowerInvariant();
        if (qValue is not null)
        {
            var qNoSpace = qValue.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "").Replace(".", "");
            var qDigits = new string(qValue.Where(char.IsDigit).ToArray());
            query = query.Where(x =>
                x.CustomerCode.ToLower().Contains(qValue) ||
                x.CustomerCode.Replace("-", "").Replace(" ", "").ToLower().Contains(qNoSpace) ||
                x.Name.ToLower().Contains(qValue) ||
                x.Name.Replace(" ", "").ToLower().Contains(qNoSpace) ||
                (x.Phone != null && (
                    x.Phone.ToLower().Contains(qValue) ||
                    x.Phone.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "").ToLower().Contains(qNoSpace) ||
                    (!string.IsNullOrEmpty(qDigits) && qDigits.Length >= 3 && x.Phone.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "").Contains(qDigits))
                )) ||
                (x.TaxNumber != null && (
                    x.TaxNumber.ToLower().Contains(qValue) ||
                    x.TaxNumber.Replace(" ", "").Replace("-", "").Contains(qNoSpace)
                )));
        }

        var data = await query
            .OrderBy(x => x.CustomerCode)
            .Select(x => new CustomerResponse
            {
                CustomerCode = x.CustomerCode,
                Name = x.Name,
                Address = x.Address,
                City = x.City,
                District = x.District,
                Phone = x.Phone,
                Fax = x.Fax,
                Email = x.Email,
                TaxOffice = x.TaxOffice,
                TaxNumber = x.TaxNumber,
                IdentityNumber = x.IdentityNumber,
                CustomerType = x.CustomerType,
                InvoiceType = x.InvoiceType,
                ProductCategory = x.ProductCategory,
                CategoryAccessMode = x.CategoryAccessMode,
                IsActive = x.IsActive,
                PriceGroupId = x.PriceGroupId,
                DiscountRate = x.DiscountRate,
                SalesmanCode = x.SalesmanCode,
                CreditLimit = x.CreditLimit,
                CreditLimitUsd = x.CreditLimitUsd,
                CreditLimitEur = x.CreditLimitEur,
                CreditLimitGbp = x.CreditLimitGbp,
                ParentCustomerCode = x.ParentCustomerCode,
                CurrencyTypeId = x.CurrencyTypeId
            })
            .ToListAsync(cancellationToken);

        var codes = data.Select(x => x.CustomerCode).Distinct().ToList();
        if (codes.Count > 0)
        {
            var map = await _dbContext.CustomerProductCategories
                .AsNoTracking()
                .Where(x => codes.Contains(x.CustomerCode))
                .GroupBy(x => x.CustomerCode)
                .ToDictionaryAsync(g => g.Key, g => g.Select(x => x.ProductCategoryId).ToList(), cancellationToken);

            foreach (var item in data)
            {
                item.ProductCategoryIds = map.TryGetValue(item.CustomerCode, out var list) ? list : new List<Guid>();
            }
        }

        return Ok(new { success = true, data });
    }

    [HttpGet("next-code")]
    [AuthorizePage("users", "cariEkle")]
    [AuthorizePage("invoice", "siparis")]
    [AuthorizePage("invoice", "magaza")]
    public async Task<IActionResult> GetNextCode([FromQuery] string customerType, [FromQuery] string? parentCustomerCode, CancellationToken cancellationToken = default)
    {
        var normalizedType = NormalizeCustomerType(customerType);

        if (normalizedType == "sube")
        {
            var parent = (parentCustomerCode ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(parent))
            {
                return BadRequest(new { success = false, message = "Şube için bağlı cari seçilmelidir" });
            }

            var parentExists = await _dbContext.Customers
                .AsNoTracking()
                .AnyAsync(x => x.CustomerCode == parent, cancellationToken);
            if (!parentExists)
            {
                return BadRequest(new { success = false, message = "Bağlı cari bulunamadı" });
            }

            if (!TryParseParentForBranchCode(parent, out var branchBasePrefix))
            {
                return BadRequest(new { success = false, message = "Bağlı cari kodu formatı geçersiz" });
            }

            var existingBranchCodes = await _dbContext.Customers
                .AsNoTracking()
                .Where(x => x.CustomerCode.StartsWith(branchBasePrefix))
                .Select(x => x.CustomerCode)
                .ToListAsync(cancellationToken);

            var maxExistingBranch = existingBranchCodes.Count == 0 ? 0 : existingBranchCodes.Max(c => ParseLast3DigitsOrZero(c, branchBasePrefix));
            var branchSeriesKey = $"customer-branch:{branchBasePrefix.TrimEnd('-')}";
            var branchSeriesLast = await _dbContext.NumberSeries
                .AsNoTracking()
                .Where(x => x.Key == branchSeriesKey)
                .Select(x => (long?)x.LastValue)
                .FirstOrDefaultAsync(cancellationToken);

            var branchLast = Math.Max((int)(branchSeriesLast ?? 0), maxExistingBranch);
            var next = branchLast + 1;
            if (next < 1) next = 1;
            if (next > 999) next = 999;

            var branchCode = branchBasePrefix + next.ToString("D3");
            return Ok(new { success = true, data = new NextCustomerCodeResponse { CustomerCode = branchCode } });
        }

        var prefix = ResolveCustomerPrefixByType(normalizedType);
        if (string.IsNullOrWhiteSpace(prefix))
        {
            return BadRequest(new { success = false, message = "Geçersiz cari tipi" });
        }

        // Preview only: do NOT increment series here (modal open should not consume numbers).
        var seriesKey = $"customer:{prefix.TrimEnd('-')}";
        var seriesLast = await _dbContext.NumberSeries
            .AsNoTracking()
            .Where(x => x.Key == seriesKey)
            .Select(x => (long?)x.LastValue)
            .FirstOrDefaultAsync(cancellationToken);

        var existingPrefixCodes = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode.StartsWith(prefix))
            .Select(x => x.CustomerCode)
            .ToListAsync(cancellationToken);

        var maxExistingPrefix = existingPrefixCodes.Count == 0 ? 0 : existingPrefixCodes.Max(c => ParseLast6DigitsOrZero(c, prefix));
        var last = Math.Max(seriesLast ?? 0, maxExistingPrefix);
        var nextCode = prefix + (last + 1).ToString("D6");
        return Ok(new { success = true, data = new NextCustomerCodeResponse { CustomerCode = nextCode } });
    }

    [HttpGet("excel-template")]
    [AuthorizePage("users", "cariEkle")]
    public async Task<IActionResult> GetExcelTemplate(CancellationToken cancellationToken)
    {
        var bytes = await _customerExcelService.BuildTemplateAsync(cancellationToken);
        return File(
            bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "cari-template.xlsx");
    }

    [HttpGet("excel-export")]
    [AuthorizePage("users", "cariEkle")]
    public async Task<IActionResult> ExportExcel(CancellationToken cancellationToken)
    {
        var bytes = await _customerExcelService.BuildExportAsync(cancellationToken);
        return File(
            bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "cariler.xlsx");
    }

    [HttpPost("excel-import")]
    [AuthorizePage("users", "cariEkle")]
    [RequestSizeLimit(25_000_000)]
    public async Task<IActionResult> ImportExcel([FromForm] IFormFile file, CancellationToken cancellationToken)
    {
        var data = await _customerExcelService.ImportAsync(file, cancellationToken);
        return Ok(new { success = true, data });
    }

    [HttpGet("dealers")]
    [AuthorizePage("invoice", "siparis")]
    [AuthorizePage("invoice", "magaza")]
    [AuthorizePage("reports", "garantiRaporlari")]
    /// <param name="limit">
    /// 0 = sınırsız (varsayılan). Cari seçim kutusu buraya bir sınır gönderir: arama zaten
    /// sunucuda süzüldüğü için tarayıcıya binlerce satır indirmenin anlamı yok, seçim kutusu
    /// zaten ilk elli satırı gösteriyor. Listeyi tümüyle isteyen diğer çağıranlar sınır
    /// göndermediği için etkilenmez.
    /// </param>
    public async Task<IActionResult> GetDealers([FromQuery] string? q, [FromQuery] bool includeInactive = false, [FromQuery] string? type = null, [FromQuery] int limit = 0, CancellationToken cancellationToken = default)
    {
        var query = _dbContext.Customers.AsNoTracking()
            .Where(x => (x.MainCustomerCode == null || x.MainCustomerCode == "" || x.MainCustomerCode == x.CustomerCode) && !x.CustomerCode.EndsWith("-1") && !x.CustomerCode.EndsWith("-2") && !x.CustomerCode.EndsWith("-3"))
            .AsQueryable();

        if (!includeInactive)
        {
            query = query.Where(x => x.IsActive);
        }

        if (!string.IsNullOrWhiteSpace(type) && type.ToLower() == "bayi")
        {
            query = query.Where(x =>
                (x.CustomerType ?? string.Empty).ToLower() == "bayi");
        }
        else
        {
            query = query.Where(x =>
                (x.CustomerType ?? string.Empty).ToLower() == "mağaza" ||
                (x.CustomerType ?? string.Empty).ToLower() == "magaza");
        }

        var qValue = string.IsNullOrWhiteSpace(q) ? null : q.Trim().ToLowerInvariant();
        if (qValue is not null)
        {
            var qNoSpace = qValue.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "").Replace(".", "");
            var qDigits = new string(qValue.Where(char.IsDigit).ToArray());
            query = query.Where(x =>
                x.CustomerCode.ToLower().Contains(qValue) ||
                x.CustomerCode.Replace("-", "").Replace(" ", "").ToLower().Contains(qNoSpace) ||
                x.Name.ToLower().Contains(qValue) ||
                x.Name.Replace(" ", "").ToLower().Contains(qNoSpace) ||
                (x.Phone != null && (
                    x.Phone.ToLower().Contains(qValue) ||
                    x.Phone.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "").ToLower().Contains(qNoSpace) ||
                    (!string.IsNullOrEmpty(qDigits) && qDigits.Length >= 3 && x.Phone.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "").Contains(qDigits))
                )) ||
                (x.TaxNumber != null && (
                    x.TaxNumber.ToLower().Contains(qValue) ||
                    x.TaxNumber.Replace(" ", "").Replace("-", "").Contains(qNoSpace)
                )));
        }

        // Sunucu tarafı sınır — 0 = sınırsız, bkz. limit parametresi.
        if (limit > 0) query = query.OrderBy(x => x.CustomerCode).Take(limit);

        var data = await query
            .OrderBy(x => x.CustomerCode)
            .Select(x => new CustomerResponse
            {
                CustomerCode = x.CustomerCode,
                Name = x.Name,
                Address = x.Address,
                City = x.City,
                District = x.District,
                Phone = x.Phone,
                Email = x.Email,
                TaxOffice = x.TaxOffice,
                TaxNumber = x.TaxNumber,
                CustomerType = x.CustomerType,
                InvoiceType = x.InvoiceType,
                IsActive = x.IsActive,
                PriceGroupId = x.PriceGroupId,
                PriceGroupCode = _dbContext.PriceGroups
                    .Where(pg => pg.Id == x.PriceGroupId)
                    .Select(pg => (int?)pg.Code)
                    .FirstOrDefault(),
                DiscountRate = x.DiscountRate,
                SalesmanCode = x.SalesmanCode,
                CreditLimit = x.CreditLimit,
                CreditLimitUsd = x.CreditLimitUsd,
                CreditLimitEur = x.CreditLimitEur,
                CreditLimitGbp = x.CreditLimitGbp,
                CurrencyTypeId = x.CurrencyTypeId
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [HttpGet("end-customers")]
    [AuthorizePage("invoice", "siparis")]
    [AuthorizePage("invoice", "magaza")]
    /// <param name="includeDealers">
    /// Bayileri de listeye katar. Mağaza Sipariş ekranı bunu açıyor: kullanıcı bir bayiyi
    /// müşteri sanıp aramasın diye bayi görünsün ama SEÇİLEMESİN istendi. Seçilemezliği
    /// ekran uyguluyor; uç yalnızca listeyi genişletiyor.
    /// Varsayılan KAPALI — bu ucu kullanan diğer ekranların (Garanti Raporu) davranışı değişmesin.
    /// </param>
    /// <param name="limit">0 = sınırsız. Bkz. <see cref="GetDealers"/> — aynı gerekçe.</param>
    public async Task<IActionResult> GetEndCustomers([FromQuery] string? q, [FromQuery] bool includeInactive = false, [FromQuery] bool includeDealers = false, [FromQuery] int limit = 0, CancellationToken cancellationToken = default)
    {
        var query = _dbContext.Customers.AsNoTracking()
            .Where(x => (x.MainCustomerCode == null || x.MainCustomerCode == "" || x.MainCustomerCode == x.CustomerCode) && !x.CustomerCode.EndsWith("-1") && !x.CustomerCode.EndsWith("-2") && !x.CustomerCode.EndsWith("-3"))
            .AsQueryable();

        if (!includeInactive)
        {
            query = query.Where(x => x.IsActive);
        }

        query = includeDealers
            ? query.Where(x =>
                (x.CustomerType ?? string.Empty).ToLower() == "müşteri" ||
                (x.CustomerType ?? string.Empty).ToLower() == "musteri" ||
                (x.CustomerType ?? string.Empty).ToLower() == "bayi")
            : query.Where(x =>
                (x.CustomerType ?? string.Empty).ToLower() == "müşteri" ||
                (x.CustomerType ?? string.Empty).ToLower() == "musteri");

        var qValue = string.IsNullOrWhiteSpace(q) ? null : q.Trim().ToLowerInvariant();
        if (qValue is not null)
        {
            var qNoSpace = qValue.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "").Replace(".", "");
            var qDigits = new string(qValue.Where(char.IsDigit).ToArray());
            query = query.Where(x =>
                x.CustomerCode.ToLower().Contains(qValue) ||
                x.CustomerCode.Replace("-", "").Replace(" ", "").ToLower().Contains(qNoSpace) ||
                x.Name.ToLower().Contains(qValue) ||
                x.Name.Replace(" ", "").ToLower().Contains(qNoSpace) ||
                (x.Phone != null && (
                    x.Phone.ToLower().Contains(qValue) ||
                    x.Phone.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "").ToLower().Contains(qNoSpace) ||
                    (!string.IsNullOrEmpty(qDigits) && qDigits.Length >= 3 && x.Phone.Replace(" ", "").Replace("-", "").Replace("(", "").Replace(")", "").Contains(qDigits))
                )) ||
                (x.TaxNumber != null && (
                    x.TaxNumber.ToLower().Contains(qValue) ||
                    x.TaxNumber.Replace(" ", "").Replace("-", "").Contains(qNoSpace)
                )));
        }

        // Sunucu tarafı sınır — 0 = sınırsız, bkz. limit parametresi.
        if (limit > 0) query = query.OrderBy(x => x.CustomerCode).Take(limit);

        var data = await query
            .OrderBy(x => x.CustomerCode)
            .Select(x => new CustomerResponse
            {
                CustomerCode = x.CustomerCode,
                Name = x.Name,
                Address = x.Address,
                City = x.City,
                District = x.District,
                Phone = x.Phone,
                Email = x.Email,
                TaxOffice = x.TaxOffice,
                TaxNumber = x.TaxNumber,
                CustomerType = x.CustomerType,
                InvoiceType = x.InvoiceType,
                IsActive = x.IsActive,
                PriceGroupId = x.PriceGroupId,
                PriceGroupCode = _dbContext.PriceGroups
                    .Where(pg => pg.Id == x.PriceGroupId)
                    .Select(pg => (int?)pg.Code)
                    .FirstOrDefault(),
                DiscountRate = x.DiscountRate,
                SalesmanCode = x.SalesmanCode,
                CreditLimit = x.CreditLimit,
                CreditLimitUsd = x.CreditLimitUsd,
                CreditLimitEur = x.CreditLimitEur,
                CreditLimitGbp = x.CreditLimitGbp,
                CurrencyTypeId = x.CurrencyTypeId
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    /// <summary>
    /// Tek bir cari kartını okur. Yetki listesi GENİŞ tutulmak zorunda: bu uç bir ekranın
    /// kendisi değil, birçok ekranın ihtiyaç duyduğu referans veri.
    ///
    /// <para>
    /// 2026-08-22: proforma basımında V.D. ve VERGİ NO boş çıkıyordu. Sebep veri değildi —
    /// cari kartında bilgiler doluydu. Basım bu ucu çağırıyor, uç yalnızca `siparis`/`magaza`
    /// yetkisi arıyordu ve o yetkileri olmayan rol (kurumsal) 403 alıyordu. Basımdaki
    /// `try/catch` hatayı yutup kâğıdı vergi satırı boş bastığı için sorun görünmez kalıyordu;
    /// superadmin'de çalışması da yanıltıyordu. Proforma ve teklif sayfa anahtarları eklendi.
    /// </para>
    ///
    /// <para>
    /// Birden çok <see cref="AuthorizePageAttribute"/> VEYA olarak değerlendirilir
    /// (bkz. PageAuthorizationFilter): herhangi biri yeterlidir.
    /// </para>
    /// </summary>
    [HttpGet("by-code/{customerCode}")]
    [AuthorizePage("invoice", "siparis")]
    [AuthorizePage("invoice", "magaza")]
    [AuthorizePage("invoice", "proforma")]
    [AuthorizePage("invoice", "proformaBasim")]
    [AuthorizePage("invoice", "musteriTeklifi")]
    [AuthorizePage("invoice", "cariTeklifleri")]
    public async Task<IActionResult> GetByCode([FromRoute] string customerCode, CancellationToken cancellationToken = default)
    {
        customerCode = (customerCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(customerCode))
        {
            return BadRequest(new { success = false, message = "Geçersiz cari kodu" });
        }

        var entity = await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (entity is null)
        {
            return NotFound(new { success = false, message = "Cari bulunamadı" });
        }

        var data = new CustomerResponse
        {
            CustomerCode = entity.CustomerCode,
            Name = entity.Name,
            Address = entity.Address,
            City = entity.City,
            District = entity.District,
            Phone = entity.Phone,
            Fax = entity.Fax,
            Email = entity.Email,
            TaxOffice = entity.TaxOffice,
            TaxNumber = entity.TaxNumber,
            IdentityNumber = entity.IdentityNumber,
            CustomerType = entity.CustomerType,
            InvoiceType = entity.InvoiceType,
            ProductCategory = entity.ProductCategory,
            CategoryAccessMode = entity.CategoryAccessMode,
            IsActive = entity.IsActive,
            PriceGroupId = entity.PriceGroupId,
            DiscountRate = entity.DiscountRate,
            SalesmanCode = entity.SalesmanCode,
            CreditLimit = entity.CreditLimit,
                CreditLimitUsd = entity.CreditLimitUsd,
                CreditLimitEur = entity.CreditLimitEur,
                CreditLimitGbp = entity.CreditLimitGbp,
            ParentCustomerCode = entity.ParentCustomerCode,
            CurrencyTypeId = entity.CurrencyTypeId
        };

        var ids = await _dbContext.CustomerProductCategories
            .AsNoTracking()
            .Where(x => x.CustomerCode == data.CustomerCode)
            .Select(x => x.ProductCategoryId)
            .ToListAsync(cancellationToken);

        data.ProductCategoryIds = ids;

        return Ok(new { success = true, data });
    }

    [HttpGet("dropdown")]
    [Authorize]
    public async Task<IActionResult> GetDropdown(
        [FromQuery] bool includeInactive = false,
        [FromQuery] bool includeMuhtelif = false,
        [FromQuery] string? salesmanCode = null,
        [FromQuery] bool forOrder = false,
        [FromQuery] string? q = null,
        [FromQuery] int limit = 0,
        [FromQuery] bool lite = false,
        [FromQuery] string? customerType = null,
        CancellationToken cancellationToken = default)
    {
        // ARAMA VE SINIR SUNUCUDA (2026-08-21).
        //
        // Bu uç `q` diye bir parametre TANIMIYORDU. Arayüzdeki cari seçim kutusu her tuş
        // vuruşunda `?q=...` gönderiyor, uç onu sessizce yok sayıp BÜTÜN cari listesini geri
        // veriyordu; tarayıcı da binlerce satırı her harfte yeniden ayrıştırıp süzüyordu.
        // Sipariş ve Mağaza Sipariş ekranlarında seçim kutusunun kilitlenmesinin sebebi buydu.
        //
        // Süzgeç, liste kurulduktan SONRA uygulanıyor. Bu metodun üç ayrı dalı var (plasiyer
        // portföyü, dış kullanıcı kapsamı, yönetim) ve her birinin kendi sorgusu; sorgulara tek
        // tek dokunmak o dalların kurallarını bozma riski taşırdı. Buradaki tek süzgeç üçüne de
        // aynı şekilde uygulanır.
        //
        // `limit` VARSAYILAN 0 = SINIRSIZ. Bu ucu listeyi tümüyle isteyen yirmiden fazla ekran
        // kullanıyor (ekstre, kasa, banka, fatura listesi...); onların davranışı değişmemeli.
        // Sınırı yalnızca arama kutusu gönderir.
        //
        // Normalleştirme istemcideki `normalizeText` ile AYNI: küçük harf, Türkçe harfler ASCII
        // karşılığına, ayraçlar atılır. Farklı olsaydı sunucu istemciden dar süzer ve kullanıcı
        // aradığı cariyi hiç göremezdi. Süzgeç bilerek GENİŞ tutuluyor (alanlar birleştirilip
        // taranıyor); daraltmayı istemci kendi kuralıyla yapıyor.
        static string Norm(string? value)
        {
            if (string.IsNullOrEmpty(value)) return string.Empty;
            var lowered = value.ToLower(System.Globalization.CultureInfo.GetCultureInfo("tr-TR"));
            var sb = new System.Text.StringBuilder(lowered.Length);
            foreach (var ch in lowered)
            {
                switch (ch)
                {
                    case 'ı': sb.Append('i'); break;
                    case 'ğ': sb.Append('g'); break;
                    case 'ü': sb.Append('u'); break;
                    case 'ş': sb.Append('s'); break;
                    case 'ö': sb.Append('o'); break;
                    case 'ç': sb.Append('c'); break;
                    case ' ':
                    case '-':
                    case '(':
                    case ')':
                    case '.':
                    case ',':
                    case '/':
                    case '̇':
                        break;
                    default: sb.Append(ch); break;
                }
            }
            return sb.ToString();
        }

        // ARAMA OLCUTU TEK YERDE (2026-08-22).
        //
        // Ayni olcut iki yerden kullaniliyor: `Finish` (liste kurulduktan sonra suzen eski
        // yol) ve asagidaki DAR PROJEKSIYON yolu. Iki ayri kopya yazsaydik, biri degisip
        // digeri kalinca ayni arama iki farkli sonuc verirdi.
        var needleOnce = Norm(q);
        var needleDigitsOnce = new string(needleOnce.Where(char.IsDigit).ToArray());
        var needleWordsOnce = (q ?? string.Empty)
            .Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(Norm)
            .Where(w => w.Length > 0)
            .ToList();

        bool MatchesNeedle(string? customerCode, string? name, string? phone, string? taxNumber)
        {
            var full = Norm($"{customerCode} {name} {phone} {taxNumber}");
            if (full.Contains(needleOnce, StringComparison.Ordinal)) return true;

            if (needleDigitsOnce.Length >= 3)
            {
                var phoneDigits = new string((phone ?? string.Empty).Where(char.IsDigit).ToArray());
                if (phoneDigits.Contains(needleDigitsOnce, StringComparison.Ordinal)) return true;
            }

            if (needleWordsOnce.Count > 1 && needleWordsOnce.All(w => full.Contains(w, StringComparison.Ordinal))) return true;

            return false;
        }

        /*
          CARİ TİPİNE GÖRE SÜZME (2026-08-23, kullanıcı bildirimi:
          "hizmet alışında hiçbir hizmet carisi gelmiyor").

          Ekranlar bugüne kadar türü KOD ÖNEKİYLE arıyordu (`q='120-07'` gibi). Önek varsayımı
          bu firmada tutmuyor: hizmet carileri **770-01**, 120-07 ise **Çalışan**. Sonuç, arama
          yalnız çalışan carilerini getiriyor, ekrandaki `customerType == 'hizmet'` süzgeci de
          hepsini eliyor ve kutu BOŞ kalıyordu.

          Tür artık `CustomerType` alanından soruluyor; kod planı firmadan firmaya değişse de
          çalışır. Karşılaştırma Türkçe'ye duyarlı: `"HİZMET".ToLower()` başka kültürde
          "hi̇zmet" üretir ve tutmaz.

          Parametre GÖNDERİLMEZSE hiçbir şey değişmez — mevcut yirmiden fazla çağıran etkilenmez.
        */
        var typeNeedle = Norm(customerType);

        IActionResult Finish(List<CustomerResponse> list)
        {
            IEnumerable<CustomerResponse> result = list;

            if (needleOnce.Length > 0)
            {
                result = result.Where(x => MatchesNeedle(x.CustomerCode, x.Name, x.Phone, x.TaxNumber));
            }

            if (typeNeedle.Length > 0)
            {
                result = result.Where(x => Norm(x.CustomerType) == typeNeedle);
            }

            if (limit > 0) result = result.Take(limit);

            /**
             * `lite=true` — YALNIZCA SEÇİM İÇİN GEREKEN ALANLAR (2026-08-22).
             *
             * Bu uç satır başına 25 alan döndürüyor: adres, e-posta, vergi bilgileri, dört
             * ayrı kredi limiti… Cari SEÇME ekranlarının hiçbiri bunları kullanmıyor.
             * Canlıda ölçüldü: tam liste **4,2 MB**. Kullanıcı Listesi gibi listenin
             * TAMAMINA ihtiyaç duyan (plasiyer/şube kırılımıyla gruplama yapan) ekranlar
             * için istek kaldırılamıyor, ama taşıdığı veri kaldırılabiliyor.
             *
             * Seçiciye yeten beş alan: kod, ad, üst cari, cari tipi, plasiyer kodu.
             * Bayrağı GÖNDERMEYEN her çağıran eskisi gibi tam kaydı alır.
             */
            if (lite)
            {
                var slim = result.Select(x => new
                {
                    customerCode = x.CustomerCode,
                    name = x.Name,
                    parentCustomerCode = x.ParentCustomerCode,
                    customerType = x.CustomerType,
                    salesmanCode = x.SalesmanCode
                }).ToList();

                return Ok(new { success = true, data = slim });
            }

            return Ok(new { success = true, data = result.ToList() });
        }
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1" ||
                    User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        // The scope may name several customers now, so it is parsed rather than compared as one
        // string. A single stored code still parses to a one-item list.
        var isInternalUser = isSsa || CustomerScope.IsUnrestrictedFor(User);

        var targetSalesmanCode = !string.IsNullOrWhiteSpace(salesmanCode) ? salesmanCode.Trim() : null;

        var parentCodesQuery = _dbContext.Customers
            .Where(c => c.IsActive && c.ParentCustomerCode != null && c.ParentCustomerCode != "" && 
                        !c.CustomerCode.EndsWith("-1") && !c.CustomerCode.EndsWith("-2") && !c.CustomerCode.EndsWith("-3"))
            .Select(c => c.ParentCustomerCode)
            .Distinct();

        // 1. If filtering by a specific salesmanCode (plasiyer)
        if (targetSalesmanCode != null)
        {
            var rawCode = targetSalesmanCode.Trim();
            var unpadded = rawCode.TrimStart('0');
            if (string.IsNullOrEmpty(unpadded)) unpadded = rawCode;
            var padded1 = unpadded.PadLeft(2, '0');
            var padded2 = unpadded.PadLeft(3, '0');
            var padded3 = unpadded.PadLeft(4, '0');
            var matchedCodes = new[] { rawCode, unpadded, padded1, padded2, padded3 }.Distinct().ToList();

            var salesmanEntity = await _dbContext.Salesmen
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.SalesmanCode == rawCode || s.SalesmanCode == unpadded, cancellationToken);

            var salesmanDesc = salesmanEntity?.Description?.Trim();

            var directCustomerCodes = await _dbContext.Customers
                .AsNoTracking()
                .Where(x => x.SalesmanCode != null && 
                            (matchedCodes.Contains(x.SalesmanCode) || 
                             x.SalesmanCode.StartsWith(rawCode) || 
                             x.SalesmanCode.StartsWith(unpadded) ||
                             (salesmanDesc != null && salesmanDesc != "" && EF.Functions.ILike(x.SalesmanCode, "%" + salesmanDesc + "%"))))
                .Select(x => x.CustomerCode)
                .ToListAsync(cancellationToken);

            var plasiyerCustomers = await _dbContext.Customers
                .AsNoTracking()
                .Where(x => (includeInactive || x.IsActive) &&
                            !x.CustomerCode.EndsWith("-1") && !x.CustomerCode.EndsWith("-2") && !x.CustomerCode.EndsWith("-3") &&
                            (forOrder 
                                ? ((x.ParentCustomerCode != null && x.ParentCustomerCode != "") || !parentCodesQuery.Contains(x.CustomerCode)) 
                                : ((x.ParentCustomerCode == null || x.ParentCustomerCode == "") && !x.CustomerCode.StartsWith("01-"))
                            ) &&
                            (
                                (x.SalesmanCode != null && 
                                  (matchedCodes.Contains(x.SalesmanCode) || 
                                   x.SalesmanCode.StartsWith(rawCode) || 
                                   x.SalesmanCode.StartsWith(unpadded) ||
                                   (salesmanDesc != null && salesmanDesc != "" && EF.Functions.ILike(x.SalesmanCode, "%" + salesmanDesc + "%")))) || 
                                // Şube paylaşılmaz (2026-09-06): kendi plasiyeri olan şube
                                // ana carinin plasiyerinin listesine düşmez.
                                (forOrder && x.ParentCustomerCode != null
                                 && (x.SalesmanCode == null || x.SalesmanCode == "")
                                 && directCustomerCodes.Contains(x.ParentCustomerCode))
                            ))
                .OrderBy(x => x.CustomerCode)
                .Select(x => new CustomerResponse
                {
                    CustomerCode = x.CustomerCode,
                    Name = x.Name,
                    Address = x.Address,
                    City = x.City,
                    District = x.District,
                    Phone = x.Phone,
                    Fax = x.Fax,
                    Email = x.Email,
                    TaxOffice = x.TaxOffice,
                    TaxNumber = x.TaxNumber,
                    IdentityNumber = x.IdentityNumber,
                    CustomerType = x.CustomerType,
                    InvoiceType = x.InvoiceType,
                    ProductCategory = x.ProductCategory,
                    IsActive = x.IsActive,
                    PriceGroupId = x.PriceGroupId,
                    DiscountRate = x.DiscountRate,
                    SalesmanCode = x.SalesmanCode,
                    CreditLimit = x.CreditLimit,
                CreditLimitUsd = x.CreditLimitUsd,
                CreditLimitEur = x.CreditLimitEur,
                CreditLimitGbp = x.CreditLimitGbp,
                    ParentCustomerCode = x.ParentCustomerCode,
                    CurrencyTypeId = x.CurrencyTypeId
                })
                .ToListAsync(cancellationToken);

            if (isInternalUser)
            {
                var existingCodes = new HashSet<string>(plasiyerCustomers.Select(c => c.CustomerCode));
                var otherCustomers = await _dbContext.Customers
                    .AsNoTracking()
                    .Where(x => (includeInactive || x.IsActive) &&
                                !x.CustomerCode.EndsWith("-1") && !x.CustomerCode.EndsWith("-2") && !x.CustomerCode.EndsWith("-3") &&
                                (forOrder 
                                    ? ((x.ParentCustomerCode != null && x.ParentCustomerCode != "") || !parentCodesQuery.Contains(x.CustomerCode)) 
                                    : ((x.ParentCustomerCode == null || x.ParentCustomerCode == "") && !x.CustomerCode.StartsWith("01-"))
                                ) &&
                                !existingCodes.Contains(x.CustomerCode))
                    .OrderBy(x => x.CustomerCode)
                    .Select(x => new CustomerResponse
                    {
                        CustomerCode = x.CustomerCode,
                        Name = x.Name,
                        Address = x.Address,
                        City = x.City,
                        District = x.District,
                        Phone = x.Phone,
                        Fax = x.Fax,
                        Email = x.Email,
                        TaxOffice = x.TaxOffice,
                        TaxNumber = x.TaxNumber,
                        IdentityNumber = x.IdentityNumber,
                        CustomerType = x.CustomerType,
                        InvoiceType = x.InvoiceType,
                        ProductCategory = x.ProductCategory,
                        IsActive = x.IsActive,
                        PriceGroupId = x.PriceGroupId,
                        DiscountRate = x.DiscountRate,
                        SalesmanCode = x.SalesmanCode,
                        CreditLimit = x.CreditLimit,
                CreditLimitUsd = x.CreditLimitUsd,
                CreditLimitEur = x.CreditLimitEur,
                CreditLimitGbp = x.CreditLimitGbp,
                        ParentCustomerCode = x.ParentCustomerCode,
                        CurrencyTypeId = x.CurrencyTypeId
                    })
                    .ToListAsync(cancellationToken);

                plasiyerCustomers.AddRange(otherCustomers);
            }

            if (includeMuhtelif)
            {
                plasiyerCustomers.Insert(0, new CustomerResponse
                {
                    CustomerCode = "MUHTELIF",
                    Name = "Muhtelif",
                    IsActive = true
                });

                var muhtelifList = await _dbContext.MuhtelifCustomers
                    .AsNoTracking()
                    .OrderBy(x => x.CustomerCode)
                    .Select(x => new CustomerResponse
                    {
                        CustomerCode = x.CustomerCode,
                        Name = x.Name,
                        Address = x.Address,
                        City = x.City,
                        District = x.District,
                        Phone = x.Phone,
                        Email = x.Email,
                        TaxOffice = x.TaxOffice,
                        TaxNumber = x.TaxNumber,
                        IsActive = true
                    })
                    .ToListAsync(cancellationToken);

                plasiyerCustomers.AddRange(muhtelifList);
            }

            return Finish(plasiyerCustomers);
        }

        // 2. If user is external Bayi/Customer (NOT internal/management user)
        if (!isInternalUser)
        {
            var scopeCodes = CustomerScope.Of(User);
            if (scopeCodes.Count > 0)
            {
                var allowedCodes = new List<string>(scopeCodes);

                var branches = await _dbContext.Customers
                    .AsNoTracking()
                    .Where(x => (includeInactive || x.IsActive) &&
                                x.ParentCustomerCode != null &&
                                scopeCodes.Contains(x.ParentCustomerCode) &&
                                !x.CustomerCode.EndsWith("-1") && 
                                !x.CustomerCode.EndsWith("-2") && 
                                !x.CustomerCode.EndsWith("-3"))
                    .OrderBy(x => x.CustomerCode)
                    .Select(x => new CustomerResponse
                    {
                        CustomerCode = x.CustomerCode,
                        Name = x.Name,
                        Address = x.Address,
                        City = x.City,
                        District = x.District,
                        Phone = x.Phone,
                        Fax = x.Fax,
                        Email = x.Email,
                        TaxOffice = x.TaxOffice,
                        TaxNumber = x.TaxNumber,
                        IdentityNumber = x.IdentityNumber,
                        CustomerType = x.CustomerType,
                        InvoiceType = x.InvoiceType,
                        ProductCategory = x.ProductCategory,
                        IsActive = x.IsActive,
                        PriceGroupId = x.PriceGroupId,
                        DiscountRate = x.DiscountRate,
                        SalesmanCode = x.SalesmanCode,
                        CreditLimit = x.CreditLimit,
                CreditLimitUsd = x.CreditLimitUsd,
                CreditLimitEur = x.CreditLimitEur,
                CreditLimitGbp = x.CreditLimitGbp,
                        ParentCustomerCode = x.ParentCustomerCode,
                        CurrencyTypeId = x.CurrencyTypeId
                    })
                    .ToListAsync(cancellationToken);

                if (branches.Count > 0)
                {
                    allowedCodes.AddRange(branches.Select(x => x.CustomerCode).Where(x => !string.IsNullOrWhiteSpace(x)));
                }

                // A list, not one row: the scope may name several customers now. This branch was
                // written when it could only ever be one, so a second selected customer was
                // silently dropped here rather than at the query above.
                var mainCusts = await _dbContext.Customers
                    .AsNoTracking()
                    .Where(x => scopeCodes.Contains(x.CustomerCode))
                    .Select(x => new CustomerResponse
                    {
                        CustomerCode = x.CustomerCode,
                        Name = x.Name,
                        Address = x.Address,
                        City = x.City,
                        District = x.District,
                        Phone = x.Phone,
                        Fax = x.Fax,
                        Email = x.Email,
                        TaxOffice = x.TaxOffice,
                        TaxNumber = x.TaxNumber,
                        IdentityNumber = x.IdentityNumber,
                        CustomerType = x.CustomerType,
                        InvoiceType = x.InvoiceType,
                        ProductCategory = x.ProductCategory,
                        IsActive = x.IsActive,
                        PriceGroupId = x.PriceGroupId,
                        DiscountRate = x.DiscountRate,
                        SalesmanCode = x.SalesmanCode,
                        CreditLimit = x.CreditLimit,
                CreditLimitUsd = x.CreditLimitUsd,
                CreditLimitEur = x.CreditLimitEur,
                CreditLimitGbp = x.CreditLimitGbp,
                        ParentCustomerCode = x.ParentCustomerCode,
                        CurrencyTypeId = x.CurrencyTypeId
                    })
                    .OrderBy(x => x.CustomerCode)
                    .ToListAsync(cancellationToken);

                var allDropdownCustomers = new List<CustomerResponse>();
                if (forOrder)
                {
                    // Sipariş ekranında şubesi OLAN cari şubeleriyle temsil edilir, şubesi
                    // OLMAYAN kendisiyle.
                    //
                    // Kural CARİ BAZINDA uygulanır. Eskiden `branches.Count == 0` diye liste
                    // bazında bakılıyordu: portföydeki tek bir carinin şubesi olması bütün ana
                    // carileri listeden düşürüyordu. Plasiyer gibi çok carili kullanıcılarda
                    // ekranda yalnızca şubeler kalıyor, şubesiz ana cariler hiç görünmüyordu —
                    // superadmin'de doğru çalışmasının sebebi onun aşağıdaki (3.) daldan
                    // geçmesi ve kuralı zaten cari bazında uygulamasıydı.
                    var subesiOlanCariler = new HashSet<string>(
                        branches
                            .Select(b => b.ParentCustomerCode)
                            .Where(c => !string.IsNullOrWhiteSpace(c))
                            .Select(c => c!),
                        StringComparer.OrdinalIgnoreCase);

                    /*
                      MÜKERRER ŞUBE (2026-09-06 kullanıcı bildirimi: "aynı CHINA BAZAAR 3 kere
                      çıkıyor").

                      Aynı şube İKİ listeye birden giriyordu:
                        - `mainCusts`: kullanıcının cari listesinde şube kodu DOĞRUDAN yazılıysa
                          (canlıda yaygın: listede hem `120-01-000515` hem `01-000515-001` var),
                        - `branches`: ana carinin şubeleri olarak.
                      Şube kendisi "ana cari" olmadığı için `subesiOlanCariler` süzgecine de
                      takılmıyor ve dropdown'a iki kez düşüyordu.

                      Kod bazında tekilleştiriliyor; ilk giren kalır, sırası bozulmaz.
                    */
                    var eklenenKodlar = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var m in mainCusts)
                    {
                        var kod = m.CustomerCode ?? string.Empty;
                        if (subesiOlanCariler.Contains(kod)) continue;
                        if (!eklenenKodlar.Add(kod)) continue;
                        allDropdownCustomers.Add(m);
                    }
                    foreach (var b in branches)
                    {
                        if (!eklenenKodlar.Add(b.CustomerCode ?? string.Empty)) continue;
                        allDropdownCustomers.Add(b);
                    }
                }
                else
                {
                    /*
                      EKSTRE/RAPOR EKRANLARINDA ŞUBE AYRI SATIR DEĞİLDİR (2026-09-06 kullanıcı
                      bildirimi: "superadminde tek cari görüyorum, plasiyerde şubeler ayrı ayrı
                      geliyor").

                      Şubenin ekstresi ana cariye yönlendirilir — şube ana carinin bir ADRESİDİR,
                      ayrı bir hesap değil. Superadmin yolu bunu zaten yapıyordu
                      (`!CustomerCode.StartsWith("01-")`); kapsamlı kullanıcıda ise şube kodları
                      `Carikodu` listesine TEK TEK yazılı olduğu için her şube ayrı satır olarak
                      görünüyordu. İki yol artık aynı şeyi gösteriyor.

                      Yalnız `forOrder=false` için: sipariş ekranında şube AYRI seçilebilmeli
                      (mal oraya teslim ediliyor), orası yukarıdaki dalda ve değişmedi.
                    */
                    allDropdownCustomers.AddRange(
                        mainCusts.Where(m => !(m.CustomerCode ?? string.Empty)
                            .StartsWith("01-", StringComparison.OrdinalIgnoreCase)));
                }

                if (includeMuhtelif)
                {
                    allDropdownCustomers.Insert(0, new CustomerResponse
                    {
                        CustomerCode = "MUHTELIF",
                        Name = "Muhtelif",
                        IsActive = true
                    });

                    var muhtelifList = await _dbContext.MuhtelifCustomers
                        .AsNoTracking()
                        .Where(x => x.OwnerCustomerCode != null && allowedCodes.Contains(x.OwnerCustomerCode))
                        .OrderBy(x => x.CustomerCode)
                        .Select(x => new CustomerResponse
                        {
                            CustomerCode = x.CustomerCode,
                            Name = x.Name,
                            Address = x.Address,
                            City = x.City,
                            District = x.District,
                            Phone = x.Phone,
                            Email = x.Email,
                            TaxOffice = x.TaxOffice,
                            TaxNumber = x.TaxNumber,
                            IsActive = true
                        })
                        .ToListAsync(cancellationToken);

                    allDropdownCustomers.AddRange(muhtelifList);
                }

                return Finish(allDropdownCustomers);
            }
        }


        // 3. Internal users (Admin, Kurumsal, SuperAdmin) with no salesmanCode filter: return all active customers
        var baseQuery = _dbContext.Customers.AsNoTracking()
            .Where(x => !x.CustomerCode.EndsWith("-1") && !x.CustomerCode.EndsWith("-2") && !x.CustomerCode.EndsWith("-3"))
            .AsQueryable();

        if (forOrder)
        {
            baseQuery = baseQuery.Where(x => (x.ParentCustomerCode != null && x.ParentCustomerCode != "") || !parentCodesQuery.Contains(x.CustomerCode));
        }
        else
        {
            baseQuery = baseQuery.Where(x => (x.ParentCustomerCode == null || x.ParentCustomerCode == "") && !x.CustomerCode.StartsWith("01-"));
        }

        if (!includeInactive)
        {
            baseQuery = baseQuery.Where(x => x.IsActive);
        }

        /*
          CARİ TİPİ SÜZGECİ SORGUYA GİRER — SONRADAN DEĞİL (2026-08-23).

          Tür süzgeci önce yalnızca `Finish` içinde uygulanıyordu ve İŞE YARAMIYORDU: bu metot
          arama yokken sınırı SQL'de uyguluyor (`ordered.Take(limit)`), yani veritabanından
          KOD SIRASINA göre ilk N cari geliyor. Hizmet carileri 770-01'de, listenin en
          sonunda; ilk 200'ün içine hiç girmiyor ve sonradan süzülünce geriye HİÇBİR ŞEY
          kalmıyordu — "hizmet alışında cari gelmiyor" şikayeti düzelmemişti.

          `ILike` PostgreSQL'de büyük/küçük harf duyarsız EŞİTLİK (joker yok): 'Hizmet',
          'HİZMET', 'hizmet' hepsi tutar.
        */
        var typeFilter = (customerType ?? string.Empty).Trim();
        if (typeFilter.Length > 0)
        {
            baseQuery = baseQuery.Where(x => x.CustomerType != null &&
                                             EF.Functions.ILike(x.CustomerType, typeFilter));
        }

        /**
         * HIZLI YOL (2026-08-22) — SONUCU DEGISTIRMEZ, MALIYETI DEGISTIRIR.
         *
         * Eskiden bu dal HER ISTEKTE butun cari listesini (5000+ satir x 25 kolon)
         * `CustomerResponse` nesnelerine cevirip sonra bellekte 50'ye suzuyordu. Secim
         * kutusunu ACMAK bile bu taramayi yapiyordu; her tus vurusu bir kez daha.
         *
         * ESDEGERLIK NEDEN GARANTI:
         *   - `forOrder` / aktiflik / alt hesap kurallari ZATEN `baseQuery` icinde, SQL'de
         *     uygulaniyor (yukarida). Onlara dokunulmadi.
         *   - Siralama iki yolda da `OrderBy(CustomerCode)`.
         *   - Arama olcutu AYNI fonksiyon (`MatchesNeedle`), ayni sirayla, sonra ayni `limit`.
         * Yani secilen kayit kumesi ve sirasi birebir ayni; yalnizca kac satirin nesneye
         * cevrildigi degisiyor.
         *
         * HIZLI YOL YALNIZCA `includeMuhtelif == false` ICIN ACIK. Muhtelif acikken liste
         * kurulduktan SONRA basa "MUHTELIF" ekleniyor ve muhtelif cariler listeye katiliyor;
         * bunlar da suzgece ve limite giriyor. O durumda esdegerligi ispatlayamayacagim icin
         * eski yol aynen korunuyor.
         */
        List<CustomerResponse> allCustomers;

        // `limit > 0` SART: sinirsiz aramada eslesen kod sayisi binleri bulabilir ve ikinci
        // sorgunun IN listesi devasa olurdu. O durumda eski tek sorgulu yol kullanilir.
        // `typeNeedle` VARSA bu yol KULLANILMAZ: dar projeksiyon sinirlamayi tur suzgecinden
        // ONCE uygular (cektigi 4 kolonda `CustomerType` yok). Ilk 50 eslesme baska turdense
        // tur suzgeci geriye hicbir sey birakmaz ve kutu yine bos gorunurdu.
        if (!includeMuhtelif && needleOnce.Length > 0 && limit > 0 && typeNeedle.Length == 0)
        {
            // Once YALNIZCA arama alanlari cekilir (4 kolon). Eslesen kodlar bulunur,
            // limit uygulanir; tam satir yalnizca o kodlar icin okunur.
            var searchRows = await baseQuery
                .OrderBy(x => x.CustomerCode)
                .Select(x => new { x.CustomerCode, x.Name, x.Phone, x.TaxNumber })
                .ToListAsync(cancellationToken);

            var matchedCodes = searchRows
                .Where(x => MatchesNeedle(x.CustomerCode, x.Name, x.Phone, x.TaxNumber))
                .Select(x => x.CustomerCode)
                .ToList();

            if (limit > 0) matchedCodes = matchedCodes.Take(limit).ToList();

            allCustomers = await baseQuery
                .Where(x => matchedCodes.Contains(x.CustomerCode))
                .OrderBy(x => x.CustomerCode)
                .Select(x => new CustomerResponse
                {
                    CustomerCode = x.CustomerCode,
                    Name = x.Name,
                    Address = x.Address,
                    City = x.City,
                    District = x.District,
                    Phone = x.Phone,
                    Fax = x.Fax,
                    Email = x.Email,
                    TaxOffice = x.TaxOffice,
                    TaxNumber = x.TaxNumber,
                    IdentityNumber = x.IdentityNumber,
                    CustomerType = x.CustomerType,
                    InvoiceType = x.InvoiceType,
                    ProductCategory = x.ProductCategory,
                    IsActive = x.IsActive,
                    PriceGroupId = x.PriceGroupId,
                    DiscountRate = x.DiscountRate,
                    SalesmanCode = x.SalesmanCode,
                    CreditLimit = x.CreditLimit,
                    CreditLimitUsd = x.CreditLimitUsd,
                    CreditLimitEur = x.CreditLimitEur,
                    CreditLimitGbp = x.CreditLimitGbp,
                    ParentCustomerCode = x.ParentCustomerCode,
                    CurrencyTypeId = x.CurrencyTypeId
                })
                .ToListAsync(cancellationToken);
        }
        else
        {
            // Arama yoksa limit dogrudan SQL'e iner: `Finish` zaten ilk `limit` satiri
            // aliyordu, siralama da ayni — dolayisiyla donen satirlar birebir ayni.
            var ordered = baseQuery.OrderBy(x => x.CustomerCode);
            var paged = (!includeMuhtelif && limit > 0 && needleOnce.Length == 0)
                ? ordered.Take(limit)
                : (IQueryable<Customer>)ordered;

            allCustomers = await paged
                .Select(x => new CustomerResponse
                {
                    CustomerCode = x.CustomerCode,
                    Name = x.Name,
                    Address = x.Address,
                    City = x.City,
                    District = x.District,
                    Phone = x.Phone,
                    Fax = x.Fax,
                    Email = x.Email,
                    TaxOffice = x.TaxOffice,
                    TaxNumber = x.TaxNumber,
                    IdentityNumber = x.IdentityNumber,
                    CustomerType = x.CustomerType,
                    InvoiceType = x.InvoiceType,
                    ProductCategory = x.ProductCategory,
                    IsActive = x.IsActive,
                    PriceGroupId = x.PriceGroupId,
                    DiscountRate = x.DiscountRate,
                    SalesmanCode = x.SalesmanCode,
                    CreditLimit = x.CreditLimit,
                    CreditLimitUsd = x.CreditLimitUsd,
                    CreditLimitEur = x.CreditLimitEur,
                    CreditLimitGbp = x.CreditLimitGbp,
                    ParentCustomerCode = x.ParentCustomerCode,
                    CurrencyTypeId = x.CurrencyTypeId
                })
                .ToListAsync(cancellationToken);
        }

        if (includeMuhtelif)
        {
            allCustomers.Insert(0, new CustomerResponse
            {
                CustomerCode = "MUHTELIF",
                Name = "Muhtelif",
                IsActive = true
            });

            var muhtelifList = await _dbContext.MuhtelifCustomers
                .AsNoTracking()
                .OrderBy(x => x.CustomerCode)
                .Select(x => new CustomerResponse
                {
                    CustomerCode = x.CustomerCode,
                    Name = x.Name,
                    Address = x.Address,
                    City = x.City,
                    District = x.District,
                    Phone = x.Phone,
                    Email = x.Email,
                    TaxOffice = x.TaxOffice,
                    TaxNumber = x.TaxNumber,
                    IsActive = true
                })
                .ToListAsync(cancellationToken);

            allCustomers.AddRange(muhtelifList);
        }

        return Finish(allCustomers);
    }

    /// <summary>
    /// Müşteri carisinin varsayılan fiyat grubu kodu ("Açık 4"). Grup gönderilmediğinde
    /// kullanılır; bkz. <see cref="Create"/> içindeki emniyet ağı.
    /// </summary>
    private const int DefaultCustomerPriceGroupCode = 4;

    [HttpPost]
    [AuthorizePage("users", "cariEkle")]
    [AuthorizePage("invoice", "siparis")]
    [AuthorizePage("invoice", "magaza")]
    public async Task<IActionResult> Create([FromBody] CreateCustomerRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        // TELEFON TEKİLLİĞİ ŞUBELERDE ARANMAZ (2026-08-20, kullanıcı kararı).
        //
        // Kontrolün gerekçesi, aynı telefonla ikinci bir cari açılıp aynı kişinin bakiyesinin
        // ikiye bölünmesini engellemekti. Şubede durum tam tersi: bir firmanın bütün şubeleri
        // aynı santral numarasını paylaşır ve bu doğru veridir — CHINA BAZAAR'ın JUMBO,
        // KARAOĞLANOĞLU ve KARAKUM şubeleri ile ana carisi hepsi 0548 840 1620'de. Kontrol
        // uygulandığında bir firmanın yalnızca İLK şubesi açılabiliyor, gerisi reddediliyordu.
        //
        // Bakiye bölünmesi riski burada yok: şube zaten ana cariye ParentCustomerCode ile
        // bağlı ve ekstre ilişkili kodları birleştirerek gösteriyor.
        if (!string.IsNullOrWhiteSpace(request.Phone)
            && NormalizeCustomerType(request.CustomerType ?? string.Empty) != "sube")
        {
            var phone = request.Phone.Trim();
            var phoneExists = await _dbContext.Customers
                .AsNoTracking()
                .AnyAsync(x => x.Phone == phone, cancellationToken);
            if (phoneExists)
            {
                ModelState.AddModelError(nameof(request.Phone), "Bu telefon numarasına ait bir kayıt zaten mevcuttur.");
                return ValidationProblem(ModelState);
            }
        }

        var customerCode = (request.CustomerCode ?? string.Empty).Trim();
        var name = request.Name.Trim();
        var customerType = request.CustomerType.Trim();
        var invoiceType = request.InvoiceType.Trim();

        var normalizedTypeForCreate = NormalizeCustomerType(customerType);

        if (normalizedTypeForCreate == "sube")
        {
            var parent = (request.ParentCustomerCode ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(parent))
            {
                ModelState.AddModelError(nameof(request.ParentCustomerCode), "Şube için bağlı cari seçilmelidir.");
            }
            else
            {
                var parentExists = await _dbContext.Customers
                    .AsNoTracking()
                    .AnyAsync(x => x.CustomerCode == parent, cancellationToken);

                if (!parentExists)
                {
                    ModelState.AddModelError(nameof(request.ParentCustomerCode), "ParentCustomerCode is invalid.");
                }
                else if (!TryParseParentForBranchCode(parent, out var branchBasePrefix))
                {
                    ModelState.AddModelError(nameof(request.ParentCustomerCode), "ParentCustomerCode format is invalid.");
                }
                else
                {
                    customerCode = await ReserveNextBranchCustomerCode(branchBasePrefix, cancellationToken);
                }
            }
        }
        else if (customerCode.Length == 0)
        {
            var prefix = ResolveCustomerPrefixByType(normalizedTypeForCreate);
            if (string.IsNullOrWhiteSpace(prefix))
            {
                ModelState.AddModelError(nameof(request.CustomerType), "CustomerType is invalid.");
            }
            else
            {
                customerCode = await ReserveNextCustomerCode(prefix, cancellationToken);
            }
        }
        if (name.Length == 0) ModelState.AddModelError(nameof(request.Name), "Name is required.");
        if (customerType.Length == 0) ModelState.AddModelError(nameof(request.CustomerType), "CustomerType is required.");
        if (invoiceType.Length == 0) ModelState.AddModelError(nameof(request.InvoiceType), "InvoiceType is required.");

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var exists = await _dbContext.Customers
            .AsNoTracking()
            .AnyAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (exists)
        {
            var normalizedType = NormalizeCustomerType(customerType);
            var prefix = ResolveCustomerPrefixByType(normalizedType);
            if (string.IsNullOrWhiteSpace(prefix))
            {
                ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode must be unique.");
                return ValidationProblem(ModelState);
            }

            customerCode = await ReserveNextCustomerCode(prefix, cancellationToken);
        }

        // Şubede fiyat grubu formdan DEĞİL bağlı cariden okunur; bkz. ResolveBranchPriceGroupIdAsync.
        var effectivePriceGroupId = await ResolveBranchPriceGroupIdAsync(
            normalizedTypeForCreate, request.ParentCustomerCode, request.PriceGroupId, cancellationToken);

        /*
         * MÜŞTERİ CARİSİ GRUPSUZ AÇILAMAZ — EMNİYET AĞI (2026-09-08).
         *
         * Fiyat grubu bu uca isteğe bağlı geliyor ve gelmediğinde cari HİÇBİR gruba
         * bağlanmadan kaydediliyordu. Görünürde çalışıyor, sessizce yarım:
         *   - aşağıdaki "grup kodu 4-6 ise `InvoiceType = ACIK` + `AccountRole = OpenMain`"
         *     dönüşümü hiç tetiklenmiyor, cari FATURA/Normal kalıyor,
         *   - `EnsureSubAccountsCreatedAsync` alt hesapları da grupsuz kuruyor,
         *   - fiyatlandırma cariye bağlı gruptan okunamıyor.
         *
         * Canlıda birden fazla ekran bu uca grup göndermiyordu (servis "Yeni Müşteri Ekle"
         * modalı, teknisyen deposu modalı) ve ERP cari formunda da fatura tipi kutusuna hiç
         * dokunulmazsa grup boş kalabiliyor. Üç ayrı istemciyi tek tek düzeltmek bu deliği
         * kapatmıyor: dördüncüsü yazıldığında aynı hata geri gelir. Karar sunucuda.
         *
         * Yalnızca MÜŞTERİ tipinde ve YALNIZCA grup hiç gelmediğinde devreye giriyor;
         * gönderilen bir grubu asla ezmiyor. Bayi/çalışan/şube tiplerine dokunmuyor —
         * onların grubu iş kuralına göre değişiyor. Grup 4 bulunamazsa (kurulmamış firma)
         * eski davranış korunuyor, kayıt reddedilmiyor.
         */
        if (!effectivePriceGroupId.HasValue && normalizedTypeForCreate == "musteri")
        {
            effectivePriceGroupId = await _dbContext.PriceGroups
                .AsNoTracking()
                .Where(x => x.Code == DefaultCustomerPriceGroupCode && x.IsActive)
                .Select(x => (Guid?)x.Id)
                .FirstOrDefaultAsync(cancellationToken);
        }

        if (effectivePriceGroupId.HasValue)
        {
            var pgExists = await _dbContext.PriceGroups
                .AsNoTracking()
                .AnyAsync(x => x.Id == effectivePriceGroupId.Value, cancellationToken);

            if (!pgExists)
            {
                ModelState.AddModelError(nameof(request.PriceGroupId), "PriceGroupId is invalid.");
                return ValidationProblem(ModelState);
            }

            var pgInvoiceType = await _dbContext.PriceGroups
                .AsNoTracking()
                .Where(x => x.Id == effectivePriceGroupId.Value)
                .Select(x => x.InvoiceType)
                .FirstOrDefaultAsync(cancellationToken);

            if (!string.IsNullOrWhiteSpace(pgInvoiceType))
            {
                invoiceType = pgInvoiceType.Trim();
            }
        }

        if (!string.IsNullOrWhiteSpace(request.ParentCustomerCode))
        {
            var parentCode = request.ParentCustomerCode.Trim();
            var parentExists = await _dbContext.Customers
                .AsNoTracking()
                .AnyAsync(x => x.CustomerCode == parentCode, cancellationToken);

            if (!parentExists)
            {
                ModelState.AddModelError(nameof(request.ParentCustomerCode), "ParentCustomerCode is invalid.");
                return ValidationProblem(ModelState);
            }
        }

        var accountRole = CustomerAccountRole.Normal;
        if (invoiceType.Equals("ACIK", StringComparison.OrdinalIgnoreCase))
        {
            accountRole = CustomerAccountRole.OpenMain;
        }

        if (effectivePriceGroupId.HasValue)
        {
            var pgCode = await _dbContext.PriceGroups
                .AsNoTracking()
                .Where(x => x.Id == effectivePriceGroupId.Value)
                .Select(x => (int?)x.Code)
                .FirstOrDefaultAsync(cancellationToken);

            if (pgCode.HasValue && _priceGroupMappingService.IsOpenGroupCode(pgCode.Value))
            {
                accountRole = CustomerAccountRole.OpenMain;
                invoiceType = "ACIK";
            }
        }

        var entity = new Customer
        {
            CustomerCode = customerCode,
            Name = name,
            Address = request.Address?.Trim(),
            City = request.City?.Trim(),
            District = request.District?.Trim(),
            Phone = request.Phone?.Trim(),
            Fax = request.Fax?.Trim(),
            Email = request.Email?.Trim().ToLowerInvariant(),
            TaxOffice = request.TaxOffice?.Trim(),
            TaxNumber = request.TaxNumber?.Trim(),
            IdentityNumber = request.IdentityNumber?.Trim(),
            CustomerType = customerType,
            InvoiceType = invoiceType,
            AccountRole = accountRole,
            MainCustomerCode = null,
            ProductCategory = request.ProductCategory?.Trim(),
            CategoryAccessMode = request.CategoryAccessMode,
            IsActive = request.IsActive,
            PriceGroupId = effectivePriceGroupId,
            DiscountRate = request.DiscountRate,
            SalesmanCode = request.SalesmanCode?.Trim(),
            CreditLimit = request.CreditLimit,
            CreditLimitUsd = request.CreditLimitUsd,
            CreditLimitEur = request.CreditLimitEur,
            CreditLimitGbp = request.CreditLimitGbp,
            ParentCustomerCode = request.ParentCustomerCode?.Trim(),
            CurrencyTypeId = request.CurrencyTypeId,
            CreateUser = User.Identity?.Name ?? "System",
            CreateTime = DateTime.UtcNow
        };

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        _dbContext.Customers.Add(entity);

        var categoryIds = request.CategoryAccessMode == CategoryAccessMode.Custom
            ? (request.ProductCategoryIds?.Distinct().ToList() ?? new List<Guid>())
            : new List<Guid>();

        if (request.CategoryAccessMode == CategoryAccessMode.Custom && categoryIds.Count > 0)
        {
            var existsCount = await _dbContext.ProductCategories
                .AsNoTracking()
                .Where(x => categoryIds.Contains(x.Id))
                .Select(x => x.Id)
                .Distinct()
                .CountAsync(cancellationToken);

            if (existsCount != categoryIds.Count)
            {
                ModelState.AddModelError(nameof(request.ProductCategoryIds), "ProductCategoryIds contains invalid category id.");
                return ValidationProblem(ModelState);
            }

            foreach (var id in categoryIds)
            {
                _dbContext.CustomerProductCategories.Add(new CustomerProductCategory
                {
                    CustomerCode = entity.CustomerCode,
                    ProductCategoryId = id
                });
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Plasiyerin cari listesi kendiliğinden güncellensin; kullanıcı ekranına gidip elle
        // işaretlemek gerekmesin. Yeni caride önceki plasiyer yok.
        await SyncSalesmanCustomerListAsync(entity.CustomerCode, entity.SalesmanCode, null, cancellationToken);

        await _customerAccountService.EnsureSubAccountsCreatedAsync(entity, cancellationToken);

        if (request.InitialBalance.HasValue && request.InitialBalance.Value != 0m)
        {
            var isAskeriye = entity.InvoiceType.Equals("ASKERIYE", StringComparison.OrdinalIgnoreCase) || entity.InvoiceType.Equals("ASKERİYE", StringComparison.OrdinalIgnoreCase);
            var isAcik = !isAskeriye && entity.InvoiceType.Equals("ACIK", StringComparison.OrdinalIgnoreCase);
            var targetCustomerCode = isAskeriye ? (entity.CustomerCode + "-3") : (isAcik ? (entity.CustomerCode + "-2") : (entity.CustomerCode + "-1"));

            var activePeriodId = await _dbContext.AccountingPeriods
                .AsNoTracking()
                .Where(x => x.IsActive && x.Status == AccountingPeriodStatus.Open)
                .OrderByDescending(x => x.FiscalYear)
                .Select(x => (int?)x.Id)
                .FirstOrDefaultAsync(cancellationToken);

            // Devir tutarı CARİNİN KENDİ para birimindedir (form alanı döviz seçicisinin hemen
            // altında ve `CurrencyAmount`a da aynen yazılıyordu). TL çapası olan `Amount` ise
            // kurla çarpılmalı: öncesinde kur sabit 1 yazıldığı için 10.000 $'lık bir devir
            // deftere 10.000 ₺ olarak düşüyordu. Bu bir rapor değil, KREDİ LİMİTİ yolu —
            // `CreditLimitService` TL kolonunu okur, yani dövizli cari borcunun ~kur katı
            // kadar altında görünüp limitini kat kat aşabiliyordu. (Aynı sınıf hata çeklerde
            // de vardı; bkz. CustomerChecksController / LimitRiskReport.)
            var openingCurrencyTypeId = CurrencyTypeHelper.Normalize(entity.CurrencyTypeId);
            var openingRate = await ResolveTryRateAsync(openingCurrencyTypeId, cancellationToken);
            var openingFxAmount = Math.Abs(request.InitialBalance.Value);
            var openingTryAmount = Math.Round(openingFxAmount * openingRate, 2, MidpointRounding.AwayFromZero);

            var ledgerEntry = new CustomerLedgerEntry
            {
                CustomerCode = targetCustomerCode,
                Date = DateTime.UtcNow,
                Direction = request.InitialBalance.Value > 0m ? CustomerLedgerEntryDirection.Debit : CustomerLedgerEntryDirection.Credit,
                Amount = openingTryAmount,
                CurrencyTypeId = openingCurrencyTypeId,
                CurrencyRate = openingRate,
                CurrencyAmount = openingFxAmount,
                // Devirde ödeme yok; satır yine de kendi içinde TUTARLI olmalı: üçlü
                // (para birimi + kur + tutar) aynı parayı anlatır ve `tutar × kur = Amount`
                // eşitliğini sağlamalıdır. Kur 1 bırakılınca üçlü çelişiyordu
                // (10.000 USD × 1 ≠ 380.000 ₺) ve `Amount / PaymentCurrencyRate` okuyan her yol
                // devri 380.000 USD sanıyordu. Açılışın kuru, borcun kuruyla aynıdır.
                PaymentCurrencyTypeId = openingCurrencyTypeId,
                PaymentCurrencyRate = openingRate <= 0m ? 1.0m : openingRate,
                PaymentCurrencyAmount = openingFxAmount,
                DocumentNo = "DEVİR",
                Description = "Aktif Ekstre Başlangıç Bakiyesi",
                TransactionType = "DEVİR",
                ReferenceType = CustomerLedgerEntryReferenceType.OpeningBalance,
                AccountingPeriodId = activePeriodId,
                IsOpeningBalance = false,
                CreateUser = User.Identity?.Name ?? "System",
                CreateTime = DateTime.UtcNow
            };

            _dbContext.CustomerLedgerEntries.Add(ledgerEntry);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        if (!string.IsNullOrWhiteSpace(entity.SalesmanCode))
        {
            var salesman = await _dbContext.Salesmen
                .FirstOrDefaultAsync(x => x.SalesmanCode == entity.SalesmanCode, cancellationToken);

            if (salesman is not null)
            {
                salesman.CustomerCode = entity.CustomerCode;
                salesman.EditUser = User.Identity?.Name ?? "System";
                salesman.EditTime = DateTime.UtcNow;
                await _dbContext.SaveChangesAsync(cancellationToken);
            }
        }

        await tx.CommitAsync(cancellationToken);

        var response = new CustomerResponse
        {
            CustomerCode = entity.CustomerCode,
            Name = entity.Name,
            Address = entity.Address,
            City = entity.City,
            District = entity.District,
            Phone = entity.Phone,
            Fax = entity.Fax,
            Email = entity.Email,
            TaxOffice = entity.TaxOffice,
            TaxNumber = entity.TaxNumber,
            IdentityNumber = entity.IdentityNumber,
            CustomerType = entity.CustomerType,
            InvoiceType = entity.InvoiceType,
            AccountRole = entity.AccountRole,
            MainCustomerCode = entity.MainCustomerCode,
            InvoiceAccountCustomerCode = CustomerAccountHelper.BuildInvoiceAccountCode(entity.CustomerCode),
            ProductCategory = entity.ProductCategory,
            IsActive = entity.IsActive,
            PriceGroupId = entity.PriceGroupId,
            DiscountRate = entity.DiscountRate,
            SalesmanCode = entity.SalesmanCode,
            CreditLimit = entity.CreditLimit,
                CreditLimitUsd = entity.CreditLimitUsd,
                CreditLimitEur = entity.CreditLimitEur,
                CreditLimitGbp = entity.CreditLimitGbp,
            ParentCustomerCode = entity.ParentCustomerCode,
            ProductCategoryIds = categoryIds
        };

        return Ok(new { success = true, message = "Cari oluşturuldu", data = response });
    }


    /// <summary>
    /// Cariye plasiyer atandığında, O PLASİYERİN kullanıcı kaydındaki cari listesini günceller.
    ///
    /// NEDEN: yetki `Users.Carikodu` listesinden okunuyor, cari-plasiyer bağı ise
    /// `Customers.SalesmanCode`'da. İkisi ayrı yerde durduğu için yeni cari açıldığında
    /// plasiyer onu göremiyor, kullanıcı ekranına gidip elle işaretlemek gerekiyordu.
    /// Artık cari kaydedilirken liste kendiliğinden güncelleniyor.
    ///
    /// SADECE LİSTE TABANLI plasiyerler etkilenir. Kapsamı `*` (tüm cariler) olan kullanıcılara
    /// DOKUNULMAZ: onlar zaten her cariyi görüyor ve listeye kod yazmak, sınırsız yetkiyi
    /// yanlışlıkla sınırlı bir listeye çevirirdi.
    ///
    /// Plasiyer DEĞİŞTİYSE cari eski plasiyerin listesinden çıkarılır; yoksa listeler yalnızca
    /// büyür ve devredilen cariyi eski plasiyer görmeye devam eder.
    /// </summary>
    /// <summary>
    /// Plasiyerin cari kapsamı senkronu — gövde <see cref="Core.Helpers.SalesmanCustomerScopeSync"/>
    /// içinde. Müşteri Teklifi ekranının "Cari Ekle" ucu da aynı senkronu kullandığı için ortak
    /// yardımcıya taşındı; buradaki imza ve davranış değişmedi.
    /// </summary>
    private Task SyncSalesmanCustomerListAsync(
        string customerCode,
        string? newSalesmanCode,
        string? previousSalesmanCode,
        CancellationToken cancellationToken)
        => Core.Helpers.SalesmanCustomerScopeSync.SyncAsync(
            _dbContext, customerCode, newSalesmanCode, previousSalesmanCode, cancellationToken);

    [HttpPut("{customerCode}")]
    [AuthorizePage("users", "cariEkle")]
    [AuthorizePage("invoice", "siparis")]
    [AuthorizePage("invoice", "magaza")]
    public async Task<IActionResult> Update([FromRoute] string customerCode, [FromBody] UpdateCustomerRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        customerCode = customerCode.Trim();
        if (customerCode.Length == 0)
        {
            return BadRequest(new { success = false, message = "Geçersiz cari kodu" });
        }

        var entity = await _dbContext.Customers
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (entity is null)
        {
            return NotFound(new { success = false, message = "Cari bulunamadı" });
        }

        var name = request.Name.Trim();
        var customerType = request.CustomerType.Trim();
        var invoiceType = request.InvoiceType.Trim();

        if (name.Length == 0) ModelState.AddModelError(nameof(request.Name), "Name is required.");
        if (customerType.Length == 0) ModelState.AddModelError(nameof(request.CustomerType), "CustomerType is required.");
        if (invoiceType.Length == 0) ModelState.AddModelError(nameof(request.InvoiceType), "InvoiceType is required.");

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        // Şubede fiyat grubu formdan DEĞİL bağlı cariden okunur; bkz. ResolveBranchPriceGroupIdAsync.
        // Düzenlemede de zorunlu: kayıt sonradan başka bir gruba çekilebilseydi şube yine ana
        // cariden ayrı fiyatlanmaya başlardı.
        var effectivePriceGroupId = await ResolveBranchPriceGroupIdAsync(
            NormalizeCustomerType(customerType), request.ParentCustomerCode, request.PriceGroupId, cancellationToken);

        if (effectivePriceGroupId.HasValue)
        {
            var pgExists = await _dbContext.PriceGroups
                .AsNoTracking()
                .AnyAsync(x => x.Id == effectivePriceGroupId.Value, cancellationToken);

            if (!pgExists)
            {
                ModelState.AddModelError(nameof(request.PriceGroupId), "PriceGroupId is invalid.");
                return ValidationProblem(ModelState);
            }

            var pgInvoiceType = await _dbContext.PriceGroups
                .AsNoTracking()
                .Where(x => x.Id == effectivePriceGroupId.Value)
                .Select(x => x.InvoiceType)
                .FirstOrDefaultAsync(cancellationToken);

            if (!string.IsNullOrWhiteSpace(pgInvoiceType))
            {
                invoiceType = pgInvoiceType.Trim();
            }
        }

        if (!string.IsNullOrWhiteSpace(request.ParentCustomerCode))
        {
            var parentCode = request.ParentCustomerCode.Trim();
            if (parentCode == customerCode)
            {
                ModelState.AddModelError(nameof(request.ParentCustomerCode), "ParentCustomerCode cannot be same as CustomerCode.");
                return ValidationProblem(ModelState);
            }

            var parentExists = await _dbContext.Customers
                .AsNoTracking()
                .AnyAsync(x => x.CustomerCode == parentCode, cancellationToken);

            if (!parentExists)
            {
                ModelState.AddModelError(nameof(request.ParentCustomerCode), "ParentCustomerCode is invalid.");
                return ValidationProblem(ModelState);
            }
        }

        var oldCustomerCode = entity.CustomerCode;
        var oldNormalizedType = NormalizeCustomerType(entity.CustomerType);
        var nextNormalizedType = NormalizeCustomerType(customerType);
        var shouldRegenerateCustomerCode = oldNormalizedType != nextNormalizedType;

        string? regeneratedCustomerCode = null;
        if (shouldRegenerateCustomerCode)
        {
            if (nextNormalizedType == "sube")
            {
                var parent = (request.ParentCustomerCode ?? string.Empty).Trim();
                if (string.IsNullOrWhiteSpace(parent))
                {
                    ModelState.AddModelError(nameof(request.ParentCustomerCode), "Şube için bağlı cari seçilmelidir.");
                    return ValidationProblem(ModelState);
                }

                var parentExists = await _dbContext.Customers
                    .AsNoTracking()
                    .AnyAsync(x => x.CustomerCode == parent, cancellationToken);

                if (!parentExists)
                {
                    ModelState.AddModelError(nameof(request.ParentCustomerCode), "ParentCustomerCode is invalid.");
                    return ValidationProblem(ModelState);
                }

                if (!TryParseParentForBranchCode(parent, out var branchBasePrefix))
                {
                    ModelState.AddModelError(nameof(request.ParentCustomerCode), "ParentCustomerCode format is invalid.");
                    return ValidationProblem(ModelState);
                }

                regeneratedCustomerCode = await ReserveNextBranchCustomerCode(branchBasePrefix, cancellationToken);
            }
            else
            {
                var prefix = ResolveCustomerPrefixByType(nextNormalizedType);
                if (string.IsNullOrWhiteSpace(prefix))
                {
                    ModelState.AddModelError(nameof(request.CustomerType), "CustomerType is invalid.");
                    return ValidationProblem(ModelState);
                }

                regeneratedCustomerCode = await ReserveNextCustomerCode(prefix, cancellationToken);
            }
        }

        if (invoiceType.Equals("ACIK", StringComparison.OrdinalIgnoreCase))
        {
            entity.AccountRole = CustomerAccountRole.OpenMain;
        }

        entity.Name = name;
        entity.Address = request.Address?.Trim();
        entity.City = request.City?.Trim();
        entity.District = request.District?.Trim();
        entity.Phone = request.Phone?.Trim();
        entity.Fax = request.Fax?.Trim();
        entity.Email = request.Email?.Trim().ToLowerInvariant();
        entity.TaxOffice = request.TaxOffice?.Trim();
        entity.TaxNumber = request.TaxNumber?.Trim();
        entity.IdentityNumber = request.IdentityNumber?.Trim();
        entity.CustomerType = customerType;
        entity.InvoiceType = invoiceType;
        entity.ProductCategory = request.ProductCategory?.Trim();
        entity.CategoryAccessMode = request.CategoryAccessMode;
        entity.IsActive = request.IsActive;
        var previousPriceGroupId = entity.PriceGroupId;
        entity.PriceGroupId = effectivePriceGroupId;
        entity.DiscountRate = request.DiscountRate;
        // Plasiyer değişmiş olabilir; listeden çıkarma için eski değer gerekiyor.
        var previousSalesmanCode = entity.SalesmanCode;
        entity.SalesmanCode = request.SalesmanCode?.Trim();
        entity.CreditLimit = request.CreditLimit;
        entity.CreditLimitUsd = request.CreditLimitUsd;
        entity.CreditLimitEur = request.CreditLimitEur;
        entity.CreditLimitGbp = request.CreditLimitGbp;
        // ÜST CARİ DÖNGÜSÜ ENGELLENİR (denetim md. 22).
        //
        // A'nın üstü B, B'nin üstü A yapılabiliyordu. Üst koda göre yukarı yürüyen her sorgu
        // (ekstre konsolidasyonu, şube toplama) böyle bir halkada sonsuz döngüye girer.
        // Kendini üst göstermek de aynı halkanın en kısa hâlidir.
        var requestedParent = request.ParentCustomerCode?.Trim();
        if (!string.IsNullOrWhiteSpace(requestedParent))
        {
            if (string.Equals(requestedParent, entity.CustomerCode, StringComparison.OrdinalIgnoreCase))
            {
                return BadRequest(new { success = false, message = "Bir cari kendisinin üst carisi olamaz." });
            }

            // Zincirde yukarı yürü: yolda bu cariye geri dönülüyorsa halka oluşuyor demektir.
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { entity.CustomerCode };
            var cursor = requestedParent;
            for (var depth = 0; depth < 20 && !string.IsNullOrWhiteSpace(cursor); depth++)
            {
                if (!seen.Add(cursor))
                {
                    return BadRequest(new { success = false, message = "Üst cari zinciri kendine dönüyor (döngü). Lütfen farklı bir üst cari seçin." });
                }

                cursor = await _dbContext.Customers
                    .AsNoTracking()
                    .Where(x => x.CustomerCode == cursor)
                    .Select(x => x.ParentCustomerCode)
                    .FirstOrDefaultAsync(cancellationToken);
            }
        }

        entity.ParentCustomerCode = requestedParent;
        entity.CurrencyTypeId = request.CurrencyTypeId;
        entity.EditUser = User.Identity?.Name ?? "System";
        entity.EditTime = DateTime.UtcNow;

        if (effectivePriceGroupId.HasValue)
        {
            var pgCode = await _dbContext.PriceGroups
                .AsNoTracking()
                .Where(x => x.Id == effectivePriceGroupId.Value)
                .Select(x => (int?)x.Code)
                .FirstOrDefaultAsync(cancellationToken);

            if (pgCode.HasValue && _priceGroupMappingService.IsOpenGroupCode(pgCode.Value))
            {
                entity.AccountRole = CustomerAccountRole.OpenMain;
                entity.InvoiceType = "ACIK";
            }
        }

        await _customerAccountService.EnsureSubAccountsCreatedAsync(entity, cancellationToken);
        await _customerAccountService.SyncSubAccountUpperInfoAsync(entity, cancellationToken);
        // Fatura tipi bu yolda formdan/gruptan zaten kuruldu; burada rol + alt hesaplar hizalanır.
        await AlignCustomerToPriceGroupAsync(entity, previousPriceGroupId, takeInvoiceTypeFromGroup: false, cancellationToken);
        await SyncBranchPriceGroupsAsync(entity, cancellationToken);

        var categoryIds = request.ProductCategoryIds?.Distinct().ToList() ?? new List<Guid>();
        if (categoryIds.Count > 0)
        {
            var existsCount = await _dbContext.ProductCategories
                .AsNoTracking()
                .Where(x => categoryIds.Contains(x.Id))
                .Select(x => x.Id)
                .Distinct()
                .CountAsync(cancellationToken);

            if (existsCount != categoryIds.Count)
            {
                ModelState.AddModelError(nameof(request.ProductCategoryIds), "ProductCategoryIds contains invalid category id.");
                return ValidationProblem(ModelState);
            }
        }

        if (!string.IsNullOrWhiteSpace(regeneratedCustomerCode) && regeneratedCustomerCode != oldCustomerCode)
        {
            // Option B: Create new Customer row, move all references, then delete old.
            await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

            var newEntity = new Customer
            {
                CustomerCode = regeneratedCustomerCode,
                Name = entity.Name,
                Address = entity.Address,
                City = entity.City,
                District = entity.District,
                Phone = entity.Phone,
                Fax = entity.Fax,
                Email = entity.Email,
                TaxOffice = entity.TaxOffice,
                TaxNumber = entity.TaxNumber,
                IdentityNumber = entity.IdentityNumber,
                CustomerType = entity.CustomerType,
                InvoiceType = entity.InvoiceType,
                ProductCategory = entity.ProductCategory,
                CategoryAccessMode = entity.CategoryAccessMode,
                IsActive = entity.IsActive,
                PriceGroupId = entity.PriceGroupId,
                DiscountRate = entity.DiscountRate,
                SalesmanCode = entity.SalesmanCode,
                CreditLimit = entity.CreditLimit,
                CreditLimitUsd = entity.CreditLimitUsd,
                CreditLimitEur = entity.CreditLimitEur,
                CreditLimitGbp = entity.CreditLimitGbp,
                ParentCustomerCode = entity.ParentCustomerCode,
                CurrencyTypeId = entity.CurrencyTypeId,
                CreateUser = entity.CreateUser,
                CreateTime = entity.CreateTime,
                EditUser = entity.EditUser,
                EditTime = entity.EditTime
            };

            _dbContext.Customers.Add(newEntity);
            await _dbContext.SaveChangesAsync(cancellationToken);

            // Cascade updates (string FK columns)
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"CustomerAuthorizedContacts\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"CustomerProductCategories\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"CustomerProductPriceOverrides\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);

            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Salesmen\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);

            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"SalesOrders\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"SalesOrders\" SET \"DeliveryCustomerCode\" = {regeneratedCustomerCode} WHERE \"DeliveryCustomerCode\" = {oldCustomerCode}", cancellationToken);

            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Invoices\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Invoices\" SET \"DeliveryCustomerCode\" = {regeneratedCustomerCode} WHERE \"DeliveryCustomerCode\" = {oldCustomerCode}", cancellationToken);

            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"StockMovements\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"StockMovements\" SET \"DeliveryCustomerCode\" = {regeneratedCustomerCode} WHERE \"DeliveryCustomerCode\" = {oldCustomerCode}", cancellationToken);

            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"CustomerLedgerEntries\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"CustomerLedgerEntries\" SET \"DeliveryCustomerCode\" = {regeneratedCustomerCode} WHERE \"DeliveryCustomerCode\" = {oldCustomerCode}", cancellationToken);

            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"CustomerChecks\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"CustomerChecks\" SET \"CurrentCustomerCode\" = {regeneratedCustomerCode} WHERE \"CurrentCustomerCode\" = {oldCustomerCode}", cancellationToken);

            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"CheckOperations\" SET \"TargetCustomerCode\" = {regeneratedCustomerCode} WHERE \"TargetCustomerCode\" = {oldCustomerCode}", cancellationToken);

            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Irsaliye\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);

            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"CustomerOffers\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"CariOffers\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);

            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"PurchaseInvoices\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"PayableChecks\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"PayableNotes\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);

            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"MuhtelifCustomers\" SET \"OwnerCustomerCode\" = {regeneratedCustomerCode} WHERE \"OwnerCustomerCode\" = {oldCustomerCode}", cancellationToken);
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"MuhtelifCustomers\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"BayiMuhtelifCustomers\" SET \"OwnerCustomerCode\" = {regeneratedCustomerCode} WHERE \"OwnerCustomerCode\" = {oldCustomerCode}", cancellationToken);
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"BayiMuhtelifCustomers\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);

            // Parent/child relation
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Customers\" SET \"ParentCustomerCode\" = {regeneratedCustomerCode} WHERE \"ParentCustomerCode\" = {oldCustomerCode}", cancellationToken);

            // ── Cascade listesinde EKSİK KALAN tablolar ────────────────────────────────
            // Bunlar cariye string kodla bağlı ama kod değişiminde güncellenmiyordu:
            // carinin geçmiş banka/kasa tahsilatları, virmanları, garanti belgeleri ve
            // aktif sepeti ESKİ kodda kalıp hesabında bir daha görünmüyordu.

            // Kasa/banka hareketlerinde `CounterpartyCode` müşteri, tedarikçi VE banka için
            // ortak kolon; yalnız MÜŞTERİ satırları güncellenmeli, yoksa aynı kodu taşıyan
            // bir tedarikçi/banka satırı da değişirdi (Customer = 1).
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"BankAccountTransactions\" SET \"CounterpartyCode\" = {regeneratedCustomerCode} WHERE \"CounterpartyCode\" = {oldCustomerCode} AND \"CounterpartyType\" = 1", cancellationToken);
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"CashAccountTransactions\" SET \"CounterpartyCode\" = {regeneratedCustomerCode} WHERE \"CounterpartyCode\" = {oldCustomerCode} AND \"CounterpartyType\" = 1", cancellationToken);

            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Virmans\" SET \"SourceCustomerCode\" = {regeneratedCustomerCode} WHERE \"SourceCustomerCode\" = {oldCustomerCode}", cancellationToken);
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Virmans\" SET \"TargetCustomerCode\" = {regeneratedCustomerCode} WHERE \"TargetCustomerCode\" = {oldCustomerCode}", cancellationToken);

            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"WarrantyRecords\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"UserBasketItems\" SET \"CustomerCode\" = {regeneratedCustomerCode} WHERE \"CustomerCode\" = {oldCustomerCode}", cancellationToken);

            // ⚠️ `Users.Carikodu` TEK bir cari kodu olmak zorunda değil: boş / `*` / `ALL`
            // sınırsız erişim demek, virgüllü liste ise plasiyer portföyüdür
            // (bkz. cari kodu claim yapısı). Bu yüzden yalnız TAM EŞLEŞEN tek kodlu satırlar
            // güncelleniyor; virgüllü portföyde eski kod kalırsa elle düzeltilmeli —
            // liste üzerinde metin cerrahisi yapmak yanlış cariye erişim açabilirdi.
            await _dbContext.Database.ExecuteSqlInterpolatedAsync($"UPDATE \"Users\" SET \"Carikodu\" = {regeneratedCustomerCode} WHERE \"Carikodu\" = {oldCustomerCode}", cancellationToken);

            // Remove old
            _dbContext.Customers.Remove(entity);
            await _dbContext.SaveChangesAsync(cancellationToken);

            await tx.CommitAsync(cancellationToken);

            // Re-load for response
            entity = await _dbContext.Customers.AsNoTracking().FirstAsync(x => x.CustomerCode == regeneratedCustomerCode, cancellationToken);
        }

        // Rebuild customer categories for current code
        var effectiveCode = entity.CustomerCode;
        var existing = await _dbContext.CustomerProductCategories
            .Where(x => x.CustomerCode == effectiveCode)
            .ToListAsync(cancellationToken);

        if (request.CategoryAccessMode == CategoryAccessMode.All)
        {
            if (existing.Count > 0)
            {
                _dbContext.CustomerProductCategories.RemoveRange(existing);
            }
        }
        else
        {
            var existingIds = existing.Select(x => x.ProductCategoryId).ToList();
            var toRemove = existing.Where(x => !categoryIds.Contains(x.ProductCategoryId)).ToList();
            var toAdd = categoryIds.Where(id => !existingIds.Contains(id))
                .Select(id => new CustomerProductCategory
                {
                    CustomerCode = effectiveCode,
                    ProductCategoryId = id
                }).ToList();

            if (toRemove.Count > 0)
            {
                _dbContext.CustomerProductCategories.RemoveRange(toRemove);
            }
            if (toAdd.Count > 0)
            {
                _dbContext.CustomerProductCategories.AddRange(toAdd);
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Plasiyerin cari listesini hizala: yeni plasiyere ekle, değiştiyse eskisinden çıkar.
        // Cari kodu tip değişiminde yeniden üretilmiş olabilir; güncel kodu kullan.
        await SyncSalesmanCustomerListAsync(
            entity.CustomerCode,
            entity.SalesmanCode,
            previousSalesmanCode,
            cancellationToken);

        if (!string.IsNullOrWhiteSpace(entity.SalesmanCode))
        {
            var salesman = await _dbContext.Salesmen
                .FirstOrDefaultAsync(x => x.SalesmanCode == entity.SalesmanCode, cancellationToken);

            if (salesman is not null)
            {
                salesman.CustomerCode = entity.CustomerCode;
                salesman.EditUser = User.Identity?.Name ?? "System";
                salesman.EditTime = DateTime.UtcNow;
                await _dbContext.SaveChangesAsync(cancellationToken);
            }
        }

        return Ok(new
        {
            success = true,
            message = "Cari güncellendi",
            data = new CustomerResponse
            {
                CustomerCode = entity.CustomerCode,
                Name = entity.Name,
                Address = entity.Address,
                City = entity.City,
                District = entity.District,
                Phone = entity.Phone,
                Fax = entity.Fax,
                Email = entity.Email,
                TaxOffice = entity.TaxOffice,
                TaxNumber = entity.TaxNumber,
                IdentityNumber = entity.IdentityNumber,
                CustomerType = entity.CustomerType,
                InvoiceType = entity.InvoiceType,
                ProductCategory = entity.ProductCategory,
                IsActive = entity.IsActive,
                PriceGroupId = entity.PriceGroupId,
                DiscountRate = entity.DiscountRate,
                SalesmanCode = entity.SalesmanCode,
                CreditLimit = entity.CreditLimit,
                CreditLimitUsd = entity.CreditLimitUsd,
                CreditLimitEur = entity.CreditLimitEur,
                CreditLimitGbp = entity.CreditLimitGbp,
                ParentCustomerCode = entity.ParentCustomerCode,
                CurrencyTypeId = entity.CurrencyTypeId,
                ProductCategoryIds = categoryIds
            }
        });
    }

    [HttpPut("{customerCode}/price-group")]
    [AuthorizePage("users", "cariEkle")]
    public async Task<IActionResult> UpdatePriceGroup(
        [FromRoute] string customerCode,
        [FromBody] UpdateCustomerPriceGroupRequest request,
        CancellationToken cancellationToken)
    {
        customerCode = customerCode.Trim();
        if (customerCode.Length == 0)
        {
            return BadRequest(new { success = false, message = "Geçersiz cari kodu" });
        }

        var entity = await _dbContext.Customers
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (entity is null)
        {
            return NotFound(new { success = false, message = "Cari bulunamadı" });
        }

        if (request.PriceGroupId.HasValue)
        {
            var pgExists = await _dbContext.PriceGroups
                .AsNoTracking()
                .AnyAsync(x => x.Id == request.PriceGroupId.Value, cancellationToken);

            if (!pgExists)
            {
                ModelState.AddModelError(nameof(request.PriceGroupId), "PriceGroupId is invalid.");
                return ValidationProblem(ModelState);
            }
        }

        // ŞUBEYE BU UÇTAN GRUP ATANMAZ. Fiyat kategorisi ekranı şubeyi de listeliyor ve buradan
        // yapılan atama, kayıt/düzenleme yollarındaki türetmeyi sessizce deliyordu: şube ana
        // cariden farklı bir gruba düşünce sepet aynı ürüne başka tutar yazıyor.
        if (IsBranchCustomer(entity))
        {
            return BadRequest(new
            {
                success = false,
                message = "Şubenin fiyat grubu bağlı cariden gelir. Grubu değiştirmek için bağlı cariyi güncelleyin."
            });
        }

        var previousPriceGroupId = entity.PriceGroupId;
        entity.PriceGroupId = request.PriceGroupId;
        entity.EditUser = User.Identity?.Name ?? "System";
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        // Bu uç yalnız grubu yazıyordu; kartın fatura tipi, rolü ve alt hesapları eskide kalıp
        // sipariş/faturayı bozuyordu (bkz. AlignCustomerToPriceGroupAsync).
        await _customerAccountService.EnsureSubAccountsCreatedAsync(entity, cancellationToken);
        await AlignCustomerToPriceGroupAsync(entity, previousPriceGroupId, takeInvoiceTypeFromGroup: true, cancellationToken);
        await SyncBranchPriceGroupsAsync(entity, cancellationToken);

        return Ok(new { success = true, message = "Fiyat kategorisi güncellendi", data = new { customerCode = entity.CustomerCode, priceGroupId = entity.PriceGroupId } });
    }

    [HttpPost("{customerCode}/toggle-active")]
    [AuthorizePage("users", "cariEkle")]
    public async Task<IActionResult> ToggleActive([FromRoute] string customerCode, CancellationToken cancellationToken)
    {
        customerCode = customerCode.Trim();
        if (customerCode.Length == 0)
        {
            return BadRequest(new { success = false, message = "Geçersiz cari kodu" });
        }

        var entity = await _dbContext.Customers
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

        if (entity is null)
        {
            return NotFound(new { success = false, message = "Cari bulunamadı" });
        }

        entity.IsActive = !entity.IsActive;
        entity.EditUser = User.Identity?.Name ?? "System";
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        var statusMessage = entity.IsActive ? "Cari aktif edildi" : "Cari pasife alındı";
        return Ok(new { success = true, message = statusMessage, data = new { customerCode = entity.CustomerCode, isActive = entity.IsActive } });
    }

    [HttpDelete("{customerCode}")]
    [AuthorizePage("users", "cariEkle")]
    public async Task<IActionResult> Delete([FromRoute] string customerCode, CancellationToken cancellationToken)
    {
        customerCode = customerCode.Trim();
        if (customerCode.Length == 0)
        {
            return BadRequest(new { success = false, message = "Geçersiz cari kodu" });
        }

        var mainCustomerCode = B2B.Erp.Api.Core.Helpers.CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(customerCode);
        
        var codesToCheck = new List<string> {
            mainCustomerCode,
            mainCustomerCode + "-1",
            mainCustomerCode + "-2",
            mainCustomerCode + "-3"
        };

        var hasLedger = await _dbContext.CustomerLedgerEntries.AnyAsync(x => codesToCheck.Contains(x.CustomerCode), cancellationToken);
        var hasInvoices = await _dbContext.Invoices.AnyAsync(x => codesToCheck.Contains(x.CustomerCode), cancellationToken);
        var hasOrders = await _dbContext.SalesOrders.AnyAsync(x => codesToCheck.Contains(x.CustomerCode), cancellationToken);
        var hasIrsaliye = await _dbContext.Set<Irsaliye>().AnyAsync(x => codesToCheck.Contains(x.CustomerCode), cancellationToken);
        var hasChecks = await _dbContext.Set<CustomerCheck>().AnyAsync(x => codesToCheck.Contains(x.CustomerCode) || codesToCheck.Contains(x.CurrentCustomerCode!), cancellationToken);
        var hasPayableChecks = await _dbContext.Set<PayableCheck>().AnyAsync(x => x.CustomerCode != null && codesToCheck.Contains(x.CustomerCode), cancellationToken);
        var hasPayableNotes = await _dbContext.Set<PayableNote>().AnyAsync(x => x.CustomerCode != null && codesToCheck.Contains(x.CustomerCode), cancellationToken);
        var hasVirman = await _dbContext.Set<Virman>().AnyAsync(x => codesToCheck.Contains(x.SourceCustomerCode) || codesToCheck.Contains(x.TargetCustomerCode), cancellationToken);
        var hasCariOffers = await _dbContext.CariOffers.AnyAsync(x => x.CustomerCode != null && codesToCheck.Contains(x.CustomerCode), cancellationToken);
        var hasCustomerOffers = await _dbContext.CustomerOffers.AnyAsync(x => x.CustomerCode != null && codesToCheck.Contains(x.CustomerCode), cancellationToken);

        var hasMovements = hasLedger || hasInvoices || hasOrders || hasIrsaliye || hasChecks || hasPayableChecks || hasPayableNotes || hasVirman || hasCariOffers || hasCustomerOffers;

        if (hasMovements)
        {
            return BadRequest(new { success = false, message = "Bu cariye ait hareketler (sipariş, fatura veya defter kaydı) bulunduğu için silinemez. Ancak pasife alabilirsiniz." });
        }

        // BAĞLI ŞUBELER ÖKSÜZ BIRAKILMAZ (denetim md. 19).
        //
        // Silme, carinin kendi alt hesaplarını (-1/-2/-3) temizliyordu ama `ParentCustomerCode`
        // ile bu cariye bağlanmış ŞUBE carileri denetlenmiyordu: hareketi olmayan bir ana cari
        // silindiğinde şubeleri var olmayan bir üst koda işaret eder hâlde kalıyor, üst koda
        // göre toplayan ekstre/konsolidasyon sorgularında kayboluyordu.
        var branchCodes = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.ParentCustomerCode != null
                        && x.ParentCustomerCode != ""
                        && codesToCheck.Contains(x.ParentCustomerCode)
                        && !codesToCheck.Contains(x.CustomerCode))
            .Select(x => x.CustomerCode)
            .Take(5)
            .ToListAsync(cancellationToken);

        if (branchCodes.Count > 0)
        {
            return BadRequest(new
            {
                success = false,
                message = $"Bu cariye bağlı şube carileri var ({string.Join(", ", branchCodes)}…). Önce şubeleri başka bir üst cariye taşıyın ya da silin."
            });
        }

        // Delete main customer and all its sub-accounts from the database
        var customersToDelete = await _dbContext.Customers
            .Where(x => codesToCheck.Contains(x.CustomerCode))
            .ToListAsync(cancellationToken);

        if (customersToDelete.Count == 0)
        {
            return NotFound(new { success = false, message = "Cari bulunamadı" });
        }

        _dbContext.Customers.RemoveRange(customersToDelete);

        // Delete any related data that is child/dependent but not movements (e.g. authorized contacts, price overrides, product category relations)
        var contacts = await _dbContext.CustomerAuthorizedContacts.Where(x => codesToCheck.Contains(x.CustomerCode)).ToListAsync(cancellationToken);
        if (contacts.Count > 0) _dbContext.CustomerAuthorizedContacts.RemoveRange(contacts);

        var priceOverrides = await _dbContext.CustomerProductPriceOverrides.Where(x => codesToCheck.Contains(x.CustomerCode)).ToListAsync(cancellationToken);
        if (priceOverrides.Count > 0) _dbContext.CustomerProductPriceOverrides.RemoveRange(priceOverrides);

        var categoryRels = await _dbContext.CustomerProductCategories.Where(x => codesToCheck.Contains(x.CustomerCode)).ToListAsync(cancellationToken);
        if (categoryRels.Count > 0) _dbContext.CustomerProductCategories.RemoveRange(categoryRels);

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true, message = "Cari ve bağlı alt hesapları başarıyla silindi." });
    }

    /// <summary>
    /// Toplu cari aktarımının ilerleme durumu — <b>KİRACI BAŞINA</b>.
    ///
    /// <para>
    /// Önceden dört adet <c>private static</c> alan vardı (sayaçlar + <c>List&lt;string&gt;</c>).
    /// Bunlar süreç genelinde TEK kopya olduğu için: (a) A firması aktarım yaparken B
    /// firmasının durum ekranında A'nın satır hataları görünüyordu — kiracılar arası veri
    /// sızıntısı; (b) <c>List&lt;string&gt;</c> thread-safe olmadığı için eşzamanlı aktarımda
    /// okuma "Collection was modified" ile çöküyordu; (c) tek <c>_importIsRunning</c> bayrağı
    /// bir firmanın aktarımı sürerken diğerininkini engelliyordu.
    /// </para>
    ///
    /// <para>
    /// Anahtar olarak kiracının veritabanı adı kullanılıyor: bu denetleyicide claim'den
    /// firma kodu okunmuyor, <c>AppDbContext</c> zaten kiracıya bağlı geliyor.
    /// </para>
    /// </summary>
    private sealed class CustomerImportProgress
    {
        public readonly object Gate = new();
        public bool IsRunning;
        public int SuccessCount;
        public int ErrorCount;
        public List<string> Errors { get; } = new();
    }

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, CustomerImportProgress> _importProgressByTenant = new(StringComparer.OrdinalIgnoreCase);

    private CustomerImportProgress GetImportProgress()
    {
        var tenantKey = _dbContext.Database.GetDbConnection().Database ?? "default";
        return _importProgressByTenant.GetOrAdd(tenantKey, _ => new CustomerImportProgress());
    }

    // Bu iki uç [AllowAnonymous] idi: kimliksiz olarak cari tablosuna toplu yazma başlatılabiliyor
    // ve durumu okunabiliyordu. Geliştirme artığı oldukları belli (aşağıdaki dosya yolu bir
    // geliştirici makinesine sabitlenmiş) ama silmek yerine yetki kapısının arkasına alındılar,
    // çünkü hâlâ elle veri aktarımı için kullanılıyor olabilirler.
    [HttpGet("import-large-status")]
    [AuthorizePage("users", "cariEkle")]
    public IActionResult GetImportStatus()
    {
        var progress = GetImportProgress();
        lock (progress.Gate)
        {
            return Ok(new {
                isRunning = progress.IsRunning,
                successCount = progress.SuccessCount,
                errorCount = progress.ErrorCount,
                // Kopya döndürülüyor: arka plan görevi listeye yazmaya devam ederken
                // serileştirme sırasında koleksiyon değişirse istek çöküyordu.
                errors = progress.Errors.ToList()
            });
        }
    }

    [HttpPost("import-large-excel")]
    [AuthorizePage("users", "cariEkle")]
    public IActionResult ImportLargeExcel()
    {
        var progress = GetImportProgress();

        lock (progress.Gate)
        {
            if (progress.IsRunning)
            {
                return BadRequest(new { success = false, message = "Import is already running" });
            }
        }

        var filePath = @"C:\Users\Admin\Downloads\cariler.xlsx";
        if (!System.IO.File.Exists(filePath))
        {
            return BadRequest(new { success = false, message = "Excel file not found at " + filePath });
        }

        lock (progress.Gate)
        {
            progress.IsRunning = true;
            progress.SuccessCount = 0;
            progress.ErrorCount = 0;
            progress.Errors.Clear();
        }

        var serviceScopeFactory = HttpContext.RequestServices.GetRequiredService<IServiceScopeFactory>();

        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = serviceScopeFactory.CreateScope();
                var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var customerAccountService = scope.ServiceProvider.GetRequiredService<Core.Services.ICustomerAccountService>();

                using var workbook = new ClosedXML.Excel.XLWorkbook(filePath);
                var worksheet = workbook.Worksheets.FirstOrDefault();
                if (worksheet == null)
                {
                    lock (progress.Gate)
                    {
                        progress.Errors.Add("No worksheet found in excel file");
                        progress.IsRunning = false;
                    }
                    return;
                }

                var headerRow = worksheet.Row(1);
                var lastCol = headerRow.LastCellUsed()?.Address.ColumnNumber ?? 0;
                var colIndexByName = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                for (var c = 1; c <= lastCol; c++)
                {
                    var name = headerRow.Cell(c).GetString().Trim();
                    if (string.IsNullOrWhiteSpace(name)) continue;
                    if (!colIndexByName.ContainsKey(name)) colIndexByName[name] = c;
                }

                int? GetCol(string name) => colIndexByName.TryGetValue(name, out var idx) ? idx : null;
                var lastRow = worksheet.LastRowUsed()?.RowNumber() ?? 1;

                var priceGroups = await dbContext.PriceGroups.AsNoTracking().ToListAsync();

                string CleanCity(string city)
                {
                    if (string.IsNullOrWhiteSpace(city)) return string.Empty;
                    var c = city.Trim().ToUpper(new System.Globalization.CultureInfo("tr-TR"));
                    if (c == "LEFKOSA" || c == "LEFKOŞA") return "LEFKOŞA";
                    if (c == "GIRNE" || c == "GİRNE") return "GİRNE";
                    if (c == "LEFKE") return "LEFKE";
                    if (c == "GAZIMAGUSA" || c == "GAZİMAĞUSA" || c == "MAĞUSA" || c == "MAGUSA") return "GAZİMAĞUSA";
                    if (c == "ISKELE" || c == "İSKELE") return "İSKELE";
                    if (c == "GUZELYURT" || c == "GÜZELYURT") return "GÜZELYURT";
                    return c;
                }

                int GetPriceGroupCode(string pgStr, string invType)
                {
                    var pgUpper = (pgStr ?? string.Empty).Trim().ToUpperInvariant();
                    var match = System.Text.RegularExpressions.Regex.Match(pgUpper, @"\d+");
                    int pgNum = 1;
                    if (match.Success)
                    {
                        int.TryParse(match.Value, out pgNum);
                    }

                    if (invType == "ASKERIYE" || pgNum == 7)
                    {
                        return 7;
                    }

                    if (invType == "ACIK")
                    {
                        if (pgNum >= 1 && pgNum <= 3) return pgNum + 3;
                        if (pgNum >= 4 && pgNum <= 6) return pgNum;
                        return 4;
                    }
                    else // FATURA
                    {
                        if (pgNum >= 4 && pgNum <= 6) return pgNum - 3;
                        if (pgNum >= 1 && pgNum <= 3) return pgNum;
                        return 1;
                    }
                }

                int ParseLast6DigitsOrZero(string code, string prefixStr)
                {
                    if (string.IsNullOrWhiteSpace(code) || code.Length <= prefixStr.Length) return 0;
                    var part = code.Substring(prefixStr.Length);
                    var dashIdx = part.IndexOf('-');
                    if (dashIdx >= 0) part = part.Substring(0, dashIdx);

                    if (int.TryParse(part, out var val)) return val;
                    return 0;
                }

                async Task<string> ReserveNextCustomerCodeBackground(AppDbContext db, string prefix)
                {
                    await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);

                    var seriesKey = $"customer:{prefix.TrimEnd('-')}";
                    var series = await db.NumberSeries
                        .FirstOrDefaultAsync(x => x.Key == seriesKey);

                    var existingCodes = await db.Customers
                        .AsNoTracking()
                        .Where(x => x.CustomerCode.StartsWith(prefix))
                        .Select(x => x.CustomerCode)
                        .ToListAsync();

                    var maxExisting = existingCodes.Count == 0 ? 0 : existingCodes.Max(c => ParseLast6DigitsOrZero(c, prefix));

                    if (series is null)
                    {
                        series = new NumberSeries
                        {
                            Key = seriesKey,
                            LastValue = maxExisting
                        };

                        db.NumberSeries.Add(series);
                        await db.SaveChangesAsync();
                    }
                    else if (series.LastValue < maxExisting)
                    {
                        series.LastValue = maxExisting;
                        await db.SaveChangesAsync();
                    }

                    series.LastValue += 1;
                    await db.SaveChangesAsync();
                    await tx.CommitAsync();

                    return prefix + series.LastValue.ToString("D6");
                }

                for (int r = 2; r <= lastRow; r++)
                {
                    var row = worksheet.Row(r);
                    if (row.IsEmpty()) continue;

                    string GetS(string col)
                    {
                        var ci = GetCol(col);
                        if (!ci.HasValue) return string.Empty;
                        return row.Cell(ci.Value).GetString().Trim();
                    }

                    try
                    {
                        var cariIsim = GetS("CARI ISIM");
                        if (string.IsNullOrWhiteSpace(cariIsim)) continue;

                        var cleanName = cariIsim.Trim().ToUpper(new System.Globalization.CultureInfo("tr-TR"));

                        var vergiNumarasi = GetS("VERGI NUMARASI");
                        var cleanTaxNo = string.IsNullOrWhiteSpace(vergiNumarasi) ? null : vergiNumarasi.Trim().ToUpperInvariant();

                        // 1) CustomerType mapping
                        var grupKoduRaw = GetS("GRUP KODU");
                        var customerType = "Müşteri";
                        var normalizedGrupKodu = grupKoduRaw.Trim().ToUpperInvariant();
                        if (normalizedGrupKodu == "BAYI") customerType = "Bayi";
                        else if (normalizedGrupKodu == "MUSTERI") customerType = "Müşteri";
                        else if (normalizedGrupKodu == "PERSPERA") customerType = "Çalışan";
                        else customerType = "Müşteri";

                        var normalizedType = NormalizeCustomerType(customerType);

                        // Check if exists
                        bool exists = false;
                        if (!string.IsNullOrEmpty(cleanTaxNo))
                        {
                            exists = await dbContext.Customers.AnyAsync(x => x.Name == cleanName || x.TaxNumber == cleanTaxNo);
                        }
                        else
                        {
                            exists = await dbContext.Customers.AnyAsync(x => x.Name == cleanName);
                        }

                        if (exists)
                        {
                            lock (progress.Gate) { progress.SuccessCount++; }
                            continue; // skip
                        }

                        var telefon = GetS("TELEFON");
                        var raporKodu1Raw = GetS("RAPOR KODU1");
                        var adres = GetS("ADRES");
                        var il = GetS("IL");
                        var ilce = GetS("ILCE");
                        var vergiDairesi = GetS("VERGI DAIRESI");
                        var plasiyerKodu = GetS("PLASIYER KODU");
                        var email = GetS("EMAIL");
                        var fiyatGrubuRaw = GetS("FIYAT GRUBU");
                        var krediLimitiRaw = GetS("KREDI LIMITI");

                        // 2) InvoiceType mapping
                        var invoiceType = "FATURA";
                        var normalizedRaporKodu = raporKodu1Raw.Trim().ToUpperInvariant();
                        if (normalizedRaporKodu == "FATURA") invoiceType = "FATURA";
                        else if (normalizedRaporKodu == "ACIK") invoiceType = "ACIK";
                        else if (normalizedRaporKodu.Contains("ASKER")) invoiceType = "ASKERIYE";
                        else invoiceType = "FATURA";

                        // 3) Resolve PriceGroup
                        int finalPgCode = GetPriceGroupCode(fiyatGrubuRaw, invoiceType);
                        var priceGroup = priceGroups.FirstOrDefault(x => x.Code == finalPgCode);
                        Guid? priceGroupId = priceGroup?.Id;

                        // 4) SalesmanCode
                        var salesmanCode = string.IsNullOrWhiteSpace(plasiyerKodu) ? null : plasiyerKodu.Trim();

                        // 5) Phone formatting
                        var phoneDigits = new string(telefon.Where(char.IsDigit).ToArray());
                        var formattedPhone = string.Empty;
                        if (!string.IsNullOrWhiteSpace(phoneDigits))
                        {
                            if (phoneDigits.Length == 10 && phoneDigits[0] != '0')
                            {
                                phoneDigits = "0" + phoneDigits;
                            }
                            if (phoneDigits.Length == 11 && phoneDigits[0] == '0')
                            {
                                formattedPhone = $"{phoneDigits.Substring(0, 4)} {phoneDigits.Substring(4, 3)} {phoneDigits.Substring(7, 4)}";
                            }
                            else
                            {
                                formattedPhone = phoneDigits;
                            }
                        }

                        // 6) Credit limit
                        decimal creditLimit = 0;
                        if (decimal.TryParse(krediLimitiRaw, out var cl))
                        {
                            creditLimit = cl;
                        }

                        // 7) Generate unique CustomerCode
                        var prefix = ResolveCustomerPrefixByType(normalizedType);
                        if (string.IsNullOrWhiteSpace(prefix))
                        {
                            prefix = "120-03-";
                        }
                        
                        var customerCode = await ReserveNextCustomerCodeBackground(dbContext, prefix);

                        // 8) Set properties
                        var entity = new Customer
                        {
                            CustomerCode = customerCode,
                            Name = cleanName,
                            Address = string.IsNullOrWhiteSpace(adres) ? null : adres.Trim().ToUpper(new System.Globalization.CultureInfo("tr-TR")),
                            City = string.IsNullOrWhiteSpace(il) ? null : CleanCity(il),
                            District = string.IsNullOrWhiteSpace(ilce) ? null : ilce.Trim().ToUpper(new System.Globalization.CultureInfo("tr-TR")),
                            Phone = string.IsNullOrWhiteSpace(formattedPhone) ? null : formattedPhone,
                            Email = string.IsNullOrWhiteSpace(email) ? null : email.Trim().ToLowerInvariant(),
                            TaxOffice = string.IsNullOrWhiteSpace(vergiDairesi) ? null : vergiDairesi.Trim().ToUpper(new System.Globalization.CultureInfo("tr-TR")),
                            TaxNumber = cleanTaxNo,
                            IdentityNumber = (cleanTaxNo != null && cleanTaxNo.Length == 11 && cleanTaxNo.All(char.IsDigit)) ? cleanTaxNo : null,
                            CustomerType = customerType,
                            InvoiceType = invoiceType,
                            IsActive = true,
                            PriceGroupId = priceGroupId,
                            DiscountRate = 0,
                            SalesmanCode = salesmanCode,
                            CreditLimit = creditLimit,
                            CurrencyTypeId = 1,
                            CreateUser = "ImportScript",
                            CreateTime = DateTime.UtcNow
                        };

                        dbContext.Customers.Add(entity);
                        await dbContext.SaveChangesAsync();

                        // 9) Ensure sub-accounts are created
                        await customerAccountService.EnsureSubAccountsCreatedAsync(entity, default);

                        lock (progress.Gate) { progress.SuccessCount++; }
                    }
                    catch (Exception ex)
                    {
                        lock (progress.Gate)
                        {
                            progress.ErrorCount++;
                            progress.Errors.Add($"Row {r}: {ex.Message}");
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                lock (progress.Gate) { progress.Errors.Add($"Fatal error: {ex.Message}"); }
            }
            finally
            {
                lock (progress.Gate) { progress.IsRunning = false; }
            }
        });

        return Ok(new { success = true, message = "Import started in background" });
    }

    // ---------------------------------------------------------------------------------------
    // E-TİCARET (sunucu-sunucu)
    //
    // Mağaza bu uçları kullanıcı oturumuyla değil, paylaşılan servis anahtarıyla çağırır.
    // Kapsam bilinçli olarak DAR: yalnızca e-ticaret carisi (120-11-) açılabilir ve yalnızca
    // iletişim alanları güncellenebilir. Genel /api/customers uçları müşteriye hiç açılmıyor —
    // orada cari tipi, fiyat grubu, kredi limiti gibi alanlar da yazılabiliyor.
    // ---------------------------------------------------------------------------------------

    public sealed class EcommerceCustomerRequest
    {
        [Required, MaxLength(255)] public string Name { get; set; } = string.Empty;
        [MaxLength(255)] public string? Email { get; set; }
        [MaxLength(50)] public string? Phone { get; set; }
        [MaxLength(100)] public string? City { get; set; }
        [MaxLength(100)] public string? District { get; set; }
        [MaxLength(500)] public string? Address { get; set; }

        /// <summary>
        /// ÜYE OLMADAN SİPARİŞ (2026-10-05 kullanıcı kararı: "sizi tanıyoruz gelmesin, direkt sipariş
        /// oluşturulsun, gerekirse başka cari açılsın"). true ise telefon tekilliği atlanır ve aynı
        /// numaraya yeni bir 120-11- carisi açılır. Doğrulanmamış numarayı mevcut cariye bağlamak,
        /// numarayı yazan herkese o carinin sipariş ve faturalarını açardı; ayrı cari bunu önlüyor.
        /// Mağaza yalnız üyesiz sipariş yolunda gönderir.
        /// </summary>
        public bool AllowDuplicatePhone { get; set; }
    }

    /// <summary>
    /// Mağazadan üye olan müşteri için cari açar.
    ///
    /// Cari kodu burada ÜRETİLMEZ, ayrılır: <see cref="ReserveNextCustomerCode"/> kilitli bir
    /// işlemle sıradaki numarayı verir. Aynı anda kayıt olan iki kişiye aynı kodun çıkmaması
    /// buna bağlı.
    ///
    /// Fatura tipi FATURA, fiyat grubu katalog (kod 1). İkisi de sabit: müşterinin kendi cari
    /// koşullarını belirlemesi söz konusu değil.
    /// </summary>
    /// <summary>Telefonun son 10 hanesi (ülke kodu / baştaki sıfır / boşluk / ayraç fark etmez).</summary>
    private static string SonOnHane(string? telefon)
    {
        var d = new string((telefon ?? string.Empty).Where(char.IsDigit).ToArray());
        return d.Length <= 10 ? d : d[^10..];
    }

    [HttpPost("/api/ecommerce/customers")]
    [InternalApiKey]
    public async Task<IActionResult> CreateEcommerceCustomer([FromBody] EcommerceCustomerRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        // Ad da normalize edilir: müşteri "Ali   Veli" yazdığında kart ve fatura basımı öyle kalırdı.
        var name = B2B.Erp.Api.Core.Helpers.EcommerceContactNormalizer.Clean(request.Name) ?? string.Empty;
        if (name.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Name), "Ad soyad zorunludur.");
            return ValidationProblem(ModelState);
        }

        /*
          MAĞAZADAN GELEN VERİ KAYIT ANINDA NORMALİZE EDİLİR (2026-09-16 kullanıcı isteği).
          Telefon B2B biçimine (`0542 875 0029`), adres kutuları da yerine oturur: müşteri adresin
          tamamını "Mahalle/Semt" kutusuna yazdığında metin ADRESE taşınır — fatura basımı Adres ile
          İlçe'yi ayrı satırlara yazdığı için ham hâlinde adres ilçe satırında çıkıyordu.
          Bkz. Core/Helpers/EcommerceContactNormalizer.
        */
        var phone = B2B.Erp.Api.Core.Helpers.EcommerceContactNormalizer.NormalizePhone(request.Phone);
        var (normalizedCity, normalizedDistrict, normalizedAddress) =
            B2B.Erp.Api.Core.Helpers.EcommerceContactNormalizer.NormalizeAddress(request.City, request.District, request.Address);

        if (!string.IsNullOrWhiteSpace(phone) && !request.AllowDuplicatePhone)
        {
            /*
              TELEFON TEKİLLİĞİ YALNIZ E-TİCARET CARİLERİ ARASINDA (2026-09-21 kullanıcı kararı:
              "e-ticaret cari numaraları diğerlerinden farklı; bayi de e-ticarette üyelik açabilir,
              kural sadece e-ticaret için geçerli").

              Eskiden BÜTÜN cariler taranıyordu: bayi kartında telefonu yazan herkes (personel dahil)
              vitrinde üye olamıyor, mağaza da bunu "Kayıt şu anda tamamlanamıyor" diye gösteriyordu.
              120-11- serisi bayi serisinden ayrı bir hesaptır; aynı kişinin bayi bakiyesiyle
              e-ticaret alışverişi zaten karışmaz. İkinci E-TİCARET carisi ise hâlâ açılmaz.

              Mevcut carinin kodu ve tipi de döner: mağaza, SMS ile doğrulanmış numaranın sahibini
              o cariye bağlar (mükerrer 120-11- açılmaz).
            */
            /*
              Karşılaştırma RAKAMLA (son 10 hane), metinle değil: eski e-ticaretten gelen carilerde
              telefon "05338266827" / "+90533…" gibi biçimlerde durabiliyor; birebir metin eşitliği
              onları görmez ve aynı numaraya ikinci cari açılırdı. E-ticaret carisi sayısı küçük,
              bellekte süzmek sorun değil.

              YALNIZ AKTİF cariler sayılır: pasife alınmış e-ticaret carisine mağaza sipariş açamaz
              (`/api/ecommerce/orders` aktif cari ister); pasif cariye bağlamak müşteriyi kilitlerdi.
              Pasifi olan numara için yeni cari açılır.
            */
            var aranan = SonOnHane(phone);
            var sameLine = aranan.Length < 10
                ? null
                : (await _dbContext.Customers
                    .AsNoTracking()
                    .Where(x => x.IsActive && x.Phone != null && x.Phone != "")
                    .Where(x => x.CustomerType == "eticaret" || x.CustomerCode.StartsWith("120-11-"))
                    .Select(x => new { x.CustomerCode, x.CustomerType, x.IsActive, x.Phone })
                    .ToListAsync(cancellationToken))
                    .Where(x => SonOnHane(x.Phone) == aranan)
                    .OrderBy(x => x.CustomerCode)
                    .FirstOrDefault();

            if (sameLine is not null)
            {
                return Conflict(new
                {
                    success = false,
                    code = "PHONE_EXISTS",
                    message = "Bu telefon numarasına ait bir e-ticaret carisi zaten var.",
                    customerCode = sameLine.CustomerCode,
                    customerType = sameLine.CustomerType,
                    isActive = sameLine.IsActive
                });
            }
        }

        var customerCode = await ReserveNextCustomerCode("120-11-", cancellationToken);

        var catalogPriceGroupId = await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(x => x.Code == B2B.Erp.Api.Features.Ecommerce.EcommerceCatalog.PriceGroupCode && x.IsActive)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);

        /*
          PLASİYER = ETİCARET KULLANICISININ PLASİYER KODU (2026-09-16 kullanıcı isteği: "e-ticaretten
          açılan carilerin açılır açılmaz plasiyeri bu olması lazım").

          Kod SABİT YAZILMAZ: B2B'deki ETİCARET kullanıcısının kartındaki "Plasiyer Kodu" okunur
          (bugün 56). Kod değişirse yeni cariler kendiliğinden yenisini alır. Kullanıcı adı canlıda
          noktalı İ ile ("ETİCARET") duruyor; SQL'de `upper` İ'yi I'ya çevirmediği için aday
          `ILIKE 'et_caret'` ile çekilip Türkçe harf farkı bellekte eleniyor.

          Kullanıcı yoksa ya da plasiyer kodu boşsa cari yine açılır (müşteri kaydı bu yüzden
          düşmemeli), plasiyer boş kalır ve uyarı loglanır.
        */
        var eticaretSalesmanCode = (await _dbContext.Users
                .AsNoTracking()
                .Where(u => EF.Functions.ILike(u.Username, "et_caret") && u.SalesmanCode != null && u.SalesmanCode != "")
                .Select(u => new { u.Username, u.SalesmanCode })
                .ToListAsync(cancellationToken))
            .Where(u => string.Equals(
                u.Username.Trim().Replace('İ', 'I').Replace('ı', 'i'),
                "ETICARET",
                StringComparison.OrdinalIgnoreCase))
            .Select(u => u.SalesmanCode!.Trim())
            .FirstOrDefault();

        if (string.IsNullOrEmpty(eticaretSalesmanCode))
        {
            _logger.LogWarning("E-ticaret carisi {CustomerCode} plasiyersiz açıldı: ETİCARET kullanıcısı ya da plasiyer kodu bulunamadı.", customerCode);
        }

        var entity = new Customer
        {
            CustomerCode = customerCode,
            Name = name,
            SalesmanCode = string.IsNullOrEmpty(eticaretSalesmanCode) ? null : eticaretSalesmanCode,
            Email = request.Email?.Trim().ToLowerInvariant(),
            Phone = phone,
            City = normalizedCity,
            District = normalizedDistrict,
            Address = normalizedAddress,
            CustomerType = "eticaret",
            InvoiceType = "FATURA",
            AccountRole = CustomerAccountRole.Normal,
            IsActive = true,
            PriceGroupId = catalogPriceGroupId,
            CategoryAccessMode = CategoryAccessMode.All,
            CurrencyTypeId = 0,
            CreateUser = "ETICARET",
            CreateTime = DateTime.UtcNow
        };

        _dbContext.Customers.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // Elle cari açmadaki gibi: bu plasiyere bağlı, cari listesi kısıtlı kullanıcıların
        // listesine yeni cari kendiliğinden eklensin. Başarısız olursa kayıt düşmesin.
        try
        {
            await SyncSalesmanCustomerListAsync(entity.CustomerCode, entity.SalesmanCode, null, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "E-ticaret carisi {CustomerCode} plasiyer cari listesine eklenemedi.", entity.CustomerCode);
        }

        return Ok(new { success = true, data = new { customerCode = entity.CustomerCode } });
    }

    /// <summary>
    /// Müşterinin kendi profilinden değiştirebildiği alanlar — beyaz liste.
    /// Vergi no, cari tipi, fiyat grubu, kredi limiti ve plasiyer bilerek DIŞARIDA.
    /// </summary>
    [HttpPut("/api/ecommerce/customers/{customerCode}/contact")]
    [InternalApiKey]
    public async Task<IActionResult> UpdateEcommerceCustomerContact(
        string customerCode,
        [FromBody] EcommerceCustomerRequest request,
        CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var code = (customerCode ?? string.Empty).Trim();

        var entity = await _dbContext.Customers.FirstOrDefaultAsync(x => x.CustomerCode == code, cancellationToken);
        if (entity is null) return NotFound(new { success = false, message = "Cari bulunamadı." });

        // Yalnızca e-ticaret carileri: bu uçla bir bayinin kartına dokunulamaz.
        if (!code.StartsWith("120-11-", StringComparison.Ordinal))
        {
            return Forbid();
        }

        // Açma ucundaki normalizasyonun aynısı: profil/adres güncellemesi de mağazadan geliyor,
        // burada normalize edilmezse kart ilk kayıttan sonraki ilk güncellemede yine bozulurdu.
        var (guncelIl, guncelIlce, guncelAdres) =
            B2B.Erp.Api.Core.Helpers.EcommerceContactNormalizer.NormalizeAddress(request.City, request.District, request.Address);

        entity.Name = B2B.Erp.Api.Core.Helpers.EcommerceContactNormalizer.Clean(request.Name) ?? entity.Name;
        entity.Phone = B2B.Erp.Api.Core.Helpers.EcommerceContactNormalizer.NormalizePhone(request.Phone) ?? entity.Phone;
        entity.City = guncelIl ?? entity.City;
        entity.Address = guncelAdres ?? entity.Address;

        // İlçe kutusundaki metin adrese TAŞINDIYSA ilçe de boşaltılır; yoksa aynı adres iki
        // alanda birden kalır ve fatura basımında iki kez yazılır.
        var ilceTasindi = guncelIlce is null
            && guncelAdres is not null
            && !string.IsNullOrWhiteSpace(request.District);

        entity.District = ilceTasindi ? null : (guncelIlce ?? entity.District);
        entity.EditUser = "ETICARET";
        entity.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }

    /// <summary>
    /// Müşterinin kendi iletişim bilgilerini OKUMASI — yukarıdaki yazma ucunun simetriği.
    ///
    /// NEDEN GEREKLİ: teslimat adresi ve fatura adresi carinin kartından okunuyor, mağazanın
    /// kendi kopyası yok (bilerek — iki kopya zamanla ayrışır). Mağaza bu bilgiyi hiç geri
    /// okuyamadığı için müşteri hem adresini göremiyor hem de doldurmadan önce ne yazdığını
    /// bilemiyordu: "Hesap bilgileri" ekranı salt okunurdu ve adresi hiç göstermiyordu.
    ///
    /// DÖNEN ALANLAR YAZILABİLENLERLE AYNI BEYAZ LİSTE. Cari kartında bakiye, kredi limiti,
    /// risk durumu, plasiyer ve vergi bilgisi de var; müşteriye kendi adresini göstermek için
    /// bunları da yollamak, bir ekranın ihtiyacı yüzünden bütün kartı dışarı açmak olurdu.
    ///
    /// `120-11-` kapısı yazma ucuyla aynı: bu uçla bir bayinin kartı okunamaz.
    /// </summary>
    [HttpGet("/api/ecommerce/customers/{customerCode}/contact")]
    [InternalApiKey]
    public async Task<IActionResult> GetEcommerceCustomerContact(
        string customerCode,
        CancellationToken cancellationToken)
    {
        var code = (customerCode ?? string.Empty).Trim();

        if (!code.StartsWith("120-11-", StringComparison.Ordinal))
        {
            return Forbid();
        }

        var contact = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == code)
            .Select(x => new
            {
                x.CustomerCode,
                x.Name,
                x.Phone,
                x.City,
                x.District,
                x.Address
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (contact is null) return NotFound(new { success = false, message = "Cari bulunamadı." });

        return Ok(contact);
    }

    public sealed class UpdateQuickContactRequest
    {
        public string? Email { get; set; }
        public string? Phone { get; set; }
        public string? AuthorizedPerson { get; set; }
        public string? AuthorizedPhone { get; set; }
    }

    [HttpPut("{customerCode}/quick-contact")]
    [Authorize]
    public async Task<IActionResult> UpdateQuickContact(
        [FromRoute] string customerCode,
        [FromBody] UpdateQuickContactRequest request,
        CancellationToken cancellationToken)
    {
        var code = (customerCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(code))
        {
            return BadRequest(new { success = false, message = "Geçersiz cari kodu" });
        }

        var email = string.IsNullOrWhiteSpace(request.Email) ? null : request.Email.Trim();
        var phone = string.IsNullOrWhiteSpace(request.Phone) ? null : request.Phone.Trim();
        var authorizedPerson = string.IsNullOrWhiteSpace(request.AuthorizedPerson) ? null : request.AuthorizedPerson.Trim();
        var authorizedPhone = string.IsNullOrWhiteSpace(request.AuthorizedPhone) ? null : request.AuthorizedPhone.Trim();

        // 1. If it's a Supplier (320-...)
        if (code.StartsWith("320", StringComparison.OrdinalIgnoreCase))
        {
            var supplier = await _dbContext.Set<Supplier>()
                .FirstOrDefaultAsync(x => x.SupplierCode == code, cancellationToken);

            if (supplier != null)
            {
                supplier.PhoneNumber = phone;
                supplier.EditUser = User.Identity?.Name ?? "System";
                supplier.EditTime = DateTime.UtcNow;
            }
        }
        else
        {
            // 2. Customer
            var baseCode = code;
            if (baseCode.EndsWith("-1") || baseCode.EndsWith("-2") || baseCode.EndsWith("-3"))
            {
                baseCode = baseCode.Substring(0, baseCode.Length - 2);
            }

            var matchingCustomers = await _dbContext.Customers
                .Where(x => x.CustomerCode == code || x.CustomerCode == baseCode || x.CustomerCode.StartsWith(baseCode + "-"))
                .ToListAsync(cancellationToken);

            foreach (var cust in matchingCustomers)
            {
                cust.Email = email;
                cust.Phone = phone;
                cust.EditUser = User.Identity?.Name ?? "System";
                cust.EditTime = DateTime.UtcNow;
            }
        }

        // 3. Authorized Contact
        if (!string.IsNullOrWhiteSpace(authorizedPerson) || !string.IsNullOrWhiteSpace(authorizedPhone))
        {
            var contact = await _dbContext.CustomerAuthorizedContacts
                .FirstOrDefaultAsync(x => x.CustomerCode == code, cancellationToken);

            if (contact is null)
            {
                if (!string.IsNullOrWhiteSpace(authorizedPerson))
                {
                    contact = new CustomerAuthorizedContact
                    {
                        CustomerCode = code,
                        FullName = authorizedPerson,
                        Phone = authorizedPhone ?? phone,
                        CreateUser = User.Identity?.Name ?? "System",
                        CreateTime = DateTime.UtcNow
                    };
                    _dbContext.CustomerAuthorizedContacts.Add(contact);
                }
            }
            else
            {
                if (!string.IsNullOrWhiteSpace(authorizedPerson))
                {
                    contact.FullName = authorizedPerson;
                }
                if (!string.IsNullOrWhiteSpace(authorizedPhone))
                {
                    contact.Phone = authorizedPhone;
                }
                contact.EditUser = User.Identity?.Name ?? "System";
                contact.EditTime = DateTime.UtcNow;
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new
        {
            success = true,
            message = "Cari iletişim ve yetkili bilgileri başarıyla güncellendi.",
            data = new
            {
                customerCode = code,
                email,
                phone,
                authorizedPerson,
                authorizedPhone
            }
        });
    }
}

