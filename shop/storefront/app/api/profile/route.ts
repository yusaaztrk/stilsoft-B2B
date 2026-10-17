import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/session'

const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

/**
 * Profil güncelleme köprüsü.
 *
 * Form doğrudan mağaza API'sine gidemiyor: oturum anahtarı httpOnly çerezde duruyor ve
 * tarayıcıdaki kod onu okuyamıyor (bilerek — siteye sızan bir betik oturumu çalamasın).
 * Anahtarı isteğe yalnızca sunucu ekliyor.
 *
 * Şifre köprüsünden farkı: burada yeni bir oturum anahtarı üretilmiyor, dolayısıyla çereze
 * dokunulmuyor.
 *
 * 502 gövdesi olduğu gibi geçiriliyor: "kaydedildi ama cariye işlenemedi" hâli kullanıcıdan
 * gizlenmemeli — fatura adresi eski kalır ve kimse fark etmezdi.
 */
export async function PUT(request: Request) {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value

  if (!token) {
    return NextResponse.json({ message: 'Giriş yapmanız gerekiyor.' }, { status: 401 })
  }

  const res = await fetch(`${API}/api/account/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Shop-Session': token,
    },
    body: await request.text(),
  })

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    return NextResponse.json(
      { message: data?.message ?? 'Bilgileriniz kaydedilemedi.' },
      { status: res.status },
    )
  }

  return NextResponse.json({ success: true })
}
