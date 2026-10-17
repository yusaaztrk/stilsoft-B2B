import { NextResponse } from 'next/server'

const API = process.env.SHOP_API_URL ?? 'http://localhost:5150'

/**
 * Ziyaret hunisi köprüsü (2026-09-21).
 *
 * HTTP olarak hiçbir zaman HATA DÖNMÜYOR — ölçüm, sayfanın çalışmasını hiçbir koşulda
 * etkilememeli. Ama gövdedeki `success` GERÇEĞİ söylüyor.
 *
 * NEDEN ÖNEMLİ: ilk sürüm koşulsuz `{ success: true }` dönüyordu. Mağaza API'si o an kapalı
 * olsa bile tarayıcı adımı "gönderildi" diye işaretliyor ve bir daha denemiyordu. En çok
 * kaybedilen adım da huninin İLK basamağı ("siteye girdi") oluyordu — yani huninin paydası.
 * Paydası eksik bir huni, dönüşüm oranını olduğundan yüksek gösterir; hiç ölçmemekten kötü.
 *
 * Artık `success: false` dönünce istemci adımı işaretlemiyor ve bir sonraki sayfada yeniden
 * deniyor. Sunucudaki benzersiz indeks tekrarları zaten tekilliyor.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const res = await fetch(`${API}/api/catalog/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    return NextResponse.json({ success: res.ok })
  } catch {
    return NextResponse.json({ success: false })
  }
}
