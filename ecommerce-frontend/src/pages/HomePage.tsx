import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchStorefrontCategories, type CategoryDto } from '../lib/categoriesApi'
import { useSEO } from '../hooks/useSEO'
import { ProductCard } from '../components/ProductCard'
import type { ErpProductListItem } from '../lib/api'
import { readApiResponse, extractProductsList } from '../lib/api'
import { trackLiveEvent } from '../lib/liveTracker'

type StoreDesign = {
  brandName: string
  heroTitle: string
  heroSubtitle: string
  heroImageUrl: string
  topBannerUrl?: string
  topBannerLink?: string
  middleBannerUrl?: string
  middleBannerLink?: string
  bottomBannerUrl?: string
  bottomBannerLink?: string
  grid4WideUrl?: string
  grid4WideLink?: string
  grid4Vert1Url?: string
  grid4Vert1Link?: string
  grid4Vert2Url?: string
  grid4Vert2Link?: string
  grid4Vert3Url?: string
  grid4Vert3Link?: string
  cargoFee?: number
  freeShippingThreshold?: number
  currency?: string
  sliders?: Array<{ id: string; title: string; subtitle: string; imageUrl: string; link: string; order: number }>
  campaigns?: Array<{ id: string; title: string; imageUrl: string; link: string; colSpan: string }>
  pdfCatalogsTitle?: string
}

const MOCK_PRODUCTS: ErpProductListItem[] = [
  {
    id: 'mock-1',
    name: 'Stilsoft RoboClean Pro 4K Robot Süpürge',
    stockCode: 'ROBOT-SÜPÜRGE',
    mainCategory: 'Ev Aletleri',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD1ecQmrzY920VbrP2w3HM1PEJ0F9bc4FBz1gwPpY_kOZhaWoWLiQjZeYt3zFtLeLgRwl_HYAAaGEvbL-jt4FY-MywaosVnZXfcGriyFUzVu7JWbXXVWABecknGV-G8IONxYoDGqJxVuIf6TShnaP0fg81Mmubkv8VjVkxbvxTZGIOzcwSQnPQAEmfEZFfmS8U5GdwOj29Sv5yQz7LAmezSw361wrG9MPl2LCsptcfUDNAQYnHHWefUWfxQxV70IwZtNmEdNf-tH0g',
    unitPrice: 12499,
    currency: 'TRY',
    currencySymbol: 'TL',
    reviewsCount: 18,
    ratingAverage: 4.6
  },
  {
    id: 'mock-2',
    name: 'Stilsoft TeaTime Inox Çay Makinesi',
    stockCode: 'MUTFAK-CAY',
    mainCategory: 'Mutfak',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA7Q8Jb_TLa1770NvXKs0jbDPO22itkSOw_TXCHS2XiZQ0darPLMAT6eh81nao4NgXNMvAX_f698ERSUuimWxLXq793BSVEN-O6iNGtQORoTI29Rh71I6fpiDi3WbK29vlCfVn4ORD7tqQ1nimCkraDkSPmbSknY3LoNjljlR5dutnEPq37keNYa8sW4DNSO1ApDmT10QzClurCRY9V1Yme_wtLIsCxj7zneySdb2Pj05vWsrNJZ70d020qeEbwCwcLOy4fXVly93E',
    unitPrice: 2199,
    currency: 'TRY',
    currencySymbol: 'TL',
    reviewsCount: 5,
    ratingAverage: 4.0
  },
  {
    id: 'mock-3',
    name: 'Stilsoft PowerMix Blender Seti',
    stockCode: 'MUTFAK-BLENDER',
    mainCategory: 'Mutfak',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCV-HRJSd51_RzSYzR3mmX7oDDYE5yh-QghTvmIb7M7m939ROYJMETTbbyXEEVziEeCnDZVORixMy13b8A3bNFkItSa661tIpDk3Cyx8tD2SNR4Oil2_sDdSiqy4x0TvycuX2obC0rLdUwbRIHTYYUeld1V_DKXa9uJQ6hUK7Or3fbDthhtCsP6szOyu1rnIHSjYQck81r3zYpQvrMhJDbQnrKC-kHl_wROKadFJnj_q4qXWAOrqDIw0I4tVSCUnbXfvFnTfcMF_gY',
    unitPrice: 3450,
    currency: 'TRY',
    currencySymbol: 'TL',
    reviewsCount: 12,
    ratingAverage: 4.8
  },
  {
    id: 'mock-4',
    name: 'Stilsoft AromaBar Kahve Öğütücü',
    stockCode: 'KAHVE-OGUTUCU',
    mainCategory: 'Mutfak',
    imageUrl: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCQUxr39wrv87YgJ5FDH6pNKcdVvGq0BuPWI3vSuBGAm7LFbA43uqpe8pNrH43AZIvFf8LbZp-I2ioa3aTx-ibLGe3NoZg2oS0PXB5Eci4WegnYKDYj_j7FBIof7D3Fxw85MGXrXW3E0_-G5jlQdM3SC18gbtg37r9z2nuuEF2-n-3NkcrAKldRu9D5Sk7c3tVDDurxSjoASFDGw0lHv5wDVk65iikUaj6_lAOCdN-F6Qg_jCr2CTdVqI4fU34wyfTfcxtifPh64Dw',
    unitPrice: 1890,
    currency: 'TRY',
    currencySymbol: 'TL',
    reviewsCount: 0,
    ratingAverage: 0
  }
]

