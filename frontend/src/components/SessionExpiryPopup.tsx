import React from 'react'

type Props = {
  isOpen: boolean
  remainingMinutes: number
  expiresAtLabel: string
  extending?: boolean
  onExtend: () => void
  onClose: () => void
}

export default function SessionExpiryPopup({
  isOpen,
  remainingMinutes,
  expiresAtLabel,
  extending = false,
  onExtend,
  onClose
}: Props) {
  if (!isOpen) return null

  const mins = Math.max(0, Math.floor(remainingMinutes))

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center font-inter">
      <div className="absolute inset-0 bg-black/40" onMouseDown={onClose} />
      <div className="relative w-full max-w-md mx-4 rounded-2xl shadow-2xl border border-gray-100 bg-white overflow-hidden">
        <div className="px-5 py-4 bg-gradient-to-b from-amber-50 to-white border-b border-amber-100">
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-700">Oturum Uyarısı</div>
          <div className="text-base font-extrabold text-gray-900 mt-1">Oturum süreniz bitmek üzere</div>
          <div className="text-sm text-gray-600 mt-1">
            Kalan süre: <span className="font-bold text-gray-900">{mins} dk</span>
            <span className="text-gray-400"> • </span>
            Bitiş: <span className="font-bold text-gray-900">{expiresAtLabel}</span>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="text-sm text-gray-700">
            Devam etmek için oturumunu uzatabilirsin.
          </div>
        </div>

        <div className="px-5 py-4 border-t bg-gray-50 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={extending}
            onClick={onClose}
            className="h-10 px-4 rounded-xl border border-gray-200 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Kapat
          </button>
          <button
            type="button"
            disabled={extending}
            onClick={onExtend}
            className="h-10 px-4 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-black disabled:opacity-60"
          >
            {extending ? 'Uzatılıyor...' : 'Uzat'}
          </button>
        </div>
      </div>
    </div>
  )
}
