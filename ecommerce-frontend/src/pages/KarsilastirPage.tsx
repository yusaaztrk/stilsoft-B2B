import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { extractProduct, readApiResponse, type ErpProductListItem } from '../lib/api'
import { formatPrice } from '../lib/format'
import { getComparisonList, removeFromComparison, type ComparisonItem } from '../lib/comparison'
import { addToCart } from '../lib/cart'
import { useToast } from '../components/ui/ToastContext'
import { generateSlug } from '../lib/slug'

export function KarsilastirPage() {
  const { showToast } = useToast()
  const [products, setProducts] = useState<ErpProductListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadComparedProducts = async (list: ComparisonItem[]) => {
    if (list.length === 0) {
      setProducts([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const fetched: ErpProductListItem[] = []
      for (const item of list) {
        const qs = item.tenantCode ? `?tenantCode=${encodeURIComponent(item.tenantCode)}` : ''
        const res = await fetch(`/api/storefront/products/${item.productId}${qs}`)
        if (res.ok) {
          const json = await readApiResponse(res)
          const dto = extractProduct(json)
          if (dto) {
            fetched.push(dto)
          }
        }
      }
      setProducts(fetched)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Karşılaştırma ürünleri yüklenirken hata oluştu.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const list = getComparisonList()
    void loadComparedProducts(list)

    const handleUpdate = () => {
      const list = getComparisonList()
      void loadComparedProducts(list)
    }

    window.addEventListener('comparison-updated', handleUpdate)
    return () => {
      window.removeEventListener('comparison-updated', handleUpdate)
    }
  }, [])

  const handleRemove = (tenantCode: string | undefined, productId: string) => {
    removeFromComparison(tenantCode ?? '', productId)
    showToast('Ürün karşılaştırmadan kaldırıldı.', 'success')
  }

  const handleAddToCart = (product: ErpProductListItem) => {
    addToCart(product)
  }

  // Get all unique feature keys/names across all products to make rows for comparison
  const allFeatures = Array.from(
    new Set(
      products.flatMap((p) => p.features || [])
    )
  )

  return (
    <div className="mx-auto max-w-7xl px-6 pb-20 pt-6">
      <nav className="flex items-center gap-2 text-sm text-zinc-400">
        <Link to="/" className="hover:text-primary transition-colors">
          Ana Sayfa
        </Link>
        <span className="material-symbols-outlined text-xs">chevron_right</span>
        <span className="font-medium text-zinc-800">Ürün Karşılaştırma</span>
      </nav>

      <div className="mt-6">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Ürün Karşılaştırma</h1>
        <p className="mt-2 text-zinc-500">
          En fazla 4 ürünü özellikleri, fiyatları ve stok durumları ile yan yana karşılaştırın.
        </p>
      </div>

      {loading && (
        <div className="mt-12 flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700 flex items-center gap-2">
          <span className="material-symbols-outlined">error</span>
          {error}
        </div>
      )}

      {!loading && !error && products.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/50 p-12 text-center">
          <span className="material-symbols-outlined text-5xl text-zinc-300">compare_arrows</span>
          <h3 className="mt-4 text-lg font-bold text-zinc-800">Karşılaştırılacak ürün bulunmuyor</h3>
          <p className="mt-2 text-zinc-500 text-sm max-w-md mx-auto">
            Ürün listelerinden veya ürün detay sayfalarından beğendiğiniz ürünleri karşılaştırma listesine ekleyebilirsiniz.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-red-700 active:scale-95 transition-all shadow-md animate-in"
          >
            Alışverişe Başla
          </Link>
        </div>
      ) : null}

      {!loading && !error && products.length > 0 ? (
        <div className="mt-8 overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm scrollbar-thin">
          <table className="w-full border-collapse text-left table-fixed min-w-[700px]">
            <colgroup>
              <col className="w-[130px] sm:w-[220px]" />
              {products.map((p) => (
                <col key={p.id} className="w-[150px] sm:w-[240px]" />
              ))}
              {Array.from({ length: Math.max(0, 4 - products.length) }).map((_, i) => (
                <col key={`empty-col-w-${i}`} className="w-[150px] sm:w-[240px]" />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50/50">
                <th className="sticky left-0 bg-zinc-50 z-20 shadow-[3px_0_8px_-3px_rgba(0,0,0,0.08)] p-3 sm:p-5 font-bold text-zinc-450 text-[10px] sm:text-xs uppercase tracking-wider">
                  Karşılaştırma Kriterleri
                </th>
                {products.map((p) => (
                  <th key={p.id} className="p-3 sm:p-5 relative align-top border-l border-zinc-100 group bg-white">
                    <button
                      onClick={() => handleRemove(p.tenantCode, p.id)}
                      className="absolute top-2.5 right-2.5 text-zinc-400 hover:text-primary transition-colors p-1 rounded-full hover:bg-zinc-100 active:scale-90"
                      title="Kaldır"
                    >
                      <span className="material-symbols-outlined text-base sm:text-lg">close</span>
                    </button>
                    <div className="pr-4 mt-2">
                      <div className="aspect-square w-full max-w-[100px] sm:max-w-[150px] mx-auto rounded-lg overflow-hidden bg-zinc-50 border border-zinc-100 p-2 mb-3 flex items-center justify-center">
                        {p.imageUrl ? (
                          <img
                            src={p.imageUrl}
                            alt={p.name}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <span className="material-symbols-outlined text-3xl text-zinc-200">image</span>
                        )}
                      </div>
                      <div className="text-[8px] sm:text-[10px] text-zinc-400 font-bold uppercase tracking-wider truncate">
                        {p.stockCode}
                      </div>
                      <Link
                        to={`/urun/${generateSlug(p.name || '')}/${p.id}${p.tenantCode ? `?tenantCode=${encodeURIComponent(p.tenantCode)}` : ''}`}
                        className="block mt-1 font-bold text-[11px] sm:text-sm text-zinc-800 line-clamp-2 hover:text-primary transition-colors leading-tight"
                      >
                        {p.name}
                      </Link>
                      <div className="mt-1 text-xs sm:text-lg font-black text-primary">
                        {formatPrice(p)}
                      </div>
                      <button
                        onClick={() => handleAddToCart(p)}
                        disabled={((p as any).stock ?? 0) <= 0}
                        className="mt-3 w-full inline-flex items-center justify-center gap-1 rounded-xl bg-primary text-white text-[10px] sm:text-xs font-bold py-1.5 sm:py-2.5 hover:bg-red-700 active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition-all shadow-sm"
                      >
                        <span className="material-symbols-outlined text-xs sm:text-sm">add_shopping_cart</span>
                        Sepete Ekle
                      </button>
                    </div>
                  </th>
                ))}
                {/* Pad columns to match 4 if less */}
                {Array.from({ length: Math.max(0, 4 - products.length) }).map((_, i) => (
                  <th key={`empty-col-${i}`} className="p-3 sm:p-5 align-middle border-l border-zinc-100 bg-zinc-50/20 text-center">
                    <div className="flex flex-col items-center justify-center py-6 text-zinc-400">
                      <span className="material-symbols-outlined text-2xl sm:text-3xl mb-1">add_circle_outline</span>
                      <span className="text-[10px] sm:text-xs">Ürün Ekle</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Row 1: Stock Status */}
              <tr className="border-b border-zinc-100 hover:bg-zinc-50/10 transition-colors">
                <td className="sticky left-0 bg-white z-10 shadow-[3px_0_8px_-3px_rgba(0,0,0,0.08)] p-3 sm:p-5 font-bold text-[10px] sm:text-xs text-zinc-500 uppercase">Stok Durumu</td>
                {products.map((p) => {
                  const stock = (p as any).stock ?? 0
                  return (
                    <td key={`stock-${p.id}`} className="p-3 sm:p-5 border-l border-zinc-100 font-bold text-xs sm:text-sm">
                      {stock > 0 ? (
                        <span className="text-green-650 flex items-center gap-0.5 sm:gap-1">
                          <span className="material-symbols-outlined text-sm sm:text-base">check_circle</span> Var ({stock})
                        </span>
                      ) : (
                        <span className="text-rose-650 flex items-center gap-0.5 sm:gap-1">
                          <span className="material-symbols-outlined text-sm sm:text-base">cancel</span> Tükendi
                        </span>
                      )}
                    </td>
                  );
                })}
                {Array.from({ length: Math.max(0, 4 - products.length) }).map((_, i) => (
                  <td key={`empty-stock-${i}`} className="p-3 sm:p-5 border-l border-zinc-100 bg-zinc-50/20" />
                ))}
              </tr>

              {/* Row 2: Category */}
              <tr className="border-b border-zinc-100 hover:bg-zinc-50/10 transition-colors">
                <td className="sticky left-0 bg-white z-10 shadow-[3px_0_8px_-3px_rgba(0,0,0,0.08)] p-3 sm:p-5 font-bold text-[10px] sm:text-xs text-zinc-500 uppercase">Kategori</td>
                {products.map((p) => (
                  <td key={`category-${p.id}`} className="p-3 sm:p-5 border-l border-zinc-100 text-xs sm:text-sm text-zinc-650 font-semibold">
                    {p.mainCategory || 'Kategori Yok'}
                  </td>
                ))}
                {Array.from({ length: Math.max(0, 4 - products.length) }).map((_, i) => (
                  <td key={`empty-cat-${i}`} className="p-3 sm:p-5 border-l border-zinc-100 bg-zinc-50/20" />
                ))}
              </tr>

              {/* Unique features dynamically comparison */}
              {allFeatures.map((feature, fIdx) => (
                <tr
                  key={`feat-${fIdx}`}
                  className="border-b border-zinc-100 hover:bg-zinc-50/10 transition-colors"
                >
                  <td className="sticky left-0 bg-white z-10 shadow-[3px_0_8px_-3px_rgba(0,0,0,0.08)] p-3 sm:p-5 font-bold text-[10px] sm:text-xs text-zinc-550 uppercase max-w-[130px] sm:max-w-[220px] truncate" title={feature}>
                    {feature}
                  </td>
                  {products.map((p) => {
                    const hasFeature = p.features?.includes(feature)
                    return (
                      <td
                        key={`feat-${p.id}-${fIdx}`}
                        className="p-3 sm:p-5 border-l border-zinc-100 text-xs sm:text-sm text-zinc-650"
                      >
                        {hasFeature ? (
                          <span className="text-green-650 font-bold flex items-center gap-0.5 sm:gap-1">
                            <span className="material-symbols-outlined text-sm sm:text-base">check</span> Evet
                          </span>
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </td>
                    )
                  })}
                  {Array.from({ length: Math.max(0, 4 - products.length) }).map((_, i) => (
                    <td key={`empty-feat-${fIdx}-${i}`} className="p-3 sm:p-5 border-l border-zinc-100 bg-zinc-50/20" />
                  ))}
                </tr>
              ))}

              {/* Description */}
              <tr className="border-b border-zinc-100 hover:bg-zinc-50/10 transition-colors">
                <td className="sticky left-0 bg-white z-10 shadow-[3px_0_8px_-3px_rgba(0,0,0,0.08)] p-3 sm:p-5 font-bold text-[10px] sm:text-xs text-zinc-550 uppercase">Açıklama</td>
                {products.map((p) => (
                  <td key={`desc-${p.id}`} className="p-3 sm:p-5 border-l border-zinc-100 text-[10px] sm:text-xs text-zinc-500 leading-relaxed max-w-[150px] sm:max-w-[240px]">
                    <div className="line-clamp-4">{p.description || 'Açıklama belirtilmemiş.'}</div>
                  </td>
                ))}
                {Array.from({ length: Math.max(0, 4 - products.length) }).map((_, i) => (
                  <td key={`empty-desc-${i}`} className="p-3 sm:p-5 border-l border-zinc-100 bg-zinc-50/20" />
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
