import { API_BASE_URL, buildAuthHeaders, handleUnauthorized, friendlyError } from '../config/api'

/**
 * Enroll face embeddings for an employee.
 * Sends multiple base64-encoded images to the backend.
 */
export async function enrollFace(
  employeeId: number,
  images: string[]
): Promise<{ count: number; failures: string[]; message: string }> {
  const res = await fetch(`${API_BASE_URL}/api/FaceAuth/enroll`, {
    method: 'POST',
    headers: buildAuthHeaders(true),
    body: JSON.stringify({ employeeId, images })
  })
  await handleUnauthorized(res)
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(friendlyError(t, res.status, 'Yüz kaydı oluşturulamadı'))
  }
  const json = await res.json().catch(() => null)
  return {
    count: Number(json?.count ?? 0),
    // Yuzu bulunamayan kareler; kayit kismen basarili olabilir.
    failures: (json?.failures ?? []) as string[],
    message: String(json?.message ?? '')
  }
}

/**
 * Face-based check-in. Camera frame sent as base64.
 */
export async function faceCheckIn(
  imageBase64: string,
  tenant: string,
  location?: { latitude: number; longitude: number; accuracy?: number }
): Promise<{
  success: boolean
  employeeId?: number
  employeeName?: string
  checkInTime?: string
  distance?: number
  message?: string
  code?: string
  rateLimited?: boolean
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
      longitude: location?.longitude ?? 0,
      // Hassasiyet sahte konum tespitinde kullanılır (sunucu: AttendanceSuspicionDetector).
      accuracy: location?.accuracy ?? null
    })
  })

  // 429 = hiz siniri. Govde bos geldigi icin asagidaki akista "yuz eslesmedi" gibi gorunur
  // ve otomatik tarama sonsuza kadar bos yere denemeye devam ederdi. Ayri isaretleniyor.
  if (res.status === 429) {
    return { success: false, rateLimited: true, message: 'Sunucu yogun, birazdan yeniden denenecek.' }
  }

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
    // Sunucu durumu kodla bildirir (2026-10-16): no_face / no_match sessizce yeniden denenir;
    // already_checked_in / already_checked_out / no_open_checkin / location_required /
    // outside_area kullanıcıya gösterilir. Eskiden hepsi "yüz eşleşmedi" gibi yutuluyordu.
    code: json?.code ?? (res.status >= 500 ? 'server_error' : undefined),
    employeeName: json?.employeeName,
    message: json?.message ?? 'Yüz eşleşmedi',
    distance: json?.distance
  }
}

/**
 * Face-based check-out. Camera frame sent as base64.
 */
export async function faceCheckOut(
  imageBase64: string,
  tenant: string,
  location?: { latitude: number; longitude: number; accuracy?: number }
): Promise<{
  success: boolean
  employeeId?: number
  employeeName?: string
  checkOutTime?: string
  /** Çıkış bölge dışından, konumun "konum dışı çıkış" izniyle yapıldı. */
  offsite?: boolean
  distance?: number
  message?: string
  code?: string
  rateLimited?: boolean
}> {
  const res = await fetch(`${API_BASE_URL}/api/FaceAuth/check-out`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Code': tenant
    },
    body: JSON.stringify({
      imageBase64,
      latitude: location?.latitude ?? 0,
      longitude: location?.longitude ?? 0,
      // Hassasiyet sahte konum tespitinde kullanılır (sunucu: AttendanceSuspicionDetector).
      accuracy: location?.accuracy ?? null
    })
  })

  // 429 = hiz siniri. Govde bos geldigi icin asagidaki akista "yuz eslesmedi" gibi gorunur
  // ve otomatik tarama sonsuza kadar bos yere denemeye devam ederdi. Ayri isaretleniyor.
  if (res.status === 429) {
    return { success: false, rateLimited: true, message: 'Sunucu yogun, birazdan yeniden denenecek.' }
  }

  const json = await res.json().catch(() => null)

  if (json?.success && json?.data) {
    return {
      success: true,
      employeeId: json.data.employeeId,
      employeeName: json.data.employeeName,
      checkOutTime: json.data.checkOutTime,
      offsite: Boolean(json.data.offsite),
      distance: json.data.distance
    }
  }

  return {
    success: false,
    // Sunucu durumu kodla bildirir (2026-10-16): no_face / no_match sessizce yeniden denenir;
    // already_checked_in / already_checked_out / no_open_checkin / location_required /
    // outside_area kullanıcıya gösterilir. Eskiden hepsi "yüz eşleşmedi" gibi yutuluyordu.
    code: json?.code ?? (res.status >= 500 ? 'server_error' : undefined),
    employeeName: json?.employeeName,
    message: json?.message ?? 'Yüz eşleşmedi',
    distance: json?.distance
  }
}

/**
 * Check if an employee has face enrollment.
 */
export async function hasFaceEnrollment(employeeId: number): Promise<{ hasFace: boolean; count: number }> {
  const res = await fetch(`${API_BASE_URL}/api/FaceAuth/has-face/${encodeURIComponent(String(employeeId))}`, {
    headers: buildAuthHeaders(false)
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
    headers: buildAuthHeaders(false)
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
      headers: buildAuthHeaders(false)
    })
    if (!res.ok) return false
    const json = await res.json().catch(() => null)
    return json?.success === true
  } catch {
    return false
  }
}
