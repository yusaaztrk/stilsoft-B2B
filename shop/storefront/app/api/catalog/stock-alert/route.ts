import { NextResponse } from 'next/server'

const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

/**
 * "Gelince haber ver" köprüsü (2026-09-20).
 *
 * NEDEN KÖPRÜ: mağaza API'sinin adresi (`SHOP_API_URL`) sunucu tarafı bir ayar, tarayıcıya
 * verilmiyor — vitrinin diğer yazma istekleri de aynı desende kendi `/api/...` yolundan geçiyor.
 *
 * Oturum gerektirmiyor: özelliğin bütün amacı üye OLMAYAN ziyaretçiyi kaybetmemek. Kötüye
 * kullanım kapısı mağaza API'sinde — yazma kotası, numara doğrulaması, numara başına en fazla
 * 20 ürün ve var olmayan stok kodunun sessizce yutulması.
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: 'Geçersiz istek.' }, { status: 400 })
  }

  try {
    const res = await fetch(`${API}/api/catalog/stock-alert`, {
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
