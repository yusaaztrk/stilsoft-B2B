using System.Threading;
using System.Threading.Tasks;

namespace B2B.Erp.Api.Features.Payment;

public interface IPaymentService
{
    PaymentCalculationResult Calculate(PaymentCalculationRequest request);
    Task<ProcessPaymentResult> ProcessInvoicePaymentAsync(ProcessInvoicePaymentRequest request, string username, CancellationToken cancellationToken = default);
    Task<ProcessPaymentResult> CancelInvoicePaymentAsync(int invoiceId, string username, CancellationToken cancellationToken = default);
}
