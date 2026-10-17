import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ErpProductListItem } from '../lib/api'
import { formatPrice } from '../lib/format'
import { Icon } from './Icon'
import { isFavoritedCached, toggleFavorite } from '../lib/favorites'
import { addToCart } from '../lib/cart'
import { isInComparison, addToComparison, removeFromComparison } from '../lib/comparison'
import { useToast } from './ui/ToastContext'
import { generateSlug } from '../lib/slug'

export function ProductCard({
  product,
  onAddToCart,
  onToggleFavorite,
  isFavorited,
}: {
  product: ErpProductListItem
  onAddToCart?: (p: ErpProductListItem) => void
  onToggleFavorite?: (p: ErpProductListItem) => void
  isFavorited?: boolean
}) {
  const { showToast } = useToast()
  const slug = generateSlug(product.name || '')
  const href = `/urun/${slug}/${product.id}${product.tenantCode ? `?tenantCode=${encodeURIComponent(product.tenantCode)}` : ''}`

  const effectiveFavorited = isFavorited ?? isFavoritedCached(product.tenantCode, product.id)
  const [isCompared, setIsCompared] = useState(isInComparison(product.tenantCode ?? '', product.id))

  const [design] = useState(() => {
    const saved = localStorage.getItem('ecom_store_design')
    return saved ? JSON.parse(saved) : { cargoFee: 150, freeShippingThreshold: 2000, currency: 'TL' }
  })

  const cargoFee = design.cargoFee ?? 150
  const threshold = design.freeShippingThreshold ?? 2000
  const currency = design.currency || 'TL'
  const isFreeShipping = !!product.isFreeShipping || cargoFee === 0 || (product.unitPrice ?? 0) >= threshold
  const shippingText = isFreeShipping ? 'Ücretsiz Kargo' : `Kargo: ${cargoFee} ${currency}`

  useEffect(() => {
    const handleUpdate = () => {
      setIsCompared(isInComparison(product.tenantCode ?? '', product.id))
    }
    window.addEventListener('comparison-updated', handleUpdate)
    return () => {
      window.removeEventListener('comparison-updated', handleUpdate)
    }
  }, [product.tenantCode, product.id])

  return (
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-zinc-200 bg-white hover:border-primary/30 hover:shadow-lg transition-all duration-300 p-2 sm:p-4">
      {/* Top area wrapped in Link */}
      <Link to={href} className="block space-y-1.5 sm:space-y-3">
        <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-zinc-50 flex items-center justify-center p-1 sm:p-2">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name ?? ''}
              className="max-h-full max-w-full object-contain transition duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
              <span className="material-symbols-outlined text-4xl text-zinc-200">image</span>
            </div>
          )}

          {/* Campaign badge */}
          {product.campaignBadge ? (
            <div className="absolute left-1.5 sm:left-2 top-1.5 sm:top-2 z-10 inline-flex items-center gap-1 rounded-full bg-[#df0000] px-1.5 sm:px-2.5 py-0.5 text-[7px] sm:text-[9px] font-black uppercase tracking-wider text-white shadow-md">
              <span className="material-symbols-outlined text-[10px] font-black">campaign</span>
              {product.campaignBadge}
            </div>
          ) : product.isCampaign ? (
            <div className="absolute left-1.5 sm:left-2 top-1.5 sm:top-2 z-10 inline-flex items-center gap-1 rounded-full bg-[#df0000] px-1.5 sm:px-2.5 py-0.5 text-[7px] sm:text-[9px] font-black uppercase tracking-wider text-white shadow-md animate-pulse">
              <span className="material-symbols-outlined text-[10px] font-black">campaign</span>
              Kampanya
            </div>
          ) : null}

          {/* Favorite button absolute positioning */}
          <button
            type="button"
            className={`absolute right-1.5 sm:right-2 top-1.5 sm:top-2 z-10 grid h-7 w-7 sm:h-8 sm:w-8 place-items-center rounded-full bg-white/90 border border-zinc-100 text-zinc-400 hover:text-rose-650 transition-all hover:scale-110 shadow-sm ${
              effectiveFavorited ? 'text-rose-600' : ''
            }`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (onToggleFavorite) {
                onToggleFavorite(product)
              } else {
                void toggleFavorite(product.tenantCode, product.id)
              }
            }}
            aria-label="Favori"
            title="Favori"
          >
            <Icon name="heart" className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {product.brand && (
              <span className="inline-flex items-center rounded-md bg-[#df0000]/5 px-1.5 py-0.5 text-[8px] sm:text-[9px] font-bold text-[#df0000] border border-[#df0000]/10 uppercase tracking-wider">
                {product.brand}
              </span>
            )}
            <span className="truncate text-[9px] sm:text-[10px] text-zinc-400 font-bold uppercase tracking-wider">
              {product.mainCategory || product.stockCode || 'Teknoloji'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-px">
              {[1, 2, 3, 4, 5].map((s) => {
                const isFilled = s <= Math.round(product.ratingAverage ?? 0)
                return (
                  <span
                    key={s}
                    className={`material-symbols-outlined text-[13px] ${isFilled ? 'text-amber-400' : 'text-zinc-200'}`}
                    style={{ fontVariationSettings: isFilled ? "'FILL' 1" : undefined }}
                  >
                    star
                  </span>
                )
              })}
            </div>
            <span className="text-[10px] text-zinc-400 font-semibold">({product.reviewsCount ?? 0})</span>
          </div>
          <h3 className="line-clamp-2 text-[10px] sm:text-sm font-bold text-on-surface leading-tight sm:leading-snug group-hover:text-primary transition-colors min-h-[28px] sm:min-h-[40px]">
            {product.name ?? product.stockCode ?? 'Ürün'}
          </h3>
          <div className="flex items-center justify-between gap-1 flex-wrap pt-1">
            <div className="flex flex-col">
              {product.discountedPrice && product.originalPrice && product.discountedPrice < product.originalPrice ? (
                <>
                  <span className="text-[10px] sm:text-xs font-semibold text-zinc-400 line-through">
                    {formatPrice({ ...product, unitPrice: product.originalPrice })}
                  </span>
                  <span className="text-sm sm:text-xl font-extrabold text-[#df0000]">
                    {formatPrice({ ...product, unitPrice: product.discountedPrice })}
                  </span>
                </>
              ) : (
                <span className="text-sm sm:text-xl font-extrabold text-primary">
                  {formatPrice(product)}
                </span>
              )}
            </div>
            <div className={`inline-flex items-center gap-1 text-[8px] sm:text-[9px] font-bold px-1.5 py-0.5 rounded-md ${
              isFreeShipping 
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                : 'bg-zinc-50 text-zinc-500 border border-zinc-150'
            }`}>
              <span className="material-symbols-outlined text-[10px] sm:text-[12px] leading-none">local_shipping</span>
              <span className="leading-none">{shippingText}</span>
            </div>
          </div>
        </div>
      </Link>

      {/* Bottom Actions area */}
      <div className="mt-2 sm:mt-4 pt-2 border-t border-zinc-100 space-y-1.5 sm:space-y-3">
        {/* Comparison Checkbox */}
        <label 
          className="hidden sm:flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-800 cursor-pointer select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={isCompared}
            onChange={(e) => {
              e.stopPropagation();
              if (isCompared) {
                removeFromComparison(product.tenantCode ?? '', product.id)
                showToast('Ürün karşılaştırma listesinden kaldırıldı.', 'success')
              } else {
                const res = addToComparison(product.tenantCode ?? '', product.id)
                if (res.success) {
                   showToast(res.message, 'success')
                } else {
                  showToast(res.message, 'warning')
                }
              }
            }}
            className="rounded border-zinc-300 text-primary focus:ring-primary h-4 w-4 accent-primary"
          />
          <span>Karşılaştır</span>
        </label>

        {/* Sepete Ekle Button */}
        <button
          type="button"
          className="w-full rounded-lg bg-primary py-1.5 sm:py-2.5 text-[10px] sm:text-xs font-bold text-white uppercase tracking-wide sm:tracking-wider hover:bg-primary-container active:scale-98 transition-all flex items-center justify-center gap-1 sm:gap-2 shadow-sm"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (onAddToCart) onAddToCart(product)
            else addToCart(product)
          }}
        >
          <span className="material-symbols-outlined text-[15px] sm:text-base">add_shopping_cart</span>
          Sepete Ekle
        </button>
      </div>
    </div>
  )
}
