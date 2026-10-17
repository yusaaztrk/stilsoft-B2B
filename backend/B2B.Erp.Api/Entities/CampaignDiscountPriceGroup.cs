namespace B2B.Erp.Api.Entities;

/// <summary>
/// Bir kampanya indiriminin HANGİ fiyat gruplarına uygulanacağını tutar.
///
/// Neden ayrı tablo: eskiden bu bilgi <see cref="CampaignDiscount"/> üzerinde
/// IskontoFiyat1..IskontoFiyat6 diye SABİT ALTI KOLONDU. Fiyat grupları ise
/// veritabanından yönetiliyor ve 6'dan fazla olabiliyor (7 = "Askeriye Tipi Fatura").
/// Yedinci grup seçilse bile uçlardaki `Where(x => x is >= 1 and <= 6)` süzgeci onu
/// sessizce atıyordu; yazacak kolon da yoktu. Yani 6'dan sonrası kampanyalarda HİÇ yoktu.
///
/// Artık kaç fiyat grubu olursa olsun buraya bir satır düşüyor; yeni grup eklendiğinde
/// hiçbir şema değişikliği gerekmiyor.
///
/// GERİYE DÖNÜK UYUM: IskontoFiyat1..6 kolonları YERİNDE BIRAKILDI ve 1-6 aralığı için
/// yazılmaya devam ediliyor. O kolonları okuyan çok sayıda yer var; ikisi senkron
/// tutulduğu için eski okuyucular çalışmayı sürdürüyor. Okuma tarafı önce bu tabloya
/// bakar, satır yoksa eski kolonlara düşer (migration öncesi kayıtlar için).
/// </summary>
public sealed class CampaignDiscountPriceGroup : AuditableEntity, ISoftDeletable
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid CampaignDiscountId { get; set; }

    public CampaignDiscount CampaignDiscount { get; set; } = null!;

    /// <summary>PriceGroups.Code — 1..6 ile sınırlı DEĞİL.</summary>
    public int PriceGroupCode { get; set; }

    /// <summary>Bu fiyat grubu için geçerli indirim değeri.</summary>
    public decimal Deger { get; set; }

    public bool IsDeleted { get; set; }
}
