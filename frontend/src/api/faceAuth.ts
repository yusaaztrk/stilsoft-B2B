import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

function buildHeaders(includeJson: boolean) {
  const headers: Record<string, string> = {}
  if (includeJson) headers['Content-Type'] = 'application/json'
  const token = localStorage.getItem('accessToken')
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function handleUnauthorized(res: Response) {
  if (res.status === 401) {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
    localStorage.removeItem('userName')
    sessionStorage.removeItem('userName')
    if (typeof window !== 'undefined') redirectToLogin()
  }
}

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

/**
 * Enroll face embeddings for an employee.
 * Sends multiple base64-encoded images to the backend.
 */
export async function enrollFace(employeeId: number, images: string[]): Promise<{ count: number }> {
  const res = await fetch(`${API_BASE_URL}/api/FaceAuth/enroll`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify({ employeeId, images })
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Yüz kaydı oluşturulamadı'))
  }
  const json = await res.json().catch(() => null)
  return { count: json?.count ?? 0 }
}

/**
 * Face-based check-in. Camera frame sent as base64.
 */
export async function faceCheckIn(
  imageBase64: string,
  tenant: string,
  location?: { latitude: number; longitude: number }
): Promise<{
  success: boolean
  employeeId?: number
  employeeName?: string
  checkInTime?: string
  distance?: number
  message?: string
}> {
  const res = await fetch(`${API_BASE_URL}/api/FaceAuth/check-in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Code': tenant
    },
    body: JSON.stringify({
      imageBase64,
      latitude: location?.latitude ?? 0,
      longitude: location?.longitude ?? 0
    })
  })

  const json = await res.json().catch(() => null)

  if (json?.success && json?.data) {
    return {
      success: true,
      employeeId: json.data.employeeId,
      employeeName: json.data.employeeName,
      checkInTime: json.data.checkInTime,
      distance: json.data.distance
    }
  }

  return {
    success: false,
    message: json?.message ?? 'Yüz eşleşmedi',
    distance: json?.distance
  }
}

/**
 * Check if an employee has face enrollment.
 */
export async function hasFaceEnrollment(employeeId: number): Promise<{ hasFace: boolean; count: number }> {
  const res = await fetch(`${API_BASE_URL}/api/FaceAuth/has-face/${encodeURIComponent(String(employeeId))}`, {
    headers: buildHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) return { hasFace: false, count: 0 }
  const json = await res.json().catch(() => null)
  return { hasFace: json?.hasFace ?? false, count: json?.count ?? 0 }
}

/**
 * Delete all face embeddings for an employee (KVKK right to erasure).
 */
export async function deleteFaceEnrollment(employeeId: number): Promise<{ deletedCount: number }> {
  const res = await fetch(`${API_BASE_URL}/api/FaceAuth/embeddings/${encodeURIComponent(String(employeeId))}`, {
    method: 'DELETE',
    headers: buildHeaders(false)
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Yüz kaydı silinemedi'))
  }
  const json = await res.json().catch(() => null)
  return { deletedCount: json?.deletedCount ?? 0 }
}

/**
 * Check face service health.
 */
export async function checkFaceServiceHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/FaceAuth/service-health`, {
      headers: buildHeaders(false)
    })
    if (!res.ok) return false
    const json = await res.json().catch(() => null)
    return json?.success === true
  } catch {
    return false
  }
}
