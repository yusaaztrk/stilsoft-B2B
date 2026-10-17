import { useEffect, useMemo, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { getAdminToken } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/ToastContext'

type RegisteredProductItem = {
  id: string
  serialNumber: string
  createdAtUtc: string
  productId: string
  productName: string
  imageUrl?: string
  userId: string
  fullName: string
  email: string
  phone: string
  userCreatedAtUtc: string
}

export function AdminRegisteredProductsPage() {
  const { showToast } = useToast()
  const [items, setItems] = useState<RegisteredProductItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedItem, setSelectedItem] = useState<RegisteredProductItem | null>(null)

  const authHeader = useMemo(() => {
    const token = getAdminToken()
    return token ? { Authorization: `Bearer ${token}` } : null
  }, [])

  const fetchItems = async () => {
    if (!authHeader) return
    setLoading(true)
    try {
      const res = await fetch('/api/admin/modules/registered-products', { headers: authHeader })
      const json = await res.json()
      if (res.ok && json?.success) {
        setItems(json.data || [])
      } else {
        showToast(json?.message || 'Kayıtlı ürün listesi alınamadı.', 'error')
      }
    } catch (err) {
      showToast('Bağlantı hatası.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchItems()
  }, [authHeader])

  // Filter items based on search term (name, email, or serial number)
  const filteredItems = useMemo(() => {
    const term = searchTerm.toLowerCase().trim()
    if (!term) return items
    return items.filter((item) =>
      item.fullName.toLowerCase().includes(term) ||
      item.email.toLowerCase().includes(term) ||
      item.serialNumber.toLowerCase().includes(term) ||
      item.productName.toLowerCase().includes(term)
    )
  }, [items, searchTerm])

  const handleExportCSV = () => {
    if (filteredItems.length === 0) {
      showToast('Dışa aktarılacak kayıt bulunmuyor.', 'warning')
      return
    }
    const headers = ['Müşteri Adı', 'E-posta', 'Telefon', 'Ürün Adı', 'Seri Numarası', 'Kayıt Tarihi']
    const rows = filteredItems.map((s) => [
      s.fullName,
      s.email,
      s.phone,
      s.productName,
      s.serialNumber,
      new Date(s.createdAtUtc).toLocaleString('tr-TR'),
    ])

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(';'), ...rows.map((e) => e.join(';'))].join('\n')

    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', 'stilsoft_kayitli_urunler.csv')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    showToast('Kayıt listesi başarıyla CSV olarak indirildi.', 'success')
  }

  return (
    <AdminLayout
      title="Kayıtlı Ürünler"
      subtitle="Müşterilerin sisteme seri numarası ile kaydettiği ürünlerin tamamını listeleyin."
    >
      <div className="space-y-6">
        {/* Stats card */}
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)] transition-all duration-300 hover:shadow-md">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Toplam Kayıtlı Ürün</span>
              <span className="material-symbols-outlined text-[20px] p-2 rounded-2xl border border-zinc-150 text-zinc-500 bg-zinc-50">app_registration</span>
            </div>
            <p className="text-2xl font-black text-zinc-900 mt-2">{items.length}</p>
          </div>
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)] transition-all duration-300 hover:shadow-md">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Farklı Müşteri Sayısı</span>
              <span className="material-symbols-outlined text-[20px] p-2 rounded-2xl border border-zinc-150 text-zinc-500 bg-zinc-50">group</span>
            </div>
            <p className="text-2xl font-black text-zinc-900 mt-2">
              {new Set(items.map((i) => i.userId)).size}
            </p>
          </div>
          <div className="bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)] transition-all duration-300 hover:shadow-md">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Arama Eşleşmesi</span>
              <span className="material-symbols-outlined text-[20px] p-2 rounded-2xl border border-zinc-150 text-zinc-500 bg-zinc-50">search</span>
            </div>
            <p className="text-2xl font-black text-zinc-900 mt-2">{filteredItems.length}</p>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row justify-between gap-4 bg-white p-4 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
          <Input
            placeholder="Müşteri adı, e-posta, ürün adı veya seri no ara..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            icon="search"
            className="max-w-md w-full rounded-2xl focus:ring-[#df0000]/5 focus:border-[#df0000]"
          />
          <div className="flex gap-2 shrink-0">
            <Button 
              variant="outline" 
              onClick={handleExportCSV} 
              icon="download"
              className="rounded-2xl hover:bg-zinc-50 active:scale-[0.98] transition-all px-4 font-bold"
            >
              Excel / CSV Aktar
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 bg-white rounded-3xl border border-zinc-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-10 h-10 border-4 border-zinc-200 border-t-[#df0000] rounded-full animate-spin mb-3" />
            <span className="text-sm text-zinc-400 font-medium">Kayıtlı ürünler yükleniyor...</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-white rounded-3xl border border-zinc-200/80 p-16 text-center shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
            <div className="w-16 h-16 bg-zinc-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-100">
              <span className="material-symbols-outlined text-[32px] text-zinc-450">app_registration</span>
            </div>
            <h4 className="text-base font-bold text-zinc-850">Kayıt Bulunmuyor</h4>
            <p className="text-xs text-zinc-500 mt-2 max-w-sm mx-auto">
              Sisteme henüz hiç ürün kaydedilmemiş veya arama kriterinize uygun bir kayıt bulunamadı.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50/80 border-b border-zinc-200/80 text-[10px] font-extrabold tracking-wider text-zinc-455 uppercase">
                    <th className="px-6 py-4">Müşteri</th>
                    <th className="px-6 py-4">Ürün</th>
                    <th className="px-6 py-4">Seri Numarası</th>
                    <th className="px-6 py-4">Kayıt Tarihi</th>
                    <th className="px-6 py-4 text-right">Detaylar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-650">
                  {filteredItems.map((item) => (
                    <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors duration-150">
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-zinc-950 text-[13px]">{item.fullName}</span>
                          <span className="text-[10px] text-zinc-400 font-semibold">{item.email}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-semibold text-zinc-850">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded bg-zinc-50 border border-zinc-150 flex items-center justify-center p-0.5 shrink-0">
                            {item.imageUrl ? (
                              <img src={item.imageUrl} className="w-full h-full object-contain" alt="" />
                            ) : (
                              <span className="material-symbols-outlined text-[14px] text-zinc-450">image</span>
                            )}
                          </div>
                          <span className="truncate max-w-[180px]">{item.productName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono font-bold text-zinc-750">
                        {item.serialNumber}
                      </td>
                      <td className="px-6 py-4 text-zinc-500 font-medium">
                        {new Date(item.createdAtUtc).toLocaleDateString('tr-TR')}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button
                          variant="outline"
                          onClick={() => setSelectedItem(item)}
                          className="rounded-xl px-3 py-1.5 font-bold hover:bg-zinc-50 active:scale-95 transition-all text-[11px]"
                        >
                          Detay
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setSelectedItem(null)} />
          <div className="bg-white rounded-3xl border border-zinc-200 shadow-2xl overflow-hidden w-full max-w-lg relative z-10 animate-in">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-5 bg-zinc-50/50">
              <h2 className="text-base font-bold text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-xl">app_registration</span>
                Kayıt Detayları
              </h2>
              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                className="grid h-9 w-9 place-items-center rounded-full hover:bg-zinc-100 transition-colors"
              >
                <span className="material-symbols-outlined text-zinc-500">close</span>
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Customer Information */}
              <div className="space-y-3">
                <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest border-b border-zinc-100 pb-1.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs">person</span>
                  Müşteri Bilgileri
                </h3>
                <div className="grid grid-cols-2 gap-4 text-xs font-semibold">
                  <div>
                    <p className="text-[10px] text-zinc-400">Ad Soyad</p>
                    <p className="text-zinc-800 font-bold mt-0.5">{selectedItem.fullName}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-400">Üye Kayıt Tarihi</p>
                    <p className="text-zinc-800 font-bold mt-0.5">
                      {new Date(selectedItem.userCreatedAtUtc).toLocaleDateString('tr-TR')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-400">E-posta</p>
                    <p className="text-zinc-800 font-bold mt-0.5">{selectedItem.email}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-zinc-400">Telefon</p>
                    <p className="text-zinc-800 font-bold mt-0.5">{selectedItem.phone}</p>
                  </div>
                </div>
              </div>

              {/* Product Information */}
              <div className="space-y-3">
                <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest border-b border-zinc-100 pb-1.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs">inventory</span>
                  Ürün Bilgileri
                </h3>
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 bg-zinc-50 border border-zinc-200 rounded-xl overflow-hidden flex items-center justify-center p-1 shrink-0">
                    {selectedItem.imageUrl ? (
                      <img src={selectedItem.imageUrl} className="w-full h-full object-contain" alt="" />
                    ) : (
                      <span className="material-symbols-outlined text-zinc-350 text-2xl">image</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-xs font-semibold flex-1">
                    <div className="col-span-2">
                      <p className="text-[10px] text-zinc-400">Ürün Adı</p>
                      <p className="text-zinc-800 font-bold mt-0.5">{selectedItem.productName}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-400">Seri Numarası</p>
                      <p className="text-zinc-800 font-mono font-bold mt-0.5">{selectedItem.serialNumber}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-zinc-400">Ürün Kayıt Tarihi</p>
                      <p className="text-zinc-800 font-bold mt-0.5">
                        {new Date(selectedItem.createdAtUtc).toLocaleDateString('tr-TR')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-zinc-150 flex justify-end bg-zinc-50/50">
              <Button onClick={() => setSelectedItem(null)} className="rounded-xl px-5 font-bold">
                Kapat
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
