import { useEffect, useMemo, useRef, useState } from 'react'
import type { CategoryDto, ProductCategoryMapDto } from '../../lib/categoriesApi'

export function ProductCategoryPicker({
  categories,
  selected,
  busy,
  onChange,
}: {
  categories: CategoryDto[]
  selected: ProductCategoryMapDto[]
  busy: boolean
  onChange: (categoryPathIds: string[]) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const categoriesById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const sortedCategories = (list: CategoryDto[]) => {
    return [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'tr'))
  }

  const getCategoryPath = (categoryId: string | null | undefined) => {
    if (!categoryId) return []
    const path: CategoryDto[] = []
    const seen = new Set<string>()
    let current = categoriesById.get(categoryId)

    while (current && !seen.has(current.id)) {
      path.unshift(current)
      seen.add(current.id)
      current = current.parentId ? categoriesById.get(current.parentId) : undefined
    }

    return path
  }

  const activePath = useMemo(() => {
    const primary = selected.find((s) => s.isPrimary)
    if (primary) return getCategoryPath(primary.categoryId)

    const deepestSelected = selected
      .map((s) => categoriesById.get(s.categoryId))
      .filter((c): c is CategoryDto => Boolean(c))
      .sort((a, b) => getCategoryPath(b.id).length - getCategoryPath(a.id).length)[0]

    return deepestSelected ? getCategoryPath(deepestSelected.id) : []
  }, [selected, categoriesById])

  const activeCategory = activePath[activePath.length - 1] ?? null

  const levelOptions = useMemo(() => {
    const levels: CategoryDto[][] = []
    levels.push(sortedCategories(categories.filter((c) => c.parentId === null)))

    for (const selectedCategory of activePath) {
      const children = sortedCategories(categories.filter((c) => c.parentId === selectedCategory.id))
      if (children.length === 0) break
      levels.push(children)
    }

    return levels
  }, [categories, activePath])

  const levelLabel = (index: number) => {
    if (index === 0) return 'Ana Kategori'
    if (index === 1) return 'Alt Kategori'
    return `${index + 1}. Seviye Kategori`
  }

  const handleLevelChange = (levelIndex: number, value: string) => {
    const nextPath = activePath.slice(0, levelIndex).map((c) => c.id)
    if (value) nextPath.push(value)
    onChange(nextPath)
  }

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      <button
        type="button"
        disabled={busy}
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold select-none transition-all duration-200 disabled:opacity-60 max-w-[260px] text-left active:scale-[0.98] ${
          activeCategory
            ? 'border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 hover:border-zinc-300 shadow-sm'
            : 'border-dashed border-zinc-300 bg-zinc-50/50 hover:bg-zinc-50 text-zinc-500 hover:border-zinc-400'
        }`}
      >
        <span className={`material-symbols-outlined text-[15px] ${activeCategory ? 'text-[#df0000]' : 'text-zinc-400'}`}>
          {activeCategory ? 'folder' : 'folder_open'}
        </span>
        <span className="truncate">
          {activeCategory ? (
            activePath.map((c, index) => (
              <span key={c.id}>
                {index > 0 && <span className="text-zinc-400 font-normal"> / </span>}
                <span className={index === activePath.length - 1 ? '' : 'text-zinc-500 font-normal'}>{c.name}</span>
              </span>
            ))
          ) : (
            'Kategori Seç'
          )}
        </span>
        <span className="material-symbols-outlined text-[14px] text-zinc-400 ml-auto font-light">
          expand_more
        </span>
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-2 w-72 rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex items-center justify-between border-b border-zinc-100 pb-2 mb-3">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider">Kategori Seçin</span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-zinc-400 hover:text-zinc-650 flex items-center justify-center p-0.5 rounded-lg hover:bg-zinc-50"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>

          <div className="space-y-3">
            {levelOptions.map((options, index) => (
              <div key={index} className="space-y-1">
                <label className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 block">
                  {levelLabel(index)}
                </label>
                <select
                  disabled={busy || (index > 0 && !activePath[index - 1])}
                  value={activePath[index]?.id ?? ''}
                  onChange={(e) => handleLevelChange(index, e.target.value)}
                  className="h-8.5 w-full rounded-xl border border-zinc-200 bg-white px-2.5 text-xs text-zinc-800 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] disabled:opacity-60 disabled:bg-zinc-50 transition"
                >
                  <option value="">Seçiniz...</option>
                  {options.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="w-full mt-4 h-8.5 rounded-xl bg-zinc-900 text-white text-xs font-bold hover:bg-zinc-800 active:scale-95 transition flex items-center justify-center shadow-sm"
          >
            Tamam
          </button>
        </div>
      )}
    </div>
  )
}
