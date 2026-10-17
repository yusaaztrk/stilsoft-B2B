import { useEffect, useMemo, useState } from 'react'
import DurumNotuVeGorselEkle from '../components/DurumNotuVeGorselEkle'
import { useLocation } from 'react-router-dom'
import {
  Filter,
  Plus,
  Download,
  MoreHorizontal,
  X,
  Phone,
  MapPin,
  AlertTriangle,
  Copy,
  Pencil,
  FileText,
  RefreshCw,
  Info,
  Eye,
  Trash2,
  Calendar,
  RotateCcw,
} from 'lucide-react'
import { apiJson } from '../api/client'
import { API_BASE_URL } from '../config'
import { getAccessToken, getSingleDealerCode, hasAllDealers } from '../auth/storage'
import { useServiceRecordsPaged, type ServiceRecord } from '../hooks/useServiceRecords'
import { useTechnicians } from '../hooks/useTechnicians'
import Table, { type TableColumn } from '../components/Table'
import { fetchServiceExport } from '../api/serviceRecords'
import { fetchErpProducts, fetchErpDealers, isMontajProduct, createMontajBedeliSiparis, checkMontajBedeliLimit, montajBedeliLimitMesaji, type ErpProductDto, type ErpDealerDto, type ErpDealerType } from '../api/erp'
import ErpCariSelect, { formatCariLabel } from '../components/ErpCariSelect'
import { sanitizeName, sanitizePhone, sanitizeSerial, isValidPhone, toTurkishUpper } from '../utils/formInput'
import { TableActionButton } from '../components/TableActionButton'
import { groupTimelineEvents } from '../utils/timelineHelper'
import { getCustomerOrDealerType, getCustomerTypeBadgeClass } from '../utils/customerType'
import QuickAddCustomerModal from '../components/QuickAddCustomerModal'
import SearchableProductSelect from '../components/SearchableProductSelect'
import TimelineEvent from '../components/TimelineEvent'
import ServisGecmisiModal from '../components/ServisGecmisiModal'
import { usePermissions, useCanViewHistory } from '../auth/PermissionsContext'
import MemnuniyetAnketiModal, { MemnuniyetHucresi } from '../components/MemnuniyetAnketiModal'
import KabulTakvimModal from '../components/KabulTakvimModal'
import { toast } from 'sonner'
import PhoneLinks from '../components/PhoneLinks'
import BayiHucresi from '../components/BayiHucresi'
import { anaCariKodu } from '../utils/bayiEtiketi'

type RegionOption = { id: string; name: string }

type MontajItemRow = {
  key: string
  id?: string
  productName: string
  quantity: string
  serialNumber: string
  customerName?: string
  customerPhone?: string
  customerAddress?: string
  notes?: string
  regionId?: string
  customerType?: string
  dealerName?: string
  dealerPhone?: string
  dealerAddress?: string
  dealerInvoiceType?: string
  selectedDealer?: ErpDealerDto | null
}

let itemRowSeq = 0
function createEmptyItemRow(): MontajItemRow {
  itemRowSeq += 1
  return { key: `item-${itemRowSeq}`, productName: '', quantity: '1', serialNumber: '' }
}

// Formdaki "Bayi Tipi" seçimi ile cari uçlarının tip anahtarı arasındaki eşleme.
// Bayi 120-01, Mağaza 120-04, Müşteri 120-03.
function toErpDealerType(customerType: string): ErpDealerType {
  if (customerType === 'Mağaza') return 'magaza'
  if (customerType === 'Müşteri') return 'musteri'
  return 'bayi'
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
}

function getStatusStyle(status: string) {
  return statusStyles[(status || '').toLowerCase()] || statusStyles.new
}

const statusTranslations: Record<string, string> = {
  new: 'Yeni Kayıt',
  planned: 'Planlandı',
  workshop: 'Devam Ediyor',
  inrepair: 'Devam Ediyor',
  ready: 'Gerçekleşti',
  delivered: 'Teslim Edildi',
  cancelled: 'İptal',
  delayed: 'Ertelendi',
  waitingforparts: 'Devam Ediyor',
}

const taskStatusConfig: Record<string | number, { label: string; color: string; value: string }> = {
  Planned: { label: 'Planlandı', color: 'bg-purple-100 text-purple-700 border-purple-200', value: 'Planned' },
  InProgress: { label: 'Devam Ediyor', color: 'bg-orange-100 text-orange-700 border-orange-200', value: 'InProgress' },
  Completed: { label: 'Gerçekleşti', color: 'bg-green-100 text-green-700 border-green-200', value: 'Completed' },
  Cancelled: { label: 'İptal', color: 'bg-red-100 text-red-700 border-red-200', value: 'Cancelled' },
  Deferred: { label: 'Yeni Kayıt', color: 'bg-blue-100 text-blue-700 border-blue-200', value: 'Deferred' },
  Delivered: { label: 'Teslim Edildi (Planlama Bekliyor)', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', value: 'Delivered' },
  Postponed: { label: 'Ertelendi', color: 'bg-amber-100 text-amber-700 border-amber-200', value: 'Postponed' },
  // Integer keys
  0: { label: 'Planlandı', color: 'bg-purple-100 text-purple-700 border-purple-200', value: 'Planned' },
  1: { label: 'Devam Ediyor', color: 'bg-orange-100 text-orange-700 border-orange-200', value: 'InProgress' },
  2: { label: 'Gerçekleşti', color: 'bg-green-100 text-green-700 border-green-200', value: 'Completed' },
  3: { label: 'İptal', color: 'bg-red-100 text-red-700 border-red-200', value: 'Cancelled' },
  4: { label: 'Yeni Kayıt', color: 'bg-blue-100 text-blue-700 border-blue-200', value: 'Deferred' },
  5: { label: 'Ulaşılamadı', color: 'bg-rose-100 text-rose-800 border-rose-300', value: 'Unreachable' },
  6: { label: 'Teslim Edildi (Planlama Bekliyor)', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', value: 'Delivered' },
  7: { label: 'Ertelendi', color: 'bg-amber-100 text-amber-700 border-amber-200', value: 'Postponed' },
}

/**
 * Kalem kendi GERÇEK durumunu gösterir (Planlandı, Devam Ediyor, Gerçekleşti…) — indirgenmez.
 * Sadeleştirme yalnızca üst seviyede: alttakilerin hepsi aynı durumdaysa o durum, karışıksa
 * "İşlemde". Yeni kayıtta bütün kalemler "Yeni Kayıt" olduğu için fatura da "Yeni Kayıt",
 * hepsi bitince "Gerçekleşti" olur.
 *
 * `Mixed` ayrı bir değer: `InProgress` ("Devam Ediyor") zaten gerçek bir görev durumu.
 */
const itemStateConfig: Record<string, { label: string; color: string }> = {
  ...taskStatusConfig,
  Mixed: { label: 'İşlemde', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  // İş bitti ama içinde iptal edilmiş kalem var. Düz "Gerçekleşti" faturanın eksiksiz
  // tamamlandığı izlenimi veriyordu; ünlem açıp bakmayı hatırlatıyor.
  CompletedWithCancellations: { label: 'Gerçekleşti !', color: 'bg-green-100 text-green-800 border-green-300' },
}

/** Fatura izi montaj kaydının açıklamasına "[Fatura No: X]" olarak yazılıyor. */
function extractInvoiceNo(problemDescription?: string | null): string | null {
  const m = /\[Fatura No:\s*([^\]]+)\]/.exec(problemDescription || '')
  return m ? m[1].trim() : null
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

const convertToWebP = async (file: File): Promise<File> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
          const webpFile = new File([blob], `${baseName}.webp`, { type: 'image/webp' });
          resolve(webpFile);
        }, 'image/webp', 0.85);
      };
      img.onerror = () => resolve(file);
      img.src = event.target?.result as string;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
};


function getGroupedTasks(tasks: any[], record: any) {
  const groups: Record<string, any> = {}
  for (const t of tasks) {
    const techId = t.assignedTechnicianId || t.AssignedTechnicianId || 'unassigned'
    const dateStr = (t.plannedAt || t.PlannedAt || '').split('T')[0] || 'nodate'
    const key = `${techId}_${dateStr}`
    
    if (!groups[key]) {
      groups[key] = {
        id: t.id || t.Id,
        Id: t.id || t.Id,
        assignedTechnicianId: t.assignedTechnicianId || t.AssignedTechnicianId || null,
        AssignedTechnicianId: t.assignedTechnicianId || t.AssignedTechnicianId || null,
        technicianName: t.technicianName || t.TechnicianName || null,
        TechnicianName: t.technicianName || t.TechnicianName || null,
        plannedAt: t.plannedAt || t.PlannedAt || null,
        PlannedAt: t.plannedAt || t.PlannedAt || null,
        quantity: 0,
        Quantity: 0,
        notesList: [] as string[],
        taskIds: [] as string[],
        photoUrl: t.photoUrl || t.PhotoUrl || null,
        PhotoUrl: t.photoUrl || t.PhotoUrl || null,
      }
    }
    
    const qty = t.quantity || t.Quantity || 1
    groups[key].quantity += qty
    groups[key].Quantity += qty
    groups[key].taskIds.push(t.id || t.Id)
    
    const note = t.notes || t.Notes
    if (note && note.trim()) {
      groups[key].notesList.push(note.trim())
    }
    
    if (t.photoUrl || t.PhotoUrl) {
      groups[key].photoUrl = t.photoUrl || t.PhotoUrl
      groups[key].PhotoUrl = t.photoUrl || t.PhotoUrl
    }
  }
  
  return Object.values(groups).map((g: any) => {
    const uniqueNotes = Array.from(new Set(g.notesList)).join(', ')
    return {
      ...g,
      notes: uniqueNotes,
      Notes: uniqueNotes,
    }
  })
}

