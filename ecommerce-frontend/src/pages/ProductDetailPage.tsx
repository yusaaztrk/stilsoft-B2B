import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { extractProduct, getMemberToken, readApiResponse, type ErpProductListItem } from '../lib/api'
import { addToCart } from '../lib/cart'
import { isFavoritedCached, toggleFavorite } from '../lib/favorites'
import { useSEO } from '../hooks/useSEO'
import { useToast } from '../components/ui/ToastContext'
import { isInComparison, addToComparison, removeFromComparison } from '../lib/comparison'
import { trackLiveEvent } from '../lib/liveTracker'
import { ProductCard } from '../components/ProductCard'
import { fetchStorefrontCategories, type CategoryDto } from '../lib/categoriesApi'

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

type ReviewItem = {
  id: string
  customerName: string
  rating: number
  comment: string
  createdAtUtc: string
  customerEmail?: string
  adminReply?: string
}


export function ProductDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const nav = useNavigate()
  const [design] = useState(() => {
    const saved = localStorage.getItem('ecom_store_design')
    return saved ? JSON.parse(saved) : { cargoFee: 150, freeShippingThreshold: 2000, currency: 'TL' }
  })
  const cargoFee = design.cargoFee ?? 150
  const threshold = design.freeShippingThreshold ?? 2000
  const currency = design.currency || 'TL'
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [p, setP] = useState<ErpProductListItem | null>(null)
  const [qty, setQty] = useState(1)
  const [selectedThumb, setSelectedThumb] = useState(0)
  const [fav, setFav] = useState(false)
  const [isCompared, setIsCompared] = useState(false)
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [reviewRating, setReviewRating] = useState(5)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const [selectedRatingFilter, setSelectedRatingFilter] = useState<number | null>(null)
  const [cats, setCats] = useState<CategoryDto[]>([])

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

  const matchedCategory = useMemo(() => {
    if (!p || cats.length === 0) return null
    const subCat = p.subCategory ? cats.find(c => c.id === p.subCategory || c.slug === p.subCategory || c.name.toLowerCase() === p.subCategory?.toLowerCase()) : null
    if (subCat) return subCat
    const mainCat = p.mainCategory ? cats.find(c => c.id === p.mainCategory || c.slug === p.mainCategory || c.name.toLowerCase() === p.mainCategory?.toLowerCase()) : null
    return mainCat
  }, [p, cats])

  const breadcrumbPath = useMemo(() => {
    if (!matchedCategory) {
      if (p?.mainCategory) {
        return [{ name: p.mainCategory, slug: encodeURIComponent(p.mainCategory) }]
      }
      return []
    }

    const path: { name: string; slug: string }[] = []
    let current: CategoryDto | undefined = matchedCategory
    while (current) {
      path.unshift({ name: current.name, slug: current.slug })
      const parentId = current.parentId
      current = parentId ? cats.find(c => c.id === parentId) : undefined
    }
    return path
  }, [matchedCategory, cats, p])

  const starCounts = useMemo(() => {
    const counts: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
    reviews.forEach((r) => {
      const rating = r.rating
      if (counts[rating] !== undefined) {
        counts[rating]++
      }
    })
    return counts
  }, [reviews])

  const filteredReviews = useMemo(() => {
    if (selectedRatingFilter === null) return reviews
    return reviews.filter((r) => r.rating === selectedRatingFilter)
  }, [reviews, selectedRatingFilter])

  // Current logged in user info for comment edit/delete ownership check
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null)
  const [editingComment, setEditingComment] = useState('')
  const [editingRating, setEditingRating] = useState(5)
  const [editingSubmitting, setEditingSubmitting] = useState(false)
  // Accordion states for mobile
  const [specExpanded, setSpecExpanded] = useState(false)
  const [reviewsExpanded, setReviewsExpanded] = useState(false)

  // Sticky Buy Action Bar state
  const [showStickyBar, setShowStickyBar] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setShowStickyBar(window.scrollY > 600)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])


  useEffect(() => {
    if (!p) return
    setIsCompared(isInComparison(p.tenantCode ?? '', p.id))
    const handleUpdate = () => {
      setIsCompared(isInComparison(p.tenantCode ?? '', p.id))
    }
    window.addEventListener('comparison-updated', handleUpdate)
    return () => {
      window.removeEventListener('comparison-updated', handleUpdate)
    }
  }, [p])

  const tenantCode = useMemo(() => {
    const sp = new URLSearchParams(location.search)
    return (sp.get('tenantCode') ?? '').trim()
  }, [location.search])



  const groupedVariants = useMemo(() => {
    if (!p || !(p as any).variants) return {}
    const rawVariants = (p as any).variants
    if (!Array.isArray(rawVariants)) return {}

    const groups: Record<string, Array<{ value: string; link: string }>> = {}
    rawVariants.forEach((v: any) => {
      if (v.groupName && Array.isArray(v.items)) {
        // New grouped format
        const gName = (v.groupName || '').trim()
        if (!gName) return
        if (!groups[gName]) groups[gName] = []
        v.items.forEach((item: any) => {
          const val = (item.value || '').trim()
          const lnk = (item.link || '').trim()
          if (val && lnk) {
            groups[gName].push({ value: val, link: lnk })
          }
        })
      } else {
        // Old flat format
        const groupName = (v.optionName || v.group || '').trim()
        const val = (v.value || '').trim()
        const lnk = (v.link || '').trim()
        if (groupName && val && lnk) {
          if (!groups[groupName]) {
            groups[groupName] = []
          }
          groups[groupName].push({ value: val, link: lnk })
        }
      }
    })
    return groups
  }, [p])

  const displayPrice = useMemo(() => {
    return p?.unitPrice
  }, [p])

  const images = useMemo(() => {
    if (p?.imageUrls && p.imageUrls.length > 0) {
      return p.imageUrls
    }
    if (p?.imageUrl) {
      return [p.imageUrl]
    }
    return []
  }, [p])

  const displayImage = useMemo(() => {
    return images[selectedThumb] || p?.imageUrl
  }, [images, selectedThumb, p])

  const displayStock = useMemo(() => {
    return (p as any)?.stock ?? 10
  }, [p])

  const safeCurrency = useMemo(() => {
    const raw = (p?.currency ?? 'TRY').trim().toUpperCase()
    return raw === 'TL' ? 'TRY' : raw
  }, [p])

  const formattedPrice = useMemo(() => {
    if (displayPrice === undefined) return '₺--'
    try {
      return displayPrice.toLocaleString('tr-TR', { style: 'currency', currency: safeCurrency })
    } catch {
      return `${p?.currencySymbol || '₺'}${displayPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`
    }
  }, [displayPrice, safeCurrency, p])

  const formattedDiscountPrice = useMemo(() => {
    if (!p?.originalPrice) return null
    const originalPrice = p.originalPrice
    try {
      return originalPrice.toLocaleString('tr-TR', { style: 'currency', currency: safeCurrency })
    } catch {
      return `${p?.currencySymbol || '₺'}${originalPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}`
    }
  }, [p, safeCurrency])

  const seoSchemas = useMemo(() => {
    if (!p) return null

    const breadcrumbSchema = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        {
          '@type': 'ListItem',
          'position': 1,
          'name': 'Ana Sayfa',
          'item': window.location.origin + '/'
        },
        p.mainCategory ? {
          '@type': 'ListItem',
          'position': 2,
          'name': p.mainCategory,
          'item': window.location.origin + '/kategori/' + encodeURIComponent(p.mainCategory)
        } : null,
        {
          '@type': 'ListItem',
          'position': p.mainCategory ? 3 : 2,
          'name': p.name,
          'item': window.location.href
        }
      ].filter(Boolean)
    }

    const brandName = (p as any).brand || 'Stilsoft'

    // Formatted reviews list for schema
    const schemaReviews = reviews.map((r) => ({
      '@type': 'Review',
      'author': {
        '@type': 'Person',
        'name': r.customerName || 'Ziyaretçi'
      },
      'datePublished': r.createdAtUtc ? r.createdAtUtc.substring(0, 10) : new Date().toISOString().substring(0, 10),
      'reviewBody': r.comment || '',
      'reviewRating': {
        '@type': 'Rating',
        'ratingValue': r.rating,
        'bestRating': 5,
        'worstRating': 1
      }
    }))

    const productSchemaObj: any = {
      '@context': 'https://schema.org/',
      '@type': 'Product',
      'name': p.name,
      'image': displayImage ? [displayImage] : [],
      'description': p.description || `${p.name} ürünü özellikleri ve en uygun fiyat seçenekleri.`,
      'sku': p.stockCode || p.id,
      'brand': {
        '@type': 'Brand',
        'name': brandName
      },
      'offers': {
        '@type': 'Offer',
        'url': window.location.href,
        'priceCurrency': safeCurrency,
        'price': displayPrice,
        'priceValidUntil': new Date(new Date().getFullYear() + 1, 0, 1).toISOString().substring(0, 10),
        'availability': displayStock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        'itemCondition': 'https://schema.org/NewCondition'
      }
    }

    if (p.reviewsCount && p.reviewsCount > 0) {
      productSchemaObj.aggregateRating = {
        '@type': 'AggregateRating',
        'ratingValue': p.ratingAverage ?? 5,
        'reviewCount': p.reviewsCount
      }
    }

    if (schemaReviews.length > 0) {
      productSchemaObj.review = schemaReviews
    }

    return [breadcrumbSchema, productSchemaObj]
  }, [p, displayPrice, displayImage, displayStock, safeCurrency, reviews])

  useSEO({
    title: p?.name,
    description: p?.description || (p ? `${p.name} en uygun fiyatlarla, taksit seçenekleriyle ve hızlı teslimat fırsatıyla Stilsoft KKTC'de!` : undefined),
    image: displayImage || undefined,
    type: 'product',
    schema: seoSchemas,
  })

  useEffect(() => {
    let cancelled = false
    if (!id) return
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const qs = tenantCode ? `?tenantCode=${encodeURIComponent(tenantCode)}` : ''
        const headers: Record<string, string> = {}
        const adminToken = localStorage.getItem('ecom_admin_token')
        if (adminToken) {
          headers['Authorization'] = `Bearer ${adminToken}`
        }
        const res = await fetch(`/api/storefront/products/${id}${qs}`, { headers })
        const json = await readApiResponse(res)
        if (!res.ok) throw new Error(json?.message || 'Ürün alınamadı')
        const dto = extractProduct(json)
        if (!dto) throw new Error('Ürün bulunamadı')
        if (!cancelled) {
          setP(dto)
          setFav(isFavoritedCached(dto.tenantCode, dto.id))
          trackLiveEvent('visit', `"${dto.name || 'Ürün'}" sayfasına girdi`)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ürün alınamadı')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [id, tenantCode])

  // Fetch reviews for this product
  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/storefront/products/${id}/reviews`)
        const json = await readApiResponse(res)
        if (res.ok && Array.isArray(json?.data) && !cancelled) {
          setReviews(json.data.map((r: any) => ({
            id: r.id ?? r.Id ?? '',
            customerName: r.customerName ?? r.customername ?? '',
            rating: typeof r.rating === 'number' ? r.rating : 0,
            comment: r.comment ?? '',
            createdAtUtc: r.createdAtUtc ?? r.createdatutc ?? '',
            customerEmail: r.customerEmail ?? r.customeremail ?? '',
            adminReply: r.adminReply ?? r.adminreply ?? '',
          })))
        }
      } catch {
        // Reviews are not critical, silently fail
      }
    })()
    return () => { cancelled = true }
  }, [id])

  // Get current member user info for editing/deleting own reviews
  useEffect(() => {
    const token = getMemberToken()
    if (!token) {
      setCurrentUserEmail(null)
      return
    }

    const raw = localStorage.getItem('ecom_member_user')
    if (raw) {
      try {
        const u = JSON.parse(raw)
        if (u?.email) {
          setCurrentUserEmail(u.email)
          return
        }
      } catch {
        // ignore
      }
    }

    ;(async () => {
      try {
        const res = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        })
        const json = await readApiResponse(res)
        if (res.ok && json?.success && json?.data?.email) {
          setCurrentUserEmail(json.data.email)
        }
      } catch {
        // ignore
      }
    })()
  }, [])

  const handleUpdateReview = async (reviewId: string) => {
    if (!p || editingComment.trim().length === 0) return
    setEditingSubmitting(true)
    try {
      const res = await fetch(`/api/storefront/products/${p.id}/reviews/${reviewId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getMemberToken()}`,
        },
        body: JSON.stringify({ rating: editingRating, comment: editingComment.trim() }),
      })
      const json = await readApiResponse(res)
      if (res.ok) {
        showToast(json?.message || 'Yorumunuz güncellendi.', 'success')
        setEditingReviewId(null)
        // Refresh reviews list
        const reviewsRes = await fetch(`/api/storefront/products/${p.id}/reviews`)
        const reviewsJson = await readApiResponse(reviewsRes)
        if (reviewsRes.ok && Array.isArray(reviewsJson?.data)) {
          setReviews(reviewsJson.data.map((r: any) => ({
            id: r.id ?? r.Id ?? '',
            customerName: r.customerName ?? r.customername ?? '',
            rating: typeof r.rating === 'number' ? r.rating : 0,
            comment: r.comment ?? '',
            createdAtUtc: r.createdAtUtc ?? r.createdatutc ?? '',
            customerEmail: r.customerEmail ?? r.customeremail ?? '',
            adminReply: r.adminReply ?? r.adminreply ?? '',
          })))
        }
      } else {
        showToast(json?.message || 'Yorum güncellenemedi.', 'error')
      }
    } catch {
      showToast('Yorum güncellenemedi.', 'error')
    } finally {
      setEditingSubmitting(false)
    }
  }

  const [reviewToDelete, setReviewToDelete] = useState<string | null>(null)

  const handleDeleteReview = (reviewId: string) => {
    setReviewToDelete(reviewId)
  }

  const confirmDeleteReview = async () => {
    if (!p || !reviewToDelete) return
    const reviewId = reviewToDelete
    setReviewToDelete(null)
    try {
      const res = await fetch(`/api/storefront/products/${p.id}/reviews/${reviewId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${getMemberToken()}`,
        },
      })
      const json = await readApiResponse(res)
      if (res.ok) {
        showToast(json?.message || 'Yorumunuz silindi.', 'success')
        // Refresh reviews list
        const reviewsRes = await fetch(`/api/storefront/products/${p.id}/reviews`)
        const reviewsJson = await readApiResponse(reviewsRes)
        if (reviewsRes.ok && Array.isArray(reviewsJson?.data)) {
          setReviews(reviewsJson.data.map((r: any) => ({
            id: r.id ?? r.Id ?? '',
            customerName: r.customerName ?? r.customername ?? '',
            rating: typeof r.rating === 'number' ? r.rating : 0,
            comment: r.comment ?? '',
            createdAtUtc: r.createdAtUtc ?? r.createdatutc ?? '',
            customerEmail: r.customerEmail ?? r.customeremail ?? '',
            adminReply: r.adminReply ?? r.adminreply ?? '',
          })))
        }
      } else {
        showToast(json?.message || 'Yorum silinemedi.', 'error')
      }
    } catch {
      showToast('Yorum silinemedi.', 'error')
    }
  }

  const handleAddToCart = () => {
    if (!p) return
    addToCart(p, qty)
    trackLiveEvent('cart', `Sepete ekledi: ${p.name || 'Ürün'} (${qty} Adet)`)
  }

  return (
    <div className="max-w-7xl mx-auto px-6 pb-20">
      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 text-sm text-primary flex items-center gap-3">
          <span className="material-symbols-outlined">error</span>
          {error}
        </div>
      )}

      {!loading && !error && p && (
        <>
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-xs sm:text-sm text-zinc-400 mb-6 flex-wrap">
            <Link to="/" className="hover:text-primary transition-colors font-medium">Ana Sayfa</Link>
            {breadcrumbPath.map((node, idx) => (
              <span key={idx} className="flex items-center gap-2">
                <span className="material-symbols-outlined text-xs text-zinc-300">chevron_right</span>
                <Link to={`/kategori/${node.slug}`} className="hover:text-primary transition-colors font-medium">
                  {node.name}
                </Link>
              </span>
            ))}
            <span className="material-symbols-outlined text-xs text-zinc-300">chevron_right</span>
            <span className="text-zinc-800 font-bold truncate max-w-[150px] sm:max-w-[250px]" title={p.name}>
              {p.name ?? 'Ürün'}
            </span>
          </nav>

          <div className="grid gap-12 lg:grid-cols-2">
            {/* Image Gallery */}
            <div className="space-y-4">
              <div className="aspect-square overflow-hidden rounded-2xl bg-zinc-50 border border-zinc-100 relative group">
                {displayImage ? (
                  <img src={displayImage} alt={p.name ?? ''} className="h-full w-full object-contain p-8 group-hover:scale-105 transition-transform duration-500" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <span className="material-symbols-outlined text-7xl text-zinc-200">image</span>
                  </div>
                )}
                {/* Discount badge */}
                <div className="absolute top-4 left-4 bg-primary text-white text-[10px] font-bold px-3 py-1.5 rounded-lg uppercase tracking-wide">Yeni</div>

                {/* Navigation Arrows */}
                {images.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedThumb((prev) => (prev - 1 + images.length) % images.length)
                      }}
                      className="absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center backdrop-blur-sm transition-all duration-200 shadow-sm opacity-0 group-hover:opacity-100 focus:opacity-100 z-10"
                      aria-label="Önceki Görsel"
                    >
                      <span className="material-symbols-outlined text-[18px] font-bold">chevron_left</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedThumb((prev) => (prev + 1) % images.length)
                      }}
                      className="absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/30 hover:bg-black/50 text-white flex items-center justify-center backdrop-blur-sm transition-all duration-200 shadow-sm opacity-0 group-hover:opacity-100 focus:opacity-100 z-10"
                      aria-label="Sonraki Görsel"
                    >
                      <span className="material-symbols-outlined text-[18px] font-bold">chevron_right</span>
                    </button>
                  </>
                )}
              </div>
              {/* Thumbnails */}
              {images.length > 1 && (
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {images.map((imgUrl, i) => (
                    <button
                      key={imgUrl + '-' + i}
                      onClick={() => setSelectedThumb(i)}
                      className={`w-20 h-20 rounded-xl overflow-hidden border-2 flex-shrink-0 transition-all ${
                        selectedThumb === i ? 'border-primary ring-2 ring-primary/20' : 'border-zinc-100 hover:border-zinc-300'
                      }`}
                    >
                      <img src={imgUrl} alt="" className="w-full h-full object-contain p-2 bg-zinc-50" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Product Info */}
            <div className="space-y-6">
              <div>
                <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">{p?.stockCode ?? id}</span>
                <h1 className="text-3xl font-bold text-on-surface mt-2 leading-tight">{p?.name ?? 'Ürün'}</h1>
              </div>

              {/* Rating */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <span key={s} className="material-symbols-outlined text-lg text-amber-400" style={{ fontVariationSettings: s <= Math.round(p.ratingAverage ?? 0) ? "'FILL' 1" : undefined }}>star</span>
                  ))}
                </div>
                <span className="text-sm text-zinc-500">{(p.ratingAverage ?? 0).toFixed(1)} ({p.reviewsCount ?? 0} değerlendirme)</span>
                <span className="w-px h-4 bg-zinc-200" />
                {displayStock > 0 ? (
                  <span className="text-sm text-green-600 font-semibold flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">check_circle</span> Stokta ({displayStock} Adet)
                  </span>
                ) : (
                  <span className="text-sm text-rose-600 font-semibold flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">cancel</span> Tükendi
                  </span>
                )}
              </div>

              {/* Price */}
              <div className="flex items-end gap-4 py-4 border-y border-zinc-100">
                <span className="text-4xl font-extrabold text-primary">{formattedPrice}</span>
                {p?.discountedPrice && p?.originalPrice && p.discountedPrice < p.originalPrice && (
                  <>
                    <span className="text-lg text-zinc-400 line-through mb-1">{formattedDiscountPrice}</span>
                    {p.campaignBadge && (
                      <span className="bg-[#df0000]/10 text-[#df0000] text-xs font-bold px-2 py-1 rounded mb-1">{p.campaignBadge}</span>
                    )}
                  </>
                )}
              </div>



              {/* Variants Selectors */}
              {Object.keys(groupedVariants).length > 0 && (
                <div className="space-y-4 border-b border-zinc-100 pb-6">
                  {Object.entries(groupedVariants).map(([groupName, items]) => (
                    <div key={groupName} className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{groupName}</label>
                      <div className="flex flex-wrap gap-2">
                        {items.map((item, idx) => {
                          const isCurrent = location.pathname + location.search === item.link || 
                                            location.pathname.includes(item.link) || 
                                            item.link.includes(p.id)

                          return (
                            <Link
                              key={idx}
                              to={item.link}
                              className={`px-4 py-2 text-xs font-bold rounded-xl border transition-all ${
                                isCurrent
                                  ? 'border-primary bg-primary/5 text-primary ring-2 ring-primary/20 shadow-xs'
                                  : 'border-zinc-200 text-zinc-700 hover:border-zinc-300 bg-white shadow-xs'
                              }`}
                            >
                              {item.value}
                            </Link>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Description */}
              {(p?.description || (p?.features && p.features.length > 0)) && (
                <div className="bg-zinc-50 rounded-xl p-6 space-y-4 border border-zinc-100">
                  {p?.description && (
                    <div>
                      <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-[0.1em] mb-2">Açıklama</h3>
                      <p className="text-sm text-zinc-600 leading-relaxed whitespace-pre-wrap">{p.description}</p>
                    </div>
                  )}
                  {p?.features && p.features.length > 0 && (
                    <div>
                      <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-[0.1em] mb-2">Özellikler</h3>
                      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {p.features.slice(0, 12).map((x, idx) => (
                          <li key={`${idx}-${x}`} className="flex items-start gap-2 text-sm text-zinc-600">
                            <span className="material-symbols-outlined text-primary text-sm mt-0.5">check</span>
                            {x}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Technical Specifications */}
              {p?.technicalSpecs && Object.keys(p.technicalSpecs).length > 0 && (
                <div className="bg-white rounded-2xl p-6 space-y-4 border border-zinc-200/80 shadow-xs">
                  <div>
                    <button
                      type="button"
                      onClick={() => setSpecExpanded(!specExpanded)}
                      className="w-full flex items-center justify-between focus:outline-none md:pointer-events-none"
                    >
                      <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-zinc-400">tune</span>
                        Teknik Özellikler
                      </h3>
                      <span className={`material-symbols-outlined text-zinc-400 transition-transform md:hidden ${specExpanded ? 'rotate-180' : ''}`}>
                        expand_more
                      </span>
                    </button>
                    <div className={`mt-4 md:block ${specExpanded ? 'block' : 'hidden'}`}>
                      <div className="border border-zinc-150 rounded-xl overflow-hidden divide-y divide-zinc-150">
                        {Object.entries(p.technicalSpecs).map(([key, val]) => (
                          <div key={key} className="grid grid-cols-2 p-3 text-xs hover:bg-zinc-50/50 transition-colors">
                            <span className="font-bold text-zinc-500">{key}</span>
                            <span className="text-zinc-800 font-extrabold">{val}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Files & Documents */}
              {(p?.manualPdfUrl || p?.catalogPdfUrl) && (
                <div className="bg-white rounded-2xl p-6 space-y-4 border border-zinc-200/80 shadow-xs">
                  <div>
                    <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-zinc-400">description</span>
                      Dosyalar ve Dokümanlar
                    </h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {p.manualPdfUrl && (
                        <a
                          href={p.manualPdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-3 p-3 bg-zinc-50 border border-zinc-150 rounded-xl hover:bg-zinc-100 hover:border-zinc-200 transition-all text-xs font-bold text-zinc-700"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="material-symbols-outlined text-red-600 text-[20px]">picture_as_pdf</span>
                            <span className="truncate">Kullanım Kılavuzu (PDF)</span>
                          </div>
                          <span className="material-symbols-outlined text-zinc-450 text-[18px]">download</span>
                        </a>
                      )}
                      {p.catalogPdfUrl && (
                        <a
                          href={p.catalogPdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-3 p-3 bg-zinc-50 border border-zinc-150 rounded-xl hover:bg-zinc-100 hover:border-zinc-200 transition-all text-xs font-bold text-zinc-700"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="material-symbols-outlined text-red-600 text-[20px]">picture_as_pdf</span>
                            <span className="truncate">Ürün Kataloğu (PDF)</span>
                          </div>
                          <span className="material-symbols-outlined text-zinc-450 text-[18px]">download</span>
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Quantity + Actions */}
              <div className="flex flex-wrap items-center gap-4">
                <div className="inline-flex items-center rounded-xl border border-zinc-200 bg-white overflow-hidden">
                  <button className="px-4 py-3 text-sm font-bold hover:bg-zinc-50 transition-colors active:scale-90" type="button" onClick={() => setQty(Math.max(1, qty - 1))}>
                    <span className="material-symbols-outlined text-lg">remove</span>
                  </button>
                  <div className="px-5 py-3 text-sm font-bold border-x border-zinc-200 min-w-[48px] text-center">{qty}</div>
                  <button className="px-4 py-3 text-sm font-bold hover:bg-zinc-50 transition-colors active:scale-90" type="button" onClick={() => setQty(qty + 1)}>
                    <span className="material-symbols-outlined text-lg">add</span>
                  </button>
                </div>
                <button
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3.5 text-sm font-bold text-white hover:bg-primary-container active:scale-[0.97] transition-all shadow-lg shadow-primary/20 disabled:opacity-50 disabled:pointer-events-none"
                  type="button"
                  disabled={displayStock <= 0}
                  onClick={handleAddToCart}
                >
                  <span className="material-symbols-outlined">add_shopping_cart</span>
                  Sepete Ekle
                </button>
                <button
                  type="button"
                  className={`w-12 h-12 rounded-xl border grid place-items-center transition-all active:scale-90 ${
                    fav
                      ? 'border-rose-300 bg-rose-50 text-rose-500 hover:bg-rose-100'
                      : 'border-zinc-200 text-zinc-400 hover:border-rose-300 hover:text-rose-400'
                  }`}
                  onClick={async () => {
                    if (!p) return
                    try {
                      const isFav = await toggleFavorite(p.tenantCode, p.id)
                      setFav(isFav)
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Favori güncellenemedi')
                    }
                  }}
                  aria-label="Favori"
                  title={fav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                >
                  <span
                    className="material-symbols-outlined"
                    style={fav ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  >
                    favorite
                  </span>
                </button>

                <button
                  type="button"
                  className={`w-12 h-12 rounded-xl border grid place-items-center transition-all active:scale-90 ${
                    isCompared
                      ? 'border-primary bg-primary/5 text-primary hover:bg-primary/10'
                      : 'border-zinc-200 text-zinc-400 hover:border-primary/20 hover:text-primary'
                  }`}
                  onClick={() => {
                    if (!p) return
                    if (isCompared) {
                      removeFromComparison(p.tenantCode ?? '', p.id)
                      showToast('Ürün karşılaştırma listesinden kaldırıldı.', 'success')
                    } else {
                      const res = addToComparison(p.tenantCode ?? '', p.id)
                      if (res.success) {
                        showToast(res.message, 'success')
                      } else {
                        showToast(res.message, 'warning')
                      }
                    }
                  }}
                  aria-label="Karşılaştır"
                  title={isCompared ? 'Karşılaştırmadan çıkar' : 'Karşılaştır'}
                >
                  <span className="material-symbols-outlined">compare_arrows</span>
                </button>
              </div>

              <button
                type="button"
                disabled={displayStock <= 0}
                onClick={() => {
                  handleAddToCart()
                  nav('/checkout')
                }}
                className="w-full rounded-xl border-2 border-on-surface bg-on-surface text-white px-4 py-3.5 text-sm font-bold hover:bg-zinc-800 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
              >
                <span className="material-symbols-outlined">flash_on</span>
                Hemen Satın Al
              </button>

              {/* Trust badges */}
              <div className="grid grid-cols-3 gap-3 pt-4">
                {[
                  { icon: 'local_shipping', label: p && (p.isFreeShipping || cargoFee === 0 || (p.unitPrice ?? 0) >= threshold) ? 'Ücretsiz Kargo' : `Kargo: ${cargoFee} ${currency}` },
                  { icon: 'verified_user', label: p.warrantyMonths && p.warrantyMonths > 0 ? (p.warrantyMonths % 12 === 0 ? `${p.warrantyMonths / 12} Yıl Garanti` : `${p.warrantyMonths} Ay Garanti`) : '2 Yıl Garanti' },
                  { icon: 'published_with_changes', label: '14 Gün İade' },
                ].map((b, i) => (
                  <div key={i} className="flex flex-col items-center text-center p-3 bg-zinc-50 rounded-xl border border-zinc-100">
                    <span className="material-symbols-outlined text-primary text-xl mb-1">{b.icon}</span>
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">{b.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Related Products Section */}
          {p.relatedProducts && p.relatedProducts.length > 0 && (
            <div className="mt-16 pt-10 border-t border-zinc-200/80 space-y-6">
              <div>
                <span className="text-[10px] font-bold text-primary uppercase tracking-[0.2em] mb-1">Keşfet</span>
                <h2 className="text-xl font-bold text-on-surface">İlgili Ürünler</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {p.relatedProducts.map((rel: any) => (
                  <ProductCard key={rel.id} product={rel} />
                ))}
              </div>
            </div>
          )}

          {/* Reviews Section */}
          <div className="mt-16 space-y-8">
            <button
              type="button"
              onClick={() => setReviewsExpanded(!reviewsExpanded)}
              className="w-full flex items-center justify-between focus:outline-none md:pointer-events-none"
            >
              <h2 className="text-xl font-bold text-on-surface text-left">Müşteri Yorumları ({reviews.length})</h2>
              <span className={`material-symbols-outlined text-zinc-400 transition-transform md:hidden ${reviewsExpanded ? 'rotate-180' : ''}`}>
                expand_more
              </span>
            </button>

            <div className={`space-y-8 md:block ${reviewsExpanded ? 'block' : 'hidden'}`}>

            {/* Star Rating Distribution Summary */}
            {reviews.length > 0 && (
              <div className="bg-zinc-50 border border-zinc-150 rounded-2xl p-5 md:p-6 grid gap-6 md:grid-cols-3 items-center">
                {/* Average Score Column */}
                <div className="text-center md:border-r border-zinc-200 md:pr-6 flex flex-col items-center justify-center">
                  <div className="text-4xl font-black text-zinc-900">
                    {(reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)}
                  </div>
                  <div className="flex items-center gap-0.5 mt-2 text-amber-500 justify-center">
                    {Array.from({ length: 5 }).map((_, i) => {
                      const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
                      return (
                        <span key={i} className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: i < Math.round(avg) ? "'FILL' 1" : undefined }}>
                          star
                        </span>
                      );
                    })}
                  </div>
                  <span className="text-[10px] font-bold text-zinc-400 mt-1.5 uppercase tracking-wide">
                    {reviews.length} Değerlendirme
                  </span>
                </div>

                {/* Stars Breakdown Column */}
                <div className="md:col-span-2 space-y-2.5">
                  {([5, 4, 3, 2, 1] as const).map((star) => {
                    const count = starCounts[star] || 0
                    const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0
                    const isSelected = selectedRatingFilter === star

                    return (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setSelectedRatingFilter(isSelected ? null : star)}
                        className={cx(
                          "w-full flex items-center gap-3 text-left p-1.5 rounded-xl border transition-all active:scale-[0.99] group/star",
                          isSelected 
                            ? "border-primary bg-primary/5 text-primary animate-pulse" 
                            : "border-transparent text-zinc-650 hover:bg-zinc-100/70"
                        )}
                      >
                        {/* Star visual */}
                        <div className="flex items-center gap-1 shrink-0 w-24">
                          <span className="text-xs font-bold w-3">{star}</span>
                          <div className="flex items-center text-amber-400">
                            {Array.from({ length: 5 }).map((_, idx) => (
                              <span key={idx} className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: idx < star ? "'FILL' 1" : undefined }}>
                                star
                              </span>
                            ))}
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="flex-1 h-2 rounded-full bg-zinc-200 overflow-hidden">
                          <div 
                            className={cx("h-full rounded-full transition-all duration-500", isSelected ? "bg-primary" : "bg-amber-400")}
                            style={{ width: `${pct}%` }}
                          />
                        </div>

                        {/* Count */}
                        <span className={cx("text-xs font-bold w-8 text-right", isSelected ? "text-primary" : "text-zinc-400")}>
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Filter description / clear actions */}
            {selectedRatingFilter !== null && (
              <div className="flex items-center justify-between bg-zinc-50 border border-zinc-150 px-4 py-2.5 rounded-xl text-xs font-semibold text-zinc-600">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-zinc-400 text-sm">filter_alt</span>
                  Sadece <span>{selectedRatingFilter} yıldızlı</span> değerlendirmeler gösteriliyor ({filteredReviews.length} yorum)
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedRatingFilter(null)}
                  className="text-primary hover:underline font-bold text-xs"
                >
                  Filtreyi Temizle
                </button>
              </div>
            )}

            {/* Review Form or Login Prompt */}
            {getMemberToken() ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 space-y-4">
                <h3 className="text-sm font-bold text-zinc-700">Yorum Yaz</h3>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setReviewRating(s)}
                      className="focus:outline-none transition-transform hover:scale-110"
                    >
                      <span
                        className="material-symbols-outlined text-2xl text-amber-400 cursor-pointer"
                        style={{ fontVariationSettings: s <= reviewRating ? "'FILL' 1" : undefined }}
                      >star</span>
                    </button>
                  ))}
                  <span className="ml-2 text-sm font-bold text-zinc-500">{reviewRating}/5</span>
                </div>
                <textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Ürün hakkındaki düşüncelerinizi yazın..."
                  className="w-full rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700 placeholder:text-zinc-400 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none resize-none min-h-[100px] transition-all"
                />
                <button
                  type="button"
                  disabled={reviewSubmitting || reviewComment.trim().length === 0}
                  onClick={async () => {
                    if (!p || reviewComment.trim().length === 0) return
                    setReviewSubmitting(true)
                    try {
                      const res = await fetch(`/api/storefront/products/${p.id}/reviews`, {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          Authorization: `Bearer ${getMemberToken()}`,
                        },
                        body: JSON.stringify({ rating: reviewRating, comment: reviewComment.trim() }),
                      })
                      const json = await readApiResponse(res)
                      if (res.ok) {
                        showToast(json?.message || 'Yorumunuz gönderildi.', 'success')
                        setReviewComment('')
                        setReviewRating(5)
                      } else {
                        showToast(json?.message || 'Yorum gönderilemedi.', 'error')
                      }
                    } catch {
                      showToast('Yorum gönderilemedi.', 'error')
                    } finally {
                      setReviewSubmitting(false)
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-primary-container active:scale-[0.97] transition-all shadow-sm disabled:opacity-50 disabled:pointer-events-none"
                >
                  <span className="material-symbols-outlined text-base">send</span>
                  {reviewSubmitting ? 'Gönderiliyor...' : 'Yorum Gönder'}
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-xl text-zinc-400">lock</span>
                  <span className="text-sm text-zinc-600 font-medium">Yorum yapmak için giriş yapmalısınız.</span>
                </div>
                <Link
                  to="/giris"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary-container transition-all"
                >
                  <span className="material-symbols-outlined text-sm">login</span>
                  Giriş Yap
                </Link>
              </div>
            )}

            {/* Reviews List */}
            {filteredReviews.length > 0 ? (
              <div className="space-y-4">
                {filteredReviews.map((r) => (
                  <div key={r.id} className="rounded-2xl border border-zinc-100 bg-white p-5 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 text-primary grid place-items-center text-xs font-bold">
                          {(r.customerName || 'M')[0].toUpperCase()}
                        </div>
                        <div>
                          <span className="text-sm font-bold text-zinc-800">{r.customerName}</span>
                          <div className="flex items-center gap-0.5 mt-0.5">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <span key={s} className="material-symbols-outlined text-[14px] text-amber-400" style={{ fontVariationSettings: s <= r.rating ? "'FILL' 1" : undefined }}>star</span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {currentUserEmail && r.customerEmail?.toLowerCase() === currentUserEmail.toLowerCase() && (
                          <div className="flex items-center gap-1.5 mr-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingReviewId(r.id)
                                setEditingComment(r.comment)
                                setEditingRating(r.rating)
                              }}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-zinc-500 hover:text-primary transition-colors"
                            >
                              <span className="material-symbols-outlined text-sm">edit</span>
                              Düzenle
                            </button>
                            <span className="text-zinc-300 text-xs">|</span>
                            <button
                              type="button"
                              onClick={() => handleDeleteReview(r.id)}
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-zinc-500 hover:text-rose-500 transition-colors"
                            >
                              <span className="material-symbols-outlined text-sm">delete</span>
                              Sil
                            </button>
                          </div>
                        )}
                        <span className="text-[10px] text-zinc-400 font-semibold">
                          {new Date(r.createdAtUtc).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </span>
                      </div>
                    </div>
                    {editingReviewId === r.id ? (
                      <div className="pl-11 pt-2 space-y-3">
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setEditingRating(s)}
                              className="focus:outline-none transition-transform hover:scale-110"
                            >
                              <span
                                className="material-symbols-outlined text-xl text-amber-400 cursor-pointer"
                                style={{ fontVariationSettings: s <= editingRating ? "'FILL' 1" : undefined }}
                              >star</span>
                            </button>
                          ))}
                          <span className="ml-2 text-xs font-bold text-zinc-500">{editingRating}/5</span>
                        </div>
                        <textarea
                          value={editingComment}
                          onChange={(e) => setEditingComment(e.target.value)}
                          className="w-full rounded-xl border border-zinc-200 bg-white p-3 text-sm text-zinc-700 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none resize-none min-h-[80px] transition-all"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={editingSubmitting || editingComment.trim().length === 0}
                            onClick={() => handleUpdateReview(r.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-white hover:bg-primary-container active:scale-[0.97] transition-all shadow-xs disabled:opacity-50"
                          >
                            {editingSubmitting ? 'Kaydediliyor...' : 'Kaydet'}
                          </button>
                          <button
                            type="button"
                            disabled={editingSubmitting}
                            onClick={() => setEditingReviewId(null)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-50 active:scale-[0.97] transition-all"
                          >
                            İptal
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-zinc-600 leading-relaxed pl-11">{r.comment}</p>
                        {r.adminReply && (
                          <div className="ml-11 mt-2.5 bg-zinc-50 border border-zinc-150 rounded-xl p-3.5 space-y-1">
                            <div className="flex justify-between items-center text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">
                              <span>Satıcı Yanıtı</span>
                            </div>
                            <p className="text-xs font-semibold text-zinc-750">{r.adminReply}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : reviews.length > 0 ? (
              <div className="text-center py-12 text-zinc-450 italic bg-white rounded-2xl border border-zinc-100 p-8 shadow-sm">
                Seçilen filtreye uygun yorum bulunmamaktadır.
              </div>
            ) : (
              <div className="text-center py-8 text-zinc-400 text-sm italic">
                Henüz yorum yapılmamış. İlk yorumu siz yapın!
              </div>
            )}
            </div>
          </div>

        </>
      )}
      {reviewToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 text-red-650">
              <span className="material-symbols-outlined text-3xl">warning</span>
              <h3 className="text-lg font-bold text-zinc-900">Yorumu Sil</h3>
            </div>
            <p className="mt-3 text-sm text-zinc-600 leading-relaxed">
              Bu yorumu silmek istediğinize emin misiniz? Bu işlem geri alınamaz.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setReviewToDelete(null)}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-5 text-sm font-bold text-zinc-650 transition-all hover:bg-zinc-50 active:scale-[0.98]"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={confirmDeleteReview}
                className="h-10 rounded-xl bg-red-650 px-5 text-sm font-bold text-white transition-all hover:bg-red-700 active:scale-[0.98]"
              >
                Evet, Sil
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Sticky Bottom Cart Bar for Mobile */}
      {p && (
        <div
          className={`fixed bottom-16 inset-x-0 z-40 bg-white border-t border-zinc-200/80 p-3 shadow-[0_-8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 transform lg:hidden ${
            showStickyBar ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center justify-between gap-3 max-w-lg mx-auto">
            <div className="flex items-center gap-2 min-w-0">
              <img
                src={displayImage || '/placeholder.png'}
                alt={p.name}
                className="w-10 h-10 object-contain bg-zinc-50 rounded-lg border border-zinc-100 shrink-0"
              />
              <div className="min-w-0">
                <p className="text-xs font-bold text-zinc-800 truncate">{p.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-sm font-extrabold text-primary">{formattedPrice}</span>
                  {p?.discountedPrice && p?.originalPrice && p.discountedPrice < p.originalPrice && formattedDiscountPrice && (
                    <span className="text-[10px] text-zinc-400 line-through">{formattedDiscountPrice}</span>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={displayStock <= 0}
              onClick={handleAddToCart}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white hover:bg-primary-container active:scale-[0.97] transition-all shrink-0"
            >
              <span className="material-symbols-outlined text-sm">add_shopping_cart</span>
              Sepete Ekle
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

