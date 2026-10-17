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

function friendlyError(text: string, status: number, fallback: string) {
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

export type UpdateInvoiceHeaderPayload = {
  invoiceNo?: string | null
  customerCode?: string | null
  customerInvoiceTypeOverride?: string | null
  description?: string | null
  installationName?: string | null
  installationPhone?: string | null
  priceGroupId?: string | null
  exchangeRate?: number | null
  /** Yeni fatura tarihi (yyyy-MM-dd). Yalnız satış/açık satış faturasında dikkate alınır. */
  date?: string | null
}

export async function updateInvoiceHeader(invoiceId: number, payload: UpdateInvoiceHeaderPayload): Promise<void> {
  const safeId = Number(invoiceId)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(String(safeId))}/header`, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Üst bilgi güncellenemedi'))
  }
}

export type InvoiceHeaderDto = {
  id: number
  faturaNo: string
  cariKodu: string
  faturaAcik: string
  currencyTypeId?: number | null
  exchangeRate?: number | null
  rateSource?: string | null
  description?: string | null
}

export type InvoiceLineDto = {
  id: number
  stockCode: string
  stockName: string
  description?: string | null
  vatRate: number
  quantity: number
  unitPrice: number
  currencyTypeId?: number
  currencyRate?: number
  currencyUnitPrice?: number
  total: number
  barcode?: string | null
  barcodeType?: string | null
  installationName?: string | null
}

export async function fetchInvoiceHeader(invoiceId: number): Promise<InvoiceHeaderDto> {
  const safeId = Number(invoiceId)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(String(safeId))}`, {
    headers: buildHeaders(false)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Fatura bilgileri alınamadı'))
  }

  const json = await res.json()
  const d = json?.data ?? {}
  return {
    id: Number(d?.id ?? safeId),
    faturaNo: String(d?.faturaNo ?? ''),
    cariKodu: String(d?.cariKodu ?? ''),
    faturaAcik: String(d?.faturaAcik ?? ''),
    currencyTypeId: d?.currencyTypeId !== undefined ? Number(d.currencyTypeId) : null,
    exchangeRate: d?.exchangeRate !== undefined ? Number(d.exchangeRate) : null,
    rateSource: d?.rateSource ? String(d.rateSource) : null,
    description: d?.description ? String(d.description) : null
  }
}

export async function fetchInvoiceLines(invoiceId: number): Promise<InvoiceLineDto[]> {
  const safeId = Number(invoiceId)
  if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('Geçersiz id')

  const res = await fetch(`${API_BASE_URL}/api/invoices/${encodeURIComponent(String(safeId))}/lines`, {
    headers: buildHeaders(false)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Fatura satırları alınamadı'))
  }

  const json = await res.json()
  const rows = (json?.data ?? []) as any[]
  return rows.map((x) => ({
    id: Number(x?.id ?? 0),
    stockCode: String(x?.stockCode ?? ''),
    stockName: String(x?.stockName ?? ''),
    description: x?.description ?? null,
    vatRate: Number(x?.vatRate ?? 0),
    quantity: Number(x?.quantity ?? 0),
    unitPrice: Number(x?.unitPrice ?? 0),
    currencyTypeId: Number(x?.currencyTypeId ?? 0),
    currencyRate: Number(x?.currencyRate ?? 0),
    currencyUnitPrice: Number(x?.currencyUnitPrice ?? 0),
    total: Number(x?.total ?? 0),
    barcode: x?.barcode ? String(x.barcode) : null,
    barcodeType: x?.barcodeType ? String(x.barcodeType) : null,
    installationName: x?.installationName ? String(x.installationName) : null
  }))
}

/**
 * Fetches the invoice rendered for the pre-printed form.
 *
 * The server draws it, not the browser: the sheet already carries the frame and captions, and
 * the variable data has to land on it to within a fraction of a millimetre. HTML printed through
 * a browser cannot promise that — margins, scaling and font substitution all move it.
 *
 * Returned as a blob rather than opened directly because the endpoint needs the bearer token,
 * which window.open() cannot carry.
 */
export async function fetchInvoicePrintPdf(invoiceId: number): Promise<Blob> {
  const res = await fetch(`${API_BASE_URL}/api/invoices/${invoiceId}/yazdir`, {
    headers: buildHeaders(false)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(friendlyError(text, res.status, 'Fatura basımı alınamadı'))
  }

  return await res.blob()
}

/**
 * Barcode labels for an invoice, drawn on the server.
 *
 * The browser used to build these with JsBarcode, which took the article number as CODE128
 * whenever the product record did not explicitly say EAN13 — a symbology a till will not match
 * to the article. The server encodes EAN-13, verifies the check digit, and refuses codes that
 * would not scan.
 *
 * Resolves with the PDF and how many lines were left out for having an unusable barcode.
 */
export async function fetchInvoiceBarcodePdf(invoiceId: number): Promise<{ blob: Blob; skipped: number }> {
  const res = await fetch(`${API_BASE_URL}/api/invoices/${invoiceId}/barkod`, {
    headers: buildHeaders(false)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(friendlyError(text, res.status, 'Barkod basımı alınamadı'))
  }

  return {
    blob: await res.blob(),
    skipped: Number(res.headers.get('X-Barkod-Atlanan') ?? 0)
  }
}
