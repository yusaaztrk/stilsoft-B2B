export function todayYmd() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function toIsoFromYmd(ymd: string) {
  const v = String(ymd ?? '').trim()
  if (!v) return new Date().toISOString()
  return new Date(`${v}T00:00:00`).toISOString()
}

/**
 * UTC damgasını tarih girdisinin beklediği YEREL y-m-d'ye çevirir.
 *
 * `toIsoFromYmd`'nin tam tersi ve onunla aynı tabanda olmak ZORUNDA: kaydederken tarih yerel
 * gece yarısı sayılıp UTC'ye çevriliyor (UTC+3'te `2026-08-21` → `2026-08-20T21:00:00Z`).
 * Düzenleme formu bunu eskiden `iso.slice(0, 10)` ile okuyordu, yani ham UTC metninin ilk 10
 * karakterini — sonuç bir gün geri: form `2026-08-20` gösteriyordu.
 *
 * Sadece görüntü hatası değildi: kullanıcı tarihe hiç dokunmadan Güncelle'ye bastığında o
 * yanlış gün geri kaydediliyor ve tarih HER düzenlemede bir gün daha geri kayıyordu.
 * Liste `fmtDateTr` ile yerele çevirdiği için doğru görünüyor; ikisi artık aynı tabanda.
 */
export function ymdFromIso(iso: string) {
  const s = String(iso ?? '').trim()
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s.slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatMoneyTRY(n: number) {
  const v = Number(n ?? 0)
  return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Çekin KENDİ para biriminde tutar (2026-08-17).
 *
 * Çek listelerindeki "Tutar" sütunu her satırı `₺` ile basıyordu; oysa çek dolar ya da euro
 * olabiliyor ve `Amount` alanı çekin KENDİ parasındadır (TL karşılığı ayrı kolonda durur).
 * Dolarlı bir çek listede "₺10.000" görünüp on bin lira sanılıyordu.
 */
export function formatMoneyByCurrencyTypeId(n: number, currencyTypeId: unknown) {
  const v = Number(n ?? 0)
  const c = Number(currencyTypeId ?? 1)
  const symbol = c === 3 ? '$' : c === 2 ? '€' : c === 4 ? '£' : '₺'
  return `${symbol}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtDateTr(iso: string) {
  const s = String(iso ?? '').trim()
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('tr-TR')
}

export function checkStatusLabel(s: number) {
  switch (Number(s)) {
    case 1:
      return 'Portföy'
    case 2:
      return 'Bankada (Teminat)'
    case 3:
      return 'Bankada (Tahsil)'
    case 4:
      return 'Cariye Ciro'
    case 5:
      return 'Tahsil'
    case 6:
      return 'İade'
    case 7:
      return 'Karşılıksız'
    default:
      return String(s)
  }
}

export function payableStatusLabel(s: number) {
  switch (Number(s)) {
    case 1:
      return 'Beklemede'
    case 2:
      return 'Bankaya Ciro'
    case 3:
      return 'Ödendi'
    case 4:
      return 'İade'
    case 5:
      return 'Karşılıksız'
    case 6:
      return 'İptal'
    default:
      return String(s)
  }
}

/**
 * ENUM'LAR UÇTAN METİN GELİR — SINIRDA SAYIYA ÇEVRİLİR (2026-08-20).
 *
 * API `JsonStringEnumConverter` ile çalışıyor: çek uçları `status` alanını `1` değil
 * `"Portfolio"`, `paymentStatus`'ü `1` değil `"Pending"`, `endorsementType`'ı `2` değil
 * `"Endorsed"` olarak veriyor. Oysa `customerChecks.ts` / `payableChecks.ts` /
 * `payableNotes.ts` içindeki DTO tipleri `1 | 2 | ...` diyordu — katman yalan söylüyordu.
 *
 * `Number("Portfolio")` `NaN` verdiği için portföydeki çek hiçbir yerde portföyde
 * SAYILMIYORDU:
 *  - Çek listesinde "Yeri" sütunu her satırda `-` görünüyordu,
 *  - Düzenle/Sil düğmeleri (`status === 1` şartı) hep pasif kalıyordu,
 *  - İşlemler menüsü "Bu işlem sadece portföydeki çekler için yapılabilir" diyordu,
 *  - Cari/Yönetim ekstresinde çek satırları hiç listelenmiyordu.
 *
 * Çeviri TEK YERDE, listeyi okuduğumuz sınırda yapılıyor; her tüketicinin ayrı ayrı
 * ayrıştırması gerekmiyor. Sayısal biçim de destekleniyor, uç ayarı değişirse
 * ekranlar bozulmaz. Aynı desen için bkz. `purchaseInvoices.ts`.
 */
function toEnumNumber(raw: unknown, names: Record<string, number>): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw

  const text = String(raw ?? '').trim()
  if (!text) return 0

  const asNumber = Number(text)
  if (Number.isFinite(asNumber)) return asNumber

  const hit = names[text.toLowerCase()]
  return hit === undefined ? 0 : hit
}

/** Sunucudaki `CustomerCheckStatus` ile birebir aynı. */
const CUSTOMER_CHECK_STATUS_NAMES: Record<string, number> = {
  portfolio: 1,
  endorsedtobankasguarantee: 2,
  endorsedtobankforcollection: 3,
  endorsedtocustomer: 4,
  collected: 5,
  returned: 6,
  dishonored: 7
}

/** Sunucudaki `CustomerCheckPaymentStatus` ile birebir aynı. */
const CUSTOMER_CHECK_PAYMENT_STATUS_NAMES: Record<string, number> = {
  pending: 1,
  paid: 2
}

/** Sunucudaki `CustomerCheckEndorsementType` ile birebir aynı. */
const CUSTOMER_CHECK_ENDORSEMENT_TYPE_NAMES: Record<string, number> = {
  original: 1,
  endorsed: 2
}

/** `PayableCheckStatus` ve `PayableNoteStatus` aynı değerlere sahip. */
const PAYABLE_STATUS_NAMES: Record<string, number> = {
  issued: 1,
  endorsedtobank: 2,
  paid: 3,
  returned: 4,
  dishonored: 5,
  cancelled: 6
}

export function normalizeCustomerCheckRow<T extends Record<string, any>>(row: T): T {
  return {
    ...row,
    status: toEnumNumber(row?.status, CUSTOMER_CHECK_STATUS_NAMES),
    paymentStatus: toEnumNumber(row?.paymentStatus, CUSTOMER_CHECK_PAYMENT_STATUS_NAMES),
    endorsementType: toEnumNumber(row?.endorsementType, CUSTOMER_CHECK_ENDORSEMENT_TYPE_NAMES)
  }
}

export function normalizePayableRow<T extends Record<string, any>>(row: T): T {
  return {
    ...row,
    status: toEnumNumber(row?.status, PAYABLE_STATUS_NAMES)
  }
}
