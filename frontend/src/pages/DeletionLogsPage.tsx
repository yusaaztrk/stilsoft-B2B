import React, { useEffect, useMemo, useState } from 'react'
import Table, { type TableColumn } from '../components/Table'
import { API_BASE_URL } from '../config/api'
import Modal from '../components/Modal'

type Row = {
  id: number
  deletedAt: string
  deletedAtFull: string
  deletedBy: string
  moduleKey: string
  pageKey: string
  recordType: string
  recordId: string
  parentType?: string | null
  parentId?: string | null
  description?: string | null
  detailsJson?: string | null
  /** Silen kişinin yazdığı neden (2026-10-04); eski kayıtlarda boş. */
  reason?: string | null
}

const moduleLabelMap: Record<string, string> = {
  users: 'Ayarlar',
  invoice: 'Fatura İşlemleri',
  cash: 'Kasa İşlemleri',
  pos: 'Sanal Pos İşlemleri',
  check: 'Çek/Senet İşlemleri',
  bank: 'Banka İşlemleri',
  service: 'Servis İşlemleri',
  reports: 'Raporlar'
}

const pageLabelMap: Record<string, string> = {
  siparis: 'Sipariş',
  satisFatura: 'Satış Faturası',
  kampanya: 'Kampanya Tanım',
  faturaDokum: 'Fatura Dökümü',
  faturaDokumUstBilgiGuncelle: 'Üst Bilgi Güncelle',
  proformaFaturaDokumeAktar: 'Fatura Döküme Aktar (Proforma)',
  proformaBasim: 'Basım (Proforma)',
  proformaSil: 'Sil (Proforma)',
  alisUstBilgiGuncelle: 'Üst Bilgi Güncelle (Alış)',
  musteriTeklifi: 'Müşteri Teklifi',
  bsyHHide: 'BSY(H): Ürünü Gösterme',
  bsyHComingSoon: 'BSY(H): ComingSoon ile Göster',
  satisFaturaDepoBakiyeGorsun: 'Satış Faturası: Depo Bakiyesi Görsün',
  etiket: 'Etiket Basım Fiyatları',
  proforma: 'Proforma',
  magaza: 'Mağaza Sipariş',
  alis: 'Alış Siparişleri',
  depoTransfer: 'Depo Transfer',
  stokHareket: 'Stok Hareket Dökümü',
  depoStock: 'Depo Stok Durumu',
  satis: 'Satış Faturaları',
  depoBakiye: 'Depo Bakiye Listesi',
  termin: 'Termin',
  kasaGirisCikis: 'Kasa Giriş/Çıkış',
  kasalarArasiTransfer: 'Kasalar Arası Transfer',
  posPayment: 'Kredi Kartı ile Ödeme',
  posReport: 'Kredi Kartı Çekim Raporu',
  customerCheck: 'Müşteri Çeki',
  debtCheck: 'Borç Çeki',
  debtNote: 'Borç Seneti',
  bankaHavaleEft: 'Banka Havale/EFT',
  kabulListesi: 'Kabul Listesi',
  montajListesi: 'Montaj Listesi',
  montajRapor: 'Montaj Rapor',
  montajAnaliz: 'Montaj Analiz',
  cariEkstre: 'Cari Ekstre',
  cariBorcAlacak: 'Cari Borç Alacak',
  yaslandirma: 'Yaşlandırma',
  cariSatisRaporu: 'Cari Satış Raporu',
  bankaRaporlari: 'Banka Raporları',
  kasaRaporlari: 'Kasa Raporları',
  urunSatisRaporuDetayli: 'Ürün Satış Raporu Detaylı',
  urunSatisRaporuAylik: 'Ürün Satış Raporu (Aylık)',
  siparisRaporu: 'Sipariş Raporu',
  aktifSepetRaporu: 'Aktif Sepet Raporu',
  limitRiskSatisRaporu: 'Limit Risk Satış Raporu',
  muhasebeStokGirisCikisRaporu: 'Muhasebe Stok Giriş/Çıkış Raporu',
  satisPazarlamaRaporu: 'Satış Pazarlama Raporu',
  fiyatListesi: 'Fiyat Listesi',
  kullaniciListesi: 'Kullanıcı Listesi',
  stokListesi: 'Stok Listesi',
  depolar: 'Depolar',
  bankaHesapTanim: 'Banka Hesap Tanım',
  rolYetkileri: 'Rol Yetkileri',
  kategoriYonetimi: 'Kategori Yönetimi',
  urunYonetimi: 'Ürün Yönetimi',
  atiliFiyatlandirma: 'Fiyat Atama',
  fiyatKategorileri: 'Fiyat Kategorileri',
  cariEkle: 'Cari Ekle',
  tedarikciEkle: 'Tedarikçi Ekle',
  irsaliye: 'Konsinye',
  silinenKayitlar: 'Silinen Kayıtlar',
  installmentRules: 'Taksit Bilgileri',
  calisan: 'Çalışan',
  kasalarim: 'Kasalarım',
  bayiTeklifleri: 'Cari Proforma',
  maliDonemler: 'Mali Dönemler'
}

