namespace B2B.Erp.Api.Entities;

[System.ComponentModel.DataAnnotations.Schema.Table("JwtSessionSettings")]
public sealed class JwtSessionSetting
{
    public int Id { get; set; }
    public int AccessTokenExpirationMinutes { get; set; }
    public int AlertBeforeMinutes { get; set; }
    public DateTime UpdatedAtUtc { get; set; }
    public int? UpdatedByUserId { get; set; }

    public int CampaignGiftAccountingMode { get; set; } = 2; // 2: SymbolicPrice
    public decimal CampaignGiftSymbolicPrice { get; set; } = 0.01m;
    public DateTime? InvoiceDeleteLockDate { get; set; }

    /// <summary>Fatura Takip başlangıç günü; bundan önce KAYDEDİLEN faturalar otomatik tamamlandı sayılır.</summary>
    public DateTime? InvoiceTrackingStartDate { get; set; }
}

