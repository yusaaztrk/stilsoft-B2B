import { getAccessToken, getTenantCode, getUsername } from './storage'
import { b2bBaseUrl, employeePortalBaseUrl } from '../config'

/**
 * Bu oturumu bayiye (B2B) taşıyan bağlantı.
 *
 * Kullanıldığı anda kuruluyor, memoize EDİLMİYOR: oturum localStorage'da duruyor ve orası
 * tepkisel değil. Bir kez hesaplanan değer, o anki token'ı taşımaya devam eder — girişten
 * hemen sonraki render'da boş, yenilemeden sonra bayat. İkisi de kullanıcıyı, oturumu
 * açıkken bayinin giriş ekranına düşürür. (B2B tarafındaki aynı tuzağın notu için bkz.
 * AppLayout.buildServiceOpsUrl.)
 *
 * Karşı taraf: B2B'de `RequireAuth` bu parametreleri okuyup `/api/auth/exchange` ile kendi
 * token'ına takas ediyor — servisin token'ı bayide doğrudan geçerli değil, iki API farklı
 * anahtarla imzalıyor.
 *
 * TEK KAYNAK: hem "Bayi'ye Geç" düğmesi hem araç deposundaki satış düğmesi buradan geçer.
 * İki kopya olsaydı biri güncellenip diğeri unutulduğunda kullanıcı giriş ekranına düşerdi.
 */
export function buildB2BUrl(path: string = '/') {
  const url = new URL(`${b2bBaseUrl()}${path}`)

  const token = getAccessToken()
  const tenant = getTenantCode()
  if (!token || !tenant) return url.toString()

  url.searchParams.set('sync_token', token)
  url.searchParams.set('sync_tenant', tenant)
  url.searchParams.set('sync_username', getUsername() || '')
  return url.toString()
}

/** Bayideki kredi kartı çekim ekranı. Çekimler "Kredi Kartı Çekim Raporu"na düşer. */
export const B2B_POS_PAYMENT_PATH = '/pos/posPayment'

/**
 * Personel (İK) portalına geçiş bağlantısı.
 *
 * Bayi bağlantısının aksine burada token YOK ve bu bilinçli: portalın kendi alan adında ayrı
 * bir oturumu var, kullanıcı bayiden bir kez geçtiyse orada zaten açıktır. Bu yönde adrese
 * token eklemek ayrıca yasak (gerekçe Header.buildB2BUrl'de yazılı). Yalnızca firma kodu
 * taşınır ki portalın giriş ekranı firmayı tekrar sordurmasın.
 *
 * Alan ayırt edilemezse BOŞ döner — çağıran taraf düğmeyi hiç göstermemeli.
 */
export function buildEmployeePortalUrl(): string {
  const base = employeePortalBaseUrl()
  if (!base) return ''
  try {
    const url = new URL(`${base}/login`)
    const tenant = getTenantCode() || ''
    if (tenant) url.searchParams.set('tenant', tenant)
    return url.toString()
  } catch {
    return ''
  }
}

/**
 * "Personele Geç" düğmesi gösterilsin mi?
 *
 * Bayrak bayiden devirle geliyor (`sync_employeeAccess`), yani yalnızca ERP'den geçmiş bir
 * yönetici oturumunda dolu olur. Şifresiyle giren teknisyende hiç oluşmaz.
 *
 * Yalnızca GÖSTERİM kapısı: elle değiştiren biri portala giremez — portal kendi
 * `Users.EmployeeAccess` denetimini ayrıca işletiyor.
 */
export function hasEmployeeAccess(): boolean {
  try {
    return localStorage.getItem('employeeAccess') === '1'
  } catch {
    return false
  }
}
