'use client'

import { useEffect } from 'react'
import { setChatProduct, type ChatProduct } from '@/lib/chatContext'

/**
 * Ürün sayfası açıkken "şu an bakılan ürün"ü WhatsApp balonuna bildirir (2026-09-21).
 *
 * Sayfadan çıkılınca temizliyor: aksi hâlde müşteri ürün sayfasından ana sayfaya geçtikten
 * sonra balona bastığında alakasız bir ürün adı yollanırdı — yanlış bağlam, bağlamsızlıktan kötü.
 */
export default function ChatProductBeacon(props: ChatProduct) {
  const { name, stockCode, price, url } = props

  useEffect(() => {
    setChatProduct({ name, stockCode, price, url })
    return () => setChatProduct(null)
  }, [name, stockCode, price, url])

  /*
    GÖVDEYE "ürün detay sayfasındayız" İŞARETİ (2026-09-21).

    NEDEN: sol alttaki "Ara" ve sağ alttaki WhatsApp düğmeleri sabit konumlu ve telefonda
    tam da satın alma alanının (fiyat + "Sepete ekle") üstüne biniyordu — kullanıcı bildirimi.
    Sayfa kaydıkça satın alma alanı yer değiştirdiği için tek bir "şu kadar yukarı" hesabı
    yapılamıyor; çözüm, bu sayfada düğmeleri kalıcı olarak yukarı almak.

    NEDEN BURADA: bu bileşen ürün detay sayfasında KOŞULSUZ çiziliyor (yapışkan çubuk
    tükenen üründe çizilmiyor, o yüzden ona bağlanamazdı). Anlamı da tam olarak bu:
    "şu an bir ürün inceleniyor".
  */
  useEffect(() => {
    const govde = document.body
    govde.classList.add('urun-detay')
    return () => govde.classList.remove('urun-detay')
  }, [])

  return null
}
