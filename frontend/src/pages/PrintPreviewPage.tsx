import React, { useEffect, useState, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getCustomerOffer } from '../api/customerOffers'
import { getCariOffer } from '../api/cariOffers'
import { buildOfferHtml as buildCustomerOfferHtml } from './CustomerOfferPage'
import { buildOfferHtml as buildCariOfferHtml } from './CariOfferPage'
import { buildProformaHtml } from '../utils/proformaPrint'
import { fetchCustomerChecksVBordroPrintHtml } from '../api/customerChecks'
import { fetchWarehouseTransferDetail } from '../api/warehouseTransfers'
import { fetchWarehousesDropdown } from '../api/warehouses'
import { buildWarehouseTransferHtml } from '../utils/warehouseTransferPrint'
import { 
  Printer, 
  Download, 
  Search, 
  Maximize, 
  ZoomIn, 
  ZoomOut, 
  ChevronLeft, 
  ChevronRight, 
  X, 
  FileText,
  FileSpreadsheet
} from 'lucide-react'
import * as XLSX from 'xlsx'

export default function PrintPreviewPage() {
  const [searchParams] = useSearchParams()
  const type = searchParams.get('type') // 'customerOffer' | 'cariOffer' | 'proforma' | 'vBordro' | 'warehouseTransfer'
  const idStr = searchParams.get('id')
  // Çek verildi bordrosu sayısal id ile değil BORDRO NO ile açılır.
  const noParam = searchParams.get('no')
  const template = searchParams.get('template') || 'standard' // 'standard' | 'simple'
  const source = searchParams.get('source') || 'customer' // 'customer' | 'cari' for proforma
  const autoPrint = searchParams.get('print') === 'true'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [htmlContent, setHtmlContent] = useState<string>('')
  const [dto, setDto] = useState<any>(null)
  
  const [zoom, setZoom] = useState<number>(1.0)
  const [iframeHeight, setIframeHeight] = useState<number>(1120)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageCount, setPageCount] = useState<number>(1)
  const [exportOpen, setExportOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const exportDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function loadData() {
      const id = Number(idStr)
      const bordroNo = String(noParam ?? '').trim()
      // Bordro kimliğini NO taşır; diğer belgeler sayısal id ile gelir.
      const hasIdentity = type === 'vBordro' ? bordroNo.length > 0 : id > 0
      if (!type || !hasIdentity) {
        setError('Geçersiz parametreler.')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)

        let html = ''
        let data: any = null

        if (type === 'warehouseTransfer') {
          // Belgede depo KODU degil ADI yazsin diye dropdown da cekiliyor.
          const [detail, warehouses] = await Promise.all([
            fetchWarehouseTransferDetail(id),
            fetchWarehousesDropdown().catch(() => [])
          ])
          const warehouseLabelByCode: Record<string, string> = {}
          for (const w of (warehouses ?? []) as any[]) {
            const code = String(w?.warehouseCode ?? '').trim()
            if (!code) continue
            warehouseLabelByCode[code] = `${code} ${w?.name ?? ''}`.trim()
          }
          setDto(detail)
          html = buildWarehouseTransferHtml({ detail, warehouseLabelByCode })
        } else if (type === 'vBordro') {
          // Belge HTML'i sunucuda üretiliyor; burada sadece önizleyiciye veriliyor.
          html = await fetchCustomerChecksVBordroPrintHtml(bordroNo)
          setDto(null)
        } else if (type === 'customerOffer') {
          data = await getCustomerOffer(id)
          setDto(data)
          html = buildCustomerOfferHtml(data, template as any, true)
        } else if (type === 'cariOffer') {
          data = await getCariOffer(id)
          setDto(data)
          html = buildCariOfferHtml(data, template as any, true)
        } else if (type === 'proforma') {
          data = source === 'cari' ? await getCariOffer(id) : await getCustomerOffer(id)
          setDto(data)
          html = await buildProformaHtml(id, source as any, true)
        } else {
          throw new Error('Geçersiz önizleme tipi.')
        }

        setHtmlContent(html)
      } catch (err: any) {
        console.error('Önizleme yükleme hatası:', err)
        setError(err?.message || 'Önizleme verisi yüklenirken hata oluştu.')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [type, idStr, noParam, template, source])

  // Handle auto-print after load
  useEffect(() => {
    if (!loading && !error && htmlContent && autoPrint) {
      setTimeout(() => {
        handlePrint()
      }, 500)
    }
  }, [loading, error, htmlContent, autoPrint])

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) {
        setExportOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handlePrint = () => {
    const iframe = iframeRef.current
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
    }
  }

  const handleIframeLoad = () => {
    const iframe = iframeRef.current
    if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
      // Auto adjust height of iframe
      const body = iframe.contentDocument.body
      const html = iframe.contentDocument.documentElement
      const height = Math.max(
        body.scrollHeight,
        body.offsetHeight,
        html.clientHeight,
        html.scrollHeight,
        html.offsetHeight
      )
      const pages = Math.max(1, Math.ceil(height / 1120))
      setPageCount(pages)
      setIframeHeight(height + 40)
    }
  }

  const handleWorkspaceScroll = () => {
    const workspace = workspaceRef.current
    if (workspace) {
      const scrollTop = workspace.scrollTop
      const pageHeight = 1120 * zoom
      const activePage = Math.max(1, Math.min(pageCount, Math.floor((scrollTop + pageHeight / 2) / pageHeight) + 1))
      setCurrentPage(activePage)
    }
  }

  const handleNextPage = () => {
    if (currentPage < pageCount) {
      const targetPage = currentPage + 1
      setCurrentPage(targetPage)
      const workspace = workspaceRef.current
      if (workspace) {
        workspace.scrollTo({
          top: (targetPage - 1) * 1120 * zoom,
          behavior: 'smooth'
        })
      }
    }
  }

  const handlePrevPage = () => {
    if (currentPage > 1) {
      const targetPage = currentPage - 1
      setCurrentPage(targetPage)
      const workspace = workspaceRef.current
      if (workspace) {
        workspace.scrollTo({
          top: (targetPage - 1) * 1120 * zoom,
          behavior: 'smooth'
        })
      }
    }
  }

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 0.1, 2.0))
  }

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 0.1, 0.5))
  }

  const handleExportXlsx = () => {
    if (!dto) return

    const docNo = dto.proformaDocumentNo || dto.documentNo || '—'
    const dateParts = String(dto.date || '').split('T')[0].split('-')
    const dateStr = dateParts.length === 3 ? `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}` : '—'
    const teklifVeren = dto.salesmanName || dto.salesmanCode || dto.createUser || '—'
    const customerName = dto.customerName || dto.muhtelif?.name || '—'
    const customerAddress = dto.customerAddress || dto.muhtelif?.address || '—'
    const taxOfficeNo = `${dto.customerTaxOffice || dto.muhtelif?.taxOffice || ''} / ${dto.customerTaxNumber || dto.muhtelif?.taxNumber || ''}`
    const customerPhone = dto.customerPhone || dto.muhtelif?.phone || '—'
    const notes = dto.description || '—'

    // Calculate totals
    const subtotal = Number(dto.subtotal || 0)
    const discountTotal = Number(dto.discountTotal || 0)
    const vatTotal = Number(dto.vatTotal || 0)
    const grandTotal = Number(dto.grandTotal || 0)

    const lines = dto.lines || []

    const aoa: any[][] = [
      ['DEMO TİCARET LİMİTED', '', '', '', '', '', 'TARİH:', dateStr],
      ['Örnek Mah. Demo Cad. No:1', '', '', '', '', '', 'BELGE NO:', docNo],
      ['Lefkoşa - KKTC (V.D.: Demo V.N.: 0000000)', '', '', '', '', '', 'HAZIRLAYAN:', teklifVeren],
      [],
      ['MÜŞTERİ BİLGİLERİ'],
      ['Cari Ünvan:', customerName, '', '', '', '', 'V.D. / V.N.:', taxOfficeNo],
      ['Adres:', customerAddress, '', '', '', '', 'Telefon:', customerPhone],
      [],
      ['Sıra', 'Stok Kodu', 'Stok Açıklaması', 'KDV', 'Miktar', 'Birim Fiyat', 'İndirim', 'Toplam Tutar']
    ]

    lines.forEach((l: any, idx: number) => {
      const lineTotal = (l.quantity || 0) * (l.unitPrice || 0)
      const discountStr = l.discountType === 2 ? `%${l.discountValue}` : (l.discountType === 1 ? `${l.discountValue}` : '-')
      aoa.push([
        idx + 1,
        l.stockCode || '',
        l.stockName || l.description || '',
        `%${l.vatRate || 0}`,
        l.quantity || 0,
        l.unitPrice || 0,
        discountStr,
        lineTotal
      ])
    })

    aoa.push(
      [],
      ['', '', '', '', '', '', 'Ara Toplam:', subtotal],
      ['', '', '', '', '', '', 'İndirim:', discountTotal],
      ['', '', '', '', '', '', 'K.D.V. Toplamı:', vatTotal],
      ['', '', '', '', '', '', 'Genel Toplam:', grandTotal],
      [],
      ['AÇIKLAMA / NOTLAR:'],
      [notes]
    )

    const worksheet = XLSX.utils.aoa_to_sheet(aoa)
    
    // Set cell widths for readability
    worksheet['!cols'] = [
      { wch: 6 },  // Sıra
      { wch: 15 }, // Stok Kodu
      { wch: 40 }, // Stok Açıklaması
      { wch: 8 },  // KDV
      { wch: 8 },  // Miktar
      { wch: 12 }, // Birim Fiyat
      { wch: 10 }, // İndirim
      { wch: 15 }  // Toplam Tutar
    ]

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Belge Görünümü')
    
    XLSX.writeFile(workbook, `${docNo}_teklif.xlsx`)
    setExportOpen(false)
  }

  const handleExportWord = () => {
    if (!htmlContent) return
    
    // Wrap htmlContent with MS Word xmlns tags for Word A4 layout view compatibility
    let wordHtml = htmlContent
    wordHtml = wordHtml.replace('<html lang="tr">', '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40" lang="tr">')
    wordHtml = wordHtml.replace('<html>', '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">')

    const blob = new Blob(['\uFEFF' + wordHtml], { type: 'application/msword;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const docName = dto?.proformaDocumentNo || dto?.documentNo || 'belge'
    a.download = `${docName}.doc`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setExportOpen(false)
  }

  const handleExportHtml = () => {
    if (!htmlContent) return
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const docName = dto?.proformaDocumentNo || dto?.documentNo || 'belge'
    a.download = `${docName}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setExportOpen(false)
  }

  const handleSearchInIframe = (term: string) => {
    const iframe = iframeRef.current
    if (iframe && iframe.contentWindow) {
      // Simple text highlight or search in iframe window
      // @ts-ignore
      if (iframe.contentWindow.find) {
        // @ts-ignore
        iframe.contentWindow.find(term, false, false, true, false, true, false)
      }
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50 flex-col gap-3 font-sans">
        <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
        <div className="text-sm font-semibold text-slate-600">Önizleme Hazırlanıyor...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-50 flex-col p-4 font-sans text-center">
        <div className="w-12 h-12 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mb-4 border border-rose-100">
          <X size={24} />
        </div>
        <h3 className="text-base font-bold text-gray-900 mb-2">Hata Oluştu</h3>
        <p className="text-xs text-gray-500 max-w-md mb-6">{error}</p>
        <button 
          onClick={() => window.close()}
          className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-900 text-white transition"
        >
          Kapat
        </button>
      </div>
    )
  }

  const docNo = dto?.proformaDocumentNo || dto?.documentNo || (type === 'vBordro' ? String(noParam ?? '') : '') || 'Basım'
  // Excel çıktısı teklif/proforma alanlarından üretiliyor; bordroda o veri yok.
  const canExportXlsx = Boolean(dto)

  return (
    <div className="flex flex-col h-screen w-screen bg-[#e8e8e8] overflow-hidden font-sans select-none print:bg-white print:h-auto print:w-auto">
      <style>{`
        @page {
          margin: 0mm !important;
          size: auto;
        }
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            width: 100% !important;
            height: 100% !important;
          }
          .no-print, header, nav, .preview-toolbar {
            display: none !important;
          }
          .preview-workspace {
            padding: 0 !important;
            margin: 0 !important;
            overflow: visible !important;
            display: block !important;
            width: 100% !important;
            height: 100% !important;
          }
          .preview-sheet-container {
            border: none !important;
            box-shadow: none !important;
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            height: 100% !important;
            transform: none !important;
          }
          iframe {
            border: none !important;
            width: 100% !important;
            height: 100% !important;
            transform: none !important;
          }
        }
      `}</style>
      {/* Stimulsoft / FastReport Style Toolbar */}
      <div className="preview-toolbar flex items-center justify-between px-4 h-11 bg-[#f3f3f3] border-b border-[#d0d0d0] text-[#333] z-50">
        
        {/* Left Side: Page Controls */}
        <div className="flex items-center gap-1.5">
          <button 
            onClick={handlePrevPage}
            disabled={currentPage <= 1}
            className={`p-1 rounded text-slate-600 hover:bg-slate-200 transition ${currentPage <= 1 ? 'opacity-30 cursor-not-allowed' : ''}`}
            title="Önceki Sayfa"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="flex items-center text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded px-2 py-1 h-[26px]">
            Sayfa {currentPage} / {pageCount}
          </div>
          <button 
            onClick={handleNextPage}
            disabled={currentPage >= pageCount}
            className={`p-1 rounded text-slate-600 hover:bg-slate-200 transition ${currentPage >= pageCount ? 'opacity-30 cursor-not-allowed' : ''}`}
            title="Sonraki Sayfa"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Middle: Layout & Zoom Controls */}
        <div className="flex items-center gap-4">
          {/* Zoom Section */}
          <div className="flex items-center bg-white border border-slate-300 rounded h-[26px] overflow-hidden">
            <button 
              onClick={handleZoomOut}
              className="px-2 hover:bg-slate-100 border-r border-slate-200 text-slate-600 transition flex items-center justify-center h-full"
              title="Uzaklaştır"
            >
              <ZoomOut size={14} />
            </button>
            <span className="px-3 text-xs font-semibold text-slate-700 min-w-[55px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button 
              onClick={handleZoomIn}
              className="px-2 hover:bg-slate-100 border-l border-slate-200 text-slate-600 transition flex items-center justify-center h-full"
              title="Yakınlaştır"
            >
              <ZoomIn size={14} />
            </button>
          </div>

          {/* Width presets */}
          <div className="flex items-center gap-1">
            <button 
              onClick={() => setZoom(1.0)} 
              className={`px-2 py-1 text-xs font-semibold rounded h-[26px] border ${zoom === 1.0 ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-slate-300 hover:bg-slate-50 text-slate-700'}`}
            >
              Tam Sayfa
            </button>
            <button 
              onClick={() => setZoom(1.3)} 
              className={`px-2 py-1 text-xs font-semibold rounded h-[26px] border ${zoom === 1.3 ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-slate-300 hover:bg-slate-50 text-slate-700'}`}
            >
              Sayfa Genişliği
            </button>
          </div>
        </div>

        {/* Right Side: Actions (Print, Export, Search, Close) */}
        <div className="flex items-center gap-1.5">
          {/* Search bar inside toolbar */}
          {searchOpen && (
            <div className="flex items-center bg-white border border-slate-300 rounded px-1.5 py-0.5 h-[26px]">
              <input
                type="text"
                placeholder="Ara..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value)
                  handleSearchInIframe(e.target.value)
                }}
                className="w-28 text-xs outline-none border-none px-1 h-full"
              />
              <button 
                onClick={() => {
                  setSearchOpen(false)
                  setSearchTerm('')
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {!searchOpen && (
            <button 
              onClick={() => setSearchOpen(true)}
              className="p-1.5 hover:bg-slate-200 text-slate-600 rounded transition flex items-center justify-center h-[28px] w-[28px]"
              title="Belgede Ara"
            >
              <Search size={16} />
            </button>
          )}

          {/* Native Print Dialog Button */}
          <button 
            onClick={handlePrint}
            className="flex items-center gap-1 px-2.5 hover:bg-emerald-600 bg-emerald-700 text-white rounded text-xs font-semibold transition h-[28px]"
            title="Yazdır"
          >
            <Printer size={14} />
            <span>Yazdır</span>
          </button>

          {/* Export Dropdown */}
          <div className="relative" ref={exportDropdownRef}>
            <button 
              onClick={() => setExportOpen(p => !p)}
              className="flex items-center gap-1 px-2.5 hover:bg-slate-200 bg-white border border-slate-300 text-slate-700 rounded text-xs font-semibold transition h-[28px]"
              title="Farklı Kaydet / Dışa Aktar"
            >
              <Download size={14} />
              <span>Kaydet / İndir</span>
            </button>

            {exportOpen && (
              <div className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded shadow-lg z-50 py-1">
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 w-full text-left font-medium"
                >
                  <FileText size={14} className="text-red-500" />
                  PDF Olarak İndir
                </button>
                <button
                  onClick={handleExportXlsx}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 w-full text-left font-medium"
                >
                  <FileSpreadsheet size={14} className="text-emerald-600" />
                  Excel (Sayfa Görünümü)
                </button>
                <button
                  onClick={handleExportWord}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 w-full text-left font-medium"
                >
                  <FileText size={14} className="text-blue-600" />
                  Word (Sayfa Görünümü)
                </button>
                <button
                  onClick={handleExportHtml}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 w-full text-left font-medium"
                >
                  <FileText size={14} className="text-slate-500" />
                  HTML Olarak İndir
                </button>
              </div>
            )}
          </div>

          <div className="w-[1px] h-4 bg-slate-300 mx-1"></div>

          {/* Close button */}
          <button 
            onClick={() => window.close()}
            className="p-1.5 hover:bg-slate-200 text-slate-600 rounded transition flex items-center justify-center h-[28px] w-[28px]"
            title="Kapat"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Workspace Area */}
      <div 
        ref={workspaceRef}
        onScroll={handleWorkspaceScroll}
        className="preview-workspace flex-1 overflow-auto p-8 flex justify-center items-start"
      >
        {/* Dynamic Zoom Sheet Container */}
        <div 
          style={{
            width: `${820 * zoom}px`,
            height: `${iframeHeight * zoom}px`,
            overflow: 'hidden',
            transition: 'all 0.15s ease-out'
          }}
          className="preview-sheet-container bg-white border border-slate-300 shadow-xl rounded-[2px]"
        >
          <iframe
            ref={iframeRef}
            srcDoc={htmlContent}
            onLoad={handleIframeLoad}
            style={{
              width: '820px',
              height: `${iframeHeight}px`,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
              border: 'none',
              overflow: 'hidden'
            }}
            title={`Önizleme - ${docNo}`}
          />
        </div>
      </div>
    </div>
  )
}
