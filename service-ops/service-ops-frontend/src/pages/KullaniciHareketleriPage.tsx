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
  AlertTriangle,
  Settings,
  Package,
  Truck,
  Database
} from 'lucide-react'

import { apiJson } from '../api/client'

interface ActivityLogItem {
  id: string
  username: string
  userDisplayName: string
  moduleKey: string
  pageKey: string
  actionType: string
  description: string
  recordId: string | null
  detailsJson: string | null
  createTime: string
}

interface ActivityLogsPayload {
  items: ActivityLogItem[]
  total: number
  page: number
  pageSize: number
}

/**
 * Hareket defteri uçları gövdeyi `{ success, data }` ZARFIYLA döner (`UserActivitiesController`),
 * `apiJson` ise zarfı açmaz — ham gövdeyi verir. Sayfa zarfı hiç açmadan `data.items` /
 * `actionTypes.map` diyordu:
 *   - liste her zaman boş kalıyordu (`items` undefined → `[]`, toplam 0),
 *   - işlem tipi listesi bir DİZİ değil NESNE oluyordu ve `.map is not a function` hatası
 *     render sırasında patlayıp SAYFANIN TAMAMINI düşürüyordu.
 */
interface Envelope<T> {
  success?: boolean
  data?: T
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
    color: 'text-slate-700 dark:text-slate-300',
    bgColor: 'bg-slate-50 dark:bg-slate-900/30',
    borderColor: 'border-slate-300 dark:border-slate-700'
  },
  {
    key: 'servis',
    label: 'Servis & Montaj',
    icon: <Package className="w-4 h-4" />,
    color: 'text-red-700 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-950/20',
    borderColor: 'border-red-300 dark:border-red-900'
  },
  {
    key: 'kargo',
    label: 'Kargo Takip',
    icon: <Truck className="w-4 h-4" />,
    color: 'text-emerald-700 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/20',
    borderColor: 'border-emerald-300 dark:border-emerald-900'
  },
  {
    key: 'ayarlar',
    label: 'Sistem & Ayarlar',
    icon: <Settings className="w-4 h-4" />,
    color: 'text-amber-700 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-950/20',
    borderColor: 'border-amber-300 dark:border-amber-900'
  }
]

const PAGE_LABELS: Record<string, string> = {
  'servisKabul': 'Servis Kabul',
  'montajKabul': 'Montaj Kabul',
  'kargoTakibi': 'Kargo Takibi',
  'teknisyenler': 'Teknisyen Yönetimi',
}

const MODULE_LABELS: Record<string, string> = {
  'servis': 'Servis & Montaj',
  'kargo': 'Kargo Takip',
  'ayarlar': 'Sistem & Ayarlar'
}

function toTurkishUpper(val: string) {
  return val
    .replace(/i/g, 'İ')
    .replace(/ı/g, 'I')
    .toUpperCase()
}

