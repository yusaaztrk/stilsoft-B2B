namespace B2B.Erp.Api.Entities;

public sealed class SalesOrderLine : AuditableEntity
{
    public int Id { get; set; }

    public int SalesOrderId { get; set; }
    public SalesOrder SalesOrder { get; set; } = null!;

    public int? InstallationId { get; set; }
    public Installation? Installation { get; set; }

    public string StockCode { get; set; } = string.Empty;

    public string? Description { get; set; }

    public decimal Quantity { get; set; }
    public decimal UnitPrice { get; set; }
    public int CurrencyTypeId { get; set; }
    public decimal CurrencyRate { get; set; }
    public decimal CurrencyUnitPrice { get; set; }
    public decimal VatRate { get; set; }

    public bool IsGift { get; set; }

    public decimal DiscountAmount { get; set; }

    public int LineNo { get; set; }

    public string? CampaignCode { get; set; }
    public bool Montage { get; set; }
    public int? GroupId { get; set; }

    public string OrderNo { get; set; } = string.Empty;

    public Guid? LineageId { get; set; }

    /// <summary>
    /// SERVİSTEN GELEN KALEMİN ÇIKIŞ DEPOSU (kullanıcı kuralı, 2026-08-13).
    ///
    /// Servis programından bir fatura taslağı düştüğünde, parçayı fiilen kullanan kişinin araç
    /// deposu buraya damgalanır. Satış faturası ekranı bu değeri o kalemin ÖNTANIMLI çıkış deposu
    /// olarak getirir; kullanıcı isterse değiştirir.
    ///
    /// Neden kalemde: faturayı imzalayan müdürün tek deposu (ör. Haspolat) olabilir ama parça
    /// teknisyenin arabasından çıkmıştır. Fatura seviyesinde tek depo tutulduğu sürece stok
    /// yanlış depodan düşüyordu.
    ///
    /// Servis dışı kalemlerde NULL — orada depo faturanın kendi seçiminden gelir.
    /// </summary>
    public int? SourceWarehouseCode { get; set; }

    /// <summary>
    /// İşlemi yapan servis personelinin adı. Yalnızca gösterim/izleme için: satış faturasında
    /// kalemin yanındaki "SERVİS" rozetinin ipucunda kimin deposundan çıktığı yazıyor.
    /// </summary>
    public string? ServicePerformerName { get; set; }

    public ICollection<Installation> Installations { get; set; } = new List<Installation>();
}
