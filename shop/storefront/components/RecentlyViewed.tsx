'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { displayName, formatPrice, mediaUrl } from '@/lib/format'

/*
  SON BAKTIKLARINIZ (2026-09-20).

  Beyaz eşya/ankastre alışverişi tek oturumda bitmiyor: müşteri bakıyor, kapatıyor, birkaç gün
  sonra geri geliyor. Geri geldiğinde baktığı ürünü yeniden aramak zorunda kalıyordu; çoğu
  aramıyor, kapatıyor.

  Kayıt TARAYICIDA (localStorage): sunucuya kişisel gezinme geçmişi yazmıyoruz, üyelik de
  gerekmiyor. Karşılığında liste cihaz başına ayrı — bu alışveriş için kabul edilebilir,
  müşteri zaten aynı telefondan/bilgisayardan dönüyor.

  localStorage OKUNAMAYABİLİR (gizli pencere, site verisi kapalı, tarayıcı engeli). Her okuma
  ve yazma try/catch içinde; erişilemezse bölüm hiç görünmez, sayfa normal çalışır.
*/

const ANAHTAR = 'stilsoft:son-bakilanlar'
const MAKS = 8

export type GezilenUrun = {
  stockCode: string
  slug: string
  name: string
  imageUrl?: string | null
  grossPrice: number
  currency: string
}

/** Ürün sayfası açıldığında çağrılır. Hata asla dışarı çıkmaz. */
export function kaydet(urun: GezilenUrun) {
  try {
    const ham = window.localStorage.getItem(ANAHTAR)
    const liste: GezilenUrun[] = ham ? JSON.parse(ham) : []
    const yeni = [urun, ...liste.filter((x) => x.stockCode !== urun.stockCode)].slice(0, MAKS)
    window.localStorage.setItem(ANAHTAR, JSON.stringify(yeni))
  } catch {
    /* Gizli pencere / site verisi kapalı: bu özellik olmadan da site çalışır. */
  }
}

export function oku(): GezilenUrun[] {
  try {
    const ham = window.localStorage.getItem(ANAHTAR)
    if (!ham) return []
    const liste = JSON.parse(ham)
    return Array.isArray(liste) ? liste : []
  } catch {
    return []
  }
}

/** Ürün sayfasına konur: görüntülemeyi kaydeder, ekrana hiçbir şey basmaz. */
export function ViewTracker({ urun }: { urun: GezilenUrun }) {
  useEffect(() => {
    kaydet(urun)
    // Stok kodu değişmediği sürece tekrar yazmaya gerek yok.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urun.stockCode])

  return null
}

export default function RecentlyViewed({ haricTut }: { haricTut?: string }) {
  const [urunler, setUrunler] = useState<GezilenUrun[]>([])

  useEffect(() => {
    // Sunucuda localStorage yok; okuma yalnız tarayıcıda, ilk boyamadan sonra.
    setUrunler(oku().filter((x) => x.stockCode !== haricTut))
  }, [haricTut])

  if (urunler.length === 0) return null

  return (
    <section className="recent-viewed">
      <div className="recent-viewed-head">
        <h2>Son baktıklarınız</h2>
      </div>
      <div className="recent-viewed-list">
        {urunler.map((u) => {
          const gorsel = mediaUrl(u.imageUrl)
          return (
            <Link key={u.stockCode} href={`/urun/${u.slug}`} className="recent-item">
              {gorsel && (
                <Image src={gorsel} alt={displayName(u.name)} width={110} height={110} className="recent-item-img" />
              )}
              <span className="recent-item-name">{displayName(u.name)}</span>
              <span className="recent-item-price num">{formatPrice(u.grossPrice, u.currency)}</span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
