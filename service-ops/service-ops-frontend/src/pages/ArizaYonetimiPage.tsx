import { useEffect, useMemo, useState } from 'react'
import {
  Download,
  Filter,
  MoreHorizontal,
  X,
  AlertTriangle,
  Clock,
  CheckCircle,
  Wrench,
  TrendingUp,
  TrendingDown
} from 'lucide-react'

import { useServiceRecordsPaged } from '../hooks/useServiceRecords'
import { useTechnicians } from '../hooks/useTechnicians'
import { apiJson } from '../api/client'
import { API_BASE_URL } from '../config'
import { getAccessToken } from '../auth/storage'

const statusConfig: Record<string, { label: string; color: string }> = {
  New: { label: 'Yeni Kayıt', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  Workshop: { label: 'Atölyede', color: 'bg-orange-100 text-orange-700 border-orange-200' },
  InRepair: { label: 'Tamirde', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  Ready: { label: 'Hazır', color: 'bg-green-100 text-green-700 border-green-200' },
  Delivered: { label: 'Teslim Edildi', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  Cancelled: { label: 'İptal', color: 'bg-red-100 text-red-700 border-red-200' },
  Delayed: { label: 'Gecikti', color: 'bg-red-100 text-red-700 border-red-200' },
  WaitingForParts: { label: 'Parça Bekliyor', color: 'bg-amber-100 text-amber-700 border-amber-200' },
}

const priorityConfig: Record<string, { label: string; color: string }> = {
  Low: { label: 'Düşük', color: 'bg-gray-100 text-gray-700' },
  Normal: { label: 'Normal', color: 'bg-gray-100 text-gray-700' },
  High: { label: 'Acil', color: 'bg-orange-100 text-orange-700' },
  Critical: { label: 'Kritik', color: 'bg-red-100 text-red-700' },
}

export default function ArizaYonetimiPage() {
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage] = useState(1)
  const pageSize = 20

  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [filtersOpen, setFiltersOpen] = useState(false)

  const { result, isLoading, error, updateStatus, assignTechnician, refetch } = useServiceRecordsPaged({
    q: q || undefined,
    status: statusFilter || undefined,
    type: 'Repair',
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    pageSize,
  })

  const records = result.items
  const { technicians: availableTechnicians, isLoading: techLoading } = useTechnicians({ availableOnly: true })

  const exportCsv = () => {
    const headers = ['arizaNo','kayitTarihi','musteri','telefon','urun','seriNo','bayi','bolge','teknisyen','oncelik','durum','aciklama']
    const escape = (v: any) => {
      const s = String(v ?? '')
      return /[\n\r",;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [headers.join(';')]
    for (const r of records) {
      lines.push([
        r.serviceNumber,
        r.createdAt,
        r.customerName ?? '',
        r.customerPhone ?? '',
        r.productName,
        r.serialNumber ?? '',
        r.dealerName ?? '',
        r.regionName ?? '',
        r.assignedTechnicianName ?? '',
        r.priority,
        r.status,
        r.problemDescription ?? '',
      ].map(escape).join(';'))
    }
    const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ariza-listesi-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const repairRecords = useMemo(() => {
    return records
  }, [records])

  const [selectedId, setSelectedId] = useState<string>('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])

  /*
    ONIZLEME ADRESLERI.

    `URL.createObjectURL` render icinde cagrilirsa her cizimde yeni bir nesne uretiliyor ve
    hicbiri serbest birakilmiyor. Adresler burada dosya listesiyle birlikte uretilip liste
    degistiginde serbest birakiliyor.
  */
  const selectedFilePreviews = useMemo(
    () => selectedFiles.map((f) => URL.createObjectURL(f)),
    [selectedFiles]
  )

  useEffect(() => {
    return () => {
      selectedFilePreviews.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [selectedFilePreviews])
  const [timeline, setTimeline] = useState<any[]>([])

  const selectedRecord = useMemo(() => {
    return repairRecords.find(r => r.id === selectedId) ?? null
  }, [repairRecords, selectedId])

  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  const [statusValue, setStatusValue] = useState<string>('New')
  const [technicianId, setTechnicianId] = useState<string>('')

  const countsByStatus = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of repairRecords) {
      map.set(r.status, (map.get(r.status) ?? 0) + 1)
    }
    return map
  }, [repairRecords])

  const stats = useMemo(() => {
    return [
      { label: 'Yeni Arıza', value: countsByStatus.get('New') ?? 0, trend: 'Güncel', up: true, icon: AlertTriangle, color: 'bg-blue-50 text-blue-600' },
      { label: 'Atölyede', value: countsByStatus.get('Workshop') ?? 0, trend: 'Devam', up: true, icon: Wrench, color: 'bg-orange-50 text-orange-600' },
      { label: 'Tamirde', value: countsByStatus.get('InRepair') ?? 0, trend: 'Güncel', up: true, icon: Clock, color: 'bg-purple-50 text-purple-600' },
      { label: 'Hazır', value: countsByStatus.get('Ready') ?? 0, trend: 'Güncel', up: true, icon: CheckCircle, color: 'bg-green-50 text-green-600' },
      { label: 'Teslim Edildi', value: countsByStatus.get('Delivered') ?? 0, trend: 'Toplam', up: true, icon: TrendingUp, color: 'bg-emerald-50 text-emerald-600' },
      { label: 'Gecikenler', value: countsByStatus.get('Delayed') ?? 0, trend: 'Acil', up: false, icon: TrendingDown, color: 'bg-red-50 text-red-600' },
    ]
  }, [countsByStatus])

  const openDetail = async (id: string) => {
    setSelectedId(id)
    const found = repairRecords.find(r => r.id === id)
    setStatusValue(found?.status ?? 'New')
    setTechnicianId('')
    setActionError(null)
    setActionSuccess(null)
    setSelectedFiles([])
    setTimeline([])
    setDrawerOpen(true)
    try {
      const data = await apiJson<any[]>(`/api/servicerecords/${id}/timeline`)
      setTimeline(data || [])
    } catch (err) {
      console.error('Error fetching timeline:', err)
    }
  }

  return (
    <div className="p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Arıza Yönetimi</h1>
          <p className="text-sm text-gray-500 mt-1">KKTC genelindeki tüm servis taleplerini ve onarım süreçlerini buradan yönetin.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1) }}
            placeholder="Ara: müşteri, telefon, ürün, seri no..."
            className="hidden md:block px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-80"
          />
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            className="hidden md:block px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
          >
            <option value="">Tüm Durumlar</option>
            <option value="New">Yeni Kayıt</option>
            <option value="Workshop">Atölyede</option>
            <option value="InRepair">Tamirde</option>
            <option value="WaitingForParts">Parça Bekliyor</option>
            <option value="Ready">Hazır</option>
            <option value="Delivered">Teslim Edildi</option>
            <option value="Delayed">Gecikti</option>
            <option value="Cancelled">İptal</option>
          </select>
          {statusFilter && (
            <button
              type="button"
              onClick={() => { setStatusFilter(''); setPage(1) }}
              className="hidden md:block px-3 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 rounded-lg text-sm font-semibold transition active:scale-95 cursor-pointer"
            >
              Temizle
            </button>
          )}
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className={'flex flex-1 items-center justify-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium sm:flex-none ' + (filtersOpen ? 'bg-[#B91C1C] text-white border-[#B91C1C]' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50')}
            title="Filtreleri aç/kapat"
          >
            <Filter className="w-4 h-4" />
            Filtrele
          </button>
          <button
            onClick={exportCsv}
            disabled={records.length === 0}
            className="flex flex-1 items-center justify-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:flex-none"
            title="Dışa aktar (CSV)"
          >
            <Download className="w-4 h-4" />
            Dışa Aktar
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Başlangıç</label>
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Bitiş</label>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Arama (mobil)</label>
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="müşteri, telefon, ürün, SN" className="md:hidden px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="müşteri, telefon, ürün, SN" className="hidden md:block px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full" />
          </div>
          <div className="flex items-end">
            <button onClick={() => { setDateFrom(''); setDateTo(''); setQ(''); setStatusFilter(''); setPage(1) }} className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Temizle</button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <div key={stat.label} className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div className={`p-2 rounded-lg ${stat.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <span className={`text-xs font-medium ${stat.up ? 'text-green-600' : 'text-red-600'}`}>
                  {stat.trend}
                </span>
              </div>
              <div className="text-2xl font-bold text-gray-900">{stat.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
            </div>
          )
        })}
      </div>

      {/* Active Records */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Aktif Arıza Kayıtları</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Arıza ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Kayıt Tarihi</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Bayi</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Müşteri</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Ürün</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Öncelik</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Durum</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Teknisyen</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Aksiyon</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {error ? (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-red-600" colSpan={9}>{error}</td>
                </tr>
              ) : isLoading ? (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-gray-500" colSpan={9}>Yükleniyor...</td>
                </tr>
              ) : repairRecords.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-gray-500" colSpan={9}>Kayıt bulunamadı.</td>
                </tr>
              ) : repairRecords.map((record) => (
                <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-4">
                    <span className="font-mono text-sm font-medium text-[#B91C1C]">{record.serviceNumber}</span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm text-gray-900">{new Date(record.createdAt).toLocaleDateString('tr-TR')}</div>
                    <div className="text-xs text-gray-500">{new Date(record.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm font-medium text-gray-900">{record.dealerName || '-'}</div>
                    <div className="text-xs text-gray-500">{record.regionName || '-'}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm font-medium text-gray-900">{record.customerName || '-'}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="text-sm text-gray-700">{record.productName}</div>
                    <div className="text-xs text-gray-500">{record.serialNumber ? `SN: ${record.serialNumber}` : '-'}</div>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${priorityConfig[record.priority]?.color ?? 'bg-gray-100 text-gray-700'}`}>
                      {priorityConfig[record.priority]?.label ?? record.priorityLabel}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${statusConfig[record.status]?.color ?? 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                      {statusConfig[record.status]?.label ?? record.statusLabel}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium">
                        {record.assignedTechnicianName ? record.assignedTechnicianName.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('') : '--'}
                      </div>
                      <span className="text-sm text-gray-700">{record.assignedTechnicianName || 'Atanmadı'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <button
                      onClick={() => openDetail(record.id)}
                      className="p-2 text-gray-400 hover:text-[#B91C1C] hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-gray-500">
            Toplam {result.totalCount} kayıttan {(result.totalCount === 0 ? 0 : (result.page - 1) * result.pageSize + 1)}-{Math.min(result.page * result.pageSize, result.totalCount)} arası gösteriliyor
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={'px-3 py-1.5 text-sm rounded ' + (page <= 1 ? 'text-gray-300' : 'text-gray-600 hover:bg-gray-100')}
            >
              &lt;
            </button>
            <span className="px-3 py-1.5 text-sm bg-[#B91C1C] text-white rounded">{page}</span>
            <button
              disabled={result.totalPages > 0 ? page >= result.totalPages : repairRecords.length < pageSize}
              onClick={() => setPage((p) => p + 1)}
              className={'px-3 py-1.5 text-sm rounded ' + ((result.totalPages > 0 ? page >= result.totalPages : repairRecords.length < pageSize) ? 'text-gray-300' : 'text-gray-600 hover:bg-gray-100')}
            >
              &gt;
            </button>
          </div>
        </div>
      </div>

      {/* Detail Drawer */}
      {drawerOpen && selectedRecord && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDrawerOpen(false)} />
          <div className="fixed right-0 top-0 bottom-0 pt-safe pb-safe w-full max-w-lg bg-white z-50 shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300">
            <div className="p-4 sm:p-6 border-b border-gray-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-gray-900">Arıza Detayı</h2>
                <span className={`px-2 py-1 rounded text-xs font-medium ${priorityConfig[selectedRecord.priority]?.color ?? 'bg-gray-100 text-gray-700'}`}>
                  {priorityConfig[selectedRecord.priority]?.label ?? selectedRecord.priorityLabel}
                </span>
              </div>
              <button onClick={() => setDrawerOpen(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-6">
              {/* Customer Info */}
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-600 to-gray-700 flex items-center justify-center text-white font-semibold">
                    {(selectedRecord.customerName || '-').split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('') || '--'}
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">{selectedRecord.customerName || '-'}</div>
                    <div className="text-xs text-gray-500">{selectedRecord.regionName || '-'}</div>
                  </div>
                </div>
                <div className="text-sm text-gray-700">{selectedRecord.problemDescription || '-'}</div>
              </div>

              {/* Görseller */}
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Görseller</h3>
                {(() => {
                  const photos = timeline
                    .filter((item) => item.type === 'PhotoUploaded')
                    .map((item) => {
                      try {
                        const pl = JSON.parse(item.payload)
                        return {
                          url: pl.newValue,
                          actor: item.actor,
                          date: new Date(item.timestamp).toLocaleString('tr-TR')
                        }
                      } catch {
                        return null
                      }
                    })
                    .filter(Boolean)

                  if (photos.length === 0) {
                    return (
                      <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-500 text-center border border-dashed border-gray-200">
                        Bu kayıt için henüz görsel yüklenmemiş.
                      </div>
                    )
                  }

                  return (
                    <div className="grid grid-cols-2 gap-3">
                      {photos.map((photo: any, index: number) => (
                        <div key={index} className="group relative bg-gray-50 rounded-xl border border-gray-100 p-2 overflow-hidden shadow-sm hover:shadow transition-all">
                          <img
                            src={photo.url.startsWith('http') ? photo.url : `${API_BASE_URL}${photo.url}`}
                            alt="Servis Görseli"
                            className="w-full h-32 object-cover rounded-lg"
                          />
                          <div className="mt-2 text-[10px] text-gray-500 space-y-0.5">
                            <div className="font-semibold text-gray-700 truncate">{photo.actor}</div>
                            <div>{photo.date}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>

              {actionSuccess ? (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl px-4 py-3 text-xs font-semibold text-green-700">{actionSuccess}</div>
              ) : null}
              {actionError ? (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs font-semibold text-red-600">{actionError}</div>
              ) : null}

              <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
                <div className="text-xs font-semibold text-gray-500">Durum</div>
                <select value={statusValue} onChange={(e) => setStatusValue(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full">
                  <option value="New">Yeni Kayıt</option>
                  <option value="Workshop">Atölyede</option>
                  <option value="InRepair">Tamirde</option>
                  <option value="WaitingForParts">Parça Bekliyor</option>
                  <option value="Ready">Hazır</option>
                  <option value="Delivered">Teslim Edildi</option>
                  <option value="Delayed">Gecikti</option>
                  <option value="Cancelled">İptal</option>
                </select>

                <div className="space-y-1">
                  <div className="text-xs font-semibold text-gray-500">Durum Görseli Ekle (Opsiyonel)</div>

                  {/*
                    SEÇİLEN GÖRSEL KALDIRILABİLİR (2026-08-24, kullanıcı isteği).
                    Önceden yalnızca dosya adları düz metin olarak yazılıyordu; yanlış dosya
                    seçildiğinde geri alma yolu yoktu, çekmeceyi kapatıp baştan açmak
                    gerekiyordu. Saha Arıza ve Atölye ekranlarında bu zaten vardı, burada
                    eksikti — aynı desen kullanıldı.
                  */}
                  {selectedFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2 py-1">
                      {selectedFiles.map((file, idx) => (
                        <div
                          key={`${file.name}-${file.size}-${idx}`}
                          className="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200 bg-gray-100 group"
                        >
                          <img src={selectedFilePreviews[idx]} alt={file.name} className="w-full h-full object-cover" />
                          <button
                            type="button"
                            title="Görseli kaldır"
                            onClick={() => setSelectedFiles((prev) => prev.filter((_, i) => i !== idx))}
                            className="absolute top-0.5 right-0.5 bg-red-600 text-white rounded-full p-0.5 opacity-90 hover:opacity-100 shadow"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => {
                      const yeniDosyalar = Array.from(e.target.files || [])
                      // Seçim EKLENİR, değiştirilmez: bir görseli silip yenisini eklemek
                      // isteyen kullanıcı kalanları da kaybetmesin. Aynı dosya iki kez
                      // eklenmesin diye ad+boyut+tarih ile eleniyor.
                      setSelectedFiles((prev) => {
                        const anahtar = (f: File) => `${f.name}|${f.size}|${f.lastModified}`
                        const mevcut = new Set(prev.map(anahtar))
                        return [...prev, ...yeniDosyalar.filter((f) => !mevcut.has(anahtar(f)))]
                      })
                      // Kaldırılan bir dosya tekrar seçilebilsin diye alan sıfırlanır:
                      // aynı değer yeniden seçildiğinde `change` olayı tetiklenmiyor.
                      e.target.value = ''
                    }}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs w-full"
                  />

                  {selectedFiles.length > 0 && (
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <span className="text-xs text-green-600">{selectedFiles.length} görsel seçildi</span>
                      <button
                        type="button"
                        onClick={() => setSelectedFiles([])}
                        className="text-xs font-semibold text-red-600 hover:underline"
                      >
                        Tümünü kaldır
                      </button>
                    </div>
                  )}
                </div>

                <button
                  disabled={actionLoading}
                  onClick={async () => {
                    setActionLoading(true)
                    setActionError(null)
                    setActionSuccess(null)
                    try {
                      await updateStatus(selectedRecord.id, statusValue)
                      
                      if (selectedFiles.length > 0) {
                        const token = getAccessToken()
                        for (const file of selectedFiles) {
                          const formData = new FormData()
                          formData.append('file', file)
                          await fetch(`${API_BASE_URL}/api/servicerecords/${selectedRecord.id}/photo`, {
                            method: 'POST',
                            headers: token ? { Authorization: `Bearer ${token}` } : {},
                            body: formData
                          })
                        }
                        setSelectedFiles([])
                      }

                      setActionSuccess('Durum güncellendi.')
                      
                      // Refresh timeline to show new photo
                      try {
                        const data = await apiJson<any[]>(`/api/servicerecords/${selectedRecord.id}/timeline`)
                        setTimeline(data || [])
                      } catch {
                        // ignore
                      }

                      await refetch()
                    } catch (e: any) {
                      setActionError(String(e?.message ?? 'Durum güncellenemedi'))
                    } finally {
                      setActionLoading(false)
                    }
                  }}
                  className={
                    'w-full py-2 rounded-xl font-medium transition-colors ' +
                    (actionLoading ? 'bg-gray-300 text-gray-600' : 'bg-gray-900 text-white hover:bg-gray-800')
                  }
                >
                  {actionLoading ? 'İşleniyor...' : 'Durumu Kaydet'}
                </button>
              </div>

              <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
                <div className="text-xs font-semibold text-gray-500">Teknisyen Ata</div>
                <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm w-full">
                  <option value="">Seçiniz</option>
                  {availableTechnicians.map(t => (
                    <option key={t.id} value={t.id}>{t.fullName}</option>
                  ))}
                </select>
                <button
                  disabled={actionLoading || techLoading || !technicianId}
                  onClick={async () => {
                    setActionLoading(true)
                    setActionError(null)
                    setActionSuccess(null)
                    try {
                      await assignTechnician(selectedRecord.id, technicianId)
                      setActionSuccess('Teknisyen atandı.')
                      await refetch()
                    } catch (e: any) {
                      setActionError(String(e?.message ?? 'Teknisyen atanamadı'))
                    } finally {
                      setActionLoading(false)
                    }
                  }}
                  className={
                    'w-full py-2 rounded-xl font-medium transition-colors ' +
                    (actionLoading ? 'bg-gray-300 text-gray-600' : 'bg-[#B91C1C] text-white hover:bg-[#991B1B]')
                  }
                >
                  {actionLoading ? 'İşleniyor...' : 'Teknisyeni Ata'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
