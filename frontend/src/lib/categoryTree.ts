export type CategoryStatus = 'active' | 'passive'

export type CategoryNode = {
  id: string
  name: string
  description?: string
  status: CategoryStatus
  parentId?: string | null
}

const STORAGE_KEY = 'erp_category_tree_v1'
const EVENT_NAME = 'categoryTreeChanged'

function uuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function defaultData(): CategoryNode[] {
  return []
}

export function loadCategoryTree(): CategoryNode[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultData()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return defaultData()
    return parsed
      .map((x) => {
        const status: CategoryStatus = x?.status === 'passive' ? 'passive' : 'active'
        return {
          id: String(x?.id ?? ''),
          name: String(x?.name ?? ''),
          description: x?.description == null ? undefined : String(x.description),
          status,
          parentId: x?.parentId == null ? null : String(x.parentId)
        } satisfies CategoryNode
      })
      .filter((x) => x.id && x.name)
  } catch {
    return defaultData()
  }
}

export function saveCategoryTree(nodes: CategoryNode[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes))
  try {
    window.dispatchEvent(new Event(EVENT_NAME))
  } catch {
  }
}

export function onCategoryTreeChanged(handler: () => void) {
  window.addEventListener(EVENT_NAME, handler)
  return () => window.removeEventListener(EVENT_NAME, handler)
}

export function createRootCategory(payload: { name: string; description?: string; status: CategoryStatus }) {
  const nodes = loadCategoryTree()
  const node: CategoryNode = {
    id: uuid(),
    name: payload.name.trim(),
    description: payload.description?.trim() || undefined,
    status: payload.status,
    parentId: null
  }
  const next = [...nodes, node]
  saveCategoryTree(next)
  return node
}

export function createSubCategory(payload: {
  parentId: string
  name: string
  description?: string
  status?: CategoryStatus
}) {
  const nodes = loadCategoryTree()
  const node: CategoryNode = {
    id: uuid(),
    name: payload.name.trim(),
    description: payload.description?.trim() || undefined,
    status: payload.status ?? 'active',
    parentId: payload.parentId
  }
  const next = [...nodes, node]
  saveCategoryTree(next)
  return node
}

export function updateCategory(id: string, patch: { name?: string; description?: string; status?: CategoryStatus }) {
  const nodes = loadCategoryTree()
  const next = nodes.map((n) => {
    if (n.id !== id) return n
    return {
      ...n,
      name: patch.name == null ? n.name : patch.name.trim(),
      description: patch.description == null ? n.description : patch.description.trim() || undefined,
      status: patch.status == null ? n.status : patch.status
    }
  })
  saveCategoryTree(next)
}

function collectDescendants(nodes: CategoryNode[], rootId: string) {
  const childrenByParent = new Map<string, string[]>()
  nodes.forEach((n) => {
    const p = n.parentId || ''
    const list = childrenByParent.get(p) ?? []
    list.push(n.id)
    childrenByParent.set(p, list)
  })

  const toDelete = new Set<string>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    if (toDelete.has(id)) continue
    toDelete.add(id)
    const kids = childrenByParent.get(id) ?? []
    kids.forEach((k) => stack.push(k))
  }
  return toDelete
}

export function deleteCategorySubtree(id: string) {
  const nodes = loadCategoryTree()
  const del = collectDescendants(nodes, id)
  const next = nodes.filter((n) => !del.has(n.id))
  saveCategoryTree(next)
}

export function getCategoryPath(nodes: CategoryNode[], id: string) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out: CategoryNode[] = []
  let cur = byId.get(id)
  while (cur) {
    out.unshift(cur)
    const pid = cur.parentId || null
    if (!pid) break
    cur = byId.get(pid)
  }
  return out
}
