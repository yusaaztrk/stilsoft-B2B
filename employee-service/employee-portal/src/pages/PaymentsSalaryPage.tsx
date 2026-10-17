import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Wallet,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  Clock,
  CheckSquare,
  Square,
  Scale,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Edit3,
  Calendar,
  Layers,
  Percent,
  Trash2
} from 'lucide-react'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import AccrualDayDetailModal from '../components/AccrualDayDetailModal'
import PaymentReportView, { money, fmtDate } from '../components/PaymentReportView'
import * as XLSX from 'xlsx'
import {
  fetchSalaryStatus,
  createEmployeePayment,
  type SalaryStatusReportDto,
  type SalaryStatusEmployeeDto
} from '../api/employeePayments'
import { refreshAccruals, saveMonthlyOverride, defineSalaryAccrual, deleteDefinedSalaryAccrual } from '../api/employeeAccruals'
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

export default function PaymentsSalaryPage() {
  const navigate = useNavigate()
  const [period, setPeriod] = useState(currentPeriod)
  const [report, setReport] = useState<SalaryStatusReportDto | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshingAccrual, setRefreshingAccrual] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // Maaş ödeme geçmişi: ödemeyi düzenleme / yanlış döneme yazılmış eski ödemeyi düzeltme yeri.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyReload, setHistoryReload] = useState(0)

  // Multi selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [expandedAdvEmpIds, setExpandedAdvEmpIds] = useState<Set<number>>(new Set())

  // Single Pay Modal
  const [singlePayModalOpen, setSinglePayModalOpen] = useState(false)
  const [targetEmployee, setTargetEmployee] = useState<SalaryStatusEmployeeDto | null>(null)
  const [singlePayAmount, setSinglePayAmount] = useState('')
  const [singlePayDesc, setSinglePayDesc] = useState('')
  // Ödemenin çıkacağı B2B kasa/bankası (tekil ve toplu pencerede ortak; son seçim hatırlanır).
  const [erpSource, setErpSource] = useState<ErpPaymentSource | null>(null)
  const [singlePayDate, setSinglePayDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [singleProcessing, setSingleProcessing] = useState(false)

  // Bulk Pay Modal
  const [bulkPayModalOpen, setBulkPayModalOpen] = useState(false)
  const [defineProcessing, setDefineProcessing] = useState(false)
  // Hakediş tanımlamadan ÖNCE ayın nasıl kapandığı gösterilir ve tutar elle düzenlenebilir.
  const [defineModalOpen, setDefineModalOpen] = useState(false)
  // Gün gün hakediş dökümü — hangi gün kaç dakika, kaç TL değerlenmiş.
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailTarget, setDetailTarget] = useState<SalaryStatusEmployeeDto | null>(null)
  const [defineTarget, setDefineTarget] = useState<SalaryStatusEmployeeDto | null>(null)
  const [defineAmount, setDefineAmount] = useState('')
  const [defineNote, setDefineNote] = useState('')
  const [bulkPayDate, setBulkPayDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [bulkPayDesc, setBulkPayDesc] = useState('Maaş Toplu Ödemesi')
  const [bulkProcessing, setBulkProcessing] = useState(false)

  // Monthly Override Modal
  const [overrideModalOpen, setOverrideModalOpen] = useState(false)
  const [overrideEmployee, setOverrideEmployee] = useState<SalaryStatusEmployeeDto | null>(null)
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

  const loadData = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchSalaryStatus(period, { signal })
        setReport(data)
        setHistoryReload((k) => k + 1)
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError(String(e?.message ?? 'Maaş durumları yüklenemedi'))
      } finally {
        setLoading(false)
      }
    },
    [period]
  )

  useEffect(() => {
    const ac = new AbortController()
    void loadData(ac.signal)
    return () => ac.abort()
  }, [loadData])

  // "Hakedişi Yenile" Butonu: Sadece bu ay ve bugünün durumunu anlık hesaplar ve snapshot günceller
  const handleRefreshAccruals = async () => {
    setRefreshingAccrual(true)
    try {
      const res = await refreshAccruals(period)
      setLastUpdated(res.lastCalculatedAt || new Date().toISOString())
      await loadData()
      showPopup('success', 'Hakediş Güncellendi', `${period} dönemi hakediş snapshot'ı bugünün mesaileriyle başarıyla tazelendi.`)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Hakediş yenilenemedi'))
    } finally {
      setRefreshingAccrual(false)
    }
  }

  const rows = useMemo(() => {
    const list = report?.data ?? []
    const q = search.trim().toLocaleLowerCase('tr-TR')
    if (!q) return list
    return list.filter((r) =>
      `${r.employeeName} ${r.employeeCode} ${r.workplace ?? ''} ${r.bankAccountNo ?? ''} ${r.customerNo ?? ''}`.toLocaleLowerCase('tr-TR').includes(q)
    )
  }, [report?.data, search])

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

  const toggleExpandAdvances = (id: number) => {
    setExpandedAdvEmpIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedRows = useMemo(() => {
    return rows.filter((r) => selectedIds.has(r.employeeId))
  }, [rows, selectedIds])

  const selectedTotalRemaining = useMemo(() => {
    return selectedRows.reduce((sum, r) => sum + Math.max(0, r.remainingAmount), 0)
  }, [selectedRows])

  // Banka Excel İndirme (Near East Bank Formatı)
  const exportBankExcel = (targetList: SalaryStatusEmployeeDto[]) => {
    if (targetList.length === 0) {
      showPopup('info', 'Bilgi', 'Dışa aktarılacak çalışan bulunamadı.')
      return
    }

    // Bankaya giden liste ÖDENECEK tutardır: kalanı olmayan (ödenmiş) personel listeye girmez.
    // Eskiden kalan 0 ise net hakediş yazılıyordu; ödenmiş personel bankaya ikinci kez gidiyordu.
    const payable = targetList.filter((r) => r.remainingAmount > 0.004)
    if (payable.length === 0) {
      showPopup('info', 'Bilgi', 'Seçilen personelin bu dönem için ödenecek kalan maaşı yok.')
      return
    }

    const wsData: any[][] = [
      [`${period} DÖNEMİ MAAŞ LİSTESİ`, '', '', '', ''],
      ['SIRA', 'PERSONEL ADI SOYADI', 'BANKA HESAP NO', 'MÜŞTERİ NO', 'TUTAR']
    ]

    payable.forEach((r, idx) => {
      const payoutAmount = r.remainingAmount
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

    ws['!cols'] = [
      { wch: 8 },
      { wch: 32 },
      { wch: 18 },
      { wch: 15 },
      { wch: 18 }
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'MAAŞ LİSTESİ')
    const fileName = `BANKA_MAAS_LISTESI_${period}.xlsx`
    XLSX.writeFile(wb, fileName)

    const skippedNote = payable.length < targetList.length ? ` Kalanı olmayan ${targetList.length - payable.length} personel listeye alınmadı.` : ''
    showPopup('success', 'Excel İndirildi', `${payable.length} personele ait banka maaş listesi indirildi: ${fileName}.${skippedNote}`)
  }

  // Tekil Maaş Yatırma
  const handleSinglePay = async () => {
    if (!targetEmployee) return
    const amt = parseFloat(singlePayAmount.replace(',', '.'))
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
      await createEmployeePayment({
        employeeId: targetEmployee.employeeId,
        type: 1, // Salary
        amount: amt,
        // Ödeme TARİHİ ile maaş DÖNEMİ ayrı: ağustos maaşı eylülde ödenince ağustosa yazılmalı.
        // Dönem gönderilmediğinde ödeme tarihinin ayına yazılıyor, ağustos "Gecikti" kalıyordu.
        salaryPeriod: period,
        paymentDate: new Date(`${singlePayDate}T12:00:00Z`).toISOString(),
        description: singlePayDesc || `${period} Maaş Ödemesi`,
        erpSource
      })

      setSinglePayModalOpen(false)
      setTargetEmployee(null)
      await loadData()
      showPopup('success', 'Maaş Yatırıldı', `${targetEmployee.employeeName} çalışanına ${money(amt)} maaş ödemesi başarıyla yapıldı.`)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Maaş ödemesi kaydedilemedi'))
    } finally {
      setSingleProcessing(false)
    }
  }

  /**
   * Hakediş TANIMLAMA — ödeme değil.
   *
   * Cari ekstredeki maaş alacağı yalnızca bu işlemden doğar. Sistemin hesapladığı hakediş
   * öneridir; satırda manuel düzenleme (override) varsa ekstreye o tutar girer. Para çıkışı
   * ayrı bir adımdır: "Seçilenleri Öde (Kasadan Çık)".
   */
  const handleDefineAccrual = async () => {
    if (selectedRows.length === 0) return
    setDefineProcessing(true)
    try {
      // Hakedis BRUT yazilir, net degil. Avans zaten cari ekstrede ayri bir BORC satiri;
      // hakedisten de dusersek ayni avans iki kez sayilir ve personele eksik odenir.
      // Ekstredeki bakiye (brut hakedis - avans - odemeler) dogru neti zaten veriyor.
      const amounts: Record<number, number> = {}
      selectedRows.forEach((r) => {
        // Aya ozel manuel duzenleme varsa o gecerli; yoksa sunucunun hesapladigi hakedis.
        if (r.hasSalaryOverride && r.salaryOverrideAmount != null) {
          amounts[r.employeeId] = r.salaryOverrideAmount
        }
      })

      const res = await defineSalaryAccrual({
        employeeIds: selectedRows.map((r) => r.employeeId),
        period,
        amounts: Object.keys(amounts).length > 0 ? amounts : undefined,
        description: `${period} dönemi maaş hakedişi`
      })

      setSelectedIds(new Set())
      await loadData()

      const skippedNote = res.skipped.length > 0 ? ` Tutarı sıfır olduğu için atlananlar: ${res.skipped.join(', ')}.` : ''
      showPopup(
        res.definedCount > 0 ? 'success' : 'error',
        res.definedCount > 0 ? 'Hakediş Tanımlandı' : 'Tanımlanacak Hakediş Yok',
        `${res.message}${skippedNote} Tutarlar cari ekstreye alacak olarak işlendi.`
      )
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Hakediş tanımlanamadı'))
    } finally {
      setDefineProcessing(false)
    }
  }

  /** Satırdaki "Hakediş Tanımla" — önce ayın nasıl kapandığını gösteren önizlemeyi açar. */
  const openDefineModal = (row: SalaryStatusEmployeeDto) => {
    setDefineTarget(row)
    setDefineAmount(String(row.grossSalary ?? 0))
    setDefineNote('')
    setDefineModalOpen(true)
  }

  /** Önizlemede onaylanan tutarı hakediş olarak yazar — cari ekstreye alacak düşer. */
  const handleDefineOne = async (row: SalaryStatusEmployeeDto, amount?: number, note?: string) => {
    setDefineProcessing(true)
    try {
      const res = await defineSalaryAccrual({
        employeeIds: [row.employeeId],
        period,
        // Elle düzenlenen tutar varsa o; yoksa sunucunun dakika bazlı hesabı geçerli.
        amounts: amount != null && amount > 0 ? { [row.employeeId]: amount } : undefined,
        description: note?.trim() || `${period} dönemi maaş hakedişi`
      })
      setDefineModalOpen(false)
      await loadData()
      showPopup(
        res.definedCount > 0 ? 'success' : 'error',
        res.definedCount > 0 ? 'Hakediş Tanımlandı' : 'Tanımlanamadı',
        res.definedCount > 0
          ? `${row.employeeName} için ${period} dönemi maaş hakedişi cari ekstreye alacak olarak işlendi.`
          : `${row.employeeName} için tanımlanacak hakediş bulunamadı (tutar sıfır).`
      )
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Hakediş tanımlanamadı'))
    } finally {
      setDefineProcessing(false)
    }
  }

  /** Tanımlanmış hakedişi geri alır — cari ekstredeki alacak satırı da düşer. */
  const handleUndoAccrual = async (row: SalaryStatusEmployeeDto) => {
    if (!row.accrualId) {
      // Sessizce donmek "dugme calismiyor" gibi gorunuyordu; sebebi soyle.
      showPopup('error', 'Geri Alınamadı', 'Hakediş kaydının kimliği alınamadı. Sayfayı yenileyip tekrar deneyin.')
      return
    }
    if (row.paidAmount > 0) {
      showPopup(
        'error',
        'Geri Alınamaz',
        `${row.employeeName} için bu dönemde ödeme yapılmış. Önce ödemeyi cari ekstreden geri alın.`
      )
      return
    }
    if (!window.confirm(`${row.employeeName} için ${period} dönemi hakediş tanımı geri alınsın mı? Cari ekstredeki alacak satırı da kalkacak.`)) return

    setDefineProcessing(true)
    try {
      await deleteDefinedSalaryAccrual(row.accrualId)
      await loadData()
      showPopup('success', 'Hakediş Geri Alındı', `${row.employeeName} için ${period} dönemi hakediş tanımı kaldırıldı.`)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Geri alınamadı'))
    } finally {
      setDefineProcessing(false)
    }
  }

  // Toplu Maaş Yatırma (Kasadan Çık)
  const handleBulkPay = async () => {
    if (selectedRows.length === 0) return

    // Yalnız KALANI olan personel ödenir. Eskiden kalan 0 ise net hakediş gönderiliyordu:
    // "tümünü seç → öde" ödenmiş herkese ikinci maaş çıkarıyordu.
    const payRows = selectedRows.filter((r) => r.remainingAmount > 0.004)
    if (payRows.length === 0) {
      showPopup('info', 'Ödenecek Maaş Yok', 'Seçilen personelin bu dönem için ödenecek kalan maaşı yok.')
      return
    }

    // Hakedisi tanimlanmamis personele odeme yapmak ekstrede bakiyeyi eksiye dusurur
    // (alacak yok, borc var) - personele fazla odenmis gibi gorunur. Once uyar.
    const undefinedRows = payRows.filter((r) => !r.accrualDefined)
    if (undefinedRows.length > 0) {
      const names = undefinedRows.slice(0, 3).map((r) => r.employeeName).join(', ')
      const more = undefinedRows.length > 3 ? ` ve ${undefinedRows.length - 3} kişi daha` : ''
      const ok = window.confirm(
        `Dikkat: ${undefinedRows.length} personelin ${period} dönemi hakedişi henüz cari ekstreye tanımlanmadı (${names}${more}).\n\n` +
        'Şimdi ödeme yaparsanız ekstrede alacak karşılığı olmadan borç oluşur ve bakiye eksiye düşer.\n\n' +
        'Önce "Hakediş Tanımla" demeniz önerilir. Yine de ödemek istiyor musunuz?'
      )
      if (!ok) return
    }
    const erpHata = erpSourceError(erpSource)
    if (erpHata) {
      showPopup('warning', 'Uyarı', erpHata)
      return
    }
    setBulkProcessing(true)
    try {
      const amountsMap: Record<number, number> = {}
      payRows.forEach((r) => {
        amountsMap[r.employeeId] = r.remainingAmount
      })

      const res = await bulkCashPayout({
        employeeIds: payRows.map((r) => r.employeeId),
        paymentType: 1, // Salary
        salaryPeriod: period,
        customAmounts: amountsMap,
        description: bulkPayDesc || `${period} Maaş Toplu Ödemesi`,
        paymentDate: new Date(`${bulkPayDate}T12:00:00Z`).toISOString(),
        erpSource
      })

      setBulkPayModalOpen(false)
      setSelectedIds(new Set())
      await loadData()
      if (!res.paidCount) {
        showPopup('info', 'Ödeme Yapılmadı', res.message || 'Seçilen personelin ödenecek kalan maaşı yok.')
        return
      }
      const skippedCount = selectedRows.length - payRows.length + (res.skipped?.length ?? 0)
      const skippedNote = skippedCount > 0 ? ` Kalanı olmayan ${skippedCount} personel atlandı.` : ''
      showPopup('success', 'Toplu Maaş Yatırıldı', `${res.paidCount} personele toplam ${money(res.totalAmount)} tutarında maaş ödemesi yapıldı ve kasadan düşüldü.${skippedNote}`)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Toplu maaş ödemesi başarısız oldu'))
    } finally {
      setBulkProcessing(false)
    }
  }

  // Aylık Maaşı Manuel Override Etme (Yalnızca bu ay geçerli)
  const handleSaveOverride = async () => {
    if (!overrideEmployee) return
    const amt = parseFloat(overrideAmount.replace(',', '.'))
    if (isNaN(amt) || amt < 0) {
      showPopup('warning', 'Uyarı', 'Lütfen geçerli bir tutar giriniz.')
      return
    }

    setOverrideProcessing(true)
    try {
      await saveMonthlyOverride({
        employeeId: overrideEmployee.employeeId,
        period,
        overrideType: 1, // Salary
        overrideAmount: amt,
        description: overrideDesc.trim() || undefined
      })

      setOverrideModalOpen(false)
      setOverrideEmployee(null)
      await loadData()
      showPopup('success', 'Manuel Düzenleme Kaydedildi', `${overrideEmployee.employeeName} için ${period} maaşı ${money(amt)} olarak güncellendi. Sonraki aylar standart maaştan devam edecektir.`)
    } catch (e: any) {
      showPopup('error', 'Hata', String(e?.message ?? 'Manuel düzenleme kaydedilemedi'))
    } finally {
      setOverrideProcessing(false)
    }
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Üst Başlık & Dönem Seçimi */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <div>
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <Wallet className="text-emerald-600" size={28} />
              Maaş Hakediş ve Ödeme Yönetimi
            </h1>
            <p className="text-xs md:text-sm text-slate-500 mt-1">
              Dönem bazlı maaş hakedişleri, maaştan düşülen avanslar, manuel düzenlemeler ve canlı ödeme durumları.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="space-y-1">
              <label htmlFor="salary-period" className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Maaş Dönemi
              </label>
              <input
                id="salary-period"
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="input-base w-40 font-bold"
              />
            </div>

            {/* Hakedişi Yenile Butonu (Performans / Snapshot Yenileme) */}
            <div className="space-y-1">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {lastUpdated ? `Son: ${fmtTimestamp(lastUpdated)}` : 'Canlı Snapshot'}
              </span>
              <button
                type="button"
                onClick={handleRefreshAccruals}
                disabled={refreshingAccrual}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition shadow-sm"
                title="Bugünün mesailerini de hesaba katarak hakedişi tazeler"
              >
                <RefreshCw size={14} className={refreshingAccrual ? 'animate-spin' : ''} />
                {refreshingAccrual ? 'Hesaplanıyor...' : 'Hakedişi Yenile'}
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
            <button
              type="button"
              onClick={() => exportBankExcel(selectedRows.length > 0 ? selectedRows : rows)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 shadow-sm transition mt-auto"
            >
              <Download size={14} />
              Banka Maaş Exceli İndir (.xlsx)
            </button>
          </div>
        </div>

        {/* İstatistik Kartları */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[11px] uppercase font-bold text-slate-400">Toplam Çalışan</div>
            <div className="text-2xl font-black text-slate-800 my-1">{report?.summary.totalEmployees ?? 0}</div>
            <p className="text-[11px] text-slate-500">Aktif bordrolu personel</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[11px] uppercase font-bold text-slate-400">Toplam Brüt Maaş</div>
            <div className="text-xl font-black text-slate-800 my-1">{money(report?.summary.totalGross ?? 0)}</div>
            <p className="text-[11px] text-slate-500">Tanımlı / override hakedişler</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[11px] uppercase font-bold text-rose-500">Düşülen Avanslar</div>
            <div className="text-xl font-black text-rose-700 my-1">-{money(report?.summary.totalAdvances ?? 0)}</div>
            <p className="text-[11px] text-slate-500">Maaştan düşülen avanslar</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[11px] uppercase font-bold text-emerald-600">Ödenecek Net Tutar</div>
            <div className="text-xl font-black text-emerald-700 my-1">{money(report?.summary.totalNetPayable ?? 0)}</div>
            <p className="text-[11px] text-slate-500">Kesintiler sonrası kalan</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[11px] uppercase font-bold text-emerald-600">Ödenen Personel</div>
            <div className="text-2xl font-black text-emerald-700 my-1">
              {report?.summary.paidCount ?? 0} <span className="text-xs text-slate-400 font-normal">/ {report?.summary.totalEmployees ?? 0}</span>
            </div>
            <p className="text-[11px] text-slate-500">{money(report?.summary.totalPaid ?? 0)} ödendi</p>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
            <div className="text-[11px] uppercase font-bold text-rose-600">Geciken / Bekleyen</div>
            <div className="text-2xl font-black text-rose-700 my-1">{report?.summary.delayedCount ?? 0}</div>
            <p className="text-[11px] text-rose-500 font-semibold">{report?.summary.partialCount ?? 0} kısmi ödendi</p>
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
                Seçilenlerin Kalan Maaş Tutarı: <strong className="text-white text-base">{money(selectedTotalRemaining)}</strong>
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
                onClick={() => void handleDefineAccrual()}
                disabled={defineProcessing}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-400 text-slate-950 hover:bg-amber-300 shadow-sm transition disabled:opacity-60"
                title="Seçilenlerin bu dönem maaş hakedişini cari ekstreye alacak olarak tanımlar. Para çıkışı yapmaz."
              >
                {defineProcessing ? '⏳ Tanımlanıyor...' : '📝 Hakediş Tanımla'}
              </button>
              <button
                type="button"
                onClick={() => setBulkPayModalOpen(true)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 text-slate-950 hover:bg-emerald-400 shadow-sm transition"
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

        {/* Arama Çubuğu */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-base w-full max-w-md text-sm"
            placeholder="Personel adı, kodu, hesap no, müşteri no veya işyeri ara..."
          />
        </div>

        {error && <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-800">{error}</div>}

        {/* Maaş Tablosu */}
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
                  <th className="text-left px-4 py-3">Personel</th>
                  <th className="text-left px-4 py-3">Banka & Müşteri No</th>
                  <th className="text-center px-4 py-3">Maaş Günü</th>
                  <th className="text-right px-4 py-3">Brüt Hakediş</th>
                  <th className="text-right px-4 py-3">Kesintiler (Avans)</th>
                  <th className="text-right px-4 py-3">Net Hakediş</th>
                  <th className="text-right px-4 py-3">Ödenen</th>
                  <th className="text-right px-4 py-3">Kalan</th>
                  <th className="text-center px-4 py-3">Ödeme Durumu</th>
                  <th className="text-right px-4 py-3">İşlem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-slate-400 font-medium">
                      Seçili döneme ait personel kaydı bulunamadı.
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const isSelected = selectedIds.has(r.employeeId)
                  const hasAdvances = r.advances && r.advances.length > 0
                  const isExpanded = expandedAdvEmpIds.has(r.employeeId)

                  return (
                    <React.Fragment key={r.employeeId}>
                      <tr className={`hover:bg-slate-50 transition ${isSelected ? 'bg-emerald-50/40' : ''}`}>
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => toggleSelect(r.employeeId)}
                            className="text-slate-600 hover:text-slate-900"
                          >
                            {isSelected ? <CheckSquare size={16} className="text-emerald-600" /> : <Square size={16} />}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-900">{r.employeeName}</div>
                          <div className="text-[11px] text-slate-400">
                            {r.employeeCode} {r.workplace ? ` · ${r.workplace}` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1 text-[11px]">
                            {r.bankAccountNo ? (
                              <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold border border-blue-200">
                                H:{r.bankAccountNo}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">Hesap No Yok</span>
                            )}
                            {r.customerNo ? (
                              <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 font-bold border border-purple-200">
                                M:{r.customerNo}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center font-bold text-slate-600">
                          Her ayın {r.salaryDay}. günü
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">
                          {money(r.grossSalary)}
                          {r.hasSalaryOverride && (
                            <span className="block text-[10px] text-purple-700 font-bold" title={r.salaryOverrideDescription || 'Manuel Override'}>
                              (Özel Düzenleme)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {!hasAdvances ? (
                            <button
                              type="button"
                              onClick={() => toggleExpandAdvances(r.employeeId)}
                              className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-700 transition"
                              title="Hakediş dökümünü göster/gizle"
                            >
                              0,00 ₺
                              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => toggleExpandAdvances(r.employeeId)}
                              className="inline-flex items-center gap-1 font-bold text-rose-700 hover:text-rose-900 hover:underline bg-rose-50 px-2 py-0.5 rounded border border-rose-200 transition"
                              title="Avans detaylarını göster/gizle"
                            >
                              -{money(r.advanceTotal)}
                              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-black text-slate-900 text-sm whitespace-nowrap">
                          {money(r.netPayable)}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-700 whitespace-nowrap">
                          {money(r.paidAmount)}
                        </td>
                        <td className="px-4 py-3 text-right font-black text-rose-700 whitespace-nowrap">
                          {money(r.remainingAmount)}
                        </td>
                        <td className="px-4 py-3 text-center whitespace-nowrap">
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
                          ) : r.status === 'delayed' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300 animate-pulse">
                              <AlertTriangle size={13} className="text-rose-600" />
                              Gecikti
                            </span>
                          ) : r.status === 'accrualMissing' ? (
                            /* Hakedişi tanımlanmamış personel KIRMIZI yanar. */
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
                              <AlertTriangle size={13} className="text-rose-600" />
                              Hakediş Tanımsız
                            </span>
                          ) : r.status === 'accrued' ? (
                            /* Hakedişi tanımlanmış, maaş günü henüz geçmemiş: YEŞİL. */
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                              <CheckCircle2 size={13} className="text-emerald-600" />
                              Hakediş Tanımlı
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
                            {/*
                              Once HAKEDIS TANIMLANIR (cari ekstreye alacak), sonra odenir.
                              Tanimlanmamis satirda gosterilen tutar yalnizca oneridir.
                            */}
                            {!r.accrualDefined ? (
                              <button
                                type="button"
                                onClick={() => openDefineModal(r)}
                                disabled={defineProcessing}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-400 text-slate-950 hover:bg-amber-300 transition shadow-sm disabled:opacity-60"
                                title="Bu dönemin maaş hakedişini cari ekstreye alacak olarak tanımlar. Para çıkışı yapmaz."
                              >
                                📝 Hakediş Tanımla
                              </button>
                            ) : (
                              <>
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200"
                                  title={r.accrualReferenceNo ?? undefined}
                                >
                                  ✓ Tanımlı
                                </span>
                                {/* Geri alma ayrı ve KIRMIZI düğme: rozete gömülüyken tıklanabilir
                                    olduğu anlaşılmıyordu. */}
                                <button
                                  type="button"
                                  onClick={() => void handleUndoAccrual(r)}
                                  disabled={defineProcessing}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition disabled:opacity-60"
                                  title={`Hakediş tanımını geri al${r.accrualReferenceNo ? ` · ${r.accrualReferenceNo}` : ''}`}
                                >
                                  <Trash2 size={12} />
                                  Hakedişi Geri Al
                                </button>
                              </>
                            )}
                            {r.accrualDefined && r.remainingAmount > 0 ? (
                              <button
                                type="button"
                                onClick={() => {
                                  if (!r.accrualDefined) {
                                    const ok = window.confirm(
                                      `Dikkat: ${r.employeeName} için ${period} dönemi hakedişi henüz cari ekstreye tanımlanmadı.\n\n` +
                                      'Şimdi ödeme yaparsanız ekstrede alacak karşılığı olmadan borç oluşur ve bakiye eksiye düşer.\n\n' +
                                      'Yine de devam edilsin mi?'
                                    )
                                    if (!ok) return
                                  }
                                  setTargetEmployee(r)
                                  setSinglePayAmount(String(r.remainingAmount))
                                  setSinglePayDesc(`${period} Maaş Ödemesi - ${r.employeeName}`)
                                  setSinglePayModalOpen(true)
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-sm"
                              >
                                <DollarSign size={12} />
                                Maaş Yatır
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => {
                                setOverrideEmployee(r)
                                setOverrideAmount(String(r.grossSalary))
                                setOverrideDesc(r.salaryOverrideDescription || '')
                                setOverrideModalOpen(true)
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 transition"
                              title="Bu aya özel maaşı manuel düzenle (Override)"
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

                      {/* Kesinti Detay Satırı (Açılır Kapanır) */}
                      {isExpanded && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={11} className="px-6 py-3 border-y border-slate-200">
                            {/*
                              KESINTI DOKUMU: "Kalan: 90.000" yazmak yetmez, tutarin neden
                              dustugu satir satir gorunmeli. Kalemler sunucudan gelir
                              (salary-status -> breakdown), boylece ekran ile hesap ayrismaz.
                            */}
                            <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2">
                              Hakediş Dökümü
                            </div>
                            <table className="w-full max-w-lg text-xs">
                              <tbody>
                                {(r.breakdown ?? []).map((b) => (
                                  <tr
                                    key={b.key}
                                    className={b.sign === '=' ? 'border-t border-slate-300 font-black' : ''}
                                  >
                                    <td className="py-1.5 text-slate-700">{b.label}</td>
                                    <td
                                      className={`py-1.5 text-right tabular-nums ${
                                        b.amount < 0 ? 'text-rose-700' : b.sign === '=' ? 'text-slate-900' : 'text-emerald-700'
                                      }`}
                                    >
                                      {money(b.amount)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}

                      {isExpanded && hasAdvances && (
                        <tr className="bg-rose-50/50">
                          <td colSpan={11} className="px-6 py-3 border-y border-rose-100">
                            <div className="space-y-1">
                              <div className="text-[11px] font-bold text-rose-800 uppercase tracking-wider flex items-center gap-2">
                                <span>Maaştan Düşülen Avans Kalemleri:</span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mt-1">
                                {r.advances.map((adv) => (
                                  <div key={adv.id} className="p-2 bg-white rounded-lg border border-rose-200 text-xs flex items-center justify-between">
                                    <div>
                                      <div className="font-bold text-slate-800">{adv.description || 'Nakit Avans'}</div>
                                      <div className="text-[10px] text-slate-400">{fmtDate(adv.paymentDate)} {adv.referenceNo ? `· ${adv.referenceNo}` : ''}</div>
                                    </div>
                                    <div className="font-black text-rose-700">-{money(adv.amount)}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
            </AyarliTablo>
          </div>
        </div>

        {/*
          MAAŞ ÖDEME GEÇMİŞİ (2026-10-16). Maaş ödemesini düzenlemenin tek yolu buydu ama bu
          ekranda yoktu (yalnız avans/prim ekranlarında açılıyordu). Ödeme tarihinin ayına
          yazılmış eski maaş ödemeleri (ağustos maaşı eylüle düşmüş) "Düzenle → Ait Olduğu Dönem"
          ile doğru aya taşınır.
        */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 rounded-2xl"
          >
            <span>Maaş Ödeme Geçmişi — düzenle, yanlış aya yazılmış ödemenin dönemini düzelt</span>
            {historyOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {historyOpen && (
            <div className="px-5 pb-5">
              <PaymentReportView
                type={1}
                title="Maaş Ödemeleri"
                subtitle="Kime, ne zaman, hangi dönem için maaş ödendiği."
                helpText="Ödeme tarihi ile dönem ayrıdır: ağustos maaşı eylülde ödenir ama dönemi ağustostur. Eski bir ödeme yanlış aya yazılmışsa satırdaki düzenle ile 'Ait Olduğu Dönem' değiştirilir; o ayın avans mahsubu da taşınır."
                reloadKey={historyReload}
              />
            </div>
          )}
        </div>

        <AccrualDayDetailModal
          isOpen={detailOpen}
          onClose={() => setDetailOpen(false)}
          employeeId={detailTarget?.employeeId ?? null}
          employeeName={detailTarget?.employeeName ?? ''}
          period={period}
          kind={1}
          onSaved={() => void loadData()}
        />

        {/* Hakediş Tanımlama Önizlemesi — ayın nasıl kapandığı burada görülür, tutar düzenlenebilir */}
        <Modal
          isOpen={defineModalOpen}
          onClose={() => setDefineModalOpen(false)}
          title="Hakediş Tanımla"
        >
          {defineTarget && (
            <div className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                <strong>{defineTarget.employeeName}</strong> — <strong>{period}</strong> dönemi.
                Tanımlanan tutar cari ekstreye <strong>alacak</strong> olarak işlenir. Para çıkışı yapmaz;
                ödeme ayrı bir adımdır.
              </div>

              <div>
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Dönem Nasıl Kapandı
                </div>
                <AyarliTablo>
                <table className="w-full text-xs">
                  <tbody>
                    <tr>
                      <td className="py-1 text-slate-600">Dönem</td>
                      <td className="py-1 text-right tabular-nums">
                        {defineTarget.periodStart ?? '—'} → {defineTarget.periodEnd ?? '—'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1 text-slate-600">Geçen / toplam çalışma dakikası</td>
                      <td className="py-1 text-right tabular-nums">
                        {(defineTarget.elapsedMinutes ?? 0).toLocaleString('tr-TR')} / {(defineTarget.totalMinutes ?? 0).toLocaleString('tr-TR')} dk
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1 text-slate-600">Dakika ücreti</td>
                      <td className="py-1 text-right tabular-nums">
                        {money(defineTarget.minuteWage ?? 0)}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-1 text-slate-600">Fiilen çalışılan (mesai kaydı)</td>
                      <td className="py-1 text-right tabular-nums">
                        {(defineTarget.workedMinutes ?? 0).toLocaleString('tr-TR')} dk · {defineTarget.attendedDays ?? 0} gün
                      </td>
                    </tr>
                    <tr className="border-t border-slate-300 font-black">
                      <td className="py-1.5 text-slate-800">Hesaplanan Hakediş</td>
                      <td className="py-1.5 text-right tabular-nums">{money(defineTarget.grossSalary ?? 0)}</td>
                    </tr>
                  </tbody>
                </table>
                </AyarliTablo>
              </div>

              <div className="space-y-1">
                <label htmlFor="def-amount" className="block text-[11px] uppercase tracking-wider text-slate-500">
                  Tanımlanacak Tutar (₺) — istersen elle düzenle
                </label>
                <input
                  id="def-amount"
                  value={defineAmount}
                  inputMode="decimal"
                  onChange={(e) => setDefineAmount(e.target.value.replace(/[^0-9.,]/g, ''))}
                  className="input-base"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="def-note" className="block text-[11px] uppercase tracking-wider text-slate-500">
                  Açıklama
                </label>
                <input
                  id="def-note"
                  value={defineNote}
                  onChange={(e) => setDefineNote(e.target.value)}
                  placeholder={`${period} dönemi maaş hakedişi`}
                  className="input-base"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button type="button" onClick={() => setDefineModalOpen(false)} className="btn-editorial" disabled={defineProcessing}>
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const v = Number(String(defineAmount).replace(',', '.'))
                    void handleDefineOne(defineTarget, Number.isFinite(v) && v > 0 ? v : undefined, defineNote)
                  }}
                  className="btn-primary"
                  disabled={defineProcessing}
                >
                  {defineProcessing ? 'Tanımlanıyor...' : 'Hakedişi Tanımla'}
                </button>
              </div>
            </div>
          )}
        </Modal>

        {/* Tekil Maaş Yatırma Modalı */}
        <Modal
          isOpen={singlePayModalOpen}
          onClose={() => setSinglePayModalOpen(false)}
          title="Personel Maaş Ödemesi Yatır"
        >
          <div className="space-y-4">
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900">
              <strong>{targetEmployee?.employeeName}</strong> için <strong>{period}</strong> dönemi maaşı ödenecek. Bu işlem cari ekstreye borç ve şirket kasasına çıkış kaydı oluşturur.
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Yatırılacak Maaş Tutarı (₺)</label>
              <input
                type="text"
                value={singlePayAmount}
                onChange={(e) => setSinglePayAmount(e.target.value)}
                className="input-base w-full text-lg font-black text-emerald-700"
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
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {singleProcessing ? 'Yatırılıyor...' : 'Maaşı Yatır'}
              </button>
            </div>
          </div>
        </Modal>

        {/* Toplu Maaş Yatırma Modalı */}
        <Modal
          isOpen={bulkPayModalOpen}
          onClose={() => setBulkPayModalOpen(false)}
          title="Seçilen Personellere Toplu Maaş Yatır"
        >
          <div className="space-y-4">
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900">
              Seçilen <strong>{selectedRows.length} personelin</strong> {period} dönemi kalan net maaşları ödenecektir. Toplam tutar: <strong>{money(selectedTotalRemaining)}</strong>.
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
                className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {bulkProcessing ? 'İşleniyor...' : 'Onayla ve Maaşları Yatır'}
              </button>
            </div>
          </div>
        </Modal>

        {/* Aylık Maaşı Manuel Override Etme Modalı */}
        <Modal
          isOpen={overrideModalOpen}
          onClose={() => setOverrideModalOpen(false)}
          title="Aylık Maaş Tutarını Manuel Düzenle (Override)"
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              <strong>{overrideEmployee?.employeeName}</strong> için <strong>{period}</strong> ayına özel maaş tutarını değiştirebilirsiniz. Bu işlem ana çalışan kartındaki standart maaşı <strong>değiştirmez</strong>; yalnızca bu aya uygulanır.
            </p>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Bu Aya Özel Maaş Tutarı (₺)</label>
              <input
                type="text"
                value={overrideAmount}
                onChange={(e) => setOverrideAmount(e.target.value)}
                className="input-base w-full text-lg font-black text-purple-700"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Düzenleme Nedeni / Açıklama</label>
              <input
                type="text"
                value={overrideDesc}
                onChange={(e) => setOverrideDesc(e.target.value)}
                placeholder="Örn: 15 gün ücretsiz izin, ek anlaşma primi"
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
