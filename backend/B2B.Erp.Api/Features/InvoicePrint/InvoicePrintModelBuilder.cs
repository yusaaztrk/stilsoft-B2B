using B2B.Erp.Api.Core.Accounting;
using B2B.Erp.Api.Core.Helpers;
using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Features.InvoicePrint;

/// <summary>
/// Fills the printed form from an invoice.
///
/// This replaces the legacy VW_FATURA_DIZAYN_DATA view: the old ERP resolved the same fields in
/// SQL, including a pre-rendered amount in words. Everything is read here instead so the print
/// has one source of truth with the rest of the system.
/// </summary>
public sealed class InvoicePrintModelBuilder
{
    private readonly AppDbContext _db;

    public InvoicePrintModelBuilder(AppDbContext db) => _db = db;

    public async Task<InvoicePrintModel?> BuildAsync(int invoiceId, CancellationToken ct = default)
    {
        var header = await (
            from inv in _db.Set<Invoice>().AsNoTracking()
            join c in _db.Customers.AsNoTracking() on inv.CustomerCode equals c.CustomerCode into cj
            from c in cj.DefaultIfEmpty()
            where inv.Id == invoiceId
            select new
            {
                inv.Date,
                inv.Subtotal,
                inv.Discount,
                inv.CampaignDiscount,
                inv.NetTotal,
                inv.VatTotal,
                inv.GrandTotal,
                inv.CurrencyTypeId,
                inv.ExchangeRate,
                inv.SalesmanCode,
                inv.Description,
                inv.CustomerNameOverride,
                inv.CustomerCode,
                inv.CustomerInvoiceTypeOverride,
                inv.DeliveryCustomerCode,
                inv.SourceCustomerOfferId,
                CustomerName = c != null ? c.Name : null,
                c!.Address,
                c.District,
                c.City,
                c.TaxOffice,
                c.TaxNumber,
                CustomerSalesmanCode = c.SalesmanCode
            }).FirstOrDefaultAsync(ct);

        if (header is null) return null;

        // ŞUBEYE TESLİM ADRESİ — YALNIZ ŞUBE SATIŞINDA.
        //
        // Fatura ana cariye kesilir, mal şubeye gider; başlıkta ana carinin adresi yazdığı için
        // malın nereye gideceği kâğıtta hiç görünmüyordu.
        //
        // ⚠️ "Teslim carisi farklı" koşulu YETMEZ. `DeliveryCustomerCode` bu sistemde neredeyse
        // her faturada dolu ve çoğunda BAYİ'yi gösteriyor (34 faturanın 30'unda farklı, 26'sında
        // teslim carisi Bayi). Yalnız farklılığa bakılsaydı satır neredeyse HER faturaya
        // basılırdı; kullanıcı kuralı ise açıkça "sadece şube satışlarında" (2026-08-20).
        // Bu yüzden ölçüt teslim carisinin TİPİ: Şube.
        //
        // Biçim referans çıktıdan: "TESLIM : {adres}   {ilçe} / {il}" — adresten sonra ÜÇ boşluk,
        // eğik çizginin iki yanında birer boşluk. Başlıktaki "{ilçe}/{il}" ile aynı değil, çünkü
        // referansta bu satır boşluklu yazıyor.
        var teslimAdres = string.Empty;
        var deliveryCode = (header.DeliveryCustomerCode ?? string.Empty).Trim();
        if (deliveryCode.Length > 0
            && !string.Equals(deliveryCode, (header.CustomerCode ?? string.Empty).Trim(), StringComparison.OrdinalIgnoreCase))
        {
            var d = await _db.Customers.AsNoTracking()
                .Where(x => x.CustomerCode == deliveryCode)
                .Select(x => new { x.Address, x.District, x.City, x.CustomerType })
                .FirstOrDefaultAsync(ct);

            var tip = (d?.CustomerType ?? string.Empty).Trim().ToLowerInvariant();
            if (d is not null && (tip == "şube" || tip == "sube"))
            {
                var adres = (d.Address ?? string.Empty).Trim();
                var ilce = (d.District ?? string.Empty).Trim();
                var il = (d.City ?? string.Empty).Trim();

                // İlçe/il ikilisi yalnız en az biri doluysa eklenir; boş cari "ADRES    / " gibi
                // anlamsız bir kuyruk bırakmasın.
                var yer = (ilce.Length > 0 || il.Length > 0) ? $"{ilce} / {il}" : string.Empty;

                teslimAdres = (adres.Length > 0 && yer.Length > 0) ? $"{adres}   {yer}"
                            : adres.Length > 0 ? adres
                            : yer;
            }
        }

        // FATURA KENDİ PARA BİRİMİNDE BASILIR.
        //
        // Dolar kesilen bir fatura TL rakamlarla ve yazıyla "… TL … KR" diyerek çıkıyordu —
        // müşteriye lira borcu iddia eden bir belge. TL faturada (CurrencyTypeId 0 veya 1)
        // aşağıdaki dönüşüm hiç çalışmaz; çıktı birebir eskisi gibi.
        //
        // ⚠️ BAŞLIK TOPLAMLARI KURA BÖLÜNMEZ. Başlık toplamlarının hep TL olduğu varsayılıp
        // `GrandTotal / kur` yapılıyordu. Bu varsayım fatura yazan yollarda TUTMUYOR:
        // sipariş/fatura yolu başlığı TL yazıyor (65-68 no'lu faturalar: kalem 417.221,11 TL /
        // 8.727,27 USD), proformadan aktarım yolu ise başlığı doğrudan BELGENİN parasında
        // yazıyor (74 no'lu fatura: GrandTotal 1.500 = dolar tutarı). İkincisinde bölme
        // 1.500 USD'yi 31,30 USD'ye çeviriyordu.
        //
        // Bu yüzden belge parasındaki toplamlar KALEMLERDEN kuruluyor: kalemin dövizli birim
        // fiyatı (`CurrencyUnitPrice`) her iki yolda da doğru. İndirim ve KDV başlıktan ORAN
        // olarak alınır — oran para biriminden bağımsızdır, dolayısıyla başlığın hangi
        // konvansiyonda yazıldığı önemsizleşir ve kolonlar kâğıt üzerinde toplamayı tutturur.
        var currencyTypeId = CurrencyTypeHelper.Normalize(header.CurrencyTypeId);
        var isForeign = !CurrencyTypeHelper.IsTry(currencyTypeId);
        var rate = header.ExchangeRate <= 0 ? 1m : header.ExchangeRate;

        var lines = await (
            from l in _db.Set<InvoiceLine>().AsNoTracking()
            join p in _db.Set<Product>().AsNoTracking() on l.StockCode equals p.StockCode into pj
            from p in pj.DefaultIfEmpty()
            // The installation hangs off the sales order line, the same path the invoice line
            // list uses — that is where the MONTAJ name on the form comes from.
            join sol in _db.Set<SalesOrderLine>().AsNoTracking() on l.SalesOrderLineId equals (int?)sol.Id into solj
            from sol in solj.DefaultIfEmpty()
            join ins in _db.Set<Installation>().AsNoTracking() on sol.InstallationId equals ins.Id into insj
            from ins in insj.DefaultIfEmpty()
            where l.InvoiceId == invoiceId
            orderby l.LineNo
            select new
            {
                l.StockCode,
                l.Description,
                l.Quantity,
                l.UnitPrice,
                l.CurrencyUnitPrice,
                l.VatRate,
                ProductName = p != null ? p.Name : null,
                Barcode = p != null ? p.Barcode : null,
                Unit = p != null ? p.Unit : null,
                // MONTAJ ADI İKİ YOLDAN BİRDEN ARANIR (2026-08-21).
                //
                // Aşağıdaki join yalnızca SİPARİŞ satırı üzerinden gidiyor
                // (InvoiceLine → SalesOrderLine.InstallationId → Installation) ve bu bağ
                // TEK BİR YERDE kuruluyor: satış faturası oluşturulurken YENİ montaj
                // yaratıldığında (InvoicesController, `soLineEntity.InstallationId = newInst.Id`).
                //
                // Ama montaj çoğu zaman fatura ekranındaki kalem yanı "Montaj Ekle" düğmesiyle
                // ekleniyor; o uç (`lines/{invoiceLineId}/installations`) montajı FATURA
                // KALEMİNE bağlıyor (`Installation.InvoiceLineId`) ve sipariş satırındaki
                // `InstallationId` alanına HİÇ dokunmuyor. Sonuç: montaj kaydı var, ekranda
                // görünüyor, ama basımda MONTAJ satırı boş çıkıyordu.
                //
                // Önce doğrudan fatura kalemine bağlı montaja bakılıyor, yoksa eski sipariş
                // satırı yoluna düşülüyor. İki yol da boşsa satır zaten basılmaz.
                InstallationName =
                    _db.Set<Installation>().AsNoTracking()
                        .Where(x => x.InvoiceLineId == l.Id)
                        .Select(x => x.InstallationName)
                        .FirstOrDefault()
                    ?? (ins != null ? ins.InstallationName : null),
                // Kalem kampanyası (siparişin TAMAMI için, TL çapası) — KDV kırılımı bunu kendi
                // kaleminden düşer, bkz. KampanyaKalemDagilimi.
                SiparisKampanyasi = sol != null && !sol.IsGift ? sol.DiscountAmount : 0m,
                SiparisAdedi = sol != null ? sol.Quantity : 0m,
                SiparisParaBirimi = sol != null ? sol.CurrencyTypeId : 0,
                SiparisKuru = sol != null ? sol.CurrencyRate : 0m
            }).ToListAsync(ct);

        // Kalemin belge parasındaki birim fiyatı: `CurrencyUnitPrice` doluysa o, değilse
        // TL fiyatın kura bölünmüşü (eski, dövizli alanı boş kalmış satırlar).
        decimal DocUnitPrice(decimal unitPrice, decimal currencyUnitPrice)
            => !isForeign
                ? unitPrice
                : (currencyUnitPrice > 0
                    ? currencyUnitPrice
                    : decimal.Round(unitPrice / rate, 2, MidpointRounding.AwayFromZero));

        // Başlıktan yalnızca ORANLAR okunur; tutarlar kalemlerden kurulur.
        var headerSubtotal = header.Subtotal;
        var discountRatio = headerSubtotal > 0m ? (headerSubtotal - header.NetTotal) / headerSubtotal : 0m;
        if (discountRatio < 0m) discountRatio = 0m;
        if (discountRatio > 1m) discountRatio = 1m;
        var vatRatio = header.NetTotal > 0m ? header.VatTotal / header.NetTotal : 0m;
        if (vatRatio < 0m) vatRatio = 0m;

        decimal R(decimal v) => decimal.Round(v, 2, MidpointRounding.AwayFromZero);

        var docSubtotal = isForeign
            ? R(lines.Sum(l => l.Quantity * DocUnitPrice(l.UnitPrice, l.CurrencyUnitPrice)))
            : header.Subtotal;
        var docDiscount = isForeign ? R(docSubtotal * discountRatio) : R(header.Subtotal - header.NetTotal);
        var docNetTotal = isForeign ? R(docSubtotal - docDiscount) : header.NetTotal;
        var docVatTotal = isForeign ? R(docNetTotal * vatRatio) : header.VatTotal;
        var docGrandTotal = isForeign ? R(docNetTotal + docVatTotal) : header.GrandTotal;

        // MONTAJ GİRİLMEMİŞSE "MAĞAZA" YAZILIR (2026-08-21 kullanıcı kuralı).
        //
        // Form MONTAJ satırını HER faturada basıyor (bkz. InvoiceFormRenderer); montaj yoksa
        // kâğıtta "MONTAJ :" diye boş kuyruklu bir satır kalıyordu. Montaj kaydı olmayan satış
        // mağazadan teslim edilen satıştır, kâğıtta da öyle görünmeli.
        var montajAdi = Pick(lines.Select(x => x.InstallationName).ToArray());
        if (string.IsNullOrWhiteSpace(montajAdi)) montajAdi = "MAĞAZA";

        var model = new InvoicePrintModel
        {
            // The override wins: an invoice issued to a one-off name must print that name.
            CariAdi = Pick(header.CustomerNameOverride, header.CustomerName),
            Adres = header.Address ?? string.Empty,
            Ilce = header.District ?? string.Empty,
            Il = header.City ?? string.Empty,
            Tarih = header.Date,
            VergiDairesi = header.TaxOffice ?? string.Empty,
            VergiNo = header.TaxNumber ?? string.Empty,

            // The form prints the salesman beside "TESLİM ALAN". The invoice's own salesman is
            // preferred over the customer's default, because that is who actually sold it.
            PlasiyerKodu = Pick(header.SalesmanCode, header.CustomerSalesmanCode),

            // Form tek bir MONTAJ satırı taşıyor, o yüzden montajı olan İLK kalem satırı
            // adlandırıyor. Hiçbirinde yoksa yukarıda "MAĞAZA"ya düşülüyor.
            Montaj = montajAdi,

            Not = header.Description ?? string.Empty,

            // AÇIK FATURA → KAŞE YOK (kullanıcı kuralı, 2026-08-21).
            //
            // İki ölçüt de kabul ediliyor çünkü her faturada ikisi birden dolu değil: cari kodu
            // "-2" ile biterse fatura açık cari alt hesabına yazılmıştır (-1 resmî, -2 açık,
            // -3 muaf), tip alanı da ayrıca "ACIK" tutulur. Alt hesapları olmayan eski
            // kayıtlarda yalnız tip alanı doludur; tersi de olabilir.
            AcikFatura =
                (header.CustomerCode ?? string.Empty).Trim().EndsWith("-2", StringComparison.Ordinal)
                || string.Equals((header.CustomerInvoiceTypeOverride ?? string.Empty).Trim(), "ACIK", StringComparison.OrdinalIgnoreCase),

            TeslimAdres = teslimAdres,

            AraToplam = docSubtotal,
            // İskonto BRÜT−NET farkından okunur. `Invoice.Discount` kampanya indirimini ZATEN
            // içeriyor (`discount = manualDiscount + campaignDiscount`, InvoicesController:2722),
            // o yüzden `Discount + CampaignDiscount` kampanyayı iki kez basıyor ve çıktıda
            // "Ara Toplam − İskonto ≠ Net" çıkıyordu. Yalnız `Discount` da yetmez: mobil araç
            // satışı yolu `Discount = 0` bırakıp indirimin tamamını `CampaignDiscount`a yazıyor
            // (InvoicesController:4458). Fark her iki yolda da toplam indirime eşit.
            Iskonto = docDiscount,
            NetToplam = docNetTotal,
            KdvToplam = docVatTotal,
            GenelToplam = docGrandTotal,

            ParaBirimiTipi = currencyTypeId,
            // TL faturada kod BOŞ: referans çıktılarda para birimi yazmıyor ve TL faturanın
            // görüntüsü değişmemeli. Yalnızca dövizli faturada başlığa basılır.
            ParaBirimiKodu = isForeign ? CurrencyTypeHelper.ToCodeOrTry(currencyTypeId) : string.Empty,
            Kur = isForeign ? rate : 1m
        };

        foreach (var l in lines)
        {
            // Birim fiyat faturanın kendi parasından okunur (toplamlarla AYNI kaynak).
            var unitPrice = DocUnitPrice(l.UnitPrice, l.CurrencyUnitPrice);

            model.Lines.Add(new InvoicePrintLine
            {
                Barkod = l.Barcode ?? string.Empty,
                // The line's own description overrides the catalogue name, matching what the
                // rest of the app shows for manually described lines.
                // ÜRÜN ADI ÖNCE, AÇIKLAMA SONRA (2026-08-21 kullanıcı bildirimi).
                //
                // Sıra tersineydi: kalemin açıklaması doluysa kâğıda ÜRÜN ADI YERİNE o
                // yazılıyordu. Kullanıcı sipariş satırına not düştüğünde ("MEHMETÇİK BAYİYE
                // GİDECEK") fatura o notu ürün adı sütununda basıyor, müşteri ne aldığını
                // kâğıttan okuyamıyordu.
                //
                // Açıklama tamamen atılmıyor: hizmet ve serbest metin kalemlerinin (HİZ-TAMİR,
                // HİZ-TESLİMAT) katalogda ürün karşılığı YOKTUR, `ProductName` boş gelir ve
                // taşıdıkları tek metin açıklamadır. Onlar aynen basılmaya devam ediyor.
                // Açıklamanın YALNIZ İLK SATIRI basılır (2026-08-21).
                //
                // Servis kalemlerinin açıklaması iki satırlı: 1) "Servis Onarım İşçilik Bedeli -
                // ÜRÜN", 2) müşteri adı ve telefonu. İkinci satır Satış Faturası ekranındaki NOT
                // kutusuna gitsin diye orada duruyor ama KÂĞIDA GİRMEZ — kalem adı sütunu tek
                // satırlık ve sağında sabit konumlu KDV/miktar/fiyat sütunları var.
                StokAdi = Pick(FirstLine(l.ProductName), FirstLine(l.Description), l.StockCode),
                UrunAdi = Pick(l.ProductName, l.StockCode),
                KdvOran = l.VatRate,
                Miktar = l.Quantity,
                OlcuBirimi = ShortUnit(l.Unit),
                Fiyat = unitPrice,
                Tutar = decimal.Round(l.Quantity * unitPrice, 2, MidpointRounding.AwayFromZero)
            });
        }

        IReadOnlyList<decimal>? lineDiscounts;
        if (header.SourceCustomerOfferId.HasValue)
        {
            lineDiscounts = await LoadOfferLineDiscountsAsync(
                header.SourceCustomerOfferId.Value,
                lines.Select(x => (x.StockCode, x.Quantity)).ToList(),
                model.Iskonto,
                ct);
        }
        else
        {
            // SİPARİŞTEN GELEN KAMPANYALI FATURA (2026-09-30): kalem kampanyası kendi kaleminden
            // düşülür. Orantılı dağıtım başlığı zaten tutuyorsa null döner, kırılım eskisi gibi.
            var kalemler = new List<KampanyaKalemDagilimi.Kalem>(lines.Count);
            for (var i = 0; i < lines.Count; i++)
            {
                var l = lines[i];
                var tutar = model.Lines[i].Tutar;
                kalemler.Add(new KampanyaKalemDagilimi.Kalem(
                    tutar,
                    SiparisKampanyasi(l.SiparisKampanyasi, l.SiparisAdedi, l.Quantity, l.SiparisParaBirimi, l.SiparisKuru, tutar),
                    l.VatRate));
            }
            lineDiscounts = KampanyaKalemDagilimi.KalemIndirimleri(kalemler, model.NetToplam, model.KdvToplam);
        }

        FillVatBands(model, lineDiscounts);
        return model;
    }

