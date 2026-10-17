import React from 'react'

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string
  requiredMark?: boolean
}

export default function FormInput({ label, requiredMark, ...props }: Props) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
        {label} {requiredMark && <span className="text-red-500">*</span>}
      </label>
      <input className="input-base" {...props} />
    </div>
  )
}
