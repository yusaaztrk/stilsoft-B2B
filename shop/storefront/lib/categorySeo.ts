/**
 * KATEGORİ SAYFASI SEO METİNLERİ (2026-09-21).
 *
 * <b>Sorun:</b> Google'da "kıbrıs çamaşır makinesi", "kktc buzdolabı", "kktc televizyon"
 * arandığında ilk sayfada bekokibris.com, technopluskibris.com, armarshop.com ve
 * regalkibris.com çıkıyordu; biz hiçbirinde yoktuk. İki somut sebebi vardı:
 *
 * 1. BAŞLIKTA ARANAN KELİME YOKTU. Kategori başlığı "Soğutma & Beyaz Eşya Modelleri ve
 *    Fiyatları" idi. Kimse "soğutma beyaz eşya" aramıyor; "buzdolabı kıbrıs" arıyor.
 *    Üstelik ada halkı ve arama motoru "Kıbrıs" kelimesini kullanıyor, bizim her yerimizde
 *    yalnızca "KKTC" yazıyordu. Rakiplerin başlıkları tam tersi: "Buzdolabı Modelleri -
 *    Kıbrıs'ta...", "Soğutucu & Dondurucu – Beko Kıbrıs".
 *
 * 2. KATEGORİ SAYFASINDA METİN YOKTU. Sayfa yalnızca ürün kartlarından oluşuyordu. Arama
 *    motorunun okuyup "bu sayfa bu konuyu anlatıyor" diyebileceği tek satır yazı yoktu.
 *
 * <b>Bu dosya ne yapıyor:</b> her kategori adresi için arama kutusuna yazılan GERÇEK
 * kelimeyi, sayfa başlığını, açıklamasını, tanıtım metnini ve sık sorulan soruları
 * tutuyor. SSS'ler sayfada FAQPage şeması üretiyor — arama sonucunda açılır soru-cevap
 * olarak görünme ihtimali bunun için.
 *
 * <b>Panel metni önceliklidir:</b> bayi panelden kategori metni yazdıysa buradaki kalıp
 * metin hiç basılmaz. Elle yazılmış metin her zaman kalıptan iyidir; buradakiler yalnızca
 * "sayfa metinsiz kalmasın" diye var.
 *
 * <b>Yeni kategori eklenirse</b> buraya kayıt girmek ZORUNLU DEĞİL: `kategoriSeo()`
 * kategorinin kendi adından makul bir başlık ve metin türetiyor. Kayıt girmek yalnızca
 * sonucu iyileştirir.
 */

export type KategoriSss = { q: string; a: string }

export type KategoriSeo = {
  /** Arama kutusuna yazılan ad ("buzdolabı"), mağaza içi kategori adı değil. */
  anahtar: string
  /** <title>. Sona `| STILSOFT DEMO` ekleniyor — bu yüzden 45 karakteri aşmamalı. */
  baslik: string
  /** meta description; 150-160 karakter hedefleniyor. */
  aciklama: string
  /** Sayfa başlığının altındaki kısa giriş cümlesi. */
  giris: string
  /** Ürünlerin altındaki tanıtım metni paragrafları. */
  metin: string[]
  sss: KategoriSss[]
  /**
   * Kategoriyle ilgili blog yazılarının adresleri (slug).
   *
   * NEDEN: blog yalnızca altbilgiden bağlıydı. Arama motoru bir sayfayı ne kadar çok iç
   * bağlantıyla görüyorsa o kadar önemli sayar; yazılara yalnız altbilgiden gitmek, 46
   * yazının tamamını sitenin en zayıf bağlantılı köşesinde bırakmak demekti. Ayrıca
   * "buzdolabı" kategorisine düşen ziyaretçi, karar veremediğinde doğrudan seçim
   * rehberine geçebiliyor — çıkıp gitmek yerine.
   *
   * Olmayan bir slug yazılırsa sayfa patlamaz, o bağlantı basitçe çizilmez.
   */
  yazilar?: string[]
}

/**
 * Ortak kapanış cümlesi. Her kategoride teslimat/garanti/montaj vaadi tekrar ediyor çünkü
 * ziyaretçi kategori sayfasına doğrudan aramadan düşüyor ve anasayfadaki güven şeridini
 * hiç görmüyor.
 */
const TESLIMAT =
  'KKTC geneline — Lefkoşa, Girne, Gazimağusa, Güzelyurt ve İskele dâhil — adrese ücretsiz teslimat yapılır. Ürünler resmi distribütör garantilidir ve uygun ürünlerde kurulum yetkili teknisyen tarafından ücretsiz yapılır.'

