namespace B2B.Erp.Api.Entities;

public sealed class Branch : AuditableEntity
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;

    public ICollection<User> Users { get; set; } = new List<User>();
}
