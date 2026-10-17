namespace B2B.Erp.Api.Entities;

public class Role
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public bool IsSuperAdmin { get; set; }

    /// <summary>
    /// Bu roldeki kullanıcılar kampanyalardan yararlanabilir mi.
    ///
    /// Kapatıldığında kampanya sadece gizlenmez, HİÇ UYGULANMAZ: sepette indirim oluşmaz,
    /// kampanya listeleri boş döner — kullanıcı için kampanya yokmuş gibi olur. Varsayılan
    /// açık; kullanıcı kararıyla (2026-08-11) yalnızca "Kurumsal" rolünde kapalı başlatıldı.
    /// </summary>
    public bool CampaignsEnabled { get; set; } = true;

    /// <summary>
    /// LİMİT AŞIMIYLA SİPARİŞ ONAYI (2026-10-14 kullanıcı isteği). Açıksa bu roldeki kullanıcı,
    /// Aktif Sepet Raporu'ndaki "Limit Aşımıyla Onayla" düğmesiyle kredi limiti yetmeyen bir
    /// carinin sepetini siparişe çevirebilir. Varsayılan KAPALI; sepetteki "Limitiniz yetersiz"
    /// engeli herkes için aynen durur. Süper Admin rolü ve SSA her zaman yetkilidir.
    /// </summary>
    public bool OverLimitApprovalEnabled { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    
    // Navigation property
    public ICollection<User> Users { get; set; } = new List<User>();
    public ICollection<RolePagePermission> PagePermissions { get; set; } = new List<RolePagePermission>();
}
