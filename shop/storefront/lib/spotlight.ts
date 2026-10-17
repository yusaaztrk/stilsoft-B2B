/*
  Anasayfa "Öne Çıkan Ürün Deneyimi" bloğunun canlı fiyat sözleşmesi (2026-09-21).
  Bileşen 'use client' olduğu için bu sabitler ayrı dosyada: sunucu bileşeni (app/page.tsx)
  buradan stok kodlarını okuyup fiyatı katalogdan çeker, bileşene `live` olarak verir.
*/
export type SpotlightLive = {
  price: number
  currency: string
  slug: string
  inStock: boolean
  originalPrice?: number | null
  /**
   * Ürünün KATALOGTAKİ görseli (2026-09-21).
   *
   * Önce her kartın görsel yolu koda gömülüydü. Öne çıkan ürün değiştirilince fotoğraf
   * eski üründe kalıyor, kart yanlış cihazı gösteriyordu — fiyatlarda yaşanan sorunun
   * aynısı (gömülü fiyatlar 2026-09-21'de bu yüzden canlıya çevrilmişti).
   * Artık görsel de ürünün kendisinden geliyor; gömülü yol yalnız yedek.
   */
  imageUrl?: string | null
}

/**
 * Spotlight kartlarındaki ürünler (ProductSpotlight.tsx içindeki `stockCode` alanlarıyla aynı).
 *
 * 2026-09-21: kullanıcı bu üç ürünün öne çıkmasını istedi; klima İLK SIRADA (sonradan
 * belirtildi), ardından Türk kahve makinesi ve buharlı ütü. Sıra `ProductSpotlight`
 * içindeki dizi sırasıyla AYNI olmalı — ikisi ayrışırsa fiyat başka ürüne ait olur.
 */
export const SPOTLIGHT_STOCK_CODES = ['SBE92010', 'SIH31231', 'SUT61070'] as const
