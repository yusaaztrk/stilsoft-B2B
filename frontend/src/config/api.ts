function normalizeBaseUrl(input: string | null | undefined): string {
  const s = String(input ?? '').trim()
  if (!s) return ''
  return s.replace(/\/+$/, '')
}

const fromEnv = normalizeBaseUrl((import.meta as any)?.env?.VITE_API_BASE_URL)

/**
 * `?apiBase=...` ile gelen adresin kabul edilebilir olup olmadığı.
 *
 * NEDEN SÜZGEÇ VAR: bu değer TÜM uygulamanın istek adresini belirliyor ve localStorage'a
 * yazılıp sonraki oturumlara da taşınıyor. Doğrulanmadığında, kullanıcıya gönderilen
 * `.../login?apiBase=https://saldirgan.example` gibi tek bir bağlantı, kullanıcı adı/parolayı
 * ve Bearer token'ı saldırganın sunucusuna yollamaya yetiyordu — üstelik kalıcı olarak.
 *
 * Ne kabul edilir: aynı ana makine (port farkı serbest — telefondan LAN'daki API'ye bakmak
 * bu yüzden çalışıyor), localhost/127.0.0.1, özel ağ adresleri (10.x, 192.168.x, 172.16–31.x)
 * ve derlemeye gömülü `VITE_API_BASE_URL` ana makinesi (tünelle çalışan kurulum bozulmasın).
 * Bunların dışındaki her adres yok sayılır.
 */
function isAllowedApiBase(candidate: string): boolean {
  if (!candidate) return false

  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false

    const host = url.hostname.toLowerCase()

    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
    if (typeof window !== 'undefined' && host === window.location.hostname.toLowerCase()) return true

    if (fromEnv) {
      try {
        if (host === new URL(fromEnv).hostname.toLowerCase()) return true
      } catch {
        // gömülü değer adres değilse yok say
      }
    }

    if (/^10\./.test(host) || /^192\.168\./.test(host)) return true
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true

    return false
  } catch {
    return false
  }
}

function getRuntimeOverride(): string {
  if (typeof window === 'undefined') return ''

  try {
    const url = new URL(window.location.href)
    const qp = normalizeBaseUrl(url.searchParams.get('apiBase'))
    if (qp && isAllowedApiBase(qp)) {
      localStorage.setItem('apiBaseOverride', qp)
      return qp
    }
  } catch {
    // ignore
  }

  try {
    // Daha önce kaydedilmiş değer de aynı süzgeçten geçer: kural eklenmeden önce yazılmış
    // bir adres burada elenip temizlenir.
    const stored = normalizeBaseUrl(localStorage.getItem('apiBaseOverride'))
    if (stored && !isAllowedApiBase(stored)) {
      localStorage.removeItem('apiBaseOverride')
      return ''
    }
    return stored
  } catch {
    return ''
  }
}

const runtimeOverride = getRuntimeOverride()

/**
 * API base URL configuration:
 * 1. Priority: VITE_API_BASE_URL from environment
 * 2. If in browser:
 *    - If port is 5173 (Vite Dev), use localhost:5000
 *    - Otherwise (Production/IIS), use current origin + /api
 * 3. Fallback: http://localhost:5200
 */
export const API_BASE_URL = fromEnv ||
  runtimeOverride ||
  (typeof window !== 'undefined'
    ? (['5173', '5174', '5175', '3000'].includes(window.location.port)
      ? `http://${window.location.hostname}:5200`
      : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:5200'
        // YAYIN (IIS, tek site): API arayuzle AYNI kaynakta duruyor.
        // Onceki deger `http://${hostname}:5200` idi ve canlida CALISMIYORDU: 5200 disariya
        // acik degil, ustelik https sayfadan http istek karisik icerik olarak engellenir.
        // Ustteki yorum satiri zaten 'use current origin' diyordu, kod onu yapmiyordu.
        : window.location.origin))
    : 'http://localhost:5200')

