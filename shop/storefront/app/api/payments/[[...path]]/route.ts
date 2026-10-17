import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/session'

const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

/**
 * Ödeme çağrılarının köprüsü — sepetinkiyle aynı gerekçe: oturum anahtarı httpOnly çerezde
 * duruyor ve yalnızca sunucu okuyabiliyor.
 *
 * Kart bilgisi buradan GEÇER ama hiçbir yere YAZILMAZ: ne log'a, ne çereze, ne de yanıta.
 * Bu yüzden istek gövdesi olduğu gibi iletiliyor, açılıp incelenmiyor.
 */
async function forward(request: Request, path: string[] | undefined, method: string) {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value

  if (!token) {
    return NextResponse.json({ message: 'Giriş yapmanız gerekiyor.' }, { status: 401 })
  }

  const suffix = path && path.length > 0 ? `/${path.map(encodeURIComponent).join('/')}` : ''
  const query = new URL(request.url).search
  const body = method === 'GET' ? undefined : await request.text()

  const res = await fetch(`${API}/api/payments${suffix}${query}`, {
    method,
    headers: {
      'X-Shop-Session': token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
    cache: 'no-store',
  })

  const data = await res.json().catch(() => null)
  return NextResponse.json(data ?? {}, { status: res.status })
}

export async function GET(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return forward(request, (await ctx.params).path, 'GET')
}

export async function POST(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return forward(request, (await ctx.params).path, 'POST')
}
