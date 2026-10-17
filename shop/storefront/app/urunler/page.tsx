import type { Metadata } from 'next'
import ProductListing from '@/components/ProductListing'
import { VARSAYILAN_SIRALAMA } from '@/components/ProductListing'
import { parseListingFilters, parsePage } from '@/lib/listing'

export const metadata: Metadata = {
  // "Tüm Ürünler" hiçbir aramanın karşılığı değildi; başlık artık aranan kelimeleri taşıyor
  // (aynı gerekçe: `lib/categorySeo.ts` dosya başı).
  title: 'Beyaz Eşya ve Ev Aletleri — Kıbrıs Fiyatları',
  description:
    'Kıbrıs’ta beyaz eşya, ankastre, televizyon, klima ve küçük ev aletlerinin tamamı. KDV dahil fiyatlar, KKTC geneline ücretsiz teslimat; ankastre ve beyaz eşyada ücretsiz montaj.',
  alternates: { canonical: '/urunler' },
}

type Query = { sayfa?: string; sirala?: string; min?: string; max?: string; stokta?: string }

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const params = await searchParams

  return (
    <ProductListing
      title="Tüm ürünler"
      page={parsePage(params.sayfa)}
      sort={params.sirala ?? VARSAYILAN_SIRALAMA}
      basePath="/urunler"
      filters={parseListingFilters(params)}
    />
  )
}
