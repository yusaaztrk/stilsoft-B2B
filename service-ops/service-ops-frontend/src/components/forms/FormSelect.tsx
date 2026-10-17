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
}

export default function FormSelect({ label, options, requiredMark, ...props }: Props) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
        {label} {requiredMark && <span className="text-red-500">*</span>}
      </label>
      <div className="relative">
        <select className="input-base appearance-none pr-10 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800" {...props}>
          {options.map((opt, idx) => (
            <option key={`${opt.value}__${idx}`} value={opt.value} disabled={opt.disabled} className="text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800">
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
        />
      </div>
    </div>
  )
}
