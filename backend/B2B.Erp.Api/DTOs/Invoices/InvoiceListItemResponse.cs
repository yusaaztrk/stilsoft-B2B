namespace B2B.Erp.Api.Dtos.Invoices;

public sealed class InvoiceListItemResponse
{
    public int Id { get; set; }
    public string IslemTipi { get; set; } = string.Empty;
    public DateTime Tarih { get; set; }
    public DateTime Saat { get; set; }
    public string FaturaNo { get; set; } = string.Empty;
    public int? SourceCustomerOfferId { get; set; }
    public string CariAdi { get; set; } = string.Empty;
    /// <summary>Faturanın cari kodu (alt hesap ekli olabilir). Cari adına tıklayınca ekstre açmak için.</summary>
    public string CariKodu { get; set; } = string.Empty;
    public string FaturaAcik { get; set; } = string.Empty;
    public decimal BrutTutar { get; set; }
    public decimal Iskonto { get; set; }
    public decimal KampanyaIndirimi { get; set; }
    public decimal NetTutar { get; set; }
    public decimal KdvTutari { get; set; }
    public decimal GenelToplam { get; set; }

    /// <summary>
    /// Belgenin para birimi ve FATURA ANINDAKİ donmuş kuru (2026-08-17, kullanıcı isteği:
    /// "farklı kurla sattıysam fatura dökümünde o kur görünsün").
    /// Liste tutarları TL çapasıdır; bu iki alan olmadan dövizli fatura TL faturadan
    /// ayırt edilemiyordu. TL faturada 0/1 gelir ve ekranda tire gösterilir.
    /// </summary>
    public int ParaBirimiTipi { get; set; }
    public decimal Kur { get; set; }

    /// <summary>
    /// Malın çıktığı depo — "10 HASPOLAT DEPO" gibi. Depo fatura başlığında değil kalemlerde
    /// durduğu için burada birleştirilir; kalemler farklı depolardansa "Karışık (n depo): ..."
    /// yazar. Hizmet faturası gibi kalemi/deposu olmayan belgelerde boştur.
    /// </summary>
    public string? CikisDeposu { get; set; }

    public string? Plasiyer { get; set; }
    public string IslemYapan { get; set; } = string.Empty;

    public bool OdemeAlindi { get; set; }
    public string? OdemeHedefi { get; set; }

    public int? OdemeKasaId { get; set; }
    public int? OdemeBankaId { get; set; }
}
