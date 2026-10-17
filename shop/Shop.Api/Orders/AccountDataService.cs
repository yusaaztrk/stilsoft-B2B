using System.Text.Json;
using Shop.Api.Catalog;
using Shop.Api.Erp;

namespace Shop.Api.Orders;

public sealed class AccountOrderLine
{
    public string StockCode { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string? Slug { get; init; }
    public string? ImageUrl { get; init; }
    public decimal Quantity { get; init; }
    public decimal UnitPrice { get; init; }
    public decimal VatRate { get; init; }
    public decimal LineGross { get; init; }

    /// <summary>
    /// Bu satır için montaj İSTENDİ Mİ.
    ///
    /// Önceden montaj, montajlanabilir her üründe otomatikti ve bu alana ihtiyaç yoktu.
    /// Seçim müşteriye bırakılınca (2026-09-09) siparişin hangi satırında montaj olduğunu
    /// söyleyen tek kaynak bu damga oldu — fiyat farkı yanıltır, çünkü bedelsiz montaj da
    /// seçilebiliyor.
    /// </summary>
    public bool Montage { get; init; }
}

public sealed class AccountOrder
{
    public string OrderNo { get; init; } = string.Empty;
    public DateTime ProcessedAt { get; init; }
    public decimal Subtotal { get; init; }
    public decimal VatTotal { get; init; }
    public decimal GrandTotal { get; init; }

    public bool IsPaid { get; init; }
    public string PaymentStatus { get; init; } = string.Empty;
    public DateTime? PaidAt { get; init; }

    public string? InvoiceNo { get; init; }
    public DateTime? InvoiceDate { get; init; }

    /// <summary>Müşteriye tek kelimeyle "siparişim ne durumda" cevabı. Bkz. <see cref="ResolveStage"/>.</summary>
    public string Stage { get; init; } = string.Empty;
    public string StageLabel { get; init; } = string.Empty;

    public List<AccountOrderLine> Lines { get; init; } = new();
}

public sealed class AccountInvoiceLine
{
    public string StockCode { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public decimal Quantity { get; init; }
    public decimal UnitPrice { get; init; }
    public decimal VatRate { get; init; }
}

public sealed class AccountInvoice
{
    public string InvoiceNo { get; init; } = string.Empty;
    public DateTime Date { get; init; }
    public decimal NetTotal { get; init; }
    public decimal VatTotal { get; init; }
    public decimal GrandTotal { get; init; }
    public string? OrderNo { get; init; }
    public List<AccountInvoiceLine> Lines { get; init; } = new();
}

public sealed class AccountOrderDetail
{
    public AccountOrder Order { get; init; } = new();

    /// <summary>ServiceOps'tan gelen teslimat durumu; servise ulaşılamazsa null.</summary>
    public JsonElement? Delivery { get; init; }
}

/// <summary>
/// "Hesabım" ekranlarının verisi: siparişler, faturalar, teslimat.
///
/// Üçü de ERP'nin/ServiceOps'un verisi; mağaza hiçbirinin kopyasını tutmuyor. Buranın işi
/// toplamak ve müşterinin okuyabileceği hâle getirmek — örneğin sipariş satırlarında yalnızca
/// stok kodu var, müşteriye ürün adı ve resmi gerekiyor.
///
/// SAHİPLİK: bütün sorgular oturumdaki üyenin cari koduyla yapılıyor, istekten gelen bir kodla
/// değil. Sipariş numarasıyla gelen çağrılarda (teslimat) numara önce müşterinin kendi sipariş
/// listesinde aranıyor — ServiceOps siparişin kime ait olduğunu bilmiyor, o kontrolü yapacak
/// tek yer burası.
/// </summary>
public sealed class AccountDataService
{
    private readonly ErpWriteClient _erp;
    private readonly ServiceOpsClient _serviceOps;
    private readonly CatalogQueries _catalog;
    private readonly ILogger<AccountDataService> _logger;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public AccountDataService(
        ErpWriteClient erp,
        ServiceOpsClient serviceOps,
        CatalogQueries catalog,
        ILogger<AccountDataService> logger)
    {
        _erp = erp;
        _serviceOps = serviceOps;
        _catalog = catalog;
        _logger = logger;
    }

