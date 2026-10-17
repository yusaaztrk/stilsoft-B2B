import { useEffect, useMemo, useState, useCallback, Fragment } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Calendar, MapPin, User, CheckCircle, Info, X, Clock, AlertTriangle, Edit2, MessageSquare, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { apiJson } from '../api/client'
import { printServiceSlip } from '../print/serviceSlip'
import { groupTimelineEvents } from '../utils/timelineHelper'
import { toTurkishUpper } from '../utils/formInput'
import TimelineEvent from '../components/TimelineEvent'
import { useTechnicians } from '../hooks/useTechnicians'
import { useServiceRecordsPaged } from '../hooks/useServiceRecords'
import Table, { type TableColumn } from '../components/Table'
import ActionDropdown from '../components/ActionDropdown'
import FisNoModal from '../components/FisNoModal'
import { smartAssign, type SmartAssignResponse } from '../api/serviceRecords'
import { fetchErpProducts, type ErpProductDto } from '../api/erp'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

function FitMapBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points && points.length > 0) {
      const bounds = L.latLngBounds(points)
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 })
    }
  }, [points, map])
  return null
}

// Fix for default marker icons in Leaflet with bundlers
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'
import { API_BASE_URL } from '../config'
import { toast } from 'sonner'
import PhoneLinks from '../components/PhoneLinks'

L.Icon.Default.mergeOptions({
  iconRetinaUrl,
  iconUrl,
  shadowUrl,
})

interface ServiceRecordDetail {
  id: string
  serviceNumber: string
  /** Kağıt fiş numarası — elle girilir, sistem numarasından (AT-/SH-) ayrıdır. */
  manualReceiptNo?: string | null
  status: string
  statusLabel: string
  typeLabel: string
  customerName?: string
  customerPhone?: string
  customerAddress?: string
  productName: string
  serialNumber?: string
  regionName?: string
  regionId?: string
  assignedTechnicianName?: string
  assignedTechnicianId?: string
  estimatedDeliveryDate?: string
  priorityLabel?: string
  problemDescription?: string
  lastAction?: string
  notes?: Array<{ id: string; content: string; authorName: string; createdAt: string }>
  dealerName?: string
  dealerPhone?: string
  plannedAt?: string
  createdAt?: string
  /** Servis fişi basıldı mı — basılmadan satırlar sahaya aktarılamaz. */
  isPrinted?: boolean
  /** Montaj kalemleri — planlama bunların üzerinden yapılır. */
  items?: ServiceRecordItemDetail[]
  /** Kalemlerin miktar toplamı; eski "Miktar: N" metninin yerini alır. */
  totalQuantity?: number
}

interface ServiceRecordItemDetail {
  id: string
  productName: string
  productStockCode?: string | null
  serialNumber?: string | null
  quantity: number
  notes?: string | null
  sortOrder: number
}


type PlanningKind = 'repair' | 'installation' | 'cargo'

interface PlanlamaPageProps {
  planningKind?: PlanningKind
  categoryFilter?: 'large' | 'small'
}

type TechnicianWorkload = {
  count: number
  records: ServiceRecordDetail[]
}

const priorityConfig: Record<string, { label: string; color: string }> = {
  Low: { label: 'Düşük', color: 'bg-gray-100 text-gray-700' },
  Normal: { label: 'Normal', color: 'bg-gray-100 text-gray-700' },
  High: { label: 'Acil', color: 'bg-orange-100 text-orange-700' },
  Critical: { label: 'Kritik', color: 'bg-red-100 text-red-700' },
}

