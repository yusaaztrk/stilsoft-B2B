import type { BlogPost } from '@/lib/blog'

/**
 * Yazı gövdeleri — 4. bölüm: TELEVİZYON ve KLİMA.
 *
 * <b>Neden bu iki konu (2026-09-21):</b> Google'da "kktc televizyon" ve "kktc klima"
 * arandığında ilk sayfada bekokibris.com, technopluskibris.com, armarshop.com ve
 * suitexshop.com çıkıyor; biz hiç yoktuk. Sebebi basitti: sitede bu iki ürün grubuyla
 * ilgili TEK BİR yazı yoktu. Katalogda ürün var ama arama motoruna "bu konuyu biliyoruz"
 * diyen hiçbir metin yoktu.
 *
 * Kategori sayfası "televizyon kıbrıs" gibi kısa aramada büyük rakiple yarışır; blog
 * yazısı ise UZUN KUYRUKTA ("kaç inç tv almalıyım", "klima kaç btu") çok daha kolay ilk
 * sıraya çıkar ve ziyaretçiyi kataloğa bağlar. İki yüzey birlikte çalışıyor: yazıların
 * hepsinde `relatedCategories` ile ilgili kategoriye bağlantı var.
 */
export const BLOG_POSTS_4: BlogPost[] = [
  {
    slug: 'televizyon-nasil-secilir-kktc',
    title: 'Televizyon Nasıl Seçilir? KKTC’de TV Alırken Bilmeniz Gereken Her Şey',
    description:
      'Ekran boyutu, çözünürlük, panel tipi, yenileme hızı ve ses: KKTC’de televizyon alırken gerçekten fark yaratan özellikler ve kullanıma göre öneriler.',
    excerpt:
      'Mağazada parlak ekranlar arasında kaybolmadan, hangi özelliğin gerçekten fark yarattığını anlatan sade bir rehber.',
    category: 'Televizyon',
    tags: ['televizyon', 'tv seçimi', 'smart tv', '4K', 'KKTC'],
    publishedAt: '2026-09-09',
    blocks: [
      {
        kind: 'p',
        text:
          'Televizyon, evde en uzun süre bakılan cihazdır ve ortalama sekiz on yıl kullanılır. Buna rağmen seçim çoğu zaman mağazadaki en parlak görüntüye göre yapılır. Oysa mağaza aydınlatması ile salonunuzun aydınlatması aynı değildir; orada göz alan bir ekran, evde fazla doygun görünebilir.',
      },
      {
        kind: 'p',
        text:
          'Aşağıda bir televizyonda gerçekten fark yaratan beş başlığı, KKTC’deki kullanım koşullarını da göz önüne alarak sıraladık.',
      },
      { kind: 'h2', text: '1. Ekran boyutu: odanın değil, mesafenin işi' },
      {
        kind: 'p',
        text:
          'En sık yapılan hata, ekran boyutunu odanın büyüklüğüne göre seçmektir. Belirleyici olan koltuk ile ekran arasındaki mesafedir. 4K televizyonlarda piksel yoğunluğu yüksek olduğu için eskiye göre çok daha yakından, daha büyük ekran izlenebilir. Ayrıntılı tablo için “Kaç inç TV almalıyım” yazımıza bakabilirsiniz.',
      },
      { kind: 'h2', text: '2. Çözünürlük: bugün alınacak TV 4K olmalı' },
      {
        kind: 'p',
        text:
          'Full HD paneller artık yalnızca küçük ekranlarda ve ikinci televizyon ihtiyacında anlamlı. 43 inç ve üzerinde 4K, hem yayın platformlarının standardı olduğu için hem de yakın mesafede daha net görüntü verdiği için doğru tercihtir. 8K ise içerik tarafı hâlâ çok sınırlı olduğundan bugün için ödenen paranın karşılığını vermiyor.',
      },
      { kind: 'h2', text: '3. Panel tipi ve parlaklık' },
      {
        kind: 'p',
        text:
          'Akdeniz ikliminde salonlar gündüz çok ışık alır. Gündüz izleme ağırlıklıysa panelin parlaklığı ve yansıma önleyici kaplaması, kontrast değerlerinden daha çok işinize yarar. Akşam ağırlıklı, perdeleri kapalı izleyenler için ise siyah derinliği öne çıkar. QLED, OLED ve LED farkını ayrı bir yazıda anlattık.',
      },
      { kind: 'h2', text: '4. Yenileme hızı: spor ve oyun izleyenler için' },
      {
        kind: 'p',
        text:
          'Standart paneller 50/60 Hz’dir ve normal dizi film izleme için yeterlidir. Futbol maçı, hızlı aksiyon ve oyun konsolu kullanımı ağırlıktaysa 100/120 Hz panel hareket akıcılığında gözle görülür fark yaratır. Oyun konsolu bağlayacaksanız HDMI 2.1 girişinin bulunmasına da dikkat edin.',
      },
      { kind: 'h2', text: '5. Ses: ince ekranın bedeli' },
      {
        kind: 'p',
        text:
          'Televizyonlar inceldikçe hoparlöre ayrılan hacim küçüldü. Diziyi rahat duyabiliyor ama film izlerken konuşmaları anlamakta zorlanıyorsanız sorun sizde değil, fizikte. Bu durumda bir soundbar, ekranı bir üst modele yükseltmekten daha büyük fark yaratır.',
      },
      {
        kind: 'table',
        head: ['Kullanım', 'Öncelik verilecek özellik'],
        rows: [
          ['Gündüz aydınlık salon', 'Yüksek parlaklık, yansıma önleyici panel'],
          ['Akşam film keyfi', 'Kontrast ve siyah derinliği'],
          ['Spor ve maç', '100/120 Hz yenileme hızı'],
          ['Oyun konsolu', 'HDMI 2.1, düşük gecikme (oyun modu)'],
          ['Yatak odası / ikinci TV', '32-43 inç, düşük güç tüketimi'],
        ],
      },
      {
        kind: 'note',
        title: 'KKTC’de kurulum notu',
        text:
          'Televizyonu duvara asacaksanız askı aparatının duvar tipine uygun olması gerekir. Alçıpan ve gazbeton duvarlarda standart dübel yeterli olmaz. Montaj ve askı aparatı seçimini ayrı bir yazıda ele aldık.',
      },
    ],
    faqs: [
      {
        q: 'KKTC’de televizyon garantisi nasıl işliyor?',
        a: 'Resmi distribütör güvencesiyle satılan ürünlerde garanti adada geçerlidir ve servis yerinde verilir. Garanti kapsamının ne olduğunu ve kapsam dışı durumları garanti yazımızda ayrıntılı anlattık.',
      },
      {
        q: 'Televizyonu ben mi asmalıyım, montaj hizmeti var mı?',
        a: 'Duvara montaj, doğru aparat ve doğru dübelle yapılmadığında hem cihaz hem duvar için risklidir. Uygun ürünlerde ücretsiz montaj hizmeti sunuluyor; sipariş sırasında montaj seçeneğini işaretlemeniz yeterli.',
      },
      {
        q: 'Smart TV için ayrıca internet kutusu almam gerekir mi?',
        a: 'Smart TV’lerde uygulamalar dâhilidir. Yalnızca çok eski bir televizyonu akıllı hâle getirmek istiyorsanız harici bir yayın cihazı gerekir.',
      },
    ],
    relatedCategories: [{ label: 'Elektro & Televizyon', href: '/kategori/elektro' }],
  },

  {
    slug: 'kac-inc-tv-almaliyim-mesafe-tablosu',
    title: 'Kaç İnç TV Almalıyım? Koltuk Mesafesine Göre Ekran Tablosu',
    description:
      'Televizyon inç hesabı: oturma mesafesine göre ideal ekran boyutu tablosu, oda tipine göre öneriler ve en sık yapılan ölçü hataları.',
    excerpt:
      'Ekran boyutunu odanın değil, koltuk mesafesinin belirlediğini gösteren pratik bir tablo.',
    category: 'Televizyon',
    tags: ['televizyon', 'inç hesabı', 'ekran boyutu'],
    publishedAt: '2026-09-09',
    blocks: [
      {
        kind: 'p',
        text:
          'Televizyon alırken en çok sorulan soru budur ve cevabı beklenenden basittir: ekranın kaç inç olacağını odanın büyüklüğü değil, koltuk ile ekran arasındaki mesafe belirler. 4K çözünürlükte pikseller gözle ayırt edilemeyecek kadar küçük olduğu için eski Full HD alışkanlıklarına göre daha yakından, daha büyük ekran izlenebiliyor.',
      },
      { kind: 'h2', text: 'Mesafeye göre ekran boyutu tablosu' },
      {
        kind: 'table',
        head: ['Koltuk mesafesi', 'Önerilen ekran (4K)', 'Tipik yer'],
        rows: [
          ['1,5 - 2 metre', '43 - 50 inç', 'Yatak odası, küçük salon'],
          ['2 - 2,5 metre', '50 - 55 inç', 'Apartman salonu'],
          ['2,5 - 3 metre', '55 - 65 inç', 'Geniş salon'],
          ['3 - 3,5 metre', '65 - 75 inç', 'Açık plan salon, müstakil ev'],
          ['3,5 metre ve üzeri', '75 inç ve üzeri', 'Büyük yaşam alanı'],
        ],
      },
      {
        kind: 'p',
        text:
          'İki boyut arasında kaldıysanız büyük olanı seçin. Televizyon boyutundan pişman olanların neredeyse tamamı “keşke büyüğünü alsaydım” der; tersi çok nadirdir.',
      },
      { kind: 'h2', text: 'Ölçerken atlanan üç ayrıntı' },
      {
        kind: 'ol',
        items: [
          'İnç, ekranın köşegen ölçüsüdür; genişlik değildir. 65 inç bir televizyonun gövde genişliği yaklaşık 145 cm’dir.',
          'Sehpa üzerine koyacaksanız ayakların arasındaki mesafeyi ölçün. Bazı modellerde ayaklar iki uçtadır ve dar sehpaya oturmaz.',
          'Duvara asacaksanız ekranın merkezi oturunca göz hizasına gelmeli. Çok yukarı asılan televizyon boyun ağrısı yapar.',
        ],
      },
      {
        kind: 'note',
        title: 'Kapıdan geçecek mi?',
        text:
          'Büyük ekranlarda kutu ölçüsü ekrandan belirgin şekilde büyüktür. 75 inç bir televizyonun kutusu dar bir apartman merdiveninden dönmeyebilir. Sipariş öncesi merdiven ve kapı genişliğini ölçmek, teslimat gününde yaşanacak sorunu önler.',
      },
    ],
    faqs: [
      {
        q: '55 inç mi 65 inç mi alsam?',
        a: 'Koltuk mesafeniz 2,5 metrenin üzerindeyse 65 inç rahat izlenir ve tercih edilmelidir. 2 metrenin altındaysa 55 inç daha dengelidir.',
      },
      {
        q: 'Büyük ekran gözü yorar mı?',
        a: '4K çözünürlükte hayır. Göz yorgunluğu genellikle ekran boyutundan değil, karanlık odada aşırı parlak ayarlanmış ekrandan kaynaklanır.',
      },
    ],
    relatedCategories: [{ label: 'Elektro & Televizyon', href: '/kategori/elektro' }],
  },

  {
    slug: 'qled-oled-led-fark-nedir',
    title: 'QLED, OLED ve LED Arasındaki Fark Nedir? Hangisini Almalı?',
    description:
      'QLED, OLED ve standart LED panel farkları sade bir dille: parlaklık, siyah derinliği ve fiyat karşılaştırması ile hangi kullanım için hangisi uygun.',
    excerpt:
      'Üç panel teknolojisinin gerçek farkı ve hangi salonda hangisinin daha iyi sonuç verdiği.',
    category: 'Televizyon',
    tags: ['QLED', 'OLED', 'LED', 'panel teknolojisi'],
    publishedAt: '2026-09-10',
    blocks: [
      {
        kind: 'p',
        text:
          'Televizyon etiketlerindeki LED, QLED ve OLED isimleri birbirine çok benzediği için karıştırılıyor. Aradaki fark aslında tek bir soruda toplanıyor: ekrandaki ışık nereden geliyor?',
      },
      { kind: 'h2', text: 'LED: arkadan aydınlatmalı klasik panel' },
      {
        kind: 'p',
        text:
          'Standart LED televizyonlarda panelin arkasında bir aydınlatma katmanı vardır ve görüntü bu ışığın filtrelenmesiyle oluşur. Ekonomik, dayanıklı ve gündüz kullanımında yeterince parlaktır. Zayıf tarafı siyahtır: karanlık sahnelerde siyah, koyu griye kaçar.',
      },
      { kind: 'h2', text: 'QLED: daha parlak, daha doygun renk' },
      {
        kind: 'p',
        text:
          'QLED de arkadan aydınlatmalıdır, ancak araya renk saflığını artıran bir katman eklenir. Sonuç daha parlak ve daha canlı renklerdir. Gün ışığı alan salonlarda en pratik tercih genellikle budur; yüksek parlaklık, perdeler açıkken bile görüntüyü ayakta tutar.',
      },
      { kind: 'h2', text: 'OLED: her piksel kendi ışığını üretir' },
      {
        kind: 'p',
        text:
          'OLED panellerde arka aydınlatma yoktur; her piksel tamamen sönebildiği için siyah gerçekten siyahtır. Karanlık odada film izlemenin en iyi hâli budur. Buna karşılık çok aydınlık ortamlarda QLED kadar parlak değildir ve fiyatı daha yüksektir.',
      },
      {
        kind: 'table',
        head: ['Özellik', 'LED', 'QLED', 'OLED'],
        rows: [
          ['Parlaklık', 'Orta', 'Yüksek', 'Orta-yüksek'],
          ['Siyah derinliği', 'Zayıf', 'İyi', 'En iyi'],
          ['Aydınlık odada', 'İyi', 'En iyi', 'İyi'],
          ['Geniş açıdan izleme', 'Değişken', 'İyi', 'En iyi'],
          ['Fiyat', 'En uygun', 'Orta', 'Yüksek'],
        ],
      },
      { kind: 'h2', text: 'Peki hangisi?' },
      {
        kind: 'ul',
        items: [
          'Gündüz izleme ağırlıklı, aydınlık salon: QLED.',
          'Akşam film ve dizi, perde kapalı karanlık oda: OLED.',
          'Yatak odası, mutfak, ikinci televizyon veya sınırlı bütçe: LED.',
          'Uzun süre sabit görüntü (haber bandı, oyun arayüzü, kamera ekranı): LED veya QLED.',
        ],
      },
      {
        kind: 'note',
        title: 'Sabit görüntü uyarısı',
        text:
          'OLED panellerde çok uzun süre ekranda kalan sabit logolar zamanla iz bırakabilir. Televizyonu gün boyu haber kanalında açık bırakıyorsanız QLED daha güvenli bir seçimdir.',
      },
    ],
    faqs: [
      {
        q: 'QLED ile OLED arasındaki fiyat farkı mantıklı mı?',
        a: 'Karanlıkta film izlemeye önem veriyorsanız evet, fark gözle görülür. Ağırlıklı olarak gündüz izliyorsanız aynı parayı daha büyük bir QLED ekrana ayırmak daha çok memnuniyet verir.',
      },
      {
        q: 'Mini LED nedir?',
        a: 'Arka aydınlatmanın çok daha küçük ve çok sayıda LED ile yapıldığı gelişmiş bir QLED türüdür. Siyah kontrolü klasik QLED’den iyidir, parlaklığı OLED’den yüksektir.',
      },
    ],
    relatedCategories: [{ label: 'Elektro & Televizyon', href: '/kategori/elektro' }],
  },

  {
    slug: 'tv-duvara-montaj-aski-aparati-secimi',
    title: 'TV Duvara Montaj: Askı Aparatı Seçimi ve Doğru Yükseklik',
    description:
      'VESA ölçüsü nedir, sabit mi hareketli askı mı, alçıpan duvara televizyon asılır mı? KKTC’de TV montajında dikkat edilmesi gerekenler.',
    excerpt:
      'VESA ölçüsünden duvar tipine, doğru yükseklikten kablo gizlemeye kadar montajın tamamı.',
    category: 'Televizyon',
    tags: ['tv montajı', 'VESA', 'askı aparatı', 'duvara montaj'],
    publishedAt: '2026-09-10',
    blocks: [
      {
        kind: 'p',
        text:
          'Duvara asılan televizyon hem yer kazandırır hem de daha düzenli bir görünüm verir. Ancak montaj, yalnızca duvara delik açmak değildir: yanlış aparat ya da yanlış dübel, birkaç bin liralık cihazın yere düşmesi demektir.',
      },
      { kind: 'h2', text: 'VESA ölçüsü: aparatın tek zorunlu bilgisi' },
      {
        kind: 'p',
        text:
          'Televizyonun arkasındaki dört vida deliğinin yatay ve dikey aralığına VESA ölçüsü denir ve milimetre cinsinden yazılır: 200x200, 400x300, 600x400 gibi. Askı aparatı bu ölçüyü desteklemelidir. Ölçüyü kendiniz de alabilirsiniz; deliklerin merkezleri arasındaki mesafeyi ölçmeniz yeterli.',
      },
      { kind: 'h2', text: 'Sabit mi, hareketli mi?' },
      {
        kind: 'table',
        head: ['Aparat tipi', 'Ne zaman doğru seçim'],
        rows: [
          ['Sabit (ince)', 'Ekran tam karşıda, tek izleme noktası var; en şık duruş'],
          ['Eğimli', 'Televizyon göz hizasının üstünde kalıyor'],
          ['Kollu / hareketli', 'Mutfak-salon gibi iki ayrı noktadan izleniyor'],
        ],
      },
      { kind: 'h2', text: 'Duvar tipi hayati önemde' },
      {
        kind: 'ul',
        items: [
          'Betonarme ve tuğla duvar: standart çelik dübelle güvenli montaj yapılır.',
          'Gazbeton: özel gazbeton dübeli gerekir, normal plastik dübel zamanla gevşer.',
          'Alçıpan: mutlaka arkadaki metal profile ya da ahşap kadrona sabitlenmelidir; yalnızca alçıpan levhaya asılan televizyon düşer.',
          'Yeni sıva veya kartonpiyer üzeri: arkasındaki taşıyıcı yüzey bulunmadan delinmemelidir.',
        ],
      },
      { kind: 'h2', text: 'Doğru yükseklik' },
      {
        kind: 'p',
        text:
          'Ekranın merkezi, oturulduğunda göz hizasında olmalıdır. Standart bir koltukta bu genellikle yerden 100-110 cm arasına denk gelir. Şöminenin üstüne asılan televizyonlar estetik görünse de boyun açısını zorlar; bu durumda eğimli aparat kullanılmalıdır.',
      },
      {
        kind: 'note',
        title: 'Priz ve kabloyu önceden düşünün',
        text:
          'Montajdan sonra kablo çekmek zordur. Televizyonun arkasına denk gelen bir priz ve anten/internet ucu yoksa, montajdan önce kanal açtırmak en temiz çözümdür. Aksi hâlde kablolar duvarda görünür kalır.',
      },
    ],
    faqs: [
      {
        q: 'Montaj hizmeti veriyor musunuz?',
        a: 'Uygun ürünlerde ücretsiz montaj sunuluyor. Sipariş sırasında montaj seçeneğini işaretlediğinizde teknisyen randevu için sizi arıyor.',
      },
      {
        q: 'Askı aparatı televizyonla birlikte geliyor mu?',
        a: 'Çoğu televizyonda kutudan masaüstü ayak çıkar, duvar aparatı ayrı satılır. Modelin VESA ölçüsüne uygun aparatı sipariş sırasında sorabilirsiniz.',
      },
    ],
    relatedCategories: [{ label: 'Elektro & Televizyon', href: '/kategori/elektro' }],
  },

  {
    slug: 'smart-tv-uygulamalar-uydu-internet-yayini',
    title: 'Smart TV Rehberi: Uygulamalar, Uydu ve İnternet Yayını',
    description:
      'Smart TV nedir, hangi uygulamalar çalışır, uydu anteni hâlâ gerekli mi, internet hızı ne olmalı? KKTC’de akıllı televizyon kullanımı.',
    excerpt:
      'Akıllı televizyonda yayın platformları, uydu bağlantısı ve gereken internet hızı.',
    category: 'Televizyon',
    tags: ['smart tv', 'uydu', 'internet yayını', 'KKTC'],
    publishedAt: '2026-09-11',
    blocks: [
      {
        kind: 'p',
        text:
          'Smart TV, internete bağlanabilen ve üzerinde uygulama çalıştırabilen televizyondur. Bugün satılan televizyonların neredeyse tamamı akıllıdır; fark, hangi işletim sistemini kullandıkları ve hangi uygulamaları desteklediklerindedir.',
      },
      { kind: 'h2', text: 'İnternet hızı ne olmalı?' },
      {
        kind: 'table',
        head: ['Yayın kalitesi', 'Önerilen internet hızı'],
        rows: [
          ['SD (düşük)', '3 Mbps'],
          ['Full HD', '8-10 Mbps'],
          ['4K', '25 Mbps ve üzeri'],
          ['Aynı anda iki cihaz 4K', '50 Mbps ve üzeri'],
        ],
      },
      {
        kind: 'p',
        text:
          'Görüntü sık sık donuyor ya da kalite düşüyorsa sorun çoğunlukla televizyonda değil, kablosuz bağlantıdadır. Modem ile televizyon arasında beton duvar varsa sinyal belirgin şekilde zayıflar. En sağlam çözüm televizyonu kabloyla modeme bağlamaktır; mümkün değilse modemi televizyona yaklaştırmak ya da menzil genişletici kullanmak gerekir.',
      },
      { kind: 'h2', text: 'Uydu anteni hâlâ gerekli mi?' },
      {
        kind: 'p',
        text:
          'İnternet yayını her geçen yıl yaygınlaşsa da uydu, internet kesintisinden etkilenmeyen ve ek abonelik gerektirmeyen bir yayın kaynağı olmaya devam ediyor. Özellikle ulusal kanalları ve canlı maç yayınlarını takip edenler için uydu bağlantısı hâlâ anlamlı. Televizyonda dâhili uydu alıcısı (DVB-S2) varsa ayrıca kutu almanıza gerek kalmaz.',
      },
      { kind: 'h2', text: 'Kurulumda sık yaşanan sorunlar' },
      {
        kind: 'ol',
        items: [
          'Kanal listesi boş geliyor: kurulum sihirbazında yayın kaynağı (uydu / karasal / kablo) yanlış seçilmiştir.',
          'Uygulama açılmıyor: televizyonun yazılımı güncellenmemiştir; ayarlardan yazılım güncellemesi çalıştırın.',
          'Ses görüntüden geri kalıyor: soundbar veya alıcı kullanılıyorsa ses gecikmesi ayarından düzeltilir.',
          'Uzaktan kumanda tepki vermiyor: Bluetooth kumandalarda eşleştirme kopmuş olabilir, yeniden eşleştirin.',
        ],
      },
      {
        kind: 'note',
        title: 'Hesaplarınızı devretmeyin',
        text:
          'Televizyonu satar ya da devrederseniz ayarlardan fabrika ayarlarına döndürün. Aksi hâlde uygulamalarda açık kalan hesaplarınız yeni kullanıcıda kalır.',
      },
    ],
    faqs: [
      {
        q: 'Eski televizyonumu akıllı hâle getirebilir miyim?',
        a: 'Evet. HDMI girişi olan her televizyona takılabilen yayın cihazları uygulamaları çalıştırır. Ancak görüntü kalitesi panelin sınırını aşamaz.',
      },
      {
        q: 'Televizyonu internete kabloyla bağlamak gerçekten fark eder mi?',
        a: 'Özellikle 4K yayında evet. Kablolu bağlantı, kablosuzda yaşanan ani hız düşüşlerini ve donmaları büyük ölçüde ortadan kaldırır.',
      },
    ],
    relatedCategories: [{ label: 'Elektro & Televizyon', href: '/kategori/elektro' }],
  },

  {
    slug: 'klima-kac-btu-olmali-metrekare-tablosu',
    title: 'Klima Kaç BTU Olmalı? Metrekareye Göre Klima Seçim Tablosu',
    description:
      'Klima BTU hesabı: oda metrekaresine göre 9.000, 12.000, 18.000 ve 24.000 BTU seçim tablosu, çatı katı ve güneş alan oda için düzeltmeler.',
    excerpt:
      'Odanızın metrekaresine göre doğru BTU değerini bulmanın ve yanlış seçimin bedelini görmenin en hızlı yolu.',
    category: 'Klima & Isıtma',
    tags: ['klima', 'BTU hesabı', 'inverter', 'KKTC'],
    publishedAt: '2026-09-11',
    blocks: [
      {
        kind: 'p',
        text:
          'Klima seçiminde ilk ve en kritik karar BTU değeridir. BTU, klimanın bir saatte odadan çekebildiği ısı miktarını gösterir. Düşük seçilen klima odayı soğutamaz ve sürekli tam güçte çalışarak hem yıpranır hem çok elektrik harcar. Gereğinden büyük seçilen klima ise odayı çabuk soğutup durur, nemi alamaz ve içerisi serin ama yapış yapış kalır.',
      },
      { kind: 'h2', text: 'Metrekareye göre BTU tablosu' },
      {
        kind: 'table',
        head: ['Oda alanı', 'Önerilen BTU', 'Tipik yer'],
        rows: [
          ['10 - 15 m²', '9.000 BTU', 'Yatak odası, çocuk odası'],
          ['16 - 22 m²', '12.000 BTU', 'Büyük yatak odası, küçük salon'],
          ['23 - 35 m²', '18.000 BTU', 'Salon'],
          ['36 - 50 m²', '24.000 BTU', 'Geniş salon, açık plan'],
          ['50 m² üzeri', 'Birden fazla iç ünite', 'Açık plan ev, dükkân'],
        ],
      },
      { kind: 'h2', text: 'Tabloyu bir üst kademeye taşıyan durumlar' },
      {
        kind: 'p',
        text:
          'Aşağıdaki maddelerden ikisi birden geçerliyse tablodaki değerin bir üst kademesini seçmek daha doğru olur. KKTC’de özellikle güneye bakan ve gün boyu güneş alan odalarda bu fark belirgindir.',
      },
      {
        kind: 'ul',
        items: [
          'Oda çatı katında ya da üstünde başka daire yok.',
          'Gün boyu doğrudan güneş alan geniş camlar var.',
          'Tavan yüksekliği 3 metrenin üzerinde.',
          'Odada sürekli çalışan ısı kaynağı var (mutfak, fırın, kalabalık ofis).',
          'Yalıtım zayıf, eski yapı.',
        ],
      },
      {
        kind: 'note',
        title: 'Salon klimasıyla bütün evi soğutamazsınız',
        text:
          'Kapıları açıp salondaki klimayla odaları soğutmaya çalışmak en sık yapılan hatadır. Soğuk hava kapı boşluğundan yeterince yayılmaz; klima sürekli çalışır, fatura yükselir, odalar yine serinlemez. Ayrı ayrı küçük klimalar, tek büyük klimadan hem daha etkili hem daha ekonomiktir.',
      },
      { kind: 'h2', text: 'Isıtma da yapacak mı?' },
      {
        kind: 'p',
        text:
          'KKTC’de kışlar ılıman geçtiği için klima, evlerin önemli bir bölümünde ana ısıtıcı olarak da kullanılıyor. Isıtma amacıyla da kullanacaksanız cihazın düşük dış sıcaklıkta çalışma aralığına ve ısıtma kapasitesine bakın; bazı modellerin soğutma kapasitesi yüksek olsa da ısıtma tarafı zayıftır.',
      },
    ],
    faqs: [
      {
        q: '12.000 BTU kaç metrekareye bakar?',
        a: 'Normal tavan yüksekliğinde ve orta düzey yalıtımda yaklaşık 16-22 m² arasıdır. Oda çatı katındaysa ya da çok güneş alıyorsa bu alan 16 m² civarına iner.',
      },
      {
        q: 'Büyük BTU almak daha mı iyi olur?',
        a: 'Hayır. Gereğinden büyük klima sık sık durup çalıştığı için odanın nemini alamaz ve konforu düşürür. Doğru kapasite, en yükseği değil odaya uygun olanıdır.',
      },
    ],
    relatedCategories: [{ label: 'Klima', href: '/kategori/klima' }],
  },

  {
    slug: 'inverter-klima-elektrik-tuketimi',
    title: 'Inverter Klima Gerçekten Tasarruf Ettirir mi?',
    description:
      'Inverter ve klasik klima farkı, elektrik tüketimi karşılaştırması, kaç ayda kendini amorti eder ve faturayı düşüren kullanım ayarları.',
    excerpt:
      'Inverter teknolojisinin ne yaptığını ve elektrik faturasında gerçekte ne kadar fark yarattığını anlatıyoruz.',
    category: 'Klima & Isıtma',
    tags: ['inverter klima', 'elektrik tüketimi', 'tasarruf'],
    publishedAt: '2026-09-12',
    blocks: [
      {
        kind: 'p',
        text:
          'Klasik klimalarda kompresör ya tam güçte çalışır ya da durur. Oda istenen sıcaklığa gelince kapanır, sıcaklık yükselince tekrar tam güçte devreye girer. Bu sürekli açılıp kapanma hem en çok elektriğin harcandığı andır hem de sıcaklığın inip çıkmasına yol açar.',
      },
      {
        kind: 'p',
        text:
          'Inverter klimalarda kompresör devri değiştirilebilir. Oda istenen sıcaklığa geldiğinde cihaz durmaz, düşük devirde çalışmaya devam eder. Böylece hem sıcaklık sabit kalır hem de en pahalı an olan yeniden kalkış tekrar tekrar yaşanmaz.',
      },
      { kind: 'h2', text: 'Fark ne zaman büyük, ne zaman küçük?' },
      {
        kind: 'table',
        head: ['Kullanım biçimi', 'Inverterin kazancı'],
        rows: [
          ['Günde 8 saat ve üzeri, sürekli açık', 'Yüksek — fark en çok burada görülür'],
          ['Akşamları birkaç saat', 'Orta'],
          ['Günde yarım saat, ara sıra', 'Düşük — yatırım kendini geç amorti eder'],
          ['Kışın ısıtma amaçlı sürekli', 'Yüksek'],
        ],
      },
      {
        kind: 'p',
        text:
          'Özetle: klimayı ne kadar uzun süre açık tutuyorsanız inverter o kadar mantıklıdır. Yazın gün boyu çalışan bir salon klimasında fark birkaç sezonda ilk alımdaki fiyat farkını kapatabilir.',
      },
      { kind: 'h2', text: 'Faturayı düşüren ayarlar' },
      {
        kind: 'ol',
        items: [
          'Sıcaklığı 24-25 °C’ye ayarlayın. Her 1 derece aşağı, tüketimi belirgin şekilde artırır.',
          'Klimayı 18 °C’ye alıp odayı “daha hızlı” soğutmaya çalışmayın; cihaz aynı hızda soğutur, yalnız daha uzun çalışır.',
          'Fan hızını otomatikte bırakın.',
          'Kapı ve pencereleri kapalı tutun, gündüz perdeleri kapatın.',
          'Filtreleri iki üç haftada bir yıkayın; tıkalı filtre hava akışını düşürür, tüketimi artırır.',
          'Gece uyku (sleep) modunu kullanın; sıcaklığı kademeli yükselterek tüketimi azaltır.',
        ],
      },
      {
        kind: 'note',
        title: 'Açıp kapamak tasarruf değil',
        text:
          'Inverter klimayı odadan her çıkışta kapatıp dönünce açmak tasarruf getirmez, tam tersini yapar. En çok elektrik yeniden soğutmaya başlarken harcanır. Kısa süreli çıkışlarda cihazı çalışır bırakmak daha ekonomiktir.',
      },
    ],
    faqs: [
      {
        q: 'Inverter klima daha mı sessiz?',
        a: 'Evet. Kompresör düşük devirde çalıştığı için hem çalışma sesi düşüktür hem de sürekli devreye girip çıkma sesi olmaz. Yatak odası için önemli bir fark.',
      },
      {
        q: 'Inverter klima arızalanırsa tamiri daha mı pahalı?',
        a: 'Elektronik kartı daha karmaşıktır, bu yüzden bazı arızalarda maliyeti yüksektir. Ancak doğru montaj ve düzenli bakım yapılan cihazlarda bu arızalar nadirdir.',
      },
    ],
    relatedCategories: [{ label: 'Klima', href: '/kategori/klima' }],
  },

  {
    slug: 'klima-montaji-ve-bakimi-kktc',
    title: 'Klima Montajı ve Bakımı: KKTC’de Nelere Dikkat Etmeli',
    description:
      'Klima montajında iç ve dış ünite yerleşimi, drenaj, bakır boru, deniz kıyısında korozyon ve yılda kaç kez bakım gerektiği.',
    excerpt:
      'Montaj kalitesi klimanın ömrünü belirliyor. Deniz kıyısı, tuzlu hava ve toz için özel notlarla.',
    category: 'Klima & Isıtma',
    tags: ['klima montajı', 'klima bakımı', 'drenaj', 'KKTC'],
    publishedAt: '2026-09-12',
    blocks: [
      {
        kind: 'p',
        text:
          'Klimada performansı belirleyen iki şey vardır: cihazın kendisi ve montajın kalitesi. İyi bir cihaz kötü montajla vasat çalışır; arızaların önemli bölümü de montaj hatasından kaynaklanır.',
      },
      { kind: 'h2', text: 'İç ünite nereye asılmalı?' },
      {
        kind: 'ul',
        items: [
          'Havayı odaya yayabileceği, önü açık bir duvara. Dolap ya da perde arkasına asılmamalı.',
          'Doğrudan yatağın ya da koltuğun üzerine üflemeyecek bir konuma. Sürekli üzerinize gelen soğuk hava rahatsız eder.',
          'Yerden yaklaşık 2-2,3 metre yüksekliğe; çok yükseğe asılan ünite tavana yakın sıcak havayı okur.',
          'Dış üniteye mümkün olduğunca yakın; boru uzadıkça verim düşer.',
        ],
      },
      { kind: 'h2', text: 'Dış ünite ve KKTC koşulları' },
      {
        kind: 'p',
        text:
          'Dış ünite doğrudan öğle güneşi alan bir cepheye konduğunda sıcak havayı daha zor atar ve verim düşer. Mümkünse gölgede, havalandırması engellenmeyecek şekilde ve titreşim yapmayacak sağlam bir konsola monte edilmelidir.',
      },
      {
        kind: 'note',
        title: 'Deniz kıyısında korozyon',
        text:
          'Girne ve Mağusa gibi kıyı bölgelerinde tuzlu hava, dış ünitenin alüminyum kanatçıklarını zamanla aşındırır. Kıyıya yakın evlerde korozyona dayanıklı kaplamalı modeller tercih edilmeli ve dış ünite yılda bir kez tatlı suyla durulanmalıdır.',
      },
      { kind: 'h2', text: 'Drenaj: en sık atlanan detay' },
      {
        kind: 'p',
        text:
          'Klima çalışırken yoğuşma suyu üretir ve bu su bir hortumla dışarı atılır. Hortum yeterli eğimle çekilmezse ya da içinde su birikirse iç üniteden duvara su sızar. “Klimam su akıtıyor” şikâyetlerinin çoğunun sebebi tıkalı ya da eğimsiz drenaj hattıdır; cihaz arızası değildir.',
      },
      { kind: 'h2', text: 'Bakım takvimi' },
      {
        kind: 'table',
        head: ['İşlem', 'Sıklık'],
        rows: [
          ['İç ünite filtrelerini yıkamak', '2-3 haftada bir (yoğun sezonda)'],
          ['İç ünite iç temizliği', 'Yılda 1 kez, sezon başında'],
          ['Dış ünite temizliği', 'Yılda 1 kez'],
          ['Gaz ve basınç kontrolü', 'Yılda 1 kez ya da soğutma zayıfladığında'],
          ['Drenaj hattı kontrolü', 'Sezon başında'],
        ],
      },
      {
        kind: 'p',
        text:
          'Klimadan kötü koku geliyorsa neredeyse her zaman sebep, iç ünitedeki nemli yüzeylerde biriken kirdir. Filtre yıkamak bu kokuyu azaltır ama tamamen gidermek için iç ünitenin profesyonel temizliği gerekir.',
      },
    ],
    faqs: [
      {
        q: 'Klima montajı ücretsiz mi?',
        a: 'Uygun ürünlerde montaj hizmeti sunuluyor. Standart montaj dışında kalan ek boru, kırım ve konsol gibi işler ayrıca değerlendirilir; teknisyen randevu sırasında bunu netleştirir.',
      },
      {
        q: 'Klimayı kışın da çalıştırmalı mıyım?',
        a: 'Isıtma amacıyla kullanmasanız bile ayda bir kez kısa süre çalıştırmak, sistemdeki yağın dolaşmasını sağlar ve contaların kurumasını önler.',
      },
    ],
    relatedCategories: [{ label: 'Klima', href: '/kategori/klima' }],
  },

  {
    slug: 'derin-dondurucu-sandik-mi-dikey-mi',
    title: 'Derin Dondurucu Seçimi: Sandık Tipi mi, Dikey mi?',
    description:
      'Sandık ve dikey derin dondurucu farkı, litre hesabı, enerji tüketimi ve KKTC’de elektrik kesintisinde sıcaklığı koruma süresi.',
    excerpt:
      'İki tip derin dondurucunun gerçek farkı, kaç litre alınmalı ve kesintide hangisi daha güvenli.',
    category: 'Beyaz Eşya',
    tags: ['derin dondurucu', 'sandık tipi', 'dikey dondurucu'],
    publishedAt: '2026-09-13',
    blocks: [
      {
        kind: 'p',
        text:
          'Derin dondurucu, buzdolabının dondurucu bölmesi yetmeyen evler için alınır: toplu et alanlar, sebze dondurup kışa saklayanlar, kalabalık aileler ve küçük işletmeler. İlk karar ise tip seçimidir.',
      },
      { kind: 'h2', text: 'Sandık tipi' },
      {
        kind: 'ul',
        items: [
          'Aynı litrede genellikle daha ucuz ve daha az elektrik harcar.',
          'Kapak üstte olduğu için açıldığında soğuk hava dibe çöker, daha az kaçar.',
          'Elektrik kesildiğinde iç sıcaklığı daha uzun süre korur.',
          'Dezavantajı düzendir: alttaki paketlere ulaşmak için üsttekileri boşaltmak gerekir.',
          'Geniş taban alanı ister; küçük mutfağa zor sığar, genellikle balkon ya da depoya konur.',
        ],
      },
      { kind: 'h2', text: 'Dikey tip' },
      {
        kind: 'ul',
        items: [
          'Çekmeceli düzeni sayesinde ne nerede belli; günlük kullanımda çok daha pratik.',
          'Buzdolabı gibi az yer kaplar, mutfağa yerleştirilebilir.',
          'No-frost seçenekleri yaygındır, buz çözme derdi olmaz.',
          'Kapı yandan açıldığı için her açılışta soğuk hava kaçar; tüketim biraz daha yüksektir.',
          'Aynı litrede sandık tipe göre fiyatı genellikle daha yüksektir.',
        ],
      },
      { kind: 'h2', text: 'Kaç litre almalı?' },
      {
        kind: 'table',
        head: ['Hane', 'Önerilen hacim'],
        rows: [
          ['1-2 kişi, ara sıra kullanım', '60 - 100 litre'],
          ['3-4 kişi', '150 - 200 litre'],
          ['5+ kişi veya toplu alışveriş', '250 - 350 litre'],
          ['Küçük işletme', '350 litre ve üzeri'],
        ],
      },
      {
        kind: 'note',
        title: 'Elektrik kesintisinde ne olur?',
        text:
          'Kapağı hiç açılmayan dolu bir derin dondurucu, sandık tipte genellikle bir günü aşan süre boyunca donmuş kalır; dikey tipte bu süre daha kısadır. Kesinti sırasında yapılacak en doğru şey kapağı açmamaktır. Dondurucuyu tıka basa dolu tutmak da soğuğun daha uzun korunmasını sağlar.',
      },
      {
        kind: 'p',
        text:
          'Bir kez çözülmüş gıdayı tekrar dondurmayın. Çözülme sırasında yüzeyde başlayan mikrobiyal faaliyet, yeniden dondurmayla durmaz; yalnızca yavaşlar.',
      },
    ],
    faqs: [
      {
        q: 'Derin dondurucu balkonda çalışır mı?',
        a: 'Kapalı ve doğrudan güneş almayan bir balkonda çalışır. Ancak cihazın iklim sınıfı ortam sıcaklığını karşılamalı; çok sıcak ortamda kompresör sürekli çalışır ve ömrü kısalır.',
      },
      {
        q: 'Boş derin dondurucu daha mı az elektrik harcar?',
        a: 'Hayır, tersi geçerlidir. Dolu dondurucu içindeki donmuş kütle soğuğu tutar ve kompresör daha seyrek devreye girer. Yeriniz boşsa su dolu şişelerle doldurmak bile tüketimi düşürür.',
      },
    ],
    relatedCategories: [
      { label: 'Derin Dondurucu', href: '/kategori/derin-dondurucu' },
      { label: 'Soğutma & Beyaz Eşya', href: '/kategori/buzdolabi' },
    ],
  },
]
