import React from 'react'
import {
  FileText,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  Maximize2,
  Expand,
  Minimize,
  Printer,
  FileDown,
  X,
} from 'lucide-react'

interface ReportToolbarProps {
  currentPage: number
  totalPages: number
  zoomLevel: number
  fitMode: 'page' | 'width' | 'custom'
  isFullscreen: boolean
  serviceNo?: string
  /** Belge adı: 'HİZMET FİŞİ' ya da 'SERVİS ARIZA FORMU'. Başlık sabit yazılıydı ve montaj/
   *  beyaz eşya fişinde yanlış belge adını gösteriyordu. */
  documentTitle?: string
  onPageChange: (page: number) => void
  onZoomChange: (zoom: number) => void
  onFitModeChange: (mode: 'page' | 'width') => void
  onToggleFullscreen: () => void
  onPrint: () => void
  onDownloadPdf: () => void
  onClose: () => void
  forcePrintBeforeClose?: boolean
}

export default function ReportToolbar({
  currentPage,
  totalPages,
  zoomLevel,
  fitMode,
  isFullscreen,
  serviceNo,
  documentTitle,
  onPageChange,
  onZoomChange,
  onFitModeChange,
  onToggleFullscreen,
  onPrint,
  onDownloadPdf,
  onClose,
  forcePrintBeforeClose = false,
}: ReportToolbarProps) {
  const handlePageInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10)
    if (!isNaN(val) && val >= 1 && val <= totalPages) {
      onPageChange(val)
    }
  }

  return (
    <header className="no-print sticky top-0 z-30 flex items-center justify-between px-4 h-12 bg-white border-b border-gray-200 text-gray-800 shadow-xs select-none">
      {/* Left: Document Info */}
      <div className="flex items-center gap-2.5 shrink-0">
        <FileText className="w-4 h-4 text-gray-500" />
        <span className="font-bold text-xs text-gray-900 tracking-tight">{documentTitle || 'Servis Arıza Formu'}</span>
        {serviceNo && (
          <span className="px-2 py-0.5 text-[11px] font-mono font-bold bg-gray-100 border border-gray-200 text-gray-700 rounded">
            {serviceNo}
          </span>
        )}
      </div>

      {/* Middle: Controls (Pills) */}
      <div className="flex items-center gap-2 overflow-x-auto py-1 scrollbar-none">
        {/* Pagination Pill */}
        <div className="flex items-center bg-gray-50 border border-gray-200 rounded-md px-1 py-0.5 text-xs text-gray-700 shadow-2xs">
          <button
            type="button"
            title="İlk Sayfa"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(1)}
            className="p-1 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-30 rounded transition cursor-pointer"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Önceki Sayfa"
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
            className="p-1 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-30 rounded transition cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center px-1.5 text-xs font-mono font-medium text-gray-800 gap-1">
            <input
              type="number"
              min={1}
              max={totalPages}
              value={currentPage}
              onChange={handlePageInput}
              className="w-7 text-center bg-white border border-gray-300 rounded py-0.5 text-xs text-gray-900 focus:outline-none focus:border-emerald-600 font-mono shadow-2xs"
            />
            <span className="text-gray-500">/ {totalPages}</span>
          </div>

          <button
            type="button"
            title="Sonraki Sayfa"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
            className="p-1 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-30 rounded transition cursor-pointer"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Son Sayfa"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(totalPages)}
            className="p-1 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-30 rounded transition cursor-pointer"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Zoom Pill */}
        <div className="flex items-center bg-gray-50 border border-gray-200 rounded-md px-1 py-0.5 text-xs text-gray-700 shadow-2xs">
          <button
            type="button"
            title="Uzaklaştır"
            disabled={zoomLevel <= 40}
            onClick={() => onZoomChange(Math.max(40, zoomLevel - 15))}
            className="p-1 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-30 rounded transition cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <select
            value={fitMode === 'custom' ? zoomLevel : fitMode}
            onChange={(e) => {
              const val = e.target.value
              if (val === 'page' || val === 'width') {
                onFitModeChange(val)
              } else {
                onZoomChange(parseInt(val, 10))
              }
            }}
            className="bg-white border border-gray-300 text-xs font-mono font-medium text-gray-800 rounded px-1.5 py-0.5 focus:outline-none cursor-pointer shadow-2xs"
          >
            <option value="page">Sayfaya Sığdır</option>
            <option value="width">Genişliğe Sığdır</option>
            <option value="40">40%</option>
            <option value="50">50%</option>
            <option value="75">75%</option>
            <option value="100">100%</option>
            <option value="125">125%</option>
            <option value="150">150%</option>
            <option value="200">200%</option>
          </select>

          <button
            type="button"
            title="Yakınlaştır"
            disabled={zoomLevel >= 200}
            onClick={() => onZoomChange(Math.min(200, zoomLevel + 15))}
            className="p-1 hover:bg-gray-200 hover:text-gray-900 disabled:opacity-30 rounded transition cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Fit Buttons */}
        <div className="hidden lg:flex items-center gap-1">
          <button
            type="button"
            title="Sayfaya Sığdır"
            onClick={() => onFitModeChange('page')}
            className={`p-1.5 text-xs font-medium rounded border transition cursor-pointer flex items-center gap-1 ${
              fitMode === 'page'
                ? 'bg-gray-200 border-gray-400 text-gray-900'
                : 'border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            <Maximize className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="Genişliğe Sığdır"
            onClick={() => onFitModeChange('width')}
            className={`p-1.5 text-xs font-medium rounded border transition cursor-pointer flex items-center gap-1 ${
              fitMode === 'width'
                ? 'bg-gray-200 border-gray-400 text-gray-900'
                : 'border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onPrint}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded shadow-xs transition active:scale-95 cursor-pointer"
        >
          <Printer className="w-3.5 h-3.5" />
          <span>Yazdır</span>
        </button>

        <button
          type="button"
          onClick={onDownloadPdf}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold rounded border border-gray-300 shadow-xs transition active:scale-95 cursor-pointer"
        >
          <FileDown className="w-3.5 h-3.5" />
          <span>PDF İndir</span>
        </button>

        <button
          type="button"
          title={isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran'}
          onClick={onToggleFullscreen}
          className="p-1.5 hover:bg-gray-100 text-gray-500 hover:text-gray-900 rounded transition cursor-pointer hidden sm:flex"
        >
          {isFullscreen ? <Minimize className="w-4 h-4" /> : <Expand className="w-4 h-4" />}
        </button>

        {!forcePrintBeforeClose && (
          <button
            type="button"
            onClick={onClose}
            title="Kapat (ESC)"
            className="p-1.5 hover:bg-gray-100 text-gray-500 hover:text-gray-900 rounded transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  )
}
