import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type PurchaseInvoiceLineDto = {
  id: number
  productId?: string | null
  stockCode: string
  warehouseCode?: number | null
  stockName?: string | null
  description?: string | null
  quantity: number
  unitPrice: number
  vatRate: number
  discountType: number
  discountValue: number
  deliveryStatus?: number | null
  deliveryTeam?: string | null
  deliveryDispatchDate?: string | null
  deliveryCompletedDate?: string | null
  lineNo: number
}

export type PurchaseInvoiceListItemDto = {
  id: number
  approved: boolean
  date: string
  documentNo: string
  kind: number
  supplierCode?: string | null
  serviceCode?: string | null
  customerCode?: string | null
  customerName?: string | null
  salesmanCode?: string | null
  description?: string | null
  vatExempt: boolean
  subtotal: number
  discountTotal: number
  netTotal: number
  vatTotal: number
  grandTotal: number
  createUser?: string | null
  terminStatus?: number | null
  estimatedArrivalDate?: string | null
  lines: PurchaseInvoiceLineDto[]
}

export type CreatePurchaseInvoiceRequest = {
  documentNo?: string | null
  date?: string | null
  kind: number
  vatExempt: boolean
  supplierCode?: string | null
  serviceCode?: string | null
  customerCode?: string | null
  salesmanCode?: string | null
  description?: string | null
  lines: Array<{
    productId?: string | null
    description?: string | null
    warehouseCode?: number | null
    quantity: number
    unitPrice: number
    vatRate: number
    discountType: number
    discountValue: number
    deliveryStatus?: number | null
    deliveryTeam?: string | null
    deliveryDispatchDate?: string | null
    deliveryCompletedDate?: string | null
  }>
}

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function handleUnauthorized(res: Response) {
  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('userName')
    sessionStorage.removeItem('userName')
    if (typeof window !== 'undefined') redirectToLogin()
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }
}

function friendlyError(text: string, status: number, fallback: string) {
  const t = String(text ?? '').trim()
  if (!t) return `${fallback} (${status})`
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `${fallback} (${status})`
    }
  }
  return t
}

/**
 * ENUM'LAR UÇTAN METİN GELİR — SINIRDA SAYIYA ÇEVRİLİR (2026-08-20).
 *
 * Uç `JsonStringEnumConverter` kullanıyor: `kind` alanı `0/1/2` değil `"Purchase"/"Service"/
 * "Return"`, `terminStatus` da `"Waiting"/"Delivered"` olarak geliyor. Oysa bu dosyadaki
 * DTO tipleri `number` diyor — yani katman bugüne kadar yalan söylüyordu.
 *
 * Sonucu iki ekranda birden bozdu:
 *  - Alış Faturaları'nda Tip sütunu her satırda "Bilinmiyor" gösteriyordu.
 *  - Termin Listesi TAMAMEN BOŞTU: `.filter(r => r.kind === 0)` içindeki `Number("Purchase")`
 *    `NaN` olduğu için hiçbir satır geçmiyordu.
 *
 * Çeviri TEK YERDE, sınırda yapılıyor; her tüketicinin ayrı ayrı ayrıştırması gerekmiyor.
 * Sayısal biçim de destekleniyor, uç ayarı değişirse ekranlar bozulmaz.
 */
function toEnumNumber(raw: unknown, names: Record<string, number>): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw

  const text = String(raw ?? '').trim()
  if (!text) return 0

  const asNumber = Number(text)
  if (Number.isFinite(asNumber)) return asNumber

  const hit = names[text.toLowerCase()]
  return hit === undefined ? 0 : hit
}

const PURCHASE_KIND_NAMES: Record<string, number> = { purchase: 0, service: 1, return: 2 }
const TERMIN_STATUS_NAMES: Record<string, number> = { waiting: 0, delivered: 1 }

function normalizePurchaseInvoice(row: any): PurchaseInvoiceListItemDto {
  return {
    ...row,
    kind: toEnumNumber(row?.kind, PURCHASE_KIND_NAMES),
    terminStatus:
      row?.terminStatus === null || row?.terminStatus === undefined
        ? row?.terminStatus
        : toEnumNumber(row.terminStatus, TERMIN_STATUS_NAMES)
  }
}

/**
 * ALIŞ FATURALARI LİSTESİ.
 *
 * Sunucu, rolün açık olan tip yetkilerine (`invoice/alisTipAlis|alisTipHizmet|alisTipIade`)
 * göre süzer: hangi tipler açıksa yalnız onlar döner, hiçbiri açık değilse liste boştur.
 * Termin ekranı bu süzgece TABİ DEĞİLDİR — bkz. `fetchTerminPurchaseInvoices`.
 */
