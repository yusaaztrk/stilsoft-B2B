using System.Text;
using Npgsql;
using Shop.Api.Infrastructure;

namespace Shop.Api.Catalog;

/// <summary>
/// Katalog okumaları — firmanın ERP veritabanından, SALT OKUNUR.
///
/// Neden doğrudan veritabanı: ürün, fiyat ve kategori ERP'nin verisi ve mağaza bunları yalnızca
/// okuyor. Her liste isteğinde ERP API'sine oturum açıp sayfalama yapmak hem yavaş hem kırılgan
/// olurdu. YAZMA işlemleri (cari açma, sipariş, ödeme) buradan geçmez; onlar ERP API'sine gider,
/// çünkü orada iş kuralları var.
///
/// Vitrinde görünme kuralı tek yerde: <see cref="PublishedPredicate"/>. Ürün aktif olacak,
/// görseli olacak ve katalog fiyat grubunda sıfırdan büyük fiyatı olacak. Kullanıcının kararı
/// buydu: "aktif + görselli + fiyatlı olanlar otomatik açık".
/// </summary>
public sealed class CatalogQueries
{
    private readonly TenantResolver _tenant;
    private readonly Storefront.StorefrontStore _storefront;
    private readonly CampaignPricing _campaigns;

    public CatalogQueries(TenantResolver tenant, Storefront.StorefrontStore storefront, CampaignPricing campaigns)
    {
        _tenant = tenant;
        _storefront = storefront;
        _campaigns = campaigns;
    }

    /// <summary>
    /// B2B kampanyalarını (e-ticaret anahtarı açık olanlar) okunan satırlara uygular. Açık
    /// kampanya yoksa listeye dokunmaz — bkz. <see cref="CampaignPricing"/>.
    /// </summary>
    private Task ApplyCampaignsAsync(NpgsqlConnection conn, IList<CatalogItem> items, IReadOnlyDictionary<string, decimal> rates, CancellationToken ct)
        => _campaigns.ApplyAsync(conn, _tenant.TenantCode, items, rates, ct);

    private const string PublishedPredicate = """
        p."IsActive" = true
        AND COALESCE(p."ImageUrl", '') <> ''
        AND pp."Price" > 0
        """;

    /// <summary>
    /// Satışa kapanma eşiği girilmemiş üründe uygulanan varsayılan. B2B tarafındaki
    /// <c>AUTO_CLOSED_STOCK_THRESHOLD</c> ile aynı sayı olmak ZORUNDA: aynı ürün bayi
    /// ekranında kapalı, vitrinde açık görünmemeli.
    /// </summary>
    public const int DefaultAutoCloseThreshold = 12;

    /// <summary>Ürün neden vitrine çıkmıyor. <see cref="PublishBlock.None"/> = çıkıyor.</summary>
    public enum PublishBlock
    {
        None = 0,
        /// <summary>Bayi panelden elle kapatmış.</summary>
        Hidden = 1,
        /// <summary>Ürün kartında "Satışa Açık: Hayır" seçili (<c>BsyVisibleFlag = 'H'</c>).</summary>
        ClosedToSale = 2,
        /// <summary>Stok bitmiş.</summary>
        OutOfStock = 3,
        /// <summary>Stok, satışa kapanma eşiğinin altına düşmüş.</summary>
        CriticalStock = 4
    }

    /// <summary>
    /// YAYIN KURALININ TEK KARAR NOKTASI.
    ///
    /// Hem vitrin sorguları (süzmek için) hem bayi paneli (sebebini yazmak için) buradan
    /// geçiyor. İkisi ayrı yerlerde hesaplasaydı panel "yayında" derken vitrinde görünmeyen
    /// ürünler çıkardı — kullanıcının bugüne kadar hiçbir yerden göremediği durum tam olarak
    /// bu (2026-09-09: "biten ürünler gösterilmeyecek, kritik stoktakileri de görmemiz lazım").
    ///
    /// SIRA ÖNEMLİ: en "bilinçli" sebep önce yazılır. Bayi ürünü elle kapattıysa, stoğu da
    /// bitmiş olsa bile ekranda "elle kapatıldı" görmek ister — yoksa açtığında neden hâlâ
    /// görünmediğini anlamaz.
    /// </summary>
    public static PublishBlock ResolveBlock(
        CatalogItem item,
        Storefront.StorefrontSettings settings,
        IReadOnlyCollection<string> hiddenCodes,
        IReadOnlyCollection<string> alwaysPublishCodes)
    {
        if (hiddenCodes.Contains(item.StockCode)) return PublishBlock.Hidden;
        if (settings.HideClosedToSale && !item.MarkedOpenToSale) return PublishBlock.ClosedToSale;

        if (settings.HideOutOfStock && item.ActualStock <= 0) return PublishBlock.OutOfStock;

        if (!settings.StopPublishingBelowCriticalStock) return PublishBlock.None;

        // Eşik 0 ise kural devre dışı (B2B'deki davranışın aynısı: "mal stok bitene kadar
        // satılır"). Bayi ürünü tek tek de muaf tutabiliyor.
        if (item.AutoCloseThreshold <= 0) return PublishBlock.None;
        if (alwaysPublishCodes.Contains(item.StockCode)) return PublishBlock.None;

        return item.ActualStock < item.AutoCloseThreshold ? PublishBlock.CriticalStock : PublishBlock.None;
    }

    /// <summary>Sebebin bayi panelinde okunacak hâli.</summary>
    public static string BlockLabel(PublishBlock block) => block switch
    {
        PublishBlock.Hidden => "Panelden kapatıldı",
        PublishBlock.ClosedToSale => "Ürün kartında satışa kapalı",
        PublishBlock.OutOfStock => "Stok bitti",
        PublishBlock.CriticalStock => "Kritik stok — yayın durdu",
        _ => "Yayında"
    };

    /// <summary>
    /// Vitrine çıkmayacak ürünleri listeden düşürür. Karşılaştırma büyük/küçük harf duyarsız
    /// bir kümeyle yapılıyor: stok kodları ERP'de ve ayarlarda farklı yazılmış olabilir.
    /// </summary>
    private async Task<List<CatalogItem>> ApplyPublishRulesAsync(List<CatalogItem> rows, CancellationToken ct)
    {
        var settings = await _storefront.GetAsync(ct);
        var hidden = new HashSet<string>(await _storefront.HiddenStockCodesAsync(ct), StringComparer.OrdinalIgnoreCase);
        var always = new HashSet<string>(
            settings.AlwaysPublishStockCodes ?? new List<string>(), StringComparer.OrdinalIgnoreCase);

        return rows.Where(x => ResolveBlock(x, settings, hidden, always) == PublishBlock.None).ToList();
    }

    /*
      STOK DEPO HAREKETLERİNDEN HESAPLANIR — `Products."Stock"` KOLONUNDAN DEĞİL.

      <b>Neden (2026-09-09'da canlı veriyle kanıtlandı):</b> `Products."Stock"` tek yönlü
      bir sayaç. Satış faturası onu düşürüyor (`InvoicesController`: `p.Stock = p.Stock - delta`)
      ama ALIŞ faturası hiç artırmıyor — `PurchaseInvoicesController` o kolona hiç yazmıyor.
      Yani ilk aktarımdan başlayıp yalnızca azalıyor ve zamanla eksiye düşüyor.

      Ölçülen örnek: SET13035 için kolon **-98**, gerçek depo bakiyesi **107**. Canlıda
      **137 üründe** kolon ile bakiye tutmuyordu. Vitrin kolonu okuduğu için bu ürünleri
      "Stok bitti" sayıp yayından kaldırıyordu.

      ERP'nin kendi Ürün Yönetimi ekranı zaten bakiyeyi gösteriyor
      (`ProductsController`: `balanceByStockCode ... : p.stock`). İki ekranın aynı ürün için
      farklı sayı göstermesinin sebebi buydu; artık ikisi AYNI kaynağı okuyor.

      <b>Neden LATERAL, neden GROUP BY değil:</b> bütün `StockMovements` tablosunu her katalog
      sorgusunda gruplamak, hareket sayısı büyüdükçe ağırlaşır. LATERAL, ürün başına
      (`StockCode`, `WarehouseCode`) indeksini kullanarak yalnız o ürünün satırlarına bakar.

      <b>Enum METİN saklanıyor:</b> `Direction` bir char(1) — `'G'` giriş, `'C'` çıkış
      (`StockMovementDirection.In = 'G'`). Sayı bekleyen bir karşılaştırma sessizce 0 döndürürdü.

      <b>Kolon yine de yedek:</b> hiç hareketi olmayan üründe (`Bakiye` NULL) eski davranış
      korunuyor — el ile girilmiş açılış stoğu olan ürünler kaybolmasın.
    */
    private const string FromClause = """
        FROM public."Products" p
        JOIN public."ProductPrices" pp ON pp."ProductId" = p."Id"
        JOIN public."PriceGroups" pg ON pg."Id" = pp."PriceGroupId" AND pg."Code" = @priceGroup
        LEFT JOIN public."ProductCategories" c ON c."Id" = COALESCE(p."CategoryId", p."MainCategoryId")
        LEFT JOIN LATERAL (
            SELECT SUM(CASE WHEN sm."Direction" = 'G' THEN sm."Quantity" ELSE -sm."Quantity" END) AS "Bakiye"
            FROM public."StockMovements" sm
            WHERE sm."StockCode" = p."StockCode"
        ) smb ON TRUE
        """;

    /// <summary>
    /// Vitrinin kullandığı stok ifadesi. Tek yerde duruyor: SELECT listelerinde ve sayaç
    /// süzgeçlerinde AYNI hesap kullanılmazsa liste ile sayaç birbirini tutmaz.
    /// </summary>
    private const string StockExpr = """COALESCE(ROUND(smb."Bakiye"), p."Stock")::int""";

    private async Task<NpgsqlConnection> OpenAsync(CancellationToken ct)
    {
        var conn = new NpgsqlConnection(_tenant.ErpConnectionString());
        await conn.OpenAsync(ct);
        return conn;
    }

    /// <summary>
    /// Aramada karşılaştırılacak sütunu sadeleştiren SQL ifadesi.
    ///
    /// Küçük harfe indirir, Türkçe harfleri ASCII karşılığına çevirir ve BOŞLUKLARI ATAR.
    /// Boşlukların atılması "airfryer" aramasının "Air Fryer"ı bulmasını sağlıyor.
    ///
    /// `translate` karakter karakter eşliyor; kaynak listede karşılığı olmayan son karakter
    /// (boşluk) siliniyor. İki listenin uzunluğu bilerek farklı.
    /// </summary>
    private static string Norm(string column)
        => "lower(translate(" + column + ", '\u0130I\u0131\u015E\u015F\u011E\u011F\u00DC\u00FC\u00D6\u00F6\u00C7\u00E7 ', 'iiissgguuoocc'))";

    /// <summary>Açıklama metni: sadeleştirilir, harf/rakam dışı her şey (satır sonu, noktalama) tek boşluğa iner.</summary>
    private static string DescWords(string column)
        => "regexp_replace(" + NormKeepSpace(column) + ", '[^a-z0-9]+', ' ', 'g')";

