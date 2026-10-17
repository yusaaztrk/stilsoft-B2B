using System.Security.Cryptography;
using B2B.Erp.Api.Core.Http;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Features.OfferPrint;
using B2B.Erp.Api.Dtos.CustomerOffers;
using B2B.Erp.Api.Entities;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using System.Text.Json;
using CreditLimitStatus = B2B.Erp.Api.Core.Services.CreditLimitStatus;

namespace B2B.Erp.Api.Controllers;

[ApiController]
[Route("api/customer-offers")]
[Authorize]
public sealed class CustomerOffersController : ControllerBase
{
    /// <summary>
    /// Muhtelif müşteriye kesilen teklifin fiyat grubu kodu. Kullanıcı kararı (2026-08-11):
    /// eskiden 4'tü, 1 oldu. Kardeşi <c>CariOffersController</c> ile AYNI kalmalı.
    /// </summary>
    internal const int MuhtelifPriceGroupCode = 1;

    /// <summary>
    /// Müşteri teklifinden doğan carinin AÇILIŞ kredi limiti, TL (2026-09-18 kullanıcı kararı:
    /// "müşteri teklifinden oluşan carilerin limiti 300 bin TL olsun").
    ///
    /// <para>
    /// Yalnız TL limitidir; dövizli limitler (<c>CreditLimitUsd/Eur/Gbp</c>) 0 kalır — bu
    /// sistemde her belge KENDİ para biriminin limitine yürür, TL limiti kura çevrilmez.
    /// Alt hesaplar (-1/-2/-3) limiti ana cariden miras alır
    /// (<c>CustomerAccountService.EnsureSubAccountsCreatedAsync</c>), ayrıca yazmak gerekmez.
    /// </para>
    ///
    /// <para>
    /// Açılış değeridir: cari kartından sonradan değiştirilebilir ve burası ona dokunmaz.
    /// </para>
    /// </summary>
    internal const decimal OfferCustomerCreditLimit = 300_000m;

    private readonly AppDbContext _dbContext;
    private readonly B2B.Erp.Api.Core.Interfaces.IMoneyServiceClient _money;
    private readonly B2B.Erp.Api.Core.Logging.IUserActivityLogger _userActivityLogger;
    private readonly B2B.Erp.Api.Core.Services.ICustomerAccountService _customerAccountService;
    private readonly B2B.Erp.Api.Core.Services.ICreditLimitService _creditLimitService;
    private readonly IWebHostEnvironment _env;

    public CustomerOffersController(
        AppDbContext dbContext,
        B2B.Erp.Api.Core.Interfaces.IMoneyServiceClient money,
        B2B.Erp.Api.Core.Logging.IUserActivityLogger userActivityLogger,
        B2B.Erp.Api.Core.Services.ICustomerAccountService customerAccountService,
        B2B.Erp.Api.Core.Services.ICreditLimitService creditLimitService,
        IWebHostEnvironment env)
    {
        _dbContext = dbContext;
        _money = money;
        _userActivityLogger = userActivityLogger;
        _customerAccountService = customerAccountService;
        _creditLimitService = creditLimitService;
        _env = env;
    }

    /// <summary>
    /// The offer as a PDF, in one of the two forms.
    ///
    /// 'ozellikli' prints a block per product with its picture and feature list; the default
    /// prints a plain row per product. Unlike the legacy output, the totals block and the
    /// standing notes appear only on the last page.
    /// </summary>
    [HttpGet("{offerId:int}/yazdir")]
    [AuthorizePage("invoice", "musteriTeklifi")]
    public async Task<IActionResult> PrintOffer(
        [FromRoute] int offerId,
        [FromQuery] string? form,
        CancellationToken cancellationToken)
    {
        // Uçta HİÇBİR kapı yoktu (`[Authorize]` yalnızca "giriş yapmış olmak" demek): oturumu
        // olan herkes id deneyerek başkasının teklifini PDF olarak indirebiliyordu. Kardeş uç
        // `CariOffersController.PrintOffer` sayfa yetkisini zaten istiyordu.
        var offerForAccess = await _dbContext.CustomerOffers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == offerId, cancellationToken);

