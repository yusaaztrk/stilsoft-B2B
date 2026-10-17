import { useEffect, useState } from 'react'

/**
 * "Şu an kart görünümünde miyiz" — `Table` ile AYNI kural, tek kaynak.
 *
 * Kural `Table.tsx` içinde yaşıyordu ve sayfalar ona erişemiyordu. Kart görünümüne özel bir
 * arayüz (ör. Montaj Teslimattakiler'deki "Bayiden Alınacaklar / Faturalı" bölünmesi) eklemek
 * isteyen sayfa kendi `window.innerWidth < 768` kopyasını yazmak zorunda kalıyordu; bu kod
 * tabanında iki kopyanın ayrışması tekrar eden bir hata (bkz. sekme→yetki eşlemesi).
 *
 * Üç değerli tercih: 'table' / 'card' / seçilmemiş. Seçilmemişse dar ekranın varsayılanı kart.
 */

const STORAGE_KEY = 'table_view_mode'
const NARROW_BREAKPOINT = 768

function readPreference(): 'table' | 'card' | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'table' || raw === 'card' ? raw : null
  } catch {
    return null
  }
}

export function useCardView(): { isCardView: boolean; isNarrow: boolean } {
  const [width, setWidth] = useState(() => window.innerWidth)
  const [preference, setPreference] = useState<'table' | 'card' | null>(readPreference)

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)

    // Tercih `Table`ın görünüm düğmesinden değişiyor ve o başka bir bileşen; `storage` olayı
    // yalnızca DİĞER sekmelerde tetiklendiği için aynı sekmedeki değişimi yakalamaz. Odak
    // dönüşünde ve yeniden boyutlandırmada tercih tekrar okunuyor — kullanıcı görünümü
    // değiştirdikten sonra sayfa da aynı karara varsın.
    const syncPreference = () => setPreference(readPreference())
    window.addEventListener('storage', syncPreference)
    window.addEventListener('focus', syncPreference)

    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('storage', syncPreference)
      window.removeEventListener('focus', syncPreference)
    }
  }, [])

  const isNarrow = width < NARROW_BREAKPOINT
  return { isNarrow, isCardView: preference ? preference === 'card' : isNarrow }
}
