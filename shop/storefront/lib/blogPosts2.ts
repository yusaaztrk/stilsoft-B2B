import type { BlogPost } from '@/lib/blog'

/**
 * Yazı gövdeleri — 2. bölüm.
 *
 * Yazılar tek dosyada tutulmuyor: her biri uzun metin blokları içeriyor ve tek dosyada
 * biriktiklerinde dosya hem düzenlenemez hâle geliyor hem de tek bir yazıyı bulmak için
 * yüzlerce satır kaydırmak gerekiyor. Bölümler `blog.ts` içinde birleştiriliyor; okuma
 * tarafı tek liste görüyor.
 */
export const BLOG_POSTS_2: BlogPost[] = [
  {
    slug: 'ocak-secimi-induksiyon-cam-seramik-gazli',
    title: 'Ocak Seçimi: İndüksiyon, Cam Seramik ve Gazlı Karşılaştırması',
    description:
      'İndüksiyon, cam seramik ve gazlı ocak arasındaki farklar: ısınma hızı, enerji tüketimi, temizlik ve tencere uyumu. KKTC için ocak seçim rehberi.',
    excerpt:
      'Üç ocak tipini ısınma hızı, enerji, temizlik ve tencere uyumu başlıklarında karşılaştırıyoruz.',
    category: 'Ankastre',
    tags: ['ocak', 'indüksiyon', 'cam seramik', 'gazlı ocak'],
    publishedAt: '2026-09-01',
    relatedCategories: [{ label: 'Ankastre & Ocak Setleri', href: '/kategori/ankastre' }],
    blocks: [
      {
        kind: 'p',
        text:
          'Ocak seçimi, mutfakta en çok kullanılan cihaz olduğu için günlük alışkanlıkları doğrudan etkiler. Üç ana tip vardır ve hiçbiri diğerinin mutlak üstünü değildir; seçim, pişirme alışkanlığınıza ve mevcut tencerelerinize bağlıdır.',
      },
      { kind: 'h2', text: 'Üç tipin karşılaştırması' },
      {
        kind: 'table',
        head: ['Kriter', 'Gazlı', 'Cam seramik', 'İndüksiyon'],
        rows: [
          ['Isınma hızı', 'Hızlı', 'Orta', 'Çok hızlı'],
          ['Isı kontrolü', 'Anlık', 'Gecikmeli', 'Anlık ve kademeli'],
          ['Enerji verimi', 'Orta', 'Orta', 'Yüksek'],
          ['Temizlik', 'Zahmetli', 'Kolay', 'Kolay'],
          ['Tencere uyumu', 'Tümü', 'Tümü', 'Manyetik tabanlı'],
          ['Güvenlik', 'Açık alev', 'Sıcak yüzey', 'Yüzey az ısınır'],
        ],
      },
      { kind: 'h2', text: 'İndüksiyon nasıl çalışır' },
      {
        kind: 'p',
        text:
          'İndüksiyonda ocak yüzeyi değil, tencerenin tabanı ısınır. Manyetik alan doğrudan metalde ısı üretir, bu yüzden enerji kaybı düşüktür ve ocak yüzeyi yalnızca tencereden geri yansıyan ısıyla ılır. Tencere kaldırıldığında ısıtma anında durur.',
      },
      {
        kind: 'note',
        title: 'Tencere testi',
        text:
          'Elinizdeki tencerenin indüksiyona uygun olup olmadığını anlamanın en pratik yolu, tabanına bir mıknatıs tutmaktır. Mıknatıs yapışıyorsa tencere indüksiyonda çalışır.',
      },
      { kind: 'h2', text: 'Hangisi kime uygun' },
      {
        kind: 'ul',
        items: [
          'Wok ve açık alevle pişirmeye alışkınsanız: gazlı.',
          'Kolay temizlik ve düz tezgâh görünümü önceliğinizse: cam seramik.',
          'Hız, güvenlik ve enerji verimi arıyorsanız: indüksiyon.',
          'Elektrik kesintisi sık yaşanan bir konumdaysanız gazlı ocak yedek çözüm sunar.',
        ],
      },
    ],
    faqs: [
      {
        q: 'İndüksiyon ocak elektrik faturasını artırır mı?',
        a: 'Genellikle hayır. Isıyı doğrudan tencerede ürettiği için kayıp azdır ve aynı işi cam seramiğe göre daha kısa sürede yapar.',
      },
      {
        q: 'Cam seramik ocak çizilir mi?',
        a: 'Sert cisimlerle sürtme ve tencereyi kaydırarak taşıma çizik yapabilir. Tencereleri kaldırarak taşımak ve özel temizleyici kullanmak yüzeyi korur.',
      },
    ],
  },

  {
    slug: 'kahve-makinesi-rehberi',
    title: 'Kahve Makinesi Rehberi: Filtre, Espresso ve Türk Kahvesi',
    description:
      'Filtre kahve makinesi, espresso makinesi ve Türk kahvesi makinesi arasındaki farklar. Evde hangi kahve makinesi alınmalı?',
    excerpt:
      'Hangi kahveyi ne sıklıkla içtiğiniz alacağınız makineyi belirler. Üç ana tipi kullanım alışkanlığına göre ayırıyoruz.',
    category: 'Küçük Ev Aletleri',
    tags: ['kahve makinesi', 'espresso', 'filtre kahve', 'Türk kahvesi'],
    publishedAt: '2026-08-31',
    relatedCategories: [{ label: 'Çaycı & Kahve Makineleri', href: '/kategori/icecek-hazirlama' }],
    blocks: [
      {
        kind: 'p',
        text:
          'Kahve makinesi seçiminde en sık yapılan hata, en çok özelliği olan modeli almaktır. Oysa doğru soru şudur: evde en çok hangi kahve içiliyor? Cevap tek başına makine tipini belirler.',
      },
      { kind: 'h2', text: 'Türk kahvesi makinesi' },
      {
        kind: 'p',
        text:
          'Otomatik pişirme ve taşma kontrolü sunar. Günde birkaç fincan Türk kahvesi içilen evlerde ocakta cezve takip etme zorunluluğunu ortadan kaldırır. Kapasitesi genellikle 2-6 fincan arasındadır.',
      },
      { kind: 'h2', text: 'Filtre kahve makinesi' },
      {
        kind: 'p',
        text:
          'Aynı anda çok sayıda fincan hazırlamak için en pratik seçenektir. Sabah birden fazla kişinin kahve içtiği evlerde ve ofislerde tercih edilir. Kullanımı en basit, bakımı en az olan tiptir.',
      },
      { kind: 'h2', text: 'Espresso makinesi' },
      {
        kind: 'p',
        text:
          'Basınçla demleme yapar; espresso, americano, latte ve cappuccino hazırlamaya uygundur. Kapsüllü modeller kullanım kolaylığı, öğütücülü tam otomatik modeller ise tazelik ve kişiselleştirme sunar.',
      },
      {
        kind: 'table',
        head: ['Tip', 'Kime uygun', 'Bakım'],
        rows: [
          ['Türk kahvesi', 'Günlük Türk kahvesi içenler', 'Düşük'],
          ['Filtre', 'Kalabalık haneler, sabah kahvesi', 'Düşük'],
          ['Kapsüllü espresso', 'Hız ve pratiklik arayanlar', 'Orta (kapsül maliyeti)'],
          ['Tam otomatik espresso', 'Taze çekim ve çeşit isteyenler', 'Yüksek (kireç, öğütücü)'],
        ],
      },
      {
        kind: 'note',
        title: 'Kireç uyarısı',
        text:
          'Sert su, kahve makinelerinin en yaygın arıza sebebidir. Üretici talimatına göre düzenli kireç çözme işlemi yapmak cihaz ömrünü belirgin biçimde uzatır.',
      },
    ],
    faqs: [
      {
        q: 'Kapsüllü mü tam otomatik mi?',
        a: 'Az sayıda kahve içiliyor ve pratiklik önemliyse kapsüllü; günde birkaç fincan içiliyor ve çekirdek tazeliği önemliyse tam otomatik daha ekonomik olur.',
      },
    ],
  },

  {
    slug: 'blender-rondo-mutfak-robotu-farki',
    title: 'Blender, Rondo ve Mutfak Robotu Arasındaki Fark',
    description:
      'Blender, doğrayıcı rondo ve mutfak robotu ne işe yarar, hangisi hangi iş için alınır? Mutfak için doğru cihaz seçimi rehberi.',
    excerpt:
      'Üç cihaz birbirine benziyor ama farklı işler için üretildi. Hangisinin neyi iyi yaptığını ayırıyoruz.',
    category: 'Küçük Ev Aletleri',
    tags: ['blender', 'rondo', 'mutfak robotu', 'doğrayıcı'],
    publishedAt: '2026-08-30',
    relatedCategories: [{ label: 'Gıda Hazırlama & Blender', href: '/kategori/gida-hazirlama' }],
    blocks: [
      {
        kind: 'p',
        text:
          'Mutfak cihazları arasında en çok karıştırılan üçlü blender, rondo ve mutfak robotudur. Üçü de kesme ve karıştırma yapar, ancak tasarlandıkları iş farklıdır. Yanlış cihazı almak, ihtiyaç duyduğunuz işi hiç yapamamak anlamına gelebilir.',
      },
      { kind: 'h2', text: 'Blender' },
      {
        kind: 'p',
        text:
          'Sıvı ağırlıklı karışımlar için tasarlanmıştır: smoothie, çorba, meyve suyu, süt bazlı içecekler. Sürahi tipi ve el tipi (çubuk) olmak üzere iki biçimi vardır. El blenderi sıcak çorbayı tencerede çekmeye uygundur.',
      },
      { kind: 'h2', text: 'Rondo (doğrayıcı)' },
      {
        kind: 'p',
        text:
          'Kuru ve katı malzemeleri doğramak için üretilmiştir: soğan, maydanoz, ceviz, et. Haznesi küçüktür, bıçakları kısa ve keskindir. Sıvı işlerinde iyi sonuç vermez.',
      },
      { kind: 'h2', text: 'Mutfak robotu' },
      {
        kind: 'p',
        text:
          'Aparat değiştirilerek doğrama, rendeleme, dilimleme, hamur yoğurma ve çırpma yapabilen çok işlevli cihazdır. En geniş kullanım alanına sahiptir ancak en çok yer kaplayan ve en yüksek fiyatlı seçenektir.',
      },
      {
        kind: 'table',
        head: ['İş', 'Blender', 'Rondo', 'Mutfak robotu'],
        rows: [
          ['Smoothie / çorba', 'En iyi', 'Uygun değil', 'Kısmen'],
          ['Soğan doğrama', 'Uygun değil', 'En iyi', 'İyi'],
          ['Hamur yoğurma', 'Hayır', 'Hayır', 'En iyi'],
          ['Rendeleme / dilimleme', 'Hayır', 'Sınırlı', 'En iyi'],
          ['Tezgâhta kapladığı yer', 'Az', 'En az', 'Çok'],
        ],
      },
      {
        kind: 'note',
        title: 'Tek cihazla başlanacaksa',
        text:
          'Çoğu evde en sık ihtiyaç duyulan işler doğrama ve çorba çekmedir. Bu ikisini karşılayan el blenderi ve doğrayıcı hazneli setler, tek başına mutfak robotundan daha çok kullanılıyor.',
      },
    ],
    faqs: [
      {
        q: 'Mutfak robotu blenderin yerini tutar mı?',
        a: 'Kısmen. Çoğu robot blender haznesi aparatıyla gelir ama sıvı karışımlarda sürahi tipi blender kadar iyi sonuç vermez.',
      },
    ],
  },

  {
    slug: 'elektrikli-supurge-dikey-mi-torbali-mi',
    title: 'Elektrikli Süpürge: Dikey mi, Torbalı mı, Robot mu?',
    description:
      'Dikey şarjlı, torbalı, toz hazneli ve robot süpürge karşılaştırması. Ev tipine göre hangi elektrikli süpürge alınmalı?',
    excerpt:
      'Süpürge seçimi ev büyüklüğü, zemin tipi ve evcil hayvan varlığına göre değişir. Dört tipi karşılaştırıyoruz.',
    category: 'Ev Temizliği',
    tags: ['elektrikli süpürge', 'dikey süpürge', 'robot süpürge'],
    publishedAt: '2026-08-29',
    relatedCategories: [{ label: 'Süpürgeler & Buharlı Ütüler', href: '/kategori/ev-temizligi' }],
    blocks: [
      {
        kind: 'p',
        text:
          'Elektrikli süpürgede tek bir doğru seçim yoktur; evin büyüklüğü, zemin tipi ve kullanım sıklığı belirleyicidir. Dört ana tipin güçlü ve zayıf yanlarını bilmek, gereğinden pahalı ya da yetersiz bir cihaz almanızı önler.',
      },
      {
        kind: 'table',
        head: ['Tip', 'Güçlü yanı', 'Zayıf yanı'],
        rows: [
          ['Torbalı', 'Yüksek emiş, hijyenik boşaltma', 'Torba maliyeti, hacimli'],
          ['Toz hazneli', 'Torba maliyeti yok', 'Boşaltırken toz teması'],
          ['Dikey şarjlı', 'Hızlı kullanım, hafif, pratik', 'Sınırlı çalışma süresi'],
          ['Robot', 'Otomatik günlük temizlik', 'Köşe ve derin temizlikte yetersiz'],
        ],
      },
      { kind: 'h2', text: 'Ev tipine göre öneri' },
      {
        kind: 'ul',
        items: [
          'Küçük daire, hızlı günlük temizlik: dikey şarjlı.',
          'Geniş ev, halı ağırlıklı zemin: torbalı ya da yüksek emişli toz hazneli.',
          'Evcil hayvan varsa: HEPA filtreli ve tüy toplayıcı başlıklı model.',
          'Gün içinde evde kimse yoksa: robot süpürge ve haftalık derin temizlik için ikinci cihaz.',
        ],
      },
      { kind: 'h2', text: 'Filtre neden önemli' },
      {
        kind: 'p',
        text:
          'Süpürgenin emdiği tozun bir kısmı, filtre yeterli değilse motordan geçip odaya geri verilir. HEPA sınıfı filtreler ince partikülleri tutar; alerjisi olan hanelerde bu, emiş gücünden daha belirleyici bir özelliktir.',
      },
    ],
    faqs: [
      {
        q: 'Robot süpürge diğer süpürgenin yerini tutar mı?',
        a: 'Günlük toz alma işini büyük ölçüde üstlenir ancak köşeler, merdiven ve derin halı temizliği için ikinci bir süpürge gerekir.',
      },
      {
        q: 'Dikey süpürgede kaç dakika çalışma süresi yeterli?',
        a: 'Orta büyüklükte bir daire için 30-40 dakika yeterlidir. Turbo modda süre belirgin biçimde kısalır, bunu hesaba katın.',
      },
    ],
  },

  {
    slug: 'buharli-utu-ve-utu-sistemleri',
    title: 'Buharlı Ütü ve Ütü Sistemleri: Hangisi Alınmalı?',
    description:
      'Buharlı ütü, buhar kazanlı ütü sistemi ve dikey buhar farkları. Basınç, buhar debisi ve taban tipi nasıl seçilir?',
    excerpt:
      'Bar, gram/dakika ve taban malzemesi gibi teknik değerler ne anlama geliyor? Ütü seçimini sadeleştiriyoruz.',
    category: 'Ev Temizliği',
    tags: ['ütü', 'buharlı ütü', 'ütü sistemi'],
    publishedAt: '2026-08-28',
    relatedCategories: [{ label: 'Süpürgeler & Buharlı Ütüler', href: '/kategori/ev-temizligi' }],
    blocks: [
      {
        kind: 'p',
        text:
          'Ütüde performansı belirleyen üç değer vardır: buhar basıncı, buhar debisi ve taban malzemesi. Bu üçü anlaşıldığında farklı fiyat seviyelerindeki modeller arasındaki fark da netleşir.',
      },
      { kind: 'h2', text: 'Teknik değerler ne anlama geliyor' },
      {
        kind: 'ul',
        items: [
          'Basınç (bar): buharın kumaşa ne kadar derin işlediğini belirler. Kazanlı sistemlerde 5-7 bar yaygındır.',
          'Sürekli buhar (g/dk): dakikada verilen buhar miktarı. 40 g/dk üzeri günlük kullanım için rahattır.',
          'Şok buhar (g/dk): inatçı kırışıklıklar için anlık buhar. 150 g/dk ve üzeri etkilidir.',
          'Taban: seramik kolay kayar, paslanmaz dayanıklıdır, döküm alüminyum ısıyı eşit dağıtır.',
        ],
      },
      { kind: 'h2', text: 'Buhar kazanlı sistem ne zaman mantıklı' },
      {
        kind: 'p',
        text:
          'Haftada bir kez ve uzun süre ütü yapılan hanelerde kazanlı sistem belirgin fark yaratır: su haznesi büyüktür, basınç yüksektir ve aynı sürede daha çok parça ütülenir. Az miktarda ve sık ütü yapılan evlerde ise klasik buharlı ütü yeterlidir.',
      },
      {
        kind: 'note',
        title: 'Kireç',
        text:
          'Ütüde en sık görülen sorun, taban deliklerinden kireç parçacığı gelmesidir. Kireç toplama kartuşu ya da otomatik temizleme özelliği olan modeller bu sorunu büyük ölçüde önler.',
      },
    ],
    faqs: [
      {
        q: 'Dikey buhar özelliği ne işe yarar?',
        a: 'Askıdaki kıyafeti, perdeyi ya da ceketi ütü masasına sermeden buharla düzeltmenizi sağlar. Takım elbise ve perde kullanımı çok olan evlerde işe yarar.',
      },
    ],
  },

  {
    slug: 'su-isiticisi-ve-cayci-secimi',
    title: 'Su Isıtıcısı ve Çaycı Seçimi',
    description:
      'Su ısıtıcısı ve çay makinesi seçerken kapasite, gövde malzemesi, ısı ayarı ve güvenlik özellikleri nasıl değerlendirilir?',
    excerpt:
      'Cam mı çelik mi, kaç litre, hangi güvenlik özellikleri şart? Su ısıtıcısı ve çaycı seçiminde pratik kriterler.',
    category: 'Küçük Ev Aletleri',
    tags: ['su ısıtıcısı', 'kettle', 'çay makinesi', 'çaycı'],
    publishedAt: '2026-08-27',
    relatedCategories: [{ label: 'Çaycı & Kahve Makineleri', href: '/kategori/icecek-hazirlama' }],
    blocks: [
      {
        kind: 'p',
        text:
          'Su ısıtıcısı ve çay makinesi, evde en sık çalıştırılan küçük ev aletleridir. Bu yüzden seçimde dayanıklılık ve temizlik kolaylığı, ek özelliklerden daha önemlidir.',
      },
      { kind: 'h2', text: 'Gövde malzemesi' },
      {
        kind: 'ul',
        items: [
          'Paslanmaz çelik: dayanıklı, darbeye karşı güçlü, dış yüzey ısınabilir.',
          'Cam: su seviyesi görünür, kireç birikimi hemen fark edilir.',
          'Plastik: en hafif ve ekonomik; gıdaya uygun malzeme olması önemlidir.',
        ],
      },
      { kind: 'h2', text: 'Kapasite' },
      {
        kind: 'p',
        text:
          'Su ısıtıcılarında 1,7 litre en yaygın kapasitedir ve çoğu hane için yeterlidir. Çay makinelerinde demlik hacmi önemlidir: kalabalık hanelerde 1 litre ve üzeri demlik, gün içinde tekrar tekrar demleme ihtiyacını azaltır.',
      },
      { kind: 'h2', text: 'Aranması gereken güvenlik özellikleri' },
      {
        kind: 'ol',
        items: [
          'Susuz çalışma koruması: hazne boşken cihaz kendini kapatır.',
          'Otomatik kapanma: su kaynadığında durur.',
          'Gizli rezistans: kireç temizliğini kolaylaştırır, ısıtıcıyı korur.',
          'Kilitli kapak: dökülmeyi önler.',
        ],
      },
      {
        kind: 'note',
        title: 'Kireç temizliği',
        text:
          'Ayda bir kez su ve sirke karışımıyla kaynatıp durulamak hem ısıtma süresini kısaltır hem cihaz ömrünü uzatır. Cam modellerde kireç görünür olduğu için zamanlamayı kaçırmazsınız.',
      },
    ],
  },

  {
    slug: 'kktc-beyaz-esya-montaj-sureci',
    title: 'KKTC’de Beyaz Eşya Montajı Nasıl İşler?',
    description:
      'KKTC’de beyaz eşya ve ankastre montaj süreci: randevu, teslimat, kurulum öncesi hazırlık ve montaj sırasında yapılan işlemler.',
    excerpt:
      'Siparişten kuruluma adım adım: montaj ne zaman seçilir, teknisyen gelmeden önce ne hazır olmalı, kurulumda ne yapılır.',
    category: 'Servis & Montaj',
    tags: ['montaj', 'kurulum', 'teslimat', 'KKTC'],
    publishedAt: '2026-08-26',
    relatedCategories: [{ label: 'Ankastre & Ocak Setleri', href: '/kategori/ankastre' }],
    blocks: [
      {
        kind: 'p',
        text:
          'Beyaz eşyada teslimat ile montaj iki ayrı iştir. Ürünün adrese ulaşması teslimat, kurulup çalışır hâle getirilmesi ise montajdır. Bu ayrımı bilmek, süreçte beklenmedik gecikmeleri önler.',
      },
      { kind: 'h2', text: 'Adım adım süreç' },
      {
        kind: 'ol',
        items: [
          'Sipariş sırasında montaj seçeneği işaretlenir. Seçilmezse montaj kaydı açılmaz ve bedel tahsil edilmez.',
          'Ödeme onaylandığında sipariş kaydı oluşur; montajlı ürünler kargoya verilmez, montaj ekibiyle gönderilir.',
          'Montaj ekibi randevu için iletişime geçer.',
          'Belirlenen günde ürün adrese getirilir ve kurulum yapılır.',
          'Kurulum sonrası cihaz çalıştırılarak test edilir ve teslim edilir.',
        ],
      },
      { kind: 'h2', text: 'Teknisyen gelmeden önce hazır olması gerekenler' },
      {
        kind: 'ul',
        items: [
          'Ankastre ürünlerde dolap boşluğu ölçüsünde ve hazır olmalı.',
          'Elektrik prizi çekilmiş, topraklama yapılmış olmalı.',
          'Su bağlantısı gerektiren ürünlerde musluk ve gider hazır olmalı.',
          'Davlumbaz için baca çıkışı ya da karbon filtreli kullanım kararı verilmiş olmalı.',
          'Ürünün geçeceği kapı ve koridor genişliği kontrol edilmeli.',
        ],
      },
      {
        kind: 'note',
        title: 'Neden önemli',
        text:
          'Bu hazırlıklar tamamlanmadığında montaj ikinci bir randevuya kalır. Ekip aynı gün başka adreslere de gittiği için ikinci randevu genellikle birkaç gün sonrasına düşer.',
      },
      { kind: 'h2', text: 'Montaj sırasında yapılanlar' },
      {
        kind: 'p',
        text:
          'Ürün yerine yerleştirilir, terazilenir, elektrik ve varsa su bağlantıları yapılır. Ardından cihaz çalıştırılarak temel fonksiyon testi yapılır: fırında ısıtma, çamaşır makinesinde su alma ve tahliye, bulaşık makinesinde kaçak kontrolü gibi.',
      },
    ],
    faqs: [
      {
        q: 'Montajı kendim ayarlayabilir miyim?',
        a: 'Ürünün garantisi açısından kurulumun yetkili ekip tarafından yapılması önerilir. Özellikle gaz bağlantısı ve ankastre kurulumlarda yetkili montaj şarttır.',
      },
      {
        q: 'Montaj hangi bölgelerde yapılıyor?',
        a: 'Lefkoşa, Girne, Gazimağusa, Güzelyurt ve İskele başta olmak üzere KKTC genelinde montaj hizmeti veriliyor.',
      },
    ],
  },
]
