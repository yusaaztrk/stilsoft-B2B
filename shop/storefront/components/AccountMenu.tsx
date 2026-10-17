'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import type { SessionMember } from '@/lib/session'

/**
 * Üst bardaki "Hesabım / Giriş Yap" düğmesi.
 *
 * Bilerek istemciden çekiyor (`/api/account/me`): oturum bilgisi kişiye özel olduğu için
 * sunucuda okunması KÖK layout'u (her sayfanın render ağacının bir parçası) `cookies()`
 * tüketen bir bileşene bağlar ve bu, Next.js'te sitedeki HER sayfayı statik/ISR üretimden
 * çıkarıp tam dinamik render'a zorlar (2026-09-05 denetiminde bulundu). Hidrasyondan hemen
 * sonra dolan bir "Giriş Yap" görünümü, her ürün/kategori sayfasının veritabanına yeniden
 * sorgu atmasından çok daha ucuz.
 */
export default function AccountMenu() {
  const [member, setMember] = useState<SessionMember | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/account/me')
      .then((res) => (res.ok ? res.json() : { member: null }))
      .then((data) => {
        if (!cancelled) setMember(data?.member ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Link
      className="action-tool-btn"
      href={member ? '/hesabim' : '/giris'}
      title={member ? member.fullName : 'Giriş Yap / Üye Ol'}
    >
      <div className="tool-icon-circle">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
      <div className="tool-text-col">
        <span className="tool-sub">{member ? 'Hoş Geldiniz' : 'Giriş Yap'}</span>
        <strong className="tool-main">{member ? member.fullName.split(' ')[0] : 'Hesabım'}</strong>
      </div>
    </Link>
  )
}
