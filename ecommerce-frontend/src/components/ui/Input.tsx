import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: string; // Material symbol name
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, className = '', ...props }, ref) => {
    return (
      <div className="w-full flex flex-col gap-1">
        {label && (
          <label className="text-xs font-semibold text-on-surface-variant select-none">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {icon && (
            <span className="material-symbols-outlined absolute left-3 text-tertiary select-none pointer-events-none">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            className={`w-full px-3 py-2 text-sm border rounded bg-surface-container-lowest text-on-surface outline-none transition-all duration-200
              ${icon ? 'pl-10' : 'pl-3'}
              ${error 
                ? 'border-error focus:border-error focus:ring-1 focus:ring-error' 
                : 'border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary'
              }
              disabled:opacity-50 disabled:bg-surface-container-low disabled:pointer-events-none
              ${className}
            `}
            {...props}
          />
        </div>
        {error && (
          <span className="text-xs text-error font-medium animate-in">
            {error}
          </span>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
