using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.ProductPrices;

/// <summary>
/// "Fiyat 4'e Göre Toplu Güncelle" isteği: hesaplanmış fiyat satırları tek seferde gelir.
///
/// <para>
/// Fiyatlar EKRANDA hesaplanır. Formüller <c>PriceGroups.Formula</c> içinde duruyor
/// (ör. <c>REMOVE_KDV(F4*0.88)</c>) ve onları çözen tek motor ön yüzdeki
/// <c>computePricesFromFormulas</c>. Aynı motoru sunucuya kopyalamak, iki tarafın zamanla
/// ayrışması demekti: ürünü elle düzenlemekle toplu güncellemek farklı sonuç verirdi.
/// Bu yüzden sunucu hesap yapmaz, yalnız yazar.
/// </para>
/// </summary>
public sealed class BulkUpsertProductPricesRequest
{
    [Required]
    [MinLength(1)]
    public List<BulkUpsertProductPriceRow> Rows { get; set; } = new();
}

public sealed class BulkUpsertProductPriceRow
{
    [Required]
    public Guid ProductId { get; set; }

    [Required]
    public Guid PriceGroupId { get; set; }

    public decimal Price { get; set; }

    /// <summary>TL / TRY / USD / EUR / GBP. Boş gelirse "TL" sayılır.</summary>
    public string? Currency { get; set; }
}
