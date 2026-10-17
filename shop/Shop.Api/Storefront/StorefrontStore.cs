using System.Text.Json;
using Npgsql;
using Shop.Api.Infrastructure;
using Shop.Api.Members;

namespace Shop.Api.Storefront;

/// <summary>Vitrinin bayiden yönetilen içeriği.</summary>
public sealed class StorefrontSettings
{
    public string HeroKicker { get; set; } = "Ankastre Set Kampanyası";
    public string HeroTitle { get; set; } = "Mutfağınızı tek seferde kurun.";
    public string HeroTitleStrong { get; set; } = "tek seferde";
    public string HeroText { get; set; } =
        "Ocak, fırın ve davlumbaz birlikte alındığında set fiyatı geçerlidir. Teslimat, kurulum ve servis KKTC genelinde kendi ekibimizle.";
    public string HeroButtonText { get; set; } = "Ürünleri incele";
    public string HeroButtonLink { get; set; } = "/urunler";

    /// <summary>Boşsa öne çıkan ilk ürünün görseli kullanılır.</summary>
    public string? HeroImageUrl { get; set; }

    /// <summary>
    /// Başlıktaki logo görseli. Boşsa yazı logosu ("STILSOFT | DEMO") kullanılır.
    ///
    /// Yazı logosu bir yer tutucuydu: kurumsal bir mağazanın başlığında marka işareti
    /// bulunmaması siteyi yarım gösteriyor. Görsel yüklenene kadar yazı hâli duruyor —
    /// logosuz bir başlık, bozuk görsel kutusundan iyidir.
    /// </summary>
    public string? LogoImageUrl { get; set; }

    public string PhoneNumber { get; set; } = "0850 000 00 00";

    // ---- Sosyal medya ve harita ----
    //
    // Vitrin bugüne kadar footer'da instagram.com / facebook.com / youtube.com gibi BOŞ
    // yer tutuculara link veriyordu (2026-09-08 kullanıcı bildirimi). Bu alanlar panelden
    // yönetiliyor; boş bırakılırsa aşağıdaki gerçek Stilsoft KKTC hesapları kullanılır.
    // Değer değişince ERP panelinden güncellenir, vitrin 60 sn önbellekten sonra alır.
    public string InstagramUrl { get; set; } = "https://www.instagram.com/";
    public string FacebookUrl { get; set; } = "https://www.facebook.com/";
    public string YoutubeUrl { get; set; } = "https://www.youtube.com/";

    /// <summary>
    /// Google Haritalar gömme adresi — iframe'in <c>src</c> değeri (tam URL).
    /// İletişim sayfasında harita bununla çizilir. Boşsa harita bölümü gösterilmez.
    /// Panele yapıştırılan tam <c>&lt;iframe&gt;</c> etiketinden yalnız src alınır (vitrin ayıklar).
    /// </summary>
    public string MapsEmbedSrc { get; set; } =
        "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2792.6544176900193!2d33.43998191068584!3d35.21863407262635!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x14de3f5289a0c359%3A0xa5a8c567425c7ec5!2sST%C4%B0LEVS%20TRADING%20LIMITED!5e1!3m2!1str!2str!4v1788899907592!5m2!1str!2str";

    /// <summary>
    /// SHOWROOM (mağaza) haritası. <see cref="MapsEmbedSrc"/> MERKEZ OFİSİN haritası —
    /// ikisi ayrı adres ve müşteri hangisine gideceğini bilmeli.
    ///
    /// Ayrı alan olmasının sebebi: tek harita varken altbilgide ofis, iletişim sayfasında
    /// mağaza gösterilemiyordu; hangisi kaydedilirse diğeri kayboluyordu.
    ///
    /// Aynı süzgeçten geçiyor (<c>NormalizeMapsEmbed</c>): tam &lt;iframe&gt; yapıştırılsa
    /// bile yalnız <c>src</c> alınır ve yalnız google.com/maps/embed kabul edilir.
    /// </summary>
    public string ShowroomMapsEmbedSrc { get; set; } =
        "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2793.1558779219918!2d33.36890271068497!3d35.20405697263135!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x14de16e750dc2985%3A0xa1af3b909a1d1b7!2sST%C4%B0LEVS%20KIBRIS!5e1!3m2!1str!2str!4v1788930895522!5m2!1str!2str";

