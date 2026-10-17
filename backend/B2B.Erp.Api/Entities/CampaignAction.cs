using B2B.Erp.Api.Core.Enums;

namespace B2B.Erp.Api.Entities;

public sealed class CampaignAction : AuditableEntity, ISoftDeletable
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid CampaignId { get; set; }

    public Campaign Campaign { get; set; } = null!;

    public CampaignActionType ActionType { get; set; }

    public Guid? TargetProductId { get; set; }

    public Guid? TargetPriceGroupId { get; set; }

    /// <summary>
    /// Aksiyonun değeri. <see cref="CampaignActionType.PercentageDiscount"/> için yüzde,
    /// <see cref="CampaignActionType.FixedAmountDiscount"/> için <b>TL tutar</b>.
    ///
    /// <para>
    /// Sabit tutar para birimi taşımaz: motora verilen fiyatlar TL olduğu için bu değer de
    /// TL'dir. Bkz. <see cref="CampaignCondition.Minimum"/> — sözleşmenin kırıldığı yer ve
    /// dolarlı satırların nasıl sıfırlandığı orada anlatılıyor.
    /// </para>
    /// </summary>
    public decimal Value { get; set; }

    public int Quantity { get; set; }

    public bool IsDeleted { get; set; }
}