        if (offerForAccess is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        var printAccessError = await BuildOfferAccessErrorAsync(offerForAccess, cancellationToken);
        if (printAccessError is not null) return printAccessError;

        var model = await new OfferPrintModelBuilder(_dbContext, _env).BuildAsync(offerId, cancellationToken);
        if (model is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        var kind = string.Equals(form, "ozellikli", StringComparison.OrdinalIgnoreCase)
            ? OfferFormKind.Featured
            : OfferFormKind.Plain;

        var pdf = new OfferFormRenderer().Render(model, kind);

        Response.Headers.ContentDisposition = $"inline; filename=teklif-{offerId}.pdf";
        return File(pdf, "application/pdf");
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

        var fromUser = await _dbContext.Users
            .AsNoTracking()
            .Where(x => x.Username == username)
            .Select(x => x.SalesmanCode)
            .FirstOrDefaultAsync(cancellationToken);

        return string.IsNullOrWhiteSpace(fromUser) ? null : fromUser.Trim();
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

    private string? GetRequesterCustomerCode()
    {
        var code = User.FindFirst("Carikodu")?.Value;
        return string.IsNullOrWhiteSpace(code) ? null : code.Trim();
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

    /// <summary>
    /// KİMLİKLE ÇAĞRILAN UÇLARIN KAPISI — liste süzgeci burada geçerli değildir.
    ///
    /// <para>
    /// Liste ucu hangi teklifi kimin görebileceğini süzüyordu ama kimlikle çalışan uçlar
    /// (yazdır, güncelle, proformaya aktar, proforma başlığı) yalnızca id alıyordu: id deneyen
    /// ya da bilen bir bayi, kapsamı dışındaki bir teklifi <b>basabiliyor</b> (cari adı, ürün,
    /// miktar, birim fiyat) ve <b>üzerine yazabiliyordu</b>. Aynı sınıftan bir açık
    /// <c>CustomerLedgerController.Details</c>'te kapatılmıştı.
    /// </para>
    ///
    /// <para>Kural <c>Get</c> ile birebir aynı: bayi yalnızca KENDİ açtığı ve kendi cari
    /// kapsamındaki teklife; bayi olmayan kullanıcı bayi tekliflerine erişemez (onlar
    /// "Bayi Teklifleri" ekranından yönetilir). <c>null</c> dönerse erişim serbesttir.</para>
    /// </summary>
    private async Task<IActionResult?> BuildOfferAccessErrorAsync(CustomerOffer offer, CancellationToken cancellationToken)
    {
        if (GetRequesterIsSuperAdmin()) return null;

        var isBayi = GetRequesterIsBayi();
        var username = GetRequesterUsername();

        if (isBayi)
        {
            if (string.IsNullOrWhiteSpace(offer.CreateUser)
                || !string.Equals(offer.CreateUser.Trim(), username, StringComparison.OrdinalIgnoreCase))
            {
                return Forbid();
            }

            if (!await CanRequesterAccessOffer(offer, cancellationToken))
            {
                return Forbid();
            }

            return null;
        }

        var bayiRoleIds = await _dbContext.Roles
            .AsNoTracking()
            .Where(r => r.Code != null && (r.Code.ToLower() == "bayi" || r.Code.ToLower() == "altbayi"))
            .Select(r => r.Id)
            .ToListAsync(cancellationToken);

        if (bayiRoleIds.Count > 0 && !string.IsNullOrWhiteSpace(offer.CreateUser))
        {
            var creatorRoleId = await _dbContext.Users
                .AsNoTracking()
                .Where(x => x.Username == offer.CreateUser)
                .Select(x => (int?)x.RoleId)
                .FirstOrDefaultAsync(cancellationToken);

            if (creatorRoleId.HasValue && bayiRoleIds.Contains(creatorRoleId.Value))
            {
                return Forbid();
            }
        }

        return null;
    }

    private async Task<bool> CanRequesterAccessOffer(CustomerOffer offer, CancellationToken cancellationToken)
    {
        if (GetRequesterIsSuperAdmin()) return true;
        if (!GetRequesterIsBayi()) return true;

        var allowed = await ResolveAllowedCustomerCodesForRequester(includeInactive: true, cancellationToken);
        if (allowed.Count == 0) return false;

        if (!string.IsNullOrWhiteSpace(offer.CustomerCode))
        {
            return allowed.Contains(offer.CustomerCode.Trim());
        }

        if (offer.MuhtelifCustomerId.HasValue)
        {
            var owner = await _dbContext.MuhtelifCustomers
                .AsNoTracking()
                .Where(x => x.Id == offer.MuhtelifCustomerId.Value)
                .Select(x => x.OwnerCustomerCode)
                .FirstOrDefaultAsync(cancellationToken);

            return !string.IsNullOrWhiteSpace(owner) && allowed.Contains(owner.Trim());
        }

        return false;
    }

    private async Task<MuhtelifCustomer?> ResolveScopedMuhtelifCustomerByCode(string code, CancellationToken cancellationToken)
    {
        var customerCode = string.IsNullOrWhiteSpace(code) ? null : code.Trim();
        if (string.IsNullOrWhiteSpace(customerCode)) return null;

        if (GetRequesterIsSuperAdmin())
        {
            return await _dbContext.MuhtelifCustomers
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);
        }

        var allowed = await ResolveAllowedCustomerCodesForRequester(includeInactive: true, cancellationToken);
        if (allowed.Count == 0) return null;

        return await _dbContext.MuhtelifCustomers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode && x.OwnerCustomerCode != null && allowed.Contains(x.OwnerCustomerCode), cancellationToken);
    }

    private static long ParseLast6DigitsOrZero(string code, string prefix)
    {
        var s = (code ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(prefix) || !s.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return 0;
        var suffix = s.Substring(prefix.Length);
        if (suffix.Length != 6) return 0;
        return long.TryParse(suffix, out var n) ? n : 0;
    }

    private const string MainCustomerCodePrefix = "120-01-";

    private static string? NullIfBlank(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>
    /// Turns a MUHTELIF offer into a real cari. The cari code is minted here and only here —
    /// the next free 120-01 number at this moment — so an offer that never makes it this far
    /// never burns a code. Idempotent: if the offer already points at an existing cari it is
    /// returned untouched. Returns the cari code.
    /// </summary>
    private async Task<string> EnsureCariForMuhtelifOfferAsync(CustomerOffer offer, CancellationToken cancellationToken)
    {
        var current = NullIfBlank(offer.CustomerCode);
        if (current is not null && !string.Equals(current, "MUHTELIF", StringComparison.OrdinalIgnoreCase))
        {
            var alreadyLinked = await _dbContext.Customers
                .AsNoTracking()
                .AnyAsync(x => x.CustomerCode == current, cancellationToken);

            if (alreadyLinked) return current;
        }

        // AYNI MUHTELİF KAYDINA BAĞLI BAŞKA BİR TEKLİF CARİYİ ZATEN AÇMIŞ OLABİLİR (2026-09-27).
        // Kopyalanan teklifler aynı muhtelif kaydı paylaşıyor; hangisi önce proformaya giderse
        // cariyi o açar ve kaydın koduna yazar. Diğeri burada o cariyi kullanır — yoksa aynı
        // müşteri için ikinci bir 120-01 kartı doğardı.
        var muhtelifCode = NullIfBlank(offer.MuhtelifCustomer?.CustomerCode);
        if (muhtelifCode is not null
            && await _dbContext.Customers.AsNoTracking().AnyAsync(x => x.CustomerCode == muhtelifCode, cancellationToken))
        {
            offer.CustomerCode = muhtelifCode;
            return muhtelifCode;
        }

        var name = NullIfBlank(offer.MuhtelifCustomer?.Name) ?? "Muhtelif Cari";
        var newCustomerCode = await ReserveNextMainCustomerCode(MainCustomerCodePrefix, cancellationToken);

        // The cari born out of a MUHTELIF offer belongs to the plasiyer who made the offer
        var salesmanCode = await ResolveOfferSalesmanCodeAsync(offer.SalesmanCode, offer.CreateUser, cancellationToken);

        /*
         * MUHTELİF TEKLİFTEN DOĞAN CARİ, TEKLİFİN FİYATLANDIĞI GRUBA BAĞLANIR (2026-09-18
         * kullanıcı kararı: "fiyat 1 grubu fatura carisi olacak, sadece fiyat değil tip olarak da").
         *
         * Eskiden bu cari HİÇBİR fiyat grubuna bağlanmadan ve `InvoiceType = "ACIK"` ile
         * açılıyordu. İkisi de sessizce yanlıştı:
         *
         *   - Grup boş kalınca fiyatlandırma gruba göre fiyat bulamayıp EN UCUZ fiyata düşüyor
         *     (`ProductsController`: `direct ?? g.OrderBy(x => x.Price).First()`). Teklif grup 1'den
         *     (`MuhtelifPriceGroupCode`) fiyatlanmışken aynı cariye sonradan bakıldığında —yeni satır,
         *     ikinci bir teklif/fatura— başka bir fiyat görünüyordu. Aktarım anında tutar bozulmuyor,
         *     çünkü kalem fiyatları teklifden kopyalanıyor; kopukluk ondan SONRA ortaya çıkıyordu.
         *   - `EnsureSubAccountsCreatedAsync` alt hesapları (-1/-2/-3) ana cariden miras aldığı için
         *     onlar da grupsuz doğuyordu.
         *   - "ACIK" tipi, hedefi -2 (Açık Cari) hesabına ve OTOMATİK fatura numarasına götürüyordu.
         *     Oysa grup 1 bir FATURA grubudur (`IsInvoiceGroupCode`: 1-3 ve 7) — resmi fatura
         *     numarası elle girilir.
         *
         * Kural normal cari açmadaki ile aynı (`CustomersController`): cari bir gruba bağlanır ve
         * fatura tipi o grubun sınıfına göre belirlenir. Alt hesaplar da bu sayede normal
         * caridekiyle birebir aynı yoldan kurulur (-1 için fiyat grubu eşlemesi dahil) —
         * `EnsureSubAccountsCreatedAsync` grubu ana cariden miras aldığı için ek bir şey gerekmez.
         *
         * Grup bulunamazsa (kurulmamış firma) ESKİ DAVRANIŞ korunur ve aktarım düşmez.
         */
        var muhtelifGroupId = await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(x => x.Code == MuhtelifPriceGroupCode && x.IsActive)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);

        // Tip grubun KODUNDAN türetilir, grup kaydındaki metinden değil: grup 1
        // `PriceGroupMappingService.IsInvoiceGroupCode` (1-3 ve 7) gereği bir FATURA grubudur.
        // Grup kaydında `InvoiceType` boş bırakılmış ya da yanlışlıkla "ACIK" girilmiş olsa bile
        // resmi fatura carisi açık cari gibi doğmamalı — aksi halde hedef -2 hesabına kayar ve
        // fatura numarası elle girilmesi gerekirken otomatik üretilir.
        var invoiceType = muhtelifGroupId.HasValue ? "FATURA" : "ACIK";

        var customer = new Customer
        {
            CustomerCode = newCustomerCode,
            Name = name,
            Address = offer.MuhtelifCustomer?.Address,
            City = offer.MuhtelifCustomer?.City,
            District = offer.MuhtelifCustomer?.District,
            Phone = offer.MuhtelifCustomer?.Phone,
            Email = offer.MuhtelifCustomer?.Email,
            TaxOffice = offer.MuhtelifCustomer?.TaxOffice,
            TaxNumber = offer.MuhtelifCustomer?.TaxNumber,
            CustomerType = "Bayi",
            InvoiceType = invoiceType,
            PriceGroupId = muhtelifGroupId,
            CreditLimit = OfferCustomerCreditLimit,
            CurrencyTypeId = CurrencyTypeHelper.Try,
            SalesmanCode = salesmanCode,
            CreateUser = GetRequesterUsername(),
            CreateTime = DateTime.UtcNow
        };
        _dbContext.Customers.Add(customer);

        offer.CustomerCode = newCustomerCode;

        // Keep the offer and its muhtelif record pointing at the cari they produced
        if (offer.MuhtelifCustomer is not null)
        {
            offer.MuhtelifCustomer.CustomerCode = newCustomerCode;
        }

        if (string.IsNullOrWhiteSpace(offer.SalesmanCode) && !string.IsNullOrWhiteSpace(salesmanCode))
        {
            offer.SalesmanCode = salesmanCode;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Open the -1 / -2 / -3 sub accounts so the new cari has the same structure as any
        // other cari (they inherit Name / SalesmanCode from it).
        await _customerAccountService.EnsureSubAccountsCreatedAsync(customer, cancellationToken);

        return newCustomerCode;
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

    /// <summary>
    /// Preview only. A MUHTELIF offer does not own a cari code — the real 120-01 code is
    /// handed out when the offer becomes a cari (proforma transfer), taking whatever is
    /// next at that moment. This just shows the user which code that is likely to be.
    /// </summary>
    private async Task<string> PeekNextMuhtelifCustomerCode(CancellationToken cancellationToken)
    {
        const string prefix = MainCustomerCodePrefix;

        var seriesKey = $"customer:{prefix.TrimEnd('-')}";
        var seriesLast = await _dbContext.NumberSeries
            .AsNoTracking()
            .Where(x => x.Key == seriesKey)
            .Select(x => (long?)x.LastValue)
            .FirstOrDefaultAsync(cancellationToken);

        var customerCodes = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode != null && x.CustomerCode.StartsWith(prefix))
            .Select(x => x.CustomerCode!)
            .ToListAsync(cancellationToken);

        /*
          MUHTELİF KAYITLARI DA SAYILIR (2026-08-31 canlı hata: aynı kod iki muhtelif kaydına
          verildi, "An item with the same key has already been added. Key: 120-01-000961").

          Burası yalnızca `Customers` tablosuna bakıyordu. Muhtelif carisi ise `Customers`'a
          ANCAK PROFORMAYA AKTARIMDA yazılıyor — teklif aşamasında kod yalnızca
          `MuhtelifCustomers` satırında duruyor. Sonuç: arka arkaya açılan iki muhtelif teklif
          AYNI numarayı alıyordu, çünkü ilki henüz `Customers`'da görünmüyordu.

          Not: bu bir "peek", numarayı REZERVE ETMİYOR. Tam aynı anda açılan iki formun
          çakışma ihtimali sürüyor; kalıcı çözüm numaratörden atomik almak. Ama pratikteki
          hata bu değildi — sıradan art arda kullanımda bile çakışıyordu.
        */
        var muhtelifCodes = await _dbContext.MuhtelifCustomers
            .AsNoTracking()
            .Where(x => x.CustomerCode != null && x.CustomerCode.StartsWith(prefix))
            .Select(x => x.CustomerCode!)
            .ToListAsync(cancellationToken);

        var maxExisting = customerCodes.Count == 0 ? 0 : customerCodes.Max(c => ParseLast6DigitsOrZero(c, prefix));
        var maxMuhtelif = muhtelifCodes.Count == 0 ? 0 : muhtelifCodes.Max(c => ParseLast6DigitsOrZero(c, prefix));
        var last = Math.Max(seriesLast ?? 0, Math.Max(maxExisting, maxMuhtelif));
        return prefix + (last + 1).ToString("D6");
    }

    [HttpGet("muhtelif-next-code")]
    [AuthorizePage("invoice", "musteriTeklifi")]
    public async Task<IActionResult> GetNextMuhtelifCode(CancellationToken cancellationToken)
    {
        var code = await PeekNextMuhtelifCustomerCode(cancellationToken);
        return Ok(new { success = true, data = new { customerCode = code } });
    }

    /// <summary>
    /// Müşteri Teklifi ekranındaki "Cari Ekle" formunun ucu (2026-09-18 kullanıcı isteği):
    /// teklif penceresinden, muhtelif bilgileriyle KALICI bir bayi carisi açar.
    ///
    /// <para>
    /// MUHTELİF AKIŞINA DOKUNMAZ. Muhtelif teklif vermek olduğu gibi duruyor; bu uç ayrı bir
    /// yol — kullanıcı "bu müşteri kalıcı olsun" dediğinde cariyi burada açıp teklifi o carinin
    /// adına veriyor. Teklifin muhtelif kaydı ile bu cari arasında bağ KURULMAZ.
    /// </para>
    ///
    /// <para>
    /// Cari kodu istemciden alınmaz, burada üretilir (<c>120-01-</c> = bayi, sıradaki boş
    /// numara). Kod ayırma <see cref="ReserveNextMainCustomerCode"/> ile serializable işlem
    /// içinde yapılıyor; iki kullanıcı aynı anda kaydetse de aynı numara iki kez verilmez.
    /// </para>
    /// </summary>
    [HttpPost("cari")]
    [AuthorizePage("invoice", "musteriTeklifiCariEkle")]
    public async Task<IActionResult> CreateCari([FromBody] CreateOfferCariRequest request, CancellationToken cancellationToken)
    {
        if (request is null) return BadRequest(new { success = false, message = "İstek gövdesi boş." });

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var name = NullIfBlank(request.Name);
        if (name is null)
        {
            return BadRequest(new { success = false, message = "Cari adı zorunludur." });
        }

        /*
         * SEÇİM → FİYAT GRUBU + FATURA TİPİ (tek tablo).
         *
         * Ekranda üç seçenek var; her biri hem fiyat grubunu hem carinin fatura tipini belirler.
         * Eşleme sistemin genel kuralıyla aynı (`PriceGroupMappingService`): 1-3 ve 7 fatura
         * grubu, 4-6 açık grup. Tipi ayrıca sormuyoruz — iki alanın elle ayrı ayrı seçilmesi,
         * birbirini tutmayan cari (ör. grup 4 ama "FATURA" tipi) üretmeye açık kapı bırakırdı.
         */
        var kind = (request.PriceGroupKind ?? string.Empty).Trim().ToUpperInvariant();
        var (priceGroupCode, invoiceType, accountRole) = kind switch
        {
            "FATURA" => (1, "FATURA", CustomerAccountRole.Normal),
            "ISTISNA" => (4, "ACIK", CustomerAccountRole.OpenMain),
            "ASKERIYE" => (7, "ASKERIYE", CustomerAccountRole.Normal),
            _ => (0, string.Empty, string.Empty)
        };

        if (priceGroupCode == 0)
        {
            return BadRequest(new { success = false, message = "Fiyat grubu seçimi geçersiz. (Fatura / İstisna / Askeriye)" });
        }

        var priceGroupId = await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(x => x.Code == priceGroupCode && x.IsActive)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (!priceGroupId.HasValue)
        {
            return BadRequest(new { success = false, message = $"{priceGroupCode} numaralı fiyat grubu tanımlı değil." });
        }

        // Plasiyer formdan gelir; boş bırakılırsa isteği yapan kullanıcının plasiyeri kullanılır
        // (muhtelif tekliften doğan carideki kural ile aynı).
        var salesmanCode = await ResolveOfferSalesmanCodeAsync(request.SalesmanCode, GetRequesterUsername(), cancellationToken);

        var newCustomerCode = await ReserveNextMainCustomerCode(MainCustomerCodePrefix, cancellationToken);

        var customer = new Customer
        {
            CustomerCode = newCustomerCode,
            Name = name,
            Address = NullIfBlank(request.Address),
            City = NullIfBlank(request.City),
            District = NullIfBlank(request.District),
            Phone = NullIfBlank(request.Phone),
            Email = NullIfBlank(request.Email),
            TaxOffice = NullIfBlank(request.TaxOffice),
            TaxNumber = NullIfBlank(request.TaxNumber),
            CustomerType = "Bayi",
            InvoiceType = invoiceType,
            AccountRole = accountRole,
            PriceGroupId = priceGroupId,
            CreditLimit = OfferCustomerCreditLimit,
            CurrencyTypeId = CurrencyTypeHelper.Try,
            SalesmanCode = salesmanCode,
            CreateUser = GetRequesterUsername(),
            CreateTime = DateTime.UtcNow
        };

        _dbContext.Customers.Add(customer);
        await _dbContext.SaveChangesAsync(cancellationToken);

        // Alt hesaplar (-1/-2/-3) normal cari açmadakiyle aynı yoldan kurulur; fiyat grubunu
        // ana cariden miras alırlar (-1 için grup eşlemesi dahil).
        await _customerAccountService.EnsureSubAccountsCreatedAsync(customer, cancellationToken);

        // Plasiyerin cari kapsamına yazılmazsa, cariyi açan plasiyer bile onu listesinde göremez.
        await Core.Helpers.SalesmanCustomerScopeSync.SyncAsync(
            _dbContext, customer.CustomerCode, salesmanCode, null, cancellationToken);

        return Ok(new
        {
            success = true,
            data = new
            {
                customerCode = customer.CustomerCode,
                name = customer.Name,
                salesmanCode = customer.SalesmanCode,
                priceGroupCode,
                invoiceType = customer.InvoiceType
            }
        });
    }

    [HttpGet]
    [AuthorizePage("invoice", "musteriTeklifi")]
    public async Task<IActionResult> List([FromQuery] int take = 100, [FromQuery] int skip = 0, CancellationToken cancellationToken = default)
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

        var allowed = (!isSuperAdmin && isBayi)
            ? await ResolveAllowedCustomerCodesForRequester(includeInactive: true, cancellationToken)
            : new List<string>();

        // Role split logic:
        // - Bayi/AltBayi: only see their own created offers in this page.
        // - Other roles (including superadmin): should NOT see offers created by Bayi/AltBayi in this page.
        var baseQuery =
            from o in _dbContext.CustomerOffers.AsNoTracking()
            join u in _dbContext.Users.AsNoTracking() on o.CreateUser equals u.Username into uj
            from u in uj.DefaultIfEmpty()
            join c in _dbContext.Customers.AsNoTracking() on o.CustomerCode equals c.CustomerCode into cj
            from c in cj.DefaultIfEmpty()
            join mc in _dbContext.MuhtelifCustomers.AsNoTracking() on o.MuhtelifCustomerId equals mc.Id into mcj
            from mc in mcj.DefaultIfEmpty()
            select new { o, u, c, mc };

        var filteredQuery = baseQuery.Where(x =>
            isBayi
                ? (x.o.CreateUser != null && EF.Functions.ILike(x.o.CreateUser, username))
                : (x.u == null || !bayiRoleIds.Contains(x.u.RoleId))
        );

        // Bayi scope (customer scoping for Bayi/AltBayi)
        filteredQuery = filteredQuery.Where(x =>
            !isBayi
            || isSuperAdmin
            || allowed.Count == 0
            || (
                (x.o.CustomerCode != null && allowed.Contains(x.o.CustomerCode))
                || (x.o.CustomerCode == null && x.o.MuhtelifCustomerId != null && x.o.MuhtelifCustomer != null && x.o.MuhtelifCustomer.OwnerCustomerCode != null && allowed.Contains(x.o.MuhtelifCustomer.OwnerCustomerCode))
            )
        );

        var items = await filteredQuery
            .OrderByDescending(x => x.o.Id)
            .Skip(skip).Take(take)
            .Select(x => new
            {
                id = x.o.Id,
                date = x.o.Date,
                documentNo = x.o.DocumentNo,
                customerCode = x.o.CustomerCode ?? (x.o.MuhtelifCustomerId != null ? "MUHTELIF" : null),
                customerName = x.c != null ? x.c.Name : (x.mc != null ? x.mc.Name : (x.o.MuhtelifCustomer != null ? x.o.MuhtelifCustomer.Name : null)),
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
                        // Proforma basımı en solda barkodu yazıyor.
                        barcode = l.Product != null ? l.Product.Barcode : null,
                        description = l.Description,
                        quantity = l.Quantity,
                        unitPrice = l.UnitPrice,
                        vatRate = l.VatRate,
                        discountType = l.DiscountType,
                        discountValue = l.DiscountValue,
                        campaignName = l.CampaignName,
                        lineNo = l.LineNo,
                        // SATIŞ dövizinin çapası `Product.SalesCurrencyCode`.
                        // Önceden fiyat satırlarından FİLTRESİZ `FirstOrDefault()` alınıyordu
                        // (hangi fiyat grubunun para birimi geleceği rastgele), fiyat satırı
                        // yoksa da ürünün ALIŞ dövizi (`CurrencyCode`) yazılıyordu — "dolarla
                        // al, TL sat" ürününde teklif satırı dolar görünüyordu.
                        currencyCode = l.CurrencyTypeId > 0 ? l.CurrencyTypeId : (l.Product != null ? l.Product.SalesCurrencyCode : 0)
                    })
                    .ToList()
            })
            .ToListAsync(cancellationToken);

        var customerCodes = items
            .Select(x => x.customerCode)
            .Concat(items.Select(x => x.deliveryCustomerCode))
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Distinct()
            .ToList();

        var customerNameRows = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => customerCodes.Contains(x.CustomerCode))
            .Select(x => new { x.CustomerCode, x.Name })
            .ToListAsync(cancellationToken);

        var customerNameByCode = customerNameRows
            .GroupBy(x => x.CustomerCode)
            .ToDictionary(g => g.Key, g => g.First().Name);

        /*
          MÜKERRER ANAHTAR SAYFAYI ÇÖKERTMEZ (2026-08-31 canlı hata: "An item with the same
          key has already been added. Key: 120-01-000961" — müşteri teklifi listesi tamamen
          ölmüştü, 500 dönüyordu).

          `MuhtelifCustomers.CustomerCode` üzerinde TEKİLLİK KISITI YOK. Aynı kodla iki
          muhtelif kaydı doğduğunda `ToDictionary` istisna atıyor ve tek bozuk satır yüzünden
          LİSTENİN TAMAMI kayboluyordu. Ad çözümlemesi bir kolaylıktır; listeyi düşürmemeli.

          Gruplayıp ilkini almak veriyi DÜZELTMEZ — mükerrer kayıtlar ayrıca temizlenmeli.
          Burada yapılan yalnızca ekranı ayakta tutmak.
        */
        var muhtelifNameRows = await _dbContext.MuhtelifCustomers
            .AsNoTracking()
            .Where(x => x.CustomerCode != null && customerCodes.Contains(x.CustomerCode))
            .Select(x => new { x.CustomerCode, x.Name })
            .ToListAsync(cancellationToken);

        var muhtelifNameByCode = muhtelifNameRows
            .GroupBy(x => x.CustomerCode!)
            .ToDictionary(g => g.Key, g => g.First().Name);

        var data = items.Select(x => new
        {
            x.id,
            x.date,
            x.documentNo,
            x.customerCode,
            customerName = x.customerCode != null && customerNameByCode.TryGetValue(x.customerCode, out var n)
                ? n
                : (x.customerCode != null && muhtelifNameByCode.TryGetValue(x.customerCode, out var mn) ? mn : x.customerName),
            x.deliveryCustomerCode,
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
            x.currencyTypeId,
            x.lines
        });

        return Ok(new { success = true, data });
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
            from o in _dbContext.CustomerOffers.AsNoTracking()
            join u in _dbContext.Users.AsNoTracking() on o.CreateUser equals u.Username into uj
            from u in uj.DefaultIfEmpty()
            join c in _dbContext.Customers.AsNoTracking() on o.CustomerCode equals c.CustomerCode into cj
            from c in cj.DefaultIfEmpty()
            join mc in _dbContext.MuhtelifCustomers.AsNoTracking() on o.MuhtelifCustomerId equals mc.Id into mcj
            from mc in mcj.DefaultIfEmpty()
            where u != null && bayiRoleIds.Contains(u.RoleId)
            select new { o, c, mc };

