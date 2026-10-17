import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { legacyProductIds, legacyQueryRedirects } from '@/lib/legacy-redirects'

/**
 * Eski OpenCart sitesinin sorgu bazlı adresleri (`/index.php?route=...&product_id=...` gibi).
 *
 * Bunlar next.config.ts'teki `redirects()` içinde DEĞİL, burada işleniyor. `redirects()`'te
 * `has` ile sorgu eşleştirilse hedefte kendi sorgu dizesi olmadıkça gelen isteğin TAMAMI
 * (`?route=product%2Fproduct&product_id=277` gibi) hedefe ekleniyor — Next.js bunu belgeli
 * ve engellenemez bir davranış olarak tanımlıyor (2026-09-05 denetiminde bulundu). Proxy
 * içinde `NextResponse.redirect` ile hedef URL'i baştan kendimiz kurduğumuz için hiçbir eski
 * sorgu parametresi sızmıyor — ziyaretçi temiz `/urun/...` veya `/kategori/...` adresine iner.
 *
 * Yalnızca `/index.php` isteklerinde çalışır (bkz. `config.matcher`); sitenin geri kalanına
 * dokunmuyor.
 */
export function proxy(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const route = searchParams.get('route')
  if (!route) return NextResponse.next()

  let destination: string | null = null

  if (route === 'product/product') {
    const id = searchParams.get('product_id')
    if (id && legacyProductIds[id]) destination = `/urun/${legacyProductIds[id]}`
  } else {
    const match = legacyQueryRedirects.find(
      (r) => r.route === route && searchParams.get(r.param) === r.value
    )
    if (match) destination = match.destination
  }

  if (!destination) return NextResponse.next()

  const url = request.nextUrl.clone()
  url.pathname = destination
  url.search = ''
  return NextResponse.redirect(url, 308)
}

export const config = {
  matcher: '/index.php',
}
