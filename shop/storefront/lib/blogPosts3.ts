import type { BlogPost } from '@/lib/blog'

/** Yazı gövdeleri — 3. bölüm. Bölümlemenin gerekçesi için bkz. `blogPosts2.ts`. */
export const BLOG_POSTS_3: BlogPost[] = [
  {
    slug: 'beyaz-esya-garanti-ve-yetkili-servis-kktc',
    title: 'Beyaz Eşyada Garanti ve Yetkili Servis: KKTC’de Nasıl İşler?',
    description:
      'Garanti süresi neyi kapsar, hangi durumlar garanti dışıdır, KKTC’de yetkili servis kaydı nasıl açılır? Servis süreci adım adım.',
    excerpt:
      'Garanti kapsamı, garanti dışı durumlar ve servis kaydı açarken hazırlamanız gereken bilgiler.',
    category: 'Servis & Montaj',
    tags: ['garanti', 'yetkili servis', 'arıza', 'KKTC'],
    publishedAt: '2026-08-25',
    blocks: [
      {
        kind: 'p',
        text:
          'Garanti, üretim ve malzeme kaynaklı arızaların ücretsiz giderilmesini kapsar. Kullanıcı hatası, dış etken ve normal aşınma kapsam dışındadır. Bu ayrım bilinmediğinde servis çağrısı beklenmedik bir maliyetle sonuçlanabiliyor.',
      },
      { kind: 'h2', text: 'Garanti kapsamındakiler' },
      {
        kind: 'ul',
        items: [
          'Üretim hatasından kaynaklanan arızalar.',
          'Malzeme kusurları.',
          'Normal kullanımda ortaya çıkan elektronik ve mekanik arızalar.',
          'Kapsamdaki arızalarda işçilik ve yedek parça.',
        ],
      },
      { kind: 'h2', text: 'Garanti dışı kalan durumlar' },
      {
        kind: 'ul',
        items: [
          'Düşürme, darbe ve fiziksel hasar.',
          'Şebeke kaynaklı aşırı gerilim ve yıldırım hasarı.',
          'Yetkisiz kişilerce yapılan müdahale ve açılmış cihazlar.',
          'Kireç ve bakım eksikliğinden kaynaklanan tıkanma ve arızalar.',
          'Kullanım kılavuzuna aykırı kullanım.',
          'Sarf malzemeler: filtre, torba, conta gibi zamanla tükenen parçalar.',
        ],
      },
      {
        kind: 'note',
        title: 'Faturanızı saklayın',
        text:
          'Garanti başlangıç tarihi genellikle satın alma tarihidir. Fatura ya da sipariş kaydı olmadan garanti başlangıcının doğrulanması zorlaşır. Çevrimiçi alışverişte sipariş geçmişiniz bu belgeyi zaten saklar.',
      },
      { kind: 'h2', text: 'Servis kaydı açarken hazırlayın' },
      {
        kind: 'ol',
        items: [
          'Ürünün model ve seri numarası (genellikle cihazın arka ya da yan etiketinde).',
          'Satın alma tarihi veya sipariş numarası.',
          'Arızanın tarifi: ne zaman başladı, hangi durumda ortaya çıkıyor.',
          'Adres ve ulaşılabilir telefon numarası.',
        ],
      },
      {
        kind: 'p',
        text:
          'Servis talebinizi site üzerindeki yetkili servis formundan iletebilirsiniz. Ürünü katalogdan seçtiğinizde model bilgisi kayda otomatik işlenir; bu, teknisyenin doğru yedek parçayla gelmesini sağlar.',
      },
    ],
    faqs: [
      {
        q: 'Garanti süresi ne zaman başlar?',
        a: 'Genellikle ürünün satın alındığı tarihte başlar. Montaj gerektiren ürünlerde bazı durumlarda kurulum tarihi esas alınabilir.',
      },
      {
        q: 'Servise götürmem mi gerekiyor, yerinde bakım var mı?',
        a: 'Büyük beyaz eşyada bakım genellikle yerinde yapılır. Küçük ev aletlerinde cihazın servise ulaştırılması istenebilir.',
      },
    ],
  },

  {
    slug: 'enerji-verimliligi-elektrik-faturasi-dusurme',
    title: 'Beyaz Eşyada Enerji Verimliliği: Elektrik Faturasını Düşürmenin Yolları',
    description:
      'Enerji etiketi nasıl okunur, hangi cihaz ne kadar tüketir, faturayı düşüren kullanım alışkanlıkları neler? KKTC için pratik rehber.',
    excerpt:
      'Enerji sınıfı etiketini okumayı ve günlük alışkanlıkla faturayı düşürmenin somut yollarını anlatıyoruz.',
    category: 'Rehber',
    tags: ['enerji verimliliği', 'elektrik faturası', 'enerji sınıfı'],
    publishedAt: '2026-08-24',
    blocks: [
      {
        kind: 'p',
        text:
          'Beyaz eşyanın satın alma fiyatı tek maliyet değildir. Cihaz, ömrü boyunca elektrik olarak da bir bedel öder. Sürekli çalışan buzdolabı ve sık kullanılan çamaşır makinesinde enerji sınıfı farkı, birkaç yıl içinde ilk alımdaki fiyat farkını kapatabilir.',
      },
      { kind: 'h2', text: 'Enerji etiketi nasıl okunur' },
      {
        kind: 'p',
        text:
          'Etiketteki harf, cihazın kendi sınıfındaki verimliliğini gösterir. Etiketin üzerindeki yıllık tüketim değeri (kWh/yıl) ise karşılaştırma yapmanın en doğrudan yoludur: iki modelin harfleri aynı olsa bile kWh değerleri farklı olabilir.',
      },
      {
        kind: 'table',
        head: ['Cihaz', 'Tüketimi belirleyen ana etken'],
        rows: [
          ['Buzdolabı', 'Sürekli çalışır; ortam sıcaklığı ve kapak contası'],
          ['Çamaşır makinesi', 'Yıkama sıcaklığı; suyun ısıtılması tüketimin çoğu'],
          ['Bulaşık makinesi', 'Program seçimi; eko program en düşük tüketim'],
          ['Fırın', 'Ön ısıtma süresi ve kapak açma sıklığı'],
          ['Klima ve ısıtıcılar', 'Hedef sıcaklık ve yalıtım'],
        ],
      },
      { kind: 'h2', text: 'Faturayı düşüren alışkanlıklar' },
      {
        kind: 'ol',
        items: [
          'Çamaşırı mümkün olduğunca 30-40 °C programlarda yıkayın; suyu ısıtmak tüketimin en büyük kalemidir.',
          'Bulaşık ve çamaşır makinesini dolu çalıştırın, gerekmedikçe yarım yük kullanmayın.',
          'Buzdolabını duvardan 5 cm uzağa koyun ve arka ızgarasını yılda bir temizleyin.',
          'Buzdolabı kapak contasını kontrol edin; kâğıt sıkıştırıp çekildiğinde kolay çıkıyorsa conta değişmeli.',
          'Fırında ön ısıtmayı gerekmedikçe kullanmayın, kapağı sık açmayın.',
          'Airfryer ve küçük fırınlar, tek kişilik porsiyonlarda büyük fırından daha ekonomiktir.',
          'Bekleme modunda kalan cihazları prizde bırakmayın.',
        ],
      },
      {
        kind: 'note',
        title: 'Sıcak iklim etkisi',
        text:
          'Ortam sıcaklığı yükseldikçe soğutucu cihazlar daha çok çalışır. Buzdolabını fırın yanına ya da doğrudan güneş alan bir noktaya koymamak, tek başına belirgin tasarruf sağlar.',
      },
    ],
    faqs: [
      {
        q: 'Eski buzdolabımı değiştirmek mantıklı mı?',
        a: 'On yaşın üzerindeki cihazlarda yıllık tüketim, yeni nesil modellerin belirgin şekilde üzerindedir. Değişimin kendini amorti etme süresi çoğu durumda birkaç yıldır.',
      },
    ],
  },

  {
    slug: 'kucuk-mutfak-icin-ankastre-cozumler',
    title: 'Küçük Mutfak İçin Ankastre Çözümler',
    description:
      'Dar mutfaklarda yer kazandıran ankastre çözümler: 45 cm bulaşık makinesi, ankastre mikrodalga, çekmeceli düzen ve dikey kullanım.',
    excerpt:
      'Küçük mutfakta alan kazanmak, cihazdan vazgeçmek değil doğru ölçüyü seçmek demek. Somut çözümleri listeledik.',
    category: 'Ankastre',
    tags: ['küçük mutfak', 'ankastre', 'alan kazanma'],
    publishedAt: '2026-08-23',
    relatedCategories: [{ label: 'Ankastre & Ocak Setleri', href: '/kategori/ankastre' }],
    blocks: [
      {
        kind: 'p',
        text:
          'Küçük mutfaklarda en sık yapılan hata, cihazlardan vazgeçmektir. Oysa dar ölçülerde üretilen ankastre modeller ve dikey yerleşim, aynı işlevi çok daha az yer kaplayarak sağlar.',
      },
      { kind: 'h2', text: 'Dar ölçülü ürünler' },
      {
        kind: 'ul',
        items: [
          '45 cm bulaşık makinesi: 8-10 kişilik kapasite, 60 cm modele göre 15 cm tasarruf.',
          'Kompakt fırın (45 cm yükseklik): mikrodalga işlevini de üstlenen modeller mevcut.',
          '2 veya 3 gözlü ocak: dört göz nadiren aynı anda kullanılıyorsa yeterli.',
          'Ankastre mikrodalga: tezgâhı tamamen boşaltır.',
        ],
      },
      { kind: 'h2', text: 'Dikey kullanım' },
      {
        kind: 'p',
        text:
          'Fırın ve mikrodalgayı üst üste kolon dolaba yerleştirmek, tezgâh altını bulaşık makinesi ve çekmecelere bırakır. Bu düzen aynı zamanda fırını bel hizasına getirdiği için kullanım açısından da daha rahattır.',
      },
      { kind: 'h2', text: 'Tezgâhı boşaltmak' },
      {
        kind: 'ol',
        items: [
          'Günlük kullanılmayan küçük ev aletlerini dolap içine alın.',
          'Çok işlevli cihazları tercih edin: airfryer ve mini fırın birleşimi iki cihaz yerine geçer.',
          'Ankastre davlumbaz yerine dolap içine gizlenen sürgülü model kullanın.',
          'Duvar rayı ve askı sistemleriyle sık kullanılan gereçleri tezgâhtan kaldırın.',
        ],
      },
      {
        kind: 'note',
        title: 'Ölçüyü baştan planlayın',
        text:
          'Dar ölçülü ürünler standart olmayan niş ölçüleri ister. Dolap yapılmadan önce model seçimini tamamlamak, küçük mutfaklarda büyük mutfaklardan daha kritiktir.',
      },
    ],
  },

  {
    slug: 'kisisel-bakim-sac-kurutma-sekillendirici',
    title: 'Saç Kurutma Makinesi ve Şekillendirici Seçimi',
    description:
      'Saç kurutma makinesi seçerken watt, iyonik teknoloji ve başlık farkları; şekillendirici ve maşa seçiminde plaka malzemesi ve ısı ayarı.',
    excerpt:
      'Watt tek başına yeterli değil. İyonik teknoloji, hava debisi ve plaka malzemesi neyi değiştiriyor?',
    category: 'Kişisel Bakım',
    tags: ['saç kurutma makinesi', 'şekillendirici', 'kişisel bakım'],
    publishedAt: '2026-08-22',
    relatedCategories: [{ label: 'Kişisel Bakım & Saç Şekillendirici', href: '/kategori/kisisel-bakim' }],
    blocks: [
      {
        kind: 'p',
        text:
          'Saç kurutma makinesinde yalnızca watt değerine bakmak yaygın bir yanılgıdır. Kuruma süresini belirleyen asıl değer hava debisidir; watt, motorun çektiği gücü gösterir ve tek başına performansı anlatmaz.',
      },
      { kind: 'h2', text: 'Kurutma makinesinde bakılacaklar' },
      {
        kind: 'ul',
        items: [
          'Güç: 1800-2200 W aralığı ev kullanımı için yeterlidir.',
          'İyonik teknoloji: statik elektriklenmeyi azaltır, saçı daha az kabartır.',
          'Isı ve hız kademeleri: ayrı ayrı ayarlanabilmesi kontrolü artırır.',
          'Soğuk üfleme: şekli sabitlemek için gerekli.',
          'Yoğunlaştırıcı ve difüzör başlık: düz ve dalgalı saçta farklı sonuç verir.',
        ],
      },
      { kind: 'h2', text: 'Şekillendirici ve maşada plaka malzemesi' },
      {
        kind: 'table',
        head: ['Malzeme', 'Özelliği'],
        rows: [
          ['Seramik', 'Isıyı eşit dağıtır, saçı daha az yıpratır.'],
          ['Turmalin', 'İyon salarak elektriklenmeyi azaltır.'],
          ['Titanyum', 'Hızlı ısınır, kalın ve gür saçta etkili.'],
        ],
      },
      {
        kind: 'note',
        title: 'Isı ayarı neden şart',
        text:
          'Sabit yüksek sıcaklıkta çalışan cihazlar ince saçta kalıcı yıpranmaya yol açar. Isı ayarı yapılabilen modeller, saç tipine göre en düşük etkili sıcaklıkta kullanılabilir.',
      },
    ],
    faqs: [
      {
        q: 'İyonik özellik gerçekten fark yaratır mı?',
        a: 'Özellikle kabaran ve elektriklenen saç tiplerinde belirgin fark yaratır. Düz ve ince saçta etkisi daha sınırlı hissedilir.',
      },
    ],
  },

  {
    slug: 'tasinirken-beyaz-esya-nakliyesi',
    title: 'Taşınırken Beyaz Eşya Nakliyesi ve Yeniden Kurulum',
    description:
      'Taşınmadan önce beyaz eşya nasıl hazırlanır: buzdolabı, çamaşır makinesi ve bulaşık makinesi için nakliye ve yeniden kurulum rehberi.',
    excerpt:
      'Nakliye cıvatası, su tahliyesi, dik taşıma ve bekleme süresi — taşınırken en çok hasar bu adımların atlanmasından çıkıyor.',
    category: 'Rehber',
    tags: ['taşınma', 'nakliye', 'kurulum'],
    publishedAt: '2026-08-21',
    blocks: [
      {
        kind: 'p',
        text:
          'Taşınma sırasında beyaz eşyada oluşan hasarların çoğu, taşıma anında değil hazırlık aşamasında yapılan atlamalardan kaynaklanır. Aşağıdaki adımlar cihaz başına birkaç dakika alır ve pahalı arızaların çoğunu önler.',
      },
      { kind: 'h2', text: 'Çamaşır makinesi' },
      {
        kind: 'ol',
        items: [
          'Su girişini kapatın, hortumu sökün ve içindeki suyu boşaltın.',
          'Pompa filtresini açıp kalan suyu tamamen tahliye edin.',
          'Nakliye cıvatalarını takın. Bu cıvatalar tamburu sabitler; takılmadan taşınan makinede askı sistemi zarar görür.',
          'Kapağı ve deterjan çekmecesini bantlayın.',
        ],
      },
      { kind: 'h2', text: 'Buzdolabı' },
      {
        kind: 'ol',
        items: [
          'Taşınmadan en az 24 saat önce fişini çekip buzunu çözün.',
          'İç yüzeyleri kurulayın; nem koku ve küf yapar.',
          'Rafları çıkarın ya da sabitleyin.',
          'Cihazı mümkün olduğunca DİK taşıyın.',
          'Yeni adreste en az 4 saat dik bekletip sonra çalıştırın.',
        ],
      },
      {
        kind: 'note',
        title: 'Neden dik ve neden bekleme',
        text:
          'Yatık taşımada kompresör yağı soğutucu boruların içine kaçabilir. Cihazı dik bekletmek yağın kompresöre geri dönmesini sağlar; beklemeden çalıştırmak kompresörü kalıcı olarak bozabilir.',
      },
      { kind: 'h2', text: 'Bulaşık makinesi ve ankastre ürünler' },
      {
        kind: 'ul',
        items: [
          'Bulaşık makinesinde su giriş ve tahliye hortumlarını boşaltın.',
          'Ankastre fırını dolaptan çıkarırken elektriği panodan kesin.',
          'Cam kapaklı ürünlerde kapağı bantlayarak sabitleyin.',
          'Ocakta gaz bağlantısının sökülmesi ve yeniden yapılması yetkili kişiye bırakılmalıdır.',
        ],
      },
      { kind: 'h2', text: 'Yeni adreste' },
      {
        kind: 'p',
        text:
          'Cihazları yerleştirdikten sonra teraziye alın, bağlantıları yapın ve ilk çalıştırmada su kaçağı olup olmadığını gözle kontrol edin. Ankastre ürünlerin yeniden kurulumu için yetkili montaj hizmeti talep edebilirsiniz.',
      },
    ],
    faqs: [
      {
        q: 'Nakliye cıvatasını kaybettim, ne yapmalıyım?',
        a: 'Cıvata olmadan taşımayın. Yetkili servisten aynı modele uygun cıvata temin edilebilir; kısa mesafe de olsa cıvatasız taşıma tambur askısına zarar verir.',
      },
    ],
  },

  {
    slug: 'ankastre-firin-olculeri-ve-tezgah-uyumu',
    title: 'Ankastre Fırın Ölçüleri ve Tezgâh Uyumu',
    description:
      'Ankastre fırın niş ölçüleri, havalandırma boşluğu, kolon dolap yerleşimi ve elektrik hattı gereksinimleri. Ölçü hatasız montaj rehberi.',
    excerpt:
      'Fırın nişi kaç santim olmalı, havalandırma boşluğu neden şart, kolon dolap mı tezgâh altı mı — ölçüleri netleştiriyoruz.',
    category: 'Ankastre',
    tags: ['ankastre fırın', 'ölçü', 'niş', 'montaj'],
    publishedAt: '2026-08-20',
    relatedCategories: [{ label: 'Ankastre & Ocak Setleri', href: '/kategori/ankastre' }],
    blocks: [
      {
        kind: 'p',
        text:
          'Ankastre fırında montaj sorunlarının neredeyse tamamı ölçü hatasından çıkar. Fırının dış ölçüsü ile dolapta bırakılması gereken niş ölçüsü aynı şey değildir; aradaki fark havalandırma için gereklidir.',
      },
      { kind: 'h2', text: 'Standart niş ölçüleri' },
      {
        kind: 'table',
        head: ['Ölçü', 'Değer', 'Açıklama'],
        rows: [
          ['Niş genişliği', '560-568 mm', 'Fırın dış genişliği ~595 mm; kenarlar dolabın üstüne oturur.'],
          ['Niş yüksekliği', '590-600 mm', 'Kolon dolapta zeminden yüksekliği kullanıcıya göre ayarlanır.'],
          ['Niş derinliği', 'en az 550 mm', 'Kablo için arkada pay bırakılmalı.'],
          ['Havalandırma boşluğu', 'en az 30-50 cm²', 'Arka ya da alt kısımda açık kalmalı.'],
        ],
      },
      {
        kind: 'note',
        title: 'Havalandırma kapatılmamalı',
        text:
          'Fırının arkası tamamen kapatıldığında sıcak hava tahliye edilemez. Sonuç, elektronik kartın erken bozulması ve dolap yüzeylerinde ısıya bağlı deformasyondur.',
      },
      { kind: 'h2', text: 'Kolon dolap mı, tezgâh altı mı' },
      {
        kind: 'ul',
        items: [
          'Kolon dolap: fırın bel hizasında olur, eğilmeden kullanılır; küçük mutfakta dikey alan kazandırır.',
          'Tezgâh altı: klasik yerleşim, üstüne ocak gelir; tek parça set görünümü verir.',
          'Kolon dolapta fırın ile ocak ayrılır; bu durumda ocak için bağımsız kesim yapılır.',
        ],
      },
      { kind: 'h2', text: 'Elektrik gereksinimi' },
      {
        kind: 'p',
        text:
          'Ankastre fırın, yüksek güç çeken bir cihazdır ve topraklı, yeterli kesitte bağımsız bir hattan beslenmelidir. Uzatma kablosu ve çoklu priz kullanımı hem güvenlik riski hem de garanti kapsamı dışında kalma sebebidir.',
      },
    ],
    faqs: [
      {
        q: 'Fırınla ocak aynı dolapta olmak zorunda mı?',
        a: 'Hayır. Ankastre fırın ve ankastre ocak bağımsız cihazlardır. Fırını kolon dolaba, ocağı tezgâha ayrı ayrı yerleştirmek yaygın bir çözümdür.',
      },
      {
        q: 'Niş ölçüsünü nereden öğrenirim?',
        a: 'Her ürünün teknik belgesinde montaj çizimi bulunur. Dolapçıya bu çizimi vermek, sözlü ölçü aktarımından çok daha güvenlidir.',
      },
    ],
  },
]
