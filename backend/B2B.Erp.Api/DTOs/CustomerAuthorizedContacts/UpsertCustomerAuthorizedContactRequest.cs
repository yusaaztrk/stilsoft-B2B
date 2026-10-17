using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.CustomerAuthorizedContacts;

public sealed class UpsertCustomerAuthorizedContactRequest
{
    [Required]
    [StringLength(50)]
    public string CustomerCode { get; set; } = null!;

    [Required]
    [StringLength(100)]
    public string FullName { get; set; } = null!;

    [StringLength(50)]
    [RegularExpression(B2B.Erp.Api.Core.Helpers.PhoneFormat.Pattern, ErrorMessage = B2B.Erp.Api.Core.Helpers.PhoneFormat.Message)]
    public string? Phone { get; set; }
}
