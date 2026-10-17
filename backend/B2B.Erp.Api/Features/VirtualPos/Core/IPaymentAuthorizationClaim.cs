using System;
using System.Threading;
using System.Threading.Tasks;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Features.VirtualPos.Core;

/// <summary>
/// Grants exactly one caller the right to send a second authorization for a payment.
///
/// Reading the status and then writing it back is not enough: two callbacks arriving
/// together can both read <c>ThreeDVerified</c> and both proceed, charging the cardholder
/// twice. The claim has to be decided by the database in a single statement.
/// </summary>
public interface IPaymentAuthorizationClaim
{
    /// <summary>
    /// Atomically moves the transaction from ThreeDVerified to AuthorizationPending.
    /// Returns true only for the caller that performed the transition; every other caller —
    /// including one racing in parallel — gets false and must not contact the bank.
    /// </summary>
    Task<bool> TryClaimAsync(Guid transactionId, CancellationToken cancellationToken = default);
}

public sealed class PaymentAuthorizationClaim : IPaymentAuthorizationClaim
{
    private readonly AppDbContext _dbContext;

    public PaymentAuthorizationClaim(AppDbContext dbContext) => _dbContext = dbContext;

    public async Task<bool> TryClaimAsync(Guid transactionId, CancellationToken cancellationToken = default)
    {
        // A single conditional UPDATE. PostgreSQL serialises the row, so of two concurrent
        // statements exactly one matches the WHERE clause and reports one affected row.
        var affected = await _dbContext.VirtualPosTransactions
            .Where(x => x.Id == transactionId && x.Status == (int)VirtualPosPaymentStatus.ThreeDVerified)
            .ExecuteUpdateAsync(
                s => s.SetProperty(x => x.Status, (int)VirtualPosPaymentStatus.AuthorizationPending),
                cancellationToken);

        return affected == 1;
    }
}
