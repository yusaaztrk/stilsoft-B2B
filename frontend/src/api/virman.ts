import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type VirmanDto = {
  id: number
  documentNo: string
  date: string
  sourceCustomerCode: string
  sourceCustomerName: string
  targetCustomerCode: string
  targetCustomerName: string
  amount: number
  /** Virmanın para birimi — 1=TRY 2=EUR 3=USD 4=GBP. Eski kayıtlarda 0/1 (ikisi de TL). */
  currencyTypeId?: number
  /** Virman anındaki TL kuru; TL virmanda 1. */
  exchangeRate?: number
  description?: string | null
  createUser?: string | null
}

/** Virman tutarının simgesi — 0 ve 1 ikisi de TL. */
export function virmanCurrencySymbol(currencyTypeId: number | null | undefined): string {
  switch (Number(currencyTypeId ?? 1)) {
    case 2:
      return '€'
    case 3:
      return '$'
    case 4:
      return '£'
    default:
      return '₺'
  }
}

export type CreateVirmanPayload = {
  date?: string
  sourceCustomerCode: string
  targetCustomerCode: string
  amount: number
  description?: string
  direction: 'debit' | 'credit'
}

function getToken() {
  return localStorage.getItem('accessToken')
}

function getFriendlyError(text: string, status: number) {
  const t = String(text ?? '').trim()
  if (!t) return `İşlem başarısız (${status})`

  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `İşlem başarısız (${status})`
    }
  }

  return t
}

async function request(path: string, init?: RequestInit) {
  const token = getToken()
  const tenantCode = String(localStorage.getItem('tenantCode') ?? '').trim()
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenantCode ? { 'X-Tenant-Code': tenantCode } : {})
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers
  })

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('userName')
      sessionStorage.removeItem('userName')
      if (typeof window !== 'undefined') redirectToLogin()
      throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
    }

    const text = await res.text().catch(() => '')
    const err = new Error(getFriendlyError(text, res.status)) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  return res
}

export async function fetchVirmans(opts?: { take?: number; skip?: number; signal?: AbortSignal }): Promise<VirmanDto[]> {
  const take = opts?.take ?? 200
  const skip = Math.max(0, Math.floor(opts?.skip ?? 0))
  const res = await request(`/api/virman?take=${take}&skip=${skip}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as VirmanDto[]
}

export async function createVirman(payload: CreateVirmanPayload): Promise<{ id: number; documentNo: string }> {
  const res = await request('/api/virman', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  const json = await res.json()
  return json?.data ?? null
}

export async function deleteVirman(id: number): Promise<void> {
  await request(`/api/virman/${id}`, {
    method: 'DELETE'
  })
}

export async function fetchNextVirmanDocumentNo(): Promise<string> {
  const res = await request('/api/virman/next-document-no')
  const json = await res.json()
  return json?.data ?? ''
}

export async function updateVirman(id: number, payload: { amount: number }): Promise<void> {
  await request(`/api/virman/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
}

export type VirmanReportListItemDto = {
  /** Satirin TAMAMI bu para birimindedir; her kur kendi satirinda yurur (2026-08-19). */
  currencyTypeId?: number
  paraBirimi?: string
  paraBirimiSimge?: string
  customerCode: string
  customerName: string
  debitAmount: number
  creditAmount: number
  balance: number
}

export type VirmanReportDetailItemDto = {
  id: number
  documentNo: string
  date: string
  direction: string
  directionId: number
  amount: number
  description?: string | null
  createUser?: string | null
}

export type VirmanReportDetailResponse = {
  customer: { customerCode: string; name: string }
  data: VirmanReportDetailItemDto[]
}

export type VirmanReportResponse = {
  items: VirmanReportListItemDto[]
  /** Virman hareketi olan para birimleri; suzgec dugmeleri bundan kurulur. */
  availableCurrencyTypeIds: number[]
}

export async function fetchVirmanReport(opts?: {
  signal?: AbortSignal
  currencyTypeId?: number | null
}): Promise<VirmanReportResponse> {
  const qs = opts?.currencyTypeId != null && opts.currencyTypeId > 0 ? `?currencyTypeId=${opts.currencyTypeId}` : ''
  const res = await request(`/api/virman/report${qs}`, { signal: opts?.signal })
  const json = await res.json()
  return {
    items: (json?.data ?? []) as VirmanReportListItemDto[],
    availableCurrencyTypeIds: (json?.availableCurrencyTypeIds ?? [1]) as number[]
  }
}

export async function fetchVirmanReportDetails(customerCode: string, opts?: { signal?: AbortSignal }): Promise<VirmanReportDetailResponse> {
  const res = await request(`/api/virman/report/${encodeURIComponent(customerCode)}`, { signal: opts?.signal })
  const json = await res.json()
  return json as VirmanReportDetailResponse
}
