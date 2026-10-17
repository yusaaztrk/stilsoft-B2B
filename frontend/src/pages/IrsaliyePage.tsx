import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { Search, Plus, Settings, HelpCircle, Trash2 } from 'lucide-react'
import { useOutletContext } from 'react-router-dom'
import NotificationPopup, { type NotificationVariant } from '../components/NotificationPopup'
import Table, { type TableColumn } from '../components/Table'
import Modal from '../components/Modal'
import ActionDropdown from '../components/ActionDropdown'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import { CARI_SEARCH_LIMIT, buildCariSearchQuery } from '../utils/cariRemoteSearch'
import SearchableCariSelect, { type CariOption } from '../components/SearchableCariSelect'
import SearchableProductSelect from '../components/SearchableProductSelect'
import { fetchCustomersDropdown, fetchCustomerByCode, type CustomerDto } from '../api/customers'
import { fetchProducts } from '../api/products'
import { fetchAuthorizedWarehousesDropdown, type WarehouseDropdownItem } from '../api/warehouses'

import { API_BASE_URL } from '../config/api'

type IrsaliyeStatus = 'beklemede' | 'onaylandi' | 'sevkEdildi'

type Row = {
  id: number
  irsaliyeNo: string
  customerCode: string
  customerName: string
  productId: string
  productCode: string
  productName: string
  quantity: number
  shippedQuantity: number | null
  status: IrsaliyeStatus
  date: string
  description: string
  transferredSalesOrderId?: number | null
  createUser: string
  createUserRole: string
}

type HeaderRow = {
  key: string
  irsaliyeNo: string
  customerCode: string
  customerName: string
  productNames: string
  totalQuantity: number
  totalShippedQuantity: number
  date: string
  description: string
  createUser: string
  createUserRole: string
  status: IrsaliyeStatus
  actions?: string
}

type MeDto = {
  username?: string
  role?: string
}

type ExtraLine = {
  productId: string
  quantity: string
  description: string
}

const TRANSFER_MARKER = 'FATURAYA_AKTARILDI'

function parseTransferMarker(desc: string | null | undefined) {
  const raw = String(desc ?? '')
  const transferred = raw.toUpperCase().includes(TRANSFER_MARKER)
  if (!transferred) return { transferred: false, text: raw }
  const cleaned = raw
    .split('|')
    .map((p) => p.trim())
    .filter((p) => p && p.toUpperCase() !== TRANSFER_MARKER)
    .join(' | ')
  return { transferred: true, text: cleaned }
}

function parseCompositeDescription(desc: string | null | undefined) {
  const cleaned = parseTransferMarker(desc).text
  const parts = cleaned
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean)

  const headerPart = parts
    .filter((p) => /^GENEL\s*:/i.test(p))
    .map((p) => p.replace(/^GENEL\s*:\s*/i, '').trim())
    .filter(Boolean)
    .join(' | ')

  const linePart = parts
    .filter((p) => /^URUN\s*:/i.test(p))
    .map((p) => p.replace(/^URUN\s*:\s*/i, '').trim())
    .filter(Boolean)
    .join(' | ')

  const fallback = parts
    .filter((p) => !/^GENEL\s*:/i.test(p) && !/^URUN\s*:/i.test(p))
    .join(' | ')
    .trim()

  return {
    header: headerPart || (linePart ? '' : fallback),
    line: linePart || (!headerPart ? fallback : '')
  }
}

function buildCompositeDescription(headerText: string, lineText: string) {
  const h = String(headerText ?? '').trim()
  const l = String(lineText ?? '').trim()
  const parts: string[] = []
  if (h) parts.push(`GENEL: ${h}`)
  if (l) parts.push(`URUN: ${l}`)
  return parts.join(' | ').trim()
}

function isTransferred(row: Pick<Row, 'description' | 'transferredSalesOrderId'>) {
  return row.transferredSalesOrderId != null
}

function statusLabel(s: IrsaliyeStatus) {
  if (s === 'sevkEdildi') return 'sevk edildi'
  return 'beklemede'
}

function statusClass(s: IrsaliyeStatus) {
  if (s === 'sevkEdildi') return 'bg-blue-100 text-blue-800 border-blue-200'
  return 'bg-yellow-100 text-yellow-800 border-yellow-200'
}

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function readErrorText(res: Response) {
  const text = await res.text().catch(() => '')
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return `HTTP ${res.status}`

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const j = JSON.parse(trimmed)
      const errors = (j as any)?.errors
      if (errors && typeof errors === 'object') {
        const parts: string[] = []
        for (const k of Object.keys(errors)) {
          const v = (errors as any)[k]
          if (Array.isArray(v)) {
            for (const msg of v) {
              if (typeof msg === 'string' && msg.trim()) parts.push(`${k}: ${msg.trim()}`)
            }
          } else if (typeof v === 'string' && v.trim()) {
            parts.push(`${k}: ${v.trim()}`)
          }
        }
        if (parts.length) return parts.join('\n')
      }
      const msg = j?.message || j?.error || j?.title
      if (typeof msg === 'string' && msg.trim()) return msg.trim()
    } catch {
    }
  }
  return trimmed
}

/** Uçtan gelen cari satırlarını seçim kutusu biçimine çevirir (açılış ve arama aynı yoldan). */
function buildIrsaliyeCariOptions(customers: any[]): CariOption[] {
  return (customers ?? []).map((c: any) => ({
    value: String(c.customerCode ?? ''),
    label: `[${c.customerCode}] ${c.name}`,
    code: String(c.customerCode ?? ''),
    name: String(c.name ?? ''),
    phone: String(c.phone ?? c.gsm ?? ''),
    customerType: String(c.customerType ?? '')
  }))
}

