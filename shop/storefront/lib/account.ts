import { cookies } from 'next/headers'
import { SESSION_COOKIE } from '@/lib/session'

const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

export type AccountOrderLine = {
  stockCode: string
  name: string
  slug?: string | null
  imageUrl?: string | null
  quantity: number
  unitPrice: number
  vatRate: number
  lineGross: number
  /**
   * Bu satır için montaj istendi mi.
   *
   * Montaj 2026-09-09'da müşterinin seçimi oldu. Öncesinde her montajlanabilir ürün
   * montajlı sayıldığı için ekranlar "Ücretsiz Montaj" yazmayı sabit bir metin olarak
   * kullanıyordu; artık siparişin gerçeğini yazmak gerekiyor.
   */
  montage?: boolean
}

export type AccountOrder = {
  orderNo: string
  processedAt: string
  subtotal: number
  vatTotal: number
  grandTotal: number
  isPaid: boolean
  paymentStatus: string
  paidAt?: string | null
  invoiceNo?: string | null
  invoiceDate?: string | null
  stage: string
  stageLabel: string
  lines: AccountOrderLine[]
}

export type AccountInvoice = {
  invoiceNo: string
  date: string
  netTotal: number
  vatTotal: number
  grandTotal: number
  orderNo?: string | null
  lines: { stockCode: string; name: string; quantity: number; unitPrice: number; vatRate: number }[]
}

export type DeliveryStep = { status: number; statusLabel: string; timestamp: string }

export type Delivery = {
  exists: boolean
  status: number
  statusLabel: string
  plannedDate?: string | null
  updatedAt?: string | null
  history: DeliveryStep[]
}

export type AccountOrderDetail = {
  order: AccountOrder
  delivery?: Delivery | null
}

/**
 * Hesabım verisi sunucudan çekiliyor: oturum anahtarı httpOnly çerezde ve yalnızca sunucu
 * okuyabiliyor. Servis kapalıysa boş dönülüyor — hesap sayfası tek bir bölüm yüzünden
 * tamamen çökmemeli.
 */
async function get<T>(path: string, fallback: T): Promise<T> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return fallback

  try {
    const res = await fetch(`${API}${path}`, {
      headers: { 'X-Shop-Session': token },
      cache: 'no-store',
    })
    if (!res.ok) return fallback
    return (await res.json()) as T
  } catch {
    return fallback
  }
}

/**
 * Düzenlenebilir profil. Adres alanları ERP'deki cari kartından geliyor — teslimatın ve
 * faturanın gittiği yerin tek kaynağı orası.
 *
 * `addressAvailable` false ise cari okunamamış demek; ekran adres kutularını "boş" diye
 * göstermek yerine durumu söylüyor.
 */
export type AccountProfile = {
  email: string
  fullName: string
  phone?: string | null
  customerCode?: string | null
  city?: string | null
  district?: string | null
  address?: string | null
  addressAvailable: boolean
  smsOptOut?: boolean
}

export function getProfile(): Promise<AccountProfile | null> {
  return get<AccountProfile | null>('/api/account/profile', null)
}

/**
 * Kayıtlı teslimat adresleri (Hesabım → "Kayıtlı Teslimat Adreslerim").
 *
 * Liste en fazla bir tanesini varsayılan taşır; API zaten `is_default DESC, created_at DESC`
 * sıralı döndürüyor, yani `[0]` — varsa — varsayılan adrestir.
 */
export type MemberAddress = {
  id: string
  title: string
  fullName: string
  phone: string
  city?: string | null
  district?: string | null
  address: string
  isDefault: boolean
  createdAt: string
}

export function listAddresses(): Promise<MemberAddress[]> {
  return get<MemberAddress[]>('/api/account/addresses', [])
}

export function listOrders(): Promise<AccountOrder[]> {
  return get<AccountOrder[]>('/api/orders', [])
}

export function listInvoices(): Promise<AccountInvoice[]> {
  return get<AccountInvoice[]>('/api/invoices', [])
}

export function getOrderDetail(orderNo: string): Promise<AccountOrderDetail | null> {
  return get<AccountOrderDetail | null>(`/api/orders/${encodeURIComponent(orderNo)}`, null)
}

/** Tarih biçimi tek yerde: her ekranda aynı görünsün. */
export function formatDate(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
