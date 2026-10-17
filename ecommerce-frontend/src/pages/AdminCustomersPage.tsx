import { useEffect, useMemo, useState } from 'react'
import { AdminLayout } from '../components/admin/AdminLayout'
import { Icon } from '../components/Icon'
import { getAdminToken, readApiResponse } from '../lib/api'

type CustomerRow = {
  id: string
  rawId: string
  name: string
  email: string
  phone: string
  isActive: boolean
  createdAtUtc?: string
}

type ApiCustomerDto = {
  id: string
  email: string
  fullName?: string | null
  phone?: string | null
  isActive?: boolean
  createdAtUtc?: string
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

export function AdminCustomersPage() {
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'Tümü' | 'Aktif' | 'Engelli'>('Tümü')

  const [rows, setRows] = useState<CustomerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editRow, setEditRow] = useState<CustomerRow | null>(null)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const token = getAdminToken()
        if (!token) throw new Error('Oturum bulunamadı. Lütfen tekrar giriş yapın.')

        const res = await fetch('/api/admin/customers', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })

        const json = await readApiResponse(res)
        if (!res.ok || json?.success === false) {
          throw new Error(json?.message || 'Müşteriler yüklenemedi')
        }

        const items: ApiCustomerDto[] = Array.isArray(json?.data) ? json.data : []
        const mapped: CustomerRow[] = items
          .filter((x) => x && typeof x.id === 'string')
          .map((x) => ({
            id: `C-${x.id.slice(0, 8).toUpperCase()}`,
            rawId: x.id,
            name: (x.fullName || '').trim() || '(İsimsiz)',
            email: String(x.email || '').trim(),
            phone: String(x.phone || '').trim() || '-',
            isActive: Boolean(x.isActive ?? true),
            createdAtUtc: x.createdAtUtc,
          }))

        if (!cancelled) setRows(mapped)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Müşteriler yüklenemedi')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter === 'Aktif' && !r.isActive) return false
      if (statusFilter === 'Engelli' && r.isActive) return false
      if (!s) return true
      return `${r.id} ${r.name} ${r.email} ${r.phone}`.toLowerCase().includes(s)
    })
  }, [q, rows, statusFilter])

  const activeCount = useMemo(() => rows.filter((r) => r.isActive).length, [rows])
  const blockedCount = useMemo(() => rows.filter((r) => !r.isActive).length, [rows])
  const newThisMonth = useMemo(() => {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    return rows.filter((r) => {
      if (!r.createdAtUtc) return false
      return new Date(r.createdAtUtc) >= startOfMonth
    }).length
  }, [rows])

  return (
    <AdminLayout
      title="Müşteriler"
      subtitle="Müşteri listesi, segmentler ve temel müşteri bilgileri."
      top={
        <div className="flex w-full flex-col sm:flex-row items-center justify-end gap-3">
          <div className="flex w-full sm:w-[380px] items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white px-4 py-2.5 text-sm text-zinc-700 shadow-[0_2px_8px_rgba(0,0,0,0.02)] focus-within:ring-4 focus-within:ring-[#df0000]/5 focus-within:border-[#df0000] transition-all duration-200">
            <Icon name="search" className="h-5 w-5 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Müşteri adı, e-posta veya telefon ara..."
              className="w-full bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 outline-none"
            />
          </div>

          <div className="relative w-full sm:w-auto shrink-0">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full sm:w-auto h-11 pl-4 pr-10 border border-zinc-200 rounded-2xl text-xs font-bold text-zinc-700 bg-white outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] appearance-none transition-all duration-200 hover:bg-zinc-50/50"
            >
              <option value="Tümü">Durum: Tümü</option>
              <option value="Aktif">Aktif</option>
              <option value="Engelli">Engelli</option>
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400 flex items-center">
              <span className="material-symbols-outlined text-[16px]">unfold_more</span>
            </div>
          </div>
        </div>
      }
    >
      {editOpen && editRow ? (
        <div className="fixed inset-0 z-[80] overflow-y-auto">
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={() => setEditOpen(false)} />
          <div className="flex min-h-screen items-center justify-center p-4">
            <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between border-b border-zinc-150 px-6 py-4.5">
                <div>
                  <div className="text-[10px] font-extrabold tracking-widest text-[#df0000] uppercase">MÜŞTERİ DÜZENLE</div>
                  <div className="mt-1 text-base font-bold text-zinc-900">{editRow.name}</div>
                </div>
                <button 
                  type="button" 
                  onClick={() => setEditOpen(false)} 
                  className="w-8 h-8 rounded-full hover:bg-zinc-100 text-zinc-500 flex items-center justify-center transition-colors"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>

              <div className="p-6 space-y-5">
                <label className="block space-y-2">
                  <div className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Ad Soyad</div>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all duration-200"
                    placeholder="Ad Soyad"
                  />
                </label>
                <label className="block space-y-2">
                  <div className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Telefon (11 hane)</div>
                  <input
                    value={editPhone}
                    onChange={(e) => setEditPhone(String(e.target.value ?? '').replace(/\D/g, '').slice(0, 11))}
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900 outline-none focus:ring-4 focus:ring-[#df0000]/5 focus:border-[#df0000] transition-all duration-200"
                    placeholder="05xxxxxxxxx"
                    inputMode="numeric"
                  />
                </label>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-150">
                  <button 
                    type="button" 
                    onClick={() => setEditOpen(false)} 
                    className="h-11 rounded-2xl border border-zinc-200 bg-white px-4 text-xs font-bold text-zinc-700 hover:bg-zinc-50 transition active:scale-[0.98]"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    disabled={saving || !editName.trim() || editPhone.trim().length !== 11}
                    className="h-11 rounded-2xl bg-[#df0000] px-5 text-xs font-bold text-white disabled:opacity-50 hover:bg-[#c00000] transition active:scale-[0.98] shadow-sm shadow-[#df0000]/10"
                    onClick={async () => {
                      try {
                        const token = getAdminToken()
                        if (!token) throw new Error('Oturum bulunamadı')
                        setSaving(true)
                        setError(null)

                        const res = await fetch(`/api/admin/customers/${editRow.rawId}`, {
                          method: 'PUT',
                          headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${token}`,
                          },
                          body: JSON.stringify({ fullName: editName.trim(), phone: editPhone.trim() }),
                        })
                        const json = await readApiResponse(res)
                        if (!res.ok || json?.success === false) throw new Error(json?.message || 'Kaydedilemedi')

                        setRows((prev) => prev.map((r) => (r.rawId === editRow.rawId ? { ...r, name: editName.trim(), phone: editPhone.trim() } : r)))
                        setEditOpen(false)
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Kaydedilemedi')
                      } finally {
                        setSaving(false)
                      }
                    }}
                  >
                    {saving ? 'Kaydediliyor...' : 'Kaydet'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-3xl border border-rose-200 bg-rose-50/50 p-5 text-sm text-rose-700 shadow-[0_2px_8px_rgba(0,0,0,0.02)] mb-6">
          <div className="flex gap-2 items-center font-semibold mb-1">
            <span className="material-symbols-outlined text-rose-500 text-[18px]">error</span>
            Hata Oluştu
          </div>
          <p className="text-rose-600">{error}</p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-3xl border border-zinc-200/85 bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)] transition-all duration-300 hover:shadow-md hover:border-zinc-350/85 hover:-translate-y-0.5">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Toplam Müşteri</span>
            <span className="material-symbols-outlined text-[20px] p-2 rounded-2xl border border-zinc-150 text-zinc-500 bg-zinc-50">groups</span>
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-zinc-900">{loading ? '…' : rows.length}</div>
          <div className="mt-1.5 text-[10px] font-extrabold text-green-600 flex items-center gap-0.5">
            <span className="material-symbols-outlined text-[12px] font-bold">arrow_upward</span> Canlı veriler
          </div>
        </div>
        <div className="rounded-3xl border border-zinc-200/85 bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)] transition-all duration-300 hover:shadow-md hover:border-zinc-350/85 hover:-translate-y-0.5">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Aktif Müşteriler</span>
            <span className="material-symbols-outlined text-[20px] p-2 rounded-2xl border border-green-100 text-green-600 bg-green-50/50">how_to_reg</span>
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-zinc-900">{loading ? '…' : activeCount}</div>
          <div className="mt-1.5 text-[10px] font-extrabold text-green-500 flex items-center">
            Sistemde aktif durumda olanlar
          </div>
        </div>
        <div className="rounded-3xl border border-zinc-200/85 bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)] transition-all duration-300 hover:shadow-md hover:border-zinc-350/85 hover:-translate-y-0.5">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Engellenen Hesaplar</span>
            <span className="material-symbols-outlined text-[20px] p-2 rounded-2xl border border-rose-100 text-rose-600 bg-rose-50/50">block</span>
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-zinc-900">{loading ? '…' : blockedCount}</div>
          <div className="mt-1.5 text-[10px] font-extrabold text-rose-500 flex items-center">
            Girişi engellenmiş üyeler
          </div>
        </div>
        <div className="rounded-3xl border border-zinc-200/85 bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_20px_rgba(0,0,0,0.015)] transition-all duration-300 hover:shadow-md hover:border-zinc-350/85 hover:-translate-y-0.5">
          <div className="flex justify-between items-start">
            <span className="text-[11px] font-extrabold tracking-wider text-zinc-400 uppercase">Yeni Üyeler (Bu Ay)</span>
            <span className="material-symbols-outlined text-[20px] p-2 rounded-2xl border border-blue-100 text-blue-650 bg-blue-50/50">person_add</span>
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-zinc-900">{loading ? '…' : newThisMonth}</div>
          <div className="mt-1.5 text-[10px] font-extrabold text-blue-500 flex items-center">
            Bu ay içinde kayıt olanlar
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.02),0_8px_24px_rgba(0,0,0,0.02)]">
        <div className="grid grid-cols-12 gap-3 border-b border-zinc-200/80 bg-zinc-50/80 px-6 py-4 text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">
          <div className="col-span-2">Kod</div>
          <div className="col-span-3">Müşteri</div>
          <div className="col-span-3">E-posta</div>
          <div className="col-span-2">Telefon</div>
          <div className="col-span-1 text-right">Durum</div>
          <div className="col-span-1 text-right">İşlem</div>
        </div>

        <div className="divide-y divide-zinc-150/60">
          {filtered.map((r) => (
            <div key={r.id} className="grid grid-cols-12 gap-3 px-6 py-4 text-xs items-center transition duration-150 hover:bg-zinc-50/50">
              <div className="col-span-2 font-mono text-[11px] font-bold text-zinc-500 flex items-center">{r.id}</div>
              <div
                onClick={() => {
                  setSelectedCustomerId(r.rawId)
                  setDetailOpen(true)
                }}
                className="col-span-3 font-semibold text-zinc-900 text-[13px] flex items-center cursor-pointer hover:text-[#df0000] hover:underline transition-colors"
              >
                {r.name}
              </div>
              <div className="col-span-3 text-zinc-550 text-[11px] flex items-center">{r.email}</div>
              <div className="col-span-2 text-zinc-550 text-[11px] flex items-center">{r.phone}</div>
              <div className="col-span-1 flex items-center justify-end">
                <span className={cx('inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider', r.isActive ? 'border-green-200 bg-green-50 text-green-700' : 'border-rose-200 bg-rose-50 text-rose-700')}>
                  {r.isActive ? 'Aktif' : 'Engelli'}
                </span>
              </div>
              <div className="col-span-1 flex items-center justify-end relative">
                <button
                  type="button"
                  className="w-8 h-8 rounded-full hover:bg-zinc-100 flex items-center justify-center text-zinc-500 active:scale-95 transition-all"
                  onClick={(e) => {
                    e.stopPropagation()
                    setActiveDropdownId(activeDropdownId === r.rawId ? null : r.rawId)
                  }}
                >
                  <span className="material-symbols-outlined text-[20px]">more_vert</span>
                </button>

                {activeDropdownId === r.rawId && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setActiveDropdownId(null)} />
                    <div className="absolute right-0 mt-1.5 w-48 rounded-2xl border border-zinc-200 bg-white shadow-xl py-2 z-40 text-left animate-in fade-in slide-in-from-top-2 duration-150">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveDropdownId(null)
                          setSelectedCustomerId(r.rawId)
                          setDetailOpen(true)
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">visibility</span>
                        Detay Gör
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setActiveDropdownId(null)
                          setEditRow(r)
                          setEditName(r.name)
                          setEditPhone(r.phone === '-' ? '' : r.phone)
                          setEditOpen(true)
                        }}
                        className="flex w-full items-center gap-2 px-4 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">edit</span>
                        Düzenle
                      </button>

                      <a
                        href={`/admin/service-requests?search=${encodeURIComponent(r.name)}`}
                        className="flex w-full items-center gap-2 px-4 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 transition-colors"
                        onClick={() => setActiveDropdownId(null)}
                      >
                        <span className="material-symbols-outlined text-[16px]">build</span>
                        Servis Talepleri
                      </a>

                      <div className="border-t border-zinc-100 my-1" />

                      <button
                        type="button"
                        onClick={async () => {
                          setActiveDropdownId(null)
                          try {
                            const token = getAdminToken()
                            if (!token) throw new Error('Oturum bulunamadı')
                            setError(null)

                            const res = await fetch(`/api/admin/customers/${r.rawId}/active`, {
                              method: 'PUT',
                              headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${token}`,
                              },
                              body: JSON.stringify({ isActive: !r.isActive }),
                            })
                            const json = await readApiResponse(res)
                            if (!res.ok || json?.success === false) throw new Error(json?.message || 'İşlem başarısız')

                            setRows((prev) => prev.map((x) => (x.rawId === r.rawId ? { ...x, isActive: !r.isActive } : x)))
                          } catch (e) {
                            setError(e instanceof Error ? e.message : 'İşlem başarısız')
                          }
                        }}
                        className={cx(
                          "flex w-full items-center gap-2 px-4 py-2 text-xs font-bold transition-colors",
                          r.isActive ? "text-rose-600 hover:bg-rose-50" : "text-green-600 hover:bg-green-50"
                        )}
                      >
                        <span className="material-symbols-outlined text-[16px]">{r.isActive ? 'block' : 'lock_open'}</span>
                        {r.isActive ? 'Engelle' : 'Hesabı Aç'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}

          {filtered.length === 0 ? (
            <div className="px-6 py-16 text-center text-zinc-400 font-medium italic bg-white animate-fade-in">
              Sonuç bulunamadı.
            </div>
          ) : null}
        </div>
      </div>

      {detailOpen && selectedCustomerId ? (
        <CustomerDetailModal
          customerId={selectedCustomerId}
          onClose={() => {
            setDetailOpen(false)
            setSelectedCustomerId(null)
          }}
          onEdit={() => {
            const customerRow = rows.find((r) => r.rawId === selectedCustomerId)
            if (customerRow) {
              setDetailOpen(false)
              setEditRow(customerRow)
              setEditName(customerRow.name)
              setEditPhone(customerRow.phone === '-' ? '' : customerRow.phone)
              setEditOpen(true)
            }
          }}
        />
      ) : null}
    </AdminLayout>
  )
}

