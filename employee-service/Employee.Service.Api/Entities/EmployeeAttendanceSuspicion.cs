namespace B2B.Erp.Api.Entities;

/// <summary>
/// Şüpheli mesai giriş/çıkışı (2026-10-16, sahte konum / Fake GPS tespiti).
///
/// <para>Tarayıcı, telefonda sahte konum uygulaması açık mı söyleyemez (bu bilgi yalnız yerel
/// uygulamaya verilir). Bu yüzden şüphe KAYDIN İZİNDEN çıkarılır — farklı günlerde birebir aynı
/// koordinat, bölge merkezinin tıpatıp kopyası, imkânsız hız, olağandışı hassasiyet. Kayıt
/// girişi/çıkışı ENGELLEMEZ; yöneticinin önüne düşer, o inceleyip "incelendi" işaretler.</para>
/// </summary>
public sealed class EmployeeAttendanceSuspicion
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }

    /// <summary>İlgili mesai kaydı (giriş ya da çıkışı bu satırda olan).</summary>
    public int? CheckInId { get; set; }

    /// <summary>"Giriş" / "Çıkış".</summary>
    public string EventKind { get; set; } = string.Empty;

    /// <summary>Kural kodu: ayni_koordinat, merkez_kopyasi, imkansiz_hiz, kusursuz_hassasiyet, dusuk_hassasiyet.</summary>
    public string RuleCode { get; set; } = string.Empty;

    /// <summary>Yöneticinin okuyacağı açıklama.</summary>
    public string Detail { get; set; } = string.Empty;

    /// <summary>"yuz" / "qr" / "mesaiyi-bitir".</summary>
    public string Source { get; set; } = string.Empty;

    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
    public double? Accuracy { get; set; }

    public DateTime CreateTime { get; set; } = DateTime.UtcNow;
    public string? ReviewedBy { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public string? ReviewNote { get; set; }
}
