import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, CornerDownRight, X, Trash2, ChevronUp } from 'lucide-react'

import {
  OPERATION_EFFECTS_EVENT,
  type OperationEffectsPayload,
} from '../utils/operationEffects'

type Toast = OperationEffectsPayload & {
  id: number
  createdAt: number
}

/**
 * İŞLEM SONUÇLARI BİLDİRİMİ (TOASTER).
 *
 * - İlk eklendiğinde 3 saniye boyunca tam açık kalır.
 * - 3 saniye sonra otomatik olarak aşağı kayar ve yarı saydam (%35 opaklık) moda geçer.
 * - Fare (hover) üzerine geldiğinde anında yukarı açılır ve %100 netleşir.
 * - "Hepsini Temizle" butonu ile tüm bildirimler tek tıkla kapatılabilir.
 */
export default function OperationEffectsToaster() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [isHovered, setIsHovered] = useState(false)
  const [minimizedMap, setMinimizedMap] = useState<Record<number, boolean>>({})
  const nextIdRef = useRef(1)

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<OperationEffectsPayload>).detail
      if (!detail?.actions?.length && !detail?.effects?.length) return

      const toastId = nextIdRef.current++
      const newToast: Toast = {
        ...detail,
        id: toastId,
        createdAt: Date.now(),
      }

      setToasts((prev) => [newToast, ...prev].slice(0, 4))
      setMinimizedMap((prev) => ({ ...prev, [toastId]: false }))

      // 3 saniye sonra otomatik küçült ve aşağı kaydır
      window.setTimeout(() => {
        setMinimizedMap((prev) => ({ ...prev, [toastId]: true }))
      }, 3000)
    }

    window.addEventListener(OPERATION_EFFECTS_EVENT, handler)
    return () => window.removeEventListener(OPERATION_EFFECTS_EVENT, handler)
  }, [])

  const dismiss = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    setMinimizedMap((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const clearAll = () => {
    setToasts([])
    setMinimizedMap({})
  }

  if (toasts.length === 0) return null

  // Tüm toastlar minimize durumdaysa ve hover değilse mini dock moduna geçer
  const allMinimized = toasts.every((t) => minimizedMap[t.id]) && !isHovered

  return (
    <aside
      aria-label="İşlem bildirimleri"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`fixed bottom-3 left-3 z-[9999] flex w-[min(25rem,calc(100vw-1.5rem))] flex-col gap-2 transition-all duration-300 ease-out ${
        allMinimized
          ? 'translate-y-3 opacity-40 hover:translate-y-0 hover:opacity-100'
          : 'translate-y-0 opacity-100'
      }`}
    >
      {/* ÜST BİLGİ VE HEPSİNİ TEMİZLE ŞERİDİ */}
      <div className="flex items-center justify-between px-1.5 py-0.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 select-none">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>İşlem Bildirimleri ({toasts.length})</span>
          {allMinimized && (
            <span className="text-[10px] font-semibold text-slate-400 flex items-center gap-0.5 bg-white/80 px-1.5 py-0.5 rounded-full border border-slate-200 shadow-2xs">
              <ChevronUp size={11} /> Detay için üzerine gelin
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={clearAll}
          title="Tüm bildirimleri kapat"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white/95 hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200/90 hover:border-rose-200 text-[10.5px] font-bold shadow-2xs transition active:scale-95 cursor-pointer backdrop-blur-xs"
        >
          <Trash2 size={11} />
          Hepsini Temizle
        </button>
      </div>

      {/* BİLDİRİM KARTLARI */}
      {toasts.map((toast) => {
        const isSelfMinimized = minimizedMap[toast.id] && !isHovered

        return (
          <div
            key={toast.id}
            role="status"
            className={`rounded-2xl border transition-all duration-300 ease-out overflow-hidden shadow-lg ${
              isSelfMinimized
                ? 'border-emerald-300/80 bg-white/80 backdrop-blur-md opacity-50 max-h-12 shadow-emerald-950/5'
                : 'border-emerald-200 bg-white opacity-100 max-h-96 shadow-emerald-900/10'
            }`}
          >
            {/* BAŞLIK KISMI */}
            <div className="flex items-center justify-between gap-2 border-b border-emerald-100 bg-gradient-to-r from-emerald-50/90 to-teal-50/70 px-3.5 py-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-black text-emerald-950 truncate">
                    İşlem Tamamlandı
                  </div>
                  {!isSelfMinimized && (
                    <div className="text-[10.5px] font-bold text-emerald-700 truncate">
                      {toast.effects.length > 0
                        ? `${toast.effects.length} sonuç sisteme uygulandı`
                        : 'Başarıyla kaydedildi'}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {isSelfMinimized && (
                  <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100/90 px-1.5 py-0.5 rounded-md">
                    +{toast.actions.length + toast.effects.length} detay
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  aria-label="Kapat"
                  className="rounded-lg p-1 text-emerald-600 hover:bg-emerald-200/70 hover:text-emerald-950 transition cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* DETAYLAR (KÜÇÜLDÜĞÜNDE GİZLENİR, HOVER'DA AÇILIR) */}
            {!isSelfMinimized && (
              <div className="max-h-64 overflow-y-auto px-3.5 py-2.5 bg-white/95 divide-y divide-slate-100/80">
                {toast.actions.length > 0 && (
                  <ul className="pb-2 space-y-1">
                    {toast.actions.map((action, index) => (
                      <li
                        key={index}
                        className="text-[12px] font-bold leading-snug text-slate-800 flex items-start gap-1.5"
                      >
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                        <span>{action}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {toast.effects.length > 0 && (
                  <ul className="pt-2 space-y-1.5">
                    {toast.effects.map((effect, index) => (
                      <li
                        key={index}
                        className="flex items-start gap-2 text-[11.5px] leading-snug text-slate-600 font-medium"
                      >
                        <CornerDownRight className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-600" />
                        <span>{effect}</span>
                      </li>
                    ))}
                    {toast.overflow > 0 && (
                      <li className="pl-5 text-[10.5px] font-semibold text-slate-400">
                        ve {toast.overflow} sonuç daha...
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </div>
        )
      })}
    </aside>
  )
}
