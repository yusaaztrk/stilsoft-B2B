import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import type { FilterOperator } from './types'

type OperatorItem = {
  key: FilterOperator | 'reset'
  label: string
  icon?: string
}

const TEXT_OPERATORS: OperatorItem[] = [
  { key: 'contains', label: 'İçeren', icon: 'abc' },
  { key: 'not_contains', label: 'İçermeyen', icon: 'abc' },
  { key: 'starts_with', label: 'İle başlar', icon: 'abc' },
  { key: 'ends_with', label: 'İle biten', icon: 'abc' },
  { key: 'eq', label: 'Eşittir', icon: '=' },
  { key: 'neq', label: 'Eşit değil', icon: '≠' },
  { key: 'reset', label: 'Sıfırla', icon: '🔍' }
]

const NUMBER_DATE_OPERATORS: OperatorItem[] = [
  { key: 'eq', label: 'Eşittir', icon: '=' },
  { key: 'neq', label: 'Eşit değil', icon: '≠' },
  { key: 'lt', label: 'Daha küçük', icon: '<' },
  { key: 'gt', label: 'Daha büyük', icon: '>' },
  { key: 'lte', label: 'Daha küçük veya eşit', icon: '≤' },
  { key: 'gte', label: 'Daha büyük veya eşit', icon: '≥' },
  { key: 'between', label: 'Arasında', icon: '⟷' },
  { key: 'reset', label: 'Sıfırla', icon: '🔍' }
]

type Props = {
  filterType?: 'text' | 'number' | 'date' | 'select'
  currentOperator: FilterOperator
  onSelectOperator: (op: FilterOperator | null) => void
}

export function FilterOperatorMenu({ filterType = 'text', currentOperator, onSelectOperator }: Props) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const operators = filterType === 'number' || filterType === 'date' ? NUMBER_DATE_OPERATORS : TEXT_OPERATORS

  const syncPos = () => {
    if (!buttonRef.current) return
    const r = buttonRef.current.getBoundingClientRect()
    const left = Math.max(4, Math.min(r.left, window.innerWidth - 180))
    setPos({ top: r.bottom + 2, left })
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

  const getActiveDisplayIcon = () => {
    const active = operators.find((o) => o.key === currentOperator)
    if (!active || active.key === 'contains') {
      return <Search size={13} className="text-slate-500" />
    }
    return <span className="font-bold text-[11px] text-red-600">{active.icon || '='}</span>
  }

  return (
    <div className="relative inline-flex shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          syncPos()
          setOpen((v) => !v)
        }}
        className="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 border-r border-slate-300 text-slate-600 transition-colors cursor-pointer"
        title="Filtre Modu Seç"
      >
        {getActiveDisplayIcon()}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
            className="z-[9999] w-48 bg-white border border-slate-200 rounded-lg shadow-xl py-1 text-xs font-sans"
            onClick={(e) => e.stopPropagation()}
          >
            {operators.map((op) => {
              const isSelected = op.key === currentOperator
              return (
                <button
                  key={op.key}
                  type="button"
                  onClick={() => {
                    if (op.key === 'reset') {
                      onSelectOperator(null)
                    } else {
                      onSelectOperator(op.key as FilterOperator)
                    }
                    setOpen(false)
                  }}
                  className={`w-full px-3 py-1.5 text-left flex items-center gap-2.5 transition-colors cursor-pointer ${
                    isSelected ? 'bg-slate-100 font-semibold text-red-600' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <span className="w-4 text-center font-mono text-[11px] text-slate-400">{op.icon}</span>
                  <span>{op.label}</span>
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </div>
  )
}
