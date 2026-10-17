/**
 * Kasa/Banka tahsilat ekranlarında "paranın işleneceği cari hesap" seçenekleri.
 *
 * Kodlama arka uçtaki `CurrencyTypeHelper` ile aynı: 1 = TRY, 2 = EUR, 3 = USD, 4 = GBP.
 * Varsayılan TL hesabıdır ('1').
 *
 * ÖNEMLİ — tutar, seçilen hesabın para birimine TL ÇAPASINDAN çevrilir: gelen paranın TL
 * karşılığı bulunur, sonra hedef hesabın güncel kuruyla o hesabın parasına dönüştürülür.
 *
 * ÇAPRAZ KUR KULLANILMAZ. Bir dönem £→€ gibi çapraz kur kullanılıyordu (üstelik ters yönde
 * saklanmıştı) ve 1.500 £'lik tahsilat ekstreye 31,66 € düşüyordu. TL üzerinden gitmek o
 * hatayı yapısal olarak imkânsız kılar: iki bacak da "1 döviz = X ₺" yönündedir.
 *
 * Kasa ve Banka sayfaları AYNI listeyi kullanır; biri değişirse diğeri de değişsin diye
 * tek yerde duruyor.
 */
export const CUSTOMER_ACCOUNT_OPTIONS = [
  { id: '1', label: '₺ TL Hesabı', active: 'bg-blue-600 border-blue-600 text-white' },
  { id: '3', label: '$ USD Hesabı', active: 'bg-emerald-600 border-emerald-600 text-white' },
  { id: '2', label: '€ EUR Hesabı', active: 'bg-amber-600 border-amber-600 text-white' },
  { id: '4', label: '£ GBP Hesabı', active: 'bg-purple-600 border-purple-600 text-white' }
] as const

/** Varsayılan cari hesap: TL. */
export const DEFAULT_CUSTOMER_ACCOUNT_ID = '1'
