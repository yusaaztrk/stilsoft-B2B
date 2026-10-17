import { useEffect, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/ToastContext'
import { getAdminToken } from '../lib/api'

type InventoryItem = {
  id: string
  name: string
  sku: string
  variant: string
  stock: number
  reserved: number
  available: number
  alertLimit: number
}

export function AdminInventoryPage() {
  const { showToast } = useToast()
  const [q, setQ] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('All') // All, Critical, Low, Normal
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [minStock, setMinStock] = useState<number>(10)

  async function fetchInventory() {
    setLoading(true)
    try {
      const token = getAdminToken()
      const res = await fetch('/api/admin/products?take=300', {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
      const json = await res.json()
      if (res.ok && Array.isArray(json?.data)) {
        setItems(json.data.map((p: any) => ({
          id: p.id,
          name: p.name || 'İsimsiz Ürün',
          sku: p.stockCode || '—',
          variant: '—',
          stock: typeof p.stock === 'number' ? p.stock : 0,
          reserved: 0,
          available: typeof p.stock === 'number' ? p.stock : 0,
          alertLimit: 10
        })))
      } else {
        showToast(json?.message || 'Ürünler yüklenemedi.', 'error')
      }
    } catch {
      showToast('Stok verileri alınırken bağlantı hatası oluştu.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchInventory()
  }, [])

  const handleStockChange = (id: string, val: number) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const newStock = Math.max(0, val)
          const newAvail = Math.max(0, newStock - item.reserved)
          return { ...item, stock: newStock, available: newAvail }
        }
        return item
      })
    )
  }

  const saveQuickStock = async (id: string) => {
    const item = items.find((x) => x.id === id)
    if (!item) return
    try {
      const token = getAdminToken()
      const res = await fetch(`/api/admin/products/${id}/stock`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ stock: item.stock })
      })
      const json = await res.json()
      if (res.ok && json?.success) {
        showToast('Stok başarıyla güncellendi.', 'success')
      } else {
        showToast(json?.message || 'Stok güncellenemedi.', 'error')
      }
    } catch {
      showToast('Bağlantı hatası oluştu.', 'error')
    }
  }

  const filteredItems = items.filter((item) => {
    const matchesSearch = `${item.name} ${item.sku}`.toLowerCase().includes(q.toLowerCase())
    if (!matchesSearch) return false

    if (selectedStatus === 'Critical') return item.stock === 0
    if (selectedStatus === 'Low') return item.stock <= minStock
    if (selectedStatus === 'Normal') return item.stock > minStock
    return true
  })

  // KPI Metrics
  const totalSku = items.length
  const criticalCount = items.filter((x) => x.stock === 0).length
  const lowCount = items.filter((x) => x.stock <= minStock).length
  const stockValue = items.reduce((acc, x) => acc + (x.stock * 1250), 0)

  return (
    <AdminLayout
      title="Stok Yönetimi"
      subtitle="Ürünlerin stok seviyelerini, kritik uyarı limitlerini ve rezervasyon miktarlarını takip edin."
    >
      {/* KPI Section */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Toplam SKU', value: totalSku.toLocaleString(), icon: 'inventory_2', color: 'text-zinc-655 bg-zinc-50 border-zinc-150' },
          { label: 'Kritik Stok (Tükendi)', value: criticalCount.toString(), icon: 'error', color: 'text-rose-600 bg-rose-50 border-rose-100' },
          { label: 'Stok Limitleri Uyarısı', value: lowCount.toString(), icon: 'warning', color: 'text-amber-600 bg-amber-50 border-amber-100' },
          { label: 'Yaklaşık Stok Değeri', value: `${stockValue.toLocaleString('tr-TR')} ₺`, icon: 'payments', color: 'text-green-600 bg-green-50 border-green-100' },
        ].map((item) => (
          <div key={item.label} className="rounded-3xl border border-zinc-200/85 bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all duration-300 hover:shadow-md hover:border-zinc-350/80 hover:-translate-y-0.5">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-450 uppercase">{item.label}</span>
              <span className={`material-symbols-outlined text-[20px] p-2 rounded-2xl border ${item.color}`}>{item.icon}</span>
            </div>
            <div className="mt-2 text-2xl font-black tracking-tight text-zinc-900">{item.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-5 border border-zinc-200/80 rounded-3xl shadow-[0_2px_8px_rgba(0,0,0,0.02)]">
        <div className="w-full md:w-80 relative">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ürün adı veya SKU ile ara..."
            className="rounded-2xl pl-10"
          />
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400">
            <span className="material-symbols-outlined text-[18px]">search</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Minimum Stock Limit Input */}
          <div className="flex items-center gap-2 border border-zinc-200 rounded-2xl px-3 py-1.5 bg-zinc-50/50">
            <span className="text-[11px] font-extrabold tracking-wider text-zinc-500 uppercase">Min. Stok:</span>
            <input
              type="number"
              value={minStock}
              onChange={(e) => setMinStock(Math.max(0, Number(e.target.value)))}
              className="w-16 h-7 border border-zinc-200 rounded-lg text-center font-bold text-zinc-800 text-xs focus:border-[#df0000] outline-none"
            />
          </div>

          <div className="flex gap-2">
            {[
              { key: 'All', label: 'Tümü' },
              { key: 'Critical', label: 'Tükenen' },
              { key: 'Low', label: 'Stok Limitleri' },
              { key: 'Normal', label: 'Normal' },
            ].map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSelectedStatus(s.key)}
                className={`px-4 py-2 rounded-2xl text-xs font-bold border transition-all ${
                  selectedStatus === s.key
                    ? 'bg-zinc-900 border-zinc-900 text-white shadow-sm'
                    : 'bg-white border-zinc-200 text-zinc-655 hover:bg-zinc-50'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid Table */}
      <div className="mt-6 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)]">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#df0000]/20 border-t-[#df0000] rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50/80 border-b border-zinc-200/80 text-[10px] font-extrabold tracking-wider text-zinc-455 uppercase">
                  <th className="px-6 py-4">Ürün Detayı / SKU</th>
                  <th className="px-6 py-4">Varyant</th>
                  <th className="px-6 py-4 text-center">Mevcut Stok</th>
                  <th className="px-6 py-4 text-center">Rezerve</th>
                  <th className="px-6 py-4 text-center">Kullanılabilir</th>
                  <th className="px-6 py-4 text-center">Limit</th>
                  <th className="px-6 py-4 text-right">Hızlı Güncelle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-650">
                {filteredItems.map((item) => {
                  let badgeClass = 'bg-green-50 border-green-200 text-green-700'
                  let labelText = 'Normal'
                  if (item.stock === 0) {
                    badgeClass = 'bg-rose-50 border-rose-200 text-rose-700 font-extrabold'
                    labelText = 'TÜKENDİ'
                  } else if (item.stock <= minStock) {
                    badgeClass = 'bg-amber-50 border-amber-200 text-amber-700'
                    labelText = 'Kritik Limit'
                  }

                  return (
                    <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors duration-150">
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-zinc-950 text-[13px]">{item.name}</span>
                          <span className="text-[10px] text-zinc-400 font-mono mt-0.5">SKU: {item.sku}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-semibold text-zinc-600">{item.variant}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${badgeClass}`}>
                          {item.stock} {labelText}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center font-bold text-zinc-500">{item.reserved}</td>
                      <td className="px-6 py-4 text-center font-extrabold text-zinc-800">{item.available}</td>
                      <td className="px-6 py-4 text-center font-bold text-zinc-400">{minStock}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleStockChange(item.id, item.stock - 1)}
                            className="w-7 h-7 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 active:scale-95 text-zinc-600 flex items-center justify-center font-extrabold"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            value={item.stock}
                            onChange={(e) => handleStockChange(item.id, Number(e.target.value))}
                            className="w-12 h-7 border border-zinc-200 rounded-lg text-center font-bold text-zinc-800 text-xs focus:border-[#df0000] outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleStockChange(item.id, item.stock + 1)}
                            className="w-7 h-7 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 active:scale-95 text-zinc-600 flex items-center justify-center font-extrabold"
                          >
                            +
                          </button>
                          <button
                            type="button"
                            onClick={() => saveQuickStock(item.id)}
                            className="w-7 h-7 ml-1 rounded-lg bg-green-600 hover:bg-green-700 active:scale-95 text-white flex items-center justify-center"
                            title="Kaydet"
                          >
                            <span className="material-symbols-outlined text-[16px]">check</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {!loading && filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-16 text-center text-zinc-400 font-medium italic">
                      Bu filtreye uygun ürün bulunamadı.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bulk Update Card */}
      <div className="mt-6 rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider">Toplu Stok Güncelleme</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <div className="border-2 border-dashed border-zinc-200 hover:border-[#df0000] rounded-3xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all">
            <span className="material-symbols-outlined text-[36px] text-zinc-400 mb-2">upload_file</span>
            <span className="text-xs font-bold text-zinc-700">Toplu Güncelleme İçin CSV/Excel Yükleyin</span>
            <span className="text-[10px] font-semibold text-zinc-400 mt-1">Sadece .csv, .xlsx formatları</span>
          </div>

          <div className="space-y-4">
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="rounded-2xl active:scale-95 flex-1 py-3">
                <span className="material-symbols-outlined text-xs mr-2">download</span>
                Stok Şablonu İndir
              </Button>
              <Button type="button" variant="primary" className="rounded-2xl bg-[#df0000] hover:bg-[#c00000] active:scale-95 flex-1 py-3">
                <span className="material-symbols-outlined text-xs mr-2">upload</span>
                Stokları Yükle
              </Button>
            </div>

            <div className="space-y-2.5">
              <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider block">Son İçe Aktarma Geçmişi</span>
              <div className="divide-y divide-zinc-100 text-[11px] text-zinc-600">
                {[
                  { file: 'stok_listesi_haziran.csv', date: '06.06.2025 10:12', status: 'Başarılı', count: '1.248 ürün' },
                  { file: 'stok_guncelleme_mayis.csv', date: '28.05.2025 15:40', status: 'Başarılı', count: '94 ürün' },
                  { file: 'excel_import_stok.xlsx', date: '12.05.2025 09:20', status: 'Başarılı', count: '280 ürün' },
                ].map((log, idx) => (
                  <div key={idx} className="flex justify-between py-2 items-center">
                    <span className="font-semibold text-zinc-800 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-zinc-400 text-[14px]">article</span>
                      {log.file}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-zinc-450">{log.date}</span>
                      <span className="text-zinc-500 font-bold">{log.count}</span>
                      <span className="text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded-lg border border-green-100">{log.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
