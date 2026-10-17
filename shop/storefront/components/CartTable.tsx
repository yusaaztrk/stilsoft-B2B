'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { displayName, formatPrice, mediaUrl } from '@/lib/format'
import type { CartView } from '@/lib/cart'
import { useStorefrontDisplay } from '@/context/StorefrontContext'

/**
 * Sepet TABLO olarak gösteriliyor — kart dizisi olarak değil. Dar ekranda tablo karta
 * dönüştürülmüyor, yatay kaydırılıyor: satır/sütun ilişkisi bozulmadan kalıyor.
 */
export default function CartTable({ initial }: { initial: CartView }) {
  const router = useRouter()
  const { deliveryPromise } = useStorefrontDisplay()
  const [cart, setCart] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /*
   * Başarısız istek artık SESSİZ DEĞİL.
   *
   * Önceden yalnızca `res.ok` durumunda sepet güncelleniyordu; hata hâlinde ekranda hiçbir
   * şey olmuyordu. Müşteri adet düğmesine basıyor, sayı değişmiyor ve sebebini göremiyordu
   * (oturum düşmüş, stok bitmiş, sunucuya ulaşılamamış). Sunucu zaten açıklayıcı bir metin
   * gönderiyor; ekranda gösterilmesi yetiyordu.
   */
  const call = async (url: string, method: string, body?: unknown) => {
    setBusy(url)
    setError(null)
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })

      const data = await res.json().catch(() => null)

      if (res.ok) {
        if (data) setCart(data)
        router.refresh()
        return
      }

      setError(
        typeof data?.message === 'string' && data.message.trim()
          ? data.message
          : 'İşlem tamamlanamadı. Lütfen tekrar deneyin.',
      )
    } catch {
      setError('Bağlantı kurulamadı. İnternetinizi kontrol edip tekrar deneyin.')
    } finally {
      setBusy(null)
    }
  }

  if (cart.lines.length === 0) {
    return (
      <div className="empty">
        <p>Sepetiniz boş.</p>
        <Link className="btn btn-dark" href="/urunler">
          Alışverişe başla
        </Link>
      </div>
    )
  }

  return (
    <>
      {cart.removedStockCodes.length > 0 && (
        <div className="cart-notice">
          Sepetinizdeki {cart.removedStockCodes.length} ürün satıştan kalktığı için çıkarıldı.
        </div>
      )}

      {error && (
        <div className="cart-notice cart-notice-error" role="alert">
          {error}
        </div>
      )}

      <div className="cart-scroll">
        <table className="cart-table">
          <thead>
            <tr>
              <th>Ürün</th>
              <th>Stok Kodu</th>
              <th className="right">Birim Fiyat</th>
              <th className="center">Adet</th>
              <th className="right">Tutar</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {cart.lines.map((line) => {
              const img = mediaUrl(line.imageUrl)
              return (
                <tr key={line.stockCode}>
                  <td>
                    <div className="cart-product">
                      <span className="cart-thumb">
                        {img ? <Image src={img} alt={displayName(line.name)} width={56} height={56} /> : null}
                      </span>
                      <div className="cart-product-text">
                        <Link href={`/urun/${line.slug}`}>{displayName(line.name)}</Link>

                        {/*
                          MONTAJ ARTIK KAPATILAMIYOR (2026-09-21 kullanıcı kararı).

                          Önceden burada açılıp kapanan bir onay kutusu vardı (2026-09-09
                          kararı). O karar geri alındı: montajsız teslim edilen ankastre cihaz
                          sahada kuruluma kadar bekliyor, sonra bedeli tahsil edilmemiş bir
                          servis çağrısı olarak geri dönüyordu.

                          Satır artık bilgi; kapıyı mağaza API'si tutuyor (`CartService`),
                          burada yalnız doğru bilgi gösteriliyor.
                        */}
                        {line.isInstallable && (
                          <span className="montaj-line montaj-line-kilitli" role="note">
                            <span className="montaj-tik" aria-hidden="true">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 6 9 17l-5-5" />
                              </svg>
                            </span>
                            <span>
                              Montaj dahil
                              {line.installationFeeUnit > 0
                                ? ` (+${formatPrice(line.installationFeeUnit, line.currency)} / adet)`
                                : ' (ücretsiz)'}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="mono">{line.stockCode}</td>
                  <td className="right num">{formatPrice(line.unitGrossPrice, line.currency)}</td>
                  <td className="center">
                    <div className="qty">
                      <button
                        type="button"
                        aria-label="Azalt"
                        disabled={busy !== null}
                        onClick={() =>
                          void call(`/api/cart/items/${encodeURIComponent(line.stockCode)}`, 'PUT', {
                            quantity: line.quantity - 1,
                          })
                        }
                      >
                        −
                      </button>
                      <span className="num">{line.quantity}</span>
                      <button
                        type="button"
                        aria-label="Artır"
                        disabled={busy !== null}
                        onClick={() =>
                          void call(`/api/cart/items/${encodeURIComponent(line.stockCode)}`, 'PUT', {
                            quantity: line.quantity + 1,
                          })
                        }
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="right num strong">{formatPrice(line.lineGross, line.currency)}</td>
                  <td className="right">
                    <button
                      className="cart-remove"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void call(`/api/cart/items/${encodeURIComponent(line.stockCode)}`, 'DELETE')}
                    >
                      Kaldır
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="cart-foot">
        <button className="cart-clear" type="button" disabled={busy !== null} onClick={() => void call('/api/cart', 'DELETE')}>
          Sepeti boşalt
        </button>

        <div className="cart-summary">
          <div>
            <span>Ara toplam</span>
            <span className="num">{formatPrice(cart.subTotalNet, cart.currency)}</span>
          </div>
          <div>
            <span>KDV</span>
            <span className="num">{formatPrice(cart.vatTotal, cart.currency)}</span>
          </div>
          {/*
            MONTAJ BEDELİ AYRI SATIRDA GÖSTERİLİYOR.
            Tutar KDV DAHİL girildiği için KDV satırına katılmaz; genel toplama olduğu gibi
            eklenir (B2B sipariş ekranındaki kuralın aynısı). Bedeli olmayan ürünlerde
            (ankastre, beyaz eşya) montaj ücretsiz ve bu satır hiç çıkmaz.
          */}
          {cart.installationTotal > 0 && (
            <div>
              <span>Montaj / kurulum bedeli</span>
              <span className="num">{formatPrice(cart.installationTotal, cart.currency)}</span>
            </div>
          )}
          {/*
            TESLİMAT SATIRI (2026-09-21): toplamın hemen üstünde "Ücretsiz". Müşteri sepette
            "kargo kaç para?" diye durup ödeme adımına gitmiyordu; sürpriz olmadığını burada
            görsün. Süre vaadi panel ayarından.
          */}
          <div>
            <span>Teslimat{deliveryPromise ? <small className="cart-delivery-note"> · {deliveryPromise}</small> : null}</span>
            <span className="num cart-free">Ücretsiz</span>
          </div>
          <div className="total">
            <span>Toplam</span>
            <span className="num">{formatPrice(cart.grandTotal, cart.currency)}</span>
          </div>
          <Link className="btn btn-dark" href="/odeme">
            Alışverişi tamamla
          </Link>
          <div className="cart-assurance">3D Secure güvenli ödeme · Havale/EFT · Yetkili montaj · 3 yıl garanti</div>
        </div>
      </div>
    </>
  )
}
