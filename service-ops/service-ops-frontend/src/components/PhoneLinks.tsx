import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Phone } from 'lucide-react'

/**
 * TELEFON NUMARASI + ARAMA / WHATSAPP KISAYOLU (kullanıcı isteği, 2026-08-13).
 *
 * Saha personeli listede gördüğü numarayı elle tuşluyordu; telefonda numarayı seçip kopyalamak
 * da zor. Numaranın yanındaki iki ikon doğrudan aramayı ve WhatsApp konuşmasını açar —
 * "direkt orada olduğu anlamına gelecek şekilde".
 *
 * Numara biçimlendirme burada TEK yerde:
 *  - `tel:` bağlantısı rakam dışını atar.
 *  - `wa.me` ÜLKE KODU İSTER ve baştaki sıfırı kabul etmez. Türkiye/KKTC numaraları sistemde
 *    `05XX...` ya da `5XX...` olarak tutuluyor; ikisi de 90 ile normalleştiriliyor. Zaten ülke
 *    kodu taşıyan numaralara (90/+90 ya da 10 haneden uzun) dokunulmuyor — yoksa yurt dışı
 *    numaraları bozardı.
 *
 * WHATSAPP BUSINESS (kullanıcı isteği, 2026-08-31): telefonda iki WhatsApp kurulu ve
 * `wa.me` her zaman VARSAYILAN uygulamayı açıyor; servis yazışması Business hattından
 * gitmeliydi. Mobilde ikona basınca hangi uygulamanın açılacağı SORULUYOR, seçim
 * hatırlanıyor (aşağıdaki `TERCIH_ANAHTARI`). Masaüstünde soru yok — orada tek WhatsApp
 * Web var, sormak gereksiz tıklama olurdu.
 */

type Props = {
  phone?: string | null
  /** Numaranın kendisi de basılsın mı; yalnızca ikon isteyen dar hücreler için false. */
  showNumber?: boolean
  /** Küçük satırlar (tablo hücresi) için daralttılmış ikonlar. */
  compact?: boolean
  className?: string
}

/** Kullanıcının WhatsApp tercihi; cihaz başına saklanır. */
type WhatsappUygulamasi = 'normal' | 'business'
const TERCIH_ANAHTARI = 'serviceops.whatsappUygulamasi'

function tercihOku(): WhatsappUygulamasi | null {
  try {
    const v = localStorage.getItem(TERCIH_ANAHTARI)
    return v === 'normal' || v === 'business' ? v : null
  } catch {
    // Gizli sekme / depolama kapalı: tercih yok sayılır, her seferinde sorulur.
    return null
  }
}

function tercihYaz(v: WhatsappUygulamasi) {
  try { localStorage.setItem(TERCIH_ANAHTARI, v) } catch { /* depolama yoksa sorun değil */ }
}

/** Ayarlardan "hangi WhatsApp" sorusunu geri getirmek için. */
export function whatsappTercihiniSifirla() {
  try { localStorage.removeItem(TERCIH_ANAHTARI) } catch { /* yok sayılır */ }
}

const mobilMi = () =>
  typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent)

const androidMi = () =>
  typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)

/**
 * Seçilen uygulamaya göre açılacak adres.
 *
 * Business'ı hedeflemenin TEK güvenilir yolu Android'in `intent://` biçimi: paket adı
 * (`com.whatsapp.w4b`) doğrudan yazılıyor. iOS'ta WhatsApp Business'ın ayrı bir URL
 * şeması YOK — orada seçim yapılsa bile `wa.me` açılır, yani varsayılan uygulama.
 */
function whatsappAdresi(numara: string, uygulama: WhatsappUygulamasi): string {
  if (uygulama === 'business' && androidMi()) {
    return `intent://send?phone=${numara}#Intent;scheme=whatsapp;package=com.whatsapp.w4b;end`
  }
  return `https://wa.me/${numara}`
}

/** Sadece rakamlar — `tel:` için yeterli. */
function digitsOf(phone: string): string {
  return phone.replace(/\D/g, '')
}

/**
 * WhatsApp için uluslararası biçim. Çözülemiyorsa `null` döner ve WhatsApp ikonu HİÇ
 * gösterilmez: yanlış numaraya açılan bir konuşma, ikonun hiç olmamasından kötüdür.
 */
