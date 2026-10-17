import React from 'react'
import { useMemo } from 'react'
import { useParams } from 'react-router-dom'

export default function ReportPlaceholderPage() {
  const params = useParams()
  const reportId = String(params.reportId ?? '')

  const title = useMemo(() => {
    if (!reportId) return 'Reports'
    return reportId
      .split('-')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  }, [reportId])

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">{title}</h1>
          <p className="text-xs text-gray-400 mt-0.5">Raporlar</p>
        </div>
      </div>
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm px-6 py-10 text-center">
        <div className="text-gray-300 text-2xl mb-1">📊</div>
        <div className="text-xs text-gray-400 font-medium">Bu rapor sayfası henüz uygulanmadı.</div>
      </div>
    </div>
  )
}
