'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/*
  ZİYARET HUNİSİ İZLEYİCİSİ (2026-09-21).

  SORULAN SORU: "toplam kaç kişi girdi, kaç tanesi üye olmadan gezdi, nerede takıldı?"

  NEDEN GA4 DEĞİL: GA4 kimliği panelde boş; girilse bile oradaki oturum bizim sipariş
  numaramızla eşleşmiyor ve "sepete gelen 40 kişiden 33'ü ödemeye geçmedi" cümlesi
  kurulamıyor. Burada huni siparişle aynı veritabanında.

  NE GÖNDERİLİYOR: yalnız rastgele bir oturum kimliği, adım adı ve adres yolu.
  IP yok, tarayıcı parmak izi yok, e-posta yok, çerez yok (sessionStorage kullanılıyor,
  yani sekme kapanınca kimlik de gidiyor).

  ADIM ADRESTEN ÇIKARILIYOR: ayrı ayrı her sayfaya çağrı koymak, bir gün birinin unutulması
  demekti. Tek yerde, yoldan türetiliyor.

  AYNI ADIM OTURUM BAŞINA BİR KEZ sayılıyor (sunucuda benzersiz indeks var), ama gereksiz
  istek atmamak için burada da hatırlanıyor.
*/

const OTURUM_ANAHTARI = 'stilsoft:oturum'
const GONDERILEN_ANAHTARI = 'stilsoft:huni'

/** Adres yolundan huni adımı. Sıra: giris < urun < sepet < odeme < siparis. */
function adimBul(pathname: string): string {
  if (pathname.startsWith('/odeme/sonuc')) return 'siparis'
  if (pathname.startsWith('/odeme')) return 'odeme'
  if (pathname.startsWith('/sepet')) return 'sepet'
  if (pathname.startsWith('/urun/')) return 'urun'
  return 'giris'
}

function oturumKimligi(): string | null {
  try {
    let id = window.sessionStorage.getItem(OTURUM_ANAHTARI)
    if (!id) {
      // `crypto.randomUUID` eski tarayıcılarda yok; yedek yol rastgele iki taban-36 parça.
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID().replace(/-/g, '').slice(0, 32)
          : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
      window.sessionStorage.setItem(OTURUM_ANAHTARI, id)
    }
    return id
  } catch {
    // Gizli sekmede depolama kapalı olabilir; o oturum ölçülmez, site normal çalışır.
    return null
  }
}

export default function VisitTracker() {
  const pathname = usePathname()

  useEffect(() => {
    const yol = pathname ?? '/'
    const adim = adimBul(yol)
    const oturum = oturumKimligi()
    if (!oturum) return

    let gonderilen: string[] = []
    try {
      gonderilen = JSON.parse(window.sessionStorage.getItem(GONDERILEN_ANAHTARI) ?? '[]')
      if (!Array.isArray(gonderilen)) gonderilen = []
    } catch {
      gonderilen = []
    }
    if (gonderilen.includes(adim)) return

    /*
      `keepalive`: ödeme sonucu sayfasında müşteri hemen sekmeyi kapatabiliyor. Normal bir
      fetch o anda iptal olur ve tam da ölçmek istediğimiz "sipariş verdi" adımı kaybolurdu.
    */
    void fetch('/api/catalog/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: oturum, step: adim, path: yol.slice(0, 300) }),
      keepalive: true,
    })
      .then(async (res) => {
        /*
          ADIM YALNIZ GERÇEKTEN KAYDEDİLDİYSE işaretleniyor. Köprü HTTP olarak hep 200
          dönüyor (ölçüm sayfayı bozmamalı) ama gövdedeki `success` mağaza API'sinin
          isteği alıp almadığını söylüyor. Koşulsuz işaretlemek, API'nin kapalı olduğu
          anlarda huninin ilk basamağını — yani paydasını — sessizce eksiltirdi.
        */
        const body = await res.json().catch(() => null)
        if (!body?.success) return

        try {
          window.sessionStorage.setItem(GONDERILEN_ANAHTARI, JSON.stringify([...gonderilen, adim]))
        } catch {
          /* depolama yazılamıyorsa bir sonraki sayfada tekrar denenir; sunucu zaten tekilliyor */
        }
      })
      .catch(() => {
        /* ölçüm başarısız olabilir; sayfanın çalışmasını hiçbir şekilde etkilememeli */
      })
  }, [pathname])

  return null
}
