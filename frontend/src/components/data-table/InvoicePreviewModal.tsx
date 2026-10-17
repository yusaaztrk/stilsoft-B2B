import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Building2,
  Calendar,
  CreditCard,
  FileText,
  Package,
  Receipt,
  User,
  X
} from 'lucide-react'
import type { InvoiceListItem } from '../../lib/invoices'
import { formatCurrency } from '../../utils/formatters'
import { fetchInvoiceLines, type InvoiceLineDto } from '../../api/invoices'

type Props = {
  item: InvoiceListItem | null
  onClose: () => void
}

export function InvoicePreviewModal({ item, onClose }: Props) {
  const [lines, setLines] = useState<InvoiceLineDto[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!item) {
      setLines([])
      return
    }

    const safeId = Number(item.id)
    if (!Number.isFinite(safeId) || safeId <= 0) {
      setLines([])
      return
    }

    let isMounted = true
    setLoading(true)
    setError(null)

    fetchInvoiceLines(safeId)
      .then((data) => {
        if (isMounted) setLines(data || [])
      })
      .catch((err: any) => {
        if (isMounted) {
          console.error('Invoice lines fetch error:', err)
          setError(err?.message || 'Kalemler yüklenemedi')
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [item])

  if (!item) return null

  const faturaAcikVal = String(item.faturaAcik ?? '').toUpperCase()
  const customerCode = String((item as any).customerCode ?? (item as any).cariKodu ?? '').trim()
  const isAskeriye = faturaAcikVal === 'MUAF' || faturaAcikVal === 'ASKERIYE' || faturaAcikVal === 'ASKERİYE' || customerCode.endsWith('-3') || Boolean((item as any).isVatExempt)
  const isFatura = faturaAcikVal === 'FATURA' || faturaAcikVal === 'FATURALI'
  const isPaid = Boolean(item.odemeAlindi)

  return createPortal(
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-5 bg-slate-900/70 backdrop-blur-sm animate-fadeIn">
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl overflow-hidden flex flex-col max-h-[92vh] font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Corporate Stilsoft Red Header Banner */}
        <div className="bg-[#C81E1E] text-white p-4 sm:p-5 flex items-center justify-between relative overflow-hidden shrink-0 shadow-md">
          <div className="absolute -right-8 -bottom-8 opacity-10 text-white pointer-events-none">
            <FileText size={160} />
          </div>

          <div className="flex items-center gap-3.5 z-10">
            <div className="w-11 h-11 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center text-white shrink-0 shadow-inner">
              <FileText size={22} />
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold tracking-tight font-mono text-white">
                  {item.faturaNo || 'FATURA ÖNİZLEME'}
                </h2>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider ${
                    item.islemTipi === 'SATIŞ'
                      ? 'bg-white/20 text-white border border-white/30'
                      : item.islemTipi === 'ALIŞ'
                        ? 'bg-amber-400 text-slate-900 font-black'
                        : 'bg-slate-900 text-white'
                  }`}
                >
                  {item.islemTipi || 'SATIŞ'}
                </span>
              </div>

              <div className="flex items-center gap-3 text-xs text-red-100 mt-1">
                <span className="flex items-center gap-1 font-medium">
                  <Calendar size={13} className="text-white/80" /> {item.tarih}
                </span>
                <span>•</span>
                <span className="font-semibold text-white truncate max-w-[280px]" title={item.cariAdi}>
                  {item.cariAdi}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/25 text-white flex items-center justify-center transition-colors cursor-pointer z-10"
            title="Kapat"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Scrollable Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 bg-slate-50/60 flex-1">
          {/* Card Grid 1: Cari & Durum Bilgileri */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Cari Details Card */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                <Building2 size={15} className="text-[#C81E1E]" /> Cari ve İrtibat Bilgileri
              </div>

              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-slate-400 block text-[11px]">Cari Ünvanı / Adı:</span>
                  <span className="font-bold text-slate-900 text-sm break-words">{item.cariAdi || '-'}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Plasiyer:</span>
                    <span className="font-semibold text-slate-700">{item.plasiyer || '-'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">İşlem Yapan:</span>
                    <span className="font-semibold text-slate-700">{item.islemYapan || '-'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Payment & Invoice Status Card */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2">
                <CreditCard size={15} className="text-emerald-600" /> Fatura ve Ödeme Durumu
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-slate-400 block text-[11px] mb-1">Fatura Tipi</span>
                  <span
                    className={`inline-flex px-2 py-0.5 rounded text-[11px] font-bold ${
                      isAskeriye
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        : isFatura
                          ? 'bg-blue-100 text-blue-800 border border-blue-200'
                          : 'bg-amber-100 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {isAskeriye ? 'MUAF' : (item.faturaAcik || 'ACIK')}
                  </span>
                </div>

                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <span className="text-slate-400 block text-[11px] mb-1">Ödeme Durumu</span>
                  <span
                    className={`inline-flex px-2 py-0.5 rounded text-[11px] font-bold ${
                      isPaid
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        : 'bg-rose-100 text-rose-800 border border-rose-200'
                    }`}
                  >
                    {isPaid ? 'Ödendi' : 'Ödenmedi'}
                  </span>
                </div>

                {item.odemeHedefi && (
                  <div className="col-span-2 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <span className="text-slate-400 block text-[11px]">Ödeme Hedefi / Hesap</span>
                    <span className="font-semibold text-slate-800">{item.odemeHedefi}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Financial Summary Card */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider">
                <Receipt size={15} className="text-[#C81E1E]" /> Finansal Tutar Özeti
              </div>
            </div>

            {(() => {
              const curId = Number(item.paraBirimiTipi ?? 0)
              const rate = Number(item.kur ?? 1) || 1
              // TL tutarlar da para birimi etiketiyle yazılır (dövizli satırlarla aynı biçim).
              const code = curId === 2 ? 'EUR' : curId === 3 ? 'USD' : curId === 4 ? 'GBP' : 'TL'
              const formatModalAmount = (v: number) => {
                return `${code} ${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              }

              return (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <span className="text-slate-500 block text-[11px]">Brüt Tutar</span>
                      <span className="font-semibold text-slate-800 text-sm">{formatModalAmount(item.brutTutar)}</span>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <span className="text-slate-500 block text-[11px]">İskonto</span>
                      <span className="font-semibold text-amber-700 text-sm">{formatModalAmount(item.iskonto)}</span>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <span className="text-slate-500 block text-[11px]">Net Tutar</span>
                      <span className="font-semibold text-sky-800 text-sm">{formatModalAmount(item.netTutar)}</span>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                      <span className="text-slate-500 block text-[11px]">KDV Tutarı</span>
                      <span className="font-semibold text-slate-800 text-sm">{formatModalAmount(isAskeriye ? 0 : item.kdvTutari)}</span>
                    </div>
                  </div>

                  {/* Prominent Genel Toplam */}
                  <div className="bg-red-50 border border-red-200 p-3.5 rounded-xl flex items-center justify-between mt-2">
                    <div>
                      <span className="text-xs font-extrabold text-[#C81E1E] uppercase tracking-wider block">GENEL TOPLAM</span>
                      <span className="text-[11px] text-slate-500">KDV Dahil Toplam Ödenecek/Tahsil Edilecek Tutar</span>
                    </div>

                    <div className="text-xl sm:text-2xl font-black text-[#C81E1E] font-mono">
                      {formatModalAmount(isAskeriye ? item.netTutar : item.genelToplam)}
                    </div>
                  </div>
                </>
              )
            })()}
          </div>

          {/* Line Items Table Section (Kalem Kalem Açıklamalar) */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider">
                <Package size={15} className="text-[#C81E1E]" /> Fatura Kalemleri & Detaylı Açıklamalar
              </div>
              <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                {loading ? 'Yükleniyor...' : `${lines.length} Kalem`}
              </span>
            </div>

            {loading ? (
              <div className="p-8 text-center text-xs text-slate-500 font-medium">Fatura kalemleri yükleniyor...</div>
            ) : error ? (
              <div className="p-4 text-xs text-rose-600 font-medium bg-rose-50 rounded-lg">{error}</div>
            ) : lines.length > 0 ? (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3 border-r border-slate-200 w-10 text-center">#</th>
                      <th className="py-2.5 px-3 border-r border-slate-200">Stok Kodu / Barkod</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 min-w-[240px]">Stok Adı & Açıklama</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 text-right">Miktar</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 text-right">Birim Fiyat</th>
                      <th className="py-2.5 px-3 border-r border-slate-200 text-right">KDV %</th>
                      <th className="py-2.5 px-3 text-right">Toplam</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-800">
                    {lines.map((line, idx) => {
                      const lCurId = Number(line.currencyTypeId ?? 0)
                      const lCode = lCurId === 2 ? 'EUR' : lCurId === 3 ? 'USD' : lCurId === 4 ? 'GBP' : ''
                      const lCurUnit = Number(line.currencyUnitPrice ?? 0)
                      const hasLineFx = Boolean(lCode && lCurUnit > 0)

                      const unitDisplay = hasLineFx
                        ? `${lCode} ${lCurUnit.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : formatCurrency(line.unitPrice, 'TL ')

                      const totalDisplay = hasLineFx
                        ? `${lCode} ${(line.quantity * lCurUnit).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : formatCurrency(line.total, 'TL ')

                      return (
                        <tr key={line.id || idx} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-3 border-r border-slate-200 text-center text-slate-400 font-mono text-[11px]">
                            {idx + 1}
                          </td>

                          <td className="py-3 px-3 border-r border-slate-200 font-mono text-[11px]">
                            <div className="font-semibold text-slate-900">{line.stockCode || '-'}</div>
                            {line.barcode && <div className="text-[10px] text-slate-500">Barkod: {line.barcode}</div>}
                          </td>

                          <td className="py-3 px-3 border-r border-slate-200 leading-relaxed">
                            <div className="font-bold text-slate-900 text-xs">{line.stockName || '-'}</div>
                            {line.description && (
                              <div className="text-[11px] text-slate-600 mt-1 bg-slate-50 p-2 rounded border border-slate-200/60 whitespace-pre-wrap">
                                {line.description}
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-3 border-r border-slate-200 text-right font-semibold text-slate-800">
                            {line.quantity}
                          </td>

                          <td className="py-3 px-3 border-r border-slate-200 text-right font-medium text-slate-700">
                            {unitDisplay}
                          </td>

                          <td className="py-3 px-3 border-r border-slate-200 text-right text-slate-600 font-medium">
                            %{line.vatRate}
                          </td>

                          <td className="py-3 px-3 text-right font-bold text-slate-900">
                            {totalDisplay}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                Bu faturaya ait detaylı kalem kaydı bulunmamaktadır.
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-white border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500 font-medium hidden sm:block">
            Fatura Detayı Önizleme Modu
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 text-xs font-bold bg-[#C81E1E] hover:bg-red-800 text-white rounded-xl transition-colors cursor-pointer shadow-sm"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
