/*
  GÜVEN ŞERİDİ.

  MOBİLDE KISA METİN (2026-09-21 kullanıcı isteği: "bu yazılar alt alta ilk girişi çok
  kapatıyor"). 540px altında dört madde TEK SÜTUNA iniyordu; başlık + açıklama dört kez
  alt alta gelince şerit 330px'i aşıyor ve afişin hemen altındaki bütün ekranı yiyordu.
  Telefonda ziyaretçi ürünü değil, dört paragraf vaadi görüyordu.

  Çözüm: aynı içerik telefonda 2x2 ızgarada ve KISA hâliyle. Her maddenin `kisa` karşılığı
  var; geniş ekranda uzun başlık ve açıklama, dar ekranda yalnız kısa etiket görünüyor.
  İkisi de DOM'da — gizleme yalnız medya sorgusuyla, yani masaüstünde hiçbir şey kaybolmuyor.
*/
export default function TrustBar() {
  const items = [
    {
      title: 'KKTC Geneli Ücretsiz Teslimat',
      kisa: 'Ücretsiz teslimat',
      desc: 'Lefkoşa, Girne, Gazimağusa, İskele ve tüm bölgelere adrese güvenli teslim.',
    },
    {
      title: '3 Yıl Resmi Garanti',
      kisa: '3 yıl garanti',
      desc: 'Stilsoft KKTC resmi distribütör güvencesi ve orijinal parça garantisi.',
    },
    {
      title: 'Yetkili Servis & Montaj',
      kisa: 'Ücretsiz montaj',
      desc: 'Ankastre ve beyaz eşyalarda uzman ekiplerimizle randevulu ücretsiz kurulum.',
    },
    {
      title: '3D Secure Güvenli Ödeme',
      kisa: 'Güvenli ödeme',
      desc: '256-Bit SSL şifreleme ve bankanızın sunduğu taksit seçenekleriyle güvenli kredi kartı ödemesi.',
    },
  ]

  return (
    <section className="trust-bar-section" aria-label="Müşteri Avantajları">
      <div className="wrap">
        <div className="trust-grid">
          {items.map((item, idx) => (
            <div key={idx} className="trust-item">
              <div className="trust-text">
                <h3 className="trust-title">{item.title}</h3>
                {/* Telefonda başlığın yerini alan kısa etiket. */}
                <span className="trust-kisa" aria-hidden="true">
                  {item.kisa}
                </span>
                <p className="trust-desc">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
