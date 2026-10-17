/**
 * Mağaza API'sine sunucu tarafından yapılan çağrılar.
 *
 * Adres tarayıcıya sızmıyor (NEXT_PUBLIC_ öneki yok): sayfalar sunucuda render edildiği için
 * API'nin internete açık olması gerekmiyor. Bu, hem SEO hem güvenlik açısından tercih edilen yol.
 */
const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

export type CatalogItem = {
  stockCode: string
  slug: string
  name: string
  categoryName?: string | null
  categorySlug?: string | null
  imageUrl?: string | null
  netPrice: number
  grossPrice: number
  taxRate: number
  currency: string
  inStock: boolean
  /**
   * Kalan adet. Bayi "stok adedi görünsün" ayarını AÇMADIYSA alan hiç gelmez (null/undefined):
   * mağaza API'si sayıyı yanıttan düşürüyor, vitrin gizlemekle uğraşmıyor.
   */
  stockQuantity?: number | null
  /**
   * Adet tavana takıldıysa true — vitrin sayıyı "12+" biçiminde yazar. ERP/POS ekranlarındaki
   * kuralın aynısı (5 → 5, 11 → 11, 12 ve üzeri → 12+); tavan bayi panelinden ayarlanıyor.
   */
  stockCapped?: boolean
  isInstallable: boolean
  installationFee?: number | null
  /*
    KAMPANYA (2026-09-19): B2B'de açılıp e-ticaret anahtarı açılmış indirim. `originalGrossPrice`
    doluysa üstü çizili eski fiyat, `grossPrice` yeni fiyat; `campaignPercent` oran
    kampanyasında yüzde. Hesap mağaza API'sinde (Shop.Api CampaignPricing), vitrinde sayı
    ÜRETİLMEZ — ProductCard'daki "eski fiyat hesaplanmaz" notu geçerli.
  */
  originalGrossPrice?: number | null
  campaignName?: string | null
  campaignPercent?: number | null
  campaignDiscountGross?: number | null
  /*
    RENK SEÇENEKLERİ (2026-09-20): ERP'de her renk ayrı stok kodu. Bayi panelden gruplamayı
    açtıysa listede tek kart görünür ve `variantCount` kaç renk olduğunu söyler; renk seçimi
    ürün sayfasında yapılır. Gruplama kapalıyken bu alanlar hiç gelmez.
  */
  variantLabel?: string | null
  variantCount?: number
}

/** Ürün sayfasındaki renk seçeneği. Sepete giden yine seçilen rengin kendi stok kodu. */
export type VariantOption = {
  stockCode: string
  slug: string
  label: string
  imageUrl?: string | null
  grossPrice: number
  inStock: boolean
}

export type CatalogDetail = CatalogItem & {
  description?: string | null
  features: string[]
  images: string[]
  barcode?: string | null
  unit?: string | null
  /** Aynı ürünün renkleri; bu ürün de listede. Seçenek yoksa boş dizi. */
  variants?: VariantOption[]
}

export type CatalogCategory = { slug: string; name: string; productCount: number; imageUrl?: string | null }

export type CatalogPage = {
  items: CatalogItem[]
  totalCount: number
  page: number
  pageSize: number
  /** Fiyat süzgeci uygulanmadan önceki aralık — süzgeç kutularının sınırları buradan. */
  minPrice: number
  maxPrice: number
}

/**
 * Katalog saatlerce değişmeyen veri; her istekte ERP'ye gitmek hem yavaş hem gereksiz.
 * 5 dakikalık önbellek, fiyat güncellemesinin vitrine yansıma süresini kabul edilebilir
 * tutarken sayfa hızını (Google'ın doğrudan sıralama sinyali) koruyor.
 */
const revalidate = 300

