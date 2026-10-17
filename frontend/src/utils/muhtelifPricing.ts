import type { PriceGroupDto } from '../api/priceGroups'

/**
 * Muhtelif (kayıtlı carisi olmayan) müşteriye fiyat teklifi verilirken kullanılacak fiyat grubu.
 *
 * Kullanıcı kararı (2026-08-11): eskiden 4 numaralı gruptan geliyordu, artık **1 numaralı grup**.
 *
 * Sunucudaki karşılığı `CariOffersController.MuhtelifPriceGroupCode` /
 * `CustomerOffersController.MuhtelifPriceGroupCode` — ÜÇÜ DE AYNI KALMALI. Ayrışırsa ekranda
 * gösterilen fiyat ile kaydedilen teklifin fiyatı birbirini tutmaz.
 */
export const MUHTELIF_PRICE_GROUP_CODE = 1

/**
 * Fiyat grubu listesinden muhtelif grubunun kimliğini bulur.
 *
 * Grubun KODUNA bakar, listedeki sırasına değil: sıraya göre seçmek (ör. "dördüncü olan")
 * grup eklenip çıkarıldığında sessizce başka bir gruba kayıyordu.
 */
export function resolveMuhtelifPriceGroupId(groups: PriceGroupDto[] | null | undefined): string | null {
  const match = (groups ?? []).find((g) => Number((g as any)?.code ?? 0) === MUHTELIF_PRICE_GROUP_CODE)
  const id = String((match as any)?.id ?? '').trim()
  return id || null
}
