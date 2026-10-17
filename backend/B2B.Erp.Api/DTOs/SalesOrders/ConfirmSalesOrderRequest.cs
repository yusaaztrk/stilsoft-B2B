using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.SalesOrders;

public sealed class ConfirmSalesOrderRequest
{
    [Required]
    [MaxLength(50)]
    public string CariKodu { get; set; } = string.Empty;

    [Required]
    [MaxLength(50)]
    public string TeslimCariKodu { get; set; } = string.Empty;

    [Required]
    [MinLength(1)]
    public List<ConfirmSalesOrderLineRequest> Lines { get; set; } = new();

    public decimal? CampaignDiscount { get; set; }

    public string? CampaignDetailsJson { get; set; }

    /// <summary>
    /// Limit aşımıyla onay (2026-10-14). Yalnız yetkili rolde etkilidir
    /// (<c>Roles.OverLimitApprovalEnabled</c>, Süper Admin, SSA); yetkisiz kullanıcı gönderse de
    /// "Limitiniz yetersiz" engeli aynen çalışır.
    /// </summary>
    public bool LimitAsimiOnay { get; set; }
}

public sealed class ConfirmSalesOrderLineRequest
{
    [Required]
    [MaxLength(50)]
    public string StokKodu { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? Aciklama { get; set; }

    [MaxLength(255)]
    public string? MontajBayiAdi { get; set; }

    [MaxLength(255)]
    public string? MontajUrunAdi { get; set; }

    [MaxLength(100)]
    public string? MontajIsimSoyisim { get; set; }

    [MaxLength(30)]
    public string? MontajTelefon { get; set; }

    [MaxLength(1000)]
    public string? MontajAdres { get; set; }

    [MaxLength(100)]
    public string? MontajBolge { get; set; }

    [MaxLength(2000)]
    public string? MontajBayiAciklama { get; set; }

    [Range(0.001, double.MaxValue)]
    public decimal Miktar { get; set; }

    [Range(0, double.MaxValue)]
    public decimal Fiyat { get; set; }

    [Range(0, int.MaxValue)]
    public int? CurrencyTypeId { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? CurrencyRate { get; set; }

    [Range(0, double.MaxValue)]
    public decimal KdvOran { get; set; }

    public int Sira { get; set; }

    [MaxLength(50)]
    public string? KampanyaKodu { get; set; }

    public bool Montaj { get; set; }

    public int? GrupId { get; set; }

    /// <summary>
    /// Bu kalemin ÇIKIŞ DEPOSU. Verilmezse eski davranış sürer: depo, faturaya aktarım
    /// sırasında kalemi giren kişinin varsayılan deposundan çözülür
    /// (<c>FillDefaultWarehousesAsync</c>).
    ///
    /// Hızlı Servis gibi malın hangi depodan çıktığı SİPARİŞ ANINDA belli olan akışlarda
    /// doldurulur: orada stok, satışı yapan kullanıcının yetkili olduğu depodan düşmeli,
    /// faturayı kesen kişinin varsayılan deposundan değil.
    ///
    /// 0 "atanmamış" demektir; negatif kodlar (-20 SİPARİŞ, -21 YP SİPARİŞ) GEÇERLİDİR,
    /// bu yüzden kontrol <c>&gt; 0</c> değil <c>!= 0</c>.
    /// </summary>
    public int? DepoKodu { get; set; }
}
