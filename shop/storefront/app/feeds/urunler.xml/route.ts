import { getProduct, listProducts, type CatalogDetail, type CatalogItem } from '@/lib/api'
import { displayName, mediaUrl } from '@/lib/format'

/**
 * ÜRÜN FEED'İ — Google Merchant Center + Meta Katalog (2026-10-15).
 *
 * Adres: https://example.com/feeds/urunler.xml
 *
 * NEDEN: Google'daki görselli/fiyatlı Alışveriş reklamları ve Instagram/Facebook'ta "siteye
 * girip almadan çıkana o ürünü tekrar göster" (dinamik) reklamları bir ürün listesi istiyor.
 * Elle tutulan liste ilk fiyat değişikliğinde eskir ve reklamda yanlış fiyat çıkar — Google
 * bunu "fiyat uyuşmazlığı" sayıp ürünü reddediyor. Liste katalogdan canlı üretiliyor: ERP'de
 * fiyat/kampanya/stok değiştiğinde feed de değişir.
 *
 * BİÇİM: RSS 2.0 + Google `g:` alanları. Meta katalogu aynı biçimi okuyor, iki ayrı dosya
 * gerekmiyor.
 *
 * KAMPANYA: ERP'de kampanyalı üründe `g:price` eski (üstü çizili) fiyat, `g:sale_price`
 * kampanya fiyatı — reklamda indirim olarak gösteriliyor. Rakam vitrinde üretilmiyor, mağaza
 * API'sinin hesabı aynen kullanılıyor (bkz. lib/api.ts CatalogItem notu).
 *
 * Görseli olmayan ürün listeye girmiyor: iki platform da görselsiz ürünü reddediyor.
 */

export const dynamic = 'force-dynamic'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
const SAYFA_BOYU = 60
const ESZAMANLI = 6

const xml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // XML 1.0'da geçersiz kontrol karakterleri (ERP metinlerinden sızabiliyor) feed'i bozar.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

const fiyat = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2)} TRY`

const duzMetin = (html?: string | null) =>
  (html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/** GTIN yalnız 8/12/13/14 haneli ve kontrol hanesi doğruysa gönderilir; yanlış GTIN ürünü reddettirir. */
function gecerliGtin(raw?: string | null): string | null {
  const d = (raw ?? '').replace(/\D/g, '')
  if (![8, 12, 13, 14].includes(d.length)) return null
  const rakamlar = d.split('').map(Number)
  const kontrol = rakamlar.pop()!
  const toplam = rakamlar
    .reverse()
    .reduce((s, r, i) => s + r * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (toplam % 10)) % 10 === kontrol ? d : null
}

async function tumUrunler(): Promise<CatalogItem[]> {
  const ilk = await listProducts({ sayfa: 1, adet: SAYFA_BOYU, sirala: 'ad' })
  const sayfaSayisi = Math.min(50, Math.ceil(ilk.totalCount / SAYFA_BOYU))
  const kalan = await Promise.all(
    Array.from({ length: Math.max(0, sayfaSayisi - 1) }, (_, i) =>
      listProducts({ sayfa: i + 2, adet: SAYFA_BOYU, sirala: 'ad' }),
    ),
  )
  const hepsi = [ilk, ...kalan].flatMap((p) => p.items)
  // Sayfalar arasında aynı ürün iki kez gelirse (sıralama eşitliği) tek kayıt kalsın.
  return [...new Map(hepsi.map((u) => [u.stockCode, u])).values()]
}

/** Ayrıntı (açıklama, barkod, ek görseller) sınırlı eşzamanlılıkla; API'yi boğmamak için. */
async function ayrintilar(urunler: CatalogItem[]): Promise<Map<string, CatalogDetail>> {
  const sonuc = new Map<string, CatalogDetail>()
  let sira = 0
  async function isci() {
    while (sira < urunler.length) {
      const u = urunler[sira++]
      const d = await getProduct(u.slug)
      if (d) sonuc.set(u.stockCode, d)
    }
  }
  await Promise.all(Array.from({ length: ESZAMANLI }, isci))
  return sonuc
}

function urunXml(u: CatalogItem, d: CatalogDetail | undefined): string | null {
  const gorsel = mediaUrl(u.imageUrl)
  if (!gorsel || !(u.grossPrice > 0)) return null

  const ad = displayName(u.name).slice(0, 150)
  const aciklama =
    duzMetin(d?.description) ||
    (d?.features?.length ? d.features.join('. ') : '') ||
    `${ad}. KKTC geneli ücretsiz teslimat, 3 yıl resmi garanti.`

  const ekGorseller = (d?.images ?? [])
    .map((p) => mediaUrl(p))
    .filter((p): p is string => !!p && p !== gorsel)
    .slice(0, 10)

  const eski = Number(u.originalGrossPrice ?? 0)
  const kampanyali = eski > u.grossPrice
  const gtin = gecerliGtin(d?.barcode)

  const satirlar = [
    `<g:id>${xml(u.stockCode)}</g:id>`,
    `<g:title>${xml(ad)}</g:title>`,
    `<g:description>${xml(aciklama.slice(0, 5000))}</g:description>`,
    `<g:link>${xml(`${siteUrl}/urun/${u.slug}`)}</g:link>`,
    `<g:image_link>${xml(gorsel)}</g:image_link>`,
    ...ekGorseller.map((g) => `<g:additional_image_link>${xml(g)}</g:additional_image_link>`),
    `<g:availability>${u.inStock ? 'in_stock' : 'out_of_stock'}</g:availability>`,
    `<g:price>${fiyat(kampanyali ? eski : u.grossPrice)}</g:price>`,
    ...(kampanyali ? [`<g:sale_price>${fiyat(u.grossPrice)}</g:sale_price>`] : []),
    `<g:brand>Stilsoft</g:brand>`,
    `<g:mpn>${xml(u.stockCode)}</g:mpn>`,
    ...(gtin ? [`<g:gtin>${gtin}</g:gtin>`] : []),
    `<g:condition>new</g:condition>`,
    ...(u.categoryName ? [`<g:product_type>${xml(displayName(u.categoryName))}</g:product_type>`] : []),
    ...(u.campaignName ? [`<g:custom_label_0>${xml(u.campaignName.slice(0, 100))}</g:custom_label_0>`] : []),
    `<g:custom_label_1>${kampanyali ? 'kampanyali' : 'normal'}</g:custom_label_1>`,
  ]
  return `<item>${satirlar.join('')}</item>`
}

export async function GET() {
  const urunler = await tumUrunler()
  const detay = await ayrintilar(urunler)
  const items = urunler.map((u) => urunXml(u, detay.get(u.stockCode))).filter(Boolean)

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>` +
    `<title>Stilsoft KKTC</title><link>${xml(siteUrl)}</link>` +
    `<description>Stilsoft KKTC ürün listesi</description>` +
    items.join('\n') +
    `</channel></rss>`

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // Merchant Center ve Meta günde birkaç kez çekiyor; bir saatlik ara önbellek yeterli.
      'Cache-Control': 'public, max-age=900, s-maxage=3600',
    },
  })
}
