namespace B2B.Erp.Api.Entities;

public sealed class SalesOrder : AuditableEntity
{
    public int Id { get; set; }

    public string CustomerCode { get; set; } = string.Empty;
    public string DeliveryCustomerCode { get; set; } = string.Empty;

    /*
     * TESLİMAT ADRESİ ANLIK GÖRÜNTÜSÜ (snapshot).
     *
     * NEDEN SİPARİŞİN ÜSTÜNDE: adres cari kartında yaşıyor ve müşteri onu istediği zaman
     * değiştirebiliyor. Sipariş dökümü, montaj kaydı ve kargo kaydı adresi cariden okuduğu
     * sürece, müşterinin bugün yaptığı bir güncelleme AYLAR ÖNCE teslim edilmiş siparişin
     * adresini de değiştiriyordu — malın gerçekte nereye gittiği sistemde kalmıyordu.
     *
     * NULL BIRAKILABİLİR: yalnızca e-ticaret yolu dolduruyor. Bayi siparişlerinde ve bu
     * alanlar eklenmeden önce açılmış siparişlerde boş kalır; okuyucular boşken eskisi gibi
     * cari kartına düşer.
     */
    public string? DeliveryName { get; set; }
    public string? DeliveryPhone { get; set; }
    public string? DeliveryAddress { get; set; }
    public string? DeliveryCity { get; set; }
    public string? DeliveryDistrict { get; set; }

    public decimal Subtotal { get; set; }
    public decimal VatTotal { get; set; }
    public decimal GrandTotal { get; set; }

    public decimal CampaignDiscount { get; set; }
    public string? CampaignDetailsJson { get; set; }

    public int Status { get; set; }

    public string OrderNo { get; set; } = string.Empty;

    public string ProcessedBy { get; set; } = string.Empty;
    public DateTime ProcessedAt { get; set; }

    public ICollection<SalesOrderLine> Lines { get; set; } = new List<SalesOrderLine>();
}