    /// <summary><see cref="Norm"/> ile aynı sadeleştirme ama BOŞLUKLAR KALIR — kelime başı eşleşmesi için.</summary>
    private static string NormKeepSpace(string column)
        => "lower(translate(" + column + ", '\u0130I\u0131\u015E\u015F\u011E\u011F\u00DC\u00FC\u00D6\u00F6\u00C7\u00E7', 'iiissgguuoocc'))";

    /// <summary>
    /// Arama kelimesini <see cref="Norm"/> ile AYNI kurala göre sadeleştirir.
    ///
    /// İki taraf aynı kurala uymazsa arama sessizce boş döner — sütun sadeleşmiş, kelime
    /// sadeleşmemişse "ÜTÜ" satırı "utu" kelimesiyle eşleşmez.
    /// </summary>
    /*
     * ARAMA EŞ ANLAMLILARI (2026-09-21). Müşteri "siyah ocak" yazıyor, ERP adı "BLACK … OCAK";
     * "fritöz" yazıyor, ürün "AIR FRYER"; "çamaşır makinesi" yazıyor, ad "ÇAM MAK". Sıfır sonuç
     * = kaçan satış. Kelime, kendisi VEYA eş anlamlılarından biri geçiyorsa eşleşir.
     * Anahtarlar ve değerler `NormalizeForSearch` biçiminde (küçük, Türkçe karaktersiz, boşluksuz).
     */
    private static readonly Dictionary<string, string[]> SearchSynonyms = new(StringComparer.Ordinal)
    {
        ["siyah"] = new[] { "black" },
        ["black"] = new[] { "siyah" },
        ["beyaz"] = new[] { "white" },
        ["white"] = new[] { "beyaz" },
        ["gri"] = new[] { "grey", "gray", "silver", "gumus" },
        ["inoks"] = new[] { "inox" },
        ["celik"] = new[] { "inox", "steel" },
        ["fritoz"] = new[] { "airfryer", "fryer" },
        ["airfryer"] = new[] { "fryer", "fritoz" },
        ["camasir"] = new[] { "cammak", "washing" },
        ["bulasik"] = new[] { "bulmak", "dishwasher" },
        ["buzdolabi"] = new[] { "buzdlb", "fridge", "refrigerator" },
        ["dondurucu"] = new[] { "drndon", "freezer" },
        ["derin"] = new[] { "drn" },
        ["mikser"] = new[] { "mixer" },
        ["blender"] = new[] { "blendir" },
        ["utu"] = new[] { "iron" },
        ["supurge"] = new[] { "vacuum" },
        ["klima"] = new[] { "inverter", "btu" },
        ["tv"] = new[] { "televizyon" },
        ["televizyon"] = new[] { "tv" },
        ["mikrodalga"] = new[] { "microwave" },
        ["firin"] = new[] { "oven" },
        ["ocak"] = new[] { "hob" },
        ["davlumbaz"] = new[] { "hood", "aspirator" },
        ["aspirator"] = new[] { "davlumbaz" },
        ["kettle"] = new[] { "suisitici", "isitici" },
        ["caymakinesi"] = new[] { "cays", "caycı", "cayci" },
        ["cay"] = new[] { "cays", "cayci" },
        ["tost"] = new[] { "toaster", "izgara" },
        ["kahve"] = new[] { "coffee", "bikahve" },
        ["sackurutma"] = new[] { "fonmatik", "fon" },
        ["fon"] = new[] { "fonmatik", "sac" },
        ["tras"] = new[] { "shaver", "sakal" },
        ["epilator"] = new[] { "epilasyon" },
        ["terazi"] = new[] { "baskul", "tartar" },
        ["baskul"] = new[] { "terazi", "tartar" },
        ["yastik"] = new[] { "pillow" },
        ["yatak"] = new[] { "silte", "mattress" },
        ["silte"] = new[] { "yatak" },

        /*
          İNGİLİZCE ARAMALAR (2026-09-27, Talep Raporu: "hair dryer", "vacuum cleaner", "toaster",
          "pressure cooker", "kettle", "blender"… hepsi SIFIR sonuç). KKTC'deki yabancı müşteri
          siteyi Google Translate ile okuyor ama ürün adları Türkçe. Her kelime AYRI eşleşmek
          zorunda olduğu için iki kelimelik aramalarda İKİ kelimenin de karşılığı var
          ("hair" → saç, "dryer" → kurutma). Yaygın yazım hataları da burada (vaccuum, blendır).
        */
        ["hair"] = new[] { "sac" },
        ["dryer"] = new[] { "kurutma" },
        ["hairdryer"] = new[] { "sackurutma" },
        ["vacuum"] = new[] { "supurge" },
        ["vaccuum"] = new[] { "supurge" },
        ["vacum"] = new[] { "supurge" },
        ["cleaner"] = new[] { "supurge", "temizleyici" },
        ["hoover"] = new[] { "supurge" },
        ["toaster"] = new[] { "tost" },
        ["toast"] = new[] { "tost" },
        ["pressure"] = new[] { "duduklu" },
        ["cooker"] = new[] { "tencere", "ocak", "pisirici" },
        ["kettle"] = new[] { "suisitici", "kettle" },
        ["blender"] = new[] { "blender", "rondo" },
        ["blendir"] = new[] { "blender", "rondo" },
        ["frey"] = new[] { "fryer", "fritoz" },
        ["airfrey"] = new[] { "airfryer", "fryer" },
        ["fryer"] = new[] { "fritoz", "airfryer" },
        ["iron"] = new[] { "utu" },
        ["microwave"] = new[] { "mikrodalga" },
        ["television"] = new[] { "televizyon", "tv" },
        ["tv"] = new[] { "televizyon" },
        ["fridge"] = new[] { "buzdolabi" },
        ["refrigerator"] = new[] { "buzdolabi" },
        ["freezer"] = new[] { "derindondurucu", "dondurucu" },
        ["washing"] = new[] { "camasir", "cammak" },
        ["washer"] = new[] { "camasir", "cammak" },
        ["machine"] = new[] { "makine", "mak" },
        ["dishwasher"] = new[] { "bulasik" },
        ["oven"] = new[] { "firin" },
        ["aircon"] = new[] { "klima" },
        ["airconditioner"] = new[] { "klima" },
        ["conditioner"] = new[] { "klima" },
        ["heater"] = new[] { "isitici", "soba" },
        ["fan"] = new[] { "vantilator", "fan" },
        ["coffee"] = new[] { "kahve" },
        ["tea"] = new[] { "cay" },
        ["mixer"] = new[] { "mikser" },
        ["hood"] = new[] { "aspirator", "davlumbaz" },
        ["hob"] = new[] { "ocak" },
        ["stove"] = new[] { "ocak", "firin" },
        ["grill"] = new[] { "izgara", "tost" },
        ["scale"] = new[] { "terazi", "tarti" },
        ["sandwich"] = new[] { "tost" },
    };

    private static IReadOnlyList<string> SearchVariants(string token)
    {
        var key = NormalizeForSearch(token);
        if (key.Length == 0) return Array.Empty<string>();
        var list = new List<string> { key };
        if (SearchSynonyms.TryGetValue(key, out var syn)) list.AddRange(syn.Where(x => x != key));
        return list;
    }

    private static string NormalizeForSearch(string value)
    {
        const string from = "\u0130I\u0131\u015E\u015F\u011E\u011F\u00DC\u00FC\u00D6\u00F6\u00C7\u00E7";
        const string to = "iiissgguuoocc";

        var sb = new System.Text.StringBuilder(value.Length);
        foreach (var ch in value)
        {
            if (ch == ' ') continue;
            var i = from.IndexOf(ch);
            sb.Append(i >= 0 ? to[i] : char.ToLowerInvariant(ch));
        }

        return sb.ToString();
    }

    /// <summary>KDV dahil fiyat. Kuruş yuvarlaması tek yerde yapılır ki her ekranda aynı sayı çıksın.</summary>
    public static decimal ToGross(decimal net, int taxRate)
        => Math.Round(net * (1m + taxRate / 100m), 2, MidpointRounding.AwayFromZero);

    /// <summary>
    /// Stok adedinin vitrine çıkıp çıkmayacağı — TEK KARAR NOKTASI.
    ///
    /// Sorgular adedi her zaman okur (sipariş kapısı ve "son N adet" uyarısı ona bakıyor),
    /// ama ayar kapalıysa sayı API yanıtına hiç konmaz. Her liste ucunun bunu kendi başına
    /// hatırlaması gerekseydi, eklenecek ilk yeni uçta sayı sessizce dışarı sızardı.
    /// </summary>
    private async Task StripStockIfHiddenAsync(IEnumerable<CatalogItem> items, CancellationToken ct)
    {
        var settings = await _storefront.GetAsync(ct);
        var cap = settings.StockDisplayCap;

        foreach (var item in items)
        {
            if (!settings.ShowStockQuantity)
            {
                // Gizliyken alan yanıttan tamamen düşer. "0 gönder" ya da "null'la ama alanı
                // bırak" demek değil: sayı hiç gitmezse tarayıcıya da sızmaz.
                item.StockQuantity = null;
                item.StockCapped = false;
                continue;
            }

            if (cap > 0 && item.StockQuantity.HasValue && item.StockQuantity.Value >= cap)
            {
                item.StockQuantity = cap;
                item.StockCapped = true;
            }
            else
            {
                item.StockCapped = false;
            }
        }
    }

