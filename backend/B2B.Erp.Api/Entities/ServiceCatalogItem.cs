namespace B2B.Erp.Api.Entities;

public sealed class ServiceCatalogItem : AuditableEntity
{
    public int Id { get; set; }

    public string Code { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public bool IsActive { get; set; }

    /// <summary>
    /// Hizmetin para birimi (2026-08-20). Kodlama <c>CurrencyTypeHelper</c> ile aynı:
    /// 0/1 = TRY, 2 = EUR, 3 = USD, 4 = GBP.
    ///
    /// Hizmet tanımında para birimi YOKTU; gümrük masrafı gibi doğası gereği dövizli hizmetler
    /// faturaya her seferinde TL olarak düşüyor, kullanıcı kalemde elle dövize çeviriyordu.
    /// Hizmetin para birimi hizmetin bir özelliği — faturanın değil — bu yüzden burada duruyor
    /// ve fatura kalemine ÖNTANIM olarak taşınıyor (kalemde değiştirilebilir).
    ///
    /// 0 varsayılanı mevcut kayıtlarla aynı anlama gelir (TL); eski satırlar aynen çalışır.
    /// </summary>
    public int CurrencyTypeId { get; set; }
}
