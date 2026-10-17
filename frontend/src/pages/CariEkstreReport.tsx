import { fetchCariEkstreKapsami, filterCariOptionsByKapsam } from '../utils/cariEkstreKapsami'
import React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Table, { type TableColumn } from '../components/Table'
import { OverflowTooltip } from '../components/common/OverflowTooltip'
import SearchableCariSelect, { type CariOption } from '../components/SearchableCariSelect'
import { CARI_SEARCH_LIMIT, buildCariSearchQuery } from '../utils/cariRemoteSearch'
import Modal from '../components/Modal'
import FormSelect from '../components/forms/FormSelect'
import FormInput from '../components/forms/FormInput'
import { fetchCustomerByCode, fetchCustomersDropdown, updateCustomerQuickContact, type CustomerDto } from '../api/customers'
import { fetchSuppliers, type SupplierDto } from '../api/suppliers'
import { fetchCustomerLedger, fetchCustomerLedgerDetails, type CustomerLedgerDetailLineDto, type CustomerLedgerListItemDto } from '../api/customerLedger'
import { fetchSupplierLedger, fetchSupplierLedgerDetails, type SupplierLedgerDetailLineDto, type SupplierLedgerListItemDto } from '../api/supplierLedger'
import { fetchCustomerChecks, type CustomerCheckDto } from '../api/customerChecks'
import { fetchPayableChecks } from '../api/payableChecks'
import { fetchPayableNotes } from '../api/payableNotes'
import { fetchAccountingPeriods, type AccountingPeriod } from '../services/accountingPeriodService'
import { fetchCustomerAuthorizedContact } from '../api/customerAuthorizedContacts'
import { sendCariEkstreEmail } from '../api/emailService'
import * as XLSX from 'xlsx'
import { ekstreLineDescriptionFallback } from '../lib/ekstreLine'

/** 1/0 = ₺, 2 = €, 3 = $, 4 = £ */
function currencySymbolOf(currencyTypeId?: number | string) {
  const v = Number(currencyTypeId ?? 1)
  if (v === 2) return '€'
  if (v === 3) return '$'
  if (v === 4) return '£'
  return '₺'
}

/**
 * Tutarın yanında para birimi SİMGESİ her zaman yazar.
 *
 * `currencyTypeId` parametresi vardı ama HİÇ KULLANILMIYORDU: dolarlı satır da eurolu satır
 * da çıplak sayı basılıyor, ekranda hangi paradan olduğu anlaşılmıyordu (kullanıcı bildirimi).
 * Simge istenmediği yerde (Excel'e sayı yazarken) bu fonksiyon değil ham sayı kullanılır.
 */
function formatMoney(n: number, currencyTypeId?: number | string) {
  const v = Number(n ?? 0)
  const text = v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (currencyTypeId === undefined || currencyTypeId === null) return text
  return `${currencySymbolOf(currencyTypeId)}${text}`
}

const currencyOptions: Array<{ value: number; label: string }> = [
  { value: 1, label: 'TL' },
  { value: 3, label: 'DOLAR' },
  { value: 2, label: 'EURO' },
  { value: 4, label: 'STERLİN' }
]

function currencyLabel(v: number) {
  // 0 ve 1 her ikisi de TL
  const normalized = v === 0 ? 1 : v
  return currencyOptions.find((x) => x.value === normalized)?.label ?? 'TL'
}

