import type { BlogPost } from '@/lib/blog'

/**
 * YAZI GÖVDELERİ.
 *
 * `blog.ts`ten AYRI dosya: orası tip ve yardımcı fonksiyon, burası içerik. Tek dosyada
 * dursaydı her yeni yazıda mantık kodunun ortasına metin eklenirdi ve dosya okunmaz hâle
 * gelirdi.
 *
 * <b>Yazı eklerken:</b> `slug` bir daha DEĞİŞMEZ (adres değişirse Google'daki sıra sıfırlanır,
 * eski adres 404 verir). `description` 150-160 karakter, cümle hâlinde ve ana anahtar
 * kelimeyi içersin. `faqs` alanı doldurulursa sayfa ayrıca FAQPage şeması üretir.
 */
export const BLOG_POSTS_1: BlogPost[] = [
  {
    slug: 'kktc-yeni-evlilere-beyaz-esya-paketi-rehberi',
    title: 'KKTC’de Yeni Evlenenler İçin Beyaz Eşya Paketi Rehberi',
    description:
      'KKTC’de yeni evlenen çiftler için beyaz eşya ve ankastre paketi listesi: hangi ürün önce alınmalı, ölçüler, montaj sırası ve bütçe planı.',
    excerpt:
      'Çeyiz listesini sıfırdan kuranlar için: hangi ürün gerçekten şart, hangisi sonraya bırakılabilir, ankastre mi solo mu ve KKTC’de montaj nasıl planlanır.',
    category: 'Rehber',
    tags: ['yeni evli', 'çeyiz', 'beyaz eşya', 'ankastre set', 'KKTC'],
    publishedAt: '2026-09-08',
    relatedCategories: [
      { label: 'Ankastre & Ocak Setleri', href: '/kategori/ankastre' },
      { label: 'Soğutma & Beyaz Eşya', href: '/kategori/buzdolabi' },
    ],
    blocks: [
      {
        kind: 'p',
        text:
          'Yeni bir eve taşınırken en çok yapılan hata, listeyi ürün ürün değil oda oda kurmaktır. Mutfağı bir bütün olarak planlamadan alınan ocak, fırın ve davlumbaz çoğu zaman birbirine uymaz; tezgâh kesildikten sonra ölçü değiştirmek de mümkün olmaz. Bu rehber, KKTC’de ilk evini kuran çiftler için sıralamayı ve ölçüleri netleştirmek üzere hazırlandı.',
      },
      { kind: 'h2', text: 'Önce ölçü, sonra ürün' },
      {
        kind: 'p',
        text:
          'Mutfak dolabı siparişi verilmeden önce ankastre ürünlerin modelleri belli olmalıdır. Dolapçı, fırın ve ocak için bırakacağı boşluğu ürünün teknik çizimine göre açar. Sıralama tersine döndüğünde, yani önce dolap yapılıp sonra ürün seçildiğinde, seçenekler standart dışı ölçülere sıkışır ve fiyat yükselir.',
      },
      {
        kind: 'ol',
        items: [
          'Mutfak planı ve tezgâh yerleşimi çizilir.',
          'Ankastre fırın, ocak ve davlumbaz modelleri seçilir; teknik ölçüler dolapçıya verilir.',
          'Dolap ve tezgâh üretilir, ankastre boşlukları açılır.',
          'Ürünler teslim alınır, montaj randevusu planlanır.',
          'Solo ürünler (buzdolabı, çamaşır makinesi) yerleşim sonrası konumlandırılır.',
        ],
      },
      {
        kind: 'note',
        title: 'Sık yapılan hata',
        text:
          'Davlumbaz çoğu zaman en sona bırakılır. Oysa baca çıkışı, dolap üstü boşluk ve elektrik hattı mutfak yapılırken belirlenir. Davlumbaz kararını fırın ve ocakla aynı anda verin.',
      },
      { kind: 'h2', text: 'Öncelik listesi: önce ne alınmalı' },
      {
        kind: 'p',
        text:
          'Bütçeyi tek seferde kapatmak zorunda değilsiniz. Aşağıdaki sıralama, eve taşındığınız ilk günden itibaren yaşamı mümkün kılan ürünlerden başlar ve konfor ürünleriyle biter.',
      },
      {
        kind: 'table',
        head: ['Öncelik', 'Ürün', 'Neden bu sırada'],
        rows: [
          ['1', 'Buzdolabı', 'Taşınmanın ilk gününden itibaren zorunlu; ertelenemez.'],
          ['2', 'Çamaşır makinesi', 'Su ve gider bağlantısı taşınma sırasında yapılmalı.'],
          ['3', 'Ankastre fırın + ocak', 'Mutfak dolabıyla birlikte planlanmak zorunda.'],
          ['4', 'Davlumbaz', 'Baca ve elektrik hattı mutfak yapılırken belirleniyor.'],
          ['5', 'Bulaşık makinesi', 'Yeri baştan ayrılmazsa sonradan eklemek zor.'],
          ['6', 'Küçük ev aletleri', 'Sonradan tamamlanabilir; acil değil.'],
        ],
      },
      { kind: 'h2', text: 'Ankastre mi, solo mu?' },
      {
        kind: 'p',
        text:
          'Ankastre ürünler dolaba gömülür ve mutfakla bütünleşik görünür; solo ürünler bağımsız durur. Ankastrenin avantajı görünüm ve alan kazancıdır, dezavantajı ise değiştirirken aynı ölçüde model aramak zorunda kalmanızdır. İlk evinde uzun süre oturmayı planlamayan çiftler için solo ürünler daha esnek bir seçim olabilir.',
      },
      {
        kind: 'ul',
        items: [
          'Ankastre: bütünleşik görünüm, tezgâh altı düzen, sabit ölçü zorunluluğu.',
          'Solo: taşınırken birlikte götürülebilir, ölçü esnekliği yüksek.',
          'Karma çözüm: ankastre fırın + solo buzdolabı en sık tercih edilen düzen.',
        ],
      },
      { kind: 'h2', text: 'KKTC’de teslimat ve montaj nasıl işliyor' },
      {
        kind: 'p',
        text:
          'Lefkoşa, Girne, Gazimağusa, Güzelyurt ve İskele genelinde teslimat yapılır. Montaj gerektiren ürünlerde kurulum, teslimattan ayrı bir randevuyla ve yetkili teknisyen ekibiyle yapılır. Sipariş sırasında montaj seçeneğini işaretlemeniz, ekibin ürünü size getirirken kurulum için de hazırlıklı gelmesini sağlar.',
      },
      {
        kind: 'note',
        title: 'Montaj öncesi hazırlık',
        text:
          'Ankastre ürünlerde dolap boşluğunun hazır, elektrik prizinin çekilmiş ve su giderinin açılmış olması gerekir. Bunlar hazır değilse montaj ikinci bir randevuya kalır.',
      },
      { kind: 'h2', text: 'Bütçeyi doğru dağıtmak' },
      {
        kind: 'p',
        text:
          'Toplam bütçenin yaklaşık yarısını buzdolabı, çamaşır makinesi ve ankastre üçlüsüne ayırmak dengeli bir dağılımdır. Küçük ev aletlerini tek seferde tamamlamak yerine, gerçekten kullandığınız üç dört üründen başlamak hem israfı hem de mutfak tezgâhındaki kalabalığı önler.',
      },
    ],
    faqs: [
      {
        q: 'Ankastre set almadan önce mutfak dolabını yaptırabilir miyim?',
        a: 'Yaptırmamak daha doğru. Dolapçı, fırın ve ocak boşluğunu ürünün teknik ölçüsüne göre açar. Ürünleri önce seçip ölçüleri dolapçıya vermek, sonradan ölçü uyuşmazlığı yaşamanızı engeller.',
      },
      {
        q: 'Yeni evliler için en az kaç parça beyaz eşya gerekir?',
        a: 'Buzdolabı, çamaşır makinesi, fırın ve ocak dört temel üründür. Bulaşık makinesi ve davlumbaz kısa sürede eklenir; küçük ev aletleri zamana yayılabilir.',
      },
      {
        q: 'Montaj ücreti ürün fiyatına dahil mi?',
        a: 'Montaj gerektiren ürünlerde kurulum ayrı bir hizmet olarak sunulur ve sipariş sırasında seçilir. Seçmediğinizde montaj bedeli tahsil edilmez ve montaj kaydı açılmaz.',
      },
    ],
  },

  {
    slug: 'ankastre-set-nasil-secilir',
    title: 'Ankastre Set Nasıl Seçilir? Ölçü, Uyum ve Montaj Rehberi',
    description:
      'Ankastre fırın, ocak ve davlumbaz seçerken bakılması gereken ölçüler, enerji sınıfı ve montaj koşulları. KKTC’de ankastre set alırken dikkat edilecekler.',
    excerpt:
      'Ankastre set alırken en kritik konu marka değil ölçü uyumu. Fırın nişi, ocak kesim ölçüsü ve davlumbaz genişliğini adım adım açıklıyoruz.',
    category: 'Ankastre',
    tags: ['ankastre', 'fırın', 'ocak', 'davlumbaz', 'ölçü'],
    publishedAt: '2026-09-07',
    relatedCategories: [{ label: 'Ankastre & Ocak Setleri', href: '/kategori/ankastre' }],
    blocks: [
      {
        kind: 'p',
        text:
          'Ankastre set, fırın–ocak–davlumbaz üçlüsünün birlikte planlanmasıdır. Üçünü ayrı ayrı almak mümkündür ancak set olarak alındığında hem görünüm bütünlüğü sağlanır hem de ölçü uyumsuzluğu riski ortadan kalkar. Bu yazıda satın almadan önce kesinleşmesi gereken teknik başlıkları sıraladık.',
      },
      { kind: 'h2', text: 'Standart ölçüler' },
      {
        kind: 'p',
        text:
          'Ankastre ürünlerde ölçüler büyük ölçüde standarttır; asıl fark, dolapta bırakılan niş ölçüsündedir. Aşağıdaki değerler sektörde en yaygın kullanılanlardır ve mutfak planı yapılırken referans alınabilir.',
      },
      {
        kind: 'table',
        head: ['Ürün', 'Ürün genişliği', 'Dolapta bırakılacak niş'],
        rows: [
          ['Ankastre fırın', '~59,5 cm', '60 cm genişlik, 59-60 cm yükseklik, 55 cm derinlik'],
          ['Ankastre ocak (4 gözlü)', '~58 x 50 cm', 'Tezgâh kesimi ~56 x 48 cm'],
          ['Davlumbaz (duvar tipi)', '60 veya 90 cm', 'Ocak genişliğine eşit ya da bir kademe geniş'],
          ['Ankastre bulaşık makinesi', '~59,8 cm', '60 cm genişlik, 82-87 cm yükseklik'],
        ],
      },
      {
        kind: 'note',
        title: 'Kesim ölçüsü ürün ölçüsü değildir',
        text:
          'Ocakta tezgâha açılan delik, ürünün dış ölçüsünden küçüktür; ürün kenarları tezgâhın üstüne oturur. Dolapçıya ürünün dış ölçüsünü değil, teknik belgedeki kesim ölçüsünü verin.',
      },
      { kind: 'h2', text: 'Fırın seçerken bakılacaklar' },
      {
        kind: 'ul',
        items: [
          'Hacim: 60-70 litre aralığı dört kişilik aile için yeterlidir.',
          'Isıtma tipi: turbo fanlı fırınlar ısıyı daha eşit dağıtır, çok katlı pişirmeye uygundur.',
          'Temizlik: katalitik ve pirolitik temizlik seçenekleri bakım süresini kısaltır.',
          'Kapak camı: üç katlı cam dış yüzey sıcaklığını düşürür, çocuklu evlerde önemlidir.',
          'Enerji sınıfı: uzun vadede fatura farkı yaratan tek teknik başlık.',
        ],
      },
      { kind: 'h2', text: 'Ocak: gazlı, cam seramik, indüksiyon' },
      {
        kind: 'p',
        text:
          'Üç seçeneğin de yerinde olduğu durumlar vardır. Gazlı ocak alışkanlığı en yaygın olan seçenektir; cam seramik temizlik kolaylığı sunar; indüksiyon ise en hızlı ısınan ve en kontrollü olanıdır ancak tabanı manyetik tencere gerektirir.',
      },
      {
        kind: 'table',
        head: ['Tip', 'Güçlü yanı', 'Dikkat edilecek'],
        rows: [
          ['Gazlı', 'Alışılmış kullanım, anlık ısı kontrolü', 'Temizliği daha zahmetli'],
          ['Cam seramik', 'Düz yüzey, kolay temizlik', 'Isınma ve soğuma daha yavaş'],
          ['İndüksiyon', 'En hızlı ısınma, düşük enerji kaybı', 'Manyetik tabanlı tencere şart'],
        ],
      },
      { kind: 'h2', text: 'Davlumbaz genişliği' },
      {
        kind: 'p',
        text:
          'Davlumbaz, ocakla en az aynı genişlikte olmalıdır. 60 cm ocak için 60 cm davlumbaz yeterlidir; ancak emiş performansını artırmak isteyenler 90 cm modeli tercih edebilir. Ocakla davlumbaz arasındaki mesafe genellikle 65-75 cm arasında bırakılır.',
      },
      { kind: 'h2', text: 'Montaj koşulları' },
      {
        kind: 'ul',
        items: [
          'Fırın için topraklı ve yeterli amperajda bağımsız hat gerekir.',
          'Davlumbaz için baca çıkışı ya da karbon filtreli kullanım kararı önceden verilmelidir.',
          'Ocak gazlı ise gaz hattı bağlantısı yetkili kişi tarafından yapılmalıdır.',
          'Tezgâh kesimi montajdan önce tamamlanmış olmalıdır.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Ankastre fırın ve ocak aynı markadan mı olmalı?',
        a: 'Teknik olarak zorunlu değil; fırın ve ocak birbirinden bağımsız çalışır. Ancak aynı seriden seçildiğinde panel tasarımı, kulp ve renk uyumu sağlanır.',
      },
      {
        q: 'Davlumbaz bacasız kullanılabilir mi?',
        a: 'Evet. Baca çıkışı olmayan mutfaklarda karbon filtreli kullanım tercih edilir. Bu durumda filtrelerin düzenli değiştirilmesi gerekir.',
      },
      {
        q: 'İndüksiyon ocakta mevcut tencerelerim çalışır mı?',
        a: 'Tabanı manyetik olan tencereler çalışır. Kontrol etmek için tencerenin tabanına mıknatıs tutmanız yeterlidir; yapışıyorsa uyumludur.',
      },
    ],
  },

  {
    slug: 'buzdolabi-secimi-kktc',
    title: 'Buzdolabı Seçimi: Litre, No-Frost ve KKTC İklimi',
    description:
      'KKTC’de buzdolabı seçerken litre hesabı, No-Frost teknolojisi, iklim sınıfı ve enerji tüketimi. Sıcak iklimde doğru buzdolabı nasıl seçilir?',
    excerpt:
      'Ada iklimi buzdolabı seçimini doğrudan etkiliyor. İklim sınıfı, litre hesabı ve No-Frost farkını sade biçimde anlatıyoruz.',
    category: 'Beyaz Eşya',
    tags: ['buzdolabı', 'no-frost', 'enerji', 'KKTC'],
    publishedAt: '2026-09-06',
    relatedCategories: [{ label: 'Soğutma & Beyaz Eşya', href: '/kategori/buzdolabi' }],
    blocks: [
      {
        kind: 'p',
        text:
          'Buzdolabı, evdeki tek 7 gün 24 saat çalışan cihazdır. Bu yüzden seçim yalnızca fiyatla değil, enerji tüketimi ve iklim uyumuyla birlikte yapılmalıdır. KKTC gibi yaz sıcaklıklarının uzun sürdüğü bir coğrafyada iklim sınıfı, çoğu kişinin atladığı ama en belirleyici teknik başlıktır.',
      },
      { kind: 'h2', text: 'İklim sınıfı neden önemli' },
      {
        kind: 'p',
        text:
          'Her buzdolabı belirli bir ortam sıcaklığı aralığında verimli çalışacak şekilde üretilir. Bu aralık iklim sınıfı olarak etikette yazar. Ortam sıcaklığı sınıfın üst değerini aştığında motor daha uzun süre çalışır, enerji tüketimi artar ve soğutma performansı düşer.',
      },
      {
        kind: 'table',
        head: ['Sınıf', 'Uygun ortam sıcaklığı', 'Değerlendirme'],
        rows: [
          ['SN', '+10 °C – +32 °C', 'Serin iklimler için; ada yazına dar gelir.'],
          ['N', '+16 °C – +32 °C', 'Ilıman iklim; yaz aylarında zorlanabilir.'],
          ['ST', '+16 °C – +38 °C', 'Sıcak iklimler için uygun.'],
          ['T', '+16 °C – +43 °C', 'Tropikal; en geniş çalışma aralığı.'],
        ],
      },
      {
        kind: 'note',
        title: 'KKTC için öneri',
        text:
          'Yaz aylarında mutfak içi sıcaklığın kolayca 35 °C üzerine çıktığı düşünüldüğünde ST veya T sınıfı bir cihaz, N sınıfına göre hem daha az arıza hem de daha düşük fatura anlamına gelir.',
      },
      { kind: 'h2', text: 'Kaç litre yeterli' },
      {
        kind: 'p',
        text:
          'Litre ihtiyacı hane halkı sayısıyla doğrudan ilişkilidir. Aşağıdaki değerler pratikte işe yarayan bir başlangıç noktasıdır; sık misafir ağırlayan ya da haftalık toplu alışveriş yapan haneler bir üst kademeyi tercih edebilir.',
      },
      {
        kind: 'table',
        head: ['Hane', 'Önerilen toplam hacim'],
        rows: [
          ['1-2 kişi', '250-350 litre'],
          ['3-4 kişi', '350-500 litre'],
          ['5 kişi ve üzeri', '500 litre ve üzeri'],
        ],
      },
      { kind: 'h2', text: 'No-Frost ne işe yarar' },
      {
        kind: 'p',
        text:
          'No-Frost sistemli dolaplarda soğuk hava fanla dolaştırılır ve dondurucuda buzlanma oluşmaz. Bunun iki pratik sonucu vardır: buz çözme işlemi ortadan kalkar ve dolap içindeki sıcaklık daha dengeli kalır. Buna karşılık hava sirkülasyonu, ambalajsız gıdaların yüzeyini daha hızlı kurutabilir.',
      },
      {
        kind: 'ul',
        items: [
          'No-Frost: buz çözme derdi yok, sıcaklık dengeli, bakım kolay.',
          'Statik: genellikle daha uygun fiyatlı, nem oranı daha yüksek.',
          'Karma sistemler: soğutucuda statik, dondurucuda No-Frost.',
        ],
      },
      { kind: 'h2', text: 'Yerleştirme kuralları' },
      {
        kind: 'ul',
        items: [
          'Arka ve yan taraflarda en az 5 cm hava boşluğu bırakın.',
          'Fırın, radyatör ve doğrudan güneş alan pencerelerin yanına koymayın.',
          'Nakliyeden sonra en az 4 saat bekletip öyle çalıştırın.',
          'Zemin düz değilse ayaklarından terazileyin; kapak tam kapanmazsa enerji tüketimi artar.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Buzdolabını taşıdıktan sonra neden hemen çalıştırmamalıyım?',
        a: 'Taşıma sırasında kompresör yağı soğutucu devreye kaçabilir. Cihazı dik konumda birkaç saat bekletmek, yağın yerine dönmesini sağlar ve kompresörü korur.',
      },
      {
        q: 'Enerji sınıfı farkı gerçekten faturaya yansır mı?',
        a: 'Yansır. Buzdolabı sürekli çalışan bir cihaz olduğu için yıllık tüketim farkı, ilk alımdaki fiyat farkını birkaç yıl içinde kapatabilir.',
      },
    ],
  },

  {
    slug: 'airfryer-nasil-secilir',
    title: 'Airfryer Nasıl Seçilir? Litre, Güç ve Kullanım Rehberi',
    description:
      'Airfryer seçerken kaç litre almalı, kaç watt yeterli, tek sepet mi çift sepet mi? Aile büyüklüğüne göre airfryer seçim rehberi.',
    excerpt:
      'Airfryer alırken en sık sorulan soru litre. Aile büyüklüğüne göre kapasite, güç ve sepet tipini karşılaştırıyoruz.',
    category: 'Küçük Ev Aletleri',
    tags: ['airfryer', 'fritöz', 'küçük ev aletleri'],
    publishedAt: '2026-09-05',
    relatedCategories: [{ label: 'Gıda Hazırlama & Blender', href: '/kategori/gida-hazirlama' }],
    blocks: [
      {
        kind: 'p',
        text:
          'Airfryer, sıcak havayı yüksek hızda dolaştırarak yiyeceğin dışını kızartma benzeri bir dokuda pişiren cihazdır. Yağ kullanımını büyük ölçüde azaltır ve ön ısıtma süresi fırına göre çok kısadır. Doğru modeli seçmek için üç başlığa bakmak yeterlidir: kapasite, güç ve sepet düzeni.',
      },
      { kind: 'h2', text: 'Kapasite: kaç litre almalı' },
      {
        kind: 'p',
        text:
          'Litre değeri sepetin hacmini gösterir, pişirilen yiyeceğin ağırlığını değil. Airfryer’da yiyecekler tek katman hâlinde yayıldığında düzgün pişer; üst üste doldurulduğunda hava dolaşımı engellenir ve sonuç beklenenin altında kalır.',
      },
      {
        kind: 'table',
        head: ['Kişi sayısı', 'Önerilen kapasite', 'Not'],
        rows: [
          ['1-2 kişi', '3-4,5 litre', 'Tek öğün için yeterli, tezgâhta az yer kaplar.'],
          ['3-4 kişi', '5-6,5 litre', 'En yaygın kullanılan aralık.'],
          ['5 kişi ve üzeri', '7 litre ve üzeri', 'Çift sepetli modeller avantajlı.'],
        ],
      },
      { kind: 'h2', text: 'Güç ve pişirme süresi' },
      {
        kind: 'p',
        text:
          'Çoğu model 1400-2000 watt aralığındadır. Daha yüksek güç, daha hızlı ön ısıtma ve daha kısa pişirme süresi demektir. Ancak yüksek güç tek başına iyi sonuç garantisi değildir; hava dolaşımı tasarımı en az güç kadar belirleyicidir.',
      },
      { kind: 'h2', text: 'Tek sepet mi, çift sepet mi' },
      {
        kind: 'ul',
        items: [
          'Tek sepet: daha uygun fiyatlı, tezgâhta daha az yer kaplar, tek çeşit yemek için yeterli.',
          'Çift sepet: ana yemek ve garnitür aynı anda, farklı sıcaklıklarda pişirilebilir.',
          'Fırın tipi: rafları olan, daha büyük hacimli modeller; airfryer ve mini fırın işlevini birleştirir.',
        ],
      },
      {
        kind: 'note',
        title: 'Temizlik detayı',
        text:
          'Sepet ve ızgaranın bulaşık makinesinde yıkanabilir olması, cihazın uzun ömürlü kullanılmasında en belirleyici pratik özelliktir. Elde yıkanması gereken modeller zamanla daha az kullanılıyor.',
      },
      { kind: 'h2', text: 'Kullanım ipuçları' },
      {
        kind: 'ol',
        items: [
          'Cihazı 3-5 dakika ön ısıtın; ilk parti daha eşit pişer.',
          'Sepeti tek katman dolduracak kadar doldurun.',
          'Pişirme ortasında sepeti bir kez sallayın.',
          'Yağsız pişirmede bir tatlı kaşığı sıvı yağ, dış dokuyu belirgin biçimde iyileştirir.',
          'Her kullanımdan sonra sepeti temizleyin; birikmiş yağ koku yapar.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Airfryer fırının yerini tutar mı?',
        a: 'Küçük porsiyonlarda ve kızartma benzeri sonuçlarda evet. Ancak büyük hacimli pişirme, hamur işi ve çok katlı tepsi kullanımı için fırın gerekir.',
      },
      {
        q: 'Airfryer çok elektrik harcar mı?',
        a: 'Gücü yüksek olsa da çalışma süresi kısa olduğu için toplam tüketimi genellikle fırından düşüktür. Küçük porsiyonlarda fırına göre belirgin tasarruf sağlar.',
      },
    ],
  },

  {
    slug: 'davlumbaz-secimi-bacali-bacasiz',
    title: 'Davlumbaz Seçimi: Bacalı mı Bacasız mı?',
    description:
      'Davlumbaz seçerken bacalı ve bacasız sistem farkı, emiş gücü hesabı, genişlik ve montaj yüksekliği. Mutfağınıza uygun davlumbaz nasıl seçilir?',
    excerpt:
      'Emiş gücü kaç m³/saat olmalı, davlumbaz ocaktan ne kadar yükseğe asılmalı, karbon filtre ne zaman değişir — hepsi tek yazıda.',
    category: 'Ankastre',
    tags: ['davlumbaz', 'aspiratör', 'ankastre', 'mutfak'],
    publishedAt: '2026-09-04',
    relatedCategories: [{ label: 'Ankastre & Ocak Setleri', href: '/kategori/ankastre' }],
    blocks: [
      {
        kind: 'p',
        text:
          'Davlumbaz, mutfakta en çok göz ardı edilen ama günlük konforu en çok etkileyen üründür. Yetersiz emiş gücü, yemek kokusunun eve sinmesi ve dolap yüzeylerinde yağ birikmesi demektir. Doğru seçim için üç şey netleşmelidir: sistem tipi, emiş gücü ve genişlik.',
      },
      { kind: 'h2', text: 'Bacalı sistem' },
      {
        kind: 'p',
        text:
          'Bacalı kullanımda kirli hava bir kanalla dışarı atılır. Koku ve nemi ortamdan tamamen uzaklaştırdığı için en etkili çözümdür. Koşulu, mutfakta dışarı çıkan bir baca kanalının bulunması ya da açılabilmesidir.',
      },
      { kind: 'h2', text: 'Bacasız (karbon filtreli) sistem' },
      {
        kind: 'p',
        text:
          'Bacasız kullanımda hava karbon filtreden geçirilip mutfağa geri verilir. Baca çıkışı olmayan dairelerde tek uygulanabilir çözümdür. Kokuyu önemli ölçüde tutar ancak nemi ortamdan çıkarmaz ve filtrelerin düzenli değiştirilmesi gerekir.',
      },
      {
        kind: 'table',
        head: ['', 'Bacalı', 'Bacasız'],
        rows: [
          ['Koku', 'Tamamen dışarı atılır', 'Filtreyle tutulur'],
          ['Nem', 'Dışarı atılır', 'Ortamda kalır'],
          ['Kurulum', 'Baca kanalı gerekir', 'Kanal gerekmez'],
          ['Bakım', 'Yağ filtresi temizliği', 'Karbon filtre değişimi (3-6 ay)'],
        ],
      },
      { kind: 'h2', text: 'Emiş gücü nasıl hesaplanır' },
      {
        kind: 'p',
        text:
          'Pratik yöntem, mutfağın hacmini bulup saatte on kez hava değişimi hedeflemektir. Mutfak alanı ile tavan yüksekliğini çarpıp çıkan hacmi 10 ile çarptığınızda ihtiyacınız olan yaklaşık m³/saat değerini bulursunuz.',
      },
      {
        kind: 'quote',
        text:
          'Örnek: 12 m² mutfak, 2,8 m tavan yüksekliği → 12 × 2,8 = 33,6 m³ → 33,6 × 10 ≈ 340 m³/saat minimum emiş.',
      },
      {
        kind: 'note',
        title: 'Açık mutfaklarda',
        text:
          'Salonla birleşik mutfaklarda hesabı salon hacmini de katarak yapın ya da bulduğunuz değerin en az 1,5 katı emiş gücüne sahip bir model seçin.',
      },
      { kind: 'h2', text: 'Montaj yüksekliği' },
      {
        kind: 'ul',
        items: [
          'Elektrikli ve cam seramik ocaklarda: ocak yüzeyinden 55-65 cm.',
          'Gazlı ocaklarda: 65-75 cm.',
          'Çok alçak montaj yangın riski, çok yüksek montaj emiş kaybı yaratır.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Karbon filtre ne sıklıkla değişmeli?',
        a: 'Kullanım yoğunluğuna göre genellikle 3-6 ayda bir. Koku tutma performansı düştüğünde filtre ömrü dolmuş demektir.',
      },
      {
        q: 'Davlumbaz ocaktan geniş olmalı mı?',
        a: 'En az ocak genişliğinde olmalı. Bir kademe geniş seçmek (60 cm ocak için 90 cm davlumbaz) yanlardan kaçan buharı da yakalar.',
      },
    ],
  },

  {
    slug: 'camasir-makinesi-kac-kg-olmali',
    title: 'Çamaşır Makinesi Kaç Kg Olmalı? Kapasite ve Devir Rehberi',
    description:
      'Çamaşır makinesi seçerken kaç kg kapasite gerekir, devir sayısı ne anlama gelir, enerji sınıfı nasıl okunur? Aileye göre kapasite tablosu.',
    excerpt:
      'Kapasite hane halkına göre seçilir, devir kurutma süresini belirler. İkisini de doğru anlamak makineyi doğru seçmenin yarısı.',
    category: 'Beyaz Eşya',
    tags: ['çamaşır makinesi', 'kapasite', 'devir', 'enerji'],
    publishedAt: '2026-09-03',
    relatedCategories: [{ label: 'Soğutma & Beyaz Eşya', href: '/kategori/buzdolabi' }],
    blocks: [
      {
        kind: 'p',
        text:
          'Çamaşır makinesinde iki teknik değer öne çıkar: kilogram cinsinden kapasite ve dakikadaki devir sayısı. Kapasite kaç kişilik çamaşırı tek seferde yıkayabileceğinizi, devir ise çamaşırın makineden ne kadar kuru çıkacağını belirler.',
      },
      { kind: 'h2', text: 'Kapasite tablosu' },
      {
        kind: 'table',
        head: ['Hane', 'Önerilen kapasite', 'Not'],
        rows: [
          ['1-2 kişi', '6-7 kg', 'Haftada 2-3 yıkama için yeterli.'],
          ['3-4 kişi', '8-9 kg', 'En çok tercih edilen aralık.'],
          ['5 kişi ve üzeri', '10 kg ve üzeri', 'Yorgan ve battaniye yıkamaya da uygun.'],
        ],
      },
      {
        kind: 'note',
        title: 'Kapasite tam doldurulmalı mı',
        text:
          'Makineyi kapasitesinin çok altında çalıştırmak su ve enerji israfıdır; tıka basa doldurmak ise yıkama kalitesini düşürür. Tamburun üçte birlik üst kısmı boş kalacak şekilde doldurmak en verimli kullanımdır.',
      },
      { kind: 'h2', text: 'Devir sayısı ne anlama gelir' },
      {
        kind: 'p',
        text:
          'Devir, sıkma sırasında tamburun dakikada kaç tur attığını gösterir. Yüksek devir çamaşırdaki suyu daha çok alır, dolayısıyla kuruma süresi kısalır. Buna karşılık hassas kumaşlarda yıpranmayı artırabilir; bu yüzden program bazlı devir ayarı yapılabilen modeller tercih edilir.',
      },
      {
        kind: 'ul',
        items: [
          '800-1000 devir: hassas kumaşlar, daha uzun kuruma süresi.',
          '1200 devir: günlük kullanım için dengeli seçim.',
          '1400 devir ve üzeri: kurutma makinesi kullanmayanlar için avantajlı.',
        ],
      },
      { kind: 'h2', text: 'Kurulum ve bakım' },
      {
        kind: 'ol',
        items: [
          'Nakliye cıvatalarını sökmeden makineyi çalıştırmayın; tambur zarar görür.',
          'Makineyi düz zemine kurun ve ayaklarından terazileyin.',
          'Su giriş hortumunu sıkın, ilk çalıştırmada bağlantıyı gözle kontrol edin.',
          'Ayda bir 60-90 °C boş yıkama yaparak tamburu temizleyin.',
          'Pompa filtresini üç ayda bir temizleyin.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Nakliye cıvatası nedir, sökülmezse ne olur?',
        a: 'Taşıma sırasında tamburu sabitleyen metal cıvatalardır. Sökülmeden çalıştırılırsa makine aşırı titreşir ve tambur askı sistemi kalıcı hasar görebilir.',
      },
      {
        q: 'Yüksek devir her zaman daha mı iyi?',
        a: 'Hayır. Kuruma süresini kısaltır ama hassas kumaşlarda yıpratır. Önemli olan devri programa göre ayarlayabilmektir.',
      },
    ],
  },

  {
    slug: 'bulasik-makinesi-secimi',
    title: 'Bulaşık Makinesi Seçimi: Kişi Sayısı, Program ve Yerleşim',
    description:
      'Bulaşık makinesi kaç kişilik olmalı, ankastre mi solo mu, hangi programlar gerçekten kullanılıyor? Bulaşık makinesi seçim ve kurulum rehberi.',
    excerpt:
      'Kişilik kapasitesi ne demek, yarım yük programı ne işe yarar, ankastre modelde nelere dikkat edilir — pratik bir seçim rehberi.',
    category: 'Beyaz Eşya',
    tags: ['bulaşık makinesi', 'ankastre', 'mutfak'],
    publishedAt: '2026-09-02',
    relatedCategories: [
      { label: 'Ankastre & Ocak Setleri', href: '/kategori/ankastre' },
      { label: 'Soğutma & Beyaz Eşya', href: '/kategori/buzdolabi' },
    ],
    blocks: [
      {
        kind: 'p',
        text:
          'Bulaşık makinesinde kapasite “kişilik” olarak ifade edilir. Bir kişilik takım; tabaklar, bardak, çatal-bıçak ve servis parçalarından oluşan standart bir sete karşılık gelir. Yani 12 kişilik bir makine, 12 kişinin bir öğünde kullandığı bulaşığı tek seferde yıkayabilir.',
      },
      { kind: 'h2', text: 'Kapasite seçimi' },
      {
        kind: 'table',
        head: ['Hane', 'Önerilen kapasite'],
        rows: [
          ['1-2 kişi', '8-10 kişilik (45 cm dar model de olabilir)'],
          ['3-5 kişi', '12-13 kişilik (standart 60 cm)'],
          ['6 kişi ve üzeri', '14 kişilik ve üzeri'],
        ],
      },
      { kind: 'h2', text: 'Ankastre mi solo mu' },
      {
        kind: 'ul',
        items: [
          'Tam ankastre: dolap kapağıyla kaplanır, mutfakta hiç görünmez.',
          'Yarı ankastre: panel görünür, tezgâh altına gömülür.',
          'Solo: bağımsız durur, taşınırken birlikte götürülebilir.',
        ],
      },
      {
        kind: 'note',
        title: 'Yer ayırmayı unutmayın',
        text:
          'Bulaşık makinesi ilk etapta alınmayacaksa bile mutfak planında 60 cm’lik yeri, su girişi ve giderini baştan ayırın. Sonradan eklemek çoğu zaman tezgâh müdahalesi gerektirir.',
      },
      { kind: 'h2', text: 'Gerçekten kullanılan programlar' },
      {
        kind: 'p',
        text:
          'Onlarca program arasında günlük hayatta öne çıkanlar sınırlıdır. Eko program en düşük enerjiyle en iyi sonucu verir ancak süresi uzundur; hızlı program az kirli bulaşık için, yoğun program ise tencere ve tava için uygundur.',
      },
      {
        kind: 'ul',
        items: [
          'Eko: en düşük tüketim, en uzun süre; günlük kullanım için ideal.',
          'Yarım yük: az bulaşıkta su ve enerji tasarrufu.',
          'Yoğun: yağlı tencere ve fırın kabı için.',
          'Cam/hassas: ince bardaklarda düşük sıcaklık.',
        ],
      },
      { kind: 'h2', text: 'Bakım' },
      {
        kind: 'ol',
        items: [
          'Alt filtreyi haftada bir çıkarıp durulayın.',
          'Tuz ve parlatıcı seviyesini düzenli kontrol edin.',
          'Ayda bir boş makinede makine temizleyici kullanın.',
          'Püskürtme kollarının deliklerini tıkanmaya karşı kontrol edin.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Bulaşıkları makineye koymadan önce durulamak gerekir mi?',
        a: 'Kaba artıkları almak yeterli. Tam durulama gereksiz su tüketimidir ve deterjanın işini yapmasını zorlaştırır.',
      },
      {
        q: 'Tuz her makinede gerekli mi?',
        a: 'Su sertliğine bağlı. Sert su bulunan bölgelerde tuz kullanmamak, ısıtıcı ve püskürtme kollarında kireç birikmesine yol açar.',
      },
    ],
  },
]