    /// <param name="includeHidden">
    /// Bayiden elle kapatılan ürünler de gelsin mi. Vitrin için her zaman false; yönetim
    /// ekranında true, çünkü orada kapalı olanı görüp tekrar açabilmek gerekiyor.
    /// </param>
    public async Task<CatalogPage> ListAsync(
        string? categorySlug,
        string? search,
        string sort,
        int page,
        int pageSize,
        CancellationToken ct,
        bool includeHidden = false,
        int maxPageSize = 96,
        decimal? minPrice = null,
        decimal? maxPrice = null,
        bool inStockOnly = false,
        bool installableOnly = false,
        bool campaignOnly = false)
    {
        page = page < 1 ? 1 : page;
        /*
         * SAYFA BOYUTU TAVANI ÇAĞIRANA GÖRE.
         *
         * Vitrin tarafında tavan 96'da kalıyor: `adet` sorgu dizesinden geliyor, yani
         * ziyaretçinin denetiminde; sınırsız bırakmak tek istekle bütün katalogu çektirmek
         * demek olurdu.
         *
         * YÖNETİM EKRANI FARKLI. Bayi panelindeki Ürün Yayını listesi 96'da kesiliyordu ve
         * canlıda 245 ürün var: alfabetik olarak 96'dan sonra gelen hiçbir ürün panelde
         * GÖRÜNMÜYORDU, dolayısıyla vitrine kapatılamıyordu da ("Tamir Servis" bu yüzden
         * bulunamadı, 2026-09-08). Panel listeyi tarayıcıda süzüp sayfalıyor, o yüzden
         * tamamını bir kerede alması doğru.
         */
        var effectiveMax = maxPageSize < 1 ? 96 : maxPageSize;
        pageSize = pageSize is < 1 || pageSize > effectiveMax ? 24 : pageSize;

        var orderBy = sort switch
        {
            "fiyat-artan" => "pp.\"Price\" ASC",
            "fiyat-azalan" => "pp.\"Price\" DESC",
            "yeni" => "p.\"CreatedAt\" DESC",
            "ilgi" => "pp.\"Price\" DESC", // arama yoksa "ilgi" anlamsiz; asagida skor eklenince one gecer
            _ => "p.\"Name\" ASC"
        };

        var filters = new List<string> { PublishedPredicate };
        if (!string.IsNullOrWhiteSpace(categorySlug)) filters.Add("c.\"Name\" IS NOT NULL");
        /*
         * ARAMA — KELİME KELİME, TÜRKÇE KARAKTERDEN BAĞIMSIZ, HER ALANDA.
         *
         * Nereden geldi: önce "airfryer" araması "Air Fryer" ürününü bulamıyordu (boşluk),
         * sonra "sebil" hiç sonuç vermiyordu (kelime ürün adında değil KATEGORİ adında),
         * sonra kullanıcı "her şeye göre arasın" dedi (2026-09-09).
         *
         * Üç kural:
         *
         * 1. KELİMELERE BÖLÜNÜR VE HEPSİ ARANIR. "siyah ankastre" yazan müşteri hem siyah
         *    hem ankastre geçen ürünü bekliyor; tek parça arayan eski hâl, kelimelerin
         *    sırası tutmadığı anda sıfır sonuç veriyordu. Her kelime ayrı `AND`, kelimenin
         *    kendisi alanlar arasında `OR` — yani biri addan, biri kategoriden gelebilir.
         *
         * 2. TÜRKÇE KARAKTER NORMALLEŞTİRİLİR. "utu" yazan "ÜTÜ"yü, "sarj" yazan "şarj"ı
         *    bulur. `ILIKE` bunu yapmıyor: Türkçe harfler ayrı karakterler. İki taraf da
         *    aynı `translate` ile sadeleştiriliyor.
         *
         * 3. ÜRÜN METNİ DE TARANIR. Ad, stok kodu, barkod, kategori ve ürün detayındaki
         *    açıklama/özellikler. Detay ayrı tabloda olduğu için `EXISTS` ile bakılıyor —
         *    `JOIN` satır çoğaltıp aynı ürünü iki kez listeleyebilirdi.
         *
         * Kelimeler PARAMETRE olarak bağlanıyor (@q0, @q1…); sorguya metin gömülmüyor.
         */
        var searchTokens = (search ?? string.Empty)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Take(6)
            .ToList();

        if (searchTokens.Count > 0)
        {
            for (var t = 0; t < searchTokens.Count; t++)
            {
                var variants = SearchVariants(searchTokens[t]);
                var ors = new List<string>();
                for (var k = 0; k < variants.Count; k++)
                {
                    var p = "@q" + t + "_" + k;
                    var d = "@d" + t + "_" + k;
                    ors.Add(
                        Norm("p.\"Name\"") + " LIKE " + p
                        + " OR " + Norm("COALESCE(p.\"DisplayName\",'')") + " LIKE " + p
                        + " OR " + Norm("p.\"StockCode\"") + " LIKE " + p
                        + " OR " + Norm("COALESCE(p.\"Barcode\",'')") + " LIKE " + p
                        + " OR " + Norm("COALESCE(c.\"Name\",'')") + " LIKE " + p
                        + " OR EXISTS (SELECT 1 FROM public.\"ProductDetails\" pd"
                        + " WHERE pd.\"StockCode\" = p.\"StockCode\""
                        // AÇIKLAMA YALNIZ KELİME BAŞINDAN (2026-10-04): Norm boşlukları sildiği için
                        // kelimeler birbirine yapışıp sahte eşleşme üretiyordu — "termostaT Var" içinde
                        // "tv" geçiyor, termosifon televizyon aramasında çıkıyordu. Açıklamada noktalama
                        // da boşluğa çevrilir ve kelimenin BAŞI aranır.
                        + " AND ((' ' || " + DescWords("COALESCE(pd.\"Description\",'')") + ") LIKE " + d
                        + " OR (' ' || " + DescWords("COALESCE(pd.\"Features\",'')") + ") LIKE " + d + "))");
                }
                if (ors.Count > 0) filters.Add("(" + string.Join(" OR ", ors) + ")");
            }
        }

        /*
         * İLGİ SIRALAMASI (2026-09-21). "ütü" arayan müşteriye ilk sırada 46.000 TL'lik klima
         * çıkıyordu: "utu" her alanda aranıyor (açıklamadaki "kutu", "buton"…) ve sonuç fiyata ya
         * da ada göre sıralanıyordu. Arama sonucunda sıra ALAKAYA göre olmalı: ad/vitrin adında
         * geçen önce, kelime BAŞINDA geçen daha önce, yalnız açıklamada geçen en sonda. Eşitlikte
         * stokta olan ve pahalı önce (kategori sayfasındaki alışkanlık).
         */
        if (searchTokens.Count > 0 && sort == "ilgi")
        {
            var parts = new List<string>();
            for (var t = 0; t < searchTokens.Count; t++)
            {
                var variants = SearchVariants(searchTokens[t]);
                for (var k = 0; k < variants.Count; k++)
                {
                    var p = "@q" + t + "_" + k;
                    var w = "@w" + t + "_" + k;
                    // Eş anlamlı eşleşmesi kelimenin kendisinden biraz düşük puan: "siyah" yazana
                    // adında "siyah" geçen, "black" geçenden önce gelsin.
                    var f = k == 0 ? 1.0 : 0.8;
                    parts.Add(
                        "(CASE WHEN " + Norm("p.\"Name\"") + " LIKE " + p + " OR " + Norm("COALESCE(p.\"DisplayName\",'')") + " LIKE " + p + " THEN " + (int)(100 * f) + " ELSE 0 END)"
                        + " + (CASE WHEN (' ' || " + NormKeepSpace("p.\"Name\"") + ") LIKE " + w + " OR (' ' || " + NormKeepSpace("COALESCE(p.\"DisplayName\",'')") + ") LIKE " + w + " THEN " + (int)(60 * f) + " ELSE 0 END)"
                        + " + (CASE WHEN " + Norm("COALESCE(c.\"Name\",'')") + " LIKE " + p + " THEN " + (int)(40 * f) + " ELSE 0 END)"
                        + " + (CASE WHEN " + Norm("p.\"StockCode\"") + " LIKE " + p + " OR " + Norm("COALESCE(p.\"Barcode\",'')") + " LIKE " + p + " THEN " + (int)(150 * f) + " ELSE 0 END)");
                }
            }
            orderBy = "(" + string.Join(" + ", parts) + ") DESC, (" + StockExpr + ") > 0 DESC, pp.\"Price\" DESC";
        }

        var where = "WHERE " + string.Join(" AND ", filters);

        await using var conn = await OpenAsync(ct);
        var rates = await LoadRatesAsync(conn, ct);
        var categorySlugMap = await CategorySlugMapAsync(ct);

        // Kategori eşlemesi ad üzerinden yapılır: kategori adresleri de addan türetiliyor,
        // dolayısıyla eşleşmeyi veritabanında değil bellekte yapmak gerekiyor (adres parçası
        // hesaplanmış bir değer, sütun değil). Kategori sayısı küçük olduğu için maliyeti yok.
        var rows = new List<CatalogItem>();
        var sql = $"""
            SELECT p."StockCode", COALESCE(NULLIF(p."DisplayName", ''), p."Name") AS "Name", p."ImageUrl", p."TaxRate", pp."Price", pp."Currency",
                   {StockExpr} AS "Stock", p."IsInstallable", p."InstallationFee", c."Name" AS category,
                   p."BsyVisibleFlag", p."BsyMinStock"
            {FromClause}
            {where}
            ORDER BY {orderBy}
            """;

        await using (var cmd = new NpgsqlCommand(sql, conn))
        {
            cmd.Parameters.AddWithValue("priceGroup", _tenant.CatalogPriceGroupCode);
            for (var t = 0; t < searchTokens.Count; t++)
            {
                var variants = SearchVariants(searchTokens[t]);
                for (var k = 0; k < variants.Count; k++)
                {
                    cmd.Parameters.AddWithValue("q" + t + "_" + k, "%" + variants[k] + "%");
                    cmd.Parameters.AddWithValue("d" + t + "_" + k, "% " + variants[k] + "%");
                    if (sort == "ilgi") cmd.Parameters.AddWithValue("w" + t + "_" + k, "% " + variants[k] + "%");
                }
            }

            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                rows.Add(MapItem(reader, rates, categorySlugMap));
            }
        }

        // Kampanya fiyatı süzgeç/sıralamadan ÖNCE: fiyat aralığı ve fiyata göre sıralama
        // müşterinin göreceği (indirimli) fiyata göre olmalı.
        await ApplyCampaignsAsync(conn, rows, rates, ct);

        if (!string.IsNullOrWhiteSpace(categorySlug))
        {
            /*
             * HEM YENİ HEM ESKİ ADRES KABUL EDİLİR (2026-09-20).
             *
             * Bayi bir kategoriye kendi adresini verdiğinde (G.HAZIR -> "gida-hazirlama")
             * ürünün `CategorySlug`'ı yeni adres olur. Ama eski adres paylaşılmış, yer
             * imine eklenmiş, Google'da indekslenmiş olabilir; onunla gelen istek boş sayfa
             * görmemeli. Vitrin eski adresi kalıcı olarak yenisine yönlendiriyor, burada da her
             * ikisi eşleşiyor — yönlendirme kaçsa bile ürünler kaybolmuyor.
             */
            rows = rows.Where(x =>
                string.Equals(x.CategorySlug, categorySlug, StringComparison.OrdinalIgnoreCase)
                || string.Equals(Slugify.ToSlug(x.CategoryName), categorySlug, StringComparison.OrdinalIgnoreCase)
            ).ToList();
        }

        /*
         * YAYIN KURALI — elle kapatma + satışa kapalı + stok (2026-09-09'da genişledi).
         *
         * Eskiden yalnızca "bayi elle kapattı mı" bakılıyordu; stoğu biten ürün listede
         * "Tükendi" rozetiyle duruyor, satışa kapanma eşiğinin altına düşen ürün ise B2B'de
         * bayiye kapalıyken vitrinde satılmaya devam ediyordu. Kural artık ikisini de
         * kapsıyor ve TEK YERDE (ResolveBlock).
         *
         * `includeHidden` yönetim ekranı içindir: panel kapalı ürünleri de görmek zorunda,
         * yoksa geri açmanın yolu kalmaz. Panel sebebi ayrıca yazıyor.
         */
        if (!includeHidden)
        {
            rows = await ApplyPublishRulesAsync(rows, ct);
        }

        /*
         * Fiyat ve stok süzgeci.
         *
         * FİYAT SÜZGECİ BELLEKTE, SQL'DE DEĞİL — bilinçli: veritabanındaki `Price` KDV HARİÇ
         * net fiyat, vitrinde gösterilen ve müşterinin süzdüğü rakam ise KDV DAHİL. Süzmeyi
         * SQL'e taşımak, KDV oranı ürüne göre değiştiği için "5.000 TL altı" diyen müşteriye
         * 5.400 TL'lik ürün göstermek olurdu. Liste zaten tamamen belleğe alınıp burada
         * sayfalanıyor (kategori eşlemesi de öyle), yani ek bir maliyeti yok.
         *
         * Süzgeç öncesi fiyat aralığı ekrana veriliyor: kullanıcı kutulara ne yazacağını
         * bilmeli, boş bir aralık kutusu tahmine zorlar.
         */
        var priceFloor = rows.Count > 0 ? rows.Min(x => x.GrossPrice) : 0m;
        var priceCeiling = rows.Count > 0 ? rows.Max(x => x.GrossPrice) : 0m;

