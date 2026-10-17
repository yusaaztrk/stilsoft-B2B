import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type CustomerDto = {
  customerCode: string
  name: string
  address?: string | null
  city?: string | null
  district?: string | null
  phone?: string | null
  fax?: string | null
  email?: string | null
  taxOffice?: string | null
  taxNumber?: string | null
  identityNumber?: string | null
  customerType?: string
  invoiceType?: string
  productCategory?: string | null
  categoryAccessMode?: 'All' | 'Custom' | number
  productCategoryIds?: string[]
  isActive?: boolean
  priceGroupId?: string | null
  discountRate?: number
  salesmanCode?: string | null
  creditLimit?: number
  /** Para birimi basina ayri kredi limiti (2026-08-19); cevrim yapilmaz. */
  creditLimitUsd?: number
  creditLimitEur?: number
  creditLimitGbp?: number
  parentCustomerCode?: string | null
  currencyTypeId?: number
}

export async function fetchNextCustomerCode(
  customerType: string,
  opts?: { parentCustomerCode?: string; signal?: AbortSignal }
): Promise<string> {
  const t = String(customerType ?? '').trim()
  if (!t) throw new Error('Cari tipi seçiniz')
  const sp = new URLSearchParams({ customerType: t })
  const parent = String(opts?.parentCustomerCode ?? '').trim()
  if (parent) sp.set('parentCustomerCode', parent)
  const res = await request(`/api/customers/next-code?${sp}`, { signal: opts?.signal })
  const json = await res.json().catch(() => null)
  const code = String(json?.data?.customerCode ?? '').trim()
  if (!code) throw new Error('Cari kodu üretilemedi')
  return code
}

function getToken() {
  return localStorage.getItem('accessToken')
}

function getFriendlyError(text: string, status: number) {
  const t = String(text ?? '').trim()
  if (!t) return `İşlem başarısız (${status})`

  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      if (j?.errors) {
        const parts: string[] = []
        if (j.detail) parts.push(j.detail)
        for (const [field, messages] of Object.entries(j.errors)) {
          const list = Array.isArray(messages) ? messages : [messages]
          for (const m of list) {
            if (m) parts.push(String(m))
          }
        }
        if (parts.length > 0) return parts.join('\n')
      }
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `İşlem başarısız (${status})`
    }
  }

  return t
}

async function request(path: string, init?: { signal?: AbortSignal }) {
  const token = getToken()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    signal: init?.signal,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('userName')
      sessionStorage.removeItem('userName')
      if (typeof window !== 'undefined') redirectToLogin()
      throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
    }

    const text = await res.text().catch(() => '')
    const err = new Error(getFriendlyError(text, res.status)) as Error & { status?: number }
    err.status = res.status
    throw err
  }

  return res
}

