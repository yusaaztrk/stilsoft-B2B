'use client'

import { useState } from 'react'

/**
 * Çıkış yap.
 *
 * TAM SAYFA YENİLEME ŞART — `router.push` / `router.refresh` YETMİYOR.
 *
 * Üst bardaki isim (`AccountMenu`) ve sepet rakamı (`HeaderCartButton` → `CartProvider`)
 * kök layout'ta duran İSTEMCİ bileşenleri ve ikisi de veriyi bir kez, mount anında çekiyor.
 * Yumuşak gezinmede (router.push) bu bileşenler yeniden mount EDİLMEZ: oturum sunucuda
 * gerçekten kapansa bile başlıkta müşterinin adı ve eski sepet tutarı ekranda kalıyordu —
 * kullanıcı çıktığını sanmıyor, çıkamadığını sanıyordu (canlıda görüldü: çıkış sonrası
 * "Hoş Geldiniz yuşa" ve 6.299,99 ₺ sepet, oysa /hesabim giriş ekranına atıyordu).
 *
 * `location.assign` istemci router önbelleğini de, bu bileşenlerin durumunu da sıfırlar.
 * Giriş yolu (`AuthForm`) zaten aynı sebeple tam yenileme yapıyor; çıkış yolu ondan geri
 * kalmıştı.
 */
export default function LogoutButton() {
  const [busy, setBusy] = useState(false)

  return (
    <button
      className="btn btn-line btn-sm"
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
        window.location.assign('/')
      }}
    >
      {busy ? 'Çıkılıyor…' : 'Çıkış yap'}
    </button>
  )
}
