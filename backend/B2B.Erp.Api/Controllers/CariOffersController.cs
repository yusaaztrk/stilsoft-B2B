using System.Security.Claims;
using B2B.Erp.Api.Core.Http;
using System.Security.Cryptography;
using System.Text.Json;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Dtos.CariOffers;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using B2B.Erp.Api.Features.OfferPrint;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/cari-offers")]
[Authorize]
public sealed class CariOffersController : ControllerBase
{
    /// <summary>
    /// Muhtelif müşteriye kesilen teklifin fiyat grubu kodu. Kullanıcı kararı (2026-08-11):
    /// eskiden 4'tü, 1 oldu. Kardeşi <c>CustomerOffersController</c> ile AYNI kalmalı.
    /// </summary>
    internal const int MuhtelifPriceGroupCode = 1;

    /// <summary>
    /// Cari Musteri Teklifi'nin muhtelif cari kodu oneki.
    ///
    /// Kullanici karari (2026-08-11): eskiden "120-08-" idi, "120-13-" oldu. NORMAL Musteri
    /// Teklifi'nin muhtelifleri AYRI bir tablodadir (<c>MuhtelifCustomers</c>) ve bu
    /// degisiklikten etkilenmez.
    ///
    /// Onekin ayrismasi ayni zamanda bir cakismayi da kapatiyor: "120-08-" uzerinde
    /// <c>muhtelif:120-08</c> ve <c>bayimuhtelif:120-08</c> diye BIRBIRINDEN HABERSIZ iki sayac
    /// vardi, ikisi de ayni kodu uretebiliyordu (KKTC'de 120-08-000001 hem Customers'ta hem
    /// BayiMuhtelifCustomers'ta farkli isimlerle duruyordu).
    /// </summary>
    private const string BayiMuhtelifCodePrefix = "120-13-";

    private readonly AppDbContext _dbContext;
    private readonly B2B.Erp.Api.Core.Interfaces.IMoneyServiceClient _money;
    private readonly B2B.Erp.Api.Core.Logging.IUserActivityLogger _userActivityLogger;
    private readonly B2B.Erp.Api.Core.Services.ICustomerAccountService _customerAccountService;
    private readonly IWebHostEnvironment _env;

    public CariOffersController(
        AppDbContext dbContext,
        B2B.Erp.Api.Core.Interfaces.IMoneyServiceClient money,
        B2B.Erp.Api.Core.Logging.IUserActivityLogger userActivityLogger,
        B2B.Erp.Api.Core.Services.ICustomerAccountService customerAccountService,
        IWebHostEnvironment env)
    {
        _dbContext = dbContext;
        _money = money;
        _userActivityLogger = userActivityLogger;
        _customerAccountService = customerAccountService;
        _env = env;
    }

    private bool GetRequesterIsSuperAdmin()
    {
        return User.FindFirst("IsSuperAdmin")?.Value == "1";
    }

    private string GetRequesterUsername()
    {
        var claimName = User.FindFirst(ClaimTypes.Name)?.Value;
        if (!string.IsNullOrWhiteSpace(claimName)) return claimName.Trim();

        var identityName = User.Identity?.Name;
        if (!string.IsNullOrWhiteSpace(identityName)) return identityName.Trim();

        return "System";
    }

    /// <summary>
    /// Plasiyer of the offer: the code written on the offer itself, otherwise the salesman
    /// of the user who created it (falling back to the current requester). Used when a
    /// MUHTELIF offer materialises into a real cari, so the new cari belongs to the
    /// plasiyer who made the offer instead of being left unassigned.
    /// </summary>
    private async Task<string?> ResolveOfferSalesmanCodeAsync(string? offerSalesmanCode, string? offerCreateUser, CancellationToken cancellationToken)
    {
        var onOffer = (offerSalesmanCode ?? string.Empty).Trim();
        if (onOffer.Length > 0) return onOffer;

        var username = (offerCreateUser ?? string.Empty).Trim();
        if (username.Length == 0) username = GetRequesterUsername();
        if (string.IsNullOrWhiteSpace(username) || string.Equals(username, "System", StringComparison.OrdinalIgnoreCase)) return null;

        var user = await _dbContext.Users
            .AsNoTracking()
            .Where(x => x.Username == username)
            // Kullanıcının cari kodu `Carikodu` sütununda; `CustomerCode` diye bir alan yok.
            .Select(x => new { x.SalesmanCode, CustomerCode = x.Carikodu })
            .FirstOrDefaultAsync(cancellationToken);

        if (user != null)
        {
            if (!string.IsNullOrWhiteSpace(user.SalesmanCode))
            {
                return user.SalesmanCode.Trim();
            }

            if (!string.IsNullOrWhiteSpace(user.CustomerCode))
            {
                var salesmanFromCustomer = await _dbContext.Customers
                    .AsNoTracking()
                    .Where(x => x.CustomerCode == user.CustomerCode)
                    .Select(x => x.SalesmanCode)
                    .FirstOrDefaultAsync(cancellationToken);
                if (!string.IsNullOrWhiteSpace(salesmanFromCustomer))
                {
                    return salesmanFromCustomer.Trim();
                }
            }
        }

        return null;
    }

