import { getStorefront } from '@/lib/api'

/*
  MÜŞTERİ YORUMLARI — PANELDEN, GERÇEK (2026-09-20).

  Eskiden koda gömülü 4 uydurma yorum, "4.9 / 1.200+ memnun müşteri" ve "Doğrulanmış Alıcı"
  rozeti vardı. Kıbrıs küçük; uydurma yorum fark edildiğinde güven bir daha gelmez. Artık
  yorumlar bayi panelinden girilir (E-Ticaret → Vitrin Yönetimi → Müşteri yorumları); liste
  boşsa bölüm HİÇ görünmez. Google yorum bağlantısı doluysa "Google'da okuyun" düğmesi çıkar —
  asıl kanıt orası.
*/
export default async function CustomerReviews() {
  const settings = await getStorefront()
  const reviews = (settings.testimonials ?? []).filter((r) => r.text?.trim() && r.name?.trim())
  const googleUrl = settings.googleReviewsUrl?.trim()

  if (reviews.length === 0 && !googleUrl) return null

  return (
    <section className="reviews-section" aria-label="Müşteri Değerlendirmeleri">
      <div className="wrap">
        <div className="reviews-head">
          <div className="reviews-titles">
            <span className="section-badge">MÜŞTERİLERİMİZ</span>
            <h2>KKTC’de Müşterilerimizin Deneyimleri</h2>
            <p className="section-sub">Teslimat ve montaj hizmetimiz hakkında müşterilerimizin kendi sözleri.</p>
          </div>
          {googleUrl && (
            <a className="btn btn-outline" href={googleUrl} target="_blank" rel="noopener noreferrer">
              Google’daki yorumları okuyun
            </a>
          )}
        </div>

        {reviews.length > 0 && (
          <div className="reviews-grid">
            {reviews.map((r, idx) => (
              <div key={idx} className="review-card">
                <div className="review-card-top">
                  <div className="review-avatar">{r.name.trim().charAt(0).toLocaleUpperCase('tr-TR')}</div>
                  <div className="review-author-meta">
                    <div className="review-author-name">
                      <strong>{r.name}</strong>
                    </div>
                    <span className="review-location">
                      {[r.location, r.date].filter((x) => x && x.trim()).join(' · ')}
                    </span>
                  </div>
                </div>

                <div className="review-stars-row">
                  {Array.from({ length: Math.min(5, Math.max(1, Number(r.rating ?? 5))) }).map((_, i) => (
                    <span key={i} className="star-icon">★</span>
                  ))}
                </div>

                <p className="review-text">“{r.text}”</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
