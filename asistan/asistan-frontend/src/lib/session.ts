/*
  OTURUM — asistanın KENDİ token'ı (B2B token'ı değil).

  Token yalnız iki yerden gelir: şifreli giriş ve B2B'den "Asistan'a Geç" devri. İkisinde de
  sunucu B2B kimliğini bir kez doğrulayıp kendi token'ını imzalıyor. Süresi B2B oturumunun
  bitişini devralıyor; dolunca ilk istek 401 alır ve giriş ekranına dönülür.
*/

const TOKEN_KEY = 'asistanToken'
const USER_KEY = 'asistanUser'

export type SessionUser = { userName: string; tenantCode: string; isSsa: boolean }

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function getUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as SessionUser) : null
  } catch {
    return null
  }
}

export function setSession(token: string, user: SessionUser) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

/** Son kullanılan firma — giriş ekranında seçili gelsin. */
export function lastTenant(): string {
  try {
    return localStorage.getItem('asistanLastTenant') ?? ''
  } catch {
    return ''
  }
}

export function rememberTenant(code: string) {
  try {
    localStorage.setItem('asistanLastTenant', code)
  } catch {
    /* önemsiz */
  }
}

export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * API çağrısı. Adres göreli: canlıda ekran ve API aynı sitede, geliştirmede Vite aktarıyor.
 * 401 gelirse oturum silinir ve giriş ekranına dönülür.
 */
export async function api<T>(path: string, init?: RequestInit & { anonymous?: boolean }): Promise<T> {
  const headers: Record<string, string> = {}
  if (init?.body) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token && !init?.anonymous) headers.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } })
  } catch {
    throw new ApiError('Sunucuya ulaşılamadı.', 0)
  }

  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }

  if (res.status === 401 && !init?.anonymous) {
    clearSession()
    if (!window.location.pathname.startsWith('/login')) window.location.assign('/login')
    throw new ApiError('Oturum süresi doldu.', 401)
  }

  if (!res.ok) {
    const message =
      data?.message ||
      (res.status === 403 ? 'Bu ekrana yetkiniz yok.' : res.status === 429 ? 'Çok fazla deneme. Bir dakika bekleyin.' : `Hata (${res.status})`)
    throw new ApiError(message, res.status, data?.code)
  }
  return data as T
}

/**
 * B2B'ye dönüş adresi. Token TAŞIMAZ (B2B'ye giden bağlantılar devir parametresi taşımaz).
 *
 * ADRES ALAN ADINDAN TÜRETİLİR (2026-10-11): `asistan.<alan>` → `b2b.<alan>`.
 * Eskiden yalnız derlemeye gömülen `VITE_B2B_URL` okunuyordu ve ilk canlı paket `erp.` adresiyle
 * derlenmişti: "B2B'ye dön" süresi dolmuş, yanlış alt alana (erp.example.com) gidiyordu.
 * Bayi arayüzünün yayın adresi `b2b.<alan>` (Servis'teki `b2bBaseUrl` ile aynı kural).
 * Gömülü değer artık yalnız `asistan.` ile BAŞLAMAYAN, farklı şemalı kurulumlar için yedek.
 */
export function b2bUrl(): string | null {
  const { protocol, hostname } = window.location
  if (hostname === 'localhost' || hostname === '127.0.0.1') return `${protocol}//${hostname}:5174`
  if (hostname.startsWith('asistan.')) return `${protocol}//b2b.${hostname.slice('asistan.'.length)}`
  const fromEnv = String((import.meta as any).env?.VITE_B2B_URL ?? '').replace(/\/+$/, '')
  return fromEnv || null
}
