import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  RefreshCw,
  Scale,
  Download,
  Wallet,
  Building2,
  CheckSquare,
  Square,
  Trash2,
  PlusCircle,
  CreditCard,
  Layers
} from 'lucide-react'
import Layout from '../components/Layout'
import { money, fmtDate } from '../components/PaymentReportView'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import Modal from '../components/Modal'
import * as XLSX from 'xlsx'
import MonthlyFinancePanel from '../components/MonthlyFinancePanel'
import {
  fetchEmployeeLedger,
  fetchLedgerSummary,
  deleteLedgerLine,
  singlePayout,
  bulkCashPayout,
  fetchCashAccountSummary,
  type LedgerDto,
  type LedgerSummaryDto,
  type LedgerSummaryRowDto,
  type CashAccountSummaryDto
} from '../api/employeeLedger'
import ErpSourcePicker, { erpSourceError } from '../components/ErpSourcePicker'
import type { ErpPaymentSource } from '../api/employeePayments'
import AyarliTablo from '../components/table/AyarliTablo'

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Gün bazlı sınır: "yyyy-MM-dd". Ekstre artık tam tarih aralığı ile süzülüyor. */
function dayIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayMonthsAgo(n: number): string {
  const t = new Date()
  return dayIso(new Date(t.getFullYear(), t.getMonth() - n, 1))
}

