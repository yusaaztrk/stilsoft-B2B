import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type WarehouseDto = {
  warehouseCode: number
  name?: string | null
  salesmanCode?: string | null
  isVehicle?: boolean
  plate?: string | null
  driverName?: string | null
  vehicleType?: string | null
  vehicleModel?: string | null
  negativeBalanceControl: boolean
  isActive: boolean
}

// NEGATİF DEPO KODU GEÇERLİDİR (2026-09-16): sipariş/sanal depolar `-20 SİPARİŞ`, `-21 YP SİPARİŞ`
// gibi eksi kodla tutuluyor ve sunucu (`WarehousesController`) yalnız 0'ı reddediyor. Buradaki
// `<= 0` kontrolü istek hiç gönderilmeden "Geçersiz depo kodu" yazdırıyordu (Depo Stok Durumu).
export async function fetchWarehouseInventory(
  warehouseCode: number,
  params?: { from?: string | null; to?: string | null; q?: string | null },
  opts?: { signal?: AbortSignal }
): Promise<WarehouseInventoryResponse> {
  const code = Number(warehouseCode)
  if (!Number.isFinite(code) || code === 0) throw new Error('Geçersiz depo kodu')
  const qs = new URLSearchParams()
  if (params?.from) qs.set('from', params.from)
  if (params?.to) qs.set('to', params.to)
  if (params?.q) qs.set('q', params.q)

  const res = await fetch(`${API_BASE_URL}/api/warehouses/${encodeURIComponent(String(code))}/inventory?${qs.toString()}`, {
    headers: buildHeaders(false),
    signal: opts?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Depo envanteri alınamadı'))
  }
  const json = await res.json()
  return (json?.data ?? {}) as WarehouseInventoryResponse
}

export async function fetchWarehouseMovements(
  warehouseCode: number,
  params?: { stockCode?: string | null; from?: string | null; to?: string | null; take?: number; skip?: number },
  opts?: { signal?: AbortSignal }
): Promise<WarehouseMovementsResponse> {
  const code = Number(warehouseCode)
  if (!Number.isFinite(code) || code === 0) throw new Error('Geçersiz depo kodu')
  const qs = new URLSearchParams()
  if (params?.stockCode) qs.set('stockCode', params.stockCode)
  if (params?.from) qs.set('from', params.from)
  if (params?.to) qs.set('to', params.to)
  if (params?.take) qs.set('take', String(params.take))
  if (params?.skip && params.skip > 0) qs.set('skip', String(Math.floor(params.skip)))

  const res = await fetch(`${API_BASE_URL}/api/warehouses/${encodeURIComponent(String(code))}/movements?${qs.toString()}`, {
    headers: buildHeaders(false),
    signal: opts?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Depo hareketleri alınamadı'))
  }
  const json = await res.json()
  return (json?.data ?? {}) as WarehouseMovementsResponse
}

export type WarehouseDropdownItem = {
  warehouseCode: number
  name?: string | null
  /** Araç deposu mu. Yalnızca `/dropdown` ucu doldurur. */
  isVehicle?: boolean
  /** Kullanıcının varsayılan deposu. Yalnızca `/authorized-dropdown` ucu doldurur. */
  isDefault?: boolean
}

/**
 * Ekran açılınca ÖNCEDEN SEÇİLECEK depo: kullanıcının varsayılanı, yoksa tek deposu, yoksa HİÇBİRİ.
 *
 * Eskiden birden fazla depoda listenin ilki (`[0]`) seçiliyordu; liste koda göre sıralı olduğu
 * için bu hep `-21 YP SİPARİŞ` oluyordu ve proformadan faturaya aktarımda stok o depodan
 * düşüyordu (DEMO_CANLI, 2026-09-27). Varsayılan yoksa kullanıcı depoyu kendisi seçer.
 */
export function pickDefaultWarehouseCode(list: WarehouseDropdownItem[] | null | undefined): number | null {
  const items = list ?? []
  const varsayilan = items.find((w) => w.isDefault)
  if (varsayilan) return Number(varsayilan.warehouseCode)
  if (items.length === 1) return Number(items[0].warehouseCode)
  return null
}

export type AuthorizedStockBalancesResponse = {
  warehouses: Array<WarehouseDropdownItem & { isActive?: boolean }>
  items: Array<{
    stockCode: string
    /**
     * Tüm depoların (pasif dahil) ham net toplamı. Yalnız `includeAll` ile ve tam stok
     * yetkisi olan kullanıcıda dolu gelir; aksi halde null. Ürün kartındaki `Products.Stock`
     * ile kıyaslamak için — kart alanı zamanla sapabildiğinden gerçek kaynak budur.
     */
    trueTotal?: number | null
    balances: Array<{ warehouseCode: number; balance: number }>
  }>
}

export type WarehouseInventoryItem = {
  stockCode: string
  stockName?: string | null
  minStock?: number
  totalIn: number
  totalOut: number
  balance: number
}

export type WarehouseInventoryResponse = {
  warehouseCode: number
  from?: string | null
  to?: string | null
  items: WarehouseInventoryItem[]
  totals: { totalIn: number; totalOut: number; balance: number }
}

export type WarehouseMovementItem = {
  id: number
  date: string
  invoiceNo: string
  customerCode: string
  deliveryCustomerCode: string
  stockCode: string
  direction: string
  quantity: number
  netUnitPrice: number
  vatRate: number
  bagNo: string
  lineNo: number
}

export type WarehouseMovementsResponse = {
  warehouseCode: number
  stockCode?: string | null
  from?: string | null
  to?: string | null
  items: WarehouseMovementItem[]
}

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

export async function fetchWarehouses(opts?: { includeInactive?: boolean; signal?: AbortSignal }): Promise<WarehouseDto[]> {
  const qs = new URLSearchParams({ includeInactive: String(Boolean(opts?.includeInactive)) }).toString()
  const res = await fetch(`${API_BASE_URL}/api/warehouses?${qs}`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Depolar alınamadı'))
  }
  const json = await res.json()
  return (json?.data ?? []) as WarehouseDto[]
}

export async function fetchWarehousesDropdown(opts?: { signal?: AbortSignal }): Promise<WarehouseDropdownItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/warehouses/dropdown`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Depolar alınamadı'))
  }
  const json = await res.json()
  return (json?.data ?? []) as WarehouseDropdownItem[]
}

export async function fetchWarehousesDropdownForStock(opts?: { signal?: AbortSignal }): Promise<WarehouseDropdownItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/warehouses/dropdown-for-stock`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Depolar alınamadı'))
  }
  const json = await res.json()
  return (json?.data ?? []) as WarehouseDropdownItem[]
}

