import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

/**
 * Extracts plain string content recursively from any React node
 */
export function extractTextContent(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return ''
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(extractTextContent).join('')
  }
  if (React.isValidElement(node)) {
    if (node.props && (node.props as any).children) {
      return extractTextContent((node.props as any).children)
    }
  }
  return ''
}

export interface OverflowTooltipProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactNode
  text?: string
  as?: 'div' | 'span' | 'p' | 'td'
  className?: string
  placement?: 'top' | 'bottom' | 'auto'
  alwaysShow?: boolean
  disabled?: boolean
}

export const OverflowTooltip: React.FC<OverflowTooltipProps> = ({
  children,
  text,
  as: Component = 'div',
  className = '',
  placement = 'auto',
  alwaysShow = false,
  disabled = false,
  onMouseEnter,
  onMouseLeave,
  ...rest
}) => {
  const containerRef = useRef<HTMLElement | null>(null)

  /**
   * PERFORMANS (2026-08-22): tek durum, ve metin YALNIZCA fareyle üzerine gelince hesaplanır.
   *
   * Bu bileşen tablodaki HER HÜCREDE bir kez kuruluyor. Eskiden üç ayrı `useState` vardı ve
   * `extractTextContent(children)` HER RENDER'DA çağrılıyordu — hücrenin React ağacını
   * özyinelemeli gezen bir işlev. 20 satır × 15 sütun = 300 hücrede bile hissediliyordu;
   * "Sınırsız" sayfa boyutuyla (5000 satır) tablo tamamen kilitlenirdi.
   *
   * İpucu metni zaten yalnızca fare üzerine gelince gerekiyor, o yüzden hesabı oraya taşındı.
   * Durum `null` iken hücre tamamen durumsuz davranır.
   */
  const [tip, setTip] = useState<{
    text: string
    overflowing: boolean
    visible: boolean
    top: number
    left: number
    arrowLeft: number
    placement: 'top' | 'bottom'
  } | null>(null)

  const isVisible = Boolean(tip?.visible)
  const displayText = tip?.text ?? ''

  const measureOverflow = useCallback(() => {
    const el = containerRef.current
    if (!el) return false
    // 1px tolerance for rounding
    return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
  }, [])

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    onMouseEnter?.(e)
    if (disabled) return

    // Metin burada çıkarılır — render sırasında değil.
    const resolvedText = (text ?? extractTextContent(children)).trim()
    if (!resolvedText) return

    const overflowed = measureOverflow()
    if (overflowed || alwaysShow) {
      const rect = e.currentTarget.getBoundingClientRect()
      const spaceAbove = rect.top
      const spaceBelow = window.innerHeight - rect.bottom

      let finalPlacement: 'top' | 'bottom' = 'top'
      if (placement === 'bottom') {
        finalPlacement = 'bottom'
      } else if (placement === 'top') {
        finalPlacement = spaceAbove < 50 && spaceBelow > spaceAbove ? 'bottom' : 'top'
      } else {
        finalPlacement = spaceAbove < 50 && spaceBelow > spaceAbove ? 'bottom' : 'top'
      }

      const rawLeft = rect.left + rect.width / 2
      // Clamp to screen bounds with margin
      const clampedLeft = Math.max(120, Math.min(window.innerWidth - 120, rawLeft))
      const arrowOffset = rawLeft - clampedLeft

      const top = finalPlacement === 'top' ? rect.top - 6 : rect.bottom + 6

      setTip({
        text: resolvedText,
        overflowing: overflowed,
        visible: true,
        top,
        left: clampedLeft,
        arrowLeft: arrowOffset,
        placement: finalPlacement
      })
    } else {
      // Taşma yoksa yerel `title` da yazılmaz — kısa metinde çift ipucu çıkardı.
      setTip({ text: resolvedText, overflowing: false, visible: false, top: 0, left: 0, arrowLeft: 0, placement: 'top' })
    }
  }

  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    onMouseLeave?.(e)
    setTip((prev) => (prev && prev.visible ? { ...prev, visible: false } : prev))
  }

  useEffect(() => {
    if (!isVisible) return

    const handleDismiss = () => {
      setTip((prev) => (prev && prev.visible ? { ...prev, visible: false } : prev))
    }

    window.addEventListener('scroll', handleDismiss, true)
    window.addEventListener('resize', handleDismiss)
    return () => {
      window.removeEventListener('scroll', handleDismiss, true)
      window.removeEventListener('resize', handleDismiss)
    }
  }, [isVisible])

  return (
    <>
      <Component
        ref={containerRef as any}
        className={`truncate ${className}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        title={tip?.overflowing && tip.text ? tip.text : undefined}
        {...rest}
      >
        {children}
      </Component>

      {isVisible && displayText && createPortal(
        <div
          style={{
            position: 'fixed',
            top: `${tip!.top}px`,
            left: `${tip!.left}px`,
            transform: tip!.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            zIndex: 9999999
          }}
          className="pointer-events-none transition-opacity duration-150 ease-out"
        >
          <div className="relative bg-slate-900/95 text-white text-[11px] font-medium px-3 py-1.5 rounded-lg shadow-2xl border border-slate-700/80 backdrop-blur-xs max-w-sm sm:max-w-md break-words whitespace-normal text-center leading-relaxed">
            {displayText}
            {/* Tooltip Arrow */}
            <div
              style={{
                marginLeft: `${tip!.arrowLeft}px`
              }}
              className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-900 border-slate-700 rotate-45 ${
                tip!.placement === 'top'
                  ? '-bottom-1 border-r border-b'
                  : '-top-1 border-l border-t'
              }`}
            />
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

export default OverflowTooltip
