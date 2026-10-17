'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface BannerSlide {
  id: string
  imageSrc: string
  alt: string
  link?: string
}

/**
 * Anasayfa görsel vitrini.
 *
 * GÖRSELLER `public/banners/` ALTINDA, 1920x700 — Stilsoft'un kendi hazırlattığı afişler.
 * Öncesinde burada yapay zekâyla üretilmiş dört yer tutucu (1376x768) duruyordu; marka
 * tipografisi, ürün adı ve kampanya metni taşımıyorlardı.
 *
 * ORANA DOKUNMAYIN: afişin metni de ürünü de kadrajın içinde tasarlandı. Görüntü alanı
 * 21/9 (2,33) iken `object-fit: cover` afişin altından ve üstünden %15 kırpıyordu; mobildeki
 * 4/3 kadraj ise afişin yarısını kesiyordu. CSS artık her ekranda 1920/700 kullanıyor
 * (bkz. `globals.css` → `.visual-hero-viewport`).
 *
 * HER AFİŞ TIKLANABİLİR. Bağlantı alanı CSS'te (`.visual-slide-link`) baştan beri tanımlıydı
 * ama hiçbir yerde kullanılmıyordu: `link` alanı doluydu, hiçbir afiş tıklanmıyordu. Anasayfanın
 * en büyük görsel alanı, ziyaretçiyi hiçbir yere götürmüyordu.
 *
 * Adresler canlı kategori listesiyle doğrulandı (su sebili kategorisinin adresi `sebil`).
 * Televizyonun kategorisi YOK; o afiş aramaya gidiyor.
 */
const DEFAULT_BANNER_SLIDES: BannerSlide[] = [
  {
    id: 'slide-sikayetvar-odul',
    imageSrc: '/banners/slider-sikayetvar-odul.webp',
    alt: 'Şikayetvar A.C.E. Awards — Mükemmellikte 11. Yıl Diamond Ödülü',
  },
  {
    id: 'slide-yeni-supurge',
    imageSrc: '/banners/slider-yeni-supurge.webp',
    alt: 'Stilsoft yeni şarjlı dikey süpürge — bitmeyen çekim gücü',
    link: '/kategori/ev-temizligi',
  },
  {
    id: 'slide-ankastre-set',
    imageSrc: '/banners/slider-ankastre-set.webp',
    alt: 'Stilsoft Ankastre Set — ocak, fırın ve davlumbaz bir arada',
    link: '/kategori/ankastre',
  },
  {
    id: 'slide-tv',
    imageSrc: '/banners/slider-tv.webp',
    alt: 'Stilsoft 4K Ultra HD LED Smart TV',
    link: '/arama?q=televizyon',
  },
  {
    id: 'slide-steamgen',
    imageSrc: '/banners/slider-steamgen-3000.webp',
    alt: 'Stilsoft Steamgen 3000 buhar kazanlı ütü',
    link: '/kategori/utu',
  },
  {
    id: 'slide-sebil',
    imageSrc: '/banners/slider-su-sebili.webp',
    alt: 'Stilsoft su sebili — sıcak ve soğuk su',
    link: '/kategori/sebil',
  },
  {
    id: 'slide-megatron',
    imageSrc: '/banners/slider-megatron-2.webp',
    alt: 'Stilsoft Megatron II şarjlı dikey süpürge',
    link: '/kategori/ev-temizligi',
  },
  {
    id: 'slide-klima',
    imageSrc: '/banners/slider-klima.webp',
    alt: 'Stilsoft klima — verimli soğutma',
    link: '/kategori/klima',
  },
  {
    id: 'slide-bikahve',
    imageSrc: '/banners/slider-bikahve.webp',
    alt: 'Stilsoft BiKahve Maxi Filter filtre kahve makinesi',
    link: '/kategori/icecek-hazirlama',
  },
  {
    id: 'slide-gurmega',
    imageSrc: '/banners/slider-gurmega.webp',
    alt: 'Stilsoft Gurmega tost ve ızgara makinesi',
    link: '/kategori/gida-hazirlama',
  },
  {
    id: 'slide-fonmatik',
    imageSrc: '/banners/slider-fonmatik.webp',
    alt: 'Stilsoft Fönmatik BLDC-9041 saç kurutma makinesi',
    link: '/kategori/kisisel-bakim',
  },
  {
    id: 'slide-camasir',
    imageSrc: '/banners/slider-camasir-makinesi.webp',
    alt: 'Stilsoft çamaşır makinesi — mükemmel yıkama performansı',
    link: '/kategori/camasir-makinesi',
  },
]

