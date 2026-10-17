import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SessionExpiryPopup from './SessionExpiryPopup'
import { extendSession, fetchSessionState } from '../api/session'
import { clearSession, getAccessToken } from '../auth/storage'

/** Ortak oturum kaydına ne sıklıkla bakılacağı. Diğer taraftaki çıkış en geç bu kadar sürede görülür. */
const POLL_MS = 20_000

function decodeTokenExpiryMs(): number | null {
  try {
    const token = getAccessToken()
    if (!token) return null
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    const exp = Number(payload?.exp)
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null
  } catch {
    return null
  }
}

function formatHm(msUtc: number) {
  const d = new Date(msUtc)
  return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Bayi ile ORTAK oturumun servis tarafındaki bekçisi.
 *
 * Üç işi var:
 *   1. Geri sayımı ortak bitişe göre yürütür; bitişe `alertBeforeMinutes` kala uyarı ekranını
 *      açar (aynı ekran bayide de var).
 *   2. Ortak kaydı periyodik olarak sorar: oturum diğer taraftan kapatıldıysa ya da orada
 *      uzatıldıysa burası da anında ona uyar.
 *   3. Süre dolduğunda / oturum kapatıldığında kullanıcıyı giriş ekranına düşürür.
 *
 * Kabuğun içinde durur, yani teknisyenin telefonundaki görünüm de dahil oturum açmış her ekranda
 * çalışır. Teknisyenler bayi programına hiç girmez; süreyi yine oradaki ayardan alırlar.
 */
export default function SharedSessionGuard() {
  const navigate = useNavigate()

  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(() => decodeTokenExpiryMs())
  const [alertBeforeMinutes, setAlertBeforeMinutes] = useState(3)
  const [remainingMinutes, setRemainingMinutes] = useState<number | null>(null)
  const [popupOpen, setPopupOpen] = useState(false)
  const [extending, setExtending] = useState(false)

  // Uyarı, aynı bitiş için bir kez açılır: kullanıcı "Kapat" derse her saniye geri gelmez.
  const shownForExpiry = useRef<number | null>(null)
  const droppingOut = useRef(false)

  const dropToLogin = useCallback(() => {
    if (droppingOut.current) return
    droppingOut.current = true
    clearSession()
    navigate('/login', { replace: true })
  }, [navigate])

  const sync = useCallback(async (signal?: AbortSignal) => {
    try {
      const state = await fetchSessionState(signal)
      if (!state) return

      if (!state.valid) {
        dropToLogin()
        return
      }

      if (state.alertBeforeMinutes >= 0) setAlertBeforeMinutes(state.alertBeforeMinutes)

      if (state.expiresAtUtc) {
        const ms = new Date(state.expiresAtUtc).getTime()
        if (Number.isFinite(ms)) {
          setExpiresAtMs((prev) => {
            // Diğer taraftan uzatıldıysa uyarı yeni bitiş için tekrar gösterilebilmeli.
            if (prev !== ms) {
              shownForExpiry.current = null
              setPopupOpen(false)
            }
            return ms
          })
        }
      }
    } catch {
      // Ağ hatası oturumun bittiği anlamına gelmez; bir sonraki yoklamada tekrar denenir.
    }
  }, [dropToLogin])

  // İlk yoklama + periyodik yoklama. Sekme öne geldiğinde de sorulur: uyuyan bir sekme,
  // kullanıcı ona döndüğünde çoktan kapatılmış bir oturumu göstermeye devam etmemeli.
  useEffect(() => {
    const controller = new AbortController()
    void sync(controller.signal)

    const timer = window.setInterval(() => void sync(), POLL_MS)
    const onFocus = () => void sync()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void sync()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [sync])

  // Geri sayım yerelde işler: her saniye sunucuya sormak gerekmiyor, bitiş anı zaten biliniyor.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!expiresAtMs) {
        setRemainingMinutes(null)
        return
      }

      const remaining = (expiresAtMs - Date.now()) / 60000
      setRemainingMinutes(remaining)

      if (remaining <= 0) {
        dropToLogin()
        return
      }

      if (alertBeforeMinutes > 0 && remaining <= alertBeforeMinutes && shownForExpiry.current !== expiresAtMs) {
        shownForExpiry.current = expiresAtMs
        setPopupOpen(true)
      }
    }, 1000)

    return () => window.clearInterval(timer)
  }, [expiresAtMs, alertBeforeMinutes, dropToLogin])

  const onExtend = async () => {
    if (extending) return
    setExtending(true)
    try {
      const state = await extendSession()
      if (state && !state.valid) {
        dropToLogin()
        return
      }

      if (state?.expiresAtUtc) {
        const ms = new Date(state.expiresAtUtc).getTime()
        if (Number.isFinite(ms)) {
          shownForExpiry.current = null
          setExpiresAtMs(ms)
        }
      } else {
        // Sunucu bitişi bildirmediyse token'dan okunur.
        const ms = decodeTokenExpiryMs()
        if (ms) {
          shownForExpiry.current = null
          setExpiresAtMs(ms)
        }
      }

      setPopupOpen(false)
    } finally {
      setExtending(false)
    }
  }

  return (
    <SessionExpiryPopup
      isOpen={popupOpen}
      remainingMinutes={remainingMinutes ?? 0}
      expiresAtLabel={expiresAtMs ? formatHm(expiresAtMs) : '-'}
      extending={extending}
      onExtend={() => void onExtend()}
      onClose={() => setPopupOpen(false)}
    />
  )
}