    /// <summary>
    /// Mağazanın çalışma saatleri. Her satır bir gün: <c>Gün|Saat</c>.
    ///
    /// NEDEN AYAR, NEDEN KODDA DEĞİL: saatler sabit yazılıydı ("Pzt – Cmt: 08:30 - 18:00")
    /// ve gerçeğiyle tutmuyordu; bayram/tatil düzenlemesinde koda dokunmak gerekirdi.
    ///
    /// Biçim bilinçli olarak basit: panelde tek bir metin kutusu, satır satır yazılıyor.
    /// Ayırıcı yoksa satır olduğu gibi basılır, yani serbest metin de çalışır.
    /// </summary>
    public string WorkingHours { get; set; } =
        "Pazartesi|08:00 - 18:00\nSalı|08:00 - 18:00\nÇarşamba|08:00 - 18:00\nPerşembe|08:00 - 18:00\nCuma|08:00 - 18:00\nCumartesi|08:00 - 15:00\nPazar|Kapalı";

    /// <summary>
    /// WhatsApp destek hattı — ülke koduyla birlikte, boşluksuz (ör. 905338408837).
    ///
    /// `PhoneNumber`'dan AYRI: o alan çoğunlukla KKTC sabit hat formatında ve WhatsApp'a uygun
    /// olmayabilir. Bu alan daha önce vitrinde kaynak koda sabit yazılıydı — panelden hiç
    /// değiştirilemiyordu ve gerçek işletme hattı olup olmadığı belirsizdi (2026-09-05
    /// denetiminde bulundu). Boşsa widget gösterilmez.
    /// </summary>
    public string WhatsAppNumber { get; set; } = string.Empty;
    public bool ShowCategories { get; set; } = true;
    public bool ShowFeatured { get; set; } = true;
    public int FeaturedCount { get; set; } = 8;

    // ---- Stok görünürlüğü ve stoksuz satış ----
    //
    // Üçü birlikte bir kararı ifade ediyor: "müşteri stoktan ne kadarını görsün ve stok
    // bittiğinde ne olsun". Vitrin bugüne kadar yalnızca "KKTC Stokta / Tükendi" rozetini
    // gösteriyordu; adet hiç görünmüyordu ve "Tükendi" yazan ürün YİNE DE sepete eklenip
    // sipariş edilebiliyordu (rozet uyarıyor, hiçbir şey engellemiyordu).

    /// <summary>
    /// Ürünün kalan adedi müşteriye gösterilsin mi.
    ///
    /// Varsayılan KAPALI: stok adedi ticari bir bilgidir (rakip de görür) ve ERP'deki sayı
    /// depo sayımıyla her zaman birebir tutmayabilir. Açıldığında adet, API'den de ancak o
    /// zaman çıkar — kapalıyken sayı vitrine hiç ulaşmaz, sadece gizlenmez.
    /// </summary>
    public bool ShowStockQuantity { get; set; }

    /// <summary>
    /// Gösterilen adedin ÜST SINIRI. Bu sayıya ulaşan stok "12+" gibi yazılır, gerçek adet
    /// verilmez.
    ///
    /// ERP/POS ekranlarındaki kuralın aynısı: 5 → "5", 11 → "11", 12 ve üzeri → "12+".
    /// Orada bu sayı dört ayrı ekranda elle 12 yazılmıştı (fatura, proforma, depo transferi,
    /// müşteri teklifi); vitrinde tekrar sabitlemek beşinci kopya olurdu. Ayar 0 yapılırsa
    /// tavan uygulanmaz, gerçek adet yazılır.
    ///
    /// NEDEN TAVAN GEREKLİ: tam stok rakamı ticari bilgidir. "12+" müşteriye "bol var" der,
    /// rakibe deponun büyüklüğünü söylemez.
    /// </summary>
    public int StockDisplayCap { get; set; } = 12;

    /// <summary>
    /// "Son N adet" uyarısının eşiği. Adet bu sayının altına düştüğünde vitrin uyarı gösterir.
    /// <see cref="ShowStockQuantity"/> kapalıyken de çalışır: "son 2 adet" demek, tam sayıyı
    /// vermeden aciliyet bildirmenin yoludur.
    /// </summary>
    public int LowStockThreshold { get; set; } = 5;

    /// <summary>
    /// Stokta olmayan ürün sipariş edilebilsin mi.
    ///
    /// Varsayılan KAPALI. Açık bırakılırsa müşteri "Tükendi" yazan ürünün parasını öder ve
    /// bayi teslim edemez; e-ticarette iadeye ve güven kaybına giden en kısa yol budur.
    /// Tedarik süresi bilinen ürünler için bilinçli olarak açılabilir.
    /// </summary>
    public bool AllowOutOfStockOrders { get; set; }

    /// <summary>
    /// Stoğu biten ürün vitrinden KALKSIN mı (2026-09-09 kullanıcı kararı: kalksın).
    ///
    /// Önceden tükenen ürün listede kalıyor, üstünde "Tükendi" rozeti ve pasif bir düğme
    /// oluyordu. İstenen davranış: "biten ürünler gösterilmeyecek" — kataloğu gezen müşteri
    /// alamayacağı ürünlerle uğraşmasın.
    ///
    /// <see cref="AllowOutOfStockOrders"/> ile birlikte kullanılmaz: stoksuz sipariş bilinçli
    /// olarak açıldıysa bu ayar da kapatılmalı, yoksa ürün zaten listede olmadığı için stoksuz
    /// sipariş verilecek bir yer kalmaz. Panelde bu uyarı yazıyor.
    /// </summary>
    public bool HideOutOfStock { get; set; } = true;