export default function IrsaliyePage() {
  type LayoutContext = { isSuperAdmin?: boolean; allowedKeys?: Set<string> }
  const layout = useOutletContext<LayoutContext>()

  const canStatusOnaylandi = Boolean(layout?.isSuperAdmin) || Boolean(layout?.allowedKeys?.has('invoice/irsaliyeStatusOnaylandi'))
  const canStatusSevkEdildi = Boolean(layout?.isSuperAdmin) || Boolean(layout?.allowedKeys?.has('invoice/irsaliyeStatusSevkEdildi'))
  const canEditQty = Boolean(layout?.isSuperAdmin) || Boolean(layout?.allowedKeys?.has('invoice/irsaliyeQuantityEdit'))
  const canEditShippedQty = Boolean(layout?.isSuperAdmin) || Boolean(layout?.allowedKeys?.has('invoice/irsaliyeShippedQuantityEdit'))

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [updatingRowId, setUpdatingRowId] = useState<number | null>(null)

  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [products, setProducts] = useState<Array<{ id: string; stockCode: string; name: string }>>([])

  const [me, setMe] = useState<MeDto>({})

  const [popupOpen, setPopupOpen] = useState(false)
  const [popupType, setPopupType] = useState<'success' | 'error' | 'info'>('info')
  const [popupTitle, setPopupTitle] = useState('')
  const [popupMessage, setPopupMessage] = useState('')

  const showPopup = (type: 'success' | 'error' | 'info', title: string, message: string) => {
    setPopupType(type)
    setPopupTitle(title)
    setPopupMessage(message)
    setPopupOpen(true)
  }

  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionsRow, setActionsRow] = useState<HeaderRow | null>(null)

  const [transferOpen, setTransferOpen] = useState(false)
  const [transferSaving, setTransferSaving] = useState(false)
  const [transferIrsaliyeNo, setTransferIrsaliyeNo] = useState('')
  const [transferItems, setTransferItems] = useState<Array<{
    id: number
    productName: string
    shippedQuantity: number
    soldQuantity: string
  }>>([])

  const [sevkModalOpen, setSevkModalOpen] = useState(false)
  const [sevkRowId, setSevkRowId] = useState<number | null>(null)
  const [sevkQuantity, setSevkQuantity] = useState('')

  const [qtyModalOpen, setQtyModalOpen] = useState(false)
  const [qtyRowId, setQtyRowId] = useState<number | null>(null)
  const [qtyValue, setQtyValue] = useState('')

  const [bulkSevkModalOpen, setBulkSevkModalOpen] = useState(false)
  const [bulkSevkIrsaliyeNo, setBulkSevkIrsaliyeNo] = useState('')
  const [bulkSevkItems, setBulkSevkItems] = useState<Array<{
    id: number
    productName: string
    quantity: number
    shippedQuantity: string
    selected: boolean
  }>>([])
  const [warehouses, setWarehouses] = useState<WarehouseDropdownItem[]>([])
  const [selectedWarehouseCode, setSelectedWarehouseCode] = useState<string>('')

  const [bottomToastOpen, setBottomToastOpen] = useState(false)
  const [bottomToastMessage, setBottomToastMessage] = useState('')

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTitle, setConfirmTitle] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null)

  const askConfirmation = (title: string, text: string, action: () => void) => {
    setConfirmTitle(title)
    setConfirmText(text)
    setConfirmAction(() => action)
    setConfirmOpen(true)
  }

  const emptyExtraLine = useMemo<ExtraLine>(
    () => ({
      productId: '',
      quantity: '1',
      description: ''
    }),
    []
  )

  const emptyForm = useMemo(
    () => ({
      customerCode: '',
      description: '',
      date: '',
      extraLines: [{ productId: '', quantity: '1', description: '' }] as ExtraLine[]
    }),
    []
  )

  const [form, setForm] = useState(emptyForm)

  const fetchMe = async () => {
    const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
      headers: {
        ...buildHeaders(false)
      }
    })

    if (!res.ok) {
      setMe({})
      return
    }

    const json = await res.json().catch(() => null)
    const data = json?.data
    setMe({
      username: String(data?.username ?? ''),
      role: String(data?.role ?? '')
    })
  }

  const loadDropdowns = async () => {
    // Cari listesi ARTIK TÜMÜYLE İNDİRİLMİYOR — seçim kutusu sunucudan arıyor
    // (bkz. cariRemoteSearch). Açılışta yalnızca ilk sayfa çekilir.
    const [c, p] = await Promise.all([
      fetchCustomersDropdown({ includeInactive: false, limit: CARI_SEARCH_LIMIT }),
      fetchProducts({ page: 1, pageSize: 2000, includeInactive: false }).then((r) => r.items as any)
    ])

    setCustomers(c)
    setProducts(
      (p ?? []).map((x: any) => ({
        id: String(x.id ?? ''),
        stockCode: String(x.stockCode ?? ''),
        name: String(x.name ?? '')
      }))
    )
  }

  const customerOptions = useMemo<CariOption[]>(() => buildIrsaliyeCariOptions(customers ?? []), [customers])

  /**
   * CARİ ARAMASI SUNUCUDA (2026-08-22) — Cari Ekstre'deki düzenin aynısı.
   * Uç parametresi AYNEN korundu: pasif cariler yine dışarıda.
   */
  const cariRemoteSearch = useCallback(async (query: string, typeKey: string): Promise<CariOption[]> => {
    try {
      const list = await fetchCustomersDropdown({
        includeInactive: false,
        q: buildCariSearchQuery(query, typeKey),
        limit: CARI_SEARCH_LIMIT
      })
      setCustomers(list ?? [])
      return buildIrsaliyeCariOptions(list ?? [])
    } catch {
      return []
    }
  }, [])

  const loadRows = async () => {
    const res = await fetch(`${API_BASE_URL}/api/irsaliye`, {
      headers: {
        ...buildHeaders(false)
      }
    })

    if (!res.ok) {
      throw new Error(await readErrorText(res))
    }

    const json = await res.json()
    return (json?.data ?? []) as Row[]
  }

  const reload = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await loadRows()
      const mapped = data.map((row) => ({
        ...row,
        status: row.status === ('onaylandi' as any) ? 'beklemede' : row.status
      }))
      setRows(mapped)
    } catch (e: any) {
      setError(String(e?.message ?? 'Bir hata oluştu'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const handlePrintIrsaliye = async (irsaliyeNo: string) => {
    try {
      const lines = rows.filter((x) => String(x.irsaliyeNo ?? '').trim() === irsaliyeNo)
      if (lines.length === 0) return

      const first = lines[0]
      const customer = await fetchCustomerByCode(first.customerCode)

      const dateStr = first.date || ''
      const customerName = first.customerName || ''
      const customerAddress = customer?.address || ''
      const customerCityDistrict = [customer?.district, customer?.city].filter(Boolean).join('/')
      const customerTaxOffice = customer?.taxOffice || ''
      const customerTaxNumber = customer?.taxNumber || ''

      const linesHtml = lines.map((l, index) => {
        const productCode = String(l.productCode ?? '').trim()
        const productName = String(l.productName ?? '').trim()
        const desc = parseCompositeDescription(l.description).line || ''
        const qty = String(l.shippedQuantity ?? l.quantity ?? '')
        return `
          <tr>
            <td style="text-align: center;">${index + 1}</td>
            <td>${productCode}</td>
            <td>${productName}</td>
            <td style="text-align: right; font-weight: bold;">${qty} AD</td>
            <td>${desc}</td>
          </tr>
        `
      }).join('')

      const html = `
        <!DOCTYPE html>
        <html lang="tr">
        <head>
          <meta charset="UTF-8">
          <title>Konsinye Sevk Evrakı - ${irsaliyeNo}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
            body {
              font-family: 'Inter', Arial, sans-serif;
              margin: 0;
              padding: 30px;
              color: #000;
              background-color: #fff;
              font-size: 11px;
            }
            .print-container {
              max-width: 820px;
              margin: 0 auto;
            }
            .header-section {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              margin-bottom: 20px;
            }
            .logo-box {
              background-color: #d81b21;
              color: white;
              padding: 15px 35px;
              font-family: Arial, sans-serif;
              font-size: 32px;
              font-weight: bold;
              letter-spacing: -1.5px;
              text-transform: lowercase;
              display: inline-block;
              line-height: 1;
            }
            .company-info {
              text-align: right;
              font-size: 10px;
              line-height: 1.4;
              color: #333;
            }
            .title-section {
              text-align: center;
              margin: 20px 0;
              position: relative;
            }
            .title-section h1 {
              font-size: 18px;
              font-weight: bold;
              margin: 0;
              letter-spacing: 1px;
            }
            .doc-meta {
              position: absolute;
              right: 0;
              top: 0;
              text-align: right;
              font-size: 10px;
              line-height: 1.5;
            }
            .info-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 20px;
              font-size: 10px;
            }
            .info-table th, .info-table td {
              border: 1px solid #000;
              padding: 6px 10px;
              vertical-align: middle;
            }
            .info-table th {
              background-color: #ffffff;
              font-weight: bold;
              text-align: left;
              width: 15%;
            }
            .info-table td {
              width: 35%;
            }
            .details-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 25px;
              font-size: 10px;
            }
            .details-table th, .details-table td {
              border: 1px solid #000;
              padding: 8px 6px;
            }
            .details-table th {
              background-color: #ffffff;
              font-weight: bold;
              text-align: center;
              font-size: 10px;
              white-space: nowrap;
            }
            .details-table td {
              font-size: 10px;
            }
            .footer-section {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              margin-top: 50px;
              page-break-inside: avoid;
            }
            .signature-box {
              width: 200px;
              text-align: center;
              border-top: 1px solid #000;
              padding-top: 10px;
              font-weight: bold;
            }
            @media print {
              body {
                padding: 0;
                background-color: white !important;
                color: black !important;
              }
              @page {
                size: A4;
                margin: 10mm;
              }
              tr {
                page-break-inside: avoid;
              }
              .header-section, .info-table, .details-table, .footer-section {
                page-break-inside: avoid;
              }
            }
          </style>
        </head>
        <body>
          <div class="print-container">
            <div class="header-section">
              <div class="logo-box">stilsoft</div>
              <div class="company-info">
                <strong>DEMO TİCARET LİMİTED</strong><br>
                Örnek Mah. Demo Cad. No:1 - Lefkoşa<br>
                Şube: Örnek Sok. No:2<br>
                99010 Lefkoşa - KKTC<br>
                T: +90 850 000 00 00 - V.D.: Demo V.N.: 0000000
              </div>
            </div>

            <div class="title-section">
              <h1>KONSİNYE SEVK EVRAKI</h1>
              <div class="doc-meta">
                <strong>No:</strong> ${irsaliyeNo}<br>
                <strong>Tarih:</strong> ${dateStr.split('-').reverse().join('.')}
              </div>
            </div>

            <table class="info-table">
              <tr>
                <th>ALICI (BAYİ)</th>
                <td>${customerName}</td>
                <th>VERGİ DAİRESİ</th>
                <td>${customerTaxOffice || 'VDAIRE'}</td>
              </tr>
              <tr>
                <th>ADRES</th>
                <td>${customerAddress || 'ADRES EKSİK'}</td>
                <th>VERGİ NO</th>
                <td>${customerTaxNumber || 'VHNO'}</td>
              </tr>
              <tr>
                <th>İLÇE / İL</th>
                <td>${customerCityDistrict || 'İLÇE / İL'}</td>
                <th>BELGE TİPİ</th>
                <td>KONSİNYE SEVK</td>
              </tr>
            </table>

            <table class="details-table">
              <thead>
                <tr>
                  <th style="width: 5%;">SIRA</th>
                  <th style="width: 15%;">STOK KODU</th>
                  <th style="width: 45%;">STOK ADI</th>
                  <th style="width: 10%;">MİKTAR</th>
                  <th style="width: 25%;">AÇIKLAMA</th>
                </tr>
              </thead>
              <tbody>
                ${linesHtml}
              </tbody>
            </table>

            <div class="footer-section">
              <div class="signature-box">
                TESLİM EDEN
              </div>
              <div class="signature-box">
                TESLİM ALAN
              </div>
            </div>
          </div>
          <script>
            window.onload = () => {
              setTimeout(() => {
                window.print();
              }, 350);
            };
          </script>
        </body>
        </html>
      `
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
      const blobUrl = URL.createObjectURL(blob)
      
      const link = document.createElement('a')
      link.href = blobUrl
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err: any) {
      showPopup('error', 'Hata', String(err?.message ?? 'Yazdırma hatası oluştu'))
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([loadDropdowns(), fetchMe()])
        await reload()
      } catch {
        await reload()
      }
    })()
  }, [])

  const columns: TableColumn<HeaderRow>[] = useMemo(
    () => [
      { key: 'irsaliyeNo', label: 'Konsinye No', searchable: true },
      { key: 'customerName', label: 'Cari', searchable: true },
      { key: 'productNames', label: 'Hangi Ürün', searchable: true },
      {
        key: 'totalQuantity',
        label: 'Kaç Adet',
        searchable: true,
        render: (v) => {
          return (
            <span className="text-xs text-gray-700">{String(v ?? '')}</span>
          )
        }
      },
      {
        key: 'totalShippedQuantity',
        label: 'Sevk Adedi',
        searchable: true,
        render: (v) => <span className="text-xs text-gray-700">{String(v ?? '')}</span>
      },
      { key: 'date', label: 'Tarih', searchable: true, filter: { type: 'date' } },
      {
        key: 'description',
        label: 'Açıklama',
        searchable: true,
        render: (v, row) => {
          const p = parseCompositeDescription(String(v ?? ''))
          return (
            <div className="flex items-center gap-2 flex-nowrap min-w-0">
              <span className="text-xs text-gray-700 truncate" title={p.header || p.line}>
                {p.header || p.line}
              </span>
            </div>
          )
        }
      },
      {
        key: 'createUser',
        label: 'İşlemi Yapan',
        searchable: true,
        render: (_v, row) => {
          const u = String(row.createUser ?? '')
          const r = String(row.createUserRole ?? '')
          const label = r ? `${u}(${r})` : u
          return <span className="text-xs font-semibold text-gray-700">{label}</span>
        }
      },
      {
        key: 'status',
        label: 'Durum',
        searchable: true,
        filter: {
          type: 'select',
          options: [
            { label: 'beklemede', value: 'beklemede' },
            { label: 'sevk edildi', value: 'sevkEdildi' }
          ]
        },
        render: (v) => {
          const s = (String(v ?? 'beklemede') as IrsaliyeStatus) || 'beklemede'
          return <span className={`inline-flex items-center px-2 py-1 text-[11px] font-semibold border rounded ${statusClass(s)}`}>{statusLabel(s)}</span>
        }
      },
      {
        key: 'actions',
        label: 'İşlemler',
        searchable: false,
        render: (_v, row) => {
          const irsNo = String(row.irsaliyeNo ?? '').trim()
          return (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setActionsRow(row)}
                className="inline-flex items-center gap-1.5 h-[28px] px-3.5 rounded-md text-[11px] font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-350 hover:text-slate-900 shadow-2xs transition cursor-pointer"
              >
                İşlemler
              </button>
            </div>
          )
        }
      }
    ],
    [reload, showPopup, updatingRowId, rows, layout]
  )

  const groupedRows = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const r of rows ?? []) {
      const key = String(r.irsaliyeNo ?? '').trim()
      if (!key) continue
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    const out: HeaderRow[] = []
    for (const [irsaliyeNo, list] of map.entries()) {
      const sorted = list.slice().sort((a, b) => Number(a.id) - Number(b.id))
      const first = sorted[0]
      const productNames = sorted
        .map((x) => String(x.productName ?? '').trim())
        .filter(Boolean)
        .join(', ')
      const totalQuantity = sorted.reduce((sum, x) => sum + Number(x.quantity ?? 0), 0)
      const totalShippedQuantity = sorted.reduce((sum, x) => sum + Number(x.shippedQuantity ?? 0), 0)
      const status: IrsaliyeStatus = sorted.some((x) => x.status === 'sevkEdildi')
        ? 'sevkEdildi'
        : 'beklemede'
      out.push({
        key: irsaliyeNo,
        irsaliyeNo,
        customerCode: first.customerCode,
        customerName: first.customerName,
        productNames,
        totalQuantity,
        totalShippedQuantity,
        date: first.date,
        description: first.description,
        createUser: first.createUser,
        createUserRole: first.createUserRole,
        status
      })
    }
    return out.sort((a, b) => a.irsaliyeNo.localeCompare(b.irsaliyeNo))
  }, [rows])

  const openCreateModal = () => {
    setError(null)
    const today = new Date().toISOString().slice(0, 10)
    setForm({ ...emptyForm, date: today })
    setModalOpen(true)
  }

  const closeModal = () => {
    if (saving) return
    setModalOpen(false)
  }

  const submit = async () => {
    try {
      setSaving(true)
      setError(null)

      const customerCode = form.customerCode.trim()
      const date = form.date.trim()

      const headerDescription = String(form.description ?? '').trim()

      const extraLines = (Array.isArray((form as any).extraLines) ? ((form as any).extraLines as ExtraLine[]) : [])
        .map((l) => ({
          productId: String(l?.productId ?? '').trim(),
          quantityText: String(l?.quantity ?? '').trim(),
          description: String(l?.description ?? '').trim()
        }))
        .filter((l) => l.productId.length > 0)

      if (!customerCode || !date) {
        setError('Lütfen zorunlu alanları doldurun')
        return
      }

      if (extraLines.length === 0) {
        setError('En az 1 ürün eklemelisiniz')
        return
      }

      if (extraLines.length > 17) {
        setError('En fazla 17 kalem sipariş edebilirsiniz.')
        return
      }

      const firstLine = extraLines[0]
      const firstQty = Number(String(firstLine.quantityText ?? '').replace(',', '.'))

      if (!Number.isFinite(firstQty) || firstQty <= 0) {
        setError('Adet geçersiz')
        return
      }

      const res = await fetch(`${API_BASE_URL}/api/irsaliye`, {
        method: 'POST',
        headers: {
          ...buildHeaders(true)
        },
        body: JSON.stringify({
          customerCode,
          productId: firstLine.productId,
          quantity: firstQty,
          description: buildCompositeDescription(headerDescription, firstLine.description).trim() || null,
          date
        })
      })

      if (!res.ok) {
        throw new Error(await readErrorText(res))
      }

      const created = await res.json().catch(() => null)
      const createdId = Number(created?.data?.id ?? 0)
      let irsaliyeNo = String(created?.data?.irsaliyeNo ?? '').trim()
      if (!irsaliyeNo && Number.isFinite(createdId) && createdId > 0) {
        for (let attempt = 0; attempt < 4 && !irsaliyeNo; attempt++) {
          if (attempt > 0) {
            await new Promise((r) => setTimeout(r, 150))
          }
          const resGet = await fetch(`${API_BASE_URL}/api/irsaliye/${createdId}`, { headers: { ...buildHeaders(false) } })
          if (!resGet.ok) continue
          const j = await resGet.json().catch(() => null)
          irsaliyeNo = String(j?.data?.irsaliyeNo ?? '').trim()
        }
      }

      if (extraLines.length > 1) {
        if (!irsaliyeNo) {
          throw new Error('Konsinye numarası alınamadı')
        }

        await Promise.all(
          extraLines.slice(1).map(async (l) => {
            const q = Number(String(l.quantityText ?? '').replace(',', '.'))
            if (!Number.isFinite(q) || q <= 0) return
            const r2 = await fetch(`${API_BASE_URL}/api/irsaliye`, {
              method: 'POST',
              headers: { ...buildHeaders(true) },
              body: JSON.stringify({
                irsaliyeNo,
                customerCode,
                productId: l.productId,
                quantity: q,
                description: buildCompositeDescription(headerDescription, l.description).trim() || null,
                date
              })
            })
            if (!r2.ok) throw new Error(await readErrorText(r2))
          })
        )
      }

      setModalOpen(false)
      await reload()
      showPopup('success', 'Başarılı', 'İrsaliye eklendi')
    } catch (e: any) {
      const msg = String(e?.message ?? 'Bir hata oluştu')
      setError(msg)
      showPopup('error', 'Hata', msg)
    } finally {
      setSaving(false)
    }
  }

  const currentUserLabel = useMemo(() => {
    const u = String(me.username ?? '').trim()
    const r = String(me.role ?? '').trim()
    if (u && r) return `${u}(${r})`
    return u || r
  }, [me.role, me.username])

  return (
    <div className="p-4">
      <NotificationPopup isOpen={popupOpen} onClose={() => setPopupOpen(false)} variant={popupType} title={popupTitle} message={popupMessage} />

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Konsinye</h1>
          <p className="text-xs text-gray-400 mt-0.5">İrsaliye İşlemleri / Konsinye Yönetimi</p>
        </div>
        <button type="button" onClick={openCreateModal} className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Yeni Konsinye
        </button>
      </div>

      {error && <div className="mb-3 text-xs font-semibold text-red-600 whitespace-pre-line">{error}</div>}

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-visible relative">
        {loading && rows.length === 0 ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-3 bg-gray-100 rounded animate-pulse w-20" />
                <div className="h-3 bg-gray-100 rounded animate-pulse flex-1" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-16" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-24" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-20" />
              </div>
            ))}
          </div>
        ) : (
          <div className="relative">
            {loading && (
              <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] flex items-center justify-center z-10 rounded-xl">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
              </div>
            )}
            {groupedRows.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="text-gray-300 text-2xl mb-1">📦</div>
                <div className="text-xs text-gray-400 font-medium">Kayıt bulunamadı.</div>
              </div>
            ) : (
              <Table
          onRefresh={() => void reload()}
                columns={columns}
                data={groupedRows}
                showColumnFilters
                rowKey={(r) => r.key}
                renderExpandedRow={(row) => {
                  const irsNo = String((row as any).irsaliyeNo ?? '').trim()
                  if (!irsNo) return null
                  const lines = rows
                    .filter((x) => String((x as any).irsaliyeNo ?? '').trim() === irsNo)
                    .slice()
                    .sort((a, b) => Number(a.id) - Number(b.id))
                  if (lines.length === 0) return null
                  return (
                    <div className="border border-gray-100 rounded-xl overflow-hidden bg-white shadow-sm">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-widest border-b border-gray-100">
                            <th className="px-3 py-2 text-left">Hangi Ürün</th>
                            <th className="px-3 py-2 text-right">Kaç Adet</th>
                            <th className="px-3 py-2 text-right">Sevk Adedi</th>
                            <th className="px-3 py-2 text-left">Açıklama</th>
                            <th className="px-3 py-2 text-left">Durum</th>
                            <th className="px-3 py-2 text-right">İşlemler</th>
                          </tr>
                        </thead>
                        <tbody className="text-[11px]">
                          {lines.map((l) => (
                            <tr key={String(l.id)} className="border-t border-gray-100 hover:bg-gray-50">
                              <td className="px-3 py-2 text-gray-800">{String(l.productName ?? '')}</td>
                              <td className="px-3 py-2 text-right text-gray-800">
                                <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                  <span className="text-xs text-gray-700">{String(l.quantity ?? '')}</span>
                                  {canEditQty && l.status !== 'sevkEdildi' && (
                                    <button
                                      type="button"
                                      className="h-7 w-7 inline-flex items-center justify-center rounded border border-gray-200 bg-white hover:bg-gray-50"
                                      title="Düzenle"
                                      onClick={() => {
                                        setQtyRowId(l.id)
                                        setQtyValue(String(l.quantity ?? ''))
                                        setQtyModalOpen(true)
                                      }}
                                    >
                                      <Settings size={14} className="text-gray-600" />
                                    </button>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right text-gray-800">
                                <span className="text-xs text-gray-700">{l.shippedQuantity == null ? '' : String(l.shippedQuantity)}</span>
                              </td>
                              <td className="px-3 py-2 text-gray-700">
                                {(() => {
                                  const p = parseCompositeDescription(String(l.description ?? ''))
                                  return p.line || ''
                                })()}
                              </td>
                              <td className="px-3 py-2">
                                <span className={`inline-flex items-center px-2 py-1 text-[11px] font-semibold border rounded ${statusClass(l.status)}`}>
                                  {statusLabel(l.status)}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
                                 {(() => {
                                   const canDeleteAll = layout?.isSuperAdmin || layout?.allowedKeys?.has('deleteRule/tumIslemleriSilebilsin') || layout?.allowedKeys?.has('deleteRule/deleteRule/tumIslemleriSilebilsin')
                                   const currentUsername = (localStorage.getItem('userName') || '').toLowerCase()
                                   // `islemYapan` diye bir alan yok: API `CreateUser` donuyor ve liste de onu gosteriyor.
                                   // Olu yedek, tip hatasi uretiyordu.
                                   const recordUser = String(l.createUser || '').toLowerCase()
                                   const isOwner = Boolean(currentUsername) && currentUsername === recordUser
                                   const allowedDelete = canDeleteAll || isOwner

                                   const isDisabled = !allowedDelete || updatingRowId != null || l.status === 'sevkEdildi' || l.shippedQuantity != null || l.transferredSalesOrderId != null

                                   return (
                                     <button
                                       type="button"
                                       disabled={isDisabled}
                                       title={!allowedDelete ? 'Bu işlemi sadece işlemi yapan kullanıcı silebilir' : undefined}
                                       onClick={() => {
                                         if (isDisabled) return
                                         void (async () => {
                                           try {
                                             setUpdatingRowId(l.id)
                                             const res = await fetch(`${API_BASE_URL}/api/irsaliye/${l.id}`, {
                                               method: 'DELETE',
                                               headers: { ...buildHeaders(false) }
                                             })
                                             if (!res.ok) throw new Error(await readErrorText(res))
                                             await reload()
                                           } catch (err: any) {
                                             const msg = String(err?.message ?? 'Bir hata oluştu')
                                             setError(msg)
                                             showPopup('error', 'Hata', msg)
                                           } finally {
                                             setUpdatingRowId(null)
                                           }
                                         })()
                                       }}
                                       className={
                                         'px-2 py-1 text-xs font-semibold rounded border transition ' +
                                         (isDisabled
                                           ? 'border-slate-200 text-slate-300 bg-transparent cursor-not-allowed'
                                           : 'border-red-200 text-red-700 bg-white hover:bg-red-50 cursor-pointer')
                                       }
                                     >
                                       Sil
                                     </button>
                                   )
                                 })()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                }}
              />
            )}
          </div>
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title="Konsinye Ekle"
        footer={
          <>
            <button type="button" disabled={saving} onClick={closeModal} className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60">
              Vazgeç
            </button>
            <button type="button" disabled={saving} onClick={() => void submit()} className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              {saving ? 'Kaydediliyor...' : 'Ana sayfaya ekle'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Tarih</div>
            <input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} className="input-base h-9 text-sm" />
          </div>

          <div className="space-y-1 md:col-span-2">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Bayi / Cari</div>
            <SearchableCariSelect
              value={form.customerCode}
              onChange={(val) => setForm((p) => ({ ...p, customerCode: val }))}
              options={customerOptions}
              remoteSearch={cariRemoteSearch}
              remoteLimit={CARI_SEARCH_LIMIT}
              showTypeFilter={false}
              placeholder="Bayi / Cari Ara (Kod, İsim, Tel)..."
            />
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">İşlemi yapan</div>
            <input value={currentUserLabel} readOnly className="input-base h-9 text-sm bg-gray-50" />
          </div>

          <div className="space-y-1 md:col-span-2">
            <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Açıklama</div>
            <input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} className="input-base h-9 text-sm w-full" />
          </div>

          <div className="md:col-span-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Ek Ürünler</div>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  const currentLines = Array.isArray(form.extraLines) ? form.extraLines : []
                  if (currentLines.length >= 17) {
                    showPopup('error', 'Hata', 'En fazla 17 kalem sipariş edebilirsiniz.')
                    return
                  }
                  setForm((p: any) => ({ ...p, extraLines: [...currentLines, { ...emptyExtraLine }] }))
                }}
                className="h-8 inline-flex items-center gap-1.5 px-3 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Ürün Ekle
              </button>
            </div>

            <div className="mt-2 space-y-2">
              {((form as any).extraLines as ExtraLine[]).map((l, idx) => (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 p-2 border border-gray-200 rounded-lg">
                  <div className="md:col-span-6">
                    <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide mb-1">Ürün</div>
                    <SearchableProductSelect
                      value={l.productId}
                      onChange={(productId) =>
                        setForm((p: any) => ({
                          ...p,
                          extraLines: (p.extraLines ?? []).map((x: any, i: number) => (i === idx ? { ...x, productId } : x))
                        }))
                      }
                      options={products}
                      placeholder="Ürün Ara (Stok Kodu veya Adı)..."
                    />
                  </div>

                  <div className="md:col-span-2">
                    <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide mb-1">Adet</div>
                    <input
                      inputMode="decimal"
                      value={l.quantity}
                      onChange={(e) =>
                        setForm((p: any) => ({
                          ...p,
                          extraLines: (p.extraLines ?? []).map((x: any, i: number) => (i === idx ? { ...x, quantity: e.target.value } : x))
                        }))
                      }
                      className="input-base h-9 text-sm w-full"
                    />
                  </div>

                  <div className="md:col-span-3">
                    <div className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide mb-1">Açıklama</div>
                    <input
                      value={l.description}
                      onChange={(e) =>
                        setForm((p: any) => ({
                          ...p,
                          extraLines: (p.extraLines ?? []).map((x: any, i: number) => (i === idx ? { ...x, description: e.target.value } : x))
                        }))
                      }
                      className="input-base h-9 text-sm w-full"
                    />
                  </div>

                  <div className="md:col-span-1 flex items-end justify-end">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setForm((p: any) => ({ ...p, extraLines: (p.extraLines ?? []).filter((_x: any, i: number) => i !== idx) }))}
                      className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-50"
                      title="Sil"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={qtyModalOpen}
        onClose={() => {
          if (updatingRowId != null) return
          setQtyModalOpen(false)
        }}
        title="Adet"
        footer={
          <>
            <button
              type="button"
              disabled={updatingRowId != null}
              onClick={() => setQtyModalOpen(false)}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={updatingRowId != null || qtyRowId == null}
              onClick={async () => {
                if (qtyRowId == null) return
                const n = Number(String(qtyValue ?? '').replace(',', '.'))
                if (!Number.isFinite(n) || n <= 0) {
                  setError('Adet geçersiz')
                  return
                }

                const target = rows.find((r) => r.id === qtyRowId)
                const shipped = Number(target?.shippedQuantity ?? 0)
                if (Number.isFinite(shipped) && shipped > 0 && n < shipped) {
                  setError('Adet sevk adedinden küçük olamaz')
                  return
                }

                try {
                  setUpdatingRowId(qtyRowId)
                  const res = await fetch(`${API_BASE_URL}/api/irsaliye/${qtyRowId}`, {
                    method: 'PUT',
                    headers: { ...buildHeaders(true) },
                    body: JSON.stringify({
                      status: target?.status ?? 'beklemede',
                      quantity: n,
                      shippedQuantity: target?.shippedQuantity ?? null
                    })
                  })
                  if (!res.ok) throw new Error(await readErrorText(res))
                  setQtyModalOpen(false)
                  await reload()
                } catch (err: any) {
                  const msg = String(err?.message ?? 'Bir hata oluştu')
                  setError(msg)
                  showPopup('error', 'Hata', msg)
                } finally {
                  setUpdatingRowId(null)
                }
              }}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Kaydet
            </button>
          </>
        }
      >
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Adet</div>
          <input value={qtyValue} onChange={(e) => setQtyValue(e.target.value)} className="input-base h-9 text-sm" />
        </div>
      </Modal>

      <Modal
        isOpen={transferOpen}
        onClose={() => {
          if (transferSaving) return
          setTransferOpen(false)
        }}
        title={`Faturaya Aktar - ${transferIrsaliyeNo}`}
        footer={
          <>
            <button
              type="button"
              disabled={transferSaving}
              onClick={() => setTransferOpen(false)}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={transferSaving}
              onClick={async () => {
                // Validation
                for (const item of transferItems) {
                  const val = Number(item.soldQuantity.replace(',', '.'))
                  if (isNaN(val) || val < 0) {
                    setError(`${item.productName} için satılan adet geçersiz. Pozitif bir sayı veya 0 olmalıdır.`)
                    return
                  }
                  if (val > item.shippedQuantity) {
                    setError(`${item.productName} için satılan adet, sevk adedinden (${item.shippedQuantity}) büyük olamaz.`)
                    return
                  }
                }

                try {
                  setTransferSaving(true)
                  setError(null)
                  const res = await fetch(`${API_BASE_URL}/api/irsaliye/batch-transfer-to-sales-order`, {
                    method: 'POST',
                    headers: { ...buildHeaders(true) },
                    body: JSON.stringify({
                      items: transferItems.map((x) => ({
                        irsaliyeId: x.id,
                        soldQuantity: Number(x.soldQuantity.replace(',', '.'))
                      }))
                    })
                  })

                  if (!res.ok) throw new Error(await readErrorText(res))
                  const json = await res.json().catch(() => null)
                  const siparisNos = (json?.data?.siparisNos ?? []) as string[]

                  setTransferOpen(false)
                  await reload()

                  showPopup('success', 'Başarılı', `Sipariş(ler) oluşturuldu: ${siparisNos.join(', ')}`)
                } catch (e: any) {
                  const msg = String(e?.message ?? 'Bir hata oluştu')
                  setError(msg)
                  showPopup('error', 'Hata', msg)
                } finally {
                  setTransferSaving(false)
                }
              }}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition disabled:opacity-60"
            >
              Faturaya Aktar
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Lütfen satılan adetleri girin. Sevk adedinden eksik girilen miktarlar otomatik olarak depo stoğuna iade girecektir:
          </p>
          <div className="border border-gray-100 rounded-lg overflow-hidden bg-white max-h-[300px] overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-widest border-b border-gray-100">
                  <th className="px-3 py-2 text-left">Ürün</th>
                  <th className="px-3 py-2 text-right">Sevk Adedi</th>
                  <th className="px-3 py-2 text-right w-24">Satılan Adet</th>
                  <th className="px-3 py-2 text-right w-24">Geri Gelen</th>
                </tr>
              </thead>
              <tbody>
                {transferItems.map((item, idx) => {
                  const shipped = item.shippedQuantity
                  const sold = Number(item.soldQuantity.replace(',', '.'))
                  const returned = isNaN(sold) || sold < 0 ? '' : String(Math.max(0, shipped - sold))
                  return (
                    <tr key={item.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-2 text-left text-gray-800 font-medium">{item.productName}</td>
                      <td className="px-3 py-2 text-right text-gray-600 font-semibold">{item.shippedQuantity}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={item.soldQuantity}
                          onChange={(e) => {
                            const val = e.target.value
                            setTransferItems((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, soldQuantity: val } : it))
                            )
                          }}
                          className="w-full text-right input-base h-8 text-xs border-gray-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 rounded"
                          placeholder="0"
                        />
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500 font-medium">
                        {returned}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={sevkModalOpen}
        onClose={() => {
          if (updatingRowId != null) return
          setSevkModalOpen(false)
        }}
        title="Sevk Adedi"
        footer={
          <>
            <button
              type="button"
              disabled={updatingRowId != null}
              onClick={() => setSevkModalOpen(false)}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={updatingRowId != null || sevkRowId == null}
              onClick={async () => {
                if (sevkRowId == null) return
                const n = Number(String(sevkQuantity ?? '').replace(',', '.'))
                if (!Number.isFinite(n) || n <= 0) {
                  setError('Sevk adedi geçersiz')
                  return
                }

                const target = rows.find((r) => r.id === sevkRowId)
                const max = Number(target?.quantity ?? 0)
                if (Number.isFinite(max) && max > 0 && n > max) {
                  setError('Sevk adedi adet bilgisinden büyük olamaz')
                  return
                }

                try {
                  setUpdatingRowId(sevkRowId)
                  const res = await fetch(`${API_BASE_URL}/api/irsaliye/${sevkRowId}`, {
                    method: 'PUT',
                    headers: { ...buildHeaders(true) },
                    body: JSON.stringify({
                      status: 'sevkEdildi',
                      shippedQuantity: n
                    })
                  })
                  if (!res.ok) throw new Error(await readErrorText(res))
                  setSevkModalOpen(false)
                  await reload()
                  showPopup('success', 'Başarılı', 'İrsaliye güncellendi')
                } catch (err: any) {
                  const msg = String(err?.message ?? 'Bir hata oluştu')
                  setError(msg)
                  showPopup('error', 'Hata', msg)
                } finally {
                  setUpdatingRowId(null)
                }
              }}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition disabled:opacity-60"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Kaydet
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Adet</div>
              <input value={String(rows.find((r) => r.id === sevkRowId)?.quantity ?? '')} readOnly className="input-base h-9 text-sm bg-gray-50" />
            </div>
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Sevk Adedi</div>
              <input value={sevkQuantity} onChange={(e) => setSevkQuantity(e.target.value)} className="input-base h-9 text-sm" />
            </div>
          </div>
        </div>
      </Modal>

      {bottomToastOpen && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] w-[calc(100%-2rem)] max-w-xl">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 shadow-lg">
            <div className="text-sm font-semibold text-green-800">{bottomToastMessage}</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBottomToastOpen(false)}
                className="px-3 py-1.5 rounded text-xs font-semibold border border-green-300 text-green-800 hover:bg-green-100"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={confirmOpen}
        onClose={() => {
          setConfirmOpen(false)
          setConfirmAction(null)
        }}
        title={confirmTitle}
        hideHeader={true}
        containerClassName="max-w-md"
      >
        <div className="flex flex-col items-center text-center p-4">
          <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mb-4 border border-blue-100 text-blue-600 shadow-inner">
            <HelpCircle size={28} />
          </div>

          <h3 className="text-base font-bold text-gray-800 mb-2">
            {confirmTitle}
          </h3>
          <p className="text-xs text-gray-500 mb-6 max-w-xs leading-relaxed">
            {confirmText}
          </p>

          <div className="flex gap-3 w-full">
            <button
              type="button"
              onClick={() => {
                setConfirmOpen(false)
                setConfirmAction(null)
              }}
              className="flex-1 h-9 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold transition"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmOpen(false)
                if (confirmAction) confirmAction()
              }}
              className="flex-1 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition"
            >
              Onayla
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={bulkSevkModalOpen}
        onClose={() => {
          if (saving) return
          setBulkSevkModalOpen(false)
        }}
        title={`Konsinye Sevk Et - ${bulkSevkIrsaliyeNo}`}
        footer={
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => setBulkSevkModalOpen(false)}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={saving || !bulkSevkItems.some((x) => x.selected)}
              onClick={async () => {
                const selectedItems = bulkSevkItems.filter((x) => x.selected)
                if (selectedItems.length === 0) return

                // Validation
                for (const item of selectedItems) {
                  const val = Number(item.shippedQuantity.replace(',', '.'))
                  if (isNaN(val) || val <= 0) {
                    setError(`${item.productName} için sevk adedi geçersiz. Pozitif bir sayı olmalıdır.`)
                    return
                  }
                  if (val > item.quantity) {
                    setError(`${item.productName} için sevk adedi, toplam adet değerinden (${item.quantity}) büyük olamaz.`)
                    return
                  }
                }

                try {
                  setSaving(true)
                  setError(null)
                  for (const item of selectedItems) {
                    const val = Number(item.shippedQuantity.replace(',', '.'))
                    const res = await fetch(`${API_BASE_URL}/api/irsaliye/${item.id}`, {
                      method: 'PUT',
                      headers: { ...buildHeaders(true) },
                      body: JSON.stringify({
                        status: 'sevkEdildi',
                        shippedQuantity: val,
                        warehouseCode: selectedWarehouseCode ? Number(selectedWarehouseCode) : null
                      })
                    })
                    if (!res.ok) throw new Error(await readErrorText(res))
                  }
                  setBulkSevkModalOpen(false)
                  await reload()
                  showPopup('success', 'Başarılı', 'Konsinye sevk edildi')
                  await handlePrintIrsaliye(bulkSevkIrsaliyeNo)
                } catch (err: any) {
                  const msg = String(err?.message ?? 'Bir hata oluştu')
                  setError(msg)
                  showPopup('error', 'Hata', msg)
                } finally {
                  setSaving(false)
                }
              }}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition disabled:opacity-60"
            >
              Sevk Et
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {warehouses.length > 1 && (
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Çıkış Yapılacak Depo</div>
              <select
                value={selectedWarehouseCode}
                onChange={(e) => setSelectedWarehouseCode(e.target.value)}
                className="input-base h-9 text-sm w-full"
              >
                {warehouses.map((w) => (
                  <option key={w.warehouseCode} value={w.warehouseCode}>
                    [{w.warehouseCode}] {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="text-xs text-gray-500">
            Lütfen sevk etmek istediğiniz ürünleri seçin ve sevk adetlerini girin:
          </p>
          <div className="border border-gray-100 rounded-lg overflow-hidden bg-white max-h-[300px] overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 text-[10px] font-semibold text-gray-500 uppercase tracking-widest border-b border-gray-100">
                  <th className="px-3 py-2 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={bulkSevkItems.length > 0 && bulkSevkItems.every((x) => x.selected)}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setBulkSevkItems((prev) => prev.map((x) => ({ ...x, selected: checked })))
                      }}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th className="px-3 py-2 text-left">Ürün</th>
                  <th className="px-3 py-2 text-right">Toplam Adet</th>
                  <th className="px-3 py-2 text-right w-24">Sevk Adedi</th>
                </tr>
              </thead>
              <tbody>
                {bulkSevkItems.map((item, idx) => (
                  <tr key={item.id} className={`border-t border-gray-100 hover:bg-gray-50 ${!item.selected ? 'opacity-60 bg-gray-50/50' : ''}`}>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={(e) => {
                          const checked = e.target.checked
                          setBulkSevkItems((prev) =>
                            prev.map((it, i) => (i === idx ? { ...it, selected: checked } : it))
                          )
                        }}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-3 py-2 text-left text-gray-800 font-medium">{item.productName}</td>
                    <td className="px-3 py-2 text-right text-gray-600 font-semibold">{item.quantity}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={!item.selected}
                        value={item.shippedQuantity}
                        onChange={(e) => {
                          const val = e.target.value
                          setBulkSevkItems((prev) =>
                            prev.map((it, i) => (i === idx ? { ...it, shippedQuantity: val } : it))
                          )
                        }}
                        className="w-full text-right input-base h-8 text-xs border-gray-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 rounded disabled:bg-gray-100"
                        placeholder="0"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      {actionsRow !== null && (() => {
        const irsNo = String(actionsRow.irsaliyeNo ?? '').trim()
        const lines = rows.filter((x) => String(x.irsaliyeNo ?? '').trim() === irsNo)

        const isSevkDisabled = updatingRowId != null || !irsNo || lines.every((x) => x.status === 'sevkEdildi')
        const isPrintDisabled = updatingRowId != null || !irsNo || !lines.some((x) => x.shippedQuantity != null && x.shippedQuantity > 0)
        const isTransferDisabled = updatingRowId != null || !irsNo || !lines.some((x) => x.shippedQuantity != null && x.shippedQuantity > 0 && x.transferredSalesOrderId == null)
        const isDeleteDisabled = updatingRowId != null || !irsNo || lines.some((x) => x.status === 'sevkEdildi' || x.shippedQuantity != null || x.transferredSalesOrderId != null)
        const isRevertDisabled = updatingRowId != null || !irsNo || !lines.some((x) => x.status === 'sevkEdildi' || x.shippedQuantity != null || x.transferredSalesOrderId != null)

        return (
          <Modal
            isOpen={actionsRow !== null}
            onClose={() => setActionsRow(null)}
            title={`Konsinye İşlemleri (No: ${irsNo})`}
            footer={
              <button
                type="button"
                className="h-[34px] px-4 text-xs font-semibold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition"
                onClick={() => setActionsRow(null)}
              >
                Kapat
              </button>
            }
          >
            <div className="flex flex-col gap-2 p-1">
              <button
                type="button"
                disabled={isSevkDisabled}
                onClick={() => {
                  setActionsRow(null)
                  const pendingLines = lines.filter((x) => x.status !== 'sevkEdildi')
                  if (pendingLines.length === 0) return

                  setBulkSevkIrsaliyeNo(irsNo)
                  setBulkSevkItems(
                    pendingLines.map((l) => ({
                      id: l.id,
                      productName: l.productName,
                      quantity: l.quantity,
                      shippedQuantity: String(l.shippedQuantity ?? l.quantity),
                      selected: true
                    }))
                  )

                  fetchAuthorizedWarehousesDropdown()
                    .then((list) => {
                      setWarehouses(list)
                      if (list.length > 0) {
                        setSelectedWarehouseCode(String(list[0].warehouseCode))
                      } else {
                        setSelectedWarehouseCode('')
                      }
                    })
                    .catch(() => {
                      setWarehouses([])
                      setSelectedWarehouseCode('')
                    })

                  setBulkSevkModalOpen(true)
                }}
                className="w-full h-10 px-4 text-left text-xs font-semibold rounded-lg transition-colors flex items-center justify-between border border-slate-200 bg-white text-slate-750 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <span>🚚 Sevk Et & Rapor Oluştur</span>
              </button>

              <button
                type="button"
                disabled={isPrintDisabled}
                onClick={() => {
                  setActionsRow(null)
                  void handlePrintIrsaliye(irsNo)
                }}
                className="w-full h-10 px-4 text-left text-xs font-semibold rounded-lg transition-colors flex items-center justify-between border border-slate-200 bg-white text-slate-750 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <span>🖨️ Sevk Raporu Yazdır</span>
              </button>

              <button
                type="button"
                disabled={isTransferDisabled}
                onClick={() => {
                  setActionsRow(null)
                  const targetLines = lines.filter((x) => x.shippedQuantity != null && x.shippedQuantity > 0 && x.transferredSalesOrderId == null)
                  if (targetLines.length === 0) return

                  setTransferIrsaliyeNo(irsNo)
                  setTransferItems(
                    targetLines.map((x) => ({
                      id: x.id,
                      productName: x.productName,
                      shippedQuantity: Number(x.shippedQuantity ?? 0),
                      soldQuantity: String(x.shippedQuantity ?? 0)
                    }))
                  )
                  setError(null)
                  setTransferOpen(true)
                }}
                className="w-full h-10 px-4 text-left text-xs font-semibold rounded-lg transition-colors flex items-center justify-between border border-slate-200 bg-white text-slate-750 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <span>📄 Faturaya Aktar</span>
              </button>

              <button
                type="button"
                disabled={isDeleteDisabled}
                onClick={() => {
                  setActionsRow(null)
                  if (!irsNo) return
                  askConfirmation(
                    'Konsinyeyi Sil',
                    `Konsinye ${irsNo} komple silinsin mi?`,
                    async () => {
                      try {
                        setUpdatingRowId(-1)
                        const res = await fetch(`${API_BASE_URL}/api/Irsaliye/by-no/${encodeURIComponent(irsNo)}`, {
                          method: 'DELETE',
                          headers: { ...buildHeaders(false) }
                        })
                        if (!res.ok) throw new Error(await readErrorText(res))
                        await reload()
                        showPopup('success', 'Başarılı', 'Konsinye silindi')
                      } catch (err: any) {
                        const msg = String(err?.message ?? 'Bir hata oluştu')
                        setError(msg)
                        showPopup('error', 'Hata', msg)
                      } finally {
                        setUpdatingRowId(null)
                      }
                    }
                  )
                }}
                className="w-full h-10 px-4 text-left text-xs font-semibold rounded-lg transition-colors flex items-center justify-between border border-red-100 bg-red-50/30 text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <span>🗑️ Konsinyeyi Sil</span>
              </button>

              <button
                type="button"
                disabled={isRevertDisabled}
                onClick={() => {
                  setActionsRow(null)
                  if (!irsNo) return
                  askConfirmation(
                    'Konsinye Geri Al',
                    `Konsinye ${irsNo} tamamen başlangıç durumuna döndürülecek:\n\n• Sevk adetleri sıfırlanacak\n• Depo hareketleri kaldırılacak\n• Satış siparişi silinecek (varsa)\n• Tüm kalemler Beklemede durumuna dönecek\n\nBu işlem geri alınamaz. Devam etmek istiyor musunuz?`,
                    async () => {
                      try {
                        setUpdatingRowId(-1)
                        const res = await fetch(`${API_BASE_URL}/api/Irsaliye/by-no/${encodeURIComponent(irsNo)}/revert`, {
                          method: 'POST',
                          headers: { ...buildHeaders(false) }
                        })
                        if (!res.ok) throw new Error(await readErrorText(res))
                        await reload()
                        showPopup('success', 'Başarılı', 'Konsinye başlangıç durumuna geri alındı')
                      } catch (err: any) {
                        const msg = String(err?.message ?? 'Bir hata oluştu')
                        setError(msg)
                        showPopup('error', 'Hata', msg)
                      } finally {
                        setUpdatingRowId(null)
                      }
                    }
                  )
                }}
                className="w-full h-10 px-4 text-left text-xs font-semibold rounded-lg transition-colors flex items-center justify-between border border-amber-100 bg-amber-50/30 text-amber-700 hover:bg-amber-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                <span>🔄 Konsinye Geri Al</span>
              </button>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}
