'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { formatPrice, mediaUrl } from '@/lib/format'

/*
  FİYAT KATALOGDAN GELİR (2026-09-21). Bu bloktaki fiyatlar koda gömülüydü ve üçü de eskimişti
  (4.500 yazıyor, ürün sayfası 4.900; 13.200 / 14.900; 8.400 / 9.600). Anasayfada "KKTC ÖZEL FİYAT
  4.500" görüp ürün sayfasında 4.900 gören müşteri kandırıldığını düşünür — hem güven kaybı hem
  yanıltıcı fiyat. Artık `stockCode` üzerinden canlı fiyat/adres/stok geliyor (`app/page.tsx`);
  ürün katalogda yoksa fiyat satırı hiç basılmaz, gömülü sayı asla gösterilmez.
*/
import type { SpotlightLive } from '@/lib/spotlight'

interface SpotlightItem {
  id: string
  badge: string
  kicker: string
  title: string
  desc: string
  /** Katalogdaki stok kodu; canlı fiyat ve adres buradan çözülür. Kategori kartında boş. */
  stockCode?: string
  features: string[]
  link: string
  imageUrl: string
  accentColor: string
}

const SPOTLIGHT_ITEMS: SpotlightItem[] = [
  {
    id: 'windy',
    stockCode: 'SBE92010',
    badge: 'WIFI INVERTER KLİMA',
    kicker: 'Yazın Serin, Kışın Ekonomik',
    title: 'ST-WINDY 12 BTU Inverter Klima WiFi',
    desc: 'Inverter teknolojisiyle sessiz ve düşük tüketimli çalışma. Telefonunuzdan açıp kapatın; eve gelmeden serinlesin.',
    features: ['WiFi ile uzaktan kontrol', 'Inverter teknolojisi', 'Montaj dahil', '3 yıl resmi garanti'],
    link: '/kategori/klima',
    imageUrl: '',
    accentColor: '#0369a1',
  },
  {
    id: 'bikahve',
    stockCode: 'SIH31231',
    badge: 'TÜRK KAHVESİ',
    kicker: 'Her Fincanda Aynı Kıvam',
    title: 'ST-Bikahve Pro Otomatik Türk Kahve Makinesi',
    desc: 'Tek dokunuşla otomatik pişirme, taşırmadan tam kıvamında köpük. Roze tasarımıyla tezgâhta durduğu yerde de güzel.',
    features: ['Otomatik pişirme', 'Taşırmayan kontrol', 'Özel roze tasarım', '3 yıl resmi garanti'],
    link: '/urun/st-bikahve-pro-otomatik-turk-kahve-makinesi-roze-sih31231',
    imageUrl: '',
    accentColor: '#b45309',
  },
  {
    id: 'jettmax',
    stockCode: 'SUT61070',
    badge: 'İKİSİ BİR ARADA',
    kicker: 'Ütü ve Buhar Tek Cihazda',
    title: 'ST-Jettmax Duo 2 Ürün 1 Arada Buharlı Ütü',
    desc: 'Klasik ütü ve dikey buhar aynı gövdede. Askıdaki gömleği indirmeden, koltuğu ve perdeyi yerinden kaldırmadan ütüleyin.',
    features: ['2 ürün 1 arada', 'Dikey buhar', 'Hızlı ısınma', '3 yıl resmi garanti'],
    link: '/urun/st-jettmax-duo-2-urun-1-arada-pratik-buharli-utu-sut61070',
    imageUrl: '',
    accentColor: '#0f766e',
  },
]

