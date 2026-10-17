import Link from 'next/link'
import type { CatalogCategory } from '@/lib/api'

// Kategori simgeleri/ikonları (SVG)
function getCategoryIcon(slug: string) {
  switch (slug) {
    case 'ankastre':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="12" cy="14" r="4" />
          <line x1="6" y1="7" x2="6.01" y2="7" />
          <line x1="10" y1="7" x2="10.01" y2="7" />
          <line x1="14" y1="7" x2="14.01" y2="7" />
          <line x1="18" y1="7" x2="18.01" y2="7" />
        </svg>
      )
    case 'gida-hazirlama':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2v4" />
          <path d="M12 18v4" />
          <path d="m4.93 4.93 2.83 2.83" />
          <path d="m16.24 16.24 2.83 2.83" />
          <path d="M2 12h4" />
          <path d="M18 12h4" />
          <path d="m4.93 19.07 2.83-2.83" />
          <path d="m16.24 7.76 2.83-2.83" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )
    case 'icecek-hazirlama':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
          <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
          <line x1="6" y1="2" x2="6" y2="4" />
          <line x1="10" y1="2" x2="10" y2="4" />
          <line x1="14" y1="2" x2="14" y2="4" />
        </svg>
      )
    case 'buzdolabi':
    case 'derin-dondurucu':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2" />
          <line x1="5" y1="10" x2="19" y2="10" />
          <line x1="9" y1="6" x2="9" y2="8" />
          <line x1="9" y1="14" x2="9" y2="17" />
        </svg>
      )
    case 'ev-temizligi':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21h18" />
          <path d="M5 21V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v14" />
          <path d="m10 9 4 4" />
          <path d="m14 9-4 4" />
        </svg>
      )
    case 'utu':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 17h16a2 2 0 0 0 2-2V9a4 4 0 0 0-4-4H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2Z" />
          <path d="M8 5v12" />
        </svg>
      )
    case 'kisisel-bakim':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
        </svg>
      )
    default:
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
      )
  }
}

export default function CategoryPills({ categories }: { categories: CatalogCategory[] }) {
  if (!categories || categories.length === 0) return null

  return (
    <div className="cat-pills-bar">
      <div className="wrap">
        <div className="cat-pills-track" role="navigation" aria-label="Popüler Kategoriler">
          <Link href="/urunler" className="cat-pill all">
            <span className="cat-pill-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            </span>
            <span className="cat-pill-name">Tüm Ürünler</span>
          </Link>

          {categories.map((c) => (
            <Link key={c.slug} href={`/kategori/${c.slug}`} className="cat-pill">
              <span className="cat-pill-icon">{getCategoryIcon(c.slug)}</span>
              <span className="cat-pill-name">{c.name}</span>
              <span className="cat-pill-count num">{c.productCount}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
