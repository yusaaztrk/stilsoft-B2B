/**
 * REKLAM ÖLÇÜMÜ — GA4 ve Meta Pixel olayları tek yerden (2026-10-15).
 *
 * NEDEN: GA4 ve Pixel kimlikleri panelden giriliyor ve `app/layout.tsx` yalnız sayfa
 * görüntülemesini basıyordu. Reklam platformları "kim sepete ekledi, kim satın aldı, kim
 * WhatsApp'a yazdı" bilgisini alamadığı için reklamı satış yapan kişiye göstermeyi
 * öğrenemiyordu; harcamanın neye döndüğü de görünmüyordu.
 *
 * KURAL: kimlik panelde boşsa `gtag` / `fbq` sayfada hiç yoktur ve buradaki her çağrı sessizce
 * hiçbir şey yapmaz. Ölçüm hiçbir koşulda sayfanın çalışmasını bozmamalı; her çağrı try/catch
 * içinde.
 *
 * Olay adları GA4'ün önerilen e-ticaret adları (view_item, add_to_cart, begin_checkout,
 * purchase) — Google Ads dönüşümleri GA4'ten içe aktarılırken bu adlar tanınıyor. Meta
 * tarafında standart olaylar (ViewContent, AddToCart, InitiateCheckout, Purchase, Contact).
 */

type Gtag = (...args: unknown[]) => void
type Fbq = (...args: unknown[]) => void

declare global {
  interface Window {
    gtag?: Gtag
    fbq?: Fbq
  }
}

export type TrackItem = {
  stockCode: string
  name: string
  price: number
  quantity?: number
  category?: string | null
}

const CURRENCY = 'TRY'

function gtag(...args: unknown[]) {
  try {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') window.gtag(...args)
  } catch {
    /* ölçüm sayfayı bozmamalı */
  }
}

function fbq(...args: unknown[]) {
  try {
    if (typeof window !== 'undefined' && typeof window.fbq === 'function') window.fbq(...args)
  } catch {
    /* ölçüm sayfayı bozmamalı */
  }
}

const round = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100

function gaItems(items: TrackItem[]) {
  return items.map((i) => ({
    item_id: i.stockCode,
    item_name: i.name,
    item_brand: 'Stilsoft',
    ...(i.category ? { item_category: i.category } : {}),
    price: round(i.price),
    quantity: i.quantity ?? 1,
  }))
}

function metaContents(items: TrackItem[]) {
  return {
    content_ids: items.map((i) => i.stockCode),
    contents: items.map((i) => ({ id: i.stockCode, quantity: i.quantity ?? 1, item_price: round(i.price) })),
    content_type: 'product',
  }
}

const total = (items: TrackItem[]) => round(items.reduce((s, i) => s + i.price * (i.quantity ?? 1), 0))

export function trackViewItem(item: TrackItem) {
  const value = round(item.price)
  gtag('event', 'view_item', { currency: CURRENCY, value, items: gaItems([item]) })
  fbq('track', 'ViewContent', { ...metaContents([item]), content_name: item.name, value, currency: CURRENCY })
}

export function trackAddToCart(item: TrackItem) {
  const value = total([item])
  gtag('event', 'add_to_cart', { currency: CURRENCY, value, items: gaItems([item]) })
  fbq('track', 'AddToCart', { ...metaContents([item]), content_name: item.name, value, currency: CURRENCY })
}

export function trackBeginCheckout(items: TrackItem[], value: number) {
  gtag('event', 'begin_checkout', { currency: CURRENCY, value: round(value), items: gaItems(items) })
  fbq('track', 'InitiateCheckout', { ...metaContents(items), num_items: items.length, value: round(value), currency: CURRENCY })
}

/**
 * Kartla ödenmiş sipariş. `orderNo` iki işe yarıyor: GA4 aynı `transaction_id`'yi ikinci kez
 * saymıyor; Meta da tarayıcıdan ve sunucudan (Conversions API, bkz. lib/metaCapi.ts) gelen
 * aynı `eventID`'li olayı tekilleştiriyor.
 */
export function trackPurchase(orderNo: string, value: number, items: TrackItem[] = []) {
  gtag('event', 'purchase', {
    transaction_id: orderNo,
    currency: CURRENCY,
    value: round(value),
    ...(items.length ? { items: gaItems(items) } : {}),
  })
  fbq(
    'track',
    'Purchase',
    { ...(items.length ? metaContents(items) : { content_type: 'product' }), value: round(value), currency: CURRENCY },
    { eventID: orderNo },
  )
}

/**
 * Havale/EFT ile açılan sipariş. Para henüz gelmedi; `purchase` sayılırsa ödenmeyen siparişler
 * de satış görünür ve reklam platformu yanlış kişiyi aramayı öğrenir. Ayrı ad ile gönderiliyor;
 * istenirse GA4'te "önemli etkinlik" yapılabilir.
 */
