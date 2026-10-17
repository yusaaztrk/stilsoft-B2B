import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { fetchAllPages } from '../lib/fetchAllPages'
import { normalizeDiscountType } from '../utils/discountType'
import { PHONE_MAX_LENGTH, formatPhoneNumber } from '../utils/phone'
import { ChevronDown, ChevronRight, Copy, Eye, Gift, ListFilter, Mail, Pencil, Phone, Plus, Printer, Search, Trash2, User } from 'lucide-react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { fetchLatestFxRate } from '../api/fx'
import { API_BASE_URL } from '../config/api'
import Modal from '../components/Modal'
import PageHeader from '../components/PageHeader'
import FormInput from '../components/forms/FormInput'
import FormSelect from '../components/forms/FormSelect'
import SearchableCariSelect, { type CariOption } from '../components/SearchableCariSelect'
import { CARI_SEARCH_LIMIT, buildCariSearchQuery } from '../utils/cariRemoteSearch'
import ColumnFilterSearchBar from '../components/table/ColumnFilterSearchBar'
import { fetchCustomerByCode, fetchCustomersDropdown, type CustomerDto } from '../api/customers'
import { fetchSalesmenDropdown, type SalesmanDropdownItem } from '../api/salesmen'
import { fetchCustomerAuthorizedContact } from '../api/customerAuthorizedContacts'
import {
  createCustomerOffer,
  deleteCustomerOffer,
  getCustomerOffer,
  transferCustomerOfferToProforma,
  updateCustomerOffer,
  fetchCustomerOffers,
  fetchNewCustomerOfferDocumentNo,
  fetchNextMuhtelifCustomerCode,
  createOfferCari,
  type CustomerOfferListItemDto
} from '../api/customerOffers'
import { fetchProductCategoriesStateForDealer, type ProductCategoryStateResponse } from '../api/productCategories'
import { fetchProducts } from '../api/products'
import { fetchActiveCampaigns, type ActiveCampaignDto } from '../api/campaigns'
import { campaignPriceForProduct, campaignPriceGroupScope } from '../services/campaignApplier'
import { fetchProductPricesByProducts, type ProductPriceResponse } from '../api/productPrices'
import { fetchPriceGroups, type PriceGroupDto } from '../api/priceGroups'
import { resolveMuhtelifPriceGroupId, MUHTELIF_PRICE_GROUP_CODE } from '../utils/muhtelifPricing'
import { printProforma } from '../utils/proformaPrint'
import { AppDataTable, type DataTableRowAction } from '../components/data-table'
import type { ColumnDef } from '@tanstack/react-table'

type LayoutContext = {
  isSuperAdmin?: boolean
  allowedKeys?: Set<string>
  userDiscountRate?: number | null
  userRoleId?: number | null
  currentCode?: string
  salesmanCode?: string
}

type DiscountType = 'none' | 'amount' | 'percentage'

type OfferLine = {
  id: string
  productId?: string
  stockCode: string
  stockName: string
  quantity: number
  unitPrice: number
  originalUnitPrice: number
  price3?: number
  discountType: DiscountType
  discountValue: number
  vatRate: number
  currencyCode?: any
  /**
   * DÜZENLEMEYE AÇILAN kayıtlı satırın, açıldığı andaki indirimli net birim fiyatı (KDV hariç).
   * Kaydetmede indirim sınırı kontrolü bu satırı, kullanıcı indirimi DAHA DA artırmadıkça
   * geçirir: kayıtlı teklifte açıklamayı düzeltmek, sonradan değişen liste fiyatı yüzünden
   * "yetkiniz yok" ile engellenmesin. Yeni satırda ve KOPYADA boştur (kopya yeni tekliftir,
   * sınır baştan uygulanır). Ekran durumu — sunucuya gönderilmez.
   */
  loadedNetUnit?: number
  /*
    KAMPANYA SATIRI (2026-09-20 kullanıcı isteği: "Kampanya Kullan ile kampanya fiyatları satır
    olarak gelsin, fiyat normal teklifteki gibi override edilemesin, sabit kalsın").
    Kilitli satırda ürün, fiyat ve indirim alanları değiştirilemez; yalnız miktar ve silme.
    Ekran durumu — kaydedilen teklife yazılmaz.
  */
  campaignLocked?: boolean
  campaignName?: string
}

type CustomerOffer = {
  id: number | string
  date: string
  documentNo: string
  customerCode: string
  customerName: string
  deliveryCustomerCode?: string | null
  deliveryCustomerName?: string | null
  description: string
  vatExempt: boolean
  createUser?: string
  proformaDocumentNo?: string | null
  currencyTypeId?: number
  currencyCode?: string
  lines: OfferLine[]
}

type ColumnKey = 'date' | 'documentNo' | 'customerCode' | 'customerName' | 'deliveryCustomerName' | 'description' | 'vatExempt' | 'createUser'

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

