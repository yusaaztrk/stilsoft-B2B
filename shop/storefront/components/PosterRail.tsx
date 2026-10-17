'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Poster } from '@/lib/posters'

/**
 * DİKEY ÜRÜN AFİŞLERİ RAYI — sürüklenebilir, merkezi vurgulu şerit.
 *
 * <b>ÖNCEKİ HÂLİ VE NEDEN DEĞİŞTİ (2026-09-09 kullanıcı isteği):</b> ray kesintisiz kayan
 * bir "marquee"ydi: liste iki kez basılıyor, CSS `translateX(-50%)` ile sonsuz dönüyordu.
 * Ziyaretçi şeridi kendisi süremiyordu — istediği afişte durmak için imleci üzerinde tutmak
 * zorundaydı ve dokunmatikte bu hiç çalışmıyordu. Kullanıcı "parmakla veya mouse ile sağa
 * sola çekilebilir olsun, ortadaki büyük olsun" dedi.
 *
 * <b>ŞİMDİ:</b> gerçek bir yatay kaydırma kabı.
 *  - Dokunmatik ve trackpad kaydırması <b>bedava</b> geliyor (tarayıcının kendi kaydırması);
 *    elle `touchmove` yakalamak, ivmeli kaydırmayı ve kaydırma çubuğunu bozardı.
 *  - Fare ile sürükleme ayrıca ekleniyor: masaüstünde kaydırma çubuğunu tutmak zorunda
 *    kalmamak için. Pointer olayları kullanılıyor (fare + kalem tek kod yolu); dokunma
 *    bilerek DIŞARIDA bırakılıyor, yoksa tarayıcının kendi kaydırmasıyla çakışırdı.
 *  - Kart boyutu merkeze uzaklığa göre: ortadaki büyük, komşuları bir kademe küçük,
 *    geri kalanlar mevcut boyutta.
 *
 * <b>Neden liste artık bir kez basılıyor:</b> sonsuz döngü, sürükleme ile birleştiğinde
 * kaydırma konumunu ortadan başlatıp kenarlara gelince sessizce zıplatmayı gerektirir; bu da
 * sürüklerken hissedilen bir sıçrama yaratıyor. Kopya kaldırıldı — ekran okuyucunun aynı
 * afişi iki kez okuması sorunu da böylece kendiliğinden bitti.
 */
