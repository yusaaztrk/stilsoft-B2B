import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../api/client'
import { getAccessToken, isSuperAdminSession } from './storage'
import { canOpenRoute, hasKey, HISTORY_PAGE_KEY, type PageKey } from './pagePermissions'

/**
 * One permission fetch for the whole app.
 *
 * Every page that cared about permissions used to call /api/auth/permissions itself — the shell
 * plus a handful of pages, so a single navigation could issue the same request four or five
 * times and each copy could answer differently while the others were still in flight. The
 * answer depends only on the session, so it is fetched once here and read from context.
 */

type PermissionsState = {
  /** Page keys granted to this session, as returned by the API. */
  allowedPageKeys: string[]
  /** Row-level scopes per page root, e.g. whether a user sees only their own records. */
  pageScopes: Record<string, unknown>
  isSuperAdmin: boolean
  /** False until the first fetch settles. Gate rendering on this, never assume "allowed". */
  loaded: boolean
  /** True when the fetch failed; the app stays usable but nothing extra is granted. */
  failed: boolean
  can: (key: PageKey | null) => boolean
  canOpen: (pathname: string) => boolean
  reload: () => void
}

const PermissionsContext = createContext<PermissionsState | null>(null)

/**
 * Local fallback only, for the window before the server's answer arrives. The server is the
 * authority (see the note on the endpoint): reading this from the token misses an SSA whose
 * role claim is an array, and that user would then be held to a partial key list.
 */
const readIsSuperAdminLocally = isSuperAdminSession

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const [allowedPageKeys, setAllowedPageKeys] = useState<string[]>([])
  const [pageScopes, setPageScopes] = useState<Record<string, unknown>>({})
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [isSuperAdmin, setIsSuperAdmin] = useState(readIsSuperAdminLocally)

  useEffect(() => {
    // No session means nothing to ask about; RequireAuth is already sending them to /login.
    if (!getAccessToken()) {
      setLoaded(true)
      return
    }

    const controller = new AbortController()
    let active = true

    void (async () => {
      try {
        const res = await apiFetch('/api/auth/permissions', { signal: controller.signal })
        const json = await res.json().catch(() => null)
        if (!active) return

        if (json?.success && Array.isArray(json.allowedPageKeys)) {
          setAllowedPageKeys(json.allowedPageKeys)
          setPageScopes(json.pageScopes && typeof json.pageScopes === 'object' ? json.pageScopes : {})
          // SUNUCUNUN CEVABI YETKİLİ KAYNAK.
          //
          // Burada `json.isSuperAdmin || isLocalSsa` yazıyordu: sunucu "bu oturum süper admin
          // DEĞİL" dediğinde bile, tarayıcıdaki yerel tahmin true ise kullanıcı süper admin
          // sayılıyordu. Yerel tahmin localStorage'daki 'ssaViewMode' değerini de okuduğu için
          // bu, arayüzdeki bütün yetki kontrollerini tek satırlık bir tarayıcı düzenlemesiyle
          // aşılabilir hale getiriyordu.
          //
          // Doğrulandı (2026-08-10): sunucu Müdür rolü için isSuperAdmin=false ve 44 anahtar
          // dönerken, menüde yetkisi olmayan sayfalar (Rota, Stok, Raporlar, Ayarlar…) açıktı.
          //
          // Alan gelmediyse KAPALI başarısız olunur; yükseltme yalnızca sunucu açıkça söylerse.
          setIsSuperAdmin(json.isSuperAdmin === true)
          setFailed(false)
        } else {
          setFailed(true)
        }
      } catch (e) {
        if (controller.signal.aborted || !active) return
        setFailed(true)
      } finally {
        if (active) setLoaded(true)
      }
    })()

    return () => {
      active = false
      controller.abort()
    }
  }, [reloadToken])

  const can = useCallback(
    (key: PageKey | null) => hasKey(allowedPageKeys, isSuperAdmin, key),
    [allowedPageKeys, isSuperAdmin]
  )

  const canOpen = useCallback(
    (pathname: string) => canOpenRoute(allowedPageKeys, isSuperAdmin, pathname),
    [allowedPageKeys, isSuperAdmin]
  )

  const reload = useCallback(() => setReloadToken((n) => n + 1), [])

  const value = useMemo<PermissionsState>(
    () => ({ allowedPageKeys, pageScopes, isSuperAdmin, loaded, failed, can, canOpen, reload }),
    [allowedPageKeys, pageScopes, isSuperAdmin, loaded, failed, can, canOpen, reload]
  )

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
}

export function usePermissions(): PermissionsState {
  const ctx = useContext(PermissionsContext)
  if (!ctx) throw new Error('usePermissions must be used inside <PermissionsProvider>')
  return ctx
}

/**
 * "İşlem geçmişini görebilir mi" — her ekranda tekrar eden "i" düğmesinin tek kapısı.
 *
 * Yetki YÜKLENMEDEN true dönmez. Açık-başarısız kapı bu kod tabanında daha önce yaşandı:
 * `!permissionsLoaded || can(key)` yazılan bir kontrol, yetki isteği hata verdiğinde düğmeyi
 * herkese KALICI olarak açık bırakıyordu (2026-08-13, sekme chip'leri). Önce gizle, cevap
 * gelince göster.
 */
export function useCanViewHistory(): boolean {
  const { can, loaded } = usePermissions()
  return loaded && can(HISTORY_PAGE_KEY)
}
