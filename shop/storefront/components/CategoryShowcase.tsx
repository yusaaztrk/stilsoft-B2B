import Link from 'next/link'
import { Playfair_Display } from 'next/font/google'
import type { CatalogCategory } from '@/lib/api'

/**
 * Bölüme özel ikinci bir yazı ailesi. Kategori adlarının ikinci kelimesi bununla
 * yazılıyor: tek yazı ailesiyle kurulmuş bir ızgara "liste" gibi duruyordu, iki ailenin
 * karşıtlığı (kalın grotesk + italik serif) aynı metni vitrin başlığına çeviriyor.
 *
 * TEK EK YAZI AİLESİ: her ek font ilk boyamayı geciktirir. İki ağırlık, yalnız bu bölüm.
 */
const playfair = Playfair_Display({
  subsets: ['latin', 'latin-ext'],
  weight: ['500', '600'],
  style: ['italic'],
  display: 'swap',
  variable: '--font-playfair',
})

/**
 * KATEGORİ VİTRİNİ — animasyonlu SVG zeminli koyu şerit.
 *
 * NEDEN SVG ZEMİN: bölümün arkasında hareket eden şey bir GÖRSEL DEĞİL, vektör. Sebebi
 * pratik: kategori sayısı ve ekran genişliği değiştikçe zemin de esniyor, hiçbir ölçüde
 * kırpılmıyor ve kilobayt maliyeti yok. Aynı etkiyi bir arka plan fotoğrafıyla kurmak
 * her kırılım için ayrı dosya isterdi.
 *
 * ANİMASYON CSS'TE, JS YOK: bileşen sunucu bileşeni olarak kalıyor (istemciye JavaScript
 * inmiyor). Hareket azaltma tercihinde animasyonlar duruyor (globals.css).
 *
 * ADLAR İKİYE BÖLÜNÜYOR: ilk kelime kalın grotesk, kalanı italik serif. Kategori adı tek
 * kelimeyse ikinci parça boş kalır ve kutu yine düzgün görünür.
 */
export default function CategoryShowcase({
  categories,
  title = 'Kategoriye Göre Alışveriş',
  subtitle = 'Eviniz için ihtiyacınız olan tüm Stilsoft ürün grupları',
  badge = 'TÜM KATEGORİLER',
  limit = 8,
}: {
  categories: CatalogCategory[]
  title?: string
  subtitle?: string
  badge?: string
  limit?: number
}) {
  const items = categories.slice(0, limit)
  if (items.length === 0) return null

  return (
    <section className={`cat-showcase ${playfair.variable}`} aria-label={title}>
      {/* Animasyonlu zemin — tamamı dekoratif, ekran okuyucudan gizli. */}
      <div className="cat-showcase-bg" aria-hidden="true">
        <svg
          className="cat-showcase-svg"
          viewBox="0 0 1440 720"
          preserveAspectRatio="xMidYMid slice"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <radialGradient id="csBlobA" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#d71920" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#d71920" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="csBlobB" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ff5a3c" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#ff5a3c" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="csBlobC" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="csRay" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="50%" stopColor="#ffffff" stopOpacity="0.07" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
            <pattern id="csGrid" width="56" height="56" patternUnits="userSpaceOnUse">
              <path d="M56 0H0V56" fill="none" stroke="#ffffff" strokeOpacity="0.045" strokeWidth="1" />
            </pattern>
          </defs>

          {/* Izgara — çok yavaş kayıyor, derinlik hissi veriyor */}
          <rect className="cs-grid" x="-56" y="-56" width="1552" height="832" fill="url(#csGrid)" />

          {/* Süzülen ışık kütleleri */}
          <circle className="cs-blob cs-blob-a" cx="240" cy="200" r="330" fill="url(#csBlobA)" />
          <circle className="cs-blob cs-blob-b" cx="1180" cy="520" r="300" fill="url(#csBlobB)" />
          <circle className="cs-blob cs-blob-c" cx="820" cy="120" r="260" fill="url(#csBlobC)" />

          {/* Çapraz ışık huzmeleri */}
          <g className="cs-rays">
            <rect className="cs-ray cs-ray-1" x="-400" y="-200" width="180" height="1200" fill="url(#csRay)" transform="rotate(18)" />
            <rect className="cs-ray cs-ray-2" x="-100" y="-200" width="120" height="1200" fill="url(#csRay)" transform="rotate(18)" />
          </g>
        </svg>
      </div>

      <div className="wrap cat-showcase-inner">
        <header className="cat-showcase-head">
          <span className="cat-showcase-badge">{badge}</span>
          <h2 className="cat-showcase-title">{title}</h2>
          <p className="cat-showcase-sub">{subtitle}</p>
        </header>

        <div className="cat-showcase-grid">
          {items.map((c, i) => {
            const words = c.name.trim().split(/\s+/)
            const first = words[0] ?? c.name
            const rest = words.slice(1).join(' ')

            return (
              <Link
                key={c.slug}
                href={`/kategori/${c.slug}`}
                className="cat-tile"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <span className="cat-tile-no">{String(i + 1).padStart(2, '0')}</span>

                <span className="cat-tile-name">
                  <span className="cat-tile-w1">{first}</span>
                  {rest && <span className="cat-tile-w2">{rest}</span>}
                </span>

                <span className="cat-tile-foot">
                  <span className="cat-tile-count">{c.productCount} ürün</span>
                  <span className="cat-tile-arrow" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </span>
                </span>

                <span className="cat-tile-glow" aria-hidden="true" />
              </Link>
            )
          })}
        </div>

        <div className="cat-showcase-cta">
          <Link href="/urunler" className="cat-showcase-all">
            Tüm Kataloğu Gör
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  )
}
