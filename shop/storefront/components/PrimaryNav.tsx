'use client'

import Image from 'next/image'
import CategoryIcon from '@/components/CategoryIcon'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { CatalogCategory } from '@/lib/api'
import { mediaUrl } from '@/lib/format'
import { MEGA_NAV_DATA } from '@/lib/navigationData'

export default function PrimaryNav({
  categories,
}: {
  categories: CatalogCategory[]
}) {
  const pathname = usePathname()
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Öncelikli kategori listesi
  const topCategories = [
    { slug: 'ankastre', name: 'Ankastre', badge: 'Popüler' },
    { slug: 'gida-hazirlama', name: 'Gıda Hazırlama', badge: 'Trend' },
    { slug: 'icecek-hazirlama', name: 'İçecek Hazırlama' },
    { slug: 'ev-temizligi', name: 'Ev Temizliği & Ütü' },
    { slug: 'buzdolabi', name: 'Soğutma & Beyaz Eşya' },
    { slug: 'kisisel-bakim', name: 'Kişisel Bakım' },
  ]

  // Sayfa değişince menüyü kapat
  useEffect(() => {
    setActiveMenu(null)
  }, [pathname])

  const handleMouseEnter = (key: string) => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
    setActiveMenu(key)
  }

  const handleMouseLeave = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setActiveMenu(null)
    }, 150)
  }

  const currentMegaData = activeMenu && activeMenu !== 'all' ? MEGA_NAV_DATA[activeMenu] : null

  return (
    <div
      className="primary-nav-wrapper"
      ref={wrapRef}
      onMouseLeave={handleMouseLeave}
    >
      <nav className="primary-nav-bar" aria-label="Ana Kategoriler">
        {/* Tüm Kategoriler Butonu */}
        <button
          type="button"
          className={`nav-item-btn all-cat-btn ${activeMenu === 'all' ? 'active' : ''}`}
          onMouseEnter={() => handleMouseEnter('all')}
          onClick={() => setActiveMenu(activeMenu === 'all' ? null : 'all')}
          aria-expanded={activeMenu === 'all'}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span>Tüm Kategoriler</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="chevron-icon"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {/* Ana Ürün Grupları */}
        {topCategories.map((item) => {
          const isActive = pathname.startsWith(`/kategori/${item.slug}`)
          const isHovered = activeMenu === item.slug

          return (
            <div
              key={item.slug}
              className="nav-item-anchor-wrap"
              onMouseEnter={() => handleMouseEnter(item.slug)}
            >
              <Link
                href={`/kategori/${item.slug}`}
                className={`nav-item-link ${isActive ? 'current-page' : ''} ${isHovered ? 'hovered' : ''}`}
              >
                <span>{item.name}</span>
                {item.badge && <span className="nav-item-badge">{item.badge}</span>}
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  className="chevron-icon"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </Link>
            </div>
          )
        })}

        {/* Fırsatlar Rozeti */}
        <Link href="/firsatlar" className="nav-item-link nav-deal-link">
          <span>Haftanın Fırsatları</span>
        </Link>
      </nav>

      {/* MEGA MENÜ AÇILIR PANEL */}
      {activeMenu && (
        <div
          className="mega-dropdown-overlay"
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
          }}
          onMouseLeave={handleMouseLeave}
        >
          <div className="wrap mega-dropdown-inner">
            {activeMenu === 'all' ? (
              /* TÜM KATEGORİLER İÇERİĞİ */
              <div className="mega-all-categories-panel">
                <div className="mega-panel-header">
                  <h3>Tüm Stilsoft KKTC Ürün Kategorileri</h3>
                  <Link href="/urunler" className="view-all-link">
                    Tüm 120+ Ürünü Listele
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </Link>
                </div>
                <div className="mega-all-grid">
                  {/*
                    BAŞ HARF YERİNE SİMGE (2026-09-21 kullanıcı isteği: "başlıklara birer
                    ikon bul koy").

                    2026-09-09'da kartlarda baş harf ("A", "GH", "BM") yazıyordu; ondan
                    önce de 48x48 görseller vardı ve güvenilmezdi (kırpılmış ürün fotoğrafı,
                    karşılığı olmayan kategoride kırık görsel). Artık satır içi SVG simge:
                    yüklenecek dosya yok, kırılmaz, her boyutta net.

                    Eşlemede olmayan kategori BOŞ KALMIYOR, baş harf yedeğine düşüyor —
                    ERP'ye yeni kategori eklenince kart yine dolu görünür (bkz. CategoryIcon).
                  */}
                  {categories.map((c) => (
                    <Link key={c.slug} href={`/kategori/${c.slug}`} className="mega-category-card">
                      <span className="cat-card-simge" aria-hidden="true">
                        <CategoryIcon name={c.name} slug={c.slug} className="cat-simge-svg" />
                      </span>
                      <div className="cat-card-info">
                        <span className="cat-title">{c.name}</span>
                        <span className="cat-count num">{c.productCount} Ürün</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ) : currentMegaData ? (
              /* ÖZEL KATEGORİ MEGA MENÜ İÇERİĞİ */
              <div className="mega-category-content-panel">
                {/* Sol & Orta Kolonlar: Alt Kategoriler & Gruplar */}
                <div className="mega-groups-grid">
                  {currentMegaData.groups.map((group, gIdx) => (
                    <div key={gIdx} className="mega-group-col">
                      <h4 className="mega-group-heading">{group.heading}</h4>
                      <ul className="mega-sub-list">
                        {group.items.map((sub, sIdx) => (
                          <li key={sIdx}>
                            <Link href={sub.href} className="mega-sub-link">
                              <span>{sub.title}</span>
                              {sub.badge && <span className="sub-badge">{sub.badge}</span>}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                {/* Sağ Kolon: Görsel Promo Kartı */}
                {currentMegaData.promo && (
                  <div className="mega-promo-card">
                    {currentMegaData.promo.badgeText && (
                      <span className="promo-pill">{currentMegaData.promo.badgeText}</span>
                    )}
                    <div className="promo-img-wrap">
                      {mediaUrl(currentMegaData.promo.imageUrl) && (
                        <Image
                          src={mediaUrl(currentMegaData.promo.imageUrl)!}
                          alt={currentMegaData.promo.title}
                          fill
                          sizes="280px"
                          className="promo-img"
                        />
                      )}
                    </div>
                    <div className="promo-content">
                      <span className="promo-tag">{currentMegaData.promo.tag}</span>
                      <h4 className="promo-title">{currentMegaData.promo.title}</h4>
                      <p className="promo-desc">{currentMegaData.promo.subtitle}</p>
                      <Link href={currentMegaData.promo.link} className="promo-cta-btn">
                        <span>Ürünleri İncele</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
