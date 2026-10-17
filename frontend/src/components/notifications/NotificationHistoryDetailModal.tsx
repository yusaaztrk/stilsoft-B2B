import React from 'react'
import { Bell, Clock, User, Monitor, X } from 'lucide-react'
import type { NotificationResponse } from '../../api/notifications'

interface NotificationHistoryDetailModalProps {
  notification: NotificationResponse | null
  onClose: () => void
}

export default function NotificationHistoryDetailModal({
  notification,
  onClose,
}: NotificationHistoryDetailModalProps) {
  if (!notification) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Gönderilen Bildirim Detayı</h3>
              <p className="text-xs text-slate-500">Kayıt ID: #{notification.id}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
              Alıcı Kullanıcı
            </span>
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 bg-slate-50 p-2.5 rounded-xl border border-slate-200/60">
              <User className="w-4 h-4 text-indigo-600" />
              <span>
                {notification.userDisplayName} (@{notification.userUsername})
              </span>
            </div>
          </div>

          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
              Başlık
            </span>
            <div className="text-sm font-bold text-slate-900 bg-slate-50 p-3 rounded-xl border border-slate-200/60">
              {notification.title}
            </div>
          </div>

          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
              Mesaj İçeriği
            </span>
            <div className="text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-200/60 whitespace-pre-wrap leading-relaxed">
              {notification.content}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-2.5 bg-slate-50 border border-slate-200/60 rounded-xl">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Gönderim Tarihi
              </span>
              <span className="font-semibold text-slate-700 mt-0.5 block">
                {new Date(notification.createTime).toLocaleDateString('tr-TR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>

            <div className="p-2.5 bg-slate-50 border border-slate-200/60 rounded-xl">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Gönderen
              </span>
              <span className="font-semibold text-slate-700 mt-0.5 block truncate">
                {notification.senderName || notification.createUser}
              </span>
            </div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200/60 rounded-xl flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium">Okunma Durumu:</span>
            {notification.isRead ? (
              <span className="text-emerald-700 font-bold flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                Okundu (
                {new Date(notification.readTime!).toLocaleDateString('tr-TR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                )
              </span>
            ) : (
              <span className="text-slate-400 font-medium">Henüz Okunmadı</span>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/60 text-right">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl cursor-pointer"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  )
}
