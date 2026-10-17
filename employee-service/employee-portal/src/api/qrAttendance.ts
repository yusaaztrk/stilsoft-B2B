import { API_BASE_URL } from '../config/api'

function friendlyError(text: string, status: number, fallback: string) {
  const t = String(text ?? '').trim()
  if (!t) return `${fallback} (${status})`
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `${fallback} (${status})`
    }
  }
  return t
}

export async function qrCheckIn(payload: { tenant: string; username: string; password: string; latitude: number; longitude: number; accuracy?: number }) {
  const res = await fetch(`${API_BASE_URL}/api/Qr/check-in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Code': payload.tenant
    },
    body: JSON.stringify({
      username: payload.username,
      password: payload.password,
      latitude: payload.latitude,
      longitude: payload.longitude,
      accuracy: payload.accuracy ?? null
    })
  })

  const t = await res.text().catch(() => '')
  const json = t ? (() => {
    try {
      return JSON.parse(t)
    } catch {
      return null
    }
  })() : null

  if (!res.ok) throw new Error(friendlyError(t, res.status, 'QR giriş başarısız'))
  if (json?.success === false) throw new Error(String(json?.message ?? 'QR giriş başarısız'))
  return json
}

export async function qrCheckOut(payload: { tenant: string; username: string; password: string; latitude: number; longitude: number; accuracy?: number }) {
  const res = await fetch(`${API_BASE_URL}/api/Qr/check-out`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Code': payload.tenant
    },
    body: JSON.stringify({
      username: payload.username,
      password: payload.password,
      latitude: payload.latitude,
      longitude: payload.longitude,
      accuracy: payload.accuracy ?? null
    })
  })

  const t = await res.text().catch(() => '')
  const json = t ? (() => {
    try {
      return JSON.parse(t)
    } catch {
      return null
    }
  })() : null

  if (!res.ok) throw new Error(friendlyError(t, res.status, 'QR çıkış başarısız'))
  if (json?.success === false) throw new Error(String(json?.message ?? 'QR çıkış başarısız'))
  return json
}
