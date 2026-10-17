namespace B2B.Erp.Api.Entities;

public enum IrsaliyeStatus
{
    Beklemede = 0,
    Onaylandi = 1,
    SevkEdildi = 2
}

public sealed class Irsaliye : AuditableEntity
{
    public int Id { get; set; }

    public string IrsaliyeNo { get; set; } = string.Empty;

    public string CustomerCode { get; set; } = string.Empty;
    public Customer? Customer { get; set; }

    public Guid ProductId { get; set; }
    public Product? Product { get; set; }

    public decimal Quantity { get; set; }

    public decimal? ShippedQuantity { get; set; }

    public string? Description { get; set; }

    public DateTime Date { get; set; }

    public IrsaliyeStatus Status { get; set; } = IrsaliyeStatus.Beklemede;

    public int? TransferredSalesOrderId { get; set; }

    public string CreateUserRole { get; set; } = string.Empty;
}
