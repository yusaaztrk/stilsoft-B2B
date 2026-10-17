import { useMemo, useState, useEffect, useCallback } from 'react'

import { useNavigate } from 'react-router-dom'
import {
  Camera,
  Download,
  Filter,
  MoreHorizontal,
  Search,
  Trash2,
  X,
} from 'lucide-react'

import { useServiceRecordsPaged } from '../hooks/useServiceRecords'
import { workshopDaysOf } from '../utils/atolyeGun'
import { AtolyeGunRozeti } from '../components/AtolyeGunRozeti'
import { kayitDurumTarihi as durumTarihi } from '../utils/durumTarihi'
import { useTechnicians } from '../hooks/useTechnicians'
import { fetchErpProducts, type ErpProductDto } from '../api/erp'
import { apiJson } from '../api/client'
import { groupTimelineEvents } from '../utils/timelineHelper'
import TimelineEvent from '../components/TimelineEvent'
import Table, { type TableColumn } from '../components/Table'
import { getAccessToken } from '../auth/storage'
import { usePermissions, useCanViewHistory } from '../auth/PermissionsContext'
import { toTurkishUpper } from '../utils/formInput'
import { API_BASE_URL } from '../config'
import Modal from '../components/Modal'
import ActionDropdown from '../components/ActionDropdown'
import FisNoModal from '../components/FisNoModal'
import ServisGecmisiModal from '../components/ServisGecmisiModal'
import { useSignalREvent } from '../hooks/useSignalR'
import { fetchStockItems, type StockItemDto } from '../api/stock'
import { getCustomerOrDealerType, getCustomerTypeBadgeClass } from '../utils/customerType'
import { faturalanacakVar } from '../utils/fatura'
import { garantiBaslangici, garantiBaslangiciInput } from '../utils/garanti'
import { toast } from 'sonner'
import PhoneLinks from '../components/PhoneLinks'
import { SearchableProductSelect } from '../components/SearchableProductSelect'
import { useOnay } from '../components/OnayModal'
import GorselOnizleyici from '../components/GorselOnizleyici'

function toImgSrc(url: string | null | undefined): string {
  if (!url) return ''
  const s = String(url).trim()
  if (!s) return ''
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:') || s.startsWith('blob:')) return s
  return `${API_BASE_URL}${s.startsWith('/') ? '' : '/'}${s}`
}

interface ServiceRecordDetail {
  id: string
  serviceNumber: string
  /** Kağıt fiş numarası — elle girilir, sistem numarasından (AT-/SH-) ayrıdır. */
  manualReceiptNo?: string | null
  status: string
  statusLabel: string
  customerName?: string
  customerPhone?: string
  customerAddress?: string
  productName: string
  assignedTechnicianName?: string
  lastAction?: string
  problemDescription?: string
  receivingNote?: string
  serialNumber?: string
}

