function normalizeBaseUrl(input: string | null | undefined): string {
  const s = String(input ?? '').trim()
  if (!s) return ''
  return s.replace(/\/+$/, '')
}

const fromEnv = normalizeBaseUrl((import.meta as any)?.env?.VITE_API_BASE_URL)
const fromEnvErp = normalizeBaseUrl((import.meta as any)?.env?.VITE_ERP_API_BASE_URL)

function isDevOrLocalHost(): boolean {
  if (typeof window === 'undefined') return true
  const host = window.location.hostname.toLowerCase()
  const port = window.location.port
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
  if (['5173', '5174', '5175', '5176', '5177', '3000'].includes(port)) return true
  return false
}

/**
 * Çalışan servisi (İK). Personel, mesai, izin, ödeme, hakediş ve iş günü takvimi
 * uçlarının tamamı buradan geçer (Port 5108).
 */
export const API_BASE_URL =
  fromEnv ||
  (typeof window !== 'undefined'
    ? (isDevOrLocalHost()
      ? `http://${window.location.hostname}:5108`
      : normalizeBaseUrl(window.location.origin))
    : 'http://localhost:5108')

/**
 * Ana ERP API'si (Port 5200). Yalnızca YEDEK yollar için kullanılır: bayi tarafındaki
 * yönetici girişi ve eski firma listesi uçları.
 *
 * Yüz tanıma, QR mesai ve firma markası uçları buradan ÇIKARILDI; hepsi artık personel
 * servisinin kendi API'sinde (`API_BASE_URL`). Portal tek başına yayına alınabilsin diye
 * yapıldı — bkz. {@link ERP_API_ENABLED}.
 */
export const ERP_API_BASE_URL =
  fromEnvErp ||
  (typeof window !== 'undefined'
    ? (isDevOrLocalHost()
      ? `http://${window.location.hostname}:5200`
      : normalizeBaseUrl(window.location.origin))
    : 'http://localhost:5200')

/**
 * Bayi (ERP) API'si erişilebilir mi?
 *
 * Personel portalı bayi sisteminden ÖNCE yayına alınıyor. O kurulumda 5200 diye bir şey yok;
 * yedek yollar yine de denenirse her istek ölü bir adrese gidip bağlantı zaman aşımı kadar
 * bekletiyor — giriş ekranı sebepsiz yere yavaşlıyor ve konsol hata doluyor.
 *
 * Kural: `VITE_ERP_API_BASE_URL` açıkça verilmişse bayi API'si vardır. Verilmemişse yalnızca
 * geliştirme/yerel ağda varsayılır (orada 5200 genelde ayakta). Canlıda değişkeni tanımlama →
 * yedek yollar hiç denenmez.
 */
export const ERP_API_ENABLED = Boolean(fromEnvErp) || isDevOrLocalHost()

/**
 * PANELLER ARASI GEÇİŞ ADRESLERİ.
 *
 * Alan şeması üç kardeş alt alandır: `b2b.<alan>` (bayi), `servis.<alan>` (ServiceOps),
 * `personel.<alan>` (bu portal). ERP tarafındaki çözümleyicilerin aynadaki eşi; oradaki
 * kural kendi önekini değiştirmekti, burada `personel.` öneki değişir.
 *
 * BAYİ ALT ALANI `b2b.` (2026-09-02'de alan adı taşındı; burası 2026-10-11'e kadar `erp.`
 * yazıyordu ve "Bayi'ye geç" süresi dolmuş, yanlış adrese gidiyordu). Servis arayüzü aynı
 * düzeltmeyi daha önce almıştı (`b2bBaseUrl`).
 *
 * Geliştirme portları: ServiceOps 5173, ERP 5174, portal 5175.
 *
 * Ayırt edilemeyen bir alanda BOŞ döner — kırık bir adrese gitmektense düğmeyi hiç
 * göstermemek doğrusu.
 */
function siblingAppUrl(targetPrefix: string, devPort: string): string {
  if (typeof window === 'undefined') return ''

  const { protocol, hostname, port } = window.location

  if (['5173', '5174', '5175', '3000'].includes(port) || hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:${devPort}`
  }

  if (hostname.startsWith('personel.')) {
    return `${protocol}//${targetPrefix}${hostname.slice('personel.'.length)}`
  }

  return ''
}

/** Bayi (ERP) arayüzünün adresi; ayırt edilemezse boş. */
export function erpAppBaseUrl(): string {
  const fromEnv = normalizeBaseUrl((import.meta as any)?.env?.VITE_ERP_APP_BASE_URL)
  return fromEnv || siblingAppUrl('b2b.', '5174')
}

/** ServiceOps arayüzünün adresi; ayırt edilemezse boş. */
export function serviceOpsAppBaseUrl(): string {
  const fromEnv = normalizeBaseUrl((import.meta as any)?.env?.VITE_SERVICEOPS_BASE_URL)
  return fromEnv || siblingAppUrl('servis.', '5173')
}

export function apiUrl(path: string) {
  const p = String(path ?? '')
  if (!p) return API_BASE_URL
  if (p.startsWith('http://') || p.startsWith('https://')) return p
  const cleanPath = p.startsWith('/') ? p : `/${p}`
  return `${API_BASE_URL}${cleanPath}`
}


/** Tüm API çağrılarında ortak başlıklar: kimlik ve firma kodu. */
export function buildAuthHeaders(includeJson = false): Record<string, string> {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'

  try {
    const token = localStorage.getItem('accessToken')
    if (token) headers.Authorization = `Bearer ${token}`

    const tenantCode = String(localStorage.getItem('tenantCode') ?? '').trim()
    if (tenantCode) headers['X-Tenant-Code'] = tenantCode
  } catch {
    // localStorage erişilemiyorsa başlıksız devam edilir; sunucu 401 döner.
  }

  return headers
}

/** 401'de oturumu temizleyip giriş ekranına döner. */
export async function handleUnauthorized(res: Response) {
  if (res.status !== 401) return

  try {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('userName')
    sessionStorage.removeItem('userName')
  } catch {
    // yoksay
  }

  if (typeof window !== 'undefined') window.location.assign('/login')
}

/** Sunucudan gelen hata gövdesini okunabilir tek satıra indirger. */
export function friendlyError(text: string, status: number, fallback: string) {
  const t = String(text ?? '').trim()
  if (!t) return `${fallback} (${status})`
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `${fallback} (${status})`
    }
  }
  return t
}

/** Ortak fetch sarmalayıcısı: başlık, 401 yönlendirmesi ve hata mesajı tek yerde. */
export async function apiFetch<T = any>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal; fallbackError?: string; base?: string } = {}
): Promise<T> {
  const base = options.base ?? API_BASE_URL
  const res = await fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
    method: options.method ?? 'GET',
    headers: buildAuthHeaders(options.body !== undefined),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(friendlyError(text, res.status, options.fallbackError ?? 'İstek başarısız'))
  }

  return (await res.json().catch(() => null)) as T
}
