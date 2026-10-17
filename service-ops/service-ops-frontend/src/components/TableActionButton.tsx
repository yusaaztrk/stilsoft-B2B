import * as React from 'react'

export interface TableActionButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'outline'
  size?: 'sm'
  icon?: React.ReactNode
  children?: React.ReactNode
}

export const TableActionButton = React.forwardRef<HTMLButtonElement, TableActionButtonProps>(
  ({ variant = 'primary', size = 'sm', icon, children, className = '', ...props }, ref) => {
    const baseClasses = 'inline-flex items-center justify-center h-8 rounded-[6px] px-[10px] text-[12px] font-medium gap-1.5 transition-all duration-150 ease-in-out select-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/20'
    
    const variantClasses = {
      primary: 'bg-[#1D4ED8] text-white hover:bg-[#1E40AF]',
      secondary: 'bg-[#F8FAFC] border border-[#CBD5E1] text-[#334155] hover:bg-[#F1F5F9]',
      success: 'bg-[#047857] text-white hover:bg-[#065F46]',
      danger: 'bg-[#DC2626] text-white hover:bg-[#B91C1C]',
      outline: 'bg-white border border-[#CBD5E1] text-[#334155] hover:bg-[#F8FAFC]',
    }

    const sizeClasses = {
      sm: 'h-8 px-[10px]',
    }

    const computedClassName = `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`.trim()

    return (
      <button ref={ref} className={computedClassName} {...props}>
        {icon && <span className="inline-flex items-center justify-center">{icon}</span>}
        {children}
      </button>
    )
  }
)

TableActionButton.displayName = 'TableActionButton'
