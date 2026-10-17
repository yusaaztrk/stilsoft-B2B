import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken, readApiResponse } from '../lib/api'
import { useToast } from '../components/ui/ToastContext'

type SystemNotification = {
  id: string
  type: string
  title: string
  message: string
  isRead: boolean
  link: string
  createdAtUtc: string
}

function formatNotificationTime(dateStr: string) {
  try {
    const date = new Date(dateStr)
    const diffMs = Date.now() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    
    if (diffMins < 1) return 'Şimdi'
    if (diffMins < 60) return `${diffMins} dakika önce`
    if (diffHours < 24) return `${diffHours} saat önce`
    
    return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  } catch {
    return 'Şimdi'
  }
}

export function AdminNotificationsPage() {
  const { showToast } = useToast()
  const [notifications, setNotifications] = useState<SystemNotification[]>([])
  const [filter, setFilter] = useState('All')

  // Low Stock dynamic states
  const [minStock, setMinStock] = useState(10)
  const [lowStockProducts, setLowStockProducts] = useState<any[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)

  async function load() {
    try {
      const res = await fetch('/api/admin/modules/notifications', {
        headers: { Authorization: `Bearer ${getAdminToken()}` }
      })
      const json = await readApiResponse(res)
      if (res.ok && Array.isArray(json?.data)) {
        setNotifications(json.data)
      }
    } catch {
      showToast('Bildirimler yüklenemedi.', 'error')
    }
  }

  async function loadLowStock(limit: number) {
    try {
      setLoadingProducts(true)
      const res = await fetch(`/api/admin/products?minStock=${limit}`, {
        headers: { Authorization: `Bearer ${getAdminToken()}` }
      })
      const json = await readApiResponse(res)
      if (res.ok && Array.isArray(json?.data)) {
        setLowStockProducts(json.data)
      }
    } catch {
      // ignore
    } finally {
      setLoadingProducts(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (filter === 'Stock') {
      loadLowStock(minStock)
    }
  }, [filter, minStock])

  const handleMarkAsRead = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/modules/notifications/${id}/read`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${getAdminToken()}` }
      })
      if (res.ok) {
        load()
      }
    } catch {
      console.log('Error marking as read')
    }
  }

  const handleMarkAllAsRead = async () => {
    try {
      const res = await fetch('/api/admin/modules/notifications/read-all', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAdminToken()}` }
      })
      if (res.ok) {
        showToast('Tüm bildirimler okundu olarak işaretlendi.', 'success')
        load()
      }
    } catch {
      showToast('İşlem başarısız.', 'error')
    }
  }

  const filtered = notifications.filter(n => {
    if (filter === 'Unread') return !n.isRead
    if (filter === 'Order') return n.type === 'order'
    if (filter === 'Stock') return n.type === 'stock'
    if (filter === 'Review') return n.type === 'review'
    return true
  })

  const unreadCount = notifications.filter(n => !n.isRead).length

  const iconMap: Record<string, { name: string; color: string }> = {
    order: { name: 'shopping_bag', color: 'bg-blue-50 text-blue-700 border-blue-100' },
    stock: { name: 'warning', color: 'bg-amber-50 text-amber-700 border-amber-100' },
    review: { name: 'star', color: 'bg-yellow-50 text-yellow-700 border-yellow-100' },
    return: { name: 'assignment_return', color: 'bg-purple-50 text-purple-700 border-purple-100' },
    customer: { name: 'person_add', color: 'bg-green-50 text-green-700 border-green-100' },
    error: { name: 'error', color: 'bg-rose-50 text-rose-700 border-rose-100' },
  }

  return (
    <AdminLayout
      title="Bildirimler"
      subtitle="Siparişler, stok limitleri ve müşteri yorumları ile ilgili anlık bildirimleri inceleyin."
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Full Width: Notifications List */}
        <div className="lg:col-span-12 space-y-6">
          
          {/* Header Filter Pill Bar */}
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-sm">
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'All', label: 'Tümü' },
                { key: 'Unread', label: `Okunmamış (${unreadCount})` },
                { key: 'Order', label: 'Siparişler' },
                { key: 'Stock', label: 'Stok Limitleri' },
                { key: 'Review', label: 'Yorumlar' },
              ].map((s) => (
                <button
                  key={s.key}
                  onClick={() => setFilter(s.key)}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-all ${
                    filter === s.key
                      ? 'bg-zinc-900 border-zinc-900 text-white shadow-sm'
                      : 'bg-white border-zinc-200 text-zinc-550 hover:bg-zinc-50'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllAsRead}
                className="text-xs font-bold text-[#df0000] hover:underline shrink-0 text-left"
              >
                Tümünü Okundu İşaretle
              </button>
            )}
          </div>

          {/* Notifications List */}
          <div className="space-y-6">
            <div className="space-y-3">
              <span className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider block">BİLDİRİMLER</span>
              
              <div className="rounded-3xl border border-zinc-200/80 bg-white overflow-hidden shadow-sm">
                {filter === 'Stock' ? (
                  <>
                    <div className="p-6 bg-zinc-50 border-b border-zinc-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <h4 className="text-xs font-bold text-zinc-800">Minimum Stok Sınırı Tanımla</h4>
                        <p className="text-[11px] text-zinc-550 mt-1">Stok adedi bu değer ve altında olan ürünler listelenecektir.</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-zinc-650">Min. Stok:</span>
                        <input
                          type="number"
                          min="0"
                          value={minStock}
                          onChange={(e) => setMinStock(Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-24 px-3 py-2 border border-zinc-200 rounded-xl text-xs font-bold text-zinc-800 outline-none focus:border-zinc-400"
                        />
                      </div>
                    </div>
                    
                    <div className="divide-y divide-zinc-150/60">
                      {loadingProducts ? (
                        <div className="p-10 flex items-center justify-center">
                          <div className="w-6 h-6 border-2 border-zinc-200 border-t-zinc-800 rounded-full animate-spin" />
                        </div>
                      ) : lowStockProducts.length === 0 ? (
                        <div className="p-12 text-center text-zinc-400 text-xs italic">
                          Belirtilen stok limitinin altında ürün bulunamadı.
                        </div>
                      ) : (
                        lowStockProducts.map((p) => (
                          <div key={p.id} className="p-5 flex items-center justify-between gap-4 hover:bg-zinc-50/50 transition-colors">
                            <div className="flex items-center gap-3.5 min-w-0">
                              <div className="w-10 h-10 rounded-xl border border-zinc-100 bg-white overflow-hidden flex items-center justify-center shrink-0">
                                {p.imageUrl ? (
                                  <img src={p.imageUrl} className="max-h-full max-w-full object-contain p-1" alt="" />
                                ) : (
                                  <span className="material-symbols-outlined text-lg text-zinc-300">image</span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <span className="block text-xs font-bold text-zinc-900 truncate">{p.name}</span>
                                <span className="block text-[10px] text-zinc-400 font-semibold mt-0.5">{p.stockCode || 'SKU GİRİLMEMİŞ'}</span>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-4 shrink-0">
                              <div className="text-right">
                                <span className="block text-xs font-extrabold text-rose-600">{p.stock} Adet</span>
                                <span className="block text-[9px] text-zinc-400 font-bold uppercase mt-0.5">Mevcut Stok</span>
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                ) : (
                  <div className="divide-y divide-zinc-150/60">
                    {filtered.map((n) => {
                      const icon = iconMap[n.type] || { name: 'notifications', color: 'bg-zinc-50 text-zinc-650' }
                      return (
                        <div
                          key={n.id}
                          className={`p-5 flex justify-between items-center gap-4 transition ${
                            !n.isRead ? 'bg-blue-50/20' : 'hover:bg-zinc-50/50'
                          }`}
                        >
                          <div className="flex items-start gap-3.5 min-w-0">
                            <div className={`w-9 h-9 rounded-2xl border flex items-center justify-center shrink-0 ${icon.color}`}>
                              <span className="material-symbols-outlined text-[18px]">{icon.name}</span>
                            </div>
                            <div className="min-w-0">
                              <span className="block text-xs font-bold text-zinc-900 leading-tight">{n.title}</span>
                              <p className="text-[11px] font-semibold text-zinc-500 mt-1">{n.message}</p>
                              <span className="block text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider mt-1.5">{formatNotificationTime(n.createdAtUtc)}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {!n.isRead && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleMarkAsRead(n.id); }}
                                className="px-2.5 py-1 rounded-xl bg-zinc-900 text-white text-[10px] font-bold hover:bg-zinc-800 active:scale-95 transition-all shadow-sm"
                              >
                                Okundu
                              </button>
                            )}
                            {n.link ? (
                              <Link
                                to={n.link}
                                className="w-7 h-7 rounded-full border border-zinc-200 hover:border-zinc-350 hover:bg-zinc-50 flex items-center justify-center text-zinc-500"
                              >
                                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                              </Link>
                            ) : (
                              <div className="w-7 h-7 rounded-full border border-zinc-100 flex items-center justify-center text-zinc-350">
                                <span className="material-symbols-outlined text-[14px]">notifications</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    {filtered.length === 0 && (
                      <div className="p-16 text-center text-zinc-400 font-medium italic">
                        Yeni bildirim bulunmuyor.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
