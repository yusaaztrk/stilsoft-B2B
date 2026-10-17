import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'

export type ActionDropdownItem = {
  key: string
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}

type Props = {
  buttonLabel?: string
  items?: ActionDropdownItem[]
  children?: React.ReactNode
  align?: 'left' | 'right'
  usePortal?: boolean
}

export default function ActionDropdown({ buttonLabel = 'İşlemler', items, children, align = 'right', usePortal = true }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const isIconOnly = !String(buttonLabel ?? '').trim()
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node
      const inRoot = rootRef.current?.contains(target)
      const inMenu = menuRef.current?.contains(target)
      if (!inRoot && !inMenu) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const syncMenuPos = () => {
    const btn = buttonRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const width = Math.max(180, r.width)
    const left = align === 'left' ? r.left : Math.max(8, r.right - width)

    const spaceBelow = window.innerHeight - r.bottom
    const spaceAbove = r.top

    if (spaceBelow < 350 && spaceAbove > spaceBelow) {
      // Open upwards
      setMenuPos({ bottom: window.innerHeight - r.top + 8, left, width })
    } else {
      // Open downwards
      setMenuPos({ top: r.bottom + 8, left, width })
    }
  }

  useEffect(() => {
    if (!open) return
    syncMenuPos()

    const onScroll = () => {
      syncMenuPos()
    }
    const onResize = () => syncMenuPos()

    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align])

  const menu = useMemo(() => {
    if (children) return children
    if (!items || items.length === 0) return null

    return (
      <div className="py-1">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            disabled={it.disabled}
            onClick={() => {
              if (it.disabled) return
              setOpen(false)
              it.onClick()
            }}
            className={
              'w-full px-3 py-2 text-left text-[11px] font-bold rounded-xl transition flex items-center justify-between ' +
              (it.disabled
                ? 'text-slate-400 cursor-not-allowed'
                : it.danger
                  ? 'text-rose-600 hover:bg-rose-50'
                  : 'text-slate-800 hover:bg-slate-50 hover:text-blue-700')
            }
          >
            <span className="truncate">{it.label}</span>
          </button>
        ))}
      </div>
    )
  }, [children, items])

  if (!menu) return null

  return (
    <div className="relative inline-flex" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          (isIconOnly
            ? 'inline-flex items-center justify-center h-8 w-8 rounded-xl border transition-all '
            : 'inline-flex items-center gap-1.5 h-[28px] px-2.5 rounded-lg text-[11px] font-bold border transition-all ') +
          (open ? 'bg-slate-900 text-white border-slate-900 shadow-sm' : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50 shadow-sm')
        }
      >
        <MoreVertical size={isIconOnly ? 15 : 13} className="opacity-90" />
        <span className="hidden sm:inline">{buttonLabel}</span>
      </button>

      {open &&
        (usePortal
          ? createPortal(
              <div
                ref={menuRef}
                style={{
                  position: 'fixed',
                  top: menuPos?.top !== undefined ? `${menuPos.top}px` : 'auto',
                  bottom: menuPos?.bottom !== undefined ? `${menuPos.bottom}px` : 'auto',
                  left: menuPos?.left ?? 0,
                  width: menuPos?.width ?? 180
                }}
                className="z-[9999] min-w-[185px] max-h-[350px] overflow-y-auto bg-white border border-slate-200/90 rounded-2xl shadow-2xl p-1.5 scrollbar-thin-dark"
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                }}
              >
                {menu}
              </div>,
              document.body
            )
          : (
              <div
                ref={menuRef}
                className={
                  'absolute top-full mt-2 z-50 min-w-[185px] bg-white border border-slate-200/90 rounded-2xl shadow-2xl p-1.5 ' +
                  (align === 'left' ? 'left-0' : 'right-0')
                }
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                }}
              >
                {menu}
              </div>
            ))}
    </div>
  )
}