/**
 * ServiceOps arayuzunun adresi.
 *
 * NEDEN AYRI BIR COZUMLEYICI: bu adres dort ayri yerde `hostname:5173` diye SABIT yazilmisti.
 * 5173 Vite gelistirme sunucusunun portu; yayinda o port disariya kapali oldugu icin
 * "Servise Gecis" dugmesi erp.<alan>:5173 gibi acilmayan bir adrese gidiyordu.
 *
 * Sira: gelistirme ortami -> derlemeye gomulu deger -> alan adindan turetme.
 * Turetme kurali: ERP `erp.` (ya da `b2b.`) alt alanindan servis `servis.` alt alanina gider.
 * Farkli bir alan semasi kullanilacaksa `VITE_SERVICEOPS_BASE_URL` ile derlemede sabitlenir.
 */
export function serviceOpsBaseUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:5173'

  const { protocol, hostname, port } = window.location

  // Gelistirme: Vite portlarindan biri ya da dogrudan localhost
  if (['5173', '5174', '5175', '3000'].includes(port) || hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:5173`
  }

  const fromEnvService = normalizeBaseUrl((import.meta as any)?.env?.VITE_SERVICEOPS_BASE_URL)
  if (fromEnvService) return fromEnvService

  for (const prefix of ['erp.', 'b2b.']) {
    if (hostname.startsWith(prefix)) {
      return `${protocol}//servis.${hostname.slice(prefix.length)}`
    }
  }

  // Ayirt edemedik: ayni kaynakta kal, en azindan kirik bir porta gitme.
  return `${protocol}//${hostname}`
}

/**
 * Personel (İK) portalının adresi.
 *
 * `serviceOpsBaseUrl` ile aynı sırayı izler: geliştirme ortamı -> derlemeye gömülü değer
 * -> alan adından türetme. Türetme kuralı ERP `erp.` (ya da `b2b.`) alt alanından personel
 * `personel.` alt alanına gider — canlıda portal `personel.<alan>` altında duruyor.
 *
 * Farklı bir alan şeması kullanılacaksa `VITE_EMPLOYEE_PORTAL_BASE_URL` ile derlemede
 * sabitlenir.
 */
export function employeePortalBaseUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:5175'

  const { protocol, hostname, port } = window.location

  if (['5173', '5174', '5175', '3000'].includes(port) || hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:5175`
  }

  const fromEnvEmployee = normalizeBaseUrl((import.meta as any)?.env?.VITE_EMPLOYEE_PORTAL_BASE_URL)
  if (fromEnvEmployee) return fromEnvEmployee

  for (const prefix of ['erp.', 'b2b.']) {
    if (hostname.startsWith(prefix)) {
      return `${protocol}//personel.${hostname.slice(prefix.length)}`
    }
  }

  return `${protocol}//${hostname}`
}

/**
 * Asistan (WhatsApp) programının adresi — ayrı site, servis ve personel gibi (2026-10-07).
 * Sıra aynı: geliştirme → derlemeye gömülü `VITE_ASISTAN_BASE_URL` → `erp.`/`b2b.` alt alanından
 * `asistan.` alt alanına türetme (canlı: asistan.example.com).
 */
export function asistanBaseUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:5177'

  const { protocol, hostname, port } = window.location

  if (['5173', '5174', '5175', '3000'].includes(port) || hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:5177`
  }

  const fromEnv = normalizeBaseUrl((import.meta as any)?.env?.VITE_ASISTAN_BASE_URL)
  if (fromEnv) return fromEnv

  for (const prefix of ['erp.', 'b2b.']) {
    if (hostname.startsWith(prefix)) {
      return `${protocol}//asistan.${hostname.slice(prefix.length)}`
    }
  }

  return `${protocol}//${hostname}`
}

export function apiUrl(path: string) {
  const p = String(path ?? '')
  if (!p) return API_BASE_URL
  if (p.startsWith('http://') || p.startsWith('https://')) return p
  const cleanPath = p.startsWith('/') ? p : `/${p}`
  return `${API_BASE_URL}${cleanPath}`
}

export function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token =
    localStorage.getItem('accessToken') ||
    localStorage.getItem('token') ||
    localStorage.getItem('jwtToken') ||
    localStorage.getItem('authToken')
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const tenantCode = localStorage.getItem('tenantCode')
  if (tenantCode) {
    headers['X-Tenant-Code'] = tenantCode
  }
  return headers
}
