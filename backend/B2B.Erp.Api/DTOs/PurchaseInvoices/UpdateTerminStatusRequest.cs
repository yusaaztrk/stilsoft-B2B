using B2B.Erp.Api.Entities;
using System.Collections.Generic;

namespace B2B.Erp.Api.Dtos.PurchaseInvoices;

public sealed class UpdateTerminStatusRequest
{
    public int Status { get; set; }
    public List<LineWarehouseSelectionDto>? LineWarehouses { get; set; }
}

public sealed class LineWarehouseSelectionDto
{
    public int LineId { get; set; }
    public int WarehouseCode { get; set; }
}
