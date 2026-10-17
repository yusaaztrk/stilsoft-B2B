import * as React from 'react'
import { fetchProductCategoriesState, fetchProductCategoriesStateForDealer, type ProductCategoryStateResponse } from '../api/productCategories'

export function useProductCategories(opts?: { includeDealer?: boolean; dealerCode?: string }) {
  const [data, setData] = React.useState<ProductCategoryStateResponse>({ mains: [], subsByMain: {}, meta: {} })
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const includeDealer = Boolean(opts?.includeDealer)
      const dealerCode = String(opts?.dealerCode ?? '').trim()
      const next = includeDealer || dealerCode
        ? await fetchProductCategoriesStateForDealer({ includeDealer, dealerCode })
        : await fetchProductCategoriesState()
      setData(next)
    } catch (e: any) {
      setError(String(e?.message ?? 'Kategori bilgileri alınamadı'))
    } finally {
      setLoading(false)
    }
  }, [opts?.dealerCode, opts?.includeDealer])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}
