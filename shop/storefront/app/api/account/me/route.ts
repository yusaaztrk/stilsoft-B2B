import { NextResponse } from 'next/server'
import { currentMember } from '@/lib/session'

/**
 * "Oturumda kim var" köprüsü — yalnızca üst bardaki Hesabım/Giriş Yap butonu istemciden
 * çağırıyor. Bu köprü sunucu bileşeninde (`SiteHeader`) değil burada duruyor ki üst bar
 * `cookies()` okumasın: aksi hâlde kök bileşenin her sayfada render edilmesi yüzünden
 * anasayfa, ürün ve kategori sayfaları da dahil bütün site statik/ISR üretimden çıkıp tam
 * dinamik render'a zorlanıyordu (2026-09-05 denetiminde bulundu — bkz. `app/layout.tsx`).
 */
export async function GET() {
  const member = await currentMember()
  return NextResponse.json({ member })
}
