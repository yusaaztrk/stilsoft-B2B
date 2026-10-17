export type CategoryMeta = {
  description?: string
  status?: 'active' | 'passive'
}

const STORAGE_KEY = 'product_category_meta_v1'
const EVENT_NAME = 'productCategoriesChanged'

function safeParse(raw: string | null): any {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function loadCategoryMeta(): Record<string, CategoryMeta> {
  const parsed = safeParse(localStorage.getItem(STORAGE_KEY))
  if (!parsed || typeof parsed !== 'object') return {}
  const out: Record<string, CategoryMeta> = {}
  Object.keys(parsed).forEach((k) => {
    const v = (parsed as any)[k]
    if (!v || typeof v !== 'object') return
    const status = v.status === 'passive' ? 'passive' : v.status === 'active' ? 'active' : undefined
    out[String(k)] = {
      description: v.description == null ? undefined : String(v.description),
      status
    }
  })
  return out
}

export function saveCategoryMeta(meta: Record<string, CategoryMeta>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(meta))
  try {
    window.dispatchEvent(new Event(EVENT_NAME))
  } catch {
  }
}

export function upsertCategoryMeta(key: string, patch: CategoryMeta) {
  const current = loadCategoryMeta()
  const prev = current[key] ?? {}
  const next = {
    ...current,
    [key]: {
      description: patch.description == null ? prev.description : patch.description,
      status: patch.status == null ? prev.status : patch.status
    }
  }
  saveCategoryMeta(next)
  return next
}

export function deleteCategoryMeta(key: string) {
  const current = loadCategoryMeta()
  if (!(key in current)) return current
  const next = { ...current }
  delete next[key]
  saveCategoryMeta(next)
  return next
}