export async function fetchCustomers(opts?: { q?: string; includeInactive?: boolean; signal?: AbortSignal }): Promise<CustomerDto[]> {
  const q = String(opts?.q ?? '').trim()
  const includeInactive = Boolean(opts?.includeInactive)
  const sp = new URLSearchParams()
  if (q) sp.set('q', q)
  sp.set('includeInactive', String(includeInactive))

  const res = await request(`/api/customers?${sp.toString()}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as CustomerDto[]
}

export async function fetchCustomersDropdown(opts?: {
  q?: string
  includeInactive?: boolean
  includeMuhtelif?: boolean
  salesmanCode?: string
  forOrder?: boolean
  /** 0/verilmezse sinirsiz. Arama kutusu sinir gonderir; listeyi tumuyle isteyen ekranlar gondermez. */
  limit?: number
  /**
   * YALNIZCA SECIM ICIN GEREKEN ALANLAR (kod, ad, ust cari, cari tipi, plasiyer).
   *
   * Uc satir basina 25 alan donduruyor (adres, e-posta, vergi, dort kredi limiti...) ve tam
   * liste canlida 4,2 MB. Secim kutusu bunlarin hicbirini kullanmiyor. Bayragi GONDERMEYEN
   * cagiran eskisi gibi tam kaydi alir — secilen carinin adres/telefon/e-postasina ihtiyaci
   * olan ekranlar o kaydi ayrica cekmeli.
   */
  lite?: boolean
  /**
   * Cari TIPINE gore suzer ('Hizmet', 'Bayi', 'Musteri'...). Sunucu `CustomerType` alanina
   * bakar; KOD ONEKINE degil. Onek varsayimi firmadan firmaya tutmuyor — hizmet carileri
   * bu firmada 770-01, 120-07 ise Calisan. Gonderilmezse hicbir sey degismez.
   */
  customerType?: string
  signal?: AbortSignal
}): Promise<CustomerDto[]> {
  const q = String(opts?.q ?? '').trim()
  const includeInactive = Boolean(opts?.includeInactive)
  const includeMuhtelif = Boolean(opts?.includeMuhtelif)
  const salesmanCode = String(opts?.salesmanCode ?? '').trim()
  const forOrder = Boolean(opts?.forOrder)
  const sp = new URLSearchParams({ 
    includeInactive: String(includeInactive), 
    includeMuhtelif: String(includeMuhtelif),
    forOrder: String(forOrder)
  })
  if (q) sp.set('q', q)
  if (salesmanCode) sp.set('salesmanCode', salesmanCode)
  const customerType = String(opts?.customerType ?? '').trim()
  if (customerType) sp.set('customerType', customerType)
  if (opts?.limit && opts.limit > 0) sp.set('limit', String(opts.limit))
  if (opts?.lite) sp.set('lite', 'true')
  const res = await request(`/api/customers/dropdown?${sp.toString()}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as CustomerDto[]
}

export async function fetchDealers(opts?: { q?: string; includeInactive?: boolean; type?: string; limit?: number; signal?: AbortSignal }): Promise<CustomerDto[]> {
  const q = String(opts?.q ?? '').trim()
  const includeInactive = Boolean(opts?.includeInactive)
  const type = String(opts?.type ?? '').trim()
  const sp = new URLSearchParams()
  if (q) sp.set('q', q)
  sp.set('includeInactive', String(includeInactive))
  if (type) sp.set('type', type)
  if (opts?.limit && opts.limit > 0) sp.set('limit', String(opts.limit))

  const res = await request(`/api/customers/dealers?${sp.toString()}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as CustomerDto[]
}

export async function fetchEndCustomers(opts?: { q?: string; includeInactive?: boolean; includeDealers?: boolean; limit?: number; signal?: AbortSignal }): Promise<CustomerDto[]> {
  const q = String(opts?.q ?? '').trim()
  const includeInactive = Boolean(opts?.includeInactive)
  const sp = new URLSearchParams()
  if (q) sp.set('q', q)
  sp.set('includeInactive', String(includeInactive))
  // Bayiler yalnizca istenirse gelir; varsayilan kapali (bkz. GetEndCustomers).
  if (opts?.includeDealers) sp.set('includeDealers', 'true')
  if (opts?.limit && opts.limit > 0) sp.set('limit', String(opts.limit))

  const res = await request(`/api/customers/end-customers?${sp.toString()}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? []) as CustomerDto[]
}

export async function fetchCustomerByCode(customerCode: string, opts?: { signal?: AbortSignal }): Promise<CustomerDto | null> {
  const code = String(customerCode ?? '').trim()
  if (!code) return null
  const res = await request(`/api/customers/by-code/${encodeURIComponent(code)}`, { signal: opts?.signal })
  const json = await res.json()
  return (json?.data ?? null) as CustomerDto | null
}

export type CreateCustomerPayload = {
  customerCode: string
  name: string
  phone?: string
  address?: string
  city?: string
  district?: string
  taxOffice?: string
  taxNumber?: string
  priceGroupId?: string
  /** Carinin plasiyeri. Verilmezse alan boş kalır; eski çağrılar etkilenmez. */
  salesmanCode?: string
  creditLimit?: number
}

export async function createEndCustomer(payload: CreateCustomerPayload, opts?: { signal?: AbortSignal }): Promise<CustomerDto> {
  const token = getToken()
  const res = await fetch(`${API_BASE_URL}/api/customers`, {
    method: 'POST',
    signal: opts?.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      customerCode: String(payload.customerCode ?? '').trim(),
      name: String(payload.name ?? '').trim(),
      address: String(payload.address ?? '').trim() || undefined,
      city: String(payload.city ?? '').trim() || undefined,
      district: String(payload.district ?? '').trim() || undefined,
      phone: String(payload.phone ?? '').trim() || undefined,
      taxOffice: String(payload.taxOffice ?? '').trim() || undefined,
      taxNumber: String(payload.taxNumber ?? '').trim() || undefined,
      customerType: 'müşteri',
      invoiceType: 'FATURA',
      isActive: true,
      priceGroupId: String(payload.priceGroupId ?? '').trim() || undefined,
      salesmanCode: String(payload.salesmanCode ?? '').trim() || undefined,
      discountRate: 0,
      creditLimit: payload.creditLimit ?? 0,
      currencyTypeId: 1,
      productCategoryIds: []
    })
  })

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('userName')
      sessionStorage.removeItem('userName')
      if (typeof window !== 'undefined') redirectToLogin()
      throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
    }

    const text = await res.text().catch(() => '')
    throw new Error(getFriendlyError(text, res.status))
  }

  const json = await res.json()
  return (json?.data ?? null) as CustomerDto
}

