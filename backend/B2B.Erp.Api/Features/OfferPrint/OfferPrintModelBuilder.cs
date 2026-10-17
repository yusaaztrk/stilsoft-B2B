using B2B.Erp.Api.Data;
using B2B.Erp.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace B2B.Erp.Api.Features.OfferPrint;

/// <summary>Fills the printed offer from a stored customer offer.</summary>
public sealed class OfferPrintModelBuilder
{
    private readonly AppDbContext _db;
    private readonly IWebHostEnvironment _env;

    public OfferPrintModelBuilder(AppDbContext db, IWebHostEnvironment env)
    {
        _db = db;
        _env = env;
    }

    public async Task<OfferPrintModel?> BuildAsync(int offerId, CancellationToken ct = default)
    {
        var header = await (
            from o in _db.Set<CustomerOffer>().AsNoTracking()
            join c in _db.Customers.AsNoTracking() on o.CustomerCode equals c.CustomerCode into cj
            from c in cj.DefaultIfEmpty()
            // MUHTELİF TEKLİF (2026-09-17 kullanıcı bildirimi: "muhtelif cari tekliflerinde ünvan,
            // yetkili ve GSM gelmiyor"). Muhtelif teklifin cari kodu YOK (CustomerCode null);
            // müşteri `MuhtelifCustomers` tablosunda duruyor. Yalnız Customers'a bakıldığı için üç
            // alan boş basılıyordu. Cari teklifi (BuildCariOfferAsync) bunu zaten yapıyordu.
            join m in _db.MuhtelifCustomers.AsNoTracking() on o.MuhtelifCustomerId equals m.Id into mj
            from m in mj.DefaultIfEmpty()
            join s in _db.Salesmen.AsNoTracking() on o.SalesmanCode equals s.SalesmanCode into sj
            from s in sj.DefaultIfEmpty()
            where o.Id == offerId
            select new
            {
                o.DocumentNo,
                o.ProformaDocumentNo,
                o.Date,
                o.Description,
                o.Subtotal,
                o.DiscountTotal,
                o.NetTotal,
                o.VatTotal,
                o.GrandTotal,
                o.SalesmanCode,
                // Muhtelif kaydı ÖNCE: oluşturma yolu muhtelif teklifin cari koduna "MUHTELIF" (ya da
                // muhtelif sonradan cariye dönüştüyse o kodu) yazıyor. O kodla bir cari bulunursa
                // genel bir ad basılırdı; teklifin asıl müşterisi muhtelif kaydındaki kişidir.
                CustomerName = m != null ? m.Name : (c != null ? c.Name : null),
                CustomerPhone = m != null && !string.IsNullOrWhiteSpace(m.Phone) ? m.Phone : (c != null ? c.Phone : null),
                SalesmanName = s != null ? s.Description : null,
                // Belge, TEKLİFİN kendi para birimini söyler (2026-08-17). Eskiden müşterinin
                // kartındaki döviz okunuyordu; o alan kaldırıldı (bir cariye her para biriminde
                // satış yapılır) ve dolarla fiyatlanmış teklif cari EUR diye € basılıyordu.
                CustomerCurrencyTypeId = o.CurrencyTypeId
            }).FirstOrDefaultAsync(ct);

        if (header is null) return null;

        var lines = await (
            from l in _db.Set<CustomerOfferLine>().AsNoTracking()
            join p in _db.Set<Product>().AsNoTracking() on l.StockCode equals p.StockCode into pj
            from p in pj.DefaultIfEmpty()
            join d in _db.ProductDetails.AsNoTracking() on l.StockCode equals d.StockCode into dj
            from d in dj.DefaultIfEmpty()
            where l.CustomerOfferId == offerId
            orderby l.LineNo
            select new
            {
                l.StockCode,
                l.Description,
                l.Quantity,
                l.UnitPrice,
                l.VatRate,
                l.DiscountType,
                l.DiscountValue,
                ProductName = p != null ? p.Name : null,
                Barcode = p != null ? p.Barcode : null,
                ImageUrl = p != null ? p.ImageUrl : null,
                Features = d != null ? d.Features : null
            }).ToListAsync(ct);

        var model = new OfferPrintModel
        {
            // Digits only: an offer is MT + 13 digits and becomes P + the same 13 as a proforma,
            // so printing the prefix would change the number the customer sees for what is the
            // same document.
            PiNo = DigitsOf(header.ProformaDocumentNo ?? header.DocumentNo),
            Tarih = header.Date,
            TicariUnvan = header.CustomerName ?? string.Empty,
            Yetkili = header.CustomerName ?? string.Empty,
            Gsm = header.CustomerPhone ?? string.Empty,
            TeklifVeren = Compose(header.SalesmanCode, header.SalesmanName),
            Aciklama = header.Description ?? string.Empty,
            AraToplam = header.Subtotal,
            Iskonto = header.DiscountTotal,
            KdvsizToplam = header.NetTotal,
            KdvToplam = header.VatTotal,
            GenelToplam = header.GrandTotal
        };

        ApplyCurrency(model, header.CustomerCurrencyTypeId);

        foreach (var l in lines)
        {
            var discounted = ApplyDiscount(l.UnitPrice, l.DiscountType, l.DiscountValue);

            model.Lines.Add(new OfferPrintLine
            {
                Barkod = l.Barcode ?? string.Empty,
                StokKodu = l.StockCode,
                StokAdi = Pick(l.Description, l.ProductName, l.StockCode),
                Miktar = l.Quantity,
                KdvOran = l.VatRate,
                BirimFiyat = l.UnitPrice,
                IndirimliFiyat = discounted,
                AraToplam = decimal.Round(l.Quantity * discounted, 2, MidpointRounding.AwayFromZero),
                Ozellikler = l.Features ?? string.Empty,
                GorselYolu = ResolveImagePath(l.ImageUrl)
            });
        }

        FillVatBands(model);
        return model;
    }

