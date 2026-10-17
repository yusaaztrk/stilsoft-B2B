/**
 * FİYAT 4 (F4) GRUBUNU BULMA — TEK KAYNAK.
 *
 * "Fiyat 4" tek bir kayıt değil: firmadan firmaya kodu 4 olan grup, adı "4-60" olan grup ya da
 * formülü `F4`'ten türeyen bir grup olabiliyor. Bu yüzden aday gruplar SIRALANIYOR ve en iyi
 * sıradaki kazanıyor.
 *
 * Sıralama, kullanıcının "buradaki method doğru" dediği Etiket Basım (Fiyatlı) ekranındaki
 * kuralın aynısıdır (2026-08-24). Kural üç ayrı dosyada kopyalanmış hâlde duruyordu; kopyalar
 * zamanla ayrışıp aynı ürüne farklı fiyat gösteriyordu.
 *
 *   0 → kodu 4 VE adı "4-60" (en kesin eşleşme)
 *   1 → adı "4-60"
 *   2 → kodu 4
 *   3 → adı 4 / 04 ile başlıyor
 *   4 → formülü F4'ten türüyor (`F4`, `F4*...`, `REMOVE_KDV(F4...`)
 */

export type F4PriceGroupLike = {
  id?: unknown
  code?: unknown
  name?: unknown
  formula?: unknown
}

export type F4ProductPriceLike = {
  productId?: unknown
  priceGroupId?: unknown
  price?: unknown
  currency?: unknown
}

export type F4Fiyat = { price: number; currency: string }

const kirp = (v: unknown) => String(v ?? '').trim()

/** Aday F4 gruplarını ve sıralarını döndürür. Aday yoksa boş nesne. */
export function f4GrupSiralamasi(priceGroups: F4PriceGroupLike[] | null | undefined): Record<string, number> {
  const siralar: Record<string, number> = {}

  ;(priceGroups ?? []).forEach((x) => {
    const id = kirp(x?.id)
    if (!id) return

    const kod = Number(x?.code ?? 0)
    const formul = kirp(x?.formula).toUpperCase()
    const ad = kirp(x?.name)
    const adKucuk = ad.toLowerCase()

    const tam60 = /^0?4\s*[-–]\s*60\b/.test(adKucuk) || (adKucuk.includes('60') && adKucuk.startsWith('4'))
    const adaGore4 = ad.startsWith('4') || ad.startsWith('04')

    // Metin bilerek parçalı yazılıyor: kaynakta bütün hâlde arandığında başka bir aracın
    // formül ayrıştırıcısına takılıyordu (eski ekranlarda da böyle yazılmış).
    const removeKdvOnEki = 'REMOVE_KDV' + '(F4'
    const f4Formulu = formul === 'F4' || formul.startsWith('F4*') || formul.startsWith(removeKdvOnEki)

    let sira: number | null = null
    if (kod === 4 && tam60) sira = 0
    else if (tam60) sira = 1
    else if (kod === 4) sira = 2
    else if (adaGore4) sira = 3
    else if (f4Formulu) sira = 4

    if (sira == null) return
    const onceki = siralar[id]
    if (onceki == null || sira < onceki) siralar[id] = sira
  })

  return siralar
}

/**
 * Ürün kimliği → F4 fiyatı haritası.
 *
 * Aynı ürünün birden çok aday grupta fiyatı olabilir; sırası en iyi olan kazanır.
 * Anahtar hem olduğu gibi hem küçük harfle yazılır: kimlikler kimi uçtan büyük, kimi
 * küçük harfli GUID olarak dönüyor ve düz eşleşme tutmuyordu.
 */
export function f4FiyatHaritasi(
  priceGroups: F4PriceGroupLike[] | null | undefined,
  prices: F4ProductPriceLike[] | null | undefined
): Record<string, F4Fiyat> {
  const siralar = f4GrupSiralamasi(priceGroups)
  if (Object.keys(siralar).length === 0) return {}

  const harita: Record<string, F4Fiyat> = {}
  const enIyiSira: Record<string, number> = {}

  ;(prices ?? []).forEach((pp) => {
    const urunId = kirp((pp as any)?.productId ?? (pp as any)?.productID)
    const grupId = kirp((pp as any)?.priceGroupId ?? (pp as any)?.priceGroupID)
    if (!urunId) return

    const sira = siralar[grupId]
    if (sira == null) return

    const onceki = enIyiSira[urunId]
    if (onceki != null && onceki <= sira) return
    enIyiSira[urunId] = sira

    const deger: F4Fiyat = { price: Number(pp?.price ?? 0), currency: kirp(pp?.currency) }
    harita[urunId] = deger
    const kucuk = urunId.toLowerCase()
    if (kucuk !== urunId) harita[kucuk] = deger
  })

  return harita
}

/** Haritadan ürünün F4 fiyatını okur (büyük/küçük harf farkını yutar). */
export function f4FiyatiOku(
  harita: Record<string, F4Fiyat>,
  productId: unknown
): F4Fiyat | undefined {
  const id = kirp(productId)
  if (!id) return undefined
  return harita[id] ?? harita[id.toLowerCase()]
}
