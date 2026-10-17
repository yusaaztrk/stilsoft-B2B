import { NextResponse } from 'next/server'

const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

/** Üyeliksiz sipariş takibi köprüsü — telefon gövdede gider, adres çubuğuna düşmez. */
export async function POST(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip')

  const res = await fetch(`${API}/api/orders/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ip ? { 'X-Client-Ip': ip } : {}) },
    body: await request.text(),
    cache: 'no-store',
  })
  const data = await res.json().catch(() => null)
  return NextResponse.json(data ?? { message: 'Sorgu tamamlanamadı.' }, { status: res.status })
}
