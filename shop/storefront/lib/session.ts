import { cookies } from 'next/headers'

const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

export const SESSION_COOKIE = 'shop_session'

/**
 * Oturum ÜYE OLMADAN SİPARİŞ yolundan açıldıysa '1' (2026-10-04). Yalnız görünüm için:
 * sonuç sayfası "Siparişlerim" yerine sipariş numarasını öne çıkarır. Yetki kararı VERMEZ.
 */
export const GUEST_ORDER_COOKIE = 'shop_misafir_siparis'

/** Bu tarayıcı oturumu üye olmadan sipariş yolundan mı geldi? */
export async function isGuestOrderSession(): Promise<boolean> {
  const store = await cookies()
  return store.get(GUEST_ORDER_COOKIE)?.value === '1'
}

export type SessionMember = {
  email: string
  fullName: string
  phone?: string | null
  customerCode?: string | null
}

/**
 * Oturum anahtarı httpOnly çerezde durur: tarayıcıdaki hiçbir kod onu okuyamaz, dolayısıyla
 * siteye sızan bir betik oturumu çalamaz. Anahtarı mağaza API'sine yalnızca sunucu taşır.
 */
export async function currentMember(): Promise<SessionMember | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null

  try {
    const res = await fetch(`${API}/api/account/me`, {
      headers: { 'X-Shop-Session': token },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const member = (await res.json()) as SessionMember
    if (member?.email?.toLowerCase().endsWith('@guest.stilsoft')) {
      return null
    }
    return member
  } catch {
    return null
  }
}