export async function fetchPurchaseInvoices(opts?: {
  take?: number
  /** Sayfalı okuma: en yeniden kaç kayıt atlanacak (2026-10-08). */
  skip?: number
  /** 0 = Alış, 1 = Hizmet, 2 = İade. Verilirse sunucu SADECE o türü döndürür. */
  kind?: number
  signal?: AbortSignal
}): Promise<PurchaseInvoiceListItemDto[]> {
  const take = Math.max(1, Math.min(500, Number(opts?.take ?? 200)))
  const params = new URLSearchParams({ take: String(take) })
  if (opts?.skip && opts.skip > 0) params.set('skip', String(Math.floor(opts.skip)))
  if (opts?.kind !== undefined && opts?.kind !== null) params.set('kind', String(opts.kind))
  const qs = params.toString()
  const res = await fetch(`${API_BASE_URL}/api/purchase-invoices?${qs}`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Alış faturaları alınamadı'))
  }

  const json = await res.json()
  return ((json?.data ?? []) as any[]).map(normalizePurchaseInvoice)
}

/**
 * TERMİN EKRANININ LİSTESİ — yalnız Alış (Kind=0), tip yetkisi süzgeci YOK.
 *
 * Termin ayrı bir sayfa ve ayrı bir yetkidir (`invoice/termin`); iş anlamı "hangi siparişim
 * yolda". Alış Faturaları listesiyle aynı ucu paylaşsaydı, tip yetkisi verilmemiş ama
 * termini olan roller termin ekranını boş görürdü.
 */
export async function fetchTerminPurchaseInvoices(opts?: {
  take?: number
  skip?: number
  signal?: AbortSignal
}): Promise<PurchaseInvoiceListItemDto[]> {
  const take = Math.max(1, Math.min(500, Number(opts?.take ?? 500)))
  const skip = Math.max(0, Math.floor(opts?.skip ?? 0))
  const res = await fetch(`${API_BASE_URL}/api/purchase-invoices/termin?take=${take}&skip=${skip}`, {
    headers: buildHeaders(false),
    signal: opts?.signal
  })
  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Termin listesi alınamadı'))
  }

  const json = await res.json()
  return ((json?.data ?? []) as any[]).map(normalizePurchaseInvoice)
}

export async function fetchNewPurchaseInvoiceDocumentNo(opts?: { signal?: AbortSignal }): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/api/purchase-invoices/new-document-no`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Belge numarası alınamadı'))
  }

  const json = await res.json()
  return String(json?.data?.documentNo ?? '')
}

export async function createPurchaseInvoice(payload: CreatePurchaseInvoiceRequest): Promise<{ id: number; documentNo: string }> {
  const res = await fetch(`${API_BASE_URL}/api/purchase-invoices`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Alış faturası kaydedilemedi'))
  }

  const json = await res.json()
  return { id: Number(json?.data?.id ?? json?.id ?? 0), documentNo: String(json?.data?.documentNo ?? json?.documentNo ?? '') }
}

export async function updatePurchaseInvoice(id: number, payload: CreatePurchaseInvoiceRequest): Promise<void> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/purchase-invoices/${encodeURIComponent(String(safeId))}`, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Alış faturası güncellenemedi'))
  }
}

export type UpdatePurchaseInvoiceHeaderRequest = {
  documentNo?: string | null
  kind: number
  supplierCode?: string | null
  serviceCode?: string | null
  customerCode?: string | null
}

export async function updatePurchaseInvoiceHeader(id: number, payload: UpdatePurchaseInvoiceHeaderRequest): Promise<void> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/purchase-invoices/${encodeURIComponent(String(safeId))}/header`, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Alış faturası üst bilgisi güncellenemedi'))
  }
}

export async function deletePurchaseInvoice(id: number): Promise<void> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/purchase-invoices/${encodeURIComponent(String(safeId))}`, {
    method: 'DELETE',
    headers: buildHeaders(false)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Alış faturası silinemedi'))
  }
}

