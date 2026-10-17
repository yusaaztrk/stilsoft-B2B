import React from 'react'
import { OverflowTooltip } from '../common/OverflowTooltip'

export type DataGridColumn<Row> = {
  key: string
  header: React.ReactNode
  width: number
  align?: 'left' | 'right' | 'center'
  pin?: 'left' | 'right'
  render: (row: Row) => React.ReactNode
}

type Props<Row> = {
  columns: Array<DataGridColumn<Row>>
  rows: Row[]
  rowKey: (row: Row) => string
  onRowClick?: (row: Row) => void
  rowClassName?: (row: Row) => string
  isLoading?: boolean
  emptyText?: string
  heightClassName?: string
}

function alignClass(align: Props<any>['columns'][number]['align']) {
  if (align === 'right') return 'text-right'
  if (align === 'center') return 'text-center'
  return 'text-left'
}

export default function DataGrid<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowClassName,
  isLoading,
  emptyText,
  heightClassName
}: Props<Row>) {
  const totalWidth = columns.reduce((sum, c) => sum + (Number(c.width) || 0), 0)

  const topScrollRef = React.useRef<HTMLDivElement | null>(null)
  const bodyScrollRef = React.useRef<HTMLDivElement | null>(null)
  const syncingRef = React.useRef(false)

  const syncScrollLeft = (src: 'top' | 'body') => {
    const top = topScrollRef.current
    const body = bodyScrollRef.current
    if (!top || !body) return

    if (syncingRef.current) return
    syncingRef.current = true

    if (src === 'top') {
      body.scrollLeft = top.scrollLeft
    } else {
      top.scrollLeft = body.scrollLeft
    }

    // release in next frame to avoid feedback loop
    requestAnimationFrame(() => {
      syncingRef.current = false
    })
  }

  const pinnedLeftOffsetByKey = React.useMemo(() => {
    const out: Record<string, number> = {}
    let acc = 0
    for (const c of columns) {
      if (c.pin === 'left') {
        out[c.key] = acc
        acc += Number(c.width) || 0
      }
    }
    return out
  }, [columns])

  const pinnedRightOffsetByKey = React.useMemo(() => {
    const out: Record<string, number> = {}
    let acc = 0
    for (let i = columns.length - 1; i >= 0; i--) {
      const c = columns[i]!
      if (c.pin === 'right') {
        out[c.key] = acc
        acc += Number(c.width) || 0
      }
    }
    return out
  }, [columns])

  const cellPinnedStyle = (c: Props<any>['columns'][number]) => {
    if (c.pin === 'left') {
      return { position: 'sticky' as const, left: pinnedLeftOffsetByKey[c.key] ?? 0 }
    }
    if (c.pin === 'right') {
      return { position: 'sticky' as const, right: pinnedRightOffsetByKey[c.key] ?? 0 }
    }
    return undefined
  }

  const pinnedClass = (c: Props<any>['columns'][number]) => {
    if (c.pin === 'left') return 'z-20 '
    if (c.pin === 'right') return 'z-20 '
    return ''
  }

  return (
    <div className={'bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden flex flex-col ' + (heightClassName ?? '')}>
      <div
        ref={topScrollRef}
        onScroll={() => syncScrollLeft('top')}
        className="w-full overflow-x-auto overflow-y-hidden border-b border-gray-200"
      >
        <div style={{ width: totalWidth, height: 1 }} />
      </div>

      <div ref={bodyScrollRef} onScroll={() => syncScrollLeft('body')} className="w-full flex-1 overflow-auto">
        <table className="w-full table-fixed" style={{ minWidth: totalWidth }}>
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-gray-100 border-b border-gray-300">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={
                    'px-3 py-2 text-[11px] font-semibold text-gray-700 uppercase tracking-wide sticky top-0 bg-gray-100 z-10 ' +
                    pinnedClass(c) +
                    alignClass(c.align)
                  }
                  style={cellPinnedStyle(c)}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-3 text-xs text-gray-500">
                  Yükleniyor...
                </td>
              </tr>
            )}

            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-xs text-gray-500">
                  {emptyText ?? 'Kayıt bulunamadı.'}
                </td>
              </tr>
            )}

            {!isLoading &&
              rows.map((row, idx) => (
                <tr
                  key={rowKey(row)}
                  onClick={() => onRowClick?.(row)}
                  className={
                    'border-b border-gray-200 hover:bg-gray-50 transition-colors ' +
                    (onRowClick ? 'cursor-pointer ' : '') +
                    (idx % 2 === 1 ? 'bg-gray-50/40' : 'bg-white') +
                    (rowClassName ? ' ' + rowClassName(row) : '')
                  }
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={
                        'px-3 py-2 text-sm text-gray-800 ' +
                        (c.pin ? (idx % 2 === 1 ? 'bg-gray-50/40 ' : 'bg-white ') : '') +
                        pinnedClass(c) +
                        alignClass(c.align)
                      }
                      style={cellPinnedStyle(c)}
                    >
                      <OverflowTooltip className="truncate">{c.render(row)}</OverflowTooltip>
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
