using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.DTOs.Montaj;

public sealed class CreateMontajRequest
{
    public string? DealerCode { get; set; }

    public string? DealerName { get; set; }

    [Required]
    public string? ProductName { get; set; }

    public decimal Quantity { get; set; } = 1;

    [Required]
    public string? CustomerName { get; set; }

    [Required]
    public string? Phone { get; set; }

    [Required]
    public string? Address { get; set; }

    [Required]
    public string? Region { get; set; }

    public string? Note { get; set; }

    public string? Type { get; set; }
}
