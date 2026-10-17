'use client'

import { usePathname } from 'next/navigation'
import CallbackForm from '@/components/CallbackForm'

/*
  404 SAYFASINDA "SİZİ ARAYALIM" (2026-09-21).

  NEDEN: eski OpenCart adresleri ve yayından kalkan ürünler buraya düşüyor. Ziyaretçi çoğu
  zaman belirli bir ürünü arıyordu; ona arama kutusu + kategori listesi verip yolcu etmek,
  aradığı ürünün muadili depoda dururken onu kaybetmek demek. Form SMS'e bağlı değil, panele
  düşüyor — bugün çalışan tek lead kanalı.

  NEDEN CLIENT: `not-found.tsx` sunucu bileşeni ve hangi adresin arandığını bilmiyor (Next
  bunu 404'e geçirmiyor). Adres tarayıcıdan okunup nota yazılıyor: personel aradığında
  müşterinin hangi ürünün adresine geldiğini görüyor ("…/urun/st-24-btu-klima-…").
*/
export default function NotFoundCallback() {
  const pathname = usePathname() || ''
  const note = pathname && pathname !== '/' ? `Bulunamayan sayfa: ${pathname.slice(0, 200)}` : undefined

  return (
    <div className="notfound-callback">
      <CallbackForm kaynak="404" gorunum="serit" productName={note} />
    </div>
  )
}
