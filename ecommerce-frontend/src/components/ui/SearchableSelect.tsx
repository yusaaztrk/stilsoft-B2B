import { useState, useEffect, useRef } from 'react';

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  label?: string;
  required?: boolean;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  label,
  required = false,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync search input with selected value when closed
  useEffect(() => {
    if (!isOpen) {
      setSearch(value);
    }
  }, [value, isOpen]);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const filteredOptions = options.filter(option =>
    option.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={containerRef} className="relative w-full space-y-1">
      {label && (
        <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);
            setSearch(''); // clear on focus to show all options
          }}
          placeholder={placeholder}
          required={required && !value}
          className="w-full h-11 pl-4 pr-10 bg-white border border-zinc-200 rounded-xl focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all text-sm font-semibold"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-zinc-400 pointer-events-none">
          {value && !isOpen && (
            <span className="material-symbols-outlined text-[16px] text-green-500">check_circle</span>
          )}
          <span className="material-symbols-outlined text-[20px]">
            {isOpen ? 'arrow_drop_up' : 'arrow_drop_down'}
          </span>
        </div>
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 z-[100] mt-1 bg-white border border-zinc-200 rounded-xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="max-h-[280px] overflow-y-auto custom-scrollbar divide-y divide-zinc-50">
            {filteredOptions.length === 0 ? (
              <div className="px-4 py-3 text-xs text-zinc-400 italic">
                Sonuç bulunamadı.
              </div>
            ) : (
              filteredOptions.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    onChange(opt);
                    setSearch(opt);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-4 py-2.5 text-xs font-bold transition-all duration-150 hover:bg-zinc-50 ${
                    value === opt 
                      ? 'bg-primary/5 text-primary' 
                      : 'text-zinc-700'
                  }`}
                >
                  {opt}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
