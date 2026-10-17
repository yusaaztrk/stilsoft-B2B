import type { BlogPost } from '@/lib/blog'

/**
 * Yazı gövdeleri — 6. bölüm: BAKIM, ARIZA ve KULLANIM.
 *
 * <b>Neden bu grup (2026-09-21):</b> buradaki başlıklar satın alma niyetiyle değil,
 * SORUNLA aranıyor: "çamaşır makinesi kokuyor", "buzdolabını taşıdıktan sonra kaç saat
 * beklemeli", "fırın nasıl temizlenir". Arama hacmi yüksek, rekabet düşük ve arayan kişi
 * zaten o cihaza sahip — yani gelecekteki yedek parça, servis ve yenileme müşterisi.
 *
 * Bu yazılar doğrudan satış yapmaz; siteyi arama motorunun gözünde "bu konuda otorite"
 * hâline getirir ve satın alma aramalarında kategori sayfalarını yukarı taşır. Her birinde
 * yetkili servis ve ilgili kategoriye bağlantı var, böylece çözüm arayan ziyaretçi
 * kataloğa da düşüyor.
 */
export const BLOG_POSTS_6: BlogPost[] = [
  {
    slug: 'buzdolabi-tasindiktan-sonra-kac-saat-beklemeli',
    title: 'Buzdolabı Taşındıktan Sonra Kaç Saat Beklemeli?',
    description:
      'Yeni alınan ya da taşınan buzdolabı fişe takılmadan önce ne kadar beklemeli? Yatık taşımanın riski ve ilk çalıştırma adımları.',
    excerpt:
      'Bekleme süresinin sebebi ve yanlış yapıldığında kompresöre ne olduğu — kısa ve net.',
    category: 'Bakım & Kullanım',
    tags: ['buzdolabı', 'taşıma', 'ilk çalıştırma', 'kompresör'],
    publishedAt: '2026-09-18',
    blocks: [
      {
        kind: 'p',
        text:
          'Buzdolabı taşındıktan sonra hemen fişe takılmaz. Bunun sebebi bir batıl inanç değil, cihazın içindeki yağ ve soğutucu akışkanın fizik kurallarına göre yer değiştirmesidir.',
      },
      { kind: 'h2', text: 'Neden beklemek gerekiyor?' },
      {
        kind: 'p',
        text:
          'Kompresörün içinde, hareketli parçaları yağlayan bir yağ bulunur. Cihaz yatırıldığında ya da sarsıldığında bu yağ, soğutucu akışkanın dolaştığı borulara kaçabilir. Bu durumdayken cihaz çalıştırılırsa hem kompresör yağsız kalır hem de borular tıkanır. Sonuç, çoğu zaman tamiri kompresör değişimi gerektiren kalıcı bir arızadır.',
      },
      { kind: 'h2', text: 'Ne kadar beklemeli?' },
      {
        kind: 'table',
        head: ['Taşıma biçimi', 'Beklenmesi gereken süre'],
        rows: [
          ['Hiç yatırılmadan, dik taşındıysa', '2 - 4 saat'],
          ['Kısa süre hafif eğik taşındıysa', '6 - 8 saat'],
          ['Yatırılarak taşındıysa', '12 - 24 saat'],
          ['Uzun mesafe, yatık ve sarsıntılı', '24 saat'],
        ],
      },
      {
        kind: 'note',
        title: 'Emin değilseniz uzun olanı seçin',
        text:
          'Fazladan beklemenin hiçbir zararı yoktur; erken çalıştırmanın bedeli ise kompresördür. Nasıl taşındığından emin değilseniz 24 saat bekleyin.',
      },
      { kind: 'h2', text: 'İlk çalıştırma adımları' },
      {
        kind: 'ol',
        items: [
          'Cihazı yerine yerleştirin; arkada en az 5 cm, yanlarda 2-3 cm boşluk bırakın.',
          'Ayaklarını ayarlayarak terazisini alın. Dengesiz duran buzdolabı hem titrer hem kapağı tam kapanmaz.',
          'İç yüzeyleri ılık suyla ve az miktarda karbonatla silin, kurulayın.',
          'Bekleme süresi dolduktan sonra fişi doğrudan prize takın, uzatma kablosu kullanmayın.',
          'Boşken 4-6 saat çalıştırın; iç sıcaklık düşene kadar gıda yerleştirmeyin.',
          'Termostatı orta kademeye alın. Soğutma bölmesi için 4 °C, dondurucu için -18 °C yaygın hedeftir.',
        ],
      },
      {
        kind: 'p',
        text:
          'İlk günlerde kompresörün uzun süre çalışması normaldir; cihaz henüz soğuk kütlesini oluşturmamıştır. Birkaç gün içinde çalışma aralıkları normale döner.',
      },
    ],
    faqs: [
      {
        q: 'Buzdolabı yatık taşınabilir mi?',
        a: 'Mümkünse hayır. Zorunlu hâllerde kompresörün bulunduğu taraf ÜSTTE kalacak şekilde yatırılmalı ve taşıma sonrası en az 12-24 saat dik bekletilmelidir.',
      },
      {
        q: 'Yeni buzdolabı kokuyor, normal mi?',
        a: 'İlk kullanımda hafif plastik kokusu normaldir. İç yüzeyi karbonatlı suyla silmek ve birkaç gün içine açık bir kap karbonat koymak kokuyu hızla giderir.',
      },
    ],
    relatedCategories: [{ label: 'Soğutma & Beyaz Eşya', href: '/kategori/buzdolabi' }],
  },

  {
    slug: 'camasir-makinesi-kokusu-ve-kirec-temizligi',
    title: 'Çamaşır Makinesi Neden Kokar? Temizlik ve Kireç Çözme Rehberi',
    description:
      'Çamaşır makinesinde küf ve kötü koku neden oluşur, conta ve deterjan çekmecesi nasıl temizlenir, kireç çözme ne sıklıkla yapılmalı?',
    excerpt:
      'Kokunun kaynağı neredeyse her zaman aynı üç yer. Nerede biriktiğini ve nasıl temizleneceğini anlatıyoruz.',
    category: 'Bakım & Kullanım',
    tags: ['çamaşır makinesi', 'küf', 'kireç', 'bakım'],
    publishedAt: '2026-09-18',
    blocks: [
      {
        kind: 'p',
        text:
          'Çamaşır makinesinden gelen küf kokusu, cihazın arızalandığı anlamına gelmez. Neredeyse her zaman aynı üç yerde biriken nem, deterjan artığı ve kirden kaynaklanır: kapak contası, deterjan çekmecesi ve pompa filtresi.',
      },
      { kind: 'h2', text: '1. Kapak contası' },
      {
        kind: 'p',
        text:
          'Ön yüklemeli makinelerde kapak contasının kıvrımında su birikir ve burada küf oluşur. Contayı geriye doğru kaldırıp içini nemli bezle silin, ardından kurulayın. Siyah lekeler oluşmuşsa seyreltilmiş çamaşır suyuyla silinebilir. Bu bölge ayda bir temizlenmelidir.',
      },
      { kind: 'h2', text: '2. Deterjan çekmecesi' },
      {
        kind: 'p',
        text:
          'Çekmecede kalan yumuşatıcı ve deterjan artıkları zamanla jel kıvamında bir tabaka oluşturur ve kokar. Çekmece çoğu modelde tamamen çıkar; ılık suda fırçayla yıkanmalı, çekmecenin girdiği yuva da silinmelidir.',
      },
      { kind: 'h2', text: '3. Pompa filtresi' },
      {
        kind: 'p',
        text:
          'Makinenin alt ön kısmındaki küçük kapağın arkasında yer alır. İçinde biriken tüy, saç, bozuk para ve kâğıt parçaları hem kokar hem de suyun tahliyesini yavaşlatır. Açmadan önce altına havlu koyun; içinde su kalmış olabilir. Üç ayda bir temizlenmesi yeterlidir.',
      },
      { kind: 'h2', text: 'Kireç çözme' },
      {
        kind: 'p',
        text:
          'KKTC’de su sert olduğu için rezistans üzerinde kireç birikir. Ayda bir kez, makine boşken 90 °C pamuklu programda kireç çözücüyle çalıştırmak hem kireci hem kokuyu giderir. Bu işlem tamburu da temizler.',
      },
      {
        kind: 'table',
        head: ['İşlem', 'Sıklık'],
        rows: [
          ['Kapak contası silme', 'Ayda 1'],
          ['Deterjan çekmecesi yıkama', 'Ayda 1'],
          ['Pompa filtresi temizliği', '3 ayda 1'],
          ['Kireç çözücüyle boş program', 'Ayda 1'],
          ['Su giriş hortumu filtresi', 'Yılda 1'],
        ],
      },
      {
        kind: 'note',
        title: 'Kapağı açık bırakın',
        text:
          'Kokuyu önlemenin en kolay yolu: yıkama bitince kapağı ve deterjan çekmecesini bir süre açık bırakın. İçerideki nem uçtuğunda küf oluşacak ortam kalmaz. Tek başına bu alışkanlık, koku şikâyetlerinin çoğunu ortadan kaldırır.',
      },
      { kind: 'h2', text: 'Sık yapılan hatalar' },
      {
        kind: 'ul',
        items: [
          'Fazla deterjan koymak. Artan deterjan durulanmaz, makinede birikir ve kokar.',
          'Sürekli düşük sıcaklıkta yıkamak. 30 °C programlar yağı ve bakteriyi tam çözmez; ara sıra yüksek sıcaklık gerekir.',
          'Islak çamaşırı makinede unutmak.',
          'Kirli çamaşırı makinenin içinde biriktirmek.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Sirke kullanabilir miyim?',
        a: 'Ara sıra kullanılabilir ancak sürekli kullanımda lastik conta ve hortumlara zarar verebilir. Düzenli bakım için makine temizleyici ürünler daha güvenlidir.',
      },
      {
        q: 'Makine temizleme programı yeterli mi?',
        a: 'Tamburu temizler ama contayı, çekmeceyi ve pompa filtresini temizlemez. Bu üç nokta elle temizlenmelidir.',
      },
    ],
    relatedCategories: [{ label: 'Çamaşır Makinesi', href: '/kategori/camasir-makinesi' }],
  },

  {
    slug: 'bulasik-makinesi-tuz-parlatici-ayari',
    title: 'Bulaşık Makinesinde Tuz ve Parlatıcı: Doğru Ayar Nasıl Yapılır?',
    description:
      'Bulaşık makinesi tuzu ne işe yarar, parlatıcı ayarı kaç olmalı, bardaklar neden puslu çıkar? Sert suya göre ayar rehberi.',
    excerpt:
      'Bardakların puslu çıkmasının ve bulaşıkların ıslak kalmasının sebebi genellikle iki ayarda gizli.',
    category: 'Bakım & Kullanım',
    tags: ['bulaşık makinesi', 'tuz', 'parlatıcı', 'su sertliği'],
    publishedAt: '2026-09-19',
    blocks: [
      {
        kind: 'p',
        text:
          'Bulaşık makinesi doğru çalışmasına rağmen bardaklar puslu çıkıyorsa, tabaklarda beyaz iz kalıyorsa ya da bulaşıklar ıslak çıkıyorsa sorun neredeyse her zaman makinenin kendisinde değil; tuz ve parlatıcı ayarındadır.',
      },
      { kind: 'h2', text: 'Tuz ne işe yarar?' },
      {
        kind: 'p',
        text:
          'Bulaşık makinesinin içinde suyu yumuşatan bir reçine bulunur. Bu reçine zamanla doyar ve yeniden çalışabilmek için tuza ihtiyaç duyar. Tuz bulaşıkları temizlemez — makinenin su yumuşatıcısını yeniler. KKTC’de su sert olduğu için tuz haznesi düzenli kontrol edilmelidir.',
      },
      {
        kind: 'note',
        title: '“Hepsi bir arada” tablet tuzun yerini tutmaz',
        text:
          'Çok amaçlı tabletler orta sertlikteki suya göre tasarlanır. Sert suda tek başına yetmez. Tablet kullansanız bile tuz haznesini doldurmaya devam etmelisiniz; aksi hâlde reçine yıpranır ve makinenin yumuşatma özelliği kalıcı olarak zayıflar.',
      },
      { kind: 'h2', text: 'Parlatıcı ne işe yarar?' },
      {
        kind: 'p',
        text:
          'Parlatıcı, durulama suyunun yüzeyde damla hâlinde kalmasını engeller. Su damlası kalmayınca kuruma hızlanır ve kuruyan damlanın bıraktığı kireç izi oluşmaz. Bulaşıklar ıslak çıkıyorsa parlatıcı ayarını yükseltmek ilk denenecek şeydir.',
      },
      {
        kind: 'table',
        head: ['Belirti', 'Muhtemel sebep', 'Yapılacak'],
        rows: [
          ['Bardakta beyaz/puslu iz', 'Su çok sert, tuz yetersiz', 'Tuz doldurun, sertlik kademesini yükseltin'],
          ['Bardakta gökkuşağı gibi izler', 'Parlatıcı fazla', 'Parlatıcı kademesini düşürün'],
          ['Bulaşık ıslak çıkıyor', 'Parlatıcı az', 'Parlatıcı kademesini yükseltin'],
          ['Tabakta kum gibi tanecik', 'Tuz kapağı gevşek, tuz içeri kaçıyor', 'Kapağı sıkın'],
          ['Yemek artığı kalıyor', 'Filtre tıkalı / püskürtme kolu tıkalı', 'Filtreyi ve kolları temizleyin'],
        ],
      },
      { kind: 'h2', text: 'Su sertliği ayarı' },
      {
        kind: 'p',
        text:
          'Her bulaşık makinesinde su sertliği kademesi vardır ve fabrika ayarı genellikle ortadır. Sert su bölgesinde bu kademeyi yükseltmek gerekir. Ayarın nasıl yapılacağı modele göre değişir; kullanım kılavuzundaki “su sertliği” bölümüne bakın. Yanlış kademe, hem tuzun boşa harcanmasına hem de kireç izine yol açar.',
      },
      { kind: 'h2', text: 'Aylık kontrol listesi' },
      {
        kind: 'ol',
        items: [
          'Tuz haznesini kontrol edin, gerekiyorsa doldurun.',
          'Parlatıcı seviyesine bakın.',
          'Alt filtreyi çıkarıp yıkayın.',
          'Püskürtme kollarının deliklerini kontrol edin, tıkalıysa kürdanla açın.',
          'Kapak contasını nemli bezle silin.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Tuz haznesinde su görüyorum, normal mi?',
        a: 'Evet, normaldir. Hazne her zaman sulu görünür; tuz suda çözünerek çalışır. Önemli olan haznede tuz kalıp kalmadığıdır.',
      },
      {
        q: 'Makinemde tuz uyarı ışığı yanmıyor, tuz koymalı mıyım?',
        a: 'Sert su bölgesinde evet. Bazı modellerde uyarı ışığı geç yanar; düzenli kontrol daha güvenlidir.',
      },
    ],
    relatedCategories: [{ label: 'Bulaşık Makinesi', href: '/kategori/bulasik-makinesi' }],
  },

  {
    slug: 'firin-temizligi-pirolitik-katalitik-fark',
    title: 'Fırın Temizliği: Pirolitik, Katalitik ve Hidrolitik Farkı',
    description:
      'Fırın kendi kendini nasıl temizler? Pirolitik, katalitik ve buharlı temizlik farkları, cam kapak temizliği ve pratik yöntemler.',
    excerpt:
      'Üç temizlik sisteminin gerçek farkı ve fırını uğraşmadan temiz tutmanın yolları.',
    category: 'Bakım & Kullanım',
    tags: ['fırın', 'pirolitik', 'katalitik', 'temizlik'],
    publishedAt: '2026-09-19',
    blocks: [
      {
        kind: 'p',
        text:
          'Fırın temizliği, mutfaktaki en sevilmeyen iştir. Ankastre fırın alırken temizlik sistemine bakmak, bu işi yıllar boyunca kolaylaştırır. Üç yaygın sistem var ve aralarındaki fark oldukça büyük.',
      },
      { kind: 'h2', text: 'Pirolitik: en etkili yöntem' },
      {
        kind: 'p',
        text:
          'Fırın iç sıcaklığı çok yüksek bir dereceye çıkarılır ve içerideki yağ artıkları kül hâline gelir. Program bittiğinde nemli bir bezle külü silmeniz yeterlidir. Kimyasal gerekmez, ızgara telleri de içeride temizlenebilir. Buna karşılık pirolitik program sırasında ciddi elektrik harcanır ve kapı güvenlik kilidi devreye girer.',
      },
      { kind: 'h2', text: 'Katalitik: yağı pişirirken emen paneller' },
      {
        kind: 'p',
        text:
          'Fırının yan ve arka duvarlarına gözenekli katalitik paneller yerleştirilir. Bu paneller, normal pişirme sırasında yüksek sıcaklıkta yağı emer ve parçalar. Ayrı bir temizlik programı yoktur. Panellerin ömrü sınırlıdır ve zamanla doyduklarında değiştirilmeleri gerekir. Ayrıca taban ve kapak camı yine elle temizlenir.',
      },
      { kind: 'h2', text: 'Hidrolitik (buharlı): en ekonomik' },
      {
        kind: 'p',
        text:
          'Fırın tabanına bir miktar su konur, düşük sıcaklıkta kısa bir program çalıştırılır ve oluşan buhar kiri yumuşatır. Ardından bezle silinir. Hafif kirlenmede pratiktir, yanmış ve sertleşmiş yağda yetersiz kalır.',
      },
      {
        kind: 'table',
        head: ['Sistem', 'Etkinlik', 'Elektrik', 'Ek maliyet'],
        rows: [
          ['Pirolitik', 'En yüksek', 'Yüksek (program başına)', 'Cihaz fiyatı daha yüksek'],
          ['Katalitik', 'Orta', 'Yok', 'Panel değişimi'],
          ['Hidrolitik', 'Düşük-orta', 'Çok düşük', 'Yok'],
        ],
      },
      {
        kind: 'note',
        title: 'Cam kapak her sistemde elle temizlenir',
        text:
          'Hiçbir otomatik sistem kapak camını temizlemez. Çoğu ankastre fırında iç cam sökülebilir; kullanım kılavuzundaki adımları izleyerek çıkarıp ayrı temizlemek, aradaki lekeyi gidermenin tek yoludur.',
      },
      { kind: 'h2', text: 'Fırını temiz tutmanın pratik yolları' },
      {
        kind: 'ol',
        items: [
          'Yağlı yemekleri kapaklı kapta ya da fırın poşetinde pişirin.',
          'Alt rafa fırın tepsisi koyup damlamaları orada toplayın; tabana doğrudan alüminyum folyo sermeyin, hava akışını bozar.',
          'Taşma olduğunda fırın soğur soğumaz silin. Yanmış ve defalarca pişmiş yağ, en zor çıkan kirdir.',
          'Aşırı aşındırıcı tel ve bıçak kullanmayın; emaye çizilir ve sonraki kirler daha kolay tutunur.',
          'Karbonat ve az suyla yapılan macun, kimyasal kullanmadan iyi sonuç verir: sürün, bir saat bekletin, silin.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Pirolitik fırın ek elektrik masrafı yaratır mı?',
        a: 'Program sırasında tüketim yüksektir ama programlar seyrek çalıştırılır. Ayda bir kullanılan bir temizlik programının fatura etkisi sınırlıdır.',
      },
      {
        q: 'Katalitik paneller yıkanabilir mi?',
        a: 'Hayır. Deterjanla yıkamak gözenekleri tıkar ve paneli işlevsiz bırakır. Doyan paneller değiştirilir.',
      },
    ],
    relatedCategories: [{ label: 'Ankastre & Ocak Setleri', href: '/kategori/ankastre' }],
  },

  {
    slug: 'airfryer-temizligi-ve-kullanim-hatalari',
    title: 'Airfryer Temizliği ve En Sık Yapılan 8 Kullanım Hatası',
    description:
      'Airfryer nasıl temizlenir, kaplama neden çizilir, neden duman çıkar? Yağsız fritözde verimi artıran pratik püf noktaları.',
    excerpt:
      'Airfryer’dan duman çıkmasının, yemeğin kurumasının ve kaplamanın bozulmasının nedenleri.',
    category: 'Bakım & Kullanım',
    tags: ['airfryer', 'yağsız fritöz', 'temizlik', 'kullanım'],
    publishedAt: '2026-09-20',
    blocks: [
      {
        kind: 'p',
        text:
          'Airfryer son yılların en çok satan küçük ev aleti oldu. Ancak pek çok kullanıcı cihazdan beklediği sonucu alamıyor. Sebep genellikle cihaz değil, birkaç basit kullanım hatası.',
      },
      { kind: 'h2', text: 'En sık yapılan sekiz hata' },
      {
        kind: 'ol',
        items: [
          'Sepeti ağzına kadar doldurmak. Airfryer sıcak havayı dolaştırarak pişirir; hava dolaşamayınca yemek kızarmaz, buğulanır. Sepet en fazla üçte iki dolmalı.',
          'Hiç yağ kullanmamak. Bir tatlı kaşığı yağ, patatesin ve sebzenin kızarmasını belirgin şekilde iyileştirir.',
          'Ön ısıtma yapmamak. Çoğu tarifte 3-5 dakikalık ön ısıtma dış yüzeyin çabuk mühürlenmesini sağlar.',
          'Pişirme ortasında sepeti sallamamak. Özellikle patates ve nugget gibi ürünlerde alt yüzey yapışır.',
          'Sepete doğrudan sıvı sos dökmek. Sos damlayıp ısıtıcıya değer ve duman çıkar.',
          'Metal çatal, bıçak ya da tel fırça kullanmak; yapışmaz kaplama çizilir.',
          'Cihazı duvara dayalı çalıştırmak. Arkadaki sıcak hava çıkışının önü açık olmalı.',
          'Temizliği ertelemek. Yağ tabakası her kullanımda pişerek sertleşir ve sonradan çıkmaz.',
        ],
      },
      { kind: 'h2', text: 'Doğru temizlik' },
      {
        kind: 'ul',
        items: [
          'Cihaz soğuduktan sonra sepeti ve tabanlığı çıkarın, sıcak sabunlu suda bekletin.',
          'Yumuşak sünger kullanın; bulaşık teli ve aşındırıcı toz kaplamayı kalıcı olarak bozar.',
          'Sepetin üst kısmındaki ısıtıcı bölgeyi nemli bezle silin. Yağ genellikle orada birikir ve dumanın kaynağı odur.',
          'Bulaşık makinesinde yıkamadan önce modelin buna uygun olduğunu kılavuzdan doğrulayın.',
          'Her kullanımdan sonra kısa bir silme, ayda bir yapılan derin temizlikten daha etkilidir.',
        ],
      },
      {
        kind: 'note',
        title: 'Duman çıkıyorsa',
        text:
          'Airfryer’dan çıkan duman neredeyse her zaman ısıtıcıya ulaşan yağdan kaynaklanır. Yağlı yiyecek pişirirken sepetin altına bir kaşık su koymak, damlayan yağın yanmasını engeller ve dumanı keser.',
      },
      {
        kind: 'table',
        head: ['Yiyecek', 'Sıcaklık', 'Yaklaşık süre'],
        rows: [
          ['Patates dilim', '200 °C', '15 - 20 dk'],
          ['Tavuk kanat', '190 °C', '20 - 25 dk'],
          ['Sebze', '180 °C', '12 - 15 dk'],
          ['Donmuş nugget', '200 °C', '10 - 12 dk'],
          ['Balık fileto', '180 °C', '10 - 14 dk'],
        ],
      },
      {
        kind: 'p',
        text:
          'Tablodaki süreler yol gösterici; cihazın gücüne ve porsiyon miktarına göre değişir. İlk birkaç denemede sepeti açıp kontrol etmek en doğru süreyi bulmanızı sağlar.',
      },
    ],
    faqs: [
      {
        q: 'Airfryer gerçekten sağlıklı mı?',
        a: 'Derin yağda kızartmaya göre çok daha az yağ kullanıldığı için kalori belirgin şekilde düşer. Ancak pişirme yöntemi tek başına bir yemeği sağlıklı yapmaz; içerik de belirleyicidir.',
      },
      {
        q: 'Kaç litrelik airfryer almalıyım?',
        a: '1-2 kişi için 3-4 litre, 3-4 kişi için 5-6 litre, kalabalık aileler için 7 litre ve üzeri ya da çift sepetli modeller uygundur.',
      },
    ],
    relatedCategories: [{ label: 'Gıda Hazırlama', href: '/kategori/gida-hazirlama' }],
  },

  {
    slug: 'no-frost-nedir-buz-cozme',
    title: 'No-Frost Nedir? Statik Buzdolabından Farkı ve Buz Çözme',
    description:
      'No-frost buzdolabı nasıl çalışır, statik modelden farkı nedir, buz çözme gerekir mi? Avantajları, dezavantajları ve seçim önerileri.',
    excerpt:
      'No-frost ve statik buzdolabının çalışma farkı, elektrik tüketimi ve hangi durumda hangisinin daha mantıklı olduğu.',
    category: 'Beyaz Eşya',
    tags: ['no-frost', 'buzdolabı', 'buz çözme', 'statik'],
    publishedAt: '2026-09-20',
    blocks: [
      {
        kind: 'p',
        text:
          'Buzdolabı alırken karşınıza çıkan ilk ayrım no-frost ve statik modellerdir. Fark, soğuğun dolapta nasıl dağıtıldığındadır ve günlük kullanımda hissedilen etkisi büyüktür.',
      },
      { kind: 'h2', text: 'Statik buzdolabı' },
      {
        kind: 'p',
        text:
          'Soğutma, arka duvardaki soğuk yüzeyle yapılır. Havadaki nem bu yüzeyde yoğuşur ve zamanla buz tabakası oluşur. Bu yüzden dolabın belirli aralıklarla kapatılıp buzunun çözülmesi gerekir. Statik modeller genellikle daha ucuzdur ve sebzeler daha az kurur, çünkü içerideki nem oranı yüksektir.',
      },
      { kind: 'h2', text: 'No-frost buzdolabı' },
      {
        kind: 'p',
        text:
          'Soğuk hava bir fanla dolaştırılır ve nem, cihazın kendi otomatik çözme döngüsünde tahliye edilir. İçeride buz oluşmaz, buz çözmeye gerek kalmaz. Sıcaklık her rafta daha eşit dağılır. Buna karşılık hava sirkülasyonu gıdaların yüzeyini kurutabilir; bu yüzden sebzeleri kapalı kapta ya da poşette saklamak gerekir.',
      },
      {
        kind: 'table',
        head: ['Konu', 'Statik', 'No-Frost'],
        rows: [
          ['Buz çözme', 'Elle, düzenli aralıklarla', 'Gerekmez'],
          ['Sıcaklık dağılımı', 'Raflar arası fark var', 'Daha eşit'],
          ['Gıdanın kuruması', 'Daha az', 'Kapalı saklamak gerekir'],
          ['Elektrik tüketimi', 'Genellikle biraz daha düşük', 'Fan nedeniyle biraz daha yüksek'],
          ['Fiyat', 'Daha uygun', 'Daha yüksek'],
          ['Çalışma sesi', 'Daha sessiz', 'Fan sesi duyulabilir'],
        ],
      },
      {
        kind: 'note',
        title: 'Buz oluşuyorsa önce contaya bakın',
        text:
          'No-frost bir dolapta buz oluşuyorsa arıza aramadan önce kapak contasını kontrol edin. Conta tam kapanmadığında dışarıdan sürekli nemli hava girer ve fan bunu yetiştiremez. Kapağa bir kâğıt sıkıştırıp çektiğinizde kolayca çıkıyorsa conta değişmelidir.',
      },
      { kind: 'h2', text: 'Statik dolapta buz çözme' },
      {
        kind: 'ol',
        items: [
          'Cihazı kapatın ve fişini çekin.',
          'Gıdaları soğutucu çantaya ya da başka bir soğuk ortama alın.',
          'Kapağı açık bırakın; altına havlu ve geniş bir kap koyun.',
          'Buzu bıçak, tornavida gibi sert cisimlerle kazımayın — soğutucu borusu delinirse cihaz onarılamaz hâle gelir.',
          'İçeriye sıcak su dolu bir kap koymak çözünmeyi hızlandırır.',
          'Buz tamamen çözüldükten sonra iç yüzeyi silip kurulayın, fişi takın ve soğuduktan sonra gıdaları yerleştirin.',
        ],
      },
      {
        kind: 'p',
        text:
          'Dondurucuda 5 mm’den kalın buz tabakası varsa soğutma verimi düşmüş demektir. Statik modellerde bu işlemin yılda iki üç kez yapılması hem elektrik hem cihaz ömrü açısından önemlidir.',
      },
    ],
    faqs: [
      {
        q: 'No-frost daha mı çok elektrik harcar?',
        a: 'Fan nedeniyle teorik olarak biraz daha fazladır ama statik dolapta biriken buz da verimi düşürür. Buzu düzenli çözülmeyen statik dolap, no-frost bir dolaptan daha çok harcayabilir.',
      },
      {
        q: 'Sebzelerim no-frost dolapta çabuk soluyor, ne yapmalıyım?',
        a: 'Sebzeleri açıkta değil, delikli poşette ya da kapaklı kapta saklayın. Çoğu modelde sebzelik bölmesinin nem ayarı da vardır; yüksek konuma alın.',
      },
    ],
    relatedCategories: [{ label: 'Soğutma & Beyaz Eşya', href: '/kategori/buzdolabi' }],
  },

  {
    slug: 'kurutma-makinesi-isi-pompali-mi-kondenserli-mi',
    title: 'Kurutma Makinesi: Isı Pompalı mı, Kondenserli mi?',
    description:
      'Çamaşır kurutma makinesi tipleri: ısı pompalı, kondenserli ve vantilatörlü fark. Elektrik tüketimi, kurutma süresi ve KKTC nemine göre seçim.',
    excerpt:
      'Üç kurutma teknolojisinin farkı, tüketim karşılaştırması ve nemli iklimde neden işe yaradığı.',
    category: 'Beyaz Eşya',
    tags: ['kurutma makinesi', 'ısı pompalı', 'kondenser', 'nem'],
    publishedAt: '2026-09-21',
    blocks: [
      {
        kind: 'p',
        text:
          'Kurutma makinesi uzun süre “lüks” sayıldı, ancak nemli kış aylarında çamaşırın içeride günlerce kurumadığı bölgelerde ciddi bir ihtiyaç. Adada kışın bağıl nem yüksek seyrettiği için içeride kurutulan çamaşır hem geç kurur hem de evde rutubet ve küf sorununu büyütür.',
      },
      { kind: 'h2', text: 'Üç teknoloji' },
      {
        kind: 'p',
        text:
          'Vantilatörlü (atmosferik) modeller nemli havayı doğrudan dışarı üfler; bacaya ya da pencereye hortum çekmek gerekir. Kondenserli modeller nemi yoğuşturup bir hazneye toplar, hortum gerekmez ama yüksek sıcaklıkla çalıştığı için tüketimi fazladır. Isı pompalı modeller aynı havayı düşük sıcaklıkta tekrar tekrar kullanır: en az elektrik harcayan ve kumaşa en az zarar veren tiptir.',
      },
      {
        kind: 'table',
        head: ['Tip', 'Elektrik', 'Kurutma süresi', 'Kumaşa etkisi'],
        rows: [
          ['Vantilatörlü', 'Yüksek', 'Kısa', 'Yüksek sıcaklık, yıpratıcı'],
          ['Kondenserli', 'Yüksek', 'Orta', 'Yüksek sıcaklık'],
          ['Isı pompalı', 'Düşük', 'Daha uzun', 'Düşük sıcaklık, nazik'],
        ],
      },
      {
        kind: 'p',
        text:
          'Isı pompalı modeller daha uzun sürede kurutur ama tüketimleri belirgin şekilde düşüktür. Haftada birkaç kez kullanılan bir cihazda bu fark, ilk alımdaki fiyat farkını zamanla kapatır.',
      },
      { kind: 'h2', text: 'Kaç kilo almalı?' },
      {
        kind: 'ul',
        items: [
          'Kurutma kapasitesi, çamaşır makinesinin kapasitesine yakın ya da bir kademe üstünde olmalı.',
          '8 kg çamaşır makinesi için 8-9 kg kurutucu uygundur.',
          'Kurutucuyu tam doldurmak kurutma süresini uzatır; tambur biraz boş olmalı ki hava dolaşsın.',
        ],
      },
      {
        kind: 'note',
        title: 'Su haznesini gidere bağlayabilirsiniz',
        text:
          'Kondenserli ve ısı pompalı modellerde toplanan suyu her seferinde boşaltmak gerekir. Çoğu modelde bu su, bir hortumla doğrudan gidere bağlanabilir. Çamaşır makinesinin yanına kurulacaksa bu bağlantıyı montaj sırasında yaptırmak günlük kullanımı çok kolaylaştırır.',
      },
      { kind: 'h2', text: 'Bakım' },
      {
        kind: 'ol',
        items: [
          'Tüy filtresini HER kullanımdan sonra temizleyin. Tıkalı filtre hem süreyi uzatır hem yangın riski oluşturur.',
          'Isı pompalı modellerde alt kısımdaki ısı değiştirici filtresini ayda bir kontrol edin.',
          'Su haznesini her programdan sonra boşaltın.',
          'Tambur contasını ara sıra nemli bezle silin.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Kurutma makinesi çamaşırı yıpratır mı?',
        a: 'Yüksek sıcaklıkta çalışan vantilatörlü ve kondenserli modellerde hassas kumaşlar zamanla yıpranabilir. Isı pompalı modeller düşük sıcaklıkta çalıştığı için bu etki çok daha azdır.',
      },
      {
        q: 'Kurutmalı çamaşır makinesi mi, ayrı kurutucu mu?',
        a: 'Yer sıkıntısı varsa kurutmalı çamaşır makinesi pratiktir ancak kurutma kapasitesi yıkama kapasitesinden düşüktür ve yarısını çıkarmak gerekir. Yer varsa ayrı cihazlar hem daha verimli hem daha hızlıdır.',
      },
    ],
    relatedCategories: [{ label: 'Çamaşır Makinesi', href: '/kategori/camasir-makinesi' }],
  },

  {
    slug: 'mikrodalga-secimi-ve-guvenli-kullanim',
    title: 'Mikrodalga Fırın Seçimi ve Güvenli Kullanım Rehberi',
    description:
      'Mikrodalga kaç litre olmalı, grill ve fanlı modeller ne işe yarar, hangi kap kullanılır? Güvenli kullanım ve temizlik önerileri.',
    excerpt:
      'Litre ve güç seçiminden hangi kabın kullanılabileceğine kadar mikrodalganın tamamı.',
    category: 'Küçük Ev Aletleri',
    tags: ['mikrodalga', 'güvenli kullanım', 'mutfak'],
    publishedAt: '2026-09-21',
    blocks: [
      {
        kind: 'p',
        text:
          'Mikrodalga fırın, mutfakta en çok kullanılan ama en az tanınan cihazlardan biri. Isıtmanın ötesinde çözdürme, buharda pişirme ve grill özellikleriyle günlük işi ciddi şekilde kısaltabiliyor.',
      },
      { kind: 'h2', text: 'Kaç litre, kaç watt?' },
      {
        kind: 'table',
        head: ['Hane', 'Hacim', 'Güç'],
        rows: [
          ['1-2 kişi', '17 - 20 litre', '700 - 800 W'],
          ['3-4 kişi', '20 - 25 litre', '800 - 900 W'],
          ['5+ kişi', '25 - 30 litre', '900 - 1000 W'],
          ['Tabak yerine tepsi kullanılacaksa', '28 litre ve üzeri', '900 W ve üzeri'],
        ],
      },
      {
        kind: 'p',
        text:
          'Hacim seçerken içine koyacağınız en büyük kabı düşünün. 20 litrelik bir cihazın döner tablası, geniş bir servis tabağını döndüremeyebilir.',
      },
      { kind: 'h2', text: 'Grill ve fanlı modeller' },
      {
        kind: 'ul',
        items: [
          'Düz mikrodalga: yalnızca ısıtır ve çözdürür. Çoğu ihtiyacı karşılar.',
          'Grill’li: üstte bir rezistans bulunur; peynir eritmek, üst yüzeyi kızartmak için kullanılır.',
          'Fanlı (konveksiyonlu): sıcak havayı dolaştırır, küçük bir fırın gibi çalışır. Tek başına yaşayanlar için büyük fırının yerini tutabilir.',
          'İnverterli: gücü kademeli ayarlar, çözdürmede yiyeceğin kenarlarının pişmesini önler.',
        ],
      },
      { kind: 'h2', text: 'Hangi kap kullanılır?' },
      {
        kind: 'table',
        head: ['Kullanılabilir', 'Kullanılamaz'],
        rows: [
          ['Isıya dayanıklı cam', 'Metal ve metal süslemeli tabak'],
          ['Mikrodalgaya uygun işaretli plastik', 'Alüminyum folyo'],
          ['Porselen ve seramik (metal yaldızsız)', 'Kapalı kavanoz ve konserve kutusu'],
          ['Mikrodalga poşeti', 'Normal plastik poşet, strafor kap'],
        ],
      },
      {
        kind: 'note',
        title: 'Kapalı kap ve yumurta',
        text:
          'Kabuklu yumurta, kapalı kavanoz ve delinmemiş ambalajlar mikrodalgada patlar. Sosisi, patatesi ve benzeri kabuklu yiyecekleri ısıtmadan önce çatalla delin. Suyu uzun süre ısıtmak da ani kaynamaya yol açabilir; kaba tahta bir çubuk koymak bunu önler.',
      },
      { kind: 'h2', text: 'Temizlik' },
      {
        kind: 'ol',
        items: [
          'Bir kâseye su ve yarım limon koyup 3-4 dakika çalıştırın; oluşan buhar kiri yumuşatır.',
          'İç yüzeyi nemli bezle silin, aşındırıcı kullanmayın.',
          'Döner tablayı ve halkasını ayrı yıkayın.',
          'Kapak contasını ve kapağın oturduğu yüzeyi düzenli silin; buradaki kir kapağın tam kapanmasını engelleyebilir.',
        ],
      },
      {
        kind: 'p',
        text:
          'Kapağı tam kapanmayan, menteşesi gevşemiş veya içi çizilmiş bir mikrodalgayı kullanmaya devam etmeyin. Kapak güvenliği, cihazın en kritik parçasıdır ve arızasında servise başvurulmalıdır.',
      },
    ],
    faqs: [
      {
        q: 'Mikrodalgada ısıtılan yemek besin değerini kaybeder mi?',
        a: 'Her pişirme yöntemi bir miktar besin kaybına yol açar. Mikrodalga kısa sürede ve az suyla ısıttığı için bazı vitaminlerde kaybı, uzun süre haşlamaya göre daha azdır.',
      },
      {
        q: 'Ankastre mikrodalga mı, tezgâh üstü mü?',
        a: 'Mutfak yenileniyorsa ankastre model tezgâhta yer açar ve bütünlüklü görünür. Taşınma ihtimali varsa tezgâh üstü model daha esnektir.',
      },
    ],
    relatedCategories: [
      { label: 'Ev Gereçleri', href: '/kategori/ev-gerecleri' },
      { label: 'Gıda Hazırlama', href: '/kategori/gida-hazirlama' },
    ],
  },
]
