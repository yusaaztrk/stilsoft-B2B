import { X } from 'lucide-react'
import React from 'react'
import { createPortal } from 'react-dom'

/** Açık modal sayısı — gövde kaydırma kilidi sıradan bağımsız açılıp kapansın diye. */
let govdeKilitSayaci = 0
let govdeKilitIlkDeger = ''

type Props = {
  isOpen: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  hideHeader?: boolean
  scrollable?: boolean
  containerClassName?: string
  maxWidth?: string
  overlayClassName?: string
  /** Sağ alt köşedeki boyutlandırma tutamağını gizler. Varsayılan: açık. */
  resizable?: boolean
  /**
   * Başlıktan tutup pencereyi taşımayı kapatır. Varsayılan: açık. `hideHeader` verilen
   * pencerelerde tutulacak bir başlık olmadığı için taşıma zaten çalışmaz.
   */
  movable?: boolean
  /**
   * Boyutun hatırlanacağı anahtar. Verilmezse `title` kullanılır. Başlığı kayda göre
   * değişen pencerelerde sabit bir anahtar vermek gerekir.
   */
  sizeKey?: string
}

/** Elle boyutlandırırken pencerenin inebileceği en küçük ölçü (px). */
const MIN_WIDTH = 320
const MIN_HEIGHT = 200

/** Pencere kenarı ile ekran kenarı arasında bırakılan boşluk (px) — kapsayıcının `p-4`'ü. */
const VIEWPORT_MARGIN = 32

/**
 * ELLE VERİLEN BOYUT HATIRLANIR (2026-08-22).
 *
 * Ölçü tarayıcının yerel deposunda, kullanıcı bazında durur; pencere kapanıp açılınca ve
 * ertesi gün tekrar girildiğinde aynı boyut gelir. Anahtar pencerenin BAŞLIĞI: aynı başlık
 * aynı penceredir, farklı pencereler birbirinin ölçüsünü ezmez.
 *
 * `sizeKey` verilirse başlık yerine o kullanılır — başlığı değişken olan pencereler için
 * ("Kredi Düzenle (X)" gibi) gerekir, yoksa her kayıt ayrı ölçü tutardı.
 */
const SIZE_STORAGE_PREFIX = 'modalSize:'

function readStoredSize(key: string): { width: number; height: number } | null {
  if (!key || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SIZE_STORAGE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const width = Number(parsed?.width)
    const height = Number(parsed?.height)
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null
    // Ekran küçülmüş olabilir (başka monitör, yatay/dikey): kayıtlı ölçü daima o anki
    // ekrana kırpılır, yoksa pencere ekrandan taşmış olarak açılırdı.
    return {
      width: Math.min(Math.max(MIN_WIDTH, width), window.innerWidth - VIEWPORT_MARGIN),
      height: Math.min(Math.max(MIN_HEIGHT, height), window.innerHeight - VIEWPORT_MARGIN)
    }
  } catch {
    return null
  }
}

