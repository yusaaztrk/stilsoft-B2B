import type { Metadata } from 'next'
import ProductListing from '@/components/ProductListing'
import { parseListingFilters, parsePage } from '@/lib/listing'

/**
 * Arama sonuçları indekslenmiyor: her sorgu için ayrı bir sayfa üretmek, arama motorunda
 * yüzlerce ince içerikli sayfaya yol açar ve sitenin genel kalite puanını düşürür.
 */
export const metadata: Metadata = {
  title: 'Arama Sonuçları',
  robots: { index: false, follow: true },
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sayfa?: string; sirala?: string; min?: string; max?: string; stokta?: string }>
}) {
  const params = await searchParams
  const term = (params.q ?? '').trim()

  return (
    <ProductListing
      title={term ? `"${term}" için sonuçlar` : 'Arama'}
      search={term || undefined}
      page={parsePage(params.sayfa)}
      sort={params.sirala ?? 'ilgi'}
      basePath="/arama"
      filters={parseListingFilters(params)}
      logSearch
    />
  )
}