export function buildOfferHtml(dto: any, templateType: 'standard' | 'simple' | 'usd' | 'landscape', onlyView?: boolean) {
  const dateStr = formatDateTr(dto.date)
  const teklifVeren = dto.salesmanName || dto.salesmanCode || dto.createUser || '—'
  const cityDistrict = [dto.customerDistrict, dto.customerCity].filter(Boolean).join(', ')

  const docCurrency = (() => {
    const cid = Number(dto.currencyTypeId ?? 0)
    if (cid === 2) return 'EUR'
    if (cid === 3) return 'USD'
    if (cid === 4) return 'GBP'
    return getInvoiceCurrency(dto.lines)
  })()

  const formatMoneyTemplate = (v: number) => {
    const formatted = formatNumberTr(v)
    if (templateType === 'usd' || docCurrency === 'USD') return `${formatted} $`
    if (docCurrency === 'EUR') return `${formatted} €`
    if (docCurrency === 'GBP') return `${formatted} £`
    return `${formatted} ₺`
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

  /*
    YATAY BASIM — ürün kartları (2026-09-05 kullanıcı isteği).

    Tablo değil KUTU düzeni: her ürün kendi çerçevesinde, üstte görsel, altında ad + kategori,
    en altta özellikler ve fiyat. Sayfa yatay olduğu için yan yana üç kutu sığıyor, kutular
    aşağı doğru akıyor.

    ÖZELLİK METNİ ÇOK UZUN OLABİLİYOR ve asıl risk bu:
      - kutu yüksekliği sabitlenmedi, içeriğe göre uzuyor;
      - `break-inside: avoid` ile bir kutu iki sayfaya bölünmüyor;
      - satırdaki kutular `align-items: stretch` ile aynı boya geliyor, kısa özellikli ürün
        yanındaki uzun olanla hizalı duruyor;
      - özellik alanı küçük punto + sıkı satır aralığı, taşarsa kutu uzar (kırpılmaz —
        kırpmak müşteriye eksik bilgi göstermek demek).
  */
  const landscapeCardsHtml = dto.lines.map((l: any) => {
    const qty = l.quantity || 0
    const price = l.unitPrice || 0
    const base = qty * price
    const dType = typeof l.discountType === 'string' ? l.discountType.toLowerCase() : l.discountType
    let discount = 0
    if (dType === 1 || dType === 'amount') {
      discount = (l.discountValue || 0) * qty
    } else if (dType === 2 || dType === 'percentage') {
      discount = (base * (l.discountValue || 0)) / 100
    }
    discount = Math.min(discount, base)
    const net = base - discount
    const discountedPrice = qty > 0 ? net / qty : price
    const ozellik = String(l.productDescription || l.description || '').trim()
    const kategori = String(l.categoryName || '').trim()

    return `
      <div class="urun-kutu">
        <div class="urun-gorsel">
          ${l.imageUrl
            ? `<img src="${getProductImageUrl(l.imageUrl)}" alt="" />`
            : '<div class="gorsel-yok">Görsel yok</div>'}
        </div>
        <div class="urun-ad">${l.stockName || ''}</div>
        ${kategori ? `<div class="urun-kategori">${kategori}</div>` : ''}
        <div class="urun-kod">${l.stockCode || ''}${l.barcode ? ` &middot; ${l.barcode}` : ''}</div>
        ${ozellik ? `<div class="urun-ozellik">${ozellik}</div>` : ''}
        <div class="urun-fiyat">
          <div class="fiyat-satir"><span>Adet</span><b>${qty}</b></div>
          <div class="fiyat-satir"><span>Birim</span><b>${formatMoneyTemplate(price)}</b></div>
          ${discount > 0 ? `<div class="fiyat-satir"><span>İndirimli</span><b>${formatMoneyTemplate(discountedPrice)}</b></div>` : ''}
          <div class="fiyat-satir toplam"><span>Tutar</span><b>${formatMoneyTemplate(net)}</b></div>
        </div>
      </div>
    `
  }).join('')

  const columnsHeaderHtml = templateType === 'simple'
    ? `
      <tr>
        <th style="width: 20%;">BARKOD</th>
        <th style="width: 45%;">STOK ADI</th>
        <th style="width: 6%;">ADET</th>
        <th style="width: 9%;">BİRİM FİYAT</th>
        <th style="width: 6%;">KDV</th>
        <th style="width: 9%;">İNDİRİMLİ FİYAT</th>
        <th style="width: 10%;">ARA TOPLAM</th>
      </tr>
    `
    : `
      <tr>
        <th style="width: 12%;">ÜRÜN GÖRSELİ</th>
        <th style="width: 15%;">BARKOD STOK KODU</th>
        <th style="width: 38%;">STOK ADI ÜRÜN ÖZELLİKLERİ</th>
        <th style="width: 5%;">ADET</th>
        <th style="width: 8%;">BİRİM FİYAT</th>
        <th style="width: 5%;">KDV</th>
        <th style="width: 8%;">İNDİRİMLİ FİYAT</th>
        <th style="width: 9%;">ARA TOPLAM</th>
      </tr>
    `

  return `
    <!DOCTYPE html>
    <html lang="tr">
    <head>
      <meta charset="UTF-8">
      <title>Müşteri Teklifi - ${dto.documentNo || 'Basım'}</title>
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
          max-width: ${templateType === 'landscape' ? '1180px' : '820px'};
          margin: 0 auto;
        }

        /* ---- YATAY BASIM: ürün kutuları ---- */
        .urun-izgara {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          align-items: stretch;
          margin-top: 10px;
        }
        .urun-kutu {
          border: 1px solid #000;
          border-radius: 4px;
          padding: 8px;
          display: flex;
          flex-direction: column;
          /* Kutu iki sayfaya BÖLÜNMESİN; uzun özellikli üründe en çok işe yarayan kural bu. */
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .urun-gorsel {
          height: 105px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 6px;
        }
        .urun-gorsel img {
          max-height: 105px;
          max-width: 100%;
          object-fit: contain;
        }
        .gorsel-yok {
          font-size: 9px;
          color: #999;
        }
        .urun-ad {
          font-weight: 700;
          font-size: 10.5px;
          line-height: 1.25;
          border-top: 1px solid #000;
          padding-top: 5px;
        }
        .urun-kategori {
          font-size: 9px;
          color: #555;
          margin-top: 2px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .urun-kod {
          font-size: 8.5px;
          color: #777;
          margin-top: 2px;
        }
        .urun-ozellik {
          font-size: 8.5px;
          line-height: 1.35;
          color: #333;
          white-space: pre-wrap;
          margin-top: 5px;
          padding-top: 5px;
          border-top: 1px dashed #999;
          /* Uzun metin kutuyu uzatır, KIRPILMAZ: eksik özellik göstermek yanlış bilgi olur. */
          flex: 1 1 auto;
          overflow-wrap: anywhere;
        }
        .urun-fiyat {
          margin-top: 6px;
          padding-top: 5px;
          border-top: 1px solid #000;
        }
        .fiyat-satir {
          display: flex;
          justify-content: space-between;
          font-size: 9px;
          line-height: 1.5;
        }
        .fiyat-satir.toplam {
          font-size: 10.5px;
          font-weight: 700;
          border-top: 1px solid #ccc;
          margin-top: 3px;
          padding-top: 3px;
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
          width: 12%;
        }
        .info-table td {
          width: 21%;
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
        .totals-table {
          border-collapse: collapse;
          margin-left: auto;
          font-size: 10px;
        }
        .totals-table td {
          border: 1px solid #000;
          padding: 5px 10px;
        }
        .totals-table td.label {
          font-weight: bold;
          background-color: #ffffff;
          width: 220px;
          text-align: left;
        }
        .totals-table td.value {
          width: 120px;
          text-align: right;
        }
        .footer-section {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-top: 20px;
          page-break-inside: avoid;
        }
        .terms-box {
          font-size: 10px;
          font-weight: bold;
          line-height: 1.8;
        }
        .terms-red {
          color: #ff0000;
        }
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            padding: 0;
            background-color: white !important;
            color: black !important;
          }
          @page {
            size: ${templateType === 'landscape' ? 'A4 landscape' : 'A4'};
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
            Örnek Mah. Demo Cad. No:1<br>
            99010 Lefkoşa - KKTC<br>
            T: +90 850 000 00 00 - F: +90 850 000 00 01<br>
            info@example.com<br>
            V.D.: Demo V.N.: 0000000
          </div>
        </div>

        ${headerTableHtml}

        ${templateType === 'landscape'
          ? `<div class="urun-izgara">${landscapeCardsHtml}</div>`
          : `
        <table class="details-table">
          <thead>
            ${columnsHeaderHtml}
          </thead>
          <tbody>
            ${linesHtml}
          </tbody>
        </table>`}

        <div class="footer-section">
          <div class="terms-box">
            ${termsHtml}
          </div>
          <table class="totals-table">
            <tbody>
              ${totalsRowsHtml}
            </tbody>
          </table>
        </div>
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
  // TUTAR İNDİRİMİ ADET BAŞINADIR (2026-08-22 kullanıcı kuralı).
  // Değer satırın tamamına uygulanıyordu; oysa indirim kutusu TEK ürünün fiyatıyla
  // sınırlanıyor (aşağıdaki `maxVal`), yani alan zaten adet başına tasarlanmıştı.
  if (line.discountType === 'amount') discount = Math.max(0, dv) * qty
  if (line.discountType === 'percentage') discount = Math.max(0, (base * dv) / 100)
  discount = Math.min(discount, base)

  const net = base - discount
  const vatRate = Math.max(0, safeNumber(line.vatRate ?? 0))
  const vatAmount = (vatExempt || vatRate === 0) ? 0 : (net * vatRate) / 100
  const total = net + vatAmount

  /*
    INDIRIM SONRASI BIRIM FIYAT (2026-08-24, kullanici istegi).

    Tabloda fiyat, indirim tipi ve iskonto vardi ama indirimin birim fiyata ne yaptigi
    gorunmuyordu; kullanici her satirda kafadan hesapliyordu. `net` satirin TAMAMI oldugu
    icin adede bolunuyor — tutar indirimi zaten adet basina uygulaniyor (yukaridaki kural),
    dolayisiyla iki yol da ayni sonucu veriyor.

    Miktar 0 ise bolme yapilmaz; 0 donmek "indirimli fiyat sifir" gibi okunurdu, o yuzden
    ham fiyat donuyor.
  */
  const netUnit = qty > 0 ? net / qty : price

  return { base, discount, net, netUnit, vatAmount, total }
}

function calcOfferTotals(offer: Pick<CustomerOffer, 'lines' | 'vatExempt'>) {
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
    originalUnitPrice: 0,
    price3: 0,
    discountType: 'none',
    discountValue: 0,
    vatRate: 0,
    currencyCode: '0'
  }
}

function createEmptyOffer(): CustomerOffer {
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
    deliveryCustomerCode: '',
    deliveryCustomerName: '',
    description: '',
    vatExempt: false,
    createUser: '',
    lines: []
  }
}

const discountTypeOptions = [
  { value: 'none', label: 'Yok' },
  { value: 'amount', label: 'Tutar' },
  { value: 'percentage', label: 'Oran' }
]

function getVatMultiplier(line: OfferLine, vatExempt: boolean) {
  if (vatExempt) return 1
  const vatRate = Math.max(0, safeNumber(line.vatRate ?? 0))
  return 1 + vatRate / 100
}

/**
 * SINIRSIZ İNDİRİM (2026-08-22 kullanıcı isteği).
 *
 * Normalde satırın net birim fiyatı taban fiyat grubunun (TOPTAN F) altına inemez; indirim
 * kutusu "Maks %…" ile sınırlanır. `sinirsiz` verildiğinde taban tamamen kalkar.
 *
 * Bayrak parametre olarak geçiyor çünkü bu yardımcılar bileşenin DIŞINDA tanımlı ve yetkiye
 * erişimleri yok. Ekran kontrolü tek başına yeterli değil — asıl kapı sunucuda
 * (`CariOffersController.ValidatePriceFloorAsync`); burası yalnızca kullanıcıyı boşuna
 * uğraştırmamak için.
 */
function getDiscountLimits(line: OfferLine, vatExempt: boolean, userDiscountRate: number | null, sinirsiz = false) {
  const rate = safeNumber(userDiscountRate ?? 0)
  const qty = safeNumber(line.quantity ?? 1)
  const origPrice = safeNumber(line.originalUnitPrice ?? 0)
  const price = safeNumber(line.unitPrice ?? 0)
  const p3 = safeNumber(line.price3 ?? 0)
  
  const mult = getVatMultiplier(line, vatExempt)
  
  // Minimum unit price floor: max(price3, originalUnitPrice × (1 - rate/100))
  const discountFloor = origPrice > 0 ? origPrice * (1 - rate / 100) : 0
  const minUnitPrice = p3 > 0 ? Math.max(p3, discountFloor) : discountFloor
  
  // Max total allowed discount (tax-inclusive) considering both price3 floor and discount rate
  // Sınırsız yetkide taban sıfır: indirim ürünün tamamına kadar inebilir.
  const etkinTaban = sinirsiz ? 0 : minUnitPrice
  const maxTotalDiscountInc = Math.max(0, (origPrice - etkinTaban)) * qty * mult
  
  // Discount already given by price override (tax-inclusive)
  const overrideDiscountInc = Math.max(0, (origPrice - price) * qty * mult)
  
  // Remaining allowed line discount (tax-inclusive)
  const maxRemainingDiscountInc = Math.max(0, maxTotalDiscountInc - overrideDiscountInc)
  
  // Remaining allowed line discount (tax-exclusive)
  const maxRemainingDiscountExc = mult > 0 ? maxRemainingDiscountInc / mult : maxRemainingDiscountInc
  
  // Max percentage value user can enter
  const maxPercentage = (price * qty) > 0 ? (maxRemainingDiscountExc * 100) / (price * qty) : 0
  
  return {
    maxTotalDiscountInc,
    overrideDiscountInc,
    maxRemainingDiscountInc,
    maxPercentage,
    maxRemainingDiscountExc,
    minUnitPrice: etkinTaban,
    sinirsiz
  }
}

function getCappedLineDiscount(line: OfferLine, activeDiscountRate: number | null, vatExempt: boolean, sinirsiz = false) {
  if (activeDiscountRate == null) {
    if (line.discountType === 'amount') {
      return Math.max(0, Math.min(line.discountValue ?? 0, safeNumber(line.unitPrice)))
    }
    if (line.discountType === 'percentage') {
      return Math.max(0, Math.min(line.discountValue ?? 0, 100))
    }
    return line.discountValue
  }
  
  const limits = getDiscountLimits(line, vatExempt, activeDiscountRate, sinirsiz)
  
  if (line.discountType === 'percentage') {
    return Math.max(0, Math.min(line.discountValue ?? 0, 100, Number(limits.maxPercentage.toFixed(4))))
  } else if (line.discountType === 'amount') {
    // ÜST SINIR ADET BAŞINA: tutar indirimi artık her ürüne ayrı uygulanıyor, dolayısıyla
    // sınır satır toplamı değil TEK ürünün fiyatı. Taban fiyattan gelen kalan indirim payı da
    // adede bölünerek karşılaştırılıyor.
    const adet = Math.max(1, safeNumber(line.quantity ?? 1))
    const birimTavan = safeNumber(line.unitPrice)
    const tabanPayi = limits.maxRemainingDiscountExc / adet
    return Math.max(0, Math.min(line.discountValue ?? 0, birimTavan, Number(tabanPayi.toFixed(4))))
  }
  
  return 0
}

function getCoreCode(code: string) {
  if (!code) return ''
  if (/^\d{3}-/.test(code)) {
    return code.substring(4)
  }
  return code
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

/**
 * Secim kutusunun seceneklerini kurar. Muhtelif HER ZAMAN basta durur (listede olmasa bile
 * secilebilmeli), gerisi secili plasiyerin carileri.
 */
/*
 * SEÇİLİ CARİ HER ZAMAN SEÇENEKLERDE (2026-10-11, kullanıcı bildirimi: "düzenle deyince cari ismi
 * gelmiyor"). Liste plasiyere göre süzülüyor; teklifin carisinin plasiyeri teklifteki plasiyerden
 * farklıysa (cari sonradan başka plasiyere verilmiş ya da plasiyeri boş) cari kayıt olarak yüklü
 * olsa bile seçeneklerden düşüyor ve kutu boş görünüyordu. `selectedCode` verilirse o cari
 * plasiyer süzgecinden muaf tutulur; yalnız GÖSTERİM içindir, arama sonuçlarını genişletmez.
 */
function buildCustomerOfferOptions(customers: any[], salesRep: string, selectedCode?: string): CariOption[] {
  const secili = String(selectedCode ?? '').trim()
  const scoped = (customers ?? []).filter(
    (c) => (Boolean(salesRep) && c.salesmanCode === salesRep) || (Boolean(secili) && c.customerCode === secili)
  )
  return [
    { value: 'MUHTELIF', label: 'MUHTELIF - Muhtelif Cari', code: 'MUHTELIF', name: 'Muhtelif Cari' },
    ...scoped
      .filter((c) => c.customerCode !== 'MUHTELIF')
      .map((c) => ({
        value: c.customerCode,
        label: `${c.customerCode} - ${c.name}`,
        code: c.customerCode,
        name: c.name,
        phone: (c as any).phone ?? (c as any).gsm ?? ''
      }))
  ]
}

export default function CustomerOfferPage() {
  const { isSuperAdmin, allowedKeys, userDiscountRate, userRoleId, currentCode, salesmanCode } = useOutletContext<LayoutContext>()

  /**
   * SINIRSIZ İNDİRİM yetkisi — taban fiyat (TOPTAN F) sınırını kaldırır.
   *
   * SSA ayrıca kontrol ediliyor: SSA'da `allowedKeys` BOŞ küme geliyor (menü ayrı yoldan
   * açılıyor) ve bu yetki bir kısıtlamayı KALDIRDIĞI için boş küme onu ters yönde
   * engellerdi — aynı tuzak `stokYokSiparis`te de yaşandı.
   */
  const sinirsizIndirim =
    Boolean(isSuperAdmin) || Boolean(allowedKeys?.has('invoice/musteriTeklifiSinirsizIndirim'))

  /**
   * TAM STOK ADEDİ (2026-09-17). Satış Faturası ve Depo Transfer'deki kuralın AYNISI:
   * admin ya da "Depo Stok Bilgisi" (`invoice/satisFaturaDepoBakiyeGorsun`) yetkisi olan rol
   * gerçek adedi görür, diğerlerinde 12 üstü "12+". Ürün Seç penceresi bu yetkiye hiç
   * bakmıyordu; yetkili rol de admin de "12+" görüyordu.
   */
  const tamStokGorsun =
    Boolean(isSuperAdmin) || Boolean(allowedKeys?.has('invoice/satisFaturaDepoBakiyeGorsun'))
  const navigate = useNavigate()

  const canDuzenle =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/musteriTeklifi')) && Boolean(allowedKeys?.has('invoice/musteriTeklifiDuzenle')))

  const canSil =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/musteriTeklifi')) && Boolean(allowedKeys?.has('invoice/musteriTeklifiSil')))

  const canProformaAktar =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/musteriTeklifi')) && Boolean(allowedKeys?.has('invoice/musteriTeklifiProformaAktar')))

  const canBasim =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/musteriTeklifi')) && Boolean(allowedKeys?.has('invoice/musteriTeklifiBasim')))

  /**
   * "Cari Ekle" düğmesi — rol yetkisine bağlı (`invoice/musteriTeklifiCariEkle`).
   * Diğer alt yetkilerle aynı kalıp: rol adı koda YAZILMAZ, karar tek kaynaktan gelir.
   */
  const canCariEkle =
    Boolean(isSuperAdmin) ||
    (Boolean(allowedKeys?.has('invoice/musteriTeklifi')) && Boolean(allowedKeys?.has('invoice/musteriTeklifiCariEkle')))

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [priceWarning, setPriceWarning] = useState<string | null>(null)

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

  const [rows, setRows] = useState<CustomerOffer[]>([])

  const [customersLoading, setCustomersLoading] = useState(false)
  const [customers, setCustomers] = useState<CustomerDto[]>([])

  const [salesmenLoading, setSalesmenLoading] = useState(false)
  const [salesmen, setSalesmen] = useState<SalesmanDropdownItem[]>([])

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const [actionsOpenForId, setActionsOpenForId] = useState<string | null>(null)
  const [printMenuOpenId, setPrintMenuOpenId] = useState<string | null>(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [confirmOfferId, setConfirmOfferId] = useState<number | null>(null)

  const [msgModalOpen, setMsgModalOpen] = useState(false)
  const [msgModalTitle, setMsgModalTitle] = useState('')
  const [msgModalText, setMsgModalText] = useState('')

  const [successPrintModalOpen, setSuccessPrintModalOpen] = useState(false)
  const [savedOfferId, setSavedOfferId] = useState<number | string | null>(null)
  const [selectedPrintTemplate, setSelectedPrintTemplate] = useState<string>('')

  const [proformaTransferModalOpen, setProformaTransferModalOpen] = useState(false)
  const [transferredProformaId, setTransferredProformaId] = useState<number | null>(null)

  const showMessage = (title: string, text: string) => {
    setMsgModalTitle(title)
    setMsgModalText(text)
    setMsgModalOpen(true)
  }

  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState(() => createEmptyOffer())
  const [editOfferId, setEditOfferId] = useState<number | null>(null)
  // Kopyalanan teklifin id'si (yalnız muhtelif kaynakta dolu) — bkz. openEdit.
  const [copySourceOfferId, setCopySourceOfferId] = useState<number | null>(null)

  const [draftCustomer, setDraftCustomer] = useState('')
  // Seçili carinin kodu, arama geri çağrısının (useCallback) içinden okunabilsin diye.
  const draftCustomerRef = useRef('')
  draftCustomerRef.current = draftCustomer
  const [draftSalesRep, setDraftSalesRep] = useState('')
  const [draftDeliveryCustomer, setDraftDeliveryCustomer] = useState('')

  const deliveryOptions = useMemo(() => {
    if (!draftCustomer || draftCustomer.toUpperCase() === 'MUHTELIF') return []
    const parent = customers.find((c) => c.customerCode === draftCustomer)
    if (!parent) return []

    const core = getCoreCode(draftCustomer)
    const subBranches = customers.filter(
      (c) => c.customerCode && c.customerCode.startsWith(core + '-')
    )

    return [parent, ...subBranches]
  }, [draftCustomer, customers])

  /**
   * KULLANICININ KENDI CARISI AYRI COZULUR.
   *
   * `filteredSalesmen` bu kaydi eskiden tam liste icinde ariyordu. Liste artik yalnizca son
   * aramanin sonucu; kayit orada olmayabilir ve plasiyer kisiti sessizce kalkardi. Tek
   * satirlik istek bu bagi koruyor.
   */
  const [ownCustomerRecord, setOwnCustomerRecord] = useState<any | null>(null)
  useEffect(() => {
    const code = String(currentCode ?? '').trim()
    if (!code || code === '*') {
      setOwnCustomerRecord(null)
      return
    }
    const ac = new AbortController()
    void (async () => {
      try {
        setOwnCustomerRecord((await fetchCustomerByCode(code, { signal: ac.signal })) ?? null)
      } catch {
        setOwnCustomerRecord(null)
      }
    })()
    return () => ac.abort()
  }, [currentCode])

  const customerListForSelect = useMemo(() => {
    if (!draftSalesRep) return []
    return customers.filter((c) => c.salesmanCode === draftSalesRep)
  }, [customers, draftSalesRep])

  const filteredSalesmen = useMemo(() => {
    if (currentCode && currentCode !== '*') {
      // Once ayri cozulen kendi kaydi, yoksa listede varsa oradan (eski davranis yedegi).
      const selected =
        (ownCustomerRecord && String(ownCustomerRecord.customerCode ?? '').toLowerCase() === String(currentCode).toLowerCase()
          ? ownCustomerRecord
          : null) ?? customers.find((c) => String(c.customerCode).toLowerCase() === String(currentCode).toLowerCase())
      if (selected && selected.salesmanCode) {
        return salesmen.filter((s) => s.salesmanCode === selected.salesmanCode)
      }
    }
    return salesmen
  }, [salesmen, currentCode, customers, ownCustomerRecord])

  const selectedSalesmanObj = useMemo(() => {
    if (!draftSalesRep) return null
    return salesmen.find((s) => s.salesmanCode === draftSalesRep) ?? null
  }, [draftSalesRep, salesmen])

  /*
    İNDİRİM SINIRI GİRİŞ YAPAN KULLANICININ ORANIDIR (2026-10-11, kullanıcı kararı:
    "indirim oranı Kullanıcı Listesi'ndeki İndirim Oranı'ndan gelecek").

    Eskiden teklifte SEÇİLEN PLASİYERİN oranı öne geçiyordu: %30 yetkili Kurumsal kullanıcı,
    oranı %10 olan bir plasiyer seçince sınırı %10'a düşüyor (ya da tersine, kendi yetkisinden
    fazlasını yapabiliyordu). Artık sıra: kullanıcının kendi oranı → o tanımsızsa plasiyerin
    oranı (eski davranış; oranı hiç girilmemiş yönetici hesapları değişmesin diye).

    Sınırın uygulandığı roller (Plasiyer 10, Kurumsal 12) dışında açıkça 0 girilmiş oran
    "tanımsız" sayılır: yönetici hesabına yanlışlıkla 0 yazılması bütün indirimi kilitlemesin.
    Plasiyer kendi plasiyer kaydına kilitli olduğu için onun için sonuç eskisiyle aynıdır.
  */
  const effectiveDiscountRate = useMemo(() => {
    const kisitliRol = userRoleId === 10 || userRoleId === 12
    if (userDiscountRate != null && (kisitliRol || Number(userDiscountRate) > 0)) {
      return userDiscountRate
    }
    if (selectedSalesmanObj && selectedSalesmanObj.discountRate != null) {
      return selectedSalesmanObj.discountRate
    }
    return userDiscountRate ?? null
  }, [selectedSalesmanObj, userDiscountRate, userRoleId])

  useEffect(() => {
    if (deliveryOptions.length > 0) {
      const exists = deliveryOptions.some((o) => o.customerCode === draftDeliveryCustomer)
      if (!exists) {
        setDraftDeliveryCustomer(deliveryOptions[0].customerCode || '')
      }
    } else {
      setDraftDeliveryCustomer('')
    }
  }, [deliveryOptions, draftDeliveryCustomer])

  useEffect(() => {
    if (createOpen && draftCustomer && !draftSalesRep && customers.length > 0) {
      const selected = customers.find((c) => String(c.customerCode).toLowerCase() === String(draftCustomer).toLowerCase())
      if (selected && selected.salesmanCode) {
        setDraftSalesRep(selected.salesmanCode)
        setDraft((p) => ({ ...p, customerName: String(selected.name ?? '') }))
      }
    }
  }, [createOpen, draftCustomer, draftSalesRep, customers])

  const [globalSearch, setGlobalSearch] = useState('')

  const [filterOps, setFilterOps] = useState<Record<ColumnKey, string>>({
    date: 'eq',
    documentNo: 'contains',
    customerCode: 'contains',
    customerName: 'contains',
    deliveryCustomerName: 'contains',
    description: 'contains',
    vatExempt: 'eq',
    createUser: 'contains'
  })
  const [filters, setFilters] = useState<Record<ColumnKey, { v1: string; v2: string }>>({
    date: { v1: '', v2: '' },
    documentNo: { v1: '', v2: '' },
    customerCode: { v1: '', v2: '' },
    customerName: { v1: '', v2: '' },
    deliveryCustomerName: { v1: '', v2: '' },
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

  /**
   * "CARİ EKLE" FORMU (2026-09-18).
   *
   * Muhtelif akışının YERİNE GEÇMEZ, yanında durur: muhtelif teklif vermeye devam edilebilir.
   * Bu form, aynı bilgilerle KALICI bir bayi carisi açıp teklifi o carinin adına sürdürmek
   * içindir. Cari kodu burada tutulmaz — sunucu üretir ve ekranda kilitli gösterilir.
   */
  const [cariModalOpen, setCariModalOpen] = useState(false)
  const [cariSaving, setCariSaving] = useState(false)
  const [cariError, setCariError] = useState<string | null>(null)
  const [cariForm, setCariForm] = useState<{
    name: string
    priceGroupKind: 'FATURA' | 'ISTISNA' | 'ASKERIYE'
    salesmanCode: string
    city: string
    district: string
    address: string
    phone: string
    email: string
    taxOffice: string
    taxNumber: string
  }>({
    name: '',
    priceGroupKind: 'FATURA',
    salesmanCode: '',
    city: '',
    district: '',
    address: '',
    phone: '',
    email: '',
    taxOffice: '',
    taxNumber: ''
  })

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

      const code = await fetchNextMuhtelifCustomerCode({ signal })
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
  /**
   * Fiyat gruplarının SENKRON kopyası. `priceGroups` state'i yalnızca bir sonraki render'da
   * dolduğu için, `setPriceGroups`ten hemen sonra state'i okuyan kod boş liste görüyordu
   * (muhtelif fiyat grubu çözümü tam olarak buna takılıyordu). Aynı tick içinde okunması
   * gereken her yer bu ref'e bakar.
   */
  const priceGroupsRef = useRef<PriceGroupDto[]>([])

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

  const checkIsAskeriyeCari = (customer: any) => {
    if (!customer) return false
    const invType = String(customer.invoiceType ?? '').trim().toUpperCase()
    if (invType === 'ASKERIYE' || invType === 'ASKERİYE') return true
    const name = String(customer.name ?? '').toUpperCase()
    if (name.includes('ASKERİYE') || name.includes('ASKERIYE') || name.includes('KOLORDU') || name.includes('TUGAY') || name.includes('KOMUTAN')) return true
    const pgCode = Number(customer.priceGroupCode ?? customer.priceGroupEntity?.code ?? 0)
    if (pgCode === 7) return true
    const pgId = String(customer.priceGroupId ?? '').trim()
    if (pgId) {
      const pg = priceGroups.find((x) => String(x.id).trim() === pgId)
      if (pg) {
        const code = Number(pg.code ?? 0)
        const pgInvType = String((pg as any)?.invoiceType ?? '').trim().toUpperCase()
        if (code === 7 || pgInvType === 'ASKERIYE' || pgInvType === 'ASKERİYE') return true
      }
    }
    const codeStr = String(customer.customerCode ?? '').trim()
    if (codeStr.endsWith('-3')) return true
    return false
  }

  const ensureF4Groups = async (): Promise<PriceGroupDto[]> => {
    if (f4GroupIdsRef.current && f4GroupRankRef.current) return priceGroupsRef.current
    try {
      const list: PriceGroupDto[] = await fetchPriceGroups({ includeInactive: false })
      priceGroupsRef.current = list ?? []
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

      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log('[CustomerOfferPage] ensureF4Groups: total groups from API:', list?.length, 'F4 matched ids:', Object.keys(rankById).length, 'rankById:', rankById)
      }

      f4GroupRankRef.current = rankById
      f4GroupIdsRef.current = new Set(Object.keys(rankById))
      return priceGroupsRef.current
    } catch (err: any) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error('[CustomerOfferPage] ensureF4Groups ERROR:', err?.message ?? err)
      }
      f4GroupRankRef.current = {}
      f4GroupIdsRef.current = new Set()
      return priceGroupsRef.current
    }
  }

  // Fiyat grupları açılışta bir kez yüklenir. Eskiden liste YALNIZCA `ensureF4Groups`
  // içinde doluyordu, o da cari seçiliyken hiç çağrılmıyordu: `checkIsAcikFaturaCari` ve
  // `checkIsAskeriyeCari` boş listeye bakıp cari tipini sessizce yanlış belirliyordu.
  useEffect(() => {
    void ensureF4Groups()
  }, [])

  /**
   * `forCustomer` — fiyatların HANGİ CARİ için çekileceği (2026-10-11).
   *
   * Verilmezse ekranda seçili cari (`draftCustomer`) kullanılır. Düzenle/Kopyala ise teklifi
   * açarken cariyi ekrana yazmadan ÖNCE fiyat ister; o anda `draftCustomer` önceki (çoğunlukla
   * boş) seçimdir. Cari boşken fiyat aşağıdaki "F4 türevi grup" yedeğinden, yani 4 numaralı
   * gruptan (KDV dahil, daha yüksek) geliyordu: satırın liste fiyatı yükselince %30 sınırı da
   * o fiyattan hesaplanıyor, teklifi kendi yetkisi içinde hazırlayan kullanıcı kaydı
   * düzenlerken "Bu indirimi yapmak için yetkiniz yok" alıyordu.
   */
  const fetchF4PriceMapForProductIds = async (ids: string[], forCustomer?: { code: string; priceGroupId?: string | null }) => {
    const cc = String(forCustomer ? forCustomer.code : draftCustomer ?? '').trim()
    const isMuhtelif = cc.toUpperCase() === 'MUHTELIF'
    const selectedCustomer = isMuhtelif ? null : customers.find((c) => c.customerCode === cc)

    // Muhtelifin kendi carisi yok, dolayısıyla fiyat grubu da yok. Eskiden bu boşluk F4
    // (4 numaralı grup) kümesine düşüyordu; kullanıcı kararı gereği artık 1 numaralı gruba
    // düşüyor. Grup listesi henüz yüklenmediyse ensureF4Groups onu da dolduruyor.
    let targetPriceGroupId = forCustomer?.priceGroupId
      ? trimId(forCustomer.priceGroupId)
      : selectedCustomer?.priceGroupId ? trimId(selectedCustomer.priceGroupId) : null

    // Liste her hâlükârda hazır olmalı: muhtelifin grubu buradan çözülüyor.
    const groups = await ensureF4Groups()

    if (isMuhtelif) {
      // `priceGroups` STATE'i değil, `ensureF4Groups`un döndürdüğü liste okunur. State aynı
      // tick içinde henüz boş olduğu için çözüm null dönüyor, muhtelif teklifi aşağıdaki
      // "F4 türevi grup" yedeğine düşüyordu. Orada grup 1 ile grup 3 AYNI sırada (ikisinin de
      // formülü `REMOVE_KDV(F4...` ile başlıyor), dolayısıyla fiyat API'den önce hangi grup
      // gelirse ondan seçiliyordu: fiyat grup 3'ten gelince taban da grup 3 olduğu için
      // indirim alanı sıfırlanıp ekranda "Maks %0.00" çıkıyordu.
      targetPriceGroupId = resolveMuhtelifPriceGroupId(groups) ?? targetPriceGroupId
    }

    const f4GroupIds = f4GroupIdsRef.current ?? new Set<string>()
    const f4GroupRank = f4GroupRankRef.current ?? {}

    if (ids.length === 0) return {}

    const prices: ProductPriceResponse[] = await fetchProductPricesByProducts(ids)
    const map: Record<string, { price: number; currency: string }> = {}
    const bestRankByProductId: Record<string, number> = {}

    ;(prices ?? []).forEach((pp) => {
      const rawId = trimId((pp as any)?.productId ?? (pp as any)?.productID)
      const productId = rawId
      const productIdLower = rawId.toLowerCase()
      const priceGroupId = trimId((pp as any)?.priceGroupId ?? (pp as any)?.priceGroupID)
      if (!productId) return

      if (targetPriceGroupId) {
        const isTargetMatch = priceGroupId === targetPriceGroupId
        const g3Id = price3GroupIdRef.current
        const isFallbackG3Match = !isTargetMatch && Boolean(g3Id) && priceGroupId === g3Id
        if (isTargetMatch || (isFallbackG3Match && !map[productId])) {
          const value = { price: Number((pp as any)?.price ?? 0), currency: String((pp as any)?.currency ?? '') }
          map[productId] = value
          if (productIdLower && productIdLower !== productId) map[productIdLower] = value
        }
      } else {
        if (!f4GroupIds.has(priceGroupId)) return
        const rank = f4GroupRank[priceGroupId]
        if (rank == null) return

        const prevRank = bestRankByProductId[productId]
        if (prevRank != null && prevRank <= rank) return
        bestRankByProductId[productId] = rank

        const value = { price: Number((pp as any)?.price ?? 0), currency: String((pp as any)?.currency ?? '') }
        map[productId] = value
        if (productIdLower && productIdLower !== productId) map[productIdLower] = value
      }
    })

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[CustomerOfferPage] fetchF4PriceMap result: matched products:', Object.keys(map).length, 'targetPriceGroupId:', targetPriceGroupId)
    }
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

  const mapApiOfferToRow = (x: CustomerOfferListItemDto): CustomerOffer => {
    const yyyyMmDd = String(x.date ?? '').slice(0, 10)
    return {
      id: x.id,
      date: yyyyMmDd,
      documentNo: String(x.documentNo ?? ''),
      customerCode: stripCariSubAccountCode(String(x.customerCode ?? '')),
      customerName: String(x.customerName ?? ''),
      deliveryCustomerCode: x.deliveryCustomerCode ?? null,
      deliveryCustomerName: x.deliveryCustomerName ?? null,
      description: String(x.description ?? ''),
      vatExempt: Boolean(x.vatExempt),
      createUser: String(x.createUser ?? ''),
      proformaDocumentNo: x.proformaDocumentNo ?? null,
      currencyCode: (() => {
        const cid = Number((x as any).currencyTypeId ?? (x as any).CurrencyTypeId ?? 0);
        return cid === 2 ? 'EUR' : cid === 3 ? 'USD' : cid === 4 ? 'GBP' : 'TRY';
      })(),
      lines: (x.lines ?? []).map((l) => {
        const offerCurrency = (() => {
          const cid = Number((x as any).currencyTypeId ?? (x as any).CurrencyTypeId ?? 0);
          return cid === 2 ? 'EUR' : cid === 3 ? 'USD' : cid === 4 ? 'GBP' : 'TRY';
        })();
        return {
          id: String(l.id),
          productId: String(l.productId),
          stockCode: String(l.stockCode ?? ''),
          stockName: String((l as any).stockName ?? l.description ?? ''),
          quantity: Number(l.quantity ?? 0),
          unitPrice: Number(l.unitPrice ?? 0),
          originalUnitPrice: Number(l.unitPrice ?? 0),
          discountType: normalizeDiscountType(l.discountType),
          discountValue: Number(l.discountValue ?? 0),
          vatRate: Number(l.vatRate ?? 0),
          currencyCode: offerCurrency,
          // Kampanya satırı kaydedildiği gibi kilitli gelir (kullanıcı: "kampanya ise kilitli kalsın").
          campaignLocked: Boolean(String((l as any).campaignName ?? '').trim()),
          campaignName: String((l as any).campaignName ?? '').trim() || undefined
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
      await fetchAllPages((skip, take) => fetchCustomerOffers({ take, skip, signal }), {
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

  const transferToProforma = async (id: number | string) => {
    const safeId = Number(id)
    if (!Number.isFinite(safeId) || safeId <= 0) {
      setError('Geçersiz teklif id')
      return
    }
    try {
      setLoading(true)
      setError(null)
      const res = await transferCustomerOfferToProforma(safeId)
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

  useEffect(() => {
    const ac = new AbortController()
    void loadAll(ac.signal)
    return () => ac.abort()
  }, [])

  /**
   * CARI ARAMASI SUNUCUDA (2026-08-22) — Cari Ekstre'deki duzenin AYNISI.
   *
   * Eskiden secili plasiyerin BUTUN carileri indiriliyordu ve kutu o gelene kadar bosdu.
   * Uc parametreleri AYNEN korundu: plasiyer kapsami, pasif haric, muhtelif dahil,
   * `forOrder`. Alt hesap kodu kirpma ve ana cariye indirgeme de aynen uygulaniyor —
   * bunlar listenin ANLAMINI belirliyor, aramada atlanirsa baska bir liste cikardi.
   */
  const cariRemoteSearch = useCallback(async (query: string, typeKey: string) => {
    setCustomersLoading(true)
    try {
      const list = await fetchCustomersDropdown({
        salesmanCode: draftSalesRep || undefined,
        includeInactive: false,
        includeMuhtelif: true,
        forOrder: true,
        q: buildCariSearchQuery(query, typeKey),
        limit: CARI_SEARCH_LIMIT
      })
      const normalized = uniqueMainCustomers((list ?? []).map((c: any) => ({
        ...c,
        customerCode: stripCariSubAccountCode(String(c.customerCode ?? ''))
      })))
      /*
        SEÇİLİ CARİ LİSTEDEN DÜŞMEZ (2026-10-11).

        `customers` her aramada sonuçla DEĞİŞTİRİLİYOR; ekranın geri kalanı ise seçili carinin
        fiyat grubunu, fatura tipini (açık / askeriye → KDV'siz) ve indirim oranını bu listeden
        okuyor. Cari seçildikten sonra kutuya başka bir şey yazılıp seçim yapılmadan
        bırakıldığında — ya da düzenlemede plasiyer yüklenince liste yenilendiğinde — seçili
        cari listeden düşüyor, sonraki ürünler carinin fiyatıyla değil 4 numaralı grubun
        fiyatıyla, askeriye caride KDV'li geliyordu. Seçili carinin kaydı sonuçta yoksa korunur.
      */
      setCustomers((prev) => {
        const secili = String(draftCustomerRef.current ?? '').trim()
        if (!secili || secili.toUpperCase() === 'MUHTELIF') return normalized
        if (normalized.some((c) => c.customerCode === secili)) return normalized
        const mevcut = prev.find((c) => c.customerCode === secili)
        return mevcut ? [...normalized, mevcut] : normalized
      })
      return buildCustomerOfferOptions(normalized, draftSalesRep)
    } catch {
      // Arama düşerse seçili cari yine korunur; yoksa bir ağ hatası fiyat grubunu sıfırlardı.
      setCustomers((prev) => {
        const secili = String(draftCustomerRef.current ?? '').trim()
        const mevcut = secili ? prev.find((c) => c.customerCode === secili) : undefined
        return mevcut ? [mevcut] : []
      })
      return [] as CariOption[]
    } finally {
      setCustomersLoading(false)
    }
  }, [draftSalesRep])

  useEffect(() => {
    void cariRemoteSearch('', 'all')
  }, [cariRemoteSearch])

  /** Formu muhtelif bilgileriyle doldurup açar; plasiyer olarak teklifin plasiyeri gelir. */
  const openCariModal = () => {
    setCariError(null)
    setCariForm({
      name: String(muhtelifForm.name ?? '').trim(),
      priceGroupKind: 'FATURA',
      salesmanCode: String(draftSalesRep ?? '').trim(),
      city: String(muhtelifForm.city ?? ''),
      district: String(muhtelifForm.district ?? ''),
      address: String(muhtelifForm.address ?? ''),
      phone: String(muhtelifForm.phone ?? ''),
      email: String(muhtelifForm.email ?? ''),
      taxOffice: String(muhtelifForm.taxOffice ?? ''),
      taxNumber: String(muhtelifForm.taxNumber ?? '')
    })
    setCariModalOpen(true)
  }

  const saveCari = async () => {
    const name = String(cariForm.name ?? '').trim()
    if (!name) {
      setCariError('Cari adı zorunludur.')
      return
    }
    if (!String(cariForm.salesmanCode ?? '').trim()) {
      setCariError('Plasiyer seçilmelidir.')
      return
    }

    setCariSaving(true)
    setCariError(null)
    try {
      const created = await createOfferCari({
        name,
        priceGroupKind: cariForm.priceGroupKind,
        salesmanCode: cariForm.salesmanCode.trim(),
        city: cariForm.city.trim() || null,
        district: cariForm.district.trim() || null,
        address: cariForm.address.trim() || null,
        phone: cariForm.phone.trim() || null,
        email: cariForm.email.trim() || null,
        taxOffice: cariForm.taxOffice.trim() || null,
        taxNumber: cariForm.taxNumber.trim() || null
      })

      if (!created.customerCode) throw new Error('Cari kodu alınamadı')

      // Yeni cari arama listesinde yoksa seçili gösterilemez; listeyi tazeliyoruz.
      if (created.salesmanCode) setDraftSalesRep(created.salesmanCode)
      await cariRemoteSearch(created.customerCode, 'all')

      setDraftCustomer(created.customerCode)

      /*
       * SATIRLAR: fiyat grubu DEĞİŞTİYSE sıfırlanır.
       *
       * Muhtelif teklif grup 1'den fiyatlanıyor. "Fatura" seçilirse yeni cari de grup 1 olur,
       * yani satırlardaki fiyatlar geçerli kalır ve kullanıcının girdiği kalemler korunur.
       * "İstisna" (4) / "Askeriye" (7) seçilirse fiyat grubu değişir; eski satırlar artık
       * yanlış fiyat taşır, bu yüzden ekranın cari değiştirme davranışıyla aynı şekilde
       * temizlenir. Sessizce yanlış fiyatla devam etmek en kötü sonuç olurdu.
       */
      const groupChanged = created.priceGroupCode !== MUHTELIF_PRICE_GROUP_CODE
      setDraft((p) => ({
        ...p,
        customerName: created.name,
        lines: groupChanged ? [createEmptyLine()] : p.lines
      }))

      setCariModalOpen(false)
      if (groupChanged) {
        setPriceWarning(
          `${created.customerCode} carisi açıldı. Fiyat grubu değiştiği için satırlar temizlendi, ürünleri yeniden ekleyin.`
        )
      }
    } catch (e: any) {
      setCariError(String(e?.message ?? 'Cari oluşturulamadı'))
    } finally {
      setCariSaving(false)
    }
  }

  const [authorizedContact, setAuthorizedContact] = useState<{ fullName: string; phone?: string | null } | null>(null)
  const [authorizedLoading, setAuthorizedLoading] = useState(false)

  const selectedCustomerObj = useMemo(() => {
    if (!draftCustomer || String(draftCustomer).toUpperCase() === 'MUHTELIF') return null
    return customers.find((c) => c.customerCode === draftCustomer) ?? null
  }, [draftCustomer, customers])

  useEffect(() => {
    if (!draftCustomer || String(draftCustomer).toUpperCase() === 'MUHTELIF') {
      setAuthorizedContact(null)
      return
    }
    const ac = new AbortController()
    setAuthorizedLoading(true)
    fetchCustomerAuthorizedContact(draftCustomer, { signal: ac.signal })
      .then((data) => {
        if (data && data.fullName) {
          setAuthorizedContact({ fullName: data.fullName, phone: data.phone })
        } else {
          setAuthorizedContact(null)
        }
      })
      .catch(() => {
        setAuthorizedContact(null)
      })
      .finally(() => {
        setAuthorizedLoading(false)
      })
    return () => ac.abort()
  }, [draftCustomer])

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        setSalesmenLoading(true)
        setSalesmen([])
        const list = await fetchSalesmenDropdown({ signal: ac.signal })
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
    setPriceWarning(null)
    setCopySourceOfferId(null)
    const init = createEmptyOffer()
    
    const initialCari = currentCode ? stripCariSubAccountCode(String(currentCode).trim()) : ''
    setDraftCustomer(initialCari)
    
    let initialSalesrep = ''
    if (userRoleId === 10) {
      initialSalesrep = salesmanCode ? String(salesmanCode).trim() : ''
    } else if (initialCari) {
      const selected = customers.find((c) => c.customerCode === initialCari)
      if (selected && selected.salesmanCode) {
        initialSalesrep = selected.salesmanCode
      }
    }
    
    setDraftSalesRep(initialSalesrep)
    setDraftDeliveryCustomer('')
    setEditOfferId(null)
    
    const selected = initialCari ? customers.find((c) => c.customerCode === initialCari) : null
    setDraft({
      ...init,
      customerName: selected ? String(selected.name ?? '') : '',
      lines: initialCari ? [createEmptyLine()] : []
    })
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

    const ac = new AbortController()
    void (async () => {
      try {
        const docNo = await fetchNewCustomerOfferDocumentNo({ signal: ac.signal })
        setDraft((p) => ({ ...p, documentNo: docNo }))
      } catch (e: any) {
        if (isAbortError(e)) return
        // keep empty if fails
      }
    })()
  }

  /**
   * Teklifi düzenlemek için açar.
   *
   * `kopyala` verildiğinde AYNI teklif yeni bir belge olarak açılır: kalemler, cari,
   * plasiyer ve muhtelif bilgileri birebir gelir ama `editOfferId` boş bırakılır — bu yüzden
   * kaydetme güncelleme değil OLUŞTURMA yoluna girer ve belge numarasını sunucu yeniden
   * üretir. Numara ekranda da hemen tazelenir, yoksa kullanıcı kopyanın üstünde kaynağın
   * numarasını görüp aynı belgeyi düzenlediğini sanıyor.
   */
  const openEdit = async (id: number | string, kopyala = false) => {
    setPriceWarning(null)
    const safeId = Number(id)
    if (!Number.isFinite(safeId) || safeId <= 0) {
      setError('Geçersiz teklif id')
      return
    }

    try {
      setLoading(true)
      setError(null)
      const dto = await getCustomerOffer(safeId)

      /*
        TEKLİFİN CARİSİ ÖNCE ÇÖZÜLÜR (2026-10-11).

        `customers` yalnız SON ARAMANIN sonucudur; düzenlenen teklifin carisi çoğu zaman o
        listede yoktur. Cari bulunamayınca üç şey sessizce yanlış gidiyordu:
          - satırların liste fiyatı yanlış fiyat grubundan geliyor (indirim sınırı yanlış),
          - düzenlemede eklenen yeni satırda açık/askeriye carinin KDV'si ürünün oranıyla geliyor,
          - cari kutusu seçili cariyi adıyla gösteremiyor.
        Cari kayıtla birlikte listeye eklenir; bulunamazsa (kapsam dışı / pasif) fiyat grubu
        sunucunun teklifle döndürdüğü `customerPriceGroupId`'den alınır.
      */
      const editCariCode = stripCariSubAccountCode(String(dto?.customerCode ?? ''))
      const editIsMuhtelif = Boolean((dto as any)?.muhtelif) || editCariCode.toUpperCase() === 'MUHTELIF'
      let editCustomer: any = editIsMuhtelif ? null : customers.find((c) => c.customerCode === editCariCode) ?? null
      if (!editIsMuhtelif && editCariCode && !editCustomer) {
        try {
          const found = await fetchCustomersDropdown({
            salesmanCode: String((dto as any)?.salesmanCode ?? '') || undefined,
            includeInactive: true,
            includeMuhtelif: true,
            forOrder: true,
            q: buildCariSearchQuery(editCariCode, 'all'),
            limit: CARI_SEARCH_LIMIT
          })
          const normalized = uniqueMainCustomers((found ?? []).map((c: any) => ({
            ...c,
            customerCode: stripCariSubAccountCode(String(c.customerCode ?? ''))
          })))
          editCustomer = normalized.find((c: any) => c.customerCode === editCariCode) ?? null
        } catch {
          // Arama düşerse aşağıdaki doğrudan çekme denenir.
        }
        /*
          ARAMA BULAMAZSA KODLA DOĞRUDAN ÇEKİLİR. Arama teklifin PLASİYERİYLE süzülüyor; carinin
          plasiyeri teklif açıldıktan sonra değişmiş ya da hiç atanmamışsa arama onu bulamaz ve
          cari kutusu yine boş (yalnız kod) kalırdı.
        */
        if (!editCustomer) {
          try {
            const tek = await fetchCustomerByCode(editCariCode)
            if (tek) editCustomer = { ...tek, customerCode: stripCariSubAccountCode(String((tek as any).customerCode ?? editCariCode)) }
          } catch {
            // Cari çekilemezse aşağıda sunucunun teklifle döndürdüğü fiyat grubuyla devam edilir.
          }
        }
        if (editCustomer) {
          const eklenecek = editCustomer
          setCustomers((prev) => (prev.some((c) => c.customerCode === editCariCode) ? prev : [eklenecek, ...prev]))
        }
      }
      const editPriceGroupId = editIsMuhtelif
        ? null
        : trimId(editCustomer?.priceGroupId ?? (dto as any)?.customerPriceGroupId ?? '') || null
      // Açık / askeriye caride satır KDV'si 0 tutulur (yeni teklifteki kural; sunucu da bu
      // carilerde teklifi KDV istisna kaydeder). Cari bulunamadıysa fatura tipinden okunur.
      const editCariKdvYok = editIsMuhtelif
        ? false
        : editCustomer
          ? (checkIsAcikFaturaCari(editCustomer) || checkIsAskeriyeCari(editCustomer))
          : ['ACIK', 'AÇIK', 'ASKERIYE', 'ASKERİYE'].includes(String((dto as any)?.customerInvoiceType ?? '').trim().toUpperCase())

      const productIds = (dto?.lines ?? []).map((l: any) => String(l?.productId ?? '')).filter(Boolean)
      let f4Map: Record<string, { price: number; currency: string }> = {}
      let p3Map: Record<string, number> = {}
      if (productIds.length > 0) {
        try {
          const [f4, p3] = await Promise.all([
            fetchF4PriceMapForProductIds(productIds, { code: editIsMuhtelif ? 'MUHTELIF' : editCariCode, priceGroupId: editPriceGroupId }),
            fetchPrice3MapForProductIds(productIds)
          ])
          f4Map = f4
          p3Map = p3
        } catch {
          // ignore
        }
      }

      setEditOfferId(kopyala ? null : safeId)
      /*
        KOPYA AYNI MÜŞTERİYE BAĞLANIR (2026-09-27). Muhtelif teklif kopyalanınca kayıt
        "yeni muhtelif müşteri" olarak gidiyor ve proformada ikinci bir cari kartı açılıyordu.
        Kaynağın id'si gönderilince sunucu kaynağın muhtelif kaydını yeniden kullanır.
      */
      setCopySourceOfferId(kopyala && (dto as any)?.muhtelif ? safeId : null)
      const editCurrencyTypeId = Number(dto?.currencyTypeId ?? (dto as any)?.CurrencyTypeId ?? 1)
      const editCurrencyCode = editCurrencyTypeId === 2 ? 'EUR' : editCurrencyTypeId === 3 ? 'USD' : editCurrencyTypeId === 4 ? 'GBP' : 'TRY'
      setDraft((p) => ({
        ...p,
        id: kopyala ? '' : safeId,
        date: String(dto?.date ?? '').slice(0, 10) || p.date,
        documentNo: kopyala ? '' : String(dto?.documentNo ?? ''),
        description: String(dto?.description ?? ''),
        vatExempt: Boolean(dto?.vatExempt),
        currencyTypeId: editCurrencyTypeId,
        currencyCode: editCurrencyCode,
        lines: (dto?.lines ?? []).map((l: any) => {
          const pid = String(l?.productId ?? '')
          const f4Price = pid ? f4Map[pid]?.price ?? f4Map[pid.toLowerCase()]?.price ?? Number(l?.originalUnitPrice ?? l?.unitPrice ?? 0) : Number(l?.originalUnitPrice ?? l?.unitPrice ?? 0)
          const p3Price = pid ? p3Map[pid] ?? p3Map[pid.toLowerCase()] ?? 0 : 0
          const kampanyaSatiri = Boolean(String(l?.campaignName ?? '').trim())
          const kayitliFiyat = Number(l?.unitPrice ?? 0)
          /*
            KDV ORANI ÜRÜNÜN GERÇEK ORANIDIR (2026-10-11). KDV istisnalı teklifte satır 0 ile
            saklanır; ekrana 0 gelince "KDV İstisna" kutusu kaldırıldığında KDV yine 0
            hesaplanıyor, sunucu ise ürünün oranıyla kaydediyordu (ekrandaki toplam ≠ kayıt).
            İstisna açıkken oran hesaba girmez (calcLineTotals), dolayısıyla istisnalı teklifin
            görünümü değişmez. Sunucu alanı göndermiyorsa (eski API) kayıtlı orana düşülür.
          */
          const urunKdv = l?.productTaxRate
          const kdvOrani = editCariKdvYok
            ? 0
            : urunKdv !== undefined && urunKdv !== null && Number.isFinite(Number(urunKdv))
              ? Number(urunKdv)
              : Number(l?.vatRate ?? 0)
          const satir: OfferLine = {
            id: createId('line'),
            productId: pid,
            stockCode: String(l?.stockCode ?? ''),
            stockName: String(l?.stockName ?? ''),
            quantity: Number(l?.quantity ?? 0),
            unitPrice: kayitliFiyat,
            // Kampanya satırında "liste fiyatı" kampanya fiyatının kendisidir (eklerken de öyle);
            // normal liste fiyatı yazılırsa kampanya indirimi plasiyer sınırını aşmış sayılırdı.
            originalUnitPrice: kampanyaSatiri ? kayitliFiyat : f4Price,
            price3: kampanyaSatiri ? 0 : p3Price,
            discountType: normalizeDiscountType(l?.discountType),
            discountValue: Number(l?.discountValue ?? 0),
            vatRate: kdvOrani,
            campaignLocked: kampanyaSatiri,
            campaignName: String(l?.campaignName ?? '').trim() || undefined,
            // Kalemin KENDİ para birimi. Başlığınki yazılıyordu: başlık kalemlerden çıktığı
            // için tek dövizli teklifte fark yoktu ama karışık teklifte kalemleri eziyordu.
            currencyCode: l?.currencyCode ?? l?.CurrencyCode ?? editCurrencyCode
          }
          // Yalnız DÜZENLEMEDE: kayıtlı indirim korunur (bkz. OfferLine.loadedNetUnit).
          if (!kopyala) satir.loadedNetUnit = calcLineTotals(satir, Boolean(dto?.vatExempt)).netUnit
          return satir
        })
      }))

      const cc = stripCariSubAccountCode(String(dto?.customerCode ?? ''))
      const m = (dto as any)?.muhtelif

      // A muhtelif offer now carries a real 120-01 code, which is indistinguishable from a
      // normal cari by prefix. Detect it from the muhtelif record instead and put the
      // dropdown back on the MUHTELIF sentinel, exactly like the create flow does.
      setDraftCustomer(m ? 'MUHTELIF' : cc)
      setDraftSalesRep(String((dto as any)?.salesmanCode ?? ''))
      setDraftDeliveryCustomer(stripCariSubAccountCode(String(dto?.deliveryCustomerCode ?? '')))

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

      if (kopyala) {
        // Numara yalnızca gösterim için; kaydederken sunucu kendi üretir.
        try {
          const yeniNo = await fetchNewCustomerOfferDocumentNo()
          setDraft((p) => ({ ...p, documentNo: yeniNo }))
        } catch {
          // Numara alınamazsa alan boş kalır, kayıt yine de çalışır.
        }
      }
    } catch (e: any) {
      setError(String(e?.message ?? 'Teklif alınamadı'))
    } finally {
      setLoading(false)
    }
  }

  /**
   * Opens the offer as a PDF rendered on the server.
   *
   * It used to open an HTML preview page and let the browser print it, which cannot hold the
   * measured layout — margins, scaling and font substitution all move it. The server draws to
   * the coordinates taken off the legacy output (docs/teklif-basim-olculeri.md).
   *
   * 'standard' is the featured form, with each product's picture and feature list; 'simple' is
   * the plain one. Viewing and printing open the same document — the print dialog is one key
   * away — so onlyView no longer changes what is fetched.
   */
  const handlePrintOffer = async (
    id: number | string,
    templateType: 'standard' | 'simple' | 'usd' | 'landscape',
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

      const res = await fetch(`${API_BASE_URL}/api/customer-offers/${safeId}/yazdir${form}`, {
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

  const closeCreate = () => {
    setCreateOpen(false)
    setEditOfferId(null)
    setPriceWarning(null)
  }

  const updateDraft = (patch: Partial<CustomerOffer>) => {
    setDraft((p) => ({ ...p, ...patch }))
  }

  const updateLine = (lineId: string, patch: Partial<OfferLine>) => {
    setDraft((p) => ({
      ...p,
      lines: p.lines.map((l) => {
        if (l.id !== lineId) return l
        const updated = { ...l, ...patch }
        return updated
      })
    }))
  }

  const finalizeLine = (lineId: string) => {
    setDraft((p) => {
      let warning: string | null = null;
      const nextLines = p.lines.map((l) => {
        if (l.id !== lineId) return l
        // Kampanya satırının fiyatı sabit: taban/indirim düzeltmeleri uygulanmaz.
        if (l.campaignLocked) return l
        const updated = { ...l }

        // 1. Basic capping for all roles
        if (updated.discountType === 'percentage') {
          if (updated.discountValue > 100) {
            updated.discountValue = 100
          }
        } else if (updated.discountType === 'amount') {
          // Tutar indirimi ADET BAŞINADIR (2026-08-22 kuralı; hesap `calcLineTotals`'ta ve
          // sunucuda değer × adet). Tavan da TEK ürünün fiyatı.
          const birimFiyat = safeNumber(updated.unitPrice)
          if (updated.discountValue > birimFiyat) {
            updated.discountValue = birimFiyat
          }
        }

        // 2. Plasiyer discount authority limits check (based on selected Plasiyer or user discount rate)
        const activeRate = effectiveDiscountRate ?? userDiscountRate ?? null
        if (activeRate != null || userRoleId === 10 || userRoleId === 12) {
          const limits = getDiscountLimits(updated, p.vatExempt, activeRate, sinirsizIndirim)
          const minPrice = limits.minUnitPrice // tax-exclusive floor
          
          let exceeded = false
          
          // Enforce manual unitPrice cannot be below minPrice floor
          if (updated.unitPrice < minPrice) {
            updated.unitPrice = minPrice
            exceeded = true
            const mult = p.vatExempt ? 1 : (1 + safeNumber(updated.vatRate) / 100)
            const minPriceInc = minPrice * mult
            warning = `${updated.stockCode} için Plasiyer Yetkisi nedeniyle en düşük net birim fiyat ${formatMoneyWithCurrency(minPriceInc, updated.currencyCode)} (KDV Dahil) olabilir. Bu fiyatın altına düşemezsiniz.`
          }

          /*
            NET BİRİM FİYAT tabanın altına inemez. Tutar indirimi ADET BAŞINADIR: girilen değer
            her üründen ayrı düşer (calcLineTotals ve sunucu: değer × adet).

            Burası değeri SATIR TOPLAMI sanıp adede bölüyordu (2026-10-11'de düzeltildi): 2
            adetlik satırda birim başına 400 indirim "200" sayılıp sınırdan geçiyor, kaydetmedeki
            asıl kontrol ise 400'ü görüp "yetkiniz yok" diyordu. Aynı hata üst sınırı da adetle
            ÇARPIP izin verilenden büyük indirim yazıyordu.
          */
          const netPriceExc = updated.discountType === 'percentage'
            ? updated.unitPrice * (1 - updated.discountValue / 100)
            : updated.discountType === 'amount'
              ? updated.unitPrice - updated.discountValue
              : updated.unitPrice

          if (netPriceExc < minPrice) {
            exceeded = true
            if (updated.discountType === 'percentage') {
              updated.discountValue = updated.unitPrice > 0
                ? Math.max(0, Number(((1 - minPrice / updated.unitPrice) * 100).toFixed(4)))
                : 0
            } else if (updated.discountType === 'amount') {
              // İzin verilen en büyük TUTAR indirimi: birim başına fark (değer adet başınadır).
              updated.discountValue = Math.max(0, Number((updated.unitPrice - minPrice).toFixed(4)))
            }
            
            const mult = p.vatExempt ? 1 : (1 + safeNumber(updated.vatRate) / 100)
            const minPriceInc = minPrice * mult
            warning = `${updated.stockCode} için Plasiyer Yetkisi nedeniyle en düşük net birim fiyat ${formatMoneyWithCurrency(minPriceInc, updated.currencyCode)} (KDV Dahil) olabilir. Bu fiyatın altına düşemezsiniz.`
          }
        }

        return updated
      })

      if (warning) {
        setPriceWarning(warning)
      } else {
        setPriceWarning(null)
      }

      return { ...p, lines: nextLines }
    })
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

  const searchProducts = async (q: string, filters?: { main?: string; sub?: string }) => {
    try {
      setProductPickerLoading(true)
      setProductPickerError(null)

      const cc = String(draftCustomer ?? '').trim()
      const isMuhtelif = cc.toUpperCase() === 'MUHTELIF'
      const dealerCode = !cc || isMuhtelif ? undefined : cc

      const main = filters?.main !== undefined ? filters.main : pickerMainCat
      const sub = filters?.sub !== undefined ? filters.sub : pickerSubCat

      const res = await fetchProducts({
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

      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log('[CustomerOfferPage] picker base price map', { items: items.length, ids: ids.length, f4Matched: Object.keys(f4Map).length, p3Matched: Object.keys(p3Map).length })
      }

      setProductPickerItems(
        items.map((p) => {
          const rawId = trimId((p as any)?.id)
          const f4 = rawId ? f4Map[rawId] ?? f4Map[rawId.toLowerCase()] : undefined
          const p3Price = rawId ? p3Map[rawId] ?? p3Map[rawId.toLowerCase()] ?? 0 : 0
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

  const fetchAndMapProducts = async (q: string) => fetchAndMapProductsBy({ q: q.trim() })

  /**
   * Ürün listesini çekip carinin fiyatıyla (`__basePrice`) eşler. `q` yerine kategori
   * süzgeciyle de çağrılabilsin diye ayrıldı (kampanya penceresi kategori kampanyasının
   * ürünlerini buradan alıyor).
   */
  const fetchAndMapProductsBy = async (filter: { q?: string; main?: string; sub?: string; pageSize?: number }) => {
    const cc = String(draftCustomer ?? '').trim()
    const isMuhtelif = cc.toUpperCase() === 'MUHTELIF'
    const dealerCode = !cc || isMuhtelif ? undefined : cc

    const res = await fetchProducts({
      q: (filter.q ?? '').trim(),
      main: filter.main || undefined,
      sub: filter.sub || undefined,
      page: 1,
      pageSize: filter.pageSize ?? 50,
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
      const f4 = rawId ? f4Map[rawId] ?? f4Map[rawId.toLowerCase()] : undefined
      const p3Price = rawId ? p3Map[rawId] ?? p3Map[rawId.toLowerCase()] ?? 0 : 0
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

  /* =========================================================================================
     KAMPANYA KULLAN (2026-09-20)

     "Satır Ekle"nin yanında ikinci düğme: aktif kampanyalar listelenir, kampanyanın ürünleri
     carinin fiyatı ve KAMPANYALI fiyatıyla görünür, seçilen ürün satır olarak eklenir. Fiyat
     sipariş ekranındaki kartla AYNI kaynaktan (`campaignPriceForProduct`: indirim F4'e
     uygulanır, carinin grubuna formülle taşınır). Eklenen satır kilitlidir (`campaignLocked`).
     ========================================================================================= */
  type KampanyaUrunu = {
    product: any
    basePrice: number
    campaignPrice: number
    percent: number | null
    currency: string
  }
  /** `neden`: ürün çıkmadıysa SEBEBİ (2026-09-21) — "bulunamadı" tek başına hiçbir şey anlatmıyordu. */
  type KampanyaGrubu = { campaign: ActiveCampaignDto; items: KampanyaUrunu[]; neden?: string | null }

  const [kampanyaModalOpen, setKampanyaModalOpen] = useState(false)
  const [kampanyaLoading, setKampanyaLoading] = useState(false)
  const [kampanyaError, setKampanyaError] = useState<string | null>(null)
  const [kampanyaGruplari, setKampanyaGruplari] = useState<KampanyaGrubu[]>([])
  const [kampanyaGrupAdi, setKampanyaGrupAdi] = useState<string>('')

  const parseCampaignStockCodes = (json: unknown): string[] => {
    const raw = String(json ?? '').trim()
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      const list = Array.isArray(parsed) ? parsed : (parsed?.productStockCodes ?? parsed?.ProductStockCodes ?? [])
      return Array.isArray(list) ? list.map((x) => String(x ?? '').trim()).filter(Boolean) : []
    } catch {
      return []
    }
  }

  const openKampanyaModal = async () => {
    if (!draftCustomer) {
      showMessage('Hata', 'Cari seçimi yapılmadan kampanya eklenemez.')
      return
    }
    setKampanyaModalOpen(true)
    setKampanyaLoading(true)
    setKampanyaError(null)
    setKampanyaGruplari([])
    try {
      const cc = String(draftCustomer ?? '').trim()
      const isMuhtelif = cc.toUpperCase() === 'MUHTELIF'
      const selectedCustomer = isMuhtelif ? null : customers.find((c) => c.customerCode === cc)

      // Carinin fiyat grubu: kampanya bu gruba tanımlı değilse fiyat çıkmaz, ürün listelenmez.
      const groups = await ensureF4Groups()
      const pgId = isMuhtelif
        ? resolveMuhtelifPriceGroupId(groups)
        : (selectedCustomer?.priceGroupId ? trimId(selectedCustomer.priceGroupId) : null)
      const pg = pgId ? groups.find((g) => trimId(g.id) === pgId) : undefined
      const pgCode = pg ? Number((pg as any).code ?? 0) : undefined
      const pgFormula = pg ? String((pg as any).formula ?? '') : ''
      const pgAdi = pg ? `${pgCode}${String((pg as any).name ?? '').trim() ? ' - ' + String((pg as any).name).trim() : ''}` : 'tanımsız'
      setKampanyaGrupAdi(pgAdi)

      const campaigns = (await fetchActiveCampaigns({ customerCode: isMuhtelif ? undefined : cc, priceGroupCode: pgCode }))
        .filter((c) => Number((c as any)?.kampanyaTipi) === 4 || Number((c as any)?.kampanyaTipi) === 5)

      const out: KampanyaGrubu[] = []
      for (const campaign of campaigns) {
        const tip = Number((campaign as any)?.kampanyaTipi)
        let products: any[] = []
        const codes = new Set<string>()
        const cats = new Set<string>()

        if (tip === 4) {
          for (const d of campaign.discounts ?? []) {
            const sc = String(d?.stokKodu ?? '').trim()
            if (sc) codes.add(sc)
          }
          for (const cond of campaign.conditions ?? []) {
            for (const sc of parseCampaignStockCodes((cond as any)?.productStockCodesJson)) codes.add(sc)
          }
          // Paralel (2026-10-07): ürüne özel fiyat listesinde ~25 ürün olabiliyor; sırayla
          // çekmek pencereyi saniyelerce bekletiyordu. Sıra korunur.
          const hits = await Promise.all(Array.from(codes).map(async (code) => {
            const list = await fetchAndMapProductsBy({ q: code, pageSize: 10 })
            return list.find((x: any) => String(x?.stockCode ?? '').trim().toUpperCase() === code.toUpperCase())
          }))
          for (const hit of hits) if (hit) products.push(hit)
        } else {
          for (const d of campaign.discounts ?? []) {
            const g = String(d?.grupKodu ?? '').trim()
            if (g) cats.add(g)
          }
          for (const cond of campaign.conditions ?? []) {
            const g = String((cond as any)?.categoryCode ?? '').trim()
            if (g) cats.add(g)
          }
          for (const cat of cats) {
            let list = await fetchAndMapProductsBy({ main: cat, pageSize: 200 })
            if (list.length === 0) list = await fetchAndMapProductsBy({ sub: cat, pageSize: 200 })
            products.push(...list)
          }
        }

        const seen = new Set<string>()
        const items: KampanyaUrunu[] = []
        for (const product of products) {
          const sc = String(product?.stockCode ?? '').trim()
          if (!sc || seen.has(sc.toUpperCase())) continue
          seen.add(sc.toUpperCase())
          const basePrice = Number(product?.__basePrice ?? 0)
          if (!Number.isFinite(basePrice) || basePrice <= 0) continue
          const kf = campaignPriceForProduct(
            { stockCode: sc, groupCode: product?.groupCode, subGroupCode: product?.subGroupCode, kod4: product?.kod4, kod5: product?.kod5 },
            basePrice,
            [campaign],
            pgCode,
            {
              catalogPrice: product?.catalogUnitPrice,
              catalogCurrency: product?.catalogCurrency,
              formula: pgFormula,
              taxRate: product?.taxRate,
              discountRate: product?.discountRate
            }
          )
          if (!kf) continue
          items.push({
            product,
            basePrice,
            campaignPrice: Math.round(kf.newPrice * 100) / 100,
            percent: kf.percent,
            currency: String(product?.__baseCurrency ?? 'TRY')
          })
        }
        /*
          NEDEN BOŞ? Kullanıcı canlıda "bulunamadı" görüp kampanya motorunun bozuk olduğunu
          sandı; oysa dört ayrı sebep aynı cümleye düşüyordu. Her biri kendi cümlesiyle çıkar
          ki panelden bakan kişi ne yapacağını bilsin (grubu ekle / ürünü aç / fiyat türet).
        */
        let neden: string | null = null
        if (items.length === 0) {
          const kapsam = campaignPriceGroupScope(campaign)
          const tutarMi = (campaign.discounts ?? []).some((d) => String(d?.iskontoTipiText ?? '').trim() !== 'Oran')
          if (pgCode && kapsam.length > 0 && !kapsam.includes(pgCode)) {
            neden = `Kampanya ${kapsam.join(', ')} numaralı fiyat gruplarına tanımlı; bu carinin fiyat grubu ${pgAdi}. Kampanya kartından bu grubu ekleyin.`
          } else if (products.length === 0) {
            neden = tip === 4
              ? `Kampanyanın ürünü (${Array.from(codes).join(', ') || '—'}) ürün listesinde bulunamadı; ürün pasif ya da satışa kapalı olabilir.`
              : `Kampanyanın kategorisinde (${Array.from(cats).join(', ') || '—'}) listelenecek ürün yok.`
          } else if (products.every((p) => !(Number(p?.__basePrice ?? 0) > 0))) {
            neden = `Ürünün carinin fiyat grubunda (${pgAdi}) fiyatı yok (0). Fiyat gruplarını türetin.`
          } else if (tutarMi && products.some((p) => { const c = String(p?.catalogCurrency ?? '').trim().toUpperCase(); return c && c !== 'TL' && c !== 'TRY' })) {
            neden = "Ürünün Fiyat 4'ü dövizli; tutar (TL) indirimi kartta hesaplanamıyor, sepette kur ile uygulanır."
          } else {
            neden = 'Kampanyalı fiyat hesaplanamadı (indirim değeri 0 olabilir ya da indirim satırı bu ürünü kapsamıyor).'
          }
        }
        out.push({ campaign, items, neden })
      }
      setKampanyaGruplari(out)
    } catch (e: any) {
      setKampanyaError(String(e?.message ?? 'Kampanyalar alınamadı.'))
    } finally {
      setKampanyaLoading(false)
    }
  }

  const kampanyaSatiriEkle = (u: KampanyaUrunu, campaignName: string) => {
    const sc = String(u.product?.stockCode ?? '').trim()
    if (!sc) return
    if (draft.lines.some((l) => String(l.stockCode ?? '').trim().toUpperCase() === sc.toUpperCase())) {
      showMessage('Bilgi', `${sc} zaten kalemlerde.`)
      return
    }
    const doluSatir = draft.lines.filter((l) => String(l.stockCode ?? '').trim()).length
    if (doluSatir >= 17) {
      showMessage('Hata', 'En fazla 17 kalem sipariş edebilirsiniz.')
      return
    }

    const cc = String(draftCustomer ?? '').trim()
    const isMuhtelif = cc.toUpperCase() === 'MUHTELIF'
    const selectedCustomer = isMuhtelif ? null : customers.find((c) => c.customerCode === cc)
    const kdvYok = checkIsAcikFaturaCari(selectedCustomer) || checkIsAskeriyeCari(selectedCustomer)

    const line: OfferLine = {
      ...createEmptyLine(),
      productId: String(u.product?.id ?? ''),
      stockCode: sc,
      stockName: String(u.product?.name ?? ''),
      quantity: 1,
      unitPrice: u.campaignPrice,
      originalUnitPrice: u.campaignPrice,
      price3: 0,
      discountType: 'none',
      discountValue: 0,
      vatRate: kdvYok ? 0 : Number(u.product?.taxRate ?? 0),
      currencyCode: u.currency,
      campaignLocked: true,
      campaignName
    }

    setDraft((p) => {
      // İlk boş satır varsa onun yerine, yoksa sona.
      const idx = p.lines.findIndex((l) => !String(l.stockCode ?? '').trim())
      const next = [...p.lines]
      if (idx >= 0) next[idx] = line
      else next.push(line)
      return { ...p, lines: next }
    })
  }

  const selectProductForLine = (product: any, customLineId?: string | null) => {
    const lineId = customLineId || productPickerForLineId
    if (!lineId) return

    const cc = String(draftCustomer ?? '').trim()
    const isMuhtelif = cc.toUpperCase() === 'MUHTELIF'
    const selectedCustomer = isMuhtelif ? null : customers.find((c) => c.customerCode === cc)
    const isAcikCari = checkIsAcikFaturaCari(selectedCustomer)
    const isAskeriye = checkIsAskeriyeCari(selectedCustomer)
    const defaultDiscountRate = isAcikCari ? 0 : Number(selectedCustomer?.discountRate ?? 0)

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
      originalUnitPrice: Number(product?.__basePrice ?? product?.unitPrice ?? 0),
      price3: Number(product?.__price3 ?? 0),
      vatRate: (isAcikCari || isAskeriye) ? 0 : Number(product?.taxRate ?? 0),
      currencyCode: product?.__baseCurrency ?? '0',
      // Açık caride satıra girilmiş indirim ürün seçilince SİLİNMEZ (2026-09-17): açık cariye de
      // indirim yapılabiliyor. Carinin varsayılan indirim oranı ise açık caride yine uygulanmaz.
      ...(shouldApplyDiscount
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
    if (!draftCustomer) {
      showMessage('Hata', 'Cari seçimi yapılmadan kalem eklenemez.')
      return
    }
    if (draft.lines.length >= 17) {
      showMessage('Hata', 'En fazla 17 kalem sipariş edebilirsiniz.')
      return
    }
    setDraft((p) => ({ ...p, lines: [...p.lines, createEmptyLine()] }))
  }

  const draftCurrency = useMemo(() => {
    return getInvoiceCurrency(draft.lines)
  }, [draft.lines])

  const draftTotals = useMemo(() => {
    return calcInvoiceTotalsWithConversion(draft.lines, draft.vatExempt, draftCurrency, fxRates)
  }, [draft.lines, draft.vatExempt, draftCurrency, fxRates])

  const columnOptions = useMemo(() => {
    const out: Record<string, string[]> = {}
    const cols = ['date', 'documentNo', 'customerCode', 'customerName', 'deliveryCustomerName', 'description', 'createUser']
    for (const key of cols) {
      const values = new Set<string>()
      for (const row of rows) {
        values.add(String((row as any)[key] ?? '').trim())
      }
      out[key] = Array.from(values).filter((v) => v.length > 0).sort((a, b) => a.localeCompare(b))
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
      const blob = [row.date, row.documentNo, row.customerCode, row.customerName, row.deliveryCustomerName, row.description, row.createUser]
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

    const matchComparable = (cellValue: string, op: string, v1: string, v2: string) => {
      const c = cellValue
      const a = v1
      const b = v2
      if (!a && !(op === 'between' && b)) return true

      if (op === 'eq') return c === a
      if (op === 'neq') return c !== a
      if (op === 'lt') return c < a
      if (op === 'gt') return c > a
      if (op === 'lte') return c <= a
      if (op === 'gte') return c >= a
      if (op === 'between') {
        const left = a
        const right = b
        if (!left || !right) return Boolean(left ? c >= left : true) && Boolean(right ? c <= right : true)
        return c >= left && c <= right
      }
      return c.includes(a)
    }

    const activeFilters = (['date', 'documentNo', 'customerCode', 'customerName', 'deliveryCustomerName', 'description', 'vatExempt', 'createUser'] as ColumnKey[])
      .map((k) => {
        const fv = filters[k] ?? { v1: '', v2: '' }
        const v1 = String(fv.v1 ?? '').trim()
        const v2 = String(fv.v2 ?? '').trim()
        const op = String(filterOps[k] ?? (k === 'date' ? 'eq' : 'contains'))
        return { key: k, v1, v2, op }
      })
      .filter((x) => x.v1.length > 0 || (x.op === 'between' && x.v2.length > 0))

    const byText =
      activeFilters.length === 0
        ? byGlobal
        : byGlobal.filter((r) => {
            for (const f of activeFilters) {
              const raw = (r as any)[f.key]
              if (f.key === 'date') {
                const normalizedCell = normalizeDateValue(String(raw ?? ''))
                const normalizedV1 = normalizeDateValue(f.v1)
                const normalizedV2 = normalizeDateValue(f.v2)
                const ok = matchComparable(normalizedCell, f.op, normalizedV1, normalizedV2)
                if (!ok) return false
                continue
              }

              if (f.key === 'vatExempt') {
                const cell = (r as any).vatExempt ? 'evet' : 'hayır'
                const ok = matchText(cell, f.op, f.v1, f.v2)
                if (!ok) return false
                continue
              }
              const cell = String(raw ?? '')
              const ok = matchText(cell, f.op, f.v1, f.v2)
              if (!ok) return false
            }
            return true
          })

    const active = Object.entries(selectedValues).filter(([, v]) => (v ?? []).length > 0)
    if (active.length === 0) return byText

    return byText.filter((r) => {
      for (const [k, list] of active) {
        const cell = String((r as any)[k] ?? '').toLowerCase()
        if (!list.map((v) => v.toLowerCase()).includes(cell)) return false
      }
      return true
    })
  }, [filterOps, filters, globalSearch, rows, selectedValues])

  const renderFilterPanel = (key: string, label: string) => (
    <div
      ref={filterPanelRef}
      className="absolute left-0 top-full mt-2 w-64 bg-white border border-slate-200 rounded-lg shadow-lg z-50"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2 border-b border-slate-200 text-xs font-semibold text-gray-600">{label}</div>

      <div className="max-h-56 overflow-auto px-3 py-2 text-xs">
        {columnOptions[key]?.length ? (
          <label className="flex items-center gap-2 py-1">
            <input
              type="checkbox"
              checked={(draftValues[key] ?? []).length === columnOptions[key].length}
              onChange={(e) => {
                const allValues = columnOptions[key] ?? []
                setDraftValues((p) => ({ ...p, [key]: e.target.checked ? allValues : [] }))
              }}
            />
            Tümünü seç
          </label>
        ) : null}

        {columnOptions[key]?.length ? (
          columnOptions[key].map((opt) => (
            <label key={opt} className="flex items-center gap-2 py-1">
              <input
                type="checkbox"
                checked={(draftValues[key] ?? []).includes(opt)}
                onChange={(e) => {
                  const current = new Set(draftValues[key] ?? [])
                  if (e.target.checked) current.add(opt)
                  else current.delete(opt)
                  setDraftValues((p) => ({ ...p, [key]: Array.from(current) }))
                }}
              />
              {opt || '(Boş)'}
            </label>
          ))
        ) : (
          <div className="text-gray-400 py-4">Gösterilecek bilgi yok</div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-slate-200">
        <button type="button" className="text-xs font-semibold text-blue-600 hover:text-blue-700" onClick={() => setActiveFilterKey(null)}>
          İPTAL
        </button>
        <button
          type="button"
          className="text-xs font-semibold text-blue-600 hover:text-blue-700"
          onClick={() => {
            setSelectedValues((p) => ({ ...p, [key]: draftValues[key] ?? [] }))
            setActiveFilterKey(null)
          }}
        >
          TAMAM
        </button>
      </div>
    </div>
  )

  const renderHeaderCell = (label: string, key: string, alignClass = 'text-left') => (
    <th className={`px-4 py-3 text-xs font-semibold text-gray-700 uppercase tracking-wide border border-slate-200 relative ${alignClass}`}>
      <div className="flex items-center gap-1">
        {label}
        <button
          type="button"
          className="ml-1 inline-flex items-center justify-center w-6 h-6 rounded hover:bg-gray-200 text-gray-500"
          title="Filtrele"
          onClick={(e) => {
            e.stopPropagation()
            setActiveFilterKey((prev) => (prev === key ? null : key))
            setDraftValues((p) => ({ ...p, [key]: selectedValues[key] ?? [] }))
          }}
        >
          <ListFilter size={12} />
        </button>
      </div>
      {activeFilterKey === key && renderFilterPanel(key, label)}
    </th>
  )

  const saveDraft = async () => {
    try {
      setLoading(true)
      setError(null)

      // Muhtelif offers always sit on the MUHTELIF sentinel; the cari code is minted
      // only when the offer is transferred to a proforma.
      const isMuhtelif = String(draftCustomer ?? '').toUpperCase() === 'MUHTELIF'

      const selectedCustomer = customers.find((c) => c.customerCode === draftCustomer)
      const customerNameFromDropdown = selectedCustomer ? String(selectedCustomer.name ?? '').trim() : ''

      const payload = {
        date: draft.date,
        /*
          MUHTELİFTE KDV İSTİSNA ARTIK ZORLANMIYOR (2026-08-29 kullanıcı bildirimi:
          "ilk müşteri teklifi oluştuğunda eğer muhtelifse KDV istisna açık geliyor,
          gelmeyecek").

          Burası kutunun ekrandaki hâlini görmezden gelip muhtelif teklifi HER ZAMAN
          istisnalı kaydediyordu. Kullanıcı kutuyu kapatsa bile kayıt istisnalı oluyor,
          KDV'siz teklif ve ardından KDV'siz fatura çıkıyordu. Karar artık kullanıcınındır.
        */
        vatExempt: Boolean(draft.vatExempt),
        customerCode: isMuhtelif ? 'MUHTELIF' : draftCustomer,
        deliveryCustomerCode: draftDeliveryCustomer || null,
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
        lines: draft.lines.map((l) => ({
          productId: String(l.productId ?? ''),
          quantity: Number(l.quantity ?? 0),
          discountType: l.discountType === 'amount' ? 1 : l.discountType === 'percentage' ? 2 : 0,
          discountValue: Number(l.discountValue ?? 0),
          unitPrice: Number(l.unitPrice ?? 0),
          campaignName: l.campaignLocked ? (l.campaignName || 'Kampanya') : null
        }))
      }

      if (!payload.customerCode) throw new Error('Cari seçimi zorunlu')

      if (isMuhtelif) {
        if (!payload.muhtelif?.customerCode) throw new Error('Muhtelif cari kodu zorunlu')
        if (!payload.muhtelif?.name) throw new Error('Muhtelif cari adı zorunlu')
      }

      if (payload.lines.length === 0) throw new Error('En az 1 satır eklemelisiniz')
      if (payload.lines.length > 17) throw new Error('En fazla 17 kalem sipariş edebilirsiniz.')
      if (payload.lines.some((l) => !l.productId)) throw new Error('Tüm satırlarda ürün seçmelisiniz')

      // Plasiyer / Kurumsal fiyat override ve iskonto kontrolü
      /*
        ÜÇ İSTİSNA (2026-10-11):
         - "Sınırsız İndirim" yetkisi olan kullanıcıda taban yoktur; satır kontrolü bunu
           biliyordu, kaydetme kontrolü bilmiyordu.
         - Kampanya satırının fiyatı sabittir, plasiyer indirimi sayılmaz.
         - Düzenlemede, kayıtlı indirimi ARTIRILMAMIŞ satır geçer (loadedNetUnit).
      */
      const activeRate = effectiveDiscountRate ?? userDiscountRate ?? null
      if ((userRoleId === 10 || userRoleId === 12) && !sinirsizIndirim && activeRate !== null && activeRate !== undefined) {
        const rate = safeNumber(activeRate)
        for (let i = 0; i < draft.lines.length; i++) {
          const line = draft.lines[i]
          if (line.campaignLocked) continue
          const origPrice = line.originalUnitPrice
          if (origPrice > 0) {
            const p3 = safeNumber(line.price3 ?? 0)
            const discountFloor = origPrice * (1 - rate / 100)
            const minUnitPrice = p3 > 0 ? Math.max(p3, discountFloor) : discountFloor

            const t = calcLineTotals(line, draft.vatExempt)
            const qty = safeNumber(line.quantity ?? 1)
            const finalUnitPriceExc = qty > 0 ? t.net / qty : 0

            // Kayıtlı teklifin satırı: kullanıcı indirimi artırmadıysa dokunulmaz.
            if (line.loadedNetUnit != null && finalUnitPriceExc >= line.loadedNetUnit - 0.05) continue

            // Check if final unit price is below the allowed minimum unit price
            if (finalUnitPriceExc < minUnitPrice - 0.05) {
              if (userRoleId === 12) {
                throw new Error('Bu indirimi yapmak için yetkiniz yok')
              }
              // Fiyat KALEMİN para birimindedir; sabit ₺ yazmak dolarlı kalemde bayiye yanlış
              // taban gösteriyordu (aynı simge kuralı satır tablosunda da kullanılıyor).
              const sym = getCurrencySymbol(line.currencyCode)
              if (p3 > 0 && p3 > discountFloor) {
                throw new Error(
                  `"${line.stockName || line.stockCode}" ürünü için birim fiyat Fiyat 3 tabanının (${sym}${p3.toFixed(2)}) altına düşemez!`
                )
              } else {
                throw new Error(
                  `"${line.stockName || line.stockCode}" ürünü için toplam indirim sınırları aşıldı! Minimum izin verilen birim fiyat: ${sym}${minUnitPrice.toFixed(2)} (Plasiyer indirim sınırı: %${rate}).`
                )
              }
            }
          }
        }
      }

      let savedId: number | string | null = editOfferId
      if (editOfferId) {
        await updateCustomerOffer(editOfferId, payload as any)
      } else {
        const res = await createCustomerOffer(
          (copySourceOfferId && isMuhtelif ? { ...payload, copyFromOfferId: copySourceOfferId } : payload) as any
        )
        savedId = res.id
      }
      setCreateOpen(false)
      setEditOfferId(null)
      await loadAll()

      if (savedId) {
        setSavedOfferId(savedId)
        setSelectedPrintTemplate('')
        setSuccessPrintModalOpen(true)
      }

      if (isMuhtelif && selectedCustomer) {
        // noop
      }
    } catch (e: any) {
      setError(String(e?.message ?? 'Teklif kaydedilemedi'))
    } finally {
      setLoading(false)
    }
  }

  const requestDelete = (row: CustomerOffer) => {
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
      await deleteCustomerOffer(confirmOfferId)
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

  const customerOfferColumns = useMemo<ColumnDef<CustomerOffer, any>[]>(
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
        accessorKey: 'deliveryCustomerName',
        header: 'Teslimat Carisi',
        meta: { filterType: 'text', filterPlaceholder: 'Teslimat Carisi...' }
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

  const getRowActions = (row: CustomerOffer): DataTableRowAction<CustomerOffer>[] => {
    const actions: DataTableRowAction<CustomerOffer>[] = []
    const isProforma = Boolean(row.proformaDocumentNo)
    if (canDuzenle) {
      actions.push({
        label: 'Düzenle',
        icon: <Pencil size={14} />,
        onClick: (r) => void openEdit(r.id)
      })
    }
    /*
      Kopyala yeni teklif AÇAR, mevcudu değiştirmez; bu yüzden düzenleme yetkisine değil
      oluşturmaya denk. Sayfadaki "Yeni Müşteri Teklifi" düğmesi de ayrı bir anahtara bağlı
      değil (sayfanın kendi yetkisi kapı görevi görüyor), o yüzden burada da ek kapı yok —
      koysaydık teklif açabilen kullanıcı kopyalayamaz hale gelirdi.
    */
    actions.push({
      label: 'Kopyala',
      icon: <Copy size={14} />,
      onClick: (r) => void openEdit(r.id, true)
    })
    actions.push({
      label: 'Yazdır (Özellikli)',
      icon: <Printer size={14} />,
      onClick: (r) => void handlePrintOffer(r.id, 'standard', false)
    })
    actions.push({
      label: 'Yazdır (Özelliksiz)',
      icon: <Printer size={14} />,
      onClick: (r) => void handlePrintOffer(r.id, 'simple', false)
    })
    actions.push({
      /*
        YATAY BASIM ayrı bir yoldan gider: diğer iki seçenek sunucunun ürettiği PDF'i açıyor
        (`/yazdir`, PdfSharp ile çizilen sabit tablo düzeni). Yatay düzen ürün kutularından
        oluşuyor ve ürün özelliği çok uzun olabildiği için kutu yüksekliğinin metne göre
        uzaması gerekiyor — bunu tarayıcının kendi sayfalaması hatasız yapıyor, PDF çiziminde
        her kutunun yüksekliğini elle ölçmek gerekirdi. Bu yüzden HTML önizleyicisi kullanılır.
      */
      label: 'Yazdır (Yatay)',
      icon: <Printer size={14} />,
      onClick: (r) => {
        window.open(`/print/preview?type=customerOffer&id=${encodeURIComponent(String(r.id))}&template=landscape`, '_blank')
      }
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

  const renderExpandedRowContent = (row: CustomerOffer) => {
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
      title="Müşteri Teklifleri"
      breadcrumb="Fatura İşlemleri / Müşteri Teklifi"
      searchValue={globalSearch}
      onSearchChange={setGlobalSearch}
      rightActions={
        <button
          type="button"
          onClick={openCreate}
          className="h-[38px] inline-flex items-center gap-2 px-4 text-xs font-semibold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg shadow-sm transition"
        >
          <Plus size={14} />
          Yeni Müşteri Teklifi
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
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-gray-700 transition disabled:opacity-60"
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

      {/* KAMPANYA KULLAN — aktif kampanyaların ürünlerini kampanyalı fiyatla satır olarak ekler. */}
      <Modal
        isOpen={kampanyaModalOpen}
        onClose={() => setKampanyaModalOpen(false)}
        title="Kampanya Kullan"
        sizeKey="musteriTeklifiKampanya"
        containerClassName="max-w-4xl"
        footer={
          <div className="flex items-center justify-between gap-2 w-full">
            <div className="text-[11px] text-slate-500">
              Fiyatlar Fiyat 4 üzerinden hesaplanır, carinin fiyat grubuna göre gelir. Eklenen satırın fiyatı değiştirilemez.
            </div>
            <button
              type="button"
              onClick={() => setKampanyaModalOpen(false)}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-gray-700 transition"
            >
              Kapat
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {kampanyaLoading && <div className="py-10 text-center text-sm text-slate-500">Kampanyalar yükleniyor…</div>}
          {kampanyaError && <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700">{kampanyaError}</div>}
          {!kampanyaLoading && !kampanyaError && kampanyaGruplari.length === 0 && (
            <div className="py-10 text-center text-sm text-slate-500">
              Bu cari için aktif ürün / kategori kampanyası yok.
              {kampanyaGrupAdi && <div className="mt-1 text-xs text-slate-400">Carinin fiyat grubu: {kampanyaGrupAdi}. Kampanya bu gruba tanımlı değilse burada listelenmez.</div>}
            </div>
          )}
          {!kampanyaLoading && kampanyaGruplari.map(({ campaign, items, neden }) => {
            const ilk = campaign.discounts?.[0]
            const indirimYazisi = ilk
              ? (String(ilk.iskontoTipiText ?? '').trim() === 'Oran' ? `%${ilk.deger}` : `${formatMoneyWithCurrency(Number(ilk.deger ?? 0), 'TRY')} (F4'ten)`)
              : ''
            const eklenebilir = items.filter((u) => !draft.lines.some((l) => String(l.stockCode ?? '').trim().toUpperCase() === String(u.product?.stockCode ?? '').trim().toUpperCase()))
            return (
              <div key={campaign.id} className="rounded-xl border border-indigo-100 bg-white overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-indigo-50/70 border-b border-indigo-100">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Gift size={14} className="text-indigo-600" />
                      <span className="truncate">{campaign.name}</span>
                      {indirimYazisi && <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">{indirimYazisi}</span>}
                    </div>
                    {campaign.description && <div className="text-[11px] text-slate-500 truncate">{campaign.description}</div>}
                  </div>
                  {eklenebilir.length > 1 && (
                    <button
                      type="button"
                      onClick={() => eklenebilir.forEach((u) => kampanyaSatiriEkle(u, campaign.name))}
                      className="shrink-0 text-[11px] font-bold text-indigo-700 hover:text-indigo-900 underline underline-offset-2"
                    >
                      Tümünü ekle ({eklenebilir.length})
                    </button>
                  )}
                </div>
                {items.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-amber-700 bg-amber-50/60">{neden || 'Bu kampanyada carinin fiyat grubuna uyan ürün bulunamadı.'}</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Stok</th>
                        <th className="px-3 py-2 text-left">Ürün</th>
                        <th className="px-3 py-2 text-right">Fiyat</th>
                        <th className="px-3 py-2 text-right">Kampanyalı</th>
                        <th className="px-3 py-2 text-right w-24"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((u) => {
                        const sc = String(u.product?.stockCode ?? '').trim()
                        const eklendi = draft.lines.some((l) => String(l.stockCode ?? '').trim().toUpperCase() === sc.toUpperCase())
                        return (
                          <tr key={sc} className="hover:bg-slate-50/70">
                            <td className="px-3 py-2 font-mono font-semibold text-slate-700">{sc}</td>
                            <td className="px-3 py-2 text-slate-700">{String(u.product?.name ?? '')}</td>
                            <td className="px-3 py-2 text-right text-slate-400 line-through tabular-nums">{formatMoneyWithCurrency(u.basePrice, u.currency)}</td>
                            <td className="px-3 py-2 text-right font-bold text-emerald-700 tabular-nums">{formatMoneyWithCurrency(u.campaignPrice, u.currency)}</td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                disabled={eklendi}
                                onClick={() => kampanyaSatiriEkle(u, campaign.name)}
                                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-600 hover:text-white border border-emerald-200 hover:border-emerald-600 transition-all disabled:opacity-50 disabled:hover:bg-emerald-50 disabled:hover:text-emerald-700"
                              >
                                {eklendi ? 'Eklendi' : '+ Ekle'}
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </div>
      </Modal>

      {/* CARİ EKLE — teklif penceresinden kalıcı bayi carisi açar. Muhtelif akışı bundan etkilenmez. */}
      <Modal
        isOpen={cariModalOpen}
        onClose={() => {
          if (cariSaving) return
          setCariModalOpen(false)
        }}
        title="Cari Ekle"
        sizeKey="musteriTeklifiCariEkle"
        containerClassName="max-w-3xl"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={cariSaving}
              onClick={() => setCariModalOpen(false)}
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-gray-700 transition disabled:opacity-60"
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={cariSaving}
              onClick={() => void saveCari()}
              className="h-[34px] inline-flex items-center gap-1.5 px-4 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition disabled:opacity-60"
            >
              {cariSaving ? 'Kaydediliyor...' : 'Cariyi Oluştur'}
            </button>
          </div>
        }
      >
        {cariError && (
          <div className="mb-3 text-xs font-bold text-red-600 bg-red-50 border border-red-200 p-3 rounded-xl">{cariError}</div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <FormInput label="Cari Kodu" value="Otomatik atanacak" onChange={() => { }} disabled />
            <FormInput label="Cari Tipi" value="Bayi" onChange={() => { }} disabled />
            <FormSelect
              label="Plasiyer"
              value={cariForm.salesmanCode}
              onChange={(e) => setCariForm((p) => ({ ...p, salesmanCode: e.target.value }))}
              options={[
                { value: '', label: salesmenLoading ? 'Yükleniyor...' : 'Seçiniz...' },
                ...(salesmen ?? []).map((s) => ({
                  value: s.salesmanCode,
                  label: `${s.salesmanCode} - ${s.description}`
                }))
              ]}
            />
          </div>

          <FormInput
            label="Cari Adı"
            value={cariForm.name}
            onChange={(e) => setCariForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="Cari adı"
          />

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Fiyat Grubu</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: 'FATURA' as const, label: 'Fatura', hint: 'Fiyat 1 · Fatura no elle', active: 'bg-blue-600' },
                { key: 'ISTISNA' as const, label: 'İstisna', hint: 'Fiyat 4 · Açık cari', active: 'bg-amber-600' },
                { key: 'ASKERIYE' as const, label: 'Askeriye', hint: 'Fiyat 7 · Fatura no elle', active: 'bg-emerald-600' }
              ]).map((opt) => {
                const selected = cariForm.priceGroupKind === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setCariForm((p) => ({ ...p, priceGroupKind: opt.key }))}
                    className={
                      'px-3 py-2 rounded-xl border text-left transition active:scale-95 ' +
                      (selected
                        ? `${opt.active} text-white border-transparent shadow-sm`
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50')
                    }
                  >
                    <div className="text-xs font-bold">{opt.label}</div>
                    <div className={'text-[10px] mt-0.5 ' + (selected ? 'text-white/80' : 'text-slate-400')}>{opt.hint}</div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormInput label="İl" value={cariForm.city} onChange={(e) => setCariForm((p) => ({ ...p, city: e.target.value }))} />
            <FormInput label="İlçe" value={cariForm.district} onChange={(e) => setCariForm((p) => ({ ...p, district: e.target.value }))} />
          </div>

          <FormInput label="Adres" value={cariForm.address} onChange={(e) => setCariForm((p) => ({ ...p, address: e.target.value }))} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormInput label="Telefon" value={cariForm.phone} onChange={(e) => setCariForm((p) => ({ ...p, phone: e.target.value }))} />
            <FormInput label="E-Posta" value={cariForm.email} onChange={(e) => setCariForm((p) => ({ ...p, email: e.target.value }))} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormInput label="Vergi Dairesi" value={cariForm.taxOffice} onChange={(e) => setCariForm((p) => ({ ...p, taxOffice: e.target.value }))} />
            <FormInput label="Vergi No" value={cariForm.taxNumber} onChange={(e) => setCariForm((p) => ({ ...p, taxNumber: e.target.value }))} />
          </div>
        </div>
      </Modal>

      {topBar}

      <AppDataTable
        onRefresh={() => void loadAll()}
        data={filteredRows}
        columns={customerOfferColumns}
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
        title={editOfferId ? 'Müşteri Teklifi (Düzenle)' : 'Müşteri Teklifi'}
        scrollable
        containerClassName="max-w-7xl"
        footer={
          <div className="flex items-center justify-end gap-3 w-full">
            <button
              type="button"
              onClick={closeCreate}
              className="h-[38px] px-5 text-xs font-bold rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition active:scale-95 shadow-xs"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={saveDraft}
              className="h-[38px] inline-flex items-center gap-2 px-5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md hover:shadow-lg transition active:scale-95"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              <span>Kaydet</span>
            </button>
          </div>
        }
      >
        {error && <div className="mb-3 text-sm font-bold text-red-600 bg-red-50 border border-red-200 p-3.5 rounded-xl">{error}</div>}

        {priceWarning && (
          <div className="mb-3 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-bold text-amber-800 whitespace-pre-line flex items-center gap-2">
            <span>⚠️ {priceWarning}</span>
          </div>
        )}

        <div className="space-y-5">
          <div className="border border-slate-200/90 rounded-2xl bg-slate-50/50 p-4 md:p-5 space-y-4 shadow-xs">
            <div className="flex items-center justify-between border-b border-slate-200/60 pb-2.5">
              <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                <span>Müşteri Bilgileri</span>
              </div>
              <div className="flex items-center gap-2">
                {draftCustomer && (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200/60">
                    {draftCustomer}
                  </span>
                )}
                {canCariEkle && (
                  <button
                    type="button"
                    onClick={openCariModal}
                    className="h-[30px] inline-flex items-center gap-1.5 px-3 text-[11px] font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition active:scale-95"
                    title="Bu bilgilerle kalıcı bir bayi carisi aç ve teklifi o carinin adına sürdür"
                  >
                    <Plus size={13} />
                    Cari Ekle
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <FormInput label="Belge No" value={draft.documentNo} onChange={() => { }} placeholder="Belge numarası" disabled />

              <FormInput label="Tarih" type="date" value={draft.date} onChange={(e) => updateDraft({ date: e.target.value })} />

              <FormSelect
                label="Plasiyer Kodu"
                value={draftSalesRep}
                onChange={(e) => {
                  const val = e.target.value
                  setDraftSalesRep(val)
                  setDraftCustomer('')
                  setDraft((p) => ({ ...p, lines: [] }))
                }}
                options={[
                  { value: '', label: salesmenLoading ? 'Yükleniyor...' : 'Seçiniz...' },
                  ...(filteredSalesmen ?? []).map((s) => ({
                    value: s.salesmanCode,
                    label: `${s.salesmanCode} - ${s.description}`
                  }))
                ]}
                disabled={!isSuperAdmin && (userRoleId === 10 || !!currentCode) && currentCode !== '*'}
              />

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Cari</label>
                <SearchableCariSelect
                  value={draftCustomer}
                  disabled={!draftSalesRep || (!isSuperAdmin && !!currentCode && currentCode !== '*')}
                  showTypeFilter={false}
                  onChange={(v) => {
                    setDraftCustomer(v)
                    if (v) {
                      if (String(v).toUpperCase() !== 'MUHTELIF') {
                        const selected = customers.find((c) => c.customerCode === v)
                        setDraft((p) => ({
                          ...p,
                          customerName: selected ? String(selected.name ?? '') : '',
                          lines: [createEmptyLine()]
                        }))
                        if (selected && selected.salesmanCode && userRoleId !== 10) {
                          setDraftSalesRep(selected.salesmanCode)
                        }
                      } else {
                        setDraft((p) => ({
                          ...p,
                          customerName: muhtelifForm.name || 'Muhtelif Cari',
                          // KDV istisna KAPALI başlar; muhtelif olmak tek başına istisna
                          // sebebi değil. Gerekirse kullanıcı kutuyu kendisi işaretler.
                          lines: [createEmptyLine()]
                        }))
                        setMuhtelifForm((p) => ({ ...p, customerCode: '' }))
                        const ac = new AbortController()
                        void ensureMuhtelifCustomerCode(ac.signal, { force: true })
                      }
                    } else {
                      setDraft((p) => ({
                        ...p,
                        customerName: '',
                        lines: []
                      }))
                    }
                  }}
                  options={buildCustomerOfferOptions(customers, draftSalesRep, draftCustomer)}
                  remoteSearch={cariRemoteSearch}
                  remoteLimit={CARI_SEARCH_LIMIT}
                />
              </div>
            </div>

            {/* Yetkili & İletişim Bilgileri Card (Shows when Cari is selected) */}
            {draftCustomer && String(draftCustomer).toUpperCase() !== 'MUHTELIF' && (
              <div className="bg-gradient-to-r from-blue-50/90 via-indigo-50/40 to-slate-50 border border-blue-200/70 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shrink-0 shadow-xs">
                    <User size={18} />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Cari Yetkilisi</div>
                    <div className="font-bold text-slate-900 text-sm">
                      {authorizedLoading ? (
                        <span className="text-slate-400 font-normal italic">Yükleniyor...</span>
                      ) : authorizedContact?.fullName ? (
                        authorizedContact.fullName
                      ) : (
                        <span className="text-slate-500 font-medium italic">Yetkili bilgisi eklenmemiş</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {authorizedContact?.phone ? (
                    <div className="flex items-center gap-1.5 bg-white border border-blue-200 px-3 py-1.5 rounded-lg text-slate-800 font-bold shadow-2xs">
                      <Phone size={13} className="text-blue-600" />
                      <span>{authorizedContact.phone}</span>
                    </div>
                  ) : selectedCustomerObj?.phone ? (
                    <div className="flex items-center gap-1.5 bg-white border border-blue-200 px-3 py-1.5 rounded-lg text-slate-800 font-bold shadow-2xs">
                      <Phone size={13} className="text-blue-600" />
                      <span>{selectedCustomerObj.phone}</span>
                    </div>
                  ) : null}

                  {selectedCustomerObj?.email && (
                    <div className="flex items-center gap-1.5 bg-white border border-blue-200 px-3 py-1.5 rounded-lg text-slate-800 font-bold shadow-2xs">
                      <Mail size={13} className="text-blue-600" />
                      <span>{selectedCustomerObj.email}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end pt-1">
              {draftCustomer && String(draftCustomer).toUpperCase() !== 'MUHTELIF' && (
                <FormSelect
                  label="Teslimat Carisi"
                  value={draftDeliveryCustomer}
                  onChange={(e) => setDraftDeliveryCustomer(e.target.value)}
                  options={deliveryOptions.map((o) => ({
                    value: o.customerCode,
                    label: `${o.customerCode} - ${o.name}`
                  }))}
                />
              )}

              <div className="flex items-center h-10 px-3 bg-white border border-slate-200 rounded-xl">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                    checked={draft.vatExempt}
                    onChange={(e) => {
                      const nextVatExempt = e.target.checked
                      setDraft((p) => ({
                        ...p,
                        vatExempt: nextVatExempt,
                        lines: p.lines.map((l) => {
                          const updated = { ...l }
                          updated.discountValue = getCappedLineDiscount(updated, effectiveDiscountRate ?? userDiscountRate ?? null, nextVatExempt, sinirsizIndirim)
                          return updated
                        })
                      }))
                    }}
                  />
                  <span>KDV İstisna</span>
                </label>
              </div>

              <div className="md:col-span-2 lg:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Açıklama</label>
                <textarea
                  className="input-base min-h-[42px] max-h-[80px] text-xs py-2"
                  value={draft.description}
                  onChange={(e) => updateDraft({ description: e.target.value })}
                  placeholder="Açıklama giriniz..."
                />
              </div>
            </div>

            {String(draftCustomer ?? '').toUpperCase() === 'MUHTELIF' && (
              <div className="mt-4 border-t border-slate-200 pt-4 bg-white p-4 rounded-xl border">
                <div className="text-sm font-bold text-slate-900 mb-3">Muhtelif Bilgileri</div>

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
                    onChange={(e) => {
                      const val = e.target.value
                      setMuhtelifForm((p) => ({ ...p, name: val }))
                      setDraft((p) => ({ ...p, customerName: val }))
                    }}
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
                      <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">Adres</label>
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

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
                <span>Kalemler</span>
                <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                  {draft.lines.length} Kalem
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void openKampanyaModal()}
                  disabled={!draftCustomer}
                  title="Aktif kampanyalardan kampanyalı fiyatla satır ekle"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-bold text-xs shadow-2xs transition active:scale-95 disabled:opacity-50"
                >
                  <Gift size={15} className="text-indigo-600" />
                  <span>Kampanya Ekle</span>
                </button>
                <button
                  type="button"
                  onClick={addLine}
                  disabled={!draftCustomer}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs shadow-2xs transition active:scale-95 disabled:opacity-50"
                >
                  <Plus size={15} className="text-emerald-600" />
                  <span>Satır Ekle</span>
                </button>
              </div>
            </div>

            <div className="border border-slate-200/90 rounded-2xl bg-white overflow-hidden shadow-xs">
              <table className="w-full min-w-[1100px]">
                <thead>
                  <tr className="bg-slate-100/80 text-[11px] font-bold uppercase tracking-wider text-slate-700">
                    <th className="px-3 py-2.5 text-left w-[72px]">Stok</th>
                    <th className="px-3 py-2.5 text-left">Stok Kodu / Adı</th>
                    <th className="px-3 py-2.5 text-right w-[110px]">Miktar</th>
                    <th className="px-3 py-2.5 text-right w-[140px]">Fiyat</th>
                    <th className="px-3 py-2.5 text-left w-[130px]">İndirim Tipi</th>
                    <th className="px-3 py-2.5 text-right w-[110px]">İskonto</th>
                    <th className="px-3 py-2.5 text-right w-[130px]">İndirimli Birim Fiyat</th>
                    <th className="px-3 py-2.5 text-right">Net</th>
                    <th className="px-3 py-2.5 text-right w-[80px]">KDV</th>
                    <th className="px-3 py-2.5 text-right">KDV Tutar</th>
                    <th className="px-3 py-2.5 text-right">Toplam</th>
                    <th className="px-3 py-2.5 text-right w-[60px]" />
                  </tr>
                </thead>

                <tbody className="text-[12px] divide-y divide-slate-100">
                  {draft.lines.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-3 py-8 text-center text-slate-400 font-medium bg-slate-50/20">
                        Kalem ekleyebilmek için lütfen önce Plasiyer ve Cari seçimi yapınız.
                      </td>
                    </tr>
                  )}
                  {draft.lines.map((l) => {
                    const t = calcLineTotals(l, draft.vatExempt)
                    const stockText = `${(l.stockCode ?? '').trim()} ${(l.stockName ?? '').trim()}`.trim()
                    const kilitli = Boolean(l.campaignLocked)

                    return (
                      <tr key={l.id} className={kilitli ? 'bg-indigo-50/40 transition' : 'hover:bg-slate-50/80 transition'}>
                        <td className="px-3 py-2 align-top">
                          {kilitli ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700" title={l.campaignName ? `Kampanya: ${l.campaignName}` : 'Kampanya satırı'}>
                              <Gift size={12} /> Kamp.
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="text-xs font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50"
                              onClick={() => {
                                openProductPicker(l.id)
                              }}
                              disabled={!draftCustomer}
                            >
                              Seç
                            </button>
                          )}
                        </td>

                        <td className="px-3 py-2 align-top">
                          <div className="relative w-full">
                            <input
                              className="w-full px-2 py-1 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-700"
                              placeholder="Stok Kodu / Adı"
                              value={activeSearchLineId === l.id ? (lineSearchQueries[l.id] ?? '') : stockText}
                              disabled={!draftCustomer || kilitli}
                              title={kilitli && l.campaignName ? `Kampanya: ${l.campaignName}` : undefined}
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
                                  className="bg-white border border-slate-200 rounded-lg shadow-lg overflow-y-auto z-50 mt-1"
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
                                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-100/80 transition flex flex-col gap-0.5 border-b border-slate-100 last:border-b-0"
                                          onMouseDown={(e) => {
                                            e.preventDefault()
                                            setProductPickerForLineId(l.id)
                                            selectProductForLine(product, l.id)
                                            setActiveSearchLineId(null)
                                          }}
                                        >
                                          <span className="font-bold text-slate-900">{product.stockCode}</span>
                                          <span className="text-slate-600 line-clamp-2 whitespace-normal break-words">{product.name}</span>
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
                            className="w-[100px] px-2 py-1 text-xs border border-slate-200 rounded-lg text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                            value={String(l.quantity)}
                            onChange={(e) => updateLine(l.id, { quantity: Math.max(0, Number(e.target.value)) })}
                            onBlur={() => finalizeLine(l.id)}
                          />
                        </td>

                        <td className="px-3 py-2 align-top text-right">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="w-[120px] px-2 py-1 text-xs border border-slate-200 rounded-lg text-right focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-indigo-50 disabled:text-indigo-800 disabled:font-bold"
                            value={String(l.unitPrice)}
                            disabled={kilitli}
                            title={kilitli ? 'Kampanya fiyatı — değiştirilemez' : undefined}
                            onChange={(e) => {
                              const newPrice = Math.max(0, Number(e.target.value))
                              updateLine(l.id, { unitPrice: newPrice })
                            }}
                            onBlur={() => finalizeLine(l.id)}
                          />
                          {(userRoleId === 10 || userRoleId === 12) && (effectiveDiscountRate ?? userDiscountRate) != null && l.originalUnitPrice > 0 && (() => {
                            const activeRate = Number(effectiveDiscountRate ?? userDiscountRate ?? 0)
                            const p3 = safeNumber(l.price3 ?? 0)
                            const discountFloor = l.originalUnitPrice * (1 - activeRate / 100)
                            const minVal = p3 > 0 ? Math.max(p3, discountFloor) : discountFloor
                            return (
                              <div className="text-[9px] text-gray-400 mt-0.5 text-right">
                                Min: {getCurrencySymbol(l.currencyCode)}{minVal.toFixed(2)}
                              </div>
                            )
                          })()}
                        </td>

                        <td className="px-3 py-2 align-top">
                          <select
                            className="w-[120px] px-2 py-1 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50"
                            value={l.discountType}
                            disabled={kilitli}
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
                            className="w-[90px] px-2 py-1 text-xs border border-slate-200 rounded-lg text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                            value={
                              l.discountType === 'amount'
                                ? String(Number((safeNumber(l.discountValue) * (draft.vatExempt ? 1 : (1 + safeNumber(l.vatRate) / 100))).toFixed(4)))
                                : String(l.discountValue)
                            }
                            onChange={(e) => {
                              const val = Math.max(0, Number(e.target.value))
                              if (l.discountType === 'amount') {
                                const mult = draft.vatExempt ? 1 : (1 + safeNumber(l.vatRate) / 100)
                                const maxVal = safeNumber(l.unitPrice) * mult
                                const cappedVal = Math.min(maxVal, val)
                                const storedVal = mult > 0 ? cappedVal / mult : cappedVal
                                updateLine(l.id, { discountValue: storedVal })
                              } else {
                                const finalVal = Math.min(100, val)
                                updateLine(l.id, { discountValue: finalVal })
                              }
                            }}
                            onBlur={() => finalizeLine(l.id)}
                            disabled={l.discountType === 'none' || kilitli}
                          />
                          {/* Sınırsız indirim yetkisinde "Maks" ipucu hiç gösterilmez: taban yok,
                              gösterilecek bir üst sınır da yok. Bırakılsaydı taban fiyattan
                              türeyen anlamsız bir rakam yazardı. */}
                          {effectiveDiscountRate != null && l.discountType !== 'none' && !sinirsizIndirim && (() => {
                            const limits = getDiscountLimits(l, draft.vatExempt, effectiveDiscountRate, sinirsizIndirim)
                            if (l.discountType === 'percentage') {
                              return (
                                <div className="text-[9px] text-gray-400 mt-0.5 text-right font-medium">
                                  Maks: %{limits.maxPercentage.toFixed(2)}
                                </div>
                              )
                            } else if (l.discountType === 'amount') {
                              return (
                                // Kutuya girilen değer ADET BAŞINA ve KDV DAHİL; ipucu da öyle.
                                // Eskiden satır toplamı (KDV hariç) yazıyordu: 2 adette iki katı.
                                <div className="text-[9px] text-gray-400 mt-0.5 text-right font-medium">
                                  Maks: {getCurrencySymbol(l.currencyCode)}{(limits.maxRemainingDiscountInc / Math.max(1, safeNumber(l.quantity ?? 1))).toFixed(2)}
                                </div>
                              )
                            }
                            return null
                          })()}
                        </td>

                        {/* Indirim uygulandiktan sonraki BIRIM fiyat; hesabi `calcLineTotals` icinde. */}
                        <td className="px-3 py-2 align-top text-right font-semibold text-slate-900">
                          {formatMoneyWithCurrency(t.netUnit, l.currencyCode)}
                        </td>

                        <td className="px-3 py-2 align-top text-right font-medium text-slate-800">{formatMoneyWithCurrency(t.net, l.currencyCode)}</td>

                        <td className="px-3 py-2 align-top text-right">
                          <input
                            type="number"
                            min={0}
                            className="w-[70px] px-2 py-1 text-xs border border-slate-200 rounded-lg text-right focus:outline-none focus:ring-1 focus:ring-blue-500 bg-slate-50 cursor-not-allowed"
                            value={String(l.vatRate)}
                            disabled={true}
                          />
                        </td>

                        <td className="px-3 py-2 align-top text-right text-slate-700">{formatMoneyWithCurrency(t.vatAmount, l.currencyCode)}</td>
                        <td className="px-3 py-2 align-top text-right font-bold text-slate-900">{formatMoneyWithCurrency(t.total, l.currencyCode)}</td>

                        <td className="px-3 py-2 align-top text-right">
                          <button
                            type="button"
                            onClick={() => removeLine(l.id)}
                            className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                            title="Sil"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex justify-end">
              <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-2 text-xs">
                <div className="flex justify-between items-center text-slate-600">
                  <span>Ara Toplam</span>
                  <span className="font-semibold text-slate-900">{formatMoneyWithCurrency(draftTotals.subTotal, draftCurrency)}</span>
                </div>

                <div className="flex justify-between items-center text-slate-600">
                  <span>İndirim</span>
                  <span className="font-semibold text-slate-900">{formatMoneyWithCurrency(draftTotals.discountTotal, draftCurrency)}</span>
                </div>

                <div className="flex justify-between items-center text-slate-600">
                  <span>Net Toplam</span>
                  <span className="font-semibold text-slate-900">{formatMoneyWithCurrency(draftTotals.netTotal, draftCurrency)}</span>
                </div>

                <div className="flex justify-between items-center text-slate-600">
                  <span>KDV Toplam</span>
                  <span className="font-semibold text-slate-900">{formatMoneyWithCurrency(draftTotals.vatTotal, draftCurrency)}</span>
                </div>

                <div className="flex justify-between items-center pt-2.5 border-t border-slate-200 text-sm font-bold text-slate-900">
                  <span>Genel Toplam</span>
                  <span className="text-base text-emerald-600 font-extrabold">{formatMoneyWithCurrency(draftTotals.grandTotal, draftCurrency)}</span>
                </div>
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
              className="h-[34px] px-4 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-gray-700 transition"
            >
              Kapat
            </button>
          </>
        }
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1">
            <FormInput
              label="Ara"
              value={productPickerQuery}
              onChange={(e) => setProductPickerQuery(e.target.value)}
              placeholder="Stok kodu / ürün adı"
            />
          </div>
          <button
            type="button"
            onClick={() => searchProducts(productPickerQuery)}
            className="mt-6 inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-gray-800 font-semibold"
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
            options={[
              { value: '', label: 'Tümü' },
              ...categoriesState.mains.map(m => ({ value: m, label: m }))
            ]}
          />
          <FormSelect
            label="Alt Kategori"
            value={pickerSubCat}
            onChange={(e) => {
              const v = e.target.value
              setPickerSubCat(v)
              void searchProducts(productPickerQuery, { sub: v })
            }}
            options={[
              { value: '', label: 'Tümü' },
              ...(categoriesState.subsByMain[pickerMainCat] ?? []).map(s => ({ value: s, label: s }))
            ]}
            disabled={!pickerMainCat}
          />
        </div>

        {productPickerError && <div className="mb-3 text-sm font-semibold text-red-600">{productPickerError}</div>}

        <div className="border border-slate-200 rounded-lg overflow-hidden">
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
                  <tr key={String(p.id)} className="border-t border-gray-100 hover:bg-slate-50">
                    <td className="px-3 py-2 align-top">{String(p.stockCode ?? '')}</td>
                    <td className="px-3 py-2 align-top">
                      {String(p.name ?? '')}
                      {p.stock !== undefined && p.stock !== null && (
                        <span className={`ml-2 inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-full ${Number(p.stock) > 12 ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-gray-50 text-gray-600 border border-gray-200'}`}>
                          {!tamStokGorsun && Number(p.stock) > 12 ? '12+' : Math.max(0, Math.floor(Number(p.stock)))}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      {p?.__basePrice == null ? '-' : formatMoneyWithCurrency(Number(p.__basePrice ?? 0), p.__baseCurrency)}
                    </td>
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
                        className="inline-flex items-center justify-center w-8 h-8 rounded border border-slate-200 bg-white hover:bg-slate-50"
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
        isOpen={successPrintModalOpen}
        onClose={() => {
          setSuccessPrintModalOpen(false)
          setSavedOfferId(null)
        }}
        title="Kayıt Başarılı"
        containerClassName="max-w-md text-center"
      >
        <div className="flex flex-col items-center justify-center p-4">
          <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mb-4 border border-emerald-100">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-4">Kayıt Başarılı</h3>
          
          <div className="w-full text-left mb-6">
            <FormSelect
              label="Dizayn Seçin"
              value={selectedPrintTemplate}
              onChange={(e) => setSelectedPrintTemplate(e.target.value)}
              options={[
                { value: '', label: 'Lütfen Dizayn Seçin.' },
                { value: 'standard', label: 'Özellikli Teklif Form' },
                { value: 'simple', label: 'Özelliksiz Teklif Form' }
              ]}
            />
          </div>

          <div className="flex items-center justify-center gap-3 w-full">
            <button
              type="button"
              className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-gray-700 transition"
              onClick={() => {
                setSuccessPrintModalOpen(false)
                setSavedOfferId(null)
              }}
            >
              Kapat
            </button>
            <button
              type="button"
              disabled={!selectedPrintTemplate}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-sm transition inline-flex items-center gap-1.5"
              onClick={async () => {
                if (savedOfferId) {
                  await handlePrintOffer(savedOfferId, selectedPrintTemplate as any, true)
                }
                setSuccessPrintModalOpen(false)
                setSavedOfferId(null)
              }}
            >
              <Eye size={14} />
              Görüntüle
            </button>
            <button
              type="button"
              disabled={!selectedPrintTemplate}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-sm transition inline-flex items-center gap-1.5"
              onClick={async () => {
                if (savedOfferId) {
                  await handlePrintOffer(savedOfferId, selectedPrintTemplate as any, false)
                }
                setSuccessPrintModalOpen(false)
                setSavedOfferId(null)
              }}
            >
              <Printer size={14} />
              Yazdır
            </button>
          </div>
        </div>
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
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition inline-flex items-center gap-1.5"
              onClick={async () => {
                if (transferredProformaId) {
                  try {
                    await printProforma(transferredProformaId, 'customer')
                  } catch (e: any) {
                    showMessage('Hata', String(e?.message ?? 'Yazdırılamadı'))
                  }
                }
                setProformaTransferModalOpen(false)
                setTransferredProformaId(null)
              }}
            >
              <Printer size={14} />
              Belgeyi Görüntüle
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
