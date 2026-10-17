namespace B2B.Erp.Api.Entities;

public sealed class WarehouseTransferLine : AuditableEntity
{
    public int Id { get; set; }

    public int WarehouseTransferId { get; set; }
    public WarehouseTransfer? WarehouseTransfer { get; set; }

    public string StockCode { get; set; } = string.Empty;

    public decimal Quantity { get; set; }

    public int LineNo { get; set; }
}
