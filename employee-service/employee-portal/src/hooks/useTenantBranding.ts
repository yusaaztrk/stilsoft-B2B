import { useEffect, useState } from 'react'
import { fetchPublicBranding, fetchBranding, type TenantBrandingDto } from '../api/tenantBranding'

export function useTenantBranding(tenantCode?: string) {
  const [branding, setBranding] = useState<TenantBrandingDto | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      setLoading(true)
      try {
        const code = tenantCode || localStorage.getItem('tenantCode') || ''
        let result: TenantBrandingDto | null = null

        if (code) {
          result = await fetchPublicBranding(code)
        }

        if (!result) {
          result = await fetchBranding()
        }

        if (!cancelled) setBranding(result)
      } catch {
        if (!cancelled) setBranding(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [tenantCode])

  return { branding, loading }
}
