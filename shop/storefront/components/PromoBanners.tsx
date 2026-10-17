import Image from 'next/image'
import Link from 'next/link'
import { mediaUrl } from '@/lib/format'

export default function PromoBanners() {
  const banners = [
    {
      id: 'promo-ankastre',
      tag: 'MUTFAKTA ZARAFET',
      title: 'Ankastre Fırın & Setler',
      subtitle: 'Geniş hacim, turbo pişirme ve 3 camlı emniyetle mutfağınızı yenileyin.',
      cta: 'Setleri İncele',
      link: '/kategori/ankastre',
      imageUrl: '/uploads/products/06dfbaa575fc4899b30e0480c7a9458e.webp',
      featured: true,
      color: 'dark',
    },
    {
      id: 'promo-airfryer',
      tag: 'HAFİF & LEZZETLİ',
      title: 'Airfryer & Gıda Hazırlama',
      subtitle: '8 programlı dokunmatik Airfryer ve güçlü blender setleri.',
      cta: 'Ürünleri Gör',
      link: '/kategori/gida-hazirlama',
      imageUrl: '/uploads/products/91b9a1d829024ab88eb973c5bd59ab31.webp',
      featured: false,
      color: 'light',
    },
    {
      id: 'promo-icecek',
      tag: 'GÜNÜN KEYFİ',
      title: 'Çay & Kahve Makineleri',
      subtitle: 'Paslanmaz çelik çay makineleri ve filtre/Türk kahvesi lezzeti.',
      cta: 'Keşfet',
      link: '/kategori/icecek-hazirlama',
      imageUrl: '/uploads/products/29491381d1ca4364988e417a89beace0.webp',
      featured: false,
      color: 'light',
    },
    {
      id: 'promo-temizlik',
      tag: 'YÜKSEK EMİŞ GÜCÜ',
      title: 'Kablosuz Dikey Süpürgeler',
      subtitle: 'BLDC dijital motor ile 60 dakika kesintisiz ve sessiz temizlik.',
      cta: 'Modelleri Gör',
      link: '/kategori/ev-temizligi',
      imageUrl: '/uploads/products/0e5092ffc7534dc893c5e61e33abf632.webp',
      featured: false,
      color: 'light',
    },
  ]

  return (
    <section className="promo-banners-block">
      <div className="wrap">
        <div className="promo-banners-grid">
          {banners.map((b) => (
            <Link
              key={b.id}
              href={b.link}
              className={`promo-banner-card ${b.featured ? 'featured' : ''} ${b.color}`}
            >
              <div className="promo-banner-content">
                <span className="promo-banner-tag">{b.tag}</span>
                <h3 className="promo-banner-title">{b.title}</h3>
                <p className="promo-banner-sub">{b.subtitle}</p>
                <span className="promo-banner-cta">
                  <span>{b.cta}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </span>
              </div>

              <div className="promo-banner-img-wrap">
                {b.imageUrl && mediaUrl(b.imageUrl) ? (
                  <Image
                    src={mediaUrl(b.imageUrl)!}
                    alt={b.title}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 400px"
                    loading="lazy"
                    className="promo-banner-img"
                  />
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
