import React, { useEffect, useMemo, useState } from 'react'
import Layout from '../components/Layout'
import { fetchEmployees, type EmployeeDto } from '../api/employees'
import { fetchEmployeePayments, fetchSalaryStatus, fetchSalaryOverdue, type SalaryStatusReportDto, type SalaryOverdueDto } from '../api/employeePayments'
import { fetchTodayAttendance } from '../api/employeeCheckIns'
import { fetchAccruals, type AccrualSummaryDto } from '../api/employeeAccruals'
import { fetchCashAccountSummary, type CashAccountSummaryDto } from '../api/employeeLedger'
import { money } from '../components/PaymentReportView'
import { Download, RefreshCw, Wallet, DollarSign, UtensilsCrossed, Award, HandCoins, AlertTriangle, Building2, CheckCircle2 } from 'lucide-react'
import AyarliTablo from '../components/table/AyarliTablo'

export default function DashboardPage() {
  const [employees, setEmployees] = useState<EmployeeDto[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [atWorkIds, setAtWorkIds] = useState<Set<number>>(new Set())
  const [accrualSummary, setAccrualSummary] = useState<AccrualSummaryDto | null>(null)
  const [salaryReport, setSalaryReport] = useState<SalaryStatusReportDto | null>(null)
  const [overdue, setOverdue] = useState<SalaryOverdueDto | null>(null)
  const [cashSummary, setCashSummary] = useState<CashAccountSummaryDto | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastUpdatedTime, setLastUpdatedTime] = useState<string | null>(null)

  const currentMonthName = useMemo(() => {
    return new Date().toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const now = new Date()
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

      const [empList, payList, today, accruals, salRep, cash, overdueRep] = await Promise.all([
        fetchEmployees({ includeInactive: true }),
        fetchEmployeePayments({ take: 1000 }),
        fetchTodayAttendance().catch(() => null),
        fetchAccruals(period).catch(() => null),
        fetchSalaryStatus(period).catch(() => null),
        fetchCashAccountSummary().catch(() => null),
        fetchSalaryOverdue(6).catch(() => null)
      ])

      setEmployees(empList)
      setPayments(payList)
      setAtWorkIds(new Set(today?.atWorkEmployeeIds ?? []))
      setAccrualSummary(accruals?.summary ?? null)
      setSalaryReport(salRep)
      setCashSummary(cash)
      setOverdue(overdueRep)
      setLastUpdatedTime(now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }


  useEffect(() => {
    void loadData()
  }, [])

  const activeCount = useMemo(() => employees.filter(e => e.isActive).length, [employees])
  const inactiveCount = useMemo(() => employees.filter(e => !e.isActive).length, [employees])

  const isAtWorkNow = (empId: number) => atWorkIds.has(empId)

  const workNowCounts = useMemo(() => {
    const list = employees.filter((e) => e.isActive)
    const at = list.filter((e) => atWorkIds.has(e.id)).length
    return { at, notAt: list.length - at }
  }, [employees, atWorkIds])

  const presentRate = useMemo(() => {
    if (activeCount === 0) return 0
    return Math.round((workNowCounts.at / activeCount) * 100)
  }, [workNowCounts.at, activeCount])

  const totalSalaryExpense = useMemo(() => {
    return employees.filter(e => e.isActive).reduce((sum, e) => sum + Number(e.salary ?? 0), 0)
  }, [employees])

  const workDaysInCurrentMonth = useMemo(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    let workDaysCount = 0
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day)
      if (date.getDay() !== 0) {
        workDaysCount++
      }
    }
    return workDaysCount
  }, [])

  // Yemek gideri, ayin TUM is gunleriyle carpiliyordu; gelmeyen gunler de gider sayiliyordu.
  // Hakedis ucu fiilen ise gelinen gun sayisini kullanir; o deger yoksa tahmine dusulur.
  const totalMealExpense = useMemo(() => {
    if (accrualSummary?.totalMeal != null) return Number(accrualSummary.totalMeal) || 0
    return employees.filter(e => e.isActive).reduce((sum, e) => sum + Number(e.mealAmount ?? 0) * workDaysInCurrentMonth, 0)
  }, [employees, workDaysInCurrentMonth, accrualSummary])

  const totalExpenseOverhead = useMemo(() => totalSalaryExpense + totalMealExpense, [totalSalaryExpense, totalMealExpense])

  const formatShortCurrency = (val: number) => {
    if (val >= 1000000) {
      const m = (val / 1000000).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      return `₺ ${m} M`
    }
    if (val >= 1000) {
      const k = (val / 1000).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      return `₺ ${k} B`
    }
    return `₺ ${val.toLocaleString('tr-TR')}`
  }

  // Work type distribution
  const workTypeDistribution = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of employees.filter(e => e.isActive)) {
      const t = String(e.workType ?? '').trim() || 'Tam zamanlı'
      counts[t] = (counts[t] ?? 0) + 1
    }
    if (Object.keys(counts).length === 0) {
      return [
        { name: 'Tam zamanlı', count: 0, percent: 0 },
        { name: 'Vardiyalı', count: 0, percent: 0 },
        { name: 'Yarı zamanlı', count: 0, percent: 0 }
      ]
    }
    const maxVal = Math.max(...Object.values(counts), 1)
    return Object.entries(counts).map(([name, count]) => ({
      name,
      count,
      percent: Math.round((count / maxVal) * 100)
    }))
  }, [employees])

  // MAAŞ ÖDEME DURUMU (2026-10-16): maaş ekranıyla AYNI dönem hesabından gelir.
  //
  // Eskiden "ödendi" = bu takvim ayında TARİHLİ bir maaş ödemesi var mı diye bakılıyor, tutar
  // olarak sözleşme maaşı yazılıyordu. Eylülde ödenen ağustos maaşı eylülü "ödendi" gösteriyor,
  // ekimin ilk günlerinde herkes "yatırılmadı" görünüyor, gerçekten geciken geçen ayın maaşı ise
  // hiçbir yerde çıkmıyordu. Artık: sol kart her personelin vadesi gelmiş SON dönemi, sağ liste
  // vadesi geçmiş ve kalanı olan bütün dönemler (son 6 ay).
  const salaryStatus = useMemo(() => {
    const s = overdue?.summary
    const net = Number(s?.lastDueNet ?? 0)
    const paid = Number(s?.lastDuePaid ?? 0)
    return {
      paidCount: Number(s?.lastDuePaidCount ?? 0),
      unpaidCount: Number(s?.lastDueUnpaidCount ?? 0),
      totalPaidSalary: paid,
      totalUnpaidSalary: Number(s?.lastDueRemaining ?? 0),
      totalNet: net,
      percentPaid: net > 0 ? Math.round((paid / net) * 100) : 0,
      overdueRows: overdue?.data ?? [],
      overdueTotal: Number(s?.overdueTotal ?? 0)
    }
  }, [overdue])

  // Approaching permit/salary renewals
  const approachingRenewals = useMemo(() => {
    const list = employees.filter(e => e.isActive && e.workPermitDay)
    const mapped = list.map(emp => {
      const dateStr = emp.workPermitDay!
      const d = new Date(dateStr)
      
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      const target = new Date(d)
      target.setHours(0, 0, 0, 0)
      
      const diffTime = target.getTime() - today.getTime()
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      
      return {
        employee: emp,
        dateStr,
        diffDays,
        renewalFee: emp.workPermitRenewalFee ?? 0
      }
    })

    return mapped.sort((a, b) => a.diffDays - b.diffDays)
  }, [employees])

  // Bu kart daha once sabit rakamlar gosteriyordu: "Yol/servis 54.200", "Fazla mesai 27.600"
  // ve "gecen aya gore %3,1 artis". Hicbiri veriden gelmiyordu; ilerleme cubuklari da sabitti.
  // Artik yalnizca gercekten hesaplanan kalemler listelenir.
  const costBreakdown = useMemo(() => {
    const items = [
      { label: 'Net maaş', value: totalSalaryExpense },
      { label: 'Yemek', value: totalMealExpense },
      { label: 'Fazla mesai', value: Number(accrualSummary?.totalOvertimePay ?? 0) }
    ].filter((x) => x.value > 0)

    const max = Math.max(...items.map((x) => x.value), 1)
    return items.map((x) => ({ ...x, percent: Math.round((x.value / max) * 100) }))
  }, [totalSalaryExpense, totalMealExpense, accrualSummary])

  const totalCost = useMemo(
    () => costBreakdown.reduce((sum, x) => sum + x.value, 0),
    [costBreakdown]
  )

  const formatTurkishDate = (isoString: string | null | undefined) => {
    if (!isoString) return '-'
    const d = new Date(isoString)
    if (Number.isNaN(d.getTime())) return String(isoString)
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  return (
    <Layout>
      <div className="space-y-6 pb-12">
        {/* --- Top Header Title & Meta Bar --- */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pt-2">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[10px] tracking-[0.22em] text-[#8c6538] font-semibold uppercase">
              <span>CANLI</span>
              <span className="text-[#d7c09e]">•</span>
              <span>{lastUpdatedTime ? `${lastUpdatedTime} GÜNCELLENDİ` : 'YÜKLENİYOR'}</span>
            </div>
            <h1 className="font-serif text-3xl md:text-4xl text-[#1a1a1a] font-normal tracking-tight">
              Dashboard & Genel Analiz
            </h1>
            <p className="text-xs text-neutral-500 font-normal">
              Personel durumu, mesai katılımı ve mali özet — {currentMonthName} dönemi.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => void loadData()}
              className="btn-editorial"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              <span>Verileri yenile</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="btn-editorial"
            >
              <Download size={12} />
              <span>Rapor indir</span>
            </button>
          </div>
        </div>
        {/* --- 8 Finansal Özet Kartı --- */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <Building2 className="text-blue-600" size={16} />
              {currentMonthName} Personel Finans & Kasa Özeti
            </h2>
            <span className="text-[11px] font-bold text-slate-400">Canlı Sistem</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {/* 1. Bu Ay Toplam Maaş */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="text-[10px] font-bold uppercase text-slate-500">Bu Ay Toplam Maaş</div>
              <div className="text-sm md:text-base font-black text-slate-900 mt-1">
                {money(salaryReport?.summary.totalGross ?? totalSalaryExpense)}
              </div>
            </div>

            {/* 2. Ödenen Maaş */}
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
              <div className="text-[10px] font-bold uppercase text-emerald-700">Ödenen Maaş</div>
              <div className="text-sm md:text-base font-black text-emerald-800 mt-1">
                {money(salaryReport?.summary.totalPaid ?? 0)}
              </div>
            </div>

            {/* 3. Kalan Maaş */}
            <div className="p-3 bg-rose-50 rounded-xl border border-rose-200">
              <div className="text-[10px] font-bold uppercase text-rose-700">Kalan Maaş</div>
              <div className="text-sm md:text-base font-black text-rose-800 mt-1">
                {money(Math.max(0, (salaryReport?.summary.totalNetPayable ?? 0) - (salaryReport?.summary.totalPaid ?? 0)))}
              </div>
            </div>

            {/* 4. Yemek Hakedişi */}
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
              <div className="text-[10px] font-bold uppercase text-amber-800">Yemek Hakedişi</div>
              <div className="text-sm md:text-base font-black text-amber-900 mt-1">
                {money(accrualSummary?.totalMeal ?? totalMealExpense)}
              </div>
            </div>

            {/* 5. Toplam Prim */}
            <div className="p-3 bg-purple-50 rounded-xl border border-purple-200">
              <div className="text-[10px] font-bold uppercase text-purple-700">Toplam Prim</div>
              <div className="text-sm md:text-base font-black text-purple-900 mt-1">
                {money(payments.filter((p) => Number(p?.type) === 2 || p?.kind === 'bonus').reduce((s, p) => s + Number(p.amount ?? 0), 0))}
              </div>
            </div>

            {/* 6. Toplam Avans */}
            <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-200">
              <div className="text-[10px] font-bold uppercase text-indigo-700">Toplam Avans</div>
              <div className="text-sm md:text-base font-black text-indigo-900 mt-1">
                {money(salaryReport?.summary.totalAdvances ?? 0)}
              </div>
            </div>

            {/* 7. Gecikenler */}
            <div className="p-3 bg-red-50 rounded-xl border border-red-200">
              <div className="text-[10px] font-bold uppercase text-red-700">Geciken Maaş</div>
              <div className="text-sm md:text-base font-black text-red-800 mt-1">
                {salaryStatus.overdueRows.length} Kişi
              </div>
            </div>

            {/* 8. Kasa Bakiyesi */}
            <div className="p-3 bg-blue-50 rounded-xl border border-blue-200">
              <div className="text-[10px] font-bold uppercase text-blue-700">Kasa Bakiyesi</div>
              <div className="text-sm md:text-base font-black text-blue-900 mt-1">
                {money(cashSummary?.balance ?? 0)}
              </div>
            </div>
          </div>
        </div>

        {/* --- Top 4 Metric KPI Cards --- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

          {/* 1. TOPLAM ÇALIŞAN */}
          <div className="bg-white border border-[#eae6dd] rounded-xl p-5 shadow-card hover:border-[#d7c09e] transition-colors">
            <div className="text-[10px] text-neutral-400 font-medium tracking-[0.2em] uppercase">
              TOPLAM ÇALIŞAN
            </div>
            <div className="font-serif text-3xl md:text-4xl text-[#1a1a1a] font-normal my-1.5 tracking-tight">
              {activeCount}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
              <span className="w-1.5 h-1.5 rounded-full bg-[#d7c09e]" />
              <span>{inactiveCount} pasif / ayrılan</span>
            </div>
          </div>

          {/* 2. BUGÜN İŞBAŞI */}
          <div className="bg-white border border-[#eae6dd] rounded-xl p-5 shadow-card hover:border-[#d7c09e] transition-colors">
            <div className="text-[10px] text-neutral-400 font-medium tracking-[0.2em] uppercase">
              BUGÜN İŞBAŞI
            </div>
            <div className="font-serif text-3xl md:text-4xl text-[#1a1a1a] font-normal my-1.5 tracking-tight flex items-baseline gap-1.5">
              <span>{workNowCounts.at}</span>
              <span className="text-base text-neutral-400 font-normal">/ {activeCount}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>%{presentRate} katılım oranı</span>
            </div>
          </div>

          {/* 3. MAAŞ BÜTÇESİ */}
          <div className="bg-white border border-[#eae6dd] rounded-xl p-5 shadow-card hover:border-[#d7c09e] transition-colors">
            <div className="text-[10px] text-neutral-400 font-medium tracking-[0.2em] uppercase">
              MAAŞ BÜTÇESİ
            </div>
            <div className="font-serif text-2xl md:text-3xl text-[#1a1a1a] font-normal my-1.5 tracking-tight">
              {formatShortCurrency(totalSalaryExpense)}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
              <span className="w-1.5 h-1.5 rounded-full bg-[#c5a059]" />
              <span>aylık net maaş gideri</span>
            </div>
          </div>

          {/* 4. YEMEK BÜTÇESİ */}
          <div className="bg-white border border-[#eae6dd] rounded-xl p-5 shadow-card hover:border-[#d7c09e] transition-colors">
            <div className="text-[10px] text-neutral-400 font-medium tracking-[0.2em] uppercase">
              YEMEK BÜTÇESİ
            </div>
            <div className="font-serif text-2xl md:text-3xl text-[#1a1a1a] font-normal my-1.5 tracking-tight">
              {formatShortCurrency(totalMealExpense)}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
              <span className="w-1.5 h-1.5 rounded-full bg-[#c5a059]" />
              <span>aylık tahmini yemek</span>
            </div>
          </div>
        </div>

        {/* --- Middle Row: Maaş Ödeme Durumu & Maaşı Yatırılmayanlar --- */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Maaş Ödeme Durumu */}
          <div className="bg-white border border-[#eae6dd] rounded-xl p-6 shadow-card flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-start justify-between border-b border-[#eae6dd] pb-3.5">
                <div>
                  <h2 className="font-serif text-xl text-[#1a1a1a] font-normal tracking-tight">
                    Maaş ödeme durumu
                  </h2>
                  <p className="text-xs text-neutral-400 font-serif italic mt-0.5">
                    Vadesi gelmiş son dönem
                  </p>
                </div>
                <span className="badge-editorial">SON VADE</span>
              </div>

              <div className="space-y-3 pt-1 text-xs">
                <div className="flex items-center justify-between py-1 border-b border-[#f5f4ee]">
                  <span className="text-neutral-600 font-normal">Yatırılan maaşlar</span>
                  <span className="font-serif font-medium text-sm text-[#1a1a1a]">
                    ₺ {salaryStatus.totalPaidSalary.toLocaleString('tr-TR')}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1 border-b border-[#f5f4ee]">
                  <span className="text-neutral-600 font-normal">Kalan ödeme</span>
                  <span className="font-serif font-medium text-sm text-[#1a1a1a]">
                    ₺ {salaryStatus.totalUnpaidSalary.toLocaleString('tr-TR')}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1">
                  <span className="text-neutral-600 font-normal">Toplam bütçe</span>
                  <span className="font-serif font-medium text-sm text-[#1a1a1a]">
                    ₺ {salaryStatus.totalNet.toLocaleString('tr-TR')}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="space-y-2 pt-3">
                  <div className="flex justify-between items-center text-[10px] font-medium text-neutral-400 uppercase tracking-widest">
                    <span>TAMAMLANMA ORANI</span>
                    <span className="font-serif text-sm text-[#8c6538]">%{salaryStatus.percentPaid}</span>
                  </div>
                  <div className="w-full h-1 bg-[#edeae1] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#b88e53] rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${salaryStatus.percentPaid}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom 2 columns */}
            <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-[#eae6dd]">
              <div>
                <span className="text-[10px] font-medium text-neutral-400 tracking-[0.2em] uppercase block">
                  YATIRILAN
                </span>
                <span className="font-serif text-3xl text-[#1a1a1a] font-normal block mt-1">
                  {salaryStatus.paidCount}
                </span>
              </div>
              <div className="border-l border-[#eae6dd] pl-4">
                <span className="text-[10px] font-medium text-neutral-400 tracking-[0.2em] uppercase block">
                  YATIRILMAYAN
                </span>
                <span className="font-serif text-3xl text-[#1a1a1a] font-normal block mt-1">
                  {salaryStatus.unpaidCount}
                </span>
              </div>
            </div>
          </div>

          {/* Right (Span 2): Maaşı Yatırılmayan Çalışanlar */}
          <div className="bg-white border border-[#eae6dd] rounded-xl p-6 shadow-card lg:col-span-2 flex flex-col justify-between">
            <div>
              <div className="flex items-start justify-between border-b border-[#eae6dd] pb-3.5 mb-4">
                <div>
                  <h2 className="font-serif text-xl text-[#1a1a1a] font-normal tracking-tight">
                    Maaşı yatırılmayan çalışanlar
                  </h2>
                  <p className="text-xs text-neutral-400 font-serif italic mt-0.5">
                    Vadesi (maaş günü) geçmiş, kalanı ödenmemiş dönemler
                  </p>
                </div>
                <span className="badge-editorial">
                  {salaryStatus.overdueRows.length} PERSONEL
                </span>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <AyarliTablo>
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#eae6dd] text-[10px] font-medium text-neutral-400 tracking-wider uppercase">
                      <th className="pb-2.5 font-normal">PERSONEL</th>
                      <th className="pb-2.5 font-normal">İŞYERİ</th>
                      <th className="pb-2.5 font-normal">KALAN</th>
                      <th className="pb-2.5 font-normal">VADE</th>
                      <th className="pb-2.5 font-normal text-right">DÖNEM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f5f4ee]">
                    {salaryStatus.overdueRows.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-xs text-neutral-400 font-serif italic">
                          Vadesi geçmiş ödenmemiş maaş bulunmamaktadır.
                        </td>
                      </tr>
                    ) : (
                      salaryStatus.overdueRows.slice(0, 8).map((row) => (
                        <tr key={row.employeeId} className="hover:bg-[#faf9f6] transition-colors">
                          <td className="py-2.5 font-medium text-[#1a1a1a]">{row.employeeName}</td>
                          <td className="py-2.5 text-neutral-500 font-normal">{row.workplace || '—'}</td>
                          <td className="py-2.5 font-serif font-medium text-xs text-[#1a1a1a]">
                            ₺ {Number(row.totalRemaining ?? 0).toLocaleString('tr-TR')}
                          </td>
                          <td className="py-2.5 text-neutral-500 font-normal">
                            {formatTurkishDate(row.periods[0]?.dueDate)}
                          </td>
                          <td className="py-2.5 text-right">
                            <span className="px-2 py-0.5 border border-rose-300 text-rose-700 bg-rose-50/60 text-[9px] font-medium tracking-widest uppercase rounded">
                              GECİKTİ · {row.periods.map((p) => p.period).join(', ')}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                </AyarliTablo>
              </div>
            </div>

            {/* Footer with summary note and CTA button */}
            <div className="mt-5 pt-3.5 border-t border-[#eae6dd] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span className="text-[11px] text-neutral-500 font-serif italic">
                Toplam geciken tutar ₺ {salaryStatus.overdueTotal.toLocaleString('tr-TR')}
                {overdue ? ` — ${overdue.fromPeriod} / ${overdue.toPeriod} dönemleri tarandı.` : ''}
              </span>
              <button
                type="button"
                onClick={() => { window.location.href = '/employees' }}
                className="btn-editorial-bronze text-xs shrink-0 self-start sm:self-auto"
              >
                Tümünü ödemeye al
              </button>
            </div>
          </div>
        </div>

        {/* --- Bottom Row: Çalışma İzni & Dağılımlar --- */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Çalışma İzni / Sözleşme Yenilemeleri */}
          <div className="bg-white border border-[#eae6dd] rounded-xl p-6 shadow-card flex flex-col justify-between">
            <div>
              <div className="flex items-start justify-between border-b border-[#eae6dd] pb-3.5 mb-4">
                <div>
                  <h2 className="font-serif text-xl text-[#1a1a1a] font-normal tracking-tight">
                    Çalışma izni / sözleşme yenilemeleri
                  </h2>
                  <p className="text-xs text-neutral-400 font-serif italic mt-0.5">
                    Yenileme tarihi yaklaşan personel
                  </p>
                </div>
                <span className="badge-editorial">
                  {approachingRenewals.length} KAYIT
                </span>
              </div>

              <div className="space-y-2 divide-y divide-[#f5f4ee]">
                {approachingRenewals.length === 0 ? (
                  <div className="py-8 text-center text-xs text-neutral-400 font-serif italic">
                    Yenileme tarihi yaklaşan kayıt bulunmamaktadır.
                  </div>
                ) : (
                  approachingRenewals.slice(0, 5).map(({ employee, dateStr, diffDays }) => (
                    <div key={employee.id} className="pt-2.5 pb-1 flex items-center justify-between gap-3 hover:bg-[#faf9f6] transition-colors rounded px-1">
                      <div>
                        <div className="text-xs font-medium text-[#1a1a1a]">
                          {employee.firstName} {employee.lastName}
                        </div>
                        <div className="text-[11px] text-neutral-400 font-normal">
                          {employee.workType || 'Personel'}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xs text-neutral-500 font-normal">
                          {formatTurkishDate(dateStr)}
                        </span>
                        <span className="px-2 py-0.5 border border-[#c5a059]/70 text-[#8c6538] bg-[#faf7f2]/60 text-[9px] font-medium tracking-wider uppercase rounded">
                          {diffDays} GÜN
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Right: Çalışma Tipleri Dağılımı & Gider Dağılımı */}
          <div className="space-y-6">
            {/* Top: Çalışma tipleri dağılımı */}
            <div className="bg-white border border-[#eae6dd] rounded-xl p-6 shadow-card space-y-4">
              <div className="flex items-start justify-between border-b border-[#eae6dd] pb-3">
                <h2 className="font-serif text-lg text-[#1a1a1a] font-normal tracking-tight">
                  Çalışma tipleri dağılımı
                </h2>
                <span className="badge-editorial">AKTİF</span>
              </div>

              <div className="space-y-3 pt-1">
                {workTypeDistribution.map((item) => (
                  <div key={item.name} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-normal">
                      <span className="text-neutral-700">{item.name}</span>
                      <span className="font-serif text-sm text-[#1a1a1a] font-medium">{item.count}</span>
                    </div>
                    <div className="w-full h-1 bg-[#edeae1] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#b88e53] rounded-full transition-all duration-500"
                        style={{ width: `${item.percent}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom: Gider Dağılımı */}
            <div className="bg-white border border-[#eae6dd] rounded-xl p-6 shadow-card space-y-4">
              <div className="flex items-start justify-between border-b border-[#eae6dd] pb-3">
                <h2 className="font-serif text-lg text-[#1a1a1a] font-normal tracking-tight">
                  Gider dağılımı
                </h2>
                <span className="badge-editorial">AYLIK</span>
              </div>

              <div className="space-y-3 pt-1">
                {costBreakdown.map((item) => (
                  <div key={item.label} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-normal">
                      <span className="text-neutral-700">{item.label}</span>
                      <span className="font-serif text-xs text-[#1a1a1a] font-medium">
                        ₺ {item.value.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                    <div className="w-full h-1 bg-[#edeae1] rounded-full overflow-hidden">
                      <div className="h-full bg-[#b88e53] rounded-full" style={{ width: `${item.percent}%` }} />
                    </div>
                  </div>
                ))}

                {costBreakdown.length === 0 && (
                  <p className="text-[11px] text-neutral-400 font-serif italic py-4 text-center">
                    Bu dönem için hesaplanmış gider yok.
                  </p>
                )}
              </div>

              <div className="pt-2 border-t border-[#eae6dd]">
                <p className="text-[11px] text-neutral-500 font-serif italic">
                  Toplam aylık gider ₺ {totalCost.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                  {accrualSummary ? ' — dönem hakedişlerinden hesaplandı.' : ' — tahmini değerler.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}