export default function HeroSlider({
  slides = DEFAULT_BANNER_SLIDES,
}: {
  slides?: BannerSlide[]
}) {
  const activeSlides = slides.length > 0 ? slides : DEFAULT_BANNER_SLIDES
  const [index, setIndex] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const touchStartX = useRef<number | null>(null)
  const touchDeltaX = useRef<number>(0)

  const count = activeSlides.length

  const next = useCallback(() => {
    setIndex((prev) => (prev + 1) % count)
    setProgress(0)
  }, [count])

  const prev = useCallback(() => {
    setIndex((prev) => (prev - 1 + count) % count)
    setProgress(0)
  }, [count])

  const goTo = (i: number) => {
    setIndex(i)
    setProgress(0)
  }

  // Otomatik ilerleme ve ilerleme çubuğu animasyonu
  useEffect(() => {
    if (count <= 1 || isPaused) return

    const duration = 5000
    const step = 50
    const increment = (step / duration) * 100

    const timer = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) {
          next()
          return 0
        }
        return p + increment
      })
    }, step)

    return () => clearInterval(timer)
  }, [count, isPaused, next])

  // Dokunmatik kaydırma
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchDeltaX.current = 0
    setIsPaused(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    touchDeltaX.current = e.touches[0].clientX - touchStartX.current
  }

  const handleTouchEnd = () => {
    if (Math.abs(touchDeltaX.current) > 50) {
      if (touchDeltaX.current < 0) next()
      else prev()
    }
    touchStartX.current = null
    touchDeltaX.current = 0
    setIsPaused(false)
  }

  return (
    <section
      className="visual-hero-slider-section"
      aria-label="Ürün Görsel Vitrini"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="wrap visual-hero-wrap">
        <div className="visual-hero-viewport">
          <div className="visual-hero-track">
            {activeSlides.map((slide, i) => {
              const isActive = i === index
              return (
                <div
                  key={slide.id}
                  className={`visual-slide ${isActive ? 'active' : ''}`}
                  aria-hidden={!isActive}
                >
                  {/*
                    Afiş, bağlantısı varsa TIKLANABİLİR. Perde arkasındaki slaytların
                    bağlantısı `tabIndex={-1}` ile klavye sırasından çıkarılıyor: aksi hâlde
                    sekme tuşu görünmeyen dokuz afişin üzerinden geçerdi.
                  */}
                  {slide.link ? (
                    <Link
                      href={slide.link}
                      className="visual-slide-link"
                      tabIndex={isActive ? 0 : -1}
                      aria-label={slide.alt}
                    >
                      <div className="visual-slide-img-box">
                        <Image
                          src={slide.imageSrc}
                          alt={slide.alt}
                          fill
                          sizes="(max-width: 768px) 100vw, (max-width: 1400px) 94vw, 1320px"
                          priority={i === 0}
                          className="visual-banner-img"
                          style={{ objectFit: 'cover' }}
                        />
                      </div>
                    </Link>
                  ) : (
                    <div className="visual-slide-img-box">
                      <Image
                        src={slide.imageSrc}
                        alt={slide.alt}
                        fill
                        sizes="(max-width: 768px) 100vw, (max-width: 1400px) 94vw, 1320px"
                        priority={i === 0}
                        className="visual-banner-img"
                        style={{ objectFit: 'cover' }}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Sol / Sağ Yön Okları */}
          {count > 1 && (
            <>
              <button
                type="button"
                className="visual-arrow prev"
                onClick={prev}
                aria-label="Önceki görsel"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <button
                type="button"
                className="visual-arrow next"
                onClick={next}
                aria-label="Sonraki görsel"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </>
          )}

          {/* Alt İlerleme Çubuğu & Göstergeler */}
          {count > 1 && (
            <div className="visual-dots-container">
              <div className="visual-dots-box">
                {activeSlides.map((slide, i) => {
                  const isActive = i === index
                  return (
                    <button
                      type="button"
                      key={slide.id}
                      className={`visual-dot-btn ${isActive ? 'active' : ''}`}
                      onClick={() => goTo(i)}
                      aria-label={`${i + 1}. görsele git`}
                      aria-current={isActive}
                    >
                      {isActive ? (
                        <span
                          className="visual-dot-progress"
                          style={{ width: `${progress}%` }}
                        />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