export function trackBankTransferOrder(orderNo: string, value: number) {
  gtag('event', 'havale_siparisi', { transaction_id: orderNo, currency: CURRENCY, value: round(value) })
  fbq('track', 'Lead', { value: round(value), currency: CURRENCY, content_category: 'havale' }, { eventID: `havale-${orderNo}` })
}

/**
 * WhatsApp / telefon. Satışların önemli kısmı siteden değil bu iki kanaldan kapanıyor; bu
 * olaylar ölçülmezse reklam "satış getirmiyor" görünür.
 */
export function trackContact(channel: 'whatsapp' | 'telefon', detail?: { stockCode?: string; label?: string }) {
  gtag('event', channel === 'whatsapp' ? 'whatsapp_tiklama' : 'telefon_tiklama', {
    ...(detail?.stockCode ? { item_id: detail.stockCode } : {}),
    ...(detail?.label ? { link_text: detail.label.slice(0, 100) } : {}),
    page_path: typeof location !== 'undefined' ? location.pathname : undefined,
  })
  fbq('track', 'Contact', { content_category: channel, ...(detail?.stockCode ? { content_ids: [detail.stockCode] } : {}) })
}

/* ------------------------------------------------------------------------------------------
   REKLAM KAYNAĞI (attribution).

   Ziyaretçi reklamdan geldiğinde adresinde `gclid` (Google), `fbclid` (Meta) ya da `utm_*`
   etiketleri olur. İlk sayfada okunup 30 gün saklanıyor; sipariş notunun sonuna kısa bir satır
   olarak ekleniyor ki ERP'de "bu sipariş hangi reklamdan geldi" görülebilsin. Kişisel veri
   değil: yalnız reklam platformunun kendi verdiği etiketler.
------------------------------------------------------------------------------------------- */

const KAYNAK_ANAHTARI = 'stilsoft:kaynak'
const KAYNAK_OMRU_MS = 30 * 24 * 60 * 60 * 1000

type Kaynak = {
  source: string
  medium: string
  campaign?: string
  term?: string
  at: number
}

/** Adresteki reklam etiketlerinden kaynak çıkarır; reklamdan gelinmediyse null. */
function adrestenKaynak(search: string): Kaynak | null {
  const q = new URLSearchParams(search)
  const utmSource = q.get('utm_source')?.trim()
  const utmMedium = q.get('utm_medium')?.trim()
  const campaign = q.get('utm_campaign')?.trim() || undefined
  const term = q.get('utm_term')?.trim() || undefined
  const at = Date.now()

  if (q.get('gclid') || q.get('gbraid') || q.get('wbraid')) {
    return { source: utmSource || 'google', medium: utmMedium || 'cpc', campaign, term, at }
  }
  if (q.get('fbclid')) {
    return { source: utmSource || 'meta', medium: utmMedium || 'paid_social', campaign, term, at }
  }
  if (utmSource) {
    return { source: utmSource, medium: utmMedium || 'referral', campaign, term, at }
  }
  return null
}

/**
 * Her sayfa geçişinde çağrılır. Yeni bir reklam etiketi varsa öncekinin üstüne yazar (son
 * tıklanan reklam kazanır); etiket yoksa saklı olana dokunmaz.
 */
export function captureAttribution() {
  try {
    const k = adrestenKaynak(window.location.search)
    if (k) window.localStorage.setItem(KAYNAK_ANAHTARI, JSON.stringify(k))
  } catch {
    /* gizli sekmede depolama kapalı olabilir */
  }
}

/** Sipariş notuna eklenecek tek satır; kaynak yoksa ya da süresi dolduysa boş. */
export function attributionNote(): string {
  try {
    const raw = window.localStorage.getItem(KAYNAK_ANAHTARI)
    if (!raw) return ''
    const k = JSON.parse(raw) as Kaynak
    if (!k?.source || Date.now() - (k.at ?? 0) > KAYNAK_OMRU_MS) return ''
    const parcalar = [k.source, k.medium, k.campaign, k.term].filter(Boolean).map((p) => String(p).slice(0, 40))
    return `[Reklam kaynağı: ${parcalar.join(' / ')}]`
  } catch {
    return ''
  }
}

/** Müşterinin yazdığı nota kaynak satırını ekler. Not 1000 karakter sınırını aşmaz. */
export function withAttribution(note: string): string {
  const satir = attributionNote()
  if (!satir) return note
  const temiz = (note ?? '').trim()
  const birlesik = temiz ? `${temiz}\n${satir}` : satir
  return birlesik.slice(0, 1000)
}
