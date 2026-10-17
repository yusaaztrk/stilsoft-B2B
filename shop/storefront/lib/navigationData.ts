export interface SubNavItem {
  title: string
  href: string
  isPopular?: boolean
  badge?: string
}

export interface SubNavGroup {
  heading: string
  items: SubNavItem[]
}

export interface CategoryMegaData {
  slug: string
  name: string
  href: string
  badge?: string
  groups: SubNavGroup[]
  promo: {
    tag: string
    title: string
    subtitle: string
    link: string
    imageUrl: string
    badgeText?: string
  }
}

export const MEGA_NAV_DATA: Record<string, CategoryMegaData> = {
  ankastre: {
    slug: 'ankastre',
    name: 'Ankastre',
    href: '/kategori/ankastre',
    badge: 'Çok Satan',
    groups: [
      {
        heading: 'Pişirme Grubu',
        items: [
          { title: 'Ankastre Fırınlar', href: '/kategori/ankastre?ara=firin', isPopular: true },
          { title: 'Ankastre Ocaklar', href: '/kategori/ankastre?ara=ocak' },
          { title: 'Davlumbazlar & Aspiratörler', href: '/kategori/ankastre?ara=davlumbaz' },
          { title: 'Mikrodalga Fırınlar', href: '/kategori/ankastre?ara=mikrodalga' },
        ],
      },
      {
        heading: 'Setler & Paketler',
        items: [
          { title: "3'lü Ankastre Mutfak Seti", href: '/kategori/ankastre', isPopular: true, badge: 'Paket Fırsatı' },
          { title: 'Siyah Cam Tasarım Serisi', href: '/kategori/ankastre' },
          { title: 'İnox & Beyaz Cam Serisi', href: '/kategori/ankastre' },
          { title: 'Fırın & Ocak Aksesuarları', href: '/kategori/ankastre' },
        ],
      },
      {
        heading: 'Öne Çıkan Özellikler',
        items: [
          { title: '75 LT Ekstra Geniş İç Hacim', href: '/kategori/ankastre' },
          { title: '3 Camlı Soğuk Kapak Güvenliği', href: '/kategori/ankastre' },
          { title: 'Homojen Turbo Pişirme Teknolojisi', href: '/kategori/ankastre' },
          { title: 'A++ Enerji Tasarruflu Pişirme', href: '/kategori/ankastre' },
        ],
      },
    ],
    promo: {
      tag: 'MUTFAKTA ZARAFET',
      title: 'ST-AF-608 Turbo Ankastre Fırın',
      subtitle: '75 LT Geniş Hacim, 3 Camlı Güvenlik & Turbo Eşit Pişirme',
      link: '/kategori/ankastre',
      imageUrl: '/uploads/products/804f78e31a054ed8b73419f7e9633fa3.webp',
      badgeText: 'Ücretsiz Montaj',
    },
  },
  'gida-hazirlama': {
    slug: 'gida-hazirlama',
    name: 'Gıda Hazırlama',
    href: '/kategori/gida-hazirlama',
    badge: 'Trend',
    groups: [
      {
        heading: 'Pişirme & Kızartma',
        items: [
          { title: 'Airfryer Sıcak Hava Fritözleri', href: '/kategori/gida-hazirlama?ara=airfryer', isPopular: true, badge: 'Trend' },
          { title: 'Tost & Izgara Makineleri', href: '/kategori/gida-hazirlama?ara=tost' },
          { title: 'Ekmek Kızartma Makineleri', href: '/kategori/gida-hazirlama?ara=ekmek' },
          { title: 'Waffle & Krep Makineleri', href: '/kategori/gida-hazirlama' },
        ],
      },
      {
        heading: 'Karıştırıcı & Doğrayıcı',
        items: [
          { title: 'El Blender Setleri', href: '/kategori/gida-hazirlama?ara=blender', isPopular: true },
          { title: 'Çok Amaçlı Doğrayıcı & Rondo', href: '/kategori/gida-hazirlama?ara=dograyici' },
          { title: 'Mutfak Robotları & Mikserler', href: '/kategori/gida-hazirlama?ara=mikser' },
          { title: 'Kıyma & Salça Makineleri', href: '/kategori/gida-hazirlama?ara=kiyma' },
        ],
      },
      {
        heading: 'Teknoloji & Dayanıklılık',
        items: [
          { title: 'Titanium Bıçak Teknolojisi', href: '/kategori/gida-hazirlama' },
          { title: 'Dokunmatik LED Dijital Ekran', href: '/kategori/gida-hazirlama' },
          { title: '%80 Daha Az Yağla Çıtır Lezzetler', href: '/kategori/gida-hazirlama' },
          { title: 'Bulaşık Makinesinde Yıkanabilir Parçalar', href: '/kategori/gida-hazirlama' },
        ],
      },
    ],
    promo: {
      tag: 'HAFİF & ÇITIR LEZZET',
      title: 'ST-AIRTRON XXL Digital Airfryer',
      subtitle: '8 Hazır Pişirme Programı, Geniş Pişirme Haznesi & Dokunmatik Ekran',
      link: '/kategori/gida-hazirlama',
      imageUrl: '/uploads/products/91b9a1d829024ab88eb973c5bd59ab31.webp',
      badgeText: '%80 Yağsız Çıtır',
    },
  },
  'icecek-hazirlama': {
    slug: 'icecek-hazirlama',
    name: 'İçecek Hazırlama',
    href: '/kategori/icecek-hazirlama',
    groups: [
      {
        heading: 'Sıcak İçecekler',
        items: [
          { title: 'Elektrikli Çay Makineleri', href: '/kategori/icecek-hazirlama?ara=cay', isPopular: true },
          { title: 'Türk Kahvesi Makineleri', href: '/kategori/icecek-hazirlama?ara=kahve', isPopular: true },
          { title: 'Filtre Kahve & Espresso', href: '/kategori/icecek-hazirlama?ara=filtre' },
          { title: 'Su Isıtıcılar & Cam Kettle', href: '/kategori/icecek-hazirlama?ara=kettle' },
        ],
      },
      {
        heading: 'Özel Seriler',
        items: [
          { title: 'ST-ÇAYS Paslanmaz Çelik Çaycı', href: '/kategori/icecek-hazirlama', badge: 'En Sevilen' },
          { title: 'BİKAHVE Közde Kahve Teknolojisi', href: '/kategori/icecek-hazirlama' },
          { title: 'Çift Isıtıcı & Otomatik Sıcak Tutma', href: '/kategori/icecek-hazirlama' },
          { title: 'Taşmayı Önleyen Akıllı Sensör', href: '/kategori/icecek-hazirlama' },
        ],
      },
      {
        heading: 'Malzeme & Konfor',
        items: [
          { title: '18/10 Paslanmaz Çelik Gövde', href: '/kategori/icecek-hazirlama' },
          { title: 'BPA İçermeyen Cam Gövdeler', href: '/kategori/icecek-hazirlama' },
          { title: '360° Dönebilen Taban', href: '/kategori/icecek-hazirlama' },
          { title: 'Gizli Rezistans Güvenliği', href: '/kategori/icecek-hazirlama' },
        ],
      },
    ],
    promo: {
      tag: 'GÜNÜN KEYFİ',
      title: 'ST-ÇAYS & BİKAHVE Kahve Serisi',
      subtitle: 'Bol Köpüklü Közde Türk Kahvesi & Taptaze Demlenmiş Çay',
      link: '/kategori/icecek-hazirlama',
      imageUrl: '/uploads/products/29491381d1ca4364988e417a89beace0.webp',
      badgeText: 'Közde Kahve Lezzeti',
    },
  },
  'ev-temizligi': {
    slug: 'ev-temizligi',
    name: 'Ev Temizliği & Ütü',
    href: '/kategori/ev-temizligi',
    badge: 'Yeni Seri',
    groups: [
      {
        heading: 'Süpürge Sistemleri',
        items: [
          { title: 'Şarjlı Dikey Süpürgeler (BLDC)', href: '/kategori/ev-temizligi?ara=sarjli', isPopular: true, badge: 'BLDC Motor' },
          { title: 'Toz Torbasız Siklon Süpürgeler', href: '/kategori/ev-temizligi?ara=torbasiz' },
          { title: 'Islak & Kuru Süpürgeler', href: '/kategori/ev-temizligi?ara=supurge' },
          { title: 'Su Filtreli Temizlik Makineleri', href: '/kategori/ev-temizligi' },
        ],
      },
      {
        heading: 'Ütü & Bakım',
        items: [
          { title: 'Buharlı Ütüler', href: '/kategori/utu', isPopular: true },
          { title: 'Buhar Kazanlı Yüksek Basınçlı Ütüler', href: '/kategori/utu' },
          { title: 'Dikey Buharlı Kırışık Gidericiler', href: '/kategori/utu' },
          { title: 'Seramik Tabanlı Hızlı Ütüler', href: '/kategori/utu' },
        ],
      },
      {
        heading: 'Gelişmiş Hijyen',
        items: [
          { title: 'HEPA 13 Anti-Alerjik Filtre', href: '/kategori/ev-temizligi' },
          { title: '60 Dk Kesintisiz Güçlü Batarya', href: '/kategori/ev-temizligi' },
          { title: 'Işıklı LED Zemin Fırçası', href: '/kategori/ev-temizligi' },
          { title: 'Hafif & Ergonomik Gövde', href: '/kategori/ev-temizligi' },
        ],
      },
    ],
    promo: {
      tag: 'KABLOSUZ ÖZGÜRLÜK',
      title: 'ST-MEGATRON 2 BLDC Şarjlı Süpürge',
      subtitle: 'Dijital BLDC Motor, HEPA 13 Filtreleme & 60 Dk Yüksek Emiş',
      link: '/kategori/ev-temizligi',
      imageUrl: '/uploads/products/0e5092ffc7534dc893c5e61e33abf632.webp',
      badgeText: 'Dijital BLDC Motor',
    },
  },
  buzdolabi: {
    slug: 'buzdolabi',
    name: 'Soğutma & Beyaz Eşya',
    href: '/kategori/buzdolabi',
    groups: [
      {
        heading: 'Soğutma & Dondurma',
        items: [
          { title: 'No-Frost Buzdolapları', href: '/kategori/buzdolabi', isPopular: true },
          { title: 'Çift Kapılı Kombi Buzdolapları', href: '/kategori/buzdolabi' },
          { title: 'Sandık Tipi Derin Dondurucular', href: '/kategori/derin-dondurucu' },
          { title: 'Çekmeceli Derin Dondurucular', href: '/kategori/derin-dondurucu' },
          { title: 'Sıcak & Soğuk Su Sebilleri', href: '/kategori/su-sebili' },
        ],
      },
      {
        heading: 'Yıkama & Bakım',
        items: [
          { title: 'Otomatik Çamaşır Makineleri', href: '/kategori/camasir-makinesi' },
          { title: 'Ekonomik Bulaşık Makineleri', href: '/kategori/bulasik-makinesi' },
          { title: 'İnverter Duvar Tipi Klimalar', href: '/kategori/klima' },
        ],
      },
      {
        heading: 'KKTC Özel Avantajları',
        items: [
          { title: 'Randevulu Ücretsiz Yetkili Servis Kurulumu', href: '/teslimat' },
          { title: '3 Yıl Birebir Distribütör Garantisi', href: '/servis' },
          { title: 'Ada Geneli Adrese Teslimat', href: '/teslimat' },
          { title: 'Orijinal Yedek Parça Desteği', href: '/servis' },
        ],
      },
    ],
    promo: {
      tag: 'A++ ENERJİ VERİMLİLİĞİ',
      title: 'No-Frost Soğutma Sistemleri',
      subtitle: 'Tazeliği Uzatan Nem Kontrollü Çekmeceler & Sessiz İnverter Motor',
      link: '/kategori/buzdolabi',
      imageUrl: '/uploads/products/09f9e0b97afc4906ad560463b2ff1b0f.webp',
      badgeText: 'KKTC Stoktan Teslim',
    },
  },
  'kisisel-bakim': {
    slug: 'kisisel-bakim',
    name: 'Kişisel Bakım',
    href: '/kategori/kisisel-bakim',
    groups: [
      {
        heading: 'Kişisel Bakım',
        items: [
          { title: 'İyonik Saç Kurutma Makineleri', href: '/kategori/kisisel-bakim?ara=kurutma', isPopular: true },
          { title: 'Keratin Korumalı Saç Düzleştiriciler', href: '/kategori/kisisel-bakim?ara=duzlestirici' },
          { title: 'Saç Maşası & Şekillendiriciler', href: '/kategori/kisisel-bakim' },
          { title: 'Erkek Bakım & Tıraş Setleri', href: '/kategori/kisisel-bakim?ara=tiras' },
        ],
      },
      {
        heading: 'Ev & Yaşam',
        items: [
          { title: 'Baza & Yatak Başlıkları', href: '/kategori/baza' },
          { title: 'Ortopedik Yatak & Şilteler', href: '/kategori/silte' },
          { title: 'Ev Yaşam & Aksesuar Gereçleri', href: '/kategori/ev-gerecleri' },
        ],
      },
      {
        heading: 'Öne Çıkan Özellikler',
        items: [
          { title: 'Elektriklenmeyi Önleyen İyon Teknolojisi', href: '/kategori/kisisel-bakim' },
          { title: 'Seramik ve Turmalin Isıtıcı Plakalar', href: '/kategori/kisisel-bakim' },
          { title: 'Hızlı Isınma & Otomatik Kapanma', href: '/kategori/kisisel-bakim' },
          { title: '3 Yıl Resmi Stilsoft Garantisi', href: '/kategori/kisisel-bakim' },
        ],
      },
    ],
    promo: {
      tag: 'KİŞİSEL STİL',
      title: 'İyonik Saç Bakım & Şekillendirme',
      subtitle: 'Saçı Yıpratmayan Akıllı Isı Kontrolü & Işıltılı Şekillendirme',
      link: '/kategori/kisisel-bakim',
      imageUrl: '/uploads/products/25c47b518f454df29f6974920654a142.webp',
      badgeText: 'İyon Teknolojisi',
    },
  },
}
