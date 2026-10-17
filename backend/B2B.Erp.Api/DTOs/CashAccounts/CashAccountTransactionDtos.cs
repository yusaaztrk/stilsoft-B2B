using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.CashAccounts;

public sealed class CashAccountTransactionListItemResponse
{
    public int Id { get; set; }
    public int CashAccountId { get; set; }
    public string CashAccountCode { get; set; } = string.Empty;
    public string? CashAccountName { get; set; }
    public DateTime Date { get; set; }
    public CashAccountTransactionDirection Direction { get; set; }
    public CashAccountTransactionReferenceType ReferenceType { get; set; }
    public int? ReferenceId { get; set; }
    public decimal Amount { get; set; }
    public int CurrencyTypeId { get; set; }
    public decimal CurrencyRate { get; set; }
    public decimal CurrencyAmount { get; set; }

    /// <summary>Gelen/giden paranın KENDİ para birimi; 0 ise hesabın parasıyla aynı (çevrim yok).</summary>
    public int TenderCurrencyTypeId { get; set; }
    public decimal TenderRate { get; set; }
    public decimal TenderAmount { get; set; }
    /// <summary>Çevrim kodu (DVZ-...); yalnız gelen para hesabın parasından farklıysa dolu.</summary>
    public string? ExchangeCode { get; set; }

    public CashAccountTransactionCounterpartyType CounterpartyType { get; set; }
    public string CounterpartyCode { get; set; } = string.Empty;
    public string CounterpartyName { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string CreateUser { get; set; } = string.Empty;
}

public sealed class CreateCashAccountTransactionRequest
{
    [Range(1, int.MaxValue)]
    public int CashAccountId { get; set; }

    [Required]
    public DateTime Date { get; set; }

    [Required]
    public CashAccountTransactionDirection Direction { get; set; }

    [Range(0.01, double.MaxValue)]
    public decimal Amount { get; set; }

    public int CurrencyTypeId { get; set; }

    [Range(0, double.MaxValue)]
    public decimal CurrencyRate { get; set; } = 0m;

    [Range(0, double.MaxValue)]
    public decimal CurrencyAmount { get; set; }

    /// <summary>
    /// GELEN PARANIN para birimi (2026-08-17). Müşteri 1.000 DOLAR getirip TL kasaya
    /// yazdıracaksa burası USD, seçilen kasa ise TL kasadır.
    /// Gönderilmezse (0) çevrim yoktur ve davranış eskisiyle birebir aynıdır.
    /// </summary>
    public int TenderCurrencyTypeId { get; set; }

    /// <summary>Gelen paranın O GÜNKÜ kuru (1 birim = X ₺). Verilmezse sunucu günün kurunu çeker.</summary>
    [Range(0, double.MaxValue)]
    public decimal TenderRate { get; set; }

    /// <summary>Fiziken gelen/giden tutar, gelen paranın kendi biriminde (1.000 gibi).</summary>
    [Range(0, double.MaxValue)]
    public decimal TenderAmount { get; set; }

    /// <summary>
    /// CARİ HESABIN para birimi (1=TRY, 2=EUR, 3=USD, 4=GBP).
    /// Kasa veya gelen para ne olursa olsun, işlemin işleneceği cari döviz hesabıdır.
    /// </summary>
    public int? CustomerAccountCurrencyTypeId { get; set; }

    [Required]
    public CashAccountTransactionCounterpartyType CounterpartyType { get; set; }

    [MaxLength(50)]
    public string CounterpartyCode { get; set; } = string.Empty;

    [MaxLength(255)]
    public string CounterpartyName { get; set; } = string.Empty;

    [MaxLength(2000)]
    public string? Description { get; set; }
}

public sealed class UpdateCashAccountTransactionRequest
{
    [Required]
    public DateTime Date { get; set; }

    [Required]
    public CashAccountTransactionDirection Direction { get; set; }

    [Range(0.01, double.MaxValue)]
    public decimal Amount { get; set; }

    public int CurrencyTypeId { get; set; }

    [Range(0, double.MaxValue)]
    public decimal CurrencyRate { get; set; } = 0m;

    [Range(0, double.MaxValue)]
    public decimal CurrencyAmount { get; set; }

    /// <summary>
    /// GELEN PARANIN para birimi (2026-08-17). Müşteri 1.000 DOLAR getirip TL kasaya
    /// yazdıracaksa burası USD, seçilen kasa ise TL kasadır.
    /// Gönderilmezse (0) çevrim yoktur ve davranış eskisiyle birebir aynıdır.
    /// </summary>
    public int TenderCurrencyTypeId { get; set; }

    /// <summary>Gelen paranın O GÜNKÜ kuru (1 birim = X ₺). Verilmezse sunucu günün kurunu çeker.</summary>
    [Range(0, double.MaxValue)]
    public decimal TenderRate { get; set; }

    /// <summary>Fiziken gelen/giden tutar, gelen paranın kendi biriminde (1.000 gibi).</summary>
    [Range(0, double.MaxValue)]
    public decimal TenderAmount { get; set; }

    /// <summary>
    /// CARİ HESABIN para birimi (1=TRY, 2=EUR, 3=USD, 4=GBP).
    /// </summary>
    public int? CustomerAccountCurrencyTypeId { get; set; }

    [Required]
    public CashAccountTransactionCounterpartyType CounterpartyType { get; set; }

    [MaxLength(50)]
    public string CounterpartyCode { get; set; } = string.Empty;

    [MaxLength(255)]
    public string CounterpartyName { get; set; } = string.Empty;

    [MaxLength(2000)]
    public string? Description { get; set; }
}
