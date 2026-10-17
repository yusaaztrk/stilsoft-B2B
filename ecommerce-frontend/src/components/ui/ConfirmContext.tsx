import React, { createContext, useContext, useState, useRef } from 'react';
import { Modal } from './Modal';

interface ConfirmOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}

interface ConfirmContextType {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return context.confirm;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
    type: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: 'Onay',
    message: '',
    confirmText: 'Evet',
    cancelText: 'İptal',
    type: 'info',
  });

  const resolverRef = useRef<(value: boolean) => void>();

  const confirm = (message: string, options?: ConfirmOptions) => {
    setState({
      isOpen: true,
      title: options?.title || 'Onay',
      message,
      confirmText: options?.confirmText || 'Evet',
      cancelText: options?.cancelText || 'İptal',
      type: options?.type || 'info',
    });
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  };

  const handleClose = (value: boolean) => {
    setState((prev) => ({ ...prev, isOpen: false }));
    if (resolverRef.current) {
      resolverRef.current(value);
    }
  };

  const btnColorClass = state.type === 'danger' 
    ? 'bg-red-600 hover:bg-red-700 text-white' 
    : state.type === 'warning'
    ? 'bg-amber-500 hover:bg-amber-600 text-white'
    : 'bg-primary hover:bg-primary-container text-white';

  const iconName = state.type === 'danger' 
    ? 'error' 
    : state.type === 'warning'
    ? 'warning'
    : 'help';

  const iconColor = state.type === 'danger'
    ? 'text-red-600 bg-red-50 border-red-100'
    : state.type === 'warning'
    ? 'text-amber-600 bg-amber-50 border-amber-100'
    : 'text-primary bg-primary/10 border-primary/20';

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <Modal
        isOpen={state.isOpen}
        onClose={() => handleClose(false)}
        title={state.title}
        size="sm"
        zIndex="z-[105]"
        footerActions={
          <div className="flex gap-2 w-full justify-end">
            <button
              type="button"
              onClick={() => handleClose(false)}
              className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 font-bold text-xs rounded-xl text-zinc-700 transition-colors"
            >
              {state.cancelText}
            </button>
            <button
              type="button"
              onClick={() => handleClose(true)}
              className={`px-4 py-2 font-bold text-xs rounded-xl transition-all active:scale-[0.98] ${btnColorClass}`}
            >
              {state.confirmText}
            </button>
          </div>
        }
      >
        <div className="flex gap-4 items-start py-2">
          <span className={`material-symbols-outlined rounded-xl p-2.5 text-2xl border ${iconColor} shrink-0`}>
            {iconName}
          </span>
          <p className="text-sm font-semibold text-zinc-600 leading-relaxed pt-1">
            {state.message}
          </p>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}
