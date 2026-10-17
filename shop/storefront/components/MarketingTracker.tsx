'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { captureAttribution, trackContact } from '@/lib/track'

/*
  REKLAM ÖLÇÜMÜ — SİTE GENELİ (2026-10-15). Ekrana hiçbir şey basmaz.

  1) Reklamdan gelen ziyaretçinin kaynağını (gclid / fbclid / utm) saklar — bkz. lib/track.ts.
  2) Sitedeki BÜTÜN `tel:` ve WhatsApp bağlantılarına yapılan tıklamayı ölçer.

  NEDEN TEK DİNLEYİCİ: "Ara" düğmesi sunucu bileşeni (CallButton), sonuç sayfasındaki telefon,
  kurumsal satış danışmanı, altbilgi… bu bağlantılar onlarca yere dağılmış. Her birine
  onClick eklemek bir gün birinin unutulması demekti; belgeye tek bir yakalama dinleyicisi
  hepsini kapsıyor. Yüzen WhatsApp balonu bağlantı değil `window.open` kullandığı için kendi
  içinde ölçülüyor (WhatsAppWidget).
*/
export default function MarketingTracker() {
  const pathname = usePathname()

  useEffect(() => {
    captureAttribution()
  }, [pathname])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!el) return
      const href = el.getAttribute('href') ?? ''
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim()
      if (href.startsWith('tel:')) {
        trackContact('telefon', { label })
      } else if (/^https?:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//i.test(href)) {
        trackContact('whatsapp', { label })
      }
    }
    document.addEventListener('click', onClick, { capture: true })
    return () => document.removeEventListener('click', onClick, { capture: true })
  }, [])

  return null
}
