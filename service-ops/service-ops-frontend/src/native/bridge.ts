/**
 * WebView kabuğu ile web uygulaması arasındaki TEK köprü.
 *
 * Uygulama telefonda bir React Native WebView'ün içinde açılıyor. Tarayıcının kendiliğinden
 * yaptığı üç iş WebView'de HİÇ çalışmıyor ve hata da vermiyor — kullanıcı düğmeye basar,
 * hiçbir şey olmaz:
 *
 *   1. Blob indirme (`<a download>`): WebView indirme yöneticisi yoktur.
 *   2. `window.print()`: Android WebView'de bu fonksiyon tanımlı bile değildir.
 *   3. Konum: izin diyaloğu native tarafta açılmadıkça `navigator.geolocation` sessizce reddedilir.
 *
 * Bu dosya üçünü de yakalayıp native tarafa devrediyor. Tarayıcıda açıldığında hiçbir şeye
 * dokunmaz: `installNativeBridge()` kabuk yoksa ilk satırda geri döner, yani masaüstü davranışı
 * bire bir aynı kalır. Sayfaların hiçbiri değişmedi; yakalama DOM seviyesinde yapılıyor.
 */

import { getAccessToken, getTechnicianId, getTenantCode, getUserRole, getUsername } from '../auth/storage'

/** Web'den native'e giden mesajlar. Karşılığı RN kabuğundaki `handleWebMessage`. */
export type NativeOutboundMessage =
  | { type: 'session'; accessToken: string | null; tenantCode: string | null; username: string | null; role: string | null; technicianId: string | null }
  | { type: 'download'; fileName: string; mimeType: string; base64: string }
  | { type: 'print'; html: string }
  | { type: 'navigated'; path: string }
  | { type: 'credentials:save'; tenantCode: string | null; username: string; password: string }
  | { type: 'credentials:clear' }
  | { type: 'credentials:request' }

/** Native'den web'e gelen mesajlar. Kabuk `injectJavaScript` ile bu olayı tetikler. */
export type NativeInboundMessage =
  | { type: 'navigate'; path: string }
  | { type: 'logout' }
  | { type: 'credentials'; tenantCode: string | null; username: string; password: string }

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (data: string) => void }
    /** Native taraf bu fonksiyonu çağırarak web'e mesaj geçirir. */
    __serviceOpsNative?: (message: NativeInboundMessage) => void
  }
}

/** Uygulama RN WebView kabuğunun içinde mi? */
export function isNativeShell(): boolean {
  return typeof window !== 'undefined' && !!window.ReactNativeWebView
}

function postToNative(message: NativeOutboundMessage): boolean {
  if (!isNativeShell()) return false
  try {
    window.ReactNativeWebView!.postMessage(JSON.stringify(message))
    return true
  } catch {
    return false
  }
}

/**
 * Fişi native yazıcıya gönderir.
 *
 * `printServiceSlip` burayı çağırıyor; `true` dönerse tarayıcı yolu hiç denenmez.
 */
export function printHtmlNative(html: string): boolean {
  return postToNative({ type: 'print', html })
}

/*
  HATIRLANAN GİRİŞ BİLGİSİ (2026-08-24, kullanıcı isteği).

  Telefonda bayi ve servis AYRI alan adları; tarayıcı deposu alan adı başına ayrı olduğu için
  teknisyen servise girdikten sonra bayiye geçince orada oturum bulunmuyor ve parola
  soruluyordu. Kabuk her iki alan adını da gördüğü için bilgiyi TEK yerde, şifreli olarak
  o saklıyor (Android Keystore).

  Tarayıcıda hiçbiri çalışmaz — `postToNative` kabuk yoksa `false` döner. Yani masaüstünde
  parola hiçbir yere yazılmaz, davranış aynen eskisi gibi kalır.
*/

/** Başarılı girişten SONRA çağrılır. Başarısız deneme saklanmaz. */
export function saveCredentialsNative(
  credentials: { tenantCode: string | null; username: string; password: string },
): boolean {
  if (!credentials.username || !credentials.password) return false
  return postToNative({ type: 'credentials:save', ...credentials })
}

/**
 * Kayıtlı bilgiyi siler. YALNIZCA açık çıkışta çağrılır — oturum süresi dolduğunda değil.
 * Süre dolması beklenen bir şey ve otomatik giriş tam da onun için var; çıkış ise
 * kullanıcının "beni çıkar" demesidir, uygulamanın onu hemen geri sokması yanlış olurdu
 * (hesap değiştirmek de imkânsız hâle gelirdi).
 */
export function clearCredentialsNative(): boolean {
  return postToNative({ type: 'credentials:clear' })
}