export default function MontajKabulPage() {
  const location = useLocation()
  const { can } = usePermissions()
  const canViewHistory = useCanViewHistory()

  // Kabul listesindeki iki kolon ayri yetkiler (kullanici karari): bayi/alt bayi kapali,
  // digerlerinde acik. Anahtarlar B2B Pages tablosundan gelir, kodda rol adi gecmez.
  const canSeeSatisfaction = can('montajKabul.memnuniyet')
  const canSeeActions = can('montajKabul.aksiyon')
  const canCreate = can('montajKabul.yeniKabul')

  // Kalem satırındaki İŞLEMLER sütunu (düzenle + geçmiş) kayıt seviyesindeki Aksiyon
  // sütunundan AYRI bir yetki: biri faturanın tamamını, diğeri tek bir montaj kalemini
  // yönetiyor. Bayi/alt bayi kaydı görür ama kalemlere dokunamaz.
  const canSeeItemActions = can('montajKabul.kalemIslemleri')
  const canSeeCalendar = can('takvim')
  const [calendarModalOpen, setCalendarModalOpen] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<ServiceRecord | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [showFiltersMobile, setShowFiltersMobile] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [infoTimeline, setInfoTimeline] = useState<any[]>([])
  const [infoTimelineDurum, setInfoTimelineDurum] = useState<'bekliyor' | 'yukleniyor' | 'hazir'>('bekliyor')

  // Satisfaction Survey states
  // Anket MODALI ORTAK BİLEŞENE TAŞINDI (2026-08-25): Montaj Geçmişi de aynı anketi
  // kullanıyor. Puan/not/kaydetme durumu artık bileşenin içinde — burada yalnızca "hangi
  // kaydın anketi açık" bilgisi kalıyor.
  const [satisfactionRecord, setSatisfactionRecord] = useState<ServiceRecord | null>(null)
  // Servis fişi (iş emri) oluşturma/basma bu sayfadan kaldırıldı; artık Montaj Yönetimi'nde
  // yapılıyor ve fiş basılmadan kayıt sahaya aktarılamıyor.

  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [expandedTasks, setExpandedTasks] = useState<any[]>([])
  const [expandedLoading, setExpandedLoading] = useState(false)
  const [subFilterTech, setSubFilterTech] = useState('')
  const [subFilterStatus, setSubFilterStatus] = useState('')
  const [subFilterQty, setSubFilterQty] = useState('')
  const [subFilterPlannedDate, setSubFilterPlannedDate] = useState('')
  const [subFilterCustomer, setSubFilterCustomer] = useState('')
  const [subFilterAddress, setSubFilterAddress] = useState('')
  const [subFilterNotes, setSubFilterNotes] = useState('')
  const [subFilterProduct, setSubFilterProduct] = useState('')
  // Kalem yanındaki "i": Atölye/Saha ile birebir aynı geçmiş modalını açar.
  const [historyRecordId, setHistoryRecordId] = useState<string | null>(null)
  const [historyTaskId, setHistoryTaskId] = useState<string | null>(null)
  // Düzenleme kayıt seviyesinde değil KALEM seviyesinde: bir kayıtta farklı ürün/müşteri/adres
  // taşıyan kalemler var, kaydı topluca düzenlemek hepsini aynı değere çekiyordu.
  const [editingItem, setEditingItem] = useState<any | null>(null)
  const [itemSaving, setItemSaving] = useState(false)
  const [itemError, setItemError] = useState<string | null>(null)

  /**
   * Düzenleme kapalıysa sebebini söyleyen uyarı. Butonu sessizce pasif bırakmak
   * "bozuk" gibi görünüyordu; kullanıcı neden düzenleyemediğini ve nereden düzenleyeceğini
   * görmeli.
   */
  const [editBlockedMsg, setEditBlockedMsg] = useState<string | null>(null)

  /**
   * Kalem faturadan mı geldi (B2B fatura kalemi). Ürün ve miktarın tek kaynağı faturadır:
   * burada değiştirilse fatura yeniden kaydedildiğinde webhook geri yazar.
   */
  const isItemInvoiceBacked = (item: any) => !!(item?.externalRef ?? item?.ExternalRef) || !!item?.isInvoiceBacked

  /** Kayıtta faturadan gelen kalem varsa kayıt seviyesindeki düzenleme de faturaya aittir. */
  const isRecordInvoiceBacked = (record: any) =>
    (record?.items ?? []).some((i: any) => isItemInvoiceBacked(i))

  /**
   * Düzenleme yalnızca iş HENÜZ BAŞLAMAMIŞKEN serbest. Planlanmış/sahaya çıkmış bir kaydın
   * ürün ve adedini değiştirmek, teknisyene gitmiş iş satırlarıyla kaydı çelişkiye düşürür.
   */
  const isRecordEditable = (record: any) => {
    const derived = record?.derivedState as string | undefined
    const status = String(record?.status ?? '')
    return (derived ? derived === 'Deferred' : true) && (status === 'New' || status === '0')
  }

  const INVOICE_EDIT_MESSAGE =
    'Bu montaj faturadan geldi. Ürün ve adet bilgisi faturanın kendisinde tutulur — lütfen faturanızdan düzenleyin.'

  // "Tamamlanmayı Geri Al": Ready/Delivered kaydı Teslimattakiler'e (Workshop) geri gönderir.
  // Görevlere dokunmaz — hatalı işaretlenen kalem varsa orada düzeltilir.
  const [geriAlTarget, setGeriAlTarget] = useState<any | null>(null)
  const [geriAlLoading, setGeriAlLoading] = useState(false)
  const [geriAlError, setGeriAlError] = useState<string | null>(null)

  const saveEditingItem = async () => {
    if (!editingItem) return
    if (!editingItem.customerName?.trim()) {
      setItemError('İsim Soyisim alanı zorunludur.')
      return
    }
    if (!editingItem.customerPhone?.trim()) {
      setItemError('Telefon alanı zorunludur.')
      return
    }
    if (!editingItem.customerAddress?.trim()) {
      setItemError('Adres alanı zorunludur.')
      return
    }
    setItemSaving(true)
    setItemError(null)
    try {
      await apiJson(`/api/installations/items/${editingItem.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          productName: editingItem.productName,
          productStockCode: editingItem.productStockCode,
          serialNumber: editingItem.serialNumber,
          quantity: Number(editingItem.quantity) || 1,
          notes: editingItem.notes,
          customerName: editingItem.customerName,
          customerPhone: editingItem.customerPhone,
          customerAddress: editingItem.customerAddress,
        }),
      })
      if (expandedRow) await loadExpandedTasks(expandedRow)
      await refetch()
      setEditingItem(null)
    } catch (err: any) {
      setItemError(err?.message || 'Kalem güncellenemedi.')
    } finally {
      setItemSaving(false)
    }
  }
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewTask, setPreviewTask] = useState<any>(null)
  const [previewRecord, setPreviewRecord] = useState<any>(null)
  const [previewTimeline, setPreviewTimeline] = useState<any[]>([])
  const [previewTimelineLoading, setPreviewTimelineLoading] = useState(false)

  const openPreviewModal = async (task: any, parentRecord: any) => {
    setPreviewTask(task)
    setPreviewRecord(parentRecord)
    setPreviewModalOpen(true)
    setPreviewTimelineLoading(true)
    setPreviewTimeline([])
    try {
      const recordId = parentRecord.id || parentRecord.Id
      const tl = await apiJson<any[]>(`/api/servicerecords/${recordId}/timeline`)
      setPreviewTimeline(Array.isArray(tl) ? tl : [])
    } catch {
      setPreviewTimeline([])
    } finally {
      setPreviewTimelineLoading(false)
    }
  }

  /**
   * Kalemleri çeker — görevleri DEĞİL.
   *
   * Eskiden `/api/installations/tasks` çağrılıyordu; o uç 1 adetlik iş satırları döndüğü için
   * tabloda ürün, müşteri ve not boş görünüyordu. "Kalem" = faturada o ürüne girilen montaj.
   */
  const fetchInstallationItems = async (serviceId: string) => {
    const data = await apiJson<any>(`/api/installations/items?serviceId=${serviceId}`)
    return Array.isArray(data?.items) ? data.items : []
  }

  const loadExpandedTasks = async (id: string) => {
    setExpandedLoading(true)
    try {
      setExpandedTasks(await fetchInstallationItems(id))
    } catch {
      setExpandedTasks([])
    } finally {
      setExpandedLoading(false)
    }
  }

  const toggleExpand = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setSubFilterTech('')
    setSubFilterStatus('')
    setSubFilterQty('')
    setSubFilterPlannedDate('')
    setSubFilterCustomer('')
    setSubFilterAddress('')
    setSubFilterNotes('')
    setSubFilterProduct('')
    if (expandedRow === id) {
      setExpandedRow(null)
      return
    }
    setExpandedRow(id)
    await loadExpandedTasks(id)
  }

  const [createOpen, setCreateOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  const [newRecord, setNewRecord] = useState({
    plannedDate: new Date().toLocaleDateString('sv-SE'),
    isUnderWarranty: 'Evet',
    productName: '',
    warrantyStartDate: '',
    invoiceNumber: '',
    serialNumber: '',
    problemDescription: '',
    quantity: '1',
    customerType: 'Bayi',
    dealerName: '',
    dealerPhone: '',
    dealerAddress: '',
    dealerInvoiceType: '',
    customerName: '',
    customerPhone: '',
    regionId: '',
    customerAddress: '',
    priority: 'Normal',
  })
  // Montaj kalemleri: kayıt artık tek ürün + "Miktar: N" metni değil, ürün satırlarından oluşuyor.
  const [newItems, setNewItems] = useState<MontajItemRow[]>([createEmptyItemRow()])
  const [lastFilledItemDetails, setLastFilledItemDetails] = useState({
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    notes: '',
    regionId: '',
    customerType: 'Bayi',
    dealerName: '',
    dealerPhone: '',
    dealerAddress: '',
    dealerInvoiceType: '',
    selectedDealer: null as ErpDealerDto | null
  })
  const [activeItemIndexForModal, setActiveItemIndexForModal] = useState<number | null>(null)

  const itemsTotalQuantity = useMemo(
    () => newItems.reduce((sum, i) => sum + Math.max(1, Number(i.quantity) || 1), 0),
    [newItems]
  )

  const addItemRow = () => setNewItems((rows) => [...rows, createEmptyItemRow()])

  const removeItemRow = (index: number) =>
    setNewItems((rows) => (rows.length === 1 ? rows : rows.filter((_, i) => i !== index)))

  const updateItemRow = (index: number, patch: Partial<MontajItemRow>) =>
    setNewItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const [editItems, setEditItems] = useState<MontajItemRow[]>([createEmptyItemRow()])

  const [quickAddCustomerOpen, setQuickAddCustomerOpen] = useState(false)

  const handleQuickCustomerSuccess = (customer: { customerCode: string; name: string; phone: string; address: string }) => {
    const newDealer: ErpDealerDto = {
      customerCode: customer.customerCode,
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      invoiceType: 'FATURA'
    }
    setSelectedDealer(newDealer)
    if (activeItemIndexForModal !== null) {
      updateItemRow(activeItemIndexForModal, {
        customerType: 'Müşteri',
        selectedDealer: newDealer,
        dealerName: formatCariLabel(newDealer),
        dealerPhone: customer.phone ? sanitizePhone(customer.phone) : '',
        dealerAddress: customer.address || '',
        dealerInvoiceType: 'FATURA',
        customerName: customer.name,
        customerPhone: customer.phone ? sanitizePhone(customer.phone) : '',
        customerAddress: customer.address || ''
      })
    }
    setNewRecord(p => ({
      ...p,
      customerType: 'Müşteri',
      dealerName: formatCariLabel(newDealer),
      dealerPhone: customer.phone,
      dealerAddress: customer.address,
      dealerInvoiceType: newDealer.invoiceType ?? '',
      customerName: customer.name,
      customerPhone: customer.phone,
      customerAddress: customer.address
    }))
  }
  const [isEditing, setIsEditing] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    customerType: 'Bayi',
    dealerName: '',
    dealerPhone: '',
    dealerAddress: '',
    dealerInvoiceType: '',
    productName: '',
    serialNumber: '',
    problemDescription: '',
    quantity: '1',
    priority: 'Normal',
    regionId: '',
    plannedDate: '',
    serviceDescription: '',
    additionalNotes: '',
    invoiceNumber: '',
    warrantyStartDate: '',
    receivingNote: '',
    isUnderWarranty: 'Hayır',
  })

  const parseMontajCombinedDescription = (desc: string) => {
    let mainDesc = desc || ''
    let quantity = '1'
    let customerType = 'Bayi'
    let invoiceType = ''

    const qtyMatch = mainDesc.match(/Miktar:\s*(\d+)/)
    if (qtyMatch) {
      quantity = qtyMatch[1].trim()
      mainDesc = mainDesc.replace(/Miktar:\s*(\d+)/, '')
    }

    const typeMatch = mainDesc.match(/Müşteri Tipi:\s*([^\n]+)/)
    if (typeMatch) {
      customerType = typeMatch[1].trim()
      mainDesc = mainDesc.replace(/Müşteri Tipi:\s*([^\n]+)/, '')
    }

    const invoiceTypeMatch = mainDesc.match(/Fatura Tipi:\s*([^\n]+)/)
    if (invoiceTypeMatch) {
      invoiceType = invoiceTypeMatch[1].trim()
      mainDesc = mainDesc.replace(/Fatura Tipi:\s*([^\n]+)/, '')
    }

    const descMatch = mainDesc.match(/Bayi Açıklama:\s*([\s\S]*)/)
    if (descMatch) {
      mainDesc = descMatch[1].trim()
    }

    return {
      mainDesc: mainDesc.trim(),
      quantity,
      customerType,
      invoiceType
    }
  }

  const { technicians } = useTechnicians()

  // Filter states
  const [draftStatus, setDraftStatus] = useState('')
  const [draftQ, setDraftQ] = useState('')
  const [draftServiceNo, setDraftServiceNo] = useState('')
  const [draftWarranty, setDraftWarranty] = useState<'' | 'true' | 'false'>('')
  const [draftTechnicianId, setDraftTechnicianId] = useState('')
  const [draftDateType, setDraftDateType] = useState('') // '', 'equals', 'after', 'before', 'range'
  const [draftDateFrom, setDraftDateFrom] = useState('')
  const [draftDateTo, setDraftDateTo] = useState('')
  const [draftInstallationType, setDraftInstallationType] = useState('')

  const [appliedStatus, setAppliedStatus] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [appliedWarranty, setAppliedWarranty] = useState<'' | 'true' | 'false'>('')
  const [appliedTechnicianId, setAppliedTechnicianId] = useState('')
  const [appliedDateType, setAppliedDateType] = useState('')
  const [appliedDateFrom, setAppliedDateFrom] = useState('')
  const [appliedDateTo, setAppliedDateTo] = useState('')
  const [draftSatisfaction, setDraftSatisfaction] = useState('')
  const [appliedSatisfaction, setAppliedSatisfaction] = useState('')
  const [appliedInstallationType, setAppliedInstallationType] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 200

  const [selectedIds, setSelectedIds] = useState<string[]>([])

  // Reset selection on page or filter changes
  useEffect(() => {
    setSelectedIds([])
  }, [page, appliedStatus, appliedQ, appliedWarranty, appliedTechnicianId, appliedDateType, appliedDateFrom, appliedDateTo, appliedSatisfaction, appliedInstallationType])

  const [erpProducts, setErpProducts] = useState<ErpProductDto[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  // Cari seçimi artık listeyi topluca çekmiyor; arama sunucuda, seçilen kaydın kendisi burada durur.
  const [selectedDealer, setSelectedDealer] = useState<ErpDealerDto | null>(null)
  const [editSelectedDealer, setEditSelectedDealer] = useState<ErpDealerDto | null>(null)

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
      // Montaj kaleminde yalnızca beyaz eşya ve yatak/baza grubu seçilebilir; genel ürün
      // grubu (DEMO) montaj kaydına girmez. Bkz. isMontajProduct.
      .then(res => { if (active) setErpProducts(res.filter(isMontajProduct)) })
      .catch(err => console.error('fetchErpProducts error:', err))
      .finally(() => { if (active) setLoadingProducts(false) })
    return () => { active = false }
  }, [createOpen, isEditing])

  // Bayi hesabıyla giren kullanıcı için cari alanı kilitli gelir: kendi carisi çekilip doldurulur.
  useEffect(() => {
    // Otomatik doldurma YALNIZCA tek cariye bagli kullanicida. '*' (tum cariler) ya da
    // birden fazla cari atanmis kullanicida secim kullanicinindir; burada zorlamak, kullaniciyi
    // listedeki ilk/kendi carisine kilitlerdi.
    const userDealerCode = getSingleDealerCode()
    if (!userDealerCode || !createOpen) return

    const ac = new AbortController()
    void (async () => {
      try {
        // Kullanıcının carisi alt hesaplı olabilir (`120-01-000626-1`); cari listesinde yalnız
        // ana kart var. Eşleşmezse bayi adı boş kalıp kayda KOD yazılıyordu (2026-09-27).
        const anaKod = anaCariKodu(userDealerCode)
        const list = await fetchErpDealers(ac.signal, anaKod, 'all')
        const matched = list.find(d => d.customerCode === userDealerCode)
          ?? list.find(d => d.customerCode === anaKod)
        if (!matched || ac.signal.aborted) return
        setSelectedDealer(matched)
        // MÜŞTERİ ALANLARI BAYİDEN DOLDURULMAZ (kullanıcı kararı, 2026-08-21).
        //
        // Burada `customerName/Phone/Address` de bayinin bilgileriyle yazılıyordu ve bu değerler
        // hem `lastFilledItemDetails`e hem ilk kaleme geçtiği için "Kalem Montaj & Adres
        // Bilgileri" modali İsim Soyisim alanında BAYİ ÜNVANIYLA açılıyordu. Montajın gideceği
        // kişi bayi değil; alan boş açılıp elle girilir.
        const matchedDetails = {
          customerType: 'Bayi',
          dealerName: formatCariLabel(matched),
          dealerPhone: matched.phone ? sanitizePhone(matched.phone) : '',
          dealerAddress: matched.address || '',
          dealerInvoiceType: matched.invoiceType || '',
          selectedDealer: matched
        }
        setLastFilledItemDetails(p => ({
          ...p,
          ...matchedDetails
        }))
        setNewItems(rows => rows.map((row, i) => i === 0 ? { ...row, ...matchedDetails } : row))
        setNewRecord(p => ({
          ...p,
          customerType: 'Bayi',
          dealerName: formatCariLabel(matched),
          dealerPhone: matched.phone ? sanitizePhone(matched.phone) : '',
          dealerAddress: matched.address || '',
          dealerInvoiceType: matched.invoiceType || ''
        }))
      } catch {
        /* cari çekilemezse alan elle doldurulabilir kalır */
      }
    })()
    return () => ac.abort()
  }, [createOpen])

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

  const { result, isLoading, refetch, updateSatisfaction } = useServiceRecordsPaged({
    q: appliedQ.trim() || undefined,
    status: appliedStatus || undefined,
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    technicianId: appliedTechnicianId || undefined,
    type: 'Installation', // Filter specifically for installations
    // Kabul ekranı kendi sayfa anahtarını bildirir; kapsam 'montajKabul' yetkisinden okunur.
    scopeKey: 'montajKabul',
    page,
    pageSize,
    installationType: appliedInstallationType || undefined,
  })

  const [draftShowCompleted, setDraftShowCompleted] = useState(() => {
    return (window as any).__showDelivered !== undefined ? !!(window as any).__showDelivered : false
  })
  const [appliedShowCompleted, setAppliedShowCompleted] = useState(() => {
    return (window as any).__showDelivered !== undefined ? !!(window as any).__showDelivered : false
  })
  const [draftShowCancelled, setDraftShowCancelled] = useState(() => {
    return (window as any).__showCancelled !== undefined ? !!(window as any).__showCancelled : false
  })
  const [appliedShowCancelled, setAppliedShowCancelled] = useState(() => {
    return (window as any).__showCancelled !== undefined ? !!(window as any).__showCancelled : false
  })
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'status' | 'technician'>('date-desc')

  useEffect(() => {
    const handleShowDelivered = (e: any) => {
      setDraftShowCompleted(e.detail)
      setAppliedShowCompleted(e.detail)
    }
    const handleShowCancelled = (e: any) => {
      setDraftShowCancelled(e.detail)
      setAppliedShowCancelled(e.detail)
    }
    window.addEventListener('shell:show-delivered-changed', handleShowDelivered)
    window.addEventListener('shell:show-cancelled-changed', handleShowCancelled)
    return () => {
      window.removeEventListener('shell:show-delivered-changed', handleShowDelivered)
      window.removeEventListener('shell:show-cancelled-changed', handleShowCancelled)
    }
  }, [])

  useEffect(() => {
    (window as any).__selectedIdsLength = selectedIds.length
    window.dispatchEvent(new CustomEvent('shell:selection-changed'))
  }, [selectedIds])

  // Garanti filtresi
  const records = useMemo(() => {
    let items = result.items.map(item => {
      const startStr = item.createdAt
      if (!startStr) return { ...item, elapsedDays: 0 }
      const anyItem = item as any
      const isCompleted = 
        item.status === 'Completed' || 
        item.status === 'Delivered' || 
        item.status === 'Cancelled' || 
        anyItem.derivedState === 'Completed' || 
        anyItem.derivedState === 'CompletedWithCancellations' || 
        anyItem.derivedState === 'Cancelled'
      const endStr = isCompleted 
        ? (anyItem.completedAt || anyItem.CompletedAt || anyItem.updatedAt || anyItem.UpdatedAt) 
        : null
      const startDate = new Date(startStr)
      const endDate = endStr ? new Date(endStr) : new Date()
      const diffTime = endDate.getTime() - startDate.getTime()
      const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)))
      return { ...item, elapsedDays: diffDays }
    })
    if (appliedWarranty === 'true') items = items.filter((r) => r.isUnderWarranty)
    else if (appliedWarranty === 'false') items = items.filter((r) => !r.isUnderWarranty)

    // Satisfaction filter
    if (appliedSatisfaction === 'none') {
      items = items.filter(r => !r.satisfactionScore)
    } else if (appliedSatisfaction) {
      const score = Number(appliedSatisfaction)
      items = items.filter(r => r.satisfactionScore === score)
    }
    
    // Status completed filtering — kapalıyken (varsayılan) tamamlananlar GİZLİ kalır, kutu
    // işaretlenince listeye geri döner. Eskiden tersiydi: kutu yalnızca işaretliyken filtre
    // uyguluyordu, kapalıyken tamamlananlar da diğerleriyle karışık görünüyordu.
    if (!appliedShowCompleted) {
      items = items.filter((r) => {
        const s = (r.status || '').toLowerCase()
        return s !== 'delivered' && s !== 'ready'
      })
    }
    if (!appliedShowCancelled) {
      items = items.filter((r) => {
        const s = (r.status || '').toLowerCase()
        return s !== 'cancelled'
      })
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
  }, [result.items, appliedWarranty, appliedShowCompleted, appliedShowCancelled, sortBy, appliedSatisfaction])

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

  const handleDeleteRecord = async (id: string) => {
    if (!window.confirm('Bu montaj kaydını silmek istediğinize emin misiniz?')) return
    try {
      setActionLoading(true)
      await apiJson(`/api/servicerecords/${id}`, {
        method: 'DELETE'
      })
      await refetch()
    } catch (err: any) {
      toast.error(err?.message || 'Kayıt silinirken hata oluştu.')
    } finally {
      setActionLoading(false)
    }
  }

  const columns: TableColumn<ServiceRecord>[] = useMemo(() => [
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
      key: 'serviceNumber' as any,
      label: 'Fiş No',
      searchable: true,
      filter: { type: 'text' },
      render: (_v, row) => (
        <span className="font-mono text-xs font-semibold text-gray-900">{row.serviceNumber}</span>
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
      key: 'installationType' as any,
      label: 'Montaj Türü',
      searchable: true,
      filter: {
        type: 'select',
        options: [
          { label: 'Fatura', value: 'Fatura' },
          { label: 'Bayi', value: 'Bayi' },
          { label: 'Mağaza', value: 'Mağaza' }
        ]
      },
      render: (_v, row) => {
        const type = row.installationType || 'Bayi'
        let colorClass = 'bg-blue-100 text-blue-700 border-blue-200'
        if (type === 'Fatura') {
          colorClass = 'bg-purple-100 text-purple-700 border-purple-200'
        } else if (type === 'Mağaza') {
          colorClass = 'bg-teal-100 text-teal-700 border-teal-200'
        }
        return (
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${colorClass}`}>
            {type}
          </span>
        )
      }
    },
    {
      // Müşteri ve ürün KALEM seviyesine taşındı: bir faturada farklı müşterilere ve farklı
      // ürünlere montaj olabiliyor, üst satırda tek değer göstermek yanıltıcıydı.
      // Burada faturanın kendi bilgisi duruyor.
      key: 'invoiceInfo' as any,
      label: 'Fatura / Kalem',
      searchable: true,
      filter: { type: 'text' },
      render: (_v, row) => {
        const invoiceNo = extractInvoiceNo((row as any).problemDescription)
        /*
          "N kalem" SAYACI İPTALLERİ SAYMIYOR (2026-09-08).

          Üstteki "İptalleri Göster" anahtarı kapalıyken bile sayaç iptal edilmiş kalemleri
          sayıyordu: fişte 2 aktif kalem varken "3 kalem" yazıyor, kullanıcı açınca üçüncüyü
          arıyordu. Anahtar açıkken sayı yine hepsini gösterir — o zaman zaten iptalleri
          görmek isteniyor demektir.
        */
        const allItems = Array.isArray((row as any).items) ? (row as any).items : []
        const itemCount = appliedShowCancelled
          ? allItems.length
          : allItems.filter((it: any) => !it?.cancelledAt).length
        return (
          <div>
            {invoiceNo ? (
              <div className="font-semibold text-gray-800 flex items-center gap-1">
                <span className="text-[11px]">Fatura: {invoiceNo}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    navigator.clipboard.writeText(invoiceNo)
                  }}
                  className="p-0.5 text-gray-400 hover:text-gray-650"
                  title="Fatura No Kopyala"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            ) : (
              // Fatura yoksa ürün henüz kesilmemiş demek değil: bu kayıtlarda ürün BAYİDEN
              // ALINACAK. "Faturasız kayıt" yazısı eksik/hatalı bir kayıt izlenimi veriyordu.
              <div className="text-amber-700 text-[11px] font-semibold">Bayiden alınacak</div>
            )}
            <div className="text-gray-500 text-[11px] mt-0.5">
              {itemCount > 0 ? `${itemCount} kalem` : 'Kalem yok'}
            </div>
          </div>
        )
      }
    },
    {
      key: 'derivedState' as any,
      label: 'Durum',
      searchable: true,
      filter: {
        type: 'select',
        options: [
          { label: 'Yeni Kayıt', value: 'Deferred' },
          { label: 'Planlandı', value: 'Planned' },
          { label: 'İşlemde', value: 'Mixed' },
          { label: 'Gerçekleşti', value: 'Completed' },
          // İşi biten ama içinde iptal edilmiş kalem olan kayıt; düz "Gerçekleşti"den ayrılır.
          { label: 'Gerçekleşti !', value: 'CompletedWithCancellations' },
          { label: 'İptal', value: 'Cancelled' }
        ]
      },
      render: (_v, row) => {
        // Kalemlerin hepsi aynı durumdaysa o durum, karışıksa "İşlemde".
        const st = (row as any).derivedState as string | undefined
        if (!st) return <span className="text-gray-300 text-[11px] italic">-</span>
        const sc = itemStateConfig[st] ?? { label: (row as any).derivedStateLabel || st, color: 'bg-gray-100 text-gray-700' }
        return (
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${sc.color}`}>
            {(row as any).derivedStateLabel || sc.label}
          </span>
        )
      }
    },
    {
      key: 'dealerName' as any,
      label: 'Bayi',
      searchable: true,
      filter: { type: 'text' },
      // Tek biçim + adı olmayan kaydı işaretleme: bkz. `utils/bayiEtiketi.ts`.
      render: (_v, row) => <BayiHucresi dealerName={row.dealerName} dealerCode={(row as any).dealerCode} />
    },
    ...(canSeeSatisfaction ? [{
      key: 'satisfactionScore' as any,
      label: 'Memnuniyet',
      searchable: true,
      filter: {
        type: 'select',
        options: [
          { label: 'Değerlendirilmemiş', value: 'none' },
          { label: 'Ulaşılamadı', value: '-1' },
          { label: '1 Yıldız', value: '1' },
          { label: '2 Yıldız', value: '2' },
          { label: '3 Yıldız', value: '3' },
          { label: '4 Yıldız', value: '4' },
          { label: '5 Yıldız', value: '5' }
        ]
      },
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
      render: (_v, row) => {
        const s = (row.status || '').toLowerCase()
        const isCompleted = s === 'ready' || s === 'delivered'
        return (
          <div className="flex items-center gap-1.5 justify-center" onClick={(e) => e.stopPropagation()}>
            {isCompleted && (
              <button
                onClick={() => { setGeriAlError(null); setGeriAlTarget(row) }}
                className="p-1.5 text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors"
                title="Tamamlanmayı geri al, teslimattakilere gönder"
              >
                <RotateCcw className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => openDetail(row)}
              className="p-1.5 text-gray-400 hover:text-[#B91C1C] hover:bg-red-50 rounded-lg transition-colors"
              title="Detay ve Geçmiş"
            >
              <Info className="w-5 h-5" />
            </button>
            <button
              onClick={() => handleDeleteRecord(row.id)}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Montaj Sil"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        )
      }
    } as TableColumn<ServiceRecord>] : [])
  ], [isAllSelected, selectedIds, toggleSelectAll, toggleSelect, technicians, refetch, handleDeleteRecord, canSeeSatisfaction, canSeeActions, appliedShowCancelled])

  const totalPages = result.totalPages || 1
  const totalCount = result.totalCount || 0
  const rangeStart = totalCount === 0 ? 0 : (result.page - 1) * result.pageSize + 1
  const rangeEnd = Math.min(result.page * result.pageSize, totalCount)

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
    setAppliedInstallationType(draftInstallationType)
    setAppliedShowCompleted(draftShowCompleted)
    setAppliedShowCancelled(draftShowCancelled)
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
        type: 'Installation',
      })
      let filtered = appliedWarranty === ''
        ? rows
        : rows.filter((r) => (appliedWarranty === 'true' ? r.isUnderWarranty : !r.isUnderWarranty))
      
      if (selectedIds.length > 0) {
        filtered = filtered.filter((r) => selectedIds.includes(r.id))
      }
      
      downloadCsv(`montaj-kabul-${new Date().toISOString().slice(0, 10)}.csv`, filtered as unknown as Record<string, unknown>[])
    } catch (e: any) {
      setActionError(String(e?.message ?? 'Dışa aktarma başarısız'))
    }
  }


  useEffect(() => {
    const handleExport = () => handleExportCsv()
    const handleCal = () => setCalendarModalOpen(true)
    const handlePrn = () => window.print()
    const handleNew = () => {
      if (!canCreate) return
      setActionError(null)
      setActionSuccess(null)
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
  }, [handleExportCsv, canCreate])

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
    setInfoTimeline([])
    setInfoTimelineDurum('bekliyor')
  }

  const loadInfoTimeline = async (record: ServiceRecord) => {
    setInfoTimelineDurum('yukleniyor')
    try {
      const rawId = record.id.split('_')[0]
      const tl = await apiJson<any[]>(`/api/servicerecords/${rawId}/timeline`)
      // Uç `createdAt` döner ama TimelineEvent/groupTimelineEvents `timestamp` okur —
      // eşlenmediği için tarih "Invalid Date" görünüyordu.
      setInfoTimeline(
        Array.isArray(tl)
          ? tl.map((ev: any) => ({ ...ev, timestamp: ev.timestamp ?? ev.createdAt }))
          : []
      )
    } catch {
      setInfoTimeline([])
    } finally {
      setInfoTimelineDurum('hazir')
    }
  }

  const handleSaveEdits = async () => {
    if (!selectedRecord) return
    if (!editForm.customerName.trim()) { setEditError('Müşteri adı zorunludur'); return }
    if (!isValidPhone(editForm.customerPhone)) { setEditError('Geçerli bir cep telefonu giriniz'); return }
    if (!editForm.customerAddress.trim()) { setEditError('Müşteri adresi zorunludur'); return }
    const filledEditItems = editItems.filter(i => i.productName.trim())
    if (filledEditItems.length === 0) { setEditError('En az bir montaj kalemi (ürün) girilmelidir'); return }
    if (!editForm.problemDescription.trim()) { setEditError('Açıklama zorunludur'); return }
    if (!editForm.dealerName.trim()) {
      setEditError(editForm.customerType === 'Bayi' ? 'Bayi seçimi zorunludur' : 'Mağaza adı zorunludur')
      return
    }
    if (!editForm.regionId) { setEditError('Bölge seçimi zorunludur'); return }

    setEditSaving(true)
    setEditError(null)

    try {
      // Miktar artık kalemlerde durduğu için açıklamaya yazılmıyor.
      // "Bayi Açıklama" en sonda kalmalı: okurken satır sonuna kadar olan her şeyi o alıyor.
      let combinedDescription = '';
      if (editForm.serviceDescription) combinedDescription += `\nServis Açıklaması: ${editForm.serviceDescription}`;
      if (editForm.additionalNotes) combinedDescription += `\nEk Açıklama: ${editForm.additionalNotes}`;
      if (editForm.invoiceNumber) combinedDescription += `\nFatura Numarası: ${editForm.invoiceNumber}`;
      if (editForm.warrantyStartDate) combinedDescription += `\nGaranti Başlangıcı: ${editForm.warrantyStartDate}`;
      if (editForm.customerType) combinedDescription += `\nMüşteri Tipi: ${editForm.customerType}`;
      combinedDescription = combinedDescription.replace(/^\n/, '');
      combinedDescription += `${combinedDescription ? '\n' : ''}Bayi Açıklama: ${editForm.problemDescription}`;

      const res = await apiJson<any>(`/api/servicerecords/${selectedRecord.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          type: selectedRecord.type || 'Installation',
          customerName: editForm.customerName,
          customerPhone: editForm.customerPhone,
          customerAddress: editForm.customerAddress,
          productName: filledEditItems.length > 1
            ? `${filledEditItems[0].productName} (+${filledEditItems.length - 1} kalem)`
            : filledEditItems[0].productName,
          serialNumber: filledEditItems[0].serialNumber || undefined,
          items: filledEditItems.map((i) => ({
            id: i.id,
            productName: i.productName,
            serialNumber: i.serialNumber || undefined,
            quantity: Math.max(1, Number(i.quantity) || 1),
          })),
          receivingNote: editForm.receivingNote || undefined,
          isUnderWarranty: editForm.isUnderWarranty === 'Evet',
          dealerName: editForm.dealerName,
          dealerPhone: editForm.dealerPhone || undefined,
          dealerAddress: editForm.dealerAddress || undefined,
          problemDescription: combinedDescription,
          priority: editForm.priority,
          regionId: editForm.regionId,
          plannedDate: selectedRecord.plannedAt || undefined,
          installationType: editForm.customerType === 'Bayi' ? 'Bayi' : 'Mağaza',
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

  return (
    <>
      <div className="p-4 lg:p-6 flex flex-col gap-4">
        {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-visible relative [--table-sticky-top:64px] lg:[--table-sticky-top:54px]">
        {isLoading && records.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">Yükleniyor...</div>
        ) : records.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">Kayıt bulunamadı.</div>
        ) : (
          <Table
            columns={columns}
            data={records}
            showColumnFilters
            serverSide={false}
            onFilteredDataChange={setFilteredRows}
            rowKey={(r) => r.id}
            rowClassName={(row) => selectedIds.includes(row.id) ? 'bg-[#B91C1C]/5' : ''}
            isRowExpanded={(r) => expandedRow === r.id}
            onToggleRowExpanded={(r) => toggleExpand(r.id)}
            renderExpandedRow={(record) => (
              <div className="bg-gray-50/70 p-4 border-t border-b border-gray-150 shadow-inner">
                {expandedLoading ? (
                  <div className="text-sm text-gray-500 py-3 flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-t-transparent border-[#B91C1C] rounded-full animate-spin"></span>
                    Yükleniyor...
                  </div>
                ) : (
                  (() => {
                    // Artık görev değil KALEM listeleniyor: her satır faturada o ürüne girilen
                    // bir montaj. Ürün / müşteri / not kalemin kendi alanları.
                    const rawItems = expandedTasks
                    if (rawItems.length === 0) {
                      return <div className="text-sm text-gray-500 py-2 italic text-center">Bu montaj kaydında kalem yok.</div>
                    }

                    const groupedTasks = rawItems.filter((t: any) => {
                      /*
                        İPTAL KALEMLER ÜST ANAHTARA UYUYOR (2026-09-08).

                        "İptalleri Göster" fiş LİSTESİNİ süzüyordu ama açılan fişin kalem
                        satırlarını süzmüyordu: anahtar kapalıyken bile iptal edilmiş kalem
                        satır olarak görünüyordu. B2B'den montajı kaldırılan kalem serviste
                        SİLİNMİYOR, iptal damgası alıyor (damga olmadan planlama onu eksik
                        adet sanıp diriltiyor) — yani bu satırlar kalıcı; görünürlüğü anahtar
                        belirlemeli.
                      */
                      const iptalKalem = Boolean(t?.cancelledAt) || t?.state === 'Cancelled'
                      if (iptalKalem && !appliedShowCancelled) return false

                      if (subFilterTech) {
                        const names = (t.technicianNames ?? []).join(' ').toLowerCase()
                        if (!names.includes(subFilterTech.toLowerCase())) return false
                      }
                      if (subFilterStatus) {
                        if (String(t.state ?? '').toLowerCase() !== subFilterStatus.toLowerCase()) return false
                      }
                      if (subFilterQty) {
                        if (!String(t.quantity ?? '').includes(subFilterQty)) return false
                      }
                      if (subFilterPlannedDate) {
                        const pdate = (t.plannedAt || '').split('T')[0]
                        const dateFormatted = pdate.split('-').reverse().join('.')
                        if (!pdate.includes(subFilterPlannedDate) && !dateFormatted.includes(subFilterPlannedDate)) return false
                      }
                      if (subFilterCustomer) {
                        const cust = (t.customerName ?? '').toLowerCase()
                        if (!cust.includes(subFilterCustomer.toLowerCase())) return false
                      }
                      if (subFilterAddress) {
                        const addr = (t.customerAddress ?? '').toLowerCase()
                        if (!addr.includes(subFilterAddress.toLowerCase())) return false
                      }
                      if (subFilterNotes) {
                        const notes = (t.notes ?? '').toLowerCase()
                        if (!notes.includes(subFilterNotes.toLowerCase())) return false
                      }
                      if (subFilterProduct) {
                        const hay = `${t.productName ?? ''} ${t.productStockCode ?? ''} ${t.serialNumber ?? ''}`.toLowerCase()
                        if (!hay.includes(subFilterProduct.toLowerCase())) return false
                      }
                      return true
                    })

                    return (
                      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wider text-gray-500 font-bold border-b border-gray-200">
                            <tr>
                              <th className="px-3 py-2.5">Sıra</th>
                              <th className="px-3 py-2.5">Ürün</th>
                              <th className="px-3 py-2.5">Müşteri</th>
                              <th className="px-3 py-2.5">Durum</th>
                              <th className="px-3 py-2.5">Miktar</th>
                              <th className="px-3 py-2.5">Teknisyen</th>
                              <th className="px-3 py-2.5">Planlanan Tarih</th>
                              <th className="px-3 py-2.5">Adres</th>
                              <th className="px-3 py-2.5">Not / Açıklama</th>
                              {canSeeItemActions && <th className="px-3 py-2.5 text-center">İşlemler</th>}
                            </tr>
                            <tr className="bg-gray-50/50 border-b border-gray-150">
                              {/* Sıra */}
                              <th className="px-2 py-1"></th>
                              <th className="px-2 py-1">
                                <input
                                  type="text"
                                  placeholder="Ürün / stok..."
                                  value={subFilterProduct}
                                  onChange={(e) => setSubFilterProduct(e.target.value)}
                                  className="px-2 py-1 w-full bg-white border border-gray-200 rounded text-[11px] font-normal focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                                />
                              </th>
                              <th className="px-2 py-1">
                                <input
                                  type="text"
                                  placeholder="Müşteri..."
                                  value={subFilterCustomer}
                                  onChange={(e) => setSubFilterCustomer(e.target.value)}
                                  className="px-2 py-1 w-full bg-white border border-gray-200 rounded text-[11px] font-normal focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                                />
                              </th>
                              <th className="px-2 py-1">
                                <select
                                  value={subFilterStatus}
                                  onChange={(e) => setSubFilterStatus(e.target.value)}
                                  className="px-2 py-1 w-full bg-white border border-gray-200 rounded text-[11px] font-normal focus:outline-none"
                                >
                                  <option value="">Tümü</option>
                                  <option value="Deferred">Yeni Kayıt</option>
                                  <option value="Planned">Planlandı</option>
                                  <option value="Mixed">İşlemde</option>
                                  <option value="Completed">Gerçekleşti</option>
                                  <option value="Cancelled">İptal</option>
                                </select>
                              </th>
                              <th className="px-2 py-1">
                                <input
                                  type="text"
                                  placeholder="Ara..."
                                  value={subFilterQty}
                                  onChange={(e) => setSubFilterQty(e.target.value)}
                                  className="px-2 py-1 w-full bg-white border border-gray-200 rounded text-[11px] font-normal focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                                />
                              </th>
                              <th className="px-2 py-1">
                                <input
                                  type="text"
                                  placeholder="Teknisyen..."
                                  value={subFilterTech}
                                  onChange={(e) => setSubFilterTech(e.target.value)}
                                  className="px-2 py-1 w-full bg-white border border-gray-200 rounded text-[11px] font-normal focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                                />
                              </th>
                              <th className="px-2 py-1">
                                <input
                                  type="text"
                                  placeholder="Ara..."
                                  value={subFilterPlannedDate}
                                  onChange={(e) => setSubFilterPlannedDate(e.target.value)}
                                  className="px-2 py-1 w-full bg-white border border-gray-200 rounded text-[11px] font-normal focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                                />
                              </th>
                              <th className="px-2 py-1">
                                <input
                                  type="text"
                                  placeholder="Adres..."
                                  value={subFilterAddress}
                                  onChange={(e) => setSubFilterAddress(e.target.value)}
                                  className="px-2 py-1 w-full bg-white border border-gray-200 rounded text-[11px] font-normal focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                                />
                              </th>
                              <th className="px-2 py-1">
                                <input
                                  type="text"
                                  placeholder="Not..."
                                  value={subFilterNotes}
                                  onChange={(e) => setSubFilterNotes(e.target.value)}
                                  className="px-2 py-1 w-full bg-white border border-gray-200 rounded text-[11px] font-normal focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                                />
                              </th>
                              {/* İşlemler */}
                              {canSeeItemActions && <th className="px-2 py-1"></th>}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {groupedTasks.length === 0 ? (
                              <tr>
                                <td colSpan={canSeeItemActions ? 10 : 9} className="px-3 py-6 text-sm text-gray-500 italic text-center bg-white font-sans">
                                  Eşleşen kalem bulunamadı.
                                </td>
                              </tr>
                            ) : (
                              groupedTasks.map((t: any, idx: number) => {
                              // Kalem durumu üç değere indirgenmiş halde sunucudan geliyor.
                              const sc = itemStateConfig[t.state as string] ?? itemStateConfig.Deferred
                              const techNames: string[] = Array.isArray(t.technicianNames) ? t.technicianNames : []
                              const tname = techNames.join(', ')
                              const tqty = t.quantity ?? 1
                              const taddr = t.customerAddress ?? ''
                              const hasAddress = !!taddr
                              const hasTech = techNames.length > 0
                              // Gerçekleşen (kurulumu tamamlanan) kaleme asla müdahale edilmez —
                              // artık geçmiş bir gerçek. Hatalı işaretlendiyse düzeltme yolu kayıt
                              // düzeyinde "Geri Al" (Aksiyon sütunu): kayıt Teslimattakiler'e
                              // döner, kalem orada normal yoldan düzeltilir.
                              const isItemCompleted = t.state === 'Completed' || t.state === 2

                              return (
                                <tr key={t.id || idx} className={`hover:bg-gray-50/60 transition-colors ${!hasTech ? 'bg-amber-50/20' : ''}`}>
                                  <td className="px-3 py-2 text-gray-500 font-mono font-bold">#{idx + 1}</td>
                                  <td className="px-3 py-2 max-w-[260px]">
                                    <div className="font-semibold text-gray-900 text-xs leading-tight truncate" title={t.productName || ''}>
                                      {t.productName || '-'}
                                    </div>
                                    {(t.productStockCode || t.serialNumber) && (
                                      <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                                        {t.productStockCode || ''}{t.serialNumber ? ` • SN: ${t.serialNumber}` : ''}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 max-w-[180px]">
                                    <div className="font-semibold text-gray-800 text-xs truncate" title={t.customerName || ''}>
                                      {t.customerName || '-'}
                                    </div>
                                    {t.customerPhone && (
                                      <div className="text-[10px] text-gray-500 mt-0.5"><PhoneLinks phone={t.customerPhone} compact /></div>
                                    )}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${sc.color}`}>
                                      {t.stateLabel || sc.label}
                                    </span>
                                    {t.taskCount > 0 && (
                                      <div className="text-[10px] text-gray-400 mt-0.5">{t.completedCount}/{t.taskCount} tamam</div>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 font-semibold text-gray-700">{tqty}</td>
                                  <td className="px-3 py-2">
                                    {hasTech ? (
                                      <span className="font-medium text-gray-900 text-[11px]">{tname}</span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100/80 text-amber-800 text-[10px] font-bold">
                                        Atanmadı
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-gray-600">{t.plannedAt ? new Date(t.plannedAt).toLocaleDateString('tr-TR') : '-'}</td>
                                  <td className="px-3 py-2 max-w-[220px]">
                                    {hasAddress ? (
                                      <span className="text-orange-700 font-medium text-[11px] leading-tight block truncate" title={taddr}>{taddr}</span>
                                    ) : (
                                      <span className="text-gray-300 text-[10px] italic">Belirtilmedi</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-gray-650 font-medium max-w-[200px] truncate" title={t.notes || ''}>{t.notes || '-'}</td>
                                  {canSeeItemActions && (
                                  <td className="px-3 py-2">
                                    <div className="flex items-center justify-center gap-1.5">
                                      {isItemCompleted ? (
                                        <span
                                          title="Gerçekleşen kalem düzenlenemez. Hatalıysa kayıt satırındaki 'Geri Al' ile Teslimattakiler'e geri alın."
                                          className="inline-flex items-center justify-center w-7 h-7 bg-gray-100 text-gray-300 rounded-lg cursor-not-allowed"
                                        >
                                          <Pencil className="w-3.5 h-3.5" />
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            // Faturadan gelen kalem: ürün/adet faturaya ait.
                                            if (isItemInvoiceBacked(t)) {
                                              setEditBlockedMsg(INVOICE_EDIT_MESSAGE)
                                              return
                                            }
                                            setEditingItem({ ...t })
                                            setItemError(null)
                                          }}
                                          title={isItemInvoiceBacked(t) ? 'Faturadan gelen kalem — faturanızdan düzenleyin' : 'Bu kalemi düzenle'}
                                          className="inline-flex items-center justify-center w-7 h-7 bg-gray-900 text-white hover:bg-gray-800 rounded-lg transition-all cursor-pointer shadow-sm"
                                        >
                                          <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                      {canViewHistory && (
                                        <button
                                          type="button"
                                          onClick={() => { setHistoryRecordId(record.id); setHistoryTaskId(t.id) }}
                                          title="Bu kalemin baştan sona geçmişi"
                                          className="inline-flex items-center justify-center w-7 h-7 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg border border-blue-200 transition-all cursor-pointer shadow-sm"
                                        >
                                          <Info className="w-4 h-4" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                  )}
                                </tr>
                              )
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    )
                  })()
                )}
              </div>
            )}
          />
        )}

      </div>

      {/* Detail Drawer */}
      {drawerOpen && selectedRecord && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDrawerOpen(false)} />
          <div className="fixed right-0 top-0 bottom-0 pt-safe pb-safe w-full max-w-lg bg-white z-50 shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300">
            <div className="p-4 sm:p-6 border-b border-gray-100 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Montaj Kabul Detayı</h2>
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-sm text-gray-500 font-mono">{selectedRecord.id}</p>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${getStatusStyle(selectedRecord.status)}`}>
                    {statusTranslations[selectedRecord.status?.toLowerCase()] || selectedRecord.status}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {!isEditing ? (
                  <button
                    onClick={() => {
                      // Faturadan gelen kayıt burada düzenlenmez: ürün/adedin kaynağı fatura.
                      if (isRecordInvoiceBacked(selectedRecord)) {
                        setEditBlockedMsg(INVOICE_EDIT_MESSAGE)
                        return
                      }
                      // İş başladıysa (planlandı/sahada/gerçekleşti) adet artık serbest değil.
                      if (!isRecordEditable(selectedRecord)) {
                        setEditBlockedMsg(
                          'Bu kayıt planlamaya girdiği için ürün ve adet düzenlenemez. Önce Montaj Planlama ekranından bu kalemin planını kaldırın.'
                        )
                        return
                      }
                      const parsed = parseMontajCombinedDescription(selectedRecord.problemDescription || '')
                      setEditSelectedDealer(null)
                      // Kalemi olmayan eski kayıtlar, kaydın kendi ürününden tek kalem olarak açılır.
                      const recordItems = selectedRecord.items ?? []
                      setEditItems(
                        recordItems.length > 0
                          ? recordItems.map((i) => ({
                              ...createEmptyItemRow(),
                              id: i.id,
                              productName: i.productName,
                              quantity: String(i.quantity ?? 1),
                              serialNumber: i.serialNumber || '',
                            }))
                          : [{
                              ...createEmptyItemRow(),
                              productName: selectedRecord.productName || '',
                              quantity: parsed.quantity || '1',
                              serialNumber: selectedRecord.serialNumber || '',
                            }]
                      )
                      setEditForm({
                        customerName: selectedRecord.customerName || '',
                        customerPhone: selectedRecord.customerPhone || '',
                        customerAddress: selectedRecord.customerAddress || '',
                        customerType: parsed.customerType || (selectedRecord.installationType === 'Mağaza' ? 'Mağaza' : 'Bayi'),
                        dealerName: selectedRecord.dealerName || '',
                        dealerPhone: selectedRecord.dealerPhone || '',
                        dealerAddress: selectedRecord.dealerAddress || '',
                        dealerInvoiceType: parsed.invoiceType || '',
                        productName: selectedRecord.productName || '',
                        serialNumber: selectedRecord.serialNumber || '',
                        problemDescription: parsed.mainDesc || '',
                        quantity: parsed.quantity || '1',
                        priority: selectedRecord.priority || 'Normal',
                        regionId: selectedRecord.regionId || '',
                        plannedDate: selectedRecord.plannedAt ? selectedRecord.plannedAt.split('T')[0] : new Date().toLocaleDateString('sv-SE'),
                        serviceDescription: '',
                        additionalNotes: '',
                        invoiceNumber: '',
                        warrantyStartDate: '',
                        receivingNote: selectedRecord.receivingNote || '',
                        isUnderWarranty: selectedRecord.isUnderWarranty ? 'Evet' : 'Hayır',
                      })
                      setIsEditing(true)
                      setEditError(null)
                    }}
                    className="px-2.5 py-1.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" />
                    Kayıt Bilgileri
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
              {/*
                SONRADAN NOT/GÖRSEL EKLEME (2026-08-24, kullanıcı isteği).
                Durum değiştirmiyor; kabul sonrası eline geçen belgeyi/bilgiyi kayda iliştirir.
              */}
              {selectedRecord?.id && (
                <DurumNotuVeGorselEkle
                  recordId={String(selectedRecord.id)}
                  onSaved={async () => { await refetch() }}
                />
              )}

              {!isEditing && (
                <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-200 text-yellow-800 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Bu ekranda durum güncellemesi yapılamaz. Durum güncellemeleri ilgili yönetim ekranından (Saha/Atölye/Montaj) yapılır.</span>
                </div>
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
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Montaj Detayları</div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="font-semibold text-gray-500">Tarih <span className="text-red-500">*</span></label>
                        <input
                          type="date"
                          disabled
                          value={editForm.plannedDate}
                          onChange={e => setEditForm(p => ({ ...p, plannedDate: e.target.value }))}
                          className="px-3 py-2 bg-gray-100 border border-gray-200 rounded-lg text-xs w-full cursor-not-allowed text-gray-500 focus:outline-none"
                        />
                      </div>
                      
                      <div className="space-y-1">
                        <label className="font-semibold text-gray-500">Öncelik Durumu <span className="text-red-500">*</span></label>
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
                    </div>
                  </div>

                  <div className="border border-gray-150 rounded-xl p-4 space-y-3 bg-gray-50/50">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Ürün ve Müşteri Bilgileri</div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2 col-span-2">
                        <div className="flex items-center justify-between">
                          <label className="font-semibold text-gray-500">
                            Montaj Kalemleri <span className="text-red-500">*</span>
                            <span className="ml-2 font-normal text-gray-400">
                              Toplam {editItems.reduce((s, i) => s + Math.max(1, Number(i.quantity) || 1), 0)} adet
                            </span>
                          </label>
                          <button
                            type="button"
                            onClick={() => setEditItems((rows) => [...rows, createEmptyItemRow()])}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            Kalem Ekle
                          </button>
                        </div>

                        {editItems.map((item, index) => (
                          <div key={item.key} className="grid grid-cols-12 gap-2 items-center bg-white border border-gray-150 rounded-lg p-2">
                            <div className="col-span-12 sm:col-span-6">
                              {/*
                                Ham <select> idi; yeni kayıt formu (aşağıda) zaten aranabilir
                                seçiciyi kullanıyordu. Listede olmayan ürün adı kaybolmaz:
                                seçici, eşleşme bulamazsa mevcut değeri olduğu gibi gösterir.
                              */}
                              <SearchableProductSelect
                                products={erpProducts}
                                value={item.productName}
                                onChange={(val) => setEditItems(rows => rows.map((r, i) => i === index ? { ...r, productName: val } : r))}
                                disabled={loadingProducts}
                                placeholder="Ürün Ara veya Seç..."
                              />
                            </div>
                            <div className="col-span-4 sm:col-span-2">
                              <input
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={e => setEditItems(rows => rows.map((r, i) => i === index ? { ...r, quantity: e.target.value } : r))}
                                className="px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none"
                              />
                            </div>
                            <div className="col-span-6 sm:col-span-3">
                              <input
                                type="text"
                                value={item.serialNumber}
                                placeholder="Seri no"
                                onChange={e => setEditItems(rows => rows.map((r, i) => i === index ? { ...r, serialNumber: sanitizeSerial(e.target.value) } : r))}
                                className="px-2 py-1.5 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none"
                              />
                            </div>
                            <div className="col-span-2 sm:col-span-1 flex justify-end">
                              <button
                                type="button"
                                onClick={() => setEditItems(rows => rows.length === 1 ? rows : rows.filter((_, i) => i !== index))}
                                disabled={editItems.length === 1}
                                className={`p-1.5 rounded-lg ${editItems.length === 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer'}`}
                                title={editItems.length === 1 ? 'En az bir kalem olmalı' : 'Kalemi sil'}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                        <div className="text-[10px] text-gray-400">
                          Planlanmış bir kalem silinemez; önce planlama satırlarını kaldırın.
                        </div>
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

                      <div className="space-y-1">
                        <label className="font-semibold text-gray-500">Müşteri Ad Soyad <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={editForm.customerName}
                          onChange={e => setEditForm(p => ({ ...p, customerName: sanitizeName(e.target.value) }))}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="font-semibold text-gray-500">Müşteri Telefon <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={editForm.customerPhone}
                          onChange={e => setEditForm(p => ({ ...p, customerPhone: sanitizePhone(e.target.value) }))}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                        />
                      </div>

                      <div className="space-y-1 col-span-2">
                        <label className="font-semibold text-gray-500">Müşteri Adresi <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={editForm.customerAddress}
                          onChange={e => setEditForm(p => ({ ...p, customerAddress: e.target.value }))}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                        />
                      </div>

                      <div className="space-y-1 col-span-2">
                        <label className="font-semibold text-gray-500">Açıklama / Bayi Notu</label>
                        <textarea
                          value={editForm.problemDescription}
                          onChange={e => setEditForm(p => ({ ...p, problemDescription: e.target.value }))}
                          placeholder="Montaj ile ilgili notlar..."
                          className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs w-full h-16 resize-none focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="border border-gray-150 rounded-xl p-4 space-y-3 bg-gray-50/50">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Bayi Bilgileri</div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="font-semibold text-gray-500">Bayi Tipi <span className="text-red-500">*</span></label>
                        <select
                          value={editForm.customerType}
                          disabled={!!getSingleDealerCode()}
                          onChange={e => {
                            const type = e.target.value
                            setEditSelectedDealer(null)
                            setEditForm(p => ({
                              ...p,
                              customerType: type,
                              dealerName: '',
                              dealerPhone: '',
                              dealerAddress: '',
                              dealerInvoiceType: ''
                            }))
                          }}
                          className={`px-3 py-2 border border-gray-200 rounded-lg text-xs w-full focus:outline-none ${getSingleDealerCode() ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : 'bg-white'}`}
                        >
                          <option value="Bayi">Bayi (120-01)</option>
                          <option value="Müşteri">Müşteri (120-03)</option>
                        </select>
                      </div>

                      <div className="space-y-2 col-span-2 bg-gray-50/50 p-3.5 rounded-xl border border-gray-100/80 animate-in fade-in duration-200">
                        <div className="text-xs font-bold text-gray-700">
                          {editForm.customerType === 'Bayi' ? 'Bayi Arama & Seçimi (120-01)' : 'Müşteri Cari Arama & Seçimi (120-03)'} <span className="text-red-500">*</span>
                        </div>
                        <ErpCariSelect
                          compact
                          type={toErpDealerType(editForm.customerType)}
                          value={editSelectedDealer}
                          valueLabel={editForm.dealerName}
                          disabled={!!getSingleDealerCode()}
                          disabledMessage="Kendi bayi cariniz seçili"
                          placeholder={`${editForm.customerType} kodu, adı veya telefonu ile arayın`}
                          onChange={(next) => {
                            setEditSelectedDealer(next)
                            setEditForm(p => ({
                              ...p,
                              dealerName: next ? formatCariLabel(next) : '',
                              dealerPhone: next?.phone ? sanitizePhone(next.phone) : '',
                              dealerAddress: next?.address || '',
                              dealerInvoiceType: next?.invoiceType || ''
                            }))
                          }}
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="font-semibold text-gray-500">Bayi/Mağaza Adı <span className="text-red-500">*</span></label>
                        <input
                          type="text"
                          value={editForm.dealerName}
                          disabled
                          className="px-3 py-2 border border-gray-200 rounded-lg text-xs w-full bg-gray-50 text-gray-500 cursor-not-allowed font-medium"
                          placeholder="Yukarıdan cari seçiniz"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="font-semibold text-gray-500">Bayi/Mağaza Telefonu</label>
                        <input
                          type="text"
                          value={editForm.dealerPhone}
                          disabled={editForm.customerType === 'Bayi' || editForm.customerType === 'Mağaza'}
                          onChange={e => setEditForm(p => ({ ...p, dealerPhone: sanitizePhone(e.target.value) }))}
                          className={`px-3 py-2 border border-gray-200 rounded-lg text-xs w-full focus:outline-none ${editForm.customerType === 'Bayi' || editForm.customerType === 'Mağaza' ? 'bg-gray-50 text-gray-500 cursor-not-allowed font-medium' : 'bg-white'}`}
                          placeholder="Telefon giriniz"
                        />
                      </div>

                      <div className="space-y-1 col-span-2">
                        <label className="font-semibold text-gray-500">Bayi/Mağaza Adresi</label>
                        <input
                          type="text"
                          value={editForm.dealerAddress}
                          disabled={editForm.customerType === 'Bayi' || editForm.customerType === 'Mağaza'}
                          onChange={e => setEditForm(p => ({ ...p, dealerAddress: e.target.value }))}
                          className={`px-3 py-2 border border-gray-200 rounded-lg text-xs w-full focus:outline-none ${editForm.customerType === 'Bayi' || editForm.customerType === 'Mağaza' ? 'bg-gray-50 text-gray-500 cursor-not-allowed font-medium' : 'bg-white'}`}
                          placeholder="Adres giriniz"
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
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Müşteri Bilgileri</h3>
                    <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-655 to-gray-700 flex items-center justify-center text-white font-semibold">
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

                  {/* Dealer Info */}
                  {selectedRecord.dealerName && (
                    <div>
                      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Bayi Bilgileri</h3>
                      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#B91C1C] to-red-700 flex items-center justify-center text-white font-semibold">
                            {selectedRecord.dealerName.split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join('')}
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900">{selectedRecord.dealerName}</div>
                            {selectedRecord.dealerPhone && (
                              <div className="text-sm text-gray-500 flex items-center gap-1">
                                <Phone className="w-3 h-3" />
                                {selectedRecord.dealerPhone}
                              </div>
                            )}
                          </div>
                        </div>
                        {selectedRecord.dealerAddress && (
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <MapPin className="w-4 h-4 text-gray-400" />
                            <span>{selectedRecord.dealerAddress}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

              {/* Kalemler — ürün ve müşteri kayıt seviyesinde değil kalem seviyesinde.
                  "Garanti" kaldırıldı: montajda garanti kavramı yok. */}
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Montaj Kalemleri</h3>
                <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                  {(() => {
                    const items: any[] = Array.isArray((selectedRecord as any).items) ? (selectedRecord as any).items : []
                    if (items.length === 0) {
                      return <div className="text-sm text-gray-400 italic">Bu kayıtta kalem yok.</div>
                    }
                    return items.map((it: any, i: number) => (
                      <div key={it.id || i} className="pb-3 last:pb-0 border-b last:border-b-0 border-gray-200">
                        <div className="flex justify-between gap-3">
                          <span className="text-sm font-semibold text-gray-900">{it.productName || '-'}</span>
                          <span className="text-xs font-bold text-gray-500 whitespace-nowrap">{it.quantity} adet</span>
                        </div>
                        {it.productStockCode && (
                          <div className="text-[11px] text-gray-400 font-mono mt-0.5">{it.productStockCode}</div>
                        )}
                        {/* Her kalemin müşterisi farklı olabilir; kalemde yoksa kaydınki geçerli. */}
                        <div className="text-xs text-gray-600 mt-1.5">
                          {it.customerName || selectedRecord.customerName || '-'}
                          {(it.customerPhone || selectedRecord.customerPhone) && (
                            <> · {it.customerPhone || selectedRecord.customerPhone}</>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 flex items-start gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          <span>{it.customerAddress || selectedRecord.customerAddress || '-'}</span>
                        </div>
                        {it.notes && (
                          <div className="text-xs text-gray-500 mt-1 italic">{it.notes}</div>
                        )}
                      </div>
                    ))
                  })()}
                </div>
              </div>

              {/* Fatura bilgisi */}
              {(() => {
                const invoiceNo = extractInvoiceNo(selectedRecord.problemDescription)
                if (!invoiceNo) return null
                return (
                  <div>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Fatura</h3>
                    <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-800 font-medium">
                      Fatura No: {invoiceNo}
                    </div>
                  </div>
                )
              })()}

              {/* Timeline */}
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">İşlem Geçmişi</h3>
                {infoTimelineDurum !== 'hazir' ? (
                  <button
                    type="button"
                    onClick={() => selectedRecord && void loadInfoTimeline(selectedRecord)}
                    disabled={infoTimelineDurum === 'yukleniyor'}
                    className="w-full rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                  >
                    {infoTimelineDurum === 'yukleniyor' ? 'Geçmiş yükleniyor…' : 'İşlem geçmişini göster'}
                  </button>
                ) : infoTimeline.length === 0 ? (
                  <div className="text-xs text-gray-400 italic">Henüz geçmiş yok.</div>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {groupTimelineEvents(
                      infoTimeline.filter((ev: any) => {
                        const infoTaskId = (selectedRecord as any).taskId
                        if (!infoTaskId) return true
                        let payload: any = {}
                        try {
                          payload = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : (ev.payload || {})
                        } catch {}
                        const evTaskId = payload.metadata?.taskId || payload.metadata?.TaskId
                        return !evTaskId || String(evTaskId).toLowerCase() === String(infoTaskId).toLowerCase()
                      })
                    ).map((ev: any, idx: number) => (
                      <TimelineEvent key={idx} ev={ev} idx={idx} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )}

      {/* New Montaj Registration Modal */}
      {createOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between shrink-0">
                <div>
                  <div className="text-lg font-bold text-gray-900">Yeni Montaj Kaydı</div>
                  <div className="text-xs text-gray-500">Kayıt oluşturulduktan sonra listede görünecek.</div>
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

                  <div className="space-y-1 md:col-span-2 border-t pt-4">
                    <div className="text-xs font-bold text-red-600 uppercase">Ürün ve Müşteri Bilgileri</div>
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-gray-500">
                        Montaj Kalemleri <span className="text-red-500">*</span>
                        <span className="ml-2 font-normal text-gray-400">Toplam {itemsTotalQuantity} adet</span>
                      </div>
                      <button
                        type="button"
                        onClick={addItemRow}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Kalem Ekle
                      </button>
                    </div>

                    <div className="space-y-2">
                      {newItems.map((item, index) => (
                        <div key={item.key} className="grid grid-cols-12 gap-2 items-start bg-gray-50/60 border border-gray-100 rounded-xl p-2.5">
                          <div className="col-span-12 sm:col-span-6">
                            <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Ürün</div>
                            <SearchableProductSelect
                              products={erpProducts}
                              value={item.productName}
                              onChange={(val) => updateItemRow(index, { productName: val })}
                              disabled={loadingProducts}
                              placeholder="Ürün Ara veya Seç..."
                            />
                          </div>
                          {/* Seri no alanı kaldırıldı (kullanıcı isteği, 2026-08-10): kabulde
                              girilmiyor. Alan veri modelinde duruyor — fatura/webhook'tan gelen
                              seri no korunuyor, düzenleme ekranından da girilebiliyor. */}
                          <div className="col-span-8 sm:col-span-5">
                            <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Miktar</div>
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => updateItemRow(index, { quantity: e.target.value })}
                              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full"
                            />
                          </div>
                          <div className="col-span-4 sm:col-span-1 flex items-end justify-end h-full pb-0.5">
                            <button
                              type="button"
                              onClick={() => removeItemRow(index)}
                              disabled={newItems.length === 1}
                              title={newItems.length === 1 ? 'En az bir kalem olmalı' : 'Kalemi sil'}
                              className={`p-2 rounded-lg transition-colors ${newItems.length === 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer'}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="col-span-12 mt-1.5 flex flex-col gap-1.5 border-t border-gray-150/40 pt-1.5">
                            <div className="flex items-center justify-between">
                              <button
                                type="button"
                                onClick={() => setActiveItemIndexForModal(index)}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all ${
                                  item.customerName || item.customerPhone || item.customerAddress
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                    : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                                }`}
                              >
                                <span>
                                  {item.customerName || item.customerPhone || item.customerAddress
                                    ? 'Montaj Bilgilerini Düzenle'
                                    : 'Montaj Bilgisi Ekle'}
                                </span>
                              </button>
                            </div>
                            {(item.customerName || item.customerPhone || item.customerAddress) && (
                              <div className="bg-white/80 border border-gray-100 rounded-xl p-2.5 space-y-1 text-[11px] text-gray-600 shadow-sm animate-in fade-in duration-200">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
                                  <div>
                                    <span className="font-bold text-gray-500">Müşteri:</span> {item.customerName}
                                  </div>
                                  <div>
                                    <span className="font-bold text-gray-500">Telefon:</span> {item.customerPhone}
                                  </div>
                                  <div className="sm:col-span-2">
                                    <span className="font-bold text-gray-500">Bölge:</span> {regions.find(r => r.id === item.regionId)?.name || '—'}
                                  </div>
                                  <div className="sm:col-span-2">
                                    <span className="font-bold text-gray-500">Adres:</span> {item.customerAddress}
                                  </div>
                                  {item.dealerName && (
                                    <div className="sm:col-span-2">
                                      <span className="font-bold text-gray-500">Bayi / Mağaza:</span> {item.dealerName}
                                    </div>
                                  )}
                                  {item.notes && (
                                    <div className="sm:col-span-2">
                                      <span className="font-bold text-gray-500">Açıklama / Not:</span> {item.notes}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
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
                      const filledItems = newItems.filter((i) => i.productName.trim())

                      // Bayi kayıt seviyesinde tek: kalemlerden ilk dolu olanı esas alınır,
                      // yoksa son doldurulan kalem detayı, o da yoksa kaydın kendi alanı.
                      const dealerSource =
                        filledItems.find((i) => i.dealerName || i.selectedDealer) ??
                        (lastFilledItemDetails.dealerName || lastFilledItemDetails.selectedDealer
                          ? lastFilledItemDetails
                          : null) ??
                        (newRecord.dealerName ? newRecord : null)

                      if (filledItems.length === 0) {
                        setActionError('En az bir montaj kalemi (ürün) girilmelidir.')
                        setActionLoading(false)
                        return
                      }
                      // Item-level validation
                      for (let i = 0; i < filledItems.length; i++) {
                        const item = filledItems[i]
                        if (
                          !item.customerName?.trim() ||
                          !item.customerPhone?.trim() ||
                          !item.customerAddress?.trim() ||
                          !item.regionId ||
                          !item.dealerName?.trim()
                        ) {
                          setActionError(`${i + 1}. kalem için montaj bilgileri eklenmemiştir. Lütfen montaj bilgisi ekleyiniz.`)
                          setActionLoading(false)
                          return
                        }
                      }

                      /*
                        MONTAJ BEDELİ — ürün adıyla erpProducts'tan çözülür (satırda stok kodu yok).
                        Montaj fiyatı tanımlı ürünler için bayiye bekleyen sipariş taslağı açılacak.
                      */
                      const montajDealerCode = (dealerSource as any)?.selectedDealer?.customerCode as string | undefined
                      const bedelKalemleri = filledItems
                        .map((it) => {
                          const prod = erpProducts.find((p) => p.name === it.productName.trim())
                          const fee = Number(prod?.installationFee ?? 0)
                          if (!prod?.stockCode || !(fee > 0)) return null
                          // Müşteri adı da gidiyor (2026-09-07): fatura BAYİYE kesiliyor, satır
                          // açıklamasında "kime gitti" yazmazsa bayi hangi montajın bedeli
                          // olduğunu ayırt edemiyor.
                          return {
                            stokKodu: prod.stockCode,
                            adet: Math.max(1, Number(it.quantity) || 1),
                            musteriAdi: (it.customerName ?? '').trim() || null
                          }
                        })
                        .filter((x): x is { stokKodu: string; adet: number; musteriAdi: string | null } => x != null)

                      /*
                        KREDİ LİMİTİ ÖN KONTROLÜ (kullanıcı, 2026-09-03): "montajda limit yoksa
                        oluşturmasın, önce para ödeyin desin". Limit yetmiyorsa KAYIT HİÇ AÇILMAZ.
                      */
                      if (montajDealerCode && bedelKalemleri.length > 0) {
                        try {
                          const chk = await checkMontajBedeliLimit(montajDealerCode, bedelKalemleri)
                          if (!chk.ok && chk.code === 'CREDIT_LIMIT_EXCEEDED') {
                            setActionError(montajBedeliLimitMesaji(chk.data))
                            setActionLoading(false)
                            return
                          }
                        } catch (e: any) {
                          // Kontrol ucu patlarsa kaydı bloklamayız — sipariş adımı kendi hatasını gösterir.
                          console.warn('montaj bedeli limit kontrolü başarısız:', e?.message)
                        }
                      }

                      const created = await createRecord({
                        type: 'Installation',
                        customerName: filledItems[0].customerName || undefined,
                        customerPhone: filledItems[0].customerPhone || undefined,
                        customerAddress: filledItems[0].customerAddress || undefined,
                        // Kaydın kendi ürün alanları listelerde başlık olarak kullanılıyor:
                        // ilk kalem yazılır, birden çok kalem varsa adedi de belirtilir.
                        productName: filledItems.length > 1
                          ? `${filledItems[0].productName} (+${filledItems.length - 1} kalem)`
                          : filledItems[0].productName,
                        serialNumber: filledItems[0].serialNumber || undefined,
                        items: filledItems.map((i) => ({
                          productName: i.productName,
                          serialNumber: i.serialNumber || undefined,
                          quantity: Math.max(1, Number(i.quantity) || 1),
                          customerName: i.customerName || undefined,
                          customerPhone: i.customerPhone || undefined,
                          customerAddress: i.customerAddress || undefined,
                          notes: i.notes || undefined,
                        })),
                        isUnderWarranty: true,
                        // Bayi bilgisi KALEMDEN okunur.
                        //
                        // Cari seçimi kalem bazındaki "Montaj Bilgisi Ekle" modalında yapılıyor ve
                        // oraya yazılıyor; payload ise `newRecord`'dan okuyordu ve o alan bu akışta
                        // hiç doldurulmadığı için kayıtlara bayi BOŞ gidiyordu (doğrulandı: son
                        // montaj kayıtlarının hepsinde DealerName boş, DealerCode null).
                        //
                        // dealerCode de gönderiliyor: DTO'da alan vardı ama istemci hiç doldurmuyordu.
                        // Cari koduna göre yapılan bayi kapsam süzgeci (ApplyDealerFilter) bu kolona
                        // baktığı için, kod olmadan bayi kullanıcısı kendi kayıtlarını göremiyordu.
                        dealerName: dealerSource?.dealerName || undefined,
                        dealerCode: (dealerSource as any)?.selectedDealer?.customerCode || undefined,
                        dealerPhone: dealerSource?.dealerPhone || undefined,
                        dealerAddress: dealerSource?.dealerAddress || undefined,
                        // Fatura tipi aciklamaya YAZILMAZ (2026-08-24): alan ekrandan kaldirildi,
                        // metne yazilmaya devam etseydi kayitta gorunup kafa karistirirdi.
                        problemDescription: `Müşteri Tipi: ${newRecord.customerType}` +
                          (filledItems[0].notes ? `\nBayi Açıklama: ${filledItems[0].notes}` : ''),
                        priority: newRecord.priority,
                        regionId: filledItems[0].regionId,
                        installationType: newRecord.customerType === 'Bayi' ? 'Bayi' : 'Mağaza',
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
                          const webpFile = await convertToWebP(file)
                          const formData = new FormData()
                          formData.append('file', webpFile)
                          await fetch(`${API_BASE_URL}/api/servicerecords/${created.id}/photo`, {
                            method: 'POST',
                            headers: token ? { Authorization: `Bearer ${token}` } : {},
                            body: formData
                          })
                        }
                      }

                      /*
                        MONTAJ BEDELİ SİPARİŞİ (elle kabulde). `montajDealerCode` ve
                        `bedelKalemleri` yukarıda (kayıt açılmadan önce) hesaplandı, kredi
                        limiti orada ön kontrolden geçti. Burada taslak sipariş yazılır.
                        Best-effort: yine de hata olursa kayıt geri alınmaz, uyarı gösterilir.
                      */
                      if (montajDealerCode && bedelKalemleri.length > 0) {
                        try {
                          const r = await createMontajBedeliSiparis(montajDealerCode, bedelKalemleri)
                          if (r.created !== false) {
                            toast.success('Montaj bedeli için bekleyen sipariş oluşturuldu.')
                          }
                        } catch (e: any) {
                          toast.warning(String(e?.message ?? 'Montaj bedeli siparişi oluşturulamadı.'))
                        }
                      }

                      setCreateOpen(false)
                      setSelectedFiles([])
                      setActionSuccess('Montaj kaydı oluşturuldu.')
                      setSelectedDealer(null)
                      setNewItems([createEmptyItemRow()])
                      setLastFilledItemDetails({ customerName: '', customerPhone: '', customerAddress: '', notes: '', regionId: '', customerType: 'Müşteri', dealerName: '', dealerPhone: '', dealerAddress: '', dealerInvoiceType: '', selectedDealer: null })
                      setNewRecord({
                        plannedDate: new Date().toLocaleDateString('sv-SE'),
                        isUnderWarranty: 'Evet',
                        productName: '',
                        warrantyStartDate: '',
                        invoiceNumber: '',
                        serialNumber: '',
                        problemDescription: '',
                        quantity: '1',
                        customerType: 'Bayi',
                        dealerName: '',
                        dealerPhone: '',
                        dealerAddress: '',
                        dealerInvoiceType: '',
                        customerName: '',
                        customerPhone: '',
                        regionId: '',
                        customerAddress: '',
                        priority: 'Normal',
                      })
                    } catch (e: any) {
                      setActionError(String(e?.message ?? 'Kayıt oluşturulamadı'))
                    } finally {
                      setActionLoading(false)
                    }
                  }}
                  className={
                    'px-4 py-2 rounded-lg text-sm font-semibold ' +
                    (actionLoading ? 'bg-gray-300 text-gray-600' : 'bg-[#B91C1C] text-white hover:bg-[#991B1B]')
                  }
                >
                  {actionLoading ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {/* Anket ortak bileşen: aynı modal Montaj Geçmişi'nde de kullanılıyor. */}
      <MemnuniyetAnketiModal
        kayit={satisfactionRecord as any}
        onClose={() => setSatisfactionRecord(null)}
        kaydet={(id, puan, not) => updateSatisfaction(id, puan, not)}
        onSaved={() => refetch(true)}
      />

      {/* "Tamamlanmayı Geri Al" onayı — gerçekleşen bir kaydı yanlışlıkla kapattıysak
          teslimattakilere geri gönderir; kalemlerin durumuna dokunmaz. */}
      {geriAlTarget && (
        <div className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center p-4" onClick={() => !geriAlLoading && setGeriAlTarget(null)}>
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-gray-200 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="font-bold text-gray-900 text-base">Tamamlanmayı Geri Al</div>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-sm text-gray-600">
                <span className="font-mono font-semibold text-gray-900">{geriAlTarget.serviceNumber}</span> numaralı
                montaj kaydı "Gerçekleşti" olarak işaretlenmiş. Geri alırsanız kayıt tekrar
                Teslimattakiler'e döner; kalemlerin durumu DEĞİŞMEZ — hatalı işaretlenen varsa
                orada kendisini düzeltirsiniz.
              </p>
              {geriAlError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs font-semibold text-red-600">{geriAlError}</div>
              )}
            </div>
            <div className="p-4 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={geriAlLoading}
                onClick={() => setGeriAlTarget(null)}
                className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={geriAlLoading}
                onClick={async () => {
                  setGeriAlLoading(true)
                  setGeriAlError(null)
                  try {
                    await apiJson(`/api/servicerecords/${geriAlTarget.id}/status`, {
                      method: 'PATCH',
                      body: JSON.stringify({
                        status: 'Workshop',
                        notes: 'Tamamlanma geri alındı, kayıt teslimattakilere gönderildi.'
                      })
                    })
                    await refetch()
                    setGeriAlTarget(null)
                  } catch (err: any) {
                    setGeriAlError(String(err?.message ?? 'Geri alma başarısız'))
                  } finally {
                    setGeriAlLoading(false)
                  }
                }}
                className={`px-4 py-2 rounded-lg text-sm font-bold text-white ${geriAlLoading ? 'bg-gray-300' : 'bg-orange-600 hover:bg-orange-700'}`}
              >
                {geriAlLoading ? 'Gönderiliyor...' : 'Evet, Geri Al'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Düzenleme neden kapalı: sessiz pasif buton yerine sebebi söyleyen uyarı. */}
      {editBlockedMsg && (
        <div className="fixed inset-0 z-[130] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-amber-100 bg-amber-50 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <Info className="w-5 h-5 text-amber-600" />
              </div>
              <div className="font-bold text-amber-900 text-sm">Bu kayıt buradan düzenlenemez</div>
            </div>
            <div className="px-5 py-4 text-sm text-gray-700 leading-relaxed">{editBlockedMsg}</div>
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                type="button"
                onClick={() => setEditBlockedMsg(null)}
                className="px-4 py-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-white text-xs font-bold cursor-pointer"
              >
                Anladım
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Servis Fişleri (WorkOrders) Modal */}
      {/* Kalem düzenleme — kayıt seviyesinde değil kalem seviyesinde */}
      {editingItem && (
        <div className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <div className="font-bold text-gray-900 text-sm">Montaj Kalemini Düzenle</div>
              <button onClick={() => setEditingItem(null)} className="text-gray-400 hover:text-gray-600" disabled={itemSaving}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
              {itemError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-semibold text-red-600">{itemError}</div>
              )}

              {editingItem.isInvoiceBacked && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
                  Bu kalem faturadan geldi. Ürün ve miktar Fatura Dökümü'nden yönetilir; buradan
                  müşteri, adres, seri no ve notu düzenleyebilirsiniz.
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-gray-600 mb-1">Ürün</label>
                  <input
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
                    value={editingItem.productName || ''}
                    disabled={editingItem.isInvoiceBacked}
                    onChange={(e) => setEditingItem({ ...editingItem, productName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Miktar</label>
                  <input
                    type="number"
                    min={1}
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg disabled:bg-gray-100 disabled:text-gray-500"
                    value={editingItem.quantity ?? 1}
                    disabled={editingItem.isInvoiceBacked}
                    onChange={(e) => setEditingItem({ ...editingItem, quantity: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Seri No</label>
                <input
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg"
                  value={editingItem.serialNumber || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, serialNumber: e.target.value })}
                />
              </div>

              {/* "Bayi Bilgileriyle Doldur" kaldırıldı (kalem düzenleme): müşteri alanları
                  bayiden doldurulmuyor. */}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Müşteri</label>
                  <input
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg uppercase"
                    value={editingItem.customerName || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, customerName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">Telefon</label>
                  <input
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg"
                    value={editingItem.customerPhone || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, customerPhone: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Adres</label>
                <input
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg uppercase"
                  value={editingItem.customerAddress || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, customerAddress: e.target.value })}
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Adres değişirse tamamlanmamış görevlerin adresi de güncellenir.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Not / Açıklama</label>
                <input
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg"
                  value={editingItem.notes || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, notes: e.target.value })}
                />
              </div>
            </div>

            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50">
              <button
                onClick={() => setEditingItem(null)}
                disabled={itemSaving}
                className="px-4 py-2 text-xs font-semibold rounded-xl border border-gray-200 bg-white hover:bg-gray-100 text-gray-700"
              >
                Vazgeç
              </button>
              <button
                onClick={saveEditingItem}
                disabled={itemSaving}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
              >
                {itemSaving ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kalem geçmişi — Atölye/Saha ile aynı bileşen */}
      {historyRecordId && (
        <ServisGecmisiModal
          recordId={historyRecordId}
          taskId={historyTaskId}
          onClose={() => { setHistoryRecordId(null); setHistoryTaskId(null) }}
        />
      )}

      {/* Görev Önizleme Modal */}
      {previewModalOpen && previewTask && previewRecord && (
        <>
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[999]"
            onClick={() => setPreviewModalOpen(false)}
          />
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200">
              {/* Header */}
              <div className="p-4 border-b border-gray-150 flex items-center justify-between bg-blue-50/50">
                <div>
                  <h3 className="font-bold text-gray-955 flex items-center gap-2">
                    <Eye className="w-5 h-5 text-blue-600" />
                    <span className="font-sans">Ürün ve Durum Önizleme</span>
                  </h3>
                  <div className="text-[10px] text-gray-500 mt-0.5 font-sans">
                    Fiş No: <span className="font-mono font-bold text-gray-700">{previewRecord.serviceNumber}</span>
                  </div>
                </div>
                <button
                  onClick={() => setPreviewModalOpen(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded-full transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="p-5 overflow-y-auto flex-1 space-y-5 custom-scrollbar text-xs">
                {/* Status and Summary */}
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 font-sans">
                  <div className="space-y-0.5">
                    <div className="text-gray-400 text-[10px] uppercase font-bold tracking-wider">Durum</div>
                    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${
                      taskStatusConfig[previewTask.status ?? previewTask.Status]?.color || 'bg-gray-100 text-gray-700'
                    }`}>
                      {taskStatusConfig[previewTask.status ?? previewTask.Status]?.label || previewTask.statusLabel || previewTask.StatusLabel || 'Planlanmadı'}
                    </span>
                  </div>
                  <div className="text-right space-y-0.5">
                    <div className="text-gray-400 text-[10px] uppercase font-bold tracking-wider">Miktar</div>
                    <div className="text-sm font-bold text-gray-900">{previewTask.quantity ?? previewTask.Quantity ?? 1} Adet</div>
                  </div>
                </div>

                {/* Grid Info */}
                <div className="grid grid-cols-2 gap-4 font-sans">
                  <div className="space-y-1">
                    <span className="text-gray-500 font-semibold block">Atanan Teknisyen</span>
                    {previewTask.technicianName || previewTask.TechnicianName ? (
                      <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg border border-gray-100">
                        <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-[9px] font-bold text-blue-700">
                          {(previewTask.technicianName || previewTask.TechnicianName).split(' ').filter(Boolean).slice(0, 2).map((n: string) => n[0]).join('')}
                        </div>
                        <span className="font-bold text-gray-900">{previewTask.technicianName || previewTask.TechnicianName}</span>
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-amber-50 text-amber-800 text-[10px] font-bold border border-amber-200">
                        Atanmadı
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    <span className="text-gray-500 font-semibold block">Planlanan Tarih</span>
                    <div className="bg-gray-50 p-2 rounded-lg border border-gray-100 font-medium text-gray-800">
                      {(previewTask.plannedAt || previewTask.PlannedAt) 
                        ? new Date(previewTask.plannedAt || previewTask.PlannedAt).toLocaleDateString('tr-TR') 
                        : '-'}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-gray-500 font-semibold block">Oluşturulma Tarihi</span>
                    <div className="bg-gray-50 p-2 rounded-lg border border-gray-100 font-medium text-gray-800">
                      {(previewTask.createdAt || previewTask.CreatedAt) 
                        ? new Date(previewTask.createdAt || previewTask.CreatedAt).toLocaleDateString('tr-TR') 
                        : '-'}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <span className="text-gray-500 font-semibold block">Atama Adresi</span>
                    <div className="bg-gray-50 p-2 rounded-lg border border-gray-100 font-medium text-gray-800 break-words leading-relaxed min-h-[32px]">
                      {previewTask.customAddress || previewTask.CustomAddress || 'Belirtilmedi'}
                    </div>
                  </div>
                </div>

                {/* Not / Açıklama */}
                <div className="space-y-1 font-sans">
                  <span className="text-gray-500 font-semibold block">Not / Açıklama</span>
                  <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 font-medium text-gray-800 leading-relaxed min-h-[48px]">
                    {previewTask.notes || previewTask.Notes || '-'}
                  </div>
                </div>

                {/* Photo Preview */}
                {(() => {
                  const rawUrl = previewTask.photoUrl || previewTask.PhotoUrl || ''
                  const firstUrl = rawUrl.split(',').filter(Boolean)[0]
                  if (firstUrl) {
                    const fullUrl = firstUrl.startsWith('http') ? firstUrl : `${API_BASE_URL}${firstUrl}`
                    return (
                      <div className="space-y-1 font-sans">
                        <span className="text-gray-500 font-semibold block">Görev Görseli</span>
                        <div className="border border-gray-100 rounded-xl overflow-hidden bg-gray-50 max-h-48 flex justify-center items-center shadow-inner">
                          <a href={fullUrl} target="_blank" rel="noopener noreferrer" className="block w-full text-center">
                            <img
                              src={fullUrl}
                              alt="Tamamlanma Görseli"
                              className="max-h-48 max-w-full object-contain mx-auto transition-transform hover:scale-105"
                            />
                          </a>
                        </div>
                      </div>
                    )
                  }
                  return null
                })()}

                {/* Timeline / Action History */}
                <div className="space-y-3 pt-2 border-t border-gray-100 font-sans">
                  <span className="text-gray-500 font-semibold block">Bu Kalemin Geçmişi</span>
                  {previewTimelineLoading ? (
                    <div className="flex items-center justify-center py-4 gap-2 text-gray-400">
                      <span className="w-4 h-4 border-2 border-t-transparent border-blue-600 rounded-full animate-spin"></span>
                      Geçmiş yükleniyor...
                    </div>
                  ) : (() => {
                    const filteredEvents = groupTimelineEvents(
                      previewTimeline.filter((ev: any) => {
                        const taskId = previewTask.id || previewTask.Id
                        if (!taskId) return false
                        let payload: any = {}
                        try {
                          payload = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : (ev.payload || {})
                        } catch {}
                        const evTaskId = payload.metadata?.taskId || payload.metadata?.TaskId
                        return String(evTaskId).toLowerCase() === String(taskId).toLowerCase()
                      })
                    )
                    
                    if (filteredEvents.length === 0) {
                      return <div className="text-gray-400 italic text-[11px] py-1 font-sans">Bu kaleme ait işlem geçmişi kaydı bulunamadı.</div>
                    }

                    return (
                      <div className="space-y-3 max-h-48 overflow-y-auto pr-1">
                        {filteredEvents.map((ev: any, idx: number) => (
                          <TimelineEvent key={idx} ev={ev} idx={idx} />
                        ))}
                      </div>
                    )
                  })()}
                </div>
              </div>

              {/* Footer */}
              <div className="p-3 bg-gray-50 border-t border-gray-150 flex justify-end font-sans">
                <button
                  onClick={() => setPreviewModalOpen(false)}
                  className="px-4 py-2 bg-white border border-gray-250 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm cursor-pointer"
                >
                  Kapat
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <QuickAddCustomerModal
        isOpen={quickAddCustomerOpen}
        onClose={() => setQuickAddCustomerOpen(false)}
        onSuccess={handleQuickCustomerSuccess}
      />

      <KabulTakvimModal
        isOpen={calendarModalOpen}
        onClose={() => setCalendarModalOpen(false)}
        type="Installation"
      />
      </div>



      {activeItemIndexForModal !== null && (
        <div className="fixed inset-0 z-[60] bg-black/45 backdrop-blur-xs flex items-center justify-center p-4">
          <ItemMontajModal
            item={newItems[activeItemIndexForModal]}
            lastFilledItemDetails={lastFilledItemDetails}
            regions={regions}
            onClose={() => setActiveItemIndexForModal(null)}
            onQuickCustomerAddOpen={() => setQuickAddCustomerOpen(true)}
            onSave={(details) => {
              updateItemRow(activeItemIndexForModal, details)
              setLastFilledItemDetails(details)
              setActiveItemIndexForModal(null)
            }}
          />
        </div>
      )}
    </>
  )
}

type ItemMontajModalProps = {
  item: MontajItemRow
  lastFilledItemDetails: {
    customerName: string
    customerPhone: string
    customerAddress: string
    notes: string
    regionId: string
    customerType: string
    dealerName: string
    dealerPhone: string
    dealerAddress: string
    dealerInvoiceType: string
    selectedDealer: ErpDealerDto | null
  }
  regions: RegionOption[]
  onClose: () => void
  onQuickCustomerAddOpen: () => void
  onSave: (details: {
    customerName: string
    customerPhone: string
    customerAddress: string
    notes: string
    regionId: string
    customerType: string
    dealerName: string
    dealerPhone: string
    dealerAddress: string
    dealerInvoiceType: string
    selectedDealer: ErpDealerDto | null
  }) => void
}

function ItemMontajModal({
  item,
  lastFilledItemDetails,
  regions,
  onClose,
  onQuickCustomerAddOpen,
  onSave,
}: ItemMontajModalProps) {
  const [form, setForm] = useState({
    customerName: item.customerName || lastFilledItemDetails.customerName || '',
    customerPhone: item.customerPhone || lastFilledItemDetails.customerPhone || '',
    customerAddress: item.customerAddress || lastFilledItemDetails.customerAddress || '',
    notes: item.notes || lastFilledItemDetails.notes || '',
    regionId: item.regionId || lastFilledItemDetails.regionId || '',
    customerType: item.customerType || lastFilledItemDetails.customerType || 'Bayi',
    dealerName: item.dealerName || lastFilledItemDetails.dealerName || '',
    dealerPhone: item.dealerPhone || lastFilledItemDetails.dealerPhone || '',
    dealerAddress: item.dealerAddress || lastFilledItemDetails.dealerAddress || '',
    dealerInvoiceType: item.dealerInvoiceType || lastFilledItemDetails.dealerInvoiceType || '',
    selectedDealer: item.selectedDealer !== undefined ? item.selectedDealer : lastFilledItemDetails.selectedDealer
  })
  const [error, setError] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmCountdown, setConfirmCountdown] = useState(3)

  /**
   * Kullanicinin cari kapsami SINIRSIZ mi.
   *
   * Tek cariye bagli bir bayi ne baska bir cari secebilir ne de yeni cari acabilir; ona
   * "Yeni Musteri Ekle" / "Urunu Teslim Alan Kisi Ayni" dugmelerini gostermek basildiginda
   * hicbir sey yapmayan dugmeler demek. Ayni olcut cari secim kutusunu da kilitliyor
   * (`getSingleDealerCode`), yani ekranin geri kalaniyla tutarli.
   */
  const tumCarilerErisimi = hasAllDealers()


  useEffect(() => {
    if (!showConfirm || confirmCountdown <= 0) return
    const timer = setTimeout(() => {
      setConfirmCountdown(prev => prev - 1)
    }, 1000)
    return () => clearTimeout(timer)
  }, [showConfirm, confirmCountdown])

  // Sync props to state if they change (e.g. from parent quick customer success)
  useEffect(() => {
    if (item) {
      setForm(prev => ({
        ...prev,
        customerType: item.customerType || prev.customerType || 'Bayi',
        selectedDealer: item.selectedDealer !== undefined ? item.selectedDealer : prev.selectedDealer,
        dealerName: item.dealerName || prev.dealerName || '',
        dealerPhone: item.dealerPhone || prev.dealerPhone || '',
        dealerAddress: item.dealerAddress || prev.dealerAddress || '',
        dealerInvoiceType: item.dealerInvoiceType || prev.dealerInvoiceType || '',
        customerName: item.customerName || prev.customerName || '',
        customerPhone: item.customerPhone || prev.customerPhone || '',
        customerAddress: item.customerAddress || prev.customerAddress || ''
      }))
    }
  }, [item])

  // `handleSameAsDealer` kaldırıldı: müşteri alanları bayiden doldurulmuyor.

  const handleSave = () => {
    if (!form.customerName.trim()) {
      setError('İsim Soyisim alanı zorunludur.')
      return
    }
    if (!form.customerPhone.trim()) {
      setError('Telefon alanı zorunludur.')
      return
    }
    if (!form.customerAddress.trim()) {
      setError('Adres alanı zorunludur.')
      return
    }
    if (!form.regionId) {
      setError('Bölge seçimi zorunludur.')
      return
    }
    if (!form.dealerName.trim()) {
      setError(form.customerType === 'Bayi' ? 'Bayi seçimi zorunludur.' : 'Mağaza adı zorunludur.')
      return
    }
    setConfirmCountdown(3)
    setShowConfirm(true)
  }

  return (
    <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 overflow-hidden animate-in fade-in zoom-in duration-150 flex flex-col z-[70] relative" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-orange-50 to-amber-50/50">
        <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
          <span>Kalem Montaj & Adres Bilgileri</span>
        </div>
        <button
          type="button"
          className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="p-5 space-y-4 overflow-y-auto max-h-[60vh]">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-semibold text-red-600">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 text-xs text-gray-600 space-y-1">
            <div><span className="font-semibold text-gray-700">Bayi Adı:</span> {form.dealerName || '—'}</div>
            <div><span className="font-semibold text-gray-700">Ürün Adı:</span> {item.productName || '—'}</div>
            <div><span className="font-semibold text-gray-700">Miktar:</span> {item.quantity || '—'}</div>
          </div>

          {/* BAYİ BİLGİLERİ — ÖNCE BAYİ, SONRA MÜŞTERİ (2026-08-21 kullanıcı kuralı).
              Sıra bilerek böyle: bayi seçilmeden müşteri bilgisi girmek anlamsız, ve alanlar
              artık bayiden otomatik dolmadığı için kullanıcı ikisini ayrı ayrı giriyor. */}
          <div>
            <div className="text-xs font-bold text-red-600 uppercase mb-2">Bayi Bilgileri</div>
            
            {/* FATURA TIPI KALDIRILDI (2026-08-24, kullanici karari): "ACIK / MUAF / FATURA"
                bilgisi montaj adres formunda bir ise yaramiyor, kullaniciyi yaniltiyordu.
                Alan ne gosteriliyor ne de aciklamaya yaziliyor. Bayi Tipi tek basina kaldigi
                icin satir tam genislik. */}
            <div className="mb-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-gray-500">Bayi Tipi <span className="text-red-500">*</span></label>
                <select
                  value={form.customerType}
                  disabled={!!getSingleDealerCode()}
                  onChange={(e) => {
                    const type = e.target.value
                    setForm(p => ({
                      ...p,
                      customerType: type,
                      selectedDealer: null,
                      dealerName: '',
                      dealerPhone: '',
                      dealerAddress: '',
                      dealerInvoiceType: ''
                    }))
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="Bayi">Bayi (120-01)</option>
                  <option value="Müşteri">Müşteri (120-03)</option>
                </select>
              </div>
            </div>

            <div className="space-y-2 bg-gray-50/50 p-3 rounded-xl border border-gray-100 mb-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-gray-700">
                  {form.customerType === 'Bayi' ? 'Bayi Arama & Seçimi (120-01)' : 'Müşteri Cari Arama & Seçimi (120-03)'} <span className="text-red-500">*</span>
                </div>
                {/*
                  YENI MUSTERI EKLE — YALNIZCA TUM CARILERE ERISIMI OLANA (2026-08-24).

                  Tek cariye bagli bir bayi kendi carisinden baskasini secemez; ona yeni cari
                  acma dugmesi gostermek, basildiginda hicbir ise yaramayan bir kapi acar.
                  Olcut `hasAllDealers()`: cari kapsami sinirsiz olan kullanicilar.
                */}
                {tumCarilerErisimi && form.customerType === 'Müşteri' && (
                  <button
                    type="button"
                    onClick={onQuickCustomerAddOpen}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors cursor-pointer"
                  >
                    <span>+ Yeni Müşteri Ekle</span>
                  </button>
                )}
              </div>
              <ErpCariSelect
                type={toErpDealerType(form.customerType)}
                value={form.selectedDealer}
                valueLabel={form.dealerName}
                disabled={!!getSingleDealerCode()}
                disabledMessage="Kendi bayi cariniz seçili"
                placeholder={`${form.customerType} kodu, adı veya telefonu ile arayın`}
                onChange={(next) => {
                  setForm((p) => ({
                    ...p,
                    selectedDealer: next,
                    dealerName: next ? formatCariLabel(next) : '',
                    dealerPhone: next?.phone ? sanitizePhone(next.phone) : '',
                    dealerAddress: next?.address || '',
                    dealerInvoiceType: next?.invoiceType || '',
                    // MÜŞTERİ ALANLARI BAYİDEN DOLDURULMAZ (2026-08-21 kullanıcı kuralı).
                    //
                    // Burada bayinin adı/telefonu/adresi müşteri alanlarına kopyalanıyordu
                    // ("Same Receiver" varsayımı). Montajın gideceği kişi bayi değil; alanlar
                    // bayinin ünvanıyla dolu açılınca kullanıcı üstüne yazmayı unutuyor ve
                    // montaj yanlış isim/adresle kaydediliyordu. Alanlar boş kalır, elle girilir.
                  }))
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-gray-500">Bayi/Mağaza Adı <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={form.dealerName}
                  disabled
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-full bg-gray-50 text-gray-500 font-medium cursor-not-allowed"
                  placeholder="Yukarıdan cari seçiniz"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-gray-500">Bayi/Mağaza Telefonu</label>
                <input
                  type="text"
                  value={form.dealerPhone}
                  onChange={(e) => setForm((p) => ({ ...p, dealerPhone: sanitizePhone(e.target.value) }))}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm w-full bg-white text-gray-900 font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="Telefon numarası"
                />
              </div>
            </div>

            <div className="space-y-1 mt-3">
              <label className="block text-xs font-semibold text-gray-500">Bayi/Mağaza Adresi</label>
              <input
                type="text"
                value={form.dealerAddress}
                onChange={(e) => setForm((p) => ({ ...p, dealerAddress: e.target.value }))}
                className={`px-3 py-2 border border-gray-200 rounded-lg text-sm w-full focus:ring-2 focus:ring-blue-500 focus:outline-none ${form.customerType === 'Bayi' || form.customerType === 'Mağaza' ? 'bg-gray-50 text-gray-500 cursor-not-allowed font-medium' : 'bg-white'}`}
                placeholder="Adres"
              />
            </div>
          </div>

          {/* Müşteri Bilgileri — bayi bloğundan SONRA gelir. */}
          <div className="border-t border-gray-150/60 pt-3 mt-3 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-red-600 uppercase">Müşteri Bilgileri</div>
              {/*
                URUNU TESLIM ALAN KISI AYNI (2026-08-24, kullanici istegi).

                Musteri alanlari bayiden OTOMATIK doldurulmuyor — o davranis 2026-08-21'de
                bilerek kaldirilmisti: montajin gidecegi kisi bayi degil, alanlar bayinin
                unvaniyla dolu acilinca kullanici ustune yazmayi unutuyor ve montaj yanlis
                isim/adresle kaydediliyordu.

                Dugme o kurali BOZMUYOR: doldurma artik kendiliginden degil, kullanicinin
                acikca bastigi bir eylem. Urunu bayinin kendisi teslim aliyorsa (magaza ici
                montaj, bayi deposu) ayni bilgiyi elle yazmak zorunda kalmiyor.

                Kapsam kurali "Yeni Musteri Ekle" ile ayni: tek cariye bagli kullanicida
                gorunmez.
              */}
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-500">İsim Soyisim <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.customerName}
                onChange={(e) => setForm(p => ({ ...p, customerName: sanitizeName(e.target.value) }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="Müşteri Adı Soyadı"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-500">Telefon <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={form.customerPhone}
                onChange={(e) => setForm(p => ({ ...p, customerPhone: sanitizePhone(e.target.value) }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="0555 555 5555"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-500">Adres <span className="text-red-500">*</span></label>
              <textarea
                value={form.customerAddress}
                onChange={(e) => setForm(p => ({ ...p, customerAddress: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none h-20 resize-none"
                placeholder="Montajın yapılacağı adres"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-gray-500">Bölge <span className="text-red-500">*</span></label>
              <select
                value={form.regionId}
                onChange={(e) => setForm(p => ({ ...p, regionId: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="">Seçiniz...</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-500">Açıklama / Bayi Notu</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="Montajla ilgili ilave açıklama / not"
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 bg-gray-50">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-100 text-gray-700 transition-all active:scale-95 cursor-pointer"
        >
          Vazgeç
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="px-5 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all active:scale-95 flex items-center gap-1.5 cursor-pointer"
        >
          Kaydet ve Uygula
        </button>
      </div>

      {showConfirm && (
        <div 
          className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-gray-150 space-y-4 text-center animate-in zoom-in duration-150">
            <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-gray-900">Alıcı Doğrulama</h3>
              <p className="text-xs text-gray-500">Ürünü teslim alacak kişi bu mu?</p>
              
              <div className="text-xs font-semibold text-slate-800 bg-slate-50 p-3 rounded-lg border border-slate-100 mt-2 space-y-2 text-left">
                <div>
                  <span className="text-[9px] text-gray-400 block uppercase font-bold tracking-wider mb-0.5">İsim Soyisim</span>
                  <span className="text-xs text-gray-800 font-bold">{form.customerName || '—'}</span>
                </div>
                <div>
                  <span className="text-[9px] text-gray-400 block uppercase font-bold tracking-wider mb-0.5">Telefon</span>
                  <span className="text-xs text-gray-800 font-bold">{form.customerPhone || '—'}</span>
                </div>
                <div>
                  <span className="text-[9px] text-gray-400 block uppercase font-bold tracking-wider mb-0.5">Adres</span>
                  <span className="text-xs text-gray-800 font-bold block max-h-[80px] overflow-y-auto">{form.customerAddress || '—'}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition active:scale-95 cursor-pointer"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={confirmCountdown > 0}
                onClick={() => {
                  setShowConfirm(false)
                  onSave({
                    customerName: form.customerName.trim(),
                    customerPhone: form.customerPhone.trim(),
                    customerAddress: form.customerAddress.trim(),
                    notes: form.notes.trim(),
                    regionId: form.regionId,
                    customerType: form.customerType,
                    dealerName: form.dealerName,
                    dealerPhone: form.dealerPhone,
                    dealerAddress: form.dealerAddress,
                    dealerInvoiceType: form.dealerInvoiceType,
                    selectedDealer: form.selectedDealer
                  })
                }}
                className={`flex-1 py-2 text-xs font-bold text-white rounded-lg transition active:scale-95 cursor-pointer ${
                  confirmCountdown > 0 
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {confirmCountdown > 0 ? `Evet, Devam Et (${confirmCountdown})` : 'Evet, Devam Et'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
