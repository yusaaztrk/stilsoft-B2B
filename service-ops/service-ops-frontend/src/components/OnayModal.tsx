import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'

/**
 * "EMİN MİSİNİZ?" ONAY PENCERESİ (kullanıcı isteği, 2026-08-31).
 *
 * Neden `window.confirm` değil: saha ekibi ServiceOps'u WebView uygulamasından kullanıyor.
 * Android WebView, `WebChromeClient.onJsConfirm` uygulanmadığında `confirm()` çağrısını
 * kutu GÖSTERMEDEN yanıtlar — yani kayıt sil düğmesi ya hiç sormadan siliyor ya da hiç
 * çalışmıyordu. Kendi modalimiz her yerde aynı davranır ve mobilde okunaklı.
 *
 * Kullanım (window.confirm'in birebir yerine geçer):
 *
 *   const { onayIste, onayPenceresi } = useOnay()
 *   ...
 *   if (!(await onayIste({ mesaj: 'Silinsin mi?', tehlikeli: true }))) return
 *   ...
 *   return (<>{onayPenceresi}...</>)
 */

export type OnayIstegi = {
  baslik?: string
  mesaj: string
  /** Onay düğmesinin yazısı. Ne olacağını söylesin: "Sil", "Aktar" — "Tamam" değil. */
  onayEtiketi?: string
  vazgecEtiketi?: string
  /** Kırmızı düğme + uyarı ikonu; geri alınamayan işler için. */
  tehlikeli?: boolean
}

export function useOnay() {
  const [istek, setIstek] = useState<OnayIstegi | null>(null)
  // Cevap, açılışta kurulan promise'in resolve'u. Ref: yeniden çizim tetiklemesin.
  const cevapla = useRef<((onaylandi: boolean) => void) | null>(null)

  const kapat = useCallback((onaylandi: boolean) => {
    cevapla.current?.(onaylandi)
    cevapla.current = null
    setIstek(null)
  }, [])

  const onayIste = useCallback((yeni: OnayIstegi) => {
    // Üst üste iki istek gelirse önceki askıda kalmasın: hayır sayılıp kapanır.
    cevapla.current?.(false)
    setIstek(yeni)
    return new Promise<boolean>((resolve) => { cevapla.current = resolve })
  }, [])

  const onayPenceresi = istek
    ? createPortal(
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => kapat(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fadeIn"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 flex gap-3 items-start">
              {istek.tehlikeli && (
                <span className="shrink-0 w-9 h-9 rounded-full bg-red-50 border border-red-200 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </span>
              )}
              <div className="min-w-0">
                <div className="font-bold text-gray-900 text-sm">
                  {istek.baslik ?? 'Emin misiniz?'}
                </div>
                <div className="mt-1 text-xs text-gray-600 leading-relaxed whitespace-pre-line">
                  {istek.mesaj}
                </div>
              </div>
            </div>

            <div className="px-5 pb-5 flex gap-2">
              <button
                type="button"
                onClick={() => kapat(false)}
                className="flex-1 py-2 rounded-xl border border-gray-200 bg-white text-gray-700 text-xs font-semibold hover:bg-gray-50 cursor-pointer"
              >
                {istek.vazgecEtiketi ?? 'Vazgeç'}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => kapat(true)}
                className={
                  'flex-1 py-2 rounded-xl text-xs font-bold text-white cursor-pointer transition-colors ' +
                  (istek.tehlikeli
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-gray-900 hover:bg-gray-800')
                }
              >
                {istek.onayEtiketi ?? 'Evet, devam et'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )
    : null

  return { onayIste, onayPenceresi }
}
