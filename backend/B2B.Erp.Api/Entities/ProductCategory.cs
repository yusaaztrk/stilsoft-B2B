using System;
using System.Collections.Generic;

namespace B2B.Erp.Api.Entities;

public sealed class ProductCategory
{
    public Guid Id { get; set; }

    public Guid? ParentId { get; set; }
    public ProductCategory? Parent { get; set; }

    public string Key { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    public bool IsActive { get; set; } = true;

    public int SortOrder { get; set; } = 0;

    public ICollection<ProductCategory> Children { get; set; } = new List<ProductCategory>();
}
