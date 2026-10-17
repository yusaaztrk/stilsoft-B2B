import React, { useEffect, useRef, useState } from 'react'
import { Eye, Check } from 'lucide-react'
import type { Table } from '@tanstack/react-table'

export function DataTableColumnVisibility<TData>({ table }: { table: Table<TData> }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const hidableColumns = table
    .getAllColumns()
    .filter((col) => typeof col.accessorFn !== 'undefined' && col.getCanHide())

  if (hidableColumns.length === 0) return null

  return (
    <div className="relative inline-block text-left" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="h-9 px-3 text-xs font-semibold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors inline-flex items-center gap-1.5 shadow-sm"
        title="Kolon Görünürlüğü"
      >
        <Eye size={15} className="text-slate-500" />
        <span>Kolonlar</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 w-56 rounded-xl bg-white border border-slate-200 shadow-xl z-30 p-2 text-xs">
          <div className="flex items-center justify-between px-2 py-1 mb-1 border-b border-slate-100 font-bold text-slate-800">
            <span>Sütun Görünürlüğü</span>
            <button
              type="button"
              onClick={() => table.resetColumnVisibility()}
              className="text-[11px] font-semibold text-emerald-600 hover:underline"
            >
              Sıfırla
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto space-y-1 py-1">
            {hidableColumns.map((column) => {
              const label = typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id
              const isChecked = column.getIsVisible()

              return (
                <label
                  key={column.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-slate-700 select-none"
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={column.getToggleVisibilityHandler()}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300"
                  />
                  <span className="truncate">{label}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