    /// <summary>
    /// Stamps the document's currency. TL teklifte alanlar BOŞ bırakılır — basımda TL çıktısı
    /// eskisiyle birebir aynı kalsın diye tek karar noktası burası.
    /// </summary>
    private static void ApplyCurrency(OfferPrintModel model, int offerCurrencyTypeId)
    {
        var normalized = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Normalize(offerCurrencyTypeId);
        model.ParaBirimiTipi = normalized;

        if (normalized == B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Try) return;

        model.ParaBirimiKodu = B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.ToCodeOrTry(normalized);
        model.ParaBirimiAdi = normalized switch
        {
            B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Eur => "EURO",
            B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Usd => "AMERİKAN DOLARI",
            B2B.Erp.Api.Core.Helpers.CurrencyTypeHelper.Gbp => "İNGİLİZ STERLİNİ",
            _ => string.Empty
        };
    }

    public async Task<OfferPrintModel?> BuildCariOfferAsync(int offerId, CancellationToken ct = default)
    {
        var header = await (
            from o in _db.Set<CariOffer>().AsNoTracking()
            join c in _db.Customers.AsNoTracking() on o.CustomerCode equals c.CustomerCode into cj
            from c in cj.DefaultIfEmpty()
            join m in _db.Set<BayiMuhtelifCustomer>().AsNoTracking() on o.BayiMuhtelifCustomerId equals m.Id into mj
            from m in mj.DefaultIfEmpty()
            join u in _db.Users.AsNoTracking() on o.CreateUser equals u.Username into uj
            from u in uj.DefaultIfEmpty()
            where o.Id == offerId
            select new
            {
                o.DocumentNo,
                o.ProformaDocumentNo,
                o.Date,
                o.Description,
                o.Subtotal,
                o.DiscountTotal,
                o.NetTotal,
                o.VatTotal,
                o.GrandTotal,
                CustomerName = c != null ? c.Name : (m != null ? m.Name : null),
                CustomerPhone = c != null ? c.Phone : (m != null ? m.Phone : null),
                CreatorTitle = u != null && !string.IsNullOrWhiteSpace(u.Unvan) ? u.Unvan : o.CreateUser,
                // Teklifin KENDİ para birimi (2026-08-17): carinin kartındaki döviz alanı yerine teklifin kendi CurrencyTypeId alanı kullanılır.
                CustomerCurrencyTypeId = o.CurrencyTypeId
            }).FirstOrDefaultAsync(ct);

        if (header is null) return null;

        var lines = await (
            from l in _db.Set<CariOfferLine>().AsNoTracking()
            join p in _db.Set<Product>().AsNoTracking() on l.StockCode equals p.StockCode into pj
            from p in pj.DefaultIfEmpty()
            join d in _db.ProductDetails.AsNoTracking() on l.StockCode equals d.StockCode into dj
            from d in dj.DefaultIfEmpty()
            where l.CariOfferId == offerId
            orderby l.LineNo
            select new
            {
                l.StockCode,
                l.Description,
                l.Quantity,
                l.UnitPrice,
                l.VatRate,
                l.DiscountType,
                l.DiscountValue,
                ProductName = p != null ? p.Name : null,
                Barcode = p != null ? p.Barcode : null,
                ImageUrl = p != null ? p.ImageUrl : null,
                Features = d != null ? d.Features : null
            }).ToListAsync(ct);

        var model = new OfferPrintModel
        {
            PiNo = DigitsOf(header.ProformaDocumentNo ?? header.DocumentNo),
            Tarih = header.Date,
            TicariUnvan = header.CustomerName ?? string.Empty,
            Yetkili = header.CustomerName ?? string.Empty,
            Gsm = header.CustomerPhone ?? string.Empty,
            TeklifVeren = header.CreatorTitle ?? string.Empty,
            Aciklama = header.Description ?? string.Empty,
            AraToplam = header.Subtotal,
            Iskonto = header.DiscountTotal,
            KdvsizToplam = header.NetTotal,
            KdvToplam = header.VatTotal,
            GenelToplam = header.GrandTotal
        };

        ApplyCurrency(model, header.CustomerCurrencyTypeId);

        foreach (var l in lines)
        {
            var discounted = ApplyDiscount(l.UnitPrice, l.DiscountType, l.DiscountValue);

            model.Lines.Add(new OfferPrintLine
            {
                Barkod = l.Barcode ?? string.Empty,
                StokKodu = l.StockCode,
                StokAdi = Pick(l.Description, l.ProductName, l.StockCode),
                Miktar = l.Quantity,
                KdvOran = l.VatRate,
                BirimFiyat = l.UnitPrice,
                IndirimliFiyat = discounted,
                AraToplam = decimal.Round(l.Quantity * discounted, 2, MidpointRounding.AwayFromZero),
                Ozellikler = l.Features ?? string.Empty,
                GorselYolu = ResolveImagePath(l.ImageUrl)
            });
        }

        FillVatBands(model);
        return model;
    }