    /// <summary>
    /// Aynı ürünün renkleri listede TEK kart olarak toplansın mı (2026-09-20).
    ///
    /// ERP'de her renk ayrı stok kodu olduğu için vitrinde aynı ürün iki (bazen üç) kart
    /// olarak duruyordu. Açıkken listede bir kart görünür ("3 renk" rozetiyle), renk seçimi
    /// ürün sayfasında yapılır; ürünlerin kendi adresleri çalışmaya devam eder.
    ///
    /// AÇILIŞTA KAPALI: gruplama ada bakarak çalışan bir sezgi. Ölçümde isabetliydi
    /// (166 üründe 20 grup, çakışma 0) ama katalog değiştikçe yanlış birleştirme ihtimali var;
    /// bayi sonucu görüp kendi açsın. Kapatmak da tek tık — bkz. <see cref="VariantGrouping"/>.
    /// </summary>
    public bool GroupColorVariants { get; set; }

    /// <summary>
    /// Ürün kartında "Satışa Açık: Hayır" işaretli (<c>BsyVisibleFlag = 'H'</c>) ürünler
    /// vitrinden kalksın mı.
    ///
    /// AYRI ANAHTAR OLMASININ SEBEBİ (2026-09-09): kural ilk yazıldığında stok kurallarıyla
    /// birlikte sabitlenmişti. Canlıda ölçüldüğünde 246 yayındaki ürünün **60'ı** bu
    /// işaretliydi — yani tek bir kararla kataloğun dörtte biri kaybolacaktı. Bayi bunu
    /// istemeyebilir: B2B'de de 'H' işareti ürünü herkesten gizlemiyor, role bağlı
    /// (<c>bsyHHide</c> yetkisi olmayan bayi ürünü görmeye devam ediyor).
    ///
    /// Varsayılan AÇIK: satışa kapalı olarak işaretlenmiş bir ürünü internetten satmak
    /// tutarsız. Ama bayi tek tıkla kapatabiliyor.
    /// </summary>
    public bool HideClosedToSale { get; set; } = true;

    /// <summary>
    /// Stok, ürünün SATIŞA KAPANMA EŞİĞİNİN altına düştüğünde yayın otomatik dursun mu.
    ///
    /// Eşik ürün kartındaki <c>Products.BsyMinStock</c> — ERP'de "Satışa Kapanma Eşiği"
    /// olarak geçiyor, varsayılanı 12 ve 0 yazıldığında eşik uygulanmıyor. B2B tarafında
    /// bayiye satışı kapatan kural bu; vitrin de aynı sayıya bağlandı (2026-09-09 kullanıcı
    /// kararı) ki iki kanal aynı anda aynı ürünü satmasın.
    ///
    /// Karar HESAPLANIYOR, veritabanına yazılmıyor: stok toparlayınca ürün kendiliğinden geri
    /// yayına giriyor, kimsenin elle açması gerekmiyor (B2B'deki kuralın aynısı).
    /// </summary>
    public bool StopPublishingBelowCriticalStock { get; set; } = true;

    /// <summary>
    /// Kritik stok kuralını EZEN ürünler — "bu ürün eşiğin altında da olsa yayında kalsın".
    ///
    /// Yalnızca kritik eşik kuralını ezer; stoğu SIFIR olan ürünü yayına döndürmez. Satılamayan
    /// bir malı vitrinde tutmak, kuralın kendisini anlamsız kılardı.
    /// </summary>
    public List<string> AlwaysPublishStockCodes { get; set; } = new();

    /// <summary>
    /// Anasayfada öne çıkacak ürünlerin stok kodları, bayinin verdiği sırayla.
    ///
    /// NEDEN GEREKLİ: öne çıkanlar bugüne kadar "en son eklenen N ürün" olarak geliyordu ve bayi
    /// yalnızca adedini seçebiliyordu. Anasayfanın en çok görülen alanı, katalogda hangi ürünün
    /// daha yeni kaydedildiğine göre doluyordu — kampanyası olan ya da stoğu eritilmek istenen
    /// ürünü oraya koymanın yolu yoktu.
    ///
    /// NEDEN AYARLARDA, ÜRÜN KARTINDA DEĞİL: "öne çıkan" ERP'nin verisi değil, vitrinin
    /// pazarlama kararı. Aynı kataloğu kullanan ikinci bir vitrin farklı ürünleri öne çıkarabilir;
    /// ürün kartına yazılsaydı ikisi birbirini ezerdi.
    ///
    /// Liste yalnızca stok kodu tutuyor: ad ve fiyat ERP'nin verisi, kopyalanırsa eskir.
    /// </summary>
    public List<string> FeaturedStockCodes { get; set; } = new();

