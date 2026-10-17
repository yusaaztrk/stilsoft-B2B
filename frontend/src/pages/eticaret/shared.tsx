import React, { useCallback, useEffect, useState } from 'react'
import { Save, X } from 'lucide-react'

/*
  E-TİCARET PANELİ — ORTAK PARÇALAR (2026-09-21).

  Eskiden tek dosya (EticaretPage.tsx, ~3.900 satır) bütün sekmeleri, formları ve modalları
  taşıyordu; "Vitrin Yönetimi" tek başına 800 satırlık bir formdu. Kullanıcı: "yükü yeni
  sayfalara dağıt, hiçbiri hardcode olmasın, hepsi rol yetkisinde olsun". Artık her ekran
  `src/pages/eticaret/*Page.tsx` içinde kendi dosyası; menü/yetki anahtarı `eticaret/<key>`
  (Pages tablosunda satırı var, Rol Yetkileri'nden açılıp kapanır). Burada yalnız hepsinin
  ortak kullandığı tipler, yardımcılar, kancalar ve iskelet bileşenler duruyor.
*/

/**
 * Mağaza API'sinin adresi. Vitrin ile aynı sunucu; bayi paneli buraya kendi oturum
 * token'ıyla gider ve mağaza API'si o token'ı DOĞRULAR (imza + süre). Böylece mağaza
 * için ikinci bir kullanıcı yönetimi ve ikinci bir şifre olmuyor.
 */
export const SHOP_API =
  (import.meta as any).env?.VITE_SHOP_API_BASE_URL ||
  `${window.location.protocol}//${window.location.hostname}:5150`

/**
 * Vitrinin (mağaza sitesinin) adresi. "Vitrinde gör" bağlantıları buradan kuruluyor.
 *
 * Verilmezse bağlantı HİÇ GÖSTERİLMİYOR. Adresi API adresinden türetmek denenebilirdi ama
 * ikisi ayrı alan adlarında (api: example.com/shopapi, vitrin: example.com) ve
 * yerelde portları bile farklı; tahmin edilen bir adres kullanıcıyı 404'e gönderirdi.
 */
export const SHOP_SITE = String((import.meta as any).env?.VITE_SHOP_SITE_URL ?? '').replace(/\/+$/, '')

export type Banner = {
  id: string
  title: string
  subtitle?: string | null
  imageUrl?: string | null
  link?: string | null
  sortOrder: number
  isActive: boolean
}

