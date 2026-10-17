namespace B2B.Erp.Api.Entities;

public sealed class WarehouseTransfer : AuditableEntity
{
    public int Id { get; set; }

    public string TransferNo { get; set; } = string.Empty;

    public DateTime Date { get; set; }

    public string? Description { get; set; }

    public string? DeliveryAddress { get; set; }

    public int FromWarehouseCode { get; set; }
    public Warehouse? FromWarehouse { get; set; }

    public int ToWarehouseCode { get; set; }
    public Warehouse? ToWarehouse { get; set; }

    public bool IsConsignment { get; set; }

    public List<WarehouseTransferLine> Lines { get; set; } = new();
}
