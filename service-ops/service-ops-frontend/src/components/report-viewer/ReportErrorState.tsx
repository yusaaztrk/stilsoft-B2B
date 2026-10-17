import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface ReportErrorStateProps {
  message?: string
  onRetry?: () => void
}

export default function ReportErrorState({
  message = 'Belge yüklenemedi.',
  onRetry,
}: ReportErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center bg-slate-900/90 text-white rounded-xl border border-red-900/40">
      <div className="p-3 bg-red-950/80 border border-red-800/60 rounded-full text-red-400 mb-4">
        <AlertTriangle className="w-8 h-8" />
      </div>
      <h3 className="text-base font-bold tracking-wide text-red-200">{message}</h3>
      <p className="text-xs text-slate-400 mt-1 max-w-md">
        A4 belge ön izlemesi oluşturulurken bir hata meydana geldi. Lütfen tekrar deneyin.
      </p>

      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-xs font-semibold rounded-lg shadow-md transition active:scale-95 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Tekrar Dene
        </button>
      )}
    </div>
  )
}