        if (minPrice.HasValue) rows = rows.Where(x => x.GrossPrice >= minPrice.Value).ToList();
        if (maxPrice.HasValue) rows = rows.Where(x => x.GrossPrice <= maxPrice.Value).ToList();
        if (inStockOnly) rows = rows.Where(x => x.InStock).ToList();
        if (installableOnly) rows = rows.Where(x => x.IsInstallable).ToList();
        // Kampanya fiyatı yukarıda uygulandı; süzgeç gerçek indirimi olan ürünleri bırakır.
        if (campaignOnly) rows = rows.Where(x => x.OriginalGrossPrice.HasValue && x.OriginalGrossPrice.Value > x.GrossPrice).ToList();

        /*
         * TÜKENEN ÜRÜN LİSTENİN SONUNA (2026-09-20).
         *
         * Varsayılan sıralama "fiyat: azalan" olduğu için, stoğu biten pahalı bir ürün her
         * kategori sayfasının EN ÜSTÜNDE duruyordu: ziyaretçinin gördüğü ilk şey satın
         * alamayacağı ürün oluyor. Ürün listeden çıkarılmıyor (adresin yaşaması arama motoru
         * için değerli, "Tükendi" rozeti de bilgi) ama sıraca arkaya alınıyor.
         *
         * Yeniden SIRALAMA değil, KARARLI BÖLME: seçilen sıralama (fiyat/ad/tarih) her iki
         * küme içinde aynen korunuyor, yalnız kümeler yer değiştiriyor. Böylece sıralama
         * ölçütünü bellekte ikinci kez yazmak gerekmiyor.
         *
         * Panel görünümünde (includeHidden) dokunulmuyor: yönetim ekranı ürünü bıraktığı
         * yerde görmeli.
         */
        if (!includeHidden && !inStockOnly)
        {
            rows = rows.Where(x => x.InStock).Concat(rows.Where(x => !x.InStock)).ToList();
        }

