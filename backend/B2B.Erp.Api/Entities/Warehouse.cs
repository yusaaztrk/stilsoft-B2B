namespace B2B.Erp.Api.Entities;

public sealed class Warehouse : AuditableEntity
{
    public int WarehouseCode { get; set; }
    public string? Name { get; set; }

    public string? SalesmanCode { get; set; }

    public bool IsVehicle { get; set; }

    public string? Plate { get; set; }

    public string? DriverName { get; set; }

    public string? VehicleType { get; set; }

    public string? VehicleModel { get; set; }

    public bool NegativeBalanceControl { get; set; }
    public bool IsActive { get; set; } = true;
}
