import { useMemo, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Camera,
  Download,
  Filter,
  Plus,
  Search,
  Trash2,
  X
} from 'lucide-react'

import { useServiceRecordsPaged } from '../hooks/useServiceRecords'
import { workshopDaysOf } from '../utils/atolyeGun'
import { AtolyeGunRozeti } from '../components/AtolyeGunRozeti'
import { useTechnicians } from '../hooks/useTechnicians'
import { fetchErpProducts, fetchErpDealers, type ErpProductDto, type ErpDealerDto } from '../api/erp'
import { fetchStockItems, type StockItemDto } from '../api/stock'
import { apiJson } from '../api/client'
import { confirmStatusChangeAhead, describeNextStatusChange } from '../api/statusChangeGate'
import { groupTimelineEvents } from '../utils/timelineHelper'
import TimelineEvent from '../components/TimelineEvent'
import Table, { type TableColumn } from '../components/Table'
import { getAccessToken, getUsername, isTechnicianSession } from '../auth/storage'
import { SAHA_ARIZA_TAB_KEYS } from '../auth/pagePermissions'
import { usePermissions, useCanViewHistory } from '../auth/PermissionsContext'
import { toTurkishUpper } from '../utils/formInput'
import { API_BASE_URL } from '../config'
import { useSignalREvent } from '../hooks/useSignalR'
import Modal from '../components/Modal'
import ActionDropdown from '../components/ActionDropdown'
import FisNoModal from '../components/FisNoModal'
import { getCustomerOrDealerType, getCustomerTypeBadgeClass } from '../utils/customerType'
import { garantiBaslangici, garantiBaslangiciInput } from '../utils/garanti'
import { faturalanacakVar } from '../utils/fatura'
import { printServiceSlipFresh } from '../print/serviceSlip'
import { SearchableProductSelect } from '../components/SearchableProductSelect'
import { useOnay } from '../components/OnayModal'
import GunSecici, { bugunIso } from '../components/GunSecici'
import ServisGecmisiModal from '../components/ServisGecmisiModal'
import { toast } from 'sonner'
import PhoneLinks from '../components/PhoneLinks'
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
  dealerAddress?: string
  receivingNote?: string
  isUnderWarranty: boolean
  /** Garanti başlangıç tarihi (ISO). Garanti yoksa boştur — bkz. utils/garanti.ts */
  warrantyStartDate?: string | null
  dealerCode?: string
  type?: string
  priority: string
  plannedAt?: string
}

