using System.Globalization;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Features.Ecommerce;

/// <summary>
/// Ödemesi onaylanmış e-ticaret siparişinin ARDINDAN yapılan işler.
///
/// NEDEN AYRI BİR SERVİS: "sipariş tamamlandı" anında birden fazla şey olması gerekiyor
/// (montaj kaydı, ileride kargo ve bildirim). Bunları <see cref="EcommercePaymentService"/>
/// içine serpiştirmek, ödeme kapanışını bu işlerin başarısına bağlardı — montaj kaydı
/// açılamadığı için tahsilatın "başarısız" sayılması, parası çekilmiş müşteriyi ekranda
/// hata ile karşılamak olurdu.
///
/// KURAL: bu servisin hiçbir adımı ödemeyi geri almaz. Adımlar tek tek denenir, patlayan
/// adım LOG'a yazılır ve diğerleri devam eder. Ödemenin kendisi zaten kaydedilmiştir.
///
/// KURAL 2: her adım TEKRAR ÇALIŞTIRILABİLİR olmalı. Banka geri çağrısı iki kez gelebilir,
/// mağaza durum sorgusunu her sayfa yenilemesinde tekrarlar. İkinci çalıştırma ikinci bir
/// montaj kaydı üretmemeli.
/// </summary>
public sealed class EcommerceFulfilmentService
{
    /// <summary>
    /// İptal edilmiş e-ticaret siparişinin <see cref="SalesOrder.Status"/> damgası.
    ///
    /// Alan bugüne kadar hiç kullanılmıyordu (sipariş açılırken 0 yazılıp bir daha
    /// değiştirilmiyordu). İptal için ayrı bir kolon açmak yerine bu alan kullanılıyor;
    /// yan etkisi de doğru yönde: limit/risk raporu açık siparişi <c>Status == 0</c> ile
    /// süzdüğü için iptal edilen sipariş müşterinin riskinden kendiliğinden düşüyor.
    /// </summary>
    public const int CancelledStatus = 9;

    private readonly AppDbContext _dbContext;
    private readonly ServiceOpsCargoClient _cargo;
    private readonly ILogger<EcommerceFulfilmentService> _logger;

    public EcommerceFulfilmentService(
        AppDbContext dbContext,
        ServiceOpsCargoClient cargo,
        ILogger<EcommerceFulfilmentService> logger)
    {
        _dbContext = dbContext;
        _cargo = cargo;
        _logger = logger;
    }

    /// <summary>
    /// Sipariş numarasından yola çıkarak tamamlama adımlarını çalıştırır.
    /// Hiçbir zaman fırlatmaz — çağıran ödeme akışını bu yüzden kesmemeli.
    /// </summary>
    public async Task RunAsync(string salesOrderNo, CancellationToken ct)
    {
        // Adımlar AYRI AYRI korunuyor. Tek try içinde olsalardı montaj kaydında çıkan bir
        // hata kargo kaydını da atlar, sipariş teslimat ekranına hiç düşmezdi — hatanın
        // görünmediği, sessiz yanlış davranış üreten hâli.
        try
        {
            await CreateInstallationsAsync(salesOrderNo, ct);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "[Ecommerce] Montaj kaydı adımı başarısız. OrderNo={OrderNo}. " +
                "ÖDEME KAYDEDİLDİ, yalnızca bu adım eksik kaldı.",
                salesOrderNo);
        }

