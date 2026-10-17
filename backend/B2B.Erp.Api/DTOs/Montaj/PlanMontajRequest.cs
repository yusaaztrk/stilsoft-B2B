using System;
using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.DTOs.Montaj;

public sealed class PlanMontajRequest
{
    [Required]
    public DateTime? PlannedDateUtc { get; set; }

    [Required]
    public string? Technician { get; set; }
}
