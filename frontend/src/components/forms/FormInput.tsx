import React from 'react'

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string
  requiredMark?: boolean
  /**
   * Alanın altında görünen açıklama. Anlamı başlıktan çıkmayan alanlar için —
   * `label` ve `requiredMark` gibi bu da input'a geçirilmez; geçseydi React
   * geçersiz DOM özniteliği uyarısı verirdi.
   */
  hint?: string
  helperText?: string
}

export default function FormInput({ label, requiredMark, hint, helperText, ...props }: Props) {
  const displayHint = hint || helperText
  return (
    <div className="space-y-2">
      {label ? (
        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
          {label} {requiredMark && <span className="text-red-500">*</span>}
        </label>
      ) : null}
      <input className="input-base" {...props} />
      {displayHint ? <p className="text-[11px] text-gray-500 leading-relaxed">{displayHint}</p> : null}
    </div>
  )
}
