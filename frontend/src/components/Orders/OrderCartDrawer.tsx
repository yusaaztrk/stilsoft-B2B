import React from 'react'

import { Minus, Plus, ShoppingCart, Trash2, X } from 'lucide-react'

import type { CartLine } from '../../contexts/CartContext'

type CartItem = {
  line: CartLine
  lineTotal: number
  lineKdv: number
  installUnit: number
  unitWithInstall: number
}

type InstallationFeeBreakdownItem = {
  key: string
  name: string
  qty: number
  unit: number
  total: number
}

type Totals = {
  araToplam: number
  kdv: number
  genel: number
  campaignDiscount?: number
}

type Props = {
  cartOpen: boolean
  setCartOpen: (v: boolean) => void
  cartFabTop: number
  cartFabVisible?: boolean
  lineCount: number
  cartItems: CartItem[]
  totals: Totals
  installationFeeTotal: number
  installationFeeBreakdown: InstallationFeeBreakdownItem[]
  headerSubtitle?: string
  formatMoney: (v: number) => string
  onSetNote: (lineKey: string, note: string) => void
  onUpdateQty: (lineKey: string, delta: number) => void
  onRemoveLine: (lineKey: string) => void
  onClearCart: () => void
  canCreateOrder?: boolean
  creatingOrder?: boolean
  onCreateOrder?: () => void
  disableCreateOrder?: boolean
  hideCreateOrder?: boolean
  hideClearCart?: boolean
  toAbsoluteMediaUrl?: (url: string | null | undefined) => string
}

