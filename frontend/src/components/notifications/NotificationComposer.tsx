import React from 'react'
import { Send, Bell, Monitor, AlertCircle, Loader2 } from 'lucide-react'

interface NotificationComposerProps {
  title: string
  content: string
  isPopup: boolean
  sending: boolean
  uniqueRecipientCount: number
  hasTargets: boolean
  isCalculatingRecipients: boolean
  onTitleChange: (val: string) => void
  onContentChange: (val: string) => void
  onIsPopupChange: (val: boolean) => void
  onSubmit: (e: React.FormEvent) => void
}

export default function NotificationComposer({
  title,
  content,
  isPopup,
  sending,
  uniqueRecipientCount,
  hasTargets,
  isCalculatingRecipients,
  onTitleChange,
  onContentChange,
  onIsPopupChange,
  onSubmit,
}: NotificationComposerProps) {
  const isTitleValid = title.trim().length > 0
  const isContentValid = content.trim().length > 0
  const canSubmit =
    hasTargets &&
    uniqueRecipientCount > 0 &&
    isTitleValid &&
    isContentValid &&
    !isCalculatingRecipients &&
    !sending

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-4 sm:p-5 space-y-4">
      <div className="border-b border-slate-100 pb-3">
        <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
          <Send className="w-4 h-4 text-orange-600" />
          Bildirim İçeriği
        </h3>
        <p className="text-xs text-slate-400 mt-0.5">
          Gönderilecek bildirimin başlığını, metnini ve gönderim tipini belirleyin
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        {/* Title Input */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Bildirim Başlığı <span className="text-rose-500">*</span>
            </label>
            <span className={`text-[11px] font-mono ${title.length >= 25 ? 'text-amber-600 font-bold' : 'text-slate-400'}`}>
              {title.length} / 25
            </span>
          </div>
          <input
            type="text"
            maxLength={25}
            placeholder="Başlık girin (maks. 25 karakter)..."
            value={title}
            onChange={(e) => onTitleChange(e.target.value.slice(0, 25))}
            className="w-full h-10 px-3.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-none bg-white font-medium text-slate-800 transition shadow-2xs"
          />
          {!isTitleValid && title.length > 0 && (
            <p className="text-[11px] text-rose-500 mt-1 flex items-center gap-1 font-medium">
              <AlertCircle className="w-3 h-3" />
              Bildirim başlığı zorunludur.
            </p>
          )}
        </div>

        {/* Content Textarea */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Mesaj İçeriği <span className="text-rose-500">*</span>
            </label>
            <span className={`text-[11px] font-mono ${content.length > 1000 ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>
              {content.length} / 1000
            </span>
          </div>
          <textarea
            maxLength={1000}
            rows={4}
            placeholder="Gönderilecek detaylı bildirim mesajını buraya yazın..."
            value={content}
            onChange={(e) => onContentChange(e.target.value)}
            className="w-full p-3.5 text-xs sm:text-sm rounded-xl border border-slate-200 focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 outline-none bg-white font-medium text-slate-800 transition resize-y min-h-[90px] shadow-2xs"
          />
          {!isContentValid && content.length > 0 && (
            <p className="text-[11px] text-rose-500 mt-1 flex items-center gap-1 font-medium">
              <AlertCircle className="w-3 h-3" />
              Mesaj içeriği zorunludur.
            </p>
          )}
        </div>

        {/* Delivery Type Cards */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
            Gönderim Tipi
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* Standard Inbox Notification */}
            <div
              onClick={() => onIsPopupChange(false)}
              className={`p-3 rounded-xl border cursor-pointer transition flex items-start gap-2.5 select-none ${
                !isPopup
                  ? 'bg-blue-50/70 border-blue-500 ring-2 ring-blue-500/20 text-blue-900'
                  : 'bg-slate-50/80 border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              <Bell className={`w-4 h-4 mt-0.5 shrink-0 ${!isPopup ? 'text-blue-600' : 'text-slate-400'}`} />
              <div>
                <div className="text-xs font-bold">Yalnızca Sistem İçi</div>
                <div className="text-[11px] opacity-75 leading-tight mt-0.5">
                  Sağ üst zil ikonunda bildirim olarak gösterilir.
                </div>
              </div>
            </div>

            {/* Popup Modal Notification */}
            <div
              onClick={() => onIsPopupChange(true)}
              className={`p-3 rounded-xl border cursor-pointer transition flex items-start gap-2.5 select-none ${
                isPopup
                  ? 'bg-orange-50/70 border-orange-500 ring-2 ring-orange-500/20 text-orange-900'
                  : 'bg-slate-50/80 border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              <Monitor className={`w-4 h-4 mt-0.5 shrink-0 ${isPopup ? 'text-orange-600' : 'text-slate-400'}`} />
              <div>
                <div className="text-xs font-bold">Sistem İçi + Giriş Popup'ı</div>
                <div className="text-[11px] opacity-75 leading-tight mt-0.5">
                  Kullanıcı ilk girdiğinde açılan ekran uyarısı.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Validation Errors Box */}
        {!hasTargets && (
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>En az bir hedef (kullanıcı, rol veya fiyat grubu) seçmelisiniz.</span>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full h-11 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:hover:bg-orange-600 text-white font-bold rounded-xl shadow-md transition active:scale-[0.99] cursor-pointer flex items-center justify-center gap-2 text-xs uppercase tracking-wider"
        >
          {sending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Gönderiliyor...</span>
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              <span>
                {uniqueRecipientCount > 0
                  ? `${uniqueRecipientCount} Kullanıcıya Bildirim Gönder`
                  : 'Bildirim Gönder'}
              </span>
            </>
          )}
        </button>
      </form>
    </div>
  )
}
