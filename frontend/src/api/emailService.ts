import { API_BASE_URL } from '../config/api'

function getToken() {
  return localStorage.getItem('accessToken')
}

export type SendCariEkstreEmailPayload = {
  toEmail: string
  subject?: string
  customerCode: string
  customerName: string
  fromDate?: string
  toDate?: string
  htmlContent: string
  excelBase64?: string
  excelFileName?: string
}

export async function sendCariEkstreEmail(payload: SendCariEkstreEmailPayload): Promise<{ success: boolean; message: string }> {
  const token = getToken()
  const res = await fetch(`${API_BASE_URL}/api/Email/send-cari-ekstre`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  })

  const json = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(json?.message || `E-posta gönderilemedi (${res.status})`)
  }

  return json
}
