using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.CashAccounts;

public sealed class CashAccountListItemResponse
{
    public int Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string? Name { get; set; }
    public DateTime LastCarryDate { get; set; }
    public double LastCarryAmount { get; set; }
    public int CurrencyTypeId { get; set; }
    public decimal Balance { get; set; }
}

public sealed class CreateCashAccountRequest
{
    [Required]
    [MaxLength(50)]
    public string Code { get; set; } = string.Empty;

    [MaxLength(255)]
    public string? Name { get; set; }

    public DateTime LastCarryDate { get; set; }

    public double LastCarryAmount { get; set; }

    public int CurrencyTypeId { get; set; }
}

public sealed class UpdateCashAccountRequest
{
    [Required]
    [MaxLength(50)]
    public string Code { get; set; } = string.Empty;

    [MaxLength(255)]
    public string? Name { get; set; }

    public DateTime LastCarryDate { get; set; }

    /// <summary>
    /// Devir (açılış) bakiyesi. NULL = DEĞİŞTİRME — alanı hiç göndermeyen bir çağıran
    /// mevcut deviri sıfırlamasın diye nullable. Boş göndermekle "0 yap" demek arasındaki
    /// farkı ancak böyle koruyabiliyoruz.
    /// </summary>
    public double? LastCarryAmount { get; set; }

    public int CurrencyTypeId { get; set; }
}
