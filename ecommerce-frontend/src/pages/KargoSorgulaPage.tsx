import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Package, Search, Clock, CheckCircle, Truck, MapPin } from 'lucide-react'

export default function KargoSorgulaPage() {
  const [orderNo, setOrderNo] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')

  const [searchParams] = useSearchParams()
  const orderNoParam = searchParams.get('orderNo') || ''

  const searchOrder = async (no: string) => {
    if (!no.trim()) return

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const res = await fetch(`/api/orders/cargo-tracking/${no.trim()}`)
      const data = await res.json()

      if (data.success && data.data) {
        setResult(data.data)
      } else {
        setError(data.message || 'Kargo bilgisi bulunamadı.')
      }
    } catch (err) {
      setError('Bir hata oluştu, lütfen daha sonra tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (orderNoParam) {
      setOrderNo(orderNoParam)
      searchOrder(orderNoParam)
    }
  }, [orderNoParam])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    searchOrder(orderNo)
  }

  const getStatusIcon = (status: number) => {
    switch (status) {
      case 0: return <Package className="w-8 h-8 text-blue-500" />
      case 1: return <Clock className="w-8 h-8 text-indigo-500" />
      case 2: return <Clock className="w-8 h-8 text-amber-500" />
      case 3: return <Truck className="w-8 h-8 text-orange-500" />
      case 4: return <CheckCircle className="w-8 h-8 text-green-500" />
      default: return <Package className="w-8 h-8 text-gray-500" />
    }
  }

  const getStatusText = (status: number) => {
    switch (status) {
      case 0: return 'Siparişiniz Alındı'
      case 1: return 'Planlandı'
      case 2: return 'Hazırlanıyor'
      case 3: return 'Dağıtımda'
      case 4: return 'Teslim Edildi'
      default: return 'Bilinmiyor'
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">Kargo Takip Sorgula</h1>
          <p className="mt-4 text-lg text-gray-500">
            Sipariş numaranızı girerek kargonuzun güncel durumunu öğrenebilirsiniz.
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm ring-1 ring-gray-900/5 mb-8">
          <form onSubmit={handleSearch} className="flex gap-4">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                placeholder="Sipariş Numaranız (Örn: ORD-12345)"
                className="block w-full pl-10 pr-3 py-3 border border-gray-300 rounded-xl leading-5 bg-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 sm:text-sm transition-colors"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-xl text-white bg-brand-600 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Sorgulanıyor...' : 'Sorgula'}
            </button>
          </form>
        </div>

        {error && (
          <div className="bg-red-50 p-4 rounded-xl text-red-700 text-center ring-1 ring-red-200">
            {error}
          </div>
        )}

        {result && (
          <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-900/5 overflow-hidden">
            <div className="p-6 border-b border-gray-100 bg-gray-50/50">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Sipariş: {result.orderNumber}</h3>
                  <p className="text-sm text-gray-500">{new Date(result.orderDate).toLocaleDateString('tr-TR')}</p>
                </div>
                <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-lg shadow-sm ring-1 ring-gray-200">
                  {getStatusIcon(result.status)}
                  <span className="font-semibold text-gray-900">{getStatusText(result.status)}</span>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    Teslimat Bilgileri
                  </h4>
                  <div className="bg-gray-50 p-4 rounded-xl text-sm">
                    <p className="font-medium text-gray-900 mb-1">{result.customerName}</p>
                    <p className="text-gray-600 leading-relaxed">{result.deliveryAddress}</p>
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <Package className="w-4 h-4 text-gray-400" />
                    Ürünler
                  </h4>
                  <div className="bg-gray-50 p-4 rounded-xl text-sm">
                    <p className="text-gray-600 leading-relaxed">{result.productDetails}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Timeline History */}
            <div className="p-6 border-t border-gray-100 bg-gray-50/20">
              <h4 className="text-sm font-semibold text-gray-900 mb-6 flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400" />
                Gönderi Geçmişi & Hareketleri
              </h4>
              <div className="relative pl-6 border-l-2 border-zinc-200 ml-3 space-y-6">
                {(() => {
                  try {
                    const history = JSON.parse(result.historyJson || '[]');
                    if (!Array.isArray(history) || history.length === 0) {
                      return <p className="text-xs text-gray-500 italic">Hareket kaydı bulunamadı.</p>;
                    }
                    return history.map((item: any, index: number) => {
                      const isLast = index === history.length - 1;
                      return (
                        <div key={index} className="relative">
                          <span className="absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white ring-4 ring-white">
                            <span className={`h-2 w-2 rounded-full ${isLast ? 'bg-brand-600' : 'bg-zinc-400'}`} />
                          </span>
                          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
                            <span className={`text-sm font-bold ${isLast ? 'text-brand-600 font-extrabold' : 'text-gray-800'}`}>
                              {item.statusLabel || item.StatusLabel}
                            </span>
                            <span className="text-xs text-gray-400">
                              {new Date(item.timestamp || item.Timestamp).toLocaleString('tr-TR')}
                            </span>
                          </div>
                          {(item.detail || item.Detail) && (
                            <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                              {item.detail || item.Detail}
                            </p>
                          )}
                          {(item.actor || item.Actor) && (
                            <span className="mt-1 inline-block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                              İşlem Yapan: {item.actor || item.Actor}
                            </span>
                          )}
                        </div>
                      );
                    });
                  } catch {
                    return <p className="text-xs text-gray-500 italic">Geçmiş verisi yüklenemedi.</p>;
                  }
                })()}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