export type Settings = {
  heroKicker: string
  heroTitle: string
  heroTitleStrong: string
  heroText: string
  heroButtonText: string
  heroButtonLink: string
  heroImageUrl?: string | null
  phoneNumber: string
  /** WhatsApp destek hattı — ülke koduyla, boşluksuz (ör. 905338408837). Telefon alanından ayrı: o alan sabit hat olabilir. */
  whatsAppNumber?: string
  showCategories: boolean
  showFeatured: boolean
  featuredCount: number
  /** "Çok satanlar" şeridine elle konan stok kodları; boşsa gerçek satış verisi. */
  bestSellerStockCodes?: string[]
  banners: Banner[]

  /** Kalan adet vitrinde gösterilsin mi. Kapalıyken sayı mağaza API'sinden hiç çıkmaz. */
  showStockQuantity?: boolean
  /** Gösterilen adedin tavanı (ERP/POS'taki "12+" kuralı). 0 = tavan yok. */
  stockDisplayCap?: number
  /** Bu adedin altında vitrin "Son N adet" uyarısı gösterir. */
  lowStockThreshold?: number
  /** Stokta olmayan ürün sipariş edilebilsin mi. Kapalıyken sunucu sepete eklemeyi reddeder. */
  allowOutOfStockOrders?: boolean
  /** Stoğu biten ürün vitrinden kalksın mı. */
  hideOutOfStock?: boolean
  /** Stok, ürün kartındaki satışa kapanma eşiğinin altına düşünce yayın dursun mu. */
  stopPublishingBelowCriticalStock?: boolean
  /** Aynı ürünün renkleri listede tek kartta toplansın mı (ürün adına bakan sezgi). */
  groupColorVariants?: boolean
  /** Ürün kartında "Satışa Açık: Hayır" işaretli ürünler vitrinden kalksın mı. */
  hideClosedToSale?: boolean
  /** Kritik stok kuralından muaf tutulan ürünler (panelden tek tek işaretlenir). */
  alwaysPublishStockCodes?: string[]

  /** Yasal metinlerde görünen satıcı bilgileri; koda gömülü değil. */
  companyName: string
  companyAddress: string
  companyEmail: string
  companyTaxInfo: string
  /** İletişim ve servis formlarının düşeceği kutu; boşsa firma e-postası kullanılır. */
  supportEmail?: string

  /* Satış artırma ayarları (2026-09-20). */
  turkeySiteUrl?: string
  gaMeasurementId?: string
  metaPixelId?: string
  clarityProjectId?: string
  deliveryPromise?: string
  exchangePolicy?: string
  googleReviewsUrl?: string
  testimonials?: Array<{ name: string; location: string; text: string; date: string; rating?: number }>
  bankTransferAccounts?: Array<{ bankName: string; accountHolder: string; iban: string; currency?: string }>
  bankTransferTimeoutHours?: number
  /** Havale bildirimi gelmeyen müşteriye kaç saat sonra tek hatırlatma SMS'i gitsin (0 = kapalı). */
  bankTransferReminderHours?: number
  /** SMS kapalıyken de üyesiz sipariş alınsın mı (numara doğrulanmaz). */
  allowGuestCheckoutWithoutSms?: boolean
  cartReminderEnabled?: boolean
  cartReminderDelayHours?: number
  cartReminderText?: string

  /** Sosyal medya adresleri ve Google Haritalar gömme adresi. Boşsa gerçek Stilsoft hesapları kullanılır. */
  instagramUrl?: string
  facebookUrl?: string
  youtubeUrl?: string
  mapsEmbedSrc?: string
  /** Showroom (mağaza) haritası. `mapsEmbedSrc` merkez ofisin haritası — ikisi ayrı adres. */
  showroomMapsEmbedSrc?: string
  /** Çalışma saatleri; her satır `Gün|Saat`. */
  workingHours?: string

  /** Kategori adresi → tanıtım metni (SEO). */
  categoryTexts: Record<string, string>
  logoImageUrl?: string | null
  categoryOverrides?: Record<string, { displayName?: string; slug?: string; hidden?: boolean; sortOrder?: number }>
}

/**
 * Yönetim ucundan gelen kategori. `erpName` ERP'deki ham ad, `displayName` bayinin vitrin
 * için verdiği ad. İkisi ayrı tutuluyor ki bayi neyin üzerine yazdığını görebilsin.
 */
export type ShopCategory = {
  slug: string
  erpName: string
  productCount: number
  displayName: string
  hidden: boolean
  sortOrder: number
}

export type AdminProduct = {
  stockCode: string
  name: string
  /** Vitrindeki adres — "Vitrinde gör" bağlantısı bununla kuruluyor. */
  slug: string
  categoryName?: string | null
  grossPrice: number
  currency: string
  imageUrl?: string | null
  isInstallable: boolean
  installationFee?: number | null

  /** ERP'deki gerçek stok adedi. */
  stock: number
  /** Ürün kartındaki "Satışa Kapanma Eşiği" (BsyMinStock). 0 = eşik yok. */
  criticalThreshold: number
  /** Ürün kartında "Satışa Açık" seçili mi. */
  markedOpenToSale: boolean

  isHidden: boolean
  /** "Kritik stokta da yayında kalsın" işareti. */
  alwaysPublish: boolean
  /** Kural sonucunda vitrinde görünüyor mu. */
  isPublished: boolean
  /** None · Hidden · ClosedToSale · OutOfStock · CriticalStock */
  blockReason: string
  blockLabel: string

  /** Anasayfadaki sırası; işaretli değilse null. */
  featuredOrder?: number | null
}

/** Ürün listesinin üstündeki sayaçlar ve o an geçerli yayın kuralları. */
export type ProductStats = {
  totalCount: number
  publishedCount: number
  criticalCount: number
  outOfStockCount: number
  closedCount: number
  hiddenCount: number
  rules: {
    hideOutOfStock: boolean
    stopPublishingBelowCriticalStock: boolean
    hideClosedToSale: boolean
    allowOutOfStockOrders: boolean
    defaultThreshold: number
  }
}

/** Ürün listesi süzgeci — üstteki sayaç kutularına tıklayınca da değişiyor. */
export type ProductFilter = 'hepsi' | 'yayinda' | 'kritik' | 'stokYok' | 'kapali' | 'elleKapali' | 'oneCikan'

