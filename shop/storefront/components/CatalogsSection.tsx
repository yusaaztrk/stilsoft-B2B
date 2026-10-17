import type { PdfCatalog } from '@/lib/api'
import CatalogThumbnail from '@/components/CatalogThumbnail'

/**
 * Anasayfadaki "Kataloglarımız" bölümü. B2B panelinden (E-Ticaret > Kataloglar) yüklenen
 * PDF'leri listeler; hiç katalog yoksa bölüm hiç render edilmez (aynı kural PosterRail'de
 * de var — boş bölüm göstermek yerine hiç göstermemek).
 */
export default function CatalogsSection({ catalogs }: { catalogs: PdfCatalog[] }) {
  if (catalogs.length === 0) return null

  return (
    <section className="block catalogs-section" aria-label="Kataloglarımız">
      <div className="wrap">
        <div className="block-head">
          <div>
            <span className="section-badge">PDF KATALOG</span>
            <h2>Kataloglarımız</h2>
            <p>Ürün gamımızın tamamını tek dosyada inceleyin</p>
          </div>
        </div>

        <div className="catalogs-grid">
          {catalogs.map((c) => (
            <a
              key={c.id}
              href={c.pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="catalog-card"
            >
              <CatalogThumbnail pdfUrl={c.pdfUrl} title={c.title} />
              <span className="catalog-card-title">{c.title}</span>
              <span className="catalog-card-cta">
                PDF Görüntüle
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17 17 7M7 7h10v10" />
                </svg>
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