        var items = await baseQuery
            .OrderByDescending(x => x.o.Id)
            .Take(take)
            .Select(x => new
            {
                id = x.o.Id,
                date = x.o.Date,
                documentNo = x.o.DocumentNo,
                customerCode = x.o.CustomerCode ?? (x.o.MuhtelifCustomerId != null ? "MUHTELIF" : null),
                customerName = x.c != null ? x.c.Name : (x.mc != null ? x.mc.Name : (x.o.MuhtelifCustomer != null ? x.o.MuhtelifCustomer.Name : null)),
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
                        // Proforma basımı en solda barkodu yazıyor.
                        barcode = l.Product != null ? l.Product.Barcode : null,
                        description = l.Description,
                        quantity = l.Quantity,
                        unitPrice = l.UnitPrice,
                        vatRate = l.VatRate,
                        discountType = l.DiscountType,
                        discountValue = l.DiscountValue,
                        campaignName = l.CampaignName,
                        lineNo = l.LineNo,
                        // SATIŞ dövizinin çapası `Product.SalesCurrencyCode`.
                        // Önceden fiyat satırlarından FİLTRESİZ `FirstOrDefault()` alınıyordu
                        // (hangi fiyat grubunun para birimi geleceği rastgele), fiyat satırı
                        // yoksa da ürünün ALIŞ dövizi (`CurrencyCode`) yazılıyordu — "dolarla
                        // al, TL sat" ürününde teklif satırı dolar görünüyordu.
                        currencyCode = l.CurrencyTypeId > 0 ? l.CurrencyTypeId : (l.Product != null ? l.Product.SalesCurrencyCode : 0)
                    })
                    .ToList()
            })
            .ToListAsync(cancellationToken);

        var customerCodes = items
            .Select(x => x.customerCode)
            .Concat(items.Select(x => x.deliveryCustomerCode))
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Distinct()
            .ToList();

        var customerNameRows = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => customerCodes.Contains(x.CustomerCode))
            .Select(x => new { x.CustomerCode, x.Name })
            .ToListAsync(cancellationToken);

        var customerNameByCode = customerNameRows
            .GroupBy(x => x.CustomerCode)
            .ToDictionary(g => g.Key, g => g.First().Name);

        /*
          MÜKERRER ANAHTAR SAYFAYI ÇÖKERTMEZ (2026-08-31 canlı hata: "An item with the same
          key has already been added. Key: 120-01-000961" — müşteri teklifi listesi tamamen
          ölmüştü, 500 dönüyordu).

          `MuhtelifCustomers.CustomerCode` üzerinde TEKİLLİK KISITI YOK. Aynı kodla iki
          muhtelif kaydı doğduğunda `ToDictionary` istisna atıyor ve tek bozuk satır yüzünden
          LİSTENİN TAMAMI kayboluyordu. Ad çözümlemesi bir kolaylıktır; listeyi düşürmemeli.

          Gruplayıp ilkini almak veriyi DÜZELTMEZ — mükerrer kayıtlar ayrıca temizlenmeli.
          Burada yapılan yalnızca ekranı ayakta tutmak.
        */
        var muhtelifNameRows = await _dbContext.MuhtelifCustomers
            .AsNoTracking()
            .Where(x => x.CustomerCode != null && customerCodes.Contains(x.CustomerCode))
            .Select(x => new { x.CustomerCode, x.Name })
            .ToListAsync(cancellationToken);

        var muhtelifNameByCode = muhtelifNameRows
            .GroupBy(x => x.CustomerCode!)
            .ToDictionary(g => g.Key, g => g.First().Name);

        var data = items.Select(x => new
        {
            x.id,
            x.date,
            x.documentNo,
            x.customerCode,
            customerName = x.customerCode != null && customerNameByCode.TryGetValue(x.customerCode, out var n)
                ? n
                : (x.customerCode != null && muhtelifNameByCode.TryGetValue(x.customerCode, out var mn) ? mn : x.customerName),
            x.deliveryCustomerCode,
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
            x.currencyTypeId,
            x.lines
        });

        return Ok(new { success = true, data });
    }

    [HttpGet("{id:int}")]
    [AuthorizePage("invoice", "musteriTeklifi")]
    public async Task<IActionResult> Get([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var isBayi = GetRequesterIsBayi();
        var isSuperAdmin = GetRequesterIsSuperAdmin();
        var username = GetRequesterUsername();

        var bayiRoleIds = await _dbContext.Roles
            .AsNoTracking()
            .Where(r => r.Code != null && (r.Code.ToLower() == "bayi" || r.Code.ToLower() == "altbayi"))
            .Select(r => r.Id)
            .ToListAsync(cancellationToken);

        var accessInfo = await (
            from o in _dbContext.CustomerOffers.AsNoTracking()
            join u in _dbContext.Users.AsNoTracking() on o.CreateUser equals u.Username into uj
            from u in uj.DefaultIfEmpty()
            where o.Id == id
            select new { Offer = o, Creator = u }
        ).FirstOrDefaultAsync(cancellationToken);

        if (accessInfo is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        // Role split logic (same approach as List endpoint)
        // - Bayi/AltBayi: can only access their own created offers (prevents URL guessing).
        // - Other roles: should NOT access offers created by Bayi/AltBayi (those are managed via Bayi Teklifleri page/list).
        if (!isSuperAdmin)
        {
            if (isBayi)
            {
                if (string.IsNullOrWhiteSpace(accessInfo.Offer.CreateUser)
                    || !string.Equals(accessInfo.Offer.CreateUser.Trim(), username, StringComparison.OrdinalIgnoreCase))
                {
                    return Forbid();
                }
            }
            else
            {
                if (accessInfo.Creator != null && bayiRoleIds.Contains(accessInfo.Creator.RoleId))
                {
                    return Forbid();
                }
            }
        }

        if (isBayi && !isSuperAdmin)
        {
            var accessOffer = await _dbContext.CustomerOffers
                .AsNoTracking()
                .Where(x => x.Id == id)
                .Select(x => new { x.Id, x.CustomerCode, x.MuhtelifCustomerId })
                .FirstOrDefaultAsync(cancellationToken);

            if (accessOffer is null)
            {
                return NotFound(new { success = false, message = "Teklif bulunamadı" });
            }

            var allowed = await ResolveAllowedCustomerCodesForRequester(includeInactive: true, cancellationToken);
            var ok = false;

            if (!string.IsNullOrWhiteSpace(accessOffer.CustomerCode))
            {
                ok = allowed.Contains(accessOffer.CustomerCode.Trim());
            }
            else if (accessOffer.MuhtelifCustomerId.HasValue)
            {
                var owner = await _dbContext.MuhtelifCustomers
                    .AsNoTracking()
                    .Where(x => x.Id == accessOffer.MuhtelifCustomerId.Value)
                    .Select(x => x.OwnerCustomerCode)
                    .FirstOrDefaultAsync(cancellationToken);

                ok = !string.IsNullOrWhiteSpace(owner) && allowed.Contains(owner.Trim());
            }

            if (!ok)
            {
                return Forbid();
            }
        }

        var offer = await (
            from o in _dbContext.CustomerOffers.AsNoTracking()
            where o.Id == id
            join c in _dbContext.Customers.AsNoTracking() on o.CustomerCode equals c.CustomerCode into cj
            from c in cj.DefaultIfEmpty()
            join dc in _dbContext.Customers.AsNoTracking() on o.DeliveryCustomerCode equals dc.CustomerCode into dcj
            from dc in dcj.DefaultIfEmpty()
            join s in _dbContext.Salesmen.AsNoTracking() on o.SalesmanCode equals s.SalesmanCode into sj
            from s in sj.DefaultIfEmpty()
            select new
            {
                id = o.Id,
                date = o.Date,
                documentNo = o.DocumentNo,
                customerCode = o.CustomerCode ?? (o.MuhtelifCustomerId != null ? "MUHTELIF" : null),
                customerName = o.CustomerCode == null 
                    ? (o.MuhtelifCustomer != null ? o.MuhtelifCustomer.Name : null) 
                    : (c != null ? c.Name : null),
                deliveryCustomerCode = o.DeliveryCustomerCode,
                deliveryCustomerName = dc != null ? dc.Name : null,
                customerPhone = o.CustomerCode == null
                    ? (o.MuhtelifCustomer != null ? o.MuhtelifCustomer.Phone : null)
                    : (c != null ? c.Phone : null),
                customerAddress = o.CustomerCode == null
                    ? (o.MuhtelifCustomer != null ? o.MuhtelifCustomer.Address : null)
                    : (c != null ? c.Address : null),
                customerCity = o.CustomerCode == null
                    ? (o.MuhtelifCustomer != null ? o.MuhtelifCustomer.City : null)
                    : (c != null ? c.City : null),
                customerDistrict = o.CustomerCode == null
                    ? (o.MuhtelifCustomer != null ? o.MuhtelifCustomer.District : null)
                    : (c != null ? c.District : null),
                customerTaxOffice = o.CustomerCode == null
                    ? (o.MuhtelifCustomer != null ? o.MuhtelifCustomer.TaxOffice : null)
                    : (c != null ? c.TaxOffice : null),
                customerTaxNumber = o.CustomerCode == null
                    ? (o.MuhtelifCustomer != null ? o.MuhtelifCustomer.TaxNumber : null)
                    : (c != null ? c.TaxNumber : null),
                description = o.Description,
                vatExempt = o.VatExempt,
                salesmanCode = o.SalesmanCode,
                salesmanName = s != null ? s.Description : o.SalesmanCode,
                // DÜZENLEME EKRANI İÇİN (2026-10-11): carinin fiyat grubu. Ekran cariyi kendi arama
                // listesinden bulamayınca (liste yalnız son aramanın sonucu) fiyat grubunu
                // çözemiyor, satırların liste fiyatını 4 numaralı gruptan alıyor ve indirim
                // sınırını yanlış tabandan hesaplıyordu ("Bu indirimi yapmak için yetkiniz yok").
                customerPriceGroupId = c != null ? c.PriceGroupId : null,
                customerInvoiceType = c != null ? c.InvoiceType : null,
                muhtelif = o.MuhtelifCustomer == null
                    ? null
                    : new
                    {
                        customerCode = o.MuhtelifCustomer.CustomerCode,
                        name = o.MuhtelifCustomer.Name,
                        city = o.MuhtelifCustomer.City,
                        district = o.MuhtelifCustomer.District,
                        address = o.MuhtelifCustomer.Address,
                        phone = o.MuhtelifCustomer.Phone,
                        email = o.MuhtelifCustomer.Email,
                        taxOffice = o.MuhtelifCustomer.TaxOffice,
                        taxNumber = o.MuhtelifCustomer.TaxNumber
                    },
                subtotal = o.Subtotal,
                discountTotal = o.DiscountTotal,
                netTotal = o.NetTotal,
                vatTotal = o.VatTotal,
                grandTotal = o.GrandTotal,
                createUser = o.CreateUser,
                proformaDocumentNo = o.ProformaDocumentNo,
                // Teklifin KENDİ para birimi (2026-08-17): carinin kartı okunmuyor.
                currencyTypeId = o.CurrencyTypeId,
                lines = o.Lines
                    .OrderBy(l => l.LineNo)
                    .Select(l => new
                    {
                        id = l.Id,
                        productId = l.ProductId,
                        stockCode = l.StockCode,
                        stockName = l.Product != null ? l.Product.Name : string.Empty,
                        description = l.Description,
                        productDescription = l.Product != null ? l.Product.Description : null,
                        // Kategori YATAY BASIMDA ürün kutusunun içinde adın altında yazıyor
                        // (2026-09-05). Alt kategori yoksa ana kategoriye düşer.
                        categoryName = l.Product == null
                            ? null
                            : (l.Product.Category != null
                                ? l.Product.Category.Name
                                : (l.Product.MainCategory != null ? l.Product.MainCategory.Name : null)),
                        barcode = l.Product != null ? l.Product.Barcode : null,
                        barcodeType = l.Product != null ? l.Product.BarcodeType : "CODE128",
                        imageUrl = l.Product != null ? l.Product.ImageUrl : null,
                        quantity = l.Quantity,
                        unitPrice = l.UnitPrice,
                        vatRate = l.VatRate,
                        // Ürünün GERÇEK KDV oranı. KDV istisnalı teklifte satırın `vatRate`'i 0
                        // saklanır; düzenlemede istisna kaldırılırsa ekran 0 ile hesaplıyor,
                        // sunucu ise ürünün oranıyla kaydediyordu (ekran ≠ kayıt). Kaydetme
                        // yolu zaten `Product.TaxRate` kullanıyor; ekran da aynısını bilsin.
                        productTaxRate = l.Product != null ? (decimal?)l.Product.TaxRate : null,
                        discountType = l.DiscountType,
                        discountValue = l.DiscountValue,
                        campaignName = l.CampaignName,
                        lineNo = l.LineNo,
                        // SATIŞ dövizinin çapası `Product.SalesCurrencyCode`.
                        // Önceden fiyat satırlarından FİLTRESİZ `FirstOrDefault()` alınıyordu
                        // (hangi fiyat grubunun para birimi geleceği rastgele), fiyat satırı
                        // yoksa da ürünün ALIŞ dövizi (`CurrencyCode`) yazılıyordu — "dolarla
                        // al, TL sat" ürününde teklif satırı dolar görünüyordu.
                        currencyCode = l.CurrencyTypeId > 0 ? l.CurrencyTypeId : (l.Product != null ? l.Product.SalesCurrencyCode : 0)
                    })
                    .ToList()
            }
        ).FirstOrDefaultAsync(cancellationToken);

        if (offer is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        return Ok(new { success = true, data = offer });
    }

    [HttpGet("new-document-no")]
    [AuthorizePage("invoice", "musteriTeklifi")]
    public async Task<IActionResult> GetNewDocumentNo(CancellationToken cancellationToken)
    {
        var no = await GenerateUniqueDocumentNo(cancellationToken);
        return Ok(new { success = true, data = new { documentNo = no } });
    }

    [HttpPost]
    [AuthorizePage("invoice", "musteriTeklifi")]
    [ProducesResponseType(typeof(CustomerOfferCreatedResponse), StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<CustomerOfferCreatedResponse>> Create([FromBody] CreateCustomerOfferRequest request, CancellationToken cancellationToken)
    {
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var customerCode = string.IsNullOrWhiteSpace(request.CustomerCode) ? null : request.CustomerCode.Trim();

        var isMuhtelif = string.Equals(customerCode, "MUHTELIF", StringComparison.OrdinalIgnoreCase);
        MuhtelifCustomer? existingMuhtelifCustomer = null;
        if (isMuhtelif)
        {
            customerCode = null;

            /*
              KOPYA AYNI MUHTELİF MÜŞTERİYE BAĞLANIR (2026-09-27 kullanıcı bildirimi: "kopyala
              deyince aynı cariden bir tane daha açıyor"). Teklif kopyalanınca arayüz muhtelif
              bilgileriyle yeni bir MUHTELIF isteği gönderiyordu; burada her seferinde YENİ bir
              muhtelif kaydı doğuyor, proformaya aktarımda da o kayıt için yeni bir 120-01 carisi
              açılıyordu (GİRNE AKÇİÇEK HASTANESİ: 000980, 000982, 000983).

              Kaynak teklif verildiyse onun muhtelif kaydı yeniden kullanılır: kopya aynı kayda
              bağlanır, kayıt cariye dönmüşse cari kodunu da alır, aktarımda yeni cari açılmaz.
              Yetki kaynak teklifi GÖRME kuralıyla aynı — göremediği teklifin müşterisine bağlanamaz.
            */
            if (request.CopyFromOfferId is > 0)
            {
                var kaynak = await _dbContext.CustomerOffers
                    .AsNoTracking()
                    .Include(x => x.MuhtelifCustomer)
                    .FirstOrDefaultAsync(x => x.Id == request.CopyFromOfferId.Value, cancellationToken);

                if (kaynak?.MuhtelifCustomer is not null)
                {
                    var kaynakErisim = await BuildOfferAccessErrorAsync(kaynak, cancellationToken);
                    if (kaynakErisim is not null) return (ActionResult)kaynakErisim;
                    existingMuhtelifCustomer = kaynak.MuhtelifCustomer;
                }
            }

            if (existingMuhtelifCustomer is null && request.Muhtelif is null)
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
                // If not a real customer, allow selecting an existing scoped MuhtelifCustomer by its generated CustomerCode.
                existingMuhtelifCustomer = await ResolveScopedMuhtelifCustomerByCode(customerCode, cancellationToken);
                if (existingMuhtelifCustomer is null)
                {
                    ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode geçersiz.");
                    return ValidationProblem(ModelState);
                }

                isMuhtelif = true;
                customerCode = null;
            }
        }

        // Bayi/AltBayi must only create offers for their own customer scope (their Carikodu + sub-customers).
        // Otherwise the offer is created but will never show up in their list due to scoping filters.
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
        var products = await LoadOfferProducts(productIds, cancellationToken);

        if (products.Count != productIds.Count)
        {
            return BadRequest(new { success = false, message = "Ürün listesinde geçersiz kayıt var." });
        }

        var inactiveProductsError = BuildInactiveProductsError(products);
        if (inactiveProductsError is not null)
        {
            return inactiveProductsError;
        }

        var productById = products.ToDictionary(x => x.Id, x => x);
        var productCurrencyCodeById = products.ToDictionary(x => x.Id, x => x.ProductCurrencyCode);

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

        var ownerCustomerCode = GetRequesterCustomerCode();

        var muhtelifEntity = isMuhtelif
            ? (existingMuhtelifCustomer is not null
                ? null
                : new MuhtelifCustomer
                {
                    OwnerCustomerCode = ownerCustomerCode,
                    // No cari code yet: it is assigned when the offer becomes a real cari
                    CustomerCode = string.Empty,
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

            _dbContext.MuhtelifCustomers.Add(muhtelifEntity);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        var documentNo = await GenerateUniqueDocumentNo(cancellationToken);

        var requestDate = request.Date ?? DateTime.UtcNow;
        var dateOnlyUtc = DateTime.SpecifyKind(requestDate.Date, DateTimeKind.Utc);

        bool isAcikCari = isMuhtelif;
        bool isAskeriye = false;
        if (!isMuhtelif && !string.IsNullOrWhiteSpace(customerCode))
        {
            var cust = await _dbContext.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.CustomerCode == customerCode, cancellationToken);
            if (cust != null)
            {
                var invType = (cust.InvoiceType ?? string.Empty).Trim().ToUpperInvariant();
                var custName = (cust.Name ?? string.Empty).ToUpperInvariant();
                if (invType == "ASKERIYE" || invType == "ASKERİYE" || custName.Contains("ASKERİYE") || custName.Contains("ASKERIYE") || custName.Contains("KOLORDU") || custName.Contains("TUGAY") || custName.Contains("KOMUTAN"))
                {
                    isAskeriye = true;
                }
                else if (invType == "ACIK" || invType == "AÇIK")
                {
                    isAcikCari = true;
                }
                else if (cust.PriceGroupId.HasValue)
                {
                    var pg = await _dbContext.PriceGroups.AsNoTracking().FirstOrDefaultAsync(p => p.Id == cust.PriceGroupId.Value, cancellationToken);
                    if (pg != null)
                    {
                        var pgInvType = (pg.InvoiceType ?? string.Empty).Trim().ToUpperInvariant();
                        if (pg.Code == 7 || pgInvType == "ASKERIYE" || pgInvType == "ASKERİYE")
                        {
                            isAskeriye = true;
                        }
                        else if (pg.Code == 4 || pg.Code == 5 || pg.Code == 6 || pgInvType == "ACIK" || pgInvType == "AÇIK")
                        {
                            isAcikCari = true;
                        }
                    }
                }
            }
        }

        /*
          MUHTELİFTE KDV KARARI KULLANICININDIR (2026-08-30 kullanıcı bildirimi: "muhtelif
          müşteri teklifinde KDV istisna değil olarak yapıyorum, kaydedince tüm KDV'ler gidiyor").

          `isAcikCari` muhtelif için KOŞULSUZ true başlatılıyor ve bu bayrak hem fiyatlandırma
          hem KDV kararını birden veriyordu. Sonuç: ekranda kutu kapalı olsa bile kayıt istisnalı
          doğuyor, bütün satırların KDV oranı 0 yazılıyordu.

          Kararlar ayrıldı — `isAcikCari` artık TEK BAŞINA hiçbir yeri yönetmiyor:
            * `kdvIstisna`   → KDV kararı
            * `iskontoBastir` → iskonto kararı (2026-08-31'de bu da ayrıldı)
          İkisinde de muhteliften gelen açıklık SAYILMAZ; yalnızca gerçek açık cari ve
          askeriye bastırma yapar.

          Gerçek açık cari ve askeriye davranışı değişmiyor: onlarda istisna zorunlu kalıyor.
        */
        var kdvIstisna = (isAcikCari && !isMuhtelif) || isAskeriye || request.VatExempt;

        /*
          AÇIK CARİYE DE İSKONTO YAPILABİLİR (2026-09-17 kullanıcı kararı: "açık cariye de indirim
          yapılabilsin"). Eskiden açık caride satır iskontosu kayıtta sessizce sıfırlanıyordu;
          ekran indirime izin verip toplamı indirimli gösterdiği için kullanıcı "indirimli
          kaydetmiyor" diye buldu (canlı: MT0000000000127, 120-01-000970). Artık ekranda ne
          girildiyse o kaydedilir. Bayrak düzenleme yoluyla birlikte kapalı tutuluyor; KDV
          kararı (`kdvIstisna`) bundan etkilenmez.
        */
        var iskontoBastir = false;

        var offer = new CustomerOffer
        {
            Date = dateOnlyUtc,
            DocumentNo = documentNo,
            // A muhtelif offer stays on the MUHTELIF sentinel until it becomes a real cari
            CustomerCode = isMuhtelif
                ? (NullIfBlank(existingMuhtelifCustomer?.CustomerCode) ?? "MUHTELIF")
                : customerCode,
            DeliveryCustomerCode = string.IsNullOrWhiteSpace(request.DeliveryCustomerCode) ? null : request.DeliveryCustomerCode.Trim(),
            MuhtelifCustomerId = existingMuhtelifCustomer?.Id ?? muhtelifEntity?.Id,
            VatExempt = kdvIstisna,
            SalesmanCode = string.IsNullOrWhiteSpace(request.SalesmanCode) ? null : request.SalesmanCode.Trim(),
            Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim(),
            CreateUser = username,
            CreateTime = now
        };

        var lines = request.Lines.Select((l, idx) =>
        {
            var p = productById[l.ProductId];
            var resolved = priceByProductId[l.ProductId];
            var unitPrice = l.UnitPrice.HasValue && l.UnitPrice.Value > 0 ? l.UnitPrice.Value : resolved.Price;
            return new CustomerOfferLine
            {
                ProductId = l.ProductId,
                StockCode = p.StockCode,
                Quantity = l.Quantity,
                UnitPrice = unitPrice,
                // Kalem, fiyatın geldiği SATIŞ dövizindedir. Kullanıcı elle fiyat girse de
                // para birimi değişmez: aynı fiyat listesinin parasında yazılmış demektir.
                CurrencyTypeId = resolved.CurrencyTypeId,
                VatRate = kdvIstisna ? 0m : p.TaxRate,
                /*
                  MUHTELİFTE İSKONTO SİLİNMEZ (2026-08-31 kullanıcı bildirimi: "indirim yapıp
                  kaydedince tüm iskontolar gidiyor").

                  `isAcikCari` muhtelif için koşulsuz true; bu bayrak hem KDV'yi hem iskontoyu
                  birden bastırıyordu. KDV'yi 30.08'de ayırmıştım ama iskonto burada kalmıştı —
                  kullanıcı iskonto giriyor, kayıt onu sıfırlıyordu.

                  Gerçek AÇIK cari davranışı değişmiyor: orada fiyat zaten KDV dahil ve
                  iskontosuz kurgulanıyor, bastırma doğru olandır. Muhtelif ise grup 1'den
                  (KDV matrahlı) fiyatlanıyor ve iskonto alabilmeli.
                */
                DiscountType = iskontoBastir ? CustomerOfferLineDiscountType.None : l.DiscountType,
                DiscountValue = iskontoBastir ? 0m : l.DiscountValue,
                CampaignName = string.IsNullOrWhiteSpace(l.CampaignName) ? null : l.CampaignName.Trim(),
                LineNo = idx + 1,
                CreateUser = username,
                CreateTime = now
            };
        }).ToList();

        foreach (var l in lines)
        {
            offer.Lines.Add(l);
        }

        await ApplyOfferCurrencyAsync(offer, cancellationToken);

        ComputeTotals(offer);

        // Siparişteki ile aynı risk hesabı: teklif de cariye limit yükü getirir.
        var limitError = await BuildCreditLimitError(isMuhtelif ? null : customerCode, offer, productCurrencyCodeById, cancellationToken);
        if (limitError is not null)
        {
            return limitError;
        }

        _dbContext.CustomerOffers.Add(offer);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var response = new CustomerOfferCreatedResponse { Id = offer.Id, DocumentNo = offer.DocumentNo };
        return CreatedAtAction(nameof(Create), new { id = response.Id }, response);
    }

    [AtomicRequest]
    [HttpPut("{id:int}")]
    [AuthorizePage("invoice", "musteriTeklifiDuzenle")]
    public async Task<IActionResult> Update([FromRoute] int id, [FromBody] UpdateCustomerOfferRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var offer = await _dbContext.CustomerOffers
            .Include(x => x.Lines)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (offer is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        // KİMLİK KAPISI: liste süzgeci burada geçmiyor, teklifin sahipliği ayrıca sorulmalı.
        var offerAccessError = await BuildOfferAccessErrorAsync(offer, cancellationToken);
        if (offerAccessError is not null) return offerAccessError;

        var customerCode = string.IsNullOrWhiteSpace(request.CustomerCode) ? null : request.CustomerCode.Trim();

        var isMuhtelif = string.Equals(customerCode, "MUHTELIF", StringComparison.OrdinalIgnoreCase);
        MuhtelifCustomer? existingMuhtelifCustomer = null;
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
                existingMuhtelifCustomer = await ResolveScopedMuhtelifCustomerByCode(customerCode, cancellationToken);
                if (existingMuhtelifCustomer is null)
                {
                    ModelState.AddModelError(nameof(request.CustomerCode), "CustomerCode geçersiz.");
                    return ValidationProblem(ModelState);
                }

                isMuhtelif = true;
                customerCode = null;
            }
        }

        // Bayi/AltBayi must only update offers for their own customer scope (their Carikodu + sub-customers).
        // Otherwise the offer is updated but will never show up in their list due to scoping filters.
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
        var products = await LoadOfferProducts(productIds, cancellationToken);

        if (products.Count != productIds.Count)
        {
            return BadRequest(new { success = false, message = "Ürün listesinde geçersiz kayıt var." });
        }

        var inactiveProductsError = BuildInactiveProductsError(products);
        if (inactiveProductsError is not null)
        {
            return inactiveProductsError;
        }

        var productById = products.ToDictionary(x => x.Id, x => x);
        var productCurrencyCodeById = products.ToDictionary(x => x.Id, x => x.ProductCurrencyCode);

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
        var ownerCustomerCode = GetRequesterCustomerCode();

        if (isMuhtelif)
        {
            if (existingMuhtelifCustomer is not null)
            {
                offer.MuhtelifCustomerId = existingMuhtelifCustomer.Id;

                if (string.IsNullOrWhiteSpace(existingMuhtelifCustomer.OwnerCustomerCode) && !string.IsNullOrWhiteSpace(ownerCustomerCode))
                {
                    var existing = await _dbContext.MuhtelifCustomers
                        .FirstOrDefaultAsync(x => x.Id == existingMuhtelifCustomer.Id, cancellationToken);

                    if (existing is not null && string.IsNullOrWhiteSpace(existing.OwnerCustomerCode))
                    {
                        existing.OwnerCustomerCode = ownerCustomerCode;
                        existing.EditUser = username;
                        existing.EditTime = now;
                        await _dbContext.SaveChangesAsync(cancellationToken);
                    }
                }
            }
            if (offer.MuhtelifCustomerId.HasValue)
            {
                var muhtelif = await _dbContext.MuhtelifCustomers
                    .FirstOrDefaultAsync(x => x.Id == offer.MuhtelifCustomerId.Value, cancellationToken);

                // Muhtelif bilgisi gövdede YOKSA kayıttaki bilgiye dokunulmaz. Bu yola muhtelif carinin
                // KODUYLA da girilebiliyor (yukarıda `ResolveScopedMuhtelifCustomerByCode`) ve o yolda
                // `request.Muhtelif` boş gelebilir; önceden burası NullReference ile 500 dönüyordu.
                if (muhtelif is not null && request.Muhtelif is not null)
                {
                    if (string.IsNullOrWhiteSpace(muhtelif.OwnerCustomerCode))
                    {
                        muhtelif.OwnerCustomerCode = ownerCustomerCode;
                    }
                    muhtelif.CustomerCode = (request.Muhtelif!.CustomerCode ?? string.Empty).Trim();
                    muhtelif.Name = request.Muhtelif!.Name.Trim();
                    muhtelif.City = request.Muhtelif!.City?.Trim();
                    muhtelif.District = request.Muhtelif!.District?.Trim();
                    muhtelif.Address = request.Muhtelif!.Address?.Trim();
                    muhtelif.Phone = request.Muhtelif!.Phone?.Trim();
                    muhtelif.Email = request.Muhtelif!.Email?.Trim();
                    muhtelif.TaxOffice = request.Muhtelif!.TaxOffice?.Trim();
                    muhtelif.TaxNumber = request.Muhtelif!.TaxNumber?.Trim();
                    muhtelif.EditUser = username;
                    muhtelif.EditTime = now;
                }
            }
            else
            {
                var muhtelifEntity = new MuhtelifCustomer
                {
                    OwnerCustomerCode = ownerCustomerCode,
                    // No cari code yet: it is assigned when the offer becomes a real cari
                    CustomerCode = string.Empty,
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

                _dbContext.MuhtelifCustomers.Add(muhtelifEntity);
                await _dbContext.SaveChangesAsync(cancellationToken);
                offer.MuhtelifCustomerId = muhtelifEntity.Id;
            }
        }

        bool isAcikCariUpdate = isMuhtelif;
        bool isAskeriyeUpdate = false;
        if (!isMuhtelif && !string.IsNullOrWhiteSpace(customerCode))
        {
            var cust = await _dbContext.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.CustomerCode == customerCode, cancellationToken);
            if (cust != null)
            {
                var invType = (cust.InvoiceType ?? string.Empty).Trim().ToUpperInvariant();
                var custName = (cust.Name ?? string.Empty).ToUpperInvariant();
                if (invType == "ASKERIYE" || invType == "ASKERİYE" || custName.Contains("ASKERİYE") || custName.Contains("ASKERIYE") || custName.Contains("KOLORDU") || custName.Contains("TUGAY") || custName.Contains("KOMUTAN"))
                {
                    isAskeriyeUpdate = true;
                }
                else if (invType == "ACIK" || invType == "AÇIK")
                {
                    isAcikCariUpdate = true;
                }
                else if (cust.PriceGroupId.HasValue)
                {
                    var pg = await _dbContext.PriceGroups.AsNoTracking().FirstOrDefaultAsync(p => p.Id == cust.PriceGroupId.Value, cancellationToken);
                    if (pg != null)
                    {
                        var pgInvType = (pg.InvoiceType ?? string.Empty).Trim().ToUpperInvariant();
                        if (pg.Code == 7 || pgInvType == "ASKERIYE" || pgInvType == "ASKERİYE")
                        {
                            isAskeriyeUpdate = true;
                        }
                        else if (pg.Code == 4 || pg.Code == 5 || pg.Code == 6 || pgInvType == "ACIK" || pgInvType == "AÇIK")
                        {
                            isAcikCariUpdate = true;
                        }
                    }
                }
            }
        }

        offer.CustomerCode = customerCode;

        /*
          MUHTELİFTEN NORMAL CARİYE GEÇİŞTE ESKİ BAĞ KOPARILIR (2026-09-17).
          Teklif muhtelifken normal bir cariye çevrildiğinde `MuhtelifCustomerId` dolu kalıyordu.
          Düzenleme ekranı teklifi açarken `muhtelif` alanı doluysa cariyi MUHTELIF'e çeviriyor
          (CustomerOfferPage) — yani cari değiştirilip kaydedilen teklif tekrar açıldığında yine
          muhtelif görünüyor, yeniden kaydedilince de seçilen cari kayboluyordu. Üst bilgi
          düzenleme ucu (`UpdateHeader`) aynı durumda bağı zaten koparıyor.
        */
        if (!isMuhtelif)
        {
            offer.MuhtelifCustomerId = null;
        }

        offer.DeliveryCustomerCode = string.IsNullOrWhiteSpace(request.DeliveryCustomerCode) ? null : request.DeliveryCustomerCode.Trim();
        // Muhteliften gelen açıklık KDV kararına karışmaz; bkz. oluşturma yolundaki açıklama.
        var kdvIstisnaUpdate = (isAcikCariUpdate && !isMuhtelif) || isAskeriyeUpdate || request.VatExempt;
        // Açık caride de iskonto korunur — bkz. oluşturma yolundaki 2026-09-17 notu.
        var iskontoBastirUpdate = false;
        offer.VatExempt = kdvIstisnaUpdate;

        var requestDate = request.Date ?? offer.Date;
        offer.Date = DateTime.SpecifyKind(requestDate.Date, DateTimeKind.Utc);

        offer.SalesmanCode = string.IsNullOrWhiteSpace(request.SalesmanCode) ? null : request.SalesmanCode.Trim();
        offer.Description = string.IsNullOrWhiteSpace(request.Description) ? null : request.Description.Trim();
        offer.EditUser = username;
        offer.EditTime = now;

        /*
          ESKI SATIRLAR KOLEKSIYONDAN DA CIKARILIR (2026-08-24, kullanici bildirimi:
          "musteri teklifinden proformaya aktariyorum, 2 kat fark geliyor").

          `_dbContext.Remove(...)` satiri SILINMEK UZERE ISARETLER ama `offer.Lines`
          koleksiyonundan CIKARMAZ. Asagida yeni satirlar eklenince koleksiyonda eski + yeni
          birlikte duruyor (7 + 7 = 14) ve `ComputeTotals` hepsini topluyordu. Veritabanina
          satirlar dogru yaziliyor (eskiler siliniyor), fakat BASLIK TOPLAMLARI cift sayilmis
          halde kaliyordu.

          Gorunur sonucu: Musteri Teklifi ekrani toplamlari satirlardan yeniden hesapladigi
          icin dogru gosteriyor, Proforma ekrani ise KAYITLI toplamlari okudugu icin iki kat
          gosteriyordu. Ayni belge, iki ekran, iki rakam.

          Canlida olculdu: satirlardan 678.651,50 — kayitli 1.365.656,42; aradaki 687.004,92
          duzenleme oncesi surumun ara toplamiydi.
        */
        foreach (var existing in offer.Lines.ToList())
        {
            _dbContext.CustomerOfferLines.Remove(existing);
            offer.Lines.Remove(existing);
        }

        var newLines = request.Lines.Select((l, idx) =>
        {
            var p = productById[l.ProductId];
            var resolved = priceByProductId[l.ProductId];
            var unitPrice = l.UnitPrice.HasValue && l.UnitPrice.Value > 0 ? l.UnitPrice.Value : resolved.Price;
            return new CustomerOfferLine
            {
                ProductId = l.ProductId,
                StockCode = p.StockCode,
                Quantity = l.Quantity,
                UnitPrice = unitPrice,
                CurrencyTypeId = resolved.CurrencyTypeId,
                VatRate = kdvIstisnaUpdate ? 0m : p.TaxRate,
                // Muhteliften gelen açıklık iskontoyu bastırmaz; bkz. oluşturma yolu.
                DiscountType = iskontoBastirUpdate ? CustomerOfferLineDiscountType.None : l.DiscountType,
                DiscountValue = iskontoBastirUpdate ? 0m : l.DiscountValue,
                CampaignName = string.IsNullOrWhiteSpace(l.CampaignName) ? null : l.CampaignName.Trim(),
                LineNo = idx + 1,
                CreateUser = username,
                CreateTime = now
            };
        }).ToList();

        foreach (var l in newLines)
        {
            offer.Lines.Add(l);
        }

        await ApplyOfferCurrencyAsync(offer, cancellationToken);

        ComputeTotals(offer);

        // Siparişteki ile aynı risk hesabı: teklif de cariye limit yükü getirir.
        var limitError = await BuildCreditLimitError(isMuhtelif ? null : customerCode, offer, productCurrencyCodeById, cancellationToken);
        if (limitError is not null)
        {
            return limitError;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/transfer-to-proforma")]
    [AuthorizePage("invoice", "musteriTeklifiProformaAktar")]
    public async Task<IActionResult> TransferToProforma([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var offer = await _dbContext.CustomerOffers
            .Include(x => x.MuhtelifCustomer)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (offer is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        // KİMLİK KAPISI: liste süzgeci burada geçmiyor, teklifin sahipliği ayrıca sorulmalı.
        var offerAccessError = await BuildOfferAccessErrorAsync(offer, cancellationToken);
        if (offerAccessError is not null) return offerAccessError;

        if (!string.IsNullOrWhiteSpace(offer.ProformaDocumentNo))
        {
            return Ok(new { success = true, data = new { proformaDocumentNo = offer.ProformaDocumentNo } });
        }

        // A MUHTELIF offer becomes a real cari here — this is the only place a cari code is minted.
        var isMuhtelifOffer = offer.MuhtelifCustomer is not null
            || string.Equals(offer.CustomerCode, "MUHTELIF", StringComparison.OrdinalIgnoreCase);

        if (isMuhtelifOffer)
        {
            await EnsureCariForMuhtelifOfferAsync(offer, cancellationToken);
        }

        var proformaNo = await GenerateNextProformaNo(cancellationToken);

        offer.ProformaDocumentNo = proformaNo;
        offer.EditUser = GetRequesterUsername();
        offer.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        await _userActivityLogger.LogAsync(
            "invoice",
            "musteriTeklifi",
            "Aktarma",
            $"Müşteri teklifi (No: {offer.DocumentNo}) proforma faturaya aktarıldı (Proforma No: {proformaNo}).",
            offer.Id.ToString(),
            new { offerId = offer.Id, proformaNo = proformaNo },
            cancellationToken);

        return Ok(new { success = true, data = new { proformaDocumentNo = proformaNo } });
    }

    [HttpDelete("{id:int}/proforma")]
    [AuthorizePage("invoice", "proforma")]
    public async Task<IActionResult> DeleteProforma([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        var offer = await _dbContext.CustomerOffers
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (offer is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        // KİMLİK KAPISI: liste süzgeci burada geçmiyor, teklifin sahipliği ayrıca sorulmalı.
        var offerAccessError = await BuildOfferAccessErrorAsync(offer, cancellationToken);
        if (offerAccessError is not null) return offerAccessError;

        var hasInvoice = await _dbContext.Set<Invoice>()
            .AsNoTracking()
            .AnyAsync(x => x.SourceCustomerOfferId == offer.Id, cancellationToken);

        if (hasInvoice)
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
                customerOfferId = offer.Id,
                documentNo = offer.DocumentNo,
                proformaDocumentNo = offer.ProformaDocumentNo,
                customerCode = offer.CustomerCode,
                grandTotal = offer.GrandTotal,
                date = offer.Date
            };

            var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
            if (string.IsNullOrWhiteSpace(username)) username = "System";

            _dbContext.Set<DeletionLog>().Add(new DeletionLog
            {
                ModuleKey = "invoice",
                PageKey = "proforma",
                RecordType = "Proforma",
                RecordId = offer.Id.ToString(),
                ParentType = null,
                ParentId = null,
                Description = $"Proforma silindi (teklife dönüştürüldü): {offer.ProformaDocumentNo}",
                DetailsJson = JsonSerializer.Serialize(proformaBackup),
                CreateUser = username,
                CreateTime = DateTime.UtcNow
            });
        }

        var oldProformaNo = offer.ProformaDocumentNo;
        offer.ProformaDocumentNo = null;
        offer.EditUser = GetRequesterUsername();
        offer.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        if (!string.IsNullOrEmpty(oldProformaNo))
        {
            await _userActivityLogger.LogAsync(
                "invoice",
                "proforma",
                "Silme",
                $"Proforma fatura (No: {oldProformaNo}) silindi (teklife dönüştürüldü).",
                offer.Id.ToString(),
                new { offerId = offer.Id, proformaNo = oldProformaNo },
                cancellationToken);
        }

        return Ok(new { success = true });
    }

    [HttpGet("proformas")]
    [AuthorizePage("invoice", "musteriTeklifi")]
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

        var allowed = (!isSuperAdmin && isBayi)
            ? await ResolveAllowedCustomerCodesForRequester(includeInactive: true, cancellationToken)
            : new List<string>();

        var query =
                from offer in _dbContext.CustomerOffers.AsNoTracking()
                join u in _dbContext.Users.AsNoTracking() on offer.CreateUser equals u.Username into uj
                from u in uj.DefaultIfEmpty()
                join inv in _dbContext.Invoices.AsNoTracking() on offer.Id equals inv.SourceCustomerOfferId into invJoin
                from inv in invJoin.DefaultIfEmpty()
                join c in _dbContext.Customers.AsNoTracking() on offer.CustomerCode equals c.CustomerCode into cj
                from c in cj.DefaultIfEmpty()
                join pg in _dbContext.PriceGroups.AsNoTracking() on c.PriceGroupId equals pg.Id into pgj
                from pg in pgj.DefaultIfEmpty()
                join mc in _dbContext.MuhtelifCustomers.AsNoTracking() on offer.MuhtelifCustomerId equals mc.Id into mcj
                from mc in mcj.DefaultIfEmpty()
                where offer.ProformaDocumentNo != null
                      && (isBayi
                          ? (offer.CreateUser != null && EF.Functions.ILike(offer.CreateUser, username))
                          : (u == null || !bayiRoleIds.Contains(u.RoleId)))
                      && (!isBayi
                          || isSuperAdmin
                          || allowed.Count == 0
                          || (
                              (offer.CustomerCode != null && allowed.Contains(offer.CustomerCode!))
                              || (offer.CustomerCode == null && offer.MuhtelifCustomerId != null && offer.MuhtelifCustomer != null && offer.MuhtelifCustomer!.OwnerCustomerCode != null && allowed.Contains(offer.MuhtelifCustomer!.OwnerCustomerCode!))
                          ))
                orderby offer.Id descending
                select new
                {
                    id = offer.Id,
                    date = offer.Date,
                    documentNo = offer.ProformaDocumentNo,
                    customerCode = offer.CustomerCode ?? (offer.MuhtelifCustomerId != null ? "MUHTELIF" : null),
                    customerName = c != null ? c.Name : (mc != null ? mc.Name : (offer.MuhtelifCustomer != null ? offer.MuhtelifCustomer!.Name : null)),
                    targetAccountType = (c != null && ((c.InvoiceType ?? "").ToUpper() == "ASKERIYE" || (c.InvoiceType ?? "").ToUpper() == "ASKERİYE" || (pg != null && pg.Code == 7)))
                        ? "ASKERIYE"
                        : (c != null && ((c.InvoiceType ?? "").ToUpper() == "ACIK" || (c.InvoiceType ?? "").ToUpper() == "AÇIK" || (pg != null && pg.Code >= 4 && pg.Code <= 6)))
                            ? "ACIK"
                            : "FATURA",
                    customerInvoiceType = c != null ? c.InvoiceType : null,
                    priceGroupCode = pg != null ? (int?)pg.Code : (int?)null,
                    description = offer.Description,
                    vatExempt = offer.VatExempt,
                    subtotal = offer.Subtotal,
                    discountTotal = offer.DiscountTotal,
                    netTotal = offer.NetTotal,
                    vatTotal = offer.VatTotal,
                    grandTotal = offer.GrandTotal,
                    createUser = offer.CreateUser,
                    invoiceId = inv != null ? inv.Id : (int?)null,
                    invoiceNo = inv != null ? inv.InvoiceNo : null,
                    // Teklifin KENDİ para birimi (2026-08-17): carinin kartı okunmuyor.
                    currencyTypeId = offer.CurrencyTypeId,
                    lines = offer.Lines
                        .OrderBy(l => l.LineNo)
                        .Select(l => new
                        {
                            id = l.Id,
                            productId = l.ProductId,
                            stockCode = l.StockCode,
                            stockName = l.Product != null ? l.Product.Name : string.Empty,
                            // Proforma basımı en solda barkodu yazıyor.
                            barcode = l.Product != null ? l.Product.Barcode : null,
                            description = l.Description,
                            quantity = l.Quantity,
                            unitPrice = l.UnitPrice,
                            vatRate = l.VatRate,
                            discountType = l.DiscountType,
                            discountValue = l.DiscountValue,
                            campaignName = l.CampaignName,
                            lineNo = l.LineNo,
                            // SATIŞ dövizinin çapası `Product.SalesCurrencyCode`; fiyat satırı
                            // yalnızca çapa TL iken yedek. Çapa boşken ALIŞ dövizine
                            // (`Product.CurrencyCode`) düşülüyordu: ürünlerin çoğu "dolarla al,
                            // TL sat" olduğu için TL teklif satırı USD görünürdü.
                            currencyCode = l.Product == null
                                ? 0
                                : (l.Product.SalesCurrencyCode > 1
                                    ? l.Product.SalesCurrencyCode
                                    : (l.Product.ProductPrices.Any()
                                        ? B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyStringToProductCurrencyCode(l.Product.ProductPrices.Select(pp => pp.Currency).FirstOrDefault(), l.Product.SalesCurrencyCode)
                                        : l.Product.SalesCurrencyCode))
                        })
                        .ToList()
                };

        var data = await query
            .Skip(skip).Take(take)
            .ToListAsync(cancellationToken);

        var customerCodes = data
            .Where(x => !string.IsNullOrWhiteSpace(x.customerCode))
            .Select(x => x.customerCode!)
            .Distinct()
            .ToList();

        var customerNameRows = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => customerCodes.Contains(x.CustomerCode))
            .Select(x => new { x.CustomerCode, x.Name })
            .ToListAsync(cancellationToken);

        var customerNameByCode = customerNameRows
            .GroupBy(x => x.CustomerCode)
            .ToDictionary(g => g.Key, g => g.First().Name);

        /*
          MÜKERRER ANAHTAR SAYFAYI ÇÖKERTMEZ (2026-08-31 canlı hata: "An item with the same
          key has already been added. Key: 120-01-000961" — müşteri teklifi listesi tamamen
          ölmüştü, 500 dönüyordu).

          `MuhtelifCustomers.CustomerCode` üzerinde TEKİLLİK KISITI YOK. Aynı kodla iki
          muhtelif kaydı doğduğunda `ToDictionary` istisna atıyor ve tek bozuk satır yüzünden
          LİSTENİN TAMAMI kayboluyordu. Ad çözümlemesi bir kolaylıktır; listeyi düşürmemeli.

          Gruplayıp ilkini almak veriyi DÜZELTMEZ — mükerrer kayıtlar ayrıca temizlenmeli.
          Burada yapılan yalnızca ekranı ayakta tutmak.
        */
        var muhtelifNameRows = await _dbContext.MuhtelifCustomers
            .AsNoTracking()
            .Where(x => x.CustomerCode != null && customerCodes.Contains(x.CustomerCode))
            .Select(x => new { x.CustomerCode, x.Name })
            .ToListAsync(cancellationToken);

        var muhtelifNameByCode = muhtelifNameRows
            .GroupBy(x => x.CustomerCode!)
            .ToDictionary(g => g.Key, g => g.First().Name);

        var normalized = data.Select(x => new
        {
            x.id,
            x.date,
            x.documentNo,
            x.customerCode,
            customerName = x.customerCode != null && customerNameByCode.TryGetValue(x.customerCode, out var n)
                ? n
                : (x.customerCode != null && muhtelifNameByCode.TryGetValue(x.customerCode, out var mn) ? mn : x.customerName),
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

    [AtomicRequest]
    [HttpPut("{id:int}/proforma-header")]
    [AuthorizePage("invoice", "proforma")]
    public async Task<IActionResult> UpdateProformaHeader([FromRoute] int id, [FromBody] B2B.Erp.Api.Dtos.CustomerOffers.UpdateProformaHeaderRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });
        if (!ModelState.IsValid) return ValidationProblem(ModelState);

        var offer = await _dbContext.CustomerOffers
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (offer is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        // KİMLİK KAPISI: liste süzgeci burada geçmiyor, teklifin sahipliği ayrıca sorulmalı.
        var offerAccessError = await BuildOfferAccessErrorAsync(offer, cancellationToken);
        if (offerAccessError is not null) return offerAccessError;

        var hasInvoice = await _dbContext.Set<Invoice>()
            .AsNoTracking()
            .AnyAsync(x => x.SourceCustomerOfferId == offer.Id, cancellationToken);

        if (hasInvoice)
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
            var exists = await _dbContext.CustomerOffers
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
            offer.MuhtelifCustomerId = null;
        }

        offer.EditUser = GetRequesterUsername();
        offer.EditTime = DateTime.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        // Keep number series aligned with manual proforma document no changes.
        // This prevents transfer-to-proforma from suggesting an already-used number due to stale LastValue.
        if (shouldUpdateProformaNo)
        {
            var s = offer.ProformaDocumentNo;
            if (!string.IsNullOrWhiteSpace(s) && s.Length == 15 && s.StartsWith('P'))
            {
                var tail = s.Substring(1);
                if (long.TryParse(tail, out var n))
                {
                    const string key = "PROFORMA";
                    var series = await _dbContext.NumberSeries
                        .FirstOrDefaultAsync(x => x.Key == key, cancellationToken);

                    if (series is null)
                    {
                        series = new NumberSeries { Key = key, LastValue = n };
                        _dbContext.NumberSeries.Add(series);
                        await _dbContext.SaveChangesAsync(cancellationToken);
                    }
                    else if (n > series.LastValue)
                    {
                        series.LastValue = n;
                        await _dbContext.SaveChangesAsync(cancellationToken);
                    }
                }
            }
        }

        // If this proforma was transferred to invoice, keep the invoice in Fatura Döküm,
        // but detach the relation so proforma becomes transferable again.
        var linkedInvoice = await _dbContext.Set<Invoice>()
            .FirstOrDefaultAsync(x => x.SourceCustomerOfferId == offer.Id, cancellationToken);

        if (linkedInvoice is not null)
        {
            linkedInvoice.SourceCustomerOfferId = null;
            linkedInvoice.EditUser = offer.EditUser;
            linkedInvoice.EditTime = offer.EditTime;
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return Ok(new { success = true });
    }

    [HttpPost("{id:int}/transfer-to-invoice")]
    [AuthorizePage("invoice", "proformaFaturaDokumeAktar")]
    public async Task<IActionResult> TransferToInvoice([FromRoute] int id, [FromBody] TransferCustomerOfferToInvoiceRequest request, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { success = false, message = "Geçersiz id" });

        if (GetRequesterIsBayi() && !GetRequesterIsSuperAdmin())
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, message = "Bayi rolü satış faturasına aktarma yapamaz." });
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var offer = await _dbContext.CustomerOffers
            .Include(x => x.MuhtelifCustomer)
            .Include(x => x.Lines)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (offer is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        if (string.IsNullOrWhiteSpace(offer.ProformaDocumentNo))
        {
            return BadRequest(new { success = false, message = "Proforma belge no bulunamadı" });
        }

        var already = await _dbContext.Set<Invoice>()
            .AsNoTracking()
            .AnyAsync(x => x.SourceCustomerOfferId == offer.Id, cancellationToken);

        if (already)
        {
            return BadRequest(new { success = false, message = "Bu proforma zaten satış faturasına aktarılmış" });
        }

        // Safety net: normally TransferToProforma already created the cari. If it somehow
        // did not, mint it here with the exact same rules (120-01 code, offer's plasiyer,
        // sub accounts) instead of resurrecting the muhtelif record's own code.
        if (offer.MuhtelifCustomer is not null)
        {
            await EnsureCariForMuhtelifOfferAsync(offer, cancellationToken);
        }

        if (string.IsNullOrWhiteSpace(offer.CustomerCode))
        {
            return BadRequest(new { success = false, message = "Cari kodu bulunamadı" });
        }

        if (offer.Lines.Count == 0)
        {
            return BadRequest(new { success = false, message = "Proforma kalemi bulunamadı" });
        }

        // 1. Hedef Alt Cari Kodunu Çözümle (-1 Fatura, -2 Açık, -3 Askeriye / Muaf)
        var rawCustomerCode = offer.CustomerCode.Trim();
        var targetAccountType = (request.TargetAccountType ?? string.Empty).Trim().ToUpperInvariant();
        var explicitTargetCustomerCode = (request.TargetCustomerCode ?? string.Empty).Trim();

        string customerCode;
        if (!string.IsNullOrWhiteSpace(explicitTargetCustomerCode))
        {
            customerCode = explicitTargetCustomerCode;
        }
        else
        {
            var resolvedCode = await _customerAccountService.ResolveTargetInvoiceCustomerCodeAsync(
                rawCustomerCode,
                !string.IsNullOrWhiteSpace(targetAccountType) ? targetAccountType : null,
                cancellationToken);

            customerCode = !string.IsNullOrWhiteSpace(resolvedCode) ? resolvedCode : rawCustomerCode;
        }

        // 2. Hedef carinin fatura tipini ve açık/kapalı durumunu belirle
        var targetCustomer = await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == customerCode, cancellationToken);

        var customerInvoiceType = targetCustomer?.InvoiceType;
        var customerInvoiceTypeNormalized = (customerInvoiceType ?? string.Empty).Trim().ToUpperInvariant();

        bool isFaturaAccount = customerCode.EndsWith("-1") || targetAccountType == "FATURA";
        bool isAskeriye = !isFaturaAccount && (customerInvoiceTypeNormalized == "ASKERIYE" 
                          || customerInvoiceTypeNormalized == "ASKERİYE" 
                          || customerInvoiceTypeNormalized == "MUAF"
                          || customerCode.EndsWith("-3")
                          || targetAccountType == "ASKERIYE");

        bool isOpenCustomer = !isFaturaAccount && (isAskeriye 
                              || customerInvoiceTypeNormalized == "ACIK" 
                              || customerInvoiceTypeNormalized == "AÇIK"
                              || customerInvoiceTypeNormalized.Contains("ACIK")
                              || customerInvoiceTypeNormalized.Contains("AÇIK")
                              || customerCode.EndsWith("-2")
                              || targetAccountType == "ACIK");

        /*
          MUAF FATURA "ASKERIYE" DAMGALANIR (2026-08-29 kullanici karari).

          Damga belgenin NITELIGIDIR: muaf satis, KDV'li satistan farkli bir seydir ve
          kayitta oyle durmalidir. Once "FATURA" damgalamak denendi (rapordan dusmesin
          diye), kullanici dogru olani istedi: damga gercegi soylesin, rapor ona uysun.

          BUNUN SARTI VAR: Muhasebe Satis Raporu'nun ana suzgeci yalnizca "FATURA"
          damgasini aliyordu; ayni degisiklikte suzgec ASKERIYE/MUAF'i da kabul edecek
          sekilde genisletildi (AccountingSalesReportController). Ikisi AYRILMAZ - biri
          digeri olmadan uygulanirsa muaf faturalar rapordan kaybolur.

          Askeriye kontrolu ONCE yapilmak zorunda: `isOpenCustomer` askeriyeyi de
          kapsiyor, sirasi degisirse muaf fatura "ACIK" damgalanir.
        */
        var customerInvoiceTypeOverride = isAskeriye ? "ASKERIYE" : (isOpenCustomer ? "ACIK" : "FATURA");

        /*
          3. FATURA NUMARASI — MUAF/ASKERİYE DE ELLE GİRİLİR (2026-08-29 kullanıcı bildirimi:
          "askeri tekliflerde yani muaflarda aynı normal fatura gibi fatura no girilmesi
          lazımdı").

          Eskiden `isOpenCustomer` açık cari ile muaf/askeriyeyi AYNI kefeye koyuyordu ve
          ikisine de otomatik numara üretiliyordu. Muaf müşteri (askeri birlik) ise resmi
          numaralı belge istiyor.

          BUNUN GÖRÜNMEYEN BEDELİ VARDI: numara girebilmek için personel muaf işi -3 yerine
          -1 (Resmi Fatura) hesabına aktarıyordu. Denetimdeki A1 bulgusu tam olarak bu:
          `A00000000071295` — askeri cariye kesilmiş, -1 hesabında duran, KDV'si 0 fatura.
          -1 hesabı KDV'li olmak zorunda olduğu için o kayıt her denetimde alarm veriyor.
          Kapı açılınca kaçak yol da gereksizleşiyor.

          Açık cari (-2) davranışı DEĞİŞMEDİ: orada otomatik numara doğru olandır.
        */
        string invoiceNo;
        if (isOpenCustomer && !isAskeriye)
        {
            // Açık Hesap: serie "1", otomatik numara oluştur
            var openSerie = "1";
            if (request.InvoiceNumber.HasValue && request.InvoiceNumber.Value > 0)
            {
                invoiceNo = openSerie + request.InvoiceNumber.Value.ToString().PadLeft(14, '0');
            }
            else
            {
                // ATOMİK NUMARATÖR (denetim md. 224): eskiden bütün açık hesap fatura
                // numaraları RAM'e çekilip en büyüğü +1 ediliyordu; aynı anda fatura kesen iki
                // kullanıcı AYNI numarayı alıp ikincisi tekil indeks hatasıyla düşüyordu.
                invoiceNo = await B2B.Erp.Api.Core.Helpers.OpenInvoiceNumberAllocator.NextAsync(
                    _dbContext, openSerie, cancellationToken);
            }
        }
        else
        {
            // Resmi Fatura VE Muaf/Askeriye: serie (örn: "A") ve numara el ile zorunlu
            var serie = (request.InvoiceSerie ?? string.Empty).Trim().ToUpperInvariant();
            var faturaSerie = string.IsNullOrWhiteSpace(serie) ? "A" : serie;
            if (faturaSerie.Length > 2) faturaSerie = faturaSerie.Substring(0, 2);

            if (!request.InvoiceNumber.HasValue || request.InvoiceNumber.Value <= 0 || request.InvoiceNumber.Value > 99999999999999L)
            {
                var hesapAdi = isAskeriye ? "Muaf / Askeriye" : "Fatura tipi";
                return BadRequest(new { success = false, message = $"{hesapAdi} müşteriler için fatura numarası el ile girilmelidir (1 ile 99999999999999 arasında)." });
            }

            invoiceNo = faturaSerie + request.InvoiceNumber.Value.ToString().PadLeft(15 - faturaSerie.Length, '0');
        }

        var exists = await _dbContext.Set<Invoice>()
            .AsNoTracking()
            .AnyAsync(x => x.InvoiceNo == invoiceNo, cancellationToken);

        if (exists)
        {
            return Conflict(new { success = false, message = $"Fatura no ({invoiceNo}) zaten mevcut." });
        }

        var usdRate = await _money.GetLatestTryRateAsync("USD", cancellationToken);
        var eurRate = await _money.GetLatestTryRateAsync("EUR", cancellationToken);
        var gbpRate = await _money.GetLatestTryRateAsync("GBP", cancellationToken);

        // ELLE GİRİLEN KUR: aktarım penceresindeki kur çubuğunda kullanıcı bir kuru
        // değiştirdiyse, o para birimi için günün TCMB kuru yerine onunki geçerlidir.
        // Kalem TL karşılıkları, fatura başlığının `ExchangeRate` alanı ve cari hareketi
        // hepsi aşağıda bu üç değişkenden besleniyor; tek yerden ezmek yeterli.
        // Pencere kurları TCMB'den doldurulup ekranda gösterildiği için istek gövdesinde
        // kur DEĞİŞTİRİLMEMİŞ olsa da gelir. "Manuel" damgası bu yüzden alanın dolu
        // olmasına değil, TCMB kurundan FARKLI olmasına bakıyor.
        static bool IsOverridden(decimal? requested, decimal tcmbRate)
            => requested.HasValue && requested.Value > 0m && Math.Abs(requested.Value - tcmbRate) > 0.000001m;

        var isUsdRateManual = IsOverridden(request.UsdRate, usdRate);
        var isEurRateManual = IsOverridden(request.EurRate, eurRate);
        var isGbpRateManual = IsOverridden(request.GbpRate, gbpRate);

        if (request.UsdRate.HasValue && request.UsdRate.Value > 0m) usdRate = request.UsdRate.Value;
        if (request.EurRate.HasValue && request.EurRate.Value > 0m) eurRate = request.EurRate.Value;
        if (request.GbpRate.HasValue && request.GbpRate.Value > 0m) gbpRate = request.GbpRate.Value;

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var now = DateTime.UtcNow;
        var username = User.FindFirst(ClaimTypes.Name)?.Value ?? "";
        if (string.IsNullOrWhiteSpace(username)) username = "System";

        // Teklifin para birimi ve o günkü TCMB kuru
        var offerCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(offer.CurrencyTypeId);
        var offerRate = offerCurrencyTypeId switch
        {
            3 => usdRate, // USD
            2 => eurRate, // EUR
            4 => gbpRate, // GBP
            _ => 1m       // TRY
        };
        if (offerRate <= 0m) offerRate = 1m;

        // Hedef carinin para birimi
        var customerCurrencyTypeId = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(targetCustomer?.CurrencyTypeId ?? 1);
        var customerTryRate = customerCurrencyTypeId switch
        {
            3 => usdRate,
            2 => eurRate,
            4 => gbpRate,
            _ => 1m
        };
        if (customerTryRate <= 0m) customerTryRate = 1m;

        var isCustomerFx = customerCurrencyTypeId > 1;

        var offerProductIds = offer.Lines
            .Select(x => x.ProductId)
            .Where(x => x != Guid.Empty)
            .Distinct()
            .ToList();

        var lineCurrencyByProductId = await _dbContext.Products
            .AsNoTracking()
            .Where(p => offerProductIds.Contains(p.Id))
            .Select(p => new { p.Id, p.SalesCurrencyCode })
            .ToDictionaryAsync(
                x => x.Id,
                x => B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(x.SalesCurrencyCode),
                cancellationToken);

        // Depo Seçimi: Başlık Deposu ve Satır Bazlı Depolar
        var requestedWarehouseCode = request.WarehouseCode.HasValue && request.WarehouseCode.Value != 0
            ? request.WarehouseCode.Value
            : 0;

        var defaultWarehouseCodeRaw = User.FindFirst("DefaultWarehouseCode")?.Value;
        var defaultUserWarehouseCode = int.TryParse(defaultWarehouseCodeRaw, out var dwc) ? dwc : 0;

        var headerWarehouseCode = requestedWarehouseCode != 0 ? requestedWarehouseCode : defaultUserWarehouseCode;
        if (headerWarehouseCode == 0)
        {
            headerWarehouseCode = await _dbContext.Warehouses
                .AsNoTracking()
                .Where(x => x.IsActive)
                .OrderBy(x => x.WarehouseCode)
                .Select(x => x.WarehouseCode)
                .FirstOrDefaultAsync(cancellationToken);
        }

        var lineWarehouseMap = new Dictionary<int, int>();
        if (request.LineWarehouses != null && request.LineWarehouses.Count > 0)
        {
            foreach (var lw in request.LineWarehouses)
            {
                if (lw.LineId > 0 && lw.WarehouseCode > 0)
                {
                    lineWarehouseMap[lw.LineId] = lw.WarehouseCode;
                }
            }
        }

        // Fatura kalemlerini oluştur.
        //
        // ⚠️ FATURA BAŞLIĞI VE `InvoiceLine.UnitPrice` DAİMA TL TUTAR SAKLAR; belgenin kendi
        // parasındaki değer `CurrencyUnitPrice`ta durur. Kural sistem geneli
        // (`AccountingSalesReportController`, `CariSatisReportController` ve basım bunu
        // varsayıyor) ama BU YOL uymuyordu: teklifin dolar fiyatı hem `UnitPrice`a hem
        // `CurrencyUnitPrice`a aynen yazılıyor, başlık toplamları da dolar kalıyordu.
        // Sonuçları: 1.500 $'lık fatura muhasebe raporunda 1.500 TL görünüyor, stok
        // hareketinin birim fiyatı dolar oluyor, basım TL sanıp kura bölerek 31,30 yazıyordu.
        // Artık TL'ye çevrilerek yazılıyor; dövizli tutarlar `doc*` değişkenlerinde paralel
        // yürüyor ve `CurrencyUnitPrice` ile cari hareketinin `CurrencyAmount`una gidiyor.
        var invoiceLines = new List<InvoiceLine>();
        var invoiceSubtotal = 0m;
        var invoiceDiscount = 0m;
        var invoiceNetTotal = 0m;
        var invoiceVatTotal = 0m;

        // Belgenin kendi parasındaki karşılıkları (cari hareketi ve dövizli raporlar için).
        var docSubtotal = 0m;
        var docDiscount = 0m;
        var docNetTotal = 0m;
        var docVatTotal = 0m;

        var lineCurrencies = new HashSet<int>();

        // TEK FATURA = TEK PARA BİRİMİ = TEK KUR. Fatura başlığı bir tane `CurrencyTypeId` ve
        // bir tane `ExchangeRate` taşır; karışık dövizli bir teklif aktarıldığında başlık
        // kalemlerden birine (ya da TL'ye) düşüyor, diğer kalemler başka bir kurla hesaplanmış
        // oluyordu — aynı belgede iki kur. Karıştırmaya izin verilmediği kullanıcı kararı
        // (sepet kuralıyla aynı), o yüzden sessiz bir varsayım yerine açık hata veriliyor.
        var allLineCurrencies = new HashSet<int>();

        for (int idx = 0; idx < offer.Lines.Count; idx++)
        {
            var l = offer.Lines.ElementAt(idx);

            var lineCurrencyTypeId = l.CurrencyTypeId > 0
                ? B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(l.CurrencyTypeId)
                : (lineCurrencyByProductId.TryGetValue(l.ProductId, out var lineCur)
                    ? lineCur
                    : offerCurrencyTypeId);

            if (lineCurrencyTypeId > 1)
            {
                lineCurrencies.Add(lineCurrencyTypeId);
            }

            allLineCurrencies.Add(lineCurrencyTypeId);

            var lineRate = lineCurrencyTypeId switch
            {
                3 => usdRate,
                2 => eurRate,
                4 => gbpRate,
                _ => 1m
            };
            if (lineRate <= 0m) lineRate = 1m;

            // Teklifin kalemi KENDİ para biriminde; fatura TL saklayacağı için birim fiyat
            // önce çevrilir, ardından bütün kalem matematiği TL üzerinde yürür (sipariş
            // yolundaki desenin aynısı: yuvarlanmış TL birim fiyat × miktar).
            var unitPriceDoc = l.UnitPrice;
            var isLineForeign = lineCurrencyTypeId > 1;
            var unitPrice = isLineForeign
                ? Math.Round(unitPriceDoc * lineRate, 2, MidpointRounding.AwayFromZero)
                : unitPriceDoc;

            var lineBase = l.Quantity * unitPrice;
            var lineBaseDoc = l.Quantity * unitPriceDoc;

            decimal DiscountOf(decimal baseAmount, decimal amountValue)
                => l.DiscountType switch
                {
                    // TUTAR İNDİRİMİ ADET BAŞINADIR (2026-08-22 kullanıcı kuralı) — bkz. ComputeTotals.
                    CustomerOfferLineDiscountType.Amount => Math.Max(0m, amountValue) * l.Quantity,
                    CustomerOfferLineDiscountType.Percentage => Math.Max(0m, baseAmount * (l.DiscountValue / 100m)),
                    _ => 0m
                };

            // Tutar tipi indirim de teklifin parasında girilmiştir; TL tarafı için çevrilir.
            var discountDoc = DiscountOf(lineBaseDoc, l.DiscountValue);
            var discount = DiscountOf(
                lineBase,
                isLineForeign ? Math.Round(l.DiscountValue * lineRate, 2, MidpointRounding.AwayFromZero) : l.DiscountValue);

            if (discount > lineBase) discount = lineBase;
            if (discountDoc > lineBaseDoc) discountDoc = lineBaseDoc;

            var lineNet = lineBase - discount;
            var lineNetDoc = lineBaseDoc - discountDoc;
            var vatFree = isAskeriye || isOpenCustomer || offer.VatExempt;
            var vat = vatFree ? 0m : (lineNet * (l.VatRate / 100m));
            var vatDoc = vatFree ? 0m : (lineNetDoc * (l.VatRate / 100m));

            invoiceSubtotal += lineBase;
            invoiceDiscount += discount;
            invoiceNetTotal += lineNet;
            invoiceVatTotal += vat;

            docSubtotal += lineBaseDoc;
            docDiscount += discountDoc;
            docNetTotal += lineNetDoc;
            docVatTotal += vatDoc;

            var lineWarehouseCode = lineWarehouseMap.TryGetValue(l.Id, out var customLw) && customLw > 0
                ? customLw
                : headerWarehouseCode;

            invoiceLines.Add(new InvoiceLine
            {
                SalesOrderLineId = null,
                StockCode = l.StockCode,
                Description = l.Description,
                Quantity = l.Quantity,
                UnitPrice = unitPrice,
                CurrencyTypeId = lineCurrencyTypeId,
                CurrencyRate = lineRate,
                CurrencyUnitPrice = unitPriceDoc,
                VatRate = (isAskeriye || isOpenCustomer || offer.VatExempt) ? 0m : l.VatRate,
                WarehouseCode = lineWarehouseCode,
                LineNo = idx + 1,
                CreateUser = username,
                CreateTime = now,
                EditUser = null,
                EditTime = null
            });
        }

        if (allLineCurrencies.Count > 1)
        {
            var codes = allLineCurrencies
                .OrderBy(x => x)
                .Select(B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyTypeIdToCode);

            return BadRequest(new
            {
                success = false,
                message = $"Bu proformada farklı para birimlerinde kalemler var ({string.Join(", ", codes)}). "
                          + "Bir fatura tek para birimi ve tek kur taşır; kalemleri para birimine göre ayırıp ayrı proforma olarak aktarın."
            });
        }

        var invoiceGrandTotal = invoiceSubtotal - invoiceDiscount + invoiceVatTotal;
        var docGrandTotal = docSubtotal - docDiscount + docVatTotal;

        int finalInvoiceCurrencyTypeId = 0;
        decimal finalInvoiceExchangeRate = 1m;

        if (offerCurrencyTypeId > 1)
        {
            finalInvoiceCurrencyTypeId = offerCurrencyTypeId;
            finalInvoiceExchangeRate = offerRate;
        }
        else if (lineCurrencies.Count == 1)
        {
            finalInvoiceCurrencyTypeId = lineCurrencies.First();
            finalInvoiceExchangeRate = finalInvoiceCurrencyTypeId switch
            {
                3 => usdRate,
                2 => eurRate,
                4 => gbpRate,
                _ => 1m
            };
        }
        else if (isCustomerFx)
        {
            finalInvoiceCurrencyTypeId = customerCurrencyTypeId;
            finalInvoiceExchangeRate = customerTryRate;
        }

        // Kur nereden geldi: belgenin para birimindeki kuru kullanıcı elle girdiyse "Manuel".
        var isFinalRateManual = finalInvoiceCurrencyTypeId switch
        {
            3 => isUsdRateManual,
            2 => isEurRateManual,
            4 => isGbpRateManual,
            _ => false
        };

        var invoice = new Invoice
        {
            Type = InvoiceType.SalesInvoice,
            SourceCustomerOfferId = offer.Id,
            InvoiceNo = invoiceNo,
            CustomerCode = customerCode,
            CustomerNameOverride = offer.MuhtelifCustomer != null ? $"[{offer.MuhtelifCustomer.CustomerCode.Trim()}] {offer.MuhtelifCustomer.Name.Trim()}" : null,
            CustomerInvoiceTypeOverride = customerInvoiceTypeOverride,
            DeliveryCustomerCode = offer.DeliveryCustomerCode ?? customerCode,
            Date = now,
            VatIncluded = false,
            Subtotal = invoiceSubtotal,
            Discount = invoiceDiscount,
            NetTotal = invoiceNetTotal,
            VatTotal = invoiceVatTotal,
            GrandTotal = invoiceGrandTotal,
            CampaignDiscount = 0m,
            CampaignDetailsJson = null,
            SalesmanCode = offer.SalesmanCode,
            Description = offer.Description,
            CurrencyTypeId = finalInvoiceCurrencyTypeId,
            ExchangeRate = finalInvoiceExchangeRate > 0m ? finalInvoiceExchangeRate : 1m,
            RateSource = finalInvoiceCurrencyTypeId > 0 ? (isFinalRateManual ? "Manuel" : "TCMB") : null,
            InstallationName = null,
            InstallationPhone = null,
            CreateUser = username,
            CreateTime = now,
            EditUser = null,
            EditTime = null
        };

        try
        {
            _dbContext.Set<Invoice>().Add(invoice);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex)
        {
            var msg = ex.InnerException?.Message ?? ex.Message;
            return BadRequest(new { success = false, message = $"Fatura oluşturulamadı: {msg}" });
        }

        foreach (var il in invoiceLines)
        {
            il.InvoiceId = invoice.Id;
        }

        try
        {
            _dbContext.Set<InvoiceLine>().AddRange(invoiceLines);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex)
        {
            var msg = ex.InnerException?.Message ?? ex.Message;
            return BadRequest(new { success = false, message = $"Fatura kalemleri oluşturulamadı: {msg}" });
        }

        var discountRatio = offer.Subtotal > 0 ? (offer.DiscountTotal / offer.Subtotal) : 0m;
        if (discountRatio < 0m) discountRatio = 0m;
        if (discountRatio > 1m) discountRatio = 1m;

        var customerParentCode = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.CustomerCode == customerCode)
            .Select(x => x.ParentCustomerCode)
            .FirstOrDefaultAsync(cancellationToken);

        // Satır bazlı depo hareketleri
        var movements = invoiceLines
            .OrderBy(x => x.LineNo)
            .Select(l => new StockMovement
            {
                InvoiceNo = invoice.InvoiceNo,
                CustomerCode = invoice.CustomerCode ?? string.Empty,
                DeliveryCustomerCode = invoice.DeliveryCustomerCode ?? string.Empty,
                StockCode = l.StockCode,
                Direction = StockMovementDirection.Out,
                Quantity = l.Quantity,
                UnitPrice = l.UnitPrice,
                // Stok hareketi TL çapası; belgenin parası ayrı kolonlarda (2026-08-19).
                CurrencyTypeId = l.CurrencyTypeId,
                CurrencyRate = l.CurrencyRate <= 0m ? 1m : l.CurrencyRate,
                CurrencyUnitPrice = l.CurrencyUnitPrice > 0m ? l.CurrencyUnitPrice : l.UnitPrice,
                NetUnitPrice = l.UnitPrice * (1m - discountRatio),
                VatRate = l.VatRate,
                InstallationId = null,
                BagNo = string.Empty,
                SalesmanCode = invoice.SalesmanCode,
                WarehouseCode = l.WarehouseCode ?? headerWarehouseCode,
                Delivered = false,
                Date = DateTime.SpecifyKind(now.Date, DateTimeKind.Utc),
                LineNo = l.LineNo,
                CustomerParentCode = customerParentCode,
                CreateUser = username,
                CreateTime = now
            })
            .ToList();

        if (movements.Count > 0)
        {
            _dbContext.Set<StockMovement>().AddRange(movements);
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        // Depo bazında stok kontrolü
        var outByWarehouseAndStockCode = invoiceLines
            .Where(x => !string.IsNullOrWhiteSpace(x.StockCode))
            .GroupBy(x => new { WarehouseCode = x.WarehouseCode ?? headerWarehouseCode, StockCode = x.StockCode.Trim() })
            .ToDictionary(g => g.Key, g => g.Sum(x => x.Quantity));

        if (outByWarehouseAndStockCode.Count > 0)
        {
            var distinctWarehouses = outByWarehouseAndStockCode.Keys.Select(k => k.WarehouseCode).Distinct().ToList();
            var warehouseLookup = await _dbContext.Warehouses
                .AsNoTracking()
                .Where(w => distinctWarehouses.Contains(w.WarehouseCode))
                .ToDictionaryAsync(w => w.WarehouseCode, w => w.NegativeBalanceControl, cancellationToken);

            var allStockCodes = outByWarehouseAndStockCode.Keys.Select(k => k.StockCode).Distinct().ToList();

            var balances = await _dbContext.Set<StockMovement>()
                .AsNoTracking()
                .Where(x => distinctWarehouses.Contains(x.WarehouseCode) && allStockCodes.Contains(x.StockCode))
                .GroupBy(x => new { x.WarehouseCode, x.StockCode })
                .Select(g => new
                {
                    g.Key.WarehouseCode,
                    g.Key.StockCode,
                    balance = g.Where(x => x.Direction == StockMovementDirection.In).Sum(x => x.Quantity)
                              - g.Where(x => x.Direction == StockMovementDirection.Out).Sum(x => x.Quantity)
                })
                .ToListAsync(cancellationToken);

            var balanceLookup = balances.ToDictionary(b => new { b.WarehouseCode, StockCode = b.StockCode.ToUpperInvariant() }, b => b.balance);

            foreach (var item in outByWarehouseAndStockCode)
            {
                var whCode = item.Key.WarehouseCode;
                var sc = item.Key.StockCode;
                var qty = item.Value;

                if (qty % 1m != 0m)
                {
                    return BadRequest(new { success = false, message = $"Stok düşümü için miktar tam sayı olmalıdır: {sc}. Miktar: {qty}" });
                }

                var outQty = (int)qty;
                if (outQty <= 0) continue;

                var checkNegativeStock = !warehouseLookup.TryGetValue(whCode, out var negControl) || negControl;
                var available = balanceLookup.TryGetValue(new { WarehouseCode = whCode, StockCode = sc.ToUpperInvariant() }, out var b) ? b : 0m;
                if (checkNegativeStock && available - outQty < 0)
                {
                    return BadRequest(new { success = false, message = $"Yetersiz stok: {sc}. Depo: {whCode}. Mevcut: {available}, Çıkış: {outQty}" });
                }
            }
        }

        var details = new
        {
            customerOfferId = offer.Id,
            proformaDocumentNo = offer.ProformaDocumentNo,
            invoiceId = invoice.Id,
            invoiceNo = invoice.InvoiceNo,
            targetCustomerCode = customerCode,
            lineCount = invoiceLines.Count
        };

        _dbContext.Set<DeletionLog>().Add(new DeletionLog
        {
            ModuleKey = "invoice",
            PageKey = "proforma",
            RecordType = "ProformaToInvoice",
            RecordId = offer.Id.ToString(),
            ParentType = "Fatura",
            ParentId = invoice.Id.ToString(),
            Description = $"Proformadan satış faturası oluşturuldu: {offer.ProformaDocumentNo} -> {invoice.InvoiceNo} (Cari: {customerCode})",
            DetailsJson = JsonSerializer.Serialize(details),
            CreateUser = username,
            CreateTime = now
        });

        // Cari Hareket Kaydı (CustomerLedgerEntry)
        // `Amount` TL ÇAPASI, `CurrencyAmount` belgenin kendi parası. Başlık artık TL sakladığı
        // için burada bir daha kurla ÇARPILMAZ — eskiden dolar tutar çarpılıyordu ve doğru
        // TL değeri veriyordu; şimdi zaten TL geliyor, çarpım 48 kat şişirirdi.
        var ledgerCurrencyTypeId = finalInvoiceCurrencyTypeId > 0 ? finalInvoiceCurrencyTypeId : 1;
        var ledgerCurrencyRate = finalInvoiceExchangeRate > 0m ? finalInvoiceExchangeRate : 1m;
        var ledgerAmountTry = invoice.GrandTotal;
        var ledgerCurrencyAmount = ledgerCurrencyTypeId > 1 ? docGrandTotal : invoice.GrandTotal;

        _dbContext.CustomerLedgerEntries.Add(new CustomerLedgerEntry
        {
            CustomerCode = customerCode,
            Date = now,
            DueDate = now,
            Direction = CustomerLedgerEntryDirection.Debit,
            Amount = ledgerAmountTry,
            CurrencyTypeId = ledgerCurrencyTypeId,
            CurrencyRate = ledgerCurrencyRate,
            CurrencyAmount = ledgerCurrencyAmount,
            PaymentCurrencyTypeId = ledgerCurrencyTypeId,
            PaymentCurrencyRate = ledgerCurrencyRate,
            PaymentCurrencyAmount = ledgerCurrencyAmount,
            DocumentNo = invoice.InvoiceNo,
            Description = string.IsNullOrWhiteSpace(invoice.Description) ? "Faturamız" : invoice.Description,
            TransactionType = "Satış Faturası",
            DeliveryCustomerCode = invoice.DeliveryCustomerCode ?? customerCode,
            ReferenceType = CustomerLedgerEntryReferenceType.Invoice,
            ReferenceId = invoice.Id,
            CreateUser = username,
            CreateTime = now
        });

        await _dbContext.SaveChangesAsync(cancellationToken);
        await tx.CommitAsync(cancellationToken);

        return Ok(new { success = true, data = new { id = invoice.Id, invoiceNo = invoice.InvoiceNo } });
    }

    [AtomicRequest]
    [HttpDelete("{id:int}")]
    [AuthorizePage("invoice", "musteriTeklifiSil")]
    public async Task<IActionResult> Delete([FromRoute] int id, CancellationToken cancellationToken)
    {
        if (id <= 0)
        {
            return BadRequest(new { success = false, message = "Geçersiz id" });
        }

        var offer = await _dbContext.CustomerOffers
            .Include(x => x.Lines)
            .Include(x => x.MuhtelifCustomer)
            .FirstOrDefaultAsync(x => x.Id == id, cancellationToken);

        if (offer is null)
        {
            return NotFound(new { success = false, message = "Teklif bulunamadı" });
        }

        // KİMLİK KAPISI: liste süzgeci burada geçmiyor, teklifin sahipliği ayrıca sorulmalı.
        var offerAccessError = await BuildOfferAccessErrorAsync(offer, cancellationToken);
        if (offerAccessError is not null) return offerAccessError;

        if (!string.IsNullOrEmpty(offer.ProformaDocumentNo))
        {
            var hasInvoice = await _dbContext.Set<Invoice>()
                .AsNoTracking()
                .AnyAsync(x => x.SourceCustomerOfferId == offer.Id, cancellationToken);

            if (hasInvoice)
            {
                return BadRequest(new { success = false, message = "Bu teklife ait proforma faturaya aktarıldığı için silinemez." });
            }
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
            offer.SalesmanCode,
            offer.Description,
            offer.CreateUser,
            offer.CreateTime,
            MuhtelifCustomer = offer.MuhtelifCustomer != null ? new
            {
                offer.MuhtelifCustomer.OwnerCustomerCode,
                offer.MuhtelifCustomer.CustomerCode,
                offer.MuhtelifCustomer.Name,
                offer.MuhtelifCustomer.City,
                offer.MuhtelifCustomer.District,
                offer.MuhtelifCustomer.Address,
                offer.MuhtelifCustomer.Phone,
                offer.MuhtelifCustomer.Email,
                offer.MuhtelifCustomer.TaxOffice,
                offer.MuhtelifCustomer.TaxNumber,
                offer.MuhtelifCustomer.CreateUser,
                offer.MuhtelifCustomer.CreateTime
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
            PageKey = "musteriTeklifiSil",
            RecordType = "MusteriTeklifi",
            RecordId = offer.Id.ToString(),
            ParentType = null,
            ParentId = null,
            Description = $"Müşteri teklifi silindi: {offer.DocumentNo}. [Etki: Müşteri teklifi silindi.]",
            DetailsJson = JsonSerializer.Serialize(backupData),
            CreateUser = username,
            CreateTime = DateTime.UtcNow
        });

        var muhtelifId = offer.MuhtelifCustomerId;

        _dbContext.CustomerOffers.Remove(offer);
        await _dbContext.SaveChangesAsync(cancellationToken);

        if (muhtelifId.HasValue)
        {
            // MUHTELİF CARİ BAŞKA BELGEDE KULLANILIYORSA SİLİNMEZ. Teklif silinince muhtelif
            // kart koşulsuz siliniyordu: aynı muhtelif müşteriye verilmiş İKİNCİ bir teklif ya
            // da ona bağlanmış bir alış faturası varsa o belgeler sahipsiz kalıyor, açılmak
            // istendiğinde patlıyordu. Kart yalnızca son belgesiyle birlikte gider.
            var stillReferenced =
                await _dbContext.CustomerOffers
                    .AsNoTracking()
                    .AnyAsync(x => x.Id != offer.Id && x.MuhtelifCustomerId == muhtelifId.Value, cancellationToken)
                || await _dbContext.Set<PurchaseInvoice>()
                    .AsNoTracking()
                    .AnyAsync(x => x.MuhtelifCustomerId == muhtelifId.Value, cancellationToken);

            var muhtelif = stillReferenced
                ? null
                : await _dbContext.MuhtelifCustomers
                    .FirstOrDefaultAsync(x => x.Id == muhtelifId.Value, cancellationToken);

            if (muhtelif is not null)
            {
                _dbContext.MuhtelifCustomers.Remove(muhtelif);
                await _dbContext.SaveChangesAsync(cancellationToken);
            }
        }

        return Ok(new { success = true });
    }

    private void ComputeTotals(CustomerOffer offer)
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
        var maxDocNo = await _dbContext.CustomerOffers
            .AsNoTracking()
            .Where(x => x.DocumentNo.StartsWith("MT") && x.DocumentNo.Length == 15)
            .OrderByDescending(x => x.DocumentNo)
            .Select(x => x.DocumentNo)
            .FirstOrDefaultAsync(cancellationToken);

        long max = 0;
        if (maxDocNo != null && maxDocNo.Length == 15)
        {
            var tail = maxDocNo.Substring(2); // "MT" is 2 chars
            long.TryParse(tail, out max);
        }

        var next = max + 1;
        return "MT" + next.ToString().PadLeft(13, '0');
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
        if (!string.IsNullOrWhiteSpace(customerCode))
        {
            var customer = await _dbContext.Customers
                .AsNoTracking()
                .Where(x => x.CustomerCode == customerCode)
                .Select(x => new { x.CustomerCode, x.PriceGroupId })
                .FirstOrDefaultAsync(cancellationToken);

            if (customer is not null)
            {
                var defaultPg = await _dbContext.PriceGroups
                    .AsNoTracking()
                    .Where(x => x.IsActive)
                    .OrderBy(x => x.SortOrder)
                    .ThenBy(x => x.Code)
                    .Select(x => (Guid?)x.Id)
                    .FirstOrDefaultAsync(cancellationToken);

                return (customer.PriceGroupId ?? defaultPg, customer.CustomerCode);
            }
        }

        var defaultPriceGroupId = await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.Code)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);

        return (defaultPriceGroupId, null);
    }

    /// <summary>
    /// Muhtelif (kayıtlı carisi olmayan) müşteriye kesilen teklifin fiyat grubu.
    /// Kullanıcı kararı (2026-08-11): <b>1 numaralı grup</b>.
    ///
    /// Eskiden burada grubun KODUNA değil sıradaki YERİNE bakılıyordu (`Skip(3)` = "sırada
    /// dördüncü olan"). Grup eklenip çıkarıldığında ya da sıralama değiştiğinde sessizce başka
    /// bir gruba kayıyordu ve kardeşi `CariOffersController` koda bakarken bu ikisi
    /// birbirinden farklı grup seçebiliyordu. Artık ikisi de aynı kodu arıyor.
    /// </summary>
    private async Task<Guid?> ResolveMuhtelifPriceGroup(CancellationToken cancellationToken)
    {
        var target = await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(x => x.IsActive && x.Code == MuhtelifPriceGroupCode)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (target.HasValue) return target;

        var fallback = await _dbContext.PriceGroups
            .AsNoTracking()
            .Where(x => x.IsActive)
            .OrderBy(x => x.SortOrder)
            .ThenBy(x => x.Code)
            .Select(x => (Guid?)x.Id)
            .FirstOrDefaultAsync(cancellationToken);

        return fallback;
    }

    private async Task<string> GenerateNextProformaNo(CancellationToken cancellationToken)
    {
        const string key = "PROFORMA";

        await using var tx = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

        var series = await _dbContext.NumberSeries
            .FirstOrDefaultAsync(x => x.Key == key, cancellationToken);

        if (series is null)
        {
            var existing = await _dbContext.CustomerOffers
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

        // Move to the next available number in a single call.
        // This avoids requiring the UI to retry when LastValue points to an already-used proforma no.
        while (true)
        {
            series.LastValue += 1;
            var candidate = "P" + series.LastValue.ToString().PadLeft(14, '0');

            var exists = await _dbContext.CustomerOffers
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

    private sealed record OfferProductInfo(
        Guid Id,
        string StockCode,
        string Name,
        int TaxRate,
        bool IsActive,
        int ProductCurrencyCode);

    private static readonly System.Globalization.CultureInfo TrCulture = new("tr-TR");

    /// <summary>
    /// Teklif satırları için ürün bilgisi. Satışa açıklık (IsActive) ve satırın para birimi
    /// buradan gelir; para birimi ürünün SATIŞ dövizi (<c>SalesCurrencyCode</c>), o TL ise
    /// fiyat satırının para birimidir. ALIŞ dövizi (<c>CurrencyCode</c>) hiç okunmaz.
    /// </summary>
    private async Task<List<OfferProductInfo>> LoadOfferProducts(List<Guid> productIds, CancellationToken cancellationToken)
    {
        var rows = await _dbContext.Products
            .AsNoTracking()
            .Where(x => productIds.Contains(x.Id))
            .Select(x => new
            {
                x.Id,
                x.StockCode,
                x.Name,
                x.TaxRate,
                x.IsActive,
                x.SalesCurrencyCode,
                SellingCurrency = x.ProductPrices.Select(pp => pp.Currency).FirstOrDefault()
            })
            .ToListAsync(cancellationToken);

        return rows
            .Select(x =>
            {
                // `SalesOrdersController`'daki kuralın aynısı: çapa `SalesCurrencyCode`,
                // fiyat satırı yalnızca çapa TL iken yedek. ALIŞ dövizine düşmek TL bir
                // teklifi kurla çarpıp limiti boşuna doldururdu ([[urun-satis-dovizi-tuzagi]]).
                var anchor = CurrencyTypeHelper.Normalize(x.SalesCurrencyCode);
                var currencyCode = !CurrencyTypeHelper.IsTry(anchor)
                    ? anchor
                    : ProductCurrencyHelper.MapCurrencyStringToProductCurrencyCode(x.SellingCurrency, anchor);

                return new OfferProductInfo(x.Id, x.StockCode, x.Name, x.TaxRate, x.IsActive, currencyCode);
            })
            .ToList();
    }

    private static ActionResult? BuildInactiveProductsError(List<OfferProductInfo> products)
    {
        var inactive = products.Where(x => !x.IsActive).ToList();
        if (inactive.Count == 0) return null;

        var labels = inactive
            .Select(x => string.IsNullOrWhiteSpace(x.Name) ? x.StockCode : $"{x.StockCode} - {x.Name}")
            .ToList();

        return new BadRequestObjectResult(new
        {
            success = false,
            code = "PRODUCT_NOT_SELLABLE",
            message = labels.Count == 1
                ? $"Satışa kapalı ürün teklife eklenemez: {labels[0]}"
                : $"Satışa kapalı ürünler teklife eklenemez: {string.Join(", ", labels)}",
            data = new { stockCodes = inactive.Select(x => x.StockCode).ToList() }
        });
    }

    /// <summary>
    /// Teklifin KDV dahil toplamı, TEKLİFİN KENDİ para biriminde. Kur kullanılmaz —
    /// kredi limiti para birimi başına ayrı yürüdüğü için çevrime gerek yok.
    /// </summary>
    private static decimal ComputeOfferGrandTotal(CustomerOffer offer)
    {
        var total = 0m;

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

            total += lineNet + vat;
        }

        return total;
    }

    /// <summary>
    /// Teklif de siparişle aynı limit havuzunu tüketir. Muhtelifte ortada cari olmadığı için
    /// kontrol uygulanmaz.
    /// </summary>
    private async Task<ActionResult?> BuildCreditLimitError(
        string? customerCode,
        CustomerOffer offer,
        IReadOnlyDictionary<Guid, int> productCurrencyCodeById,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(customerCode)) return null;

        // LİMİT TEKLİFİN KENDİ PARASINDA ÖLÇÜLÜR (2026-08-19).
        //
        // Önceden toplam kurla TL'ye çevrilip tek TL limitine yazılıyordu. Artık her para
        // biriminin kendi limiti var, dolayısıyla çevirmek hem gereksiz hem yanlış: aynı
        // dolar teklifi kur değiştikçe farklı limit tüketiyordu. Kalemler karışık dövizliyse
        // (teklifin başlığı TL kalır) toplam da TL sayılır — başlıkla tutarlı davranış.
        var offerCurrency = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(offer.CurrencyTypeId);
        var grandTotalInOfferCurrency = ComputeOfferGrandTotal(offer);
        var evaluation = await _creditLimitService.EvaluateAsync(
            customerCode,
            grandTotalInOfferCurrency,
            offerCurrency,
            cancellationToken);

        switch (evaluation.Status)
        {
            case CreditLimitStatus.Exceeded:
            {
                var required = evaluation.RequiredPayment;
                var suffix = required > 0m
                    ? $" Teklif verebilmek için {required.ToString("N2", TrCulture)} {evaluation.CurrencySymbol} kadar ödeme yapılması gerekiyor."
                    : string.Empty;

                return new BadRequestObjectResult(new
                {
                    success = false,
                    code = "CREDIT_LIMIT_EXCEEDED",
                    message = "Limitiniz yetersiz." + suffix,
                    data = new
                    {
                        customerCode = evaluation.CustomerCode,
                        creditLimit = evaluation.CreditLimit,
                        currencyTypeId = evaluation.CurrencyTypeId,
                        currencySymbol = evaluation.CurrencySymbol,
                        balance = evaluation.Balance,
                        exposureBalance = evaluation.ExposureBalance,
                        openOrdersRisk = evaluation.OpenOrdersRisk,
                        openInvoicesRisk = evaluation.OpenInvoicesRisk,
                        offerTotal = evaluation.DocumentTotal,
                        projected = evaluation.Projected
                    }
                });
            }

            case CreditLimitStatus.SchemaOutdated:
                return new BadRequestObjectResult(new
                {
                    success = false,
                    code = "DB_SCHEMA_OUTDATED",
                    message = "Teklif limit kontrolü için veritabanı şeması güncel değil. Lütfen migration'ları uygulayıp tekrar deneyin.",
                    data = new
                    {
                        customerCode = evaluation.CustomerCode,
                        sqlState = evaluation.SqlState,
                        error = evaluation.Error
                    }
                });

            case CreditLimitStatus.CalculationFailed:
                return new BadRequestObjectResult(new
                {
                    success = false,
                    code = "CREDIT_LIMIT_CALCULATION_FAILED",
                    message = "Teklif limit kontrolü hesaplanırken hata oluştu.",
                    data = new
                    {
                        customerCode = evaluation.CustomerCode,
                        errorType = evaluation.ErrorType,
                        error = evaluation.Error,
                        innerError = evaluation.InnerError
                    }
                });

            default:
                return null;
        }
    }

    /// <summary>
    /// Fiyatla birlikte fiyatın PARA BİRİMİNİ de döndürür (2026-08-17).
    /// Eskiden yalnız tutar dönüyordu: `ProductPrice.Currency` okunup atılıyor, dolarla
    /// satılan ürün teklife para birimsiz giriyor ve basımda carinin dövizinin simgesiyle
    /// basılıyordu. Fiyat hangi paradaysa teklif de o paradadır.
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
    /// Teklifin para birimini KALEMLERİNDEN belirler ve kuru o anda dondurur (2026-08-17).
    /// Carinin kartındaki döviz alanı kaldırıldı; teklif ürünün satış dövizindedir.
    ///
    /// <para>
    /// Eskiden istemci başlıkta bir para birimi seçiyor ve bu seçim <b>bütün kalemlerin</b>
    /// para birimini eziyordu: dolarla satılan bir ürün, ekrandaki "Para Birimi: TL" yüzünden
    /// TL teklif oluyordu. Kullanıcı kararı (2026-08-19): <b>teklifin parası ürünün satış
    /// dövizidir</b>, ekrandaki seçici kaldırıldı. Kalemin para birimi zaten fiyatın geldiği
    /// listeden geliyor (<c>ResolveUnitPrices</c>); burada yalnızca başlığa taşınır.
    /// </para>
    ///
    /// <para>
    /// Kalemler karışık para birimliyse başlık TL kalır — tek bir başlık para birimi taşındığı
    /// için başka seçenek yok; kalemlerin kendi para birimi bozulmaz.
    /// </para>
    /// </summary>
    private async Task ApplyOfferCurrencyAsync(CustomerOffer offer, CancellationToken cancellationToken)
    {
        var currencies = offer.Lines
            .Select(x => B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(x.CurrencyTypeId))
            .Distinct()
            .ToList();

        var currencyTypeId = currencies.Count == 1
            ? currencies[0]
            : B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try;

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
    /// `ProductPrice.Currency` / `CustomerProductPriceOverride.Currency` metnini
    /// sistemin tek kodlamasına çevirir (1=TRY 2=EUR 3=USD 4=GBP). Boş/tanınmayan değer TL.
    /// </summary>
    private static int MapSalesCurrency(string? currency)
    {
        return B2B.Erp.Api.Core.Helpers.ProductCurrencyHelper.MapCurrencyStringToCurrencyTypeId(currency);
    }
}
