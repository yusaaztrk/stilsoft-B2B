using B2B.Erp.Api.Core.Services;
﻿using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.Employees;

public sealed class EmployeePaymentListItemResponse
{
    public int Id { get; set; }
    public int EmployeeId { get; set; }
    public EmployeePaymentType Type { get; set; }
    public decimal Amount { get; set; }
    public DateTime PaymentDate { get; set; }
    public string? Description { get; set; }
    public bool DeductFromSalary { get; set; }
    public DateTime? SalaryDeductedAt { get; set; }
    public string? SalaryPeriod { get; set; }
    public string CreateUser { get; set; } = string.Empty;
    public DateTime CreateTime { get; set; }

    // Rapor ekranlari "kimin adina ne yapilmis" gostermek zorunda; her satir icin ayrica
    // calisan sorgulamak yerine ad ve kod burada donuyor.
    public string EmployeeName { get; set; } = string.Empty;
    public string EmployeeCode { get; set; } = string.Empty;
}

public sealed class CreateEmployeePaymentRequest
{
    /// <summary>B2B kasa/banka kaynağı (2026-09-27). Doluysa seçilen hesaba tek "Personel Ödemesi" satırı yazılır.</summary>
    public ErpPaymentSource? ErpSource { get; set; }

    [Required]
    public int EmployeeId { get; set; }

    [Required]
    public EmployeePaymentType Type { get; set; }

    [Range(0.01, 999999999)]
    public decimal Amount { get; set; }

    public DateTime? PaymentDate { get; set; }

    public bool DeductFromSalary { get; set; }

    [StringLength(2000)]
    public string? Description { get; set; }

    public int? BankAccountDefinitionId { get; set; }

    public int? CashAccountId { get; set; }

    /// <summary>Odemenin ait oldugu maas donemi "yyyy-MM". Bos ise odeme tarihinin ayi kullanilir.</summary>
    [StringLength(7)]
    public string? SalaryPeriod { get; set; }
}

public sealed class CreateEmployeePaymentResponse
{
    public int Id { get; set; }
}

public sealed class BulkSalaryPaymentRequest
{
    /// <summary>B2B kasa/banka kaynağı (2026-09-27). Doluysa seçilen hesaba tek "Personel Ödemesi" satırı yazılır.</summary>
    public ErpPaymentSource? ErpSource { get; set; }

    [Required]
    public List<int> EmployeeIds { get; set; } = new();

    public DateTime? PaymentDate { get; set; }

    /// <summary>
    /// Maasin ait oldugu donem "yyyy-MM". Bos ise odeme tarihinin ayi kullanilir.
    /// Agustos maasi 5 eylulde odenebildigi icin donem ile odeme tarihi ayni sey degildir.
    /// </summary>
    [StringLength(7)]
    public string? SalaryPeriod { get; set; }

    /// <summary>Ayni donem icin tekrar odeme yapilmasina izin ver (duzeltme senaryosu).</summary>
    public bool AllowDuplicatePeriod { get; set; }

    [StringLength(2000)]
    public string? Description { get; set; }

    public int? BankAccountDefinitionId { get; set; }

    public int? CashAccountId { get; set; }
}

public sealed class BulkMealPaymentRequest
{
    /// <summary>B2B kasa/banka kaynağı (2026-09-27). Doluysa seçilen hesaba tek "Personel Ödemesi" satırı yazılır.</summary>
    public ErpPaymentSource? ErpSource { get; set; }

    [Required]
    public List<int> EmployeeIds { get; set; } = new();

    public DateTime? PaymentDate { get; set; }

    [StringLength(2000)]
    public string? Description { get; set; }

    public int? BankAccountDefinitionId { get; set; }

    public int? CashAccountId { get; set; }
}
