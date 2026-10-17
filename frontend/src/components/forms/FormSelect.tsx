import { ChevronDown } from 'lucide-react'
import React from 'react'

type Option = {
  value: string
  label: string
  disabled?: boolean
}

type Props = React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string
  options: Option[]
  requiredMark?: boolean
  hint?: string
  helperText?: string
}

export default function FormSelect({ label, options, requiredMark, hint, helperText, ...props }: Props) {
  const displayHint = hint || helperText
  return (
    <div className="space-y-2">
      {label ? (
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
          {label} {requiredMark && <span className="text-red-500">*</span>}
        </label>
      ) : null}
      <div className="relative">
        <select className="input-base appearance-none pr-10" {...props}>
          {options.map((opt, idx) => (
            <option key={`${opt.value}__${idx}`} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
      </div>
      {displayHint ? <p className="text-[11px] text-gray-500 leading-relaxed">{displayHint}</p> : null}
    </div>
  )
}
