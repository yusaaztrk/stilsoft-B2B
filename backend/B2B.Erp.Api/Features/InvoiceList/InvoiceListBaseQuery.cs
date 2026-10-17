using System.Security.Claims;
using B2B.Erp.Api.Core.Authorization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Features.InvoiceList;

/// <summary>Fatura Dökümü satırı — Fatura Takip de aynı satırı okur.</summary>
public sealed class InvoiceListRow
{
    public int Id { get; set; }
    public InvoiceType Type { get; set; }
    public int? SourceCustomerOfferId { get; set; }

    /// <summary>
    /// Doluysa belge bir ALIŞ faturasından türemiştir. `Type` tek başına yetmediği için
    /// (bkz. İşlem Tipi notu) TAMİR/HİZMET ayrımını bu alan yapar.
    /// </summary>
    public int? SourcePurchaseInvoiceId { get; set; }
    public string? CustomerNameOverride { get; set; }
    public string? CustomerInvoiceTypeOverride { get; set; }
    public DateTime Date { get; set; }
    public string InvoiceNo { get; set; } = string.Empty;
    public string CustomerCode { get; set; } = string.Empty;
    public string CustomerName { get; set; } = string.Empty;
    public string CustomerInvoiceType { get; set; } = string.Empty;
    public decimal Subtotal { get; set; }
    public decimal Discount { get; set; }
    public decimal CampaignDiscount { get; set; }
    public decimal NetTotal { get; set; }
    public decimal VatTotal { get; set; }
    public decimal GrandTotal { get; set; }
    // Belgenin kendi para birimi + fatura anındaki DONMUŞ kuru (fatura başlığında saklı).
    public int CurrencyTypeId { get; set; }
    public decimal ExchangeRate { get; set; }
    public string? SalesmanCode { get; set; }
    public string? SalesmanName { get; set; }
    public string CreateUser { get; set; } = string.Empty;
    public DateTime CreateTime { get; set; }
    public bool IsManuallyPaid { get; set; }
    public bool IsPriceOverridden { get; set; }
}

