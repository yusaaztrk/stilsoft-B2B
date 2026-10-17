using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.Customers;

public sealed class UpdateCustomerPriceGroupRequest
{
    public Guid? PriceGroupId { get; set; }
}
