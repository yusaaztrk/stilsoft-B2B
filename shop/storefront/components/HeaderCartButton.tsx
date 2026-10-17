'use client'

import React from 'react'
import Link from 'next/link'
import { useCart } from '@/context/CartContext'
import { formatPrice } from '@/lib/format'

/**
 * `lib/cart.ts`'nin `emptyCart` sabitini BİLEREK içe aktarmıyoruz: o dosya `next/headers`
 * kullanan `getCart()`'ı da barındırıyor ve bir 'use client' bileşenden ORADAN herhangi bir
 * şey içe aktarmak (tip dışı) tüm modülü istemci paketine sokup derlemeyi kırıyor
 * ("next/headers" yalnızca sunucu bileşenlerinde kullanılabilir). Boş sepet hâli burada,
 * sıfır bağımlılıkla, satır içi hesaplanıyor.
 */
export default function HeaderCartButton() {
  const { cart, openDrawer } = useCart()

  const totalItems = cart ? cart.itemCount || cart.lines.reduce((s, i) => s + i.quantity, 0) : 0
  const grandTotal = cart?.grandTotal ?? 0
  const currency = cart?.currency ?? 'TRY'

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    openDrawer()
  }

  return (
    <Link
      href="/sepet"
      className="head-cart-link"
      onClick={handleClick}
      aria-label={`Sepetim: ${totalItems} ürün, ${formatPrice(grandTotal, currency)}`}
    >
      <div className="cart-icon-wrapper">
        <svg
          width="21"
          height="21"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8" cy="21" r="1.2" />
          <circle cx="19" cy="21" r="1.2" />
          <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
        </svg>
        {totalItems > 0 && <span className="cart-badge-count num">{totalItems}</span>}
      </div>
      <div className="cart-text-details">
        <span className="c-text-label">Sepetim</span>
        <span className="c-text-val num">{formatPrice(grandTotal, currency)}</span>
      </div>
    </Link>
  )
}
