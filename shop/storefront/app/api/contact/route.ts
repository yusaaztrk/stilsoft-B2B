import { NextResponse } from 'next/server'

const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

/**
 * İletişim formu köprüsü. Oturum gerektirmiyor — ziyaretçi üye olmadan da mesaj bırakabilmeli.
 */
export async function POST(request: Request) {
  const res = await fetch(`${API}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await request.text(),
  })

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    return NextResponse.json(
      { message: data?.message ?? 'Mesajınız gönderilemedi. Lütfen tekrar deneyin.' },
      { status: res.status },
    )
  }

  return NextResponse.json({ success: true })
}
