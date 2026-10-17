import React from 'react'
import { Search } from 'lucide-react'

type PageHeaderProps = {
  title: string
  breadcrumb: string
  searchValue?: string
  onSearchChange?: (val: string) => void
  searchPlaceholder?: string
  leftActions?: React.ReactNode
  rightActions?: React.ReactNode
}

export default function PageHeader({
  title,
  breadcrumb,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Genel ara...',
  leftActions,
  rightActions
}: PageHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900 tracking-tight">{title}</h1>
        <div className="text-xs text-gray-400 mt-0.5">{breadcrumb}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {leftActions}

        {onSearchChange !== undefined && (
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-[38px] w-[260px] pl-9 pr-3 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition shadow-sm"
            />
          </div>
        )}

        {rightActions}
      </div>
    </div>
  )
}