    private bool GetRequesterIsBayi()
    {
        var roleCode = User.FindFirst("RoleCode")?.Value;
        roleCode = string.IsNullOrWhiteSpace(roleCode) ? string.Empty : roleCode.Trim();
        if (string.Equals(roleCode, "BAYI", StringComparison.OrdinalIgnoreCase)) return true;
        if (string.Equals(roleCode, "ALTBAYI", StringComparison.OrdinalIgnoreCase)) return true;

        var roleName = User.FindFirst(ClaimTypes.Role)?.Value;
        roleName = string.IsNullOrWhiteSpace(roleName) ? string.Empty : roleName.Trim();
        if (string.Equals(roleName, "Bayi", StringComparison.OrdinalIgnoreCase)) return true;
        return string.Equals(roleName, "AltBayi", StringComparison.OrdinalIgnoreCase) || string.Equals(roleName, "Alt Bayi", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// The discount allowance that applies to an offer: the rate configured on the Users page
    /// for the account holding the offer's salesman code.
    ///
    /// Returns 0 when no salesman is selected or the code matches no account — meaning the
    /// price-group price is the floor. Failing closed here is deliberate: an unknown salesman
    /// must not become an unlimited discount.
    /// </summary>
    private async Task<decimal> ResolveOfferDiscountRateAsync(string? salesmanCode, CancellationToken cancellationToken)
    {
        var code = (salesmanCode ?? string.Empty).Trim();
        if (code.Length == 0) return 0m;

        var rate = await _dbContext.Users
            .AsNoTracking()
            .Where(u => u.SalesmanCode != null && u.SalesmanCode == code)
            .Select(u => u.DiscountRate)
            .FirstOrDefaultAsync(cancellationToken);

        return rate ?? 0m;
    }

    private string? GetRequesterCustomerCode()
    {
        var code = User.FindFirst("Carikodu")?.Value;
        return string.IsNullOrWhiteSpace(code) ? null : code.Trim();
    }

    /// <summary>
    /// "Cari müşteri tekliflerinin HEPSİNİ görebilir" yetkisinin sayfa anahtarı.
    ///
    /// Bu yetki bir SAYFA değil bir kapsam kararı; sayfa yetkileri tablosunda durmasının sebebi
    /// yönetimin tek yerden yapılması. Aynı kalıp `satisFaturaProformaGorsun` (Pages 304) ile
    /// zaten kullanılıyor.
    ///
    /// Rol adı koda YAZILMAZ: Yönetim/SuperAdmin/SSA gömülü olduğu sürece yeni bir rolün
    /// (ör. Muhasebe) hepsini görmesi için kod değiştirmek gerekiyordu.
    /// </summary>
    private const string CariOffersSeeAllPageKey = "cariTeklifleriTumu";

    /// <summary>
    /// SINIRSIZ İNDİRİM yetkisi (2026-08-22 kullanıcı isteği).
    ///
    /// Teklif satırının net birim fiyatı normalde taban fiyat grubunun (TOPTAN F) altına
    /// inemez. Bu yetkiye sahip roller — pratikte SuperAdmin ve Yönetim — tabanın altına
    /// inebilir.
    ///
    /// Rol ADI koda YAZILMIYOR: rol kimlikleri ve adları firmadan firmaya değişebiliyor, ve
    /// "hepsini gör" yetkisinde aynı hata bir kez yapılıp düzeltilmişti. Yetki sayfa
    /// yetkileri ekranından verilir; verilmediği sürece bugünkü davranış aynen sürer.
    /// </summary>
    private const string UnlimitedDiscountPageKey = "musteriTeklifiSinirsizIndirim";

    /// <summary>
    /// Muhtelif cariye SAHİP olarak damgalanacak cari kodu.
    ///
    /// Ham <c>Carikodu</c> claim'i doğrudan yazılamaz: o alan tek bir cari kodu olmak zorunda
    /// değil — ofis kullanıcısında <c>*</c>, plasiyerde virgülle ayrılmış bir portföy olabiliyor
    /// (bkz. ProductsController'daki aynı tuzak). Böyle bir değer sahiplik alanına yazılırsa
    /// hiçbir cariyle eşleşmez ve teklif, sahibinin listesinde bir daha görünmez.
    ///
    /// Tek gerçek cari kodu varsa o yazılır; değilse sahiplik BOŞ bırakılır — o kullanıcılar
    /// zaten <see cref="CariOffersSeeAllPageKey"/> ile hepsini görüyor.
    /// </summary>
    private string? ResolveOwnerCustomerCode()
    {
        var raw = GetRequesterCustomerCode();
        if (string.IsNullOrWhiteSpace(raw)) return null;

        var trimmed = raw.Trim();
        if (trimmed == "*" || string.Equals(trimmed, "ALL", StringComparison.OrdinalIgnoreCase)) return null;

        var codes = trimmed
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return codes.Count == 1 ? codes[0] : null;
    }

    /// <summary>
    /// <see cref="AuthorizePageAttribute"/>'ün buyurgan ikizi: yetki, ucun çağrılıp
    /// çağrılamayacağına değil YANITIN İÇİNE NE GİRECEĞİNE karar veriyor.
    ///
    /// Kapalı başarısız olur: okunamayan bir RoleId geçiş değil rettir.
    /// </summary>
    private async Task<bool> HasPagePermissionAsync(string moduleKey, string pageKey, CancellationToken cancellationToken)
    {
        if (User.FindFirst("IsSuperSuperAdmin")?.Value == "1") return true;
        if (User.FindFirst("IsSuperAdmin")?.Value == "1") return true;

        var roleIdClaim = User.Claims
            .FirstOrDefault(c => string.Equals(c.Type, "RoleId", StringComparison.OrdinalIgnoreCase))?.Value;
        if (!int.TryParse(roleIdClaim, out var roleId)) return false;

        return await _dbContext.RolePagePermissions
            .AsNoTracking()
            .AnyAsync(rpp => rpp.RoleId == roleId
                             && rpp.CanAccess
                             && rpp.Page.ModuleKey == moduleKey
                             && rpp.Page.Key == pageKey, cancellationToken);
    }

    private async Task<List<string>> ResolveAllowedCustomerCodesForRequester(bool includeInactive, CancellationToken cancellationToken)
    {
        var currentCode = GetRequesterCustomerCode();
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        if (isSsa || isSuperAdmin || string.IsNullOrWhiteSpace(currentCode) || currentCode == "*" || string.Equals(currentCode, "ALL", StringComparison.OrdinalIgnoreCase))
        {
            return await _dbContext.Customers.AsNoTracking().Where(x => includeInactive || x.IsActive).Select(x => x.CustomerCode).ToListAsync(cancellationToken);
        }

        var codes = new List<string> { currentCode };

        var branches = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => (includeInactive || x.IsActive) && x.ParentCustomerCode == currentCode)
            .Select(x => x.CustomerCode)
            .ToListAsync(cancellationToken);

        if (branches.Count > 0)
        {
            codes.AddRange(branches.Where(x => !string.IsNullOrWhiteSpace(x)));
        }

        return codes
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static long ParseLast6DigitsOrZero(string code, string prefix)
    {
        var s = (code ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(prefix) || !s.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return 0;
        var suffix = s.Substring(prefix.Length);
        if (suffix.Length != 6) return 0;
        return long.TryParse(suffix, out var n) ? n : 0;
    }

    private async Task<string> ReserveNextBayiMuhtelifCustomerCode(CancellationToken cancellationToken)
    {
        const string prefix = BayiMuhtelifCodePrefix;

        await using var tx = await _dbContext.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken);

        var seriesKey = $"bayimuhtelif:{prefix.TrimEnd('-')}";
        var series = await _dbContext.NumberSeries
            .FirstOrDefaultAsync(x => x.Key == seriesKey, cancellationToken);

        var existingCodes = await _dbContext.BayiMuhtelifCustomers
            .AsNoTracking()
            .Where(x => x.CustomerCode != null && x.CustomerCode.StartsWith(prefix))
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

    private async Task<string> ReserveNextMainCustomerCode(string prefix, CancellationToken cancellationToken)
    {
        await using var tx = await _dbContext.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, cancellationToken);

        var seriesKey = $"customer:{prefix.TrimEnd('-')}";
        var series = await _dbContext.NumberSeries
            .FirstOrDefaultAsync(x => x.Key == seriesKey, cancellationToken);

        var existingCodes = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode != null && x.CustomerCode.StartsWith(prefix))
            .Select(x => x.CustomerCode!)
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

    private async Task<string> PeekNextBayiMuhtelifCustomerCode(CancellationToken cancellationToken)
    {
        const string prefix = BayiMuhtelifCodePrefix;

        var seriesKey = $"bayimuhtelif:{prefix.TrimEnd('-')}";
        var seriesLast = await _dbContext.NumberSeries
            .AsNoTracking()
            .Where(x => x.Key == seriesKey)
            .Select(x => (long?)x.LastValue)
            .FirstOrDefaultAsync(cancellationToken);

        var existingCodes = await _dbContext.BayiMuhtelifCustomers
            .AsNoTracking()
            .Where(x => x.CustomerCode != null && x.CustomerCode.StartsWith(prefix))
            .Select(x => x.CustomerCode)
            .ToListAsync(cancellationToken);

        var maxExisting = existingCodes.Count == 0 ? 0 : existingCodes.Max(c => ParseLast6DigitsOrZero(c, prefix));
        var last = Math.Max(seriesLast ?? 0, maxExisting);
        return prefix + (last + 1).ToString("D6");
    }

    [HttpGet("muhtelif-next-code")]
    [AuthorizePage("invoice", "cariTeklifleri")]
    public async Task<IActionResult> GetNextMuhtelifCode(CancellationToken cancellationToken)
    {
        var code = await PeekNextBayiMuhtelifCustomerCode(cancellationToken);
        return Ok(new { success = true, data = new { customerCode = code } });
    }

    [HttpGet("customers-dropdown")]
    [AuthorizePage("invoice", "cariTeklifleri")]
    public async Task<IActionResult> GetCustomersDropdown([FromQuery] bool includeInactive = false, [FromQuery] bool includeMuhtelif = false, CancellationToken cancellationToken = default)
    {
        // Similar to CustomersController.GetDropdown but uses BayiMuhtelifCustomers instead of MuhtelifCustomers.
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        var query = _dbContext.Customers.AsNoTracking().AsQueryable();

        if (!includeInactive)
        {
            query = query.Where(x => x.IsActive);
        }

        if (!isSuperAdmin)
        {
            var currentCode = User.FindFirst("Carikodu")?.Value;
            currentCode = string.IsNullOrWhiteSpace(currentCode) ? null : currentCode.Trim();
            if (currentCode is null)
            {
                return Ok(new { success = true, data = new List<object>() });
            }

            var allowedCodes = new List<string> { currentCode };

            // KENDİ CARİSİ DE LİSTEDE: yalnız `ParentCustomerCode == currentCode` sorgulanınca
            // bayinin KENDİ ana hesabı listeden düşüyordu. Sonuç tutarsızdı — şubesi olmayan
            // bayi aşağıdaki daldan (satır ~471) kendi carisini görüyor, şubesi olan bayi
            // göremiyordu; yani şube tanımlamak, bayinin kendi adına teklif yapmasını
            // engelliyordu.
            var branches = await _dbContext.Customers
                .AsNoTracking()
                .Where(x => (includeInactive || x.IsActive)
                            && (x.CustomerCode == currentCode || x.ParentCustomerCode == currentCode))
                .OrderBy(x => x.CustomerCode)
                .Select(x => new
                {
                    customerCode = x.CustomerCode,
                    name = x.Name,
                    address = x.Address,
                    city = x.City,
                    district = x.District,
                    phone = x.Phone,
                    fax = x.Fax,
                    email = x.Email,
                    taxOffice = x.TaxOffice,
                    taxNumber = x.TaxNumber,
                    identityNumber = x.IdentityNumber,
                    customerType = x.CustomerType,
                    invoiceType = x.InvoiceType,
                    productCategory = x.ProductCategory,
                    isActive = x.IsActive,
                    priceGroupId = x.PriceGroupId,
                    discountRate = x.DiscountRate,
                    salesmanCode = x.SalesmanCode,
                    creditLimit = x.CreditLimit,
                    parentCustomerCode = x.ParentCustomerCode,
                    currencyTypeId = x.CurrencyTypeId
                })
                .ToListAsync(cancellationToken);

            if (branches.Count > 0)
            {
                allowedCodes.AddRange(branches.Select(x => (string)x.customerCode).Where(x => !string.IsNullOrWhiteSpace(x)));
            }

            if (branches.Count > 0)
            {
                var list = new List<object>(branches.Cast<object>());

                if (includeMuhtelif)
                {
                    list.Insert(0, new
                    {
                        customerCode = "MUHTELIF",
                        name = "Muhtelif",
                        isActive = true
                    });

                    var muhtelifList = await _dbContext.BayiMuhtelifCustomers
                        .AsNoTracking()
                        .Where(x => x.OwnerCustomerCode != null && allowedCodes.Contains(x.OwnerCustomerCode))
                        .OrderBy(x => x.CustomerCode)
                        .Select(x => new
                        {
                            customerCode = x.CustomerCode,
                            name = x.Name,
                            address = x.Address,
                            city = x.City,
                            district = x.District,
                            phone = x.Phone,
                            email = x.Email,
                            taxOffice = x.TaxOffice,
                            taxNumber = x.TaxNumber,
                            isActive = true,
                            isMuhtelif = true
                        })
                        .ToListAsync(cancellationToken);

                    list.AddRange(muhtelifList.Cast<object>());
                }

                return Ok(new { success = true, data = list });
            }

            query = query.Where(x => x.CustomerCode == currentCode);
        }

        var data = await query
            .OrderBy(x => x.CustomerCode)
            .Select(x => new
            {
                customerCode = x.CustomerCode,
                name = x.Name,
                address = x.Address,
                city = x.City,
                district = x.District,
                phone = x.Phone,
                fax = x.Fax,
                email = x.Email,
                taxOffice = x.TaxOffice,
                taxNumber = x.TaxNumber,
                identityNumber = x.IdentityNumber,
                customerType = x.CustomerType,
                invoiceType = x.InvoiceType,
                productCategory = x.ProductCategory,
                isActive = x.IsActive,
                priceGroupId = x.PriceGroupId,
                discountRate = x.DiscountRate,
                salesmanCode = x.SalesmanCode,
                creditLimit = x.CreditLimit,
                parentCustomerCode = x.ParentCustomerCode,
                currencyTypeId = x.CurrencyTypeId
            })
            .ToListAsync(cancellationToken);

        if (includeMuhtelif)
        {
            var list = data.Cast<object>().ToList();

            list.Insert(0, new
            {
                customerCode = "MUHTELIF",
                name = "Muhtelif",
                isActive = true
            });

            var muhtelifQuery = _dbContext.BayiMuhtelifCustomers.AsNoTracking().AsQueryable();
            if (!isSuperAdmin)
            {
                var currentCode = User.FindFirst("Carikodu")?.Value;
                currentCode = string.IsNullOrWhiteSpace(currentCode) ? null : currentCode.Trim();
                if (currentCode is null)
                {
                    return Ok(new { success = true, data = new List<object>() });
                }

                var allowedCodes = data
                    .Select(x => x.customerCode)
                    .Where(x => !string.IsNullOrWhiteSpace(x))
                    .ToList();

                if (!allowedCodes.Contains(currentCode)) allowedCodes.Insert(0, currentCode);

                muhtelifQuery = muhtelifQuery.Where(x => x.OwnerCustomerCode != null && allowedCodes.Contains(x.OwnerCustomerCode));
            }

            var muhtelifList = await muhtelifQuery
                .OrderBy(x => x.CustomerCode)
                .Select(x => new
                {
                    customerCode = x.CustomerCode,
                    name = x.Name,
                    address = x.Address,
                    city = x.City,
                    district = x.District,
                    phone = x.Phone,
                    email = x.Email,
                    taxOffice = x.TaxOffice,
                    taxNumber = x.TaxNumber,
                    isActive = true,
                    isMuhtelif = true
                })
                .ToListAsync(cancellationToken);

            list.AddRange(muhtelifList.Cast<object>());
            return Ok(new { success = true, data = list });
        }

        return Ok(new { success = true, data });
    }

    [HttpGet]
    [AuthorizePage("invoice", "cariTeklifleri")]
    public async Task<IActionResult> List([FromQuery] int take = 100, [FromQuery] int skip = 0, CancellationToken cancellationToken = default)
    {
        take = Math.Clamp(take, 1, 500);
        // Sayfalı okuma (2026-10-08): ekran 'son N' yerine skip ile hepsini çekiyor; eski kayıtlar
        // aramada/süzgeçte görünmüyordu (alış faturalarında 25.08 faturası bulunamadı).
        skip = Math.Max(0, skip);

        var username = GetRequesterUsername();

        // "Hepsini gor" ROL ADINA GOMULU DEGIL, sayfa yetkisi (bkz. CariOffersSeeAllPageKey):
        // Yonetim/SuperAdmin/SSA'yi koda yazmak, yeni bir rol eklendiginde her seferinde kod
        // degisikligi gerektiriyordu.
        var seesAllOffers = await HasPagePermissionAsync("invoice", CariOffersSeeAllPageKey, cancellationToken);

        // Kapsam KULLANICI degil CARI eksenli: ayni bayide calisan iki kisi birbirinin
        // tekliflerini gorebilmeli (kullanici karari, 2026-08-11). Eskiden CreateUser eslesmesi
        // araniyordu ve bayideki ikinci personel hicbir teklifi goremiyordu.
        var allowed = seesAllOffers
            ? new List<string>()
            : await ResolveAllowedCustomerCodesForRequester(includeInactive: true, cancellationToken);

        var baseQuery =
            from o in _dbContext.CariOffers.AsNoTracking()
            join u in _dbContext.Users.AsNoTracking() on o.CreateUser equals u.Username into uj
            from u in uj.DefaultIfEmpty()
            join c in _dbContext.Customers.AsNoTracking() on o.CustomerCode equals c.CustomerCode into cj
            from c in cj.DefaultIfEmpty()
            select new { o, u, c };

        var filteredQuery = baseQuery;

        // Tek kural: "hepsini gör" yetkisi yoksa yalnızca KENDİ CARİNE ait teklifler.
        // Sahiplik iki yoldan kurulur — teklif doğrudan bir cariye bağlıysa `CustomerCode`,
        // muhtelif teklifse muhtelif carinin `OwnerCustomerCode`'u. Ayrıca kendi açtığın teklif
        // (CreateUser) her hâlükârda görünür: cari bağı bir şekilde kurulamamış eski kayıtlar
        // sahibinin elinden düşmesin.
        if (!seesAllOffers)
        {
            filteredQuery = filteredQuery.Where(x =>
                (x.o.CreateUser != null && EF.Functions.ILike(x.o.CreateUser, username))
                || (x.o.CustomerCode != null && allowed.Contains(x.o.CustomerCode))
                || (x.o.BayiMuhtelifCustomer != null
                    && x.o.BayiMuhtelifCustomer.OwnerCustomerCode != null
                    && allowed.Contains(x.o.BayiMuhtelifCustomer.OwnerCustomerCode))
            );
        }

        var items = await filteredQuery
            .OrderByDescending(x => x.o.Id)
            .Skip(skip).Take(take)
            .Select(x => new
            {
                id = x.o.Id,
                date = x.o.Date,
                documentNo = x.o.DocumentNo,
                customerCode = x.o.BayiMuhtelifCustomer != null ? x.o.BayiMuhtelifCustomer.CustomerCode : x.o.CustomerCode,
                customerName = x.o.BayiMuhtelifCustomer != null ? x.o.BayiMuhtelifCustomer.Name : (x.c != null ? x.c.Name : null),
                deliveryCustomerCode = x.o.DeliveryCustomerCode,
                description = x.o.Description,
                vatExempt = x.o.VatExempt,
                subtotal = x.o.Subtotal,
                discountTotal = x.o.DiscountTotal,
                netTotal = x.o.NetTotal,
                vatTotal = x.o.VatTotal,
                grandTotal = x.o.GrandTotal,
                createUser = x.o.CreateUser,
                proformaDocumentNo = x.o.ProformaDocumentNo,
                invoiceId = x.o.InvoiceId,
                invoiceNo = x.o.InvoiceNo,
                // Teklifin KENDİ para birimi (2026-08-17): carinin kartı okunmuyor.
                currencyTypeId = x.o.CurrencyTypeId,
                lines = x.o.Lines
                    .OrderBy(l => l.LineNo)
                    .Select(l => new
                    {
                        id = l.Id,
                        productId = l.ProductId,
                        stockCode = l.StockCode,
                        stockName = l.Product != null ? l.Product.Name : string.Empty,
                        // Proforma basımı en solda barkodu yazıyor; ürün adına bakıp ayrıca
                        // sorgu atmamak için kalemle birlikte geliyor.
                        barcode = l.Product != null ? l.Product.Barcode : null,
                        description = l.Description,
                        quantity = l.Quantity,
                        unitPrice = l.UnitPrice,
                        vatRate = l.VatRate,
                        discountType = l.DiscountType,
                        discountValue = l.DiscountValue,
                        lineNo = l.LineNo,
                        // SATIŞ dövizinin çapası `Product.SalesCurrencyCode`; fiyat satırından
                        // filtresiz `FirstOrDefault()` rastgele bir fiyat grubunun para
                        // birimini getiriyordu (fiyat satırı yoksa da ALIŞ dövizine düşüyordu).
                        currencyCode = l.CurrencyTypeId > 0 ? l.CurrencyTypeId : (l.Product != null ? l.Product.SalesCurrencyCode : 0)
                    })
                    .ToList()
            })
            .ToListAsync(cancellationToken);

        var customerCodes = items
            .Where(x => !string.IsNullOrWhiteSpace(x.customerCode) && x.customerCode != "MUHTELIF")
            .Select(x => x.customerCode!)
            .Concat(items
                .Where(x => !string.IsNullOrWhiteSpace(x.deliveryCustomerCode))
                .Select(x => x.deliveryCustomerCode!))
            .Distinct()
            .ToList();

        var customerNameByCode = customerCodes.Count == 0
            ? new Dictionary<string, string>()
            : await _dbContext.Customers
                .AsNoTracking()
                .Where(x => customerCodes.Contains(x.CustomerCode))
                .Select(x => new { x.CustomerCode, x.Name })
                .ToDictionaryAsync(x => x.CustomerCode, x => x.Name, cancellationToken);

        var normalized = items.Select(x => new
        {
            x.id,
            x.date,
            x.documentNo,
            x.customerCode,
            customerName = !string.IsNullOrWhiteSpace(x.customerName) ? x.customerName : (x.customerCode != null && customerNameByCode.TryGetValue(x.customerCode, out var n) ? n : null),
            deliveryCustomerCode = x.deliveryCustomerCode,
            deliveryCustomerName = x.deliveryCustomerCode != null && customerNameByCode.TryGetValue(x.deliveryCustomerCode, out var dn) ? dn : null,
            x.description,
            x.vatExempt,
            x.subtotal,
            x.discountTotal,
            x.netTotal,
            x.vatTotal,
            x.grandTotal,
            x.createUser,
            x.proformaDocumentNo,
            x.invoiceId,
            x.invoiceNo,
            x.currencyTypeId,
            x.lines
        });

        return Ok(new { success = true, data = normalized });
    }

    [HttpGet("bayi-offers")]
    [AuthorizePage("invoice", "bayiTeklifleri")]
    public async Task<IActionResult> ListBayiOffers([FromQuery] int take = 100, CancellationToken cancellationToken = default)
    {
        take = Math.Clamp(take, 1, 500);

        var bayiRoleIds = await _dbContext.Roles
            .AsNoTracking()
            .Where(r => r.Code != null && (r.Code.ToLower() == "bayi" || r.Code.ToLower() == "altbayi"))
            .Select(r => r.Id)
            .ToListAsync(cancellationToken);

        var baseQuery =
            from o in _dbContext.CariOffers.AsNoTracking()
            join u in _dbContext.Users.AsNoTracking() on o.CreateUser equals u.Username into uj
            from u in uj.DefaultIfEmpty()
            join c in _dbContext.Customers.AsNoTracking() on o.CustomerCode equals c.CustomerCode into cj
            from c in cj.DefaultIfEmpty()
            where u != null && bayiRoleIds.Contains(u.RoleId)
            select new { o, c };

        var items = await baseQuery
            .OrderByDescending(x => x.o.Id)
            .Take(take)
            .Select(x => new
            {
                id = x.o.Id,
                date = x.o.Date,
                documentNo = x.o.DocumentNo,
                customerCode = x.o.BayiMuhtelifCustomer != null
                    ? x.o.BayiMuhtelifCustomer.CustomerCode
                    : (x.o.CustomerCode ?? (x.o.BayiMuhtelifCustomerId != null ? "MUHTELIF" : null)),
                customerName = x.o.BayiMuhtelifCustomer != null
                    ? x.o.BayiMuhtelifCustomer.Name
                    : (x.c != null ? x.c.Name : null),
                deliveryCustomerCode = x.o.DeliveryCustomerCode,
                description = x.o.Description,
                vatExempt = x.o.VatExempt,
                subtotal = x.o.Subtotal,
                discountTotal = x.o.DiscountTotal,
                netTotal = x.o.NetTotal,
                vatTotal = x.o.VatTotal,
                grandTotal = x.o.GrandTotal,
                createUser = x.o.CreateUser,
                proformaDocumentNo = x.o.ProformaDocumentNo,
                invoiceId = x.o.InvoiceId,
                invoiceNo = x.o.InvoiceNo,
                // Teklifin KENDİ para birimi (2026-08-17): carinin kartı okunmuyor.
                currencyTypeId = x.o.CurrencyTypeId,
                lines = x.o.Lines
                    .OrderBy(l => l.LineNo)
                    .Select(l => new
                    {
                        id = l.Id,
                        productId = l.ProductId,
                        stockCode = l.StockCode,
                        stockName = l.Product != null ? l.Product.Name : string.Empty,
                        // Proforma basımı en solda barkodu yazıyor; ürün adına bakıp ayrıca
                        // sorgu atmamak için kalemle birlikte geliyor.
                        barcode = l.Product != null ? l.Product.Barcode : null,
                        description = l.Description,
                        quantity = l.Quantity,
                        unitPrice = l.UnitPrice,
                        vatRate = l.VatRate,
                        discountType = l.DiscountType,
                        discountValue = l.DiscountValue,
                        lineNo = l.LineNo,
                        // SATIŞ dövizinin çapası `Product.SalesCurrencyCode`; fiyat satırından
                        // filtresiz `FirstOrDefault()` rastgele bir fiyat grubunun para
                        // birimini getiriyordu (fiyat satırı yoksa da ALIŞ dövizine düşüyordu).
                        currencyCode = l.Product != null ? l.Product.SalesCurrencyCode : 0
                    })
                    .ToList()
            })
            .ToListAsync(cancellationToken);

        var customerCodes = items
            .Where(x => !string.IsNullOrWhiteSpace(x.customerCode) && x.customerCode != "MUHTELIF")
            .Select(x => x.customerCode!)
            .Concat(items
                .Where(x => !string.IsNullOrWhiteSpace(x.deliveryCustomerCode))
                .Select(x => x.deliveryCustomerCode!))
            .Distinct()
            .ToList();

        var customerNameByCode = customerCodes.Count == 0
            ? new Dictionary<string, string>()
            : await _dbContext.Customers
                .AsNoTracking()
                .Where(x => customerCodes.Contains(x.CustomerCode))
                .Select(x => new { x.CustomerCode, x.Name })
                .ToDictionaryAsync(x => x.CustomerCode, x => x.Name, cancellationToken);

        var normalized = items.Select(x => new
        {
            x.id,
            x.date,
            x.documentNo,
            x.customerCode,
            customerName = x.customerCode != null && x.customerCode != "MUHTELIF" && customerNameByCode.TryGetValue(x.customerCode, out var n) ? n : x.customerName,
            deliveryCustomerCode = x.deliveryCustomerCode,
            deliveryCustomerName = x.deliveryCustomerCode != null && customerNameByCode.TryGetValue(x.deliveryCustomerCode, out var dn) ? dn : null,
            x.description,
            x.vatExempt,
            x.subtotal,
            x.discountTotal,
            x.netTotal,
            x.vatTotal,
            x.grandTotal,
            x.createUser,
            x.proformaDocumentNo,
            x.invoiceId,
            x.invoiceNo,
            x.currencyTypeId,
            x.lines
        });

        return Ok(new { success = true, data = normalized });
    }

    [HttpGet("bayi-muhtelif-customers")]
    [AuthorizePage("users", "cariEkle")]
    public async Task<IActionResult> ListBayiMuhtelifCustomers([FromQuery] int take = 200, CancellationToken cancellationToken = default)
    {
        take = Math.Clamp(take, 1, 500);

        var isBayi = GetRequesterIsBayi();
        var isSuperAdmin = GetRequesterIsSuperAdmin();

        // "Hepsini gor" ROL ADINA GOMULU DEGIL, sayfa yetkisi (bkz. CariOffersSeeAllPageKey):
        // Yonetim/SuperAdmin/SSA'yi koda yazmak, yeni bir rol eklendiginde her seferinde kod
        // degisikligi gerektiriyordu.
        var seesAllOffers = await HasPagePermissionAsync("invoice", CariOffersSeeAllPageKey, cancellationToken);

        // Kapsam KULLANICI degil CARI eksenli: ayni bayide calisan iki kisi birbirinin
        // tekliflerini gorebilmeli (kullanici karari, 2026-08-11). Eskiden CreateUser eslesmesi
        // araniyordu ve bayideki ikinci personel hicbir teklifi goremiyordu.
        var allowed = seesAllOffers
            ? new List<string>()
            : await ResolveAllowedCustomerCodesForRequester(includeInactive: true, cancellationToken);

        var query =
            from mc in _dbContext.BayiMuhtelifCustomers.AsNoTracking()
            where _dbContext.CariOffers.AsNoTracking().Any(o =>
                o.BayiMuhtelifCustomerId == mc.Id
                && o.ProformaDocumentNo != null)
            select mc;

        if (!seesAllOffers)
        {
            query = query.Where(x => x.OwnerCustomerCode != null && allowed.Contains(x.OwnerCustomerCode));
        }

        var data = await query
            .OrderByDescending(x => x.Id)
            .Take(take)
            .Select(x => new
            {
                customerCode = x.CustomerCode,
                name = x.Name,
                city = x.City,
                district = x.District,
                address = x.Address,
                phone = x.Phone,
                email = x.Email,
                taxOffice = x.TaxOffice,
                taxNumber = x.TaxNumber
            })
            .ToListAsync(cancellationToken);

        return Ok(new { success = true, data });
    }

    [HttpGet("{id:int}")]
    [AuthorizePage("invoice", "cariTeklifleri")]
    public async Task<IActionResult> Get([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var offer = await _dbContext.CariOffers
            .AsNoTracking()
            .Include(x => x.BayiMuhtelifCustomer)
            .Include(x => x.Lines)
            .ThenInclude(x => x.Product)
            .Where(x => x.Id == id)
            .Select(x => new
            {
                id = x.Id,
                date = x.Date,
                documentNo = x.DocumentNo,
                customerCode = x.BayiMuhtelifCustomer != null
                    ? x.BayiMuhtelifCustomer.CustomerCode
                    : x.CustomerCode,
                customerName = x.BayiMuhtelifCustomer != null
                    ? x.BayiMuhtelifCustomer.Name
                    : (x.CustomerCode == null ? null : _dbContext.Customers.Where(c => c.CustomerCode == x.CustomerCode).Select(c => c.Name).FirstOrDefault()),
                deliveryCustomerCode = x.DeliveryCustomerCode,
                deliveryCustomerName = x.DeliveryCustomerCode == null
                    ? null
                    : _dbContext.Customers.Where(c => c.CustomerCode == x.DeliveryCustomerCode).Select(c => c.Name).FirstOrDefault(),
                description = x.Description,
                vatExempt = x.VatExempt,
                salesmanCode = x.SalesmanCode,
                muhtelif = x.BayiMuhtelifCustomer == null
                    ? null
                    : new
                    {
                        customerCode = x.BayiMuhtelifCustomer.CustomerCode,
                        name = x.BayiMuhtelifCustomer.Name,
                        city = x.BayiMuhtelifCustomer.City,
                        district = x.BayiMuhtelifCustomer.District,
                        address = x.BayiMuhtelifCustomer.Address,
                        phone = x.BayiMuhtelifCustomer.Phone,
                        email = x.BayiMuhtelifCustomer.Email,
                        taxOffice = x.BayiMuhtelifCustomer.TaxOffice,
                        taxNumber = x.BayiMuhtelifCustomer.TaxNumber
                    },
                subtotal = x.Subtotal,
                discountTotal = x.DiscountTotal,
                netTotal = x.NetTotal,
                vatTotal = x.VatTotal,
                grandTotal = x.GrandTotal,
                createUser = x.CreateUser,
                // Teklifin KENDİ para birimi (2026-08-17): carinin kartına alt sorgu atılmıyor.
                currencyTypeId = x.CurrencyTypeId,
                proformaDocumentNo = x.ProformaDocumentNo,
                invoiceId = x.InvoiceId,
                invoiceNo = x.InvoiceNo,
                lines = x.Lines
                    .OrderBy(l => l.LineNo)
                    .Select(l => new
                    {
                        id = l.Id,
                        productId = l.ProductId,
                        stockCode = l.StockCode,
                        stockName = l.Product != null ? l.Product.Name : string.Empty,
                        // Proforma basımı en solda barkodu yazıyor; ürün adına bakıp ayrıca
                        // sorgu atmamak için kalemle birlikte geliyor.
                        barcode = l.Product != null ? l.Product.Barcode : null,
                        description = l.Description,
                        quantity = l.Quantity,
                        unitPrice = l.UnitPrice,
                        vatRate = l.VatRate,
                        discountType = l.DiscountType,
                        discountValue = l.DiscountValue,
                        lineNo = l.LineNo,
                        // SATIŞ dövizinin çapası `Product.SalesCurrencyCode`; fiyat satırından
                        // filtresiz `FirstOrDefault()` rastgele bir fiyat grubunun para
                        // birimini getiriyordu (fiyat satırı yoksa da ALIŞ dövizine düşüyordu).
                        currencyCode = l.CurrencyTypeId > 0 ? l.CurrencyTypeId : (l.Product != null ? l.Product.SalesCurrencyCode : 0)
                    })
                    .ToList()
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (offer is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        return Ok(new { success = true, data = offer });
    }

    [HttpGet("{offerId:int}/yazdir")]
    [AuthorizePage("invoice", "cariTeklifleri")]
    public async Task<IActionResult> PrintOffer(
        [FromRoute] int offerId,
        [FromQuery] string? form,
        CancellationToken cancellationToken)
    {
        var model = await new OfferPrintModelBuilder(_dbContext, _env).BuildCariOfferAsync(offerId, cancellationToken);
        if (model is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        var kind = string.Equals(form, "ozellikli", StringComparison.OrdinalIgnoreCase)
            ? OfferFormKind.Featured
            : OfferFormKind.Plain;

        var pdf = new OfferFormRenderer().Render(model, kind, showHeaderBanner: false, showTopLeftLogo: true);

        Response.Headers.ContentDisposition = $"inline; filename=teklif-{offerId}.pdf";
        return File(pdf, "application/pdf");
    }

    [HttpGet("new-document-no")]
    [AuthorizePage("invoice", "cariTeklifleri")]
    public async Task<IActionResult> GetNewDocumentNo(CancellationToken cancellationToken)
    {
        var no = await GenerateUniqueDocumentNo(cancellationToken);
        return Ok(new { success = true, data = new { documentNo = no } });
    }

    [HttpPost]
    [AuthorizePage("invoice", "cariTeklifleri")]
    [ProducesResponseType(typeof(CariOfferCreatedResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<CariOfferCreatedResponse>> Create([FromBody] CreateCariOfferRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var customerCode = string.IsNullOrWhiteSpace(request.CustomerCode) ? null : request.CustomerCode.Trim();

        var isMuhtelif = string.Equals(customerCode, "MUHTELIF", StringComparison.OrdinalIgnoreCase);
        BayiMuhtelifCustomer? existingMuhtelifCustomer = null;
        if (isMuhtelif)
        {
            customerCode = null;

            if (request.Muhtelif is null)
            {
                ModelState.AddModelError(nameof(request.Muhtelif), "Muhtelif seçildiğinde muhtelif bilgileri zorunludur.");
                return ValidationProblem(ModelState);
            }
        }
        else
        {
            if (string.IsNullOrWhiteSpace(customerCode))
            {
                ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode zorunludur.");
                return ValidationProblem(ModelState);
            }

            var customerExists = await _dbContext.Customers
                .AsNoTracking()
                .AnyAsync(x => x.CustomerCode == customerCode, cancellationToken);

            if (!customerExists)
            {
                existingMuhtelifCustomer = await ResolveScopedBayiMuhtelifCustomerByCode(customerCode, cancellationToken);
                if (existingMuhtelifCustomer is null)
                {
                    ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode geçersiz.");
                    return ValidationProblem(ModelState);
                }

                isMuhtelif = true;
                customerCode = null;
            }
        }

        if (GetRequesterIsBayi() && !GetRequesterIsSuperAdmin())
        {
            if (!isMuhtelif)
            {
                var allowed = await ResolveAllowedCustomerCodesForRequester(includeInactive: true, cancellationToken);
                if (allowed.Count > 0 && (customerCode is null || !allowed.Contains(customerCode)))
                {
                    return BadRequest(new { success = false, message = "Bu cari için teklif oluşturma yetkiniz yok" });
                }
            }
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

        var productIds = request.Lines.Select(x => x.ProductId).Distinct().ToList();
        var products = await _dbContext.Products
            .AsNoTracking()
            .Where(x => productIds.Contains(x.Id))
            .Select(x => new { x.Id, x.StockCode, x.TaxRate })
            .ToListAsync(cancellationToken);

        if (products.Count != productIds.Count)
        {
            return BadRequest(new { success = false, message = "Ürün listesinde geçersiz kayıt var." });
        }

        var productById = products.ToDictionary(x => x.Id, x => x);

        var (priceGroupId, resolvedCustomerCodeForPricing) = isMuhtelif
            ? (await ResolveMuhtelifPriceGroup(cancellationToken), null)
            : await ResolvePriceGroup(customerCode, cancellationToken);

        var priceByProductId = await ResolveUnitPrices(productIds, resolvedCustomerCodeForPricing, priceGroupId, cancellationToken);

        foreach (var line in request.Lines)
        {
            if (!priceByProductId.ContainsKey(line.ProductId))
            {
                return BadRequest(new { success = false, message = "Ürün fiyatı bulunamadı." });
            }
        }

        var now = DateTime.UtcNow;
        var username = GetRequesterUsername();
        var ownerCustomerCode = ResolveOwnerCustomerCode();

        var muhtelifEntity = isMuhtelif
            ? (existingMuhtelifCustomer is not null
                ? null
                : new BayiMuhtelifCustomer
                {
                    OwnerCustomerCode = ownerCustomerCode,
                    CustomerCode = (await ReserveNextBayiMuhtelifCustomerCode(cancellationToken)).Trim(),
                    Name = request.Muhtelif!.Name.Trim(),
                    City = request.Muhtelif!.City?.Trim(),
                    District = request.Muhtelif!.District?.Trim(),
                    Address = request.Muhtelif!.Address?.Trim(),
                    Phone = request.Muhtelif!.Phone?.Trim(),
                    Email = request.Muhtelif!.Email?.Trim(),
                    TaxOffice = request.Muhtelif!.TaxOffice?.Trim(),
                    TaxNumber = request.Muhtelif!.TaxNumber?.Trim(),
                    CreateUser = username,
                    CreateTime = now
                })
            : null;

        if (muhtelifEntity is not null)
        {
            if (string.IsNullOrWhiteSpace(muhtelifEntity.Name))
            {
                ModelState.AddModelError(nameof(request.Muhtelif.Name), "Cari Adı zorunludur.");
            }

            if (!ModelState.IsValid)
            {
                return ValidationProblem(ModelState);
            }

            _dbContext.BayiMuhtelifCustomers.Add(muhtelifEntity);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        var documentNo = await GenerateUniqueDocumentNo(cancellationToken);

        var requestDate = request.Date ?? DateTime.UtcNow;
        var dateOnlyUtc = DateTime.SpecifyKind(requestDate.Date, DateTimeKind.Utc);

        var dbUser = await _dbContext.Users
            .AsNoTracking()
            .Include(u => u.Role)
            .FirstOrDefaultAsync(u => u.Username == username, cancellationToken);

        // The allowance belongs to the salesman the offer is written for, not to whoever is
        // typing. This used to read the signed-in user's own rate, so a manager quoting on
        // behalf of a salesman was measured against their own (usually unset) limit — and,
        // because the check only ran for salesman accounts, was not measured at all.
        var discountRate = await ResolveOfferDiscountRateAsync(request.SalesmanCode, cancellationToken);
        bool canOverridePrice = dbUser?.Role?.IsSuperAdmin == true || discountRate > 0;

        foreach (var l in request.Lines)
        {
            var p = productById[l.ProductId];
            var dbPrice = priceByProductId[l.ProductId].Price;
            if (l.UnitPrice.HasValue && l.UnitPrice.Value > 0)
            {
                var minAllowedPrice = dbPrice * (1 - discountRate / 100);
                if (l.UnitPrice.Value < minAllowedPrice)
                {
                    return BadRequest(new { success = false, message = $"{p.StockCode} kodlu ürün için belirlediğiniz birim fiyat ({l.UnitPrice.Value:N2} TL), seçili plasiyerin indirim yetkisi (%{discountRate}) ile belirlenen minimum fiyattan ({minAllowedPrice:N2} TL) düşük olamaz." });
                }
            }
        }

        bool isAcikCari = false;
        if (!isMuhtelif && !string.IsNullOrWhiteSpace(customerCode))
        {
            var cust = await _dbContext.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.CustomerCode == customerCode, cancellationToken);
            if (cust != null)
            {
                var invType = (cust.InvoiceType ?? string.Empty).Trim().ToUpperInvariant();
                if (invType == "ACIK" || invType == "AÇIK")
                {
                    isAcikCari = true;
                }
                else if (cust.PriceGroupId.HasValue)
                {
                    var pg = await _dbContext.PriceGroups.AsNoTracking().FirstOrDefaultAsync(p => p.Id == cust.PriceGroupId.Value, cancellationToken);
                    if (pg != null && (pg.Code == 4 || pg.Code == 5 || pg.Code == 6))
                    {
                        isAcikCari = true;
                    }
                }
            }
        }

        var offer = new CariOffer
        {
            Date = dateOnlyUtc,
            DocumentNo = documentNo,
            CustomerCode = customerCode,
            DeliveryCustomerCode = string.IsNullOrWhiteSpace(request.DeliveryCustomerCode) ? null : request.DeliveryCustomerCode.Trim(),
            BayiMuhtelifCustomerId = existingMuhtelifCustomer?.Id ?? muhtelifEntity?.Id,
            VatExempt = isAcikCari || request.VatExempt,
            SalesmanCode = string.IsNullOrWhiteSpace(request.SalesmanCode) ? null : request.SalesmanCode.Trim(),
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = username,
            CreateTime = now
        };

        var lines = request.Lines.Select((l, idx) =>
        {
            var p = productById[l.ProductId];
            var resolved = priceByProductId[l.ProductId];
            var finalUnitPrice = resolved.Price;

            if (l.UnitPrice.HasValue && l.UnitPrice.Value > 0)
            {
                if (canOverridePrice)
                {
                    finalUnitPrice = l.UnitPrice.Value;
                }
            }

            return new CariOfferLine
            {
                ProductId = l.ProductId,
                StockCode = p.StockCode,
                Quantity = l.Quantity,
                UnitPrice = finalUnitPrice,
                // Kalem, fiyatın geldiği SATIŞ dövizindedir; elle fiyat girilse de para
                // birimi aynı listenin parasıdır.
                CurrencyTypeId = resolved.CurrencyTypeId,
                VatRate = (isAcikCari || offer.VatExempt) ? 0m : p.TaxRate,
                DiscountType = isAcikCari ? CustomerOfferLineDiscountType.None : l.DiscountType,
                DiscountValue = isAcikCari ? 0m : l.DiscountValue,
                LineNo = idx + 1,
                CreateUser = username,
                CreateTime = now
            };
        }).ToList();

        foreach (var l in lines)
        {
            offer.Lines.Add(l);
        }

        await ApplyOfferCurrencyAsync(offer, cancellationToken, request.CurrencyTypeId);

        ComputeTotals(offer);

        var floorError = await ValidatePriceFloorAsync(offer, cancellationToken);
        if (floorError is not null)
        {
            return BadRequest(new { success = false, message = floorError });
        }

        _dbContext.CariOffers.Add(offer);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var response = new CariOfferCreatedResponse { Id = offer.Id, DocumentNo = offer.DocumentNo };
        return CreatedAtAction(nameof(Create), new { id = response.Id }, response);
    }

    [AtomicRequest]
    [HttpPut("{id:int}")]
    [AuthorizePage("invoice", "cariTeklifleri")]
    public async Task<IActionResult> Update([FromRoute] int id, [FromBody] UpdateCariOfferRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var offer = await _dbContext.CariOffers
            .Include(x => x.BayiMuhtelifCustomer)
            .Include(x => x.Lines)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (offer is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        var customerCode = string.IsNullOrWhiteSpace(request.CustomerCode) ? null : request.CustomerCode.Trim();

        var isMuhtelif = string.Equals(customerCode, "MUHTELIF", StringComparison.OrdinalIgnoreCase);
        BayiMuhtelifCustomer? existingMuhtelifCustomer = null;
        if (isMuhtelif)
        {
            customerCode = null;

            if (request.Muhtelif is null)
            {
                ModelState.AddModelError(nameof(request.Muhtelif), "Muhtelif seçildiğinde muhtelif bilgileri zorunludur.");
                return ValidationProblem(ModelState);
            }
        }
        else
        {
            if (string.IsNullOrWhiteSpace(customerCode))
            {
                ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode zorunludur.");
                return ValidationProblem(ModelState);
            }

            var customerExists = await _dbContext.Customers
                .AsNoTracking()
                .AnyAsync(x => x.CustomerCode == customerCode, cancellationToken);

            if (!customerExists)
            {
                existingMuhtelifCustomer = await ResolveScopedBayiMuhtelifCustomerByCode(customerCode, cancellationToken);
                if (existingMuhtelifCustomer is null)
                {
                    ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode geçersiz.");
                    return ValidationProblem(ModelState);
                }

                isMuhtelif = true;
                customerCode = null;
            }
        }

        if (GetRequesterIsBayi() && !GetRequesterIsSuperAdmin())
        {
            if (!isMuhtelif)
            {
                var allowed = await ResolveAllowedCustomerCodesForRequester(includeInactive: true, cancellationToken);
                if (allowed.Count > 0 && (customerCode is null || !allowed.Contains(customerCode)))
                {
                    return BadRequest(new { success = false, message = "Bu cari için teklif oluşturma yetkiniz yok" });
                }
            }
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

        var productIds = request.Lines.Select(x => x.ProductId).Distinct().ToList();
        var products = await _dbContext.Products
            .AsNoTracking()
            .Where(x => productIds.Contains(x.Id))
            .Select(x => new { x.Id, x.StockCode, x.TaxRate })
            .ToListAsync(cancellationToken);

        if (products.Count != productIds.Count)
        {
            return BadRequest(new { success = false, message = "Ürün listesinde geçersiz kayıt var." });
        }

        var productById = products.ToDictionary(x => x.Id, x => x);

        var (priceGroupId, resolvedCustomerCodeForPricing) = isMuhtelif
            ? (await ResolveMuhtelifPriceGroup(cancellationToken), null)
            : await ResolvePriceGroup(customerCode, cancellationToken);

        var priceByProductId = await ResolveUnitPrices(productIds, resolvedCustomerCodeForPricing, priceGroupId, cancellationToken);

        foreach (var line in request.Lines)
        {
            if (!priceByProductId.ContainsKey(line.ProductId))
            {
                return BadRequest(new { success = false, message = "Ürün fiyatı bulunamadı." });
            }
        }

        var now = DateTime.UtcNow;
        var username = GetRequesterUsername();

        var dbUser = await _dbContext.Users
            .AsNoTracking()
            .Include(u => u.Role)
            .FirstOrDefaultAsync(u => u.Username == username, cancellationToken);

        // The allowance belongs to the salesman the offer is written for, not to whoever is
        // typing. This used to read the signed-in user's own rate, so a manager quoting on
        // behalf of a salesman was measured against their own (usually unset) limit — and,
        // because the check only ran for salesman accounts, was not measured at all.
        var discountRate = await ResolveOfferDiscountRateAsync(request.SalesmanCode, cancellationToken);
        bool canOverridePrice = dbUser?.Role?.IsSuperAdmin == true || discountRate > 0;

        foreach (var l in request.Lines)
        {
            var p = productById[l.ProductId];
            var dbPrice = priceByProductId[l.ProductId].Price;
            if (l.UnitPrice.HasValue && l.UnitPrice.Value > 0)
            {
                var minAllowedPrice = dbPrice * (1 - discountRate / 100);
                if (l.UnitPrice.Value < minAllowedPrice)
                {
                    return BadRequest(new { success = false, message = $"{p.StockCode} kodlu ürün için belirlediğiniz birim fiyat ({l.UnitPrice.Value:N2} TL), seçili plasiyerin indirim yetkisi (%{discountRate}) ile belirlenen minimum fiyattan ({minAllowedPrice:N2} TL) düşük olamaz." });
                }
            }
        }

        if (isMuhtelif)
        {
            offer.CustomerCode = null;

            if (offer.BayiMuhtelifCustomerId is null)
            {
                if (request.Muhtelif is null)
                {
                    return BadRequest(new { success = false, message = "Muhtelif bilgileri zorunludur" });
                }

                var muhtelifEntity = new BayiMuhtelifCustomer
                {
                    OwnerCustomerCode = ResolveOwnerCustomerCode(),
                    CustomerCode = (await ReserveNextBayiMuhtelifCustomerCode(cancellationToken)).Trim(),
                    Name = request.Muhtelif!.Name.Trim(),
                    City = request.Muhtelif!.City?.Trim(),
                    District = request.Muhtelif!.District?.Trim(),
                    Address = request.Muhtelif!.Address?.Trim(),
                    Phone = request.Muhtelif!.Phone?.Trim(),
                    Email = request.Muhtelif!.Email?.Trim(),
                    TaxOffice = request.Muhtelif!.TaxOffice?.Trim(),
                    TaxNumber = request.Muhtelif!.TaxNumber?.Trim(),
                    CreateUser = username,
                    CreateTime = now
                };

                _dbContext.BayiMuhtelifCustomers.Add(muhtelifEntity);
                await _dbContext.SaveChangesAsync(cancellationToken);
                offer.BayiMuhtelifCustomerId = muhtelifEntity.Id;
            }
        }
        else
        {
            offer.BayiMuhtelifCustomerId = null;
            offer.CustomerCode = customerCode;
        }

        bool isAcikCariUpdate = false;
        if (!isMuhtelif && !string.IsNullOrWhiteSpace(customerCode))
        {
            var cust = await _dbContext.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.CustomerCode == customerCode, cancellationToken);
            if (cust != null)
            {
                var invType = (cust.InvoiceType ?? string.Empty).Trim().ToUpperInvariant();
                if (invType == "ACIK" || invType == "AÇIK")
                {
                    isAcikCariUpdate = true;
                }
                else if (cust.PriceGroupId.HasValue)
                {
                    var pg = await _dbContext.PriceGroups.AsNoTracking().FirstOrDefaultAsync(p => p.Id == cust.PriceGroupId.Value, cancellationToken);
                    if (pg != null && (pg.Code == 4 || pg.Code == 5 || pg.Code == 6))
                    {
                        isAcikCariUpdate = true;
                    }
                }
            }
        }

        offer.VatExempt = isAcikCariUpdate || request.VatExempt;
        offer.DeliveryCustomerCode = string.IsNullOrWhiteSpace(request.DeliveryCustomerCode) ? null : request.DeliveryCustomerCode.Trim();

        var requestDate = request.Date ?? offer.Date;
        offer.Date = DateTime.SpecifyKind(requestDate.Date, DateTimeKind.Utc);

        offer.SalesmanCode = string.IsNullOrWhiteSpace(request.SalesmanCode) ? null : request.SalesmanCode.Trim();
        offer.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        offer.EditUser = username;
        offer.EditTime = now;

        foreach (var existing in offer.Lines.ToList())
        {
            _dbContext.CariOfferLines.Remove(existing);
        }

        var newLines = request.Lines.Select((l, idx) =>
        {
            var p = productById[l.ProductId];
            var resolved = priceByProductId[l.ProductId];
            var finalUnitPrice = resolved.Price;

            if (l.UnitPrice.HasValue && l.UnitPrice.Value > 0)
            {
                if (canOverridePrice)
                {
                    finalUnitPrice = l.UnitPrice.Value;
                }
            }

            return new CariOfferLine
            {
                ProductId = l.ProductId,
                StockCode = p.StockCode,
                Quantity = l.Quantity,
                UnitPrice = finalUnitPrice,
                CurrencyTypeId = resolved.CurrencyTypeId,
                VatRate = (isAcikCariUpdate || offer.VatExempt) ? 0m : p.TaxRate,
                DiscountType = isAcikCariUpdate ? CustomerOfferLineDiscountType.None : l.DiscountType,
                DiscountValue = isAcikCariUpdate ? 0m : l.DiscountValue,
                LineNo = idx + 1,
                CreateUser = username,
                CreateTime = now
            };
        }).ToList();

        foreach (var l in newLines)
        {
            offer.Lines.Add(l);
        }

        await ApplyOfferCurrencyAsync(offer, cancellationToken, request.CurrencyTypeId);

        ComputeTotals(offer);

        var floorError = await ValidatePriceFloorAsync(offer, cancellationToken);
        if (floorError is not null)
        {
            return BadRequest(new { success = false, message = floorError });
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/transfer-to-proforma")]
    [AuthorizePage("invoice", "cariTeklifleri")]
    public async Task<IActionResult> TransferToProforma([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var offer = await _dbContext.CariOffers
            .Include(x => x.BayiMuhtelifCustomer)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (offer is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        if (!string.IsNullOrWhiteSpace(offer.ProformaDocumentNo))
        {
            return Ok(new { success = true, data = new { proformaDocumentNo = offer.ProformaDocumentNo } });
        }

        var isSuperAdmin = GetRequesterIsSuperAdmin();
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var requester = GetRequesterUsername();
        if (!isSuperAdmin && !isSsa && !string.Equals(offer.CreateUser, requester, StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest(new { success = false, message = "Bu cari müşteri teklifini sadece oluşturan cari proformaya aktarabilir." });
        }

        // Cari teklif proformaya aktarıldığında normal cari kartı (120-01) oluşturulmaz,
        // sadece proforma numarası atanır ve teklif kendi muhtelif kaydında kalır.
        var proformaNo = await GenerateNextProformaNo(cancellationToken);

        offer.ProformaDocumentNo = proformaNo;
        offer.EditUser = GetRequesterUsername();
        offer.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        await _userActivityLogger.LogAsync(
            "invoice",
            "bayiTeklifleri",
            "Aktarma",
            $"Cari müşteri teklifi (No: {offer.DocumentNo}) proforma faturaya aktarıldı (Proforma No: {proformaNo}).",
            offer.Id.ToString(),
            new { offerId = offer.Id, proformaNo = proformaNo },
            cancellationToken);

        return Ok(new { success = true, data = new { proformaDocumentNo = proformaNo } });
    }

    [HttpDelete("{id:int}/proforma")]
    [AuthorizePage("invoice", "bayiTeklifleri")]
    public async Task<IActionResult> DeleteProforma([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var offer = await _dbContext.CariOffers
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (offer is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        if (offer.InvoiceId.HasValue)
        {
            return BadRequest(new { success = false, message = "Bu proforma faturaya aktarıldığı için silinemez." });
        }

        if (!await this.CanDeleteRecordAsync(_dbContext, offer, cancellationToken))
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
                .AnyAsync(rpp => rpp.RoleId == roleId && rpp.CanAccess && rpp.Page.ModuleKey == "deleteRule" && rpp.Page.Key == "deleteRule/proforma", cancellationToken);
            if (hasRestriction && DateTime.UtcNow - offer.CreateTime > TimeSpan.FromDays(1))
            {
                return BadRequest(new { success = false, message = "Bu kayıt silinemez" });
            }
        }

        if (!string.IsNullOrEmpty(offer.ProformaDocumentNo))
        {
            var proformaBackup = new
            {
                cariOfferId = offer.Id,
                documentNo = offer.DocumentNo,
                proformaDocumentNo = offer.ProformaDocumentNo,
                customerCode = offer.CustomerCode,
                grandTotal = offer.GrandTotal,
                invoiceId = offer.InvoiceId,
                invoiceNo = offer.InvoiceNo,
                date = offer.Date
            };

            var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
            if (string.IsNullOrWhiteSpace(username)) username = "System";

            _dbContext.Set<DeletionLog>().Add(new DeletionLog
            {
                ModuleKey = "invoice",
                PageKey = "bayiTeklifleri",
                RecordType = "CariProforma",
                RecordId = offer.Id.ToString(),
                ParentType = null,
                ParentId = null,
                Description = $"Cari proforma silindi (teklife dönüştürüldü): {offer.ProformaDocumentNo}",
                DetailsJson = JsonSerializer.Serialize(proformaBackup),
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            });
        }

        offer.ProformaDocumentNo = null;
        offer.InvoiceId = null;
        offer.InvoiceNo = null;
        offer.EditUser = GetRequesterUsername();
        offer.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(new { success = true });
    }

    [HttpGet("proformas")]
    [AuthorizePage("invoice", "bayiTeklifleri")]
    public async Task<IActionResult> ListProformas([FromQuery] int take = 200, [FromQuery] int skip = 0, CancellationToken cancellationToken = default)
    {
        take = Math.Clamp(take, 1, 500);
        // Sayfalı okuma (2026-10-08): ekran 'son N' yerine skip ile hepsini çekiyor; eski kayıtlar
        // aramada/süzgeçte görünmüyordu (alış faturalarında 25.08 faturası bulunamadı).
        skip = Math.Max(0, skip);

        var isBayi = GetRequesterIsBayi();
        var isSuperAdmin = GetRequesterIsSuperAdmin();
        var username = GetRequesterUsername();

        var bayiRoleIds = await _dbContext.Roles
            .AsNoTracking()
            .Where(r => r.Code != null && (r.Code.ToLower() == "bayi" || r.Code.ToLower() == "altbayi"))
            .Select(r => r.Id)
            .ToListAsync(cancellationToken);

        // "Hepsini gor" ROL ADINA GOMULU DEGIL, sayfa yetkisi (bkz. CariOffersSeeAllPageKey):
        // Yonetim/SuperAdmin/SSA'yi koda yazmak, yeni bir rol eklendiginde her seferinde kod
        // degisikligi gerektiriyordu.
        var seesAllOffers = await HasPagePermissionAsync("invoice", CariOffersSeeAllPageKey, cancellationToken);

        // Kapsam KULLANICI degil CARI eksenli: ayni bayide calisan iki kisi birbirinin
        // tekliflerini gorebilmeli (kullanici karari, 2026-08-11). Eskiden CreateUser eslesmesi
        // araniyordu ve bayideki ikinci personel hicbir teklifi goremiyordu.
        var allowed = seesAllOffers
            ? new List<string>()
            : await ResolveAllowedCustomerCodesForRequester(includeInactive: true, cancellationToken);

        var baseQuery =
            from offer in _dbContext.CariOffers.AsNoTracking()
            join u in _dbContext.Users.AsNoTracking() on offer.CreateUser equals u.Username into uj
            from u in uj.DefaultIfEmpty()
            join c in _dbContext.Customers.AsNoTracking() on offer.CustomerCode equals c.CustomerCode into cj
            from c in cj.DefaultIfEmpty()
            join pg in _dbContext.PriceGroups.AsNoTracking() on c.PriceGroupId equals pg.Id into pgj
            from pg in pgj.DefaultIfEmpty()
            where offer.ProformaDocumentNo != null
            select new { offer, u, c, pg };

        var filteredQuery = baseQuery;

        // Teklif listesiyle AYNI kural (bkz. List): "hepsini gör" yetkisi yoksa yalnızca kendi
        // carine ait proformalar. İkisi ayrışırsa bir teklif proformaya aktarıldıktan sonra
        // sahibinin gözünden kaybolabilir.
        if (!seesAllOffers)
        {
            filteredQuery = filteredQuery.Where(x =>
                (x.offer.CreateUser != null && EF.Functions.ILike(x.offer.CreateUser, username))
                || (x.offer.CustomerCode != null && allowed.Contains(x.offer.CustomerCode!))
                || (x.offer.BayiMuhtelifCustomer != null
                    && x.offer.BayiMuhtelifCustomer.OwnerCustomerCode != null
                    && allowed.Contains(x.offer.BayiMuhtelifCustomer.OwnerCustomerCode!))
            );
        }

        var data = await filteredQuery
            .OrderByDescending(x => x.offer.Id)
            .Skip(skip).Take(take)
            .Select(x => new
            {
                id = x.offer.Id,
                date = x.offer.Date,
                documentNo = x.offer.ProformaDocumentNo,
                customerCode = x.offer.CustomerCode ?? (x.offer.BayiMuhtelifCustomer != null ? x.offer.BayiMuhtelifCustomer.CustomerCode : null),
                customerName = x.c != null ? x.c.Name : (x.offer.BayiMuhtelifCustomer != null ? x.offer.BayiMuhtelifCustomer.Name : null),
                targetAccountType = (x.c != null && ((x.c.InvoiceType ?? "").ToUpper() == "ASKERIYE" || (x.c.InvoiceType ?? "").ToUpper() == "ASKERİYE" || (x.pg != null && x.pg.Code == 7)))
                    ? "ASKERIYE"
                    : (x.c != null && ((x.c.InvoiceType ?? "").ToUpper() == "ACIK" || (x.c.InvoiceType ?? "").ToUpper() == "AÇIK" || (x.pg != null && x.pg.Code >= 4 && x.pg.Code <= 6)))
                        ? "ACIK"
                        : "FATURA",
                customerInvoiceType = x.c != null ? x.c.InvoiceType : null,
                priceGroupCode = x.pg != null ? (int?)x.pg.Code : (int?)null,
                description = x.offer.Description,
                vatExempt = x.offer.VatExempt,
                subtotal = x.offer.Subtotal,
                discountTotal = x.offer.DiscountTotal,
                netTotal = x.offer.NetTotal,
                vatTotal = x.offer.VatTotal,
                grandTotal = x.offer.GrandTotal,
                // Teklifin KENDİ para birimi (2026-08-17): carinin kartı okunmuyor.
                currencyTypeId = x.offer.CurrencyTypeId,
                createUser = x.offer.CreateUser,
                invoiceId = x.offer.InvoiceId,
                invoiceNo = x.offer.InvoiceNo,
                lines = x.offer.Lines
                    .OrderBy(l => l.LineNo)
                    .Select(l => new
                    {
                        id = l.Id,
                        productId = l.ProductId,
                        stockCode = l.StockCode,
                        stockName = l.Product != null ? l.Product.Name : string.Empty,
                        // Proforma basımı en solda barkodu yazıyor; ürün adına bakıp ayrıca
                        // sorgu atmamak için kalemle birlikte geliyor.
                        barcode = l.Product != null ? l.Product.Barcode : null,
                        description = l.Description,
                        quantity = l.Quantity,
                        unitPrice = l.UnitPrice,
                        vatRate = l.VatRate,
                        discountType = l.DiscountType,
                        discountValue = l.DiscountValue,
                        lineNo = l.LineNo,
                        // SATIŞ dövizinin çapası `Product.SalesCurrencyCode`; fiyat satırından
                        // filtresiz `FirstOrDefault()` rastgele bir fiyat grubunun para
                        // birimini getiriyordu (fiyat satırı yoksa da ALIŞ dövizine düşüyordu).
                        currencyCode = l.Product != null ? l.Product.SalesCurrencyCode : 0
                    })
                    .ToList()
            })
            .ToListAsync(cancellationToken);

        var customerCodes = data
            .Where(x => !string.IsNullOrWhiteSpace(x.customerCode) && x.customerCode != "MUHTELIF")
            .Select(x => x.customerCode!)
            .Distinct()
            .ToList();

        var customerNameByCode = customerCodes.Count == 0
            ? new Dictionary<string, string>()
            : await _dbContext.Customers
                .AsNoTracking()
                .Where(x => customerCodes.Contains(x.CustomerCode))
                .Select(x => new { x.CustomerCode, x.Name })
                .ToDictionaryAsync(x => x.CustomerCode, x => x.Name, cancellationToken);

        var normalized = data.Select(x => new
        {
            x.id,
            x.date,
            x.documentNo,
            x.customerCode,
            customerName = !string.IsNullOrWhiteSpace(x.customerName) ? x.customerName : (x.customerCode != null && customerNameByCode.TryGetValue(x.customerCode, out var n) ? n : null),
            /*
              BU UC ALAN ELENİYORDU — VARSAYILAN HESABIN HEP "-1" GELMESİNİN SEBEBİ
              (2026-08-29 kullanıcı bildirimi: "otomatik seçili olarak -1 cari hesabı
              geliyor, carinin anlık fiyat grubu ne ise o seçili gelecek").

              Yukarıdaki sorgu `targetAccountType`'ı carinin fiyat grubundan DOĞRU
              hesaplıyordu (grup 7 → ASKERIYE, 4-6 → ACIK, 1-3 → FATURA). Ama yanıt
              hemen ardından burada alan alan yeniden kuruluyor ve bu üçü listeye
              yazılmamıştı; hesaplanan değer tarayıcıya hiç ulaşmıyordu.

              Frontend alanı boş görünce cari kodunun sonekine bakıyor; ana cari kodunda
              (-1/-2/-3 olmayan) sonek olmadığı için son çare "FATURA"ya düşüyordu. Yani
              askeri cari bile "Resmi Fatura (-1)" seçili açılıyordu.

              Canlı veriyle doğrulandı: P00000000000041 / 120-01-000592 için sorgu
              "ASKERIYE" üretiyor, ekranda "-1" görünüyordu.
            */
            x.targetAccountType,
            x.customerInvoiceType,
            x.priceGroupCode,
            x.description,
            x.vatExempt,
            x.subtotal,
            x.discountTotal,
            x.netTotal,
            x.vatTotal,
            x.grandTotal,
            x.createUser,
            x.invoiceId,
            x.invoiceNo,
            x.currencyTypeId,
            x.lines
        });

        return Ok(new { success = true, data = normalized });
    }

    [HttpPut("{id:int}/proforma-header")]
    [AuthorizePage("invoice", "bayiTeklifleri")]
    public async Task<IActionResult> UpdateProformaHeader([FromRoute] int id, [FromBody] UpdateCariProformaHeaderRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var offer = await _dbContext.CariOffers
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (offer is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        if (offer.InvoiceId.HasValue)
        {
            return BadRequest(new { success = false, message = "Bu proforma faturaya aktarıldığı için güncellenemez." });
        }

        if (string.IsNullOrWhiteSpace(offer.ProformaDocumentNo))
        {
            return BadRequest(new { success = false, message = "Proforma belge no bulunamadı" });
        }

        var newProformaNo = request.ProformaDocumentNo is null ? null : request.ProformaDocumentNo.Trim();
        var newCustomerCode = request.CustomerCode is null ? null : request.CustomerCode.Trim();

        if (newProformaNo is not null && string.IsNullOrWhiteSpace(newProformaNo)) newProformaNo = null;
        if (newCustomerCode is not null && string.IsNullOrWhiteSpace(newCustomerCode)) newCustomerCode = null;

        if (newCustomerCode is not null)
        {
            var exists = await _dbContext.Customers
                .AsNoTracking()
                .AnyAsync(x => x.CustomerCode == newCustomerCode, cancellationToken);

            if (!exists)
            {
                return BadRequest(new { success = false, message = "Geçersiz cari" });
            }
        }

        if (newProformaNo is not null)
        {
            var exists = await _dbContext.CariOffers
                .AsNoTracking()
                .AnyAsync(x => x.ProformaDocumentNo == newProformaNo && x.Id != offer.Id, cancellationToken);

            if (exists)
            {
                return Conflict(new { success = false, message = "Belge no zaten mevcut" });
            }
        }

        var shouldUpdateProformaNo = newProformaNo is not null && !string.Equals(offer.ProformaDocumentNo, newProformaNo, StringComparison.Ordinal);
        var shouldUpdateCustomerCode = newCustomerCode is not null && !string.Equals(offer.CustomerCode ?? string.Empty, newCustomerCode, StringComparison.Ordinal);

        if (shouldUpdateProformaNo)
        {
            offer.ProformaDocumentNo = newProformaNo!;
        }

        if (shouldUpdateCustomerCode)
        {
            offer.CustomerCode = newCustomerCode;
            offer.BayiMuhtelifCustomerId = null;
        }

        offer.EditUser = GetRequesterUsername();
        offer.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/transfer-to-invoice")]
    [AuthorizePage("invoice", "bayiTeklifleri")]
    public async Task<IActionResult> TransferToInvoice([FromRoute] int id, [FromBody] B2B.Erp.Api.Dtos.CustomerOffers.TransferCustomerOfferToInvoiceRequest request, CancellationToken cancellationToken)
    {
        return BadRequest(new { success = false, message = "Cari proforma fatura döküme aktarılamaz." });
    }

    [AtomicRequest]
    [HttpDelete("{id:int}")]
    [AuthorizePage("invoice", "cariTeklifleri")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0)
        {
            return BadRequest(new { success = false, message = "Geçersiz id" });
        }

        var offer = await _dbContext.CariOffers
            .Include(x => x.Lines)
            .Include(x => x.BayiMuhtelifCustomer)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (offer is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        if (offer.InvoiceId.HasValue)
        {
            return BadRequest(new { success = false, message = "Bu teklife ait proforma faturaya aktarıldığı için silinemez." });
        }

        if (!await this.CanDeleteRecordAsync(_dbContext, offer, cancellationToken))
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
                .AnyAsync(rpp => rpp.RoleId == roleId && rpp.CanAccess && rpp.Page.ModuleKey == "deleteRule" && rpp.Page.Key == "deleteRule/musteriTeklifi", cancellationToken);
            if (hasRestriction && DateTime.UtcNow - offer.CreateTime > TimeSpan.FromDays(1))
            {
                return BadRequest(new { success = false, message = "Bu kayıt silinemez" });
            }
        }

        var backupData = new
        {
            offer.DocumentNo,
            offer.ProformaDocumentNo,
            offer.Date,
            offer.CustomerCode,
            offer.DeliveryCustomerCode,
            offer.VatExempt,
            offer.Subtotal,
            offer.DiscountTotal,
            offer.NetTotal,
            offer.VatTotal,
            offer.GrandTotal,
            offer.InvoiceId,
            offer.InvoiceNo,
            offer.SalesmanCode,
            offer.Description,
            offer.CreateUser,
            offer.CreateTime,
            BayiMuhtelifCustomer = offer.BayiMuhtelifCustomer != null ? new
            {
                offer.BayiMuhtelifCustomer.OwnerCustomerCode,
                offer.BayiMuhtelifCustomer.CustomerCode,
                offer.BayiMuhtelifCustomer.Name,
                offer.BayiMuhtelifCustomer.City,
                offer.BayiMuhtelifCustomer.District,
                offer.BayiMuhtelifCustomer.Address,
                offer.BayiMuhtelifCustomer.Phone,
                offer.BayiMuhtelifCustomer.Email,
                offer.BayiMuhtelifCustomer.TaxOffice,
                offer.BayiMuhtelifCustomer.TaxNumber,
                offer.BayiMuhtelifCustomer.CreateUser,
                offer.BayiMuhtelifCustomer.CreateTime
            } : null,
            Lines = offer.Lines.Select(l => new
            {
                l.ProductId,
                l.StockCode,
                l.Description,
                l.Quantity,
                l.UnitPrice,
                l.VatRate,
                l.DiscountType,
                l.DiscountValue,
                l.LineNo,
                l.CreateUser,
                l.CreateTime
            }).ToList()
        };

        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        _dbContext.Set<DeletionLog>().Add(new DeletionLog
        {
            ModuleKey = "invoice",
            PageKey = "cariTeklifleri",
            RecordType = "CariOffer",
            RecordId = offer.Id.ToString(),
            ParentType = null,
            ParentId = null,
            Description = $"Cari teklif silindi: {offer.DocumentNo}. [Etki: Cari teklif silindi.]",
            DetailsJson = JsonSerializer.Serialize(backupData),
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        });

        var muhtelifId = offer.BayiMuhtelifCustomerId;

        _dbContext.CariOffers.Remove(offer);
        await _dbContext.SaveChangesAsync(cancellationToken);

        if (muhtelifId.HasValue)
        {
            var muhtelif = await _dbContext.BayiMuhtelifCustomers
                .FirstOrDefaultAsync(x => x.Id == muhtelifId.Value, cancellationToken);

            if (muhtelif is not null)
            {
                _dbContext.BayiMuhtelifCustomers.Remove(muhtelif);
                await _dbContext.SaveChangesAsync(cancellationToken);
            }
        }

        return Ok(new { success = true });
    }

    private async Task<BayiMuhtelifCustomer?> ResolveScopedBayiMuhtelifCustomerByCode(string code, CancellationToken cancellationToken)
    {
        var customerCode = string.IsNullOrWhiteSpace(code) ? null : code.Trim();
        if (string.IsNullOrWhiteSpace(customerCode)) return null;

        if (GetRequesterIsSuperAdmin())
        {
            return await _dbContext.BayiMuhtelifCustomers
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);
        }

        var allowed = await ResolveAllowedCustomerCodesForRequester(includeInactive: true, cancellationToken);
        if (allowed.Count == 0) return null;

        return await _dbContext.BayiMuhtelifCustomers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode && x.OwnerCustomerCode != null && allowed.Contains(x.OwnerCustomerCode), cancellationToken);
    }

    /// <summary>
    /// İndirimin altına inemeyeceği taban fiyat grubunun kodu: 3 (TOPTAN F).
    /// </summary>
    private const int CariOfferFloorPriceGroupCode = 3;

    /// <summary>
    /// Cari müşteri teklifinde indirim SERBEST ama satırın birim fiyatı 3 numaralı fiyat
    /// grubunun (TOPTAN F) altına inemez (kullanıcı kararı, 2026-08-11). Yukarı serbest.
    ///
    /// Kontrol SUNUCUDA da yapılmak zorunda: ekranda engellemek yalnızca kazayla yapılanı
    /// önler, isteği elle kuran birini durdurmaz — bu bir fiyat politikası sınırı.
    ///
    /// Karşılaştırma SATIRIN NET BİRİM FİYATI üzerinden: indirim tipi "tutar" olduğunda
    /// indirim satırın tamamından düşülüyor (bkz. <see cref="ComputeTotals"/>), dolayısıyla
    /// birim başına etkisi ancak adede bölünce görülür. Yalnızca birim fiyata bakmak, adet
    /// üzerinden verilen büyük bir tutar indirimini gözden kaçırırdı.
    /// </summary>
    private async Task<string?> ValidatePriceFloorAsync(CariOffer offer, CancellationToken cancellationToken)
    {
        var lines = offer.Lines?.Where(l => l.Quantity > 0).ToList() ?? new List<CariOfferLine>();
        if (lines.Count == 0) return null;

        // SINIRSIZ İNDİRİM yetkisi tabanı tamamen kaldırır (bkz. UnlimitedDiscountPageKey).
        // Kontrol burada, TEK yerde: iki çağıran var (Create ve Update) ve yetkiyi ikisine
        // ayrı ayrı yazmak, birine eklenip diğerine unutulduğunda yarım çalışan bir kural
        // bırakırdı.
        if (await HasPagePermissionAsync("invoice", UnlimitedDiscountPageKey, cancellationToken))
        {
            return null;
        }

        var floorGroupId = await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(x => x.IsActive && x.Code == CariOfferFloorPriceGroupCode)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);

        // Taban grubu tanımlı değilse kural uygulanamaz; teklifi engellemek yerine geçiriyoruz —
        // aksi halde fiyat grubu silinen bir firmada hiç teklif kesilemezdi.
        if (!floorGroupId.HasValue) return null;

        var productIds = lines.Select(l => l.ProductId).Distinct().ToList();
        var floorByProduct = await ResolveUnitPrices(productIds, null, floorGroupId, cancellationToken);

        foreach (var l in lines)
        {
            if (!floorByProduct.TryGetValue(l.ProductId, out var floorEntry) || floorEntry.Price <= 0m) continue;
            var floor = floorEntry.Price;

            var lineBase = l.Quantity * l.UnitPrice;
            var discount = l.DiscountType switch
            {
                // TUTAR İNDİRİMİ ADET BAŞINADIR (2026-08-22 kullanıcı kuralı).
                // Değer satırın tamamına uygulanıyordu: 15 adetlik satıra girilen 750 toplamda
                // yalnız 750 düşürüyordu. Ekranda indirim kutusu TEK ürünün fiyatıyla sınırlı
                // olduğu için alan zaten adet başına tasarlanmıştı; hesap onunla çelişiyordu.
                CustomerOfferLineDiscountType.Amount => Math.Max(0m, l.DiscountValue) * l.Quantity,
                CustomerOfferLineDiscountType.Percentage => Math.Max(0m, lineBase * (l.DiscountValue / 100m)),
                _ => 0m
            };
            if (discount > lineBase) discount = lineBase;

            var netUnit = (lineBase - discount) / l.Quantity;

            // Kuruş yuvarlamasından doğan bir tık sapma kuralı ihlal saymasın.
            if (netUnit < floor - 0.01m)
            {
                var name = await _dbContext.Products.AsNoTracking()
                    .Where(p => p.Id == l.ProductId)
                    .Select(p => p.Name)
                    .FirstOrDefaultAsync(cancellationToken) ?? "Ürün";

                return $"'{name}' için birim fiyat {netUnit:N2}, izin verilen en düşük fiyatın ({floor:N2}) altında. " +
                       "İndirimi azaltın.";
            }
        }

        return null;
    }

    private void ComputeTotals(CariOffer offer)
    {
        var subtotal = 0m;
        var discountTotal = 0m;
        var netTotal = 0m;
        var vatTotal = 0m;
        var grandTotal = 0m;

        foreach (var l in offer.Lines)
        {
            var lineBase = l.Quantity * l.UnitPrice;
            var discount = l.DiscountType switch
            {
                // TUTAR İNDİRİMİ ADET BAŞINADIR (2026-08-22 kullanıcı kuralı).
                // Değer satırın tamamına uygulanıyordu: 15 adetlik satıra girilen 750 toplamda
                // yalnız 750 düşürüyordu. Ekranda indirim kutusu TEK ürünün fiyatıyla sınırlı
                // olduğu için alan zaten adet başına tasarlanmıştı; hesap onunla çelişiyordu.
                CustomerOfferLineDiscountType.Amount => Math.Max(0m, l.DiscountValue) * l.Quantity,
                CustomerOfferLineDiscountType.Percentage => Math.Max(0m, lineBase * (l.DiscountValue / 100m)),
                _ => 0m
            };

            if (discount > lineBase) discount = lineBase;

            var lineNet = lineBase - discount;
            var vat = (offer.VatExempt || l.VatRate == 0m) ? 0m : (lineNet * (l.VatRate / 100m));
            var lineTotal = lineNet + vat;

            subtotal += lineBase;
            discountTotal += discount;
            netTotal += lineNet;
            vatTotal += vat;
            grandTotal += lineTotal;
        }

        offer.Subtotal = subtotal;
        offer.DiscountTotal = discountTotal;
        offer.NetTotal = netTotal;
        offer.VatTotal = vatTotal;
        offer.GrandTotal = grandTotal;
    }

    private async Task<string> GenerateUniqueDocumentNo(CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 30; attempt++)
        {
            var candidate = GenerateNumericString15();
            var exists = await _dbContext.CariOffers
                .AsNoTracking()
                .AnyAsync(x => x.DocumentNo == candidate, cancellationToken);

            if (!exists)
            {
                return candidate;
            }
        }

        var fallback = DateTime.UtcNow.Ticks.ToString().PadLeft(15, '0');
        if (fallback.Length > 15) fallback = fallback[^15..];
        return fallback;
    }

    private static string GenerateNumericString15()
    {
        Span<char> chars = stackalloc char[15];
        for (var i = 0; i < chars.Length; i++)
        {
            var digit = RandomNumberGenerator.GetInt32(0, 10);
            chars[i] = (char)('0' + digit);
        }

        if (chars[0] == '0') chars[0] = '1';
        return new string(chars);
    }

    private async Task<(Guid? PriceGroupId, string? ResolvedCustomerCode)> ResolvePriceGroup(string? customerCode, CancellationToken cancellationToken)
    {
        var pg4 = await _dbContext.PriceGroups
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Code == 4 && x.IsActive, cancellationToken);
        if (pg4 is not null)
        {
            return (pg4.Id, customerCode);
        }

        var defaultPriceGroupId = await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.Code)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);

        return (defaultPriceGroupId, customerCode);
    }

    /// <summary>
    /// Muhtelif (kayıtlı carisi olmayan) müşteriye kesilen teklifin fiyat grubu.
    /// Kullanıcı kararı (2026-08-11): 4 numaralı grup değil, <b>1 numaralı grup</b>.
    /// </summary>
    private async Task<Guid?> ResolveMuhtelifPriceGroup(CancellationToken cancellationToken)
    {
        var pg1 = await _dbContext.PriceGroups
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Code == MuhtelifPriceGroupCode && x.IsActive, cancellationToken);
        if (pg1 is not null)
        {
            return pg1.Id;
        }

        var fallback = await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.Code)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);

        return fallback;
    }

    /// <summary>
    /// Fiyatla birlikte fiyatın PARA BİRİMİNİ de döndürür (2026-08-17).
    /// Kardeşi `CustomerOffersController.ResolveUnitPrices` ile aynı kural: fiyat hangi
    /// paradaysa teklif de o paradadır, carinin kartına bakılmaz.
    /// </summary>
    private async Task<Dictionary<Guid, (decimal Price, int CurrencyTypeId)>> ResolveUnitPrices(
        List<Guid> productIds,
        string? customerCode,
        Guid? priceGroupId,
        CancellationToken cancellationToken)
    {
        Dictionary<Guid, (decimal Price, string Currency)>? overrideByProduct = null;

        if (!string.IsNullOrWhiteSpace(customerCode) && priceGroupId.HasValue)
        {
            // Şubede özel fiyat BAĞLI CARİDEN okunur; bkz. CustomerPriceOwner.
            var overrideCustomerCode = await Core.Helpers.CustomerPriceOwner.ResolveAsync(
                _dbContext, customerCode, cancellationToken);

            var overrides = await _dbContext.CustomerProductPriceOverrides
                .AsNoTracking()
                .Where(x => x.IsActive)
                .Where(x => x.CustomerCode == overrideCustomerCode)
                .Where(x => productIds.Contains(x.ProductId))
                .Where(x => x.PriceGroupId == priceGroupId.Value)
                .Select(x => new { x.ProductId, x.Price, x.Currency })
                .ToListAsync(cancellationToken);

            overrideByProduct = overrides
                .GroupBy(x => x.ProductId)
                .ToDictionary(g => g.Key, g => (g.First().Price, g.First().Currency));
        }

        var allPrices = await _dbContext.ProductPrices
            .AsNoTracking()
            .Where(pp => productIds.Contains(pp.ProductId))
            .Select(pp => new { pp.ProductId, pp.PriceGroupId, pp.Price, pp.Currency })
            .ToListAsync(cancellationToken);

        var priceGroups = await _dbContext.PriceGroups.AsNoTracking().ToListAsync(cancellationToken);
        var pgByGuid = priceGroups.ToDictionary(x => x.Id, x => x);
        var pgByCode = priceGroups.ToDictionary(x => x.Code, x => x);

        Guid? mappedPgId = null;
        if (priceGroupId.HasValue && pgByGuid.TryGetValue(priceGroupId.Value, out var currentPg))
        {
            int mappedCode = currentPg.Code switch { 4 => 1, 5 => 2, 6 => 3, 7 => 3, _ => currentPg.Code };
            if (pgByCode.TryGetValue(mappedCode, out var mappedPg))
            {
                mappedPgId = mappedPg.Id;
            }
        }

        Guid? defaultPgId = pgByCode.TryGetValue(1, out var p1) ? p1.Id : (priceGroups.OrderBy(x => x.Code).FirstOrDefault()?.Id);

        var fallbackList = await _dbContext.Products
            .AsNoTracking()
            .Where(p => productIds.Contains(p.Id))
            .Select(p => new { p.Id, p.PurchasePrice })
            .ToListAsync(cancellationToken);

        var fallbackProductPrices = fallbackList.ToDictionary(p => p.Id, p => p.PurchasePrice);

        var outMap = new Dictionary<Guid, (decimal Price, int CurrencyTypeId)>();
        foreach (var pid in productIds)
        {
            if (overrideByProduct is not null && overrideByProduct.TryGetValue(pid, out var ov))
            {
                outMap[pid] = (ov.Price, MapSalesCurrency(ov.Currency));
                continue;
            }

            var prodPrices = allPrices.Where(x => x.ProductId == pid).ToList();

            if (priceGroupId.HasValue)
            {
                var exact = prodPrices.FirstOrDefault(x => x.PriceGroupId == priceGroupId.Value);
                if (exact is not null)
                {
                    outMap[pid] = (exact.Price, MapSalesCurrency(exact.Currency));
                    continue;
                }
            }

            if (mappedPgId.HasValue)
            {
                var mapped = prodPrices.FirstOrDefault(x => x.PriceGroupId == mappedPgId.Value);
                if (mapped is not null)
                {
                    outMap[pid] = (mapped.Price, MapSalesCurrency(mapped.Currency));
                    continue;
                }
            }

            if (defaultPgId.HasValue)
            {
                var def = prodPrices.FirstOrDefault(x => x.PriceGroupId == defaultPgId.Value);
                if (def is not null)
                {
                    outMap[pid] = (def.Price, MapSalesCurrency(def.Currency));
                    continue;
                }
            }

            var anyPrice = prodPrices.OrderBy(x => x.Price).FirstOrDefault();
            if (anyPrice is not null)
            {
                outMap[pid] = (anyPrice.Price, MapSalesCurrency(anyPrice.Currency));
                continue;
            }

            // Son çare: alış fiyatı. Para birimi bilinmediği için TL sayılır — eski davranış.
            if (fallbackProductPrices.TryGetValue(pid, out var basePrice))
            {
                outMap[pid] = (basePrice, B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try);
                continue;
            }

            outMap[pid] = (0m, B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try);
        }

        return outMap;
    }

    /// <summary>
    /// Teklifin para birimini KALEMLERİNDEN belirler, kuru o anda dondurur (2026-08-17).
    /// Kalemler karışıksa başlık TL kalır; satırlar kendi para birimini taşır.
    /// </summary>
    private async Task ApplyOfferCurrencyAsync(CariOffer offer, CancellationToken cancellationToken, int? requestedCurrencyTypeId = null)
    {
        int currencyTypeId;
        if (requestedCurrencyTypeId.HasValue && requestedCurrencyTypeId.Value > 0)
        {
            currencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(requestedCurrencyTypeId.Value);
            foreach (var l in offer.Lines)
            {
                l.CurrencyTypeId = currencyTypeId;
            }
        }
        else
        {
            var currencies = offer.Lines
                .Select(x => B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(x.CurrencyTypeId))
                .Distinct()
                .ToList();

            currencyTypeId = currencies.Count == 1
                ? currencies[0]
                : B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try;
        }

        offer.CurrencyTypeId = currencyTypeId;
        offer.ExchangeRate = 1m;

        if (B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.IsTry(currencyTypeId)) return;

        var code = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.ToCodeOrTry(currencyTypeId);
        try
        {
            var rate = await _money.GetLatestTryRateAsync(code, cancellationToken);
            offer.ExchangeRate = rate > 0m ? rate : 1m;
        }
        catch
        {
            offer.ExchangeRate = 1m;
        }
    }

    /// <summary>
    /// Fiyat listesindeki para birimi metnini tek kodlamaya çevirir (1=TRY 2=EUR 3=USD 4=GBP).
    /// </summary>
    private static int MapSalesCurrency(string? currency)
    {
        return B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyStringToCurrencyTypeId(currency);
    }

    private async Task<string> GenerateNextProformaNo(CancellationToken cancellationToken)
    {
        const string key = "CARI_PROFORMA";

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var series = await _dbContext.NumberSeries
            .FirstOrDefaultAsync(x => x.Key == key, cancellationToken);

        if (series is null)
        {
            var existing = await _dbContext.CariOffers
                .AsNoTracking()
                .Where(x => x.ProformaDocumentNo != null)
                .Select(x => x.ProformaDocumentNo!)
                .ToListAsync(cancellationToken);

            long max = 0;
            foreach (var s in existing)
            {
                if (string.IsNullOrWhiteSpace(s)) continue;
                if (s.Length != 15) continue;
                if (!s.StartsWith('P')) continue;
                var tail = s.Substring(1);
                if (long.TryParse(tail, out var n))
                {
                    if (n > max) max = n;
                }
            }

            series = new NumberSeries { Key = key, LastValue = max };
            _dbContext.NumberSeries.Add(series);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        while (true)
        {
            series.LastValue += 1;
            var candidate = "P" + series.LastValue.ToString().PadLeft(14, '0');

            var exists = await _dbContext.CariOffers
                .AsNoTracking()
                .AnyAsync(x => x.ProformaDocumentNo == candidate, cancellationToken);

            if (!exists)
            {
                await _dbContext.SaveChangesAsync(cancellationToken);
                await tx.CommitAsync(cancellationToken);
                return candidate;
            }
        }
    }
}
