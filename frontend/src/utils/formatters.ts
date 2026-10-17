/**
 * Centralized formatting utility for numbers, currency, dates, and nullable text.
 */

export function formatCurrency(value: number | string | null | undefined, currencySymbol = ''): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return `${currencySymbol}0,00`
  return `${currencySymbol}${n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatNumber(value: number | string | null | undefined, decimals = 2): string {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('tr-TR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('tr-TR')
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('tr-TR')
}

export function formatNullableText(value: string | null | undefined, fallback = '-'): string {
  const s = String(value ?? '').trim()
  return s || fallback
}

/**
 * Tutar kutusunun kuruştan doldurulması — Kasa/Banka İşlemleri'ndeki davranışın aynısı.
 *
 * Kullanıcı soldan tam sayı yazmaz; rakamlar SAĞDAN, kuruş hanesinden dolar:
 *   "1" -> 0,01 · "12" -> 0,12 · "123" -> 1,23 · "112500" -> 1.125,00
 * Böylece "1125" yazıp kuruşu unutmak diye bir şey kalmıyor ve alan her zaman iki
 * ondalıklı geçerli bir tutar gösteriyor.
 *
 * `allowNegative` ile eksi değer girilebilir: metnin HERHANGİ bir yerinde `-` varsa sonuç
 * negatiftir, yani rakamlardan önce de sonra da yazılabilir. Kutu yeniden biçimlendiği için
 * imleç hep sonda kalır; işareti kaldırmak için alanı temizleyip yeniden yazmak gerekir.
 * Henüz rakam yokken `-0,00` gösterilir — işaretin yutulmaması için bilinçli.
 *
 * Aynı işlev `CashPage`, `CheckPage`, `BankPage` ve `BankExpensesPage` içinde ayrı ayrı
 * duruyor (tarihsel) ve oralarda eksi YOKTUR; bu yüzden `allowNegative` varsayılan olarak
 * kapalı — buradaki davranış o dördüyle birebir aynı kalsın diye.
 */
export function handleCurrencyInputChange(val: string, opts?: { allowNegative?: boolean }): string {
  const raw = String(val ?? '')
  const negative = opts?.allowNegative === true && raw.includes('-')
  const sign = negative ? '-' : ''
  if (!raw.trim()) return `${sign}0,00`
  const rawDigits = raw.replace(/[^\d]/g, '')
  if (!rawDigits) return `${sign}0,00`
  const cents = parseInt(rawDigits, 10)
  return `${sign}${formatMoneyTr(cents / 100)}`
}

/** tr-TR para biçimi: 1.125,00 */
export function formatMoneyTr(n: number | string | null | undefined): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return '0,00'
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

/**
 * tr-TR biçimli tutarı sayıya çevirir. KUR İÇİN KULLANILMAZ — tek nokta burada BİNLİK
 * ayracıdır ("1.234" = bin iki yüz otuz dört), kurda ise ondalıktır. Bkz. `BankPage.parseRate`.
 */
export function parseMoneyTr(val: any): number {
  if (val === null || val === undefined) return 0
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0

  let str = String(val).trim().replace(/[^\d.,-]/g, '')
  if (!str) return 0

  const hasDot = str.includes('.')
  const hasComma = str.includes(',')

  if (hasDot && hasComma) {
    const decimalSep = str.lastIndexOf(',') > str.lastIndexOf('.') ? ',' : '.'
    const groupSep = decimalSep === ',' ? '.' : ','
    str = str.split(groupSep).join('').replace(decimalSep, '.')
  } else if (hasComma) {
    str = str.replace(',', '.')
  } else if (hasDot) {
    const parts = str.split('.')
    // Tek nokta ve son grup 3 haneliyse binlik ayracıdır: "1.125" -> 1125
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      str = str.replace(/\./g, '')
    }
  }

  const num = parseFloat(str)
  return Number.isFinite(num) ? num : 0
}
