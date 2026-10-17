/**
 * Numaraya SMS gidebilir mi — sunucudaki `SmsService.NormalizeMsisdn` ile AYNI kural.
 *
 * SMS yalnız KKTC/Türkiye cep hattına gidiyor: ülke kodu (90) ve baştaki sıfırlar atıldıktan
 * sonra 10 hane ve 5 ile başlamalı. İki taraf farklı karar verirse müşteri ya boşuna kod bekler
 * ya da SMS'e uygun numarası e-posta yoluna düşer; kural değişirse ikisi birlikte değişmeli.
 */
export function isSmsCapablePhone(phone: string): boolean {
  let digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('90') && digits.length - 2 >= 9) digits = digits.slice(2)
  digits = digits.replace(/^0+/, '')
  return digits.length === 10 && digits.startsWith('5')
}

/**
 * Yazılan numara bir YURT DIŞI numarası gibi mi duruyor — SMS'e uygun değil ama telefon
 * numarası olacak kadar uzun. Yazmaya yeni başlamış müşteriye erkenden "yabancı numara"
 * demeyelim diye 8 hane şartı var; `+` ile başlayan ve 90 olmayan numara da hemen sayılır.
 */
export function looksInternational(phone: string): boolean {
  const raw = String(phone ?? '').trim()
  const digits = raw.replace(/\D/g, '')
  if (isSmsCapablePhone(raw)) return false
  const ulkeKodlu = (raw.startsWith('+') || digits.startsWith('00')) && !digits.replace(/^00/, '').startsWith('90')
  return (ulkeKodlu && digits.length >= 8) || digits.length >= 11
}