export type ShopOrder = {
  orderNo: string
  customerCode: string
  customerName?: string | null
  customerPhone?: string | null
  processedAt: string
  grandTotal: number
  lineCount: number
  /** Montaj seçilen kalem sayısı — bu kalemler kargoya girmiyor. */
  montageCount: number
  /** Montajsız kalem var mı; yoksa teslimat kaydı hiç açılmıyor. */
  hasCargo: boolean
  isCancelled: boolean
  paymentStatus: string
  isPaid: boolean
  paidAt?: string | null
  invoiceNo?: string | null
  invoiceDate?: string | null
}

/** Siparişin ServiceOps'taki teslimat durumu (müşteriye de gösterilebilen dar hâli). */
export type CargoSnapshot = {
  exists: boolean
  status: number
  statusLabel: string
  plannedDate?: string | null
  updatedAt?: string | null
  history: { status: number; statusLabel: string; timestamp: string }[]
}

export type ShopMember = {
  id: string
  email: string
  fullName: string
  phone?: string | null
  customerCode?: string | null
  isActive: boolean
  createdAt: string
  lastLoginAt?: string | null
  cartLines: number
}

export type Finding = {
  kind: string
  severity: 'kritik' | 'uyari' | 'bilgi'
  orderNo: string
  customerCode: string
  customerName?: string | null
  orderTotal: number
  paidAmount?: number | null
  invoiceNo?: string | null
  orderedAt: string
  message: string
}

export type Reconciliation = {
  window: number
  generatedAt: string
  counts: { kritik: number; uyari: number; bilgi: number }
  findings: Finding[]
}

export type ContentPage = {
  id: string
  slug: string
  title: string
  summary?: string | null
  body: string
  isPublished: boolean
  showInFooter: boolean
  sortOrder: number
  updatedAt: string
  updatedBy?: string | null
}

export type OrderEvent = { event: string; detail?: string | null; clientIp?: string | null; createdAt: string }

export type OrderLine = {
  lineNo: number
  stockCode: string
  productName?: string | null
  quantity: number
  unitPrice: number
  vatRate: number
  lineTotal: number
  description?: string | null
  /** Müşteri bu kalem için montaj istedi mi. Montajlı kalem kargoya girmez. */
  montage?: boolean
  /** Açılmış montaj kaydının durumu (Yeni Kayıt / Planlandı / Gerçekleşti / İptal). */
  installationStatus?: string | null
}

export type OrderDetail = {
  orderNo: string
  customerCode: string
  customerName?: string | null
  customerPhone?: string | null
  customerAddress?: string | null
  processedAt: string
  subtotal: number
  vatTotal: number
  grandTotal: number
  lines: OrderLine[]
  paymentStatus: string
  isPaid: boolean
  paidAt?: string | null
  paidAmount?: number | null
  paymentAttempts: number
  invoices: { invoiceNo: string; date: string }[]
  isCancelled?: boolean
  /** ServiceOps'taki teslimat kaydı. Kayıt yoksa exists=false gelir. */
  cargo?: CargoSnapshot
  /** Siparişte montajsız kalem var mı; yoksa kargo kaydı beklenmiyor demektir. */
  cargoExpected?: boolean
  montageCount?: number
}

export type MemberActivity = {
  member: ShopMember
  orders: Array<{ orderNo: string; processedAt: string; grandTotal: number; paymentStatus: string; invoiceNo?: string | null }>
  invoices: Array<{ invoiceNo: string; date: string; grandTotal: number }>
  note?: string
}

export type MemberForm = {
  id?: string
  email: string
  fullName: string
  phone: string
  city: string
  district: string
  address: string
  password: string
}

export const emptyMemberForm: MemberForm = {
  email: '',
  fullName: '',
  phone: '',
  city: '',
  district: '',
  address: '',
  password: ''
}

export const emptyPage: ContentPage = {
  id: '',
  slug: '',
  title: '',
  summary: '',
  body: '',
  isPublished: false,
  showInFooter: false,
  sortOrder: 0,
  updatedAt: ''
}


export function authHeaders(json = true): Record<string, string> {
  const token = localStorage.getItem('accessToken')
  const tenantCode = String(localStorage.getItem('tenantCode') ?? '').trim()
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenantCode ? { 'X-Tenant-Code': tenantCode } : {})
  }
}

export function formatPrice(value: number, currency: string) {
  const symbol = currency === 'TRY' ? '₺' : currency
  return `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ${symbol}`
}

