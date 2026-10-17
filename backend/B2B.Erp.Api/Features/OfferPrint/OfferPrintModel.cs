namespace B2B.Erp.Api.Features.OfferPrint;

/// <summary>Which of the two offer forms to print.</summary>
public enum OfferFormKind
{
    /// <summary>A row per product. No image, no features.</summary>
    Plain = 0,

    /// <summary>A block per product with its picture and feature list.</summary>
    Featured = 1
}

/// <summary>What a customer offer needs on paper.</summary>
public sealed class OfferPrintModel
{
    /// <summary>
    /// The number shown as "PI NO" — digits only.
    ///
    /// Offers are numbered MT + 13 digits and become P + the same 13 when they turn into a
    /// proforma. The prefix is dropped here so the printed number does not change underneath
    /// the customer when that happens: the digits are what identifies the document.
    /// </summary>
    public string PiNo { get; set; } = string.Empty;

    public DateTime? Tarih { get; set; }

    /// <summary>Customer's trading name.</summary>
    public string TicariUnvan { get; set; } = string.Empty;

    /// <summary>Contact person at the customer.</summary>
    public string Yetkili { get; set; } = string.Empty;

    public string Gsm { get; set; } = string.Empty;

    /// <summary>Salesman, printed as "TEKLİF VEREN".</summary>
    public string TeklifVeren { get; set; } = string.Empty;

    public string Aciklama { get; set; } = string.Empty;

    public List<OfferPrintLine> Lines { get; set; } = new();

    public decimal AraToplam { get; set; }
    public decimal Iskonto { get; set; }
    public decimal KdvsizToplam { get; set; }

    public decimal Kdv16Matrah { get; set; }
    public decimal Kdv16 { get; set; }
    public decimal Kdv10Matrah { get; set; }
    public decimal Kdv10 { get; set; }
    public decimal Kdv5Matrah { get; set; }
    public decimal Kdv5 { get; set; }

    public decimal KdvToplam { get; set; }
    public decimal GenelToplam { get; set; }

    /// <summary>
    /// Para birimi (1=TRY 2=EUR 3=USD 4=GBP). Bu formdaki BÜTÜN tutarlar bu paradadır.
    ///
    /// <para>
    /// Teklif/proforma kalemleri müşterinin para biriminde saklanır — TL'ye çevrim ancak teklif
    /// faturaya dönüşürken yapılır (<c>CustomerOffersController</c>). Basımda hiçbir yerde para
    /// birimi yazmıyordu: dolar teklifi ile lira teklifi kâğıtta BİREBİR aynı görünüyordu ve
    /// müşteri hangi parayı imzaladığını belgeden okuyamıyordu.
    /// </para>
    /// </summary>
    public int ParaBirimiTipi { get; set; } = 1;

    /// <summary>Para birimi kodu (USD/EUR/GBP); TL teklifte BOŞ, çünkü TL çıktısı değişmiyor.</summary>
    public string ParaBirimiKodu { get; set; } = string.Empty;

    /// <summary>Para biriminin tam adı, dip nota basılır. TL teklifte boş.</summary>
    public string ParaBirimiAdi { get; set; } = string.Empty;
}

public sealed class OfferPrintLine
{
    public string Barkod { get; set; } = string.Empty;
    public string StokKodu { get; set; } = string.Empty;
    public string StokAdi { get; set; } = string.Empty;

    public decimal Miktar { get; set; }
    public decimal KdvOran { get; set; }

    /// <summary>List price before the line's discount.</summary>
    public decimal BirimFiyat { get; set; }

    /// <summary>What the customer actually pays per unit.</summary>
    public decimal IndirimliFiyat { get; set; }

    public decimal AraToplam { get; set; }

    /// <summary>One feature per line, from ProductDetails. Used by the featured form only.</summary>
    public string Ozellikler { get; set; } = string.Empty;

    /// <summary>Absolute path of the product picture, if there is one.</summary>
    public string? GorselYolu { get; set; }
}
