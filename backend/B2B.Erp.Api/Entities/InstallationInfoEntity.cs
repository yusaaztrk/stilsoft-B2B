namespace B2B.Erp.Api.Entities;

public abstract class InstallationInfoEntity : AuditableEntity
{
    public string? InstallationName { get; set; }
    public string? InstallationPhone { get; set; }
}
