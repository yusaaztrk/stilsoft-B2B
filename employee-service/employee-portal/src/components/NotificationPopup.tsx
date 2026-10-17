import React from 'react'

export type NotificationVariant = 'success' | 'error' | 'warning' | 'info'

type Props = {
  isOpen: boolean
  title?: string
  message: string
  variant?: NotificationVariant
  onClose: () => void
}

export default function NotificationPopup({ isOpen, title, message, variant = 'info', onClose }: Props) {
  if (!isOpen) return null

  const headerClass =
    variant === 'success'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : variant === 'error'
        ? 'bg-rose-50 text-rose-800 border-rose-200'
        : variant === 'warning'
          ? 'bg-amber-50 text-amber-900 border-amber-200'
          : 'bg-slate-50 text-slate-900 border-slate-200'

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onMouseDown={onClose} />
      <div className="relative w-full max-w-md mx-4 rounded-2xl shadow-2xl border border-slate-200/90 bg-white overflow-hidden">
        <div className={`px-5 py-3.5 border-b text-xs font-black uppercase tracking-wider ${headerClass}`}>{title ?? 'Bilgilendirme'}</div>
        <div className="px-5 py-5 text-xs font-medium text-slate-700 whitespace-pre-line leading-relaxed">{message}</div>
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button type="button" onClick={onClose} className="btn-secondary h-8 px-4 text-xs font-bold">
            Kapat
          </button>
        </div>
      </div>
    </div>
  )
}

