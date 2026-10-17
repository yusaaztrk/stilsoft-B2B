import React, { useState, useEffect, useMemo, useCallback } from 'react'
import Table, { type TableColumn } from '../components/Table'
import { API_BASE_URL, buildHeaders } from '../config/api'

export interface SystemErrorLog {
  id: number
  createdAt: string
  localTime: string
  userId?: number
  username: string
  userDisplayName: string
  roleName: string
  cariKodu?: string
  userIp: string
  httpMethod: string
  requestPath: string
  queryString?: string
  requestBodySummary?: string
  exceptionType: string
  errorMessage: string
  innerExceptionMessage?: string
  stackTrace?: string
  statusCode: number
  sourceModule: string
  tenantCode: string
  isResolved: boolean
  resolutionNotes?: string
  resolvedAt?: string
  resolvedBy?: string
}

export function SystemErrorLogsPage() {
  const [logs, setLogs] = useState<SystemErrorLog[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  
  // Filters
  const [search, setSearch] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'unresolved' | 'resolved'>('all')
  const [moduleFilter, setModuleFilter] = useState<string>('all')
  
  // Modal State
  const [selectedLog, setSelectedLog] = useState<SystemErrorLog | null>(null)
  const [resolutionNotes, setResolutionNotes] = useState<string>('')
  const [actionLoading, setActionLoading] = useState<boolean>(false)

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`${API_BASE_URL}/api/system-error-logs?pageSize=200`, {
        headers: buildHeaders()
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        let message = text || `Hata logları alınamadı (${res.status})`
        try {
          const json = JSON.parse(text)
          message = json?.message || json?.error || json?.title || message
        } catch {
          // Response is not JSON.
        }
        throw new Error(message)
      }
      const data = await res.json()
      if (data.success && Array.isArray(data.items)) {
        setLogs(data.items)
      } else {
        setLogs([])
      }
    } catch (err: any) {
      setError(err?.message || 'Bağlantı hatası')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Status Filter
      if (statusFilter === 'unresolved' && log.isResolved) return false
      if (statusFilter === 'resolved' && !log.isResolved) return false

      // Module Filter
      if (moduleFilter !== 'all' && log.sourceModule !== moduleFilter) return false

      // Search Filter
      if (search.trim()) {
        const s = search.toLowerCase().trim()
        const matchUser = (log.username || '').toLowerCase().includes(s) || (log.userDisplayName || '').toLowerCase().includes(s)
        const matchMsg = (log.errorMessage || '').toLowerCase().includes(s) || (log.innerExceptionMessage || '').toLowerCase().includes(s)
        const matchType = (log.exceptionType || '').toLowerCase().includes(s)
        const matchPath = (log.requestPath || '').toLowerCase().includes(s)
        return matchUser || matchMsg || matchType || matchPath
      }

      return true
    })
  }, [logs, statusFilter, moduleFilter, search])

  // Stats
  const totalCount = logs.length
  const unresolvedCount = logs.filter((l) => !l.isResolved).length
  const resolvedCount = logs.filter((l) => l.isResolved).length

  const handleToggleResolve = async (log: SystemErrorLog, newStatus: boolean) => {
    try {
      setActionLoading(true)
      const res = await fetch(`${API_BASE_URL}/api/system-error-logs/${log.id}/resolve`, {
        method: 'PUT',
        headers: buildHeaders(),
        body: JSON.stringify({
          isResolved: newStatus,
          resolutionNotes: resolutionNotes || log.resolutionNotes || 'İncelendi ve çözüldü.'
        })
      })
      if (res.ok) {
        if (selectedLog && selectedLog.id === log.id) {
          setSelectedLog(null)
        }
        await fetchLogs()
      } else {
        alert('Durum güncellenemedi')
      }
    } catch (e: any) {
      alert(e?.message || 'İşlem başarısız')
    } finally {
      setActionLoading(false)
    }
  }

  const handleDeleteLog = async (id: number) => {
    if (!window.confirm('Bu hata kaydını silmek istediğinize emin misiniz?')) return
    try {
      setActionLoading(true)
      const res = await fetch(`${API_BASE_URL}/api/system-error-logs/${id}`, {
        method: 'DELETE',
        headers: buildHeaders()
      })
      if (res.ok) {
        if (selectedLog && selectedLog.id === id) {
          setSelectedLog(null)
        }
        await fetchLogs()
      }
    } catch (e: any) {
      alert(e?.message || 'Silme işlemi başarısız')
    } finally {
      setActionLoading(false)
    }
  }

  const handleClearResolved = async () => {
    if (!window.confirm('Çözülmüş tüm hata kayıtlarını silmek istediğinize emin misiniz?')) return
    try {
      setActionLoading(true)
      const res = await fetch(`${API_BASE_URL}/api/system-error-logs/clear-resolved`, {
        method: 'DELETE',
        headers: buildHeaders()
      })
      if (res.ok) {
        await fetchLogs()
      }
    } catch (e: any) {
      alert(e?.message || 'Temizleme işlemi başarısız')
    } finally {
      setActionLoading(false)
    }
  }

  const handleClearAll = async () => {
    if (!window.confirm('TÜM hata kayıtlarını silmek istediğinize emin misiniz? Bu işlem geri alınamaz!')) return
    try {
      setActionLoading(true)
      const res = await fetch(`${API_BASE_URL}/api/system-error-logs/clear-all`, {
        method: 'DELETE',
        headers: buildHeaders()
      })
      if (res.ok) {
        await fetchLogs()
      }
    } catch (e: any) {
      alert(e?.message || 'Temizleme işlemi başarısız')
    } finally {
      setActionLoading(false)
    }
  }

  const formatDate = (isoStr: string | null | undefined, localStr: string | null | undefined) => {
    if (localStr) {
      try {
        const d = new Date(localStr)
        if (!isNaN(d.getTime())) {
          return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
        }
      } catch {}
    }
    if (isoStr) {
      try {
        const d = new Date(isoStr)
        return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      } catch {}
    }
    return localStr || isoStr || '—'
  }

  const getMethodBadgeClass = (method: string) => {
    switch ((method || '').toUpperCase()) {
      case 'GET': return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'POST': return 'bg-emerald-100 text-emerald-800 border-emerald-200'
      case 'PUT': return 'bg-amber-100 text-amber-800 border-amber-200'
      case 'DELETE': return 'bg-rose-100 text-rose-800 border-rose-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }


  const columns = useMemo<TableColumn<SystemErrorLog>[]>(() => [
    {
      key: 'createdAt',
      label: 'Tarih / Saat',
      // Süzgeç ve sıralama ekrandaki metin üzerinden; ham ISO değerinde kullanıcı
      // "22.08" yazıp arayamıyordu.
      //
      // Değer SAATLİ; ortak tarih ayrıştırıcısı saati kesip günü karşılaştırıyor.
      filter: { type: 'date' },
      accessorFn: (log) => formatDate(log.createdAt, log.localTime),
      render: (v) => <span className="whitespace-nowrap font-mono text-[11px] text-gray-700">{String(v ?? '')}</span>
    },
    {
      key: 'username',
      label: 'Kullanıcı / IP',
      accessorFn: (log) => `${log.userDisplayName || log.username} ${log.username} ${log.roleName ?? ''} ${log.userIp ?? ''}`,
      render: (_v, log) => (
        <>
          <div className="font-semibold text-gray-900">{log.userDisplayName || log.username}</div>
          <div className="text-[10px] font-mono text-gray-400 mt-0.5">
            @{log.username} {log.roleName ? `(${log.roleName})` : ''} • IP: {log.userIp}
          </div>
        </>
      )
    },
    {
      key: 'requestPath',
      label: 'İstek Metodu & Adresi',
      accessorFn: (log) => `${log.httpMethod ?? ''} ${log.requestPath ?? ''}`,
      render: (_v, log) => (
        <div className="flex items-center gap-1.5 font-mono text-[11px]">
          <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border uppercase ${getMethodBadgeClass(log.httpMethod)}`}>
            {log.httpMethod || 'HTTP'}
          </span>
          <span className="text-gray-800 truncate max-w-[200px]" title={log.requestPath}>
            {log.requestPath}
          </span>
        </div>
      )
    },
    {
      key: 'errorMessage',
      label: 'Hata Açıklaması & Türü',
      accessorFn: (log) => `${log.exceptionType ?? ''} ${log.errorMessage ?? ''} ${log.innerExceptionMessage ?? ''}`,
      render: (_v, log) => (
        <>
          <div className="font-mono text-[11px] font-bold text-red-700 truncate max-w-[400px]">
            {log.exceptionType?.split('.').pop()}: {log.errorMessage}
          </div>
          {log.innerExceptionMessage && (
            <div className="text-[10px] text-amber-700 truncate max-w-[400px] mt-0.5">
              Detay: {log.innerExceptionMessage}
            </div>
          )}
        </>
      )
    },
    {
      key: 'sourceModule',
      label: 'Modül',
      render: (_v, log) => (
        <span className="px-2 py-0.5 text-[10px] font-medium rounded bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">
          {log.sourceModule}
        </span>
      )
    },
    {
      key: 'isResolved',
      label: 'Durum',
      // Metin taşınıyor: ham `true/false` ile "çözüldü" diye aranamaz, sıralama da anlamsız olurdu.
      accessorFn: (log) => (log.isResolved ? 'Çözüldü' : 'Açık Hata'),
      filter: { type: 'select', options: [{ label: 'Çözüldü', value: 'Çözüldü' }, { label: 'Açık Hata', value: 'Açık Hata' }] },
      render: (_v, log) =>
        log.isResolved ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
            Çözüldü
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200 whitespace-nowrap">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            Açık Hata
          </span>
        )
    },
    {
      key: 'actions',
      label: 'İşlem',
      render: (_v, log) => (
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => {
              setSelectedLog(log)
              setResolutionNotes(log.resolutionNotes || '')
            }}
            className="px-2.5 py-1 text-xs font-semibold rounded bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition cursor-pointer"
          >
            Detay
          </button>
          <button
            type="button"
            onClick={() => handleToggleResolve(log, !log.isResolved)}
            disabled={actionLoading}
            className={`px-2.5 py-1 text-xs font-semibold rounded border transition cursor-pointer ${
              log.isResolved
                ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200'
            }`}
          >
            {log.isResolved ? 'Aç' : 'Çözüldü'}
          </button>
          <button
            type="button"
            onClick={() => handleDeleteLog(log.id)}
            disabled={actionLoading}
            className="px-2 py-1 text-xs font-semibold rounded bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition cursor-pointer"
            title="Sil"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </div>
      )
    }
  ], [actionLoading, handleToggleResolve, handleDeleteLog])

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Sistem Hata Logları</h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-700 border border-red-200">
              Canlı Takip
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Sistem genelinde oluşan tüm istisna ve hataların detaylı tarih, saat, yapan kullanıcı, IP ve teknik dökümü.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={fetchLogs}
            disabled={loading}
            className="h-9 px-3 text-xs font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 shadow-sm transition inline-flex items-center gap-1.5 cursor-pointer"
          >
            <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Yenile
          </button>
          <button
            type="button"
            onClick={handleClearResolved}
            disabled={actionLoading || resolvedCount === 0}
            className="h-9 px-3 text-xs font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 shadow-sm transition disabled:opacity-50 cursor-pointer"
          >
            Çözülenleri Temizle
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            disabled={actionLoading || totalCount === 0}
            className="h-9 px-3 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-sm transition disabled:opacity-50 cursor-pointer"
          >
            Tüm Logları Temizle
          </button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Toplam Hata Logu</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{totalCount}</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Açık / Çözülmemiş Hatalar</div>
            <div className="text-2xl font-bold text-red-600 mt-1">{unresolvedCount}</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Çözülen Hatalar</div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">{resolvedCount}</div>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Search Input */}
          <div className="relative flex-1 sm:w-80">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Kullanıcı, hata mesajı, url veya tür ara..."
              className="w-full h-9 pl-9 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
            />
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="h-9 px-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
          >
            <option value="all">Tüm Durumlar</option>
            <option value="unresolved">Sadece Açık Hatalar</option>
            <option value="resolved">Sadece Çözülen Hatalar</option>
          </select>

          {/* Module Filter */}
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="h-9 px-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
          >
            <option value="all">Tüm Modüller</option>
            <option value="B2B.Erp.Api">B2B.Erp.Api (Ana Sistem)</option>
            <option value="Client.Console">Client.Console (Frontend)</option>
          </select>
        </div>

        <div className="text-xs text-gray-500 self-end md:self-auto font-medium">
          Görüntülenen: <span className="font-bold text-gray-800">{filteredLogs.length}</span> / {totalCount}
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {error && (
          <div className="p-4 bg-red-50 border-b border-red-200 text-xs font-semibold text-red-600">
            {error}
          </div>
        )}

        <Table<SystemErrorLog>
          onRefresh={() => void fetchLogs()}
          columns={columns}
          data={filteredLogs}
          rowKey={(log) => String(log.id)}
          loading={loading && logs.length === 0}
        />
      </div>

      {/* Log Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden font-sans">
            {/* Modal Header */}
            <div className="bg-slate-900 text-white p-4 sm:p-5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 flex items-center justify-center font-bold">
                  !
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-mono">HATA DETAYI #{selectedLog.id}</h3>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {formatDate(selectedLog.createdAt, selectedLog.localTime)} • {selectedLog.sourceModule}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-4 bg-slate-50/50 flex-1 text-xs">
              {/* Error Summary */}
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
                <div className="font-mono text-xs font-bold text-red-800">
                  {selectedLog.exceptionType}: {selectedLog.errorMessage}
                </div>
                {selectedLog.innerExceptionMessage && (
                  <div className="text-xs text-red-700 border-t border-red-200 pt-2 font-mono">
                    <span className="font-semibold block text-[11px] text-red-900">Inner Exception:</span>
                    {selectedLog.innerExceptionMessage}
                  </div>
                )}
              </div>

              {/* Context Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Kullanıcı</span>
                  <span className="font-bold text-slate-800 text-xs">{selectedLog.userDisplayName || selectedLog.username}</span>
                  <span className="text-[10px] text-slate-500 block font-mono">@{selectedLog.username} ({selectedLog.roleName || 'Rol yok'})</span>
                </div>

                <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">İstek Adresi / Metod</span>
                  <span className="font-mono font-bold text-slate-800 text-xs block truncate" title={selectedLog.requestPath}>
                    [{selectedLog.httpMethod}] {selectedLog.requestPath}
                  </span>
                  <span className="text-[10px] text-slate-500 block font-mono">IP: {selectedLog.userIp}</span>
                </div>

                <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Durum / Modül</span>
                  <span className="font-semibold text-slate-800 text-xs block">{selectedLog.sourceModule}</span>
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold mt-0.5 ${selectedLog.isResolved ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                    {selectedLog.isResolved ? 'Çözüldü' : 'Açık Hata'}
                  </span>
                </div>
              </div>

              {/* Stack Trace */}
              {selectedLog.stackTrace && (
                <div className="bg-slate-900 text-slate-200 rounded-xl p-4 space-y-2 border border-slate-800">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block font-mono">Stack Trace / Hata İz Sürücü</span>
                  <pre className="text-[11px] font-mono whitespace-pre-wrap overflow-x-auto text-rose-300 max-h-60 overflow-y-auto leading-relaxed">
                    {selectedLog.stackTrace}
                  </pre>
                </div>
              )}

              {/* Resolution Notes Input */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2">
                <label className="text-xs font-bold text-slate-700 block">Çözüm Notları / Açıklama</label>
                <textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="Bu hata hakkında alınan aksiyonları veya açıklamanızı yazınız..."
                  className="w-full h-20 p-2.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 transition"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-100 p-4 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition cursor-pointer"
              >
                Kapat
              </button>

              <button
                type="button"
                onClick={() => handleToggleResolve(selectedLog, !selectedLog.isResolved)}
                disabled={actionLoading}
                className={`px-4 py-2 text-xs font-semibold rounded-lg text-white shadow-sm transition cursor-pointer ${
                  selectedLog.isResolved
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {selectedLog.isResolved ? 'Yeniden Aç' : 'Çözüldü Olarak İşaretle'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