    /// <summary>
    /// "ÇOK SATANLAR" ŞERİDİ İÇİN ELLE SEÇİM (2026-09-21).
    ///
    /// Bölüm bugüne kadar TAMAMEN otomatikti: son 90 günün gerçek sipariş adetleri.
    /// Dürüst ama yönlendirilemez bir liste — bayi "şu ay beyaz eşya satmak istiyorum"
    /// diyemiyordu; şeritte su ısıtıcısı ve blender çıkıyordu (kullanıcı bildirimi).
    ///
    /// BOŞSA ESKİ DAVRANIŞ SÜRÜYOR: gerçek satış verisi. Yani ayar girilmezse hiçbir şey
    /// değişmez, bölüm kendiliğinden çalışmaya devam eder. Dolduğunda liste TAM OLARAK
    /// buradaki sıraya göre çiziliyor.
    ///
    /// <see cref="FeaturedStockCodes"/> ile AYRI TUTULUYOR: "öne çıkanlar" ayrı bir şerit;
    /// ikisini tek listeye bağlamak, anasayfada aynı ürünlerin iki kez çıkması demekti.
    /// </summary>
    public List<string> BestSellerStockCodes { get; set; } = new();

    public List<StorefrontBanner> Banners { get; set; } = new();

    // ---- Yasal metinlerde geçen firma bilgileri ----
    //
    // Sözleşme ve politika sayfalarında satıcının kim olduğu YAZILI OLMAK ZORUNDA. Bu bilgiler
    // koda gömülmüyor: firma unvanı ve adresi değişebilir, üstelik ikinci bir firma için aynı
    // mağaza kurulduğunda kod değiştirmek gerekmemeli. Boş bırakıldığında sayfalar eksik olduğunu
    // AÇIKÇA yazıyor — sessizce boş görünmek, yanlış bilgi kadar kötü.
    public string CompanyName { get; set; } = string.Empty;
    public string CompanyAddress { get; set; } = string.Empty;
    public string CompanyEmail { get; set; } = string.Empty;

    /// <summary>Vergi dairesi ve numarası; KKTC mevzuatına göre serbest metin.</summary>
    public string CompanyTaxInfo { get; set; } = string.Empty;

    /// <summary>
    /// İletişim ve servis formlarının DÜŞECEĞİ kutu.
    ///
    /// <para>Neden <see cref="CompanyEmail"/> yetmedi: o alan yasal metinlerde YAZILAN
    /// kurumsal adres (info@…) ve panelde doldurulmamıştı; boş olduğu için iletişim formu
    /// aylarca 503 dönüyordu — ziyaretçi "Lütfen bizi telefonla arayın" görüyor, mesaj hiçbir
    /// yere ulaşmıyordu. Ayrıca kullanıcı mesajların kurumsal kutuya değil destek kutusuna
    /// düşmesini istedi (2026-09-09: "support@example.com ye gelecek").</para>
    ///
    /// <para>Varsayılanı DOLU: bu alanın boş kalması formun sessizce çalışmaması demek.
    /// Panelden değiştirilebilir.</para>
    /// </summary>
    public string SupportEmail { get; set; } = "support@example.com";

    /* =====================================================================================
       SATIŞ ARTIRMA AYARLARI (2026-09-20) — hepsi panelden (E-Ticaret → Vitrin Yönetimi).
       Kod sabitine gömülü olsaydı her değişiklik yayın gerektirirdi.
       ===================================================================================== */

    /// <summary>Türkiye'deki Stilsoft sitesi. Doluysa üst şeritte "Türkiye için …" bağlantısı çıkar;
    /// Google'dan yanlış siteye gelen Türkiye müşterisi sepete gelmeden doğru yere gider.</summary>
    public string TurkeySiteUrl { get; set; } = string.Empty;

    /// <summary>Google Analytics 4 ölçüm kimliği (G-XXXX). Boşsa betik basılmaz.</summary>
    public string GaMeasurementId { get; set; } = string.Empty;
    /// <summary>Meta (Facebook/Instagram) Pixel kimliği. Boşsa basılmaz.</summary>
    public string MetaPixelId { get; set; } = string.Empty;
    /// <summary>Microsoft Clarity proje kimliği (oturum kaydı). Boşsa basılmaz.</summary>
    public string ClarityProjectId { get; set; } = string.Empty;

