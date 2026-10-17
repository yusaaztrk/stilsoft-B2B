import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import { ArrowUpDown, ListFilter } from 'lucide-react'
import ColumnFilterSearchBar, { type ColumnFilterKind } from './table/ColumnFilterSearchBar'
import { OverflowTooltip } from './common/OverflowTooltip'

export type TableColumn<Row> = {
  key: keyof Row
  label: string
  sortable?: boolean
  searchable?: boolean
  filter?:
    | { type: 'text' }
    | { type: 'number' }
    | { type: 'select'; options: Array<{ label: string; value: string }> }
    | { type: 'date' }
  render?: (value: Row[keyof Row], row: Row) => React.ReactNode
}

type Props<Row> = {
  columns: TableColumn<Row>[]
  data: Row[]
  onRowClick?: (row: Row) => void
  rowKey?: (row: Row, index: number) => string | number
  rowClassName?: (row: Row) => string
  showColumnFilters?: boolean
  globalSearch?: string
  initialHeaderFilters?: Record<string, string[]>
  initialColumnFilters?: Record<string, { op?: string; v1?: string; v2?: string }>
  onFilteredDataChange?: (rows: Row[]) => void
  isRowExpanded?: (row: Row) => boolean
  onToggleRowExpanded?: (row: Row) => void
  renderExpandedRow?: (row: Row) => React.ReactNode
  rowHeight?: number
  containerHeight?: number
}

