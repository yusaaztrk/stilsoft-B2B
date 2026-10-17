import { ArrowUpDown, ListFilter } from 'lucide-react'
import React from 'react'
import ColumnFilterSearchBar, { type ColumnFilterKind } from './table/ColumnFilterSearchBar'
import AyarliTablo from './table/AyarliTablo'

export type TableColumn<Row> = {
  key: keyof Row
  label: string
  sortable?: boolean
  searchable?: boolean
  filter?:
  | {
    type: 'text'
  }
  | {
    type: 'select'
    options: Array<{ label: string; value: string }>
  }
  | {
    type: 'date'
  }
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
}

export default function Table<Row extends Record<string, any>>({
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
  renderExpandedRow
}: Props<Row>) {
  const [expandedKeys, setExpandedKeys] = React.useState<Record<string, boolean>>({})
  const [activeFilterKey, setActiveFilterKey] = React.useState<string | null>(null)
  const [selectedValues, setSelectedValues] = React.useState<Record<string, string[]>>(() => {
    const init = initialHeaderFilters ?? {}
    const out: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(init)) {
      const list = (v ?? []).map((x) => String(x ?? '').trim()).filter((x) => x.length > 0)
      if (list.length) out[k] = list
    }
    return out
  })
  const [draftValues, setDraftValues] = React.useState<Record<string, string[]>>({})
  const [filterOps, setFilterOps] = React.useState<Record<string, string>>(() => {
    const init = initialColumnFilters ?? {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(init)) {
      if (v?.op) out[k] = String(v.op)
    }
    return out
  })
  const [filters, setFilters] = React.useState<Record<string, { v1: string; v2: string }>>(() => {
    const init = initialColumnFilters ?? {}
    const out: Record<string, { v1: string; v2: string }> = {}
    for (const [k, v] of Object.entries(init)) {
      const v1 = String(v?.v1 ?? '').trim()
      const v2 = String(v?.v2 ?? '').trim()
      if (v1 || v2) out[k] = { v1, v2 }
    }
    return out
  })
  const filterPanelRef = React.useRef<HTMLDivElement | null>(null)

  const columnOptions = React.useMemo(() => {
    const out: Record<string, string[]> = {}
    if (!showColumnFilters) return out
    for (const col of columns) {
      if (!col.searchable) continue
      const key = String(col.key)
      const values = new Set<string>()
      for (const row of data) {
        values.add(String(row[col.key] ?? '').trim())
      }
      out[key] = Array.from(values).filter((v) => v.length > 0).sort((a, b) => a.localeCompare(b))
    }
    return out
  }, [columns, data, showColumnFilters])

  React.useEffect(() => {
    if (!activeFilterKey) return
    const handleClick = (event: MouseEvent) => {
      if (!filterPanelRef.current) return
      if (!filterPanelRef.current.contains(event.target as Node)) {
        setActiveFilterKey(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [activeFilterKey])

  const normalizeDateValue = (value: string) => {
    const raw = value.trim()
    if (!raw) return ''
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (iso) return `${iso[1]}${iso[2]}${iso[3]}`
    const dotted = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
    if (dotted) return `${dotted[3]}${dotted[2]}${dotted[1]}`
    return raw
  }

  const normalizeNumberValue = (value: string) => {
    const raw = String(value ?? '').trim()
    if (!raw) return null
    const n = Number(raw.replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }

  const getColKind = React.useCallback(
    (col: TableColumn<Row>): ColumnFilterKind => {
      if (col.filter?.type === 'date') return 'date'
      if (col.filter?.type === 'select') return 'select'
      if (!showColumnFilters || !col.searchable) return 'text'

      const key = String(col.key)
      const vals = columnOptions[key] ?? []
      if (!vals.length) return 'text'

      let numericCount = 0
      let total = 0
      for (const v of vals) {
        const t = String(v ?? '').trim()
        if (!t) continue
        total += 1
        const n = normalizeNumberValue(t)
        if (n != null) numericCount += 1
      }
      if (total > 0 && numericCount === total) return 'number'
      return 'text'
    },
    [columnOptions, normalizeNumberValue, showColumnFilters]
  )

  const getDefaultOp = React.useCallback((kind: ColumnFilterKind) => {
    return kind === 'text' ? 'contains' : 'eq'
  }, [])

  const filteredData = React.useMemo(() => {
    const activeFilters = showColumnFilters ? Object.entries(selectedValues).filter(([, v]) => (v ?? []).length > 0) : []
    const activeTextFilters = showColumnFilters
      ? columns
        .filter((c) => c.searchable)
        .map((c) => {
          const key = String(c.key)
          const kind = getColKind(c)
          const op = String(filterOps[key] ?? getDefaultOp(kind))
          const fv = filters[key] ?? { v1: '', v2: '' }
          return { key, col: c, kind, op, v1: String(fv.v1 ?? '').trim(), v2: String(fv.v2 ?? '').trim() }
        })
        .filter((x) => x.v1.length > 0 || (x.op === 'between' && x.v2.length > 0))
      : []

    const byColumn =
      activeFilters.length === 0
        ? data
        : data.filter((row) => {
          for (const [key, list] of activeFilters) {
            const raw = row[key as keyof Row]
            const cell = String(raw ?? '').toLowerCase()
            if (!list.map((v) => v.toLowerCase()).includes(cell)) return false
          }

          return true
        })

    const byText =
      activeTextFilters.length === 0
        ? byColumn
        : byColumn.filter((row) => {
          for (const f of activeTextFilters) {
            const raw = row[f.col.key as keyof Row]
            if (f.kind === 'date') {
              const cell = normalizeDateValue(String(raw ?? '').slice(0, 10))
              const q1 = normalizeDateValue(f.v1)
              const q2 = normalizeDateValue(f.v2)
              if (!cell) return false

              const cellNum = Number(cell)
              const q1Num = q1 ? Number(q1) : NaN
              const q2Num = q2 ? Number(q2) : NaN

              if (f.op === 'between') {
                if (!q1 || !q2) return false
                const a = Math.min(q1Num, q2Num)
                const b = Math.max(q1Num, q2Num)
                if (!(cellNum >= a && cellNum <= b)) return false
                continue
              }

              if (!q1) return false
              if (f.op === 'eq' && cellNum !== q1Num) return false
              if (f.op === 'neq' && cellNum === q1Num) return false
              if (f.op === 'lt' && !(cellNum < q1Num)) return false
              if (f.op === 'gt' && !(cellNum > q1Num)) return false
              if (f.op === 'lte' && !(cellNum <= q1Num)) return false
              if (f.op === 'gte' && !(cellNum >= q1Num)) return false
              continue
            }

            if (f.kind === 'number') {
              const cellNum = normalizeNumberValue(String(raw ?? ''))
              const q1Num = normalizeNumberValue(f.v1)
              const q2Num = normalizeNumberValue(f.v2)
              if (cellNum == null) return false

              if (f.op === 'between') {
                if (q1Num == null || q2Num == null) return false
                const a = Math.min(q1Num, q2Num)
                const b = Math.max(q1Num, q2Num)
                if (!(cellNum >= a && cellNum <= b)) return false
                continue
              }

              if (q1Num == null) return false
              if (f.op === 'eq' && cellNum !== q1Num) return false
              if (f.op === 'neq' && cellNum === q1Num) return false
              if (f.op === 'lt' && !(cellNum < q1Num)) return false
              if (f.op === 'gt' && !(cellNum > q1Num)) return false
              if (f.op === 'lte' && !(cellNum <= q1Num)) return false
              if (f.op === 'gte' && !(cellNum >= q1Num)) return false
              continue
            }

            if (f.kind === 'select') {
              const q = f.v1.trim().toLowerCase()
              if (!q) continue

              const cell =
                typeof raw === 'boolean'
                  ? raw
                    ? 'evet'
                    : 'hayır'
                  : String(raw ?? '').trim().toLowerCase()
              if (cell !== q) return false
              continue
            }

            const cell = String(raw ?? '').toLowerCase()
            const q = f.v1.toLowerCase()
            if (f.op === 'contains' && !cell.includes(q)) return false
            if (f.op === 'not_contains' && cell.includes(q)) return false
            if (f.op === 'starts_with' && !cell.startsWith(q)) return false
            if (f.op === 'ends_with' && !cell.endsWith(q)) return false
            if (f.op === 'eq' && cell !== q) return false
            if (f.op === 'neq' && cell === q) return false
          }
          return true
        })

    const gs = String(globalSearch ?? '').trim().toLowerCase()
    if (!gs) return byText

    const keys = columns.map((c) => c.key)
    return byText.filter((row) => {
      for (const k of keys) {
        const cell = String(row[k as any] ?? '').toLowerCase()
        if (cell.includes(gs)) return true
      }
      return false
    })
  }, [columns, data, filters, filterOps, getColKind, getDefaultOp, globalSearch, selectedValues, showColumnFilters])

  React.useEffect(() => {
    onFilteredDataChange?.(filteredData)
  }, [filteredData, onFilteredDataChange])

  const renderFilterPanel = (key: string, label: string) => (
    <div
      ref={filterPanelRef}
      className="absolute left-0 top-full mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase tracking-wider bg-slate-50">{label}</div>

      <div className="max-h-56 overflow-auto px-3 py-2 text-xs">
        {columnOptions[key]?.length ? (
          <label className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={(draftValues[key] ?? []).length === columnOptions[key].length}
              onChange={(e) => {
                const allValues = columnOptions[key] ?? []
                setDraftValues((p) => ({ ...p, [key]: e.target.checked ? allValues : [] }))
              }}
            />
            Tümünü seç
          </label>
        ) : null}

        {columnOptions[key]?.length ? (
          columnOptions[key].map((opt) => (
            <label key={opt} className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                checked={(draftValues[key] ?? []).includes(opt)}
                onChange={(e) => {
                  const current = new Set(draftValues[key] ?? [])
                  if (e.target.checked) current.add(opt)
                  else current.delete(opt)
                  setDraftValues((p) => ({ ...p, [key]: Array.from(current) }))
                }}
              />
              {opt || '(Boş)'}
            </label>
          ))
        ) : (
          <div className="text-slate-400 py-4">Gösterilecek bilgi yok</div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-slate-100 bg-slate-50">
        <button type="button" className="text-xs font-bold text-slate-500 hover:text-slate-700" onClick={() => setActiveFilterKey(null)}>
          İPTAL
        </button>
        <button
          type="button"
          className="text-xs font-bold text-blue-700 hover:text-blue-800"
          onClick={() => {
            setSelectedValues((p) => ({ ...p, [key]: draftValues[key] ?? [] }))
            setActiveFilterKey(null)
          }}
        >
          TAMAM
        </button>
      </div>
    </div>
  )

  return (
    <div className="bg-white rounded-2xl shadow-card overflow-x-auto scrollbar-thin-dark relative border border-slate-200/90">
      <AyarliTablo>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-slate-50/90 border-b border-slate-200">
            {columns.map((col, colIdx) => {
              const isActions = col.key === 'actions'
              return (
                <th
                  key={`${String(col.key)}_${colIdx}`}
                  className={`px-2.5 py-3 text-left text-[10px] font-extrabold text-slate-600 uppercase tracking-wider relative ${
                    isActions
                      ? 'sticky right-0 bg-slate-50 z-20 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.1)] border-l border-slate-200'
                      : 'border-r border-slate-100 last:border-r-0'
                  }`}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {col.sortable && <ArrowUpDown size={12} className="text-slate-400" />}
                    {showColumnFilters && col.searchable && (
                      <button
                        type="button"
                        className="ml-1 inline-flex items-center justify-center w-6 h-6 rounded-lg hover:bg-slate-200 text-slate-400 border border-transparent"
                        title="Filtrele"
                        onClick={(e) => {
                          e.stopPropagation()
                          const key = String(col.key)
                          setActiveFilterKey((prev) => (prev === key ? null : key))
                          setDraftValues((p) => ({ ...p, [key]: selectedValues[key] ?? [] }))
                        }}
                      >
                        <ListFilter size={12} />
                      </button>
                    )}
                  </div>
                  {showColumnFilters && col.searchable && activeFilterKey === String(col.key) &&
                    renderFilterPanel(String(col.key), col.label)}
                </th>
              )
            })}
          </tr>
          {showColumnFilters && (
            <tr className="bg-white border-b border-slate-200">
              {columns.map((col, colIdx) => {
                const isActions = col.key === 'actions'
                return (
                  <th
                    key={`${String(col.key)}_${colIdx}`}
                    className={`px-2 py-2 relative ${
                      isActions
                        ? 'sticky right-0 bg-white z-20 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.15)] border-l border-slate-200'
                        : 'border-r border-slate-100 last:border-r-0'
                    }`}
                  >
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
                )
              })}
            </tr>
          )}
        </thead>

        <tbody>
          {filteredData.map((row, idx) => {
            const rowKeyValue = rowKey ? rowKey(row, idx) : idx
            const rowKeyStr = String(rowKeyValue)
            const hasExpanded = typeof renderExpandedRow === 'function'

            const isExpanded = isRowExpanded
              ? Boolean(isRowExpanded(row))
              : expandedKeys[rowKeyStr] === true

            return (
              <React.Fragment key={rowKeyStr}>
                <tr
                  onClick={() => {
                    if (hasExpanded) {
                      if (onToggleRowExpanded) onToggleRowExpanded(row)
                      else setExpandedKeys((p) => ({ ...p, [rowKeyStr]: !p[rowKeyStr] }))
                    }
                    onRowClick?.(row)
                  }}
                  className={
                    'border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors bg-white' +
                    (rowClassName ? ' ' + rowClassName(row) : '')
                  }
                >
                  {columns.map((col, colIdx) => {
                    const isActions = col.key === 'actions'
                    return (
                      <td
                        key={`${String(col.key)}_${colIdx}`}
                        className={`px-2 py-2 text-[11px] text-slate-700 ${
                          isActions
                            ? 'sticky right-0 bg-inherit z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.15)] border-l border-slate-200'
                            : 'border-r border-slate-100 last:border-r-0'
                        }`}
                      >
                        {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? '')}
                      </td>
                    )
                  })}
                </tr>

                {hasExpanded && isExpanded ? (
                  <tr className="bg-slate-50/50">
                    <td colSpan={columns.length} className="px-3 py-4 border-b border-slate-100">
                      {renderExpandedRow?.(row)}
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
      </AyarliTablo>
    </div>
  )
}
