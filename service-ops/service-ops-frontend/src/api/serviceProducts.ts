import { API_BASE_URL } from '../config'
import { getAccessToken } from '../auth/storage'
import { apiJson } from './client'

export type ServiceProductListItemDto = {
  id: string
  name: string
  stockCode?: string | null
}

export type ExplodedDiagramDto = {
  id: string
  fileName: string
  contentType: string
  uploadedAt: string
  url: string
}

export type SparePartDto = {
  id: string
  name: string
  partNumber?: string | null
  stockQuantity: number
  minStockLevel: number
  explodedViewPartNumber?: string | null
}

export type ServiceProductDetailDto = {
  id: string
  name: string
  stockCode?: string | null
  explodedDiagrams: ExplodedDiagramDto[]
  spareParts: SparePartDto[]
}

export async function fetchServiceProducts(q?: string) {
  const qs = new URLSearchParams()
  if (q) qs.set('q', q)
  const res = await apiJson<{ success: boolean; data: ServiceProductListItemDto[] }>(`/api/serviceproducts?${qs}`)
  return res.data ?? []
}

export async function createServiceProduct(payload: { name: string; stockCode?: string }) {
  return await apiJson<{ success: boolean; data: { id: string } }>(`/api/serviceproducts`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function uploadExplodedDiagram(productId: string, file: File) {
  const form = new FormData()
  form.append('file', file)

  // Use apiFetch-like behavior but this endpoint expects multipart.
  // client.ts always forces application/json when body is set, so we use fetch directly.
  const token = getAccessToken()
  const res = await fetch(`${API_BASE_URL}/api/serviceproducts/${encodeURIComponent(productId)}/diagram`, {
    method: 'POST',
    body: form,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `Request failed (${res.status})`)
  }

  return (await res.json()) as { success: boolean; data: { id: string } }
}

export async function fetchServiceProductDetail(productId: string) {
  const res = await apiJson<{ success: boolean; data: ServiceProductDetailDto }>(`/api/serviceproducts/${productId}`)
  return res.data
}

export async function fetchServiceProductDetailByName(name: string) {
  const qs = new URLSearchParams({ name })
  const res = await apiJson<{ success: boolean; data: ServiceProductDetailDto }>(`/api/serviceproducts/by-name?${qs}`)
  return res.data
}