export async function transferPurchaseInvoiceToInvoice(
  id: number,
  payload: { invoiceSerie?: string | null; invoiceNumber?: number | null }
): Promise<{ id: number; invoiceNo: string }> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/purchase-invoices/${encodeURIComponent(String(safeId))}/transfer-to-invoice`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Fatura dökümüne aktarılamadı'))
  }

  const json = await res.json()
  return { id: Number(json?.data?.id ?? 0), invoiceNo: String(json?.data?.invoiceNo ?? '') }
}

export async function previewTransferPurchaseInvoiceToInvoice(
  id: number
): Promise<{ isOpenCustomer: boolean; invoiceSerie: string | null; invoiceNumber: number | null; invoiceNo: string | null }> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(
    `${API_BASE_URL}/api/purchase-invoices/${encodeURIComponent(String(safeId))}/transfer-to-invoice/preview`,
    {
      method: 'GET',
      headers: buildHeaders(false)
    }
  )

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Önizleme alınamadı'))
  }

  const json = await res.json().catch(() => null)
  const d = (json as any)?.data ?? {}
  return {
    isOpenCustomer: Boolean(d?.isOpenCustomer),
    invoiceSerie: d?.invoiceSerie ? String(d.invoiceSerie) : null,
    invoiceNumber: d?.invoiceNumber === null || d?.invoiceNumber === undefined ? null : Number(d.invoiceNumber),
    invoiceNo: d?.invoiceNo ? String(d.invoiceNo) : null
  }
}

export async function updatePurchaseInvoiceTerminStatus(
  id: number, 
  status: number,
  lineWarehouses?: { lineId: number; warehouseCode: number }[]
): Promise<void> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/purchase-invoices/${encodeURIComponent(String(safeId))}/termin-status`, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify({ status, lineWarehouses })
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Termin durumu güncellenemedi'))
  }
}

export type TeslimatGecmisiParti = {
  id: number
  documentNo: string
  date: string
  createUser?: string | null
  currencyTypeId?: number
  exchangeRate?: number
  rateSource?: string | null
  grandTotal?: number
  lines: {
    stockCode: string
    stockName?: string | null
    quantity: number
    warehouseCode?: number | null
    warehouseName?: string | null
    unitPrice: number
    currencyUnitPrice: number
  }[]
}

/** Bir siparişten bölünmüş bütün teslimat partileri (2026-08-29). */
export async function fetchTeslimatGecmisi(id: number): Promise<TeslimatGecmisiParti[]> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')
  const res = await fetch(`${API_BASE_URL}/api/purchase-invoices/${encodeURIComponent(String(safeId))}/teslimat-gecmisi`, {
    headers: buildHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) return []
  const json = await res.json().catch(() => null)
  return (json?.data ?? []) as TeslimatGecmisiParti[]
}

export async function kismiTeslimPurchaseInvoice(
  id: number,
  payload: {
    items: { lineId: number; deliveredQuantity: number; warehouseCode?: number | null; unitPrice?: number | null }[]
    /** Tedarikçinin gerçek belge no'su. Zaten varsa teslimat O faturaya eklenir. */
    documentNo?: string | null
    currencyTypeId?: number | null
    exchangeRate?: number | null
    rateSource?: string | null
    /** Kalan mallar da bu teslimata dahil edilsin mi. */
    includeRemainder?: boolean
  }
): Promise<{ message?: string; warnings?: string[]; mergedIntoInvoiceId?: number }> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/purchase-invoices/${encodeURIComponent(String(safeId))}/kismi-teslim`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Kısmi teslimat işlemi gerçekleştirilemedi'))
  }

  // Birleştirme yapıldıysa sunucu uyarı döndürür; çağıran bunu kullanıcıya göstermeli.
  const json = await res.json().catch(() => null)
  return {
    message: json?.message ?? undefined,
    warnings: json?.warnings ?? undefined,
    mergedIntoInvoiceId: json?.mergedIntoInvoiceId ?? undefined
  }
}

export async function updatePurchaseInvoiceEstimatedArrivalDate(id: number, estimatedArrivalDate: string | null): Promise<void> {
  const safeId = Number(id)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/purchase-invoices/${encodeURIComponent(String(safeId))}/estimated-arrival-date`, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify({ estimatedArrivalDate })
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Tahmini geliş tarihi güncellenemedi'))
  }
}


/* ---------------------------------------------------------------------------------------
 * TERMİN RAPORU (2026-09-17) — sipariş / gelen / gelmeyen / ödenen.
 * Yetki termin sayfasınınki; uç: `api/termin-rapor` (TerminReportController).
 * ------------------------------------------------------------------------------------- */

export type TerminRaporDurum = 'Bekliyor' | 'KismiGeldi' | 'Geldi'

export type TerminRaporTutar = {
  currencyCode: string
  orderedAmount: number
  deliveredAmount: number
  remainingAmount: number
  paidInPeriod: number
  balance: number
}

export type TerminRaporKalem = {
  stockCode: string
  stockName: string
  unitPrice: number
  orderedQuantity: number
  deliveredQuantity: number
  remainingQuantity: number
  orderedAmount: number
  deliveredAmount: number
  remainingAmount: number
  /** Nakliye/işçilik gibi hizmet satırı: listede görünür ama teslimat takibine girmez. */
  isService?: boolean
}