const getModuleLabel = (key: string) => {
  const norm = String(key ?? '').trim().toLowerCase()
  const foundKey = Object.keys(moduleLabelMap).find((k) => k.toLowerCase() === norm)
  return foundKey ? moduleLabelMap[foundKey] : key
}

const getPageLabel = (key: string) => {
  const norm = String(key ?? '').trim().toLowerCase()
  const foundKey = Object.keys(pageLabelMap).find((k) => k.toLowerCase() === norm)
  return foundKey ? pageLabelMap[foundKey] : key
}

const recordTypeLabelMap: Record<string, string> = {
  BankAccountDefinition: 'Banka Hesap Tanımı',
  ProformaToInvoice: 'Proforma Faturaya Dönüştürme',
  CariProformaToInvoice: 'Cari Proforma Faturaya Dönüştürme',
  Fatura: 'Fatura',
  FaturaKalemi: 'Fatura Kalemi',
  Irsaliye: 'İrsaliye',
  IrsaliyeBatch: 'Toplu İrsaliye',
  Siparis: 'Sipariş',
  SiparisKalemi: 'Sipariş Kalemi',
  Campaign: 'Kampanya',
  Employee: 'Çalışan',
  Warehouse: 'Depo',
  CustomerOffer: 'Müşteri Teklifi',
  Supplier: 'Tedarikçi',
  SalesOrder: 'Sipariş',
  SalesOrderLine: 'Sipariş Kalemi',
  InvoiceHeader: 'Fatura',
  InvoiceLine: 'Fatura Kalemi'
}

const getRecordTypeLabel = (key: string) => {
  const norm = String(key ?? '').trim().toLowerCase()
  const foundKey = Object.keys(recordTypeLabelMap).find((k) => k.toLowerCase() === norm)
  return foundKey ? recordTypeLabelMap[foundKey] : key
}

function formatDateTime(s: string) {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return String(s ?? '')
  return d.toLocaleString('tr-TR')
}

