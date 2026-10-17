import Table, { type TableColumn } from '../components/Table'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Banknote, CalendarClock, ChevronDown, ChevronRight, Pencil, Plus, RefreshCw, RotateCcw, Trash2, TriangleAlert, Wallet } from 'lucide-react'

import Modal from '../components/Modal'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import { fetchBankAccountDefinitions, type BankAccountDefinitionDto } from '../api/bankAccountDefinitions'
import { fetchCurrencyRates, toRateMap } from '../api/currencyRates'
import {
  LOAN_CURRENCIES,
  cancelLoan,
  closeLoan,
  createLoan,
  createLoanPayment,
  deleteLoan,
  deleteLoanPayment,
  fetchLoanDetail,
  fetchLoanSummary,
  fetchLoans,
  reopenLoan,
  updateLoan,
  updateLoanInstallment,
  type LoanDetailDto,
  type LoanInstallmentDto,
  type LoanInterestRatePeriod,
  type LoanListItemDto,
  type LoanSummaryDto,
  type SaveLoanPayload
} from '../api/loans'

type LayoutContext = {
  activeMenuId: string
  activeTabId?: string
  setActiveTabId?: (id?: string) => void
  isSuperAdmin?: boolean
  allowedKeys?: Set<string>
}

function money(n: number | null | undefined) {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v)) return '0,00'
  return new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)
}

function shortDate(value?: string | null) {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('tr-TR')
}