export function whatsappNumber(phone: string): string | null {
  const digits = digitsOf(phone)
  if (digits.length < 10) return null

  if (digits.startsWith('90')) return digits
  if (digits.startsWith('0')) return `90${digits.slice(1)}`
  if (digits.length === 10) return `90${digits}`

  // 11+ hane ve 90 ile başlamıyorsa kendi ülke kodunu taşıyor kabul edilir.
  return digits
}

export default function PhoneLinks({ phone, showNumber = true, compact = false, className = '' }: Props) {
  // Hangi WhatsApp sorusu açık mı. Kanca koşulsuz çağrılır (erken return'ler aşağıda).
  const [secimAcik, setSecimAcik] = useState(false)

  const raw = String(phone ?? '').trim()
  if (!raw) return null

  const digits = digitsOf(raw)
  if (!digits) return <span className={className}>{raw}</span>

  const wa = whatsappNumber(raw)
  const iconSize = compact ? 'w-3.5 h-3.5' : 'w-4 h-4'
  const buttonBase = compact ? 'p-1' : 'p-1.5'

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      {showNumber && <span className="font-mono">{raw}</span>}

      <a
        href={`tel:${digits}`}
        onClick={(e) => e.stopPropagation()}
        title={`${raw} numarasını ara`}
        aria-label={`${raw} numarasını ara`}
        className={`${buttonBase} rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors shrink-0`}
      >
        <Phone className={iconSize} />
      </a>

      {wa && (
        <>
        <a
          href={whatsappAdresi(wa, tercihOku() ?? 'normal')}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            e.stopPropagation()
            // Mobilde tercih HENÜZ yoksa: bağlantıyı açma, önce hangi uygulama diye sor.
            if (mobilMi() && !tercihOku()) {
              e.preventDefault()
              setSecimAcik(true)
            }
          }}
          onContextMenu={(e) => {
            // Uzun basış / sağ tık: seçimi değiştirmenin yolu. Tercih kilitli kalmasın.
            if (!mobilMi()) return
            e.preventDefault()
            e.stopPropagation()
            setSecimAcik(true)
          }}
          title={`${raw} numarasına WhatsApp'tan yaz${mobilMi() ? ' (uygulamayı değiştirmek için basılı tutun)' : ''}`}
          aria-label={`${raw} numarasına WhatsApp'tan yaz`}
          className={`${buttonBase} rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors shrink-0`}
        >
          {/* lucide'de WhatsApp ikonu yok; markanın kendi işareti gömülü SVG olarak duruyor. */}
          <svg viewBox="0 0 24 24" fill="currentColor" className={iconSize} aria-hidden="true">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884a9.82 9.82 0 016.988 2.896 9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.359.101 11.945c0 2.096.549 4.142 1.595 5.945L0 24l6.305-1.654a11.94 11.94 0 005.71 1.454h.006c6.585 0 11.946-5.36 11.949-11.945a11.86 11.86 0 00-3.45-8.406" />
          </svg>
        </a>

        {secimAcik && createPortal(
          /*
            Portal + ortalanmış kutu: popover olarak konumlandırılınca tablo hücresinin
            `overflow` sınırında kırpılıyordu. Mobilde ortada açılan kutu zaten daha rahat.
          */
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={(e) => { e.stopPropagation(); setSecimAcik(false) }}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden animate-fadeIn"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="text-sm font-bold text-gray-900">Hangi WhatsApp?</div>
                <div className="text-[11px] text-gray-500 font-mono mt-0.5">{raw}</div>
              </div>

              {([
                ['normal', 'WhatsApp'],
                ['business', 'WhatsApp Business'],
              ] as [WhatsappUygulamasi, string][]).map(([deger, etiket]) => (
                <a
                  key={deger}
                  href={whatsappAdresi(wa, deger)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    e.stopPropagation()
                    tercihYaz(deger)
                    setSecimAcik(false)
                  }}
                  className="block px-4 py-3 text-sm font-semibold text-gray-800 hover:bg-emerald-50 border-b border-gray-50 cursor-pointer"
                >
                  {etiket}
                </a>
              ))}

              <div className="px-4 py-2.5 text-[11px] text-gray-400 leading-snug bg-slate-50">
                Seçiminiz hatırlanır. Değiştirmek için WhatsApp ikonuna basılı tutun.
              </div>
            </div>
          </div>,
          document.body
        )}
        </>
      )}
    </span>
  )
}