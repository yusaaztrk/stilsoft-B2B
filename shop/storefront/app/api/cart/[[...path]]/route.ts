import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/session'

const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

async function newGuestSession(): Promise<string | null> {
  try {
    const guestRes = await fetch(`${API}/api/account/guest-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    })
    if (!guestRes.ok) return null
    const guestData = (await guestRes.json()) as { session?: string }
    return guestData?.session ?? null
  } catch {
    return null
  }
}

/**
 * Sepet çağrılarının köprüsü.
 *
 * Ziyaretçi henüz üye girişi yapmamış olsa bile dilediği kadar ürünü sepete ekleyebilir.
 * Oturum çerezi yoksa sunucu anında bir misafir oturumu başlatır ve sepeti korur.
 *
 * Çerez VARSA ama sunucu onu tanımıyorsa (oturum süresi dolmuş, elle sonlandırılmış,
 * kayıt silinmiş) ERP değil mağaza "Oturum bulunamadı" (401) döner. Bu durumu ayrı ele almazsak
 * müşteri kalıcı olarak kilitlenir: taze bir misafir oturumu asla açılmaz, her istek sonsuza
 * kadar 401 döner — çerezini elle silmeyi bilmeyen hiçbir ziyaretçi sepete bir daha ürün
 * ekleyemez (2026-09-05 denetiminde, gerçek tarayıcı testinde bulundu). O yüzden 401 görülürse
 * ölü çerez atılıp taze bir misafir oturumuyla istek BİR KEZ tekrarlanır.
 */
async function forward(request: Request, path: string[] | undefined, method: string) {
  const store = await cookies()
  let token = store.get(SESSION_COOKIE)?.value
  let newGuestToken: string | null = null

  if (!token) {
    token = (await newGuestSession()) ?? undefined
    newGuestToken = token ?? null
  }

  if (!token) {
    return NextResponse.json({ message: 'Sepet başlatılamadı.' }, { status: 500 })
  }

  const suffix = path && path.length > 0 ? `/${path.map(encodeURIComponent).join('/')}` : ''
  const body = method === 'GET' || method === 'DELETE' ? undefined : await request.text()

  const doFetch = (sessionToken: string) =>
    fetch(`${API}/api/cart${suffix}`, {
      method,
      headers: {
        'X-Shop-Session': sessionToken,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
      cache: 'no-store',
    })

  let res = await doFetch(token)

  if (res.status === 401 && !newGuestToken) {
    const fresh = await newGuestSession()
    if (fresh) {
      token = fresh
      newGuestToken = fresh
      res = await doFetch(token)
    }
  }

  const data = await res.json().catch(() => null)
  const response = NextResponse.json(data ?? {}, { status: res.status })

  if (newGuestToken) {
    response.cookies.set(SESSION_COOKIE, newGuestToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 gün geçerli misafir sepeti
    })
  }

  return response
}

export async function GET(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return forward(request, (await ctx.params).path, 'GET')
}

export async function POST(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return forward(request, (await ctx.params).path, 'POST')
}

export async function PUT(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return forward(request, (await ctx.params).path, 'PUT')
}

export async function DELETE(request: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  return forward(request, (await ctx.params).path, 'DELETE')
}
