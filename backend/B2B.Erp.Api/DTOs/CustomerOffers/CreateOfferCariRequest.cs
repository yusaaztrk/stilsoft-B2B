using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.CustomerOffers;

/// <summary>
/// Müşteri Teklifi ekranındaki "Cari Ekle" formunun gövdesi.
///
/// <para>
/// Cari kodu BURADA TAŞINMAZ: kod sunucuda üretilir (bayi öneki <c>120-01-</c>, sıradaki boş
/// numara). İstemcinin numara göndermesine izin vermek, iki kullanıcı aynı anda kaydettiğinde
/// çakışmaya ve numara atlamaya açık kapı bırakırdı.
/// </para>
/// </summary>
public sealed class CreateOfferCariRequest
{
    [Required]
    [MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Fiyat grubu seçimi: <c>FATURA</c> (grup 1) · <c>ISTISNA</c> (grup 4) · <c>ASKERIYE</c> (grup 7).
    /// Carinin fatura tipi bu seçimden türetilir, ayrıca gönderilmez.
    /// </summary>
    [Required]
    [MaxLength(20)]
    public string PriceGroupKind { get; set; } = string.Empty;

    [MaxLength(50)]
    public string? SalesmanCode { get; set; }

    [MaxLength(120)]
    public string? City { get; set; }

    [MaxLength(120)]
    public string? District { get; set; }

    [MaxLength(500)]
    public string? Address { get; set; }

    [MaxLength(50)]
    public string? Phone { get; set; }

    [MaxLength(150)]
    public string? Email { get; set; }

    [MaxLength(150)]
    public string? TaxOffice { get; set; }

    [MaxLength(50)]
    public string? TaxNumber { get; set; }
}