export function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '-'
    : date.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Ödeme durumunun müşteriye değil BAYİYE anlatılması: "Pending" bir hata değil, müşteri henüz
 * banka sayfasından dönmemiş demek. Ekranda İngilizce durum adı görünmesi bunu her seferinde
 * yeniden açıklamak gerektiriyordu.
 */
export const paymentLabels: Record<string, { text: string; className: string }> = {
  Paid: { text: 'Ödendi', className: 'bg-green-50 border-green-200 text-green-700' },
  Pending: { text: 'Ödeme bekleniyor', className: 'bg-amber-50 border-amber-200 text-amber-700' },
  Failed: { text: 'Ödeme başarısız', className: 'bg-red-50 border-red-200 text-red-700' },
  NeedsReview: { text: 'İnceleme gerekiyor', className: 'bg-red-100 border-red-300 text-red-800' }
}

export const btnDark =
  'h-11 px-5 rounded-2xl bg-gray-900 text-white text-sm font-semibold hover:bg-black disabled:opacity-60 inline-flex items-center gap-2'
export const btnGhost =
  'h-11 px-5 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 inline-flex items-center gap-2'

/**
 * Ortak kalıcı pencere.
 *
 * Panelde dört yerde aynı iskelet gerekiyordu (üye formu, şifre, sayfa düzenleyici, sipariş
 * detayı). Dördünü ayrı yazmak, birinde yapılan düzeltmenin diğer üçüne geçmemesi demekti.
 * Arka plana tıklayınca kapanıyor ama İÇERİĞE tıklayınca kapanmıyor — form doldururken yanlışlıkla
 * kapanan pencere, girilen her şeyin kaybı olurdu.
 */

export function Modal({
  title,
  children,
  footer,
  onClose,
  wide
}: {
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  onClose: () => void
  wide?: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-gray-900/40 backdrop-blur-[2px] flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className={`bg-white rounded-3xl border border-gray-200 shadow-xl w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} my-8`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div className="text-base font-extrabold text-gray-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 inline-flex items-center justify-center"
            aria-label="Kapat"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5">{children}</div>

        {footer && (
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-2">{footer}</div>
        )}
      </div>
    </div>
  )
}

export const label = 'block text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] ml-1'
export const input =
    'mt-1 w-full h-11 px-4 rounded-2xl border border-gray-200 bg-white text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900/30 transition'

/* ----------------------------------------------------------------- kancalar */

export type PanelMessage = { kind: 'ok' | 'err'; text: string } | null

/** Sayfa üstünde 4 sn görünen sonuç mesajı. */
export function usePanelMessage() {
  const [message, setMessage] = useState<PanelMessage>(null)
  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setMessage({ kind, text })
    window.setTimeout(() => setMessage(null), 4000)
  }, [])
  return { message, notify }
}

/** Gövde tek istekle döner; hata olduğunda mesaj sunucudan gelen metinle verilir. */
export async function send(path: string, method: string, body?: unknown) {
  const res = await fetch(`${SHOP_API}${path}`, {
    method,
    headers: authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.message ?? 'İşlem tamamlanamadı.')
  return data
}

/**
 * Vitrin ayarları (tek JSON, `/api/storefront` ↔ `/api/admin/storefront`).
 * Beş ayar sayfası aynı blobu okur, kendi alanlarını değiştirir, TAMAMINI kaydeder — mağaza
 * API'si kısmi güncelleme bilmiyor. İki sayfa aynı anda açıkken son kaydeden kazanır (eskiden
 * de böyleydi; tek sayfa iki sekmede açıkken aynı durum vardı).
 */
export function useStorefrontSettings(notify: (kind: 'ok' | 'err', text: string) => void) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch(`${SHOP_API}/api/storefront`, { headers: authHeaders(false) })
      if (!res.ok) throw new Error()
      setSettings(await res.json())
    } catch {
      notify('err', 'Mağaza ayarları okunamadı. Mağaza servisi çalışıyor mu?')
    }
  }, [notify])

  useEffect(() => { void loadSettings() }, [loadSettings])

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))

  const saveSettings = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch(`${SHOP_API}/api/admin/storefront`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(settings)
      })
      if (!res.ok) throw new Error()
      notify('ok', 'Vitrin ayarları kaydedildi.')
    } catch {
      notify('err', 'Kaydedilemedi.')
    } finally {
      setSaving(false)
    }
  }

  return { settings, setSettings, update, loadSettings, saveSettings, saving }
}