    /// <summary>Ürün sayfası ve güven şeridinde görünen teslimat vaadi.</summary>
    public string DeliveryPromise { get; set; } = "Lefkoşa ve Girne'ye 1–2 iş günü, diğer ilçelere 2–3 iş günü içinde randevulu teslimat";
    /// <summary>
    /// Değişim/iade vaadi. Varsayılan BOŞ (2026-10-04 kullanıcı kararı: "14 gün iade yazmışsın, kaldır"):
    /// panelde yazılmadıkça ürün sayfası gün sözü vermez, yalnız hasarlı teslimat güvencesini anar.
    /// </summary>
    public string ExchangePolicy { get; set; } = string.Empty;
    /// <summary>Google işletme yorumları bağlantısı; doluysa yorum bölümünde "Google'da oku" çıkar.</summary>
    public string GoogleReviewsUrl { get; set; } = string.Empty;

    /// <summary>
    /// Anasayfadaki müşteri yorumları. Eskiden koda gömülü, uydurma 4 yorumdu; artık panelden
    /// gerçek yorumlar girilir, liste boşsa bölüm HİÇ görünmez.
    /// </summary>
    public List<StorefrontTestimonial> Testimonials { get; set; } = new();

    /// <summary>
    /// Havale/EFT hesapları. Liste doluysa ödeme adımında "Havale / EFT" seçeneği açılır ve
    /// IBAN'lar müşteriye gösterilir; boşsa yalnız kart.
    /// </summary>
    public List<BankTransferAccount> BankTransferAccounts { get; set; } = new();

    /// <summary>"Gönderdim" gelmeyen havale siparişi kaç saat sonra kendiliğinden iptal olur.</summary>
    public int BankTransferTimeoutHours { get; set; } = 72;

    /// <summary>
    /// Havale bildirimi gelmeyen müşteriye kaç saat sonra BİR KEZ hatırlatma SMS'i gider (2026-09-20).
    /// 0 = kapalı. Süre aşımından (<see cref="BankTransferTimeoutHours"/>) küçük olmalı; değilse
    /// hatırlatma hiç gönderilemez çünkü sipariş ondan önce kapanır.
    ///
    /// NEDEN: havaleyi seçip parayı göndermeyen müşteri kaybedilmiş sipariş değil, unutmuş
    /// müşteri. Tek hatırlatma, iptal edilecek siparişin bir kısmını geri kazandırıyor.
    /// </summary>
    public int BankTransferReminderHours { get; set; } = 24;

    /// <summary>
    /// SMS SERVİSİ KAPALIYKEN DE ÜYESİZ SİPARİŞ ALINSIN MI (2026-09-20).
    ///
    /// SORUN: üyeliksiz sipariş tamamen SMS'e bağlı. PostaGüvercini bilgileri girilmemişse
    /// vitrin ödeme adımında sessizce eski davranışa düşüyor ve müşteri "e-posta + şifre"
    /// duvarına çarpıyor — kaldırmak için uğraştığımız duvarın ta kendisi.
    ///
    /// AÇIKKEN: müşteri ad + telefon + adres yazıp siparişi tamamlıyor, numara DOĞRULANMIYOR.
    /// Karşılığında alınan risk sınırlı: kartta 3D Secure gerçek kişiyi doğruluyor, havalede
    /// para gelmeden hiçbir şey sevk edilmiyor. Asıl bedel, sahte/şakacı siparişin ekibin
    /// vaktini alması.
    ///
    /// KAPALI BAŞLIYOR: bu bir politika kararı, bayi verecek. SMS bilgileri girildiğinde bu
    /// ayarın bir etkisi kalmaz — doğrulamalı akış zaten devreye girer.
    /// </summary>
    public bool AllowGuestCheckoutWithoutSms { get; set; }

    /// <summary>
    /// Sepet hatırlatma SMS'i açık mı. Sepete ürün atıp ödemeye gelmeyen üyeye
    /// <see cref="CartReminderDelayHours"/> saat sonra bir kez SMS gider (SMS servisi açıksa).
    /// </summary>
    public bool CartReminderEnabled { get; set; } = true;
    /// <summary>Sepete son dokunuştan kaç saat sonra hatırlatma gider (1–72).</summary>
    public int CartReminderDelayHours { get; set; } = 3;
    /// <summary>
    /// Hatırlatma metni. Yer tutucular: <c>{ad}</c> üye adı, <c>{urun}</c> ilk ürün, <c>{adet}</c>
    /// satır sayısı, <c>{link}</c> sepet adresi. Türkçe karakter kullanılmaz (SMS iki kredi olur).
    /// </summary>
    public string CartReminderText { get; set; } = "Merhaba {ad}, sepetinizde {urun} sizi bekliyor. Ucretsiz teslimat ve montajla tamamlamak icin: {link}";

