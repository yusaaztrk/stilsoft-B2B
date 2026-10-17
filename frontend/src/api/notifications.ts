import { API_BASE_URL } from '../config/api'
import { redirectToLogin } from '../auth/redirectToLogin'

export type NotificationResponse = {
  id: number
  userId: number
  userDisplayName: string
  userUsername: string
  title: string
  content: string
  isRead: boolean
  readTime: string | null
  isPopup: boolean
  senderName: string
  createTime: string
  createUser: string
}

export type CreateNotificationRequest = {
  target?: string | null
  targets?: string[] | null
  targetUserId?: number | null
  title: string
  content: string
  isPopup: boolean
}

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
    throw new Error('Oturum süresi doldu. Lütfen tekrar giriş yapın.')
  }
}

function getFriendlyError(text: string, status: number) {
  const t = String(text ?? '').trim()
  if (!t) return `İşlem gerçekleştirilemedi (${status})`
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t)
      const m = j?.message || j?.error || j?.title
      if (typeof m === 'string' && m.trim()) return m.trim()
    } catch {
      return `İşlem gerçekleştirilemedi (${status})`
    }
  }
  return t
}

export async function fetchNotifications(): Promise<NotificationResponse[]> {
  const res = await fetch(`${API_BASE_URL}/api/Notifications`, {
    headers: buildHeaders(false)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(getFriendlyError(text, res.status))
  }

  const json = await res.json()
  return (json?.data ?? []) as NotificationResponse[]
}

export async function fetchUnreadNotificationsCount(): Promise<number> {
  const res = await fetch(`${API_BASE_URL}/api/Notifications/unread-count`, {
    headers: buildHeaders(false)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(getFriendlyError(text, res.status))
  }

  const json = await res.json()
  return Number(json?.count ?? 0)
}

export async function fetchSentNotifications(): Promise<NotificationResponse[]> {
  const res = await fetch(`${API_BASE_URL}/api/Notifications/sent`, {
    headers: buildHeaders(false)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(getFriendlyError(text, res.status))
  }

  const json = await res.json()
  return (json?.data ?? []) as NotificationResponse[]
}

export async function sendNotification(payload: CreateNotificationRequest): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE_URL}/api/Notifications`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify(payload)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(getFriendlyError(text, res.status))
  }

  const json = await res.json()
  return { message: String(json?.message ?? 'Bildirim başarıyla gönderildi') }
}

export async function markNotificationAsRead(id: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/Notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    headers: buildHeaders(false)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(getFriendlyError(text, res.status))
  }
}

export async function markAllNotificationsAsRead(): Promise<number> {
  const res = await fetch(`${API_BASE_URL}/api/Notifications/mark-all-read`, {
    method: 'POST',
    headers: buildHeaders(false)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(getFriendlyError(text, res.status))
  }

  const json = await res.json()
  return Number(json?.count ?? 0)
}

export async function deleteNotification(id: number): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/Notifications/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: buildHeaders(false)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(getFriendlyError(text, res.status))
  }
}

export type TargetOptionsData = {
  users: Array<{
    id: number
    unvan: string
    username: string
    roleId: number
    roleName: string
    carikodu: string | null
    isActive: boolean
  }>
  roles: Array<{
    id: number
    code: string
    name: string
    displayName: string
    isActive: boolean
    userCount: number
  }>
  priceGroups: Array<{
    id: string
    code: string
    name: string
    isActive: boolean
    userCount: number
  }>
  totalActiveUsers: number
}

export async function fetchTargetOptions(): Promise<TargetOptionsData> {
  const res = await fetch(`${API_BASE_URL}/api/Notifications/target-options`, {
    headers: buildHeaders(false)
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(getFriendlyError(text, res.status))
  }

  const json = await res.json()
  return json?.data as TargetOptionsData
}

export async function resolveRecipients(targets: string[]): Promise<number> {
  const res = await fetch(`${API_BASE_URL}/api/Notifications/resolve-recipients`, {
    method: 'POST',
    headers: buildHeaders(true),
    body: JSON.stringify({ targets })
  })

  await handleUnauthorized(res)

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(getFriendlyError(text, res.status))
  }

  const json = await res.json()
  return Number(json?.uniqueRecipientCount ?? 0)
}

