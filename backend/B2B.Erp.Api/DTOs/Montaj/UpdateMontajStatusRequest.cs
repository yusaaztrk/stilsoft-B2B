using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.DTOs.Montaj;

public sealed class UpdateMontajStatusRequest
{
    [Required]
    public string? Status { get; set; }

    public bool ForceOverride { get; set; }
}
