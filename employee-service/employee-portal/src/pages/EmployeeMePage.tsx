import React, { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import { fetchEmployeeSelfDashboard, type EmployeeSelfDashboardDto } from '../api/employeeSelf'
import { Calendar, DollarSign, Award, Activity, TrendingUp, RefreshCw } from 'lucide-react'


function ymd(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function safeDate(input: string) {
  const d = new Date(String(input ?? ''))
  return Number.isNaN(d.getTime()) ? null : d
}

function formatTrDateTime(iso?: string | null) {
  if (!iso) return '-'
  const d = safeDate(iso)
  if (!d) return '-'
  return d.toLocaleString('tr-TR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatTrDate(iso?: string | null) {
  if (!iso) return '-'
  const d = safeDate(iso)
  if (!d) return '-'
  return d.toLocaleDateString('tr-TR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function moneyTRY(v: number) {
  const n = Number(v || 0) || 0
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function EmployeeMePage() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [popup, setPopup] = useState<{ variant: NotificationVariant; title: string; message: string } | null>(null)
  const [selectedMonth, setSelectedMonth] = useState(() => monthKey(new Date()))
  const [data, setData] = useState<EmployeeSelfDashboardDto | null>(null)

  const load = async () => {
    try {
      setBusy(true)
      setError(null)
      const res = await fetchEmployeeSelfDashboard({ month: selectedMonth })
      setData(res)
    } catch (e: any) {
      const msg = String(e?.message ?? 'Veriler alınamadı')
      setError(msg)
      setPopup({ variant: 'error', title: 'Hata', message: msg })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth])

  const dayMap = useMemo(() => {
    const worked = new Set<string>((data?.calendar?.workedDays ?? []).map((x) => String(x)))
    const leave = new Set<string>((data?.calendar?.leaveDays ?? []).map((x) => String(x)))
    return { worked, leave }
  }, [data])

  const monthDays = useMemo(() => {
    const [yStr, mStr] = selectedMonth.split('-')
    const y = Number(yStr)
    const m = Number(mStr)
    if (!y || !m) return [] as Array<{ key: string; date: Date }>
    const start = new Date(y, m - 1, 1)
    const end = new Date(y, m, 0)
    const out: Array<{ key: string; date: Date }> = []
    for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
      out.push({ key: ymd(d), date: new Date(d) })
    }
    return out
  }, [selectedMonth])

  const cashAdvances = useMemo(() => (data?.payments ?? []).filter((p) => p.type === 3), [data])
  const bonuses = useMemo(() => (data?.payments ?? []).filter((p) => p.type === 2), [data])
  const salaries = useMemo(() => (data?.payments ?? []).filter((p) => p.type === 1), [data])

  return (
    <Layout>
      <div className="space-y-6">
        
        {/* Header bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-[#eae6dd] rounded-xl p-5 shadow-card">
          <div className="space-y-1">
            <h1 className="font-serif text-2xl md:text-3xl text-[#1a1a1a] font-normal tracking-tight flex items-center gap-2.5">
              <Calendar className="text-[#8c6538] w-5 h-5" />
              Çalışma Takvimi & Mali Geçmiş
            </h1>
            <p className="text-xs text-neutral-500 font-normal">
              {data?.employee?.employeeName ?? 'Yükleniyor...'} — Aylık katılım ve hakediş dökümü
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(String(e.target.value))}
              className="h-[34px] rounded-lg border border-[#eae6dd] px-3 text-xs bg-white text-[#1a1a1a] font-normal focus:outline-none focus:ring-1 focus:ring-[#c5a059] focus:border-[#c5a059]"
            />
            <button
              type="button"
              onClick={() => void load()}
              disabled={busy}
              className="btn-editorial"
            >
              <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
              <span>Yenile</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-700 font-normal">
            {error}
          </div>
        )}

        {/* Dashboard Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Calendar Grid (Span 2) */}
          <div className="lg:col-span-2 bg-white border border-[#eae6dd] rounded-xl p-6 shadow-card space-y-4">
            <div className="border-b border-[#eae6dd] pb-3 flex items-center justify-between">
              <h2 className="font-serif text-lg text-[#1a1a1a] font-normal tracking-tight">Mesai Takvimi</h2>
              <span className="badge-editorial">{selectedMonth}</span>
            </div>


            
            <div className="grid grid-cols-7 gap-2">
              {monthDays.map((d) => {
                const k = d.key
                const isLeave = dayMap.leave.has(k)
                const isWorked = dayMap.worked.has(k)

                const cls =
                  'h-14 rounded-2xl border text-xs font-bold flex flex-col items-center justify-center transition hover:scale-[1.03] ' +
                  (isLeave 
                    ? 'bg-amber-50 border-amber-200 text-amber-950 shadow-sm shadow-amber-100' 
                    : isWorked 
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-950 shadow-sm shadow-emerald-100' 
                      : 'bg-slate-50 border-slate-200 text-slate-500')

                return (
                  <div key={k} className={cls} title={k}>
                    <div className="text-[11px] font-black">{String(d.date.getDate())}</div>
                    <div className="text-[9px] mt-0.5 opacity-80">
                      {isLeave ? 'İzinli' : isWorked ? 'Çalıştı' : ''}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="pt-2 text-[10px] text-slate-500 flex items-center gap-4 border-t border-slate-100/60">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded bg-emerald-200 border border-emerald-300" />
                Çalışılan Günler ({dayMap.worked.size} Gün)
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded bg-amber-200 border border-amber-300" />
                İzinli Günler ({dayMap.leave.size} Gün)
              </div>
            </div>
          </div>

          {/* Giriş / Çıkış Günlük Kayıtları */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col h-[320px] lg:h-auto">
            <div className="border-b border-slate-100 pb-3 mb-4">
              <h2 className="text-sm font-black text-slate-800 tracking-tight uppercase flex items-center gap-2">
                <Activity size={16} className="text-sky-500" />
                Giriş / Çıkış Saatleri
              </h2>
            </div>
            
            <div className="flex-1 overflow-y-auto scrollbar-thin-dark pr-1 space-y-2">
              {(data?.checkIns ?? []).map((x) => (
                <div key={String(x.id)} className="rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5">
                  <div className="text-xs font-bold text-slate-700 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    Giriş: {formatTrDateTime(x.checkInTime)}
                  </div>
                  {x.checkOutTime && (
                    <div className="text-xs font-bold text-slate-700 flex items-center gap-2 mt-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                      Çıkış: {formatTrDateTime(x.checkOutTime)}
                    </div>
                  )}
                </div>
              ))}
              {(data?.checkIns ?? []).length === 0 && (
                <div className="text-xs text-slate-400 text-center py-8">Kayıt bulunamadı.</div>
              )}
            </div>
          </div>
        </div>

        {/* Financial Lists Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Nakit Avans */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-card flex flex-col h-[300px]">
            <div className="border-b border-slate-100 pb-3 mb-4 flex items-center justify-between">
              <h2 className="text-xs font-black text-slate-900 tracking-wider uppercase flex items-center gap-2">
                <DollarSign size={15} className="text-amber-500" />
                Nakit Avans
              </h2>
              <span className="badge-amber">DÖNEM</span>
            </div>
            
            <div className="flex-1 overflow-y-auto scrollbar-thin-dark pr-1 space-y-2">
              {cashAdvances.map((p) => (
                <div key={String(p.id)} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3.5 py-2.5 flex justify-between items-start">
                  <div className="space-y-0.5">
                    <div className="text-[11px] font-bold text-slate-500">{formatTrDate(p.paymentDate)}</div>
                    <div className="text-[11px] text-slate-700 font-medium truncate max-w-[140px]">{String(p.description ?? '')}</div>
                  </div>
                  <div className="text-xs font-black text-slate-900">{moneyTRY(p.amount)} ₺</div>
                </div>
              ))}
              {cashAdvances.length === 0 && (
                <div className="text-xs text-slate-400 text-center py-10 font-medium">Kayıt bulunamadı.</div>
              )}
            </div>
          </div>

          {/* Prim Bilgileri */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-card flex flex-col h-[300px]">
            <div className="border-b border-slate-100 pb-3 mb-4 flex items-center justify-between">
              <h2 className="text-xs font-black text-slate-900 tracking-wider uppercase flex items-center gap-2">
                <Award size={15} className="text-emerald-500" />
                Prim Bilgileri
              </h2>
              <span className="badge-emerald">HAK EDİŞ</span>
            </div>
            
            <div className="flex-1 overflow-y-auto scrollbar-thin-dark pr-1 space-y-2">
              {bonuses.map((p) => (
                <div key={String(p.id)} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3.5 py-2.5 flex justify-between items-start">
                  <div className="space-y-0.5">
                    <div className="text-[11px] font-bold text-slate-500">{formatTrDate(p.paymentDate)}</div>
                    <div className="text-[11px] text-slate-700 font-medium truncate max-w-[140px]">{String(p.description ?? '')}</div>
                  </div>
                  <div className="text-xs font-black text-emerald-600">+{moneyTRY(p.amount)} ₺</div>
                </div>
              ))}
              {bonuses.length === 0 && (
                <div className="text-xs text-slate-400 text-center py-10 font-medium">Kayıt bulunamadı.</div>
              )}
            </div>
          </div>

          {/* Maaş Ödemeleri */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-card flex flex-col h-[300px]">
            <div className="border-b border-slate-100 pb-3 mb-4 flex items-center justify-between">
              <h2 className="text-xs font-black text-slate-900 tracking-wider uppercase flex items-center gap-2">
                <TrendingUp size={15} className="text-blue-600" />
                Maaş Ödemeleri
              </h2>
              <span className="badge-navy">NET MAAŞ</span>
            </div>
            
            <div className="flex-1 overflow-y-auto scrollbar-thin-dark pr-1 space-y-2">
              {salaries.map((p) => (
                <div key={String(p.id)} className="rounded-xl border border-slate-100 bg-slate-50/70 px-3.5 py-2.5 flex justify-between items-start">
                  <div className="space-y-0.5">
                    <div className="text-[11px] font-bold text-slate-500">{formatTrDate(p.paymentDate)}</div>
                    <div className="text-[11px] text-slate-700 font-medium truncate max-w-[140px]">{String(p.description ?? '')}</div>
                  </div>
                  <div className="text-xs font-black text-slate-900">{moneyTRY(p.amount)} ₺</div>
                </div>
              ))}
              {salaries.length === 0 && (
                <div className="text-xs text-slate-400 text-center py-10 font-medium">Kayıt bulunamadı.</div>
              )}
            </div>
          </div>

        </div>

        {popup && (
          <NotificationPopup
            isOpen={true}
            variant={popup.variant}
            title={popup.title}
            message={popup.message}
            onClose={() => setPopup(null)}
          />
        )}
      </div>
    </Layout>
  )
}
