import { API_BASE_URL, buildAuthHeaders, handleUnauthorized, friendlyError } from '../config/api'

/*
  PERSONEL FOTOĞRAFI (2026-10-16). Görsel <img src> ile doğrudan istenemez (uç oturum ister); yetkili
  fetch ile blob alınır, sayfa boyunca bellekte tutulur.
*/

const blobCache = new Map<number, Promise<string | null>>()

export async function fetchEmployeePhotoIds(): Promise<Set<number>> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeePhotos`, { headers: buildAuthHeaders() })
  await handleUnauthorized(res)
  if (!res.ok) return new Set()
  const json = await res.json().catch(() => null)
  return new Set(((json?.data ?? []) as any[]).map((x) => Number(x?.employeeId ?? 0)).filter((x) => x > 0))
}

export function fetchEmployeePhotoUrl(employeeId: number): Promise<string | null> {
  const cached = blobCache.get(employeeId)
  if (cached) return cached
  const p = (async () => {
    const res = await fetch(`${API_BASE_URL}/api/EmployeePhotos/${employeeId}`, { headers: buildAuthHeaders() })
    if (!res.ok) return null
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  })().catch(() => null)
  blobCache.set(employeeId, p)
  return p
}

function forget(employeeId: number) {
  const old = blobCache.get(employeeId)
  blobCache.delete(employeeId)
  void old?.then((u) => u && URL.revokeObjectURL(u))
}

/** Dosyayı en uzun kenarı 600 px JPEG'e küçültür (telefon fotoğrafı 5-10 MB gelebiliyor). */
export function resizeImageFile(file: File, maxSide = 600): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Dosya okunamadı'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Görsel açılamadı'))
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Görsel işlenemedi'))
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = String(reader.result ?? '')
    }
    reader.readAsDataURL(file)
  })
}

export async function uploadEmployeePhoto(employeeId: number, file: File): Promise<void> {
  const imageBase64 = await resizeImageFile(file)
  const res = await fetch(`${API_BASE_URL}/api/EmployeePhotos/${employeeId}`, {
    method: 'PUT',
    headers: buildAuthHeaders(true),
    body: JSON.stringify({ imageBase64 })
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Fotoğraf yüklenemedi'))
  }
  forget(employeeId)
}

export async function deleteEmployeePhoto(employeeId: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/EmployeePhotos/${employeeId}`, { method: 'DELETE', headers: buildAuthHeaders() })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Fotoğraf kaldırılamadı'))
  }
  forget(employeeId)
}
