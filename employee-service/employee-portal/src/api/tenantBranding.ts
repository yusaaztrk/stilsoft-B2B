import { API_BASE_URL } from '../config/api'

export interface TenantBrandingDto {
  logoUrl: string | null
  headerGradientFrom: string | null
  headerGradientTo: string | null
  isEcommerceEnabled: boolean
}

export async function fetchPublicBranding(tenantCode: string): Promise<TenantBrandingDto | null> {
  try {
    const code = String(tenantCode ?? '').trim()
    if (!code) return null

    const res = await fetch(`${API_BASE_URL}/api/Tenants/public-branding?tenantCode=${encodeURIComponent(code)}`)
    if (!res.ok) return null

    const json = await res.json()
    if (!json?.success) return null

    return json.data as TenantBrandingDto
  } catch {
    return null
  }
}

export async function fetchBranding(): Promise<TenantBrandingDto | null> {
  try {
    const token = localStorage.getItem('accessToken') ?? ''
    const tenantCode = localStorage.getItem('tenantCode') ?? ''

    const res = await fetch(`${API_BASE_URL}/api/Tenants/branding`, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(tenantCode ? { 'X-Tenant-Code': tenantCode } : {})
      }
    })
    if (!res.ok) return null

    const json = await res.json()
    if (!json?.success) return null

    return json.data as TenantBrandingDto
  } catch {
    return null
  }
}