const statusConfig: Record<string, { label: string; color: string }> = {
  New: { label: 'Yeni Kayıt', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  Workshop: { label: 'Atölyede', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  InRepair: { label: 'Tamirde', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  Ready: { label: 'Hazır', color: 'bg-green-100 text-green-700 border-green-200' },
  Delivered: { label: 'Teslim Edildi', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  Cancelled: { label: 'İptal', color: 'bg-red-100 text-red-700 border-red-200' },
  Delayed: { label: 'Gecikti', color: 'bg-red-100 text-red-700 border-red-200' },
  WaitingForParts: { label: 'Parça Bekliyor', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  WorkshopReady: { label: 'Atölye Hazır', color: 'bg-teal-100 text-teal-850 border-teal-200 font-semibold' },
  DeliveryPlanning: { label: 'Teslimat Planlamasında', color: 'bg-indigo-50 text-indigo-700 border-indigo-200 font-semibold' },
  FieldPlanned: { label: 'Saha Planlamasında', color: 'bg-sky-100 text-sky-800 border-sky-200' },
  FieldCompleted: { label: 'Sahada Tamamlandı', color: 'bg-green-50 text-green-800 border-green-200' },
  Planned: { label: 'Teslimat Rotalandı', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' }
}

const priorityConfig: Record<string, { label: string; color: string }> = {
  Low: { label: 'Düşük', color: 'bg-gray-100 text-gray-700' },
  Normal: { label: 'Normal', color: 'bg-gray-100 text-gray-700' },
  High: { label: 'Acil', color: 'bg-orange-100 text-orange-700' },
  Critical: { label: 'Kritik', color: 'bg-red-100 text-red-700' },
}

const getStatusLabelTR = (statusKey?: string) => {
  if (!statusKey) return ''
  const map: Record<string, string> = {
    New: 'Yeni Kayıt',
    Workshop: 'Atölyede',
    InRepair: 'Tamirde',
    WaitingForParts: 'Parça Bekliyor',
    Ready: 'Hazır',
    WorkshopReady: 'Atölye Hazır',
    DeliveryPlanning: 'Teslimat Planlamasında',
    FieldPlanned: 'Saha Planlamasında',
    FieldCompleted: 'Sahada Tamamlandı',
    Planned: 'Teslimat Rotalandı',
    Delivered: 'Teslim Edildi',
    Cancelled: 'İptal'
  }
  return map[statusKey] || statusKey
}

const formatProblemDescriptionTR = (desc?: string) => {
  if (!desc) return '-'
  return desc
    .replace(/ Servis Açıklaması: /g, '\n• Servis Açıklaması: ')
    .replace(/ Fatura Numarası: /g, '\n• Fatura Numarası: ')
    .replace(/ Garanti Başlangıcı: /g, '\n• Garanti Başlangıcı: ')
    .replace(/ Müşteri Tipi: /g, '\n• Müşteri Tipi: ')
    .replace(/ Ek Açıklama: /g, '\n• Ek Açıklama: ')
}

const formatStepDescriptionTR = (text?: string) => {
  if (!text) return 'İşlem gerçekleştirildi.'
  
  let formatted = text

  if (formatted.includes('Kullanılan Parçalar:')) {
    const partsMatch = formatted.match(/Kullanılan Parçalar:\s*([^|\n]+)/i)
    if (partsMatch) {
      const rawPartsStr = partsMatch[1].trim()
      const partsItems = rawPartsStr.split(',').map(p => p.trim()).filter(Boolean)
      const formattedParts = partsItems.map(p => {
        const clean = p.replace(/\(Adet:\s*(\d+)\)/i, '($1 Adet)')
        return `  • ${clean}`
      }).join('\n')

      formatted = formatted.replace(
        /\|?\s*Kullanılan Parçalar:\s*[^|\n]+/i,
        `\n⚙️ Kullanılan Yedek Parçalar:\n${formattedParts}`
      )
    }
  }

  formatted = formatted.split('|').map(s => s.trim()).filter(Boolean).join('\n')

  formatted = formatted
    .replace(/(Fatura Bedeli:\s*[^\n()]+)/gi, '\n💰 $1')
    .replace(/(Fatura No:\s*[^\s\n()]+)/gi, '\n🧾 $1')
    .replace(/(Fatura oluşturuldu[^\n]*)/gi, '\n🧾 $1')
    .replace(/(Teslimat planlandı[^\n]*)/gi, '\n🚚 $1')

  return formatted.trim()
}

/**
 * Kaydın FATURALANACAĞI cari kodu. Çözülemezse `null` — ASLA uydurma bir kod değil.
 * Gerekçe SahaArizaPage'deki ikiziyle aynı: sabit `'120-04-000001'` fallback'i, cari kodu
 * çözülemeyen her kaydın bedelini ilgisiz TEK bir cariye yazıyordu.
 */
const getDealerCode = (record: any): string | null => {
  if (!record) return null
  const direct = record.dealerCode || record.DealerCode
  if (direct && String(direct).trim()) return String(direct).trim()
  if (record.dealerName) {
    const match = String(record.dealerName).match(/\(([^)]+)\)/)
    if (match && match[1].trim()) return match[1].trim()
  }
  const cust = record.customerCode || record.CustomerCode
  if (cust && String(cust).trim()) return String(cust).trim()
  return null
}

const getDealerDisplayName = (r: any) => {
  if (!r) return '-'
  if (r.dealerName && r.dealerName !== r.customerName && !['tarik', 'tarık', 'tarık öztürk'].includes(String(r.dealerName).toLowerCase())) {
    return r.dealerName
  }
  if (r.customerType === 'Bayi' || r.isDealer) {
    return r.customerName || r.dealerName || 'Bayi Müşteri'
  }
  return '-'
}

const getRecordPrice = (r: any): number => {
  if (!r) return 0
  if (typeof r.totalCost === 'number' && r.totalCost > 0) return r.totalCost
  if (typeof r.laborCost === 'number' && r.laborCost > 0) return r.laborCost
  if (typeof r.price === 'number' && r.price > 0) return r.price
  if (typeof r.invoicePrice === 'number' && r.invoicePrice > 0) return r.invoicePrice

  if (Array.isArray(r.notes)) {
    for (const n of r.notes) {
      const match = (n.content || '').match(/Fatura Bedeli:\s*₺?\s*([\d.,]+)/i)
      if (match) {
        const val = parseFloat(match[1].replace(/\./g, '').replace(',', '.'))
        if (!isNaN(val) && val > 0) return val
      }
    }
  }
  return 0
}

export default function AtolyeArizaPage() {
  const navigate = useNavigate()
  const { technicians } = useTechnicians()
  const [activeTab, setActiveTab] = useState<'bekleyen' | 'aktif' | 'teslimat'>('bekleyen')
  /**
   * Sub-tab visibility now comes from the shared permission context.
   *
   * This page used to work it out on its own, and every branch of that logic failed open: no
   * token, an unparseable token, a role claim it did not recognise, an empty key list, or the
   * answer simply not having arrived yet all resolved to "allow". A user with no permissions
   * at all therefore saw every tab, which is why sub-page permissions looked like they had
   * never been implemented. Denials now stand.
   */
  const { can, loaded: permissionsLoaded } = usePermissions()
  const canViewHistory = useCanViewHistory()


  // The route guard already waits for permissions before rendering this page, so `loaded` is
  // true here; it is still required rather than assumed, so an unguarded mount cannot leak.
  const hasPermission = (key: string) => permissionsLoaded && can(key)

  /**
   * Sekme -> yetki anahtarı. Sekmenin görünürlüğünü ve listenin kapsamını birlikte belirler:
   * rol o sekmede 'tüm işleri görme' taşımıyorsa sunucu yalnızca kullanıcıya atanmış kayıtları
   * döndürür, o yüzden hangi sekmede olduğumuzu sunucuya bildirmek zorundayız.
   */
  const TAB_PAGE_KEYS = {
    bekleyen: 'atolyeAriza.atolye',
    aktif: 'atolyeAriza.hazirTeslimat',
    teslimat: 'atolyeAriza.teslimattakiler'
  } as const

  // Açılışta seçili gelen sekme o role kapalı olabilir; kapalıysa ilk açık sekmeye kay.
  useEffect(() => {
    if (!permissionsLoaded) return
    if (hasPermission(TAB_PAGE_KEYS[activeTab])) return
    const first = (Object.keys(TAB_PAGE_KEYS) as Array<keyof typeof TAB_PAGE_KEYS>)
      .find((t) => hasPermission(TAB_PAGE_KEYS[t]))
    if (first && first !== activeTab) setActiveTab(first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionsLoaded, activeTab])

  // Bidirectional Tab Sync with Header Shell
  useEffect(() => {
    (window as any).__atolyeActiveTab = activeTab
    window.dispatchEvent(new CustomEvent('atolye-ariza:tab-updated'))
  }, [activeTab])

  useEffect(() => {
    const handleTabChange = (e: Event) => {
      const tab = (e as CustomEvent).detail
      setActiveTab(tab)
      setPage(1)
    }
    window.addEventListener('shell:atolye-ariza-tab-change', handleTabChange)
    return () => window.removeEventListener('shell:atolye-ariza-tab-change', handleTabChange)
  }, [])

  const [regions, setRegions] = useState<any[]>([])
  const [planAddress, setPlanAddress] = useState('')
  const [planRegionId, setPlanRegionId] = useState('')
  const [planCustomerName, setPlanCustomerName] = useState('')
  const [planCustomerPhone, setPlanCustomerPhone] = useState('')

  useEffect(() => {
    apiJson<any[]>('/api/regions')
      .then(data => setRegions(data || []))
      .catch(() => setRegions([]))
  }, [])

  const [deliveryTechId, setDeliveryTechId] = useState<string>('')
  const [plannedDate, setPlannedDate] = useState<string>('')
  const [techWorkloads, setTechWorkloads] = useState<Record<string, { count: number; records: any[] }>>({})
  const [techWorkloadsLoading, setTechWorkloadsLoading] = useState(false)

  const fetchTechWorkloads = useCallback(async (targetDate?: string) => {
    const dateToUse = targetDate || plannedDate || new Date().toISOString().slice(0, 10)
    setTechWorkloadsLoading(true)
    try {
      const params = new URLSearchParams({
        plannedDate: dateToUse,
        pageSize: '500',
      })
      const response = await apiJson<any>(`/api/servicerecords?${params}`)
      const rows = Array.isArray(response) ? response : (response?.items || [])
      const map: Record<string, { count: number; records: any[] }> = {}
      const inactiveStatuses = new Set(['Delivered', 'Cancelled', '5', '6'])

      if (Array.isArray(rows)) {
        for (const row of rows) {
          const techId = row.assignedTechnicianId || row.technicianId
          if (!techId || inactiveStatuses.has(String(row.status))) continue
          if (!map[techId]) {
            map[techId] = { count: 0, records: [] }
          }
          map[techId].count += 1
          map[techId].records.push(row)
        }
      }
      setTechWorkloads(map)
    } catch {
      setTechWorkloads({})
    } finally {
      setTechWorkloadsLoading(false)
    }
  }, [plannedDate])

  useEffect(() => {
    fetchTechWorkloads()
  }, [plannedDate, fetchTechWorkloads])

  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage] = useState(1)
  const pageSize = 200
  const [filteredRows, setFilteredRows] = useState<any[]>([])

  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [showFiltersMobile, setShowFiltersMobile] = useState(false)

  const [stockItems, setStockItems] = useState<StockItemDto[]>([])
  const [selectedParts, setSelectedParts] = useState<{ id: string; name: string; partNumber?: string; quantity: number; unitPrice: number; isWarranty: boolean }[]>([])
  /**
   * "Atölyeye Geri Al" onayı. window.confirm yerine uygulama içi kapı: geri alma artık fatura
   * taslağını da iptal ediyor, yani sonucu tarayıcının tek satırlık kutusundan ağır.
   */
  const [returnTarget, setReturnTarget] = useState<any | null>(null)
  const [planParts, setPlanParts] = useState<{ id: string; name: string; partNumber?: string; quantity: number; unitPrice: number; isWarranty: boolean }[]>([])
  const [planLaborFee, setPlanLaborFee] = useState<string>('')
  const [previewOpen, setPreviewOpen] = useState(false)

  // 3 Photo Upload Slots
  const [photoSlots, setPhotoSlots] = useState<(File | null)[]>([null, null, null])

  // Modals for Hazır Ürün Teslimat Planlama Actions
  const [planModalOpen, setPlanModalOpen] = useState(false)
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)

  const statusFromQ = useMemo(() => {
    const lq = q.trim().toLowerCase()
    if (!lq) return null
    const found = Object.entries(statusConfig).find(([, cfg]) =>
      cfg.label.toLowerCase().includes(lq) || lq.includes(cfg.label.toLowerCase())
    )
    return found ? found[0] : null
  }, [q])

  // Kagit fis no modali: hangi kayit icin acik oldugu. null = kapali.
  const [fisNoFor, setFisNoFor] = useState<any | null>(null)

  /*
    PASİFE ALINANLAR (2026-09-18 kullanıcı isteği). 90 günden eski kayıtlar varsayılan
    listede yok; süzgeç SUNUCUDA (`includePassive`). Üst çubuktaki kutu `window` olayıyla
    haber veriyor — Saha Arıza ve kabul ekranlarıyla AYNI bayrak, bir ekranda açılınca
    diğerinde de açık kalır.
  */
  const [showPassive, setShowPassive] = useState(() => {
    return (window as any).__showPassive !== undefined ? !!(window as any).__showPassive : false
  })

  useEffect(() => {
    const onPassiveChanged = (e: any) => setShowPassive(!!e.detail)
    window.addEventListener('shell:show-passive-changed', onPassiveChanged)
    return () => window.removeEventListener('shell:show-passive-changed', onPassiveChanged)
  }, [])

  const { result, isLoading, error, updateStatus, assignTechnician, plan, refetch } = useServiceRecordsPaged({
    includePassive: showPassive,
    q: statusFromQ ? undefined : (q || undefined),
    status: statusFilter || statusFromQ || undefined,
    statuses: !statusFilter && !statusFromQ
      ? (activeTab === 'bekleyen' ? 'Workshop,InRepair,WaitingForParts,Delayed' : (activeTab === 'aktif' ? 'Ready,WorkshopReady,DeliveryPlanning' : 'InDelivery,Planned'))
      : undefined,
    type: 'Repair',
    category: 'small',
    scopeKey: TAB_PAGE_KEYS[activeTab],
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    pageSize: 1000,
  })

  // LİSTEYİ BURADAN ÇEKMİYORUZ (2026-08-21).
  //
  // `useServiceRecordsPaged` hook'u zaten aynı üç SignalR olayına abone ve kendi içinde
  // yeniliyor. Sayfa da `refetch()` çağırınca her olayda liste İKİ KEZ çekiliyordu.
  // Burada yalnız hook'un bilmediği şey kalıyor: teknisyen iş yükleri.
  useSignalREvent('service_record_updated', () => { fetchTechWorkloads() })
  useSignalREvent('ReceiveServiceRecordUpdate', () => { fetchTechWorkloads() })
  useSignalREvent('ServiceRecordUpdated', () => { fetchTechWorkloads() })

  // SAYFA SEVİYESİNDE YOKLAMA YOK (2026-08-21 kullanıcı bildirimi).
  //
  // Burada 4 SANİYEDE BİR listeyi baştan çeken bir zamanlayıcı ve ayrıca bir `focus`
  // dinleyicisi vardı. Ekran sürekli kendini yeniliyor, kullanıcı satır seçerken ya da form
  // doldururken altından veri değişiyordu; servis ekiplerinin en çok kullandığı ekranda
  // iş yapmayı fiilen engelliyordu.
  //
  // İkisi de GEREKSİZDİ, çünkü `useServiceRecordsPaged` hook'u bunların üçünü de kendisi
  // yapıyor: SignalR abonelikleri (anlık), `visibilitychange` (sekmeye dönüş) ve yedek
  // yoklama. Sayfa da aynısını yapınca her şey ikiye katlanıyordu.
  //
  // Tek yenileme yolu artık hook. Bu blok bilerek boş bırakılmadı, tamamen kaldırıldı.

  const records = useMemo(() => {
    return result.items.map(item => {
      const startStr = item.createdAt
      if (!startStr) return { ...item, elapsedDays: 0, workshopDays: workshopDaysOf(item) ?? -1 }
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
      return { ...item, elapsedDays: diffDays, workshopDays: workshopDaysOf(item) ?? -1 }
    })
  }, [result.items])

  const columns: TableColumn<any>[] = useMemo<TableColumn<any>[]>(() => [
    {
      key: 'serviceNumber' as any,
      primary: true,
      label: 'Arıza ID',
      searchable: true,
      filter: { type: 'text' },
      render: (_v, row) => (
        <span className="font-mono text-xs font-semibold text-[#B91C1C]">{row.serviceNumber}</span>
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
      /* ATÖLYE GÜN (2026-10-04): ürün ilk kez atölyeye alındığından iş bitene kadar; kural utils/atolyeGun. */
      key: 'workshopDays' as any,
      label: 'Atölye Gün',
      sortable: true,
      searchable: false,
      render: (_v, row: any) => <AtolyeGunRozeti days={Number(row.workshopDays ?? -1)} />
    },
    {
      key: 'customerType' as any,
      hideOnMobile: true,
      label: 'Müşteri Tipi',
      searchable: true,
      filter: {
        type: 'select',
        options: [
          { label: 'Bayi', value: 'bayi' },
          { label: 'Mağaza', value: 'mağaza' },
          { label: 'Bayiye Teslim', value: 'bayiye teslim' },
          { label: 'Müşteri', value: 'müşteri' }
        ]
      },
      render: (_v, row) => {
        const type = getCustomerOrDealerType(row)
        return (
          <span className={`inline-flex px-2 py-0.5 rounded text-xs border ${getCustomerTypeBadgeClass(type)}`}>
            {type}
          </span>
        )
      }
    },
    {
      key: 'createdAt' as any,
      label: 'Kayıt Tarihi',
      searchable: true,
      filter: { type: 'date' },
      render: (_v, row) => (
        <div>
          <div className="text-xs text-gray-900">{new Date(row.createdAt).toLocaleDateString('tr-TR')}</div>
          <div className="text-[10px] text-gray-500">{new Date(row.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      )
    },
    {
      key: 'dealerName' as any,
      label: 'Bayi',
      searchable: true,
      filter: { type: 'text' },
      render: (_v, row) => (
        <span className="text-xs font-semibold text-gray-900">{getDealerDisplayName(row)}</span>
      )
    },
    {
      key: 'regionName' as any,
      label: 'Bölge',
      searchable: true,
      filter: {
        type: 'select',
        options: regions.map(r => ({ label: r.name, value: r.name }))
      },
      render: (_v, row) => (
        <span className="text-xs text-gray-700">{row.regionName || '-'}</span>
      )
    },
    {
      key: 'customerName' as any,
      primary: true,
      label: 'Müşteri',
      searchable: true,
      filter: { type: 'text' },
      render: (_v, row) => (
        <div>
          <div className="text-xs font-semibold text-gray-900">{row.customerName || '-'}</div>
          {row.customerPhone && (
            <div className="text-[10px] text-gray-500 mt-0.5">
              <PhoneLinks phone={row.customerPhone} compact />
            </div>
          )}
          {row.customerAddress && <div className="text-[10px] text-gray-400 mt-0.5 max-w-[200px] whitespace-pre-wrap leading-tight">{row.customerAddress}</div>}
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
          <div className="text-xs text-gray-700 flex items-center gap-1.5">
            <span>{row.productName}</span>
            <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-bold ${row.category === 'small' ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-800'}`}>
              {row.category === 'small' ? 'Küçük Ürün' : 'Büyük Ürün'}
            </span>
          </div>
          <div className="text-[10px] text-gray-500">{row.serialNumber ? `SN: ${row.serialNumber}` : '-'}</div>
        </div>
      )
    },
    {
      /*
        GARANTİ SÜTUNU (2026-08-26, kullanıcı isteği: "garanti evet hayır, varsa altında
        tarihi de olsun").

        Tarih iki kaynaktan okunur (yeni alan + eski açıklama metni); kural `utils/garanti.ts`
        içinde tek yerde durur, üç arıza listesi de oradan okur.
      */
      key: 'isUnderWarranty' as any,
      hideOnMobile: true,
      label: 'Garanti',
      searchable: true,
      filter: {
        type: 'select',
        options: [
          { label: 'Evet', value: 'evet' },
          { label: 'Hayır', value: 'hayır' }
        ]
      },
      render: (_v, row) => {
        const tarih = garantiBaslangici(row)
        return (
          <div>
            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold border ${
              row.isUnderWarranty
                ? 'bg-green-100 text-green-700 border-green-200'
                : 'bg-gray-100 text-gray-600 border-gray-200'
            }`}>
              {row.isUnderWarranty ? 'Evet' : 'Hayır'}
            </span>
            {row.isUnderWarranty && tarih ? (
              <div className="text-[10px] text-gray-500 mt-0.5 whitespace-nowrap">{tarih}</div>
            ) : null}
          </div>
        )
      }
    },

    {
      key: 'priority' as any,
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
      render: (_v, row) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${priorityConfig[row.priority]?.color ?? 'bg-gray-100 text-gray-700'}`}>
          {priorityConfig[row.priority]?.label ?? row.priorityLabel}
        </span>
      )
    },
    {
      key: 'assignedTechnicianName' as any,
      label: 'Teknisyen / Şoför',
      searchable: true,
      filter: {
        type: 'select',
        options: (technicians || []).map(t => ({ label: t.fullName || '', value: t.fullName || '' }))
      },
      render: (_v, row) => (
        <div>
          <div className="text-xs font-semibold text-gray-900">{row.assignedTechnicianName || row.technicianName || '-'}</div>
          {row.plannedAt && (
            <div className="text-[10px] text-gray-500 mt-0.5">
              Planlanan: {new Date(row.plannedAt).toLocaleDateString('tr-TR')}
            </div>
          )}
        </div>
      )
    },
    {
      key: 'status' as any,
      label: 'Durum',
      searchable: true,
      filter: {
        type: 'select',
        options: Object.entries(statusConfig).map(([k, cfg]) => ({ label: cfg.label, value: k.toLowerCase() }))
      },
      // Rozetin altındaki tarih de aranabilsin (2026-09-18).
      filterText: (row: any) =>
        `${statusConfig[row.status]?.label ?? row.statusLabel ?? ''} ${row.status ?? ''} ${durumTarihi(row)}`,
      render: (_v, row) => (
        <div className="whitespace-nowrap">
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusConfig[row.status]?.color ?? 'bg-gray-100 text-gray-700 border-gray-200'}`}>
            {statusConfig[row.status]?.label ?? row.statusLabel}
          </span>
          {/* DURUM TARİHİ: kayıt bu duruma ne zaman geçti (2026-09-18 kullanıcı isteği). */}
          {durumTarihi(row) && (
            <div className="text-[10px] font-semibold text-gray-500 mt-0.5">{durumTarihi(row)}</div>
          )}
        </div>
      )
    },
    {
      key: 'actions' as any,
      mobileFullWidth: true,
      label: 'İşlem',
      searchable: false,
      render: (_v, row) => {
        // Geçmiş ayrı bir yetki (`servisGecmisi`): kaydı görmek, kimin neyi ne zaman
        // değiştirdiğini görmeye yetmez. Yetkisi yoksa satır dropdown'a hiç girmez.
        const dropdownItems: any[] = canViewHistory
          ? [
              {
                key: 'info',
                label: 'Geçmişi Gör',
                onClick: () => openInfo(row.id)
              }
            ]
          : []

        if (activeTab === 'bekleyen') {
          if (hasPermission('atolyeAriza.islemKaydet')) {
            dropdownItems.push({
              key: 'process',
              label: 'İşlem Yap',
              onClick: () => openDetail(row)
            })
          }
        } else if (activeTab === 'aktif') {
          if (hasPermission('atolyeAriza.islemKaydet')) {
            dropdownItems.push({
              key: 'plan',
              label: 'Planla / Sevk Et',
              onClick: () => openPlanModal(row)
            })
            dropdownItems.push({
              key: 'return',
              label: 'Atölyeye Geri Al',
              onClick: () => {
                setSelectedRecord(row)
                setReturnTarget(row)
              }
            })
          }
        } else {
          if (hasPermission('atolyeAriza.islemKaydet')) {
            dropdownItems.push({
              key: 'process',
              label: 'İşlem Yap',
              onClick: () => openDetail(row)
            })
          }
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
  ], [activeTab, technicians, navigate, refetch, regions]).filter(c => c.key !== 'assignedTechnicianName' || activeTab === 'teslimat')

  const [erpProducts, setErpProducts] = useState<ErpProductDto[]>([])
  const [erpLoading, setErpLoading] = useState(true)
  const [erpError, setErpError] = useState<string | null>(null)
  useEffect(() => {
    let mounted = true
    setErpLoading(true)
    fetchErpProducts()
      .then((data) => {
        if (!mounted) return
        setErpProducts(data)
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

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    fetchStockItems()
      .then(setStockItems)
      .catch(() => setStockItems([]))
  }, [])

  const exportCsv = () => {
    const headers = ['arizaNo','kayitTarihi','musteri','telefon','urun','seriNo','bayi','bolge','teknisyen','oncelik','durum','aciklama']
    const escape = (v: any) => {
      const s = String(v ?? '')
      return /[\n\r",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [headers.join(';')]
    for (const r of records) {
      lines.push([
        r.serviceNumber,
        r.createdAt,
        r.customerName ?? '',
        r.customerPhone ?? '',
        r.productName,
        r.serialNumber ?? '',
        r.dealerName ?? '',
        r.regionName ?? '',
        r.assignedTechnicianName ?? '',
        r.priority,
        r.status,
        r.problemDescription ?? '',
      ].map(escape).join(';'))
    }
    const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ariza-listesi-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    const handleExport = () => exportCsv()
    window.addEventListener('shell:atolye-ariza-export', handleExport)
    return () => window.removeEventListener('shell:atolye-ariza-export', handleExport)
  }, [exportCsv])

  const repairRecords = useMemo(() => {
    const baseRecords = records.filter(r => r.status !== 'Delivered')

    if (q.trim()) return baseRecords
    if (activeTab === 'bekleyen') return baseRecords.filter(r => r.status === 'Workshop' || r.status === 'InRepair' || r.status === 'WaitingForParts' || r.status === 'Delayed')
    if (activeTab === 'aktif') return baseRecords.filter(r => r.status === 'Ready' || r.status === 'WorkshopReady' || r.status === 'DeliveryPlanning')
    return baseRecords.filter(r => r.status === 'InDelivery' || r.status === 'Planned')
  }, [records, activeTab, q])



  const [selectedId, setSelectedId] = useState<string>('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isEditingInfo, setIsEditingInfo] = useState(false)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editSerial, setEditSerial] = useState('')
  /*
    Atölye düzenleme formu yalnızca ad/telefon/adres/seri no tutuyordu; kalan alanlar
    kaydederken `selectedRecord`'tan aynen geri gönderiliyordu, yani ekrandan
    DEĞİŞTİRİLEMİYORDU. Kullanıcı 2026-08-31'de "tüm bilgilerin düzenlenmesi lazım"
    dedi — Saha ekranındaki alanların aynısı buraya da açıldı.
  */
  const [editProductName, setEditProductName] = useState('')
  const [editIsUnderWarranty, setEditIsUnderWarranty] = useState(false)
  const [editWarrantyStart, setEditWarrantyStart] = useState('')
  const [editPriority, setEditPriority] = useState('Normal')
  const [editProblemDescription, setEditProblemDescription] = useState('')
  const [editRegionId, setEditRegionId] = useState('')
  const { onayIste, onayPenceresi } = useOnay()

  const [selectedRecord, setSelectedRecord] = useState<any | null>(null)

function getSpecificDiagramNo(kod5?: string | null, targetProductCode?: string | null): string | null {
  if (!kod5) return null
  const k5 = String(kod5).trim()
  if (!k5) return null

  if (targetProductCode && (k5.includes(':') || k5.includes('|'))) {
    const items = k5.split('|').filter(Boolean)
    for (const item of items) {
      if (item.includes(':')) {
        const [pCode, pNo] = item.split(':')
        if (pCode.trim().toLowerCase() === targetProductCode.trim().toLowerCase()) {
          return pNo.trim()
        }
      }
    }
  }

  if (k5.includes('|')) {
    const firstPart = k5.split('|')[0]
    return firstPart.includes(':') ? firstPart.split(':')[1] : firstPart
  }

  return k5
}

  const [techStockItems, setTechStockItems] = useState<any[]>([])
  const [patlakSemaModalOpen, setPatlakSemaModalOpen] = useState(false)
  const [modalTab, setModalTab] = useState<'assigned' | 'all'>('assigned')
  const [modalSearchQuery, setModalSearchQuery] = useState('')
  const [modalImageZoom, setModalImageZoom] = useState(1.0)

  useEffect(() => {
    if (patlakSemaModalOpen) {
      fetchStockItems().then(setStockItems).catch(() => {})
    }
  }, [patlakSemaModalOpen])

  const availableSpareParts = useMemo(() => {
    const partsMap = new Map<string, { id: string; name: string; partNumber: string; quantity: number; unitPrice: number; parentStockCode: string; explodedViewPartNumber: string; source: string }>()

    // 1. Merkez stoktaki yedek parçaları ekle
    for (const item of stockItems) {
      if (item.type === 'SparePart') {
        const code = item.partNumber || item.id
        partsMap.set(code, {
          id: item.id,
          name: item.name,
          partNumber: item.partNumber || '',
          quantity: item.quantity ?? 0,
          unitPrice: (item as any).unitPrice ?? 0,
          parentStockCode: (item as any).parentStockCode || item.productId || '',
          explodedViewPartNumber: (item as any).explodedViewPartNumber || '',
          source: 'Merkez Depo'
        })
      }
    }

    // 2. Teknisyene atanmış araç deposu stoklarını ekle (öncelikli)
    if (techStockItems && techStockItems.length > 0) {
      for (const item of techStockItems) {
        const code = item.partNumber || item.id
        partsMap.set(code, {
          id: item.id,
          name: item.name,
          partNumber: item.partNumber || '',
          quantity: item.quantity ?? 0,
          unitPrice: (item as any).unitPrice ?? 0,
          parentStockCode: (item as any).parentStockCode || item.productId || '',
          explodedViewPartNumber: (item as any).explodedViewPartNumber || '',
          source: 'Teknisyen Araç Deposu'
        })
      }
    }

    return Array.from(partsMap.values())
  }, [stockItems, techStockItems])

  const currentProduct = useMemo(() => {
    if (!selectedRecord) return null
    const targetStockCode = String(selectedRecord.productStockCode || '').trim().toLowerCase()
    const targetName = String(selectedRecord.productName || selectedRecord.deviceModel || '').trim().toLowerCase()

    return stockItems.find(i =>
      i.type === 'Product' && (
        (targetStockCode && String(i.productId || i.partNumber || '').trim().toLowerCase() === targetStockCode) ||
        (targetName && String(i.productName || i.name || '').trim().toLowerCase() === targetName) ||
        (targetName && String(i.productName || i.name || '').trim().toLowerCase().includes(targetName)) ||
        (targetName && targetName.includes(String(i.productName || i.name || '').trim().toLowerCase()))
      )
    ) || null
  }, [selectedRecord, stockItems])

  const { assignedSpareParts, otherSpareParts } = useMemo(() => {
    function clean(s?: string | null): string {
      if (!s) return ''
      return String(s)
        .replace(/İ/g, 'i')
        .replace(/I/g, 'ı')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
    }

    const targetStockCodes = Array.from(new Set([
      currentProduct?.productId,
      currentProduct?.partNumber,
      selectedRecord?.productStockCode
    ].filter(Boolean).map(c => clean(String(c)))))

    const targetNames = Array.from(new Set([
      selectedRecord?.productName,
      selectedRecord?.deviceModel,
      currentProduct?.productName,
      currentProduct?.name
    ].filter(Boolean).map(c => clean(String(c)))))

    const assigned: typeof availableSpareParts = []
    const others: typeof availableSpareParts = []

    for (const part of availableSpareParts) {
      const parentCodes = String(part.parentStockCode || '')
        .split(/[,|;\s]+/)
        .map(clean)
        .filter(Boolean)

      const cleanExplodedStr = clean(part.explodedViewPartNumber)
      const cleanPartNo = clean(part.partNumber)
      const cleanPartName = clean(part.name)

      let isLinked = false

      // 1. Stock Code Match (Highest Priority)
      if (targetStockCodes.length > 0 && parentCodes.length > 0) {
        for (const tc of targetStockCodes) {
          if (tc && parentCodes.some(pc => pc === tc || (pc.length >= 3 && tc.includes(pc)) || (tc.length >= 3 && pc.includes(tc)))) {
            isLinked = true
            break
          }
        }
      }

      // 2. Exploded Diagram Position / Diagram code match
      if (!isLinked && cleanExplodedStr && targetStockCodes.length > 0) {
        for (const tc of targetStockCodes) {
          if (tc && tc.length >= 3 && cleanExplodedStr.includes(tc)) {
            isLinked = true
            break
          }
        }
      }

      // 3. Product Name Match Fallback
      if (!isLinked && targetNames.length > 0) {
        for (const tn of targetNames) {
          if (tn && tn.length >= 3) {
            if (parentCodes.some(pc => pc && pc.length >= 3 && tn.includes(pc))) {
              isLinked = true
              break
            }
          }
        }
      }

      if (isLinked) {
        assigned.push(part)
      } else {
        others.push(part)
      }
    }

    return { assignedSpareParts: assigned, otherSpareParts: others }
  }, [availableSpareParts, currentProduct, selectedRecord])

const SERVICE_CURRENCY_OPTIONS = [
  { value: 1, label: 'TL (₺)', symbol: '₺', code: 'TRY' },
  { value: 3, label: 'USD ($)', symbol: '$', code: 'USD' },
  { value: 2, label: 'EUR (€)', symbol: '€', code: 'EUR' },
  { value: 4, label: 'GBP (£)', symbol: '£', code: 'GBP' }
]

  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  const [statusValue, setStatusValue] = useState<string>('New')
  const [statusNote, setStatusNote] = useState<string>('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [invoicePrice, setInvoicePrice] = useState<string>('')
  const [invoiceCurrencyTypeId, setInvoiceCurrencyTypeId] = useState<number>(1)

  const [infoPopupId, setInfoPopupId] = useState<string | null>(null)
  const [photoLightboxUrl, setPhotoLightboxUrl] = useState<string | null>(null)

  /**
   * "i" düğmesi. Veriyi ARTIK ÇEKMİYOR: modal (ServisGecmisiModal) kaydı ve zaman
   * çizelgesini kendisi yüklüyor. Burada ikinci kez çekmek aynı iki isteği boşuna
   * tekrarlıyor ve iki ayrı yerde biçimlendirilmiş iki tarihçe üretiyordu.
   */
  const openInfo = (id: string) => {
    setInfoPopupId(id)
  }

  const parsePartsFromNotes = (notesOrTimeline: any[]) => {
    if (!notesOrTimeline || notesOrTimeline.length === 0) return []
    const partsNote = notesOrTimeline.find((n: any) => {
      const text = String(n.content || n.note || n.description || '').toLowerCase()
      return text.includes('kullanılan parçalar:') || text.includes('kullanilan parcalar:')
    })
    if (!partsNote) return []

    const content = String(partsNote.content || partsNote.note || partsNote.description || '')
    const matchSection = content.split(/kullanılan parçalar:|kullanilan parcalar:/i)[1]?.split('|')[0]?.split(';')[0]?.trim() || ''
    if (!matchSection) return []

    const regex = /([^,\[]+?)(?:\s*\[(Garantili|Bedelsiz)\])?\s*\(Adet:\s*(\d+)\)/gi
    let m
    const result: any[] = []

    while ((m = regex.exec(matchSection)) !== null) {
      const partName = m[1].trim()
      const isWarranty = Boolean(m[2])
      const quantity = parseInt(m[3], 10) || 1

      const matched = stockItems.find(p => 
        p.name.trim().toLowerCase() === partName.toLowerCase() ||
        (p.partNumber && p.partNumber.trim().toLowerCase() === partName.toLowerCase())
      )

      if (matched) {
        result.push({
          id: matched.id,
          name: matched.name,
          partNumber: matched.partNumber || '',
          quantity,
          unitPrice: isWarranty ? 0 : (matched.unitPrice || 0),
          isWarranty
        })
      } else {
        result.push({
          id: `custom-${Math.random()}`,
          name: partName,
          partNumber: '',
          quantity,
          unitPrice: 0,
          isWarranty
        })
      }
    }

    return result
  }

  const openPlanModal = (record?: any, overrideParts?: any[]) => {
    const rec = record || selectedRecord
    if (rec) {
      setSelectedRecord(rec)
      setDeliveryTechId(rec.assignedTechnicianId || '')
      setPlannedDate(rec.plannedAt ? String(rec.plannedAt).slice(0, 10) : new Date().toISOString().slice(0, 10))
      setPlanAddress(rec.customerAddress || '')
      setPlanRegionId(rec.regionId || '')
      setPlanCustomerName(rec.customerName || '')
      setPlanCustomerPhone(rec.customerPhone || '')
    }

    let partsToUse = overrideParts && overrideParts.length > 0 ? overrideParts : [...selectedParts]
    if (partsToUse.length === 0 && rec) {
      // infoTimeline YEDEĞİ KALDIRILDI: o durum en son "i" tıklanan kayda aitti, bu kayda
      // değil — başka bir servisin parçaları bu planlamaya taşınabiliyordu.
      const notesList = rec.notes || rec.timeline || []
      partsToUse = parsePartsFromNotes(notesList)
    }

    setPlanParts(partsToUse)
    const labor = invoicePrice !== '' ? invoicePrice : (rec ? (getRecordPrice(rec) > 0 ? String(getRecordPrice(rec)) : '') : '')
    setPlanLaborFee(labor)
    setPlanModalOpen(true)
  }

  const openDetail = (record: any, initialStatus?: string) => {
    setSelectedId(record.id)
    setSelectedRecord(record)
    setPlannedDate(record.plannedAt ? String(record.plannedAt).slice(0, 10) : new Date().toISOString().slice(0, 10))
    setDeliveryTechId(record.assignedTechnicianId || '')

    const parsedExistingParts = parsePartsFromNotes(record.notes || record.timeline || [])
    setSelectedParts(parsedExistingParts)

    if (activeTab === 'aktif') {
      setDrawerOpen(false)
      openPlanModal(record, parsedExistingParts)
      return
    }

    setStatusValue(initialStatus ?? record.status ?? 'New')
    setStatusNote('')
    setSelectedFiles([])
    setInvoicePrice('')
    setInvoiceCurrencyTypeId(1)
    setActionError(null)
    setActionSuccess(null)
    const techId = record.assignedTechnicianId || ''
    setDeliveryTechId(techId)
    setPlannedDate(record.plannedAt ? String(record.plannedAt).slice(0, 10) : new Date().toISOString().slice(0, 10))
    setIsEditingInfo(false)
    setEditName(record.customerName || '')
    setEditPhone(record.customerPhone || '')
    setEditAddress(record.customerAddress || '')
    setEditSerial(record.serialNumber || '')
    setEditProductName(record.productName || '')
    setEditIsUnderWarranty(!!record.isUnderWarranty)
    setEditWarrantyStart(garantiBaslangiciInput(record) || '')
    setEditPriority(record.priority || 'Normal')
    setEditProblemDescription(record.problemDescription || '')
    setEditRegionId(record.regionId ? String(record.regionId) : '')

    // Teknisyen deposundaki stokları yükle
    const fetchTechId = record.assignedTechnicianId || techId
    if (fetchTechId) {
      apiJson<{ success: boolean; data: any[] }>(`/api/erp/admin/technician-stock/${fetchTechId}`)
        .then(res => {
          if (res?.success && Array.isArray(res.data)) {
            setTechStockItems(res.data)
          } else {
            setTechStockItems([])
          }
        })
        .catch(() => setTechStockItems([]))
    }

    setDrawerOpen(true)
  }

  /**
   * Atölyeye geri alma.
   *
   * Buton "Stok & Fiyat Sıfırla" diyordu ama sunucuda HİÇBİR ŞEY sıfırlamıyordu: yalnızca dört
   * yerel React state'i temizleniyor, onlar da bir sonraki `refetch` ile zaten yeniden doluyordu.
   * Asıl sorun bu değildi — asıl sorun FATURA İŞARETİYDİ.
   *
   * Teslimat planlanırken `create-service-invoice` kaydı `IsInvoiced = true` diye sahipleniyor.
   * Geri alma bu işareti temizlemediği için kayıt "zaten faturalanmış" kalıyordu; kullanıcı
   * ücreti/parçaları düzeltip yeniden planladığında uç `alreadyInvoiced: true` ile ESKİ sipariş
   * numarasını döndürüyor, yeni tutar cariye HİÇ işlenmiyordu. Üstelik istemci bunu başarı
   * sayıyordu. "Girilen para satış faturasına düşmüyor" şikayetinin kalıcı hâli buydu.
   */
  const handleReturnToWorkshop = async (record: any) => {
    if (!record) return

    setActionLoading(true)
    setActionError(null)
    setActionSuccess(null)
    try {
      // ÖNCE fatura taslağı iptal edilir. Başarısız olursa geri alma YAPILMAZ: aksi halde kayıt
      // atölyeye döner ama bir daha faturalanamaz duruma düşer.
      await apiJson(`/api/erp/invoices/cancel-service-invoice-by-record/${record.id}`, {
        method: 'DELETE',
      })

      await updateStatus(record.id, 'Workshop', 'Atölyeye geri alındı; fatura taslağı iptal edildi.')
      await apiJson(`/api/servicerecords/${record.id}/assign`, {
        method: 'POST',
        body: JSON.stringify({ technicianId: null })
      }).catch(() => {})

      setInvoicePrice('')
      setInvoiceCurrencyTypeId(1)
      setSelectedParts([])
      setPlanParts([])
      setPlanLaborFee('')
      setDrawerOpen(false)
      setReturnTarget(null)
      setActionSuccess('Kayıt atölyeye geri alındı, fatura taslağı iptal edildi. Ücret ve parçalar yeniden girilebilir.')
      await refetch()
    } catch (e: any) {
      setActionError(
        `Atölyeye geri alınamadı: ${String(e?.message ?? 'bilinmeyen hata')}. ` +
        `Fatura taslağı iptal edilemediği için kayıt olduğu yerde bırakıldı.`
      )
    } finally {
      setActionLoading(false)
    }
  }

  const handleSaveStatus = async () => {
    if (!selectedRecord) return
    setActionLoading(true)
    setActionError(null)
    setActionSuccess(null)
    try {
      const infoChanged =
        editName.trim() !== (selectedRecord.customerName || '').trim() ||
        editPhone.trim() !== (selectedRecord.customerPhone || '').trim() ||
        editAddress.trim() !== (selectedRecord.customerAddress || '').trim() ||
        editSerial.trim() !== (selectedRecord.serialNumber || '').trim() ||
        editProductName.trim() !== (selectedRecord.productName || '').trim() ||
        editIsUnderWarranty !== !!selectedRecord.isUnderWarranty ||
        editWarrantyStart !== (garantiBaslangiciInput(selectedRecord) || '') ||
        editPriority !== (selectedRecord.priority || 'Normal') ||
        editProblemDescription.trim() !== (selectedRecord.problemDescription || '').trim() ||
        editRegionId !== (selectedRecord.regionId ? String(selectedRecord.regionId) : '')

      if (isEditingInfo || infoChanged) {
        if (!editName.trim()) {
          setActionError('Müşteri adı zorunludur.')
          setActionLoading(false)
          return
        }
        if (!editPhone.trim()) {
          setActionError('Müşteri telefonu zorunludur.')
          setActionLoading(false)
          return
        }
        if (!editAddress.trim()) {
          setActionError('Müşteri adresi zorunludur.')
          setActionLoading(false)
          return
        }
        if (!editSerial.trim()) {
          setActionError('Seri numarası zorunludur.')
          setActionLoading(false)
          return
        }
        if (!editProductName.trim()) {
          setActionError('Cihaz / Ürün adı zorunludur.')
          setActionLoading(false)
          return
        }

        await apiJson(`/api/servicerecords/${selectedRecord.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            type: selectedRecord.type || 'Repair',
            customerName: editName,
            customerPhone: editPhone,
            customerAddress: editAddress,
            productName: editProductName,
            serialNumber: editSerial,
            receivingNote: selectedRecord.receivingNote || undefined,
            isUnderWarranty: editIsUnderWarranty,
            // Alan adı Saha ekranıyla AYNI olmak zorunda: uç `warrantyStartDate` bekliyor.
            warrantyStartDate: editIsUnderWarranty ? (editWarrantyStart || '') : '',
            dealerName: selectedRecord.dealerName || undefined,
            problemDescription: editProblemDescription || undefined,
            priority: editPriority,
            regionId: editRegionId || undefined,
            plannedDate: selectedRecord.plannedAt || undefined
          })
        })
        setIsEditingInfo(false)
      }

      let targetStatus = statusValue
      let finalStatusNote = statusNote || undefined
      
      // Append spare parts to note
      if ((activeTab === 'bekleyen' || activeTab === 'aktif') && selectedParts.length > 0) {
        const partsText = selectedParts.map(p => `${p.name}${p.isWarranty ? ' [Garantili]' : ''} (Adet: ${p.quantity})`).join(', ')
        finalStatusNote = statusNote 
          ? `${statusNote} | Kullanılan Parçalar: ${partsText}`
          : `Kullanılan Parçalar: ${partsText}`
      }

      const sym = SERVICE_CURRENCY_OPTIONS.find(c => c.value === invoiceCurrencyTypeId)?.symbol ?? '₺'
      const priceVal = parseFloat(invoicePrice)
      if ((targetStatus === 'Ready' || targetStatus === 'Delivered') && !isNaN(priceVal) && priceVal > 0) {
        finalStatusNote = finalStatusNote 
          ? `${finalStatusNote} | Fatura Bedeli: ${sym}${priceVal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`
          : `Fatura Bedeli: ${sym}${priceVal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`
      }

      if (activeTab === 'aktif' && plannedDate && deliveryTechId) {
        await plan(selectedRecord.id, {
          plannedDate: new Date(plannedDate).toISOString(),
          technicianId: deliveryTechId,
          status: 'InDelivery'
        })
        targetStatus = 'InDelivery'
        finalStatusNote = finalStatusNote 
          ? `${finalStatusNote} (Teslimat planlandı.)`
          : 'Teslimat planlandı.'
      } else if (activeTab === 'teslimat' && statusValue === 'Ready') {
        // Reset planning / clear driver
        await apiJson(`/api/servicerecords/${selectedRecord.id}/assign`, {
          method: 'POST',
          body: JSON.stringify({ technicianId: null })
        }).catch(() => {})

        await plan(selectedRecord.id, {
          plannedDate: null,
          technicianId: null
        }).catch(() => {})

        targetStatus = 'Ready'
        finalStatusNote = 'Teslimat planlaması iptal edildi, kayıt hazıra geri alındı.'
      } else if (activeTab === 'teslimat' && deliveryTechId) {
        // Change driver
        await assignTechnician(selectedRecord.id, deliveryTechId)
      }

      await updateStatus(selectedRecord.id, targetStatus, finalStatusNote)

      const uploadList = photoSlots.filter(Boolean).length > 0 ? (photoSlots.filter(Boolean) as File[]) : selectedFiles
      if (uploadList.length > 0) {
        const token = getAccessToken()
        for (const file of uploadList) {
          const formData = new FormData()
          formData.append('file', file)
          const uploadRes = await fetch(`${API_BASE_URL}/api/servicerecords/${selectedRecord.id}/photo`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData
          })
          if (!uploadRes.ok) {
            const errText = await uploadRes.text()
            throw new Error(errText || 'Fotoğraf yüklenemedi.')
          }
        }
      }
      setSelectedRecord((prev: any) => prev ? { ...prev, status: targetStatus, statusLabel: statusConfig[targetStatus]?.label || targetStatus } : null)
      setActionSuccess('Durum başarıyla kaydedildi.')
      setStatusNote('')
      setInvoicePrice('')
      setSelectedParts([])
      setDrawerOpen(false)
      await refetch()
    } catch (e: any) {
      setActionError(String(e?.message ?? 'Durum güncellenemedi'))
    } finally {
      setActionLoading(false)
    }
  }

  /**
   * TESLİMAT PLANLAMA MODALININ ORTAK İŞİ (2026-08-28).
   *
   * Beyaz eşya tarafıyla (`SahaArizaPage.teslimatiIsle`) AYNI kurgu; kullanıcı iki ekranın
   * aynı davranmasını istedi. İki düğme de buraya bağlı:
   *
   *   'Planned'   → TESLİMATA AKTAR. Teslimat günü ve teknisyeni zorunlu; kayıt
   *                 Teslimattakiler sekmesine düşer.
   *   'Delivered' → DOĞRUDAN GERÇEKLEŞTİ. Teslimat adımı hiç yaşanmaz; kayıt kapanır.
   *                 Gün ve teknisyen aranmaz — planlanan bir teslimat yok.
   *
   * FATURA KURALI İKİ YOLDA DA AYNI ve değişmedi: `faturalanacakVar` — işçilik bedeli ya da
   * faturaya girecek kalem varsa satış faturası taslağı oluşur; bedelsiz iş ERP'ye HİÇ
   * gitmez (yoksa uç 400 dönüp bütün akışı düşürüyordu, bkz. utils/fatura.ts).
   *
   * Gövde kopyalanmadı: iki ayrı kopya zamanla ayrışır ve düzeltme birinde yapılıp
   * diğerinde unutulurdu — bu iki sayfada tam olarak bu yaşandı.
   */
  const teslimatiIsle = async (hedefDurum: 'Planned' | 'Delivered') => {
    // Tarih/teknisyen YALNIZCA teslimata aktarmada zorunlu; dogrudan gerceklesmis bir iste
    // planlanacak bir teslimat yok.
    if (hedefDurum === 'Planned' && (!plannedDate || !deliveryTechId)) {
      toast.error('Lütfen teslimat tarihi ve teslimat teknisyenini seçiniz.')
      return
    }
    setActionLoading(true)
    try {
      const infoChanged =
        planAddress.trim() !== (selectedRecord.customerAddress || '').trim() ||
        planRegionId.trim() !== (selectedRecord.regionId || '').trim() ||
        planCustomerName.trim() !== (selectedRecord.customerName || '').trim() ||
        planCustomerPhone.trim() !== (selectedRecord.customerPhone || '').trim()

      if (infoChanged) {
        if (!planCustomerName.trim()) {
          toast.error('Müşteri adı zorunludur.')
          setActionLoading(false)
          return
        }
        if (!planCustomerPhone.trim()) {
          toast.error('Müşteri telefonu zorunludur.')
          setActionLoading(false)
          return
        }
        if (!planAddress.trim()) {
          toast.error('Müşteri adresi zorunludur.')
          setActionLoading(false)
          return
        }
        await apiJson(`/api/servicerecords/${selectedRecord.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            type: selectedRecord.type || 'Repair',
            customerName: planCustomerName,
            customerPhone: planCustomerPhone,
            customerAddress: planAddress,
            productName: selectedRecord.productName,
            serialNumber: selectedRecord.serialNumber,
            receivingNote: selectedRecord.receivingNote || undefined,
            isUnderWarranty: selectedRecord.isUnderWarranty,
            dealerName: selectedRecord.dealerName || undefined,
            problemDescription: selectedRecord.problemDescription || undefined,
            priority: selectedRecord.priority,
            regionId: planRegionId || undefined,
            plannedDate: selectedRecord.plannedAt || undefined
          })
        })
      }
      const laborPriceVal = parseFloat(planLaborFee) || 0
      const itemsToSend = planParts.map(p => ({
        stockCode: p.partNumber || p.id,
        description: p.name,
        quantity: p.quantity,
        price: p.isWarranty ? 0 : p.unitPrice,
        isWarranty: p.isWarranty
      }))

      const billableItemsCount = itemsToSend.filter(x => !x.isWarranty && x.price > 0).length
      const totalInvoiceValue = itemsToSend
        .filter(x => !x.isWarranty)
        .reduce((sum, x) => sum + (x.price * x.quantity), 0) + laborPriceVal

      const effectiveLaborPrice = laborPriceVal > 0 ? laborPriceVal : getRecordPrice(selectedRecord)
      let generatedOrderNo = ''
      let invoiceError = ''
      const invoiceCustomerCode = getDealerCode(selectedRecord)
      const faturalikVar = faturalanacakVar(effectiveLaborPrice, itemsToSend)

      /*
        PARASI OLAN İŞ CARİSİZ KAPANMAZ (2026-08-31 canlı olay: AT-0000817, ₺650).

        Eskiden cari yoksa fatura atlanıyor, TESLİMAT YİNE TAMAMLANIYORDU. Ekrana bir uyarı
        düşüyordu ama iş kapandığı için kolayca gözden kaçıyor; sonuç: iş bitmiş görünüyor,
        parası hiç alınmamış oluyor. Canlıda tam olarak bu yaşandı — kayıt "Teslim Edildi"
        durumundaydı, ERP'de karşılığı yoktu.

        Kapı BİLEREK dar: yalnızca FATURALANACAK bir tutar varken cari şart. Garanti/bedelsiz
        işlerin carisi olmayabilir ve onların teslimi engellenmemeli — sistemde öyle üç kayıt
        var (AT-0000047, SH-0000030, SH-0000031) ve faturasız olmaları doğru.

        Cariyi düzeltmenin yolu: kaydı açıp bayi/cari alanını listeden seçmek. Serbest metin
        girişi kabul ekranında kapatıldı, yani yeni kayıtlar buraya düşmeyecek.
      */
      if (faturalikVar && !invoiceCustomerCode) {
        setActionError(
          'Bu işin faturalanacak bedeli var ama kaydın CARİSİ YOK — teslim tamamlanmadı. ' +
          'Kaydı açıp bayi/cari bilgisini listeden seçin, sonra tekrar deneyin. ' +
          'Aksi hâlde iş kapanır ama parası cariye hiç işlenmez.'
        )
        setActionLoading(false)
        return
      }

      try {
        // Bedelsiz iş faturaya gitmez; bkz. utils/fatura.ts
        if (faturalikVar) {
        const erpRes = await apiJson<any>('/api/erp/invoices/create-service-invoice', {
          method: 'POST',
          body: JSON.stringify({
            customerCode: invoiceCustomerCode,
            productName: selectedRecord.productName,
            price: effectiveLaborPrice,
            currencyTypeId: invoiceCurrencyTypeId,
            items: itemsToSend,
            serviceRecordId: String(selectedRecord.id),
            serviceNumber: String(selectedRecord.serviceNumber || ''),
            sourcePage: 'KucukUrunTeslimat'
          })
        })
        generatedOrderNo = erpRes?.data?.orderNo || ''
        }
      } catch (err: any) {
        console.error('Invoice creation failed:', err)
        invoiceError = String(err?.message ?? 'bilinmeyen hata')
      }

      // Dogrudan gerceklestide teslimat plani olusturulmaz: kayit Teslimattakiler
      // sekmesine hic dusmez, oldugu yerde kapanir.
      if (hedefDurum === 'Planned') {
        await plan(selectedRecord.id, {
          plannedDate: new Date(plannedDate).toISOString(),
          technicianId: deliveryTechId,
          status: 'Planned'
        })
      }

      const sym = SERVICE_CURRENCY_OPTIONS.find(c => c.value === invoiceCurrencyTypeId)?.symbol ?? '₺'
      const varsayilanNot = hedefDurum === 'Planned'
        ? 'Teslimat planlandı ve rotaya eklendi.'
        : 'Teslimata aktarılmadan doğrudan gerçekleşti olarak kapatıldı.'
      let noteMsg = statusNote
        ? `${hedefDurum === 'Planned' ? 'Teslimat Planlandı' : 'Gerçekleşti'}: ${statusNote}`
        : varsayilanNot
      if (totalInvoiceValue > 0) {
        noteMsg += ` | Toplam Fatura Bedeli: ${sym}${totalInvoiceValue.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}${generatedOrderNo ? ` (Sipariş No: ${generatedOrderNo})` : ''}`
      }

      await updateStatus(selectedRecord.id, hedefDurum, noteMsg)

      if (selectedFiles.length > 0) {
        const token = getAccessToken()
        for (const file of selectedFiles) {
          const formData = new FormData()
          formData.append('file', file)
          await fetch(`${API_BASE_URL}/api/servicerecords/${selectedRecord.id}/photo`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData
          }).catch(() => {})
        }
      }

      setPlanModalOpen(false)
      setDrawerOpen(false)
      setSelectedFiles([])
      setStatusNote('')
      setInvoicePrice('')
      // Bildirim iki yolda da AYNI kurala uyar: ne oldu + faturaya ne işlendi.
      const yapilanIs = hedefDurum === 'Planned' ? 'Teslimat planlandı' : 'İş gerçekleşti olarak kapatıldı'
      if (invoiceError) {
        setActionError(
          `${yapilanIs} ANCAK satış faturası oluşturulamadı: ${invoiceError} — ` +
          `girilen ücret ve yedek parçalar cariye İŞLENMEDİ.`
        )
      } else if (generatedOrderNo) {
        setActionSuccess(`${yapilanIs} ve B2B Satış Faturası taslağı (Sipariş No: ${generatedOrderNo}) oluşturuldu.`)
      } else if (totalInvoiceValue > 0) {
        setActionError(`${yapilanIs} ancak satış faturası numarası dönmedi — cariye işlendiğini doğrulayın.`)
      } else {
        setActionSuccess(hedefDurum === 'Planned'
          ? 'Teslimat planlandı ve Teslimattakiler sekmesine aktarıldı.'
          : 'İş gerçekleşti olarak kapatıldı (bedelsiz olduğu için fatura oluşturulmadı).')
      }
      await refetch()
      if (plannedDate) await fetchTechWorkloads(plannedDate)
    } catch (e: any) {
      toast.error(e?.message || (hedefDurum === 'Planned' ? 'Planlama yapılamadı.' : 'İş kapatılamadı.'))
    } finally {
      setActionLoading(false)
    }
  }


  return (
    <>


      <div className="p-4 lg:p-6 flex flex-col gap-4">
        {/* Active Records */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-visible relative [--table-sticky-top:64px] lg:[--table-sticky-top:54px]">
        {error ? (
          <div className="py-8 text-center text-sm text-red-650">{error}</div>
        ) : isLoading && repairRecords.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">Yükleniyor...</div>
        ) : repairRecords.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">Kayıt bulunamadı.</div>
        ) : (
          <Table
            columns={columns}
            data={repairRecords}
            showColumnFilters
            serverSide={false}
            onFilteredDataChange={setFilteredRows}
            rowKey={(r) => r.id}
          />
        )}
      </div>

      {/* Detail Drawer */}
      {drawerOpen && selectedRecord && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDrawerOpen(false)} />
          <div className="fixed right-0 top-0 bottom-0 pt-safe pb-safe w-full max-w-lg bg-white z-50 shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300">
            <div className="p-4 sm:p-6 border-b border-gray-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-gray-900">Arıza Detayı</h2>
                <span className={`px-2 py-1 rounded text-xs font-medium ${priorityConfig[selectedRecord.priority]?.color ?? 'bg-gray-100 text-gray-700'}`}>
                  {priorityConfig[selectedRecord.priority]?.label ?? selectedRecord.priorityLabel}
                </span>
              </div>
              <button onClick={() => setDrawerOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-6">
              {/* Premium Customer & Product Details Card */}
              <div className="bg-gray-50 rounded-xl p-5 border border-gray-150 space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between pb-3 border-b border-gray-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-600 to-red-700 flex items-center justify-center text-white font-semibold shadow-sm text-sm">
                      {(editName || selectedRecord.customerName || '-').split(' ').filter(Boolean).slice(0, 2).map((n: string) => n[0]).join('') || '--'}
                    </div>
                    <div>
                      <div className="font-bold text-gray-900 text-sm">{editName || selectedRecord.customerName || '-'}</div>
                      <div className="text-xs font-semibold text-red-600 font-mono mt-0.5">{selectedRecord.serviceNumber}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingInfo(!isEditingInfo)}
                    className="px-2.5 py-1 bg-white border border-gray-200 rounded text-xs font-semibold text-gray-700 hover:bg-gray-50 flex items-center gap-1 cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    {isEditingInfo ? 'Vazgeç' : 'Düzenle'}
                  </button>
                </div>

                {isEditingInfo ? (
                  /* Edit Inputs */
                  <div className="grid grid-cols-1 gap-3 text-xs">
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold text-gray-500">Müşteri Ad Soyad <span className="text-red-500">*</span></span>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(toTurkishUpper(e.target.value))}
                        className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold text-gray-500">Müşteri Telefon <span className="text-red-500">*</span></span>
                      <input
                        type="text"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold text-gray-500">Müşteri Adres <span className="text-red-500">*</span></span>
                      <textarea
                        value={editAddress}
                        onChange={(e) => setEditAddress(e.target.value)}
                        className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs w-full h-16 resize-none focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold text-gray-500">Bölge</span>
                      <select
                        value={editRegionId}
                        onChange={(e) => setEditRegionId(e.target.value)}
                        className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                      >
                        <option value="">Bölge Seçiniz...</option>
                        {regions.map((r: any) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>

                    {/*
                      Ürün listeden seçilir; serbest yazımda aynı cihaz üç farklı isimle
                      kaydediliyordu. ERP listesi gelmezse alttaki kutu elle düzeltmeye izin
                      verir — yoksa liste boşken ürün adı hiç değiştirilemezdi.
                    */}
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold text-gray-500">Cihaz / Ürün Adı <span className="text-red-500">*</span></span>
                      <SearchableProductSelect
                        products={erpProducts.map((p) => ({ id: p.id, name: p.name, code: p.stockCode }))}
                        value={editProductName}
                        onChange={(v) => setEditProductName(v)}
                        placeholder="Ürün seçin veya arayın..."
                      />
                      {/*
                        Elle yazma kutusu SADECE ERP listesi hiç gelmediğinde açılır. Kullanıcı
                        "ürünü seçebilmem lazım, yazmam değil" dedi; ama liste boşken kutu da
                        olmazsa ürün adı düzeltilemez hale gelirdi.
                      */}
                      {erpProducts.length === 0 && (
                        <input
                          type="text"
                          value={editProductName}
                          onChange={(e) => setEditProductName(e.target.value)}
                          placeholder="Ürün listesi yüklenemedi — elle yazın"
                          className="px-3 py-1.5 bg-white border border-amber-300 bg-amber-50 rounded-lg text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                        />
                      )}
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="font-semibold text-gray-500">Seri Numarası <span className="text-red-500">*</span></span>
                      <input
                        type="text"
                        value={editSerial}
                        onChange={(e) => setEditSerial(toTurkishUpper(e.target.value))}
                        className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs w-full font-mono focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="font-semibold text-gray-500">Garanti Durumu</span>
                      <label className="flex items-center gap-2 mt-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editIsUnderWarranty}
                          onChange={(e) => {
                            setEditIsUnderWarranty(e.target.checked)
                            if (!e.target.checked) setEditWarrantyStart('')
                          }}
                          className="rounded text-[#B91C1C] focus:ring-[#B91C1C]"
                        />
                        <span className="text-xs text-gray-700 font-medium">Garanti Kapsamında</span>
                      </label>
                      <input
                        type="date"
                        disabled={!editIsUnderWarranty}
                        value={editWarrantyStart}
                        onChange={(e) => setEditWarrantyStart(e.target.value)}
                        title="Garanti Başlangıç Tarihi"
                        className="mt-1 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C] disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="font-semibold text-gray-500">Öncelik</span>
                      <select
                        value={editPriority}
                        onChange={(e) => setEditPriority(e.target.value)}
                        className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                      >
                        <option value="Low">Düşük</option>
                        <option value="Normal">Normal</option>
                        <option value="High">Acil</option>
                        <option value="Critical">Kritik</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="font-semibold text-gray-500">Arıza / Şikayet Açıklaması</span>
                      <textarea
                        value={editProblemDescription}
                        onChange={(e) => setEditProblemDescription(e.target.value)}
                        className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs w-full h-20 resize-none focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                      />
                    </div>
                  </div>
                ) : (
                  /* View Mode */
                  <div className="grid grid-cols-1 gap-3 text-xs">
                    {/* Customer Name */}
                    <div className="flex justify-between items-center py-1 border-b border-gray-100">
                      <span className="font-semibold text-gray-500">Müşteri Adı:</span>
                      <span className="font-semibold text-gray-800">{selectedRecord.customerName || '-'}</span>
                    </div>

                    {/* Phone */}
                    {selectedRecord.customerPhone && (
                      <div className="flex justify-between items-center py-1 border-b border-gray-100">
                        <span className="font-semibold text-gray-500">Müşteri Telefon:</span>
                        <span className="font-semibold text-gray-800 flex items-center gap-1">
                          <PhoneLinks phone={selectedRecord.customerPhone} compact />
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(selectedRecord.customerPhone || '')
                              toast.success('Telefon kopyalandı!')
                            }}
                            className="text-gray-400 hover:text-gray-650 p-0.5 cursor-pointer"
                            title="Telefonu Kopyala"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
                          </button>
                        </span>
                      </div>
                    )}

                    {/* Address */}
                    {selectedRecord.customerAddress && (
                      <div className="flex flex-col gap-1 py-1 border-b border-gray-100">
                        <span className="font-semibold text-gray-500">Müşteri Adres:</span>
                        <span className="text-gray-800 font-medium leading-relaxed">{selectedRecord.customerAddress}</span>
                      </div>
                    )}

                    {/* Product */}
                    <div className="flex justify-between items-center py-1 border-b border-gray-100">
                      <span className="font-semibold text-gray-500">Cihaz / Ürün:</span>
                      <span className="font-bold text-gray-800">{selectedRecord.productName}</span>
                    </div>

                    {/* Serial Number */}
                    <div className="flex justify-between items-center py-1 border-b border-gray-100">
                      <span className="font-semibold text-gray-500">Seri No:</span>
                      <span className="font-mono text-gray-800 font-semibold">{selectedRecord.serialNumber || '-'}</span>
                    </div>

                    {/* Warranty */}
                    <div className="flex justify-between items-center py-1 border-b border-gray-100">
                      <span className="font-semibold text-gray-500">Garanti Durumu:</span>
                      <span className="inline-flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${selectedRecord.isUnderWarranty ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {selectedRecord.isUnderWarranty ? 'Evet' : 'Hayır'}
                        </span>
                        {selectedRecord.isUnderWarranty && garantiBaslangici(selectedRecord) ? (
                          <span className="text-[10px] text-gray-500">{garantiBaslangici(selectedRecord)}</span>
                        ) : null}
                      </span>
                    </div>

                    {/* Dealer / Bayi */}
                    {selectedRecord.dealerName && (
                      <div className="flex justify-between items-center py-1 border-b border-gray-100">
                        <span className="font-semibold text-gray-500">Bayi / Servis:</span>
                        <span className="font-semibold text-gray-800">{selectedRecord.dealerName}</span>
                      </div>
                    )}

                    {/* Problem Description */}
                    {selectedRecord.problemDescription && (
                      <div className="flex flex-col gap-1 py-1 border-b border-gray-100">
                        <span className="font-semibold text-red-650">Arıza / Şikayet:</span>
                        <span className="text-gray-800 font-semibold leading-relaxed bg-red-50/50 p-2 rounded border border-red-100/50">{selectedRecord.problemDescription}</span>
                      </div>
                    )}

                    {/* Receiving Note */}
                    {selectedRecord.receivingNote && (
                      <div className="flex flex-col gap-1 py-1">
                        <span className="font-semibold text-gray-500">Kabul Notu (Açıklama):</span>
                        <span className="text-gray-700 font-medium leading-relaxed bg-gray-100 p-2 rounded">{selectedRecord.receivingNote}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {actionSuccess ? (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-xs font-semibold text-green-700">{actionSuccess}</div>
              ) : null}
              {actionError ? (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs font-semibold text-red-600">{actionError}</div>
              ) : null}

              <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
                <div className="text-xs font-semibold text-gray-500">Durum</div>
                <select value={statusValue} onChange={(e) => setStatusValue(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full">
                  {activeTab === 'bekleyen' && (
                    <>
                      <option value="Workshop">Atölyede</option>
                      <option value="InRepair">Tamirde</option>
                      <option value="WaitingForParts">Parça Bekliyor</option>
                      <option value="Ready">Hazır</option>
                      <option value="WorkshopReady">Atölye Hazır</option>
                      <option value="Delayed">Gecikti</option>
                      <option value="Cancelled">İptal</option>
                    </>
                  )}
                  {activeTab === 'aktif' && (
                    <>
                      <option value="Ready">Hazır</option>
                      <option value="WorkshopReady">Atölye Hazır</option>
                      <option value="Workshop">Atölyede</option>
                      <option value="InRepair">Tamirde</option>
                      <option value="WaitingForParts">Parça Bekliyor</option>
                      <option value="Delayed">Gecikti</option>
                      <option value="Cancelled">İptal</option>
                    </>
                  )}
                  {activeTab === 'teslimat' && (
                    <>
                      <option value="Planned">Teslimatta</option>
                      <option value="Delivered">Teslim Edildi</option>
                      <option value="Ready">Hazır (Teslimatı İptal Et)</option>
                    </>
                  )}
                </select>

                {activeTab === 'aktif' && (
                  <div className="space-y-1 mt-3">
                    <div className="text-xs font-semibold text-gray-500">Teslimat Tarihi <span className="text-red-500">*</span></div>
                    <input
                      type="date"
                      value={plannedDate}
                      onChange={(e) => setPlannedDate(e.target.value)}
                      className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                    />
                  </div>
                )}
                {activeTab === 'aktif' && (
                  <div className="space-y-1 mt-3">
                    <div className="text-xs font-semibold text-gray-500">Teslimat Teknisyeni / Şoför</div>
                    <select
                      value={deliveryTechId}
                      onChange={(e) => setDeliveryTechId(e.target.value)}
                      className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                    >
                      <option value="">Seçilmedi (Teslimat atanmadı)</option>
                      {technicians.map((t) => (
                        <option key={t.id} value={t.id}>{t.fullName}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Sadece Durum = "Hazır" (Ready) ve Atölyedeyken gösterilecek Yedek Parça & Fiyat Alanları */}
                {statusValue === 'Ready' && activeTab !== 'teslimat' && (
                  <div className="border border-orange-200/80 rounded-2xl p-4 bg-gradient-to-br from-orange-50/50 via-white to-amber-50/30 space-y-4 shadow-sm">
                    {/* Header & Patlak Şema Butonu */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-orange-100/80 pb-3">
                      <div>
                        <div className="text-xs font-extrabold text-slate-800 uppercase tracking-wide flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-orange-500 text-white flex items-center justify-center text-xs shadow-xs">⚙️</span>
                          Atölye Onarım & Hizmet Bedeli Detayları
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Kullanılan yedek parçaları şemadan seçebilir ve servis işçilik bedelini belirleyebilirsiniz.
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setPatlakSemaModalOpen(true)}
                        className="px-3 py-1.5 bg-gradient-to-r from-orange-600 to-amber-600 text-white rounded-xl text-xs font-bold shadow-sm hover:from-orange-700 hover:to-amber-700 transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        <span>📐 Patlak Şema & Kataloğu Aç</span>
                      </button>
                    </div>

                    {/* Seçilen Yedek Parçalar Listesi */}
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-slate-700 flex items-center justify-between">
                        <span>Kullanılan Yedek Parçalar ({selectedParts.length})</span>
                        <span className="text-[10px] text-slate-400 font-normal">Patlak Şemadan eklenebilir</span>
                      </div>

                      {selectedParts.length === 0 ? (
                        <div className="text-xs text-slate-400 italic bg-white p-3 rounded-xl border border-slate-200/60 text-center">
                          Henüz yedek parça seçilmedi. Patlak şema kataloğundan parça ekleyebilirsiniz.
                        </div>
                      ) : (
                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                          {selectedParts.map((p, idx) => (
                            <div key={p.id || idx} className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-slate-200 text-xs shadow-2xs">
                              <div className="font-semibold text-slate-800 truncate flex-1 mr-2">{p.name}</div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setSelectedParts(prev => prev.map((item, i) => i === idx ? { ...item, isWarranty: !item.isWarranty } : item))}
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                                    p.isWarranty ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-slate-100 text-slate-600 border-slate-200'
                                  }`}
                                >
                                  {p.isWarranty ? '🛡️ Garantili' : 'Ücretli'}
                                </button>
                                <input
                                  type="number"
                                  min="1"
                                  value={p.quantity}
                                  onChange={(e) => {
                                    const q = Math.max(1, Number(e.target.value) || 1)
                                    setSelectedParts(prev => prev.map((item, i) => i === idx ? { ...item, quantity: q } : item))
                                  }}
                                  className="w-12 px-1.5 py-0.5 border border-slate-300 rounded text-center font-bold text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => setSelectedParts(prev => prev.filter((_, i) => i !== idx))}
                                  className="text-red-500 hover:bg-red-50 p-1 rounded"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Servis İşçilik Bedeli */}
                    <div className="flex flex-col gap-1 text-xs">
                      <label className="font-bold text-slate-700">
                        Servis Onarım Bedeli / İşçilik
                      </label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                            {SERVICE_CURRENCY_OPTIONS.find(c => c.value === invoiceCurrencyTypeId)?.symbol ?? '₺'}
                          </span>
                          <input
                            type="number"
                            value={invoicePrice}
                            onChange={(e) => setInvoicePrice(e.target.value)}
                            placeholder="Fiyat giriniz (Örn: 350)"
                            min="0"
                            step="0.01"
                            className="pl-7 pr-3 py-2 bg-white border border-slate-300 rounded-xl text-sm w-full focus:outline-none focus:ring-2 focus:ring-orange-500/20 font-bold text-slate-800 shadow-xs"
                          />
                        </div>
                        <select
                          value={invoiceCurrencyTypeId}
                          onChange={(e) => setInvoiceCurrencyTypeId(Number(e.target.value))}
                          className="w-32 px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 shadow-xs cursor-pointer"
                        >
                          {SERVICE_CURRENCY_OPTIONS.map(c => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}




                <div className="text-xs font-semibold text-gray-500">İşlem Notu (Opsiyonel)</div>
                <textarea
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  placeholder="Yapılan işlem, ek bilgi veya not..."
                  className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full min-h-[60px] resize-none"
                />
                {/* Sınırsız Görsel Yükleme Alanı */}
                <div className="space-y-2 mt-4 border-t border-gray-100 pt-3">
                  <div className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center justify-between">
                    <span>Fotoğraf Ekle ({selectedFiles.length} Görsel Seçildi)</span>
                    <span className="text-[10px] font-normal text-gray-400">İstediğiniz Kadar Görsel Eklenebilir</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {selectedFiles.map((file, idx) => {
                      const previewUrl = URL.createObjectURL(file)
                      return (
                        <div key={idx} className="relative aspect-square rounded-xl border border-gray-200 bg-gray-50 overflow-hidden group shadow-sm">
                          <img src={previewUrl} alt={`Foto ${idx+1}`} className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setSelectedFiles(prev => prev.filter((_, i) => i !== idx))}
                            className="absolute top-1 right-1 w-5 h-5 bg-red-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold shadow hover:bg-red-700 transition"
                          >
                            ✕
                          </button>
                        </div>
                      )
                    })}
                    <label className="aspect-square rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 hover:bg-gray-100/80 transition flex flex-col items-center justify-center cursor-pointer text-center p-2 group">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files || [])
                          setSelectedFiles(prev => [...prev, ...files])
                        }}
                      />
                      <svg className="w-5 h-5 text-gray-400 group-hover:scale-110 transition-transform mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                      </svg>
                      <span className="text-[10px] font-semibold text-gray-500">+ Görsel Ekle</span>
                    </label>
                  </div>
                </div>

                {/* HAZIR ÜRÜN TESLİMAT PLANLAMA TAB: 3 Action Cards */}
                {activeTab === 'aktif' && selectedRecord && (
                  <div className="bg-orange-50/80 border border-orange-200 rounded-2xl p-4 space-y-3 mt-4">
                    <div className="text-xs font-bold text-orange-950 uppercase tracking-wider flex items-center gap-1.5">
                      <svg className="w-4 h-4 text-orange-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                      HAZIR ÜRÜN İŞLEM SEÇENEKLERİ
                    </div>
                    <div className="grid grid-cols-1 gap-2.5">
                      {/* 1. Planlama Yap Button */}
                      <button
                        type="button"
                        onClick={() => openPlanModal()}
                        className="w-full py-3 px-4 rounded-xl font-bold bg-orange-600 hover:bg-orange-700 text-white shadow-md transition flex items-center justify-between text-xs cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                          1. Teslimat Planla (Planlama Yap)
                        </span>
                        <span className="font-mono">→</span>
                      </button>

                      {/* 2. Atölyeye Geri Al Button */}
                      <button
                        type="button"
                        onClick={() => setReturnTarget(selectedRecord)}
                        className="w-full py-2.5 px-4 rounded-xl font-bold bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 transition flex items-center justify-between text-xs cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                          2. Atölyeye Geri Al (Fatura Taslağını İptal Et)
                        </span>
                        <span className="font-mono">↺</span>
                      </button>

                      {/* 3. Hizmet Faturası Bastır Button */}
                      <button
                        type="button"
                        onClick={() => setInvoiceModalOpen(true)}
                        className="w-full py-2.5 px-4 rounded-xl font-bold bg-slate-900 hover:bg-black text-white shadow transition flex items-center justify-between text-xs cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                          3. Hizmet Faturası Yazdır
                        </span>
                        <span className="font-mono">🖨️</span>
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="w-full mb-2 py-2 border border-gray-300 bg-white text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  Değişiklikleri Önizle
                </button>

                <button
                  disabled={actionLoading}
                  onClick={handleSaveStatus}
                  className={
                    'w-full py-3 rounded-xl font-semibold transition-colors cursor-pointer shadow-sm flex items-center justify-center gap-2 ' +
                    (actionLoading
                      ? 'bg-gray-300 text-gray-600'
                      : statusValue === 'Ready'
                      ? 'bg-[#F57F17] text-white hover:bg-[#E65100]'
                      : 'bg-gray-900 text-white hover:bg-gray-800')
                  }
                >
                  {actionLoading ? 'İşleniyor...' : statusValue === 'Ready' ? 'Hazır ve Tamamla' : 'Durumu Kaydet'}
                </button>

                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={async () => {
                    const onaylandi = await onayIste({
                      baslik: 'Kayıt silinsin mi?',
                      mesaj:
                        `${selectedRecord.serviceNumber} numaralı arıza kaydı listeden kaldırılıp ` +
                        'bekleyen listesine geri alınacak. Devam edilsin mi?',
                      onayEtiketi: 'Evet, sil',
                      tehlikeli: true,
                    })
                    if (!onaylandi) return
                    setActionLoading(true)
                    setActionError(null)
                    setActionSuccess(null)
                    try {
                      await updateStatus(selectedRecord.id, 'New', 'Kayıt silme talebi üzerine bekleyene geri alındı.')
                      setDrawerOpen(false)
                      toast.success('Kayıt başarıyla bekleyen listesine geri alındı.')
                      await refetch()
                    } catch (e: any) {
                      setActionError(String(e?.message ?? 'Kayıt bekleyene geri alınamadı.'))
                    } finally {
                      setActionLoading(false)
                    }
                  }}
                  className="w-full mt-3 py-2 border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 rounded-xl font-medium hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50 transition-all cursor-pointer"
                >
                  Kayıt Sil
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/*
        "i" (geçmiş) modalı ORTAK BİLEŞENDEN geliyor.

        Atölye, Saha ve Montaj ekranları aynı modalın üç ayrı kopyasını taşıyordu; biri
        düzeltilince diğerleri geride kalıyordu. Tek kaynak: components/ServisGecmisiModal.
      */}
      {infoPopupId && (
        <ServisGecmisiModal
          recordId={infoPopupId}
          onClose={() => setInfoPopupId(null)}
        />
      )}

      <Modal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Yapılan Değişiklikler Önizleme"
        footer={
          <>
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              className="px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors w-full sm:w-auto cursor-pointer"
            >
              Düzenlemeye Geri Dön
            </button>
            <button
              type="button"
              disabled={actionLoading}
              onClick={async () => {
                setPreviewOpen(false)
                await handleSaveStatus()
              }}
              className="px-4 py-2 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 transition-colors w-full sm:w-auto cursor-pointer"
            >
              {actionLoading ? 'Kaydediliyor...' : 'Onayla ve Kaydet'}
            </button>
          </>
        }
      >
        <div className="space-y-4 text-sm text-gray-750">
          <div className="bg-orange-50/50 p-4 rounded-xl border border-orange-100 space-y-3">
            <h4 className="font-bold text-orange-900 flex items-center gap-1.5 uppercase text-xs tracking-wider">
              📝 Hizmet/Teslimat Planı Özeti
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <span className="text-gray-500 font-semibold font-sans">Tarih:</span>
                <span className="ml-1 text-gray-800 font-bold">
                  {plannedDate ? new Date(`${plannedDate}T00:00:00`).toLocaleDateString('tr-TR') : 'Seçilmedi'}
                </span>
              </div>
              <div>
                <span className="text-gray-500 font-semibold">Şoför / Teknisyen:</span>
                <span className="ml-1 text-gray-800 font-bold">
                  {technicians.find(t => t.id === deliveryTechId)?.fullName || 'Seçilmedi'}
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-gray-500 font-semibold">Durum Güncellemesi:</span>
                <span className="ml-1 text-gray-800 font-bold">
                  {invoicePrice.trim() !== '' ? 'Teslim Edildi' : 'Planlandı / Teslimatta'}
                </span>
              </div>
              {invoicePrice.trim() !== '' && (
                <div className="col-span-2">
                  <span className="text-gray-500 font-semibold">Fatura Bedeli:</span>
                  <span className="ml-1 text-red-650 font-bold">{invoicePrice} TRY</span>
                </div>
              )}
            </div>
          </div>

          <div className="p-4 rounded-xl border border-gray-200 space-y-2">
            <h4 className="font-bold text-gray-800 flex items-center gap-1.5 uppercase text-xs tracking-wider">
              🛠️ Kullanılan Yedek Parçalar
            </h4>
            {selectedParts.length === 0 ? (
              <p className="text-xs text-gray-500 italic">Yedek parça eklenmedi.</p>
            ) : (
              <ul className="space-y-1">
                {selectedParts.map(p => (
                  <li key={p.id} className="flex justify-between items-center text-xs bg-gray-50 p-2 rounded border border-gray-150">
                    <span className="font-medium text-gray-850 truncate flex-1 mr-2">{p.name}</span>
                    <span className="font-bold text-gray-700 bg-gray-200/80 px-2 py-0.5 rounded-full shrink-0">
                      {p.quantity} Adet
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="p-4 rounded-xl border border-gray-200 space-y-2">
            <h4 className="font-bold text-gray-800 flex items-center gap-1.5 uppercase text-xs tracking-wider">
              💬 İşlem Notu
            </h4>
            <p className="text-xs bg-gray-50 p-3 rounded border border-gray-150 font-medium whitespace-pre-line leading-relaxed">
              {statusNote.trim() || 'Not eklenmedi.'}
            </p>
          </div>
        </div>
      </Modal>

      {/* 1. TESLİMAT PLANLAMA MODALI (Screenshot 3 Tasarımı) */}
      {planModalOpen && selectedRecord && (
        <Modal
          isOpen={planModalOpen}
          onClose={() => setPlanModalOpen(false)}
          title="Teslimat Planlama"
          containerClassName="max-w-6xl w-full"
        >
          <div className="p-6 bg-slate-50/50 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* SOL KOLON: Servis Kaydı & Müşteri Detayları */}
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4 text-xs">
                  <div className="flex items-start justify-between border-b border-gray-100 pb-3">
                    <div>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Servis Kaydı</span>
                      <div className="text-xl font-black text-[#B91C1C] font-mono leading-none mt-1">{selectedRecord.serviceNumber}</div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-green-50 text-green-700 border border-green-200">Hazır</span>
                  </div>

                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase">Ürün</div>
                        <div className="font-bold text-gray-800 mt-0.5 truncate">{selectedRecord.productName}</div>
                        {selectedRecord.serialNumber && <div className="text-[10px] font-mono text-gray-500">SN: {selectedRecord.serialNumber}</div>}
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase block mb-0.5">Bölge</label>
                        <select
                          value={planRegionId}
                          onChange={(e) => setPlanRegionId(e.target.value)}
                          className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-750 focus:outline-none focus:ring-1 focus:ring-red-600 w-full"
                        >
                          <option value="">Seçiniz...</option>
                          {regions.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase">Kayıt Tarihi</div>
                        <div className="font-bold text-gray-800 mt-0.5">{selectedRecord.createdAt ? new Date(selectedRecord.createdAt).toLocaleDateString('tr-TR') : '-'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] font-bold text-gray-400 uppercase">Öncelik</div>
                        <div className="font-bold text-gray-800 mt-0.5">{selectedRecord.priority || 'Normal'}</div>
                      </div>
                    </div>

                    <div className="flex gap-2.5 items-start bg-slate-50/50 p-3 rounded-xl border border-slate-100/50">
                      <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 border border-gray-200">
                        <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                      </div>
                      <div className="flex-1 space-y-2">
                        <div>
                          <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Müşteri Adı Soyadı</label>
                          <input
                            type="text"
                            value={planCustomerName}
                            onChange={(e) => setPlanCustomerName(toTurkishUpper(e.target.value))}
                            className="w-full px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-750 focus:outline-none focus:ring-1 focus:ring-red-650"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Müşteri Telefonu</label>
                          <input
                            type="text"
                            value={planCustomerPhone}
                            onChange={(e) => setPlanCustomerPhone(e.target.value)}
                            className="w-full px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-750 focus:outline-none focus:ring-1 focus:ring-red-650"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2.5 items-start bg-slate-50/50 p-3 rounded-xl border border-slate-100/50">
                      <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 border border-gray-200">
                        <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Adres</label>
                        <textarea
                          rows={2}
                          value={planAddress}
                          onChange={(e) => setPlanAddress(e.target.value)}
                          className="w-full px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-750 focus:outline-none focus:ring-1 focus:ring-red-650 resize-y"
                        />
                      </div>
                    </div>

                    {selectedRecord.dealerName && (
                      <div className="flex gap-2.5 items-start bg-slate-50/50 p-3 rounded-xl border border-slate-100/50">
                        <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center shrink-0 border border-gray-200">
                          <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                        </div>
                        <div>
                          <div className="text-[10px] font-bold text-gray-400 uppercase">Bayi</div>
                          <div className="font-bold text-gray-800">{selectedRecord.dealerName}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ORTA KOLON: Planlama Formu */}
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-5">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                    <h3 className="font-bold text-gray-900 flex items-center gap-2 text-sm">
                      <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      Teslimat Planlama
                    </h3>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="space-y-1.5">
                      <label className="font-bold text-gray-700">TESLİMAT TARİHİ <span className="text-red-500">*</span></label>
                      <input
                        type="date"
                        value={plannedDate}
                        onChange={(e) => setPlannedDate(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-orange-500/20 text-xs font-medium"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="font-bold text-gray-700">TEKNİSYEN / ŞOFÖR <span className="text-red-500">*</span></label>
                      <select
                        value={deliveryTechId}
                        onChange={(e) => setDeliveryTechId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-orange-500/20 text-xs font-medium"
                      >
                        <option value="">Teknisyen seçin...</option>
                        {technicians.map((t) => {
                          const loadCount = techWorkloads[t.id]?.count || 0
                          return (
                            <option key={t.id} value={t.id}>
                              {t.fullName} {loadCount > 0 ? `(${loadCount} iş)` : '(0 iş)'}
                            </option>
                          )
                        })}
                      </select>
                    </div>
                  </div>

                  {/* SATIŞ FATURASI ÖNİZLEME (Taslak Kalemleri) */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-between border-b border-slate-200 pb-2">
                      <span className="flex items-center gap-1.5 text-slate-900">
                        <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        📋 SATIŞ FATURASI ÖNİZLEME (Fatura Taslağı)
                      </span>
                      <span className="text-[10px] text-gray-500 font-normal">Kalemler</span>
                    </div>

                    {/* Yedek Parça Kalemleri */}
                    {planParts.length > 0 ? (
                      <div className="space-y-2 text-xs">
                        <div className="text-[11px] font-bold text-gray-600">⚙️ Kullanılan Yedek Parçalar ({planParts.length})</div>
                        {planParts.map((p, pIdx) => (
                          <div key={p.id || pIdx} className="flex flex-wrap items-center justify-between gap-2 bg-white p-2.5 rounded-lg border border-gray-200 text-xs">
                            <div className="font-semibold text-gray-800 truncate flex-1 min-w-[140px]">
                              {p.name} {p.partNumber ? `(${p.partNumber})` : ''}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setPlanParts(prev => prev.map((item, i) => i === pIdx ? { ...item, isWarranty: !item.isWarranty } : item))}
                                className={`px-2 py-1 rounded text-[10px] font-bold border transition ${
                                  p.isWarranty
                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                    : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                                }`}
                                title="Garantili parça için fatura ücreti alınmaz"
                              >
                                {p.isWarranty ? '🛡️ Garantili (₺0)' : 'Ücretli'}
                              </button>

                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-gray-400">Adet:</span>
                                <input
                                  type="number"
                                  min="1"
                                  value={p.quantity}
                                  onChange={(e) => {
                                    const q = Math.max(1, Number(e.target.value) || 1)
                                    setPlanParts(prev => prev.map((item, i) => i === pIdx ? { ...item, quantity: q } : item))
                                  }}
                                  className="w-12 px-1.5 py-0.5 border border-gray-300 rounded text-center font-bold text-xs"
                                />
                              </div>

                              <div className="flex items-center gap-1">
                                <span className="text-[10px] text-gray-400">Fiyat (₺):</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  disabled={p.isWarranty}
                                  value={p.isWarranty ? 0 : p.unitPrice}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0
                                    setPlanParts(prev => prev.map((item, i) => i === pIdx ? { ...item, unitPrice: val } : item))
                                  }}
                                  className="w-20 px-2 py-0.5 border border-gray-300 rounded text-right font-bold text-xs disabled:bg-gray-100 disabled:text-gray-400"
                                />
                              </div>

                              <button
                                type="button"
                                onClick={() => setPlanParts(prev => prev.filter((_, i) => i !== pIdx))}
                                className="text-red-500 hover:bg-red-50 p-1 rounded"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-gray-400 italic">Kullanılan yedek parça eklenmedi.</div>
                    )}

                    {/* Onarım / İşçilik Bedeli Kalemi */}
                    <div className="flex items-center justify-between gap-2 bg-white p-2.5 rounded-lg border border-gray-200 text-xs">
                      <div className="font-bold text-gray-800 flex items-center gap-1">
                        🛠️ Servis Onarım / İşçilik Bedeli
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          step="0.01"
                          value={planLaborFee}
                          onChange={(e) => setPlanLaborFee(e.target.value)}
                          placeholder="0.00"
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-right font-bold text-xs text-gray-900 focus:ring-2 focus:ring-emerald-500/20"
                        />
                        <select
                          value={invoiceCurrencyTypeId}
                          onChange={(e) => setInvoiceCurrencyTypeId(Number(e.target.value))}
                          className="px-2 py-1 bg-white border border-gray-300 rounded text-xs font-bold text-gray-900 focus:ring-2 focus:ring-emerald-500/20 cursor-pointer"
                        >
                          {SERVICE_CURRENCY_OPTIONS.map(c => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Toplam Fatura Bedeli */}
                    {(() => {
                      const sym = SERVICE_CURRENCY_OPTIONS.find(c => c.value === invoiceCurrencyTypeId)?.symbol ?? '₺'
                      const totalCalculated = planParts
                        .filter(p => !p.isWarranty)
                        .reduce((sum, p) => sum + (p.unitPrice * p.quantity), 0) + (parseFloat(planLaborFee) || 0)
                      return (
                        <div className="flex items-center justify-between pt-2 border-t border-slate-200 font-bold text-xs">
                          <span className="text-slate-700 uppercase tracking-wide">TOPLAM HESAPLANAN TUTAR:</span>
                          <span className="text-sm font-extrabold text-emerald-700">
                            {sym}{totalCalculated.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      )
                    })()}
                  </div>

                  <div className="space-y-1 text-xs">
                    <label className="font-bold text-gray-700">Teslimat Notu (Opsiyonel)</label>
                    <textarea
                      rows={2}
                      value={statusNote}
                      onChange={(e) => setStatusNote(e.target.value)}
                      placeholder="Şoför veya teslimat için açıklama notu..."
                      className="w-full p-2.5 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-orange-500/20 text-xs"
                    />
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <label className="font-bold text-gray-700 flex items-center justify-between">
                      <span>📷 Teslimat Görseli / Fotoğrafı (Opsiyonel)</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <label className="px-3 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl cursor-pointer text-xs font-semibold text-gray-700 flex items-center gap-1.5 transition">
                        <Camera className="w-4 h-4 text-gray-600" />
                        Görsel Seç / Yükle
                        <input
                          type="file"
                          multiple
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files) {
                              setSelectedFiles(prev => [...prev, ...Array.from(e.target.files!)])
                            }
                          }}
                        />
                      </label>
                      {selectedFiles.length > 0 && (
                        <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                          {selectedFiles.length} Görsel
                        </span>
                      )}
                    </div>

                    {selectedFiles.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {selectedFiles.map((file, fIdx) => (
                          <div key={fIdx} className="relative w-14 h-14 rounded-lg overflow-hidden border border-gray-300 bg-gray-100 group">
                            <img src={URL.createObjectURL(file)} alt="Önizleme" className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setSelectedFiles(prev => prev.filter((_, i) => i !== fIdx))}
                              className="absolute top-0.5 right-0.5 bg-red-600 text-white rounded-full p-0.5 opacity-90 hover:opacity-100 shadow"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* İki yol: teslimata aktar ya da doğrudan gerçekleşti (bkz. teslimatiIsle) */}
                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={actionLoading || !plannedDate || !deliveryTechId}
                      onClick={() => teslimatiIsle('Planned')}
                      className="w-full py-3.5 px-4 bg-[#B91C1C] hover:bg-red-800 text-white rounded-xl font-bold uppercase tracking-wider text-xs shadow-md transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                    >
                      {actionLoading ? 'İşleniyor...' : 'TESLİMAT PLANLA (TESLİMATA AKTAR)'}
                    </button>

                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => teslimatiIsle('Delivered')}
                      title="Teslimata aktarmadan, işi doğrudan gerçekleşti olarak kapatır"
                      className="w-full py-3 px-4 bg-white hover:bg-emerald-50 text-emerald-800 border-2 border-emerald-600 rounded-xl font-bold uppercase tracking-wider text-xs transition disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                    >
                      {actionLoading ? 'İşleniyor...' : 'DOĞRUDAN GERÇEKLEŞTİ (TESLİMATA AKTARMADAN)'}
                    </button>

                    <p className="text-[10px] text-gray-500 leading-snug">
                      Yukarıdaki bedel ve yedek parçalar iki yolda da faturaya işlenir. Doğrudan
                      gerçekleşti için teslimat günü ve teknisyeni gerekmez.
                    </p>
                  </div>
                </div>
              </div>

              {/* SAĞ KOLON: Teknisyen İş Dağılımı & Planlanmış Aktif Görevler */}
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4 flex flex-col">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                    <h3 className="font-bold text-gray-900 flex items-center gap-2 text-sm">
                      <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                      Teknisyen İş Yükü
                    </h3>
                  </div>

                  <div className="space-y-3">
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between text-xs">
                      <div className="font-bold text-gray-800">
                        {deliveryTechId ? technicians.find(t => t.id === deliveryTechId)?.fullName || 'Teknisyen Seçilmedi' : 'Teknisyen Seçilmedi'}
                        <div className="text-[10px] font-normal text-gray-500 mt-0.5">Aktif iş yükü</div>
                      </div>
                      <div className="text-right">
                        <span className={`font-bold px-2.5 py-1 rounded-full text-xs ${
                          techWorkloadsLoading
                            ? 'bg-gray-100 text-gray-500'
                            : deliveryTechId
                              ? ((techWorkloads[deliveryTechId]?.count || 0) > 4 ? 'bg-amber-100 text-amber-900' : 'bg-orange-100 text-orange-950')
                              : 'bg-gray-100 text-gray-500'
                        }`}>
                          {techWorkloadsLoading
                            ? 'Yükleniyor...'
                            : deliveryTechId
                              ? `${techWorkloads[deliveryTechId]?.count || 0} iş (${(techWorkloads[deliveryTechId]?.count || 0) > 4 ? 'Yoğun' : 'Planlanabilir'})`
                              : '0 iş'}
                        </span>
                        <div className="text-[10px] text-gray-400 mt-0.5">{plannedDate || new Date().toLocaleDateString('tr-TR')}</div>
                      </div>
                    </div>

                    {/* Teknisyenin Aktif İşlerinin Listesi */}
                    {deliveryTechId && techWorkloads[deliveryTechId]?.records?.length > 0 ? (
                      <div className="space-y-2.5 overflow-y-auto max-h-[460px] pr-1 pt-1 border-t border-slate-100">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Planlanmış Aktif Görevler ({techWorkloads[deliveryTechId].records.length})</div>
                        {techWorkloads[deliveryTechId].records.map((record: any) => (
                          <div key={record.id} className="border border-slate-150 bg-slate-50/50 rounded-xl p-3 space-y-1.5 shadow-2xs text-[11px] hover:bg-slate-50 transition-colors">
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-black text-[#B91C1C] text-[10px]">{record.serviceNumber}</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-white text-slate-600 border border-slate-150">
                                {record.status === 'Planned' ? 'Rotalandı' : record.status || 'Planlandı'}
                              </span>
                            </div>
                            <div className="font-bold text-slate-800">{record.customerName || 'Müşteri'}</div>
                            {record.productName && (
                              <div className="text-[10px] text-slate-600 font-medium">
                                Cihaz: {record.productName}
                              </div>
                            )}
                            {record.customerAddress && (
                              <div className="text-[10px] text-slate-500 line-clamp-2 leading-tight" title={record.customerAddress}>
                                Adres: {record.customerAddress}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      deliveryTechId && (
                        <div className="text-center py-10 text-slate-400 text-xs italic border-t border-slate-100">
                          Teknisyenin bu tarihte planlanmış görevi bulunmuyor.
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* 3. HİZMET FATURASI BASTIR MODALI */}
      {invoiceModalOpen && selectedRecord && (
        <Modal
          isOpen={invoiceModalOpen}
          onClose={() => setInvoiceModalOpen(false)}
          title="Hizmet Faturası Baskı Görünümü"
          containerClassName="max-w-3xl"
          footer={
            <div className="flex items-center justify-between w-full">
              <button
                type="button"
                onClick={() => setInvoiceModalOpen(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition"
              >
                Kapat
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="px-5 py-2 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-lg shadow transition flex items-center gap-2 cursor-pointer"
              >
                <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H7a2 2 0 00-2 2v4h10z" /></svg>
                🖨️ Faturayı Yazdır (Print)
              </button>
            </div>
          }
        >
          <div className="p-6 bg-white text-gray-900 font-sans space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between border-b-2 border-slate-900 pb-4">
              <div>
                <div className="text-2xl font-black tracking-wider text-[#B91C1C]">STILSOFT</div>
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">KKTC SERVICE ERP • SERVİS VE ONARIM HİZMET FATURASI</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold font-mono text-gray-900">Fiş No: {selectedRecord.serviceNumber}</div>
                <div className="text-xs text-gray-500">Tarih: {new Date().toLocaleDateString('tr-TR')}</div>
              </div>
            </div>

            {/* Dealer & Customer Grid */}
            <div className="grid grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs">
              <div>
                <div className="font-bold text-slate-500 uppercase tracking-wider text-[10px] mb-1">BAYİ / SERVİS BİLGİLERİ</div>
                <div className="font-extrabold text-sm text-slate-900">{selectedRecord.dealerName || 'DEMO FİRMA GENEL SERVİS'}</div>
                {/* Faturanın GİDECEĞİ cari burada yazılı olmalı: bayi ADI ile KODU aynı cariye ait
                    olmayabiliyor (test verisinde öyle) ve fatura kodu kullanıyor. Operatör
                    yanlışı fatura kesilmeden görsün. */}
                <div className="text-slate-600 mt-0.5">
                  Faturalanacak Cari Kodu:{' '}
                  {getDealerCode(selectedRecord)
                    ? <span className="font-mono font-bold">{getDealerCode(selectedRecord)}</span>
                    : <span className="font-bold text-red-600">YOK — fatura kesilemez</span>}
                </div>
                {selectedRecord.dealerPhone && (
                  <div className="text-slate-600 flex items-center gap-1">Tel: <PhoneLinks phone={selectedRecord.dealerPhone} compact /></div>
                )}
              </div>

              <div>
                <div className="font-bold text-slate-500 uppercase tracking-wider text-[10px] mb-1">MÜŞTERİ BİLGİLERİ</div>
                <div className="font-extrabold text-sm text-slate-900">{selectedRecord.customerName || 'Müşteri Kaydı'}</div>
                <div className="text-slate-600 mt-0.5">Tel: {selectedRecord.customerPhone || '-'}</div>
                <div className="text-slate-600 truncate">Adres: {selectedRecord.customerAddress || '-'}</div>
              </div>
            </div>

            {/* Device Details */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs space-y-2">
              <div className="font-bold text-gray-500 uppercase tracking-wider text-[10px]">CİHAZ BİLGİLERİ</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div><span className="text-gray-500">Cihaz Model:</span> <strong className="text-gray-900">{selectedRecord.productName}</strong></div>
                <div><span className="text-gray-500">Seri No:</span> <strong className="font-mono text-gray-900">{selectedRecord.serialNumber || '-'}</strong></div>
                <div><span className="text-gray-500">Garanti:</span> <strong>{selectedRecord.isUnderWarranty ? 'Var (Garanti Kapsamında)' : 'Yok'}</strong></div>
              </div>
              {selectedRecord.problemDescription && (
                <div className="pt-2 border-t border-gray-200 text-xs">
                  <span className="text-red-700 font-semibold">Arıza / Şikayet:</span> <span className="text-gray-800">{selectedRecord.problemDescription}</span>
                </div>
              )}
            </div>

            {/* Spare Parts & Total */}
            <div>
              <div className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">HİZMET DÖKÜMÜ VE KULLANILAN YEDEK PARÇALAR</div>
              <table className="w-full text-xs text-left border-collapse border border-gray-200 mobile-stack">
                <thead>
                  <tr className="bg-slate-100 text-slate-700 font-bold border-b border-gray-200">
                    <th className="p-2.5">Açıklama / Kalem</th>
                    <th className="p-2.5 w-20 text-center">Miktar</th>
                    <th className="p-2.5 w-32 text-right">Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {selectedParts.length > 0 ? (
                    selectedParts.map((part) => (
                      <tr key={part.id}>
                        <td data-label="Açıklama / Kalem" className="p-2.5 font-medium text-gray-800">{part.name}</td>
                        <td data-label="Miktar" className="p-2.5 text-center font-bold">{part.quantity}</td>
                        <td data-label="Tutar" className="p-2.5 text-right font-mono">—</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="p-2.5 text-gray-500 italic">Genel servis onarım ve bakım hizmeti.</td>
                    </tr>
                  )}
                  <tr className="bg-orange-50 font-bold">
                    <td colSpan={2} className="p-2.5 text-right text-gray-800 uppercase">Onarım Bedeli / Genel Hizmet Toplamı (KDV Dahil):</td>
                    <td className="p-2.5 text-right font-mono text-sm text-orange-950">₺{invoicePrice || '0.00'}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Signatures Footer */}
            <div className="grid grid-cols-2 gap-8 pt-8 border-t border-gray-200 text-xs">
              <div className="text-center space-y-12">
                <div className="font-bold text-gray-700">TESLİM EDEN (SERVİS YETKİLİSİ)</div>
                <div className="border-b border-gray-400 w-48 mx-auto"></div>
                <div className="text-[10px] text-gray-400">İmza / Kaşe</div>
              </div>
              <div className="text-center space-y-12">
                <div className="font-bold text-gray-700">TESLİM ALAN (MÜŞTERİ / BAYİ)</div>
                <div className="border-b border-gray-400 w-48 mx-auto"></div>
                <div className="text-[10px] text-gray-400">İmza</div>
              </div>
            </div>
          </div>
        </Modal>
      )}
      {/* Photo Lightbox Modal */}
      {/* Sadece tam ekran basıyordu; yakınlaştırma yoktu. Ortak görüntüleyiciye alındı. */}
      <GorselOnizleyici
        gorseller={photoLightboxUrl ? [photoLightboxUrl] : []}
        acikIndex={photoLightboxUrl ? 0 : null}
        onKapat={() => setPhotoLightboxUrl(null)}
      />

      {/* Patlak Şema & Yedek Parça Kataloğu Modalı */}
      {patlakSemaModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between flex-shrink-0">
              <div>
                <div className="text-[11px] font-bold text-orange-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>📐 PATLAK ŞEMA & YEDEK PARÇA KATALOĞU</span>
                </div>
                <h2 className="text-base font-bold text-white mt-0.5">
                  {selectedRecord?.productName || 'Cihaz / Ürün'}
                </h2>
                <div className="text-xs text-slate-300 mt-0.5 font-mono">
                  Model / Stok Kodu: {currentProduct?.partNumber || selectedRecord?.productStockCode || 'Tanımsız'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPatlakSemaModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content Scroll Area */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* 1. En Üstte Patlak Şema Görseli Banner */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col items-center">
                <div className="w-full flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
                    🖼️ Ürün Patlak Şema Görseli
                  </span>
                  {currentProduct?.explodedDiagramUrl && (
                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => setModalImageZoom(z => Math.min(2.5, z + 0.25))}
                        className="px-2 py-1 bg-white border border-slate-200 rounded text-slate-700 font-bold hover:bg-slate-100"
                      >
                        🔍 +
                      </button>
                      <button
                        type="button"
                        onClick={() => setModalImageZoom(z => Math.max(0.75, z - 0.25))}
                        className="px-2 py-1 bg-white border border-slate-200 rounded text-slate-700 font-bold hover:bg-slate-100"
                      >
                        🔍 -
                      </button>
                      <button
                        type="button"
                        onClick={() => setModalImageZoom(1.0)}
                        className="px-2 py-1 bg-white border border-slate-200 rounded text-slate-700 text-[11px] hover:bg-slate-100"
                      >
                        Sıfırla
                      </button>
                    </div>
                  )}
                </div>

                {currentProduct?.explodedDiagramUrl ? (
                  <div className="w-full max-h-[340px] overflow-auto border border-slate-200 bg-white rounded-lg p-2 flex items-center justify-center">
                    <img
                      src={toImgSrc(currentProduct.explodedDiagramUrl)}
                      alt="Patlak Şema"
                      style={{ transform: `scale(${modalImageZoom})`, transformOrigin: 'top center' }}
                      className="max-w-full h-auto object-contain transition-transform duration-150"
                    />
                  </div>
                ) : (
                  <div className="w-full py-8 px-4 bg-white border border-dashed border-slate-300 rounded-lg text-center text-slate-500 text-xs">
                    <div className="text-2xl mb-1">📐</div>
                    <div className="font-semibold text-slate-700">Bu ürün için patlak şema görseli yüklenmemiş.</div>
                    <div className="text-[11px] text-slate-400 mt-1">Aşağıdaki yedek parça listesinden ürüne ait tüm parçaları ve satış fiyatlarını inceleyebilirsiniz.</div>
                  </div>
                )}
              </div>

              {/* 2. Ürüne Ait Yedek Parçalar Tablosu */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setModalTab('assigned')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                        modalTab === 'assigned'
                          ? 'bg-orange-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <span>⚙️ Ürüne Eşleşen Parçalar</span>
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                        modalTab === 'assigned' ? 'bg-orange-700 text-white' : 'bg-slate-200 text-slate-800'
                      }`}>
                        {assignedSpareParts.length}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setModalTab('all')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                        modalTab === 'all'
                          ? 'bg-orange-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <span>📦 Tüm Kataloğu Göster</span>
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                        modalTab === 'all' ? 'bg-orange-700 text-white' : 'bg-slate-200 text-slate-800'
                      }`}>
                        {availableSpareParts.length}
                      </span>
                    </button>
                  </div>

                  {/* Arama Kutusu */}
                  <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Parça adı, kod veya poz no ara..."
                      value={modalSearchQuery}
                      onChange={(e) => setModalSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-500"
                    />
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-x-auto shadow-sm">
                  <table className="w-full text-left text-xs border-collapse min-w-[600px]">
                    <thead>
                      <tr className="bg-slate-100 border-b border-slate-200 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                        <th className="px-4 py-2.5 w-[110px]">Poz No</th>
                        <th className="px-4 py-2.5">Yedek Parça Adı & Kodu</th>
                        <th className="px-4 py-2.5 text-right w-[140px]">B2B Satış Fiyatı</th>
                        <th className="px-4 py-2.5 text-center w-[100px]">Stok</th>
                        <th className="px-4 py-2.5 text-center w-[120px]">Aksiyon</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {(() => {
                        const targetList = modalTab === 'assigned' ? assignedSpareParts : availableSpareParts

                        if (targetList.length === 0) {
                          return (
                            <tr>
                              <td colSpan={5} className="px-4 py-8 text-center bg-amber-50/50 text-amber-800 text-xs">
                                <div className="font-bold text-sm text-amber-900 mb-1">⚠️ Bu kategoride yedek parça bulunmuyor</div>
                                <div className="text-amber-700 text-[11px] max-w-md mx-auto mb-2">
                                  İşlemdeki ürüne (<b>{currentProduct?.name || selectedRecord?.productName || selectedRecord?.productStockCode || 'Ürün'}</b>) ait doğrudan eşleşen parça bulunamadı.
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setModalTab('all')}
                                  className="px-3 py-1.5 bg-orange-600 text-white font-bold text-xs rounded-lg hover:bg-orange-700 transition shadow-sm cursor-pointer"
                                >
                                  Tüm Kataloğu Göster ({availableSpareParts.length} Parça)
                                </button>
                              </td>
                            </tr>
                          )
                        }

                        const partsToDisplay = targetList.filter(p => {
                          if (!modalSearchQuery.trim()) return true
                          const q = modalSearchQuery.trim().toLowerCase()
                          const pozNo = getSpecificDiagramNo(p.explodedViewPartNumber, currentProduct?.productId || selectedRecord?.productStockCode) || ''
                          return p.name.toLowerCase().includes(q) ||
                                 p.partNumber.toLowerCase().includes(q) ||
                                 pozNo.toLowerCase().includes(q)
                        })

                        if (partsToDisplay.length === 0) {
                          return (
                            <tr>
                              <td colSpan={5} className="px-4 py-6 text-center text-slate-400 text-xs italic">
                                Arama kriterlerine uygun yedek parça bulunamadı.
                              </td>
                            </tr>
                          )
                        }

                        return partsToDisplay.map(part => {
                          const pozNo = getSpecificDiagramNo(part.explodedViewPartNumber, currentProduct?.productId || selectedRecord?.productStockCode)
                          const isSelected = selectedParts.some(sp => sp.id === part.id)

                          return (
                            <tr key={part.id} className="hover:bg-orange-50/40 transition-colors">
                              <td className="px-4 py-3 font-mono font-bold text-blue-700">
                                {pozNo ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                    #{pozNo}
                                  </span>
                                ) : (
                                  <span className="text-slate-300 font-normal">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-bold text-slate-800">{part.name}</div>
                                <div className="text-[10px] font-mono text-slate-400 mt-0.5">{part.partNumber || 'Kodsuz'}</div>
                              </td>
                              <td className="px-4 py-3 text-right font-bold text-slate-900">
                                ₺{(part.unitPrice || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  part.quantity > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
                                }`}>
                                  {part.quantity} adet
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                {isSelected ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                                    ✓ Eklendi
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedParts(prev => [...prev, {
                                        id: part.id,
                                        name: part.name,
                                        partNumber: part.partNumber || '',
                                        quantity: 1,
                                        unitPrice: part.unitPrice || 0,
                                        isWarranty: false
                                      }])
                                    }}
                                    className="px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-lg text-xs transition shadow-sm cursor-pointer"
                                  >
                                    + Forma Ekle
                                  </button>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between flex-shrink-0">
              <div className="text-xs text-slate-500">
                Seçilen toplam parça sayısı: <span className="font-bold text-slate-800">{selectedParts.length}</span>
              </div>
              <button
                type="button"
                onClick={() => setPatlakSemaModalOpen(false)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-xl text-xs transition shadow-sm cursor-pointer"
              >
                Tamam (Forma Dön)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Atölyeye geri alma onayı. Geri alma yalnızca durumu değiştirmiyor; B2B'deki satış
          faturası TASLAĞINI da iptal ediyor. Bu, tarayıcının tek satırlık confirm kutusunda
          anlatılamayacak kadar önemli bir sonuç. */}
      {returnTarget && (
        <>
          <div className="fixed inset-0 bg-black/30 z-[60]" onClick={() => { if (!actionLoading) setReturnTarget(null) }} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
              <div className="p-5 border-b border-gray-100">
                <div className="text-base font-bold text-gray-900">Atölyeye Geri Al</div>
              </div>
              <div className="p-5 space-y-3 text-sm text-gray-600">
                <p>
                  <span className="font-mono font-semibold text-gray-900">{returnTarget.serviceNumber}</span> kaydı
                  atölyeye geri alınacak ve teknisyen ataması kaldırılacak.
                </p>
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-900 leading-relaxed">
                  <span className="font-bold">B2B'deki satış faturası taslağı da iptal edilecek.</span>{' '}
                  Bu şart: taslak iptal edilmezse kayıt "zaten faturalanmış" kalır ve düzeltilen ücret
                  ile yedek parçalar cariye bir daha işlenmez.
                </div>
                {actionError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs font-semibold text-red-600">{actionError}</div>
                )}
              </div>
              <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => setReturnTarget(null)}
                  className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  disabled={actionLoading}
                  onClick={() => handleReturnToWorkshop(returnTarget)}
                  className={`px-4 py-2 rounded-lg text-sm font-bold text-white ${actionLoading ? 'bg-gray-300' : 'bg-amber-600 hover:bg-amber-700'}`}
                >
                  {actionLoading ? 'Geri alınıyor...' : 'Evet, Atölyeye Geri Al'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      </div>

      {/* "Emin misiniz?" penceresi. window.confirm WebView'de kutu göstermiyordu. */}
      {onayPenceresi}

      <FisNoModal
        open={!!fisNoFor}
        onClose={() => setFisNoFor(null)}
        recordId={fisNoFor?.id ?? ''}
        serviceNumber={fisNoFor?.serviceNumber}
        productName={fisNoFor?.productName}
        customerName={fisNoFor?.customerName ?? fisNoFor?.dealerName ?? undefined}
        currentValue={fisNoFor?.manualReceiptNo}
        onSaved={async () => { await refetch() }}
      />

    </>
  )
}
