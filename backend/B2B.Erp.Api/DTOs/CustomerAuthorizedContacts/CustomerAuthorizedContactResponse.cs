namespace B2B.Erp.Api.Dtos.CustomerAuthorizedContacts;

public sealed class CustomerAuthorizedContactResponse
{
    public string CustomerCode { get; set; } = string.Empty;

    public string FullName { get; set; } = string.Empty;

    public string? Phone { get; set; }
}
