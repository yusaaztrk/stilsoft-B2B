namespace B2B.Erp.Api.Entities;

public sealed class Employee : AuditableEntity
{
    public int Id { get; set; }

    public string? EmployeeCode { get; set; }
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public string? Mail { get; set; }
    public string? Tc { get; set; }
    public string? Phone { get; set; }
    public string? TaxNo { get; set; }
    public string? TaxOffice { get; set; }

    public string? BankName { get; set; }

    public string? Iban { get; set; }

    /// <summary>Banka Hesap Numarası (örn. 601625227)</summary>
    public string? BankAccountNo { get; set; }

    /// <summary>Müşteri Numarası (örn. 176143)</summary>
    public string? CustomerNo { get; set; }

    /// <summary>
    /// Personelin mesai başlatabileceği konum. NULL ise aktif konumların herhangi birinden
    /// giriş yapabilir — tek noktada çalışan firmada kimseyi ataması gerekmesin.
    /// </summary>
    public int? LocationSettingId { get; set; }

    public string? Username { get; set; }


    public string? Password { get; set; }

    public DateTime? HireDate { get; set; }

    /// <summary>
    /// Calisma izni BITIS (yenileme) tarihi.
    ///
    /// Alan tek bir "yenileme gunu" olarak tasarlanmisti; izin bir aralik oldugu icin
    /// baslangic <see cref="WorkPermitStartDate"/> ile ayrica tutulur. Mevcut veriyi
    /// bozmamak icin bu kolon bitis tarihi olarak korunuyor (panodaki "yaklasan yenileme"
    /// uyarisi da bu tarihe bakiyor).
    /// </summary>
    public DateTime? WorkPermitDay { get; set; }

    /// <summary>Calisma izni BASLANGIC tarihi.</summary>
    public DateTime? WorkPermitStartDate { get; set; }

    public decimal WorkPermitRenewalFee { get; set; }

    /// <summary>
    /// Maas KURUS tasir (denetim md. A6). Kolon <c>numeric(18,2)</c>.
    ///
    /// Tablo ERP ile ORTAK: kolon tipi orada degistirildi, bu varlik da decimal olmak
    /// zorunda — aksi halde IK tarafi ayni kolonu integer bekleyip hakedis motorunda
    /// dusordu.
    /// </summary>
    public decimal Salary { get; set; } = 50000m;

    public int SalaryDay { get; set; } = 1;

    public decimal MealAmount { get; set; } = 7000m;

    /// <summary>
    /// Bu personele yemek veriliyor mu? Firma bazı personele yemek verir, bazısına vermez —
    /// tamamen tercihe bağlı. Kapalıysa yemek hakedişi hesaplanmaz, tutar dolu olsa bile 0'dır.
    /// </summary>
    public bool HasMealAllowance { get; set; } = true;

    public string? WorkType { get; set; }

    /// <summary>
    /// Personelin bagli oldugu isyeri / sirket. Ayni tenant altinda birden fazla isyeri
    /// calisiyor (orn. "DEMO TİCARET LTD" ve "DEMO TİCARET LTD.-TEKNIK SERVIS");
    /// is turunden (WorkType) ayri tutulur.
    /// </summary>
    public string? Workplace { get; set; }

    // --- Kimlik bilgileri ---

    /// <summary>Pasaport numarasi. Yabanci uyruklu personelde kimlik yerine gecer.</summary>
    public string? PassportNo { get; set; }

    /// <summary>Uyruk (KKTC, TC, ...).</summary>
    public string? Nationality { get; set; }

    public DateTime? BirthDate { get; set; }

    public string? BirthPlace { get; set; }

    // --- Resmi kayit numaralari ---

    /// <summary>Ihtiyat Sandigi numarasi.</summary>
    public string? ProvidentFundNo { get; set; }

    /// <summary>Sosyal Sigorta numarasi.</summary>
    public string? SocialSecurityNo { get; set; }

    /// <summary>SSD numarasi.</summary>
    public string? SsdNo { get; set; }

    // --- Adres ---

    public string? Address { get; set; }

    /// <summary>Adres mahiyeti (adresin niteligi / aciklamasi).</summary>
    public string? AddressDetail { get; set; }

    public bool IsActive { get; set; } = true;

    /// <summary>Isten cikis tarihi. Kidem ve yillik izin hesabi bu tarihte durur.</summary>
    public DateTime? TerminationDate { get; set; }

    public string? TerminationReason { get; set; }

    /// <summary>Bagli oldugu is gunu (mesai) tanimi. Bos ise varsayilan tanim kullanilir.</summary>
    public int? WorkScheduleSettingId { get; set; }

    /// <summary>
    /// Yillik izin hakkinin elle belirlenmesi. Bos ise kidem yilina gore kanuni sure
    /// (1-5 yil 14, 5-15 yil 20, 15+ yil 26 gun) uygulanir.
    /// </summary>
    public int? AnnualLeaveOverrideDays { get; set; }

    public WorkScheduleSetting? WorkScheduleSetting { get; set; }
}
