import { NextResponse } from 'next/server'

const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

/** Servis sayfasındaki formun köprüsü. Oturum gerektirmiyor. */
export async function POST(request: Request) {
  const res = await fetch(`${API}/api/contact/service-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await request.text(),
  })

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    return NextResponse.json(
      { message: data?.message ?? 'Talebiniz gönderilemedi. Lütfen tekrar deneyin.' },
      { status: res.status },
    )
  }

  return NextResponse.json({ success: true })
}
