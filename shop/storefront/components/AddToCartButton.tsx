'use client'

import { useState } from 'react'
import { useCart } from '@/context/CartContext'
import { formatPrice } from '@/lib/format'

type Props = {
  stockCode: string
  className?: string
  label?: string
  /**
   * Ürün montajlı mı — ERP'deki `IsInstallable`. True ise düğmenin üstünde
   * "Montaj istiyorum" seçimi çıkar.
   */
  installable?: boolean
  /** Bir adet için montaj bedeli, KDV dahil. 0 ise montaj ücretsiz. */
  installationFee?: number | null
  currency?: string
  /** Adet seçici (ürün detay sayfası). Kartlarda kapalı: liste ekranı sade kalmalı. */
  showQuantity?: boolean
  /**
   * Montaj seçimini bu düğmede gösterme. Mobil yapışkan çubuk için: aynı sayfada seçim
   * zaten yukarıda duruyor, ikinci bir kutu iki farklı cevap verilebilen bir soru olurdu.
   */
  hideInstallOption?: boolean
}

/**
 * "Sepete ekle".
 *
 * İKİ ŞEY EKLENDİ (2026-09-09):
 *
 * 1. MONTAJ SEÇİMİ. Önceden montajı olan ürünün bedeli müşteriye sorulmadan ekleniyordu.
 *    B2B sipariş ekranında bu seçim baştan beri var ("Montaj istiyorum / istemiyorum") ve
 *    varsayılanı "istemiyorum"; vitrin de aynı davranışa getirildi. Seçim sepete ekleme
 *    isteğiyle birlikte gidiyor, sepette de değiştirilebiliyor.
 *
 * 2. SUNUCUNUN AÇIKLAMASI. Eskiden her hata "Sepete eklenemedi." oluyordu; oysa mağaza
 *    API'si "stokta yok", "yeterli adet kalmadı", "satışta değil" diye ayrı ayrı cevap
 *    veriyor. Müşteri hangisi olduğunu bilmeden ne yapacağını da bilemiyordu.
 */
export default function AddToCartButton({
  stockCode,
  className,
  label = 'Sepete ekle',
  installable = false,
  installationFee = 0,
  currency = 'TRY',
  showQuantity = false,
  hideInstallOption = false,
}: Props) {
  const { addToCart, isBusy } = useCart()
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [quantity, setQuantity] = useState(1)

  /*
    MONTAJ ARTIK SEÇİM DEĞİL (2026-09-21 kullanıcı kararı: "montajlı ürünlerde montaj
    istiyorum otomatik seçili gelecek, montajı kapatamayacak, frontta full basılı gelecek").

    2026-09-09'da tersi karar verilmişti (varsayılan "istemiyorum"); geri alındı. Montajsız
    teslim edilen ankastre cihaz sahada kuruluma kadar bekliyor, sonra ücretsiz servis
    çağrısı olarak geri dönüyordu.

    Burada durum değişkeni YOK: montajlı ürün her zaman montajlı ekleniyor. Kapıyı asıl tutan
    mağaza API'si (`CartService`), bu yalnız ekranda doğru bilgiyi göstermek için.
  */
  const wantsInstallation = installable

  const fee = Number(installationFee ?? 0)
  const showInstall = installable && !hideInstallOption

  const onClick = async () => {
    if (state === 'busy' || isBusy) return
    setState('busy')
    setError(null)

    const result = await addToCart(stockCode, quantity, wantsInstallation)

    if (result.ok) {
      setState('done')
      window.setTimeout(() => setState('idle'), 2500)
      return
    }

    setError(result.message ?? 'Ürün sepete eklenemedi.')
    setState('idle')
  }

  return (
    <>
      {showInstall && (
        /*
          "FULL BASILI" görünüm: kutu işaretli, kilitli ve dolu renkli. `disabled` bir
          checkbox tarayıcıda soluk çizilir ve "kapalı/erişilemez" izlenimi verir — oysa
          burada anlatılmak istenen "bu hizmet dahil". Onun için gerçek kutu gizlendi,
          yerine dolu bir onay rozeti kondu; `aria-*` ile ekran okuyucuya da aynı şey söyleniyor.
        */
        <div className="montaj-choice montaj-choice-kilitli" role="note" aria-label="Montaj dahildir">
          <span className="montaj-tik" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          {/*
            2026-09-21: altındaki "Yetkili teknisyen randevulu kurulum — bu üründe montaj
            zorunludur." açıklaması kaldırıldı (kullanıcı isteği). Satır her kartta ve her
            ürün sayfasında aynı yazıyor, iki satır yer kaplıyor ve montajın zaten dahil
            olduğu bilgisini tekrar ediyordu. Bedel bilgisi (ücretsiz / +tutar) kaldı,
            çünkü o üründen ürüne değişiyor.
          */}
          <span>
            Montaj dahil
            <b>{fee > 0 ? ` +${formatPrice(fee, currency)}` : ' (ücretsiz)'}</b>
          </span>
        </div>
      )}

      {showQuantity && (
        <div className="qty-picker" role="group" aria-label="Adet">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1}
            aria-label="Adeti azalt"
          >
            −
          </button>
          <span className="num" aria-live="polite">{quantity}</span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(99, q + 1))}
            disabled={quantity >= 99}
            aria-label="Adeti artır"
          >
            +
          </button>
        </div>
      )}

      <button
        className={className ?? 'btn btn-dark'}
        type="button"
        onClick={() => void onClick()}
        disabled={state === 'busy' || isBusy}
      >
        {state === 'busy' || isBusy ? 'Ekleniyor…' : state === 'done' ? 'Sepete eklendi ✓' : label}
      </button>

      {error && <span className="add-error" role="alert">{error}</span>}
    </>
  )
}
