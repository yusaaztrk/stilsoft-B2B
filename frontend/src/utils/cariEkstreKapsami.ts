import { API_BASE_URL } from '../config/api'

/**
 * CARİ EKSTRE TİP YETKİSİ (2026-10-11). Sunucudaki karşılığı
 * `backend/B2B.Erp.Api/Core/Helpers/CariEkstreKapsami.cs` — sınıflandırma ikisinde AYNI kalmalı.
 * Asıl kapı sunucuda (ekstre uçları 403 döner); burası yalnız seçim listesini süzer.
 */
export const CARI_EKSTRE_TIPLERI = [
  { key: 'bayi', label: 'Bayi', hint: '120-01 ve bayilerin şubeleri (01-…)' },
  { key: 'altbayi', label: 'Alt Bayi', hint: '120-02 / 120-10' },
  { key: 'musteri', label: 'Müşteri', hint: '120-03' },
  { key: 'magaza', label: 'Mağaza', hint: '120-04' },
  { key: 'tedarikci', label: 'Tedarikçi', hint: '320' },
  { key: 'diger', label: 'Diğer', hint: 'Hizmet, gider, çalışan, perakende vb.' }
] as const

export type CariEkstreTipi = (typeof CARI_EKSTRE_TIPLERI)[number]['key']

export const TUM_CARI_EKSTRE_TIPLERI: string[] = CARI_EKSTRE_TIPLERI.map((x) => x.key)

export function cariEkstreTipi(code: string | null | undefined, customerType: string | null | undefined, isSupplier = false): CariEkstreTipi {
  if (isSupplier) return 'tedarikci'
  const t = String(customerType ?? '').trim().toLocaleLowerCase('tr-TR')
  if (t) {
    if (t.includes('alt bayi') || t.includes('altbayi')) return 'altbayi'
    if (t.includes('bayi') || t === 'şube' || t === 'sube') return 'bayi'
    if (t.includes('müşteri') || t.includes('musteri')) return 'musteri'
    if (t.includes('mağaza') || t.includes('magaza')) return 'magaza'
  }
  const c = String(code ?? '').trim()
  if (c.startsWith('120-02') || c.startsWith('120-10')) return 'altbayi'
  if (c.startsWith('120-01') || c.startsWith('01-')) return 'bayi'
  if (c.startsWith('120-03')) return 'musteri'
  if (c.startsWith('120-04')) return 'magaza'
  if (c.startsWith('320')) return 'tedarikci'
  return 'diger'
}

/** Oturumdaki kullanıcının izinli tipleri; null = kısıtlama yok (ya da sunucu eski). */
export async function fetchCariEkstreKapsami(): Promise<string[] | null> {
  try {
    const token = localStorage.getItem('accessToken')
    const res = await fetch(`${API_BASE_URL}/api/customer-ledger/ekstre-kapsami`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
    if (!res.ok) return null
    const json = await res.json()
    const list = json?.data?.tipler
    return Array.isArray(list) ? list.map((x: any) => String(x)) : null
  } catch {
    return null
  }
}

/** Seçim listesini izinli tiplere süzer (allowed null = dokunma). */
export function filterCariOptionsByKapsam<T extends { code?: string; value?: string; customerType?: string; type?: string }>(
  options: T[],
  allowed: string[] | null
): T[] {
  if (!allowed) return options
  return options.filter((o) => allowed.includes(cariEkstreTipi(o.code ?? o.value, o.customerType, o.type === 'supplier')))
}
