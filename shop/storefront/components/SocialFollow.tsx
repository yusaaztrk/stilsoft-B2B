import type { ReactNode } from 'react'

/*
  SOSYAL MEDYA TAKİP BLOĞU (2026-09-21 kullanıcı isteği: "alt tarafa bir div daha yap,
  sosyal medya hesaplarımızı takip edin diye, güzel efektli").

  NEDEN SAYFANIN SONUNDA: buraya kadar inen ziyaretçi ilgileniyor ama bu ziyarette satın
  almayabilir. Takip, o ziyaretçiyi ELDE TUTMANIN reklam parası harcamayan tek yolu —
  bir dahaki kampanyada karşısına ücretsiz çıkıyorsun.

  BAĞLANTILAR PANELDEN: adresler `StorefrontSettings` içinde (Firma & İletişim). Kodda
  sabitlenseydi hesap adı değiştiğinde vitrin yanlış yere gönderirdi. Adresi boş olan kanal
  HİÇ ÇİZİLMİYOR — çalışmayan bir "takip et" düğmesi, hiç düğme olmamasından kötü.

  Sunucu bileşeni: içinde durum yok, hepsi düz bağlantı.
*/

type Kanal = {
  ad: string
  url: string
  kullanici?: string
  sinif: string
  ikon: ReactNode
}

export default function SocialFollow({
  instagram,
  facebook,
  youtube,
  whatsapp,
}: {
  instagram?: string
  facebook?: string
  youtube?: string
  /** Panelden gelen WhatsApp numarası (yalnız rakam); boşsa kanal çizilmez. */
  whatsapp?: string
}) {
  const waDijit = (whatsapp ?? '').replace(/\D/g, '')

  const kanallar: Kanal[] = []

  if (instagram?.trim()) {
    kanallar.push({
      ad: 'Instagram',
      url: instagram.trim(),
      kullanici: '@example',
      sinif: 'sm-instagram',
      ikon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.6" cy="6.4" r="1" fill="currentColor" stroke="none" />
        </svg>
      ),
    })
  }

  if (facebook?.trim()) {
    kanallar.push({
      ad: 'Facebook',
      url: facebook.trim(),
      kullanici: 'StilsoftKKTC',
      sinif: 'sm-facebook',
      ikon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M14 9V7.2c0-.8.2-1.2 1.4-1.2H17V3h-2.6C11.6 3 10.6 4.4 10.6 6.9V9H8.5v3h2.1v9H14v-9h2.6l.4-3z" />
        </svg>
      ),
    })
  }

  if (youtube?.trim()) {
    kanallar.push({
      ad: 'YouTube',
      url: youtube.trim(),
      kullanici: '@StilsoftKKTC',
      sinif: 'sm-youtube',
      ikon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="5" width="20" height="14" rx="4" />
          <path d="M10.5 9.2v5.6l4.6-2.8z" fill="currentColor" stroke="none" />
        </svg>
      ),
    })
  }

  if (waDijit) {
    kanallar.push({
      ad: 'WhatsApp',
      url: `https://wa.me/${waDijit}`,
      kullanici: 'Anında cevap',
      sinif: 'sm-whatsapp',
      ikon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M17.5 14.4c-.3-.1-1.8-.9-2-1s-.5-.1-.7.1-.8 1-1 1.2-.3.2-.6.1c-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1s0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5s0-.4 0-.5-.7-1.6-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4s-1 1-1 2.5 1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4s-.3-.2-.6-.4M12 2a10 10 0 0 0-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1 0 12 2" />
        </svg>
      ),
    })
  }

  // Hiçbir kanal tanımlı değilse bölüm hiç çizilmiyor.
  if (kanallar.length === 0) return null

  return (
    <section className="sosyal" aria-label="Sosyal medya hesaplarımız">
      {/* Animasyonlu zemin — dekoratif. */}
      <div className="sosyal-zemin" aria-hidden="true">
        <span className="sosyal-isik sosyal-isik-1" />
        <span className="sosyal-isik sosyal-isik-2" />
        <span className="sosyal-isik sosyal-isik-3" />
      </div>

      <div className="wrap sosyal-icerik">
        <div className="sosyal-basliklar">
          <span className="sosyal-rozet">BİZİ TAKİP EDİN</span>
          <h2>Kampanyaları ilk siz görün</h2>
          <p>
            Yeni ürünler, indirim günleri ve KKTC&apos;ye özel fırsatlar önce sosyal medya
            hesaplarımızda duyuruluyor.
          </p>
        </div>

        <div className="sosyal-kartlar">
          {kanallar.map((k) => (
            <a
              key={k.ad}
              className={`sosyal-kart ${k.sinif}`}
              href={k.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="sosyal-ikon">{k.ikon}</span>
              <span className="sosyal-metin">
                <b>{k.ad}</b>
                {k.kullanici && <span>{k.kullanici}</span>}
              </span>
              <span className="sosyal-ok" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17 17 7M9 7h8v8" />
                </svg>
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
