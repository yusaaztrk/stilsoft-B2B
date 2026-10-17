import { API_BASE_URL } from '../config/api'

/**
 * FATURA TAKİP (2026-09-15). Kesilen faturanın teknisyene atanıp müşteriye imzalatılması ve
 * geri getirilmesi. Liste Fatura Dökümü'nün gördüğü faturalardan (alış tarafı hariç) gelir.
 */

export type TrackingView = 'planlanmamis' | 'rota' | 'geciken' | 'tamamlanan' | 'tumu'

export type TrackingStatus = 'PLANLANMADI' | 'PLANLANDI' | 'TAMAMLANDI' | 'OTOMATIK_TAMAMLANDI'

export type TrackingRow = {
  invoiceId: number
  invoiceNo: string
  invoiceDate: string
  typeLabel: string
  customerCode: string
  customerName: string
  grandTotal: number
  currencyTypeId: number
  status: TrackingStatus
  technicianId?: string | null
  technicianName?: string | null
  plannedDate?: string | null
  isLate: boolean
  lastFailedDate?: string | null
  completedAt?: string | null
  completedBy?: string | null
  photoCount: number
  lastNote?: string | null
  routeOutcome?: 'TESLIM_EDILDI' | 'TESLIM_EDILEMEDI' | null
  routeOutcomeNote?: string | null
  routeTechnicianName?: string | null
}

export type TrackingSummary = {
  unplanned: number
  route: number
  late: number
  failedWaiting: number
  completedOnDate: number
}

export type FieldTechnician = {
  id: string
  name: string
  username?: string | null
  employeeNumber?: string | null
  phone?: string | null
}

export type TrackingEvent = {
  id: number
  eventType: string
  routeDate?: string | null
  newPlannedDate?: string | null
  technicianName?: string | null
  note?: string | null
  source: string
  actor: string
  createdAt: string
  photoIds: number[]
}

export type TrackingHistory = {
  events: TrackingEvent[]
  photos: Array<{ id: number; eventId?: number | null; source: string; uploadedBy: string; createdAt: string }>
}

export type RouteRow = {
  invoiceId: number
  invoiceNo: string
  invoiceDate: string
  typeLabel: string
  customerCode: string
  customerName: string
  phone?: string | null
  address?: string | null
  grandTotal: number
  currencyTypeId: number
  technicianId?: string | null
  technicianName?: string | null
  plannedDate?: string | null
  status: string
  outcome?: string | null
  outcomeNote?: string | null
  outcomeAt?: string | null
  movedTo?: string | null
  lastNote?: string | null
}

function headers(json: boolean) {
  const h: Record<string, string> = {}
  if (json) h['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) h.Authorization = `Bearer ${token}`
  const tenantCode = String(localStorage.getItem('tenantCode') ?? '').trim()
  if (tenantCode) h['X-Tenant-Code'] = tenantCode
  return h
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.success === false) {
    throw new Error(json?.message || json?.title || `${fallback} (${res.status})`)
  }
  return json as T
}

function qs(params: Record<string, string | undefined | null>) {
  const p = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v) p.set(k, v)
  })
  const s = p.toString()
  return s ? `?${s}` : ''
}

const base = () => `${API_BASE_URL}/api/invoice-tracking`

export async function fetchTrackingSettings() {
  const res = await fetch(`${base()}/settings`, { headers: headers(false) })
  const json = await readJson<{ data: { startDate: string; today: string } }>(res, 'Ayarlar alınamadı')
  return json.data
}

export async function fetchTrackingTechnicians(): Promise<FieldTechnician[]> {
  const res = await fetch(`${base()}/technicians`, { headers: headers(false) })
  const json = await readJson<{ data: FieldTechnician[] }>(res, 'Teknisyen listesi alınamadı')
  return json.data ?? []
}

export async function fetchTrackingList(params: {
  view: TrackingView
  date?: string
  from?: string
  to?: string
  technicianId?: string
  /** Üst şeritteki fatura tarihi aralığı — bütün sekmelere uygulanır. */
  invoiceFrom?: string
  invoiceTo?: string
}): Promise<TrackingRow[]> {
  const res = await fetch(`${base()}/list${qs(params)}`, { headers: headers(false) })
  const json = await readJson<{ data: TrackingRow[] }>(res, 'Liste alınamadı')
  return json.data ?? []
}

export async function fetchTrackingSummary(params: { date?: string; technicianId?: string; invoiceFrom?: string; invoiceTo?: string }): Promise<TrackingSummary> {
  const res = await fetch(`${base()}/summary${qs(params)}`, { headers: headers(false) })
  const json = await readJson<{ data: TrackingSummary }>(res, 'Özet alınamadı')
  return json.data
}

async function post(path: string, body: unknown, fallback: string) {
  const res = await fetch(`${base()}${path}`, { method: 'POST', headers: headers(true), body: JSON.stringify(body ?? {}) })
  return readJson<{ message?: string }>(res, fallback)
}

export const assignInvoices = (body: { invoiceIds: number[]; technicianId: string; plannedDate: string; note?: string }) =>
  post('/assign', body, 'Atama yapılamadı')

export const unassignInvoices = (body: { invoiceIds: number[]; note?: string }) => post('/unassign', body, 'Plan kaldırılamadı')

export const completeInvoice = (invoiceId: number, note?: string) => post(`/${invoiceId}/complete`, { note }, 'Tamamlanamadı')

export const failInvoice = (invoiceId: number, note: string) => post(`/${invoiceId}/fail`, { note }, 'İşaretlenemedi')

export const reopenInvoice = (invoiceId: number, note?: string) => post(`/${invoiceId}/reopen`, { note }, 'Geri alınamadı')

export const addTrackingNote = (invoiceId: number, note: string) => post(`/${invoiceId}/note`, { note }, 'Not eklenemedi')

export async function uploadTrackingPhotos(invoiceId: number, files: File[], note?: string) {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  if (note) form.append('note', note)
  const res = await fetch(`${base()}/${invoiceId}/photos`, { method: 'POST', headers: headers(false), body: form })
  return readJson<{ message?: string }>(res, 'Görsel yüklenemedi')
}

export async function fetchTrackingHistory(invoiceId: number): Promise<TrackingHistory> {
  const res = await fetch(`${base()}/${invoiceId}/history`, { headers: headers(false) })
  const json = await readJson<{ data: TrackingHistory }>(res, 'Geçmiş alınamadı')
  return json.data
}

/** Görsel yetki kontrollü uçtan geliyor; <img> başlık taşıyamadığı için blob olarak alınıyor. */
export async function fetchTrackingPhotoUrl(photoId: number): Promise<string> {
  const res = await fetch(`${base()}/photos/${photoId}`, { headers: headers(false) })
  if (!res.ok) throw new Error('Görsel alınamadı')
  return URL.createObjectURL(await res.blob())
}

export async function fetchRoute(params: { date: string; technicianId?: string }) {
  const res = await fetch(`${base()}/route${qs(params)}`, { headers: headers(false) })
  const json = await readJson<{ data: { date: string; rows: RouteRow[] } }>(res, 'Rota alınamadı')
  return json.data
}