function writeStoredSize(key: string, size: { width: number; height: number }) {
  if (!key || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SIZE_STORAGE_PREFIX + key, JSON.stringify(size))
  } catch {
    // Depo dolu ya da kapalı olabilir; boyut hatırlanmaz ama pencere çalışmaya devam eder.
  }
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  hideHeader,
  scrollable,
  containerClassName,
  maxWidth,
  overlayClassName,
  resizable = true,
  movable = true,
  sizeKey
}: Props) {
  /**
   * ARKA PLAN KAYDIRMASI KİLİTLENİR (denetim md. 41).
   *
   * Pencere açıkken fare tekerleği pencerenin dışına taştığında arkadaki sayfa kayıyordu;
   * kullanıcı formda çalışırken zemin kayıp odak kayboluyordu. Açılışta `body` kaydırması
   * kapatılıyor, kapanışta ÖNCEKİ değer geri yükleniyor — iç içe pencerelerde de doğru
   * çalışır (içteki pencere 'hidden' değerini devralır ve kapanırken onu geri koyar).
   *
   * Kanca erken `return`'ün ÜSTÜNDE durmak zorunda: React kancaları koşullu çağrılamaz.
   */
  React.useEffect(() => {
    if (!isOpen) return
    if (typeof document === 'undefined') return

    /*
      KAYDIRMA KİLİDİ SAYAÇLI (2026-08-26, kullanıcı: "cari oluştururken/güncellerken modal
      donuyor, sayfa kilitleniyor, kapatıp açmadan düzelmiyor").

      Her modal açılırken `body.overflow`'u 'hidden' yapıp ÖNCEKİ değeri kendi içinde
      saklıyordu. İki modal üst üste açıldığında (bu sayfada 4 tane var) ikincisi "önceki"
      olarak ZATEN 'hidden' olan değeri yakalıyor; kapanışta onu geri yazınca gövde kilitli
      kalıyor ve sayfa kaydırılamıyordu. Kapanış sırası değiştiğinde kilit kalıcı oluyordu.

      Artık açık modal SAYISI tutuluyor: ilk açılışta gerçek başlangıç değeri saklanır,
      yalnızca SON modal kapanınca geri yazılır. Sıradan bağımsız.
    */
    if (govdeKilitSayaci === 0) {
      govdeKilitIlkDeger = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    govdeKilitSayaci += 1

    return () => {
      govdeKilitSayaci -= 1
      if (govdeKilitSayaci <= 0) {
        govdeKilitSayaci = 0
        document.body.style.overflow = govdeKilitIlkDeger
      }
    }
  }, [isOpen])

  /**
   * ELLE BOYUTLANDIRMA (2026-08-22).
   *
   * `null` iken pencere içeriği kadar yer kaplar (aşağıdaki `h-auto`). Kullanıcı sağ alt
   * köşeden sürükler sürüklemez buraya piksel ölçü yazılır ve pencere o ölçüde kalır.
   * Pencere her KAPANDIĞINDA sıfırlanır: bir ekranda büyütülen pencerenin ölçüsünün
   * başka bir ekranda karşımıza çıkması şaşırtıcı olurdu.
   */
  const storageKey = String(sizeKey ?? title ?? '').trim()
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null)
  const boxRef = React.useRef<HTMLDivElement | null>(null)

  /**
   * Açılışta kayıtlı ölçü geri yüklenir. Eskiden burada `setSize(null)` vardı ve pencere
   * her kapanışta varsayılan boyuta dönüyordu.
   */
  React.useEffect(() => {
    if (!isOpen) return
    setSize(readStoredSize(storageKey))
  }, [isOpen, storageKey])

  // Sürükleme bitiminde okunacağı için anahtar ref'te tutulur; `startResize` bağımlılıksız.
  const storageKeyRef = React.useRef(storageKey)
  React.useEffect(() => {
    storageKeyRef.current = storageKey
  }, [storageKey])

  const startResize = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = boxRef.current
    if (!el) return

    e.preventDefault()
    e.stopPropagation()

    const rect = el.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY
    const startWidth = rect.width
    const startHeight = rect.height

    /**
     * Pencere iki eksende de ORTALANMIŞ durumda. Genişlik W kadar artınca kutu her iki yana
     * W/2 büyür, yani sağ kenar imlecin yarısı kadar ilerler. Tutamağın imleçle birlikte
     * gitmesi için fark 2 ile çarpılıyor; çarpmasaydık kullanıcı imleci tutamaktan hızla
     * uzaklaştırırdı. Dikeyde de aynı sebep.
     */
    const onMove = (ev: PointerEvent) => {
      const maxWidthPx = window.innerWidth - VIEWPORT_MARGIN
      const maxHeightPx = window.innerHeight - VIEWPORT_MARGIN

      const nextWidth = Math.min(maxWidthPx, Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX) * 2))
      const nextHeight = Math.min(maxHeightPx, Math.max(MIN_HEIGHT, startHeight + (ev.clientY - startY) * 2))

      setSize({ width: nextWidth, height: nextHeight })
    }

    // Sürüklerken metin seçilmesin: köşeyi çekerken formdaki yazılar maviye boyanıyordu.
    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'

    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = previousUserSelect
      // Kayıt SÜRÜKLEME BİTİNCE yapılır: her piksel hareketinde yazmak yerel depoya
      // saniyede onlarca yazma demek olurdu.
      const el2 = boxRef.current
      if (el2) {
        const r = el2.getBoundingClientRect()
        writeStoredSize(storageKeyRef.current, { width: Math.round(r.width), height: Math.round(r.height) })
      }
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [])

  /**
   * BAŞLIKTAN TUTUP TAŞIMA (2026-08-22).
   *
   * Pencere kapsayıcı tarafından iki eksende ORTALANIYOR; konumu `left/top` ile değil, bu
   * kaydırma değeriyle veriliyor (`transform: translate`). Böylece ortalama düzeni bozulmadan
   * pencere yerinden oynatılabiliyor ve boyutlandırma da eskisi gibi merkezden büyüyor.
   *
   * Boyutun aksine konum HATIRLANMIYOR: pencere her açılışta ortada gelir. Taşıma çoğunlukla
   * "arkadaki satırı göreyim" diye yapılan geçici bir hareket; ertesi gün pencerenin ekranın
   * köşesinde açılması şaşırtıcı olurdu. Boyut ise formun kalıcı bir tercihi, o yüzden o
   * saklanıyor.
   */
  const [offset, setOffset] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const offsetRef = React.useRef(offset)
  React.useEffect(() => {
    offsetRef.current = offset
  }, [offset])

  const startDrag = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Yalnizca sol tus; sag tik menusu penceyi surukleyip birakmasin.
    if (e.button !== 0) return

    const el = boxRef.current
    if (!el) return

    // Baslikta duran KAPATMA dugmesi surukleme baslatmamali: aksi halde dugmeye basip bir
    // piksel kayan fare pencereyi tasiyor ve tiklama kayboluyor.
    if ((e.target as HTMLElement | null)?.closest('button')) return

    e.preventDefault()

    const rect = el.getBoundingClientRect()
    const start = offsetRef.current
    const startX = e.clientX
    const startY = e.clientY
    // Kaydirma UYGULANMADAN onceki yer: kutunun ortalanmis hali. Sinirlar buna gore kurulur.
    const baseLeft = rect.left - start.x
    const baseTop = rect.top - start.y
    const width = rect.width
    const height = rect.height

    const onMove = (ev: PointerEvent) => {
      const edge = VIEWPORT_MARGIN / 2

      /**
       * Pencere ekrandan TAMAMEN çıkamaz. Çıkabilseydi kullanıcı başlığı bir daha
       * tutamaz, kapatma düğmesine de erişemezdi — pencereyi geri getirmenin tek yolu
       * sayfayı yenilemek olurdu.
       */
      const minX = edge - baseLeft
      const maxX = window.innerWidth - edge - width - baseLeft
      const minY = edge - baseTop
      const maxY = window.innerHeight - edge - height - baseTop

      const nextX = start.x + (ev.clientX - startX)
      const nextY = start.y + (ev.clientY - startY)

      setOffset({
        // Pencere o eksende ekrana sığmıyorsa (üst sınır alt sınırın altına düşer) hiç
        // kaydırılmaz; kırpma ters çalışıp pencereyi kenara yapıştırırdı.
        x: maxX < minX ? 0 : Math.min(maxX, Math.max(minX, nextX)),
        y: maxY < minY ? 0 : Math.min(maxY, Math.max(minY, nextY))
      })
    }

    // Tasirken metin secilmesin: baslik ustunde surukleyince form yazilari maviye boyaniyordu.
    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'

    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = previousUserSelect
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }, [])

  if (!isOpen) return null

  const isScrollable = scrollable !== false
  const widthCls = maxWidth || 'max-w-2xl'
  const container = String(containerClassName ?? '').trim()
  const overlay = String(overlayClassName ?? '').trim()

  /**
   * Boyut verilmediyse sınıflar geçerli: `w-full` + çağıranın `max-w-*` değeri, yükseklik
   * içerik kadar. Boyut verildiyse satır içi ölçü sınıfları EZER — `max-w-*` sınıfı burada
   * ayrıca ezilmeli, yoksa kullanıcı pencereyi kendi genişliğinden büyütemez.
   */
  const moved = offset.x !== 0 || offset.y !== 0

  const boxStyle: React.CSSProperties = {
    ...(size
      ? {
          width: size.width,
          height: size.height,
          maxWidth: `calc(100vw - ${VIEWPORT_MARGIN}px)`,
          maxHeight: `calc(100vh - ${VIEWPORT_MARGIN}px)`
        }
      : {}),
    ...(moved ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : {})
  }

  const content = (
    /*
      ZEMİN KARARTILMIYOR, BULANIKLIK ÇOK HAFİF (2026-08-22 kullanıcı kararı).
      Önceden `bg-black/50 backdrop-blur-sm` vardı: arkadaki tablo neredeyse okunmuyordu.
      Kullanıcı pencere açıkken arkadaki satırı görüp ona göre ilerlemek istiyor. Zemin
      yine TIKLAMAYI ENGELLER (kaplama duruyor), yalnızca görünürlüğü kapatmıyor; pencere
      kenarını `shadow-2xl` ayırıyor.
    */
    <div className={"fixed inset-0 z-[9999] flex items-center justify-center bg-transparent backdrop-blur-[2px] p-4 " + overlay}>
      <div
        ref={boxRef}
        style={boxStyle}
        className={
          // `h-auto`: pencere İÇERİĞİ KADAR yer kaplar. Eskiden burada `h-[50vh]` vardı ve
          // kısa formlar ekranın yarısını kaplayıp altta boş alan bırakıyordu. İçerik
          // sığmazsa `max-h` devreye girer ve gövde kendi içinde kaydırılır.
          // `animate-fadeIn` TRANSFORM animasyonu: pencere taşındıysa devre dışı kalmalı,
          // yoksa animasyon süresince kendi `translate`i satır içi konumu ezer ve pencere
          // sürüklenirken bir an geri sıçrar.
          `bg-white rounded-xl shadow-2xl w-full ${widthCls} h-auto max-h-[calc(100vh_-_2rem)] flex flex-col overflow-hidden relative ${moved ? '' : 'animate-fadeIn'} ${container}`
        }
      >
        {!hideHeader && (
          <div
            onPointerDown={movable ? startDrag : undefined}
            className={
              'flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 ' +
              (movable ? 'cursor-move select-none touch-none' : '')
            }
            title={movable ? 'Taşımak için başlıktan sürükleyin' : undefined}
          >
            <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 transition">
              <X size={20} />
            </button>
          </div>
        )}

        {hideHeader && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-10 text-gray-400 hover:text-gray-600 transition"
            aria-label="Kapat"
            title="Kapat"
          >
            <X size={20} />
          </button>
        )}

        {/*
          `flex-auto` (flex: 1 1 auto), `flex-1` DEĞİL. `flex-1`in taban ölçüsü 0'dır; pencere
          yüksekliği `auto` olduğunda gövde kendi boyunu kapsayıcıya bildiremez ve `min-h-0`
          ile birlikte pencere sıfıra çökerdi. `auto` tabanla içerik boyu kapsayıcıya sayılır,
          `min-h-0` da `max-h` sınırına gelindiğinde küçülüp kaydırılmasına izin verir.
        */}
        <div className={isScrollable ? 'px-6 py-4 overflow-y-auto flex-auto min-h-0' : 'px-6 py-4 flex-auto min-h-0'}>{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 shrink-0">
            {footer}
          </div>
        )}

        {resizable && (
          <div
            onPointerDown={startResize}
            role="presentation"
            title="Boyutlandırmak için sürükleyin"
            className="absolute bottom-0 right-0 z-20 h-4 w-4 cursor-nwse-resize touch-none"
          >
            {/* Köşedeki üç çizgi: tutamağın orada olduğunu belli eder, tıklamayı engellemez. */}
            <svg viewBox="0 0 16 16" className="h-full w-full text-gray-400" aria-hidden="true">
              <path d="M15 5 L5 15 M15 9 L9 15 M15 13 L13 15" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
          </div>
        )}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return content
  return createPortal(content, document.body)
}
