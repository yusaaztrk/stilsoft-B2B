import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, X } from 'lucide-react'

import { registerDeleteReasonHandler, type DeleteReasonRequest } from '../utils/deleteReasonGate'

/** Sık yazılan nedenler — tek tıkla kutuya gelir, istenirse üzerine eklenir. */
const HAZIR_NEDENLER = ['Yanlış girildi', 'Mükerrer kayıt', 'Tutar / bilgi hatalı', 'Müşteri vazgeçti', 'Yanlış cari / hesap']

const EN_AZ = 3

type Pending = DeleteReasonRequest & { resolve: (reason: string | null) => void }

/**
 * SİLME NEDENİ PENCERESİ — kural için bkz. utils/deleteReasonGate.
 *
 * Sayfaların kendi "silinsin mi?" onayından SONRA açılır (istek gönderilirken). Arka plana
 * tıklamak pencereyi KAPATMAZ: yarım yazılmış neden kazara tıklamayla kaybolmasın. Çıkış
 * İptal, X ya da ESC; iptalde silme isteği hiç gönderilmez.
 */
export default function DeleteReasonDialog() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [reason, setReason] = useState('')
  const pendingRef = useRef<Pending | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  pendingRef.current = pending

  const ask = useCallback((req: DeleteReasonRequest) => {
    return new Promise<string | null>((resolve) => {
      // Önceki soru açık kaldıysa (olmamalı — kapı tek soru sorar) iptal sayılır.
      pendingRef.current?.resolve(null)
      setReason('')
      setPending({ ...req, resolve })
    })
  }, [])

  useEffect(() => {
    registerDeleteReasonHandler(ask)
    return () => registerDeleteReasonHandler(null)
  }, [ask])

  const settle = useCallback((value: string | null) => {
    const current = pendingRef.current
    setPending(null)
    current?.resolve(value)
  }, [])

  useEffect(() => {
    if (!pending) return
    const t = window.setTimeout(() => inputRef.current?.focus(), 30)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') settle(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [pending, settle])

  if (!pending) return null

  const temiz = reason.trim()
  const gecerli = temiz.length >= EN_AZ

  return createPortal(
    <div className="fixed inset-0 z-[2147483000] flex items-center justify-center p-4" data-disable-global-uppercase="true">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Silme nedeni"
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 bg-gradient-to-r from-rose-600 to-red-600 text-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <Trash2 size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-black leading-tight">Silme Nedeni</div>
              <div className="text-[11.5px] font-medium text-white/85 leading-snug">
                Bu kaydı neden siliyorsunuz? Neden, Silinen Kayıtlar'da saklanır.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => settle(null)}
            className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/15 transition"
            aria-label="Kapat"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 pt-4 pb-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {HAZIR_NEDENLER.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setReason(n)
                  inputRef.current?.focus()
                }}
                className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold border transition ${
                  temiz === n
                    ? 'bg-rose-50 border-rose-300 text-rose-700'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {n}
              </button>
            ))}
          </div>

          <textarea
            ref={inputRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && gecerli) settle(temiz)
            }}
            maxLength={1000}
            rows={3}
            placeholder="Silme nedenini yazın…"
            data-no-uppercase="true"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-200 focus:border-rose-400 resize-none"
          />
          {!gecerli && temiz.length > 0 && (
            <div className="text-[11px] font-semibold text-rose-600">En az {EN_AZ} karakter yazın.</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button
            type="button"
            onClick={() => settle(null)}
            className="px-4 py-2 rounded-xl text-sm font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition"
          >
            İptal
          </button>
          <button
            type="button"
            disabled={!gecerli}
            onClick={() => settle(temiz)}
            className={`px-4 py-2 rounded-xl text-sm font-bold text-white transition flex items-center gap-1.5 ${
              gecerli ? 'bg-rose-600 hover:bg-rose-700' : 'bg-rose-300 cursor-not-allowed'
            }`}
          >
            <Trash2 size={14} />
            Sil
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
