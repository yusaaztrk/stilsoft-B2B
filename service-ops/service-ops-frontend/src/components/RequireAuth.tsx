import { Navigate, Outlet } from 'react-router-dom'
import { clearSession, isSessionValid } from '../auth/storage'

export default function RequireAuth() {
  // Captured before anything is written back to history. The clean-up below used to run
  // before the session was validated, so when validation then failed there was nothing left
  // in the URL to hand on — the handover was destroyed by the very step meant to tidy it.
  const originalSearch = window.location.search

  // DEVİR ÖLÇÜTÜ: TOKEN + FİRMA. `sync_username` BİLEREK ARANMIYOR.
  //
  // Eskiden üçü birden zorunluydu. Kullanıcı adı bayide `localStorage.userName`den okunuyor ve
  // bazı giriş yolları o anahtarı hiç yazmıyor (WhatsApp doğrulamalı giriş, devirle gelen
  // oturum, yanıtta ad dönmeyen hesaplar). Boş kaldığı her durumda devir "yok" sayılıp
  // giriş formu açılıyordu — kullanıcının "her seferinde şifre istiyor" şikâyeti.
  // Kimliği zaten TOKEN taşıyor; kullanıcı adı yalnızca gösterim içindir.
  const params = new URLSearchParams(originalSearch)
  const syncToken = (params.get('sync_token') ?? '').trim()
  const syncTenant = (params.get('sync_tenant') ?? '').trim()
  const carriesHandover = Boolean(syncToken && syncTenant)

  // A handover is never stored as a session here. The B2B token is signed with a different
  // key than this API expects, so keeping it would authenticate nothing — /login exchanges it
  // for a token this API issued, and that is the only session this app ever holds.
  if (carriesHandover) {
    return <Navigate to={`/login${originalSearch}`} replace />
  }

  if (!isSessionValid()) {
    clearSession()

    // Hand the parameters on rather than dropping them: /login knows how to consume a
    // handover, and a user who is signed in on B2B should never be shown a login form.
    return <Navigate to={carriesHandover ? `/login${originalSearch}` : '/login'} replace />
  }

  return <Outlet />
}
