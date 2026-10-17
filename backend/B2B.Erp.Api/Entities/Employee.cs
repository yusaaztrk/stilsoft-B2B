namespace B2B.Erp.Api.Entities;

public sealed class Employee : AuditableEntity
{
    public int Id { get; set; }

    public string EmployeeCode { get; set; } = string.Empty;

    public string FirstName { get; set; } = string.Empty;

    public string LastName { get; set; } = string.Empty;

    public string Mail { get; set; } = string.Empty;

    public string Tc { get; set; } = string.Empty;

    public string Phone { get; set; } = string.Empty;

    public string TaxNo { get; set; } = string.Empty;

    public string TaxOffice { get; set; } = string.Empty;

    public string? BankName { get; set; }

    public string? Iban { get; set; }

    /// <summary>
    /// Personelin mesai başlatabileceği konum. NULL ise aktif konumların herhangi birinden
    /// giriş yapabilir. QR ve yüz ile giriş bu alana bakarak geofence uygular.
    /// </summary>
    public int? LocationSettingId { get; set; }

    public string? Username { get; set; }

    public string? Password { get; set; }

    public DateTime? HireDate { get; set; }

    public DateTime? WorkPermitDay { get; set; }

    public decimal WorkPermitRenewalFee { get; set; }

    /// <summary>
    /// Maas KURUS tasir (denetim md. A6). Kolon <c>numeric(18,2)</c>.
    ///
    /// <c>int</c>ti: 2.500,50 maas 2.500'e yuvarlaniyordu; dovizli/kusuratli maasin
    /// kurus kismi her yazmada sessizce siliniyordu. Tablo IK servisiyle ORTAK —
    /// oradaki <c>Employee.Salary</c> de decimal olmak zorunda.
    /// </summary>
    public decimal Salary { get; set; }

    public int SalaryDay { get; set; }

    public decimal MealAmount { get; set; }

    public string? WorkType { get; set; }

    public bool IsActive { get; set; } = true;
}
