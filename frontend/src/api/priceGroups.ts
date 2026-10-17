import { API_BASE_URL } from '../config/api'

export type PriceGroupDto = {
  id: string
  code: number
  name: string
  invoiceType: string
  formula?: string | null
  sortOrder: number
  isActive: boolean
}

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function fetchPriceGroups(opts?: { includeInactive?: boolean }): Promise<PriceGroupDto[]> {
  const includeInactive = Boolean(opts?.includeInactive)
  const qs = new URLSearchParams({ includeInactive: includeInactive ? 'true' : 'false' }).toString()
  const res = await fetch(`${API_BASE_URL}/api/PriceGroups?${qs}`, {
    headers: { ...buildHeaders(false) }
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Fiyat kategorileri alınamadı (${res.status})`)
  }
  const json = (await res.json()) as any
  const result = (json?.data ?? []) as PriceGroupDto[]
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[fetchPriceGroups] raw json keys:', Object.keys(json ?? {}), 'groups:', result.map((g: any) => ({ id: g.id, code: g.code, name: g.name, formula: g.formula })))
  }
  return result
}

export async function createPriceGroup(payload: {
  code: number
  name: string
  invoiceType?: string
  formula?: string
  sortOrder?: number
}): Promise<PriceGroupDto> {
  const res = await fetch(`${API_BASE_URL}/api/PriceGroups`, {
    method: 'POST',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Fiyat kategorisi kaydedilemedi (${res.status})`)
  }
  return (await res.json()) as PriceGroupDto
}

export async function updatePriceGroup(
  id: string,
  payload: { name: string; invoiceType?: string; formula?: string; sortOrder?: number; isActive?: boolean }
): Promise<PriceGroupDto> {
  const res = await fetch(`${API_BASE_URL}/api/PriceGroups/${id}`, {
    method: 'PUT',
    headers: { ...buildHeaders(true) },
    body: JSON.stringify(payload)
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Fiyat kategorisi güncellenemedi (${res.status})`)
  }
  return (await res.json()) as PriceGroupDto
}

export async function deletePriceGroup(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/PriceGroups/${id}`, {
    method: 'DELETE',
    headers: { ...buildHeaders(false) }
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Fiyat kategorisi silinemedi (${res.status})`)
  }
}
