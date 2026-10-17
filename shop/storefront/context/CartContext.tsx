'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { CartView } from '@/lib/cart'
import { displayName } from '@/lib/format'
import { trackAddToCart } from '@/lib/track'

/**
 * Sepet işleminin sonucu.
 *
 * Önceden düz `boolean` dönülüyordu ve ekranda hep aynı "Sepete eklenemedi." yazıyordu.
 * Oysa sunucu ayrı ayrı cevaplar veriyor: "Ürün şu anda satışta değil", "Bu ürün şu anda
 * stokta yok", "Stokta yeterli adet kalmadı". Müşteri hangisi olduğunu bilmeden ne
 * yapacağını da bilemiyordu — mesaj artık olduğu gibi taşınıyor.
 */
export type CartActionResult = { ok: boolean; message?: string }

type CartContextType = {
  cart: CartView | null
  isOpen: boolean
  isBusy: boolean
  openDrawer: () => void
  closeDrawer: () => void
  addToCart: (stockCode: string, quantity?: number, wantsInstallation?: boolean) => Promise<CartActionResult>
  updateQuantity: (stockCode: string, quantity: number) => Promise<CartActionResult>
  /** Sepetteki satırın "Montaj istiyorum" seçimini değiştirir. */
  setInstallation: (stockCode: string, wantsInstallation: boolean) => Promise<CartActionResult>
  removeItem: (stockCode: string) => Promise<CartActionResult>
  clearCart: () => Promise<CartActionResult>
  refreshCart: () => Promise<CartView | null>
  /**
   * Sepete ekledikten sonra üye olmayana çıkan seçim penceresi (2026-10-04): hemen satın al
   * (üyeliksiz), SMS / e-posta ile üye ol ya da alışverişe devam. Oturum başına bir kez
   * açılır; sonraki eklemelerde her zamanki sepet çekmecesi açılır.
   */
  afterAddOpen: boolean
  closeAfterAdd: () => void
}

const AFTER_ADD_SHOWN_KEY = "stilsoft.afterAddShown"

/** Sunucunun gönderdiği açıklamayı çıkarır; yoksa duruma uygun genel bir metin döner. */
async function readMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json()
    const message = typeof data?.message === 'string' ? data.message.trim() : ''
    if (message) return message
  } catch {
    // gövde JSON değilse aşağıdaki genel metin kullanılır
  }
  return fallback
}

const CartContext = createContext<CartContextType | undefined>(undefined)

