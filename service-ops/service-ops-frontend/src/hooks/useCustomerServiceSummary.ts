import { useState, useEffect, useCallback } from 'react'
import { apiJson } from '../api/client'

export interface CustomerSummary {
  id: string
  customerNumber: string
  fullName: string
  phone: string
  email?: string
  address?: string
  city?: string
  district?: string
  regionName?: string
  isActive: boolean
  largeProductRepairCount: number
  smallProductRepairCount: number
  installationCount: number
  cargoCount: number
  totalServiceCount: number
}

export interface PaginatedResult<T> {
  items: T[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

interface FetchOptions {
  search?: string
  page: number
  pageSize: number
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
}

export function useCustomerServiceSummary(options: FetchOptions) {
  const [data, setData] = useState<PaginatedResult<CustomerSummary> | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    try {
      setIsLoading(true)
      const params = new URLSearchParams()
      params.append('page', options.page.toString())
      params.append('pageSize', options.pageSize.toString())
      if (options.search) params.append('search', options.search)
      if (options.sortBy) params.append('sortBy', options.sortBy)
      if (options.sortDirection) params.append('sortDirection', options.sortDirection)

      const result = await apiJson<PaginatedResult<CustomerSummary>>(
        `/api/service-ops/customers?${params}`,
        { signal } as any
      )
      setData(result)
      setError(null)
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Bir hata oluştu')
        setData(null)
      }
    } finally {
      setIsLoading(false)
    }
  }, [options.page, options.pageSize, options.search, options.sortBy, options.sortDirection])

  useEffect(() => {
    const controller = new AbortController()
    fetchData(controller.signal)
    return () => {
      controller.abort()
    }
  }, [fetchData])

  return {
    data,
    isLoading,
    error,
    refetch: fetchData
  }
}
