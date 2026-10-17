'use client'

import { useEffect, useRef, useState } from 'react'
import AddToCartButton from '@/components/AddToCartButton'

/*
  MOBİLDE YAPIŞKAN SATIN ALMA ÇUBUĞU (2026-09-21).

  SORUN: telefonda ürün sayfası uzun — galeri, fiyat, güven kutusu, teknik özellikler (33
  satıra kadar), set önerisi, benzer ürünler. Müşteri teknik özellikleri okumaya indiğinde
  "Sepete ekle" düğmesi çoktan yukarıda kalıyor. Karar verdiği an ile düğme arasında bir
  ekran dolusu kaydırma var; o kaydırmayı yapmayan müşteri satın almıyor.

  ÇÖZÜM: düğme ekrandan çıkınca altta fiyat + "Sepete ekle" çubuğu beliriyor.

  NEDEN GÖZLEMCİ (IntersectionObserver), KAYDIRMA DİNLEYİCİSİ DEĞİL: kaydırma olayı her
  pikselde tetiklenir ve düşük donanımlı telefonda sayfayı takılmalı gösterir. Gözlemci
  yalnız görünürlük değiştiğinde çalışıyor.

  NEDEN MASAÜSTÜNDE YOK: orada düğme zaten ilk ekranda ve sayfa iki sütun; çubuk yalnız
  ekranı daraltırdı. Görünürlük tamamen CSS'te (`@media`), burada değil.

  MONTAJ SEÇİMİ ÇUBUKTA GÖSTERİLMİYOR (`hideInstallOption`): aynı soruya iki ayrı yerde
  iki farklı cevap verilebilmesi, sepete yanlış satır eklenmesi demek. Seçim yukarıda,
  ürünün yanında kalıyor.

  FLOATING DÜĞMELER: çubuk açıkken WhatsApp ve "Ara" düğmeleri yukarı kayıyor
  (`document.body` üzerindeki sınıf). Aksi hâlde üst üste biniyorlar.
*/

type Props = {
  stockCode: string
  name: string
  /** Biçimlendirilmiş fiyat; çubuk hesap yapmıyor, yalnız basıyor. */
  price: string
  installable?: boolean
  installationFee?: number | null
  currency?: string
}

const GOVDE_SINIFI = 'has-sticky-buy'

export default function ProductStickyBar({
  stockCode,
  name,
  price,
  installable,
  installationFee,
  currency,
}: Props) {
  const nisan = useRef<HTMLDivElement | null>(null)
  const [gorunur, setGorunur] = useState(false)

  useEffect(() => {
    const hedef = nisan.current
    if (!hedef) return

    // Eski tarayıcıda gözlemci yoksa çubuk hiç açılmıyor: sayfa eskisi gibi çalışır.
    if (typeof IntersectionObserver === 'undefined') return

    /*
      "GÖRÜNMÜYOR" TEK BAŞINA YETMİYOR.

      İlk sürüm yalnız `!isIntersecting` bakıyordu; telefonda satın alma alanı katlamanın
      ALTINDA kaldığı için nişan daha sayfa açılırken de görünmüyordu ve çubuk ürünü
      görmeden, sayfanın en başında açılıyordu.

      Doğru ölçüt YÖN: nişan ekranın ÜSTÜNDE kaldıysa (top < 0) müşteri düğmeyi geçmiştir,
      çubuk açılır. Aşağıda duruyorsa henüz oraya gelmemiştir, çubuk kapalı kalır.
    */
    const gozlemci = new IntersectionObserver(
      ([giris]) => setGorunur(!giris.isIntersecting && giris.boundingClientRect.top < 0),
      { rootMargin: '0px 0px -40px 0px' },
    )
    gozlemci.observe(hedef)
    return () => gozlemci.disconnect()
  }, [])

  useEffect(() => {
    const govde = document.body
    if (gorunur) govde.classList.add(GOVDE_SINIFI)
    else govde.classList.remove(GOVDE_SINIFI)
    return () => govde.classList.remove(GOVDE_SINIFI)
  }, [gorunur])

  return (
    <>
      {/* Nişan: asıl "Sepete ekle" alanının bittiği yer. Ekrandan çıkınca çubuk açılıyor. */}
      <div ref={nisan} className="sticky-buy-sentinel" aria-hidden="true" />

      <div className={`sticky-buy${gorunur ? ' is-visible' : ''}`}>
        <div className="sticky-buy-info">
          <span className="sticky-buy-name">{name}</span>
          <span className="sticky-buy-price num">{price}</span>
        </div>
        <AddToCartButton
          stockCode={stockCode}
          className="btn btn-dark sticky-buy-btn"
          installable={installable}
          installationFee={installationFee}
          currency={currency}
          hideInstallOption
        />
      </div>
    </>
  )
}