const KAYITLAR: Record<string, KategoriSeo> = {
  buzdolabi: {
    anahtar: 'buzdolabı',
    baslik: 'Buzdolabı Kıbrıs — KKTC Buzdolabı Fiyatları',
    aciklama:
      'Kıbrıs’ta buzdolabı modelleri ve fiyatları: no-frost, gardırop tipi ve tek kapılı buzdolapları. KKTC geneli ücretsiz teslimat, 3 yıl garanti.',
    giris:
      'No-frost, gardırop tipi ve tek kapılı buzdolapları; KKTC geneline ücretsiz teslimat ve kurulum.',
    metin: [
      'Buzdolabı, evdeki tek gerçekten hiç durmayan cihazdır: günün yirmi dört saati çalışır ve ortalama on yıl kullanılır. Bu yüzden seçimde iki şey öne çıkar — hane halkına yetecek hacim ve düşük yıllık enerji tüketimi. Kıbrıs’ta yaz sıcaklıkları yüksek seyrettiği için cihazın iklim sınıfı da önemlidir; sıcak ortamda çalışan bir dolap, kapasitesi zorlanırsa hem çok elektrik harcar hem kompresörü yıpranır.',
      'Hacim seçiminde yaygın ölçüt kişi başına yaklaşık 100-120 litredir: iki kişilik bir ev için 250-300 litre, dört kişilik bir aile için 400-500 litre, kalabalık haneler ve toplu alışveriş yapanlar için gardırop tipi (side by side) modeller uygundur. Gardırop tipi dolaplar 90 cm’in üzerinde genişliğe sahiptir; sipariş öncesi kapı ve koridor genişliğini ölçmekte fayda var.',
      'No-frost modellerde buz oluşmaz ve buz çözmeye gerek kalmaz; statik modeller ise daha uygun fiyatlıdır ve içerideki nem yüksek olduğu için sebzeler daha az kurur. İki sistemin farkını, buz çözme adımlarını ve hangi durumda hangisinin daha mantıklı olduğunu blog bölümümüzdeki karşılaştırma yazısında ayrıntılı anlattık.',
      TESLIMAT,
    ],
    sss: [
      {
        q: 'Kıbrıs’ta buzdolabı kaç litre olmalı?',
        a: 'Kişi başına yaklaşık 100-120 litre hesaplanır. İki kişilik ev için 250-300 litre, dört kişilik aile için 400-500 litre yeterlidir. Toplu alışveriş yapan haneler için gardırop tipi modeller tercih edilir.',
      },
      {
        q: 'Buzdolabı teslimat ve kurulumu ücretli mi?',
        a: 'KKTC geneline teslimat ücretsizdir. Buzdolabı kapıda teslim edilir ve yerine yerleştirilir; ayrıca su bağlantılı modellerde kurulum teknisyen tarafından yapılır.',
      },
      {
        q: 'Buzdolabını fişe hemen takabilir miyim?',
        a: 'Hayır. Taşıma sırasında kompresör yağı borulara kaçabildiği için dik taşınmışsa 2-4 saat, yatık taşınmışsa 12-24 saat beklenmelidir.',
      },
    ],
    yazilar: ['buzdolabi-secimi-kktc', 'no-frost-nedir-buz-cozme', 'buzdolabi-tasindiktan-sonra-kac-saat-beklemeli'],
  },

  'camasir-makinesi': {
    anahtar: 'çamaşır makinesi',
    baslik: 'Çamaşır Makinesi Kıbrıs — KKTC Fiyatları',
    aciklama:
      'Kıbrıs’ta çamaşır makinesi modelleri ve fiyatları: 7, 8, 9 ve 10 kg kapasiteler. KKTC geneli ücretsiz teslimat, kurulum ve 3 yıl garanti.',
    giris:
      '7 kg’dan 10 kg’a kapasiteler, enerji verimli modeller; ücretsiz teslimat ve kurulum.',
    metin: [
      'Çamaşır makinesi seçiminde ilk karar kapasitedir. Kapasite, makineye sığan kuru çamaşırın kilogram karşılığıdır: 1-2 kişilik hane için 7 kg, 3-4 kişilik aile için 8-9 kg, kalabalık haneler ve sık nevresim yıkayanlar için 10 kg ve üzeri uygundur. Makineyi her seferinde yarım doldurmak yerine kapasiteye yakın çalıştırmak hem su hem elektrik tasarrufu sağlar.',
      'İkinci belirleyici, devir sayısıdır. 1000 devir çoğu ev için yeterlidir; 1200-1400 devir çamaşırı daha kuru çıkarır ve kuruma süresini kısaltır. Yüksek devir hassas kumaşları daha çok yıpratır, bu yüzden program seçimi önemlidir.',
      'Kıbrıs’ta şebeke suyu kireç oranı yüksektir. Kireç, rezistans üzerinde birikerek ısıtmayı yavaşlatır ve zamanla rezistansın yanmasına yol açar. Ayda bir kez boş makinede 90 °C programda kireç çözücü çalıştırmak, cihazın ömrünü belirgin şekilde uzatır. Kapak contası, deterjan çekmecesi ve pompa filtresi temizliğini de ihmal etmemek gerekir; makinede oluşan kötü kokunun kaynağı neredeyse her zaman bu üç noktadır.',
      TESLIMAT,
    ],
    sss: [
      {
        q: 'Kaç kg çamaşır makinesi almalıyım?',
        a: '1-2 kişi için 7 kg, 3-4 kişilik aile için 8-9 kg, kalabalık haneler için 10 kg ve üzeri uygundur. Kapasite kuru çamaşır ağırlığını ifade eder.',
      },
      {
        q: 'Çamaşır makinesi kurulumu yapılıyor mu?',
        a: 'Evet. Uygun ürünlerde su girişi ve gider bağlantısı yetkili teknisyen tarafından yapılır, makine çalıştırılarak teslim edilir. Musluk ve gider hattının hazır olması gerekir.',
      },
      {
        q: 'Çamaşır makinem neden kokuyor?',
        a: 'Koku genellikle kapak contasında, deterjan çekmecesinde ve pompa filtresinde biriken nem ve deterjan artığından kaynaklanır. Bu üç nokta elle temizlenmeli, ayda bir de kireç çözücüyle boş program çalıştırılmalıdır.',
      },
    ],
    yazilar: ['camasir-makinesi-kac-kg-olmali', 'camasir-makinesi-kokusu-ve-kirec-temizligi', 'kurutma-makinesi-isi-pompali-mi-kondenserli-mi'],
  },

  'bulasik-makinesi': {
    anahtar: 'bulaşık makinesi',
    baslik: 'Bulaşık Makinesi Kıbrıs — KKTC Fiyatları',
    aciklama:
      'Kıbrıs’ta bulaşık makinesi modelleri ve fiyatları: 60 cm ve 45 cm ankastre ve solo modeller. KKTC geneli ücretsiz teslimat ve kurulum.',
    giris: '60 cm ve dar 45 cm modeller, ankastre ve solo seçenekler.',
    metin: [
      'Bulaşık makinesi elde yıkamaya göre belirgin şekilde daha az su harcar ve yüksek sıcaklıkta durulama sayesinde daha hijyenik sonuç verir. Standart genişlik 60 cm’dir ve 12-14 kişilik takım alır; mutfağı dar olanlar için 45 cm’lik dar modeller 9-10 kişilik takıma kadar çıkar.',
      'Kıbrıs’ta suyun sert olması, bulaşık makinesinde en sık yaşanan iki şikâyetin sebebidir: bardakların puslu çıkması ve tabaklarda beyaz iz kalması. Makinenin içindeki su yumuşatıcı reçine, çalışmaya devam edebilmek için tuza ihtiyaç duyar. “Hepsi bir arada” tabletler orta sertlikteki suya göre tasarlandığı için sert suda tek başına yetmez; tuz haznesi düzenli doldurulmalı ve makinenin su sertliği kademesi yükseltilmelidir.',
      'Bulaşıkların ıslak çıkması ise genellikle parlatıcı azlığındandır. Parlatıcı, durulama suyunun yüzeyde damla hâlinde kalmasını engeller; damla kalmayınca hem kuruma hızlanır hem de kireç izi oluşmaz.',
      TESLIMAT,
    ],
    sss: [
      {
        q: 'Bardaklarım neden puslu çıkıyor?',
        a: 'Sert su ve yetersiz tuz nedeniyledir. Tuz haznesini doldurun ve makinenin su sertliği kademesini yükseltin. Çok amaçlı tablet kullansanız bile tuz gereklidir.',
      },
      {
        q: '45 cm bulaşık makinesi yeterli mi?',
        a: '1-3 kişilik haneler için genellikle yeterlidir; 9-10 kişilik takım alır. Kalabalık ailelerde 60 cm standart model daha uygundur.',
      },
      {
        q: 'Ankastre mi solo mu almalıyım?',
        a: 'Mutfak dolapları yeni yapılıyorsa ankastre görünüm bütünlüğü sağlar. Taşınma ihtimali varsa solo model daha esnektir.',
      },
    ],
    yazilar: ['bulasik-makinesi-secimi', 'bulasik-makinesi-tuz-parlatici-ayari', 'kktc-su-sertligi-kirec-cihaz-omru'],
  },

  ankastre: {
    anahtar: 'ankastre set',
    baslik: 'Ankastre Set Kıbrıs — Fırın, Ocak, Davlumbaz',
    aciklama:
      'Kıbrıs’ta ankastre set fiyatları: ankastre fırın, ocak ve davlumbaz modelleri. KKTC geneli ücretsiz teslimat ve yetkili teknisyen montajı.',
    giris:
      'Ankastre fırın, ocak ve davlumbaz; set uyumu ve ölçü tablosuyla birlikte ücretsiz montaj.',
    metin: [
      'Ankastre set, fırın-ocak-davlumbaz üçlüsünün mutfak dolabına gömülü olarak kullanıldığı düzendir. Mutfağı daha bütünlüklü gösterir ve tezgâh altını verimli kullanır. Üç ürünün aynı seriden seçilmesi hem görünüm uyumu hem de ölçü uyumu sağlar.',
      'Ölçü, ankastrede en kritik konudur. Standart ankastre fırın nişi 60 cm genişliğindedir; ocaklar ise 60 cm ve 90 cm genişliklerde bulunur. Dolap kesim ölçüsü her modelde farklı olabildiği için ürün sayfasındaki niş ölçüsü tablosu mutlaka kontrol edilmelidir. Davlumbaz genişliği ocak genişliğine eşit ya da bir ölçü büyük olmalıdır.',
      'Davlumbazda ikinci karar bacalı mı bacasız mı olacağıdır. Bacalı davlumbaz kokuyu ve nemi dışarı atar, en etkili çözümdür; ancak mutfak yapılırken baca çıkışının planlanmış olması gerekir. Bacasız (karbon filtreli) modeller havayı filtreleyip mutfağa geri verir, sonradan kurulumda tek seçenek genellikle budur ve filtrelerinin düzenli değişmesi gerekir.',
      'Ocak tipinde ise gazlı, cam seramik ve indüksiyon seçenekleri var. İndüksiyon en hızlı ısıtan ve en kolay temizlenen seçenektir ama tabanı manyetik tencere gerektirir. Ayrıntılı karşılaştırmayı blog bölümündeki ocak seçimi yazımızda bulabilirsiniz.',
      TESLIMAT,
    ],
    sss: [
      {
        q: 'Ankastre set montajı ücretsiz mi?',
        a: 'Uygun ürünlerde montaj hizmeti sunulur. Fırın ve ocak dolaba yerleştirilir, elektrik ve gaz bağlantısı yapılır ve cihaz çalıştırılarak teslim edilir. Dolap kesimi ve tezgâh işleri montaja dâhil değildir.',
      },
      {
        q: 'Ankastre fırın nişi kaç cm olmalı?',
        a: 'Standart ankastre fırın için niş genişliği 60 cm’dir. Yükseklik ve derinlik ölçüleri modele göre değişir; ürün sayfasındaki ölçü tablosunu kontrol edin.',
      },
      {
        q: 'Fırın, ocak ve davlumbazın aynı markadan olması şart mı?',
        a: 'Şart değil ancak aynı seriden seçilen ürünler hem görünüm hem ölçü uyumu açısından daha güvenlidir.',
      },
    ],
    yazilar: ['ankastre-set-nasil-secilir', 'ankastre-firin-olculeri-ve-tezgah-uyumu', 'davlumbaz-secimi-bacali-bacasiz', 'ocak-secimi-induksiyon-cam-seramik-gazli'],
  },

  klima: {
    anahtar: 'klima',
    baslik: 'Klima Kıbrıs — KKTC Klima Fiyatları ve Montajı',
    aciklama:
      'Kıbrıs’ta klima fiyatları: 9.000, 12.000, 18.000 ve 24.000 BTU inverter klima modelleri. KKTC geneli teslimat ve yetkili teknisyen montajı.',
    giris:
      '9.000 BTU’dan 24.000 BTU’ya inverter klimalar; oda metrekaresine göre seçim ve montaj desteği.',
    metin: [
      'Klimada ilk ve en kritik karar BTU değeridir. Düşük seçilen klima odayı soğutamaz, sürekli tam güçte çalışarak hem yıpranır hem çok elektrik harcar; gereğinden büyük klima ise odayı çabuk soğutup durur, havadaki nemi alamaz ve içerisi serin ama rutubetli kalır. Yaygın karşılık şöyledir: 10-15 m² için 9.000 BTU, 16-22 m² için 12.000 BTU, 23-35 m² için 18.000 BTU, 36-50 m² için 24.000 BTU.',
      'Oda çatı katındaysa, gün boyu doğrudan güneş alıyorsa ya da tavan yüksekliği 3 metrenin üzerindeyse bir üst kademe seçmek gerekir. Kıbrıs’ta güneye bakan odalarda bu fark belirgin biçimde hissedilir.',
      'Inverter teknolojisi, kompresörün devrini değiştirebilmesi anlamına gelir. Klasik klimada kompresör ya tam güçte çalışır ya durur; inverterde ise oda sıcaklığa geldiğinde cihaz durmaz, düşük devirde çalışmaya devam eder. Sonuç: daha sabit sıcaklık, daha sessiz çalışma ve uzun süreli kullanımda belirgin elektrik tasarrufu.',
      'Montaj kalitesi, cihazın kendisi kadar belirleyicidir. Dış ünitenin gölgede ve havalandırması engellenmeyecek şekilde konumlanması, drenaj hattının doğru eğimle çekilmesi gerekir. Girne ve Mağusa gibi kıyı bölgelerinde tuzlu hava dış üniteyi zamanla aşındırdığı için yılda bir tatlı suyla durulama önerilir.',
      TESLIMAT,
    ],
    sss: [
      {
        q: 'Klima kaç BTU olmalı?',
        a: '10-15 m² için 9.000 BTU, 16-22 m² için 12.000 BTU, 23-35 m² için 18.000 BTU, 36-50 m² için 24.000 BTU uygundur. Çatı katı ve çok güneş alan odalarda bir üst kademe seçilmelidir.',
      },
      {
        q: 'Klima montajı yapılıyor mu?',
        a: 'Evet, yetkili teknisyen tarafından yapılır. Standart montaj dışında kalan ek boru, konsol ve kırım işleri ayrıca değerlendirilir; teknisyen randevu sırasında bunu netleştirir.',
      },
      {
        q: 'Inverter klima gerçekten tasarruf ettirir mi?',
        a: 'Günde uzun süre çalıştırılan klimalarda evet, fark belirgindir. Günde yalnızca yarım saat çalıştırılan bir cihazda yatırım kendini geç amorti eder.',
      },
    ],
    yazilar: ['klima-kac-btu-olmali-metrekare-tablosu', 'inverter-klima-elektrik-tuketimi', 'klima-montaji-ve-bakimi-kktc'],
  },

  elektro: {
    anahtar: 'televizyon',
    baslik: 'Televizyon Kıbrıs — KKTC TV Fiyatları',
    aciklama:
      'Kıbrıs’ta televizyon fiyatları ve modelleri: 4K smart TV, 43, 50, 55 ve 65 inç ekranlar. KKTC geneli ücretsiz teslimat ve duvara montaj.',
    giris: '4K smart televizyonlar, 43 inçten 65 inç ve üzerine ekran seçenekleri.',
    metin: [
      'Televizyon seçiminde ilk soru ekran boyutudur ve cevabı odanın büyüklüğü değil, koltuk ile ekran arasındaki mesafedir. 4K çözünürlükte pikseller gözle ayırt edilemediği için eski alışkanlıklara göre daha yakından, daha büyük ekran izlenebilir: 2-2,5 metre mesafede 50-55 inç, 2,5-3 metrede 55-65 inç, 3 metre ve üzerinde 65-75 inç rahat izlenir.',
      'İkinci karar panel tipidir. Kıbrıs’ta salonlar gündüz çok ışık aldığı için parlaklık, kontrast değerlerinden daha çok işe yarar; gündüz ağırlıklı izleyenler için QLED paneller öne çıkar. Akşam, perdeler kapalıyken film izlemeye öncelik verenler içinse siyah derinliği en iyi olan OLED paneller daha iyi sonuç verir. Bütçe odaklı seçimlerde ve ikinci televizyon ihtiyacında standart LED paneller yeterlidir.',
      'Maç ve hızlı aksiyon ağırlıklı izleniyorsa 100/120 Hz yenileme hızı hareket akıcılığında gözle görülür fark yaratır. Oyun konsolu bağlanacaksa HDMI 2.1 girişi aranmalıdır. Televizyonlar inceldikçe hoparlör hacmi küçüldüğü için, konuşmaları anlamakta zorlanılan durumlarda bir soundbar eklemek ekranı bir üst modele çıkarmaktan daha büyük fark yaratır.',
      'Duvara montajda askı aparatının televizyonun VESA ölçüsünü desteklemesi ve duvar tipine uygun dübel kullanılması gerekir. Alçıpan duvarlarda montaj mutlaka arkadaki taşıyıcı profile yapılmalıdır.',
      TESLIMAT,
    ],
    sss: [
      {
        q: 'Kıbrıs’ta kaç inç televizyon almalıyım?',
        a: 'Koltuk mesafesi 2-2,5 metre ise 50-55 inç, 2,5-3 metre ise 55-65 inç, 3 metrenin üzerindeyse 65-75 inç uygundur. İki boyut arasında kaldıysanız büyük olanı tercih edin.',
      },
      {
        q: 'Televizyon duvara montajı yapılıyor mu?',
        a: 'Uygun ürünlerde montaj hizmeti sunulur. Askı aparatı çoğu televizyonda ayrı satılır; modelin VESA ölçüsüne uygun aparatı sipariş sırasında sorabilirsiniz.',
      },
      {
        q: 'QLED mi OLED mi almalıyım?',
        a: 'Gündüz aydınlık salonda izliyorsanız QLED, akşam karanlık odada film izliyorsanız OLED daha iyi sonuç verir.',
      },
    ],
    yazilar: ['televizyon-nasil-secilir-kktc', 'kac-inc-tv-almaliyim-mesafe-tablosu', 'qled-oled-led-fark-nedir', 'tv-duvara-montaj-aski-aparati-secimi'],
  },

  'derin-dondurucu': {
    anahtar: 'derin dondurucu',
    baslik: 'Derin Dondurucu Kıbrıs — KKTC Fiyatları',
    aciklama:
      'Kıbrıs’ta derin dondurucu fiyatları: sandık tipi ve dikey no-frost modeller, 60 litreden 350 litreye kapasiteler. KKTC geneli ücretsiz teslimat.',
    giris: 'Sandık tipi ve dikey derin dondurucular; 60 litreden 350 litreye kapasiteler.',
    metin: [
      'Derin dondurucu, buzdolabının dondurucu bölmesi yetmeyen evler için alınır: toplu et alanlar, sebze dondurup saklayanlar, kalabalık aileler ve küçük işletmeler. İlk karar tip seçimidir.',
      'Sandık tipi modeller aynı litrede genellikle daha ucuzdur ve daha az elektrik harcar. Kapak üstte olduğu için açıldığında soğuk hava dibe çöker ve daha az kaçar; elektrik kesildiğinde iç sıcaklığı daha uzun süre korur. Dezavantajı düzendir — alttaki paketlere ulaşmak için üsttekileri boşaltmak gerekir.',
      'Dikey modeller ise çekmeceli düzeni sayesinde günlük kullanımda çok daha pratiktir ve buzdolabı gibi az yer kaplar. No-frost seçenekleri yaygın olduğu için buz çözme derdi olmaz. Kapı yandan açıldığından her açılışta soğuk hava kaçar ve tüketim biraz daha yüksektir.',
      'Kapasite seçiminde 1-2 kişilik ara sıra kullanım için 60-100 litre, 3-4 kişilik aile için 150-200 litre, kalabalık haneler ve toplu alışveriş için 250-350 litre yaygın karşılıktır. Dolu bir dondurucu boş olandan daha az elektrik harcar; yeriniz boşsa su dolu şişelerle doldurmak bile tüketimi düşürür.',
      TESLIMAT,
    ],
    sss: [
      {
        q: 'Sandık tipi mi dikey mi derin dondurucu?',
        a: 'Elektrik tüketimi ve kesintide soğuğu koruma açısından sandık tipi, düzen ve günlük kullanım kolaylığı açısından dikey model öndedir.',
      },
      {
        q: 'Derin dondurucu balkonda çalışır mı?',
        a: 'Kapalı ve doğrudan güneş almayan bir balkonda çalışır. Cihazın iklim sınıfı ortam sıcaklığını karşılamalıdır; çok sıcak ortamda kompresör sürekli çalışır ve ömrü kısalır.',
      },
    ],
    yazilar: ['derin-dondurucu-sandik-mi-dikey-mi', 'no-frost-nedir-buz-cozme'],
  },

  'gida-hazirlama': {
    anahtar: 'airfryer ve blender',
    baslik: 'Airfryer, Blender ve Mutfak Robotu — Kıbrıs',
    aciklama:
      'Kıbrıs’ta airfryer, blender, rondo ve mutfak robotu fiyatları. KKTC geneli ücretsiz teslimat, resmi distribütör garantisi.',
    giris: 'Airfryer, blender, rondo, mutfak robotu ve gıda hazırlama aletleri.',
    metin: [
      'Airfryer (yağsız fritöz) son yılların en çok satan küçük ev aleti oldu. Sıcak havayı hızla dolaştırarak pişirir; derin yağda kızartmaya göre çok daha az yağ kullanıldığı için kalori belirgin şekilde düşer. Kapasite seçiminde 1-2 kişi için 3-4 litre, 3-4 kişi için 5-6 litre, kalabalık aileler için 7 litre ve üzeri ya da çift sepetli modeller uygundur.',
      'Blender, rondo ve mutfak robotu sık karıştırılır. Blender sıvı ağırlıklı işler içindir: çorba, smoothie, meyve suyu. Rondo kuru ve katı malzemeyi doğrar: soğan, et, ceviz. Mutfak robotu ise doğrama, rendeleme, yoğurma ve çırpma gibi işleri tek gövdede toplar ve düzenli yemek yapanlar için zamanı en çok kısaltan alettir.',
      'Küçük ev aletlerinde motor gücü kadar bıçak kalitesi ve haznenin bulaşık makinesinde yıkanabilirliği de önemlidir; temizlemesi zor olan alet, ne kadar güçlü olursa olsun bir süre sonra dolapta kalır.',
      TESLIMAT,
    ],
    sss: [
      {
        q: 'Kaç litrelik airfryer almalıyım?',
        a: '1-2 kişi için 3-4 litre, 3-4 kişi için 5-6 litre, kalabalık aileler için 7 litre ve üzeri ya da çift sepetli modeller uygundur.',
      },
      {
        q: 'Blender mı mutfak robotu mu almalıyım?',
        a: 'Çorba ve içecek ağırlıklı kullanım için blender, doğrama-rendeleme-yoğurma gibi işler için mutfak robotu daha doğrudur.',
      },
    ],
    yazilar: ['airfryer-nasil-secilir', 'airfryer-temizligi-ve-kullanim-hatalari', 'blender-rondo-mutfak-robotu-farki'],
  },

  'icecek-hazirlama': {
    anahtar: 'kahve makinesi',
    baslik: 'Kahve Makinesi ve Çaycı — Kıbrıs Fiyatları',
    aciklama:
      'Kıbrıs’ta kahve makinesi, Türk kahvesi makinesi, çay makinesi ve su ısıtıcısı fiyatları. KKTC geneli ücretsiz teslimat ve garanti.',
    giris: 'Kahve makineleri, Türk kahvesi makineleri, çaycılar ve su ısıtıcıları.',
    metin: [
      'Kahve makinesi seçimi, hangi kahveyi içtiğinizle başlar. Türk kahvesi makineleri pişirme işini otomatikleştirir ve taşmayı önler. Filtre kahve makineleri büyük hacimde kahve için pratiktir. Espresso makineleri ve kapsüllü sistemler ise tek fincanlık, yoğun kahve için tercih edilir; kapsüllü modellerde cihaz ucuzken kapsül maliyeti zamanla birikir, öğütücülü espresso makinelerinde ise tam tersi geçerlidir.',
      'Çaycı ve su ısıtıcısı seçiminde hacim ve malzeme öne çıkar. Cam ve paslanmaz çelik gövdeler plastiğe göre daha kolay temizlenir ve kokuyu tutmaz. Çift demlikli çaycılar kalabalık haneler için pratiktir.',
      'Kıbrıs’ta suyun sert olması bu grubu doğrudan etkiler: kireç, su ısıtıcısının tabanında ve kahve makinesinin su hattında birikir, cihaz geç ısıtır ve tortu suya karışır. İki ayda bir kireç çözme işlemi yapmak, cihaz ömrünü belirgin şekilde uzatır. Kahve makinelerinde cihazın kendi kireç çözme uyarısı geldiğinde ertelememek gerekir.',
      TESLIMAT,
    ],
    sss: [
      {
        q: 'Kapsüllü mü öğütücülü kahve makinesi mi?',
        a: 'Kolaylık ve az yer kaplaması önemliyse kapsüllü, fincan başına maliyet ve kahve çeşitliliği önemliyse öğütücülü model daha uygundur.',
      },
      {
        q: 'Su ısıtıcısındaki kireç nasıl temizlenir?',
        a: 'Sirke ya da kireç çözücüyle iki ayda bir temizlik yeterlidir. Kaynatıp bir süre bekletmek, ardından birkaç kez durulamak gerekir.',
      },
    ],
    yazilar: ['kahve-makinesi-rehberi', 'su-isiticisi-ve-cayci-secimi', 'kktc-su-sertligi-kirec-cihaz-omru'],
  },

  'ev-temizligi': {
    anahtar: 'elektrikli süpürge',
    baslik: 'Elektrikli Süpürge ve Ütü — Kıbrıs Fiyatları',
    aciklama:
      'Kıbrıs’ta elektrikli süpürge, şarjlı dikey süpürge, robot süpürge ve buharlı ütü fiyatları. KKTC geneli ücretsiz teslimat ve garanti.',
    giris: 'Şarjlı dikey süpürgeler, torbalı ve torbasız modeller, buharlı ütüler.',
    metin: [
      'Elektrikli süpürgede üç ana tip var. Torbalı modeller tozu torbada tuttuğu için boşaltırken toz kalkmaz ve alerjisi olanlar için avantajlıdır, ancak torba sarf malzemedir. Torbasız modellerde hazne yıkanabilir ve sürekli masraf yoktur; boşaltırken toz kalkabilir. Şarjlı dikey süpürgeler ise kablo derdi olmadığı için günlük hızlı temizlikte açık ara pratiktir ve küçük evlerde ana süpürge olarak da kullanılabilir.',
      'Şarjlı modellerde belirleyici ölçüt çalışma süresidir. Turbo modda süre belirgin şekilde kısalır; ürün sayfasındaki süre genellikle normal moddaki değerdir. Halı ağırlıklı evlerde motorlu fırça başlığı bulunması önemlidir.',
      'Buharlı ütülerde buhar debisi ve şok buhar gücü, ütüleme hızını doğrudan belirler. Kazanlı (buhar istasyonlu) sistemler çok çamaşır ütüleyen haneler için süreyi ciddi ölçüde kısaltır. Kıbrıs’taki sert su nedeniyle buhar kanalları kireçlenir; mümkünse arıtılmış su kullanmak ve düzenli kireç temizliği yapmak gerekir.',
      TESLIMAT,
    ],
    sss: [
      {
        q: 'Şarjlı süpürge ana süpürge olarak yeterli mi?',
        a: 'Küçük ve orta büyüklükteki evlerde yeterlidir. Geniş, halı ağırlıklı evlerde kablolu bir süpürgeyle birlikte kullanmak daha pratiktir.',
      },
      {
        q: 'Buharlı ütüde hangi su kullanılmalı?',
        a: 'Sert suyun kireç bırakması nedeniyle mümkünse arıtılmış su tercih edilmelidir. Bazı modellerde saf su önerilmez; kullanım kılavuzuna bakın.',
      },
    ],
    yazilar: ['elektrikli-supurge-dikey-mi-torbali-mi', 'buharli-utu-ve-utu-sistemleri'],
  },

  utu: {
    anahtar: 'ütü',
    baslik: 'Ütü Kıbrıs — Buharlı Ütü Fiyatları',
    aciklama:
      'Kıbrıs’ta buharlı ütü ve buhar kazanlı ütü sistemleri fiyatları. KKTC geneli ücretsiz teslimat, resmi distribütör garantisi.',
    giris: 'Buharlı ütüler ve buhar kazanlı ütü sistemleri.',
    metin: [
      'Ütüde performansı belirleyen üç değer var: taban malzemesi, sürekli buhar debisi ve şok buhar gücü. Seramik ve seramik kaplı tabanlar kumaş üzerinde kolay kayar; paslanmaz çelik tabanlar daha dayanıklıdır. Sürekli buhar debisi yükseldikçe kırışıklıklar tek geçişte açılır.',
      'Buhar kazanlı (ütü istasyonu) sistemlerde su ayrı bir hazneden basınçlı olarak gönderilir. Çok çamaşır ütüleyen haneler için ütüleme süresini belirgin şekilde kısaltır; buna karşılık daha fazla yer kaplar ve fiyatı daha yüksektir.',
      'Kıbrıs’ta su sert olduğu için buhar delikleri zamanla kireçle tıkanır ve ütü kumaşa beyaz tortu bırakmaya başlar. Düzenli kireç temizliği ve mümkünse arıtılmış su kullanımı bu sorunu ortadan kaldırır.',
      TESLIMAT,
    ],
    sss: [
      {
        q: 'Buhar kazanlı ütü gerekli mi?',
        a: 'Haftada çok miktarda ütü yapılan hanelerde süreyi belirgin şekilde kısalttığı için değerlidir. Az ütü yapılan evlerde iyi bir buharlı ütü yeterlidir.',
      },
      {
        q: 'Ütüm kumaşa beyaz leke bırakıyor, sebebi ne?',
        a: 'Buhar kanallarında biriken kireçtir. Cihazın kendi kireç temizleme işlevini çalıştırın ve mümkünse arıtılmış su kullanın.',
      },
    ],
    yazilar: ['buharli-utu-ve-utu-sistemleri', 'kktc-su-sertligi-kirec-cihaz-omru'],
  },

  'kisisel-bakim': {
    anahtar: 'saç kurutma makinesi',
    baslik: 'Saç Kurutma ve Şekillendirici — Kıbrıs',
    aciklama:
      'Kıbrıs’ta saç kurutma makinesi, saç düzleştirici, maşa ve kişisel bakım ürünleri fiyatları. KKTC geneli ücretsiz teslimat ve garanti.',
    giris: 'Saç kurutma makineleri, düzleştiriciler, maşalar ve bakım setleri.',
    metin: [
      'Saç kurutma makinesinde güç (watt) kurutma hızını belirler ancak tek ölçüt değildir. Isı ve hız kademelerinin ayrı ayrı ayarlanabilmesi, saç tipine göre doğru kombinasyonu kurmayı sağlar. Soğuk üfleme (cool shot) özelliği, şekillendirmenin sonunda saç şeklini sabitler.',
      'Düzleştirici ve maşalarda plaka kaplaması belirleyicidir: seramik ve turmalin kaplamalar ısıyı daha eşit dağıtır ve saçı daha az yıpratır. Isı ayarı yapılabilen modeller, ince ve yıpranmış saçlarda düşük sıcaklıkta çalışma imkânı verdiği için tercih edilmelidir.',
      'Cihazı her kullanımdan sonra soğumaya bırakmak ve kablosunu gövdeye sıkı sarmamak, ömrünü uzatan en basit iki alışkanlıktır. Kabloyu cihaz sıcakken sıkıca sarmak, iç telleri zamanla kırar.',
      TESLIMAT,
    ],
    sss: [
      {
        q: 'Saç kurutma makinesinde kaç watt yeterli?',
        a: 'Günlük kullanım için 1800-2200 W aralığı çoğu saç tipine yeterlidir. Kalın ve uzun saçlarda yüksek güç kurutma süresini kısaltır.',
      },
      {
        q: 'Düzleştiricide hangi sıcaklık kullanılmalı?',
        a: 'İnce ve yıpranmış saçlarda düşük kademe, kalın ve gür saçlarda orta-yüksek kademe uygundur. Isı koruyucu sprey kullanmak yıpranmayı azaltır.',
      },
    ],
    yazilar: ['kisisel-bakim-sac-kurutma-sekillendirici'],
  },

  'ev-gerecleri': {
    anahtar: 'ev gereçleri',
    baslik: 'Ev Gereçleri Kıbrıs — Mutfak ve Ev Aletleri',
    aciklama:
      'Kıbrıs’ta mutfak ve ev gereçleri: mikrodalga, tost makinesi, ekmek kızartma ve daha fazlası. KKTC geneli ücretsiz teslimat ve garanti.',
    giris: 'Mikrodalga, tost makinesi, ekmek kızartma ve günlük mutfak aletleri.',
    metin: [
      'Günlük mutfak işini kısaltan küçük aletler, çoğu zaman büyük beyaz eşyadan daha sık kullanılır. Mikrodalga fırında hacim seçimi, içine koyacağınız en büyük kaba göre yapılmalıdır: 1-2 kişi için 17-20 litre, 3-4 kişi için 20-25 litre, kalabalık haneler için 25-30 litre uygundur.',
      'Grill özellikli mikrodalgalar üst yüzeyi kızartabilir; fanlı (konveksiyonlu) modeller küçük bir fırın gibi çalışır ve tek başına yaşayanlar için büyük fırının yerini tutabilir. Mikrodalgada metal kap, alüminyum folyo ve kapalı kavanoz kullanılmamalıdır.',
      'Tost makinesi ve ekmek kızartma makinelerinde çıkarılabilir kırıntı tepsisi ve yapışmaz plaka, temizliği belirgin şekilde kolaylaştırır. Düzenli temizlenmeyen kırıntı tepsisi hem koku hem yanma riski oluşturur.',
      TESLIMAT,
    ],
    sss: [
      {
        q: 'Kaç litre mikrodalga almalıyım?',
        a: '1-2 kişi için 17-20 litre, 3-4 kişi için 20-25 litre, kalabalık haneler için 25-30 litre uygundur. Geniş servis tabağı kullanacaksanız daha büyük hacim seçin.',
      },
      {
        q: 'Mikrodalgada hangi kaplar kullanılabilir?',
        a: 'Isıya dayanıklı cam, porselen ve mikrodalgaya uygun işaretli plastik kullanılabilir. Metal kap, yaldızlı tabak, alüminyum folyo ve kapalı kavanoz kullanılmamalıdır.',
      },
    ],
    yazilar: ['mikrodalga-secimi-ve-guvenli-kullanim', 'kibris-evlilik-paketi-ceyiz-beyaz-esya-listesi'],
  },

  'su-sebili': {
    anahtar: 'su sebili',
    baslik: 'Su Sebili Kıbrıs — KKTC Sebil Fiyatları',
    aciklama:
      'Kıbrıs’ta su sebili fiyatları: sıcak-soğuk sebiller, damacana ve alttan damacanalı modeller. KKTC geneli ücretsiz teslimat ve garanti.',
    giris: 'Sıcak-soğuk su sebilleri, üstten ve alttan damacanalı modeller.',
    metin: [
      'Su sebili, ev ve iş yerinde damacana suyunu pratik hâle getiren cihazdır. Temel ayrım damacananın nereye yerleştiğidir: üstten damacanalı modellerde damacana kapağın üstüne ters çevrilerek oturtulur; alttan damacanalı (gizli hazneli) modellerde damacana dolabın içine konur ve pompa yardımıyla su çekilir. İkincisi hem görünüm açısından daha derli topludur hem de ağır damacanayı kaldırma zorunluluğunu ortadan kaldırır.',
      'Sıcak su özelliği olan sebillerde çocuk kilidi bulunması önemlidir. Soğutma tarafında ise kompresörlü modeller, termoelektrik modellere göre daha hızlı ve daha düşük sıcaklığa soğutur; yoğun kullanımda tercih edilmelidir.',
      'Sebilin iç haznesi ve muslukları düzenli temizlenmelidir. Uzun süre temizlenmeyen sebillerde hazne içinde biyofilm oluşur ve su tadı değişir. Üç ayda bir yapılan basit temizlik bu sorunu önler.',
      TESLIMAT,
    ],
    sss: [
      {
        q: 'Alttan damacanalı sebil daha mı iyi?',
        a: 'Damacanayı kaldırma zorunluluğu olmadığı ve görünüm daha derli toplu olduğu için günlük kullanımda daha pratiktir. Fiyatı üstten damacanalı modellere göre daha yüksektir.',
      },
      {
        q: 'Su sebili ne sıklıkla temizlenmeli?',
        a: 'Üç ayda bir iç hazne ve muslukların temizlenmesi önerilir. Temizlenmeyen sebillerde su tadı değişir.',
      },
    ],
    yazilar: ['kktc-su-sertligi-kirec-cihaz-omru'],
  },
}

