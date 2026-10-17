import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Filter,
  Plus,
  Download,
  Printer,
  MoreHorizontal,
  X,
  Phone,
  MapPin,
  AlertTriangle,
  Copy,
  Pencil,
  Search,
  Calendar,
  Trash2,
} from 'lucide-react'
import { apiJson } from '../api/client'
import { API_BASE_URL } from '../config'
import { getAccessToken, getDealerCode, getSingleDealerCode, hasAllDealers } from '../auth/storage'
import QuickAddCustomerModal from '../components/QuickAddCustomerModal'
import { applyDealerScope, canSeeMusteriCari } from '../auth/dealerScope'
import { useServiceRecordsPaged, type ServiceRecord } from '../hooks/useServiceRecords'
import { workshopDaysOf } from '../utils/atolyeGun'
import { AtolyeGunRozeti } from '../components/AtolyeGunRozeti'
import { useTechnicians } from '../hooks/useTechnicians'
import Table, { type TableColumn } from '../components/Table'
import { fetchServiceExport } from '../api/serviceRecords'
import { fetchErpProducts, fetchErpDealers, isYedekParcaProduct, type ErpProductDto, type ErpDealerDto } from '../api/erp'
import { sanitizeName, sanitizePhone, sanitizeSerial, isValidPhone, toTurkishUpper } from '../utils/formInput'
import SearchableProductSelect from '../components/SearchableProductSelect'
import { getCustomerOrDealerType, getCustomerTypeBadgeClass, TESLIM_KAYNAGI_MAGAZA, TESLIM_KAYNAGI_BAYI } from '../utils/customerType'
import { garantiBaslangici, garantiBaslangiciInput } from '../utils/garanti'
import { printServiceSlipFresh } from '../print/serviceSlip'
import DurumNotuVeGorselEkle from '../components/DurumNotuVeGorselEkle'
import { usePermissions } from '../auth/PermissionsContext'
import KabulTakvimModal from '../components/KabulTakvimModal'
import { toast } from 'sonner'
import { isStatusChangeCancelled } from '../api/statusChangeGate'
import PhoneLinks from '../components/PhoneLinks'
import FisNoModal from '../components/FisNoModal'
import MemnuniyetAnketiModal, { MemnuniyetHucresi } from '../components/MemnuniyetAnketiModal'
import GorselOnizleyici from '../components/GorselOnizleyici'

type RegionOption = { id: string; name: string }

/**
 * Kaç günden sonra kayıt "pasif" sayılır. Sunucudaki
 * `ServiceRecordService.PassiveAfterDays` ile AYNI olmalı — biri değişirse diğeri de.
 * Burada yalnız ROZET için kullanılıyor; süzme işini sunucu yapıyor.
 */
const PASSIVE_AFTER_DAYS = 90

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

const statusStyles: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700 border-blue-200',
  planned: 'bg-purple-100 text-purple-700 border-purple-200',
  workshop: 'bg-orange-100 text-orange-700 border-orange-200',
  inrepair: 'bg-amber-100 text-amber-700 border-amber-200',
  ready: 'bg-green-100 text-green-700 border-green-200',
  delivered: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
  delayed: 'bg-red-100 text-red-700 border-red-200',
  waitingforparts: 'bg-amber-100 text-amber-700 border-amber-200',
  // Aşağıdaki altı durum haritada yoktu; rozet varsayılan maviye düşüyordu.
  largeproductplanning: 'bg-purple-100 text-purple-700 border-purple-200',
  fieldplanned: 'bg-purple-100 text-purple-700 border-purple-200',
  indelivery: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  workshopready: 'bg-green-100 text-green-700 border-green-200',
  deliveryplanning: 'bg-purple-100 text-purple-700 border-purple-200',
  fieldcompleted: 'bg-green-100 text-green-700 border-green-200',
  smallproductacceptance: 'bg-blue-100 text-blue-700 border-blue-200',
  postponed: 'bg-amber-100 text-amber-800 border-amber-200',
}

function getStatusStyle(status: string) {
  return statusStyles[(status || '').toLowerCase()] || statusStyles.new
}

const statusTranslations: Record<string, string> = {
  new: 'Yeni Kayıt',
  planned: 'Planlandı',
  workshop: 'Atölyede',
  inrepair: 'Tamirde',
  ready: 'Hazır',
  delivered: 'Teslim Edildi',
  cancelled: 'İptal',
  delayed: 'Gecikti',
  waitingforparts: 'Parça Bekliyor',

  /*
    ÇEVRİLMEMİŞ DURUMLAR (2026-08-27 kullanıcı bildirimi: "LargeProductPlanning yazısını
    türkçe yap"). Haritada olmayan durum `defaultLabel || status`'a düşüyordu; sunucudaki
    çeviri de eksik olduğu için ekranda ham enum adı görünüyordu.

    `largeproductplanning` bilerek "Planlandı": Saha Arıza ekranı aynı kaydı zaten böyle
    gösteriyor, aynı duruma iki ekranda iki ad verilmemeli.
  */
  largeproductplanning: 'Planlandı',
  fieldplanned: 'Saha Planlamasında',
  indelivery: 'Teslimatta',
  workshopready: 'Atölye Tamamlandı',
  deliveryplanning: 'Teslimat Planlamasında',
  fieldcompleted: 'Sahada Tamamlandı',
  smallproductacceptance: 'Küçük Ürün Kabulünde',
  // Sahadan ertelenip planlamaya düşen kayıt; kabul listesinde de böyle görünmeli.
  postponed: 'Ertelendi',
}

function getStatusLabel(status: string, defaultLabel?: string, isPrinted?: boolean) {
  const key = (status || '').toLowerCase()
  if (key === 'new' && isPrinted) {
    return 'Plan Bekliyor'
  }
  return statusTranslations[key] || defaultLabel || status
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) {
    toast.warning('Dışa aktarılacak kayıt yok.')
    return
  }
  const headers = Object.keys(rows[0])
  const lines = [headers.join(',')]
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(','))
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const parseCombinedDescription = (description: string) => {
  const lines = (description || '').split('\n')
  let mainDesc = ''
  let serviceDesc = ''
  let addNotes = ''
  let invoiceNum = ''
  let wStartDate = ''
  let custType = 'Bireysel'

  for (const line of lines) {
    if (line.startsWith('Servis Açıklaması: ')) {
      serviceDesc = line.substring('Servis Açıklaması: '.length).trim()
    } else if (line.startsWith('Ek Açıklama: ')) {
      addNotes = line.substring('Ek Açıklama: '.length).trim()
    } else if (line.startsWith('Fatura Numarası: ')) {
      invoiceNum = line.substring('Fatura Numarası: '.length).trim()
    } else if (line.startsWith('Garanti Başlangıcı: ')) {
      wStartDate = line.substring('Garanti Başlangıcı: '.length).trim()
    } else if (line.startsWith('Müşteri Tipi: ')) {
      custType = line.substring('Müşteri Tipi: '.length).trim()
    } else {
      if (mainDesc) mainDesc += '\n'
      mainDesc += line
    }
  }

  return { mainDesc, serviceDesc, addNotes, invoiceNum, wStartDate, custType }
}

const getStatusLabelTR = (status?: string) => {
  if (!status) return '-'
  switch (status) {
    case 'New': return 'Yeni Kayıt'
    case 'Workshop': return 'Atölyede'
    case 'InRepair': return 'Tamirde'
    case 'WaitingForParts': return 'Parça Bekliyor'
    case 'Ready': return 'Hazır'
    case 'Delivered': return 'Teslim Edildi'
    case 'Cancelled': return 'İptal'
    case 'Delayed': return 'Gecikti'
    case 'Planned': return 'Teslimatta'
    default: return status
  }
}