const statusMap: Record<number, { label: string; color: string }> = {
  0: { label: 'Siparişiniz Alındı', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  1: { label: 'Planlandı', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
  2: { label: 'Hazırlanıyor', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  3: { label: 'Dağıtımda', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  4: { label: 'Teslim Edildi', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
}

export default function PlanlamaPage({ planningKind = 'repair', categoryFilter }: PlanlamaPageProps) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const recordIdFromUrl = searchParams.get('id')
  const isInstallationPlanning = planningKind === 'installation'
  const isCargoPlanning = planningKind === 'cargo'

  // If we have a specific record ID, show detail mode; else show list mode
  const [mode, setMode] = useState<'list' | 'detail'>(recordIdFromUrl ? 'detail' : 'list')
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(recordIdFromUrl)

  // List mode state
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 200
  const [filteredRows, setFilteredRows] = useState<any[]>([])

  // Fetch New (unplanned) + Planned (partially planned, awaiting Sahaya Aktar) records
  // Kagit fis no modali: hangi kayit icin acik oldugu. null = kapali.
  const [fisNoFor, setFisNoFor] = useState<any | null>(null)

  /*
    PASİFE ALINANLAR (2026-08-23, kullanıcı isteği).

    90 günden eski kayıtlar varsayılan listede yok; süzgeç SUNUCUDA (`includePassive`).
    Üst çubuktaki kutu `window` olayıyla haber veriyor — kabul ekranlarıyla aynı yol,
    aynı bayrak: bir ekranda açılınca diğerinde de açık kalır.
  */
  const [showPassive, setShowPassive] = useState(() => {
    return (window as any).__showPassive !== undefined ? !!(window as any).__showPassive : false
  })

  useEffect(() => {
    const onPassiveChanged = (e: any) => {
      setShowPassive(!!e.detail)
      setPage(1)
    }
    window.addEventListener('shell:show-passive-changed', onPassiveChanged)
    return () => window.removeEventListener('shell:show-passive-changed', onPassiveChanged)
  }, [])

  const { result: serviceRecordsResult, isLoading: serviceRecordsLoading, error: serviceRecordsError, refetch: refetchServiceRecords } = useServiceRecordsPaged({
    q: q || undefined,
    statuses: 'New,Planned',
    type: isInstallationPlanning ? 'Installation' : 'Repair',
    includePassive: showPassive,
    page,
    pageSize: 1000,
  })

  // Cargo specific states
  const [cargoTasks, setCargoTasks] = useState<any[]>([])
  const [cargoLoading, setCargoLoading] = useState(false)

  const fetchCargoTasks = useCallback(async () => {
    if (!isCargoPlanning) return
    setCargoLoading(true)
    try {
      const data = await apiJson<any[]>('/api/cargotracking')
      setCargoTasks(data || [])
    } catch (err: any) {
      console.error(err)
    } finally {
      setCargoLoading(false)
    }
  }, [isCargoPlanning])

  useEffect(() => {
    if (isCargoPlanning) {
      fetchCargoTasks()
    }
  }, [isCargoPlanning, fetchCargoTasks])

  const result = useMemo(() => {
    if (isCargoPlanning) {
      const unplannedCargo = cargoTasks.filter(t => {
        if (t.status !== 0 && t.status !== 1) return false
        if (!q.trim()) return true
        const searchVal = q.toLowerCase()
        return (
          t.orderNumber?.toLowerCase().includes(searchVal) ||
          t.customerName?.toLowerCase().includes(searchVal) ||
          t.productDetails?.toLowerCase().includes(searchVal)
        )
      })
      return {
        items: unplannedCargo.map(t => ({
          id: t.id,
          serviceNumber: t.orderNumber,
          customerName: t.customerName,
          customerPhone: '',
          productName: t.productDetails || 'E-Ticaret Siparişi',
          customerAddress: t.deliveryAddress,
          regionName: 'Kargo Bölgesi',
          regionId: null,
          priorityLabel: 'Normal',
          status: t.status === 0 ? 'New' : 'Planned',
          plannedDate: t.plannedDate,
          assignedTechnicianName: t.assignedTechnicianName,
          assignedTechnicianId: t.assignedTechnicianId
        })),
        totalCount: unplannedCargo.length
      }
    }
    return serviceRecordsResult || { items: [], totalCount: 0 }
  }, [isCargoPlanning, cargoTasks, serviceRecordsResult, q])

  const listLoading = isCargoPlanning ? cargoLoading : serviceRecordsLoading
  const refetch = isCargoPlanning ? fetchCargoTasks : refetchServiceRecords

  // Selected region filter
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)

  // Detail mode state
  const [record, setRecord] = useState<ServiceRecordDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const isInstallation = record?.typeLabel === 'Installation' || record?.typeLabel === 'Montaj'

  // Inline editing state for planning tasks
  // Kısmi aktarım: planlanmış satırlardan seçilenler sahaya gider, kalanlar kayıtta durur.
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [transferLoading, setTransferLoading] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferSuccess, setTransferSuccess] = useState<string | null>(null)

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editTechId, setEditTechId] = useState<string>('')
  const [editDate, setEditDate] = useState<string>('')
  const [editAddress, setEditAddress] = useState<string>('')
  const [editNote, setEditNote] = useState<string>('')
  const [editLoading, setEditLoading] = useState<boolean>(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [plannedDate, setPlannedDate] = useState<string>('')
  const [selectedTechId, setSelectedTechId] = useState<string>('')
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [planSuccess, setPlanSuccess] = useState<string | null>(null)

  // Record details edit states
  const [isEditingRecord, setIsEditingRecord] = useState(false)
  const [editCustName, setEditCustName] = useState('')
  const [editCustPhone, setEditCustPhone] = useState('')
  const [editCustAddress, setEditCustAddress] = useState('')
  const [editProdName, setEditProdName] = useState('')
  const [editSerialNo, setEditSerialNo] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editSavingRecord, setEditSavingRecord] = useState(false)

  // Plan editing and Service Notes states
  const [isEditingPlan, setIsEditingPlan] = useState(false)
  const [newNoteContent, setNewNoteContent] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  const mapType = (typeLabel: string | undefined): number => {
    if (!typeLabel) return 0
    const l = typeLabel.toLowerCase()
    if (l.includes('montaj') || l.includes('install')) return 1
    if (l.includes('bakım') || l.includes('mainten')) return 2
    if (l.includes('garanti') || l.includes('warrant')) return 3
    return 0 // Repair / Onarım
  }

  const mapPriority = (priorityLabel: string | undefined): number => {
    if (!priorityLabel) return 1
    const l = priorityLabel.toLowerCase()
    if (l.includes('düşük') || l.includes('low')) return 0
    if (l.includes('acil') || l.includes('high')) return 2
    if (l.includes('kritik') || l.includes('critic')) return 3
    return 1 // Normal
  }

  const handleSaveRecordDetails = async () => {
    if (!record) return
    setEditSavingRecord(true)
    try {
      if (isCargoPlanning) {
        await apiJson(`/api/cargotracking/${record.id}/details`, {
          method: 'PUT',
          body: JSON.stringify({
            customerName: editCustName,
            deliveryAddress: editCustAddress,
            productDetails: editProdName,
          })
        })
      } else {
        const payload = {
          type: mapType(record.typeLabel),
          customerName: editCustName,
          customerPhone: editCustPhone,
          customerAddress: editCustAddress,
          productName: editProdName,
          serialNumber: editSerialNo,
          problemDescription: editDesc,
          priority: mapPriority(record.priorityLabel),
          regionId: record.regionId,
          plannedDate: record.estimatedDeliveryDate ? new Date(record.estimatedDeliveryDate).toISOString() : null,
        }

        await apiJson(`/api/servicerecords/${record.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        })
      }

      setRecord(prev => prev ? {
        ...prev,
        customerName: editCustName,
        customerPhone: editCustPhone,
        customerAddress: editCustAddress,
        productName: editProdName,
        serialNumber: editSerialNo,
        problemDescription: editDesc
      } : null)
      
      setIsEditingRecord(false)
      toast.success('Kayıt bilgileri başarıyla güncellendi.')
      refetch()
    } catch (e: any) {
      toast.error('Hata: ' + (e?.message || 'Bilgiler kaydedilemedi.'))
    } finally {
      setEditSavingRecord(false)
    }
  }

  const [, setExistingPlannedCount] = useState<number>(0)

  // Row-by-row planning state (same as MontajYonetimiPage modal)
  const [planTasks, setPlanTasks] = useState<any[]>([])
  const [planTasksLoading, setPlanTasksLoading] = useState(false)
  const [planRowDate, setPlanRowDate] = useState<string>('')
  const [planRowTechId, setPlanRowTechId] = useState<string>('')
  const [planRowQty, setPlanRowQty] = useState<number>(1)
  const [planRowItemId, setPlanRowItemId] = useState<string>('')
  const [planRowNote, setPlanRowNote] = useState<string>('')
  const [planRowAddress, setPlanRowAddress] = useState<string>('')
  const [planRowLoading, setPlanRowLoading] = useState(false)
  const [planRowError, setPlanRowError] = useState<string | null>(null)
  const [planRowSuccess, setPlanRowSuccess] = useState<string | null>(null)

  const [workloadDate, setWorkloadDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [workloads, setWorkloads] = useState<Record<string, TechnicianWorkload>>({})
  const [workloadsLoading, setWorkloadsLoading] = useState(false)
  const [workloadsError, setWorkloadsError] = useState<string | null>(null)

  // Info popup
  const [infoPopupId, setInfoPopupId] = useState<string | null>(null)
  const [infoData, setInfoData] = useState<ServiceRecordDetail | null>(null)
  const [infoLoading, setInfoLoading] = useState(false)
  const [infoTimeline, setInfoTimeline] = useState<any[]>([])

  const { technicians, isLoading: techsLoading } = useTechnicians({
    availableOnly: true,
    role: isCargoPlanning ? 'Kargo' : (isInstallationPlanning ? 'Montaj' : 'Saha Arıza')
  })
  // We fetch all technicians for map visualization
  const { technicians: allTechnicians } = useTechnicians({
    role: isCargoPlanning ? 'Kargo' : (isInstallationPlanning ? 'Montaj' : 'Saha Arıza')
  })
  
  const [regions, setRegions] = useState<any[]>([])
  const [erpProducts, setErpProducts] = useState<ErpProductDto[]>([])
  const [erpLoading, setErpLoading] = useState(true)
  const [erpError, setErpError] = useState<string | null>(null)

  // Smart assign modal state (list mode)
  const [smartModalOpen, setSmartModalOpen] = useState(false)
  const [smartDate, setSmartDate] = useState('')
  const [smartLoading, setSmartLoading] = useState(false)
  const [smartError, setSmartError] = useState<string | null>(null)
  const [smartSuccess, setSmartSuccess] = useState<string | null>(null)
  const [smartPreview, setSmartPreview] = useState<SmartAssignResponse | null>(null)

  // Avoid strict unused local compilation errors
  if (false as boolean) {
    console.log(smartAssign, smartModalOpen, setSmartModalOpen, smartDate, setSmartDate, smartLoading, setSmartLoading, smartError, setSmartError, smartSuccess, setSmartSuccess, smartPreview, setSmartPreview)
  }

  useEffect(() => {
    const fetchRegions = async () => {
      try {
        const data = await apiJson<any[]>('/api/regions')
        setRegions(data || [])
      } catch (err) {
        console.error('Failed to fetch regions', err)
      }
    }
    fetchRegions()
  }, [])

  useEffect(() => {
    let mounted = true
    setErpLoading(true)
    fetchErpProducts()
      .then((data) => {
        if (!mounted) return
        setErpProducts(Array.isArray(data) ? data : [])
        setErpError(null)
      })
      .catch((e) => {
        if (!mounted) return
        setErpError(String(e?.message ?? 'ERP ürünleri yüklenemedi'))
        setErpProducts([])
      })
      .finally(() => {
        if (!mounted) return
        setErpLoading(false)
      })

    return () => { mounted = false }
  }, [])

  const colorPalette = useMemo(() => [
    'bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600', 'bg-pink-600', 'bg-cyan-600'
  ], [])

  const createTechnicianIcon = useCallback((initials: string, colorClass: string) => {
    return L.divIcon({
      className: 'custom-tech-marker',
      html: `<div class="w-10 h-10 rounded-full flex items-center justify-center shadow-lg border-2 border-white text-sm font-bold text-white ${colorClass}">${initials}</div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
      popupAnchor: [0, -20],
    })
  }, [])

  const mapTechData = useMemo(() => {
    const regionMap = new Map(regions.map(r => [(r.name || '').trim().toLowerCase(), { lat: r.centerLatitude, lng: r.centerLongitude }]))
    const regionIdMap = new Map(regions.map(r => [r.id, { name: r.name, lat: r.centerLatitude, lng: r.centerLongitude }]))
    const fallbackCenter = { lat: 35.1856, lng: 33.3823 }
    const coordinateUsage = new Map<string, number>()

    const isWithinCyprus = (la: number, ln: number) => {
      return la >= 34.0 && la <= 36.0 && ln >= 32.0 && ln <= 35.0
    }

    const techList = allTechnicians;

    return techList.map((tech, index) => {
      let lat = tech.currentLatitude != null ? Number(tech.currentLatitude) : null
      let lng = tech.currentLongitude != null ? Number(tech.currentLongitude) : null

      if (lat != null && lng != null && !isWithinCyprus(lat, lng)) {
        lat = null
        lng = null
      }

      // Check if technician is assigned to any service record
      if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
        const assignedJob: any = result.items.find(
          (r: any) => (r.assignedTechnicianId === tech.id || (r as any).technicianId === tech.id) &&
               r.status !== 'Completed' && r.status !== 'Cancelled'
        )
        if (assignedJob) {
          let jobLat = assignedJob.latitude != null ? Number(assignedJob.latitude) : null
          let jobLng = assignedJob.longitude != null ? Number(assignedJob.longitude) : null

          // If the job itself does not have direct geocoded coordinates, fallback to its region center
          if (jobLat == null || jobLng == null || isNaN(jobLat) || isNaN(jobLng)) {
            if (assignedJob.regionId && regionIdMap.has(assignedJob.regionId)) {
              const reg = regionIdMap.get(assignedJob.regionId)
              jobLat = reg?.lat != null ? Number(reg.lat) : null
              jobLng = reg?.lng != null ? Number(reg.lng) : null
            } else if (assignedJob.regionName && regionMap.has(assignedJob.regionName.trim().toLowerCase())) {
              const reg = regionMap.get(assignedJob.regionName.trim().toLowerCase())
              jobLat = reg?.lat != null ? Number(reg.lat) : null
              jobLng = reg?.lng != null ? Number(reg.lng) : null
            }
          }

          if (jobLat != null && jobLng != null && !isNaN(jobLat) && !isNaN(jobLng)) {
            lat = jobLat
            lng = jobLng
          }
        }
      }

      if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
        if (tech.primaryRegionId && regionIdMap.has(tech.primaryRegionId)) {
          const r = regionIdMap.get(tech.primaryRegionId)
          lat = r?.lat != null ? Number(r.lat) : null
          lng = r?.lng != null ? Number(r.lng) : null
        } else if (tech.regionName && regionMap.has(tech.regionName.trim().toLowerCase())) {
          const r = regionMap.get(tech.regionName.trim().toLowerCase())
          lat = r?.lat != null ? Number(r.lat) : null
          lng = r?.lng != null ? Number(r.lng) : null
        }
      }

      if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
        const angle = index * 0.9
        const radius = 0.08 + (index % 5) * 0.015
        lat = fallbackCenter.lat + Math.sin(angle) * radius
        lng = fallbackCenter.lng + Math.cos(angle) * radius
      }

      const key = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`
      const used = coordinateUsage.get(key) ?? 0
      coordinateUsage.set(key, used + 1)
      if (used > 0) {
        const angle = used * 1.7
        const radius = 0.012 * used
        lat = Number(lat) + Math.sin(angle) * radius
        lng = Number(lng) + Math.cos(angle) * radius
      }

      const isOnline = tech.isOnline
      const colorClass = isOnline ? colorPalette[index % colorPalette.length] : 'bg-gray-400 opacity-60'

      return {
        ...tech,
        mapLat: lat,
        mapLng: lng,
        colorClass
      }
    })
  }, [allTechnicians, regions, result.items, colorPalette])

  const installableNames = useMemo(() => {
    if (erpLoading || erpError || !Array.isArray(erpProducts) || erpProducts.length === 0) return new Set<string>()
    return new Set(erpProducts.filter(p => p.isInstallable).map(p => (p.name || '').trim().toLowerCase()).filter(Boolean))
  }, [erpProducts, erpLoading, erpError])

  const getRepairChannel = useCallback((productName: string) => {
    if (installableNames.size === 0) return null
    const isSaha = installableNames.has((productName || '').trim().toLowerCase())
    return isSaha ? 'Saha' : 'Atölye'
  }, [installableNames])

  // Group by Region and Product Quantities
  const regionSummary = useMemo(() => {
    const map = new Map<string, { total: number; products: Record<string, number>; regionId: string | null }>()
    for (const item of result.items) {
      const region = item.regionName || 'Bölge Yok'
      const existing = map.get(region) || { total: 0, products: {}, regionId: item.regionId ?? null }
      existing.total += 1
      const product = item.productName || 'Ürün'
      existing.products[product] = (existing.products[product] || 0) + 1
      if (!existing.regionId) existing.regionId = item.regionId ?? null
      map.set(region, existing)
    }
    
    return Array.from(map.entries()).map(([region, data]) => ({
      region,
      total: data.total,
      products: data.products,
      regionId: data.regionId,
    })).sort((a, b) => b.total - a.total)
  }, [result.items])

  const columns: TableColumn<any>[] = useMemo(() => {
    const list: TableColumn<any>[] = []
    
    if (!isInstallationPlanning) {
      list.push({
        key: 'productName' as any,
        label: 'Tür',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'Saha', value: 'saha' },
            { label: 'Atölye', value: 'atölye' }
          ]
        },
        render: (_v, row) => {
          const channel = getRepairChannel(row.productName)
          if (channel) {
            return (
              <span className={
                'px-2 py-0.5 rounded-full text-[10px] font-semibold ' +
                (channel === 'Saha' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-orange-100 text-orange-700 border border-orange-200')
              }>
                {channel}
              </span>
            )
          }
          return <span className="text-xs text-gray-400">-</span>
        }
      })
    }

    list.push(
      {
        key: 'serviceNumber' as any,
        primary: true,
        label: 'Servis No',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <span className="font-mono text-xs font-semibold text-gray-900">{row.serviceNumber}</span>
        )
      },
      {
        // KAGIT FIS NO: musterinin elindeki basili fisin numarasi; sistem numarasindan ayri.
        key: 'manualReceiptNo' as any,
        label: 'Kağıt Fiş No',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          row.manualReceiptNo
            ? <span className="font-mono text-xs font-semibold text-gray-700">{row.manualReceiptNo}</span>
            : <span className="text-[11px] text-gray-300">-</span>
        )
      },
      {
        key: 'elapsedDays' as any,
        label: 'Geçen Gün',
        sortable: true,
        searchable: false,
        render: (_v, row: any) => {
          const diffDays = row.elapsedDays || 0
          let bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-200'
          if (diffDays >= 15 && diffDays < 30) {
            bgClass = 'bg-amber-50 text-amber-700 border-amber-200'
          } else if (diffDays >= 30) {
            bgClass = 'bg-rose-50 text-rose-700 border-rose-200 font-bold animate-pulse'
          } else if (diffDays > 5 && diffDays < 15) {
            bgClass = 'bg-emerald-50/70 text-emerald-800 border-emerald-150'
          }
          return (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${bgClass}`}>
              {diffDays} Gün
            </span>
          )
        }
      },
      {
        key: 'customerName' as any,
        primary: true,
        label: 'Müşteri',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <div>
            <div className="font-medium text-gray-900 text-xs">{row.customerName || '-'}</div>
            <div className="text-[10px] text-gray-500">{row.customerPhone || ''}</div>
          </div>
        )
      },
      {
        key: 'productName' as any,
        label: 'Ürün',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <div>
            <div className="text-gray-900 text-xs flex items-center gap-1.5">
              <span>{row.productName}</span>
              {row._itemQuantity > 1 && (
                <span className="text-[10px] font-bold text-gray-600 bg-gray-100 border border-gray-200 rounded px-1 py-0.5">
                  {row._itemQuantity} adet
                </span>
              )}
            </div>
            {row.serialNumber && <div className="text-[10px] text-gray-500">{row.serialNumber}</div>}
          </div>
        )
      },
      {
        key: 'customerAddress' as any,
        label: 'Adres',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <div className="text-xs text-gray-650 max-w-[200px] truncate" title={row.customerAddress}>{row.customerAddress || '-'}</div>
        )
      },
      {
        key: 'regionName' as any,
        hideOnMobile: true,
        label: 'Bölge',
        searchable: true,
        filter: { type: 'text' },
        render: (_v, row) => (
          <span className="text-xs font-medium text-gray-700">{row.regionName || '-'}</span>
        )
      },
      {
        key: 'priorityLabel' as any,
        hideOnMobile: true,
        label: 'Öncelik',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'Normal', value: 'normal' },
            { label: 'Acil', value: 'high' }
          ]
        },
        render: (_v, row) => {
          const priority = priorityConfig[row.priorityLabel] || priorityConfig['Normal']
          return (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${priority.color}`}>{priority.label}</span>
          )
        }
      },
      {
        key: 'actions' as any,
        label: 'İşlem',
        searchable: false,
        render: (_v, row) => {
          const channel = !isInstallationPlanning ? getRepairChannel(row.productName) : null
          const dropdownItems: any[] = [
            {
              key: 'info',
              label: 'Geçmişi Gör',
              onClick: () => openInfo(row.id)
            }
          ]

          if (row.status === 'New') {
            dropdownItems.push({
              key: 'plan',
              label: 'Planla',
              onClick: () => openRecord(row.id)
            })
          } else {
            dropdownItems.push({
              key: 'editPlan',
              label: 'Planı Düzenle',
              onClick: () => openRecord(row.id)
            })
            dropdownItems.push({
              key: 'transfer',
              label: channel === 'Atölye' ? 'Atölyeye Aktar' : 'Sahaya Aktar',
              onClick: async () => {
                try {
                  const patchRes = await apiJson<any>(`/api/servicerecords/${row.id}/status`, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: 'Workshop', notes: `${channel === 'Atölye' ? 'Atölyeye aktarıldı.' : 'Sahaya aktarıldı.'}` })
                  })
                  
                  if (channel !== 'Atölye') {
                    const transferredRecordId = patchRes?.id || row.id
                    const detailData = await apiJson<any>(`/api/servicerecords/${transferredRecordId}`)
                    printServiceSlip(detailData)
                  }
                  
                  await refetchServiceRecords()
                } catch (err: any) {
                  toast.error('İşlem başarısız: ' + (err?.message || err))
                }
              }
            })
          }

          // Kagit fis no: hangi sekmede olursa olsun girilebilmeli — musteri elindeki
            // kagitla arayinca kaydin bulunmasi buna bagli.
            dropdownItems.push({
            key: 'fisNo',
            label: row.manualReceiptNo ? 'Fiş No Düzenle' : 'Fiş No Gir',
            onClick: () => setFisNoFor(row)
          })

          return (
            <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
              <ActionDropdown items={dropdownItems} buttonLabel="İşlem" />
            </div>
          )
        }
      }
    )

    return list
  }, [isInstallationPlanning, navigate, getRepairChannel, refetchServiceRecords])

  const filteredItems = useMemo(() => {
    let items = (result.items as any[]).map(item => {
      const startStr = item.createdAt
      if (!startStr) return { ...item, elapsedDays: 0 }
      const anyItem = item as any
      const isCompleted = 
        item.status === 'Completed' || 
        item.status === 'Delivered' || 
        item.status === 'Cancelled' || 
        anyItem.derivedState === 'Completed' || 
        anyItem.derivedState === 'CompletedWithCancellations' || 
        anyItem.derivedState === 'Cancelled' ||
        item.status === 'ready' ||
        item.status === 'delivered' ||
        item.status === 'cancelled'
      const endStr = isCompleted 
        ? (anyItem.completedAt || anyItem.CompletedAt || anyItem.updatedAt || anyItem.UpdatedAt) 
        : null
      const startDate = new Date(startStr)
      const endDate = endStr ? new Date(endStr) : new Date()
      const diffTime = endDate.getTime() - startDate.getTime()
      const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)))
      return { ...item, elapsedDays: diffDays }
    })

    if (selectedRegion) {
      items = items.filter(i => (i.regionName || 'Bölge Yok') === selectedRegion)
    }

    // Montaj planlamasında kayıt tek satır değil, kalem kalem düşer: her ürün satırı
    // kendi miktarıyla ayrı bir satır. Kalemi olmayan eski kayıtlar tek satır kalır.
    if (isInstallationPlanning) {
      items = items.flatMap((record: any) => {
        const recordItems = record.items ?? []
        if (recordItems.length === 0) return [{ ...record, _rowId: record.id }]
        return recordItems.map((item: any) => ({
          ...record,
          _rowId: `${record.id}::${item.id}`,
          _itemId: item.id,
          _itemQuantity: item.quantity,
          productName: item.productName,
          serialNumber: item.serialNumber || record.serialNumber,
        }))
      })
    }

    return items
  }, [result.items, selectedRegion, erpProducts, erpLoading, erpError, categoryFilter, isInstallationPlanning])

  // Load detail record
  useEffect(() => {
    if (mode !== 'detail' || !selectedRecordId) return
    setDetailLoading(true)
    setDetailError(null)
    void (async () => {
      try {
        if (isCargoPlanning) {
          const detailData = await apiJson<any>(`/api/cargotracking/${selectedRecordId}/details`)
          const t = detailData.cargo
          setRecord({
            id: t.id,
            serviceNumber: t.orderNumber,
            status: t.status === 0 ? 'New' : 'Planned',
            statusLabel: t.status === 0 ? 'Siparişiniz Alındı' : 'Planlandı',
            typeLabel: 'Kargo',
            customerName: t.customerName,
            customerPhone: detailData.order?.phone || '',
            customerAddress: t.deliveryAddress,
            productName: t.productDetails || 'E-Ticaret Siparişi',
            regionName: 'Kargo Bölgesi',
            assignedTechnicianName: t.assignedTechnicianName || undefined,
            assignedTechnicianId: t.assignedTechnicianId || undefined,
            estimatedDeliveryDate: t.plannedDate,
            priorityLabel: 'Normal',
            problemDescription: `Ürünler: ${t.productDetails}\nE-Ticaret Siparişi`,
          })
          setEditCustName(t.customerName || '')
          setEditCustPhone(detailData.order?.phone || '')
          setEditCustAddress(t.deliveryAddress || '')
          setEditProdName(t.productDetails || 'E-Ticaret Siparişi')
          setEditSerialNo('')
          setEditDesc(`Ürünler: ${t.productDetails}\nE-Ticaret Siparişi`)
          setPlanRowAddress(t.deliveryAddress || '')
          if (t.plannedDate) {
            const date = String(t.plannedDate).slice(0, 10)
            setPlannedDate(date)
            setWorkloadDate(date)
          } else {
            const today = new Date().toISOString().slice(0, 10)
            setPlannedDate(today)
            setWorkloadDate(today)
          }
          if (t.assignedTechnicianId) {
            setSelectedTechId(t.assignedTechnicianId)
          }
          setExistingPlannedCount(0)
          setPlanTasks([])
        } else {
          const data = await apiJson<ServiceRecordDetail>(`/api/servicerecords/${selectedRecordId}`)
          setRecord(data)
          const hasPlan = data.status === 'Planned' || !!data.plannedAt
          setIsEditingPlan(!hasPlan)
          setEditCustName(data.customerName || '')
          setEditCustPhone(data.customerPhone || '')
          setEditCustAddress(data.customerAddress || '')
          setEditProdName(data.productName || '')
          setEditSerialNo((data as any).serialNumber || '')
          setEditDesc(data.problemDescription || '')
          setPlanRowAddress(data.customerAddress || '')
          if (data.estimatedDeliveryDate) {
            const date = String(data.estimatedDeliveryDate).slice(0, 10)
            setPlannedDate(date)
            setWorkloadDate(date)
          } else {
            const today = new Date().toISOString().slice(0, 10)
            setPlannedDate(today)
            setWorkloadDate(today)
          }
          if (data.assignedTechnicianId) {
            setSelectedTechId(data.assignedTechnicianId)
          }
          // For Installation: fetch existing planned tasks to calculate remaining qty
          if (data.typeLabel === 'Installation' || data.typeLabel === 'Montaj') {
            setPlanTasksLoading(true)
            try {
              const tasks = await apiJson<any[]>(`/api/installations/tasks?serviceId=${selectedRecordId}`)
              const allTasks = Array.isArray(tasks) ? tasks : []
              setPlanTasks(allTasks)
              // status 4 = Deferred, 3 = Cancelled. Handle both PascalCase and camelCase.
              const planned = allTasks.filter((t: any) => {
                const s = t.status ?? t.Status
                return s !== 4 && s !== 3 && s !== 'Deferred' && s !== 'Cancelled'
              }).reduce((s, t) => s + (t.quantity || t.Quantity || 1), 0)
              setExistingPlannedCount(planned)
            } catch { setExistingPlannedCount(0); setPlanTasks([]) }
            finally { setPlanTasksLoading(false) }
          } else {
            setExistingPlannedCount(0)
            setPlanTasks([])
          }
        }
      } catch (e: any) {
        setDetailError(String(e?.message ?? 'Kayıt yüklenemedi'))
      } finally {
        setDetailLoading(false)
      }
    })()
  }, [mode, selectedRecordId, isCargoPlanning])

  useEffect(() => {
    if (mode !== 'detail') return
    const date = isInstallation ? (planRowDate || workloadDate) : (plannedDate || workloadDate)
    if (!date) return

    const ac = new AbortController()
    setWorkloadDate(date)
    setWorkloadsLoading(true)
    setWorkloadsError(null)

    void (async () => {
      try {
        if (isCargoPlanning) {
          const allTasks = await apiJson<any[]>('/api/cargotracking', { signal: ac.signal } as any)
          const map: Record<string, TechnicianWorkload> = {}
          const targetDateStr = new Date(date).toDateString()

          for (const task of allTasks) {
            if (!task.assignedTechnicianId || !task.plannedDate) continue
            const taskDateStr = new Date(task.plannedDate).toDateString()
            if (taskDateStr !== targetDateStr) continue
            if (selectedRecordId && task.id === selectedRecordId) continue
            if (!map[task.assignedTechnicianId]) {
              map[task.assignedTechnicianId] = { count: 0, records: [] }
            }
            map[task.assignedTechnicianId].count += 1
            map[task.assignedTechnicianId].records.push({
              id: task.id,
              serviceNumber: task.orderNumber,
              productName: task.productDetails || 'Kargo',
              customerName: task.customerName,
              statusLabel: statusMap[task.status]?.label || 'Bilinmiyor',
              typeLabel: 'Kargo',
            } as any)
          }
          setWorkloads(map)
        } else {
          const from = new Date(`${date}T00:00:00`)
          const to = new Date(from)
          to.setDate(to.getDate() + 1)
          const params = new URLSearchParams({
            plannedFrom: from.toISOString(),
            plannedTo: to.toISOString(),
          })
          const rows = await apiJson<ServiceRecordDetail[]>(`/api/servicerecords?${params}`, { signal: ac.signal } as any)
          const inactiveStatuses = new Set(['Delivered', 'Cancelled'])
          const map: Record<string, TechnicianWorkload> = {}

          for (const row of Array.isArray(rows) ? rows : []) {
            const techId = (row as any).assignedTechnicianId ?? (row as any).technicianId
            if (!techId || inactiveStatuses.has(String(row.status))) continue
            if (selectedRecordId && row.id === selectedRecordId) continue
            if (!map[techId]) map[techId] = { count: 0, records: [] }
            map[techId].count += 1
            map[techId].records.push(row)
          }

          setWorkloads(map)
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          setWorkloads({})
          setWorkloadsError(String(e?.message ?? 'İş dağılımı yüklenemedi'))
        }
      } finally {
        if (!ac.signal.aborted) setWorkloadsLoading(false)
      }
    })()

    return () => ac.abort()
  }, [mode, isInstallation, plannedDate, planRowDate, workloadDate, selectedRecordId, isCargoPlanning])

  const startEditing = (task: any) => {
    setEditingTaskId(task.id || task.Id)
    setEditTechId(task.assignedTechnicianId || task.AssignedTechnicianId || '')
    setEditDate(task.plannedAt ? String(task.plannedAt).slice(0, 10) : (task.PlannedAt ? String(task.PlannedAt).slice(0, 10) : ''))
    setEditAddress(task.customAddress || task.CustomAddress || '')
    setEditNote(task.notes || task.Notes || '')
    setEditError(null)
  }

  const cancelEditing = () => {
    setEditingTaskId(null)
    setEditError(null)
  }

  const saveEditing = async (taskId: string) => {
    if (!editTechId || !editDate) {
      setEditError('Teknisyen ve Tarih zorunludur.')
      return
    }
    setEditLoading(true)
    setEditError(null)
    try {
      await apiJson(`/api/installations/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({
          assignedTechnicianId: editTechId,
          plannedAt: new Date(editDate).toISOString(),
          customAddress: editAddress || undefined,
          notes: editNote || undefined
        })
      })
      
      const tasks = await apiJson<any[]>(`/api/installations/tasks?serviceId=${selectedRecordId}`)
      setPlanTasks(Array.isArray(tasks) ? tasks : [])
      setEditingTaskId(null)
      
      const allTasks = Array.isArray(tasks) ? tasks : []
      const planned = allTasks.filter((t: any) => {
        const s = t.status ?? t.Status
        return s !== 4 && s !== 3 && s !== 'Deferred' && s !== 'Cancelled'
      }).reduce((s, t) => s + (t.quantity || t.Quantity || 1), 0)
      setExistingPlannedCount(planned)
      
      await refetch()
    } catch (err: any) {
      setEditError(err?.message || 'Kaydetme işlemi başarısız.')
    } finally {
      setEditLoading(false)
    }
  }

  const updateTaskStatusDirect = async (task: any, newStatus: string) => {
    const taskId = task.id || task.Id
    if (!taskId) return

    setPlanTasksLoading(true)
    try {
      await apiJson(`/api/installations/tasks/${taskId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus, reason: `Durum ${newStatus === 'Deferred' ? 'Yeni Kayıt' : newStatus === 'Cancelled' ? 'İptal' : 'Planlandı'} olarak değiştirildi.` })
      })
      
      const tasks = await apiJson<any[]>(`/api/installations/tasks?serviceId=${selectedRecordId}`)
      setPlanTasks(Array.isArray(tasks) ? tasks : [])
      
      const allTasks = Array.isArray(tasks) ? tasks : []
      const planned = allTasks.filter((t: any) => {
        const s = t.status ?? t.Status
        return s !== 4 && s !== 3 && s !== 'Deferred' && s !== 'Cancelled'
      }).reduce((s, t) => s + (t.quantity || t.Quantity || 1), 0)
      setExistingPlannedCount(planned)
      
      await refetch()
    } catch (err: any) {
      toast.error('İşlem başarısız: ' + (err?.message || err))
    } finally {
      setPlanTasksLoading(false)
    }
  }

  /** Seçilen planlama satırlarını sahaya aktarır; seçilmeyenler kayıtta kalır. */
  const transferSelectedTasks = async () => {
    if (!selectedRecordId || selectedTaskIds.length === 0) return

    setTransferLoading(true)
    setTransferError(null)
    setTransferSuccess(null)
    try {
      await apiJson(`/api/servicerecords/${selectedRecordId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'Workshop',
          notes: 'Seçilen planlama satırları sahaya aktarıldı.',
          taskIds: selectedTaskIds,
        }),
      })
      setSelectedTaskIds([])
      setTransferSuccess('Seçilen satırlar sahaya aktarıldı.')

      const tasks = await apiJson<any[]>(`/api/installations/tasks?serviceId=${selectedRecordId}`)
      setPlanTasks(Array.isArray(tasks) ? tasks : [])
      await refetch()
    } catch (err: any) {
      setTransferError(String(err?.message ?? 'Aktarım başarısız'))
    } finally {
      setTransferLoading(false)
    }
  }

  const submitPlanRow = async () => {
    if (!planRowTechId || !planRowDate || planRowQty < 1 || !selectedRecordId) {
      setPlanRowError('Teknisyen, tarih ve miktar zorunludur.')
      return
    }

    const isDeferred = (t: any) => { const s = t.Status ?? t.status; return s === 4 || s === 'Deferred' }
    const isCancelled = (t: any) => { const s = t.Status ?? t.status; return s === 3 || s === 'Cancelled' }
    const totalQty = parsedTotalQty || planTasks.filter((t: any) => !isCancelled(t)).reduce((s: number, t: any) => s + (t.Quantity ?? t.quantity ?? 1), 0)
    const plannedQty = planTasks.filter((t: any) => !isDeferred(t) && !isCancelled(t)).reduce((s: number, t: any) => s + (t.Quantity ?? t.quantity ?? 1), 0)

    // Kalan adet kalem bazında kontrol edilir; kalemi olmayan eski kayıtlarda kayıt geneli.
    const targetItem = itemPlanState.find(i => i.id === planRowItemId && i.remaining > 0)
      ?? itemPlanState.find(i => i.remaining > 0)
      ?? null
    const currentRemaining = targetItem ? targetItem.remaining : Math.max(0, totalQty - plannedQty)

    if (planRowQty > currentRemaining) {
      setPlanRowError(
        targetItem
          ? `"${targetItem.productName}" kaleminde planlanabilecek adet ${currentRemaining}.`
          : `Miktar kalan sayıdan (${currentRemaining}) büyük olamaz.`
      )
      return
    }

    setPlanRowLoading(true)
    setPlanRowError(null)
    setPlanRowSuccess(null)
    try {
      const res = await apiJson<any>(`/api/installations/allocate`, {
        method: 'POST',
        body: JSON.stringify({
          plannedDateUtc: new Date(planRowDate).toISOString(),
          allocations: [{
            serviceId: selectedRecordId,
            serviceRecordItemId: targetItem?.id,
            technicianId: planRowTechId,
            quantity: planRowQty,
            notes: planRowNote || undefined,
            customAddress: planRowAddress || undefined,
            plannedDateUtc: new Date(planRowDate).toISOString(),
          }],
          totalQuantity: totalQty,
        })
      })
      const createdCount = res?.created ?? res?.acceptedCount ?? 0
      const rejections = res?.rejectedAllocations ?? []
      const rejReason = rejections[0]?.reason ?? ''
      if (createdCount === 0) {
        const msg = rejReason === 'SkillMissing' ? 'Teknisyenin montaj yetkisi yok.'
          : rejReason === 'RegionMismatch' ? 'Teknisyen farklı bölgede.'
          : rejReason === 'CapacityExceeded' ? 'Teknisyen kapasitesi dolu.'
          : rejReason === 'WorkingHours' ? 'Planlama saati çalışma saatleri dışında.'
          : `Planlama reddedildi (${rejReason || 'bilinmiyor'}). Lütfen farklı bir teknisyen veya tarih deneyin.`
        setPlanRowError(msg)
        setPlanRowLoading(false)
        return
      }
      setPlanRowSuccess(`${createdCount} adet ürün planlandı.`)
      setPlanRowTechId('')
      setPlanRowDate('')
      setPlanRowQty(1)
      setPlanRowNote('')
      setPlanRowAddress(record?.customerAddress || '')
      // Refresh tasks list
      setPlanTasksLoading(true)
      try {
        const tasks = await apiJson<any[]>(`/api/installations/tasks?serviceId=${selectedRecordId}`)
        const allTasks = Array.isArray(tasks) ? tasks : []
        setPlanTasks(allTasks)
        const planned = allTasks.filter((t: any) => {
          const s = t.status ?? t.Status
          return s !== 4 && s !== 3 && s !== 'Deferred' && s !== 'Cancelled'
        }).reduce((s, t) => s + (t.quantity || t.Quantity || 1), 0)
        setExistingPlannedCount(planned)
      } catch { setPlanTasks([]) }
      finally { setPlanTasksLoading(false) }
      await refetch()
    } catch (e: any) {
      setPlanRowError(String(e?.message ?? 'Planlama eklenemedi'))
    } finally {
      setPlanRowLoading(false)
    }
  }

  const eligibleTechnicians = useMemo(() => {
    return [...technicians].sort((a, b) => {
      const aRegion = record?.regionId && a.primaryRegionId === record.regionId ? 0 : 1
      const bRegion = record?.regionId && b.primaryRegionId === record.regionId ? 0 : 1
      if (aRegion !== bRegion) return aRegion - bRegion
      return (workloads[a.id]?.count ?? 0) - (workloads[b.id]?.count ?? 0)
    })
  }, [technicians, workloads, record?.regionId])

  // Toplam adet artık kalemlerden geliyor. Kalemi olmayan (migration öncesi) kayıtlar için
  // eski "Miktar: N" metni yedek olarak duruyor.
  const parsedTotalQty = useMemo(() => {
    const fromItems = (record?.items ?? []).reduce((s, i) => s + (Number(i.quantity) || 0), 0)
    if (fromItems > 0) return fromItems
    if (record?.totalQuantity) return Number(record.totalQuantity) || 0
    const m = String(record?.problemDescription || '').match(/Miktar\s*:\s*(\d+)/i)
    return m ? Math.max(0, Number(m[1]) || 0) : 0
  }, [record?.items, record?.totalQuantity, record?.problemDescription])

  /** Kalem bazında planlanan / kalan adet. */
  const itemPlanState = useMemo(() => {
    const items = record?.items ?? []
    return items.map((item) => {
      const own = planTasks.filter((t: any) => (t.serviceRecordItemId ?? t.ServiceRecordItemId) === item.id)
      const planned = own
        .filter((t: any) => {
          const s = t.Status ?? t.status
          return s !== 4 && s !== 3 && s !== 'Deferred' && s !== 'Cancelled'
        })
        .reduce((s: number, t: any) => s + (t.Quantity ?? t.quantity ?? 1), 0)
      return {
        id: item.id,
        productName: item.productName,
        quantity: Number(item.quantity) || 1,
        planned,
        remaining: Math.max(0, (Number(item.quantity) || 1) - planned),
      }
    })
  }, [record?.items, planTasks])

  const handlePlan = async () => {
    if (!selectedRecordId) return
    if (!plannedDate) { setPlanError('Planlama tarihi seçin'); return }

    // Repair/Cargo: single technician assignment
    if (!selectedTechId) { setPlanError('Teknisyen seçin'); return }
    setPlanning(true)
    setPlanError(null)
    setPlanSuccess(null)
    try {
      if (isCargoPlanning) {
        const tech = technicians.find(t => t.id === selectedTechId)
        const techName = tech ? `${tech.firstName} ${tech.lastName}` : ''
        await apiJson(`/api/cargotracking/${selectedRecordId}/assign`, {
          method: 'PUT',
          body: JSON.stringify({
            technicianId: selectedTechId,
            technicianName: techName,
            plannedDate: new Date(plannedDate).toISOString(),
          }),
        })
      } else {
        await apiJson(`/api/servicerecords/${selectedRecordId}/plan`, {
          method: 'PATCH',
          body: JSON.stringify({
            plannedDate: new Date(plannedDate).toISOString(),
            technicianId: selectedTechId,
          }),
        })
      }
      setPlanSuccess('Planlama tamamlandı.')
      setTimeout(() => {
        setPlanSuccess(null)
        if (recordIdFromUrl) {
          navigate(-1)
        } else {
          setMode('list')
          setSelectedRecordId(null)
          setRecord(null)
          setPlannedDate('')
          setSelectedTechId('')
          refetch()
        }
      }, 800)
    } catch (e: any) {
      setPlanError(String(e?.message ?? 'Planlama başarısız'))
    } finally {
      setPlanning(false)
    }
  }

  // Open record for planning
  const openRecord = (id: string) => {
    setSelectedRecordId(id)
    setMode('detail')
    setPlannedDate('')
    setSelectedTechId('')
    setPlanError(null)
    setPlanSuccess(null)
    setExistingPlannedCount(0)
  }

  // Info popup handler
  const openInfo = async (id: string) => {
    setInfoPopupId(id)
    setInfoLoading(true)
    setInfoTimeline([])
    try {
      if (isCargoPlanning) {
        const detailData = await apiJson<any>(`/api/cargotracking/${id}/details`)
        const t = detailData.cargo
        setInfoData({
          id: t.id,
          serviceNumber: t.orderNumber,
          status: t.status === 0 ? 'New' : 'Planned',
          statusLabel: t.status === 0 ? 'Siparişiniz Alındı' : 'Planlandı',
          typeLabel: 'Kargo',
          customerName: t.customerName,
          customerPhone: detailData.order?.phone || '',
          customerAddress: t.deliveryAddress,
          productName: t.productDetails || 'E-Ticaret Siparişi',
          regionName: 'Kargo Bölgesi',
          assignedTechnicianName: t.assignedTechnicianName || undefined,
          assignedTechnicianId: t.assignedTechnicianId || undefined,
          estimatedDeliveryDate: t.plannedDate,
          priorityLabel: 'Normal',
          problemDescription: `Ürünler: ${t.productDetails}\nE-Ticaret Siparişi`,
        })
        const history = t.historyJson ? JSON.parse(t.historyJson) : []
        setInfoTimeline(history.map((h: any) => ({
          id: h.timestamp,
          statusLabel: h.statusLabel,
          createdAt: h.timestamp,
          authorName: h.actor,
          content: h.detail || 'Durum Güncellendi'
        })))
      } else {
        const data = await apiJson<ServiceRecordDetail>(`/api/servicerecords/${id}`)
        setInfoData(data)
        // Fetch timeline
        try {
          const tl = await apiJson<any[]>(`/api/servicerecords/${id}/timeline`)
          setInfoTimeline(Array.isArray(tl) ? tl : [])
        } catch { setInfoTimeline([]) }
      }
    } catch {
      setInfoData(null)
    } finally {
      setInfoLoading(false)
    }
  }

  // ─── LIST MODE ───
  if (mode === 'list') {
    const pageTitle = isCargoPlanning 
      ? 'Kargo Sevkiyat Planlama' 
      : (isInstallationPlanning 
          ? 'Montaj Planlama' 
          : (categoryFilter === 'large' 
              ? 'Saha Ürün Arıza Planlama ve Atama' 
              : (categoryFilter === 'small' ? 'Atölye Ürün Arıza Planlama ve Atama' : 'Ürün Arıza Planlama')
            )
        )
    const pageDescription = isCargoPlanning
      ? 'E-ticaret kargo kayıtları için kurye/teknisyen atama ve tarih planlama yapın.'
      : (isInstallationPlanning
          ? 'Montaj kayıtları için teknisyen, tarih ve miktar planlama yapın.'
          : (categoryFilter === 'large'
              ? 'Saha arızaları için teknisyen atama ve tarih planlama yapın.'
              : (categoryFilter === 'small'
                  ? 'Atölye ürün arızaları için teknisyen atama ve tarih planlama yapın.'
                  : 'Saha ve atölye ürün arızaları için teknisyen atama ve tarih planlama yapın.'
                )
            )
        )
    return (
      <div className="p-4 lg:p-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-xl lg:text-2xl font-bold text-gray-900">{pageTitle}</h1>
            <p className="text-sm text-gray-500 mt-1">{pageDescription}</p>
          </div>

        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5 mb-6">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5 text-blue-600" />
              </div>
              <div className="min-w-0">
                <div className="text-2xl font-bold text-gray-900">{result.totalCount}</div>
                <div className="text-xs text-gray-500 truncate">Planlanmayı Bekleyen</div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                <User className="w-5 h-5 text-green-600" />
              </div>
              <div className="min-w-0">
                <div className="text-2xl font-bold text-gray-900">{technicians.length}</div>
                <div className="text-xs text-gray-500 truncate">Müsait Teknisyen</div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 col-span-1 sm:col-span-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                <MapPin className="w-5 h-5 text-amber-600" />
              </div>
              <div className="min-w-0">
                <div className="text-2xl font-bold text-gray-900">{regionSummary.length}</div>
                <div className="text-xs text-gray-500 truncate">Aktif Bölge (Planlama Bekleyen)</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Left Column: Regions and Quantities */}
          <div className="lg:col-span-1 bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col h-[360px] sm:h-[500px]">
            <div className="p-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Bölgelere Göre Bekleyenler</h3>
            </div>
            <div className="p-4 flex-1 overflow-y-auto space-y-3">
              {regionSummary.length === 0 && !listLoading && (
                <div className="text-sm text-gray-500 text-center py-4">Bekleyen kayıt yok.</div>
              )}
              {regionSummary.map(rs => (
                <div 
                  key={rs.region} 
                  onClick={() => {
                    const next = selectedRegion === rs.region ? null : rs.region
                    setSelectedRegion(next)
                  }}
                  className={`border rounded-lg p-3 cursor-pointer transition-colors ${selectedRegion === rs.region ? 'border-[#B91C1C] bg-red-50' : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'}`}
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-gray-900">{rs.region}</span>
                    <span className="bg-gray-900 text-white text-xs font-bold px-2 py-1 rounded-full">{rs.total}</span>
                  </div>
                  <div className="space-y-1 mt-2 border-t border-black/5 pt-2">
                    {Object.entries(rs.products).map(([prod, count]) => (
                      <div key={prod} className="flex justify-between text-xs text-gray-600">
                        <span className="truncate max-w-[180px]" title={prod}>{prod}</span>
                        <span className="font-semibold shrink-0 ml-2">x{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: Map with Technicians */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 shadow-sm h-[360px] sm:h-[500px] overflow-hidden relative z-0">
            {/* Teknisyenleri ve Bölgeleri Gösteren Harita */}
            <MapContainer center={[35.1856, 33.3823]} zoom={9} style={{ width: '100%', height: '100%' }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <FitMapBounds points={mapTechData.map(tech => [tech.mapLat!, tech.mapLng!] as [number, number]).filter(p => p[0] != null && p[1] != null && !isNaN(p[0]) && !isNaN(p[1]))} />
              {mapTechData.map(tech => (
                <Marker 
                  key={tech.id} 
                  position={[tech.mapLat!, tech.mapLng!]}
                  icon={createTechnicianIcon(tech.initials || '--', tech.colorClass)}
                >
                  <Popup>
                    <div className="text-sm">
                      <div className="font-bold">{tech.fullName}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        Durum: {tech.isOnline ? 'Çevrimiçi' : 'Çevrimdışı'} / {
                          tech.status === 'Available' ? 'Müsait' :
                          tech.status === 'OnField' ? 'Sahada' :
                          tech.status === 'OnBreak' ? 'Molada' :
                          tech.status === 'OffDuty' ? 'Mesai Dışı' :
                          'Diğer'
                        }
                      </div>
                      <div className="text-xs text-gray-500 mt-1">Bölge: {tech.regionName || '-'}</div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
            <div className="absolute top-4 right-4 bg-white/90 backdrop-blur p-2 rounded-lg shadow-sm border border-gray-200 z-[1000] text-xs">
              <div className="font-semibold mb-1">Teknisyen Konumları</div>
              <div className="text-gray-500">{mapTechData.length} teknisyen haritada</div>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            value={q}
            onChange={(e) => { setQ(toTurkishUpper(e.target.value)); setPage(1) }}
            placeholder="Müşteri, telefon, ürün, seri no ile ara..."
            className="px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm w-full max-w-md focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/20 focus:border-[#B91C1C]"
          />
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-visible relative">
          {serviceRecordsLoading ? (
            <div className="py-8 text-center text-sm text-gray-500">Yükleniyor...</div>
          ) : serviceRecordsError ? (
            <div className="py-8 text-center text-sm text-red-500">{serviceRecordsError}</div>
          ) : filteredItems.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">Planlanmayı bekleyen kayıt bulunamadı.</div>
          ) : (
            <Table
              columns={columns}
              data={filteredItems}
              showColumnFilters
              onFilteredDataChange={setFilteredRows}
              rowKey={(r) => r._rowId ?? r.id}
            />
          )}
          <div className="p-4 border-t border-gray-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-gray-500">
              Toplam {filteredItems.length} {isInstallationPlanning ? 'kalem' : 'kayıt'} (Seçili Bölge: {selectedRegion || 'Tümü'}, Filtrelenmiş: {filteredRows.length})
            </span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-40">&lt;</button>
              <span className="text-sm font-medium">{page}</span>
              <button disabled={page >= Math.ceil(filteredItems.length / pageSize) || filteredItems.length === 0} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-40">&gt;</button>
            </div>
          </div>
        </div>

        {/* Info Popup */}
        {infoPopupId && (
          <>
            <div className="fixed inset-0 bg-black/30 z-40" onClick={() => { setInfoPopupId(null); setInfoData(null) }} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
                <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                  <div className="text-lg font-bold text-gray-900">Kayıt Bilgisi</div>
                  <button onClick={() => { setInfoPopupId(null); setInfoData(null) }} className="p-1.5 hover:bg-gray-100 rounded-lg">
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
                <div className="p-5 overflow-y-auto">
                  {infoLoading ? (
                    <div className="text-sm text-gray-500">Yükleniyor...</div>
                  ) : !infoData ? (
                    <div className="text-sm text-red-500">Bilgi yüklenemedi.</div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                        <div>
                          <div className="text-xs text-gray-500">Servis No</div>
                          <div className="font-mono font-semibold">{infoData.serviceNumber}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Durum</div>
                          <div className="font-medium">{infoData.statusLabel}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Müşteri</div>
                          <div className="font-medium">{infoData.customerName || '-'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Telefon</div>
                          <div className="font-medium">{infoData.customerPhone || '-'}</div>
                        </div>
                        <div className="col-span-2">
                          <div className="text-xs text-gray-500">Adres</div>
                          <div className="font-medium">{infoData.customerAddress || '-'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Ürün</div>
                          <div className="font-medium">{infoData.productName}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Bölge</div>
                          <div className="font-medium">{infoData.regionName || '-'}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Teknisyen</div>
                          <div className="font-medium">{infoData.assignedTechnicianName || 'Atanmadı'}</div>
                        </div>
                      </div>

                      <div className="bg-gray-50 rounded-xl p-4">
                        <div className="text-xs font-semibold text-gray-500 mb-2">Açıklama</div>
                        {(() => {
                          const raw = String(infoData.problemDescription || '').trim()
                          if (!raw) return <div className="text-sm text-gray-500">-</div>
                          const normalized = raw
                            .replace(/\s*Bayi Açıklama\s*:/i, '\nBayi Açıklama:')
                            .replace(/\s*Miktar\s*:/i, 'Miktar:')
                            .replace(/\s*Not\s*:/i, '\nNot:')
                          const parts = normalized.split(/\r?\n/g).map(s => s.trim()).filter(Boolean)
                          if (parts.length <= 1) return <div className="text-sm text-gray-700 whitespace-pre-wrap break-words">{normalized}</div>
                          return (
                            <div className="space-y-1">
                              {parts.map((p, i) => (
                                <div key={i} className="text-sm text-gray-700 whitespace-pre-wrap break-words">{p}</div>
                              ))}
                            </div>
                          )
                        })()}
                      </div>

                      {/* Son İşlem */}
                      <div className="bg-gray-50 rounded-xl p-4">
                        <div className="text-xs font-semibold text-gray-500 mb-2">Son İşlem</div>
                        <div className="text-sm text-gray-700">{infoData.lastAction || 'Henüz işlem yapılmadı'}</div>
                      </div>

                      {/* Zaman Çizelgesi & Geçmiş */}
                      <div>
                        <div className="text-xs font-semibold text-gray-500 mb-2">Zaman Çizelgesi & Geçmiş</div>
                        {infoTimeline.length === 0 ? (
                          <div className="text-xs text-gray-400">Henüz geçmiş yok.</div>
                        ) : (
                          <div className="space-y-2 max-h-64 overflow-y-auto">
                            {groupTimelineEvents(infoTimeline).map((ev: any, idx: number) => (
                              <TimelineEvent key={idx} ev={ev} idx={idx} />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  // ─── DETAIL / PLANNING MODE ───
  if (detailLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-32 bg-gray-200 rounded" />
        </div>
      </div>
    )
  }

  if (detailError || !record) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{detailError || 'Kayıt bulunamadı'}</div>
        <button onClick={() => { if (recordIdFromUrl) { navigate(-1) } else { setMode('list'); setSelectedRecordId(null) } }} className="mt-4 flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" /> Listeye Dön
        </button>
      </div>
    )
  }

  const isDeferred = (t: any) => { const s = t.Status ?? t.status; return s === 4 || s === 'Deferred' }
  const isCancelled = (t: any) => { const s = t.Status ?? t.status; return s === 3 || s === 'Cancelled' }
  const totalQty = parsedTotalQty || planTasks.filter((t: any) => !isCancelled(t)).reduce((s: number, t: any) => s + (t.Quantity ?? t.quantity ?? 1), 0)
  const plannedQty = planTasks.filter((t: any) => !isDeferred(t) && !isCancelled(t)).reduce((s: number, t: any) => s + (t.Quantity ?? t.quantity ?? 1), 0)
  const remainingQuantity = Math.max(0, totalQty - plannedQty)
  const isComplete = remainingQuantity === 0 && plannedQty > 0
  // Planlama satırı hangi kaleme yazılacak: seçili kalem, yoksa kalanı olan ilk kalem.
  const activePlanItem = itemPlanState.find(i => i.id === planRowItemId && i.remaining > 0)
    ?? itemPlanState.find(i => i.remaining > 0)
    ?? null
  const planRowMaxQty = activePlanItem ? activePlanItem.remaining : remainingQuantity

  // Sahaya aktarılabilecek satırlar: planlanmış ya da devam eden olanlar.
  const transferableTaskIds: string[] = planTasks
    .filter((t: any) => {
      const s = t.status ?? t.Status
      return s === 0 || s === 1 || s === 'Planned' || s === 'InProgress'
    })
    .map((t: any) => t.id ?? t.Id)
    .filter(Boolean)
  const visiblePlanTaskRows = planTasks
    .flatMap((t: any) => {
      const qty = Math.max(1, Number(t.Quantity ?? t.quantity ?? 1) || 1)
      return Array.from({ length: qty }, (_, qtyIndex) => ({ ...t, _rowKey: `${t.Id ?? t.id ?? 'task'}-${qtyIndex}`, _displayQty: 1 }))
    })

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto space-y-6">
      {/* Back button */}
      <div className="flex items-center justify-between">
        <button onClick={() => { if (recordIdFromUrl) { navigate(-1) } else { setMode('list'); setSelectedRecordId(null); setRecord(null) } }} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors bg-white px-3.5 py-2 rounded-xl shadow-sm border border-gray-150 font-semibold hover:border-gray-300">
          <ArrowLeft className="w-4 h-4 text-gray-500" /> Planlama Listesine Dön
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT COLUMN: Record Details Card + Details + Timeline (1/3 width) */}
        <div className="space-y-6 lg:col-span-1">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-150 dark:border-slate-800 shadow-sm p-6 space-y-5">
            <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Servis Kaydı</span>
                <div className="text-xl font-black text-[#B91C1C] font-mono leading-none mt-1">{record.serviceNumber}</div>
              </div>
              <div className="flex items-center gap-2">
                {!isEditingRecord ? (
                  <button 
                    onClick={() => setIsEditingRecord(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 rounded-lg border border-slate-200 dark:border-slate-700 transition"
                  >
                    <Edit2 className="w-3 h-3" /> Düzenle
                  </button>
                ) : null}
                <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                  Planlama Bekliyor
                </span>
              </div>
            </div>

            {isEditingRecord ? (
              <div className="space-y-4 text-xs">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Müşteri Adı</label>
                  <input type="text" value={editCustName} onChange={e => setEditCustName(e.target.value)} className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/15" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Müşteri Telefon</label>
                  <input type="text" value={editCustPhone} onChange={e => setEditCustPhone(e.target.value)} className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/15" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Müşteri Adres</label>
                  <textarea rows={2} value={editCustAddress} onChange={e => setEditCustAddress(e.target.value)} className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/15 resize-none" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Ürün Adı</label>
                  <input type="text" value={editProdName} onChange={e => setEditProdName(e.target.value)} className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/15" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Seri No</label>
                  <input type="text" value={editSerialNo} onChange={e => setEditSerialNo(e.target.value)} className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/15" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Açıklama / Arıza Tanımı</label>
                  <textarea rows={3} value={editDesc} onChange={e => setEditDesc(e.target.value)} className="px-3 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/15 resize-none" />
                </div>
                <div className="flex gap-2 pt-2">
                  <button disabled={editSavingRecord} onClick={handleSaveRecordDetails} className="flex-1 py-2 bg-gray-905 text-white rounded-xl font-bold hover:bg-gray-800 disabled:opacity-50 transition text-xs">
                    {editSavingRecord ? 'Kaydediliyor...' : 'Kaydet'}
                  </button>
                  <button disabled={editSavingRecord} onClick={() => {
                    setIsEditingRecord(false)
                    setEditCustName(record.customerName || '')
                    setEditCustPhone(record.customerPhone || '')
                    setEditCustAddress(record.customerAddress || '')
                    setEditProdName(record.productName || '')
                    setEditSerialNo((record as any).serialNumber || '')
                    setEditDesc(record.problemDescription || '')
                  }} className="flex-1 py-2 bg-gray-150 text-gray-700 rounded-xl font-bold hover:bg-gray-200 disabled:opacity-50 transition text-xs">
                    İptal
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-5 text-xs">
                {/* Genel Bilgiler Grid */}
                <div className="grid grid-cols-2 gap-3.5 bg-slate-50 dark:bg-slate-800/20 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800/80">
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" /> Kayıt Tarihi
                    </div>
                    <div className="font-bold text-gray-800 dark:text-white mt-1">
                      {record.createdAt ? new Date(record.createdAt).toLocaleDateString('tr-TR') : '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> Hizmet Tipi
                    </div>
                    <div className="font-bold text-gray-800 dark:text-white mt-1">
                      {record.typeLabel || 'Bilinmiyor'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5" /> Garanti Durumu
                    </div>
                    <div className="font-bold text-gray-800 dark:text-white mt-1">
                      {(record as any).isUnderWarranty ? 'Garanti Kapsamında' : 'Garanti Dışı'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> Öncelik
                    </div>
                    <div className="font-bold text-gray-800 dark:text-white mt-1">
                      {record.priorityLabel || 'Normal'}
                    </div>
                  </div>
                </div>

                {/* Müşteri */}
                <div className="flex gap-3 items-start bg-slate-50/50 dark:bg-slate-800/30 p-3 rounded-xl border border-slate-100/50 dark:border-slate-800/50">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-800 flex items-center justify-center shrink-0 border border-gray-200 dark:border-slate-700">
                    <User className="w-4 h-4 text-gray-500" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold text-gray-400 uppercase">Müşteri</div>
                    <div className="font-bold text-gray-800 dark:text-white truncate mt-0.5">{record.customerName || '-'}</div>
                    <div className="text-[10px] text-gray-500 font-medium">{record.customerPhone || '-'}</div>
                  </div>
                </div>

                {/* Adres */}
                <div className="flex gap-3 items-start bg-slate-50/50 dark:bg-slate-800/30 p-3 rounded-xl border border-slate-100/50 dark:border-slate-800/50">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-800 flex items-center justify-center shrink-0 border border-gray-200 dark:border-slate-700">
                    <MapPin className="w-4 h-4 text-gray-500" />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase">Adres / Bölge</div>
                    <div className="font-medium text-gray-700 dark:text-gray-300 mt-1 leading-relaxed">{record.customerAddress || '-'}</div>
                    <div className="text-[9px] text-gray-500 font-bold mt-1.5 bg-gray-100 dark:bg-slate-800 px-2 py-0.5 rounded-full inline-block border border-gray-200 dark:border-slate-700">{record.regionName || '-'}</div>
                  </div>
                </div>

                {/* Ürün */}
                <div className="flex gap-3 items-start bg-slate-50/50 dark:bg-slate-800/30 p-3 rounded-xl border border-slate-100/50 dark:border-slate-800/50">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-800 flex items-center justify-center shrink-0 border border-gray-200 dark:border-slate-700">
                    <Info className="w-4 h-4 text-gray-500" />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-gray-400 uppercase">Ürün Detayı</div>
                    <div className="font-semibold text-gray-800 dark:text-white mt-0.5">{record.productName}</div>
                    {(record as any).serialNumber && <div className="text-[10px] font-mono text-gray-500 font-medium mt-0.5">Seri No: {(record as any).serialNumber}</div>}
                  </div>
                </div>

                {/* Bayi Bilgisi */}
                {record.dealerName && (
                  <div className="flex gap-3 items-start bg-slate-50/50 dark:bg-slate-800/30 p-3 rounded-xl border border-slate-100/50 dark:border-slate-800/50">
                    <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-800 flex items-center justify-center shrink-0 border border-gray-200 dark:border-slate-700">
                      <User className="w-4 h-4 text-gray-500" />
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-gray-400 uppercase">Bayi Bilgisi</div>
                      <div className="font-semibold text-gray-800 dark:text-white mt-0.5">{record.dealerName}</div>
                      {record.dealerPhone && (
                        <div className="text-[10px] text-gray-500 font-medium mt-0.5 flex items-center gap-1">
                          Telefon: <PhoneLinks phone={record.dealerPhone} compact />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Problem Description */}
                {record.problemDescription && (
                  <div className="bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/80 dark:border-amber-900/30 rounded-xl p-3.5">
                    <div className="text-xs font-bold text-amber-800 dark:text-amber-500 mb-1.5 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-500" /> Arıza Tanımı / Açıklama
                    </div>
                    <div className="text-xs text-amber-900 dark:text-amber-400 leading-relaxed font-medium whitespace-pre-line">{record.problemDescription}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Servis Notları Card */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-150 dark:border-slate-800 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-bold text-gray-950 dark:text-white flex items-center gap-2 text-sm">
                <MessageSquare className="w-4 h-4 text-gray-500" />
                Servis Notları
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400">
                  {record.notes?.length || 0}
                </span>
              </h3>
            </div>

            <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
              {record.notes && record.notes.length > 0 ? (
                record.notes.map((n: any) => (
                  <div key={n.id} className="bg-slate-50 dark:bg-slate-800/30 p-3 rounded-xl border border-slate-100 dark:border-slate-800/50 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="font-bold text-gray-800 dark:text-gray-300">{n.authorName}</span>
                      <span className="text-gray-400">{new Date(n.createdAt).toLocaleString('tr-TR', {hour: '2-digit', minute:'2-digit', day:'2-digit', month:'2-digit', year:'2-digit'})}</span>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap leading-relaxed">
                      {n.content}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-xs text-gray-500 italic py-4 text-center">Henüz not eklenmemiş.</div>
              )}
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <textarea
                rows={2}
                placeholder="Yeni not yazın..."
                value={newNoteContent}
                onChange={(e) => setNewNoteContent(e.target.value)}
                className="px-3 py-2 bg-white dark:bg-slate-850 border border-gray-200 dark:border-slate-700 rounded-lg text-xs w-full focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/15 resize-none dark:text-white"
              />
              <button
                disabled={savingNote || !newNoteContent.trim()}
                onClick={async () => {
                  if (!newNoteContent.trim() || !selectedRecordId) return
                  setSavingNote(true)
                  try {
                    await apiJson(`/api/servicerecords/${selectedRecordId}/notes`, {
                      method: 'POST',
                      body: JSON.stringify({ content: newNoteContent })
                    })
                    setNewNoteContent('')
                    // Reload record details
                    const updatedData = await apiJson<ServiceRecordDetail>(`/api/servicerecords/${selectedRecordId}`)
                    setRecord(updatedData)
                  } catch (e: any) {
                    toast.error(e?.message || 'Not eklenemedi.')
                  } finally {
                    setSavingNote(false)
                  }
                }}
                className="w-full py-2 bg-[#B91C1C] hover:bg-[#991B1B] text-white rounded-lg text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" /> {savingNote ? 'Kaydediliyor...' : 'Not Ekle'}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Planning Actions & Workloads (2/3 width) */}
        <div className="lg:col-span-2 space-y-6">
          {isInstallation ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-6">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <h3 className="font-bold text-gray-950 flex items-center gap-2 text-base">
                  <Calendar className="w-5 h-5 text-gray-500" />
                  Montaj Planlama Detayları
                </h3>
              </div>

              {/* Quantity summary */}
              {(() => {
                return (
                  <div className={`rounded-xl px-4 py-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${isComplete ? 'bg-emerald-50/60 border border-emerald-200' : remainingQuantity > 0 && plannedQty > 0 ? 'bg-amber-50/60 border border-amber-200' : 'bg-blue-50/60 border border-blue-200'}`}>
                    <div className="text-xs flex items-center gap-3 flex-wrap">
                      <span><span className="font-semibold text-gray-600">Toplam Talep: </span><span className="font-bold text-gray-900">{totalQty}</span></span>
                      <span className="text-gray-300">|</span>
                      <span><span className="font-semibold text-gray-600">Planlandı: </span><span className="font-bold text-blue-700">{plannedQty}</span></span>
                      <span className="text-gray-300">|</span>
                      {isComplete ? (
                        <span className="flex-shrink-0 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full border border-emerald-200">
                          Tüm adetler planlandı
                        </span>
                      ) : (
                        <span><span className="font-semibold text-gray-600">Kalan: </span><span className={`font-bold ${isComplete ? 'text-emerald-600' : remainingQuantity > 0 ? 'text-orange-600' : 'text-gray-400'}`}>{remainingQuantity}</span></span>
                      )}
                    </div>
                    {!isComplete && plannedQty > 0 ? (
                      <span className="flex-shrink-0 text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full border border-amber-200">
                        {remainingQuantity} adet daha planlanabilir
                      </span>
                    ) : null}
                  </div>
                )
              })()}

              {/* Row form */}
              {remainingQuantity > 0 && (
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-150">
                  <div className="text-xs font-bold text-gray-800 mb-3 uppercase tracking-wider">Yeni Planlama Satırı Ekle</div>

                  {itemPlanState.length > 0 && (
                    <div className="mb-3">
                      <label className="text-[10px] font-bold text-gray-500 mb-1 block uppercase">Kalem *</label>
                      <select
                        value={activePlanItem?.id ?? ''}
                        onChange={e => {
                          setPlanRowItemId(e.target.value)
                          const next = itemPlanState.find(i => i.id === e.target.value)
                          if (next) setPlanRowQty(Math.min(planRowQty || 1, next.remaining) || 1)
                        }}
                        className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/15"
                      >
                        {itemPlanState.map(i => (
                          <option key={i.id} value={i.id} disabled={i.remaining === 0}>
                            {i.productName} — {i.planned}/{i.quantity} planlandı{i.remaining === 0 ? ' (tamam)' : `, ${i.remaining} kaldı`}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 mb-1 block uppercase">Tarih *</label>
                      <input type="date" value={planRowDate} onChange={e => setPlanRowDate(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/15" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 mb-1 block uppercase">Teknisyen *</label>
                      <select value={planRowTechId} onChange={e => setPlanRowTechId(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/15">
                        <option value="">Seçiniz</option>
                        {eligibleTechnicians.map(t => (<option key={t.id} value={t.id}>{t.fullName} ({workloads[t.id]?.count ?? 0} aktif iş)</option>))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 mb-1 block uppercase">Miktar *</label>
                      <input
                        type="number"
                        min={1}
                        max={planRowMaxQty}
                        value={planRowQty === 0 ? '' : planRowQty}
                        onChange={e => {
                          const val = e.target.value;
                          if (val === '') {
                            setPlanRowQty(0);
                          } else {
                            const num = Number(val);
                            if (!isNaN(num)) {
                              setPlanRowQty(Math.min(planRowMaxQty, num));
                            }
                          }
                        }}
                        className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/15" 
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 mb-1 block uppercase">Atama Adresi</label>
                      <input type="text" value={planRowAddress} onChange={e => setPlanRowAddress(toTurkishUpper(e.target.value))} placeholder="Adres girin..." className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/15" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 mb-1 block uppercase">Not</label>
                      <input type="text" value={planRowNote} onChange={e => setPlanRowNote(toTurkishUpper(e.target.value))} placeholder="Not girin..." className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/15" />
                    </div>
                  </div>

                  {planRowError && <div className="text-xs text-red-600 mb-3 bg-red-50 p-2.5 rounded-lg border border-red-200 font-medium">{planRowError}</div>}
                  {planRowSuccess && <div className="text-xs text-green-600 mb-3 bg-green-50 p-2.5 rounded-lg border border-green-200 font-medium">{planRowSuccess}</div>}

                  <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3.5">
                    <div className="flex items-center justify-between gap-2 mb-2 pb-1 border-b border-gray-100">
                      <div className="text-xs font-bold text-gray-800">Teknisyen İş Dağılımı</div>
                      <div className="text-[10px] font-semibold text-gray-500">{new Date(`${(planRowDate || workloadDate)}T00:00:00`).toLocaleDateString('tr-TR')}</div>
                    </div>
                    {workloadsLoading ? (
                      <div className="text-xs text-gray-500">İş dağılımı yükleniyor...</div>
                    ) : workloadsError ? (
                      <div className="text-xs text-red-600">{workloadsError}</div>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {eligibleTechnicians.slice(0, 6).map(t => {
                          const load = workloads[t.id]
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => setPlanRowTechId(t.id)}
                              className={'text-left rounded-lg border px-3 py-2 transition ' + (planRowTechId === t.id ? 'border-[#B91C1C] bg-red-50/50' : 'border-gray-155 bg-white hover:border-gray-300 hover:bg-gray-50')}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-gray-800 truncate">{t.fullName}</span>
                                <span className="text-[10px] font-extrabold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">{load?.count ?? 0} iş</span>
                              </div>
                              <div className="text-[10px] text-gray-500 truncate mt-0.5">{load?.records?.[0]?.serviceNumber ? `${load.records[0].serviceNumber} - ${load.records[0].customerName || 'Müşteri'}` : 'Seçili tarihte aktif iş yok'}</div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <button 
                      disabled={planRowLoading || !planRowDate || !planRowTechId || planRowQty < 1} 
                      onClick={submitPlanRow} 
                      className={'w-full px-6 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 sm:w-auto ' + (planRowLoading || !planRowDate || !planRowTechId || planRowQty < 1 ? 'bg-gray-300 text-gray-500' : 'bg-[#B91C1C] text-white hover:bg-[#991B1B]')}>
                      {planRowLoading ? 'Planlanıyor...' : 'GÖREV EKLE'}
                    </button>
                  </div>
                </div>
              )}

              {/* History table */}
              <div>
                <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs font-bold text-gray-800 uppercase tracking-wider">Planlama Geçmişi</div>

                  {transferableTaskIds.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold text-gray-500">
                        {selectedTaskIds.length > 0
                          ? `${selectedTaskIds.length} satır seçildi`
                          : 'Aktarılacak satırları seçin'}
                      </span>
                      <button
                        type="button"
                        disabled={selectedTaskIds.length === 0 || transferLoading || !record.isPrinted}
                        onClick={transferSelectedTasks}
                        title={!record.isPrinted ? 'Önce servis fişini yazdırın (Montaj Yönetimi)' : undefined}
                        className={
                          'px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 ' +
                          (selectedTaskIds.length === 0 || transferLoading || !record.isPrinted
                            ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                            : 'bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer')
                        }
                      >
                        {transferLoading ? 'Aktarılıyor...' : 'Seçilenleri Sahaya Aktar'}
                      </button>
                    </div>
                  )}
                </div>

                {!record.isPrinted && transferableTaskIds.length > 0 && (
                  <div className="mb-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 font-semibold">
                    Servis fişi henüz basılmadı. Fiş basılmadan satırlar sahaya aktarılamaz.
                  </div>
                )}
                {transferError && <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 font-semibold">{transferError}</div>}
                {transferSuccess && <div className="mb-3 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 font-semibold">{transferSuccess}</div>}

                {planTasksLoading ? (
                  <div className="text-sm text-gray-500 py-6 text-center">Yükleniyor...</div>
                ) : visiblePlanTaskRows.length === 0 ? (
                  <div className="text-sm text-gray-400 py-6 text-center bg-gray-50 rounded-xl border border-gray-150">Henüz planlama satırı yok.</div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-gray-150 bg-white">
                    <table className="w-full text-xs mobile-stack">
                      <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wider text-gray-500 font-bold border-b border-gray-150">
                        <tr>
                          <th className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={transferableTaskIds.length > 0 && transferableTaskIds.every(id => selectedTaskIds.includes(id))}
                              onChange={e => setSelectedTaskIds(e.target.checked ? transferableTaskIds : [])}
                              disabled={transferableTaskIds.length === 0}
                              className="rounded border-gray-300 text-[#B91C1C] focus:ring-[#B91C1C]"
                              title="Aktarılabilir satırların tümünü seç"
                            />
                          </th>
                          <th className="px-3 py-2">Sıra</th>
                          <th className="px-3 py-2">Kalem</th>
                          <th className="px-3 py-2">Atanan Teknisyen</th>
                          <th className="px-3 py-2">Durum</th>
                          <th className="px-3 py-2">Miktar</th>
                          <th className="px-3 py-2">Planlanan Tarih</th>
                          <th className="px-3 py-2">Atama Adresi</th>
                          <th className="px-3 py-2">Not</th>
                          <th className="px-3 py-2 text-right">İşlemler</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {visiblePlanTaskRows.map((t: any, index: number) => {
                          const statusMap: Record<string | number, { label: string; color: string }> = {
                            0: { label: 'Planlandı', color: 'bg-blue-50 text-blue-700 border-blue-200/60' },
                            1: { label: 'Devam Ediyor', color: 'bg-amber-50 text-amber-700 border-amber-200/60' },
                            2: { label: 'Gerçekleşti', color: 'bg-emerald-50 text-emerald-700 border-emerald-200/60' },
                            3: { label: 'İptal', color: 'bg-red-50 text-red-700 border-red-200/60 border' },
                            4: { label: 'Yeni Kayıt', color: 'bg-blue-50 text-blue-700 border-blue-200/60 border' },
                            Planned: { label: 'Planlandı', color: 'bg-blue-50 text-blue-700 border-blue-200/60' },
                            InProgress: { label: 'Devam Ediyor', color: 'bg-amber-50 text-amber-700 border-amber-200/60' },
                            Completed: { label: 'Gerçekleşti', color: 'bg-emerald-50 text-emerald-700 border-emerald-200/60' },
                            Cancelled: { label: 'İptal', color: 'bg-red-50 text-red-700 border-red-200/60' },
                            Deferred: { label: 'Yeni Kayıt', color: 'bg-blue-50 text-blue-700 border-blue-200/60' },
                          }
                          const s = t.status ?? t.Status
                          const sl = t.statusLabel ?? t.StatusLabel

                          const sc = statusMap[s] ?? { label: sl || s, color: 'bg-gray-100 text-gray-700 border-gray-200/60' }
                          const tname = t.technicianName ?? t.TechnicianName
                          const tqty = t._displayQty ?? 1
                          const tpAt = t.plannedAt ?? t.PlannedAt
                          const taskId = t.id || t.Id
                          const isEditing = editingTaskId === taskId

                          return (
                            <Fragment key={t._rowKey}>
                              <tr className={(isEditing ? 'bg-red-50/20 ' : '') + 'hover:bg-gray-50/50 transition-colors'}>
                                <td data-mobile-hide data-label="" className="px-3 py-2">
                                  <input
                                    type="checkbox"
                                    checked={selectedTaskIds.includes(taskId)}
                                    disabled={!transferableTaskIds.includes(taskId)}
                                    onChange={() => setSelectedTaskIds(prev =>
                                      prev.includes(taskId) ? prev.filter(x => x !== taskId) : [...prev, taskId]
                                    )}
                                    className="rounded border-gray-300 text-[#B91C1C] focus:ring-[#B91C1C] disabled:opacity-30"
                                    title={transferableTaskIds.includes(taskId) ? 'Sahaya aktarmak için seç' : 'Bu satır aktarılamaz'}
                                  />
                                </td>
                                <td data-mobile-hide data-label="Sıra" className="px-3 py-2 font-bold text-gray-400">
                                  {index + 1}
                                </td>
                                <td data-label="Kalem" className="px-3 py-2 text-gray-700 max-w-[180px] truncate" title={t.itemProductName ?? t.ItemProductName ?? ''}>
                                  {t.itemProductName ?? t.ItemProductName ?? <span className="text-gray-400 italic">-</span>}
                                </td>
                                <td data-label="Atanan Teknisyen" className="px-3 py-2 font-semibold text-gray-800">
                                  {isEditing ? (
                                    <select
                                      value={editTechId}
                                      onChange={e => setEditTechId(e.target.value)}
                                      className="px-2 py-1 bg-white border border-gray-200 rounded text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                                    >
                                      <option value="">Seçiniz</option>
                                      {eligibleTechnicians.map(tech => (
                                        <option key={tech.id} value={tech.id}>{tech.fullName}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    tname || <span className="text-gray-400 italic">Atanmadı</span>
                                  )}
                                </td>
                                <td data-label="Durum" className="px-3 py-2">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${sc.color}`}>
                                    {sc.label}
                                  </span>
                                </td>
                                <td data-label="Miktar" className="px-3 py-2 font-bold text-gray-700">{tqty}</td>
                                <td data-label="Planlanan Tarih" className="px-3 py-2 text-gray-650 font-semibold">
                                  {isEditing ? (
                                    <input
                                      type="date"
                                      value={editDate}
                                      onChange={e => setEditDate(e.target.value)}
                                      className="px-2 py-1 bg-white border border-gray-200 rounded text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                                    />
                                  ) : (
                                    tpAt ? new Date(tpAt).toLocaleDateString('tr-TR') : '-'
                                  )}
                                </td>
                                <td data-label="Atama Adresi" className="px-3 py-2 text-gray-500 font-medium max-w-[150px] truncate" title={t.customAddress || t.CustomAddress || ''}>
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      value={editAddress}
                                      onChange={e => setEditAddress(toTurkishUpper(e.target.value))}
                                      placeholder="Adres..."
                                      className="px-2 py-1 bg-white border border-gray-200 rounded text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                                    />
                                  ) : (
                                    t.customAddress || t.CustomAddress || '-'
                                  )}
                                </td>
                                <td data-mobile-hide data-label="Not" className="px-3 py-2 text-gray-500 font-medium max-w-[150px] truncate" title={t.notes || t.Notes || ''}>
                                  {isEditing ? (
                                    <input
                                      type="text"
                                      value={editNote}
                                      onChange={e => setEditNote(toTurkishUpper(e.target.value))}
                                      placeholder="Not..."
                                      className="px-2 py-1 bg-white border border-gray-200 rounded text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                                    />
                                  ) : (
                                    t.notes || t.Notes || '-'
                                  )}
                                </td>
                                <td data-mobile-hide data-label="İşlemler" className="px-3 py-2 text-right">
                                  {isEditing ? (
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        onClick={() => saveEditing(taskId)}
                                        disabled={editLoading}
                                        className="p-1 text-green-600 hover:text-green-800 hover:bg-green-50 rounded transition-colors"
                                        title="Kaydet"
                                      >
                                        <CheckCircle className="w-4.5 h-4.5" />
                                      </button>
                                      <button
                                        onClick={cancelEditing}
                                        disabled={editLoading}
                                        className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded transition-colors"
                                        title="İptal"
                                      >
                                        <X className="w-4.5 h-4.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-end gap-2">
                                      <button
                                        onClick={() => startEditing(t)}
                                        className="p-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded transition-colors cursor-pointer"
                                        title="Düzenle"
                                      >
                                        <Edit2 className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={() => updateTaskStatusDirect(t, 'Deferred')}
                                        className="p-1 text-orange-600 hover:text-orange-850 hover:bg-orange-50 rounded transition-colors cursor-pointer"
                                        title="Planı Kaldır (Yeni Kayıt)"
                                      >
                                        <Clock className="w-4 h-4" />
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                              {isEditing && editError && (
                                <tr className="bg-red-50">
                                  <td colSpan={10} className="px-3 py-1.5 text-xs text-red-600 font-semibold text-left">
                                    {editError}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            !isEditingPlan && (record.status === 'Planned' || !!record.plannedAt) ? (
              <div className="bg-white rounded-2xl border border-gray-150 shadow-sm p-6 space-y-4 max-w-md">
                <h3 className="font-bold text-gray-950 flex items-center gap-2 text-base pb-2 border-b border-gray-100">
                  <Calendar className="w-5 h-5 text-gray-500" />
                  Mevcut Planlama
                </h3>
                <div className="space-y-3.5 mt-2">
                  <div className="flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-150">
                    <div>
                      <div className="text-[10px] font-bold text-gray-400 uppercase">Planlanan Tarih</div>
                      <div className="font-bold text-gray-800 text-sm mt-0.5">
                        {record.plannedAt ? new Date(record.plannedAt).toLocaleDateString('tr-TR') : '-'}
                      </div>
                    </div>
                    <Calendar className="w-5 h-5 text-gray-400" />
                  </div>
                  
                  <div className="flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-150">
                    <div>
                      <div className="text-[10px] font-bold text-gray-400 uppercase">Atanan Teknisyen</div>
                      <div className="font-bold text-gray-800 text-sm mt-0.5">
                        {record.assignedTechnicianName || 'Atanmadı'}
                      </div>
                    </div>
                    <User className="w-5 h-5 text-gray-400" />
                  </div>

                  <button
                    onClick={() => {
                      setIsEditingPlan(true)
                      if (record.plannedAt) {
                        setPlannedDate(String(record.plannedAt).slice(0, 10))
                        setWorkloadDate(String(record.plannedAt).slice(0, 10))
                      }
                      if (record.assignedTechnicianId) {
                        setSelectedTechId(record.assignedTechnicianId)
                      }
                    }}
                    className="w-full py-2.5 bg-[#B91C1C] hover:bg-[#991B1B] text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow"
                  >
                    <Edit2 className="w-4 h-4" /> Planı Düzenle
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
                  <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                    <h3 className="font-bold text-gray-950 flex items-center gap-2 text-base">
                      <Calendar className="w-5 h-5 text-gray-500" />
                      Planlama Tarihi Atama
                    </h3>
                    {(record.status === 'Planned' || !!record.plannedAt) && (
                      <button
                        onClick={() => setIsEditingPlan(false)}
                        className="text-xs text-gray-500 hover:text-gray-700 font-semibold px-2 py-1 bg-gray-100 rounded-lg"
                      >
                        Vazgeç
                      </button>
                    )}
                  </div>

                  <div className="space-y-4 mt-2">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-500 uppercase">Tarih Seçin <span className="text-red-500">*</span></label>
                      <input type="date" value={plannedDate} onChange={(e) => { setPlannedDate(e.target.value); setWorkloadDate(e.target.value) }} className="px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/15" />
                    </div>
                    {planError && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs font-semibold text-red-600">{planError}</div>}
                    {planSuccess && <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-xs font-semibold text-green-700 flex items-center gap-2"><CheckCircle className="w-4 h-4" /> {planSuccess}</div>}
                    <button disabled={planning || !plannedDate || !selectedTechId} onClick={handlePlan} className={'w-full py-2.5 rounded-xl text-sm font-bold transition-all shadow active:scale-[0.98] ' + (planning || !plannedDate || !selectedTechId ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-[#B91C1C] text-white hover:bg-[#991B1B]')}>
                      {planning ? 'Planlanıyor...' : 'Planla ve Kaydet'}
                    </button>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
                  <h3 className="font-bold text-gray-950 flex items-center gap-2 text-base pb-2 border-b border-gray-100">
                    <User className="w-5 h-5 text-gray-500" />
                    Teknisyen Ataması
                  </h3>
                  
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-gray-150 bg-gray-50 px-3.5 py-2">
                    <div className="text-xs font-bold text-gray-700">Tarih İş Dağılımı</div>
                    <div className="flex items-center gap-1 text-[11px] font-bold text-gray-500 bg-white px-2.5 py-0.5 rounded-lg border border-gray-200">
                      <Calendar className="w-3.5 h-3.5" />
                      {workloadDate ? new Date(`${workloadDate}T00:00:00`).toLocaleDateString('tr-TR') : 'Tarih seçilmedi'}
                    </div>
                  </div>

                  {techsLoading ? (
                    <div className="animate-pulse space-y-3">{[1,2,3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-lg" />)}</div>
                  ) : eligibleTechnicians.length === 0 ? (
                    <div className="text-sm text-gray-500 py-4 text-center">Müsait teknisyen bulunamadı.</div>
                  ) : workloadsLoading ? (
                    <div className="animate-pulse space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-lg" />)}</div>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {workloadsError ? <div className="text-xs text-red-600">{workloadsError}</div> : null}
                      {eligibleTechnicians.map((tech) => {
                        const load = workloads[tech.id]
                        const count = load?.count ?? 0
                        const capacity = tech.maxDailyTasks || 0
                        const isBusy = capacity > 0 && count >= capacity
                        return (
                          <button key={tech.id} onClick={() => setSelectedTechId(tech.id)} className={'w-full rounded-xl border px-3.5 py-3 text-left transition-all ' + (selectedTechId === tech.id ? 'border-[#B91C1C] bg-red-50/30' : 'border-gray-150 bg-white hover:border-gray-300 hover:bg-gray-50')}>
                            <div className="flex items-start gap-3">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-600 to-gray-700 text-white flex items-center justify-center text-xs font-bold shrink-0">{tech.initials}</div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <div className="text-xs font-bold text-gray-900">{tech.fullName}</div>
                                    <div className="text-[10px] text-gray-400 font-semibold">{tech.regionName || 'Bölge atanmamış'}</div>
                                  </div>
                                  <div className={'rounded-full px-2 py-0.5 text-[10px] font-bold border ' + (isBusy ? 'bg-red-50 text-red-700 border-red-200' : count > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200')}>
                                    {count} iş
                                  </div>
                                </div>
                                <div className="mt-2 space-y-1">
                                  {load?.records?.length ? load.records.slice(0, 3).map((r) => (
                                    <div key={r.id} className="flex items-center justify-between gap-2 text-[10px] text-gray-500">
                                      <span className="truncate font-mono">{r.serviceNumber} - {r.customerName || r.productName}</span>
                                      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.2 text-[9px] font-bold">{r.statusLabel || r.status}</span>
                                    </div>
                                  )) : (
                                    <div className="text-[10px] text-emerald-700 font-bold">Seçili tarihte aktif iş yok</div>
                                  )}
                                  {(load?.records?.length ?? 0) > 3 ? <div className="text-[10px] text-gray-400 font-medium">+{(load?.records?.length ?? 0) - 3} iş daha</div> : null}
                                </div>
                              </div>
                              {selectedTechId === tech.id && <CheckCircle className="w-4 h-4 text-[#B91C1C] shrink-0 mt-0.5" />}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      </div>

      <FisNoModal
        open={!!fisNoFor}
        onClose={() => setFisNoFor(null)}
        recordId={fisNoFor?.id ?? ''}
        serviceNumber={fisNoFor?.serviceNumber}
        productName={fisNoFor?.productName}
        customerName={fisNoFor?.customerName ?? fisNoFor?.dealerName ?? undefined}
        currentValue={fisNoFor?.manualReceiptNo}
        onSaved={async () => { await refetchServiceRecords() }}
      />

    </div>
  )
}
