import { getMemberToken, readApiResponse } from './api'

export type FavoriteKey = {
  tenantCode: string
  productId: string
}

const CACHE_KEY = 'ecom_favorites_cache_v1'

type CacheShape = {
  keys: FavoriteKey[]
  updatedAtUtc: string
}

function normalizeTenantCode(x: string | undefined | null): string {
  return String(x ?? '').trim().toUpperCase()
}

export function makeFavKey(tenantCode: string | undefined, productId: string): string {
  const tc = normalizeTenantCode(tenantCode)
  return `${tc}:${productId}`
}

export function readFavoritesCache(): Set<string> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return new Set()
    const json = JSON.parse(raw) as CacheShape
    const keys = Array.isArray(json?.keys) ? json.keys : []
    const set = new Set<string>()
    for (const k of keys) {
      const tc = normalizeTenantCode((k as any)?.tenantCode)
      const pid = String((k as any)?.productId ?? '').trim()
      if (!tc || !pid) continue
      set.add(`${tc}:${pid}`)
    }
    return set
  } catch {
    return new Set()
  }
}

export function writeFavoritesCache(set: Set<string>) {
  const keys: FavoriteKey[] = Array.from(set.values())
    .map((x) => {
      const [tenantCode, productId] = x.split(':')
      return { tenantCode, productId }
    })
    .filter((x) => x.tenantCode && x.productId)

  const payload: CacheShape = {
    keys,
    updatedAtUtc: new Date().toISOString(),
  }

  localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
}

export function isFavoritedCached(tenantCode: string | undefined, productId: string): boolean {
  const set = readFavoritesCache()
  return set.has(makeFavKey(tenantCode, productId))
}

export async function fetchFavoritesKeys(): Promise<Set<string>> {
  const token = getMemberToken()
  if (!token) throw new Error('Favorileri görmek için giriş yapmalısınız.')

  const res = await fetch('/api/favorites', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await readApiResponse(res)
  if (!res.ok || !json?.success) throw new Error(json?.message || 'Favoriler alınamadı')

  const list = Array.isArray(json?.data) ? json.data : []
  const set = new Set<string>()
  for (const x of list) {
    const tc = normalizeTenantCode(x?.tenantCode)
    const pid = String(x?.id ?? '').trim()
    if (!tc || !pid) continue
    set.add(`${tc}:${pid}`)
  }
  writeFavoritesCache(set)
  return set
}

export async function toggleFavorite(tenantCode: string | undefined, productId: string): Promise<boolean> {
  const token = getMemberToken()
  if (!token) throw new Error('Favorilere eklemek için giriş yapmalısınız.')

  const tc = normalizeTenantCode(tenantCode)
  const pid = String(productId ?? '').trim()
  if (!tc) throw new Error('Tenant bilgisi bulunamadı.')
  if (!pid) throw new Error('Ürün bilgisi bulunamadı.')

  const res = await fetch('/api/favorites/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tenantCode: tc, productId: pid }),
  })

  const json = await readApiResponse(res)
  if (!res.ok || !json?.success) throw new Error(json?.message || 'Favori güncellenemedi')

  const isFavorited = Boolean(json?.data?.isFavorited)

  const set = readFavoritesCache()
  const key = `${tc}:${pid}`
  if (isFavorited) set.add(key)
  else set.delete(key)
  writeFavoritesCache(set)

  return isFavorited
}
