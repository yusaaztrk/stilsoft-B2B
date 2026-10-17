export type ProductCategoryState = {
  mains: string[]
  subsByMain: Record<string, string[]>
}

const STORAGE_KEY = 'product_categories_v2'
const EVENT_NAME = 'productCategoriesChanged'

function toKey(s: string) {
  return s
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

export function getDefaultProductCategories(): ProductCategoryState {
  const mains = ['DEMO', 'YATAKBAZA', 'BYZ-ESYA']
  const subsByMain: Record<string, string[]> = {
    DEMO: ['G.HAZIR', 'I.HAZIR', 'EV.GEREC', 'EV.TEMIZ', 'K.BAKIM', 'UTU'],
    YATAKBAZA: ['SILTE', 'BASLIK', 'BAZA', 'TEKSTIL'],
    'BYZ-ESYA': ['KLIMA', 'SEBIL', 'ANKASTRE', 'CAM.MAK', 'BUZDLB', 'DRN.DON', 'BUL-MAK', 'SOLO', 'ELEKTRO']
  }

  return { mains, subsByMain }
}

export function loadProductCategories(): ProductCategoryState {
  const fallback = getDefaultProductCategories()
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    const mains: string[] = Array.isArray(parsed?.mains) ? parsed.mains.map((x: any) => String(x ?? '')).filter(Boolean) : []
    const subsByMainRaw = parsed?.subsByMain
    const subsByMain: Record<string, string[]> = {}

    if (subsByMainRaw && typeof subsByMainRaw === 'object') {
      Object.keys(subsByMainRaw).forEach((k) => {
        const arr = (subsByMainRaw as any)[k]
        if (!Array.isArray(arr)) return
        subsByMain[String(k)] = arr.map((x: any) => String(x ?? '')).filter(Boolean)
      })
    }

    const normalizedMains = mains.map((m) => m.trim()).filter(Boolean)
    const normalizedSubsByMain: Record<string, string[]> = {}
    normalizedMains.forEach((m) => {
      const subs = (subsByMain[m] ?? []).map((s) => s.trim()).filter(Boolean)
      normalizedSubsByMain[m] = subs.length > 0 ? subs : [m]
    })

    if (normalizedMains.length === 0) return fallback
    return { mains: normalizedMains, subsByMain: normalizedSubsByMain }
  } catch {
    return fallback
  }
}

export function saveProductCategories(state: ProductCategoryState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  try {
    window.dispatchEvent(new Event(EVENT_NAME))
  } catch {
    // ignore
  }
}

export function onProductCategoriesChanged(handler: () => void) {
  window.addEventListener(EVENT_NAME, handler)
  return () => window.removeEventListener(EVENT_NAME, handler)
}

export function addMainCategory(name: string) {
  const n = toKey(name)
  if (!n) return loadProductCategories()
  const current = loadProductCategories()
  const exists = current.mains.some((x) => toKey(x) === n)
  if (exists) return current

  const nextMains = [...current.mains, n]
  const nextSubs = { ...current.subsByMain, [n]: [n] }
  const next = { mains: nextMains, subsByMain: nextSubs }
  saveProductCategories(next)
  return next
}

export function renameMainCategory(oldName: string, newName: string) {
  const from = toKey(oldName)
  const to = toKey(newName)
  const current = loadProductCategories()
  if (!from || !to) return current
  if (from === to) return current

  const nextMains = current.mains.map((m) => (toKey(m) === from ? to : m))
  const nextSubs: Record<string, string[]> = {}
  nextMains.forEach((m) => {
    const originalKey = current.mains.find((x) => toKey(x) === toKey(m))
    if (originalKey && current.subsByMain[originalKey]) {
      nextSubs[m] = current.subsByMain[originalKey]
      return
    }
    if (toKey(m) === to) {
      const oldKey = current.mains.find((x) => toKey(x) === from)
      nextSubs[m] = oldKey ? current.subsByMain[oldKey] ?? [m] : [m]
      return
    }
    nextSubs[m] = current.subsByMain[m] ?? [m]
  })

  const next = { mains: nextMains, subsByMain: nextSubs }
  saveProductCategories(next)
  return next
}

export function addSubCategory(mainName: string, subName: string) {
  const main = toKey(mainName)
  const sub = toKey(subName)
  const current = loadProductCategories()
  if (!main || !sub) return current

  const mainKey = current.mains.find((x) => toKey(x) === main)
  if (!mainKey) return current

  const subs = current.subsByMain[mainKey] ?? []
  if (subs.some((x) => toKey(x) === sub)) return current

  const nextSubs = { ...current.subsByMain, [mainKey]: [...subs, sub] }
  const next = { mains: current.mains, subsByMain: nextSubs }
  saveProductCategories(next)
  return next
}

export function renameSubCategory(mainName: string, oldSub: string, newSub: string) {
  const main = toKey(mainName)
  const from = toKey(oldSub)
  const to = toKey(newSub)
  const current = loadProductCategories()
  if (!main || !from || !to) return current

  const mainKey = current.mains.find((x) => toKey(x) === main)
  if (!mainKey) return current

  const subs = current.subsByMain[mainKey] ?? []
  if (subs.some((x) => toKey(x) === to)) return current

  const nextSubs = subs.map((s) => (toKey(s) === from ? to : s))
  const next = { mains: current.mains, subsByMain: { ...current.subsByMain, [mainKey]: nextSubs } }
  saveProductCategories(next)
  return next
}
