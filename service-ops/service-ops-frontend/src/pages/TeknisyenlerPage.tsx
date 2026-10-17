import { Plus, Search, Star, X, Warehouse, Coins, Building2, CreditCard } from 'lucide-react'
import { useState, useMemo, useEffect } from 'react'
import { useTechnicians } from '../hooks/useTechnicians'
import { apiJson } from '../api/client'
import { sanitizeEmail, sanitizeName, sanitizePhone } from '../utils/formInput'
import TechnicianTable, { withWorkStats, type TechnicianWorkStat } from '../components/TechnicianTable'
import TechnicianWorkCalendarModal from '../components/TechnicianWorkCalendarModal'

type ServiceRecordLite = {
  id: string
  serviceNumber: string
  status: string
  type: string
  productName: string
  customerName?: string
  regionName?: string
  plannedAt?: string
}

type InstallationTaskLite = {
  id: string
  statusLabel: string
  quantity: number
  productName?: string
  serviceNumber?: string
  plannedAt?: string
  notes?: string
}

type RouteLite = {
  id: string
  routeNumber: string
  name: string
  status: string
  statusLabel: string
  totalStops: number
  completedStops: number
  plannedDate: string
}

export default function TeknisyenlerPage() {
  const { technicians, isLoading, createTechnician, updatePassword, refetch } = useTechnicians()

  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string>('')

  // İŞ SAYAÇLARI. Tek çağrı, tüm teknisyenler — satır başına istek atmak 12 kişide 12 istek
  // demekti ve tablo her tazelemede ağı kilitlerdi.
  const [workStats, setWorkStats] = useState<Record<string, TechnicianWorkStat>>({})
  const [statsLoading, setStatsLoading] = useState(true)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calendarId, setCalendarId] = useState<string>('')

  useEffect(() => {
    let active = true
    setStatsLoading(true)
    apiJson<TechnicianWorkStat[]>('/api/technicians/work-stats')
      .then((rows) => {
        if (!active) return
        const map: Record<string, TechnicianWorkStat> = {}
        for (const r of rows ?? []) map[r.technicianId] = r
        setWorkStats(map)
      })
      // Sayaçlar gelmezse sayfa yine açılır; kolonlar "-" gösterir. Teknisyen listesini
      // tamamen düşürmek, sayaç gibi ikincil bir veri için fazla ağır bir ceza olurdu.
      .catch(() => { if (active) setWorkStats({}) })
      .finally(() => { if (active) setStatsLoading(false) })
    return () => { active = false }
  }, [])

  const rowsWithStats = useMemo(() => withWorkStats(technicians as any, workStats), [technicians, workStats])

  const ekipToplami = useMemo(() => {
    const all = Object.values(workStats)
    return {
      today: all.reduce((s, x) => s + x.today.quantity, 0),
      month: all.reduce((s, x) => s + x.month.quantity, 0),
      total: all.reduce((s, x) => s + x.total.quantity, 0),
    }
  }, [workStats])
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  const selected = technicians.find(t => t.id === selectedId) ?? null

  // Warehouse & Accounts Assignment State
  const [warehouses, setWarehouses] = useState<any[]>([])
  const [cashAccounts, setCashAccounts] = useState<any[]>([])
  const [bankAccounts, setBankAccounts] = useState<any[]>([])

  const [assignedWhCode, setAssignedWhCode] = useState<number | ''>('')
  const [assignedCashId, setAssignedCashId] = useState<number | ''>('')
  const [assignedBankId, setAssignedBankId] = useState<number | ''>('')
  const [assignedPosId, setAssignedPosId] = useState<number | ''>('')

  // Load B2B items when tenantCode changes (supporting multi-tenant selection)
  useEffect(() => {
    let mounted = true
    const tenantParam = selected?.tenantCode ? `?tenantCode=${encodeURIComponent(selected.tenantCode)}` : ''
    Promise.all([
      apiJson<{ success: boolean; data: any[] }>(`/api/erp/warehouses${tenantParam}`).catch(() => ({ success: false, data: [] })),
      apiJson<{ success: boolean; data: any[] }>(`/api/erp/cash-accounts${tenantParam}`).catch(() => ({ success: false, data: [] })),
      apiJson<{ success: boolean; data: any[] }>(`/api/erp/bank-accounts${tenantParam}`).catch(() => ({ success: false, data: [] })),
    ]).then(([whRes, cashRes, bankRes]) => {
      if (!mounted) return
      setWarehouses(whRes?.data?.filter((w: any) => w.isVehicle) ?? whRes?.data ?? [])
      setCashAccounts(cashRes?.data ?? [])
      setBankAccounts(bankRes?.data ?? [])
    })
    return () => { mounted = false }
  }, [selected?.tenantCode])

  // Update selected values when technician changes
  useEffect(() => {
    if (selected) {
      setAssignedWhCode(selected.warehouseCode ?? '')
      setAssignedCashId(selected.cashAccountId ?? '')
      setAssignedBankId(selected.bankAccountId ?? '')
      setAssignedPosId(selected.posAccountId ?? '')
    }
  }, [selectedId, technicians])

  // ─── Lazy Name Sync (Web) ───────────────────────────────────────────────────
  // When ERP dropdowns load but DB still has null names for this technician,
  // silently patch the names in the background.
  useEffect(() => {
    if (!selected || !warehouses.length) return
    const needsSync = (
      (selected.warehouseCode && !selected.warehouseName) ||
      (selected.cashAccountId && !selected.cashAccountName) ||
      (selected.bankAccountId && !selected.bankAccountName) ||
      (selected.posAccountId && !selected.posAccountName)
    )
    if (!needsSync) return

    const whEntry = warehouses.find((w: any) => w.warehouseCode === selected.warehouseCode)
    const cashEntry = cashAccounts.find((c: any) => c.id === selected.cashAccountId)
    const bankEntry = bankAccounts.find((b: any) => b.id === selected.bankAccountId)
    const posEntry = bankAccounts.find((b: any) => b.id === selected.posAccountId)

    apiJson(`/api/technicians/${selected.id}/warehouse`, {
      method: 'PUT',
      body: JSON.stringify({
        warehouseCode: selected.warehouseCode ?? null,
        warehouseName: whEntry?.name || selected.warehouseName || null,
        cashAccountId: selected.cashAccountId ?? null,
        cashAccountName: cashEntry?.name || selected.cashAccountName || null,
        bankAccountId: selected.bankAccountId ?? null,
        bankAccountName: bankEntry?.accountName || selected.bankAccountName || null,
        posAccountId: selected.posAccountId ?? null,
        posAccountName: posEntry?.accountName || selected.posAccountName || null,
      })
    }).then(() => refetch()).catch(() => { /* silent */ })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses, cashAccounts, bankAccounts, selected?.id])

  const availableWarehouses = useMemo(() => {
    return warehouses.filter(w => {
      const assignedToOther = technicians.some(t => t.id !== selected?.id && t.warehouseCode === w.warehouseCode)
      return !assignedToOther
    })
  }, [warehouses, technicians, selected])



  const [techServices, setTechServices] = useState<ServiceRecordLite[]>([])
  const [servicesLoading, setServicesLoading] = useState(false)
  const [servicesError, setServicesError] = useState<string | null>(null)

  const [techInstallations, setTechInstallations] = useState<InstallationTaskLite[]>([])
  const [installationsLoading, setInstallationsLoading] = useState(false)
  const [installationsError, setInstallationsError] = useState<string | null>(null)

  const [techRoutes, setTechRoutes] = useState<RouteLite[]>([])
  const [routesLoading, setRoutesLoading] = useState(false)
  const [routesError, setRoutesError] = useState<string | null>(null)

  const updateRouteStatus = async (routeId: string, newStatus: string) => {
    try {
      await apiJson(`/api/routes/${routeId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      })
      setTechRoutes(prev => prev.map(r => r.id === routeId ? { ...r, status: newStatus, statusLabel: newStatus } : r))
      setActionSuccess('Rota durumu güncellendi.')
    } catch (e: any) {
      setActionError(String(e?.message ?? 'Rota durumu güncellenemedi'))
    }
  }

  const updateCompletedStops = async (routeId: string, delta: number) => {
    const route = techRoutes.find(r => r.id === routeId)
    if (!route) return
    const newCount = Math.max(0, Math.min(route.totalStops, route.completedStops + delta))
    try {
      await apiJson(`/api/routes/${routeId}/completed-stops`, {
        method: 'PATCH',
        body: JSON.stringify(newCount)
      })
      setTechRoutes(prev => prev.map(r => r.id === routeId ? { ...r, completedStops: newCount } : r))
      if (newCount === route.totalStops && route.status !== 'Completed') {
        await updateRouteStatus(routeId, 'Completed')
      }
    } catch (e: any) {
      setActionError(String(e?.message ?? 'Tamamlanan stop sayısı güncellenemedi'))
    }
  }

  useEffect(() => {
    if (!detailOpen || !selected) return
    let mounted = true
    setServicesLoading(true)
    setServicesError(null)
    setRoutesLoading(true)
    setRoutesError(null)
    setInstallationsLoading(true)
    setInstallationsError(null)
    Promise.all([
      apiJson<ServiceRecordLite[]>(`/api/servicerecords?technicianId=${selected.id}`),
      apiJson<RouteLite[]>(`/api/routes?technicianId=${selected.id}`),
      apiJson<InstallationTaskLite[]>(`/api/installations/tasks?technicianId=${selected.id}`)
    ])
      .then(([servicesData, routesData, installationsData]) => {
        if (!mounted) return
        setTechServices(servicesData ?? [])
        setTechRoutes(routesData ?? [])
        setTechInstallations(Array.isArray(installationsData) ? installationsData : [])
      })
      .catch((e) => {
        if (!mounted) return
        setServicesError(String(e?.message ?? 'Teknisyen işleri yüklenemedi'))
        setRoutesError(String(e?.message ?? 'Rotalar yüklenemedi'))
        setInstallationsError(String(e?.message ?? 'Montaj görevleri yüklenemedi'))
        setTechServices([])
        setTechRoutes([])
        setTechInstallations([])
      })
      .finally(() => {
        if (mounted) {
          setServicesLoading(false)
          setRoutesLoading(false)
          setInstallationsLoading(false)
        }
      })
    return () => { mounted = false }
  }, [detailOpen, selected])

  const serviceStats = useMemo(() => {
    if (!selected) return { activeCount: 0, todayPlanned: 0, cap: 8, topActive: [] as ServiceRecordLite[] }
    const cap = selected.maxDailyTasks || 8
    const activeStatuses = new Set(['New', 'Planned', 'Workshop', 'InRepair', 'WaitingForParts', 'Ready', 'Delayed'])
    const active = techServices.filter(s => activeStatuses.has(s.status))
    const today = new Date();
    const todayPlanned = techServices.filter(s => {
      if (!s.plannedAt) return false
      const d = new Date(s.plannedAt)
      return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
    }).length
    return {
      activeCount: active.length,
      todayPlanned,
      cap,
      topActive: active.slice(0, 8),
    }
  }, [techServices, selected])



  const availableRoles = ['Montaj', 'Saha Arıza', 'Atölye Arıza', 'Kargo', 'Stok']

  return (
    <div className="p-4 lg:p-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Teknisyen Yönetimi</h1>
          <p className="text-sm text-gray-500 mt-1">Saha ekiplerinin anlık durum ve performans takibi.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 border border-gray-200/80 shadow-sm border-l-4 border-l-gray-500 hover:scale-[1.02] transition-transform">
          <div className="text-2xl font-black text-gray-900">{isLoading ? '-' : technicians.length}</div>
          <div className="text-xs font-semibold text-gray-500 mt-1">Toplam Ekip</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200/80 shadow-sm border-l-4 border-l-green-500 hover:scale-[1.02] transition-transform">
          <div className="text-2xl font-black text-green-700">
            {isLoading ? '-' : technicians.filter(t => t.isActive).length}
          </div>
          <div className="text-xs font-semibold text-gray-500 mt-1">Aktif Personel</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200/80 shadow-sm border-l-4 border-l-amber-500 hover:scale-[1.02] transition-transform">
          <div className="text-2xl font-black text-amber-700">{statsLoading ? '-' : ekipToplami.today}</div>
          <div className="text-xs font-semibold text-gray-500 mt-1">Bugün (adet)</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200/80 shadow-sm border-l-4 border-l-blue-500 hover:scale-[1.02] transition-transform">
          <div className="text-2xl font-black text-blue-700">{statsLoading ? '-' : ekipToplami.month}</div>
          <div className="text-xs font-semibold text-gray-500 mt-1">Bu Ay (adet)</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200/80 shadow-sm border-l-4 border-l-red-500 hover:scale-[1.02] transition-transform">
          <div className="text-2xl font-black text-red-700">{statsLoading ? '-' : ekipToplami.total}</div>
          <div className="text-xs font-semibold text-gray-500 mt-1">Toplam (adet)</div>
        </div>
      </div>

      <TechnicianTable
        technicians={rowsWithStats}
        isLoading={isLoading}
        onOpenCalendar={(id) => { setCalendarId(id); setCalendarOpen(true) }}
        onRowClick={(id) => {
          setSelectedId(id)
          setActionError(null)
          setActionSuccess(null)
          setDetailOpen(true)
        }}
      />

      <TechnicianWorkCalendarModal
        isOpen={calendarOpen}
        technicianId={calendarId}
        technicianName={technicians.find((t) => t.id === calendarId)?.fullName ?? 'Teknisyen'}
        onClose={() => { setCalendarOpen(false); setCalendarId('') }}
      />

      {detailOpen && selected && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDetailOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <div className="text-lg font-bold text-gray-900">{selected.fullName}</div>
                  <div className="text-xs text-gray-500 mb-1">{selected.id}</div>
                  <div className="flex gap-1 flex-wrap">
                    {selected.roles?.map((r: string) => (
                      <span key={r} className="px-2 py-0.5 bg-[#B91C1C]/10 text-[#B91C1C] rounded text-[10px] font-semibold">{r}</span>
                    ))}
                  </div>
                </div>
                <button onClick={() => setDetailOpen(false)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50">Kapat</button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto">
                {actionSuccess ? (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-xs font-semibold text-green-700">{actionSuccess}</div>
                ) : null}
                {actionError ? (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs font-semibold text-red-600">{actionError}</div>
                ) : null}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-gray-500">Cari Kodu</div>
                    <div className="text-sm font-medium text-gray-900 font-mono font-semibold">{selected.cariKodu || selected.employeeNumber || '-'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-gray-500">Yetki Rolü</div>
                    <div className="text-sm font-medium text-blue-700 font-semibold">{selected.roleName || '-'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-gray-500">Kullanıcı Adı</div>
                    <div className="text-sm font-medium text-gray-900 font-mono">{selected.username || '-'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-gray-500">Telefon</div>
                    <div className="text-sm font-medium text-gray-900">{selected.phone || '-'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-gray-500">Bölge</div>
                    <div className="text-sm font-medium text-gray-900">{selected.regionName || '-'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-gray-500">Email</div>
                    <div className="text-sm font-medium text-gray-900">{selected.email || '-'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-gray-500">Araç Deposu</div>
                    <div className="text-sm font-medium text-gray-950 font-semibold">{selected.warehouseName || 'Atanmamış'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-gray-500">Nakit Kasa Hesabı</div>
                    <div className="text-sm font-medium text-gray-950 font-semibold">{selected.cashAccountName || 'Atanmamış'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-gray-500">Banka Hesabı</div>
                    <div className="text-sm font-medium text-gray-950 font-semibold">{selected.bankAccountName || 'Atanmamış'}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-gray-500">POS Hesabı</div>
                    <div className="text-sm font-medium text-gray-950 font-semibold">{selected.posAccountName || 'Atanmamış'}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="text-xs text-gray-500 font-semibold">Aktif İş</div>
                    <div className="text-2xl font-bold text-gray-900">{servicesLoading ? '-' : serviceStats.activeCount}</div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="text-xs text-gray-500 font-semibold">Bugün Planlı</div>
                    <div className="text-2xl font-bold text-gray-900">{servicesLoading ? '-' : serviceStats.todayPlanned}</div>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <div className="text-xs font-semibold text-gray-500">Performans Metrikleri</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-white rounded-lg p-3">
                      <div className="text-xs text-gray-500">Toplam Görev</div>
                      <div className="text-lg font-bold text-gray-900">{selected.totalTasks}</div>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <div className="text-xs text-gray-500">Tamamlanan</div>
                      <div className="text-lg font-bold text-green-700">{selected.completedTasks}</div>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <div className="text-xs text-gray-500">İptal</div>
                      <div className="text-lg font-bold text-red-700">{selected.cancelledTasks}</div>
                    </div>
                    <div className="bg-white rounded-lg p-3">
                      <div className="text-xs text-gray-500">Başarı Oranı</div>
                      <div className="text-lg font-bold text-gray-900">{selected.successRate.toFixed(1)}%</div>
                    </div>
                  </div>
                  <div className="bg-white rounded-lg p-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs text-gray-500">Toplam Çalışma Süresi</div>
                      <div className="text-sm font-medium text-gray-900">{selected.totalWorkDuration || '0 saat'}</div>
                    </div>
                    <div className="flex items-center gap-1 text-amber-500">
                      <Star className="w-4 h-4 fill-current" />
                      <span className="font-semibold text-gray-900">{selected.rating?.toFixed(1) ?? '-'}</span>
                      <span className="text-xs text-gray-500">/5.0</span>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-gray-500">Aktif Arıza İşleri</div>
                    {servicesError ? <div className="text-xs font-semibold text-red-600">{servicesError}</div> : null}
                  </div>
                  {servicesLoading ? (
                    <div className="text-sm text-gray-500">Yükleniyor...</div>
                  ) : serviceStats.topActive.length === 0 ? (
                    <div className="text-sm text-gray-500">Aktif arıza işi yok.</div>
                  ) : (
                    <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                      {serviceStats.topActive.map((s) => (
                        <div key={s.id} className="bg-white border border-gray-100 rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold text-gray-900">{s.serviceNumber}</div>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Arıza</span>
                          </div>
                          <div className="text-xs text-gray-600 mt-1">{s.productName} • {s.customerName || '-'} • {s.regionName || '-'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-gray-500">Aktif Montaj Görevleri</div>
                    {installationsError ? <div className="text-xs font-semibold text-red-600">{installationsError}</div> : null}
                  </div>
                  {installationsLoading ? (
                    <div className="text-sm text-gray-500">Yükleniyor...</div>
                  ) : techInstallations.length === 0 ? (
                    <div className="text-sm text-gray-500">Aktif montaj görevi yok.</div>
                  ) : (
                    <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                      {techInstallations.map((t) => (
                        <div key={t.id} className="bg-white border border-gray-100 rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold text-gray-900">{t.serviceNumber || t.notes || 'Montaj Görevi'}</div>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Montaj</span>
                          </div>
                          <div className="text-xs text-gray-600 mt-1">Miktar: {t.quantity} • Durum: {t.statusLabel}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-gray-500">Aktif Rotalar</div>
                    {routesError ? <div className="text-xs font-semibold text-red-600">{routesError}</div> : null}
                  </div>
                  {routesLoading ? (
                    <div className="text-sm text-gray-500">Yükleniyor...</div>
                  ) : techRoutes.length === 0 ? (
                    <div className="text-sm text-gray-500">Aktif rota yok.</div>
                  ) : (
                    <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                      {techRoutes.map((r) => (
                        <div key={r.id} className="bg-white border border-gray-100 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-sm font-semibold text-gray-900">{r.name}</div>
                            <div className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{r.statusLabel}</div>
                          </div>
                          <div className="text-xs text-gray-600 mb-2">{r.routeNumber} • {new Date(r.plannedDate).toLocaleDateString('tr-TR')}</div>
                          <div className="flex items-center gap-2 mb-2">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-[#B91C1C] rounded-full" style={{width:`${Math.min(100, (r.completedStops / Math.max(1, r.totalStops)) * 100)}%`}} />
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => updateCompletedStops(r.id, -1)}
                                disabled={r.completedStops <= 0}
                                className="w-6 h-6 flex items-center justify-center rounded bg-gray-200 text-gray-700 text-xs font-bold hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                -
                              </button>
                              <span className="text-xs text-gray-600 font-medium w-8 text-center">{r.completedStops}/{r.totalStops}</span>
                              <button
                                onClick={() => updateCompletedStops(r.id, 1)}
                                disabled={r.completedStops >= r.totalStops}
                                className="w-6 h-6 flex items-center justify-center rounded bg-gray-200 text-gray-700 text-xs font-bold hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {r.status === 'InProgress' && (
                              <button
                                onClick={() => updateRouteStatus(r.id, 'Completed')}
                                className="flex-1 py-1.5 text-xs font-semibold bg-green-100 text-green-700 rounded-lg hover:bg-green-200"
                              >
                                Tamamlandı
                              </button>
                            )}
                            {r.status === 'Planned' && (
                              <button
                                onClick={() => updateRouteStatus(r.id, 'InProgress')}
                                className="flex-1 py-1.5 text-xs font-semibold bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
                              >
                                Başlat
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
