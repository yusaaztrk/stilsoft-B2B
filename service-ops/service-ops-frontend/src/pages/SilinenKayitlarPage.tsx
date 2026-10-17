import { useState, useEffect } from 'react'
import { apiJson } from '../api/client'
import { API_BASE_URL } from '../config'
import { getAccessToken } from '../auth/storage'
import { toast } from 'sonner'
import {
  Trash2,
  RefreshCw, 
  ChevronLeft, 
  ChevronRight, 
  Loader2, 
  AlertCircle,
  User,
  Calendar,
  Layers
} from 'lucide-react'

interface DeletedRecord {
  id: string
  serviceNumber: string
  customerName: string
  productName: string
  createdAt: string
  deletedAt: string
  deletedBy: string
  type: string
  priority: string
  status: string
}

type TabType = 'saha' | 'atolye' | 'montaj'

export default function SilinenKayitlarPage() {
  const [activeTab, setActiveTab] = useState<TabType>('saha')
  const [records, setRecords] = useState<DeletedRecord[]>([])
  const [page, setPage] = useState<number>(1)
  const [pageSize] = useState<number>(10)
  const [totalCount, setTotalCount] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null) // holds restoring record ID

  const fetchDeletedRecords = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiJson<{ items: DeletedRecord[]; totalCount: number; page: number; pageSize: number }>(
        `/api/servicerecords/deleted?type=${activeTab}&page=${page}&pageSize=${pageSize}`
      )
      setRecords(data.items || [])
      setTotalCount(data.totalCount || 0)
    } catch (err: any) {
      setError(err?.message || 'Silinen kayıtlar alınamadı.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDeletedRecords()
  }, [activeTab, page])

  const handleRestore = async (id: string, recordNo: string) => {
    const confirm = window.confirm(`${recordNo} numaralı kaydı geri yüklemek istediğinize emin misiniz?`)
    if (!confirm) return

    setActionLoading(id)
    try {
      const token = getAccessToken()
      const res = await fetch(`${API_BASE_URL}/api/servicerecords/${id}/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : undefined)
        }
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(txt || 'Geri yükleme başarısız.')
      }
      toast.success('Kayıt başarıyla geri yüklendi.')
      // If we are on page > 1 and this was the last item, go back a page
      if (records.length === 1 && page > 1) {
        setPage(prev => prev - 1)
      } else {
        fetchDeletedRecords()
      }
    } catch (err: any) {
      toast.error(err.message || 'Geri yükleme hatası oluştu.')
    } finally {
      setActionLoading(null)
    }
  }

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-gray-200 dark:border-gray-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Trash2 className="w-7 h-7 text-red-500" />
            Silinen Kayıtlar Arşivi
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Sistemden silinmiş olan saha arıza, atölye arıza ve montaj kayıtlarını buradan inceleyebilir ve geri yükleyebilirsiniz.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800">
        <button
          onClick={() => handleTabChange('saha')}
          className={`py-3 px-6 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'saha'
              ? 'border-red-500 text-red-600 dark:text-red-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Layers className="w-4 h-4" />
          Saha Ürün Arıza
        </button>
        <button
          onClick={() => handleTabChange('atolye')}
          className={`py-3 px-6 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'atolye'
              ? 'border-red-500 text-red-600 dark:text-red-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Layers className="w-4 h-4" />
          Atölye Ürün Arıza
        </button>
        <button
          onClick={() => handleTabChange('montaj')}
          className={`py-3 px-6 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'montaj'
              ? 'border-red-500 text-red-600 dark:text-red-400'
              : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Layers className="w-4 h-4" />
          Montaj Kayıtları
        </button>
      </div>

      {/* Main Content Area */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 rounded-xl flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Hata Oluştu</div>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm space-y-3">
          <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
          <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Veriler yükleniyor...</p>
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm">
          <Trash2 className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200">Silinmiş Kayıt Bulunmuyor</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
            Bu kategoride silinmiş herhangi bir kayıt bulunmamaktadır.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse mobile-stack">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  <th className="py-4 px-6">Fiş/Kayıt No</th>
                  <th className="py-4 px-6">Müşteri</th>
                  <th className="py-4 px-6">Ürün</th>
                  <th className="py-4 px-6">Silinme Tarihi</th>
                  <th className="py-4 px-6">Silen Kullanıcı</th>
                  <th className="py-4 px-6 text-right">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800 text-sm text-gray-700 dark:text-gray-300">
                {records.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors">
                    <td data-label="Fiş/Kayıt No" className="py-4 px-6 font-semibold text-gray-900 dark:text-white">
                      {item.serviceNumber || 'N/A'}
                    </td>
                    <td data-label="Müşteri" className="py-4 px-6 font-medium">
                      {item.customerName || 'N/A'}
                    </td>
                    <td data-label="Ürün" className="py-4 px-6">
                      {item.productName || 'N/A'}
                    </td>
                    <td data-mobile-hide data-label="Silinme Tarihi" className="py-4 px-6 text-gray-500 dark:text-gray-400">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        {item.deletedAt ? new Date(item.deletedAt).toLocaleString('tr-TR') : 'N/A'}
                      </div>
                    </td>
                    <td data-mobile-hide data-label="Silen Kullanıcı" className="py-4 px-6 text-gray-900 dark:text-white font-medium">
                      <div className="flex items-center gap-1.5">
                        <User className="w-4 h-4 text-red-400" />
                        {item.deletedBy || 'Bilinmeyen'}
                      </div>
                    </td>
                    <td data-mobile-hide data-label="İşlemler" className="py-4 px-6 text-right">
                      <button
                        onClick={() => handleRestore(item.id, item.serviceNumber)}
                        disabled={actionLoading === item.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 text-green-700 dark:text-green-400 text-xs font-semibold rounded-lg hover:bg-green-100 dark:hover:bg-green-900/50 disabled:opacity-50 transition-all cursor-pointer"
                      >
                        {actionLoading === item.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        Geri Yükle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-6 py-4 bg-gray-50 dark:bg-gray-800/30 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Toplam <span className="font-semibold text-gray-800 dark:text-gray-200">{totalCount}</span> kayıttan{' '}
                <span className="font-semibold text-gray-800 dark:text-gray-200">
                  {Math.min(totalCount, (page - 1) * pageSize + 1)}
                </span>{' '}
                -{' '}
                <span className="font-semibold text-gray-800 dark:text-gray-200">
                  {Math.min(totalCount, page * pageSize)}
                </span>{' '}
                arası gösteriliyor.
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 px-2">
                  Sayfa {page} / {totalPages}
                </div>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