    private static decimal ApplyDiscount(decimal unitPrice, CustomerOfferLineDiscountType type, decimal value)
        => type switch
        {
            CustomerOfferLineDiscountType.Percentage =>
                decimal.Round(unitPrice * (1 - value / 100m), 2, MidpointRounding.AwayFromZero),
            CustomerOfferLineDiscountType.Amount =>
                decimal.Round(Math.Max(0m, unitPrice - value), 2, MidpointRounding.AwayFromZero),
            _ => unitPrice
        };

    /// <summary>
    /// The three VAT boxes the form prints. A rate the form has no box for is left out of the
    /// bands but still counted in the totals, which come from the offer itself.
    /// </summary>
    private static void FillVatBands(OfferPrintModel model)
    {
        foreach (var line in model.Lines)
        {
            var vat = decimal.Round(line.AraToplam * line.KdvOran / 100m, 2, MidpointRounding.AwayFromZero);

            switch (decimal.Round(line.KdvOran, 0, MidpointRounding.AwayFromZero))
            {
                case 16: model.Kdv16Matrah += line.AraToplam; model.Kdv16 += vat; break;
                case 10: model.Kdv10Matrah += line.AraToplam; model.Kdv10 += vat; break;
                case 5: model.Kdv5Matrah += line.AraToplam; model.Kdv5 += vat; break;
            }
        }
    }

    /// <summary>
    /// Maps a stored image URL onto a file on disk.
    ///
    /// Several roots are tried because the uploads folder does not always sit under the running
    /// binary: launching from bin/Debug puts WebRootPath there, while the files live under the
    /// project. Looking only at WebRootPath silently produced offers with no pictures.
    /// </summary>
    private string? ResolveImagePath(string? imageUrl)
    {
        var url = (imageUrl ?? string.Empty).Trim();
        if (url.Length == 0) return null;

        var relative = url.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);

        var roots = new List<string>();
        if (!string.IsNullOrWhiteSpace(_env.WebRootPath)) roots.Add(_env.WebRootPath);
        roots.Add(Path.Combine(_env.ContentRootPath, "wwwroot"));
        roots.Add(Path.Combine(AppContext.BaseDirectory, "wwwroot"));

        // Walking up from the binary reaches the project's own wwwroot in a dev checkout.
        var walk = new DirectoryInfo(AppContext.BaseDirectory);
        for (var i = 0; i < 4 && walk is not null; i++, walk = walk.Parent)
        {
            roots.Add(Path.Combine(walk.FullName, "wwwroot"));
        }

        foreach (var root in roots.Where(r => !string.IsNullOrWhiteSpace(r)).Distinct())
        {
            var path = Path.Combine(root, relative);
            if (File.Exists(path)) return path;
        }

        return null;
    }

    private static string DigitsOf(string? value)
        => new((value ?? string.Empty).Where(char.IsDigit).ToArray());

    private static string Compose(string? code, string? name)
    {
        var c = (code ?? string.Empty).Trim();
        var n = (name ?? string.Empty).Trim();
        if (c.Length > 0 && n.Length > 0) return $"{c} - {n}";
        return n.Length > 0 ? n : c;
    }

    private static string Pick(params string?[] candidates)
        => candidates.FirstOrDefault(x => !string.IsNullOrWhiteSpace(x))?.Trim() ?? string.Empty;
}
