const COMPARISON_KEY = 'ecom_comparison_list_v1'

export interface ComparisonItem {
  tenantCode: string
  productId: string
}

export function getComparisonList(): ComparisonItem[] {
  try {
    const raw = localStorage.getItem(COMPARISON_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveComparisonList(list: ComparisonItem[]) {
  localStorage.setItem(COMPARISON_KEY, JSON.stringify(list))
  // Dispatch custom event to notify other components/Shell of updates
  window.dispatchEvent(new Event('comparison-updated'))
}

export function addToComparison(tenantCode: string, productId: string): { success: boolean; message: string } {
  const list = getComparisonList()
  const exists = list.some(x => x.productId === productId && x.tenantCode === tenantCode)
  if (exists) {
    return { success: false, message: 'Bu ürün zaten karşılaştırma listesinde var.' }
  }
  if (list.length >= 4) {
    return { success: false, message: 'En fazla 4 ürünü karşılaştırabilirsiniz.' }
  }
  list.push({ tenantCode, productId })
  saveComparisonList(list)
  return { success: true, message: 'Ürün karşılaştırma listesine eklendi.' }
}

export function removeFromComparison(tenantCode: string, productId: string) {
  const list = getComparisonList()
  const nextList = list.filter(x => !(x.productId === productId && x.tenantCode === tenantCode))
  saveComparisonList(nextList)
}

export function isInComparison(tenantCode: string, productId: string): boolean {
  const list = getComparisonList()
  return list.some(x => x.productId === productId && x.tenantCode === tenantCode)
}

export function clearComparison() {
  saveComparisonList([])
}