    /// <summary>
    /// Siparişin müşteriye gösterilecek aşaması.
    ///
    /// ERP'nin <c>SalesOrder.Status</c> alanına DOKUNULMUYOR: o alan limit/risk hesabında
    /// "açık sipariş" ölçütü olarak kullanılıyor, ekran için yeniden yorumlanamaz. Aşama
    /// bunun yerine zaten var olan üç gerçekten türetiliyor — ödendi mi, faturalandı mı,
    /// teslimat kaydı ne diyor.
    /// </summary>
    private static (string Stage, string Label) ResolveStage(bool isPaid, string paymentStatus, string? invoiceNo)
    {
        if (!isPaid)
        {
            return paymentStatus switch
            {
                "Pending" => ("awaiting_payment", "Ödeme bekleniyor"),
                "BankTransferRequested" => ("awaiting_payment", "Havale/EFT bekleniyor"),
                "BankTransferSent" => ("awaiting_payment", "Havale bildirildi — onay bekliyor"),
                "NeedsReview" => ("review", "Ödemeniz inceleniyor"),
                _ => ("payment_failed", "Ödeme tamamlanamadı")
            };
        }

        // Fatura kesildiyse sevkiyat hazırlanıyor demektir: bayi faturayı sevkiyat sırasında
        // kesiyor ve kargo kaydı fatura sonrası düşüyor.
        return string.IsNullOrWhiteSpace(invoiceNo)
            ? ("preparing", "Hazırlanıyor")
            : ("shipping", "Sevkiyata hazırlandı");
    }

    public async Task<IReadOnlyList<AccountOrder>> ListOrdersAsync(string customerCode, CancellationToken ct)
    {
        var response = await _erp.GetAsync($"/api/ecommerce/orders/{Uri.EscapeDataString(customerCode)}", ct);
        if (response is null) return Array.Empty<AccountOrder>();

        using (response)
        {
            if (!response.IsSuccessStatusCode) return Array.Empty<AccountOrder>();

            var body = await response.Content.ReadAsStringAsync(ct);

            try
            {
                using var doc = JsonDocument.Parse(body);
                var raw = doc.RootElement.GetProperty("data");

                var orders = new List<(RawOrder Order, List<RawLine> Lines)>();
                foreach (var element in raw.EnumerateArray())
                {
                    var order = JsonSerializer.Deserialize<RawOrder>(element.GetRawText(), JsonOptions);
                    if (order is null) continue;
                    orders.Add((order, order.Lines ?? new List<RawLine>()));
                }

                // Ürün adları tek sorguda: sipariş başına katalog çağırmak, 100 siparişlik bir
                // ekranda 100 sorgu demek olurdu.
                var codes = orders.SelectMany(x => x.Lines.Select(l => l.StockCode));
                var byCode = await _catalog.GetByStockCodesAsync(codes, ct);

                return orders.Select(x =>
                {
                    var (stage, label) = ResolveStage(x.Order.IsPaid, x.Order.PaymentStatus ?? string.Empty, x.Order.InvoiceNo);

                    return new AccountOrder
                    {
                        OrderNo = x.Order.OrderNo ?? string.Empty,
                        ProcessedAt = x.Order.ProcessedAt,
                        Subtotal = x.Order.Subtotal,
                        VatTotal = x.Order.VatTotal,
                        GrandTotal = x.Order.GrandTotal,
                        IsPaid = x.Order.IsPaid,
                        PaymentStatus = x.Order.PaymentStatus ?? string.Empty,
                        PaidAt = x.Order.PaidAt,
                        InvoiceNo = x.Order.InvoiceNo,
                        InvoiceDate = x.Order.InvoiceDate,
                        Stage = stage,
                        StageLabel = label,
                        Lines = x.Lines.Select(l => BuildLine(l, byCode)).ToList()
                    };
                }).ToList();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Sipariş listesi çözümlenemedi.");
                return Array.Empty<AccountOrder>();
            }
        }
    }

    /// <summary>
    /// Satırın müşteriye gösterilecek hâli.
    ///
    /// Ürün katalogdan düşmüş olabilir (satıştan kalkmış, gizlenmiş). O zaman ad yerine stok
    /// kodu gösteriliyor — geçmiş sipariş, ürünün bugünkü durumuna göre boş görünmemeli.
    /// Fiyat ve adet HER ZAMAN siparişten okunuyor, katalogdan değil: sipariş verildiği günkü
    /// fiyat neyse o. Katalogdaki güncel fiyatı göstermek, müşteriye ödemediği bir tutarı
    /// göstermek olurdu.
    /// </summary>
    private static AccountOrderLine BuildLine(RawLine line, IReadOnlyDictionary<string, CatalogItem> byCode)
    {
        byCode.TryGetValue(line.StockCode ?? string.Empty, out var product);

        var gross = Math.Round(line.UnitPrice * (1m + line.VatRate / 100m) * line.Quantity, 2, MidpointRounding.AwayFromZero);

        return new AccountOrderLine
        {
            StockCode = line.StockCode ?? string.Empty,
            Name = product?.Name ?? line.StockCode ?? string.Empty,
            Slug = product?.Slug,
            ImageUrl = product?.ImageUrl,
            Quantity = line.Quantity,
            UnitPrice = line.UnitPrice,
            VatRate = line.VatRate,
            LineGross = gross,
            Montage = line.Montage
        };
    }

