import { API_BASE_URL } from '../config'
import { getAccessToken, getTenantCode, setAccessToken } from '../auth/storage'

/**
 * Bayi (B2B) ile ORTAK oturumun istemci tarafı.
 *
 * Süre, uyarı zamanı ve "bu oturum kapatıldı mı" bilgisi tek bir sunucu kaydından gelir; servis
 * tarafında ayrı bir süre ayarı yoktur. Teknisyenler bayi programına hiç girmez ama süreleri yine
 * oradaki ayardan belirlenir.
 */
export type SessionState = {
  valid: boolean
  revoked?: boolean
  expiresAtUtc: string | null
  alertBeforeMinutes: number
  durationMinutes: number
  /** Doluysa ortak bitiş değişmiştir (ör. bayiden uzatılmıştır) → bu token'a geçilir. */
  accessToken?: string | null
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken()
  const tenantCode = getTenantCode()
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenantCode ? { 'X-Tenant-Code': tenantCode } : {})
  }
}

/**
 * apiFetch KULLANILMIYOR: bu uç 401 aldığında oturumu düşürme kararını çağıran veriyor.
 * Ortak yoklama, kendi 401'iyle sonsuz bir "oturum öldü mü" sorgusuna girmemeli.
 */
export async function fetchSessionState(signal?: AbortSignal): Promise<SessionState | null> {
  const res = await fetch(`${API_BASE_URL}/api/auth/session-state`, { headers: authHeaders(), signal })

  if (res.status === 401) {
    return { valid: false, expiresAtUtc: null, alertBeforeMinutes: 0, durationMinutes: 0 }
  }

  if (!res.ok) return null

  const json = await res.json().catch(() => null)
  if (!json) return null

  const state: SessionState = {
    valid: Boolean(json.valid),
    revoked: Boolean(json.revoked),
    expiresAtUtc: json.expiresAtUtc ? String(json.expiresAtUtc) : null,
    alertBeforeMinutes: Number(json.alertBeforeMinutes ?? 3),
    durationMinutes: Number(json.durationMinutes ?? 60),
    accessToken: json.accessToken ? String(json.accessToken) : null
  }

  // Bitiş kaydığında sunucu tazelenmiş bir token yollar; sessizce devralınır.
  if (state.valid && state.accessToken) {
    setAccessToken(state.accessToken)
  }

  return state
}

export async function extendSession(): Promise<SessionState | null> {
  const res = await fetch(`${API_BASE_URL}/api/auth/extend-session`, {
    method: 'POST',
    headers: authHeaders()
  })

  if (res.status === 401) {
    // Oturum diğer taraftan kapatılmış: uzatma reddedildi.
    return { valid: false, revoked: true, expiresAtUtc: null, alertBeforeMinutes: 0, durationMinutes: 0 }
  }

  if (!res.ok) return null

  const json = await res.json().catch(() => null)
  const token = String(json?.data?.accessToken ?? '').trim()
  if (!token) return null

  setAccessToken(token)

  return {
    valid: true,
    expiresAtUtc: json?.data?.expiresAtUtc ? String(json.data.expiresAtUtc) : null,
    alertBeforeMinutes: Number(json?.data?.alertBeforeMinutes ?? 3),
    durationMinutes: 0,
    accessToken: token
  }
}

/** Çıkışı sunucuya bildirir: bayi tarafındaki oturum da düşer. */
export async function logoutShared(): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST', headers: authHeaders() })
  } catch {
    // Ağ hatası çıkışı engellemez; yerel oturum her hâlükârda temizlenir.
  }
}
