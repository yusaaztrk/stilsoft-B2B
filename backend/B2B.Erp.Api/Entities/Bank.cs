namespace B2B.Erp.Api.Entities;

public sealed class Bank
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string TcmbCode { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;
}