function periodMonthsAgo(n: number): string {
  const d = new Date()
  const t = new Date(d.getFullYear(), d.getMonth() - n, 1)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`
}

function balanceLabel(balance: number): { text: string; className: string } {
  if (Math.abs(balance) < 0.005) return { text: '0,00 ₺', className: 'text-slate-900 font-black' }
  if (balance > 0) return { text: money(balance), className: 'text-emerald-700 font-black' }
  return { text: `-${money(Math.abs(balance))}`, className: 'text-rose-700 font-black' }
}

const KIND_BADGE: Record<string, string> = {
  accrual: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200',
  bonusPlan: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200',
  mealPlan: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200',
  salary: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200',
  bonus: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200',
  meal: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-teal-50 text-teal-700 border border-teal-200',
  advance: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300'
}

export default function EmployeeLedgerPage() {
  const [from, setFrom] = useState(() => dayMonthsAgo(11))
  const [to, setTo] = useState(() => dayIso(new Date()))

  const [summary, setSummary] = useState<LedgerSummaryDto | null>(null)
  const [ledger, setLedger] = useState<LedgerDto | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Multi-selection for bulk cash payout & excel
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // Modal states
  const [bulkPayoutModalOpen, setBulkPayoutModalOpen] = useState(false)
  const [bulkPayoutType, setBulkPayoutType] = useState<number>(1) // 1=Salary
  const [bulkPayoutDesc, setBulkPayoutDesc] = useState('Maaş Toplu Ödemesi')
  const [bulkPayoutDate, setBulkPayoutDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [bulkProcessing, setBulkProcessing] = useState(false)

  const [singlePayoutModalOpen, setSinglePayoutModalOpen] = useState(false)
  const [singlePayoutAmount, setSinglePayoutAmount] = useState('')
  const [singlePayoutType, setSinglePayoutType] = useState<number>(1)
  const [singlePayoutDesc, setSinglePayoutDesc] = useState('')
  // Ödemenin çıkacağı B2B kasa/bankası (tekil ve toplu pencerede ortak; son seçim hatırlanır).
  const [erpSource, setErpSource] = useState<ErpPaymentSource | null>(null)
  const [singlePayoutDate, setSinglePayoutDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [singleProcessing, setSingleProcessing] = useState(false)

  // Cash Account state
  const [cashModalOpen, setCashModalOpen] = useState(false)
  const [cashSummary, setCashSummary] = useState<CashAccountSummaryDto | null>(null)
  const [cashLoading, setCashLoading] = useState(false)

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

  // Confirm delete line modal
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [lineToDelete, setLineToDelete] = useState<{ kind: string; refId: number; label: string } | null>(null)
  const [deleteProcessing, setDeleteProcessing] = useState(false)

  const loadSummary = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchLedgerSummary({ from, to, signal })
        setSummary(data)
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(String(e?.message ?? 'Bakiye listesi alınamadı'))
      } finally {
        setLoading(false)
      }
    },
    [from, to]
  )

  const loadCashSummary = async () => {
    setCashLoading(true)
    try {
      const data = await fetchCashAccountSummary()
      setCashSummary(data)
    } catch (e: any) {
      console.warn('Cash summary failed:', e)
    } finally {
      setCashLoading(false)
    }
  }

  useEffect(() => {
    if (selectedId !== null) return
    const ac = new AbortController()
    void loadSummary(ac.signal)
    void loadCashSummary()
    return () => ac.abort()
  }, [loadSummary, selectedId])

  const loadSingleLedger = useCallback(async (id: number) => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchEmployeeLedger(id, { from, to })
      setLedger(data)
    } catch (e: any) {
      setError(String(e?.message ?? 'Ekstre alınamadı'))
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    if (selectedId === null) return
    void loadSingleLedger(selectedId)
  }, [selectedId, loadSingleLedger])

  const rows = useMemo(() => {
    const list = summary?.rows ?? []
    const q = search.trim().toLocaleLowerCase('tr-TR')
    if (!q) return list
    return list.filter((r) =>
      `${r.employeeName} ${r.employeeCode} ${r.workplace ?? ''} ${r.bankAccountNo ?? ''} ${r.customerNo ?? ''}`.toLocaleLowerCase('tr-TR').includes(q)
    )
  }, [summary?.rows, search])

  // Checkbox selection helpers
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === rows.length && rows.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(rows.map((r) => r.employeeId)))
    }
  }

  const selectedRows = useMemo(() => {
    return rows.filter((r) => selectedIds.has(r.employeeId))
  }, [rows, selectedIds])

  const selectedTotalBalance = useMemo(() => {
    return selectedRows.reduce((sum, r) => sum + Math.max(0, r.balance), 0)
  }, [selectedRows])

  // --- Banka Excel İndirme (Near East Bank Formatı) ---
  const exportBankExcel = (targetList: LedgerSummaryRowDto[]) => {
    if (targetList.length === 0) {
      showPopup('info', 'Bilgi', 'Dışa aktarılacak çalışan kaydı bulunamadı.')
      return
    }

    const wsData: any[][] = [
      ['MAAŞ LİSTESİ', '', '', '', ''],
      ['SIRA', 'PERSONEL ADI SOYADI', 'BANKA HESAP NO', 'MÜŞTERİ NO', 'TUTAR']
    ]

    targetList.forEach((r, idx) => {
      // Ödenecek tutar: Pozitif bakiye veya tanımlı maaş
      const payoutAmount = r.balance > 0 ? r.balance : (r.salary > 0 ? r.salary : 0)
      wsData.push([
        idx + 1,
        r.employeeName.toLocaleUpperCase('tr-TR'),
        r.bankAccountNo || '-',
        r.customerNo || '-',
        payoutAmount
      ])
    })

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(wsData)

    // Sütun genişlikleri
    ws['!cols'] = [
      { wch: 8 },  // SIRA
      { wch: 32 }, // AD SOYAD
      { wch: 18 }, // HESAP NO
      { wch: 15 }, // MÜŞTERİ NO
      { wch: 16 }  // TUTAR
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'MAAŞ LİSTESİ')
    const fileName = `BANKA_MAAS_LISTESI_${from}_${to}.xlsx`
    XLSX.writeFile(wb, fileName)

    showPopup('success', 'Excel İndirildi', `${targetList.length} personele ait banka maaş listesi indirildi: ${fileName}`)
  }

  // --- Kişi Detay Ekstre Excel İndirme ---
  const exportEmployeeLedgerExcel = () => {
    if (!ledger) return

    const wsData: any[][] = [
      [`CARİ EKSTRE - ${ledger.employee.name.toUpperCase()}`, '', '', '', '', ''],
      [`Personel Kodu: ${ledger.employee.employeeCode}`, `İşyeri: ${ledger.employee.workplace || '-'}`, `Banka: ${ledger.employee.bankName || 'Near East Bank'}`, `Hesap No: ${ledger.employee.bankAccountNo || '-'}`, `Müşteri No: ${ledger.employee.customerNo || '-'}`, ''],
      [`Dönem Aralığı: ${ledger.fromPeriod} - ${ledger.toPeriod}`, '', '', '', '', ''],
      ['TARİH', 'İŞLEM TÜRÜ', 'AÇIKLAMA', 'ALACAK (HAKEDİŞ)', 'BORÇ (ÖDENEN)', 'BAKİYE']
    ]

    ledger.lines.forEach((l) => {
      wsData.push([
        fmtDate(l.date),
        l.label,
        l.description || '-',
        l.credit > 0 ? l.credit : '',
        l.debit > 0 ? l.debit : '',
        l.balance
      ])
    })

    wsData.push([])
    wsData.push(['TOPLAM', '', '', ledger.totals.credit, ledger.totals.debit, ledger.totals.balance])

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(wsData)

    ws['!cols'] = [
      { wch: 14 },
      { wch: 20 },
      { wch: 36 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 }
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'CARİ EKSTRE')
    const fileName = `Cari_Ekstre_${ledger.employee.employeeCode}_${ledger.employee.name.replace(/\s+/g, '_')}_${from}_${to}.xlsx`
    XLSX.writeFile(wb, fileName)

    showPopup('success', 'Excel İndirildi', `Ekstre dökümü Excel olarak indirildi: ${fileName}`)
  }

  // --- Toplu Kasadan Çık / Toplu Öde İşlemi ---
  const handleExecuteBulkPayout = async () => {
    if (selectedRows.length === 0) return
    const erpHata = erpSourceError(erpSource)
    if (erpHata) {
      showPopup('warning', 'Uyarı', erpHata)
      return
    }
    setBulkProcessing(true)
    try {
      const amountsMap: Record<number, number> = {}
      // Toplu kasadan cikis BAKIYE KAPATMA islemidir: kisiye ne kadar borcluysak o kadar
      // odenir. Bir sure "bakiye yoksa tanimli maasini ode" deniyordu; borcu olmayan
      // personele de maas cikiyor, ekstre her toplu islemde eksiye kayiyordu.
      const payableRows = selectedRows.filter((r) => r.balance > 0.005)
      payableRows.forEach((r) => {
        amountsMap[r.employeeId] = r.balance
      })

      if (payableRows.length === 0) {
        setBulkProcessing(false)
        showPopup('error', 'Ödenecek Bakiye Yok', 'Seçilen personelin açık bakiyesi yok. Önce hakediş tanımlamalısın.')
        return
      }

      const res = await bulkCashPayout({
        employeeIds: payableRows.map((r) => r.employeeId),
        paymentType: bulkPayoutType,
        // MAAŞTA DÖNEM GÖNDERİLMEZ (2026-10-16): bakiye birden fazla ayın maaşını kapsayabilir.
        // Eskiden tamamı filtrenin son ayına (ör. ekim) yazılıyor, ağustos ve eylül "Gecikti"
        // kalıyordu. Sunucu tutarı en eski açık maaş döneminden başlayarak dağıtır.
        salaryPeriod: bulkPayoutType === 1 ? undefined : to,
        customAmounts: amountsMap,
        description: bulkPayoutDesc,
        paymentDate: new Date(`${bulkPayoutDate}T12:00:00Z`).toISOString(),
        erpSource
      })

      setBulkPayoutModalOpen(false)
      setSelectedIds(new Set())
      await loadSummary()
      await loadCashSummary()
      const periodNote = res.periods && res.periods.length > 1 ? ` Maaş ${res.periods.join(', ')} dönemlerine dağıtıldı.` : ''
      showPopup('success', 'Toplu Ödeme Yapıldı', `${res.paidCount} personele toplam ${money(res.totalAmount)} tutarında ödeme yapıldı ve kasadan düşüldü.${periodNote}`)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Toplu ödeme başarısız oldu'))
    } finally {
      setBulkProcessing(false)
    }
  }

  // --- Kişi Cari Ekstresine Tekil Para Yatırma ---
  const handleExecuteSinglePayout = async () => {
    if (!selectedId) return
    const amt = parseFloat(singlePayoutAmount.replace(',', '.'))
    if (!amt || amt <= 0) {
      showPopup('warning', 'Uyarı', 'Lütfen geçerli bir ödeme tutarı giriniz.')
      return
    }
    const erpHata = erpSourceError(erpSource)
    if (erpHata) {
      showPopup('warning', 'Uyarı', erpHata)
      return
    }

    setSingleProcessing(true)
    try {
      const res = await singlePayout({
        employeeId: selectedId,
        amount: amt,
        paymentType: singlePayoutType,
        description: singlePayoutDesc || undefined,
        paymentDate: new Date(`${singlePayoutDate}T12:00:00Z`).toISOString(),
        erpSource
      })

      setSinglePayoutModalOpen(false)
      setSinglePayoutAmount('')
      setSinglePayoutDesc('')
      await loadSingleLedger(selectedId)
      await loadCashSummary()
      // Maaş ödemesi sunucuda açık maaş dönemlerine yazılır; hangi aya düştüğü gösterilir.
      const periodNote = singlePayoutType === 1 && res?.periods?.length
        ? ` Maaş dönemi: ${res.periods.map((p) => `${p.period} (${money(p.amount)})`).join(', ')}.`
        : ''
      showPopup('success', 'Ödeme Kaydedildi', `${money(amt)} tutarındaki ödeme başarıyla cari ekstreye ve kasaya kaydedildi.${periodNote}`)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Ödeme kaydedilemedi'))
    } finally {
      setSingleProcessing(false)
    }
  }

  // --- Ekstre Satırını Geri Al / Sil ---
  const handleExecuteDeleteLine = async () => {
    if (!lineToDelete) return
    setDeleteProcessing(true)
    try {
      await deleteLedgerLine(lineToDelete.kind, lineToDelete.refId)
      setDeleteConfirmOpen(false)
      setLineToDelete(null)
      if (selectedId) await loadSingleLedger(selectedId)
      await loadCashSummary()
      showPopup('success', 'Geri Alındı', 'Kayıt ve ilişkili kasa hareketi başarıyla geri alındı.')
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Kayıt silinemedi'))
    } finally {
      setDeleteProcessing(false)
    }
  }

  const rangeControls = (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label htmlFor="led-from" className="block text-[11px] font-bold uppercase tracking-wider text-neutral-500">
          Başlangıç
        </label>
        <input id="led-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-base w-40 font-semibold" />
      </div>
      <div className="space-y-1">
        <label htmlFor="led-to" className="block text-[11px] font-bold uppercase tracking-wider text-neutral-500">
          Bitiş
        </label>
        <input id="led-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-base w-40 font-semibold" />
      </div>
    </div>
  )

  // =========================================================================
  // GÖRÜNÜM 1: TEK KİŞİ CARİ EKSTRE DETAYI
  // =========================================================================
  if (selectedId !== null) {
    const b = balanceLabel(ledger?.totals.balance ?? 0)

    return (
      <Layout>
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null)
                  setLedger(null)
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition mb-2"
              >
                <ArrowLeft size={14} />
                Tüm Çalışanlar Listesine Dön
              </button>
              <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
                {ledger?.employee.name ?? 'Yükleniyor...'}
                {ledger?.employee.salary ? (
                  <span className="text-sm font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Maaş: {money(ledger.employee.salary)}
                  </span>
                ) : null}
              </h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-1">
                <span><strong>Kod:</strong> {ledger?.employee.employeeCode}</span>
                {ledger?.employee.workplace ? <span><strong>İşyeri:</strong> {ledger.employee.workplace}</span> : null}
                {ledger?.employee.bankAccountNo ? (
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold border border-blue-200">
                    Hesap No: {ledger.employee.bankAccountNo}
                  </span>
                ) : null}
                {ledger?.employee.customerNo ? (
                  <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 font-bold border border-purple-200">
                    Müşteri No: {ledger.employee.customerNo}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {rangeControls}
              <button
                type="button"
                onClick={() => {
                  setSinglePayoutAmount(ledger?.totals.balance && ledger.totals.balance > 0 ? String(ledger.totals.balance) : '')
                  setSinglePayoutModalOpen(true)
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition"
              >
                <PlusCircle size={16} />
                Para Yatır / Ödeme Yap
              </button>
              <button
                type="button"
                onClick={exportEmployeeLedgerExcel}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-slate-800 text-white hover:bg-slate-900 shadow-sm transition"
              >
                <Download size={16} />
                Excel İndir
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="text-xs uppercase font-bold text-slate-400">BORÇ (Ödenenler)</div>
              <div className="text-2xl md:text-3xl font-black text-rose-700 my-1.5">
                {money(ledger?.totals.debit ?? 0)}
              </div>
              <p className="text-xs text-slate-500">Personele fiilen yapılan tüm ödemeler</p>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="text-xs uppercase font-bold text-slate-400">ALACAK (Hakedişler)</div>
              <div className="text-2xl md:text-3xl font-black text-emerald-700 my-1.5">
                {money(ledger?.totals.credit ?? 0)}
              </div>
              <p className="text-xs text-slate-500">Maaş, prim ve yemek hakedişleri</p>
            </div>
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="text-xs uppercase font-bold text-slate-400">BAKİYE</div>
              <div className={`text-2xl md:text-3xl my-1.5 ${b.className}`}>{b.text}</div>
              <p className="text-xs text-slate-500">Kalan net cari bakiye</p>
            </div>
          </div>

          {error && (
            <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-800">{error}</div>
          )}

          {selectedId ? (
            <MonthlyFinancePanel employeeId={selectedId} employeeName={ledger?.employee.name ?? ''} />
          ) : null}

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">Cari Hesap Hareketleri</h3>
              <span className="text-xs font-semibold text-slate-500">{ledger?.lines.length ?? 0} hareket listeleniyor</span>
            </div>
            <div className="overflow-x-auto">
              <AyarliTablo>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/80 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                    <th className="text-left px-4 py-3">Tarih</th>
                    <th className="text-left px-4 py-3">İşlem Türü</th>
                    <th className="text-left px-4 py-3">Açıklama</th>
                    <th className="text-right px-4 py-3">Borç (Ödenen)</th>
                    <th className="text-right px-4 py-3">Alacak (Hakediş)</th>
                    <th className="text-right px-4 py-3">Bakiye</th>
                    <th className="text-center px-4 py-3">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(ledger?.lines.length ?? 0) === 0 && !loading && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-slate-400 font-medium">
                        Seçili tarih aralığında herhangi bir cari hareket bulunamadı.
                      </td>
                    </tr>
                  )}
                  {(ledger?.lines ?? []).map((l, i) => (
                    <tr key={`${l.kind}-${l.refId ?? i}-${l.date}`} className="hover:bg-slate-50/80 transition">
                      <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-600">{fmtDate(l.date)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={KIND_BADGE[l.kind] ?? 'badge-editorial'}>{l.label}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 font-medium">{l.description ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-bold text-rose-700">{l.debit > 0 ? money(l.debit) : ''}</td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-700">{l.credit > 0 ? money(l.credit) : ''}</td>
                      <td className="px-4 py-3 text-right font-black text-slate-900 whitespace-nowrap">{money(l.balance)}</td>
                      <td className="px-4 py-3 text-center">
                        {/* Hakediş satırı da geri alınabilir: tanımı kaldırır, alacak ekstreden düşer.
                            Eskiden dışarıda bırakılmıştı çünkü hakediş satırının kaynak kaydı yoktu. */}
                        {l.refId ? (
                          <button
                            type="button"
                            onClick={() => {
                              setLineToDelete({ kind: l.kind, refId: l.refId!, label: `${l.label} (${fmtDate(l.date)})` })
                              setDeleteConfirmOpen(true)
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition"
                            title="Bu hareketi geri al ve kasadaki kaydı sil"
                          >
                            <Trash2 size={12} />
                            Geri Al
                          </button>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {(ledger?.lines.length ?? 0) > 0 && (
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200 font-black text-xs">
                      <td colSpan={3} className="px-4 py-3 text-right text-slate-600">
                        DÖNEM TOPLAMI:
                      </td>
                      <td className="px-4 py-3 text-right text-rose-700 font-black">{money(ledger?.totals.debit ?? 0)}</td>
                      <td className="px-4 py-3 text-right text-emerald-700 font-black">{money(ledger?.totals.credit ?? 0)}</td>
                      <td className="px-4 py-3 text-right text-slate-900 font-black">{money(ledger?.totals.balance ?? 0)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
              </AyarliTablo>
            </div>
          </div>

          {/* Tekil Para Yatırma Modalı */}
          <Modal
            isOpen={singlePayoutModalOpen}
            onClose={() => setSinglePayoutModalOpen(false)}
            title="Personele Ödeme / Para Yatırma"
          >
            <div className="space-y-4">
              <p className="text-xs text-slate-600">
                <strong>{ledger?.employee.name}</strong> personeline ödeme yaparak cari ekstresine borç düşebilirsiniz. Bu tutar şirketin sanal kasasından çıkış olarak kaydedilir.
              </p>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Ödeme Türü</label>
                <select
                  value={singlePayoutType}
                  onChange={(e) => setSinglePayoutType(Number(e.target.value))}
                  className="input-base w-full"
                >
                  <option value={1}>Maaş Ödemesi</option>
                  <option value={2}>Prim Ödemesi</option>
                  <option value={3}>Nakit Avans</option>
                  <option value={4}>Yemek Ödemesi</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Ödeme Tutarı (₺)</label>
                <input
                  type="text"
                  value={singlePayoutAmount}
                  onChange={(e) => setSinglePayoutAmount(e.target.value)}
                  placeholder="Örn: 25000"
                  className="input-base w-full text-lg font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Ödeme Tarihi</label>
                <input
                  type="date"
                  value={singlePayoutDate}
                  onChange={(e) => setSinglePayoutDate(e.target.value)}
                  className="input-base w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Açıklama (Opsiyonel)</label>
                <input
                  type="text"
                  value={singlePayoutDesc}
                  onChange={(e) => setSinglePayoutDesc(e.target.value)}
                  placeholder="Örn: Elden nakit teslim edildi"
                  className="input-base w-full"
                />
              </div>

              <ErpSourcePicker value={erpSource} onChange={setErpSource} amountTry={Number(String(singlePayoutAmount).replace(',', '.')) || 0} />
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setSinglePayoutModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={handleExecuteSinglePayout}
                  disabled={singleProcessing}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {singleProcessing ? 'Kaydediliyor...' : 'Ödemeyi Kaydet ve Kasadan Düş'}
                </button>
              </div>
            </div>
          </Modal>

          {/* Hareket Silme Onay Modalı */}
          <Modal
            isOpen={deleteConfirmOpen}
            onClose={() => setDeleteConfirmOpen(false)}
            title="Hareketi Geri Al / Sil"
          >
            <div className="space-y-4">
              <p className="text-sm text-slate-700">
                <strong>{lineToDelete?.label}</strong> kaydını geri almak istediğinize emin misiniz?
              </p>
              <p className="text-xs text-rose-600 bg-rose-50 p-3 rounded-lg border border-rose-200 font-medium">
                ⚠️ Bu işlem bu kaydı cari ekstreden kaldıracak ve şirket kasasında oluşturulan çıkış hareketini de otomatik olarak silecektir.
              </p>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={handleExecuteDeleteLine}
                  disabled={deleteProcessing}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {deleteProcessing ? 'Siliniyor...' : 'Evet, Geri Al'}
                </button>
              </div>
            </div>
          </Modal>
        </div>
      </Layout>
    )
  }

  // =========================================================================
  // GÖRÜNÜM 2: TÜM ÇALIŞANLAR CARİ EKSTRE ÖZETİ
  // =========================================================================
  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <Scale className="text-emerald-600" size={28} />
              Cari Ekstre Yönetimi
            </h1>
            <p className="text-xs md:text-sm text-slate-500 mt-1">
              Personel hakedişleri, ödemeler, cari bakiyeler ve Near East Bank formatında toplu Excel çıktısı.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {rangeControls}
            <button
              type="button"
              onClick={() => void loadSummary()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Yenile
            </button>
            <button
              type="button"
              onClick={() => setCashModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition"
            >
              <Wallet size={14} />
              Kasa Durumu ({cashSummary ? money(cashSummary.balance) : '0 ₺'})
            </button>
            <button
              type="button"
              onClick={() => exportBankExcel(selectedRows.length > 0 ? selectedRows : rows)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm transition"
            >
              <Download size={14} />
              Banka Excel Listesi İndir (.xlsx)
            </button>
          </div>
        </div>

        {/* İstatistik Kartları */}
        {/* İstatistik Kartları */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-xs uppercase font-bold text-slate-400 flex items-center justify-between">
              <span>Toplam Çalışan</span>
              <Building2 size={16} className="text-slate-400" />
            </div>
            <div className="text-2xl md:text-3xl font-black text-slate-800 my-1">
              {summary?.summary.employeeCount ?? 0}
            </div>
            <p className="text-xs text-slate-500">Kayıtlı aktif personel</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-xs uppercase font-bold text-slate-400 flex items-center justify-between">
              <span>BORÇ (Toplam Ödenen)</span>
              <CreditCard size={16} className="text-rose-500" />
            </div>
            <div className="text-2xl md:text-3xl font-black text-rose-700 my-1">
              {money(summary?.summary.totalDebit ?? 0)}
            </div>
            <p className="text-xs text-slate-500">Personele yapılan tüm ödemeler</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-xs uppercase font-bold text-slate-400 flex items-center justify-between">
              <span>ALACAK (Toplam Hakediş)</span>
              <Layers size={16} className="text-emerald-500" />
            </div>
            <div className="text-2xl md:text-3xl font-black text-emerald-700 my-1">
              {money(summary?.summary.totalCredit ?? 0)}
            </div>
            <p className="text-xs text-slate-500">Maaş, prim ve yemek hakedişleri</p>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-xs uppercase font-bold text-slate-400 flex items-center justify-between">
              <span>BAKİYE</span>
              <Scale size={16} className="text-amber-500" />
            </div>
            <div className="text-2xl md:text-3xl font-black text-slate-900 my-1">
              {money(summary?.summary.totalBalance ?? 0)}
            </div>
            <p className="text-xs text-slate-500">Toplam net cari bakiye</p>
          </div>
        </div>

        {/* Çoklu Seçim Aksiyon Çubuğu */}
        {selectedIds.size > 0 && (
          <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-xl flex flex-wrap items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 bg-emerald-500 text-slate-950 font-black rounded-lg text-xs">
                {selectedIds.size} Personel Seçildi
              </span>
              <span className="text-sm font-semibold text-slate-300">
                Seçilenlerin Ödenecek Toplam Tutarı: <strong className="text-white text-base">{money(selectedTotalBalance)}</strong>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => exportBankExcel(selectedRows)}
                className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700 transition"
              >
                📊 Seçilenleri Excel İndir
              </button>
              <button
                type="button"
                onClick={() => setBulkPayoutModalOpen(true)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-sm transition"
              >
                💰 Toplu Kasadan Çık / Toplu Öde
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
            placeholder="İsim, personel kodu, hesap no, müşteri no veya işyeri ara..."
          />
        </div>

        {error && <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-800">{error}</div>}

        {/* Ana Tablo */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <AyarliTablo>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100/80 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  <th className="px-4 py-3 text-center w-10">
                    <button type="button" onClick={toggleSelectAll} className="text-slate-600 hover:text-slate-900">
                      {selectedIds.size > 0 && selectedIds.size === rows.length ? (
                        <CheckSquare size={16} className="text-emerald-600" />
                      ) : (
                        <Square size={16} />
                      )}
                    </button>
                  </th>
                  <th className="text-left px-4 py-3">Kod</th>
                  <th className="text-left px-4 py-3">Personel Adı Soyadı</th>
                  <th className="text-left px-4 py-3">Banka Bilgileri</th>
                  <th className="text-left px-4 py-3">İşyeri</th>
                  <th className="text-right px-4 py-3">Borç (Ödenen)</th>
                  <th className="text-right px-4 py-3">Alacak (Hakediş)</th>
                  <th className="text-right px-4 py-3">Bakiye</th>
                  <th className="text-right px-4 py-3">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-slate-400 font-medium">
                      Herhangi bir çalışan cari kaydı bulunamadı.
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const isSelected = selectedIds.has(r.employeeId)
                  return (
                    <tr
                      key={r.employeeId}
                      className={`hover:bg-slate-50 transition ${isSelected ? 'bg-emerald-50/40' : ''}`}
                    >
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleSelect(r.employeeId)
                          }}
                          className="text-slate-600 hover:text-slate-900"
                        >
                          {isSelected ? <CheckSquare size={16} className="text-emerald-600" /> : <Square size={16} />}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-500 whitespace-nowrap">{r.employeeCode}</td>
                      <td className="px-4 py-3 font-bold text-slate-900">
                        <button
                          type="button"
                          onClick={() => setSelectedId(r.employeeId)}
                          className="text-left hover:text-emerald-600 hover:underline transition"
                        >
                          {r.employeeName}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1 text-[11px]">
                          {r.bankAccountNo ? (
                            <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold border border-blue-200" title="Banka Hesap No">
                              H:{r.bankAccountNo}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">Hesap No Yok</span>
                          )}
                          {r.customerNo ? (
                            <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 font-bold border border-purple-200" title="Müşteri No">
                              M:{r.customerNo}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{r.workplace ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-bold text-rose-700">{money(r.debit)}</td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-700">{money(r.credit)}</td>
                      <td className="px-4 py-3 text-right font-black text-slate-900 whitespace-nowrap">
                        {money(r.balance)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedId(r.employeeId)}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
                        >
                          <Scale size={12} />
                          Ekstre
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </AyarliTablo>
          </div>
        </div>

        {/* Toplu Kasadan Çık / Toplu Öde Modalı */}
        <Modal
          isOpen={bulkPayoutModalOpen}
          onClose={() => setBulkPayoutModalOpen(false)}
          title="Toplu Kasadan Çık / Toplu Ödeme Yap"
        >
          <div className="space-y-4">
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900">
              Seçilen <strong>{selectedIds.size} personel</strong> için toplu ödeme çıkışı yapılacak. Toplam ödenecek tutar: <strong>{money(selectedTotalBalance)}</strong>.
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Ödeme Türü</label>
              <select
                value={bulkPayoutType}
                onChange={(e) => setBulkPayoutType(Number(e.target.value))}
                className="input-base w-full"
              >
                <option value={1}>Maaş Ödemesi</option>
                <option value={2}>Prim Ödemesi</option>
                <option value={3}>Nakit Avans</option>
                <option value={4}>Yemek Ödemesi</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Ödeme Tarihi</label>
              <input
                type="date"
                value={bulkPayoutDate}
                onChange={(e) => setBulkPayoutDate(e.target.value)}
                className="input-base w-full"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Açıklama</label>
              <input
                type="text"
                value={bulkPayoutDesc}
                onChange={(e) => setBulkPayoutDesc(e.target.value)}
                placeholder="Örn: 2026-08 Maaş toplu ödemesi"
                className="input-base w-full"
              />
            </div>
            <ErpSourcePicker value={erpSource} onChange={setErpSource} amountTry={selectedRows.filter((r) => r.balance > 0.005).reduce((t, r) => t + r.balance, 0)} />
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setBulkPayoutModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleExecuteBulkPayout}
                disabled={bulkProcessing}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {bulkProcessing ? 'İşleniyor...' : 'Onayla ve Kasadan Çık'}
              </button>
            </div>
          </div>
        </Modal>

        {/* Kasa Durumu Modalı */}
        <Modal
          isOpen={cashModalOpen}
          onClose={() => setCashModalOpen(false)}
          title="Şirket Kasa / Banka Durumu"
        >
          <div className="space-y-4">
            {cashLoading ? (
              <div className="py-8 text-center text-xs text-slate-400">Kasa bilgisi yükleniyor...</div>
            ) : cashSummary ? (
              <>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="text-[11px] font-bold text-slate-400 uppercase">Kasa Adı</div>
                    <div className="text-sm font-black text-slate-800 mt-1">{cashSummary.name}</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="text-[11px] font-bold text-slate-400 uppercase">Toplam Çıkış</div>
                    <div className="text-sm font-black text-rose-700 mt-1">{money(cashSummary.totalOut)}</div>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="text-[11px] font-bold text-slate-400 uppercase">Kasa Bakiyesi</div>
                    <div className={`text-sm font-black mt-1 ${cashSummary.balance < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {money(cashSummary.balance)}
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-slate-700 mb-2 uppercase">Son Kasa Hareketleri</h4>
                  <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 text-xs">
                    {cashSummary.transactions.length === 0 ? (
                      <div className="p-4 text-center text-slate-400">Henüz kasa hareketi yok</div>
                    ) : (
                      cashSummary.transactions.map((t) => (
                        <div key={t.id} className="p-2.5 flex items-center justify-between hover:bg-slate-50">
                          <div>
                            <div className="font-bold text-slate-800">{t.description || t.counterpartyName || 'Ödeme'}</div>
                            <div className="text-[10px] text-slate-400">{fmtDate(t.date)}</div>
                          </div>
                          <div className={`font-black ${t.direction === 2 ? 'text-rose-700' : 'text-emerald-700'}`}>
                            {t.direction === 2 ? '-' : '+'}{money(t.amount)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            ) : null}
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setCashModalOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                Kapat
              </button>
            </div>
          </div>
        </Modal>

        {/* Bildirim Popup */}
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
