import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function handleUnauthorized(res: Response) {
  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('userName')
    sessionStorage.removeItem('userName')
    if (typeof window !== 'undefined') redirectToLogin()
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }
}


/*
  AÇIK OTURUMLAR (2026-08-30 kullanıcı isteği: "programda kimler aktifse görelim").

  Kaynak `SharedSessions` tablosu; B2B ve ServiceOps aynı satırı paylaştığı için listede
  servis tarafında çalışanlar da görünür.
*/
export type ActiveSessionDto = {
  username: string
  /** Kullanıcının Unvan alanı; boşsa sunucu kullanıcı adını döndürür. */
  displayName: string
  /** Rolün görünen adı (DisplayName, yoksa Name). Bulunamazsa boş. */
  roleName: string
  email: string
  expiresAtUtc: string
  lastActivityUtc: string
  remainingMinutes: number
  /** Son işlemden bu yana geçen dakika — "açık ama masasında değil"i ayırt eder. */
  idleMinutes: number
  isSelf: boolean
}

export async function fetchActiveSessions(signal?: AbortSignal): Promise<ActiveSessionDto[]> {
  const res = await fetch(`${API_BASE_URL}/api/auth/active-sessions`, {
    headers: buildHeaders(false),
    signal
  })
  await handleUnauthorized(res)
  if (!res.ok) return []
  const json = await res.json().catch(() => null)
  return (json?.data ?? []) as ActiveSessionDto[]
}

/** Bir kullanıcıyı oturumdan düşürür. Kendi oturumunu kapatmak sunucuda engellidir. */
export async function revokeUserSession(username: string): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/api/auth/revoke-session`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify({ username })
  })
  await handleUnauthorized(res)
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.message ?? 'Oturum kapatılamadı')
  return String(json?.message ?? 'Oturum kapatıldı')
}

export type RevokeAllResult = {
  /** Kaç oturum kapanmaya damgalandı. */
  affected: number
  /** Gerçek kapanma anı (ISO). Kullanıcılar bu ana kadar geri sayım görür. */
  revokeAtUtc: string
  /** Damgalama ile kapanma arasındaki saniye. */
  leadSeconds: number
  message: string
}

/**
 * Kendisi hariç TÜM açık oturumları kapatır — ama anında değil: sunucu birkaç saniye
 * sonrasına damgalar, kullanıcılar önce geri sayımlı uyarıyı görür.
 */
export async function revokeAllSessions(): Promise<RevokeAllResult> {
  const res = await fetch(`${API_BASE_URL}/api/auth/revoke-all-sessions`, {
    method: 'POST',
    headers: buildHeaders(true)
  })
  await handleUnauthorized(res)
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.message ?? 'Oturumlar kapatılamadı')
  return {
    affected: Number(json?.affected ?? 0),
    revokeAtUtc: String(json?.revokeAtUtc ?? ''),
    leadSeconds: Number(json?.leadSeconds ?? 30),
    message: String(json?.message ?? 'Oturumlar kapatılacak')
  }
}
