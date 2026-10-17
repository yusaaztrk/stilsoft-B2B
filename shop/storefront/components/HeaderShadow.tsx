'use client'

import { useEffect } from 'react'

/**
 * Sayfa kaydırılınca yapışkan başlığa gölge veriyor.
 *
 * NEDEN: başlık `position: sticky` ve altında yalnızca saç teli bir çizgi var. İçerik altından
 * akıp giderken başlığın üstte DURDUĞU belli olmuyor; özellikle beyaz zeminli ürün kartları
 * başlığın altından geçerken iki katman tek düzlem gibi görünüyor.
 *
 * NEDEN JS: "yapışmış mı" durumu CSS'te doğrudan sorulamıyor. `animation-timeline: scroll()`
 * bunu CSS'le çözebiliyor ama tarayıcı desteği henüz her yerde yok; sınıf eklemek üç satır.
 *
 * Görsel bir ayrıntı olduğu için sunucudan render edilen hiçbir şeye dokunmuyor: bileşen
 * yalnızca <body> üzerine sınıf koyuyor, JavaScript çalışmazsa site aynen çalışmaya devam
 * ediyor, sadece gölge olmuyor.
 */
export default function HeaderShadow() {
  useEffect(() => {
    const onScroll = () => {
      document.body.classList.toggle('scrolled', window.scrollY > 8)
    }

    onScroll()
    // passive: kaydırma sırasında tarayıcının beklemesine gerek yok, olay hiçbir şeyi iptal etmiyor.
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return null
}
