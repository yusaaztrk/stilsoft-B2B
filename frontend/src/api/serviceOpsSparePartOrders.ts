import { API_BASE_URL } from '../config/api'

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export type ServiceOpsSparePartOrderRequestDto = {
  id: string
  tenantCode?: string
  technicianName: string
  erpProductId: string
  stockCode: string
  partName: string
  quantityRequested: number
  status: string
  createdAt: string
  completedAt?: string | null
}

export async function fetchServiceOpsSparePartOrderRequests(status = 'Pending') {
  const qs = status ? `?status=${encodeURIComponent(status)}` : ''
  const res = await fetch(`${API_BASE_URL}/api/service-ops/spare-part-order-requests${qs}`, { headers: buildHeaders(false) })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Siparişler alınamadı (${res.status})`)
  }
  const json = await res.json().catch(() => null)
  return (json?.data ?? json) as ServiceOpsSparePartOrderRequestDto[]
}

export async function completeServiceOpsSparePartOrderRequest(id: string) {
  const res = await fetch(`${API_BASE_URL}/api/service-ops/spare-part-order-requests/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: '{}',
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Sipariş tamamlanamadı (${res.status})`)
  }
}
