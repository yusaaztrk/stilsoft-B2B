namespace B2B.Erp.Api.Entities;

public sealed class UserWarehouse
{
    public int UserId { get; set; }
    public User User { get; set; } = null!;

    public int WarehouseCode { get; set; }
    public Warehouse Warehouse { get; set; } = null!;
}
