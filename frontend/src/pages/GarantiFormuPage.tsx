import { useEffect, useMemo, useState } from 'react'
import { PHONE_FORMAT_MESSAGE, PHONE_MAX_LENGTH, PHONE_PATTERN, formatPhoneNumber } from '../utils/phone'
import { CheckCircle, Search, ShieldCheck } from 'lucide-react'
import { fetchProducts } from '../api/products'
import { createProductWarrantyRegistration } from '../api/productWarrantyRegistrations'
import type { Product } from '../types/Product'

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}



export default function GarantiFormuPage() {
  const [productQuery, setProductQuery] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [serialNumber, setSerialNumber] = useState('')
  const [customerFullName, setCustomerFullName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [email, setEmail] = useState('')
  const [city, setCity] = useState('')
  const [description, setDescription] = useState('')
  const [warrantyStartDate, setWarrantyStartDate] = useState(todayIso())
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const canSave = useMemo(() => {
    return Boolean(selectedProduct?.id && serialNumber.trim() && customerFullName.trim() && PHONE_PATTERN.test(phoneNumber))
  }, [customerFullName, phoneNumber, selectedProduct?.id, serialNumber])

  useEffect(() => {
    const q = productQuery.trim()
    if (q.length < 2) {
      setProducts([])
      return
    }

    const ac = new AbortController()
    const t = window.setTimeout(() => {
      setLoadingProducts(true)
      fetchProducts({ q, page: 1, pageSize: 12, includeInactive: true }, { signal: ac.signal })
        .then((res) => setProducts(res.items ?? []))
        .catch((e) => {
          if (e?.name !== 'AbortError') setError(e?.message ?? 'Ürün aranırken hata oluştu.')
        })
        .finally(() => setLoadingProducts(false))
    }, 250)

    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
  }, [productQuery])

  const resetForm = () => {
    setProductQuery('')
    setProducts([])
    setSelectedProduct(null)
    setSerialNumber('')
    setCustomerFullName('')
    setPhoneNumber('')
    setEmail('')
    setCity('')
    setDescription('')
    setWarrantyStartDate(todayIso())
  }

  const submit = async () => {
    if (!PHONE_PATTERN.test(phoneNumber)) {
      setError(PHONE_FORMAT_MESSAGE)
      return
    }

    if (!canSave || !selectedProduct) {
      setError('Ürün, seri numarası, ad soyad ve telefon zorunludur.')
      return
    }

    try {
      setSaving(true)
      setError(null)
      setSuccess(null)
      const saved = await createProductWarrantyRegistration({
        productId: selectedProduct.id,
        serialNumber: serialNumber.trim(),
        customerFullName: customerFullName.trim(),
        phoneNumber: phoneNumber.trim(),
        email: email.trim(),
        city: city.trim(),
        description: description.trim(),
        warrantyStartDate
      })
      setSuccess(`${saved.productCode} için garanti başlangıç kaydı oluşturuldu.`)
      resetForm()
    } catch (e: any) {
      setError(e?.message ?? 'Kayıt oluşturulamadı.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 max-w-[1280px] mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-emerald-600" />
        <div>
          <h1 className="text-xl font-bold text-slate-900">Garanti Formu</h1>
          <p className="text-xs text-slate-500">Ürünün garanti başlangıç kaydını oluşturun.</p>
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700">{error}</div>}
      {success && (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-700 flex items-center gap-2">
          <CheckCircle size={15} />
          {success}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-600 mb-1">Ürün *</label>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                value={selectedProduct ? `${selectedProduct.stockCode} - ${selectedProduct.name}` : productQuery}
                onChange={(e) => {
                  setSelectedProduct(null)
                  setProductQuery(e.target.value)
                }}
                className="input-base pl-9 h-10 text-sm"
                placeholder="Ürün adı, stok kodu veya barkod ile ara..."
              />
            </div>
            {!selectedProduct && (products.length > 0 || loadingProducts) && (
              <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                {loadingProducts && <div className="px-3 py-2 text-xs text-slate-500">Ürünler aranıyor...</div>}
                {products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedProduct(p)
                      setProducts([])
                      setProductQuery('')
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-emerald-50 border-b last:border-b-0 border-slate-100"
                  >
                    <div className="text-sm font-bold text-slate-800">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.stockCode}{p.barcode ? ` • ${p.barcode}` : ''}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Seri Numarası *</label>
            <input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} className="input-base h-10 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Ad Soyad *</label>
            <input value={customerFullName} onChange={(e) => setCustomerFullName(e.target.value)} className="input-base h-10 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Telefon *</label>
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(formatPhoneNumber(e.target.value))}
              className="input-base h-10 text-sm"
              inputMode="numeric"
              maxLength={PHONE_MAX_LENGTH}
              placeholder="0555 555 5555 555"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">
              Garanti Başlangıç Tarihi <span className="text-[10px] text-slate-400 font-normal">(Bugünün tarihi, değiştirilemez)</span>
            </label>
            <input
              type="date"
              value={todayIso()}
              disabled
              readOnly
              className="input-base h-10 text-sm bg-slate-100 text-slate-500 cursor-not-allowed border-slate-200"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">E Posta</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} className="input-base h-10 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1">Şehir</label>
            <input value={city} onChange={(e) => setCity(e.target.value)} className="input-base h-10 text-sm" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-slate-600 mb-1">Açıklama</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input-base min-h-[90px] text-sm py-2" />
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            disabled={!canSave || saving}
            onClick={() => void submit()}
            className="h-10 px-5 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:bg-slate-200 disabled:text-slate-400"
          >
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  )
}
