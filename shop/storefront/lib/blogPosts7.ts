import type { BlogPost } from '@/lib/blog'

/**
 * Yazı gövdeleri — 7. bölüm: SATIN ALMA NİYETİ YÜKSEK KIBRIS ARAMALARI (2026-10-05).
 *
 * Kullanıcı isteği: "biraz daha blog eklemesi yap, tüm ürünlerde en üstte çıkmamız lazım,
 * SEO'yu güçlendir". Buradaki başlıklar "fiyat", "taksit", "toplu alım", "garanti" gibi
 * SATIN ALMAYA YAKIN aramaları hedefliyor; önceki bölümlerde karşılığı yoktu.
 *
 * SÖZ VERİLMEYENLER: fiyat rakamı, taksit sayısı, teslim günü. Bunlar ürüne, karta ve stoka
 * göre değişiyor; yazıda sabit yazılırsa eskir ve yanlış bilgi olur. Metin yalnız sitenin
 * başka yerlerinde de verilen sözleri tekrarlıyor: KKTC geneli ücretsiz teslimat, 3 yıl
 * distribütör garantisi, ankastre ve beyaz eşyada ücretsiz montaj (termosifon/şofben hariç).
 */
export const BLOG_POSTS_7: BlogPost[] = [
  {
    slug: 'kibris-beyaz-esya-fiyatlari-toplam-maliyet',
    title: 'Kıbrıs’ta Beyaz Eşya Fiyatları: Etiketin Ötesinde Toplam Maliyet',
    description:
      'Kıbrıs’ta beyaz eşya alırken yalnız etiket fiyatına bakmayın. Teslimat, montaj, garanti ve enerji tüketimiyle gerçek maliyeti nasıl hesaplarsınız?',
    excerpt:
      'İki ürün arasındaki fiyat farkı, teslimat, montaj, garanti ve elektrik faturası eklendiğinde tersine dönebilir.',
    category: 'Rehber',
    tags: ['fiyat', 'Kıbrıs', 'beyaz eşya', 'KKTC', 'toplam maliyet'],
    publishedAt: '2026-10-05',
    blocks: [
      {
        kind: 'p',
        text:
          'Kıbrıs’ta beyaz eşya fiyatlarını karşılaştırırken çoğu kişi yalnız etiketteki rakama bakar. Oysa bir buzdolabı ya da çamaşır makinesi 10 yıl ve üzeri kullanılan bir cihazdır; asıl maliyeti eve gelene kadar ve kullanım süresi boyunca oluşur. Aşağıdaki kalemleri hesaba kattığınızda, ucuz görünen teklifin pahalıya geldiği sık görülür.',
      },
      { kind: 'h2', text: 'Fiyatı belirleyen beş kalem' },
      {
        kind: 'table',
        head: ['Kalem', 'Neden önemli', 'Stilsoft’te'],
        rows: [
          ['Teslimat', 'Ağır ürünün adrese taşınması ayrı ücret olabilir', 'KKTC geneli ücretsiz'],
          ['Montaj / kurulum', 'Ankastre ve beyaz eşyada usta ücreti çıkabilir', 'Ankastre ve beyaz eşyada ücretsiz (termosifon/şofben hariç)'],
          ['Garanti', 'Distribütör garantisi olmayan üründe servis ve parça sorunu yaşanır', '3 yıl resmi distribütör garantisi'],
          ['Enerji tüketimi', 'Yıllık elektrik farkı birkaç yılda fiyat farkını kapatabilir', 'Enerji sınıfı ürün sayfasında'],
          ['Ödeme', 'Taksit ya da havale seçenekleri nakit akışını değiştirir', 'Kart, taksit, havale/EFT'],
        ],
      },
      { kind: 'h2', text: 'Enerji sınıfı neden fiyat kadar önemli?' },
      {
        kind: 'p',
        text:
          'Buzdolabı 7 gün 24 saat çalışan tek beyaz eşyadır. KKTC’de elektrik birim fiyatı düşünüldüğünde, verimli bir model ile eski tip bir model arasındaki yıllık tüketim farkı, birkaç yılda iki ürünün etiket farkını kapatabilir. Karşılaştırırken ürün sayfasındaki enerji sınıfına ve yıllık kWh değerine bakın.',
      },
      { kind: 'h2', text: 'Karşılaştırma yaparken kontrol listesi' },
      {
        kind: 'ul',
        items: [
          'Fiyata teslimat ve montaj dahil mi, yoksa sepette ayrıca mı ekleniyor?',
          'Garanti kimde: resmi distribütör mü, yoksa satıcının kendi sözü mü?',
          'Arıza olursa servis adaya mı geliyor, ürün başka yere mi gönderiliyor?',
          'Ölçüler evinize ve kapıdan geçişe uygun mu?',
          'Taksit seçeneklerinde vade farkı var mı?',
        ],
      },
      {
        kind: 'note',
        title: 'Kararsız kaldıysanız',
        text:
          'İki ürün arasında kaldığınızda bizi arayın; hangi modelin eviniz ve kullanımınız için daha mantıklı olduğunu ürün ürün anlatalım.',
      },
    ],
    faqs: [
      {
        q: 'Kıbrıs’ta beyaz eşya fiyatları neden mağazadan mağazaya değişiyor?',
        a: 'Fiyata teslimat, montaj ve garantinin dahil olup olmaması, ürünün resmi distribütör ürünü olup olmaması ve stok durumu farkı oluşturur. Karşılaştırırken bu kalemlerin dahil olup olmadığına bakın.',
      },
      {
        q: 'Teslimat ve montaj fiyata dahil mi?',
        a: 'Stilsoft’te KKTC geneli teslimat ücretsizdir. Ankastre ve beyaz eşyada montaj da ücretsizdir; termosifon ve şofben gibi tesisat ürünlerinde montaj fiyata dahil değildir.',
      },
    ],
    relatedCategories: [
      { label: 'Soğutma & Beyaz Eşya', href: '/kategori/buzdolabi' },
      { label: 'Ankastre Setler', href: '/kategori/ankastre' },
    ],
  },

  {
    slug: 'kibris-taksitle-beyaz-esya-alma',
    title: 'Kıbrıs’ta Taksitle Beyaz Eşya Almak: Kart, Taksit ve Havale Rehberi',
    description:
      'KKTC’de beyaz eşyayı taksitle ya da havale ile almak mümkün mü? Kredi kartı taksiti, 3D Secure ve havale/EFT ile güvenli ödeme adım adım.',
    excerpt:
      'Taksit seçenekleri nasıl görünür, 3D Secure nedir, havale ile sipariş nasıl tamamlanır — hepsi tek yazıda.',
    category: 'KKTC Rehberi',
    tags: ['taksit', 'kredi kartı', 'havale', 'KKTC', 'online ödeme'],
    publishedAt: '2026-10-05',
    blocks: [
      {
        kind: 'p',
        text:
          'Beyaz eşya, ev bütçesinde tek seferde ödenmesi zor kalemlerden biridir. Bu yüzden Kıbrıs’ta en çok sorulan sorulardan biri “taksit yapılıyor mu?” sorusudur. Stilsoft’te siparişi kredi kartıyla tek çekim ya da taksitle, isterseniz havale/EFT ile ödeyebilirsiniz.',
      },
      { kind: 'h2', text: 'Taksit seçeneklerini nerede görürüm?' },
      {
        kind: 'p',
        text:
          'Ürün sayfasındaki taksit tablosu, o ürünün tutarına göre kaç taksit yapılabildiğini ve aylık tutarı gösterir. Taksit sayısı kartınızın bankasına ve sepet tutarına göre değişir; ödeme adımında kart bilgilerinizi girdiğinizde size uygun seçenekler listelenir.',
      },
      { kind: 'h2', text: 'Kartla ödeme güvenli mi?' },
      {
        kind: 'ul',
        items: [
          'Ödemeler 3D Secure ile alınır: bankanız telefonunuza tek kullanımlık şifre gönderir, onaylamadan çekim yapılmaz.',
          'Kart bilgileriniz mağaza sunucularında saklanmaz; doğrudan bankanın güvenli sayfasına iletilir.',
          'Ödeme sonucu ekranda sipariş numarasıyla birlikte gösterilir ve telefonunuza SMS ile bildirilir.',
        ],
      },
      { kind: 'h2', text: 'Havale / EFT ile sipariş' },
      {
        kind: 'ol',
        items: [
          'Ödeme adımında “Havale / EFT” seçeneğini seçin.',
          'Ekranda görünen IBAN’a sipariş tutarını gönderin; açıklamaya sipariş numaranızı yazın.',
          'Ödemeniz hesabımıza geçtiğinde siparişiniz onaylanır ve hazırlanmaya başlar.',
        ],
      },
      {
        kind: 'note',
        title: 'Üye olmanız gerekmez',
        text:
          'Siparişi üye olmadan da verebilirsiniz: ödeme sayfasında ad, telefon ve adresinizi yazmanız yeterli.',
      },
    ],
    faqs: [
      {
        q: 'Kaç taksit yapılabiliyor?',
        a: 'Taksit sayısı kartınızın bankasına ve sepet tutarına göre değişir. Ürün sayfasındaki taksit tablosunda ve ödeme adımında size uygun seçenekleri görürsünüz.',
      },
      {
        q: 'Taksitli alışverişte teslimat ücretli mi?',
        a: 'Hayır. Ödeme yöntemi ne olursa olsun KKTC geneli teslimat ücretsizdir.',
      },
    ],
    relatedCategories: [{ label: 'Tüm Ürünler', href: '/urunler' }],
  },

  {
    slug: 'kibris-otel-kiralik-daire-toplu-beyaz-esya',
    title: 'Otel, Kiralık Daire ve Site Projeleri İçin Toplu Beyaz Eşya Alımı (Kıbrıs)',
    description:
      'Kıbrıs’ta otel, pansiyon, kiralık daire ve site projeleri için toplu beyaz eşya ve klima alırken nelere dikkat edilmeli? Ürün seçimi, teslim planı ve teklif süreci.',
    excerpt:
      'Oda ya da daire sayısına göre ürün listesi, teslim planı ve proje bazlı teklif almanın püf noktaları.',
    category: 'KKTC Rehberi',
    tags: ['toplu alım', 'otel', 'kiralık daire', 'proje', 'kurumsal', 'Kıbrıs'],
    publishedAt: '2026-10-05',
    blocks: [
      {
        kind: 'p',
        text:
          'Kuzey Kıbrıs’ta otel, pansiyon, öğrenci yurdu ve kiralık daire yatırımı büyüyor. Bu projelerde beyaz eşya tek tek değil, onlarca birim için aynı anda alınır. Doğru planlanmazsa farklı modeller, dağınık teslimatlar ve yönetilemeyen servis süreçleri ortaya çıkar.',
      },
      { kind: 'h2', text: 'Birim başına tipik ürün listesi' },
      {
        kind: 'table',
        head: ['Proje tipi', 'Birim başına sık alınanlar'],
        rows: [
          ['Otel odası', 'Mini buzdolabı, klima, su ısıtıcı, saç kurutma makinesi'],
          ['Kiralık daire', 'Buzdolabı, çamaşır makinesi, ankastre set ya da ocak-fırın, klima'],
          ['Öğrenci evi / yurt', 'Buzdolabı, çamaşır makinesi, su ısıtıcı, ütü'],
          ['Ofis', 'Su sebili, çay makinesi, kahve makinesi, klima'],
        ],
      },
      { kind: 'h2', text: 'Toplu alımda dikkat edilecekler' },
      {
        kind: 'ul',
        items: [
          'Tek model seçin: yedek parça, kullanım kılavuzu ve servis süreci tek tipte kalır.',
          'Enerji sınıfına bakın: 20 dairede yıllık elektrik farkı ciddi bir tutara ulaşır.',
          'Teslim planını inşaat takvimine bağlayın; ürünler daire hazır olduğunda gelsin.',
          'Garantinin resmi distribütör garantisi olduğundan emin olun.',
          'Faturanın firma adına kesilmesini teklif aşamasında belirtin.',
        ],
      },
      {
        kind: 'note',
        title: 'Kurumsal satış danışmanı',
        text:
          'Toplu alımlarda kurumsal satış danışmanımız proje bazlı teklif hazırlar. Kurumsal Satış sayfasından teklif isteyebilir ya da doğrudan arayabilirsiniz.',
      },
    ],
    faqs: [
      {
        q: 'Kaç adetten itibaren toplu alım sayılır?',
        a: 'Alt sınır yok. Birden fazla ürün ya da aynı üründen birkaç adet alacaksanız kurumsal satış danışmanımız size ayrıca fiyat çalışır.',
      },
      {
        q: 'Teslimat projeye göre planlanabilir mi?',
        a: 'Evet. Teslim tarihleri projenizin takvimine göre birlikte planlanır; KKTC geneli teslimat ücretsizdir.',
      },
    ],
    relatedCategories: [
      { label: 'Kurumsal Satış', href: '/kurumsal-satis' },
      { label: 'Klimalar', href: '/kategori/klima' },
    ],
  },

  {
    slug: 'termosifon-mi-sofben-mi-kktc',
    title: 'Termosifon mu, Şofben mi? KKTC’de Sıcak Su İçin Doğru Seçim',
    description:
      'KKTC’de güneş enerjisi yetmediğinde termosifon mu şofben mi alınmalı? Litre seçimi, elektrik tüketimi, montaj ve kireç konusunda pratik rehber.',
    excerpt:
      'Hane sayısına göre litre seçimi, elektrik tüketimi ve Kıbrıs’ın kireçli suyuna karşı bakım önerileri.',
    category: 'Klima & Isıtma',
    tags: ['termosifon', 'şofben', 'sıcak su', 'KKTC', 'güneş enerjisi'],
    publishedAt: '2026-10-05',
    blocks: [
      {
        kind: 'p',
        text:
          'Kıbrıs’ta evlerin çoğunda güneş enerjili su ısıtma sistemi bulunur; ancak kış aylarında, bulutlu günlerde ve kalabalık hanelerde güneş enerjisi yetmez. Bu boşluğu termosifon ya da şofben kapatır. İkisi farklı ihtiyaçlara göre tasarlanmıştır.',
      },
      { kind: 'h2', text: 'Temel fark' },
      {
        kind: 'table',
        head: ['', 'Termosifon', 'Şofben (ani su ısıtıcı)'],
        rows: [
          ['Çalışma şekli', 'Depodaki suyu ısıtıp saklar', 'Suyu akarken anında ısıtır'],
          ['Kime uygun', 'Kalabalık hane, aynı anda birden çok musluk', 'Tek banyo, kısa kullanım'],
          ['Yer', 'Duvarda depo için alan gerekir', 'Küçük, lavabo altına sığar'],
          ['Bekleme', 'İlk ısınma süresi var', 'Bekleme yok'],
        ],
      },
      { kind: 'h2', text: 'Kaç litre termosifon?' },
      {
        kind: 'ul',
        items: [
          '1-2 kişi: 50 litre çoğu zaman yeterlidir.',
          '3-4 kişi: 65-80 litre önerilir.',
          '5 kişi ve üzeri ya da iki banyo: 100 litre ve üzeri düşünülmelidir.',
        ],
      },
      { kind: 'h2', text: 'Kireç ve bakım' },
      {
        kind: 'p',
        text:
          'Adanın birçok bölgesinde su serttir. Termosifonlarda magnezyum anot çubuğu kireç ve korozyona karşı korur; kullanım yoğunluğuna göre 1-2 yılda bir kontrol ettirilmesi cihaz ömrünü uzatır.',
      },
      {
        kind: 'note',
        title: 'Montaj hakkında',
        text:
          'Termosifon ve şofben tesisat bağlantısı gerektirdiği için montaj fiyata dahil değildir; ehil bir tesisatçı tarafından, topraklı prizle ve emniyet ventiliyle bağlanmalıdır.',
      },
    ],
    faqs: [
      {
        q: 'Termosifon çok elektrik yakar mı?',
        a: 'Tüketim, depoyu ne sıklıkta ısıttığınıza bağlıdır. Termostatı ihtiyaç kadar ayarlamak ve güneş enerjisiyle birlikte kullanmak tüketimi belirgin şekilde düşürür.',
      },
      {
        q: 'Termosifon montajı ücretsiz mi?',
        a: 'Hayır. Termosifon ve şofben tesisat ürünü olduğu için montaj fiyata dahil değildir.',
      },
    ],
    relatedCategories: [{ label: 'Ev Gereçleri', href: '/kategori/ev-gerecleri' }],
  },

  {
    slug: 'su-sebili-secimi-ev-ofis',
    title: 'Su Sebili Seçimi: Ev ve Ofis İçin Sıcak-Soğuk Sebil Rehberi',
    description:
      'Ev ve ofis için su sebili alırken nelere bakılmalı? Damacana üstten mi alttan mı, kompresörlü mü, sıcak su güvenliği ve temizlik önerileri.',
    excerpt:
      'Üstten ve alttan yüklemeli sebil farkı, soğutma tipi, çocuk kilidi ve hijyen için bilmeniz gerekenler.',
    category: 'Küçük Ev Aletleri',
    tags: ['su sebili', 'sebil', 'ofis', 'damacana', 'KKTC'],
    publishedAt: '2026-10-05',
    blocks: [
      {
        kind: 'p',
        text:
          'Kıbrıs’ın sıcak yazlarında soğuk suya, kışın da çay ve kahve için sıcak suya hızlı erişim isteyenler için su sebili pratik bir çözümdür. Evde de ofiste de kullanılan sebillerde birkaç temel tercih, günlük kullanımı belirler.',
      },
      { kind: 'h2', text: 'Üstten mi, alttan mı yüklemeli?' },
      {
        kind: 'table',
        head: ['', 'Üstten yüklemeli', 'Alttan yüklemeli'],
        rows: [
          ['Damacana takma', '19 litreyi kaldırıp ters çevirmek gerekir', 'Damacana dolaba yerleştirilir, kaldırma yok'],
          ['Görünüm', 'Damacana açıkta', 'Damacana gizli, daha düzenli'],
          ['Fiyat', 'Genelde daha uygun', 'Genelde daha yüksek'],
        ],
      },
      { kind: 'h2', text: 'Alırken bakılacaklar' },
      {
        kind: 'ul',
        items: [
          'Soğutma tipi: kompresörlü sebiller daha hızlı ve daha soğuk su verir.',
          'Sıcak su musluğunda çocuk kilidi olmalı; evde küçük çocuk varsa bu şarttır.',
          'Damla haznesi çıkarılabilir ve kolay temizlenebilir olmalı.',
          'Ofiste kullanılacaksa bardak ve kapasite ihtiyacına göre model seçin.',
        ],
      },
      { kind: 'h2', text: 'Hijyen' },
      {
        kind: 'p',
        text:
          'Sebilin su hattı, damacana değişimlerinde dış ortamla temas eder. Üreticinin önerdiği aralıklarla haznenin temizlenmesi ve damacana ağzının takmadan önce silinmesi suyun tadını ve hijyenini korur.',
      },
    ],
    faqs: [
      {
        q: 'Su sebili çok elektrik harcar mı?',
        a: 'Sıcak ve soğuk hazneleri sürekli hazır tuttuğu için bir miktar tüketimi vardır. Kullanılmayan saatlerde ısıtma anahtarını kapatmak tüketimi azaltır.',
      },
    ],
    relatedCategories: [{ label: 'Su Sebilleri', href: '/kategori/sebil' }],
  },

  {
    slug: 'buzdolabi-iklim-sinifi-kibris-sicak-yaz',
    title: 'Kıbrıs Yazında Buzdolabı Neden Zorlanır? İklim Sınıfı (SN, N, ST, T) Rehberi',
    description:
      'Kıbrıs’ın 40 derecelik yazında buzdolabı neden yetersiz soğutur? İklim sınıfı nedir, mutfakta nereye konmalı ve performansı korumak için ipuçları.',
    excerpt:
      'Etiketteki SN-N-ST-T harfleri, buzdolabının hangi oda sıcaklığında tam performans verdiğini söyler.',
    category: 'Beyaz Eşya',
    tags: ['buzdolabı', 'iklim sınıfı', 'yaz', 'Kıbrıs', 'sıcaklık'],
    publishedAt: '2026-10-05',
    blocks: [
      {
        kind: 'p',
        text:
          'Temmuz ve ağustosta Kıbrıs’ta hava sıcaklığı 40 dereceyi aşabiliyor; klimasız mutfaklarda oda sıcaklığı da 30’ların üstüne çıkıyor. Buzdolabı içeriyi soğuturken ısıyı dışarı, yani mutfağa atar. Ortam ne kadar sıcaksa cihaz o kadar uzun çalışır.',
      },
      { kind: 'h2', text: 'İklim sınıfı nedir?' },
      {
        kind: 'table',
        head: ['Sınıf', 'Uygun oda sıcaklığı'],
        rows: [
          ['SN', '+10 °C – +32 °C'],
          ['N', '+16 °C – +32 °C'],
          ['ST', '+16 °C – +38 °C'],
          ['T', '+16 °C – +43 °C'],
        ],
      },
      {
        kind: 'p',
        text:
          'Kıbrıs’ın yaz koşulları için ST ya da T sınıfı, ya da birden çok sınıfı kapsayan (ör. SN-T) modeller daha uygundur. İklim sınıfı cihazın içindeki ya da arkasındaki enerji etiketinde yazar.',
      },
      { kind: 'h2', text: 'Yaz performansını korumak için' },
      {
        kind: 'ol',
        items: [
          'Buzdolabını fırın, ocak ve doğrudan güneş alan pencereden uzak koyun.',
          'Arkada ve yanlarda üreticinin önerdiği hava boşluğunu bırakın.',
          'Kapıyı uzun süre açık tutmayın; sıcak yemeği soğumadan koymayın.',
          'Kapı contasını kontrol edin; kağıt sıkıştırdığınızda kolayca kayıyorsa conta sızdırıyor olabilir.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Buzdolabım yazın neden sürekli çalışıyor?',
        a: 'Ortam sıcaklığı yükseldikçe kompresör daha uzun çalışır; bu normaldir. Ancak içerisi yeterince soğumuyorsa yer, hava boşluğu ve conta kontrol edilmeli, sorun sürerse servis çağrılmalıdır.',
      },
    ],
    relatedCategories: [{ label: 'Buzdolapları', href: '/kategori/buzdolabi' }],
  },

  {
    slug: 'kibris-nem-klima-nem-alma-camasir-kurutma',
    title: 'Kıbrıs’ta Nemle Başa Çıkmak: Klimada Nem Alma Modu ve Çamaşır Kurutma',
    description:
      'Kıbrıs’ın nemli yazlarında klimanın nem alma (dry) modu ne işe yarar, çamaşır neden kurumaz, rutubete karşı hangi cihazlar yardımcı olur?',
    excerpt:
      'Dry modu, doğru sıcaklık ayarı ve kurutma makinesiyle nemli günlerde evi ferah tutmanın yolları.',
    category: 'Klima & Isıtma',
    tags: ['nem', 'klima', 'dry modu', 'kurutma makinesi', 'Kıbrıs'],
    publishedAt: '2026-10-05',
    blocks: [
      {
        kind: 'p',
        text:
          'Özellikle sahil kesiminde — Girne, Gazimağusa, İskele ve Lapta çevresinde — yaz aylarında nem oranı yüksektir. Nem, aynı sıcaklığı daha bunaltıcı hissettirir, çamaşırın kurumasını geciktirir ve kapalı alanlarda rutubet kokusuna yol açar.',
      },
      { kind: 'h2', text: 'Klimanın nem alma (dry) modu' },
      {
        kind: 'p',
        text:
          'Dry modunda klima, odayı fazla soğutmadan havadaki nemi yoğuşturarak dışarı atar. Hava çok sıcak değil ama yapış yapışsa bu mod hem daha konforlu hem de çoğu zaman soğutma modundan daha az tüketimlidir.',
      },
      { kind: 'h2', text: 'Çamaşır kurumuyorsa' },
      {
        kind: 'ul',
        items: [
          'Çamaşır makinesinde yüksek devirli sıkma seçin; çamaşır daha az suyla çıkar.',
          'Kapalı alanda kurutuyorsanız odayı havalandırın ya da klimayı dry modunda çalıştırın.',
          'Sık çamaşır yıkanan evlerde ısı pompalı kurutma makinesi enerji açısından en verimli seçenektir.',
        ],
      },
      {
        kind: 'note',
        title: 'Klima bakımı',
        text:
          'Nemli bölgelerde klima filtresi daha çabuk kirlenir. Filtreyi düzenli temizlemek hem nem almayı hem soğutmayı iyileştirir, kötü kokuyu önler.',
      },
    ],
    faqs: [
      {
        q: 'Dry modu elektrik tasarrufu sağlar mı?',
        a: 'Hava çok sıcak değilse genellikle evet; odayı aşırı soğutmadan nemi aldığı için kompresör daha az zorlanır.',
      },
    ],
    relatedCategories: [
      { label: 'Klimalar', href: '/kategori/klima' },
      { label: 'Çamaşır Makineleri', href: '/kategori/camasir-makinesi' },
    ],
  },

  {
    slug: 'distributor-garantili-urun-nasil-anlasilir-kktc',
    title: 'KKTC’de Distribütör Garantili Ürün Nasıl Anlaşılır?',
    description:
      'KKTC’de beyaz eşya ve elektronik alırken resmi distribütör garantisi ile satıcı garantisi arasındaki fark ne? Arıza anında neden önemli, nasıl kontrol edilir?',
    excerpt:
      'Garanti belgesi, servis ağı ve yedek parça: resmi distribütör ürünü almanın arızada fark yaratan yanları.',
    category: 'Servis & Montaj',
    tags: ['garanti', 'distribütör', 'yetkili servis', 'KKTC'],
    publishedAt: '2026-10-05',
    blocks: [
      {
        kind: 'p',
        text:
          'Kıbrıs’ta aynı model ürün farklı yollardan satışa gelebilir: resmi distribütör üzerinden ya da yurt dışından bireysel getirilerek. İlk günlerde fark görünmez; fark, ürün arızalandığında ortaya çıkar.',
      },
      { kind: 'h2', text: 'İki garanti arasındaki fark' },
      {
        kind: 'table',
        head: ['', 'Resmi distribütör garantisi', 'Satıcı / bireysel garanti'],
        rows: [
          ['Servis', 'Adada yetkili servis', 'Belirsiz, çoğu zaman yok'],
          ['Yedek parça', 'Distribütör üzerinden temin', 'Bulmak zor, uzun bekleme'],
          ['Belge', 'Resmi garanti belgesi', 'Çoğu zaman yazılı belge yok'],
          ['Süre', 'Belgede yazılı süre boyunca', 'Satıcının sözüne bağlı'],
        ],
      },
      { kind: 'h2', text: 'Alırken nasıl kontrol edilir?' },
      {
        kind: 'ul',
        items: [
          'Satıcıya garantinin kim tarafından verildiğini sorun.',
          'Arıza olursa servisin adaya gelip gelmediğini öğrenin.',
          'Faturanın ve garanti belgesinin size verileceğinden emin olun.',
        ],
      },
      {
        kind: 'note',
        title: 'Stilsoft’te',
        text:
          'Sattığımız ürünler 3 yıl resmi distribütör garantilidir; arızada kendi yetkili servis ekibimiz adres bazlı destek verir.',
      },
    ],
    faqs: [
      {
        q: 'Garanti süresince servis ücretli mi?',
        a: 'Garanti kapsamındaki arızalarda işçilik ve parça ücreti alınmaz. Kullanım hatası, düşme ve sıvı teması gibi durumlar garanti dışında kalabilir.',
      },
    ],
    relatedCategories: [{ label: 'Yetkili Servis', href: '/servis' }],
  },
]
