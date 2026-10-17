import React from 'react'

export type NotificationVariant = 'success' | 'error' | 'info'

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
      ? 'bg-green-50 text-green-800 border-green-200'
      : variant === 'error'
        ? 'bg-red-50 text-red-800 border-red-200'
        : 'bg-blue-50 text-blue-800 border-blue-200'

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onMouseDown={onClose} />
      <div className="relative w-full max-w-md mx-4 rounded-xl shadow-2xl border bg-white overflow-hidden">
        <div className={`px-4 py-3 border-b text-sm font-semibold ${headerClass}`}>{title ?? 'Bilgilendirme'}</div>
        <div className="px-4 py-3 text-sm text-gray-700 whitespace-pre-line">{message}</div>
        <div className="px-4 py-3 border-t bg-gray-50 flex justify-end">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded text-xs font-semibold bg-gray-800 text-white hover:bg-gray-900">
            Kapat
          </button>
        </div>
      </div>
    </div>
  )
}
