import React, { useState, useEffect, useCallback } from 'react'
import {
  Search,
  Calendar,
  Filter,
  Eye,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  FileText,
  Clock,
  User,
  Activity,
  Layers,
  X,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  FileCheck,
  Landmark,
  CreditCard,
  Wallet,
  Settings,
  Receipt,
  Building2,
  ScrollText,
  CornerDownRight
} from 'lucide-react'

import { API_BASE_URL } from '../config/api'

interface ActivityLogItem {
  id: number
  username: string
  userDisplayName: string
  moduleKey: string
  pageKey: string
  actionType: string
  description: string
  recordId: string | null
  /** İşlemin TETİKLEDİKLERİ. JSON: {"effects":["…"]}. Eski kayıtlarda null. */
  detailsJson: string | null
  /** Aynı kullanıcı işleminden doğan satırların ortak kimliği. Eski kayıtlarda null. */
  correlationId: string | null
  createTime: string
}

/**
 * Kaydın "ne tetiklendi" listesi.
 *
 * Sunucu bunu `detailsJson` içinde `{"effects":[...]}` olarak yazıyor. Eski kayıtlarda alan
 * boş — o satırlar işlem tetiklenenleri hesaplanmadan önce yazıldı, listenin boş olması
 * "hiçbir şey tetiklenmedi" DEMEK DEĞİL. Ekranda ikisi ayrı gösteriliyor.
 */
const parseEffects = (detailsJson: string | null): string[] => {
  if (!detailsJson) return []
  try {
    const parsed = JSON.parse(detailsJson)
    const list = parsed?.effects
    return Array.isArray(list) ? list.filter((x: unknown) => typeof x === 'string' && x.trim()) : []
  } catch {
    return []
  }
}

interface ActivityLogsResponse {
  items: ActivityLogItem[]
  total: number
  page: number
  pageSize: number
}

interface ModuleTab {
  key: string
  label: string
  icon: React.ReactNode
  color: string
  bgColor: string
  borderColor: string
}

const MODULE_TABS: ModuleTab[] = [
  {
    key: '',
    label: 'Tümü',
    icon: <Activity className="w-4 h-4" />,
    color: 'text-slate-700',
    bgColor: 'bg-slate-50',
    borderColor: 'border-slate-300'
  },
  {
    key: 'fatura',
    label: 'Fatura İşlemleri',
    icon: <FileCheck className="w-4 h-4" />,
    color: 'text-indigo-700',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-300'
  },
  {
    key: 'kasa',
    label: 'Kasa İşlemleri',
    icon: <Wallet className="w-4 h-4" />,
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-300'
  },
  {
    key: 'banka',
    label: 'Banka İşlemleri',
    icon: <Landmark className="w-4 h-4" />,
    color: 'text-sky-700',
    bgColor: 'bg-sky-50',
    borderColor: 'border-sky-300'
  },
  {
    key: 'cekSenet',
    label: 'Çek / Senet',
    icon: <CreditCard className="w-4 h-4" />,
    color: 'text-violet-700',
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-300'
  },
  {
    key: 'ayarlar',
    label: 'Ayarlar',
    icon: <Settings className="w-4 h-4" />,
    color: 'text-amber-700',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-300'
  }
]

