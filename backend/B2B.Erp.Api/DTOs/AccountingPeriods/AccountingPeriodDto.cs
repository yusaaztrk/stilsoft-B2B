namespace B2B.Erp.Api.DTOs.AccountingPeriods;

public sealed class AccountingPeriodDto
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int FiscalYear { get; set; }
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public int Status { get; set; }
    public string StatusName { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public bool IsClosed { get; set; }
    public DateTime? ClosedAt { get; set; }
    public string? ClosedByUserId { get; set; }
    public DateTime? ReopenedAt { get; set; }
    public string? ReopenedByUserId { get; set; }
}

public sealed class CreateAccountingPeriodDto
{
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public int FiscalYear { get; set; }
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
}

public sealed class PeriodClosingValidationReportDto
{
    public bool CanClose { get; set; } = true;
    public int TotalCustomers { get; set; }
    public int TotalEntriesInPeriod { get; set; }
    public List<string> CriticalErrors { get; set; } = new();
    public List<string> Warnings { get; set; } = new();
    public List<PeriodCurrencySummaryDto> CurrencySummaries { get; set; } = new();
}

public sealed class PeriodCurrencySummaryDto
{
    public int CurrencyTypeId { get; set; }
    public string CurrencyCode { get; set; } = string.Empty;
    public decimal TotalDebit { get; set; }
    public decimal TotalCredit { get; set; }
    public decimal NetBalance { get; set; }
}

public sealed class CloseAccountingPeriodResultDto
{
    public bool Success { get; set; }
    public string Message { get; set; } = string.Empty;
    public int ClosedPeriodId { get; set; }
    public int TargetPeriodId { get; set; }
    public int GeneratedOpeningEntriesCount { get; set; }

    /// <summary>
    /// KAPATMA UYARILARI (2026-08-20 kullanıcı kararı, denetim md. A3).
    ///
    /// <para>
    /// Dönem kapatılırken içeride ONAYSIZ alış faturası kalmış olabilir: bunlar cari
    /// bakiyeye ve stoğa henüz işlememiştir, dolayısıyla devir bakiyesi eksik hesaplanır.
    /// Kullanıcı kararı kapatmayı ENGELLEMEMEK yönünde — kapatma yapılır, ama ne
    /// kaçırıldığı burada açıkça söylenir ve ekranda gösterilir.
    /// </para>
    /// </summary>
    public List<string> Warnings { get; set; } = new();
}

public sealed class CloseAccountingPeriodRequestDto
{
    public string? CustomTransferName { get; set; }
}
