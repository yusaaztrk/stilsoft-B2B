import { useLocation, useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { getMemberToken } from '../lib/api'
import { writeCart } from '../lib/cart'

type PaymentState = {
  orderNo?: string
  customerName?: string
  total?: number
  saveAddress?: boolean
  addressTitle?: string
  city?: string
  district?: string
  region?: string
  mahalle?: string
  binaNo?: string
  daireNo?: string
  katNo?: string
  details?: string
  phone?: string
}

export function OdemePage() {
  const nav = useNavigate()
  const loc = useLocation()
  const state = (loc.state ?? {}) as PaymentState

  const [design] = useState(() => {
    const saved = localStorage.getItem('ecom_store_design')
    return saved ? JSON.parse(saved) : { currency: 'TL' }
  })
  const currency = design.currency || 'TL'

  const orderNo = String(state.orderNo ?? '').trim()
  const customerName = String(state.customerName ?? '').trim()
  const total = typeof state.total === 'number' && Number.isFinite(state.total) ? state.total : null

  const [cardNumber, setCardNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvv, setCvv] = useState('')

  const formattedCardNumber = useMemo(() => {
    const digits = cardNumber.replace(/\D/g, '').slice(0, 16)
    return digits.replace(/(.{4})/g, '$1 ').trim()
  }, [cardNumber])

  const formattedExpiry = useMemo(() => {
    const digits = expiry.replace(/\D/g, '').slice(0, 4)
    if (digits.length <= 2) return digits
    return `${digits.slice(0, 2)}/${digits.slice(2)}`
  }, [expiry])

  const [paymentLoading, setPaymentLoading] = useState(false)
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null)
  const [showSuccessModal, setShowSuccessModal] = useState(false)

  async function handlePaymentComplete() {
    if (!orderNo) {
      setPaymentMessage('Sipariş numarası bulunamadı.')
      return
    }
    setPaymentLoading(true)
    setPaymentMessage(null)
    try {
      const res = await fetch('/api/orders/complete-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ orderNo })
      })
      
      let errorMsg = 'Ödeme tamamlanırken bir hata oluştu.'
      try {
        const json = await res.json()
        if (res.ok && json.success) {
          // If saveAddress is checked and the payment succeeds, save the address to member profile
          const token = getMemberToken()
          if (token && state.saveAddress && state.addressTitle && state.city && state.district && state.details) {
            try {
              await fetch('/api/storefront/addresses', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                  title: state.addressTitle,
                  fullName: customerName,
                  phone: state.phone || '',
                  city: state.city,
                  district: state.district,
                  region: state.region || '',
                  mahalle: state.mahalle || '',
                  binaNo: state.binaNo || '',
                  daireNo: state.daireNo || '',
                  katNo: state.katNo || '',
                  details: state.details
                })
              })
            } catch {
              // Ignore address save failure so the order flow is not blocked
            }
          }

          writeCart([])
          localStorage.removeItem('ecom_checkout_form')
          localStorage.removeItem('ecom_checkout_saveAddress')
          localStorage.removeItem('ecom_checkout_addressTitle')
          localStorage.removeItem('ecom_checkout_manualCity')
          localStorage.removeItem('ecom_checkout_manualDistrict')
          localStorage.removeItem('ecom_checkout_manualRegion')
          localStorage.removeItem('ecom_checkout_manualMahalle')
          localStorage.removeItem('ecom_checkout_manualBinaNo')
          localStorage.removeItem('ecom_checkout_manualDaireNo')
          localStorage.removeItem('ecom_checkout_manualKatNo')
          localStorage.removeItem('ecom_checkout_manualDetails')
          localStorage.removeItem('ecom_checkout_addressMode')
          localStorage.removeItem('ecom_checkout_selectedAddressId')

          setShowSuccessModal(true)
          return
        }
        errorMsg = json.message || errorMsg
      } catch {
        // Fallback if not json
      }
      
      throw new Error(errorMsg)
    } catch (err) {
      setPaymentMessage(err instanceof Error ? err.message : 'Ödeme tamamlanamadı.')
    } finally {
      setPaymentLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-6 pb-20">
      <div className="flex flex-col gap-2">
        <div className="text-xs font-extrabold tracking-[0.2em] text-zinc-400">ÖDEME</div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Sanal POS (Demo)</h1>
        <p className="text-sm text-zinc-500">
          Bu ekran sadece arayüz amaçlıdır. Entegrasyon devreye alındığında gerçek ödeme akışı burada çalışacaktır.
        </p>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_420px]">
        <div className="rounded-3xl border border-zinc-100 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-bold tracking-widest text-zinc-400">KART İLE ÖDEME</div>
              <div className="mt-1 text-lg font-extrabold text-zinc-900">Güvenli Ödeme</div>
            </div>
            <span className="material-symbols-outlined text-zinc-400">credit_card</span>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-semibold text-zinc-700 sm:col-span-2">
              <span>Kart Numarası</span>
              <input
                inputMode="numeric"
                placeholder="0000 0000 0000 0000"
                value={formattedCardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
                maxLength={19}
                className="h-12 w-full rounded-2xl border border-zinc-200 px-4 font-mono outline-none focus:border-primary"
              />
              <div className="text-[11px] font-semibold text-zinc-500">Demo: Ödeme alınmaz.</div>
            </label>

            <label className="space-y-2 text-sm font-semibold text-zinc-700">
              <span>Son Kullanma</span>
              <input
                inputMode="numeric"
                placeholder="AA/YY"
                value={formattedExpiry}
                onChange={(e) => setExpiry(e.target.value)}
                maxLength={5}
                className="h-12 w-full rounded-2xl border border-zinc-200 px-4 font-mono outline-none focus:border-primary"
              />
            </label>

            <label className="space-y-2 text-sm font-semibold text-zinc-700">
              <span>CVV</span>
              <input
                inputMode="numeric"
                placeholder="***"
                value={cvv.replace(/\D/g, '').slice(0, 3)}
                onChange={(e) => setCvv(e.target.value)}
                maxLength={3}
                className="h-12 w-full rounded-2xl border border-zinc-200 px-4 font-mono outline-none focus:border-primary"
              />
            </label>

            <label className="space-y-2 text-sm font-semibold text-zinc-700 sm:col-span-2">
              <span>Kart Üzerindeki İsim</span>
              <input
                defaultValue={customerName}
                placeholder="Ad Soyad"
                className="h-12 w-full rounded-2xl border border-zinc-200 px-4 outline-none focus:border-primary"
              />
            </label>
          </div>

          {paymentMessage && (
            <div className={`mt-4 rounded-xl p-4 text-sm font-semibold ${
              paymentMessage.includes('başarıyla') ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' : 'bg-rose-50 text-rose-800 border border-rose-100'
            }`}>
              {paymentMessage}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled={paymentLoading || !orderNo}
              className="h-12 flex-1 rounded-2xl bg-primary px-6 text-sm font-extrabold text-white shadow-lg shadow-primary/20 hover:bg-primary-container active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed transition-all"
              onClick={handlePaymentComplete}
            >
              {paymentLoading ? 'Ödeme İşleniyor...' : 'Ödemeyi Tamamla (Demo)'}
            </button>
            <button
              type="button"
              disabled={paymentLoading}
              className="h-12 rounded-2xl border border-zinc-200 px-6 text-sm font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              onClick={() => nav('/checkout')}
            >
              Geri Dön
            </button>
          </div>
        </div>

        <aside className="h-fit rounded-3xl border border-zinc-100 bg-white p-6 shadow-sm">
          <div className="text-xs font-bold tracking-widest text-zinc-400">SİPARİŞ ÖZETİ</div>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Sipariş No</span>
              <span className="font-bold text-zinc-900">{orderNo || '-'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Müşteri</span>
              <span className="font-bold text-zinc-900">{customerName || '-'}</span>
            </div>
          </div>

          <div className="mt-5 border-t border-zinc-100 pt-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-zinc-700">Toplam</span>
              <span className="text-xl font-extrabold text-primary">{total === null ? '-' : `${total.toLocaleString('tr-TR')} ${currency}`}</span>
            </div>
            <div className="mt-2 text-[11px] font-semibold text-zinc-500">Entegrasyon açılınca ödeme burada alınacaktır.</div>
          </div>
        </aside>
      </div>
      {showSuccessModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-zinc-150 flex flex-col items-center text-center space-y-6 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-500 scale-110">
              <span className="material-symbols-outlined text-4xl font-bold">check_circle</span>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold text-zinc-900">Ödemeniz Onaylandı!</h3>
              <p className="text-zinc-500 text-sm leading-relaxed">
                Ödemeniz onaylandı, faturanız mail adresine gönderildi, kontrol edebilirsiniz.
              </p>
            </div>
            <div className="w-full space-y-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowSuccessModal(false)
                  nav('/hesabim?tab=orders')
                }}
                className="w-full h-12 rounded-2xl bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-sm transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-lg">shopping_bag</span>
                Siparişlerime Git
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowSuccessModal(false)
                  nav('/')
                }}
                className="w-full h-12 rounded-2xl border border-zinc-200 hover:bg-zinc-50 text-zinc-700 font-bold text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-1.5"
              >
                <span className="material-symbols-outlined text-lg">home</span>
                Ana Sayfaya Dön
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
