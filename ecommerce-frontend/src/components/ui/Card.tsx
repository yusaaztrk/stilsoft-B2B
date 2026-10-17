import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  footer?: React.ReactNode;
  headerActions?: React.ReactNode;
}

export function Card({
  children,
  title,
  subtitle,
  footer,
  headerActions,
  className = '',
  ...props
}: CardProps) {
  return (
    <div 
      className={`border border-outline-variant bg-surface-container-lowest rounded-lg shadow-xs flex flex-col overflow-hidden transition-all duration-200 ${className}`}
      {...props}
    >
      {(title || subtitle || headerActions) && (
        <div className="px-5 py-4 border-b border-outline-variant flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            {title && <h4 className="text-sm font-bold text-on-surface">{title}</h4>}
            {subtitle && <p className="text-xs text-on-surface-variant">{subtitle}</p>}
          </div>
          {headerActions && <div>{headerActions}</div>}
        </div>
      )}
      
      <div className="flex-1 px-5 py-4">
        {children}
      </div>

      {footer && (
        <div className="px-5 py-3.5 border-t border-outline-variant bg-surface-container-low flex items-center justify-end">
          {footer}
        </div>
      )}
    </div>
  );
}