/**
 * Kayıtlı bilgiyi ister. Cevap `credentials` mesajıyla `onNativeMessage`'a düşer.
 * Kayıt yoksa da cevap gelir (boş kullanıcı adıyla), böylece giriş ekranı cevap bekleyip
 * takılmaz.
 */
export function requestCredentialsNative(): boolean {
  return postToNative({ type: 'credentials:request' })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const result = String(reader.result || '')
      // data:<mime>;base64,<veri> — native tarafa yalnızca veri kısmı gidiyor.
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

/**
 * `<a download>` tıklamalarını yakalar.
 *
 * Excel ve CSV dışa aktarma dokuz ayrı sayfada, hepsi aynı kalıpla (blob → gizli bağlantı →
 * click) yazılmış; ayrıca `XLSX.writeFile` kendi içinde aynı şeyi yapıyor. On ayrı çağrı yerini
 * düzenlemek yerine tıklama YAKALAMA aşamasında kesiliyor: kalıba uyan her indirme, nereden
 * gelirse gelsin native tarafa düşer.
 */
function installDownloadInterceptor() {
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest?.('a[download]') as HTMLAnchorElement | null
      if (!anchor) return

      const href = anchor.getAttribute('href') || ''
      if (!href.startsWith('blob:') && !href.startsWith('data:')) return

      event.preventDefault()
      event.stopPropagation()

      const fileName = anchor.getAttribute('download') || 'dosya'
      void (async () => {
        try {
          const response = await fetch(href)
          const blob = await response.blob()
          const base64 = await blobToBase64(blob)
          postToNative({
            type: 'download',
            fileName,
            mimeType: blob.type || 'application/octet-stream',
            base64
          })
        } catch {
          // Sessiz kalmak, kullanıcının "bastım ama bir şey olmadı" durumuna geri dönmesi demek.
          // Uyarı şeridi kabukta değil burada: metin ve dil zaten burada.
          const { toast } = await import('sonner')
          toast.error('Dosya kaydedilemedi.')
        }
      })()
    },
    true
  )
}

/**
 * `window.print()` çağrılarını native yazdırmaya çevirir.
 *
 * Android WebView'de `window.print` tanımsızdır: iki sayfadaki "Yazdır" düğmesi hata bile
 * vermeden hiçbir şey yapmıyordu. Yerine geçen fonksiyon o anki sayfanın HTML'ini native tarafa
 * gönderir.
 */
function installPrintInterceptor() {
  window.print = () => {
    const html = `<!doctype html><html><head><meta charset="utf-8">${document.head.innerHTML}</head><body>${document.body.innerHTML}</body></html>`
    printHtmlNative(html)
  }
}

function readSession(): Extract<NativeOutboundMessage, { type: 'session' }> {
  return {
    type: 'session',
    accessToken: getAccessToken(),
    tenantCode: getTenantCode(),
    username: getUsername(),
    role: getUserRole(),
    technicianId: getTechnicianId()
  }
}

let lastSessionSignature = ''

/**
 * Oturumu native tarafa bildirir.
 *
 * Kabuğun iki işi için gerekli: konumu `/api/technicians/{id}/location` adresine yazmak ve
 * bildirim cihaz kaydını yapmak. İkisi de token, firma kodu ve teknisyen kimliği ister; bu
 * bilgiler yalnızca web tarafında, `localStorage`'da duruyor.
 *
 * Aynı oturum tekrar tekrar gönderilmiyor: kabuk her mesajda konum servisini yeniden kurmak
 * zorunda kalmasın.
 */
export function publishSessionToNative() {
  if (!isNativeShell()) return
  const session = readSession()
  const signature = `${session.accessToken}|${session.tenantCode}|${session.technicianId}`
  if (signature === lastSessionSignature) return
  lastSessionSignature = signature
  postToNative(session)
}

/**
 * Köprüyü kurar. `main.tsx`'ten bir kez çağrılır.
 *
 * Kabuk yoksa hiçbir şey yapmaz — tarayıcıdaki davranış değişmez.
 */
export function installNativeBridge(onNativeMessage?: (message: NativeInboundMessage) => void) {
  if (!isNativeShell()) return

  installDownloadInterceptor()
  installPrintInterceptor()

  window.__serviceOpsNative = (message: NativeInboundMessage) => {
    try {
      onNativeMessage?.(message)
    } catch {
      /* kabuktan gelen mesaj uygulamayı düşürmesin */
    }
  }

  publishSessionToNative()
  // Oturum girişte, çıkışta ve süre uzatmada değişiyor; hepsi localStorage'a yazıyor ama aynı
  // sekmede `storage` olayı tetiklenmediği için yoklama gerekiyor. Beş saniye, teknisyenin
  // girişten sonra konum takibinin başlamasını beklediği en uzun süre.
  window.setInterval(publishSessionToNative, 5000)
}
