/**
 * ÜRÜNÜN İKİ AYRI DURUMU VAR — BİRBİRİNİN YERİNE KULLANILAMAZ.
 *
 *   1. AKTİF / PASİF        → `Product.IsActive`
 *      Ürün kartı yaşıyor mu. Pasif ürün kataloğun dışındadır; yönetim ekranında durur,
 *      bayi tarafında hiçbir işi yoktur.
 *
 *   2. SATIŞA AÇIK  E / H   → `Product.BsyVisibleFlag`
 *      Aktif bir ürünün bayiye satılıp satılamayacağı. "H" = satışa kapalı.
 *
 * Bu ikisi ekranda ve kodda BİRBİRİNE GİRMİŞTİ (kullanıcı bildirimi, 2026-08-12):
 *   - Ürün formunda tek bir kutu vardı ve etiketi "Satış Durumu / Satışa Açık (Aktif)" idi;
 *     yani `IsActive` alanı "satışa açık mı" gibi sunuluyordu. Gerçek `BsyVisibleFlag`
 *     kolonu formda HİÇ YOKTU, yeni üründe sabit 'E' yazılıyordu.
 *   - Rol yetkileri (`invoice/bsyHHide`, `invoice/bsyHComingSoon`) `bsyVisibleFlag` yerine
 *     `isActive === false`'a bakıyordu — üç sayfada sekiz ayrı yerde kopyalanmış hâlde.
 *   - `bsyHHide` bir sayfada bağımlılık dizisinde duruyor ama hiç uygulanmıyordu.
 *
 * Kural artık TEK KAYNAKTA. Yeni bir ekran BSY'ye bakacaksa buradan geçsin; kopyalanan her
 * kural bir sonraki turda ayrışıyor.
 */

/**
 * Otomatik satışa kapanma eşiğinin VARSAYILANI. Ürünün kendi `bsyMinStock` değeri varsa o
 * kullanılır (bkz. {@link resolveAutoCloseThreshold}); bu sabit yalnızca eşiği hiç gelmeyen
 * (eski/eksik veri) ürünler için geçerlidir.
 */
export const AUTO_CLOSED_STOCK_THRESHOLD = 12

export type ProductSaleStatusInput = {
  isActive?: boolean | null
  bsyVisibleFlag?: string | null
  stock?: number | string | null
  /**
   * Ürünün kendi satışa kapanma eşiği. `minStock` DEĞİLDİR — o satın alma tarafının stok
   * alarmıdır ("bitmek üzere" uyarısı) ve satışı kapatmaz. İkisi ayrı alanlardır.
   */
  bsyMinStock?: number | string | null
}

/**
 * Ürünün fiilen uygulanan otomatik-kapanma eşiği.
 *
 * Değer olduğu gibi kullanılır, özel durum yoktur: 0 yazılan üründe eşik fiilen devre dışı
 * kalır ve mal stok bitene kadar satılır. Girilmemiş/boş olan üründe varsayılan 12 uygulanır.
 */
export const resolveAutoCloseThreshold = (p: ProductSaleStatusInput | null | undefined): number => {
  const raw = (p as any)?.bsyMinStock
  if (raw === null || raw === undefined || String(raw).trim() === '') return AUTO_CLOSED_STOCK_THRESHOLD
  const threshold = Number(raw)
  return Number.isFinite(threshold) ? threshold : AUTO_CLOSED_STOCK_THRESHOLD
}

/** Ürün kartı yaşıyor mu (aktif/pasif). */
export const isProductActive = (p: ProductSaleStatusInput | null | undefined): boolean =>
  (p as any)?.isActive !== false

/**
 * Kartta ELLE seçilmiş "satışa açık" değeri. Stok kuralını İÇERMEZ — formdaki kutunun
 * göstereceği değer budur.
 */
