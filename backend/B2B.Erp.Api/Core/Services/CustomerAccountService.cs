using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

public interface ICustomerAccountService
{
    Task<Customer?> GetMainCustomerAsync(string customerCode, CancellationToken cancellationToken = default);
    Task<Customer?> GetInvoiceAccountAsync(string mainCustomerCode, CancellationToken cancellationToken = default);
    Task<Customer> EnsureInvoiceAccountCreatedAsync(Customer mainCustomer, CancellationToken cancellationToken = default);
    Task EnsureSubAccountsCreatedAsync(Customer mainCustomer, CancellationToken cancellationToken = default);
    Task SyncSubAccountUpperInfoAsync(Customer mainCustomer, CancellationToken cancellationToken = default);
    Task<string> ResolveTargetInvoiceCustomerCodeAsync(string customerCode, string? overrideInvoiceType = null, CancellationToken cancellationToken = default);
    Task<List<string>> GetRelatedCustomerCodesForLedgerAsync(string customerCode, CancellationToken cancellationToken = default);
}

public sealed class CustomerAccountService : ICustomerAccountService
{
    private readonly AppDbContext _dbContext;
    private readonly IPriceGroupMappingService _priceGroupMappingService;

    public CustomerAccountService(AppDbContext dbContext, IPriceGroupMappingService priceGroupMappingService)
    {
        _dbContext = dbContext;
        _priceGroupMappingService = priceGroupMappingService;
    }

    public async Task<Customer?> GetMainCustomerAsync(string customerCode, CancellationToken cancellationToken = default)
    {
        var code = (customerCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(code)) return null;

        var cust = await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == code, cancellationToken);

        if (cust is null) return null;

