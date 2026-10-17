import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { extractProductsList, readApiResponse, type ErpProductListItem } from '../lib/api'
import { ProductCard } from '../components/ProductCard'
import { fetchStorefrontCategories, type CategoryDto } from '../lib/categoriesApi'
import { addToCart } from '../lib/cart'
import { useSEO } from '../hooks/useSEO'
import { trackLiveEvent } from '../lib/liveTracker'

export function CategoryPage() {
  const { slug } = useParams()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ErpProductListItem[]>([])
  const [cats, setCats] = useState<CategoryDto[]>([])
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [sortType, setSortType] = useState('popularity')
  const [categorySearchQuery, setCategorySearchQuery] = useState('')

  const searchedCats = useMemo(() => {
    const q = categorySearchQuery.trim().toLowerCase()
    if (!q) return []
    return cats
      .filter((c) => c.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  }, [cats, categorySearchQuery])

  const title = useMemo(() => {
    const q = (slug ?? '').trim()
    if (!q || q === 'all') return 'Tüm Ürünler'
    return decodeURIComponent(q)
  }, [slug])

    const currentCategory = useMemo(() => {
      const raw = (slug ?? '').trim()
      if (!raw || raw === 'all') return null
      return cats.find((x) => x.slug === raw) ?? null
    }, [cats, slug])

    const categoryBreadcrumbs = useMemo(() => {
      if (!currentCategory) return []
      const path: { name: string; slug: string }[] = []
      let current: CategoryDto | undefined = currentCategory
      while (current) {
        path.unshift({ name: current.name, slug: current.slug })
        const parentId = current.parentId
        current = parentId ? cats.find(c => c.id === parentId) : undefined
      }
      return path
    }, [currentCategory, cats])

    const seoBreadcrumbs = useMemo(() => {
      const list = [
        {
          '@type': 'ListItem',
          'position': 1,
          'name': 'Ana Sayfa',
          'item': window.location.origin + '/'
        }
      ]
      if (categoryBreadcrumbs.length > 0) {
        categoryBreadcrumbs.forEach((node, idx) => {
          list.push({
            '@type': 'ListItem',
            'position': idx + 2,
            'name': node.name,
            'item': window.location.origin + '/kategori/' + encodeURIComponent(node.slug)
          })
        })
      } else {
        list.push({
          '@type': 'ListItem',
          'position': 2,
          'name': title,
          'item': window.location.origin + '/kategori/' + encodeURIComponent(slug ?? '')
        })
      }
      return list
    }, [categoryBreadcrumbs, title, slug])

    useSEO({
      title: title,
      description: `${title} kategorisindeki en yeni ve en kaliteli ev aletleri, modeller ve aksesuarlar Stilsoft KKTC'de!`,
      schema: {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        'itemListElement': seoBreadcrumbs
      }
    })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await fetchStorefrontCategories()
        if (!cancelled) setCats(data)
      } catch {
        if (!cancelled) setCats([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const raw = (slug ?? '').trim()
        const isAll = !raw || raw === 'all'
        const url = isAll ? '/api/storefront/products' : `/api/storefront/categories/${encodeURIComponent(raw)}/products`
        const res = await fetch(url)
        const json = await readApiResponse(res)
        if (!res.ok) throw new Error(json?.message || 'Ürünler alınamadı')
        const data = extractProductsList(json)
        if (!cancelled) {
          setItems(data)
          const categoryName = isAll ? 'Tüm Ürünler' : decodeURIComponent(raw)
          trackLiveEvent('visit', `"${categoryName}" kategorisine girdi`)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ürünler alınamadı')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [slug])

  const filtered = useMemo(() => {
    const list = [...items]
    if (sortType === 'price-asc') {
      list.sort((a, b) => (a.unitPrice ?? 0) - (b.unitPrice ?? 0))
    } else if (sortType === 'price-desc') {
      list.sort((a, b) => (b.unitPrice ?? 0) - (a.unitPrice ?? 0))
    } else if (sortType === 'newest') {
      list.sort((a, b) => (b.id ?? '').localeCompare(a.id ?? ''))
    } else {
      // popularity
      list.sort((a, b) => (b.ratingAverage ?? 0) - (a.ratingAverage ?? 0) || (b.reviewsCount ?? 0) - (a.reviewsCount ?? 0))
    }
    return list
  }, [items, sortType])



  const topCategory = useMemo(() => {
    if (!currentCategory) return null
    let temp = currentCategory
    while (temp.parentId) {
      const parent = cats.find((x) => x.id === temp.parentId)
      if (!parent) break
      temp = parent
    }
    return temp
  }, [cats, currentCategory])

  const subCategories = useMemo(() => {
    if (!topCategory) return []
    const list = cats.filter((x) => x.parentId === topCategory.id)
    list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'tr'))
    return list
  }, [cats, topCategory])

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6 md:mb-8">
        <div>
          <nav className="flex items-center gap-2 text-xs sm:text-sm text-zinc-400 mb-2 overflow-x-auto whitespace-nowrap scrollbar-none py-1">
            <Link to="/" className="hover:text-primary transition-colors shrink-0">Ana Sayfa</Link>
            {categoryBreadcrumbs.map((node, idx) => {
              const isLast = idx === categoryBreadcrumbs.length - 1
              return (
                <span key={node.slug} className="flex items-center gap-2 shrink-0">
                  <span className="material-symbols-outlined text-xs text-zinc-300 select-none">chevron_right</span>
                  {isLast ? (
                    <span className="text-on-surface font-medium">{node.name}</span>
                  ) : (
                    <Link to={`/kategori/${encodeURIComponent(node.slug)}`} className="hover:text-primary transition-colors">
                      {node.name}
                    </Link>
                  )}
                </span>
              )
            })}
            {categoryBreadcrumbs.length === 0 && (
              <span className="flex items-center gap-2 shrink-0">
                <span className="material-symbols-outlined text-xs text-zinc-300 select-none">chevron_right</span>
                <span className="text-on-surface font-medium">{title}</span>
              </span>
            )}
          </nav>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-on-surface leading-tight">{title}</h1>
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
          <span className="text-xs sm:text-sm text-zinc-500 font-semibold">{filtered.length} ürün</span>
          
          <div className="flex items-center gap-2">
            {/* Filter Toggle Button for Mobile */}
            <button
              onClick={() => setMobileFiltersOpen(true)}
              className="lg:hidden h-10 px-4 border border-zinc-200 rounded-xl bg-white text-xs font-bold text-zinc-750 hover:bg-zinc-50 flex items-center gap-1.5 active:scale-95 transition-all"
            >
              <span className="material-symbols-outlined text-base">filter_list</span>
              Filtrele
            </button>

            <select
              value={sortType}
              onChange={(e) => setSortType(e.target.value)}
              className="bg-white border border-zinc-200 rounded-xl px-4 h-10 text-xs font-bold text-zinc-750 focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all cursor-pointer"
            >
              <option value="popularity">Popülerlik</option>
              <option value="price-asc">En Düşük Fiyat</option>
              <option value="price-desc">En Yüksek Fiyat</option>
              <option value="newest">En Yeniler</option>
            </select>
          </div>
        </div>
      </div>

      {/* Horizontal Subcategory Chips (Mobile Only) */}
      {subCategories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-3 mb-4 lg:hidden scrollbar-none snap-x">
          <Link
            to={`/kategori/${encodeURIComponent(topCategory?.slug ?? '')}`}
            className={`px-4 py-2 rounded-full text-xs font-bold shrink-0 transition-all border ${
              !currentCategory?.parentId
                ? 'bg-primary text-white border-primary shadow-sm'
                : 'bg-white text-zinc-650 border-zinc-200'
            }`}
          >
            Tümü
          </Link>
          {subCategories.map((c) => {
            const active = currentCategory?.id === c.id
            return (
              <Link
                key={c.id}
                to={`/kategori/${encodeURIComponent(c.slug)}`}
                className={`px-4 py-2 rounded-full text-xs font-bold shrink-0 transition-all border ${
                  active
                    ? 'bg-primary/10 text-primary border-primary/20'
                    : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                }`}
              >
                {c.name}
              </Link>
            )
          })}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 text-sm text-primary flex items-center gap-3 mb-6">
          <span className="material-symbols-outlined">error</span>
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:gap-8 lg:grid-cols-[280px_1fr]">
        {/* Sidebar (Desktop Only) */}
        <aside className="hidden lg:block space-y-6">
          <div className="rounded-xl border border-zinc-100 bg-white p-5 shadow-sm">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-[0.1em] mb-4">Kategoriler</h3>
            
            {/* Search Input for categories */}
            <div className="relative mb-4">
              <input
                type="text"
                placeholder="Kategori ara..."
                value={categorySearchQuery}
                onChange={(e) => setCategorySearchQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-xs border border-zinc-200 rounded-xl focus:outline-none focus:border-primary placeholder-zinc-400 transition-colors font-medium"
              />
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">search</span>
              {categorySearchQuery && (
                <button
                  type="button"
                  onClick={() => setCategorySearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-650 flex items-center justify-center"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              )}
            </div>

            <div className="space-y-1">
              {categorySearchQuery.trim() ? (
                searchedCats.length > 0 ? (
                  <div className="space-y-1">
                    {searchedCats.map((c) => {
                      const active = currentCategory?.id === c.id
                      return (
                        <Link
                          key={c.id}
                          to={`/kategori/${encodeURIComponent(c.slug)}`}
                          className={
                            'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-all ' +
                            (active ? 'bg-primary text-white' : 'text-zinc-700 hover:bg-zinc-50')
                          }
                        >
                          <span className="material-symbols-outlined text-base">folder</span>
                          <span className="truncate">{c.name}</span>
                        </Link>
                      )
                    })}
                  </div>
                ) : (
                  <div className="px-3 py-4 text-center text-xs text-zinc-400">
                    Eşleşen kategori bulunamadı.
                  </div>
                )
              ) : topCategory ? (
                <>
                  <Link
                    to={`/kategori/${encodeURIComponent(topCategory.slug)}`}
                    className={
                      'flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all ' +
                      (!currentCategory?.parentId ? 'bg-primary text-white' : 'text-zinc-700 hover:bg-zinc-50')
                    }
                  >
                    <span className="material-symbols-outlined text-base">folder</span>
                    Tüm {topCategory.name}
                  </Link>

                  {subCategories.length > 0 ? (
                    <div className="pt-1 pl-2 border-l border-zinc-100 ml-3 space-y-1.5">
                      {subCategories.map((c) => {
                        const active = currentCategory?.id === c.id
                        const subSubCats = cats.filter((x) => x.parentId === c.id)
                        subSubCats.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'tr'))

                        return (
                          <div key={c.id} className="space-y-1">
                            <Link
                              to={`/kategori/${encodeURIComponent(c.slug)}`}
                              className={
                                'block rounded-lg px-3 py-1.5 text-sm font-medium transition-all ' +
                                (active ? 'bg-primary/10 text-primary font-semibold' : 'text-zinc-600 hover:bg-zinc-50 hover:text-on-surface')
                              }
                            >
                              {c.name}
                            </Link>
                            {subSubCats.length > 0 && (
                              <div className="pl-3.5 space-y-1.5 ml-1 border-l border-zinc-200">
                                {subSubCats.map((subSub) => {
                                  const subSubActive = currentCategory?.id === subSub.id
                                  return (
                                    <Link
                                      key={subSub.id}
                                      to={`/kategori/${encodeURIComponent(subSub.slug)}`}
                                      className={
                                        'block rounded-lg px-2.5 py-1 text-xs font-medium transition-all ' +
                                        (subSubActive ? 'bg-primary/10 text-primary font-semibold' : 'text-zinc-500 hover:bg-zinc-50 hover:text-on-surface')
                                      }
                                    >
                                      {subSub.name}
                                    </Link>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="px-3 py-2 text-xs text-zinc-400">Alt kategori yok.</div>
                  )}

                  <div className="mt-3 border-t border-zinc-100 pt-3">
                    <Link to="/kategori/all" className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-500 hover:bg-zinc-50 transition-all">
                      <span className="material-symbols-outlined text-base">grid_view</span>
                      Tüm Ürünler
                    </Link>
                  </div>
                </>
              ) : (
                <>
                  <Link to="/kategori/all" className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold bg-primary text-white">
                    <span className="material-symbols-outlined text-base">grid_view</span>
                    Tüm Ürünler
                  </Link>
                  {cats
                    .filter((x) => !x.parentId)
                    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'tr'))
                    .slice(0, 12)
                    .map((c) => (
                      <Link
                        key={c.id}
                        to={`/kategori/${encodeURIComponent(c.slug)}`}
                        className="block rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 hover:text-on-surface transition-all"
                      >
                        {c.name}
                      </Link>
                    ))}
                </>
              )}
            </div>
          </div>

          {/* Campaign Card Removed */}
        </aside>

        {/* Products Grid */}
        <section>
          {!loading && filtered.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <span className="material-symbols-outlined text-6xl text-zinc-200 mb-4">search_off</span>
              <h3 className="text-lg font-bold text-zinc-500 mb-2">Ürün bulunamadı</h3>
              <p className="text-sm text-zinc-400">Bu kategoride henüz ürün bulunmuyor.</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 md:gap-5 xl:grid-cols-3">
            {filtered.slice(0, 30).map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onAddToCart={(p) => addToCart(p)}
                onToggleFavorite={() => {}}
              />
            ))}
          </div>
        </section>
      </div>
      {/* Mobile Filter Drawer / Bottom Sheet */}
      {mobileFiltersOpen && (
        <div className="fixed inset-0 z-[100] lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity animate-fade-in"
            onClick={() => setMobileFiltersOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[70vh] bg-white rounded-t-3xl shadow-2xl flex flex-col animate-slide-up overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 bg-zinc-50/50">
              <span className="text-xs font-extrabold uppercase tracking-widest text-zinc-400 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-lg">filter_alt</span>
                Kategorileri Filtrele
              </span>
              <button
                onClick={() => setMobileFiltersOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-zinc-200 grid place-items-center active:scale-90 transition-transform"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Mobile Search Input for categories */}
              <div className="relative mb-2">
                <input
                  type="text"
                  placeholder="Kategori ara..."
                  value={categorySearchQuery}
                  onChange={(e) => setCategorySearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2.5 text-xs border border-zinc-200 rounded-xl focus:outline-none focus:border-primary placeholder-zinc-400 transition-colors font-medium bg-zinc-50"
                />
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">search</span>
                {categorySearchQuery && (
                  <button
                    type="button"
                    onClick={() => setCategorySearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-650 flex items-center justify-center"
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2 block">Mevcut Kategoriler</label>
                {categorySearchQuery.trim() ? (
                  searchedCats.length > 0 ? (
                    <div className="space-y-1">
                      {searchedCats.map((c) => {
                        const active = currentCategory?.id === c.id
                        return (
                          <Link
                            key={c.id}
                            to={`/kategori/${encodeURIComponent(c.slug)}`}
                            onClick={() => setMobileFiltersOpen(false)}
                            className={
                              'flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all ' +
                              (active ? 'bg-primary text-white' : 'text-zinc-755 hover:bg-zinc-50')
                            }
                          >
                            <span className="material-symbols-outlined text-base">folder</span>
                            <span className="truncate">{c.name}</span>
                          </Link>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="px-3 py-4 text-center text-xs text-zinc-400">
                      Eşleşen kategori bulunamadı.
                    </div>
                  )
                ) : topCategory ? (
                  <div className="space-y-1">
                    <Link
                      to={`/kategori/${encodeURIComponent(topCategory.slug)}`}
                      onClick={() => setMobileFiltersOpen(false)}
                      className={
                        'flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold transition-all ' +
                        (!currentCategory?.parentId ? 'bg-primary text-white' : 'text-zinc-755 hover:bg-zinc-50')
                      }
                    >
                      <span className="material-symbols-outlined text-base">folder</span>
                      Tüm {topCategory.name}
                    </Link>

                    {subCategories.length > 0 && (
                      <div className="pt-1 pl-2 border-l border-zinc-150 ml-3 space-y-1">
                        {subCategories.map((c) => {
                          const active = currentCategory?.id === c.id
                          return (
                            <Link
                              key={c.id}
                              to={`/kategori/${encodeURIComponent(c.slug)}`}
                              onClick={() => setMobileFiltersOpen(false)}
                              className={
                                'block rounded-xl px-3 py-2 text-xs font-semibold transition-all ' +
                                (active ? 'bg-primary/10 text-primary font-bold' : 'text-zinc-650 hover:bg-zinc-50')
                              }
                            >
                              {c.name}
                            </Link>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Link 
                      to="/kategori/all" 
                      onClick={() => setMobileFiltersOpen(false)}
                      className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold bg-primary text-white"
                    >
                      <span className="material-symbols-outlined text-base">grid_view</span>
                      Tüm Ürünler
                    </Link>
                    {cats
                      .filter((x) => !x.parentId)
                      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'tr'))
                      .slice(0, 12)
                      .map((c) => (
                        <Link
                          key={c.id}
                          to={`/kategori/${encodeURIComponent(c.slug)}`}
                          onClick={() => setMobileFiltersOpen(false)}
                          className="block rounded-xl px-3 py-2.5 text-xs font-semibold text-zinc-650 hover:bg-zinc-50 transition-all"
                        >
                          {c.name}
                        </Link>
                      ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
