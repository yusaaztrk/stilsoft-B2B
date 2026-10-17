using System.ComponentModel.DataAnnotations;
using B2B.Erp.Api.Entities;

namespace B2B.Erp.Api.Dtos.BankAccounts;

public sealed class BankAccountTransactionListItemResponse
{
    public int Id { get; set; }
    public int BankAccountDefinitionId { get; set; }
    public string BankAccountCode { get; set; } = string.Empty;
    public string BankAccountName { get; set; } = string.Empty;
    public DateTime Date { get; set; }
    public BankAccountTransactionDirection Direction { get; set; }
    public decimal Amount { get; set; }
    public int CurrencyTypeId { get; set; }
    public decimal CurrencyRate { get; set; }
    public decimal CurrencyAmount { get; set; }
    public BankAccountTransactionCounterpartyType CounterpartyType { get; set; }
    public string CounterpartyCode { get; set; } = string.Empty;
    public string CounterpartyName { get; set; } = string.Empty;
    public string? DocumentNo { get; set; }
    public DateTime? MaturityDate { get; set; }
    public string? Description { get; set; }
    public string Category { get; set; } = string.Empty;
    public bool IsPosFee { get; set; }

    /*
      POS MASRAFININ VERGİ KIRILIMI (denetim md. A4). `Amount` brüt; aşağıdakiler onun
      içindeki bileşenlerdir, bakiyeye ayrıca eklenmez. Hepsi 0 = ayrıştırma yapılmamış.
    */
    public decimal PosFeeBsmvRate { get; set; }
    public decimal PosFeeVatRate { get; set; }
    public decimal PosFeeBsmvAmount { get; set; }
    public decimal PosFeeVatAmount { get; set; }

    /// <summary>Brütten BSMV ve KDV düşüldükten sonra kalan çıplak komisyon.</summary>
    public decimal PosFeeNetAmount { get; set; }

    public string CreateUser { get; set; } = string.Empty;
}

public sealed class CreateBankAccountTransactionRequest
{
    [Range(1, int.MaxValue)]
    public int BankAccountDefinitionId { get; set; }

    [Required]
    public DateTime Date { get; set; }

    [Required]
    public BankAccountTransactionDirection Direction { get; set; }

    [Range(0.01, double.MaxValue)]
    public decimal Amount { get; set; }

    public int CurrencyTypeId { get; set; }

    [Range(0, double.MaxValue)]
    public decimal CurrencyRate { get; set; } = 0m;

    [Range(0, double.MaxValue)]
    public decimal CurrencyAmount { get; set; }

    /// <summary>
    /// GELEN PARANIN para birimi (2026-08-17). Müşteri 1.000 DOLAR yatırıp TL hesaba
    /// işletecekse burası USD, seçilen hesap ise TL hesabıdır. Gönderilmezse (0) çevrim
    /// yoktur ve davranış eskisiyle birebir aynıdır.
    /// </summary>
    public int TenderCurrencyTypeId { get; set; }

    /// <summary>Gelen paranın O GÜNKÜ kuru (1 birim = X ₺). Verilmezse sunucu günün kurunu çeker.</summary>
    public decimal TenderRate { get; set; }

    /// <summary>Fiziken gelen/giden tutar, gelen paranın kendi biriminde.</summary>
    public decimal TenderAmount { get; set; }

    /// <summary>
    /// CARİ HESABIN para birimi (1=TRY, 2=EUR, 3=USD, 4=GBP).
    /// Banka hesabı veya gelen para ne olursa olsun, işlemin işleneceği cari döviz hesabıdır.
    /// </summary>
    public int? CustomerAccountCurrencyTypeId { get; set; }

    [Required]
    public BankAccountTransactionCounterpartyType CounterpartyType { get; set; }

    [MaxLength(50)]
    public string CounterpartyCode { get; set; } = string.Empty;

    [MaxLength(255)]
    public string CounterpartyName { get; set; } = string.Empty;

    [MaxLength(2000)]
    public string? Description { get; set; }

    [MaxLength(30)]
    public string? DocumentNo { get; set; }

    public DateTime? MaturityDate { get; set; }

    [Range(0, double.MaxValue)]
    public decimal PosFee { get; set; }

    [MaxLength(500)]
    public string? PosFeeDescription { get; set; }

    /*
      POS MASRAFI VERGİ ORANLARI (2026-08-20 kullanıcı kararı, denetim md. A4).
      Yüzde olarak girilir (5 = %5). İkisi de ELLE ayarlanır; boş/0 bırakılırsa ayrıştırma
      yapılmaz ve davranış birebir eskisi gibidir. Girilen `PosFee` her hâlükârda BRÜT'tür:
      bu oranlar hesaptan düşen tutarı DEĞİŞTİRMEZ, yalnızca içindekini açıklar.
    */
    public decimal? PosFeeBsmvRate { get; set; }

    public decimal? PosFeeVatRate { get; set; }

}
