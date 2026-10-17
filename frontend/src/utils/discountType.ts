/**
 * İNDİRİM TİPİ — API SAYI DEĞİL METİN GÖNDERİYOR (2026-08-22).
 *
 * ERP API enum'ları `JsonStringEnumConverter` ile serileştiriyor (bkz. `Program.cs`), yani
 * `discountType` alanı tel üzerinde `"None"` / `"Amount"` / `"Percentage"` olarak geliyor —
 * sunucudaki enum değerleri 0/1/2 olsa bile.
 *
 * Ekranlar bunu bilmeden yazılmıştı ve üç ayrı biçimde karşılaştırıyorlardı:
 *   `=== 1`            → metin geldiği için hiç tutmaz
 *   `=== 'amount'`     → gelen `"Amount"`, büyük harfli; tutmaz
 *   `Number(x) === 1`  → `Number("Amount")` = NaN; tutmaz
 *
 * Sonuç: indirim SESSİZCE 0 sayılıyordu. Teklif basımında indirim satırı hep 0,00 çıkıyor,
 * daha kötüsü kayıt düzenlemeye açıldığında tip `'none'`a düşüp mevcut indirimi siliyordu.
 *
 * Normalleştirme tek yerde toplandı: uç ileride sayıya dönerse ya da yeni bir ekran eklenirse
 * aynı tuzağa tekrar düşülmesin.
 */
export type DiscountKind = 'none' | 'amount' | 'percentage'

/**
 * Gelen değeri — sayı, metin, büyük/küçük harf fark etmeksizin — tek bir biçime indirger.
 * Tanınmayan her şey `'none'`: bilinmeyen bir tipe indirim uygulamaktansa uygulamamak yeğdir.
 */
export function normalizeDiscountType(value: unknown): DiscountKind {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === 'amount' || v === '1') return 'amount'
    if (v === 'percentage' || v === '2') return 'percentage'
    return 'none'
  }

  const n = Number(value)
  if (n === 1) return 'amount'
  if (n === 2) return 'percentage'
  return 'none'
}
