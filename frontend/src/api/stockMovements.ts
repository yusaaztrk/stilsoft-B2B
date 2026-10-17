import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type StockMovementReportSummaryItem = {
  warehouseCode: number
  warehouseName?: string | null
  totalIn: number
  totalOut: number
  balance: number
}

export type StockMovementReportMovementItem = {
  id: number
  date: string
  invoiceNo: string
  customerCode: string
  customerName?: string | null
  deliveryCustomerCode: string
  deliveryCustomerName?: string | null
  bagNo: string
  warehouseCode: number
  warehouseName?: string | null
  direction: string
  quantity: number
  unitPrice: number
  netUnitPrice: number
  vatRate: number
  lineNo: number
}

export type StockMovementReportResponse = {
  stockCode: string
  from?: string | null
  to?: string | null
  summary: StockMovementReportSummaryItem[]
  movements: StockMovementReportMovementItem[]
  totals: { totalIn: number; totalOut: number; balance: number }
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

export async function fetchStockMovementReport(params: { stockCode: string; from?: string | null; to?: string | null }, opts?: { signal?: AbortSignal }): Promise<StockMovementReportResponse> {
  const sc = String(params.stockCode ?? '').trim()
  if (!sc) throw new Error('Stok kodu zorunludur')

  const qs = new URLSearchParams()
  qs.set('stockCode', sc)
  if (params.from) qs.set('from', params.from)
  if (params.to) qs.set('to', params.to)

  const res = await fetch(`${API_BASE_URL}/api/stockmovements/report?${qs.toString()}`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Stok hareket raporu alınamadı'))
  }

  const json = await res.json()
  return (json?.data ?? {}) as StockMovementReportResponse
}
