import { useState, useEffect, useCallback } from 'react'
import { apiJson } from '../api/client'
import { getTechnicianId, isTechnicianSession } from '../auth/storage'

interface Route {
  id: string
  routeNumber: string
  name: string
  status: string
  statusLabel: string
  technicianId?: string
  technicianName: string
  technicianAvatar?: string
  technicianInitials?: string
  totalStops: number
  completedStops: number
  regionName: string
  plannedDate: string
  estimatedDuration?: string
}

interface UseRoutesOptions {
  dateFrom?: string
  dateTo?: string
  technicianId?: string
  regionId?: string
  status?: string
}

export function useRoutes(options: UseRoutesOptions = {}) {
  const [routes, setRoutes] = useState<Route[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRoutes = useCallback(async () => {
    try {
      setIsLoading(true)
      const params = new URLSearchParams()
      if (options.dateFrom) params.append('dateFrom', options.dateFrom)
      if (options.dateTo) params.append('dateTo', options.dateTo)
      const technicianId = options.technicianId
      if (technicianId) params.append('technicianId', technicianId)
      if (options.regionId) params.append('regionId', options.regionId)
      if (options.status) params.append('status', options.status)

      const data = await apiJson<Route[]>(`/api/routes?${params}`)
      setRoutes(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      // Return empty array for now - in production would show error UI
      setRoutes([])
    } finally {
      setIsLoading(false)
    }
  }, [options.dateFrom, options.dateTo, options.technicianId, options.regionId, options.status])

  useEffect(() => {
    fetchRoutes()
  }, [fetchRoutes])

  const createRoute = async (routeData: Partial<Route>) => {
    try {
      const newRoute = await apiJson<Route>(`/api/routes`, {
        method: 'POST',
        body: JSON.stringify(routeData)
      })
      setRoutes(prev => [newRoute, ...prev])
      return newRoute
    } catch (err) {
      throw err
    }
  }

  const updateRouteStatus = async (id: string, status: string) => {
    try {
      const updatedRoute = await apiJson<Route>(`/api/routes/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      })
      setRoutes(prev => prev.map(r => r.id === id ? updatedRoute : r))
      return updatedRoute
    } catch (err) {
      throw err
    }
  }

  return {
    routes,
    isLoading,
    error,
    refetch: fetchRoutes,
    createRoute,
    updateRouteStatus
  }
}
