'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRef, useState, useEffect } from 'react'
import ProductCard from '@/components/ProductCard'
import AddToCartButton from '@/components/AddToCartButton'
import type { CatalogItem } from '@/lib/api'
import { displayName, formatPrice, mediaUrl } from '@/lib/format'

export default function ProductSlider({
  title,
  subtitle,
  viewAllLink,
  viewAllText = 'Tümünü Gör',
  badge,
  items,
  tema = 'acik',
}: {
  title: string
  subtitle?: string
  viewAllLink?: string
  viewAllText?: string
  badge?: string
  items: CatalogItem[]
  /**
   * Şeridin zemini (2026-09-21 kullanıcı isteği: "3. görseldeki kısmın arka planını kırmızı
   * olacak şekilde animasyonlu güzel bir şey yap").
   *
   * 'acik'    — varsayılan: beyaz zemin, çok düşük opaklıkta ışık kütleleri.
   * 'kirmizi' — tam genişlik kırmızı bant, beyaz yazı, daha belirgin animasyon.
   *
   * YALNIZ BİR ŞERİTTE kullanılıyor. Hepsi kırmızı olsaydı sayfa kırmızı bir tünele döner
   * ve hiçbiri dikkat çekmezdi; tek kırmızı şerit, beyazların arasında ayrışıyor.
   */
  tema?: 'acik' | 'kirmizi'
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)

  const checkScroll = () => {
    if (!scrollRef.current) return
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current
    setCanScrollLeft(scrollLeft > 10)
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 10)
  }

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (el) {
      el.addEventListener('scroll', checkScroll, { passive: true })
      window.addEventListener('resize', checkScroll)
    }
    return () => {
      if (el) el.removeEventListener('scroll', checkScroll)
      window.removeEventListener('resize', checkScroll)
    }
  }, [items])

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return
    const scrollAmount = scrollRef.current.clientWidth * 0.75
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    })
  }

  if (!items || items.length === 0) return null

  const kirmizi = tema === 'kirmizi'

  return (
    <section className={`product-slider-block${tema === 'kirmizi' ? ' product-slider-kirmizi' : ''}`}>
      {/*
        ANİMASYONLU ZEMİN (2026-09-09 kullanıcı isteği: "bura çok sıkıcı, 3 section'da aynı
        tipte olmalı, attığımız svg animasyonlu bir şey yap").

        Ürün şeritleri düz beyaz bir zemindeydi; sayfada arka arkaya üç tane olduğu için
        aşağı inildikçe hepsi aynı ve durgun görünüyordu. Dil `CategoryShowcase` ve
        `BrandStory` ile AYNI (süzülen ışık kütleleri + çok yavaş kayan ızgara), ama
        opaklıklar çok daha düşük: burada zeminin işi dikkat çekmek değil, ÜRÜN KARTLARININ
        okunmasını bozmadan sayfayı canlı tutmak. Kartlar beyaz olduğu için zemin biraz
        koyulaşırsa kontrast kartların lehine artıyor.

        Bileşen tek yerde olduğu için üç bölüm de kendiliğinden aynı görünüyor — bölüm başına
        ayrı zemin yazılsaydı zamanla birbirinden ayrışırlardı.
      */}
      <div className="ps-bg" aria-hidden="true">
        <svg className="ps-bg-svg" viewBox="0 0 1440 620" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
          <defs>
            {/*
              Kırmızı temada zemin KIRMIZININ ÜSTÜNDE: kütleler beyaza, ızgara beyaza
              dönüyor ve opaklıklar yükseliyor. Açık temadaki kırmızı kütleler kırmızı
              zeminde görünmezdi.
            */}
            <radialGradient id={`psBlobA-${tema}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={kirmizi ? '#ffffff' : '#d71920'} stopOpacity={kirmizi ? '0.22' : '0.13'} />
              <stop offset="100%" stopColor={kirmizi ? '#ffffff' : '#d71920'} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`psBlobB-${tema}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={kirmizi ? '#ffd7a8' : '#ff8a6b'} stopOpacity={kirmizi ? '0.24' : '0.11'} />
              <stop offset="100%" stopColor={kirmizi ? '#ffd7a8' : '#ff8a6b'} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={`psBlobC-${tema}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={kirmizi ? '#ffffff' : '#3b82f6'} stopOpacity={kirmizi ? '0.14' : '0.07'} />
              <stop offset="100%" stopColor={kirmizi ? '#ffffff' : '#3b82f6'} stopOpacity="0" />
            </radialGradient>
            <pattern id={`psGrid-${tema}`} width="56" height="56" patternUnits="userSpaceOnUse">
              <path d="M56 0H0V56" fill="none" stroke={kirmizi ? '#ffffff' : '#d71920'} strokeOpacity={kirmizi ? '0.075' : '0.045'} strokeWidth="1" />
            </pattern>
          </defs>

          <rect className="ps-grid" x="-56" y="-56" width="1552" height="732" fill={`url(#psGrid-${tema})`} />

          <circle className="ps-blob ps-blob-a" cx="180" cy="140" r="300" fill={`url(#psBlobA-${tema})`} />
          <circle className="ps-blob ps-blob-b" cx="1260" cy="480" r="280" fill={`url(#psBlobB-${tema})`} />
          <circle className="ps-blob ps-blob-c" cx="760" cy="60" r="240" fill={`url(#psBlobC-${tema})`} />
        </svg>
      </div>

      <div className="wrap">
        <div className="product-slider-head">
          <div className="product-slider-titles">
            {badge && <span className="section-badge">{badge}</span>}
            <h2>{title}</h2>
            {subtitle && <p className="section-sub">{subtitle}</p>}
          </div>

          <div className="product-slider-controls">
            {viewAllLink && (
              <Link href={viewAllLink} className="textlink view-all-link">
                {viewAllText}
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </Link>
            )}

            <div className="slider-nav-arrows">
              <button
                type="button"
                className="slider-nav-btn prev"
                aria-label="Önceki ürünler"
                disabled={!canScrollLeft}
                onClick={() => scroll('left')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <button
                type="button"
                className="slider-nav-btn next"
                aria-label="Sonraki ürünler"
                disabled={!canScrollRight}
                onClick={() => scroll('right')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="product-slider-wrapper">
          <div className="product-slider-track" ref={scrollRef}>
            {items.map((item) => (
              <div key={item.stockCode} className="slider-item-wrap">
                <ProductCard item={item} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
