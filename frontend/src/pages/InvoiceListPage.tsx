import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { fetchProducts } from '../api/products'
import type { InvoiceListItem } from '../lib/invoices'
import { BadgeCheck, ChevronDown, ChevronRight, ListFilter, CircleAlert, Search, X } from 'lucide-react'
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import ColumnFilterSearchBar from '../components/table/ColumnFilterSearchBar'
import Modal from '../components/Modal'
import CariEkstreModal from '../components/CariEkstreModal'
import ActionDropdown from '../components/ActionDropdown'
import { fetchCustomersDropdown, fetchCustomerByCode, type CustomerDto } from '../api/customers'
import { fetchInvoiceHeader, updateInvoiceHeader, fetchInvoiceLines, fetchInvoicePrintPdf, fetchInvoiceBarcodePdf } from '../api/invoices'
import { fetchSuppliers, type SupplierDto } from '../api/suppliers'
import { fetchServiceCatalog, type ServiceCatalogItemDto } from '../api/serviceCatalog'
import { fetchPriceGroups, type PriceGroupDto } from '../api/priceGroups'
import { API_BASE_URL } from '../config/api'
import { fetchCashAccounts, type CashAccountDto } from '../api/cashAccounts'
import { fetchBankAccountDefinitions, type BankAccountDefinitionDto } from '../api/bankAccountDefinitions'
import { fetchBankAccountBalance } from '../api/bankAccountTransactions'
import { fetchLatestFxRate } from '../api/fx'
import { AppDataTable, type DataTableRowAction } from '../components/data-table'
import { getInvoiceListColumns } from './invoice-list/invoiceListColumns'
import { useInvoiceList } from './invoice-list/useInvoiceList'
import { InvoicePreviewModal } from '../components/data-table/InvoicePreviewModal'
import { PHONE_FORMAT_MESSAGE, PHONE_MAX_LENGTH, PHONE_PATTERN, formatPhoneNumber } from '../utils/phone'
import SearchableCariSelect from '../components/SearchableCariSelect'

type LayoutContext = {
  isSuperAdmin?: boolean
  allowedKeys?: Set<string>
}

