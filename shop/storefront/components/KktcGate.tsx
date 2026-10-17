'use client'

import { useEffect, useState, type ReactNode } from 'react'
import LocationVerifier from './LocationVerifier'

const COOKIE = 'kktc_ok'
const MAX_AGE = 60 * 60 * 24 * 30

function hasCookie() {
  if (typeof document === 'undefined') return false
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${COOKIE}=1`))
}

function setCookie() {
  document.cookie = `${COOKIE}=1; max-age=${MAX_AGE}; path=/; samesite=lax`
}

/*
  KKTC KAPISI — YERİ DEĞİŞTİ (2026-09-20 kullanıcı kararı).

  Konum doğrulaması KALIYOR: Türkiye'deki Stilsoft müşterisi yanlışlıkla buradan sipariş verip
  para iadesiyle uğraşmasınlar. Ama eskiden ödeme sayfasında "Ödemeyi tamamla" düğmesini
  kilitliyordu; müşteri tam parayı verecekken tarayıcının konum izni sorusunu görüyordu.

  Şimdi: doğrulama sepet sayfasında BİR KEZ sorulur, 30 gün çerezde tutulur; ödeme sayfası
  çerez varsa hiç sormaz, yoksa (sepeti atlayıp gelen) burada sorar ve formu ancak o zaman
  açar (`enforce`). Konum KKTC ise müşteri hiçbir şey görmez: sessizce geçer.
*/
export default function KktcGate({ children, enforce = false }: { children: ReactNode; enforce?: boolean }) {
  const [ok, setOk] = useState<boolean | null>(null)

  useEffect(() => {
    setOk(hasCookie())
  }, [])

  if (ok === null) return enforce ? null : <>{children}</>
  if (ok) return <>{children}</>

  return (
    <>
      <div className="kktc-gate-card">
        <LocationVerifier
          onStatusChange={(valid) => {
            if (valid) {
              setCookie()
              setOk(true)
            }
          }}
        />
      </div>
      {!enforce && children}
    </>
  )
}
