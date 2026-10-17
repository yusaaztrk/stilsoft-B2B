/**
 * TELEFON BİÇİMİ — YURT DIŞI NUMARALARINI DA ALIR (2026-08-20 kullanıcı isteği).
 *
 * Eskiden 11 haneye kırpılıyordu (`0555 555 5555`). Bu, Türkiye/KKTC numarasının uzunluğu;
 * yurt dışından müşterisi olan bir firmada numaranın sonu SESSİZCE kesiliyordu — kimse hata
 * görmüyor, numara yanlış kaydediliyordu.
 *
 * Yeni biçim: `0555 555 5555 555` — 4-3-4 gruplarından sonra kalan haneler dördüncü gruba
 * eklenir. 11 haneli mevcut numaralar BİREBİR aynı görünür, tek satır bile değişmez.
 *
 * ÜST SINIR NEDEN 17: uluslararası numara standardı (E.164) en fazla 15 hanedir; Türkiye'de
 * yurt dışı numarası `00` ön ekiyle yazıldığı için 15 + 2 = 17. Sınırsız bırakmak,
 * veritabanındaki telefon kolonlarını (en dar olanı 20 karakter) taşıracağı için doğru
 * değil — 17 hane + 3 boşluk = 20 karakter, tam sığıyor.
 */
export const PHONE_MAX_DIGITS = 17

/** Rakamları biçimlendirilmiş metne çevirir. Ayraçlar: 4-3-4-kalan. */
export function formatPhoneNumber(val: string): string {
  const digits = String(val ?? '').replace(/\D/g, '').slice(0, PHONE_MAX_DIGITS)
  if (digits.length === 0) return ''

  const groups = [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7, 11), digits.slice(11)]
  return groups.filter(Boolean).join(' ')
}

/**
 * Kabul edilen biçim.
 *
 * En az 11 hane (`0555 555 5555`) — eski kural buydu ve gevşetilmedi; eksik numara girilmesi
 * ayrı bir sorun. Dördüncü grup isteğe bağlı ve yurt dışı numaralarını taşır.
 */
export const PHONE_PATTERN = /^0\d{3} \d{3} \d{4}( \d{1,6})?$/

/** Boş değer geçerlidir; telefonun zorunlu olup olmadığına çağıran karar verir. */
export function isValidPhone(value: string | null | undefined): boolean {
  const v = String(value ?? '').trim()
  if (!v) return true
  return PHONE_PATTERN.test(v)
}

/** Ekranlarda gösterilecek tek tip hata metni. */
export const PHONE_FORMAT_MESSAGE =
  'Telefon 0555 555 5555 biçiminde olmalıdır (yurt dışı için 0555 555 5555 555).'

/** Girdi alanlarının `maxLength` değeri: 17 hane + 3 ayraç. */
export const PHONE_MAX_LENGTH = PHONE_MAX_DIGITS + 3
