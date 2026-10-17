import React, { useEffect, useMemo, useRef, useState } from 'react'
import { fetchAllPages } from '../lib/fetchAllPages'
import { normalizeDiscountType } from '../utils/discountType'
import { PHONE_MAX_LENGTH, formatPhoneNumber } from '../utils/phone'
import { ChevronDown, ChevronRight, Eye, Pencil, Plus, Printer, Search, Trash2 } from 'lucide-react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { fetchLatestFxRate } from '../api/fx'
import { API_BASE_URL } from '../config/api'
import Modal from '../components/Modal'
import PageHeader from '../components/PageHeader'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import SearchableCariSelect from '../components/SearchableCariSelect'
import ColumnFilterSearchBar from '../components/table/ColumnFilterSearchBar'
import { fetchSalesmenDropdown, type SalesmanDropdownItem } from '../api/salesmen'
import {
  createCariOffer,
  deleteCariOffer,
  deleteCariProformaFromOffer,
  fetchCariOfferCustomersDropdown,
  fetchCariOffers,
  fetchCariProformaOffers,
  fetchNewCariOfferDocumentNo,
  fetchNextBayiMuhtelifCustomerCode,
  getCariOffer,
  transferCariOfferToProforma,
  transferCariProformaToInvoice,
  updateCariOffer,
  updateCariProformaHeader,
  type CariOfferListItemDto,
  type CustomerDropdownItemDto
} from '../api/cariOffers'
import { fetchProductCategoriesStateForDealer, type ProductCategoryStateResponse } from '../api/productCategories'
import { fetchProducts } from '../api/products'
import { fetchProductPricesByProducts, type ProductPriceResponse } from '../api/productPrices'
import { fetchPriceGroups, type PriceGroupDto } from '../api/priceGroups'
import { resolveMuhtelifPriceGroupId } from '../utils/muhtelifPricing'
import { printProforma } from '../utils/proformaPrint'
import { AppDataTable, type DataTableRowAction } from '../components/data-table'
import type { ColumnDef } from '@tanstack/react-table'

type LayoutContext = {
  isSuperAdmin?: boolean
  allowedKeys?: Set<string>
}

type DiscountType = 'none' | 'amount' | 'percentage'

type OfferLine = {
  id: string
  productId?: string
  stockCode: string
  stockName: string
  quantity: number
  unitPrice: number
  price3?: number
  discountType: DiscountType
  discountValue: number
  vatRate: number
  currencyCode?: any
}

type CariOffer = {
  id: number | string
  date: string
  documentNo: string
  customerCode: string
  customerName: string
  description: string
  vatExempt: boolean
  createUser?: string
  proformaDocumentNo?: string | null
  invoiceId?: number | null
  invoiceNo?: string | null
  currencyTypeId?: number
  currencyCode?: string
  lines: OfferLine[]
}

type ColumnKey = 'date' | 'documentNo' | 'customerCode' | 'customerName' | 'description' | 'vatExempt' | 'createUser'

