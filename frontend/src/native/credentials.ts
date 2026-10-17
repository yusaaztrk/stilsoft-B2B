/**
 * TELEFON KABUĞUYLA GİRİŞ BİLGİSİ KÖPRÜSÜ (2026-08-24).
 *
 * Saha uygulaması (`service-ops-webview`) servis arayüzünü bir WebView'de açıyor. Kullanıcı
 * oradan "BAYİ'YE GEÇ" ile bu arayüze geldiğinde parola soruluyordu: bayi ve servis AYRI alan
 * adları, tarayıcı deposu da alan adı başına ayrı, dolayısıyla servise girmiş olmak buraya
 * bir şey taşımıyor. Sahada her geçişte parola girmek iş yavaşlatıyordu.
 *
 * Çözüm, kullanıcı isteğiyle: kabuk ilk girişteki bilgileri ŞİFRELİ saklıyor (Android
 * Keystore) ve giriş ekranı her açıldığında geri veriyor. Bu dosya o köprünün bayi
 * tarafındaki yarısı; karşılığı `service-ops-webview/src/bridge/types.ts`. İKİSİ BİRLİKTE
 * DEĞİŞMELİ — alan adı bir tarafta değişip öbüründe kalırsa hata çıkmaz, otomatik giriş
 * sessizce çalışmaz.
 *
 * TARAYICIDA HİÇBİR ŞEY YAPMAZ: `window.ReactNativeWebView` yoksa her fonksiyon ilk satırda
 * döner. Yani masaüstünde parola hiçbir yere yazılmaz, davranış aynen eskisi gibi kalır.
 */

type OutboundMessage =
  | { type: 'credentials:save'; tenantCode: string | null; username: string; password: string }
  | { type: 'credentials:clear' }
  | { type: 'credentials:request' }

type InboundMessage = {
  type: 'credentials'
  tenantCode: string | null
  username: string
  password: string
}

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (data: string) => void }
    /** Kabuk bu fonksiyonu çağırarak sayfaya mesaj geçirir. */
    __serviceOpsNative?: (message: any) => void
  }
}

/** Sayfa telefon kabuğunun içinde mi? */
export function isNativeShell(): boolean {
  return typeof window !== 'undefined' && !!window.ReactNativeWebView
}

function postToNative(message: OutboundMessage): boolean {
  if (!isNativeShell()) return false
  try {
    window.ReactNativeWebView!.postMessage(JSON.stringify(message))
    return true
  } catch {
    return false
  }
}

/** Başarılı girişten SONRA çağrılır. Başarısız deneme saklanmaz. */
export function saveCredentialsNative(credentials: {
  tenantCode: string | null
  username: string
  password: string
}): boolean {
  if (!credentials.username || !credentials.password) return false
  return postToNative({ type: 'credentials:save', ...credentials })
}

/**
 * Kayıtlı bilgiyi siler. YALNIZCA açık çıkışta çağrılır — oturum süresi dolduğunda değil.
 * Süre dolması beklenen bir şey ve otomatik giriş tam da onun için var; çıkış ise
 * kullanıcının kendi iradesi, uygulamanın onu hemen geri sokması hesap değiştirmeyi de
 * imkânsız kılardı.
 */
export function clearCredentialsNative(): boolean {
  return postToNative({ type: 'credentials:clear' })
}

/** Kayıtlı bilgiyi ister; cevap `native:credentials` olayıyla gelir. */
export function requestCredentialsNative(): boolean {
  return postToNative({ type: 'credentials:request' })
}

/**
 * Kabuktan gelen mesajları dinlemeye başlar.
 *
 * `__serviceOpsNative` bu arayüzde başka hiçbir yerde tanımlı değil; servis arayüzündeki
 * köprünün karşılığı burada yalnızca giriş bilgisiyle sınırlı tutuldu — indirme/yazdırma
 * yakalaması bayi tarafında istenmedi.
 */
export function installCredentialsBridge() {
  if (!isNativeShell()) return

  window.__serviceOpsNative = (message: any) => {
    try {
      if (message?.type !== 'credentials') return
      const detail = message as InboundMessage
      window.dispatchEvent(new CustomEvent('native:credentials', { detail }))
    } catch {
      /* kabuktan gelen mesaj sayfayı düşürmesin */
    }
  }
}
