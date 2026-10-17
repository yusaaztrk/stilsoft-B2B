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
}

export default function Modal({ isOpen, onClose, title, children, footer, hideHeader, scrollable, containerClassName, overlayClassName }: Props) {
  if (!isOpen) return null

  const isScrollable = scrollable !== false
  const container = String(containerClassName ?? '').trim()
  const overlay = String(overlayClassName ?? '').trim()
  const hasCustomMaxW = /\bmax-w-/.test(container)
  const defaultMaxW = hasCustomMaxW ? '' : 'max-w-2xl'

  /*
   * Mobilde TAM EKRAN sayfa, sm ve üstünde ortalanmış pencere.
   *
   * Telefonda ortalanmış bir pencere, kenar boşlukları + %92 yükseklik sınırıyla zaten dar olan
   * ekranın önemli bir kısmını harcıyor; servis formları uzun olduğu için içerik iki kez
   * kaydırılıyordu (önce sayfa, sonra pencere). Teknisyenler bu ekranları sahada telefondan
   * dolduruyor, o yüzden mobilde pencere ekranı kaplıyor ve tek kaydırma kalıyor.
   */
  const content = (
    <div className={"fixed inset-0 z-[9999] flex items-stretch justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6 " + overlay}>
      <div
        className={
          `bg-white shadow-2xl w-full h-full flex flex-col overflow-hidden animate-fadeIn relative ` +
          `sm:h-auto sm:rounded-2xl sm:max-h-[92vh] ${defaultMaxW} ` +
          container
        }
      >
        {!hideHeader && (
          <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-gray-200 sm:px-6">
            <h3 className="min-w-0 truncate text-base font-semibold text-gray-800 sm:text-lg">{title}</h3>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
              <X size={20} />
            </button>
          </div>
        )}

        {hideHeader && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 text-gray-400 hover:text-gray-600 transition"
            aria-label="Kapat"
            title="Kapat"
          >
            <X size={20} />
          </button>
        )}

        {/*
          Mobilde yükseklik ekrandan hesaplanıyor (başlık + alt çubuk düşülerek), masaüstünde
          eski davranış korunuyor. Sabit vh sınırı mobilde alt çubuğu ekran dışına itiyordu.
        */}
        <div
          className={
            isScrollable
              ? 'flex-1 min-h-0 px-4 py-4 overflow-y-auto overscroll-contain sm:max-h-[calc(90vh-140px)] sm:px-6 pb-safe'
              : 'px-4 py-4 overflow-y-auto sm:overflow-visible sm:px-6 pb-safe'
          }
        >
          {children}
        </div>

        {footer && (
          <div className="flex flex-col-reverse gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50 sm:flex-row sm:items-center sm:justify-end sm:gap-3 sm:px-6 pb-safe-add [&>button]:w-full sm:[&>button]:w-auto [&>a]:w-full sm:[&>a]:w-auto font-semibold">
            {footer}
          </div>
        )}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return content
  return createPortal(content, document.body)
}
