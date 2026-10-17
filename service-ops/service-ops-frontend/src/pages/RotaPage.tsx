import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { 
  Clock, 
  Search, 
  Calendar, 
  Filter, 
  RefreshCw, 
  Map as MapIcon,
  Info,
  GripVertical,
  Check,
  User,
  ChevronLeft,
  X,
  Layers,
  ArrowUp,
  ArrowDown,
  AlertCircle,
  Maximize2,
  Minimize2
} from 'lucide-react'
import { apiJson } from '../api/client'
import { useTechnicians } from '../hooks/useTechnicians'
import { useServiceRecords } from '../hooks/useServiceRecords'
import { isTechnicianSession, getTechnicianId } from '../auth/storage'

// Leaflet Map Imports
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline, Circle } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import icon from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'
import { toast } from 'sonner'

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})
L.Marker.prototype.options.icon = DefaultIcon

function calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

const normalizeRegionName = (name: string | null | undefined): string => {
  if (!name) return ''
  return name
    .trim()
    .replace(/Gazima\?\?usa/g, 'Gazimağusa')
    .replace(/G\?\?zelyurt/g, 'Güzelyurt')
    .replace(/Lefko\?\?a/g, 'Lefkoşa')
    .replace(/\?\?skele/g, 'İskele')
    .replace(/Gazimagusa/gi, 'Gazimağusa')
    .replace(/Gozelyurt/gi, 'Güzelyurt')
    .replace(/Lefkosa/gi, 'Lefkoşa')
    .replace(/Iskele/gi, 'İskele')
}

const getStatusColor = (status: string) => {
  const s = String(status || '').toLowerCase()
  if (s === 'new' || s === 'delayed' || s === 'waitingforparts') return 'gray'
  if (s === 'planned') return 'blue'
  if (s === 'inrepair') return 'orange'
  if (s === 'workshop') return 'yellow'
  if (s === 'ready' || s === 'delivered') return 'green'
  if (s === 'cancelled') return 'red'
  return 'gray'
}

const hourPresets = [
  { label: 'Sabah', sub: '09-12', start: '09:00', end: '12:00', color: 'from-amber-500 to-orange-500' },
  { label: 'Ogle', sub: '12-15', start: '12:00', end: '15:00', color: 'from-blue-500 to-indigo-500' },
  { label: 'Aksam', sub: '15-18', start: '15:00', end: '18:00', color: 'from-purple-500 to-pink-500' }
]

function FitMapBounds({ points, selectedTechId, selectedDate }: { points: [number, number][], selectedTechId: string | null, selectedDate: string }) {
  const map = useMap()
  const lastFitRef = useRef<string>('')

  useEffect(() => {
    if (points && points.length > 0) {
      const key = `${selectedTechId}-${selectedDate}-${points.length}`
      if (lastFitRef.current !== key) {
        lastFitRef.current = key
        const bounds = L.latLngBounds(points)
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 })
      }
    }
  }, [points, map, selectedTechId, selectedDate])
  return null
}

function ZoomDetector({ setZoomLevel }: { setZoomLevel: (z: number) => void }) {
  const map = useMap()
  useEffect(() => {
    const onZoom = () => setZoomLevel(map.getZoom())
    map.on('zoomend', onZoom)
    return () => { map.off('zoomend', onZoom) }
  }, [map, setZoomLevel])
  return null
}

function MapFocusController({ selectedServiceId, todayServiceRecords, getRecordCoords }: {
  selectedServiceId: string | null;
  todayServiceRecords: any[];
  getRecordCoords: (r: any) => [number, number];
}) {
  const map = useMap()
  const lastFocusedIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (selectedServiceId) {
      if (lastFocusedIdRef.current !== selectedServiceId) {
        lastFocusedIdRef.current = selectedServiceId
        const selectedRecord = todayServiceRecords.find(r => r.id === selectedServiceId)
        if (selectedRecord) {
          const coords = getRecordCoords(selectedRecord)
          map.setView(coords, Math.max(map.getZoom(), 13), { animate: true })
        }
      }
    } else {
      lastFocusedIdRef.current = null
    }
  }, [selectedServiceId, todayServiceRecords, getRecordCoords, map])
  return null
}

function MapResizeController({ isMaximized }: { isMaximized: boolean }) {
  const map = useMap()
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize({ animate: true })
    }, 305)
    return () => clearTimeout(timer)
  }, [isMaximized, map])
  return null
}

const createTechnicianIcon = (initials: string, isSelected: boolean) => {
  const ring = isSelected ? 'ring-4 ring-rose-500/50 scale-110 shadow-[0_0_15px_rgba(244,63,94,0.4)]' : 'border-2 border-white'
  return L.divIcon({
    className: 'custom-tech-marker',
    html: `<div class="w-10 h-10 rounded-full flex items-center justify-center shadow-lg font-bold text-sm text-white transition-all bg-gradient-to-tr from-slate-700 to-slate-800 ${ring}">${initials}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20],
  })
}

const getServiceMarkerIcon = (num: number | null, status: string, isSelected: boolean, isHighlighted: boolean, _type: string) => {
  let bgClass = 'bg-slate-400 border-slate-350'
  let text = ''
  let sizeClass = 'w-full h-full rounded-full'
  let ringClass = 'border border-white'

  const isDone = status === 'Ready' || status === 'Delivered'

  if (num !== null) {
    // Assigned to the selected technician's timeline
    bgClass = isDone ? 'bg-emerald-600 border-emerald-400 text-white font-extrabold' : 'bg-rose-600 border-rose-400 text-white font-extrabold'
    text = String(num)
    if (isHighlighted) {
      ringClass = isDone
        ? 'ring-4 ring-emerald-500/80 scale-125 z-[1000] animate-marker-pulse-green'
        : 'ring-4 ring-rose-500/80 scale-125 z-[1000] animate-marker-pulse'
    } else if (isSelected) {
      ringClass = isDone
        ? 'ring-4 ring-emerald-500/50 scale-110 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
        : 'ring-4 ring-rose-500/50 scale-110 shadow-[0_0_12px_rgba(244,63,94,0.3)]'
    }
  } else {
    // Unassigned / Pool stops -> small dot (always red/rose, or green if completed)
    bgClass = isDone ? 'bg-emerald-600 border-emerald-400' : 'bg-rose-600 border-rose-400'
    text = ''
    if (isHighlighted) {
      ringClass = isDone
        ? 'ring-4 ring-emerald-500 scale-125 z-[1000] animate-marker-pulse-green'
        : 'ring-4 ring-rose-500 scale-125 z-[1000] animate-marker-pulse'
    } else if (isSelected) {
      ringClass = isDone
        ? 'ring-4 ring-emerald-500/50 scale-110 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
        : 'ring-4 ring-rose-500/50 scale-110 shadow-[0_0_12px_rgba(244,63,94,0.3)]'
    }
  }

  const size = num !== null ? [32, 32] : [18, 18]
  const anchor = num !== null ? [16, 16] : [9, 9]

  return L.divIcon({
    className: 'custom-stop-marker',
    html: `<div class="${sizeClass} flex items-center justify-center shadow-md font-bold text-xs transition-all transform hover:scale-110 ${bgClass} ${ringClass}">${text}</div>`,
    iconSize: size as L.PointExpression,
    iconAnchor: anchor as L.PointExpression,
    popupAnchor: [0, -(anchor[1])] as L.PointExpression,
  })
}

const createClusterIcon = (count: number) => {
  return L.divIcon({
    className: 'custom-cluster-marker',
    html: `<div class="w-10 h-10 rounded-full bg-rose-600 border-2 border-white shadow-lg text-white font-bold text-sm flex items-center justify-center hover:scale-110 transition-transform">${count}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  })
}

