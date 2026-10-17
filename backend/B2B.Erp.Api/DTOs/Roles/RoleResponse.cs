namespace B2B.Erp.Api.Dtos.Roles;

public sealed class RoleResponse
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public bool IsSuperAdmin { get; set; }

    /// <summary>
    /// Bu roldeki kullanıcılar kampanyalardan yararlanabilir mi. Kapalıyken kampanya ne
    /// listelenir ne de uygulanır — o rol için kampanya yokmuş gibi olur.
    /// </summary>
    public bool CampaignsEnabled { get; set; } = true;
    public bool OverLimitApprovalEnabled { get; set; }
}
