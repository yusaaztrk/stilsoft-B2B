/**
 * Portal sayfa yetkileri.
 *
 * Yetkiler giriş cevabında geliyor (`allowedPages`) ve `Pages.Key` değerlerini taşıyor —
 * ERP'deki Rol Yetkileri > Çalışan Yönetimi altındaki satırlar. Menü ve rotalar bu listeye
 * göre süzülür.
 *
 * ⚠️ Bu SÜZGEÇ, kapı değil. Sunucu tarafında şu an modül seviyesinde kaba bir kapı var
 * (`PageAuthorizationFilter`); sayfa bazlı kısıtlama yalnızca burada. Ucu doğrudan çağıran
 * birine karşı korumaz.
 */

const STORAGE_KEY = 'portalAllowedPages'
const MANAGER_KEY = 'portalIsErpManager'

export type PortalPageKey =
  | 'personelPanel'
  | 'personelCalisanlar'
  | 'personelIzinler'
  | 'personelHakedis'
  | 'personelEkstre'
  | 'personelMaas'
  | 'personelAvans'
  | 'personelPrim'
  | 'personelYemek'
  | 'personelKasa'
  | 'personelMesaiTanimlari'
  | 'personelTatilTakvimi'
  | 'personelYuzLink'
  | 'personelQrTest'
  | 'personelKonumAyarlari'

export function storeSessionPermissions(allowedPages: unknown, isErpManager: boolean) {
  try {
    const keys = Array.isArray(allowedPages)
      ? allowedPages.map((x) => String(x)).filter((x) => x.length > 0)
      : []
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
    localStorage.setItem(MANAGER_KEY, isErpManager ? '1' : '0')
  } catch {
    // localStorage kapalıysa yetki süzgeci uygulanamaz; sunucu kapısı yerinde kalır.
  }
}

export function clearSessionPermissions() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(MANAGER_KEY)
  } catch {}
}

/** ERP'de açılmış bir yönetici hesabıyla (ya da SSA ile) girildi mi? */
export function isErpManagerSession(): boolean {
  try {
    return localStorage.getItem(MANAGER_KEY) === '1'
  } catch {
    return false
  }
}

function readAllowedPages(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : null
  } catch {
    return null
  }
}

/**
 * Bu oturum verilen sayfayı görebilir mi?
 *
 * Yetki listesi HİÇ YOKSA (eski oturum, ya da yetki kapısına girmeyen çalışan girişi)
 * `true` döner: bu özellik gelmeden önce açılmış oturumlar ve self-servis girişi
 * kilitlenmesin. Liste VARSA — yani sunucu bir yetki kümesi göndermişse — yalnızca
 * içindeki anahtarlar geçer.
 */
export function canViewPage(key: PortalPageKey | string): boolean {
  const allowed = readAllowedPages()
  if (allowed === null) return true
  if (!isErpManagerSession()) return true
  return allowed.includes(String(key))
}

/** Yönetici oturumunun görebildiği İLK sayfanın rotası; hiçbiri yoksa null. */
export function firstAllowedRoute(): string | null {
  const order: Array<[PortalPageKey, string]> = [
    ['personelPanel', '/dashboard'],
    ['personelCalisanlar', '/employees'],
    ['personelIzinler', '/leaves'],
    ['personelHakedis', '/accruals'],
    ['personelEkstre', '/ledger'],
    ['personelMaas', '/payments/salary'],
    ['personelAvans', '/payments/advance'],
    ['personelPrim', '/payments/bonus'],
    ['personelYemek', '/payments/meal'],
    ['personelKasa', '/cash-transactions'],
    ['personelMesaiTanimlari', '/work-schedules'],
    ['personelTatilTakvimi', '/work-calendar'],
    ['personelYuzLink', '/face-link'],
    ['personelQrTest', '/qr-test'],
    ['personelKonumAyarlari', '/location-settings']
  ]
  for (const [key, route] of order) {
    if (canViewPage(key)) return route
  }
  return null
}
