import { API_BASE_URL } from '../config'
import { apiJson } from './client'

export type LoginRequest = {
  tenantCode: string
  username: string
  password: string
}

export type LoginResponse = {
  accessToken: string
  expiresAt: string
  user: {
    id: string
    name: string
    role: string
    technicianId?: string
    dealerCode?: string
  }
  tenantCode: string
  username: string
}

export async function login(req: LoginRequest): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    // Firma başlığı giriş isteğinde de gönderiliyor: sunucu firma veritabanını buradan seçiyor.
    // Başlıksız istekte varsayılan veritabanına düşülüyor ve firmanın kendi kullanıcıları
    // (özellikle ServiceOps'ta tanımlı teknisyenler) hiç bulunamıyordu.
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Code': req.tenantCode },
    body: JSON.stringify({
      tenantCode: req.tenantCode,
      username: req.username,
      password: req.password
    })
  })

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(t || `Login başarısız (${res.status})`)
  }

  const json = await res.json().catch(() => null)
  if (!json?.accessToken) throw new Error('Login başarısız')

  return {
    accessToken: String(json.accessToken),
    expiresAt: String(json.expiresAt ?? ''),
    user: {
      id: String(json?.user?.id ?? ''),
      name: String(json?.user?.name ?? req.username),
      role: String(json?.user?.role ?? 'User'),
      technicianId: json?.user?.technicianId ? String(json.user.technicianId) : undefined,
      dealerCode: json?.user?.dealerCode ? String(json.user.dealerCode) : undefined,
    },
    tenantCode: String(req.tenantCode),
    username: String(req.username)
  }
}

// technicianLogin KALDIRILDI: /api/auth/technician-login ucu artik yok. Teknisyenler de
// normal login() ile giriyor -- o yol zaten B2B uzerinden dogruluyor ve teknisyen bagini kuruyor.

export async function me() {
  return await apiJson<{ id?: string; name?: string; role?: string; tenantCode?: string; technicianId?: string }>('/api/auth/me')
}
