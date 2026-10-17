import React, { useState, useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, RefreshCw, AlertCircle } from 'lucide-react'
import { apiJson } from '../api/client'

export type ActivityCategory = 'large' | 'small' | 'installation' | 'cargo' | 'all'

interface CustomerActivityDrawerProps {
  customerId: string
  customerName: string
  category: ActivityCategory
  onClose: () => void
}

interface ActivityDetail {
  id: string
  referenceNumber: string
  activityType: string
  status: string
  statusLabel: string
  productName: string
  date: string
}

interface DetailResponse {
  items: ActivityDetail[]
  totalCount: number
  page: number
  pageSize: number
}

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  large: 'Büyük Ürün Arıza Geçmişi',
  small: 'Küçük Ürün Arıza Geçmişi',
  installation: 'Montaj Kabul Geçmişi',
  cargo: 'Kargo / Sevkiyat Geçmişi',
  all: 'Tüm Servis Operasyon Geçmişi'
}

export default function CustomerActivityDrawer({ customerId, customerName, category, onClose }: CustomerActivityDrawerProps) {
  const [items, setItems] = useState<ActivityDetail[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDetails = useCallback(async (signal?: AbortSignal) => {
    try {
      setIsLoading(true)
      let endpoint = `/api/service-ops/customers/${customerId}/all-services`
      if (category === 'large') endpoint = `/api/service-ops/customers/${customerId}/large-product-services`
      else if (category === 'small') endpoint = `/api/service-ops/customers/${customerId}/small-product-services`
      else if (category === 'installation') endpoint = `/api/service-ops/customers/${customerId}/installations`
      else if (category === 'cargo') endpoint = `/api/service-ops/customers/${customerId}/cargo`

      const params = new URLSearchParams()
      params.append('page', page.toString())
      params.append('pageSize', pageSize.toString())

      const res = await apiJson<DetailResponse>(`${endpoint}?${params}`, { signal } as any)
      
      // If it is large/small/installation endpoints, the returned DTO items might have slightly different field names.
      // Let's normalize it to ActivityDetail format.
      const normalizedItems = (res.items || []).map((item: any) => ({
        id: item.id,
        referenceNumber: item.referenceNumber || item.serviceNumber || item.orderNumber || '',
        activityType: item.activityType || (category === 'large' ? 'Büyük Ürün Arıza' : category === 'small' ? 'Küçük Ürün Arıza' : category === 'installation' ? 'Montaj' : 'Kargo'),
        status: item.status || '',
        statusLabel: item.statusLabel || item.status || '',
        productName: item.productName || item.productDetails || '',
        date: item.date || item.createdAt || ''
      }))

      setItems(normalizedItems)
      setTotalCount(res.totalCount || 0)
      setError(null)
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Detaylar yüklenirken hata oluştu.')
      }
    } finally {
      setIsLoading(false)
    }
  }, [customerId, category, page])

  useEffect(() => {
    setPage(1)
  }, [category, customerId])

  useEffect(() => {
    const ac = new AbortController()
    fetchDetails(ac.signal)
    return () => ac.abort()
  }, [fetchDetails])

  const totalPages = Math.ceil(totalCount / pageSize)

  const getStatusBadgeStyle = (statusLabel: string) => {
    const label = statusLabel.toLowerCase()
    if (label.includes('teslim') || label.includes('tamam') || label.includes('hazır')) {
      return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
    }
    if (label.includes('iptal')) {
      return 'bg-rose-500/10 text-rose-700 border-rose-500/20'
    }
    if (label.includes('bekliyor') || label.includes('yeni') || label.includes('alındı')) {
      return 'bg-amber-500/10 text-amber-700 border-amber-500/20'
    }
    return 'bg-blue-500/10 text-blue-700 border-blue-500/20'
  }

  return (
    <>
      <div 
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[99] transition-opacity" 
        onClick={onClose} 
      />
      <div className="fixed right-0 top-0 bottom-0 pt-safe pb-safe w-full max-w-xl bg-white z-[100] shadow-2xl flex flex-col border-l border-slate-150 animate-slide-in">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-base font-bold text-slate-900">{CATEGORY_LABELS[category]}</h2>
            <div className="text-xs text-slate-500 mt-0.5">{customerName}</div>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 hover:bg-slate-200/60 rounded-lg text-slate-400 hover:text-slate-650 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-rose-600 bg-rose-500/5 rounded-xl border border-rose-500/10 px-4">
              <AlertCircle className="w-8 h-8 mb-2" />
              <div className="text-sm font-semibold">{error}</div>
              <button 
                onClick={() => fetchDetails()} 
                className="mt-3 px-3 py-1.5 bg-white border border-rose-250 hover:bg-rose-50 rounded-lg text-xs font-bold transition-colors"
              >
                Yeniden Dene
              </button>
            </div>
          ) : isLoading ? (
            <div className="flex flex-col items-center justify-center py-24 text-slate-500 gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-red-650" />
              <div className="text-xs font-semibold">Kayıtlar yükleniyor...</div>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 text-slate-400 text-sm bg-slate-50 rounded-xl border border-slate-100">
              Bu kategori için kayıt bulunamadı.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white shadow-sm">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-[10px] uppercase font-bold text-slate-550 border-b border-slate-200">
                      <th className="px-4 py-3">Fiş/Kargo No</th>
                      <th className="px-4 py-3">Kategori</th>
                      <th className="px-4 py-3">Ürün Detayı</th>
                      <th className="px-4 py-3">Durum</th>
                      <th className="px-4 py-3">Tarih</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {items.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">{item.referenceNumber}</td>
                        <td className="px-4 py-3 text-slate-550 whitespace-nowrap">{item.activityType}</td>
                        <td className="px-4 py-3 text-slate-650 max-w-[150px] truncate" title={item.productName}>
                          {item.productName || '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getStatusBadgeStyle(item.statusLabel)}`}>
                            {item.statusLabel}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                          {item.date ? new Date(item.date).toLocaleDateString('tr-TR') : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination Footer */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-slate-100 pt-4 text-xs text-slate-550 select-none">
                  <div>
                    Toplam <strong>{totalCount}</strong> kayıttan <strong>{((page - 1) * pageSize) + 1} - {Math.min(page * pageSize, totalCount)}</strong> arası
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="font-semibold text-slate-800 px-1">
                      {page} / {totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
