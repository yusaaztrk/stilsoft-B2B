import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'

export type ActionDropdownItem = {
  /** Opsiyonel: render tarafinda `it.key || item_${idx}` fallback'i var. */
  key?: string
  label: string
  onClick: () => void
  disabled?: boolean
  disabledReason?: string
  danger?: boolean
  title?: string
}

type Props = {
  buttonLabel?: string
  items?: ActionDropdownItem[]
  children?: React.ReactNode
  align?: 'left' | 'right'
  usePortal?: boolean
}

export default function ActionDropdown({
  buttonLabel = 'İşlemler',
  items,
  children,
  align = 'right',
  usePortal = true
}: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const openedAtRef = useRef<number>(0)
  const isIconOnly = !String(buttonLabel ?? '').trim()
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 180 })

  const updatePosition = () => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const width = 180
    let left = align === 'left' ? rect.left : rect.right - width

    const maxLeft = window.innerWidth - width - 12
    if (left > maxLeft) left = maxLeft
    if (left < 12) left = 12

    /*
      MENÜ EKRANIN ALTINA TAŞMAZ (denetim md. 42).

      Yatay taşma zaten sınırlanıyordu ama dikey konum her zaman `rect.bottom + 4` idi:
      tablonun EN ALT satırındaki "İşlemler" düğmesine basıldığında menü ekranın altında
      kalıyor ve maddeler tıklanamıyordu.

      Ölçüm sırası: menü DOM'daysa gerçek yüksekliği kullanılır; ilk açılışta henüz
      basılmadığı için madde sayısından tahmin edilir (satır ~34px + kenar boşluğu).
      Aşağıda yer yoksa düğmenin ÜSTÜNE açılır; orada da yer yoksa görünür alana sıkıştırılır.
    */
    const measured = menuRef.current?.getBoundingClientRect().height ?? 0
    const estimated = Math.max(1, items?.length ?? 3) * 34 + 12
    const menuHeight = measured > 0 ? measured : estimated

    const spaceBelow = window.innerHeight - rect.bottom - 12
    const spaceAbove = rect.top - 12

    let top: number
    if (spaceBelow >= menuHeight || spaceBelow >= spaceAbove) {
      top = rect.bottom + 4
    } else {
      top = rect.top - menuHeight - 4
    }

    // Her hâlükârda görünür alanda kal.
    const maxTop = window.innerHeight - menuHeight - 12
    if (top > maxTop) top = maxTop
    if (top < 12) top = 12

    setMenuPos({ top, left, width })
  }

  useEffect(() => {
    if (!open) return

    openedAtRef.current = Date.now()
    updatePosition()

    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      // 1. Ignore events within 300ms of opening
      if (Date.now() - openedAtRef.current < 300) {
        return
      }

      const target = e.target as HTMLElement | null
      if (!target) return

      // 2. Ignore unmounted elements (nodes removed during React re-renders)
      if (!document.body.contains(target)) {
        return
      }

      // 3. Ignore clicks inside root element or menu element
      if (
        rootRef.current?.contains(target) ||
        buttonRef.current?.contains(target) ||
        menuRef.current?.contains(target) ||
        target.closest('[data-dropdown-root="true"]') ||
        target.closest('[data-dropdown-menu="true"]')
      ) {
        return
      }

      setOpen(false)
    }

    const handleScrollOrResize = () => {
      updatePosition()
    }

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleOutsideClick)
      document.addEventListener('touchstart', handleOutsideClick)
      window.addEventListener('scroll', handleScrollOrResize, true)
      window.addEventListener('resize', handleScrollOrResize)
    }, 100)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('touchstart', handleOutsideClick)
      window.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [open, align])

  const hasItems = (items && items.length > 0) || Boolean(children)
  if (!hasItems) return null

  return (
    <div
      ref={rootRef}
      data-dropdown-root="true"
      className="relative inline-block text-left"
      onClick={(e) => {
        e.stopPropagation()
      }}
      onMouseDown={(e) => {
        e.stopPropagation()
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        data-interactive="true"
        onClick={(e) => {
          e.stopPropagation()
          e.nativeEvent?.stopImmediatePropagation?.()
          e.preventDefault()
          if (!open) {
            updatePosition()
            setOpen(true)
          } else {
            // Only allow closing via button if at least 250ms have passed since opening
            if (Date.now() - openedAtRef.current > 250) {
              setOpen(false)
            }
          }
        }}
        className={
          (isIconOnly
            ? 'inline-flex items-center justify-center h-8 w-8 rounded-lg border transition cursor-pointer '
            : 'inline-flex items-center gap-1.5 h-[28px] px-2.5 rounded-md text-[11px] font-semibold border transition cursor-pointer ') +
          (open
            ? 'bg-slate-100 text-slate-900 border-slate-300 shadow-inner'
            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300 shadow-2xs')
        }
      >
        <MoreVertical size={isIconOnly ? 15 : 13} className="opacity-75 pointer-events-none" />
        {buttonLabel && <span className="pointer-events-none">{buttonLabel}</span>}
      </button>

      {open && (
        usePortal ? (
          createPortal(
            <div
              ref={menuRef}
              data-dropdown-menu="true"
              style={{
                position: 'fixed',
                top: `${menuPos.top}px`,
                left: `${menuPos.left}px`,
                width: `${menuPos.width}px`,
                zIndex: 99999
              }}
              className="bg-white border border-slate-200 rounded-xl shadow-lg p-1 animate-in fade-in zoom-in-95 duration-100"
              onClick={(e) => {
                e.stopPropagation()
              }}
              onMouseDown={(e) => {
                e.stopPropagation()
              }}
            >
              {children ? (
                children
              ) : (
                <div className="py-0.5 space-y-0.5">
                  {items?.map((it, idx) => (
                    <button
                      key={it.key || `item_${idx}`}
                      type="button"
                      aria-disabled={it.disabled}
                      title={it.title || it.disabledReason || (it.disabled ? 'Bu işlemi sadece işlemi yapan kullanıcı silebilir' : undefined)}
                      onClick={(e) => {
                        e.stopPropagation()
                        e.nativeEvent?.stopImmediatePropagation?.()
                        e.preventDefault()
                        if (it.disabled) return
                        setOpen(false)
                        it.onClick()
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                      }}
                      className={
                        'w-full px-3 py-1.5 text-left text-xs font-semibold rounded-lg transition flex items-center justify-between ' +
                        (it.disabled
                          ? 'text-slate-300 bg-transparent cursor-not-allowed select-none'
                          : it.danger
                            ? 'text-red-600 hover:bg-red-50 hover:text-red-700 cursor-pointer'
                            : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 cursor-pointer')
                      }
                    >
                      <span className="truncate pointer-events-none">{it.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>,
            document.body
          )
        ) : (
          <div
            ref={menuRef}
            data-dropdown-menu="true"
            className={
              'absolute top-full mt-1.5 z-50 min-w-[180px] bg-white border border-slate-200 rounded-xl shadow-lg p-1 ' +
              (align === 'left' ? 'left-0' : 'right-0')
            }
            onClick={(e) => {
              e.stopPropagation()
            }}
            onMouseDown={(e) => {
              e.stopPropagation()
            }}
          >
            {children ? (
              children
            ) : (
              <div className="py-0.5 space-y-0.5">
                {items?.map((it, idx) => (
                  <button
                    key={it.key || `item_${idx}`}
                    type="button"
                    aria-disabled={it.disabled}
                    onClick={(e) => {
                      e.stopPropagation()
                      e.nativeEvent?.stopImmediatePropagation?.()
                      e.preventDefault()
                      if (it.disabled) return
                      setOpen(false)
                      it.onClick()
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                    }}
                    className={
                      'w-full px-3 py-1.5 text-left text-xs font-semibold rounded-lg transition flex items-center justify-between ' +
                      (it.disabled
                        ? 'text-slate-300 bg-transparent cursor-not-allowed select-none'
                        : it.danger
                          ? 'text-red-600 hover:bg-red-50 hover:text-red-700 cursor-pointer'
                          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 cursor-pointer')
                    }
                  >
                    <span className="truncate pointer-events-none">{it.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}
