import { useEffect, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { getAdminToken, readApiResponse } from '../lib/api'
import { useToast } from '../components/ui/ToastContext'

type AffiliateCoupon = {
  id: string
  code: string
  discountType: 'Percentage' | 'FixedAmount'
  discountValue: number
  minOrderAmount: number
  isActive: boolean
  description: string // Brand/Person Name
  validFrom: string
  validUntil: string
  usageLimit: number
  usedCount: number
  totalDiscount: number
}

export function AdminAffiliatePage() {
  const { showToast } = useToast()
  const [coupons, setCoupons] = useState<AffiliateCoupon[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; code: string } | null>(null)

  // Form states for defining new affiliate coupon
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [discountType, setDiscountType] = useState<'Percentage' | 'FixedAmount'>('Percentage')
  const [discountValue, setDiscountValue] = useState('')
  const [minOrderAmount, setMinOrderAmount] = useState('')

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/modules/affiliates', {
        headers: { Authorization: `Bearer ${getAdminToken()}` }
      })
      const json = await readApiResponse(res)
      if (res.ok && Array.isArray(json?.data)) {
        setCoupons(json.data)
      }
    } catch {
      showToast('Ortaklık kuponları yüklenemedi.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) {
      showToast('Kupon kodu zorunludur.', 'error')
      return
    }
    if (!discountValue.trim() || isNaN(parseFloat(discountValue))) {
      showToast('Geçerli bir indirim değeri girin.', 'error')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        code: code.trim().toUpperCase(),
        description: description.trim(),
        discountType,
        discountValue: parseFloat(discountValue),
        minOrderAmount: minOrderAmount.trim() ? parseFloat(minOrderAmount) : 0,
      }

      const res = await fetch('/api/admin/modules/affiliates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAdminToken()}`,
        },
        body: JSON.stringify(payload),
      })

      const json = await readApiResponse(res)
      if (res.ok && json?.success) {
        showToast('Ortaklık kuponu başarıyla tanımlandı.', 'success')
        setCode('')
        setDescription('')
        setDiscountValue('')
        setMinOrderAmount('')
        load()
      } else {
        showToast(json?.message || 'Kupon oluşturulamadı.', 'error')
      }
    } catch {
      showToast('Bağlantı hatası.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  function handleDelete(id: string, codeStr: string) {
    setDeleteTarget({ id, code: codeStr })
  }

  async function executeDelete(id: string, codeStr: string) {
    try {
      const res = await fetch(`/api/admin/modules/affiliates/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getAdminToken()}` },
      })
      const json = await readApiResponse(res)
      if (res.ok && json?.success) {
        showToast(`"${codeStr}" kuponu başarıyla silindi.`, 'success')
        load()
      } else {
        showToast(json?.message || 'Kupon silinemedi.', 'error')
      }
    } catch {
      showToast('Bağlantı hatası.', 'error')
    }
  }

  return (
    <AdminLayout
      title="Ortaklık & Marka Kupon Yönetimi"
      subtitle="Markalara veya kişilere özel kupon kodları tanımlayın, kullanım adetlerini ve bu kodlar ile yapılan toplam indirim tutarlarını izleyin."
    >
      {/* KPI Cards */}
      <div className="grid gap-5 sm:grid-cols-3">
        {[
          { label: 'Toplam Kupon Sayısı', value: `${coupons.length} Adet`, icon: 'confirmation_number', color: 'text-zinc-650 bg-zinc-50 border-zinc-150' },
          { label: 'Toplam Kullanım Sayısı', value: `${coupons.reduce((acc, c) => acc + c.usedCount, 0)} Kullanım`, icon: 'analytics', color: 'text-blue-600 bg-blue-50 border-blue-100' },
          { label: 'Kuponlarla Yapılan Toplam İndirim', value: `${coupons.reduce((acc, c) => acc + c.totalDiscount, 0).toLocaleString('tr-TR')} ₺`, icon: 'payments', color: 'text-green-600 bg-green-50 border-green-100' },
        ].map((item) => (
          <div key={item.label} className="rounded-3xl border border-zinc-200/85 bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition-all duration-300 hover:shadow-md hover:border-zinc-350/80 hover:-translate-y-0.5">
            <div className="flex justify-between items-start">
              <span className="text-[11px] font-extrabold tracking-wider text-zinc-455 uppercase">{item.label}</span>
              <span className={`material-symbols-outlined text-[20px] p-2 rounded-2xl border ${item.color}`}>{item.icon}</span>
            </div>
            <div className="mt-2 text-2xl font-black tracking-tight text-zinc-900">{item.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Coupons List (65%) */}
        <div className="lg:col-span-8 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-sm w-full">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-8 h-8 border-4 border-zinc-200 border-t-primary rounded-full animate-spin mb-2" />
              <span className="text-xs text-zinc-400">Veriler yükleniyor...</span>
            </div>
          ) : coupons.length === 0 ? (
            <div className="py-20 text-center text-zinc-400 font-medium italic">
              Henüz tanımlanmış ortaklık kuponu bulunmamaktadır.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-50/80 border-b border-zinc-200/80 text-[10px] font-extrabold tracking-wider text-zinc-455 uppercase">
                    <th className="px-5 py-4">Kupon Kodu</th>
                    <th className="px-5 py-4">Marka / Kişi</th>
                    <th className="px-5 py-4 text-center">İndirim Miktarı</th>
                    <th className="px-5 py-4 text-center">Min. Alım Barajı</th>
                    <th className="px-5 py-4 text-center">Kullanım Sayısı</th>
                    <th className="px-5 py-4 text-center">Toplam Yapılan İndirim</th>
                    <th className="px-5 py-4 text-right">İşlemler</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-650">
                  {coupons.map((c) => (
                    <tr key={c.id} className="hover:bg-zinc-50/50 transition-colors duration-150">
                      <td className="px-5 py-4.5 font-mono font-bold text-[#df0000] text-[13px]">
                        {c.code}
                      </td>
                      <td className="px-5 py-4.5 font-semibold text-zinc-950">
                        {c.description || <span className="text-zinc-300 italic font-normal">Belirtilmedi</span>}
                      </td>
                      <td className="px-5 py-4.5 text-center font-bold text-zinc-700">
                        {c.discountType === 'Percentage' ? `%${c.discountValue}` : `${c.discountValue.toLocaleString('tr-TR')} ₺`}
                      </td>
                      <td className="px-5 py-4.5 text-center font-bold text-zinc-600">
                        {c.minOrderAmount > 0 ? `${c.minOrderAmount.toLocaleString('tr-TR')} ₺` : <span className="text-zinc-300 italic font-normal">Yok</span>}
                      </td>
                      <td className="px-5 py-4.5 text-center font-bold text-zinc-800">
                        {c.usedCount}
                      </td>
                      <td className="px-5 py-4.5 text-center font-extrabold text-green-700">
                        {c.totalDiscount > 0 ? `${c.totalDiscount.toLocaleString('tr-TR')} ₺` : '0 ₺'}
                      </td>
                      <td className="px-5 py-4.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleDelete(c.id, c.code)}
                          className="grid h-8 w-8 place-items-center rounded-full hover:bg-rose-50 text-zinc-400 hover:text-rose-600 transition-colors ml-auto"
                          title="Sil"
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right: Define New Coupon (35%) */}
        <div className="lg:col-span-4 rounded-3xl border border-zinc-200/80 bg-white p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-zinc-800 uppercase tracking-wider flex items-center gap-2">
            <span className="material-symbols-outlined text-[#df0000]">confirmation_number</span>
            Yeni Kupon Tanımla
          </h3>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">Kupon Kodu</label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\s+/g, ''))}
                placeholder="Örn: MARKA20"
                required
                className="rounded-2xl"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">Marka / Kişi Adı</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Örn: Stilsoft Marka Ortağı"
                className="rounded-2xl"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">İndirim Tipi</label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as any)}
                className="w-full h-11 px-4 border border-zinc-200 rounded-2xl text-xs font-semibold text-zinc-700 bg-white outline-none focus:ring-4 focus:ring-[#df0000]/5"
              >
                <option value="Percentage">Yüzdesel (%)</option>
                <option value="FixedAmount">Tutarsal (₺)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">İndirim Miktarı</label>
              <Input
                type="number"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === 'Percentage' ? 'Örn: 20' : 'Örn: 150'}
                required
                className="rounded-2xl"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">Minimum Alım Barajı (₺)</label>
              <Input
                type="number"
                value={minOrderAmount}
                onChange={(e) => setMinOrderAmount(e.target.value)}
                placeholder="Boş bırakılabilir (Örn: 500)"
                className="rounded-2xl"
              />
            </div>

            <Button
              type="submit"
              disabled={submitting}
              className="w-full rounded-2xl bg-[#df0000] text-white hover:bg-[#c00000] py-3 font-bold h-11 transition-all"
            >
              {submitting ? 'Tanımlanıyor...' : 'Kuponu Oluştur'}
            </Button>
          </form>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xs" onClick={() => setDeleteTarget(null)} />
          <div className="bg-white rounded-3xl border border-zinc-200/80 shadow-2xl overflow-hidden w-full max-w-md relative z-10 animate-in">
            <div className="p-6 space-y-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-50 text-[#df0000] flex items-center justify-center shrink-0 border border-rose-100">
                  <span className="material-symbols-outlined text-[20px]">warning</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-900">Kuponu Sil</h3>
                  <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                    <strong>"{deleteTarget.code}"</strong> kodlu ortaklık kuponunu silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.
                  </p>
                </div>
              </div>

              <div className="flex gap-2.5 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setDeleteTarget(null)}
                  className="rounded-xl px-4 py-2 font-bold text-xs h-9 border-zinc-200 text-zinc-655 hover:bg-zinc-50"
                >
                  Vazgeç
                </Button>
                <Button
                  onClick={() => {
                    const target = deleteTarget
                    setDeleteTarget(null)
                    void executeDelete(target.id, target.code)
                  }}
                  className="rounded-xl px-4 py-2 font-bold text-xs bg-[#df0000] hover:bg-[#c00000] text-white h-9"
                >
                  Kuponu Sil
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
