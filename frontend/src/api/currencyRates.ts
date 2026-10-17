import { API_BASE_URL } from '../config/api'

/**
 * Güncel döviz kurları.
 *
 * Kredi ekranı döviz borçların TL karşılığını burada gösteriyor. Kur ANLIK çekiliyor ama
 * kullanıcı üzerine yazabiliyor: bankanın o gün uyguladığı kur TCMB kurundan farklı olabiliyor
 * ve "bu borç bugün kaç TL" sorusunun cevabı buna göre değişiyor.
 *
 * DİKKAT: ödenmiş taksitlerin TL karşılığı BURADAN HESAPLANMAZ. O tutarlar ödeme anındaki
 * kurdan dondurulmuş hâlde kayıtta duruyor (`paidTryAmount`). Güncel kurla yeniden hesaplamak
 * "bugüne kadar kasadan kaç TL çıktı" sorusuna yanlış cevap verirdi.
 */
export type CurrencyRateDto = {
  currencyCode: string
  buyingRate: number
  sellingRate: number
  effectiveBuyingRate: number
  effectiveSellingRate: number
  rateDate: string
  provider: string
}

export async function fetchCurrencyRates(opts?: { signal?: AbortSignal }): Promise<CurrencyRateDto[]> {
  const res = await fetch(`${API_BASE_URL}/api/currency/rates`, { signal: opts?.signal })
  if (!res.ok) return []
  const json = await res.json().catch(() => null)
  const data = json?.data
  return Array.isArray(data) ? (data as CurrencyRateDto[]) : []
}

/**
 * Kur listesini "para birimi kodu → TL karşılığı" tablosuna çevirir.
 *
 * SATIŞ kuru kullanılıyor: borcu kapatmak için döviz SATIN ALINIYOR, bankanın satış kuru
 * ödenecek gerçek maliyet. Alış kuru kullanılsaydı borç olduğundan ucuz görünürdü.
 */
export function toRateMap(rates: CurrencyRateDto[]): Record<string, number> {
  const map: Record<string, number> = { TRY: 1 }
  for (const r of rates) {
    const code = String(r.currencyCode ?? '').toUpperCase()
    if (!code) continue
    const value = Number(r.sellingRate) || Number(r.effectiveSellingRate) || 0
    if (value > 0) map[code] = value
  }
  return map
}