export default function PosterRail({
  posters,
  title = 'Ürün Vitrini',
  subtitle = 'Stilsoft koleksiyonundan öne çıkan modeller ve teknik özellikleri',
  badge = 'KATALOG',
}: {
  posters: Poster[]
  title?: string
  subtitle?: string
  badge?: string
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  // Kartlar artık <a> değil <button> (bkz. `buyukAfis`).
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [merkez, setMerkez] = useState(0)

  /*
    AFİŞE TIKLAYINCA BÜYÜK GÖRSEL AÇILIYOR, ÜRÜN SAYFASINA GİTMİYOR
    (2026-09-21 kullanıcı isteği: "ürün vitrini linke yönlendirmesin, görsel büyüsün açınca").

    NEDEN DOĞRU: bu kartlar ürün KARTI değil, teknik özellik AFİŞİ — üstünde okunacak yazı
    var (kapasite, program sayısı, garanti). Şeritte 250px genişliğinde hiçbiri okunmuyor;
    müşteri okumak için tıklıyor ama ürün sayfasına atılıyor ve afişteki bilgiyi hiç
    göremiyordu. Artık afiş tam ekran açılıyor.
  */
  const [buyukAfis, setBuyukAfis] = useState<number | null>(null)

  // Sürükleme durumu ref'te: her fare hareketinde yeniden render etmek gereksiz ve
  // sürüklemeyi gözle görülür biçimde takılmalı yapıyor.
  const surukleme = useRef({ aktif: false, baslangicX: 0, baslangicScroll: 0, mesafe: 0 })

  /*
    Otomatik kaydırmanın duraklatılması. State DEĞİL ref: her duraklamada bileşeni yeniden
    render etmek animasyon döngüsünü kurup yıkardı ve kayma gözle görülür biçimde takılırdı.
  */
  const durakla = useRef(false)

  /** Görüş alanının ortasına en yakın kartı bulur. */
  const merkeziHesapla = useCallback(() => {
    const vp = viewportRef.current
    if (!vp) return

    const vpMerkez = vp.scrollLeft + vp.clientWidth / 2
    let enYakin = 0
    let enKisa = Number.POSITIVE_INFINITY

    cardRefs.current.forEach((el, i) => {
      if (!el) return
      const kartMerkez = el.offsetLeft + el.offsetWidth / 2
      const fark = Math.abs(kartMerkez - vpMerkez)
      if (fark < enKisa) {
        enKisa = fark
        enYakin = i
      }
    })

    setMerkez((onceki) => (onceki === enYakin ? onceki : enYakin))
  }, [])

  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return

    // Kaydırma olayı saniyede onlarca kez tetikleniyor; ölçümü boyama karesine bağlamak
    // hem daha akıcı hem de gereksiz düzen hesabını (layout thrash) önlüyor.
    let bekleyen = 0
    const onScroll = () => {
      if (bekleyen) return
      bekleyen = requestAnimationFrame(() => {
        bekleyen = 0
        merkeziHesapla()
      })
    }

    merkeziHesapla()
    vp.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (bekleyen) cancelAnimationFrame(bekleyen)
      vp.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [merkeziHesapla])

  /*
    KENDİLİĞİNDEN SAĞA KAYMA (2026-09-09 kullanıcı isteği: "ürün vitrini kendi kendine de
    kayacaktı sağa doğru").

    <b>Neden CSS animasyonu değil:</b> ray artık gerçek bir kaydırma kabı; CSS ile
    `transform` uygulamak kullanıcının kaydırma konumuyla çakışır ve sürükledikten sonra
    şerit yerine zıplar. Bunun yerine her karede `scrollLeft` bir tık artırılıyor —
    kullanıcının kendi kaydırmasıyla aynı mekanizma, dolayısıyla çakışma yok.

    <b>Hız:</b> kare başına 0,4 piksel ≈ saniyede 24 piksel. Okunabilirlik sınırı bu:
    daha hızlısında göz afişteki yazıyı takip edemiyor.

    <b>Ne zaman durur:</b> üzerine gelince, sürüklerken, sekme arka plandayken (gizli
    sekmede kaydırmak boşa iş) ve "azaltılmış hareket" tercihinde hiç başlamaz.

    <b>Sona gelince:</b> başa DÖNER. `scrollTo({behavior:'smooth'})` kullanılmıyor —
    yumuşak dönüş sırasında gelen her kare `scrollLeft`i tekrar ileri iterek dönüşü
    kilitliyordu; anlık dönüş hem güvenilir hem de maskeli kenarda fark edilmiyor.
  */
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let kare = 0
    let sonZaman = 0
    const HIZ = 0.4 // piksel / kare (60fps'te ~24 px/sn)

    const adim = (zaman: number) => {
      kare = requestAnimationFrame(adim)

      // Kare atlanırsa (sekme dondu, ağır sayfa) tek seferde zıplamasın diye tavan koyuluyor.
      const fark = sonZaman ? Math.min(zaman - sonZaman, 50) : 16
      sonZaman = zaman

      if (durakla.current || surukleme.current.aktif || document.hidden) return

      const sinir = vp.scrollWidth - vp.clientWidth
      if (sinir <= 0) return

      if (vp.scrollLeft >= sinir - 1) vp.scrollLeft = 0
      else vp.scrollLeft += HIZ * (fark / 16)
    }

    kare = requestAnimationFrame(adim)
    return () => cancelAnimationFrame(kare)
  }, [])

  /* ---------- fare ile sürükleme ---------- */

  const pointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Dokunma tarayıcının kendi kaydırmasına bırakılıyor (yukarıdaki nota bak).
    if (e.pointerType === 'touch') return
    const vp = viewportRef.current
    if (!vp) return

    surukleme.current = {
      aktif: true,
      baslangicX: e.clientX,
      baslangicScroll: vp.scrollLeft,
      mesafe: 0,
    }
    vp.setPointerCapture(e.pointerId)
    vp.classList.add('is-dragging')
  }

  const pointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = surukleme.current
    const vp = viewportRef.current
    if (!s.aktif || !vp) return

    const delta = e.clientX - s.baslangicX
    s.mesafe = Math.abs(delta)
    vp.scrollLeft = s.baslangicScroll - delta
  }

  const pointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = surukleme.current
    const vp = viewportRef.current
    if (!s.aktif || !vp) return

    s.aktif = false
    if (vp.hasPointerCapture(e.pointerId)) vp.releasePointerCapture(e.pointerId)
    vp.classList.remove('is-dragging')
  }

  /*
    Sürükleyip bıraktığında altındaki bağlantı AÇILMAMALI. Eşik olmadan her sürükleme
    sonunda rastgele bir ürün sayfasına gidiliyordu; 6 piksel, niyetli tıklamayı
    sürüklemeden ayırmaya yetiyor.
  */
  const linkClick = (e: React.MouseEvent) => {
    if (surukleme.current.mesafe > 6) {
      e.preventDefault()
      surukleme.current.mesafe = 0
    }
  }

  /* Büyük afiş açıkken: Esc kapatıyor, ok tuşları afiş değiştiriyor, arka plan kaymıyor. */
  useEffect(() => {
    if (buyukAfis === null) return

    const oncekiTasma = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const tus = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBuyukAfis(null)
      if (e.key === 'ArrowRight') setBuyukAfis((x) => ((x ?? 0) + 1) % posters.length)
      if (e.key === 'ArrowLeft') setBuyukAfis((x) => ((x ?? 0) - 1 + posters.length) % posters.length)
    }
    window.addEventListener('keydown', tus)

    return () => {
      document.body.style.overflow = oncekiTasma
      window.removeEventListener('keydown', tus)
    }
  }, [buyukAfis, posters.length])

  /** Ok düğmeleri: bir kart genişliği kadar kaydırır. */
  const kaydir = (yon: -1 | 1) => {
    const vp = viewportRef.current
    if (!vp) return
    const kart = cardRefs.current[merkez]
    const adim = kart ? kart.offsetWidth + 18 : vp.clientWidth * 0.6
    vp.scrollBy({ left: yon * adim, behavior: 'smooth' })
  }

  if (posters.length === 0) return null

  return (
    <section className="block poster-rail-section" aria-label={title}>
      <div className="wrap">
        <div className="block-head">
          <div>
            <span className="section-badge">{badge}</span>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <Link className="textlink view-all-link" href="/urunler">
            Tüm Kataloğu Gör
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </Link>
        </div>
      </div>

      <div className="poster-rail-wrap">
        <button
          type="button"
          className="poster-nav prev"
          aria-label="Önceki afişler"
          onClick={() => kaydir(-1)}
        >
          ‹
        </button>

        <div
          className="poster-viewport"
          ref={viewportRef}
          onMouseEnter={() => { durakla.current = true }}
          onMouseLeave={() => { durakla.current = false }}
          onFocusCapture={() => { durakla.current = true }}
          onBlurCapture={() => { durakla.current = false }}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          role="region"
          aria-label={`${title} — sağa sola kaydırılabilir`}
          tabIndex={0}
        >
          <div className="poster-track">
            {posters.map((poster, i) => {
              const uzaklik = Math.abs(i - merkez)
              const konum = uzaklik === 0 ? 'is-center' : uzaklik === 1 ? 'is-near' : ''

              return (
                <button
                  type="button"
                  key={poster.file}
                  ref={(el) => {
                    cardRefs.current[i] = el
                  }}
                  className={`poster-card ${konum}`}
                  aria-label={`${poster.alt} — büyüt`}
                  onClick={(e) => {
                    // Sürüklemeden sonraki bırakma tıklama sayılmamalı (eşik: 6 piksel).
                    if (surukleme.current.mesafe > 6) {
                      surukleme.current.mesafe = 0
                      return
                    }
                    e.preventDefault()
                    setBuyukAfis(i)
                  }}
                  draggable={false}
                >
                  <span className="poster-card-img">
                    <Image
                      src={`/posters/${poster.file}`}
                      alt={poster.alt}
                      fill
                      sizes="(max-width: 560px) 62vw, (max-width: 900px) 38vw, (max-width: 1300px) 26vw, 250px"
                      loading={i < 4 ? 'eager' : 'lazy'}
                      style={{ objectFit: 'cover' }}
                      draggable={false}
                    />
                    <span className="poster-sheen" aria-hidden="true" />
                    <span className="poster-buyut" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
                      </svg>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <button
          type="button"
          className="poster-nav next"
          aria-label="Sonraki afişler"
          onClick={() => kaydir(1)}
        >
          ›
        </button>
      </div>

      {/*
        BÜYÜK AFİŞ KATMANI. Afişin üstündeki teknik yazı ancak bu boyutta okunuyor.
        Oklarla önceki/sonraki afişe geçilebiliyor; Esc ve zemine tıklama kapatıyor.
      */}
      {buyukAfis !== null && posters[buyukAfis] && (
        <div
          className="afis-buyuk"
          role="dialog"
          aria-modal="true"
          aria-label={posters[buyukAfis].alt}
          onClick={() => setBuyukAfis(null)}
        >
          <button type="button" className="afis-kapat" aria-label="Kapat" onClick={() => setBuyukAfis(null)}>
            ✕
          </button>

          {posters.length > 1 && (
            <button
              type="button"
              className="afis-ok afis-ok-onceki"
              aria-label="Önceki afiş"
              onClick={(e) => {
                e.stopPropagation()
                setBuyukAfis((x) => ((x ?? 0) - 1 + posters.length) % posters.length)
              }}
            >
              ‹
            </button>
          )}

          {/* Görsele tıklamak kapatmamalı: büyütmek için açtı, yanlışlıkla kapanmasın. */}
          <div className="afis-buyuk-govde" onClick={(e) => e.stopPropagation()}>
            <Image
              src={`/posters/${posters[buyukAfis].file}`}
              alt={posters[buyukAfis].alt}
              width={900}
              height={1350}
              className="afis-buyuk-img"
              priority
            />
          </div>

          {posters.length > 1 && (
            <button
              type="button"
              className="afis-ok afis-ok-sonraki"
              aria-label="Sonraki afiş"
              onClick={(e) => {
                e.stopPropagation()
                setBuyukAfis((x) => ((x ?? 0) + 1) % posters.length)
              }}
            >
              ›
            </button>
          )}
        </div>
      )}
    </section>
  )
}