    /// <summary>
    /// Kategori adresine göre tanıtım metni (SEO).
    ///
    /// NEDEN ERP'DE DEĞİL: kategori ERP'de bir sınıflandırma alanı, pazarlama metni taşımıyor ve
    /// taşımamalı. Metin yalnızca vitrini ilgilendiriyor, dolayısıyla vitrinin ayarlarında duruyor.
    ///
    /// Arama motorunda kategori sayfalarının sıralanabilmesi ürün listesinden ibaret bir sayfayla
    /// mümkün değil: aynı ürünleri listeleyen yüzlerce sayfa arasından ayırt edilebilir olmak için
    /// sayfaya özgü metin gerekiyor. Metin yoksa sayfa yine çalışır, yalnızca ayırt edici içerik
    /// olmaz — bu yüzden zorunlu tutulmadı.
    /// </summary>
    public Dictionary<string, string> CategoryTexts { get; set; } = new();

    /// <summary>
    /// Kategori adresine göre vitrin ayarı: görünen ad, gizleme ve sıra.
    ///
    /// NEDEN GEREKLİ: kategori adları ERP'den geliyor ve orada OPERASYONEL adlar tutuluyor —
    /// "Elektrikli Ev Aletleri2", "Başlık", "Baza", "Şilte" gibi. Depoda çalışan için anlamlı
    /// ama müşteriye gösterilecek adlar değil; menüde ve kategori kutularında bunlar
    /// göründüğü sürece site derme çatma duruyor.
    ///
    /// NEDEN ERP'DEKİ ADI DEĞİŞTİRMİYORUZ: o ad stok, sipariş ve raporlarda kullanılıyor;
    /// vitrin için değiştirmek başka ekranları bozar. Burada tutulan yalnızca "müşteriye ne
    /// yazsın" bilgisi.
    ///
    /// ADRES DEĞİŞMİYOR: anahtar da adres de ERP adından türetiliyor. Görünen adı değiştirmek
    /// adresi değiştirseydi, o kategoriye verilmiş bütün bağlantılar ve arama motorundaki
    /// kaydı kırılırdı.
    /// </summary>
    public Dictionary<string, CategoryOverride> CategoryOverrides { get; set; } = new();
}

public sealed class CategoryOverride
{
    /// <summary>Boşsa ERP'deki ad kullanılır.</summary>
    public string? DisplayName { get; set; }

    /// <summary>
    /// Kategorinin VİTRİNDEKİ ADRESİ (2026-09-20). Boşsa ERP adından türetilen adres kullanılır.
    ///
    /// NEDEN: ERP kategori adları kısaltma ("G.HAZIR", "BUZDLB", "DRN.DON") ve bunlardan türeyen
    /// adres <c>/kategori/g-hazir</c> oluyordu. Kimse böyle aramıyor, Google da böyle
    /// indekslemiyor. Üstelik menüdeki bağlantılar okunur adreslere (<c>/kategori/gida-hazirlama</c>)
    /// yazıldığı için ERP kodlu kategorilerdeki ürünler menüden ERİŞİLEMİYORDU.
    ///
    /// Eski adres kırılmıyor: vitrin eski adresle gelen isteği yenisine kalıcı olarak yönlendiriyor,
    /// mağaza API'si de her iki adresi kabul ediyor.
    /// </summary>
    public string? Slug { get; set; }

    /// <summary>Vitrinde hiç görünmesin. Ürünleri aramada ve "tüm ürünler"de durmaya devam eder.</summary>
    public bool Hidden { get; set; }

    /// <summary>Küçük olan önce. 0 verilenler ürün sayısına göre sıralanır (varsayılan davranış).</summary>
    public int SortOrder { get; set; }
}

public sealed class StorefrontTestimonial
{
    public string Name { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
    public string Date { get; set; } = string.Empty;
    public int Rating { get; set; } = 5;
}

public sealed class BankTransferAccount
{
    public string BankName { get; set; } = string.Empty;
    public string AccountHolder { get; set; } = string.Empty;
    public string Iban { get; set; } = string.Empty;
    public string Currency { get; set; } = "TL";
}

public sealed class StorefrontBanner
{
    public string Id { get; set; } = Guid.NewGuid().ToString("n");
    public string Title { get; set; } = string.Empty;
    public string? Subtitle { get; set; }
    public string? ImageUrl { get; set; }
    public string? Link { get; set; }
    public int SortOrder { get; set; }
    public bool IsActive { get; set; } = true;
}

/// <summary>
/// Vitrin içeriği mağazanın kendi veritabanında durur — ERP'nin ürün kartı bir pazarlama
/// deposu değil. Ayarlar tek satırda JSON olarak tutuluyor: alanlar sık değişecek ve her yeni
/// alan için tablo değiştirmek gereksiz. Okuyan tek yer vitrin, yazan tek yer bayi paneli.
/// </summary>
public sealed class StorefrontStore
{
    private readonly TenantResolver _tenant;
    private readonly ShopSchema _schema;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public StorefrontStore(TenantResolver tenant, ShopSchema schema)
    {
        _tenant = tenant;
        _schema = schema;
    }

