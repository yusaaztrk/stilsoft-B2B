namespace Ecommerce.Api.Infrastructure.Data;

public sealed class Brand
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? LogoUrl { get; set; }
    public string? Description { get; set; }
    public DateTimeOffset UpdatedAtUtc { get; set; }
}
