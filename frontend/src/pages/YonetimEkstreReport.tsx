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
import { fetchYonetimLedger as fetchCustomerLedger, fetchYonetimLedgerDetails as fetchCustomerLedgerDetails, type CustomerLedgerDetailLineDto, type CustomerLedgerListItemDto } from '../api/yonetimLedger'
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

/** Uctan gelen satirlari secim kutusu bicimine cevirir (acilis ve arama ayni yoldan). */
function buildYonetimCariOptions(customers: CustomerDto[], suppliers: SupplierDto[]): CariOption[] {
  const custOptions: CariOption[] = customers
      .filter((c) => {
        const code = String(c.customerCode ?? '').toUpperCase()
        const name = String(c.name ?? '').toUpperCase()
        return !code.includes('MUHTELIF') && !code.includes('MUHTELİF') && !name.includes('MUHTELIF') && !name.includes('MUHTELİF')
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

export default function YonetimEkstreReport() {
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
    borc: number
    alacak: number
    dovizTutar: number
    dovizTutarCurrencyTypeId: number
    dovizTipi: string
    dovizKur: string | number
    bakiye: number
    hasDetails: boolean
    actions: string
  }


  const location = useLocation()
  const navigate = useNavigate()
  const [accountType, setAccountType] = useState<'customer' | 'supplier' | 'expense'>('customer')

  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [customersLoading, setCustomersLoading] = useState(false)
  const [customerCode, setCustomerCode] = useState('')

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
  const [selectedCustomerRecord, setSelectedCustomerRecord] = useState<CustomerDto | null>(null)
  const [selectedSupplierRecord, setSelectedSupplierRecord] = useState<SupplierDto | null>(null)
  // Son arama sonucu: secilen carinin turunu buradan okuyoruz (state bir render geride kalabilir).
  const lastCariOptionsRef = useRef<CariOption[]>([])
  const [suppliersLoading, setSuppliersLoading] = useState(false)
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
  // DÖVİZ SEÇİMİ — cari ekstredeki kuralın aynısı (2026-08-19).
  //
  // Yönetim ekstresinde döviz ayrımı hiç yoktu: dolar borcu ile euro alacağı aynı listede
  // alt alta geliyor, üstteki BORÇ/ALACAK/TOPLAM BAKİYE kutuları hepsinin TL çapasını tek
  // rakamda topluyordu. 1.500 $ borç + 1.500 € alacak "bakiye -1.500" gibi görünüyordu;
  // oysa iki ayrı para biriminde iki ayrı bakiye var. Ekran artık her zaman TEK para
  // birimi gösterir, hareketi olmayan para birimi düğme olarak da çıkmaz.
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
        const parts = trDate.split('.')
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
          satirDovizi: selectedCurrencyFilter,
          tlKarsiligi: 0,
          dovizTutar: 0,
          dovizTutarCurrencyTypeId: 1,
          dovizTipi: 'TL',
          dovizKur: '1',
          bakiye: devirBakiye,
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
                <td style="padding: 4px 8px; border: 1px solid #CBD5E1; text-align: right;">Toplam Tutar</td>
              </tr>
            `
            detailsMap[row.id].forEach((item, lIdx) => {
              const qty = Number(item.quantity ?? 0)
              const unitPrice = Number(item.unitPrice ?? 0)
              const total = Number(item.total ?? (qty * unitPrice))
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
    () => filterCariOptionsByKapsam(buildYonetimCariOptions(customers, suppliers), ekstreKapsami),
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
        navigate(`/reports/yonetimEkstre?supplierCode=${single.value}`, { replace: true })
      } else if (single.type === 'expense') {
        setAccountType('expense')
        setCustomerCode(single.value)
        navigate(`/reports/yonetimEkstre?customerCode=${single.value}&type=expense`, { replace: true })
      } else {
        setAccountType('customer')
        setCustomerCode(single.value)
        navigate(`/reports/yonetimEkstre?customerCode=${single.value}&type=customer`, { replace: true })
      }
    }
  }, [allCariOptions, customerCode, supplierCode, location.search, navigate])

  const selectedCustomer = useMemo(() => {
    if (accountType === 'customer' || accountType === 'expense') {
      const fromList = customers.find((c) => c.customerCode === customerCode)
      if (fromList) return fromList
      // Tekil kayit yalnizca SECILI koda aitse kullanilir; kod degisip istek donmediyse
      // bir onceki carinin bilgisi sizmasin.
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

      rDebit = Math.round(rDebit * 100) / 100
      rCredit = Math.round(rCredit * 100) / 100

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
        dovizTipi: currencyLabel(paymentCurrTypeId),
        dovizKur: paymentCurrRate === 1 ? '1' : paymentCurrRate.toLocaleString('tr-TR', { maximumFractionDigits: 4 }),
        // Bakiye satırın KENDİ para biriminde yürür (cari ekstredeki kardeşiyle aynı):
        // TL satırı TL bakiyesini, USD satırı USD bakiyesini ilerletir. Tek dövizli
        // caride currencyBalance ile balance birebir aynıdır — görünüm değişmez.
        bakiye: Number(it.currencyBalance ?? it.balance ?? 0),
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
      {
        key: 'islemHesabi',
        label: 'İşlem Hesabı',
        searchable: true,
        render: (v, row) => {
          const text = String(v ?? '').trim()
          const isDevir = text === 'Devir' || String(row?.islemTipi ?? '').toUpperCase() === 'DEVİR' || String(row?.belgeNo ?? '').toUpperCase() === 'DEVİR'
          if (isDevir) {
            return (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-800 border border-slate-200">
                Devir
              </span>
            )
          }
          if (text === 'Fatura Hesabı') {
            return (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">
                Fatura Hesabı
              </span>
            )
          }
          return (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
              {text || 'Açık Cari'}
            </span>
          )
        }
      },
      { key: 'teslimCariAdi', label: 'Teslim Cari Adı', searchable: true },
      { key: 'tarih', label: 'Tarih', searchable: true, filter: { type: 'date' } },
      { key: 'vadeTarihi', label: 'Vade Tarihi', searchable: true, filter: { type: 'date' } },
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
      // Borç/alacak/bakiye SATIRIN kendi para biriminde. Önceden carinin kartındaki döviz
      // (`activeCurrencyTypeId`) kullanılıyordu; o alan artık okunmuyor ve fiilen hep TL
      // olduğu için dolarlı satır ₺ simgesiyle yazılıyordu.
      { key: 'borc', label: 'Borç', searchable: true, render: (v, row) => formatMoney(Number(v ?? 0), Number((row as any)?.satirDovizi ?? selectedCurrencyFilter)) },
      { key: 'alacak', label: 'Alacak', searchable: true, render: (v, row) => formatMoney(Number(v ?? 0), Number((row as any)?.satirDovizi ?? selectedCurrencyFilter)) },
      { key: 'dovizTutar', label: 'Döviz Tutar', searchable: true, render: (v) => Number(v ?? 0) > 0 ? (Math.round(Number(v) * 100) / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '' },
      { key: 'dovizTipi', label: 'Döviz Tip', searchable: true },
      { key: 'dovizKur', label: 'Döviz Kur', searchable: true, render: (v) => String(v ?? '') },
      { key: 'bakiye', label: 'Bakiye', searchable: true, render: (v, row) => formatMoney(Number(v ?? 0), Number((row as any)?.satirDovizi ?? selectedCurrencyFilter)) },
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
    [selectedCurrencyFilter]
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
   * Çek/senet PARA hareketidir, para ANA cariye yazılır ([[cari-alt-hesap-kurali]]); ekstre
   * alt hesaptan da açılabildiği için ana kod + üç alt hesap birlikte sorulur.
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

  /** Liste ekstrenin seçili para birimine göre süzülür (bkz. Cari Ekstre'deki aynı kural). */
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

  const customerOptions = useMemo(() => {
    const seen = new Set<string>()
    const regularCustomers = customers.filter((c) => {
      const code = String(c.customerCode ?? '').trim()
      if (
        !code ||
        code.toUpperCase() === 'MUHTELIF' ||
        String(c.customerType ?? '').toLocaleLowerCase('tr-TR') === 'hizmet' ||
        code.startsWith('770')
      ) {
        return false
      }
      const upper = code.toUpperCase()
      if (seen.has(upper)) return false
      seen.add(upper)
      return true
    })
    return [{ value: '', label: 'Seçiniz' }, ...regularCustomers.map((c) => ({ value: String(c.customerCode ?? ''), label: `[${c.customerCode}] ${c.name}` }))]
  }, [customers])

  const supplierOptions = useMemo(() => {
    return [{ value: '', label: 'Seçiniz' }, ...(suppliers ?? []).map((s) => ({ value: String(s.supplierCode ?? ''), label: `[${s.supplierCode}] ${s.fullName}` }))]
  }, [suppliers])

  const expenseOptions = useMemo(() => {
    const serviceCustomers = customers.filter(c => String(c.customerType ?? '').toLocaleLowerCase('tr-TR') === 'hizmet')
    return [{ value: '', label: 'Seçiniz' }, ...serviceCustomers.map((c) => ({ value: String(c.customerCode ?? ''), label: `[${c.customerCode}] ${c.name}` }))]
  }, [customers])

  const dateFilteredCalculatedRows = useMemo(() => {
    if (!calculatedRows || calculatedRows.length === 0) return []

    const startIso = fromDate ? fromDate.trim() : ''
    const endIso = toDate ? toDate.trim() : ''

    if (!startIso && !endIso) return calculatedRows

    const parseTrDateToIso = (trDate: string): string => {
      if (!trDate) return ''
      const parts = trDate.split('.')
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
        preDebit += Number(r.borc ?? 0)
        preCredit += Number(r.alacak ?? 0)
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
        // Devir satırı seçili para biriminin satırlarından üretiliyor; para birimi
        // yazılmazsa döviz süzgeci onu eler ve devir ekrandan kaybolur.
        satirDovizi: selectedCurrencyFilter,
        tlKarsiligi: 0,
        dovizTutar: 0,
        dovizTutarCurrencyTypeId: 1,
        dovizTipi: 'TL',
        dovizKur: '1',
        bakiye: devirBakiye,
        hasDetails: false,
        actions: ''
      }
      return [devirRow, ...filtered]
    }

    return filtered
  }, [calculatedRows, fromDate, toDate])

  const currencyFilteredRows = useMemo(() => {
    return dateFilteredCalculatedRows.filter(
      (r: any) => Number(r.satirDovizi ?? 1) === selectedCurrencyFilter
    )
  }, [dateFilteredCalculatedRows, selectedCurrencyFilter])

  /**
   * Bu carinin HAREKETİ OLAN para birimleri. Kaynak backend'in döviz bakiyesi vektörü
   * (`currencyBalances`); yoksa satırlardan çıkarılır. Boş kalırsa TL gösterilir ki ekran
   * hiç düğmesiz kalmasın.
   */
  const availableCurrencies = useMemo(() => {
    const fromBalances = ((rawLedgerData as any)?.currencyBalances ?? [])
      .map((cb: any) => Number(cb.currencyTypeId))
      .filter((c: number) => c > 0)

    if (fromBalances.length > 0) return Array.from(new Set<number>(fromBalances)).sort((a, b) => a - b)

    const fromRows = dateFilteredCalculatedRows
      .map((r: any) => Number(r.satirDovizi ?? 1))
      .filter((c: number) => c > 0)

    const uniq = Array.from(new Set<number>(fromRows)).sort((a, b) => a - b)
    return uniq.length > 0 ? uniq : [1]
  }, [rawLedgerData, dateFilteredCalculatedRows])

  // Seçili para biriminin hareketi yoksa (cari değişti, tarih filtresi daraldı) ilk mevcut
  // para birimine geç — kullanıcı boş ekranla baş başa kalmasın.
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
   * CARI SECIMI SUNUCUDAN ARANIR (2026-08-22) — Cari Ekstre'deki duzenin AYNISI.
   *
   * Onceki hali acilista iki SINIRSIZ istek atiyordu: butun cariler ve butun tedarikciler
   * (ikincisi `includeCustomers: true` ile ayni cari listesini TEKRAR indiriyor). Secim
   * kutusu ikisi de bitene kadar kilitliydi. Uc parametreleri AYNEN korundu.
   */
  const cariRemoteSearch = useCallback(async (query: string, typeKey: string): Promise<CariOption[]> => {
    const q = buildCariSearchQuery(query, typeKey)
    setCustomersLoading(true)
    setSuppliersLoading(true)
    try {
      const [custs, sups] = await Promise.all([
        fetchCustomersDropdown({ includeInactive: false, includeMuhtelif: false, q, limit: CARI_SEARCH_LIMIT }).catch(() => [] as CustomerDto[]),
        fetchSuppliers({ includeCustomers: true, q, limit: CARI_SEARCH_LIMIT }).catch(() => [] as SupplierDto[])
      ])
      setCustomers(custs ?? [])
      setSuppliers(sups ?? [])
      const opts = filterCariOptionsByKapsam(buildYonetimCariOptions(custs ?? [], sups ?? []), await ekstreKapsamiPromise)
      lastCariOptionsRef.current = opts
      return opts
    } finally {
      setCustomersLoading(false)
      setSuppliersLoading(false)
    }
  }, [ekstreKapsamiPromise])

  // Acilista TEK kucuk istek: hem kutu bos acildiginda gosterilecek liste, hem de
  // "kullanicinin tek carisi varsa otomatik sec" kurali icin sayim.
  useEffect(() => {
    void cariRemoteSearch('', 'all')
  }, [cariRemoteSearch])

  // Secili carinin KENDI kaydi: arama sonuclari her yazista degistigi icin secili kayit
  // listeden dusebiliyor, fatura tipi ve para birimi ona bagli.
  useEffect(() => {
    const code = String(customerCode ?? '').trim()
    if (!code || accountType === 'supplier') {
      setSelectedCustomerRecord(null)
      return
    }
    const ac = new AbortController()
    void (async () => {
      try {
        setSelectedCustomerRecord((await fetchCustomerByCode(code, { signal: ac.signal })) ?? null)
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

      /* Dosya hangi para biriminde çekildiğini söylemiyordu (bkz. Cari Ekstre'deki aynı düzeltme). */
      const curLabel = currencyLabel(selectedCurrencyFilter)

      const aoa: any[][] = []

      aoa.push([`${activeName} - Yönetim Ekstre (Para Birimi: ${curLabel})`])
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

      // "Para Birimi" sütunu eklendiği için tutar sütunları bir sağa kaydı: F -> G/H/I.
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

      const filename = `yonetim-ekstre-ozet-${activeCode || 'tum'}-${curLabel}.xlsx`
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

      let htmlRows = ''

      mappedRows.forEach((row, index) => {
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
            <td style="padding: 6px 8px; border: 1px solid #334155; text-align: right; white-space: nowrap; mso-number-format:'#,##0.00';" x:num="${borcVal}">${borcVal > 0 ? borcVal.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) : '0,00'}</td>
            <td style="padding: 6px 8px; border: 1px solid #334155; text-align: right; white-space: nowrap; mso-number-format:'#,##0.00';" x:num="${alacakVal}">${alacakVal > 0 ? alacakVal.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) : '0,00'}</td>
            <td style="padding: 6px 8px; border: 1px solid #334155; text-align: right; white-space: nowrap; mso-number-format:'#,##0.00';" x:num="${bakiyeVal}">${bakiyeVal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
          </tr>
        `

        if (row.aciklama || row.teslimCariAdi) {
          htmlRows += `
            <tr style="background-color: #F8FAFC; color: #475569; font-size: 9.5pt;">
              <td colspan="8" style="padding: 4px 8px; border: 1px solid #E2E8F0; white-space: nowrap;">
                ${row.teslimCariAdi ? `<b>Teslim Cari:</b> ${row.teslimCariAdi} &nbsp;&nbsp;` : ''}
                ${row.aciklama ? `<b>Açıklama:</b> ${row.aciklama}` : ''}
              </td>
            </tr>
          `
        }

        if (hasLines) {
          htmlRows += `
            <tr style="background-color: #E2E8F0; color: #1E293B; font-weight: bold; font-size: 9.5pt;">
              <td style="padding: 4px 8px; border: 1px solid #CBD5E1; text-align: center; font-weight: bold; white-space: nowrap;">Kalem</td>
              <td style="padding: 4px 8px; border: 1px solid #CBD5E1; font-weight: bold; white-space: nowrap;">Stok Kodu</td>
              <td style="padding: 4px 8px; border: 1px solid #CBD5E1; font-weight: bold; white-space: nowrap;" colspan="2">Stok Adı / Ürün Detayı</td>
              <td style="padding: 4px 8px; border: 1px solid #CBD5E1; text-align: right; font-weight: bold; white-space: nowrap;">Miktar</td>
              <td style="padding: 4px 8px; border: 1px solid #CBD5E1; text-align: right; font-weight: bold; white-space: nowrap;">Birim Fiyat</td>
              <td style="padding: 4px 8px; border: 1px solid #CBD5E1; text-align: right; font-weight: bold; white-space: nowrap;">İndirim/KDV</td>
              <td style="padding: 4px 8px; border: 1px solid #CBD5E1; text-align: right; font-weight: bold; white-space: nowrap;">Toplam Tutar</td>
            </tr>
          `

          detailsMap[row.id].forEach((item, lIdx) => {
            const qty = Number(item.quantity ?? 0)
            const unitPrice = Number(item.unitPrice ?? 0)
            const total = Number(item.total ?? (qty * unitPrice))
            const isGift = Boolean(item.isGift)

            htmlRows += `
              <tr style="background-color: ${lIdx % 2 === 0 ? '#FFFFFF' : '#F1F5F9'}; color: #334155; font-size: 9.5pt;">
                <td style="padding: 4px 8px; border: 1px solid #E2E8F0; text-align: center; white-space: nowrap;">${lIdx + 1}</td>
                <td style="padding: 4px 8px; border: 1px solid #E2E8F0; white-space: nowrap; mso-number-format:'\\@';">${item.stockCode || '—'}</td>
                <td style="padding: 4px 8px; border: 1px solid #E2E8F0; white-space: nowrap;" colspan="2">
                  ${item.stockName || ''} ${isGift ? '<span style="color:#059669; font-weight:bold;">(Hediye)</span>' : ''}
                </td>
                <td style="padding: 4px 8px; border: 1px solid #E2E8F0; text-align: right; white-space: nowrap;" x:num="${qty}">${qty}</td>
                <td style="padding: 4px 8px; border: 1px solid #E2E8F0; text-align: right; white-space: nowrap; mso-number-format:'#,##0.00';" x:num="${unitPrice}">${unitPrice.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                <td style="padding: 4px 8px; border: 1px solid #E2E8F0; text-align: right; white-space: nowrap;">${item.discountAmount ? `-${Number(item.discountAmount).toLocaleString('tr-TR')}` : '—'}</td>
                <td style="padding: 4px 8px; border: 1px solid #E2E8F0; text-align: right; font-weight: bold; white-space: nowrap; mso-number-format:'#,##0.00';" x:num="${total}">${total.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
              </tr>
            `
          })
        }
      })

      const dateRangeText = (fromDate || toDate) ? `Tarih Aralığı: ${fromDate || '...'} - ${toDate || '...'}` : 'Tüm Dönem'

      const fullHtml = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="utf-8">
          <!--[if gte mso 9]>
          <xml>
            <x:ExcelWorkbook>
              <x:ExcelWorksheets>
                <x:ExcelWorksheet>
                  <x:Name>Kalemli Ekstre</x:Name>
                  <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
                </x:ExcelWorksheet>
              </x:ExcelWorksheets>
            </x:ExcelWorkbook>
          </xml>
          <![endif]-->
          <style>
            body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10pt; }
            table { border-collapse: collapse; }
            th { font-weight: bold; white-space: nowrap; }
            td { white-space: nowrap; }
          </style>
        </head>
        <body>
          <div style="font-size: 14pt; font-weight: bold; color: #0F172A; margin-bottom: 4px;">CARİ HAREKET VE KALEM DETAYLI RAPORU</div>
          <div style="font-size: 10pt; color: #475569; margin-bottom: 10px;"><b>Cari:</b> ${activeName} (${activeCode}) &nbsp;|&nbsp; <b>${dateRangeText}</b></div>
          <table>
            <thead>
              <tr style="background-color: #0284C7; color: #FFFFFF; font-weight: bold; font-size: 10.5pt;">
                <th style="padding: 6px 8px; border: 1px solid #0369A1; font-weight: bold; white-space: nowrap;">Sıra</th>
                <th style="padding: 6px 8px; border: 1px solid #0369A1; font-weight: bold; white-space: nowrap;" colspan="2">Tarih</th>
                <th style="padding: 6px 8px; border: 1px solid #0369A1; font-weight: bold; white-space: nowrap;">Belge No</th>
                <th style="padding: 6px 8px; border: 1px solid #0369A1; font-weight: bold; white-space: nowrap;">İşlem / Kalem Detayı</th>
                <th style="padding: 6px 8px; border: 1px solid #0369A1; text-align: right; font-weight: bold; white-space: nowrap;">Borç</th>
                <th style="padding: 6px 8px; border: 1px solid #0369A1; text-align: right; font-weight: bold; white-space: nowrap;">Alacak</th>
                <th style="padding: 6px 8px; border: 1px solid #0369A1; text-align: right; font-weight: bold; white-space: nowrap;">Bakiye</th>
              </tr>
            </thead>
            <tbody>
              ${htmlRows}
            </tbody>
          </table>
        </body>
        </html>
      `

      const blob = new Blob(['\ufeff' + fullHtml], { type: 'application/vnd.ms-excel;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `yonetim-ekstre-kalemli-${activeCode || 'tum'}-${currencyLabel(selectedCurrencyFilter)}.xls`
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

    // `currencyTypeId` / `dovizTipId` bu satırda HİÇ YOK; ikisi de undefined dönüp carinin
    // kartındaki dövize düşülüyordu (cari ekstrede aynı hata düzeltilmişti).
    const parentCurTypeId = Number((row as any).satirDovizi ?? selectedCurrencyFilter ?? 1)
    const rate = Number(row.dovizKur ?? 1) > 0 ? Number(row.dovizKur) : 1

    return (
      <div className="bg-white border border-gray-200 rounded-md overflow-hidden p-2 my-1 shadow-sm">
        {isLoading ? (
          <div className="p-3 text-xs text-gray-500 font-semibold animate-pulse">Fatura kalemleri yükleniyor...</div>
        ) : null}
        {!isLoading && (!rowDetails || rowDetails.length === 0) ? (
          <div className="p-3 text-xs text-gray-500 italic">Veri yok</div>
        ) : null}
        {!isLoading && rowDetails && rowDetails.length > 0 ? (
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
                  <th className="p-2 text-right">Toplam</th>
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

                  if (isGift) {
                    priceStr = formatMoney(0.01, curIdToUse)
                    totalStr = formatMoney(0.01 * qty, curIdToUse)
                  } else if (curIdToUse > 1) {
                    const fxPrice = Number(item?.currencyUnitPrice > 0 ? item.currencyUnitPrice : (Number(item?.unitPrice ?? 0) / rate))
                    priceStr = formatMoney(fxPrice, curIdToUse)
                    totalStr = formatMoney(fxPrice * qty, curIdToUse)
                  } else {
                    priceStr = formatMoney(Number(item?.unitPrice ?? 0), 1)
                    totalStr = formatMoney(Number(item?.total ?? (qty * Number(item?.unitPrice ?? 0))), 1)
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
        ) : null}
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
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Yönetim Ekstre Raporu</h1>
          <p className="text-xs text-gray-400 mt-0.5">Raporlar / Yönetim Ekstre Raporu</p>
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
                    navigate('/reports/yonetimEkstre', { replace: true })
                    return
                  }

                  const matched = lastCariOptionsRef.current.find((o) => o.value === v) ?? allCariOptions.find((o) => o.value === v)
                  if (matched?.type === 'supplier' || v.startsWith('320')) {
                    setAccountType('supplier')
                    setSupplierCode(v)
                    setCustomerCode('')
                    navigate(`/reports/yonetimEkstre?supplierCode=${v}`, { replace: true })
                  } else if (matched?.type === 'expense' || v.startsWith('600') || v.startsWith('770')) {
                    setAccountType('expense')
                    setCustomerCode(v)
                    setSupplierCode('')
                    navigate(`/reports/yonetimEkstre?customerCode=${v}&type=expense`, { replace: true })
                  } else {
                    setAccountType('customer')
                    setCustomerCode(v)
                    setSupplierCode('')
                    navigate(`/reports/yonetimEkstre?customerCode=${v}&type=customer`, { replace: true })
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
        </div>

        <div className="flex items-center gap-3 overflow-x-auto pt-2 border-t border-gray-100">
          {(() => {
            // ÜÇ RAKAM DA SEÇİLİ PARA BİRİMİNDE. Önceden borç/alacak bütün para birimlerinin
            // TL çapasını tek rakamda topluyor, "toplam bakiye" de dolar borcunu euro
            // alacağıyla mahsup ediyordu. Mahsup YOK: her para birimi kendi bakiyesini yürütür.
            const cbs = (rawLedgerData as any)?.currencyBalances ?? []
            const selected = cbs.find((cb: any) => Number(cb.currencyTypeId) === selectedCurrencyFilter)

            // Döviz vektörü gelmediyse (eski yanıt) ekrandan hesaplanan toplamlara düşülür.
            const debitValue = selected ? Number(selected.totalDebit ?? 0) : totalDebit
            const creditValue = selected ? Number(selected.totalCredit ?? 0) : totalCredit
            const balanceValue = selected ? Number(selected.balance ?? 0) : balance

            return (
              <>
                <SummaryBox label="BORÇ" value={formatMoney(debitValue, selectedCurrencyFilter)} />
                <SummaryBox label="ALACAK" value={formatMoney(creditValue, selectedCurrencyFilter)} />
                <SummaryBox label="TOPLAM BAKİYE" value={formatMoney(balanceValue, selectedCurrencyFilter)} />
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
              {subAccountTabVisibility.showFaturaTab && (
                <button
                  type="button"
                  onClick={() => {
                    setSubAccountTab('FATURA')
                    void loadCustomerLedger(customerCode, 'FATURA')
                  }}
                  className={`h-[34px] px-3.5 text-xs font-bold rounded-lg transition ${
                    subAccountTab === 'FATURA'
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                  }`}
                >
                  Fatura Hesabı (-1)
                </button>
              )}
              {subAccountTabVisibility.showAcikTab && (
                <button
                  type="button"
                  onClick={() => {
                    setSubAccountTab('ACIK')
                    void loadCustomerLedger(customerCode, 'ACIK')
                  }}
                  className={`h-[34px] px-3.5 text-xs font-bold rounded-lg transition ${
                    subAccountTab === 'ACIK'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                  }`}
                >
                  Açık Cari (-2)
                </button>
              )}
              {subAccountTabVisibility.showAskeriyeTab && (
                <button
                  type="button"
                  onClick={() => {
                    setSubAccountTab('ASKERIYE')
                    void loadCustomerLedger(customerCode, 'ASKERIYE')
                  }}
                  className={`h-[34px] px-3.5 text-xs font-bold rounded-lg transition ${
                    subAccountTab === 'ASKERIYE'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  Muaf Hesabı (-3)
                </button>
              )}
            </div>
          )}

          {/* Döviz süzgeci — cari ekstredekiyle AYNI kural. Hareketi olmayan para birimi
              düğme olarak çıkmaz; dolarla hiç çalışılmamış caride USD düğmesi görünmez. */}
          <div className="flex items-center gap-1 bg-gray-50 p-0.5 rounded-lg border border-gray-200">
            <span className="text-[10px] font-bold text-gray-400 px-2 uppercase tracking-wider">Döviz:</span>
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