export type TerminRaporTeslimat = {
  id: number
  documentNo: string
  date: string
  createTime: string
  createUser?: string | null
  quantity: number
  amount: number
}

export type TerminRaporSiparis = {
  id: number
  documentNo: string
  date: string
  supplierCode: string
  supplierName: string
  description?: string | null
  currencyCode: string
  estimatedArrivalDate?: string | null
  status: TerminRaporDurum
  overdueDays?: number | null
  lastDeliveryDate?: string | null
  createUser?: string | null
  orderedQuantity: number
  deliveredQuantity: number
  remainingQuantity: number
  orderedAmount: number
  /** Belgedeki hizmet (nakliye vb.) toplamı. "Hizmet hariç" tutar = orderedAmount - serviceAmount. */
  serviceAmount?: number
  deliveredAmount: number
  remainingAmount: number
  lines: TerminRaporKalem[]
  deliveries: TerminRaporTeslimat[]
}

export type TerminRaporTedarikci = {
  supplierCode: string
  supplierName: string
  orderCount: number
  openOrderCount: number
  overdueOrderCount: number
  orderedQuantity: number
  deliveredQuantity: number
  remainingQuantity: number
  totals: TerminRaporTutar[]
}

export type TerminRaporu = {
  from: string
  to: string
  today: string
  summary: {
    orderCount: number
    waitingCount: number
    partialCount: number
    deliveredCount: number
    overdueCount: number
    orderedQuantity: number
    deliveredQuantity: number
    remainingQuantity: number
    totals: TerminRaporTutar[]
  }
  suppliers: TerminRaporTedarikci[]
  orders: TerminRaporSiparis[]
  truncated: boolean
}

export async function fetchTerminRaporu(
  params: { from?: string; to?: string; supplierCode?: string },
  opts?: { signal?: AbortSignal }
): Promise<TerminRaporu> {
  const qs = new URLSearchParams()
  if (params.from) qs.set('from', params.from)
  if (params.to) qs.set('to', params.to)
  if (params.supplierCode) qs.set('supplierCode', params.supplierCode)
  const res = await fetch(`${API_BASE_URL}/api/termin-rapor?${qs}`, {
    headers: buildHeaders(false),
    signal: opts?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Termin raporu alınamadı'))
  }
  const json = await res.json()
  return json?.data as TerminRaporu
}

/*
  İADE — KAYNAK FATURADAN OTOMATİK DOLDURMA (2026-10-14).
  İki uç da yalnız OKUR; seçilen satış faturasına ve fatura dökümüne hiçbir şey yazılmaz.
  Dönen satırlar iade taslağına konur, kullanıcı silip ekleyebilir.
*/
export type ReturnSourceInvoice = {
  id: number
  invoiceNo: string
  date: string
  customerCode: string
  currencyTypeId: number
  grandTotal: number
  lineCount: number
}

export type ReturnSourceLine = {
  productId: string | null
  stockCode: string
  stockName: string
  quantity: number
  /** Satırın liste birim fiyatı (faturanın para biriminde, KDV hariç). */
  listUnitPrice: number
  /** Başlık indirimi dağıtılmış NET birim fiyat — iade bu fiyattan alınır. */
  netUnitPrice: number
  vatRate: number
  warehouseCode: number | null
}

export async function fetchReturnSources(customerCode: string, q?: string): Promise<ReturnSourceInvoice[]> {
  const params = new URLSearchParams({ customerCode })
  if (q && q.trim()) params.set('q', q.trim())
  const res = await fetch(`${API_BASE_URL}/api/purchase-invoices/return-sources?${params.toString()}`, { headers: buildHeaders(false) })
  await handleUnauthorized(res)
  if (!res.ok) throw new Error(friendlyError(await res.text().catch(() => ''), res.status, 'Faturalar alınamadı'))
  const json = await res.json().catch(() => null)
  return (json?.data ?? []) as ReturnSourceInvoice[]
}

export async function fetchReturnSourceLines(invoiceId: number): Promise<{
  invoiceId: number
  invoiceNo: string
  customerCode: string
  currencyTypeId: number
  discountRatio: number
  lines: ReturnSourceLine[]
}> {
  const res = await fetch(`${API_BASE_URL}/api/purchase-invoices/return-sources/${encodeURIComponent(String(invoiceId))}/lines`, {
    headers: buildHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) throw new Error(friendlyError(await res.text().catch(() => ''), res.status, 'Fatura satırları alınamadı'))
  const json = await res.json().catch(() => null)
  return json?.data
}
