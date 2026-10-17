import React, { useEffect } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footerActions?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  zIndex?: string;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footerActions,
  size = 'md',
  zIndex = 'z-[90]',
}: ModalProps) {
  // Lock scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-xl',
    lg: 'max-w-3xl',
    xl: 'max-w-5xl',
    full: 'max-w-full m-4 h-[calc(100vh-32px)]',
  };

  return (
    <div className={`fixed inset-0 ${zIndex} flex items-center justify-center p-4`}>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-in"
        onClick={onClose}
      />
      
      {/* Container */}
      <div className={`relative w-full bg-surface border border-outline-variant rounded-lg shadow-xl flex flex-col overflow-hidden animate-in z-10 ${sizes[size]} max-h-[90vh]`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
          {title ? (
            <h3 className="text-lg font-bold text-on-background">{title}</h3>
          ) : (
            <div />
          )}
          <button 
            onClick={onClose}
            className="p-1 rounded-full text-tertiary hover:bg-surface-container transition-all"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
          {children}
        </div>
        
        {/* Footer */}
        {footerActions && (
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-outline-variant bg-surface-container-low">
            {footerActions}
          </div>
        )}
      </div>
    </div>
  );
}
