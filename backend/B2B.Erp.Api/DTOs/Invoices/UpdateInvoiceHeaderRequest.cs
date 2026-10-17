using System.ComponentModel.DataAnnotations;

namespace B2B.Erp.Api.Dtos.Invoices;

public sealed class UpdateInvoiceHeaderRequest
{
    [MaxLength(15)]
    public string? InvoiceNo { get; set; }

    [MaxLength(50)]
    public string? CustomerCode { get; set; }

    [MaxLength(50)]
    public string? CustomerInvoiceTypeOverride { get; set; }

    [MaxLength(500)]
    public string? Description { get; set; }

    [MaxLength(200)]
    public string? InstallationName { get; set; }

    [MaxLength(50)]
    public string? InstallationPhone { get; set; }

    /// <summary>
    /// Yeni fatura tarihi. Verilmezse dokunulmaz. YALNIZ satış / açık satış faturasında
    /// geçerli — alış/hizmet/iade faturasında yok sayılır (tedarikçi ekstresi senkronu
    /// henüz bu uçta yok). Saat kısmı atılır, gece yarısı + Kind=Utc olarak saklanır
    /// (oluşturma yoluyla aynı).
    /// </summary>
    public DateTime? Date { get; set; }

    public Guid? PriceGroupId { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? ExchangeRate { get; set; }
}
