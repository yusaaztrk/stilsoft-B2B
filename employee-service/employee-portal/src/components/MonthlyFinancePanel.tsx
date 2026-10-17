import React, { useCallback, useEffect, useState } from 'react'
import { money } from './PaymentReportView'
import { fetchMonthlySummary, type MonthlySummaryDto } from '../api/employeeLedger'

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const Row = ({ label, value, strong, negative }: { label: string; value: number; strong?: boolean; negative?: boolean }) => (
  <div className={`flex items-center justify-between py-1 ${strong ? 'border-t border-slate-300 mt-1 pt-1.5 font-black' : ''}`}>
    <span className="text-slate-600">{label}</span>
    <span className={`tabular-nums ${negative ? 'text-rose-700' : strong ? 'text-slate-900' : 'text-slate-800'}`}>
      {money(value)}
    </span>
  </div>
)

/**
 * Bir personelin SEÇİLEN AYDAKİ tüm finansal durumu tek ekranda: maaş, yemek, prim, avans.
 *
 * Dört ödeme türü dört ayrı ekranda yönetildiği için "bu ay bu adama ne oldu" sorusunun cevabı
 * dağınıktı. Buradaki bloklar `monthly-summary` ucundan gelir; ekstredeki alacak/borç ile aynı
 * kuralları kullanır, ayrı bir hesap yapmaz.
 */
export default function MonthlyFinancePanel({
  employeeId,
  employeeName
}: {
  employeeId: number
  employeeName: string
}) {
  const [period, setPeriod] = useState(currentPeriod)
  const [data, setData] = useState<MonthlySummaryDto | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchMonthlySummary(employeeId, period, { signal }))
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setError(String(e?.message ?? 'Aylık özet alınamadı'))
    } finally {
      setLoading(false)
    }
  }, [employeeId, period])

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">
          Aylık Finans Detayı
        </h3>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="input-base py-1.5 text-xs"
            aria-label="Dönem"
          />
          {loading ? <span className="text-xs text-slate-400">Yükleniyor...</span> : null}
        </div>
      </div>

      {error ? (
        <div className="p-4 text-sm text-rose-800 bg-rose-50 border-b border-rose-200">{error}</div>
      ) : null}

      <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 text-xs">
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Maaş</div>
          <Row label="Standart maaş" value={data?.salary.standard ?? 0} />
          {data?.salary.overrideAmount != null ? (
            <Row label="Bu aya özel" value={data.salary.overrideAmount} />
          ) : null}
          <Row label="Hak edilen" value={data?.salary.accrued ?? 0} />
          <Row label="Avans kesintisi" value={-(data?.salary.advanceDeduction ?? 0)} negative />
          <Row label="Net" value={data?.salary.net ?? 0} strong />
          <Row label="Ödenen" value={data?.salary.paid ?? 0} />
          <Row label="Kalan" value={data?.salary.remaining ?? 0} strong />
          <div className="mt-2 text-[11px]">
            {data?.salary.accrualDefined ? (
              <span className="text-emerald-700 font-bold">
                ✓ Hakediş tanımlı{data.salary.referenceNo ? ` · ${data.salary.referenceNo}` : ''}
              </span>
            ) : (
              <span className="text-rose-700 font-bold">Hakediş tanımsız</span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Yemek</div>
          <Row label="Aylık tutar" value={data?.meal.monthlyAmount ?? 0} />
          {data?.meal.overrideAmount != null ? (
            <Row label="Bu aya özel" value={data.meal.overrideAmount} />
          ) : null}
          <Row label="Hak edilen" value={data?.meal.accrued ?? 0} strong />
          <Row label="Ödenen" value={data?.meal.paid ?? 0} />
          <Row label="Kalan" value={data?.meal.remaining ?? 0} strong />
          <div className="mt-2 text-[11px]">
            {data?.meal.accrualDefined ? (
              <span className="text-emerald-700 font-bold">✓ Hakediş tanımlı</span>
            ) : (
              <span className="text-rose-700 font-bold">Hakediş tanımsız</span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Prim</div>
          <Row label="Toplam" value={data?.bonus.accrued ?? 0} />
          <Row label="Ödenen" value={data?.bonus.paid ?? 0} />
          <Row label="Bekleyen" value={data?.bonus.pending ?? 0} strong />
          {(data?.bonus.items ?? []).length > 0 ? (
            <div className="mt-2 space-y-1 max-h-24 overflow-y-auto">
              {data!.bonus.items.map((b) => (
                <div key={b.id} className="flex justify-between text-[11px] text-slate-500">
                  <span className="truncate pr-2">{b.description || 'Prim'}</span>
                  <span className="tabular-nums">{money(b.amount)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">Avans</div>
          <Row label="Toplam" value={data?.advance.total ?? 0} />
          <Row label="Maaştan düşülecek" value={data?.advance.deductibleFromSalary ?? 0} />
          <Row label="Düşülmeyecek" value={data?.advance.notDeductible ?? 0} />
          <Row label="Mahsup edilen" value={data?.advance.deducted ?? 0} strong />
          {(data?.advance.items ?? []).length > 0 ? (
            <div className="mt-2 space-y-1 max-h-24 overflow-y-auto">
              {data!.advance.items.map((a) => (
                <div key={a.id} className="flex justify-between text-[11px] text-slate-500">
                  <span className="truncate pr-2">
                    {a.description || 'Avans'}
                    {a.isDeducted ? ' ·mahsup' : a.deductFromSalary ? ' ·düşülecek' : ''}
                  </span>
                  <span className="tabular-nums">{money(a.amount)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="px-4 pb-3 text-[11px] text-slate-400">
        {employeeName} · {data?.period ?? period} dönemi
      </div>
    </div>
  )
}
