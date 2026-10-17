namespace B2B.Erp.Api.Entities;

/// <summary>
/// Ürün fiyat değişikliklerinin geçmişi — "ne zaman, ne kadardan ne kadara".
///
/// AYRI TABLO: mevcut `ProductPrices` yalnızca GÜNCEL fiyatı tutar ve üzerine yazılır;
/// geçmiş orada yok. Var olan tabloya dokunulmadı, kayıt buraya düşüyor.
///
/// Her fiyat grubu için ayrı satır yazılır (Fiyat 1..6), böylece "Fiyat 4 şu tarihte
/// 10.100'den 12.000'e çıktı" sorusu doğrudan cevaplanabilir.
/// </summary>
public sealed class ProductPriceHistory
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid ProductId { get; set; }

    /// <summary>Stok kodu da yazılır: ürün silinse bile geçmiş okunabilsin.</summary>
    public string StockCode { get; set; } = string.Empty;

    /// <summary>PriceGroups.Code (1..6). Fiyat grubu sayısı sabit değil, kod olarak tutulur.</summary>
    public int PriceGroupCode { get; set; }

    /// <summary>Değişiklikten ÖNCEKİ fiyat. İlk kez fiyat veriliyorsa 0.</summary>
    public decimal OldPrice { get; set; }

    /// <summary>Değişiklikten SONRAKİ fiyat.</summary>
    public decimal NewPrice { get; set; }

    /// <summary>Zam oranı — (yeni - eski) / eski. Eski 0 ise null.</summary>
    public decimal? ChangeRate { get; set; }

    public DateTime ChangedAt { get; set; } = DateTime.UtcNow;

    public string ChangedBy { get; set; } = string.Empty;

    /// <summary>Değişikliğin kaynağı, ör. "TopluFiyatAtama".</summary>
    public string Source { get; set; } = string.Empty;
}