/** `su-sebili` ile `sebil` aynı ürün grubunu gösteriyor; ikisi de aynı metne bakıyor. */
KAYITLAR.sebil = KAYITLAR['su-sebili']

/**
 * Kategori için SEO bilgisi. Kayıt yoksa kategorinin kendi adından makul bir karşılık
 * türetiliyor — böylece ERP'de açılan yeni bir kategori, bu dosya güncellenmeden de
 * başlığında "Kıbrıs" geçen, açıklaması olan bir sayfa alıyor.
 */
export function kategoriSeo(slug: string, ad: string, urunSayisi: number): KategoriSeo {
  const kayit = KAYITLAR[slug]
  if (kayit) return kayit

  const adet = urunSayisi > 0 ? `${urunSayisi} model` : 'geniş ürün seçenekleri'
  return {
    anahtar: ad.toLocaleLowerCase('tr-TR'),
    baslik: `${ad} Kıbrıs — KKTC Fiyatları`,
    aciklama: `Kıbrıs’ta ${ad.toLocaleLowerCase('tr-TR')} fiyatları ve modelleri: ${adet}, KDV dahil. KKTC geneli ücretsiz teslimat, 3 yıl distribütör garantisi.`,
    giris: `${ad} kategorisindeki ürünler; KKTC geneline ücretsiz teslimat ve kurulum.`,
    metin: [TESLIMAT],
    sss: [],
  }
}

/** Sayfa altındaki SSS bloğundan FAQPage şeması. Soru yoksa şema da üretilmiyor. */
export function sssSemasi(sss: KategoriSss[]) {
  if (sss.length === 0) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: sss.map((s) => ({
      '@type': 'Question',
      name: s.q,
      acceptedAnswer: { '@type': 'Answer', text: s.a },
    })),
  }
}
