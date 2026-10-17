namespace B2B.Erp.Api.Entities;

public sealed class Tenant
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string DbName { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public bool IsEcommerceEnabled { get; set; } = false;

    public bool ServiceOpsEnabled { get; set; }
    public string? ServiceOpsDbName { get; set; }

    /// <summary>
    /// KURULUM TAMAMLANDI DAMGASI (2026-08-20 kullanıcı kararı, denetim md. E2).
    ///
    /// <para>
    /// Firma kurulumu tek işlem değil: önce master'a satır + global kullanıcı yazılır, SONRA
    /// veritabanları açılıp tabloları kurulur. Ortada bir yerde hata olursa (bağlantı koptu,
    /// DDL patladı) master'daki satır yerinde kalıyor ve firma listede <b>sapasağlam
    /// görünüyordu</b>; oysa veritabanı yarım. Kimse fark etmeden o firmaya kullanıcı atanıp
    /// giriş denenebiliyordu.
    /// </para>
    ///
    /// <para>
    /// Damga yalnızca bütün adımlar bittikten sonra vurulur. <c>null</c> = kurulum yarım
    /// kalmış demektir. <b>Otomatik DROP DATABASE YOK</b> — yarım da olsa içinde veri
    /// olabilir; karar yöneticinin, bu alan sadece durumu görünür kılar.
    /// </para>
    ///
    /// <para>
    /// Alan eklendiğinde MEVCUT firmalar toplu olarak damgalanır (hepsi kullanımda), yoksa
    /// çalışan sistem bir anda "hepsi yarım" gösterirdi.
    /// </para>
    /// </summary>
    public DateTime? SetupCompletedAt { get; set; }

    public string? LogoPath { get; set; }
    public string? HeaderGradientFrom { get; set; }
    public string? HeaderGradientTo { get; set; }
    public string? CampaignGradientFrom { get; set; }
    public string? CampaignGradientTo { get; set; }
    public string? CampaignTextColor { get; set; }

    public ICollection<GlobalUserTenant> GlobalUsers { get; set; } = new List<GlobalUserTenant>();
    public ICollection<TenantEnabledPage> EnabledPages { get; set; } = new List<TenantEnabledPage>();
}
