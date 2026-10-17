import React, { useEffect, useState } from 'react'
import { Search, X, Calendar, FileSpreadsheet } from 'lucide-react'
import type { Table } from '@tanstack/react-table'
import { DataTableColumnVisibility } from './DataTableColumnVisibility'
import type { DataTableToolbarConfig } from './types'

export function DataTableToolbar<TData>({
  table,
  config,
  globalFilter,
  onGlobalFilterChange,
  showColumnVisibility = true,
  onExportExcel
}: {
  table?: Table<TData>
  config?: DataTableToolbarConfig<TData>
  globalFilter?: string
  onGlobalFilterChange?: (filter: string) => void
  showColumnVisibility?: boolean
  onExportExcel?: () => void
}) {
  const [searchValue, setSearchValue] = useState(globalFilter ?? '')
  const lastEmittedValueRef = React.useRef<string | null>(null)

  useEffect(() => {
    if (globalFilter !== undefined && globalFilter !== lastEmittedValueRef.current && globalFilter !== searchValue) {
      setSearchValue(globalFilter)
    }
  }, [globalFilter])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchValue !== (globalFilter ?? '')) {
        lastEmittedValueRef.current = searchValue
        onGlobalFilterChange?.(searchValue)
      }
    }, config?.searchDebounceMs ?? 300)

    return () => clearTimeout(timer)
  }, [searchValue, globalFilter, onGlobalFilterChange, config?.searchDebounceMs])

  const showSearch = config?.showSearch !== false && typeof onGlobalFilterChange === 'function'

  return (
    <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 p-4 bg-white rounded-t-xl border-b border-slate-100">
      <div className="flex flex-wrap items-center gap-3 flex-1">
        {showSearch && (
          <div className="relative min-w-[240px] max-w-sm flex-1">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <Search size={15} />
            </span>
            <input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder={config?.searchPlaceholder ?? 'Ara...'}
              className="w-full h-9 pl-9 pr-8 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
            />
            {searchValue && (
              <button
                type="button"
                onClick={() => {
                  setSearchValue('')
                  onGlobalFilterChange?.('')
                }}
                className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {config?.dateRange && (
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-1 text-xs">
            <Calendar size={14} className="text-slate-400 ml-1.5 shrink-0" />
            <input
              type="date"
              value={config.dateRange.fromDate ?? ''}
              onChange={(e) => config.dateRange?.onFromDateChange?.(e.target.value)}
              className="h-7 px-2 bg-white border border-slate-200 rounded text-slate-700 focus:outline-none focus:border-emerald-500 text-xs"
            />
            <span className="text-slate-400">-</span>
            <input
              type="date"
              value={config.dateRange.toDate ?? ''}
              onChange={(e) => config.dateRange?.onToDateChange?.(e.target.value)}
              className="h-7 px-2 bg-white border border-slate-200 rounded text-slate-700 focus:outline-none focus:border-emerald-500 text-xs"
            />
          </div>
        )}

        {config?.filterSlot}
      </div>

      <div className="flex items-center gap-2 justify-end shrink-0">
        {config?.rightActionsSlot}
        {table && showColumnVisibility && config?.showColumnVisibility !== false && (
          <DataTableColumnVisibility table={table} />
        )}
      </div>
    </div>
  )
}