function toInputDate(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function todayInput() {
  return new Date().toISOString().slice(0, 10)
}

/** Kullanıcı virgüllü de yazabiliyor; ikisini de kabul et. */
function parseAmount(value: string) {
  const s = String(value ?? '').trim().replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * Geç/erken gün. Bankanın belgesinde tek kolon ve işareti anlam taşıyor:
 * pozitif = vadeden sonra ödendi, negatif = erken ödendi.
 */
function lateDaysLabel(days?: number | null) {
  if (days == null || days === 0) return '-'
  return days > 0 ? `${days} gün geç` : `${Math.abs(days)} gün erken`
}

const STATUS_LABEL: Record<number, string> = { 1: 'Aktif', 2: 'Kapandı', 3: 'İptal' }
const STATUS_CLASS: Record<number, string> = {
  1: 'bg-blue-50 text-blue-700 border-blue-200',
  2: 'bg-green-50 text-green-700 border-green-200',
  3: 'bg-gray-100 text-gray-600 border-gray-300'
}

const INST_LABEL: Record<number, string> = { 1: 'Bekliyor', 2: 'Kısmi', 3: 'Ödendi', 4: 'Gecikmiş' }
const INST_CLASS: Record<number, string> = {
  1: 'bg-gray-50 text-gray-700 border-gray-200',
  2: 'bg-amber-50 text-amber-700 border-amber-200',
  3: 'bg-green-50 text-green-700 border-green-200',
  4: 'bg-red-50 text-red-700 border-red-200'
}

type LoanForm = {
  id?: number
  loanCode: string
  contractNo: string
  bankAccountDefinitionId: string
  principalAmount: string
  currencyTypeId: string
  interestRate: string
  interestRatePeriod: string
  installmentCount: string
  startDate: string
  firstInstallmentDate: string
  endDate: string
  /** Faiz uzerinden yuzde. Varsayilan 3; BSIV almayan kredide 0 yazilir. */
  bsivRate: string
  /** Bankanin belgesindeki taksit tutari; bos ise sistem hesaplar. */
  installmentAmount: string
  accountNo: string
  iban: string
  productName: string
  customerCrmNo: string
  planType: string
  capitalizePeriod: string
  fees: string
  description: string
  regenerateSchedule: boolean
}

const emptyForm: LoanForm = {
  loanCode: '',
  contractNo: '',
  bankAccountDefinitionId: '',
  principalAmount: '',
  currencyTypeId: '1',
  interestRate: '',
  interestRatePeriod: '1',
  installmentCount: '12',
  startDate: todayInput(),
  firstInstallmentDate: '',
  endDate: '',
  // Gorulen banka planlarinin dordunde BSIV faizin tam %3'u. Varsayilan bu; almayan
  // kredilerde 0 yazilir.
  bsivRate: '3',
  installmentAmount: '',
  accountNo: '',
  iban: '',
  productName: 'TİCARİ KREDİ',
  customerCrmNo: '',
  planType: 'Standart (Eşit taksitli)',
  capitalizePeriod: 'Ayda bir',
  fees: '0',
  description: '',
  regenerateSchedule: false
}

export default function LoansPage() {
  const layout = useOutletContext<LayoutContext>() ?? ({} as LayoutContext)

  const [loans, setLoans] = useState<LoanListItemDto[]>([])
  const [summary, setSummary] = useState<LoanSummaryDto[]>([])
  const [banks, setBanks] = useState<BankAccountDefinitionDto[]>([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed' | 'cancelled'>('all')

  // Açılan kredi satırı. Tek seferde bir tanesi açık: taksit planı 36 satıra kadar
  // çıkabiliyor, ikisi birden açıkken liste taranamaz hâle geliyor.
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<LoanDetailDto | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<LoanForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  const [payTarget, setPayTarget] = useState<LoanInstallmentDto | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(todayInput())
  const [payBankId, setPayBankId] = useState('')
  const [payRate, setPayRate] = useState('')
  const [payNote, setPayNote] = useState('')

  const [editInst, setEditInst] = useState<LoanInstallmentDto | null>(null)
  const [instDue, setInstDue] = useState('')
  const [instAmount, setInstAmount] = useState('')
  const [instPrincipal, setInstPrincipal] = useState('')
  const [instInterest, setInstInterest] = useState('')
  const [instBsiv, setInstBsiv] = useState('')

  /*
    KUR.

    Döviz krediler TL kredilerle aynı listede duruyor ve "toplam ne kadar borcumuz var"
    sorusunun cevabı ancak ortak bir para biriminde verilebilir.

    Kur ANLIK çekiliyor ama üzerine yazılabiliyor: bankanın o gün uyguladığı kur TCMB
    kurundan farklı olabiliyor. Elle girilen değer `rateOverrides`'ta duruyor ve yenileme
    onu EZMİYOR — kullanıcı yazdığı kuru her yenilemede kaybetmesin.

    ÖDENMİŞ tutarların TL karşılığı buradan HESAPLANMAZ: onlar ödeme anındaki kurdan
    dondurulmuş hâlde sunucudan geliyor (`paidTryAmount`). Güncel kurla yeniden hesaplamak
    "bugüne kadar kasadan kaç TL çıktı" sorusuna yanlış cevap verirdi.
  */
  const [liveRates, setLiveRates] = useState<Record<string, number>>({ TRY: 1 })
  const [rateOverrides, setRateOverrides] = useState<Record<string, string>>({})
  const [ratesLoading, setRatesLoading] = useState(false)

  const [note, setNote] = useState<{ open: boolean; message: string; variant: NotificationVariant }>({
    open: false,
    message: '',
    variant: 'info'
  })

  const toast = useCallback((message: string, variant: NotificationVariant = 'info') => {
    setNote({ open: true, message, variant })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, sum] = await Promise.all([fetchLoans(), fetchLoanSummary()])
      setLoans(list)
      setSummary(sum)
    } catch (e: any) {
      toast(String(e?.message ?? 'Krediler yüklenemedi'), 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  const loadDetail = useCallback(
    async (id: number) => {
      setDetailLoading(true)
      try {
        setDetail(await fetchLoanDetail(id))
      } catch (e: any) {
        toast(String(e?.message ?? 'Kredi detayı yüklenemedi'), 'error')
      } finally {
        setDetailLoading(false)
      }
    },
    [toast]
  )

  const loadRates = useCallback(async () => {
    setRatesLoading(true)
    try {
      setLiveRates(toRateMap(await fetchCurrencyRates()))
    } catch {
      // Kur alınamazsa TL karşılığı gösterilmez; kredi listesi yine çalışır. Kur servisi
      // dış bir kaynağa bağlı ve borç takibini durdurmaya değmez.
    } finally {
      setRatesLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    void loadRates()
    fetchBankAccountDefinitions()
      .then((rows) => setBanks(rows ?? []))
      .catch(() => setBanks([]))
  }, [load, loadRates])

  /** Kullanılan kur: elle girildiyse o, yoksa anlık kur. TL her zaman 1. */
  const rateFor = useCallback(
    (code?: string | null) => {
      const c = String(code ?? 'TRY').toUpperCase()
      if (c === 'TRY') return 1
      const manual = Number(String(rateOverrides[c] ?? '').replace(',', '.'))
      if (Number.isFinite(manual) && manual > 0) return manual
      return liveRates[c] ?? 0
    },
    [rateOverrides, liveRates]
  )


  useEffect(() => {
    if (selectedId == null) {
      setDetail(null)
      return
    }
    void loadDetail(selectedId)
  }, [selectedId, loadDetail])

  const visibleLoans = useMemo(() => {
    if (statusFilter === 'all') return loans
    const want = statusFilter === 'active' ? 1 : statusFilter === 'closed' ? 2 : 3
    return loans.filter((l) => l.status === want)
  }, [loans, statusFilter])

  const bankOptions = useMemo(
    () => banks.map((b) => ({ value: String(b.id), label: `${b.accountCode} - ${b.accountName}` })),
    [banks]
  )

  /**
   * Listedeki bütün kredilerin TL karşılığı.
   *
   * Kalan borç GÜNCEL kurla, ödenen tutar ise ÖDEME ANINDAKİ kurla toplanıyor. İkisini aynı
   * kurdan hesaplamak "ne kadar ödedik" sorusunu bozardı: geçmişte 30 TL'den alınan dolar
   * bugün 42 TL'den görünürdü.
   */
  const tryTotals = useMemo(() => {
    let remaining = 0
    let paid = 0
    let missingRate = 0
    for (const l of visibleLoans) {
      if (l.status === 3) continue
      const rate = rateFor(l.currencyCode)
      if (rate > 0) remaining += l.remainingAmount * rate
      else if (l.remainingAmount > 0) missingRate++
      paid += l.paidTryAmount ?? 0
    }
    return { remaining, paid, missingRate }
  }, [visibleLoans, rateFor])

  /** Ekranda kur girilebilecek para birimleri — yalnızca listede gerçekten var olanlar. */
  const usedCurrencies = useMemo(() => {
    const set = new Set<string>()
    for (const l of loans) {
      const c = String(l.currencyCode ?? 'TRY').toUpperCase()
      if (c !== 'TRY') set.add(c)
    }
    return Array.from(set).sort()
  }, [loans])

  const selectedLoanCurrency = useMemo(() => {
    if (!detail) return 'TRY'
    return detail.currencyCode
  }, [detail])

  // ------------------------------------------------------------- kredi formu

  const openCreate = () => {
    setForm({ ...emptyForm, startDate: todayInput() })
    setFormOpen(true)
  }

  const openEdit = (loan: LoanListItemDto) => {
    setForm({
      id: loan.id,
      loanCode: loan.loanCode,
      contractNo: loan.contractNo ?? '',
      bankAccountDefinitionId: String(loan.bankAccountDefinitionId),
      principalAmount: String(loan.principalAmount ?? 0),
      currencyTypeId: String(loan.currencyTypeId ?? 1),
      interestRate: String(loan.interestRate ?? 0),
      interestRatePeriod: String(loan.interestRatePeriod ?? 1),
      installmentCount: String(loan.installmentCount ?? 0),
      startDate: toInputDate(loan.startDate),
      firstInstallmentDate: toInputDate(loan.firstInstallmentDate),
      endDate: toInputDate(loan.endDate),
      bsivRate: String(loan.bsivRate ?? 0),
      installmentAmount: loan.installmentAmount > 0 ? String(loan.installmentAmount) : '',
      accountNo: loan.accountNo ?? '',
      iban: loan.iban ?? '',
      productName: loan.productName ?? '',
      customerCrmNo: loan.customerCrmNo ?? '',
      planType: loan.planType ?? '',
      capitalizePeriod: loan.capitalizePeriod ?? '',
      fees: String(loan.fees ?? 0),
      description: loan.description ?? '',
      regenerateSchedule: false
    })
    setFormOpen(true)
  }

  const saveLoan = async () => {
    if (!form.bankAccountDefinitionId) {
      toast('Banka hesabı seçilmelidir.', 'error')
      return
    }
    if (parseAmount(form.principalAmount) <= 0) {
      toast('Anapara sıfırdan büyük olmalıdır.', 'error')
      return
    }
    if (Number(form.installmentCount) <= 0) {
      toast('Taksit sayısı sıfırdan büyük olmalıdır.', 'error')
      return
    }

    const payload: SaveLoanPayload = {
      loanCode: form.loanCode.trim() || null,
      contractNo: form.contractNo.trim() || null,
      bankAccountDefinitionId: Number(form.bankAccountDefinitionId),
      principalAmount: parseAmount(form.principalAmount),
      currencyTypeId: Number(form.currencyTypeId),
      interestRate: parseAmount(form.interestRate),
      interestRatePeriod: Number(form.interestRatePeriod) === 2 ? 2 : (1 as LoanInterestRatePeriod),
      installmentCount: Number(form.installmentCount),
      startDate: form.startDate,
      firstInstallmentDate: form.firstInstallmentDate || form.startDate,
      endDate: form.endDate || null,
      bsivRate: parseAmount(form.bsivRate),
      // Bos birakilirsa 0 gidiyor ve sunucu taksiti kendisi hesapliyor.
      installmentAmount: parseAmount(form.installmentAmount),
      accountNo: form.accountNo.trim() || null,
      iban: form.iban.trim() || null,
      productName: form.productName.trim() || null,
      customerCrmNo: form.customerCrmNo.trim() || null,
      planType: form.planType.trim() || null,
      capitalizePeriod: form.capitalizePeriod.trim() || null,
      fees: parseAmount(form.fees),
      description: form.description.trim() || null,
      regenerateSchedule: form.regenerateSchedule
    }

    setSaving(true)
    try {
      if (form.id) {
        await updateLoan(form.id, payload)
        toast('Kredi güncellendi.', 'success')
        if (selectedId === form.id) await loadDetail(form.id)
      } else {
        const created = await createLoan(payload)
        toast(`Kredi oluşturuldu${created?.loanCode ? ` (${created.loanCode})` : ''}. Taksit planı üretildi.`, 'success')
        if (created?.id) setSelectedId(created.id)
      }
      setFormOpen(false)
      await load()
    } catch (e: any) {
      toast(String(e?.message ?? 'Kredi kaydedilemedi'), 'error')
    } finally {
      setSaving(false)
    }
  }

  // ------------------------------------------------------------- ödeme

  const openPay = (inst: LoanInstallmentDto) => {
    if (!detail) return
    setPayTarget(inst)
    setPayAmount(String(inst.remainingAmount ?? 0))
    setPayDate(todayInput())
    setPayBankId(String(detail.bankAccountDefinitionId))
    setPayRate('')
    setPayNote('')
  }

  const submitPay = async () => {
    if (!detail || !payTarget) return

    setSaving(true)
    try {
      await createLoanPayment(detail.id, {
        loanInstallmentId: payTarget.id,
        date: payDate,
        amount: parseAmount(payAmount),
        bankAccountDefinitionId: payBankId ? Number(payBankId) : null,
        currencyRate: parseAmount(payRate),
        description: payNote.trim() || null
      })
      toast('Ödeme kaydedildi ve banka hesabına işlendi.', 'success')
      setPayTarget(null)
      await Promise.all([loadDetail(detail.id), load()])
    } catch (e: any) {
      toast(String(e?.message ?? 'Ödeme kaydedilemedi'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const undoPayment = async (paymentId: number) => {
    if (!detail) return
    setSaving(true)
    try {
      await deleteLoanPayment(paymentId)
      toast('Ödeme geri alındı; banka hareketi de silindi.', 'success')
      await Promise.all([loadDetail(detail.id), load()])
    } catch (e: any) {
      toast(String(e?.message ?? 'Ödeme geri alınamadı'), 'error')
    } finally {
      setSaving(false)
    }
  }

  // ------------------------------------------------------------- taksit düzeltme

  const openEditInstallment = (inst: LoanInstallmentDto) => {
    setEditInst(inst)
    setInstDue(toInputDate(inst.dueDate))
    setInstAmount(String(inst.amount ?? 0))
    setInstPrincipal(String(inst.principalPart ?? 0))
    setInstInterest(String(inst.interestPart ?? 0))
    setInstBsiv(String(inst.bsivPart ?? 0))
  }

  const submitEditInstallment = async () => {
    if (!detail || !editInst) return
    setSaving(true)
    try {
      await updateLoanInstallment(detail.id, editInst.id, {
        dueDate: instDue,
        amount: parseAmount(instAmount),
        principalPart: parseAmount(instPrincipal),
        interestPart: parseAmount(instInterest),
        bsivPart: parseAmount(instBsiv)
      })
      toast('Taksit güncellendi.', 'success')
      setEditInst(null)
      await Promise.all([loadDetail(detail.id), load()])
    } catch (e: any) {
      toast(String(e?.message ?? 'Taksit güncellenemedi'), 'error')
    } finally {
      setSaving(false)
    }
  }

  // ------------------------------------------------------------- kredi işlemleri

  const runLoanAction = async (action: () => Promise<void>, okMessage: string) => {
    setSaving(true)
    try {
      await action()
      toast(okMessage, 'success')
      if (selectedId) await loadDetail(selectedId)
      await load()
    } catch (e: any) {
      toast(String(e?.message ?? 'İşlem yapılamadı'), 'error')
    } finally {
      setSaving(false)
    }
  }

  /**
   * Kredinin ACILIR taksit plani. Icerigi eskisiyle birebir ayni; yalnizca satirin altina
   * elle basilan `<tr colSpan>` yerine ortak tablonun genisleme kancasindan veriliyor.
   */
  const renderLoanDetail = useCallback((l: LoanListItemDto) => (
    <div className="px-3 py-3">
                          {detailLoading && <div className="py-4 text-center text-gray-500 text-sm">Yükleniyor…</div>}

                          {!detailLoading && detail && detail.id === l.id && (
                            <div className="space-y-3">
                              {/* Bankanın belgesindeki üst bilgi. Mutabakatta bu alanlara bakılıyor. */}
                              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-x-4 gap-y-2 bg-white border border-gray-200 rounded-lg p-3">
                                <InfoCell label="Ürün Adı" value={detail.productName} />
                                <InfoCell label="Hesap No" value={detail.accountNo} />
                                <InfoCell label="UBAN / IBAN" value={detail.iban} mono />
                                <InfoCell label="Müşteri CRM No" value={detail.customerCrmNo} />
                                <InfoCell label="Plan Türü" value={detail.planType} />
                                <InfoCell label="Kapitalize Dönemi" value={detail.capitalizePeriod} />
                                <InfoCell label="Vade Başlangıcı" value={shortDate(detail.startDate)} />
                                <InfoCell label="İlk Taksit" value={shortDate(detail.firstInstallmentDate)} />
                                <InfoCell label="Vade Sonu" value={shortDate(detail.endDate)} />
                                <InfoCell label="Kullandırım" value={`${money(detail.principalAmount)} ${detail.currencyCode}`} />
                                <InfoCell
                                  label="Faiz / BSİV"
                                  value={`%${money(detail.interestRate)} ${detail.interestRatePeriod === 2 ? 'aylık' : 'yıllık'}${detail.bsivRate > 0 ? ` · BSİV %${money(detail.bsivRate)}` : ''}`}
                                />
                                <InfoCell
                                  label="Taksit Tutarı"
                                  value={detail.installmentAmount > 0 ? money(detail.installmentAmount) : money(detail.installments[0]?.amount ?? 0)}
                                  hint={detail.installmentAmount > 0 ? 'bankadan girildi' : 'hesaplandı'}
                                />
                              </div>

                              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-xs">
                                    <thead className="bg-gray-50 border-b border-gray-200">
                                      <tr className="text-left text-[10px] uppercase tracking-wide text-gray-600">
                                        <th className="px-2 py-2">#</th>
                                        <th className="px-2 py-2">Vade</th>
                                        <th className="px-2 py-2 text-right">Ana Para</th>
                                        <th className="px-2 py-2 text-right">Faiz</th>
                                        {detail.bsivRate > 0 && <th className="px-2 py-2 text-right">BSİV</th>}
                                        <th className="px-2 py-2 text-right">Taksit</th>
                                        <th className="px-2 py-2">Ödendiği Tarih</th>
                                        <th className="px-2 py-2">Geç / Erken</th>
                                        <th className="px-2 py-2 text-right">Ödenen</th>
                                        <th className="px-2 py-2 text-right">Kalan Taksit</th>
                                        <th className="px-2 py-2 text-right">Bakiye</th>
                                        <th className="px-2 py-2">Durum</th>
                                        <th className="px-2 py-2 text-right">İşlem</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {detail.installments.map((inst) => (
                                        <React.Fragment key={inst.id}>
                                          <tr className="border-b border-gray-100">
                                            <td className="px-2 py-1.5 font-semibold text-gray-700">{inst.installmentNo}</td>
                                            <td className="px-2 py-1.5 whitespace-nowrap">{shortDate(inst.dueDate)}</td>
                                            <td className="px-2 py-1.5 text-right whitespace-nowrap text-gray-600">{money(inst.principalPart)}</td>
                                            <td className="px-2 py-1.5 text-right whitespace-nowrap text-gray-600">{money(inst.interestPart)}</td>
                                            {detail.bsivRate > 0 && (
                                              <td className="px-2 py-1.5 text-right whitespace-nowrap text-gray-600">{money(inst.bsivPart)}</td>
                                            )}
                                            <td className="px-2 py-1.5 text-right whitespace-nowrap font-semibold text-gray-900">{money(inst.amount)}</td>
                                            <td className="px-2 py-1.5 whitespace-nowrap">{shortDate(inst.paidDate)}</td>
                                            <td className={'px-2 py-1.5 whitespace-nowrap ' + ((inst.lateDays ?? 0) > 0 ? 'text-red-600 font-semibold' : 'text-gray-500')}>
                                              {lateDaysLabel(inst.lateDays)}
                                            </td>
                                            <td className="px-2 py-1.5 text-right whitespace-nowrap">{money(inst.paidAmount)}</td>
                                            <td className="px-2 py-1.5 text-right whitespace-nowrap font-semibold">{money(inst.remainingAmount)}</td>
                                            {/* Plana göre kalan anapara — bankanın "Bakiye" kolonu. */}
                                            <td className="px-2 py-1.5 text-right whitespace-nowrap text-gray-500">{money(inst.runningBalance)}</td>
                                            <td className="px-2 py-1.5">
                                              <span className={'inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold border ' + (INST_CLASS[inst.status] ?? INST_CLASS[1])}>
                                                {INST_LABEL[inst.status] ?? '-'}
                                              </span>
                                            </td>
                                            <td className="px-2 py-1.5">
                                              <div className="flex items-center justify-end gap-1">
                                                {inst.status !== 3 && (
                                                  <button
                                                    type="button"
                                                    onClick={() => openPay(inst)}
                                                    className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-semibold"
                                                  >
                                                    Öde
                                                  </button>
                                                )}
                                                <IconButton title="Taksiti düzelt" onClick={() => openEditInstallment(inst)}>
                                                  <Pencil size={12} />
                                                </IconButton>
                                              </div>
                                            </td>
                                          </tr>

                                          {inst.payments.length > 0 && (
                                            <tr className="bg-gray-50/60">
                                              <td />
                                              <td colSpan={detail.bsivRate > 0 ? 12 : 11} className="px-2 py-1">
                                                <div className="flex flex-col gap-1">
                                                  {inst.payments.map((pay) => (
                                                    <div key={pay.id} className="flex flex-wrap items-center gap-2 text-[10px] text-gray-600">
                                                      <span className="font-semibold text-gray-800">{money(pay.amount)} {detail.currencyCode}</span>
                                                      <span>· {shortDate(pay.date)}</span>
                                                      <span>· {pay.bankAccountName}</span>
                                                      {/* TL karşılığı ÖDEME anındaki kurdan dondurulmuş; güncel kurla değişmez. */}
                                                      {pay.currencyRate !== 1 && (
                                                        <span>· kur {money(pay.currencyRate)} → {money(pay.tryAmount)} TL</span>
                                                      )}
                                                      {pay.description && <span className="text-gray-500">· {pay.description}</span>}
                                                      <button
                                                        type="button"
                                                        onClick={() => undoPayment(pay.id)}
                                                        className="ml-1 text-red-600 hover:text-red-700 font-semibold"
                                                      >
                                                        geri al
                                                      </button>
                                                    </div>
                                                  ))}
                                                </div>
                                              </td>
                                            </tr>
                                          )}
                                        </React.Fragment>
                                      ))}

                                      {detail.installments.length === 0 && (
                                        <tr>
                                          <td colSpan={13} className="px-2 py-6 text-center text-gray-500">Bu kredide taksit yok.</td>
                                        </tr>
                                      )}
                                    </tbody>

                                    {/* TOPLAM — bankanın tablosunda da en altta duruyor. */}
                                    {detail.installments.length > 0 && (
                                      <tfoot className="bg-gray-100 border-t-2 border-gray-300 font-semibold text-gray-900">
                                        <tr>
                                          <td className="px-2 py-2" colSpan={2}>TOPLAM</td>
                                          <td className="px-2 py-2 text-right whitespace-nowrap">{money(detail.principalAmount)}</td>
                                          <td className="px-2 py-2 text-right whitespace-nowrap">{money(detail.totalInterest)}</td>
                                          {detail.bsivRate > 0 && (
                                            <td className="px-2 py-2 text-right whitespace-nowrap">{money(detail.totalBsiv)}</td>
                                          )}
                                          <td className="px-2 py-2 text-right whitespace-nowrap">{money(detail.totalPayable)}</td>
                                          <td className="px-2 py-2" colSpan={2} />
                                          <td className="px-2 py-2 text-right whitespace-nowrap">{money(detail.paidAmount)}</td>
                                          <td className="px-2 py-2 text-right whitespace-nowrap">{money(detail.remainingAmount)}</td>
                                          <td className="px-2 py-2" colSpan={3} />
                                        </tr>
                                      </tfoot>
                                    )}
                                  </table>
                                </div>
                              </div>

                              {/* Ödenenin özeti. TL karşılığı ödeme anındaki kurlardan toplanmış. */}
                              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-gray-600 px-1">
                                <span>Ödenen faiz: <b className="text-gray-900">{money(detail.paidInterest)}</b></span>
                                {detail.bsivRate > 0 && <span>Ödenen BSİV: <b className="text-gray-900">{money(detail.paidBsiv)}</b></span>}
                                <span>Kalan anapara: <b className="text-gray-900">{money(detail.remainingPrincipal)}</b></span>
                                {detail.currencyCode !== 'TRY' && (
                                  <span>Ödenen TL karşılığı: <b className="text-gray-900">{money(detail.paidTryAmount)}</b></span>
                                )}
                                {detail.fees > 0 && <span>Masraf: <b className="text-gray-900">{money(detail.fees)}</b></span>}
                              </div>
                            </div>
                          )}
    </div>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [detail, detailLoading])

  const loanColumns = useMemo<TableColumn<LoanListItemDto>[]>(() => [
    {
      key: 'loanCode',
      label: 'Kredi No',
      accessorFn: (l) => `${l.loanCode ?? ''} ${l.contractNo ?? ''} ${l.accountNo ?? ''}`.trim(),
      render: (_v, l) => (
        <>
          <div className="font-mono text-xs font-semibold text-gray-900">{l.loanCode}</div>
          {l.contractNo && <div className="text-[10px] text-gray-500">{l.contractNo}</div>}
          {l.accountNo && <div className="text-[10px] text-gray-400">Hesap {l.accountNo}</div>}
        </>
      )
    },
    {
      key: 'bankName',
      label: 'Banka / Hesap',
      accessorFn: (l) => `${l.bankName ?? ''} ${l.bankAccountName ?? ''}`.trim(),
      render: (_v, l) => (
        <>
          <div className="text-xs text-gray-900">{l.bankName || '-'}</div>
          <div className="text-[10px] text-gray-500">{l.bankAccountName}</div>
        </>
      )
    },
    {
      key: 'principalAmount',
      label: 'Anapara',
      accessorFn: (l) => Number(l.principalAmount ?? 0),
      render: (_v, l) => (
        <span className="whitespace-nowrap">
          {money(l.principalAmount)} <span className="text-[10px] text-gray-500">{l.currencyCode}</span>
        </span>
      )
    },
    {
      key: 'interestRate',
      label: 'Faiz / BSIV',
      accessorFn: (l) => Number(l.interestRate ?? 0),
      render: (_v, l) => (
        <span className="whitespace-nowrap">
          %{money(l.interestRate)}
          <div className="text-[10px] text-gray-500">
            {l.interestRatePeriod === 2 ? 'aylık' : 'yıllık'}
            {l.bsivRate > 0 ? ` · BSİV %${money(l.bsivRate)}` : ''}
          </div>
        </span>
      )
    },
    {
      key: 'installmentCount',
      label: 'Taksit',
      // Siralama ODENEN taksit sayisina gore; "3/12" metnini tasisaydik alfabetik dizilirdi.
      accessorFn: (l) => Number(l.paidInstallmentCount ?? 0),
      render: (_v, l) => (
        <span className="whitespace-nowrap">
          <span className="font-semibold">{l.paidInstallmentCount}</span>
          <span className="text-gray-500">/{l.installmentCount}</span>
          {l.overdueInstallmentCount > 0 && (
            <div className="text-[10px] font-semibold text-red-600">{l.overdueInstallmentCount} geciken</div>
          )}
        </span>
      )
    },
    {
      key: 'paidAmount',
      label: 'Ödenen',
      accessorFn: (l) => Number(l.paidAmount ?? 0),
      render: (_v, l) => <span className="whitespace-nowrap">{money(l.paidAmount)}</span>
    },
    {
      key: 'remainingAmount',
      label: 'Kalan Borç',
      accessorFn: (l) => Number(l.remainingAmount ?? 0),
      render: (_v, l) => <span className="whitespace-nowrap font-semibold text-gray-900">{money(l.remainingAmount)}</span>
    },
    {
      key: 'remainingTry',
      label: 'Kalan (TL)',
      // TL karsiligi GUNCEL kurla. Kur yoksa siralamada en alta dussun diye 0 tasinir.
      accessorFn: (l) => (rateFor(l.currencyCode) > 0 ? Number(l.remainingAmount) * rateFor(l.currencyCode) : 0),
      render: (_v, l) => (
        <span className="whitespace-nowrap text-xs text-gray-700">
          {rateFor(l.currencyCode) > 0
            ? money(l.remainingAmount * rateFor(l.currencyCode))
            : <span className="text-amber-600 font-semibold">kur yok</span>}
        </span>
      )
    },
    {
      key: 'nextDueDate',
      label: 'Sonraki Vade',
      accessorFn: (l) => shortDate(l.nextDueDate),
      render: (_v, l) => (
        <span className="whitespace-nowrap text-xs">
          {shortDate(l.nextDueDate)}
          {l.nextDueAmount > 0 && <div className="text-[10px] text-gray-500">{money(l.nextDueAmount)}</div>}
        </span>
      )
    },
    {
      key: 'status',
      label: 'Durum',
      accessorFn: (l) => STATUS_LABEL[l.status] ?? '-',
      render: (_v, l) => (
        <span className={'inline-flex px-2 py-0.5 rounded text-[11px] font-semibold border ' + (STATUS_CLASS[l.status] ?? STATUS_CLASS[1])}>
          {STATUS_LABEL[l.status] ?? '-'}
        </span>
      )
    },
    {
      key: 'actions',
      label: 'İşlem',
      render: (_v, l) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconButton title="Düzenle" onClick={() => openEdit(l)}>
            <Pencil size={14} />
          </IconButton>

          {l.status === 2 ? (
            <IconButton title="Kapanışı geri al" onClick={() => runLoanAction(() => reopenLoan(l.id), 'Kredi yeniden açıldı.')}>
              <RotateCcw size={14} />
            </IconButton>
          ) : (
            <button
              type="button"
              onClick={() => runLoanAction(() => closeLoan(l.id), 'Kredi erken kapatıldı.')}
              className="px-2 py-1 rounded border border-green-200 bg-green-50 text-green-700 text-[11px] font-semibold hover:bg-green-100"
              title="Kalan borcu tek seferde kapattıysanız kullanın"
            >
              Erken Kapat
            </button>
          )}

          <IconButton title="Sil" danger onClick={() => runLoanAction(() => deleteLoan(l.id), 'Kredi silindi.')}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [rateFor, openEdit, runLoanAction])

  // ------------------------------------------------------------- görünüm

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Krediler</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Bankadan çekilen taksitli krediler. Ödemeler banka hesabına çıkış olarak işlenir.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <FormSelect
            label=""
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            options={[
              { value: 'all', label: 'Tümü' },
              { value: 'active', label: 'Aktif' },
              { value: 'closed', label: 'Kapananlar' },
              { value: 'cancelled', label: 'İptaller' }
            ]}
          />
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow-sm"
          >
            <Plus size={16} /> Yeni Kredi
          </button>
        </div>
      </div>

      {/*
        KUR ÇUBUĞU.

        Döviz ve TL krediler aynı listede; ortak bir para birimi olmadan "toplam borcumuz ne"
        sorusunun cevabı yok. Kur anlık çekiliyor, üzerine yazılabiliyor — bankanın uyguladığı
        kur TCMB kurundan farklı olabiliyor ve borcun TL karşılığı buna göre değişiyor.
      */}
      {usedCurrencies.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Kur</span>
            <button
              type="button"
              onClick={() => void loadRates()}
              disabled={ratesLoading}
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              title="Güncel kuru yeniden çek"
            >
              <RefreshCw size={12} className={ratesLoading ? 'animate-spin' : ''} /> Yenile
            </button>
          </div>

          {usedCurrencies.map((code) => {
            const live = liveRates[code] ?? 0
            const manual = rateOverrides[code] ?? ''
            const used = rateFor(code)
            return (
              <div key={code} className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-700 w-9">{code}</span>
                <input
                  value={manual}
                  onChange={(e) => setRateOverrides((prev) => ({ ...prev, [code]: e.target.value }))}
                  placeholder={live > 0 ? money(live) : 'kur yok'}
                  inputMode="decimal"
                  className="w-24 px-2 py-1 border border-gray-200 rounded text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
                  title="Boş bırakılırsa anlık kur kullanılır"
                />
                {manual !== '' && (
                  <button
                    type="button"
                    onClick={() => setRateOverrides((prev) => {
                      const next = { ...prev }
                      delete next[code]
                      return next
                    })}
                    className="text-[10px] font-semibold text-blue-600 hover:text-blue-700"
                    title="Anlık kura dön"
                  >
                    sıfırla
                  </button>
                )}
                {used <= 0 && <span className="text-[10px] text-red-600 font-semibold">kur yok</span>}
              </div>
            )
          })}

          <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
            <span className="text-gray-600">
              Kalan borç (TL): <b className="text-gray-900">{money(tryTotals.remaining)}</b>
            </span>
            {/* Ödenen TUTAR ödeme anındaki kurdan; güncel kurla yeniden hesaplanmıyor. */}
            <span className="text-gray-600">
              Ödenen (TL): <b className="text-gray-900">{money(tryTotals.paid)}</b>
            </span>
            {tryTotals.missingRate > 0 && (
              <span className="text-amber-600 font-semibold">
                {tryTotals.missingRate} kredinin kuru yok
              </span>
            )}
          </div>
        </div>
      )}

      {/* Özet kartlar — para birimleri TOPLANMIYOR, her biri ayrı kart. */}
      {summary.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {summary.map((s) => (
            <React.Fragment key={s.currencyTypeId}>
              <SummaryCard
                icon={<Wallet size={16} />}
                title={`Toplam Borç (${s.currencyCode})`}
                value={money(s.totalRemaining)}
                hint={`${s.activeLoanCount} aktif kredi`}
              />
              <SummaryCard
                icon={<CalendarClock size={16} />}
                title={`Bu Ay Ödenecek (${s.currencyCode})`}
                value={money(s.dueThisMonth)}
              />
              <SummaryCard
                icon={<TriangleAlert size={16} />}
                title={`Geciken (${s.currencyCode})`}
                value={money(s.overdue)}
                tone={s.overdue > 0 ? 'danger' : 'default'}
              />
              <SummaryCard
                icon={<Banknote size={16} />}
                title={`Ödenen Faiz (${s.currencyCode})`}
                value={money(s.paidInterest)}
              />
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Kredi listesi */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <Table<LoanListItemDto>
          onRefresh={() => void load()}
          columns={loanColumns}
          data={visibleLoans}
          rowKey={(l) => String(l.id)}
          loading={loading}
          isRowExpanded={(l) => selectedId === l.id}
          onToggleRowExpanded={(l) => setSelectedId(selectedId === l.id ? null : l.id)}
          renderExpandedRow={renderLoanDetail}
        />
      </div>

      {/* Kredi formu */}
      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title={form.id ? 'Kredi Düzenle' : 'Yeni Kredi'}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormInput
            label="Kredi No"
            value={form.loanCode}
            placeholder="Boş bırakılırsa sistem üretir"
            onChange={(e) => setForm((p) => ({ ...p, loanCode: e.target.value }))}
            disabled={Boolean(form.id)}
          />
          <FormInput
            label="Banka Sözleşme No"
            value={form.contractNo}
            onChange={(e) => setForm((p) => ({ ...p, contractNo: e.target.value }))}
          />
          <FormSelect
            label="Banka Hesabı"
            value={form.bankAccountDefinitionId}
            onChange={(e) => setForm((p) => ({ ...p, bankAccountDefinitionId: e.target.value }))}
            options={[{ value: '', label: 'Seçiniz' }, ...bankOptions]}
          />
          <FormSelect
            label="Para Birimi"
            value={form.currencyTypeId}
            onChange={(e) => setForm((p) => ({ ...p, currencyTypeId: e.target.value }))}
            options={LOAN_CURRENCIES.map((c) => ({ value: String(c.value), label: c.label }))}
          />
          <FormInput
            label="Anapara"
            value={form.principalAmount}
            onChange={(e) => setForm((p) => ({ ...p, principalAmount: e.target.value }))}
          />
          <FormInput
            label="Dosya Masrafı / Vergiler"
            value={form.fees}
            onChange={(e) => setForm((p) => ({ ...p, fees: e.target.value }))}
            hint="Taksitlere dağıtılmaz, tek seferlik bedel"
          />
          <FormInput
            label="Faiz Oranı (%)"
            value={form.interestRate}
            onChange={(e) => setForm((p) => ({ ...p, interestRate: e.target.value }))}
          />
          {/*
            BSİV faizin üzerinden alınıyor ve TAKSİT TUTARINA DAHİL: anapara + faiz + BSİV.
            Görülen banka planlarının dördünde faizin tam %3'ü; birinde hiç yok, o yüzden
            oran kredi başına giriliyor. 0 yazılırsa hesaplanmaz.
          */}
          <FormInput
            label="BSİV Oranı (%)"
            value={form.bsivRate}
            onChange={(e) => setForm((p) => ({ ...p, bsivRate: e.target.value }))}
            hint="Faiz üzerinden, taksite dahil. BSİV yoksa 0 yazın"
          />
          {/*
            Taksit tutarı bankanın belgesinde yazılı. Girilirse plan onun üzerinden kurulur ve
            tabloyla birebir oturur; boş bırakılırsa sistem hesaplar (faiz/BSİV satırları yine
            tutar, yalnızca eşit taksit tutarı birkaç lira sapabilir).
          */}
          <FormInput
            label="Taksit Tutarı"
            value={form.installmentAmount}
            onChange={(e) => setForm((p) => ({ ...p, installmentAmount: e.target.value }))}
            hint="Bankanın belgesindeki tutar. Boş = sistem hesaplasın"
          />
          <FormSelect
            label="Faiz Dönemi"
            value={form.interestRatePeriod}
            onChange={(e) => setForm((p) => ({ ...p, interestRatePeriod: e.target.value }))}
            options={[
              { value: '1', label: 'Yıllık' },
              { value: '2', label: 'Aylık' }
            ]}
          />
          <FormInput
            label="Taksit Sayısı"
            value={form.installmentCount}
            onChange={(e) => setForm((p) => ({ ...p, installmentCount: e.target.value }))}
          />
          <FormInput
            label="Kullandırım Tarihi"
            type="date"
            value={form.startDate}
            onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
          />
          <FormInput
            label="İlk Taksit Tarihi"
            type="date"
            value={form.firstInstallmentDate}
            onChange={(e) => setForm((p) => ({ ...p, firstInstallmentDate: e.target.value }))}
            hint="Boş bırakılırsa kullandırımdan bir ay sonrası"
          />
          <FormInput
            label="Vade Sonu"
            type="date"
            value={form.endDate}
            onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
            hint="Boş bırakılırsa son taksit tarihi yazılır"
          />
          <FormInput
            label="Açıklama"
            value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
          />
        </div>

        {/*
          Bankanın belgesindeki tanım alanları. Hesaplamaya girmezler; mutabakatta aranan
          numaralar burada duruyor ve kredinin bankadaki karşılığını tek bakışta veriyor.
        */}
        <div className="mt-4 pt-3 border-t border-gray-100">
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-2">
            Banka Bilgileri
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormInput
              label="Hesap No"
              value={form.accountNo}
              onChange={(e) => setForm((p) => ({ ...p, accountNo: e.target.value }))}
            />
            <FormInput
              label="UBAN / IBAN"
              value={form.iban}
              onChange={(e) => setForm((p) => ({ ...p, iban: e.target.value }))}
            />
            <FormInput
              label="Ürün Adı"
              value={form.productName}
              onChange={(e) => setForm((p) => ({ ...p, productName: e.target.value }))}
            />
            <FormInput
              label="Müşteri CRM No"
              value={form.customerCrmNo}
              onChange={(e) => setForm((p) => ({ ...p, customerCrmNo: e.target.value }))}
            />
            <FormInput
              label="Plan Türü"
              value={form.planType}
              onChange={(e) => setForm((p) => ({ ...p, planType: e.target.value }))}
            />
            <FormInput
              label="Kapitalize Dönemi"
              value={form.capitalizePeriod}
              onChange={(e) => setForm((p) => ({ ...p, capitalizePeriod: e.target.value }))}
            />
          </div>
        </div>

        {form.id && (
          <label className="mt-3 flex items-start gap-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={form.regenerateSchedule}
              onChange={(e) => setForm((p) => ({ ...p, regenerateSchedule: e.target.checked }))}
              className="mt-0.5"
            />
            <span>
              Taksit planını yeniden üret.
              <span className="block text-gray-500">
                Elle düzelttiğin satırlar silinir. Ödemesi olan kredide sunucu buna izin vermez.
              </span>
            </span>
          </label>
        )}

        <p className="mt-3 text-[11px] text-gray-500">
          Plan eşit taksitli (anüite) olarak üretilir. Bankanın tablosuyla kuruş farkı olursa taksit
          satırlarını tek tek düzeltebilirsin.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setFormOpen(false)}
            className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Vazgeç
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={saveLoan}
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold"
          >
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </Modal>

      {/* Ödeme */}
      <Modal
        isOpen={Boolean(payTarget)}
        onClose={() => setPayTarget(null)}
        title={payTarget ? `Taksit Ödemesi — ${payTarget.installmentNo}. taksit` : 'Taksit Ödemesi'}
      >
        {payTarget && detail && (
          <div className="space-y-3">
            <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              Vade <b>{shortDate(payTarget.dueDate)}</b> · Taksit <b>{money(payTarget.amount)}</b> · Kalan{' '}
              <b>{money(payTarget.remainingAmount)}</b> {selectedLoanCurrency}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormInput
                label={`Ödenen Tutar (${selectedLoanCurrency})`}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                hint="Kalanından az girersen taksit kısmi ödenmiş kalır"
              />
              <FormInput label="Ödeme Tarihi" type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              <FormSelect
                label="Ödeyen Banka Hesabı"
                value={payBankId}
                onChange={(e) => setPayBankId(e.target.value)}
                options={[{ value: '', label: 'Kredinin hesabı' }, ...bankOptions]}
              />
              {detail.currencyCode !== 'TRY' && (
                <FormInput
                  label="Kur (TL)"
                  value={payRate}
                  onChange={(e) => setPayRate(e.target.value)}
                  hint="Boş bırakılırsa güncel kur çekilir"
                />
              )}
              <FormInput label="Açıklama" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
            </div>

            <p className="text-[11px] text-gray-500">
              Ödeme, seçilen banka hesabına <b>çıkış hareketi</b> olarak da yazılır; hesap bakiyesi ve banka
              raporları kendiliğinden güncellenir.
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayTarget(null)}
                className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={submitPay}
                className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold"
              >
                {saving ? 'Kaydediliyor…' : 'Ödemeyi Kaydet'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Taksit düzeltme */}
      <Modal
        isOpen={Boolean(editInst)}
        onClose={() => setEditInst(null)}
        title={editInst ? `${editInst.installmentNo}. Taksiti Düzelt` : 'Taksit Düzelt'}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormInput label="Vade" type="date" value={instDue} onChange={(e) => setInstDue(e.target.value)} />
          <FormInput label="Taksit Tutarı" value={instAmount} onChange={(e) => setInstAmount(e.target.value)} />
          <FormInput label="Anapara" value={instPrincipal} onChange={(e) => setInstPrincipal(e.target.value)} />
          <FormInput label="Faiz" value={instInterest} onChange={(e) => setInstInterest(e.target.value)} />
          {/* BSİV taksit tutarına dahil: anapara + faiz + BSİV = taksit. */}
          <FormInput label="BSİV" value={instBsiv} onChange={(e) => setInstBsiv(e.target.value)} />
        </div>

        <p className="mt-3 text-[11px] text-gray-500">
          Bankanın verdiği tabloya birebir oturtmak için. Taksit tutarı, o taksite yapılmış ödemelerden
          küçük olamaz.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditInst(null)}
            className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Vazgeç
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={submitEditInstallment}
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold"
          >
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </Modal>

      <NotificationPopup
        isOpen={note.open}
        message={note.message}
        variant={note.variant}
        onClose={() => setNote((p) => ({ ...p, open: false }))}
      />
    </div>
  )
}

/**
 * Açılır paneldeki tek bilgi kutusu: üstte etiket, altta değer.
 *
 * Boş alanlar "-" gösteriyor, gizlenmiyor: banka belgesindeki alanların hepsi her zaman
 * aynı sırada durursa göz alışıyor; eksik olanı gizlemek düzeni her kredide kaydırırdı.
 */
function InfoCell({ label, value, hint, mono }: { label: string; value?: string | null; hint?: string; mono?: boolean }) {
  const text = value == null || String(value).trim() === '' ? '-' : String(value)
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</div>
      <div className={'text-xs text-gray-900 truncate ' + (mono ? 'font-mono' : 'font-semibold')} title={text}>
        {text}
      </div>
      {hint && <div className="text-[10px] text-gray-400">{hint}</div>}
    </div>
  )
}

function SummaryCard({
  icon,
  title,
  value,
  hint,
  tone = 'default'
}: {
  icon: React.ReactNode
  title: string
  value: string
  hint?: string
  tone?: 'default' | 'danger'
}) {
  return (
    <div
      className={
        'rounded-xl border p-3 bg-white ' + (tone === 'danger' ? 'border-red-200 bg-red-50/40' : 'border-gray-200')
      }
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
        <span className={tone === 'danger' ? 'text-red-600' : 'text-gray-400'}>{icon}</span>
        {title}
      </div>
      <div className={'mt-1 text-lg font-bold ' + (tone === 'danger' ? 'text-red-700' : 'text-gray-900')}>{value}</div>
      {hint && <div className="text-[10px] text-gray-500 mt-0.5">{hint}</div>}
    </div>
  )
}

function IconButton({
  title,
  onClick,
  children,
  danger
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={
        'p-1.5 rounded border ' +
        (danger
          ? 'border-red-200 text-red-600 hover:bg-red-50'
          : 'border-gray-200 text-gray-600 hover:bg-gray-50')
      }
    >
      {children}
    </button>
  )
}
