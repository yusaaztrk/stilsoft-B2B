import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'

/**
 * GÖRSEL BÜYÜTME (kullanıcı isteği, 2026-08-31).
 *
 * Servis geçmişindeki fotoğraflar ya YENİ SEKMEDE açılıyordu (`window.open` — WebView
 * uygulamasında kullanıcıyı tarayıcıya atıyor) ya da tam ekran basılıp orada kalıyordu:
 * yakınlaştırma yoktu. Sahadan gelen fotoğraf çoğu zaman etiket, seri no ya da küçük bir
 * hasar; büyütülemeyince işe yaramıyor.
 *
 * Tek bileşende toplandı: geçmiş hangi sayfadan gelirse gelsin aynı görüntüleyici açılır.
 *
 * Kullanım:
 *   const [acik, setAcik] = useState<number | null>(null)
 *   <GorselOnizleyici gorseller={urlListesi} acikIndex={acik} onKapat={() => setAcik(null)} />
 */

type Props = {
  gorseller: string[]
  /** Açık görselin sırası; `null` ise görüntüleyici kapalıdır. */
  acikIndex: number | null
  onKapat: () => void
}

const EN_AZ = 1
const EN_COK = 6

export default function GorselOnizleyici({ gorseller, acikIndex, onKapat }: Props) {
  const [index, setIndex] = useState(0)
  const [olcek, setOlcek] = useState(1)
  const [kaydirma, setKaydirma] = useState({ x: 0, y: 0 })

  const kutuRef = useRef<HTMLDivElement>(null)
  // Ekrandaki aktif parmaklar/imleç. İkisi birdense "iki parmakla açma" (pinch) sayılır.
  const isaretciler = useRef(new Map<number, { x: number; y: number }>())
  const pinchBaslangic = useRef<{ mesafe: number; olcek: number } | null>(null)
  const surukleme = useRef<{ x: number; y: number; kx: number; ky: number } | null>(null)
  /** Basma ile bırakma arasında gerçekten hareket oldu mu — sürüklemenin sonu "tıklama" sayılmasın. */
  const hareketVarMi = useRef(false)

  const acik = acikIndex !== null

  const sifirla = useCallback(() => {
    setOlcek(1)
    setKaydirma({ x: 0, y: 0 })
  }, [])

  // Yeni görsel açıldığında yakınlaştırma sıfırdan başlasın.
  useEffect(() => {
    if (acikIndex === null) return
    setIndex(acikIndex)
    sifirla()
  }, [acikIndex, sifirla])

  const gecis = useCallback((yon: 1 | -1) => {
    if (gorseller.length < 2) return
    setIndex((p) => (p + yon + gorseller.length) % gorseller.length)
    sifirla()
  }, [gorseller.length, sifirla])

  /**
   * Belirli bir NOKTAYI sabit tutarak ölçeği değiştirir — imlecin/parmağın altındaki yer
   * kaçmasın diye. Nokta, kutunun merkezine göre piksel cinsinden verilir.
   *
   * Ölçek ve kaydırma birlikte hesaplanmak zorunda: kaydırmanın yeni değeri ESKİ ölçeğe
   * bağlı. İkisi ayrı ayrı set edilirse React güncellemeleri sıralayınca görsel kayıyor.
   */
  const noktadaOlcekle = useCallback((istenen: number, nx: number, ny: number) => {
    const yeni = Math.min(EN_COK, Math.max(EN_AZ, istenen))
    setOlcek((eski) => {
      if (yeni !== eski) {
        const oran = yeni / eski
        setKaydirma((k) => ({ x: nx - (nx - k.x) * oran, y: ny - (ny - k.y) * oran }))
      }
      return yeni
    })
  }, [])

  // Klavye: Esc kapatır, oklar gezinir, +/- yakınlaştırır, 0 sıfırlar.
  useEffect(() => {
    if (!acik) return
    const tus = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onKapat()
      else if (e.key === 'ArrowRight') gecis(1)
      else if (e.key === 'ArrowLeft') gecis(-1)
      else if (e.key === '+' || e.key === '=') noktadaOlcekle(olcek * 1.4, 0, 0)
      else if (e.key === '-') noktadaOlcekle(olcek / 1.4, 0, 0)
      else if (e.key === '0') sifirla()
    }
    window.addEventListener('keydown', tus)
    return () => window.removeEventListener('keydown', tus)
  }, [acik, onKapat, gecis, sifirla, noktadaOlcekle, olcek])

  // İmleç/parmak pencerenin dışında bırakılırsa sürükleme askıda kalmasın.
  useEffect(() => {
    if (!acik) return
    const bitir = () => {
      isaretciler.current.clear()
      pinchBaslangic.current = null
      surukleme.current = null
    }
    window.addEventListener('pointerup', bitir)
    window.addEventListener('pointercancel', bitir)
    return () => {
      window.removeEventListener('pointerup', bitir)
      window.removeEventListener('pointercancel', bitir)
    }
  }, [acik])

  const merkezeGore = (clientX: number, clientY: number) => {
    const kutu = kutuRef.current
    if (!kutu) return null
    const r = kutu.getBoundingClientRect()
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) }
  }

  const tekerlek = (e: React.WheelEvent) => {
    const n = merkezeGore(e.clientX, e.clientY)
    if (!n) return
    noktadaOlcekle(olcek * (e.deltaY < 0 ? 1.2 : 1 / 1.2), n.x, n.y)
  }

  const isaretciBasti = (e: React.PointerEvent) => {
    isaretciler.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    hareketVarMi.current = false
    /*
      setPointerCapture BİLEREK ÇAĞRILMIYOR. Kap imleci yakalayınca tarayıcı `click`
      olayını da kaba yönlendiriyor: ileri/geri okları hiç tetiklenmiyor, üstelik
      `e.target === e.currentTarget` doğru çıkıp görüntüleyici kapanıyordu. Kap zaten
      tam ekran olduğu için yakalamaya gerek yok; imleç pencereden çıkarsa aşağıdaki
      pencere seviyesi temizliği sürüklemeyi bitirir.
    */

    if (isaretciler.current.size === 2) {
      const [a, b] = [...isaretciler.current.values()]
      pinchBaslangic.current = { mesafe: Math.hypot(a.x - b.x, a.y - b.y), olcek }
      surukleme.current = null
    } else if (isaretciler.current.size === 1 && olcek > 1) {
      // Yalnızca yakınlaştırılmışken sürükle; 1x'te sürükleme kapalı olmalı ki
      // boşluğa dokunup kapatma çalışsın.
      surukleme.current = { x: e.clientX, y: e.clientY, kx: kaydirma.x, ky: kaydirma.y }
    }
  }

  const isaretciKimildadi = (e: React.PointerEvent) => {
    if (!isaretciler.current.has(e.pointerId)) return
    isaretciler.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (isaretciler.current.size === 2 && pinchBaslangic.current) {
      const [a, b] = [...isaretciler.current.values()]
      const mesafe = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchBaslangic.current.mesafe === 0) return
      const n = merkezeGore((a.x + b.x) / 2, (a.y + b.y) / 2)
      if (!n) return
      hareketVarMi.current = true
      noktadaOlcekle(pinchBaslangic.current.olcek * (mesafe / pinchBaslangic.current.mesafe), n.x, n.y)
      return
    }

    if (surukleme.current) {
      hareketVarMi.current = true
      setKaydirma({
        x: surukleme.current.kx + (e.clientX - surukleme.current.x),
        y: surukleme.current.ky + (e.clientY - surukleme.current.y),
      })
    }
  }

  const isaretciBitti = (e: React.PointerEvent) => {
    isaretciler.current.delete(e.pointerId)
    if (isaretciler.current.size < 2) pinchBaslangic.current = null
    if (isaretciler.current.size === 0) surukleme.current = null
  }

  if (!acik || gorseller.length === 0) return null

  const url = gorseller[Math.min(index, gorseller.length - 1)]
  const dugme =
    'p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors ' +
    'disabled:opacity-30 disabled:hover:bg-white/10 cursor-pointer'

  return createPortal(
    <div className="fixed inset-0 z-[10050] bg-black/90 flex flex-col select-none">
      <div className="flex items-center justify-between gap-2 p-2 sm:p-3 bg-black/40 shrink-0">
        <div className="text-white/70 text-xs font-medium px-1">
          {gorseller.length > 1 ? `${index + 1} / ${gorseller.length}` : 'Görsel'}
          <span className="ml-2 text-white/40">%{Math.round(olcek * 100)}</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Uzaklaştır"
            className={dugme}
            disabled={olcek <= EN_AZ}
            onClick={() => noktadaOlcekle(olcek / 1.4, 0, 0)}
          >
            <ZoomOut className="w-5 h-5" />
          </button>
          <button
            type="button"
            title="Yakınlaştır"
            className={dugme}
            disabled={olcek >= EN_COK}
            onClick={() => noktadaOlcekle(olcek * 1.4, 0, 0)}
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <button type="button" title="Sıfırla" className={dugme} onClick={sifirla}>
            <RotateCcw className="w-5 h-5" />
          </button>
          <a href={url} target="_blank" rel="noreferrer" title="Yeni sekmede aç" className={dugme}>
            <ExternalLink className="w-5 h-5" />
          </a>
          <button type="button" title="Kapat" className={dugme} onClick={onKapat}>
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div
        ref={kutuRef}
        className="flex-1 relative overflow-hidden flex items-center justify-center"
        style={{ touchAction: 'none', cursor: olcek > 1 ? 'grab' : 'zoom-in' }}
        onWheel={tekerlek}
        onPointerDown={isaretciBasti}
        onPointerMove={isaretciKimildadi}
        onPointerUp={isaretciBitti}
        onPointerCancel={isaretciBitti}
        onDoubleClick={(e) => {
          const n = merkezeGore(e.clientX, e.clientY)
          if (!n) return
          if (olcek > 1) sifirla()
          else noktadaOlcekle(2.5, n.x, n.y)
        }}
        onClick={(e) => {
          // 1x iken boşluğa tıklayınca kapansın. Sürükleme sonrası tıklama sayılmaz.
          if (e.target === e.currentTarget && olcek === 1 && !hareketVarMi.current) onKapat()
        }}
      >
        <img
          src={url}
          alt="Servis görseli"
          draggable={false}
          className="max-w-full max-h-full object-contain pointer-events-none"
          style={{
            transform: `translate(${kaydirma.x}px, ${kaydirma.y}px) scale(${olcek})`,
            transformOrigin: 'center center',
          }}
        />

        {gorseller.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); gecis(-1) }}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white cursor-pointer"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); gecis(1) }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white cursor-pointer"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          </>
        )}
      </div>

      <div className="text-center text-[11px] text-white/40 pb-2 px-3 shrink-0">
        Çift dokunarak büyüt · iki parmakla yakınlaştır · sürükleyerek gez
      </div>
    </div>,
    document.body
  )
}
