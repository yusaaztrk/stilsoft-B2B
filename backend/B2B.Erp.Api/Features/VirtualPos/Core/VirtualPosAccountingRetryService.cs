using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

public sealed record AccountingRetrySummary(int Examined, int Posted, int StillPending);

public interface IVirtualPosAccountingRetryService
{
    /// <summary>
    /// Re-attempts posting for payments the bank captured but the ERP has not booked yet.
    /// Safe to call repeatedly: each payment goes through the idempotent finalizer.
    /// </summary>
    Task<AccountingRetrySummary> RetryPendingAccountingAsync(int maxBatchSize = 50, CancellationToken cancellationToken = default);
}

/// <summary>
/// Operational recovery for payments stuck in AccountingPending — typically because a POS
/// bank account or currency mapping was missing when the payment came in.
///
/// Deliberately not a scheduler. It is a controlled operation an administrator triggers once
/// the underlying data problem is fixed; running it on a timer would hide the problem rather
/// than surface it.
/// </summary>
public sealed class VirtualPosAccountingRetryService : IVirtualPosAccountingRetryService
{
    private readonly AppDbContext _dbContext;
    private readonly IVirtualPosAccountingService _accountingService;
    private readonly ILogger<VirtualPosAccountingRetryService> _logger;

    public VirtualPosAccountingRetryService(
        AppDbContext dbContext,
        IVirtualPosAccountingService accountingService,
        ILogger<VirtualPosAccountingRetryService> logger)
    {
        _dbContext = dbContext;
        _accountingService = accountingService;
        _logger = logger;
    }

    public async Task<AccountingRetrySummary> RetryPendingAccountingAsync(
        int maxBatchSize = 50,
        CancellationToken cancellationToken = default)
    {
        var batchSize = Math.Clamp(maxBatchSize, 1, 500);

        // Only payments the bank actually captured. A pending status without IsSuccess is
        // not a booking problem and must never be posted.
        var candidates = await _dbContext.VirtualPosTransactions
            .AsNoTracking()
            .Where(x => x.IsSuccess && x.Status == (int)VirtualPosPaymentStatus.AccountingPending)
            .OrderBy(x => x.CreateTime) // oldest first, so nothing starves
            .Take(batchSize)
            .Select(x => x.Id)
            .ToListAsync(cancellationToken);

        var posted = 0;

        foreach (var id in candidates)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var decision = await _accountingService.FinalizeAccountingAsync(id, cancellationToken);
            if (decision.Eligibility == AccountingEligibility.AlreadyPosted) posted++;
        }

        if (candidates.Count > 0)
        {
            _logger.LogInformation(
                "[VirtualPosAccountingRetry] Examined {Examined}, posted {Posted}.",
                candidates.Count, posted);
        }

        return new AccountingRetrySummary(candidates.Count, posted, candidates.Count - posted);
    }
}
