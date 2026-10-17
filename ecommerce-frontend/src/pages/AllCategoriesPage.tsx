import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchStorefrontCategories, type CategoryDto } from '../lib/categoriesApi'
import { useSEO } from '../hooks/useSEO'

export function AllCategoriesPage() {
  useSEO({
    title: 'Tüm Kategoriler',
    description: 'Stilsoft KKTC ürün kategorileri. Beyaz eşya, küçük ev aletleri, mutfak robotları, süpürgeler ve daha fazlası.'
  })
  const [cats, setCats] = useState<CategoryDto[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setError(null)
        const list = await fetchStorefrontCategories()
        if (!cancelled) setCats(list)
      } catch (e) {
        if (!cancelled) {
          setCats([])
          setError(e instanceof Error ? e.message : 'Kategoriler alınamadı')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const top = useMemo(
    () =>
      cats
        .filter((x) => !x.parentId)
        .slice()
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'tr')),
    [cats],
  )

  return (
    <div className="max-w-7xl mx-auto px-6 pb-20 pt-10">
      {/* Header Section */}
      <div className="mb-12">
        <span className="inline-block px-3 py-1 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-[0.2em] rounded-full mb-4">Ürün Dünyası</span>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-on-surface mb-4">Tüm Kategoriler</h1>
        <p className="text-lg text-zinc-500 max-w-2xl leading-relaxed">
          Evinizin her köşesi için teknoloji ve tasarımı birleştiren Stilsoft dünyasını keşfedin. İhtiyacınız olan tüm ürün grupları tek bir yerde.
        </p>
      </div>

      {/* Main Categories Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 mb-16">
        {error ? (
          <div className="md:col-span-12 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</div>
        ) : null}

        {top.length === 0 ? (
          <div className="md:col-span-12 rounded-2xl border border-zinc-200 bg-white px-4 py-8 text-sm text-zinc-600">Henüz kategori yok.</div>
        ) : (
          top.map((c) => (
            <Link
              key={c.id}
              to={`/kategori/${encodeURIComponent(c.slug)}`}
              className="md:col-span-4 group relative overflow-hidden rounded-3xl h-[320px] shadow-sm hover:shadow-xl hover:shadow-primary/10 transition-all duration-500 border border-zinc-100"
            >
              {c.imageUrl ? (
                <img className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" src={c.imageUrl} alt={c.name} />
              ) : (
                <div className="absolute inset-0 w-full h-full bg-zinc-50 grid place-items-center text-zinc-300">
                  <span className="material-symbols-outlined text-6xl">image</span>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent flex flex-col justify-end p-8">
                <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">{c.name}</h2>
                <span className="text-white/80 text-sm font-semibold flex items-center gap-2">
                  İncele <span className="material-symbols-outlined text-base">arrow_forward</span>
                </span>
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Technical Category Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {top.slice(0, 4).map((c) => (
          <Link
            key={c.id}
            to={`/kategori/${encodeURIComponent(c.slug)}`}
            className="bg-white p-8 rounded-2xl border border-zinc-100 shadow-sm hover:border-primary/30 hover:shadow-lg transition-all cursor-pointer group flex flex-col items-center text-center"
          >
            <div className="w-16 h-16 bg-zinc-50 rounded-2xl flex items-center justify-center mb-5 group-hover:bg-primary group-hover:text-white transition-colors">
              <span className="material-symbols-outlined text-primary group-hover:text-white text-3xl transition-colors">category</span>
            </div>
            <h3 className="text-lg font-bold text-on-surface mb-2">{c.name}</h3>
            <p className="text-zinc-500 text-xs leading-relaxed">/{c.slug}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
