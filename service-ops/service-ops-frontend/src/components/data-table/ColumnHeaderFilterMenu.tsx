import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ListFilter } from 'lucide-react'

type Option = { label: string; value: string }

type Props = {
  columnId: string
  title: string
  options: Option[]
  selectedValues: string[]
  onApply: (selected: string[]) => void
}

export function ColumnHeaderFilterMenu({ columnId, title, options, selectedValues, onApply }: Props) {
  const [open, setOpen] = useState(false)
  const [draftSelected, setDraftSelected] = useState<string[]>(selectedValues)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const hasFilter = selectedValues.length > 0 && selectedValues.length < options.length

  const syncPos = () => {
    if (!buttonRef.current) return
    const r = buttonRef.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 220))
    setPos({ top: r.bottom + 4, left })
  }

  const handleToggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!open) {
      setDraftSelected(selectedValues)
      syncPos()
      setOpen(true)
    } else {
      setOpen(false)
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

  const allValues = options.map((o) => o.value)
  const isAllSelected =
    allValues.length > 0 &&
    allValues.every((val) => {
      const opt = options.find((o) => o.value === val)
      return draftSelected.includes(val) || (opt && draftSelected.includes(opt.label))
    })

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setDraftSelected([])
    } else {
      setDraftSelected([...allValues])
    }
  }

  const toggleOption = (opt: Option) => {
    setDraftSelected((prev) => {
      const exists = prev.includes(opt.value) || prev.includes(opt.label)
      if (exists) {
        return prev.filter((v) => v !== opt.value && v !== opt.label)
      } else {
        return [...prev, opt.value]
      }
    })
  }

  const handleTamam = () => {
    onApply(draftSelected)
    setOpen(false)
  }

  const handleIptal = () => {
    setOpen(false)
  }

  return (
    <div className="inline-flex items-center">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggleOpen}
        className={`p-1 rounded transition-colors cursor-pointer ${
          hasFilter ? 'text-red-600 bg-red-50' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-200/60'
        }`}
        title={`${title} Filtresi`}
      >
        <ListFilter size={14} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
            className="z-[9999] w-52 bg-white border border-slate-200 rounded-xl shadow-2xl text-xs overflow-hidden flex flex-col font-sans"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Options List */}
            <div className="p-3 max-h-60 overflow-y-auto space-y-1">
              {/* Select All Row */}
              <div
                onClick={toggleSelectAll}
                className="flex items-center gap-2 cursor-pointer text-slate-800 font-semibold py-1.5 px-2 hover:bg-slate-100 rounded-md transition-colors select-none"
              >
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  readOnly
                  className="w-4 h-4 rounded border-slate-300 text-red-650 focus:ring-red-650 cursor-pointer pointer-events-none"
                />
                <span>Tümünü Seç</span>
              </div>

              <hr className="border-slate-100 my-1" />

              {/* Individual Option Rows */}
              {options.map((opt) => {
                const checked = draftSelected.includes(opt.value) || draftSelected.includes(opt.label)
                return (
                  <div
                    key={opt.value}
                    onClick={() => toggleOption(opt)}
                    className={`flex items-center gap-2 cursor-pointer py-1.5 px-2 rounded-md transition-colors select-none ${
                      checked ? 'bg-red-50/70 text-red-950 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      readOnly
                      className="w-4 h-4 rounded border-slate-300 text-red-650 focus:ring-red-650 cursor-pointer pointer-events-none"
                    />
                    <span>{opt.label}</span>
                  </div>
                )
              })}
            </div>

            {/* Action Footer Buttons */}
            <div className="border-t border-slate-100 p-2.5 bg-slate-50/80 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleIptal}
                className="px-3 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-200/60 rounded transition-colors uppercase cursor-pointer"
              >
                İPTAL
              </button>
              <button
                type="button"
                onClick={handleTamam}
                className="px-3.5 py-1 text-[11px] font-bold bg-[#B91C1C] hover:bg-[#991B1B] text-white rounded transition-colors uppercase shadow-sm cursor-pointer"
              >
                TAMAM
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
