import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSEO } from '../hooks/useSEO'

type CampaignItem = {
  id: string
  name: string
  description?: string
  imageUrl?: string
  type: string
  startDate?: string
  endDate?: string
}

export function CampaignsPublicPage() {
  useSEO({
    title: 'Kampanyalar & Fırsatlar',
    description: 'Aktif kampanyalarımız, özel indirimler ve hediye ürün fırsatları.'
  })

  const [campaigns, setCampaigns] = useState<CampaignItem[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/storefront/campaigns')
        const json = await res.json()
        if (res.ok && json?.success && Array.isArray(json.data)) {
          if (!cancelled) setCampaigns(json.data)
        }
      } catch (err) {
        console.error('Kampanyalar yüklenirken hata oluştu:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
      case 'BuyXGetY':
        return 'X Alana Y Hediye'
      default:
        return 'Özel Fırsat'
    }
  }

  return (
    <div className="pb-20 bg-zinc-50 min-h-screen">
      {/* Header Section */}
      <section className="py-12 max-w-7xl mx-auto px-6">
        <div>
          <span className="text-[10px] font-bold text-primary uppercase tracking-[0.2em]">Fırsatlar & İndirimler</span>
          <h1 className="text-4xl md:text-5xl font-black text-zinc-900 mt-2 tracking-tight">Kampanyalar</h1>
          <p className="text-zinc-500 mt-2 text-base max-w-md">Aktif kampanyalarımızı, hediye ürün fırsatlarını ve indirimleri bu sayfadan takip edebilirsiniz.</p>
        </div>
      </section>

      {/* Campaigns Grid */}
      <section className="px-6">
        <div className="max-w-7xl mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : campaigns.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {campaigns.map((camp) => (
                <div
                  key={camp.id}
                  className="group bg-white rounded-3xl overflow-hidden border border-zinc-200/80 shadow-sm hover:shadow-xl hover:border-primary/20 transition-all duration-300 flex flex-col min-h-[420px]"
                >
                  {/* Image area */}
                  <div className="relative aspect-video w-full overflow-hidden bg-zinc-100">
                    {camp.imageUrl ? (
                      <img
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        src={camp.imageUrl}
                        alt={camp.name}
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-zinc-900 flex flex-col items-center justify-center p-6 text-center text-white/40">
                        <span className="material-symbols-outlined text-[48px] mb-1 text-primary">campaign</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-white/20">Stilsoft Fırsatı</span>
                      </div>
                    )}
                    <div className="absolute top-4 left-4">
                      <span className="inline-flex items-center rounded-lg bg-primary px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white shadow-md">
                        {getCampaignBadgeText(camp.type)}
                      </span>
                    </div>
                  </div>

                  {/* Content area */}
                  <div className="p-6 flex-1 flex flex-col">
                    <h3 className="text-xl font-bold text-zinc-900 mb-2 line-clamp-2 leading-tight">
                      {camp.name}
                    </h3>
                    <p className="text-zinc-500 text-sm mb-6 line-clamp-3 flex-1">
                      {camp.description || 'Bu kampanya kapsamındaki indirimli ürünleri görmek için tıklayınız.'}
                    </p>
                    <div className="mt-auto">
                      <Link
                        to={`/kampanya/${camp.id}`}
                        className="w-full bg-zinc-900 text-white hover:bg-primary py-3 rounded-xl font-bold text-xs uppercase tracking-wide transition-all active:scale-98 flex items-center justify-center gap-1.5 shadow-sm"
                      >
                        Kampanyalı Ürünleri Gör
                        <span className="material-symbols-outlined text-sm">arrow_forward</span>
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 px-4 text-center bg-white rounded-3xl border border-zinc-200/80 shadow-sm max-w-2xl mx-auto">
              <span className="material-symbols-outlined text-[64px] text-zinc-300 mb-4">campaign</span>
              <h3 className="text-xl font-bold text-zinc-900 mb-2">Aktif Kampanya Bulunmuyor</h3>
              <p className="text-zinc-500 text-sm max-w-sm mb-8">Yeni kampanyalardan ve özel indirim fırsatlarından haberdar olmak için bizi takip etmeye devam edin.</p>
              <Link
                to="/kategoriler"
                className="bg-primary text-white px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-primary/95 transition-all shadow-md active:scale-95 flex items-center gap-1.5"
              >
                Alışverişe Başla
                <span className="material-symbols-outlined text-sm">shopping_bag</span>
              </Link>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
