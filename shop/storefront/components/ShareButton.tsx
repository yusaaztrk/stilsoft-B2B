'use client'

import { useState } from 'react'

export default function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false)

  const handleShare = async () => {
    if (typeof window === 'undefined') return

    if (navigator.share) {
      try {
        await navigator.share({
          title,
          url: window.location.href,
        })
        return
      } catch {
        // Fallback to copy link
      }
    }

    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // ignore
    }
  }

  const handleWhatsApp = () => {
    if (typeof window === 'undefined') return
    const text = encodeURIComponent(`${title} — ${window.location.href}`)
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank')
  }

  return (
    <div className="pdp-share-group">
      <button
        type="button"
        className="btn-pdp-share"
        onClick={handleShare}
        aria-label="Ürün bağlantısını paylaş"
        title="Bağlantıyı Kopyala"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
        <span>{copied ? 'Bağlantı Kopyalandı!' : 'Paylaş'}</span>
      </button>

      <button
        type="button"
        className="btn-pdp-share wa"
        onClick={handleWhatsApp}
        aria-label="WhatsApp'ta Paylaş"
        title="WhatsApp'ta Paylaş"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
        <span>WhatsApp</span>
      </button>
    </div>
  )
}
