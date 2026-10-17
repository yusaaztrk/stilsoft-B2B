import React from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileSpreadsheet } from 'lucide-react'
import type { DataTablePaginationConfig } from './types'

/**
 * "Sinirsiz" secimi (2026-08-25, kullanici istegi: "tum sayfa listelemelerinde altta bir de
 * sinirsiz diye bir sey koy, hepsini getirsin").
 *
 * Ayri bir bayrak yerine COK BUYUK BIR SAYFA BOYUTU kullaniliyor. Sebep: sayfa boyutu
 * `pageSize` olarak asagi (TanStack) ve yukari (sunucu tarafli tablolarda sorgu) tek bir sayi
 * olarak akiyor. -1 gibi bir nobet degeri sokmak, sayfa sayisi/ilk-son kayit hesaplarinin
 * ve `Take(pageSize)` cagrilarinin hepsini ozel duruma sokardi. Buyuk sayi hepsinde
 * kendiliginden dogru sonuc verir: sayfa sayisi 1, "1-N gosteriliyor", Take(hepsi).
 *
 * Deger `Number.MAX_SAFE_INTEGER` DEGIL: sunucu tarafli tablolarda bu sayi sorgu dizesine
 * yaziliyor ve C# tarafinda `int` olarak okunuyor; int'e sigmayan deger istegi 400'e dusururdu.
 */
export const SINIRSIZ_SAYFA_BOYUTU = 1_000_000

export function DataTablePagination({
  pageIndex,
  pageSize,
  totalCount,
  pageCount: customPageCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 25, 50, 100, SINIRSIZ_SAYFA_BOYUTU],
  onExportExcel,
  settingsSlot
}: DataTablePaginationConfig) {
  const calculatedPageCount = customPageCount ?? Math.ceil((totalCount || 0) / (pageSize || 1))
  const pageCount = Math.max(1, calculatedPageCount)
  const isFirstPage = pageIndex <= 0
  const isLastPage = pageIndex >= pageCount - 1

  const startRecord = totalCount > 0 ? pageIndex * pageSize + 1 : 0
  const endRecord = totalCount > 0 ? Math.min((pageIndex + 1) * pageSize, totalCount) : 0

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-3 py-3 sm:px-4 border-t border-slate-100 text-xs text-slate-600 bg-white rounded-b-xl">
      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 sm:gap-3 w-full sm:w-auto text-center sm:text-left">
        {onExportExcel && (
          <button
            type="button"
            onClick={onExportExcel}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 transition-colors cursor-pointer"
            title="Excel'e Aktar"
          >
            <FileSpreadsheet size={15} className="text-emerald-600" />
            <span>Excel</span>
          </button>
        )}

        {/* Tablo ayarlari (sutun gizle/sirala/genislik) — Excel'in hemen yaninda. */}
        {settingsSlot}

        <span className="font-medium text-[11px] sm:text-xs">
          {totalCount > 0 ? (
            <>
              <strong className="text-slate-900">{totalCount.toLocaleString('tr-TR')}</strong> kayıttan{' '}
              <strong className="text-slate-900">{startRecord.toLocaleString('tr-TR')}</strong>–
              <strong className="text-slate-900">{endRecord.toLocaleString('tr-TR')}</strong> gösteriliyor
            </>
          ) : (
            'Gösterilecek kayıt yok'
          )}
        </span>

        <div className="flex items-center gap-1.5 sm:border-l sm:border-slate-200 sm:pl-3">
          <span className="text-slate-500 text-[11px]">Sayfa:</span>
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
                {size >= SINIRSIZ_SAYFA_BOYUTU ? 'Sınırsız' : size}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-center gap-1 w-full sm:w-auto mt-1 sm:mt-0">
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

        <span className="px-2 sm:px-3 py-1 font-semibold text-slate-800 text-[11px] sm:text-xs whitespace-nowrap">
          {pageIndex + 1} / {pageCount}
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
