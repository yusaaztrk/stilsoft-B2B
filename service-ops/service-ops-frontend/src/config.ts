/**
 * ServiceOps API adresi.
 *
 * YAYIN (IIS, tek site): API arayuzle AYNI kaynakta -> window.location.origin.
 * Onceki deger her zaman `http://${hostname}:5137` idi ve canlida CALISMAZDI: 5137 disariya
 * acik degil, ayrica https sayfadan http istek karisik icerik olarak engellenir.
 * Gelistirmede (Vite portlari / localhost) eski davranis aynen suruyor.
 */
export const API_BASE_URL =
  import.meta.env.VITE_SERVICE_OPS_API_BASE_URL ||
  (typeof window !== 'undefined'
    ? ['5173', '5174', '5175', '3000'].includes(window.location.port)
      ? `http://${window.location.hostname}:5137`
      : window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:5137'
      : window.location.origin
    : 'http://localhost:5137')

/**
 * B2B (bayi) arayuzunun adresi.
 *
 * NEDEN AYRI BIR COZUMLEYICI: bu adres `Header.tsx` ve `LoginPage.tsx` icinde
 * `hostname:5174` diye SABIT yazilmisti. 5174 ERP arayuzunun Vite gelistirme portu; yayinda
 * o port disariya kapali oldugu icin "B2B'ye don" baglantisi acilmayan bir adrese gidiyordu.
 * ERP tarafindaki `serviceOpsBaseUrl()` ile ayni kural, ters yonu.
 *
 * Sira: gelistirme ortami -> derlemeye gomulu deger -> alan adindan turetme
 * (`servis.<alan>` -> `erp.<alan>`).
 */
/**
 * Personel (İK) portalının adresi. `b2bBaseUrl` ile aynı kural; `servis.` öneki `personel.`
 * ile değiştirilir.
 *
 * Buraya da token EKLENMEZ — bkz. Header.buildB2BUrl'deki uyarı. Portalın kendi alan adında
 * ayrı bir oturumu var; kullanıcı bayiden bir kez geçtiyse orada zaten açıktır, değilse
 * portalın giriş ekranı firma seçili olarak gelir.
 *
 * Ayırt edilemeyen bir alanda BOŞ döner: kırık bir adrese götürmektense düğmeyi göstermemek.
 */
export function employeePortalBaseUrl(): string {
  if (typeof window === 'undefined') return ''

  const { protocol, hostname, port } = window.location

  if (['5173', '5174', '5175', '3000'].includes(port) || hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:5175`
  }

  const fromEnv = (import.meta as any)?.env?.VITE_EMPLOYEE_PORTAL_BASE_URL
  if (fromEnv) return String(fromEnv).replace(/\/+$/, '')

  if (hostname.startsWith('servis.')) {
    return `${protocol}//personel.${hostname.slice('servis.'.length)}`
  }

  return ''
}

export function b2bBaseUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:5174'

  const { protocol, hostname, port } = window.location

  if (['5173', '5174', '5175', '3000'].includes(port) || hostname === 'localhost' || hostname === '127.0.0.1') {
    return `${protocol}//${hostname}:5174`
  }

  const fromEnv = import.meta.env.VITE_B2B_BASE_URL
  if (fromEnv) return String(fromEnv).replace(/\/+$/, '')

  /*
    BAYI ALT ALANI ARTIK b2b. (2026-09-02 alan adi tasindi).

    Onceki kural servis.<alan> -> erp.<alan> diye SABIT yaziliydi. Alan adi
    b2b.example.com'a tasininca "Bayi'ye Gec" dugmesi olu adrese gidip Plesk'in
    404 sayfasini acti. ERP tarafi tersi yonde ikisini de taniyor
    (serviceOpsBaseUrl: 'erp.' ve 'b2b.'), bu taraf tanimiyordu.

    Farkli bir alan semasi kullanan kurulum VITE_B2B_BASE_URL ile derlemede sabitler;
    o deger yukarida zaten oncelikli okunuyor.
  */
  if (hostname.startsWith('servis.')) {
    return `${protocol}//b2b.${hostname.slice('servis.'.length)}`
  }

  // Ayirt edemedik: ayni kaynakta kal, kirik bir porta gitme.
  return `${protocol}//${hostname}`
}

/**
 * KULLANILMIYOR — tarayici ERP API'sine DOGRUDAN gitmez.
 * Butun ERP erisimi ServiceOps API'sindeki /api/erp/* vekil katmanindan gecer; iki alan adi
 * arasinda tarayici istegi olmadigi icin CORS da gerekmiyor.
 * Silinmedi ama yayinda yanlis adrese gitmesin diye gelistirme disinda origin'e dusuruldu.
 */
export const ERP_API_BASE_URL =
  import.meta.env.VITE_ERP_API_BASE_URL ||
  (typeof window !== 'undefined'
    ? ['5173', '5174', '5175', '3000'].includes(window.location.port)
      ? `http://${window.location.hostname}:5200`
      : window.location.origin
    : 'http://localhost:5200')