export const isMarkedOpenToSale = (p: ProductSaleStatusInput | null | undefined): boolean => {
  // Pasif ürün her koşulda satışa kapalıdır; sunucu da böyle yazıyor ama eski kayıtlarda
  // pasif+'E' satırlar vardı, okuma tarafı da aynı kuralı uygulamalı.
  if (!isProductActive(p)) return false
  return String((p as any)?.bsyVisibleFlag ?? 'E').trim().toUpperCase() !== 'H'
}

/** Stok eşiğin altına düştüğü için mi kapalı (elle kapatılmamış olsa bile). */
export const isAutoClosedByStock = (p: ProductSaleStatusInput | null | undefined): boolean => {
  const stock = Number((p as any)?.stock ?? 0)
  return Number.isFinite(stock) && stock < resolveAutoCloseThreshold(p)
}

/**
 * ETKİN DURUM — BSY yetkilerini tetikleyen tek ölçüt.
 *
 * Satışa kapalı sayılmanın İKİ yolu var ve ikisi de yeter (kullanıcı kararı, 2026-08-12):
 *   - kartta "Satışa Açık: Hayır" seçilmiş (`BsyVisibleFlag = 'H'`, pasif ürünler dahil), YA DA
 *   - stok, ürünün kendi eşiğinin (bkz. {@link resolveAutoCloseThreshold}, varsayılan
 *     {@link AUTO_CLOSED_STOCK_THRESHOLD}) altına düşmüş.
 *
 * Eski kod bu ikisini **VE** ile bağlıyordu (`bsyFlag === 'H' && stock < 12`), yani stoğu bol
 * olan satışa kapalı bir ürün bayide hiçbir kısıtlamaya takılmıyordu.
 *
 * Stok kuralı bilinçli olarak HESAPLANIYOR, veritabanına yazılmıyor: yazılsaydı stok tekrar
 * eşiğin üstüne çıktığında ürün kapalı kalır ve birinin elle açması gerekirdi.
 */
export const isClosedToSale = (p: ProductSaleStatusInput | null | undefined): boolean =>
  !isMarkedOpenToSale(p) || isAutoClosedByStock(p)

/** Satışa kapalılığın sebebi — ekranda "neden kapalı" diye sorulmasın diye. */
export const closedToSaleReason = (
  p: ProductSaleStatusInput | null | undefined
): 'passive' | 'marked' | 'stock' | null => {
  if (!isProductActive(p)) return 'passive'
  if (!isMarkedOpenToSale(p)) return 'marked'
  if (isAutoClosedByStock(p)) return 'stock'
  return null
}

export const closedToSaleReasonLabel = (p: ProductSaleStatusInput | null | undefined): string | null => {
  switch (closedToSaleReason(p)) {
    case 'passive':
      return 'Ürün pasif'
    case 'marked':
      return 'Satışa kapalı olarak işaretlendi'
    case 'stock':
      return `Stok ${resolveAutoCloseThreshold(p)} adedin altında`
    default:
      return null
  }
}

export type BsyPermissions = {
  /** `invoice/bsyHHide` — satışa kapalı ürünü bayiye hiç gösterme. */
  canHide: boolean
  /** `invoice/bsyHComingSoon` — satışa kapalı ürünü "ComingSoon" olarak göster, sipariş ettirme. */
  canComingSoon: boolean
}

/**
 * Satışa kapalı ürünün bayide nasıl davranacağı.
 *
 * Hiçbir BSY yetkisi verilmemiş rolde ürün NORMAL görünür ve sipariş edilebilir — bu bugünkü
 * davranıştır ve kullanıcı 2026-08-12'de açıkça korunmasını istedi. Yani BSY yetkileri bir
 * kısıtlama EKLER, varsayılan bir kısıtlama yoktur.
 */
export const resolveBsyTreatment = (
  p: ProductSaleStatusInput | null | undefined,
  perms: BsyPermissions
): 'normal' | 'hidden' | 'comingSoon' => {
  if (!isClosedToSale(p)) return 'normal'
  if (perms.canHide) return 'hidden'
  if (perms.canComingSoon) return 'comingSoon'
  return 'normal'
}