function renderImpactAnalysis(
  row: Row,
  details: any,
  lines: any[],
  cashTransactions: any[],
  bankTransactions: any[],
  customerLedgerEntries: any[],
  supplierLedgerEntries: any[]
) {
  const isPurchase =
    row.recordType === 'PurchaseInvoice' ||
    row.pageKey === 'alis' ||
    row.pageKey === 'alisSil' ||
    details.kind === 0 ||
    details.Kind === 0 ||
    (row.description && row.description.toLowerCase().includes('alış faturası'))

  const primaryCustomerCode = (details.customerCode || details.CustomerCode || details.supplierCode || details.SupplierCode || '').trim()

  // Group customer ledger entries to prevent duplicates
  const customerLedgerMap = new Map<string, { code: string; direction: number; totalAmount: number; count: number }>()
  for (const cle of customerLedgerEntries) {
    const rawCode = (cle.customerCode || cle.CustomerCode || '').trim()
    const code = (primaryCustomerCode && primaryCustomerCode !== 'MUHTELIF' && primaryCustomerCode !== '-') ? primaryCustomerCode : (rawCode || 'Cari')
    const dir = cle.direction ?? cle.Direction ?? 0
    const amt = Number(cle.amount ?? cle.Amount ?? 0)
    const key = `${code}_${dir}`
    if (!customerLedgerMap.has(key)) {
      customerLedgerMap.set(key, { code, direction: dir, totalAmount: amt, count: 1 })
    } else {
      const existing = customerLedgerMap.get(key)!
      existing.totalAmount += amt
      existing.count += 1
    }
  }
  const uniqueCustomerLedger = Array.from(customerLedgerMap.values())

  // Group supplier ledger entries
  const primarySupplierCode = (details.supplierCode || details.SupplierCode || '').trim()
  const supplierLedgerMap = new Map<string, { code: string; direction: number; totalAmount: number; count: number }>()
  for (const sle of supplierLedgerEntries) {
    const rawCode = (sle.supplierCode || sle.SupplierCode || '').trim()
    const code = primarySupplierCode ? primarySupplierCode : (rawCode || 'Tedarikçi')
    const dir = sle.direction ?? sle.Direction ?? 0
    const amt = Number(sle.amount ?? sle.Amount ?? 0)
    const key = `${code}_${dir}`
    if (!supplierLedgerMap.has(key)) {
      supplierLedgerMap.set(key, { code, direction: dir, totalAmount: amt, count: 1 })
    } else {
      const existing = supplierLedgerMap.get(key)!
      existing.totalAmount += amt
      existing.count += 1
    }
  }
  const uniqueSupplierLedger = Array.from(supplierLedgerMap.values())

  return (
    <div className="bg-gradient-to-br from-indigo-50/60 via-slate-50 to-white border border-indigo-100/80 rounded-2xl p-4 shadow-sm space-y-3">
      {/* Top Banner Header */}
      <div className="flex items-center gap-2.5 border-b border-indigo-100/80 pb-2.5">
        <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-sm shadow-md shadow-indigo-600/20">
          ⚡
        </div>
        <div>
          <h3 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider">Silinme İşleminin Sistem Etkileri & İptal Analizi</h3>
          <p className="text-[11px] text-slate-500 font-medium">Bu kaydın silinmesiyle stok, kasa/banka ve cari ekstrelerinde yapılan otomatik güncellemeler</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        {/* Stok Etkisi */}
        <div className="bg-white border border-amber-200/80 rounded-xl p-3 space-y-2 shadow-xs">
          <div className="font-bold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200/60 flex items-center justify-between text-[11px]">
            <span>📦 Stok Hareketi Etkisi</span>
            <span className="text-[10px] font-extrabold bg-amber-200/70 text-amber-900 px-1.5 py-0.5 rounded-md">{lines.length} Kalem</span>
          </div>
          {lines.length > 0 ? (
            <ul className="space-y-1.5 text-[11px] text-slate-700">
              {lines.map((l: any, i: number) => {
                const stockCode = l.stockCode || l.StockCode || '-'
                const desc = l.description || l.Description || ''
                const qty = Number(l.quantity ?? l.Quantity ?? 0)
                if (isPurchase) {
                  return (
                    <li key={i} className="leading-relaxed bg-rose-50/60 border border-rose-100 p-2 rounded-lg text-rose-900">
                      <span className="font-bold text-rose-700">🔻 -{qty.toLocaleString('tr-TR')} Adet: </span>
                      <strong className="font-mono text-slate-900">{stockCode}</strong> {desc ? `(${desc})` : ''} satın alma faturası silindiği için stoğunuzdan düşüldü.
                    </li>
                  )
                }
                return (
                  <li key={i} className="leading-relaxed bg-emerald-50/60 border border-emerald-100 p-2 rounded-lg text-emerald-900">
                    <span className="font-bold text-emerald-700">🟢 +{qty.toLocaleString('tr-TR')} Adet: </span>
                    <strong className="font-mono text-slate-900">{stockCode}</strong> {desc ? `(${desc})` : ''} satış faturası silindiği için stoğunuza geri eklendi.
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-[11px] text-slate-400 italic p-1">Bu kayıt ile stok hareketi etkilenmedi.</p>
          )}
        </div>

        {/* Kasa ve Banka Etkisi */}
        <div className="bg-white border border-sky-200/80 rounded-xl p-3 space-y-2 shadow-xs">
          <div className="font-bold text-sky-800 bg-sky-50 px-2.5 py-1 rounded-lg border border-sky-200/60 flex items-center justify-between text-[11px]">
            <span>💵 Kasa & Banka Bakiye Etkisi</span>
            <span className="text-[10px] font-extrabold bg-sky-200/70 text-sky-900 px-1.5 py-0.5 rounded-md">{cashTransactions.length + bankTransactions.length} İşlem</span>
          </div>
          {cashTransactions.length > 0 || bankTransactions.length > 0 ? (
            <ul className="space-y-1.5 text-[11px] text-slate-700">
              {cashTransactions.map((c: any, i: number) => {
                const name = c.cashAccountName || c.CashAccountName || (c.cashAccountId ? `Kasa #${c.cashAccountId}` : 'Kasa Hesabı')
                const amt = Number(c.amount ?? c.Amount ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })
                const dir = c.direction ?? c.Direction
                if (dir === 0) {
                  return (
                    <li key={`c-${i}`} className="leading-relaxed bg-amber-50/60 border border-amber-100 p-2 rounded-lg text-amber-900">
                      <span className="font-bold text-amber-700">🔻 Kasa Düşüşü: </span>
                      <strong className="text-slate-900">{name}</strong> hesabına girmiş olan <strong className="text-amber-800">{amt} TL</strong> tahsilat silindi (kasadan {amt} TL eksildi).
                    </li>
                  )
                }
                return (
                  <li key={`c-${i}`} className="leading-relaxed bg-emerald-50/60 border border-emerald-100 p-2 rounded-lg text-emerald-900">
                    <span className="font-bold text-emerald-700">🟢 Kasa İadesi: </span>
                    <strong className="text-slate-900">{name}</strong> hesabından çıkmış olan <strong className="text-emerald-800">{amt} TL</strong> ödeme silindi (kasaya {amt} TL geri eklendi).
                  </li>
                )
              })}
              {bankTransactions.map((b: any, i: number) => {
                const name = b.bankAccountName || b.BankAccountName || (b.bankAccountDefinitionId ? `Banka #${b.bankAccountDefinitionId}` : 'Banka Hesabı')
                const amt = Number(b.amount ?? b.Amount ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })
                const dir = b.direction ?? b.Direction
                if (dir === 0) {
                  return (
                    <li key={`b-${i}`} className="leading-relaxed bg-amber-50/60 border border-amber-100 p-2 rounded-lg text-amber-900">
                      <span className="font-bold text-amber-700">🔻 Banka Düşüşü: </span>
                      <strong className="text-slate-900">{name}</strong> hesabına girmiş olan <strong className="text-amber-800">{amt} TL</strong> tahsilat silindi (bankadan {amt} TL eksildi).
                    </li>
                  )
                }
                return (
                  <li key={`b-${i}`} className="leading-relaxed bg-emerald-50/60 border border-emerald-100 p-2 rounded-lg text-emerald-900">
                    <span className="font-bold text-emerald-700">🟢 Banka İadesi: </span>
                    <strong className="text-slate-900">{name}</strong> hesabından çıkmış olan <strong className="text-emerald-800">{amt} TL</strong> ödeme silindi (bankaya {amt} TL geri eklendi).
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-[11px] text-slate-400 italic p-1">İlişkili Kasa veya Banka hareketi yok.</p>
          )}
        </div>

        {/* Cari & Tedarikçi Ekstre Etkisi */}
        <div className="bg-white border border-purple-200/80 rounded-xl p-3 space-y-2 shadow-xs">
          <div className="font-bold text-purple-800 bg-purple-50 px-2.5 py-1 rounded-lg border border-purple-200/60 flex items-center justify-between text-[11px]">
            <span>👥 Cari Ekstre & Borç/Alacak Etkisi</span>
            <span className="text-[10px] font-extrabold bg-purple-200/70 text-purple-900 px-1.5 py-0.5 rounded-md">{uniqueCustomerLedger.length + uniqueSupplierLedger.length} Cari</span>
          </div>
          {uniqueCustomerLedger.length > 0 || uniqueSupplierLedger.length > 0 ? (
            <ul className="space-y-1.5 text-[11px] text-slate-700">
              {uniqueCustomerLedger.map((cle, i) => {
                const amt = cle.totalAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })
                const dirStr = cle.direction === 0 ? 'Borç' : 'Alacak'
                const nameOverride = details.customerNameOverride || details.CustomerNameOverride || details.muhtelifName || details.MuhtelifName
                const muhtelifCode = details.muhtelifCustomerCode || details.MuhtelifCustomerCode
                const extraName = [muhtelifCode, nameOverride].filter(Boolean).join(' - ')
                const displayCustomerText = extraName ? `${cle.code} (Muhtelif: ${extraName})` : cle.code

                return (
                  <li key={`cle-${i}`} className="leading-relaxed bg-purple-50/60 border border-purple-100 p-2 rounded-lg text-purple-950">
                    <div className="font-bold text-purple-900 flex items-center gap-1">
                      <span>👤</span> Müşteri Kodu: <span className="font-mono text-indigo-700 font-extrabold">{displayCustomerText}</span>
                    </div>
                    <div className="mt-0.5 text-slate-600">
                      Cari Ekstresindeki <strong className="text-purple-900 font-bold">{amt} TL ({dirStr})</strong> kaydı silindi (müşteri bakiyesi güncellendi).
                    </div>
                  </li>
                )
              })}
              {uniqueSupplierLedger.map((sle, i) => {
                const amt = sle.totalAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })
                const dirStr = sle.direction === 0 ? 'Alacak' : 'Borç'
                return (
                  <li key={`sle-${i}`} className="leading-relaxed bg-indigo-50/60 border border-indigo-100 p-2 rounded-lg text-indigo-950">
                    <div className="font-bold text-indigo-900 flex items-center gap-1">
                      <span>🏭</span> Tedarikçi Kodu: <span className="font-mono text-indigo-700 font-extrabold">{sle.code}</span>
                    </div>
                    <div className="mt-0.5 text-slate-600">
                      Cari Ekstresindeki <strong className="text-indigo-900 font-bold">{amt} TL ({dirStr})</strong> kaydı silindi (tedarikçi bakiyesi güncellendi).
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-[11px] text-slate-400 italic p-1">Ekstreden kaldırılan borç/alacak kaydı yok.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function renderDetails(row: Row) {
  if (!row.detailsJson) return null
  try {
    const details = JSON.parse(row.detailsJson)
    const lines = details.lines || details.Lines || []
    const cashTransactions = details.cashTransactions || details.CashTransactions || []
    const bankTransactions = details.bankTransactions || details.BankTransactions || []
    const customerLedgerEntries = details.customerLedgerEntries || details.CustomerLedgerEntries || []
    const supplierLedgerEntries = details.supplierLedgerEntries || details.SupplierLedgerEntries || []

    return (
      <div className="space-y-4 text-xs">
        {/* General Info */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-gray-50 p-3.5 rounded-xl border border-gray-100">
          <div>
            <span className="text-gray-400 font-medium block text-[10px] uppercase tracking-wider mb-0.5">Belge No / ID</span>
            <span className="text-gray-800 font-bold font-mono text-sm">
              {details.invoiceNo || details.InvoiceNo || details.documentNo || details.DocumentNo || details.orderNo || details.OrderNo || details.irsaliyeNo || details.IrsaliyeNo || row.recordId}
            </span>
          </div>
          <div>
            <span className="text-gray-400 font-medium block text-[10px] uppercase tracking-wider mb-0.5">Cari / Müşteri Kod</span>
            <span className="text-gray-800 font-bold font-mono text-sm">
              {(() => {
                const code = details.customerCode || details.CustomerCode || details.supplierCode || details.SupplierCode || '-'
                const nameOverride = details.customerNameOverride || details.CustomerNameOverride || details.muhtelifName || details.MuhtelifName
                const muhtelifCode = details.muhtelifCustomerCode || details.MuhtelifCustomerCode
                const extra = [muhtelifCode, nameOverride].filter(Boolean).join(' - ')
                if (extra) {
                  return `${code} (${extra})`
                }
                return code
              })()}
            </span>
          </div>
          {details.grandTotal !== undefined || details.GrandTotal !== undefined ? (
            <div>
              <span className="text-gray-400 font-medium block text-[10px] uppercase tracking-wider mb-0.5">Genel Toplam</span>
              <span className="text-emerald-600 font-bold text-sm">
                {Number(details.grandTotal ?? details.GrandTotal ?? 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL
              </span>
            </div>
          ) : null}
        </div>

        {/* Detailed Impact Analysis Component */}
        {renderImpactAnalysis(row, details, lines, cashTransactions, bankTransactions, customerLedgerEntries, supplierLedgerEntries)}

        {/* Product / Line Details */}
        {lines.length > 0 ? (
          <div>
            <h4 className="text-xs font-bold text-gray-900 mb-2 flex items-center gap-1.5">
              <span>📦</span> Kalem / Ürün Detayları ({lines.length})
            </h4>
            <div className="border border-gray-100 rounded-xl overflow-hidden shadow-sm">
              <table className="min-w-full divide-y divide-gray-100 text-xs">
                <thead className="bg-gray-50 text-gray-500 font-semibold">
                  <tr>
                    <th className="px-3 py-2 text-left">Stok Kodu</th>
                    <th className="px-3 py-2 text-left">Açıklama</th>
                    <th className="px-3 py-2 text-right">Miktar</th>
                    <th className="px-3 py-2 text-right">Birim Fiyat</th>
                    <th className="px-3 py-2 text-right">KDV</th>
                    <th className="px-3 py-2 text-right">Net Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white text-gray-700">
                  {lines.map((line: any, idx: number) => {
                    const stockCode = line.stockCode || line.StockCode || '-'
                    const desc = line.description || line.Description || '-'
                    const qty = Number(line.quantity ?? line.Quantity ?? 0)
                    const price = Number(line.unitPrice ?? line.UnitPrice ?? 0)
                    const vat = Number(line.vatRate ?? line.VatRate ?? 0)
                    const discVal = Number(line.discountAmount ?? line.DiscountAmount ?? 0)
                    const lineTotal = (qty * price) - discVal

                    return (
                      <tr key={idx} className="hover:bg-gray-50/50">
                        <td className="px-3 py-2 font-mono font-bold text-gray-900">{stockCode}</td>
                        <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate" title={desc}>{desc}</td>
                        <td className="px-3 py-2 text-right font-semibold">{qty.toLocaleString('tr-TR')}</td>
                        <td className="px-3 py-2 text-right">{price.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                        <td className="px-3 py-2 text-right">%{vat}</td>
                        <td className="px-3 py-2 text-right font-bold text-gray-900">{lineTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* Single Product (Consignment/Irsaliye) */}
        {details.productId && (details.quantity !== undefined || details.Quantity !== undefined) ? (
          <div>
            <h4 className="text-xs font-bold text-gray-900 mb-2 flex items-center gap-1.5">
              <span>📦</span> Ürün Detayı (Konsinye)
            </h4>
            <div className="border border-gray-100 rounded-xl bg-white p-3 space-y-2 text-xs shadow-sm">
              <div className="flex justify-between border-b border-gray-50 pb-1.5">
                <span className="text-gray-500">Miktar:</span>
                <span className="font-bold text-gray-900">{(details.quantity ?? details.Quantity).toLocaleString('tr-TR')} Adet</span>
              </div>
              {details.shippedQuantity !== undefined || details.ShippedQuantity !== undefined ? (
                <div className="flex justify-between border-b border-gray-50 pb-1.5">
                  <span className="text-gray-500">Sevk Edilen Miktar:</span>
                  <span className="font-bold text-blue-600">{(details.shippedQuantity ?? details.ShippedQuantity).toLocaleString('tr-TR')} Adet</span>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-gray-500">Durum:</span>
                <span className="font-bold text-gray-900">
                  {details.status === 0 || details.Status === 0 ? 'Beklemede' :
                   details.status === 1 || details.Status === 1 ? 'Onaylandı' :
                   details.status === 2 || details.Status === 2 ? 'Sevk Edildi (Stok Düşüldü)' : 'Bilinmiyor'}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {/* Cash / Bank Financial Transactions */}
        {cashTransactions.length > 0 || bankTransactions.length > 0 ? (
          <div>
            <h4 className="text-xs font-bold text-gray-900 mb-2 flex items-center gap-1.5">
              <span>💵</span> Kasa / Banka Ödeme Hareketleri ({cashTransactions.length + bankTransactions.length})
            </h4>
            <div className="border border-gray-100 rounded-xl overflow-hidden shadow-sm">
              <table className="min-w-full divide-y divide-gray-100 text-xs">
                <thead className="bg-gray-50 text-gray-500 font-semibold">
                  <tr>
                    <th className="px-3 py-2 text-left">Tür</th>
                    <th className="px-3 py-2 text-left">Hesap / Kasa Kodu</th>
                    <th className="px-3 py-2 text-left">Açıklama</th>
                    <th className="px-3 py-2 text-right">Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white text-gray-700">
                  {cashTransactions.map((tx: any, idx: number) => {
                    const code = tx.cashAccountCode || tx.CashAccountCode || '-'
                    const desc = tx.description || tx.Description || '-'
                    const amount = Number(tx.amount ?? tx.Amount ?? 0)
                    return (
                      <tr key={`cash-${idx}`} className="hover:bg-gray-50/50">
                        <td className="px-3 py-2 text-orange-600 font-bold">💵 Kasa</td>
                        <td className="px-3 py-2 font-mono font-semibold">{code}</td>
                        <td className="px-3 py-2 text-gray-500 truncate max-w-[200px]" title={desc}>{desc}</td>
                        <td className="px-3 py-2 text-right font-bold text-orange-600">{(tx.direction === 1 ? -amount : amount).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    )
                  })}
                  {bankTransactions.map((tx: any, idx: number) => {
                    const code = tx.bankAccountCode || tx.BankAccountCode || '-'
                    const desc = tx.description || tx.Description || '-'
                    const amount = Number(tx.amount ?? tx.Amount ?? 0)
                    return (
                      <tr key={`bank-${idx}`} className="hover:bg-gray-50/50">
                        <td className="px-3 py-2 text-blue-600 font-bold">🏦 Banka</td>
                        <td className="px-3 py-2 font-mono font-semibold">{code}</td>
                        <td className="px-3 py-2 text-gray-500 truncate max-w-[200px]" title={desc}>{desc}</td>
                        <td className="px-3 py-2 text-right font-bold text-blue-600">{(tx.direction === 1 ? -amount : amount).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* Ledger Entries (Cari / Satıcı) */}
        {customerLedgerEntries.length > 0 || supplierLedgerEntries.length > 0 ? (
          <div>
            <h4 className="text-xs font-bold text-gray-900 mb-2 flex items-center gap-1.5">
              <span>👥</span> Cari / Tedarikçi Ekstre Hareketleri ({customerLedgerEntries.length + supplierLedgerEntries.length})
            </h4>
            <div className="border border-gray-100 rounded-xl overflow-hidden shadow-sm">
              <table className="min-w-full divide-y divide-gray-100 text-xs">
                <thead className="bg-gray-50 text-gray-500 font-semibold">
                  <tr>
                    <th className="px-3 py-2 text-left">Tür</th>
                    <th className="px-3 py-2 text-left">Cari Kod</th>
                    <th className="px-3 py-2 text-left">Açıklama</th>
                    <th className="px-3 py-2 text-right">Borç / Alacak</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white text-gray-700">
                  {customerLedgerEntries.map((cle: any, idx: number) => {
                    const rawCode = cle.customerCode || cle.CustomerCode || '-'
                    const primaryCustomerCode = details.customerCode || details.CustomerCode || details.supplierCode || details.SupplierCode
                    const code = (primaryCustomerCode && primaryCustomerCode !== 'MUHTELIF' && primaryCustomerCode !== '-') ? primaryCustomerCode : rawCode
                    const desc = cle.description || cle.Description || '-'
                    const amount = Number(cle.amount ?? cle.Amount ?? 0)
                    const direction = cle.direction ?? cle.Direction
                    return (
                      <tr key={`cle-${idx}`} className="hover:bg-gray-50/50">
                        <td className="px-3 py-2 text-teal-600 font-bold">Müşteri</td>
                        <td className="px-3 py-2 font-mono">{code}</td>
                        <td className="px-3 py-2 text-gray-500 truncate max-w-[200px]" title={desc}>{desc}</td>
                        <td className={`px-3 py-2 text-right font-bold ${direction === 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {direction === 0 ? `+${amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} (Borç)` : `-${amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} (Alacak)`}
                        </td>
                      </tr>
                    )
                  })}
                  {supplierLedgerEntries.map((sle: any, idx: number) => {
                    const rawCode = sle.supplierCode || sle.SupplierCode || '-'
                    const primarySupplierCode = details.supplierCode || details.SupplierCode
                    const code = (primarySupplierCode && primarySupplierCode !== '-') ? primarySupplierCode : rawCode
                    const desc = sle.description || sle.Description || '-'
                    const amount = Number(sle.amount ?? sle.Amount ?? 0)
                    const direction = sle.direction ?? sle.Direction
                    return (
                      <tr key={`sle-${idx}`} className="hover:bg-gray-50/50">
                        <td className="px-3 py-2 text-indigo-600 font-bold">Tedarikçi</td>
                        <td className="px-3 py-2 font-mono">{code}</td>
                        <td className="px-3 py-2 text-gray-500 truncate max-w-[200px]" title={desc}>{desc}</td>
                        <td className={`px-3 py-2 text-right font-bold ${direction === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {direction === 0 ? `-${amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} (Ödeme/Alacak)` : `+${amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} (Borç)`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    )
  } catch (e) {
    console.error('Failed to parse detailsJson:', e)
    return null
  }
}

export default function DeletionLogsPage() {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)

  const [availablePages, setAvailablePages] = useState<string[]>([])
  const [selectedPageKey, setSelectedPageKey] = useState<string | null>(null)

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [pageSize, total])

  const readErrorText = async (res: Response) => {
    const text = await res.text().catch(() => '')
    const trimmed = String(text ?? '').trim()
    if (!trimmed) return `İşlem başarısız (${res.status})`
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const j = JSON.parse(trimmed)
        const msg = j?.message || j?.error || j?.title
        if (typeof msg === 'string' && msg.trim()) return msg.trim()
      } catch {
      }
    }
    return trimmed
  }

  const loadFacets = async () => {
    try {
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const url = `${API_BASE_URL}/api/deletionlogs/facets`
      const res = await fetch(url, { headers })
      if (res.ok) {
        const json = await res.json()
        const keys = (json?.data?.pageKeys ?? []) as string[]
        const filtered = keys.filter((k) => k && k.trim())
        filtered.sort((a, b) => {
          const la = getPageLabel(a)
          const lb = getPageLabel(b)
          return la.localeCompare(lb, 'tr-TR')
        })
        setAvailablePages(filtered)
      }
    } catch (e) {
      console.error('Failed to load facets:', e)
    }
  }

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const qs = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        q: String(query ?? '')
      })
      if (selectedPageKey) {
        qs.append('pageKey', selectedPageKey)
      }

      const url = `${API_BASE_URL}/api/deletionlogs?${qs.toString()}`
      const res = await fetch(url, { headers })
      if (!res.ok) {
        const t = await readErrorText(res)
        setError(t || 'Silinen kayıtlar alınamadı')
        setRows([])
        setTotal(0)
        return
      }

      const json = await res.json()
      const data = json?.data ?? {}
      const items = (data?.items ?? []) as any[]

      setRows(
        items.map((x) => ({
          id: Number(x?.id ?? 0),
          deletedAt: String(x?.deletedAt ?? '').slice(0, 10),
          deletedAtFull: String(x?.deletedAt ?? ''),
          deletedBy: String(x?.deletedBy ?? ''),
          moduleKey: getModuleLabel(String(x?.moduleKey ?? '')),
          pageKey: getPageLabel(String(x?.pageKey ?? '')),
          recordType: getRecordTypeLabel(String(x?.recordType ?? '')),
          recordId: String(x?.recordId ?? ''),
          parentType: x?.parentType ? getRecordTypeLabel(String(x.parentType)) : null,
          parentId: x?.parentId ?? null,
          description: x?.description ?? null,
          detailsJson: x?.detailsJson ?? null,
          reason: x?.reason ?? null
        }))
      )
      setTotal(Number(data?.total ?? 0))
    } catch {
      setError('Silinen kayıtlar alınamadı')
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadFacets()
  }, [])

  useEffect(() => {
    void load()
  }, [page, query, selectedPageKey])

  const [restoreConfirmRow, setRestoreConfirmRow] = useState<Row | null>(null)
  const [detailRow, setDetailRow] = useState<Row | null>(null)
  const [msgModalOpen, setMsgModalOpen] = useState(false)
  const [msgModalTitle, setMsgModalTitle] = useState('')
  const [msgModalText, setMsgModalText] = useState('')

  const showMessage = (title: string, text: string) => {
    setMsgModalTitle(title)
    setMsgModalText(text)
    setMsgModalOpen(true)
  }

  const handleRestore = (row: Row) => {
    setRestoreConfirmRow(row)
  }

  const executeRestore = async (row: Row) => {
    try {
      setLoading(true)
      setError(null)
      const token = localStorage.getItem('accessToken')
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      }
      if (token) headers.Authorization = `Bearer ${token}`

      const url = `${API_BASE_URL}/api/deletionlogs/restore/${row.id}`
      const res = await fetch(url, {
        method: 'POST',
        headers
      })

      if (!res.ok) {
        const t = await readErrorText(res)
        showMessage('Hata', t || 'Geri yükleme işlemi başarısız oldu.')
        return
      }

      showMessage('Başarılı', 'Kayıt başarıyla geri yüklendi.')
      void load()
    } catch (e: any) {
      console.error(e)
      showMessage('Hata', 'Geri yükleme işlemi sırasında bir hata oluştu.')
    } finally {
      setLoading(false)
    }
  }

  const filteredRows = useMemo(() => rows, [rows])

  const columns = useMemo<TableColumn<Row>[]>(
    () => [
      {
        key: 'deletedAt',
        label: 'Silinme Tarihi',
        searchable: true,
        filter: { type: 'date' },
        render: (_v, row) => formatDateTime(row.deletedAtFull)
      },
      { key: 'deletedBy', label: 'Silen', searchable: true },
      {
        key: 'reason' as any,
        label: 'Silme Nedeni',
        searchable: true,
        render: (v) => {
          const str = String(v ?? '').trim()
          return str
            ? (
              <span className="truncate max-w-[260px] block font-semibold text-rose-700" title={str}>
                {str}
              </span>
            )
            : <span className="text-gray-300">—</span>
        }
      },
      { key: 'moduleKey', label: 'Modül', searchable: true },
      { key: 'pageKey', label: 'Sayfa', searchable: true },
      { key: 'recordType', label: 'Tip', searchable: true },
      { key: 'recordId', label: 'Kayıt ID', searchable: true },
      { key: 'parentType', label: 'Üst Tip', searchable: true, render: (v) => String(v ?? '') },
      { key: 'parentId', label: 'Üst ID', searchable: true, render: (v) => String(v ?? '') },
      {
        key: 'description',
        label: 'Açıklama',
        searchable: true,
        render: (v) => {
          const str = String(v ?? '')
          return (
            <span className="truncate max-w-[400px] block" title={str}>
              {str}
            </span>
          )
        }
      },
      {
        key: 'actions' as any,
        label: 'İşlemler',
        render: (_v, row) => (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDetailRow(row)}
              className="px-2.5 py-1 text-xs font-semibold text-blue-600 hover:text-white hover:bg-blue-600 rounded-lg border border-blue-100 hover:border-blue-600 transition-all duration-200 shadow-sm"
            >
              Detay
            </button>
          </div>
        )
      }
    ],
    [rows]
  )

  return (
    <div className="p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Silinen Kayıtlar</h1>
            <p className="text-xs text-gray-400 mt-0.5">Yönetim / Silme Geçmişi</p>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => {
                setSelectedPageKey(null)
                setPage(1)
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                selectedPageKey === null
                  ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm shadow-emerald-600/10'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
              }`}
            >
              Tümü
            </button>
            {availablePages.map((pk) => {
              const label = getPageLabel(pk)
              const isActive = selectedPageKey === pk
              return (
                <button
                  key={pk}
                  type="button"
                  onClick={() => {
                    setSelectedPageKey(isActive ? null : pk)
                    setPage(1)
                  }}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                    isActive
                      ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm shadow-emerald-600/10'
                      : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
            placeholder="Arama (kullanıcı, tip, id, sayfa...)"
            className="w-80 h-[34px] pl-8 pr-3 text-xs border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition"
          />
        </div>
      </div>

      {error && <div className="mb-3 text-xs font-semibold text-red-600">{error}</div>}

      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-visible relative">
        {loading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="h-3 bg-gray-100 rounded animate-pulse w-24" />
                <div className="h-3 bg-gray-100 rounded animate-pulse flex-1" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-16" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-20" />
                <div className="h-3 bg-gray-100 rounded animate-pulse w-16" />
              </div>
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <div className="text-gray-300 text-2xl mb-1">🗑️</div>
            <div className="text-xs text-gray-400 font-medium">Kayıt bulunamadı.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[1200px]">
              <Table
          onRefresh={() => void load()} columns={columns} data={filteredRows} showColumnFilters globalSearch={query} />
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs text-gray-500">
          Toplam: <span className="font-bold text-gray-700">{total}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className={
              'h-[32px] px-3 text-xs font-semibold rounded-lg border transition ' +
              (page <= 1 ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
            }
          >
            Önceki
          </button>

          <div className="text-xs text-gray-700">
            Sayfa <span className="font-bold">{page}</span> / <span className="font-bold">{totalPages}</span>
          </div>

          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className={
              'h-[32px] px-3 text-xs font-semibold rounded-lg border transition ' +
              (page >= totalPages
                ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50')
            }
          >
            Sonraki
          </button>
        </div>
      </div>



      {detailRow !== null && (
        <Modal
          isOpen={detailRow !== null}
          onClose={() => setDetailRow(null)}
          title="Silinen Kayıt Detayı ve Etki Notu"
          containerClassName="!max-w-4xl"
          footer={
            <button
              type="button"
              className="h-[34px] px-4 text-xs font-semibold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition"
              onClick={() => setDetailRow(null)}
            >
              Kapat
            </button>
          }
        >
          <div className="text-xs text-gray-700 space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {/* Silme nedeni — silen kişinin yazdığı */}
            <div className="bg-rose-50 border border-rose-100 p-3.5 rounded-xl text-rose-900 leading-relaxed">
              <span className="font-bold">Silme Nedeni: </span>
              {detailRow.reason?.trim()
                ? <span className="font-semibold whitespace-pre-wrap">{detailRow.reason}</span>
                : <span className="text-rose-400">Belirtilmemiş (neden sorulmadan önce silinmiş kayıt)</span>}
              <span className="block mt-1 text-[11px] text-rose-500">{detailRow.deletedBy} · {formatDateTime(detailRow.deletedAtFull)}</span>
            </div>

            {/* System Impact Note */}
            <div className="bg-amber-50 border border-amber-100 p-3.5 rounded-xl text-amber-900 leading-relaxed font-semibold">
              ⚠️ Sistem Etkisi: {detailRow.description || 'Bu kayıt için bir etki açıklaması bulunmuyor.'}
            </div>

            {/* Detailed Breakdown */}
            {renderDetails(detailRow)}
          </div>
        </Modal>
      )}

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
    </div>
  )
}
