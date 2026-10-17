import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CART_EVENT, readCart, writeCart, type CartItem } from '../lib/cart'
import { getMemberToken } from '../lib/api'

export function CartSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<CartItem[]>(() => readCart())
  const [design] = useState(() => {
    const saved = localStorage.getItem('ecom_store_design')
    return saved ? JSON.parse(saved) : { cargoFee: 150, freeShippingThreshold: 2000, currency: 'TL' }
  })
  const [calcResult, setCalcResult] = useState<any>(null)

  useEffect(() => {
    const sync = () => setItems(readCart())
    window.addEventListener(CART_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CART_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    if (items.length === 0) {
      setCalcResult(null)
      return
    }
    let active = true
    const fetchCalculation = async () => {
      try {
        const token = getMemberToken()
        const res = await fetch('/api/storefront/cart/calculate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            items: items.map((i) => ({
              productId: i.id,
              tenantCode: i.tenantCode || '',
              quantity: i.qty,
            })),
          }),
        })
        const json = await res.json()
        if (active && json?.success && json?.data) {
          setCalcResult(json.data)
        }
      } catch (err) {
        console.error('Cart calculation error:', err)
      }
    }
    fetchCalculation()
    return () => {
      active = false
    }
  }, [items])

  const subtotal = items.reduce((s, i) => s + (i.unitPrice ?? 0) * i.qty, 0)
  const cargoFee = design.cargoFee ?? 150
  const threshold = design.freeShippingThreshold ?? 2000
  const currency = design.currency || 'TL'
  const offlineAllFreeShipping = items.length > 0 && items.every(i => !!i.isFreeShipping)
  const shipping = (offlineAllFreeShipping || subtotal >= threshold || cargoFee === 0) ? 0 : cargoFee
  const total = subtotal + shipping

  const displaySubtotal = calcResult ? calcResult.subtotal : subtotal
  const displayCampaignDiscount = calcResult ? calcResult.totalCampaignDiscount : 0
  const displayShipping = calcResult ? calcResult.cargoFee : shipping
  const displayTotal = calcResult ? calcResult.finalTotal : total

  const updateQty = (id: string, tenantCode: string | undefined, variantKey: string | undefined, delta: number) => {
    const next = items.map((i) => (i.id === id && (i.tenantCode ?? '') === (tenantCode ?? '') && i.variantKey === variantKey ? { ...i, qty: Math.max(1, i.qty + delta) } : i))
    setItems(next)
    writeCart(next)
  }

  const removeItem = (id: string, tenantCode: string | undefined, variantKey: string | undefined) => {
    const next = items.filter((i) => !(i.id === id && (i.tenantCode ?? '') === (tenantCode ?? '') && i.variantKey === variantKey))
    setItems(next)
    writeCart(next)
  }

  return (
    <>
      <div className={`fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose} />
      <aside className={`fixed top-0 right-0 z-[80] h-full w-full max-w-md bg-white shadow-2xl flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary text-2xl">shopping_cart</span>
            <h2 className="text-lg font-bold text-on-surface">Sepetim</h2>
            <span className="bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{items.length}</span>
          </div>
          <button onClick={onClose} className="w-9 h-9 grid place-items-center rounded-full hover:bg-zinc-100 transition-colors">
            <span className="material-symbols-outlined text-zinc-500">close</span>
          </button>
        </div>

        {displayShipping === 0 && items.length > 0 ? (
          <div className="px-6 py-3 bg-emerald-50 border-b border-emerald-100 text-emerald-800 text-xs font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-600 text-lg">local_shipping</span>
            <span>Siparişinizde kargo ücretsiz!</span>
          </div>
        ) : (displaySubtotal < threshold && displayShipping > 0 && items.length > 0 ? (
          <div className="px-6 py-3 bg-surface-container-low border-b border-zinc-100">
            <div className="flex items-center gap-2 text-sm text-zinc-600 mb-2">
              <span className="material-symbols-outlined text-primary text-lg">local_shipping</span>
              <span>Ucretsiz kargoya <strong className="text-primary">{(threshold - displaySubtotal).toLocaleString('tr-TR')} {currency}</strong> kaldi.</span>
            </div>
            <div className="w-full bg-zinc-200 rounded-full h-1.5">
              <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${Math.min(100, (displaySubtotal / threshold) * 100)}%` }} />
            </div>
          </div>
        ) : null)}

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <span className="material-symbols-outlined text-6xl text-zinc-200 mb-4">shopping_cart</span>
              <p className="text-zinc-500 font-medium">Sepetiniz bos</p>
            </div>
          ) : (
            <>
              {/* Normal items */}
              {items.map((item) => {
                const calcLine = calcResult?.lines?.find((cl: any) => cl.productId === item.id && String(cl.tenantCode || '').toUpperCase() === String(item.tenantCode || '').toUpperCase())
                const hasDiscount = calcLine && calcLine.discountedPrice < calcLine.originalPrice
                const itemPrice = calcLine ? calcLine.discountedPrice : (item.unitPrice ?? 0)
                const originalPrice = calcLine ? calcLine.originalPrice : (item.unitPrice ?? 0)

                return (
                  <div key={`${item.tenantCode}-${item.id}-${item.variantKey || ''}`} className="flex gap-4 p-4 bg-surface-container-low rounded-xl border border-zinc-100 relative">
                    {calcLine?.campaignBadge && (
                      <span className="absolute -top-2 -right-2 bg-primary text-white text-[9px] font-bold px-2 py-0.5 rounded-full shadow-sm z-10">
                        {calcLine.campaignBadge}
                      </span>
                    )}
                    <div className="w-20 h-20 bg-surface-container rounded-lg overflow-hidden flex-shrink-0">
                      {item.imageUrl ? <img className="w-full h-full object-contain p-2" src={item.imageUrl} alt={item.name ?? ''} /> : null}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-sm text-on-surface truncate">{item.name ?? item.stockCode}</h4>
                      {item.variantLabel && (
                        <div className="mt-1">
                          <span className="inline-block px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded text-[10px] font-bold">
                            Varyant: {item.variantLabel}
                          </span>
                        </div>
                      )}
                      <p className="text-xs text-zinc-400 mt-1">{item.stockCode}</p>
                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center border border-zinc-200 rounded-lg">
                          <button onClick={() => updateQty(item.id, item.tenantCode, item.variantKey, -1)} className="w-8 h-8 grid place-items-center hover:bg-zinc-50 rounded-l-lg transition-colors">
                            <span className="material-symbols-outlined text-sm">remove</span>
                          </button>
                          <span className="w-8 h-8 grid place-items-center text-sm font-bold border-x border-zinc-200">{item.qty}</span>
                          <button onClick={() => updateQty(item.id, item.tenantCode, item.variantKey, 1)} className="w-8 h-8 grid place-items-center hover:bg-zinc-50 rounded-r-lg transition-colors">
                            <span className="material-symbols-outlined text-sm">add</span>
                          </button>
                        </div>
                        <div className="flex flex-col items-end">
                          {hasDiscount && (
                            <span className="text-xs text-zinc-400 line-through">{(originalPrice * item.qty).toLocaleString('tr-TR')} {currency}</span>
                          )}
                          <span className="font-bold text-primary text-sm">{(itemPrice * item.qty).toLocaleString('tr-TR')} {currency}</span>
                        </div>
                      </div>
                    </div>
                    <button onClick={() => removeItem(item.id, item.tenantCode, item.variantKey)} className="self-start w-7 h-7 grid place-items-center rounded-full hover:bg-error-container transition-colors">
                      <span className="material-symbols-outlined text-zinc-400 hover:text-error text-lg">delete</span>
                    </button>
                  </div>
                )
              })}

              {/* Gift items */}
              {calcResult?.giftItems?.map((gift: any) => (
                <div key={`gift-${gift.productId}`} className="flex gap-4 p-4 bg-emerald-50/50 rounded-xl border border-emerald-100 relative">
                  <span className="absolute -top-2 -right-2 bg-emerald-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full shadow-sm z-10">
                    Hediye Ürün
                  </span>
                  <div className="w-20 h-20 bg-white rounded-lg overflow-hidden border border-emerald-100 flex-shrink-0 flex items-center justify-center">
                    {gift.imageUrl ? <img className="w-full h-full object-contain p-2" src={gift.imageUrl} alt={gift.productName} /> : (
                      <span className="material-symbols-outlined text-emerald-400 text-3xl">featured_seasonal_and_gifts</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-sm text-emerald-900 truncate">{gift.productName}</h4>
                    <p className="text-xs text-emerald-600 mt-1 font-bold">Kampanya Hediyesi</p>
                    <div className="flex items-center justify-between mt-3">
                      <div className="text-xs text-emerald-700 bg-emerald-100 px-2 py-1 rounded font-semibold">
                        Adet: {gift.quantity}
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-xs text-emerald-500 line-through">Bedava</span>
                        <span className="font-bold text-emerald-700 text-sm">0 {currency}</span>
                      </div>
                    </div>
                  </div>
                  <div className="w-7 h-7 flex items-center justify-center">
                    <span className="material-symbols-outlined text-emerald-400 text-xl">redeem</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-zinc-100 px-6 py-5 bg-white space-y-3">
            <div className="flex justify-between text-sm text-zinc-500">
              <span>Ara Toplam</span>
              <span className="font-medium text-on-surface">{displaySubtotal.toLocaleString('tr-TR')} {currency}</span>
            </div>
            {displayCampaignDiscount > 0 && (
              <div className="flex justify-between text-sm text-emerald-600 font-semibold">
                <span>Kampanya İndirimi</span>
                <span>-{displayCampaignDiscount.toLocaleString('tr-TR')} {currency}</span>
              </div>
            )}
            <div className="flex justify-between text-sm text-zinc-500">
              <span>Kargo</span>
              <span className={`font-medium ${displayShipping === 0 ? 'text-green-600' : 'text-on-surface'}`}>{displayShipping === 0 ? 'Ucretsiz' : `${displayShipping.toLocaleString('tr-TR')} ${currency}`}</span>
            </div>
            <div className="border-t border-zinc-100 pt-3 flex justify-between">
              <span className="font-bold text-on-surface">Toplam</span>
              <div className="flex flex-col items-end">
                {displayCampaignDiscount > 0 && (
                  <span className="text-xs text-zinc-400 line-through font-normal">
                    {(displaySubtotal + displayShipping).toLocaleString('tr-TR')} {currency}
                  </span>
                )}
                <span className="font-bold text-primary text-xl">{displayTotal.toLocaleString('tr-TR')} {currency}</span>
              </div>
            </div>
            <Link onClick={onClose} to="/checkout" className="w-full bg-primary text-white py-4 rounded-lg font-bold shadow-lg shadow-primary/20 hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-2">
              Siparisi Tamamla
              <span className="material-symbols-outlined">arrow_forward</span>
            </Link>
            <button onClick={onClose} className="w-full py-2 text-sm text-zinc-500 font-medium hover:text-on-surface transition-colors">Alisverise Devam Et</button>
          </div>
        )}
      </aside>
    </>
  )
}

