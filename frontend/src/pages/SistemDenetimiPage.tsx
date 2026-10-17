import React, { useMemo, useState } from 'react'
import { API_BASE_URL } from '../config/api'
import { ShieldCheck, AlertTriangle, ChevronDown, ChevronRight, Loader2, PlayCircle } from 'lucide-react'

type AuditCheckResult = {
  category: string
  id: string
  title: string
  note?: string | null
  columns: string[]
  rows: (string | null)[][]
  rowCount: number
  error: boolean
  errorMessage?: string | null
  elapsedMs: number
}

export default function SistemDenetimiPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<AuditCheckResult[] | null>(null)
  const [ranAt, setRanAt] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const tenantCode = useMemo(() => String(localStorage.getItem('tenantCode') ?? '').trim(), [])

  const buildHeaders = () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const token = localStorage.getItem('accessToken')
    if (token) headers.Authorization = `Bearer ${token}`
    if (tenantCode) headers['X-Tenant-Code'] = tenantCode
    return headers
  }

  const runAudit = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/api/system-audit/run`, { method: 'POST', headers: buildHeaders() })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new Error(t || `Denetim çalıştırılamadı (${res.status})`)
      }
      const json = await res.json().catch(() => null)
      setResults(Array.isArray(json?.data) ? json.data : [])
      setRanAt(json?.ranAtUtc ?? new Date().toISOString())
      setExpanded({})
    } catch (e: any) {
      setError(String(e?.message ?? 'Denetim çalıştırılırken hata oluştu'))
    } finally {
      setLoading(false)
    }
  }

  const grouped = useMemo(() => {
    if (!results) return []
    const map = new Map<string, AuditCheckResult[]>()
    for (const r of results) {
      if (!map.has(r.category)) map.set(r.category, [])
      map.get(r.category)!.push(r)
    }
    return Array.from(map.entries())
  }, [results])

  const totalFindings = useMemo(
    () => (results ?? []).reduce((acc, r) => acc + (r.error ? 0 : r.rowCount), 0),
    [results]
  )
  const totalErrors = useMemo(() => (results ?? []).filter((r) => r.error).length, [results])

  return (
    <div className="p-4 max-w-6xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            Sistem Denetimi
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Fatura/KDV matematiği, kasa-banka-ekstre tutarlılığı, stok/depo bütünlüğü ve cari çapraz kontrolleri
            salt-okuma olarak tek seferde çalıştırır. Hiçbir sorgu veri değiştirmez.
          </p>
        </div>
        <button
          onClick={runAudit}
          disabled={loading}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition flex items-center gap-2 shrink-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
          {loading ? 'Çalışıyor…' : 'Denetimi Çalıştır'}
        </button>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 text-sm rounded-lg bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      {results && (
        <div className="mb-4 flex items-center gap-3 text-xs text-gray-500">
          <span>Çalıştırma zamanı: {ranAt ? new Date(ranAt).toLocaleString('tr-TR') : '-'}</span>
          <span className="text-gray-300">•</span>
          <span>
            Toplam bulgu satırı: <b className={totalFindings > 0 ? 'text-amber-700' : 'text-emerald-700'}>{totalFindings}</b>
          </span>
          {totalErrors > 0 && (
            <>
              <span className="text-gray-300">•</span>
              <span className="text-red-600">{totalErrors} sorgu çalıştırılamadı</span>
            </>
          )}
        </div>
      )}

      {!results && !loading && (
        <div className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg p-8 text-center">
          Henüz çalıştırılmadı. "Denetimi Çalıştır" butonuna bas.
        </div>
      )}

      {grouped.map(([category, checks]) => (
        <div key={category} className="mb-5">
          <h2 className="text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">{category}</h2>
          <div className="space-y-2">
            {checks.map((c) => {
              const key = `${c.category}/${c.id}`
              const isOpen = !!expanded[key]
              const clean = !c.error && c.rowCount === 0
              return (
                <div key={key} className="border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpanded((s) => ({ ...s, [key]: !s[key] }))}
                    className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 transition"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {c.rowCount > 0 && !c.error ? (
                        isOpen ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                      ) : (
                        <span className="w-4 shrink-0" />
                      )}
                      <span className="text-[10px] font-mono text-gray-400 shrink-0">{c.id}</span>
                      <span className="text-sm font-medium text-gray-800 truncate">{c.title}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      {c.error ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">
                          <AlertTriangle className="w-3 h-3" /> hata
                        </span>
                      ) : clean ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          ✓ temiz
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          {c.rowCount} satır
                        </span>
                      )}
                    </div>
                  </button>

                  {c.note && (
                    <div className="px-3 pb-2 text-[11px] text-gray-500 italic border-t border-gray-100 pt-2 bg-gray-50">
                      {c.note}
                    </div>
                  )}

                  {c.error && (
                    <div className="px-3 py-2 text-xs text-red-600 bg-red-50 border-t border-red-100 font-mono">
                      {c.errorMessage}
                    </div>
                  )}

                  {isOpen && !c.error && c.rowCount > 0 && (
                    <div className="overflow-x-auto border-t border-gray-100">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            {c.columns.map((col) => (
                              <th key={col} className="px-2 py-1.5 text-left font-semibold text-gray-500 whitespace-nowrap">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {c.rows.map((row, i) => (
                            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                              {row.map((cell, j) => (
                                <td key={j} className="px-2 py-1 text-gray-700 whitespace-nowrap font-mono">
                                  {cell ?? <span className="text-gray-300">—</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
