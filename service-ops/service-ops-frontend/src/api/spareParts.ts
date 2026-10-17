import { apiJson } from './client'

export async function createSparePart(payload: {
  productId: string
  name: string
  partNumber?: string
  stockQuantity: number
  minStockLevel: number
  explodedViewPartNumber?: string
}) {
  return await apiJson<{ success: boolean; data: { id: string } }>(`/api/spareparts`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateSparePartStock(id: string, payload: { stockQuantity: number; minStockLevel?: number }) {
  return await apiJson<{ success: boolean; data: any }>(`/api/spareparts/${id}/stock`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}