const formatProblemDescriptionTR = (desc?: string) => {
  if (!desc) return '-'
  const cleaned = desc
    .split('\n')
    .filter(line => {
      const trimmed = line.trim()
      return (
        !trimmed.startsWith('Ek Açıklama:') &&
        !trimmed.startsWith('Garanti Başlangıcı:') &&
        !trimmed.startsWith('Müşteri Tipi:') &&
        !trimmed.startsWith('Fatura Numarası:') &&
        !trimmed.startsWith('Servis Açıklaması:')
      )
    })
    .join('\n')
    .trim()
  return cleaned || '-'
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

interface UrunKabulPageProps {
  categoryFilter?: 'large' | 'small'
}

export default function UrunKabulPage({ categoryFilter }: UrunKabulPageProps = {}) {
  const location = useLocation()
  const navigate = useNavigate()
  const { can } = usePermissions()
  const canSeeCalendar = can('takvim')
  const canCreate = categoryFilter === 'small'
    ? can('kucukUrunKabul.yeniKabul')
    : can('buyukEvAletleriKabul.yeniKabul')
  const [calendarModalOpen, setCalendarModalOpen] = useState(false)

  /**
   * `/…/yeni` adresi doğrudan kayıt formunu açar.
   *
   * Rota zaten tanımlıydı ama listeyle aynı ekranı gösteriyordu, yani "yeni kayıt" bağlantısı
   * hiçbir şey yapmıyordu. Büyük Ürün Planlama ekranındaki "Yeni Servis Kaydı" düğmesi buraya
   * yönlendiriyor.
   */
  const isCreateRoute = location.pathname.endsWith('/yeni')
  const [selectedRecord, setSelectedRecord] = useState<ServiceRecord | null>(null)
  // Kagit fis no modali: hangi kayit icin acik oldugu. null = kapali.
  const [fisNoFor, setFisNoFor] = useState<ServiceRecord | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [timeline, setTimeline] = useState<any[]>([])
  const [timelineDurum, setTimelineDurum] = useState<'bekliyor' | 'yukleniyor' | 'hazir'>('bekliyor')

  /*
    MEMNUNİYET ANKETİ ARTIK ORTAK BİLEŞENDE (2026-08-28).

    Bu sayfa anketin kendi kopyasını taşıyordu ve montaj tarafındakinden ayrışmıştı:
    puan 5 önseçili açılıyor, kayıt alındıktan sonra modal kilitleniyor (yanlış puan
    düzeltilemiyor), hücrede yıldız yerine "ALINMADI" rozeti çıkıyordu. Tek durum
    kaldı: anketi açılan kayıt. Puan/not/kaydetme işi MemnuniyetAnketiModal'ın.
  */
  const [satisfactionRecord, setSatisfactionRecord] = useState<ServiceRecord | null>(null)

  // Basım araya ekran koymadan doğrudan yazdırma penceresini açar (bayi programındaki gibi).
  // Önceki ReceiptPreviewModal/ReportPrintViewer görüntüleyicisi kaldırıldı.
  // Düzenlemeden sonra eski satır basılmasın diye kayıt basımdan hemen önce sunucudan okunur.
  const openPrintPreview = (record: ServiceRecord, _tasks: any[] = []) => {
    void printServiceSlipFresh(record)
  }

  const [createOpen, setCreateOpen] = useState(isCreateRoute && canCreate)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  const [newRecord, setNewRecord] = useState({
    plannedDate: new Date().toLocaleDateString('sv-SE'),
    isUnderWarranty: 'Bilinmiyor',
    magazadanTeslim: false,
    bayiyeTeslim: false,
    productName: '',
    warrantyStartDate: '',
    invoiceNumber: '',
    manualReceiptNo: '',
    serialNumber: '',
    serviceDescription: '',
    problemDescription: '',
    additionalNotes: '',
    customerType: 'Bayi',
    dealerName: '',
    dealerCode: '',
    dealerPhone: '',
    dealerAddress: '',
    customerName: '',
    customerPhone: '',
    regionId: '',
    customerAddress: '',
    priority: 'Normal',
    receivingNote: '', // Teslim alma notu
  })
  useEffect(() => {
    if (categoryFilter === 'small') {
      setNewRecord((p) => ({ ...p, customerType: 'Müşteri' }))
    }
  }, [categoryFilter])

  // `handleQuickCustomerSuccess` kaldırıldı: hızlı müşteri ekleme ekrandan çıktı.

  const [isEditing, setIsEditing] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    customerType: 'Bayi',
    dealerName: '',
    dealerCode: '',
    productName: '',
    serialNumber: '',
    isUnderWarranty: 'Hayır',
    warrantyStartDate: '',
    invoiceNumber: '',
    problemDescription: '',
    serviceDescription: '',
    additionalNotes: '',
    receivingNote: '',
    priority: 'Normal',
    regionId: '',
  })




  const { technicians } = useTechnicians()

  // Past date utility for past 7 days filter
  const getPastDateIso = (daysAgo: number) => {
    const d = new Date()
    d.setDate(d.getDate() - daysAgo)
    return d.toISOString().slice(0, 10) // YYYY-MM-DD
  }

  // Filter draft (Filtrele tıklayınca uygulanır), uygulanmış filtre ayrı state'te
  const [draftStatus, setDraftStatus] = useState('')
  const [draftQ, setDraftQ] = useState('')
  const [draftServiceNo, setDraftServiceNo] = useState('')
  const [draftWarranty, setDraftWarranty] = useState<'' | 'true' | 'false'>('')
  const [draftTechnicianId, setDraftTechnicianId] = useState('')
  const [draftDateType, setDraftDateType] = useState('') // '', 'equals', 'after', 'before', 'range'
  const [draftDateFrom, setDraftDateFrom] = useState('')
  const [draftDateTo, setDraftDateTo] = useState('')
  const [draftSatisfaction, setDraftSatisfaction] = useState<number | ''>('')

  const [appliedStatus, setAppliedStatus] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [appliedWarranty, setAppliedWarranty] = useState<'' | 'true' | 'false'>('')
  const [appliedTechnicianId, setAppliedTechnicianId] = useState('')
  const [appliedDateType, setAppliedDateType] = useState('')
  const [appliedDateFrom, setAppliedDateFrom] = useState('')
  const [appliedDateTo, setAppliedDateTo] = useState('')
  const [appliedSatisfaction, setAppliedSatisfaction] = useState<number | ''>('')
  const [page, setPage] = useState(1)
  /*
    SAYFA BOYUTU 50 DEĞİL (2026-08-23, kullanıcı bildirimi: "sadece 50 kayıt gösteriyor").

    Bu ekran sunucudan tek sayfa çekip listeyi İSTEMCİDE süzüyor ve sayfalıyor. `page`
    durumu var ama onu 1'den başka bir değere ayarlayan hiçbir düğme yok — yani sunucudan
    gelen ilk 50 kaydın ötesi ekranda ASLA görünmüyordu. Kolon süzgeçleri de yalnız o 50
    satırı arıyordu; 834 kayıt aktarılınca sorun görünür hâle geldi.

    Doğru çözüm sunucu tarafı süzgeç+sayfalama; o ayrı bir iş. Bu arada ekran, süzgeçten
    geçmiş kayıtların TAMAMINI alıyor ve alt taraftaki sayfalayıcı gerçeği gösteriyor.
    Varsayılan listede zaten 90 günden eskiler yok, dolayısıyla günlük kullanımda çekilen
    veri küçük; büyük liste yalnız "Pasife Alınanları Göster" işaretlenince oluşuyor.
  */
  const pageSize = 1000
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [showFiltersMobile, setShowFiltersMobile] = useState(false)

  // Reset selection on page or filter changes
  useEffect(() => {
    setSelectedIds([])
  }, [page, appliedStatus, appliedQ, appliedWarranty, appliedTechnicianId, appliedDateType, appliedDateFrom, appliedDateTo])

  /*
    Geçmişteki fotoğraflar `window.open` ile YENİ SEKMEDE açılıyordu — WebView
    uygulamasında bu kullanıcıyı tarayıcıya atıyor. Artık uygulama içinde
    yakınlaştırılabilir görüntüleyici açılıyor; listenin tamamı verilir ki oklarla gezilsin.
  */
  const [buyutulenGorseller, setBuyutulenGorseller] = useState<string[]>([])
  const [buyutulenIdx, setBuyutulenIdx] = useState<number | null>(null)
  const [erpProducts, setErpProducts] = useState<ErpProductDto[]>([])
  const [erpDealers, setErpDealers] = useState<ErpDealerDto[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [loadingDealers, setLoadingDealers] = useState(false)
  const [dealerSearchQuery, setDealerSearchQuery] = useState('')
  /**
   * SATIR İÇİ ARAMA (2026-08-21 kullanıcı kuralı).
   *
   * Eskiden üstte bir arama kutusu + "Ara" düğmesi, altında AYRI bir `select` vardı: kullanıcı
   * üstten arayıp alttan seçmek zorundaydı. Artık tek alan — yazdıkça sonuçlar altında açılır
   * ve tıklanarak seçilir. Liste kaynağı DEĞİŞMEDİ (`filteredDealersForType`), yalnızca sunum.
   */
  const [dealerListOpen, setDealerListOpen] = useState(false)

  /**
   * Arıza kabulünde seçilebilir ÜRÜNLER.
   *
   * Büyük/küçük ayrımı montajlı olmasına göre (`isInstallable`) — bu kural değişmedi.
   * Üstüne YEDEK PARÇALAR eleniyor (kullanıcı kararı, 2026-08-21): burada arızalanan CİHAZ
   * seçilir, parça değil. Katalogdaki 1117 aktif ürünün 951'i yedek parça olduğu için
   * süzülmediğinde liste fiilen yedek parça listesine dönüşüyordu.
   */
  const displayedProducts = useMemo(() => {
    const cihazlar = erpProducts.filter((p) => !isYedekParcaProduct(p))
    if (!categoryFilter) return cihazlar
    return cihazlar.filter((p) =>
      categoryFilter === 'large' ? p.isInstallable : !p.isInstallable
    )
  }, [erpProducts, categoryFilter])

  const [regions, setRegions] = useState<RegionOption[]>([])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const data = await apiJson<Array<{ id: string; name: string }>>('/api/regions', { signal: ac.signal } as any)
        setRegions((data ?? []).map((r) => ({ id: r.id, name: r.name })))
      } catch {
        setRegions([])
      }
    })()
    return () => ac.abort()
  }, [])

  useEffect(() => {
    let active = true
    setLoadingProducts(true)
    fetchErpProducts()
      .then(res => { if (active) setErpProducts(res) })
      .catch(err => console.error('fetchErpProducts error:', err))
      .finally(() => { if (active) setLoadingProducts(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    setLoadingDealers(true)
    /*
      AÇILIŞ LİSTESİ BİLEREK YALNIZCA BAYİ.

      Müşteri carisi 20.000'den fazla; açılışta çekmenin anlamı yok, seçim zaten aramayla
      yapılıyor (`searchDealers`). Ayrıca `type=all` üç ERP ucunu birden çağırıyor — sayfa
      açılışını en yavaş uca bağlamamak için burası tek uçta bırakıldı.
    */
    fetchErpDealers(undefined, undefined, 'bayi')
      .then(res => { if (active) setErpDealers(res) })
      .catch(err => console.error('fetchErpDealers error:', err))
      .finally(() => { if (active) setLoadingDealers(false) })
    return () => { active = false }
  }, [])

  /**
   * TEK CARİYE BAĞLI KULLANICIDA CARİ KENDİLİĞİNDEN SEÇİLİR (kullanıcı kararı, 2026-08-21).
   *
   * Bir bayide tek kullanıcı olduğu için seçilecek başka bir cari yok; her kayıtta aynı şeyi
   * aratmak gereksiz ve yanlış cari seçme riski taşıyor.
   *
   * Zorlama YALNIZCA tek cariye bağlı kullanıcıda yapılır: '*' (tüm cariler) ya da birden
   * fazla cari atanmış kullanıcıda seçim kullanıcınındır — orada doldurmak onu listedeki ilk
   * cariye kilitlerdi. Kullanıcı elle başka bir cari seçtiyse üzerine YAZILMAZ.
   */
  useEffect(() => {
    if (!createOpen) return
    const own = getSingleDealerCode()
    if (!own) return
    if (newRecord.dealerCode) return

    const matched = erpDealers.find(d => String(d.customerCode ?? '').toUpperCase() === own.toUpperCase())
    if (!matched) return

    // `customerType`e DOKUNULMUYOR: küçük ürün kabulünde onu ayrı bir kural belirliyor
    // (categoryFilter === 'small' → 'Müşteri') ve buradan da yazılırsa iki etki birbirini ezer.
    setNewRecord(p => ({
      ...p,
      dealerName: matched.name ?? p.dealerName,
      dealerCode: matched.customerCode ?? p.dealerCode,
      dealerPhone: matched.phone ? sanitizePhone(matched.phone) : p.dealerPhone,
      dealerAddress: matched.address || p.dealerAddress,
    }))
  }, [createOpen, erpDealers, newRecord.dealerCode])

  // Müşteri cari listesi ARTIK ÇEKİLMİYOR: arıza kabulünde seçim yalnızca bayi carileri
  // üzerinden yapılıyor (bkz. `selectableDealers`). İstek `pageSize=20000` ile bütün müşteri
  // carilerini indiriyordu ve sonucu hiçbir yerde kullanılmıyor.

  const searchDealers = async () => {
    setLoadingDealers(true)
    try {
      const qOriginal = dealerSearchQuery.trim()
      const qCleanDigits = qOriginal.replace(/\D/g, '')
      const qCleanNoZero = qCleanDigits.replace(/^0+/, '')

      const queries = [qOriginal]
      if (qCleanDigits && qCleanDigits !== qOriginal) queries.push(qCleanDigits)
      if (qCleanNoZero && qCleanNoZero !== qCleanDigits && qCleanNoZero !== qOriginal) queries.push(qCleanNoZero)

      /*
        MÜŞTERİ CARİLERİ ARTIK ARAMAYA GİRİYOR — AMA YALNIZCA ÇOK CARİLİ KULLANICIDA
        (2026-08-27 kullanıcı kuralı: "birden fazla cari atalı olanlarda müşteriler de
        gelmesi lazım, bayi göremeyecek").

        2026-08-21'de müşteri carileri (120-03…) tamamen kaldırılmıştı; sebebi bir bayi
        personelinin bütün carileri görebilmesiydi. O sakınca duruyor, bu yüzden kural
        kaldırılmadı, KAPSAMA BAĞLANDI: tek cariye bağlı OLMAYAN kullanıcı müşterileri de
        arayabilir, tek cariye bağlı bayi/alt bayi göremez. Ölçütün neden `hasAllDealers()`
        olmadığı `canSeeMusteriCari` başında yazılı.
      */
      const aramaTipi = canSeeMusteriCari() ? 'all' : 'bayi'
      const dealerResults = await Promise.all(
        queries.map(q => fetchErpDealers(undefined, q, aramaTipi).catch(() => []))
      )

      const newDealers = dealerResults.flat()

      if (newDealers.length > 0) {
        setErpDealers(prev => {
          const map = new Map<string, ErpDealerDto>()
          for (const item of [...prev, ...newDealers]) {
            const key = item.customerCode || item.name
            if (key) map.set(key, item)
          }
          return Array.from(map.values())
        })
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingDealers(false)
    }
  }

  /*
    ARAMA KUTUSU ARTIK GERÇEKTEN ARIYOR (2026-08-27 bildirimi: "-03 cariler gelmiyor").

    `searchDealers` TANIMLIYDI AMA HİÇBİR YERDEN ÇAĞRILMIYORDU: ayrı "Ara" düğmesi tek
    alanlı tasarıma geçilirken kaldırılmış, fonksiyon öksüz kalmış. Sonuç: yazdıkça ERP'ye
    hiç istek gitmiyor, açılır liste yalnızca sayfa açılışında gelen kayıtları süzüyordu.
    Bayiler göründüğü için sorun fark edilmiyordu — onlar açılışta zaten geliyordu.

    Müşteri carisi 20.000'den fazla; açılışta hepsini indirmek mümkün değil, o yüzden
    ARAMA ŞART. Gecikmeli çağrı: her tuşta istek atmamak için 350 ms bekleniyor, 2 harften
    kısa sorguda hiç aranmıyor.
  */
  useEffect(() => {
    const q = dealerSearchQuery.trim()
    if (q.length < 2) return
    const zamanlayici = window.setTimeout(() => { void searchDealers() }, 350)
    return () => window.clearTimeout(zamanlayici)
  }, [dealerSearchQuery])

  // `searchCustomerDealers` kaldırıldı: müşteri carisi arama kutusu ekrandan çıktı.

  /**
   * ARIZA KABULÜNDE SEÇİLEBİLİR CARİLER — TEK KAYNAK (kullanıcı kararı, 2026-08-21).
   *
   * Eskiden her seçim yerinde bayi ve müşteri listeleri ayrı ayrı birleştiriliyordu:
   * liste MÜŞTERİ carilerini de içeriyor ve kullanıcının cari yetkisine hiç bakmıyordu, yani
   * bir bayi personeli bütün carileri görebiliyordu. Altı ayrı yerde tekrarlandığı için birini
   * düzeltmek yetmezdi — kural buraya alındı, bütün seçiciler buradan okur.
   *
   * Kural: kaynak yalnızca BAYİ listesi → oturumun cari yetkisi → müşteri carileri (120-03…)
   * elenir. Atanmış carinin alt hesapları (`-1`/`-2`/`-3`) korunur.
   */
  const selectableDealers = useMemo(() => {
    const map = new Map<string, ErpDealerDto>()
    for (const item of erpDealers) {
      const codeKey = item.customerCode || item.name
      if (codeKey) map.set(codeKey, item)
    }
    // Bayi kapsamı + müşteri görünürlüğü tek yerde: bkz. `applyDealerScope`.
    // Müşteri carileri bayi kapsamından muaftır, yoksa ERP'den gelseler bile burada eleniyorlardı.
    return applyDealerScope(Array.from(map.values()))
  }, [erpDealers])

  const filteredDealersForType = useMemo(() => {
    const uniqueItems = selectableDealers

    const qLower = (dealerSearchQuery || '').trim().toLowerCase()
    const cleanDigits = qLower.replace(/\D/g, '')
    const cleanNoZero = cleanDigits.replace(/^0+/, '')

    return uniqueItems.filter(d => {
      if (!qLower) return true

      const nameStr = (d.name || '').toLowerCase()
      const codeLower = (d.customerCode || '').toLowerCase()
      const rawPhoneLower = (d.phone || '').toLowerCase()
      const phoneDigits = (d.phone || '').replace(/\D/g, '')
      const phoneNoZero = phoneDigits.replace(/^0+/, '')

      const matchesName = nameStr.includes(qLower)
      const matchesCode = codeLower.includes(qLower)
      const matchesRawPhone = rawPhoneLower.length > 0 && rawPhoneLower.includes(qLower)
      const matchesPhoneDigits = cleanDigits.length > 0 && phoneDigits.length > 0 && phoneDigits.includes(cleanDigits)
      const matchesPhoneNoZero = cleanNoZero.length > 0 && phoneNoZero.length > 0 && phoneNoZero.includes(cleanNoZero)

      return matchesName || matchesCode || matchesRawPhone || matchesPhoneDigits || matchesPhoneNoZero
    })
  }, [selectableDealers, newRecord.customerType, categoryFilter, dealerSearchQuery])

  /**
   * Listeden bir cari seçildiğinde formu dolduran tek yer.
   *
   * Eskiden bu mantık `select`in `onChange`ı içinde, seçilen METİNDEN cari geri bulunarak
   * çalışıyordu (isim/kod/etiket üç ayrı biçimde deneniyordu). Artık nesne doğrudan elde,
   * geri eşleştirmeye gerek yok — aynı isimli iki cari olduğunda yanlışını seçme ihtimali de
   * böylece kalktı. Tip, cari kodunun önekinden belirleniyor: 120-01 Bayi, 120-04 Mağaza,
   * 120-03 Müşteri.
   */
  const applyDealerSelection = (d: ErpDealerDto) => {
    const code = d.customerCode || ''
    let detectedType = 'Müşteri'
    if (code.startsWith('120-01') || code.startsWith('120-1')) {
      detectedType = 'Bayi'
    } else if (code.startsWith('120-04') || code.startsWith('120-4')) {
      detectedType = 'Mağaza'
    } else if (code.startsWith('120-03') || code.startsWith('120-3')) {
      detectedType = 'Müşteri'
    }

    setNewRecord((p) => ({
      ...p,
      customerType: detectedType,
      dealerName: d.name || '',
      dealerCode: code,
      dealerPhone: d.phone ? sanitizePhone(d.phone) : p.dealerPhone,
      dealerAddress: d.address || p.dealerAddress,
    }))
    setDealerSearchQuery(d.name || '')
  }

  const dateRange = useMemo(() => {
    if (!appliedDateType || !appliedDateFrom) return { dateFrom: undefined, dateTo: undefined }
    if (appliedDateType === 'equals') {
      return { dateFrom: `${appliedDateFrom}T00:00:00`, dateTo: `${appliedDateFrom}T23:59:59` }
    }
    if (appliedDateType === 'after') {
      return { dateFrom: `${appliedDateFrom}T00:00:00`, dateTo: undefined }
    }
    if (appliedDateType === 'before') {
      return { dateFrom: undefined, dateTo: `${appliedDateFrom}T23:59:59` }
    }
    if (appliedDateType === 'range') {
      return {
        dateFrom: appliedDateFrom ? `${appliedDateFrom}T00:00:00` : undefined,
        dateTo: appliedDateTo ? `${appliedDateTo}T23:59:59` : undefined
      }
    }
    return { dateFrom: undefined, dateTo: undefined }
  }, [appliedDateType, appliedDateFrom, appliedDateTo])

  /**
   * PASİFE ALINANLAR (2026-08-23, kullanıcı isteği).
   *
   * `PASSIVE_AFTER_DAYS` günden eski kayıtlar listede yok. Süzgeç SUNUCUDA çalışıyor
   * (`includePassive`), burada değil: sayfalama sunucuda yapıldığı için istemcide süzmek
   * ilk sayfayı eski kayıtlarla doldurup ekranda birkaç satır bırakırdı.
   * Üst çubuktaki kutu `window` olayıyla haber veriyor — "Gerçekleşenleri Göster" ile aynı yol.
   */
  /**
   * Kullanicinin cari kapsami SINIRSIZ mi.
   *
   * "Yeni Musteri Ekle" ve "Urunu Teslim Alan Kisi Ayni" dugmeleri yalnizca burada true ise
   * cikar. Tek cariye bagli bir bayi ne yeni cari acabilir ne de baska cari secebilir; ona
   * bu dugmeleri gostermek basildiginda hicbir sey yapmayan kapilar acar.
   */
  const tumCarilerErisimi = hasAllDealers()

  /** Yeni musteri carisi modali. */
  const [yeniMusteriAcik, setYeniMusteriAcik] = useState(false)

  /**
   * Teslim alan kisi alanlarini cari/bayi bilgileriyle doldurur.
   *
   * Bu kopyalama 2026-08-21'de KALDIRILMISTI: teslim alan kisi cariden ayri girilsin
   * isteniyordu ve alanlar kendiliginden dolunca kullanici ustune yazmayi unutuyordu.
   * Simdi geri geliyor ama OTOMATIK degil, dugmeyle: urunu bayinin kendisi teslim aliyorsa
   * ayni bilgiyi ikinci kez yazmak zorunda kalmiyor, almiyorsa alanlar bos kaliyor.
   */
  const teslimAlanCariyleAyni = () => {
    setNewRecord((p) => ({
      ...p,
      customerName: (p.dealerName || '').split(' (')[0].trim(),
      customerPhone: p.dealerPhone || '',
      customerAddress: p.dealerAddress || '',
    }))
  }

  const [showPassive, setShowPassive] = useState(() => {
    return (window as any).__showPassive !== undefined ? !!(window as any).__showPassive : false
  })

  const { result, isLoading, refetch, markAsPrinted, updateSatisfaction } = useServiceRecordsPaged({
    q: appliedQ.trim() || undefined,
    status: appliedStatus || undefined,
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    technicianId: appliedTechnicianId || undefined,
    type: 'Repair',
    category: categoryFilter,
    // Kabul ekranı kendi sayfa anahtarını bildirir. Gönderilmediğinde sunucu bu isteği yönetim
    // ekranının anahtarıyla ('buyukUrun' / 'atolyeAriza') süzüyordu; kabul yetkisi olan ama
    // yönetim ekranında "tümünü görme" yetkisi olmayan kullanıcı burada boş liste görüyordu.
    scopeKey: categoryFilter === 'small' ? 'kucukUrunKabul' : 'buyukEvAletleriKabul',
    satisfactionScore: appliedSatisfaction === '' ? undefined : appliedSatisfaction,
    includePassive: showPassive,
    page,
    pageSize,
  })

  // Garanti filtresi backend'de yok; client-side süzeriz, sayfa sonucu üzerinden.
  const [showDelivered, setShowDelivered] = useState(() => {
    return (window as any).__showDelivered !== undefined ? !!(window as any).__showDelivered : false
  })
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'status' | 'technician'>('date-desc')

  useEffect(() => {
    const handleShowDeliveredChanged = (e: any) => {
      setShowDelivered(e.detail)
    }
    const handleShowPassiveChanged = (e: any) => {
      setShowPassive(!!e.detail)
      setPage(1)   // süzgeç değişti; eski sayfa numarası artık boşa düşebilir
    }
    window.addEventListener('shell:show-delivered-changed', handleShowDeliveredChanged)
    window.addEventListener('shell:show-passive-changed', handleShowPassiveChanged)
    return () => {
      window.removeEventListener('shell:show-delivered-changed', handleShowDeliveredChanged)
      window.removeEventListener('shell:show-passive-changed', handleShowPassiveChanged)
    }
  }, [])

  // Garanti filtresi backend'de yok; client-side süzeriz, sayfa sonucu üzerinden.
  const records = useMemo(() => {
    let items = result.items.map(item => {
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

    if (appliedWarranty === 'true') items = items.filter((r) => r.isUnderWarranty)
    else if (appliedWarranty === 'false') items = items.filter((r) => !r.isUnderWarranty)
    
    // Filter out 'Delivered' if showDelivered is false, unless searching or filtering by status
    const isSearching = Boolean(appliedQ.trim() || appliedStatus)
    if (!showDelivered && !isSearching) {
      items = items.filter((r) => (r.status || '').toLowerCase() !== 'delivered')
    }

    // Sort items
    items.sort((a, b) => {
      if (sortBy === 'date-desc') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      }
      if (sortBy === 'date-asc') {
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      }
      if (sortBy === 'status') {
        const valA = a.statusLabel || a.status || ''
        const valB = b.statusLabel || b.status || ''
        return valA.localeCompare(valB, 'tr')
      }
      if (sortBy === 'technician') {
        const valA = a.assignedTechnicianName || ''
        const valB = b.assignedTechnicianName || ''
        return valA.localeCompare(valB, 'tr')
      }
      return 0
    })

    return items
  }, [result.items, appliedWarranty, showDelivered, sortBy, appliedSatisfaction, erpProducts, loadingProducts, categoryFilter])

  const [filteredRows, setFilteredRows] = useState<ServiceRecord[]>([])

  const isAllSelected = useMemo(() => {
    return filteredRows.length > 0 && filteredRows.every(r => selectedIds.includes(r.id))
  }, [filteredRows, selectedIds])

  const toggleSelectAll = () => {
    if (isAllSelected) {
      const displayedIds = filteredRows.map(r => r.id)
      setSelectedIds(prev => prev.filter(id => !displayedIds.includes(id)))
    } else {
      const displayedIds = filteredRows.map(r => r.id)
      setSelectedIds(prev => Array.from(new Set([...prev, ...displayedIds])))
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const canSeeSatisfaction = categoryFilter === 'small'
    ? can('kucukUrunKabul.memnuniyet')
    : can('buyukEvAletleriKabul.memnuniyet')

  const canCreateReceipt = categoryFilter === 'small'
    ? can('kucukUrunKabul.fisOlustur')
    : can('buyukEvAletleriKabul.fisOlustur')

  // Aksiyon kolonu memnuniyetten AYRI bir yetki (kullanici karari): bayi/alt bayi kapali.
  // Sayfa buyuk/kucuk ayrimini `categoryFilter` ile yaptigi icin anahtar da ona gore secilir.
  const canSeeActions = categoryFilter === 'small'
    ? can('kucukUrunKabul.aksiyon')
    : can('buyukEvAletleriKabul.aksiyon')

  const columns: TableColumn<ServiceRecord>[] = useMemo(() => {
    const arr: TableColumn<ServiceRecord>[] = [
      {
      key: 'id' as any,
      label: (
        <input
          type="checkbox"
          checked={isAllSelected}
          onChange={toggleSelectAll}
          className="rounded border-gray-300 text-[#B91C1C] focus:ring-[#B91C1C] print:hidden"
        />
      ) as any,
      searchable: false,
      render: (_v, row) => (
        <input
          type="checkbox"
          checked={selectedIds.includes(row.id)}
          onChange={() => toggleSelect(row.id)}
          onClick={(e) => e.stopPropagation()}
          className="rounded border-gray-300 text-[#B91C1C] focus:ring-[#B91C1C] print:hidden"
        />
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
      // Sistemin urettigi numara (AT-/SH-). Etiketi eskiden "Fis No" idi; kagit fis numarasi
      // ayri bir alan olarak eklenince ikisi karisiyordu, bu yuzden "Servis No" oldu.
      key: 'serviceNumber' as any,
      label: 'Servis No',
      searchable: true,
      filter: { type: 'text' },
      render: (_v, row) => (
        <span className="font-mono text-xs font-semibold text-gray-900">{row.serviceNumber}</span>
      )
    },
    {
      // KAGIT FIS NO: musterinin elindeki basili fisin numarasi. Aramada da gecer.
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
      key: 'status' as any,
      label: 'Durum',
      searchable: true,
      filter: {
        type: 'select',
        options: [
          { label: 'Yeni Kayıt / Plan Bekliyor', value: 'new' },
          { label: 'Planlandı', value: 'planned' },
          { label: 'Saha Planlamasında', value: 'fieldplanned' },
          { label: 'Atölyede', value: 'workshop' },
          { label: 'Tamirde', value: 'inrepair' },
          { label: 'Parça Bekliyor', value: 'waitingforparts' },
          { label: 'Hazır / Tamamlandı', value: 'ready' },
          { label: 'Teslim Edildi', value: 'delivered' },
          { label: 'Gecikti', value: 'delayed' },
          { label: 'İptal', value: 'cancelled' }
        ]
      },
      render: (_v, row) => (
        <div className="flex flex-col items-start gap-1">
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${getStatusStyle(row.status)}`}>
            {getStatusLabel(row.status, row.statusLabel, row.isPrinted)}
          </span>
          {/* Pasif rozeti YALNIZ "Pasife Alınanları Göster" işaretliyken görünür; kapalıyken
              zaten böyle bir satır listede yok. Kaydın durumu değişmiyor, sadece eskimiş. */}
          {Number((row as any).elapsedDays ?? 0) >= PASSIVE_AFTER_DAYS && (
            <span
              className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border bg-gray-100 text-gray-500 border-gray-200"
              title={`${PASSIVE_AFTER_DAYS} günden eski kayıt — varsayılan listede görünmez`}
            >
              Pasif
            </span>
          )}
        </div>
      )
    },
    {
      key: 'customerType' as any,
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
      render: (_v, row) => new Date(row.createdAt).toLocaleDateString('tr-TR')
    },
    {
      key: 'customerName' as any,
      label: 'Müşteri',
      searchable: true,
      filter: { type: 'text' },
      render: (_v, row) => (
        <div>
          <div className="font-semibold text-gray-800 flex items-center gap-1">
            {row.customerName}
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard.writeText(row.customerName || '')
              }}
              className="p-0.5 text-gray-400 hover:text-gray-650"
              title="İsmi Kopyala"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <div className="text-gray-500 text-[11px] flex items-center gap-1">
            <PhoneLinks phone={row.customerPhone} compact />
            <button
              onClick={(e) => {
                e.stopPropagation()
                navigator.clipboard.writeText(row.customerPhone || '')
              }}
              className="p-0.5 text-gray-400 hover:text-gray-650"
              title="Telefonu Kopyala"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <div className="text-gray-500 text-[10px] flex items-start gap-1 max-w-[200px] truncate" title={row.customerAddress}>
            <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
            {row.customerAddress}
          </div>
        </div>
      )
    },
    {
      key: 'productName' as any,
      label: 'Ürün/Stok',
      searchable: true,
      filter: { type: 'text' },
      render: (_v, row) => row.productName
    },
    {
      key: 'serialNumber' as any,
      label: 'Seri No',
      searchable: true,
      filter: { type: 'text' },
      render: (_v, row) => row.serialNumber || '-'
    },
    {
      key: 'dealerName' as any,
      label: 'Bayi',
      searchable: true,
      filter: { type: 'text' },
      render: (_v, row) => row.dealerName || '-'
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
      /*
        PLANLANAN GÜN ve TEKNİSYEN (2026-08-27 kullanıcı isteği).

        Kabul ekranı kaydın nerede olduğunu göstermiyordu: iş planlandıktan sonra bile burada
        yalnızca "Yeni Kayıt" görünüyor, kime ve hangi güne verildiği ancak Saha/Atölye
        ekranına geçilerek öğrenilebiliyordu. İki alan da kaydın kendi üzerinde zaten duruyor
        (`plannedAt` / `assignedTechnicianName`), sunucudan da geliyordu — sadece bu tabloda
        çizilmiyordu.

        Planlanmamış kayıtta boş kalır; kolon "plan var mı" sorusunun da cevabı olur.
      */
      key: 'plannedAt' as any,
      label: 'Planlanan Gün',
      searchable: true,
      filter: { type: 'date' },
      render: (_v, row) => {
        if (!row.plannedAt) return <span className="text-[11px] text-gray-300">-</span>
        return (
          <span className="text-xs font-semibold text-gray-900">
            {new Date(row.plannedAt).toLocaleDateString('tr-TR')}
          </span>
        )
      }
    },
    {
      key: 'assignedTechnicianName' as any,
      label: 'Teknisyen',
      searchable: true,
      filter: { type: 'text' },
      render: (_v, row) => {
        // Montaj kayıtlarında kişi kaydın üzerinde değil, planlama satırlarında olabiliyor;
        // sunucu ikisini de aynı alanlara dolduruyor, burada ikisi de karşılanıyor.
        const name = row.assignedTechnicianName
          || (Array.isArray(row.assignedTechnicians) && row.assignedTechnicians.length > 0
                ? row.assignedTechnicians.join(', ')
                : null)
        if (!name) return <span className="text-[11px] text-gray-300">-</span>
        return (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#B91C1C] shrink-0" />
            <span className="text-xs font-semibold text-gray-900">{name}</span>
          </div>
        )
      }
    },
    {
      /*
        Var/Yok yerine EVET/HAYIR ve altında garanti başlangıç tarihi (2026-08-26 kullanıcı
        isteği). Diğer iki arıza listesiyle aynı hücre; kural `utils/garanti.ts`.
      */
      key: 'isUnderWarranty' as any,
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
      key: 'totalPrice' as any,
      label: 'Tutar',
      searchable: false,
      render: (_v, row) => {
        const price = getRecordPrice(row)
        if (price > 0) {
          return <span className="text-xs font-bold text-gray-950">₺{price.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</span>
        }
        return <span className="text-xs text-gray-400 font-medium">₺0,00</span>
      }
    },


    ...(canSeeSatisfaction ? [{
      key: 'satisfaction' as any,
      label: 'Memnuniyet',
      searchable: false,
      render: (_v, row) => (
        <MemnuniyetHucresi
          score={row.satisfactionScore || 0}
          notes={row.satisfactionNotes}
          by={row.satisfactionBy}
          onClick={() => setSatisfactionRecord(row)}
        />
      )
    } as TableColumn<ServiceRecord>] : []),
    ...(canSeeActions ? [{
      key: 'actions' as any,
      label: 'Aksiyon',
      searchable: false,
      render: (_v, row) => (
        <div className="flex items-center gap-1.5 justify-center">
          {canCreateReceipt && (
            row.isPrinted ? (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  openPrintPreview(row, [])
                }}
                className="px-2 py-1 bg-green-600 text-white text-[10px] font-semibold rounded hover:bg-green-700 cursor-pointer whitespace-nowrap"
                title="Fişi Yazdır"
              >
                Fişi Yazdır
              </button>
            ) : (
              <button
                onClick={async (e) => {
                  e.stopPropagation()
                  try {
                    /*
                      KÜÇÜK ÜRÜNDE ÖNCE DURUM, SONRA BASIM (2026-10-04 kullanıcı bildirimi: "fiş
                      oluştura basıp açılan pencerenin dışına tıklayınca Plan Bekliyor'a düşüyor").

                      Sıra tersti: kayıt önce "basıldı" işaretleniyor, ardından Atölye'ye geçiş
                      durum onay penceresini açıyordu. Pencerenin dışına tıklamak geçişi iptal
                      ediyor ama basım işareti kalıyordu — `Yeni + basılmış` ekranda "Plan Bekliyor"
                      demek. Artık onay önce soruluyor; iptal edilirse HİÇBİR ŞEY değişmiyor.
                    */
                    if (categoryFilter === 'small') {
                      await apiJson(`/api/servicerecords/${row.id}/status`, {
                        method: 'PATCH',
                        body: JSON.stringify({ status: 'Workshop', notes: 'Atölyeye aktarıldı (Fiş oluşturuldu).' })
                      })
                    }
                    await markAsPrinted(row.id)
                    await refetch()
                    openPrintPreview(row, [])
                  } catch (err: any) {
                    if (isStatusChangeCancelled(err)) {
                      toast.info('Fiş oluşturulmadı; kaydın durumu değişmedi.')
                      return
                    }
                    console.error(err)
                    toast.error('Fiş oluşturulurken bir hata oluştu: ' + (err?.message || err))
                  }
                }}
                className="px-3.5 py-2 bg-amber-600 text-white text-xs font-bold rounded-lg hover:bg-amber-700 cursor-pointer whitespace-nowrap"
                title="Fiş Oluştur ve Yazdır"
              >
                Fiş Oluştur
              </button>
            )
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              openDetail(row)
            }}
            className="p-2.5 text-gray-400 hover:text-[#B91C1C] hover:bg-red-50 rounded-lg transition-colors"
            title="Detaylar"
          >
            <MoreHorizontal className="w-6 h-6" />
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation()
              if (window.confirm('Bu arıza kaydını silmek istediğinize emin misiniz?')) {
                try {
                  const res = await apiJson<any>(`/api/servicerecords/${row.id}`, {
                    method: 'DELETE'
                  })
                  if (res?.success) {
                    toast.success(res?.message || 'Kayıt başarıyla silindi.')
                    await refetch()
                  } else {
                    toast.error(res?.message || 'Kayıt silinirken bir hata oluştu.')
                  }
                } catch (err: any) {
                  console.error(err)
                  toast.error(err?.message || 'Kayıt silinirken bir hata oluştu.')
                }
              }
            }}
            className="p-2.5 text-gray-450 hover:text-[#B91C1C] hover:bg-red-50 rounded-lg transition-colors"
            title="Kaydı Sil"
          >
            <Trash2 className="w-6 h-6" />
          </button>
        </div>
      )
    } as TableColumn<ServiceRecord>] : [])
  ]; return categoryFilter === 'small' ? arr.filter(col => col.key !== 'assignedTechnicianName') : arr; }, [isAllSelected, selectedIds, toggleSelectAll, toggleSelect, technicians, markAsPrinted, refetch, categoryFilter, canSeeSatisfaction, canSeeActions, canCreateReceipt, regions])

  const totalCount = result.totalCount || 0

  /**
   * Boş kayıt formu.
   *
   * "Yeni Servis Kaydı" düğmesi formu açmadan önce `fillRandomTestData()` çağırıyordu: gerçek
   * kullanıcı, uydurma müşteri/bayi/ürün bilgisiyle DOLU bir form görüyordu ve yanlışlıkla
   * kaydedilen sahte kayıtlar üretiliyordu. Rastgele doldurma hâlâ mümkün — modalın içindeki
   * "🎲 Rastgele Doldur (Hızlı Test)" düğmesi duruyor — ama artık isteğe bağlı.
   */
  const emptyNewRecord = () => ({
    plannedDate: new Date().toLocaleDateString('sv-SE'),
    isUnderWarranty: 'Bilinmiyor',
    magazadanTeslim: false,
    bayiyeTeslim: false,
    productName: '',
    warrantyStartDate: '',
    invoiceNumber: '',
    manualReceiptNo: '',
    serialNumber: '',
    serviceDescription: '',
    problemDescription: '',
    receivingNote: '',
    additionalNotes: '',
    customerType: categoryFilter === 'small' ? 'Müşteri' : 'Bayi',
    dealerName: '',
    dealerCode: '',
    dealerPhone: '',
    dealerAddress: '',
    customerName: '',
    customerPhone: '',
    regionId: '',
    customerAddress: '',
    priority: 'Normal',
  })

  const createRecord = async (payload: Record<string, unknown>) => {
    const created = await apiJson<ServiceRecord>('/api/servicerecords', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    await refetch()
    return created
  }

  const applyFilters = () => {
    setAppliedStatus(draftStatus)
    setAppliedQ(draftQ.trim() || draftServiceNo.trim())
    setAppliedWarranty(draftWarranty)
    setAppliedTechnicianId(draftTechnicianId)
    setAppliedDateType(draftDateType)
    setAppliedDateFrom(draftDateFrom)
    setAppliedDateTo(draftDateTo)
    setAppliedSatisfaction(draftSatisfaction)
    setPage(1)
  }

  const handleExportCsv = async () => {
    setActionError(null)
    try {
      const rows = await fetchServiceExport({
        q: appliedQ.trim() || undefined,
        status: appliedStatus || undefined,
        dateFrom: dateRange.dateFrom,
        dateTo: dateRange.dateTo,
        technicianId: appliedTechnicianId || undefined,
        type: 'Repair',
      })
      let filtered = appliedWarranty === ''
        ? rows
        : rows.filter((r) => (appliedWarranty === 'true' ? r.isUnderWarranty : !r.isUnderWarranty))

      if (selectedIds.length > 0) {
        filtered = filtered.filter((r) => selectedIds.includes(r.id))
      }
      
      const categoryPrefix = categoryFilter === 'large' ? 'buyuk-' : categoryFilter === 'small' ? 'kucuk-' : '';
      downloadCsv(`${categoryPrefix}urun-kabul-${new Date().toISOString().slice(0, 10)}.csv`, filtered as unknown as Record<string, unknown>[])
    } catch (e: any) {
      setActionError(String(e?.message ?? 'Dışa aktarma başarısız'))
    }
  }

  const handlePrint = () => {
    if (selectedIds.length > 0) {
      const rec = result.items.find((r) => r.id === selectedIds[0])
      if (rec) {
        openPrintPreview(rec, [])
        return
      }
    }
    if (result.items.length > 0) {
      openPrintPreview(result.items[0], [])
    } else {
      toast.error('Yazdırılacak servis fişi kaydı bulunamadı')
    }
  }

  // `/…/yeni` (ve `?create=1`) formu kendiliğinden açar. BOŞ açılıyor: burada
  // `fillRandomTestData()` çağrılıyordu, yani gerçek kullanıcı uydurma müşteri/bayi/ürün
  // bilgisiyle dolu bir form görüyor ve farkında olmadan sahte kayıt üretebiliyordu.
  // Rastgele doldurma modalın içindeki düğmede duruyor, isteğe bağlı.
  useEffect(() => {
    const sp = new URLSearchParams(location.search)
    const shouldOpen = (location.pathname.endsWith('/yeni') || sp.get('create') === '1') && canCreate
    if (!shouldOpen) return
    setActionError(null)
    setActionSuccess(null)
    setNewRecord(emptyNewRecord())
    setCreateOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search, canCreate])
  useEffect(() => {
    const handleExport = () => handleExportCsv()
    const handleCal = () => setCalendarModalOpen(true)
    const handlePrn = () => handlePrint()
    const handleNew = () => {
      if (!canCreate) return
      setActionError(null)
      setActionSuccess(null)
      setNewRecord(emptyNewRecord())
      setCreateOpen(true)
    }

    window.addEventListener('shell:kabul-export', handleExport)
    window.addEventListener('shell:kabul-calendar', handleCal)
    window.addEventListener('shell:kabul-print', handlePrn)
    window.addEventListener('shell:kabul-new', handleNew)

    return () => {
      window.removeEventListener('shell:kabul-export', handleExport)
      window.removeEventListener('shell:kabul-calendar', handleCal)
      window.removeEventListener('shell:kabul-print', handlePrn)
      window.removeEventListener('shell:kabul-new', handleNew)
    }
  }, [handleExportCsv, handlePrint, canCreate])


  /*
    İŞLEM GEÇMİŞİ BASINCA YÜKLENİR (2026-10-05 kullanıcı isteği: "servis genel olarak çok yavaş,
    işlem geçmişi yavaşlatıyor olabilir, basınca yüklensin"). Detay her açıldığında kaydın
    bütün geçmişi sunucudan çekiliyordu; çoğu açılışta bakılmıyordu bile. Artık detay hemen
    açılıyor, geçmiş "İşlem geçmişini göster" düğmesine basınca geliyor.
  */
  const openDetail = async (record: ServiceRecord) => {
    setSelectedRecord(record)
    setDrawerOpen(true)
    setIsEditing(false)
    setActionError(null)
    setActionSuccess(null)
    setTimeline([])
    setTimelineDurum('bekliyor')
  }

  const loadTimeline = async (record: ServiceRecord) => {
    setTimelineDurum('yukleniyor')
    try {
      const [tl, photosData] = await Promise.all([
        apiJson<any[]>(`/api/servicerecords/${record.id}/timeline`).catch(() => []),
        apiJson<any[]>(`/api/servicerecords/${record.id}/photos`).catch(() => [])
      ])

      let rawEvents: any[] = Array.isArray(tl) ? tl : []
      if (rawEvents.length === 0 && (record as any)?.notes) {
        rawEvents = (record as any).notes
      }

      const initialPhotos: string[] = []
      const subsequentCards: any[] = []

      for (const ev of rawEvents) {
        const evPhotos = (ev.photos || []).map((p: any) => typeof p === 'string' ? p : (p.url || p.path)).filter(Boolean)
        const evTime = new Date(ev.createdAt || ev.timestamp || record.createdAt).getTime()
        const recTime = new Date(record.createdAt || Date.now()).getTime()

        // Initial photo check (within 2 min of creation)
        if ((ev.type === 'photo' || ev.statusLabel === 'Fotoğraf Yüklendi') && Math.abs(evTime - recTime) < 120000 && subsequentCards.length === 0) {
          initialPhotos.push(...evPhotos)
          continue
        }

        // Merge photo activity into previous card if within 2 min
        if (ev.type === 'photo' && subsequentCards.length > 0) {
          const lastCard = subsequentCards[subsequentCards.length - 1]
          const diffMs = Math.abs(evTime - new Date(lastCard.createdAt).getTime())
          if (diffMs < 120000) {
            lastCard.photos = Array.from(new Set([...(lastCard.photos || []), ...evPhotos]))
            continue
          }
        }

        subsequentCards.push({
          id: ev.id,
          authorName: ev.authorName || ev.user || ev.performedBy || record.assignedTechnicianName || 'Sistem',
          createdAt: ev.createdAt || ev.timestamp || record.createdAt,
          fromStatus: ev.fromStatus || ev.oldStatus,
          toStatus: ev.toStatus || ev.newStatus || ev.status,
          statusLabel: ev.statusLabel || (ev.type === 'photo' ? 'Fotoğraf Yüklendi' : 'İşlem Güncellemesi'),
          content: ev.content || ev.note || ev.description || '',
          photos: evPhotos
        })
      }

      // 1. Card #1: İlk Ürün Kabulü (only photo uploaded AT creation)
      const initialCard = {
        id: 'initial-entry',
        authorName: record.dealerName || record.customerName || record.assignedTechnicianName || 'Servis Kabul Yetkilisi',
        createdAt: record.createdAt || new Date().toISOString(),
        fromStatus: null,
        toStatus: record.status || 'Workshop',
        statusLabel: 'İlk Ürün Kabulü',
        content: `📦 İLK ÜRÜN KABULÜ YAPILDI\n• Müşteri: ${record.customerName || '-'} (${record.customerPhone || ''})\n• Arıza / Şikayet:\n${formatProblemDescriptionTR(record.problemDescription)}\n• Seri Numarası: ${record.serialNumber || 'SN Yok'}${ record.receivingNote ? '\n• Teslim Alma Notu: ' + record.receivingNote : '' }`,
        photos: Array.from(new Set(initialPhotos))
      }

      setTimeline([initialCard, ...subsequentCards])
    } catch (err) {
      console.error('Error fetching timeline:', err)
    } finally {
      setTimelineDurum('hazir')
    }
  }

  const handleSaveEdits = async () => {
    if (!selectedRecord) return
    if (!editForm.customerName.trim()) { setEditError('Müşteri adı zorunludur'); return }
    if (!isValidPhone(editForm.customerPhone)) { setEditError('Geçerli bir cep telefonu giriniz'); return }
    if (!editForm.customerAddress.trim()) { setEditError('Müşteri adresi zorunludur'); return }
    if (!editForm.productName.trim()) { setEditError('Ürün seçimi zorunludur'); return }
    if (!editForm.problemDescription.trim()) { setEditError('Arıza açıklaması zorunludur'); return }
    if (!editForm.dealerName.trim()) { setEditError('Bayi seçimi zorunludur'); return }
    if (!editForm.regionId) { setEditError('Bölge seçimi zorunludur'); return }

    setEditSaving(true)
    setEditError(null)

    try {
      const combinedDescription = editForm.problemDescription.trim();

      const allDealers = selectableDealers
      let finalDealerCode = editForm.dealerCode
      if (!finalDealerCode && editForm.dealerName) {
        const dUpper = editForm.dealerName.trim().toUpperCase()
        const matched = allDealers.find(d => 
          d.name.toUpperCase() === dUpper || 
          `${d.name} (${d.customerCode})`.toUpperCase() === dUpper ||
          dUpper.includes(d.customerCode) ||
          dUpper.includes(d.name.toUpperCase())
        )
        if (matched) finalDealerCode = matched.customerCode
      }

      const res = await apiJson<any>(`/api/servicerecords/${selectedRecord.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          type: selectedRecord.type || 'Repair',
          customerName: editForm.customerName,
          customerPhone: editForm.customerPhone,
          customerAddress: editForm.customerAddress,
          productName: editForm.productName,
          serialNumber: editForm.serialNumber,
          receivingNote: editForm.receivingNote || undefined,
          isUnderWarranty: editForm.isUnderWarranty === 'Evet',
          // Boş metin "temizle" demek (sunucu kuralı); alan hiç gönderilmezse dokunulmaz.
          warrantyStartDate: editForm.isUnderWarranty === 'Evet'
            ? (editForm.warrantyStartDate || '')
            : '',
          dealerName: editForm.dealerName,
          dealerCode: finalDealerCode || undefined,
          problemDescription: combinedDescription,
          priority: editForm.priority,
          regionId: editForm.regionId,
          plannedDate: selectedRecord.plannedAt || undefined,
        })
      })

      await refetch()
      setSelectedRecord(res)
      setIsEditing(false)
      setActionSuccess('Değişiklikler başarıyla kaydedildi.')
    } catch (err: any) {
      setEditError(String(err?.message ?? 'Kaydedilirken hata oluştu.'))
    } finally {
      setEditSaving(false)
    }
  }

  const scanSerialBarcode = async () => {
    const w = window as any
    if (!w.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      const manual = window.prompt('Barkod / seri numarası')
      if (manual) setNewRecord((p) => ({ ...p, serialNumber: sanitizeSerial(manual) }))
      return
    }

    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    const video = document.createElement('video')
    video.srcObject = stream
    await video.play()
    const detector = new w.BarcodeDetector({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code'] })
    try {
      for (let i = 0; i < 20; i++) {
        const codes = await detector.detect(video)
        const value = codes?.[0]?.rawValue
        if (value) {
          setNewRecord((p) => ({ ...p, serialNumber: sanitizeSerial(value) }))
          return
        }
        await new Promise((resolve) => window.setTimeout(resolve, 200))
      }
      setActionError('Barkod okunamadı. Seri numarasını manuel girebilirsiniz.')
    } finally {
      stream.getTracks().forEach((track) => track.stop())
    }
  }

  return (
    <div className="flex flex-col">
      <div className="p-4 lg:p-6 flex flex-col gap-4">
        {/* Page Header */}
        {categoryFilter !== 'large' && categoryFilter !== 'small' && (
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-xl lg:text-2xl font-bold text-gray-900">
                {categoryFilter === 'large' ? 'Büyük Ev Aletleri Kabul ve Takip' : categoryFilter === 'small' ? 'Küçük Ev Aletleri Kabul ve Takip' : 'Ürün Kabul ve Takip'}
              </h1>
              <p className="text-sm text-gray-500 mt-1">Sistemdeki aktif servis kayıtlarını yönetin ve takip edin.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedIds.length > 0 && (
                <button
                  onClick={() => setSelectedIds([])}
                  className="flex flex-1 items-center justify-center gap-1.5 px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-200 transition-colors sm:flex-none"
                >
                  Seçimi Temizle ({selectedIds.length})
                </button>
              )}
              <button
                onClick={handleExportCsv}
                className="flex flex-1 items-center justify-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors sm:flex-none"
              >
                <Download className="w-4 h-4" />
                {selectedIds.length > 0 ? 'Seçilenleri Excel\'e Aktar' : 'Excel Aktar'}
              </button>
              {canSeeCalendar && (
                <button
                  onClick={() => setCalendarModalOpen(true)}
                  className="flex flex-1 items-center justify-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors sm:flex-none"
                >
                  <Calendar className="w-4 h-4 text-gray-500" />
                  Takvim
                </button>
              )}
              <button
                onClick={handlePrint}
                className="flex flex-1 items-center justify-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors sm:flex-none"
              >
                <Printer className="w-4 h-4" />
                Yazdır
              </button>
              {canCreate && (
                <button
                  onClick={() => {
                    setActionError(null)
                    setActionSuccess(null)
                    setNewRecord(emptyNewRecord())
                    setCreateOpen(true)
                  }}
                  className="flex flex-1 items-center justify-center gap-2 px-4 py-2 bg-[#B91C1C] text-white rounded-lg text-sm font-medium hover:bg-[#991B1B] transition-colors shadow-lg shadow-red-900/20 sm:flex-none"
                >
                  <Plus className="w-4 h-4" />
                  Yeni Servis Kaydı
                </button>
              )}
            </div>
          </div>
        )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-visible relative">
        {isLoading && records.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">Yükleniyor...</div>
        ) : records.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">Kayıt bulunamadı.</div>
        ) : (
          <Table
            columns={columns}
            data={records}
            showColumnFilters
            onFilteredDataChange={setFilteredRows}
            rowKey={(r) => r.id}
            rowClassName={(row) => selectedIds.includes(row.id) ? 'bg-[#B91C1C]/5' : ''}
            serverSide={false}
          />
        )}
      </div>

      {drawerOpen && selectedRecord && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDrawerOpen(false)} />
          <div className="fixed right-0 top-0 bottom-0 pt-safe pb-safe w-full max-w-lg bg-white z-50 shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300">
            <div className="p-4 sm:p-6 border-b border-gray-100 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Servis Detayı</h2>
                <p className="text-sm text-gray-500">{selectedRecord.id}</p>
              </div>

              <div className="flex items-center gap-1.5">
                {!isEditing ? (
                  <button
                    onClick={() => {
                      const parsed = parseCombinedDescription(selectedRecord.problemDescription || '')
                      setEditForm({
                        customerName: selectedRecord.customerName || '',
                        customerPhone: selectedRecord.customerPhone || '',
                        customerAddress: selectedRecord.customerAddress || '',
                        customerType: parsed.custType || 'Bireysel',
                        dealerName: selectedRecord.dealerName || '',
                        dealerCode: selectedRecord.dealerCode || '',
                        productName: selectedRecord.productName || '',
                        serialNumber: selectedRecord.serialNumber || '',
                        isUnderWarranty: selectedRecord.isUnderWarranty ? 'Evet' : 'Hayır',
                        // Önce kaydın kendi alanı, yoksa açıklamaya gömülü eski tarih.
                        warrantyStartDate: garantiBaslangiciInput(selectedRecord) || parsed.wStartDate || '',
                        invoiceNumber: parsed.invoiceNum || '',
                        problemDescription: parsed.mainDesc || '',
                        serviceDescription: parsed.serviceDesc || '',
                        additionalNotes: parsed.addNotes || '',
                        receivingNote: selectedRecord.receivingNote || '',
                        priority: selectedRecord.priority || 'Normal',
                        regionId: selectedRecord.regionId || '',
                      })
                      setIsEditing(true)
                      setEditError(null)
                    }}
                    className="px-2.5 py-1.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" />
                    Düzenle
                  </button>
                ) : null}
                {!isEditing ? (
                  // Kagit fis numarasi ayri uctan yazilir; buradan "Duzenle" formuna girmek
                  // gerekmesin diye kendi dugmesi var.
                  <button
                    onClick={() => setFisNoFor(selectedRecord)}
                    className="px-2.5 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                    title="Müşterinin elindeki basılı fişin numarası"
                  >
                    {selectedRecord.manualReceiptNo ? 'Fiş No Düzenle' : 'Fiş No Gir'}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleSaveEdits}
                      disabled={editSaving}
                      className="px-2.5 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold transition-all cursor-pointer"
                    >
                      {editSaving ? 'Kaydediliyor...' : 'Kaydet'}
                    </button>
                    <button
                      onClick={() => setIsEditing(false)}
                      disabled={editSaving}
                      className="px-2.5 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                    >
                      Vazgeç
                    </button>
                  </>
                )}
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
            </div>

            <div className="p-4 sm:p-6 space-y-6">
              {!isEditing && (
                <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200 text-yellow-800 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Bu ekranda durum güncellemesi yapılamaz. Durum güncellemeleri ilgili yönetim ekranından (Saha/Atölye/Montaj) yapılır.</span>
                </div>
              )}

              {/*
                SONRADAN NOT/GÖRSEL EKLEME (2026-08-24, kullanıcı isteği).
                Durum değiştirmiyor — kabul sonrası eline geçen belgeyi/bilgiyi kayda
                iliştirmeye yarıyor. Yukarıdaki uyarı geçerliliğini koruyor.
              */}
              {selectedRecord?.id && (
                <DurumNotuVeGorselEkle
                  recordId={String(selectedRecord.id)}
                  onSaved={async () => {
                    // Geçmiş açıksa aynı biçimde (kabul kartıyla birlikte) yeniden kurulur;
                    // açılmamışsa dokunulmaz — basınca zaten güncel hâli gelecek.
                    if (timelineDurum === 'hazir') await loadTimeline(selectedRecord)
                    void refetch(true)
                  }}
                />
              )}

              {editError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs font-semibold text-red-600">
                  {editError}
                </div>
              )}
              {actionError ? (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs font-semibold text-red-600">
                  {actionError}
                </div>
              ) : null}
              {actionSuccess ? (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-xs font-semibold text-green-700">
                  {actionSuccess}
                </div>
              ) : null}

              {isEditing ? (
                // EDIT MODE FORM
                <div className="space-y-4 text-xs">
                  <div className="border border-gray-150 rounded-xl p-4 space-y-3 bg-gray-50/50">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Ürünü Teslim Alan / Teslimat Edilecek Kişi Bilgileri</div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1 col-span-2">
                        <label className="font-semibold text-gray-500">Teslim Alan Ad Soyad <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={editForm.customerName}
                          onChange={e => setEditForm(p => ({ ...p, customerName: sanitizeName(e.target.value) }))}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                        />
                      </div>
                      
                      <div className="space-y-1 col-span-2">
                        <label className="font-semibold text-gray-500">Teslim Alan Telefon <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={editForm.customerPhone}
                          onChange={e => setEditForm(p => ({ ...p, customerPhone: sanitizePhone(e.target.value) }))}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                        />
                      </div>

                      <div className="space-y-1 col-span-2">
                        <label className="font-semibold text-gray-500">Teslim Alan Adresi <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={editForm.customerAddress}
                          onChange={e => setEditForm(p => ({ ...p, customerAddress: e.target.value }))}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="border border-gray-150 rounded-xl p-4 space-y-3 bg-gray-50/50">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Ürün ve Bayi Bilgileri</div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="font-semibold text-gray-500">Bayi <span className="text-red-500">*</span></label>
                        <select
                          value={editForm.dealerName}
                          onChange={e => {
                            const selectedVal = e.target.value
                            const allDealers = selectableDealers
                            const matched = allDealers.find(d => d.name === selectedVal || d.customerCode === selectedVal)
                            setEditForm(p => ({
                              ...p,
                              dealerName: matched?.name || selectedVal,
                              dealerCode: matched?.customerCode || ''
                            }))
                          }}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none"
                        >
                          <option value="">Seçiniz...</option>
                          {selectableDealers.map(d => (
                            <option key={d.customerCode} value={d.name}>{d.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="font-semibold text-gray-500">Ürün <span className="text-red-500">*</span></label>
                        {/*
                          Ham <select> idi: yüzlerce ürün arasında arama yok, kaydırarak
                          bulmak gerekiyordu. Aynı sayfadaki YENİ KAYIT formu zaten aranabilir
                          seçiciyi kullanıyordu; düzenleme çekmecesi geride kalmış.
                        */}
                        <SearchableProductSelect
                          products={displayedProducts}
                          value={editForm.productName}
                          onChange={(val) => setEditForm(p => ({ ...p, productName: val }))}
                          disabled={loadingProducts}
                          placeholder="Ürün Ara veya Seç..."
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="font-semibold text-gray-500">Garantisi Var mı? <span className="text-red-500">*</span></label>
                        <select
                          value={editForm.isUnderWarranty}
                          onChange={e => {
                            const val = e.target.value
                            setEditForm(p => ({
                              ...p,
                              isUnderWarranty: val,
                              warrantyStartDate: val === 'Evet' ? p.warrantyStartDate : ''
                            }))
                          }}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none"
                        >
                          <option value="Bilinmiyor">Bilinmiyor</option>
                          <option value="Hayır">Hayır</option>
                          <option value="Evet">Evet</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="font-semibold text-gray-500">Garanti Başlangıç Tarihi</label>
                        <input
                          type="date"
                          disabled={editForm.isUnderWarranty !== 'Evet'}
                          value={editForm.isUnderWarranty === 'Evet' ? editForm.warrantyStartDate : ''}
                          onChange={e => setEditForm(p => ({ ...p, warrantyStartDate: e.target.value }))}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="font-semibold text-gray-500">Seri Numarası (Opsiyonel)</label>
                        <input
                          type="text"
                          value={editForm.serialNumber}
                          onChange={e => setEditForm(p => ({ ...p, serialNumber: sanitizeSerial(e.target.value) }))}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="border border-gray-150 rounded-xl p-4 space-y-3 bg-gray-50/50">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Servis ve Arıza Detayları</div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="font-semibold text-gray-500">Öncelik <span className="text-red-500">*</span></label>
                        <select
                          value={editForm.priority}
                          onChange={e => setEditForm(p => ({ ...p, priority: e.target.value }))}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none"
                        >
                          <option value="Low">Düşük</option>
                          <option value="Normal">Normal</option>
                          <option value="High">Acil</option>
                          <option value="Critical">Kritik</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="font-semibold text-gray-500">Bölge <span className="text-red-500">*</span></label>
                        <select
                          value={editForm.regionId}
                          onChange={e => setEditForm(p => ({ ...p, regionId: e.target.value }))}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none"
                        >
                          <option value="">Seçiniz...</option>
                          {regions.map(r => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1 col-span-2">
                        <label className="font-semibold text-gray-500">Müşteri Şikayeti / Arıza Açıklaması <span className="text-red-500">*</span></label>
                        <textarea
                          value={editForm.problemDescription}
                          onChange={e => setEditForm(p => ({ ...p, problemDescription: e.target.value }))}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full h-16 resize-none focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                        />
                      </div>

                      <div className="space-y-1 col-span-2">
                        <label className="font-semibold text-gray-500">Ek Açıklama / Notlar (Opsiyonel)</label>
                        <textarea
                          value={editForm.additionalNotes}
                          onChange={e => setEditForm(p => ({ ...p, additionalNotes: e.target.value }))}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full h-16 resize-none focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                        />
                      </div>

                      <div className="space-y-1 col-span-2">
                        <label className="font-semibold text-gray-500">Teslim Alma Notu</label>
                        <input
                          type="text"
                          value={editForm.receivingNote}
                          onChange={e => setEditForm(p => ({ ...p, receivingNote: e.target.value }))}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                // VIEW MODE
                <>
                  {/* Customer Info */}
                  <div>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Ürünü Teslim Alan / Teslimat Edilecek Kişi Bilgileri</h3>
                    <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-600 to-gray-700 flex items-center justify-center text-white font-semibold">
                          {(selectedRecord.customerName || '??').split(' ').filter(Boolean).map(n => n[0]).join('')}
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900">{selectedRecord.customerName || '-'}</div>
                          <div className="text-sm text-gray-500 flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {selectedRecord.customerPhone || '-'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <MapPin className="w-4 h-4 text-gray-400" />
                        <span>{selectedRecord.customerAddress || '-'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Product Info */}
                  <div>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Ürün ve Arıza</h3>
                    <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Ürün:</span>
                        <span className="text-sm font-medium text-gray-900">{selectedRecord.productName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Seri No:</span>
                        <span className="text-sm font-medium text-gray-900">{selectedRecord.serialNumber || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Garanti:</span>
                        <span className={`text-sm font-medium ${selectedRecord.isUnderWarranty ? 'text-green-600' : 'text-gray-600'}`}>
                          {selectedRecord.isUnderWarranty ? 'Garantili' : 'Garantisiz'}
                        </span>
                      </div>
                      <div className="pt-3 border-t border-gray-200">
                        <div className="text-[10px] font-bold text-red-600 uppercase tracking-wider mb-1">Arıza / Şikayet Detayı</div>
                        <p className="text-xs text-gray-900 font-medium leading-relaxed whitespace-pre-line bg-white p-3 rounded-lg border border-gray-200">
                          {formatProblemDescriptionTR(selectedRecord.problemDescription)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* 📋 Yapılan İşlemler ve Ürün Tarihçesi (Kaydırılabilir Adım Kartları) */}
                  <div className="space-y-3.5 pt-4 border-t border-gray-200">
                    <div className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center justify-between">
                      <span>📋 Yapılan İşlemler ve Ürün Tarihçesi{timelineDurum === 'hazir' ? ` (${timeline.length} Adım)` : ''}</span>
                      {timelineDurum === 'hazir' && (
                        <span className="text-[10px] font-semibold text-slate-500 font-mono">Kaydırılabilir Akış</span>
                      )}
                    </div>

                    {timelineDurum !== 'hazir' ? (
                      <button
                        type="button"
                        onClick={() => selectedRecord && void loadTimeline(selectedRecord)}
                        disabled={timelineDurum === 'yukleniyor'}
                        className="w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                      >
                        {timelineDurum === 'yukleniyor' ? 'Geçmiş yükleniyor…' : '📋 İşlem geçmişini ve kabul fotoğraflarını göster'}
                      </button>
                    ) : (
                    <div className="max-h-[500px] overflow-y-auto space-y-3.5 pr-1.5 scrollbar-thin">
                      {timeline.length === 0 ? (
                        <div className="bg-gray-50 rounded-xl p-6 text-center text-xs text-gray-400 border border-gray-200">
                          Henüz geçmiş işlem kaydı yok.
                        </div>
                      ) : (
                        timeline.map((item: any, idx: number) => {
                          const author = (item.authorName && item.authorName !== 'Sistem') ? item.authorName : 'Sistem'
                          const initials = author.split(' ').filter(Boolean).slice(0, 2).map((n: string) => n[0]).join('').toUpperCase() || 'TÖ'
                          const dateObj = item.createdAt ? new Date(item.createdAt) : new Date()
                          const dateStr = dateObj.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' - ' + dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
                          
                          const photos: any[] = item.photos || []
                          const fromStatus = item.fromStatus
                          const toStatus = item.toStatus

                          const noteText = item.content
                          const isGenericNote = !noteText || noteText === 'Durum güncellemesi yapıldı.' || noteText === 'İşlem gerçekleştirildi.'

                          return (
                            <div key={idx} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden transition hover:shadow-md">
                              {/* Top Header Bar */}
                              <div className="p-2.5 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-1.5 shadow-inner">
                                <div className="flex items-center gap-1.5 text-[11px] font-black">
                                  {fromStatus && toStatus ? (
                                    <div className="flex items-center gap-1 bg-white/10 px-2 py-0.5 rounded border border-white/20">
                                      <span className="text-gray-300 font-semibold">{getStatusLabelTR(fromStatus)}</span>
                                      <span className="text-orange-400 font-extrabold">➔</span>
                                      <span className="text-emerald-400 font-extrabold">{getStatusLabelTR(toStatus)}</span>
                                    </div>
                                  ) : (
                                    <span className="bg-red-600 text-white px-2 py-0.5 rounded text-[11px] font-bold shadow-sm">
                                      {item.statusLabel || (toStatus ? getStatusLabelTR(toStatus) : 'İlk Ürün Kabulü')}
                                    </span>
                                  )}
                                </div>

                                <div className="text-[10px] font-mono text-slate-300 font-bold bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                                  🕒 {dateStr}
                                </div>
                              </div>

                              {/* Personel Bilgisi */}
                              <div className="px-3 py-2 bg-slate-50 border-b border-gray-100 flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-md bg-red-600 text-white flex items-center justify-center font-bold text-[10px] shadow-sm">
                                    {initials}
                                  </div>
                                  <div>
                                    <div className="font-bold text-gray-900 leading-tight text-[11px]">{author}</div>
                                    <div className="text-[9px] text-gray-500 font-medium">İşlemi Yapan Personel</div>
                                  </div>
                                </div>
                                <span className="text-[9px] font-bold text-slate-500 bg-slate-200/70 px-1.5 py-0.5 rounded">
                                  Adım #{idx + 1}
                                </span>
                              </div>

                              {/* Görsel */}
                              {photos.length > 0 && (
                                <div className="p-2 bg-slate-100/70 border-b border-gray-100">
                                  <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                                    <span>📷 İşlem Görselleri ({photos.length})</span>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    {photos.map((photo: any, pIdx: number) => {
                                      const rawUrl = typeof photo === 'string' ? photo : (photo.url || photo.path)
                                      const photoUrl = !rawUrl ? '' : (rawUrl.startsWith('http') || rawUrl.startsWith('data:') ? rawUrl : `${API_BASE_URL}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`)
                                      return (
                                        <div
                                          key={pIdx}
                                          onClick={() => {
                                            setBuyutulenGorseller(
                                              photos.map((ph: any) => {
                                                const r = typeof ph === 'string' ? ph : (ph.url || ph.path)
                                                if (!r) return ''
                                                return r.startsWith('http') || r.startsWith('data:')
                                                  ? r
                                                  : `${API_BASE_URL}${r.startsWith('/') ? '' : '/'}${r}`
                                              }).filter(Boolean)
                                            )
                                            setBuyutulenIdx(pIdx)
                                          }}
                                          className="relative aspect-video rounded-lg overflow-hidden bg-black/5 cursor-pointer border border-gray-200 group shadow-sm"
                                        >
                                          <img src={photoUrl} alt="İşlem Görseli" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white font-bold text-[10px] gap-1">
                                            🔍 Büyüt
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Açıklama Metni */}
                              <div className="p-3 bg-white space-y-1">
                                <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">İşlem Açıklaması</div>
                                <p className="text-xs text-gray-900 font-medium leading-relaxed whitespace-pre-line bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                                  {isGenericNote && fromStatus && toStatus
                                    ? `Ürün durumu "${getStatusLabelTR(fromStatus)}" aşamasından "${getStatusLabelTR(toStatus)}" aşamasına güncellendi.`
                                    : formatStepDescriptionTR(noteText || 'İşlem gerçekleştirildi.')}
                                </p>
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                    )}
                  </div>
                </>
              )}
        </div>
      </div>
    </>
  )}

      {createOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setCreateOpen(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between shrink-0">
                <div>
                  <div className="text-lg font-bold text-gray-900">
                    {categoryFilter === 'large' ? 'Yeni Beyaz Eşya Servis Kaydı' : categoryFilter === 'small' ? 'Yeni Küçük Ev Aletleri Servis Kaydı' : 'Yeni Servis Kaydı'}
                  </div>
                  <div className="text-xs text-gray-500">Kayıt oluşturulduğunda otomatik olarak Beyaz Eşya Planlama listesine düşer.</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setCreateOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
              </div>

              <div className="p-5 overflow-y-auto flex-1 custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-gray-500">Tarih <span className="text-red-500">*</span></div>
                  <input
                    type="date"
                    disabled
                    value={newRecord.plannedDate}
                    onChange={(e) => setNewRecord((p) => ({ ...p, plannedDate: e.target.value }))}
                    className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm w-full cursor-not-allowed text-gray-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-gray-500">Öncelik Durumu</div>
                  <select
                    value={newRecord.priority}
                    onChange={(e) => setNewRecord((p) => ({ ...p, priority: e.target.value }))}
                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                  >
                    <option value="Low">Düşük</option>
                    <option value="Normal">Normal</option>
                    <option value="High">Acil</option>
                    <option value="Critical">Kritik</option>
                  </select>
                </div>

                {/* ÖNCE CARİ/BAYİ, SONRA ÜRÜN (2026-08-21 kullanıcı kuralı).
                    Arıza kabulünde önce kimin adına kayıt açıldığı belirlenir; ürün
                    bilgisi ondan sonra girilir. İki blok bilerek bu sırada. */}
                <div className="space-y-1 md:col-span-2 border-t pt-4">
                  <div className="text-xs font-bold text-red-600 uppercase">MÜŞTERİ CARİ & BAYİ BİLGİLERİ</div>
                </div>

                <div className="space-y-3 md:col-span-2 bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/80 animate-in fade-in duration-200 shadow-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <span>🔍</span>
                      <span>Bayi Cari Arama (İsim, Telefon veya Cari Kod)</span>
                      <span className="text-red-500">*</span>
                    </div>
                    {/*
                      YENİ MÜŞTERİ EKLE (2026-08-24, kullanıcı isteği).

                      2026-08-21'de kaldırılmıştı ("arıza kabulünde cari yaratılmaz"); kullanıcı
                      geri istedi. Kapsam kuralı eklendi: yalnızca TÜM carilere erişimi olanda
                      çıkar. Tek cariye bağlı bayi zaten kendi carisinden başkasını seçemiyor,
                      ona cari açma düğmesi göstermek yanlış olurdu.
                    */}
                    {tumCarilerErisimi && (
                      <button
                        type="button"
                        onClick={() => setYeniMusteriAcik(true)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                      >
                        + Yeni Müşteri Ekle
                      </button>
                    )}
                  </div>
                  {/* TEK ALAN: yazdıkça sonuçlar hemen altında açılır, tıklanınca seçilir.
                      Ayrı "Ara" düğmesi ve altındaki ikinci `select` kaldırıldı — kullanıcı
                      üstten arayıp alttan seçmek zorunda kalıyordu. */}
                  <div className="relative">
                    <input
                      type="text"
                      value={dealerSearchQuery}
                      onChange={(e) => {
                        setDealerSearchQuery(toTurkishUpper(e.target.value))
                        setDealerListOpen(true)
                      }}
                      onFocus={() => setDealerListOpen(true)}
                      onBlur={() => window.setTimeout(() => setDealerListOpen(false), 120)}
                      placeholder="Cari adı, telefon numarası veya cari kodu ile ara..."
                      className="px-3.5 py-2.5 bg-white border border-gray-200 rounded-xl text-sm w-full focus:outline-none focus:ring-2 focus:ring-[#B91C1C]/20 focus:border-[#B91C1C] transition-all font-medium placeholder:text-gray-400 uppercase"
                    />

                    {dealerListOpen && (
                      <div className="absolute z-40 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-2xl max-h-72 overflow-y-auto divide-y divide-gray-100">
                        {loadingDealers ? (
                          <div className="px-3.5 py-3 text-xs text-gray-500 font-medium">Cariler yükleniyor...</div>
                        ) : filteredDealersForType.length === 0 ? (
                          <div className="px-3.5 py-3 text-xs text-gray-400 font-medium text-center">Sonuç bulunamadı</div>
                        ) : (
                          filteredDealersForType.slice(0, 50).map((d) => (
                            <div
                              key={d.customerCode}
                              role="button"
                              tabIndex={0}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                applyDealerSelection(d)
                                setDealerListOpen(false)
                              }}
                              className="px-3.5 py-2.5 text-xs cursor-pointer hover:bg-slate-50 text-gray-800"
                            >
                              <div className="font-semibold text-gray-900">{d.name}</div>
                              <div className="text-[11px] text-gray-500">
                                {d.customerCode}{d.phone ? ` · ${d.phone}` : ''}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  {/*
                    CARİ ALANLARI HİÇ KİMSEDE ELLE YAZILAMAZ (2026-08-27 kullanıcı kuralı).

                    Cari YALNIZCA yukarıdaki arama kutusundan seçilir; yeni müşteri gerekiyorsa
                    "+ Yeni Müşteri Ekle" ile açılır. Serbest metin kalırsa iki sorun doğuyor:
                    kayıt hiçbir cari koduna bağlanmadan açılabiliyor, ve tek cariye bağlı bir
                    kullanıcı başka carinin adını yazıp kapsam süzgecini atlayabiliyor.

                    İlk sürümde kilit yalnızca sınırlı kullanıcılara konmuştu; kullanıcı
                    alanların herkeste kilitli olmasını istedi.
                  */}
                  <div className="text-xs font-semibold text-gray-500">Cari / Müşteri / Bayi Adı <span className="text-red-500">*</span></div>
                  <input
                    type="text"
                    value={newRecord.dealerName}
                    onChange={(e) => {
                      const val = toTurkishUpper(e.target.value)
                      const allDealers = selectableDealers
                      const matched = allDealers.find(d => 
                        d.name.toUpperCase() === val || 
                        `${d.name} (${d.customerCode})`.toUpperCase() === val ||
                        val.includes(d.customerCode)
                      )
                      setNewRecord((p) => ({ 
                        ...p, 
                        dealerName: val,
                        dealerCode: matched ? matched.customerCode : p.dealerCode
                      }))
                    }}
                    readOnly
                    title="Cari yukarıdaki arama kutusundan seçilir; elle yazılamaz"
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-full text-gray-900 font-medium uppercase bg-gray-100 cursor-not-allowed"
                    placeholder="Cari, bayi, mağaza veya müşteri adı"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-semibold text-gray-500">Cari / Bayi Telefonu</div>
                  <input
                    type="text"
                    value={newRecord.dealerPhone}
                    onChange={(e) => setNewRecord((p) => ({ ...p, dealerPhone: sanitizePhone(e.target.value) }))}
                    readOnly
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-full text-gray-900 font-medium bg-gray-100 cursor-not-allowed"
                    placeholder="Telefon numarası"
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <div className="text-xs font-semibold text-gray-500">Cari / Bayi Adresi</div>
                  <input
                    type="text"
                    value={newRecord.dealerAddress}
                    onChange={(e) => setNewRecord((p) => ({ ...p, dealerAddress: toTurkishUpper(e.target.value) }))}
                    readOnly
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-full uppercase font-medium bg-gray-100 cursor-not-allowed"
                    placeholder="Adres"
                  />
                </div>

                <div className="space-y-1 md:col-span-2 border-t pt-4">
                  <div className="text-xs font-bold text-red-600 uppercase">Ürün Bilgileri</div>
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-semibold text-gray-500">Garantisi Var mı? <span className="text-red-500">*</span></div>
                  <select
                    value={newRecord.isUnderWarranty}
                    onChange={(e) => {
                      const val = e.target.value
                      setNewRecord((p) => ({ 
                        ...p, 
                        isUnderWarranty: val,
                        warrantyStartDate: val === 'Evet' ? p.warrantyStartDate : ''
                      }))
                    }}
                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                  >
                    <option value="Bilinmiyor">Bilinmiyor</option>
                    <option value="Hayır">Hayır</option>
                    <option value="Evet">Evet</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-gray-500">Ürün <span className="text-red-500">*</span></div>
                  <SearchableProductSelect
                    products={displayedProducts}
                    value={newRecord.productName}
                    onChange={(val) => setNewRecord((p) => ({ ...p, productName: val }))}
                    disabled={loadingProducts}
                    placeholder="Ürün Ara veya Seç..."
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-semibold text-gray-500">Garanti Başlangıç Tarihi</div>
                  <input
                    type="date"
                    disabled={newRecord.isUnderWarranty !== 'Evet'}
                    value={newRecord.isUnderWarranty === 'Evet' ? newRecord.warrantyStartDate : ''}
                    onChange={(e) => setNewRecord((p) => ({ ...p, warrantyStartDate: e.target.value }))}
                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-semibold text-gray-500">Seri Numarası (Opsiyonel)</div>
                  <input
                    type="text"
                    value={newRecord.serialNumber}
                    onChange={(e) => setNewRecord((p) => ({ ...p, serialNumber: sanitizeSerial(e.target.value) }))}
                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-semibold text-gray-500">Bölge <span className="text-red-500">*</span></div>
                  <select
                    value={newRecord.regionId}
                    onChange={(e) => setNewRecord((p) => ({ ...p, regionId: e.target.value }))}
                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                  >
                    <option value="">Seçiniz...</option>
                    {regions.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>


                {/* KAGIT FIS NO: urunle birlikte doldurulan basili fisin numarasi. Kabul aninda
                    girilir; sonradan detay cekmecesindeki "Fis No" dugmesinden de duzeltilebilir.
                    Zorunlu DEGIL ve tekil DEGIL. */}
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-gray-500">Kağıt Fiş No</div>
                  <input
                    type="text"
                    value={newRecord.manualReceiptNo}
                    onChange={(e) => setNewRecord((p) => ({ ...p, manualReceiptNo: e.target.value }))}
                    maxLength={50}
                    placeholder="Basılı fişin numarası (varsa)"
                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full font-mono focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                  />
                </div>

                {categoryFilter !== 'large' && (
                  <div className="space-y-1 md:col-span-2">
                    <div className="text-xs font-semibold text-gray-500">Teslim Alma Formu Notu (Hasar, Çizik vs.)</div>
                    <textarea
                      value={newRecord.receivingNote}
                      onChange={(e) => setNewRecord((p) => ({ ...p, receivingNote: toTurkishUpper(e.target.value) }))}
                      placeholder="Örn: Hortumu yırtık, yan gövdede çizik var..."
                      className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full h-16 resize-none focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                    />
                  </div>
                )}

                <div className="space-y-1 md:col-span-2">
                  <div className="text-xs font-semibold text-gray-500">Müşteri Şikayeti <span className="text-red-500">*</span></div>
                  <input
                    type="text"
                    value={newRecord.problemDescription}
                    onChange={(e) => setNewRecord((p) => ({ ...p, problemDescription: toTurkishUpper(e.target.value) }))}
                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                  />
                </div>

                {/*
                  TESLİM ŞEKLİ: MAĞAZADAN ALINACAK (2026-08-27) / BAYİYE TESLİM (2026-08-28).

                  İkisi de `PickupSourceId` kolonunda kimlik değeriyle saklanır ve kayıt
                  listelerde müşteri tipini bu seçim belirler — mağaza mor, bayiye teslim
                  KIRMIZI rozetle çıkar.

                  AYNI KOLONU PAYLAŞTIKLARI İÇİN BİRBİRLERİNİ DIŞLARLAR. Biri işaretlenince
                  diğeri burada açıkça kaldırılıyor; yoksa kullanıcı iki kutuyu da işaretler,
                  kayıt tek değer taşıyabildiği için biri sessizce yutulurdu.

                  YALNIZCA TÜM CARİLERE ERİŞİMİ OLANDA çıkar — sayfadaki diğer kapsam
                  düğmeleriyle aynı kural. Tek cariye bağlı bayi kendi carisinden başkasını
                  seçemiyor; ona bu seçenekleri göstermek basıldığında anlamı olmayan bir
                  kapı açardı.
                */}
                {tumCarilerErisimi && (
                  <label className="space-y-1 md:col-span-2 flex items-start gap-2.5 cursor-pointer rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={newRecord.magazadanTeslim}
                      onChange={(e) => setNewRecord((p) => ({
                        ...p,
                        magazadanTeslim: e.target.checked,
                        bayiyeTeslim: e.target.checked ? false : p.bayiyeTeslim
                      }))}
                      className="mt-0.5 rounded text-amber-600 focus:ring-amber-500"
                    />
                    <span>
                      <span className="block text-xs font-bold text-amber-900">Ürün mağazadan teslim alınacak</span>
                      <span className="block text-[11px] text-amber-800/80 mt-0.5">
                        İşaretlenirse kayıt listelerde <strong>Mağaza</strong> müşteri tipiyle görünür.
                      </span>
                    </span>
                  </label>
                )}

                {tumCarilerErisimi && (
                  <label className="space-y-1 md:col-span-2 flex items-start gap-2.5 cursor-pointer rounded-lg border border-red-200 bg-red-50/60 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={newRecord.bayiyeTeslim}
                      onChange={(e) => setNewRecord((p) => ({
                        ...p,
                        bayiyeTeslim: e.target.checked,
                        magazadanTeslim: e.target.checked ? false : p.magazadanTeslim
                      }))}
                      className="mt-0.5 rounded text-red-600 focus:ring-red-500"
                    />
                    <span>
                      <span className="block text-xs font-bold text-red-900">Ürün bayiye teslim edilecek</span>
                      <span className="block text-[11px] text-red-800/80 mt-0.5">
                        İşaretlenirse kayıt listelerde kırmızı <strong>Bayiye Teslim</strong> rozetiyle görünür.
                      </span>
                    </span>
                  </label>
                )}

                <div className="space-y-1 md:col-span-2 border-t pt-4 flex items-center justify-between gap-2">
                  <div className="text-xs font-bold text-red-600 uppercase">ÜRÜNÜ TESLİM ALAN / TESLİMAT EDİLECEK KİŞİ BİLGİLERİ</div>
                  {/*
                    ÜRÜNÜ TESLİM ALAN KİŞİ AYNI (2026-08-24, kullanıcı isteği).
                    Alanları cari/bayi bilgisiyle doldurur; ayrıntı `teslimAlanCariyleAyni`.
                  */}
                  {tumCarilerErisimi && (
                    <button
                      type="button"
                      onClick={teslimAlanCariyleAyni}
                      disabled={!newRecord.dealerName}
                      title={newRecord.dealerName ? 'Teslim alan alanlarını cari bilgileriyle doldurur' : 'Önce cari seçin'}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Ürünü Teslim Alan Kişi Aynı
                    </button>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-semibold text-gray-500">Teslim Alan Ad Soyad <span className="text-red-500">*</span></div>
                  <input
                    type="text"
                    value={newRecord.customerName}
                    onChange={(e) => setNewRecord((p) => ({ ...p, customerName: sanitizeName(e.target.value) }))}
                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-semibold text-gray-500">Teslim Alan Telefon <span className="text-red-500">*</span></div>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={newRecord.customerPhone}
                    onChange={(e) => setNewRecord((p) => ({ ...p, customerPhone: sanitizePhone(e.target.value) }))}
                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <div className="text-xs font-semibold text-gray-500">Teslim Alan Adresi <span className="text-red-500">*</span></div>
                  <input
                    type="text"
                    value={newRecord.customerAddress}
                    onChange={(e) => setNewRecord((p) => ({ ...p, customerAddress: toTurkishUpper(e.target.value) }))}
                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full uppercase font-medium"
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <div className="text-xs font-semibold text-gray-500">Ürün Görseli (Opsiyonel)</div>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))}
                    className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                  />
                  {selectedFiles.length > 0 && (
                    <div className="text-xs text-green-600 mt-1">Seçilen Dosyalar: {selectedFiles.map(f => f.name).join(', ')}</div>
                  )}
                </div>

                {actionError ? (
                  <div className="md:col-span-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs font-semibold text-red-600">
                    {actionError}
                  </div>
                ) : null}
              </div>
            </div>

              <div className="p-5 border-t border-gray-100 flex items-center justify-end gap-2 shrink-0">
                <button
                  onClick={() => setCreateOpen(false)}
                  className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50"
                >
                  Vazgeç
                </button>
                <button
                  disabled={actionLoading}
                  onClick={async () => {
                    setActionLoading(true)
                    setActionError(null)
                    setActionSuccess(null)
                    try {
                      if (!newRecord.productName.trim()) {
                        setActionError('Ürün seçimi zorunludur.')
                        setActionLoading(false)
                        return
                      }
                      if (!newRecord.regionId) {
                        setActionError('Bölge seçimi zorunludur.')
                        setActionLoading(false)
                        return
                      }

                      if (!newRecord.problemDescription.trim()) {
                        setActionError('Müşteri şikayeti zorunludur.')
                        setActionLoading(false)
                        return
                      }
                      if (!newRecord.customerName.trim()) {
                        setActionError('Müşteri ad soyad zorunludur.')
                        setActionLoading(false)
                        return
                      }
                      if (!isValidPhone(newRecord.customerPhone)) {
                        setActionError('Müşteri cep telefonu sadece sayı içermeli ve geçerli uzunlukta olmalıdır.')
                        setActionLoading(false)
                        return
                      }
                      if (!newRecord.customerAddress.trim()) {
                        setActionError('Müşteri adresi zorunludur.')
                        setActionLoading(false)
                        return
                      }
                      if (!newRecord.dealerName.trim()) {
                        setActionError(newRecord.customerType === 'Bayi' ? 'Bayi seçimi zorunludur.' : 'Mağaza adı zorunludur.')
                        setActionLoading(false)
                        return
                      }
                      const combinedDescription = newRecord.problemDescription.trim();

                      const allDealers = selectableDealers
                      let finalDealerCode = newRecord.dealerCode
                      if (!finalDealerCode && newRecord.dealerName) {
                        const dUpper = newRecord.dealerName.trim().toUpperCase()
                        const matched = allDealers.find(d => 
                          d.name.toUpperCase() === dUpper || 
                          `${d.name} (${d.customerCode})`.toUpperCase() === dUpper ||
                          dUpper.includes(d.customerCode) ||
                          dUpper.includes(d.name.toUpperCase())
                        )
                        if (matched) finalDealerCode = matched.customerCode
                      }

                      const created = await createRecord({
                        type: 'Repair',
                        category: categoryFilter,
                        customerName: newRecord.customerName || undefined,
                        customerPhone: newRecord.customerPhone || undefined,
                        customerAddress: newRecord.customerAddress || undefined,
                        productName: newRecord.productName,
                        serialNumber: newRecord.serialNumber || undefined,
                        receivingNote: newRecord.receivingNote || undefined,
                        manualReceiptNo: newRecord.manualReceiptNo || undefined,
                        isUnderWarranty: newRecord.isUnderWarranty === 'Evet',
                        // 1 = Mağazadan alınacak, 2 = Bayiye teslim edilecek. İkisi de
                        // işaretli değilse alan hiç gönderilmez (varsayılan akış).
                        pickupSourceId: newRecord.magazadanTeslim
                          ? TESLIM_KAYNAGI_MAGAZA
                          : newRecord.bayiyeTeslim
                          ? TESLIM_KAYNAGI_BAYI
                          : undefined,
                        /*
                          GARANTİ BAŞLANGIÇ TARİHİ ARTIK KAYDEDİLİYOR (2026-08-26).

                          Form bu alanı en baştan beri soruyordu ama gövdeye HİÇ konmuyordu:
                          kullanıcı tarihi giriyor, kaydet'e basıyor ve tarih hiçbir yere
                          yazılmadan kayboluyordu. Listede "Garanti: Evet" yazan kayıtların
                          altında tarih olmamasının sebebi buydu.
                        */
                        warrantyStartDate: newRecord.isUnderWarranty === 'Evet'
                          ? (newRecord.warrantyStartDate || '')
                          : '',
                        dealerName: newRecord.dealerName || undefined,
                        dealerCode: finalDealerCode || undefined,
                        dealerPhone: newRecord.dealerPhone || undefined,
                        dealerAddress: newRecord.dealerAddress || undefined,
                        problemDescription: combinedDescription || undefined,
                        priority: newRecord.priority,
                        regionId: newRecord.regionId,
                        /*
                          KABUL TARİHİ PLANLAMA TARİHİ DEĞİLDİR (2026-08-27 kullanıcı
                          bildirimi: "bu kaydı kimse planlamamış, kayıt yapmış otomatik
                          planlandıya düşmüş").

                          Formun üstündeki "Tarih" alanı GRİ ve TIKLANAMAZ — sadece bugünü
                          gösteren bir bilgi kutusu. Ama gövdeye `plannedDate` olarak
                          gidiyordu ve sunucu onu `PlannedAt`'e yazıyordu. Sonuç: kabulden
                          çıkan HER kayıt, planlanan günü kayıt günü olacak şekilde
                          "planlanmış" oluyor, planlama listesinde teknisyeni boş olduğu
                          hâlde "Planlandı" rozetiyle görünüyordu (rozet `plannedAt` dolu mu
                          diye bakıyor).

                          Kaydın tarihi zaten `CreatedAt`; buradan ayrıca göndermek gereksizdi.
                          Planlanan gün YALNIZCA planlama ekranından yazılır.
                        */
                      })

                      if (selectedFiles.length > 0 && created?.id) {
                        const token = getAccessToken()
                        for (const file of selectedFiles) {
                          const formData = new FormData()
                          formData.append('file', file)
                          await fetch(`${API_BASE_URL}/api/servicerecords/${created.id}/photo`, {
                            method: 'POST',
                            headers: token ? { Authorization: `Bearer ${token}` } : {},
                            body: formData
                          })
                        }
                      }

                      setCreateOpen(false)
                      setSelectedFiles([])
                      setNewRecord(emptyNewRecord())
                      setActionSuccess('Servis kaydı oluşturuldu.')
                      toast.success('Servis kaydı başarıyla oluşturuldu.')
                      await refetch()

                      if (isCreateRoute) {
                        navigate(categoryFilter === 'small' ? '/kucuk-urun-kabul' : '/buyuk-urun-kabul')
                      }
                    } catch (e: any) {
                      setActionError(String(e?.message ?? 'Kayıt oluşturulamadı'))
                    } finally {
                      setActionLoading(false)
                    }
                  }}
                  className={actionLoading ? 'px-4 py-2 rounded-lg text-sm font-semibold bg-gray-300 text-gray-600' : 'px-4 py-2 rounded-lg text-sm font-semibold bg-[#B91C1C] text-white hover:bg-[#991B1B]'}
                >
                  {actionLoading ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Memnuniyet anketi: montaj sayfalarıyla ORTAK bileşen. */}
      <MemnuniyetAnketiModal
        kayit={satisfactionRecord as any}
        onClose={() => setSatisfactionRecord(null)}
        kaydet={(id, puan, not) => updateSatisfaction(id, puan, not)}
        onSaved={() => refetch(true)}
      />

      {/* Hızlı müşteri ekleme modalı kaldırıldı: arıza kabulünde cari yaratılmıyor. */}

      <KabulTakvimModal
        isOpen={calendarModalOpen}
        onClose={() => setCalendarModalOpen(false)}
        type="Repair"
        categoryFilter={categoryFilter}
      />

      {/*
        Yeni cari acildiginda form o cariyle doldurulur; kullanici bir de listeden aramak
        zorunda kalmasin. Kod alani da yaziliyor, kayit dogru cariye baglansin diye.
      */}
      <QuickAddCustomerModal
        isOpen={yeniMusteriAcik}
        onClose={() => setYeniMusteriAcik(false)}
        onSuccess={(musteri) => {
          setNewRecord((p) => ({
            ...p,
            dealerCode: musteri.customerCode,
            dealerName: musteri.name,
            dealerPhone: musteri.phone || '',
            dealerAddress: musteri.address || '',
          }))
          setYeniMusteriAcik(false)
        }}
      />

      <FisNoModal
        open={!!fisNoFor}
        onClose={() => setFisNoFor(null)}
        recordId={fisNoFor?.id ?? ''}
        serviceNumber={fisNoFor?.serviceNumber}
        productName={fisNoFor?.productName}
        customerName={fisNoFor?.customerName ?? fisNoFor?.dealerName ?? undefined}
        currentValue={fisNoFor?.manualReceiptNo}
        onSaved={async (val) => {
          // Acik detay cekmecesi de tazelensin; yoksa dugme hala "Fis No Gir" der.
          setSelectedRecord((prev) => (prev && prev.id === fisNoFor?.id ? { ...prev, manualReceiptNo: val } : prev))
          await refetch()
        }}
      />
      </div> {/* Closing px-4 wrapper */}
      {/* Geçmiş görsellerinin büyütülmesi; tıklanan fotoğrafın sırası ile açılır. */}
      <GorselOnizleyici
        gorseller={buyutulenGorseller}
        acikIndex={buyutulenIdx}
        onKapat={() => setBuyutulenIdx(null)}
      />
    </div>

  )
}
