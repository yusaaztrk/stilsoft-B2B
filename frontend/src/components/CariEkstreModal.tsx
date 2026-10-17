import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from './Modal'
import { fetchCustomerLedger } from '../api/customerLedger'
import { fetchSupplierLedger } from '../api/supplierLedger'
import { fetchAccountingPeriods } from '../services/accountingPeriodService'

/**
 * CARİ EKSTRE MODALI — cari adına tıklayınca özet ekstre (Fatura Dökümü, 2026-09-04).
 *
 * 2026-09-17: Alış Faturaları ekranı da aynı modalı açsın diye Fatura Dökümü'nden buraya
 * taşındı (kullanıcı isteği: "arayüz fatura dökümü ile birebir olacak"). İki ekran TEK
 * bileşeni kullanıyor, biri değişince öbürü ayrışmasın.
 *
 * Kaynak koda göre seçilir — Cari Ekstre raporuyla aynı kural (`CariEkstreReport`):
 *  - `320-…` tedarikçi → `/api/supplier-ledger`. Müşteri ekstre ucu bu kodu tanımıyor; alış
 *    faturası satırında modal boş "Hareket yok" gösteriyordu.
 *  - diğerleri (120 müşteri, 770/600 gider) → `/api/customer-ledger`, ilk kapanmamış dönemle.
 *    Dönem ŞART: gönderilmezse DEVİR satırı elenir ve bakiye eksik çıkar
 *    ([[ekstre_donemsiz_cagri_devir_tuzagi]]).
 */

type EkstreSatiri = {
  id: number
  date?: string | null
  documentNo?: string | null
  description?: string | null
  transactionType?: string | null
  debit?: number
  credit?: number
  balance?: number
}

type EkstreVerisi = {
  kod: string
  summary: { totalDebit: number; totalCredit: number; balance: number }
  items: EkstreSatiri[]
}

export const isSupplierCariCode = (kod: string) => String(kod ?? '').trim().startsWith('320')

export default function CariEkstreModal({
  open,
  cari,
  onClose
}: {
  open: boolean
  cari: { kod: string; ad: string } | null
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [data, setData] = useState<EkstreVerisi | null>(null)

  useEffect(() => {
    if (!open || !cari?.kod) return
    const kod = cari.kod.trim()
    const ac = new AbortController()

    setLoading(true)
    setErr(null)
    setData(null)

    void (async () => {
      try {
        if (isSupplierCariCode(kod)) {
          const res = await fetchSupplierLedger(kod, { signal: ac.signal })
          setData({
            kod: res?.supplierCode || kod,
            summary: res?.summary ?? { totalDebit: 0, totalCredit: 0, balance: 0 },
            items: (res?.items ?? []) as EkstreSatiri[]
          })
          return
        }

        let periodId: number | undefined
        try {
          const periods = await fetchAccountingPeriods()
          const p = periods.find((x) => !x.isClosed) ?? periods[0]
          if (p?.id) periodId = p.id
        } catch { /* dönem çözülemezse yine de çek — hiç göstermemekten iyidir */ }

        const res = await fetchCustomerLedger(kod, periodId ? { periodId, signal: ac.signal } : { signal: ac.signal })
        setData({
          kod: res?.customerCode || kod,
          summary: res?.summary ?? { totalDebit: 0, totalCredit: 0, balance: 0 },
          items: (res?.items ?? []) as EkstreSatiri[]
        })
      } catch (e: any) {
        if (ac.signal.aborted) return
        setErr(String(e?.message ?? 'Ekstre alınamadı'))
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    })()

    return () => ac.abort()
  }, [open, cari?.kod])

  const para = (v: number | undefined) => Number(v ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={`Cari Ekstre — ${cari?.ad ?? ''}`}
      containerClassName="max-w-5xl"
      footer={
        <div className="flex items-center justify-between gap-2 w-full">
          <button
            type="button"
            onClick={() => {
              if (!cari?.kod) return
              const isSupplier = isSupplierCariCode(cari.kod)
              navigate(`/reports/cariEkstre?${isSupplier ? 'supplierCode' : 'customerCode'}=${encodeURIComponent(cari.kod)}`)
            }}
            className="px-3 py-2 text-xs font-semibold bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            Tam Ekstreye Git
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            Kapat
          </button>
        </div>
      }
    >
      {loading && (
        <div className="py-10 text-center text-xs text-gray-500 flex items-center justify-center gap-2">
          <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <span>Ekstre yükleniyor...</span>
        </div>
      )}
      {err && (
        <div className="p-3 bg-rose-50 border border-rose-100 text-xs text-rose-600 rounded-lg">{err}</div>
      )}
      {!loading && !err && data && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 text-xs">
            <div className="px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200">
              <span className="text-gray-500">Kod: </span>
              <span className="font-mono font-semibold">{data.kod}</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-100">
              <span className="text-rose-600">Borç: </span>
              <span className="font-semibold text-rose-800">{para(data.summary?.totalDebit)}</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-100">
              <span className="text-emerald-600">Alacak: </span>
              <span className="font-semibold text-emerald-800">{para(data.summary?.totalCredit)}</span>
            </div>
            <div className={'px-3 py-1.5 rounded-lg border ' + (Number(data.summary?.balance ?? 0) >= 0 ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100')}>
              <span className="text-gray-600">Bakiye: </span>
              <span className="font-bold">{para(data.summary?.balance)}</span>
            </div>
          </div>
          <div className="max-h-[55vh] overflow-auto border border-gray-100 rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="text-gray-600 border-b border-gray-100 font-semibold">
                  <th className="p-2">Tarih</th>
                  <th className="p-2">Belge</th>
                  <th className="p-2">Açıklama</th>
                  <th className="p-2 text-right">Borç</th>
                  <th className="p-2 text-right">Alacak</th>
                  <th className="p-2 text-right">Bakiye</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {(data.items ?? []).map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/50">
                    <td className="p-2 whitespace-nowrap">{r.date ? new Date(r.date).toLocaleDateString('tr-TR') : '-'}</td>
                    <td className="p-2 font-mono">{r.documentNo || '-'}</td>
                    <td className="p-2 max-w-[280px] truncate" title={r.description ?? ''}>{r.description || r.transactionType || '-'}</td>
                    <td className="p-2 text-right">{r.debit ? para(r.debit) : ''}</td>
                    <td className="p-2 text-right">{r.credit ? para(r.credit) : ''}</td>
                    <td className="p-2 text-right font-semibold">{para(r.balance)}</td>
                  </tr>
                ))}
                {(data.items ?? []).length === 0 && (
                  <tr><td colSpan={6} className="p-6 text-center text-gray-400">Hareket yok.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}
