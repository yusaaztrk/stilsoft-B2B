import type { BlogPost } from '@/lib/blog'

/**
 * Yazı gövdeleri — 5. bölüm: KKTC YEREL ve SATIN ALMA KARARI.
 *
 * <b>Buradaki yazıların ortak özelliği (2026-09-21):</b> hepsi ada koşullarına özgü.
 * "Buzdolabı nasıl seçilir" gibi genel bir başlıkta Türkiye'deki dev siteleri geçmek
 * neredeyse imkânsız; ama "KKTC'de elektrik kesintisi beyaz eşyayı nasıl etkiler" ya da
 * "Girne'ye teslimat" gibi yerel niyetli aramalarda yarışacak neredeyse kimse yok.
 * Arama motoru için en ucuz, en kesin kazanç bu tarafta.
 *
 * Şehir adları (Lefkoşa, Girne, Gazimağusa, Güzelyurt, İskele, Lapta, Alsancak, Karaoğlanoğlu)
 * metinlerde DOĞAL bağlamda geçiyor — zorlama kelime tekrarı değil, gerçekten teslimat ve
 * servis bilgisi veriyor. Aksi hâlde arama motoru bunu spam sayar.
 */
export const BLOG_POSTS_5: BlogPost[] = [
  {
    slug: 'kktc-beyaz-esya-teslimat-lefkosa-girne-magusa',
    title: 'KKTC’de Beyaz Eşya Teslimatı: Lefkoşa, Girne, Gazimağusa ve Tüm Bölgeler',
    description:
      'KKTC geneli ücretsiz teslimat nasıl işler, hangi bölgelere kaç günde ulaşır, teslimat günü neye hazırlıklı olmalısınız? Adım adım süreç.',
    excerpt:
      'Siparişten kapınıza kadar teslimat sürecinin tamamı ve teslimat günü için hazırlık listesi.',
    category: 'KKTC Rehberi',
    tags: ['teslimat', 'Lefkoşa', 'Girne', 'Gazimağusa', 'KKTC'],
    publishedAt: '2026-09-13',
    blocks: [
      {
        kind: 'p',
        text:
          'Beyaz eşya çevrimiçi alınırken en çok sorulan soru ürünün özellikleri değil, “bana nasıl ulaşacak” sorusudur. Ada içinde teslimat, kargo şirketine bırakılan bir paket işi değildir: buzdolabı, çamaşır makinesi ve fırın gibi ürünler kendi ekiplerimizle taşınır, kapıda indirilir ve uygun ürünlerde kurulumu da yapılır.',
      },
      { kind: 'h2', text: 'Hangi bölgelere teslimat yapılıyor?' },
      {
        kind: 'p',
        text:
          'KKTC genelinde adrese teslimat yapılıyor. Lefkoşa, Girne, Gazimağusa, Güzelyurt ve İskele merkezleriyle bu merkezlere bağlı yerleşimler — Alsancak, Lapta, Karaoğlanoğlu, Çatalköy, Esentepe, Değirmenlik, Yeniboğaziçi, Akdoğan, Dipkarpaz yönü dâhil — teslimat kapsamındadır.',
      },
      {
        kind: 'table',
        head: ['Aşama', 'Ne oluyor'],
        rows: [
          ['Sipariş onayı', 'Stok ve adres doğrulanır, siparişiniz hazırlığa alınır'],
          ['Sevkiyat planı', 'Bölgenize göre teslimat günü belirlenir'],
          ['Randevu araması', 'Teslimattan önce telefonla saat aralığı için aranırsınız'],
          ['Teslimat', 'Ürün kapınıza indirilir, ambalajı kontrol edilir'],
          ['Montaj (uygun ürünlerde)', 'Teknisyen kurulumu yapar ve çalıştırarak teslim eder'],
        ],
      },
      { kind: 'h2', text: 'Teslimat günü hazırlık listesi' },
      {
        kind: 'ol',
        items: [
          'Ürünün geçeceği kapı, koridor ve merdiven genişliğini ölçün. Özellikle gardırop tipi buzdolaplarında bu kritiktir.',
          'Cihazın konulacağı yeri boşaltın ve temizleyin; eski cihaz varsa fişini çekip suyunu boşaltın.',
          'Su bağlantısı gereken ürünlerde (çamaşır ve bulaşık makinesi) musluk ve gider hattının hazır olduğundan emin olun.',
          'Priz konumunu kontrol edin. Uzatma kablosuyla çalıştırılan beyaz eşya hem risklidir hem de bazı durumlarda garanti dışı sayılabilir.',
          'Teslimat sırasında evde bulunacak kişinin telefonunu siparişe yazın.',
        ],
      },
      {
        kind: 'note',
        title: 'Ambalajı teslim alırken açın',
        text:
          'Nakliye sırasında oluşabilecek dış hasarın teslim anında fark edilmesi, sonradan bildirilmesinden çok daha kolay çözülür. Kutuyu ekip yanınızdayken açmanız ve cihazın dış yüzeyini kontrol etmeniz en güvenli yoldur.',
      },
      {
        kind: 'p',
        text:
          'Kurulum gerektiren ürünlerde montaj ayrı bir randevuyla yapılabilir; bu durumda teknisyen sizi arayarak uygun günü belirler. Montaj sürecinin tamamını ayrı bir yazıda anlattık.',
      },
    ],
    faqs: [
      {
        q: 'Teslimat ücreti var mı?',
        a: 'KKTC geneline ücretsiz teslimat yapılıyor. Adres ve ürün tipine göre farklı bir durum varsa sipariş onayı sırasında size bildirilir.',
      },
      {
        q: 'Teslimat saatini seçebilir miyim?',
        a: 'Kesin saat verilmez ancak teslimattan önce aranarak saat aralığı bildirilir. Belirli bir gün veya aralığı tercih ediyorsanız sipariş notuna yazabilirsiniz.',
      },
      {
        q: 'Eski cihazımı alıyor musunuz?',
        a: 'Eski cihazın alınması standart hizmete dâhil değildir. Talebinizi sipariş notuna yazarsanız bölgenize göre değerlendirilir.',
      },
    ],
    relatedCategories: [
      { label: 'Soğutma & Beyaz Eşya', href: '/kategori/buzdolabi' },
      { label: 'Çamaşır Makinesi', href: '/kategori/camasir-makinesi' },
    ],
  },

  {
    slug: 'kktc-online-alisveris-odeme-yontemleri',
    title: 'KKTC’de Online Alışverişte Ödeme: Kart, Havale/EFT ve Güvenlik',
    description:
      'KKTC’de internetten alışverişte kredi kartı, banka havalesi ve EFT nasıl çalışır, 3D Secure nedir, güvenli ödeme için nelere dikkat etmeli?',
    excerpt:
      'Ödeme yöntemleri, 3D Secure doğrulaması ve havaleyle ödemede sürecin nasıl işlediği.',
    category: 'KKTC Rehberi',
    tags: ['ödeme', 'havale', 'EFT', '3D Secure', 'güvenlik'],
    publishedAt: '2026-09-14',
    blocks: [
      {
        kind: 'p',
        text:
          'Ada içinde çevrimiçi alışverişin önündeki en büyük engel teknik değil, güvendir. “Parayı gönderdim, ürün gelmezse ne olacak?” sorusu hâlâ pek çok kişiyi telefonla sipariş vermeye yöneltiyor. Bu yazıda ödeme yöntemlerinin nasıl işlediğini ve hangi noktada neyin güvence altında olduğunu açıklıyoruz.',
      },
      { kind: 'h2', text: 'Kredi ve banka kartı ile ödeme' },
      {
        kind: 'p',
        text:
          'Kart bilgileri ödeme sayfasında bankanın güvenli altyapısı üzerinden işlenir. Kart numaranız satıcıda saklanmaz. İşlem 3D Secure ile doğrulanır: bankanız telefonunuza bir kod gönderir ve işlem ancak bu kod girildikten sonra tamamlanır. Kartınız başkasının eline geçse bile telefonunuzdaki kod olmadan ödeme yapılamaz.',
      },
      { kind: 'h2', text: 'Havale ve EFT ile ödeme' },
      {
        kind: 'p',
        text:
          'Kartla ödemek istemeyenler için banka havalesi seçeneği var. Sipariş tamamlandığında banka hesap bilgileri ve siparişinize ait kısa bir ödeme kodu gösterilir. Bu kodu havalenin açıklama kısmına yazmanız, ödemenizin siparişinizle hızlı eşleşmesini sağlar.',
      },
      {
        kind: 'ol',
        items: [
          'Siparişi tamamlayın; ödeme yöntemi olarak havale/EFT seçin.',
          'Ekranda görünen hesap bilgilerini ve ödeme kodunu not alın. Aynı bilgiler size mesajla da gönderilir.',
          'Havaleyi yapın ve açıklamaya ödeme kodunu yazın.',
          'Ödeme hesaba geçtiğinde siparişiniz onaylanır ve hazırlığa alınır.',
        ],
      },
      {
        kind: 'note',
        title: 'Havalede süre sınırı',
        text:
          'Havale bekleyen siparişlerde ürün sizin için ayrılır. Bu ayırmanın belirli bir süresi vardır; süre dolmadan ödeme yapılmazsa sipariş otomatik olarak düşer ve ürün tekrar satışa açılır. Süre yaklaşırken hatırlatma mesajı gönderilir.',
      },
      { kind: 'h2', text: 'Güvenli alışverişin beş işareti' },
      {
        kind: 'ul',
        items: [
          'Adres çubuğunda kilit simgesi ve https bulunması.',
          'Ödeme adımında bankanın 3D Secure doğrulama ekranının açılması.',
          'Satıcının açık adres, telefon ve vergi bilgilerinin sitede yer alması.',
          'Sipariş sonrası mesaj ya da e-posta ile sipariş numarası gönderilmesi.',
          'İade ve garanti koşullarının sitede yazılı olması.',
        ],
      },
      {
        kind: 'p',
        text:
          'Hiçbir güvenilir satıcı sizden telefonda kart şifrenizi ya da SMS ile gelen doğrulama kodunu istemez. Böyle bir talep geldiğinde işlemi durdurun ve bankanızı arayın.',
      },
    ],
    faqs: [
      {
        q: 'Kapıda ödeme var mı?',
        a: 'Beyaz eşya gibi yüksek tutarlı ürünlerde sipariş, ödeme alındıktan sonra sevkiyata çıkar. Ödeme seçenekleriniz kart veya havale/EFT’dir; güncel durumu sipariş adımında görebilirsiniz.',
      },
      {
        q: 'Taksit yapabiliyor muyum?',
        a: 'Taksit imkânı kartınızın bankasına ve kampanyaya göre değişir. Ödeme adımında kartınız için geçerli taksit seçenekleri ekranda listelenir.',
      },
      {
        q: 'Havale yaptım ama açıklamaya kod yazmayı unuttum, ne olur?',
        a: 'Ödemeniz kaybolmaz; eşleşme elle yapılır ve biraz daha uzun sürer. Sipariş numaranızla bize ulaşırsanız işlem hızlanır.',
      },
    ],
  },

  {
    slug: 'kktc-elektrik-kesintisi-voltaj-beyaz-esya-korumasi',
    title: 'Elektrik Kesintisi ve Voltaj Dalgalanması Beyaz Eşyayı Nasıl Etkiler?',
    description:
      'KKTC’de elektrik kesintisi ve voltaj dalgalanmasının buzdolabı, klima ve televizyona etkisi; regülatör, priz ve koruma yöntemleri.',
    excerpt:
      'Ada şebekesinde yaşanan kesinti ve dalgalanmanın cihazlara etkisi, korunmanın pratik yolları.',
    category: 'KKTC Rehberi',
    tags: ['elektrik kesintisi', 'voltaj', 'regülatör', 'KKTC'],
    publishedAt: '2026-09-14',
    blocks: [
      {
        kind: 'p',
        text:
          'Adada yaşayan herkesin bildiği bir gerçek var: elektrik her zaman istikrarlı gelmiyor. Kesintiler, ani geri gelmeler ve voltaj dalgalanmaları beyaz eşya ve elektronik cihazlar için görünmeyen bir yıpranma kaynağı. Bu yazıda neyin zarar verdiğini ve ne yapılabileceğini anlatıyoruz.',
      },
      { kind: 'h2', text: 'Asıl zararı kesinti değil, geri gelme veriyor' },
      {
        kind: 'p',
        text:
          'Cihazlar için en riskli an elektriğin kesildiği an değil, aniden geri geldiği andır. Geri gelişte oluşan gerilim sıçraması, elektronik kartlar ve kompresörler için en zorlayıcı yüktür. Özellikle buzdolabı ve klima kompresörleri, durduktan hemen sonra tekrar çalıştırılmaya zorlandığında zorlanır.',
      },
      {
        kind: 'table',
        head: ['Cihaz', 'Risk', 'Basit önlem'],
        rows: [
          ['Buzdolabı / derin dondurucu', 'Kompresör zorlanması', 'Kesinti sonrası birkaç dakika bekleyip fişi takın'],
          ['Klima', 'Elektronik kart hasarı', 'Kesinti uzun sürerse cihazı kumandadan kapatın'],
          ['Televizyon', 'Besleme kartı arızası', 'Uzun kesintilerde fişi prizden çekin'],
          ['Çamaşır / bulaşık makinesi', 'Program ortasında kalma', 'Elektrik geldiğinde programı yeniden başlatın'],
          ['Modem, bilgisayar', 'Ani kapanma ve veri kaybı', 'Kesintisiz güç kaynağı (UPS)'],
        ],
      },
      { kind: 'h2', text: 'Korunma yolları' },
      {
        kind: 'ol',
        items: [
          'Uzun kesintilerde hassas cihazların fişini çekin. En ucuz ve en etkili önlem budur.',
          'Sık dalgalanma yaşanan bölgelerde voltaj regülatörü kullanın; klima ve buzdolabı gibi kompresörlü cihazlarda anlamlı koruma sağlar.',
          'Parazit ve ani yükselmelere karşı korumalı priz kullanın. Basit uzatma kablosu koruma sağlamaz.',
          'Beyaz eşyayı uzatma kablosuyla değil, doğrudan prizden besleyin.',
          'Topraklama hattının sağlam olduğundan emin olun. Topraklaması olmayan tesisatta koruma cihazları da beklenen işi görmez.',
        ],
      },
      {
        kind: 'note',
        title: 'Garanti kapsamı',
        text:
          'Şebeke kaynaklı aşırı gerilim ve yıldırım hasarı, beyaz eşya garantilerinde genellikle kapsam dışıdır. Yani faturanın bedeli cihazın kendisine çıkar. Koruma önlemleri, bu yüzden garantiye güvenmekten daha güvenli bir yatırımdır.',
      },
      { kind: 'h2', text: 'Kesinti sırasında buzdolabı' },
      {
        kind: 'p',
        text:
          'Kesinti süresince buzdolabının ve derin dondurucunun kapağını mümkün olduğunca açmayın. Dolu bir dondurucu, kapağı açılmazsa soğuğunu uzun süre korur. Elektrik geldikten sonra cihazın normal sıcaklığa dönmesi birkaç saat sürebilir; bu sürede yeni gıda koymamak daha doğrudur.',
      },
    ],
    faqs: [
      {
        q: 'Regülatör her cihaz için gerekli mi?',
        a: 'Hayır. Öncelik kompresörlü cihazlar ve pahalı elektroniklerdedir: klima, buzdolabı ve büyük ekran televizyon. Küçük ev aletleri için korumalı priz genellikle yeterlidir.',
      },
      {
        q: 'Elektrik gidip geldikten sonra buzdolabını hemen çalıştırmalı mıyım?',
        a: 'Fişi çekmişseniz birkaç dakika bekleyin. Kompresörün içindeki basıncın dengelenmesi için kısa bir süre gerekir; hemen çalıştırmak kompresörü zorlar.',
      },
    ],
    relatedCategories: [
      { label: 'Klima', href: '/kategori/klima' },
      { label: 'Soğutma & Beyaz Eşya', href: '/kategori/buzdolabi' },
    ],
  },

  {
    slug: 'kktc-su-sertligi-kirec-cihaz-omru',
    title: 'KKTC’de Su Sertliği: Kireç Cihazlarınızı Nasıl Yıpratır?',
    description:
      'Sert su çamaşır makinesi, bulaşık makinesi, çaycı ve kahve makinesini nasıl etkiler? Kireç önleme, su yumuşatma ve doğru bakım yöntemleri.',
    excerpt:
      'Adanın sert suyu cihaz ömrünü kısaltıyor. Kirecin nerede biriktiği ve nasıl önleneceği.',
    category: 'KKTC Rehberi',
    tags: ['su sertliği', 'kireç', 'bakım', 'KKTC'],
    publishedAt: '2026-09-15',
    blocks: [
      {
        kind: 'p',
        text:
          'Kıbrıs’ın kireçtaşı ağırlıklı jeolojisi nedeniyle şebeke suyu genellikle serttir. Sert su, içinde çözünmüş kalsiyum ve magnezyum tuzları fazla olan sudur. Bu tuzlar ısıtıldığında çökelerek kireç tabakası oluşturur — ve bu tabaka, ısıtıcılı her cihazın en büyük düşmanıdır.',
      },
      { kind: 'h2', text: 'Kireç nerede birikir, ne yapar?' },
      {
        kind: 'table',
        head: ['Cihaz', 'Kirecin biriktiği yer', 'Sonucu'],
        rows: [
          ['Çamaşır makinesi', 'Rezistans üzerinde', 'Isıtma yavaşlar, tüketim artar, rezistans yanar'],
          ['Bulaşık makinesi', 'Rezistans ve püskürtme kolları', 'Bulaşık lekeli çıkar, delikler tıkanır'],
          ['Çaycı / su ısıtıcısı', 'Taban ve ısıtıcı', 'Su geç kaynar, tortu suya karışır'],
          ['Kahve makinesi', 'Su hattı ve ısıtıcı blok', 'Akış zayıflar, kahve sıcaklığı düşer'],
          ['Ütü', 'Buhar kanalları', 'Buhar delikleri tıkanır, kumaşa beyaz tortu bırakır'],
        ],
      },
      { kind: 'h2', text: 'Ne yapılmalı?' },
      {
        kind: 'ol',
        items: [
          'Bulaşık makinesinde tuz haznesini hiç boş bırakmayın. Makinenin su yumuşatıcısı tam da bu iş için vardır ve tuzsuz çalışmaz.',
          'Çamaşır makinesinde ayda bir kez, 90 °C boş program ile kireç çözücü kullanın.',
          'Çaycı ve su ısıtıcısında sirke ya da kireç çözücüyle iki ayda bir temizlik yapın.',
          'Buharlı ütüde mümkünse arıtılmış su kullanın. Saf su kullanımı bazı modellerde önerilmez; kullanım kılavuzuna bakın.',
          'Kahve makinelerinde cihazın kendi kireç çözme programını uyarı verdiğinde erteleme yapmadan çalıştırın.',
          'Yoğun kullanımda ve çok sert suda, ana hatta takılan su yumuşatma sistemi uzun vadede en köklü çözümdür.',
        ],
      },
      {
        kind: 'note',
        title: 'Kireç garanti kapsamında mı?',
        text:
          'Hayır. Kireç birikmesinden kaynaklanan arızalar bakım eksikliği sayılır ve garanti kapsamı dışındadır. Yılda birkaç kez yapılan kireç çözme işlemi, rezistans değişiminden çok daha ucuzdur.',
      },
      { kind: 'h2', text: 'Suyunuzun sert olduğunu nasıl anlarsınız?' },
      {
        kind: 'ul',
        items: [
          'Musluk ve duş başlıklarında beyaz kabuklanma.',
          'Sabun ve şampuanın zor köpürmesi.',
          'Bardakların bulaşık makinesinden puslu çıkması.',
          'Çaydanlığın dibinde beyaz tortu.',
          'Çamaşırların sertleşerek çıkması.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Sirke kireç çözmek için yeterli mi?',
        a: 'Çaycı ve su ısıtıcısı gibi basit cihazlarda genellikle yeterlidir. Çamaşır ve bulaşık makinesinde ise contalara zarar verebileceği için cihaz için üretilmiş kireç çözücüler tercih edilmelidir.',
      },
      {
        q: 'Bulaşık makinesi tuzu yerine normal tuz kullanabilir miyim?',
        a: 'Hayır. Sofra tuzu içindeki katkılar makinenin yumuşatma reçinesine zarar verir. Yalnızca bulaşık makinesi tuzu kullanılmalıdır.',
      },
    ],
    relatedCategories: [
      { label: 'Bulaşık Makinesi', href: '/kategori/bulasik-makinesi' },
      { label: 'İçecek Hazırlama', href: '/kategori/icecek-hazirlama' },
    ],
  },

  {
    slug: 'kibris-evlilik-paketi-ceyiz-beyaz-esya-listesi',
    title: 'Kıbrıs Evlilik Paketi: Çeyiz ve Düğün İçin Beyaz Eşya Listesi',
    description:
      'Kıbrıs’ta evlilik paketi ve çeyiz için eksiksiz beyaz eşya listesi: neler alınmalı, öncelik sırası nasıl kurulur, bütçe nasıl dağıtılır?',
    excerpt:
      'Önce ne alınmalı, neye şimdi para ayrılmalı, neyi sonraya bırakmak akıllıca? Evlilik paketi için tam liste.',
    category: 'Rehber',
    tags: ['evlilik paketi', 'çeyiz', 'düğün paketi', 'yeni ev', 'bütçe'],
    publishedAt: '2026-09-15',
    blocks: [
      {
        kind: 'p',
        text:
          'Kıbrıs’ta evlilik hazırlığı yapan çiftlerin en çok zorlandığı kalem beyaz eşyadır. “Evlilik paketi”, “çeyiz paketi” ya da “düğün paketi” denilen şey aslında aynı ihtiyacı anlatır: yeni kurulan bir evin ilk günden çalışır hâle gelmesi için gereken cihazların tamamı.',
      },
      {
        kind: 'p',
        text:
          'Alınacaklar listesi hızla uzuyor ve bütçe genellikle listeden önce bitiyor. Doğru yaklaşım her şeyi aynı anda almak değil, eve taşınıldığı gün olmazsa olmazları tamamlayıp geri kalanını sıraya koymaktır.',
      },
      { kind: 'h2', text: 'Birinci öncelik: ilk gün gerekenler' },
      {
        kind: 'ul',
        items: [
          'Buzdolabı — tek gün bile ertelenemez.',
          'Çamaşır makinesi.',
          'Ocak ve fırın (ankastre ya da setüstü).',
          'Davlumbaz — ocakla birlikte planlanmalı.',
          'Su ısıtıcısı veya çaycı.',
        ],
      },
      { kind: 'h2', text: 'İkinci öncelik: ilk aylarda' },
      {
        kind: 'ul',
        items: [
          'Bulaşık makinesi.',
          'Elektrikli süpürge.',
          'Ütü ve ütü masası.',
          'Mikrodalga fırın.',
          'Televizyon.',
        ],
      },
      { kind: 'h2', text: 'Üçüncü öncelik: zamanla' },
      {
        kind: 'ul',
        items: [
          'Airfryer, tost makinesi, ekmek kızartma.',
          'Blender, rondo veya mutfak robotu.',
          'Kahve makinesi.',
          'Derin dondurucu.',
          'Klima (mevsim öncesinde planlanmalı).',
        ],
      },
      { kind: 'h2', text: 'Bütçe nasıl dağıtılır?' },
      {
        kind: 'table',
        head: ['Grup', 'Toplam bütçeden yaklaşık pay'],
        rows: [
          ['Buzdolabı', '%20 - 25'],
          ['Ankastre set (fırın, ocak, davlumbaz)', '%25 - 30'],
          ['Çamaşır ve bulaşık makinesi', '%20 - 25'],
          ['Televizyon', '%10 - 15'],
          ['Küçük ev aletleri', '%10 - 15'],
        ],
      },
      {
        kind: 'note',
        title: 'Uzun ömürlüye yatırım yapın',
        text:
          'Buzdolabı ve çamaşır makinesi on yılı aşan süre kullanılır ve sürekli çalışır. Bütçe kısıtlıysa tasarrufu bu iki üründen değil, sonradan kolayca yükseltilebilecek küçük ev aletlerinden yapmak daha akıllıcadır.',
      },
      { kind: 'h2', text: 'Sık yapılan hatalar' },
      {
        kind: 'ol',
        items: [
          'Ölçü almadan ankastre almak. Fırın ve ocak nişleri standart olsa da mutfak dolabı her zaman standart değildir.',
          'Davlumbazı sonraya bırakmak. Baca çıkışı mutfak yapılırken planlanmazsa sonradan bacasız modele mecbur kalınır.',
          'Çamaşır makinesi için gider ve musluk hazırlığını atlamak.',
          'Bütün ürünleri ayrı ayrı, farklı zamanlarda almak. Aynı siparişte toplanan alımda teslimat ve montaj tek seferde yapılır.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Kıbrıs’ta evlilik paketi ne kadar tutar?',
        a: 'Tutar tamamen seçilen ürünlerin sınıfına bağlıdır. Bütçeyi doğru kurmanın yolu toplam rakam aramak yerine listeyi öncelik sırasına koymak ve her gruba yaklaşık bir pay ayırmaktır; yukarıdaki dağılım tablosu bunun için hazırlandı.',
      },
      {
        q: 'Evlilik paketini tek seferde mi almalıyım?',
        a: 'Aynı siparişte toplanan alımda teslimat ve montaj tek seferde yapılır, bu da hem zaman hem koordinasyon kazandırır. Bütçe elvermiyorsa ilk gün gerekenleri tamamlayıp gerisini sıraya koymak daha sağlıklıdır.',
      },
      {
        q: 'Ankastre mi setüstü mü daha mantıklı?',
        a: 'Mutfağınız sıfırdan yapılıyorsa ankastre hem görünüm hem kullanım açısından öndedir. Kiralık evde ya da taşınma ihtimali varsa setüstü ocak ve solo fırın daha esnektir.',
      },
      {
        q: 'Hepsini aynı markadan almak gerekir mi?',
        a: 'Gerekmez, ancak ankastre fırın-ocak-davlumbaz üçlüsünde aynı seriden almak görünüm bütünlüğü sağlar ve ölçü uyumu garanti olur.',
      },
    ],
    relatedCategories: [
      { label: 'Ankastre & Ocak Setleri', href: '/kategori/ankastre' },
      { label: 'Ev Gereçleri', href: '/kategori/ev-gerecleri' },
    ],
  },

  {
    slug: 'beyaz-esya-olculeri-kapidan-gecer-mi',
    title: 'Beyaz Eşya Kapıdan Geçer mi? Sipariş Öncesi Ölçü Alma Rehberi',
    description:
      'Buzdolabı ve çamaşır makinesi kapıdan geçer mi? Kapı, koridor, merdiven ve asansör ölçüsü nasıl alınır, hangi paylar bırakılmalı?',
    excerpt:
      'Teslimat günü yaşanan en can sıkıcı sorunun önüne geçen beş dakikalık ölçü kontrolü.',
    category: 'Rehber',
    tags: ['ölçü', 'teslimat', 'buzdolabı', 'montaj'],
    publishedAt: '2026-09-16',
    blocks: [
      {
        kind: 'p',
        text:
          'Teslimat gününde yaşanan en can sıkıcı durum, ürünün eve girememesidir. Oysa bu, sipariş öncesi beş dakikalık bir ölçümle tamamen önlenebilir. Ürün sayfasındaki ölçüler cihazın kendi ölçüleridir; taşınırken kutu ölçüsü bunun birkaç santim üzerindedir.',
      },
      { kind: 'h2', text: 'Ölçülecek beş nokta' },
      {
        kind: 'ol',
        items: [
          'Bina giriş kapısı genişliği.',
          'Merdiven boşluğu ve sahanlıkta dönüş yapılabilecek genişlik.',
          'Asansör kapı genişliği ve kabin derinliği (asansör kullanılacaksa).',
          'Daire kapısı genişliği ve koridor darlıkları.',
          'Cihazın gireceği nişin genişliği, derinliği ve yüksekliği.',
        ],
      },
      { kind: 'h2', text: 'Bırakılması gereken paylar' },
      {
        kind: 'table',
        head: ['Ürün', 'Niş için bırakılacak pay'],
        rows: [
          ['Buzdolabı', 'Yanlarda 2-3 cm, arkada 5 cm, üstte 5 cm'],
          ['Çamaşır / bulaşık makinesi', 'Yanlarda 1-2 cm, arkada hortum için 5-8 cm'],
          ['Ankastre fırın', 'Niş ölçüsüne tam, havalandırma boşluğu üretici tablosuna göre'],
          ['Derin dondurucu', 'Yanlarda 3 cm, arkada 5 cm'],
        ],
      },
      {
        kind: 'p',
        text:
          'Buzdolabında sıkça atlanan bir ayrıntı var: kapının açılma açısı. Cihaz nişe sığsa bile, kapağı yeterince açılamıyorsa çekmeceler dışarı çıkmaz. Yan duvara çok yakın yerleştirilen buzdolaplarında bu sorun sık yaşanır.',
      },
      {
        kind: 'note',
        title: 'Kapı kanadı sökülebilir',
        text:
          'Dar kapılarda ürünün kutusunu açıp cihazı çıplak taşımak ve gerekirse daire kapısının kanadını menteşesinden sökmek çoğu durumda sorunu çözer. Bunun teslimat günü mümkün olup olmadığını önceden düşünmekte fayda var.',
      },
      { kind: 'h2', text: 'Standart ölçüler' },
      {
        kind: 'ul',
        items: [
          'Çamaşır makinesi: genellikle 60 cm genişlik, 55-65 cm derinlik.',
          'Bulaşık makinesi: 60 cm (standart) ya da 45 cm (dar model).',
          'Ankastre fırın: 60 cm genişlik, 60 cm niş.',
          'Tek kapılı buzdolabı: 55-70 cm genişlik.',
          'Gardırop tipi (side by side) buzdolabı: 90-95 cm genişlik — dar kapılarda en çok sorun çıkan üründür.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Ürün eve girmezse ne oluyor?',
        a: 'Bu durumu baştan önlemek için sipariş öncesi ölçü almanızı öneriyoruz. Emin olamadığınız noktada bize ulaşın; ürünün kutu ölçülerini paylaşalım.',
      },
      {
        q: 'Ürün sayfasındaki ölçüler kutu ölçüsü mü?',
        a: 'Hayır, cihazın kendi ölçüleridir. Kutu genellikle her yönde birkaç santim daha büyüktür; dar geçişlerde bunu hesaba katın.',
      },
    ],
    relatedCategories: [{ label: 'Soğutma & Beyaz Eşya', href: '/kategori/buzdolabi' }],
  },

  {
    slug: 'online-mu-magazadan-mi-beyaz-esya-almali',
    title: 'Beyaz Eşyayı Online mı Mağazadan mı Almalı?',
    description:
      'KKTC’de beyaz eşyayı internetten almanın ve mağazadan almanın artıları eksileri; fiyat, garanti, montaj ve iade açısından karşılaştırma.',
    excerpt:
      'İki alışveriş biçiminin gerçek farkları ve hangi durumda hangisinin daha avantajlı olduğu.',
    category: 'Rehber',
    tags: ['online alışveriş', 'mağaza', 'karşılaştırma'],
    publishedAt: '2026-09-16',
    blocks: [
      {
        kind: 'p',
        text:
          'Adada beyaz eşya alışverişi uzun yıllar mağazada yapıldı ve bu alışkanlık hâlâ güçlü. İnternetten alışveriş ise son yıllarda hızla arttı. İkisi birbirinin alternatifi gibi görünse de gerçekte avantajları farklı yerlerde.',
      },
      {
        kind: 'table',
        head: ['Konu', 'Online', 'Mağaza'],
        rows: [
          ['Fiyat karşılaştırma', 'Anında, yan yana', 'Mağaza mağaza gezmek gerekir'],
          ['Ürünü görme', 'Fotoğraf ve teknik özellikler', 'Elle dokunma, boyut hissi'],
          ['Stok bilgisi', 'Anlık görünür', 'Sorup öğrenmek gerekir'],
          ['Karar süresi', 'İstediğiniz kadar', 'Satış görevlisi baskısı olabilir'],
          ['Teslimat', 'Adrese getirilir', 'Genellikle yine adrese teslim'],
          ['Danışma', 'Telefon ve WhatsApp', 'Yüz yüze'],
        ],
      },
      { kind: 'h2', text: 'Online alışverişin gerçek avantajı' },
      {
        kind: 'p',
        text:
          'En büyük avantaj fiyat değil, karşılaştırma imkânıdır. Üç farklı buzdolabının enerji sınıfını, hacmini ve ölçülerini yan yana görmek mağazada neredeyse imkânsızdır. Ayrıca sipariş geçmişi, faturanız ve garanti başlangıcınız kayıt altında kalır — kâğıt fatura kaybolduğunda bu çok işe yarar.',
      },
      { kind: 'h2', text: 'Mağazanın avantajı' },
      {
        kind: 'p',
        text:
          'Ürünün gerçek boyutunu görmek, kapak hissini denemek ve bir kişiyle yüz yüze konuşmak bazı alımlarda değerlidir. Özellikle ilk kez beyaz eşya alanlar için bu güven verir.',
      },
      {
        kind: 'note',
        title: 'İkisini birleştirmek en iyisi',
        text:
          'En pratik yol: ürün seçimini internetten karşılaştırarak yapmak, kararsız kaldığınız noktada telefonla ya da WhatsApp’tan sormak. Ürün sayfasındaki “Sizi arayalım” ve WhatsApp düğmeleri tam bunun için var — yazışma sırasında hangi ürüne baktığınız da karşı tarafa iletiliyor.',
      },
      { kind: 'h2', text: 'Online alırken kontrol edilecekler' },
      {
        kind: 'ol',
        items: [
          'Ürünün resmi distribütör garantili olup olmadığı.',
          'Montajın fiyata dâhil olup olmadığı.',
          'Teslimat süresi ve bölgenizin kapsamda olup olmadığı.',
          'İade ve değişim koşulları.',
          'Satıcının telefonla ulaşılabilir olması.',
        ],
      },
    ],
    faqs: [
      {
        q: 'İnternetten alınan beyaz eşyanın garantisi geçerli mi?',
        a: 'Resmi distribütör güvencesiyle satılan ürünlerde garanti, mağazadan alınan üründen farksızdır. Fark yalnızca satın alma kanalındadır.',
      },
      {
        q: 'Ürünü beğenmezsem iade edebilir miyim?',
        a: 'Kullanılmamış ve ambalajı korunmuş ürünlerde iade hakkınız vardır. Montajı yapılmış ve kullanılmış ürünlerde koşullar farklıdır; iade şartlarını sipariş öncesi okumanızı öneririz.',
      },
    ],
  },

  {
    slug: 'kiralik-ev-ogrenci-beyaz-esya-kktc',
    title: 'Kiralık Ev ve Öğrenci Evi İçin Beyaz Eşya: KKTC Rehberi',
    description:
      'KKTC’de kiralık eve ya da öğrenci evine beyaz eşya alırken taşınabilirlik, boyut, bütçe ve ortak kullanım için pratik öneriler.',
    excerpt:
      'Taşınma ihtimali olan bir evde hangi cihazlar mantıklı, neye para vermeye değmez?',
    category: 'KKTC Rehberi',
    tags: ['kiralık ev', 'öğrenci evi', 'bütçe', 'KKTC'],
    publishedAt: '2026-09-17',
    blocks: [
      {
        kind: 'p',
        text:
          'KKTC’de üniversiteler nedeniyle kiralık ev hareketliliği yüksek. Bir iki yıl sonra taşınma ihtimali olan bir evde beyaz eşya seçimi, uzun süre oturulacak bir evdekinden farklı yapılmalı. Belirleyici ölçüt tek: taşınırken bu cihazı yanımda götürebilir miyim?',
      },
      { kind: 'h2', text: 'Taşınabilirliği yüksek olanlar' },
      {
        kind: 'ul',
        items: [
          'Setüstü ocak ve solo fırın — ankastreye göre sökülüp takılması çok kolay.',
          'Küçük veya orta boy buzdolabı.',
          'Standart çamaşır makinesi.',
          'Mikrodalga, airfryer, su ısıtıcısı, tost makinesi.',
          'Dikey şarjlı süpürge — hem küçük hem hafif.',
          'Taşınabilir (portatif) klima — duvara montaj gerektirmez.',
        ],
      },
      { kind: 'h2', text: 'Kiralık evde düşünülmesi gerekenler' },
      {
        kind: 'ol',
        items: [
          'Ankastre ürün almayın. Ankastre fırın ve ocak mutfağa gömülüdür; taşınırken sökülse bile yeni mutfağın ölçüsüne uymayabilir.',
          'Duvara montaj gerektiren cihazlarda ev sahibinden izin alın. Split klima montajı duvarda kalıcı iz bırakır.',
          'Küçük hacim seçin. 200 litrelik bir buzdolabı iki kişilik eve yeter ve taşıması çok daha kolaydır.',
          'Kutuları saklayın. Orijinal ambalajıyla taşınan cihaz çok daha az hasar görür.',
          'Faturanızı ve sipariş kaydınızı saklayın; garanti süresi taşındığınızda da devam eder.',
        ],
      },
      { kind: 'h2', text: 'Öğrenci evinde ortak kullanım' },
      {
        kind: 'p',
        text:
          'Ev arkadaşlarıyla ortak alınan cihazlarda en sık yaşanan sorun, ayrılırken cihazın kimde kalacağıdır. Alım sırasında bunu konuşmak ve faturayı kimin adına keseceğinizi netleştirmek, sonradan çıkacak tartışmayı baştan önler.',
      },
      {
        kind: 'note',
        title: 'Eşyalı evde cihazlar size ait değil',
        text:
          'Eşyalı kiralık evlerde beyaz eşya ev sahibine aittir ve arızalandığında sorumluluk genellikle ondadır. Kira sözleşmesi imzalanırken mevcut cihazların çalışır durumda olduğunu birlikte kontrol edip yazılı hâle getirmek iki taraf için de koruyucudur.',
      },
    ],
    faqs: [
      {
        q: 'Öğrenci evi için kaç litre buzdolabı yeterli?',
        a: 'İki kişi için 180-250 litre rahat yeter. Dört kişilik bir öğrenci evinde 300 litre üzeri ya da ikinci bir mini buzdolabı daha pratik olur.',
      },
      {
        q: 'Portatif klima split klima kadar soğutur mu?',
        a: 'Aynı BTU’da split klima daha verimli ve sessizdir. Ancak montaj yapılamayan ya da izin alınamayan kiralık evlerde portatif klima tek uygulanabilir çözümdür.',
      },
    ],
    relatedCategories: [
      { label: 'Soğutma & Beyaz Eşya', href: '/kategori/buzdolabi' },
      { label: 'Ev Gereçleri', href: '/kategori/ev-gerecleri' },
    ],
  },

  {
    slug: 'beyaz-esya-ne-zaman-alinir-kampanya-takvimi',
    title: 'Beyaz Eşya Ne Zaman Alınır? Yıllık Kampanya Takvimi',
    description:
      'Beyaz eşya ve elektronik alımında fiyatların ne zaman avantajlı olduğu, sezon dışı alımın mantığı ve kampanya takibi için pratik yöntemler.',
    excerpt:
      'Klimayı temmuzda, şofbeni ocakta almamanın nedeni: sezon dışı alım neden daha akıllıca?',
    category: 'Rehber',
    tags: ['kampanya', 'indirim', 'satın alma zamanı'],
    publishedAt: '2026-09-17',
    blocks: [
      {
        kind: 'p',
        text:
          'Aynı ürün yıl boyunca aynı fiyata satılmaz. Talebin yoğunlaştığı dönemlerde stoklar erir ve indirim ihtiyacı kalmaz; talebin düştüğü dönemlerde ise satıcılar stok eritmek için daha istekli olur. Bu basit döngüyü bilmek, ciddi fark yaratır.',
      },
      { kind: 'h2', text: 'Ürün gruplarına göre en uygun dönem' },
      {
        kind: 'table',
        head: ['Ürün', 'Talebin zirvesi', 'Daha avantajlı dönem'],
        rows: [
          ['Klima', 'Haziran - Ağustos', 'Ekim - Mart'],
          ['Isıtıcı ve şofben', 'Kasım - Ocak', 'Nisan - Eylül'],
          ['Buzdolabı', 'Yaz başı', 'Sonbahar'],
          ['Ankastre set', 'Yaz (taşınma sezonu)', 'Kış'],
          ['Televizyon', 'Büyük turnuva dönemleri', 'Turnuva sonrası'],
          ['Okul/öğrenci ürünleri', 'Eylül', 'Kasım sonrası'],
        ],
      },
      { kind: 'h2', text: 'Yeni model çıkışı' },
      {
        kind: 'p',
        text:
          'Üreticiler yeni model serilerini genellikle yılın belirli dönemlerinde tanıtır. Yeni seri rafa çıktığında bir önceki serinin fiyatı düşer — üstelik iki seri arasındaki fark çoğu zaman görünümden ve birkaç ek özellikten ibarettir. Bir önceki model, aynı garantiyle çok daha uygun fiyata alınabilir.',
      },
      {
        kind: 'note',
        title: 'İhtiyacınızı ertelemeyin',
        text:
          'Bozulan buzdolabını “kampanya olsun” diye üç ay beklemek mantıklı değildir; bozulan gıdaların bedeli indirimi aşar. Kampanya takvimi, planlı alımlar için geçerli bir strateji — acil ihtiyaçlar için değil.',
      },
      { kind: 'h2', text: 'Kampanyaları kaçırmamak için' },
      {
        kind: 'ul',
        items: [
          'İlgilendiğiniz ürünün sayfasında fiyat düşüşünü takip edin.',
          'Stokta olmayan ürünlerde “gelince haber ver” bırakın; ürün geldiğinde ilk siz haberdar olursunuz.',
          'Sosyal medya hesaplarımızı takip edin; kampanyalar önce orada duyuruluyor.',
          'Sepete eklediğiniz ürünün fiyatı değişirse sepet üzerinden görebilirsiniz.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Sezon dışı alınan klima kışın bekletilir mi?',
        a: 'Evet, sorun olmaz. Kutusunda ve kuru bir ortamda bekleyen klima zarar görmez. Montajı da sezon dışında daha kolay randevu bulunarak yapılabilir.',
      },
      {
        q: 'Bir önceki model almak riskli mi?',
        a: 'Hayır. Garanti ve yedek parça desteği aynıdır. Yalnızca çok eski, üretimden kalkmış modellerde yedek parça sıkıntısı yaşanabilir; güncel serinin bir öncekinde bu risk yoktur.',
      },
    ],
    relatedCategories: [{ label: 'Klima', href: '/kategori/klima' }],
  },
]
