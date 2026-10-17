import { useState, useEffect, useCallback } from 'react'
import { sekmeGorunur } from '../utils/sekmeGorunur'
import { apiJson } from '../api/client'

export interface Technician {
  id: string
  employeeNumber: string
  firstName: string
  lastName: string
  fullName: string
  initials: string
  username?: string
  email?: string
  phone: string
  avatarUrl?: string
  status: string
  statusLabel: string
  statusColor: string
  roles: string[]
  expertiseAreas: string[]
  regionName?: string
  dailyTasks: number
  plannedServicesToday: number
  routeStopsToday: number
  isCapacityAvailable: boolean
  completedTasks: number
  totalTasks: number
  cancelledTasks: number
  successRate: number
  totalWorkDuration: string
  rating: number
  primaryRegionId?: string
  maxDailyTasks: number
  currentLatitude?: number
  currentLongitude?: number
  lastLocationUpdate?: string
  isActive: boolean
  isOnline: boolean
  warehouseCode?: number | null
  warehouseName?: string | null
  cashAccountId?: number | null
  cashAccountName?: string | null
  bankAccountId?: number | null
  bankAccountName?: string | null
  posAccountId?: number | null
  posAccountName?: string | null
  tenantCode?: string | null
  cariKodu?: string | null
  roleId?: number | null
  roleName?: string | null
  roleCode?: string | null
}

export type CreateTechnicianResult = Technician

interface UseTechniciansOptions {
  status?: string
  role?: string
  availableOnly?: boolean
}

export function useTechnicians(options: UseTechniciansOptions = {}) {
  const [technicians, setTechnicians] = useState<Technician[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchTechnicians = useCallback(async () => {
    try {
      setIsLoading(true)
      const endpoint = options.availableOnly ? '/technicians/available' : '/technicians'
      const params = new URLSearchParams()
      if (options.status) params.append('status', options.status)
      if (options.role) params.append('role', options.role)
      const qs = params.toString() ? `?${params.toString()}` : ''

      const data = await apiJson<Technician[]>(`/api${endpoint}${qs}`)
      setTechnicians(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setTechnicians([])
    } finally {
      setIsLoading(false)
    }
  }, [options.status, options.role, options.availableOnly])

  useEffect(() => {
    fetchTechnicians()
    // Poll every 30s for cross-device sync
    const interval = setInterval(() => { if (sekmeGorunur()) void fetchTechnicians() }, 30_000)
    const onVisible = () => { if (document.visibilityState === 'visible') fetchTechnicians() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchTechnicians])

  const updateLocation = async (id: string, latitude: number, longitude: number) => {
    try {
      const updated = await apiJson<Technician>(`/api/technicians/${id}/location`, {
        method: 'POST',
        body: JSON.stringify({ latitude, longitude })
      })
      setTechnicians(prev => prev.map(t => t.id === id ? updated : t))
      return updated
    } catch (err) {
      throw err
    }
  }

  const updatePassword = async (id: string, password: string) => {
    await apiJson<void>(`/api/technicians/${id}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password })
    })
  }

  const updateStatus = async (id: string, status: string) => {
    try {
      const updated = await apiJson<Technician>(`/api/technicians/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      })
      setTechnicians(prev => prev.map(t => t.id === id ? updated : t))
      return updated
    } catch (err) {
      throw err
    }
  }

  const createTechnician = async (technicianData: {
    firstName: string
    lastName: string
    phone: string
    email?: string
    expertiseAreas?: string[]
    roles?: string[]
    primaryRegionId?: string
    maxDailyTasks?: number
    username: string
    password: string
  }) => {
    const created = await apiJson<CreateTechnicianResult>(`/api/technicians`, {
      method: 'POST',
      body: JSON.stringify({
        firstName: technicianData.firstName,
        lastName: technicianData.lastName,
        phone: technicianData.phone,
        email: technicianData.email,
        expertiseAreas: technicianData.expertiseAreas ?? [],
        roles: technicianData.roles ?? [],
        primaryRegionId: technicianData.primaryRegionId ?? null,
        maxDailyTasks: technicianData.maxDailyTasks ?? 8,
        username: technicianData.username,
        password: technicianData.password,
      })
    })

    setTechnicians(prev => [created, ...prev])
    return created
  }

  return {
    technicians,
    isLoading,
    error,
    refetch: fetchTechnicians,
    createTechnician,
    updateLocation,
    updateStatus,
    updatePassword,
  }
}

// Hook for real-time technician locations
export function useTechnicianLocations() {
  const [locations, setLocations] = useState<Array<{
    id: string
    fullName: string
    initials: string
    avatar?: string
    latitude: number
    longitude: number
    status: string
    lastUpdate: string
    isOnline: boolean
    phone?: string
  }>>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchLocations = async () => {
    try {
      const data = await apiJson<typeof locations>(`/api/technicians/locations`)
      setLocations(data)
    } catch (err) {
      console.error('Failed to fetch locations:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchLocations()
    // Poll every 30 seconds for real-time updates
    const interval = setInterval(() => { if (sekmeGorunur()) void fetchLocations() }, 30000)
    return () => clearInterval(interval)
  }, [])

  return { locations, isLoading, refetch: fetchLocations }
}