    /// <summary>
    /// PROFORMADAN GELEN FATURADA İNDİRİM KALEM BAZINDADIR (2026-09-23 kullanıcı bildirimi).
    ///
    /// Proformada indirim kaleme verilir (ör. set kampanyası yalnız çamaşır makinesi + TV'ye,
    /// yanındaki %16'lık askı aparatına değil). Aktarım (`CustomerOffersController.TransferToInvoice`)
    /// KDV'yi kalem kalem DOĞRU hesaplıyor ama `InvoiceLine`'da indirim alanı olmadığı için
    /// kalem indirimi yalnız başlıkta toplam olarak kalıyor. Basım da onu bantlara oransal
    /// yayınca kırılım proformadan farklı ve TOPLAM K.D.V.'yi tutmayan rakamlar basıyordu:
    ///   proforma: ( 603,45) %16 96,55   ( 39.723,80) %5 1.986,19   toplam 2.082,74
    ///   fatura  : ( 498,74) %16 79,80   ( 39.828,51) %5 1.991,42   toplam 2.082,74 (?)
    ///
    /// İndirimler proforma kalemlerinden aktarımdaki formülle yeniden kurulur (belgenin kendi
    /// parasında). Eşleşme stok kodu + miktarla; herhangi bir kalem eşleşmezse ya da toplam
    /// başlıktaki indirimi tutmazsa (fatura sonradan değişmiş demektir) null döner ve basım
    /// eski oransal dağıtıma düşer.
    /// </summary>
    private async Task<IReadOnlyList<decimal>?> LoadOfferLineDiscountsAsync(
        int customerOfferId,
        IReadOnlyList<(string StockCode, decimal Quantity)> invoiceLines,
        decimal headerDiscount,
        CancellationToken ct)
    {
        var offerLines = await _db.Set<CustomerOfferLine>().AsNoTracking()
            .Where(x => x.CustomerOfferId == customerOfferId)
            .OrderBy(x => x.Id)
            .Select(x => new { x.StockCode, x.Quantity, x.UnitPrice, x.DiscountType, x.DiscountValue })
            .ToListAsync(ct);

        if (offerLines.Count != invoiceLines.Count) return null;

        var used = new bool[offerLines.Count];
        var matched = new List<int>(invoiceLines.Count);

        foreach (var (stockCode, quantity) in invoiceLines)
        {
            var idx = -1;
            for (var i = 0; i < offerLines.Count; i++)
            {
                if (used[i]) continue;
                if (offerLines[i].Quantity != quantity) continue;
                if (!string.Equals(offerLines[i].StockCode.Trim(), (stockCode ?? string.Empty).Trim(), StringComparison.OrdinalIgnoreCase)) continue;
                idx = i;
                break;
            }
            if (idx < 0) return null;
            used[idx] = true;
            matched.Add(idx);
        }

        // İki hesap denenir: güncel kural (tutar indirimi ADET BAŞINA, 2026-08-22) ve ondan
        // önce kesilmiş faturalar için eski kural (tutar SATIRIN TAMAMINA). Hangisinin
        // uygulandığı faturada yazmıyor; toplamı başlıktaki indirimi tutan kabul edilir.
        foreach (var perUnit in new[] { true, false })
        {
            var result = new List<decimal>(matched.Count);
            foreach (var idx in matched)
            {
                var o = offerLines[idx];
                var lineBase = o.Quantity * o.UnitPrice;
                var discount = o.DiscountType switch
                {
                    CustomerOfferLineDiscountType.Amount => Math.Max(0m, o.DiscountValue) * (perUnit ? o.Quantity : 1m),
                    CustomerOfferLineDiscountType.Percentage => Math.Max(0m, lineBase * (o.DiscountValue / 100m)),
                    _ => 0m
                };
                if (discount > lineBase) discount = lineBase;
                result.Add(discount);
            }

            if (Math.Abs(result.Sum() - headerDiscount) <= 0.05m) return result;
        }

        return null;
    }

