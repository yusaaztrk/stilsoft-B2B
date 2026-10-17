import React from 'react'
import { useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import CurrentSalesReport from './CurrentSalesReport'
import SalesMarketingReports from './SalesMarketingReports'

type LayoutContext = {
  activeMenuId: string
  activeTabId?: string
  setActiveTabId?: (id?: string) => void
}

function PlaceholderView({ title }: { title: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">{title}</h1>
          <p className="text-xs text-gray-400 mt-0.5">Raporlar</p>
        </div>
      </div>
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm px-6 py-10 text-center">
        <div className="text-gray-300 text-2xl mb-1">📊</div>
        <div className="text-xs text-gray-400 font-medium">Bu ekran sonraki adımda birebir yapılacak.</div>
      </div>
    </div>
  )
}

export default function ReportsPage() {
  const { activeTabId } = useOutletContext<LayoutContext>()

  const title = useMemo(() => {
    if (activeTabId === 'cariSatisRaporu') return 'Cari Satış Raporu'
    if (activeTabId === 'satisPazarlamaRaporu') return 'Satış Pazarlama Raporu'
    return 'Rapor'
  }, [activeTabId])

  if (activeTabId === 'cariSatisRaporu') {
    return <CurrentSalesReport />
  }

  if (activeTabId === 'satisPazarlamaRaporu') {
    return <SalesMarketingReports />
  }

  return (
    <div>
      <PlaceholderView title={title} />
    </div>
  )
}
