import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { extractProductsList, getMemberToken, readApiResponse, type ErpProductListItem } from '../lib/api'
import { ProductCard } from '../components/ProductCard'
import { toggleFavorite } from '../lib/favorites'

export function FavorilerPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ErpProductListItem[]>([])
  const [favKeys, setFavKeys] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const token = getMemberToken()
        if (!token) {
          if (!cancelled) {
            setItems([])
            setFavKeys(new Set())
          }
          return
        }

        setLoading(true)
        setError(null)

        const res = await fetch('/api/favorites', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const json = await readApiResponse(res)
        if (!res.ok || !json?.success) throw new Error(json?.message || 'Favoriler alınamadı')

        const list = extractProductsList(json)
        if (!cancelled) setItems(list)

        const keys = new Set<string>()
        for (const p of list) {
          const k = `${String(p.tenantCode ?? '').trim().toUpperCase()}:${p.id}`
          keys.add(k)
        }
        if (!cancelled) setFavKeys(keys)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Favoriler alınamadı')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="mx-auto max-w-7xl px-6 pb-20">
      <nav className="flex items-center gap-2 text-sm text-zinc-500">
        <Link to="/" className="hover:text-primary">
          Ana Sayfa
        </Link>
        <span>›</span>
        <span className="font-medium text-zinc-800">Favoriler</span>
      </nav>

      <div className="mt-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Favoriler</h1>
          <p className="mt-2 text-zinc-500">Beğendiğiniz ürünleri burada takip edebilirsiniz.</p>
        </div>
      </div>

      {loading ? <div className="mt-10 text-sm text-zinc-500">Yükleniyor…</div> : null}
      {error ? <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div> : null}

      {!loading && !error && !getMemberToken() ? (
        <div className="mt-10 rounded-2xl border border-zinc-100 bg-white p-6 text-sm text-zinc-600">
          Favorileri görmek için giriş yapmalısınız.
        </div>
      ) : null}

      {!loading && !error && items.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-zinc-100 bg-white p-6 text-sm text-zinc-600">
          Henüz favori ürününüz yok.
        </div>
      ) : null}

      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-8 lg:grid-cols-4">
        {items.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            onAddToCart={() => {
              // UI only for now
            }}
            isFavorited={favKeys.has(`${String(p.tenantCode ?? '').trim().toUpperCase()}:${p.id}`)}
            onToggleFavorite={async () => {
              try {
                const isFav = await toggleFavorite(p.tenantCode, p.id)
                setFavKeys((prev) => {
                  const next = new Set(prev)
                  const key = `${String(p.tenantCode ?? '').trim().toUpperCase()}:${p.id}`
                  if (isFav) next.add(key)
                  else next.delete(key)
                  return next
                })
                if (!isFav) {
                  setItems((prev) => prev.filter((x) => x.id !== p.id))
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Favori güncellenemedi')
              }
            }}
          />
        ))}
      </div>
    </div>
  )
}