export function HomePage() {
  useSEO({
    title: 'Ana Sayfa',
    description: 'En kaliteli ev aletleri, mutfak robotları, süpürgeler ve ev teknolojisi ürünleri en iyi fiyatlarla Stilsoft KKTC\'de!',
    schema: [
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        'name': 'Stilsoft KKTC',
        'url': window.location.origin,
        'logo': window.location.origin + '/logo.png',
        'sameAs': []
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Store',
        'name': 'Stilsoft KKTC Online Mağaza',
        'url': window.location.origin,
        'telephone': '0850 000 00 00',
        'address': {
          '@type': 'PostalAddress',
          'addressCountry': 'CY',
          'addressLocality': 'Lefkoşa'
        },
        'openingHoursSpecification': {
          '@type': 'OpeningHoursSpecification',
          'dayOfWeek': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          'opens': '09:00',
          'closes': '18:00'
        }
      },
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        'name': 'Stilsoft KKTC',
        'url': window.location.origin,
        'potentialAction': {
          '@type': 'SearchAction',
          'target': {
            '@type': 'EntryPoint',
            'urlTemplate': window.location.origin + '/arama?q={search_term_string}'
          },
          'query-input': 'required name={search_term_string}'
        }
      }
    ]
  })

  const [design, setDesign] = useState<StoreDesign>({
    brandName: 'STILSOFT',
    heroTitle: 'Mutfakta Profesyonel Stilsoft Dokunuşu.',
    heroSubtitle: 'İleri teknoloji ve zarif tasarımın buluştuğu ürünlerle yaşam alanınızı dönüştürün.',
    heroImageUrl: '',
  })

  const cargoFee = design.cargoFee ?? 150
  const threshold = design.freeShippingThreshold ?? 2000
  const currency = design.currency || 'TL'

  const [cats, setCats] = useState<CategoryDto[]>([])
  const [products, setProducts] = useState<ErpProductListItem[]>([])
  const [timeLeft, setTimeLeft] = useState('')
  const [activeSlide, setActiveSlide] = useState(0)
  const [catalogs, setCatalogs] = useState<Array<{ id: string; name: string; coverImageUrl?: string; pdfUrl: string; description?: string }>>([])
  const [activeCampaigns, setActiveCampaigns] = useState<any[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/storefront/campaigns')
        const json = await res.json()
        if (res.ok && json?.success && Array.isArray(json.data)) {
          if (!cancelled) setActiveCampaigns(json.data)
        }
      } catch (e) {
        console.error('Failed to load campaigns:', e)
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
        const res = await fetch('/api/storefront/pdf-catalogs')
        const json = await res.json()
        if (res.ok && json?.success && Array.isArray(json.data)) {
          if (!cancelled) setCatalogs(json.data)
        }
      } catch (e) {
        console.error('Failed to load catalogs:', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    trackLiveEvent('visit', 'Ana sayfaya girdi')
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/store-design')
        const json = await res.json()
        if (res.ok && json?.data) setDesign((prev) => ({ ...prev, ...json.data }))
      } catch {
        // Default design is set
      }
    })()
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await fetchStorefrontCategories()
        if (!cancelled) setCats(list)
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
        const res = await fetch('/api/storefront/products')
        const json = await readApiResponse(res)
        if (res.ok) {
          const list = extractProductsList(json)
          if (!cancelled) setProducts(list)
        }
      } catch {
        // Fallback remains
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date()
      const midnight = new Date()
      midnight.setHours(24, 0, 0, 0)
      const diff = midnight.getTime() - now.getTime()
      
      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff / (1000 * 60)) % 60)
      const seconds = Math.floor((diff / 1000) % 60)

      const hStr = hours.toString().padStart(2, '0')
      const mStr = minutes.toString().padStart(2, '0')
      const sStr = seconds.toString().padStart(2, '0')

      setTimeLeft(`${hStr}:${mStr}:${sStr}`)
    }

    calculateTimeLeft()
    const timer = setInterval(calculateTimeLeft, 1000)
    return () => clearInterval(timer)
  }, [])

  const slidesToRender = design.sliders && design.sliders.length > 0
    ? design.sliders.map((s, idx) => ({
        title: s.title || "Stilsoft Fırsatları",
        subtitle: s.subtitle || "",
        imageUrl: s.imageUrl || "https://lh3.googleusercontent.com/aida-public/AB6AXuAXvj84_ptlKifbDZ4Rs5agPcI2w8x8eFK0_m2Mlr-hOgyA6VTeD91nHG79lHh7d_anqvxAZTmlhGevxNgKxJaB-ZWJQ5SNFZK39EuQUqIxp4aC5qXWrbIM7zCfissLOctdNnpk4ONjvi_DKW023KReCkPndJ1EA4YO4VlgqS47jnuGCUfFal5m-6RJtSAlqtOslLIH3JIsuVPzXExzZCvCAuvWl9WAUMpAafIAAqI7TtCfLOAASP7JV9SImsb69M2NA_Zv8G5gTiQ",
        link: s.link || "/kampanyalar",
        badge: idx === 0 ? "Öne Çıkan" : "Kampanya"
      }))
    : [
        {
          title: "Büyük Stilsoft Kampanyası Başladı!",
          subtitle: "Stilsoft Club üyelerine özel mutfak şefleri ve blender setlerinde %20'ye varan indirimler.",
          imageUrl: design.heroImageUrl || "https://lh3.googleusercontent.com/aida-public/AB6AXuAXvj84_ptlKifbDZ4Rs5agPcI2w8x8eFK0_m2Mlr-hOgyA6VTeD91nHG79lHh7d_anqvxAZTmlhGevxNgKxJaB-ZWJQ5SNFZK39EuQUqIxp4aC5qXWrbIM7zCfissLOctdNnpk4ONjvi_DKW023KReCkPndJ1EA4YO4VlgqS47jnuGCUfFal5m-6RJtSAlqtOslLIH3JIsuVPzXExzZCvCAuvWl9WAUMpAafIAAqI7TtCfLOAASP7JV9SImsb69M2NA_Zv8G5gTiQ",
          link: "/kampanyalar",
          badge: "CLUB KART'A ÖZEL"
        },
        {
          title: "Yıldızlı Fırsat Günleri!",
          subtitle: "En yeni blenderlar, süpürgeler ve kahve makineleri Kıbrıs'a özel indirim ve taksit fırsatlarıyla.",
          imageUrl: "https://lh3.googleusercontent.com/aida-public/AB6AXuAXbwWIPGXEBf7AjhlLoo3dyXi6BrH6VXkby1j2GKMN_gvs21j8SkqazoQ5TBiLSEqH3eoHSUoR2nX8XyadST65MsHUaRqPXf8HUHU8MmDZ5hfsBg4I9j4CZgJhK5CzI2i9Jk_oaqodwd7HKUQdkEWWzOf2XxcUoASSIdr6ezSCDgb3EJlCziHka2NUjo2ZY1pGk0qfQXhqcwJ76HRJt4x4tpAK4RTyZqNnKk_rop_-Gsv5GT16eKLqheIVkI-qEH9Ihx3As1dZBoA",
          link: "/kategoriler",
          badge: "SINIRLI SÜRE"
        },
        {
          title: "Mutfakta Şef Sizsiniz!",
          subtitle: "Profesyonel mikserler, blender setleri ve çay makinelerinde açılışa özel fiyatlar.",
          imageUrl: "https://lh3.googleusercontent.com/aida-public/AB6AXuDBEPLZfvKbpHR3OBSzpEUxd_itefxPzfIssHrG8leF-DFOGnP__Y_MhD8PXc8TzcneKCjDqZkk12xevU5rXe2y_xYJ9lY-m7x7Ti6_zpVesOS_xbIo2JGaOiilQ8zovbnLHAbchDK1B7BfX6xh3akW-Ix89cUw3p9Wg2dVQnGkDjcgOs-JRJJXgelGdkbMdhp-8BREzVrJzNz4mJKwEqOCuaBEV_NrrhOSoZkcFPr1I_R5qhWcb2FtP5jeX60FMLLV_okmGThhHvQ",
          link: "/kategoriler",
          badge: "KAMPANYA"
        }
      ]

  useEffect(() => {
    const slideTimer = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % slidesToRender.length)
    }, 6000)
    return () => clearInterval(slideTimer)
  }, [slidesToRender.length])

  const dealsProducts = products.length > 0 ? products.slice(0, 4) : MOCK_PRODUCTS
  const bestSellersProducts = products.length > 4 ? products.slice(4, 8) : MOCK_PRODUCTS

  return (
    <div className="bg-zinc-50 min-h-screen text-on-surface">
      {/* 3D Perspective Slider Section */}
      <section className="w-full mt-6 mb-2" aria-label="Kampanya Görselleri">
        <style dangerouslySetInnerHTML={{ __html: `
          .hero-slider-wrapper { perspective: 1200px; }
          .hero-slide { transition: all 0.7s cubic-bezier(0.4, 0, 0.2, 1); backface-visibility: hidden; }
        `}} />
        <div className="hero-slider-wrapper relative max-w-7xl mx-auto px-4 md:px-6 overflow-hidden lg:overflow-visible">
          <div className="relative w-full overflow-hidden lg:overflow-visible" style={{ height: 'clamp(300px, 42vw, 560px)' }}>
            {slidesToRender.map((s, idx) => {
              const total = slidesToRender.length;
              const diff = ((idx - activeSlide) % total + total) % total;
              const pos = diff > total / 2 ? diff - total : diff;

              let style: React.CSSProperties = {
                position: 'absolute',
                top: 0,
                left: '50%',
                width: '100%',
                height: '100%',
                borderRadius: '20px',
                overflow: 'hidden',
                transformOrigin: 'center center',
              };

              if (pos === 0) {
                // Active center slide
                style = {
                  ...style,
                  transform: 'translateX(-50%) scale(1)',
                  zIndex: 20,
                  opacity: 1,
                  filter: 'none',
                  boxShadow: '0 25px 60px -15px rgba(0,0,0,0.35)',
                };
              } else if (pos === -1 || (pos === total - 1)) {
                // Left slide
                style = {
                  ...style,
                  transform: 'translateX(-50%) translateX(-72%) scale(0.78) rotateY(5deg)',
                  zIndex: 10,
                  opacity: 0.55,
                  filter: 'blur(3px) brightness(0.65)',
                  boxShadow: '0 15px 40px -15px rgba(0,0,0,0.2)',
                  cursor: 'pointer',
                };
              } else if (pos === 1 || (pos === -(total - 1))) {
                // Right slide
                style = {
                  ...style,
                  transform: 'translateX(-50%) translateX(72%) scale(0.78) rotateY(-5deg)',
                  zIndex: 10,
                  opacity: 0.55,
                  filter: 'blur(3px) brightness(0.65)',
                  boxShadow: '0 15px 40px -15px rgba(0,0,0,0.2)',
                  cursor: 'pointer',
                };
              } else {
                // Hidden slides
                style = {
                  ...style,
                  transform: 'translateX(-50%) scale(0.6)',
                  zIndex: 0,
                  opacity: 0,
                  pointerEvents: 'none',
                };
              }

              const isLeft = pos === -1 || pos === total - 1;
              const isRight = pos === 1 || pos === -(total - 1);

              return (
                <div
                  key={idx}
                  className="hero-slide"
                  style={style}
                  onClick={() => {
                    if (isLeft || isRight) setActiveSlide(idx);
                  }}
                >
                  <div className="relative w-full h-full bg-black">
                    <img
                      className="w-full h-full object-cover opacity-65"
                      src={s.imageUrl}
                      alt={s.title}
                      draggable={false}
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/30 to-transparent" />
                    {pos === 0 && (
                      <div className="absolute inset-0 flex items-center p-8 md:p-14">
                        <div className="max-w-md min-w-0">
                          <span className="inline-flex items-center gap-1.5 bg-primary px-3 py-1 text-white text-[9px] font-black tracking-widest uppercase rounded-full mb-3 shadow-lg shadow-primary/30">
                            <span className="material-symbols-outlined text-xs">auto_awesome</span>
                            {s.badge}
                          </span>
                          <h2 className="text-xl sm:text-2xl md:text-4xl font-extrabold text-white leading-tight mb-3">
                            {s.title}
                          </h2>
                          <p className="text-[11px] sm:text-xs md:text-sm text-zinc-300 mb-5 leading-relaxed max-w-sm line-clamp-2">
                            {s.subtitle}
                          </p>
                          <Link
                            to={s.link}
                            className="inline-flex bg-primary text-white px-5 py-2.5 rounded-xl font-bold text-xs hover:bg-primary/90 active:scale-95 transition-all shadow-lg shadow-primary/25 items-center gap-1.5"
                          >
                            Hemen Keşfet
                            <span className="material-symbols-outlined text-sm">arrow_forward</span>
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Navigation Chevrons */}
          <button
            onClick={() => setActiveSlide((prev) => (prev === 0 ? slidesToRender.length - 1 : prev - 1))}
            className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-white/90 backdrop-blur-sm border border-zinc-200 flex items-center justify-center text-zinc-700 shadow-lg hover:bg-primary hover:text-white hover:border-primary transition-all active:scale-90"
            aria-label="Önceki"
          >
            <span className="material-symbols-outlined text-[20px] font-bold">chevron_left</span>
          </button>
          <button
            onClick={() => setActiveSlide((prev) => (prev + 1) % slidesToRender.length)}
            className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-white/90 backdrop-blur-sm border border-zinc-200 flex items-center justify-center text-zinc-700 shadow-lg hover:bg-primary hover:text-white hover:border-primary transition-all active:scale-90"
            aria-label="Sonraki"
          >
            <span className="material-symbols-outlined text-[20px] font-bold">chevron_right</span>
          </button>

          {/* Dots indicator */}
          <div className="flex items-center justify-center gap-2 mt-5">
            {slidesToRender.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setActiveSlide(idx)}
                className={`rounded-full transition-all duration-300 ${
                  idx === activeSlide
                    ? 'w-7 h-2.5 bg-primary shadow-md shadow-primary/30'
                    : 'w-2.5 h-2.5 bg-zinc-300 hover:bg-zinc-400'
                }`}
                aria-label={`Slide ${idx + 1}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Top Banner Placement */}
      {design.topBannerUrl && (
        <div className="max-w-7xl mx-auto px-4 md:px-6 mt-6">
          <Link to={design.topBannerLink || '#'} className="block rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition border border-zinc-200 bg-white">
            <img src={design.topBannerUrl} className="w-full h-auto object-cover max-h-[140px]" alt="Kampanya" />
          </Link>
        </div>
      )}

      {/* Promotional Info Cards / Membership Perks */}
      <section className="py-8 max-w-7xl mx-auto px-4 md:px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white hover:shadow-md transition-all duration-300 p-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-primary flex items-center justify-center text-white shrink-0">
              <span className="material-symbols-outlined text-2xl">card_membership</span>
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-on-surface mb-1">Club Kart Dünyası</h3>
              <p className="text-xs text-zinc-500 leading-relaxed mb-3">Her alışverişte ekstra puan kazanın, özel indirim ve kampanyalardan anında yararlanın.</p>
              <Link to="/hesabim" className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
                Hemen Katıl <span className="material-symbols-outlined text-sm">chevron_right</span>
              </Link>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white hover:shadow-md transition-all duration-300 p-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-zinc-950 flex items-center justify-center text-white shrink-0">
              <span className="material-symbols-outlined text-2xl">verified_user</span>
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-on-surface mb-1">Uzatılmış Garanti</h3>
              <p className="text-xs text-zinc-500 leading-relaxed mb-3">Satın aldığınız teknoloji ürünlerini koruma altına alın, servis masraflarını sıfırlayın.</p>
              <Link to="/garanti" className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
                Detayları Gör <span className="material-symbols-outlined text-sm">chevron_right</span>
              </Link>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white hover:shadow-md transition-all duration-300 p-6 flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-primary flex items-center justify-center text-white shrink-0">
              <span className="material-symbols-outlined text-2xl">local_shipping</span>
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-on-surface mb-1">Aynı Gün Teslimat</h3>
              <p className="text-xs text-zinc-500 leading-relaxed mb-3">Seçili şehirlerde saat 12:00'ye kadar verilen siparişlerde gün içinde kapınızda.</p>
              <Link to="/iletisim" className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
                Teslimat Bölgeleri <span className="material-symbols-outlined text-sm">chevron_right</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Günün Fırsatları (Deals of the Day) with Countdown Timer */}
      <section className="py-10 max-w-7xl mx-auto px-4 md:px-6">
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          {/* Header Banner */}
          <div className="bg-primary px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 border-b border-zinc-100">
            <div className="flex items-center gap-2.5 text-white">
              <span className="material-symbols-outlined text-2xl animate-pulse">local_fire_department</span>
              <h2 className="text-lg md:text-xl font-black uppercase tracking-wider">GÜNÜN FIRSATLARI</h2>
            </div>
            
            {/* Timer Countdown */}
            <div className="flex items-center gap-3 bg-black/20 backdrop-blur-sm px-4 py-2 rounded-lg">
              <span className="text-white text-xs font-bold uppercase tracking-wider hidden md:inline">Kalan Süre:</span>
              <div className="flex items-center gap-1 text-white font-mono text-lg font-black tracking-widest">
                {timeLeft.split(':').map((unit, idx) => (
                  <span key={idx} className="flex items-center">
                    <span className="bg-white text-zinc-950 px-2 py-0.5 rounded font-black text-sm">{unit}</span>
                    {idx < 2 && <span className="mx-1 text-white font-bold">:</span>}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 md:p-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
              {dealsProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        </div>
      </section>



      {/* Bento Grid Campaigns */}
      {activeCampaigns && activeCampaigns.length > 0 && (
        <section className="py-10 max-w-7xl mx-auto px-4 md:px-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3 mb-8">
            <div>
              <span className="text-[10px] font-bold text-primary uppercase tracking-[0.2em]">Fırsatlar</span>
              <h2 className="text-2xl md:text-3xl font-black text-zinc-900 mt-1">Öne Çıkan Kampanyalar</h2>
            </div>
            <Link to="/kampanyalar" className="flex items-center gap-1 text-sm font-bold text-primary hover:underline">
              Tümünü Gör <span className="material-symbols-outlined text-lg">chevron_right</span>
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {activeCampaigns.slice(0, 4).map((camp, idx) => {
              const colSpan = idx === 0 || idx === 3 ? '2' : '1'
              return (
                <div
                  key={camp.id}
                  className={`relative group overflow-hidden rounded-3xl bg-zinc-900 shadow-sm min-h-[300px] transition-all duration-300 hover:shadow-xl ${
                    colSpan === '2' ? 'md:col-span-2' : 'md:col-span-1'
                  }`}
                >
                  {camp.imageUrl ? (
                    <img
                      className="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-700"
                      src={camp.imageUrl}
                      alt={camp.name}
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-zinc-800 to-zinc-900 flex flex-col items-center justify-center p-6 text-center text-white/40">
                      <span className="material-symbols-outlined text-[64px] mb-2 text-primary">campaign</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent flex flex-col justify-end p-8">
                    <h3 className="text-white text-xl font-black mb-1 tracking-tight leading-tight">
                      {camp.name}
                    </h3>
                    {camp.description && (
                      <p className="text-white/80 text-xs line-clamp-2 mb-3">
                        {camp.description}
                      </p>
                    )}
                    <Link
                      to={`/kampanya/${camp.id}`}
                      className="w-fit bg-white text-zinc-900 px-5 py-2.5 rounded-xl font-bold text-[11px] hover:bg-primary hover:text-white transition-all active:scale-95 shadow-md flex items-center gap-1.5"
                    >
                      Detayları Gör <span className="material-symbols-outlined text-sm">arrow_forward</span>
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Categories Grid (Zoom on Hover) */}
      <section className="py-12 max-w-7xl mx-auto px-4 md:px-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3 mb-8">
          <div>
            <span className="text-[10px] font-bold text-primary uppercase tracking-[0.2em]">Kategoriler</span>
            <h2 className="text-2xl md:text-3xl font-black text-on-surface mt-1">Kategorileri Keşfet</h2>
          </div>
          <Link to="/kategoriler" className="flex items-center gap-1 text-sm font-bold text-primary hover:underline">
            Tümünü Gör <span className="material-symbols-outlined text-lg">chevron_right</span>
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          {cats
            .filter((x) => !x.parentId)
            .slice()
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'tr'))
            .slice(0, 8)
            .map((c) => (
              <Link
                key={c.id}
                to={`/kategori/${encodeURIComponent(c.slug)}`}
                className="relative group overflow-hidden rounded-xl border border-zinc-200 bg-white hover:border-primary/40 hover:shadow-md transition-all duration-300 aspect-[4/3] flex flex-col justify-between"
              >
                <div className="w-full h-full overflow-hidden bg-zinc-50 flex items-center justify-center p-4">
                  {c.imageUrl ? (
                    <img
                      className="max-h-full max-w-full object-contain group-hover:scale-110 transition-transform duration-700"
                      src={c.imageUrl}
                      alt={c.name}
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-zinc-300">
                      <span className="material-symbols-outlined text-5xl">image</span>
                    </div>
                  )}
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                  <h3 className="text-sm font-black tracking-wide truncate">{c.name}</h3>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary-fixed flex items-center gap-1 mt-1">
                    İncele <span className="material-symbols-outlined text-[10px] transition-transform group-hover:translate-x-1">arrow_forward</span>
                  </span>
                </div>
              </Link>
            ))}
        </div>
      </section>

      {/* Middle Banner Placement */}
      {design.middleBannerUrl && (
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
          <Link to={design.middleBannerLink || '#'} className="block rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition border border-zinc-200 bg-white">
            <img src={design.middleBannerUrl} className="w-full h-auto object-cover max-h-[140px]" alt="Özel Fırsatlar" />
          </Link>
        </div>
      )}

      {/* En Çok Satanlar (Best Sellers) */}
      <section className="py-12 bg-white border-y border-zinc-200">
        <div className="max-w-7xl mx-auto px-4 md:px-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-3 mb-8">
            <div>
              <span className="text-[10px] font-bold text-primary uppercase tracking-[0.2em]">En İyiler</span>
              <h2 className="text-2xl md:text-3xl font-black text-on-surface mt-1">En Çok Satan Ürünler</h2>
            </div>
          </div>
          
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
            {bestSellersProducts.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      </section>

      {/* 4-Image Grid Layout Section */}
      {(design.grid4WideUrl || design.grid4Vert1Url || design.grid4Vert2Url || design.grid4Vert3Url) && (
        <section className="py-8 max-w-7xl mx-auto px-4 md:px-6">
          <div className="space-y-4">
            {/* Top Wide Banner */}
            {design.grid4WideUrl && (
              <Link
                to={design.grid4WideLink || '#'}
                className="block overflow-hidden rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 border border-zinc-200 bg-white"
              >
                <img
                  src={design.grid4WideUrl}
                  alt="Geniş Banner"
                  className="w-full h-auto object-cover max-h-[360px] hover:scale-[1.005] transition-transform duration-500"
                />
              </Link>
            )}

            {/* Bottom 3 Vertical Banners */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {design.grid4Vert1Url && (
                <Link
                  to={design.grid4Vert1Link || '#'}
                  className="block overflow-hidden rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 border border-zinc-200 bg-white aspect-[3/4]"
                >
                  <img
                    src={design.grid4Vert1Url}
                    alt="Dikey Görsel 1"
                    className="w-full h-full object-cover hover:scale-[1.03] transition-transform duration-500"
                  />
                </Link>
              )}
              {design.grid4Vert2Url && (
                <Link
                  to={design.grid4Vert2Link || '#'}
                  className="block overflow-hidden rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 border border-zinc-200 bg-white aspect-[3/4]"
                >
                  <img
                    src={design.grid4Vert2Url}
                    alt="Dikey Görsel 2"
                    className="w-full h-full object-cover hover:scale-[1.03] transition-transform duration-500"
                  />
                </Link>
              )}
              {design.grid4Vert3Url && (
                <Link
                  to={design.grid4Vert3Link || '#'}
                  className="block overflow-hidden rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 border border-zinc-200 bg-white aspect-[3/4]"
                >
                  <img
                    src={design.grid4Vert3Url}
                    alt="Dikey Görsel 3"
                    className="w-full h-full object-cover hover:scale-[1.03] transition-transform duration-500"
                  />
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Bottom Banner Placement */}
      {design.bottomBannerUrl && (
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
          <Link to={design.bottomBannerLink || '#'} className="block rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition border border-zinc-200 bg-white">
            <img src={design.bottomBannerUrl} className="w-full h-auto object-cover max-h-[140px]" alt="Promosyon" />
          </Link>
        </div>
      )}

      {/* PDF Catalogs Section */}
      {catalogs.length > 0 && (
        <section className="py-12 bg-white">
          <div className="max-w-7xl mx-auto px-4 md:px-6 text-center">
            <h2 className="text-2xl md:text-3xl font-black text-zinc-700 mb-8">
              {design.pdfCatalogsTitle || "Stilsoft'un Renkli Dünyasına Açılan Kapılar"}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {catalogs.map((cat) => (
                <a
                  key={cat.id}
                  href={cat.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block rounded-[24px] overflow-hidden transition-all duration-300 transform hover:scale-[1.02] hover:shadow-xl"
                >
                  <div className="aspect-[3/4] w-full overflow-hidden rounded-[24px] bg-zinc-50 flex items-center justify-center relative">
                    {cat.coverImageUrl ? (
                      <img
                        src={cat.coverImageUrl}
                        alt={cat.name}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center p-6 text-zinc-400">
                        <span className="material-symbols-outlined text-5xl mb-2 text-primary">picture_as_pdf</span>
                        <span className="text-xs font-bold uppercase tracking-wider">{cat.name}</span>
                      </div>
                    )}
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Features Bar */}
      <section className="bg-zinc-950 text-white">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-5 md:gap-8">
            {[
              { icon: 'local_shipping', title: 'Ücretsiz Kargo', desc: cargoFee === 0 ? 'Tüm alışverişlerde' : `${threshold.toLocaleString('tr-TR')} ${currency} üzeri alışverişlerde` },
              { icon: 'shield', title: 'Güvenli Ödeme', desc: '256-bit SSL koruma' },
              { icon: 'build', title: 'Yaygın Servis', desc: '81 ilde teknik destek' },
              { icon: 'published_with_changes', title: 'Kolay İade', desc: '14 gün içinde sorgusuz' },
            ].map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 text-primary">
                  <span className="material-symbols-outlined text-xl">{f.icon}</span>
                </div>
                <div>
                  <h5 className="font-extrabold text-xs">{f.title}</h5>
                  <p className="text-[10px] text-zinc-400 mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
