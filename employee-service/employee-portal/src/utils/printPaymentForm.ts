/**
 * Avans ve prim için imzalanacak belge çıktısı.
 *
 * Belge ayrı bir pencerede kurulup yazdırılır; sayfanın kendi stilleri karışmasın diye
 * tamamen bağımsız HTML üretilir. React ağacına print-only bir blok gömmek, portalın
 * Tailwind sınıfları ve koyu tema değişkenleriyle çakışıyordu.
 *
 * Şablon metni yazdırma penceresine `document.write` ile aktarılır; string birleştirme
 * kullanılır çünkü iç içe şablon dizeleri (`${}`) CSS içindeki süslü parantezlerle
 * karışıp sessizce bozuk çıktı üretiyordu.
 */

export type PaymentFormKind = 'advance' | 'bonus'

export type PaymentFormData = {
  kind: PaymentFormKind
  companyName?: string
  employeeName: string
  employeeCode?: string | null
  workplace?: string | null
  amount: number
  date: string
  period?: string | null
  description?: string | null
  referenceNo?: string | null
  /** Avansta: bu tutar maaştan düşülecek mi? */
  deductFromSalary?: boolean
  preparedBy?: string | null
}

const TR_ONES = ['', 'BİR', 'İKİ', 'ÜÇ', 'DÖRT', 'BEŞ', 'ALTI', 'YEDİ', 'SEKİZ', 'DOKUZ']
const TR_TENS = ['', 'ON', 'YİRMİ', 'OTUZ', 'KIRK', 'ELLİ', 'ALTMIŞ', 'YETMİŞ', 'SEKSEN', 'DOKSAN']

/** Üç haneli grubu yazıya çevirir; "BİRYÜZ" değil "YÜZ" der. */
function threeDigitsToWords(n: number): string {
  const out: string[] = []
  const h = Math.floor(n / 100)
  const t = Math.floor((n % 100) / 10)
  const o = n % 10

  if (h > 0) out.push(h === 1 ? 'YÜZ' : TR_ONES[h] + 'YÜZ')
  if (t > 0) out.push(TR_TENS[t])
  if (o > 0) out.push(TR_ONES[o])

  return out.join('')
}

/** Tutarı okunur yazıya çevirir: 12.500,50 -> "ONİKİBİNBEŞYÜZ TL ELLİ KR". */
export function amountToWords(value: number): string {
  const safe = Math.max(0, Math.round(value * 100) / 100)
  const lira = Math.floor(safe)
  const kurus = Math.round((safe - lira) * 100)

  if (lira === 0 && kurus === 0) return 'SIFIR TL'

  const groups: string[] = []
  const scales = ['', 'BİN', 'MİLYON', 'MİLYAR']
  let rest = lira
  let scaleIndex = 0

  while (rest > 0 && scaleIndex < scales.length) {
    const part = rest % 1000
    if (part > 0) {
      // "BİRBİN" denmez, "BİN" denir.
      const words = part === 1 && scaleIndex === 1 ? '' : threeDigitsToWords(part)
      groups.unshift(words + scales[scaleIndex])
    }
    rest = Math.floor(rest / 1000)
    scaleIndex += 1
  }

  const liraText = groups.join('') || 'SIFIR'
  const kurusText = kurus > 0 ? ' ' + threeDigitsToWords(kurus) + ' KR' : ''
  return liraText + ' TL' + kurusText
}

function money(value: number): string {
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value ?? 0)
}