    public async Task<IReadOnlyList<AccountInvoice>> ListInvoicesAsync(string customerCode, CancellationToken ct)
    {
        var response = await _erp.GetAsync($"/api/ecommerce/invoices/{Uri.EscapeDataString(customerCode)}", ct);
        if (response is null) return Array.Empty<AccountInvoice>();

        using (response)
        {
            if (!response.IsSuccessStatusCode) return Array.Empty<AccountInvoice>();

            try
            {
                using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
                var raw = doc.RootElement.GetProperty("data");

                var invoices = new List<RawInvoice>();
                foreach (var element in raw.EnumerateArray())
                {
                    var invoice = JsonSerializer.Deserialize<RawInvoice>(element.GetRawText(), JsonOptions);
                    if (invoice is not null) invoices.Add(invoice);
                }

                var codes = invoices.SelectMany(x => (x.Lines ?? new()).Select(l => l.StockCode));
                var byCode = await _catalog.GetByStockCodesAsync(codes, ct);

                return invoices.Select(x => new AccountInvoice
                {
                    InvoiceNo = x.InvoiceNo ?? string.Empty,
                    Date = x.Date,
                    NetTotal = x.NetTotal,
                    VatTotal = x.VatTotal,
                    GrandTotal = x.GrandTotal,
                    OrderNo = x.OrderNo,
                    Lines = (x.Lines ?? new()).Select(l => new AccountInvoiceLine
                    {
                        StockCode = l.StockCode ?? string.Empty,
                        Name = byCode.TryGetValue(l.StockCode ?? string.Empty, out var p) ? p.Name : l.StockCode ?? string.Empty,
                        Quantity = l.Quantity,
                        UnitPrice = l.UnitPrice,
                        VatRate = l.VatRate
                    }).ToList()
                }).ToList();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Fatura listesi çözümlenemedi.");
                return Array.Empty<AccountInvoice>();
            }
        }
    }

    /// <summary>
    /// Tek siparişin ayrıntısı + teslimat durumu.
    ///
    /// Sipariş, müşterinin KENDİ listesinden seçiliyor. Bu tesadüfi değil: teslimat sorgusu
    /// ServiceOps'a gidiyor ve ServiceOps siparişin sahibini bilmiyor. Numara burada
    /// doğrulanmazsa, numarayı bilen herkes başkasının teslimat bilgisini okuyabilirdi.
    /// Bulunamayan sipariş null döner — "yok" ile "senin değil" aynı cevabı verir.
    /// </summary>
    public async Task<AccountOrderDetail?> GetOrderDetailAsync(string customerCode, string orderNo, CancellationToken ct)
    {
        var orders = await ListOrdersAsync(customerCode, ct);
        var order = orders.FirstOrDefault(x => string.Equals(x.OrderNo, orderNo, StringComparison.Ordinal));

        if (order is null) return null;

        return new AccountOrderDetail
        {
            Order = order,
            Delivery = await _serviceOps.GetDeliveryAsync(order.OrderNo, ct)
        };
    }

    // ERP yanıtının ham karşılıkları. Ayrı tutuluyor ki ERP'nin alan adları müşteriye giden
    // sözleşmeye sızmasın.
    private sealed class RawOrder
    {
        public string? OrderNo { get; set; }
        public DateTime ProcessedAt { get; set; }
        public decimal Subtotal { get; set; }
        public decimal VatTotal { get; set; }
        public decimal GrandTotal { get; set; }
        public bool IsPaid { get; set; }
        public string? PaymentStatus { get; set; }
        public DateTime? PaidAt { get; set; }
        public string? InvoiceNo { get; set; }
        public DateTime? InvoiceDate { get; set; }
        public List<RawLine>? Lines { get; set; }
    }

    private sealed class RawLine
    {
        public string? StockCode { get; set; }
        public decimal Quantity { get; set; }
        public decimal UnitPrice { get; set; }
        public decimal VatRate { get; set; }

        /// <summary>Müşteri bu satır için montaj istedi mi (ERP'deki `SalesOrderLine.Montage`).</summary>
        public bool Montage { get; set; }
    }

    private sealed class RawInvoice
    {
        public string? InvoiceNo { get; set; }
        public DateTime Date { get; set; }
        public decimal NetTotal { get; set; }
        public decimal VatTotal { get; set; }
        public decimal GrandTotal { get; set; }
        public string? OrderNo { get; set; }
        public List<RawLine>? Lines { get; set; }
    }
}