        try
        {
            await CreateCargoTaskAsync(salesOrderNo, null, ct);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "[Ecommerce] Teslimat (kargo) kaydı adımı başarısız. OrderNo={OrderNo}. " +
                "ÖDEME KAYDEDİLDİ, yalnızca bu adım eksik kaldı.",
                salesOrderNo);
        }
    }

    /// <summary>
    /// Siparişin teslimat (kargo) kaydını açar; varsa günceller.
    ///
    /// NE ZAMAN AÇILIR — DEĞİŞTİ (2026-09-09 kullanıcı kararı). Eskiden kayıt yalnızca FATURA
    /// kesilince açılıyordu; müşteri parasını ödedikten sonra faturası kesilene kadar sistemde
    /// teslimata dair hiçbir iz olmuyordu. Artık ödeme onaylanır onaylanmaz kayıt
    /// "Siparişiniz Alındı" durumunda açılıyor, fatura kesilince aynı kayıt fatura
    /// numarasıyla güncelleniyor ve beş aşama oradan yürüyor
    /// (Alındı, Planlandı, Hazırlanıyor, Dağıtımda, Teslim Edildi).
    ///
    /// MONTAJLI SATIRLAR KARGOYA GİRMEZ (2026-09-09 kullanıcı kararı): montajı seçilen ürünü
    /// montaj ekibi kendi götürüyor, kuryenin listesinde de çıkması çift teslimat demek olurdu.
    /// Siparişin TAMAMI montajlıysa kargo kaydı hiç açılmaz.
    ///
    /// TEKİLLİK ServiceOps tarafında, SİPARİŞ NUMARASI üzerinden. Bu metot ödeme geri
    /// çağrısında, sonuç sayfası her yenilendiğinde ve her faturada yeniden çalışabilir.
    /// </summary>
    /// <param name="invoiceNo">Fatura kesildiyse numarası; ödeme anında null.</param>
    public async Task CreateCargoTaskAsync(string salesOrderNo, string? invoiceNo, CancellationToken ct)
    {
        var order = await _dbContext.Set<SalesOrder>()
            .AsNoTracking()
            .Include(x => x.Lines)
            .FirstOrDefaultAsync(x => x.OrderNo == salesOrderNo, ct);

        if (order is null)
        {
            _logger.LogWarning("[Kargo] Sipariş bulunamadı. OrderNo={OrderNo}", salesOrderNo);
            return;
        }

        // İptal edilmiş siparişin teslimatı açılmaz; iptal akışı var olan kaydı zaten siliyor.
        if (order.Status == CancelledStatus) return;

        var shipped = order.Lines.Where(x => !x.Montage).OrderBy(x => x.LineNo).ToList();
        var installedCount = order.Lines.Count(x => x.Montage);

        if (shipped.Count == 0)
        {
            _logger.LogInformation(
                "[Kargo] Siparişin tamamı montajlı, teslimat kaydı açılmadı. OrderNo={OrderNo}",
                salesOrderNo);
            return;
        }

        var stockCodes = order.Lines.Select(x => x.StockCode).Distinct().ToList();
        var productNames = await _dbContext.Products
            .AsNoTracking()
            .Where(x => stockCodes.Contains(x.StockCode))
            .Select(x => new { x.StockCode, x.Name })
            .ToDictionaryAsync(x => x.StockCode, x => x.Name, ct);

        string NameOf(string code) =>
            productNames.TryGetValue(code, out var name) && !string.IsNullOrWhiteSpace(name) ? name : code;

        /*
         * PAKET DÖKÜMÜ — "her ürün ayrı ayrı paketlerde" (2026-09-09 kullanıcı isteği).
         *
         * Kayıt sipariş başına TEK; içindeki ürünler numaralı paketler hâlinde yazılıyor.
         * Kuryenin ekranında tek satırlık "2 x Ürün, 1 x Ürün" metni vardı ve kaç koli
         * indirileceği okunmuyordu.
         */
        var details = new List<string>();
        var packageNo = 1;

        foreach (var line in shipped)
        {
            var quantity = line.Quantity % 1 == 0
                ? ((long)line.Quantity).ToString(CultureInfo.InvariantCulture)
                : line.Quantity.ToString("0.##", CultureInfo.InvariantCulture);

            details.Add($"Paket {packageNo++}: {quantity} x {NameOf(line.StockCode)} ({line.StockCode})");
        }

        if (installedCount > 0)
        {
            // Kuryenin "eksik yükledim" sanmaması için: siparişte başka kalem var ama onları
            // montaj ekibi götürüyor.
            details.Add($"NOT: {installedCount} kalem montajlı — teslimatını montaj ekibi yapacak, bu araca yüklenmez.");
        }

        if (!string.IsNullOrWhiteSpace(invoiceNo))
        {
            details.Add($"Fatura: {invoiceNo}");
        }

        var snapshotHasAddress = !string.IsNullOrWhiteSpace(order.DeliveryAddress)
            || !string.IsNullOrWhiteSpace(order.DeliveryName);

        var customer = snapshotHasAddress
            ? null
            : await _dbContext.Customers
                .AsNoTracking()
                .Where(x => x.CustomerCode == order.CustomerCode)
                // `Phone` 2026-09-10'da eklendi: kargo kaydına kuryenin arayacağı numara geçiyor.
                .Select(x => new { x.Name, x.Phone, x.Address, x.City, x.District })
                .FirstOrDefaultAsync(ct);

        var deliveryName = snapshotHasAddress ? order.DeliveryName : customer?.Name;
        // Telefon MONTAJ yolunda zaten aynı kuralla alınıyordu; kargo kaydına da geçirilmesi
        // 2026-09-10'da eklendi — kurye adrese yaklaşınca arayacağı numarayı listede
        // göremiyor, siparişi ayrıca e-ticaret panelinden aratmak zorunda kalıyordu.
        var cargoPhone = snapshotHasAddress ? order.DeliveryPhone : customer?.Phone;
        var address = string.Join(" ", new[]
        {
            snapshotHasAddress ? order.DeliveryAddress : customer?.Address,
            snapshotHasAddress ? order.DeliveryDistrict : customer?.District,
            snapshotHasAddress ? order.DeliveryCity : customer?.City
        }.Where(x => !string.IsNullOrWhiteSpace(x)));

        await _cargo.UpsertAsync(new CargoTaskPayload
        {
            OrderNumber = order.OrderNo,
            ProductDetails = string.Join("\n", details),
            CustomerName = string.IsNullOrWhiteSpace(deliveryName) ? order.CustomerCode : deliveryName,
            CustomerPhone = cargoPhone,
            DeliveryAddress = string.IsNullOrWhiteSpace(address) ? "Adres belirtilmedi" : address,
            OrderDate = order.ProcessedAt,
            InvoiceNo = invoiceNo
        }, ct);
    }

    /// <summary>
    /// Montaj gerektiren satırlar için Montaj Yönetimi kaydı açar.
    ///
    /// TEKİLLİK <c>SalesOrderLine.InstallationId</c> üzerinden: satır bir montaj kaydına
    /// bağlıysa yenisi açılmaz. Ayrı bir "işlendi" damgası tutulmuyor çünkü bağın kendisi
    /// zaten o bilgiyi taşıyor ve şema değişikliği gerektirmiyor — B2B'deki elle montaj
    /// açma ucu da (<c>SalesOrdersController</c>) aynı kontrolü yapıyor.
    ///
    /// Hangi satırın montaj istediği <c>SalesOrderLine.Montage</c> damgasından okunuyor,
    /// fiyat farkından değil: kampanyalı ya da KDV muaf satırda fiyat farkı yanıltır.
    /// </summary>
    private async Task CreateInstallationsAsync(string salesOrderNo, CancellationToken ct)
    {
        var order = await _dbContext.Set<SalesOrder>()
            .Include(x => x.Lines)
            .FirstOrDefaultAsync(x => x.OrderNo == salesOrderNo, ct);

        if (order is null)
        {
            _logger.LogWarning("[Ecommerce] Tamamlama: sipariş bulunamadı. OrderNo={OrderNo}", salesOrderNo);
            return;
        }

        var pending = order.Lines
            .Where(x => x.Montage && x.InstallationId is null)
            .ToList();

        if (pending.Count == 0) return;

        /*
         * ADRES ÖNCE SİPARİŞTEKİ ANLIK GÖRÜNTÜDEN.
         *
         * Sipariş açılırken teslimat bilgisi siparişin üstüne kopyalanıyor. Cari kartını
         * okumak, müşterinin sonradan yaptığı adres değişikliğini geçmiş siparişe de
         * yansıtırdı; montaj ekibi malın gideceği adresi değil, müşterinin BUGÜNKÜ adresini
         * görürdü.
         *
         * Anlık görüntü yoksa (bu alanlar eklenmeden önce açılmış sipariş) cari kartına
         * düşülüyor — eski kayıtlar için eskisi gibi çalışmak, hiç adres göstermemekten iyi.
         */
        var snapshotHasAddress = !string.IsNullOrWhiteSpace(order.DeliveryAddress)
            || !string.IsNullOrWhiteSpace(order.DeliveryName);

        var customer = snapshotHasAddress
            ? null
            : await _dbContext.Customers
                .AsNoTracking()
                .Where(x => x.CustomerCode == order.CustomerCode)
                .Select(x => new { x.Name, x.Phone, x.Address, x.City, x.District })
                .FirstOrDefaultAsync(ct);

        var deliveryName = snapshotHasAddress ? order.DeliveryName : customer?.Name;
        var deliveryPhone = snapshotHasAddress ? order.DeliveryPhone : customer?.Phone;
        var deliveryAddress = snapshotHasAddress ? order.DeliveryAddress : customer?.Address;
        var deliveryCity = snapshotHasAddress ? order.DeliveryCity : customer?.City;
        var deliveryDistrict = snapshotHasAddress ? order.DeliveryDistrict : customer?.District;

        var stockCodes = pending.Select(x => x.StockCode).Distinct().ToList();
        var productNames = await _dbContext.Products
            .AsNoTracking()
            .Where(x => stockCodes.Contains(x.StockCode))
            .Select(x => new { x.StockCode, x.Name })
            .ToDictionaryAsync(x => x.StockCode, x => x.Name, ct);

        var region = string.Join(" / ", new[] { deliveryDistrict, deliveryCity }
            .Where(x => !string.IsNullOrWhiteSpace(x)));

        var now = DateTime.UtcNow;
        var created = 0;

        foreach (var line in pending)
        {
            var installation = new Installation
            {
                DealerCode = order.CustomerCode,
                DealerName = deliveryName ?? order.CustomerCode,
                ProductName = productNames.TryGetValue(line.StockCode, out var name) ? name : line.StockCode,
                Quantity = line.Quantity,
                InstallationName = deliveryName,
                InstallationPhone = deliveryPhone,
                Address = deliveryAddress ?? string.Empty,
                Region = region,
                DealerDescription = $"E-Ticaret siparişi {order.OrderNo}",
                SalesOrderLineId = line.Id,
                CreateUser = "ETICARET",
                CreateTime = now
            };

            _dbContext.Set<Installation>().Add(installation);
            await _dbContext.SaveChangesAsync(ct);

            line.InstallationId = installation.Id;
            line.EditUser = "ETICARET";
            line.EditTime = now;
            await _dbContext.SaveChangesAsync(ct);

            created++;
        }

        _logger.LogInformation(
            "[Ecommerce] Montaj kaydı açıldı. OrderNo={OrderNo} Adet={Count}",
            order.OrderNo, created);
    }
}
