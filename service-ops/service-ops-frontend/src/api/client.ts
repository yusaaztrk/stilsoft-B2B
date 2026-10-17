import { API_BASE_URL } from '../config'
import { clearSession, getAccessToken, getTenantCode } from '../auth/storage'
import { gateStatusChange } from './statusChangeGate'

type ApiFetchOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>
}

export async function apiFetch(path: string, options: ApiFetchOptions = {}) {
  // DURUM DEĞİŞİKLİĞİ ONAYI BURADA, İSTEK GİTMEDEN ÖNCE.
  //
  // Kapıyı çağrı yerlerine tek tek koymak yerine tek geçitte tutmanın sebebi: durum değiştiren
  // 30'dan fazla çağrı yeri var, biri unutulduğunda hata sessiz olur (onay ekranı çıkmaz,
  // kimse fark etmez). Buradan geçmeyen bir istek yok.
  await gateStatusChange(path, options.method, options.body)

  const token = getAccessToken()
  const tenantCode = getTenantCode()
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`

  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(tenantCode ? { 'X-Tenant-Code': tenantCode } : {}),
      'Content-Type': options.body ? 'application/json' : (options.headers?.['Content-Type'] ?? 'application/json'),
    },
  })

  if (res.status === 401) {
    const skipRedirect = options.headers?.['X-Skip-Auth-Redirect'] === 'true'
    if (!skipRedirect && (await isSessionActuallyDead(token))) {
      clearSession()
      if (window.location.pathname !== '/login') {
        window.location.assign('/login')
      }
    }
    throw new Error('Unauthorized')
  }

  return res
}

/**
 * Bir 401'i oturumun bittiği anlamına geldiğine karar vermeden önce SORARIZ.
 *
 * Eskiden herhangi bir 401 doğrudan logout tetikliyordu. Sorun şu ki ServiceOps uçlarının bir
 * kısmı 401'i başka anlamlarda kullanıyordu — B2B ERP vekil çağrısı üst sistemden 401 alınca onu
 * aynen geri veriyordu, firma kodu başlığı eksik olunca 401 dönüyordu, teknisyen kaydı olmayan
 * kullanıcıya 401 dönüyordu. Hepsi kullanıcıyı sistemden atıyordu: "Ayarlar'a / Saha Ekibi'ne
 * basınca çıkış oluyor" şikâyeti buydu. O uçlar düzeltildi (502 / 400 / 403), ama tek bir kaçak
 * bile kullanıcıyı yine atacağı için karar burada da doğrulanıyor.
 *
 * Ters yönde de gerekli: yalnızca /api/auth/* 401'inde çıkış yapmak (bir ara denenen çözüm) token
 * süresi dolduğunda kullanıcıyı hiçbir şeyin yüklenmediği, çıkış da yapmayan bir ekranda bırakır.
 */
let sessionProbe: Promise<boolean> | null = null

function isSessionActuallyDead(token: string | null): Promise<boolean> {
  if (!token) return Promise.resolve(true)

  // Bir sayfa açılışta onlarca istek atıyor; oturum gerçekten bittiyse hepsi birden 401 döner.
  // Aynı anda onlarca doğrulama isteği çıkmasın diye uçuştaki sorgu paylaşılıyor.
  if (sessionProbe) return sessionProbe

  sessionProbe = (async () => {
    try {
      // apiFetch DEĞİL: buradan tekrar buraya girip sonsuz döngü olmasın.
      const probe = await fetch(`${API_BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      return probe.status === 401
    } catch {
      // Ağ hatası oturumun bittiğini göstermez; kullanıcıyı atmıyoruz.
      return false
    } finally {
      // Sonuç önbelleğe alınmıyor: token yenilenmiş olabilir, bir sonraki 401 tekrar sorsun.
      setTimeout(() => { sessionProbe = null }, 0)
    }
  })()

  return sessionProbe
}

/**
 * Sunucunun ProblemDetails yanıtından okunabilir bir mesaj çıkarır.
 *
 * Eskiden gövde ham haliyle Error mesajına konuyordu; ekranda ya bir JSON bloğu ya da yalnızca
 * "Bad Gateway" görünüyordu. Müşteri/Bayi ekranındaki "Bad Gateway" şikâyeti buydu: sunucu
 * aslında "ERP kimlik doğrulaması başarısız oldu" diye açıklama yolluyor ama açıklama hiçbir
 * yerde gösterilmiyordu.
 */
function describeError(text: string, status: number): string {
  const fallback = status === 502
    ? 'B2B ERP sistemine ulaşılamadı. ERP servisi kapalı veya servis hesabının girişi başarısız.'
    : `İstek başarısız (${status})`

  if (!text?.trim()) return fallback

  try {
    const body = JSON.parse(text) as { title?: string; detail?: string; message?: string }
    const parts = [body.title, body.detail ?? body.message].filter(Boolean)
    if (parts.length > 0) return [...new Set(parts)].join(' — ')
  } catch {
    // JSON değilse düz metin olarak kullanılır.
  }

  return text.length > 400 ? fallback : text
}

export async function apiJson<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const res = await apiFetch(path, options)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(describeError(text, res.status))
  }

  if (res.status === 204) return undefined as T

  const text = await res.text().catch(() => '')
  if (!text.trim()) return undefined as T

  return JSON.parse(text) as T
}