async function get<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API}${path}`, { next: { revalidate } })
    if (!res.ok) return fallback
    return (await res.json()) as T
  } catch {
    // API kapalıysa sayfa çökmesin; boş vitrin, hata ekranından iyidir.
    return fallback
  }
}

const emptyPage: CatalogPage = { items: [], totalCount: 0, page: 1, pageSize: 24, minPrice: 0, maxPrice: 0 }

export function listProducts(params: {
  kategori?: string
  ara?: string
  sirala?: string
  sayfa?: number
  adet?: number
  minFiyat?: number
  maxFiyat?: number
  stokta?: boolean
  montaj?: boolean
  kampanya?: boolean
  /**
   * Aramanın kaynağı. Yalnız 'arama' değeri mağaza API'sinde kaydediliyor (ne arandığı /
   * sonuç çıkmayan aramalar raporu). Menüdeki hazır bağlantılar da `ara=...` taşıdığı için
   * bunu göndermiyor — yoksa rapor, kimsenin yazmadığı terimlerle dolardı.
   */
  kaynak?: 'arama'
}): Promise<CatalogPage> {
  const qs = new URLSearchParams()
  if (params.kategori) qs.set('kategori', params.kategori)
  if (params.ara) qs.set('ara', params.ara)
  if (params.sirala) qs.set('sirala', params.sirala)
  if (params.sayfa) qs.set('sayfa', String(params.sayfa))
  if (params.adet) qs.set('adet', String(params.adet))
  if (params.minFiyat !== undefined) qs.set('minFiyat', String(params.minFiyat))
  if (params.maxFiyat !== undefined) qs.set('maxFiyat', String(params.maxFiyat))
  if (params.stokta) qs.set('stokta', 'true')
  if (params.montaj) qs.set('montaj', 'true')
  if (params.kampanya) qs.set('kampanya', 'true')
  if (params.kaynak) qs.set('kaynak', params.kaynak)

  return get<CatalogPage>(`/api/catalog/products?${qs.toString()}`, emptyPage)
}

export function getProduct(slug: string): Promise<CatalogDetail | null> {
  return get<CatalogDetail | null>(`/api/catalog/products/${encodeURIComponent(slug)}`, null)
}

export function listCategories(): Promise<CatalogCategory[]> {
  return get<CatalogCategory[]>('/api/catalog/categories', [])
}

/**
 * ERP'de TANIMLI kategori adresleri — o an yayında ürünü olmasa da.
 *
 * Kategori sayfası "böyle bir kategori var mı" sorusu için kullanıyor: stok kuralı bir
 * kategoriyi geçici olarak boşalttığında 404 yerine "şu anda ürün yok" ekranı gösteriliyor.
 * Menüdeki ve altbilgideki kategori bağlantıları sabit yazılı, o yüzden kırık bağlantı
 * ziyaretçiye doğrudan görünüyordu.
 */
export function listKnownCategorySlugs(): Promise<string[]> {
  return get<string[]>('/api/catalog/categories/known', [])
}

/**
 * Eski kategori adresi -> bayinin verdiği yeni adres.
 *
 * ERP kategori adları kısaltma ("G.HAZIR") olduğu için adresler okunmazdı ve menüdeki
 * okunur bağlantılar hiçbir ürüne denk gelmiyordu. Bayi panelden kategoriye kendi adresini
 * verebiliyor; eski adresle gelen ziyaretçi kalıcı yönlendirmeyle (308) yenisine yollanıyor, böylece
 * paylaşılmış bağlantılar ve Google sıralaması kaybolmuyor.
 *
 * Adres verilmemişse eşleme boş döner ve hiçbir yönlendirme kurulmaz.
 */
export function listCategorySlugRedirects(): Promise<Record<string, string>> {
  return get<Record<string, string>>('/api/catalog/categories/slug-redirects', {})
}

/**
 * ÇOK SATANLAR — gerçek sipariş verisinden (2026-09-21).
 *
 * `listFeatured` bayinin ELLE seçtikleri; bu liste neyin gerçekten satıldığını gösteriyor.
 * Sipariş yoksa boş döner ve bölüm hiç görünmez — uydurma bir "popüler" listesi üretilmiyor.
 */
/** Ürün sayfası taksit tablosu (2026-09-21) — ERP'deki banka kurallarından, yalnız okuma. */
export type InstallmentInfo = {
  banks: Array<{ bankCode: number; bankName: string; options: Array<{ count: number; text: string; minAmount: number; monthly?: number | null }> }>
  maxInstallment: number
}

export function getInstallmentInfo(amount: number): Promise<InstallmentInfo> {
  return get<InstallmentInfo>(`/api/catalog/installments?tutar=${encodeURIComponent(amount.toFixed(2))}`, { banks: [], maxInstallment: 0 })
}

export function listBestSellers(adet = 8, gun = 90): Promise<CatalogItem[]> {
  return get<CatalogItem[]>(`/api/catalog/best-sellers?adet=${adet}&gun=${gun}`, [])
}

export function listFeatured(adet = 8): Promise<CatalogItem[]> {
  return get<CatalogItem[]>(`/api/catalog/featured?adet=${adet}`, [])
}

/** Anasayfadaki "Kataloglarımız" bölümü — PDF katalog listesi (ürün kataloğuyla karıştırma). */
export type PdfCatalog = {
  id: string
  title: string
  pdfUrl: string
  coverImageUrl?: string | null
  sortOrder: number
  isActive: boolean
}

/**
 * Mağaza API'sinin TARAYICIDAN erişilebilir adresi. `API` (yukarıda) sunucu-sunucu çağrısı
 * için, yerelde ikisi aynı olsa da canlıda farklı olabilir (bkz. lib/format.ts MEDIA sabiti,
 * aynı ayrım orada da var). PDF linki tarayıcıda açılacağı için bu adres gerekiyor.
 */
const PUBLIC_SHOP_API = process.env.NEXT_PUBLIC_SHOP_API_URL ?? 'http://localhost:5150'

export async function listPdfCatalogs(): Promise<PdfCatalog[]> {
  const items = await get<PdfCatalog[]>('/api/catalogs', [])
  return items.map((c) => ({
    ...c,
    pdfUrl: c.pdfUrl.startsWith('http') ? c.pdfUrl : `${PUBLIC_SHOP_API}${c.pdfUrl}`,
    coverImageUrl: c.coverImageUrl
      ? c.coverImageUrl.startsWith('http') ? c.coverImageUrl : `${PUBLIC_SHOP_API}${c.coverImageUrl}`
      : c.coverImageUrl
  }))
}

export type StorefrontBanner = {
  id: string
  title: string
  subtitle?: string | null
  imageUrl?: string | null
  link?: string | null
  sortOrder: number
  isActive: boolean
}

export type StorefrontSettings = {
  heroKicker: string
  heroTitle: string
  heroTitleStrong: string
  heroText: string
  heroButtonText: string
  heroButtonLink: string
  heroImageUrl?: string | null
  logoImageUrl?: string | null
  phoneNumber: string
  /** WhatsApp destek hattı, ülke koduyla boşluksuz. Boşsa yüzen WhatsApp butonu gösterilmez. */
  whatsAppNumber?: string
  /** Sosyal medya adresleri — panelden yönetilir, boşsa gerçek Stilsoft hesapları kullanılır. */
  instagramUrl: string
  facebookUrl: string
  youtubeUrl: string
  /** Google Haritalar iframe src'i. Boşsa iletişim sayfasında harita gösterilmez. */
  mapsEmbedSrc: string
  /** Showroom (mağaza) haritası. `mapsEmbedSrc` merkez ofisin haritasıdır — ikisi ayrı adres. */
  showroomMapsEmbedSrc: string
  /** Çalışma saatleri; her satır `Gün|Saat`. Ayırıcı yoksa satır olduğu gibi basılır. */
  workingHours: string
  showCategories: boolean
  showFeatured: boolean
  featuredCount: number
  /** Panelden elle seçilen "çok satanlar"; boşsa gerçek satış verisi kullanılır. */
  bestSellerStockCodes?: string[]
  banners: StorefrontBanner[]

  /** Kalan adet müşteriye gösterilsin mi. Kapalıyken `CatalogItem.stockQuantity` hiç gelmez. */
  showStockQuantity: boolean
  /** Gösterilen adedin tavanı. 12 iken 12 ve üzeri stok "12+" yazılır. 0 = tavan yok. */
  stockDisplayCap: number
  /** Bu adedin altında "son N adet" uyarısı çıkar. Adet gizliyken de çalışır. */
  lowStockThreshold: number
  /** Stokta olmayan ürün sepete eklenebilsin mi. Kapalıyken sunucu sepete eklemeyi reddeder. */
  allowOutOfStockOrders: boolean

  /**
   * Yasal metinlerde geçen satıcı bilgileri. Bayi panelinden doldurulur; koda gömülmez.
   * Boş geldiğinde sayfalar eksik olduğunu açıkça yazar.
   */
  companyName: string
  companyAddress: string
  companyEmail: string
  companyTaxInfo: string

  /** Kategori adresi → tanıtım metni. Boşsa kategori sayfası metinsiz görünür. */
  categoryTexts: Record<string, string>

  /* Satış artırma ayarları (2026-09-20) — panelden. */
  turkeySiteUrl?: string
  gaMeasurementId?: string
  metaPixelId?: string
  clarityProjectId?: string
  deliveryPromise?: string
  /**
   * SMS servisi kapalıyken de üyesiz sipariş alınsın mı (2026-09-20, panelden açılır).
   * Kapalıyken ödeme adımı eski davranışa düşer: e-posta + şifreyle giriş.
   */
  allowGuestCheckoutWithoutSms?: boolean
  exchangePolicy?: string
  googleReviewsUrl?: string
  testimonials?: Array<{ name: string; location: string; text: string; date: string; rating?: number }>
  bankTransferAccounts?: Array<{ bankName: string; accountHolder: string; iban: string; currency?: string }>
  bankTransferTimeoutHours?: number
}

const defaultSettings: StorefrontSettings = {
  heroKicker: 'Ankastre Set Kampanyası',
  heroTitle: 'Mutfağınızı tek seferde kurun.',
  heroTitleStrong: 'tek seferde',
  heroText:
    'Ocak, fırın ve davlumbaz birlikte alındığında set fiyatı geçerlidir. Teslimat, kurulum ve servis KKTC genelinde kendi ekibimizle.',
  heroButtonText: 'Ürünleri incele',
  heroButtonLink: '/urunler',
  heroImageUrl: null,
  logoImageUrl: null,
  phoneNumber: '0850 000 00 00',
  instagramUrl: 'https://www.instagram.com/',
  facebookUrl: 'https://www.facebook.com/',
  youtubeUrl: 'https://www.youtube.com/',
  mapsEmbedSrc: '',
  showroomMapsEmbedSrc: '',
  workingHours: '',
  showCategories: true,
  showFeatured: true,
  featuredCount: 8,
  bestSellerStockCodes: [],
  banners: [],
  showStockQuantity: false,
  stockDisplayCap: 12,
  lowStockThreshold: 5,
  allowOutOfStockOrders: false,
  companyName: '',
  companyAddress: '',
  companyEmail: '',
  companyTaxInfo: '',
  categoryTexts: {},
}

/**
 * Vitrin içeriği bayiden yönetiliyor. Ayar okunamazsa varsayılana düşülür —
 * mağaza içerik servisi yüzünden kapanmamalı.
 */
export function getStorefront(): Promise<StorefrontSettings> {
  return get<StorefrontSettings>('/api/storefront', defaultSettings)
}

export function listAllSlugs(): Promise<string[]> {
  return get<string[]>('/api/catalog/slugs', [])
}

export type SmsStatus = {
  /** SMS doğrulama açık mı. Kredentials girilmemişken false gelir. */
  enabled: boolean
  codeLength: number
  resendAfterSeconds: number
}

/**
 * SMS doğrulamasının açık olup olmadığı — kayıt ve şifre sıfırlama ekranları adımı buna
 * göre gösteriyor.
 *
 * Hata durumunda <b>kapalı</b> varsayılıyor: mağaza API'sine ulaşılamadığında kullanıcıya
 * hiç gelmeyecek bir kodu bekletmek, doğrulama adımını hiç göstermemekten kötü.
 */
export function getSmsStatus(): Promise<SmsStatus> {
  return get<SmsStatus>('/api/account/sms-status', {
    enabled: false,
    codeLength: 6,
    resendAfterSeconds: 60,
  })
}

/**
 * Bayinin yazdığı içerik sayfaları.
 *
 * Yasal sayfalardan (mesafeli satış, KVKK, çerez) AYRI: onlar kod içinde, tablolu yapıları ve
 * firma bilgisini ayarlardan çeken alanları olduğu için. Bunlar "Hakkımızda", "Sıkça sorulanlar"
 * gibi bayinin serbest yazdığı metinler.
 */
export type ContentPageSummary = {
  slug: string
  title: string
  summary?: string | null
  showInFooter: boolean
  sortOrder: number
  updatedAt: string
}

export type ContentPageDetail = {
  slug: string
  title: string
  summary?: string | null
  body: string
  updatedAt: string
}

export function listContentPages(): Promise<ContentPageSummary[]> {
  return get<ContentPageSummary[]>('/api/pages', [])
}

export function getContentPage(slug: string): Promise<ContentPageDetail | null> {
  return get<ContentPageDetail | null>(`/api/pages/${encodeURIComponent(slug)}`, null)
}
