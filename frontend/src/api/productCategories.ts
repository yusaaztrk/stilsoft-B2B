export type ProductCategoryMetaResponse = {
  description?: string | null
  status: 'active' | 'passive'
}

export type ProductCategoryItemDto = {
  id: string
  parentId?: string | null
  key: string
  name: string
  description?: string | null
  isActive: boolean
  sortOrder: number
}

export type ProductCategoryStateResponse = {
  mains: string[]
  subsByMain: Record<string, string[]>
  labels?: Record<string, string>
  meta: Record<string, ProductCategoryMetaResponse>
  items?: ProductCategoryItemDto[]
}

import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

function getToken() {
  return localStorage.getItem('accessToken')
}

type StoredDealer = {
  code: string
  label?: string
}

function safeParseDealer(json: string | null): StoredDealer | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    const code = String(parsed?.code ?? '').trim()
    const label = String(parsed?.label ?? '').trim()
    if (!code) return null
    return { code, label }
  } catch {
    return null
  }
}

function getFriendlyError(text: string, status: number) {
  const t = String(text ?? '').trim()
  if (!t) return `İşlem gerçekleştirilemedi (${status})`

  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const errors = j?.errors
      if (errors && typeof errors === 'object') {
        const entries = Object.entries(errors as Record<string, unknown>)
        for (const [, v] of entries) {
          const arr = Array.isArray(v) ? v : [v]
          const msg = String(arr[0] ?? '').trim()
          if (msg) return msg
        }
      }

      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `İşlem gerçekleştirilemedi (${status})`
    }
  }

  return t
}

async function request(path: string, init?: RequestInit) {
  const token = getToken()
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
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
    throw new Error(getFriendlyError(text, res.status))
  }

  return res
}

function toKeySpace(s: string) {
  return String(s ?? '')
    .trim()
    .toUpperCase()
    .replace(/İ/g, 'I')
    .replace(/ı/g, 'I')
    .replace(/Ğ/g, 'G')
    .replace(/ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/ü/g, 'U')
    .replace(/Ş/g, 'S')
    .replace(/ş/g, 'S')
    .replace(/Ö/g, 'O')
    .replace(/ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/ç/g, 'C')
    .replace(/\s+/g, ' ')
}

function keyVariants(label: string) {
  const raw = String(label ?? '').trim()
  if (!raw) return [] as string[]
  const rawUpper = raw.toUpperCase()
  const rawLower = raw.toLowerCase()
  const normSpace = toKeySpace(raw)
  const normUnderscore = normSpace.replace(/[\s\.-]+/g, '_')
  const normDash = normSpace.replace(/[\s\._]+/g, '-')
  const normDot = normSpace.replace(/[\s\-_]+/g, '.')
  const rawUnderscore = raw.replace(/[\s\.-]+/g, '_')
  const rawDash = raw.replace(/[\s\._]+/g, '-')
  const rawDot = raw.replace(/[\s\-_]+/g, '.')
  return Array.from(new Set([
    raw, rawUpper, rawLower, normSpace, normUnderscore, normDash, normDot,
    rawUnderscore, rawDash, rawDot, rawUnderscore.toUpperCase(), rawDash.toUpperCase(), rawDot.toUpperCase()
  ]))
}

function normalizeState(input: ProductCategoryStateResponse): ProductCategoryStateResponse {
  const initialLabels = (input?.labels ?? {}) as Record<string, string>
  const labels: Record<string, string> = { ...initialLabels }

  for (const [k, v] of Object.entries(initialLabels)) {
    if (!k || !v) continue
    for (const variant of keyVariants(k)) {
      if (!labels[variant]) labels[variant] = v
    }
  }

  const out: ProductCategoryStateResponse = {
    mains: Array.isArray(input?.mains) ? input.mains : [],
    subsByMain: {},
    labels,
    meta: (input?.meta ?? {}) as Record<string, ProductCategoryMetaResponse>,
    items: Array.isArray(input?.items) ? input.items : []
  }

  const src = (input?.subsByMain ?? {}) as Record<string, string[]>
  for (const [k, v] of Object.entries(src)) {
    if (!Array.isArray(v)) continue
    for (const kk of keyVariants(k)) {
      if (!out.subsByMain[kk]) out.subsByMain[kk] = v
    }
  }

  for (const m of out.mains) {
    const existing = Object.keys(out.subsByMain).some((k) => keyVariants(m).includes(k))
    if (!existing) {
      for (const kk of keyVariants(m)) {
        if (!out.subsByMain[kk]) out.subsByMain[kk] = []
      }
    }
  }

  return out
}

export async function fetchProductCategoriesState(): Promise<ProductCategoryStateResponse> {
  const res = await request('/api/productcategories')
  const json = await res.json()
  const data = (json?.data ?? { mains: [], subsByMain: {}, meta: {} }) as ProductCategoryStateResponse
  return normalizeState(data)
}

export async function fetchProductCategoriesStateForDealer(opts?: { includeDealer?: boolean; dealerCode?: string }): Promise<ProductCategoryStateResponse> {
  const includeDealer = Boolean(opts?.includeDealer)
  let dealerCode = String(opts?.dealerCode ?? '').trim()
  if (includeDealer && !dealerCode) {
    const stored = safeParseDealer(localStorage.getItem('selected_dealer_v1'))
    if (stored) dealerCode = stored.code
  }
  const qs = includeDealer && dealerCode ? `?${new URLSearchParams({ dealerCode }).toString()}` : ''
  const res = await request(`/api/productcategories${qs}`)
  const json = await res.json()
  const data = (json?.data ?? { mains: [], subsByMain: {}, meta: {} }) as ProductCategoryStateResponse
  return normalizeState(data)
}

export async function createMainCategory(name: string) {
  await request('/api/productcategories/main', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  })
}

export async function createMainCategoryWithDesc(name: string, description?: string) {
  await request('/api/productcategories/main', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description })
  })
}

export async function createSubCategory(mainName: string, name: string, description?: string) {
  await request('/api/productcategories/sub', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mainName, name, description })
  })
}

export async function updateCategory(
  id: string,
  patch: {
    name: string
    description?: string
    status: 'active' | 'passive'
  }
) {
  await request(`/api/productcategories/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  })
}

export async function deleteCategory(id: string) {
  await request(`/api/productcategories/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  })
}
