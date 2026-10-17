using B2B.Erp.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Core.Services;

public interface IPriceGroupMappingService
{
    bool IsOpenGroupCode(int code);
    bool IsInvoiceGroupCode(int code);
    int GetMappedInvoiceGroupCode(int openCode);
    int GetMappedOpenGroupCode(int invoiceCode);
    Task<Guid?> GetMappedInvoiceGroupIdAsync(Guid openPriceGroupId, CancellationToken cancellationToken = default);
    Task<Guid?> GetMappedOpenGroupIdAsync(Guid invoicePriceGroupId, CancellationToken cancellationToken = default);
}

public sealed class PriceGroupMappingService : IPriceGroupMappingService
{
    private readonly AppDbContext _dbContext;

    public PriceGroupMappingService(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public bool IsOpenGroupCode(int code)
    {
        return code is >= 4 and <= 6;
    }

    public bool IsInvoiceGroupCode(int code)
    {
        return code is >= 1 and <= 3 || code == 7;
    }

    public int GetMappedInvoiceGroupCode(int openCode)
    {
        return openCode switch
        {
            4 => 1,
            5 => 2,
            6 => 3,
            7 => 3,
            _ => openCode
        };
    }

    public int GetMappedOpenGroupCode(int invoiceCode)
    {
        return invoiceCode switch
        {
            1 => 4,
            2 => 5,
            3 => 6,
            _ => invoiceCode
        };
    }

    public async Task<Guid?> GetMappedInvoiceGroupIdAsync(Guid openPriceGroupId, CancellationToken cancellationToken = default)
    {
        var openGroup = await _dbContext.PriceGroups
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == openPriceGroupId, cancellationToken);

        if (openGroup is null) return null;

        var targetCode = GetMappedInvoiceGroupCode(openGroup.Code);
        var targetGroup = await _dbContext.PriceGroups
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Code == targetCode && x.IsActive, cancellationToken);

        return targetGroup?.Id;
    }

    public async Task<Guid?> GetMappedOpenGroupIdAsync(Guid invoicePriceGroupId, CancellationToken cancellationToken = default)
    {
        var invoiceGroup = await _dbContext.PriceGroups
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Id == invoicePriceGroupId, cancellationToken);

        if (invoiceGroup is null) return null;

        var targetCode = GetMappedOpenGroupCode(invoiceGroup.Code);
        var targetGroup = await _dbContext.PriceGroups
            .AsNoTracking()
            .FirstOrDefaultAsync(x => x.Code == targetCode && x.IsActive, cancellationToken);

        return targetGroup?.Id;
    }
}
