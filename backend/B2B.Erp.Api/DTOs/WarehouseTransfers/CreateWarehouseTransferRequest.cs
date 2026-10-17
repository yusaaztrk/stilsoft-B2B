using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.WarehouseTransfers;

public sealed class CreateWarehouseTransferRequest
{
    public DateTime? Date { get; set; }

    [StringLength(2000)]
    public string? Description { get; set; }

    [StringLength(2000)]
    public string? DeliveryAddress { get; set; }

    [Range(1, int.MaxValue)]
    public int FromWarehouseCode { get; set; }

    [Range(1, int.MaxValue)]
    public int ToWarehouseCode { get; set; }

    public bool IsConsignment { get; set; }

    [MinLength(1)]
    public List<CreateWarehouseTransferLineRequest> Lines { get; set; } = new();
}

public sealed class CreateWarehouseTransferLineRequest
{
    [Required]
    [StringLength(50)]
    public string StockCode { get; set; } = string.Empty;

    [Range(0.0001, 999999999)]
    public decimal Quantity { get; set; }
}
