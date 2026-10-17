namespace Ecommerce.Api.Infrastructure.Data;

public sealed class EcommerceUser
{
    public Guid Id { get; set; }
    public string Email { get; set; } = string.Empty;
    public string FullName { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string Role { get; set; } = "Customer";
    public string PermissionsCsv { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public string? GoogleId { get; set; }
    public string? ProfilePictureUrl { get; set; }
    public DateTimeOffset CreatedAtUtc { get; set; }
}
