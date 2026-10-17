import Link from 'next/link'

export default function BrandStory() {
  return (
    <section className="brand-story-section">
      <div className="wrap">
        <div className="brand-story-card">
          {/*
            ANİMASYONLU ZEMİN (2026-09-09 kullanıcı isteği: "burayı da animasyonlu bir svg'ye
            çevir").

            Kart düz bir kırmızı dolguydu; sayfadaki en büyük renk bloğu olmasına rağmen
            hiçbir hareketi yoktu. Zemin `CategoryShowcase`teki dille AYNI: süzülen ışık
            kütleleri, çok yavaş kayan ızgara ve çapraz huzmeler — iki bölüm yan yana
            geldiğinde aynı tasarım ailesinden görünsünler diye.

            Tamamı dekoratif: `aria-hidden` ve `pointer-events: none`. Hareket, kullanıcı
            "azaltılmış hareket" tercih ediyorsa CSS tarafında duruyor (prefers-reduced-motion).
          */}
          <div className="brand-story-bg" aria-hidden="true">
            <svg
              className="brand-story-svg"
              viewBox="0 0 1440 560"
              preserveAspectRatio="xMidYMid slice"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <radialGradient id="bsBlobA" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.20" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="bsBlobB" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#ff8a6b" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#ff8a6b" stopOpacity="0" />
                </radialGradient>
                <radialGradient id="bsBlobC" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#7f0d1e" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#7f0d1e" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="bsRay" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
                  <stop offset="50%" stopColor="#ffffff" stopOpacity="0.10" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </linearGradient>
                <pattern id="bsGrid" width="56" height="56" patternUnits="userSpaceOnUse">
                  <path d="M56 0H0V56" fill="none" stroke="#ffffff" strokeOpacity="0.06" strokeWidth="1" />
                </pattern>
              </defs>

              <rect className="bs-grid" x="-56" y="-56" width="1552" height="672" fill="url(#bsGrid)" />

              <circle className="bs-blob bs-blob-a" cx="1150" cy="120" r="300" fill="url(#bsBlobA)" />
              <circle className="bs-blob bs-blob-b" cx="1290" cy="430" r="260" fill="url(#bsBlobB)" />
              <circle className="bs-blob bs-blob-c" cx="180" cy="480" r="320" fill="url(#bsBlobC)" />

              <g className="bs-rays">
                <rect className="bs-ray bs-ray-1" x="-300" y="-200" width="150" height="1000" fill="url(#bsRay)" transform="rotate(18)" />
                <rect className="bs-ray bs-ray-2" x="-40" y="-200" width="90" height="1000" fill="url(#bsRay)" transform="rotate(18)" />
              </g>
            </svg>
          </div>

          <div className="brand-story-content">
            <span className="brand-story-badge">STILSOFT DEMO GÜVENCESİ</span>
            <h2 className="brand-story-title">Evinize Değer Katan Teknoloji &amp; Estetik Tasarım</h2>
            <p className="brand-story-desc">
              Stilsoft, mutfağınızdan yaşam alanlarınıza kadar her anınızı kolaylaştırmak için yenilikçi teknolojiyi şık çizgilerle buluşturuyor. KKTC genelinde yetkili satış, orijinal yedek parça ve profesyonel teknik servis güvencesiyle yanınızdayız.
            </p>

            <div className="brand-story-highlights">
              <div className="highlight-item">
                <div className="highlight-num">40+</div>
                <div className="highlight-label">Yıllık Tecrübe ve Mühendislik</div>
              </div>
              <div className="highlight-item">
                <div className="highlight-num">%100</div>
                <div className="highlight-label">Resmi Distribütör Garantisi</div>
              </div>
              <div className="highlight-item">
                <div className="highlight-num">24-48s</div>
                <div className="highlight-label">KKTC Geneli Hızlı Teslimat</div>
              </div>
            </div>

            <div className="brand-story-actions">
              <Link href="/servis" className="btn btn-story-primary">
                Yetkili Servis &amp; Kurulum Bilgisi
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </Link>
              <Link href="/iletisim" className="btn btn-story-outline">
                Mağaza &amp; İletişim
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
