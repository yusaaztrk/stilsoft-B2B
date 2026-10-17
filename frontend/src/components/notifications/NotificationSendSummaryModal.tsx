import React from 'react'
import { Send, AlertTriangle, Users, Bell, Monitor, X, Loader2 } from 'lucide-react'

interface NotificationSendSummaryModalProps {
  isOpen: boolean
  title: string
  content: string
  isPopup: boolean
  targetCount: number
  uniqueRecipientCount: number
  includeAllActiveUsers: boolean
  sending: boolean
  onClose: () => void
  onConfirm: () => void
}

export default function NotificationSendSummaryModal({
  isOpen,
  title,
  content,
  isPopup,
  targetCount,
  uniqueRecipientCount,
  includeAllActiveUsers,
  sending,
  onClose,
  onConfirm,
}: NotificationSendSummaryModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-orange-100 text-orange-600 rounded-xl">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Gönderim Onayı</h3>
              <p className="text-xs text-slate-500">Lütfen bildirim ayrıntılarını kontrol edin</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {includeAllActiveUsers && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-bold">Tüm Aktif Kullanıcılara Gönderim!</strong>
                Bu bildirim sistemdeki tüm aktif kullanıcılara iletilecektir. Lütfen gönderimi onaylamadan önce içeriği dikkatle inceleyin.
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
              Bildirim Başlığı
            </span>
            <div className="p-3 bg-slate-50 rounded-xl text-xs sm:text-sm font-bold text-slate-800 border border-slate-200/60">
              {title}
            </div>
          </div>

          {/* Message Preview */}
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
              Mesaj İçeriği
            </span>
            <div className="p-3 bg-slate-50 rounded-xl text-xs sm:text-sm text-slate-700 border border-slate-200/60 leading-relaxed whitespace-pre-wrap max-h-36 overflow-y-auto">
              {content}
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-slate-50 border border-slate-200/60 rounded-xl">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Seçilen Hedef
              </span>
              <span className="text-sm font-bold text-slate-800 mt-0.5 block">
                {targetCount} hedef
              </span>
            </div>

            <div className="p-3 bg-orange-50/70 border border-orange-200/70 rounded-xl">
              <span className="text-[10px] font-bold text-orange-600 uppercase tracking-wider flex items-center gap-1">
                <Users className="w-3 h-3" />
                Benzersiz Alıcı
              </span>
              <span className="text-sm font-black text-orange-600 font-mono mt-0.5 block">
                {uniqueRecipientCount} kullanıcı
              </span>
            </div>
          </div>

          {/* Delivery Type Summary */}
          <div className="p-3 bg-slate-50 border border-slate-200/60 rounded-xl flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium">Gönderim Tipi:</span>
            <span className="font-bold text-slate-800 flex items-center gap-1.5">
              {isPopup ? (
                <>
                  <Monitor className="w-3.5 h-3.5 text-orange-600" />
                  Sistem İçi + Giriş Popup'ı
                </>
              ) : (
                <>
                  <Bell className="w-3.5 h-3.5 text-blue-600" />
                  Yalnızca Sistem İçi
                </>
              )}
            </span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={sending}
            onClick={onClose}
            className="px-4 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-200/60 rounded-xl transition cursor-pointer"
          >
            Vazgeç
          </button>

          <button
            type="button"
            disabled={sending}
            onClick={onConfirm}
            className="px-5 py-2.5 text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-xl shadow-md transition active:scale-[0.98] cursor-pointer flex items-center gap-2"
          >
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Gönderiliyor...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>Gönderimi Onayla ({uniqueRecipientCount} Kullanıcı)</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
