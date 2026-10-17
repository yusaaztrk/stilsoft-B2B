import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { deleteEmployeePayment, fetchPaymentReport, updateEmployeePayment, type PaymentReport } from '../api/employeePayments'
import Modal from './Modal'
import AyarliTablo from './table/AyarliTablo'

export function money(value: number): string {
  return `₺${(Number(value) || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function fmtDate(iso?: string | null): string {
  const s = String(iso ?? '').trim()
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('tr-TR')
}

/** Ay basindan bugune varsayilan aralik; rapor acilir acilmaz anlamli bir sey gostersin. */
function defaultRange(): { from: string; to: string } {
  const now = new Date()
  const first = new Date(now.getFullYear(), now.getMonth(), 1)
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { from: iso(first), to: iso(now) }
}

/**
 * Ödeme türü sayfalarının ortak gövdesi: tarih aralığı filtresi, özet kartları,
 * "kime ne ödenmiş" dökümü ve geri alma. Türe özel ödeme yapma akışı `action` ile verilir.
 */
export default function PaymentReportView({
  type,
  title,
  subtitle,
  helpText,
  action,
  reloadKey = 0,
  extraColumns
}: {
  type: number
  title: string
  subtitle: string
  helpText: string
  action?: React.ReactNode
  reloadKey?: number
  extraColumns?: 'advance'
}) {
  const [range, setRange] = useState(defaultRange)
  const [report, setReport] = useState<PaymentReport>({ rows: [], summary: { count: 0, total: 0, employeeCount: 0 } })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)

  // ÖDEME DÜZENLEME (2026-09-27): tutar / tarih / açıklama. B2B kasa/banka satırı sunucuda
  // aynı kurla güncellenir. Kasa/banka değiştirmek için geri alıp yeniden ödenir.
  const [editRow, setEditRow] = useState<PaymentReport['rows'][number] | null>(null)
  const [editAmount, setEditAmount] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editDesc, setEditDesc] = useState('')
  // Ödemenin ait olduğu dönem (yyyy-MM). Yanlış aya yazılmış eski maaş ödemesi (ağustos maaşı
  // eylüle düşmüş) buradan düzeltilir; sunucu avans mahsubunu da yeni döneme taşır.
  const [editPeriod, setEditPeriod] = useState('')
  const [editError, setEditError] = useState<string | null>(null)
  const [editBusy, setEditBusy] = useState(false)

  const openEdit = (r: PaymentReport['rows'][number]) => {
    const d = new Date(String(r.paymentDate ?? ''))
    const ymd = Number.isNaN(d.getTime())
      ? ''
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setEditRow(r)
    setEditAmount(String(r.amount ?? '').replace('.', ','))
    setEditDate(ymd)
    setEditDesc(r.description ?? '')
    setEditPeriod(r.salaryPeriod ?? '')
    setEditError(null)
  }

  const saveEdit = async () => {
    if (!editRow) return
    // "1.234,56" (Türkçe) ve "1234.56" ikisi de doğru okunsun: virgül varsa nokta binlik ayırıcıdır.
    const raw = String(editAmount).trim()
    const amount = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw)
    if (!(amount > 0)) {
      setEditError('Tutar sıfırdan büyük olmalı.')
      return
    }
    const d = new Date(String(editRow.paymentDate ?? ''))
    const originalYmd = Number.isNaN(d.getTime())
      ? ''
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setEditBusy(true)
    setEditError(null)
    try {
      await updateEmployeePayment(editRow.id, {
        amount,
        // Tarih değişmediyse saat de korunur (gün sınırı kaymasın).
        paymentDate: editDate && editDate !== originalYmd ? `${editDate}T12:00:00Z` : undefined,
        description: editDesc,
        salaryPeriod: editPeriod && editPeriod !== (editRow.salaryPeriod ?? '') ? editPeriod : undefined
      })
      setEditRow(null)
      await load()
    } catch (e: any) {
      setEditError(String(e?.message ?? 'Ödeme düzenlenemedi'))
    } finally {
      setEditBusy(false)
    }
  }

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const r = await fetchPaymentReport({ type, from: range.from, to: range.to, take: 1000, signal })
        setReport(r)
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(String(e?.message ?? 'Döküm alınamadı'))
      } finally {
        setLoading(false)
      }
    },
    [type, range.from, range.to]
  )

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load, reloadKey])

  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR')
    if (!q) return report.rows
    return report.rows.filter((r) =>
      `${r.employeeName} ${r.employeeCode} ${r.description ?? ''}`.toLocaleLowerCase('tr-TR').includes(q)
    )
  }, [report.rows, search])

  const visibleTotal = useMemo(() => rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0), [rows])

  const undo = async (id: number) => {
    if (!window.confirm('Bu ödeme geri alınacak. Onaylıyor musunuz?')) return
    setBusyId(id)
    try {
      await deleteEmployeePayment(id)
      await load()
    } catch (e: any) {
      setError(String(e?.message ?? 'Ödeme geri alınamadı'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl md:text-4xl text-obsidian-850 font-normal tracking-tight">{title}</h1>
          <p className="text-sm text-neutral-500 mt-1">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {action}
          <button type="button" onClick={() => void load()} className="btn-editorial" disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Yenile
          </button>
        </div>
      </div>

      <div className="card shadow-card p-4 border-l-4 border-l-bronze-500">
        <p className="text-[13px] text-neutral-600 leading-relaxed">{helpText}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card shadow-card p-5">
          <div className="text-[11px] uppercase tracking-wider text-neutral-400">Seçili aralıkta toplam</div>
          <div className="font-serif text-2xl md:text-3xl text-obsidian-850 my-1.5">{money(report.summary.total)}</div>
        </div>
        <div className="card shadow-card p-5">
          <div className="text-[11px] uppercase tracking-wider text-neutral-400">İşlem sayısı</div>
          <div className="font-serif text-2xl md:text-3xl text-obsidian-850 my-1.5">{report.summary.count}</div>
        </div>
        <div className="card shadow-card p-5">
          <div className="text-[11px] uppercase tracking-wider text-neutral-400">Kaç çalışana</div>
          <div className="font-serif text-2xl md:text-3xl text-obsidian-850 my-1.5">{report.summary.employeeCount}</div>
        </div>
      </div>

      <div className="card shadow-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="rep-from" className="block text-[11px] uppercase tracking-wider text-neutral-400">
              Başlangıç
            </label>
            <input
              id="rep-from"
              type="date"
              value={range.from}
              onChange={(e) => setRange((p) => ({ ...p, from: e.target.value }))}
              className="input-base w-44"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="rep-to" className="block text-[11px] uppercase tracking-wider text-neutral-400">
              Bitiş
            </label>
            <input
              id="rep-to"
              type="date"
              value={range.to}
              onChange={(e) => setRange((p) => ({ ...p, to: e.target.value }))}
              className="input-base w-44"
            />
          </div>
          <div className="space-y-1 flex-1 min-w-[200px]">
            <label htmlFor="rep-search" className="block text-[11px] uppercase tracking-wider text-neutral-400">
              Ara
            </label>
            <input
              id="rep-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-base"
              placeholder="İsim, kod veya açıklama"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="card shadow-card p-4 border-rose-200 bg-rose-50/60 text-sm text-rose-800">{error}</div>
      )}

      <div className="overflow-x-auto card shadow-card">
        <AyarliTablo>
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-ivory-100 border-b border-ivory-300 text-[11px] uppercase tracking-wider text-neutral-500">
              <th className="text-left px-3 py-2.5">Tarih</th>
              <th className="text-left px-3 py-2.5">Kod</th>
              <th className="text-left px-3 py-2.5">Çalışan</th>
              <th className="text-left px-3 py-2.5">Dönem</th>
              <th className="text-left px-3 py-2.5">Açıklama</th>
              {extraColumns === 'advance' && <th className="text-left px-3 py-2.5">Maaştan Kesilecek</th>}
              <th className="text-right px-3 py-2.5">Tutar</th>
              <th className="text-left px-3 py-2.5">Kaydeden</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={extraColumns === 'advance' ? 9 : 8} className="px-3 py-10 text-center text-neutral-400">
                  Seçili aralıkta kayıt yok.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-ivory-200 hover:bg-ivory-50">
                <td className="px-3 py-2.5 whitespace-nowrap">{fmtDate(r.paymentDate)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-neutral-500">{r.employeeCode}</td>
                <td className="px-3 py-2.5 font-medium text-obsidian-850">{r.employeeName}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-neutral-500">{r.salaryPeriod ?? '—'}</td>
                <td className="px-3 py-2.5 text-neutral-600">{r.description ?? '—'}</td>
                {extraColumns === 'advance' && (
                  <td className="px-3 py-2.5">
                    {r.deductFromSalary ? (
                      r.salaryDeductedAt ? (
                        <span className="badge-navy">MAHSUP EDİLDİ</span>
                      ) : (
                        <span className="badge-amber">BEKLİYOR</span>
                      )
                    ) : (
                      <span className="text-neutral-400">Hayır</span>
                    )}
                  </td>
                )}
                <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap">{money(r.amount)}</td>
                <td className="px-3 py-2.5 text-neutral-400 whitespace-nowrap">{r.createUser}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    className="btn-editorial mr-1.5"
                    disabled={busyId === r.id}
                    aria-label={`${r.employeeName} ödemesini düzenle`}
                    title="Ödemeyi düzenle"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void undo(r.id)}
                    className="btn-danger"
                    disabled={busyId === r.id}
                    aria-label={`${r.employeeName} ödemesini geri al`}
                    title="Ödemeyi geri al"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-ivory-100 border-t border-ivory-300 font-medium">
                <td colSpan={extraColumns === 'advance' ? 6 : 5} className="px-3 py-2.5 text-right text-neutral-500">
                  Görünen {rows.length} kayıt toplamı
                </td>
                <td className="px-3 py-2.5 text-right">{money(visibleTotal)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
        </AyarliTablo>
      </div>

      <Modal isOpen={!!editRow} onClose={() => setEditRow(null)} title="Ödemeyi Düzenle">
        <div className="space-y-4">
          <p className="text-[13px] text-neutral-600">
            <strong>{editRow?.employeeName}</strong> — {editRow?.salaryPeriod ?? ''}. Ödeme B2B kasa/bankasından çıktıysa oradaki
            "Personel Ödemesi" satırı da aynı kurla güncellenir; toplu ödemede toplam satır farkı kadar değişir.
            Kasa/banka değiştirmek için ödemeyi geri alıp yeniden ödeyin.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="block text-[11px] uppercase tracking-wider text-neutral-400">Tutar (₺)</label>
              <input className="input-base" inputMode="decimal" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] uppercase tracking-wider text-neutral-400">Ödeme Tarihi</label>
              <input className="input-base" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] uppercase tracking-wider text-neutral-400">Ait Olduğu Dönem</label>
              <input className="input-base" type="month" value={editPeriod} onChange={(e) => setEditPeriod(e.target.value)} />
            </div>
          </div>
          <p className="text-[11px] text-neutral-500">
            Ödeme tarihi ile dönem ayrıdır: ağustos maaşı eylülde ödenir ama dönemi ağustostur. Maaş hangi aya
            aitse o ayın satırında "Ödendi" görünür.
          </p>
          <div className="space-y-1">
            <label className="block text-[11px] uppercase tracking-wider text-neutral-400">Açıklama</label>
            <input className="input-base" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
          </div>
          {editError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-800">{editError}</div>
          )}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-ivory-300">
            <button type="button" onClick={() => setEditRow(null)} className="btn-editorial" disabled={editBusy}>
              Vazgeç
            </button>
            <button type="button" onClick={() => void saveEdit()} className="btn-primary" disabled={editBusy}>
              {editBusy ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