type AddressItem = {
  id: string
  title: string
  fullName: string
  phone: string
  city: string
  district: string
  details: string
  region?: string
  mahalle?: string
  binaNo?: string
  daireNo?: string
  katNo?: string
}

type OrderItem = {
  id: string
  orderNo: string
  createdAt: string
  linesJson: string
  total: number
  status: string
  paymentStatus: string
}

type ReviewItem = {
  id: string
  productName: string
  rating: number
  comment: string
  status: string
  adminReply?: string | null
  createdAt: string
}

type ServiceRequestItem = {
  id: string
  productGroup: string
  modelNo: string
  description: string
  status: string
  createdAt: string
}

type CustomerDetailData = {
  profile: {
    id: string
    email: string
    fullName: string
    phone: string
    isActive: boolean
    createdAtUtc?: string
  }
  addresses: AddressItem[]
  orders: OrderItem[]
  reviews: ReviewItem[]
  serviceRequests: ServiceRequestItem[]
}

function CustomerDetailModal({ customerId, onClose, onEdit }: { customerId: string; onClose: () => void; onEdit: () => void }) {
  const [activeTab, setActiveTab] = useState<'orders' | 'addresses' | 'reviews' | 'services'>('orders')
  const [data, setData] = useState<CustomerDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function fetchDetails() {
      setLoading(true)
      setError(null)
      try {
        const token = getAdminToken()
        if (!token) throw new Error('Oturum bulunamadı. Lütfen tekrar giriş yapın.')

        const res = await fetch(`/api/admin/customers/${customerId}/details`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
        const json = await readApiResponse(res)
        if (!res.ok || json?.success === false) {
          throw new Error(json?.message || 'Müşteri detayları yüklenemedi.')
        }

        if (active) {
          setData(json.data)
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Yüklenirken hata oluştu')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    fetchDetails()
    return () => {
      active = false
    }
  }, [customerId])

  if (loading) {
    return (
      <div className="fixed inset-0 z-[80] overflow-y-auto flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
        <div className="relative w-full max-w-lg bg-white rounded-3xl p-8 shadow-2xl flex flex-col items-center justify-center">
          <div className="w-12 h-12 border-4 border-[#df0000] border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-4 text-sm font-semibold text-zinc-500">Müşteri verileri yükleniyor...</p>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="fixed inset-0 z-[80] overflow-y-auto flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
        <div className="relative w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl border border-zinc-150">
          <div className="flex justify-between items-center mb-4">
            <span className="text-sm font-bold text-zinc-900">Müşteri Detayı</span>
            <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-zinc-100 flex items-center justify-center text-zinc-550">
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4.5 text-xs text-rose-700 font-semibold mb-4 flex gap-2 items-center">
            <span className="material-symbols-outlined text-[18px]">error</span>
            {error || 'Veriler yüklenemedi'}
          </div>
          <div className="flex justify-end">
            <button onClick={onClose} className="h-10 px-4 bg-zinc-900 text-white font-bold rounded-2xl text-xs hover:bg-zinc-800 transition active:scale-95">
              Kapat
            </button>
          </div>
        </div>
      </div>
    )
  }

  const { profile, addresses, orders, reviews, serviceRequests } = data

  // Compute metrics
  const totalSpent = orders.reduce((sum, o) => sum + Number(o.total || 0), 0)
  const orderCount = orders.length
  const reviewCount = reviews.length
  const serviceCount = serviceRequests.length
  const initials =
    profile.fullName
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'M'

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className="flex min-h-screen items-center justify-center p-4 md:p-6 lg:p-8">
        <div className="relative w-full max-w-5xl h-[80vh] min-h-[600px] bg-white rounded-[2.5rem] shadow-2xl border border-zinc-200/50 flex flex-col overflow-hidden">
          {/* Modal Header */}
          <div className="flex items-center justify-between border-b border-zinc-150 px-6 py-4.5 bg-zinc-50/50">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-[#df0000]/10 text-[#df0000] border border-[#df0000]/10 flex items-center justify-center font-black text-sm">
                {initials}
              </div>
              <div>
                <div className="text-[10px] font-extrabold tracking-widest text-[#df0000] uppercase">MÜŞTERİ DETAYI</div>
                <div className="text-base font-bold text-zinc-900 flex items-center gap-2 mt-0.5 leading-none">
                  {profile.fullName}
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                      profile.isActive ? 'border-green-200 bg-green-50 text-green-700' : 'border-rose-200 bg-rose-50 text-rose-700'
                    }`}
                  >
                    {profile.isActive ? 'Aktif' : 'Engelli'}
                  </span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full hover:bg-zinc-100 text-zinc-550 flex items-center justify-center transition-colors active:scale-95"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          {/* Modal Body */}
          <div className="flex-1 overflow-y-auto lg:overflow-hidden grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 min-h-0">
            {/* Left Column - Profile Summary Card (col-span-4) */}
            <div className="lg:col-span-4 space-y-5 lg:overflow-y-auto lg:max-h-full pr-1">
              <div className="rounded-3xl border border-zinc-200/80 bg-zinc-50/30 p-5 space-y-4">
                <div className="text-xs font-bold text-zinc-800 uppercase tracking-wider">İletişim Bilgileri</div>

                <div className="space-y-3.5">
                  <div>
                    <span className="block text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">E-Posta</span>
                    <span className="text-xs font-semibold text-zinc-700 block mt-0.5 break-all">{profile.email}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">Telefon</span>
                    <span className="text-xs font-semibold text-zinc-700 block mt-0.5">{profile.phone || '-'}</span>
                  </div>
                  {profile.createdAtUtc && (
                    <div>
                      <span className="block text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">Kayıt Tarihi</span>
                      <span className="text-xs font-semibold text-zinc-700 block mt-0.5">
                        {new Date(profile.createdAtUtc).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </span>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-zinc-200/50 flex gap-2">
                  <button
                    type="button"
                    onClick={onEdit}
                    className="flex-1 h-9 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-xs transition active:scale-95 flex items-center justify-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-[15px]">edit</span>
                    Düzenle
                  </button>
                </div>
              </div>

              {/* Dynamic Stats Chips */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-zinc-50/50 border border-zinc-200/70 rounded-2xl p-4 flex flex-col">
                  <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider">Toplam Alışveriş</span>
                  <span className="text-sm font-black text-zinc-800 mt-1">
                    {totalSpent.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                  </span>
                </div>
                <div className="bg-zinc-50/50 border border-zinc-200/70 rounded-2xl p-4 flex flex-col">
                  <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider">Sipariş Adedi</span>
                  <span className="text-sm font-black text-zinc-800 mt-1">{orderCount} Sipariş</span>
                </div>
                <div className="bg-zinc-50/50 border border-zinc-200/70 rounded-2xl p-4 flex flex-col">
                  <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider">Değerlendirmeler</span>
                  <span className="text-sm font-black text-zinc-800 mt-1">{reviewCount} Yorum</span>
                </div>
                <div className="bg-zinc-50/50 border border-zinc-200/70 rounded-2xl p-4 flex flex-col">
                  <span className="text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider">Servis Talepleri</span>
                  <span className="text-sm font-black text-zinc-800 mt-1">{serviceCount} Talep</span>
                </div>
              </div>
            </div>

            {/* Right Column - Tabs and Tables (col-span-8) */}
            <div className="lg:col-span-8 flex flex-col lg:h-full lg:overflow-hidden min-h-0">
              {/* Tab Navigation */}
              <div className="flex gap-1 border-b border-zinc-200 pb-3 overflow-x-auto shrink-0 bg-white">
                {[
                  { key: 'orders', label: `Siparişler (${orderCount})`, icon: 'shopping_bag' },
                  { key: 'addresses', label: `Adresler (${addresses.length})`, icon: 'location_on' },
                  { key: 'reviews', label: `Yorumlar (${reviewCount})`, icon: 'rate_review' },
                  { key: 'services', label: `Servis Talepleri (${serviceCount})`, icon: 'construction' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key as any)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 ${
                      activeTab === tab.key
                        ? 'bg-zinc-900 text-white shadow-sm'
                        : 'text-zinc-550 hover:bg-zinc-100 hover:text-zinc-800'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content Panel */}
              <div className="flex-1 mt-4 lg:overflow-y-auto pr-1">
                {/* Orders Tab */}
                {activeTab === 'orders' && (
                  <div className="space-y-4">
                    <div className="overflow-hidden border border-zinc-150 rounded-2xl">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-zinc-50 border-b border-zinc-150 text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">
                            <th className="px-5 py-3">Sipariş No</th>
                            <th className="px-5 py-3">Tarih</th>
                            <th className="px-5 py-3">Ürünler</th>
                            <th className="px-5 py-3 text-center">Tutar</th>
                            <th className="px-5 py-3 text-right">Durum</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-750">
                          {orders.map((o) => {
                            let itemsText = '-'
                            try {
                              const parsed = JSON.parse(o.linesJson)
                              if (Array.isArray(parsed)) {
                                itemsText = parsed
                                  .map((line: any) => `${line.quantity || line.Quantity}x ${line.productName || line.ProductName}`)
                                  .join(', ')
                              }
                            } catch (err) {}

                            return (
                              <tr key={o.id} className="hover:bg-zinc-50/30">
                                <td className="px-5 py-3.5 font-mono font-bold text-zinc-700">{o.orderNo}</td>
                                <td className="px-5 py-3.5 text-zinc-500 font-medium">{o.createdAt}</td>
                                <td className="px-5 py-3.5 font-semibold text-zinc-900" title={itemsText}>
                                  {itemsText}
                                </td>
                                <td className="px-5 py-3.5 text-center font-bold text-zinc-950">
                                  {(o.total || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                                </td>
                                <td className="px-5 py-3.5 text-right">
                                  <span
                                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                                      o.status === 'Completed' || o.status === 'Delivered' || o.status === 'Teslim Edildi'
                                        ? 'border-green-200 bg-green-50 text-green-700'
                                        : o.status === 'Cancelled' || o.status === 'İptal Edildi'
                                        ? 'border-rose-200 bg-rose-50 text-rose-700'
                                        : 'border-amber-200 bg-amber-50 text-amber-700'
                                    }`}
                                  >
                                    {o.status}
                                  </span>
                                </td>
                              </tr>
                            )
                          })}

                          {orders.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-5 py-10 text-center text-zinc-400 italic">
                                Kayıtlı sipariş bulunamadı.
                              </td>
                            </tr>
                          ) : null}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Addresses Tab */}
                {activeTab === 'addresses' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {addresses.map((addr) => (
                      <div key={addr.id} className="border border-zinc-200 rounded-2xl p-4.5 bg-zinc-50/30 space-y-2 relative">
                        <div className="flex items-center justify-between">
                          <span className="block text-[11px] font-extrabold text-[#df0000] uppercase tracking-wider">
                            {addr.title || 'Adres'}
                          </span>
                        </div>
                        <div className="text-xs font-bold text-zinc-800">{addr.fullName}</div>
                        <div className="text-[11px] font-medium text-zinc-500">{addr.phone}</div>
                        <p className="text-xs font-semibold text-zinc-700 leading-relaxed pt-1.5 border-t border-zinc-200/50">
                          {addr.details} {addr.mahalle && `${addr.mahalle} Mh.`} {addr.binaNo && `No: ${addr.binaNo}`}{' '}
                          {addr.daireNo && `D: ${addr.daireNo}`} {addr.katNo && `K: ${addr.katNo}`}
                        </p>
                        <div className="text-[10px] font-extrabold text-zinc-450 uppercase tracking-wide">
                          {addr.district} / {addr.city} {addr.region && `(${addr.region})`}
                        </div>
                      </div>
                    ))}

                    {addresses.length === 0 ? (
                      <div className="col-span-2 py-12 text-center text-zinc-400 italic">Kayıtlı adres bulunamadı.</div>
                    ) : null}
                  </div>
                )}

                {/* Reviews Tab */}
                {activeTab === 'reviews' && (
                  <div className="space-y-3">
                    {reviews.map((rev) => (
                      <div key={rev.id} className="border border-zinc-150 rounded-2xl p-4 bg-zinc-50/20 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-zinc-900">{rev.productName}</span>
                          <span className="text-[10px] text-zinc-400 font-medium">{rev.createdAt}</span>
                        </div>
                        <div className="flex items-center gap-0.5 text-amber-500">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <span key={i} className={`material-symbols-outlined text-[16px] ${i < rev.rating ? 'fill-current' : 'text-zinc-250'}`}>
                              star
                            </span>
                          ))}
                        </div>
                        <p className="text-xs font-medium text-zinc-700">{rev.comment}</p>
                        {rev.adminReply && (
                          <div className="mt-2 bg-zinc-100/80 border border-zinc-200/50 rounded-xl p-3 text-[11px] font-medium text-zinc-600">
                            <div className="font-bold text-zinc-800 mb-0.5">Mağaza Yanıtı:</div>
                            {rev.adminReply}
                          </div>
                        )}
                      </div>
                    ))}

                    {reviews.length === 0 ? (
                      <div className="py-12 text-center text-zinc-400 italic">Yazılmış yorum bulunamadı.</div>
                    ) : null}
                  </div>
                )}

                {/* Service Requests Tab */}
                {activeTab === 'services' && (
                  <div className="overflow-hidden border border-zinc-150 rounded-2xl">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-zinc-50 border-b border-zinc-150 text-[10px] font-extrabold tracking-wider text-zinc-400 uppercase">
                          <th className="px-5 py-3">Ürün Grubu</th>
                          <th className="px-5 py-3">Model No</th>
                          <th className="px-5 py-3">Açıklama</th>
                          <th className="px-5 py-3">Tarih</th>
                          <th className="px-5 py-3 text-right">Durum</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-150/60 text-xs text-zinc-750">
                        {serviceRequests.map((req) => (
                          <tr key={req.id} className="hover:bg-zinc-50/30">
                            <td className="px-5 py-3.5 font-bold text-zinc-800">{req.productGroup}</td>
                            <td className="px-5 py-3.5 font-mono text-zinc-600 font-bold">{req.modelNo || '-'}</td>
                            <td className="px-5 py-3.5 font-medium text-zinc-700 max-w-[200px] truncate" title={req.description}>
                              {req.description}
                            </td>
                            <td className="px-5 py-3.5 text-zinc-500 font-medium">{req.createdAt}</td>
                            <td className="px-5 py-3.5 text-right">
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold border uppercase tracking-wider ${
                                  req.status === 'Tamamlandı' || req.status === 'Resolved'
                                    ? 'border-green-200 bg-green-50 text-green-700'
                                    : req.status === 'İptal Edildi' || req.status === 'Cancelled'
                                    ? 'border-rose-200 bg-rose-50 text-rose-700'
                                    : 'border-amber-200 bg-amber-50 text-amber-700'
                                }`}
                              >
                                {req.status}
                              </span>
                            </td>
                          </tr>
                        ))}

                        {serviceRequests.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-5 py-10 text-center text-zinc-400 italic">
                              Teknik servis talebi bulunamadı.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
