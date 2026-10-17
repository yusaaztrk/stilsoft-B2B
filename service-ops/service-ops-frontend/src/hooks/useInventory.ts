import { useState, useEffect, useCallback } from 'react'
import { apiJson } from '../api/client'

export interface InventoryItem {
  id: string
  partNumber: string
  name: string
  description?: string
  category?: string
  subCategory?: string
  quantity: number
  minStockLevel: number
  maxStockLevel: number
  unit: string
  storageLocation?: string
  shelfNumber?: string
  unitCost?: number
  unitPrice?: number
  currency: string
  supplier?: string
  status: string
  statusLabel: string
  isActive: boolean
}

interface UseInventoryOptions {
  category?: string
  status?: string
  lowStock?: boolean
}

export function useInventory(options: UseInventoryOptions = {}) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchInventory = useCallback(async () => {
    try {
      setIsLoading(true)
      const params = new URLSearchParams()
      if (options.category) params.append('category', options.category)
      if (options.status) params.append('status', options.status)
      if (options.lowStock) params.append('lowStock', 'true')

      const data = await apiJson<InventoryItem[]>(`/api/inventory?${params}`)
      setItems(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setItems([])
    } finally {
      setIsLoading(false)
    }
  }, [options.category, options.status, options.lowStock])

  useEffect(() => {
    fetchInventory()
  }, [fetchInventory])

  const updateStock = async (id: string, quantity: number) => {
    try {
      const updated = await apiJson<InventoryItem>(`/api/inventory/${id}/stock`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity })
      })
      setItems(prev => prev.map(i => i.id === id ? updated : i))
      return updated
    } catch (err) {
      throw err
    }
  }

  const createItem = async (itemData: {
    partNumber: string
    name: string
    description?: string
    category?: string
    quantity: number
    minStockLevel: number
    unit?: string
    storageLocation?: string
  }) => {
    const created = await apiJson<InventoryItem>(`/api/inventory`, {
      method: 'POST',
      body: JSON.stringify(itemData)
    })

    setItems(prev => [created, ...prev])
    return created
  }

  return {
    items,
    isLoading,
    error,
    refetch: fetchInventory,
    createItem,
    updateStock
  }
}

export function useInventoryStats() {
  const [stats, setStats] = useState({
    totalItems: 0,
    inStock: 0,
    lowStock: 0,
    outOfStock: 0
  })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await apiJson<typeof stats>(`/api/inventory/stats`)
        setStats(data)
      } catch (err) {
        console.error('Failed to fetch inventory stats:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchStats()
  }, [])

  return { stats, isLoading }
}
