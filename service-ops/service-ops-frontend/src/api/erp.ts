import { apiFetch } from './client'

export type ErpUserDto = {
  id: number
  username: string
  email?: string | null
  firstName?: string | null
  lastName?: string | null
  isActive: boolean
  roleCode?: string | null
  roleName?: string | null
  tenantCode?: string | null
  createdAt?: string | null
}


function getFriendlyError(text: string, status: number) {
  const t = String(text ?? '').trim()
  if (!t) return `İşlem başarısız (${status})`

  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `İşlem başarısız (${status})`
    }
  }

  return t
}

export async function fetchErpUsers(signal?: AbortSignal): Promise<ErpUserDto[]> {
  const res = await apiFetch('/api/erp/users', {
    signal
  })

  const text = await res.text()

  if (!res.ok) {
    throw new Error(getFriendlyError(text, res.status))
  }

  try {
    const json = JSON.parse(text)
    const data = json?.data ?? json ?? []
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
export type ErpProductDto = {
  id: string
  name: string
  stockCode?: string
  isInstallable?: boolean
  groupCode?: string
  /** Ürün kartındaki montaj bedeli (KDV dahil, TL). Elle montaj kabulünde bayiye sipariş taslağı açar. */
  installationFee?: number
  /** Ürünün KDV oranı (%) — montaj bedelinin netini ayrıştırmak için. */
  taxRate?: number
}

/**
 * Montaj kaydına girilebilen ürün grupları: beyaz eşya ve yatak/baza.
 *
 * `isInstallable` bayrağı tek başına yetmiyor — veride yalnızca BYZ-ESYA ürünlerinde işaretli,
 * YATAKBAZA grubunun tamamı dışarıda kalıyor. Montaj kalemi seçiminde bu iki grup görünmeli,
 * genel DEMO grubu görünmemeli.
 */
export const MONTAJ_PRODUCT_GROUPS = ['BYZ-ESYA', 'YATAKBAZA']

export function isMontajProduct(p: ErpProductDto): boolean {
  const g = String(p.groupCode ?? '').trim().toUpperCase()
  return MONTAJ_PRODUCT_GROUPS.includes(g)
}

/**
 * Yedek parça ana kategorilerinin ortak öneki (`YED-STIL`, `YED-MUHT`).
 *
 * Arıza kabul ekranlarında ürün seçimi CİHAZ içindir; yedek parça oraya girmez. Katalogda
 * 1117 aktif ürünün 951'i yedek parça olduğu için süzülmediğinde liste pratikte yedek parça
 * listesine dönüşüyordu.
 */
export const YEDEK_PARCA_GROUP_PREFIX = 'YED'

export function isYedekParcaProduct(p: ErpProductDto): boolean {
  return String(p.groupCode ?? '').trim().toUpperCase().startsWith(YEDEK_PARCA_GROUP_PREFIX)
}

/**
 * Ürün kataloğu.
 *
 * `pageSize` 200 İKEN BEYAZ EŞYA ARIZA KABULÜNÜN ÜRÜN LİSTESİ HEP BOŞTU (2026-08-21).
 * Sebep sayfada değil burada: ERP listeyi ADA GÖRE sıralıyor ve ekran gelen listeyi
 * `isInstallable` ile süzüyor; ilk montajlı ürün ise 485. sırada. Yani ilk 200 kayıtta hiç
 * montajlı ürün yoktu ve kırpılma sessizdi — istek başarılı dönüyor, liste boş görünüyordu.
 * (Küçük Ürün Kabul bunu fark ettirmiyordu: onun süzgeci tersi olduğu için ilk 200 zaten
 * uyuyordu.)
 *
 * 2000, ERP'nin izin verdiği üst sınır (`ProductsController` maxPageSize) ve aktif ürün
 * sayısının üstünde. Katalog bunu aşarsa süzmeyi SUNUCUYA taşımak gerekir; sayfa boyutunu
 * büyütmek kalıcı çözüm değil.
 */
/*
  KATALOG TEK KEZ ÇEKİLİR (2026-08-26, ölçüm: Saha Arıza açılışı 4.5 MB / 7,57 sn).

  `/api/erp/products` ucu SAHA ARIZA sayfasında İKİ KEZ çağrılıyordu:
    - `fetchErpProducts`  → pageSize=2000 → 1,1 MB / 3,78 sn
    - `fetchStockItems`   → pageSize=5000 → 1,1 MB / 2,57 sn
  İkisi de aynı yanıtı alıyor: ERP `maxPageSize`'ı 2000'e kırpıyor
  (ProductsController), yani 5000 istemek 2000 getiriyor. Yaklaşık 1,1 MB ve 2,5 saniye
  tamamen mükerrerdi.

  Buradaki önbellek YALNIZCA tam katalog isteğini (arama/kategori süzgeci OLMAYAN) paylaşır:
  aynı anda gelen ikinci çağrı ilkinin sonucunu bekler, kısa süre içindeki tekrarlar da
  aynı sonucu kullanır. Süzgeçli aramalar önbelleğe hiç girmez — onlar zaten küçük ve
  kullanıcının yazdığı ana özgü.

  `signal` paylaşılan istekte KULLANILMAZ: bir bileşenin iptali diğerinin sonucunu
  düşürürdü. İptal eden taraf sonucu zaten yok sayar.
*/
type KatalogKaydi = { zaman: number; istek: Promise<any[]> }
const katalogOnbellek = new Map<string, KatalogKaydi>()
const KATALOG_TAZE_MS = 60_000

async function katalogGetir(qs: URLSearchParams): Promise<any[]> {
  let res: Response
  try {
    res = await apiFetch(`/api/erp/products?${qs}`)
  } catch (e) {
    console.error('[katalogGetir] Network error:', e)
    return []
  }
  const text = await res.text()
  if (!res.ok) { console.warn('[katalogGetir] Failed:', res.status, text.slice(0, 300)); return [] }
  try {
    const json = JSON.parse(text)
    const items: any[] = json?.data?.items ?? json?.items ?? []
    return Array.isArray(items) ? items : []
  } catch (e) { console.error('[katalogGetir] Parse error:', e); return [] }
}

/** Ham ürün satırları. Süzgeçsiz (tam katalog) çağrılar paylaşılır. */
export async function fetchErpProductsRaw(
  search?: string, main?: string, sub?: string, signal?: AbortSignal
): Promise<any[]> {
  const qs = new URLSearchParams({ pageSize: '2000', page: '1' })
  if (search) qs.set('q', search)
  if (main)   qs.set('main', main)
  if (sub)    qs.set('sub', sub)

  const tamKatalog = !search && !main && !sub
  if (!tamKatalog) {
    // Süzgeçli istek: paylaşma yok, iptal edilebilir kalsın.
    try {
      const res = await apiFetch(`/api/erp/products?${qs}`, { signal })
      const text = await res.text()
      if (!res.ok) return []
      const json = JSON.parse(text)
      const items: any[] = json?.data?.items ?? json?.items ?? []
      return Array.isArray(items) ? items : []
    } catch { return [] }
  }

  const anahtar = qs.toString()
  const simdi = Date.now()
  const kayit = katalogOnbellek.get(anahtar)
  if (kayit && simdi - kayit.zaman < KATALOG_TAZE_MS) return kayit.istek

  const istek = katalogGetir(qs)
  katalogOnbellek.set(anahtar, { zaman: simdi, istek })
  // Hata durumunda önbelleği kirletme: bir sonraki çağrı yeniden denesin.
  istek.catch(() => katalogOnbellek.delete(anahtar))
  return istek
}

export async function fetchErpProducts(signal?: AbortSignal, search?: string, main?: string, sub?: string): Promise<ErpProductDto[]> {
  try {
    const items = await fetchErpProductsRaw(search, main, sub, signal)
    return items
      .map((p: any) => ({
        id: String(p.id ?? ''),
        name: String(p.name ?? '').trim(),
        stockCode: p.stockCode,
        isInstallable: Boolean(p.isInstallable),
        groupCode: p.groupCode ? String(p.groupCode) : undefined,
        installationFee: p.installationFee != null ? Number(p.installationFee) : undefined,
        taxRate: p.taxRate != null ? Number(p.taxRate) : undefined
      }))
      .filter(p => p.name)
  } catch (e) { console.error('[fetchErpProducts] Parse error:', e); return [] }
}

/**
 * Montaj kaydı AÇILMADAN ÖNCE kredi limiti kontrolü. Bayinin limiti montaj bedelini
 * karşılamıyorsa `ok=false` döner ve istemci kaydı hiç oluşturmaz ("önce ödeme alın").
 * `hasFee=false` = montaj fiyatlı ürün yok, engel yok. Hiçbir şey yazmaz.
 */
export async function checkMontajBedeliLimit(
  cariKodu: string,
  items: Array<{ stokKodu: string; adet: number; musteriAdi?: string | null }>
): Promise<{
  ok: boolean
  hasFee: boolean
  code?: string
  data?: { creditLimit?: number; currencySymbol?: string; orderTotal?: number; projected?: number; requiredPayment?: number }
}> {
  const res = await apiFetch('/api/erp/montaj-bedeli-siparis/kontrol', {
    method: 'POST',
    body: JSON.stringify({ cariKodu, items })
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) throw new Error(unwrapMontajBedeliError(text, res.status))
  try {
    const j = JSON.parse(text)
    return { ok: j.ok !== false, hasFee: !!j.hasFee, code: j.code, data: j.data }
  } catch {
    return { ok: true, hasFee: false }
  }
}

/** Kredi limiti aşımı hatasını "önce ödeme alın" cümlesine çevirir. */
export function montajBedeliLimitMesaji(data: {
  creditLimit?: number
  currencySymbol?: string
  orderTotal?: number
  requiredPayment?: number
} | undefined): string {
  const d = data ?? {}
  const sym = d.currencySymbol ?? '₺'
  const fmt = (n: number) => `${sym}${Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const odeme = Number(d.requiredPayment ?? 0)
  return `Bu bayinin kredi limiti montaj bedelini (${fmt(d.orderTotal ?? 0)}) karşılamıyor `
    + `(limit ${fmt(d.creditLimit ?? 0)}). Montaj kaydı oluşturulmadı — `
    + `önce ${odeme > 0 ? fmt(odeme) : 'yeterli'} ödeme alın, sonra tekrar deneyin.`
}

/**
 * ELLE montaj kabul kaydı açıldıktan sonra çağrılır: montaj fiyatı tanımlı ürünler için
 * bayiye B2B'de BEKLEYEN sipariş taslağı oluşturur (fatura kesilmez, ofis dönüştürür).
 *
 * Best-effort: montaj kaydı zaten oluştu; bu çağrı başarısız olsa da kayıt geri alınmaz,
 * yalnızca uyarı gösterilir. `created=false` "bedeli olan ürün yoktu" demektir, hata değil.
 */
export async function createMontajBedeliSiparis(
  cariKodu: string,
  items: Array<{ stokKodu: string; adet: number; musteriAdi?: string | null }>
): Promise<{ success: boolean; created?: boolean; message?: string; data?: any }> {
  const res = await apiFetch('/api/erp/montaj-bedeli-siparis', {
    method: 'POST',
    body: JSON.stringify({ cariKodu, items })
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) throw new Error(unwrapMontajBedeliError(text, res.status))
  try { return JSON.parse(text) } catch { return { success: true } }
}

/**
 * Montaj bedeli hatasını okunabilir tek cümleye indirger.
 *
 * Zincir üç katman: ServiceOps vekili ProblemDetails sarar (`detail` = B2B'nin ham gövdesi),
 * B2B ise `{ success, code, message, data }` döner. Kredi limiti aşımı en olası hata:
 * `code = CREDIT_LIMIT_EXCEEDED` → bayinin limiti montaj bedelini karşılamıyor.
 */
function unwrapMontajBedeliError(text: string, status: number): string {
  let inner: any = null
  try {
    const outer = JSON.parse(text)
    // ProblemDetails.detail ham JSON metni taşıyor olabilir.
    if (typeof outer?.detail === 'string' && outer.detail.trim().startsWith('{')) {
      try { inner = JSON.parse(outer.detail) } catch { /* düz metin */ }
    }
    inner = inner ?? outer
  } catch {
    return text?.trim() || `Sipariş oluşturulamadı (${status}).`
  }

  const code = String(inner?.code ?? '')
  if (code === 'CREDIT_LIMIT_EXCEEDED') {
    const d = inner?.data ?? {}
    const sym = d.currencySymbol ?? '₺'
    const limit = Number(d.creditLimit ?? 0)
    const tutar = Number(d.orderTotal ?? d.projected ?? 0)
    return `Bayinin kredi limiti yetersiz — montaj bedeli siparişi oluşturulmadı. `
      + `Limit ${sym}${limit.toLocaleString('tr-TR')}, gereken ${sym}${tutar.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. `
      + `Montaj kaydı açıldı; bedeli limiti düzeltip Satış Faturası ekranından elle girebilirsiniz.`
  }

  return String(inner?.message ?? inner?.title ?? text?.trim() ?? '') || `Sipariş oluşturulamadı (${status}).`
}

export type ErpDealerType = 'bayi' | 'magaza' | 'musteri' | 'all'

export type ErpDealerDto = {
  customerCode: string
  name: string
  phone?: string
  address?: string
  city?: string
  district?: string
  taxNumber?: string
  customerType?: string
  /** Sipariş sayfasındaki kuralla hesaplanmış fatura tipi: FATURA | ACIK | ASKERİYE */
  invoiceType?: string
  priceGroupCode?: number | null
}

export async function fetchErpDealers(signal?: AbortSignal, search?: string, type: ErpDealerType = 'bayi'): Promise<ErpDealerDto[]> {
  const qs = new URLSearchParams({ type })
  if (search) qs.set('q', search)

  let res: Response
  try {
    res = await apiFetch(`/api/erp/dealers?${qs}`, {
      signal
    })
  } catch (e) {
    console.error('[fetchErpDealers] Network error:', e)
    return []
  }

  const text = await res.text()
  if (!res.ok) { console.warn('[fetchErpDealers] Failed:', res.status, text.slice(0, 300)); return [] }

  try {
    const json = JSON.parse(text)
    const items: any[] = json?.data?.items ?? json?.data ?? json?.items ?? []
    if (!Array.isArray(items)) return []
    return items
      .map((c: any) => ({
        customerCode: String(c.customerCode ?? c.customerNumber ?? c.code ?? c.id ?? ''),
        name: String(c.name ?? c.fullName ?? c.title ?? '').trim(),
        phone: c.phone || c.customerPhone || c.gsm || c.phone1 || '',
        address: c.address || c.customerAddress || c.address1 || c.addressDetail || '',
        city: c.city || '',
        district: c.district || '',
        taxNumber: c.taxNumber || '',
        customerType: c.customerType || '',
        invoiceType: c.invoiceType || '',
        priceGroupCode: typeof c.priceGroupCode === 'number' ? c.priceGroupCode : null
      }))
      .filter(c => c.name)
  } catch (e) { console.error('[fetchErpDealers] Parse error:', e); return [] }
}

export async function fetchErpCustomerDealers(signal?: AbortSignal, search?: string, type?: string): Promise<ErpDealerDto[]> {
  const qs = new URLSearchParams({ pageSize: '1000' })
  if (type) qs.set('type', type)
  if (search) qs.set('q', search)

  let res: Response
  try {
    res = await apiFetch(`/api/erp/customers?${qs}`, {
      signal
    })
  } catch (e) {
    console.error('[fetchErpCustomerDealers] Network error:', e)
    return []
  }

  const text = await res.text()
  if (!res.ok) { console.warn('[fetchErpCustomerDealers] Failed:', res.status, text.slice(0, 300)); return [] }

  try {
    const json = JSON.parse(text)
    const items: any[] = json?.data?.items ?? json?.data ?? json?.items ?? json ?? []
    if (!Array.isArray(items)) return []
    return items
      .filter((c: any) => ['Dealer', 'Store', 'Branch', 'Customer'].includes(String(c.type ?? '')))
      .map((c: any) => ({
        customerCode: String(c.customerNumber ?? c.customerCode ?? c.code ?? c.id ?? ''),
        name: String(c.fullName ?? c.name ?? c.title ?? '').trim(),
        phone: c.phone || c.gsm || c.customerPhone || c.phone1 || '',
        address: c.address || c.customerAddress || c.addressDetail || ''
      }))
      .filter(c => c.name)
  } catch (e) { console.error('[fetchErpCustomerDealers] Parse error:', e); return [] }
}
