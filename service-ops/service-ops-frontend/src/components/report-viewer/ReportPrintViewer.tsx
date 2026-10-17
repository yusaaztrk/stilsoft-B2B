import React, { useState, useEffect, useCallback, useRef } from 'react'
import ReportToolbar from './ReportToolbar'
import ReportPage from './ReportPage'
import ReportLoadingState from './ReportLoadingState'
import ReportErrorState from './ReportErrorState'

interface ReportPrintViewerProps {
  isOpen: boolean
  onClose: () => void
  record: any | null
  isLoading?: boolean
  error?: string | null
  onRetry?: () => void
  forcePrintBeforeClose?: boolean
}

export default function ReportPrintViewer({
  isOpen,
  onClose,
  record,
  isLoading = false,
  error = null,
  onRetry,
  forcePrintBeforeClose = false,
}: ReportPrintViewerProps) {
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [zoomLevel, setZoomLevel] = useState<number>(100)
  const [fitMode, setFitMode] = useState<'page' | 'width' | 'custom'>('page')
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false)
  const containerRef = useRef<HTMLDivElement>(null)

  /*
   * Nüsha sayısı BELGE TÜRÜNE bağlı.
   *
   * Küçük ürün formu (SERVİS ARIZA FORMU) iki nüsha basılır: biri serviste kalır, biri
   * müşteriye verilir. Montaj ve beyaz eşya HİZMET FİŞİ ise TEK sayfadır — örnek belgelerin
   * hepsi öyle. Burada sabit 2 yazdığı için hizmet fişi de ikinci kez basılıyor, yani her
   * baskıda gereksiz bir kopya çıkıyordu.
   */
  const isSmallProductForm =
    String((record as any)?.category ?? (record as any)?.productCategory ?? '').toLowerCase() === 'small'
  const totalPages = isSmallProductForm ? 2 : 1

  // Reset page & fit mode when opened
  useEffect(() => {
    if (isOpen) {
      setCurrentPage(1)
      setFitMode('page')
      setZoomLevel(100)
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // Keybindings: ESC, Arrows, Zoom
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!forcePrintBeforeClose) {
          onClose()
        }
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        setCurrentPage((prev) => Math.max(1, prev - 1))
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        setCurrentPage((prev) => Math.min(totalPages, prev + 1))
      } else if (e.key === 'Home') {
        setCurrentPage(1)
      } else if (e.key === 'End') {
        setCurrentPage(totalPages)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, totalPages, onClose, forcePrintBeforeClose])

  // Ctrl + Mouse Wheel Zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault()
      const delta = e.deltaY < 0 ? 10 : -10
      setZoomLevel((prev) => Math.min(200, Math.max(40, prev + delta)))
      setFitMode('custom')
    }
  }, [])

  // Toggle Fullscreen
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen?.()
      setIsFullscreen(false)
    }
  }

  // Print Action
  const handlePrint = () => {
    window.print()
    if (forcePrintBeforeClose) {
      setTimeout(() => {
        onClose()
      }, 1500)
    }
  }

  // Download PDF Action
  const handleDownloadPdf = () => {
    const serviceNo = record?.serviceNumber || record?.id || '000000'
    const fileName = `Servis-Ariza-Formu-${serviceNo}.pdf`
    
    // Set document title temporarily so browser PDF save defaults to exact filename
    const originalTitle = document.title
    document.title = fileName.replace('.pdf', '')
    window.print()
    setTimeout(() => {
      document.title = originalTitle
      if (forcePrintBeforeClose) {
        onClose()
      }
    }, 1500)
  }

  if (!isOpen) return null

  const serviceNo = record?.serviceNumber || record?.id || ''

  // Effective scale style calculation
  const getScaleStyle = () => {
    if (fitMode === 'page') {
      return { transform: 'scale(0.85)', transformOrigin: 'top center' }
    }
    if (fitMode === 'width') {
      return { transform: 'scale(1)', transformOrigin: 'top center', width: '100%' }
    }
    return { transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top center' }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/90 backdrop-blur-md overflow-hidden animate-fadeIn"
      onWheel={handleWheel}
    >
      {/* Media Print Global Override Styles */}
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-report-document, #printable-report-document * {
            visibility: visible !important;
          }
          #printable-report-document {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            border: none !important;
            background: white !important;
          }
          .report-page-printable {
            page-break-after: always !important;
            break-after: page !important;
            margin: 0 !important;
            padding: 8mm !important;
            width: 100% !important;
            box-shadow: none !important;
            border: none !important;
          }
          .no-print {
            display: none !important;
          }
          @page {
            size: A4 portrait;
            margin: 5mm;
          }
        }
      `}</style>

      {/* Top Toolbar */}
      <ReportToolbar
        currentPage={currentPage}
        totalPages={totalPages}
        zoomLevel={zoomLevel}
        fitMode={fitMode}
        isFullscreen={isFullscreen}
        serviceNo={serviceNo}
        onPageChange={(p) => {
          setCurrentPage(p)
          // Scroll page into view
          const el = document.getElementById(`report-page-${p}`)
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }}
        onZoomChange={(z) => {
          setZoomLevel(z)
          setFitMode('custom')
        }}
        onFitModeChange={(mode) => setFitMode(mode)}
        onToggleFullscreen={toggleFullscreen}
        onPrint={handlePrint}
        onDownloadPdf={handleDownloadPdf}
        onClose={onClose}
        forcePrintBeforeClose={forcePrintBeforeClose}
      />

      {/* Main Document Preview Viewport */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-auto p-4 sm:p-8 flex flex-col items-center bg-zinc-900/90 scrollbar-thin select-none"
      >
        {isLoading ? (
          <ReportLoadingState />
        ) : error ? (
          <ReportErrorState message={error} onRetry={onRetry} />
        ) : !record ? (
          <ReportErrorState message="Gösterilecek servis kaydı verisi bulunamadı." onRetry={onRetry} />
        ) : (
          <div
            id="printable-report-document"
            className="flex flex-col items-center gap-8 my-auto transition-transform duration-200 ease-out"
            style={getScaleStyle()}
          >
            {/* Display pages based on selection or show both vertically stacked */}
            <div
              id="report-page-1"
              className={`report-page-printable transition-opacity duration-300 ${
                currentPage === 1 ? 'opacity-100 ring-2 ring-emerald-500/50' : 'opacity-90 hover:opacity-100'
              }`}
              onClick={() => setCurrentPage(1)}
            >
              <ReportPage record={record} pageIndex={1} totalPages={totalPages} />
            </div>

            {totalPages > 1 && (
              <div
                id="report-page-2"
                className={`report-page-printable transition-opacity duration-300 ${
                  currentPage === 2 ? 'opacity-100 ring-2 ring-emerald-500/50' : 'opacity-90 hover:opacity-100'
                }`}
                onClick={() => setCurrentPage(2)}
              >
                <ReportPage record={record} pageIndex={2} totalPages={totalPages} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Quick Page Bar */}
      <div className="no-print bg-white border-t border-gray-200 h-8 px-4 text-center text-[11px] text-gray-600 flex items-center justify-between select-none shadow-2xs">
        <span className="text-gray-400 font-mono">A4 Düzeneği (210 × 297 mm)</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setCurrentPage(1)
              document.getElementById('report-page-1')?.scrollIntoView({ behavior: 'smooth' })
            }}
            className={`hover:text-gray-900 cursor-pointer px-2 py-0.5 rounded transition ${
              currentPage === 1 ? 'bg-gray-200 text-gray-900 font-semibold' : 'text-gray-500'
            }`}
          >
            {totalPages > 1 ? 'Sayfa 1 (Servis Nüshası)' : 'Sayfa 1'}
          </button>
          {/* Tek sayfalık hizmet fişinde ikinci nüsha yok; düğmesi de gösterilmez. */}
          {totalPages > 1 && (
            <>
              <span className="text-gray-300">|</span>
              <button
                onClick={() => {
                  setCurrentPage(2)
                  document.getElementById('report-page-2')?.scrollIntoView({ behavior: 'smooth' })
                }}
                className={`hover:text-gray-900 cursor-pointer px-2 py-0.5 rounded transition ${
                  currentPage === 2 ? 'bg-gray-200 text-gray-900 font-semibold' : 'text-gray-500'
                }`}
              >
                Sayfa 2 (Müşteri Nüshası)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
