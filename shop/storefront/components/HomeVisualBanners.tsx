'use client'

import React from 'react'
import Image from 'next/image'

/*
 * NOT: `TripleVisualGrid` ve `DualVisualGrid` şu an ANASAYFADA KULLANILMIYOR (bkz. app/page.tsx).
 * Gerçek afişler 1920x700 ve içlerinde okunması gereken metin var; sayfa genişliğinin üçte
 * birine sığdırıldıklarında yazılar okunmuyor. Bileşenler duruyor ki kare/dikey görsel seti
 * hazırlandığında geri açılabilsinler — o zaman buradaki dosya adları o setle değiştirilmeli.
 */

/**
 * 1. Yatay Geniş Görsel Banner (Yazısız, saf görsel)
 */
export function WideVisualBanner({ imgSrc = '/banners/slider-ankastre-set.webp', alt = 'Stilsoft Mutfak Koleksiyonu' }: { imgSrc?: string; alt?: string }) {
  return (
    <section className="pure-visual-section wide-visual-wrap">
      <div className="wrap">
        <div className="pure-wide-banner">
          <Image
            src={imgSrc}
            alt={alt}
            width={1320}
            height={420}
            className="pure-visual-img"
            style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'cover' }}
            priority={false}
          />
        </div>
      </div>
    </section>
  )
}

/**
 * 2. 3x1 Görsel Grid (Yazısız, saf 3'lü görsel vitrini)
 */
export function TripleVisualGrid() {
  const images = [
    { src: '/banners/slider-gurmega.webp', alt: 'Stilsoft Airfryer Koleksiyonu' },
    { src: '/banners/slider-megatron-2.webp', alt: 'Stilsoft Dikey Süpürge Koleksiyonu' },
    { src: '/banners/slider-bikahve.webp', alt: 'Stilsoft İçecek ve Kahve Koleksiyonu' },
  ]

  return (
    <section className="pure-visual-section">
      <div className="wrap">
        <div className="pure-triple-grid">
          {images.map((item, idx) => (
            <div key={idx} className="pure-grid-item">
              <Image
                src={item.src}
                alt={item.alt}
                width={420}
                height={260}
                className="pure-visual-img"
                style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'cover' }}
                loading="lazy"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/**
 * 3. 2x1 İkili Görsel Grid (Yazısız, saf 2'li görsel vitrini)
 */
export function DualVisualGrid() {
  const images = [
    { src: '/banners/slider-ankastre-set.webp', alt: 'Stilsoft Ankastre Koleksiyonu' },
    { src: '/banners/slider-bikahve.webp', alt: 'Stilsoft Kahve ve Çay Serisi' },
  ]

  return (
    <section className="pure-visual-section">
      <div className="wrap">
        <div className="pure-dual-grid">
          {images.map((item, idx) => (
            <div key={idx} className="pure-grid-item">
              <Image
                src={item.src}
                alt={item.alt}
                width={640}
                height={340}
                className="pure-visual-img"
                style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'cover' }}
                loading="lazy"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
