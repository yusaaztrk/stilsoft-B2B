using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.PurchaseInvoices;

public sealed class KismiTeslimLineRequest
{
    public int LineId { get; set; }

    public decimal DeliveredQuantity { get; set; }

    public int? WarehouseCode { get; set; }

    /// <summary>
    /// Bu partinin birim fiyatı, TESLİMATIN para biriminde (2026-08-29).
    ///
    /// Boş bırakılırsa siparişteki fiyat kullanılır — eski davranış. Dolu gelirse yalnızca bu
    /// partiye uygulanır: aynı üründen ikinci parti farklı fiyata gelebilir ve her partinin
    /// maliyeti kendi faturasında kalır.
    /// </summary>
    public decimal? UnitPrice { get; set; }
}

public sealed class KismiTeslimRequest
{
    public List<KismiTeslimLineRequest> Items { get; set; } = new();

    /// <summary>
    /// Teslimat faturasının belge numarası (2026-08-29 kullanıcı isteği).
    ///
    /// Boşsa sistem üretir — eski davranış. Doluysa tedarikçinin gerçek belge numarası
    /// kullanılır. NUMARA ZATEN VARSA HATA VERİLMEZ: teslimat o faturaya EKLENİR
    /// (kullanıcı kararı: "bu var deyip o faturaya atacak, ama fiyat farklıysa söyleyecek,
    /// ayrı bir kalem gibi atacak").
    ///
    /// UZUNLUK SINIRI ŞART (2026-09-02): `PurchaseInvoices."DocumentNo"` kolonu
    /// `varchar(15)`. Sınır yokken 15 haneden uzun numara doğrudan veritabanına gidiyor,
    /// PostgreSQL `22001: varying(15) veri tipi için çok uzun` diye reddediyor ve kullanıcı
    /// anlamsız bir `DbUpdateException` görüyordu. Kardeş uçlarda (oluşturma, başlık
    /// güncelleme) bu sınır zaten vardı; yalnız burada atlanmıştı.
    /// </summary>
    [StringLength(15, ErrorMessage = "Belge No en fazla 15 karakter olabilir.")]
    public string? DocumentNo { get; set; }

    /// <summary>Bu partinin para birimi. Boşsa siparişinki kopyalanır.</summary>
    public int? CurrencyTypeId { get; set; }

    /// <summary>Bu partinin kuru. Her parti farklı kurla gelebilir.</summary>
    public decimal? ExchangeRate { get; set; }

    /// <summary>Kur kaynağı: "TCMB" ya da "Manuel".</summary>
    public string? RateSource { get; set; }

    /// <summary>
    /// Kalan mallar da bu teslimata dahil edilsin mi (2026-08-29).
    ///
    /// <c>true</c> ise sipariş tümüyle teslim alınmış sayılır ve bölme yapılmaz; kalan
    /// beklemede bırakılmaz. <c>false</c> (varsayılan) eski davranıştır: teslim alınan
    /// ayrı faturaya bölünür, kalan siparişte bekler.
    /// </summary>
    public bool IncludeRemainder { get; set; }
}
