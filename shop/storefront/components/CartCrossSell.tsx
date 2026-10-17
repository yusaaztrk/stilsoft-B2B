'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useCart } from '@/context/CartContext'
import type { CatalogItem } from '@/lib/api'
import { displayName, formatPrice, mediaUrl } from '@/lib/format'

/*
  SEPETTE ÇAPRAZ SATIŞ (2026-09-20).

  Sepet, alışverişin EN YÜKSEK NİYETLİ anı: müşteri ürünü seçmiş, fiyatı kabul etmiş,
  ödemeye gidiyor. Buraya kadar gelmiş birine "şunu da unutma" demek, ürün sayfasında
  demekten daha kolay dönüşüyor.

  İki tür öneri geliyor (sunucu tarafında hesaplanıyor, bkz. lib/cartSuggestions.ts):
  1. EKSİK SET PARÇASI — sepette fırın var ama ocak yok gibi.
  2. AKSESUAR — sepetteki davlumbazın karbon filtresi gibi. Ucuz, kararı kolay, kâr marjı iyi.

  Tek tıkla ekleniyor ve satır listeden kayboluyor: sepette zaten olan ürünü önermeye devam
  etmek, müşteriye aynı şeyi iki kez aldırma riski.
*/

type Props = {
  urunler: Array<CatalogItem & { oneriTuru: 'set' | 'aksesuar' | 'kategori' }>
  /** Sipariş sonrası kullanımda metin farklı: "aynı teslimatta gelir" sözü orada doğru değil. */
  baslik?: string
  aciklama?: string
}

export default function CartCrossSell({ urunler, baslik, aciklama }: Props) {
  const { addToCart, cart } = useCart()
  const [ekleniyor, setEkleniyor] = useState<string | null>(null)
  const [hata, setHata] = useState<string | null>(null)

  const sepettekiler = new Set((cart?.lines ?? []).map((l) => l.stockCode))
  const gosterilecek = urunler.filter((u) => !sepettekiler.has(u.stockCode) && u.inStock)

  if (gosterilecek.length === 0) return null

  const ekle = async (kod: string, ad: string) => {
    setEkleniyor(kod)
    setHata(null)
    const sonuc = await addToCart(kod, 1)
    if (!sonuc.ok) setHata(sonuc.message ?? `${displayName(ad)} sepete eklenemedi.`)
    setEkleniyor(null)
  }

  return (
    <section className="cart-cross">
      <div className="cart-cross-head">
        <h2>{baslik ?? 'Bunları da unutmayın'}</h2>
        <p>{aciklama ?? 'Aynı teslimatta gelir, ayrıca kargo veya montaj randevusu gerekmez.'}</p>
      </div>

      <div className="cart-cross-list">
        {gosterilecek.map((u) => {
          const gorsel = mediaUrl(u.imageUrl)
          return (
            <div key={u.stockCode} className="cart-cross-item">
              {gorsel && (
                <Image src={gorsel} alt={displayName(u.name)} width={72} height={72} className="cart-cross-img" />
              )}
              <div className="cart-cross-body">
                <span
                  className={`cart-cross-tag${u.oneriTuru === 'aksesuar' ? ' is-acc' : ''}${u.oneriTuru === 'kategori' ? ' is-cat' : ''}`}
                >
                  {u.oneriTuru === 'aksesuar'
                    ? 'Aksesuar'
                    : u.oneriTuru === 'set'
                      ? 'Seti tamamlar'
                      : 'Yanına iyi gider'}
                </span>
                <Link href={`/urun/${u.slug}`} className="cart-cross-name">
                  {displayName(u.name)}
                </Link>
                <div className="cart-cross-price num">{formatPrice(u.grossPrice, u.currency)}</div>
              </div>
              <button
                type="button"
                className="btn btn-line cart-cross-btn"
                onClick={() => void ekle(u.stockCode, u.name)}
                disabled={ekleniyor === u.stockCode}
              >
                {ekleniyor === u.stockCode ? 'Ekleniyor…' : 'Ekle'}
              </button>
            </div>
          )
        })}
      </div>

      {hata && <div className="cart-cross-error">{hata}</div>}
    </section>
  )
}
