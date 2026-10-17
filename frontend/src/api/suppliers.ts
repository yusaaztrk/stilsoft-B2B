import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type SupplierDto = {
  id: number
  supplierCode: string
  fullName: string
  phoneNumber?: string | null
  region?: string | null
  address?: string | null
  createTime: string
  createUser: string
}

export type CreateSupplierPayload = {
  supplierCode: string
  fullName: string
  phoneNumber?: string | null
  region?: string | null
  address?: string | null
}

export async function fetchNextSupplierCode(opts?: { signal?: AbortSignal }): Promise<string> {
  const res = await request('/api/suppliers/next-code', { signal: opts?.signal })
  const json = await res.json().catch(() => null)
  const code = String(json?.data?.supplierCode ?? '').trim()
  if (!code) throw new Error('Tedarikçi kodu üretilemedi')
  return code
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

async function request(path: string, init?: RequestInit & { signal?: AbortSignal }) {
  const token = getToken()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    signal: init?.signal,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
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

export async function fetchSuppliers(opts?: {
  includeCustomers?: boolean
  /** true ise yalnızca üzerine ÜRÜN tanımlanmış tedarikçiler döner (alış faturası listesi). */
  onlyWithProducts?: boolean
  /** Sunucu tarafı arama: kod, ad ve telefonda geçer. Boşsa süzgeç uygulanmaz. */
  q?: string
  /** 0/verilmezse sinirsiz. Arama kutusu sinir gonderir; listeyi tumuyle isteyen ekranlar gondermez. */
  limit?: number
  signal?: AbortSignal
}): Promise<SupplierDto[]> {
  const params = new URLSearchParams()
  if (opts?.includeCustomers) params.set('includeCustomers', 'true')
  if (opts?.onlyWithProducts) params.set('onlyWithProducts', 'true')
  const q = String(opts?.q ?? '').trim()
  if (q) params.set('q', q)
  if (opts?.limit && opts.limit > 0) params.set('limit', String(opts.limit))
  const query = params.toString() ? `?${params.toString()}` : ''
  const res = await request(`/api/suppliers${query}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as SupplierDto[]
}

export async function createSupplier(payload: CreateSupplierPayload): Promise<{ message?: string; data?: SupplierDto | null }> {
  const res = await request('/api/suppliers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => ({}))
  return { message: String(json?.message ?? ''), data: (json?.data ?? null) as any }
}

export async function updateSupplier(id: number, payload: CreateSupplierPayload): Promise<{ message?: string; data?: SupplierDto | null }> {
  const res = await request(`/api/suppliers/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  const json = await res.json().catch(() => ({}))
  return { message: String(json?.message ?? ''), data: (json?.data ?? null) as any }
}

export async function deleteSupplier(id: number): Promise<{ message?: string }> {
  const res = await request(`/api/suppliers/${encodeURIComponent(String(id))}`, {
    method: 'DELETE'
  })
  const json = await res.json().catch(() => ({}))
  return { message: String(json?.message ?? '') }
}