function dmy(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('tr-TR')
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function row(label: string, value: string): string {
  return '<tr><th>' + esc(label) + '</th><td>' + esc(value) + '</td></tr>'
}

export function buildPaymentFormHtml(data: PaymentFormData): string {
  const isAdvance = data.kind === 'advance'
  const title = isAdvance ? 'AVANS ÖDEME BELGESİ' : 'PRİM ÖDEME BELGESİ'

  const undertaking = isAdvance
    ? (data.deductFromSalary
      ? 'Aşağıda belirtilen tutarı avans olarak nakden ve tamamen teslim aldım. Bu tutarın ' +
        'ilgili döneme ait maaşımdan kesilmesini kabul ve beyan ederim.'
      : 'Aşağıda belirtilen tutarı avans olarak nakden ve tamamen teslim aldım. Bu tutar ' +
        'maaşımdan kesilmeyecektir.')
    : 'Aşağıda belirtilen prim tutarını nakden ve tamamen teslim aldım.'

  const rows = [
    row('Adı Soyadı', data.employeeName),
    data.employeeCode ? row('Personel Kodu', data.employeeCode) : '',
    data.workplace ? row('İşyeri', data.workplace) : '',
    row('Tutar', money(data.amount) + ' TL'),
    row('Yazı ile', amountToWords(data.amount)),
    row('Tarih', dmy(data.date)),
    data.period ? row('Dönem', data.period) : '',
    isAdvance ? row('Maaştan Kesinti', data.deductFromSalary ? 'EVET — maaştan düşülecek' : 'HAYIR') : '',
    row(isAdvance ? 'Avans Nedeni' : 'Prim Nedeni', data.description || '—'),
    data.referenceNo ? row('Referans No', data.referenceNo) : ''
  ].join('')

  const styles =
    '@page { size: A4; margin: 18mm 16mm; }' +
    'body { font-family: "Segoe UI", Arial, sans-serif; color: #111; font-size: 12px; }' +
    '.doc { max-width: 178mm; margin: 0 auto; }' +
    'h1 { font-size: 17px; letter-spacing: .12em; text-align: center; margin: 0 0 2px; }' +
    '.company { text-align: center; font-size: 12px; font-weight: 700; margin-bottom: 14px; }' +
    '.rule { border-top: 2px solid #111; margin: 10px 0 14px; }' +
    '.undertaking { border: 1px solid #999; padding: 10px 12px; line-height: 1.6; margin-bottom: 14px; }' +
    'table { width: 100%; border-collapse: collapse; }' +
    'th, td { border: 1px solid #999; padding: 7px 9px; text-align: left; vertical-align: top; }' +
    'th { width: 34%; background: #f2f2f2; font-weight: 700; }' +
    '.sign { display: flex; gap: 24px; margin-top: 34px; }' +
    '.sign > div { flex: 1; }' +
    '.sign .line { border-bottom: 1px solid #111; height: 52px; }' +
    '.sign .cap { font-size: 11px; margin-top: 5px; text-align: center; font-weight: 600; }' +
    '.foot { margin-top: 22px; font-size: 10px; color: #666; display: flex; justify-content: space-between; }'

  return '<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>' + esc(title) +
    '</title><style>' + styles + '</style></head><body><div class="doc">' +
    '<h1>' + esc(title) + '</h1>' +
    '<div class="company">' + esc(data.companyName || '') + '</div>' +
    '<div class="rule"></div>' +
    '<div class="undertaking">' + esc(undertaking) + '</div>' +
    '<table>' + rows + '</table>' +
    '<div class="sign">' +
    '<div><div class="line"></div><div class="cap">Teslim Alan (Personel)<br>' + esc(data.employeeName) + '</div></div>' +
    '<div><div class="line"></div><div class="cap">Teslim Eden / Onaylayan</div></div>' +
    '</div>' +
    '<div class="foot"><span>Düzenleyen: ' + esc(data.preparedBy || '—') + '</span>' +
    '<span>Belge tarihi: ' + esc(dmy(data.date)) + '</span></div>' +
    '</div></body></html>'
}

/** Belgeyi yeni pencerede açar ve yazdırma penceresini tetikler. */
export function printPaymentForm(data: PaymentFormData): void {
  const html = buildPaymentFormHtml(data)
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) {
    // Açılır pencere engellendiyse sessiz kalmak yerine kullanıcıyı uyar.
    window.alert('Yazdırma penceresi tarayıcı tarafından engellendi. Açılır pencerelere izin verin.')
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.focus()
  // Yazı tipleri yerleşmeden print çağrılırsa boş sayfa çıkabiliyor.
  window.setTimeout(() => w.print(), 350)
}
