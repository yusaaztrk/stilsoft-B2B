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
}

export default function ActionDropdown({ buttonLabel = 'İşlemler', items, children, align = 'right' }: Props) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [openUpward, setOpenUpward] = useState(false)
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null)

  const isIconOnly = !String(buttonLabel ?? '').trim()

  const syncPos = () => {
    if (!buttonRef.current) return
    const r = buttonRef.current.getBoundingClientRect()
    
    // Check if the space below the button is less than 200px
    const spaceBelow = window.innerHeight - r.bottom
    const shouldOpenUpward = spaceBelow < 200 && r.top > 200

    const left = align === 'left' 
      ? Math.max(4, Math.min(r.left, window.innerWidth - 184))
      : Math.max(4, Math.min(r.right - 180, window.innerWidth - 184))

    if (shouldOpenUpward) {
      setPos({
        bottom: window.innerHeight - r.top + 2,
        left
      })
      setOpenUpward(true)
    } else {
      setPos({
        top: r.bottom + 2,
        left
      })
      setOpenUpward(false)
    }
  }

  useEffect(() => {
    if (!open) return
    syncPos()

    const onDocClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }

    const onScroll = () => syncPos()
    const onResize = () => syncPos()

    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', onDocClick)
      document.addEventListener('touchstart', onDocClick)
    }, 0)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('touchstart', onDocClick)
    }
  }, [open])

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
              'w-full px-3 py-2 text-left text-[12px] font-semibold rounded-md transition flex items-center justify-between ' +
              (it.disabled
                ? 'text-gray-400 cursor-not-allowed'
                : it.danger
                  ? 'text-red-700 hover:bg-red-50'
                  : 'text-gray-700 hover:bg-gray-50')
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
    <div className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          syncPos()
          setOpen((v) => !v)
        }}
        className={
          (isIconOnly
            ? 'inline-flex items-center justify-center h-9 w-9 rounded-xl border transition '
            : 'inline-flex items-center gap-1.5 h-[26px] px-2.5 rounded-md text-[11px] font-semibold border transition ') +
          (open ? 'bg-gray-100 text-gray-900 border-gray-300' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
        }
      >
        <MoreVertical size={isIconOnly ? 16 : 14} className="opacity-80" />
        <span className="hidden sm:inline">{buttonLabel}</span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: 'fixed',
              top: pos.top !== undefined ? `${pos.top}px` : undefined,
              bottom: pos.bottom !== undefined ? `${pos.bottom}px` : undefined,
              left: `${pos.left}px`
            }}
            className="z-[9999] min-w-[180px] bg-white border border-gray-200 rounded-xl shadow-[0_14px_40px_-20px_rgba(0,0,0,0.35)] p-1"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
            }}
          >
            {menu}
          </div>,
          document.body
        )}
    </div>
  )
}