        /*
         * RENK SEÇENEKLERİ TEK KARTTA (2026-09-20).
         *
         * ERP'de her renk ayrı stok kodu; liste aynı üründen doluyordu. Gruptan tek bir ürün
         * kalıyor, diğerleri listeden düşüyor — ADRESLERİ ÇALIŞMAYA DEVAM EDİYOR ve ürün
         * sayfasındaki renk seçicisinden, aramadan ve sepetten erişilebiliyorlar.
         *
         * Temsilci seçimi: önce stokta olan, sonra ucuz olan. "Stokta yok" görünen bir kart
         * yüzünden grubun tamamı satılamaz görünmemeli.
         *
         * Panel ayarı KAPALI başlıyor: gruplama ada bakan bir sezgi, bayi sonucu görüp açsın.
         */
        if (!includeHidden && (await _storefront.GetAsync(ct)).GroupColorVariants)
        {
            var groups = VariantGrouping.Build(rows);
            if (groups.Count > 0)
            {
                var temsilciler = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var (_, group) in groups)
                {
                    var temsilci = group
                        .OrderByDescending(x => x.InStock)
                        .ThenBy(x => x.GrossPrice)
                        .First();
                    temsilciler.Add(temsilci.StockCode);
                    foreach (var member in group) member.VariantCount = group.Count;
                }

                rows = rows
                    .Where(x => x.VariantGroupKey is null || temsilciler.Contains(x.StockCode))
                    .ToList();
            }
        }

        var total = rows.Count;
        var items = rows.Skip((page - 1) * pageSize).Take(pageSize).ToList();

        await StripStockIfHiddenAsync(items, ct);

        return new CatalogPage
        {
            Items = items,
            TotalCount = total,
            Page = page,
            PageSize = pageSize,
            MinPrice = priceFloor,
            MaxPrice = priceCeiling
        };
    }

    /// <summary>
    /// Verilen stok kodlarının katalog karşılıkları — sayfalama YOK.
    ///
    /// Sepet ve sipariş ekranları "elimde şu kodlar var, adları ve fiyatları ne" diye soruyor.
    /// Bunu <see cref="ListAsync"/> ile yapmak mümkün değil: orada sayfa boyutu en fazla 96'ya
    /// sıkıştırılıyor (satır 67), dolayısıyla ilk 96'nın dışında kalan bir ürün "listede yok"
    /// görünür. Sepette bunun bedeli ağırdı — kod, listede bulamadığı satırı "yayından kalkmış"
    /// sayıp SESSİZCE siliyordu; 163 ürünlü katalogda ürünlerin yaklaşık %40'ı sepette
    /// durmuyordu.
    ///
    /// Burada kodlarla sorulup kodlarla cevap alınıyor; kaç ürün olduğunun önemi yok.
    /// Yayın kuralı yine aynı (<see cref="PublishedPredicate"/> + bayiden kapatılanlar), çünkü
    /// satıştan kalkmış bir ürünün sepette durmaması DOĞRU davranış — yanlış olan, duran ürünü
    /// sırf listenin ikinci sayfasında diye kalkmış saymaktı.
    /// </summary>
    /// <summary>
    /// Anasayfada öne çıkacak ürünler.
    ///
    /// Bayi ürün seçtiyse önce onun seçtikleri, kendi verdiği sırayla gelir. Seçim yoksa ya da
    /// istenen adedi doldurmuyorsa kalanı en son eklenen ürünlerle tamamlanır.
    ///
    /// NEDEN TAMAMLANIYOR: bayi üç ürün işaretlediğinde sekiz kutuluk ızgarada beş boşluk
    /// kalırdı; anasayfa eksik görünürdü. Adedi ayrı bir ayar (FeaturedCount) belirlediği için
    /// "üç tane istiyorum" demenin yeri o ayar, işaretlemenin kendisi değil.
    ///
    /// NEDEN SEÇİLENLER TEK TEK ÇEKİLİYOR: liste ucundan çekip içinde aramak, sayfa boyutu
    /// sınırına takılan ürünlerin sessizce kaybolmasına yol açıyor — sepeti bozan hata tam
    /// olarak buydu (§6.4b). Kodla sorulur, kodla alınır.
    ///
    /// Yayından kalkmış ya da bayiden kapatılmış bir seçim listede kalabilir; GetByStockCodesAsync
    /// onu döndürmediği için vitrine düşmez. Kayıt silinmiyor: ürün tekrar yayına alındığında
    /// bayinin tercihi yerinde duruyor.
    /// </summary>
    public async Task<IReadOnlyList<CatalogItem>> FeaturedAsync(int count, CancellationToken ct)
    {
        count = Math.Clamp(count, 1, 24);

        var settings = await _storefront.GetAsync(ct);
        var picked = settings.FeaturedStockCodes ?? new List<string>();

        var result = new List<CatalogItem>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (picked.Count > 0)
        {
            var byCode = await GetByStockCodesAsync(picked, ct);
            foreach (var code in picked)
            {
                if (result.Count >= count) break;
                if (byCode.TryGetValue(code, out var item) && seen.Add(item.StockCode))
                {
                    result.Add(item);
                }
            }
        }

        if (result.Count < count)
        {
            /*
             * Otomatik doldurma KATEGORİYE YAYILARAK yapılıyor.
             *
             * Eskiden düpedüz "en son eklenen N ürün" alınıyordu ve sonuç şuydu: anasayfanın
             * "Öne çıkan ürünler" bölümünde dört TV askı aparatı yan yana duruyordu — çünkü o
             * dördü katalogda en son kaydedilen ürünlerdi. Ankastre satan bir sitenin vitrini
             * siyah metal parçalarla açılıyordu.
             *
             * Artık en yeniden başlanıyor ama her kategoriden önce BİRER ürün alınıyor; sıra
             * dolmazsa ikinci tur atılıyor. Böylece bayi seçim yapmadığında bile vitrin
             * katalogun çeşitliliğini gösteriyor.
             *
             * Bu yalnızca VARSAYILAN. Bayi ürün seçtiyse (yukarısı) onun sırası aynen geçerli.
             */
            var auto = await ListAsync(null, null, "yeni", 1, 96, ct);

            var kullanilanKategori = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var artanlar = new List<CatalogItem>();

            foreach (var item in auto.Items)
            {
                if (seen.Contains(item.StockCode)) continue;

                var kategori = item.CategorySlug ?? string.Empty;
                if (kullanilanKategori.Add(kategori))
                {
                    if (result.Count < count && seen.Add(item.StockCode)) result.Add(item);
                }
                else
                {
                    artanlar.Add(item);
                }
            }

            // İlk turda her kategoriden birer tane alındı; kalan boşluklar sıradakilerle dolar.
            foreach (var item in artanlar)
            {
                if (result.Count >= count) break;
                if (seen.Add(item.StockCode)) result.Add(item);
            }
        }

        // Bayinin elle seçtikleri GetByStockCodesAsync'ten geliyor; orası sepetin de kullandığı
        // iç yol olduğu için adedi hiç kırpmıyor. Vitrine çıkan liste burası, kırpma burada.
        await StripStockIfHiddenAsync(result, ct);

        return result;
    }

    public async Task<IReadOnlyDictionary<string, CatalogItem>> GetByStockCodesAsync(
        IEnumerable<string> stockCodes,
        CancellationToken ct)
    {
        var codes = stockCodes
            .Select(x => (x ?? string.Empty).Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var result = new Dictionary<string, CatalogItem>(StringComparer.OrdinalIgnoreCase);
        if (codes.Length == 0) return result;

        await using var conn = await OpenAsync(ct);
        var rates = await LoadRatesAsync(conn, ct);
        var categorySlugMap = await CategorySlugMapAsync(ct);

        var sql = $"""
            SELECT p."StockCode", COALESCE(NULLIF(p."DisplayName", ''), p."Name") AS "Name", p."ImageUrl", p."TaxRate", pp."Price", pp."Currency",
                   {StockExpr} AS "Stock", p."IsInstallable", p."InstallationFee", c."Name" AS category,
                   p."BsyVisibleFlag", p."BsyMinStock"
            {FromClause}
            WHERE {PublishedPredicate}
              AND p."StockCode" = ANY(@codes)
            """;

        await using (var cmd = new NpgsqlCommand(sql, conn))
        {
            cmd.Parameters.AddWithValue("priceGroup", _tenant.CatalogPriceGroupCode);
            cmd.Parameters.AddWithValue("codes", codes);

            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var item = MapItem(reader, rates, categorySlugMap);
                result[item.StockCode] = item;
            }
        }

        await ApplyCampaignsAsync(conn, result.Values.ToList(), rates, ct);

        // Sepet ve öne çıkanlar bu yoldan geçiyor: yayından düşen ürün sepette de kalmamalı,
        // aksi halde ödeme adımında satılamayacak bir satır çıkardı.
        var settings = await _storefront.GetAsync(ct);
        var hiddenSet = new HashSet<string>(await _storefront.HiddenStockCodesAsync(ct), StringComparer.OrdinalIgnoreCase);
        var alwaysSet = new HashSet<string>(
            settings.AlwaysPublishStockCodes ?? new List<string>(), StringComparer.OrdinalIgnoreCase);

        var blocked = result.Values
            .Where(x => ResolveBlock(x, settings, hiddenSet, alwaysSet) != PublishBlock.None)
            .Select(x => x.StockCode)
            .ToList();

        foreach (var code in blocked)
        {
            result.Remove(code);
        }

        return result;
    }

    public async Task<CatalogDetail?> GetBySlugAsync(string slug, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        var rates = await LoadRatesAsync(conn, ct);
        var categorySlugMap = await CategorySlugMapAsync(ct);

        var sql = $"""
            SELECT p."StockCode", COALESCE(NULLIF(p."DisplayName", ''), p."Name") AS "Name", p."ImageUrl", p."TaxRate", pp."Price", pp."Currency",
                   {StockExpr} AS "Stock", p."IsInstallable", p."InstallationFee", c."Name" AS category,
                   p."ImageUrlsJson", p."Barcode", p."Unit",
                   p."BsyVisibleFlag", p."BsyMinStock"
            {FromClause}
            WHERE {PublishedPredicate}
            """;

        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("priceGroup", _tenant.CatalogPriceGroupCode);

        string? stockCode = null;
        CatalogItem? baseItem = null;
        string? imagesJson = null;
        string? barcode = null;
        string? unit = null;

        /*
         * Satırların TAMAMI okunuyor, eşleşende durulmuyor (2026-09-20).
         *
         * Renk seçicisi için aynı ürünün diğer renkleri lazım ve onlar listenin herhangi bir
         * yerinde olabilir. Sorgu zaten yayındaki bütün ürünleri döndürüyordu; değişen tek şey
         * eşleşmeden sonra da okumaya devam etmek. Katalog birkaç yüz satır olduğu için maliyeti
         * ölçülebilir değil, ikinci bir sorgu atmaktan ucuz.
         */
        var allItems = new List<CatalogItem>();

        await using (var reader = await cmd.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                var item = MapItem(reader, rates, categorySlugMap);
                allItems.Add(item);

                // Vitrin adı değişince adres de değişir; eski adres (ürün adından üretilen)
                // paylaşılmış/aranmış olabilir — stok kodu eşleşiyorsa o da kabul edilir.
                if (baseItem is not null) continue;
                if (item.Slug != slug && !SlugMatchesStockCode(slug, item.StockCode)) continue;

                baseItem = item;
                stockCode = item.StockCode;
                imagesJson = reader.IsDBNull(10) ? null : reader.GetString(10);
                barcode = reader.IsDBNull(11) ? null : reader.GetString(11);
                unit = reader.IsDBNull(12) ? null : reader.GetString(12);
            }
        }

        if (baseItem is null || stockCode is null) return null;

        await ApplyCampaignsAsync(conn, new List<CatalogItem> { baseItem }, rates, ct);

        /*
         * Yayından düşmüş ürünün adresi elde kalmış olabilir (paylaşılan bağlantı, arama
         * motoru, sepette bekleyen ürün); sayfa açılmamalı.
         *
         * Kural listedekiyle AYNI yerden geliyor: eskiden burada yalnızca "elle kapatıldı mı"
         * bakılıyordu, yani stoğu biten ya da eşiğin altına düşen ürünün detay sayfası
         * listeden kalktıktan sonra bile açılıyor ve sepete eklenebiliyordu.
         */
        var settingsForRules = await _storefront.GetAsync(ct);
        var hiddenCodes = new HashSet<string>(
            await _storefront.HiddenStockCodesAsync(ct), StringComparer.OrdinalIgnoreCase);
        var alwaysCodes = new HashSet<string>(
            settingsForRules.AlwaysPublishStockCodes ?? new List<string>(), StringComparer.OrdinalIgnoreCase);

        if (ResolveBlock(baseItem, settingsForRules, hiddenCodes, alwaysCodes) != PublishBlock.None) return null;

        /*
         * AYNI ÜRÜNÜN DİĞER RENKLERİ (2026-09-20).
         *
         * Listede gruplama açıkken yalnız bir renk kart olarak görünüyor; müşteri diğer renge
         * buradan geçiyor. Kardeşler de yayın kuralından geçiriliyor: stoğu bitmiş ya da elle
         * kapatılmış bir renk seçenek olarak gösterilip tıklanınca 404 vermemeli.
         */
        var variants = Array.Empty<VariantOption>();
        if (settingsForRules.GroupColorVariants)
        {
            var published = allItems
                .Where(x => ResolveBlock(x, settingsForRules, hiddenCodes, alwaysCodes) == PublishBlock.None)
                .ToList();

            var groups = VariantGrouping.Build(published);
            if (baseItem.VariantGroupKey is not null
                && groups.TryGetValue(baseItem.VariantGroupKey, out var siblings)
                && siblings.Count > 1)
            {
                // Kampanya baseItem'a yukarıda uygulandı; ikinci kez uygulamak indirimi
                // indirimin üstüne eklerdi. Yalnız diğerleri gönderiliyor.
                var others = siblings.Where(x => !ReferenceEquals(x, baseItem)).ToList();
                if (others.Count > 0) await ApplyCampaignsAsync(conn, others, rates, ct);

                baseItem.VariantCount = siblings.Count;
                variants = siblings
                    .OrderBy(x => x.VariantLabel, StringComparer.CurrentCulture)
                    .Select(x => new VariantOption
                    {
                        StockCode = x.StockCode,
                        Slug = x.Slug,
                        Label = x.VariantLabel ?? string.Empty,
                        ImageUrl = x.ImageUrl,
                        GrossPrice = x.GrossPrice,
                        InStock = x.InStock
                    })
                    .ToArray();
            }
        }

        // Pazarlama metni ayrı tabloda: ürün kartı operasyonel veri, bu ise yazılmış metin.
        string? description = null;
        string? features = null;
        await using (var detailCmd = new NpgsqlCommand("""
            SELECT "Description", "Features" FROM public."ProductDetails" WHERE "StockCode" = @sc LIMIT 1
            """, conn))
        {
            detailCmd.Parameters.AddWithValue("sc", stockCode);
            await using var dr = await detailCmd.ExecuteReaderAsync(ct);
            if (await dr.ReadAsync(ct))
            {
                description = dr.IsDBNull(0) ? null : dr.GetString(0);
                features = dr.IsDBNull(1) ? null : dr.GetString(1);
            }
        }

        var detail = new CatalogDetail
        {
            StockCode = baseItem.StockCode,
            Slug = baseItem.Slug,
            Name = baseItem.Name,
            // Kırıntı yolu ve "benzer ürünler" başlığı menüdekiyle aynı adı göstermeli.
            CategoryName = await CategoryDisplayNameAsync(baseItem.CategoryName, ct),
            CategorySlug = baseItem.CategorySlug,
            ImageUrl = baseItem.ImageUrl,
            NetPrice = baseItem.NetPrice,
            GrossPrice = baseItem.GrossPrice,
            OriginalGrossPrice = baseItem.OriginalGrossPrice,
            CampaignName = baseItem.CampaignName,
            CampaignPercent = baseItem.CampaignPercent,
            CampaignDiscountGross = baseItem.CampaignDiscountGross,
            TaxRate = baseItem.TaxRate,
            Currency = baseItem.Currency,
            InStock = baseItem.InStock,
            StockQuantity = baseItem.StockQuantity,
            StockCapped = baseItem.StockCapped,
            IsInstallable = baseItem.IsInstallable,
            InstallationFee = baseItem.InstallationFee,
            Description = description,
            Features = SplitFeatures(features),
            Images = BuildImageList(baseItem.ImageUrl, imagesJson),
            Barcode = barcode,
            Unit = unit,
            VariantGroupKey = baseItem.VariantGroupKey,
            VariantLabel = baseItem.VariantLabel,
            VariantCount = baseItem.VariantCount,
            Variants = variants
        };

        await StripStockIfHiddenAsync(new[] { (CatalogItem)detail }, ct);
        return detail;
    }

    /// <summary>
    /// ERP'deki ham kategori listesi — bayi ayarları UYGULANMADAN.
    ///
    /// Yönetim ekranı için: vitrin ucu gizlenen kategorileri eliyor, dolayısıyla panel de onu
    /// kullansaydı bayi bir kategoriyi gizlediği anda o kategori panelden de kaybolur ve bir
    /// daha geri açılamazdı.
    /// </summary>
    public Task<IReadOnlyList<CatalogCategory>> AllCategoriesAsync(CancellationToken ct)
        => CategoriesAsync(ct, applyOverrides: false);

    /// <summary>
    /// ERP'de TANIMLI kategori adresleri — o an yayında ürünü olup olmadığına bakmadan.
    ///
    /// NEDEN GEREKLİ (2026-09-09): kategori sayfası, adresi yayındaki kategori listesinde
    /// bulamazsa 404 veriyordu. Stok kuralı devreye girince (biten ve kritik stoktaki ürünler
    /// vitrinden kalkıyor) bir kategorinin ürünlerinin TAMAMI geçici olarak düşebiliyor ve o
    /// kategori bir anda 404 oluyor. Menüdeki ve altbilgideki bağlantılar sabit yazılı olduğu
    /// için ziyaretçi doğrudan kırık bağlantı görüyordu.
    ///
    /// Bu liste yalnızca "böyle bir kategori var mı" sorusuna cevap veriyor; bilinmeyen adres
    /// hâlâ 404 dönüyor (aksi hâlde her uydurma adres 200 döner ve arama motoru için çöp üretir).
    /// </summary>
    public async Task<IReadOnlyList<string>> KnownCategorySlugsAsync(CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);

        await using var cmd = new NpgsqlCommand(
            """SELECT DISTINCT c."Name" FROM public."ProductCategories" c WHERE COALESCE(c."Name",'') <> ''""",
            conn);

        // Bayinin verdiği adresler de "bilinen" sayılır, yoksa yeni adres 404 olurdu.
        // Eski (ERP'den türeyen) adres de listede kalır: 301 yönlendirmesi çalışabilsin diye
        // sayfanın onu tanıması gerekiyor.
        var map = await CategorySlugMapAsync(ct);

        var slugs = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var name = reader.GetString(0);
            var slug = Slugify.ToSlug(name);
            if (slug.Length == 0) continue;

            slugs.Add(slug);
            if (map.TryGetValue(slug, out var custom) && !slugs.Contains(custom, StringComparer.OrdinalIgnoreCase))
            {
                slugs.Add(custom);
            }
        }

        return slugs;
    }

    /// <summary>
    /// Eski kategori adresi -> yeni adres. Vitrin bununla kalıcı yönlendirme kuruyor:
    /// paylaşılmış ya da Google'da indekslenmiş eski adresin sıralaması yenisine aktarılsın.
    /// Bayi adres vermemişse eşleme boştur ve hiçbir yönlendirme kurulmaz.
    /// </summary>
    public async Task<IReadOnlyDictionary<string, string>> CategorySlugRedirectsAsync(CancellationToken ct)
        => await CategorySlugMapAsync(ct);

    /// <summary>
    /// ERP'de böyle bir stok kodu var mı — YAYIN KURALINA BAKMADAN.
    ///
    /// "Gelince haber ver" için gerekli: bekleme kaydı bırakılan ürün tam da yayında OLMAYAN
    /// üründür (stoğu bitmiş), dolayısıyla katalog listesiyle doğrulanamaz. Uydurma kodla
    /// tablonun şişirilmemesi için yine de gerçek bir ürün olduğu doğrulanıyor.
    /// </summary>
    /// <summary>
    /// ÇOK SATANLAR (2026-09-21) — gerçek sipariş verisinden.
    ///
    /// NEDEN: "Öne çıkanlar" bayinin elle seçtikleri; iyi bir vitrin ama satışın ne olduğunu
    /// söylemiyor. Gerçekten çok satan ürünü öne çıkarmak hem doğru mal satar hem de müşteriye
    /// dürüst bir sosyal kanıt verir — uydurma "popüler" rozetlerinin aksine (o rozetler
    /// 2026-09-20'de bilerek kaldırılmıştı).
    ///
    /// Son <paramref name="days"/> gündeki sipariş SATIRLARI toplanıyor; iptal/iade ayrımı
    /// burada YAPILMIYOR (sipariş başlığındaki durum alanı vitrin tarafında güvenilir değil),
    /// dolayısıyla sonuç "en çok sipariş edilen", "en çok teslim edilen" değil. Vitrin
    /// sıralaması için bu yeterli; muhasebe için kullanılmamalı.
    ///
    /// Yayın kuralı SONRADAN uygulanıyor: satılmış ama artık yayında olmayan ürün listeye
    /// girmemeli.
    /// </summary>
    public async Task<IReadOnlyList<CatalogItem>> BestSellersAsync(int count, int days, CancellationToken ct)
    {
        count = Math.Clamp(count, 1, 24);
        days = Math.Clamp(days, 7, 365);

        /*
         * PANELDEN ELLE SEÇİM VARSA O KAZANIR (2026-09-21).
         *
         * Bölüm tamamen otomatikti: son 90 günün gerçek satış adetleri. Dürüst ama
         * yönlendirilemez — bayi "bu ay beyaz eşya öne çıksın" diyemiyordu.
         *
         * Liste BOŞSA hiçbir şey değişmiyor, otomatik davranış sürüyor. Doluysa sıra da
         * panelden geldiği gibi korunuyor; yayında olmayan kod sessizce eleniyor (stoğu
         * bitmiş ya da fotoğrafı silinmiş bir ürünü listede bırakmak, tıklanınca 404 demek).
         */
        var secilenler = (await _storefront.GetAsync(ct)).BestSellerStockCodes;
        if (secilenler.Count > 0)
        {
            var elle = await GetByStockCodesAsync(secilenler, ct);
            var elleSonuc = secilenler
                .Where(elle.ContainsKey)
                .Select(k => elle[k])
                .Take(count)
                .ToList();

            await StripStockIfHiddenAsync(elleSonuc, ct);
            return elleSonuc;
        }

        await using var conn = await OpenAsync(ct);

        var kodlar = new List<string>();
        await using (var cmd = new NpgsqlCommand($"""
            SELECT l."StockCode", SUM(l."Quantity") AS adet
            FROM public."SalesOrderLines" l
            WHERE l."CreateTime" >= now() - make_interval(days => {days})
            GROUP BY l."StockCode"
            ORDER BY adet DESC
            LIMIT {count * 4}
            """, conn))
        await using (var reader = await cmd.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct)) kodlar.Add(reader.GetString(0));
        }

        if (kodlar.Count == 0) return Array.Empty<CatalogItem>();

        // Dört katı çekiliyor: bunların bir kısmı yayında olmayacak (stoğu bitmiş, görseli yok,
        // kapatılmış). Elemeden sonra elde `count` kadar kalması için pay bırakılıyor.
        var urunler = await GetByStockCodesAsync(kodlar, ct);

        var sonuc = kodlar
            .Where(urunler.ContainsKey)
            .Select(k => urunler[k])
            .Take(count)
            .ToList();

        /*
         * STOK KIRPMA BURADA DA ŞART (2026-09-21 — CANLIDA BULUNAN SIZINTI).
         *
         * `GetByStockCodesAsync` sepetin de kullandığı İÇ yol; adedi bilerek hiç kırpmıyor,
         * çünkü sepetin gerçek stoğu bilmesi gerekiyor. Bu metot o iç yolu kullanıp sonucu
         * doğrudan VİTRİNE veriyordu: "Kalan adet müşteriye gösterilsin" kapalı olmasına
         * rağmen anasayfadaki "Çok Satanlar" şeridinde "1178 adet stokta" yazıyordu.
         *
         * Kapının dört çağrı yeri var (liste, öne çıkanlar, ürün detayı ve burası); dördüncüsü
         * eklenirken unutulmuş. Vitrine ürün döndüren HER yeni metot bunu çağırmak zorunda —
         * çağırmayan bir yol, kapalı sanılan bir kapıdır.
         */
        await StripStockIfHiddenAsync(sonuc, ct);

        return sonuc;
    }

    /// <summary>Panel: görseli olmadığı için vitrine hiç giremeyen ürün.</summary>
    public sealed record MissingPhotoRow(string StockCode, string Name, string? Category, decimal Price, int Stock);

    /// <summary>
    /// GÖRSELİ OLMADIĞI İÇİN VİTRİNE GİREMEYEN ÜRÜNLER (2026-09-20).
    ///
    /// Vitrin kuralı üç şart istiyor: aktif + görsel + katalog fiyatı. Ölçümde görüldü ki
    /// ürünlerin BÜYÜK ÇOĞUNLUĞU yalnızca GÖRSEL eksikliğinden listeye hiç girmiyor —
    /// stoğu var, fiyatı var, satılabilir durumda ama müşteri göremiyor.
    ///
    /// Bu liste satış artırmanın en ucuz yolu: kod yazmak değil, fotoğraf çekmek. Stoğu en
    /// yüksek olan başta geliyor; önce onları çekmek en hızlı dönüşü veriyor.
    ///
    /// Yayın kuralı BİLEREK uygulanmıyor: kural zaten bu ürünleri eliyor, uygulanırsa liste
    /// boş çıkar.
    /// </summary>
    public async Task<IReadOnlyList<MissingPhotoRow>> MissingPhotosAsync(int limit, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);

        var sql = $"""
            SELECT p."StockCode",
                   COALESCE(NULLIF(p."DisplayName", ''), p."Name") AS "Name",
                   c."Name" AS category,
                   pp."Price",
                   COALESCE(ROUND(smb."Bakiye"), p."Stock")::int AS "Stock"
            {FromClause}
            WHERE p."IsActive" = true
              AND COALESCE(p."ImageUrl", '') = ''
              AND pp."Price" > 0
              AND COALESCE(ROUND(smb."Bakiye"), p."Stock") > 0
            ORDER BY COALESCE(ROUND(smb."Bakiye"), p."Stock") DESC, pp."Price" DESC
            LIMIT {Math.Clamp(limit, 5, 500)}
            """;

        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("priceGroup", _tenant.CatalogPriceGroupCode);

        var list = new List<MissingPhotoRow>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add(new MissingPhotoRow(
                reader.GetString(0),
                reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.GetDecimal(3),
                reader.GetInt32(4)));
        }
        return list;
    }

    /// <summary>Panel: görselsiz ürün sayısı (liste çekmeden).</summary>
    public async Task<int> MissingPhotoCountAsync(CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand($"""
            SELECT count(*)::int
            {FromClause}
            WHERE p."IsActive" = true
              AND COALESCE(p."ImageUrl", '') = ''
              AND pp."Price" > 0
            """, conn);
        cmd.Parameters.AddWithValue("priceGroup", _tenant.CatalogPriceGroupCode);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
    }

    public async Task<bool> StockCodeExistsAsync(string stockCode, CancellationToken ct)
    {
        var code = (stockCode ?? string.Empty).Trim();
        if (code.Length == 0) return false;

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "SELECT 1 FROM public.\"Products\" WHERE \"StockCode\" = @c LIMIT 1", conn);
        cmd.Parameters.AddWithValue("c", code);
        return await cmd.ExecuteScalarAsync(ct) is not null;
    }

    public Task<IReadOnlyList<CatalogCategory>> CategoriesAsync(CancellationToken ct)
        => CategoriesAsync(ct, applyOverrides: true);

    private async Task<IReadOnlyList<CatalogCategory>> CategoriesAsync(CancellationToken ct, bool applyOverrides)
    {
        await using var conn = await OpenAsync(ct);

        // Kategori kutusunda gösterilecek temsili görsel de aynı sorgudan geliyor: ayrı bir
        // "kategori görseli" alanı yok ve kategori başına ikinci bir sorgu atmak gereksiz.
        /*
         * KATEGORİ SAYILARI DA YAYIN KURALINA UYAR.
         *
         * Bu sorgu adet sayıyor ve satırları belleğe almıyor; o yüzden stok kuralı burada
         * SQL'de. Menüde "Televizyon (14)" yazıp içeri girince 3 ürün görmek, kuralı
         * uygulamamaktan daha kötü: kullanıcı listenin bozuk olduğunu düşünür.
         *
         * Sayılar `hidden_products` ve "her zaman yayında" listesini de hesaba katıyor.
         */
        var settingsForCounts = await _storefront.GetAsync(ct);
        var alwaysCodes = (settingsForCounts.AlwaysPublishStockCodes ?? new List<string>()).ToArray();
        var hiddenForCounts = (await _storefront.HiddenStockCodesAsync(ct)).ToArray();

        var stockFilters = new List<string>
        {
            "NOT (p.\"StockCode\" = ANY(@hiddenCodes))"
        };

        if (settingsForCounts.HideClosedToSale)
        {
            stockFilters.Add("COALESCE(p.\"BsyVisibleFlag\", 'E') <> 'H'");
        }

        if (settingsForCounts.HideOutOfStock)
        {
            // Sayaç süzgeci de SELECT ile aynı stok hesabını kullanmak zorunda; ayrışırsa
            // panelde "Vitrinde 42" yazarken liste başka sayıda ürün gösterir.
            stockFilters.Add($"COALESCE({StockExpr}, 0) > 0");
        }

        if (settingsForCounts.StopPublishingBelowCriticalStock)
        {
            stockFilters.Add(
                "(p.\"StockCode\" = ANY(@alwaysCodes) " +
                $"OR COALESCE(p.\"BsyMinStock\", {DefaultAutoCloseThreshold}) <= 0 " +
                $"OR COALESCE({StockExpr}, 0) >= COALESCE(p.\"BsyMinStock\", {DefaultAutoCloseThreshold}))");
        }

        var stockWhere = string.Join(" AND ", stockFilters);

        var sql = $"""
            SELECT c."Name", COUNT(*) AS adet, MIN(p."ImageUrl") AS gorsel
            {FromClause}
            WHERE {PublishedPredicate} AND c."Name" IS NOT NULL AND {stockWhere}
            GROUP BY c."Name"
            ORDER BY adet DESC, c."Name" ASC
            """;

        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("priceGroup", _tenant.CatalogPriceGroupCode);
        cmd.Parameters.AddWithValue("alwaysCodes", alwaysCodes);
        cmd.Parameters.AddWithValue("hiddenCodes", hiddenForCounts);

        var list = new List<CatalogCategory>();
        await using (var reader = await cmd.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct))
            {
                var name = reader.GetString(0);
                list.Add(new CatalogCategory
                {
                    Name = name,
                    // BURADA ERP ADRESİ KALIYOR: aşağıdaki geçersiz kılma sözlüğü ERP adresiyle
                    // anahtarlanmış. Bayinin verdiği adres o blokta, arama yapıldıktan SONRA
                    // yazılıyor — erken değiştirmek ad/gizleme/sıra ayarlarını da düşürürdü.
                    Slug = Slugify.ToSlug(name),
                    ProductCount = Convert.ToInt32(reader.GetInt64(1)),
                    ImageUrl = reader.IsDBNull(2) ? null : reader.GetString(2)
                });
            }
        }

        if (!applyOverrides) return list;

        // Bayinin vitrin ayarları: gizlenenler düşer, adı verilmiş olanlar o adla görünür,
        // adresi verilmiş olanlar o adresle bağlanır, sıra numarası verilenler öne geçer.
        //
        // ADRES (2026-09-20'de eklendi): eskiden adres HER ZAMAN ERP adından türüyordu, çünkü
        // değiştirmek verilmiş bağlantıları kırardı. Artık bayi kendi adresini verebiliyor ve
        // eski adres kırılmıyor: vitrin eskisini kalıcı olarak yenisine yönlendiriyor, katalog süzgeci
        // de her ikisini kabul ediyor. Bu gerekliydi — ERP kategorileri kısaltma adlı
        // ("G.HAZIR") olduğu için menüdeki okunur bağlantılar hiçbir ürüne denk gelmiyordu.
        var settings = await _storefront.GetAsync(ct);
        var overrides = settings.CategoryOverrides ?? new Dictionary<string, Storefront.CategoryOverride>();
        var categorySlugMap = await CategorySlugMapAsync(ct);

        var visible = new List<(CatalogCategory Category, int Order)>();
        foreach (var category in list)
        {
            if (!overrides.TryGetValue(category.Slug, out var rule))
            {
                // Hiç ayarı olmayan kategori: adı yine de okunur hâle getiriliyor.
                visible.Add((
                    new CatalogCategory
                    {
                        Name = PrettyCategoryName(category.Name),
                        Slug = category.Slug,
                        ProductCount = category.ProductCount,
                        ImageUrl = category.ImageUrl
                    },
                    0));
                continue;
            }

            if (rule.Hidden) continue;

            var display = (rule.DisplayName ?? string.Empty).Trim();
            var publicSlug = categorySlugMap.TryGetValue(category.Slug, out var custom) ? custom : category.Slug;

            // Yeni nesne kuruluyor: CatalogCategory init-only, alanları oluşturulduktan sonra
            // değiştirilemiyor.
            visible.Add((
                display.Length > 0 || !string.Equals(publicSlug, category.Slug, StringComparison.OrdinalIgnoreCase)
                    ? new CatalogCategory
                    {
                        Name = display.Length > 0 ? display : PrettyCategoryName(category.Name),
                        Slug = publicSlug,
                        ProductCount = category.ProductCount,
                        ImageUrl = category.ImageUrl
                    }
                    : category,
                rule.SortOrder));
        }

        // Sırası verilmemişler (0) en sona, kendi aralarında ürün sayısına göre: elle sıralanan
        // kategoriler listenin başında toplansın, gerisi eskisi gibi davransın.
        return visible
            .OrderBy(x => x.Order == 0 ? int.MaxValue : x.Order)
            .ThenByDescending(x => x.Category.ProductCount)
            .ThenBy(x => x.Category.Name, StringComparer.CurrentCulture)
            .Select(x => x.Category)
            .ToList();
    }

    /// <summary>
    /// Bir kategorinin vitrinde görünen adı. Ürün detayındaki kırıntı yolu ve kategori sayfası
    /// başlığı da bayinin verdiği adı göstermeli; yoksa müşteri menüde "Ankastre" görüp
    /// tıkladığında sayfa başlığında ERP'deki ham adı okur.
    /// </summary>
    /// <summary>
    /// ERP kategori adresinden VİTRİN adresine eşleme (2026-09-20).
    ///
    /// Anahtar: ERP adından türeyen adres ("g-hazir"), değer: bayinin verdiği adres
    /// ("gida-hazirlama"). Yalnız GERÇEKTEN farklı olanlar giriyor; eşleme boşsa hiçbir şey
    /// değişmez ve davranış eski hâliyle aynıdır.
    /// </summary>
    private async Task<Dictionary<string, string>> CategorySlugMapAsync(CancellationToken ct)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var settings = await _storefront.GetAsync(ct);
        if (settings.CategoryOverrides is null) return map;

        foreach (var (erpSlug, rule) in settings.CategoryOverrides)
        {
            var custom = Slugify.ToSlug(rule?.Slug);
            if (custom.Length == 0) continue;
            if (string.Equals(custom, erpSlug, StringComparison.OrdinalIgnoreCase)) continue;
            map[erpSlug] = custom;
        }

        return map;
    }

    /// <summary>ERP kategori adının vitrinde kullanılacak adresi.</summary>
    private static string? PublicCategorySlug(string? erpName, IReadOnlyDictionary<string, string>? map)
    {
        if (string.IsNullOrWhiteSpace(erpName)) return null;
        var erpSlug = Slugify.ToSlug(erpName);
        if (erpSlug.Length == 0) return null;
        return map is not null && map.TryGetValue(erpSlug, out var custom) ? custom : erpSlug;
    }

    /// <summary>
    /// ERP kategori adının okunur hâli — bayi bir ad VERMEDİYSE (2026-09-21).
    ///
    /// ERP adları BÜYÜK HARF ("ANKASTRE", "KLIMA") ve vitrinde aynen bağırarak görünüyorlardı.
    /// Burada yalnızca BAŞLIK BİÇİMİNE çevriliyor; kısaltma açılmıyor ("BUZDLB" -> "Buzdlb"),
    /// çünkü kısaltmanın ne anlama geldiğini tahmin etmek bize düşmez — onun doğru yolu
    /// paneldeki ad alanı (bkz. docs/KATEGORI-ADRES-ESLEMESI.md).
    ///
    /// Bayi ad verdiyse BU FONKSİYON HİÇ ÇAĞRILMAZ: yazdığı ad aynen gösterilir, yoksa
    /// bilerek "TV & Ses" yazan bayinin başlığı "Tv & Ses"e dönerdi.
    /// </summary>
    private static readonly Dictionary<string, string> KategoriKelimeleri = new(StringComparer.OrdinalIgnoreCase)
    {
        ["UTU"] = "Ütü", ["UTULER"] = "Ütüler", ["SILTE"] = "Şilte", ["BASLIK"] = "Başlık", ["BAZA"] = "Baza",
        ["GUMUS"] = "Gümüş", ["CAMASIR"] = "Çamaşır", ["BULASIK"] = "Bulaşık", ["BUZDOLABI"] = "Buzdolabı",
        ["SUPURGE"] = "Süpürge", ["SUPURGELER"] = "Süpürgeler", ["ISITICI"] = "Isıtıcı", ["ISITICILAR"] = "Isıtıcılar",
        ["SOGUTUCU"] = "Soğutucu", ["KUCUK"] = "Küçük", ["GIDA"] = "Gıda", ["ICECEK"] = "İçecek", ["KISISEL"] = "Kişisel",
        ["TEMIZLIK"] = "Temizlik", ["TEMIZLIGI"] = "Temizliği", ["GERECLERI"] = "Gereçleri", ["ESYA"] = "Eşya",
        ["FIRIN"] = "Fırın", ["FIRINLAR"] = "Fırınlar", ["MIKRODALGA"] = "Mikrodalga", ["TELEVIZYON"] = "Televizyon",
        ["SEBIL"] = "Sebil", ["SEBILI"] = "Sebili", ["MAKINESI"] = "Makinesi", ["MAKINELERI"] = "Makineleri",
        ["YASTIK"] = "Yastık", ["YATAK"] = "Yatak", ["TEKSTIL"] = "Tekstil", ["KLIMA"] = "Klima", ["ANKASTRE"] = "Ankastre",
        ["DERIN"] = "Derin", ["DONDURUCU"] = "Dondurucu", ["ELEKTRIKLI"] = "Elektrikli", ["ALETLERI"] = "Aletleri",
        ["CAY"] = "Çay", ["KAHVE"] = "Kahve", ["HAZIRLAMA"] = "Hazırlama", ["BAKIM"] = "Bakım", ["SAC"] = "Saç",
    };

    private static string PrettyCategoryName(string erpName)
    {
        /*
         * NOKTASIZ I, TÜRKÇE KÜÇÜLTMEYLE 'ı' OLUR — BURADA İSTEMİYORUZ.
         *
         * "KLIMA" tr-TR kuralıyla küçültülünce "klıma", başlık biçiminde "Klıma" çıkıyor:
         * yazım hatası gibi duruyor ve hepsi büyük hâlinden daha kötü. ERP kategori adları
         * aksansız yazıldığı için hangi I'nın 'ı' hangisinin 'i' olduğu bilinemez.
         *
         * Bu yüzden ASCII 'I' -> 'i' sayılıyor: "KLIMA" -> "Klima", "TEKSTIL" -> "Tekstil"
         * (doğru), "SILTE" -> "Silte" (ş eksik ama yazım hatası gibi durmuyor). Noktalı 'İ'
         * zaten 'i'ye iniyor, dolayısıyla "İÇECEK" -> "İçecek" doğru kalıyor.
         *
         * Eksik harfleri düzeltmenin doğru yolu paneldeki ad alanı; burası yalnızca
         * "hiç ayar yapılmamışken bağırmasın" katmanı.
         */
        static string Kucult(string s)
        {
            var sb = new StringBuilder(s.Length);
            foreach (var ch in s)
            {
                sb.Append(ch switch
                {
                    'I' or 'İ' => 'i',
                    _ => char.ToLowerInvariant(ch)
                });
            }
            return sb.ToString();
        }

        static char BuyukIlk(char c) => c switch
        {
            'i' => 'İ',
            'ı' => 'I',
            _ => char.ToUpperInvariant(c)
        };

        var parcalar = erpName.Split(' ', StringSplitOptions.RemoveEmptyEntries);

        return string.Join(' ', parcalar.Select(p =>
        {
            // Sık kategori kelimeleri (2026-09-21): ERP'de Türkçe karaktersiz yazılanların doğru hâli.
            // "UTU" -> "Ütü", "SILTE" -> "Şilte". Sözlükte olmayan kelime eski kurala düşer.
            if (KategoriKelimeleri.TryGetValue(p, out var bilinen)) return bilinen;

            var kucuk = Kucult(p);

            // İlk HARFİ büyüt, ilk karakteri değil: "(döküm)" -> "(Döküm)".
            var ilk = -1;
            for (var i = 0; i < kucuk.Length; i++)
            {
                if (char.IsLetter(kucuk[i])) { ilk = i; break; }
            }
            if (ilk < 0) return kucuk;

            return string.Concat(kucuk[..ilk], BuyukIlk(kucuk[ilk]), kucuk[(ilk + 1)..]);
        }));
    }

    public async Task<string> CategoryDisplayNameAsync(string? erpName, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(erpName)) return string.Empty;

        var settings = await _storefront.GetAsync(ct);
        var slug = Slugify.ToSlug(erpName);

        if (settings.CategoryOverrides is not null
            && settings.CategoryOverrides.TryGetValue(slug, out var rule)
            && !string.IsNullOrWhiteSpace(rule.DisplayName))
        {
            return rule.DisplayName.Trim();
        }

        // Ad verilmemiş: en azından BÜYÜK HARF bağırmasın.
        return PrettyCategoryName(erpName);
    }

    /// <summary>Servis kaydı formunda gösterilen ürün — fiyat ve stok BİLEREK yok.</summary>
    public sealed class ServiceProductHit
    {
        public string StockCode { get; init; } = string.Empty;
        public string Name { get; init; } = string.Empty;
        public string? CategoryName { get; init; }
    }

    /// <summary>
    /// SERVİS KAYDI İÇİN ÜRÜN ARAMA.
    ///
    /// NEDEN VİTRİN ARAMASINDAN AYRI: vitrin yalnızca YAYINDAKİ ürünleri veriyor (stokta
    /// olan, fiyatı ve görseli bulunan). Servise gelen ürün ise çoğunlukla yıllar önce
    /// alınmış: stoğu bitmiş, kritik eşiğin altına düşmüş ya da artık satılmıyor olabilir.
    /// Vitrin araması kullanılsaydı müşteri kendi cihazını listede bulamaz, yine elle
    /// yazmak zorunda kalırdı — çözmeye çalıştığımız sorunun ta kendisi.
    ///
    /// Ölçüt bu yüzden yalnızca <c>IsActive</c>. Fiyat, stok ve görsel aranmıyor.
    ///
    /// DIŞARI VERİLEN ALANLAR DAR: stok kodu, ad ve kategori. Fiyat ve stok adedi servis
    /// formunun işi değil; kimlik doğrulaması olmayan bir uçtan katalog fiyatı sızdırmanın
    /// da anlamı yok.
    /// </summary>
    public async Task<IReadOnlyList<ServiceProductHit>> SearchServiceProductsAsync(
        string? search,
        CancellationToken ct,
        int limit = 20)
    {
        var tokens = (search ?? string.Empty)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Take(6)
            .ToList();

        // En az iki harf: tek harfle bütün katalog dönerdi.
        if (tokens.Count == 0 || tokens.Sum(x => x.Length) < 2)
        {
            return Array.Empty<ServiceProductHit>();
        }

        var filters = new List<string> { "p.\"IsActive\" = true" };

        for (var t = 0; t < tokens.Count; t++)
        {
            var p = "@s" + t;
            filters.Add(
                "(" + Norm("p.\"Name\"") + " LIKE " + p
                + " OR " + Norm("p.\"StockCode\"") + " LIKE " + p
                + " OR " + Norm("COALESCE(p.\"Barcode\",'')") + " LIKE " + p
                + " OR " + Norm("COALESCE(c.\"Name\",'')") + " LIKE " + p + ")");
        }

        await using var conn = await OpenAsync(ct);

        var sql = $"""
            SELECT p."StockCode", p."Name", c."Name" AS category
            FROM public."Products" p
            LEFT JOIN public."ProductCategories" c ON c."Id" = COALESCE(p."CategoryId", p."MainCategoryId")
            WHERE {string.Join(" AND ", filters)}
            ORDER BY p."Name"
            LIMIT {Math.Clamp(limit, 1, 50)}
            """;

        await using var cmd = new NpgsqlCommand(sql, conn);
        for (var t = 0; t < tokens.Count; t++)
        {
            cmd.Parameters.AddWithValue("s" + t, "%" + NormalizeForSearch(tokens[t]) + "%");
        }

        var list = new List<ServiceProductHit>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            list.Add(new ServiceProductHit
            {
                StockCode = reader.GetString(0),
                Name = reader.GetString(1),
                CategoryName = reader.IsDBNull(2) ? null : reader.GetString(2)
            });
        }

        return list;
    }

    /// <summary>Site haritası için yayındaki tüm adresler.</summary>
    public async Task<IReadOnlyList<string>> AllProductSlugsAsync(CancellationToken ct)
    {
        var page = await ListAsync(null, null, "ad", 1, 96, ct);
        var all = new List<string>(page.TotalCount);
        var totalPages = (int)Math.Ceiling(page.TotalCount / 96.0);

        all.AddRange(page.Items.Select(x => x.Slug));
        for (var p = 2; p <= totalPages; p++)
        {
            var next = await ListAsync(null, null, "ad", p, 96, ct);
            all.AddRange(next.Items.Select(x => x.Slug));
        }

        return all;
    }

    private static Dictionary<string, decimal>? _cachedRates;
    private static DateTime _cachedRatesTime = DateTime.MinValue;

    private async Task<Dictionary<string, decimal>> LoadRatesAsync(NpgsqlConnection conn, CancellationToken ct)
    {
        if (_cachedRates != null && DateTime.UtcNow - _cachedRatesTime < TimeSpan.FromMinutes(5))
        {
            return _cachedRates;
        }

        var dict = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
        try
        {
            await using var cmd = new NpgsqlCommand("""
                SELECT DISTINCT ON ("CurrencyCode") "CurrencyCode", "SellingRate"
                FROM public."ExchangeRates"
                ORDER BY "CurrencyCode", "RateDate" DESC;
                """, conn);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                var code = reader.GetString(0);
                var rate = reader.GetDecimal(1);
                if (rate > 0) dict[code] = rate;
            }
        }
        catch
        {
            // Tablo yoksa varsayılan reel kurlar
            dict["USD"] = 45.45m;
            dict["EUR"] = 48.50m;
            dict["GBP"] = 56.80m;
        }

        if (!dict.ContainsKey("USD")) dict["USD"] = 45.45m;
        if (!dict.ContainsKey("EUR")) dict["EUR"] = 48.50m;
        if (!dict.ContainsKey("GBP")) dict["GBP"] = 56.80m;

        _cachedRates = dict;
        _cachedRatesTime = DateTime.UtcNow;
        return dict;
    }

    private CatalogItem MapItem(
        NpgsqlDataReader reader,
        IReadOnlyDictionary<string, decimal> rates,
        IReadOnlyDictionary<string, string>? categorySlugMap = null)
    {
        var stockCode = reader.GetString(0);
        var name = reader.GetString(1);
        var taxRate = reader.GetInt32(3);
        var rawNet = reader.GetDecimal(4);
        var cur = reader.IsDBNull(5) ? "TRY" : reader.GetString(5).Trim().ToUpperInvariant();
        var category = reader.IsDBNull(9) ? null : reader.GetString(9);

        decimal rate = 1m;
        if (!string.Equals(cur, "TRY", StringComparison.OrdinalIgnoreCase) && rates.TryGetValue(cur, out var r) && r > 0)
        {
            rate = r;
        }

        var net = Math.Round(rawNet * rate, 2, MidpointRounding.AwayFromZero);

        return new CatalogItem
        {
            StockCode = stockCode,
            Name = name,
            Slug = BuildProductSlug(name, stockCode),
            ImageUrl = reader.IsDBNull(2) ? null : reader.GetString(2),
            TaxRate = taxRate,
            NetPrice = net,
            GrossPrice = ToGross(net, taxRate),
            Currency = "TRY",
            InStock = !reader.IsDBNull(6) && reader.GetInt32(6) > 0,
            StockQuantity = reader.IsDBNull(6) ? 0 : reader.GetInt32(6),
            ActualStock = reader.IsDBNull(6) ? 0 : reader.GetInt32(6),
            IsInstallable = !reader.IsDBNull(7) && reader.GetBoolean(7),
            InstallationFee = reader.IsDBNull(8) ? null : reader.GetDecimal(8),
            MarkedOpenToSale = ReadMarkedOpenToSale(reader),
            AutoCloseThreshold = ReadAutoCloseThreshold(reader),
            CategoryName = category,
            CategorySlug = PublicCategorySlug(category, categorySlugMap)
        };
    }

    /// <summary>
    /// Kartta elle seçilmiş "Satışa Açık" değeri. <c>'H'</c> = kapalı; boş/eksik = açık.
    ///
    /// SÜTUN ADIYLA okunuyor, sıra numarasıyla değil: bu iki alan üç ayrı sorgunun sonuna
    /// eklendi ve detay sorgusunda araya başka sütunlar giriyor. Sıraya bağlanmak, bir
    /// sorguya ileride sütun eklendiğinde sessizce yanlış alanı okumak demekti.
    /// </summary>
    private static bool ReadMarkedOpenToSale(NpgsqlDataReader reader)
    {
        var index = reader.GetOrdinal("BsyVisibleFlag");
        if (reader.IsDBNull(index)) return true;

        return !string.Equals(reader.GetString(index).Trim(), "H", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Ürünün satışa kapanma eşiği. B2B'deki <c>resolveAutoCloseThreshold</c> ile AYNI kural:
    /// girilmemişse varsayılan 12, girilmişse (0 dahil) olduğu gibi kullanılır — 0 yazılan
    /// üründe eşik fiilen devre dışı kalır.
    /// </summary>
    private static int ReadAutoCloseThreshold(NpgsqlDataReader reader)
    {
        var index = reader.GetOrdinal("BsyMinStock");
        if (reader.IsDBNull(index)) return DefaultAutoCloseThreshold;

        var value = reader.GetInt32(index);
        return value < 0 ? DefaultAutoCloseThreshold : value;
    }

    /// <summary>
    /// Adres = ürün adı + stok kodu. Stok kodu sonda duruyor çünkü aynı adı taşıyan iki ürün
    /// (farklı renk/ölçü) aksi halde aynı adrese düşer ve biri erişilemez olurdu.
    /// </summary>
    /// <summary>Adres, ürünün stok koduyla bitiyor mu ("…-sbe92002") — eski adres uyumu.</summary>
    private static bool SlugMatchesStockCode(string slug, string stockCode)
    {
        var codePart = Slugify.ToSlug(stockCode);
        if (codePart.Length == 0) return false;
        return string.Equals(slug, codePart, StringComparison.Ordinal) || slug.EndsWith("-" + codePart, StringComparison.Ordinal);
    }

    public static string BuildProductSlug(string name, string stockCode)
    {
        var namePart = Slugify.ToSlug(name);
        var codePart = Slugify.ToSlug(stockCode);
        if (namePart.Length == 0) return codePart;
        return codePart.Length == 0 ? namePart : $"{namePart}-{codePart}";
    }

    private static IReadOnlyList<string> SplitFeatures(string? features)
        => string.IsNullOrWhiteSpace(features)
            ? Array.Empty<string>()
            : features.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static IReadOnlyList<string> BuildImageList(string? primary, string? imagesJson)
    {
        var list = new List<string>();
        if (!string.IsNullOrWhiteSpace(primary)) list.Add(primary);

        if (!string.IsNullOrWhiteSpace(imagesJson))
        {
            try
            {
                var extra = System.Text.Json.JsonSerializer.Deserialize<List<string>>(imagesJson);
                if (extra is not null)
                {
                    foreach (var url in extra)
                    {
                        if (!string.IsNullOrWhiteSpace(url) && !list.Contains(url)) list.Add(url);
                    }
                }
            }
            catch
            {
                // Bozuk JSON tek bir ürünün galerisini eksiltir, sayfayı düşürmez.
            }
        }

        return list;
    }
}