function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Cari Kodu / Adı Ara...",
  disabled = false
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  placeholder?: string
  disabled?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const containerRef = React.useRef<HTMLDivElement>(null)

  const selectedOption = options.find((o) => o.value === value)

  const filteredOptions = useMemo(() => {
    if (!searchTerm.trim()) return options
    const term = searchTerm.toLowerCase()
    return options.filter(
      (o) => o.label.toLowerCase().includes(term) || o.value.toLowerCase().includes(term)
    )
  }, [options, searchTerm])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={containerRef} className="relative w-full">
      <div
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full h-[38px] px-3 bg-white border border-gray-300 rounded shadow-sm flex items-center justify-between text-xs text-gray-900 cursor-pointer ${
          disabled ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'hover:border-primary-500 focus:border-primary-500'
        }`}
      >
        <span className="truncate font-medium">
          {selectedOption ? selectedOption.label : <span className="text-gray-400">{placeholder}</span>}
        </span>
        <svg className="w-4 h-4 text-gray-400 shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {isOpen && !disabled && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-gray-100 bg-gray-50">
            <input
              type="text"
              autoFocus
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filtrele (Kod veya Ad)..."
              className="w-full h-8 px-2.5 text-xs bg-white border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="overflow-y-auto max-h-48 divide-y divide-gray-50">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-xs text-gray-400 text-center">Sonuç bulunamadı</div>
            ) : (
              filteredOptions.map((opt) => (
                <div
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value)
                    setIsOpen(false)
                    setSearchTerm('')
                  }}
                  className={`px-3 py-2 text-xs cursor-pointer hover:bg-primary-50 hover:text-primary-700 transition-colors ${
                    opt.value === value ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-700'
                  }`}
                >
                  {opt.label}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-[220px] max-w-full">
      <div className="text-[11px] text-gray-500 mb-1">{label}</div>
      <div className="h-[38px] bg-gray-200 rounded border border-gray-300 flex items-center justify-end px-3 text-xs text-gray-700">
        {value}
      </div>
    </div>
  )
}

/**
 * KALEM TOPLAMI KDV DAHİLDİR (2026-08-19).
 *
 * Ekstre satırının Borç/Alacak tutarı KDV dahil; kalem dökümü KDV hariç topluyordu.
 * 1.500 $'lık faturanın kalemi 1.363,64 $ görünüyor, aradaki 136,36 $ ekranda
 * "indirim" gibi okunuyordu. Fark KDV'dir, iskonto değil.
 */
/**
 * Kalemleri belgenin GENEL TOPLAMINA oranlar (2026-08-26, kullanıcı bildirimi:
 * ekstrede açılan kalemler iskontoyu hiç göstermiyor).
 *
 * Kalem satırları belgedeki LİSTE tutarını taşıyor; belge iskontosu yalnızca başlıkta
 * duruyor. Bu yüzden A00000000071173'te kalemlerin KDV dahil toplamı 737.299,97 çıkarken
 * ekstre satırı 580.000,00 diyordu — aradaki 157.299,96 iskontoydu ama kalemlerde izi yoktu.
 *
 * Oran, sunucudan ek alan istemeden hesaplanıyor: kalemlerin KDV dahil toplamı ile satırın
 * kendi tutarı. Böylece kalemler HER ZAMAN başlığa eşitlenir; belge iskontolu da olsa
 * iskontosuz da olsa (oran 1) doğru kalır.
 *
 * Güvenlik: satır tutarı yoksa, toplam sıfırsa ya da oran makul aralığın dışındaysa
 * ölçekleme yapılmaz — kalemler ham hâliyle gösterilir.
 */
export function belgeKalemOrani(satirTutari: number, kalemlerKdvDahilToplam: number): number {
  const tutar = Number(satirTutari ?? 0)
  const toplam = Number(kalemlerKdvDahilToplam ?? 0)
  if (!Number.isFinite(tutar) || !Number.isFinite(toplam)) return 1
  if (tutar <= 0 || toplam <= 0) return 1
  const oran = tutar / toplam
  // 0,5–1,0 dışına çıkan oran, kalemlerin belgeyle ilgisiz olduğunu gösterir; dokunma.
  if (oran > 1.0001 || oran < 0.5) return 1
  return oran
}

function lineTotalWithVat(netTotal: number, vatRate: any): number {
  const net = Number(netTotal ?? 0)
  const rate = Number(vatRate ?? 0)
  if (!Number.isFinite(net)) return 0
  if (!Number.isFinite(rate) || rate <= 0) return net
  return Math.round(net * (1 + rate / 100) * 100) / 100
}



/** Arama sonucu satirlarini secim kutusunun bekledigi bicime cevirir. */
function buildCariOptions(customers: CustomerDto[], suppliers: SupplierDto[]): CariOption[] {
  const custOptions: CariOption[] = customers
      .filter((c) => {
        // YALNIZ ÖZEL "MUHTELİF" CARİSİ ELENİR — İÇİNDE GEÇENLER DEĞİL (2026-08-22).
        //
        // Süzgeç `includes` kullanıyordu ve adında "muhtelif" geçen HER cariyi eliyordu.
        // Gerçek kurban: "DİĞER MUHTELİF GİDERLER" (770-…) — hizmet/gider faturalarının
        // yazıldığı cari, ekstre seçim listesinde hiç görünmüyordu. Kullanıcı "770'ler
        // gelmiyor" diye bildirdi; 770'lerin tamamı değil, adında bu kelime geçenler düşüyordu.
        //
        // Elenmesi gereken tek şey, uç tarafından listeye eklenen sözde cari: kodu da adı da
        // tam olarak "MUHTELIF". Bu yüzden karşılaştırma artık TAM EŞLEŞME.
        const code = String(c.customerCode ?? '').trim().toUpperCase()
        const name = String(c.name ?? '').trim().toUpperCase()
        const ozelMuhtelif = (v: string) => v === 'MUHTELIF' || v === 'MUHTELİF'
        return !ozelMuhtelif(code) && !ozelMuhtelif(name)
      })
      .map((c) => ({
        value: c.customerCode,
        label: `(${c.customerCode}) ${c.name}`,
        code: c.customerCode,
        name: c.name,
        phone: c.phone || c.fax || '',
        type: c.customerType === 'gider' ? 'expense' : 'customer',
        customerType: c.customerType || (c.customerCode?.startsWith('120-01') ? '120-01' : c.customerCode?.startsWith('120-02') ? '120-02' : c.customerCode?.startsWith('120-04') ? '120-04' : c.customerCode?.startsWith('120-05') ? '120-05' : c.customerCode?.startsWith('120-06') ? '120-06' : c.customerCode?.startsWith('120-07') ? '120-07' : '120-03')
      }))

    const suppOptions: CariOption[] = suppliers.map((s) => ({
      value: s.supplierCode,
      label: `(${s.supplierCode}) ${s.fullName}`,
      code: s.supplierCode,
      name: s.fullName,
      phone: s.phoneNumber || '',
      type: 'supplier',
      customerType: '320'
    }))

    const map = new Map<string, CariOption>()
    for (const opt of [...custOptions, ...suppOptions]) {
      if (!opt.value) continue
      const existing = map.get(opt.value)
      if (existing) {
        if (opt.value.startsWith('320')) {
          if (opt.type === 'supplier') {
            map.set(opt.value, opt)
          }
        } else {
          if (opt.type !== 'supplier') {
            map.set(opt.value, opt)
          }
        }
      } else {
        map.set(opt.value, opt)
      }
    }
  return Array.from(map.values())
}

export default function CariEkstreReport() {
  type Row = {
    id: number
    cariAdi: string
    displayCustomerCode?: string
    islemHesabi?: string
    teslimCariAdi: string
    tarih: string
    vadeTarihi: string
    belgeNo: string
    aciklama: string
    islemTipi: string
    /** Satırın KENDİ para birimindeki borç tutarı (TL karşılığı ayrı alanda). */
    borc: number
    /** Satırın KENDİ para birimindeki alacak tutarı. */
    alacak: number
    /** Satırın para birimi: 1=TRY 2=EUR 3=USD 4=GBP. Borç/Alacak bu birimde. */
    satirDovizi: number
    /** Borç/Alacak'ın TL karşılığı. TL satırlarda boş gösterilir. */
    tlKarsiligi: number
    dovizTutar: number
    dovizTutarCurrencyTypeId: number
    cevrimKodu: string
    dovizTipi: string
    dovizKur: string | number
    /** Satırın kendi para biriminde yürüyen bakiye. */
    bakiye: number
    /** Bakiye'nin para birimi. */
    bakiyeCurrencyTypeId: number
    hasDetails: boolean
    actions: string
  }


  const location = useLocation()
  const navigate = useNavigate()
  const [accountType, setAccountType] = useState<'customer' | 'supplier' | 'expense'>('customer')

  // `customers` / `suppliers` artik TUM listeyi degil, son aramanin sonucunu tutar
  // (bkz. cariRemoteSearch). Secili kaydin kendisi ayrica cozulur ve bu listelerden
  // bagimsiz durur, yoksa arama degisince secili carinin bilgileri kayboluyordu.
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [customerCode, setCustomerCode] = useState('')
  const [selectedCustomerRecord, setSelectedCustomerRecord] = useState<CustomerDto | null>(null)
  const [selectedSupplierRecord, setSelectedSupplierRecord] = useState<SupplierDto | null>(null)
  // Son arama sonucunun secenekleri: kullanici bir cari sectiginde tur (cari/tedarikci/gider)
  // kararini buradan okuyoruz. `allCariOptions` state'e bagli oldugu icin bir render geride
  // kalabiliyor; ref her zaman guncel.
  const lastCariOptionsRef = useRef<CariOption[]>([])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    let custCode = params.get('customerCode')
    let suppCode = params.get('supplierCode')
    const typeParam = params.get('type')

    if (suppCode && !suppCode.startsWith('320')) {
      custCode = suppCode
      suppCode = null
    } else if (custCode && custCode.startsWith('320')) {
      suppCode = custCode
      custCode = null
    }

    if (custCode) {
      if (typeParam === 'expense' || custCode.startsWith('600') || custCode.startsWith('770')) {
        setAccountType('expense')
      } else {
        setAccountType('customer')
      }
      setCustomerCode(custCode)
      setSupplierCode('')
      void loadCustomerLedger(custCode)
    } else if (suppCode) {
      setAccountType('supplier')
      setSupplierCode(suppCode)
      setCustomerCode('')
      void loadSupplierLedger(suppCode)
    } else {
      setCustomerCode('')
      setSupplierCode('')
      clearTotals()
    }
  }, [location.search])


  const [suppliers, setSuppliers] = useState<SupplierDto[]>([])
  const [supplierCode, setSupplierCode] = useState('')
  const [accountCategory, setAccountCategory] = useState('all')
  const [mail, setMail] = useState('')
  const [phone, setPhone] = useState('')
  const [authorizedPerson, setAuthorizedPerson] = useState<string>('')
  const [authorizedPhone, setAuthorizedPhone] = useState<string>('')
  const [authorizedLoading, setAuthorizedLoading] = useState<boolean>(false)
  const [contactSaving, setContactSaving] = useState(false)
  const [contactSaved, setContactSaved] = useState(false)
  const [subAccountTab, setSubAccountTab] = useState<'ALL' | 'ACIK' | 'FATURA' | 'ASKERIYE'>('ALL')
  // DÖVİZ SEÇİMİ ZORUNLU VE YALNIZ HAREKETİ OLANLAR (2026-08-17, kullanıcı kararı).
  //
  // Önceden "Tümü" vardı ve varsayılan oydu: farklı para birimlerinin satırları tek listede
  // alt alta geliyor, üstteki borç/alacak kutuları da hepsinin TL çapasını tek rakamda
  // topluyordu — "bu adama kaç dolar borçluyuz" sorusu cevapsız kalıyordu. Artık ekran her
  // zaman TEK para birimini gösterir; hareketi olmayan para birimi düğme olarak da çıkmaz.
  const [selectedCurrencyFilter, setSelectedCurrencyFilter] = useState<1 | 2 | 3 | 4>(1)
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null)
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')

  const [mailModalOpen, setMailModalOpen] = useState(false)
  const [mailTarget, setMailTarget] = useState('')
  const [mailSubject, setMailSubject] = useState('')
  const [mailSending, setMailSending] = useState(false)
  const [mailFeedback, setMailFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [mailReportType, setMailReportType] = useState<'SUMMARY' | 'DETAILED'>('SUMMARY')
  const [mailFromDate, setMailFromDate] = useState<string>('')
  const [mailToDate, setMailToDate] = useState<string>('')

  const handleOpenMailModal = () => {
    const activeCode = accountType === 'supplier' ? supplierCode : customerCode
    const activeName = selectedCustomer?.name || selectedSupplier?.fullName || activeCode || 'Cari'
    const dateRangeStr = (fromDate || toDate) ? ` (${fromDate || '...'} - ${toDate || '...'})` : ''
    setMailTarget(mail || '')
    setMailFromDate(fromDate || '')
    setMailToDate(toDate || '')
    setMailReportType('SUMMARY')
    setMailSubject(`Cari Ekstre Özet Raporu - ${activeName}${dateRangeStr}`)
    setMailFeedback(null)
    setMailModalOpen(true)
  }

  const handleSendMailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mailTarget.trim()) {
      setMailFeedback({ type: 'error', message: 'Lütfen geçerli bir e-posta adresi yazınız.' })
      return
    }

    try {
      setMailSending(true)
      setMailFeedback(null)

      const activeCode = accountType === 'supplier' ? supplierCode : customerCode
      const activeName = selectedCustomer?.name || selectedSupplier?.fullName || activeCode || 'Cari'

      // Filter rows based on mailFromDate & mailToDate
      const startIso = mailFromDate ? mailFromDate.trim() : ''
      const endIso = mailToDate ? mailToDate.trim() : ''

      const parseTrDateToIso = (trDate: string): string => {
        if (!trDate) return ''
        // Satır tarihi SAATLİ ("24.09.2026 16:09"); saat kısmı atılmazsa yıl "2026 16:09"
        // olur ve karşılaştırma her satırı "başlangıçtan önce" sayar (2026-09-25 hatası).
        const parts = String(trDate).trim().split(' ')[0].split('.')
        if (parts.length === 3) {
          return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
        }
        return trDate
      }

      let preDebit = 0
      let preCredit = 0
      const filteredRows: typeof calculatedRows = []

      calculatedRows.forEach((r) => {
        const iso = parseTrDateToIso(r.tarih)
        if (startIso && iso && iso < startIso) {
          preDebit += Number(r.borc ?? 0)
          preCredit += Number(r.alacak ?? 0)
        } else if (endIso && iso && iso > endIso) {
          // Excluded
        } else {
          filteredRows.push(r)
        }
      })

      let rowsToMail = filteredRows
      if (startIso && (preDebit > 0 || preCredit > 0)) {
        const devirBakiye = preDebit - preCredit
        const startTr = startIso.split('-').reverse().join('.')
        const firstRow = filteredRows[0]
        const devirRow = {
          id: -99999,
          cariAdi: firstRow?.cariAdi || activeName,
          displayCustomerCode: firstRow?.displayCustomerCode || activeCode,
          islemHesabi: 'Devir',
          teslimCariAdi: '',
          tarih: startTr,
          vadeTarihi: startTr,
          belgeNo: 'DEVİR',
          aciklama: 'Önceki Dönem Devri',
          islemTipi: 'Devir',
          borc: devirBakiye > 0 ? devirBakiye : 0,
          alacak: devirBakiye < 0 ? Math.abs(devirBakiye) : 0,
          satirDovizi: 1,
          tlKarsiligi: Math.abs(devirBakiye),
          dovizTutar: 0,
          dovizTutarCurrencyTypeId: 1,
          cevrimKodu: '',
          dovizTipi: 'TL',
          dovizKur: '1',
          bakiye: devirBakiye,
          bakiyeCurrencyTypeId: 1,
          hasDetails: false,
          actions: ''
        }
        rowsToMail = [devirRow, ...filteredRows]
      }

      const dateRangeText = (mailFromDate || mailToDate) ? `Tarih Aralığı: ${mailFromDate || '...'} - ${mailToDate || '...'}` : 'Tüm Dönem'

      let excelBase64 = ''
      let excelFileName = ''

      if (mailReportType === 'SUMMARY') {
        excelFileName = `cari-ekstre-ozet-${activeCode || 'tum'}.xlsx`
        const aoa: any[][] = [
          ["Cari Adı", "Teslim Cari Adı", "Tarih", "Belge No", "Hareket Türü", "Borç", "Alacak", "Bakiye"]
        ]
        rowsToMail.forEach((row) => {
          const borcVal = Number(row.borc ?? 0)
          const alacakVal = Number(row.alacak ?? 0)
          const bakiyeVal = Number(row.bakiye ?? 0)
          aoa.push([
            row.cariAdi || activeName,
            row.teslimCariAdi || "",
            row.tarih || "",
            row.belgeNo || "",
            row.islemTipi || "Devir",
            borcVal > 0 ? borcVal : 0,
            alacakVal > 0 ? alacakVal : 0,
            bakiyeVal
          ])
        })

        const ws = XLSX.utils.aoa_to_sheet(aoa)
        ws['!cols'] = [{ wch: 30 }, { wch: 25 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]

        // Format currency cells with native Excel number format (#,##0.00)
        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
        for (let R = 1; R <= range.e.r; ++R) {
          ['F', 'G', 'H'].forEach((col) => {
            const cellRef = `${col}${R + 1}`
            if (ws[cellRef] && typeof ws[cellRef].v === 'number') {
              ws[cellRef].t = 'n'
              ws[cellRef].z = '#,##0.00'
            }
          })
        }

        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, ws, 'Cari Ekstre Özet')
        excelBase64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' })
      } else {
        excelFileName = `cari-ekstre-detayli-${activeCode || 'tum'}.xls`
        const rowsWithDetails = rowsToMail.filter((r) => r.hasDetails)
        const detailsMap: Record<number, any[]> = {}

        await Promise.all(
          rowsWithDetails.map(async (r) => {
            try {
              const list = accountType === 'supplier'
                ? await fetchSupplierLedgerDetails(r.id)
                : await fetchCustomerLedgerDetails(r.id)
              detailsMap[r.id] = list || []
            } catch {
              detailsMap[r.id] = []
            }
          })
        )

        let htmlRows = ''
        rowsToMail.forEach((row, index) => {
          const borcVal = Number(row.borc ?? 0)
          const alacakVal = Number(row.alacak ?? 0)
          const bakiyeVal = Number(row.bakiye ?? 0)
          const hasLines = row.hasDetails && detailsMap[row.id] && detailsMap[row.id].length > 0

          htmlRows += `
            <tr style="background-color: #0F172A; color: #FFFFFF; font-weight: bold; font-size: 10.5pt;">
              <td style="padding: 6px 8px; border: 1px solid #334155; white-space: nowrap;">#${index + 1}</td>
              <td style="padding: 6px 8px; border: 1px solid #334155; white-space: nowrap;" colspan="2">${row.tarih || ''}</td>
              <td style="padding: 6px 8px; border: 1px solid #334155; white-space: nowrap; mso-number-format:'\\@';">${row.belgeNo || '—'}</td>
              <td style="padding: 6px 8px; border: 1px solid #334155; white-space: nowrap;">${row.islemTipi || ''}</td>
              <td style="padding: 6px 8px; border: 1px solid #334155; text-align: right; white-space: nowrap; mso-number-format:'#,##0.00';" x:num="${borcVal}">${borcVal > 0 ? borcVal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00'}</td>
              <td style="padding: 6px 8px; border: 1px solid #334155; text-align: right; white-space: nowrap; mso-number-format:'#,##0.00';" x:num="${alacakVal}">${alacakVal > 0 ? alacakVal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00'}</td>
              <td style="padding: 6px 8px; border: 1px solid #334155; text-align: right; white-space: nowrap; mso-number-format:'#,##0.00';" x:num="${bakiyeVal}">${bakiyeVal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          `

          if (row.aciklama || row.teslimCariAdi) {
            htmlRows += `
              <tr style="background-color: #F8FAFC; color: #475569; font-size: 9.5pt;">
                <td colspan="8" style="padding: 4px 8px; border: 1px solid #E2E8F0;">
                  ${row.teslimCariAdi ? `<b>Teslim Cari:</b> ${row.teslimCariAdi} &nbsp;&nbsp;` : ''}
                  ${row.aciklama ? `<b>Açıklama:</b> ${row.aciklama}` : ''}
                </td>
              </tr>
            `
          }

          if (hasLines) {
            htmlRows += `
              <tr style="background-color: #E2E8F0; color: #1E293B; font-weight: bold; font-size: 9.5pt;">
                <td style="padding: 4px 8px; border: 1px solid #CBD5E1; text-align: center;">Sıra</td>
                <td style="padding: 4px 8px; border: 1px solid #CBD5E1;">Stok Kodu</td>
                <td style="padding: 4px 8px; border: 1px solid #CBD5E1;" colspan="2">Stok Adı / Ürün Detayı</td>
                <td style="padding: 4px 8px; border: 1px solid #CBD5E1; text-align: right;">Miktar</td>
                <td style="padding: 4px 8px; border: 1px solid #CBD5E1; text-align: right;">Birim Fiyat</td>
                <td style="padding: 4px 8px; border: 1px solid #CBD5E1; text-align: right;">İndirim/KDV</td>
                <td style="padding: 4px 8px; border: 1px solid #CBD5E1; text-align: right;">Toplam (KDV Dahil)</td>
              </tr>
            `
            // Kalemler belgenin genel toplamına oranlanır (bkz. belgeKalemOrani):
            // kalem satırları liste tutarını taşıyor, belge iskontosu yalnızca başlıkta.
            const _satirTutari = Math.abs(Number(row.borc ?? 0)) + Math.abs(Number(row.alacak ?? 0))
            const _kalemToplam = detailsMap[row.id].reduce((acc: number, it: any) => {
              const q = Number(it?.quantity ?? 0)
              return acc + lineTotalWithVat(Number(it?.total ?? (q * Number(it?.unitPrice ?? 0))), it?.vatRate)
            }, 0)
            const _oran = belgeKalemOrani(_satirTutari, _kalemToplam)
            detailsMap[row.id].forEach((item, lIdx) => {
              const qty = Number(item.quantity ?? 0)
              const unitPrice = Number(item.unitPrice ?? 0) * _oran
              const total = lineTotalWithVat(Number(item.total ?? (qty * Number(item.unitPrice ?? 0))), item.vatRate) * _oran
              const isGift = Boolean(item.isGift)

              htmlRows += `
                <tr style="background-color: ${lIdx % 2 === 0 ? '#FFFFFF' : '#F1F5F9'}; color: #334155; font-size: 9.5pt;">
                  <td style="padding: 4px 8px; border: 1px solid #E2E8F0; text-align: center;">${lIdx + 1}</td>
                  <td style="padding: 4px 8px; border: 1px solid #E2E8F0; mso-number-format:'\\@';">${item.stockCode || '—'}</td>
                  <td style="padding: 4px 8px; border: 1px solid #E2E8F0;" colspan="2">
                    ${item.stockName || ''} ${isGift ? '<span style="color:#059669; font-weight:bold;">(Hediye)</span>' : ''}
                  </td>
                  <td style="padding: 4px 8px; border: 1px solid #E2E8F0; text-align: right;" x:num="${qty}">${qty}</td>
                  <td style="padding: 4px 8px; border: 1px solid #E2E8F0; text-align: right; mso-number-format:'#,##0.00';" x:num="${unitPrice}">${unitPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td style="padding: 4px 8px; border: 1px solid #E2E8F0; text-align: right;">${item.discountAmount ? `-${Number(item.discountAmount).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td>
                  <td style="padding: 4px 8px; border: 1px solid #E2E8F0; text-align: right; font-weight: bold; mso-number-format:'#,##0.00';" x:num="${total}">${total.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              `
            })
          }
        })

        const fullHtml = `
          <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; }
              table { border-collapse: collapse; }
              th, td { white-space: nowrap; }
            </style>
          </head>
          <body>
            <div style="font-size: 14pt; font-weight: bold; color: #0F172A; margin-bottom: 4px;">CARİ EKSTRE DETAYLI RAPORU</div>
            <div style="font-size: 10pt; color: #475569; margin-bottom: 10px;"><b>Cari:</b> ${activeName} (${activeCode}) &nbsp;|&nbsp; <b>${dateRangeText}</b></div>
            <table>
              <thead>
                <tr style="background-color: #0284C7; color: #FFFFFF; font-weight: bold; font-size: 10.5pt;">
                  <th style="padding: 6px 8px; border: 1px solid #0369A1;">Sıra</th>
                  <th style="padding: 6px 8px; border: 1px solid #0369A1;" colspan="2">Tarih</th>
                  <th style="padding: 6px 8px; border: 1px solid #0369A1;">Belge No</th>
                  <th style="padding: 6px 8px; border: 1px solid #0369A1;">İşlem Detayı</th>
                  <th style="padding: 6px 8px; border: 1px solid #0369A1; text-align: right;">Borç</th>
                  <th style="padding: 6px 8px; border: 1px solid #0369A1; text-align: right;">Alacak</th>
                  <th style="padding: 6px 8px; border: 1px solid #0369A1; text-align: right;">Bakiye</th>
                </tr>
              </thead>
              <tbody>
                ${htmlRows}
              </tbody>
            </table>
          </body>
          </html>
        `
        excelBase64 = btoa(unescape(encodeURIComponent('\ufeff' + fullHtml)))
      }

      const reportTypeName = mailReportType === 'DETAILED' ? 'Detaylı Excel Raporu' : 'Özet Excel Raporu'

      const htmlContent = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; color: #1E293B; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #E2E8F0; border-radius: 12px; background-color: #FFFFFF;">
          <div style="background-color: #0F172A; color: #FFFFFF; padding: 20px 24px; border-radius: 8px; text-align: center;">
            <h2 style="margin: 0; font-size: 16pt; font-weight: 700;">CARİ EKSTRE RAPORU</h2>
            <p style="margin: 4px 0 0 0; font-size: 10pt; color: #94A3B8;">B2B ERP Kurumsal Raporlama Sistemi</p>
          </div>
          <div style="padding: 24px 20px; font-size: 11pt; color: #334155; line-height: 1.6;">
            <p style="margin-top: 0;">Sayın Yetkili,</p>
            <p><b>${activeName} (${activeCode || '—'})</b> carisine ait <b>${dateRangeText}</b> dönemini kapsayan <b>${reportTypeName}</b> hazırlanmış olup e-postanın ekinde tarafınıza sunulmuştur.</p>
            
            <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px 20px; margin: 20px 0; font-size: 10.5pt;">
              <p style="margin: 0 0 8px 0;"><b>Cari Adı / Kodu:</b> ${activeName} (${activeCode || '—'})</p>
              <p style="margin: 0 0 8px 0;"><b>Dönem Filtresi:</b> ${dateRangeText}</p>
              <p style="margin: 0 0 8px 0;"><b>Rapor Tipi:</b> ${reportTypeName}</p>
              <p style="margin: 0;"><b>Ekteki Dosya:</b> <span style="font-family: monospace; color: #0284C7; font-weight: bold;">${excelFileName}</span></p>
            </div>

            <p style="font-size: 10pt; color: #64748B; margin-bottom: 0;">Rapora ait hareket ve bakiye detaylarını incelemek için lütfen ekteki Excel dosyasını indiriniz.</p>
          </div>
          <div style="border-top: 1px solid #F1F5F9; padding-top: 16px; text-align: center; font-size: 9pt; color: #94A3B8;">
            Bu e-posta B2B ERP Otomasyon Sistemi tarafından otomatik olarak gönderilmiştir.
          </div>
        </div>
      `

      await sendCariEkstreEmail({
        toEmail: mailTarget.trim(),
        subject: mailSubject,
        customerCode: activeCode || '',
        customerName: activeName,
        fromDate: mailFromDate,
        toDate: mailToDate,
        htmlContent: htmlContent,
        excelBase64: excelBase64,
        excelFileName: excelFileName
      })

      setMailFeedback({ type: 'success', message: `${mailTarget} adresine e-posta ve ekindeki Excel dosyası (${excelFileName}) başarıyla gönderildi!` })
      setTimeout(() => {
        setMailModalOpen(false)
      }, 2500)
    } catch (err: any) {
      setMailFeedback({ type: 'error', message: err?.message || 'E-posta gönderilirken hata oluştu.' })
    } finally {
      setMailSending(false)
    }
  }

  const loadAuthorizedPerson = async (codeToUse?: string) => {
    const code = codeToUse || (accountType === 'supplier' ? supplierCode : customerCode)
    if (!code) {
      setAuthorizedPerson('')
      setAuthorizedPhone('')
      return
    }
    try {
      setAuthorizedLoading(true)
      const contact = await fetchCustomerAuthorizedContact(code)
      if (contact && contact.fullName) {
        setAuthorizedPerson(contact.fullName)
        setAuthorizedPhone(contact.phone || '')
      } else {
        setAuthorizedPerson('')
        setAuthorizedPhone('')
      }
    } catch {
      setAuthorizedPerson('')
      setAuthorizedPhone('')
    } finally {
      setAuthorizedLoading(false)
    }
  }

  const handleSaveContactInfo = async () => {
    const activeCode = accountType === 'supplier' ? supplierCode : customerCode
    if (!activeCode) return

    try {
      setContactSaving(true)
      await updateCustomerQuickContact(activeCode, {
        email: mail,
        phone: phone,
        authorizedPerson: authorizedPerson === 'Yetkili bulunamadı' || authorizedPerson === '—' ? '' : authorizedPerson,
        authorizedPhone: authorizedPhone
      })
      setContactSaved(true)
      setTimeout(() => setContactSaved(false), 3000)
    } catch (err: any) {
      alert(err?.message || 'Cari bilgileri kaydedilirken hata oluştu.')
    } finally {
      setContactSaving(false)
    }
  }

  useEffect(() => {
    void fetchAccountingPeriods().then((data) => {
      const list = data ?? []
      setPeriods(list)
      const defaultPeriod = list.find((p) => !p.isClosed) || list[0]
      if (defaultPeriod) {
        setSelectedPeriodId(defaultPeriod.id)
        
        const params = new URLSearchParams(window.location.search)
        let custCode = params.get('customerCode')
        const suppCode = params.get('supplierCode')
        if (suppCode && !suppCode.startsWith('320')) {
          custCode = suppCode
        }

        if (custCode) {
          void loadCustomerLedger(custCode, undefined, defaultPeriod.id)
        }
      }
    }).catch(() => {})
  }, [])
  const [rawLedgerData, setRawLedgerData] = useState<{
    mail: string
    phone: string
    summary?: any
    openSummary?: any
    invoiceSummary?: any
    /** Para birimi başına bakiye. Hareketi olan her döviz için bir eleman. */
    currencyBalances?: Array<{
      currencyTypeId: number
      currencyCode: string
      currencySymbol: string
      totalDebit: number
      totalCredit: number
      balance: number
      opening: number
    }>
    items: any[]
  } | null>(null)

  /*
    CARİ EKSTRE TİP YETKİSİ (2026-10-11): kullanıcıya açık olmayan tipler listede hiç görünmez.
    Asıl kapı sunucuda (ekstre ucu 403); bu yalnız seçim kolaylığı. null = kısıtlama yok.
  */
  const ekstreKapsamiPromise = useMemo(() => fetchCariEkstreKapsami(), [])
  const [ekstreKapsami, setEkstreKapsami] = useState<string[] | null>(null)
  useEffect(() => {
    void ekstreKapsamiPromise.then(setEkstreKapsami)
  }, [ekstreKapsamiPromise])

  const allCariOptions: CariOption[] = useMemo(
    () => filterCariOptionsByKapsam(buildCariOptions(customers, suppliers), ekstreKapsami),
    [customers, suppliers, ekstreKapsami]
  )


  // Auto-select single customer if user has only 1 customer available (e.g. Bayi / Alt Bayi)
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const urlCustCode = params.get('customerCode')
    const urlSuppCode = params.get('supplierCode')

    if (!urlCustCode && !urlSuppCode && allCariOptions.length === 1 && !customerCode && !supplierCode) {
      const single = allCariOptions[0]
      if (single.type === 'supplier') {
        setAccountType('supplier')
        setSupplierCode(single.value)
        navigate(`/reports/cariEkstre?supplierCode=${single.value}`, { replace: true })
      } else if (single.type === 'expense') {
        setAccountType('expense')
        setCustomerCode(single.value)
        navigate(`/reports/cariEkstre?customerCode=${single.value}&type=expense`, { replace: true })
      } else {
        setAccountType('customer')
        setCustomerCode(single.value)
        navigate(`/reports/cariEkstre?customerCode=${single.value}&type=customer`, { replace: true })
      }
    }
  }, [allCariOptions, customerCode, supplierCode, location.search, navigate])

  const selectedCustomer = useMemo(() => {
    if (accountType === 'customer' || accountType === 'expense') {
      const fromList = customers.find((c) => c.customerCode === customerCode)
      if (fromList) return fromList
      // Tekil kayit yalnizca SECILI koda aitse kullanilir; kod degisip istek daha donmediyse
      // bir onceki carinin fatura tipi/para birimi sizmasin.
      if (selectedCustomerRecord && String(selectedCustomerRecord.customerCode ?? '') === customerCode) {
        return selectedCustomerRecord
      }
    }
    return null
  }, [accountType, customerCode, customers, selectedCustomerRecord])

  const subAccountTabVisibility = useMemo(() => {
    if (!selectedCustomer) {
      return { showFaturaTab: true, showAcikTab: true, showAskeriyeTab: true }
    }

    const invType = String((selectedCustomer as any).invoiceType ?? '').trim().toUpperCase()
    const pgRaw = (selectedCustomer as any).priceGroupCode ?? (selectedCustomer as any).priceGroupId ?? (selectedCustomer as any).priceGroup
    const pgVal = Number(pgRaw)
    const custName = String(selectedCustomer.name ?? '').toUpperCase()
    const code = String(selectedCustomer.customerCode ?? '').trim()

    const isAskeriyeType = invType === 'ASKERIYE' || invType === 'ASKERİYE' || pgVal === 7 || code.endsWith('-3')
    const isAcikType = !isAskeriyeType && (invType === 'ACIK' || invType === 'AÇIK' || (pgVal >= 4 && pgVal <= 6) || code.endsWith('-2'))

    const items = rawLedgerData?.items ?? []
    const hasFaturaTx = items.some((it: any) => String(it.customerCode ?? (it as any).displayCustomerCode ?? '').endsWith('-1'))
    const hasAcikTx = items.some((it: any) => String(it.customerCode ?? (it as any).displayCustomerCode ?? '').endsWith('-2'))
    const hasAskeriyeTx = items.some((it: any) => String(it.customerCode ?? (it as any).displayCustomerCode ?? '').endsWith('-3'))

    if (isAskeriyeType) {
      return {
        showFaturaTab: hasFaturaTx,
        showAcikTab: hasAcikTx,
        showAskeriyeTab: true
      }
    }

    if (isAcikType) {
      return {
        showFaturaTab: true,
        showAcikTab: true,
        showAskeriyeTab: hasAskeriyeTx
      }
    }

    return {
      showFaturaTab: true,
      showAcikTab: hasAcikTx,
      showAskeriyeTab: hasAskeriyeTx
    }
  }, [selectedCustomer, rawLedgerData])

  const selectedSupplier = useMemo(() => {
    if (accountType === 'supplier') {
      const fromList = suppliers.find((s) => s.supplierCode === supplierCode)
      if (fromList) return fromList
      if (selectedSupplierRecord && String(selectedSupplierRecord.supplierCode ?? '') === supplierCode) {
        return selectedSupplierRecord
      }
    }
    return null
  }, [accountType, supplierCode, suppliers, selectedSupplierRecord])

  const activeCurrencyTypeId = useMemo(() => {
    if (selectedCustomer) {
      return Number(selectedCustomer.currencyTypeId ?? 1)
    }
    if (selectedSupplier) {
      return Number((selectedSupplier as any).currencyTypeId ?? 1)
    }
    return 1
  }, [selectedCustomer, selectedSupplier])

  const { calculatedRows, totalDebit, totalCredit, balance } = useMemo(() => {
    if (!rawLedgerData) {
      return { calculatedRows: [], totalDebit: 0, totalCredit: 0, balance: 0 }
    }

    let running = 0
    let totalDeb = 0
    let totalCred = 0

    const mapped = rawLedgerData.items.map((it) => {
      const dt = String(it.date ?? '')
      const dd = String(it.dueDate ?? '')
      const dateTr = dt ? new Date(dt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
      const dueTr = dd ? new Date(dd).toLocaleDateString('tr-TR') : ''

      let rDebit = Number(it.debit ?? 0)
      let rCredit = Number(it.credit ?? 0)

      // Buradaki eski dönüşüm KALDIRILDI (2026-08-14).
      //
      // Cari TL değilse her satır carinin para birimine çevriliyordu: satırın dövizi
      // eşleşmiyorsa tutar kendi kuruna bölünüyordu. Bu, TL satırını (kur 1) bölmeden
      // geçirip carinin dövizi sanıyordu — 14.000 TL'lik borç "14.000 USD" olarak
      // toplanıyordu. Ayrıca Borç/Alacak çevrilirken Bakiye sütunu (aşağıda) backend'in
      // TL değerini kullanıyordu, yani iki sütun farklı para birimindeydi.
      //
      // Hiçbir cari TL dışında olmadığı için bu dal bugüne kadar hiç çalışmadı.
      // Doğrusu: her satır KENDİ para biriminde kalır, bakiye de döviz başına yürür
      // (backend `currencyBalance` / `currencyBalances`).
      rDebit = Math.round(rDebit * 100) / 100
      rCredit = Math.round(rCredit * 100) / 100

      // Satırın KENDİ para birimi ve o para birimindeki tutar. Borç/Alacak sütunları artık
      // bunu gösterir; TL karşılığı ayrı sütunda durur. Çapraz çevrim YOK — TL satırı TL,
      // USD satırı USD kalır.
      const rowCur = Number(it.currencyTypeId ?? 0) <= 0 ? 1 : Number(it.currencyTypeId)
      const rowRate = Number(it.currencyRate ?? 0) > 0 ? Number(it.currencyRate) : 1
      const rowCurAmt = Number(it.currencyAmount ?? 0)
      const toRowCurrency = (tlValue: number) => {
        if (rowCurAmt > 0) return rowCurAmt
        if (rowCur === 1) return tlValue
        return Math.round((tlValue / rowRate) * 100) / 100
      }
      const borcCur = rDebit > 0 ? toRowCurrency(rDebit) : 0
      const alacakCur = rCredit > 0 ? toRowCurrency(rCredit) : 0
      const tlKarsiligi = rDebit > 0 ? rDebit : rCredit

      totalDeb += rDebit
      totalCred += rCredit
      running += rDebit
      running -= rCredit

      // Döviz Tip/Tutar/Kur: ödeme yapılan kasa/bankanın bilgisi
      const rawPaymentCurrTypeId = Number((it as any).paymentCurrencyTypeId ?? it.currencyTypeId ?? 0)
      const paymentCurrTypeId = rawPaymentCurrTypeId === 0 ? 1 : rawPaymentCurrTypeId
      const rawPaymentRate = Number((it as any).paymentCurrencyRate ?? 0)
      const paymentCurrRate = rawPaymentRate > 0 ? rawPaymentRate : 1
      const paymentCurrAmount = Math.round(Number((it as any).paymentCurrencyAmount ?? (it.currencyAmount > 0 ? it.currencyAmount : (rDebit || rCredit))) * 100) / 100

      const cCode = String((it as any).customerCode ?? (it as any).sourceCustomerCode ?? '').trim()
      const isDevirEntry = Boolean((it as any).isOpeningBalance) || String(it.transactionType ?? '').toUpperCase() === 'DEVİR'
      const rawTransType = String((it as any).transactionAccountType ?? '').toUpperCase()
      const transAccountType = rawTransType === 'ASKERIYE'
        ? 'ASKERIYE'
        : (rawTransType === 'FATURA'
          ? 'FATURA'
          : (rawTransType === 'ACIK'
            ? 'ACIK'
            : (cCode.endsWith('-3')
              ? 'ASKERIYE'
              : (cCode.endsWith('-2')
                ? 'ACIK'
                : 'FATURA'))))
      const islemHesabiLabel = isDevirEntry
        ? 'Devir'
        : (transAccountType === 'ASKERIYE'
          ? 'Muaf Hesabı'
          : (transAccountType === 'FATURA'
            ? 'Fatura Hesabı'
            : 'Açık Cari'))

      return {
        id: Number(it.id ?? 0),
        cariAdi: String(it.customerName ?? (it as any).supplierName ?? ''),
        displayCustomerCode: String((it as any).displayCustomerCode ?? it.customerCode ?? ''),
        islemHesabi: islemHesabiLabel,
        teslimCariAdi: String(it.deliveryCustomerName ?? ''),
        tarih: dateTr,
        vadeTarihi: dueTr,
        belgeNo: String(it.documentNo ?? ''),
        aciklama: String(it.description ?? ''),
        islemTipi: String(it.transactionType ?? ''),
        borc: borcCur,
        alacak: alacakCur,
        satirDovizi: rowCur,
        tlKarsiligi: tlKarsiligi,
        dovizTutar: paymentCurrAmount,
        dovizTutarCurrencyTypeId: paymentCurrTypeId,
        // Doviz cevrimi kodu: satir baska bir paradan cevrilerek olustuysa dolu gelir
        // (1.000 $ getirildi, TL kasaya islendi). Muhasebe iki ucu bu kodla eslestirir.
        cevrimKodu: String((it as any).exchangeCode ?? ''),
        dovizTipi: currencyLabel(paymentCurrTypeId),
        dovizKur: paymentCurrRate === 1 ? '1' : paymentCurrRate.toLocaleString('tr-TR', { maximumFractionDigits: 4 }),
        // Bakiye artık satırın KENDİ para biriminde yürür: TL satırı TL bakiyesini,
        // USD satırı USD bakiyesini ilerletir. Tek dövizli caride (bugün hepsi TL)
        // currencyBalance ile balance birebir aynıdır — görünüm değişmez.
        bakiye: Number((it as any).currencyBalance ?? it.balance ?? 0),
        bakiyeCurrencyTypeId: Number(it.currencyTypeId ?? 0) <= 0 ? 1 : Number(it.currencyTypeId),
        hasDetails: Boolean(it.hasDetails),
        actions: ''
      }
    })

    const finalBal = mapped.length > 0 ? mapped[mapped.length - 1].bakiye : (totalDeb - totalCred)

    return {
      calculatedRows: mapped,
      totalDebit: totalDeb,
      totalCredit: totalCred,
      balance: finalBal
    }
  }, [rawLedgerData, activeCurrencyTypeId])

  const columns: TableColumn<Row>[] = useMemo(
    () => [
      { key: 'cariAdi', label: 'Cari Adı', searchable: true },
      { key: 'teslimCariAdi', label: 'Teslim Cari Adı', searchable: true },
      { key: 'tarih', label: 'Tarih', searchable: true, filter: { type: 'date' } },
      { key: 'vadeTarihi', label: 'Vade Tarihi', searchable: true, filter: { type: 'date' } },
      // BELGE NO EKRANDA DA GÖRÜNÜR (2026-08-21 kullanıcı bildirimi).
      //
      // Alan zaten geliyordu (`documentNo` → `belgeNo`) ve Excel çıktısında da vardı, ama
      // EKRANDAKİ ızgarada sütunu yoktu: fatura numarası ekstrede hiçbir yerden okunamıyordu.
      // Ödeme/tahsilat satırlarında belge no olmadığı için orada '—' görünür.
      {
        key: 'belgeNo',
        label: 'Belge No',
        searchable: true,
        render: (v) => <span className="font-semibold text-gray-900">{String(v || '—')}</span>
      },
      {
        key: 'aciklama',
        label: 'Açıklama',
        searchable: true,
        render: (v) => {
          const text = String(v ?? '')
          if (!text) return ''
          const isOverLimit = text.length > 40
          const display = isOverLimit ? `${text.slice(0, 40)}...` : text
          return (
            <OverflowTooltip text={text} alwaysShow={isOverLimit} className="max-w-[240px] truncate">
              {display}
            </OverflowTooltip>
          )
        }
      },
      // Borç / Alacak / Bakiye satırın KENDİ para biriminde ve kendi simgesiyle gösterilir;
      // karışık dövizli ekstrede hangi satırın hangi parada olduğu tek bakışta okunur.
      { key: 'borc', label: 'Borç', searchable: true, render: (v, row) => formatMoney(Number(v ?? 0), Number(row?.satirDovizi ?? 1)) },
      { key: 'alacak', label: 'Alacak', searchable: true, render: (v, row) => formatMoney(Number(v ?? 0), Number(row?.satirDovizi ?? 1)) },
      { key: 'tlKarsiligi', label: 'TL Karşılığı', searchable: true, render: (v, row) => Number(row?.satirDovizi ?? 1) === 1 ? '' : formatMoney(Number(v ?? 0), 1) },
      { key: 'dovizTutar', label: 'Ödeme Tutarı', searchable: true, render: (v, row) => Number(v ?? 0) > 0 ? formatMoney(Number(v), Number(row?.dovizTutarCurrencyTypeId ?? 1)) : '' },
      { key: 'dovizTipi', label: 'Ödeme Dövizi', searchable: true },
      { key: 'dovizKur', label: 'Kur', searchable: true, render: (v) => String(v ?? '') },
      {
        key: 'cevrimKodu',
        label: 'Çevrim Kodu',
        searchable: true,
        render: (v) => {
          const code = String(v ?? '').trim()
          if (!code) return ''
          return (
            <span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-bold whitespace-nowrap">
              {code}
            </span>
          )
        }
      },
      { key: 'bakiye', label: 'Bakiye', searchable: true, render: (v, row) => formatMoney(Number(v ?? 0), Number(row?.bakiyeCurrencyTypeId ?? 1)) },
      {
        key: 'actions',
        label: '',
        render: (_v, row) => (
          <div className="w-6 flex items-center justify-end">
            {row.hasDetails ? <span className="text-gray-500">›</span> : null}
          </div>
        )
      }
    ],
    [activeCurrencyTypeId]
  )

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [expandedDetailsMap, setExpandedDetailsMap] = useState<Record<number, any[]>>({})
  const [loadingDetailsIds, setLoadingDetailsIds] = useState<Set<number>>(new Set())
  const [exportLoading, setExportLoading] = useState(false)

  const [checksModalOpen, setChecksModalOpen] = useState(false)
  const [checksLoading, setChecksLoading] = useState(false)
  const [activeChecks, setActiveChecks] = useState<any[]>([])

  /**
   * AKTİF ÇEKLER — HANGİ KODLARDAN OKUNUR.
   *
   * Çek/senet PARA hareketidir ve para ANA cariye yazılır ([[cari-alt-hesap-kurali]]);
   * ekstre ise alt hesap (`-1/-2/-3`) üzerinden de açılabiliyor. Tek koda sorulunca
   * kullanıcının çeki "yok" görünüyordu. Ana kod + üç alt hesap birlikte sorulur, sonuç
   * kimliğe göre tekilleştirilir.
   */
  const buildCheckAccountCodes = (code: string) => {
    const trimmed = String(code ?? '').trim()
    if (!trimmed) return [] as string[]
    const main = trimmed.replace(/-[123]$/, '')
    return Array.from(new Set([trimmed, main, `${main}-1`, `${main}-2`, `${main}-3`]))
  }

  const loadActiveChecks = async (code: string) => {
    if (!code) return
    try {
      setChecksLoading(true)
      const codes = buildCheckAccountCodes(code)
      const [customerCheckLists, payableCheckLists, payableNoteLists] = await Promise.all([
        Promise.all(codes.map((c) => fetchCustomerChecks({ customerCode: c, take: 1000 }).catch(() => []))),
        Promise.all(codes.map((c) => fetchPayableChecks({ customerCode: c, take: 1000 }).catch(() => []))),
        Promise.all(codes.map((c) => fetchPayableNotes({ customerCode: c, take: 1000 }).catch(() => [])))
      ])

      const dedupeById = <T extends { id?: number | string }>(lists: T[][]) => {
        const seen = new Set<string>()
        const out: T[] = []
        lists.flat().forEach((item) => {
          const key = String((item as any)?.id ?? '')
          if (!key || seen.has(key)) return
          seen.add(key)
          out.push(item)
        })
        return out
      }

      const customerCheckList = dedupeById(customerCheckLists)
      const payableCheckList = dedupeById(payableCheckLists)
      const payableNoteList = dedupeById(payableNoteLists)

      const pendingCustomerChecks = customerCheckList
        .filter((x) => (x.status === 1 || x.status === 2 || x.status === 3) && x.paymentStatus === 1)
        .map((x) => ({
          ...x,
          itemKey: `cc_${x.id}`,
          checkTypeLabel: 'Müşteri Çeki',
          displayCheckNo: x.checkNo || '—',
          displayBankName: x.bankName ? `${x.bankName} / ${x.branchName ?? ''}` : '—'
        }))

      const pendingPayableChecks = payableCheckList
        .filter((x) => Number(x.status ?? 0) === 1)
        .map((x) => ({
          ...x,
          itemKey: `pc_${x.id}`,
          checkTypeLabel: 'Borç Çeki',
          displayCheckNo: x.checkNo || '—',
          displayBankName: x.bankName ? `${x.bankName} / ${x.branchName ?? ''}` : (x.bankAccountName || '—')
        }))

      const pendingPayableNotes = payableNoteList
        .filter((x) => Number(x.status ?? 0) === 1)
        .map((x) => ({
          ...x,
          itemKey: `pn_${x.id}`,
          checkTypeLabel: 'Borç Senedi',
          displayCheckNo: x.noteNo || '—',
          displayBankName: x.bankAccountName || '—'
        }))

      const combined = [...pendingCustomerChecks, ...pendingPayableChecks, ...pendingPayableNotes]
      setActiveChecks(combined)
    } catch (err: any) {
      console.error('Aktif çekler yüklenirken hata:', err)
    } finally {
      setChecksLoading(false)
    }
  }

  useEffect(() => {
    if (checksModalOpen && customerCode) {
      void loadActiveChecks(customerCode)
    }
  }, [checksModalOpen, customerCode])

  /**
   * Çek listesi ekstrenin SEÇİLİ PARA BİRİMİNE göre süzülür. Eskiden süzgeç yoktu ama toplam
   * `activeCurrencyTypeId` (carinin artık okunmayan döviz alanı, fiilen hep TL) ile
   * etiketleniyordu: dolar çekleri TL toplamına karışıyor, kullanıcı seçtiği para biriminde
   * "çekim yok" sanıyordu.
   */
  const currencyFilteredActiveChecks = useMemo(() => {
    return activeChecks.filter((chk) => Number(chk?.currencyTypeId ?? 1) === Number(selectedCurrencyFilter))
  }, [activeChecks, selectedCurrencyFilter])

  const otherCurrencyCheckCount = useMemo(
    () => activeChecks.length - currencyFilteredActiveChecks.length,
    [activeChecks, currencyFilteredActiveChecks]
  )

  const activeChecksTotal = useMemo(() => {
    return currencyFilteredActiveChecks.reduce((sum, chk) => sum + (chk.amount ?? 0), 0)
  }, [currencyFilteredActiveChecks])

  const getCheckStatusLabel = (status: number) => {
    switch (status) {
      case 1: return 'Portföyde'
      case 2: return 'Teminatta'
      case 3: return 'Tahsilatta'
      case 4: return 'Ciro Edildi'
      case 5: return 'Tahsil Edildi'
      case 6: return 'İade Edildi'
      case 7: return 'Karşılıksız'
      default: return 'Bilinmiyor'
    }
  }

  const checkColumns = useMemo<TableColumn<any>[]>(() => [
    {
      key: 'checkTypeLabel',
      label: 'Tür',
      searchable: true,
      sortable: true,
      render: (v, row) => {
        const label = String(row.checkTypeLabel || 'Müşteri Çeki')
        let colorClass = 'text-blue-700 bg-blue-50 border border-blue-100'
        if (label === 'Borç Çeki') colorClass = 'text-purple-700 bg-purple-50 border border-purple-100'
        if (label === 'Borç Senedi') colorClass = 'text-indigo-700 bg-indigo-50 border border-indigo-100'
        return (
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-block ${colorClass}`}>
            {label}
          </span>
        )
      }
    },
    {
      key: 'documentNo',
      label: 'Belge No',
      searchable: true,
      sortable: true,
      render: (v) => <span className="font-semibold text-gray-900">{String(v || '—')}</span>
    },
    {
      key: 'aBordroNo',
      label: 'Bordro No',
      searchable: true,
      sortable: true,
      render: (v) => <span className="text-gray-600 font-mono text-[11px]">{String(v || '—')}</span>
    },
    {
      key: 'displayCheckNo',
      label: 'Çek / Senet No',
      searchable: true,
      sortable: true,
      render: (v, row) => <span className="text-gray-700 font-mono text-[11px]">{String(row.displayCheckNo || row.checkNo || row.noteNo || '—')}</span>
    },
    {
      key: 'displayBankName',
      label: 'Banka / Şube',
      searchable: true,
      sortable: true,
      render: (v, row) => <span className="text-gray-700">{String(row.displayBankName || row.bankName || '—')}</span>
    },
    {
      key: 'dueDate',
      label: 'Vade Tarihi',
      searchable: true,
      sortable: true,
      render: (v) => <span className="text-gray-600">{v ? new Date(v).toLocaleDateString('tr-TR') : '—'}</span>
    },
    {
      key: 'status',
      label: 'Durum',
      sortable: true,
      render: (v, row) => {
        const status = Number(v ?? 0)
        let colorClass = 'text-gray-600 bg-gray-50 border border-gray-100'
        if (status === 1) colorClass = 'text-emerald-700 bg-emerald-50 border border-emerald-100'
        if (status === 2) colorClass = 'text-blue-700 bg-blue-50 border border-blue-100'
        if (status === 3) colorClass = 'text-amber-700 bg-amber-50 border border-amber-100'

        const statusText = row.checkTypeLabel !== 'Müşteri Çeki' && status === 1 ? 'Beklemede' : getCheckStatusLabel(status)
        return (
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-block ${colorClass}`}>
            {statusText}
          </span>
        )
      }
    },
    {
      key: 'amount',
      label: 'Tutar',
      sortable: true,
      render: (v, row) => <span className="font-semibold text-gray-900">{formatMoney(Number(v ?? 0), row.currencyTypeId)}</span>
    }
  ], [])

  // NOT: burada duran `customerOptions`, `supplierOptions` ve `expenseOptions` memo'lari
  // KALDIRILDI (2026-08-22). Ucu de hicbir yerde kullanilmiyordu -- olu koddu -- ama tam
  // cari/tedarikci listesini tuketiyorlardi. Cari secimi sunucu aramasina gecerken bu
  // listeler artik yalnizca son aramanin sonucunu tuttugu icin zaten yanlis sonuc
  // ureteceklerdi.

  const dateFilteredCalculatedRows = useMemo(() => {
    if (!calculatedRows || calculatedRows.length === 0) return []

    const startIso = fromDate ? fromDate.trim() : ''
    const endIso = toDate ? toDate.trim() : ''

    if (!startIso && !endIso) return calculatedRows

    const parseTrDateToIso = (trDate: string): string => {
      if (!trDate) return ''
      // Satır tarihi SAATLİ ("24.09.2026 16:09"); saat kısmı atılmazsa yıl "2026 16:09"
      // olur ve karşılaştırma her satırı "başlangıçtan önce" sayar (2026-09-25 hatası).
      const parts = String(trDate).trim().split(' ')[0].split('.')
      if (parts.length === 3) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
      }
      return trDate
    }

    let preDebit = 0
    let preCredit = 0
    const filtered: typeof calculatedRows = []

    calculatedRows.forEach((r) => {
      const iso = parseTrDateToIso(r.tarih)
      if (startIso && iso && iso < startIso) {
        // TL karşılığı üzerinden toplanır: borc/alacak artık satırın KENDİ para biriminde
        // olduğu için doğrudan toplamak USD ile TL'yi karıştırırdı.
        // Para birimi başına devir backend'den gelir (currencyBalances[].opening);
        // buradaki satır yalnızca tarih süzgecinin TL özetidir.
        const tlDeb = Number(r.satirDovizi ?? 1) === 1 ? Number(r.borc ?? 0) : Number(r.tlKarsiligi ?? 0)
        const tlCred = Number(r.satirDovizi ?? 1) === 1 ? Number(r.alacak ?? 0) : Number(r.tlKarsiligi ?? 0)
        if (Number(r.borc ?? 0) > 0) preDebit += tlDeb
        if (Number(r.alacak ?? 0) > 0) preCredit += tlCred
      } else if (endIso && iso && iso > endIso) {
        // Excluded
      } else {
        filtered.push(r)
      }
    })

    if (startIso && (preDebit > 0 || preCredit > 0)) {
      const devirBakiye = preDebit - preCredit
      const startTr = startIso.split('-').reverse().join('.')
      const firstRow = filtered[0]
      const devirRow = {
        id: -99999,
        cariAdi: firstRow?.cariAdi || '',
        displayCustomerCode: firstRow?.displayCustomerCode || '',
        islemHesabi: 'Devir',
        teslimCariAdi: '',
        tarih: startTr,
        vadeTarihi: startTr,
        belgeNo: 'DEVİR',
        aciklama: 'Önceki Dönem Devri',
        islemTipi: 'Devir',
        borc: devirBakiye > 0 ? devirBakiye : 0,
        alacak: devirBakiye < 0 ? Math.abs(devirBakiye) : 0,
        satirDovizi: 1,
        tlKarsiligi: Math.abs(devirBakiye),
        dovizTutar: 0,
        dovizTutarCurrencyTypeId: 1,
        cevrimKodu: '',
        dovizTipi: 'TL',
        dovizKur: '1',
        bakiye: devirBakiye,
        bakiyeCurrencyTypeId: 1,
        hasDetails: false,
        actions: ''
      }
      return [devirRow, ...filtered]
    }

    return filtered
  }, [calculatedRows, fromDate, toDate])

  const currencyFilteredRows = useMemo(() => {
    return dateFilteredCalculatedRows.filter(
      (r) => Number(r.satirDovizi ?? 1) === selectedCurrencyFilter
    )
  }, [dateFilteredCalculatedRows, selectedCurrencyFilter])

  /**
   * Bu carinin HAREKETİ OLAN para birimleri. Kaynak backend'in döviz bakiyesi vektörü;
   * yoksa (eski yanıt) satırlardan çıkarılır. Boş kalırsa TL gösterilir ki ekran hiç
   * düğmesiz kalmasın.
   */
  const availableCurrencies = useMemo(() => {
    const fromBalances = (rawLedgerData?.currencyBalances ?? [])
      .map((cb) => Number(cb.currencyTypeId))
      .filter((c) => c > 0)

    if (fromBalances.length > 0) return Array.from(new Set(fromBalances)).sort((a, b) => a - b)

    const fromRows = dateFilteredCalculatedRows
      .map((r: any) => Number(r.satirDovizi ?? 1))
      .filter((c) => c > 0)

    const uniq = Array.from(new Set(fromRows)).sort((a, b) => a - b)
    return uniq.length > 0 ? uniq : [1]
  }, [rawLedgerData, dateFilteredCalculatedRows])

  // Seçili para biriminin hareketi yoksa (cari değişti, tarih filtresi daraldı) ilk
  // mevcut para birimine geç — kullanıcı boş ekranla baş başa kalmasın.
  useEffect(() => {
    if (availableCurrencies.length === 0) return
    if (!availableCurrencies.includes(selectedCurrencyFilter)) {
      setSelectedCurrencyFilter(availableCurrencies[0] as 1 | 2 | 3 | 4)
    }
  }, [availableCurrencies, selectedCurrencyFilter])

  const mappedRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = currencyFilteredRows
    if (!q) return list
    return list.filter((x) =>
      String(x.cariAdi ?? '').toLowerCase().includes(q) ||
      String(x.teslimCariAdi ?? '').toLowerCase().includes(q) ||
      String(x.belgeNo ?? '').toLowerCase().includes(q) ||
      String(x.aciklama ?? '').toLowerCase().includes(q) ||
      String(x.islemTipi ?? '').toLowerCase().includes(q)
    )
  }, [currencyFilteredRows, search])

  /**
   * CARI SECIMI SUNUCUDAN ARANIR (2026-08-22).
   *
   * Onceki hali sayfa acilir acilmaz iki SINIRSIZ istek atiyordu: butun cariler (5855 satir)
   * ve butun tedarikciler -- ikincisi `includeCustomers: true` ile ayni cari listesini
   * TEKRAR indiriyordu. Seçim kutusu ikisi de bitene kadar `disabled` durdugu icin
   * tiklanamiyordu; "cari secimi asiri yavas" sikayetinin sebebi buydu.
   *
   * Artik her arama sunucuda suzuluyor ve en fazla CARI_SEARCH_LIMIT satir donuyor.
   * Kutu ilk acilista da bir kez bos sorguyla arar, boylece hicbir sey yazmadan da liste
   * gorunur.
   */
  const cariRemoteSearch = useCallback(async (query: string, typeKey: string): Promise<CariOption[]> => {
    // Tur pastili secili ve kullanici bir sey yazmadiysa, tur onekini SORGU KELIMESI olarak
    // gonderiyoruz: sunucu kod+ad+telefonu birlestirip tariyor, "12001" o turun kodlarini
    // yakaliyor. "Gider" ve "Tumu" disarida -- gider hem 600 hem 770 olabiliyor, tek onekle
    // ifade edilemiyor; onlar istemcideki pastil suzgecine birakildi.
    const q = buildCariSearchQuery(query, typeKey)

    const [custs, sups] = await Promise.all([
      fetchCustomersDropdown({ includeInactive: false, includeMuhtelif: false, q, limit: CARI_SEARCH_LIMIT }).catch(() => [] as CustomerDto[]),
      fetchSuppliers({ includeCustomers: true, q, limit: CARI_SEARCH_LIMIT }).catch(() => [] as SupplierDto[])
    ])

    setCustomers(custs ?? [])
    setSuppliers(sups ?? [])
    const opts = filterCariOptionsByKapsam(buildCariOptions(custs ?? [], sups ?? []), await ekstreKapsamiPromise)
    lastCariOptionsRef.current = opts
    return opts
  }, [ekstreKapsamiPromise])

  // Acilista TEK kucuk istek: hem kutu bos acildiginda gosterilecek liste, hem de "kullanicinin
  // tek carisi varsa otomatik sec" kurali icin sayim. Bayi kullanicilarinda sonuc tek satirdir.
  useEffect(() => {
    void cariRemoteSearch('', 'all')
  }, [cariRemoteSearch])

  // Secili carinin KENDI kaydi. Arama sonuclari her yazista degistigi icin secili kayit
  // listeden dusebiliyor; fatura tipi, fiyat grubu ve para birimi buna bagli oldugundan
  // ayri ve tek satirlik bir istekle cozuluyor.
  useEffect(() => {
    const code = String(customerCode ?? '').trim()
    if (!code || accountType === 'supplier') {
      setSelectedCustomerRecord(null)
      return
    }
    const ac = new AbortController()
    void (async () => {
      try {
        const rec = await fetchCustomerByCode(code, { signal: ac.signal })
        setSelectedCustomerRecord(rec ?? null)
      } catch {
        setSelectedCustomerRecord(null)
      }
    })()
    return () => ac.abort()
  }, [customerCode, accountType])

  useEffect(() => {
    const code = String(supplierCode ?? '').trim()
    if (!code || accountType !== 'supplier') {
      setSelectedSupplierRecord(null)
      return
    }
    const ac = new AbortController()
    void (async () => {
      try {
        // Tedarikcinin koda gore tekil ucu yok; arama ucundan TAM eslesme aliniyor.
        const list = await fetchSuppliers({ includeCustomers: true, q: code, limit: 20, signal: ac.signal })
        setSelectedSupplierRecord((list ?? []).find((x) => String(x.supplierCode ?? '').trim() === code) ?? null)
      } catch {
        setSelectedSupplierRecord(null)
      }
    })()
    return () => ac.abort()
  }, [supplierCode, accountType])

  const clearTotals = () => {
    setRawLedgerData(null)
    setMail('')
    setPhone('')
  }

  const loadCustomerLedger = async (code: string, tab?: 'ALL' | 'ACIK' | 'FATURA' | 'ASKERIYE', overridePeriodId?: number | null) => {
    const c = String(code ?? '').trim()
    if (!c) {
      clearTotals()
      return
    }
    const ac = new AbortController()
    try {
      setLoading(true)
      setError(null)
      setExpandedId(null)
      setExpandedDetailsMap({})

      const targetTab = tab ?? subAccountTab
      const pidToUse = overridePeriodId !== undefined ? overridePeriodId : selectedPeriodId
      const res = await fetchCustomerLedger(c, { accountType: targetTab === 'ALL' ? undefined : targetTab, periodId: pidToUse ?? undefined, signal: ac.signal })
      setMail(String(res?.mail ?? ''))
      setPhone(String(res?.phone ?? ''))
      void loadAuthorizedPerson(c)
      setRawLedgerData({
        mail: String(res?.mail ?? ''),
        phone: String(res?.phone ?? ''),
        summary: res?.summary,
        openSummary: res?.openSummary,
        invoiceSummary: res?.invoiceSummary,
        currencyBalances: (res as any)?.currencyBalances ?? [],
        items: res?.items ?? []
      })
    } catch (e: any) {
      setError(String(e?.message ?? 'Cari ekstre alınamadı'))
      clearTotals()
    } finally {
      setLoading(false)
    }
  }

  const loadSupplierLedger = async (code: string) => {
    const c = String(code ?? '').trim()
    if (!c) {
      clearTotals()
      return
    }
    const ac = new AbortController()
    try {
      setLoading(true)
      setError(null)
      setExpandedId(null)
      setExpandedDetailsMap({})

      const res = await fetchSupplierLedger(c, { signal: ac.signal })
      setMail('')
      setPhone('')
      setRawLedgerData({
        mail: '',
        phone: '',
        summary: res?.summary,
        /*
          DÖVİZ VEKTÖRÜ TEDARİKÇİDE DE OKUNUR (2026-09-01 düzeltmesi).

          Müşteri yolu bunu alıyordu, tedarikçi yolu ALMIYORDU. Alan boş kalınca özet
          kutuları "eski yanıt" sanıp karışık TL toplamına düşüyordu: aynı tedarikçinin
          bir partisi USD, diğeri TL yazıldığında ekstre ikisini tek rakamda topluyor ve
          seçili para biriminin simgesiyle etiketliyordu (20.139.199,17 TL tutarı "$"
          olarak görünüyordu). Artık her para birimi kendi kutusunda.
        */
        currencyBalances: (res as any)?.currencyBalances ?? [],
        items: res?.items ?? []
      })
    } catch (e: any) {
      setError(String(e?.message ?? 'Tedarikçi ekstresi alınamadı'))
      clearTotals()
    } finally {
      setLoading(false)
    }
  }

  /**
   * Ekstreyi tazeler — SUZGECLER KORUNUR (2026-08-24).
   *
   * Bu sayfanin tek bir "listeyi yukle" fonksiyonu yok: ekstre secili hesabin TURUNE gore
   * ayri uclardan geliyor (cari / tedarikci). Bu yuzden dugme, o an hangi hesap seciliyse
   * onun yukleyicisini cagiriyor. Hicbiri secili degilse hicbir sey yapmaz — bos ekranda
   * bosuna istek atmanin anlami yok.
   */
  const yenileEkstre = () => {
    if (accountType === 'supplier' && supplierCode) {
      void loadSupplierLedger(supplierCode)
      return
    }
    if (customerCode) {
      void loadCustomerLedger(customerCode)
    }
  }

  const toggleExpand = async (row: Row) => {
    const id = Number(row.id ?? 0)
    if (!id || id <= 0) return
    if (!row.belgeNo) return // Skip rows without document number (payments, etc)

    if (expandedId === id) {
      setExpandedId(null)
      return
    }

    setExpandedId(id)

    if (expandedDetailsMap[id] && expandedDetailsMap[id].length > 0) {
      return // Already loaded with items for this row
    }

    const ac = new AbortController()
    try {
      setLoadingDetailsIds((prev) => new Set(prev).add(id))
      const list = accountType === 'supplier'
        ? await fetchSupplierLedgerDetails(id, { signal: ac.signal })
        : await fetchCustomerLedgerDetails(id, { signal: ac.signal })

      setExpandedDetailsMap((prev) => ({ ...prev, [id]: list ?? [] }))
    } catch (err) {
      console.error('Error expanding row details:', err)
      setExpandedDetailsMap((prev) => ({ ...prev, [id]: [] }))
    } finally {
      setLoadingDetailsIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const handleOzetExcel = async () => {
    if (mappedRows.length === 0) return

    try {
      setExportLoading(true)
      setError(null)

      const activeCode = accountType === 'supplier' ? supplierCode : customerCode
      const activeName = selectedCustomer?.name || selectedSupplier?.fullName || activeCode || 'Cari'

      /*
        EXCEL PARA BİRİMİ ODAKLI (2026-08-19 kullanıcı isteği).

        Ekstre para birimi başına süzülüyor ama dosya hangi paradan olduğunu hiç
        söylemiyordu: TL ve USD ekstresi birbirinin aynı görünüyordu. Başlık satırında
        seçili para birimi, sütun adlarında para birimi kodu ve satır bazında "Para Birimi"
        sütunu var. Tutarlar SAYI kalır (Excel'de toplanabilsin diye), para birimi ayrı taşınır.
      */
      const curLabel = currencyLabel(selectedCurrencyFilter)

      const aoa: any[][] = []

      aoa.push([`${activeName} - Cari Ekstre (Para Birimi: ${curLabel})`])
      aoa.push([])

      aoa.push([
        "Cari Adı",
        "Teslim Cari Adı",
        "Tarih",
        "Belge No",
        "Hareket Türü",
        "Para Birimi",
        `Borç (${curLabel})`,
        `Alacak (${curLabel})`,
        `Bakiye (${curLabel})`
      ])

      mappedRows.forEach((row) => {
        const borcVal = Number(row.borc ?? 0)
        const alacakVal = Number(row.alacak ?? 0)
        const bakiyeVal = Number(row.bakiye ?? 0)

        aoa.push([
          row.cariAdi || activeName,
          row.teslimCariAdi || "",
          row.tarih || "",
          row.belgeNo || "",
          row.islemTipi || "Devir",
          currencyLabel(Number((row as any).satirDovizi ?? selectedCurrencyFilter)),
          borcVal > 0 ? borcVal : 0,
          alacakVal > 0 ? alacakVal : 0,
          bakiyeVal
        ])
      })

      const ws = XLSX.utils.aoa_to_sheet(aoa)

      // Calculate exact column widths fitting content tightly
      const maxCari = Math.max(12, ...mappedRows.map(r => String(r.cariAdi || activeName).length))
      const maxTeslim = Math.max(15, ...mappedRows.map(r => String(r.teslimCariAdi || '').length))
      const maxBelge = Math.max(12, ...mappedRows.map(r => String(r.belgeNo || '').length))
      const maxIslem = Math.max(14, ...mappedRows.map(r => String(r.islemTipi || '').length))

      ws['!cols'] = [
        { wch: Math.min(maxCari + 2, 40) },
        { wch: Math.min(maxTeslim + 2, 40) },
        { wch: 12 },
        { wch: Math.max(maxBelge + 2, 14) },
        { wch: Math.max(maxIslem + 2, 14) },
        { wch: 12 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 }
      ]

      // Tutar sütunları "Para Birimi" sütunu eklendiği için bir sağa kaydı: F -> G/H/I.
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
      for (let R = 1; R <= range.e.r; ++R) {
        ['G', 'H', 'I'].forEach((col) => {
          const cellRef = `${col}${R + 1}`
          if (ws[cellRef] && typeof ws[cellRef].v === 'number') {
            ws[cellRef].z = '#,##0.00'
          }
        })
      }

      const wb = XLSX.utils.book_new()
      const sheetName = 'Cari Ekstre Özet'
      XLSX.utils.book_append_sheet(wb, ws, sheetName)

      const filename = `cari-ekstre-ozet-${activeCode || 'tum'}-${curLabel}.xlsx`
      XLSX.writeFile(wb, filename)
    } catch (err: any) {
      console.error('Özet Excel hatası:', err)
      setError('Özet Excel oluşturulamadı.')
    } finally {
      setExportLoading(false)
    }
  }

  const handleKalemliDetayliExcel = async () => {
    if (mappedRows.length === 0) return

    try {
      setExportLoading(true)
      setError(null)

      const activeCode = accountType === 'supplier' ? supplierCode : customerCode
      const activeName = selectedCustomer?.name || selectedSupplier?.fullName || activeCode || 'Cari'

      const rowsWithDetails = mappedRows.filter((r) => r.hasDetails)
      const detailsMap: Record<number, any[]> = {}

      await Promise.all(
        rowsWithDetails.map(async (r) => {
          try {
            const list = accountType === 'supplier'
              ? await fetchSupplierLedgerDetails(r.id)
              : await fetchCustomerLedgerDetails(r.id)
            detailsMap[r.id] = list || []
          } catch (err) {
            console.error(`Error loading details for row ${r.id}:`, err)
            detailsMap[r.id] = []
          }
        })
      )

      const dateRangeText = (fromDate || toDate) ? `Tarih Aralığı: ${fromDate || '...'} - ${toDate || '...'}` : 'Tüm Dönem'
      // Dosya hangi para biriminde çekildiğini başlıkta, sütun adlarında ve dosya adında söyler.
      const detayCurLabel = currencyLabel(selectedCurrencyFilter)

      /*
        GERÇEK .XLSX (2026-09-25 kullanıcı isteği). Önceki dosya Excel kılığında bir HTML
        sayfasıydı ve `.xls` adıyla iniyordu; Excel açarken "biçim ve uzantı uyuşmuyor"
        uyarısı veriyordu. `xlsx` (SheetJS CE) biçim yazamadığı için `exceljs` — belge
        satırlarının koyu zemini okunurluğun kendisi. Kütüphane yalnız bu düğmede yüklenir.
      */
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet('Kalemli Ekstre', { views: [{ state: 'frozen', ySplit: 4 }] })

      ws.columns = [
        { width: 8 },   // A  Sıra / Kalem
        { width: 18 },  // B  Tarih / Stok Kodu
        { width: 20 },  // C  Belge No / Stok Adı
        { width: 34 },  // D  İşlem / (Stok Adı)
        { width: 22 },  // E  Montaj
        { width: 10 },  // F  Miktar
        { width: 17 },  // G  Borç / Birim Fiyat
        { width: 17 },  // H  Alacak / İndirim
        { width: 19 }   // I  Bakiye / Toplam
      ]

      const para = '#,##0.00'
      const ince = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } }
      const kenar = { top: ince, left: ince, bottom: ince, right: ince }
      const zemin = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
      const boya = (r: any, fill: string | null, font: any) => {
        for (let c = 1; c <= 9; c++) {
          const cell = r.getCell(c)
          if (fill) cell.fill = zemin(fill)
          cell.font = font
          cell.border = kenar
        }
      }

      ws.mergeCells('A1:I1')
      ws.getCell('A1').value = 'CARİ HAREKET VE KALEM DETAYLI RAPORU'
      ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF0F172A' } }
      ws.mergeCells('A2:I2')
      ws.getCell('A2').value = `Cari: ${activeName} (${activeCode})   |   ${dateRangeText}   |   Para Birimi: ${detayCurLabel}`
      ws.getCell('A2').font = { size: 10, color: { argb: 'FF475569' } }

      const baslik = ws.getRow(4)
      baslik.values = ['Sıra', 'Tarih', 'Belge No', 'İşlem / Kalem Detayı', '', '', `Borç (${detayCurLabel})`, `Alacak (${detayCurLabel})`, `Bakiye (${detayCurLabel})`]
      ws.mergeCells('D4:F4')
      boya(baslik, 'FF0284C7', { bold: true, color: { argb: 'FFFFFFFF' } })
      ;[7, 8, 9].forEach((c) => { baslik.getCell(c).alignment = { horizontal: 'right' } })

      let r = 5
      mappedRows.forEach((row, index) => {
        const borcVal = Number(row.borc ?? 0)
        const alacakVal = Number(row.alacak ?? 0)
        const bakiyeVal = Number(row.bakiye ?? 0)
        const lines = (row.hasDetails && detailsMap[row.id]) ? detailsMap[row.id] : []

        const belge = ws.getRow(r)
        belge.values = [`#${index + 1}`, row.tarih || '', row.belgeNo || '—', row.islemTipi || '', '', '', borcVal, alacakVal, bakiyeVal]
        ws.mergeCells(`D${r}:F${r}`)
        boya(belge, 'FF0F172A', { bold: true, color: { argb: 'FFFFFFFF' } })
        ;[7, 8, 9].forEach((c) => { belge.getCell(c).numFmt = para })
        belge.getCell(3).numFmt = '@'
        r++

        if (row.aciklama || row.teslimCariAdi) {
          const bilgi = ws.getRow(r)
          bilgi.getCell(1).value = [
            row.teslimCariAdi ? `Teslim Cari: ${row.teslimCariAdi}` : '',
            row.aciklama ? `Açıklama: ${row.aciklama}` : ''
          ].filter(Boolean).join('    ')
          ws.mergeCells(`A${r}:I${r}`)
          boya(bilgi, 'FFF8FAFC', { size: 9, color: { argb: 'FF475569' } })
          r++
        }

        if (lines.length > 0) {
          const kb = ws.getRow(r)
          kb.values = ['Kalem', 'Stok Kodu', 'Stok Adı / Ürün Detayı', '', 'Montaj', 'Miktar', 'Birim Fiyat', 'İndirim/KDV', 'Toplam (KDV Dahil)']
          ws.mergeCells(`C${r}:D${r}`)
          boya(kb, 'FFE2E8F0', { bold: true, size: 9, color: { argb: 'FF1E293B' } })
          ;[6, 7, 8, 9].forEach((c) => { kb.getCell(c).alignment = { horizontal: 'right' } })
          r++

          // Kalemler belgenin genel toplamına oranlanır (bkz. belgeKalemOrani):
          // kalem satırları liste tutarını taşıyor, belge iskontosu yalnızca başlıkta.
          const satirTutari = Math.abs(borcVal) + Math.abs(alacakVal)
          const kalemToplam = lines.reduce((acc: number, it: any) => {
            const q = Number(it?.quantity ?? 0)
            return acc + lineTotalWithVat(Number(it?.total ?? (q * Number(it?.unitPrice ?? 0))), it?.vatRate)
          }, 0)
          const oran = belgeKalemOrani(satirTutari, kalemToplam)

          lines.forEach((item: any, lIdx: number) => {
            const qty = Number(item.quantity ?? 0)
            const unitPrice = Number(item.unitPrice ?? 0) * oran
            const total = lineTotalWithVat(Number(item.total ?? (qty * Number(item.unitPrice ?? 0))), item.vatRate) * oran
            const montaj = String(item.montaj || item.installationName || '').trim()

            const k = ws.getRow(r)
            k.values = [
              lIdx + 1,
              item.stockCode || '—',
              `${item.stockName || ''}${item.isGift ? ' (Hediye)' : ''}`,
              '',
              montaj || '—',
              qty,
              unitPrice,
              item.discountAmount ? -Number(item.discountAmount) : '—',
              total
            ]
            ws.mergeCells(`C${r}:D${r}`)
            boya(k, lIdx % 2 === 0 ? 'FFFFFFFF' : 'FFF1F5F9', { size: 9, color: { argb: 'FF334155' } })
            k.getCell(1).alignment = { horizontal: 'center' }
            k.getCell(2).numFmt = '@'
            ;[7, 8, 9].forEach((c) => { k.getCell(c).numFmt = para })
            k.getCell(9).font = { size: 9, bold: true, color: { argb: 'FF334155' } }
            r++
          })
        }
      })

      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `cari-ekstre-kalemli-${activeCode || 'tum'}-${detayCurLabel}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      console.error('Kalemli Excel hatası:', err)
      setError('Kalemli Excel oluşturulamadı.')
    } finally {
      setExportLoading(false)
    }
  }

  const renderExpandedRow = (row: Row) => {
    const id = Number(row.id ?? 0)
    const isLoading = loadingDetailsIds.has(id)
    const rowDetails = expandedDetailsMap[id]

    // Satırın kendi para birimi. Öncesinde var olmayan iki alan (`currencyTypeId`,
    // `dovizTipId`) deneniyor, ikisi de undefined döndüğü için hep carinin dövizine
    // düşülüyordu — artık satırın gerçek dövizi kullanılıyor.
    const parentCurTypeId = Number(row.satirDovizi ?? activeCurrencyTypeId ?? 1)
    const rate = Number(row.dovizKur ?? 1) > 0 ? Number(row.dovizKur) : 1

    return (
      <div className="bg-white border border-gray-200 rounded-md overflow-hidden p-2 my-1 shadow-sm">
        {isLoading ? (
          <div className="p-3 text-xs text-gray-500 font-semibold animate-pulse">Fatura kalemleri yükleniyor...</div>
        ) : null}
        {!isLoading && (!rowDetails || rowDetails.length === 0) ? (
          <div className="p-3 text-xs text-gray-500 italic">Veri yok</div>
        ) : null}
        {!isLoading && rowDetails && rowDetails.length > 0 ? (() => {
          // Kalemler belgenin genel toplamına oranlanır — bkz. belgeKalemOrani.
          const satirTutari = Math.abs(Number(row.borc ?? 0)) + Math.abs(Number(row.alacak ?? 0))
          const kalemToplam = rowDetails.reduce((acc: number, it: any) => {
            const q = Number(it?.quantity ?? 1)
            const cid = Number(it?.currencyTypeId ?? parentCurTypeId) || parentCurTypeId
            const taban = cid > 1
              ? Number(it?.currencyUnitPrice > 0 ? it.currencyUnitPrice : (Number(it?.unitPrice ?? 0) / rate)) * q
              : Number(it?.total ?? (q * Number(it?.unitPrice ?? 0)))
            return acc + lineTotalWithVat(taban, Number(it?.vatRate ?? 0))
          }, 0)
          const kalemOrani = belgeKalemOrani(satirTutari, kalemToplam)
          return (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse border border-gray-200 bg-white">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-gray-200">
                <tr>
                  <th className="p-2 border-r border-gray-200">Stok Kodu</th>
                  <th className="p-2 border-r border-gray-200">Stok Adı</th>
                  <th className="p-2 border-r border-gray-200">Açıklama</th>
                  <th className="p-2 border-r border-gray-200">Montaj</th>
                  <th className="p-2 border-r border-gray-200 text-right">Miktar</th>
                  <th className="p-2 border-r border-gray-200 text-right">Fiyat</th>
                  <th className="p-2 text-right">Toplam (KDV Dahil)</th>
                </tr>
              </thead>
              <tbody>
                {rowDetails.map((item, idx) => {
                  const name = String(item.stockName || '')
                  // Açıklama boşsa belgenin niteliği yazılır (iade kaleminde `-` kalıyordu).
                  const lineDesc = String(item.description || '') || ekstreLineDescriptionFallback(row.islemTipi)
                  const isLineDescOver = lineDesc.length > 40
                  const displayLineDesc = isLineDescOver ? `${lineDesc.slice(0, 40)}...` : lineDesc
                  const isGift = Boolean(item?.isGift || name.toLowerCase().includes('hediye'))
                  const displayName = isGift && !name.toLowerCase().includes('hediye') ? `${name} (Hediye Ürün)` : (name || lineDesc || '-')

                  const itemCurTypeId = Number(item?.currencyTypeId ?? parentCurTypeId)
                  const curIdToUse = itemCurTypeId > 0 ? itemCurTypeId : parentCurTypeId
                  const qty = Number(item?.quantity ?? 1)

                  let priceStr = ''
                  let totalStr = ''

                  // Toplam KDV DAHİL: ekstre satırının tutarıyla aynı ölçüde olsun diye
                  // (bkz. lineTotalWithVat). Fiyat sütunu KDV hariç birim fiyattır.
                  const itemVatRate = Number(item?.vatRate ?? 0)

                  if (isGift) {
                    priceStr = formatMoney(0.01, curIdToUse)
                    totalStr = formatMoney(0.01 * qty, curIdToUse)
                  } else if (curIdToUse > 1) {
                    const fxPrice = Number(item?.currencyUnitPrice > 0 ? item.currencyUnitPrice : (Number(item?.unitPrice ?? 0) / rate))
                    priceStr = formatMoney(fxPrice * kalemOrani, curIdToUse)
                    totalStr = formatMoney(lineTotalWithVat(fxPrice * qty, itemVatRate) * kalemOrani, curIdToUse)
                  } else {
                    priceStr = formatMoney(Number(item?.unitPrice ?? 0) * kalemOrani, 1)
                    totalStr = formatMoney(lineTotalWithVat(Number(item?.total ?? (qty * Number(item?.unitPrice ?? 0))), itemVatRate) * kalemOrani, 1)
                  }

                  const montajVal = String(item.montaj || item.installationName || '')

                  return (
                    <tr key={item.id || idx} className="border-b border-gray-100 hover:bg-slate-50 transition-colors">
                      <td className="p-2 border-r border-gray-200 font-mono text-slate-800 max-w-[140px]">
                        <OverflowTooltip>{item.stockCode || '-'}</OverflowTooltip>
                      </td>
                      <td className="p-2 border-r border-gray-200 font-medium text-slate-900 max-w-[320px]">
                        <OverflowTooltip>{displayName}</OverflowTooltip>
                      </td>
                      <td className="p-2 border-r border-gray-200 text-slate-700 max-w-[200px]">
                        <OverflowTooltip text={lineDesc} alwaysShow={isLineDescOver}>{displayLineDesc || '-'}</OverflowTooltip>
                      </td>
                      <td className="p-2 border-r border-gray-200 text-slate-700 max-w-[140px]">
                        <OverflowTooltip>{montajVal || '-'}</OverflowTooltip>
                      </td>
                      <td className="p-2 border-r border-gray-200 text-right font-medium text-slate-800 whitespace-nowrap">
                        <OverflowTooltip className="text-right justify-end">{item.quantity}</OverflowTooltip>
                      </td>
                      <td className="p-2 border-r border-gray-200 text-right text-slate-800 whitespace-nowrap">
                        <OverflowTooltip className="text-right justify-end">{priceStr}</OverflowTooltip>
                      </td>
                      <td className="p-2 text-right font-semibold text-slate-900 whitespace-nowrap">
                        <OverflowTooltip className="text-right justify-end">{totalStr}</OverflowTooltip>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          )
        })() : null}
      </div>
    )
  }

  return (
    <div>
      <Modal
        isOpen={checksModalOpen}
        onClose={() => setChecksModalOpen(false)}
        title="Aktif Çeklerim (Portföy & Beklemede)"
        containerClassName="max-w-4xl max-h-[90vh]"
        footer={
          <button
            type="button"
            onClick={() => setChecksModalOpen(false)}
            className="px-4 py-2 rounded-md text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            Kapat
          </button>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Seçili carinin (ana hesap ve <b>-1/-2/-3</b> alt hesapları dâhil) portföyümüzde/beklemede bulunan ve
            henüz ödemesi tamamlanmamış çek ve senetleri. Liste, ekstrede seçili para birimine göre süzülür.
          </p>

          <div className="bg-zinc-50 border border-gray-200 rounded-xl p-4 flex justify-between items-center">
            <span className="text-xs font-bold text-gray-600">
              Toplam Aktif Çek &amp; Senet Tutarı ({currencyLabel(selectedCurrencyFilter)}):
            </span>
            <span className="text-base font-black text-blue-600">{formatMoney(activeChecksTotal, selectedCurrencyFilter)}</span>
          </div>

          {otherCurrencyCheckCount > 0 && (
            <div className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Başka para birimlerinde {otherCurrencyCheckCount} aktif çek/senet daha var. Görmek için üstteki para
              birimi sekmesini değiştirin.
            </div>
          )}

          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden relative">
            {checksLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-xs font-semibold">Çekler Yükleniyor...</p>
              </div>
            ) : currencyFilteredActiveChecks.length === 0 ? (
              <div className="text-center py-12 text-xs text-gray-400">
                {currencyLabel(selectedCurrencyFilter)} cinsinden aktif çek veya senet bulunmamaktadır.
              </div>
            ) : (
              <div className="overflow-x-auto w-full">
                <Table
          onRefresh={yenileEkstre}
                  columns={checkColumns}
                  data={currencyFilteredActiveChecks}
                  showColumnFilters={false}
                  rowKey={(row) => row.itemKey || row.id}
                  rowClassName={() => 'hover:bg-gray-50/40 transition-colors'}
                />
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={mailModalOpen}
        onClose={() => setMailModalOpen(false)}
        title="Cari Ekstre E-Posta Gönder"
        containerClassName="max-w-lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setMailModalOpen(false)}
              disabled={mailSending}
              className="px-4 py-2 rounded-lg text-xs font-semibold border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={handleSendMailSubmit}
              disabled={mailSending || !mailTarget.trim()}
              className="px-5 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              {mailSending ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Gönderiliyor...
                </>
              ) : (
                '📧 E-Posta ve Excel Gönder'
              )}
            </button>
          </div>
        }
      >
        <form onSubmit={handleSendMailSubmit} className="space-y-4">
          {mailFeedback && (
            <div className={`p-3 rounded-lg text-xs font-semibold ${mailFeedback.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {mailFeedback.message}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-gray-800 mb-1.5">Gönderilecek Rapor Tipi (Excel Eki) *</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMailReportType('SUMMARY')
                  const activeName = selectedCustomer?.name || selectedSupplier?.fullName || customerCode || supplierCode || 'Cari'
                  const dateRangeStr = (mailFromDate || mailToDate) ? ` (${mailFromDate || '...'} - ${mailToDate || '...'})` : ''
                  setMailSubject(`Cari Ekstre Özet Raporu - ${activeName}${dateRangeStr}`)
                }}
                className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${mailReportType === 'SUMMARY' ? 'border-emerald-600 bg-emerald-50/50 ring-2 ring-emerald-500/20 text-emerald-900' : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700'}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold flex items-center gap-1">📊 Özet Excel</span>
                  {mailReportType === 'SUMMARY' && <span className="w-2 h-2 rounded-full bg-emerald-600"></span>}
                </div>
                <span className="text-[11px] text-gray-500 font-normal">Standart hareket tablosu (borç, alacak, bakiye)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMailReportType('DETAILED')
                  const activeName = selectedCustomer?.name || selectedSupplier?.fullName || customerCode || supplierCode || 'Cari'
                  const dateRangeStr = (mailFromDate || mailToDate) ? ` (${mailFromDate || '...'} - ${mailToDate || '...'})` : ''
                  setMailSubject(`Cari Ekstre Detaylı Raporu - ${activeName}${dateRangeStr}`)
                }}
                className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${mailReportType === 'DETAILED' ? 'border-emerald-600 bg-emerald-50/50 ring-2 ring-emerald-500/20 text-emerald-900' : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700'}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold flex items-center gap-1">📋 Detaylı Excel</span>
                  {mailReportType === 'DETAILED' && <span className="w-2 h-2 rounded-full bg-emerald-600"></span>}
                </div>
                <span className="text-[11px] text-gray-500 font-normal">Fatura ve belge altındaki tüm ürün satırları dahil</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-800 mb-1.5">Tarih Aralığı Filtresi (İsteğe Bağlı)</label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-[10px] text-gray-500 font-semibold mb-0.5 block">Başlangıç Tarihi</span>
                <input
                  type="date"
                  value={mailFromDate}
                  onChange={(e) => {
                    const newFrom = e.target.value
                    setMailFromDate(newFrom)
                    const activeName = selectedCustomer?.name || selectedSupplier?.fullName || customerCode || supplierCode || 'Cari'
                    const dateRangeStr = (newFrom || mailToDate) ? ` (${newFrom || '...'} - ${mailToDate || '...'})` : ''
                    const titlePrefix = mailReportType === 'DETAILED' ? 'Cari Ekstre Detaylı Raporu' : 'Cari Ekstre Özet Raporu'
                    setMailSubject(`${titlePrefix} - ${activeName}${dateRangeStr}`)
                  }}
                  className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 font-medium"
                />
              </div>
              <div>
                <span className="text-[10px] text-gray-500 font-semibold mb-0.5 block">Bitiş Tarihi</span>
                <input
                  type="date"
                  value={mailToDate}
                  onChange={(e) => {
                    const newTo = e.target.value
                    setMailToDate(newTo)
                    const activeName = selectedCustomer?.name || selectedSupplier?.fullName || customerCode || supplierCode || 'Cari'
                    const dateRangeStr = (mailFromDate || newTo) ? ` (${mailFromDate || '...'} - ${newTo || '...'})` : ''
                    const titlePrefix = mailReportType === 'DETAILED' ? 'Cari Ekstre Detaylı Raporu' : 'Cari Ekstre Özet Raporu'
                    setMailSubject(`${titlePrefix} - ${activeName}${dateRangeStr}`)
                  }}
                  className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 font-medium"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Alıcı E-Posta Adresi *</label>
            <input
              type="email"
              required
              value={mailTarget}
              onChange={(e) => setMailTarget(e.target.value.toLocaleLowerCase('tr-TR'))}
              placeholder="ornek@firma.com"
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 font-medium"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">E-Posta Konusu</label>
            <input
              type="text"
              value={mailSubject}
              onChange={(e) => setMailSubject(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 font-medium"
            />
          </div>

          <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-3 space-y-1 text-xs text-gray-700">
            <div className="font-bold text-emerald-900 flex items-center justify-between">
              <span>Gönderim Özeti:</span>
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                {mailReportType === 'SUMMARY' ? 'Özet Excel Eki' : 'Detaylı Excel Eki'}
              </span>
            </div>
            <div><b>Cari:</b> {selectedCustomer?.name || selectedSupplier?.fullName || customerCode || supplierCode}</div>
            <div><b>Tarih Aralığı:</b> {(mailFromDate || mailToDate) ? `${mailFromDate || '...'} - ${mailToDate || '...'}` : 'Tüm Dönem'}</div>
            <div><b>Eklenecek Dosya:</b> <code className="font-mono text-emerald-800 bg-white px-1.5 py-0.5 rounded border border-emerald-200">{mailReportType === 'SUMMARY' ? `cari-ekstre-ozet-${customerCode || supplierCode || 'tum'}.xlsx` : `cari-ekstre-detayli-${customerCode || supplierCode || 'tum'}.xls`}</code></div>
          </div>
        </form>
      </Modal>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Cari Hareket Kayıtları</h1>
          <p className="text-xs text-gray-400 mt-0.5">Raporlar / Cari Ekstre</p>
        </div>
      </div>

      <div className="flex items-start justify-between gap-6 mb-4">
        <div className="flex-1">
          <div className="flex items-start gap-6 flex-wrap">

            <div className="w-[340px] max-w-full">
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">CARİ SEÇİMİ (İSİM, KOD VEYA TELEFON)</div>
              <SearchableCariSelect
                value={accountType === 'supplier' ? supplierCode : customerCode}
                accountType={accountCategory}
                onAccountTypeChange={(cat) => setAccountCategory(cat)}
                onChange={(v) => {
                  if (!v) {
                    setCustomerCode('')
                    setSupplierCode('')
                    setAuthorizedPerson('')
                    navigate('/reports/cariEkstre', { replace: true })
                    return
                  }

                  const matched = lastCariOptionsRef.current.find((o) => o.value === v) ?? allCariOptions.find((o) => o.value === v)
                  if (matched?.type === 'supplier' || v.startsWith('320')) {
                    setAccountType('supplier')
                    setSupplierCode(v)
                    setCustomerCode('')
                    navigate(`/reports/cariEkstre?supplierCode=${v}`, { replace: true })
                  } else if (matched?.type === 'expense' || v.startsWith('600') || v.startsWith('770')) {
                    setAccountType('expense')
                    setCustomerCode(v)
                    setSupplierCode('')
                    navigate(`/reports/cariEkstre?customerCode=${v}&type=expense`, { replace: true })
                  } else {
                    setAccountType('customer')
                    setCustomerCode(v)
                    setSupplierCode('')
                    navigate(`/reports/cariEkstre?customerCode=${v}&type=customer`, { replace: true })
                  }
                  void loadAuthorizedPerson(v)
                }}
                options={allCariOptions}
                remoteSearch={cariRemoteSearch}
                remoteLimit={CARI_SEARCH_LIMIT}
                placeholder="Cari İsim, Telefon (05xx) veya Cari Kodu ile Ara..."
              />
            </div>

            <div className="w-36 max-w-full">
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">MALİ DÖNEM</div>
              <select
                value={selectedPeriodId ?? ''}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : null
                  setSelectedPeriodId(val)
                  if (accountType === 'supplier') {
                    if (supplierCode) {
                      void loadSupplierLedger(supplierCode)
                    }
                  } else {
                    if (customerCode) {
                      void loadCustomerLedger(customerCode, subAccountTab, val)
                    }
                  }
                }}
                className="w-full h-[42px] px-2.5 bg-white border border-gray-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              >
                <option value="">Tüm Dönemler</option>
                {periods.map((p) => {
                  const dateStr = p.startDate ? `${new Date(p.startDate).toLocaleDateString('tr-TR')} ${new Date(p.startDate).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` : ''
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} {dateStr ? `(${dateStr})` : ''} {p.isClosed ? '🔒 Kapalı' : '🟢 Aktif'}
                    </option>
                  )
                })}
              </select>
            </div>

            <div className="w-[130px]">
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">BAŞLANGIÇ</div>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full h-[42px] px-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              />
            </div>

            <div className="w-[130px]">
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">BİTİŞ</div>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full h-[42px] px-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              />
            </div>

            <div className="w-[150px]">
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">MAIL</div>
              <input
                type="text"
                value={mail}
                onChange={(e) => setMail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleSaveContactInfo()}
                placeholder="E-posta yazınız"
                className="w-full h-[42px] px-2.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              />
            </div>

            <div className="w-[125px]">
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">TELEFON</div>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleSaveContactInfo()}
                placeholder="05xx xxx xxxx"
                className="w-full h-[42px] px-2.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              />
            </div>

            <div className="w-[150px]">
              <div className="flex items-center justify-between text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                <span>YETKİLİ ADI</span>
                <button
                  type="button"
                  onClick={() => loadAuthorizedPerson()}
                  disabled={!(accountType === 'supplier' ? supplierCode : customerCode) || authorizedLoading}
                  className="text-[10px] text-indigo-600 hover:text-indigo-800 disabled:opacity-40 font-bold underline transition"
                >
                  {authorizedLoading ? '...' : '👤 Getir'}
                </button>
              </div>
              <input
                type="text"
                value={authorizedPerson}
                onChange={(e) => setAuthorizedPerson(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleSaveContactInfo()}
                placeholder="Yetkili adı yazınız"
                className="w-full h-[42px] px-2.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              />
            </div>

            <div className="w-[125px]">
              <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">YETKİLİ TEL</div>
              <input
                type="text"
                value={authorizedPhone}
                onChange={(e) => setAuthorizedPhone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleSaveContactInfo()}
                placeholder="05xx xxx xxxx"
                className="w-full h-[42px] px-2.5 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
              />
            </div>

            <div className="w-[85px] self-end">
              <button
                type="button"
                onClick={handleSaveContactInfo}
                disabled={!(accountType === 'supplier' ? supplierCode : customerCode) || contactSaving}
                className={`w-full h-[42px] px-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1 shadow-sm cursor-pointer ${
                  contactSaved
                    ? 'bg-emerald-600 text-white ring-2 ring-emerald-400/50'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50'
                }`}
                title="Mail, Telefon, Yetkili Adı ve Yetkili Telefonunu Cari Kartına Kaydet"
              >
                {contactSaving ? (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : contactSaved ? (
                  '✓ Kaydedildi'
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                    <span>Kaydet</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/*
            CARİNİN ADRESİ (2026-09-17 kullanıcı isteği: "bu sayfada carinin adresini görsek iyi
            olur, mobilde ve webde görünümü bozmayacak şekilde").
            Alanların altında tek satır, salt okunur: uzun adres dar ekranda kendiliğinden alt
            satıra geçer, yatay kaydırma doğurmaz. Kayıt sayfada zaten yükleniyor
            (`selectedCustomerRecord` / `selectedSupplierRecord`), ek istek yok. Adres yoksa satır hiç çıkmaz.
          */}
          {(() => {
            const kayit: any = accountType === 'supplier' ? selectedSupplierRecord : selectedCustomerRecord
            if (!kayit) return null
            const parcalar = [kayit.address, kayit.district, kayit.city]
              .map((x: any) => String(x ?? '').trim())
              .filter(Boolean)
              // İlçe/il adresin içinde zaten geçiyorsa ya da ikisi aynıysa ("LEFKOŞA / LEFKOŞA")
              // tekrar yazılmaz.
              .filter((x: string, i: number, arr: string[]) => {
                const buyuk = x.toLocaleUpperCase('tr-TR')
                return !arr.slice(0, i).some((y) => y.toLocaleUpperCase('tr-TR').includes(buyuk))
              })
            if (parcalar.length === 0) return null
            const metin = parcalar.join(' / ')
            return (
              <div className="mt-3 flex items-start gap-1.5 text-xs text-slate-600 min-w-0">
                <svg className="mt-[1px] shrink-0 text-gray-400" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider shrink-0 mt-[1px]">ADRES</span>
                <span className="font-semibold text-slate-800 break-words min-w-0" title={metin}>{metin}</span>
              </div>
            )
          })()}
        </div>

        <div className="flex items-center gap-3 overflow-x-auto pt-2 border-t border-gray-100">
          {(() => {
            // ÖZET KUTULARI SEÇİLİ PARA BİRİMİNİ GÖSTERİR (2026-08-17, kullanıcı kararı).
            //
            // Önceden borç ve alacak, bütün para birimlerinin TL çapasını tek rakamda
            // topluyordu: dolar borcu, euro alacağı ve TL hareketleri aynı kutuda karışıyordu.
            // Artık ekran hangi para birimindeyse üç rakam da (borç · alacak · bakiye) o
            // para biriminde. Mahsup YOK — dolar alacağı TL borcunu kapatmaz.
            const cbs = rawLedgerData?.currencyBalances ?? []
            const selected = cbs.find((cb) => Number(cb.currencyTypeId) === selectedCurrencyFilter)

            // Döviz vektörü gelmediyse (eski yanıt) ekrandan hesaplanan TL toplamlarına düşülür.
            const debitValue = selected ? selected.totalDebit : totalDebit
            const creditValue = selected ? selected.totalCredit : totalCredit
            const balanceValue = selected ? selected.balance : balance

            return (
              <>
                <SummaryBox label="BORÇ" value={formatMoney(debitValue, selectedCurrencyFilter)} />
                <SummaryBox label="ALACAK" value={formatMoney(creditValue, selectedCurrencyFilter)} />
                <SummaryBox label="BAKİYE" value={formatMoney(balanceValue, selectedCurrencyFilter)} />
              </>
            )
          })()}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mb-4 border-b border-gray-100 pb-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {accountType === 'customer' && customerCode && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSubAccountTab('ALL')
                  void loadCustomerLedger(customerCode, 'ALL')
                }}
                className={`h-[34px] px-3.5 text-xs font-bold rounded-lg transition ${
                  subAccountTab === 'ALL'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Tümü
              </button>
            </div>
          )}

          {/* Currency Filter Bar */}
          <div className="flex items-center gap-1 bg-gray-50 p-0.5 rounded-lg border border-gray-200">
            <span className="text-[10px] font-bold text-gray-400 px-2 uppercase tracking-wider">Döviz:</span>
            {/* HAREKETİ OLAN PARA BİRİMLERİ (2026-08-17, kullanıcı kararı).
                "Tümü" kaldırıldı: ekran her zaman tek para birimi gösterir, borç/alacak/bakiye
                kutuları da seçime bağlıdır. Hareketi olmayan para birimi düğme olarak çıkmaz —
                dolarla hiç çalışılmamış caride USD düğmesi görünmüyor. */}
            {availableCurrencies.map((curId) => {
              const meta =
                curId === 1 ? { label: '₺ TL', active: 'bg-blue-600' } :
                curId === 2 ? { label: '€ EUR', active: 'bg-amber-600' } :
                curId === 3 ? { label: '$ USD', active: 'bg-emerald-600' } :
                curId === 4 ? { label: '£ GBP', active: 'bg-purple-600' } :
                { label: String(curId), active: 'bg-slate-900' }

              return (
                <button
                  key={curId}
                  type="button"
                  onClick={() => setSelectedCurrencyFilter(curId as 1 | 2 | 3 | 4)}
                  className={`h-[28px] px-2.5 text-xs font-bold rounded-md transition ${
                    selectedCurrencyFilter === curId
                      ? `${meta.active} text-white shadow-sm`
                      : 'text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {meta.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Right side: ALL 4 Buttons and Search Bar on the EXACT SAME SINGLE ROW */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            type="button"
            onClick={handleOpenMailModal}
            disabled={mappedRows.length === 0}
            className="h-[34px] inline-flex items-center gap-1.5 px-3.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white shadow-sm transition"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
            Mail Gönder
          </button>
          <button
            type="button"
            onClick={handleOzetExcel}
            disabled={mappedRows.length === 0 || exportLoading}
            className="h-[34px] inline-flex items-center gap-1.5 px-3.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white shadow-sm transition"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            {exportLoading ? 'Hazırlanıyor...' : 'Özet Excel'}
          </button>
          <button
            type="button"
            onClick={handleKalemliDetayliExcel}
            disabled={mappedRows.length === 0 || exportLoading}
            className="h-[34px] inline-flex items-center gap-1.5 px-3.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white shadow-sm transition"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
            {exportLoading ? 'Hazırlanıyor...' : 'Detaylı (Kalemli) Excel'}
          </button>
          {(accountType === 'customer' || accountType === 'expense') && (
            <button
              type="button"
              disabled={!customerCode}
              onClick={() => setChecksModalOpen(true)}
              className="h-[34px] inline-flex items-center gap-1.5 px-3.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white shadow-sm transition"
            >
              Aktif Çeklerim
            </button>
          )}

          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Arama..."
              className="h-[34px] w-48 pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 transition"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[1200px] overflow-visible relative">
          {error && <div className="mb-2 text-xs font-semibold text-red-600">{error}</div>}
          {loading && <div className="mb-2 text-xs text-gray-500">Yükleniyor...</div>}
          <Table
          onRefresh={yenileEkstre}
            columns={columns}
            data={mappedRows}
            globalSearch={search}
            showColumnFilters
            initialColumnFilters={{ tarih: { value: '', value2: '', operator: 'contains' }, vadeTarihi: { value: '', value2: '', operator: 'contains' } }}
            initialPageSize={100}
            rowKey={(r) => String((r as any).id ?? '')}
            isRowExpanded={(r) => expandedId === Number((r as any).id ?? 0)}
            onToggleRowExpanded={(r) => void toggleExpand(r as any)}
            renderExpandedRow={renderExpandedRow as any}
          />
        </div>
      </div>
    </div>
  )
}