const PAGE_LABELS: Record<string, string> = {
  // fatura module
  'siparis': 'Sipariş',
  'satisFatura': 'Satış Faturası',
  'faturaDokum': 'Fatura Dökümü',
  'faturaTakip': 'Fatura Takip',
  'musteriTeklifi': 'Müşteri Teklifi',
  'proforma': 'Proforma Fatura',
  'cariTeklifleri': 'Cari Müşteri Teklifi',
  'bayiTeklifleri': 'Cari Proforma',
  'etiketFiyatli': 'Etiket Basım Fiyatlı',
  'etiketFiyatsiz': 'Etiket Basım Fiyatsız',
  'magaza': 'Mağaza Sipariş',
  'magazaSiparis': 'Mağaza Sipariş',
  'alis': 'Alış Siparişleri',
  'alisTermin': 'Termin',
  'depoTransfer': 'Depo Transfer',
  'stokHareket': 'Stok Hareket Dökümü',
  'depoStock': 'Depo Stok Durumu',
  'irsaliye': 'Konsinye Belgesi',
  'termin': 'Termin',
  // kasa module
  'kasalarim': 'Kasa Hesapları',
  'kasaIslemleri': 'Kasa Hareketi',
  'kasaGirisCikis': 'Kasa Giriş/Çıkış',
  'kasalarArasiTransfer': 'Kasalar Arası Transfer',
  'virmanListesi': 'Virman',
  // banka module
  'bankaHesapTanim': 'Banka Hesap Tanımı',
  'bankaIslemleri': 'Banka Hareketi',
  'bankaHavaleEft': 'Banka Havale/EFT',
  // cekSenet module
  'musteriCeki': 'Müşteri Çeki',
  'debtCheck': 'Borç Çeki',
  'debtNote': 'Borç Senedi',
  // reports module
  'cariEkstre': 'Cari Ekstre',
  'cariBorcAlacak': 'Cari Borç Alacak',
  'yaslandirma': 'Yaşlandırma',
  'cariSatisRaporu': 'Cari Satış Raporu',
  'bankaRaporlari': 'Banka Raporları',
  'kasaRaporlari': 'Kasa Raporları',
  'virmanRaporlari': 'Virman Raporları',
  'urunSatisRaporuDetayli': 'Ürün Satış Raporu Detaylı',
  'urunSatisRaporuAylik': 'Ürün Satış Raporu (Aylık)',
  'siparisRaporu': 'Sipariş Raporu',
  'aktifSepetRaporu': 'Aktif Sepet Raporu',
  'limitRiskSatisRaporu': 'Limit Risk Satış Raporu',
  'muhasebeStokGirisCikisRaporu': 'Stok Giriş/Çıkış Raporu',
  'accountingSalesReport': 'Muhasebe Satış Raporu',
  'satisPazarlamaRaporu': 'Satış Pazarlama Raporu',
  // ayarlar module
  'calisan': 'Çalışanlar',
  'cariEkle': 'Cari Ekle',
  'tedarikciEkle': 'Tedarikçi Ekle',
  'urunYonetimi': 'Ürün Yönetimi',
  'atiliFiyatlandirma': 'Fiyat Atama',
  'kategoriYonetimi': 'Kategori Yönetimi',
  'fiyatKategorileri': 'Fiyat Kategorileri',
  'silinenKayitlar': 'Silinen Kayıtlar',
  'installmentRules': 'Taksit Bilgileri',
  'bildirimler': 'Bildirimler',
  'userActivities': 'Kullanıcı Hareketleri',
  'kullanicilar': 'Kullanıcılar',
  'roller': 'Roller',
  'ayarlar': 'Sistem Ayarları',
  // 2026-08-20'de kayıt kapsamına alınan sayfalar. Anahtarı burada olmayan kayıt ham
  // `pageKey`ini gösterir (ör. "posHesapAyar") — bozuk değil ama okunaksızdır.
  'depolar': 'Depolar',
  'rolYetkileri': 'Rol Yetkileri',
  'genelAyarlar': 'Genel Ayarlar',
  'kampanya': 'Kampanya Tanım',
  'plasiyerler': 'Plasiyerler',
  'numarator': 'Numaratör',
  'posHesapAyar': 'POS Hesap Ayarları',
  'sanalPosTanim': 'Sanal POS Tanımı',
  'servisKatalogu': 'Servis Kataloğu',
  'maliDonemler': 'Mali Dönemler',
  'garantiKayitlari': 'Garanti Kayıtları',
  'garantiDegisim': 'Garanti Değişim',
  'krediler': 'Krediler',
  'bankaMasraflari': 'Banka Masrafları',
  'topluFiyatAtama': 'Toplu Fiyat Atama',
  'garantiDeposu': 'Garanti Deposu',
  'posAktarim': 'POS Aktarım',
  'satis': 'Satış Faturaları',
  'depoBakiye': 'Depo Bakiye Listesi',
  // 2026-09-03'te kayıt kapsamına alınan yerler. `sepet` sepet silmelerini, `digerIslemler`
  // ise ana kayda dokunmayan (yalnız yan tabloyu değiştiren) işlemlerin tanınmayan türlerini
  // toplar — o satır kaybolmaz, yalnız hangi ekrana ait olduğu bilinmiyordur.
  'sepet': 'Sepet',
  'montaj': 'Montaj',
  'sanalPosIslemleri': 'Sanal POS İşlemleri',
  'digerIslemler': 'Diğer İşlemler',
}

