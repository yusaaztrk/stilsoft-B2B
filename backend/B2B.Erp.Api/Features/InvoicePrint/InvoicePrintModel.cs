namespace B2B.Erp.Api.Features.InvoicePrint;

/// <summary>
/// What the invoice form needs, and nothing else.
///
/// Field names mirror the legacy VW_FATURA_DIZAYN_DATA view so the mapping stays obvious, but
/// only the columns that actually reach the paper are here. The legacy view also carried FISNO,
/// TIP, CARI_KODU, STOK_KODU, TELEFON, EKACK1..3, TESLIM_ADRES, ACIKLAMA and ISLEM_YAPAN, none
/// of which appear in any reference printout — the invoice serial is pre-printed on the stock.
/// </summary>
public sealed class InvoicePrintModel
{
    /// <summary>Customer title. Prints on the first line.</summary>
    public string CariAdi { get; set; } = string.Empty;

    public string Adres { get; set; } = string.Empty;

    /// <summary>Printed as "ILCE/IL", e.g. "MERKEZ/GAZİMAĞUSA".</summary>
    public string Ilce { get; set; } = string.Empty;
    public string Il { get; set; } = string.Empty;

    public DateTime? Tarih { get; set; }

    public string VergiDairesi { get; set; } = string.Empty;
    public string VergiNo { get; set; } = string.Empty;

    /// <summary>Salesman code of the customer. Prints left of "TESLİM ALAN #".</summary>
    public string PlasiyerKodu { get; set; } = string.Empty;

    public string Montaj { get; set; } = string.Empty;
    public string Not { get; set; } = string.Empty;

    /// <summary>
    /// ŞUBEYE SATIŞTA TESLİM ADRESİ — "TESLIM : {adres}   {ilçe} / {il}".
    ///
    /// <para>
    /// Fatura ana cariye kesilir, mal şubeye gider. Başlıkta ana carinin adresi yazdığı için
    /// kâğıtta malın nereye teslim edileceği hiç görünmüyordu. Boşken satır HİÇ çizilmez:
    /// şube satışı olmayan faturada bu alanın kâğıtta karşılığı yok.
    /// </para>
    /// </summary>
    public string TeslimAdres { get; set; } = string.Empty;

    /// <summary>
    /// AÇIK FATURADA KAŞE BASILMAZ (kullanıcı kuralı, 2026-08-21).
    ///
    /// <para>
    /// Açık cari, resmî fatura hesabı değil: belge firmanın kaşesiyle onaylanmış bir fatura
    /// gibi görünmemeli. Ölçüt iki yerden birden okunuyor, çünkü ikisi de aynı şeyi söylüyor
    /// ama her faturada ikisi birden dolu değil: faturanın yazıldığı cari kodu <c>-2</c> ile
    /// bitiyorsa (bkz. cari alt hesap kuralı: -1 resmî, -2 açık, -3 muaf) ya da
    /// <c>CustomerInvoiceTypeOverride</c> "ACIK" ise.
    /// </para>
    /// </summary>
    public bool AcikFatura { get; set; }

    public List<InvoicePrintLine> Lines { get; set; } = new();

    /// <summary>Sum before discount — the BRÜT TUTAR line.</summary>
    public decimal AraToplam { get; set; }

    /// <summary>Discount. When zero, neither İNDİRİM nor NET TOPLAM is printed.</summary>
    public decimal Iskonto { get; set; }

    public decimal NetToplam { get; set; }

    /// <summary>The three VAT bands the form has boxes for, in the form's own order.</summary>
    public decimal Kdv16Matrah { get; set; }
    public decimal Kdv16 { get; set; }
    public decimal Kdv10Matrah { get; set; }
    public decimal Kdv10 { get; set; }
    public decimal Kdv5Matrah { get; set; }
    public decimal Kdv5 { get; set; }

    public decimal KdvToplam { get; set; }
    public decimal GenelToplam { get; set; }

    /// <summary>
    /// Para birimi (1=TRY 2=EUR 3=USD 4=GBP). Yukarıdaki BÜTÜN tutarlar bu paradadır.
    ///
    /// <para>
    /// Öncesinde basım her zaman TL tutarları yazıyordu ve yazıyla satırı da sabit "TL" diyordu:
    /// dolar kesilmiş bir fatura, müşteriye lira borcu iddia eden bir belge olarak çıkıyordu.
    /// TL faturada (1 ya da 0) çıktı BİREBİR eskisi gibidir.
    /// </para>
    /// </summary>
    public int ParaBirimiTipi { get; set; } = 1;

    /// <summary>
    /// Para birimi kodu; TL faturada BOŞ.
    ///
    /// <para>
    /// KÂĞIDA AYRI BİR SATIR OLARAK ÇİZİLMİYOR — bilerek. Form referans çıktılardan santim
    /// santim ölçülmüş bir ızgara ve üzerinde önceden basılı kutular var; göremediğim bir
    /// kutunun üstüne yazmaktansa para birimi YAZIYLA satırında tam adıyla ("… AMERİKAN
    /// DOLARI … CENT") duruyor — Türk faturasında para birimini hukuken bağlayan yer orası.
    /// Alan, kodu isteyen çağıranlar (PDF üstverisi, önizleme) için modelde tutuluyor.
    /// </para>
    /// </summary>
    public string ParaBirimiKodu { get; set; } = string.Empty;

    /// <summary>Fatura anındaki donmuş TL kuru; TL faturada 1. Kâğıda çizilmez, bkz. yukarısı.</summary>
    public decimal Kur { get; set; } = 1m;

    /// <summary>
    /// The amount in words. Left settable so a caller holding the legacy YAZIYLA value can pass
    /// it through verbatim; when empty it is generated from <see cref="GenelToplam"/>.
    /// </summary>
    public string? Yaziyla { get; set; }
}

public sealed class InvoicePrintLine
{
    /// <summary>
    /// Barcode. Printed joined to the name as "BARKOD1  STOK_ADI" — a single left-aligned
    /// string, not two columns. A blank barcode therefore pulls the name left to column 2,
    /// which is exactly what service lines do on the reference printouts.
    /// </summary>
    public string Barkod { get; set; } = string.Empty;

    /// <summary>
    /// Kâğıda basılan ad: KATALOG ADI. Katalogda karşılığı olmayan kalemlerde (hizmet, serbest
    /// metin) kalemin kendi açıklaması, o da yoksa stok kodu.
    ///
    /// <para>
    /// Sıra 2026-08-21'de düzeltildi: önce açıklamaya bakılıyordu ve sipariş satırına not
    /// düşülen her faturada ürün adı yerine o not basılıyordu.
    /// </para>
    /// </summary>
    public string StokAdi { get; set; } = string.Empty;

    /// <summary>
    /// The catalogue name, never the line description.
    ///
    /// The barcode label has to carry this: a line described "Bu ürün jaleye teslim edilecek"
    /// still holds a kıyma makinesi, and a label reading the delivery note instead of the product
    /// is unusable on a shelf.
    /// </summary>
    public string UrunAdi { get; set; } = string.Empty;

    public decimal KdvOran { get; set; }
    public decimal Miktar { get; set; }
    public string OlcuBirimi { get; set; } = string.Empty;
    public decimal Fiyat { get; set; }
    public decimal Tutar { get; set; }
}