/** Sağlayıcının verdiği son gönderim hataları — "SMS gitmiyor" teşhisinin tek işe yarar bilgisi. */
export type SmsFailure = { atUtc: string; phone: string; errorCode: string }

export type SmsStatus = {
  configured: boolean
  credit: number | null
  /** Doğrulama kodu (OTP) bakiyesi — TMessage'ta ayrı (2026-10-11). Eski sağlayıcıda null. */
  otpCredit?: number | null
  senderName: string | null
  message: string | null
  recentFailures?: SmsFailure[]
} | null

export function useSmsStatus() {
  const [smsStatus, setSmsStatus] = useState<SmsStatus>(null)
  const loadSmsStatus = useCallback(async () => {
    try {
      const res = await fetch(`${SHOP_API}/api/admin/sms-status`, { headers: authHeaders(false) })
      if (res.ok) setSmsStatus(await res.json())
    } catch {
      setSmsStatus(null)
    }
  }, [])
  useEffect(() => { void loadSmsStatus() }, [loadSmsStatus])
  return { smsStatus, loadSmsStatus }
}

export function useShopCategories() {
  const [categories, setCategories] = useState<ShopCategory[]>([])
  const loadCategories = useCallback(async () => {
    try {
      // Yönetim ucu: gizlenen kategoriler de geliyor; vitrin ucu onları eliyor.
      const res = await fetch(`${SHOP_API}/api/admin/categories`, { headers: authHeaders(false) })
      if (res.ok) setCategories(await res.json())
    } catch {
      /* kategori listesi kritik değil */
    }
  }, [])
  useEffect(() => { void loadCategories() }, [loadCategories])
  return { categories, loadCategories }
}

export type ShopSummary = { publishedProducts: number; hiddenProducts: number; categories: number } | null

export function useShopSummary() {
  const [summary, setSummary] = useState<ShopSummary>(null)
  const loadSummary = useCallback(async () => {
    try {
      const res = await fetch(`${SHOP_API}/api/admin/summary`, { headers: authHeaders(false) })
      if (res.ok) setSummary(await res.json())
    } catch {
      /* özet kutuları kritik değil */
    }
  }, [])
  useEffect(() => { void loadSummary() }, [loadSummary])
  return { summary, loadSummary }
}

/* ----------------------------------------------------------------- iskelet */

export function PageHeader({ title, desc, right }: { title: string; desc: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3 mb-5">
      <div className="min-w-0">
        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-500">E-Ticaret</div>
        <h2 className="text-xl font-black text-gray-900 tracking-tight mt-1">{title}</h2>
        <p className="text-sm text-gray-500 mt-1">{desc}</p>
      </div>
      {right}
    </div>
  )
}

export function SummaryCards({ summary }: { summary: ShopSummary }) {
  if (!summary) return null
  return (
    <div className="flex flex-wrap gap-2">
      <div className="px-4 py-2 rounded-2xl border border-gray-200 bg-white">
        <div className="text-[10px] font-bold text-gray-500 uppercase">Yayında</div>
        <div className="text-lg font-black text-gray-900">{summary.publishedProducts}</div>
      </div>
      <div className="px-4 py-2 rounded-2xl border border-gray-200 bg-white">
        <div className="text-[10px] font-bold text-gray-500 uppercase">Kapalı</div>
        <div className="text-lg font-black text-gray-900">{summary.hiddenProducts}</div>
      </div>
      <div className="px-4 py-2 rounded-2xl border border-gray-200 bg-white">
        <div className="text-[10px] font-bold text-gray-500 uppercase">Kategori</div>
        <div className="text-lg font-black text-gray-900">{summary.categories}</div>
      </div>
    </div>
  )
}

export function MessageBanner({ message }: { message: PanelMessage }) {
  if (!message) return null
  return (
    <div
      className={`mb-4 px-4 py-3 rounded-2xl text-sm font-semibold border ${
        message.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'
      }`}
    >
      {message.text}
    </div>
  )
}

export function SaveBar({ saving, onSave }: { saving: boolean; onSave: () => void }) {
  return (
    <div className="flex items-center justify-end gap-2 mt-4">
      <button type="button" disabled={saving} onClick={onSave} className={btnDark}>
        <Save size={16} />
        {saving ? 'Kaydediliyor...' : 'Kaydet'}
      </button>
    </div>
  )
}