const MODULE_LABELS: Record<string, string> = {
  'fatura': 'Fatura İşlemleri',
  'kasa': 'Kasa İşlemleri',
  'banka': 'Banka İşlemleri',
  'cekSenet': 'Çek / Senet',
  'ayarlar': 'Ayarlar',
  'system': 'Sistem',
}

export default function UserActivitiesPage() {
  const [loading, setLoading] = useState(false)
  const [logs, setLogs] = useState<ActivityLogItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)

  // Filter states
  const [query, setQuery] = useState('')
  const [actionType, setActionType] = useState('')
  const [moduleKey, setModuleKey] = useState('')
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })
  const [toDate, setToDate] = useState(() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })

  // Distinct action types
  const [actionTypes, setActionTypes] = useState<string[]>([])

  // Modal detail state
  const [selectedLog, setSelectedLog] = useState<ActivityLogItem | null>(null)

  // Delete range modal states
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteFromDate, setDeleteFromDate] = useState('')
  const [deleteToDate, setDeleteToDate] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmStep, setDeleteConfirmStep] = useState(false)
  const [deleteSuccessMessage, setDeleteSuccessMessage] = useState('')

  const buildHeaders = () => {
    const token = localStorage.getItem('accessToken')
    const tenantCode = localStorage.getItem('tenantCode')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (token) headers['Authorization'] = `Bearer ${token}`
    if (tenantCode) headers['X-Tenant-Code'] = tenantCode
    return headers
  }

  const loadActionTypes = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/useractivities/action-types`, {
        headers: buildHeaders()
      })
      if (res.ok) {
        const json = await res.json()
        if (json.success && json.data) {
          setActionTypes(json.data)
        }
      }
    } catch (err) {
      console.error('Failed to load action types:', err)
    }
  }

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('page', String(page))
      params.append('pageSize', String(pageSize))

      if (query.trim()) params.append('query', query.trim())
      if (actionType) params.append('actionType', actionType)
      if (moduleKey) params.append('moduleKey', moduleKey)
      if (fromDate) params.append('fromDate', fromDate)
      if (toDate) params.append('toDate', toDate)

      const res = await fetch(`${API_BASE_URL}/api/useractivities?${params.toString()}`, {
        headers: buildHeaders()
      })

      if (res.ok) {
        const json = await res.json()
        if (json.success && json.data) {
          const respData = json.data as ActivityLogsResponse
          setLogs(respData.items)
          setTotal(respData.total)
        }
      }
    } catch (err) {
      console.error('Failed to load activity logs:', err)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, query, actionType, moduleKey, fromDate, toDate])

  useEffect(() => {
    void loadActionTypes()
  }, [])

  useEffect(() => {
    void loadLogs()
  }, [loadLogs])

  const handleResetFilters = () => {
    setQuery('')
    setActionType('')
    setFromDate('')
    setToDate('')
    setPage(1)
  }

  const closeDeleteModal = () => {
    setShowDeleteModal(false)
    setDeleteConfirmStep(false)
    setDeleteSuccessMessage('')
    setDeleteFromDate('')
    setDeleteToDate('')
  }

  const handleDeleteRange = async () => {
    if (!deleteFromDate && !deleteToDate) {
      return
    }

    if (!deleteConfirmStep) {
      setDeleteConfirmStep(true)
      return
    }

    setDeleting(true)
    try {
      const params = new URLSearchParams()
      if (deleteFromDate) params.append('fromDate', deleteFromDate)
      if (deleteToDate) params.append('toDate', deleteToDate)

      const res = await fetch(`${API_BASE_URL}/api/useractivities/clear-range?${params.toString()}`, {
        method: 'DELETE',
        headers: buildHeaders()
      })

      if (res.ok) {
        const json = await res.json()
        if (json.success) {
          setDeleteSuccessMessage(json.message || 'Kayıtlar başarıyla silindi.')
          setPage(1)
          void loadLogs()
        } else {
          setDeleteSuccessMessage(json.message || 'Silme işlemi başarısız oldu.')
        }
      } else {
        const errJson = await res.json().catch(() => null)
        setDeleteSuccessMessage(errJson?.message || 'Silme işlemi sırasında bir hata oluştu.')
      }
    } catch (err) {
      console.error('Failed to delete logs:', err)
      setDeleteSuccessMessage('Silme işlemi başarısız oldu.')
    } finally {
      setDeleting(false)
    }
  }

  const formatDateTime = (isoString: string) => {
    try {
      const d = new Date(isoString)
      return d.toLocaleString('tr-TR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    } catch {
      return isoString
    }
  }

  const getModuleLabel = (key: string) => {
    return MODULE_LABELS[key] ?? key
  }

  /**
   * Sayfa adı YALNIZ `pageKey`ten okunur.
   *
   * Burada açıklama metnini koklayan bir kanca vardı: açıklamada "Cari " geçiyorsa sayfa
   * koşulsuz "Cari Ekle" yazılıyordu. Her satış faturasının açıklamasında "Cari Kod: …"
   * geçtiği için FATURA KAYITLARI "Cari Ekle" sayfasında yapılmış gibi görünüyordu —
   * yani kaydın en çok işe yarayan alanı, nerede yapıldığı bilgisi, yanlıştı.
   *
   * Kancanın gerekçesi de kalmamış: 'cariEkle' ve 'tedarikciEkle' zaten `PAGE_LABELS`
   * içinde ve sunucu doğru anahtarı gönderiyor.
   */
  const getPageLabel = (pageKey: string): string => PAGE_LABELS[pageKey] ?? pageKey

  const getActiveTab = () => MODULE_TABS.find(t => t.key === moduleKey) ?? MODULE_TABS[0]

  const getActionTypeBadge = (type: string) => {
    switch (type) {
      case 'Silme':
        return 'bg-rose-50 text-rose-700 border border-rose-100'
      case 'Oluşturma':
        return 'bg-emerald-50 text-emerald-700 border border-emerald-100'
      case 'Aktarma':
        return 'bg-indigo-50 text-indigo-700 border border-indigo-100'
      case 'Ödeme':
        return 'bg-sky-50 text-sky-700 border border-sky-100'
      default:
        return 'bg-amber-50 text-amber-700 border border-amber-100'
    }
  }

  const getModuleIcon = (key: string) => {
    switch (key) {
      case 'fatura': return <FileCheck className="w-3.5 h-3.5 text-indigo-500" />
      case 'kasa': return <Wallet className="w-3.5 h-3.5 text-emerald-500" />
      case 'banka': return <Landmark className="w-3.5 h-3.5 text-sky-500" />
      case 'cekSenet': return <CreditCard className="w-3.5 h-3.5 text-violet-500" />
      case 'ayarlar': return <Settings className="w-3.5 h-3.5 text-amber-500" />
      default: return <Layers className="w-3.5 h-3.5 text-slate-400" />
    }
  }

  const totalPages = Math.ceil(total / pageSize) || 1
  const activeTab = getActiveTab()

  return (
    <div className="space-y-5">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2.5">
            <Activity className="w-5 h-5 text-indigo-600 animate-pulse" />
            Kullanıcı Hareketleri
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Kullanıcıların ERP sistemi içerisindeki silme, ekleme, güncelleme ve aktarım gibi kritik hareketlerini izleyin.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 hover:border-red-300 hover:bg-red-50 text-red-600 text-xs font-bold transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Veri Sil
          </button>
          <button
            type="button"
            onClick={() => void loadLogs()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-600 text-xs font-bold transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>
      </div>

      {/* Module Tabs (Header-level module filter) */}
      <div className="bg-white border border-slate-200/80 shadow-sm rounded-2xl overflow-hidden">
        <div className="flex items-center gap-1 px-4 pt-4 pb-0 overflow-x-auto">
          {MODULE_TABS.map(tab => {
            const isActive = moduleKey === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setModuleKey(tab.key)
                  setPage(1)
                }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-xs font-bold whitespace-nowrap transition-all border-b-2 -mb-px ${
                  isActive
                    ? `${tab.color} ${tab.bgColor} ${tab.borderColor} border-b-2`
                    : 'text-slate-500 bg-transparent border-transparent hover:text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            )
          })}
        </div>
        <div className="border-t border-slate-200/80" />

        {/* Sub-filters */}
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 uppercase tracking-wider">
            <Filter className="w-3.5 h-3.5 text-indigo-600" />
            Arama ve Filtreleme
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Query input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Kullanıcı, açıklama veya kayıt ID..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setPage(1)
                }}
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white text-slate-700"
              />
            </div>

            {/* Action Type filter */}
            <div>
              <select
                value={actionType}
                onChange={(e) => {
                  setActionType(e.target.value)
                  setPage(1)
                }}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white text-slate-700"
              >
                <option value="">Tüm İşlem Tipleri</option>
                {actionTypes.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {/* From Date */}
            <div className="relative">
              <Calendar className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value)
                  setPage(1)
                }}
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white text-slate-700"
              />
            </div>

            {/* To Date */}
            <div className="relative">
              <Calendar className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value)
                  setPage(1)
                }}
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 bg-white text-slate-700"
              />
            </div>
          </div>

          {(query || actionType || fromDate || toDate) && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-xs font-bold text-rose-600 hover:text-rose-700 transition-colors"
              >
                Alt Filtreleri Sıfırla
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Table Grid */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        {/* Active module indicator */}
        {moduleKey && (
          <div className={`px-5 py-2.5 border-b border-slate-100 flex items-center gap-2 ${activeTab.bgColor}`}>
            <span className={`text-xs font-bold ${activeTab.color} flex items-center gap-1.5`}>
              {activeTab.icon}
              {activeTab.label} modülü filtreleniyor
            </span>
            <button
              type="button"
              onClick={() => { setModuleKey(''); setPage(1) }}
              className="ml-auto text-[10px] text-slate-400 hover:text-slate-600 font-bold flex items-center gap-1 transition-colors"
            >
              <X className="w-3 h-3" />
              Filtreyi Kaldır
            </button>
          </div>
        )}

        {loading ? (
          <div className="p-16 text-center text-slate-400 flex flex-col items-center gap-3 justify-center">
            <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            <div className="text-xs font-medium">Kullanıcı hareketleri yükleniyor...</div>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-16 text-center text-slate-400 flex flex-col items-center gap-3 justify-center">
            <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center text-slate-300 border border-slate-100">
              <FileText className="w-6 h-6" />
            </div>
            <div className="text-sm font-semibold text-slate-600">Herhangi bir hareket kaydı bulunamadı.</div>
            <p className="text-xs max-w-xs leading-relaxed">
              Filtrelerinizi değiştirip tekrar deneyebilir veya yenile butonunu kullanabilirsiniz.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/50 text-slate-500 border-b border-slate-100 font-bold uppercase tracking-wider">
                  <th className="p-3.5 pl-5 w-44">Tarih</th>
                  <th className="p-3.5 w-52">Kullanıcı</th>
                  <th className="p-3.5 w-40">Modül / Sayfa</th>
                  <th className="p-3.5 w-32">İşlem Tipi</th>
                  <th className="p-3.5">İşlem Açıklaması</th>
                  <th className="p-3.5 pr-5 w-20 text-center">Detay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/60 text-slate-700">
                {logs.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/30 transition-colors group">
                    {/* Date */}
                    <td className="p-3.5 pl-5 font-medium text-slate-500">
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                        <span className="leading-tight">{formatDateTime(item.createTime)}</span>
                      </span>
                    </td>

                    {/* User */}
                    <td className="p-3.5 font-semibold text-slate-800">
                      <span className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-[10px] text-white font-black flex-shrink-0 shadow-sm">
                          {item.username.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-bold text-slate-800">{item.userDisplayName}</div>
                          <div className="text-[10px] text-slate-400 font-medium">{item.username}</div>
                        </div>
                      </span>
                    </td>

                    {/* Module / Page */}
                    <td className="p-3.5">
                      <span className="flex items-start gap-1.5">
                        {getModuleIcon(item.moduleKey)}
                        <div>
                          <div className="font-bold text-slate-600">{getModuleLabel(item.moduleKey)}</div>
                          <div className="text-[10px] text-indigo-600 font-semibold mt-0.5">{getPageLabel(item.pageKey)}</div>
                        </div>
                      </span>
                    </td>

                    {/* Action Type */}
                    <td className="p-3.5">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold ${getActionTypeBadge(item.actionType)}`}>
                        {item.actionType}
                      </span>
                    </td>

                    {/* Description */}
                    <td className="p-3.5 pr-4 max-w-md font-medium text-slate-600 break-words leading-relaxed">
                      {item.description}
                      {/*
                        Tetiklenenlerin İLK İKİSİ satırda gösterilir. Tamamı burada olsaydı
                        tek bir fatura silme onlarca satır kaplardı; hiç gösterilmeseydi de
                        detayı açmadan "stok geri döndü mü" görülemezdi.
                      */}
                      {parseEffects(item.detailsJson).length > 0 && (
                        <div className="mt-1.5 space-y-0.5">
                          {parseEffects(item.detailsJson).slice(0, 2).map((eff, i) => (
                            <div key={i} className="flex items-start gap-1 text-[11px] text-emerald-700">
                              <CornerDownRight className="w-3 h-3 mt-0.5 flex-shrink-0 text-emerald-500" />
                              <span className="font-semibold">{eff}</span>
                            </div>
                          ))}
                          {parseEffects(item.detailsJson).length > 2 && (
                            <button
                              type="button"
                              onClick={() => setSelectedLog(item)}
                              className="ml-4 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:underline"
                            >
                              +{parseEffects(item.detailsJson).length - 2} sonuç daha
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Actions button */}
                    <td className="p-3.5 pr-5 text-center">
                      <button
                        type="button"
                        onClick={() => setSelectedLog(item)}
                        className="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 text-slate-400 font-bold transition-all text-[10px] opacity-0 group-hover:opacity-100"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Detay
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {logs.length > 0 && (
          <div className="p-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/30">
            <div className="text-xs text-slate-500 font-semibold">
              Toplam <span className="font-bold text-slate-700">{total}</span> kayıt içinden, sayfa <span className="font-bold text-slate-700">{page}</span> / <span className="font-bold text-slate-700">{totalPages}</span> gösteriliyor.
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="p-1.5 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-white text-slate-500 disabled:opacity-50 disabled:pointer-events-none transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="p-1.5 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-white text-slate-500 disabled:opacity-50 disabled:pointer-events-none transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Details Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="relative bg-white rounded-3xl max-w-xl w-full border border-slate-200 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                  selectedLog.moduleKey === 'fatura' ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' :
                  selectedLog.moduleKey === 'kasa' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                  selectedLog.moduleKey === 'banka' ? 'bg-sky-50 text-sky-600 border border-sky-100' :
                  selectedLog.moduleKey === 'cekSenet' ? 'bg-violet-50 text-violet-600 border border-violet-100' :
                  'bg-amber-50 text-amber-600 border border-amber-100'
                }`}>
                  {getModuleIcon(selectedLog.moduleKey)}
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">Hareket Kaydı Detayı</h3>
                  <div className="text-[10px] text-slate-400 font-semibold">Kayıt ID: #{selectedLog.id}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="block text-slate-400 font-semibold mb-0.5">Kullanıcı</span>
                  <span className="block font-bold text-slate-800">{selectedLog.userDisplayName}</span>
                  <span className="block text-[10px] text-slate-400">@{selectedLog.username}</span>
                </div>
                <div>
                  <span className="block text-slate-400 font-semibold mb-0.5">Tarih / Saat</span>
                  <span className="block font-bold text-slate-800">{formatDateTime(selectedLog.createTime)}</span>
                </div>
                <div>
                  <span className="block text-slate-400 font-semibold mb-0.5">Modül</span>
                  <span className="flex items-center gap-1.5 font-bold text-slate-800 mt-0.5">
                    {getModuleIcon(selectedLog.moduleKey)}
                    {getModuleLabel(selectedLog.moduleKey)}
                  </span>
                </div>
                <div>
                  <span className="block text-slate-400 font-semibold mb-0.5">Sayfa</span>
                  <span className="block font-bold text-slate-800">{getPageLabel(selectedLog.pageKey)}</span>
                </div>
                <div className="col-span-2">
                  <span className="block text-slate-400 font-semibold mb-1">İşlem Tipi</span>
                  <span className={`inline-flex items-center px-3 py-1 rounded-full text-[11px] font-bold ${getActionTypeBadge(selectedLog.actionType)}`}>
                    {selectedLog.actionType}
                  </span>
                </div>
              </div>

              <div className="pt-1">
                <span className="block text-slate-400 text-xs font-semibold mb-2">İşlem Açıklaması</span>
                <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-slate-700 text-sm font-semibold leading-relaxed">
                  {selectedLog.description}
                </div>
              </div>

              <div className="pt-1">
                <span className="block text-slate-400 text-xs font-semibold mb-2">Bu İşlemin Tetiklediği Sonuçlar</span>
                {parseEffects(selectedLog.detailsJson).length > 0 ? (
                  <ul className="space-y-1.5">
                    {parseEffects(selectedLog.detailsJson).map((eff, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 p-2.5 bg-emerald-50/60 border border-emerald-100 rounded-xl text-[13px] text-emerald-900 font-semibold"
                      >
                        <CornerDownRight className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-emerald-500" />
                        <span>{eff}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  /*
                    İki ayrı durum, iki ayrı cümle. "Tetiklenen yok" ile "bu kayıt tetiklenenler
                    yazılmaya başlamadan önce oluştu" karıştırılırsa eski bir fatura silme
                    kaydına bakan kişi "demek stok geri dönmemiş" diye yanlış sonuç çıkarır.
                  */
                  <div className="p-3 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-[12px] text-slate-500 font-semibold">
                    {selectedLog.correlationId
                      ? 'Bu işlem başka bir kaydı etkilemedi.'
                      : 'Bu kayıt, tetiklenen sonuçlar yazılmaya başlamadan önce oluşturulmuş.'}
                  </div>
                )}
              </div>

              {selectedLog.recordId && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 font-semibold">Dahili Kayıt ID:</span>
                  <code className="text-[10px] font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-600">{selectedLog.recordId}</code>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 flex justify-end bg-slate-50/30">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm shadow-slate-900/10"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Range Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="relative bg-white rounded-3xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-full border flex items-center justify-center ${
                  deleteSuccessMessage
                    ? 'bg-emerald-50 border-emerald-100 text-emerald-500'
                    : 'bg-red-50 border-red-100 text-red-500'
                }`}>
                  {deleteSuccessMessage ? <CheckCircle2 className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">
                    {deleteSuccessMessage ? 'İşlem Başarılı' : deleteConfirmStep ? 'Silme İşlemini Onayla' : 'Hareket Kayıtlarını Sil'}
                  </h3>
                  <div className="text-[10px] text-slate-400 font-semibold">
                    {deleteSuccessMessage ? 'Sonuç Raporu' : deleteConfirmStep ? 'Son onay adımı' : 'Tarih aralığı belirterek toplu temizlik yapın'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={closeDeleteModal}
                className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              {deleteSuccessMessage ? (
                <div className="space-y-4 text-center py-2">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 mx-auto">
                    <CheckCircle2 className="w-6 h-6 animate-pulse" />
                  </div>
                  <h4 className="font-bold text-slate-800 text-sm">İşlem Tamamlandı</h4>
                  <p className="text-xs text-slate-600 font-semibold leading-relaxed">
                    {deleteSuccessMessage}
                  </p>
                </div>
              ) : deleteConfirmStep ? (
                <div className="space-y-4 text-center py-2">
                  <div className="w-12 h-12 rounded-full bg-red-50 border border-red-100 flex items-center justify-center text-red-600 mx-auto">
                    <AlertTriangle className="w-6 h-6 animate-bounce" />
                  </div>
                  <h4 className="font-bold text-slate-800 text-sm">Emin misiniz?</h4>
                  <p className="text-xs text-slate-600 font-medium leading-relaxed">
                    Seçtiğiniz tarih aralığındaki tüm kullanıcı hareket kayıtları kalıcı olarak silinecektir. Bu işlem geri alınamaz. Onaylıyor musunuz?
                  </p>
                  {deleteFromDate || deleteToDate ? (
                    <div className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-bold text-slate-500 inline-block">
                      Seçilen Aralık:{' '}
                      <span className="text-slate-700">
                        {deleteFromDate ? new Date(deleteFromDate).toLocaleDateString('tr-TR') : 'Başlangıçtan'} - ...
                        {deleteToDate ? new Date(deleteToDate).toLocaleDateString('tr-TR') : 'Bugüne'}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="bg-amber-50 border border-amber-200/60 rounded-xl p-3 text-amber-800 text-[11px] font-semibold leading-relaxed">
                    Uyarı: Belirttiğiniz tarih aralığına denk gelen tüm kullanıcı etkinlik kayıtları sistemden kalıcı olarak temizlenecektir. Bu işlem geri alınamaz.
                  </div>

                  <div className="space-y-3">
                    {/* Start Date */}
                    <div>
                      <label className="block text-slate-500 text-xs font-bold mb-1">Başlangıç Tarihi</label>
                      <div className="relative">
                        <Calendar className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
                        <input
                          type="date"
                          value={deleteFromDate}
                          onChange={(e) => setDeleteFromDate(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 bg-white text-slate-700 font-bold"
                        />
                      </div>
                    </div>

                    {/* End Date */}
                    <div>
                      <label className="block text-slate-500 text-xs font-bold mb-1">Bitiş Tarihi</label>
                      <div className="relative">
                        <Calendar className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
                        <input
                          type="date"
                          value={deleteToDate}
                          onChange={(e) => setDeleteToDate(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 bg-white text-slate-700 font-bold"
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50/30">
              {deleteSuccessMessage ? (
                <button
                  type="button"
                  onClick={closeDeleteModal}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm shadow-slate-900/10"
                >
                  Kapat
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (deleteConfirmStep) {
                        setDeleteConfirmStep(false)
                      } else {
                        setShowDeleteModal(false)
                      }
                    }}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all"
                  >
                    {deleteConfirmStep ? 'Geri Dön' : 'Vazgeç'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteRange()}
                    disabled={deleting || (!deleteFromDate && !deleteToDate)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm shadow-red-600/10 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {deleting && <RefreshCw className="w-3 h-3 animate-spin" />}
                    {deleteConfirmStep ? 'Evet, Onayla ve Sil' : 'Silme İşlemini Başlat'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
