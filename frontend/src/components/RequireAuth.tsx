import React, { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { consumeHandover, readHandover } from '../auth/handover'

type Props = {
  children: React.ReactNode
}

/**
 * Servisten (ServiceOps) devredilen oturumu tüketen kapı.
 *
 * Devrin nasıl okunduğu, hangi anahtarların yazıldığı ve neden açık bir oturum varken bile
 * takas yapıldığı `auth/handover.ts` içinde tek yerde anlatılıyor — buradaki iş yalnızca
 * "takas bitene kadar ne gösterelim" kararı.
 */
export default function RequireAuth({ children }: Props) {
  const location = useLocation()

  // Senkron okunuyor, efekt içinde değil: devir kararını bir efekte bırakmak giriş ekranının
  // bir kare boyunca görünmesine ve zaten oturumu olan kullanıcının /login'e atılmasına yol açar.
  const [handover] = useState(() => readHandover())

  // AÇIK OTURUM DEVRİ ARTIK ENGELLEMİYOR.
  //
  // Eski koşul `Boolean(handover) && !localStorage.getItem('accessToken')` idi: tarayıcıda
  // bayat bir token duruyorsa devir hiç çalışmıyordu. Süresi dolmuş token'la devam eden
  // kullanıcı ilk istekte 401 alıp giriş ekranına düşüyor ("her seferinde şifre istiyor"),
  // başkasının token'ı duruyorsa da onun oturumunda buluyordu kendini.
  const [exchanging, setExchanging] = useState(() => Boolean(readHandover()))
  const [exchangeFailed, setExchangeFailed] = useState(false)

  useEffect(() => {
    if (!exchanging || !handover) return

    const controller = new AbortController()

    void (async () => {
      try {
        const ok = await consumeHandover(handover, controller.signal)
        if (!ok) setExchangeFailed(true)
      } catch {
        if (controller.signal.aborted) return
        setExchangeFailed(true)
      } finally {
        setExchanging(false)
      }
    })()

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Devir sürerken giriş ekranı da korunan sayfa da yanlış cevap: oturum birazdan hazır olacak.
  if (exchanging && !exchangeFailed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-sm font-medium text-slate-500">Oturum aktarılıyor…</div>
      </div>
    )
  }

  const authed = Boolean(localStorage.getItem('accessToken'))

  if (!authed) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}
