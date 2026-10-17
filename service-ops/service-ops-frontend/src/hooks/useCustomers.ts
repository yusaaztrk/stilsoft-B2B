import { useState, useEffect, useCallback } from 'react'
import { apiJson } from '../api/client'

export interface Customer {
  id: string
  customerNumber: string
  fullName: string
  type: string
  typeLabel: string
  phone: string
  email?: string
  address?: string
  city?: string
  district?: string
  regionName?: string
  totalServices: number
  lastServiceDate?: string
  totalRevenue: number
  isActive: boolean
}

interface UseCustomersOptions {
  type?: string
  search?: string
}

export function useCustomers(options: UseCustomersOptions = {}) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCustomers = useCallback(async () => {
    try {
      setIsLoading(true)
      const params = new URLSearchParams()
      if (options.type) params.append('type', options.type)
      if (options.search) params.append('q', options.search)

      const data = await apiJson<Customer[]>(`/api/erp/customers?${params}`)
      setCustomers(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setCustomers([])
    } finally {
      setIsLoading(false)
    }
  }, [options.type, options.search])

  useEffect(() => {
    fetchCustomers()
  }, [fetchCustomers])

  const createCustomer = async (customerData: Partial<Customer>) => {
    try {
      const newCustomer = await apiJson<Customer>(`/api/customers`, {
        method: 'POST',
        body: JSON.stringify(customerData)
      })
      setCustomers(prev => [newCustomer, ...prev])
      return newCustomer
    } catch (err) {
      throw err
    }
  }

  return {
    customers,
    isLoading,
    error,
    refetch: fetchCustomers,
    createCustomer
  }
}
