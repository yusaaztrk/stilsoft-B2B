import { TURKCE_KELIMELER } from '@/lib/turkishWords'

const MEDIA = process.env.NEXT_PUBLIC_MEDIA_URL ?? 'http://localhost:5150/api/media'

/** Fiyatlar KDV dahil gösteriliyor; biçim Türkçe (binlik nokta, kuruş virgül). */
export function formatPrice(value?: number | null, currency = 'TRY'): string {
  const safeVal = typeof value === 'number' && !isNaN(value) ? value : 0
  const symbol = currency === 'TRY' ? '₺' : currency
  const text = new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safeVal)
  return `${text} ${symbol}`
}

/** ERP'de göreli duran görsel adresini tam adrese çevirir. */
export function mediaUrl(path?: string | null): string | null {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  return `${MEDIA}${path.startsWith('/') ? '' : '/'}${path}`
}

/**
 * Ürün adları katalogdan geliyor ve büyük harf + yıldızlı ölçülerle yazılmış
 * ("041*060 ALOEVERA YASTIK"). Vitrinde okunur hâle getiriliyor; kaynak veriye dokunulmuyor.
 *
 * TÜRKÇE "I" TUZAĞI (2026-09-21): ERP adları çoğu yerde Türkçe karaktersiz yazılmış
 * ("WIFI", "KRISTAL", "CELIK", "SISE"). tr-TR küçültme ASCII I'yı "ı" yapıyor, sonuç her
 * kartta "Wıfı", "Krıstal", "Vıtro" — yazım hatası gibi duruyor, güven zedeliyor. Kural
 * (I → ı mı, i mi; C → ç mi) kelimeye bağlı, o yüzden SÖZLÜK: `lib/turkishWords.ts`
 * (katalogdaki sık kelimelerden üretildi). Sözlükte olmayan kelimede:
 *  - W/X/Q içeren (Türkçe olmayan) kelimede I → i ("SWITCH" → "Switch"),
 *  - rakam içeren jeton (model kodu: "ST-24UW4RKTCE00", "F1760") olduğu gibi kalır,
 *  - gerisi eski davranış (tr-TR: I → ı), çünkü Türkçe kelimelerde çoğunluk o.
 * Adres (slug) bundan etkilenmez; yalnız görünen ad.
 */
export function displayName(raw?: string | null): string {
  if (!raw) return ''
  const cleaned = raw.replace(/\s+/g, ' ').replace(/\*/g, '×').trim()
  return cleaned
    .split(' ')
    .map((token) => formatWord(token))
    .join(' ')
}

function formatWord(token: string): string {
  if (token.length === 0) return token
  // Model kodu / ölçü: harf+rakam karışık jeton olduğu gibi kalır ("ST-AF-7ET13CD", "60CM", "24-43").
  if (/\d/.test(token)) return token

  // Başta/sonda noktalama ("(DÖKÜM)", "INOX," ) korunur; çekirdek kelime işlenir.
  const m = token.match(/^([^A-Za-zÇĞİÖŞÜçğıöşü]*)(.*?)([^A-Za-zÇĞİÖŞÜçğıöşü]*)$/)
  if (!m) return token
  const [, pre, core, post] = m
  if (core.length === 0) return token

  // Birleşik kelimeler ("NO-FROST", "SİYAH&GOLD", "ÇAY/KAHVE") parça parça; ayraçlar korunur.
  // İki harflik parçalar ("ST-", "YP-", "TV") marka/tip kısaltmasıdır, büyük kalır.
  const parts = core.split(/([-&/+])/)
  return (
    pre +
    parts
      .map((part, i) =>
        /^[-&/+]$/.test(part) || part.length === 0
          ? part
          : i === 0 && parts.length > 1 && part.length <= 2 && parts[1] === '-'
            ? part.toLocaleUpperCase('tr-TR') // "ST-…", "YP-…" marka/tip öneki
            : formatCore(part),
      )
      .join('') +
    post
  )
}

function formatCore(word: string): string {
  const key = word.toLocaleUpperCase('tr-TR').replace(/İ/g, 'I').replace(/Ç/g, 'C').replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ö/g, 'O').replace(/Ü/g, 'U')
  const known = TURKCE_KELIMELER[key]
  if (known) return known

  // Zaten karışık yazılmış (ör. "WiFi", "webOS") ise dokunma.
  if (word !== word.toLocaleUpperCase('tr-TR') && word !== word.toLocaleLowerCase('tr-TR')) return word

  // Türkçe olmayan harf (W/X/Q) varsa ASCII I → i; "İ" her iki yolda da tr-TR ile küçülür
  // (düz `toLowerCase()` İ'yi "i + birleşik nokta" yapıp "Si̇yah" gibi bozuk çıktı veriyordu).
  const lower = (/[WXQwxq]/.test(word) ? word.replace(/I/g, 'i') : word).toLocaleLowerCase('tr-TR')
  return lower[0].toLocaleUpperCase('tr-TR') + lower.slice(1)
}

/**
 * Vitrinde gösterilecek stok metni — ERP/POS ekranlarındaki kuralın aynısı.
 *
 * 5 → "5", 11 → "11", 12 ve üzeri → "12+". Tavanı mağaza API'si uyguluyor (bayi panelinden
 * ayarlanan `stockDisplayCap`); burada yalnızca "+" işareti ekleniyor. Karar sunucuda
 * duruyor ki gerçek adet tarayıcıya hiç ulaşmasın — istemcide kesmek, sayıyı yine de
 * göndermek olurdu.
 *
 * Adet gelmiyorsa (bayi göstermeyi kapatmış) null döner; çağıran yer eski "Stokta" metnine
 * düşer.
 */
export function stockLabel(quantity?: number | null, capped?: boolean): string | null {
  if (typeof quantity !== 'number' || quantity <= 0) return null
  return capped ? `${quantity}+` : String(quantity)
}