    /// <summary>
    /// Kalemin faturadaki kampanya payı, BELGENİN PARASINDA — satış faturasının hesabıyla aynı
    /// (InvoicesController.CreateSalesInvoice): sipariş kaleminin indirimi (TL çapası) dövizli
    /// kalemde siparişin donmuş kuruna bölünür, fatura adedi / sipariş adedi oranında alınır ve
    /// kalemin tutarını aşamaz.
    /// </summary>
    private static decimal SiparisKampanyasi(
        decimal indirim,
        decimal siparisAdedi,
        decimal faturaAdedi,
        int paraBirimi,
        decimal kur,
        decimal tutar)
    {
        if (indirim <= 0m || siparisAdedi <= 0m || faturaAdedi <= 0m) return 0m;

        var oran = faturaAdedi / siparisAdedi;
        if (oran > 1m) oran = 1m;

        var belgeParasinda = paraBirimi > 1 && kur > 0m ? indirim / kur : indirim;
        var pay = belgeParasinda * oran;
        return pay > tutar ? tutar : pay;
    }

    /// <summary>
    /// The form has three fixed VAT boxes — 16, 10 and 5 — and prints all of them, zeros
    /// included, because the captions are already on the paper. Lines are grouped into those
    /// bands; a rate the form has no box for is left out of the bands but still counted in the
    /// totals, which come from the invoice itself.
    /// </summary>
    private static void FillVatBands(InvoicePrintModel model, IReadOnlyList<decimal>? lineDiscounts)
    {
        // KDV MATRAHI İNDİRİM DÜŞÜLMÜŞ TUTAR ÜZERİNDEN (2026-08-22 kullanıcıdan geldi).
        //
        // `line.Tutar` satırın İNDİRİMSİZ tutarı; indirim fatura BAŞLIĞINDA tutuluyor, satırlara
        // dağıtılmıyor. Bu yüzden kırılım satırı brüt matrahı yazıyor ve kendi KDV'sini brütten
        // hesaplıyordu, TOPLAM K.D.V. ise başlıktan (net üzerinden) geliyordu. Kâğıtta iki farklı
        // KDV rakamı duruyor ve alt toplamı tutturmuyordu:
        //   ( 29.741,40) K.D.V. (% 16,00)  4.758,62   ← brütten
        //   TOPLAM K.D.V.                  3.206,90   ← netten (doğru olan)
        //
        // İndirim belge geneline verildiği için bantlara ORANTILI dağıtılıyor: her bandın matrahı
        // net/brüt oranıyla küçültülüyor. Tek bantlı faturada sonuç TOPLAM K.D.V. ile birebir
        // aynı çıkar; çok bantlıda indirim bantlar arasında tutarları oranında paylaşılır.
        // İndirim yoksa oran 1'dir ve çıktı eskisiyle BİREBİR aynı kalır.
        var indirimOrani = model.AraToplam > 0m && model.Iskonto > 0m
            ? model.NetToplam / model.AraToplam
            : 1m;

        // Kalem indirimi biliniyorsa (proformadan gelen fatura ya da siparişten gelen kampanyalı
        // fatura) oran yerine o kullanılır — bkz. LoadOfferLineDiscountsAsync, KampanyaKalemDagilimi.
        for (var i = 0; i < model.Lines.Count; i++)
        {
            var line = model.Lines[i];
            var rate = decimal.Round(line.KdvOran, 0, MidpointRounding.AwayFromZero);
            var baseAmount = lineDiscounts is not null
                ? decimal.Round(line.Tutar - lineDiscounts[i], 2, MidpointRounding.AwayFromZero)
                : decimal.Round(line.Tutar * indirimOrani, 2, MidpointRounding.AwayFromZero);
            var vat = decimal.Round(baseAmount * line.KdvOran / 100m, 2, MidpointRounding.AwayFromZero);

            switch (rate)
            {
                case 16:
                    model.Kdv16Matrah += baseAmount;
                    model.Kdv16 += vat;
                    break;
                case 10:
                    model.Kdv10Matrah += baseAmount;
                    model.Kdv10 += vat;
                    break;
                case 5:
                    model.Kdv5Matrah += baseAmount;
                    model.Kdv5 += vat;
                    break;
            }
        }
    }

    /// <summary>
    /// The unit as the form prints it: two letters.
    ///
    /// The column between the unit and the unit price is 0.72 cm wide — about four characters —
    /// and the price is right-aligned into it, so a full "ADET" runs straight into the figure.
    /// Every legacy invoice prints the two-letter form ("AD" for ADET, "MT" for METRE), which is
    /// what this reproduces.
    /// </summary>
    private static string ShortUnit(string? unit)
    {
        var u = (unit ?? string.Empty).Trim();
        if (u.Length == 0) return "AD";
        return u.Length <= 2 ? u.ToUpperInvariant() : u[..2].ToUpperInvariant();
    }

    /// <summary>
    /// Çok satırlı bir metnin ilk satırı. Kâğıttaki tek satırlık alanlara yazarken kullanılır;
    /// satır sonu karakteri PDF'e olduğu gibi giderse metin bozuk çıkar.
    /// </summary>
    private static string? FirstLine(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return value;
        var idx = value.IndexOfAny(new[] { '\r', '\n' });
        return idx < 0 ? value : value[..idx].TrimEnd();
    }

    private static string Pick(params string?[] candidates)
        => candidates.FirstOrDefault(x => !string.IsNullOrWhiteSpace(x))?.Trim() ?? string.Empty;
}
