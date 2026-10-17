import React from 'react'
import { Loader2 } from 'lucide-react'

export default function ReportLoadingState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center bg-slate-900/90 text-white rounded-xl">
      <Loader2 className="w-10 h-10 animate-spin text-emerald-500 mb-4" />
      <h3 className="text-base font-bold tracking-wide">Belge hazırlanıyor...</h3>
      <p className="text-xs text-slate-400 mt-1">Lütfen A4 baskı önizlemesi yüklenirken bekleyin.</p>
    </div>
  )
}
