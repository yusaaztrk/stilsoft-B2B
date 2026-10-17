namespace B2B.Erp.Api.Entities;

/// <summary>
/// GARANTİ DEĞİŞİM (kullanıcı kuralı, 2026-08-14).
///
/// Müşteri arızalı ürünü getirir, yerine başka bir ürün alır. FATURA KESİLMEZ: işlem yalnızca
/// iki stok hareketi ve — istenirse — bir cari ekstre satırıdır.
///
///  - Gelen (arızalı) ürün  → GARANTİ DEPOSUNA giriş (Ayarlar'dan seçilen depo).
///  - Verilen (sağlam) ürün → ekranda seçilen depodan çıkış.
///
/// FARK CARİYE İSTEĞE BAĞLI YANSIR. Üç senaryo da desteklenmek zorunda:
///  1. 5.000'lik ürün geldi, 7.000'lik verildi → istenirse 2.000 borç, istenmezse ekstreye
///     hiçbir şey düşmez.
///  2. 5.000'lik geldi, 10.000'lik verildi, 2.000 indirim yapıldı → fark 3.000 borç; sonra
///     tahsilat normal kasa/banka akışından girilir ve borç kapanır.
///  3. 5.000'lik geldi, 3.000'lik verildi → istenirse 2.000 alacak (üste para), istenmezse yok.
///
/// Bu yüzden fark SAKLANMAZ, alanlardan hesaplanır; ekstreye yazılıp yazılmadığı ise
/// <see cref="CustomerLedgerEntryId"/> ile tutulur — kayıt silinince o satır da silinsin diye.
/// "Yazıldı mı" bilgisini ayrı bir bool'da tutmak, iki alanın birbirini tutmadığı bir hâl
/// üretirdi (bool true ama satır elle silinmiş gibi).
/// </summary>
public sealed class WarrantyExchange : AuditableEntity
{
    public int Id { get; set; }

    /// <summary>Ekranda ve raporda görünen işlem numarası (GD + zaman damgası).</summary>
    public string ExchangeNo { get; set; } = string.Empty;

    public DateTime Date { get; set; }

    public string CustomerCode { get; set; } = string.Empty;

    /// <summary>Ürünün ilk satıldığı faturanın numarası — serbest metin, doğrulanmaz.</summary>
    public string? InvoiceNo { get; set; }

    /// <summary>
    /// Arızalı ürünün girdiği garanti deposu. İŞLEM ANINDA DAMGALANIR: ayar sonradan
    /// değiştirilirse eski kayıtların hangi depoya girdiği bilgisi kaybolmasın.
    /// </summary>
    public int WarrantyWarehouseCode { get; set; }

    /// <summary>Sağlam ürünün çıktığı depo — kullanıcının yetkili olduğu depolardan biri.</summary>
    public int OutWarehouseCode { get; set; }

    public string ReturnedStockCode { get; set; } = string.Empty;
    public string? ReturnedProductName { get; set; }
    public decimal ReturnedQuantity { get; set; }
    /// <summary>Arızalı ürünün müşteriye satıldığı birim fiyat (senaryodaki 5.000).</summary>
    public decimal ReturnedUnitPrice { get; set; }
    public string? ReturnedSerialNo { get; set; }

    public string GivenStockCode { get; set; } = string.Empty;
    public string? GivenProductName { get; set; }
    public decimal GivenQuantity { get; set; }
    /// <summary>Verilen ürünün birim fiyatı (senaryodaki 7.000 / 10.000 / 3.000).</summary>
    public decimal GivenUnitPrice { get; set; }
    public string? GivenSerialNo { get; set; }

    /// <summary>Verilen ürüne uygulanan indirim (senaryo 2'deki 2.000). Fark bunun sonrası.</summary>
    public decimal DiscountAmount { get; set; }

    public int CurrencyTypeId { get; set; }
    public decimal CurrencyRate { get; set; } = 1m;

    /// <summary>
    /// Bu işlemin cari ekstreye yazdığı satır. NULL = ekstreye yansıtılmadı (kullanıcı
    /// "borçlandırma" kutusunu işaretlemedi ya da fark sıfır). Kayıt silinirken bu satır da
    /// silinir; ekstrede sahipsiz bir borç bırakmak kabul edilemez.
    /// </summary>
    public int? CustomerLedgerEntryId { get; set; }

    public string? Description { get; set; }

    /// <summary>
    /// Fark = (verilen tutar − indirim) − gelen tutar. Pozitifse müşteri borçlanır,
    /// negatifse alacaklanır. Saklanmaz: alanlardan türetilir ki kalemler düzeltilince
    /// kayıt yalan söylemesin.
    /// </summary>
    public decimal DifferenceAmount =>
        (GivenUnitPrice * GivenQuantity - DiscountAmount) - (ReturnedUnitPrice * ReturnedQuantity);
}