export function CartProvider({
  children,
  initialCart,
}: {
  children: React.ReactNode
  initialCart?: CartView | null
}) {
  const [cart, setCart] = useState<CartView | null>(initialCart ?? null)
  const [isOpen, setIsOpen] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  /** Sepeti yeniler; yeni sepeti de döner (sepete ekleme ölçümü satırın fiyatını buradan alıyor). */
  const refreshCart = useCallback(async (): Promise<CartView | null> => {
    try {
      const res = await fetch('/api/cart', { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as CartView
        setCart(data)
        return data
      }
    } catch {
      // ignore
    }
    return null
  }, [])

  useEffect(() => {
    // Initial fetch if initialCart not provided
    if (!initialCart) {
      refreshCart()
    }
  }, [initialCart, refreshCart])

  const openDrawer = () => setIsOpen(true)
  const closeDrawer = () => setIsOpen(false)

  // Üyelik durumu yalnız bu pencere için: üye olan müşteriye "üye ol" sorulmaz.
  const [isMember, setIsMember] = useState<boolean | null>(null)
  const [afterAddOpen, setAfterAddOpen] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch('/api/account/me')
      .then((res) => (res.ok ? res.json() : { member: null }))
      .then((data) => {
        if (!cancelled) setIsMember(Boolean(data?.member))
      })
      .catch(() => {
        if (!cancelled) setIsMember(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  const closeAfterAdd = () => setAfterAddOpen(false)

  /** Ekleme sonrası: üye değilse ve bu oturumda gösterilmediyse seçim penceresi, yoksa çekmece. */
  const afterAdd = () => {
    let shown = false
    try {
      shown = sessionStorage.getItem(AFTER_ADD_SHOWN_KEY) === '1'
    } catch {
      shown = false
    }
    if (isMember === false && !shown) {
      try {
        sessionStorage.setItem(AFTER_ADD_SHOWN_KEY, '1')
      } catch {
        // gizli pencerede depolama kapalı olabilir; pencere yine bir kez açılır
      }
      setAfterAddOpen(true)
      return
    }
    setIsOpen(true)
  }

  const addToCart = async (
    stockCode: string,
    quantity = 1,
    wantsInstallation = false,
  ): Promise<CartActionResult> => {
    setIsBusy(true)
    try {
      const res = await fetch('/api/cart/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stockCode, quantity, wantsInstallation }),
      })
      if (res.ok) {
        const yeni = await refreshCart()
        /*
          Reklam ölçümü (2026-10-15). Fiyat ekrandaki karttan değil sunucunun hesapladığı
          sepet satırından: kampanya ve montaj kuralları orada uygulanıyor. Satır
          bulunamazsa (ör. sepet okunamadı) olay gönderilmiyor; yanlış tutar, hiç tutar
          olmamasından kötü.
        */
        const satir = yeni?.lines.find((l) => l.stockCode === stockCode)
        if (satir) {
          trackAddToCart({
            stockCode,
            name: displayName(satir.name),
            price: satir.unitGrossPrice,
            quantity,
            category: satir.categorySlug,
          })
        }
        afterAdd()
        return { ok: true }
      }
      return { ok: false, message: await readMessage(res, 'Ürün sepete eklenemedi.') }
    } catch {
      return { ok: false, message: 'Bağlantı kurulamadı. İnternetinizi kontrol edip tekrar deneyin.' }
    } finally {
      setIsBusy(false)
    }
  }

  const updateQuantity = async (stockCode: string, quantity: number): Promise<CartActionResult> => {
    setIsBusy(true)
    try {
      const res = await fetch(`/api/cart/items/${encodeURIComponent(stockCode)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity }),
      })
      if (res.ok) {
        await refreshCart()
        return { ok: true }
      }
      return { ok: false, message: await readMessage(res, 'Adet güncellenemedi.') }
    } catch {
      return { ok: false, message: 'Bağlantı kurulamadı.' }
    } finally {
      setIsBusy(false)
    }
  }

  const setInstallation = async (
    stockCode: string,
    wantsInstallation: boolean,
  ): Promise<CartActionResult> => {
    setIsBusy(true)
    try {
      const res = await fetch(`/api/cart/items/${encodeURIComponent(stockCode)}/montaj`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wantsInstallation }),
      })
      if (res.ok) {
        await refreshCart()
        return { ok: true }
      }
      return { ok: false, message: await readMessage(res, 'Montaj seçimi kaydedilemedi.') }
    } catch {
      return { ok: false, message: 'Bağlantı kurulamadı.' }
    } finally {
      setIsBusy(false)
    }
  }

  const removeItem = async (stockCode: string): Promise<CartActionResult> => {
    setIsBusy(true)
    try {
      const res = await fetch(`/api/cart/items/${encodeURIComponent(stockCode)}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        await refreshCart()
        return { ok: true }
      }
      return { ok: false, message: await readMessage(res, 'Ürün sepetten çıkarılamadı.') }
    } catch {
      return { ok: false, message: 'Bağlantı kurulamadı.' }
    } finally {
      setIsBusy(false)
    }
  }

  const clearCart = async (): Promise<CartActionResult> => {
    setIsBusy(true)
    try {
      const res = await fetch('/api/cart', {
        method: 'DELETE',
      })
      if (res.ok) {
        await refreshCart()
        return { ok: true }
      }
      return { ok: false, message: await readMessage(res, 'Sepet boşaltılamadı.') }
    } catch {
      return { ok: false, message: 'Bağlantı kurulamadı.' }
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <CartContext.Provider
      value={{
        cart,
        isOpen,
        isBusy,
        openDrawer,
        afterAddOpen,
        closeAfterAdd,
        closeDrawer,
        addToCart,
        updateQuantity,
        setInstallation,
        removeItem,
        clearCart,
        refreshCart,
      }}
    >
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error('useCart must be used within a CartProvider')
  }
  return context
}
