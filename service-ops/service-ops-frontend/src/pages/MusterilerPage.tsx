import { useMemo, useState, useEffect } from 'react'
import { Plus, Search, Download, MapPin, MoreHorizontal, RefreshCw } from 'lucide-react'
import Table, { type TableColumn } from '../components/Table'
import { type Customer, useCustomers } from '../hooks/useCustomers'
import { useCustomerServiceSummary } from '../hooks/useCustomerServiceSummary'
import { sanitizeEmail, sanitizeName, sanitizePhone, isValidEmail, isValidPhone } from '../utils/formInput'
import BayiPerformansPaneli from '../components/BayiPerformansPaneli'
import CustomerActivityDrawer from '../components/CustomerActivityDrawer'

const customerTypes = [
  { value: 'Customer', label: 'Müşteri' },
  { value: 'Dealer', label: 'Bayi' },
  { value: 'Employee', label: 'Çalışan' },
  { value: 'Branch', label: 'Şube' },
  { value: 'Retail', label: 'Parekende' },
  { value: 'Store', label: 'Mağaza' },
]

export default function MusterilerPage() {
  const [activeTab, setActiveTab] = useState<'liste' | 'performans'>('liste')
  
  // Search & Pagination States for Server-Side Summary Table
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  /*
    SAYFA BOYU ARTIK DEĞİŞKEN (2026-08-25).

    Sabit 25'ti ve tabloya `pageSize` olarak geçiliyor ama `onPageSizeChange` GEÇİLMİYORDU.
    Bu sayfa sunucu taraflı: tablonun elinde yalnızca sunucunun döndüğü 25 satır var, sayfa
    sayısını da `toplam / seçilen boyut` diye kendisi hesaplıyor. Kullanıcı alttan 50 (ya da
    yeni eklenen "Sınırsız") seçince sunucuya haber gitmiyor, sunucu yine 25 satır dönüyor,
    ama sayfa sayısı küçülüyor ve ileri/geri okları KİLİTLENİYORDU — cari listesinin geri
    kalanına ulaşmanın yolu sayfayı yenilemekti. Seçim artık sorguya da gidiyor.
  */
  const [pageSize, setPageSize] = useState(25)
  const [sortBy, setSortBy] = useState<string>('FullName')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  // Lazy-loaded drawer state
  const [activeDrawer, setActiveDrawer] = useState<{
    customerId: string
    customerName: string
    category: 'large' | 'small' | 'installation' | 'cargo' | 'all'
  } | null>(null)

  // Debounce logic for server-side search input
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchTerm)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [searchTerm])

  // Server-side summary query hook
  const { data: summaryData, isLoading, error, refetch } = useCustomerServiceSummary({
    search: debouncedSearch.trim() || undefined,
    page,
    pageSize,
    sortBy,
    sortDirection
  })

  // Old Hook for customer CRUD support
  const { createCustomer } = useCustomers()

  const [createOpen, setCreateOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  const [newCustomer, setNewCustomer] = useState({
    fullName: '',
    type: 'Customer',
    phone: '',
    email: '',
    address: '',
    city: '',
    district: '',
  })

  const typeStyle = useMemo(() => {
    return {
      Customer: { label: 'Müşteri', color: 'bg-blue-100/60 text-blue-700 border-blue-200' },
      Dealer: { label: 'Bayi', color: 'bg-purple-100/60 text-purple-700 border-purple-200' },
      Employee: { label: 'Çalışan', color: 'bg-amber-100/60 text-amber-700 border-amber-200' },
      Branch: { label: 'Şube', color: 'bg-sky-100/60 text-sky-700 border-sky-200' },
      Retail: { label: 'Parekende', color: 'bg-emerald-100/60 text-emerald-700 border-emerald-200' },
      Store: { label: 'Mağaza', color: 'bg-rose-100/60 text-rose-700 border-rose-200' },
    } as Record<string, { label: string; color: string }>
  }, [])

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDirection('asc')
    }
    setPage(1)
  }

  // Detail Modal (Cari Detayı)
  const [detailId, setDetailId] = useState<string | null>(null)
  const detailCustomer = useMemo(() => {
    if (!summaryData?.items) return null
    return summaryData.items.find(c => c.id === detailId) ?? null
  }, [summaryData, detailId])

  const renderCountCell = (count: number, customerId: string, customerName: string, category: 'large' | 'small' | 'installation' | 'cargo' | 'all') => {
    if (count === 0) return <span className="text-slate-300">-</span>
    
    let colorClass = 'hover:bg-slate-100 hover:text-slate-900 border-slate-200'
    if (category === 'large') colorClass = 'hover:bg-rose-50 hover:text-rose-700 border-slate-200 hover:border-rose-200'
    else if (category === 'small') colorClass = 'hover:bg-orange-50 hover:text-orange-700 border-slate-200 hover:border-orange-200'
    else if (category === 'installation') colorClass = 'hover:bg-emerald-50 hover:text-emerald-700 border-slate-200 hover:border-emerald-200'
    else if (category === 'cargo') colorClass = 'hover:bg-indigo-50 hover:text-indigo-700 border-slate-200 hover:border-indigo-200'
    else if (category === 'all') colorClass = 'hover:bg-slate-800 hover:text-white bg-slate-900 text-white font-bold border-slate-900'

    return (
      <button
        onClick={(e) => {
          e.stopPropagation()
          setActiveDrawer({ customerId, customerName, category })
        }}
        className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer shadow-sm active:scale-95 ${colorClass}`}
      >
        {count}
      </button>
    )
  }

  const columns = useMemo<TableColumn<any>[]>(
    () => [
      {
        key: 'fullName',
        label: 'Cari Müşteri',
        sortable: true,
        primary: true,
        render: (_, c) => (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-800 text-white font-bold text-[10px] flex items-center justify-center flex-shrink-0">
              {c.fullName.split(' ').filter(Boolean).slice(0, 2).map((n: string) => n[0]).join('')}
            </div>
            <div>
              <div className="font-bold text-slate-900 text-xs">{c.fullName}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{c.email || '-'}</div>
            </div>
          </div>
        )
      },
      {
        key: 'customerNumber',
        label: 'Cari Kodu',
        sortable: true,
        render: (v) => <span className="font-mono text-slate-650 font-semibold">{v}</span>
      },
      {
        key: 'phone',
        label: 'Telefon',
        render: (v) => <span className="text-slate-650 whitespace-nowrap">{v || '-'}</span>
      },
      {
        key: 'regionName',
        label: 'Bölge',
        render: (_, c) => (
          <div className="flex items-center gap-1.5 text-slate-550">
            <MapPin className="w-3.5 h-3.5 text-slate-400" /> {c.regionName || c.city || '-'}
          </div>
        )
      },
      {
        key: 'largeProductRepairCount',
        label: 'Büyük Ürün Arıza',
        sortable: true,
        render: (v, c) => renderCountCell(Number(v), c.id, c.fullName, 'large')
      },
      {
        key: 'smallProductRepairCount',
        label: 'Küçük Ürün Arıza',
        sortable: true,
        render: (v, c) => renderCountCell(Number(v), c.id, c.fullName, 'small')
      },
      {
        key: 'installationCount',
        label: 'Montaj',
        sortable: true,
        render: (v, c) => renderCountCell(Number(v), c.id, c.fullName, 'installation')
      },
      {
        key: 'cargoCount',
        label: 'Kargo',
        sortable: true,
        render: (v, c) => renderCountCell(Number(v), c.id, c.fullName, 'cargo')
      },
      {
        key: 'totalServiceCount',
        label: 'Gelen Servis',
        sortable: true,
        render: (v, c) => renderCountCell(Number(v), c.id, c.fullName, 'all')
      },
      {
        key: 'id',
        label: 'Detay',
        render: (v) => (
          <button 
            onClick={(e) => {
              e.stopPropagation()
              setDetailId(String(v))
            }}
            className="p-1.5 text-slate-400 hover:text-red-650 hover:bg-red-500/5 rounded-lg transition-all cursor-pointer active:scale-95"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        )
      }
    ],
    []
  )

  const exportCsv = () => {
    if (!summaryData?.items || summaryData.items.length === 0) return
    const headers = ['Cari Kodu', 'Ad Soyad', 'Tip', 'Telefon', 'Email', 'Adres', 'Bölge', 'Büyük Ürün Arıza', 'Küçük Ürün Arıza', 'Montaj', 'Kargo', 'Genel Toplam']
    const escape = (v: unknown) => {
      const s = String(v ?? '')
      return /[\n\r",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [headers.join(';')]
    for (const c of summaryData.items) {
      lines.push([
        c.customerNumber,
        c.fullName,
        typeStyle[c.isActive ? 'Customer' : 'Customer']?.label || 'Müşteri',
        c.phone ?? '',
        c.email ?? '',
        c.address ?? '',
        c.regionName ?? '',
        c.largeProductRepairCount,
        c.smallProductRepairCount,
        c.installationCount,
        c.cargoCount,
        c.totalServiceCount
      ].map(escape).join(';'))
    }
    const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `service-ops-cariler-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const totalPages = summaryData?.totalPages ?? 1

  return (
    <div className="p-4 lg:p-6 bg-slate-50/50 min-h-[100dvh]">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-slate-900">Müşteri / Cari Operasyonları</h1>
          <p className="text-sm text-slate-550 mt-1">Müşterilerin servis geçmişi, montaj ve sevkiyat hacimlerini takip edin.</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={exportCsv} 
            disabled={!summaryData?.items || summaryData.items.length === 0} 
            className="flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm"
          >
            <Download className="w-4 h-4 text-slate-500" /> Dışa Aktar
          </button>
          <button
            onClick={() => {
              setActionError(null)
              setActionSuccess(null)
              setNewCustomer({ fullName: '', type: 'Customer', phone: '', email: '', address: '', city: '', district: '' })
              setCreateOpen(true)
            }}
            className="flex items-center gap-2 px-4 py-2 bg-red-650 text-white rounded-xl text-xs font-semibold hover:bg-red-755 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" /> Yeni Müşteri
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 bg-slate-100 p-1 rounded-xl border border-slate-200/60 w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('liste')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'liste' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Servis Performans Listesi
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('performans')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeTab === 'performans' ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Bayi Servis Performansı
        </button>
      </div>

      {activeTab === 'performans' ? <BayiPerformansPaneli /> : (
        <>
          {/* Stats Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5 mb-6">
            {[
              { l: 'Aktif Cariler', v: isLoading ? '-' : (summaryData?.totalCount ?? 0) },
              { l: 'Büyük Ürün Arıza Toplamı', v: isLoading ? '-' : (summaryData?.items?.reduce((a, b) => a + b.largeProductRepairCount, 0) ?? 0) },
              { l: 'Küçük Ürün Arıza Toplamı', v: isLoading ? '-' : (summaryData?.items?.reduce((a, b) => a + b.smallProductRepairCount, 0) ?? 0) },
              { l: 'Montaj Toplamı', v: isLoading ? '-' : (summaryData?.items?.reduce((a, b) => a + b.installationCount, 0) ?? 0) },
            ].map((s, i) => (
              <div key={i} className="bg-white rounded-2xl p-4 border border-slate-150 shadow-sm transition-all hover:shadow-md">
                <div className="text-xl font-extrabold text-slate-900">{s.v}</div>
                <div className="text-xxs uppercase tracking-wider font-semibold text-slate-400 mt-1">{s.l}</div>
              </div>
            ))}
          </div>

          {/* Main Table Card */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 flex gap-3 bg-slate-50">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  type="text"
                  placeholder="Müşteri adı, no veya telefon ara..."
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-red-650/10 focus:border-red-650 transition-all placeholder:text-slate-400"
                />
              </div>
            </div>

            <div className="p-4">
              {isLoading ? (
                <div className="text-center py-20 text-xs text-slate-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-red-650" /> Veriler yükleniyor...
                </div>
              ) : error ? (
                <div className="text-center py-12 text-xs font-semibold text-rose-600">{error}</div>
              ) : !summaryData?.items || summaryData.items.length === 0 ? (
                <div className="text-center py-16 text-slate-400 text-xs bg-white border border-gray-200 rounded-lg">Aramanıza uygun cari bulunamadı.</div>
              ) : (
                <Table
                  columns={columns}
                  data={summaryData.items}
                  showColumnFilters={false}
                  pageSize={pageSize}
                  onPageSizeChange={(yeni) => {
                    setPageSize(yeni)
                    setPage(1)
                  }}
                  serverSide={true}
                  totalCount={summaryData.totalCount}
                  currentPage={page}
                  onPageChange={setPage}
                  onSortChange={(field, direction) => {
                    setSortBy(field)
                    setSortDirection(direction)
                    setPage(1)
                  }}
                  currentSortField={sortBy}
                  currentSortDirection={sortDirection}
                  onRowClick={(row) => setDetailId(row.id)}
                />
              )}
            </div>
          </div>
        </>
      )}

      {/* Lazy Loaded Detail Drawer */}
      {activeDrawer && (
        <CustomerActivityDrawer
          customerId={activeDrawer.customerId}
          customerName={activeDrawer.customerName}
          category={activeDrawer.category}
          onClose={() => setActiveDrawer(null)}
        />
      )}

      {/* New Customer Modal */}
      {createOpen && (
        <>
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[99]" onClick={() => setCreateOpen(false)} />
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-150">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div>
                  <div className="text-base font-bold text-slate-900">Yeni Müşteri</div>
                  <div className="text-xxs text-slate-500 mt-0.5">Müşteri/Cari oluşturulduğunda listede görünecektir.</div>
                </div>
                <button onClick={() => setCreateOpen(false)} className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-50 transition-colors">Kapat</button>
              </div>

              <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1 md:col-span-2">
                  <div className="text-xxs font-bold uppercase text-slate-400">Ad Soyad / Ünvan</div>
                  <input value={newCustomer.fullName} onChange={(e) => setNewCustomer(p => ({ ...p, fullName: sanitizeName(e.target.value) }))} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs w-full focus:outline-none focus:border-red-650" />
                </div>
                <div className="space-y-1">
                  <div className="text-xxs font-bold uppercase text-slate-400">Tip</div>
                  <select value={newCustomer.type} onChange={(e) => setNewCustomer(p => ({ ...p, type: e.target.value }))} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs w-full focus:outline-none">
                    {customerTypes.map(row => <option key={row.value} value={row.value}>{row.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-xxs font-bold uppercase text-slate-400">Telefon</div>
                  <input type="tel" inputMode="tel" pattern="[0-9+]*" value={newCustomer.phone} onChange={(e) => setNewCustomer(p => ({ ...p, phone: sanitizePhone(e.target.value) }))} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs w-full focus:outline-none focus:border-red-650" />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <div className="text-xxs font-bold uppercase text-slate-400">Email</div>
                  <input type="email" inputMode="email" value={newCustomer.email} onChange={(e) => setNewCustomer(p => ({ ...p, email: sanitizeEmail(e.target.value) }))} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs w-full focus:outline-none focus:border-red-650" />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <div className="text-xxs font-bold uppercase text-slate-400">Adres</div>
                  <input value={newCustomer.address} onChange={(e) => setNewCustomer(p => ({ ...p, address: e.target.value }))} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs w-full focus:outline-none focus:border-red-650" />
                </div>
                <div className="space-y-1">
                  <div className="text-xxs font-bold uppercase text-slate-400">Şehir</div>
                  <input value={newCustomer.city} onChange={(e) => setNewCustomer(p => ({ ...p, city: e.target.value }))} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs w-full focus:outline-none focus:border-red-650" />
                </div>
                <div className="space-y-1">
                  <div className="text-xxs font-bold uppercase text-slate-400">İlçe</div>
                  <input value={newCustomer.district} onChange={(e) => setNewCustomer(p => ({ ...p, district: e.target.value }))} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs w-full focus:outline-none focus:border-red-650" />
                </div>

                {actionSuccess ? (
                  <div className="md:col-span-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 text-xs font-semibold text-emerald-700">{actionSuccess}</div>
                ) : null}
                {actionError ? (
                  <div className="md:col-span-2 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 text-xs font-semibold text-rose-600">{actionError}</div>
                ) : null}
              </div>

              <div className="p-5 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50">
                <button onClick={() => setCreateOpen(false)} className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold hover:bg-slate-50 transition-colors">Vazgeç</button>
                <button
                  disabled={actionLoading || !newCustomer.fullName.trim() || !isValidPhone(newCustomer.phone) || !isValidEmail(newCustomer.email)}
                  onClick={async () => {
                    setActionLoading(true)
                    setActionError(null)
                    setActionSuccess(null)
                    try {
                      await createCustomer({
                        fullName: newCustomer.fullName,
                        type: newCustomer.type,
                        phone: newCustomer.phone,
                        email: newCustomer.email || undefined,
                        address: newCustomer.address || undefined,
                        city: newCustomer.city || undefined,
                        district: newCustomer.district || undefined,
                      })
                      setActionSuccess('Müşteri oluşturuldu.')
                      setCreateOpen(false)
                      refetch() // refresh the high-performance summary list
                    } catch (e: any) {
                      setActionError(String(e?.message ?? 'Müşteri oluşturulamadı'))
                    } finally {
                      setActionLoading(false)
                    }
                  }}
                  className={
                    'px-4 py-2 rounded-xl text-xs font-semibold transition-colors ' +
                    (actionLoading ? 'bg-slate-300 text-slate-600' : 'bg-red-650 text-white hover:bg-red-755')
                  }
                >
                  {actionLoading ? 'Kaydediliyor...' : 'Kaydet'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Cari Detay Kartı */}
      {detailId && detailCustomer && (
        <>
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[99]" onClick={() => setDetailId(null)} />
          <div className="fixed right-0 top-0 bottom-0 pt-safe pb-safe w-full max-w-md bg-white z-[100] shadow-2xl flex flex-col border-l border-slate-150 animate-slide-in">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h2 className="text-base font-bold text-slate-900">Cari Detayı</h2>
                <div className="text-xs text-slate-550 mt-0.5">{detailCustomer.fullName}</div>
              </div>
              <button onClick={() => setDetailId(null)} className="p-1.5 hover:bg-slate-200/60 rounded-lg text-slate-400 hover:text-slate-650 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4 space-y-3 shadow-sm">
                <div className="flex justify-between text-xs"><span className="text-slate-400 font-semibold uppercase tracking-wider text-[9px]">Cari Kodu</span><span className="font-bold text-slate-800">{detailCustomer.customerNumber || '-'}</span></div>
                <div className="flex justify-between text-xs"><span className="text-slate-400 font-semibold uppercase tracking-wider text-[9px]">Tip</span><span className={`px-2 py-0.5 rounded-full text-xxs font-bold border ${typeStyle['Customer']?.color}`}>{typeStyle['Customer']?.label}</span></div>
                <div className="flex justify-between text-xs"><span className="text-slate-400 font-semibold uppercase tracking-wider text-[9px]">Telefon</span><span className="font-semibold text-slate-800">{detailCustomer.phone || '-'}</span></div>
                <div className="flex justify-between text-xs"><span className="text-slate-400 font-semibold uppercase tracking-wider text-[9px]">Email</span><span className="font-semibold text-slate-850">{detailCustomer.email || '-'}</span></div>
                <div className="flex justify-between text-xs"><span className="text-slate-400 font-semibold uppercase tracking-wider text-[9px]">Bölge</span><span className="font-semibold text-slate-800">{detailCustomer.regionName || detailCustomer.city || '-'}</span></div>
                <div className="flex justify-between text-xs"><span className="text-slate-400 font-semibold uppercase tracking-wider text-[9px]">Adres</span><span className="font-semibold text-slate-800 text-right max-w-[60%]">{detailCustomer.address || '-'}</span></div>
              </div>
              <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-4 space-y-3 shadow-sm">
                <div className="flex justify-between text-xs"><span className="text-slate-400 font-semibold uppercase tracking-wider text-[9px]">Büyük Ürün Arıza</span><span className="font-extrabold text-slate-800">{detailCustomer.largeProductRepairCount}</span></div>
                <div className="flex justify-between text-xs"><span className="text-slate-400 font-semibold uppercase tracking-wider text-[9px]">Küçük Ürün Arıza</span><span className="font-extrabold text-slate-800">{detailCustomer.smallProductRepairCount}</span></div>
                <div className="flex justify-between text-xs"><span className="text-slate-400 font-semibold uppercase tracking-wider text-[9px]">Montaj Kaydı</span><span className="font-extrabold text-slate-800">{detailCustomer.installationCount}</span></div>
                <div className="flex justify-between text-xs"><span className="text-slate-400 font-semibold uppercase tracking-wider text-[9px]">Kargo Görevi</span><span className="font-extrabold text-slate-800">{detailCustomer.cargoCount}</span></div>
                <div className="flex justify-between text-xs border-t border-slate-200 pt-2"><span className="text-slate-900 font-bold uppercase tracking-wider text-[9px]">Toplam Operasyon</span><span className="font-black text-slate-900">{detailCustomer.totalServiceCount}</span></div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Minimal X close button helper inside modal
function X({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </svg>
  )
}
