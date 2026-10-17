import React, { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { EmployeeDto } from '../api/employees'

/**
 * Çoklu çalışan seçici. Ödeme sayfalarının hepsi aynı seçim davranışını kullanıyor;
 * her sayfaya ayrı ayrı yazılmasın diye tek yerde.
 */
export default function EmployeePicker({
  employees,
  selected,
  onChange,
  emptyHint = 'Çalışan bulunamadı'
}: {
  employees: EmployeeDto[]
  selected: Set<number>
  onChange: (next: Set<number>) => void
  emptyHint?: string
}) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR')
    if (!q) return employees
    return employees.filter((e) => {
      const hay = `${e.firstName} ${e.lastName} ${e.employeeCode ?? ''} ${(e as any).workplace ?? ''}`
        .toLocaleLowerCase('tr-TR')
      return hay.includes(q)
    })
  }, [employees, search])

  const allVisibleSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.id))

  const toggleAllVisible = () => {
    const next = new Set(selected)
    if (allVisibleSelected) filtered.forEach((e) => next.delete(e.id))
    else filtered.forEach((e) => next.add(e.id))
    onChange(next)
  }

  const toggleOne = (id: number) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-base pl-9"
            placeholder="Çalışan ara..."
            aria-label="Çalışan ara"
          />
        </div>
        <button type="button" onClick={toggleAllVisible} className="btn-editorial whitespace-nowrap">
          {allVisibleSelected ? 'Seçimi kaldır' : 'Görünenleri seç'}
        </button>
        <span className="text-xs text-neutral-500 whitespace-nowrap">{selected.size} seçili</span>
      </div>

      <div className="max-h-72 overflow-y-auto rounded-lg border border-ivory-300 divide-y divide-ivory-200">
        {filtered.length === 0 && <div className="p-4 text-sm text-neutral-400">{emptyHint}</div>}
        {filtered.map((e) => (
          <label
            key={e.id}
            className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-ivory-100"
          >
            <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleOne(e.id)} />
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-obsidian-850 truncate">
                {e.firstName} {e.lastName}
              </span>
              <span className="block text-[11px] text-neutral-400 truncate">
                {e.employeeCode}
                {(e as any).workplace ? ` · ${(e as any).workplace}` : ''}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