        if (!string.IsNullOrWhiteSpace(cust.MainCustomerCode))
        {
            return await _dbContext.Customers
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.CustomerCode == cust.MainCustomerCode, cancellationToken);
        }

        return cust;
    }

    public async Task<Customer?> GetInvoiceAccountAsync(string mainCustomerCode, CancellationToken cancellationToken = default)
    {
        var mainCode = (mainCustomerCode ?? string.Empty).Trim();
        mainCode = CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(mainCode);
        if (string.IsNullOrWhiteSpace(mainCode)) return null;

        var faturaCode = CustomerAccountHelper.BuildInvoiceAccountCode(mainCode);
        return await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == faturaCode || (x.MainCustomerCode == mainCode && x.AccountRole == CustomerAccountRole.InvoiceAccount), cancellationToken);
    }

    public async Task EnsureSubAccountsCreatedAsync(Customer mainCustomer, CancellationToken cancellationToken = default)
    {
        if (mainCustomer == null || string.IsNullOrWhiteSpace(mainCustomer.CustomerCode)) return;

        var mainCode = CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(mainCustomer.CustomerCode.Trim());
        
        // Determine customer type / price group
        var invType = (mainCustomer.InvoiceType ?? string.Empty).Trim().ToUpperInvariant();
        int? pgCode = null;
        if (mainCustomer.PriceGroupId.HasValue)
        {
            pgCode = await _dbContext.PriceGroups
                .AsNoTracking()
                .Where(x => x.Id == mainCustomer.PriceGroupId.Value)
                .Select(x => (int?)x.Code)
                .FirstOrDefaultAsync(cancellationToken);
        }

        bool isAskeriye = invType == "ASKERIYE" || invType == "ASKERİYE" || pgCode == 7;

        bool isAcik = !isAskeriye && (invType == "ACIK" || (pgCode.HasValue && pgCode.Value >= 4 && pgCode.Value <= 6));

        // Subaccount helper creator
        async Task CreateSubAccountIfNotExists(string subCode, string accountRole, string subInvType, Guid? subPgId)
        {
            var exists = await _dbContext.Customers.AnyAsync(x => x.CustomerCode == subCode, cancellationToken);
            if (!exists)
            {
                var subEntity = new Customer
                {
                    CustomerCode = subCode,
                    Name = mainCustomer.Name,
                    CustomerType = mainCustomer.CustomerType,
                    InvoiceType = subInvType,
                    AccountRole = accountRole,
                    MainCustomerCode = mainCode,
                    Address = mainCustomer.Address,
                    City = mainCustomer.City,
                    District = mainCustomer.District,
                    Phone = mainCustomer.Phone,
                    Fax = mainCustomer.Fax,
                    Email = mainCustomer.Email,
                    TaxOffice = mainCustomer.TaxOffice,
                    TaxNumber = mainCustomer.TaxNumber,
                    IdentityNumber = mainCustomer.IdentityNumber,
                    ProductCategory = mainCustomer.ProductCategory,
                    IsActive = mainCustomer.IsActive,
                    PriceGroupId = subPgId ?? mainCustomer.PriceGroupId,
                    DiscountRate = mainCustomer.DiscountRate,
                    SalesmanCode = mainCustomer.SalesmanCode,
                    CreditLimit = mainCustomer.CreditLimit,
                    ParentCustomerCode = mainCustomer.ParentCustomerCode,
                    CurrencyTypeId = mainCustomer.CurrencyTypeId,
                    CreateUser = mainCustomer.CreateUser,
                    CreateTime = DateTime.UtcNow
                };
                _dbContext.Customers.Add(subEntity);
            }
        }

        var faturaCode = CustomerAccountHelper.BuildInvoiceAccountCode(mainCode);
        var acikCode = CustomerAccountHelper.BuildOpenAccountCode(mainCode);
        var askeriyeCode = CustomerAccountHelper.BuildAskeriyeAccountCode(mainCode);

        Guid? mappedInvoicePgId = null;
        if (mainCustomer.PriceGroupId.HasValue)
        {
            mappedInvoicePgId = await _priceGroupMappingService.GetMappedInvoiceGroupIdAsync(mainCustomer.PriceGroupId.Value, cancellationToken);
        }

        await CreateSubAccountIfNotExists(faturaCode, CustomerAccountRole.InvoiceAccount, "FATURA", mappedInvoicePgId ?? mainCustomer.PriceGroupId);
        await CreateSubAccountIfNotExists(acikCode, CustomerAccountRole.OpenAccount, "ACIK", mainCustomer.PriceGroupId);
        await CreateSubAccountIfNotExists(askeriyeCode, CustomerAccountRole.AskeriyeAccount, "ASKERIYE", mainCustomer.PriceGroupId);

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<Customer> EnsureInvoiceAccountCreatedAsync(Customer mainCustomer, CancellationToken cancellationToken = default)
    {
        await EnsureSubAccountsCreatedAsync(mainCustomer, cancellationToken);
        var mainCode = CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(mainCustomer.CustomerCode.Trim());
        var faturaCode = CustomerAccountHelper.BuildInvoiceAccountCode(mainCode);
        var askeriyeCode = CustomerAccountHelper.BuildAskeriyeAccountCode(mainCode);

        var existing = await _dbContext.Customers
            .FirstOrDefaultAsync(x => x.CustomerCode == faturaCode || x.CustomerCode == askeriyeCode || x.MainCustomerCode == mainCode, cancellationToken);

        return existing ?? mainCustomer;
    }

    public async Task SyncSubAccountUpperInfoAsync(Customer mainCustomer, CancellationToken cancellationToken = default)
    {
        if (mainCustomer == null || string.IsNullOrWhiteSpace(mainCustomer.CustomerCode)) return;
        var mainCode = CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(mainCustomer.CustomerCode.Trim());

        var subAccounts = await _dbContext.Customers
            .Where(x => x.MainCustomerCode == mainCode && x.CustomerCode != mainCode)
            .ToListAsync(cancellationToken);

        if (subAccounts.Count == 0) return;

        // ANA CARİ "F" GRUBUNDA (kod 1-3) İKEN FATURA ALT HESABI (-1) BİR "A" GRUBUNDA (4-7)
        // KALMIŞSA HİZALA (2026-09-08).
        //
        // Doğru kurulmuş bir caride -1'in grubu ana ile eşlemelidir (bkz. GetMappedInvoiceGroupCode).
        // Ama import'tan gelen ya da ana grubu sonradan değiştirilen carilerde -1 "A" grubunda
        // kalabiliyor. O zaman fatura kesme (isNoVatCustomer) -1'i "muaf" sanıp KDV'yi 0'a
        // çekiyor, sipariş ise KDV'yi hesaplamış oluyor ve tahsil edilen KDV kayboluyor
        // (MEHMET KOYUNCU / 120-01-000848-1: ana grup 3, -1 grup 6 -> A00000000071671/74).
        //
        // YALNIZCA "ana F + -1 A" çelişkisi düzeltilir; -1 zaten bir F grubundaysa (ör.
        // bilerek farklı bir F grubu) DOKUNULMAZ. Muaf caride (ana 4-7) hiç girilmez —
        // onların -1'i mağaza/perakende faturası için F grubunda olabilir, bu doğrudur.
        var mainPgCode = mainCustomer.PriceGroupId.HasValue
            ? await _dbContext.PriceGroups.AsNoTracking()
                .Where(x => x.Id == mainCustomer.PriceGroupId.Value)
                .Select(x => (int?)x.Code)
                .FirstOrDefaultAsync(cancellationToken)
            : null;

        if (mainCustomer.PriceGroupId.HasValue && mainPgCode is >= 1 and <= 3)
        {
            var invoiceSub = subAccounts.FirstOrDefault(s =>
                s.AccountRole == CustomerAccountRole.InvoiceAccount || s.CustomerCode.EndsWith("-1"));

            if (invoiceSub != null && invoiceSub.PriceGroupId != mainCustomer.PriceGroupId)
            {
                var subPgCode = invoiceSub.PriceGroupId.HasValue
                    ? await _dbContext.PriceGroups.AsNoTracking()
                        .Where(x => x.Id == invoiceSub.PriceGroupId.Value)
                        .Select(x => (int?)x.Code)
                        .FirstOrDefaultAsync(cancellationToken)
                    : null;

                // -1 boşsa ya da "A" (4-7) grubundaysa ana grubuna çek. Zaten F ise elleme.
                if (subPgCode is null or (>= 4 and <= 7))
                {
                    invoiceSub.PriceGroupId = mainCustomer.PriceGroupId;
                }
            }
        }

        foreach (var sub in subAccounts)
        {
            sub.Name = mainCustomer.Name;
            sub.Address = mainCustomer.Address;
            sub.City = mainCustomer.City;
            sub.District = mainCustomer.District;
            sub.Phone = mainCustomer.Phone;
            sub.Fax = mainCustomer.Fax;
            sub.Email = mainCustomer.Email;
            sub.TaxOffice = mainCustomer.TaxOffice;
            sub.TaxNumber = mainCustomer.TaxNumber;
            sub.IdentityNumber = mainCustomer.IdentityNumber;
            sub.IsActive = mainCustomer.IsActive;
            sub.SalesmanCode = mainCustomer.SalesmanCode;
            sub.CreditLimit = mainCustomer.CreditLimit;
            sub.ParentCustomerCode = mainCustomer.ParentCustomerCode;
            sub.CurrencyTypeId = mainCustomer.CurrencyTypeId;
            sub.DiscountRate = mainCustomer.DiscountRate;
            sub.EditUser = mainCustomer.EditUser;
            sub.EditTime = DateTime.UtcNow;
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<string> ResolveTargetInvoiceCustomerCodeAsync(string customerCode, string? overrideInvoiceType = null, CancellationToken cancellationToken = default)
    {
        var code = (customerCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(code)) return string.Empty;

        // If the code is a branch, redirect to parent customer first!
        var branchCust = await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == code, cancellationToken);

        if (branchCust != null && !string.IsNullOrWhiteSpace(branchCust.ParentCustomerCode) &&
            (branchCust.CustomerType == "sube" || branchCust.CustomerType == "şube" || code.StartsWith("01-")))
        {
            code = branchCust.ParentCustomerCode.Trim();
        }

        var mainCode = CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(code);
        var cust = await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == mainCode || x.CustomerCode == code, cancellationToken);

        if (cust is null) return code;

        await EnsureSubAccountsCreatedAsync(cust, cancellationToken);

        var askeriyeCode = CustomerAccountHelper.BuildAskeriyeAccountCode(mainCode);
        var faturaCode = CustomerAccountHelper.BuildInvoiceAccountCode(mainCode);
        var acikCode = CustomerAccountHelper.BuildOpenAccountCode(mainCode);

        var normOverride = (overrideInvoiceType ?? string.Empty).Trim().ToUpperInvariant();
        if (normOverride == "FATURA")
        {
            var faturaExists = await _dbContext.Customers.AnyAsync(x => x.CustomerCode == faturaCode, cancellationToken);
            if (faturaExists) return faturaCode;
        }
        else if (normOverride == "ACIK" || normOverride == "AÇIK")
        {
            var acikExists = await _dbContext.Customers.AnyAsync(x => x.CustomerCode == acikCode, cancellationToken);
            if (acikExists) return acikCode;
        }
        else if (normOverride == "ASKERIYE" || normOverride == "ASKERİYE" || normOverride == "MUAF")
        {
            var askeriyeExists = await _dbContext.Customers.AnyAsync(x => x.CustomerCode == askeriyeCode, cancellationToken);
            if (askeriyeExists) return askeriyeCode;
        }

        int? pgCode = null;
        if (cust.PriceGroupId.HasValue)
        {
            pgCode = await _dbContext.PriceGroups
                .AsNoTracking()
                .Where(x => x.Id == cust.PriceGroupId.Value)
                .Select(x => (int?)x.Code)
                .FirstOrDefaultAsync(cancellationToken);
        }

        var invType = (cust.InvoiceType ?? string.Empty).Trim().ToUpperInvariant();
        bool isAskeriye = invType == "ASKERIYE" || invType == "ASKERİYE" || pgCode == 7;
        bool isAcik = !isAskeriye && (invType == "ACIK" || (pgCode.HasValue && pgCode.Value >= 4 && pgCode.Value <= 6));

        if (isAskeriye)
        {
            var askeriyeExists = await _dbContext.Customers.AnyAsync(x => x.CustomerCode == askeriyeCode, cancellationToken);
            if (askeriyeExists) return askeriyeCode;
        }
        else if (isAcik)
        {
            var acikExists = await _dbContext.Customers.AnyAsync(x => x.CustomerCode == acikCode, cancellationToken);
            if (acikExists) return acikCode;

            var faturaExists = await _dbContext.Customers.AnyAsync(x => x.CustomerCode == faturaCode, cancellationToken);
            if (faturaExists) return faturaCode;
        }
        else
        {
            var faturaExists = await _dbContext.Customers.AnyAsync(x => x.CustomerCode == faturaCode, cancellationToken);
            if (faturaExists) return faturaCode;
        }

        return cust.CustomerCode;
    }

    public async Task<List<string>> GetRelatedCustomerCodesForLedgerAsync(string customerCode, CancellationToken cancellationToken = default)
    {
        var result = new List<string>();
        var code = (customerCode ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(code)) return result;

        // If the code is a branch, redirect to parent customer first!
        var branchCust = await _dbContext.Customers
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.CustomerCode == code, cancellationToken);

        if (branchCust != null && !string.IsNullOrWhiteSpace(branchCust.ParentCustomerCode) &&
            (branchCust.CustomerType == "sube" || branchCust.CustomerType == "şube" || code.StartsWith("01-")))
        {
            code = branchCust.ParentCustomerCode.Trim();
        }

        var mainCode = CustomerAccountHelper.GetMainCodeFromInvoiceAccountCode(code);
        result.Add(mainCode);

        var subCodes = await _dbContext.Customers
            .AsNoTracking()
            .Where(x => x.MainCustomerCode == mainCode || x.ParentCustomerCode == mainCode || x.CustomerCode == mainCode + "-1" || x.CustomerCode == mainCode + "-2" || x.CustomerCode == mainCode + "-3")
            .Select(x => x.CustomerCode)
            .ToListAsync(cancellationToken);

        foreach (var c in subCodes)
        {
            if (!result.Contains(c)) result.Add(c);
        }

        return result;
    }
}
