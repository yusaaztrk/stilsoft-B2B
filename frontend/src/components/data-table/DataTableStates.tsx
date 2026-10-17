import React from 'react'
import { AlertCircle, FileX, RefreshCw } from 'lucide-react'

export function TableSkeleton({ columnsCount = 6, rowsCount = 8 }: { columnsCount?: number; rowsCount?: number }) {
  return (
    <>
      {Array.from({ length: rowsCount }).map((_, rIdx) => (
        <tr key={rIdx} className="border-b border-gray-100 animate-pulse">
          {Array.from({ length: columnsCount }).map((_, cIdx) => (
            <td key={cIdx} className="py-3 px-4">
              <div className="h-4 bg-gray-200/80 rounded w-3/4" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

export function TableEmptyState({
  title = 'Kayıt Bulunamadı',
  description = 'Arama kriterlerinize veya filtrenize uygun hiçbir sonuç bulunamadı.',
  onClearFilters
}: {
  title?: string
  description?: string
  onClearFilters?: () => void
}) {
  return (
    <div className="py-12 px-4 text-center flex flex-col items-center justify-center">
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-3">
        <FileX size={24} />
      </div>
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <p className="text-xs text-slate-500 max-w-sm mt-1 mb-4">{description}</p>
      {onClearFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors border border-emerald-200"
        >
          Filtreleri Temizle
        </button>
      )}
    </div>
  )
}

export function TableErrorState({
  error,
  onRetry
}: {
  error: string
  onRetry?: () => void
}) {
  return (
    <div className="p-4 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-between text-rose-800 text-xs my-3">
      <div className="flex items-center gap-2">
        <AlertCircle size={18} className="text-rose-500 shrink-0" />
        <span className="font-semibold">{error}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-colors flex items-center gap-1 shadow-sm"
        >
          <RefreshCw size={12} />
          Yeniden Dene
        </button>
      )}
    </div>
  )
}
