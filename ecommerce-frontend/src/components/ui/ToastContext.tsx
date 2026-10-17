import React, { createContext, useContext, useState, useCallback } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'loading';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextType {
  showToast: (message: string, type: ToastType, duration?: number) => string;
  dismissToast: (id: string) => void;
  toasts: ToastItem[];
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType, duration = 4000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message, duration }]);

    if (type !== 'loading' && duration > 0) {
      setTimeout(() => {
        dismissToast(id);
      }, duration);
    }

    return id;
  }, [dismissToast]);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast, toasts }}>
      {children}
      {/* Toast Render Area */}
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const iconMap = {
    success: { name: 'check_circle', color: 'text-green-600 bg-green-50 border-green-200', title: 'Başarılı' },
    error: { name: 'error', color: 'text-red-600 bg-red-50 border-red-200', title: 'Hata' },
    warning: { name: 'warning', color: 'text-amber-600 bg-amber-50 border-amber-200', title: 'Uyarı' },
    loading: { name: 'sync', color: 'text-[#df0000] bg-zinc-50 border-zinc-200 animate-spin', title: 'İşlem Yapılıyor' },
  };

  const item = iconMap[toast.type];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity" 
        onClick={() => toast.type !== 'loading' && onDismiss(toast.id)} 
      />
      
      {/* Modal Card */}
      <div className="relative w-full max-w-sm rounded-3xl border border-zinc-200 bg-white p-6 shadow-2xl animate-in pointer-events-auto text-center flex flex-col items-center gap-4">
        <span className={`material-symbols-outlined rounded-2xl p-3 text-[32px] border ${item.color}`}>
          {item.name}
        </span>
        
        <div>
          <h3 className="text-base font-extrabold text-zinc-900 tracking-tight">{item.title}</h3>
          <p className="mt-1.5 text-xs font-semibold text-zinc-500 leading-relaxed">
            {toast.message}
          </p>
        </div>

        {toast.type !== 'loading' && (
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="w-full py-2.5 px-4 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-xs font-bold transition-all active:scale-[0.98]"
          >
            Tamam
          </button>
        )}
      </div>
    </div>
  );
}
