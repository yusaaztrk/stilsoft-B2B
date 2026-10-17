'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/*
  "SON BAKTIKLARINIZ" LİSTESİNDEN ÖLÜ KAYDI TEMİZLE (2026-09-21).

  Liste tarayıcıda (localStorage) duruyor ve ürün sonradan yayından kalkabiliyor: stoğu
  bitiyor, bayi kapatıyor, kritik eşiğin altına düşüyor. O hâlde müşteri listeden tıklıyor
  ve 404 görüyor — hem kötü bir deneyim hem de "site bozuk" izlenimi.

  Bu bileşen ÜRÜN SAYFASININ 404 ekranında çalışıyor: adresteki ürünü listeden çıkarıyor.
  Tam isabetli çözüm, çünkü ürünün gerçekten erişilemez olduğunu ancak sunucu biliyor;
  listeyi her sayfada doğrulatmak her ziyarete fazladan istek eklerdi.
*/

const ANAHTAR = 'stilsoft:son-bakilanlar'

export default function RecentlyViewedPrune() {
  const pathname = usePathname()

  useEffect(() => {
    const slug = decodeURIComponent((pathname ?? '').replace(/^\/urun\//, '').replace(/\/$/, ''))
    if (!slug) return

    try {
      const ham = window.localStorage.getItem(ANAHTAR)
      if (!ham) return
      const liste = JSON.parse(ham)
      if (!Array.isArray(liste)) return

      const kalan = liste.filter((x: { slug?: string }) => x?.slug !== slug)
      if (kalan.length !== liste.length) {
        window.localStorage.setItem(ANAHTAR, JSON.stringify(kalan))
      }
    } catch {
      /* localStorage okunamıyorsa yapacak bir şey yok; 404 sayfası yine çalışır. */
    }
  }, [pathname])

  return null
}