    private async Task<NpgsqlConnection> OpenAsync(CancellationToken ct)
    {
        await _schema.EnsureAsync(ct);
        var conn = new NpgsqlConnection(_tenant.ShopConnectionString());
        await conn.OpenAsync(ct);
        return conn;
    }

    private static StorefrontSettings? _cachedSettings;
    private static DateTime _cachedSettingsTime = DateTime.MinValue;
    private static IReadOnlyCollection<string>? _cachedHidden;
    private static DateTime _cachedHiddenTime = DateTime.MinValue;

    public async Task<StorefrontSettings> GetAsync(CancellationToken ct)
    {
        if (_cachedSettings != null && DateTime.UtcNow - _cachedSettingsTime < TimeSpan.FromSeconds(60))
        {
            return _cachedSettings;
        }

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT payload FROM public.storefront_settings WHERE id = 1", conn);

        var raw = await cmd.ExecuteScalarAsync(ct) as string;
        if (string.IsNullOrWhiteSpace(raw))
        {
            var fallback = new StorefrontSettings();
            _cachedSettings = fallback;
            _cachedSettingsTime = DateTime.UtcNow;
            return fallback;
        }

        try
        {
            var res = JsonSerializer.Deserialize<StorefrontSettings>(raw, JsonOptions) ?? new StorefrontSettings();
            _cachedSettings = res;
            _cachedSettingsTime = DateTime.UtcNow;
            return res;
        }
        catch
        {
            return new StorefrontSettings();
        }
    }

