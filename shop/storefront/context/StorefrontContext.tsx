'use client'

import React, { createContext, useContext } from 'react'

/**
 * Vitrinin GÖRÜNÜM ayarlarından istemci bileşenlerinin ihtiyaç duyduğu küçük bölüm.
 *
 * NEDEN CONTEXT: `lowStockThreshold` gibi ayarlar bayi panelinden geliyor ve `ProductCard`
 * gibi istemci bileşenlerinin ta içinde lazım. Prop olarak geçirmek, ürün kartını render eden
 * her ara bileşenin (liste, kaydırıcı, benzer ürünler, ürün detayı) ayarı taşımasını gerektirir;
 * yeni bir liste eklendiğinde birinin unutulması kaçınılmaz ve unutulduğunda hata görünmez —
 * eşik sessizce varsayılana döner.
 *
 * NEDEN SADECE BU ALANLAR: ayarların tamamını istemciye taşımak, firma bilgisi ve kategori
 * metinleri dahil her şeyi sayfa yüküne eklemek olurdu. Buraya yalnızca istemcide KARAR
 * verilen alanlar giriyor.
 */
export type StorefrontDisplay = {
  /** Bu adedin altında "Son N adet" yazılır. */
  lowStockThreshold: number
  /**
   * Bayi panelindeki teslimat vaadi ("Lefkoşa/Girne 1-2 iş günü" gibi). Ürün sayfasında
   * zaten görünüyordu; sepette de görünmesi için buraya alındı (2026-09-20) — müşterinin
   * "ne zaman gelir" sorusunu ödeme adımına gelmeden cevaplamak, sepeti terk etme
   * sebeplerinin başında.
   */
  deliveryPromise: string
}

const defaults: StorefrontDisplay = {
  lowStockThreshold: 5,
  deliveryPromise: 'Tüm KKTC ilçelerine randevulu nakliye',
}

const StorefrontContext = createContext<StorefrontDisplay>(defaults)

export function StorefrontProvider({
  value,
  children,
}: {
  value?: Partial<StorefrontDisplay>
  children: React.ReactNode
}) {
  /*
   * Yayılma (`{...defaults, ...value}`) TEK BAŞINA YETMEZ: `value` içinde alan `undefined`
   * olarak GELİRSE varsayılanı ezer ve eşik `undefined` olur. Ayar okunamadığında ya da
   * eski bir kayıtta alan hiç yokken tam olarak bu olurdu. O yüzden her alan tek tek,
   * "geçerli mi" diye bakılarak çözülüyor.
   */
  const resolved: StorefrontDisplay = {
    lowStockThreshold:
      typeof value?.lowStockThreshold === 'number' && value.lowStockThreshold > 0
        ? value.lowStockThreshold
        : defaults.lowStockThreshold,
    deliveryPromise:
      typeof value?.deliveryPromise === 'string' && value.deliveryPromise.trim().length > 0
        ? value.deliveryPromise.trim()
        : defaults.deliveryPromise,
  }

  return <StorefrontContext.Provider value={resolved}>{children}</StorefrontContext.Provider>
}

export function useStorefrontDisplay(): StorefrontDisplay {
  return useContext(StorefrontContext)
}
