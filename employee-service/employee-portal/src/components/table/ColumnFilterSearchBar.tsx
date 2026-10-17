import React from 'react'
import ReactDOM from 'react-dom'
import { Search } from 'lucide-react'

export type ColumnFilterKind = 'text' | 'number' | 'date' | 'select'

type SelectOption = string | { label: string; value: string }

type Props = {
  kind: ColumnFilterKind
  op: string
  v1: string
  v2: string
  onOpChange: (next: string) => void
  onChangeV1: (next: string) => void
  onChangeV2: (next: string) => void
  onClear: () => void
  options?: SelectOption[]
  allLabel?: string
}

const ColumnFilterSearchBar = React.memo(function ColumnFilterSearchBar({
  kind,
  op,
  v1,
  v2,
  onOpChange,
  onChangeV1,
  onChangeV2,
  onClear,
  options,
  allLabel
}: Props) {
  const [open, setOpen] = React.useState(false)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const anchorRef = React.useRef<HTMLButtonElement | null>(null)
  const [menuPos, setMenuPos] = React.useState<{ left: number; top: number; placement: 'down' | 'up' }>({ left: 0, top: 0, placement: 'down' })

  React.useEffect(() => {
    if (!open) return
    const handleClick = (event: MouseEvent) => {
      if (!panelRef.current) return
      if (!panelRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  React.useEffect(() => {
    if (!open) return

    const update = () => {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const menuHeight = kind === 'text' ? 7 * 32 : 8 * 32
      const menuWidth = 224

      const spaceBelow = window.innerHeight - r.bottom
      const spaceAbove = r.top
      const placement: 'down' | 'up' = spaceBelow >= menuHeight + 8 || spaceBelow >= spaceAbove ? 'down' : 'up'

      const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - menuWidth - 8))
      const top = placement === 'down' ? Math.min(r.bottom + 6, window.innerHeight - menuHeight - 8) : Math.max(8, r.top - menuHeight - 6)

      setMenuPos({ left, top, placement })
    }

    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [kind, open])

  const isBetween = op === 'between'
  const resolvedAllLabel = String(allLabel ?? '(Tümü)')

  const menuOptions =
    kind === 'text'
      ? [
        { op: 'contains', label: 'İçeren' },
        { op: 'not_contains', label: 'İçermeyen' },
        { op: 'starts_with', label: 'İle başlar' },
        { op: 'ends_with', label: 'İle biten' },
        { op: 'eq', label: 'Eşittir' },
        { op: 'neq', label: 'Eşit değil' }
      ]
      : kind === 'select'
        ? []
        : [
          { op: 'eq', label: 'Eşittir' },
          { op: 'neq', label: 'Eşit değil' },
          { op: 'lt', label: 'Daha küçük' },
          { op: 'gt', label: 'Daha büyük' },
          { op: 'lte', label: 'Daha küçük veya eşit' },
          { op: 'gte', label: 'Daha büyük veya eşit' },
          { op: 'between', label: 'Arasında' }
        ]

  const pickOp = (nextOp: string) => {
    onOpChange(nextOp)
    setOpen(false)
  }

  const inputCls = "h-[26px] px-2 text-[10px] border border-slate-200 rounded bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"

  const renderDateInput = (value: string, onChange: (v: string) => void, ariaLabel: string) => (
    <input
      type="date"
      value={/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? String(value ?? '') : ''}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls + " w-[40px] min-w-[40px]"}
      aria-label={ariaLabel}
    />
  )

  return (
    <div className="relative">
      {kind === 'select' ? (
        <select
          value={String(v1 ?? '')}
          onChange={(e) => onChangeV1(e.target.value)}
          className="w-full h-[28px] px-2 text-[11px] border border-slate-200 rounded bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
        >
          <option value="">{resolvedAllLabel}</option>
          {(options ?? []).map((opt) => {
            const value = typeof opt === 'string' ? opt : String(opt.value ?? '')
            const label = typeof opt === 'string' ? opt : String(opt.label ?? opt.value ?? '')
            return (
              <option key={value} value={value}>
                {label}
              </option>
            )
          })}
        </select>
      ) : (
        <div className="flex items-center gap-1">
          <button
            ref={anchorRef}
            type="button"
            className="inline-flex items-center justify-center w-7 h-7 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 transition"
            title="Arama tipi"
            onClick={(e) => {
              e.stopPropagation()
              setOpen((p) => !p)
            }}
          >
            <Search size={14} />
          </button>

          {kind === 'date' ? (
            <>
              <input
                type="text"
                value={v1}
                onChange={(e) => onChangeV1(e.target.value)}
                className="w-full px-2 py-1 text-[11px] border border-slate-200 rounded bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
              />
              {renderDateInput(v1, onChangeV1, 'Tarih seç')}
              {isBetween ? (
                <>
                  <input
                    type="text"
                    value={v2}
                    onChange={(e) => onChangeV2(e.target.value)}
                    className="w-full px-2 py-1 text-[11px] border border-slate-200 rounded bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                  />
                  {renderDateInput(v2, onChangeV2, 'Bitiş tarihi seç')}
                </>
              ) : null}
            </>
          ) : (
            <>
              <input
                type="text"
                value={v1}
                onChange={(e) => onChangeV1(e.target.value)}
                className="w-full px-2 py-1 text-[11px] border border-slate-200 rounded bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
              />
              {isBetween ? (
                <input
                  type="text"
                  value={v2}
                  onChange={(e) => onChangeV2(e.target.value)}
                  className="w-full px-2 py-1 text-[11px] border border-slate-200 rounded bg-white text-slate-800 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                />
              ) : null}
            </>
          )}
        </div>
      )}

      {open && kind !== 'select'
        ? ReactDOM.createPortal(
          <div
            ref={panelRef}
            className="fixed w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-[9999]"
            style={{ left: menuPos.left, top: menuPos.top }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="py-1">
              {menuOptions.map((o) => (
                <button key={o.op} type="button" className="w-full text-left px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition" onClick={() => pickOp(o.op)}>
                  {o.label}
                </button>
              ))}
              <div className="border-t border-slate-100 my-1"></div>
              <button
                type="button"
                className="w-full text-left px-4 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 transition"
                onClick={() => {
                  onClear()
                  setOpen(false)
                }}
              >
                Sıfırla
              </button>
            </div>
          </div>,
          document.body
        )
        : null}
    </div>
  )
})

export default ColumnFilterSearchBar
