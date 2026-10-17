import { apiJson } from './client'

export type SparePartOrderRequestDto = {
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

export async function createSparePartOrderRequest(payload: {
  erpProductId: string
  stockCode: string
  partName: string
  quantityRequested: number
}) {
  return await apiJson<{ success: boolean; data?: { id: string } }>(
    '/api/SparePartOrderRequests',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  )
}

export async function fetchSparePartOrderRequests(status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : ''
  return await apiJson<{ success: boolean; data: SparePartOrderRequestDto[] }>(
    `/api/SparePartOrderRequests${qs}`
  )
}

export async function completeSparePartOrderRequest(id: string) {
  return await apiJson<{ success: boolean }>(
    `/api/SparePartOrderRequests/${encodeURIComponent(id)}/complete`,
    { method: 'POST' }
  )
}