export default function RotaPage() {
  const isTechMode = isTechnicianSession()
  const techId = getTechnicianId()

  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const local = new Date()
    const offset = local.getTimezoneOffset()
    const adjusted = new Date(local.getTime() - (offset * 60 * 1000))
    return adjusted.toISOString().split('T')[0]
  })

  const [regionFilter, setRegionFilter] = useState<string>('all')
  const [techFilter, setTechFilter] = useState<string>('all')
  const [customerFilter, setCustomerFilter] = useState<string>('')
  const [productSearchFilter, setProductSearchFilter] = useState<string>('')
  const [productGroupFilter, setProductGroupFilter] = useState<string>('all')
  const [serviceTypeFilter, setServiceTypeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const [selectedTechId, setSelectedTechId] = useState<string | null>(isTechMode ? techId : null)
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null)
  const [isMapMaximized, setIsMapMaximized] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null)
  const [zoomLevel, setZoomLevel] = useState(10)
  const [editingTime, setEditingTime] = useState<{ id: string; start: string; end: string } | null>(null)

  // Pools state variables
  const [isPoolModalOpen, setIsPoolModalOpen] = useState(false)
  const [selectedPoolStops, setSelectedPoolStops] = useState<string[]>([])
  const [poolSearchQuery, setPoolSearchQuery] = useState('')

  // Overdue state variables
  const [isOverdueModalOpen, setIsOverdueModalOpen] = useState(false)
  const [rescheduleDates, setRescheduleDates] = useState<Record<string, string>>({})
  const [rescheduleLoadingId, setRescheduleLoadingId] = useState<string | null>(null)
  const [regionsList, setRegionsList] = useState<any[]>([])

  // Sort state variables
  const [isSortModalOpen, setIsSortModalOpen] = useState(false)
  const [draggedStopIndex, setDraggedStopIndex] = useState<number | null>(null)
  const [dragOverStopIndex, setDragOverStopIndex] = useState<number | null>(null)

  const serviceOptions = useMemo(() => ({
    plannedFrom: `${selectedDate}T00:00:00.000Z`,
    plannedTo: `${selectedDate}T23:59:59.999Z`
  }), [selectedDate])

  const { technicians, isLoading: techsLoading } = useTechnicians()
  const { records: serviceRecords, isLoading: servicesLoading, refetch: refetchServices } = useServiceRecords(serviceOptions)

  useEffect(() => {
    if (isTechMode && techId) {
      setSelectedTechId(techId)
    }
  }, [isTechMode, techId])

  useEffect(() => {
    const fetchRegions = async () => {
      try {
        const data = await apiJson<any[]>('/api/regions')
        setRegionsList(data || [])
      } catch (err) {
        console.error('Failed to fetch regions', err)
      }
    }
    fetchRegions()
  }, [])

  const availableRegions = useMemo(() => {
    return regionsList.map(r => normalizeRegionName(r.name)).filter(Boolean).sort()
  }, [regionsList])


  const filteredTechnicians = useMemo(() => {
    if (isTechMode && techId) return technicians.filter(t => t.id === techId)
    return technicians.filter(tech => {
      if (regionFilter !== 'all' && normalizeRegionName(tech.regionName) !== normalizeRegionName(regionFilter)) return false
      if (techFilter !== 'all' && tech.id !== techFilter) return false
      return true
    })
  }, [technicians, regionFilter, techFilter, isTechMode, techId])

  const filteredServiceRecords = useMemo(() => {
    return serviceRecords.filter(r => {
      if (statusFilter !== 'all') {
        const colorFilter = statusFilter.toLowerCase()
        const recordColor = getStatusColor(r.status).toLowerCase()
        if (colorFilter === 'bekliyor' && recordColor !== 'gray') return false
        if (colorFilter === 'atandi' && recordColor !== 'blue') return false
        if (colorFilter === 'yolda' && recordColor !== 'orange') return false
        if (colorFilter === 'islemde' && recordColor !== 'yellow') return false
        if (colorFilter === 'tamamlandi' && recordColor !== 'green') return false
        if (colorFilter === 'iptal' && recordColor !== 'red') return false
      }
      if (customerFilter.trim() !== '') {
        if (!r.customerName?.toLowerCase().includes(customerFilter.toLowerCase())) return false
      }
      if (productSearchFilter.trim() !== '') {
        if (!r.productName?.toLowerCase().includes(productSearchFilter.toLowerCase())) return false
      }
      if (productGroupFilter !== 'all') {
        const firstWord = r.productName?.trim().split(/\s+/)[0]?.toLowerCase() || ''
        if (firstWord !== productGroupFilter.toLowerCase()) return false
      }
      if (serviceTypeFilter !== 'all' && r.typeLabel !== serviceTypeFilter) return false
      if (regionFilter !== 'all' && normalizeRegionName(r.regionName) !== normalizeRegionName(regionFilter)) return false
      if (isTechMode && techId) {
        if (r.assignedTechnicianId !== techId) return false
      } else {
        if (techFilter !== 'all' && r.assignedTechnicianId !== techFilter) return false
      }
      return true
    })
  }, [serviceRecords, statusFilter, customerFilter, productSearchFilter, productGroupFilter, serviceTypeFilter, regionFilter, techFilter, isTechMode, techId])

  const todayServiceRecords = useMemo(() => {
    return filteredServiceRecords.filter(r => 
      r.routeDate === selectedDate || 
      (r.plannedAt && r.plannedAt.substring(0, 10) === selectedDate)
    )
  }, [filteredServiceRecords, selectedDate])

  const overdueStops = useMemo(() => {
    if (!selectedTechId) return []
    const todayStr = new Date().toISOString().substring(0, 10)
    return filteredServiceRecords.filter(r => {
      if (r.assignedTechnicianId !== selectedTechId) return false
      if (r.status === 'Ready' || r.status === 'Delivered' || r.status === 'Cancelled') return false
      const origDate = r.routeDate || (r.plannedAt ? r.plannedAt.substring(0, 10) : null)
      if (!origDate) return false
      
      const isPastDate = origDate < todayStr
      const isTodayTimePassed = (() => {
        if (origDate === todayStr && r.plannedEndTime) {
          const [h, m] = r.plannedEndTime.split(':').map(Number)
          if (!isNaN(h)) {
            const stopTimeMins = h * 60 + (m || 0)
            const now = new Date()
            const nowMins = now.getHours() * 60 + now.getMinutes()
            return nowMins > stopTimeMins
          }
        }
        return false
      })()
      
      return isPastDate || isTodayTimePassed
    })
  }, [filteredServiceRecords, selectedTechId])

  const selectedTechStops = useMemo(() => {
    if (!selectedTechId) return []
    const stops = todayServiceRecords.filter(r => r.assignedTechnicianId === selectedTechId)
    
    if (isTechMode) {
      return [...stops].sort((a, b) => {
        const orderA = a.userRouteSortOrder ?? 999
        const orderB = b.userRouteSortOrder ?? 999
        if (orderA !== orderB) return orderA - orderB
        return (a.userRouteHour || '23:59').localeCompare(b.userRouteHour || '23:59')
      })
    } else {
      return [...stops].sort((a, b) => {
        const orderA = a.routeOrder ?? 999
        const orderB = b.routeOrder ?? 999
        if (orderA !== orderB) return orderA - orderB
        return (a.plannedStartTime || '23:59').localeCompare(b.plannedStartTime || '23:59')
      })
    }
  }, [selectedTechId, todayServiceRecords, isTechMode])

  const unassignedStops = useMemo(() => {
    return filteredServiceRecords.filter(r => {
      if (r.status === 'Delivered' || r.status === 'Ready' || r.status === 'Cancelled') return false
      
      // Exclude overdue stops from the main pool list
      const todayStr = new Date().toISOString().substring(0, 10)
      const originalDate = r.routeDate || (r.plannedAt ? r.plannedAt.substring(0, 10) : null)
      if (originalDate) {
        const isPastDate = originalDate < todayStr
        const isTodayTimePassed = (() => {
          if (originalDate === todayStr && r.plannedEndTime) {
            const [h, m] = r.plannedEndTime.split(':').map(Number)
            if (!isNaN(h)) {
              const stopTimeMins = h * 60 + (m || 0)
              const now = new Date()
              const nowMins = now.getHours() * 60 + now.getMinutes()
              return nowMins > stopTimeMins
            }
          }
          return false
        })()
        if (isPastDate || isTodayTimePassed) return false
      }

      if (isTechMode) {
        return r.assignedTechnicianId === techId && originalDate !== selectedDate
      } else {
        if (selectedTechId) {
          return !r.assignedTechnicianId || (r.assignedTechnicianId === selectedTechId && originalDate !== selectedDate)
        }
        return !r.assignedTechnicianId
      }
    })
  }, [filteredServiceRecords, isTechMode, techId, selectedTechId, selectedDate])

  const filteredPoolStops = useMemo(() => {
    if (!poolSearchQuery.trim()) return unassignedStops
    const q = poolSearchQuery.toLowerCase()
    return unassignedStops.filter(stop => 
      stop.serviceNumber?.toLowerCase().includes(q) ||
      stop.customerName?.toLowerCase().includes(q) ||
      stop.customerAddress?.toLowerCase().includes(q) ||
      stop.productName?.toLowerCase().includes(q)
    )
  }, [unassignedStops, poolSearchQuery])

  const getRecordCoords = useCallback((record: any): [number, number] => {
    let lat = record.latitude != null ? Number(record.latitude) : null
    let lng = record.longitude != null ? Number(record.longitude) : null

    // Check if the coordinates are realistically in Cyprus bounds
    const isWithinCyprusCoords = (la: number, ln: number) => la >= 34.0 && la <= 36.5 && ln >= 32.0 && ln <= 35.0

    if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng) && isWithinCyprusCoords(lat, lng) && lat !== 0 && lng !== 0) {
      return [lat, lng]
    }

    // Parse address text to find Cyprus cities
    const addr = String(record.customerAddress || '').toLowerCase()
    const region = String(record.regionName || '').toLowerCase()

    const combinedText = `${addr} ${region}`
    let baseCoords: [number, number] = [35.1856, 33.3823] // Default Lefkosa

    if (combinedText.includes('mağusa') || combinedText.includes('magusa') || combinedText.includes('famagusta') || combinedText.includes('iskele') || combinedText.includes('trikomo')) {
      if (combinedText.includes('iskele') || combinedText.includes('trikomo')) {
        baseCoords = [35.2902, 33.8911] // Iskele center coordinates
      } else {
        baseCoords = [35.1250, 33.9380] // Gazimagusa center coordinates
      }
    } else if (combinedText.includes('girne') || combinedText.includes('kyrenia')) {
      baseCoords = [35.3381, 33.3186] // Girne center coordinates
    } else if (combinedText.includes('güzelyurt') || combinedText.includes('guzelyurt') || combinedText.includes('morphou')) {
      baseCoords = [35.1997, 32.9984] // Guzelyurt center coordinates
    } else if (combinedText.includes('lefke') || combinedText.includes('lefka')) {
      baseCoords = [35.1130, 32.8500] // Lefke center coordinates
    } else if (combinedText.includes('lefkoşa') || combinedText.includes('lefkosa') || combinedText.includes('nicosia')) {
      baseCoords = [35.1856, 33.3823] // Lefkosa center coordinates
    }

    // Add a small deterministic offset based on record.id string hash
    // to prevent exact overlapping of multiple fallback coordinates
    let hash = 0
    const idStr = String(record.id || '')
    for (let i = 0; i < idStr.length; i++) {
      hash = idStr.charCodeAt(i) + ((hash << 5) - hash)
    }
    const angle = (Math.abs(hash) % 360) * (Math.PI / 180)
    // Offset range: 0.001 to 0.005 degrees (~100 to 500 meters spread)
    const radius = 0.001 + ((Math.abs(hash >> 3) % 100) / 100) * 0.004
    const offsetLat = Math.sin(angle) * radius
    const offsetLng = Math.cos(angle) * radius

    return [baseCoords[0] + offsetLat, baseCoords[1] + offsetLng]
  }, [])

  const estimatedRouteLength = useMemo(() => {
    let total = 0
    if (selectedTechStops.length <= 1) return 0
    for (let i = 0; i < selectedTechStops.length - 1; i++) {
      const p1 = getRecordCoords(selectedTechStops[i])
      const p2 = getRecordCoords(selectedTechStops[i + 1])
      total += calculateHaversineDistance(p1[0], p1[1], p2[0], p2[1])
    }
    return Math.round(total * 10) / 10
  }, [selectedTechStops, getRecordCoords])

  const closestUpcomingStopId = useMemo(() => {
    const now = new Date()
    const currentHours = now.getHours()
    const currentMinutes = now.getMinutes()
    const currentMinutesOfDay = currentHours * 60 + currentMinutes

    let minDiff = Infinity
    let closestId: string | null = null

    selectedTechStops.forEach(stop => {
      if (stop.status === 'Ready' || stop.status === 'Delivered' || stop.status === 'Cancelled') {
        return
      }

      if (stop.plannedStartTime) {
        const parts = stop.plannedStartTime.split(':')
        if (parts.length >= 2) {
          const startMins = parseInt(parts[0]) * 60 + parseInt(parts[1])
          const diff = startMins - currentMinutesOfDay

          if (diff >= -15 && diff < minDiff) {
            minDiff = diff
            closestId = stop.id
          }
        }
      }
    })

    // Fallback: If no future stops found with start times, get the first uncompleted stop
    if (!closestId && selectedTechStops.length > 0) {
      const firstUncompleted = selectedTechStops.find(
        s => s.status !== 'Ready' && s.status !== 'Delivered' && s.status !== 'Cancelled'
      )
      if (firstUncompleted) closestId = firstUncompleted.id
    }

    return closestId
  }, [selectedTechStops])

  const isWithinCyprus = useCallback((la: number, ln: number) => {
    return la >= 34.0 && la <= 36.0 && ln >= 32.0 && ln <= 35.0
  }, [])

  const getTechCoords = useCallback((tech: any): [number, number] => {
    let lat = tech.currentLatitude != null ? Number(tech.currentLatitude) : null
    let lng = tech.currentLongitude != null ? Number(tech.currentLongitude) : null
    if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng) && isWithinCyprus(lat, lng)) {
      return [lat, lng]
    }
    // Fallback: Find today's service record assigned to this technician
    const firstJob = todayServiceRecords.find(r => 
      r.assignedTechnicianId === tech.id && 
      r.latitude != null && r.longitude != null && 
      !isNaN(Number(r.latitude)) && !isNaN(Number(r.longitude)) &&
      isWithinCyprus(Number(r.latitude), Number(r.longitude))
    )
    if (firstJob) {
      return [Number(firstJob.latitude), Number(firstJob.longitude)]
    }
    return [35.1856, 33.3823] // Nicosia center fallback
  }, [todayServiceRecords, isWithinCyprus])

  const fitPoints = useMemo(() => {
    const pts: [number, number][] = []
    if (selectedTechId) {
      const tech = technicians.find(t => t.id === selectedTechId)
      if (tech) {
        pts.push(getTechCoords(tech))
      }
      selectedTechStops.forEach(s => {
        pts.push(getRecordCoords(s))
      })
    } else {
      todayServiceRecords.forEach(r => {
        pts.push(getRecordCoords(r))
      })
    }
    return pts.length > 0 ? pts : [[35.1856, 33.3823] as [number, number]]
  }, [todayServiceRecords, selectedTechId, selectedTechStops, technicians, getTechCoords, getRecordCoords])

  const selectedRegionDetails = useMemo(() => {
    if (regionFilter === 'all') return null
    const regionJobs = todayServiceRecords.filter(r => normalizeRegionName(r.regionName) === normalizeRegionName(regionFilter) && r.latitude && r.longitude)
    if (regionJobs.length === 0) return null
    const avgLat = regionJobs.reduce((sum, r) => sum + r.latitude!, 0) / regionJobs.length
    const avgLng = regionJobs.reduce((sum, r) => sum + r.longitude!, 0) / regionJobs.length
    return { latitude: avgLat, longitude: avgLng }
  }, [regionFilter, todayServiceRecords])

  const statsSummary = useMemo(() => {
    const todayRecords = serviceRecords.filter(r => 
      r.routeDate === selectedDate || (r.plannedAt && r.plannedAt.substring(0, 10) === selectedDate)
    )
    const total = todayRecords.length
    const unassigned = todayRecords.filter(r => !r.assignedTechnicianId).length
    const assigned = total - unassigned
    const completed = todayRecords.filter(r => r.status === 'Delivered' || r.status === 'Ready').length
    const inProgress = todayRecords.filter(r => r.status === 'InRepair' || r.status === 'Workshop').length
    return { total, unassigned, assigned, completed, inProgress }
  }, [serviceRecords, selectedDate])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try { await refetchServices() } finally { setIsRefreshing(false) }
  }

  const handleAssignTechnician = async (recordId: string, technicianId: string) => {
    const record = serviceRecords.find(r => r.id === recordId)
    if (record) {
      const targetTechId = technicianId === 'unassigned' ? null : technicianId
      if (record.assignedTechnicianId !== targetTechId) {
        toast.warning('Rota sayfasında teknisyen atama veya değiştirme işlemi yapılamaz. Atamalar planlama sayfasından yapılmalıdır.')
        return
      }
    }

    try {
      const techIdVal = technicianId === 'unassigned' ? '00000000-0000-0000-0000-000000000000' : technicianId
      await apiJson(`/api/servicerecords/${recordId}/route-plan`, {
        method: 'PATCH',
        body: JSON.stringify({
          technicianId: techIdVal,
          routeDate: selectedDate,
          routeOrder: techIdVal === '00000000-0000-0000-0000-000000000000' ? null : (selectedTechStops.length + 1)
        })
      })
      refetchServices()
    } catch (err: any) {
      toast.error(err.message || 'Atama islemi basarisiz oldu.')
    }
  }

  const getDragStyle = (i: number, gap: number = 12) => {
    if (draggedStopIndex === null || dragOverStopIndex === null) {
      return { transition: 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)', transform: 'translateY(0)' }
    }
    
    if (i === draggedStopIndex) {
      const diff = dragOverStopIndex - draggedStopIndex
      return { 
        transition: 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)', 
        transform: `translateY(calc(${diff} * (100% + ${gap}px)))`, 
        zIndex: 50,
        pointerEvents: 'none' as const
      }
    }
    
    if (draggedStopIndex < dragOverStopIndex) {
      if (i > draggedStopIndex && i <= dragOverStopIndex) {
        return { transition: 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)', transform: `translateY(calc(-100% - ${gap}px))` }
      }
    } else if (draggedStopIndex > dragOverStopIndex) {
      if (i >= dragOverStopIndex && i < draggedStopIndex) {
        return { transition: 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)', transform: `translateY(calc(100% + ${gap}px))` }
      }
    }
    
    return { transition: 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)', transform: 'translateY(0)' }
  }

  const handleOfficialHoursChange = async (stopId: string, startVal: string, endVal: string) => {
    try {
      await apiJson(`/api/servicerecords/${stopId}/route-plan`, {
        method: 'PATCH',
        body: JSON.stringify({ plannedStartTime: startVal || null, plannedEndTime: endVal || null })
      })
      setEditingTime(null)
      refetchServices()
    } catch (err: any) {
      console.error('Planlama saati guncellenemedi:', err)
    }
  }

  const handleReorderStopsOfficial = async (draggedIndex: number, targetIndex: number) => {
    if (draggedIndex === targetIndex) return
    const updatedStops = [...selectedTechStops]
    const [removed] = updatedStops.splice(draggedIndex, 1)
    updatedStops.splice(targetIndex, 0, removed)

    try {
      if (isTechMode) {
        const bulkItems = updatedStops.map((stop, idx) => ({
          serviceRecordId: stop.id,
          userRouteSortOrder: idx + 1
        }))
        await apiJson('/api/servicerecords/user-plan/bulk', {
          method: 'POST',
          body: JSON.stringify({ items: bulkItems })
        })
      } else {
        const bulkItems = updatedStops.map((stop, idx) => ({
          serviceRecordId: stop.id,
          routeOrder: idx + 1
        }))
        await apiJson('/api/servicerecords/route-plan/bulk', {
          method: 'POST',
          body: JSON.stringify({ items: bulkItems })
        })
      }
      refetchServices()
    } catch (err: any) {
      console.error('Yeniden siralama hatasi:', err)
    }
  }

  /*
  const handleBulkAssign = async (tId: string) => {
    if (selectedServiceIds.length === 0) return
    const techIdVal = tId === 'unassigned' ? '00000000-0000-0000-0000-000000000000' : tId
    const bulkItems = selectedServiceIds.map((id) => ({ serviceRecordId: id, technicianId: techIdVal, routeDate: selectedDate }))
    try {
      await apiJson('/api/servicerecords/route-plan/bulk', { method: 'POST', body: JSON.stringify({ items: bulkItems }) })
      refetchServices()
      setSelectedServiceIds([])
      setBulkMode(false)
      toast.success(`${bulkItems.length} gorev basariyla atandi!`)
    } catch (err: any) {
      toast.error('Toplu atama hatasi: ' + err.message)
    }
  }

  const toggleSelectService = (id: string) => {
    setSelectedServiceIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  */

  const handleAssignPoolStops = async () => {
    if (selectedPoolStops.length === 0) return
    if (!selectedTechId) return

    // Find the current maximum routeOrder in selectedTechStops
    const currentMaxOrder = selectedTechStops.reduce((max, stop) => {
      const order = stop.routeOrder
      return order && order > max ? order : max
    }, 0)

    const bulkItems = selectedPoolStops.map((id, index) => ({
      serviceRecordId: id,
      technicianId: selectedTechId,
      routeDate: selectedDate,
      routeOrder: currentMaxOrder + index + 1
    }))
    try {
      await apiJson('/api/servicerecords/route-plan/bulk', { method: 'POST', body: JSON.stringify({ items: bulkItems }) })
      refetchServices()
      setSelectedPoolStops([])
      setIsPoolModalOpen(false)
    } catch (err: any) {
      toast.error('Atama islemi basarisiz oldu: ' + err.message)
    }
  }

  /*
  const handleAutoAssign = async () => {
    const trulyUnassigned = unassignedStops.filter(job => !job.assignedTechnicianId)
    if (trulyUnassigned.length === 0) { toast.success('Tüm işler zaten atanmış!'); return }
    if (technicians.length === 0) { toast.error('Sistemde aktif teknisyen bulunamadı.'); return }
    const bulkItems: any[] = []
    trulyUnassigned.forEach((job) => {
      if (!job.regionId) return
      const matchingTech = technicians.find(t => t.primaryRegionId === job.regionId || t.regionName === job.regionName)
      if (matchingTech) bulkItems.push({ serviceRecordId: job.id, technicianId: matchingTech.id, routeDate: selectedDate })
    })
    if (bulkItems.length === 0) { toast.error('Otomatik eşleştirme yapılamadı.'); return }
    try {
      await apiJson('/api/servicerecords/route-plan/bulk', { method: 'POST', body: JSON.stringify({ items: bulkItems }) })
      refetchServices()
      toast.success(`${bulkItems.length} görev atandı!`)
    } catch (err: any) {
      toast.error('Otomatik atama hatası: ' + err.message)
    }
  }
  */

  const trType = (v: string) => {
    const s = String(v || '')
    if (s === 'Repair') return 'Ariza'
    if (s === 'Installation') return 'Montaj'
    if (s === 'Maintenance') return 'Bakim'
    if (s === 'Warranty') return 'Garanti'
    return s
  }

  const trStatus = (v: string) => {
    const s = String(v || '')
    if (s === 'New') return 'Bekliyor'
    if (s === 'Planned') return 'Atandi'
    if (s === 'Workshop') return 'Atolyede'
    if (s === 'InRepair') return 'Yolda'
    if (s === 'WaitingForParts') return 'Parca Bekliyor'
    if (s === 'Ready') return 'Tamamlandi'
    if (s === 'Delivered') return 'Teslim Edildi'
    if (s === 'Cancelled') return 'Iptal'
    if (s === 'Delayed') return 'Gecikti'
    return s
  }

  /*
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedItemId(id)
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
  }
  */

  const handleTechCardDrop = async (e: React.DragEvent, tId: string) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || draggedItemId
    if (id) await handleAssignTechnician(id, tId)
    setDraggedItemId(null)
  }


  const recordsToDisplay = useMemo(() => {
    const todayPlanned = todayServiceRecords.filter(r => r.assignedTechnicianId)
    const todayTechPlanned = selectedTechId 
      ? todayPlanned.filter(r => r.assignedTechnicianId === selectedTechId)
      : todayPlanned
    
    return [...todayTechPlanned, ...unassignedStops]
  }, [todayServiceRecords, unassignedStops, selectedTechId])

  const clusteredRecords = useMemo(() => {
    const shouldCluster = !selectedTechId
    const threshold = 4 / Math.pow(2, zoomLevel)
    const clusters: Array<{ id: string; isCluster: boolean; latitude: number; longitude: number; records: typeof recordsToDisplay }> = []
    
    recordsToDisplay.forEach(record => {
      const coords = getRecordCoords(record)
      if (!shouldCluster) {
        clusters.push({ id: record.id, isCluster: false, latitude: coords[0], longitude: coords[1], records: [record] })
        return
      }
      let found = false
      for (const cluster of clusters) {
        const distLat = Math.abs(cluster.latitude - coords[0])
        const distLng = Math.abs(cluster.longitude - coords[1])
        if (distLat < threshold && distLng < threshold) {
          cluster.records.push(record)
          cluster.latitude = cluster.records.reduce((sum, r) => sum + getRecordCoords(r)[0], 0) / cluster.records.length
          cluster.longitude = cluster.records.reduce((sum, r) => sum + getRecordCoords(r)[1], 0) / cluster.records.length
          found = true; break
        }
      }
      if (!found) {
        clusters.push({ id: record.id, isCluster: false, latitude: coords[0], longitude: coords[1], records: [record] })
      }
    })
    clusters.forEach(c => { if (c.records.length > 1) c.isCluster = true })
    return clusters
  }, [recordsToDisplay, zoomLevel, getRecordCoords, selectedTechId])

  const getAvailabilityBadge = (tech: any, stopsCount: number) => {
    if (!tech) return null
    if (!tech.isOnline) {
      return <span className="bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] px-2 py-0.5 rounded-full font-bold border border-slate-300 dark:border-slate-700">Cevrimdisi</span>
    }
    if (stopsCount >= 3) {
      return <span className="bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px] px-2 py-0.5 rounded-full font-bold border border-amber-300 dark:border-amber-500/20">Yogun ({stopsCount})</span>
    }
    return <span className="bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] px-2 py-0.5 rounded-full font-bold border border-emerald-300 dark:border-emerald-500/20">Musait</span>
  }

  const getStatusBadge = (status: string) => {
    const color = getStatusColor(status)
    const label = trStatus(status)
    const cls: Record<string, string> = {
      gray: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700',
      blue: 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700/40',
      orange: 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700/40',
      yellow: 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700/40',
      green: 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700/40',
      red: 'bg-rose-100 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-700/40',
    }
    return <span className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold border ${cls[color] || cls.gray}`}>{label}</span>
  }

  const selectOption = 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200'

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-[#0F172A] text-slate-800 dark:text-slate-100 lg:overflow-hidden select-none">
      
      {/* TOP FILTER BAR */}
      <div className="bg-white/80 dark:bg-[#1E293B]/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 p-4 flex flex-wrap items-center justify-between gap-4 z-10 shadow-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-rose-500 to-pink-500 p-2.5 rounded-xl shadow-md shadow-rose-500/10">
            <MapIcon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              {isTechMode ? 'Kişisel Rota Planlamam' : 'Rota Planlama Modülü'}
              <span className="bg-gradient-to-r from-rose-500/15 to-pink-500/15 text-rose-600 dark:text-rose-400 text-[10px] px-2.5 py-0.5 rounded-full font-bold border border-rose-500/20">
                {isTechMode ? 'Teknisyen' : 'Yönetici'}
              </span>
            </h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              {isTechMode
                ? 'Günlük iş planınızı sıralayın, saatlerini belirleyin ve harita üzerinden takip edin.'
                : 'Teknisyenlerin günlük görev atamalarını, sıralarını ve rotalarını harita üzerinden yönetin.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80 rounded-xl px-2.5 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-rose-500/20 focus-within:border-rose-500 transition-all">
            <Calendar className="w-3.5 h-3.5 text-rose-500" />
            <input type="date" value={selectedDate}
              onChange={(e) => { setSelectedDate(e.target.value); setSelectedTechId(isTechMode ? techId : null) }}
              className="bg-transparent border-none text-xs text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer font-semibold"
            />
          </div>

          {!isTechMode && (
            <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80 rounded-xl px-2.5 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-rose-500/20 transition-all">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}
                className="bg-transparent border-none text-xs text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer font-semibold">
                <option value="all" className={selectOption}>Bölgeler (Tümü)</option>
                {availableRegions.map(r => <option key={r} value={r} className={selectOption}>{r}</option>)}
              </select>
            </div>
          )}

          {!isTechMode && (
            <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80 rounded-xl px-2.5 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-rose-500/20 transition-all">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <select value={techFilter}
                onChange={(e) => {
                  const val = e.target.value
                  setTechFilter(val)
                  setSelectedTechId(val !== 'all' ? val : null)
                }}
                className="bg-transparent border-none text-xs text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer w-28 font-semibold">
                <option value="all" className={selectOption}>Teknisyenler (Tümü)</option>
                {technicians.map(t => <option key={t.id} value={t.id} className={selectOption}>{t.fullName}</option>)}
              </select>
            </div>
          )}

          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80 rounded-xl px-2.5 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-rose-500/20 transition-all">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input type="text" placeholder="Müşteri Ara..." value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="bg-transparent border-none text-xs text-slate-800 dark:text-slate-200 focus:outline-none placeholder-slate-400 dark:placeholder-slate-500 w-24 font-medium"
            />
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80 rounded-xl px-2.5 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-rose-500/20 transition-all">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <input type="text" placeholder="Ürün Ara..." value={productSearchFilter}
              onChange={(e) => setProductSearchFilter(e.target.value)}
              className="bg-transparent border-none text-xs text-slate-800 dark:text-slate-200 focus:outline-none placeholder-slate-400 dark:placeholder-slate-500 w-24 font-medium"
            />
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80 rounded-xl px-2.5 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-rose-500/20 transition-all">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select value={serviceTypeFilter} onChange={(e) => setServiceTypeFilter(e.target.value)}
              className="bg-transparent border-none text-xs text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer font-semibold">
              <option value="all" className={selectOption}>Servis Türü (Tümü)</option>
              <option value="Repair" className={selectOption}>Arıza</option>
              <option value="Installation" className={selectOption}>Montaj</option>
              <option value="Maintenance" className={selectOption}>Bakım</option>
              <option value="Warranty" className={selectOption}>Garanti</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700/80 rounded-xl px-2.5 py-1.5 shadow-sm focus-within:ring-2 focus-within:ring-rose-500/20 transition-all">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent border-none text-xs text-slate-800 dark:text-slate-200 focus:outline-none cursor-pointer font-semibold">
              <option value="all" className={selectOption}>İş Durumu (Tümü)</option>
              <option value="bekliyor" className={selectOption}>Bekliyor</option>
              <option value="atandi" className={selectOption}>Atandı</option>
              <option value="yolda" className={selectOption}>Yolda</option>
              <option value="islemde" className={selectOption}>İşlemde</option>
              <option value="tamamlandi" className={selectOption}>Tamamlandı</option>
              <option value="iptal" className={selectOption}>İptal</option>
            </select>
          </div>

          {(regionFilter !== 'all' || techFilter !== 'all' || customerFilter !== '' || productSearchFilter !== '' || productGroupFilter !== 'all' || serviceTypeFilter !== 'all' || statusFilter !== 'all') && (
            <button onClick={() => {
              setRegionFilter('all'); setTechFilter('all'); setCustomerFilter(''); setProductSearchFilter('')
              setProductGroupFilter('all'); setServiceTypeFilter('all'); setStatusFilter('all'); setSelectedTechId(isTechMode ? techId : null)
            }} className="p-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 rounded-xl border border-rose-200 dark:border-rose-800/60 transition-all flex items-center gap-1 text-xs cursor-pointer font-bold shadow-sm" title="Filtreleri Sıfırla">
              <X className="w-3.5 h-3.5" /> Sıfırla
            </button>
          )}



          <button onClick={handleRefresh} disabled={isRefreshing || servicesLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-sm">
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-rose-500' : 'text-slate-400'}`} />
          </button>
        </div>
      </div>

      {/* MAIN SPLIT PANEL */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-10 overflow-hidden min-h-0">

        {/* MAP (60%) */}
        <div className={`relative border-r border-slate-200 dark:border-slate-800 h-full flex flex-col min-h-0 transition-all duration-300 ${isMapMaximized ? 'lg:col-span-10' : 'lg:col-span-6'}`}>
          <div className="flex-1 relative z-0 min-h-0">
            {/* Maximize Map Toggle Button */}
            <button
              onClick={() => setIsMapMaximized(prev => !prev)}
              className="absolute top-4 right-4 z-[1000] p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 rounded-xl shadow-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-all cursor-pointer hover:scale-105 active:scale-95 flex items-center gap-1.5 text-xs font-bold"
              title={isMapMaximized ? "Daralt" : "Haritayı Genişlet"}
            >
              {isMapMaximized ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>Daralt</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>Haritayı Genişlet</span>
                </>
              )}
            </button>

            <MapContainer center={[35.1856, 33.3823]} zoom={10}
              style={{ height: '100%', width: '100%', background: isDark ? '#0b0f19' : '#e5e7eb' }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <ZoomDetector setZoomLevel={setZoomLevel} />
              <MapFocusController selectedServiceId={selectedServiceId} todayServiceRecords={recordsToDisplay} getRecordCoords={getRecordCoords} />
              <MapResizeController isMaximized={isMapMaximized} />
              <FitMapBounds points={fitPoints} selectedTechId={selectedTechId} selectedDate={selectedDate} />

              {selectedRegionDetails && (
                <Circle center={[selectedRegionDetails.latitude, selectedRegionDetails.longitude]}
                  radius={12000}
                  pathOptions={{ fillColor: '#f43f5e', fillOpacity: 0.08, color: '#f43f5e', weight: 2, dashArray: '5, 8' }}
                />
              )}

              {filteredTechnicians
                .filter(tech => !selectedTechId || tech.id === selectedTechId)
                .map(tech => {
                  const coords = getTechCoords(tech)
                  const isSelected = tech.id === selectedTechId
                  const initials = tech.initials || tech.fullName.split(' ').filter(Boolean).slice(0, 2).map((p: string) => p[0]).join('')
                  return (
                  <Marker key={tech.id} position={coords}
                    icon={createTechnicianIcon(initials, isSelected)}
                    eventHandlers={{ click: () => setSelectedTechId(tech.id) }}>
                    <Popup className="dark-popup">
                      <div className="text-slate-900 p-1.5 min-w-[160px] font-sans">
                        <p className="font-bold text-xs">{tech.fullName}</p>
                        <p className="text-slate-500 text-[10px] mt-0.5">&#128205; {tech.regionName || 'Bolge Belirtilmemis'}</p>
                        <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-1.5">
                          <span className={`w-2 h-2 rounded-full ${tech.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                          <span className="text-[10px] font-bold text-slate-600">{tech.isOnline ? 'Cevrimici' : 'Cevrimdisi'}</span>
                        </div>
                        <p className="text-[9px] text-slate-400 mt-1">
                          Atanmis Is: <strong className="text-slate-800">{serviceRecords.filter(r => r.assignedTechnicianId === tech.id).length}</strong>
                        </p>
                      </div>
                    </Popup>
                  </Marker>
                )
              })}

              {clusteredRecords.map((cluster) => {
                if (cluster.isCluster) {
                  return (
                    <Marker key={`cluster-${cluster.id}`} position={[cluster.latitude, cluster.longitude]}
                      icon={createClusterIcon(cluster.records.length)}
                      eventHandlers={{ click: (e) => { const map = (e as any).target._map; map.setView([cluster.latitude, cluster.longitude], Math.min(zoomLevel + 2, 16)) } }}
                    />
                  )
                }
                const record = cluster.records[0]
                const isHighlighted = record.id === selectedServiceId

                // Determine sequence number if assigned to a technician
                let sequenceNum: number | null = null
                if (record.assignedTechnicianId) {
                  if (record.assignedTechnicianId === selectedTechId) {
                    const idx = selectedTechStops.findIndex(s => s.id === record.id)
                    if (idx !== -1) sequenceNum = idx + 1
                  } else {
                    const techStops = todayServiceRecords.filter(r => r.assignedTechnicianId === record.assignedTechnicianId)
                    const sortedTechStops = [...techStops].sort((a, b) => {
                      const orderA = a.routeOrder ?? 999
                      const orderB = b.routeOrder ?? 999
                      if (orderA !== orderB) return orderA - orderB
                      return (a.plannedStartTime || '23:59').localeCompare(b.plannedStartTime || '23:59')
                    })
                    const idx = sortedTechStops.findIndex(s => s.id === record.id)
                    if (idx !== -1) sequenceNum = idx + 1
                  }
                }

                const isSelectedTech = selectedTechId ? record.assignedTechnicianId === selectedTechId : false
                const recCoords = getRecordCoords(record)
                return (
                  <Marker key={record.id} position={recCoords}
                    icon={getServiceMarkerIcon(sequenceNum, record.status, isSelectedTech, isHighlighted, record.typeLabel || '')}
                    eventHandlers={{ click: () => { setSelectedServiceId(record.id); if (record.assignedTechnicianId) setSelectedTechId(record.assignedTechnicianId) } }}>
                    <Popup className="dark-popup">
                      <div className="text-slate-900 min-w-[240px] p-2 space-y-1.5 font-sans">
                        <div className="flex justify-between items-center border-b border-slate-100 pb-1.5 mb-1.5">
                          <span className="text-[10px] font-bold text-slate-500 font-mono">{record.serviceNumber}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${record.type === 'Installation' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>{trType(record.typeLabel)}</span>
                        </div>
                        <div><span className="text-[9px] uppercase font-bold text-slate-400 block">Musteri</span><p className="font-bold text-xs text-slate-800">{record.customerName || 'Belirtilmemis'}</p></div>
                        <div><span className="text-[9px] uppercase font-bold text-slate-400 block">Telefon</span><p className="text-xs font-semibold text-slate-700">{record.customerPhone || 'Girilmemis'}</p></div>
                        <div><span className="text-[9px] uppercase font-bold text-slate-400 block">Adres</span><p className="text-[10px] text-slate-600">&#128205; {record.customerAddress || 'Girilmemis'}</p></div>
                        <div><span className="text-[9px] uppercase font-bold text-slate-400 block">Urun</span><p className="text-xs font-semibold text-slate-800">{record.productName}</p></div>
                        <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 text-[10px]">
                          <div><span className="text-slate-400 block text-[8px] uppercase font-bold">Durum</span><span className="font-bold text-slate-800">{trStatus(record.statusLabel)}</span></div>
                          <div><span className="text-slate-400 block text-[8px] uppercase font-bold">Saat</span><span className="font-bold text-rose-600 font-mono">{record.plannedStartTime ? `${record.plannedStartTime}${record.plannedEndTime ? ' - ' + record.plannedEndTime : ''}` : 'Belirtilmemis'}</span></div>
                          <div><span className="text-slate-400 block text-[8px] uppercase font-bold">Teknisyen</span><span className="font-semibold text-slate-800">{record.assignedTechnicianName || 'Atanmamis'}</span></div>
                        </div>
                        {/* Technician reassignment dropdown completely removed from route page popups */}
                      </div>
                    </Popup>
                  </Marker>
                )
              })}

              {selectedTechId && selectedTechStops.length > 1 && (
                <Polyline
                  positions={selectedTechStops.map(s => getRecordCoords(s))}
                  color="#f43f5e" weight={4} opacity={0.85} dashArray="8, 12"
                />
              )}
            </MapContainer>
          </div>

          {/* Stats Bar */}
          <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-4 grid grid-cols-3 sm:grid-cols-5 gap-y-2 text-center text-xs flex-shrink-0">
            {[
              { label: 'Toplam Is', value: statsSummary.total, cls: 'text-slate-900 dark:text-white' },
              { label: 'Atanmamis', value: statsSummary.unassigned, cls: 'text-amber-500' },
              { label: 'Atanmis', value: statsSummary.assigned, cls: 'text-blue-500 dark:text-blue-400' },
              { label: 'Yolda/Islemde', value: statsSummary.inProgress, cls: 'text-orange-400' },
              { label: 'Tamamlanan', value: statsSummary.completed, cls: 'text-emerald-500 dark:text-emerald-400' },
            ].map(s => (
              <div key={s.label}>
                <div className="text-slate-500 dark:text-slate-400 font-medium">{s.label}</div>
                <div className={`text-base font-extrabold mt-0.5 ${s.cls}`}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT PANEL (40%) */}
        <div className={`flex flex-col h-full overflow-hidden min-h-0 bg-slate-50 dark:bg-[#0F172A] divide-y divide-slate-200 dark:divide-slate-800 transition-all duration-300 ${isMapMaximized ? 'hidden lg:hidden' : 'lg:col-span-4'}`}>

          {/* TOP: Tech detail or list */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            {selectedTechId ? (
              <div className="flex-1 flex flex-col overflow-hidden min-h-0 divide-y divide-slate-200 dark:divide-slate-800">

                {/* Tech Info */}
                <div className="p-4 bg-white dark:bg-slate-800/50 flex-shrink-0">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {!isTechMode && (
                        <button onClick={() => { setSelectedTechId(null); setSelectedServiceId(null) }}
                          className="p-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer" title="Listeye Don">
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                      )}
                      <div>
                        <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                          {technicians.find(t => t.id === selectedTechId)?.fullName || 'Teknisyen'}
                          {getAvailabilityBadge(technicians.find(t => t.id === selectedTechId), selectedTechStops.length)}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          &#128205; {technicians.find(t => t.id === selectedTechId)?.regionName || 'Bolge Belirtilmemis'}
                        </p>
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      <div className="text-slate-500 dark:text-slate-400">Gunluk Ilerleme</div>
                      <span className="font-bold font-mono text-rose-500 dark:text-rose-400">
                        {selectedTechStops.filter(r => r.status === 'Ready' || r.status === 'Delivered').length}/{selectedTechStops.length} Gorev
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 flex items-center justify-between text-xs">
                    <div><span className="text-slate-400">Tahmini Mesafe: </span><span className="font-bold text-slate-900 dark:text-white font-mono">{estimatedRouteLength} km</span></div>
                    <div><span className="text-slate-400">Tarih: </span><span className="font-bold text-rose-500 dark:text-rose-400">{selectedDate.split('-').reverse().join('.')}</span></div>
                  </div>
                </div>

                {/* Timeline */}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { const id = e.dataTransfer.getData('text/plain') || draggedItemId; if (id) handleAssignTechnician(id, selectedTechId) }}
                  className="flex-1 overflow-y-auto p-4 min-h-0 bg-slate-50/50 dark:bg-slate-950/20 space-y-3"
                >
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[10px] font-bold text-rose-500 dark:text-rose-400 uppercase tracking-wider">Gunluk Zaman Cizelgesi</span>
                    <span className="text-[9px] text-slate-400 font-semibold italic">Surukleme ile siralayin</span>
                  </div>

                  {selectedTechStops.length === 0 ? (
                    <div className="py-12 text-center">
                      <Info className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
                      <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Atanmış Görev Yok</p>
                      <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1 max-w-[200px] mx-auto">Aşağıdaki "Havuzdan Ata" butonuna basarak havuzdaki işleri seçip buraya atayabilirsiniz.</p>
                    </div>
                  ) : (
                    <div className="relative border-l-2 border-slate-200 dark:border-slate-800 ml-4 space-y-3 pt-2">
                      {selectedTechStops.map((stop, idx) => {
                        const isHighlighted = stop.id === selectedServiceId
                        const isEditingThis = editingTime?.id === stop.id
                        const currentStart = isEditingThis ? editingTime.start : (stop.plannedStartTime || '')
                        const currentEnd = isEditingThis ? editingTime.end : (stop.plannedEndTime || '')
                        const hasTime = !!(stop.plannedStartTime || stop.plannedEndTime)

                        const isTimePassed = (() => {
                          if (stop.status === 'Ready' || stop.status === 'Delivered' || stop.status === 'Cancelled') {
                            return false
                          }
                          const now = new Date()
                          const offset = now.getTimezoneOffset()
                          const localNow = new Date(now.getTime() - (offset * 60 * 1000))
                          const todayStr = localNow.toISOString().split('T')[0]
                          const stopDate = stop.routeDate || (stop.plannedAt ? stop.plannedAt.substring(0, 10) : '')

                          if (!stopDate) return false
                          if (stopDate < todayStr) return true
                          if (stopDate === todayStr && stop.plannedEndTime) {
                            const [h, m] = stop.plannedEndTime.split(':').map(Number)
                            if (!isNaN(h)) {
                              const stopTimeMins = h * 60 + (m || 0)
                              const nowMins = now.getHours() * 60 + now.getMinutes()
                              return nowMins > stopTimeMins
                            }
                          }
                          return false
                        })()

                        const isCompleted = stop.status === 'Ready' || stop.status === 'Delivered'
                        const isStruckThrough = isCompleted || isTimePassed

                        return (
                          <div key={stop.id}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('stopIndex', String(idx));
                              setDraggedStopIndex(idx);
                            }}
                            onDragEnd={() => {
                              setDraggedStopIndex(null);
                              setDragOverStopIndex(null);
                            }}
                            onDragOver={(e) => e.preventDefault()}
                            onDragEnter={() => {
                              if (draggedStopIndex !== null && draggedStopIndex !== idx) {
                                setDragOverStopIndex(idx);
                              }
                            }}
                            onDragLeave={() => {
                              if (dragOverStopIndex === idx) {
                                setDragOverStopIndex(null);
                              }
                            }}
                            onDrop={(e) => {
                              e.stopPropagation()
                              const dragIdx = parseInt(e.dataTransfer.getData('stopIndex'))
                              if (!isNaN(dragIdx)) { handleReorderStopsOfficial(dragIdx, idx) }
                              else { const jobId = e.dataTransfer.getData('text/plain') || draggedItemId; if (jobId) handleAssignTechnician(jobId, selectedTechId) }
                              setDraggedStopIndex(null);
                              setDragOverStopIndex(null);
                            }}
                            onClick={() => setSelectedServiceId(stop.id)}
                            className={`relative pl-8 transition-all group cursor-pointer ${isHighlighted ? 'scale-[1.01]' : ''}`}
                            style={getDragStyle(idx, 12)}
                          >
                            {/* Timeline dot */}
                            <div className={`absolute -left-[9px] top-2 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all ${isHighlighted ? 'bg-rose-500 border-rose-400 ring-4 ring-rose-500/25 shadow-lg' : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 group-hover:border-slate-500'}`}>
                              <span className="text-[8px] font-bold text-slate-500 dark:text-slate-400 font-mono">{idx + 1}</span>
                            </div>

                            {/* Card */}
                            <div className={`relative overflow-hidden bg-white dark:bg-slate-800/50 border rounded-xl p-3 flex gap-3 transition-all ${
                              draggedStopIndex === idx
                                ? 'border-rose-500 dark:border-rose-500 ring-2 ring-rose-500/30 shadow-lg shadow-rose-500/20 animate-custom-shake'
                                : dragOverStopIndex === idx
                                ? 'border-yellow-500 dark:border-yellow-500 ring-2 ring-yellow-500/40 shadow-md shadow-yellow-500/10'
                                : closestUpcomingStopId === stop.id
                                ? 'border-rose-500 dark:border-rose-500/80 ring-2 ring-rose-500/20 shadow-md shadow-rose-500/10'
                                : isHighlighted
                                ? 'border-rose-400 dark:border-rose-500/60 shadow-md'
                                : 'border-slate-200 dark:border-slate-700/80 hover:border-yellow-500 dark:hover:border-yellow-500 hover:ring-2 hover:ring-yellow-500/20'
                            }`}>
                              {isTimePassed ? (
                                <div className="absolute top-0 right-0 bg-slate-900 dark:bg-slate-950 text-white text-[7.5px] font-extrabold px-2 py-0.5 rounded-bl-lg uppercase tracking-wider z-10 shadow-sm border-l border-b border-slate-700">
                                  Zamanı Geçti
                                </div>
                              ) : (
                                closestUpcomingStopId === stop.id && (
                                  <div className="absolute top-0 right-0 bg-red-500 text-white text-[7.5px] font-extrabold px-2 py-0.5 rounded-bl-lg animate-pulse uppercase tracking-wider z-10">
                                    Zamanı Yaklaşıyor
                                  </div>
                                )
                              )}
                              {/* Reorder handles */}
                              <div className="flex flex-col items-center justify-between py-1 flex-shrink-0">
                                <GripVertical className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 cursor-grab" />
                                <div className="flex flex-col gap-0.5 mt-1">
                                  <button onClick={(e) => { e.stopPropagation(); handleReorderStopsOfficial(idx, idx - 1) }} disabled={idx === 0}
                                    className={`p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 ${idx === 0 ? 'opacity-20 cursor-not-allowed' : 'cursor-pointer'}`}>
                                    <ArrowUp className="w-3 h-3" />
                                  </button>
                                  <button onClick={(e) => { e.stopPropagation(); handleReorderStopsOfficial(idx, idx + 1) }} disabled={idx === selectedTechStops.length - 1}
                                    className={`p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 ${idx === selectedTechStops.length - 1 ? 'opacity-20 cursor-not-allowed' : 'cursor-pointer'}`}>
                                    <ArrowDown className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>

                              {/* Details */}
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-start">
                                  <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 font-mono">{stop.serviceNumber}</span>
                                  <div className="flex items-center gap-1">
                                    {getStatusBadge(stop.status)}
                                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${stop.type === 'Installation' ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' : 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'}`}>{trType(stop.typeLabel)}</span>
                                    {stop.status !== 'Ready' && stop.status !== 'Delivered' && stop.status !== 'Cancelled' && (
                                      <button
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          try {
                                            await apiJson(`/api/servicerecords/${stop.id}/status`, {
                                              method: 'PATCH',
                                              body: JSON.stringify({ status: 'Ready' })
                                            });
                                            refetchServices();
                                          } catch (err: any) {
                                            toast.error(err.message || 'Durum güncellenirken hata oluştu.');
                                          }
                                        }}
                                        className="px-2 py-0.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded text-[8px] font-extrabold uppercase transition-all shadow-sm hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-0.5"
                                        title="Yapıldı Olarak İşaretle"
                                      >
                                        <Check className="w-2.5 h-2.5" /> Yapıldı
                                      </button>
                                    )}
                                    {/* Unassign button removed per user request: technician change/unassignment is forbidden in route section */}
                                  </div>
                                </div>

                                <h4 className={`font-bold text-xs truncate mt-1 ${
                                  isStruckThrough
                                    ? 'text-slate-400 dark:text-slate-500 line-through opacity-70'
                                    : 'text-slate-900 dark:text-white'
                                }`}>
                                  {stop.customerName || 'Musteri Belirtilmemis'}
                                </h4>
                                <p className={`text-[10px] truncate ${
                                  isStruckThrough
                                    ? 'text-slate-400/80 dark:text-slate-500/80 line-through opacity-60'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}>
                                  {stop.productName}
                                </p>
                                <p className={`text-[9px] truncate ${
                                  isStruckThrough
                                    ? 'text-slate-400/80 dark:text-slate-500/80 line-through opacity-60'
                                    : 'text-slate-450 dark:text-slate-500'
                                }`}>
                                  &#128205; {stop.customerAddress}
                                </p>
                                <div className="flex items-center gap-1 mt-1 text-[9px] text-slate-500 dark:text-slate-400 font-medium">
                                  <Calendar className="w-3.5 h-3.5 text-rose-500/85" />
                                  <span>{stop.routeDate ? stop.routeDate.split('-').reverse().join('.') : (stop.plannedAt ? stop.plannedAt.substring(0, 10).split('-').reverse().join('.') : 'Tarih Belirtilmemiş')}</span>
                                </div>

                                {/* ====== TIME PLANNING - BEAUTIFUL UI ====== */}
                                <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[9px] text-slate-500 dark:text-slate-400 font-semibold flex items-center gap-1">
                                      <Clock className="w-3 h-3 text-rose-400" /> Saat Plani
                                    </span>
                                    {hasTime && (
                                      <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/40 rounded-full px-2 py-0.5 font-mono">
                                        &#9200; {stop.plannedStartTime}{stop.plannedEndTime ? ` - ${stop.plannedEndTime}` : ''}
                                      </span>
                                    )}
                                  </div>

                                  {/* Preset buttons */}
                                  <div className="flex gap-1 mb-1.5">
                                    {hourPresets.map(p => (
                                      <button key={p.label}
                                        onClick={(e) => { e.stopPropagation(); setEditingTime({ id: stop.id, start: p.start, end: p.end }); handleOfficialHoursChange(stop.id, p.start, p.end) }}
                                        className={`flex-1 py-1 rounded-lg text-[8px] font-bold text-white bg-gradient-to-br ${p.color} opacity-75 hover:opacity-100 hover:scale-105 transition-all cursor-pointer shadow-sm`}
                                        title={p.sub}>
                                        {p.label}
                                        <span className="block text-[7px] font-normal opacity-90">{p.sub}</span>
                                      </button>
                                    ))}
                                  </div>

                                  {/* Manual time inputs */}
                                  <div className="flex items-center gap-1" onClick={(e) => { e.stopPropagation(); if (!isEditingThis) setEditingTime({ id: stop.id, start: stop.plannedStartTime || '', end: stop.plannedEndTime || '' }) }}>
                                    <div className="flex items-center gap-1 flex-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1">
                                      <Clock className="w-2.5 h-2.5 text-slate-400 flex-shrink-0" />
                                      <input type="time" value={currentStart}
                                        onChange={(e) => { e.stopPropagation(); const v = e.target.value; setEditingTime(prev => prev ? { ...prev, start: v } : { id: stop.id, start: v, end: stop.plannedEndTime || '' }) }}
                                        className="bg-transparent border-none text-[10px] text-slate-800 dark:text-slate-200 focus:outline-none w-full font-mono"
                                      />
                                    </div>
                                    <span className="text-[10px] text-slate-400">-</span>
                                    <div className="flex items-center gap-1 flex-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1">
                                      <Clock className="w-2.5 h-2.5 text-slate-400 flex-shrink-0" />
                                      <input type="time" value={currentEnd}
                                        onChange={(e) => { e.stopPropagation(); const v = e.target.value; setEditingTime(prev => prev ? { ...prev, end: v } : { id: stop.id, start: stop.plannedStartTime || '', end: v }) }}
                                        className="bg-transparent border-none text-[10px] text-slate-800 dark:text-slate-200 focus:outline-none w-full font-mono"
                                      />
                                    </div>
                                    {isEditingThis && (
                                      <button onClick={(e) => { e.stopPropagation(); handleOfficialHoursChange(stop.id, currentStart, currentEnd) }}
                                        className="flex-shrink-0 p-1.5 bg-emerald-500 hover:bg-emerald-400 text-white rounded-lg transition-colors cursor-pointer shadow-sm" title="Kaydet">
                                        <Check className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {/* ====== END TIME PLANNING ====== */}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Action Footer */}
                <div className="p-4 bg-white dark:bg-slate-850/80 border-t border-slate-200 dark:border-slate-800 flex-shrink-0 flex items-center justify-between gap-3">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Havuzda <span className="font-bold text-amber-500 font-mono">{unassignedStops.length}</span> iş var.
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsSortModalOpen(true)}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-750 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer active:scale-95 animate-fade-in"
                    >
                      <GripVertical className="w-3.5 h-3.5 text-slate-400" />
                      Sırala
                    </button>
                    <button
                      onClick={() => { setSelectedPoolStops([]); setPoolSearchQuery(''); setIsPoolModalOpen(true) }}
                      className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-rose-500/10 cursor-pointer active:scale-95"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      Havuzdan Ata
                    </button>
                    <button
                      onClick={() => { setIsOverdueModalOpen(true) }}
                      className="flex items-center gap-1.5 px-3.5 py-2 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/20 dark:hover:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/40 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer active:scale-95 flex-shrink-0"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      Zamanı Geçenler
                      {overdueStops.length > 0 && (
                        <span className="bg-amber-600 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                          {overdueStops.length}
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Technicians List */
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                <div className="bg-white dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 flex-shrink-0 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">Aktif Teknisyenler ({filteredTechnicians.length})</span>
                  <span className="text-[9px] text-slate-400 italic">Gorevleri uzerlerine surukleyebilirsiniz</span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 content-start">
                  {techsLoading ? (
                    <div className="col-span-full text-center py-12 flex flex-col items-center gap-3">
                      <RefreshCw className="w-6 h-6 animate-spin text-rose-500" />
                      <span className="text-slate-500 text-xs italic">Teknisyenler yukleniyor...</span>
                    </div>
                  ) : filteredTechnicians.length === 0 ? (
                    <div className="col-span-full text-center py-12 text-slate-500 text-xs">Aktif teknisyen bulunamadi.</div>
                  ) : (
                    filteredTechnicians.map((tech) => {
                      const stopsCount = serviceRecords.filter(r => r.assignedTechnicianId === tech.id).length
                      const finishedCount = serviceRecords.filter(r => r.assignedTechnicianId === tech.id && (r.status === 'Ready' || r.status === 'Delivered')).length
                      const inProgressCount = serviceRecords.filter(r => r.assignedTechnicianId === tech.id && (r.status === 'InRepair' || r.status === 'Workshop')).length
                      const initials = tech.initials || tech.fullName.split(' ').filter(Boolean).slice(0, 2).map((p: string) => p[0]).join('')

                      return (
                        <div key={tech.id}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => handleTechCardDrop(e, tech.id)}
                          onClick={() => setSelectedTechId(tech.id)}
                          className="rounded-xl p-3 flex items-center gap-3 transition-all border bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-md cursor-pointer select-none relative group"
                        >
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs text-white flex-shrink-0 bg-gradient-to-br from-slate-600 to-slate-700 ring-2 ${tech.isOnline ? 'ring-emerald-400' : 'ring-slate-300 dark:ring-slate-600'}`}>
                            {initials}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-xs truncate text-slate-900 dark:text-white">{tech.fullName}</span>
                              <span className={`w-2 h-2 rounded-full ml-1 flex-shrink-0 ${tech.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300 dark:bg-slate-600'}`} />
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                              <span className="truncate">&#128205; {tech.regionName || 'Belirtilmemis'}</span>
                              <span className="font-bold font-mono flex-shrink-0 ml-1">
                                <span className="text-emerald-500 dark:text-emerald-400">{finishedCount}</span>
                                <span className="text-slate-300 dark:text-slate-600">/</span>
                                <span className="text-blue-500 dark:text-blue-400">{stopsCount}</span>
                              </span>
                            </div>
                            <div className="mt-1.5 flex items-center justify-between">
                              {getAvailabilityBadge(tech, stopsCount)}
                              <span className="text-[9px] text-slate-400 dark:text-slate-500">{inProgressCount} Devam Eden</span>
                            </div>
                          </div>
                          {draggedItemId && (
                            <div className="absolute inset-0 bg-emerald-500/10 border-2 border-dashed border-emerald-500 rounded-xl pointer-events-none flex items-center justify-center animate-pulse">
                              <span className="text-[10px] font-bold text-emerald-500">Ustune Birak</span>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* POOL ASSIGN MODAL */}
      {isPoolModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 flex-shrink-0">
              <div>
                <h3 className="font-extrabold text-sm text-slate-950 dark:text-white flex items-center gap-2">
                  Havuzdaki İşleri Planla
                  <span className="bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 text-[10px] px-2.5 py-0.5 rounded-full font-bold border border-amber-200 dark:border-amber-900/30">
                    {unassignedStops.length} İş
                  </span>
                </h3>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Bu teknisyene atanmış olan ancak henüz günlük zaman çizelgesine eklenmemiş işleri seçerek rotaya dahil edebilirsiniz.
                </p>
              </div>
              <button
                onClick={() => setIsPoolModalOpen(false)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Search Bar */}
            <div className="p-3 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800/60 flex-shrink-0">
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-rose-500/20 focus-within:border-rose-500 transition-all">
                <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <input
                  type="text"
                  placeholder="Müşteri, iş numarası, ürün veya adres ara..."
                  value={poolSearchQuery}
                  onChange={(e) => setPoolSearchQuery(e.target.value)}
                  className="bg-transparent border-none text-xs text-slate-800 dark:text-slate-200 focus:outline-none placeholder-slate-400 w-full font-medium"
                />
                {poolSearchQuery && (
                  <button onClick={() => setPoolSearchQuery('')} className="text-slate-400 hover:text-slate-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Modal List Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5 min-h-0 bg-slate-50/50 dark:bg-slate-950/20">
              {filteredPoolStops.length === 0 ? (
                <div className="py-16 text-center">
                  <AlertCircle className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto mb-2.5 animate-pulse" />
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-400">Planlanmamış İş Bulunamadı</p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 max-w-[240px] mx-auto">
                    {poolSearchQuery ? 'Arama kriterlerinize uygun iş bulunmuyor.' : 'Teknisyenin havuzunda henüz planlanmamış bir iş bulunmuyor.'}
                  </p>
                </div>
              ) : (
                filteredPoolStops.map((stop) => {
                  const isChecked = selectedPoolStops.includes(stop.id)
                  const dateStr = stop.routeDate || (stop.plannedAt ? stop.plannedAt.substring(0, 10) : null)
                  const isBacklog = dateStr && dateStr !== selectedDate

                  const handleToggle = () => {
                    setSelectedPoolStops(prev =>
                      prev.includes(stop.id)
                        ? prev.filter(id => id !== stop.id)
                        : [...prev, stop.id]
                    )
                  }

                  return (
                    <div
                      key={stop.id}
                      onClick={handleToggle}
                      className={`border p-3 rounded-xl transition-all select-none flex gap-3 relative cursor-pointer bg-white dark:bg-slate-900 ${
                        isChecked
                          ? 'border-rose-500 dark:border-rose-500/80 shadow-md shadow-rose-500/5 bg-rose-500/5 dark:bg-rose-500/[0.02]'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-center flex-shrink-0">
                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${
                          isChecked
                            ? 'bg-rose-500 border-rose-500 text-white'
                            : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950'
                        }`}>
                          {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start">
                          <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 font-mono">{stop.serviceNumber}</span>
                          <div className="flex items-center gap-1">
                            {getStatusBadge(stop.status)}
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${stop.type === 'Installation' ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' : 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'}`}>{trType(stop.typeLabel)}</span>
                          </div>
                        </div>

                        {isBacklog && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <AlertCircle className="w-2.5 h-2.5 text-amber-500 flex-shrink-0" />
                            <span className="text-[8px] font-bold text-amber-600 dark:text-amber-400">
                              Planlandığı Tarih: {String(dateStr).split('-').reverse().join('.')}
                            </span>
                          </div>
                        )}

                        <h4 className="font-bold text-xs text-slate-900 dark:text-white truncate mt-1">{stop.customerName || 'Müşteri Belirtilmemiş'}</h4>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">{stop.productName}</p>
                        <p className="text-[9px] text-slate-400 dark:text-slate-500 truncate mt-0.5">&#128205; {stop.customerAddress}</p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 flex-shrink-0">
              <div className="text-xs text-slate-600 dark:text-slate-400 font-medium">
                {selectedPoolStops.length > 0 ? (
                  <span>
                    <strong className="text-rose-500 dark:text-rose-400">{selectedPoolStops.length}</strong> iş seçildi
                  </span>
                ) : (
                  'Zaman çizelgesine eklenecek iş seçin'
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsPoolModalOpen(false)}
                  className="px-3.5 py-1.5 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-xs font-semibold transition-all cursor-pointer"
                >
                  İptal
                </button>
                <button
                  onClick={handleAssignPoolStops}
                  disabled={selectedPoolStops.length === 0}
                  className={`px-4 py-1.5 text-white font-bold rounded-xl text-xs transition-all shadow-md cursor-pointer ${
                    selectedPoolStops.length > 0
                      ? 'bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-600 hover:to-pink-600 shadow-rose-500/10 active:scale-95'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed shadow-none'
                  }`}
                >
                  Zaman Çizelgesine Ekle
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* OVERDUE JOBS RESCHEDULE MODAL */}
      {isOverdueModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 flex-shrink-0">
              <div>
                <h3 className="font-extrabold text-sm text-slate-950 dark:text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-500" />
                  Zamanı Geçen İşler
                  <span className="bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-[10px] px-2.5 py-0.5 rounded-full font-bold border border-rose-200 dark:border-rose-900/30">
                    {overdueStops.length} İş
                  </span>
                </h3>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Tarihi veya planlanan saati geçmiş olan fakat yapıldı olarak işaretlenmemiş işler.
                </p>
              </div>
              <button
                onClick={() => setIsOverdueModalOpen(false)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal List Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5 min-h-0 bg-slate-50/50 dark:bg-slate-950/20">
              {overdueStops.length === 0 ? (
                <div className="py-16 text-center">
                  <Check className="w-10 h-10 text-emerald-500 mx-auto mb-2.5 animate-bounce" />
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-400">Zamanı Geçen İş Bulunmuyor</p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                    Tüm planlanan işler zamanında gerçekleştirilmiş. Tebrikler!
                  </p>
                </div>
              ) : (
                overdueStops.map((stop) => {
                  const dateStr = stop.routeDate || (stop.plannedAt ? stop.plannedAt.substring(0, 10) : '')
                  const formattedDate = dateStr ? dateStr.split('-').reverse().join('.') : 'Belirtilmemiş'
                  const currentRescheduleDate = rescheduleDates[stop.id] || ''

                  return (
                    <div
                      key={stop.id}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-sm hover:border-slate-300 dark:hover:border-slate-700 transition-all"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 font-mono">{stop.serviceNumber}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${stop.type === 'Installation' ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' : 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'}`}>{trType(stop.typeLabel)}</span>
                          <span className="text-[9px] text-amber-600 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/50 rounded-full px-2 py-0.5 font-semibold">
                            {stop.assignedTechnicianName || 'Atanmamış'}
                          </span>
                        </div>
                        <h4 className="font-bold text-xs text-slate-900 dark:text-white truncate">{stop.customerName || 'Müşteri Belirtilmedi'}</h4>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{stop.productName}</p>
                        <div className="flex items-center gap-3 mt-1.5 text-[9px] text-slate-500 dark:text-slate-400 font-medium">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-rose-500/85" />
                            Eski Tarih: <span className="font-bold text-rose-500">{formattedDate}</span>
                          </span>
                          {stop.plannedStartTime && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-slate-400" />
                              {stop.plannedStartTime} - {stop.plannedEndTime || ''}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 sm:self-center">
                        <input
                          type="date"
                          value={currentRescheduleDate}
                          onChange={(e) => setRescheduleDates(prev => ({ ...prev, [stop.id]: e.target.value }))}
                          className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-rose-500/20 w-32 dark:text-white"
                        />
                        <button
                          disabled={!currentRescheduleDate || rescheduleLoadingId === stop.id}
                          onClick={async () => {
                            setRescheduleLoadingId(stop.id)
                            try {
                              await apiJson(`/api/servicerecords/${stop.id}/route-plan`, {
                                method: 'PATCH',
                                body: JSON.stringify({
                                  routeDate: currentRescheduleDate,
                                  plannedStartTime: null,
                                  plannedEndTime: null,
                                  routeOrder: null
                                })
                              })
                              await refetchServices()
                              setRescheduleDates(prev => {
                                const copy = { ...prev }
                                delete copy[stop.id]
                                return copy
                              })
                            } catch (err: any) {
                              toast.error(err.message || 'Tarih güncellenemedi.')
                            } finally {
                              setRescheduleLoadingId(null)
                            }
                          }}
                          className="px-3 py-1.5 bg-rose-500 hover:bg-rose-600 text-white rounded-lg text-xs font-bold transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {rescheduleLoadingId === stop.id ? '...' : 'Güncelle'}
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-800 flex justify-end flex-shrink-0">
              <button
                onClick={() => setIsOverdueModalOpen(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TIMELINE SORT MODAL */}
      {isSortModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 flex-shrink-0">
              <div>
                <h3 className="font-extrabold text-sm text-slate-950 dark:text-white flex items-center gap-2">
                  Günlük Zaman Çizelgesini Sırala
                  <span className="bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-[10px] px-2.5 py-0.5 rounded-full font-bold border border-rose-200 dark:border-rose-900/30">
                    {selectedTechStops.length} Görev
                  </span>
                </h3>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {technicians.find(t => t.id === selectedTechId)?.fullName || 'Teknisyen'} - {selectedDate.split('-').reverse().join('.')}
                </p>
              </div>
              <button
                onClick={() => setIsSortModalOpen(false)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal List Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0 bg-slate-50/50 dark:bg-slate-950/20">
              {selectedTechStops.length === 0 ? (
                <div className="py-16 text-center">
                  <Info className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto mb-2.5" />
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-400">Atanmış Görev Bulunmamaktadır</p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                    Bu teknisyene henüz bir görev atanmamış.
                  </p>
                </div>
              ) : (
                <div className="relative border-l-2 border-slate-200 dark:border-slate-800 ml-4 space-y-4 pt-2">
                  {selectedTechStops.map((stop, idx) => {
                    const hasTime = !!(stop.plannedStartTime || stop.plannedEndTime)

                    const isTimePassed = (() => {
                      if (stop.status === 'Ready' || stop.status === 'Delivered' || stop.status === 'Cancelled') {
                        return false
                      }
                      const now = new Date()
                      const offset = now.getTimezoneOffset()
                      const localNow = new Date(now.getTime() - (offset * 60 * 1000))
                      const todayStr = localNow.toISOString().split('T')[0]
                      const stopDate = stop.routeDate || (stop.plannedAt ? stop.plannedAt.substring(0, 10) : '')

                      if (!stopDate) return false
                      if (stopDate < todayStr) return true
                      if (stopDate === todayStr && stop.plannedEndTime) {
                        const [h, m] = stop.plannedEndTime.split(':').map(Number)
                        if (!isNaN(h)) {
                          const stopTimeMins = h * 60 + (m || 0)
                          const nowMins = now.getHours() * 60 + now.getMinutes()
                          return nowMins > stopTimeMins
                        }
                      }
                      return false
                    })()

                    const isCompleted = stop.status === 'Ready' || stop.status === 'Delivered'
                    const isStruckThrough = isCompleted || isTimePassed

                    return (
                      <div
                        key={stop.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('stopIndex', String(idx))
                          setDraggedStopIndex(idx)
                        }}
                        onDragEnd={() => {
                          setDraggedStopIndex(null)
                          setDragOverStopIndex(null)
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDragEnter={() => {
                          if (draggedStopIndex !== null && draggedStopIndex !== idx) {
                            setDragOverStopIndex(idx)
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOverStopIndex === idx) {
                            setDragOverStopIndex(null)
                          }
                        }}
                        onDrop={(e) => {
                          e.stopPropagation()
                          const dragIdx = parseInt(e.dataTransfer.getData('stopIndex'))
                          if (!isNaN(dragIdx)) {
                            handleReorderStopsOfficial(dragIdx, idx)
                          }
                          setDraggedStopIndex(null)
                          setDragOverStopIndex(null)
                        }}
                        className="relative pl-8 transition-all"
                        style={getDragStyle(idx, 16)}
                      >
                        {/* Dot indicator */}
                        <div className="absolute -left-[9px] top-4 w-4 h-4 rounded-full border-2 bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 flex items-center justify-center">
                          <span className="text-[8px] font-bold text-slate-500 dark:text-slate-400 font-mono">{idx + 1}</span>
                        </div>

                        {/* Drag Card */}
                        <div className={`relative overflow-hidden bg-white dark:bg-slate-900 border rounded-xl p-3.5 flex gap-3 cursor-grab active:cursor-grabbing transition-all ${
                          draggedStopIndex === idx
                            ? 'border-rose-500 dark:border-rose-500 ring-2 ring-rose-500/30 shadow-lg shadow-rose-500/20 animate-custom-shake z-50'
                            : dragOverStopIndex === idx
                            ? 'border-yellow-500 dark:border-yellow-500 ring-2 ring-yellow-500/40 shadow-md shadow-yellow-500/10'
                            : closestUpcomingStopId === stop.id
                            ? 'border-rose-500 dark:border-rose-500/80 ring-2 ring-rose-500/20 shadow-md shadow-rose-500/10'
                            : 'border-slate-200 dark:border-slate-800 hover:border-yellow-500 dark:hover:border-yellow-500 hover:ring-2 hover:ring-yellow-500/20'
                        }`}>
                          {isTimePassed ? (
                            <div className="absolute top-0 right-0 bg-slate-900 dark:bg-slate-950 text-white text-[7.5px] font-extrabold px-2 py-0.5 rounded-bl-lg uppercase tracking-wider z-10 shadow-sm border-l border-b border-slate-700">
                              Zamanı Geçti
                            </div>
                          ) : (
                            closestUpcomingStopId === stop.id && (
                              <div className="absolute top-0 right-0 bg-red-500 text-white text-[7.5px] font-extrabold px-2 py-0.5 rounded-bl-lg animate-pulse uppercase tracking-wider z-10">
                                Zamanı Yaklaşıyor
                              </div>
                            )
                          )}
                          {/* Reorder handles */}
                          <div className="flex flex-col items-center justify-center flex-shrink-0 pr-1">
                            <GripVertical className="w-4.5 h-4.5 text-slate-400 dark:text-slate-650" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start">
                              <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 font-mono">{stop.serviceNumber}</span>
                              <div className="flex items-center gap-1">
                                {getStatusBadge(stop.status)}
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${stop.type === 'Installation' ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400' : 'bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'}`}>{trType(stop.typeLabel)}</span>
                              </div>
                            </div>

                            <h4 className={`font-bold text-xs truncate mt-1 ${
                              isStruckThrough
                                ? 'text-slate-400 dark:text-slate-500 line-through opacity-70'
                                : 'text-slate-900 dark:text-white'
                            }`}>
                              {stop.customerName || 'Müşteri Belirtilmemiş'}
                            </h4>
                            <p className={`text-[10px] truncate mt-0.5 ${
                              isStruckThrough
                                ? 'text-slate-400/80 dark:text-slate-500/80 line-through opacity-60'
                                : 'text-slate-505 dark:text-slate-400'
                            }`}>
                              {stop.productName}
                            </p>
                            <p className={`text-[9px] truncate mt-0.5 ${
                              isStruckThrough
                                ? 'text-slate-400/80 dark:text-slate-500/80 line-through opacity-60'
                                : 'text-slate-450 dark:text-slate-500'
                            }`}>
                              &#128205; {stop.customerAddress}
                            </p>
                            <div className="flex items-center gap-1 mt-1 text-[9px] text-slate-500 dark:text-slate-400 font-medium">
                              <Calendar className="w-3.5 h-3.5 text-rose-500/85" />
                              <span>{stop.routeDate ? stop.routeDate.split('-').reverse().join('.') : (stop.plannedAt ? stop.plannedAt.substring(0, 10).split('-').reverse().join('.') : 'Tarih Belirtilmemiş')}</span>
                            </div>

                            {hasTime && (
                              <div className="mt-2 flex items-center gap-1 text-[9px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/40 rounded-full px-2 py-0.5 w-max font-mono">
                                &#9200; {stop.plannedStartTime}{stop.plannedEndTime ? ` - ${stop.plannedEndTime}` : ''}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end bg-slate-50 dark:bg-slate-900/50 flex-shrink-0">
              <button
                onClick={() => setIsSortModalOpen(false)}
                className="px-4 py-2 bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-800 hover:to-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer active:scale-95"
              >
                Tamamlandı
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SHAKE STYLE INLINE */}
      <style>{`
        @keyframes custom-shake {
          0% { transform: translate(1px, 1px) rotate(0deg); }
          10% { transform: translate(-1px, -2px) rotate(-1deg); }
          20% { transform: translate(-2px, 0px) rotate(1deg); }
          30% { transform: translate(0px, 1.5px) rotate(0deg); }
          40% { transform: translate(1px, -1px) rotate(1deg); }
          50% { transform: translate(-1px, 1.5px) rotate(-1deg); }
          60% { transform: translate(-2px, 1px) rotate(0deg); }
          70% { transform: translate(1.5px, 1px) rotate(-1deg); }
          80% { transform: translate(-1px, -1px) rotate(1deg); }
          90% { transform: translate(1.5px, 1.5px) rotate(0deg); }
          100% { transform: translate(1px, -1.5px) rotate(-1deg); }
        }
        .animate-custom-shake {
          animation: custom-shake 0.3s infinite;
        }
        @keyframes marker-pulse {
          0%, 100% {
            transform: scale(1);
            filter: drop-shadow(0 0 5px rgba(244, 63, 94, 0.6));
          }
          50% {
            transform: scale(1.3);
            filter: drop-shadow(0 0 20px rgba(244, 63, 94, 0.95));
          }
        }
        .animate-marker-pulse {
          animation: marker-pulse 1.2s infinite ease-in-out;
        }
        @keyframes marker-pulse-gray {
          0%, 100% {
            transform: scale(1);
            filter: drop-shadow(0 0 3px rgba(148, 163, 184, 0.5));
          }
          50% {
            transform: scale(1.3);
            filter: drop-shadow(0 0 12px rgba(148, 163, 184, 0.9));
          }
        }
        .animate-marker-pulse-gray {
          animation: marker-pulse-gray 1.2s infinite ease-in-out;
        }
        @keyframes marker-pulse-green {
          0%, 100% {
            transform: scale(1);
            filter: drop-shadow(0 0 5px rgba(16, 185, 129, 0.6));
          }
          50% {
            transform: scale(1.3);
            filter: drop-shadow(0 0 20px rgba(16, 185, 129, 0.95));
          }
        }
        .animate-marker-pulse-green {
          animation: marker-pulse-green 1.2s infinite ease-in-out;
        }
      `}</style>
    </div>
  )
}
