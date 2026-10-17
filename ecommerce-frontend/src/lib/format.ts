import type { ErpProductListItem } from './api'

export function formatPrice(p: ErpProductListItem): string {
  const sym = (p.currencySymbol ?? '₺').trim() || '₺'
  const v = typeof p.unitPrice === 'number' && Number.isFinite(p.unitPrice) ? p.unitPrice : null
  if (v === null) return `${sym}--`
  return `${sym}${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
