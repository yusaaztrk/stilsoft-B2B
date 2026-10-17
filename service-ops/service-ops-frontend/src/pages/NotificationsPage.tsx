import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { apiJson } from '../api/client'
import {
  Bell,
  Check,
  CheckCheck,
  Trash2,
  AlertCircle,
  Clock,
  ExternalLink,
  RefreshCw,
  X
} from 'lucide-react'

interface NotificationItem {
  id: string
  technicianId: string
  title: string
  message: string
  isRead: boolean
  createdAt: string
  jobType: string | null
  jobId: string | null
}

function NotificationList({ onNavigateAway }: { onNavigateAway?: () => void }) {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterTab, setFilterTab] = useState<'all' | 'unread' | 'read'>('all')

  const notifyGlobalUpdate = () => {
    window.dispatchEvent(new Event('notifications_updated'))
  }

  const fetchNotifications = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await apiJson<NotificationItem[]>('/api/notifications')
      setNotifications(data ?? [])
    } catch (err) {
      console.error('Failed to fetch notifications:', err)
      setError('Bildirimler yüklenirken bir hata oluştu.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchNotifications()
  }, [])

  const handleMarkAsRead = async (id: string) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, isRead: true } : n)))
    notifyGlobalUpdate()
    try {
      await apiJson(`/api/notifications/${id}/read`, { method: 'PATCH' })
    } catch (err) {
      console.error('Failed to mark notification as read:', err)
    }
  }

  const handleMarkAllAsRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
    notifyGlobalUpdate()
    try {
      await apiJson('/api/notifications/read-all', { method: 'POST' })
    } catch (err) {
      console.error('Failed to mark all as read:', err)
    }
  }

  const handleDelete = async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
    notifyGlobalUpdate()
    try {
      await apiJson(`/api/notifications/${id}`, { method: 'DELETE' })
    } catch (err) {
      console.error('Failed to delete notification:', err)
    }
  }

  const handleDeleteAll = async () => {
    setNotifications([])
    notifyGlobalUpdate()
    try {
      await apiJson('/api/notifications/delete-all', { method: 'DELETE' })
    } catch (err) {
      console.error('Failed to delete all notifications:', err)
    }
  }

  const getJobUrl = (item: NotificationItem) => {
    if (!item.jobId) return null
    const jt = (item.jobType || '').toLowerCase()
    if (jt.includes('servicerecord') || jt.includes('ariza') || jt.includes('saha')) return '/saha-ariza'
    if (jt.includes('installation') || jt.includes('montaj')) return '/montaj-yonetimi'
    if (jt.includes('cargo') || jt.includes('kargo')) return '/kargo-takibi'
    return null
  }

  const handleCardClick = (item: NotificationItem) => {
    if (!item.isRead) {
      void handleMarkAsRead(item.id)
    }
    const targetUrl = getJobUrl(item)
    if (targetUrl) {
      if (onNavigateAway) onNavigateAway()
      navigate(targetUrl)
    }
  }

  const filteredNotifications = notifications.filter(n => {
    if (filterTab === 'unread') return !n.isRead
    if (filterTab === 'read') return n.isRead
    return true
  })

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800/80 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setFilterTab('all')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              filterTab === 'all'
                ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-white shadow-xs'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Tümü ({notifications.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('unread')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              filterTab === 'unread'
                ? 'bg-white dark:bg-slate-900 text-rose-600 shadow-xs'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Okunmamışlar
            {notifications.filter(n => !n.isRead).length > 0 && (
              <span className="px-1.5 py-0.5 bg-rose-600 text-white text-[10px] font-black rounded-full">
                {notifications.filter(n => !n.isRead).length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setFilterTab('read')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              filterTab === 'read'
                ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-white shadow-xs'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            Okunmuşlar ({notifications.filter(n => n.isRead).length})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchNotifications}
            className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-all"
            title="Yenile"
            disabled={isLoading}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {notifications.some(n => !n.isRead) && (
            <button
              onClick={handleMarkAllAsRead}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700 transition-all shadow-sm"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Tümünü Okundu Say
            </button>
          )}

          {notifications.length > 0 && (
            <button
              onClick={handleDeleteAll}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 rounded-lg text-xs font-semibold hover:bg-red-50 hover:text-red-600 transition-all shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Tümünü Sil
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 flex flex-col items-center gap-2 text-gray-500 text-sm">
          <RefreshCw className="w-6 h-6 animate-spin text-rose-500" />
          Bildirimler alınıyor...
        </div>
      ) : error ? (
        <div className="p-4 bg-red-50 text-red-700 rounded-xl flex items-center gap-3 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      ) : filteredNotifications.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col items-center justify-center gap-3">
          <div className="w-12 h-12 bg-gray-50 dark:bg-slate-800 rounded-full flex items-center justify-center text-gray-400">
            <Bell className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
            {filterTab === 'unread' ? 'Okunmamış bildiriminiz bulunmuyor.' : filterTab === 'read' ? 'Okunmuş bildiriminiz bulunmuyor.' : 'Herhangi bir bildiriminiz bulunmuyor.'}
          </p>
          <p className="text-xs text-gray-400">Yeni bir iş atandığında burada görünecektir.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredNotifications.map(item => {
            const targetUrl = getJobUrl(item)
            return (
              <div
                key={item.id}
                onClick={() => handleCardClick(item)}
                className={`p-4 rounded-2xl border transition-all flex items-start justify-between gap-4 cursor-pointer hover:shadow-md ${
                  item.isRead
                    ? 'bg-white dark:bg-slate-900 border-gray-100 dark:border-slate-800 opacity-75 hover:opacity-100'
                    : 'bg-white dark:bg-slate-900 border-rose-100 dark:border-rose-950/40 shadow-sm ring-1 ring-rose-500/5'
                }`}
              >
                <div className="flex gap-3 items-start min-w-0">
                  <div className={`p-2 rounded-xl mt-0.5 ${item.isRead ? 'bg-gray-50 text-gray-400' : 'bg-rose-50 text-rose-600'}`}>
                    <Bell className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-gray-900 dark:text-white truncate">{item.title}</h3>
                      {!item.isRead && <span className="w-2 h-2 rounded-full bg-rose-600 flex-shrink-0" />}
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2 leading-relaxed">{item.message}</p>

                    <div className="flex items-center gap-3 mt-3 text-[10px] text-gray-400">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(item.createdAt).toLocaleString('tr-TR')}
                      </span>

                      {targetUrl && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleCardClick(item)
                          }}
                          className="flex items-center gap-1 text-rose-600 font-semibold hover:underline"
                        >
                          İşi Görüntüle
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                  {!item.isRead && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleMarkAsRead(item.id)
                      }}
                      className="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                      title="Okundu İşaretle"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleDelete(item.id)
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                    title="Sil"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}

/**
 * Zil ikonundaki "Tümünü Gör" bunu açar. Ayrı bir sayfaya gitmek yerine modal: kullanıcı
 * bildirimlere baktıktan sonra bulunduğu ekranı kaybetmiyor.
 */
export function NotificationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/40 backdrop-blur-sm p-4 sm:p-8 overflow-y-auto"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-2xl bg-slate-50 dark:bg-slate-950 rounded-2xl shadow-2xl border border-white/10 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-rose-50 dark:bg-rose-950/30 text-rose-600 rounded-xl">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 dark:text-white">Bildirim Kutum</h2>
              <p className="text-[11px] text-gray-500">Size atanan işlerin anlık bildirimleri</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-all"
            title="Kapat"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 sm:p-5 max-h-[70vh] overflow-y-auto">
          <NotificationList onNavigateAway={onClose} />
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function NotificationsPage() {
  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-2 animate-fadeIn">
      <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
        <div className="p-2.5 bg-rose-50 dark:bg-rose-950/30 text-rose-600 rounded-xl">
          <Bell className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Bildirim Kutum</h1>
          <p className="text-xs text-gray-500 mt-0.5">Size atanan işlerin anlık bildirimleri</p>
        </div>
      </div>

      <NotificationList />
    </div>
  )
}
