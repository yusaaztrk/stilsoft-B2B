using System;

namespace B2B.Erp.Api.Entities;

public sealed class CustomerProductCategory
{
    public string CustomerCode { get; set; } = string.Empty;
    public Customer Customer { get; set; } = null!;

    public Guid ProductCategoryId { get; set; }
    public ProductCategory ProductCategory { get; set; } = null!;
}
