import React, { useState, useMemo } from 'react'
import { Search, Mail, Trash2, Eye, Clock, CheckCircle2, AlertCircle } from 'lucide-react'
import type { NotificationResponse } from '../../api/notifications'
import NotificationHistoryDetailModal from './NotificationHistoryDetailModal'

interface NotificationHistoryTableProps {
  list: NotificationResponse[]
  isLoading: boolean
  onDelete: (id: number) => void
}

export default function NotificationHistoryTable({
  list,
  isLoading,
  onDelete,
}: NotificationHistoryTableProps) {
  const [search, setSearch] = useState('')
  const [selectedDetail, setSelectedDetail] = useState<NotificationResponse | null>(null)

  const filteredList = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return list
    return list.filter(
      (item) =>
        String(item.title ?? '').toLowerCase().includes(q) ||
        String(item.content ?? '').toLowerCase().includes(q) ||
        String(item.userDisplayName ?? '').toLowerCase().includes(q) ||
        String(item.userUsername ?? '').toLowerCase().includes(q)
    )
  }, [list, search])

  // Count read vs total
  const readCount = useMemo(() => list.filter((n) => n.isRead).length, [list])

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
      {/* Header */}
      <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-800 tracking-tight flex items-center gap-2">
            <Mail className="w-4 h-4 text-slate-600" />
            Gönderim Geçmişi ({list.length})
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Daha önce gönderilmiş bildirimlerin detayları ve okuma durumları (Toplam Okunma:{' '}
            <strong className="text-emerald-600 font-mono">
              {readCount} / {list.length}
            </strong>
            )
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Başlık, içerik veya alıcı ara..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-700 shadow-2xs"
          />
        </div>
      </div>

      {/* Table Body */}
      {isLoading ? (
        <div className="p-12 text-center text-slate-400 text-xs">Geçmiş yükleniyor...</div>
      ) : list.length === 0 ? (
        <div className="p-16 text-center text-slate-400 flex flex-col items-center gap-2 justify-center">
          <Mail className="w-8 h-8 text-slate-300" />
          <span className="text-xs font-semibold text-slate-600">Henüz bildirim göndermediniz.</span>
        </div>
      ) : filteredList.length === 0 ? (
        <div className="p-16 text-center text-slate-400 flex flex-col items-center gap-2 justify-center">
          <AlertCircle className="w-8 h-8 text-slate-300" />
          <span className="text-xs font-semibold text-slate-600">
            Arama sonucunda bildirim bulunamadı.
          </span>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                <th className="px-4 py-3">Alıcı</th>
                <th className="px-4 py-3">Başlık & İçerik</th>
                <th className="px-4 py-3">Gönderim Tarihi</th>
                <th className="px-4 py-3">Tür</th>
                <th className="px-4 py-3">Okunma Durumu</th>
                <th className="px-4 py-3 text-center">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredList.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-semibold text-slate-800 max-w-[160px] truncate">
                    {item.userDisplayName || item.userUsername}
                  </td>
                  <td className="px-4 py-3 max-w-[280px]">
                    <div className="font-bold text-slate-800 truncate">{item.title}</div>
                    <div className="text-slate-400 truncate mt-0.5">{item.content}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">
                    {new Date(item.createTime).toLocaleDateString('tr-TR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    {item.isPopup ? (
                      <span className="px-2 py-0.5 bg-orange-50 text-orange-700 border border-orange-200 rounded-md text-[10px] font-bold">
                        Popup
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-md text-[10px] font-bold">
                        Standart
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {item.isRead ? (
                      <div className="flex items-center gap-1.5 text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="font-semibold text-[11px]">
                          Okundu (
                          {new Date(item.readTime!).toLocaleDateString('tr-TR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          )
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-slate-400">
                        <Clock className="w-3.5 h-3.5 text-slate-300" />
                        <span className="font-medium text-[11px]">Okunmadı</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedDetail(item)}
                        className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                        title="Detayı Gör"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(item.id)}
                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 transition cursor-pointer"
                        title="Bildirimi Sil"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Modal */}
      <NotificationHistoryDetailModal
        notification={selectedDetail}
        onClose={() => setSelectedDetail(null)}
      />
    </div>
  )
}