    public async Task SaveAsync(StorefrontSettings settings, string updatedBy, CancellationToken ct)
    {
        _cachedSettings = null;
        _cachedHidden = null;

        settings.FeaturedCount = Math.Clamp(settings.FeaturedCount, 4, 24);
        settings.Banners = settings.Banners
            .OrderBy(x => x.SortOrder)
            .Take(12)
            .ToList();

        // Seçim listesi burada da temizleniyor: ayarlar tek gövde hâlinde de kaydedilebiliyor
        // (bayi "Kaydet" dediğinde), yalnızca işaretleme ucunu temizlemek yetmezdi.
        settings.FeaturedStockCodes = NormalizeFeatured(settings.FeaturedStockCodes);
        // Aynı temizlik: boşluk kırpma, tekrar eleme, üst sınır.
        settings.BestSellerStockCodes = NormalizeFeatured(settings.BestSellerStockCodes);

        // Harita: bayi çoğu zaman Google'dan kopyaladığı TAM <iframe ...> etiketini yapıştırır.
        // Yalnız src alınır ve google.com/maps/embed dışındaki hiçbir adres kabul edilmez
        // (rastgele iframe = XSS/clickjacking kapısı).
        settings.MapsEmbedSrc = NormalizeMapsEmbed(settings.MapsEmbedSrc);
        settings.ShowroomMapsEmbedSrc = NormalizeMapsEmbed(settings.ShowroomMapsEmbedSrc);

        var payload = JsonSerializer.Serialize(settings, JsonOptions);

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            INSERT INTO public.storefront_settings (id, payload, updated_at, updated_by)
            VALUES (1, @p, now(), @u)
            ON CONFLICT (id) DO UPDATE SET payload = @p, updated_at = now(), updated_by = @u
            """, conn);

        cmd.Parameters.AddWithValue("p", payload);
        cmd.Parameters.AddWithValue("u", updatedBy);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>Bayiden elle kapatılan ürünler. Kural gereği yayında olsa bile vitrinde görünmez.</summary>
    public async Task<IReadOnlyCollection<string>> HiddenStockCodesAsync(CancellationToken ct)
    {
        if (_cachedHidden != null && DateTime.UtcNow - _cachedHiddenTime < TimeSpan.FromSeconds(60))
        {
            return _cachedHidden;
        }

        await using var conn = await OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT stock_code FROM public.hidden_products", conn);

        var list = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) list.Add(reader.GetString(0));

        _cachedHidden = list;
        _cachedHiddenTime = DateTime.UtcNow;
        return list;
    }

    /// <summary>En fazla kaç ürün öne çıkarılabilir. FeaturedCount'un üst sınırıyla aynı.</summary>
    private const int MaxFeatured = 24;

    /// <summary>
    /// Harita gömme adresini güvenli hâle getirir: tam <c>&lt;iframe&gt;</c> yapıştırıldıysa
    /// <c>src</c> ayıklanır; sonuç yalnızca <c>https://www.google.com/maps/embed</c> ile
    /// başlıyorsa kabul edilir, aksi hâlde boş döner (harita bölümü gizlenir).
    /// </summary>
    private static string NormalizeMapsEmbed(string? raw)
    {
        var value = (raw ?? string.Empty).Trim();
        if (value.Length == 0) return string.Empty;

        if (value.Contains("<iframe", StringComparison.OrdinalIgnoreCase))
        {
            var m = System.Text.RegularExpressions.Regex.Match(
                value, "src\\s*=\\s*[\"']([^\"']+)[\"']",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            value = m.Success ? m.Groups[1].Value.Trim() : string.Empty;
        }

        return value.StartsWith("https://www.google.com/maps/embed", StringComparison.OrdinalIgnoreCase)
            ? value
            : string.Empty;
    }

    private static List<string> NormalizeFeatured(IEnumerable<string>? codes)
        => (codes ?? Enumerable.Empty<string>())
            .Select(x => (x ?? string.Empty).Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(MaxFeatured)
            .ToList();

    /// <summary>
    /// Bir ürünü öne çıkanlara ekler ya da çıkarır.
    ///
    /// Sıra korunuyor: yeni işaretlenen ürün listenin SONUNA ekleniyor, çünkü bayinin
    /// işaretleme sırası anasayfadaki sıradır. Başa eklemek, her yeni işaretin önceki
    /// tercihi ikinci sıraya itmesi demek olurdu.
    /// </summary>
    public async Task SetProductFeaturedAsync(string stockCode, bool featured, string updatedBy, CancellationToken ct)
    {
        var code = (stockCode ?? string.Empty).Trim();
        if (code.Length == 0) return;

        var settings = await GetAsync(ct);
        var list = NormalizeFeatured(settings.FeaturedStockCodes);
        var existing = list.FindIndex(x => string.Equals(x, code, StringComparison.OrdinalIgnoreCase));

        if (featured)
        {
            if (existing >= 0) return;
            if (list.Count >= MaxFeatured)
            {
                throw new InvalidOperationException($"En fazla {MaxFeatured} ürün öne çıkarılabilir.");
            }
            list.Add(code);
        }
        else
        {
            if (existing < 0) return;
            list.RemoveAt(existing);
        }

        settings.FeaturedStockCodes = list;
        await SaveAsync(settings, updatedBy, ct);
    }

    public async Task SetProductHiddenAsync(string stockCode, bool hidden, string updatedBy, CancellationToken ct)
    {
        await using var conn = await OpenAsync(ct);

        await using var cmd = hidden
            ? new NpgsqlCommand("""
                INSERT INTO public.hidden_products (stock_code, hidden_at, hidden_by)
                VALUES (@s, now(), @u)
                ON CONFLICT (stock_code) DO NOTHING
                """, conn)
            : new NpgsqlCommand("DELETE FROM public.hidden_products WHERE stock_code = @s", conn);

        cmd.Parameters.AddWithValue("s", stockCode);
        if (hidden) cmd.Parameters.AddWithValue("u", updatedBy);

        await cmd.ExecuteNonQueryAsync(ct);

        // Elle kapatılan ürünler önbellekte tutuluyor (60 sn). Kapatma/açma anında
        // temizlenmezse bayi düğmeye basıyor, listeyi yeniliyor ve hiçbir şey değişmemiş
        // gibi görüyordu — sonra bir dakika sonra kendiliğinden değişiyordu.
        _cachedHidden = null;
    }

    /// <summary>
    /// "Kritik stokta da yayında kalsın" işaretini açar/kapatır.
    ///
    /// Ayrı bir uçtan yönetiliyor (bütün ayarları geri göndermek yerine): ürün listesi ayrı
    /// bir sekme ve tek bir işaret için vitrin metinlerini de göndermek, aynı anda vitrini
    /// düzenleyen ikinci bir kullanıcının değişikliğini ezerdi.
    /// </summary>
    public async Task SetProductAlwaysPublishAsync(string stockCode, bool alwaysPublish, string updatedBy, CancellationToken ct)
    {
        var code = (stockCode ?? string.Empty).Trim();
        if (code.Length == 0) return;

        var settings = await GetAsync(ct);
        var list = (settings.AlwaysPublishStockCodes ?? new List<string>())
            .Select(x => (x ?? string.Empty).Trim())
            .Where(x => x.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var index = list.FindIndex(x => string.Equals(x, code, StringComparison.OrdinalIgnoreCase));

        if (alwaysPublish)
        {
            if (index >= 0) return;
            list.Add(code);
        }
        else
        {
            if (index < 0) return;
            list.RemoveAt(index);
        }

        settings.AlwaysPublishStockCodes = list;
        await SaveAsync(settings, updatedBy, ct);
    }
}
