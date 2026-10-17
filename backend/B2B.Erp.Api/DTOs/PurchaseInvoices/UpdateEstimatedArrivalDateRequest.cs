using System;

namespace B2B.Erp.Api.Dtos.PurchaseInvoices;

public sealed class UpdateEstimatedArrivalDateRequest
{
    public DateTime? EstimatedArrivalDate { get; set; }
}
