import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

// Yardimcilar bu dosyada yerel: proje genelinde ortak bir http katmani yok, her api dosyasi
// kendi kopyasini tutuyor (bkz. purchaseInvoices.ts). Ayrisma riski yok, govde uc satir.
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
    throw new Error('Oturum suresi doldu. Lutfen tekrar giris yapin.')
  }
}

export type HizmetHarcamaTedarikci = {
  supplierCode: string
  supplierName: string
  amount: number
  invoiceCount: number
}

export type HizmetHarcamaSatiri = {
  /** Gruplama anahtari: 'SVC:<kod>' | 'CARI:<kod>' | 'URUN:<stok>' | 'YOK'. */
  key: string
  /** Ekranda gosterilen hizmet/gider turu adi. */
  name: string
  invoiceCount: number
  /** KDV haric net tutar, TL. */
  amount: number
  sharePercent: number
  lastDate?: string | null
  suppliers: HizmetHarcamaTedarikci[]
}

export type HizmetHarcamaDetayi = {
  invoiceId: number
  documentNo: string
  date: string
  key: string
  name: string
  supplierCode: string
  supplierName: string
  amount: number
  currencyCode: string
  currencyAmount: number
  /** 'Hizmet Faturasi' | 'Alis Faturasi' */
  source: string
  description?: string | null
}

export type HizmetHarcamaAyi = {
  month: string
  amount: number
}

export type HizmetHarcamaRaporu = {
  from: string
  to: string
  totalAmount: number
  serviceCount: number
  lineCount: number
  invoiceCount: number
  services: HizmetHarcamaSatiri[]
  monthly: HizmetHarcamaAyi[]
  details: HizmetHarcamaDetayi[]
}

function friendlyError(text: string, status: number, fallback: string) {
  const t = String(text ?? '').trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      /* gövde JSON değilse alttaki metin kullanılır */
    }
  }
  return t || `${fallback} (${status})`
}

export async function fetchHizmetHarcamaRaporu(
  params: { from?: string; to?: string; supplierCode?: string },
  opts?: { signal?: AbortSignal }
): Promise<HizmetHarcamaRaporu> {
  const sp = new URLSearchParams()
  if (params.from) sp.set('from', params.from)
  if (params.to) sp.set('to', params.to)
  if (params.supplierCode) sp.set('supplierCode', params.supplierCode)

  const qs = sp.toString()
  const res = await fetch(`${API_BASE_URL}/api/service-expense-report${qs ? `?${qs}` : ''}`, {
    headers: buildHeaders(false),
    signal: opts?.signal
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Hizmet harcama raporu alınamadı'))
  }

  const json = await res.json()
  const d = json?.data ?? {}
  return {
    from: String(d?.from ?? ''),
    to: String(d?.to ?? ''),
    totalAmount: Number(d?.totalAmount ?? 0),
    serviceCount: Number(d?.serviceCount ?? 0),
    lineCount: Number(d?.lineCount ?? 0),
    invoiceCount: Number(d?.invoiceCount ?? 0),
    services: (d?.services ?? []) as HizmetHarcamaSatiri[],
    monthly: (d?.monthly ?? []) as HizmetHarcamaAyi[],
    details: (d?.details ?? []) as HizmetHarcamaDetayi[]
  }
}
