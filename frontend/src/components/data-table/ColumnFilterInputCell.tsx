import React from 'react'
import { X } from 'lucide-react'
import { FilterOperatorMenu } from './FilterOperatorMenu'
import { CalendarPickerPopup } from './CalendarPickerPopup'
import { ColumnHeaderFilterMenu } from './ColumnHeaderFilterMenu'
import type { ColumnFilterStateValue, FilterOperator } from './types'

type Props = {
  columnId: string
  filterType?: 'text' | 'select' | 'number' | 'date' | 'checkbox'
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

  /**
   * YAZARKEN GECİKME (2026-08-22).
   *
   * Her tuş vuruşu doğrudan `onChange` çağırıyordu. İstemci tarafı tablolarda bu, bütün
   * satırların HER HARFTE yeniden süzülüp yeniden çizilmesi demekti; sunucu tarafı
   * sayfalarda (Fatura Dökümü gibi) daha kötüsü, HER HARF BİR AĞ İSTEĞİ atıyordu.
   *
   * Kutu artık yazılanı yerelde tutup 300 ms sessizlikten sonra yukarı bildiriyor. Yazma
   * hissi anında kalıyor, süzme bir kez çalışıyor. Enter ve odak kaybı beklemeden gönderir.
   */
  const DEBOUNCE_MS = 300
  const [localValue, setLocalValue] = React.useState<string | null>(null)
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelPending = React.useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  React.useEffect(() => cancelPending, [cancelPending])

  const pushValue = (rawInput: string) => {
    const activeOp = state.operator === 'in' ? defaultOp : state.operator
    if (activeOp === 'between' && rawInput.includes('-')) {
      const parts = rawInput.split('-').map((s) => s.trim())
      onChange(columnId, { value: parts[0], value2: parts[1] || parts[0], operator: 'between' })
    } else {
      onChange(columnId, { value: rawInput, value2: state.value2, operator: activeOp })
    }
  }

  const handleValueChange = (rawInput: string) => {
    setLocalValue(rawInput)
    cancelPending()
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      setLocalValue(null)
      pushValue(rawInput)
    }, DEBOUNCE_MS)
  }

  /** Seçim kutusunda beklemenin anlamı yok: tek tıkla nihai değer seçiliyor. */
  const handleImmediateChange = (rawInput: string) => {
    cancelPending()
    setLocalValue(null)
    pushValue(rawInput)
  }

  const flushNow = () => {
    if (!debounceRef.current) return
    cancelPending()
    const pending = localValue
    setLocalValue(null)
    if (pending !== null) pushValue(pending)
  }

  const handleOperatorChange = (op: FilterOperator | null) => {
    cancelPending()
    setLocalValue(null)
    if (!op) {
      onChange(columnId, null)
    } else {
      onChange(columnId, { value: state.value, value2: state.value2, operator: op })
    }
  }

  const hasFilterActive = Boolean(state.value) || Boolean(state.value2) || state.operator !== defaultOp

  /*
    'select' DE ÇOKLU SEÇİM (2026-09-01 kullanıcı isteği).

    Tek seçimli açılır kutuydu: fatura dökümünde "Satış" seçince İade'ler kayboluyor, ikisini
    birlikte listelemek mümkün olmuyordu. Aynı ihtiyaç filtreli her sütunda var.

    Yeni bir bileşen yazılmadı — 'checkbox' tipi zaten çoklu seçim menüsünü kullanıyordu ve
    SÜZME MOTORU da hazırdı: `appExactColumnFilterFn` `selectedOptions` dizisini
    `some(equals)` ile değerlendiriyor, sütunlar da `optionFilter` kapsamında ('select' ve
    'checkbox' birlikte). Eksik olan tek şey 'select'in bu arayüze yönlendirilmesiydi.

    Seçenek listesi olmayan (`options` boş) 'select' sütunu aşağıdaki metin kutusuna düşer,
    davranışı değişmez.
  */
  if ((filterType === 'checkbox' || filterType === 'select') && options && options.length > 0) {
    const selectedOptions = typeof actualFilterVal === 'object' && actualFilterVal?.selectedOptions
      ? actualFilterVal.selectedOptions
      : state.value
        ? state.value.split(',').map((s) => s.trim()).filter(Boolean)
        : []
    const selectedLabels = selectedOptions
      .map((selected) => options.find((opt) => opt.value === selected || opt.label === selected)?.label ?? selected)
      .filter(Boolean)
    const checkboxHasFilter = selectedOptions.length > 0

    return (
      <div className="flex items-center w-full h-8 bg-white border border-slate-300 rounded overflow-hidden shadow-sm focus-within:ring-1 focus-within:ring-sky-500 focus-within:border-sky-500">
        <div className="pl-1">
          <ColumnHeaderFilterMenu
            columnId={columnId}
            title={actualPlaceholder ?? 'Filtre'}
            options={options}
            selectedValues={selectedOptions}
            onApply={(selected) => {
              if (!selected.length) {
                onChange(columnId, null)
                return
              }
              onChange(columnId, { selectedOptions: selected, operator: 'in' })
            }}
          />
        </div>
        <button
          type="button"
          className="min-w-0 flex-1 h-full px-2 text-left text-[11px] text-slate-800 truncate"
          onClick={(e) => {
            e.stopPropagation()
            const menuButton = e.currentTarget.previousElementSibling?.querySelector('button') as HTMLButtonElement | null
            menuButton?.click()
          }}
          title={selectedLabels.length ? selectedLabels.join(', ') : (actualPlaceholder ?? 'Seçiniz')}
        >
          {selectedLabels.length ? selectedLabels.join(', ') : (actualPlaceholder ?? 'Seçiniz')}
        </button>
        {checkboxHasFilter && (
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

  return (
    <div className="flex items-center w-full bg-white border border-slate-300 rounded overflow-hidden shadow-sm focus-within:ring-1 focus-within:ring-sky-500 focus-within:border-sky-500">
      {/* Operator Menu Button on Left */}
      <FilterOperatorMenu
        // `checkbox` bir islec turu degil, coklu secim kutusu; islec menusu onu tanimiyor ve
        // metin isleclariyle davranmasi dogru. Uzun suredir duran tip hatasi buradan geliyordu.
        filterType={filterType === 'checkbox' ? 'text' : filterType}
        currentOperator={state.operator}
        onSelectOperator={handleOperatorChange}
      />

      {/* Input or Select Field */}
      {filterType === 'select' && options && options.length > 0 ? (
        <select
          value={state.value}
          onChange={(e) => handleImmediateChange(e.target.value)}
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
          value={localValue ?? displayInputValue}
          onChange={(e) => handleValueChange(e.target.value)}
          onBlur={flushNow}
          onKeyDown={(e) => { if (e.key === 'Enter') flushNow() }}
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
          onClick={() => { cancelPending(); setLocalValue(null); onChange(columnId, null) }}
          className="p-1 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer mr-0.5"
          title="Filtreyi Temizle"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
