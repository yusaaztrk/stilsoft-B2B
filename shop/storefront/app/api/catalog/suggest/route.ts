import { NextResponse } from 'next/server'

const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

/**
 * Arama önerisi köprüsü (2026-09-20).
 *
 * Mağaza API'sinin adresi sunucu tarafı bir ayar, tarayıcıya verilmiyor — vitrinin bütün
 * istekleri bu desende kendi `/api/...` yolundan geçiyor.
 *
 * Öneri isteği her tuş vuruşunda gelebilir; hata durumunda BOŞ liste dönüyor ve kutu sessizce
 * öneri göstermiyor. Arama kutusunun kendisi (Enter ile sonuç sayfası) her hâlükârda çalışır.
 */
export async function GET(request: Request) {
  const ara = new URL(request.url).searchParams.get('ara') ?? ''
  const bos = { items: [], categories: [] }

  if (ara.trim().length < 2) return NextResponse.json(bos)

  try {
    const res = await fetch(`${API}/api/catalog/suggest?ara=${encodeURIComponent(ara)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return NextResponse.json(bos)
    return NextResponse.json(await res.json())
  } catch {
    return NextResponse.json(bos)
  }
}
