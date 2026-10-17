import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type ServiceCatalogItemDto = {
  id: number
  code: string
  name: string
  isActive: boolean
  /**
   * Hizmetin para birimi: 0/1 = TRY, 2 = EUR, 3 = USD, 4 = GBP.
   *
   * Hizmet tanımında para birimi yoktu; gümrük masrafı gibi doğası gereği dövizli hizmetler
   * faturaya TL düşüyordu. Fatura kalemine ÖNTANIM olarak taşınır, kalemde değiştirilebilir.
   */
  currencyTypeId?: number
}

type CreateServiceCatalogItemPayload = {
  code?: string | null
  name: string
  isActive?: boolean
  currencyTypeId?: number
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

export async function fetchServiceCatalog(opts?: { includeInactive?: boolean; signal?: AbortSignal }): Promise<ServiceCatalogItemDto[]> {
  const qs = new URLSearchParams()
  if (opts?.includeInactive) qs.set('includeInactive', 'true')
  const res = await fetch(`${API_BASE_URL}/api/service-catalog?${qs.toString()}`, {
    method: 'GET',
    headers: buildHeaders(false),
    signal: opts?.signal
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Hizmet listesi alınamadı'))
  }

  const json = await res.json().catch(() => null)
  return (json as any)?.data ?? []
}

export async function createServiceCatalogItem(payload: CreateServiceCatalogItemPayload): Promise<ServiceCatalogItemDto> {
  const res = await fetch(`${API_BASE_URL}/api/service-catalog`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Hizmet eklenemedi'))
  }

  const json = await res.json().catch(() => null)
  return (json as any)?.data as ServiceCatalogItemDto
}