/** Yerel gün. `toISOString()` UTC'ye çevirdiği için gece yarısı civarında bir gün kayabiliyor. */
function todayIso(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

/** Gün etiketi: bugün/dün/yarın ise onu, değilse tarihi yazar. */
function dayLabel(iso: string): string {
  if (!iso) return 'Tüm tarihler'
  const today = todayIso()
  if (iso === today) return 'Bugün'

  const diff = Math.round(
    (new Date(`${iso}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000
  )
  if (diff === -1) return 'Dün'
  if (diff === 1) return 'Yarın'

  return new Date(`${iso}T00:00:00`).toLocaleDateString('tr-TR', {
    day: '2-digit', month: '2-digit', year: 'numeric', weekday: 'short'
  })
}

const statusConfig: Record<string, { label: string; color: string }> = {
  New: { label: 'Plan Bekliyor', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  FieldPlanned: { label: 'Saha Planlamasında', color: 'bg-sky-100 text-sky-800 border-sky-200' },
  Workshop: { label: 'Atölyede', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  InRepair: { label: 'Tamirde', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  Ready: { label: 'Hazır', color: 'bg-green-100 text-green-700 border-green-200' },
  InDelivery: { label: 'Teslimatta', color: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  Delivered: { label: 'Teslim Edildi', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  Cancelled: { label: 'İptal', color: 'bg-red-100 text-red-700 border-red-200' },
  Delayed: { label: 'Gecikti', color: 'bg-red-100 text-red-700 border-red-200' },
  WaitingForParts: { label: 'Parça Bekliyor', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  Planned: { label: 'Saha Planlamasında', color: 'bg-sky-100 text-sky-800 border-sky-200' },
  /*
    PLANLANDI AMA SAHAYA GİTMEDİ (2026-08-25 kullanıcı isteği: "direkt sahaya aktarmayacak,
    planlanıp öyle isteğe bağlı saha atmam lazım, aynı montajdaki gibi").

    `LargeProductPlanning` yeni bir durum değil — Planlama sekmesinin sorgusu (`New,
    LargeProductPlanning`) ve üstteki sayaç bu durumu ZATEN kapsıyordu, ama hiçbir şey bu
    duruma geçirmiyordu. Artık planlama bu durumu yazıyor: kayıt Planlama sekmesinde kalır,
    planlanan günü ve atanan personeli görünür, sahaya aktarım ayrı bir adım olur.
  */
  LargeProductPlanning: { label: 'Planlandı', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  /*
    ERTELENDİ (2026-08-27 kullanıcı isteği: "ertelendi yapınca direk planlama sayfasına
    durumu montajdaki gibi ertelendi olarak gelsin").

    Kayıt planlamaya geri döner ama "Yeni Kayıt" gibi görünmez — planlamacı bunun bir kez
    planlanıp geri çekildiğini görür. `Delayed` ("Gecikti") kullanılamazdı: o durum atölye
    sekmesinin sorgusunda da var, kayıt iki sekmede birden çıkardı.
  */
  Postponed: { label: 'Ertelendi', color: 'bg-amber-100 text-amber-800 border-amber-200' }
}

const priorityConfig: Record<string, { label: string; color: string }> = {
  Low: { label: 'Düşük', color: 'bg-gray-100 text-gray-700' },
  Normal: { label: 'Normal', color: 'bg-gray-100 text-gray-700' },
  High: { label: 'Acil', color: 'bg-orange-100 text-orange-700' },
  Critical: { label: 'Kritik', color: 'bg-red-100 text-red-700' },
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

const getStatusLabelTR = (statusKey?: string) => {
  if (!statusKey) return ''
  const map: Record<string, string> = {
    New: 'Yeni Kayıt',
    Workshop: 'Atölyede',
    InRepair: 'Tamirde',
    WaitingForParts: 'Parça Bekliyor',
    Ready: 'Hazır',
    Planned: 'Teslimatta',
    Delivered: 'Teslim Edildi',
    Cancelled: 'İptal'
  }
  return map[statusKey] || statusKey
}

/**
 * Kaydın FATURALANACAĞI cari kodu. Çözülemezse `null` — ASLA uydurma bir kod değil.
 *
 * Bu fonksiyon çözemediği her durumda sabit `'120-04-000001'` döndürüyordu. Sonuç: cari kodu
 * çözülemeyen her servis kaydının bedeli, hiç ilgisi olmayan TEK bir cariye yazılıyordu. Fatura
 * ucu 403 verdiği sürece bu görünmüyordu; uç düzeltilince para gerçekten oraya akmaya başladı.
 *
 * Finansal bir kayıtta "bilmiyorum" ile "şu hesaba yaz" arasındaki fark budur: bilinmiyorsa
 * işlem YAPILMAZ, tahmin edilmez. Çağıranlar null'ı hata olarak gösteriyor.
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

/**
 * Fatura kesmeden önce cari kodunu ZORUNLU kılar. Çözülemezse hata fırlatır; çağıran zaten
 * hatayı ekrana basıyor. Amaç: "bir yere yaz" yerine "yazma, söyle".
 */
const requireCari = (record: any): string => {
  const code = getDealerCode(record)
  if (!code) {
    throw new Error('Kaydın cari kodu belirlenemedi; fatura oluşturulmadı. Bayi/cari bilgisini düzeltin.')
  }
  return code
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
  if (typeof r.laborCost === 'number' && r.laborCost > 0) return r.laborCost
  if (typeof r.totalCost === 'number' && r.totalCost > 0) return r.totalCost
  if (typeof r.price === 'number' && r.price > 0) return r.price
  if (typeof r.invoicePrice === 'number' && r.invoicePrice > 0) return r.invoicePrice

  const notesList = Array.isArray(r.notes) ? r.notes : (Array.isArray(r.timeline) ? r.timeline : [])
  if (Array.isArray(notesList)) {
    for (const n of notesList) {
      const content = typeof n === 'string' ? n : (n.content || n.note || n.description || n.payload || '')
      const match = content.match(/(?:Fatura Bedeli|İşçilik Bedeli|İşçilik|Fatura|Fiyat):\s*₺?\s*([\d.,]+)/i)
      if (match) {
        const val = parseFloat(match[1].replace(/\./g, '').replace(',', '.'))
        if (!isNaN(val) && val > 0) return val
      }
    }
  }
  return 0
}

export default function SahaArizaPage() {
  const navigate = useNavigate()
  const { technicians } = useTechnicians()
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
  
  const [stockItems, setStockItems] = useState<StockItemDto[]>([])
  const [selectedParts, setSelectedParts] = useState<{ id: string; name: string; partNumber?: string; quantity: number; unitPrice: number; isWarranty: boolean }[]>([])
  const [planParts, setPlanParts] = useState<{ id: string; name: string; partNumber?: string; quantity: number; unitPrice: number; isWarranty: boolean }[]>([])
  const [planLaborFee, setPlanLaborFee] = useState<string>('')
  const [techSearch, setTechSearch] = useState('')
  const [sahaShowAll, setSahaShowAll] = useState(false)

  // 3 Photo Upload Slots
  const [photoSlots, setPhotoSlots] = useState<(File | null)[]>([null, null, null])

  // Modals for Hazır Ürün Teslimat Planlama Actions
  const [planModalOpen, setPlanModalOpen] = useState(false)
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)

  const [deliveryTechId, setDeliveryTechId] = useState<string>('')
  const [plannedDate, setPlannedDate] = useState<string>('')
  const [planDate, setPlanDate] = useState<string>('')
  const [techWorkloads, setTechWorkloads] = useState<Record<string, number>>({})
  const [techWorkloadsLoading, setTechWorkloadsLoading] = useState(false)

  const fetchTechWorkloads = useCallback(async (targetDate?: string) => {
    const dateToUse = targetDate || plannedDate || planDate || new Date().toISOString().slice(0, 10)
    setTechWorkloadsLoading(true)
    try {
      const params = new URLSearchParams({
        plannedFrom: `${dateToUse}T00:00:00`,
        plannedTo: `${dateToUse}T23:59:59`,
        pageSize: '500',
      })
      const response = await apiJson<any>(`/api/servicerecords?${params}`)
      const rows = Array.isArray(response) ? response : (response?.items || [])
      const map: Record<string, number> = {}
      const inactiveStatuses = new Set(['Delivered', 'Cancelled', '5', '6'])

      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (inactiveStatuses.has(String(row.status))) continue
          
          const techIds = new Set<string>()
          if (row.assignedTechnicianId) {
            techIds.add(String(row.assignedTechnicianId))
          }
          if (row.technicianId) {
            techIds.add(String(row.technicianId))
          }
          if (Array.isArray(row.installationTasks)) {
            for (const task of row.installationTasks) {
              if (task.assignedTechnicianId) {
                techIds.add(String(task.assignedTechnicianId))
              }
            }
          }

          for (const techId of techIds) {
            map[techId] = (map[techId] || 0) + 1
          }
        }
      }
      setTechWorkloads(map)
    } catch {
      setTechWorkloads({})
    } finally {
      setTechWorkloadsLoading(false)
    }
  }, [plannedDate, planDate])

  useEffect(() => {
    fetchTechWorkloads()
  }, [plannedDate, planDate, planModalOpen, fetchTechWorkloads])

  useEffect(() => {
    fetchStockItems()
      .then(setStockItems)
      .catch(() => setStockItems([]))
  }, [])

  // 5 Tabs: planlama (New), saha (Field visit planned), bekleyen (Atölye), aktif (Hazır Ürün Teslimat Planlama), teslimat (Teslimattakiler)
  const [activeTab, setActiveTab] = useState<'planlama' | 'saha' | 'bekleyen' | 'aktif' | 'teslimat'>('planlama')

  /**
   * Sekme -> yetki anahtarı.
   *
   * Hem sekmenin görünüp görünmeyeceğini hem de listenin kapsamını bu belirler: rol o sekmede
   * 'tüm işleri görme' taşımıyorsa sunucu yalnızca kullanıcıya atanmış kayıtları döndürür.
   * Kapsam sekme başına olduğu için sunucuya hangi sekmede olduğumuzu söylemek zorundayız.
   *
   * Eşlemenin kendisi `auth/pagePermissions` içinde: başlıktaki geçiş şeridi de aynı listeye
   * bakıyor. Buradaki yerel kopya şeritle kaymıştı (bkz. SAHA_ARIZA_TAB_KEYS yorumu).
   */
  const TAB_PAGE_KEYS = SAHA_ARIZA_TAB_KEYS

  // Sekmeler zaten hasPermission ile gizleniyor; burada eksik olan, açılışta seçili gelen
  // sekmenin o role kapalı olabilmesiydi. Kapalıysa ilk açık sekmeye kayıyoruz, yoksa kullanıcı
  // gizli bir sekmenin boş listesine bakıp "veri yok" sanıyordu.
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
    (window as any).__sahaActiveTab = activeTab
    window.dispatchEvent(new CustomEvent('saha-ariza:tab-updated'))
  }, [activeTab])

  useEffect(() => {
    const handleTabChange = (e: Event) => {
      const tab = (e as CustomEvent).detail
      setActiveTab(tab)
      setPage(1)
    }
    window.addEventListener('shell:saha-ariza-tab-change', handleTabChange)
    return () => window.removeEventListener('shell:saha-ariza-tab-change', handleTabChange)
  }, [])

  const isTech = isTechnicianSession()

  /**
   * Saha Planlaması GÜNLÜK bir ekrandır: personel sabah açtığında o günün işlerini görmeli,
   * bütün işler karışık gelmemeli. Diğer sekmeler böyle değil — orada tarih kısıtı yok.
   *
   * Sekmeden çıkarken tarih TEMİZLENİYOR. Eskiden yalnızca 'saha'ya girerken bugüne çekiliyor,
   * çıkarken bırakılıyordu; PLANLAMA sekmesi sessizce bugüne filtreli kalıyor ve kullanıcı
   * neredeyse boş bir liste görüp "kayıtlar gelmiyor" sanıyordu.
   */
  /*
    GUNLUK EKRANLAR (2026-08-24, kullanici istegi: "tum teslimattakiler sayfalarina tarih
    secimi ekle, otomatik bugun secili olsun, sahada da ayni sekilde olmaliydi").

    Saha Planlamasi ve Teslimattakiler gunluk calisilan ekranlardir: personel sabah actiginda
    O GUNUN islerini gormeli. Diger sekmelerde tarih kisiti yok.

    Ozellik daha once bir kez acilip GERI ALINMISTI (`dayScopedTab = false` diye sabitlenmisti):
    tarih sekmeden cikarken temizlenmiyor, PLANLAMA sekmesi sessizce bugune filtreli kaliyor ve
    kullanici bos liste gorup "kayitlar gelmiyor" saniyordu. Bu sefer iki koruma var:
      - sekme degisince tarih SIFIRLANIR (asagidaki etki),
      - hangi gune bakildigi ekranda ACIKCA yazar ve "Tumu" ile tek tikla kalkar (`GunSecici`).
  */
  const dayScopedTab = activeTab === 'saha' || activeTab === 'teslimat'

  useEffect(() => {
    if (activeTab !== 'saha') {
      setSahaShowAll(false)
    }
  }, [activeTab])

  useEffect(() => {
    // Gunluk sekmeye girerken BUGUN secili gelir; cikarken kisit tamamen kalkar ki
    // diger sekmeler sessizce filtreli kalmasin.
    const gunluk = activeTab === 'saha' || activeTab === 'teslimat'
    const varsayilan = gunluk ? bugunIso() : ''
    setDateFrom(varsayilan)
    setDateTo(varsayilan)
    setPage(1)
  }, [activeTab])

  /** Gün gezinme: seçili günü n gün kaydırır. Aralık tek gün olarak tutulur. */
  const shiftDay = (days: number) => {
    const base = dateFrom || todayIso()
    const d = new Date(`${base}T00:00:00`)
    d.setDate(d.getDate() + days)
    const next = d.toISOString().slice(0, 10)
    setDateFrom(next)
    setDateTo(next)
    setPage(1)
  }


  const [regions, setRegions] = useState<any[]>([])
  useEffect(() => {
    apiJson<any[]>('/api/regions')
      .then(data => setRegions(data || []))
      .catch(() => setRegions([]))
  }, [])

  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage] = useState(1)
  const pageSize = 200
  const [filteredRows, setFilteredRows] = useState<any[]>([])

  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [showFiltersMobile, setShowFiltersMobile] = useState(false)

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

  const { result, isLoading, error, updateStatus, assignTechnician, plan, refetch, markAsPrinted } = useServiceRecordsPaged({
    q: statusFromQ ? undefined : (q || undefined),
    status: statusFilter || statusFromQ || undefined,
    statuses: !statusFilter && !statusFromQ
      ? (activeTab === 'planlama' ? 'New,LargeProductPlanning,Postponed' : (activeTab === 'saha' ? 'FieldPlanned,Planned' : (activeTab === 'teslimat' ? 'InDelivery,Planned' : (activeTab === 'bekleyen' ? 'Workshop,InRepair,WaitingForParts,Delayed' : 'Ready,WorkshopReady,DeliveryPlanning'))))
      : undefined,
    type: 'Repair',
    category: 'large',
    scopeKey: TAB_PAGE_KEYS[activeTab],
    // Saha Planlaması "bugün yapılacak işler"dir, "bugün açılan kayıtlar" değil. O sekmede
    // süzme PLANLANAN güne göre yapılıyor; diğer sekmelerde oluşturma tarihi aralığı geçerli.
    //
    // ARALIK DA PLANLANAN GÜNE GÖRE SORULUR. Eskiden bu sekmede yalnızca `plannedDate` (tek
    // gün) gönderiliyordu: kullanıcı 03–13 arasını seçse bile bitiş tarihi hiçbir yere
    // gitmiyor, sorgu 03'e çöküyor ve "kayıt yok" çıkıyordu. Tek gün seçildiyse (başlangıç =
    // bitiş) eski davranış korunur, aralık seçildiyse plannedFrom/plannedTo kullanılır.
    plannedDate: dayScopedTab && (!dateTo || dateTo === dateFrom) ? (dateFrom || undefined) : undefined,
    plannedFrom: dayScopedTab && dateTo && dateTo !== dateFrom ? (dateFrom || undefined) : undefined,
    plannedTo: dayScopedTab && dateTo && dateTo !== dateFrom ? (dateTo || undefined) : undefined,
    dateFrom: dayScopedTab ? undefined : (dateFrom || undefined),
    dateTo: dayScopedTab ? undefined : (dateTo || undefined),
    page,
    pageSize: 1000,
    includePassive: showPassive,
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

  /**
   * Kaydı "Ertelendi" durumuna alır — SADECE DURUM DEĞİŞİR.
   *
   * Kullanıcı kuralı (2026-08-27): "ertelendi sadece status durumunu değiştirir ama
   * planlamada kalmaya devam eder, sadece planlamada olması lazım."
   *
   * Bu yüzden teknisyen ataması, planlanan gün ve açık görevler BİLEREK korunuyor —
   * ilk sürümde hepsi temizleniyordu, kural netleşince kaldırıldı. Planlamacı işi kimin,
   * hangi güne aldığını görmeye devam eder; ertelendiği rozetten belli olur.
   *
   * Sekme ayrımını durum yapıyor: sekmeler `statuses` sorgusuyla süzülüyor ve `Postponed`
   * yalnızca PLANLAMA sekmesinin sorgusunda var. Dolayısıyla kayıt sahadan/atölyeden düşer,
   * planlamada görünür — başka bir temizliğe gerek yok.
   *
   * Rozet de `plannedAt`e değil duruma bakıyor; planlanan günü dolu olsa bile "Ertelendi" yazar.
   */
  const ertele = async (row: any) => {
    try {
      await updateStatus(row.id, 'Postponed', 'Ertelendi.')
      toast.success('Kayıt ertelendi; planlama sekmesinde "Ertelendi" olarak duruyor.')
      await refetch()
    } catch (e: any) {
      toast.error(e?.message || 'Kayıt ertelenemedi.')
    }
  }

  /**
   * Kaydı doğrudan ATÖLYEYE alır — tek tıkla, çekmeceyi açmadan.
   *
   * Kullanıcı isteği (2026-08-27): "işlem deyince direkt atölyeye al diye bir buton olmalı,
   * basınca direkt atölyeye almamız lazım". Aynı işlem şimdiye kadar yalnızca SAHA
   * sekmesindeki çekmecenin durum listesinden yapılabiliyordu; planlama aşamasındaki bir
   * kaydı atölyeye almak için önce planlamak gerekiyordu.
   *
   * `ertele` ile aynı kurgu: SADECE DURUM değişir. Teknisyen ataması ve planlanan gün
   * korunur — kullanıcının erteleme için koyduğu kuralın aynısı, iki düğme aynı mantıkla
   * çalışsın. Sekme ayrımını durum yapıyor: `Workshop` yalnızca ATÖLYE sekmesinin
   * sorgusunda var, kayıt planlamadan düşüp oraya geçer.
   *
   * Not "sahada" demiyor: planlama sekmesindeki ürün henüz sahaya çıkmamıştır.
   */
  const atolyeyeAl = async (row: any) => {
    try {
      await updateStatus(row.id, 'Workshop', 'Atölyeye alındı.')
      toast.success('Kayıt atölye arıza listesine aktarıldı.')
      await refetch()
    } catch (e: any) {
      toast.error(e?.message || 'Kayıt atölyeye alınamadı.')
    }
  }

  /**
   * TESLİMAT PLANLAMA MODALININ ORTAK İŞİ.
   *
   * İki düğme de buraya bağlı (2026-08-27 kullanıcı isteği: "teslimata aktar yerine bir
   * seçenek daha olmalı, para değeri varsa yazıp direkt gerçekleşti seçilebilsin"):
   *
   *   'Planned'   → TESLİMATA AKTAR. Teslimat günü ve teknisyeni zorunlu; kayıt
   *                 Teslimattakiler sekmesine düşer.
   *   'Delivered' → DOĞRUDAN GERÇEKLEŞTİ. Teslimat adımı hiç yaşanmaz; kayıt kapanır.
   *                 Gün ve teknisyen aranmaz — planlanan bir teslimat yok.
   *
   * Ortak olan her şey aynı kalıyor: müşteri bilgisi düzeltmesi, yedek parça ve işçilik
   * bedelinden fatura, görsel yükleme. Gövde kopyalanmadı; iki ayrı kopya zamanla ayrışır ve
   * düzeltme birinde yapılıp diğerinde unutulurdu.
   */
  const teslimatiIsle = async (hedefDurum: 'Planned' | 'Delivered') => {

                      // Tarih/teknisyen yalnizca TESLIMATA AKTARMA icin zorunlu; dogrudan
                      // gerceklesmis bir iste teslimat plani diye bir sey yok.
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
                          const matchedRegion = regions.find((r: any) => r.id === planRegionId)
                          selectedRecord.customerName = planCustomerName
                          selectedRecord.customerPhone = planCustomerPhone
                          selectedRecord.customerAddress = planAddress
                          selectedRecord.regionId = planRegionId || null
                          selectedRecord.regionName = matchedRegion ? matchedRegion.name : undefined
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

                        let generatedOrderNo = ''

                        try {
                          // Bedelsiz iş faturaya gitmez; bkz. utils/fatura.ts
                          if (faturalanacakVar(laborPriceVal, itemsToSend)) {
                          const erpRes = await apiJson<any>('/api/erp/invoices/create-service-invoice', {
                            method: 'POST',
                            body: JSON.stringify({
                              customerCode: requireCari(selectedRecord),
                              productName: selectedRecord.productName,
                              price: laborPriceVal,
                              currencyTypeId: invoiceCurrencyTypeId,
                              items: itemsToSend,
                              serviceRecordId: String(selectedRecord.id),
                              serviceNumber: String(selectedRecord.serviceNumber || ''),
                              sourcePage: 'SahaAriza',
                              performerName: getUsername() || 'Servis Yetkilisi'
                            })
                          })
                          generatedOrderNo = erpRes?.data?.orderNo || ''
                          }
                        } catch (err: any) {
                          console.error('Invoice creation failed:', err)
                          toast.error(`Satış faturası taslağı oluşturulurken hata: ${err?.message || 'B2B ERP Servis Bağlantı Hatası'}`)
                        }

                        if (hedefDurum === 'Planned') await plan(selectedRecord.id, {
                          plannedDate: new Date(plannedDate).toISOString(),
                          technicianId: deliveryTechId
                        })

                        const sym = SERVICE_CURRENCY_OPTIONS.find(c => c.value === invoiceCurrencyTypeId)?.symbol ?? '₺'
                        const varsayilanNot = hedefDurum === 'Planned'
                          ? 'Teslimat planlandı ve satış faturasına aktarıldı.'
                          : 'Teslimata aktarılmadan doğrudan gerçekleşti olarak kapatıldı.'
                        let noteMsg = statusNote
                          ? `${hedefDurum === 'Planned' ? 'Teslimat Planlandı' : 'Gerçekleşti'}: ${statusNote}`
                          : varsayilanNot
                        if (totalInvoiceValue > 0 || generatedOrderNo) {
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
                        toast.success(hedefDurum === 'Delivered'
                          ? (generatedOrderNo
                              ? `İş gerçekleşti olarak kapatıldı ve B2B Satış Faturası taslağı (Sipariş No: ${generatedOrderNo}) oluşturuldu!`
                              : 'İş gerçekleşti olarak kapatıldı.')
                          : generatedOrderNo 
                          ? `Teslimat planlandı ve B2B Satış Faturası taslağı (Sipariş No: ${generatedOrderNo}) oluşturuldu!`
                          : 'Teslimat başarıyla planlandı ve Teslimattakiler sekmesine aktarıldı.')
                        await refetch()
                        if (plannedDate) await fetchTechWorkloads(plannedDate)
                        // Gerceklesen is teslimattakiler listesine dusmez; sekme degismez.
                        if (hedefDurum === 'Planned') setActiveTab('teslimat')
                      } catch (e: any) {
                        toast.error(e?.message || 'Planlama yapılamadı.')
                      } finally {
                        setActionLoading(false)
                      }  }


  const columns: TableColumn<any>[] = useMemo(() => {
    interface ExtendedTableColumn extends TableColumn<any> {
      primary?: boolean;
      hideOnMobile?: boolean;
      mobileFullWidth?: boolean;
    }
    const cols: ExtendedTableColumn[] = [
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
          <div className="text-xs text-gray-700">{row.productName}</div>
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
      key: 'plannedAt' as any,
      label: 'Planlanan Gün',
      searchable: true,
      filter: { type: 'date' },
      render: (_v, row) => {
        if (!row.plannedAt) return <span className="text-gray-400 font-medium">-</span>
        return <span className="text-xs text-gray-900 font-semibold">{new Date(row.plannedAt).toLocaleDateString('tr-TR')}</span>
      }
    },
    {
      key: 'assignedTechnicianName' as any,
      label: 'Atanan Personel',
      searchable: true,
      filter: { type: 'text' },
      render: (_v, row) => {
        const name = row.assignedTechnicianName || (row.assignedTechnicians && row.assignedTechnicians.length > 0 ? row.assignedTechnicians.join(', ') : null);
        if (!name) return <span className="text-gray-400 font-medium">-</span>
        return (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#B91C1C] shadow-2xs shrink-0" />
            <span className="text-xs font-semibold text-gray-900">{name}</span>
          </div>
        )
      }
    },
    {
      key: 'status' as any,
      label: 'Durum',
      searchable: true,
      filter: {
        type: 'select',
        options: Object.entries(statusConfig).map(([k, cfg]) => ({ label: cfg.label, value: k.toLowerCase() }))
      },
      render: (_v, row) => {
        /*
          ROZET GERÇEK PLANLAMA DURUMUNU GÖSTERİR (2026-08-26, kullanıcı: "planlananlar
          Planlandı dese daha iyi olur").

          Rozet yalnızca `status` alanına bakıyordu. Planlanmış bir kayıt — planlanan günü ve
          personeli belli — durum alanı henüz `New`'de kaldığı için listede "Plan Bekliyor"
          görünüyordu; ekranda tarih dolu ama rozet "bekliyor" diyordu ve kullanıcı işin
          planlanmadığını sanıyordu.

          Ölçü artık PLANLANAN GÜN: doluysa iş planlanmıştır, durum alanı ne derse desin.
          Planlama iptal edilince `plannedAt` sunucuda temizleniyor, dolayısıyla rozet
          kendiliğinden "Plan Bekliyor"a dönüyor — ayrı bir temizlik gerekmiyor.

          Yalnızca planlama aşamasındaki iki durumda uygulanır; sahaya aktarılmış ya da
          atölyeye düşmüş bir kaydın rozetini ezmez.
        */
        const planlamaAsamasi = row.status === 'New' || row.status === 'LargeProductPlanning'
        const planlanmis = planlamaAsamasi && Boolean(row.plannedAt)
        const cfg = planlanmis ? statusConfig.LargeProductPlanning : statusConfig[row.status]

        return (
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cfg?.color ?? 'bg-gray-100 text-gray-700 border-gray-200'}`}>
            {cfg?.label ?? row.statusLabel}
          </span>
        )
      }
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

        if (activeTab === 'planlama') {
          if (hasPermission('buyukUrun.sahaPlanlama')) {
            dropdownItems.push({
              key: 'sahaPlan',
              label: 'Planla',
              onClick: () => openSahaPlanModal(row)
            })
            dropdownItems.push({
              key: 'printSlip',
              // Basılmış kayıtta tik — montajdaki "Servis Fişi ✓" ile aynı gösterim.
              label: row.isPrinted ? 'Fiş Yazdır ✓' : 'Fiş Yazdır',
              onClick: () => void basVeDamgala(row)
            })

            // Aktarım YALNIZCA planlanmış kayıtta anlamlı. Planlanmamış (New) kayıtta düğmeyi
            // göstermek, basınca "planlanmış görev yok" hatası veren bir tuzak olurdu.
            if (row.status === 'LargeProductPlanning') {
              dropdownItems.push({
                key: 'sahayaAktar',
                label: 'Sahaya Aktar',
                onClick: () => void sahayaAktar(row)
              })
            }
          }
        } else if (activeTab === 'saha' || activeTab === 'bekleyen' || activeTab === 'teslimat') {
          if (hasPermission('buyukUrun.islemKaydet')) {
            dropdownItems.push({
              key: 'process',
              label: 'İşlem Yap',
              onClick: () => openDetail(row)
            })
          }

          /*
            SAHA'DA FİŞ YENİDEN BASIMI (2026-08-25 kullanıcı isteği).

            Planlama sekmesindeki "Fiş Yazdır" ile AYNI ŞEY DEĞİL: orası
            `printSlipAndFinalizePlan` çağırır, yani basımın yanında bekleyen saha planlamasını
            da tamamlar (kaydı FieldPlanned'a çeker). Sahadaki kayıt zaten planlanmış ve
            aktarılmıştır; oradan o fonksiyonu çağırmak, o sırada başka bir kayıt için
            bekleyen bir planlama varsa YANLIŞ KAYDI tamamlardı. Burada yan etkisiz,
            düz yeniden basım var.

            Yetki: sekmeyi görebilen basabilir. Basım hiçbir şey yazmıyor ve fişteki bilgilerin
            (müşteri, telefon, adres, ürün) hepsi zaten aynı satırda ekranda duruyor — yazma
            yetkisi aramak, teknisyene kağıdı yeniden veremeyen bir koordinatör üretirdi.
          */
          if (activeTab === 'saha') {
            dropdownItems.push({
              key: 'printSlip',
              label: row.isPrinted ? 'Fiş Yazdır ✓' : 'Fiş Yazdır',
              onClick: () => void basVeDamgala(row)
            })
          }
        } else if (activeTab === 'aktif') {
          if (hasPermission('buyukUrun.islemKaydet')) {
            dropdownItems.push({
              key: 'plan',
              label: 'Teslimat Planla',
              onClick: () => openPlanModal(row)
            })
            dropdownItems.push({
              key: 'return',
              label: 'Atölyeye Geri Al',
              onClick: async () => {
                if (!window.confirm(`${row.serviceNumber} numaralı arıza kaydı atölyeye geri alınacak ve B2B'deki satış faturası TASLAĞI iptal edilecek. Onaylıyor musunuz?`)) return
                try {
                  await apiJson(`/api/erp/invoices/cancel-service-invoice-by-record/${row.id}`, { method: 'DELETE' })
                  await updateStatus(row.id, 'Workshop', 'Atölyeye geri alındı; fatura taslağı iptal edildi.')
                  await apiJson(`/api/servicerecords/${row.id}/assign`, {
                    method: 'POST',
                    body: JSON.stringify({ technicianId: null })
                  }).catch(() => {})
                  toast.success('Kayıt atölyeye geri alındı, fatura taslağı iptal edildi.')
                  await refetch()
                } catch (err: any) {
                  toast.error(`Atölyeye geri alınamadı: ${err?.message || 'bilinmeyen hata'}. Fatura taslağı iptal edilemediği için kayıt olduğu yerde bırakıldı.`)
                }
              }
            })
          }
        } else {
          dropdownItems.push({
            key: 'process',
            label: 'İşlem Yap',
            onClick: () => openDetail(row)
          })
        }

        // Kagit fis no: hangi sekmede olursa olsun girilebilmeli — musteri elindeki
        // kagitla arayinca kaydin bulunmasi buna bagli.
        dropdownItems.push({
          key: 'fisNo',
          label: row.manualReceiptNo ? 'Fiş No Düzenle' : 'Fiş No Gir',
          onClick: () => setFisNoFor(row)
        })

        /*
          ERTELENDİ — TEK TIKLA PLANLAMAYA GERİ (2026-08-27 kullanıcı isteği).

          "Planlamayı İptal Et" ile AYNI temizliği yapar (teknisyen, planlanan gün ve açık
          görevler düşer) ama kaydı "Yeni Kayıt" değil "Ertelendi" durumuna alır: planlamacı
          bunun bir kez planlanıp geri çekildiğini görmeli, sıfırdan gelen kayıtla
          karışmamalı. Montaj tarafındaki "Ertelendi" ile aynı mantık.

          Yalnızca SAHA sekmesinde: planlamadaki kaydın ertelenecek bir planlaması yok,
          atölyedeki kaydın yeri de planlama değil.
        */
        // PLANLAMA ve SAHA sekmelerinde. Atölye/teslimat kaydının yeri planlama değil,
        // oradan ertelemek kaydı ait olmadığı listeye taşırdı.
        // Planlama sekmesinden tek tıkla atölyeye. Saha sekmesinde bu iş zaten çekmecenin
        // durum listesinde var; iki yerde iki farklı davranış olmasın diye oraya eklenmedi.
        if (activeTab === 'planlama') {
          dropdownItems.push({
            key: 'toWorkshop',
            label: 'Atölyeye Al',
            onClick: () => atolyeyeAl(row)
          })
        }

        if ((activeTab === 'saha' || activeTab === 'planlama') && row.status !== 'Postponed') {
          dropdownItems.push({
            key: 'postpone',
            label: 'Ertelendi',
            onClick: () => ertele(row)
          })
        }

        return (
          <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
            <ActionDropdown items={dropdownItems} buttonLabel="İşlem" />
          </div>
        )
      }
    }
    ];
    if (activeTab === 'bekleyen') {
      return cols.filter((col) => col.key !== 'assignedTechnicianName') as TableColumn<any>[];
    }
    return cols as TableColumn<any>[];
  }, [activeTab, technicians, navigate, refetch, updateStatus, regions])

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
    window.addEventListener('shell:saha-ariza-export', handleExport)
    return () => window.removeEventListener('shell:saha-ariza-export', handleExport)
  }, [exportCsv])

  const repairRecords = useMemo(() => {
    const baseRecords = records

    if (q.trim()) return baseRecords

    if (activeTab === 'planlama') {
      return baseRecords.filter(r => r.status === 'New' || r.status === 'LargeProductPlanning' || r.status === 'Postponed')
    }
    if (activeTab === 'saha') {
      return baseRecords.filter(r => r.status === 'FieldPlanned' || r.status === 'Planned')
    }
    if (activeTab === 'bekleyen') {
      return baseRecords.filter(r => r.status === 'Workshop' || r.status === 'InRepair' || r.status === 'WaitingForParts' || r.status === 'Delayed')
    }
    if (activeTab === 'aktif') {
      return baseRecords.filter(r => r.status === 'Ready' || r.status === 'WorkshopReady' || r.status === 'DeliveryPlanning')
    }
    if (activeTab === 'teslimat') {
      return baseRecords.filter(r => r.status === 'InDelivery' || r.status === 'Planned')
    }
    return baseRecords
  }, [records, activeTab, q])

  // ─── HAZIR ÜRÜN TESLİMAT PLANLAMA (aktif tab) ───
  const [planMode, setPlanMode] = useState<'list' | 'detail'>('list')
  const [planSelectedId, setPlanSelectedId] = useState<string | null>(null)
  const [planRecord, setPlanRecord] = useState<any | null>(null)
  const [planDetailLoading, setPlanDetailLoading] = useState(false)
  const [planDetailError, setPlanDetailError] = useState<string | null>(null)
  const [planTechId, setPlanTechId] = useState<string>('')
  const [planningSubmit, setPlanningSubmit] = useState(false)
  const [planSubmitError, setPlanSubmitError] = useState<string | null>(null)
  const [planSubmitSuccess, setPlanSubmitSuccess] = useState<string | null>(null)
  const [planWorkloads, setPlanWorkloads] = useState<Record<string, { count: number; records: any[] }>>({})
  const [planWorkloadsLoading, setPlanWorkloadsLoading] = useState(false)

  // Saha Planlama Modal states
  const [sahaPlanModalOpen, setSahaPlanModalOpen] = useState(false)
  const [planTasks, setPlanTasks] = useState<any[]>([])
  const [planTasksLoading, setPlanTasksLoading] = useState(false)
  const [planRowDate, setPlanRowDate] = useState<string>('')
  const [planRowTechId, setPlanRowTechId] = useState<string>('')
  const [planRowQty, setPlanRowQty] = useState<number>(1)
  const [planRowNote, setPlanRowNote] = useState<string>('')
  const [planRowAddress, setPlanRowAddress] = useState<string>('')
  const [planRowLoading, setPlanRowLoading] = useState(false)
  const [planRowError, setPlanRowError] = useState<string | null>(null)
  const [planRowSuccess, setPlanRowSuccess] = useState<string | null>(null)
  const [existingPlannedCount, setExistingPlannedCount] = useState<number>(0)
  const [planRemoveLoading, setPlanRemoveLoading] = useState(false)

  /**
   * MEVCUT PLANLAMAYI KALDIR — "planlanan tekrar planlanmıyor" (2026-08-27 bildirimi).
   *
   * Saha Planlaması modalinin SAĞ KOLONU tamamen `existingPlannedCount < 1` koşuluna
   * bağlıydı: kayıt bir kez planlandığında o kolonda hiçbir şey çizilmiyordu. Kullanıcı
   * planlanmış bir kaydı açıyor, sağ taraf bomboş geliyor ve planı değiştirmenin —
   * hatta ne olduğunu görmenin — hiçbir yolu olmuyordu.
   *
   * Görev SİLİNMEZ ve İPTAL EDİLMEZ: "Yeni Kayıt"a alınır (bkz. aşağıdaki not — iptal,
   * kaydın tamamını iptale düşürüyordu). Sayaç sıfırlanır, "Yeni Görev Ekle" formu geri gelir.
   */
  const planlamayiKaldir = async () => {
    if (!selectedId) return
    setPlanRemoveLoading(true)
    setPlanRowError(null)
    setPlanRowSuccess(null)
    try {
      const aktif = planTasks.filter((t: any) => {
        const st = t.status ?? t.Status
        return st !== 3 && st !== 4 && st !== 'Cancelled' && st !== 'Deferred'
      })
      for (const t of aktif) {
        /*
          SATIR "YENİ KAYIT"A ALINIR, İPTAL EDİLMEZ (2026-08-27 bildirimi:
          "yeniden planlayınca neden iptala düşüyor").

          Önce `Cancelled` gönderiliyordu. Sunucuda şöyle bir kural var: kaydın BÜTÜN
          görevleri iptalse kaydın kendisi de otomatik "İptal" yapılıyor. Arıza kaydının
          genelde tek görevi olduğu için, planlamayı kaldırmak kaydın tamamını iptale
          düşürüyordu — kullanıcı sadece günü/kişiyi değiştirmek isterken iş ölüyordu.

          `Deferred` ("Yeni Kayıt") aynı işi görür: satır planlamadan düşer, sayaç sıfırlanır
          ve "Yeni Görev Ekle" formu geri gelir. Ama kayıt iptale gitmez — sunucudaki iptal
          kuralı yalnızca `Cancelled` satırlara bakıyor.

          `reason` GÖNDERİLMEZ: sunucu alanı yalnızca gönderildiyse yazıyor, göndermek
          kalemin mevcut notunu ezerdi. Ne olduğu tarihçeye zaten yazılıyor.
        */
        await apiJson(`/api/installations/tasks/${t.id ?? t.Id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Deferred' })
        })
      }
      await fetchSahaTasks(selectedId)
      setPlanRowSuccess('Planlama kaldırıldı; aşağıdan yeniden planlayabilirsiniz. Kayıt iptal edilmedi.')
      await refetch()
    } catch (e: any) {
      setPlanRowError(e?.message || 'Planlama kaldırılamadı.')
    } finally {
      setPlanRemoveLoading(false)
    }
  }
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])

  const aktivRecords = useMemo(() => repairRecords.filter(r => r.status === 'Ready'), [repairRecords])

  const regionSummaryAktif = useMemo(() => {
    const map = new Map<string, { total: number; products: Record<string, number> }>()
    for (const r of aktivRecords) {
      const region = r.regionName || 'Bölge Yok'
      if (!map.has(region)) map.set(region, { total: 0, products: {} })
      const entry = map.get(region)!
      entry.total += 1
      entry.products[r.productName] = (entry.products[r.productName] ?? 0) + 1
    }
    return Array.from(map.entries()).map(([region, v]) => ({ region, ...v }))
  }, [aktivRecords])

  const [planRegionFilter, setPlanRegionFilter] = useState<string | null>(null)

  const filteredAktifRecords = useMemo(() => {
    if (!planRegionFilter) return aktivRecords
    return aktivRecords.filter(r => (r.regionName || 'Bölge Yok') === planRegionFilter)
  }, [aktivRecords, planRegionFilter])

  // Load plan workloads when date changes in detail mode
  useEffect(() => {
    if (planMode !== 'detail' || !planDate) return
    const ac = new AbortController()
    setPlanWorkloadsLoading(true)
    void (async () => {
      try {
        const params = new URLSearchParams({
          plannedFrom: `${planDate}T00:00:00`,
          plannedTo: `${planDate}T23:59:59`
        })
        const rows = await apiJson<any[]>(`/api/servicerecords?${params}`, { signal: ac.signal } as any)
        const map: Record<string, { count: number; records: any[] }> = {}
        for (const row of Array.isArray(rows) ? rows : []) {
          if (row.status === 'Delivered' || row.status === 'Cancelled') continue
          if (planSelectedId && row.id === planSelectedId) continue

          const techIds = new Set<string>()
          if (row.assignedTechnicianId) {
            techIds.add(String(row.assignedTechnicianId))
          }
          if (row.technicianId) {
            techIds.add(String(row.technicianId))
          }
          if (Array.isArray(row.installationTasks)) {
            for (const task of row.installationTasks) {
              if (task.assignedTechnicianId) {
                techIds.add(String(task.assignedTechnicianId))
              }
            }
          }

          for (const techId of techIds) {
            if (!map[techId]) map[techId] = { count: 0, records: [] }
            map[techId].count += 1
            map[techId].records.push(row)
          }
        }
        setPlanWorkloads(map)
      } catch { setPlanWorkloads({}) }
      finally { if (!ac.signal.aborted) setPlanWorkloadsLoading(false) }
    })()
    return () => ac.abort()
  }, [planMode, planDate, planSelectedId])

  const [saveInfoLoading, setSaveInfoLoading] = useState(false)
  const [saveInfoError, setSaveInfoError] = useState<string | null>(null)

  const saveSahaCustomerInfo = async () => {
    if (!selectedRecord) return
    if (!editName.trim()) {
      setSaveInfoError('Müşteri adı zorunludur.')
      return
    }
    if (!editPhone.trim()) {
      setSaveInfoError('Müşteri telefonu zorunludur.')
      return
    }
    if (!editAddress.trim()) {
      setSaveInfoError('Müşteri adresi zorunludur.')
      return
    }
    if (!editRegionId) {
      setSaveInfoError('Müşteri bölgesi seçilmelidir.')
      return
    }
    if (!editProductName.trim()) {
      setSaveInfoError('Cihaz / Ürün adı zorunludur.')
      return
    }
    setSaveInfoLoading(true)
    setSaveInfoError(null)
    try {
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
          warrantyStartDate: editIsUnderWarranty ? (editWarrantyStart || '') : '',
          dealerName: selectedRecord.dealerName || undefined,
          problemDescription: editProblemDescription || undefined,
          priority: editPriority,
          regionId: editRegionId || undefined,
          plannedDate: selectedRecord.plannedAt || undefined
        })
      })
      const matchedRegion = regions.find((r: any) => r.id === editRegionId)
      setSelectedRecord((prev: any) => prev ? {
        ...prev,
        customerName: editName,
        customerPhone: editPhone,
        customerAddress: editAddress,
        productName: editProductName,
        serialNumber: editSerial,
        isUnderWarranty: editIsUnderWarranty,
        warrantyStartDate: editIsUnderWarranty ? (editWarrantyStart || null) : null,
        problemDescription: editProblemDescription || undefined,
        priority: editPriority,
        regionId: editRegionId,
        regionName: matchedRegion ? matchedRegion.name : prev.regionName
      } : null)
      // Liste de tazelenir: yoksa satırdaki eski bilgiler (ve menüden basılan fiş) yerinde kalıyordu.
      void refetch()
      toast.success('Müşteri bilgileri başarıyla güncellendi.')
    } catch (e: any) {
      setSaveInfoError(e?.message || 'Bilgiler kaydedilemedi.')
    } finally {
      setSaveInfoLoading(false)
    }
  }

  const openPlanDetail = async (record: any) => {
    setPlanSelectedId(record.id)
    setPlanMode('detail')
    setPlanDetailError(null)
    setPlanDetailLoading(true)
    setPlanTechId(record.assignedTechnicianId ?? '')
    setPlanDate(record.plannedAt ? String(record.plannedAt).slice(0, 10) : new Date().toISOString().slice(0, 10))
    setPlanSubmitError(null)
    setPlanSubmitSuccess(null)
    try {
      const data = await apiJson<any>(`/api/servicerecords/${record.id}`)
      setPlanRecord(data)
    } catch (e: any) {
      setPlanDetailError(String(e?.message ?? 'Kayıt yüklenemedi'))
    } finally {
      setPlanDetailLoading(false)
    }
  }

  const fetchSahaTasks = async (recordId: string) => {
    setPlanTasksLoading(true)
    try {
      const tasks = await apiJson<any[]>(`/api/installations/tasks?serviceId=${recordId}`)
      const allTasks = Array.isArray(tasks) ? tasks : []
      setPlanTasks(allTasks)
      const planned = allTasks.filter((t: any) => {
        const s = t.status ?? t.Status
        return s !== 4 && s !== 3 && s !== 'Deferred' && s !== 'Cancelled'
      }).reduce((s, t) => s + (t.quantity || t.Quantity || 1), 0)
      setExistingPlannedCount(planned)
    } catch (e) {
      console.error('Error fetching tasks:', e)
      setPlanTasks([])
      setExistingPlannedCount(0)
    } finally {
      setPlanTasksLoading(false)
    }
  }

  const openSahaPlanModal = async (record: any) => {
    setSelectedId(record.id)
    setSelectedRecord(record)
    setPlanRowAddress(record.customerAddress || '')
    setPlanRowDate(record.plannedAt ? String(record.plannedAt).slice(0, 10) : new Date().toISOString().slice(0, 10))
    setPlanRowTechId(record.assignedTechnicianId || '')
    setPlanRowQty(1)
    setPlanRowNote('')
    setSelectedTaskIds([])
    setPlanRowError(null)
    setPlanRowSuccess(null)

    setEditName(record.customerName || '')
    setEditPhone(record.customerPhone || '')
    setEditAddress(record.customerAddress || '')
    setEditRegionId(record.regionId || '')
    setEditProductName(record.productName || '')
    setEditSerial(record.serialNumber || '')
    setEditPriority(record.priority || 'Normal')
    setEditIsUnderWarranty(!!record.isUnderWarranty)
    setEditWarrantyStart(garantiBaslangiciInput(record))
    setEditProblemDescription(record.problemDescription || '')

    setSahaPlanModalOpen(true)
    await fetchSahaTasks(record.id)
  }

  const submitSahaPlanRow = async () => {
    // TEKNİSYEN ZORUNLU DEĞİL (2026-08-25 kullanıcı isteği: "arızada personel atamadan
    // planlama yapabilmem lazım ki günü geldiğinde atayayım"). Tarih hâlâ zorunlu: planlama
    // demek işi bir güne yazmak demek.
    if (!planRowDate || !selectedRecord) return
    setPlanRowLoading(true)
    setPlanRowError(null)
    setPlanRowSuccess(null)
    try {
      const res = await apiJson<any>(`/api/installations/allocate`, {
        method: 'POST',
        body: JSON.stringify({
          plannedDateUtc: new Date(planRowDate).toISOString(),
          allocations: [{
            serviceId: selectedRecord.id,
            serviceRecordItemId: undefined,
            // Boş metin gönderilmez: sunucudaki alan `Guid?` ve "" model bağlamada 400'e düşer.
            technicianId: planRowTechId || undefined,
            quantity: 1,
            notes: planRowNote || undefined,
            customAddress: planRowAddress || undefined,
            plannedDateUtc: new Date(planRowDate).toISOString(),
          }],
          totalQuantity: 1,
        })
      })
      const createdCount = res?.created ?? res?.acceptedCount ?? 0
      const rejections = res?.rejectedAllocations ?? []
      const rejReason = rejections[0]?.reason ?? ''
      if (createdCount === 0) {
        const msg = rejReason === 'SkillMissing' ? 'Teknisyenin saha yetkisi yok.'
          : rejReason === 'RegionMismatch' ? 'Teknisyen farklı bölgede.'
          : rejReason === 'CapacityExceeded' ? 'Teknisyen kapasitesi dolu.'
          : rejReason === 'WorkingHours' ? 'Planlama saati çalışma saatleri dışında.'
          : `Planlama reddedildi (${rejReason || 'bilinmiyor'}). Lütfen farklı bir teknisyen veya tarih deneyin.`
        setPlanRowError(msg)
        setPlanRowLoading(false)
        return
      }

      // Automatically fetch updated tasks so we can get the allocated task ID, or query the tasks
      const tasksData = await apiJson<any[]>(`/api/installations/tasks?serviceId=${selectedRecord.id}`)
      const newestTask = Array.isArray(tasksData) 
        ? tasksData.filter((t: any) => t.status !== 3 && t.status !== 4 && t.status !== 'Cancelled' && t.status !== 'Deferred').sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
        : null

      /*
        PLANLAMA ARTIK SAHAYA AKTARMIYOR (2026-08-25).

        Burası `FieldPlanned` yazıyordu, yani "Planla" düğmesi kaydı aynı anda SAHA sekmesine
        atıyordu; planlayıp bekletmenin, günü gelince aktarmanın yolu yoktu. Artık kayıt
        `LargeProductPlanning` ile Planlama sekmesinde kalır. Aktarım satırdaki
        "Sahaya Aktar" işlemiyle yapılır (bkz. sahayaAktar).

        Küçük ürün dalına DOKUNULMADI: orası ayrı bir akış (Küçük Ürün Planlama).
      */
      const targetStatus = selectedRecord.productCategory === 'Small' || selectedRecord.productCategory === 1 ? 'Planned' : 'LargeProductPlanning'
      
      // Update the service record plan
      await apiJson(`/api/servicerecords/${selectedRecord.id}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({
          plannedDate: new Date(planRowDate).toISOString(),
          technicianId: planRowTechId || null,
          status: targetStatus
        })
      })

      // Update status and link tasks
      await apiJson(`/api/servicerecords/${selectedRecord.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: targetStatus,
          notes: 'Saha planlaması yapıldı; sahaya aktarım bekliyor.',
          taskIds: newestTask ? [newestTask.id] : undefined
        })
      })

      setSahaPlanModalOpen(false)
      toast.success('Planlandı. Sahaya aktarmak için satırdaki "Sahaya Aktar" işlemini kullanın.')
      await refetch()
    } catch (e: any) {
      setPlanRowError(e?.message || 'Görev planlanamadı.')
    } finally {
      setPlanRowLoading(false)
    }
  }

  const deletePlanTask = async (taskId: string) => {
    // Buradaki `window.confirm` KALDIRILDI: durum onay ekranı (5 sn geri sayımlı, görsel/not
    // özetli) artık isteğin kendisinde açılıyor ve iki üst üste onay penceresi çıkıyordu.
    // İptal geri alınamaz olduğu için özete kırmızı uyarı satırı bırakılıyor.
    try {
      describeNextStatusChange({
        kind: 'Saha Planlaması',
        toLabel: 'İptal',
        fromLabel: 'Planlandı',
        hasPhoto: false,
        warning: 'Planlama iptal edilir ve satır sahadan düşer.'
      })
      await apiJson(`/api/installations/tasks/${taskId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'Cancelled' }),
      })
      if (selectedRecord) {
        await fetchSahaTasks(selectedRecord.id)
      }
    } catch (e: any) {
      toast.error(e?.message || 'Planlama iptal edilemedi.')
    }
  }

  /**
   * SAHAYA AKTAR — planlamanın ikinci ve İSTEĞE BAĞLI adımı (2026-08-25 kullanıcı isteği).
   *
   * Planlama artık kaydı `LargeProductPlanning`'de bırakıyor; sahaya çıkış bu işlemle olur.
   * Böylece iş bugünden güne planlanıp, personeli/aktarımı günü geldiğinde yapılabiliyor.
   *
   * Arızada aktarım SUNUCUDA HİÇBİR ŞEY DAMGALAMAZ: `TransferredAt` bloğu yalnızca
   * `ServiceType.Installation` için çalışıyor (ServiceRecordService.UpdateStatusAsync).
   * Yani buradaki aktarım kaydın durumundan ibaret — montajdaki gibi satır bazlı kısmi
   * aktarım yok, fiş/iş emri kapısı da yok. Bu yüzden ayrı bir modal değil, tek işlem.
   */
  const sahayaAktar = async (row: any) => {
    try {
      /*
        ONAY KAPISI (2026-08-26, kullanıcı: "sahaya aktar deyip kaydet 5 sn beklemeden
        aktarıyor"). Kapı `apiFetch` içinde ama yalnızca `describeNextStatusChange` ile
        önceden tarif edilen geçişlerde açılıyor; bu fonksiyon onu çağırmadığı için aktarım
        geri sayımsız gidiyordu. Aktarım geri alınması zor bir adım, onay şart.
      */
      describeNextStatusChange({
        kind: 'Sahaya Aktarım',
        fromLabel: 'Planlandı',
        toLabel: 'Sahada',
        hasPhoto: false,
        warning: 'Kayıt SAHA sekmesine geçer ve planlamadan düşer.'
      })

      const tasksData = await apiJson<any[]>(`/api/installations/tasks?serviceId=${row.id}`)
      // İptal ve "yeni kayıt" satırları aktarılmaz — submitSahaPlanRow ile aynı süzgeç.
      const planli = (Array.isArray(tasksData) ? tasksData : []).filter(
        (t: any) => t.status !== 3 && t.status !== 4 && t.status !== 'Cancelled' && t.status !== 'Deferred'
      )

      if (planli.length === 0) {
        toast.error('Bu kayıt için planlanmış görev yok. Önce "Planla" deyin.')
        return
      }

      const ilk = planli[0]
      await apiJson(`/api/servicerecords/${row.id}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({
          plannedDate: ilk.plannedAt,
          // Personel atanmadan planlanmış olabilir; boş teknisyen null gider.
          technicianId: ilk.assignedTechnicianId || null,
          status: 'FieldPlanned'
        })
      })

      await apiJson(`/api/servicerecords/${row.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'FieldPlanned',
          notes: 'Sahaya aktarıldı.',
          taskIds: planli.map((t: any) => t.id)
        })
      })

      toast.success(`${row.serviceNumber} sahaya aktarıldı.`)
      await refetch()
    } catch (e: any) {
      toast.error(e?.message || 'Sahaya aktarılamadı.')
    }
  }

  const transferSelectedTasks = async () => {
    if (!selectedRecord || selectedTaskIds.length === 0) return
    const targetTaskId = selectedTaskIds[0]
    const targetTask = planTasks.find(t => t.id === targetTaskId)
    if (!targetTask) return

    setPlanRowLoading(true)
    try {
      const targetStatus = selectedRecord.productCategory === 'Small' || selectedRecord.productCategory === 1 ? 'Planned' : 'FieldPlanned'
      await apiJson(`/api/servicerecords/${selectedRecord.id}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({
          plannedDate: targetTask.plannedAt,
          technicianId: targetTask.assignedTechnicianId,
          status: targetStatus
        })
      })

      await apiJson(`/api/servicerecords/${selectedRecord.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: targetStatus,
          notes: 'Saha planlaması tamamlandı, görev sahaya aktarıldı.',
          taskIds: [targetTaskId]
        })
      })

      setSahaPlanModalOpen(false)
      setSelectedTaskIds([])
      toast.success('Saha planlaması başarıyla tamamlandı ve sahaya aktarıldı.')
      await refetch()
    } catch (e: any) {
      toast.error(e?.message || 'Planlama aktarılamadı.')
    } finally {
      setPlanRowLoading(false)
    }
  }

  const submitDeliveryPlan = async () => {
    if (!planSelectedId || !planDate || !planTechId) {
      setPlanSubmitError('Teknisyen ve tarih zorunludur.')
      return
    }
    setPlanningSubmit(true)
    setPlanSubmitError(null)
    setPlanSubmitSuccess(null)
    try {
      let generatedOrderNo = ''
      const planKalemleri = (planRecord?.workOrders || []).map((w: any) => ({
        stockCode: w.partNumber || w.id,
        description: w.partName || w.description,
        quantity: w.quantity || 1,
        price: w.isWarranty ? 0 : (w.unitPrice || 0),
        isWarranty: w.isWarranty || false
      }))
      try {
        // Bedelsiz iş faturaya gitmez; bkz. utils/fatura.ts
        if (faturalanacakVar(planRecord?.laborCost, planKalemleri)) {
        const erpRes = await apiJson<any>('/api/erp/invoices/create-service-invoice', {
          method: 'POST',
          body: JSON.stringify({
            customerCode: requireCari(planRecord || {}),
            productName: planRecord?.productName || 'Büyük Ürün',
            price: planRecord?.laborCost || 0,
            currencyTypeId: invoiceCurrencyTypeId,
            items: planKalemleri,
            serviceRecordId: String(planSelectedId),
            serviceNumber: String(planRecord?.serviceNumber || ''),
            sourcePage: 'BuyukUrunTeslimat'
          })
        })
        generatedOrderNo = erpRes?.data?.orderNo || ''
        }
      } catch (err: any) {
        // SESSİZ YUTMA KALDIRILDI: fatura oluşmasa bile akış devam ediyor ve kullanıcıya
        // "teslimat planlandı ve satış faturasına aktarıldı" deniyordu. Girilen ücret ve
        // yedek parçalar cariye hiç işlenmiyor, tek iz tarayıcı konsolunda kalıyordu.
        console.error('Invoice creation error:', err)
        setPlanSubmitError(
          `Teslimat planlanıyor ANCAK satış faturası oluşturulamadı: ${String(err?.message ?? 'bilinmeyen hata')} — ` +
          `girilen ücret ve yedek parçalar cariye İŞLENMEDİ.`
        )
      }

      await apiJson(`/api/servicerecords/${planSelectedId}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({ plannedDate: new Date(planDate).toISOString(), technicianId: planTechId, status: 'Planned' })
      })

      let noteMsg = 'Teslimat planlandı ve satış faturasına aktarıldı.'
      if (generatedOrderNo) {
        noteMsg += ` (B2B Sipariş No: ${generatedOrderNo})`
      }
      await updateStatus(planSelectedId, 'Planned', noteMsg)

      setPlanSubmitSuccess('Teslimat planlandı! Satış faturasına aktarıldı ve Teslimattakiler sekmesine yönlendiriliyorsunuz...')
      await refetch()
      await fetchTechWorkloads(planDate)

      setTimeout(() => {
        setPlanMode('list')
        setPlanSelectedId(null)
        setPlanRecord(null)
        setPlanSubmitSuccess(null)
        setActiveTab('teslimat')
      }, 1000)
    } catch (e: any) {
      setPlanSubmitError(String(e?.message ?? 'Planlama başarısız.'))
    } finally {
      setPlanningSubmit(false)
    }
  }

  const [selectedId, setSelectedId] = useState<string>('')
  const [drawerOpen, setDrawerOpen] = useState(false)

  const [selectedRecord, setSelectedRecord] = useState<any | null>(null)

  const [techStockItems, setTechStockItems] = useState<any[]>([])
  const [loadingTechStock, setLoadingTechStock] = useState(false)

  useEffect(() => {
    if (drawerOpen && selectedRecord?.assignedTechnicianId) {
      setLoadingTechStock(true)
      apiJson<{ success: boolean; data: any[] }>(`/api/erp/admin/technician-stock/${selectedRecord.assignedTechnicianId}`)
        .then(res => {
          setTechStockItems(res?.data ?? [])
        })
        .catch(err => {
          console.error('Failed to load technician stock:', err)
          setTechStockItems([])
        })
        .finally(() => {
          setLoadingTechStock(false)
        })
    } else {
      setTechStockItems([])
    }
  }, [drawerOpen, selectedRecord?.assignedTechnicianId])

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

    // 2. Teknisyen atanmışsa, araç deposundaki miktarları ez/ekle
    if (selectedRecord?.assignedTechnicianId && techStockItems.length > 0) {
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
  }, [stockItems, techStockItems, selectedRecord?.assignedTechnicianId])

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

  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  /**
   * Fişi doğrudan bastırır ve varsa bekleyen saha planlamasını tamamlar.
   *
   * Bu iş eskiden önizleme ekranının `onClose`'unda yapılıyordu; görüntüleyici kaldırıldığı için
   * (basım artık araya ekran koymadan yazdırma penceresini açıyor) aynı mantık buraya taşındı.
   */
  /**
   * Fişi basar ve kaydı "basıldı" diye damgalar (2026-08-25 kullanıcı isteği: "fiş yazdırınca
   * bir kere montajdaki gibi tik gelsin").
   *
   * Damga `IsPrinted`. Bu alan MONTAJDA sahaya aktarım kilididir; ARIZADA öyle değil —
   * `UpdateStatusAsync`'teki "fiş basılmadan sahaya aktarılamaz" kontrolü yalnızca
   * `ServiceType.Installation` dalının içinde. Yani burada bilgi amaçlı: menüdeki tik.
   *
   * Damgalama basımı BEKLETMEZ ve hatası basımı iptal etmez: kağıt zaten çıkmış olur,
   * damga yazılamadıysa tek kayıp menüdeki tiktir.
   */
  const basVeDamgala = async (record: any) => {
    // Liste satırı düzenlemeden sonra bayat kalabiliyor; fiş güncel kayıttan basılır.
    await printServiceSlipFresh(record)
    // Zaten damgalıysa sunucuya gitmeye gerek yok; tik menüde duruyor.
    if (!record?.id || record.isPrinted) return
    try {
      await markAsPrinted(record.id)
      // Tazeleme ŞART: tik satırın `isPrinted` alanından okunuyor, liste yenilenmeden gelmez.
      await refetch()
    } catch {
      /* tik gelmez, basım yine de yapıldı */
    }
  }

  /*
    ESKİDEN `printSlipAndFinalizePlan` DİYE AYRI BİR FONKSİYON VARDI; kaldırıldı.

    İçinde "bekleyen saha planlamasını tamamla" diye bir blok vardı: `pendingPlanRecord`
    doluysa kaydı `FieldPlanned`'a çekiyordu. O durumu HİÇBİR ŞEY doldurmuyordu —
    `setPendingPlanRecord` yalnızca `null` ile çağrılıyordu — yani blok hiç çalışmamış ölü
    koddu. Ölü olduğu iyi de olmuş: 2026-08-25'te planlamanın sahaya aktarmaması istendi,
    o blok canlı olsaydı fiş basımı kaydı sessizce sahaya atıyor olurdu.

    Blokla birlikte `pendingPlanRecord` durumu da kaldırıldı; çağıranlar `basVeDamgala`
    kullanıyor.
  */


const SERVICE_CURRENCY_OPTIONS = [
  { value: 1, label: 'TL (₺)', symbol: '₺', code: 'TRY' },
  { value: 3, label: 'USD ($)', symbol: '$', code: 'USD' },
  { value: 2, label: 'EUR (€)', symbol: '€', code: 'EUR' },
  { value: 4, label: 'GBP (£)', symbol: '£', code: 'GBP' }
]

  const [statusValue, setStatusValue] = useState<string>('New')
  const [statusNote, setStatusNote] = useState<string>('')
  const [invoicePrice, setInvoicePrice] = useState<string>('')
  const [invoiceCurrencyTypeId, setInvoiceCurrencyTypeId] = useState<number>(1)
  const [customCustomerCode, setCustomCustomerCode] = useState<string>('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  
  // Info popup
  const [infoPopupId, setInfoPopupId] = useState<string | null>(null)
  const [photoLightboxUrl, setPhotoLightboxUrl] = useState<string | null>(null)

  // Dealer lookup states
  const [erpDealers, setErpDealers] = useState<ErpDealerDto[]>([])
  const [loadingDealers, setLoadingDealers] = useState(false)
  const [dealerSearchQuery, setDealerSearchQuery] = useState('')

  // Info editing states
  const [isEditingInfo, setIsEditingInfo] = useState(false)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [editSerial, setEditSerial] = useState('')
  const [editProductName, setEditProductName] = useState('')
  const { onayIste, onayPenceresi } = useOnay()
  const [editProblemDescription, setEditProblemDescription] = useState('')
  const [editPriority, setEditPriority] = useState('')
  const [editIsUnderWarranty, setEditIsUnderWarranty] = useState(false)
  // Garanti başlangıç tarihi (yyyy-MM-dd). Garanti kutusu kalkınca boşalır — "Hayır" yazan
  // kaydın altında tarih asılı kalmasın.
  const [editWarrantyStart, setEditWarrantyStart] = useState('')
  const [editRegionId, setEditRegionId] = useState('')
  const [planAddress, setPlanAddress] = useState('')
  const [planRegionId, setPlanRegionId] = useState('')
  const [planCustomerName, setPlanCustomerName] = useState('')
  const [planCustomerPhone, setPlanCustomerPhone] = useState('')

  const [workloads, setWorkloads] = useState<Record<string, { count: number; records: any[] }>>({})
  const [workloadsLoading, setWorkloadsLoading] = useState(false)
  const [workloadsError, setWorkloadsError] = useState<string | null>(null)

  useEffect(() => {
    if (!drawerOpen) return
    const dateToUse = plannedDate || new Date().toISOString().slice(0, 10)

    const ac = new AbortController()
    setWorkloadsLoading(true)
    setWorkloadsError(null)

    void (async () => {
      try {
        const params = new URLSearchParams({
          plannedFrom: `${dateToUse}T00:00:00`,
          plannedTo: `${dateToUse}T23:59:59`
        })
        const rows = await apiJson<any[]>(`/api/servicerecords?${params}`, { signal: ac.signal } as any)
        const inactiveStatuses = new Set(['Delivered', 'Cancelled'])
        const map: Record<string, { count: number; records: any[] }> = {}

        for (const row of Array.isArray(rows) ? rows : []) {
          if (inactiveStatuses.has(String(row.status))) continue
          if (selectedId && row.id === selectedId) continue

          const techIds = new Set<string>()
          if (row.assignedTechnicianId) {
            techIds.add(String(row.assignedTechnicianId))
          }
          if (row.technicianId) {
            techIds.add(String(row.technicianId))
          }
          if (Array.isArray(row.installationTasks)) {
            for (const task of row.installationTasks) {
              if (task.assignedTechnicianId) {
                techIds.add(String(task.assignedTechnicianId))
              }
            }
          }

          for (const techId of techIds) {
            if (!map[techId]) map[techId] = { count: 0, records: [] }
            map[techId].count += 1
            map[techId].records.push(row)
          }
        }
        setWorkloads(map)
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
  }, [plannedDate, drawerOpen, selectedId])

  // Load workloads for Saha Planlama Modal when planRowDate or modal state changes
  useEffect(() => {
    if (!sahaPlanModalOpen) return
    const dateToUse = planRowDate || new Date().toISOString().slice(0, 10)

    const ac = new AbortController()
    setWorkloadsLoading(true)
    setWorkloadsError(null)

    void (async () => {
      try {
        const params = new URLSearchParams({
          plannedFrom: `${dateToUse}T00:00:00`,
          plannedTo: `${dateToUse}T23:59:59`
        })
        const rows = await apiJson<any[]>(`/api/servicerecords?${params}`, { signal: ac.signal } as any)
        const inactiveStatuses = new Set(['Delivered', 'Cancelled'])
        const map: Record<string, { count: number; records: any[] }> = {}

        for (const row of Array.isArray(rows) ? rows : []) {
          if (inactiveStatuses.has(String(row.status))) continue
          if (selectedId && row.id === selectedId) continue

          const techIds = new Set<string>()
          if (row.assignedTechnicianId) {
            techIds.add(String(row.assignedTechnicianId))
          }
          if (row.technicianId) {
            techIds.add(String(row.technicianId))
          }
          if (Array.isArray(row.installationTasks)) {
            for (const task of row.installationTasks) {
              if (task.assignedTechnicianId) {
                techIds.add(String(task.assignedTechnicianId))
              }
            }
          }

          for (const techId of techIds) {
            if (!map[techId]) map[techId] = { count: 0, records: [] }
            map[techId].count += 1
            map[techId].records.push(row)
          }
        }
        setWorkloads(map)
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
  }, [planRowDate, sahaPlanModalOpen, selectedId])

  useEffect(() => {
    let active = true
    setLoadingDealers(true)
    fetchErpDealers()
      .then(res => { if (active) setErpDealers(res) })
      .catch(err => console.error('fetchErpDealers error:', err))
      .finally(() => { if (active) setLoadingDealers(false) })
    return () => { active = false }
  }, [])

  const searchDealers = async () => {
    setLoadingDealers(true)
    try {
      const res = await fetchErpDealers(undefined, dealerSearchQuery)
      setErpDealers(res)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingDealers(false)
    }
  }

  const sortedTechnicians = useMemo(() => {
    const filtered = technicians.filter(t => {
      // 1. Only include Klima (KlimaEkibi) and Saha (SahaMontajEkibi) personnel
      const roles = t.roles || []
      const isFieldOrAc = roles.includes('SahaMontajEkibi') || roles.includes('KlimaEkibi')
      if (!isFieldOrAc) return false
      
      // 2. Apply search query filter if search text exists
      const q = techSearch.trim().toLowerCase()
      if (q) {
        return (t.fullName || '').toLowerCase().includes(q)
      }
      return true
    })

    return [...filtered].sort((a, b) => {
      const aRegion = selectedRecord?.regionId && a.primaryRegionId === selectedRecord.regionId ? 0 : 1
      const bRegion = selectedRecord?.regionId && b.primaryRegionId === selectedRecord.regionId ? 0 : 1
      if (aRegion !== bRegion) return aRegion - bRegion
      return (workloads[a.id]?.count ?? 0) - (workloads[b.id]?.count ?? 0)
    })
  }, [technicians, workloads, selectedRecord?.regionId, techSearch])

  const planningTechnicians = useMemo(() => {
    return technicians.filter(t => {
      const roles = t.roles || []
      return roles.includes('SahaMontajEkibi') || roles.includes('KlimaEkibi')
    })
  }, [technicians])

  /**
   * "i" düğmesi. Veriyi ARTIK ÇEKMİYOR: modal (ServisGecmisiModal) kaydı ve zaman
   * çizelgesini kendisi yüklüyor. Burada ikinci kez çekmek aynı istekleri boşuna
   * tekrarlıyor ve iki ayrı yerde biçimlendirilmiş iki tarihçe üretiyordu.
   */
  const openInfo = (id: string) => {
    setInfoPopupId(id)
  }

  const parsePartsFromNotes = (notesOrTimeline: any[]) => {
    if (!notesOrTimeline || notesOrTimeline.length === 0) return []
    const partsNotes = notesOrTimeline.filter((n: any) => {
      const text = String(typeof n === 'string' ? n : (n.content || n.note || n.description || n.statusNote || '')).toLowerCase()
      return text.includes('kullanılan parçalar:') || text.includes('kullanilan parcalar:')
    })
    if (partsNotes.length === 0) return []

    const map = new Map<string, any>()
    const result: any[] = []

    for (const partsNote of partsNotes) {
      const content = String(typeof partsNote === 'string' ? partsNote : (partsNote.content || partsNote.note || partsNote.description || partsNote.statusNote || ''))
      const matchSection = content.split(/kullanılan parçalar:|kullanilan parcalar:/i)[1]?.split('|')[0]?.split(';')[0]?.trim() || ''
      if (!matchSection) continue

      const regex = /([^,\[]+?)(?:\s*\[(Garantili|Bedelsiz)\])?\s*\(Adet:\s*(\d+)\)/gi
      let m

      while ((m = regex.exec(matchSection)) !== null) {
        const partName = m[1].trim()
        const isWarranty = Boolean(m[2])
        const quantity = parseInt(m[3], 10) || 1

        const matched = stockItems.find(p => 
          p.name.trim().toLowerCase() === partName.toLowerCase() ||
          (p.partNumber && p.partNumber.trim().toLowerCase() === partName.toLowerCase())
        )

        const k = partName.toLowerCase()
        if (!map.has(k)) {
          const itemObj = matched ? {
            id: matched.id,
            name: matched.name,
            partNumber: matched.partNumber || '',
            quantity,
            unitPrice: isWarranty ? 0 : (matched.unitPrice || 0),
            isWarranty
          } : {
            id: `custom-${Math.random()}`,
            name: partName,
            partNumber: '',
            quantity,
            unitPrice: 0,
            isWarranty
          }
          map.set(k, itemObj)
          result.push(itemObj)
        }
      }
    }

    return result
  }

  const fetchFullRecordParts = useCallback(async (record: any) => {
    if (!record || !record.id) return []
    try {
      const fullDetail = await apiJson<any>(`/api/servicerecords/${record.id}`)
      if (!fullDetail) return []

      const dbWorkOrders = Array.isArray(fullDetail.workOrders) ? fullDetail.workOrders : []
      const dbParts = dbWorkOrders.map((w: any) => ({
        id: w.id || w.partId || `part-${Math.random()}`,
        name: w.partName || w.description || w.name,
        partNumber: w.partNumber || w.stockCode || '',
        quantity: w.quantity || 1,
        unitPrice: typeof w.unitPrice === 'number' ? w.unitPrice : (w.isWarranty ? 0 : 0),
        isWarranty: Boolean(w.isWarranty)
      }))

      const allNotesSources = [
        ...(Array.isArray(fullDetail.notes) ? fullDetail.notes : []),
        ...(Array.isArray(fullDetail.timeline) ? fullDetail.timeline : []),
        ...(Array.isArray(fullDetail.history) ? fullDetail.history : []),
        ...(Array.isArray(record.notes) ? record.notes : []),
        ...(Array.isArray(record.timeline) ? record.timeline : []),
        { content: fullDetail.statusNote || '' },
        { content: record.statusNote || '' }
      ]

      const notesParts = parsePartsFromNotes(allNotesSources)

      const map = new Map<string, any>()
      for (const p of [...dbParts, ...notesParts]) {
        const k = (p.name || p.partNumber || p.id).trim().toLowerCase()
        if (!map.has(k)) {
          map.set(k, p)
        }
      }
      return Array.from(map.values())
    } catch {
      return parsePartsFromNotes([
        ...(Array.isArray(record.notes) ? record.notes : []),
        ...(Array.isArray(record.timeline) ? record.timeline : []),
        { content: record.statusNote || '' }
      ])
    }
  }, [stockItems])

  const openPlanModal = async (record?: any, overrideParts?: any[]) => {
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

    let fullDetail = rec
    if (rec && rec.id) {
      try {
        const fetched = await apiJson<any>(`/api/servicerecords/${rec.id}`)
        if (fetched) {
          fullDetail = fetched
          setSelectedRecord(fetched)
        }
      } catch (e) {
        console.error('Error loading detail for plan modal:', e)
      }
    }

    let partsToUse = overrideParts && overrideParts.length > 0 ? overrideParts : [...selectedParts]
    if (fullDetail) {
      const fetchedParts = await fetchFullRecordParts(fullDetail)
      const combined = [...fetchedParts, ...selectedParts]
      if (combined.length > 0) {
        const map = new Map<string, any>()
        for (const p of combined) {
          const k = (p.name || p.partNumber || p.id).trim().toLowerCase()
          if (!map.has(k)) {
            map.set(k, p)
          }
        }
        partsToUse = Array.from(map.values())
      }
    }

    setPlanParts(partsToUse)
    setSelectedParts(partsToUse)

    // Pre-fill labor cost if entered previously (or allow editing/entering)
    const existingLaborCost = getRecordPrice(fullDetail)
    const laborToSet = existingLaborCost > 0
      ? String(existingLaborCost)
      : (invoicePrice !== '' ? invoicePrice : (rec && getRecordPrice(rec) > 0 ? String(getRecordPrice(rec)) : ''))

    setPlanLaborFee(laborToSet)
    setPlanModalOpen(true)
  }

  const openDetail = async (record: any, defaultStatus?: string) => {
    setSelectedId(record.id)
    setSelectedRecord(record)

    const fetchedParts = await fetchFullRecordParts(record)
    setSelectedParts(fetchedParts)
    setPlanParts(fetchedParts)

    if ((activeTab as string) === 'aktif') {
      setDrawerOpen(false)
      openPlanModal(record, fetchedParts)
      return
    }

    setStatusValue(defaultStatus ?? record?.status ?? 'New')
    setStatusNote('')
    setInvoicePrice('')
    setInvoiceCurrencyTypeId(1)
    setCustomCustomerCode('')
    setDeliveryTechId(activeTab === 'aktif' ? '' : (record?.assignedTechnicianId ?? ''))
    setPlannedDate(record?.plannedAt ? String(record.plannedAt).slice(0, 10) : new Date().toISOString().slice(0, 10))
    setSelectedFiles([])
    setActionError(null)
    setActionSuccess(null)
    setIsEditingInfo(false)

    setEditName(record?.customerName || '')
    setEditPhone(record?.customerPhone || '')
    setEditAddress(record?.customerAddress || '')
    setEditSerial(record?.serialNumber || '')
    setEditProductName(record?.productName || '')
    setEditProblemDescription(record?.problemDescription || '')
    setEditPriority(record?.priority || 'Normal')
    setEditIsUnderWarranty(!!record?.isUnderWarranty)
    setEditWarrantyStart(garantiBaslangiciInput(record ?? {}))
    setEditRegionId(record?.regionId || '')

    setDrawerOpen(true)
  }

  return (
    <div className="flex flex-col">


      <div className="p-4 lg:p-6 flex flex-col gap-4">
        {/*
          GUN SECICI — yalnizca gunluk sekmelerde (Saha Planlamasi, Teslimattakiler).
          Varsayilan BUGUN; "Tumu" ile kisit kalkar. Sekme degisince tarih sifirlanir.
        */}
        {dayScopedTab && (
          <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
            <GunSecici
              deger={dateFrom}
              adet={filteredRows.length || undefined}
              onChange={(iso) => { setDateFrom(iso); setDateTo(iso); setPage(1) }}
            />
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-visible relative [--table-sticky-top:64px] lg:[--table-sticky-top:54px]">
          {error ? (
            <div className="py-8 text-center text-sm text-red-650">{error}</div>
          ) : erpLoading ? (
            <div className="py-8 text-center text-sm text-gray-500">Ürün listesi yükleniyor...</div>
          ) : erpError ? (
            <div className="py-8 text-center text-sm text-amber-600">{erpError}</div>
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
              groupByField={activeTab === 'saha' || activeTab === 'teslimat' ? 'plannedAt' : undefined}
            />
          )}
        </div>
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
                      <span className="font-semibold text-gray-500">Bölge <span className="text-red-500">*</span></span>
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
                      Ürün ARTIK LİSTEDEN seçiliyor (kullanıcı isteği, 2026-08-31). Serbest
                      metinken herkes farklı yazıyordu ("SB-168" / "SB 168" / "sb168") ve
                      kayıt ERP ürünüyle eşleşmiyordu. Liste gelmezse (ERP kapalı) seçici
                      yine de mevcut değeri gösterir; alttaki metin kutusu düzeltme için
                      açık bırakıldı, yoksa liste boşken ürün adı hiç değiştirilemezdi.
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

                    {/* Seri No: kaydetme kodu bunu ZATEN gönderiyordu, form alanı basılmıyordu. */}
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold text-gray-500">Seri No</span>
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
                  <div className="grid grid-cols-1 gap-3 text-xs">
                    <div className="flex justify-between items-center py-1 border-b border-gray-100">
                      <span className="font-semibold text-gray-500">Müşteri Adı:</span>
                      <span className="font-semibold text-gray-800">{selectedRecord.customerName || '-'}</span>
                    </div>

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

                    {selectedRecord.customerAddress && (
                      <div className="flex flex-col gap-1 py-1 border-b border-gray-100">
                        <span className="font-semibold text-gray-500">Müşteri Adres:</span>
                        <span className="text-gray-800 font-medium leading-relaxed">{selectedRecord.customerAddress}</span>
                      </div>
                    )}

                    <div className="flex justify-between items-center py-1 border-b border-gray-100">
                      <span className="font-semibold text-gray-500">Cihaz / Ürün:</span>
                      <span className="font-bold text-gray-800">{selectedRecord.productName}</span>
                    </div>

                    <div className="flex justify-between items-center py-1 border-b border-gray-100">
                      <span className="font-semibold text-gray-500">Seri No:</span>
                      <span className="font-mono text-gray-800 font-semibold">{selectedRecord.serialNumber || '-'}</span>
                    </div>

                    <div className="flex justify-between items-center py-1 border-b border-gray-100">
                      <span className="font-semibold text-gray-500">Garanti Durumu:</span>
                      <span className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${selectedRecord.isUnderWarranty ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {selectedRecord.isUnderWarranty ? 'Evet' : 'Hayır'}
                        </span>
                        {selectedRecord.isUnderWarranty && garantiBaslangici(selectedRecord) ? (
                          <span className="text-[10px] text-gray-500">{garantiBaslangici(selectedRecord)}</span>
                        ) : null}
                      </span>
                    </div>

                    {selectedRecord.dealerName && (
                      <div className="flex justify-between items-center py-1 border-b border-gray-100">
                        <span className="font-semibold text-gray-500">Bayi / Servis:</span>
                        <span className="font-semibold text-gray-800">{selectedRecord.dealerName}</span>
                      </div>
                    )}

                    {selectedRecord.problemDescription && (
                      <div className="flex flex-col gap-1 py-1 border-b border-gray-100">
                        <span className="font-semibold text-red-650">Arıza / Şikayet:</span>
                        <span className="text-gray-800 font-semibold leading-relaxed bg-red-50/50 p-2 rounded border border-red-100/50">{selectedRecord.problemDescription}</span>
                      </div>
                    )}

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
                {(activeTab === 'planlama' || activeTab === 'aktif') && (
                  <div className="space-y-4">
                    <div className="text-xs font-semibold text-gray-505">Planlama Tarihi <span className="text-red-500">*</span></div>
                    <input
                      type="date"
                      value={plannedDate}
                      onChange={(e) => setPlannedDate(e.target.value)}
                      className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C] mb-3"
                    />

                    <div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-2">
                      <div className="text-xs font-bold text-gray-800">Teknisyen İş Dağılımı <span className="text-red-500">*</span></div>
                      <div className="text-[10px] font-semibold text-gray-500">
                        {plannedDate ? new Date(`${plannedDate}T00:00:00`).toLocaleDateString('tr-TR') : '-'}
                      </div>
                    </div>

                    <div className="relative mb-2">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <input
                        value={techSearch}
                        onChange={(e) => setTechSearch(e.target.value)}
                        placeholder="Teknisyen ara..."
                        className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 focus:bg-white transition-all"
                      />
                    </div>

                    {workloadsLoading ? (
                      <div className="text-xs text-gray-500 py-3 text-center">İş dağılımı yükleniyor...</div>
                    ) : workloadsError ? (
                      <div className="text-xs text-red-650 py-3 text-center">{workloadsError}</div>
                    ) : (
                      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                        {sortedTechnicians.map((t) => {
                          const load = workloads[t.id]
                          const isSelected = deliveryTechId === t.id
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => setDeliveryTechId(t.id)}
                              className={`w-full text-left rounded-xl border p-3.5 transition flex items-center justify-between gap-3 ${
                                isSelected ? 'border-[#B91C1C] bg-red-50/50 ring-1 ring-[#B91C1C]' : 'border-gray-150 bg-white hover:border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                  isSelected ? 'bg-[#B91C1C] text-white' : 'bg-gray-100 text-gray-705'
                                }`}>
                                  {t.fullName.split(' ').filter(Boolean).slice(0, 2).map((n: string) => n[0]).join('') || '--'}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-gray-905 truncate">{t.fullName}</div>
                                  <div className="text-[10px] text-gray-500 truncate mt-0.5 font-medium">
                                    {load?.records?.[0]?.serviceNumber 
                                      ? `${load.records[0].serviceNumber} - ${load.records[0].customerName || 'Müşteri'}` 
                                      : 'Seçili tarihte aktif iş yok'}
                                  </div>
                                </div>
                              </div>
                              <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full shrink-0 ${
                                isSelected ? 'bg-[#B91C1C]/10 text-[#B91C1C]' : 'bg-gray-100 text-gray-700'
                              }`}>
                                {techWorkloads[t.id] ?? load?.count ?? 0} iş
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {activeTab !== 'planlama' && (
                  <>
                    <div className="text-xs font-semibold text-gray-500">Durum</div>
                    <select value={statusValue} onChange={(e) => setStatusValue(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]">
                      {activeTab === 'saha' && (
                        <>
                          <option value="Planned">Saha Planlamasında (İşlemde)</option>
                          <option value="Delivered">Tamamlandı (Fatura Oluştur & Teslim Et)</option>
                          <option value="Workshop">Atölyeye Al (Atölyede Tamir Et)</option>
                          <option value="Postponed">Ertelendi (Planlamaya Düşer)</option>
                          <option value="New">Planlamayı İptal Et (Bekleyene Al)</option>
                        </>
                      )}
                      {activeTab === 'bekleyen' && (
                        <>
                          <option value="Workshop">Atölyede</option>
                          <option value="InRepair">Tamirde</option>
                          <option value="WaitingForParts">Parça Bekliyor</option>
                          <option value="Ready">Hazır</option>
                          <option value="Delayed">Gecikti</option>
                          <option value="Cancelled">İptal</option>
                        </>
                      )}
                      {activeTab === 'aktif' && (
                        <>
                          <option value="Ready">Hazır</option>
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
                  </>
                )}
                {(activeTab === 'aktif' || activeTab === 'saha') && (
                  <div className="space-y-1 mt-3">
                    <div className="text-xs font-semibold text-gray-500">Teknisyen / Şoför</div>
                    <select
                      value={deliveryTechId}
                      onChange={(e) => setDeliveryTechId(e.target.value)}
                      disabled={activeTab === 'saha'}
                      className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C] disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed"
                    >
                      <option value="">Seçilmedi</option>
                      {planningTechnicians.map((t) => (
                        <option key={t.id} value={t.id}>{t.fullName}</option>
                      ))}
                    </select>
                  </div>
                )}





                {((activeTab === 'saha' && statusValue === 'Delivered') || (activeTab === 'bekleyen' && statusValue === 'Ready')) && (
                  <div className="border border-orange-200/80 rounded-2xl p-4 bg-gradient-to-br from-orange-50/50 via-white to-amber-50/30 space-y-4 mt-3 shadow-sm">
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-orange-100/80 pb-3">
                      <div>
                        <div className="text-xs font-extrabold text-slate-800 uppercase tracking-wide flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-orange-500 text-white flex items-center justify-center text-xs shadow-xs">⚙️</span>
                          {activeTab === 'saha' ? 'FATURA & ONARIM DETAYLARI (SAHA TESLİMİ)' : 'ATÖLYE ONARIM & HİZMET BEDELİ DETAYLARI'}
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

                    {/* Servis Onarım Bedeli / İşçilik */}
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
                            placeholder="Fiyat giriniz (Örn: 450)"
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

                {activeTab !== 'planlama' && (
                  <>
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
                  </>
                )}

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
                        onClick={async () => {
                          if (!window.confirm(`${selectedRecord.serviceNumber} numaralı arıza kaydı atölyeye geri alınacak ve B2B'deki satış faturası TASLAĞI iptal edilecek. Onaylıyor musunuz?`)) return
                          setActionLoading(true)
                          try {
                            // Bkz. listedeki aynı düğme: fatura işareti temizlenmezse düzeltilen
                            // ücret ve yedek parçalar bir daha cariye işlenmiyor.
                            await apiJson(`/api/erp/invoices/cancel-service-invoice-by-record/${selectedRecord.id}`, { method: 'DELETE' })
                            await updateStatus(selectedRecord.id, 'Workshop', 'Atölyeye geri alındı; fatura taslağı iptal edildi.')
                            await apiJson(`/api/servicerecords/${selectedRecord.id}/assign`, {
                              method: 'POST',
                              body: JSON.stringify({ technicianId: null })
                            }).catch(() => {})
                            setDrawerOpen(false)
                            toast.success('Kayıt atölyeye geri alındı, fatura taslağı iptal edildi.')
                            await refetch()
                          } catch (e: any) {
                            toast.error(`Atölyeye geri alınamadı: ${e?.message || 'bilinmeyen hata'}. Fatura taslağı iptal edilemediği için kayıt olduğu yerde bırakıldı.`)
                          } finally {
                            setActionLoading(false)
                          }
                        }}
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

                {selectedRecord && activeTab === 'planlama' && (
                  <button
                    type="button"
                    onClick={() => {
                      void basVeDamgala(selectedRecord)
                    }}
                    className="w-full py-2.5 px-4 mb-3 rounded-xl font-bold bg-gray-900 hover:bg-black text-white shadow transition flex items-center justify-between text-xs cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H7a2 2 0 00-2 2v4h10z" /></svg>
                      Servis Fişi Yazdır (Teknisyen & Tarihli)
                    </span>
                    <span className="font-mono">🖨️</span>
                  </button>
                )}

                <button
                  disabled={actionLoading}
                  onClick={async () => {
                    // ONAY EN BAŞTA SORULUR — akışın sonunda DEĞİL.
                    //
                    // Bu akış uzun: fatura oluştur → parça düş → fotoğraf yükle → durum yaz.
                    // Onay kapısı isteğin içinde olduğu için modal en sonda çıkıyordu; kullanıcı
                    // "İşleniyor..." görüyor, pencere gecikmeli beliriyordu. Daha kötüsü, o anda
                    // FATURA ZATEN KESİLMİŞ oluyordu: İptal denince fatura kesilmiş ama durumu
                    // yazılmamış bir kayıt kalıyordu. Onay artık hiçbir şey yapılmadan önce.
                    const gate = await confirmStatusChangeAhead({
                      kind: 'Servis Kaydı',
                      subject: [selectedRecord.serviceNumber, selectedRecord.productName].filter(Boolean).join(' · '),
                      fromLabel: selectedRecord.statusLabel || getStatusLabelTR(selectedRecord.status),
                      toLabel: getStatusLabelTR(statusValue),
                      hasPhoto: selectedFiles.length > 0,
                      photoCount: selectedFiles.length,
                      hasNote: Boolean(statusNote && statusNote.trim()),
                      note: statusNote || null,
                      details: deliveryTechId
                        ? [{
                            label: 'Teknisyen',
                            value: technicians.find((t: any) => t.id === deliveryTechId)?.fullName ?? '-'
                          }]
                        : undefined,
                      warning: statusValue === 'Delivered'
                        ? 'Bu işlem satış faturası taslağı oluşturur ve kullanılan parçaları stoktan düşer.'
                        : null
                    })
                    if (!gate.ok) return

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
                        editProblemDescription.trim() !== (selectedRecord.problemDescription || '').trim() ||
                        editPriority !== (selectedRecord.priority || 'Normal') ||
                        editIsUnderWarranty !== !!selectedRecord.isUnderWarranty ||
                        editWarrantyStart !== garantiBaslangiciInput(selectedRecord) ||
                        editRegionId !== (selectedRecord.regionId || '')

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
                        if (!editRegionId) {
                          setActionError('Müşteri bölgesi seçilmelidir.')
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
                            warrantyStartDate: editIsUnderWarranty ? (editWarrantyStart || '') : '',
                            dealerName: selectedRecord.dealerName || undefined,
                            problemDescription: editProblemDescription || undefined,
                            priority: editPriority,
                            regionId: editRegionId || undefined,
                            plannedDate: selectedRecord.plannedAt || undefined
                          })
                        })
                        const matchedRegion = regions.find((r: any) => r.id === editRegionId)
                        const updatedRecord = {
                          ...selectedRecord,
                          customerName: editName,
                          customerPhone: editPhone,
                          customerAddress: editAddress,
                          productName: editProductName,
                          serialNumber: editSerial,
                          isUnderWarranty: editIsUnderWarranty,
                          warrantyStartDate: editIsUnderWarranty ? (editWarrantyStart || null) : null,
                          problemDescription: editProblemDescription || undefined,
                          priority: editPriority,
                          regionId: editRegionId || null,
                          regionName: matchedRegion ? matchedRegion.name : undefined
                        }
                        setSelectedRecord(updatedRecord)
                        await refetch()
                        setIsEditingInfo(false)
                      }

                      if (activeTab === 'planlama') {
                        if (!plannedDate) {
                          setActionError('Lütfen planlama tarihi seçiniz.')
                          setActionLoading(false)
                          return
                        }
                        if (!deliveryTechId) {
                          setActionError('Lütfen planlama için bir teknisyen seçiniz.')
                          setActionLoading(false)
                          return
                        }
                        setActionLoading(true)
                        try {
                          await plan(selectedRecord.id, {
                            plannedDate: new Date(plannedDate).toISOString(),
                            technicianId: deliveryTechId,
                            status: 'FieldPlanned'
                          })
                          await updateStatus(selectedRecord.id, 'FieldPlanned', 'Saha planlaması yapıldı.')
                          setDrawerOpen(false)
                          toast.success('Saha planlaması başarıyla kaydedildi.')
                          await refetch()
                        } catch (err: any) {
                          toast.error(err?.message || 'Planlama kaydedilemedi.')
                        } finally {
                          setActionLoading(false)
                        }
                        return
                      }

                      let targetStatus = statusValue
                      let finalStatusNote = statusNote || undefined
                      const priceVal = parseFloat(invoicePrice)

                      /*
                        TEKNİSYEN YALNIZCA GERÇEKTEN DEĞİŞTİYSE ATANIR
                        (2026-08-26 bildirimi: "musa toktay ile sahadan atölyeye al diyorum 403").

                        Koşul `deliveryTechId` DOLU MU diye soruyordu. Oysa çekmece açılırken bu
                        alan kaydın MEVCUT teknisyeniyle dolduruluyor (`setDeliveryTechId(record
                        ?.assignedTechnicianId ?? '')`) ve saha sekmesinde seçim kutusu zaten
                        `disabled` — yani burada hiçbir zaman bir değişiklik olmuyor, çağrı her
                        seferinde AYNI kişiyi yeniden atıyordu.

                        Zararsız değildi: `/assign` ucu YÖNETİM yetkisi istiyor
                        (`CanManageRecordsAsync` → "Tüm İşleri Görme"). Kendi işini gören saha
                        teknisyeninde bu çağrı gövdesiz 403 dönüyor, hata yutulmadığı için de
                        durum değişikliğinin tamamı düşüyordu. Teknisyen kendi işini atölyeye
                        alamıyordu; yöneticide görünmüyordu çünkü onun kapsamı zaten "hepsi".

                        Üstelik "Atölyeye Al" dalı bir alt satırda teknisyeni SİLMEYE çalışıyor —
                        yani atama çağrısı o akışta baştan anlamsızdı.

                        Yetki kapısına dokunulmadı; yalnızca gereksiz çağrı kaldırıldı.
                      */
                      const mevcutTeknisyen = selectedRecord.assignedTechnicianId ?? ''
                      if (activeTab === 'saha' && deliveryTechId && deliveryTechId !== mevcutTeknisyen) {
                        await assignTechnician(selectedRecord.id, deliveryTechId)
                      }

                      if (activeTab === 'saha' && statusValue === 'Delivered') {
                        if (invoicePrice.trim() !== '' && (isNaN(priceVal) || priceVal < 0)) {
                          setActionError('Lütfen geçerli bir fatura bedeli giriniz.')
                          setActionLoading(false)
                          return
                        }

                        const itemsToSend = selectedParts.map(p => ({
                          stockCode: p.partNumber || p.id,
                          description: p.name,
                          quantity: p.quantity,
                          price: p.isWarranty ? 0 : p.unitPrice,
                          isWarranty: p.isWarranty
                        }))

                        /*
                          BEDELSİZ İŞ FATURASIZ KAPANIR (2026-08-27 bildirimi: "fiyat
                          yazmayınca fiyat girin diyor, bad request dönüyor").

                          ERP ucu faturalanacak hiçbir satır yoksa BİLEREK 400 dönüyor
                          ("Faturalanacak tutar yok") — bu 2026-08-21'de konmuş bir kural,
                          bedelsiz iş bayiye 0 TL'lik taslak fatura olarak düşmesin diye.
                          Doğru kural, ama burası ucu KOŞULSUZ çağırıyordu: fiyat girilmeden
                          "Tamamlandı" denince 400 dönüyor ve işin tamamı düşüyordu — kayıt
                          kapanmıyordu bile.

                          Artık fatura yalnızca faturalanacak bir şey varsa isteniyor:
                          işçilik bedeli girilmişse ya da faturaya girecek kalem seçilmişse.
                          Koşul ERP'deki kuralın aynısı; ikisi ayrışırsa yine 400 dönerdi.
                          Hiçbiri yoksa iş bedelsiz kapanır, fatura hiç istenmez.
                        */
                        if (faturalanacakVar(priceVal, itemsToSend)) {
                          const effectiveCustomerCode = requireCari(selectedRecord)
                          const erpRes = await apiJson<any>('/api/erp/invoices/create-service-invoice', {
                            method: 'POST',
                            body: JSON.stringify({
                              customerCode: effectiveCustomerCode,
                              productName: selectedRecord.productName,
                              price: isNaN(priceVal) ? 0 : priceVal,
                              currencyTypeId: invoiceCurrencyTypeId,
                              items: itemsToSend,
                              serviceRecordId: String(selectedRecord.id),
                              serviceNumber: String(selectedRecord.serviceNumber || ''),
                              sourcePage: 'SahaPlanlama'
                            })
                          })

                          const invoiceNo = erpRes?.data?.invoiceNo || ''
                          finalStatusNote = statusNote
                            ? `${statusNote} (Saha Onarımı Tamamlandı - Fatura No: ${invoiceNo})`
                            : `Saha Onarımı Tamamlandı. Fatura oluşturuldu (${invoiceNo})`

                          toast.success(`Saha onarımı tamamlandı ve B2B satış faturası taslağı oluşturuldu: ${invoiceNo}`)
                        } else {
                          finalStatusNote = statusNote
                            ? `${statusNote} (Saha Onarımı Tamamlandı - bedelsiz, fatura oluşturulmadı)`
                            : 'Saha Onarımı Tamamlandı. Bedelsiz iş; fatura oluşturulmadı.'

                          toast.success('Saha onarımı bedelsiz tamamlandı; fatura oluşturulmadı.')
                        }

                        targetStatus = 'Delivered'
                      } else if (activeTab === 'saha' && statusValue === 'Workshop') {
                        await apiJson(`/api/servicerecords/${selectedRecord.id}/assign`, {
                          method: 'POST',
                          body: JSON.stringify({ technicianId: null })
                        }).catch(() => {})

                        await plan(selectedRecord.id, {
                          plannedDate: null,
                          technicianId: null
                        }).catch(() => {})

                        targetStatus = 'Workshop'
                        finalStatusNote = 'Ürün sahada atölyeye alındı.'
                        toast.success('Kayıt atölye arıza listesine aktarıldı.')
                      } else if (activeTab === 'saha' && statusValue === 'Postponed') {
                        /*
                          ERTELENDİ — İŞLEM YAP ÇEKMECESİNDEN (2026-08-27 kullanıcı isteği:
                          "durum işlem yapta ertelendi olması lazım, görsel de eklenebilmeli").

                          Satır menüsündeki "Ertelendi" düğmesiyle AYNI kural: sadece durum
                          değişir, teknisyen ve planlanan gün korunur, kayıt planlama
                          sekmesine "Ertelendi" rozetiyle düşer.

                          Çekmeceden yapılmasının farkı NOT ve GÖRSEL: teknisyen neden
                          ertelendiğini yazıp fotoğraf ekleyebiliyor. İkisi de aşağıdaki ortak
                          akışta işleniyor — not `finalStatusNote` ile, görseller durum
                          yazıldıktan sonraki yükleme bloğuyla. Bu dalda ayrıca bir şey
                          yapmaya gerek yok, bu yüzden burada yalnızca durum ve varsayılan not
                          belirleniyor.
                        */
                        targetStatus = 'Postponed'
                        finalStatusNote = statusNote || 'Ertelendi.'
                        toast.success('Kayıt ertelendi; planlama sekmesinde "Ertelendi" olarak duruyor.')
                      } else if (activeTab === 'saha' && statusValue === 'New') {
                        await apiJson(`/api/servicerecords/${selectedRecord.id}/assign`, {
                          method: 'POST',
                          body: JSON.stringify({ technicianId: null })
                        }).catch(() => {})

                        await plan(selectedRecord.id, {
                          plannedDate: null,
                          technicianId: null
                        }).catch(() => {})

                        /*
                          AÇIK GÖREVLER DE İPTAL EDİLİR (2026-08-26, kullanıcı: "tekrar gelince
                          teknisyen atayamıyorum").

                          İptal, kaydın teknisyenini ve tarihini temizliyordu ama
                          `InstallationTask` satırları duruyordu. Saha Planlaması modalindeki
                          "Yeni Görev Ekle" paneli `existingPlannedCount < 1` koşuluna bağlı;
                          eski görev sayıldığı için panel bir daha AÇILMIYOR ve kayıt planlamaya
                          geri geldiğinde teknisyen atanamıyordu.

                          Hatalar yutuluyor: iptalin kendisi başarılıysa, artık görevin
                          kapanmaması yüzünden kullanıcıyı hataya düşürmenin anlamı yok.
                        */
                        try {
                          const acikGorevler = await apiJson<any[]>(`/api/installations/tasks?serviceId=${selectedRecord.id}`)
                          const iptalEdilecek = (Array.isArray(acikGorevler) ? acikGorevler : []).filter((t: any) => {
                            const st = t.status ?? t.Status
                            return st !== 3 && st !== 4 && st !== 'Cancelled' && st !== 'Deferred'
                          })
                          for (const g of iptalEdilecek) {
                            await apiJson(`/api/installations/tasks/${g.id ?? g.Id}/status`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status: 'Cancelled' })
                            }).catch(() => {})
                          }
                        } catch { /* görev listesi alınamadı; iptalin kendisi yine de geçerli */ }

                        targetStatus = 'New'
                        finalStatusNote = 'Saha planlaması iptal edildi, kayıt ilk kabul listesine geri alındı.'
                        toast.success('Planlama iptal edildi, kayıt bekleyen listesine geri alındı.')
                      } else if (activeTab === 'aktif' && deliveryTechId) {
                        if (!plannedDate) {
                          setActionError('Lütfen planlama tarihi seçiniz.')
                          setActionLoading(false)
                          return
                        }

                        if (invoicePrice.trim() !== '') {
                          if (isNaN(priceVal) || priceVal <= 0) {
                            setActionError('Lütfen geçerli bir fatura bedeli giriniz.')
                            setActionLoading(false)
                            return
                          }

                          // Teslimat planlamasıyla birlikte fatura.
                          //
                          // serviceRecordId ZORUNLU: bu tek çağrı onu göndermiyordu ve iki sonucu
                          // vardı — (1) fatura servis kaydına bağlanmadığı için "zaten
                          // faturalandı" kilidi hiç devreye girmiyor, teslim aşamasında ikinci
                          // bir fatura daha kesiliyordu; (2) fatura iptali kaydı bulamıyordu
                          // (B2B taslağı serviceRecordId üzerinden arıyor).
                          const effectiveCustomerCode2 = requireCari(selectedRecord)
                          const deliveryItems = selectedParts.map(p => ({
                            stockCode: p.partNumber || p.id,
                            description: p.name,
                            quantity: p.quantity,
                            price: p.isWarranty ? 0 : p.unitPrice,
                            isWarranty: p.isWarranty
                          }))

                          // Bedelsiz iş faturaya gitmez; bkz. utils/fatura.ts
                          let invoiceNo = ''
                          if (faturalanacakVar(priceVal, deliveryItems)) {
                          const erpRes = await apiJson<any>('/api/erp/invoices/create-service-invoice', {
                            method: 'POST',
                            body: JSON.stringify({
                              customerCode: effectiveCustomerCode2,
                              productName: selectedRecord.productName,
                              price: priceVal,
                              currencyTypeId: invoiceCurrencyTypeId,
                              items: deliveryItems,
                              serviceRecordId: String(selectedRecord.id),
                              serviceNumber: String(selectedRecord.serviceNumber || ''),
                              sourcePage: 'BuyukUrunHazirTeslimat',
                              performerName: getUsername() || 'Servis Yetkilisi'
                            })
                          })

                          invoiceNo = erpRes?.data?.invoiceNo || erpRes?.data?.orderNo || ''
                          }
                          finalStatusNote = statusNote 
                            ? `${statusNote}${invoiceNo ? ` (Fatura No: ${invoiceNo})` : ' (bedelsiz, fatura yok)'}` 
                            : (invoiceNo ? `Fatura oluşturuldu (${invoiceNo}) ve teslim edildi.` : 'Bedelsiz teslim edildi; fatura oluşturulmadı.')
                          
                          targetStatus = 'Delivered'
                          
                          await plan(selectedRecord.id, {
                            plannedDate: new Date(plannedDate).toISOString(),
                            technicianId: deliveryTechId
                          })

                          toast.success(`Ürün başarıyla teslim edildi ve fatura oluşturuldu: ${invoiceNo}`)
                        } else {
                          await plan(selectedRecord.id, {
                            plannedDate: new Date(plannedDate).toISOString(),
                            technicianId: deliveryTechId,
                            status: 'InDelivery'
                          })
                          targetStatus = 'InDelivery'
                          finalStatusNote = 'Hazır ürün teslimatı planlandı.'
                        }
                      } else if (activeTab === 'teslimat' && statusValue === 'Delivered') {
                        let invoiceNo = ''
                        let invoiceFailure = ''
                        const effectiveCustomerCode3 = requireCari(selectedRecord)
                        const effectivePrice = !isNaN(priceVal) && priceVal > 0 ? priceVal : getRecordPrice(selectedRecord)
                        const itemsToSend = (((selectedRecord as any)?.workOrders || []) as any[]).map((p: any) => ({
                          stockCode: p.partNumber || p.id,
                          description: p.partName || p.description,
                          quantity: p.quantity || 1,
                          price: p.isWarranty ? 0 : (p.unitPrice || 0),
                          isWarranty: p.isWarranty || false
                        }))

                        try {
                          // Bedelsiz iş faturaya gitmez; bkz. utils/fatura.ts
                          if (faturalanacakVar(effectivePrice, itemsToSend)) {
                          const erpRes = await apiJson<any>('/api/erp/invoices/create-service-invoice', {
                            method: 'POST',
                            body: JSON.stringify({
                              customerCode: effectiveCustomerCode3,
                              productName: selectedRecord.productName,
                              price: effectivePrice,
                              currencyTypeId: invoiceCurrencyTypeId,
                              items: itemsToSend,
                              serviceRecordId: String(selectedRecord.id),
                              serviceNumber: String(selectedRecord.serviceNumber || ''),
                              sourcePage: 'BuyukUrunTeslimat'
                            })
                          })
                          invoiceNo = erpRes?.data?.invoiceNo || erpRes?.data?.orderNo || ''
                          }
                        } catch (err: any) {
                          // Sessiz yutma kaldırıldı — teslim "başarılı" görünürken fatura hiç
                          // kesilmemiş oluyordu.
                          console.error('Invoice creation during delivery complete failed:', err)
                          invoiceFailure = String(err?.message ?? 'bilinmeyen hata')
                        }

                        targetStatus = 'Delivered'
                        finalStatusNote = statusNote
                          ? `${statusNote}${invoiceNo ? ` (Fatura No: ${invoiceNo})` : ''}`
                          : (invoiceNo ? `Fatura oluşturuldu (${invoiceNo}) ve teslim edildi.` : 'Müşteriye teslim edildi.')

                        if (invoiceFailure) {
                          toast.error(
                            `Ürün teslim edildi ANCAK satış faturası oluşturulamadı: ${invoiceFailure}\n\n` +
                            `Girilen ücret ve yedek parçalar cariye İŞLENMEDİ.`
                          )
                        } else {
                          toast.success('Ürün müşteriye başarıyla teslim edildi.')
                        }
                      } else if (activeTab === 'teslimat' && statusValue === 'Ready') {
                        await apiJson(`/api/erp/invoices/cancel-service-invoice-by-record/${selectedRecord.id}`, {
                          method: 'DELETE'
                        }).catch(() => {})

                        await apiJson(`/api/servicerecords/${selectedRecord.id}/assign`, {
                          method: 'POST',
                          body: JSON.stringify({ technicianId: null })
                        }).catch(() => {})

                        await plan(selectedRecord.id, {
                          plannedDate: null,
                          technicianId: null
                        }).catch(() => {})

                        targetStatus = 'Ready'
                        finalStatusNote = 'Teslimat planlaması iptal edildi, hazıra alındı.'
                        toast.success('Teslimat planlaması iptal edildi, kayıt hazıra geri alındı.')
                      } else if (activeTab === 'teslimat' && deliveryTechId) {
                      }

                      if (selectedParts.length > 0) {
                        const partsSummary = selectedParts.map(p => 
                          `${p.name || p.partNumber}${p.isWarranty ? ' [Garantili]' : ''} (Adet: ${p.quantity || 1})`
                        ).join(', ')
                        const partsStr = `Kullanılan Parçalar: ${partsSummary}`
                        if (!finalStatusNote || !finalStatusNote.includes('Kullanılan Parçalar:')) {
                          finalStatusNote = finalStatusNote ? `${finalStatusNote} | ${partsStr}` : partsStr
                        }
                      }

                      const pVal = parseFloat(invoicePrice)
                      if (!isNaN(pVal) && pVal > 0) {
                        const priceStr = `İşçilik Bedeli: ₺${pVal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`
                        if (!finalStatusNote || !finalStatusNote.includes('Bedeli')) {
                          finalStatusNote = finalStatusNote ? `${finalStatusNote} | ${priceStr}` : priceStr
                        }
                      }

                      await updateStatus(selectedRecord.id, targetStatus, finalStatusNote)

                      // Teslimattan geri çekilince (Ready): notlardan yedek parça stokunu iade et
                      if (activeTab === 'teslimat' && targetStatus === 'Ready') {
                        const notes: any[] = (selectedRecord as any).notes ?? []
                        const partsNote = notes.find((n: any) => (n.content || '').includes('Kullanılan Parçalar:'))
                        if (partsNote) {
                          const partsText = partsNote.content
                          const regex = /([^,]+)\s*\(Adet:\s*(\d+)\)/g
                          let m
                          while ((m = regex.exec(partsText)) !== null) {
                            const partName = m[1].replace(/.*Kullanılan Parçalar:\s*/, '').trim()
                            const quantity = parseInt(m[2], 10)
                            const matchedPart = stockItems.find(item => item.name.trim() === partName && item.type === 'SparePart')
                            if (matchedPart) {
                              const currentQty = matchedPart.quantity ?? 0
                              const newQty = currentQty + quantity
                              await apiJson(`/api/spareparts/${matchedPart.id}/stock`, {
                                method: 'PATCH',
                                body: JSON.stringify({ stockQuantity: newQty })
                              })
                            }
                          }
                        }
                      }

                      const uploadList = selectedFiles
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
                        setSelectedFiles([])
                      }

                      setSelectedRecord((prev: any) => prev ? { ...prev, status: targetStatus, statusLabel: getStatusLabelTR(targetStatus) } : null)
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
                      // Kapı serbest bırakılmazsa sonraki durum güncellemeleri onaysız geçer.
                      gate.release()
                    }
                  }}
                  className={
                    'w-full py-3 rounded-xl font-semibold transition-colors cursor-pointer shadow-sm flex items-center justify-center gap-2 ' +
                    (actionLoading
                      ? 'bg-gray-300 text-gray-600'
                      : statusValue === 'Ready'
                      ? 'bg-[#B91C1C] text-white hover:bg-red-800'
                      : 'bg-gray-900 text-white hover:bg-gray-800')
                  }
                >
                  {actionLoading ? 'İşleniyor...' : statusValue === 'Ready' ? 'Hazır ve Tamamla' : 'Durumu Kaydet'}
                </button>

                {activeTab !== 'planlama' && (
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
                    className="w-full mt-3 py-2 border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 rounded-xl font-medium hover:bg-red-100 dark:hover:bg-red-900/50 disabled:opacity-50 transition-all cursor-pointer text-xs"
                  >
                    Kayıt Sil
                  </button>
                )}
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
      {/* ─── SAHA PLANLAMA MODALI (Montaj Planlama ile Aynı Tasarım) ─── */}
      {sahaPlanModalOpen && selectedRecord && (
        <Modal
          isOpen={sahaPlanModalOpen}
          onClose={() => setSahaPlanModalOpen(false)}
          title="Saha Planlaması"
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
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">Saha Planlama</span>
                  </div>

                  {saveInfoError && (
                    <div className="p-3 bg-red-50 text-red-700 rounded-xl font-semibold">{saveInfoError}</div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Müşteri Adı Soyadı</label>
                      <input
                        type="text"
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-650 focus:border-red-650 transition"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Müşteri Telefonu</label>
                      <input
                        type="text"
                        value={editPhone}
                        onChange={e => setEditPhone(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-650 focus:border-red-650 transition"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Cihaz / Ürün Adı</label>
                      <input
                        type="text"
                        value={editProductName}
                        onChange={e => setEditProductName(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-650 focus:border-red-650 transition"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Seri Numarası</label>
                      <input
                        type="text"
                        value={editSerial}
                        onChange={e => setEditSerial(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-650 focus:border-red-650 transition"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Bölge</label>
                      <select
                        value={editRegionId}
                        onChange={e => setEditRegionId(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-650 focus:border-red-650 transition"
                      >
                        <option value="">Bölge Seçin</option>
                        {regions.map((r: any) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Öncelik</label>
                      <select
                        value={editPriority}
                        onChange={e => setEditPriority(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-650 focus:border-red-650 transition"
                      >
                        <option value="Low">Düşük</option>
                        <option value="Normal">Normal</option>
                        <option value="High">Yüksek</option>
                        <option value="Critical">Kritik</option>
                      </select>
                    </div>



                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Adres</label>
                      <textarea
                        value={editAddress}
                        onChange={e => setEditAddress(e.target.value)}
                        rows={3}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-650 focus:border-red-650 transition resize-none leading-relaxed"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={saveInfoLoading}
                      onClick={saveSahaCustomerInfo}
                      className="w-full bg-slate-800 hover:bg-slate-900 text-white rounded-xl py-2 font-bold transition text-xs disabled:opacity-50"
                    >
                      {saveInfoLoading ? 'Kaydediliyor...' : 'Bilgileri Kaydet'}
                    </button>
                  </div>
                </div>
              </div>

              {/* SAĞ KOLON: Planlama Formu & Görev Geçmişi */}
              <div className="lg:col-span-2 space-y-4">
                {/*
                  MEVCUT PLANLAMA — planlanmış kayıtta sağ kolon artık boş kalmıyor.
                  Kim, hangi güne planlamış görünür; "Planlamayı Kaldır" ile iptal edilip
                  yeniden planlanabilir.
                */}
                {existingPlannedCount >= 1 && (
                  <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 text-xs space-y-3">
                    <h3 className="font-extrabold text-slate-800 text-sm border-b border-gray-100 pb-2">
                      Mevcut Planlama
                    </h3>

                    {planRowError && (
                      <div className="p-3 bg-red-50 text-red-700 rounded-xl font-semibold">{planRowError}</div>
                    )}
                    {planRowSuccess && (
                      <div className="p-3 bg-green-50 text-green-700 rounded-xl font-semibold">{planRowSuccess}</div>
                    )}

                    <div className="space-y-2">
                      {planTasks
                        .filter((t: any) => {
                          const st = t.status ?? t.Status
                          return st !== 3 && st !== 4 && st !== 'Cancelled' && st !== 'Deferred'
                        })
                        .map((t: any) => {
                          const tarih = t.plannedAt ?? t.PlannedAt
                          const kisi = t.assignedTechnicianName ?? t.AssignedTechnicianName
                            ?? technicians.find((x: any) => x.id === (t.assignedTechnicianId ?? t.AssignedTechnicianId))?.fullName
                          return (
                            <div key={String(t.id ?? t.Id)} className="rounded-xl border border-gray-150 bg-gray-50 px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-[#B91C1C] shrink-0" />
                                <span className="font-bold text-gray-900">{kisi || 'Atanmadı'}</span>
                              </div>
                              <div className="text-[11px] text-gray-500 mt-1">
                                {tarih ? new Date(tarih).toLocaleDateString('tr-TR') : 'Tarih yok'}
                                {(t.customAddress ?? t.CustomAddress) ? ` · ${t.customAddress ?? t.CustomAddress}` : ''}
                              </div>
                            </div>
                          )
                        })}
                    </div>

                    <button
                      type="button"
                      disabled={planRemoveLoading}
                      onClick={planlamayiKaldir}
                      className="w-full bg-white border border-[#B91C1C] text-[#B91C1C] hover:bg-red-50 rounded-xl py-2 font-bold transition text-xs disabled:opacity-50"
                    >
                      {planRemoveLoading ? 'Kaldırılıyor...' : 'Planlamayı Kaldır ve Yeniden Planla'}
                    </button>
                  </div>
                )}

                {/* 2. Yeni Görev Ekle Formu */}
                {existingPlannedCount < 1 && (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {/* Left: Yeni Görev Ekle Form */}
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 text-xs space-y-4">
                      <h3 className="font-extrabold text-slate-800 text-sm border-b border-gray-100 pb-2">Yeni Görev Ekle</h3>
                      {planRowError && (
                        <div className="p-3 bg-red-50 text-red-700 rounded-xl font-semibold">{planRowError}</div>
                      )}
                      {planRowSuccess && (
                        <div className="p-3 bg-green-50 text-green-700 rounded-xl font-semibold">{planRowSuccess}</div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Tarih Seçin</label>
                          <input
                            type="date"
                            value={planRowDate}
                            onChange={e => setPlanRowDate(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-650 focus:border-red-650 transition"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Teknisyen Ataması</label>
                          <select
                            value={planRowTechId}
                            onChange={e => setPlanRowTechId(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-650 focus:border-red-650 transition"
                          >
                            <option value="">— Personel atamadan planla (sonra atanacak) —</option>
                            {technicians.map((t: any) => {
                              const load = workloads[t.id]?.count ?? 0
                              const isBusy = load >= 4
                              return (
                                <option key={t.id} value={t.id}>
                                  {t.fullName} ({load} İş - {isBusy ? 'Yoğun' : 'Uygun'})
                                </option>
                              )
                            })}
                          </select>
                        </div>

                        <div className="md:col-span-2">
                          <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Gidiş Adresi</label>
                          <input
                            type="text"
                            value={planRowAddress}
                            onChange={e => setPlanRowAddress(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-650 focus:border-red-650 transition"
                          />
                        </div>

                        <div className="md:col-span-2">
                          <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Planlama Notu</label>
                          <input
                            type="text"
                            value={planRowNote}
                            onChange={e => setPlanRowNote(e.target.value)}
                            placeholder="Görevle ilgili not ekleyin (örn: Öğleden sonra gidilecek)"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-red-650 focus:border-red-650 transition"
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={planRowLoading || !planRowDate}
                        onClick={submitSahaPlanRow}
                        className="w-full bg-[#B91C1C] hover:bg-red-800 text-white rounded-xl py-2.5 font-bold transition text-xs disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {planRowLoading ? 'Planlanıyor...' : 'PLANLA'}
                      </button>
                    </div>

                    {/* Right: Teknisyenin Bugünkü İşleri */}
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 text-xs space-y-4 flex flex-col">
                      <h3 className="font-extrabold text-slate-800 text-sm border-b border-gray-100 pb-2">
                        Teknisyenin Bugünkü İşleri ({planRowDate ? new Date(planRowDate).toLocaleDateString('tr-TR') : 'Bugün'})
                      </h3>
                      {workloadsLoading ? (
                        <div className="text-center py-8 text-slate-400">Yükleniyor...</div>
                      ) : !planRowTechId ? (
                        <div className="text-center py-8 text-slate-400">Lütfen bir teknisyen seçin.</div>
                      ) : !workloads[planRowTechId] || workloads[planRowTechId].records.length === 0 ? (
                        <div className="text-center py-8 text-slate-400">Teknisyenin bu tarihte planlanmış görevi bulunmuyor.</div>
                      ) : (
                  <div className="space-y-2 overflow-y-auto max-h-[220px] pr-1">
                          {workloads[planRowTechId].records.map((record: any) => (
                            <div key={record.id} className="border border-slate-100 bg-slate-50/50 rounded-xl p-3 space-y-1.5 shadow-2xs">
                              <div className="flex items-center justify-between">
                                <span className="font-mono font-black text-[#B91C1C] text-[10px]">{record.serviceNumber}</span>
                                <span className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                  {record.status || 'Planlandı'}
                                </span>
                              </div>
                              <div className="font-bold text-slate-800 text-[11px]">{record.customerName || 'Müşteri'}</div>
                              {record.productName && (
                                <div className="text-[10px] text-slate-600 font-medium">
                                  Cihaz: {record.productName}
                                </div>
                              )}
                              {record.address && (
                                <div className="text-[10px] text-slate-500 line-clamp-1" title={record.address}>
                                  Adres: {record.address}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                  {/* Alt İşlemler */}
                  <div className="flex justify-end gap-3 border-t border-gray-100 pt-4 mt-4">
                    <button
                      type="button"
                      onClick={() => setSahaPlanModalOpen(false)}
                      className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
                    >
                      Kapat
                    </button>
                  </div>
                </div>
              </div>
            </div>
        </Modal>
      )}

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
                          className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs font-semibold text-gray-750 focus:outline-none focus:ring-1 focus:ring-red-650 w-full"
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

              {/* SAĞ KOLON: Planlama Formu & Teknisyen İş Dağılımı */}
              <div className="lg:col-span-2 space-y-4">
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
                  <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                    <h3 className="font-bold text-gray-900 flex items-center gap-2 text-sm">
                      <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      Teslimat Planlama
                    </h3>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-xs">
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
                        {planningTechnicians.map((t) => {
                          const loadCount = techWorkloads[t.id] ?? workloads[t.id]?.count ?? 0
                          return (
                            <option key={t.id} value={t.id}>
                              {t.fullName} ({loadCount} iş)
                            </option>
                          )
                        })}
                      </select>
                    </div>
                  </div>

                  {/* Teknisyen İş Dağılımı Kutusu */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Teknisyen İş Dağılımı</div>
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between text-xs">
                      <div className="font-bold text-gray-800">
                        {deliveryTechId ? planningTechnicians.find(t => t.id === deliveryTechId)?.fullName || 'Teknisyen Seçilmedi' : 'Teknisyen Seçilmedi'}
                        <div className="text-[10px] font-normal text-gray-500 mt-0.5">Seçili tarihte aktif iş yükü</div>
                      </div>
                      <div className="text-right">
                        <span className={`font-bold px-2.5 py-1 rounded-full text-xs ${
                          techWorkloadsLoading || workloadsLoading
                            ? 'bg-gray-100 text-gray-500'
                            : deliveryTechId
                              ? ((techWorkloads[deliveryTechId] ?? workloads[deliveryTechId]?.count ?? 0) > 4 ? 'bg-amber-100 text-amber-900' : 'bg-orange-100 text-orange-950')
                              : 'bg-gray-100 text-gray-500'
                        }`}>
                          {techWorkloadsLoading || workloadsLoading
                            ? 'Yükleniyor...'
                            : deliveryTechId
                              ? `${techWorkloads[deliveryTechId] ?? workloads[deliveryTechId]?.count ?? 0} iş (${(techWorkloads[deliveryTechId] ?? workloads[deliveryTechId]?.count ?? 0) > 4 ? 'Yoğun' : 'Planlanabilir'})`
                              : '0 iş'}
                        </span>
                        <div className="text-[10px] text-gray-400 mt-0.5">{plannedDate || new Date().toLocaleDateString('tr-TR')}</div>
                      </div>
                    </div>
                  </div>

                  {/* SATIŞ FATURASI ÖNİZLEME (Taslak Kalemleri) */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-between border-b border-slate-200 pb-2">
                      <span className="flex items-center gap-1.5 text-slate-900">
                        <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        📋 SATIŞ FATURASI ÖNİZLEME (Fatura Taslağı)
                      </span>
                      <span className="text-[10px] text-gray-500 font-normal">Faturaya Aktarılacak Kalemler</span>
                    </div>

                    {/* Yedek Parça Kalemleri */}
                    {planParts.length > 0 ? (
                      <div className="space-y-2">
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
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
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
                          <span className="text-slate-700 uppercase tracking-wide">TOPLAM FATURA HESAPLANAN DÜŞECEK TUTAR:</span>
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
                      placeholder="Şoför veya teslimat için açıklama notu (Servis detayına eklenir)..."
                      className="w-full p-2.5 border border-gray-200 rounded-xl bg-white focus:ring-2 focus:ring-orange-500/20 text-xs"
                    />
                  </div>

                  <div className="space-y-1.5 text-xs">
                    <label className="font-bold text-gray-700 flex items-center justify-between">
                      <span>📷 Teslimat Görseli / Fotoğrafı (Opsiyonel)</span>
                      <span className="text-[10px] text-gray-400 font-normal">Servis detayında görünür</span>
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
                          {selectedFiles.length} Görsel Seçildi
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

      </div>
  )
}
