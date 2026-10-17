import React from 'react';

interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: DropdownOption[];
  error?: string;
}

export function Dropdown({
  label,
  options,
  error,
  className = '',
  ...props
}: DropdownProps) {
  return (
    <div className="w-full flex flex-col gap-1">
      {label && (
        <label className="text-xs font-semibold text-on-surface-variant select-none">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          className={`w-full px-3 py-2 pr-10 text-sm border rounded bg-surface-container-lowest text-on-surface outline-none appearance-none transition-all duration-200 cursor-pointer
            ${error 
              ? 'border-error focus:border-error focus:ring-1 focus:ring-error' 
              : 'border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary'
            }
            disabled:opacity-50 disabled:bg-surface-container-low disabled:pointer-events-none
            ${className}
          `}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-tertiary select-none pointer-events-none text-[18px]">
          unfold_more
        </span>
      </div>
      {error && (
        <span className="text-xs text-error font-medium animate-in">
          {error}
        </span>
      )}
    </div>
  );
}
