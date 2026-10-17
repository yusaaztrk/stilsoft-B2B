import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ProductCard } from '../components/ProductCard'
import { extractProductsList } from '../lib/api'
import { useSEO } from '../hooks/useSEO'
import { addToCart } from '../lib/cart'

type CampaignDto = {
  id: string
  name: string
  description?: string
  imageUrl?: string
  type: string
  scope?: string
  startDate?: string
  endDate?: string
}

export function CampaignProductsPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [campaign, setCampaign] = useState<CampaignDto | null>(null)
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useSEO({
    title: campaign ? `${campaign.name} | Kampanya` : 'Kampanyalı Ürünler',
    description: campaign?.description || 'Kampanya kapsamındaki avantajlı fiyatlı ürünler.'
  })

  useEffect(() => {
    if (!id) return

    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/storefront/campaigns/${id}`)
        if (!res.ok) {
          if (res.status === 404) {
            throw new Error('Kampanya bulunamadı veya süresi dolmuş.')
          }
          throw new Error('Kampanya detayları yüklenirken hata oluştu.')
        }
        const json = await res.json()
        if (json?.success && json?.data) {
          if (!cancelled) {
            setCampaign(json.data.campaign)
            setProducts(extractProductsList(json.data.products))
          }
        } else {
          throw new Error('Geçersiz veri formatı.')
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Bir hata oluştu.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [id])

  const getCampaignBadgeText = (type: string) => {
    switch (type) {
      case 'Percentage':
        return 'Yüzdesel İndirim'
      case 'FixedAmount':
        return 'Sabit İndirim'
      case 'GiftProduct':
        return 'Hediye Ürün'
      case 'FreeShipping':
        return 'Ücretsiz Kargo'
      case 'Brand':
        return 'Marka Kampanyası'
      default:
        return 'Kampanya'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !campaign) {
    return (
      <div className="max-w-md mx-auto px-6 py-20 text-center">
        <span className="material-symbols-outlined text-[64px] text-rose-500 mb-4">error</span>
        <h2 className="text-2xl font-black text-zinc-900 mb-2">Kampanya Yüklenemedi</h2>
        <p className="text-zinc-500 text-sm mb-8">{error || 'Kampanya bulunamadı.'}</p>
        <button
          onClick={() => navigate('/kampanyalar')}
          className="bg-zinc-900 text-white hover:bg-primary px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-wide transition-all shadow-md active:scale-95"
        >
          Kampanyalara Geri Dön
        </button>
      </div>
    )
  }

  return (
    <div className="pb-20 bg-zinc-50 min-h-screen">
      {/* Campaign Details Header */}
      <section className="py-10 max-w-7xl mx-auto px-6">
        <div className="bg-zinc-950 rounded-3xl overflow-hidden text-white shadow-xl">
          <div className="grid md:grid-cols-2 items-center">
            <div className="p-8 md:p-12 lg:p-16 space-y-6">
              <Link
                to="/kampanyalar"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-zinc-400 hover:text-white uppercase tracking-wider transition-colors"
              >
                <span className="material-symbols-outlined text-sm">arrow_back</span>
                Tüm Kampanyalar
              </Link>
              <div>
                <span className="inline-flex items-center rounded-lg bg-primary/20 text-primary border border-primary/20 px-3 py-1 text-[10px] font-black uppercase tracking-wider">
                  {getCampaignBadgeText(campaign.type)}
                </span>
                <h1 className="text-3xl md:text-4xl lg:text-5xl font-black mt-3 leading-tight tracking-tight">
                  {campaign.name}
                </h1>
                {campaign.description && (
                  <p className="text-zinc-300 text-sm md:text-base mt-4 leading-relaxed max-w-lg">
                    {campaign.description}
                  </p>
                )}
              </div>
              {campaign.scope === 'Cart' ? (
                <div className="flex items-center gap-2 text-xs text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-4 py-2.5 rounded-2xl w-fit">
                  <span className="material-symbols-outlined text-sm">shopping_cart</span>
                  <span>Bu kampanya <strong>tüm sepet</strong> adımlarında otomatik uygulanır</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-zinc-400 bg-white/5 border border-white/10 px-4 py-2.5 rounded-2xl w-fit">
                  <span className="material-symbols-outlined text-sm">inventory_2</span>
                  <span>Bu kampanyada <strong>{products.length}</strong> geçerli ürün listeleniyor</span>
                </div>
              )}
            </div>
            <div className="relative h-[300px] md:h-full min-h-[300px]">
              {campaign.imageUrl ? (
                <img
                  className="absolute inset-0 w-full h-full object-cover opacity-90"
                  src={campaign.imageUrl}
                  alt={campaign.name}
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 to-zinc-900 flex flex-col items-center justify-center p-8 text-center text-white/30">
                  <span className="material-symbols-outlined text-[96px] mb-2 text-primary">campaign</span>
                  <span className="text-xs font-bold uppercase tracking-wider text-white/20">Stilsoft Kampanyası</span>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-r from-zinc-950 via-zinc-950/20 to-transparent" />
            </div>
          </div>
        </div>
      </section>

      {/* Campaign Products Grid */}
      <section className="max-w-7xl mx-auto px-6">
        {campaign.scope === 'Cart' ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center bg-white rounded-3xl border border-zinc-200/80 shadow-[0_4px_20px_rgba(0,0,0,0.02)] max-w-2xl mx-auto space-y-6">
            <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center border border-indigo-100 shadow-[0_8px_16px_rgba(99,102,241,0.05)]">
              <span className="material-symbols-outlined text-[40px] text-indigo-600">shopping_cart_checkout</span>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-black text-zinc-900">Sepet Bazlı Kampanya</h3>
              <p className="text-zinc-550 text-sm max-w-md leading-relaxed">
                Bu kampanya sepet aşamasında tüm ürünler için geçerlidir. Ürün sayfasında crossed-out (üstü çizili) fiyat gösterilmez, sepet toplam tutarınız kampanya koşulunu (varsa minimum limit) karşıladığında indirim otomatik olarak uygulanır.
              </p>
            </div>
            <Link
              to="/kategoriler"
              className="bg-indigo-600 text-white hover:bg-indigo-700 px-8 py-3 rounded-2xl font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-indigo-600/10 active:scale-[0.98] flex items-center gap-1.5"
            >
              Alışverişe Başla
            </Link>
          </div>
        ) : products.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 md:gap-6 lg:grid-cols-3 xl:grid-cols-4">
            {products.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onAddToCart={(p) => addToCart(p)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center bg-white rounded-3xl border border-zinc-200/80 shadow-sm max-w-2xl mx-auto">
            <span className="material-symbols-outlined text-[64px] text-zinc-300 mb-4">search_off</span>
            <h3 className="text-xl font-bold text-zinc-900 mb-2">Ürün Bulunamadı</h3>
            <p className="text-zinc-555 text-sm max-w-sm mb-6">Bu kampanya kapsamında şu anda aktif veya yayında olan bir ürün bulunmuyor.</p>
            <Link
              to="/kategoriler"
              className="bg-primary text-white px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-primary/95 transition-all shadow-md active:scale-95 flex items-center gap-1.5"
            >
              Diğer Ürünleri Keşfet
            </Link>
          </div>
        )}
      </section>
    </div>
  )
}
