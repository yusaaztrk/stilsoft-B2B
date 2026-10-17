import type { Metadata } from 'next'
import Link from 'next/link'
import ProductListing from '@/components/ProductListing'
import { parseListingFilters, parsePage } from '@/lib/listing'

export const metadata: Metadata = {
  title: 'Haftanın Fırsatları — Özel İndirimli Ürünler',
  description:
    'STILSOFT DEMO haftanın en çok tercih edilen ankastre setleri, airfryer modelleri, dikey süpürgeleri ve küçük ev aletlerinde geçerli özel fırsatları keşfedin.',
}

type Query = {
  sayfa?: string
  sirala?: string
  min?: string
  max?: string
  stokta?: string
  montaj?: string
}

export default async function FirsatlarPage({
  searchParams,
}: {
  searchParams: Promise<Query>
}) {
  const params = await searchParams

  return (
    <div className="wrap">
      {/* Kırıntı Yolu */}
      <div className="crumbs">
        <Link href="/">Anasayfa</Link>
        <span>›</span>
        <span>Haftanın Fırsatları</span>
      </div>

      {/* Fırsatlar Özel Hero Banner */}
      <div className="deals-hero-banner">
        <div className="deals-hero-content">
          <div className="deals-flame-tag">
            <span>🔥</span>
            <span>Haftanın Öne Çıkan Kampanyaları</span>
          </div>
          <h1>Haftanın Fırsatları &amp; İndirimli Ürünler</h1>
          <p>
            KKTC genelinde en çok tercih edilen Stilsoft elektrikli ev aletleri, ankastre setler ve
            mutfak grubu ürünlerinde geçerli kaçırılmayacak fiyat avantajları.
          </p>
          <div className="deals-hero-perks">
            <div className="d-perk">
              <span className="d-icon">🚚</span>
              <span>Tüm KKTC'ye Ücretsiz Teslimat</span>
            </div>
            <div className="d-perk">
              <span className="d-icon">🛡️</span>
              <span>3 Yıl Resmi Distribütör Garantisi</span>
            </div>
            <div className="d-perk">
              <span className="d-icon">🔧</span>
              <span>Yetkili Servis Kurulum Desteği</span>
            </div>
          </div>
        </div>
      </div>

      {/* Ürün Listeleme & Filtreleme */}
      <ProductListing
        title="Haftanın Fırsatları"
        page={parsePage(params.sayfa)}
        sort={params.sirala ?? 'ad'}
        basePath="/firsatlar"
        filters={parseListingFilters(params)}
        campaignOnly
        emptyText="Şu anda süren bir kampanya yok. Yeni fırsatlar için bizi takip edin."

      />
    </div>
  )
}
