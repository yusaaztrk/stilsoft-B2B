import React from 'react'

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string
  requiredMark?: boolean
}

export default function FormInput({ label, requiredMark, ...props }: Props) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
        {label} {requiredMark && <span className="text-rose-500">*</span>}
      </label>
      <input className="input-base" {...props} />
    </div>
  )
}