function formatMoney(n: number) {
  const v = Number(n ?? 0)
  return `₺${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function getCurrencySymbol(code: any) {
  const c = String(code ?? '').trim()
  if (c === '0' || c === '1' || c === 'TRY' || c === 'TL' || !c) return '₺'
  if (c === '3' || c === 'USD') return '$'
  if (c === '2' || c === 'EUR') return '€'
  if (c === '4' || c === 'GBP') return '£'
  return c
}

function formatMoneyWithCurrency(n: number, code: any) {
  const v = Number(n ?? 0)
  const sym = getCurrencySymbol(code)
  return `${sym}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function getInvoiceCurrency(lines: any[]) {
  const arr = Array.isArray(lines) ? lines : []
  if (arr.length === 0) return '0'
  const currencies = new Set<string>()
  for (const l of arr) {
    const cur = String(l.currencyCode ?? l.CurrencyCode ?? '0')
    currencies.add(cur)
  }
  if (currencies.size === 1) {
    return Array.from(currencies)[0]
  }
  if (currencies.has('0') || currencies.has('TRY') || currencies.has('TL')) {
    return '0'
  }
  const firstLineCur = String(arr[0]?.currencyCode ?? arr[0]?.CurrencyCode ?? '0')
  return firstLineCur
}

function calcInvoiceTotalsWithConversion(lines: any[], vatExempt: boolean, targetCurrency: string, fxRates: Record<string, number>) {
  let subTotal = 0
  let discountTotal = 0
  let netTotal = 0
  let vatTotal = 0

  const targetRate = fxRates[targetCurrency] || 1

  const arr = Array.isArray(lines) ? lines : []
  for (const l of arr) {
    const qty = Number(l.quantity ?? 0)
    const originalPrice = Number(l.unitPrice ?? 0)
    const lineCurrency = String(l.currencyCode ?? l.CurrencyCode ?? '0')

    const sourceRate = fxRates[lineCurrency] || 1
    const tryPrice = originalPrice * sourceRate
    const price = targetRate > 0 ? tryPrice / targetRate : 0

    const base = qty * price

    const dv = Number(l.discountValue ?? 0)
    let discount = 0
    if (normalizeDiscountType(l.discountType) === 'amount') {
      // Tutar indirimi ADET BAŞINA (2026-08-22): satırın tamamına değil her ürüne uygulanır.
      const tryDiscountValue = dv * sourceRate * qty
      const targetDiscountValue = targetRate > 0 ? tryDiscountValue / targetRate : 0
      discount = Math.max(0, targetDiscountValue)
    }
    if (normalizeDiscountType(l.discountType) === 'percentage') {
      discount = Math.max(0, (base * dv) / 100)
    }
    discount = Math.min(discount, base)

    const net = base - discount
    const vatRate = Math.max(0, Number(l.vatRate ?? 0))
    const vatAmount = (vatExempt || vatRate === 0) ? 0 : (net * vatRate) / 100

    subTotal += base
    discountTotal += discount
    netTotal += net
    vatTotal += vatAmount
  }

  const grandTotal = vatExempt ? netTotal : netTotal + vatTotal

  return { subTotal, discountTotal, netTotal, vatTotal, grandTotal }
}

function isAbortError(e: any) {
  if (!e) return false
  const name = String(e?.name ?? '')
  const msg = String(e?.message ?? '')
  return name === 'AbortError' || msg.toLowerCase().includes('aborted')
}

function safeNumber(v: any, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function trimId(value: any) {
  return String(value ?? '').trim()
}

function calcLineTotals(line: OfferLine, vatExempt: boolean) {
  const qty = safeNumber(line.quantity ?? 0)
  const price = safeNumber(line.unitPrice ?? 0)
  const base = qty * price

  const dv = safeNumber(line.discountValue ?? 0)
  let discount = 0
  if (line.discountType === 'amount') discount = Math.max(0, dv)
  if (line.discountType === 'percentage') discount = Math.max(0, (base * dv) / 100)
  discount = Math.min(discount, base)

  const net = base - discount
  const vatRate = Math.max(0, safeNumber(line.vatRate ?? 0))
  const vatAmount = (vatExempt || vatRate === 0) ? 0 : (net * vatRate) / 100
  const total = net + vatAmount

  return { base, discount, net, vatAmount, total }
}

function calcOfferTotals(offer: Pick<CariOffer, 'lines' | 'vatExempt'>) {
  let subTotal = 0
  let discountTotal = 0
  let netTotal = 0
  let vatTotal = 0

  for (const l of offer.lines) {
    const t = calcLineTotals(l, offer.vatExempt)
    subTotal += t.base
    discountTotal += t.discount
    netTotal += t.net
    vatTotal += t.vatAmount
  }

  if (!Number.isFinite(subTotal) || subTotal < 0) subTotal = 0
  if (!Number.isFinite(discountTotal) || discountTotal < 0) discountTotal = 0
  if (!Number.isFinite(netTotal) || netTotal < 0) netTotal = 0
  if (!Number.isFinite(vatTotal) || vatTotal < 0) vatTotal = 0

  const grandTotal = offer.vatExempt ? netTotal : netTotal + vatTotal

  return { subTotal, discountTotal, netTotal, vatTotal, grandTotal }
}

function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`
}

function createEmptyLine(): OfferLine {
  return {
    id: createId('line'),
    productId: undefined,
    stockCode: '',
    stockName: '',
    quantity: 1,
    unitPrice: 0,
    discountType: 'none',
    discountValue: 0,
    vatRate: 0,
    currencyCode: '0'
  }
}

function createEmptyOffer(): CariOffer {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')

  return {
    id: 0,
    date: `${yyyy}-${mm}-${dd}`,
    documentNo: '',
    customerCode: '',
    customerName: '',
    description: '',
    vatExempt: false,
    createUser: '',
    currencyTypeId: 1,
    currencyCode: 'TRY',
    proformaDocumentNo: null,
    invoiceId: null,
    invoiceNo: null,
    lines: [createEmptyLine()]
  }
}

function stripCariSubAccountCode(code: string) {
  return String(code ?? '').trim().replace(/-(?:1|2|3)$/u, '')
}

function uniqueMainCustomers<T extends { customerCode?: string | null; name?: string | null }>(items: T[]): T[] {
  const byCode = new Map<string, T>()
  for (const item of items ?? []) {
    const rawCode = String(item?.customerCode ?? '').trim()
    if (!rawCode) continue
    const mainCode = stripCariSubAccountCode(rawCode)
    const next = { ...item, customerCode: mainCode } as T
    const existing = byCode.get(mainCode)
    if (!existing || rawCode === mainCode) byCode.set(mainCode, next)
  }
  return Array.from(byCode.values())
}

const currencyOptions = [
  { value: '1', label: 'TL (₺)' },
  { value: '3', label: 'USD ($)' },
  { value: '2', label: 'EUR (€)' },
  { value: '4', label: 'GBP (£)' }
]

function formatNumberTr(n: number) {
  const v = Number(n ?? 0)
  return v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDateTr(dateStr: string) {
  if (!dateStr) return ''
  const clean = dateStr.split('T')[0]
  const parts = clean.split('-')
  if (parts.length === 3) {
    return `${parts[2]}.${parts[1]}.${parts[0]}`
  }
  return dateStr
}

function getProductImageUrl(img: string | null | undefined) {
  if (!img) return ''
  const s = img.trim()
  if (!s) return ''
  if (s.startsWith('http://') || s.startsWith('https://')) return s
  if (s.startsWith('/')) return `${API_BASE_URL}${s}`
  return `${API_BASE_URL}/${s}`
}

export function buildOfferHtml(dto: any, templateType: 'standard' | 'simple' | 'usd', onlyView?: boolean) {
  const dateStr = formatDateTr(dto.date)
  const teklifVeren = dto.salesmanName || dto.salesmanCode || dto.createUser || '—'
  const cityDistrict = [dto.customerDistrict, dto.customerCity].filter(Boolean).join(', ')

  const formatMoneyTemplate = (v: number) => {
    const formatted = formatNumberTr(v)
    return templateType === 'usd' ? `${formatted} $` : formatted
  }

  // Calculate totals
  let subtotal = 0
  let discountTotal = 0
  let netTotal = 0
  let vatTotal = 0

  const vatGroups: Record<number, { base: number; amount: number }> = {}

  dto.lines.forEach((l: any) => {
    const qty = l.quantity || 0
    const price = l.unitPrice || 0
    const base = qty * price
    
    // İNDİRİM TİPİ STRING OLARAK GELİYOR (2026-08-22 kullanıcı bildirimi).
    //
    // ERP API enum'ları `JsonStringEnumConverter` ile serileştiriyor (Program.cs), yani bu alan
    // sayı değil `"Amount"` / `"Percentage"` diye geliyor. Buradaki kontroller sayıyı ya da
    // KÜÇÜK harfli metni arıyordu; ikisi de tutmuyor ve indirim SESSİZCE 0 hesaplanıyordu.
    // Teklif basımında indirim satırı hep 0,00 çıkmasının sebebi buydu.
    //
    // Karşılaştırma artık büyük/küçük harf duyarsız ve sayısal biçim de kabul ediliyor:
    // uç ileride sayıya dönerse basım sessizce bozulmasın.
    const dType = typeof l.discountType === 'string' ? l.discountType.toLowerCase() : l.discountType
    let discount = 0
    if (dType === 1 || dType === 'amount') {
      // Tutar indirimi ADET BAŞINA (2026-08-22) — hesapla aynı kural.
      discount = (l.discountValue || 0) * qty
    } else if (dType === 2 || dType === 'percentage') {
      discount = (base * (l.discountValue || 0)) / 100
    }
    discount = Math.min(discount, base)
    const net = base - discount
    const vatRate = l.vatRate || 0
    const vatAmount = dto.vatExempt ? 0 : (net * vatRate) / 100

    subtotal += base
    discountTotal += discount
    netTotal += net
    vatTotal += vatAmount

    const rateKey = Math.round(vatRate)
    if (rateKey > 0) {
      if (!vatGroups[rateKey]) {
        vatGroups[rateKey] = { base: 0, amount: 0 }
      }
      vatGroups[rateKey].base += net
      vatGroups[rateKey].amount += vatAmount
    }
  })

  const grandTotal = netTotal + vatTotal

  const linesHtml = dto.lines.map((l: any) => {
    const qty = l.quantity || 0
    const price = l.unitPrice || 0
    const base = qty * price
    
    // İNDİRİM TİPİ STRING OLARAK GELİYOR (2026-08-22 kullanıcı bildirimi).
    //
    // ERP API enum'ları `JsonStringEnumConverter` ile serileştiriyor (Program.cs), yani bu alan
    // sayı değil `"Amount"` / `"Percentage"` diye geliyor. Buradaki kontroller sayıyı ya da
    // KÜÇÜK harfli metni arıyordu; ikisi de tutmuyor ve indirim SESSİZCE 0 hesaplanıyordu.
    // Teklif basımında indirim satırı hep 0,00 çıkmasının sebebi buydu.
    //
    // Karşılaştırma artık büyük/küçük harf duyarsız ve sayısal biçim de kabul ediliyor:
    // uç ileride sayıya dönerse basım sessizce bozulmasın.
    const dType = typeof l.discountType === 'string' ? l.discountType.toLowerCase() : l.discountType
    let discount = 0
    if (dType === 1 || dType === 'amount') {
      // Tutar indirimi ADET BAŞINA (2026-08-22) — hesapla aynı kural.
      discount = (l.discountValue || 0) * qty
    } else if (dType === 2 || dType === 'percentage') {
      discount = (base * (l.discountValue || 0)) / 100
    }
    discount = Math.min(discount, base)
    const net = base - discount
    const discountedPrice = qty > 0 ? net / qty : price
    const lineTotal = net

    if (templateType === 'simple') {
      return `
        <tr>
          <td style="text-align: center; vertical-align: middle;">${l.barcode || ''}</td>
          <td style="text-align: left; vertical-align: middle; font-weight: bold;">${l.stockName}</td>
          <td style="text-align: center; vertical-align: middle;">${qty}</td>
          <td style="text-align: right; vertical-align: middle;">${formatMoneyTemplate(price)}</td>
          <td style="text-align: center; vertical-align: middle;">${l.vatRate}</td>
          <td style="text-align: right; vertical-align: middle;">${formatMoneyTemplate(discountedPrice)}</td>
          <td style="text-align: right; vertical-align: middle;">${formatMoneyTemplate(lineTotal)}</td>
        </tr>
      `
    } else {
      return `
        <tr>
          <td style="text-align: center; vertical-align: middle;">
            ${l.imageUrl ? `<img src="${getProductImageUrl(l.imageUrl)}" style="max-height: 80px; max-width: 80px; object-fit: contain;" />` : ''}
          </td>
          <td style="text-align: center; vertical-align: middle;">
            <div>${l.barcode || ''}</div>
            <div style="border-top: 1px dashed #000; margin-top: 4px; padding-top: 4px;">${l.stockCode}</div>
          </td>
          <td style="text-align: left;">
            <div style="font-weight: bold; margin-bottom: 4px;">${l.stockName}</div>
            <div style="white-space: pre-wrap; font-size: 9px; line-height: 1.3; color: #333;">${l.productDescription || l.description || ''}</div>
          </td>
          <td style="text-align: center; vertical-align: middle;">${qty}</td>
          <td style="text-align: right; vertical-align: middle;">${formatMoneyTemplate(price)}</td>
          <td style="text-align: center; vertical-align: middle;">${l.vatRate}</td>
          <td style="text-align: right; vertical-align: middle;">${formatMoneyTemplate(discountedPrice)}</td>
          <td style="text-align: right; vertical-align: middle;">${formatMoneyTemplate(lineTotal)}</td>
        </tr>
      `
    }
  }).join('')

  let totalsRowsHtml = `
    <tr>
      <td class="label">ARA TOPLAM</td>
      <td class="value">${formatMoneyTemplate(subtotal)}</td>
    </tr>
    <tr>
      <td class="label">İNDİRİM</td>
      <td class="value">${formatMoneyTemplate(discountTotal)}</td>
    </tr>
    <tr>
      <td class="label">KDVSİZ TOPLAM</td>
      <td class="value">${formatMoneyTemplate(netTotal)}</td>
    </tr>
  `

  if (templateType !== 'usd') {
    const rates = Object.keys(vatGroups)
      .map(Number)
      .sort((a, b) => b - a)

    rates.forEach(rate => {
      const group = vatGroups[rate]
      totalsRowsHtml += `
        <tr>
          <td class="label">(${formatNumberTr(group.base)}) K.D.V. (% ${rate},00)</td>
          <td class="value">${formatNumberTr(group.amount)}</td>
        </tr>
      `
    })
  }

  totalsRowsHtml += `
    <tr>
      <td class="label">KDV TOPLAM</td>
      <td class="value">${formatMoneyTemplate(vatTotal)}</td>
    </tr>
    <tr>
      <td class="label" style="font-size: 11px; font-weight: bold; background-color: #f7f7f7;">GENEL TOPLAM</td>
      <td class="value" style="font-size: 11px; font-weight: bold; background-color: #f7f7f7;">${formatMoneyTemplate(grandTotal)}</td>
    </tr>
  `

  let headerTableHtml = ''
  if (templateType === 'simple') {
    headerTableHtml = `
      <table class="info-table">
        <tr>
          <th>TİCARİ ÜNVAN</th>
          <td>${dto.customerName || '—'}</td>
          <th>TARİH</th>
          <td>${dateStr}</td>
          <th style="width: 10%;">PI NO</th>
          <td style="width: 15%; font-weight: bold;">${dto.proformaDocumentNo || dto.documentNo || '—'}</td>
        </tr>
        <tr>
          <th>YETKİLİ</th>
          <td>${dto.customerName || '—'}</td>
          <th>TEKLİF VEREN</th>
          <td>${teklifVeren}</td>
          <th style="border: 1px solid #000; background-color: #fcfcfc;"></th>
          <td>${dto.proformaDocumentNo && dto.documentNo ? dto.documentNo : ''}</td>
        </tr>
        <tr>
          <th>GSM</th>
          <td>${dto.customerPhone || '—'}</td>
          <th>AÇIKLAMA</th>
          <td colspan="3">${dto.description || '—'}</td>
        </tr>
      </table>
    `
  } else {
    headerTableHtml = `
      <table class="info-table">
        <tr>
          <th>TİCARİ ÜNVAN</th>
          <td>${dto.customerName || '—'}</td>
          <th>TARİH</th>
          <td>${dateStr}</td>
        </tr>
        <tr>
          <th>YETKİLİ</th>
          <td>${dto.customerName || '—'}</td>
          <th>TEKLİF VEREN</th>
          <td>${teklifVeren}</td>
        </tr>
        <tr>
          <th>GSM</th>
          <td>${dto.customerPhone || '—'}</td>
          <th>AÇIKLAMA</th>
          <td>${dto.description || '—'}</td>
        </tr>
      </table>
    `
  }

  const termsHtml = templateType === 'usd' 
    ? `
      <div class="terms-red" style="font-size: 10px; font-weight: bold; margin-bottom: 2px;">FİYATLARA KDV DAHİL DEĞİLDİR</div>
      <div class="terms-red">FİYAT TEKLİFİ 7 GÜN GEÇERLİDİR</div>
      <div>ÜRÜNLERİMİZ 3 YIL GARANTİLİDİR</div>
      <div>TELEVİZYONLARDA ASKI APARATI VE MONTAJ DAHİL DEĞİLDİR</div>
      <div>ÖDEME ŞEKLİ PEŞİNDİR</div>
    `
    : `
      <div class="terms-red">FİYAT TEKLİFİ 7 GÜN GEÇERLİDİR</div>
      <div>ÜRÜNLERİMİZ 3 YIL GARANTİLİDİR</div>
      <div>TELEVİZYONLARDA ASKI APARATI VE MONTAJ DAHİL DEĞİLDİR</div>
      <div>ÖDEME ŞEKLİ PEŞİNDİR</div>
    `

  return `
    <!DOCTYPE html>
    <html lang="tr">
    <head>
      <meta charset="utf-8" />
      <title>Müşteri Teklifi - ${dto.proformaDocumentNo || dto.documentNo}</title>
      <style>
        @page {
          size: A4;
          margin: 10mm;
        }
        body {
          font-family: Arial, sans-serif;
          font-size: 10px;
          line-height: 1.4;
          color: #333;
          margin: 0;
          padding: 0;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 2px solid #ccc;
          padding-bottom: 8px;
          margin-bottom: 12px;
        }
        .logo-container img {
          width: 150px;
          max-height: 56px;
          object-fit: contain;
          object-position: left center;
          display: block;
        }
        .title-container {
          text-align: right;
        }
        .title-container h1 {
          font-size: 16px;
          margin: 0;
          color: #2e7d32;
        }
        .title-container div {
          font-size: 10px;
          font-weight: bold;
          margin-top: 2px;
        }
        .info-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 12px;
        }
        .info-table th {
          background-color: #f7f7f7;
          border: 1px solid #ccc;
          padding: 5px;
          font-weight: bold;
          text-align: left;
          width: 12%;
        }
        .info-table td {
          border: 1px solid #ccc;
          padding: 5px;
          text-align: left;
        }
        .lines-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 12px;
        }
        .lines-table th {
          background-color: #e0e0e0;
          border: 1px solid #999;
          padding: 6px 4px;
          font-weight: bold;
          font-size: 9px;
        }
        .lines-table td {
          border: 1px solid #999;
          padding: 4px;
        }
        .footer-section {
          display: flex;
          justify-content: space-between;
          margin-top: 12px;
        }
        .terms-box {
          width: 58%;
          border: 1px solid #ccc;
          padding: 6px;
          background-color: #fafafa;
          font-size: 8px;
          line-height: 1.5;
        }
        .terms-box div {
          margin-bottom: 2px;
        }
        .terms-red {
          color: #d32f2f;
          font-weight: bold;
        }
        .totals-table {
          width: 38%;
          border-collapse: collapse;
        }
        .totals-table td {
          border: 1px solid #ccc;
          padding: 4px 6px;
        }
        .totals-table td.label {
          text-align: left;
          font-weight: bold;
          background-color: #fcfcfc;
          width: 60%;
        }
        .totals-table td.value {
          text-align: right;
          font-weight: bold;
        }
        .signatures {
          display: flex;
          justify-content: space-between;
          margin-top: 40px;
          padding: 0 20px;
          font-weight: bold;
        }
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            margin: 0 !important;
            padding: 0 !important;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo-container">
          <img src="${dto.logoUrl ? getProductImageUrl(dto.logoUrl) : '/stilsoft-logo.png'}" onerror="this.src='/stilsoft-logo.png'" />
        </div>
        <div class="title-container">
          <h1>${templateType === 'usd' ? 'PROFORMA INVOICE' : 'FİYAT TEKLİF FORMU'}</h1>
          <div>BELGE NO: ${dto.proformaDocumentNo || dto.documentNo}</div>
        </div>
      </div>

      ${headerTableHtml}

      <table class="lines-table">
        <thead>
          <tr>
            ${templateType === 'simple' ? '' : '<th style="width: 10%;">RESİM</th>'}
            <th style="width: 15%;">BARKOD / KOD</th>
            <th>AÇIKLAMA / STOK ADI</th>
            <th style="width: 8%;">MİKTAR</th>
            <th style="width: 12%;">FİYAT</th>
            <th style="width: 6%;">KDV %</th>
            <th style="width: 12%;">İND. FİYAT</th>
            <th style="width: 12%;">TOPLAM</th>
          </tr>
        </thead>
        <tbody>
          ${linesHtml}
        </tbody>
      </table>

      <div class="footer-section">
        <div class="terms-box">
          <div style="font-weight: bold; font-size: 9px; margin-bottom: 4px; text-decoration: underline;">TEKLİF KOŞULLARI</div>
          ${termsHtml}
        </div>
        <table class="totals-table">
          <tbody>
            ${totalsRowsHtml}
          </tbody>
        </table>
      </div>

      <div class="signatures">
        <div>Müşteri İmza / Kaşe</div>
        <div>Teklifi Hazırlayan</div>
      </div>
      ${onlyView ? '' : `
      <script>
        window.onload = () => {
          setTimeout(() => {
            window.print();
          }, 350);
        };
      </script>
      `}
    </body>
    </html>
  `
}

const discountTypeOptions = [
  { value: 'none', label: 'Yok' },
  { value: 'amount', label: 'Tutar' },
  { value: 'percentage', label: 'Oran' }
]

export default function CariOfferPage() {
  const { isSuperAdmin, allowedKeys } = useOutletContext<LayoutContext>()
  const navigate = useNavigate()

  const canDuzenle =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/cariTeklifleri')) && Boolean(allowedKeys?.has('invoice/cariTeklifleriDuzenle')))

  const canSil =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/cariTeklifleri')) && Boolean(allowedKeys?.has('invoice/cariTeklifleriSil')))

  const canProformaAktar =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/cariTeklifleri')) && Boolean(allowedKeys?.has('invoice/cariTeklifleriProformaAktar')))

  const canBasim =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/cariTeklifleri')) && Boolean(allowedKeys?.has('invoice/cariTeklifleriBasim')))

  const [proformaTransferModalOpen, setProformaTransferModalOpen] = useState(false)
  const [transferredProformaId, setTransferredProformaId] = useState<number | null>(null)
  const [printMenuOpenId, setPrintMenuOpenId] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [fxRates, setFxRates] = useState<Record<string, number>>({
    'TRY': 1,
    'TL': 1,
    '0': 1,
    'USD': 1,
    '3': 1,
    'EUR': 1,
    '2': 1,
    'GBP': 1,
    '4': 1
  })

  useEffect(() => {
    void (async () => {
      try {
        const [usd, eur, gbp] = await Promise.all([
          fetchLatestFxRate('USD').catch(() => 1),
          fetchLatestFxRate('EUR').catch(() => 1),
          fetchLatestFxRate('GBP').catch(() => 1)
        ])
        setFxRates((prev) => ({
          ...prev,
          'USD': usd,
          '3': usd,
          'EUR': eur,
          '2': eur,
          'GBP': gbp,
          '4': gbp
        }))
      } catch {
        // Fallback to 1
      }
    })()
  }, [])

  const [rows, setRows] = useState<CariOffer[]>([])

  const [customersLoading, setCustomersLoading] = useState(false)
  const [customers, setCustomers] = useState<CustomerDropdownItemDto[]>([])

  const [salesmenLoading, setSalesmenLoading] = useState(false)
  const [salesmen, setSalesmen] = useState<SalesmanDropdownItem[]>([])

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [actionsOpenForId, setActionsOpenForId] = useState<string | null>(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [confirmOfferId, setConfirmOfferId] = useState<number | null>(null)

  const [msgModalOpen, setMsgModalOpen] = useState(false)
  const [msgModalTitle, setMsgModalTitle] = useState('')
  const [msgModalText, setMsgModalText] = useState('')

  const showMessage = (title: string, text: string) => {
    setMsgModalTitle(title)
    setMsgModalText(text)
    setMsgModalOpen(true)
  }

  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState(() => createEmptyOffer())
  const [editOfferId, setEditOfferId] = useState<number | null>(null)

  const [draftCustomer, setDraftCustomer] = useState('')
  const [draftSalesRep, setDraftSalesRep] = useState('')

  const [globalSearch, setGlobalSearch] = useState('')

  const [filterOps, setFilterOps] = useState<Record<ColumnKey, string>>({
    date: 'eq',
    documentNo: 'contains',
    customerCode: 'contains',
    customerName: 'contains',
    description: 'contains',
    vatExempt: 'eq',
    createUser: 'contains'
  })
  const [filters, setFilters] = useState<Record<ColumnKey, { v1: string; v2: string }>>({
    date: { v1: '', v2: '' },
    documentNo: { v1: '', v2: '' },
    customerCode: { v1: '', v2: '' },
    customerName: { v1: '', v2: '' },
    description: { v1: '', v2: '' },
    vatExempt: { v1: '', v2: '' },
    createUser: { v1: '', v2: '' }
  })

  const setFilterV1 = (key: ColumnKey, v: string) => {
    setFilters((p) => ({ ...p, [key]: { v1: v, v2: p[key]?.v2 ?? '' } }))
  }

  const setFilterV2 = (key: ColumnKey, v: string) => {
    setFilters((p) => ({ ...p, [key]: { v1: p[key]?.v1 ?? '', v2: v } }))
  }

  const [activeFilterKey, setActiveFilterKey] = useState<string | null>(null)
  const [selectedValues, setSelectedValues] = useState<Record<string, string[]>>({})
  const [draftValues, setDraftValues] = useState<Record<string, string[]>>({})
  const filterPanelRef = React.useRef<HTMLDivElement | null>(null)

  const [muhtelifForm, setMuhtelifForm] = useState(() => ({
    customerCode: '',
    name: '',
    city: '',
    district: '',
    address: '',
    phone: '',
    email: '',
    taxOffice: '',
    taxNumber: ''
  }))

  const muhtelifCodeRef = useRef('')
  useEffect(() => {
    muhtelifCodeRef.current = String(muhtelifForm.customerCode ?? '')
  }, [muhtelifForm.customerCode])

  const [productPickerOpen, setProductPickerOpen] = useState(false)
  const [productPickerForLineId, setProductPickerForLineId] = useState<string | null>(null)
  const [productPickerLoading, setProductPickerLoading] = useState(false)
  const [productPickerError, setProductPickerError] = useState<string | null>(null)
  const [productPickerQuery, setProductPickerQuery] = useState('')
  const [productPickerItems, setProductPickerItems] = useState<any[]>([])

  const [activeSearchLineId, setActiveSearchLineId] = useState<string | null>(null)
  const [lineSearchQueries, setLineSearchQueries] = useState<Record<string, string>>({})
  const [lineSearchResults, setLineSearchResults] = useState<Record<string, any[]>>({})
  const [lineSearchLoading, setLineSearchLoading] = useState<Record<string, boolean>>({})
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number; width: number } | null>(null)

  const ensureMuhtelifCustomerCode = async (signal?: AbortSignal, opts?: { force?: boolean }) => {
    try {
      const cc = String(draftCustomer ?? '').trim()
      const isMuhtelif = cc.toUpperCase() === 'MUHTELIF'
      if (!isMuhtelif) return

      const existing = String(muhtelifCodeRef.current ?? '').trim()
      if (existing && !opts?.force) return

      const code = await fetchNextBayiMuhtelifCustomerCode({ signal })
      if (!code) throw new Error('Muhtelif cari kodu üretilemedi')
      setMuhtelifForm((p) => ({ ...p, customerCode: code }))
    } catch (e: any) {
      if (isAbortError(e)) return
      setError(String(e?.message ?? 'Muhtelif cari kodu alınamadı'))
    }
  }

  useEffect(() => {
    if (!createOpen) return
    if (String(draftCustomer ?? '').trim().toUpperCase() !== 'MUHTELIF') return
    const ac = new AbortController()
    void ensureMuhtelifCustomerCode(ac.signal)
    return () => ac.abort()
  }, [createOpen, draftCustomer])

  const f4GroupRankRef = useRef<Record<string, number> | null>(null)
  const f4GroupIdsRef = useRef<Set<string> | null>(null)
  const [priceGroups, setPriceGroups] = useState<PriceGroupDto[]>([])

  const checkIsAcikFaturaCari = (customer: any) => {
    if (!customer) return false
    const invType = String(customer.invoiceType ?? '').trim().toUpperCase()
    if (invType === 'ASKERIYE' || invType === 'ASKERİYE') return false
    if (invType === 'ACIK' || invType === 'AÇIK') return true
    const name = String(customer.name ?? '').toUpperCase()
    if (name.includes('ASKERİYE') || name.includes('ASKERIYE') || name.includes('KOLORDU') || name.includes('TUGAY') || name.includes('KOMUTAN')) return false
    const pgCode = Number(customer.priceGroupCode ?? customer.priceGroupEntity?.code ?? 0)
    if (pgCode === 7) return false
    const pgId = String(customer.priceGroupId ?? '').trim()
    if (pgId) {
      const pg = priceGroups.find((x) => String(x.id).trim() === pgId)
      if (pg) {
        const code = Number(pg.code ?? 0)
        const pgInvType = String((pg as any)?.invoiceType ?? '').trim().toUpperCase()
        if (code === 7 || pgInvType === 'ASKERIYE' || pgInvType === 'ASKERİYE') return false
        if (code === 4 || code === 5 || code === 6 || pgInvType === 'ACIK' || pgInvType === 'AÇIK') return true
      }
    }
    return false
  }

  const ensureF4Groups = async () => {
    if (f4GroupIdsRef.current && f4GroupRankRef.current) return
    try {
      const list: PriceGroupDto[] = await fetchPriceGroups({ includeInactive: false })
      setPriceGroups(list ?? [])
      const rankById: Record<string, number> = {}

      ;(list ?? []).forEach((x) => {
        const id = trimId((x as any)?.id)
        if (!id) return
        const code = Number((x as any)?.code ?? 0)
        const formula = String((x as any)?.formula ?? '').trim().toUpperCase()
        const name = String((x as any)?.name ?? '').trim()

        const nameNorm = name.toLowerCase()
        const exact60 = /^0?4\s*[-–]\s*60\b/.test(nameNorm) || (nameNorm.includes('60') && nameNorm.startsWith('4'))
        const looksLike4ByName = name.startsWith('4') || name.startsWith('04')

        const removeKdvPrefix = 'REMOVE_KDV' + '(F4'
        const isF4Formula = formula === 'F4' || formula.startsWith('F4*') || formula.startsWith(removeKdvPrefix)

        let rank: number | null = null
        if (code === 4 && exact60) rank = 0
        else if (exact60) rank = 1
        else if (code === 4) rank = 2
        else if (looksLike4ByName) rank = 3
        else if (isF4Formula) rank = 4

        if (rank == null) return
        const prev = rankById[id]
        if (prev == null || rank < prev) rankById[id] = rank
      })

      f4GroupRankRef.current = rankById
      f4GroupIdsRef.current = new Set(Object.keys(rankById))
    } catch {
      f4GroupRankRef.current = {}
      f4GroupIdsRef.current = new Set()
    }
  }

  const fetchF4PriceMapForProductIds = async (ids: string[]) => {
    await ensureF4Groups()
    const f4GroupIds = f4GroupIdsRef.current ?? new Set<string>()
    const f4GroupRank = f4GroupRankRef.current ?? {}
    if (ids.length === 0) return {}

    // Muhtelifin kendi carisi (dolayısıyla fiyat grubu) yok. Eskiden bu boşluk F4 (4 numaralı
    // grup) kümesine düşüyordu; kullanıcı kararı gereği artık 1 numaralı gruptan fiyatlanıyor.
    const cc = String(draftCustomer ?? '').trim()
    const isMuhtelifCustomer =
      cc.toUpperCase() === 'MUHTELIF' ||
      customers.find((c) => c.customerCode === cc)?.isMuhtelif === true
    const muhtelifGroupId = isMuhtelifCustomer ? resolveMuhtelifPriceGroupId(priceGroups) : null

    if (!muhtelifGroupId && f4GroupIds.size === 0) return {}

    const prices: ProductPriceResponse[] = await fetchProductPricesByProducts(ids)
    const map: Record<string, { price: number; currency: string }> = {}
    const bestRankByProductId: Record<string, number> = {}

    ;(prices ?? []).forEach((pp) => {
      const rawId = trimId((pp as any)?.productId ?? (pp as any)?.productID)
      const productId = rawId
      const productIdLower = rawId.toLowerCase()
      const priceGroupId = trimId((pp as any)?.priceGroupId ?? (pp as any)?.priceGroupID)
      if (!productId) return

      // Muhtelifte tek hedef grup var; sıralama (rank) yarışına hiç girilmiyor.
      if (muhtelifGroupId) {
        if (priceGroupId !== muhtelifGroupId) return
        const value = { price: Number((pp as any)?.price ?? 0), currency: String((pp as any)?.currency ?? '') }
        map[productId] = value
        if (productIdLower && productIdLower !== productId) map[productIdLower] = value
        return
      }

      if (!f4GroupIds.has(priceGroupId)) return

      const rank = f4GroupRank[priceGroupId]
      if (rank == null) return

      const prevRank = bestRankByProductId[productId]
      if (prevRank != null && prevRank <= rank) return
      bestRankByProductId[productId] = rank

      const value = { price: Number((pp as any)?.price ?? 0), currency: String((pp as any)?.currency ?? '') }
      map[productId] = value
      if (productIdLower && productIdLower !== productId) map[productIdLower] = value
    })

    return map
  }

  const price3GroupIdRef = useRef<string | null>(null)

  const ensurePrice3GroupId = async () => {
    if (price3GroupIdRef.current) return price3GroupIdRef.current
    try {
      const list: PriceGroupDto[] = await fetchPriceGroups({ includeInactive: false })
      const g3 = (list ?? []).find((x) => Number((x as any)?.code ?? 0) === 3)
      if (g3) {
        price3GroupIdRef.current = trimId((g3 as any)?.id)
      }
    } catch {
      // ignore
    }
    return price3GroupIdRef.current
  }

  const fetchPrice3MapForProductIds = async (ids: string[]): Promise<Record<string, number>> => {
    const g3Id = await ensurePrice3GroupId()
    if (!g3Id || ids.length === 0) return {}

    const prices: ProductPriceResponse[] = await fetchProductPricesByProducts(ids)
    const map: Record<string, number> = {}

    ;(prices ?? []).forEach((pp) => {
      const rawId = trimId((pp as any)?.productId ?? (pp as any)?.productID)
      const priceGroupId = trimId((pp as any)?.priceGroupId ?? (pp as any)?.priceGroupID)
      if (!rawId || priceGroupId !== g3Id) return
      const price = Number((pp as any)?.price ?? 0)
      map[rawId] = price
      const lower = rawId.toLowerCase()
      if (lower !== rawId) map[lower] = price
    })

    return map
  }

  const [categoriesState, setCategoriesState] = useState<ProductCategoryStateResponse>({ mains: [], subsByMain: {}, meta: {} })
  const [pickerMainCat, setPickerMainCat] = useState('')
  const [pickerSubCat, setPickerSubCat] = useState('')

  const totalsById = useMemo(() => {
    const out: Record<string, ReturnType<typeof calcInvoiceTotalsWithConversion>> = {}
    for (const r of rows) {
      const rowCurrency = (r as any).currencyCode || getInvoiceCurrency(r.lines)
      out[String(r.id)] = calcInvoiceTotalsWithConversion(r.lines, r.vatExempt, rowCurrency, fxRates)
    }
    return out
  }, [rows, fxRates])

  const toggleExpand = (id: number | string) => {
    const k = String(id)
    setExpanded((p) => ({ ...p, [k]: !p[k] }))
  }

  const mapApiOfferToRow = (x: CariOfferListItemDto): CariOffer => {
    const yyyyMmDd = String(x.date ?? '').slice(0, 10)
    return {
      id: x.id,
      date: yyyyMmDd,
      documentNo: String(x.documentNo ?? ''),
      customerCode: stripCariSubAccountCode(String(x.customerCode ?? '')),
      customerName: String(x.customerName ?? ''),
      description: String(x.description ?? ''),
      vatExempt: Boolean(x.vatExempt),
      createUser: String(x.createUser ?? ''),
      proformaDocumentNo: (x as any).proformaDocumentNo ?? null,
      invoiceId: (x as any).invoiceId ?? null,
      invoiceNo: (x as any).invoiceNo ?? null,
      currencyTypeId: Number((x as any).currencyTypeId ?? (x as any).CurrencyTypeId ?? 1),
      currencyCode: (() => {
        const cid = Number((x as any).currencyTypeId ?? (x as any).CurrencyTypeId ?? 0);
        return cid === 2 ? 'EUR' : cid === 3 ? 'USD' : cid === 4 ? 'GBP' : 'TRY';
      })(),
      lines: (x.lines ?? []).map((l: any) => {
        const offerCurrency = (() => {
          const cid = Number((x as any).currencyTypeId ?? (x as any).CurrencyTypeId ?? 0);
          return cid === 2 ? 'EUR' : cid === 3 ? 'USD' : cid === 4 ? 'GBP' : 'TRY';
        })();
        return {
          id: String(l.id),
          productId: String(l.productId),
          stockCode: String(l.stockCode ?? ''),
          stockName: String(l.stockName ?? l.description ?? ''),
          quantity: Number(l.quantity ?? 0),
          unitPrice: Number(l.unitPrice ?? 0),
          discountType: normalizeDiscountType(l.discountType),
          discountValue: Number(l.discountValue ?? 0),
          vatRate: Number(l.vatRate ?? 0),
          currencyCode: offerCurrency
        };
      })
    }
  }

  const loadAll = async (signal?: AbortSignal) => {
    try {
      setLoading(true)
      setError(null)
      // Bütün kayıtlar sayfa sayfa (2026-10-08): eskiden yalnız son 200 geliyordu, eski kayıtlar
      // aramada/süzgeçte görünmüyordu. İlk sayfa hemen ekrana basılır, kalanlar arkadan eklenir.
      await fetchAllPages((skip, take) => fetchCariOffers({ take, skip, signal }), {
        key: (x) => String(x.id),
        onPage: (all, first) => {
          setRows(all.map(mapApiOfferToRow))
          if (first) setLoading(false)
        }
      })
    } catch (e: any) {
      if (isAbortError(e)) return
      setRows([])
      setError(String(e?.message ?? 'Teklifler alınamadı'))
    } finally {
      setLoading(false)
    }
  }

  const loadCustomers = async (signal?: AbortSignal) => {
    try {
      setCustomersLoading(true)
      setCustomers([])
      const list = await fetchCariOfferCustomersDropdown({ includeInactive: false, includeMuhtelif: true, signal })
      const mapped = uniqueMainCustomers((list ?? []).map((c) => ({
        ...c,
        customerCode: stripCariSubAccountCode(String(c.customerCode ?? '')),
        name: String(c.name ?? ''),
        discountRate: Number(c.discountRate ?? 0),
        salesmanCode: c.salesmanCode || null,
        currencyTypeId: Number(c.currencyTypeId ?? 1)
      })))
      setCustomers(mapped)

      // Auto-select the first customer if draftCustomer is empty (e.g., when creating new offer)
      if (mapped.length > 0 && !draftCustomer) {
        const first = mapped[0]
        setDraftCustomer(first.customerCode)
        setDraft((p) => ({
          ...p,
          customerName: String(first.name ?? '')
        }))
        setDraftSalesRep(String(first.salesmanCode ?? ''))
      }
    } catch {
      setCustomers([])
    } finally {
      setCustomersLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void loadAll(ac.signal)
    void loadCustomers(ac.signal)
    return () => ac.abort()
  }, [])

  useEffect(() => {
    const ac = new AbortController()

    void (async () => {
      try {
        setSalesmenLoading(true)
        setSalesmen([])
        // Cari müşteri teklifi is the screen customers themselves quote on, so it shows only
        // the salesman marked as customer-facing rather than the firm's whole salesman list.
        const list = await fetchSalesmenDropdown({ signal: ac.signal, cariOnly: true })
        setSalesmen(list)
      } catch {
        setSalesmen([])
      } finally {
        setSalesmenLoading(false)
      }
    })()

    return () => ac.abort()
  }, [])

  const openCreate = () => {
    const init = createEmptyOffer()
    setDraft(init)
    setDraftCustomer('MUHTELIF')
    setDraftSalesRep('')
    setEditOfferId(null)
    setMuhtelifForm({
      customerCode: '',
      name: '',
      city: '',
      district: '',
      address: '',
      phone: '',
      email: '',
      taxOffice: '',
      taxNumber: ''
    })
    setCreateOpen(true)
    void loadCustomers()

    const ac = new AbortController()
    void (async () => {
      try {
        const docNo = await fetchNewCariOfferDocumentNo({ signal: ac.signal })
        setDraft((p) => ({ ...p, documentNo: docNo }))
        void ensureMuhtelifCustomerCode(ac.signal, { force: true })
      } catch {
      }
    })()
  }

  const openEdit = async (id: number | string) => {
    const safeId = Number(id)
    if (!Number.isFinite(safeId) || safeId <= 0) {
      setError('Geçersiz teklif id')
      return
    }

    try {
      setLoading(true)
      setError(null)
      const dto: any = await getCariOffer(safeId)

      setEditOfferId(safeId)
      const linesData = dto?.lines ?? []
      const productIds = linesData.map((l: any) => String(l?.productId ?? '')).filter(Boolean)
      const p3Map = await fetchPrice3MapForProductIds(productIds)

      const editCurrencyTypeId = Number(dto?.currencyTypeId ?? (dto as any)?.CurrencyTypeId ?? 1)
      const editCurrencyCode = editCurrencyTypeId === 2 ? 'EUR' : editCurrencyTypeId === 3 ? 'USD' : editCurrencyTypeId === 4 ? 'GBP' : 'TRY'

      setDraft((p) => ({
        ...p,
        id: safeId,
        date: String(dto?.date ?? '').slice(0, 10) || p.date,
        documentNo: String(dto?.documentNo ?? ''),
        description: String(dto?.description ?? ''),
        vatExempt: Boolean(dto?.vatExempt),
        currencyTypeId: editCurrencyTypeId,
        currencyCode: editCurrencyCode,
        lines: linesData.map((l: any) => {
          const pid = String(l?.productId ?? '')
          const p3Price = pid ? (p3Map as any)[pid] ?? (p3Map as any)[pid.toLowerCase()] ?? 0 : 0
          return {
            id: createId('line'),
            productId: pid,
            stockCode: String(l?.stockCode ?? ''),
            stockName: String(l?.stockName ?? ''),
            quantity: Number(l?.quantity ?? 0),
            unitPrice: Number(l?.unitPrice ?? 0),
            price3: p3Price,
            discountType: normalizeDiscountType(l?.discountType),
            discountValue: Number(l?.discountValue ?? 0),
            vatRate: Number(l?.vatRate ?? 0),
            currencyCode: editCurrencyCode
          }
        })
      }))

      const cc = stripCariSubAccountCode(String(dto?.customerCode ?? ''))
      setDraftCustomer(cc)
      setDraftSalesRep(String(dto?.salesmanCode ?? ''))

      const m = dto?.muhtelif
      setMuhtelifForm({
        customerCode: stripCariSubAccountCode(String(m?.customerCode ?? '')),
        name: String(m?.name ?? ''),
        city: String(m?.city ?? ''),
        district: String(m?.district ?? ''),
        address: String(m?.address ?? ''),
        phone: String(m?.phone ?? ''),
        email: String(m?.email ?? ''),
        taxOffice: String(m?.taxOffice ?? ''),
        taxNumber: String(m?.taxNumber ?? '')
      })

      setCreateOpen(true)
    } catch (e: any) {
      setError(String(e?.message ?? 'Teklif alınamadı'))
    } finally {
      setLoading(false)
    }
  }

  const closeCreate = () => {
    setCreateOpen(false)
    setEditOfferId(null)
  }

  const updateDraft = (patch: Partial<CariOffer>) => {
    setDraft((p) => ({ ...p, ...patch }))
  }

  const updateLine = (lineId: string, patch: Partial<OfferLine>) => {
    setDraft((p) => ({
      ...p,
      lines: p.lines.map((l) => {
        if (l.id !== lineId) return l
        const updated = { ...l, ...patch }

        const minPrice = Number(updated.price3 ?? 0)
        const unitPrice = Number(updated.unitPrice ?? 0)
        const qty = Math.max(1, Number(updated.quantity ?? 1))

        if (minPrice > 0 && unitPrice > 0) {
          if (updated.discountType === 'percentage') {
            const maxPercent = Math.max(0, ((unitPrice - minPrice) / unitPrice) * 100)
            if (updated.discountValue > maxPercent) {
              updated.discountValue = Number(maxPercent.toFixed(2))
            }
          } else if (updated.discountType === 'amount') {
            const maxTotalDiscount = Math.max(0, (unitPrice - minPrice) * qty)
            if (updated.discountValue > maxTotalDiscount) {
              updated.discountValue = Number(maxTotalDiscount.toFixed(2))
            }
          }
        } else {
          if (updated.discountType === 'percentage') {
            if (updated.discountValue > 100) updated.discountValue = 100
          } else if (updated.discountType === 'amount') {
            if (updated.discountValue > unitPrice * qty) updated.discountValue = unitPrice * qty
          }
        }

        return updated
      })
    }))
  }

  const openProductPicker = (lineId: string) => {
    setProductPickerForLineId(lineId)
    setProductPickerQuery('')
    setPickerMainCat('')
    setPickerSubCat('')
    setProductPickerItems([])
    setProductPickerError(null)
    setProductPickerOpen(true)

    void fetchProductCategoriesStateForDealer({ includeDealer: true, dealerCode: draftCustomer })
      .then(setCategoriesState)
      .catch(() => {})
  }

  const closeProductPicker = () => {
    setProductPickerOpen(false)
    setProductPickerForLineId(null)
    setProductPickerError(null)
  }

  const searchProducts = async (q: string, filtersArg?: { main?: string; sub?: string }) => {
    try {
      setProductPickerLoading(true)
      setProductPickerError(null)

      const cc = String(draftCustomer ?? '').trim()
      const selectedCustomer = cc ? customers.find((c) => c.customerCode === cc) : null
      const isMuhtelif = cc.toUpperCase() === 'MUHTELIF' || selectedCustomer?.isMuhtelif === true
      const dealerCode = !cc || isMuhtelif ? undefined : cc

      const main = filtersArg?.main !== undefined ? filtersArg.main : pickerMainCat
      const sub = filtersArg?.sub !== undefined ? filtersArg.sub : pickerSubCat

      const res: any = await fetchProducts({
        q: q.trim(),
        main: main || undefined,
        sub: sub || undefined,
        page: 1,
        pageSize: 50,
        includeDealer: true,
        dealerCode,
        includeInactive: false
      })

      const items = (res.items ?? []) as any[]
      const ids = items.map((p) => trimId((p as any)?.id)).filter(Boolean)
      const [f4Map, p3Map] = await Promise.all([
        fetchF4PriceMapForProductIds(ids),
        fetchPrice3MapForProductIds(ids)
      ])

      setProductPickerItems(
        items.map((p) => {
          const rawId = trimId((p as any)?.id)
          const f4 = rawId ? (f4Map as any)[rawId] ?? (f4Map as any)[rawId.toLowerCase()] : undefined
          const p3Price = rawId ? (p3Map as any)[rawId] ?? (p3Map as any)[rawId.toLowerCase()] ?? 0 : 0
          const baseCurrency = (() => {
            const fc = String(f4?.currency ?? '').trim().toUpperCase()
            if (fc === '3' || fc === 'USD') return 'USD'
            if (fc === '2' || fc === 'EUR') return 'EUR'
            if (fc === '4' || fc === 'GBP') return 'GBP'
            if (fc === '0' || fc === '1' || fc === 'TRY' || fc === 'TL') return 'TRY'

            const sc = String(p.salesCurrencyCode ?? p.SalesCurrencyCode ?? '').trim().toUpperCase()
            if (sc === '3' || sc === 'USD') return 'USD'
            if (sc === '2' || sc === 'EUR') return 'EUR'
            if (sc === '4' || sc === 'GBP') return 'GBP'
            if (sc === '0' || sc === '1' || sc === 'TRY' || sc === 'TL') return 'TRY'

            const dc = String(p.currency ?? p.Currency ?? '').trim().toUpperCase()
            if (dc === '3' || dc === 'USD') return 'USD'
            if (dc === '2' || dc === 'EUR') return 'EUR'
            if (dc === '4' || dc === 'GBP') return 'GBP'
            if (dc === '0' || dc === '1' || dc === 'TRY' || dc === 'TL') return 'TRY'

            const pc = String(p.currencyCode ?? p.CurrencyCode ?? '').trim().toUpperCase()
            if (pc === '3' || pc === 'USD') return 'USD'
            if (pc === '2' || pc === 'EUR') return 'EUR'
            if (pc === '4' || pc === 'GBP') return 'GBP'
            return 'TRY'
          })()
          return {
            ...p,
            __basePrice: f4?.price ?? p.unitPrice ?? p.UnitPrice ?? 0,
            __baseCurrency: baseCurrency,
            __price3: p3Price
          }
        })
      )
    } catch (e: any) {
      setProductPickerItems([])
      setProductPickerError(String(e?.message ?? 'Ürünler alınamadı'))
    } finally {
      setProductPickerLoading(false)
    }
  }

  const fetchAndMapProducts = async (q: string) => {
    const cc = String(draftCustomer ?? '').trim()
    const isMuhtelif = cc.toUpperCase() === 'MUHTELIF'
    const dealerCode = !cc || isMuhtelif ? undefined : cc

    const res: any = await fetchProducts({
      q: q.trim(),
      page: 1,
      pageSize: 50,
      includeDealer: true,
      dealerCode,
      includeInactive: false
    })

    const items = (res.items ?? []) as any[]
    const ids = items.map((p) => trimId((p as any)?.id)).filter(Boolean)
    const [f4Map, p3Map] = await Promise.all([
      fetchF4PriceMapForProductIds(ids),
      fetchPrice3MapForProductIds(ids)
    ])

    return items.map((p) => {
      const rawId = trimId((p as any)?.id)
      const f4 = rawId ? (f4Map as any)[rawId] ?? (f4Map as any)[rawId.toLowerCase()] : undefined
      const p3Price = rawId ? (p3Map as any)[rawId] ?? (p3Map as any)[rawId.toLowerCase()] ?? 0 : 0
      const baseCurrency = (() => {
        const fc = String(f4?.currency ?? '').trim().toUpperCase()
        if (fc === '3' || fc === 'USD') return 'USD'
        if (fc === '2' || fc === 'EUR') return 'EUR'
        if (fc === '4' || fc === 'GBP') return 'GBP'
        if (fc === '0' || fc === '1' || fc === 'TRY' || fc === 'TL') return 'TRY'

        const sc = String(p.salesCurrencyCode ?? p.SalesCurrencyCode ?? '').trim().toUpperCase()
        if (sc === '3' || sc === 'USD') return 'USD'
        if (sc === '2' || sc === 'EUR') return 'EUR'
        if (sc === '4' || sc === 'GBP') return 'GBP'
        if (sc === '0' || sc === '1' || sc === 'TRY' || sc === 'TL') return 'TRY'

        const dc = String(p.currency ?? p.Currency ?? '').trim().toUpperCase()
        if (dc === '3' || dc === 'USD') return 'USD'
        if (dc === '2' || dc === 'EUR') return 'EUR'
        if (dc === '4' || dc === 'GBP') return 'GBP'
        if (dc === '0' || dc === '1' || dc === 'TRY' || dc === 'TL') return 'TRY'

        const pc = String(p.currencyCode ?? p.CurrencyCode ?? '').trim().toUpperCase()
        if (pc === '3' || pc === 'USD') return 'USD'
        if (pc === '2' || pc === 'EUR') return 'EUR'
        if (pc === '4' || pc === 'GBP') return 'GBP'
        return 'TRY'
      })()
      return {
        ...p,
        __basePrice: f4?.price ?? p.unitPrice ?? p.UnitPrice ?? 0,
        __baseCurrency: baseCurrency,
        __price3: p3Price
      }
    })
  }

  const selectProductForLine = (product: any, customLineId?: string | null) => {
    const lineId = customLineId || productPickerForLineId
    if (!lineId) return

    const cc = String(draftCustomer ?? '').trim()
    const selectedCustomer = cc ? customers.find((c) => c.customerCode === cc) : null
    const isMuhtelif = cc.toUpperCase() === 'MUHTELIF' || selectedCustomer?.isMuhtelif === true
    const isAcikCari = checkIsAcikFaturaCari(selectedCustomer)
    const defaultDiscountRate = isAcikCari ? 0 : Number((selectedCustomer as any)?.discountRate ?? 0)

    const currentLine = draft.lines.find((l) => l.id === lineId)
    const shouldApplyDiscount =
      !isAcikCari &&
      defaultDiscountRate > 0 &&
      (currentLine?.discountType ?? 'none') === 'none' &&
      Number(currentLine?.discountValue ?? 0) === 0

    updateLine(lineId, {
      productId: String(product?.id ?? ''),
      stockCode: String(product?.stockCode ?? ''),
      stockName: String(product?.name ?? ''),
      unitPrice: Number(product?.__basePrice ?? product?.unitPrice ?? 0),
      price3: Number(product?.__price3 ?? 0),
      vatRate: isAcikCari ? 0 : Number(product?.taxRate ?? 0),
      currencyCode: product?.__baseCurrency ?? '0',
      ...(isAcikCari
        ? { discountType: 'none' as const, discountValue: 0 }
        : shouldApplyDiscount
        ? {
            discountType: 'percentage' as const,
            discountValue: defaultDiscountRate
          }
        : null)
    })

    closeProductPicker()
  }

  const selectProductAndAddLine = (product: any) => {
    const lineId = productPickerForLineId
    if (!lineId) return

    selectProductForLine(product, lineId)

    if (draft.lines.length >= 17) return
    const nextLine = createEmptyLine()
    setDraft((p) => ({ ...p, lines: [...p.lines, nextLine] }))
    setProductPickerForLineId(nextLine.id)
    setProductPickerOpen(true)
  }

  const removeLine = (lineId: string) => {
    setDraft((p) => {
      const next = p.lines.filter((l) => l.id !== lineId)
      return { ...p, lines: next.length > 0 ? next : [createEmptyLine()] }
    })
  }

  const addLine = () => {
    if (draft.lines.length >= 17) {
      showMessage('Hata', 'En fazla 17 kalem sipariş edebilirsiniz.')
      return
    }
    setDraft((p) => ({ ...p, lines: [...p.lines, createEmptyLine()] }))
  }

  const draftCurrency = useMemo(() => {
    if (draft.currencyCode) return draft.currencyCode
    const cid = Number(draft.currencyTypeId ?? 0)
    if (cid === 2) return 'EUR'
    if (cid === 3) return 'USD'
    if (cid === 4) return 'GBP'
    if (cid === 1) return 'TRY'
    return getInvoiceCurrency(draft.lines)
  }, [draft.lines, draft.currencyCode, draft.currencyTypeId])

  const draftTotals = useMemo(() => {
    return calcInvoiceTotalsWithConversion(draft.lines, draft.vatExempt, draftCurrency, fxRates)
  }, [draft.lines, draft.vatExempt, draftCurrency, fxRates])

  const columnOptions = useMemo(() => {
    const out: Record<string, string[]> = {}
    const cols = ['date', 'documentNo', 'customerCode', 'customerName', 'description', 'createUser']
    for (const key of cols) {
      const values = new Set<string>()
      for (const row of rows) {
        values.add(String((row as any)[key] ?? '').trim())
      }
      out[key] = Array.from(values)
        .filter((v) => v.length > 0)
        .sort((a, b) => a.localeCompare(b))
    }
    return out
  }, [rows])

  React.useEffect(() => {
    if (!activeFilterKey) return
    const handleClick = (event: MouseEvent) => {
      if (!filterPanelRef.current) return
      if (!filterPanelRef.current.contains(event.target as Node)) {
        setActiveFilterKey(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [activeFilterKey])

  const normalizeDateValue = (value: string) => {
    const raw = value.trim()
    if (!raw) return ''
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (iso) return `${iso[1]}${iso[2]}${iso[3]}`
    const dotted = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
    if (dotted) return `${dotted[3]}${dotted[2]}${dotted[1]}`
    return raw
  }

  const filteredRows = useMemo(() => {
    const gs = String(globalSearch ?? '').trim().toLowerCase()
    const byGlobal = rows.filter((row) => {
      if (!gs) return true
      const blob = [row.date, row.documentNo, row.customerCode, row.customerName, row.description, row.createUser]
        .map((x) => String(x ?? '').toLowerCase())
        .join(' ')
      return blob.includes(gs)
    })

    const matchText = (cell: string, op: string, v1: string, v2: string) => {
      const c = cell.toLowerCase()
      const a = v1.toLowerCase()
      const b = v2.toLowerCase()
      if (!a && !(op === 'between' && b)) return true

      if (op === 'contains') return c.includes(a)
      if (op === 'not_contains') return !c.includes(a)
      if (op === 'starts_with') return c.startsWith(a)
      if (op === 'ends_with') return c.endsWith(a)
      if (op === 'eq') return c === a
      if (op === 'neq') return c !== a
      if (op === 'between') return c >= a && c <= b
      return c.includes(a)
    }

    const matchDate = (cell: string, op: string, v1: string, v2: string) => {
      const c = normalizeDateValue(cell)
      const a = normalizeDateValue(v1)
      const b = normalizeDateValue(v2)
      if (!a && !(op === 'between' && b)) return true
      if (op === 'eq') return c === a
      if (op === 'neq') return c !== a
      if (op === 'between') return c >= a && c <= b
      if (op === 'gt') return c > a
      if (op === 'gte') return c >= a
      if (op === 'lt') return c < a
      if (op === 'lte') return c <= a
      return c === a
    }

    const apply = (list: CariOffer[]) => {
      return list.filter((row) => {
        const dateOk = matchDate(String(row.date ?? ''), String(filterOps.date ?? 'eq'), String(filters.date?.v1 ?? ''), String(filters.date?.v2 ?? ''))
        const docOk = matchText(String(row.documentNo ?? ''), String(filterOps.documentNo ?? 'contains'), String(filters.documentNo?.v1 ?? ''), String(filters.documentNo?.v2 ?? ''))
        const codeOk = matchText(String(row.customerCode ?? ''), String(filterOps.customerCode ?? 'contains'), String(filters.customerCode?.v1 ?? ''), String(filters.customerCode?.v2 ?? ''))
        const nameOk = matchText(String(row.customerName ?? ''), String(filterOps.customerName ?? 'contains'), String(filters.customerName?.v1 ?? ''), String(filters.customerName?.v2 ?? ''))
        const descOk = matchText(String(row.description ?? ''), String(filterOps.description ?? 'contains'), String(filters.description?.v1 ?? ''), String(filters.description?.v2 ?? ''))
        const userOk = matchText(String(row.createUser ?? ''), String(filterOps.createUser ?? 'contains'), String(filters.createUser?.v1 ?? ''), String(filters.createUser?.v2 ?? ''))

        const vatCell = row.vatExempt ? 'evet' : 'hayır'
        const vatOk = matchText(vatCell, String(filterOps.vatExempt ?? 'eq'), String(filters.vatExempt?.v1 ?? ''), String(filters.vatExempt?.v2 ?? ''))

        return dateOk && docOk && codeOk && nameOk && descOk && userOk && vatOk
      })
    }

    return apply(byGlobal)
  }, [filters, filterOps, globalSearch, rows])

  const renderHeaderCell = (label: string, key: ColumnKey) => {
    const options = columnOptions[key] ?? []

    return (
      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wide border border-gray-200" key={key}>
        <div className="flex items-center gap-2">
          <span>{label}</span>
          {key !== 'vatExempt' && (
            <button
              type="button"
              className="w-6 h-6 inline-flex items-center justify-center rounded hover:bg-gray-200"
              onClick={() => {
                setActiveFilterKey((p) => (p === key ? null : key))
                setDraftValues((p) => ({ ...p, [key]: selectedValues[key] ?? [] }))
              }}
              title="Filtre"
            >
              <Search size={12} className="text-gray-600" />
            </button>
          )}
        </div>

        {activeFilterKey === key && key !== 'vatExempt' && (
          <div className="relative" ref={filterPanelRef as any}>
            <div className="absolute left-0 mt-2 w-[260px] bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
              <div className="p-2 border-b border-gray-100">
                <div className="text-[11px] font-semibold text-gray-600 mb-2">Seçili değerler</div>
                <div className="max-h-[180px] overflow-auto space-y-1">
                  {options.length === 0 ? (
                    <div className="text-[11px] text-gray-500">Değer yok</div>
                  ) : (
                    options.map((v) => {
                      const checked = (draftValues[key] ?? []).includes(v)
                      return (
                        <label key={v} className="flex items-center gap-2 text-[11px] text-gray-700 select-none">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const on = e.target.checked
                              setDraftValues((p) => {
                                const cur = new Set(p[key] ?? [])
                                if (on) cur.add(v)
                                else cur.delete(v)
                                return { ...p, [key]: Array.from(cur) }
                              })
                            }}
                          />
                          <span className="truncate" title={v}>
                            {v}
                          </span>
                        </label>
                      )
                    })
                  )}
                </div>
              </div>
              <div className="p-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="h-[28px] px-3 text-[11px] font-semibold rounded border border-gray-200 bg-white hover:bg-gray-50"
                  onClick={() => {
                    setDraftValues((p) => ({ ...p, [key]: [] }))
                  }}
                >
                  Temizle
                </button>
                <button
                  type="button"
                  className="h-[28px] px-3 text-[11px] font-semibold rounded bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => {
                    setSelectedValues((p) => ({ ...p, [key]: draftValues[key] ?? [] }))
                    setActiveFilterKey(null)
                  }}
                >
                  Uygula
                </button>
              </div>
            </div>
          </div>
        )}
      </th>
    )
  }

  const saveDraft = async () => {
    try {
      setLoading(true)
      setError(null)

      const cc = String(draftCustomer ?? '').trim()
      const selectedCustomer = customers.find((c) => String(c.customerCode ?? '').trim() === cc)
      const isMuhtelif = cc.toUpperCase() === 'MUHTELIF' || selectedCustomer?.isMuhtelif === true

      const payload: any = {
        date: new Date(`${String(draft.date ?? '').trim()}T00:00:00.000Z`).toISOString(),
        vatExempt: Boolean(draft.vatExempt),
        customerCode: isMuhtelif ? (cc.toUpperCase() === 'MUHTELIF' ? 'MUHTELIF' : cc) : cc || null,
        muhtelif: isMuhtelif
          ? {
              customerCode: String(muhtelifForm.customerCode ?? '').trim(),
              name: String(muhtelifForm.name ?? '').trim(),
              city: String(muhtelifForm.city ?? '').trim() || null,
              district: String(muhtelifForm.district ?? '').trim() || null,
              address: String(muhtelifForm.address ?? '').trim() || null,
              phone: String(muhtelifForm.phone ?? '').trim() || null,
              email: String(muhtelifForm.email ?? '').trim().toLowerCase() || null,
              taxOffice: String(muhtelifForm.taxOffice ?? '').trim() || null,
              taxNumber: String(muhtelifForm.taxNumber ?? '').trim() || null
            }
          : null,
        salesmanCode: draftSalesRep || null,
        description: draft.description,
        currencyTypeId: Number(draft.currencyTypeId ?? 1),
        lines: draft.lines.map((l) => ({
          productId: String(l.productId ?? ''),
          quantity: Number(l.quantity ?? 0),
          discountType: l.discountType === 'amount' ? 1 : l.discountType === 'percentage' ? 2 : 0,
          discountValue: Number(l.discountValue ?? 0)
        }))
      }

      if (!payload.customerCode) throw new Error('Cari seçimi zorunlu')

      if (isMuhtelif) {
        if (!payload.muhtelif?.customerCode) throw new Error('Muhtelif cari kodu zorunlu')
        if (!payload.muhtelif?.name) throw new Error('Muhtelif cari adı zorunlu')
        if (!payload.muhtelif?.phone) throw new Error('Muhtelif cari telefon numarası zorunlu')
      }

      if (payload.lines.length === 0) throw new Error('En az 1 satır eklemelisiniz')
      if (payload.lines.length > 17) throw new Error('En fazla 17 kalem sipariş edebilirsiniz.')
      if (payload.lines.some((l: any) => !l.productId)) throw new Error('Tüm satırlarda ürün seçmelisiniz')

      if (editOfferId) {
        await updateCariOffer(editOfferId, payload as any)
      } else {
        await createCariOffer(payload as any)
      }
      setCreateOpen(false)
      setEditOfferId(null)
      await loadAll()
      await loadCustomers()

      if (isMuhtelif && selectedCustomer) {
      }
    } catch (e: any) {
      setError(String(e?.message ?? 'Teklif kaydedilemedi'))
    } finally {
      setLoading(false)
    }
  }

  const transferToProforma = async (id: number | string) => {
    const safeId = Number(id)
    if (!Number.isFinite(safeId) || safeId <= 0) {
      setError('Geçersiz teklif id')
      return
    }
    try {
      setLoading(true)
      setError(null)
      const res = await transferCariOfferToProforma(safeId)
      const docNo = String(res?.proformaDocumentNo ?? '').trim()
      if (docNo) {
        setRows((prev) =>
          (prev ?? []).map((r) => (Number(r.id) === safeId ? { ...r, proformaDocumentNo: docNo } : r))
        )
        setTransferredProformaId(safeId)
        setProformaTransferModalOpen(true)
      }
    } catch (e: any) {
      setError(String(e?.message ?? 'Proformaya aktarılamadı'))
    } finally {
      setLoading(false)
    }
  }

  const handlePrintOffer = async (
    id: number | string,
    templateType: 'standard' | 'simple' | 'usd',
    _onlyView?: boolean
  ) => {
    const safeId = Number(id)
    if (!Number.isFinite(safeId) || safeId <= 0) {
      setError('Geçersiz teklif id')
      return
    }

    try {
      const form = templateType === 'standard' ? '?form=ozellikli' : ''
      const token = localStorage.getItem('accessToken')

      const res = await fetch(`${API_BASE_URL}/api/cari-offers/${safeId}/yazdir${form}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Teklif basımı alınamadı (${res.status})`)
      }

      const url = URL.createObjectURL(await res.blob())
      const w = window.open(url, '_blank')
      if (!w) {
        URL.revokeObjectURL(url)
        setError('Pop-up engelleyiciyi devre dışı bırakın.')
        return
      }

      // Released once the tab has had time to load it; revoking at once can race the open.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e: any) {
      setError(String(e?.message ?? 'Teklif basımı alınamadı'))
    }
  }

  const requestDelete = (row: CariOffer) => {
    const id = Number(row.id)
    if (!Number.isFinite(id) || id <= 0) {
      setError('Geçersiz teklif id')
      return
    }
    setConfirmOfferId(id)
    setConfirmText(`Teklif silinsin mi? (${row.documentNo})`)
    setConfirmOpen(true)
  }

  const doDelete = async () => {
    try {
      if (!confirmOfferId) return
      setConfirmBusy(true)
      await deleteCariOffer(confirmOfferId)
      setConfirmOpen(false)
      setConfirmOfferId(null)
      await loadAll()
    } catch (e: any) {
      setError(String(e?.message ?? 'Teklif silinemedi'))
      showMessage('Hata', String(e?.message ?? 'Teklif silinemedi'))
    } finally {
      setConfirmBusy(false)
    }
  }

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [columnFiltersState, setColumnFiltersState] = useState<Record<string, any>>({})

  const cariOfferColumns = useMemo<ColumnDef<CariOffer, any>[]>(
    () => [
      {
        accessorKey: 'date',
        header: 'Tarih',
        meta: { filterType: 'date', filterPlaceholder: 'Tarih...' }
      },
      {
        accessorKey: 'documentNo',
        header: 'Belge No',
        meta: { filterType: 'text', filterPlaceholder: 'Belge No...' }
      },
      {
        accessorKey: 'customerCode',
        header: 'Cari Kodu',
        meta: { filterType: 'text', filterPlaceholder: 'Cari Kodu...' }
      },
      {
        accessorKey: 'customerName',
        header: 'Cari Adı',
        meta: { filterType: 'text', filterPlaceholder: 'Cari Adı...' }
      },
      {
        accessorKey: 'description',
        header: 'Açıklama',
        meta: { filterType: 'text', filterPlaceholder: 'Açıklama...' }
      },
      {
        accessorKey: 'createUser',
        header: 'İşlem Yapan',
        meta: { filterType: 'text', filterPlaceholder: 'İşlem Yapan...' }
      },
      {
        accessorKey: 'vatExempt',
        header: 'KDV İstisna',
        meta: {
          filterType: 'select',
          filterPlaceholder: 'KDV İstisna...',
          filterOptions: [
            { value: 'evet', label: 'Evet' },
            { value: 'hayır', label: 'Hayır' }
          ]
        },
        cell: ({ getValue }) => (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${getValue() ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
            {getValue() ? 'Evet' : 'Hayır'}
          </span>
        )
      },
      {
        id: 'currency',
        accessorFn: (row) => {
          const invCurrency = getInvoiceCurrency(row.lines)
          return invCurrency === '3' || invCurrency === 'USD' ? 'USD' : invCurrency === '2' || invCurrency === 'EUR' ? 'EUR' : invCurrency === '4' || invCurrency === 'GBP' ? 'GBP' : 'TRY'
        },
        header: 'Döviz',
        meta: { filterType: 'text' },
        cell: ({ getValue }) => {
          return <span className="font-semibold text-sky-700">{getValue()}</span>
        }
      },
      {
        id: 'subtotal',
        accessorFn: (row) => {
          const invCurrency = getInvoiceCurrency(row.lines)
          return calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, invCurrency, fxRates).subTotal
        },
        header: 'Ara Toplam',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row, getValue }) => {
          const invCurrency = getInvoiceCurrency(row.original.lines)
          return <div className="text-right font-medium text-slate-700">{formatMoneyWithCurrency(getValue(), invCurrency)}</div>
        }
      },
      {
        id: 'discountTotal',
        accessorFn: (row) => {
          const invCurrency = getInvoiceCurrency(row.lines)
          return calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, invCurrency, fxRates).discountTotal
        },
        header: 'İndirim',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row, getValue }) => {
          const invCurrency = getInvoiceCurrency(row.original.lines)
          return <div className="text-right font-medium text-slate-700">{formatMoneyWithCurrency(getValue(), invCurrency)}</div>
        }
      },
      {
        id: 'netTotal',
        accessorFn: (row) => {
          const invCurrency = getInvoiceCurrency(row.lines)
          return calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, invCurrency, fxRates).netTotal
        },
        header: 'Net Tutar',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row, getValue }) => {
          const invCurrency = getInvoiceCurrency(row.original.lines)
          return <div className="text-right font-semibold text-slate-800">{formatMoneyWithCurrency(getValue(), invCurrency)}</div>
        }
      },
      {
        id: 'vatTotal',
        accessorFn: (row) => {
          const invCurrency = getInvoiceCurrency(row.lines)
          return calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, invCurrency, fxRates).vatTotal
        },
        header: 'KDV Tutar',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row, getValue }) => {
          const invCurrency = getInvoiceCurrency(row.original.lines)
          return <div className="text-right font-medium text-slate-700">{formatMoneyWithCurrency(getValue(), invCurrency)}</div>
        }
      },
      {
        id: 'grandTotal',
        accessorFn: (row) => {
          const invCurrency = getInvoiceCurrency(row.lines)
          return calcInvoiceTotalsWithConversion(row.lines, row.vatExempt, invCurrency, fxRates).grandTotal
        },
        header: 'Genel Toplam',
        meta: { filterType: 'number', showTotal: true },
        cell: ({ row, getValue }) => {
          const invCurrency = getInvoiceCurrency(row.original.lines)
          return <div className="text-right font-bold text-slate-900">{formatMoneyWithCurrency(getValue(), invCurrency)}</div>
        }
      }
    ],
    [fxRates]
  )

  const getRowActions = (row: CariOffer): DataTableRowAction<CariOffer>[] => {
    const actions: DataTableRowAction<CariOffer>[] = []
    const isProforma = Boolean(row.proformaDocumentNo)
    if (canDuzenle) {
      actions.push({
        label: 'Düzenle',
        icon: <Pencil size={14} />,
        onClick: (r) => void openEdit(r.id)
      })
    }
    actions.push({
      label: 'Yazdır (Standart)',
      icon: <Printer size={14} />,
      onClick: (r) => void handlePrintOffer(r.id, 'standard', false)
    })
    actions.push({
      label: 'Yazdır (Özelliksiz)',
      icon: <Printer size={14} />,
      onClick: (r) => void handlePrintOffer(r.id, 'simple', false)
    })
    if (canSil) {
      actions.push({
        label: 'Sil',
        icon: <Trash2 size={14} />,
        variant: 'danger',
        onClick: (r) => requestDelete(r)
      })
    }
    if (canProformaAktar) {
      actions.push({
        label: isProforma ? 'Proforma Aktarıldı' : 'Proforma Aktar',
        icon: <Printer size={14} />,
        disabled: isProforma,
        onClick: (r) => {
          if (!isProforma) void transferToProforma(r.id)
        }
      })
    }
    return actions
  }

  const renderExpandedRowContent = (row: CariOffer) => {
    return (
      <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm p-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
              <th className="px-3 py-2 text-left">Stok Kodu</th>
              <th className="px-3 py-2 text-left">Stok Adı</th>
              <th className="px-3 py-2 text-center">Döviz Tipi</th>
              <th className="px-3 py-2 text-right">Miktar</th>
              <th className="px-3 py-2 text-right">Fiyat</th>
              <th className="px-3 py-2 text-right">Toplam</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {row.lines.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-3 text-center text-slate-400">Kalem bulunamadı.</td>
              </tr>
            ) : (
              row.lines.map((line) => {
                const lineTotals = calcLineTotals(line, row.vatExempt)
                return (
                  <tr key={line.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono font-medium text-slate-800">{line.stockCode}</td>
                    <td className="px-3 py-2 text-slate-700">{line.stockName}</td>
                    <td className="px-3 py-2 text-center text-slate-600 font-medium">{getCurrencySymbol(line.currencyCode)}</td>
                    <td className="px-3 py-2 text-right font-medium">{line.quantity}</td>
                    <td className="px-3 py-2 text-right">{formatMoneyWithCurrency(line.unitPrice, line.currencyCode)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatMoneyWithCurrency(lineTotals.total, line.currencyCode)}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    )
  }

  const topBar = (
    <PageHeader
      title="Cari Müşteri Teklifi"
      breadcrumb="Fatura İşlemleri / Cari Müşteri Teklifi"
      searchValue={globalSearch}
      onSearchChange={setGlobalSearch}
      rightActions={
        <button
          type="button"
          onClick={openCreate}
          className="h-[38px] inline-flex items-center gap-2 px-4 text-xs font-semibold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm transition"
        >
          <Plus size={14} />
          Yeni Cari Teklifi
        </button>
      }
    />
  )

  return (
    <div>
      <Modal
        isOpen={confirmOpen}
        onClose={() => {
          if (confirmBusy) return
          setConfirmOpen(false)
          setConfirmOfferId(null)
        }}
        title="Onay"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={confirmBusy}
              onClick={() => {
                setConfirmOpen(false)
                setConfirmOfferId(null)
              }}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={confirmBusy || !confirmOfferId}
              onClick={() => void doDelete()}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-sm transition disabled:opacity-60"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              {confirmBusy ? 'Siliniyor...' : 'Sil'}
            </button>
          </div>
        }
      >
        <div className="text-xs text-gray-700 whitespace-pre-line">{confirmText}</div>
      </Modal>

      {topBar}

      {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}

      <AppDataTable
        onRefresh={() => void loadAll()}
        data={filteredRows}
        columns={cariOfferColumns}
        rowId={(row) => String(row.id)}
        rowClassName={(row) => (row.proformaDocumentNo ? 'bg-amber-100/90 hover:bg-amber-200/90 font-medium text-amber-950 border-b border-amber-200' : '')}
        renderExpandedRow={renderExpandedRowContent}
        rowActions={getRowActions}
        states={{ loading, error: error ?? undefined }}
        filtering={{
          globalFilter: globalSearch,
          onGlobalFilterChange: setGlobalSearch,
          columnFilters: columnFiltersState,
          onColumnFilterChange: (colId, val) => setColumnFiltersState((p) => ({ ...p, [colId]: val }))
        }}
        pagination={{
          pageIndex,
          pageSize,
          totalCount: filteredRows.length,
          pageCount: Math.ceil(filteredRows.length / pageSize),
          onPageChange: setPageIndex,
          onPageSizeChange: setPageSize
        }}
      />

      <Modal
        isOpen={createOpen}
        onClose={closeCreate}
        title={editOfferId ? 'Cari Teklifi (Düzenle)' : 'Cari Teklifi'}
        scrollable
        containerClassName="max-w-7xl"
        footer={
          <>
            <button
              type="button"
              onClick={closeCreate}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={saveDraft}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Kaydet
            </button>
          </>
        }
      >
        {error && <div className="mb-3 text-sm font-semibold text-red-600">{error}</div>}

        <div className="grid grid-cols-12 gap-5">
          <div className="col-span-12 space-y-4">
            <div className="border border-gray-200 rounded-lg bg-white p-4">
              <div className="text-sm font-semibold text-gray-900 mb-3">Teklif Bilgileri</div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                <FormInput label="Belge No" value={draft.documentNo} onChange={() => {}} placeholder="Belge numarası" disabled />

                <FormInput label="Tarih" type="date" value={draft.date} onChange={(e) => updateDraft({ date: e.target.value })} />

                <FormSelect
                  label="Para Birimi"
                  value={String(draft.currencyTypeId ?? 1)}
                  options={currencyOptions}
                  onChange={(e) => {
                    const cid = Number(e.target.value)
                    const curCode = cid === 2 ? 'EUR' : cid === 3 ? 'USD' : cid === 4 ? 'GBP' : 'TRY'
                    setDraft((p) => ({
                      ...p,
                      currencyTypeId: cid,
                      currencyCode: curCode,
                      lines: p.lines.map((l) => ({ ...l, currencyCode: curCode }))
                    }))
                  }}
                />

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Cari</label>
                  <SearchableCariSelect
                    value={draftCustomer}
                    showTypeFilter={false}
                    onChange={(v) => {
                      setDraftCustomer(v)
                      if (String(v).toUpperCase() !== 'MUHTELIF') {
                        const selected = customers.find((c) => c.customerCode === v)
                        const isAcikCari = checkIsAcikFaturaCari(selected)
                        setDraft((p) => ({
                          ...p,
                          customerName: selected ? String(selected.name ?? '') : '',
                          lines: isAcikCari
                            ? p.lines.map((l) => ({ ...l, vatRate: 0, discountType: 'none', discountValue: 0 }))
                            : p.lines
                        }))
                        setDraftSalesRep(String((selected as any)?.salesmanCode ?? ''))
                        if (selected?.isMuhtelif) {
                          setMuhtelifForm({
                            customerCode: selected.customerCode,
                            name: selected.name,
                            city: selected.city ?? '',
                            district: selected.district ?? '',
                            address: selected.address ?? '',
                            phone: selected.phone ?? '',
                            email: selected.email ?? '',
                            taxOffice: selected.taxOffice ?? '',
                            taxNumber: selected.taxNumber ?? ''
                          })
                        } else {
                          setMuhtelifForm({
                            customerCode: '',
                            name: '',
                            city: '',
                            district: '',
                            address: '',
                            phone: '',
                            email: '',
                            taxOffice: '',
                            taxNumber: ''
                          })
                        }
                      } else {
                        setDraft((p) => ({ ...p, customerName: '' }))
                        setDraftSalesRep('')
                        setMuhtelifForm((p) => ({ ...p, customerCode: '' }))
                        const ac = new AbortController()
                        void ensureMuhtelifCustomerCode(ac.signal, { force: true })
                      }
                    }}
                    options={[
                      { value: 'MUHTELIF', label: 'MUHTELIF - Yeni Muhtelif Cari', code: 'MUHTELIF', name: 'Yeni Muhtelif Cari' },
                      ...(customers ?? [])
                        .map((c) => ({
                          value: c.customerCode,
                          label: `${c.customerCode} - ${c.name}`,
                          code: c.customerCode,
                          name: c.name,
                          phone: (c as any).phone ?? (c as any).gsm ?? ''
                        }))
                    ]}
                  />
                </div>

                <FormInput
                  label="Plasiyer Kodu"
                  value={draftSalesRep ? `${draftSalesRep} - ${salesmen.find((s) => s.salesmanCode === draftSalesRep)?.description || ''}` : '—'}
                  disabled
                />

                <div className="flex items-center h-10 px-3 bg-white border border-gray-200 rounded-lg">
                  <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={draft.vatExempt} onChange={(e) => updateDraft({ vatExempt: e.target.checked })} />
                    <span>KDV İstisna</span>
                  </label>
                </div>

                <div className="md:col-span-2 lg:col-span-2">
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Açıklama</label>
                  <textarea
                    className="input-base min-h-[42px] max-h-[80px] text-xs py-2"
                    value={draft.description}
                    onChange={(e) => updateDraft({ description: e.target.value })}
                    placeholder="Açıklama"
                  />
                </div>
              </div>
            </div>

            {(String(draftCustomer ?? '').toUpperCase() === 'MUHTELIF' || customers.find((c) => c.customerCode === draftCustomer)?.isMuhtelif === true) && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <div className="text-sm font-semibold text-gray-900 mb-3">Muhtelif Bilgileri</div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <FormInput
                      label="Muhtelif Cari Kodu"
                      value={muhtelifForm.customerCode}
                      onChange={(e) => setMuhtelifForm((p) => ({ ...p, customerCode: e.target.value }))}
                      placeholder="Muhtelif cari kodu"
                      readOnly
                    />

                    <FormInput
                      label="Muhtelif Cari Adı"
                      value={muhtelifForm.name}
                      onChange={(e) => setMuhtelifForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="Ali"
                    />

                    <FormInput
                      label="İl"
                      value={muhtelifForm.city}
                      onChange={(e) => setMuhtelifForm((p) => ({ ...p, city: e.target.value }))}
                      placeholder="Ankara"
                    />
                    <FormInput
                      label="İlçe"
                      value={muhtelifForm.district}
                      onChange={(e) => setMuhtelifForm((p) => ({ ...p, district: e.target.value }))}
                      placeholder="Çankaya"
                    />
                    <FormInput
                      label="Telefon"
                      value={muhtelifForm.phone}
                      onChange={(e) => {
                        const formatted = formatPhoneNumber(e.target.value)
                        setMuhtelifForm((p) => ({ ...p, phone: formatted }))
                      }}
                      inputMode="numeric"
                      maxLength={PHONE_MAX_LENGTH}
                      placeholder="0555 555 5555 555"
                    />
                    <FormInput
                      label="Email"
                      type="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      value={muhtelifForm.email}
                      onChange={(e) => setMuhtelifForm((p) => ({ ...p, email: e.target.value.toLowerCase() }))}
                      placeholder="ali@example.com"
                    />
                    <FormInput
                      label="Vergi Dairesi"
                      value={muhtelifForm.taxOffice}
                      onChange={(e) => setMuhtelifForm((p) => ({ ...p, taxOffice: e.target.value }))}
                      placeholder="Çankaya"
                    />
                    <FormInput
                      label="Vergi No"
                      value={muhtelifForm.taxNumber}
                      onChange={(e) => setMuhtelifForm((p) => ({ ...p, taxNumber: e.target.value }))}
                      placeholder="1234567890"
                    />

                    <div className="md:col-span-2">
                      <div className="space-y-2">
                        <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide">Adres</label>
                        <textarea
                          className="input-base min-h-[80px]"
                          value={muhtelifForm.address}
                          onChange={(e) => setMuhtelifForm((p) => ({ ...p, address: e.target.value }))}
                          placeholder="Örn: Atatürk Bulvarı No: 10"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
          </div>

          <div className="col-span-12">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-gray-900">Kalemler</div>
            </div>

            <div className="border border-gray-200 rounded-lg bg-white overflow-x-auto">
              <table className="w-full min-w-[980px]">
                <thead>
                  <tr className="bg-gray-50 text-[11px] font-semibold text-gray-600">
                    <th className="px-3 py-2 text-left w-[72px]">Stok</th>
                    <th className="px-3 py-2 text-left">Stok Kodu / Adı</th>
                    <th className="px-3 py-2 text-right w-[110px]">Miktar</th>
                    <th className="px-3 py-2 text-right w-[140px]">Fiyat</th>
                    <th className="px-3 py-2 text-left w-[130px]">İndirim Tipi</th>
                    <th className="px-3 py-2 text-right w-[110px]">İskonto</th>
                    <th className="px-3 py-2 text-right">Net</th>
                    <th className="px-3 py-2 text-right w-[80px]">KDV</th>
                    <th className="px-3 py-2 text-right">KDV Tutar</th>
                    <th className="px-3 py-2 text-right">Toplam</th>
                    <th className="px-3 py-2 text-right w-[60px]" />
                  </tr>
                </thead>

                <tbody className="text-[12px]">
                  {draft.lines.map((l) => {
                    const t = calcLineTotals(l, draft.vatExempt)
                    const stockText = `${(l.stockCode ?? '').trim()} ${(l.stockName ?? '').trim()}`.trim()

                    return (
                      <tr key={l.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-2 align-top">
                          <button
                            type="button"
                            className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                            onClick={() => {
                              openProductPicker(l.id)
                            }}
                          >
                            Seç
                          </button>
                        </td>

                        <td className="px-3 py-2 align-top">
                          <div className="relative w-full">
                            <input
                              className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                              placeholder="Stok Kodu / Adı"
                              value={activeSearchLineId === l.id ? (lineSearchQueries[l.id] ?? '') : stockText}
                              disabled={!draftCustomer}
                              onFocus={(e) => {
                                if (!draftCustomer) return
                                setActiveSearchLineId(l.id)
                                setLineSearchQueries(prev => ({ ...prev, [l.id]: '' }))
                                
                                const rect = e.currentTarget.getBoundingClientRect()
                                setDropdownCoords({
                                  top: rect.bottom,
                                  left: rect.left,
                                  width: rect.width
                                })
                              }}
                              onChange={async (e) => {
                                const q = e.target.value
                                setLineSearchQueries(prev => ({ ...prev, [l.id]: q }))
                                if (q.trim().length >= 3) {
                                  setLineSearchLoading(prev => ({ ...prev, [l.id]: true }))
                                  try {
                                    const mapped = await fetchAndMapProducts(q)
                                    setLineSearchResults(prev => ({ ...prev, [l.id]: mapped }))
                                  } catch (err) {
                                    // eslint-disable-next-line no-console
                                    console.error('search error', err)
                                  } finally {
                                    setLineSearchLoading(prev => ({ ...prev, [l.id]: false }))
                                  }
                                } else {
                                  setLineSearchResults(prev => ({ ...prev, [l.id]: [] }))
                                }
                              }}
                            />
                            
                            {activeSearchLineId === l.id && dropdownCoords && (
                              <>
                                <div 
                                  className="fixed inset-0 z-40" 
                                  onClick={() => {
                                    setActiveSearchLineId(null)
                                  }} 
                                />
                                
                                <div 
                                  style={{
                                    position: 'fixed',
                                    top: `${dropdownCoords.top}px`,
                                    left: `${dropdownCoords.left}px`,
                                    width: `${dropdownCoords.width}px`,
                                    maxHeight: '240px'
                                  }}
                                  className="bg-white border border-gray-300 rounded shadow-lg overflow-y-auto z-50 mt-1"
                                >
                                  {lineSearchLoading[l.id] && (
                                    <div className="p-2 text-xs text-slate-500 text-center">Aranıyor...</div>
                                  )}
                                  
                                  {!lineSearchLoading[l.id] && (lineSearchQueries[l.id] ?? '').trim().length < 3 && (
                                    <div className="p-2 text-xs text-slate-400 text-center">Aramak için en az 3 karakter yazın.</div>
                                  )}
                                  
                                  {!lineSearchLoading[l.id] && (lineSearchQueries[l.id] ?? '').trim().length >= 3 && (lineSearchResults[l.id] ?? []).length === 0 && (
                                    <div className="p-2 text-xs text-slate-500 text-center">Ürün bulunamadı.</div>
                                  )}
                                  
                                  {!lineSearchLoading[l.id] && (lineSearchResults[l.id] ?? []).length > 0 && (
                                    <div className="py-1">
                                      {(lineSearchResults[l.id] ?? []).map((product) => (
                                        <button
                                          key={product.id}
                                          type="button"
                                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100/80 transition flex flex-col gap-0.5 border-b border-gray-100 last:border-b-0"
                                          onMouseDown={(e) => {
                                            e.preventDefault()
                                            setProductPickerForLineId(l.id)
                                            selectProductForLine(product, l.id)
                                            setActiveSearchLineId(null)
                                          }}
                                        >
                                          <span className="font-bold text-gray-900">{product.stockCode}</span>
                                          <span className="text-gray-600 line-clamp-2 whitespace-normal break-words">{product.name}</span>
                                          <span className="text-[10px] text-blue-600 font-semibold mt-0.5">
                                            Fiyat: {product.__basePrice?.toFixed(2)} {product.__baseCurrency}
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </td>

                        <td className="px-3 py-2 align-top text-right">
                          <input
                            type="number"
                            min={0}
                            className="w-[100px] px-2 py-1 text-xs border border-gray-300 rounded text-right"
                            value={String(l.quantity)}
                            onChange={(e) => updateLine(l.id, { quantity: Math.max(0, Number(e.target.value)) })}
                          />
                        </td>

                        <td className="px-3 py-2 align-top text-right">
                          <input
                            type="number"
                            className="w-[120px] px-2 py-1 text-xs border border-gray-300 rounded text-right bg-gray-50"
                            value={String(l.unitPrice)}
                            onChange={() => {}}
                            readOnly
                          />
                          <div className="text-[9px] text-gray-400 mt-0.5 text-right font-medium">
                            {getCurrencySymbol(l.currencyCode)}
                          </div>
                        </td>

                        <td className="px-3 py-2 align-top">
                          <select
                            className="w-[120px] px-2 py-1 text-xs border border-gray-300 rounded"
                            value={l.discountType}
                            onChange={(e) => updateLine(l.id, { discountType: e.target.value as DiscountType, discountValue: 0 })}
                          >
                            {discountTypeOptions.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="px-3 py-2 align-top text-right">
                          <input
                            type="number"
                            min={0}
                            className="w-[90px] px-2 py-1 text-xs border border-gray-300 rounded text-right"
                            value={String(l.discountValue)}
                            onChange={(e) => updateLine(l.id, { discountValue: Math.max(0, Number(e.target.value)) })}
                            disabled={l.discountType === 'none'}
                          />
                        </td>

                        <td className="px-3 py-2 align-top text-right">{formatMoneyWithCurrency(t.net, l.currencyCode)}</td>

                        <td className="px-3 py-2 align-top text-right">
                          <input
                            type="number"
                            min={0}
                            className="w-[70px] px-2 py-1 text-xs border border-gray-300 rounded text-right"
                            value={String(l.vatRate)}
                            onChange={(e) => updateLine(l.id, { vatRate: Math.max(0, Number(e.target.value)) })}
                            disabled={draft.vatExempt}
                          />
                        </td>

                        <td className="px-3 py-2 align-top text-right">{formatMoneyWithCurrency(t.vatAmount, l.currencyCode)}</td>
                        <td className="px-3 py-2 align-top text-right font-semibold">{formatMoneyWithCurrency(t.total, l.currencyCode)}</td>

                        <td className="px-3 py-2 align-top text-right">
                          <button
                            type="button"
                            onClick={() => removeLine(l.id)}
                            className="inline-flex items-center justify-center w-8 h-8 rounded hover:bg-red-50"
                            title="Sil"
                          >
                            <Trash2 size={16} className="text-red-600" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 font-semibold"
              >
                <Plus size={16} />
                Satır Ekle
              </button>
            </div>

            <div className="mt-4 border border-gray-200 rounded-lg bg-gray-50 p-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="text-gray-600">Ara Toplam</div>
                <div className="text-right font-semibold text-gray-900">{formatMoneyWithCurrency(draftTotals.subTotal, draftCurrency)}</div>

                <div className="text-gray-600">İndirim</div>
                <div className="text-right font-semibold text-gray-900">{formatMoneyWithCurrency(draftTotals.discountTotal, draftCurrency)}</div>

                <div className="text-gray-600">Net Toplam</div>
                <div className="text-right font-semibold text-gray-900">{formatMoneyWithCurrency(draftTotals.netTotal, draftCurrency)}</div>

                <div className="text-gray-600">KDV Toplam</div>
                <div className="text-right font-semibold text-gray-900">{formatMoneyWithCurrency(draftTotals.vatTotal, draftCurrency)}</div>

                <div className="text-gray-800">Genel Toplam</div>
                <div className="text-right font-bold text-gray-900">{formatMoneyWithCurrency(draftTotals.grandTotal, draftCurrency)}</div>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={productPickerOpen}
        onClose={closeProductPicker}
        title="Ürün Seç"
        scrollable
        containerClassName="max-w-4xl"
        footer={
          <>
            <button
              type="button"
              onClick={closeProductPicker}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition"
            >
              Kapat
            </button>
          </>
        }
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1">
            <FormInput label="Ara" value={productPickerQuery} onChange={(e) => setProductPickerQuery(e.target.value)} placeholder="Stok kodu / ürün adı" />
          </div>
          <button
            type="button"
            onClick={() => searchProducts(productPickerQuery)}
            className="mt-6 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 font-semibold"
          >
            <Search size={16} />
            Ara
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <FormSelect
            label="Ana Kategori"
            value={pickerMainCat}
            onChange={(e) => {
              const v = e.target.value
              setPickerMainCat(v)
              setPickerSubCat('')

              if (v) {
                void searchProducts(productPickerQuery, { main: v, sub: '' })
              } else {
                setProductPickerItems([])
              }
            }}
            options={[{ value: '', label: 'Tümü' }, ...categoriesState.mains.map((m) => ({ value: m, label: m }))]}
          />
          <FormSelect
            label="Alt Kategori"
            value={pickerSubCat}
            onChange={(e) => {
              const v = e.target.value
              setPickerSubCat(v)
              void searchProducts(productPickerQuery, { sub: v })
            }}
            options={[{ value: '', label: 'Tümü' }, ...(categoriesState.subsByMain[pickerMainCat] ?? []).map((s) => ({ value: s, label: s }))]}
            disabled={!pickerMainCat}
          />
        </div>

        {productPickerError && <div className="mb-3 text-sm font-semibold text-red-600">{productPickerError}</div>}

        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-[11px] font-semibold text-gray-600">
                <th className="px-3 py-2 text-left">Stok Kodu</th>
                <th className="px-3 py-2 text-left">Ürün Adı</th>
                <th className="px-3 py-2 text-right">Fiyat</th>
                <th className="px-3 py-2 text-right w-[80px]" />
              </tr>
            </thead>
            <tbody className="text-[12px]">
              {productPickerLoading ? (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-sm text-gray-500">
                    Yükleniyor...
                  </td>
                </tr>
              ) : productPickerItems.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-sm text-gray-400 text-center font-medium">
                    {!productPickerQuery.trim() ? 'Aramak için birkaç cümle yazın.' : 'Ürün bulunamadı.'}
                  </td>
                </tr>
              ) : (
                productPickerItems.map((p) => (
                  <tr key={String(p.id)} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 align-top">{String(p.stockCode ?? '')}</td>
                    <td className="px-3 py-2 align-top">{String(p.name ?? '')}</td>
                    <td className="px-3 py-2 align-top text-right">{p?.__basePrice == null ? '-' : formatMoneyWithCurrency(Number(p.__basePrice ?? 0), p.__baseCurrency)}</td>
                    <td className="px-3 py-2 align-top text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => selectProductAndAddLine(p)}
                          className="inline-flex items-center justify-center h-8 px-3 rounded border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold"
                          title="Satıra ekle ve yeni satır aç"
                        >
                          Satıra Ekle
                        </button>
                      <button
                        type="button"
                        onClick={() => selectProductForLine(p)}
                        className="inline-flex items-center justify-center w-8 h-8 rounded border border-gray-200 bg-white hover:bg-gray-50"
                        title="Seç"
                      >
                        <Plus size={16} />
                      </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Modal>

      <Modal
        isOpen={msgModalOpen}
        onClose={() => setMsgModalOpen(false)}
        title={msgModalTitle}
        footer={
          <button
            type="button"
            onClick={() => setMsgModalOpen(false)}
            className="h-[34px] px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
          >
            Tamam
          </button>
        }
      >
        <div className="text-xs text-gray-700 whitespace-pre-line">{msgModalText}</div>
      </Modal>

      <Modal
        isOpen={proformaTransferModalOpen}
        onClose={() => {
          setProformaTransferModalOpen(false)
          setTransferredProformaId(null)
        }}
        title="Proformaya Aktarıldı"
        containerClassName="max-w-md text-center"
      >
        <div className="flex flex-col items-center justify-center p-4">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mb-4 border border-emerald-100">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-4">Proformaya Aktarma Başarılı</h3>
          
          <div className="flex items-center justify-center gap-3 w-full">
            <button
              type="button"
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-gray-700 transition"
              onClick={() => {
                setProformaTransferModalOpen(false)
                setTransferredProformaId(null)
              }}
            >
              Kapat
            </button>
            <button
              type="button"
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-700 text-white shadow-sm transition inline-flex items-center gap-1.5"
              onClick={async () => {
                if (transferredProformaId) {
                  try {
                    await printProforma(transferredProformaId, 'cari', true)
                  } catch (e: any) {
                    showMessage('Hata', String(e?.message ?? 'Görüntülenemedi'))
                  }
                }
                setProformaTransferModalOpen(false)
                setTransferredProformaId(null)
              }}
            >
              <Eye size={14} />
              Görüntüle
            </button>
            <button
              type="button"
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition inline-flex items-center gap-1.5"
              onClick={async () => {
                if (transferredProformaId) {
                  try {
                    await printProforma(transferredProformaId, 'cari', false)
                  } catch (e: any) {
                    showMessage('Hata', String(e?.message ?? 'Yazdırılamadı'))
                  }
                }
                setProformaTransferModalOpen(false)
                setTransferredProformaId(null)
              }}
            >
              <Printer size={14} />
              Yazdır
            </button>
          </div>
        </div>
      </Modal>

      <div />
    </div>
  )
}