/// <summary>
/// FATURA DÖKÜMÜ'NÜN TEMEL SORGUSU — kim hangi faturayı görür (cari kapsamı + rolün tip
/// yetkileri + kalemi olan belge). Fatura Takip de bu listeyi okuyor (2026-09-15 kullanıcı
/// kararı: "fatura dökümünde gelen her şey"); kural tek yerde dursun ki iki ekran ayrışmasın.
/// Kod InvoicesController.GetInvoiceList içinden OLDUĞU GİBİ taşındı.
/// </summary>
public static class InvoiceListBaseQuery
{
    /// <returns>Kullanıcının hiç cari kapsamı yoksa <c>null</c> (boş liste).</returns>
    public static async Task<IQueryable<InvoiceListRow>?> BuildAsync(
        AppDbContext _dbContext,
        ClaimsPrincipal User,
        CancellationToken cancellationToken)
    {
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";

        // The scope may name several customers. It was read as a single code, so a user assigned
        // more than one matched none of them and saw an empty list.
        var scopeCodes = CustomerScope.Of(User);
        var isInternalUser = isSsa || CustomerScope.IsUnrestrictedFor(User);

        List<string>? allowedCustomerCodes = null;
        if (!isInternalUser && scopeCodes.Count > 0)
        {
            // Branches and the -1/-2/-3 sub-accounts come with the customer; invoices are
            // booked against the latter, so without them an assigned customer shows nothing.
            allowedCustomerCodes = await CustomerScope.ExpandAsync(
                _dbContext.Customers.AsNoTracking(), scopeCodes, cancellationToken);
        }

        if (!isInternalUser && scopeCodes.Count == 0)
        {
            return null;
        }

        var invoiceLinesQuery = _dbContext.Set<InvoiceLine>().AsNoTracking();

        var username = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("Username")?.Value
            ?? User.Identity?.Name;

        IQueryable<InvoiceListRow> baseQuery =
            from inv in _dbContext.Set<Invoice>().AsNoTracking()
            join cust in _dbContext.Customers.AsNoTracking() on inv.CustomerCode equals cust.CustomerCode into custJoin
            from cust in custJoin.DefaultIfEmpty()
            join parentCust in _dbContext.Customers.AsNoTracking() on cust.ParentCustomerCode equals parentCust.CustomerCode into parentJoin
            from parentCust in parentJoin.DefaultIfEmpty()
            join delCust in _dbContext.Customers.AsNoTracking() on inv.DeliveryCustomerCode equals delCust.CustomerCode into delCustJoin
            from delCust in delCustJoin.DefaultIfEmpty()
            join salesman in _dbContext.Salesmen.AsNoTracking() on inv.SalesmanCode equals salesman.SalesmanCode into salesmanJoin
            from salesman in salesmanJoin.DefaultIfEmpty()
            join muhtelif in _dbContext.Set<BayiMuhtelifCustomer>().AsNoTracking() on inv.CustomerCode equals muhtelif.CustomerCode into muhtelifJoin
            from muhtelif in muhtelifJoin.DefaultIfEmpty()
            join mCust in _dbContext.MuhtelifCustomers.AsNoTracking() on inv.CustomerCode equals mCust.CustomerCode into mCustJoin
            from mCust in mCustJoin.DefaultIfEmpty()
            join srcOffer in _dbContext.CustomerOffers.AsNoTracking() on inv.SourceCustomerOfferId equals srcOffer.Id into offerJoin
            from srcOffer in offerJoin.DefaultIfEmpty()
            join srcMuhtelif in _dbContext.MuhtelifCustomers.AsNoTracking() on srcOffer.MuhtelifCustomerId equals srcMuhtelif.Id into srcMuhtelifJoin
            from srcMuhtelif in srcMuhtelifJoin.DefaultIfEmpty()
            where invoiceLinesQuery.Any(l => l.InvoiceId == inv.Id)
            where isInternalUser 
               || (allowedCustomerCodes != null && allowedCustomerCodes.Contains(inv.CustomerCode))
               || (username != null && inv.CreateUser != null && EF.Functions.ILike(inv.CreateUser, username))
               || (muhtelif != null && muhtelif.OwnerCustomerCode != null && allowedCustomerCodes != null && allowedCustomerCodes.Contains(muhtelif.OwnerCustomerCode))
               || (mCust != null && mCust.OwnerCustomerCode != null && allowedCustomerCodes != null && allowedCustomerCodes.Contains(mCust.OwnerCustomerCode))
               || (srcMuhtelif != null && srcMuhtelif.OwnerCustomerCode != null && allowedCustomerCodes != null && allowedCustomerCodes.Contains(srcMuhtelif.OwnerCustomerCode))
            select new InvoiceListRow
            {
                Id = inv.Id,
                Type = inv.Type,
                SourceCustomerOfferId = inv.SourceCustomerOfferId,
                SourcePurchaseInvoiceId = inv.SourcePurchaseInvoiceId,
                CustomerNameOverride = inv.CustomerNameOverride,
                CustomerInvoiceTypeOverride = inv.CustomerInvoiceTypeOverride,
                Date = inv.Date,
                InvoiceNo = inv.InvoiceNo,
                CustomerCode = inv.CustomerCode ?? string.Empty,
                CustomerName = mCust != null
                    ? "[" + mCust.CustomerCode + "] " + mCust.Name
                    : (
                        srcMuhtelif != null
                            ? "[" + srcMuhtelif.CustomerCode + "] " + srcMuhtelif.Name
                            : (
                                muhtelif != null
                                    ? "[" + muhtelif.CustomerCode + "] " + muhtelif.Name
                                    : (
                                        delCust != null && delCust.ParentCustomerCode != null && delCust.ParentCustomerCode != ""
                                            ? "[" + delCust.CustomerCode + "] " + delCust.Name
                                            : (
                                                cust != null
                                                    ? "[" + cust.CustomerCode + "] " + cust.Name
                                                    : (
                                                        !string.IsNullOrWhiteSpace(inv.CustomerNameOverride)
                                                            ? (inv.CustomerNameOverride.StartsWith("[") ? inv.CustomerNameOverride : (string.IsNullOrWhiteSpace(inv.CustomerCode) ? inv.CustomerNameOverride : "[" + inv.CustomerCode + "] " + inv.CustomerNameOverride))
                                                            : (!string.IsNullOrWhiteSpace(inv.CustomerCode) ? inv.CustomerCode : string.Empty)
                                                    )
                                            )
                                    )
                            )
                    ),
                CustomerInvoiceType = inv.Type == InvoiceType.SalesInvoice
                    ? (
                        cust != null && cust.CustomerType.ToLower() != "mağaza" &&
                        cust.CustomerType.ToLower() != "magaza"
                            ? cust.InvoiceType
                            : string.Empty
                    )
                    : (cust != null ? cust.InvoiceType : string.Empty),
                Subtotal = inv.Subtotal,
                Discount = inv.Discount - inv.CampaignDiscount,
                CampaignDiscount = inv.CampaignDiscount,
                NetTotal = inv.NetTotal,
                VatTotal = inv.VatTotal,
                GrandTotal = inv.GrandTotal,
                CurrencyTypeId = inv.CurrencyTypeId,
                ExchangeRate = inv.ExchangeRate,
                SalesmanCode = inv.SalesmanCode,
                SalesmanName = salesman != null ? salesman.Description : null,
                CreateUser = inv.CreateUser,
                CreateTime = inv.CreateTime,
                IsManuallyPaid = inv.IsManuallyPaid,
                IsPriceOverridden = inv.IsPriceOverridden
            };

        // Fatura Dökümü lists invoices; it does not create them. The satisFatura*Gorsun keys
        // belong to the Satış Faturası screen, which decides what may be raised there, and were
        // being applied here as well — so every role without them (Kurumsal, Bayi, AltBayi,
        // Plasiyer, Muhasebe and the rest, i.e. all but SuperAdmin, Müdür and Yönetim) opened
        // this page to an empty list no matter which customers were assigned to them.
        //
        // Fatura Dökümü tip görünürlüğü rol yetkisidir. HİZMET ve TAMİR aynı enum değerini
        // kullandığı için ayrım SourcePurchaseInvoiceId ile yapılır.
        var allowedTypeKeys = await GetAllowedInvoiceListTypeKeysAsync(_dbContext, User, cancellationToken);
        if (allowedTypeKeys is { Count: 0 })
        {
            baseQuery = baseQuery.Where(x => false);
        }
        else if (allowedTypeKeys is not null)
        {
            var canSatis = allowedTypeKeys.Contains("faturaDokumTipSatis");
            var canTamir = allowedTypeKeys.Contains("faturaDokumTipTamir");
            var canIade = allowedTypeKeys.Contains("faturaDokumTipIade");
            var canAlis = allowedTypeKeys.Contains("faturaDokumTipAlis");
            var canHizmet = allowedTypeKeys.Contains("faturaDokumTipHizmet");

            baseQuery = baseQuery.Where(x =>
                (canSatis && x.Type == InvoiceType.SalesInvoice)
                || (canAlis && x.Type == InvoiceType.PurchaseInvoice)
                || (canIade && x.Type == InvoiceType.ReturnInvoice)
                || (canHizmet && x.Type == InvoiceType.ServiceInvoice && x.SourcePurchaseInvoiceId != null && x.SourcePurchaseInvoiceId > 0)
                || (canTamir && x.Type == InvoiceType.ServiceInvoice && (x.SourcePurchaseInvoiceId == null || x.SourcePurchaseInvoiceId <= 0)));
        }

        return baseQuery;
    }

