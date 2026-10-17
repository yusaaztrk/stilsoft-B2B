import type { ListingFilters } from '@/components/ProductListing'

/**
 * Liste sayfalarının adres parametrelerini okur.
 *
 * Üç sayfa (tüm ürünler, kategori, arama) aynı listeyi gösteriyor; süzgeç okumasını üç yerde
 * tekrarlamak, birinde eksik kalmasının en kolay yoluydu.
 *
 * Sayı olmayan ya da negatif değerler sessizce yok sayılıyor: adres çubuğuna elle "min=abc"
 * yazan biri hata ekranı değil, süzgeçsiz liste görmeli.
 */
export function parseListingFilters(params: {
  min?: string
  max?: string
  stokta?: string
  montaj?: string
}): ListingFilters {
  return {
    minFiyat: toPrice(params.min),
    maxFiyat: toPrice(params.max),
    stokta: params.stokta === '1' || params.stokta === 'true',
    montaj: params.montaj === '1' || params.montaj === 'true',
  }
}

function toPrice(value?: string): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return undefined
  return n
}

export function parsePage(value?: string): number {
  const n = Number(value ?? '1')
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1
}
