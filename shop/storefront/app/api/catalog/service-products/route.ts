import { NextResponse } from 'next/server'

const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

/**
 * Servis kaydı formundaki ürün seçicinin köprüsü.
 *
 * NEDEN KÖPRÜ: mağaza API'sinin adresi (`SHOP_API_URL`) sunucu tarafı bir ayar; tarayıcıya
 * verilmiyor. Vitrinin diğer istekleri de aynı desende kendi `/api/...` yolundan geçiyor.
 *
 * Oturum gerektirmiyor — form da gerektirmiyor. Uç zaten dar: en az iki harf, en fazla 20
 * satır, yalnız stok kodu/ad/kategori (fiyat ve stok dönmüyor).
 */
export async function GET(request: Request) {
  const ara = new URL(request.url).searchParams.get('ara') ?? ''

  try {
    const res = await fetch(
      `${API}/api/catalog/service-products?ara=${encodeURIComponent(ara)}`,
      { cache: 'no-store' },
    )

    if (!res.ok) return NextResponse.json([], { status: 200 })
    return NextResponse.json(await res.json())
  } catch {
    // Arama çalışmazsa form kilitlenmemeli: boş liste dönüyor, müşteri "elle yazayım"
    // yolunu kullanabiliyor.
    return NextResponse.json([], { status: 200 })
  }
}