    private static async Task<HashSet<string>?> GetAllowedInvoiceListTypeKeysAsync(AppDbContext _dbContext, ClaimsPrincipal User, CancellationToken cancellationToken)
    {
        var isSsa = User.FindFirst("IsSuperSuperAdmin")?.Value == "1";
        var isSuperAdmin = User.FindFirst("IsSuperAdmin")?.Value == "1";
        if (isSsa || isSuperAdmin) return null;

        var roleIdClaim = User.Claims
            .FirstOrDefault(c => string.Equals(c.Type, "RoleId", StringComparison.OrdinalIgnoreCase))?.Value;

        if (!int.TryParse(roleIdClaim, out var roleId)) return new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var wantedKeys = new[]
        {
            "faturaDokumTipSatis",
            "faturaDokumTipTamir",
            "faturaDokumTipIade",
            "faturaDokumTipAlis",
            "faturaDokumTipHizmet"
        };

        var grantedKeys = await _dbContext.RolePagePermissions
            .AsNoTracking()
            .Where(rpp => rpp.RoleId == roleId
                          && rpp.CanAccess
                          && rpp.Page.ModuleKey == "invoice"
                          && wantedKeys.Contains(rpp.Page.Key))
            .Select(rpp => rpp.Page.Key)
            .ToListAsync(cancellationToken);

        return grantedKeys.ToHashSet(StringComparer.OrdinalIgnoreCase);
    }
}
