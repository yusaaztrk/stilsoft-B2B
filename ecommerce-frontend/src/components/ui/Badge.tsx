import React from 'react';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'neutral';
  size?: 'sm' | 'md';
}

export function Badge({
  children,
  variant = 'neutral',
  size = 'md',
  className = '',
  ...props
}: BadgeProps) {
  const baseStyle = 'inline-flex items-center justify-center font-bold tracking-wide rounded-full uppercase leading-none select-none';
  
  const variants = {
    primary: 'bg-primary-fixed text-on-primary-fixed-variant border border-outline-variant',
    secondary: 'bg-secondary-container text-on-secondary-container',
    success: 'bg-green-100 text-green-800 border border-green-200',
    warning: 'bg-amber-100 text-amber-800 border border-amber-200',
    error: 'bg-error-container text-on-error-container border border-outline-variant',
    neutral: 'bg-surface-container-high text-on-surface-variant',
  };

  const sizes = {
    sm: 'px-1.5 py-0.5 text-[9px]',
    md: 'px-2 py-1 text-[10px]',
  };

  return (
    <span 
      className={`${baseStyle} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
