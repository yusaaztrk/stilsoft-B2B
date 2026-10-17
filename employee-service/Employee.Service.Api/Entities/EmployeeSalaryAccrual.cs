namespace B2B.Erp.Api.Entities;

/// <summary>
/// TANIMLANMIŞ maaş hakedişi — personelin o dönem için firmadan alacağının doğduğu kayıt.
///
/// <para>Kullanıcı kararı (2026-08-18): cari ekstredeki maaş alacağı <b>yalnızca</b> bu tablodan
/// doğar. Bir süre ekstre, mesai kaydı olmayan aylarda personelin aylık maaşının tamamını
/// otomatik alacak yazıyordu; 12 ay geriye bakan bir ekstrede hiç çalışmamış personel için bile
/// milyonluk hayali borç çıkıyordu. Hesaplanan hakediş artık yalnızca <b>öneri</b>dir
/// (<see cref="CalculatedAmount"/>); ekstreye düşen tutar kullanıcının tanımladığıdır.</para>
///
/// <para>Tanımlama ile ÖDEME ayrı şeydir: bu kayıt borcu doğurur (alacak), ödeme
/// <see cref="EmployeePayment"/> ile kasadan çıkar (borç). Ağustos hakedişi 31 Ağustos'ta
/// tanımlanıp 2 Eylül'de ödenebilir; ödeme tarihi hakedişin dönemini değiştirmez.</para>
///
/// <para>Dönem başına personel başına TEK kayıt: aynı dönem yeniden tanımlanırsa tutar
/// güncellenir, ikinci bir alacak satırı doğmaz.</para>
/// </summary>
public sealed class EmployeeSalaryAccrual : AuditableEntity
{
    public int Id { get; set; }

    public int EmployeeId { get; set; }

    /// <summary>Dönem "yyyy-MM" (örn. "2026-08").</summary>
    public string Period { get; set; } = string.Empty;

    /// <summary>Ekstreye alacak yazılan tutar — kullanıcının onayladığı değer.</summary>
    public decimal Amount { get; set; }

    /// <summary>Tanımlama anında sistemin hesapladığı hakediş. Sadece iz amaçlı; ekstreye girmez.</summary>
    public decimal CalculatedAmount { get; set; }

    /// <summary>Tanımlama anında düşülen avans toplamı (iz amaçlı).</summary>
    public decimal DeductedAdvances { get; set; }

    public string? Description { get; set; }

    /// <summary>İşlem referans numarası (örn. SAL-2026-08-000124).</summary>
    public string? ReferenceNo { get; set; }

    public Employee? Employee { get; set; }
}
