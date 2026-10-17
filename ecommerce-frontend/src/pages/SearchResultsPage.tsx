import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { extractProductsList, readApiResponse, type ErpProductListItem } from '../lib/api'
import { ProductCard } from '../components/ProductCard'
import { addToCart } from '../lib/cart'
import { useSEO } from '../hooks/useSEO'
import { toggleFavorite } from '../lib/favorites'
import { trackLiveEvent } from '../lib/liveTracker'

export function SearchResultsPage() {
  const location = useLocation()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allProducts, setAllProducts] = useState<ErpProductListItem[]>([])
  const [sortType, setSortType] = useState('popular')
  const [favorites, setFavorites] = useState<Record<string, boolean>>({})

  // Parse query parameter q
  const query = useMemo(() => {
    const sp = new URLSearchParams(location.search)
    return (sp.get('q') ?? '').trim()
  }, [location.search])

  useEffect(() => {
    if (query) {
      trackLiveEvent('search', `"${query}" aradı`)
    }
  }, [query])

  useSEO({
    title: query ? `"${query}" Arama Sonuçları` : 'Arama Sonuçları',
    description: `Stilsoft KKTC'de "${query}" için arama sonuçları. En kaliteli ve en uygun fiyatlı ev aletlerini keşfedin.`,
  })

  // Fetch all products
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch('/api/storefront/products')
        const json = await readApiResponse(res)
        if (!res.ok) throw new Error(json?.message || 'Ürünler yüklenemedi')
        const data = extractProductsList(json)
        if (!cancelled) {
          setAllProducts(data)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Ürünler yüklenemedi')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  // Filter products by search query
  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    if (!q) return allProducts

    return allProducts.filter((p) => {
      const nameMatch = (p.name ?? '').toLowerCase().includes(q)
      const codeMatch = (p.stockCode ?? '').toLowerCase().includes(q)
      const categoryMatch = (p.mainCategory ?? '').toLowerCase().includes(q)
      return nameMatch || codeMatch || categoryMatch
    })
  }, [allProducts, query])

  // Sort products
  const sorted = useMemo(() => {
    const list = [...filtered]
    if (sortType === 'price-asc') {
      list.sort((a, b) => (a.unitPrice ?? 0) - (b.unitPrice ?? 0))
    } else if (sortType === 'price-desc') {
      list.sort((a, b) => (b.unitPrice ?? 0) - (a.unitPrice ?? 0))
    } else if (sortType === 'name-asc') {
      list.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'tr'))
    } else {
      // Default: popular / newest (we can keep original list ordering which is newest first)
    }
    return list
  }, [filtered, sortType])

  const handleToggleFavorite = async (product: ErpProductListItem) => {
    try {
      const isFav = await toggleFavorite(product.tenantCode, product.id)
      setFavorites((prev) => ({ ...prev, [product.id]: isFav }))
    } catch {
      // ignore
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 pb-20 pt-6">
      {/* Result Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 space-y-6 md:space-y-0">
        <div>
          <nav className="flex items-center text-zinc-400 text-xs mb-3 space-x-2 font-medium">
            <Link className="hover:text-primary transition-colors flex items-center" to="/">
              <span className="material-symbols-outlined text-[14px] mr-1">home</span>Ana Sayfa
            </Link>
            <span className="text-zinc-300">/</span>
            <span className="text-zinc-600">Arama Sonuçları</span>
          </nav>
          <h1 className="text-3xl md:text-4xl font-bold text-on-surface tracking-tight">
            {sorted.length} Sonuç: <span className="text-primary italic">&quot;{query}&quot;</span>
          </h1>
        </div>
        <div className="flex items-center space-x-3">
          <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Sırala:</span>
          <div className="relative">
            <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none text-lg">
              expand_more
            </span>
            <select
              value={sortType}
              onChange={(e) => setSortType(e.target.value)}
              className="bg-white border border-zinc-200 text-sm font-medium rounded-xl pl-4 pr-10 py-2.5 focus:ring-2 focus:ring-primary/20 focus:border-primary appearance-none outline-none transition-all text-zinc-700 min-w-[180px]"
            >
              <option value="popular">Önerilen (Popülerlik)</option>
              <option value="price-asc">En Düşük Fiyat</option>
              <option value="price-desc">En Yüksek Fiyat</option>
              <option value="name-asc">A-Z Sıralama</option>
            </select>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm font-semibold text-rose-700 mb-6 flex items-center gap-3">
          <span className="material-symbols-outlined">error</span>
          {error}
        </div>
      )}

      {!loading && !error && sorted.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center bg-white border border-zinc-100 rounded-3xl p-8 shadow-xs">
          <span className="material-symbols-outlined text-6xl text-zinc-300 mb-4">search_off</span>
          <h3 className="text-xl font-bold text-zinc-700 mb-2">Aramanızla eşleşen ürün bulunamadı</h3>
          <p className="text-sm text-zinc-400 max-w-md mb-6">
            Lütfen yazım kurallarını kontrol edin veya farklı anahtar kelimeler kullanarak tekrar arama yapın.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link to="/" className="px-6 py-3 bg-primary text-white font-bold rounded-xl text-xs hover:bg-primary-container transition active:scale-95">
              Ana Sayfaya Dön
            </Link>
            <Link to="/kategoriler" className="px-6 py-3 bg-zinc-100 text-zinc-700 font-bold rounded-xl text-xs hover:bg-zinc-200 transition active:scale-95">
              Kategorileri İncele
            </Link>
          </div>
        </div>
      )}

      {!loading && !error && sorted.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:gap-6 md:grid-cols-3 lg:grid-cols-4">
          {sorted.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              onAddToCart={(prod) => addToCart(prod)}
              onToggleFavorite={() => handleToggleFavorite(p)}
              isFavorited={favorites[p.id]}
            />
          ))}
        </div>
      )}
    </div>
  )
}
