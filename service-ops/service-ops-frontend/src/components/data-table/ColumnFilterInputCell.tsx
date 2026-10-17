import React from 'react'
import { X } from 'lucide-react'
import { FilterOperatorMenu } from './FilterOperatorMenu'
import { CalendarPickerPopup } from './CalendarPickerPopup'
import type { ColumnFilterStateValue, FilterOperator } from './types'

type Props = {
  columnId: string
  filterType?: 'text' | 'select' | 'number' | 'date'
  filterPlaceholder?: string
  placeholder?: string
  filterValue?: ColumnFilterStateValue | string | null
  value?: ColumnFilterStateValue | string | null
  options?: Array<{ label: string; value: string }>
  onChange: (columnId: string, value: ColumnFilterStateValue | null) => void
}

function parseFilterState(val: ColumnFilterStateValue | string | undefined | null, defaultOp: FilterOperator): {
  value: string
  value2: string
  operator: FilterOperator
} {
  if (!val) {
    return { value: '', value2: '', operator: defaultOp }
  }
  if (typeof val === 'string') {
    return { value: val, value2: '', operator: defaultOp }
  }
  return {
    value: val.value ?? '',
    value2: val.value2 ?? '',
    operator: val.operator ?? defaultOp
  }
}

export function ColumnFilterInputCell(props: Props) {
  const {
    columnId,
    filterType = 'text',
    filterPlaceholder,
    placeholder,
    filterValue,
    value,
    options,
    onChange
  } = props

  const actualFilterVal = filterValue !== undefined ? filterValue : value
  const actualPlaceholder = filterPlaceholder ?? placeholder

  const defaultOp: FilterOperator = filterType === 'date' ? 'eq' : filterType === 'number' ? 'eq' : 'contains'
  const state = parseFilterState(actualFilterVal, defaultOp)

  const isBetween = state.operator === 'between'

  const displayInputValue = isBetween && state.value && state.value2
    ? `${state.value} - ${state.value2}`
    : state.value

  const handleValueChange = (rawInput: string) => {
    const activeOp = state.operator === 'in' ? defaultOp : state.operator
    if (activeOp === 'between' && rawInput.includes('-')) {
      const parts = rawInput.split('-').map((s) => s.trim())
      onChange(columnId, { value: parts[0], value2: parts[1] || parts[0], operator: 'between' })
    } else {
      onChange(columnId, { value: rawInput, value2: state.value2, operator: activeOp })
    }
  }

  const handleOperatorChange = (op: FilterOperator | null) => {
    if (!op) {
      onChange(columnId, null)
    } else {
      onChange(columnId, { value: state.value, value2: state.value2, operator: op })
    }
  }

  const hasFilterActive = Boolean(state.value) || Boolean(state.value2) || state.operator !== defaultOp

  return (
    <div className="flex items-center w-full bg-white border border-slate-300 rounded overflow-hidden shadow-sm focus-within:ring-1 focus-within:ring-red-600 focus-within:border-red-600">
      {/* Operator Menu Button on Left */}
      <FilterOperatorMenu
        filterType={filterType}
        currentOperator={state.operator}
        onSelectOperator={handleOperatorChange}
      />

      {/* Input or Select Field */}
      {filterType === 'select' && options && options.length > 0 ? (
        <select
          value={state.value}
          onChange={(e) => handleValueChange(e.target.value)}
          className="w-full h-7 text-[11px] font-normal px-1.5 text-slate-800 bg-transparent focus:outline-none truncate cursor-pointer"
        >
          <option value="">{actualPlaceholder || 'Tümü'}</option>
          {options.map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          placeholder={actualPlaceholder ?? 'Ara...'}
          value={displayInputValue}
          onChange={(e) => handleValueChange(e.target.value)}
          className="w-full h-7 text-[11px] font-normal px-2 text-slate-800 placeholder-slate-400 focus:outline-none bg-transparent truncate"
        />
      )}

      {/* Calendar Icon Button for Date Column */}
      {filterType === 'date' && (
        <div className="pr-1">
          <CalendarPickerPopup
            value={state.value}
            value2={state.value2}
            isRange={isBetween}
            onChange={(v1, v2) => {
              if (isBetween) {
                onChange(columnId, { value: v1, value2: v2 || v1, operator: 'between' })
              } else {
                onChange(columnId, { value: v1, operator: state.operator })
              }
            }}
          />
        </div>
      )}

      {/* Clear Button */}
      {hasFilterActive && (
        <button
          type="button"
          onClick={() => onChange(columnId, null)}
          className="p-1 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer mr-0.5"
          title="Filtreyi Temizle"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