export default function ProductSpotlight({ live = {} }: { live?: Record<string, SpotlightLive> }) {
  const [activeTab, setActiveTab] = useState(0)
  const item = SPOTLIGHT_ITEMS[activeTab] ?? SPOTLIGHT_ITEMS[0]
  const canli = item.stockCode ? live[item.stockCode] : undefined
  const link = canli ? `/urun/${canli.slug}` : item.link

  return (
    <section className="product-spotlight-section">
      {/*
        ANİMASYONLU SVG ZEMİN (2026-09-21 kullanıcı isteği: "kırmızı arka planlı ama SVG
        animasyonlu bir şey yap, dikkat çeksin").

        Üç katman: çok yavaş kayan ızgara, süzülen iki ışık kütlesi ve ürünün arkasında
        nabız gibi genişleyen üç halka. Halkalar gecikmeli başlıyor, böylece sürekli bir
        dalga izlenimi veriyor ve gözü ürüne çekiyor.

        Tamamı dekoratif: `aria-hidden`, ekran okuyucuya hiçbir şey söylemiyor. Hareketi
        azalt tercihi açık olan kullanıcıda animasyonlar duruyor (CSS'te).
      */}
      <div className="sp-zemin" aria-hidden="true">
        <svg className="sp-zemin-svg" viewBox="0 0 1440 620" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <radialGradient id="spIsikA" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="spIsikB" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffd7a8" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#ffd7a8" stopOpacity="0" />
            </radialGradient>
            <pattern id="spIzgara" width="60" height="60" patternUnits="userSpaceOnUse">
              <path d="M60 0H0V60" fill="none" stroke="#ffffff" strokeOpacity="0.075" strokeWidth="1" />
            </pattern>
          </defs>

          <rect className="sp-grid-katman" x="-60" y="-60" width="1560" height="740" fill="url(#spIzgara)" />
          <circle className="sp-blob sp-blob-a" cx="180" cy="120" r="330" fill="url(#spIsikA)" />
          <circle className="sp-blob sp-blob-b" cx="1230" cy="470" r="300" fill="url(#spIsikB)" />

          {/* Nabız halkaları ürünün oturduğu sağ sütunun ortasına denk geliyor. */}
          <g transform="translate(1075 310)">
            <circle className="sp-halka" r="190" fill="none" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.6" />
            <circle className="sp-halka sp-halka-2" r="190" fill="none" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="1.4" />
            <circle className="sp-halka sp-halka-3" r="190" fill="none" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="1.2" />
          </g>
        </svg>
      </div>

      <div className="wrap">
        <div className="spotlight-head">
          <div className="spotlight-titles">
            <span className="section-badge">TEKNOLOJİ VE TASARIM</span>
            <h2>Öne Çıkan Ürün Deneyimi</h2>
            <p className="section-sub">Stilsoft inovasyonları ve evinize değer katan en popüler teknolojiler</p>
          </div>

          <div className="spotlight-tabs-bar">
            {SPOTLIGHT_ITEMS.map((tabItem, idx) => (
              <button
                key={tabItem.id}
                type="button"
                className={`spotlight-tab-btn ${idx === activeTab ? 'active' : ''}`}
                onClick={() => setActiveTab(idx)}
              >
                {tabItem.badge}
              </button>
            ))}
          </div>
        </div>

        <div className="spotlight-card">
          <div className="spotlight-grid">
            {/* Sol: Metin ve Özellikler */}
            <div className="spotlight-content">
              <span className="spotlight-kicker">{item.kicker}</span>
              <h3 className="spotlight-title">{item.title}</h3>
              <p className="spotlight-desc">{item.desc}</p>

              <div className="spotlight-features">
                {item.features.map((feat) => (
                  <span key={feat} className="spotlight-feat-chip">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    {feat}
                  </span>
                ))}
              </div>

              <div className="spotlight-bottom">
                {canli && (
                  <div className="spotlight-price-col">
                    <span className="spotlight-price-label">
                      {canli.originalPrice && canli.originalPrice > canli.price ? 'KAMPANYALI FİYAT' : 'KKTC FİYATI (KDV DAHİL)'}
                    </span>
                    <span className="spotlight-price-val">
                      {formatPrice(canli.price, canli.currency)}
                      {canli.originalPrice && canli.originalPrice > canli.price && (
                        <s className="spotlight-eski-fiyat">{formatPrice(canli.originalPrice, canli.currency)}</s>
                      )}
                    </span>
                    {!canli.inStock && <span className="spotlight-price-label">Şu an stokta yok</span>}
                  </div>
                )}

                <div className="spotlight-actions">
                  <Link href={link} className="btn-spotlight-primary">
                    <span>Ürünü İncele</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </Link>
                </div>
              </div>
            </div>

            {/* Sağ: Görsel Alanı */}
            <div className="spotlight-visual">
              <div className="spotlight-img-stage">
                {/*
                  GÖRSEL KATALOGTAN (2026-09-21). Gömülü yol yalnız yedek: öne çıkan ürün
                  değiştirilince fotoğraf eski üründe kalıyor ve kart yanlış cihazı
                  gösteriyordu. Fiyatlarda yaşanan sorunun aynısı.
                */}
                {mediaUrl(canli?.imageUrl || item.imageUrl) && (
                  <Image
                    src={mediaUrl(canli?.imageUrl || item.imageUrl)!}
                    alt={item.title}
                    fill
                    sizes="(max-width: 900px) 100vw, 480px"
                    className="spotlight-product-img"
                  />
                )}
                <div className="spotlight-badge-floating">
                  <span className="floating-dot" />
                  <span>KKTC Stoktan Hızlı Teslimat</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
