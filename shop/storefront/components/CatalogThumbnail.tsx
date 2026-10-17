'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Katalog kartındaki önizleme — PDF'in ilk sayfasını gerçek bir görsel gibi gösterir
 * (2026-09-13 kullanıcı isteği: "direk ilk sayfa png gibi gelmeliydi"). Sunucu tarafında PDF
 * render eden bir bağımlılık eklemek yerine (.NET'te native pdfium gibi ağır bir paket ister)
 * ilk sayfa TARAYICIDA `pdfjs-dist` ile küçük bir <canvas>'a çiziliyor — bayi PDF yüklerken
 * ekstra bir kapak görseli hazırlamak zorunda kalmıyor.
 *
 * Worker dosyası CDN'den değil `public/pdfjs/pdf.worker.min.mjs`'den kendi sunucumuzdan
 * servis ediliyor (üçüncü taraf kesintisine bağımlı kalmasın).
 */
export default function CatalogThumbnail({ pdfUrl, title }: { pdfUrl: string; title: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs'

        const doc = await pdfjs.getDocument(pdfUrl).promise
        if (cancelled) return

        const page = await doc.getPage(1)
        if (cancelled) return

        const baseViewport = page.getViewport({ scale: 1 })
        // Kart genişliği sabit; kaliteli görünmesi için 2x çözünürlükte çiziyoruz.
        const targetWidth = 480
        const scale = targetWidth / baseViewport.width
        const viewport = page.getViewport({ scale })

        const canvas = canvasRef.current
        if (!canvas) return
        const context = canvas.getContext('2d')
        if (!context) return

        canvas.width = viewport.width
        canvas.height = viewport.height

        await page.render({ canvasContext: context, viewport }).promise
        if (!cancelled) setStatus('ready')
      } catch {
        // PDF çözümlenemezse (bozuk dosya, ağ hatası) ikon rozetine düşülür — sayfa çökmesin.
        if (!cancelled) setStatus('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [pdfUrl])

  return (
    <span className="catalog-card-thumb" role="img" aria-label={title}>
      <canvas ref={canvasRef} className={status === 'ready' ? 'catalog-card-canvas' : 'catalog-card-canvas is-hidden'} />
      {status !== 'ready' && (
        <span className="catalog-card-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
        </span>
      )}
    </span>
  )
}