export default function VirtualizedTable<Row extends Record<string, any>>({
  columns,
  data,
  onRowClick,
  rowKey,
  rowClassName,
  showColumnFilters,
  globalSearch,
  initialHeaderFilters,
  initialColumnFilters,
  onFilteredDataChange,
  isRowExpanded,
  onToggleRowExpanded,
  renderExpandedRow,
  rowHeight = 42,
  containerHeight = 600
}: Props<Row>) {
  const [scrollTop, setScrollTop] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({})
  const [activeFilterKey, setActiveFilterKey] = useState<string | null>(null)
  const [selectedValues, setSelectedValues] = useState<Record<string, string[]>>(() => {
    const init = initialHeaderFilters ?? {}
    const out: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(init)) {
      const list = (v ?? []).map((x) => String(x ?? '').trim()).filter((x) => x.length > 0)
      if (list.length) out[k] = list
    }
    return out
  })
  const [filterOps, setFilterOps] = useState<Record<string, string>>(() => {
    const init = initialColumnFilters ?? {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(init)) {
      if (v?.op) out[k] = String(v.op)
    }
    return out
  })
  const [filters, setFilters] = useState<Record<string, { v1: string; v2: string }>>(() => {
    const init = initialColumnFilters ?? {}
    const out: Record<string, { v1: string; v2: string }> = {}
    for (const [k, v] of Object.entries(init)) {
      const v1 = String(v?.v1 ?? '').trim()
      const v2 = String(v?.v2 ?? '').trim()
      if (v1 || v2) out[k] = { v1, v2 }
    }
    return out
  })

  // Sorting state
  const [sortKey, setSortKey] = useState<keyof Row | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const getColKind = useCallback(
    (col: TableColumn<Row>): ColumnFilterKind => {
      if (col.filter?.type === 'date') return 'date'
      if (col.filter?.type === 'number') return 'number'
      if (col.filter?.type === 'select') return 'select'
      if (!showColumnFilters || !col.searchable) return 'text'
      return 'text'
    },
    [showColumnFilters]
  )

  const getDefaultOp = useCallback((kind: ColumnFilterKind) => {
    if (kind === 'date') return 'equals'
    if (kind === 'number') return 'eq'
    if (kind === 'select') return 'eq'
    return 'contains'
  }, [])

  // Filter & Sort Data
  const sortedAndFilteredData = useMemo(() => {
    let result = [...data]

    // Global Search
    if (globalSearch && globalSearch.trim()) {
      const term = globalSearch.trim().toLowerCase()
      result = result.filter((row) =>
        columns.some((col) => {
          const val = row[col.key]
          if (val === null || val === undefined) return false
          return String(val).toLowerCase().includes(term)
        })
      )
    }

    // Column Filters
    for (const col of columns) {
      const key = String(col.key)
      const fv = filters[key]
      if (!fv || (!fv.v1 && !fv.v2)) continue

      const kind = getColKind(col)
      const op = filterOps[key] ?? getDefaultOp(kind)

      result = result.filter((row) => {
        const val = row[col.key]
        if (val === null || val === undefined) return false
        const strVal = String(val).toLowerCase()
        const v1Lower = fv.v1.toLowerCase()

        if (op === 'contains') return strVal.includes(v1Lower)
        if (op === 'equals' || op === 'eq') return strVal === v1Lower
        if (op === 'starts') return strVal.startsWith(v1Lower)
        if (op === 'ends') return strVal.endsWith(v1Lower)
        return true
      })
    }

    // Sorting
    if (sortKey) {
      result.sort((a, b) => {
        const aVal = a[sortKey]
        const bVal = b[sortKey]

        if (aVal === bVal) return 0
        if (aVal === null || aVal === undefined) return 1
        if (bVal === null || bVal === undefined) return -1

        let cmp = 0
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          cmp = aVal - bVal
        } else {
          cmp = String(aVal).localeCompare(String(bVal), 'tr-TR', { numeric: true })
        }

        return sortDirection === 'asc' ? cmp : -cmp
      })
    }

    return result
  }, [data, columns, globalSearch, filters, filterOps, sortKey, sortDirection, getColKind, getDefaultOp])

  useEffect(() => {
    if (onFilteredDataChange) {
      onFilteredDataChange(sortedAndFilteredData)
    }
  }, [sortedAndFilteredData, onFilteredDataChange])

  // Virtualization Calculations
  const totalCount = sortedAndFilteredData.length
  const totalHeight = totalCount * rowHeight

  const overscan = 8
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const endIndex = Math.min(totalCount, Math.ceil((scrollTop + containerHeight) / rowHeight) + overscan)

  const visibleRows = useMemo(() => {
    return sortedAndFilteredData.slice(startIndex, endIndex)
  }, [sortedAndFilteredData, startIndex, endIndex])

  const topPadding = startIndex * rowHeight
  const bottomPadding = Math.max(0, totalHeight - endIndex * rowHeight)

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }

  const handleSort = (key: keyof Row) => {
    if (sortKey === key) {
      if (sortDirection === 'asc') setSortDirection('desc')
      else {
        setSortKey(null)
        setSortDirection('asc')
      }
    } else {
      setSortKey(key)
      setSortDirection('asc')
    }
  }

  return (
    <div className="w-full bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col">
      {/* Scrollable Container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{ maxHeight: `${containerHeight}px` }}
        className="overflow-y-auto overflow-x-auto relative custom-scrollbar"
      >
        <table className="w-full text-left text-xs border-collapse min-w-[1200px]">
          <thead className="sticky top-0 z-20 bg-slate-100/95 backdrop-blur-md shadow-xs">
            <tr className="border-b border-slate-200 text-slate-700 font-bold">
              {columns.map((col, colIdx) => (
                <th
                  key={`${String(col.key)}_${colIdx}`}
                  className="px-3 py-2.5 select-none relative"
                >
                  <div
                    className={`flex items-center gap-1.5 ${
                      col.sortable !== false ? 'cursor-pointer hover:text-blue-600' : ''
                    }`}
                    onClick={() => col.sortable !== false && handleSort(col.key)}
                  >
                    <OverflowTooltip as="span">{col.label}</OverflowTooltip>
                    {col.sortable !== false && (
                      <ArrowUpDown
                        size={13}
                        className={
                          sortKey === col.key ? 'text-blue-600 font-bold' : 'text-slate-400 opacity-60'
                        }
                      />
                    )}
                  </div>
                </th>
              ))}
            </tr>

            {showColumnFilters && (
              <tr className="bg-slate-50 border-b border-slate-200">
                {columns.map((col, colIdx) => (
                  <th key={`filter_${String(col.key)}_${colIdx}`} className="px-2 py-1.5">
                    {col.searchable ? (
                      (() => {
                        const key = String(col.key)
                        const kind = getColKind(col)
                        const op = String(filterOps[key] ?? getDefaultOp(kind))
                        const fv = filters[key] ?? { v1: '', v2: '' }
                        const selectOptions = col.filter?.type === 'select' ? col.filter.options : undefined

                        return (
                          <ColumnFilterSearchBar
                            kind={kind}
                            op={op}
                            v1={String(fv.v1 ?? '')}
                            v2={String(fv.v2 ?? '')}
                            options={
                              kind === 'select'
                                ? (selectOptions ?? []).map((o) => ({ label: String(o.label ?? ''), value: String(o.value ?? '') }))
                                : undefined
                            }
                            allLabel={kind === 'select' ? '(Tümü)' : undefined}
                            onOpChange={(nextOp) => {
                              setFilterOps((p) => ({ ...p, [key]: nextOp }))
                              setFilters((p) => {
                                const prev = p[key] ?? { v1: '', v2: '' }
                                return { ...p, [key]: { v1: prev.v1, v2: nextOp === 'between' ? prev.v2 : '' } }
                              })
                            }}
                            onChangeV1={(value) => setFilters((p) => ({ ...p, [key]: { v1: value, v2: p[key]?.v2 ?? '' } }))}
                            onChangeV2={(value) => setFilters((p) => ({ ...p, [key]: { v1: p[key]?.v1 ?? '', v2: value } }))}
                            onClear={() => {
                              setFilterOps((p) => {
                                const next = { ...p }
                                delete next[key]
                                return next
                              })
                              setFilters((p) => {
                                const next = { ...p }
                                delete next[key]
                                return next
                              })
                            }}
                          />
                        )
                      })()
                    ) : (
                      <div className="h-6" />
                    )}
                  </th>
                ))}
              </tr>
            )}
          </thead>

          <tbody className="divide-y divide-slate-100">
            {/* Top Spacer for Virtualization */}
            {topPadding > 0 && (
              <tr>
                <td colSpan={columns.length} style={{ height: `${topPadding}px` }} />
              </tr>
            )}

            {/* Visible Rows */}
            {visibleRows.map((row, idx) => {
              const actualIndex = startIndex + idx
              const rowKeyValue = rowKey ? rowKey(row, actualIndex) : actualIndex
              const rowKeyStr = String(rowKeyValue)
              const hasExpanded = typeof renderExpandedRow === 'function'
              const isExpanded = isRowExpanded
                ? Boolean(isRowExpanded(row))
                : expandedKeys[rowKeyStr] === true

              return (
                <React.Fragment key={rowKeyStr}>
                  <tr
                    style={{ height: `${rowHeight}px` }}
                    onClick={() => {
                      if (hasExpanded) {
                        if (onToggleRowExpanded) onToggleRowExpanded(row)
                        else setExpandedKeys((p) => ({ ...p, [rowKeyStr]: !p[rowKeyStr] }))
                      }
                      onRowClick?.(row)
                    }}
                    className={`hover:bg-slate-50 cursor-pointer transition-colors bg-white font-medium ${
                      rowClassName ? rowClassName(row) : ''
                    }`}
                  >
                    {columns.map((col, colIdx) => (
                      <td key={`${String(col.key)}_${colIdx}`} className="px-3 py-2 text-slate-800 whitespace-nowrap max-w-xs">
                        <OverflowTooltip>
                          {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '')}
                        </OverflowTooltip>
                      </td>
                    ))}
                  </tr>

                  {hasExpanded && isExpanded && (
                    <tr className="bg-slate-50">
                      <td colSpan={columns.length} className="px-4 py-3 border-t border-slate-200">
                        {renderExpandedRow?.(row)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}

            {/* Bottom Spacer for Virtualization */}
            {bottomPadding > 0 && (
              <tr>
                <td colSpan={columns.length} style={{ height: `${bottomPadding}px` }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer Info */}
      <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex justify-between items-center font-medium">
        <span>Toplam Satır: <strong className="text-slate-900">{totalCount.toLocaleString('tr-TR')}</strong></span>
        <span>Sanal Performans Modu: Aktif (60 FPS)</span>
      </div>
    </div>
  )
}