export default function OrderCartDrawer(props: Props) {
  const {
    cartOpen,
    setCartOpen,
    cartFabTop,
    cartFabVisible = true,
    lineCount,
    cartItems,
    totals,
    installationFeeTotal,
    installationFeeBreakdown,
    headerSubtitle,
    formatMoney,
    onSetNote,
    onUpdateQty,
    onRemoveLine,
    onClearCart,
    canCreateOrder = false,
    creatingOrder = false,
    onCreateOrder,
    disableCreateOrder,
    hideCreateOrder,
    hideClearCart,
    toAbsoluteMediaUrl
  } = props

  const absMedia = (url: string | null | undefined) => {
    if (toAbsoluteMediaUrl) return toAbsoluteMediaUrl(url)
    return String(url ?? '')
  }

  const [clearCartConfirmOpen, setClearCartConfirmOpen] = React.useState(false)
  const [removeLineConfirmKey, setRemoveLineConfirmKey] = React.useState<string | null>(null)

  return (
    <>
      <div className="fixed right-2 z-40" style={{ top: cartFabTop, visibility: cartFabVisible ? 'visible' : 'hidden' }}>
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          className="group w-14 h-14 flex items-center justify-center rounded-2xl bg-white border border-gray-200 hover:bg-green-50 hover:border-green-300 active:bg-green-100 transition-colors shadow-lg"
          title="Sepet"
        >
          <div className="relative">
            <ShoppingCart size={22} className="text-gray-700 group-hover:text-green-700" />
            {(() => {
              const totalQty = cartItems.reduce((acc: number, it: any) => acc + (Number(it.line?.qty) || 0), 0);
              return totalQty > 0 ? (
                <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 rounded-full bg-pink-600 text-white text-[10px] font-extrabold flex items-center justify-center">
                  {totalQty}
                </span>
              ) : null;
            })()}
          </div>
        </button>
      </div>

      {cartOpen && (
        <div className="fixed inset-0 z-50">
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes fadeInBackdrop {
              from { opacity: 0; }
              to { opacity: 0.35; }
            }
            @keyframes slideInRightDrawer {
              from { transform: translateX(100%); }
              to { transform: translateX(0); }
            }
            .animate-fade-in-backdrop {
              animation: fadeInBackdrop 0.25s forwards ease-out;
            }
            .animate-slide-in-right-drawer {
              animation: slideInRightDrawer 0.25s forwards cubic-bezier(0.16, 1, 0.3, 1);
            }
          `}} />
          <button type="button" className="absolute inset-0 bg-black opacity-0 animate-fade-in-backdrop" onClick={() => setCartOpen(false)} aria-label="Kapat" />

          {/*
              TABLET/TELEFONDA ALT KISIM EKRAN DISINDA KALIYORDU (2026-08-24).

              Iki ayri sebep vardi:
                1) `h-screen` = `100vh`. Mobil tarayicilarda 100vh, adres cubugu gizliyken
                   olculen YUKSEKLIKTIR; cubuk gorunurken cekmece ekrandan tasar ve alti
                   kesilir. `100dvh` o anda GORUNEN yuksekligi verir.
                2) Asagidaki kaydirma alani `min-h-0` almiyordu — bkz. oradaki not.
            */}
            <div className="fixed right-0 top-0 h-screen supports-[height:100dvh]:h-[100dvh] w-full md:w-[60vw] max-w-[900px] bg-white shadow-[-8px_0_24px_rgba(0,0,0,0.12)] flex flex-col animate-slide-in-right-drawer">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <div className="text-xl font-bold text-gray-900">Sepet</div>
                {headerSubtitle ? <div className="mt-1 text-xs font-semibold text-gray-600">{headerSubtitle}</div> : null}
              </div>
              <button type="button" className="text-red-500 hover:text-red-600" onClick={() => setCartOpen(false)} aria-label="Kapat" title="Kapat">
                <X size={18} />
              </button>
            </div>

            {/* Desktop Table Headers */}
            <div
              className="hidden md:grid items-center px-6 py-3 text-xs font-medium text-gray-400 border-b border-gray-200"
              style={{ gridTemplateColumns: '2fr 2fr 1.05fr 1fr 1fr' }}
            >
              <div>Ürün Adı</div>
              <div>Açıklama</div>
              <div className="text-right">Birim Fiyat</div>
              <div className="text-center">Miktar</div>
              <div className="text-right">Toplam</div>
            </div>

            {/*
              `min-h-0` SART. Flex cocuklarinin varsayilan `min-height: auto` degeri, bu kutunun
              ICERIGINDEN daha kisa olmasini engelliyor: sepette birkac urun olunca kutu icerigi
              kadar buyuyor, altindaki toplam blogu ve "Siparisi Olustur / Sepeti Temizle"
              dugmeleri ekranin disina itiliyordu. Tablette daha erken goruluyor, cunku ekran
              kisa ama cekmece genis — satirlar sarmadan uzuyor.
            */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {cartItems.map((it) => (
                <React.Fragment key={it.line.key}>
                  {/* Desktop Row View */}
                  <div
                    className="hidden md:grid items-center px-6 py-3 border-b border-gray-100"
                    style={{ gridTemplateColumns: '2fr 2fr 1.05fr 1fr 1fr' }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-[40px] h-[56px] bg-gray-100 border border-gray-200 rounded overflow-hidden flex items-center justify-center shrink-0">
                        {it.line.product.imageUrl ? (
                          <img loading="lazy" src={absMedia(String(it.line.product.imageUrl))} alt="" className="w-[40px] h-[56px] object-contain" />
                        ) : null}
                      </div>
                      <div className="text-xs font-semibold text-gray-800 leading-4 whitespace-normal break-words">{it.line.product.name}</div>
                    </div>

                    <div>
                      <input
                        value={it.line.note}
                        onChange={(e) => onSetNote(it.line.key, e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded bg-white"
                      />
                    </div>

                    <div className="flex flex-col items-center justify-center text-center self-center pt-1">
                      <div className="text-[13px] font-extrabold text-gray-900 leading-5">
                        {it.installUnit > 0 ? formatMoney(Number(it.unitWithInstall ?? it.line.product.unitPrice)) : formatMoney(it.line.product.unitPrice)}
                      </div>
                      {it.installUnit > 0 ? (
                        (() => {
                          const qty = Number(it.line?.qty ?? 0)
                          const gross = Math.max(0, Number(it.installUnit ?? 0) * qty)
                          const rate = Number((it.line as any)?.product?.kdvRate ?? 0)
                          const factor = 1 + (Number.isFinite(rate) ? rate : 0) / 100
                          const net = factor > 0 ? gross / factor : gross
                          const vat = Math.max(0, gross - net)
                          const rateLabel = Number.isFinite(rate) && rate > 0 ? `%${Math.round(rate)}` : '%0'

                          return (
                            <div className="mt-2 text-[11px] font-semibold text-slate-600 leading-4 whitespace-nowrap">
                              <span className="text-slate-700 font-extrabold">Montaj</span>
                              <span className="mx-1 text-slate-400">=</span>
                              <span className="text-slate-900 font-bold">{formatMoney(net)}</span>
                              <span className="mx-1 text-slate-400">+</span>
                              <span className="font-semibold">KDV {rateLabel}</span>
                              <span className="ml-1 text-slate-900 font-bold">{formatMoney(vat)}</span>
                            </div>
                          )
                        })()
                      ) : null}
                    </div>

                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        className="text-red-500 hover:text-red-600"
                        onClick={() => setRemoveLineConfirmKey(it.line.key)}
                        aria-label="Sil"
                        title="Sil"
                      >
                        <Trash2 size={18} />
                      </button>

                      <div className="inline-flex items-center rounded-md border border-gray-300 bg-white overflow-hidden">
                        <button
                          type="button"
                          className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 text-gray-700"
                          onClick={() => {
                            const q = Number(it.line.qty ?? 0)
                            if (q <= 1) {
                              setRemoveLineConfirmKey(it.line.key)
                              return
                            }
                            onUpdateQty(it.line.key, -1)
                          }}
                          aria-label="Azalt"
                          title="Azalt"
                        >
                          <Minus size={14} />
                        </button>
                        <div className="h-8 w-9 flex items-center justify-center text-xs font-semibold text-gray-800 border-l border-r border-gray-300">
                          {it.line.qty}
                        </div>
                        <button
                          type="button"
                          className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 text-gray-700"
                          onClick={() => onUpdateQty(it.line.key, 1)}
                          aria-label="Arttır"
                          title="Arttır"
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="text-right text-sm font-bold text-orange-600">{formatMoney(it.lineTotal)}</div>
                  </div>

                  {/* Mobile Stacked Card View */}
                  <div className="flex md:hidden flex-col p-4 border-b border-gray-100 gap-3">
                    <div className="flex gap-3">
                      {/* Product Image */}
                      <div className="w-[60px] h-[80px] bg-gray-50 border border-gray-200 rounded overflow-hidden flex items-center justify-center shrink-0">
                        {it.line.product.imageUrl ? (
                          <img loading="lazy" src={absMedia(String(it.line.product.imageUrl))} alt="" className="w-full h-full object-contain" />
                        ) : (
                          <ShoppingCart size={20} className="text-gray-300" />
                        )}
                      </div>
                      
                      {/* Name and Price */}
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div>
                          <div className="text-xs font-bold text-gray-800 leading-4 break-words">{it.line.product.name}</div>
                          {it.line.product.stockCode && (
                            <div className="text-[10px] font-semibold text-gray-400 mt-1">{it.line.product.stockCode}</div>
                          )}
                        </div>
                        <div className="flex items-baseline gap-1.5 mt-2">
                          <span className="text-[10px] text-gray-400 font-semibold">Birim:</span>
                          <span className="text-xs font-bold text-gray-800">
                            {it.installUnit > 0 ? formatMoney(Number(it.unitWithInstall ?? it.line.product.unitPrice)) : formatMoney(it.line.product.unitPrice)}
                          </span>
                        </div>
                      </div>

                      {/* Delete Button */}
                      <button
                        type="button"
                        className="text-red-500 hover:text-red-600 p-1 self-start"
                        onClick={() => setRemoveLineConfirmKey(it.line.key)}
                        aria-label="Sil"
                        title="Sil"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>

                    {/* Note Field */}
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Açıklama / Not</label>
                      <input
                        value={it.line.note}
                        onChange={(e) => onSetNote(it.line.key, e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-gray-300 rounded bg-white"
                        placeholder="Not ekleyin..."
                      />
                    </div>

                    {/* Quantity Controls and Line Total */}
                    <div className="flex items-center justify-between mt-1 pt-2 border-t border-gray-100">
                      {/* Quantity */}
                      <div className="flex items-center rounded-lg border border-gray-300 bg-white overflow-hidden">
                        <button
                          type="button"
                          className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 text-gray-700"
                          onClick={() => {
                            const q = Number(it.line.qty ?? 0)
                            if (q <= 1) {
                              setRemoveLineConfirmKey(it.line.key)
                              return
                            }
                            onUpdateQty(it.line.key, -1)
                          }}
                          aria-label="Azalt"
                        >
                          <Minus size={14} />
                        </button>
                        <div className="h-8 w-9 flex items-center justify-center text-xs font-bold text-gray-800 border-l border-r border-gray-300">
                          {it.line.qty}
                        </div>
                        <button
                          type="button"
                          className="h-8 w-8 flex items-center justify-center hover:bg-gray-50 text-gray-700"
                          onClick={() => onUpdateQty(it.line.key, 1)}
                          aria-label="Arttır"
                        >
                          <Plus size={14} />
                        </button>
                      </div>

                      {/* Installation Info */}
                      {it.installUnit > 0 && (
                        <div className="text-[10px] text-slate-500 font-bold">
                          Montaj Dahil
                        </div>
                      )}

                      {/* Line Total */}
                      <div className="text-right">
                        <div className="text-[10px] text-gray-400 font-semibold">Toplam</div>
                        <div className="text-sm font-extrabold text-orange-600 mt-0.5">{formatMoney(it.lineTotal)}</div>
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              ))}

              {cartItems.length === 0 && <div className="py-10 text-center text-sm text-gray-500">Sepet boş.</div>}

            {/*
              TOPLAM BLOGU KAYDIRILAN ALANIN ICINDE (2026-08-24).
              Ayni duzeltme SiparisCartSection'da da var; gerekce orada yazili. Ozeti: bu blok
              disarida kardes dururken tablette kalan yuksekligi doldurup dugmeleri ekran
              disina itiyordu. Asagida yalniz dugmeler kaliyor ve onlar `shrink-0`.
            */}
            <div className="bg-gray-100 p-6">
              <div className="space-y-2 text-sm font-semibold text-gray-700">
                <div className="flex items-center justify-between">
                  <div>Ara Toplam</div>
                  <div>{formatMoney(totals.araToplam)}</div>
                </div>

                {installationFeeTotal > 0 ? (
                  <div className="bg-white border border-gray-200 rounded px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div className="text-gray-700 font-extrabold">Toplam Montaj</div>
                      <div className="text-gray-900 font-extrabold">{formatMoney(installationFeeTotal)}</div>
                    </div>

                    {installationFeeBreakdown.length > 1 ? (
                      <div className="mt-2 space-y-1">
                        {installationFeeBreakdown.map((x) => (
                          <div key={x.key} className="flex items-center justify-between text-[11px] font-bold text-gray-700">
                            <div className="max-w-[220px] truncate">{x.name}</div>
                            <div>
                              {formatMoney(x.total)}
                              {x.qty > 1 ? <span className="ml-1 text-gray-500">({x.qty}x)</span> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex items-center justify-between">
                  <div>Kdv</div>
                  <div>{formatMoney(totals.kdv)}</div>
                </div>

                {Number(totals.campaignDiscount ?? 0) > 0 ? (
                  <div className="flex items-center justify-between">
                    <div className="text-green-700 font-extrabold">Kampanya İndirimi</div>
                    <div className="text-green-700 font-extrabold">-{formatMoney(Number(totals.campaignDiscount ?? 0))}</div>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="text-lg font-extrabold text-gray-900">Genel Toplam</div>
                <div className="text-lg font-extrabold text-gray-900">{formatMoney(totals.genel)}</div>
              </div>
            </div>
            </div>

            <div className="p-4 sm:p-6 shrink-0 border-t border-gray-200 bg-white flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3">
              {!hideClearCart && (
                <button
                  type="button"
                  className="px-5 py-2.5 text-sm font-semibold bg-red-600 text-white rounded-md hover:bg-red-700 text-center"
                  onClick={() => setClearCartConfirmOpen(true)}
                >
                  Sepeti Temizle
                </button>
              )}

              {!hideCreateOrder && (
                <button
                  type="button"
                  disabled={Boolean(disableCreateOrder) || !canCreateOrder}
                  className={
                    'px-5 py-2.5 text-sm font-semibold rounded-md text-center ' +
                    (!disableCreateOrder && canCreateOrder ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-200 text-gray-500 cursor-not-allowed')
                  }
                  onClick={() => {
                    if (Boolean(disableCreateOrder) || !canCreateOrder) return
                    onCreateOrder?.()
                  }}
                >
                  {creatingOrder ? 'Oluşturuluyor...' : 'Siparişi Oluştur'}
                </button>
              )}
            </div>
          </div>

          {clearCartConfirmOpen && (
            <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-6">
              <div className="bg-white w-full max-w-md rounded-lg shadow-2xl border border-gray-200 p-8 text-center">
                <div className="mt-3 text-sm text-gray-700">Sepet temizlensin mi?</div>
                <div className="mt-6 flex items-center justify-center gap-4">
                  <button
                    type="button"
                    className="px-6 py-2 text-sm font-semibold bg-pink-600 text-white rounded hover:bg-pink-700"
                    onClick={() => {
                      onClearCart()
                      setClearCartConfirmOpen(false)
                      setCartOpen(false)
                    }}
                  >
                    Evet
                  </button>
                  <button
                    type="button"
                    className="px-6 py-2 text-sm font-semibold bg-green-500 text-white rounded hover:bg-green-600"
                    onClick={() => setClearCartConfirmOpen(false)}
                  >
                    Hayır
                  </button>
                </div>
              </div>
            </div>
          )}

          {removeLineConfirmKey != null && (
            <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-6">
              <div className="bg-white w-full max-w-md rounded-lg shadow-2xl border border-gray-200 p-8 text-center">
                <div className="mx-auto w-14 h-14 rounded-full border-4 border-yellow-400 flex items-center justify-center text-yellow-500 text-3xl font-extrabold">
                  !
                </div>
                <div className="mt-5 text-lg font-semibold text-gray-900">Sil ?</div>
                <div className="mt-3 text-sm text-gray-700">Seçilen satır silinecektir onaylıyor musunuz ?</div>

                <div className="mt-6 flex items-center justify-center gap-4">
                  <button
                    type="button"
                    className="px-6 py-2 text-sm font-semibold bg-pink-600 text-white rounded hover:bg-pink-700"
                    onClick={() => {
                      if (!removeLineConfirmKey) return
                      onRemoveLine(removeLineConfirmKey)
                      setRemoveLineConfirmKey(null)
                    }}
                  >
                    Evet
                  </button>
                  <button
                    type="button"
                    className="px-6 py-2 text-sm font-semibold bg-green-500 text-white rounded hover:bg-green-600"
                    onClick={() => setRemoveLineConfirmKey(null)}
                  >
                    Hayır
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
