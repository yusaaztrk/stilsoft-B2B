import { mediaUrl } from './format'

export const CATEGORY_ICON_MAP: Record<string, string> = {
  'ankastre': '/categories/ankastre.jpg',
  'gida-hazirlama': '/categories/gida-hazirlama.jpg',
  'icecek-hazirlama': '/categories/icecek-hazirlama.jpg',
  'buzdolabi': '/categories/buzdolabi.jpg',
  'ev-gerecleri': '/categories/ev-gerecleri.jpg',
  'baza': '/categories/baza.jpg',
  'elektrikli-ev-aletleri': '/categories/elektrikli-ev-aletleri.jpg',
  'elektrikli-ev-aletleri2': '/categories/elektrikli-ev-aletleri.jpg',
  'kisisel-bakim': '/categories/kisisel-bakim.jpg',
  'baslik': '/categories/baza.jpg',
  'utu': '/categories/elektrikli-ev-aletleri.jpg',
  'derin-dondurucu': '/categories/buzdolabi.jpg',
  'su-sebili': '/categories/icecek-hazirlama.jpg',
  'silte': '/categories/baza.jpg',
  'ev-temizligi': '/categories/ev-gerecleri.jpg',
  'camasir-makinesi': '/categories/ankastre.jpg',
  'klima': '/categories/ev-gerecleri.jpg',
  'bulasik-makinesi': '/categories/ankastre.jpg',
  'ev-tekstili': '/categories/baza.jpg',
}

export function getCategoryVisual(slug: string, rawImageUrl?: string | null): string {
  const normSlug = (slug || '').toLowerCase().trim()
  if (CATEGORY_ICON_MAP[normSlug]) {
    return CATEGORY_ICON_MAP[normSlug]
  }
  const formatted = mediaUrl(rawImageUrl)
  if (formatted) return formatted
  return '/categories/ankastre.svg'
}
