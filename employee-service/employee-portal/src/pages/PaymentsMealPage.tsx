import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  UtensilsCrossed,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  CheckSquare,
  Square,
  Scale,
  DollarSign,
  Edit3,
  Percent,
  Calendar
} from 'lucide-react'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import AccrualDayDetailModal from '../components/AccrualDayDetailModal'
import { money } from '../components/PaymentReportView'
import { fetchAccruals, refreshAccruals, saveMonthlyOverride, defineMealAccrual, type AccrualDto } from '../api/employeeAccruals'
import { deleteEmployeeMealPlan } from '../api/employeeMealPlans'
import { fetchPaymentReport, createEmployeePayment, fetchMealStatus, PAYMENT_TYPE } from '../api/employeePayments'
import { bulkCashPayout } from '../api/employeeLedger'
import ErpSourcePicker, { erpSourceError } from '../components/ErpSourcePicker'
import type { ErpPaymentSource } from '../api/employeePayments'
import AyarliTablo from '../components/table/AyarliTablo'

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtTimestamp(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  const hours = String(d.getHours()).padStart(2, '0')
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${day}.${month}.${year} ${hours}:${mins}`
}

type MealRowItem = {
  employeeId: number
  employeeCode: string
  employeeName: string
  attendedDays: number
  calculatedMeal: number
  hasMealOverride: boolean
  mealOverrideAmount?: number | null
  mealOverrideDescription?: string | null
  effectiveMeal: number
  paidAmount: number
  remainingAmount: number
  /** Hakediş tanımlandı mı? False ise gösterilen tutar yalnızca ÖNERİdir, ekstreye girmez. */
  accrualDefined: boolean
  isPaid: boolean
  isPartial: boolean
  /** accrualMissing = hakediş tanımsız (kırmızı), accrued = tanımlı (yeşil). */
  status: 'paid' | 'partial' | 'pending' | 'accrued' | 'accrualMissing'
}

export default function PaymentsMealPage() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState(currentPeriod)
  const [accruals, setAccruals] = useState<AccrualDto[]>([])
  const [lastCalculatedAt, setLastCalculatedAt] = useState<string | null>(null)
  const [paidMap, setPaidMap] = useState<Record<number, number>>({})
  /** Hangi personelin bu dönem yemek hakedişi TANIMLANMIŞ (EmployeeMealPlans kaydı var). */
  const [definedMap, setDefinedMap] = useState<Record<number, boolean>>({})
  const [defineProcessing, setDefineProcessing] = useState(false)
  /** meal-status ucundan gelen hakedis tutari — ekranda gosterilen tek dogru kaynak. */
  const [statusAccrualMap, setStatusAccrualMap] = useState<Record<number, number>>({})
  /** Tanımlı yemek hakedişinin plan kimliği — geri alma için. */
  const [planIdMap, setPlanIdMap] = useState<Record<number, number>>({})
  // Gün gün yemek hakedişi dökümü — maaştaki ekranın aynısı.
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailTarget, setDetailTarget] = useState<MealRowItem | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Multi select
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // Single Pay Modal
  const [singlePayModalOpen, setSinglePayModalOpen] = useState(false)
  const [targetItem, setTargetItem] = useState<MealRowItem | null>(null)
  const [singlePayAmount, setSinglePayAmount] = useState('')
  const [singlePayDesc, setSinglePayDesc] = useState('')
  // Ödemenin çıkacağı B2B kasa/bankası (tekil ve toplu pencerede ortak; son seçim hatırlanır).
  const [erpSource, setErpSource] = useState<ErpPaymentSource | null>(null)
  const [singlePayDate, setSinglePayDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [singleProcessing, setSingleProcessing] = useState(false)

  // Bulk Pay Modal
  const [bulkPayModalOpen, setBulkPayModalOpen] = useState(false)
  const [bulkPayDate, setBulkPayDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [bulkPayDesc, setBulkPayDesc] = useState('Yemek Toplu Ödemesi')
  const [bulkProcessing, setBulkProcessing] = useState(false)

  // Meal Override Modal
  const [overrideModalOpen, setOverrideModalOpen] = useState(false)
  const [overrideItem, setOverrideItem] = useState<MealRowItem | null>(null)
  const [overrideAmount, setOverrideAmount] = useState('')
  const [overrideDesc, setOverrideDesc] = useState('')
  const [overrideProcessing, setOverrideProcessing] = useState(false)

  // Notification Popup
  const [popupOpen, setPopupOpen] = useState(false)
  const [popupVariant, setPopupVariant] = useState<NotificationVariant>('info')
  const [popupTitle, setPopupTitle] = useState('')
  const [popupMessage, setPopupMessage] = useState('')

  const showPopup = (variant: NotificationVariant, title: string, message: string) => {
    setPopupVariant(variant)
    setPopupTitle(title)
    setPopupMessage(message)
    setPopupOpen(true)
  }

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const [accRes, payRes] = await Promise.all([
        fetchAccruals(period, { signal }),
        fetchPaymentReport({ type: PAYMENT_TYPE.meal, period, signal })
      ])

      setAccruals(accRes.data)
      setLastCalculatedAt(accRes.lastCalculatedAt || null)

      const map: Record<number, number> = {}
      payRes.rows.forEach((p) => {
        map[p.employeeId] = (map[p.employeeId] || 0) + p.amount
      })
      setPaidMap(map)

      // TEK KAYNAK: ekranda gorunen hakedis ile "Hakedis Tanimla"nin yazdigi tutar ayni
      // ucdan gelmeli. Bir sure ekran fetchAccruals'in MealAccrual'ini gosteriyor, tanimlama
      // ise kist oneriyi yaziyordu; giris/cikis kaydi olmayan personelde ekran 0 gosterip
      // tanimlamada baska bir tutar olusuyordu.
      try {
        const ms = await fetchMealStatus(period, { signal })
        const dm: Record<number, boolean> = {}
        const am: Record<number, number> = {}
        const pm: Record<number, number> = {}
        ms.data.forEach((x) => {
          dm[x.employeeId] = !!x.accrualDefined
          am[x.employeeId] = x.mealAccrual
          if (x.planId) pm[x.employeeId] = x.planId
        })
        setDefinedMap(dm)
        setStatusAccrualMap(am)
        setPlanIdMap(pm)
      } catch {
        setDefinedMap({})
        setStatusAccrualMap({})
        setPlanIdMap({})
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(String(e?.message ?? 'Yemek hakedişleri yüklenemedi'))
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    const ac = new AbortController()
    void loadData(ac.signal)
    return () => ac.abort()
  }, [loadData])

  const handleRefreshAccruals = async () => {
    setRefreshing(true)
    try {
      const res = await refreshAccruals(period)
      setLastCalculatedAt(res.lastCalculatedAt || new Date().toISOString())
      await loadData()
      showPopup('success', 'Hakediş Güncellendi', `${period} dönemi yemek hakediş snapshot'ı bugünün giriş-çıkış kayıtlarıyla tazelendi.`)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Hakediş yenilenemedi'))
    } finally {
      setRefreshing(false)
    }
  }

  /** Yemek hakedişini tanımlar — cari ekstreye alacak yazan işlem budur. Ödeme ayrı adımdır. */
  const handleDefineMeal = async (row: MealRowItem) => {
    setDefineProcessing(true)
    try {
      const res = await defineMealAccrual({
        employeeIds: [row.employeeId],
        period,
        amounts: row.hasMealOverride && row.mealOverrideAmount != null
          ? { [row.employeeId]: row.mealOverrideAmount }
          : undefined,
        description: `${period} dönemi yemek hakedişi`
      })
      await loadData()
      showPopup(
        res.definedCount > 0 ? 'success' : 'error',
        res.definedCount > 0 ? 'Yemek Hakedişi Tanımlandı' : 'Tanımlanamadı',
        res.definedCount > 0
          ? `${row.employeeName} için ${period} dönemi yemek hakedişi cari ekstreye alacak olarak işlendi.`
          : `${row.employeeName}: ${res.skipped.join(', ') || 'tutar sıfır'}.`
      )
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Yemek hakedişi tanımlanamadı'))
    } finally {
      setDefineProcessing(false)
    }
  }

  /** Tanımlanmış yemek hakedişini geri alır — cari ekstredeki alacak satırı da düşer. */
  const handleUndoMeal = async (row: MealRowItem) => {
    const planId = planIdMap[row.employeeId]
    if (!planId) {
      showPopup('error', 'Geri Alınamadı', 'Hakediş kaydının kimliği alınamadı. Sayfayı yenileyip tekrar deneyin.')
      return
    }
    if (row.paidAmount > 0) {
      showPopup('error', 'Geri Alınamaz', `${row.employeeName} için bu dönemde ödeme yapılmış. Önce ödemeyi cari ekstreden geri alın.`)
      return
    }
    if (!window.confirm(`${row.employeeName} için ${period} dönemi yemek hakedişi geri alınsın mı? Cari ekstredeki alacak satırı da kalkacak.`)) return

    setDefineProcessing(true)
    try {
      await deleteEmployeeMealPlan(planId)
      await loadData()
      showPopup('success', 'Hakediş Geri Alındı', `${row.employeeName} için ${period} dönemi yemek hakedişi kaldırıldı.`)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Geri alınamadı'))
    } finally {
      setDefineProcessing(false)
    }
  }

  const rows: MealRowItem[] = useMemo(() => {
    return accruals.map((a) => {
      // Oncelik: meal-status (tanimli plan > override > motor > kist oneri).
      // Yalnizca uc henuz yuklenmediyse yerel hesaba dusulur.
      const fromStatus = statusAccrualMap[a.employeeId]
      const effectiveMeal = fromStatus != null
        ? fromStatus
        : a.hasMealOverride && a.mealOverrideAmount != null
          ? a.mealOverrideAmount
          : a.mealAccrual
      const paid = paidMap[a.employeeId] || 0
      const remaining = Math.max(0, effectiveMeal - paid)
      const isPaid = paid > 0 && paid >= effectiveMeal
      const isPartial = paid > 0 && paid < effectiveMeal
      const accrualDefined = !!definedMap[a.employeeId]
      // Renk kurali maasla ayni: tanimli yesil, tanimsiz kirmizi.
      const status = isPaid ? 'paid' : isPartial ? 'partial' : accrualDefined ? 'accrued' : 'accrualMissing'

      return {
        employeeId: a.employeeId,
        employeeCode: a.employeeCode,
        employeeName: a.employeeName,
        attendedDays: a.attendedDays,
        calculatedMeal: a.mealAccrual,
        hasMealOverride: !!a.hasMealOverride,
        mealOverrideAmount: a.mealOverrideAmount,
        mealOverrideDescription: a.mealOverrideDescription,
        effectiveMeal,
        paidAmount: paid,
        remainingAmount: remaining,
        isPaid,
        isPartial,
        accrualDefined,
        status
      }
    })
  }, [accruals, paidMap, definedMap, statusAccrualMap])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR')
    if (!q) return rows
    return rows.filter((r) =>
      `${r.employeeName} ${r.employeeCode}`.toLocaleLowerCase('tr-TR').includes(q)
    )
  }, [rows, search])

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredRows.length && filteredRows.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredRows.map((r) => r.employeeId)))
    }
  }

  const selectedRows = useMemo(() => {
    return filteredRows.filter((r) => selectedIds.has(r.employeeId))
  }, [filteredRows, selectedIds])

  const selectedTotalRemaining = useMemo(() => {
    return selectedRows.reduce((sum, r) => sum + Math.max(0, r.remainingAmount), 0)
  }, [selectedRows])

  // Single Meal Pay
  const handleSinglePay = async () => {
    if (!targetItem) return
    const amt = parseFloat(singlePayAmount.replace(',', '.'))
    if (!amt || amt <= 0) {
      showPopup('warning', 'Uyarı', 'Lütfen geçerli bir tutar giriniz.')
      return
    }
    const erpHata = erpSourceError(erpSource)
    if (erpHata) {
      showPopup('warning', 'Uyarı', erpHata)
      return
    }

    setSingleProcessing(true)
    try {
      await createEmployeePayment({
        employeeId: targetItem.employeeId,
        type: PAYMENT_TYPE.meal,
        amount: amt,
        // Yemek ödemesi de seçili DÖNEME yazılır; ödeme tarihinin ayına düşerse ayın yemeği
        // ödenmemiş görünmeye devam ediyordu (maaştaki hatanın aynısı, 2026-10-16).
        salaryPeriod: period,
        paymentDate: new Date(`${singlePayDate}T12:00:00Z`).toISOString(),
        description: singlePayDesc || `${period} Yemek Ödemesi`,
        erpSource
      })

      setSinglePayModalOpen(false)
      setTargetItem(null)
      await loadData()
      showPopup('success', 'Yemek Ödemesi Yapıldı', `${targetItem.employeeName} çalışanına ${money(amt)} yemek ödemesi kaydedildi ve kasadan düşüldü.`)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Ödeme kaydedilemedi'))
    } finally {
      setSingleProcessing(false)
    }
  }

  // Bulk Meal Pay
  const handleBulkPay = async () => {
    if (selectedRows.length === 0) return
    const erpHata = erpSourceError(erpSource)
    if (erpHata) {
      showPopup('warning', 'Uyarı', erpHata)
      return
    }
    setBulkProcessing(true)
    try {
      // Yalnız KALANI olan personel ödenir; kalan 0 iken aylık yemek tutarı yeniden
      // gönderiliyor, ödenmiş personele ikinci yemek ödemesi çıkıyordu (2026-10-16).
      const payRows = selectedRows.filter((r) => r.remainingAmount > 0.004)
      if (payRows.length === 0) {
        setBulkProcessing(false)
        showPopup('info', 'Ödenecek Yemek Yok', 'Seçilen personelin bu dönem için ödenecek kalan yemek tutarı yok.')
        return
      }
      const amountsMap: Record<number, number> = {}
      payRows.forEach((r) => {
        amountsMap[r.employeeId] = r.remainingAmount
      })

      const res = await bulkCashPayout({
        employeeIds: payRows.map((r) => r.employeeId),
        paymentType: PAYMENT_TYPE.meal,
        salaryPeriod: period,
        customAmounts: amountsMap,
        description: bulkPayDesc || `${period} Yemek Toplu Ödemesi`,
        paymentDate: new Date(`${bulkPayDate}T12:00:00Z`).toISOString(),
        erpSource
      })

      setBulkPayModalOpen(false)
      setSelectedIds(new Set())
      await loadData()
      showPopup('success', 'Toplu Yemek Ödemesi Yapıldı', `${res.paidCount} personele toplam ${money(res.totalAmount)} tutarında yemek ödemesi yapıldı ve kasadan düşüldü.`)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Toplu yemek ödemesi başarısız oldu'))
    } finally {
      setBulkProcessing(false)
    }
  }

  // Save Meal Override
  const handleSaveOverride = async () => {
    if (!overrideItem) return
    const amt = parseFloat(overrideAmount.replace(',', '.'))
    if (isNaN(amt) || amt < 0) {
      showPopup('warning', 'Uyarı', 'Lütfen geçerli bir tutar giriniz.')
      return
    }

    setOverrideProcessing(true)
    try {
      await saveMonthlyOverride({
        employeeId: overrideItem.employeeId,
        period,
        overrideType: 2, // Meal
        overrideAmount: amt,
        description: overrideDesc.trim() || undefined
      })

      setOverrideModalOpen(false)
      setOverrideItem(null)
      await loadData()
      showPopup('success', 'Manuel Düzenleme Kaydedildi', `${overrideItem.employeeName} için ${period} yemek hakedişi ${money(amt)} olarak güncellendi.`)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Manuel düzenleme kaydedilemedi'))
    } finally {
      setOverrideProcessing(false)
    }
  }

  const totals = useMemo(() => {
    return {
      totalEmployees: rows.length,
      totalHakedis: rows.reduce((s, r) => s + r.effectiveMeal, 0),
      totalPaid: rows.reduce((s, r) => s + r.paidAmount, 0),
      totalRemaining: rows.reduce((s, r) => s + r.remainingAmount, 0),
      paidCount: rows.filter((r) => r.isPaid).length
    }
  }, [rows])

  return (
    <Layout>
      <div className="space-y-6">
        {/* Üst Başlık & Dönem */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <UtensilsCrossed className="text-amber-600" size={28} />
              Yemek Hakediş ve Ödemeleri
            </h1>
            <p className="text-xs md:text-sm text-slate-500 mt-1">
              Giriş/çıkış ve fiili çalışma günlerine göre hesaplanan yemek hakedişleri, manuel düzenlemeler ve cari ödemeler.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="space-y-1">
              <label htmlFor="meal-period" className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Dönem
              </label>
              <input
                id="meal-period"
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="input-base w-40 font-bold"
              />
            </div>

            <div className="space-y-1">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {lastCalculatedAt ? `Son: ${fmtTimestamp(lastCalculatedAt)}` : 'Canlı Snapshot'}
              </span>
              <button
                type="button"
                onClick={handleRefreshAccruals}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 transition shadow-sm"
                title="Bugünün giriş/çıkış kayıtlarıyla yemek hakedişini tazeler"
              >
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                {refreshing ? 'Hesaplanıyor...' : 'Hakedişi Yenile'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => void loadData()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition mt-auto"
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Yenile
            </button>
          </div>
        </div>

        {/* İstatistikler */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[11px] uppercase font-bold text-slate-400">Toplam Personel</div>
            <div className="text-2xl font-black text-slate-800 my-1">{totals.totalEmployees}</div>
            <p className="text-[11px] text-slate-500">Bordrolu çalışan</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[11px] uppercase font-bold text-slate-400">Toplam Yemek Hakedişi</div>
            <div className="text-2xl font-black text-amber-700 my-1">{money(totals.totalHakedis)}</div>
            <p className="text-[11px] text-slate-500">Fiili gün karşılığı hakediş</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[11px] uppercase font-bold text-slate-400">Toplam Ödenen</div>
            <div className="text-2xl font-black text-emerald-700 my-1">{money(totals.totalPaid)}</div>
            <p className="text-[11px] text-slate-500">Kasadan çıkan ödemeler</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[11px] uppercase font-bold text-slate-400">Kalan Yemek Borcu</div>
            <div className="text-2xl font-black text-rose-700 my-1">{money(totals.totalRemaining)}</div>
            <p className="text-[11px] text-slate-500">{totals.paidCount} çalışan ödendi</p>
          </div>
        </div>

        {/* Çoklu Seçim Çubuğu */}
        {selectedIds.size > 0 && (
          <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-xl flex flex-wrap items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 bg-amber-500 text-slate-950 font-black rounded-lg text-xs">
                {selectedIds.size} Personel Seçildi
              </span>
              <span className="text-sm font-semibold text-slate-300">
                Seçilenlerin Kalan Yemek Bedeli: <strong className="text-white text-base">{money(selectedTotalRemaining)}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBulkPayModalOpen(true)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-sm transition"
              >
                💰 Seçilenleri Öde (Kasadan Çık)
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
              >
                Seçimi Temizle
              </button>
            </div>
          </div>
        )}

        {/* Arama */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-base w-full max-w-md text-sm"
            placeholder="Personel adı veya kodu ara..."
          />
        </div>

        {error && <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-800">{error}</div>}

        {/* Yemek Tablosu */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <AyarliTablo>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100/80 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <th className="px-4 py-3 text-center w-10">
                    <button type="button" onClick={toggleSelectAll} className="text-slate-600 hover:text-slate-900">
                      {selectedIds.size > 0 && selectedIds.size === filteredRows.length ? (
                        <CheckSquare size={16} className="text-amber-600" />
                      ) : (
                        <Square size={16} />
                      )}
                    </button>
                  </th>
                  <th className="text-left px-4 py-3">Personel</th>
                  <th className="text-center px-4 py-3">Gelinen Gün</th>
                  <th className="text-right px-4 py-3">Yemek Hakedişi</th>
                  <th className="text-right px-4 py-3">Ödenen</th>
                  <th className="text-right px-4 py-3">Kalan</th>
                  <th className="text-center px-4 py-3">Durum</th>
                  <th className="text-right px-4 py-3">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-slate-400 font-medium">
                      Kayıt bulunamadı.
                    </td>
                  </tr>
                )}
                {filteredRows.map((r) => {
                  const isSelected = selectedIds.has(r.employeeId)
                  return (
                    <tr key={r.employeeId} className={`hover:bg-slate-50 transition ${isSelected ? 'bg-amber-50/40' : ''}`}>
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => toggleSelect(r.employeeId)}
                          className="text-slate-600 hover:text-slate-900"
                        >
                          {isSelected ? <CheckSquare size={16} className="text-amber-600" /> : <Square size={16} />}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900">{r.employeeName}</div>
                        <div className="text-[11px] text-slate-400">{r.employeeCode}</div>
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-slate-600">
                        {r.attendedDays} Gün
                      </td>
                      <td className="px-4 py-3 text-right font-black text-slate-900">
                        {money(r.effectiveMeal)}
                        {r.hasMealOverride && (
                          <span className="block text-[10px] text-purple-700 font-bold" title={r.mealOverrideDescription || 'Manuel Override'}>
                            (Özel Düzenleme)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-700">
                        {money(r.paidAmount)}
                      </td>
                      <td className="px-4 py-3 text-right font-black text-rose-700">
                        {money(r.remainingAmount)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {r.status === 'paid' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <CheckCircle2 size={13} className="text-emerald-600" />
                            Ödendi
                          </span>
                        ) : r.status === 'partial' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300">
                            <Percent size={13} className="text-blue-600" />
                            Kısmi Ödendi
                          </span>
                        ) : r.status === 'accrued' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            <CheckCircle2 size={13} className="text-emerald-600" />
                            Hakediş Tanımlı
                          </span>
                        ) : r.status === 'accrualMissing' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
                            <Clock size={13} className="text-rose-600" />
                            Hakediş Tanımsız
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
                            <Clock size={13} className="text-slate-400" />
                            Bekliyor
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Once HAKEDIS TANIMLANIR (ekstreye alacak), sonra odenir. */}
                          {r.accrualDefined ? (
                            <button
                              type="button"
                              onClick={() => void handleUndoMeal(r)}
                              disabled={defineProcessing}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition disabled:opacity-60"
                              title="Yemek hakediş tanımını geri al"
                            >
                              Hakedişi Geri Al
                            </button>
                          ) : null}
                          {!r.accrualDefined ? (
                            <button
                              type="button"
                              onClick={() => void handleDefineMeal(r)}
                              disabled={defineProcessing}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-400 text-slate-950 hover:bg-amber-300 transition shadow-sm disabled:opacity-60"
                              title="Bu dönemin yemek hakedişini cari ekstreye alacak olarak tanımlar. Para çıkışı yapmaz."
                            >
                              📝 Hakediş Tanımla
                            </button>
                          ) : null}
                          {r.accrualDefined && r.remainingAmount > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setTargetItem(r)
                                setSinglePayAmount(String(r.remainingAmount))
                                setSinglePayDesc(`${period} Yemek Ödemesi - ${r.employeeName}`)
                                setSinglePayModalOpen(true)
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 transition shadow-sm"
                            >
                              <DollarSign size={12} />
                              Öde
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              setOverrideItem(r)
                              setOverrideAmount(String(r.effectiveMeal))
                              setOverrideDesc(r.mealOverrideDescription || '')
                              setOverrideModalOpen(true)
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 transition"
                            title="Bu aya özel yemek tutarını manuel düzenle (Override)"
                          >
                            <Edit3 size={12} />
                            Düzenle
                          </button>
                          <button
                            type="button"
                            onClick={() => { setDetailTarget(r); setDetailOpen(true) }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200 transition"
                            title="Gün gün hakediş dökümü — hangi gün kaç TL değerlenmiş, elle düzelt"
                          >
                            <Calendar size={12} />
                            Detay
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate('/ledger')}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition"
                            title="Cari ekstreye git"
                          >
                            <Scale size={12} />
                            Cari
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </AyarliTablo>
          </div>
        </div>

        {/* Tekil Yemek Ödeme Modalı */}
        <Modal
          isOpen={singlePayModalOpen}
          onClose={() => setSinglePayModalOpen(false)}
          title="Yemek Ödemesi Yap"
        >
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
              <strong>{targetItem?.employeeName}</strong> çalışanına <strong>{period}</strong> dönemi için yemek ödemesi kaydedilecek ve kasadan düşülecektir.
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Ödenecek Tutar (₺)</label>
              <input
                type="text"
                value={singlePayAmount}
                onChange={(e) => setSinglePayAmount(e.target.value)}
                className="input-base w-full text-lg font-black text-amber-700"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Ödeme Tarihi</label>
              <input
                type="date"
                value={singlePayDate}
                onChange={(e) => setSinglePayDate(e.target.value)}
                className="input-base w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Açıklama</label>
              <input
                type="text"
                value={singlePayDesc}
                onChange={(e) => setSinglePayDesc(e.target.value)}
                className="input-base w-full"
              />
            </div>
            <ErpSourcePicker value={erpSource} onChange={setErpSource} amountTry={Number(String(singlePayAmount).replace(',', '.')) || 0} />
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setSinglePayModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleSinglePay}
                disabled={singleProcessing}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {singleProcessing ? 'Kaydediliyor...' : 'Yemek Ödemesi Yap'}
              </button>
            </div>
          </div>
        </Modal>

        {/* Toplu Yemek Ödeme Modalı */}
        <Modal
          isOpen={bulkPayModalOpen}
          onClose={() => setBulkPayModalOpen(false)}
          title="Seçilen Personellere Toplu Yemek Ödemesi"
        >
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
              Seçilen <strong>{selectedRows.length} personelin</strong> {period} dönemi yemek hakedişleri ödenecektir. Toplam tutar: <strong>{money(selectedTotalRemaining)}</strong>.
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Ödeme Tarihi</label>
              <input
                type="date"
                value={bulkPayDate}
                onChange={(e) => setBulkPayDate(e.target.value)}
                className="input-base w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Açıklama</label>
              <input
                type="text"
                value={bulkPayDesc}
                onChange={(e) => setBulkPayDesc(e.target.value)}
                className="input-base w-full"
              />
            </div>
            <ErpSourcePicker value={erpSource} onChange={setErpSource} amountTry={selectedTotalRemaining} />
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setBulkPayModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleBulkPay}
                disabled={bulkProcessing}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {bulkProcessing ? 'İşleniyor...' : 'Onayla ve Kasadan Çık'}
              </button>
            </div>
          </div>
        </Modal>

        {/* Yemek Override Modalı */}
        <Modal
          isOpen={overrideModalOpen}
          onClose={() => setOverrideModalOpen(false)}
          title="Bu ayın yemek hakedişini manuel düzenle (Override) — hesaplanan oransal tutar yerine bu tutar geçerli olur"
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              <strong>{overrideItem?.employeeName}</strong> için <strong>{period}</strong> ayına özel yemek hakedişini değiştirebilirsiniz. Bu ay için normal hesaplanan {money(overrideItem?.calculatedMeal ?? 0)} yerine belirlediğiniz tutar kullanılacaktır.
            </p>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Bu Aya Özel Yemek Hakedişi (₺)</label>
              <input
                type="text"
                value={overrideAmount}
                onChange={(e) => setOverrideAmount(e.target.value)}
                className="input-base w-full text-lg font-black text-purple-700"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Düzenleme Nedeni</label>
              <input
                type="text"
                value={overrideDesc}
                onChange={(e) => setOverrideDesc(e.target.value)}
                placeholder="Örn: Özel yemek kartı anlaşması, fazla mesai yemek takviyesi"
                className="input-base w-full"
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setOverrideModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleSaveOverride}
                disabled={overrideProcessing}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-purple-700 text-white hover:bg-purple-800 disabled:opacity-50"
              >
                {overrideProcessing ? 'Kaydediliyor...' : 'Override Kaydet'}
              </button>
            </div>
          </div>
        </Modal>

        {/* Bildirim Popup */}
        <AccrualDayDetailModal
          isOpen={detailOpen}
          onClose={() => setDetailOpen(false)}
          employeeId={detailTarget?.employeeId ?? null}
          employeeName={detailTarget?.employeeName ?? ''}
          period={period}
          kind={2}
          onSaved={() => void loadData()}
        />

        <NotificationPopup
          isOpen={popupOpen}
          onClose={() => setPopupOpen(false)}
          variant={popupVariant}
          title={popupTitle}
          message={popupMessage}
        />
      </div>
    </Layout>
  )
}
