'use client'

import Image from 'next/image'
import { useCallback, useEffect, useState } from 'react'

/**
 * Ürün görselleri + TAM EKRAN BÜYÜTME.
 *
 * <b>Neden eklendi:</b> ürün detayında görsel 560 pikselle sınırlıydı ve tıklamak hiçbir şey
 * yapmıyordu. Beyaz eşyada müşterinin bakmak istediği şey çoğu zaman detay — panel yazısı,
 * düğme dizilimi, kulp biçimi — ve o boyutta okunmuyordu (2026-09-09 kullanıcı isteği:
 * "ürün detay sayfasında görsele basınca ürün büyümüş olsun").
 *
 * <b>Neden ayrı bir katman (portal değil, sabit konumlu div):</b> galeri zaten istemci
 * bileşeni; büyütme için ikinci bir bağımlılık ya da portal kurmak, kazandırdığından fazlasını
 * götürürdü. Katman `position: fixed` ve en üstte; sayfanın geri kalanına dokunmuyor.
 *
 * <b>Erişilebilirlik:</b> katman açıkken ESC kapatır, ok tuşları görseller arasında gezer ve
 * arka plan kaydırması kilitlenir — kilitlenmezse mobilde katmanın arkasındaki sayfa kayıyor
 * ve kullanıcı geri döndüğünde başka bir yerde oluyor.
 */
export default function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [active, setActive] = useState(0)
  const [zoomOpen, setZoomOpen] = useState(false)

  const main = images[active] ?? images[0]
  const total = images.length

  const step = useCallback(
    (delta: number) => {
      if (total < 2) return
      setActive((prev) => (prev + delta + total) % total)
    },
    [total],
  )

  // Katman açıkken klavye ve sayfa kaydırması. Bağımlılıklar değişince temizlenir;
  // temizlenmezse kapandıktan sonra body kilitli kalır ve sayfa donmuş görünür.
  useEffect(() => {
    if (!zoomOpen) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomOpen(false)
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [zoomOpen, step])

  return (
    <div className="pdp-media">
      <div className="pdp-main">
        {main ? (
          <>
            <Image
              key={main}
              src={main}
              alt={name}
              fill
              sizes="(max-width: 900px) 100vw, 560px"
              priority={active === 0}
              className="pdp-main-img"
            />
            {/*
              Büyütme tetiği görselin ÜSTÜNDE ayrı bir düğme: `next/image` kendi <img>'ini
              üretiyor, ona doğrudan tıklama bağlamak yerine tam kaplayan bir düğme koymak
              hem klavyeyle odaklanabilir hem de ekran okuyucuya ne olduğunu söyleyebilir.
            */}
            <button
              type="button"
              className="pdp-zoom-trigger"
              onClick={() => setZoomOpen(true)}
              aria-label={`${name} görselini büyüt`}
            >
              <span className="pdp-zoom-hint" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="16.5" y1="16.5" x2="21" y2="21" />
                  <line x1="11" y1="8" x2="11" y2="14" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                </svg>
                Büyütmek için tıklayın
              </span>
            </button>
          </>
        ) : (
          <div className="pdp-placeholder">
            <span>STILSOFT</span>
          </div>
        )}
      </div>

      {images.length > 1 && (
        <div className="pdp-thumbs">
          {images.slice(0, 6).map((src, i) => (
            <button
              type="button"
              key={src}
              className={`pdp-thumb${i === active ? ' on' : ''}`}
              aria-label={`${name} — ${i + 1}. görsel`}
              aria-current={i === active}
              onClick={() => setActive(i)}
            >
              <Image src={src} alt="" fill sizes="74px" className="pdp-thumb-img" />
            </button>
          ))}
        </div>
      )}

      {zoomOpen && main && (
        <div
          className="pdp-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`${name} — büyütülmüş görsel`}
          onClick={() => setZoomOpen(false)}
        >
          <button type="button" className="pdp-lb-close" aria-label="Kapat" onClick={() => setZoomOpen(false)}>
            ✕
          </button>

          {total > 1 && (
            <button
              type="button"
              className="pdp-lb-nav prev"
              aria-label="Önceki görsel"
              onClick={(e) => {
                // Katmanın kendisine giden tıklama onu kapatıyor; gezinme düğmeleri
                // kapatmamalı, yoksa ikinci görsele geçmek imkânsız olurdu.
                e.stopPropagation()
                step(-1)
              }}
            >
              ‹
            </button>
          )}

          <div className="pdp-lb-stage" onClick={(e) => e.stopPropagation()}>
            <Image
              key={`zoom-${main}`}
              src={main}
              alt={name}
              fill
              sizes="100vw"
              className="pdp-lb-img"
            />
          </div>

          {total > 1 && (
            <button
              type="button"
              className="pdp-lb-nav next"
              aria-label="Sonraki görsel"
              onClick={(e) => {
                e.stopPropagation()
                step(1)
              }}
            >
              ›
            </button>
          )}

          {total > 1 && (
            <div className="pdp-lb-counter" onClick={(e) => e.stopPropagation()}>
              {active + 1} / {total}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