export async function fetchAuthorizedWarehousesDropdown(opts?: { signal?: AbortSignal }): Promise<WarehouseDropdownItem[]> {
  const res = await fetch(`${API_BASE_URL}/api/warehouses/authorized-dropdown`, { headers: buildHeaders(false), signal: opts?.signal })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Depolar alınamadı'))
  }
  const json = await res.json()
  return (json?.data ?? []) as WarehouseDropdownItem[]
}

export async function fetchAuthorizedStockBalances(
  stockCodes: string[],
  opts?: { signal?: AbortSignal; includeAll?: boolean }
): Promise<AuthorizedStockBalancesResponse> {
  const codes = (stockCodes ?? [])
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .filter((x, idx, arr) => arr.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === idx)
    .slice(0, 200)

  const qs = new URLSearchParams()
  if (codes.length > 0) qs.set('stockCodes', codes.join(','))
  // Pasif depolar + gerçek (maskesiz) rakam. Sunucu yalnız tam stok yetkisi olan
  // kullanıcıda dikkate alır; yetkisizde varsayılan davranış sürer.
  if (opts?.includeAll) qs.set('includeAll', 'true')

  const res = await fetch(`${API_BASE_URL}/api/warehouses/authorized-stock-balances?${qs.toString()}`, {
    headers: buildHeaders(false),
    signal: opts?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Depo stokları alınamadı'))
  }
  const json = await res.json()
  return (json?.data ?? {}) as AuthorizedStockBalancesResponse
}

export async function fetchWarehouseInventoryForStock(
  warehouseCode: number,
  params?: { from?: string | null; to?: string | null; q?: string | null },
  opts?: { signal?: AbortSignal }
): Promise<WarehouseInventoryResponse> {
  const code = Number(warehouseCode)
  if (!Number.isFinite(code) || code === 0) throw new Error('Geçersiz depo kodu')
  const qs = new URLSearchParams()
  if (params?.from) qs.set('from', params.from)
  if (params?.to) qs.set('to', params.to)
  if (params?.q) qs.set('q', params.q)

  const res = await fetch(`${API_BASE_URL}/api/warehouses/${encodeURIComponent(String(code))}/inventory-for-stock?${qs.toString()}`, {
    headers: buildHeaders(false),
    signal: opts?.signal
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Depo envanteri alınamadı'))
  }
  const json = await res.json()
  return (json?.data ?? {}) as WarehouseInventoryResponse
}

export async function createWarehouse(payload: WarehouseDto): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/warehouses`, { method: 'POST', headers: buildHeaders(true), body: JSON.stringify(payload) })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Depo oluşturulamadı'))
  }
}

export async function updateWarehouse(warehouseCode: number, payload: WarehouseDto): Promise<void> {
  const code = Number(warehouseCode)
  if (!Number.isFinite(code) || code === 0) throw new Error('Geçersiz depo kodu')
  const res = await fetch(`${API_BASE_URL}/api/warehouses/${encodeURIComponent(String(code))}`, {
    method: 'PUT',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Depo güncellenemedi'))
  }
}

export async function deleteWarehouse(warehouseCode: number): Promise<void> {
  const code = Number(warehouseCode)
  if (!Number.isFinite(code) || code === 0) throw new Error('Geçersiz depo kodu')
  const res = await fetch(`${API_BASE_URL}/api/warehouses/${encodeURIComponent(String(code))}`, {
    method: 'DELETE',
    headers: buildHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Depo silinemedi'))
  }
}