export default function KullaniciHareketleriPage() {
  const [logs, setLogs] = useState<ActivityLogItem[]>([])
  const [total, setTotal] = useState<number>(0)
  const [page, setPage] = useState<number>(1)
  const [pageSize] = useState<number>(10)
  const [loading, setLoading] = useState<boolean>(false)

  // Filters
  const [query, setQuery] = useState<string>('')
  const [actionType, setActionType] = useState<string>('')
  const [moduleKey, setModuleKey] = useState<string>('')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')

  // State lists
  const [actionTypes, setActionTypes] = useState<string[]>([])
  const [selectedLog, setSelectedLog] = useState<ActivityLogItem | null>(null)

  const loadActionTypes = async () => {
    try {
      const res = await apiJson<Envelope<string[]>>('/api/useractivities/action-types')
      // Dizi olduğu DOĞRULANARAK yazılır: bu değer doğrudan render içinde `.map`'leniyor,
      // beklenmedik bir gövde şekli yine tüm sayfayı düşürürdü.
      setActionTypes(Array.isArray(res?.data) ? res.data : [])
    } catch (err) {
      console.error('Failed to load action types:', err)
      setActionTypes([])
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

      const res = await apiJson<Envelope<ActivityLogsPayload>>(`/api/useractivities?${params.toString()}`)
      const payload = res?.data
      setLogs(Array.isArray(payload?.items) ? payload.items : [])
      setTotal(typeof payload?.total === 'number' ? payload.total : 0)
    } catch (err) {
      console.error('Failed to load activity logs:', err)
      setLogs([])
      setTotal(0)
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

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Database className="w-7 h-7 text-[#B91C1C]" />
            Kullanıcı Hareketleri
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Sistem genelinde kullanıcıların gerçekleştirdiği tüm ekleme, güncelleme, silme ve geri yükleme işlemlerini buradan inceleyebilirsiniz.
          </p>
        </div>
        <button
          onClick={() => { void loadLogs(); void loadActionTypes() }}
          className="self-start md:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-semibold rounded-lg shadow-sm transition-all cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Yenile
        </button>
      </div>

      {/* Module Tabs */}
      <div className="flex flex-wrap gap-2">
        {MODULE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setModuleKey(tab.key)
              setPage(1)
            }}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
              moduleKey === tab.key
                ? `${tab.bgColor} ${tab.borderColor} ${tab.color} scale-102 ring-2 ring-red-500/10`
                : 'bg-white hover:bg-gray-50 border-gray-200 text-gray-650'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters Card */}
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Arama</label>
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(toTurkishUpper(e.target.value))}
                placeholder="Kullanıcı, işlem veya açıklama..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
              />
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">İşlem Tipi</label>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="w-full px-2 py-1.5 bg-slate-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
            >
              <option value="">Tüm İşlemler</option>
              {actionTypes.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Başlangıç Tarihi</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-2 py-1.5 bg-slate-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Bitiş Tarihi</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-2 py-1.5 bg-slate-50 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#B91C1C]"
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={handleResetFilters}
              className="w-full py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              Filtreleri Temizle
            </button>
          </div>
        </div>
      </div>

      {/* Main Table area */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 bg-white border border-gray-250 rounded-2xl shadow-sm space-y-3">
          <span className="w-8 h-8 border-3 border-t-transparent border-[#B91C1C] rounded-full animate-spin"></span>
          <p className="text-sm text-gray-500 font-medium">Yükleniyor...</p>
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 bg-white border border-gray-250 rounded-2xl shadow-sm">
          <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-gray-800">Kayıt Bulunmuyor</h3>
          <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
            Belirtilen kriterlerde veya sistemde kayıtlı herhangi bir kullanıcı hareketi bulunmamaktadır.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse mobile-stack">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-150 text-xs font-bold text-gray-500 uppercase tracking-wider">
                  <th className="py-4 px-6">Kullanıcı</th>
                  <th className="py-4 px-6">Modül / Sayfa</th>
                  <th className="py-4 px-6">İşlem Tipi</th>
                  <th className="py-4 px-6">Açıklama</th>
                  <th className="py-4 px-6">Tarih</th>
                  <th className="py-4 px-6 text-right">Detay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs text-gray-700">
                {logs.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                    <td data-mobile-hide data-label="Kullanıcı" className="py-4 px-6 font-semibold text-gray-900">
                      <div className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5 text-[#B91C1C]/70" />
                        <div>
                          <div className="font-bold text-gray-900 text-xs">{item.userDisplayName}</div>
                          <div className="text-[10px] text-gray-400 font-mono">@{item.username}</div>
                        </div>
                      </div>
                    </td>
                    <td data-mobile-hide data-label="Modül / Sayfa" className="py-4 px-6">
                      <div className="flex items-center gap-1 text-[11px] text-gray-600">
                        <span className="font-semibold text-gray-800">{MODULE_LABELS[item.moduleKey] || item.moduleKey}</span>
                        <span className="text-gray-300">/</span>
                        <span className="text-gray-500">{PAGE_LABELS[item.pageKey] || item.pageKey}</span>
                      </div>
                    </td>
                    <td data-mobile-hide data-label="İşlem Tipi" className="py-4 px-6">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ${
                        item.actionType === 'CREATE' ? 'bg-blue-100 text-blue-700' :
                        item.actionType === 'UPDATE' ? 'bg-amber-105 text-amber-700' :
                        item.actionType === 'DELETE' ? 'bg-red-100 text-red-700' :
                        'bg-purple-100 text-purple-700'
                      }`}>
                        {item.actionType}
                      </span>
                    </td>
                    <td data-mobile-hide data-label="Açıklama" className="py-4 px-6 font-semibold text-gray-800 max-w-[280px] truncate">
                      {item.description}
                    </td>
                    <td data-mobile-hide data-label="Tarih" className="py-4 px-6 text-gray-500">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        {new Date(item.createTime).toLocaleString('tr-TR')}
                      </div>
                    </td>
                    <td data-mobile-hide data-label="Detay" className="py-4 px-6 text-right">
                      <button
                        onClick={() => setSelectedLog(item)}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-slate-50 border border-slate-200 hover:bg-slate-100 text-slate-700 text-[10px] font-bold rounded-lg cursor-pointer"
                      >
                        <Eye className="w-3 h-3" />
                        Göster
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-150 flex items-center justify-between">
              <div className="text-xs text-gray-500">
                Toplam <span className="font-semibold text-gray-800">{total}</span> hareketten{' '}
                <span className="font-semibold text-gray-800">
                  {Math.min(total, (page - 1) * pageSize + 1)}
                </span>{' '}
                -{' '}
                <span className="font-semibold text-gray-800">
                  {Math.min(total, page * pageSize)}
                </span>{' '}
                arası gösteriliyor.
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 border border-gray-200 bg-white rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="text-xs font-semibold text-gray-700 px-2">
                  Sayfa {page} / {totalPages}
                </div>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-2 border border-gray-200 bg-white rounded-lg text-gray-500 hover:bg-gray-50 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Log Details Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden font-sans border border-gray-100 animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-150 flex items-center justify-between">
              <h3 className="font-bold text-gray-800 text-sm uppercase tracking-wider">İşlem Günlüğü Detayı</h3>
              <button onClick={() => setSelectedLog(null)} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-150 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="block font-semibold text-gray-400">Kullanıcı Adı / Unvanı</span>
                  <span className="font-bold text-gray-800">{selectedLog.userDisplayName} (@{selectedLog.username})</span>
                </div>
                <div>
                  <span className="block font-semibold text-gray-400">İşlem Zamanı</span>
                  <span className="font-bold text-gray-800">{new Date(selectedLog.createTime).toLocaleString('tr-TR')}</span>
                </div>
                <div>
                  <span className="block font-semibold text-gray-400">İşlem Tipi</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold mt-0.5 ${
                    selectedLog.actionType === 'CREATE' ? 'bg-blue-100 text-blue-700' :
                    selectedLog.actionType === 'UPDATE' ? 'bg-amber-105 text-amber-700' :
                    selectedLog.actionType === 'DELETE' ? 'bg-red-100 text-red-700' :
                    'bg-purple-100 text-purple-700'
                  }`}>
                    {selectedLog.actionType}
                  </span>
                </div>
                <div>
                  <span className="block font-semibold text-gray-400">Referans Kayıt ID</span>
                  <span className="font-mono text-gray-800 break-all">{selectedLog.recordId || 'N/A'}</span>
                </div>
                <div>
                  <span className="block font-semibold text-gray-400">Modül</span>
                  <span className="font-semibold text-gray-800">{MODULE_LABELS[selectedLog.moduleKey] || selectedLog.moduleKey}</span>
                </div>
                <div>
                  <span className="block font-semibold text-gray-400">Sayfa</span>
                  <span className="font-semibold text-gray-800">{PAGE_LABELS[selectedLog.pageKey] || selectedLog.pageKey}</span>
                </div>
              </div>

              <div>
                <span className="block text-xs font-semibold text-gray-400 mb-1">İşlem Açıklaması</span>
                <div className="bg-slate-50 border border-slate-150 p-3 rounded-xl text-xs font-bold text-slate-800 leading-relaxed">
                  {selectedLog.description}
                </div>
              </div>

              {selectedLog.detailsJson && (
                <div>
                  <span className="block text-xs font-semibold text-gray-400 mb-1">İşlem Detayları (JSON)</span>
                  <pre className="bg-slate-900 text-slate-100 p-4 rounded-xl text-[10px] font-mono overflow-x-auto max-h-[220px]">
                    {(() => {
                      try {
                        const parsed = JSON.parse(selectedLog.detailsJson)
                        return JSON.stringify(parsed, null, 2)
                      } catch {
                        return selectedLog.detailsJson
                      }
                    })()}
                  </pre>
                </div>
              )}
            </div>
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-150 flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 bg-white border border-gray-250 rounded-xl text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm cursor-pointer"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
