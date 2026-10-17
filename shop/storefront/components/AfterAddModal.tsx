'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCart } from '@/context/CartContext'
import { formatPrice } from '@/lib/format'

/*
  SEPETE EKLENDİ — SEÇİM PENCERESİ (2026-10-04 kullanıcı isteği: "sepete ürün atılınca modal
  gelsin, seçip üyelik oluşturabilsin, bir de direkt alışveriş koyalım").

  Yalnız ÜYE OLMAYAN ziyaretçiye ve oturum başına BİR KEZ açılır (bkz. CartContext.afterAdd);
  her eklemede araya giren pencere satışı durdurur. En büyük düğme "hemen satın al": üyelik
  sormadan ödemeye götürür (ödeme sayfası yalnız ad, telefon ve adres ister). Üyelik ikinci
  seçenek; iki yolu da (SMS kodu / e-posta) tek tıkla açar.
*/
export default function AfterAddModal() {
  const { afterAddOpen, closeAfterAdd, openDrawer, cart } = useCart()
  const pathname = usePathname()
  const acildigiSayfa = useRef<string | null>(null)

  /*
    Bağlantılar pencereyi TIKLAMADA kapatmıyor: bağlantı tıklama anında DOM'dan kalkınca
    istemci yönlendirmesi yarıda kalıyordu (pencere kapanıyor, sayfa yerinde kalıyordu).
    Pencere, açıldığı sayfadan başka bir sayfaya geçilince kendiliğinden kapanır.
  */
  useEffect(() => {
    if (!afterAddOpen) {
      acildigiSayfa.current = null
      return
    }
    if (acildigiSayfa.current === null) acildigiSayfa.current = pathname
    else if (acildigiSayfa.current !== pathname) closeAfterAdd()
  }, [afterAddOpen, pathname, closeAfterAdd])

  useEffect(() => {
    if (!afterAddOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAfterAdd()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [afterAddOpen, closeAfterAdd])

  if (!afterAddOpen) return null

  const adet = cart?.lines?.reduce((t, l) => t + (Number(l.quantity) || 0), 0) ?? 0
  const toplam = cart?.grandTotal ?? null

  return (
    <div className="aam-backdrop" role="presentation" onClick={closeAfterAdd}>
      <div
        className="aam-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aam-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="aam-close" onClick={closeAfterAdd} aria-label="Kapat">
          ×
        </button>

        <div className="aam-ok">
          <span className="aam-check" aria-hidden="true">✓</span>
          <div>
            <h2 id="aam-title">Ürün sepetinize eklendi</h2>
            {adet > 0 && (
              <p className="aam-sub">
                Sepetinizde {adet} ürün{toplam != null ? ` · ${formatPrice(toplam, cart?.currency ?? 'TRY')}` : ''}
              </p>
            )}
          </div>
        </div>

        <Link href="/odeme?yol=misafir" className="btn btn-dark aam-primary">
          Hemen satın al
          <small>Üyelik gerekmez — ad, telefon ve adres yeterli</small>
        </Link>

        <div className="aam-or">ya da üye olun, siparişlerinizi takip edin</div>

        {/* Kodsuz üyelik (2026-10-05): tek "Üye ol" — telefon + şifre, e-posta isteğe bağlı. */}
        <div className="aam-member">
          <Link href={`/uye-ol?donus=${encodeURIComponent('/odeme')}`} className="btn btn-line">
            Üye ol
          </Link>
          <Link href={`/giris?donus=${encodeURIComponent('/odeme')}`} className="btn btn-line">
            Giriş yap
          </Link>
        </div>

        <div className="aam-links">
          <button type="button" className="aam-link" onClick={closeAfterAdd}>
            Alışverişe devam et
          </button>
          <button
            type="button"
            className="aam-link"
            onClick={() => {
              closeAfterAdd()
              openDrawer()
            }}
          >
            Sepeti gör
          </button>
        </div>
      </div>
    </div>
  )
}
