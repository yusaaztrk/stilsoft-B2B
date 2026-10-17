'use client'

import React, { useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useCart } from '@/context/CartContext'
import { useStorefrontDisplay } from '@/context/StorefrontContext'
import { displayName, formatPrice, mediaUrl } from '@/lib/format'

export default function CartDrawer() {
  // `setInstallation` artık kullanılmıyor: montaj 2026-09-21'den beri kapatılamıyor.
  const { cart, isOpen, closeDrawer, updateQuantity, removeItem, isBusy } = useCart()
  const { deliveryPromise } = useStorefrontDisplay()

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        closeDrawer()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, closeDrawer])

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  const items = cart?.lines ?? []
  const totalCount = items.reduce((sum, item) => sum + item.quantity, 0)
  const grandTotal = cart?.grandTotal ?? 0
  // Ürün toplamı ile montaj bedeli ayrı gösteriliyor; eski sepetlerde alan gelmeyebileceği
  // için ürün toplamı yoksa genel toplama düşülüyor.
  const installationTotal = cart?.installationTotal ?? 0
  const productTotal = cart?.productTotal ?? grandTotal - installationTotal
  const currency = cart?.currency ?? 'TRY'

  return (
    <div className="cart-drawer-backdrop" onClick={closeDrawer} role="dialog" aria-modal="true">
      <div
        className="cart-drawer-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Çekmece Başlığı */}
        <div className="cart-drawer-header">
          <div className="c-drawer-title">
            <h3>Sepetim</h3>
            <span className="c-drawer-badge">{totalCount} Ürün</span>
          </div>
          <button
            type="button"
            className="c-drawer-close"
            onClick={closeDrawer}
            aria-label="Sepeti Kapat"
          >
            ✕
          </button>
        </div>

        {/*
          Teslimat vaadi bayi panelinden geliyor (2026-09-20). Önce sabit "Randevulu Servis"
          yazıyordu; müşterinin asıl sorusu "ne zaman gelir" ve cevabı ödeme adımına kadar
          hiçbir yerde görünmüyordu.
        */}
        <div className="cart-drawer-perk">
          <span>🚚</span>
          <span><b>KKTC Geneli Ücretsiz Teslimat</b> &middot; {deliveryPromise}</span>
        </div>

        {/* Sepet İçeriği */}
        {items.length === 0 ? (
          <div className="cart-drawer-empty">
            <div className="c-empty-icon">🛍️</div>
            <h4>Sepetiniz Henüz Boş</h4>
            <p>Stilsoft kalitesiyle tanışmak için hemen alışverişe başlayın.</p>
            <button
              type="button"
              className="btn btn-dark"
              onClick={closeDrawer}
            >
              Alışverişe Devam Et
            </button>
          </div>
        ) : (
          <>
            {/* Ürün Listesi */}
            <div className="cart-drawer-items-list">
              {items.map((line) => {
                const img = mediaUrl(line.imageUrl)
                const name = displayName(line.name)
                return (
                  <div key={line.stockCode} className="cart-drawer-item">
                    <div className="c-item-thumb">
                      {img ? (
                        <Image
                          src={img}
                          alt={name}
                          width={64}
                          height={64}
                          style={{ objectFit: 'contain' }}
                        />
                      ) : (
                        <span className="c-thumb-placeholder">ST</span>
                      )}
                    </div>

                    <div className="c-item-details">
                      <div className="c-item-top">
                        <Link
                          href={`/urun/${line.slug}`}
                          className="c-item-name"
                          onClick={closeDrawer}
                        >
                          {name}
                        </Link>
                        <button
                          type="button"
                          className="c-item-remove"
                          onClick={() => removeItem(line.stockCode)}
                          disabled={isBusy}
                          title="Ürünü Sil"
                        >
                          ✕
                        </button>
                      </div>

                      <div className="c-item-meta">
                        <span className="c-stock-code">{line.stockCode}</span>
                        {/*
                          "Ücretsiz Montaj" artık yalnızca BEDELİ OLMAYAN üründe yazıyor.
                          Bedeli olanda (ör. televizyon) tutar yazılıyor: ücretsiz diyip
                          genel toplamda 300 TL fazla çıkarmak, ödeme adımında güven kıran
                          bir sürpriz olurdu.
                        */}
                        {/*
                          2026-09-21: rozet artık SEÇİM değil, DURUM. Montaj kapatılamıyor
                          (bkz. `CartService` — kapı sunucuda), bu yüzden tıklanabilir bir
                          düğme yanıltıcı olurdu: basınca hiçbir şey değişmezdi.
                        */}
                        {line.isInstallable && (
                          <span className="c-install-badge is-on is-kilitli">
                            ✓ Montaj dahil
                            {line.installationFeeUnit > 0
                              ? ` (${formatPrice(line.installationFeeUnit, currency)})`
                              : ' (ücretsiz)'}
                          </span>
                        )}
                      </div>

                      <div className="c-item-bottom">
                        {/* Miktar Değiştirici */}
                        <div className="c-qty-controls">
                          <button
                            type="button"
                            disabled={isBusy || line.quantity <= 1}
                            onClick={() => updateQuantity(line.stockCode, line.quantity - 1)}
                          >
                            –
                          </button>
                          <span>{line.quantity}</span>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => updateQuantity(line.stockCode, line.quantity + 1)}
                          >
                            +
                          </button>
                        </div>

                        {/* Fiyat */}
                        <div className="c-item-price num">
                          {formatPrice(line.lineGross, line.currency || currency)}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Çekmece Alt Özeti & Eylem Butonları */}
            <div className="cart-drawer-footer">
              <div className="c-footer-summary">
                <div className="c-summary-row">
                  <span>Ara Toplam</span>
                  <span className="num">{formatPrice(productTotal, currency)}</span>
                </div>
                {/*
                  Montaj bedeli varsa AYRI satır. Önceden "Ara Toplam" olarak genel toplamın
                  kendisi yazılıyordu; iki satır aynı rakamı gösterdiği için özet hiçbir şey
                  anlatmıyordu. Bedeli olmayan üründe montaj ücretsiz, satır çıkmaz.
                */}
                {installationTotal > 0 && (
                  <div className="c-summary-row">
                    <span>Montaj / Kurulum</span>
                    <span className="num">{formatPrice(installationTotal, currency)}</span>
                  </div>
                )}
                <div className="c-summary-row">
                  <span>Teslimat &amp; Nakliye</span>
                  <span className="free-shipping">Ücretsiz</span>
                </div>
                <div className="c-summary-row total">
                  <span>Genel Toplam (KDV Dahil)</span>
                  <span className="total-amount num">{formatPrice(grandTotal, currency)}</span>
                </div>
              </div>

              <div className="c-footer-actions">
                <Link
                  href="/odeme"
                  className="btn btn-dark btn-checkout-drawer"
                  onClick={closeDrawer}
                >
                  <span>Siparişi Tamamla</span>
                  <span>→</span>
                </Link>
                <Link
                  href="/sepet"
                  className="btn btn-line btn-view-cart"
                  onClick={closeDrawer}
                >
                  Sepet Detayına Git
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
