using System;
using System.Collections.Generic;

namespace ServiceOps.Domain.Entities;

public class ServiceProduct
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string? TenantCode { get; set; }

    public string Name { get; set; } = string.Empty;
    public string? StockCode { get; set; }

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public ICollection<ExplodedDiagram> ExplodedDiagrams { get; set; } = new List<ExplodedDiagram>();
    public ICollection<SparePart> SpareParts { get; set; } = new List<SparePart>();
}
