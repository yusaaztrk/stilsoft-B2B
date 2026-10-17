import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'

type Props = {
  label: string
  value: number | string
  /** Önceki eşit uzunluktaki döneme göre yüzde değişim. */
  change?: number
  previous?: number
  suffix?: string
  /** Düşmesi iyi olan metrikler (iptal oranı, süre) için renk mantığı ters çevrilir. */
  invertColor?: boolean
  onClick?: () => void
  hint?: string
}

function formatNumber(v: number | string) {
  if (typeof v === 'string') return v
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(v)
}

export default function KpiCard({ label, value, change, previous, suffix, invertColor, onClick, hint }: Props) {
  const hasChange = typeof change === 'number' && Number.isFinite(change)

  // İptal oranının artması "yeşil" olmamalı: yön iyi mi kötü mü, metriğe göre değişir.
  const good = hasChange ? (invertColor ? change! < 0 : change! > 0) : false
  const neutral = hasChange && Math.abs(change!) < 0.05

  const Icon = neutral ? Minus : (change ?? 0) > 0 ? ArrowUpRight : ArrowDownRight
  const changeColor = neutral ? 'text-gray-400' : good ? 'text-emerald-600' : 'text-rose-600'

  const clickable = typeof onClick === 'function'

  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick!() } : undefined}
      className={
        'bg-white border border-gray-200 rounded-2xl p-3.5 shadow-xs transition ' +
        (clickable ? 'cursor-pointer hover:border-gray-300 hover:shadow-sm active:scale-[0.99]' : '')
      }
    >
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400 truncate">{label}</div>

      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="text-xl font-black text-gray-900 tabular-nums">{formatNumber(value)}</span>
        {suffix && <span className="text-[11px] font-bold text-gray-400">{suffix}</span>}
      </div>

      {hasChange && (
        <div className={`mt-1 flex items-center gap-1 text-[11px] font-bold ${changeColor}`}>
          <Icon size={12} />
          <span className="tabular-nums">%{Math.abs(change!).toFixed(1)}</span>
          {typeof previous === 'number' && (
            <span className="text-gray-400 font-medium">önceki: {formatNumber(previous)}</span>
          )}
        </div>
      )}

      {hint && <div className="mt-1 text-[10px] text-gray-400">{hint}</div>}
    </div>
  )
}
