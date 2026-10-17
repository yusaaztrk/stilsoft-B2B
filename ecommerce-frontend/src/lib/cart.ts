import type { ErpProductListItem } from './api'

export type CartItem = ErpProductListItem & {
  qty: number
  variantKey?: string
  variantLabel?: string
}

export const CART_EVENT = 'ecom-cart-changed'
export const CART_ADD_EVENT = 'ecom-cart-added'

function getCartKey(): string {
  const token = localStorage.getItem('ecom_member_token')
  if (!token) {
    return 'ecom_cart_guest'
  }
  const raw = localStorage.getItem('ecom_member_user')
  if (raw) {
    try {
      const u = JSON.parse(raw)
      if (u?.id) {
        return `ecom_cart_${u.id}`
      }
    } catch {
      // ignore
    }
  }
  return 'ecom_cart_guest'
}

export function readCart(): CartItem[] {
  try {
    const key = getCartKey()
    const raw = localStorage.getItem(key)
    const items = raw ? JSON.parse(raw) : []
    return Array.isArray(items) ? items.filter((x) => x?.id && Number(x.qty) > 0) : []
  } catch {
    return []
  }
}

export function writeCart(items: CartItem[]) {
  const key = getCartKey()
  localStorage.setItem(key, JSON.stringify(items))
  window.dispatchEvent(new CustomEvent(CART_EVENT))
}

export function addToCart(
  product: ErpProductListItem,
  qty = 1,
  variantKey?: string,
  variantLabel?: string,
  overridePrice?: number,
  overrideImage?: string
) {
  const items = readCart()
  const existing = items.find(
    (x) =>
      x.id === product.id &&
      String(x.tenantCode || '').toUpperCase() === String(product.tenantCode || '').toUpperCase() &&
      x.variantKey === variantKey
  )
  if (existing) {
    existing.qty += qty
  } else {
    items.push({
      ...product,
      qty,
      variantKey,
      variantLabel,
      unitPrice: overridePrice !== undefined ? overridePrice : product.unitPrice,
      imageUrl: overrideImage || product.imageUrl,
    })
  }
  writeCart(items)
  window.dispatchEvent(new CustomEvent(CART_ADD_EVENT, { detail: { product, qty } }))
}

export function cartCount(items = readCart()) {
  return items.reduce((sum, item) => sum + item.qty, 0)
}