function formatMoney(n: number) {
  const v = Number(n ?? 0)
  return `${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Dövizli kalemler "1.500,00 USD" yazarken TL kalemler çıplak sayı kalıyordu; aynı sütunda
// para birimi bazen görünüp bazen görünmesin diye TL tutarlar da etiketleniyor.
//
// PARA BİRİMİ SONDA (2026-08-22 kullanıcı kararı). Eskiden başa yazılıyordu ("TL 1.500,00");
// sağa yaslı para sütunlarında kod ile rakam arasındaki boşluk satırdan satıra değiştiği için
// sayılar hizasız görünüyordu. Sonda yazınca rakamlar sütunun sağında hizalı kalıyor.
function formatTlMoney(n: number) {
  return `${formatMoney(n)} TL`
}

function currencyCodeByTypeId(cur: number) {
  const v = Number(cur ?? 1)
  return v === 2 ? 'EUR' : v === 3 ? 'USD' : v === 4 ? 'GBP' : 'TRY'
}

function getAccountCurrencyCode(acc: { currencyTypeId?: number; accountName?: string; name?: string; accountCode?: string; code?: string } | null | undefined): string {
  if (!acc) return 'TRY'
  const text = `${acc.accountName ?? ''} ${acc.name ?? ''} ${acc.accountCode ?? ''} ${acc.code ?? ''}`.toUpperCase()
  if (text.includes('USD') || text.includes('DOLAR')) return 'USD'
  if (text.includes('EUR') || text.includes('EURO')) return 'EUR'
  if (text.includes('GBP') || text.includes('STERLİN') || text.includes('STERLIN')) return 'GBP'

  const v = Number(acc.currencyTypeId ?? 1)
  if (v === 2) return 'EUR'
  if (v === 3) return 'USD'
  if (v === 4) return 'GBP'
  return 'TRY'
}

function generateGuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function formatUnitPriceDisplay(line: any) {
  const curTypeId = Number(line?.currencyTypeId ?? 0)
  const curUnit = Number(line?.currencyUnitPrice ?? 0)
  if (!Number.isFinite(curTypeId) || curTypeId <= 0) return formatTlMoney(Number(line?.unitPrice ?? 0))
  if (!Number.isFinite(curUnit) || curUnit <= 0) return formatTlMoney(Number(line?.unitPrice ?? 0))
  const code = currencyCodeByTypeId(curTypeId)
  return `${curUnit.toFixed(2)} ${code}`
}

function formatLineTotalDisplay(line: any) {
  const qty = Number(line?.quantity ?? 0)
  const curTypeId = Number(line?.currencyTypeId ?? 0)
  const curUnit = Number(line?.currencyUnitPrice ?? 0)
  if (!Number.isFinite(curTypeId) || curTypeId <= 0) return formatTlMoney(Number(line?.total ?? qty * Number(line?.unitPrice ?? 0)))
  if (!Number.isFinite(curUnit) || curUnit <= 0) return formatTlMoney(Number(line?.total ?? qty * Number(line?.unitPrice ?? 0)))
  if (!Number.isFinite(qty) || qty <= 0) return `0.00 ${currencyCodeByTypeId(curTypeId)}`
  const total = qty * curUnit
  return `${total.toFixed(2)} ${currencyCodeByTypeId(curTypeId)}`
}

/**
 * KALEM NET TOPLAMI — KDV DAHİL (2026-08-19 kullanıcı kararı).
 *
 * Sütun eskiden KDV HARİÇ tutarı yazıyordu: birim fiyat ve KDV oranı doğru görünürken
 * kalemlerin "Net Toplam"ı fatura başlığındaki Genel Toplam'ı tutturmuyordu ve kullanıcı
 * bunu hata olarak okudu. Artık kalem satırı, genel toplamın hesaplandığı gibi hesaplanıyor:
 * (miktar × birim fiyat − indirim) × (1 + KDV). KDV'siz faturada (muaf/açık) ve hediye
 * kalemde oran 0'dır — `vatExempt` bunu üstteki KDV sütunuyla aynı kuraldan alır.
 */
function formatLineNetTotalDisplay(line: any, vatExempt = false) {
  const qty = Number(line?.quantity ?? 0)
  const unitPrice = Number(line?.unitPrice ?? 0)
  const discount = Number(line?.discountAmount ?? 0)
  const curTypeId = Number(line?.currencyTypeId ?? 0)
  const curUnit = Number(line?.currencyUnitPrice ?? 0)
  const rate = Number(line?.currencyRate ?? 1)

  const vatRate = vatExempt || Boolean(line?.isGift) ? 0 : Math.max(0, Number(line?.vatRate ?? 0))
  const vatMultiplier = 1 + vatRate / 100

  const netTotalTry = Math.max(0, (qty * unitPrice) - discount) * vatMultiplier
  const hasFx = Number.isFinite(curTypeId) && curTypeId > 0 && Number.isFinite(curUnit) && curUnit > 0

  if (hasFx) {
    const discountFx = rate > 0 ? discount / rate : 0
    const netTotalFx = Math.max(0, (qty * curUnit) - discountFx) * vatMultiplier
    const code = currencyCodeByTypeId(curTypeId)
    return `${netTotalFx.toFixed(2)} ${code}`
  }

  return formatTlMoney(netTotalTry)
}

function computeSingleCurrencySummary(lines: any[] | null | undefined) {
  const arr = Array.isArray(lines) ? lines : []
  if (arr.length === 0) return null

  const currencyIds = new Set<number>()
  for (const l of arr) {
    const curTypeId = Number(l?.currencyTypeId ?? 0)
    const curUnit = Number(l?.currencyUnitPrice ?? 0)
    if (Number.isFinite(curTypeId) && curTypeId > 0 && Number.isFinite(curUnit) && curUnit > 0) currencyIds.add(curTypeId)
  }

  if (currencyIds.size !== 1) return null
  const currencyTypeId = Array.from(currencyIds)[0]

  const subtotal = arr.reduce((acc, l) => {
    const qty = Number(l?.quantity ?? 0)
    const isGift = Boolean(l?.isGift)
    const curUnit = isGift ? 0.01 : Number(l?.currencyUnitPrice ?? 0)
    if (!Number.isFinite(qty) || qty <= 0) return acc
    if (!Number.isFinite(curUnit) || curUnit <= 0) return acc
    return acc + qty * curUnit
  }, 0)

  const vatTotal = arr.reduce((acc, l) => {
    if (Boolean(l?.isGift)) return acc
    const qty = Number(l?.quantity ?? 0)
    const curUnit = Number(l?.currencyUnitPrice ?? 0)
    const vatRate = Number(l?.vatRate ?? 0)
    if (!Number.isFinite(qty) || qty <= 0) return acc
    if (!Number.isFinite(curUnit) || curUnit <= 0) return acc
    if (!Number.isFinite(vatRate) || vatRate <= 0) return acc
    return acc + qty * curUnit * (vatRate / 100)
  }, 0)

  const grandTotal = subtotal + vatTotal
  return { currencyTypeId, subtotal, vatTotal, grandTotal }
}

function normalizeInvoiceLineDto(l: any) {
  const src = l ?? {}
  return {
    ...src,
    id: src.id ?? src.Id,
    stockCode: src.stockCode ?? src.StockCode,
    stockName: src.stockName ?? src.StockName,
    description: src.description ?? src.Description,
    vatRate: src.vatRate ?? src.VatRate,
    quantity: src.quantity ?? src.Quantity,
    unitPrice: src.unitPrice ?? src.UnitPrice,
    total: src.total ?? src.Total,
    salesOrderLineId: src.salesOrderLineId ?? src.SalesOrderLineId,
    currencyTypeId: src.currencyTypeId ?? src.CurrencyTypeId,
    currencyRate: src.currencyRate ?? src.CurrencyRate,
    currencyUnitPrice: src.currencyUnitPrice ?? src.CurrencyUnitPrice,
    barcode: src.barcode ?? src.Barcode,
    barcodeType: src.barcodeType ?? src.BarcodeType,
    isGift: src.isGift !== undefined ? src.isGift : (src.IsGift !== undefined ? src.IsGift : false),
    discountAmount: src.discountAmount !== undefined ? src.discountAmount : (src.DiscountAmount !== undefined ? src.DiscountAmount : 0),
    installationName: src.installationName ?? src.InstallationName,
    installationCount: Number(src.installationCount ?? src.InstallationCount ?? 0),
    installedQuantity: Number(src.installedQuantity ?? src.InstalledQuantity ?? 0)
  }
}

function generateBarcodeSvgHtml(barcode: string, barcodeType: string): string {
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const format = barcodeType === 'EAN13' ? 'EAN13' : 'CODE128'
    JsBarcode(svg, barcode, {
      format,
      width: 1.8,
      height: 50,
      displayValue: true,
      fontSize: 14,
      font: 'monospace',
      textMargin: 4,
      margin: 0,
    })
    return svg.outerHTML
  } catch (err) {
    console.error(err)
    return `<div style="padding: 10px; border: 1px dashed #ccc; font-size: 10px; color: #777; font-family: sans-serif;">Barkod Hatası (${barcode})</div>`
  }
}

function buildInvoiceBarcodesHtml(invoice: any, lines: any[]): string {
  const formatMoney = (v: number, unit: string) => {
    return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + unit
  }

  /**
   * Etiket fiyatı KALEMİN kendi para biriminde.
   *
   * Sabit " TL" yazıp TL karşılığını basıyordu: dolarla kesilmiş bir faturanın ürün rafına
   * lira etiketi çıkıyor, müşteriye gösterilen fiyat belgedekiyle tutmuyordu. Kalemde döviz
   * yoksa (curTypeId 0/boş) davranış eskisiyle birebir aynı: TL tutar + "TL".
   * Sunucudaki etiket basımıyla aynı kural (bkz. ProductLabelRenderer).
   */
  const labelPrice = (line: any) => {
    const curTypeId = Number(line?.currencyTypeId ?? 0)
    const curUnit = Number(line?.currencyUnitPrice ?? 0)
    const hasFx = Number.isFinite(curTypeId) && curTypeId > 1 && Number.isFinite(curUnit) && curUnit > 0
    if (!hasFx) return formatMoney(Number(line?.unitPrice ?? 0), 'TL')
    return formatMoney(curUnit, currencyCodeByTypeId(curTypeId))
  }

  const labelsHtml: string[] = []
  lines.forEach((line) => {
    const barcode = String(line.barcode || '').trim()
    if (!barcode) return

    const qty = Math.max(1, Math.floor(Number(line.quantity || 1)))

    const singleLabelHtml = `
      <div class="label-card">
        <div class="label-title">${line.stockCode ? `${line.stockCode} - ` : ''}${line.stockName || ''}</div>
        <div class="label-price">${labelPrice(line)}</div>
        <div class="label-barcode">
          ${generateBarcodeSvgHtml(barcode, line.barcodeType || 'CODE128')}
        </div>
      </div>
    `
    for (let i = 0; i < qty; i++) {
      labelsHtml.push(singleLabelHtml)
    }
  })

  if (labelsHtml.length === 0) {
    return `
      <!DOCTYPE html>
      <html>
      <head><title>Barkod Basımı</title></head>
      <body style="font-family: sans-serif; padding: 40px; text-align: center; color: #666;">
        <h2>Faturadaki ürünlerin barkod bilgisi tanımlı değil.</h2>
      </body>
      </html>
    `
  }

  const labelsGrid = labelsHtml.join('')

  return `
    <!DOCTYPE html>
    <html lang="tr">
    <head>
      <meta charset="UTF-8" />
      <title>YazdirBarkodFatura — ${invoice.faturaNo}</title>
      <style>
        @page {
          size: auto;
          margin: 10mm;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: 20px;
          padding-top: 80px;
          background: #f8fafc;
          font-family: 'Times New Roman', Georgia, serif;
        }
        .print-toolbar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 999;
          background: #0f172a;
          color: #fff;
          padding: 12px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .print-toolbar .info {
          font-size: 14px;
        }
        .print-toolbar .info strong {
          color: #38bdf8;
        }
        .print-toolbar .info .count {
          margin-left: 16px;
          color: #94a3b8;
          font-size: 13px;
        }
        .print-btn {
          background: #059669;
          color: #fff;
          border: none;
          padding: 10px 28px;
          font-size: 14px;
          font-weight: 700;
          border-radius: 8px;
          cursor: pointer;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          transition: background 0.15s;
        }
        .print-btn:hover {
          background: #047857;
        }
        
        .labels-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 15px;
          max-width: 800px;
          margin: 0 auto;
        }
        .label-card {
          border: 1px solid #1e293b;
          border-radius: 6px;
          padding: 15px;
          background: #fff;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          page-break-inside: avoid;
          break-inside: avoid;
          min-height: 140px;
          text-align: center;
        }
        .label-title {
          font-size: 12px;
          font-weight: 950;
          line-height: 1.2;
          margin-bottom: 6px;
          color: #000;
          text-transform: uppercase;
          word-break: break-all;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .label-price {
          font-size: 18px;
          font-weight: 900;
          margin-bottom: 4px;
          color: #000;
        }
        .label-barcode {
          display: flex;
          justify-content: center;
          width: 100%;
        }
        .label-barcode svg {
          max-height: 65px;
        }
        
        @media print {
          .print-toolbar { display: none !important; }
          body {
            padding: 0;
            padding-top: 0;
            background: #fff;
          }
        }
      </style>
    </head>
    <body>
      <div class="print-toolbar">
        <div class="info">
          <strong>Fatura No: ${invoice.faturaNo}</strong>
          <span class="count">${labelsHtml.length} adet barkod etiketi basılacak</span>
        </div>
        <button class="print-btn" onclick="window.print()">🖨️ YAZDIR</button>
      </div>
      <div class="labels-grid">
        ${labelsGrid}
      </div>
    </body>
    </html>
  `
}

function parseMontajTag(desc: string | null | undefined) {
  const s = String(desc ?? '')
  if (!s) return null
  const m = s.match(/\[MONTAJ\s+net=([0-9.]+)\s+vat=([0-9.]+)\s+gross=([0-9.]+)\s+rate=([0-9.]+)\]/i)
  if (!m) return null
  const gross = Number(m[3])
  if (!Number.isFinite(gross) || gross <= 0) return null
  return { gross }
}

function normalizeInvoiceLineDescription(desc: string | null | undefined) {
  const s = String(desc ?? '').trim()
  if (!s) return ''

  const tag = parseMontajTag(s)
  const parts = s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !/^Montaj\s*\(KDV\s*hariç\)/i.test(x))
    .filter((x) => !/^\[MONTAJ\s+/i.test(x))

  if (tag) parts.push(`Montaj = ${formatMoney(tag.gross)}`)
  return parts.join('\n')
}

function toUtcIsoStartOfDay(dateOnly: string) {
  const s = String(dateOnly ?? '').trim()
  if (!s) return ''
  // Date input is yyyy-mm-dd. Force UTC start of day.
  return new Date(`${s}T00:00:00.000Z`).toISOString()
}

function toUtcIsoEndOfDay(dateOnly: string) {
  const s = String(dateOnly ?? '').trim()
  if (!s) return ''
  // Force UTC end of day.
  return new Date(`${s}T23:59:59.999Z`).toISOString()
}

interface InvoiceLinesPanelProps {
  invoice: InvoiceListItem
  isSuperAdmin: boolean
  allowedKeys: Set<string> | undefined
  openMontage: (invoice: any, line: any) => void
  reloadList: () => void
  /** Montaj eklendiğinde/silindiğinde artar; kalemler yeniden çekilir ki buton etiketi güncellensin. */
  montageRefreshKey: number
  isLocked?: boolean
}

function InvoiceLinesPanel({
  invoice,
  isSuperAdmin,
  allowedKeys,
  openMontage,
  reloadList,
  montageRefreshKey,
  isLocked
}: InvoiceLinesPanelProps) {
  const [lines, setLines] = useState<any[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const loadLines = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(invoice.id)}/lines`, { headers })
      if (!res.ok) throw new Error('Hata')
      const json = await res.json()
      setLines(((json?.data ?? []) as any[]).map(normalizeInvoiceLineDto))
    } catch {
      setLines([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadLines()
  }, [invoice.id, refreshKey, montageRefreshKey])

  // `deleteLine` KALDIRILDI (2026-08-26): fatura kalemi tek tek silinmiyor.
  // Yanlış kalem varsa fatura tümüyle silinip yeniden kesilir. Gerekçe için
  // aşağıdaki kalem tablosundaki uzun yoruma bakın.

  return (
    <div className="p-4 bg-slate-50/50 border border-slate-200 rounded-lg">

      <div className="border border-slate-200 rounded overflow-hidden bg-white shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 text-[11px] font-semibold text-slate-600 border-b border-slate-200">
              <th className="px-3 py-2 text-left border-r border-slate-200">Stok Kodu</th>
              <th className="px-3 py-2 text-left border-r border-slate-200">Stok Adı</th>
              <th className="px-3 py-2 text-left border-r border-slate-200">Açıklama</th>
              <th className="px-3 py-2 text-left border-r border-slate-200">Montaj İsmi</th>
              <th className="px-3 py-2 text-right border-r border-slate-200">KDV</th>
              <th className="px-3 py-2 text-right border-r border-slate-200">Miktar</th>
              <th className="px-3 py-2 text-right border-r border-slate-200">Birim Fiyat</th>
              <th className="px-3 py-2 text-right border-r border-slate-200">İndirim</th>
              <th className="px-3 py-2 text-right border-r border-slate-200">Net Toplam (KDV Dahil)</th>
              <th className="px-3 py-2 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={10} className="px-3 py-3 text-center text-gray-400 animate-pulse">
                  Yükleniyor...
                </td>
              </tr>
            ) : !lines ? (
              <tr>
                <td colSpan={10} className="px-3 py-3 text-center text-gray-400">
                  Detay yükleniyor...
                </td>
              </tr>
            ) : lines.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-3 text-center text-gray-400">
                  Kalem bulunamadı.
                </td>
              </tr>
            ) : (
              lines.map((l: any, i: number) => (
                <tr key={String(l.id ?? i)} className={`hover:bg-slate-50/50 ${l.isGift ? 'bg-green-50/20' : ''}`}>
                  <td className="px-3 py-2 align-top text-gray-700 border-r border-slate-200">{String(l.stockCode ?? '')}</td>
                  <td className="px-3 py-2 align-top text-gray-800 font-medium border-r border-slate-200">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="truncate">{String(l.stockName ?? '')}</span>
                      {l.isGift && (
                        <span className="px-1 py-0.5 rounded bg-green-100 text-green-700 text-[8px] font-extrabold uppercase shrink-0">Hediye</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-gray-500 border-r border-slate-200">
                    {(() => {
                      let desc = normalizeInvoiceLineDescription(l.description);
                      const isGift = Boolean(l.isGift);
                      const discount = Number(l.discountAmount ?? 0);
                      let campaignNote = '';
                      if (isGift) {
                        campaignNote = '(Kampanya - Hediye)';
                      } else if (discount > 0) {
                        campaignNote = '(Kampanya İndirimi)';
                      }
                      
                      if (campaignNote && !desc.includes('Kampanya')) {
                        desc = desc ? `${desc} ${campaignNote}` : campaignNote;
                      }
                      return desc;
                    })()}
                  </td>
                  <td className="px-3 py-2 align-top text-gray-700 border-r border-slate-200">
                    {l.installationName || '-'}
                  </td>
                  <td className="px-3 py-2 text-right align-top text-gray-600 border-r border-slate-200">
                    {l.isGift || Number(invoice?.kdvTutari ?? 0) === 0 ? '0%' : `${Number(l.vatRate ?? 0)}%`}
                  </td>
                  <td className="px-3 py-2 text-right align-top text-gray-800 font-semibold border-r border-slate-200">{Number(l.quantity ?? 0)}</td>
                  <td className="px-3 py-2 text-right align-top text-gray-800 border-r border-slate-200">
                    {l.isGift ? (
                      <div className="flex flex-col items-end">
                        <div className="text-green-600 font-bold">{formatUnitPriceDisplay(l)}</div>
                        <div className="text-[10px] text-green-700 font-extrabold uppercase bg-green-100 px-1 py-0.5 rounded">Hediye Ürün</div>
                      </div>
                    ) : (
                      formatUnitPriceDisplay(l)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right align-top text-green-600 font-semibold border-r border-slate-200">
                    {Number(l.discountAmount ?? 0) > 0 ? `-${formatMoney(Number(l.discountAmount))}` : '0.00'}
                  </td>
                  <td className="px-3 py-2 text-right align-top font-bold text-slate-900 border-r border-slate-200">
                    {formatLineNetTotalDisplay(l, Number(invoice?.kdvTutari ?? 0) === 0)}
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <div className="flex items-center justify-end gap-2">
                      {(() => {
                        // Kalemde montaj varsa düzenleme, yoksa doğrudan ekleme akışı açılır.
                        const hasMontaj = Number(l.installationCount ?? 0) > 0
                        return (
                          <button
                            type="button"
                            onClick={() => openMontage(invoice, l)}
                            className={`text-[11px] font-semibold ${hasMontaj ? 'text-blue-600 hover:text-blue-700' : 'text-emerald-600 hover:text-emerald-700'}`}
                            title={hasMontaj ? `Bu kalemde ${l.installationCount} montaj kaydı var` : 'Bu kalem için montaj kaydı oluştur'}
                          >
                            {hasMontaj ? 'Montaj Düzenle' : 'Montaj Ekle'}
                          </button>
                        )
                      })()}
                      {/*
                        KALEM SİLME KALDIRILDI (2026-08-26 · kullanıcı kararı).

                        Kesilmiş fatura bir BELGEDİR: yarısı oyulmaz, ya tümü durur ya tümü
                        silinir. Yanlış kalem varsa fatura tümüyle silinip yeniden kesilir —
                        basımdan ÖNCE kontrol edilir.

                        Neden: bu düğmeyle yapılan 4 silmenin 4'ü de cari ekstreyi bozdu.
                        İkisi öksüz borç bıraktı (3.100 TL), biri fazla borç (8.480 TL).
                        Ayrıca tam silme `DeletionLogs`'a faturanın TAMAMINI yazıyor
                        (kalemler + cari hareketleri + ödemeler); kalem silme yalnız o kalemi.
                      */}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function InvoiceListPage() {
  const { isSuperAdmin, allowedKeys } = useOutletContext<LayoutContext>()
  const navigate = useNavigate()

  const handlePrintInvoiceBarcodes = async (invoice: any) => {
    try {
      setLoading(true)

      // Drawn on the server: the module width has to be exact for a scanner to read the symbol,
      // and the previous version handed 13-digit article numbers to JsBarcode as CODE128
      // whenever the product record did not say EAN13.
      const { blob, skipped } = await fetchInvoiceBarcodePdf(Number(invoice.id))
      const url = URL.createObjectURL(blob)

      const w = window.open(url, '_blank')
      if (!w) {
        URL.revokeObjectURL(url)
        showMessage('Uyarı', 'Pop-up engelleyiciyi devre dışı bırakın.')
        return
      }

      if (skipped > 0) {
        showMessage(
          'Uyarı',
          `${skipped} kalem barkodu geçersiz olduğu için atlandı. Ürün kartındaki barkod numarasını kontrol edin.`
        )
      }

      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err: any) {
      showMessage('Hata', err?.message || 'Barkod dökümü alınamadı')
    } finally {
      setLoading(false)
    }
  }

  const handlePrintInvoice = async (invoice: InvoiceListItem) => {
    try {
      setLoading(true);
      setError(null);

      // Rendered on the server onto the pre-printed form's coordinates. The previous version
      // built an HTML page here and let the browser print it, which produced a nicely framed
      // invoice — and the frame, the headings and the column captions are already on the paper.
      const blob = await fetchInvoicePrintPdf(Number(invoice.id));
      const url = URL.createObjectURL(blob);

      const w = window.open(url, '_blank');
      if (!w) {
        URL.revokeObjectURL(url);
        showMessage('Uyarı', 'Pop-up engelleyiciyi devre dışı bırakın.');
        return;
      }

      // Released once the tab has had time to load it; revoking immediately can race the open.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      showMessage('Hata', err?.message || 'Basım işlemi sırasında hata oluştu.');
    } finally {
      setLoading(false);
    }
  };

  const canUpdateHeader =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/faturaDokum')) && Boolean(allowedKeys?.has('invoice/faturaDokumUstBilgiGuncelle')))

  const canOdemeAlindi =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/faturaDokum')) && Boolean(allowedKeys?.has('invoice/faturaDokumOdemeAlindi')))

  const canNakitMiktar =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/faturaDokum')) && Boolean(allowedKeys?.has('invoice/faturaDokumNakitMiktar')))

  const canBarkod =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/faturaDokum')) && Boolean(allowedKeys?.has('invoice/faturaDokumBarkod')))

  const canBasim =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/faturaDokum')) && Boolean(allowedKeys?.has('invoice/faturaDokumBasim')))

  const canSil =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/faturaDokum')) && Boolean(allowedKeys?.has('invoice/faturaDokumSil')))

  const [headerEditOpen, setHeaderEditOpen] = useState(false)

  /**
   * BAŞLIK DÜZENLEME LİSTELERİ SAYFA AÇILIŞINDA İNMEZ (2026-08-22 kullanıcı bildirimi).
   *
   * Cari, tedarikçi ve hizmet listeleri `useEffect(..., [])` ile sayfa açılır açılmaz ve
   * SINIRSIZ olarak çekiliyordu — üç ayrı istek, binlerce satır. Üçü de yalnızca fatura
   * başlığı düzenleme modalının açılır listelerinde kullanılıyor; modalı hiç açmayan
   * kullanıcı da bu bedeli ödüyordu ve Fatura Dökümü çok geç açılıyordu.
   *
   * Artık modal ilk kez açıldığında çekiliyorlar. Ref'ler tekrar çekmeyi engelliyor:
   * modal her açıldığında yeniden inmesinler.
   */
  const headerListsLoadedRef = useRef({ customers: false, suppliers: false, services: false })
  const [headerEditBusy, setHeaderEditBusy] = useState(false)
  const [headerEditInvoiceId, setHeaderEditInvoiceId] = useState<string | null>(null)
  const [headerEditIslemTipi, setHeaderEditIslemTipi] = useState('')
  const [headerEditPrevInvoiceType, setHeaderEditPrevInvoiceType] = useState('')
  const [headerEditSerie, setHeaderEditSerie] = useState('A')
  const [headerEditNumber, setHeaderEditNumber] = useState('')
  const [priceGroupsLoading, setPriceGroupsLoading] = useState(false)
  const [priceGroups, setPriceGroups] = useState<PriceGroupDto[]>([])
  const [headerEditForm, setHeaderEditForm] = useState({
    invoiceNo: '',
    customerCode: '',
    invoiceType: '',
    priceGroupId: '',
    // Belgenin dovizi ve DONMUS kuru: ikisi de forma yaziliyor ve okunuyordu, yalnizca
    // baslangic tipinde yer almadigi icin tip denetimi disinda kalmislardi.
    currencyTypeId: 0,
    exchangeRate: '1',
    // Fatura tarihi (yyyy-MM-dd). Ilk aciliste faturanin mevcut tarihiyle dolu gelir;
    // yalniz satis/acik satis faturasinda duzenlenebilir.
    date: ''
  })
  const [customersLoading, setCustomersLoading] = useState(false)
  const [customers, setCustomers] = useState<CustomerDto[]>([])
  const [selectedHeaderCustomer, setSelectedHeaderCustomer] = useState<CustomerDto | null>(null)

  useEffect(() => {
    const code = String(headerEditForm.customerCode ?? '').trim()
    if (!code) {
      setSelectedHeaderCustomer(null)
      return
    }

    const found = (customers ?? []).find((c) => c.customerCode === code)
    if (found) {
      setSelectedHeaderCustomer(found)
      return
    }

    const ac = new AbortController()
    void (async () => {
      try {
        const detail = await fetchCustomerByCode(code, { signal: ac.signal })
        setSelectedHeaderCustomer(detail)
      } catch {
        setSelectedHeaderCustomer(null)
      }
    })()

    return () => ac.abort()
  }, [customers, headerEditForm.customerCode])

  const [suppliersLoading, setSuppliersLoading] = useState(false)
  const [suppliers, setSuppliers] = useState<SupplierDto[]>([])
  const [servicesLoading, setServicesLoading] = useState(false)
  const [services, setServices] = useState<ServiceCatalogItemDto[]>([])

  const [fromDate, setFromDate] = useState(() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })
  const [toDate, setToDate] = useState(() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const reload = () => setRefreshKey((k) => k + 1)

  const invoiceList = useInvoiceList({
    fromDate,
    toDate,
    refreshKey
  })

  const [msgOpen, setMsgOpen] = useState(false)
  const [msgTitle, setMsgTitle] = useState('')
  const [msgText, setMsgText] = useState('')
  const [previewItem, setPreviewItem] = useState<InvoiceListItem | null>(null)
  const [invoiceDeleteLockDate, setInvoiceDeleteLockDate] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const token = localStorage.getItem('accessToken')
        const tenant = String(localStorage.getItem('tenantCode') ?? '').trim()
        const headers: Record<string, string> = {}
        if (token) headers.Authorization = `Bearer ${token}`
        if (tenant) headers['X-Tenant-Code'] = tenant

        const res = await fetch(`${API_BASE_URL}/api/SessionSettings`, { headers })
        if (res.ok) {
          const json = await res.json().catch(() => null)
          if (json?.data?.invoiceDeleteLockDate) {
            setInvoiceDeleteLockDate(String(json.data.invoiceDeleteLockDate).slice(0, 10))
          } else {
            setInvoiceDeleteLockDate(null)
          }
        }
      } catch {
        // ignore
      }
    })()
  }, [])

  const isInvoiceLocked = (r: InvoiceListItem) => {
    if (!invoiceDeleteLockDate) return false
    const lockIso = invoiceDeleteLockDate.slice(0, 10)
    const dt = r.tarihRaw || r.tarih || ''
    let invIso = ''
    if (dt.includes('.')) {
      const parts = dt.split('.')
      if (parts.length === 3) invIso = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
    } else if (dt.length >= 10) {
      invIso = dt.slice(0, 10)
    }
    if (!invIso) {
      const d = new Date(dt)
      if (!Number.isNaN(d.getTime())) invIso = d.toISOString().slice(0, 10)
    }
    return Boolean(invIso && lockIso && invIso < lockIso)
  }

  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [paymentModalBusy, setPaymentModalBusy] = useState(false)
  const [paymentModalInvoice, setPaymentModalInvoice] = useState<InvoiceListItem | null>(null)
  const [paymentModalMode, setPaymentModalMode] = useState<'detail' | 'markPaid' | 'markPaidCash'>('detail')
  const [paymentMode, setPaymentMode] = useState<'manual' | 'pay_now' | 'pay_with_change'>('manual')
  const [isPriceOverridden, setIsPriceOverridden] = useState(false)
  const [paymentSource, setPaymentSource] = useState<'cash' | 'bank' | 'pos'>('cash')
  const [isManualPayment, setIsManualPayment] = useState(false)
  const [cashAccounts, setCashAccounts] = useState<CashAccountDto[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccountDefinitionDto[]>([])
  const [selectedCashAccountId, setSelectedCashAccountId] = useState<string>('')
  const [selectedBankAccountDefinitionId, setSelectedBankAccountDefinitionId] = useState<string>('')
  const [selectedPosBankAccountDefinitionId, setSelectedPosBankAccountDefinitionId] = useState<string>('')

  const [cashReceivedAmount, setCashReceivedAmount] = useState('')
  const [changeSource, setChangeSource] = useState<'cash' | 'bank'>('cash')
  const [selectedChangeCashAccountId, setSelectedChangeCashAccountId] = useState<string>('')
  const [selectedChangeBankAccountDefinitionId, setSelectedChangeBankAccountDefinitionId] = useState<string>('')

  const [invoiceRateInput, setInvoiceRateInput] = useState('1')
  const [paymentRateInput, setPaymentRateInput] = useState('1')
  const [changeRateInput, setChangeRateInput] = useState('1')
  const [posFee, setPosFee] = useState('')

  const [paymentModalLines, setPaymentModalLines] = useState<any[]>([])
  const [paymentModalLinesLoading, setPaymentModalLinesLoading] = useState(false)

  const [changeAccountBalance, setChangeAccountBalance] = useState<number | null>(null)
  const [changeAccountBalanceLoading, setChangeAccountBalanceLoading] = useState(false)

  useEffect(() => {
    if (!paymentModalOpen) {
      setChangeAccountBalance(null)
      return
    }

    if (changeSource === 'cash') {
      const cashId = Number(selectedChangeCashAccountId)
      if (!(cashId > 0)) {
        setChangeAccountBalance(null)
        return
      }
      const acc = cashAccounts.find(c => Number(c.id) === cashId)
      setChangeAccountBalance(acc ? Number(acc.balance) : 0)
    } else if (changeSource === 'bank') {
      const bankId = Number(selectedChangeBankAccountDefinitionId)
      if (!(bankId > 0)) {
        setChangeAccountBalance(null)
        return
      }
      const ac = new AbortController()
      void (async () => {
        try {
          setChangeAccountBalanceLoading(true)
          const b = await fetchBankAccountBalance(bankId, { signal: ac.signal })
          setChangeAccountBalance(Number(b?.balance ?? 0))
        } catch {
          setChangeAccountBalance(null)
        } finally {
          setChangeAccountBalanceLoading(false)
        }
      })()
      return () => ac.abort()
    } else {
      setChangeAccountBalance(null)
    }
  }, [changeSource, selectedChangeCashAccountId, selectedChangeBankAccountDefinitionId, paymentModalOpen, cashAccounts])

  // Fetch lines for paymentModalInvoice to obtain original raw currency (e.g. 200 EUR)
  useEffect(() => {
    if (!paymentModalOpen || !paymentModalInvoice?.id) {
      setPaymentModalLines([])
      return
    }
    const token = localStorage.getItem('accessToken')
    const headers: Record<string, string> = {}
    if (token) headers.Authorization = `Bearer ${token}`
    setPaymentModalLinesLoading(true)
    fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(String(paymentModalInvoice.id))}/lines`, { headers })
      .then(res => res.json())
      .then(json => {
        if (json?.data && Array.isArray(json.data)) {
          setPaymentModalLines(json.data.map(normalizeInvoiceLineDto))
        } else {
          setPaymentModalLines([])
        }
      })
      .catch(() => setPaymentModalLines([]))
      .finally(() => setPaymentModalLinesLoading(false))
  }, [paymentModalOpen, paymentModalInvoice?.id])

  const fxTotals = useMemo(() => {
    return computeSingleCurrencySummary(paymentModalLines)
  }, [paymentModalLines])

  const invoiceCurrencyTypeId = useMemo(() => Number(fxTotals?.currencyTypeId ?? 0), [fxTotals?.currencyTypeId])
  const invoiceCurrencyCode = useMemo(() => currencyCodeByTypeId(invoiceCurrencyTypeId), [invoiceCurrencyTypeId])
  const invoiceCurrencyGrandTotal = useMemo(
    () => (fxTotals ? Number(fxTotals.grandTotal ?? 0) : Number(paymentModalInvoice?.genelToplam ?? 0)),
    [fxTotals, paymentModalInvoice?.genelToplam]
  )

  const accountCurrencyCode = useMemo(() => {
    let acc: any = null
    if (paymentSource === 'cash') {
      acc = cashAccounts.find(c => String(c.id) === String(selectedCashAccountId))
    } else if (paymentSource === 'bank') {
      acc = bankAccounts.find(b => String(b.id) === String(selectedBankAccountDefinitionId))
    } else if (paymentSource === 'pos') {
      acc = bankAccounts.find(b => String(b.id) === String(selectedPosBankAccountDefinitionId))
    }
    return (getAccountCurrencyCode(acc) || 'TRY').toUpperCase()
  }, [paymentSource, selectedCashAccountId, selectedBankAccountDefinitionId, selectedPosBankAccountDefinitionId, cashAccounts, bankAccounts])

  const requiredPaymentAmount = useMemo(() => {
    const entryCode = accountCurrencyCode
    const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()
    const rateVal = Number(String(paymentRateInput).replace(',', '.')) || 1
    if (fromCode === entryCode) {
      return invoiceCurrencyGrandTotal
    } else if (fromCode === 'TRY' && entryCode !== 'TRY') {
      return rateVal > 0 ? invoiceCurrencyGrandTotal / rateVal : 0
    } else if (fromCode !== 'TRY' && entryCode === 'TRY') {
      return invoiceCurrencyGrandTotal * rateVal
    } else {
      return invoiceCurrencyGrandTotal * rateVal
    }
  }, [invoiceCurrencyCode, accountCurrencyCode, paymentRateInput, invoiceCurrencyGrandTotal])

  const parsedCashReceived = useMemo(() => Number(String(cashReceivedAmount ?? '').replace(',', '.')) || 0, [cashReceivedAmount])

  const parsedCashReceivedInInvoiceCurrency = useMemo(() => {
    const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()
    const entryCode = accountCurrencyCode
    const rateVal = Number(String(paymentRateInput).replace(',', '.')) || 1
    let val = 0
    if (fromCode === entryCode) {
      val = parsedCashReceived
    } else if (fromCode === 'TRY' && entryCode !== 'TRY') {
      val = parsedCashReceived * rateVal
    } else if (fromCode !== 'TRY' && entryCode === 'TRY') {
      // rateVal = 1 fatura parası kaç TL
      val = rateVal > 0 ? parsedCashReceived / rateVal : 0
    } else {
      // ÇAPRAZ KUR: rateVal = 1 fatura parası kaç hesap parası. Geri dönüşte BÖLÜNÜR;
      // burada çarpılıyordu ve dövizden dövize tahsilat yanlış hesaplanıyordu.
      val = rateVal > 0 ? parsedCashReceived / rateVal : 0
    }
    return Math.round(val * 100) / 100
  }, [invoiceCurrencyCode, accountCurrencyCode, paymentRateInput, parsedCashReceived])

  const changeAmount = useMemo(() => {
    const diff = parsedCashReceivedInInvoiceCurrency - invoiceCurrencyGrandTotal
    return diff > 1.00 ? diff : 0
  }, [parsedCashReceivedInInvoiceCurrency, invoiceCurrencyGrandTotal])

  const missingAmount = useMemo(() => {
    const diff = invoiceCurrencyGrandTotal - parsedCashReceivedInInvoiceCurrency
    return diff > 0 ? diff : 0
  }, [parsedCashReceivedInInvoiceCurrency, invoiceCurrencyGrandTotal])

  useEffect(() => {
    if (!isPriceOverridden && requiredPaymentAmount > 0) {
      setCashReceivedAmount(String(Number(requiredPaymentAmount.toFixed(2))))
    }
  }, [requiredPaymentAmount, isPriceOverridden])

  // Auto-fetch invoice currency rate
  useEffect(() => {
    if (!paymentModalOpen) return
    if (!invoiceCurrencyCode || invoiceCurrencyCode === 'TRY') {
      setInvoiceRateInput('1')
      return
    }
    const firstLineRate = Number(paymentModalLines[0]?.currencyRate ?? 0)
    if (firstLineRate > 0) {
      setInvoiceRateInput(String(firstLineRate))
      return
    }
    void (async () => {
      try {
        const r = await fetchLatestFxRate(invoiceCurrencyCode)
        setInvoiceRateInput(String(r))
      } catch {
        setInvoiceRateInput('1')
      }
    })()
  }, [invoiceCurrencyCode, paymentModalOpen, paymentModalLines])

  /**
   * TAHSİLAT HESABI FATURANIN PARASINA GÖRE KENDİLİĞİNDEN SEÇİLİR (2026-08-19 kullanıcı kararı).
   *
   * Satış faturası ekranındaki kuralın aynısı: fatura EUR ise EUR hesabı, USD ise USD, TL ise
   * TL hesabı gelir. Seçim yöntem + para birimi çifti başına BİR KEZ yapılır; kullanıcı
   * sonradan elle başka hesap seçerse üstüne yazılmaz. Aynı paradan hesap yoksa dokunulmaz.
   */
  const autoPaymentAccountKeyRef = useRef<string>('')
  useEffect(() => {
    if (!paymentModalOpen) {
      autoPaymentAccountKeyRef.current = ''
      return
    }
    const want = (invoiceCurrencyCode || 'TRY').toUpperCase()
    const key = `${paymentSource}|${want}`
    if (autoPaymentAccountKeyRef.current === key) return
    if (cashAccounts.length === 0 && bankAccounts.length === 0) return

    const currencyOf = (acc: any) => (getAccountCurrencyCode(acc) || 'TRY').toUpperCase()
    autoPaymentAccountKeyRef.current = key

    if (paymentSource === 'cash') {
      const match = cashAccounts.find((x) => currencyOf(x) === want)
      if (match) setSelectedCashAccountId(String(match.id))
      return
    }
    if (paymentSource === 'bank') {
      const match = bankAccounts.find((x) => currencyOf(x) === want)
      if (match) setSelectedBankAccountDefinitionId(String(match.id))
      return
    }
    if (paymentSource === 'pos') {
      const posAccounts = (bankAccounts ?? []).filter((b) => Number((b as any)?.accountType ?? 0) === 14)
      const match = posAccounts.find((x) => currencyOf(x) === want)
      if (match) setSelectedPosBankAccountDefinitionId(String(match.id))
    }
  }, [paymentModalOpen, paymentSource, invoiceCurrencyCode, cashAccounts, bankAccounts])

  // Auto-fetch payment account rate (cross-rate with invoice currency)
  useEffect(() => {
    if (!paymentModalOpen) return
    let acc: any = null
    if (paymentSource === 'cash') {
      acc = cashAccounts.find(c => String(c.id) === String(selectedCashAccountId))
    } else if (paymentSource === 'bank') {
      acc = bankAccounts.find(b => String(b.id) === String(selectedBankAccountDefinitionId))
    } else if (paymentSource === 'pos') {
      acc = bankAccounts.find(b => String(b.id) === String(selectedPosBankAccountDefinitionId))
    }
    const toCode = (getAccountCurrencyCode(acc) || 'TRY').toUpperCase()
    const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()

    if (!toCode || fromCode === toCode) {
      setPaymentRateInput('1')
      return
    }

    if (fromCode === 'TRY' && toCode !== 'TRY') {
      void (async () => {
        try {
          const r = await fetchLatestFxRate(toCode)
          setPaymentRateInput(String(r))
        } catch {
          setPaymentRateInput('1')
        }
      })()
      return
    }

    if (fromCode !== 'TRY' && toCode === 'TRY') {
      void (async () => {
        try {
          const r = await fetchLatestFxRate(fromCode)
          setPaymentRateInput(String(r))
        } catch {
          setPaymentRateInput('1')
        }
      })()
      return
    }

    if (fromCode !== 'TRY' && toCode !== 'TRY' && fromCode !== toCode) {
      void (async () => {
        try {
          const [fromRate, toRate] = await Promise.all([
            fetchLatestFxRate(fromCode),
            fetchLatestFxRate(toCode)
          ])
          const cross = fromRate > 0 && toRate > 0 ? fromRate / toRate : 1
          setPaymentRateInput(String(Number(cross.toFixed(4))))
        } catch {
          setPaymentRateInput('1')
        }
      })()
    }
  }, [paymentSource, selectedCashAccountId, selectedBankAccountDefinitionId, selectedPosBankAccountDefinitionId, paymentModalOpen, cashAccounts, bankAccounts, invoiceCurrencyCode])

  // Auto-fetch change account rate (cross-rate with invoice currency)
  useEffect(() => {
    if (!paymentModalOpen) return
    let acc: any = null
    if (changeSource === 'cash') {
      acc = cashAccounts.find(c => String(c.id) === String(selectedChangeCashAccountId))
    } else if (changeSource === 'bank') {
      acc = bankAccounts.find(b => String(b.id) === String(selectedChangeBankAccountDefinitionId))
    }
    const toCode = (getAccountCurrencyCode(acc) || 'TRY').toUpperCase()
    const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()

    if (!toCode || fromCode === toCode) {
      setChangeRateInput('1')
      return
    }

    if (fromCode === 'TRY' && toCode !== 'TRY') {
      void (async () => {
        try {
          const r = await fetchLatestFxRate(toCode)
          setChangeRateInput(String(r))
        } catch {
          setChangeRateInput('1')
        }
      })()
      return
    }

    if (fromCode !== 'TRY' && toCode === 'TRY') {
      void (async () => {
        try {
          const r = await fetchLatestFxRate(fromCode)
          setChangeRateInput(String(r))
        } catch {
          setChangeRateInput('1')
        }
      })()
      return
    }

    if (fromCode !== 'TRY' && toCode !== 'TRY' && fromCode !== toCode) {
      void (async () => {
        try {
          const [fromRate, toRate] = await Promise.all([
            fetchLatestFxRate(fromCode),
            fetchLatestFxRate(toCode)
          ])
          const cross = fromRate > 0 && toRate > 0 ? fromRate / toRate : 1
          setChangeRateInput(String(Number(cross.toFixed(4))))
        } catch {
          setChangeRateInput('1')
        }
      })()
    }
  }, [changeSource, selectedChangeCashAccountId, selectedChangeBankAccountDefinitionId, paymentModalOpen, cashAccounts, bankAccounts, invoiceCurrencyCode])

  const [fxOpen, setFxOpen] = useState(false)
  const [fxBusy, setFxBusy] = useState(false)
  const [fxCurrencyCode, setFxCurrencyCode] = useState('')
  const [fxFromCurrencyCode, setFxFromCurrencyCode] = useState('')
  const [fxFromAmount, setFxFromAmount] = useState(0)
  const [fxFromTryRate, setFxFromTryRate] = useState(1)
  const [fxRateLabel, setFxRateLabel] = useState('')
  const [fxRate, setFxRate] = useState('')
  const [fxInvoiceTryAmount, setFxInvoiceTryAmount] = useState(0)
  const [fxInvoiceBrut, setFxInvoiceBrut] = useState(0)
  const [fxInvoiceKdv, setFxInvoiceKdv] = useState(0)
  const [fxConfirmAction, setFxConfirmAction] = useState<null | ((rate: number) => Promise<void>)>(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTitle, setConfirmTitle] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmAction, setConfirmAction] = useState<null | (() => Promise<void>)>(null)
  const [confirmOkText, setConfirmOkText] = useState('Sil')
  const [confirmCancelText, setConfirmCancelText] = useState('Vazgeç')
  const [confirmOkColor, setConfirmOkColor] = useState<'red' | 'green'>('red')
  const [confirmCancelColor, setConfirmCancelColor] = useState<'gray' | 'red'>('gray')

  useEffect(() => {
    if (!headerEditOpen || headerListsLoadedRef.current.customers) return
    headerListsLoadedRef.current.customers = true
    const ac = new AbortController()
    void (async () => {
      try {
        setCustomersLoading(true)
        const list = await fetchCustomersDropdown({ includeInactive: false, includeMuhtelif: false, signal: ac.signal })
        setCustomers(list ?? [])
      } catch {
        setCustomers([])
        headerListsLoadedRef.current.customers = false
      } finally {
        setCustomersLoading(false)
      }
    })()
    return () => ac.abort()
  }, [headerEditOpen])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const list = await fetchCashAccounts({ signal: ac.signal })
        setCashAccounts(list ?? [])
      } catch {
        setCashAccounts([])
      }
    })()
    return () => ac.abort()
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const list = await fetchBankAccountDefinitions({ signal: ac.signal })
        setBankAccounts(list ?? [])
      } catch {
        setBankAccounts([])
      }
    })()
    return () => ac.abort()
  }, [])

  const cashAccountOptions = useMemo(() => {
    return (cashAccounts ?? []).map((c) => ({ value: String(c.id), label: `${c.code}${c.name ? ` - ${c.name}` : ''}` }))
  }, [cashAccounts])

  const bankAccountOptions = useMemo(() => {
    return (bankAccounts ?? []).map((b) => ({ value: String(b.id), label: `${b.accountCode}${b.accountName ? ` - ${b.accountName}` : ''}` }))
  }, [bankAccounts])

  const posAccountOptions = useMemo(() => {
    return (bankAccounts ?? [])
      .filter((b) => Number((b as any)?.accountType ?? 0) === 14)
      .map((b) => ({ value: String(b.id), label: `${b.accountCode}${b.accountName ? ` - ${b.accountName}` : ''}` }))
  }, [bankAccounts])

  const changeCurrency = useMemo(() => {
    let code = invoiceCurrencyCode
    if (changeSource === 'cash') {
      const acc = cashAccounts.find(c => String(c.id) === String(selectedChangeCashAccountId))
      if (acc) code = currencyCodeByTypeId(acc.currencyTypeId)
    } else if (changeSource === 'bank') {
      const acc = bankAccounts.find(b => String(b.id) === String(selectedChangeBankAccountDefinitionId))
      if (acc) code = currencyCodeByTypeId(acc.currencyTypeId)
    }
    return (code || 'TRY').toUpperCase()
  }, [changeSource, selectedChangeCashAccountId, selectedChangeBankAccountDefinitionId, cashAccounts, bankAccounts, invoiceCurrencyCode])

  const changeAmountVal = useMemo(() => {
    if (changeAmount <= 0) return 0

    const invoiceRateVal = Number(String(invoiceRateInput).replace(',', '.')) || 1
    const changeRateVal = Number(String(changeRateInput).replace(',', '.')) || 1

    const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()
    const toCode = changeCurrency

    if (fromCode === toCode) {
      return changeAmount
    } else if (fromCode === 'TRY' && toCode !== 'TRY') {
      return changeRateVal > 0 ? changeAmount / changeRateVal : 0
    } else if (fromCode !== 'TRY' && toCode === 'TRY') {
      return changeAmount * invoiceRateVal
    } else {
      return changeAmount * changeRateVal
    }
  }, [changeAmount, invoiceCurrencyCode, changeCurrency, invoiceRateInput, changeRateInput])

  const openPaymentDetail = (row: InvoiceListItem) => {
    setPaymentModalInvoice(row)
    setPaymentModalMode('detail')
    setPaymentModalOpen(true)
  }

  const openPaymentModal = (row: InvoiceListItem) => {
    setPaymentModalInvoice(row)
    setPaymentSource('cash')
    setIsManualPayment(false)
    setIsPriceOverridden(false)
    setSelectedCashAccountId('')
    setSelectedBankAccountDefinitionId('')
    setSelectedPosBankAccountDefinitionId('')
    setCashReceivedAmount('')
    setChangeSource('cash')
    setSelectedChangeCashAccountId('')
    setSelectedChangeBankAccountDefinitionId('')
    setPosFee('')

    if (row.odemeAlindi) {
      setPaymentModalMode('detail')
    } else {
      setPaymentModalMode('markPaid')
      setPaymentMode('manual')
    }
    setPaymentModalOpen(true)
  }


  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        setPriceGroupsLoading(true)
        const list = await fetchPriceGroups({ includeInactive: false })
        setPriceGroups(list ?? [])
      } catch {
        setPriceGroups([])
      } finally {
        setPriceGroupsLoading(false)
      }
    })()
    return () => ac.abort()
  }, [])

  const normalizedInvoiceType = useMemo(() => {
    const t = String(headerEditForm.invoiceType ?? '').trim().toLocaleUpperCase('tr-TR')
    if (!t) return ''
    if (t === 'AÇIK' || t === 'ACIK') return 'ACIK'
    if (t === 'FATURA') return 'FATURA'
    return t
  }, [headerEditForm.invoiceType])

  const normalizedPrevInvoiceType = useMemo(() => {
    const t = String(headerEditPrevInvoiceType ?? '').trim().toLocaleUpperCase('tr-TR')
    if (!t) return ''
    if (t === 'AÇIK' || t === 'ACIK') return 'ACIK'
    if (t === 'FATURA') return 'FATURA'
    return t
  }, [headerEditPrevInvoiceType])

  const isAcikToFatura = useMemo(() => {
    return normalizedPrevInvoiceType === 'ACIK' && normalizedInvoiceType === 'FATURA'
  }, [normalizedPrevInvoiceType, normalizedInvoiceType])

  /*
    Fatura tarihi YALNIZ satis / acik satis faturasinda duzenlenir. Alis / hizmet / iade
    faturasinda tedarikci ekstresi senkronu bu ucta olmadigi icin sunucu da yok sayar;
    alani hic gostermiyoruz. `islemTipi` satis ve acikta ayni deger ('SATIŞ').
  */
  const canEditHeaderDate = useMemo(() => {
    const t = String(headerEditIslemTipi).trim().toLocaleUpperCase('tr-TR')
    return t === 'SATIŞ' || t === 'SATIS'
  }, [headerEditIslemTipi])

  const invoiceTypeOptions = useMemo(() => {
    // Two-state toggle: only show the opposite value as selectable.
    // Keep current value in the list so select can render it.
    if (!normalizedInvoiceType) {
      return [
        { value: '', label: 'Seçiniz...' },
        { value: 'ACIK', label: 'ACIK' },
        { value: 'FATURA', label: 'FATURA' }
      ]
    }

    if (normalizedPrevInvoiceType === 'FATURA') {
      return [{ value: 'FATURA', label: 'FATURA' }]
    }

    if (normalizedInvoiceType === 'FATURA') {
      return [
        { value: 'FATURA', label: 'FATURA' },
        { value: 'ACIK', label: 'ACIK' }
      ]
    }

    if (normalizedInvoiceType === 'ACIK') {
      return [
        { value: 'ACIK', label: 'ACIK' },
        { value: 'FATURA', label: 'FATURA' }
      ]
    }

    // Fallback: if a legacy/unknown value is present, allow switching to ACIK or FATURA.
    return [
      { value: normalizedInvoiceType, label: normalizedInvoiceType },
      { value: 'ACIK', label: 'ACIK' },
      { value: 'FATURA', label: 'FATURA' }
    ]
  }, [normalizedInvoiceType])

  useEffect(() => {
    if (!headerEditOpen || headerListsLoadedRef.current.suppliers) return
    headerListsLoadedRef.current.suppliers = true
    const ac = new AbortController()
    void (async () => {
      try {
        setSuppliersLoading(true)
        const list = await fetchSuppliers({ includeCustomers: true, signal: ac.signal })
        setSuppliers(list ?? [])
      } catch {
        setSuppliers([])
        headerListsLoadedRef.current.suppliers = false
      } finally {
        setSuppliersLoading(false)
      }
    })()
    return () => ac.abort()
  }, [headerEditOpen])

  useEffect(() => {
    if (!headerEditOpen || headerListsLoadedRef.current.services) return
    headerListsLoadedRef.current.services = true
    const ac = new AbortController()
    void (async () => {
      try {
        setServicesLoading(true)
        const list = await fetchServiceCatalog({ includeInactive: false, signal: ac.signal })
        setServices(list ?? [])
      } catch {
        setServices([])
        headerListsLoadedRef.current.services = false
      } finally {
        setServicesLoading(false)
      }
    })()
    return () => ac.abort()
  }, [headerEditOpen])

  const parseInvoiceNoString = (rawNo: string) => {
    const s = String(rawNo ?? '').trim()
    if (!s) return { serie: 'A', number: '' }
    const match = s.match(/^([A-Za-z]+)0*(\d*)$/)
    if (match) {
      return {
        serie: (match[1] || 'A').toUpperCase(),
        number: match[2] || ''
      }
    }
    const matchFallback = s.match(/^([A-Za-z0-9]*?)0*(\d+)$/)
    if (matchFallback && matchFallback[2]) {
      return {
        serie: (matchFallback[1] || 'A').toUpperCase(),
        number: matchFallback[2]
      }
    }
    const first = s.charAt(0).toUpperCase()
    const rest = s.slice(1).replace(/^0+/, '').replace(/[^0-9]/g, '')
    return { serie: first || 'A', number: rest }
  }

  const computedHeaderInvoiceNo = useMemo(() => {
    const s = (headerEditSerie || '').trim().toUpperCase()
    const n = (headerEditNumber || '').trim().replace(/[^0-9]/g, '')
    if (!n && !s) return ''
    if (!n) return s
    const padLength = Math.max(0, 15 - s.length)
    return s + n.padStart(padLength, '0')
  }, [headerEditSerie, headerEditNumber])



  // Determine selected customer's open price group code
  const selectedCustomerPriceGroupCode = useMemo(() => {
    if (!selectedHeaderCustomer) return 4
    if (selectedHeaderCustomer.priceGroupId) {
      const pgObj = priceGroups.find((x) => String(x.id) === String(selectedHeaderCustomer.priceGroupId))
      if (pgObj) return Number(pgObj.code)
    }
    return 4
  }, [selectedHeaderCustomer, priceGroups])

  // Target Fatura price group code (4->1, 5->2, 6->3, 1->1, 2->2, 3->3)
  const targetFaturaPriceGroupCode = useMemo(() => {
    const code = selectedCustomerPriceGroupCode
    if (code === 4) return 1
    if (code === 5) return 2
    if (code === 6) return 3
    if (code === 1 || code === 2 || code === 3) return code
    return 1
  }, [selectedCustomerPriceGroupCode])

  // Filter priceGroups list so ONLY the single matching target price group is displayed in the modal dropdown
  const filteredFaturaPriceGroups = useMemo(() => {
    const targetCode = targetFaturaPriceGroupCode
    const matched = priceGroups.filter(
      (x) => Number(x.code) === targetCode && String(x.invoiceType ?? '').trim().toUpperCase() === 'FATURA'
    )
    if (matched.length > 0) return matched
    return priceGroups.filter((x) => Number(x.code) === targetCode)
  }, [priceGroups, targetFaturaPriceGroupCode])

  // Auto-sync headerEditForm.priceGroupId to filteredFaturaPriceGroups[0].id
  useEffect(() => {
    if (filteredFaturaPriceGroups.length > 0) {
      const targetId = String(filteredFaturaPriceGroups[0].id)
      if (headerEditForm.priceGroupId !== targetId) {
        setHeaderEditForm((p) => ({ ...p, priceGroupId: targetId }))
      }
    }
  }, [filteredFaturaPriceGroups, headerEditForm.priceGroupId])

  const openHeaderEdit = (row: InvoiceListItem) => {
    setHeaderEditInvoiceId(String(row.id))
    setHeaderEditIslemTipi(String((row as any).islemTipi ?? ''))
    setHeaderEditPrevInvoiceType(String((row as any).faturaAcik ?? ''))

    const parsedNo = parseInvoiceNoString(String(row.faturaNo ?? ''))
    setHeaderEditSerie(parsedNo.serie)
    setHeaderEditNumber(parsedNo.number)

    const initialCariCode = String(
      (row as any).cariKodu ||
      (row as any).customerCode ||
      (row as any).deliveryCustomerCode ||
      ''
    ).trim()

    const curTypeId = Number((row as any).paraBirimiTipi ?? (row as any).currencyTypeId ?? 0)
    const initialKur = Number((row as any).kur ?? (row as any).exchangeRate ?? 1) || 1
    const initialPgId = String((row as any).priceGroupId ?? '').trim()

    // Fatura tarihini yyyy-MM-dd'ye cevir (input[type=date] icin). `tarihRaw` ISO string.
    let initialDate = ''
    const rawDate = String((row as any).tarihRaw ?? '').trim()
    if (rawDate) {
      const d = new Date(rawDate)
      if (!Number.isNaN(d.getTime())) {
        initialDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }
    }

    setHeaderEditForm({
      invoiceNo: String(row.faturaNo ?? ''),
      customerCode: initialCariCode,
      invoiceType: String(row.faturaAcik ?? ''),
      priceGroupId: initialPgId,
      currencyTypeId: curTypeId,
      exchangeRate: initialKur > 0 ? String(initialKur) : '1',
      date: initialDate
    })
    setHeaderEditOpen(true)

    const invoiceId = Number(row.id)
    if (Number.isFinite(invoiceId) && invoiceId > 0) {
      void (async () => {
        try {
          const h = await fetchInvoiceHeader(invoiceId)
          setHeaderEditPrevInvoiceType(String(h.faturaAcik ?? '').trim() || String((row as any).faturaAcik ?? ''))
          setHeaderEditForm((p) => ({
            ...p,
            customerCode: String(h.cariKodu ?? '').trim() || p.customerCode || initialCariCode,
            invoiceType: String(h.faturaAcik ?? '').trim() || p.invoiceType,
            currencyTypeId: h.currencyTypeId !== undefined && h.currencyTypeId !== null ? Number(h.currencyTypeId) : p.currencyTypeId,
            exchangeRate: h.exchangeRate !== undefined && h.exchangeRate !== null && Number(h.exchangeRate) > 0 ? String(h.exchangeRate) : p.exchangeRate
          }))
        } catch {
          // ignore
        }
      })()
    }
  }

  const submitHeaderEdit = async () => {
    const idStr = String(headerEditInvoiceId ?? '')
    const idNum = Number(idStr)
    if (!Number.isFinite(idNum) || idNum <= 0) return

    try {
      setHeaderEditBusy(true)
      setError(null)

      const finalInvoiceNo = computedHeaderInvoiceNo

      if (isAcikToFatura && !String(headerEditForm.priceGroupId ?? '').trim()) {
        setError('FATURA tipine geçiş için fiyat grubu seçilmelidir')
        return
      }
      await updateInvoiceHeader(idNum, {
        invoiceNo: finalInvoiceNo || undefined,
        customerCode: headerEditForm.customerCode.trim() || undefined,
        customerInvoiceTypeOverride: headerEditForm.invoiceType.trim() || undefined,
        priceGroupId: isAcikToFatura ? String(headerEditForm.priceGroupId).trim() : undefined,
        exchangeRate: Number(String(headerEditForm.exchangeRate).replace(',', '.')) || undefined,
        date: canEditHeaderDate && headerEditForm.date ? headerEditForm.date : undefined
      })

      setHeaderEditOpen(false)
      setHeaderEditInvoiceId(null)
      await reload()
    } catch (e: any) {
      setError(String(e?.message ?? 'Üst bilgi güncellenemedi'))
    } finally {
      setHeaderEditBusy(false)
    }
  }

  const showMessage = (title: string, text: string) => {
    setMsgTitle(String(title ?? ''))
    setMsgText(String(text ?? ''))
    setMsgOpen(true)
  }

  /**
   * Fatura ekranından gelen BASIM UYARISI burada gösterilir (2026-08-22).
   *
   * Fatura kaydedilince basım yeni sekmede açılıyor ve bu sekme buraya geçiyor. Basım
   * açılamadıysa uyarıyı fatura ekranında göstermenin anlamı yoktu — orası zaten
   * kapanıyor — bu yüzden yönlendirme durumuyla taşınıp burada gösteriliyor.
   *
   * Durum TEK SEFERLİK okunur: geri/ileri ya da yenilemede aynı uyarının tekrar çıkması
   * kullanıcıya olmayan bir hatayı ikinci kez bildirirdi.
   */
  const location = useLocation()
  React.useEffect(() => {
    const warning = String((location.state as any)?.printWarning ?? '').trim()
    if (!warning) return
    showMessage('Uyarı', warning)
    navigate(location.pathname, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  const requestConfirm = (
    title: string,
    text: string,
    action: () => Promise<void>,
    okText = 'Sil',
    cancelText = 'Vazgeç',
    okColor: 'red' | 'green' = 'red',
    cancelColor: 'gray' | 'red' = 'gray'
  ) => {
    setConfirmTitle(title)
    setConfirmText(text)
    setConfirmAction(() => action)
    setConfirmOkText(okText)
    setConfirmCancelText(cancelText)
    setConfirmOkColor(okColor)
    setConfirmCancelColor(cancelColor)
    setConfirmOpen(true)
  }

  const doSubmitManualPayment = async (inv: InvoiceListItem) => {
    setPaymentModalBusy(true)
    try {
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      const payload = {
        takePaymentNow: true,
        isManualPayment: true
      }

      const res = await fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(String(inv.id))}/mark-paid`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const text = await res.text()
        showMessage('Hata', text || 'Manuel ödeme kaydedilemedi')
        return
      }

      showMessage('Başarılı', 'Manuel ödeme kaydedildi')
      setPaymentModalOpen(false)
      setPaymentModalInvoice(null)
      await reload()
    } catch (e: any) {
      showMessage('Hata', String(e?.message ?? 'Manuel ödeme kaydedilemedi'))
    } finally {
      setPaymentModalBusy(false)
    }
  }

  const doSubmitManualPaymentRevert = async (inv: InvoiceListItem) => {
    setPaymentModalBusy(true)
    try {
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(String(inv.id))}/mark-unpaid`, {
        method: 'POST',
        headers
      })

      if (!res.ok) {
        const text = await res.text()
        showMessage('Hata', text || 'Ödeme iptal edilemedi')
        return
      }

      showMessage('Başarılı', 'Ödeme iptal edildi ve fatura ödenmedi durumuna getirildi')
      setPaymentModalOpen(false)
      setPaymentModalInvoice(null)
      await reload()
    } catch (e: any) {
      showMessage('Hata', String(e?.message ?? 'Ödeme iptal edilemedi'))
    } finally {
      setPaymentModalBusy(false)
    }
  }

  type MontageForm = {
    dealerName: string
    productName: string
    quantity: number
    installationName: string
    installationPhone: string
    address: string
    region: string
    dealerDescription: string
  }

  type InstallationRecord = {
    id: number
    lineageId?: string
    installationClientId?: string
    invoiceLineId?: number
    dealerCode?: string
    dealerName?: string
    productName?: string
    quantity: number
    installationName?: string
    installationPhone?: string
    address?: string
    region?: string
    dealerDescription?: string
    type?: string
    status?: string
    technician?: string
    plannedDateUtc?: string
    createUser?: string
    createTime?: string
  }

  const [montageOpen, setMontageOpen] = useState(false)
  const [montageInvoiceId, setMontageInvoiceId] = useState<string | null>(null)
  const [montageInvoiceLine, setMontageInvoiceLine] = useState<any>(null)
  const [montageInstallations, setMontageInstallations] = useState<InstallationRecord[]>([])
  const [montageLineQuantity, setMontageLineQuantity] = useState<number>(1)
  const [editingInstallationId, setEditingInstallationId] = useState<number | null>(null)
  const [isAddingNewMontage, setIsAddingNewMontage] = useState<boolean>(false)
  const [montageRefreshKey, setMontageRefreshKey] = useState(0)
  const [montageSaving, setMontageSaving] = useState(false)
  const [montageLoading, setMontageLoading] = useState(false)
  const [montageError, setMontageError] = useState<string | null>(null)
  
  // Cache for holding the last successfully saved installation info to prefill other lines of the same invoice or dealer.
  const lastMontageDataRef = useRef<{
    installationName: string
    installationPhone: string
    address: string
    region: string
    dealerDescription: string
    invoiceId: string | null
    dealerCode: string
  } | null>(null)

  const [montageForm, setMontageForm] = useState<MontageForm>({
    dealerName: '',
    productName: '',
    quantity: 1,
    installationName: '',
    installationPhone: '',
    address: '',
    region: '',
    dealerDescription: ''
  })

  /* CARİ EKSTRE MODALI — Fatura Dökümü'nde cari adına tıklayınca (2026-09-04).
     Görünüm ve veri okuma `components/CariEkstreModal` içinde; Alış Faturaları da aynısını kullanıyor. */
  const [ekstreOpen, setEkstreOpen] = useState(false)
  const [ekstreCari, setEkstreCari] = useState<{ kod: string; ad: string } | null>(null)

  const openCariEkstre = useCallback((kod: string, ad: string) => {
    setEkstreCari({ kod, ad })
    setEkstreOpen(true)
  }, [])

  const columns = useMemo(() => getInvoiceListColumns(openCariEkstre), [openCariEkstre])

  const fetchInstallationsForLine = async (lineId: number) => {
    try {
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(`${API_BASE_URL}/api/invoices/lines/${lineId}/installations`, { headers })
      if (!res.ok) return []
      const json = await res.json()
      return (json?.data ?? []) as InstallationRecord[]
    } catch {
      return []
    }
  }

  const openMontage = (invoice: any, line: any) => {
    const invoiceId = String(invoice?.id ?? '')
    const lineId = Number(line?.id ?? 0)
    if (!lineId) {
      showMessage('Hata', 'Fatura kalemi kimliği bulunamadı.')
      return
    }

    void (async () => {
      try {
        setMontageLoading(true)
        setMontageInvoiceId(invoiceId)
        
        let customerCode = ''
        if (invoice?.cariAdi) {
          const match = invoice.cariAdi.match(/^\[([^\]]+)\]/);
          if (match) customerCode = match[1].trim();
          else {
            const matchParen = invoice.cariAdi.match(/^\(([^)]+)\)/);
            if (matchParen) customerCode = matchParen[1].trim();
          }
        }
        
        const currentDealerCode = customerCode || invoice?.cariKodu || ''
        setMontageInvoiceLine({
          ...line,
          dealerName: currentDealerCode
        })
        setMontageError(null)
        setEditingInstallationId(null)
        setIsAddingNewMontage(false)

        const token = localStorage.getItem('accessToken')
        const headers: Record<string, string> = {}
        if (token) headers.Authorization = `Bearer ${token}`

        const res = await fetch(`${API_BASE_URL}/api/invoices/lines/${lineId}/installations`, { headers })
        if (!res.ok) {
          setMontageError('Montaj kayıtları alınamadı.')
          setMontageOpen(true)
          return
        }

        const json = await res.json()
        const installations: InstallationRecord[] = json?.data ?? []
        const lQty = Number(json?.lineQuantity ?? line?.quantity ?? 1)
        setMontageInstallations(installations)
        setMontageLineQuantity(lQty)

        if (installations.length === 0) {
          setIsAddingNewMontage(true)
          
          const cached = lastMontageDataRef.current
          const shouldPrefill = cached && (cached.invoiceId === invoiceId || cached.dealerCode === currentDealerCode)

          setMontageForm({
            dealerName: currentDealerCode,
            productName: String(line?.stockCode || line?.description || ''),
            quantity: lQty,
            installationName: shouldPrefill ? cached.installationName : '',
            installationPhone: shouldPrefill ? cached.installationPhone : '',
            address: shouldPrefill ? cached.address : '',
            region: shouldPrefill ? cached.region : '',
            dealerDescription: shouldPrefill ? cached.dealerDescription : ''
          })
        }

        setMontageOpen(true)
      } catch {
        showMessage('Hata', 'Montaj bilgisi alınamadı')
      } finally {
        setMontageLoading(false)
      }
    })()
  }

  const startEditMontage = (inst: InstallationRecord) => {
    setEditingInstallationId(inst.id)
    setIsAddingNewMontage(false)
    setMontageForm({
      dealerName: inst.dealerName || String(montageInvoiceLine?.dealerName || ''),
      productName: inst.productName || String(montageInvoiceLine?.stockCode || ''),
      quantity: inst.quantity,
      installationName: inst.installationName || '',
      installationPhone: inst.installationPhone || '',
      address: inst.address || '',
      region: inst.region || '',
      dealerDescription: inst.dealerDescription || ''
    })
    setMontageError(null)
  }

  const startAddNewMontage = () => {
    const totalPlanned = montageInstallations.reduce((sum, i) => sum + Number(i.quantity || 0), 0)
    const remaining = Math.max(1, montageLineQuantity - totalPlanned)
    setEditingInstallationId(null)
    setIsAddingNewMontage(true)

    const currentDealerCode = String(montageInvoiceLine?.dealerName || '')
    const cached = lastMontageDataRef.current
    const shouldPrefill = cached && (cached.invoiceId === montageInvoiceId || cached.dealerCode === currentDealerCode)

    setMontageForm({
      dealerName: currentDealerCode,
      productName: String(montageInvoiceLine?.stockCode || montageInvoiceLine?.description || ''),
      quantity: remaining,
      installationName: shouldPrefill ? cached.installationName : '',
      installationPhone: shouldPrefill ? cached.installationPhone : '',
      address: shouldPrefill ? cached.address : '',
      region: shouldPrefill ? cached.region : '',
      dealerDescription: shouldPrefill ? cached.dealerDescription : ''
    })
    setMontageError(null)
  }

  const saveMontage = async () => {
    if (!montageInvoiceLine?.id) return
    if (!montageForm.installationName.trim() || !montageForm.installationPhone.trim() || !montageForm.address.trim() || !montageForm.region.trim()) {
      setMontageError('Lütfen zorunlu alanları doldurun (İsim, Telefon, Adres, Bölge).')
      return
    }

    if (!PHONE_PATTERN.test(montageForm.installationPhone.trim())) {
      setMontageError(PHONE_FORMAT_MESSAGE)
      return
    }

    const otherQty = montageInstallations
      .filter((i) => !editingInstallationId || i.id !== editingInstallationId)
      .reduce((sum, i) => sum + Number(i.quantity || 0), 0)

    const newTotalQty = otherQty + Number(montageForm.quantity ?? 1)

    if (newTotalQty > montageLineQuantity) {
      setMontageError(`Toplam montaj adedi (${newTotalQty}), fatura kalemi miktarını (${montageLineQuantity}) aşamaz!`)
      return
    }

    try {
      setMontageSaving(true)
      setMontageError(null)
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`

      if (editingInstallationId) {
        const payload = {
          quantity: Number(montageForm.quantity ?? 1),
          customerName: montageForm.installationName,
          phone: montageForm.installationPhone,
          address: montageForm.address,
          region: montageForm.region,
          note: montageForm.dealerDescription,
          dealerName: montageForm.dealerName,
          productName: montageForm.productName
        }
        const res = await fetch(`${API_BASE_URL}/api/invoices/installations/${editingInstallationId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(payload)
        })
        if (!res.ok) {
          const errJson = await res.json().catch(() => null)
          setMontageError(errJson?.message || 'Montaj kaydı güncellenemedi.')
          return
        }
      } else {
        const clientId = generateGuid()
        const payload = {
          installationClientId: clientId,
          quantity: Number(montageForm.quantity ?? 1),
          customerName: montageForm.installationName,
          phone: montageForm.installationPhone,
          address: montageForm.address,
          region: montageForm.region,
          note: montageForm.dealerDescription,
          dealerName: montageForm.dealerName,
          productName: montageForm.productName
        }
        const res = await fetch(`${API_BASE_URL}/api/invoices/lines/${montageInvoiceLine.id}/installations`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        })
        if (!res.ok) {
          const errJson = await res.json().catch(() => null)
          setMontageError(errJson?.message || 'Montaj kaydı eklenemedi.')
          return
        }
      }

      // Save to memory cache for auto-filling subsequent montages
      lastMontageDataRef.current = {
        installationName: montageForm.installationName,
        installationPhone: montageForm.installationPhone,
        address: montageForm.address,
        region: montageForm.region,
        dealerDescription: montageForm.dealerDescription,
        invoiceId: montageInvoiceId,
        dealerCode: montageForm.dealerName
      }

      const updated = await fetchInstallationsForLine(montageInvoiceLine.id)
      setMontageInstallations(updated)
      setIsAddingNewMontage(false)
      setEditingInstallationId(null)
      setMontageRefreshKey((k) => k + 1)
      reload()
    } catch {
      setMontageError('Montaj kaydı işlenirken hata oluştu.')
    } finally {
      setMontageSaving(false)
    }
  }

  const deleteMontageRecord = async (instId: number) => {
    if (!window.confirm('Bu montaj kaydını silmek/pasife almak istediğinize emin misiniz?')) return
    try {
      setMontageSaving(true)
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(`${API_BASE_URL}/api/invoices/installations/${instId}`, {
        method: 'DELETE',
        headers
      })
      if (!res.ok) {
        // Silme kuralı (başkasının faturası / 24 saat) mesajı kullanıcıya gösterilsin.
        const j = await res.json().catch(() => null)
        setMontageError((j && typeof j.message === 'string' && j.message) || 'Montaj kaydı silinemedi.')
        return
      }

      const updated = await fetchInstallationsForLine(montageInvoiceLine.id)
      setMontageInstallations(updated)
      if (editingInstallationId === instId) {
        setEditingInstallationId(null)
        setIsAddingNewMontage(false)
      }
      setMontageRefreshKey((k) => k + 1)
      reload()
    } catch {
      setMontageError('Montaj kaydı silinemedi.')
    } finally {
      setMontageSaving(false)
    }
  }

  /**
   * Kalemin BÜTÜN montajlarını kaldırır — kalem "montajsız" olur.
   *
   * Tek tek "Sil" zaten vardı ama bir kalemde birden çok montaj adresi olabiliyor; hepsini
   * teker teker silmek hem zahmetli hem de yarım bırakmaya açıktı. Silme ServiceOps'a da
   * yansır, yoksa montaj bayi tarafında öksüz kalırdı.
   */
  const removeAllMontageFromLine = async () => {
    if (!montageInvoiceLine) return
    if (!window.confirm(
      'Bu kalemdeki TÜM montaj kayıtları kaldırılacak ve kalem montajsız hale gelecek.\n\n' +
      'Montaj, bayi (servis) tarafından da silinir. Devam edilsin mi?'
    )) return

    try {
      setMontageSaving(true)
      setMontageError(null)
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(`${API_BASE_URL}/api/invoices/lines/${montageInvoiceLine.id}/installations`, {
        method: 'DELETE',
        headers
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        setMontageError((j && typeof j.message === 'string' && j.message) || 'Montaj kaldırılamadı.')
        return
      }

      setMontageInstallations([])
      setEditingInstallationId(null)
      setIsAddingNewMontage(false)
      setMontageRefreshKey((k) => k + 1)
      reload()
      setMontageOpen(false)
    } catch {
      setMontageError('Montaj kaldırılamadı.')
    } finally {
      setMontageSaving(false)
    }
  }

  const deleteInvoice = async (invoiceId: string) => {
    try {
      setConfirmBusy(true)
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(invoiceId)}`, {
        method: 'DELETE',
        headers
      })

      if (!res.ok) {
        const text = await res.text()
        let errorMsg = 'Fatura silinemedi'
        if (text && (text.startsWith('{') || text.startsWith('['))) {
          try {
            const parsed = JSON.parse(text)
            errorMsg = parsed.message || parsed.error || errorMsg
          } catch { }
        } else if (text) {
          errorMsg = text
        }
        showMessage('Hata', errorMsg)
        return
      }

      await reload()
      showMessage('Bilgi', 'Silindi')
    } catch {
      showMessage('Hata', 'Fatura silinemedi')
    } finally {
      setConfirmBusy(false)
    }
  }



  return (
    <div>
      {/* Page Header with Search Bar (Image 2) */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">Fatura Dökümü</h1>
          <p className="text-xs text-gray-400 mt-0.5">Fatura İşlemleri / Fatura Dökümü</p>
        </div>

        {/* Global Search input next to Fatura Dökümü Title */}
        <div className="relative w-full sm:w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Fatura No, Cari Adı, Plasiyer Ara..."
            value={invoiceList.globalFilter}
            onChange={(e) => invoiceList.handleGlobalFilterChange(e.target.value)}
            className="w-full h-9 pl-9 pr-8 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500 focus:bg-white shadow-sm transition-all"
          />
          {invoiceList.globalFilter && (
            <button
              type="button"
              onClick={() => invoiceList.handleGlobalFilterChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-3 text-xs font-semibold text-red-600">{error}</div>}

      <AppDataTable<InvoiceListItem>
        onRefresh={() => void reload()}
        data={invoiceList.data}
        columns={columns}
        rowId={(row) => String(row.id)}
        pagination={{
          pageIndex: invoiceList.pageIndex,
          pageSize: invoiceList.pageSize,
          totalCount: invoiceList.totalCount,
          onPageChange: invoiceList.handlePageChange,
          onPageSizeChange: invoiceList.handlePageSizeChange
        }}
        sorting={{
          sorting: invoiceList.sorting,
          onSortingChange: invoiceList.handleSortingChange
        }}
        filtering={{
          globalFilter: invoiceList.globalFilter,
          onGlobalFilterChange: invoiceList.handleGlobalFilterChange,
          columnFilters: invoiceList.columnFilters,
          onColumnFilterChange: invoiceList.handleColumnFilterChange,
          showColumnFilters: true,
          /**
           * SAYFALAMA SUNUCUDA (2026-08-22 düzeltmesi).
           *
           * Bu sayfa süzme, sıralama ve sayfalamayı `useInvoiceList` ile SUNUCUDA yapıyor
           * ama bu bayrağı hiç göndermiyordu. Tablo da sunucudan gelen tek sayfalık 20
           * satırı "verinin tamamı" sanıp kendi içinde tekrar sayfalıyordu: sayaç hep
           * "Sayfa 1 / 1" kalıyor ve ileri düğmeleri hiç açılmıyordu. Üstelik sunucunun
           * uyguladığı süzgeç istemcide İKİNCİ kez uygulanıyordu.
           */
          manualFiltering: true
        }}
        states={{
          loading: invoiceList.loading,
          error: invoiceList.error || error,
          onRetry: invoiceList.refetch,
          emptyTitle: 'Fatura Kaydı Bulunamadı',
          emptyDescription: 'Arama kriterlerinize veya tarih aralığına uygun hiçbir fatura bulunamadı.'
        }}
        onRowClick={(r) => setPreviewItem(r)}
        onPreviewRow={(r) => setPreviewItem(r)}
        toolbar={{
          showSearch: false,
          showColumnVisibility: true
        }}
        rowActions={(r) => [
          {
            key: 'detail',
            label: 'Önizle / Detay',
            onClick: () => setPreviewItem(r)
          },
          ...((canOdemeAlindi || canNakitMiktar)
            ? [
                {
                  key: 'payment',
                  label: r.odemeAlindi ? 'Ödeme (İptal/Detay)' : 'Ödeme',
                  onClick: () => openPaymentModal(r)
                }
              ]
            : []),
          ...(canUpdateHeader
            ? [
                {
                  key: 'update',
                  label: 'Üst Bilgi Güncelle',
                  onClick: () => openHeaderEdit(r)
                }
              ]
            : []),
          ...(canBarkod
            ? [
                {
                  key: 'barcode',
                  label: 'Barkod',
                  onClick: () => {
                    void handlePrintInvoiceBarcodes(r)
                  }
                }
              ]
            : []),
          ...(canBasim
            ? [
                {
                  key: 'print',
                  label: 'Basım',
                  onClick: () => {
                    void handlePrintInvoice(r)
                  }
                }
              ]
            : []),
          ...(canSil
            ? (() => {
                const canDeleteAll =
                  isSuperAdmin ||
                  allowedKeys?.has('deleteRule/tumIslemleriSilebilsin') ||
                  allowedKeys?.has('deleteRule/deleteRule/tumIslemleriSilebilsin')
                const currentUsername = (localStorage.getItem('userName') || '').toLowerCase()
                const recordUser = String(r.islemYapan || r.createUser || '').toLowerCase()
                const isOwner = Boolean(currentUsername) && currentUsername === recordUser
                const allowedDelete = canDeleteAll || isOwner
                const lockedByDate = isInvoiceLocked(r)

                let disabledReason: string | undefined = undefined
                if (lockedByDate) {
                  disabledReason = `Genel Ayarlar kilit tarihi (${new Date(invoiceDeleteLockDate + 'T00:00:00').toLocaleDateString('tr-TR')}) öncesindeki faturalar silinemez`
                } else if (!allowedDelete) {
                  disabledReason = 'Bu işlemi sadece işlemi yapan kullanıcı silebilir'
                }

                return [
                  {
                    key: 'delete',
                    label: 'Sil',
                    danger: true,
                    disabled: lockedByDate || !allowedDelete,
                    disabledReason,
                    onClick: () => {
                      if (lockedByDate || !allowedDelete) return
                      requestConfirm('Onay', 'Faturayı silmek istediğinize emin misiniz?', () =>
                        deleteInvoice(r.id)
                      )
                    }
                  }
                ]
              })()
            : [])
        ]}
        renderExpandedRow={(r) => (
          <InvoiceLinesPanel
            invoice={r}
            isSuperAdmin={!!isSuperAdmin}
            allowedKeys={allowedKeys}
            openMontage={openMontage}
            reloadList={reload}
            montageRefreshKey={montageRefreshKey}
            isLocked={isInvoiceLocked(r)}
          />
        )}
      />

      {/* Invoice Preview Card Modal */}
      {previewItem && (
        <InvoicePreviewModal
          item={previewItem}
          onClose={() => setPreviewItem(null)}
        />
      )}


      <Modal
        isOpen={headerEditOpen}
        onClose={() => {
          if (headerEditBusy) return
          setHeaderEditOpen(false)
          setHeaderEditInvoiceId(null)
        }}
        title="Üst Bilgi Güncelle"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={headerEditBusy}
              onClick={() => {
                setHeaderEditOpen(false)
                setHeaderEditInvoiceId(null)
              }}
              className="px-3 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={headerEditBusy}
              onClick={() => void submitHeaderEdit()}
              className="px-3 py-2 text-xs font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-60"
            >
              {headerEditBusy ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Fatura Seri & Fatura No Split */}
          <div className="md:col-span-2 grid grid-cols-3 gap-3 bg-gray-50/70 p-3 rounded-xl border border-gray-200">
            <div className="col-span-1">
              <FormInput
                label="Fatura Seri"
                value={headerEditSerie}
                onChange={(e) => setHeaderEditSerie(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
                placeholder="Örn: A"
              />
            </div>
            <div className="col-span-2">
              <FormInput
                label="Fatura Sıra No"
                value={headerEditNumber}
                onChange={(e) => setHeaderEditNumber(e.target.value.replace(/[^0-9]/g, '').slice(0, 15))}
                placeholder="Örn: 6326"
              />
            </div>
            <div className="col-span-3 text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg flex items-center justify-between">
              <span>Otomatik Birleşik Fatura No:</span>
              <span className="font-mono font-extrabold text-xs text-emerald-900">
                {computedHeaderInvoiceNo || (headerEditSerie ? `${headerEditSerie}${'0'.repeat(Math.max(0, 15 - headerEditSerie.length))}` : 'A00000000000000')}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
              {headerEditIslemTipi === 'ALIŞ' ? 'Tedarikçi' : headerEditIslemTipi === 'HİZMET' ? 'Hizmet' : 'Cari'}
            </label>
            {/*
              ARANABILIR SECICI (2026-09-01 kullanici istegi: "cari seciminde de search bar
              lazim"). Ham <select> idi: 5000+ cari arasindan kaydirarak bulmak gerekiyordu.
              `SearchableCariSelect` kendi arama kutusunu ve tur pastillerini getiriyor;
              ekranin geri kalani degismedi, secim yine `customerCode` yaziyor.

              Liste UCTAN GELMIYOR, zaten yuklu olan dizilerden kuruluyor: ALIS'ta
              tedarikci, HIZMET'te hizmet, digerlerinde cari. Uc secimi buranin isi degil.
            */}
            <div className="mt-2">
              <SearchableCariSelect
                value={String(headerEditForm.customerCode ?? '')}
                onChange={(v) => setHeaderEditForm((p) => ({ ...p, customerCode: v }))}
                disabled={
                  headerEditIslemTipi === 'ALIŞ'
                    ? suppliersLoading
                    : headerEditIslemTipi === 'HİZMET'
                      ? servicesLoading
                      : customersLoading
                }
                placeholder={
                  (headerEditIslemTipi === 'ALIŞ' ? suppliersLoading : headerEditIslemTipi === 'HİZMET' ? servicesLoading : customersLoading)
                    ? 'Yükleniyor...'
                    : headerEditIslemTipi === 'ALIŞ'
                      ? 'Tedarikçi Ara (Kod veya Ad)...'
                      : headerEditIslemTipi === 'HİZMET'
                        ? 'Hizmet Ara (Kod veya Ad)...'
                        : 'Cari Ara (Kod, İsim, Telefon)...'
                }
                options={(() => {
                  if (headerEditIslemTipi === 'ALIŞ') {
                    return (suppliers ?? []).map((sp) => ({
                      value: String(sp.supplierCode ?? ''),
                      label: `${String(sp.supplierCode ?? '')} - ${String(sp.fullName ?? '')}`.trim(),
                      code: String(sp.supplierCode ?? ''),
                      name: String(sp.fullName ?? ''),
                      customerType: '320'
                    }))
                  }
                  if (headerEditIslemTipi === 'HİZMET') {
                    return (services ?? []).map((sv: any) => ({
                      value: String(sv.code ?? ''),
                      label: `${String(sv.code ?? '')} - ${String(sv.name ?? '')}`.trim(),
                      code: String(sv.code ?? ''),
                      name: String(sv.name ?? '')
                    }))
                  }

                  const liste = (customers ?? []).map((c) => ({
                    value: String(c.customerCode ?? ''),
                    label: `${String(c.customerCode ?? '')} - ${String(c.name ?? '')}`.trim(),
                    code: String(c.customerCode ?? ''),
                    name: String(c.name ?? ''),
                    phone: String((c as any).phone ?? (c as any).fax ?? ''),
                    customerType: String((c as any).customerType ?? '')
                  }))

                  /*
                    Faturanin MEVCUT carisi listede olmayabilir (pasif, kapsam disi ya da
                    farkli tip). Eski <select> bunun icin "(Seçili Cari)" diye ek bir secenek
                    basiyordu; ayni koruma burada da var, yoksa pencere acilir acilmaz secim
                    bos gorunur ve kaydedince cari degismis olurdu.
                  */
                  const mevcut = String(headerEditForm.customerCode ?? '').trim()
                  if (mevcut && !liste.some((o) => o.value === mevcut)) {
                    liste.unshift({
                      value: mevcut,
                      label: `${mevcut} - (Seçili Cari)`,
                      code: mevcut,
                      name: '(Seçili Cari)',
                      phone: '',
                      customerType: ''
                    })
                  }
                  return liste
                })()}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Açık/Fatura</label>
            <select
              value={normalizedInvoiceType}
              onChange={(e) => setHeaderEditForm((p) => ({ ...p, invoiceType: e.target.value }))}
              className="input-base h-9 text-sm mt-2"
            >
              {invoiceTypeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {canEditHeaderDate && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Fatura Tarihi</label>
              <input
                type="date"
                value={headerEditForm.date}
                onChange={(e) => setHeaderEditForm((p) => ({ ...p, date: e.target.value }))}
                className="input-base h-9 text-sm mt-2"
              />
              <p className="mt-1 text-[10px] text-gray-400">
                Değiştirirsen stok hareketi ve cari ekstre satırı da yeni tarihe taşınır. Döviz kuru
                otomatik güncellenmez — gerekiyorsa kuru elle düzelt.
              </p>
            </div>
          )}

          {headerEditForm.currencyTypeId > 1 && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">
                {`Döviz Kuru (${headerEditForm.currencyTypeId === 2 ? 'EUR' : headerEditForm.currencyTypeId === 3 ? 'USD' : headerEditForm.currencyTypeId === 4 ? 'GBP' : 'Döviz'})`}
              </label>
              <input
                type="text"
                value={headerEditForm.exchangeRate}
                onChange={(e) => setHeaderEditForm((p) => ({ ...p, exchangeRate: e.target.value }))}
                className="input-base h-9 text-sm mt-2"
                placeholder="1.0000"
              />
            </div>
          )}

          {isAcikToFatura && (
            <div className="md:col-span-2 p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-900 flex items-start gap-2 mt-1">
              <span className="text-base">💡</span>
              <div>
                <span className="font-bold">Faturaya Dönüştürme Mimarisi:</span> Açık satış faturaya dönüştürüldüğünde, müşteri cari hesabı otomatik olarak bağlı fatura hesabına (<code className="bg-purple-100 px-1 py-0.5 rounded font-mono font-bold text-purple-800">{headerEditForm.customerCode ? `${headerEditForm.customerCode.endsWith('-1') ? headerEditForm.customerCode : `${headerEditForm.customerCode}-1`}` : '{CariKodu}-1'}</code>) aktarılacak, birim fiyatlar KDV matrahlı fatura fiyat grubuna göre yeniden hesaplanacak ve stok/cari ekstre kayıtları güncellenecektir.
              </div>
            </div>
          )}

          {isAcikToFatura ? (
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Fiyat Grubu</label>
              <select
                value={headerEditForm.priceGroupId}
                onChange={(e) => setHeaderEditForm((p) => ({ ...p, priceGroupId: e.target.value }))}
                className="input-base h-9 text-sm mt-2"
                disabled={priceGroupsLoading}
              >
                {filteredFaturaPriceGroups.map((pg) => (
                  <option key={String(pg.id)} value={String(pg.id)}>
                    {`${pg.code} - ${pg.name}`}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        isOpen={fxOpen}
        onClose={() => {
          if (fxBusy || paymentModalBusy) return
          setFxOpen(false)
          setFxConfirmAction(null)
        }}
        title="Döviz Kuru"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={fxBusy || paymentModalBusy}
              onClick={() => {
                setFxOpen(false)
                setFxConfirmAction(null)
              }}
              className="px-3 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={fxBusy || paymentModalBusy || !fxConfirmAction}
              onClick={() => {
                const rate = Number(String(fxRate ?? '').replace(',', '.'))
                if (!(rate > 0)) {
                  showMessage('Uyarı', 'Kur giriniz')
                  return
                }
                setFxOpen(false)
                const fn = fxConfirmAction
                setFxConfirmAction(null)
                void (async () => {
                  if (!fn) return
                  await fn(rate)
                })()
              }}
              className="px-3 py-2 text-xs font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-60"
            >
              Onayla
            </button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="text-xs text-gray-600">
            Tahsilat tutarı: {fxFromCurrencyCode && fxFromCurrencyCode !== 'TRY' && fxFromAmount > 0 ? (
              <span className="font-bold text-gray-800 me-1">
                {fxFromAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {fxFromCurrencyCode}
              </span>
            ) : null}
            ({Number(fxInvoiceTryAmount ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
          </div>
          <div className="text-xs text-gray-600">Hesap dövizi: <span className="font-semibold">{fxCurrencyCode}</span></div>
          <FormInput
            label={`${fxRateLabel || `Kur (${fxCurrencyCode}/TRY)`} ${fxBusy ? '(yükleniyor...)' : ''}`}
            requiredMark
            value={fxRate}
            onChange={(e) => setFxRate(String(e.target.value))}
          />
          {Number(String(fxRate ?? '').replace(',', '.')) > 0 ? (
            <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-3">
              <div className="text-[11px] text-emerald-700 font-semibold">Yaklaşık giriş tutarı</div>
              <div className="mt-0.5 text-base font-extrabold text-emerald-900">
                {(() => {
                  const inputRate = Number(String(fxRate ?? '').replace(',', '.')) || 1
                  const fromCode = (fxFromCurrencyCode || 'TRY').toUpperCase()
                  const toCode = (fxCurrencyCode || 'TRY').toUpperCase()
                  
                  let entryAmount = 0
                  if (fromCode === toCode) {
                    entryAmount = fxFromAmount > 0 ? fxFromAmount : fxInvoiceTryAmount
                  } else if (fromCode === 'TRY') {
                    entryAmount = fxInvoiceTryAmount / inputRate
                  } else if (toCode === 'TRY') {
                    entryAmount = (fxFromAmount > 0 ? fxFromAmount : fxInvoiceTryAmount) * inputRate
                  } else {
                    const baseAmt = fxFromAmount > 0 ? fxFromAmount : (fxFromTryRate > 0 ? fxInvoiceTryAmount / fxFromTryRate : fxInvoiceTryAmount)
                    entryAmount = baseAmt * inputRate
                  }
                  return entryAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                })()} {fxCurrencyCode}
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        isOpen={paymentModalOpen}
        onClose={() => {
          if (paymentModalBusy) return
          setPaymentModalOpen(false)
          setPaymentModalInvoice(null)
        }}
        title={
          paymentModalInvoice?.odemeAlindi
            ? 'Ödeme Detayı & İptali'
            : (paymentModalInvoice?.islemTipi === 'SATIŞ' ? 'Ödeme Giriş İşlemi' : 'Ödeme Çıkış İşlemi')
        }
      >
        <div className="space-y-4 text-left">
          <div className="bg-gray-50 rounded-xl p-3 text-xs border border-gray-100 space-y-1">
            <div className="flex justify-between">
              <span className="font-semibold text-gray-500">Fatura Seri/No:</span>
              <span className="font-bold text-gray-800">{paymentModalInvoice?.faturaNo ?? ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-semibold text-gray-500">Cari Hesabı:</span>
              <span className="font-bold text-gray-800 truncate max-w-[240px]">{paymentModalInvoice?.cariAdi ?? ''}</span>
            </div>
            <div className="flex justify-between border-t border-gray-200/50 pt-1 mt-1 font-semibold text-gray-700">
              <span>Toplam Tutar:</span>
              <span>
                {paymentModalInvoice ? formatMoney(Number(paymentModalInvoice.genelToplam ?? 0)) : ''}
                {invoiceCurrencyCode !== 'TRY' && (
                  <span className="ml-1.5 font-bold text-blue-700">
                    ({invoiceCurrencyGrandTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {invoiceCurrencyCode})
                  </span>
                )}
              </span>
            </div>
          </div>

          {paymentModalInvoice?.odemeAlindi ? (
            // CASE A: Invoice is already PAID
            <div className="space-y-4">
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3.5 text-xs font-semibold leading-relaxed">
                Bu fatura ödenmiş durumdadır. Sistemde kayıtlı olan ödeme detayları aşağıdadır:
                <div className="mt-2 text-[11px] text-gray-500 space-y-0.5">
                  <div>Ödeme Hedefi: <b className="text-gray-700">{paymentModalInvoice?.odemeHedefi ?? '—'}</b></div>
                  <div>Kasa: <b className="text-gray-700">{paymentModalInvoice?.odemeKasaId ? `Kasa ID: ${paymentModalInvoice.odemeKasaId}` : '—'}</b> | Banka: <b className="text-gray-700">{paymentModalInvoice?.odemeBankaId ? `Banka ID: ${paymentModalInvoice.odemeBankaId}` : '—'}</b></div>
                </div>
              </div>

              <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3.5 text-xs leading-relaxed">
                <span className="font-bold block mb-1">⚠️ ÖDEMEYİ İPTAL ETMEK ÜZERESİNİZ!</span>
                Ödemeyi iptal ederseniz, bu fatura tekrar <b className="text-red-950 font-black">Ödenmedi</b> durumuna gelecektir. İlişkili tüm kasa, banka ve cari ekstre hareketleri silinecektir. Bu işlem geri alınamaz.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  disabled={paymentModalBusy}
                  onClick={() => {
                    setPaymentModalOpen(false)
                    setPaymentModalInvoice(null)
                  }}
                  className="px-3 py-2 text-xs font-bold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-750"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  disabled={paymentModalBusy}
                  onClick={() => {
                    requestConfirm(
                      'Ödemeyi İptal Et',
                      'Faturanın ödemesini iptal ederek ödenmedi durumuna getirmek istediğinize emin misiniz? İlişkili kasa/banka hareketleri silinecektir.',
                      async () => {
                        await doSubmitManualPaymentRevert(paymentModalInvoice)
                      },
                      'Evet, Ödenmedi Yap',
                      'Vazgeç',
                      'red',
                      'gray'
                    )
                  }}
                  className="px-3 py-2 text-xs font-bold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60 shadow-sm"
                >
                  Ödemeyi İptal Et (Ödenmedi Yap)
                </button>
              </div>
            </div>
          ) : (
            // CASE B: Invoice is UNPAID (Payment Flow)
            <>
              {/* Payment Mode Selection Tabs */}
              <div>
                <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Ödeme Tipi</span>
                <div className="flex border border-gray-200 rounded-xl p-1 bg-gray-50/50">
                  <button
                    type="button"
                    onClick={() => setPaymentMode('manual')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      paymentMode === 'manual'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'
                    }`}
                  >
                    Manuel Öde
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentMode('pay_now')
                      if (!paymentSource) setPaymentSource('cash')
                    }}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      paymentMode === 'pay_now'
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'
                    }`}
                  >
                    {paymentModalInvoice?.islemTipi === 'SATIŞ' ? 'Hemen Tahsil Et' : 'Hemen Öde'}
                  </button>
                  {paymentModalInvoice?.islemTipi === 'SATIŞ' && (
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentMode('pay_with_change')
                        if (!paymentSource) setPaymentSource('cash')
                      }}
                      className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                        paymentMode === 'pay_with_change'
                          ? 'bg-purple-600 text-white shadow-md'
                          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'
                      }`}
                    >
                      Artan Hesap (Para Üstü)
                    </button>
                  )}
                </div>
              </div>

              {/* Option 1: Manuel Ödeme */}
              {paymentMode === 'manual' && (
                <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-xl p-4 text-xs space-y-2">
                  <div className="font-bold text-blue-950">Manuel Ödeme İşlemi</div>
                  <p className="leading-relaxed">
                    Bu seçenek seçildiğinde kasa, banka veya POS hesaplarında herhangi bir hareket oluşturulmaz. Fatura sadece cari ekstrede <b>Ödendi</b> olarak işaretlenecektir.
                  </p>
                </div>
              )}

              {/* Option 2: Hemen Tahsil Et / Hemen Öde */}
              {paymentMode === 'pay_now' && (
                <div className="space-y-3">
                  <FormSelect
                    label="Tahsilat / Ödeme Yeri"
                    value={paymentSource}
                    disabled={paymentModalBusy}
                    onChange={(e) => {
                      const v = String(e.target.value) as any
                      setPaymentSource(v)
                      if (v === 'cash') setSelectedBankAccountDefinitionId('')
                      if (v === 'bank') setSelectedCashAccountId('')
                      if (v !== 'pos') setSelectedPosBankAccountDefinitionId('')
                      if (v === 'pos') {
                        setSelectedCashAccountId('')
                        setSelectedBankAccountDefinitionId('')
                      }
                    }}
                    options={[
                      { value: 'cash', label: 'Kasa' },
                      { value: 'bank', label: 'Banka' },
                      { value: 'pos', label: 'POS' }
                    ]}
                  />

                  {paymentSource === 'bank' ? (
                    <>
                      <FormSelect
                        label="Banka Hesabı *"
                        value={selectedBankAccountDefinitionId}
                        disabled={paymentModalBusy}
                        onChange={(e) => setSelectedBankAccountDefinitionId(String(e.target.value))}
                        options={bankAccountOptions.length ? [{ value: '', label: 'Seçiniz...' }, ...bankAccountOptions] : [{ value: '', label: 'Banka bulunamadı' }]}
                      />
                      <div className="flex flex-col space-y-1">
                        <label className="text-xs font-bold text-gray-750">POS Masrafı</label>
                        <input
                          type="text"
                          placeholder="0.00"
                          value={posFee}
                          disabled={paymentModalBusy}
                          onChange={(e) => {
                            const val = e.target.value
                            if (/^[0-9]*[.,]?[0-9]*$/.test(val)) {
                              setPosFee(val)
                            }
                          }}
                          className="w-full h-9 px-3 rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs font-medium transition-all disabled:bg-gray-50"
                        />
                      </div>
                    </>
                  ) : paymentSource === 'pos' ? (
                    <FormSelect
                      label="POS Hesabı *"
                      value={selectedPosBankAccountDefinitionId}
                      disabled={paymentModalBusy}
                      onChange={(e) => setSelectedPosBankAccountDefinitionId(String(e.target.value))}
                      options={posAccountOptions.length ? [{ value: '', label: 'Seçiniz...' }, ...posAccountOptions] : [{ value: '', label: 'POS hesabı bulunamadı' }]}
                    />
                  ) : (
                    <FormSelect
                      label="Kasa Hesabı *"
                      value={selectedCashAccountId}
                      disabled={paymentModalBusy}
                      onChange={(e) => setSelectedCashAccountId(String(e.target.value))}
                      options={cashAccountOptions.length ? [{ value: '', label: 'Seçiniz...' }, ...cashAccountOptions] : [{ value: '', label: 'Kasa bulunamadı' }]}
                    />
                  )}

                  <div className="flex items-center gap-2 py-1">
                    <input
                      type="checkbox"
                      id="isPriceOverridden"
                      checked={isPriceOverridden}
                      disabled={paymentModalBusy}
                      onChange={(e) => {
                        const checked = e.target.checked
                        setIsPriceOverridden(checked)
                        if (!checked && requiredPaymentAmount > 0) {
                          setCashReceivedAmount(String(Number(requiredPaymentAmount.toFixed(2))))
                        }
                      }}
                      className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <label htmlFor="isPriceOverridden" className="text-xs font-semibold text-gray-700 select-none cursor-pointer">
                      Farklı Tutar Öde / Tutarı Değiştir (Kısmi Ödeme)
                    </label>
                  </div>

                  <div className="flex flex-col space-y-1">
                    <label className="text-xs font-bold text-gray-750">Ödenecek Tutar ({accountCurrencyCode}) *</label>
                    <input
                      type="text"
                      placeholder="0.00"
                      value={cashReceivedAmount}
                      disabled={paymentModalBusy || !isPriceOverridden}
                      onChange={(e) => {
                        const val = e.target.value
                        if (/^[0-9]*[.,]?[0-9]*$/.test(val)) {
                          setCashReceivedAmount(val)
                        }
                      }}
                      className="w-full h-9 px-3 rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs font-medium transition-all disabled:bg-gray-50 disabled:text-gray-400"
                    />
                  </div>

                  {(() => {
                    let acc: any = null
                    if (paymentSource === 'cash') {
                      acc = cashAccounts.find(c => String(c.id) === String(selectedCashAccountId))
                    } else if (paymentSource === 'bank') {
                      acc = bankAccounts.find(b => String(b.id) === String(selectedBankAccountDefinitionId))
                    } else if (paymentSource === 'pos') {
                      acc = bankAccounts.find(b => String(b.id) === String(selectedPosBankAccountDefinitionId))
                    }
                    const toCode = (getAccountCurrencyCode(acc) || 'TRY').toUpperCase()
                    const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()
                    if (!toCode || fromCode === toCode) return null

                    let label = `Giriş/Çıkış Hesabı Kuru (1 ${toCode} = ? TL)`
                    if (fromCode !== 'TRY' && toCode !== 'TRY' && fromCode !== toCode) {
                      label = `Giriş/Çıkış Hesabı Kuru (1 ${fromCode} = ? ${toCode})`
                    } else if (fromCode !== 'TRY' && toCode === 'TRY') {
                      label = `Giriş/Çıkış Hesabı Kuru (1 ${fromCode} = ? TL)`
                    }

                    return (
                      <div className="flex flex-col space-y-1">
                        <label className="text-xs font-bold text-gray-750">{label}</label>
                        <input
                          type="text"
                          value={paymentRateInput}
                          disabled={paymentModalBusy}
                          onChange={(e) => {
                            const val = e.target.value
                            if (/^[0-9]*[.,]?[0-9]*$/.test(val)) {
                              setPaymentRateInput(val)
                            }
                          }}
                          className="w-full h-9 px-3 rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs font-medium transition-all"
                        />
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Option 3: Artan Hesap (Para Üstü) */}
              {paymentMode === 'pay_with_change' && (
                <div className="space-y-3">
                  <FormSelect
                    label="Tahsilat Yeri"
                    value={paymentSource}
                    disabled={paymentModalBusy}
                    onChange={(e) => {
                      const v = String(e.target.value) as any
                      setPaymentSource(v)
                      if (v === 'cash') setSelectedBankAccountDefinitionId('')
                      if (v === 'bank') setSelectedCashAccountId('')
                      if (v !== 'pos') setSelectedPosBankAccountDefinitionId('')
                    }}
                    options={[
                      { value: 'cash', label: 'Kasa' },
                      { value: 'bank', label: 'Banka' },
                      { value: 'pos', label: 'POS' }
                    ]}
                  />

                  {paymentSource === 'bank' ? (
                    <FormSelect
                      label="Alınacak Banka Hesabı *"
                      value={selectedBankAccountDefinitionId}
                      disabled={paymentModalBusy}
                      onChange={(e) => setSelectedBankAccountDefinitionId(String(e.target.value))}
                      options={bankAccountOptions.length ? [{ value: '', label: 'Seçiniz...' }, ...bankAccountOptions] : [{ value: '', label: 'Banka bulunamadı' }]}
                    />
                  ) : paymentSource === 'pos' ? (
                    <FormSelect
                      label="Alınacak POS Hesabı *"
                      value={selectedPosBankAccountDefinitionId}
                      disabled={paymentModalBusy}
                      onChange={(e) => setSelectedPosBankAccountDefinitionId(String(e.target.value))}
                      options={posAccountOptions.length ? [{ value: '', label: 'Seçiniz...' }, ...posAccountOptions] : [{ value: '', label: 'POS hesabı bulunamadı' }]}
                    />
                  ) : (
                    <FormSelect
                      label="Alınacak Kasa Hesabı *"
                      value={selectedCashAccountId}
                      disabled={paymentModalBusy}
                      onChange={(e) => setSelectedCashAccountId(String(e.target.value))}
                      options={cashAccountOptions.length ? [{ value: '', label: 'Seçiniz...' }, ...cashAccountOptions] : [{ value: '', label: 'Kasa bulunamadı' }]}
                    />
                  )}

                  <div className="grid grid-cols-2 gap-3 items-end">
                    <div className="flex flex-col space-y-1">
                      <label className="text-xs font-bold text-gray-750">Ödenen Tutar (Kasaya Giren) *</label>
                      <input
                        type="text"
                        placeholder="0.00"
                        value={cashReceivedAmount}
                        disabled={paymentModalBusy}
                        onChange={(e) => setCashReceivedAmount(String(e.target.value))}
                        className="w-full h-9 px-3 rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs font-medium transition-all disabled:bg-gray-50"
                      />
                    </div>
                    <div className="flex items-center h-9 px-3 bg-purple-50 border border-purple-100 text-purple-800 rounded-lg text-[10px] font-semibold leading-tight">
                      Para üstü ödemek için nakit girişini girin.
                    </div>
                  </div>

                  {invoiceCurrencyCode !== 'TRY' && (
                    <div className="flex flex-col space-y-1">
                      <label className="text-xs font-bold text-gray-750">Fatura Döviz Kuru (1 {invoiceCurrencyCode} = ? TL)</label>
                      <input
                        type="text"
                        value={invoiceRateInput}
                        disabled={paymentModalBusy}
                        onChange={(e) => {
                          const val = e.target.value
                          if (/^[0-9]*[.,]?[0-9]*$/.test(val)) {
                            setInvoiceRateInput(val)
                          }
                        }}
                        className="w-full h-9 px-3 rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs font-medium transition-all"
                      />
                    </div>
                  )}

                  {changeAmount > 0 && (
                    <>
                      <FormSelect
                        label="Para Üstü Verilecek Yöntem"
                        value={changeSource}
                        disabled={paymentModalBusy}
                        onChange={(e) => {
                          const v = String(e.target.value) as any
                          setChangeSource(v)
                          if (v === 'cash') setSelectedChangeBankAccountDefinitionId('')
                          if (v === 'bank') setSelectedChangeCashAccountId('')
                        }}
                        options={[
                          { value: 'cash', label: 'Kasa' },
                          { value: 'bank', label: 'Banka' }
                        ]}
                      />

                      {changeSource === 'bank' ? (
                        <FormSelect
                          label="Para Üstü Ödenecek Banka *"
                          value={selectedChangeBankAccountDefinitionId}
                          disabled={paymentModalBusy}
                          onChange={(e) => setSelectedChangeBankAccountDefinitionId(String(e.target.value))}
                          options={bankAccountOptions.length ? [{ value: '', label: 'Seçiniz...' }, ...bankAccountOptions] : [{ value: '', label: 'Banka bulunamadı' }]}
                        />
                      ) : (
                        <FormSelect
                          label="Para Üstü Ödenecek Kasa *"
                          value={selectedChangeCashAccountId}
                          disabled={paymentModalBusy}
                          onChange={(e) => setSelectedChangeCashAccountId(String(e.target.value))}
                          options={cashAccountOptions.length ? [{ value: '', label: 'Seçiniz...' }, ...cashAccountOptions] : [{ value: '', label: 'Kasa bulunamadı' }]}
                        />
                      )}

                      {/* Change Account Rate Input */}
                      {(() => {
                        let acc: any = null
                        if (changeSource === 'cash') {
                          acc = cashAccounts.find(c => String(c.id) === String(selectedChangeCashAccountId))
                        } else if (changeSource === 'bank') {
                          acc = bankAccounts.find(b => String(b.id) === String(selectedChangeBankAccountDefinitionId))
                        }
                        const toCode = (getAccountCurrencyCode(acc) || 'TRY').toUpperCase()
                        const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()
                        if (!toCode || fromCode === toCode) return null

                        let label = `Para Üstü Kuru (1 ${toCode} = ? TL)`
                        if (fromCode !== 'TRY' && toCode !== 'TRY' && fromCode !== toCode) {
                          label = `Para Üstü Kuru (1 ${fromCode} = ? ${toCode})`
                        } else if (fromCode !== 'TRY' && toCode === 'TRY') {
                          label = `Para Üstü Kuru (1 ${fromCode} = ? TL)`
                        }

                        return (
                          <div className="flex flex-col space-y-1">
                            <label className="text-xs font-bold text-gray-750">{label}</label>
                            <input
                              type="text"
                              value={changeRateInput}
                              onChange={(e) => setChangeRateInput(e.target.value)}
                              className="w-full h-9 px-3 rounded-lg border border-gray-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-xs font-medium transition-all"
                            />
                          </div>
                        )
                      })()}
                    </>
                  )}
                </div>
              )}

              {/* Live Summary Card */}
              {(() => {
                if (paymentMode === 'manual') return null

                const hasEntryAccountSelected =
                  (paymentSource === 'cash' && Boolean(selectedCashAccountId)) ||
                  (paymentSource === 'bank' && Boolean(selectedBankAccountDefinitionId)) ||
                  (paymentSource === 'pos' && Boolean(selectedPosBankAccountDefinitionId))

                const hasChangeAccountSelected =
                  (changeSource === 'cash' && Boolean(selectedChangeCashAccountId)) ||
                  (changeSource === 'bank' && Boolean(selectedChangeBankAccountDefinitionId))

                const showSummaryCard = hasEntryAccountSelected || (paymentMode === 'pay_with_change' && changeAmount > 0 && hasChangeAccountSelected)
                if (!showSummaryCard) return null

                let receivingAccName = ''
                let receivingCurrency = invoiceCurrencyCode
                if (paymentSource === 'cash') {
                  const acc = cashAccounts.find(c => String(c.id) === String(selectedCashAccountId))
                  if (acc) {
                    receivingAccName = acc.name || acc.code
                    receivingCurrency = currencyCodeByTypeId(acc.currencyTypeId)
                  }
                } else if (paymentSource === 'bank') {
                  const acc = bankAccounts.find(b => String(b.id) === String(selectedBankAccountDefinitionId))
                  if (acc) {
                    receivingAccName = acc.accountName || acc.accountCode
                    receivingCurrency = currencyCodeByTypeId(acc.currencyTypeId)
                  }
                } else if (paymentSource === 'pos') {
                  const acc = bankAccounts.find(b => String(b.id) === String(selectedPosBankAccountDefinitionId))
                  if (acc) {
                    receivingAccName = acc.accountName || acc.accountCode
                    receivingCurrency = currencyCodeByTypeId(acc.currencyTypeId)
                  }
                }

                let changeAccName = ''
                let changeCurrency = invoiceCurrencyCode
                let changeAcc: any = null
                if (changeSource === 'cash') {
                  changeAcc = cashAccounts.find(c => String(c.id) === String(selectedChangeCashAccountId))
                  if (changeAcc) {
                    changeAccName = changeAcc.name || changeAcc.code
                    changeCurrency = currencyCodeByTypeId(changeAcc.currencyTypeId)
                  }
                } else if (changeSource === 'bank') {
                  changeAcc = bankAccounts.find(b => String(b.id) === String(selectedChangeBankAccountDefinitionId))
                  if (changeAcc) {
                    changeAccName = changeAcc.accountName || changeAcc.accountCode
                    changeCurrency = currencyCodeByTypeId(changeAcc.currencyTypeId)
                  }
                }

                const invoiceRateVal = Number(String(invoiceRateInput).replace(',', '.')) || 1
                const paymentRateVal = Number(String(paymentRateInput).replace(',', '.')) || 1
                const changeRateVal = Number(String(changeRateInput).replace(',', '.')) || 1

                const fromCode = (invoiceCurrencyCode || 'TRY').toUpperCase()
                const entryCode = (receivingCurrency || 'TRY').toUpperCase()
                const toCode = (getAccountCurrencyCode(changeAcc) || 'TRY').toUpperCase()

                const targetInvoicePortion = paymentMode === 'pay_with_change'
                  ? (changeAmount > 0 ? invoiceCurrencyGrandTotal : parsedCashReceivedInInvoiceCurrency)
                  : invoiceCurrencyGrandTotal

                let entryAmountVal = 0
                if (fromCode === entryCode) {
                  entryAmountVal = targetInvoicePortion
                } else if (fromCode === 'TRY' && entryCode !== 'TRY') {
                  entryAmountVal = paymentRateVal > 0 ? targetInvoicePortion / paymentRateVal : 0
                } else if (fromCode !== 'TRY' && entryCode === 'TRY') {
                  entryAmountVal = targetInvoicePortion * invoiceRateVal
                } else {
                  entryAmountVal = targetInvoicePortion * paymentRateVal
                }

                let changeAmountVal = 0
                if (fromCode === toCode) {
                  changeAmountVal = changeAmount
                } else if (fromCode === 'TRY' && toCode !== 'TRY') {
                  changeAmountVal = changeRateVal > 0 ? changeAmount / changeRateVal : 0
                } else if (fromCode !== 'TRY' && toCode === 'TRY') {
                  changeAmountVal = changeAmount * invoiceRateVal
                } else {
                  changeAmountVal = changeAmount * changeRateVal
                }

                return (
                  <>
                    <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 space-y-2.5 shadow-[inset_0_2px_4px_rgba(0,0,0,0.01)] text-xs text-blue-900 mt-3 font-medium">
                      <div className="font-bold flex items-center gap-1.5 text-blue-950">
                        <CircleAlert size={14} className="text-blue-700" />
                        Ödeme Dağılım Özeti
                      </div>
                      <div className="grid grid-cols-1 gap-2 border-t border-blue-200/50 pt-2.5">
                        {hasEntryAccountSelected && (
                          <div className="flex justify-between items-center">
                            <span className="font-semibold text-blue-800">
                              {paymentModalInvoice?.islemTipi === 'SATIŞ' ? 'Giriş Yapılacak' : 'Çıkış Yapılacak'} ({receivingAccName}):
                            </span>
                            <span className="font-extrabold text-blue-950 text-sm">
                              {entryAmountVal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {receivingCurrency}
                            </span>
                          </div>
                        )}
                        {paymentMode === 'pay_with_change' && changeAmount > 0 && hasChangeAccountSelected && (
                          <div className="flex justify-between items-center border-t border-blue-200/20 pt-2">
                            <span className="font-semibold text-blue-800">Para Üstü Ödenecek ({changeAccName}):</span>
                            <span className="font-extrabold text-amber-900 text-sm">
                              {changeAmountVal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {changeCurrency}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {paymentMode === 'pay_with_change' && changeAmount > 0 && !hasChangeAccountSelected && (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-950 font-bold mt-3">
                        ⚠️ Lütfen para üstünün çıkacağı kasayı veya bankayı seçin.
                      </div>
                    )}

                    {paymentMode === 'pay_with_change' && changeAmount > 0 && hasChangeAccountSelected && changeAccountBalance !== null && changeAmountVal > changeAccountBalance && (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-950 font-bold mt-3 bg-red-100/60">
                        ⚠️ YETERSİZ BAKİYE! Seçilen kasada/bankada yeterli bakiye yok. (Bakiye: {changeAccountBalance.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {changeCurrency}, Gereken: {changeAmountVal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {changeCurrency})
                      </div>
                    )}
                  </>
                )
              })()}

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  disabled={paymentModalBusy}
                  onClick={() => {
                    setPaymentModalOpen(false)
                    setPaymentModalInvoice(null)
                  }}
                  className="px-3 py-2 text-xs font-semibold bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  disabled={
                    paymentModalBusy ||
                    (paymentMode === 'pay_with_change' && changeAmount > 0 && (
                      ((changeSource === 'cash' && !selectedChangeCashAccountId) ||
                       (changeSource === 'bank' && !selectedChangeBankAccountDefinitionId))
                    ))
                  }
                  onClick={() => {
                    const inv = paymentModalInvoice
                    if (!inv?.id) return

                    if (paymentMode === 'manual') {
                      requestConfirm(
                        'Manuel Ödeme',
                        inv.islemTipi === 'SATIŞ'
                          ? 'Ödemenin Manuel Alındığını Onaylıyor musunuz?'
                          : 'Ödemenin Manuel Yapıldığını Onaylıyor musunuz?',
                        async () => {
                          await doSubmitManualPayment(inv)
                        },
                        'Onaylıyorum',
                        'Vazgeç',
                        'green',
                        'red'
                      )
                      return
                    }

                    void (async () => {
                      try {
                        if (paymentSource === 'cash') {
                          if (!String(selectedCashAccountId ?? '').trim()) {
                            showMessage('Uyarı', 'Lütfen kasa seçiniz')
                            return
                          }
                        }
                        if (paymentSource === 'bank') {
                          if (!String(selectedBankAccountDefinitionId ?? '').trim()) {
                            showMessage('Uyarı', 'Lütfen banka seçiniz')
                            return
                          }
                        }

                        if (paymentSource === 'pos') {
                          if (!String(selectedPosBankAccountDefinitionId ?? '').trim()) {
                            showMessage('Uyarı', 'Lütfen POS hesabı seçiniz')
                            return
                          }

                          const h = await fetchInvoiceHeader(Number(inv.id))
                          const customerCode = String((h as any)?.cariKodu ?? (h as any)?.customerCode ?? '').trim()
                          if (!customerCode) {
                            showMessage('Hata', 'Cari kodu alınamadı')
                            return
                          }

                          navigate('/pos', {
                            state: {
                              source: 'invoice_mark_paid',
                              invoiceId: Number(inv.id),
                              invoiceNo: inv.faturaNo,
                              customerCode,
                              amount: Number(String(cashReceivedAmount).replace(',', '.')) || Number(inv.genelToplam ?? 0),
                              posBankAccountDefinitionId: Number(selectedPosBankAccountDefinitionId)
                            }
                          })
                          setPaymentModalOpen(false)
                          setPaymentModalInvoice(null)
                          return
                        }

                        if (paymentMode === 'pay_with_change') {
                          const cashReceivedRaw = String(cashReceivedAmount ?? '').trim()
                          const received = Number(String(cashReceivedRaw).replace(',', '.')) || 0
                          if (!(received > 0)) {
                            showMessage('Uyarı', 'Lütfen nakit miktarı giriniz')
                            return
                          }

                          if (parsedCashReceivedInInvoiceCurrency + 0.0001 < invoiceCurrencyGrandTotal) {
                            showMessage('Uyarı', `Nakit miktar fatura tutarından (${invoiceCurrencyGrandTotal.toFixed(2)} ${invoiceCurrencyCode}) küçük olamaz`)
                            return
                          }

                          if (parsedCashReceivedInInvoiceCurrency - invoiceCurrencyGrandTotal > 0.0001) {
                            if (changeSource === 'cash') {
                              if (!String(selectedChangeCashAccountId || '').trim()) {
                                showMessage('Uyarı', 'Lütfen fazlalık ödenecek kasa seçiniz')
                                return
                              }
                            } else {
                              if (!String(selectedChangeBankAccountDefinitionId ?? '').trim()) {
                                showMessage('Uyarı', 'Lütfen fazlalık ödenecek banka seçiniz')
                                return
                              }
                            }
                          }
                        }

                        /* Para üstü hesabının TL kuru — giriş hesabıyla aynı çevrimden. */
                        const changeRateValRaw = Number(String(changeRateInput).replace(',', '.')) || 1
                        const chgCode = (changeCurrency || 'TRY').toUpperCase()
                        const docCodeForChange = (invoiceCurrencyCode || 'TRY').toUpperCase()
                        const invoiceTryRateForChange = Number(String(invoiceRateInput).replace(',', '.')) || 1
                        const chgPerInv =
                          docCodeForChange === chgCode
                            ? 1
                            : docCodeForChange === 'TRY' && chgCode !== 'TRY'
                              ? (changeRateValRaw > 0 ? 1 / changeRateValRaw : 1)
                              : (changeRateValRaw > 0 ? changeRateValRaw : 1)
                        const submitChangeRate = chgCode === 'TRY' ? 1 : (chgPerInv > 0 ? invoiceTryRateForChange / chgPerInv : 1)

                        const doSubmit = async (rate: number) => {
                          setPaymentModalBusy(true)
                          const token = localStorage.getItem('accessToken')
                          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
                          if (token) headers.Authorization = `Bearer ${token}`

                          const payload = {
                            takePaymentNow: true,
                            currencyRate: Number(rate) || 0,
                            cashReceivedAmount: (paymentMode === 'pay_with_change' || paymentMode === 'pay_now') ? parsedCashReceivedInInvoiceCurrency : null,
                            invoiceCurrencyRate: invoiceCurrencyCode !== 'TRY' ? (Number(String(invoiceRateInput).replace(',', '.')) || null) : null,
                            // Para üstü hesabının kuru da "1 hesap parası kaç TL" olarak gider.
                            changeCurrencyRate: paymentMode === 'pay_with_change' && changeAmount > 0 ? submitChangeRate : null,
                            cashAccountId: paymentSource === 'cash' ? Number(selectedCashAccountId) : null,
                            bankAccountDefinitionId: paymentSource === 'bank' ? Number(selectedBankAccountDefinitionId) : null,
                            changeCashAccountId: paymentMode === 'pay_with_change' && changeAmount > 0 && changeSource === 'cash' ? Number(selectedChangeCashAccountId) : null,
                            changeBankAccountDefinitionId: paymentMode === 'pay_with_change' && changeAmount > 0 && changeSource === 'bank' ? Number(selectedChangeBankAccountDefinitionId) : null,
                            posFee: paymentSource === 'bank' ? (Number(String(posFee ?? '0').replace(',', '.')) || 0) : null,
                            isPriceOverridden: paymentMode === 'pay_now' ? isPriceOverridden : false
                          }

                          const res = await fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(String(inv.id))}/mark-paid`, {
                            method: 'POST',
                            headers,
                            body: JSON.stringify(payload)
                          })

                          if (!res.ok) {
                            const text = await res.text()
                            showMessage('Hata', text || (inv.islemTipi === 'SATIŞ' ? 'Tahsilat kaydedilemedi' : 'Ödeme kaydedilemedi'))
                            return
                          }

                          showMessage('Başarılı', inv.islemTipi === 'SATIŞ' ? 'Tahsilat kaydedildi' : 'Ödeme kaydedildi')
                          setPaymentModalOpen(false)
                          setPaymentModalInvoice(null)
                          await reload()
                        }

                        /**
                         * Sunucuya giden `currencyRate` = 1 HESAP PARASI KAÇ TL (kasa/banka
                         * satırının kuru). Ekrandaki oran "1 fatura parası kaç hesap parası"
                         * olduğu için burada çevriliyor; eskiden ham hâliyle gidiyordu ve
                         * fatura ile hesap aynı dövizdeyken oran 1 gidip döviz kasaya TL
                         * tutar yazılıyordu.
                         */
                        const paymentRateVal = Number(String(paymentRateInput).replace(',', '.')) || 1
                        const invoiceTryRateVal = Number(String(invoiceRateInput).replace(',', '.')) || 1
                        const entryCode = accountCurrencyCode
                        const docCode = (invoiceCurrencyCode || 'TRY').toUpperCase()
                        const accPerInv =
                          docCode === entryCode
                            ? 1
                            : docCode === 'TRY' && entryCode !== 'TRY'
                              ? (paymentRateVal > 0 ? 1 / paymentRateVal : 1)
                              : (paymentRateVal > 0 ? paymentRateVal : 1)
                        const submitRate = entryCode === 'TRY' ? 1 : (accPerInv > 0 ? invoiceTryRateVal / accPerInv : 1)
                        await doSubmit(submitRate)
                      } catch {
                        showMessage('Hata', inv?.islemTipi === 'SATIŞ' ? 'Tahsilat kaydedilemedi' : 'Ödeme kaydedilemedi')
                      } finally {
                        setPaymentModalBusy(false)
                      }
                    })()
                  }}
                  className="px-3 py-2 text-xs font-semibold bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-60"
                >
                  Kaydet
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={montageOpen}
        onClose={() => {
          setMontageOpen(false)
          setMontageError(null)
          setEditingInstallationId(null)
          setIsAddingNewMontage(false)
        }}
        title={`Montaj Yönetimi - ${montageInvoiceLine?.stockCode || 'Kalem'}`}
        footer={null}
        scrollable
      >
        {montageLoading ? (
          <div className="py-8 text-center text-sm font-medium text-slate-500">Montaj bilgileri yükleniyor...</div>
        ) : (
          <div className="space-y-5">
            {/* Header info banner */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="font-medium text-slate-500">Ürün: </span>
                <span className="font-semibold text-slate-800">{montageInvoiceLine?.stockCode} - {montageInvoiceLine?.description}</span>
              </div>
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-slate-500">Kalem Miktarı: </span>
                  <span className="font-bold text-slate-900">{montageLineQuantity} Adet</span>
                </div>
                <div>
                  <span className="text-slate-500">Montaj Girilen: </span>
                  <span className="font-bold text-blue-600">
                    {montageInstallations.reduce((sum, i) => sum + Number(i.quantity || 0), 0)} / {montageLineQuantity} Adet
                  </span>
                </div>
              </div>
            </div>

            {montageError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-md font-medium">
                {montageError}
              </div>
            )}

            {/* List of installations */}
            {montageInstallations.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Kayıtlı Montaj Adresleri</h4>
                <div className="overflow-x-auto border border-slate-200 rounded-lg shadow-sm">
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="bg-slate-50 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                      <tr>
                        <th className="px-3.5 py-2 text-left">Müşteri</th>
                        <th className="px-3.5 py-2 text-left">Telefon</th>
                        <th className="px-3.5 py-2 text-left">Adres / Bölge</th>
                        <th className="px-3.5 py-2 text-center">Adet</th>
                        <th className="px-3.5 py-2 text-center">Durum</th>
                        <th className="px-3.5 py-2 text-center">Aksiyon</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-150">
                      {montageInstallations.map((inst) => (
                        <tr key={inst.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-3.5 py-2.5 font-bold text-slate-800 align-middle">
                            {inst.installationName || 'Müşteri Belirtilmedi'}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-600 align-middle">
                            {inst.installationPhone || '-'}
                          </td>
                          <td className="px-3.5 py-2.5 text-slate-600 align-middle">
                            <div>{inst.address}</div>
                            <div className="text-[10px] text-slate-400 font-medium">{inst.region} {inst.dealerDescription && <span className="italic">({inst.dealerDescription})</span>}</div>
                          </td>
                          <td className="px-3.5 py-2.5 text-center align-middle font-bold text-slate-900">
                            <span className="px-2 py-0.5 text-[11px] font-bold bg-blue-100 text-blue-800 rounded">
                              {inst.quantity}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-center align-middle">
                            <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                              inst.status === 'Pasif / Geri Alındı' || inst.status === 'Pasif / İptal'
                                ? 'bg-amber-100 text-amber-800' 
                                : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {inst.status || 'Yeni Kayıt'}
                            </span>
                          </td>
                          <td className="px-3.5 py-2.5 text-center align-middle">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => startEditMontage(inst)}
                                className="px-2 py-1 text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition"
                              >
                                Düzenle
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteMontageRecord(inst.id)}
                                className="px-2 py-1 text-[11px] font-semibold bg-red-50 hover:bg-red-100 text-red-600 rounded transition"
                              >
                                Sil
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Kalemi tamamen montajsız hale getirir; tek tek silmeye gerek kalmasın. */}
                {!isAddingNewMontage && !editingInstallationId && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void removeAllMontageFromLine()}
                      disabled={montageSaving}
                      className="px-3 py-1.5 text-[11px] font-bold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg transition disabled:opacity-50"
                      title="Bu kalemdeki tüm montajları kaldır — kalem montajsız olur, bayi tarafından da silinir"
                    >
                      Montajı Kaldır
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Button to add new montage address */}
            {!isAddingNewMontage && !editingInstallationId && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={startAddNewMontage}
                  className="w-full py-2.5 px-4 text-xs font-bold bg-blue-50 border border-dashed border-blue-300 text-blue-700 hover:bg-blue-100 rounded-lg flex items-center justify-center gap-2 transition"
                >
                  <span>+ Yeni Montaj Adresi Ekle</span>
                  {montageLineQuantity - montageInstallations.reduce((sum, i) => sum + Number(i.quantity || 0), 0) > 0 && (
                    <span className="px-2 py-0.5 bg-blue-200 text-blue-900 rounded-full text-[10px]">
                      Kalan: {montageLineQuantity - montageInstallations.reduce((sum, i) => sum + Number(i.quantity || 0), 0)} Adet
                    </span>
                  )}
                </button>
              </div>
            )}

            {/* Add / Edit Form */}
            {(isAddingNewMontage || editingInstallationId) && (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    {editingInstallationId ? 'Montaj Kaydını Düzenle' : 'Yeni Montaj Adresi Ekle'}
                  </h4>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingNewMontage(false)
                      setEditingInstallationId(null)
                    }}
                    className="text-xs text-slate-500 hover:text-slate-700 font-medium"
                  >
                    Vazgeç
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <FormInput label="Bayi Adı" value={montageForm.dealerName} disabled onChange={() => { }} />
                  </div>
                  <div>
                    <FormInput
                      label="Montaj Adedi"
                      requiredMark
                      type="number"
                      placeholder="1"
                      value={String(montageForm.quantity)}
                      onChange={(e) => setMontageForm((p) => ({ ...p, quantity: Math.max(1, Number(e.target.value)) }))}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <FormInput
                      label="Müşteri İsim Soyisim"
                      requiredMark
                      placeholder="Ad Soyad"
                      value={montageForm.installationName}
                      onChange={(e) => setMontageForm((p) => ({ ...p, installationName: e.target.value.toLocaleUpperCase('tr-TR') }))}
                    />
                  </div>

                  <div>
                    <FormInput
                      label="Telefon"
                      requiredMark
                      placeholder="0555 555 5555 555"
                      maxLength={PHONE_MAX_LENGTH}
                      value={montageForm.installationPhone}
                      onChange={(e) => setMontageForm((p) => ({ ...p, installationPhone: formatPhoneNumber(e.target.value) }))}
                    />
                  </div>

                  <div className="md:col-span-3">
                    <FormInput
                      label="Teslimat / Montaj Adresi"
                      requiredMark
                      placeholder="Açık adres bilgisi"
                      value={montageForm.address}
                      onChange={(e) => setMontageForm((p) => ({ ...p, address: e.target.value.toLocaleUpperCase('tr-TR') }))}
                    />
                  </div>

                  <div className="md:col-span-3">
                    <FormSelect
                      label="Bölge"
                      requiredMark
                      defaultValue={montageForm.region}
                      options={[
                        { value: '', label: 'Seçiniz...' },
                        { value: 'Lefkoşa', label: 'Lefkoşa' },
                        { value: 'Gazimağusa', label: 'Gazimağusa' },
                        { value: 'Girne', label: 'Girne' },
                        { value: 'Güzelyurt', label: 'Güzelyurt' },
                        { value: 'İskele', label: 'İskele' },
                        { value: 'Lefke', label: 'Lefke' }
                      ]}
                      onChange={(e) => setMontageForm((p) => ({ ...p, region: String((e as any)?.target?.value ?? '') }))}
                    />
                  </div>

                  <div className="md:col-span-3">
                    <FormInput
                      label="Bayi Açıklama / Not"
                      placeholder="Açıklama veya montaj notu"
                      value={montageForm.dealerDescription}
                      onChange={(e) => setMontageForm((p) => ({ ...p, dealerDescription: e.target.value.toLocaleUpperCase('tr-TR') }))}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingNewMontage(false)
                      setEditingInstallationId(null)
                    }}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded"
                  >
                    Vazgeç
                  </button>
                  <button
                    type="button"
                    disabled={montageSaving || !montageForm.installationName.trim() || !montageForm.installationPhone.trim() || !montageForm.address.trim() || !montageForm.region.trim()}
                    onClick={() => void saveMontage()}
                    className="px-5 py-2 text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 rounded shadow-sm transition"
                  >
                    {montageSaving ? 'KAYDEDİLİYOR...' : 'KAYDET'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={msgOpen}
        onClose={() => setMsgOpen(false)}
        title={msgTitle || 'Bilgi'}
        footer={
          <button
            type="button"
            onClick={() => setMsgOpen(false)}
            className="px-3 py-2 text-xs font-semibold bg-gray-700 text-white rounded hover:bg-gray-800"
          >
            Tamam
          </button>
        }
      >
        <div className="text-xs text-gray-700 whitespace-pre-line">{msgText}</div>
      </Modal>

      <Modal
        isOpen={confirmOpen}
        onClose={() => {
          if (confirmBusy) return
          setConfirmOpen(false)
          setConfirmAction(null)
        }}
        containerClassName="max-w-md"
        title={confirmTitle || 'Onay'}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={confirmBusy}
              onClick={() => {
                setConfirmOpen(false)
                setConfirmAction(null)
              }}
              className={`px-4 py-2 text-xs font-semibold rounded disabled:opacity-60 transition-colors ${confirmCancelColor === 'red'
                  ? 'bg-red-600 text-white hover:bg-red-700 shadow-sm'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
            >
              {confirmCancelText}
            </button>
            <button
              type="button"
              disabled={confirmBusy || !confirmAction}
              onClick={() => {
                if (!confirmAction) return
                void (async () => {
                  try {
                    await confirmAction()
                  } finally {
                    setConfirmOpen(false)
                    setConfirmAction(null)
                  }
                })()
              }}
              className={`px-4 py-2 text-xs font-semibold rounded disabled:opacity-60 transition-colors ${confirmOkColor === 'green'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
                  : 'bg-red-600 text-white hover:bg-red-700 shadow-sm'
                }`}
            >
              {confirmBusy ? 'İşleniyor...' : confirmOkText}
            </button>
          </div>
        }
      >
        <div className="py-1 flex items-start gap-3">
          {confirmOkColor === 'green' ? (
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-full shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          ) : (
            <div className="p-2 bg-red-50 text-red-600 rounded-full shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
          )}
          <div className="text-sm font-medium text-gray-700 pt-1.5 whitespace-pre-line leading-relaxed">{confirmText}</div>
        </div>
      </Modal>

      {/* CARİ EKSTRE — cari adına tıklayınca özet ekstre; "Tam ekstre" tam sayfaya gider. */}
      <CariEkstreModal open={ekstreOpen} cari={ekstreCari} onClose={() => setEkstreOpen(false)} />

    </div>
  )
}

function buildInvoicePrintHtml(
  invoice: any,
  lines: any[],
  customer: any | null,
  invoiceType: string,
  invoiceHeader: any
) {
  const formatNum = (v: number) => {
    return Number(v ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const convertNumberToTurkishWords = (num: number, currencyCode?: string): string => {
    const code = String(currencyCode ?? 'TRY').trim().toUpperCase();
    let mainUnit = "TL";
    let subUnit = "KR";
    if (code === 'USD') { mainUnit = "AMERİKAN DOLARI"; subUnit = "CENT"; }
    else if (code === 'EUR') { mainUnit = "EURO"; subUnit = "CENT"; }
    else if (code === 'GBP') { mainUnit = "STERLİN"; subUnit = "PENİ"; }
    else if (code === 'TRY' || code === 'TL') { mainUnit = "TÜRK LİRASI"; subUnit = "KURUŞ"; }

    const units = ["", "BİR", "İKİ", "ÜÇ", "DÖRT", "BEŞ", "ALTI", "YEDİ", "SEKİZ", "DOKUZ"];
    const tens = ["", "ON", "YİRMİ", "OTUZ", "KIRK", "ELLİ", "ALTMIŞ", "YETMİŞ", "SEKSEN", "DOKSAN"];
    const thousands = ["", "BİN", "MİLYON", "MİLYAR", "TRİLYON"];

    const readGroup = (n: number): string => {
      let str = "";
      const h = Math.floor(n / 100);
      const t = Math.floor((n % 100) / 10);
      const u = n % 10;

      if (h > 0) {
        if (h === 1) str += "YÜZ";
        else str += units[h] + " " + "YÜZ";
      }

      if (t > 0) {
        if (str) str += " ";
        str += tens[t];
      }

      if (u > 0) {
        if (str) str += " ";
        str += units[u];
      }

      return str;
    };

    if (num === 0) return `SIFIR ${mainUnit} SIFIR ${subUnit}`;

    const parts = num.toFixed(2).split(".");
    const lira = parseInt(parts[0], 10);
    const kurus = parseInt(parts[1], 10);

    let liraStr = "";
    if (lira === 0) {
      liraStr = "SIFIR";
    } else {
      let temp = lira;
      let groupIdx = 0;
      const groups: string[] = [];

      while (temp > 0) {
        const groupVal = temp % 1000;
        if (groupVal > 0) {
          let groupStr = readGroup(groupVal);
          if (groupIdx === 1 && groupVal === 1) {
            groupStr = "BİN";
          } else if (thousands[groupIdx]) {
            groupStr += " " + thousands[groupIdx];
          }
          groups.unshift(groupStr);
        }
        temp = Math.floor(temp / 1000);
        groupIdx++;
      }
      liraStr = groups.join(" ");
    }

    let kurusStr = "";
    if (kurus > 0) {
      kurusStr = readGroup(kurus) + " " + subUnit;
    } else {
      kurusStr = "SIFIR " + subUnit;
    }

    return `${liraStr} ${mainUnit} ${kurusStr}`.replace(/\s+/g, ' ').trim();
  };

  const custName = customer?.name || invoice.cariAdi || '';
  const custAddress = customer?.address || '';
  const custDistrict = customer?.district || '';
  const custCity = customer?.city || '';
  const custTaxOffice = customer?.taxOffice || '';
  const custTaxNumber = customer?.taxNumber || customer?.identityNumber || '';

  const cleanCariAdi = custName.replace(/^\[[^\]]+\]\s*/, '').replace(/^\([^)]+\)\s*/, '');

  const customerHeaderHtml = `
    <div class="customer-name">${cleanCariAdi}</div>
    ${custAddress ? `<div>${custAddress}</div>` : ''}
    ${(custDistrict || custCity) ? `<div>${[custDistrict, custCity].filter(Boolean).join('/')}</div>` : ''}
    ${(custTaxOffice || custTaxNumber) ? `<div>VERGİ DAİRESİ : ${custTaxOffice || '—'} &nbsp;&nbsp;&nbsp; VERGİ NO : ${custTaxNumber || '—'}</div>` : ''}
  `;

  const stampHtml = invoiceType === 'FATURA'
    ? `
      <div class="stamp-box">
        DEMO TİCARET LİMİTED<br>
        Örnek Mah. Demo Cad. No:1 - Lefkoşa<br>
        Şube: Örnek Sok. No:2<br>
        99010 Lefkoşa - KKTC<br>
        T:+90 850 000 00 00 - V.D.: Demo V.N.: 0000000
      </div>
    `
    : '';

  const isIade = String(invoice.islemTipi ?? '').trim().toUpperCase() === 'İADE';
  const documentTitle = isIade ? 'İADE SATIŞ FATURASI' : 'FATURA';

  const linesHtml = lines.map((l) => {
    const stockCode = l.stockCode || '';
    const barcode = l.barcode || '';
    let name = l.stockName || '';
    const isGift = Boolean(l.isGift || (l.description && l.description.toLowerCase().includes('hediye')));
    if (isGift && !name.toLowerCase().includes('hediye')) {
      name = `${name} (Hediye Ürün)`;
    }
    const vat = isGift ? '% 0' : `% ${Math.round(l.vatRate || 0)}`;
    const qty = `${formatNum(l.quantity)} AD`;

    const curTypeId = Number(l.currencyTypeId ?? invoice.currencyTypeId ?? 1);
    const code = curTypeId === 2 ? 'EUR' : (curTypeId === 3 ? 'USD' : (curTypeId === 4 ? 'GBP' : 'TRY'));
    
    const lineQty = Number(l.quantity || 1);
    const unitPriceVal = isGift ? 0.01 : Number(curTypeId > 1 && l.currencyUnitPrice > 0 ? l.currencyUnitPrice : (l.unitPrice || 0));
    const lineTotalVal = isGift ? (0.01 * lineQty) : Number(curTypeId > 1 && l.currencyUnitPrice > 0 ? (l.currencyUnitPrice * lineQty) : (l.total || 0));

    const price = curTypeId > 1 ? `${unitPriceVal.toFixed(2)} ${code}` : formatNum(unitPriceVal);
    const total = curTypeId > 1 ? `${lineTotalVal.toFixed(2)} ${code}` : formatNum(lineTotalVal);

    return `
      <tr>
        <td class="center">${stockCode}</td>
        <td class="center">${barcode}</td>
        <td class="left">${name}</td>
        <td class="center">${vat}</td>
        <td class="center">${qty}</td>
        <td class="right">${price}</td>
        <td class="right">${total}</td>
      </tr>
    `;
  }).join('');

  const vatGroups: Record<number, { base: number; amount: number }> = {};

  lines.forEach((l) => {
    if (Boolean(l.isGift)) return;
    const r = Math.round(l.vatRate || 0);
    if (r > 0 && !vatGroups[r]) {
      vatGroups[r] = { base: 0, amount: 0 };
    }
  });

  const grossBaseByRate: Record<number, number> = {};
  lines.forEach((l) => {
    if (Boolean(l.isGift)) return;
    const r = Math.round(l.vatRate || 0);
    const total = Number(l.total ?? 0);
    grossBaseByRate[r] = (grossBaseByRate[r] || 0) + total;
  });

  const brut = Number(invoice.brutTutar ?? 0);
  const net = Number(invoice.netTutar ?? 0);
  const ratio = brut > 0 ? net / brut : 1.0;

  Object.keys(grossBaseByRate).forEach((rateKeyStr) => {
    const rateKey = Number(rateKeyStr);
    const gross = grossBaseByRate[rateKey];
    const netBase = gross * ratio;
    const vatAmt = netBase * (rateKey / 100);

    if (!vatGroups[rateKey]) {
      vatGroups[rateKey] = { base: 0, amount: 0 };
    }
    vatGroups[rateKey].base = netBase;
    vatGroups[rateKey].amount = vatAmt;
  });

  const sortedRates = Object.keys(vatGroups)
    .map(Number)
    .sort((a, b) => b - a);

  let vatBreakdownHtml = '';
  sortedRates.forEach((rate) => {
    const g = vatGroups[rate];
    vatBreakdownHtml += `
      <tr>
        <td class="label">(${formatNum(g.base)}) K.D.V. (% ${rate},00)</td>
        <td class="value">${formatNum(g.amount)}</td>
      </tr>
    `;
  });

  let montajText = '';
  for (const line of lines) {
    if (line.installationName) {
      montajText = line.installationName;
      break;
    }
    if (line.description && line.description.toUpperCase().includes('MONTAJ :')) {
      const parts = line.description.split(':');
      if (parts.length > 1) {
        montajText = parts.slice(1).join(':').trim();
        break;
      }
    }
    if (line.description && line.description.toUpperCase().includes('MONTAJ')) {
      montajText = line.description.trim();
      break;
    }
  }

  const curTypeId = Number(invoice.currencyTypeId ?? invoiceHeader?.currencyTypeId ?? 1);
  const printCurrencyCode = curTypeId === 2 ? 'EUR' : (curTypeId === 3 ? 'USD' : (curTypeId === 4 ? 'GBP' : 'TRY'));

  const plasiyerText = invoice.plasiyer ? `${invoice.plasiyer} TESLİM ALAN  #` : '';
  const noteText = invoiceHeader?.description || '';
  const ibanHtml = invoiceType === 'FATURA'
    ? `<div style="font-weight: bold; margin-top: 12px; font-size: 11px;">DEMO BANKA : TR00 0000 0000 0000 0000 0000 00</div>`
    : '';

  return `
    <!DOCTYPE html>
    <html lang="tr">
    <head>
      <meta charset="UTF-8">
      <title>${documentTitle} - ${invoice.faturaNo}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        body {
          font-family: 'Inter', sans-serif;
          margin: 0;
          padding: 20px;
          color: #000;
          background-color: #fff;
          font-size: 11px;
        }
        .print-container {
          max-width: 800px;
          margin: 0 auto;
        }
        .header-section {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 25px;
        }
        .customer-info {
          width: 55%;
          line-height: 1.5;
        }
        .customer-name {
          font-weight: 700;
          font-size: 13px;
          margin-bottom: 4px;
        }
        .stamp-area {
          width: 25%;
          text-align: center;
        }
        .stamp-box {
          border: 1px dashed #000;
          padding: 6px;
          font-size: 9px;
          line-height: 1.3;
        }
        .meta-info {
          width: 20%;
          text-align: right;
          line-height: 1.6;
          font-size: 11px;
        }
        .document-title {
          text-align: center;
          font-size: 16px;
          font-weight: 700;
          letter-spacing: 1px;
          margin: 15px 0;
          padding-bottom: 5px;
          border-bottom: 2px solid #000;
        }
        .details-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 15px;
        }
        .details-table th, .details-table td {
          border: 1px solid #000;
          padding: 5px 6px;
          font-size: 10px;
        }
        .details-table th {
          background-color: #f3f4f6;
          font-weight: 700;
          text-align: center;
        }
        .details-table td.center { text-align: center; }
        .details-table td.left { text-align: left; }
        .details-table td.right { text-align: right; }
        
        .footer-section {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-top: 15px;
        }
        .footer-left {
          width: 50%;
          line-height: 1.6;
        }
        .footer-right {
          width: 45%;
        }
        .totals-table {
          width: 100%;
          border-collapse: collapse;
        }
        .totals-table td {
          border: 1px solid #000;
          padding: 4px 8px;
          font-size: 10px;
        }
        .totals-table td.label {
          font-weight: 600;
          background-color: #f3f4f6;
          text-align: left;
        }
        .totals-table td.value {
          text-align: right;
        }
        @media print {
          body {
            padding: 0;
            background-color: white !important;
            color: black !important;
          }
          @page {
            size: A4;
            margin: 15mm 10mm;
          }
          tr {
            page-break-inside: avoid;
          }
          .header-section, .details-table, .footer-section {
            page-break-inside: avoid;
          }
        }
      </style>
    </head>
    <body>
      <div class="print-container">
        <div class="header-section">
          <div class="customer-info">
            ${customerHeaderHtml}
          </div>
          <div class="stamp-area">
            ${stampHtml}
          </div>
          <div class="meta-info">
            <div><strong>TARİH :</strong> ${invoice.tarih}</div>
            <div><strong>NO :</strong> ${invoice.faturaNo}</div>
          </div>
        </div>

        <div class="document-title">${documentTitle}</div>

        <table class="details-table">
          <thead>
            <tr>
              <th style="width: 15%;">STOK KODU</th>
              <th style="width: 15%;">BARKOD</th>
              <th style="width: 35%;">AÇIKLAMA</th>
              <th style="width: 8%;">KDV</th>
              <th style="width: 9%;">MİKTAR</th>
              <th style="width: 9%;">FİYAT</th>
              <th style="width: 9%;">TOPLAM</th>
            </tr>
          </thead>
          <tbody>
            ${linesHtml}
          </tbody>
        </table>

        <div class="footer-section">
          <div class="footer-left">
            ${plasiyerText ? `<div>${plasiyerText}</div>` : ''}
            <div><strong>YALNIZ :</strong> ${convertNumberToTurkishWords(invoice.genelToplam, printCurrencyCode).toUpperCase()}</div>
            ${montajText ? `<div style="font-weight: bold; margin-top: 4px;">MONTAJ : ${montajText.toUpperCase()}</div>` : ''}
            <div style="margin-top: 4px;"><strong>NOT :</strong> ${noteText}</div>
            ${ibanHtml}
          </div>
          <div class="footer-right">
            <table class="totals-table">
              <tbody>
                <tr>
                  <td class="label">BRÜT TUTAR</td>
                  <td class="value">${formatNum(invoice.brutTutar)}</td>
                </tr>
                <tr>
                  <td class="label">İNDİRİM</td>
                  <td class="value">${formatNum(invoice.iskonto)}</td>
                </tr>
                <tr>
                  <td class="label">NET TOPLAM</td>
                  <td class="value">${formatNum(invoice.netTutar)}</td>
                </tr>
                ${vatBreakdownHtml}
                <tr>
                  <td class="label">TOPLAM K.D.V.</td>
                  <td class="value">${formatNum(invoice.kdvTutari)}</td>
                </tr>
                <tr style="font-weight: bold; background-color: #e5e7eb;">
                  <td class="label" style="background-color: #d1d5db;">GENEL TOPLAM</td>
                  <td class="value" style="background-color: #d1d5db;">${formatNum(invoice.genelToplam)}</td>
                </tr>
              </tbody>
            </table>
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
  `;
}

