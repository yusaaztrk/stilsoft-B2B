import { Download } from 'lucide-react'
import { exportRowsToExcel } from './exportExcel'

export type ReportColumn<T> = {
  key: keyof T & string
  header: string
  align?: 'left' | 'right'
  /** Yalnızca görüntüyü biçimler; Excel'e ham değer gider. */
  format?: (row: T) => React.ReactNode
  width?: string
}

type Props<T> = {
  title: string
  subtitle?: string
  columns: ReportColumn<T>[]
  rows: T[]
  loading?: boolean
  onRowClick?: (row: T) => void
  emptyText?: string
  exportable?: boolean
}

/**
 * Rapor ekranlarının paylaştığı tablo. Excel'e aktarım ham veriyle yapılıyor:
 * ekrandaki biçimlenmiş metni aktarmak, sayıları hücrede metne çevirip toplanamaz hale getirir.
 */
export default function ReportTable<T extends Record<string, any>>({
  title,
  subtitle,
  columns,
  rows,
  loading,
  onRowClick,
  emptyText = 'Kayıt bulunamadı',
  exportable = true
}: Props<T>) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-xs overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
        <div>
          <div className="text-xs font-black text-gray-800">{title}</div>
          {subtitle && <div className="text-[10px] text-gray-400 mt-0.5">{subtitle}</div>}
        </div>

        {exportable && (
          <button
            type="button"
            disabled={rows.length === 0}
            onClick={() =>
              exportRowsToExcel<T>(
                columns.map((c) => ({ key: c.key, header: c.header })),
                rows,
                title
              )
            }
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 text-[10px] font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition"
          >
            <Download size={12} />
            Excel
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={
                    'font-bold text-gray-500 uppercase tracking-wide px-3 py-2 whitespace-nowrap ' +
                    (c.align === 'right' ? 'text-right' : 'text-left')
                  }
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && rows.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={columns.length} className="px-3 py-2.5">
                    <div className="h-3 bg-gray-100 rounded animate-pulse" />
                  </td>
                </tr>
              ))
            ) : rows.length > 0 ? (
              rows.map((row, i) => (
                <tr
                  key={i}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={'transition ' + (onRowClick ? 'cursor-pointer hover:bg-gray-50' : 'hover:bg-gray-50/60')}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={
                        'px-3 py-2 text-gray-700 ' +
                        (c.align === 'right' ? 'text-right tabular-nums' : '')
                      }
                    >
                      {c.format ? c.format(row) : formatCell(row[c.key])}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-gray-400">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatCell(value: unknown) {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'number') return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(value)
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır'
  return String(value)
}
