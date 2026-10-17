import { useMemo, useState, useEffect } from 'react'
import { Download, Filter, FileText, Calendar, ChevronRight } from 'lucide-react'

import { fetchServiceExport, type ServiceExportRow, type ServiceType } from '../api/serviceRecords'

type CategoryId = 'genel' | 'montaj' | 'ariza' | 'tamamlanan' | 'iptal'

const CATEGORIES: Array<{ id: CategoryId; name: string; icon: string; type?: ServiceType; status?: string }> = [
  { id: 'genel', name: 'Genel', icon: '📊' },
  { id: 'montaj', name: 'Montaj', icon: '🔧', type: 'Installation' },
  { id: 'ariza', name: 'Arıza', icon: '🛠️', type: 'Repair' },
  { id: 'tamamlanan', name: 'Tamamlanan', icon: '✅', status: 'Delivered' },
  { id: 'iptal', name: 'İptal', icon: '🚫', status: 'Cancelled' },
]

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function startOfMonthIso() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

export default function RaporlarPage() {
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>('genel')
  const [dateFrom, setDateFrom] = useState<string>(startOfMonthIso())
  const [dateTo, setDateTo] = useState<string>(todayIso())

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<ServiceExportRow[]>([])

  const activeCategory = useMemo(
    () => CATEGORIES.find((c) => c.id === selectedCategory) ?? CATEGORIES[0],
    [selectedCategory]
  )

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        setLoading(true)
        setError(null)
        const list = await fetchServiceExport(
          {
            type: activeCategory.type,
            status: activeCategory.status,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
          },
          { signal: ac.signal }
        )
        setRows(list ?? [])
      } catch (e: any) {
        if (String(e?.name ?? '') === 'AbortError') return
        setError(String(e?.message ?? 'Raporlar alınamadı.'))
        setRows([])
      } finally {
        setLoading(false)
      }
    })()
    return () => ac.abort()
  }, [activeCategory.id, dateFrom, dateTo])

  function downloadCsv(fileName: string, data: Record<string, any>[]) {
    const escapeCell = (v: any) => {
      const s = String(v ?? '')
      if (/[\n\r",;]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    }
    const headers = Object.keys(data[0] ?? {})
    const lines = [headers.map(escapeCell).join(';')]
    for (const r of data) lines.push(headers.map((h) => escapeCell((r as any)[h])).join(';'))
    const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const mapForExport = (data: ServiceExportRow[]) =>
    data.map((d) => ({
      ServisNo: d.serviceNumber,
      Tip: d.type,
      Durum: d.status,
      Oncelik: d.priority,
      Bayi: d.dealerName ?? '',
      Urun: d.productName,
      SeriNo: d.serialNumber ?? '',
      Garanti: d.isUnderWarranty ? 'Evet' : 'Hayır',
      Musteri: d.customerName ?? '',
      Telefon: d.customerPhone ?? '',
      Adres: d.customerAddress ?? '',
      Bolge: d.regionName ?? '',
      Teknisyen: d.technicianName ?? '',
      PlanTarihi: d.plannedDate ?? '',
      KayitTarihi: d.createdAt,
      Aciklama: d.problemDescription ?? '',
    }))

  const exportCurrent = () => {
    const data = mapForExport(rows)
    if (data.length === 0) return
    downloadCsv(`raporlar-${selectedCategory}-${todayIso()}.csv`, data)
  }

  const exportSingle = (row: ServiceExportRow) => {
    downloadCsv(`rapor-${row.serviceNumber}.csv`, mapForExport([row]))
  }

  const categories = CATEGORIES

  return (
    <div className="p-4 lg:p-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-gray-900">Raporlar</h1>
          <p className="text-sm text-gray-500 mt-1">Detaylı raporları görüntüleyin ve indirin.</p>
        </div>
        <button
          onClick={exportCurrent}
          disabled={loading || rows.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-[#B91C1C] text-white rounded-lg text-sm font-medium hover:bg-[#991B1B] disabled:opacity-60"
        >
          <Download className="w-4 h-4" /> Dışa Aktar ({rows.length})
        </button>
      </div>

      <div className="grid lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-2">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                selectedCategory === cat.id ? 'bg-[#B91C1C] text-white' : 'bg-white hover:bg-gray-50 text-gray-700'
              }`}
            >
              <span>{cat.icon}</span>
              {cat.name}
              <ChevronRight className="w-4 h-4 ml-auto" />
            </button>
          ))}
        </div>

        <div className="lg:col-span-3 space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className="flex flex-col md:flex-row md:items-end gap-3">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Başlangıç</label>
                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="flex-1 text-sm outline-none bg-transparent"
                  />
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Bitiş</label>
                <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="flex-1 text-sm outline-none bg-transparent"
                  />
                </div>
              </div>
              <button
                onClick={() => { setDateFrom(startOfMonthIso()); setDateTo(todayIso()) }}
                className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
              >
                <Filter className="w-4 h-4" /> Bu Ay
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">{activeCategory.name} Raporu</h3>
                <div className="text-xs text-gray-500 mt-0.5">{rows.length} kayıt · {dateFrom} → {dateTo}</div>
              </div>
              <button
                onClick={exportCurrent}
                disabled={loading || rows.length === 0}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                <Download className="w-4 h-4 text-gray-500" /> CSV
              </button>
            </div>
            <div className="divide-y divide-gray-100 max-h-[640px] overflow-y-auto">
              {error ? (
                <div className="p-4 text-sm text-red-600">{error}</div>
              ) : loading ? (
                <div className="p-4 text-sm text-gray-500">Yükleniyor...</div>
              ) : rows.length === 0 ? (
                <div className="p-4 text-sm text-gray-500">Kayıt bulunamadı.</div>
              ) : (
                rows.slice(0, 200).map((row) => (
                  <div key={row.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
                        <FileText className="w-5 h-5 text-[#B91C1C]" />
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{row.serviceNumber} • {row.productName}</div>
                        <div className="text-xs text-gray-500">
                          {row.type} • {row.status} • {row.regionName ?? '-'} • {row.createdAt.slice(0, 10)}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => exportSingle(row)}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm text-[#B91C1C] hover:bg-red-50 rounded-lg font-medium"
                    >
                      <Download className="w-4 h-4" /> İndir
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
