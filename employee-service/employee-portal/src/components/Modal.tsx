import { X } from 'lucide-react'
import React from 'react'
import { createPortal } from 'react-dom'

type Props = {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  hideHeader?: boolean
  scrollable?: boolean
  containerClassName?: string
  overlayClassName?: string
  theme?: 'light' | 'dark'
}

export default function Modal({ isOpen, onClose, title, children, footer, hideHeader, scrollable, containerClassName, overlayClassName }: Props) {
  if (!isOpen) return null

  const isScrollable = scrollable !== false
  const container = String(containerClassName ?? '').trim()
  const overlay = String(overlayClassName ?? '').trim()

  const content = (
    <div className={'fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm ' + overlay}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={
          'bg-white rounded-2xl shadow-2xl w-[92%] sm:w-full sm:max-w-2xl max-h-[90vh] overflow-hidden relative border border-slate-200/90 ' +
          container
        }
      >
        {!hideHeader && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 bg-slate-50/90">
            <h3 className="text-sm font-black text-slate-900 tracking-tight">{title}</h3>
            <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition">
              <X size={16} />
            </button>
          </div>
        )}

        {hideHeader && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-10 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            aria-label="Kapat"
            title="Kapat"
          >
            <X size={16} />
          </button>
        )}

        <div className={isScrollable ? 'px-6 py-5 overflow-y-auto max-h-[calc(90vh-140px)] scrollbar-thin-dark' : 'px-6 py-5'}>
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200/80 bg-slate-50/60">
            {footer}
          </div>
        )}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return content
  return createPortal(content, document.body)
}

