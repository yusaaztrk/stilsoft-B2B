import { NextResponse } from 'next/server'

const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

/**
 * "Sizi arayalım" köprüsü (2026-09-21).
 *
 * Aynı desen: mağaza API'sinin adresi sunucu tarafı bir ayar, tarayıcıya verilmiyor.
 * Oturum gerektirmiyor — özelliğin amacı zaten üye olmayan, hatta sepete bile gitmemiş
 * ziyaretçiyi kaybetmemek. Kötüye kullanım kapıları mağaza API'sinde: yazma kotası,
 * numara doğrulaması ve numara başına günde 5 talep sınırı.
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: 'Geçersiz istek.' }, { status: 400 })
  }

  try {
    const res = await fetch(`${API}/api/catalog/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    const json = await res.json().catch(() => ({}))
    return NextResponse.json(json, { status: res.status })
  } catch {
    return NextResponse.json({ message: 'Bağlantı kurulamadı, lütfen tekrar deneyin.' }, { status: 502 })
  }
}
