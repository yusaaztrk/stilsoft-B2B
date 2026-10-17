import React from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileSpreadsheet, RefreshCw } from 'lucide-react'
import type { DataTablePaginationConfig } from './types'

/**
 * "Sınırsız" sayfa boyutu — tek sayfada hepsi.
 *
 * Değer SUNUCUNUN ÜST SINIRIYLA AYNI olmak zorunda (`InvoicesController.GetInvoiceList`
 * içindeki `Math.Clamp(pageSize, 1, 5000)`). Ayrışırsa istemci "tek sayfa" sanar, sunucu
 * kırpılmış bir sayfa döndürür ve kalan kayıtlara ulaşmanın yolu kalmaz.
 *
 * 0 ya da -1 kullanılmadı: sayfa boyutu her yerde `number` ve `total / 0` sonsuz üretirdi.
 */
export const UNLIMITED_PAGE_SIZE = 5000

export function DataTablePagination({
  pageIndex,
  pageSize,
  totalCount,
  pageCount: customPageCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 25, 50, 100],
  onExportExcel,
  onRefresh,
  refreshing = false,
  settingsSlot
}: DataTablePaginationConfig) {
  // Sayfa sayısı HER ZAMAN aynı formülle çıkar; "Sınırsız" için ayrı bir dal yok. Ayrı dal
  // olsaydı sunucu kırpması durumunda "1 sayfa" yalanı söylenirdi.
  const calculatedPageCount = customPageCount ?? Math.ceil((totalCount || 0) / (pageSize || 1))
  const pageCount = Math.max(1, calculatedPageCount)
  const isFirstPage = pageIndex <= 0
  const isLastPage = pageIndex >= pageCount - 1

  const startRecord = totalCount > 0 ? pageIndex * pageSize + 1 : 0
  const endRecord = totalCount > 0 ? Math.min((pageIndex + 1) * pageSize, totalCount) : 0

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 text-xs text-slate-600 bg-white rounded-b-xl">
      <div className="flex items-center gap-3">
        {onExportExcel && (
          <button
            type="button"
            onClick={onExportExcel}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors cursor-pointer mr-1"
            title="Excel'e Aktar"
          >
            <FileSpreadsheet size={15} className="text-emerald-600" />
            <span>Excel</span>
          </button>
        )}

        {/* Tablo ayarlari (sutun gizle/sirala/genislik) — Excel'in hemen yaninda. */}
        {settingsSlot}

        {/*
          YENILE — suzgecleri KORUYARAK veriyi tazeler (2026-08-24, kullanici istegi).
          Sayfayi tarayicidan yenilemek suzgecleri de sifirliyordu.
        */}
        {onRefresh && (
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200 transition-colors cursor-pointer mr-1 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Verileri yenile (süzgeçler korunur)"
          >
            <RefreshCw size={15} className={'text-slate-500' + (refreshing ? ' animate-spin' : '')} />
            <span>{refreshing ? 'Yenileniyor...' : 'Yenile'}</span>
          </button>
        )}

        <span className="font-medium">
          {totalCount > 0 ? (
            <>
              <strong className="text-slate-900">{totalCount.toLocaleString('tr-TR')}</strong> kayıttan{' '}
              <strong className="text-slate-900">{startRecord.toLocaleString('tr-TR')}</strong>–
              <strong className="text-slate-900">{endRecord.toLocaleString('tr-TR')}</strong> arası gösteriliyor
            </>
          ) : (
            'Gösterilecek kayıt yok'
          )}
        </span>

        <div className="flex items-center gap-1.5 ml-2 border-l border-slate-200 pl-3">
          <span className="text-slate-500 text-[11px]">Sayfa başına:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              const newSize = Number(e.target.value)
              onPageSizeChange(newSize)
              onPageChange(0) // Reset to first page
            }}
            className="h-8 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2 text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
            <option value={UNLIMITED_PAGE_SIZE}>Sınırsız</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(0)}
          disabled={isFirstPage}
          aria-label="İlk sayfaya git"
          title="İlk Sayfa"
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
        >
          <ChevronsLeft size={16} />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(pageIndex - 1)}
          disabled={isFirstPage}
          aria-label="Önceki sayfaya git"
          title="Önceki Sayfa"
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
        >
          <ChevronLeft size={16} />
        </button>

        <span className="px-3 py-1 font-semibold text-slate-800">
          Sayfa {pageIndex + 1} / {pageCount}
        </span>

        <button
          type="button"
          onClick={() => onPageChange(pageIndex + 1)}
          disabled={isLastPage}
          aria-label="Sonraki sayfaya git"
          title="Sonraki Sayfa"
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
        >
          <ChevronRight size={16} />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(pageCount - 1)}
          disabled={isLastPage}
          aria-label="Son sayfaya git"
          title="Son Sayfa"
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
        >
          <ChevronsRight size={16} />
        </button>
      </div>
    </div>
  )
}