export type UpdateCustomerPayload = {
  name: string
  phone?: string
  address?: string
  city?: string
  district?: string
  taxOffice?: string
  taxNumber?: string
  priceGroupId?: string
  customerType?: string
  invoiceType?: string
}

export async function updateEndCustomer(customerCode: string, payload: UpdateCustomerPayload, opts?: { signal?: AbortSignal }): Promise<CustomerDto> {
  const code = String(customerCode ?? '').trim()
  if (!code) throw new Error('Geçersiz cari kodu')

  const token = getToken()
  const res = await fetch(`${API_BASE_URL}/api/customers/${encodeURIComponent(code)}`, {
    method: 'PUT',
    signal: opts?.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      name: String(payload.name ?? '').trim(),
      address: String(payload.address ?? '').trim() || undefined,
      city: String(payload.city ?? '').trim() || undefined,
      district: String(payload.district ?? '').trim() || undefined,
      phone: String(payload.phone ?? '').trim() || undefined,
      taxOffice: String(payload.taxOffice ?? '').trim() || undefined,
      taxNumber: String(payload.taxNumber ?? '').trim() || undefined,
      customerType: String(payload.customerType ?? 'müşteri').trim(),
      invoiceType: String(payload.invoiceType ?? 'FATURA').trim(),
      isActive: true,
      priceGroupId: String(payload.priceGroupId ?? '').trim() || undefined,
      discountRate: 0,
      creditLimit: 0,
      currencyTypeId: 1,
      productCategoryIds: []
    })
  })

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('userName')
      sessionStorage.removeItem('userName')
      if (typeof window !== 'undefined') redirectToLogin()
      throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
    }

    const text = await res.text().catch(() => '')
    throw new Error(getFriendlyError(text, res.status))
  }

  const json = await res.json()
  return (json?.data ?? null) as CustomerDto
}

export type QuickContactPayload = {
  email?: string
  phone?: string
  authorizedPerson?: string
  authorizedPhone?: string
}

export async function updateCustomerQuickContact(
  customerCode: string,
  payload: QuickContactPayload,
  opts?: { signal?: AbortSignal }
): Promise<{ success: boolean; message?: string }> {
  const code = String(customerCode ?? '').trim()
  if (!code) throw new Error('Geçersiz cari kodu')

  const token = getToken()
  const res = await fetch(`${API_BASE_URL}/api/customers/${encodeURIComponent(code)}/quick-contact`, {
    method: 'PUT',
    signal: opts?.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      email: payload.email?.trim() || undefined,
      phone: payload.phone?.trim() || undefined,
      authorizedPerson: payload.authorizedPerson?.trim() || undefined,
      authorizedPhone: payload.authorizedPhone?.trim() || undefined
    })
  })

  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      localStorage.removeItem('userName')
      sessionStorage.removeItem('userName')
      if (typeof window !== 'undefined') redirectToLogin()
      throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
    }

    const text = await res.text().catch(() => '')
    throw new Error(getFriendlyError(text, res.status))
  }

  const json = await res.json().catch(() => ({ success: true }))
  return json
}

