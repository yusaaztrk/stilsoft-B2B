import { API_BASE_URL } from '../config/api'

/**
 * SERVİSTEN (ServiceOps) DEVREDİLEN OTURUM — tek kaynak.
 *
 * Kullanıcının şikâyeti: "servisten bayiye, bayiden servise geçişte her seferinde şifre istiyor,
 * oturumlar karışıyor". Sebebi tek bir eksik değildi, dört ayrı kusur üst üsteydi:
 *
 *  1. **Açık oturum, devri TAMAMEN İPTAL ediyordu.** `RequireAuth` yalnızca `accessToken` YOKKEN
 *     takas yapıyordu. Tarayıcıda bayat/süresi dolmuş bir token duruyorsa devir hiç çalışmıyor,
 *     kullanıcı o ölü token'la devam ediyor, ilk istek 401 alıyor ve giriş ekranına düşüyordu —
 *     "her seferinde şifre istiyor" tam olarak buydu. Token BAŞKA bir kullanıcıya aitse daha da
 *     kötüsü oluyordu: serviste A ile çalışan kişi bayide B'nin oturumunda buluyordu kendini.
 *     Kural: devir parametresi geldiyse HER ZAMAN takas edilir. Karşı taraftan imzalı, taze bir
 *     token gelmişken elde tutulan eskisine güvenmek için sebep yok.
 *
 *  2. **Kimlik YARIM yazılıyordu.** `if (currentCode) setItem(...)` biçimindeki yazımlar, yeni
 *     kullanıcıda o alan boş geldiğinde ÖNCEKİ kullanıcının değerini yerinde bırakıyordu. Cari
 *     kodu ve rol kodu bu şekilde iki kullanıcı arasında sızıyordu. Artık alan boşsa SİLİNİYOR.
 *
 *  3. **`/login`'e düşen devir kayboluyordu.** Devri yalnızca `RequireAuth` tüketiyordu; herhangi
 *     bir sebeple adres `/login`'e yönlenirse (yer imi, yönlendirme, eski bağlantı) parametreler
 *     çöpe gidiyor ve giriş formu açılıyordu. ServiceOps tarafı bunu çözmüştü, bayi tarafı
 *     çözmemişti.
 *
 *  4. **Token adres çubuğunda kalıyordu** — takas atlandığında temizlik de atlanıyordu.
 *
 * Servisin token'ı bayide DOĞRUDAN kullanılamaz: iki API farklı anahtarla imzalıyor. `exchange`
 * ucunda bir kez doğrulanıp bayinin kendi token'ına çevriliyor.
 */

export type Handover = {
  token: string
  tenant: string
}

/** Devirle birlikte taşınan ve tüketildikten sonra adresten silinmesi gereken parametreler. */
const HANDOVER_PARAMS = [
  'sync_token',
  'sync_tenant',
  'sync_username',
  'sync_userId',
  'sync_role',
  'sync_technicianId',
  'sync_dealerCode'
]

/**
 * Adres çubuğunda devir var mı.
 *
 * YALNIZCA token + firma aranır. `sync_username` bilerek şart DEĞİL: kullanıcı adı gösterim
 * içindir, kimliği token taşır. ServiceOps tarafı bir ara onu da zorunlu tutuyordu ve
 * `localStorage.userName` boş olan her oturumda (bazı giriş yolları onu hiç yazmıyor) devir
 * "yok" sayılıp giriş formu açılıyordu.
 */
export function readHandover(search: string = window.location.search): Handover | null {
  const p = new URLSearchParams(search)
  const token = (p.get('sync_token') ?? '').trim()
  const tenant = (p.get('sync_tenant') ?? '').trim()
  if (!token || !tenant) return null
  return { token, tenant }
}

/** Devir parametrelerini adresten siler; sayfanın kendi sorgu parametrelerine dokunmaz. */
export function stripHandoverFromUrl() {
  const url = new URL(window.location.href)
  let changed = false
  for (const key of HANDOVER_PARAMS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      changed = true
    }
  }
  if (!changed) return
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

/**
 * Oturumu kullanıcı değişimine hazırlar.
 *
 * Devir başka bir kullanıcıyı getiriyor olabilir; önceki kullanıcının kapsam anahtarları
 * (cari kodu, rol, kullanıcı kimliği) yerinde kalırsa iki kimlik birbirine karışır. Token'ın
 * kendisi burada silinmez — takas başarısız olursa kullanıcının mevcut oturumu bozulmasın.
 */
function clearIdentityScope() {
  // `allowedKeys` de silinir: menü izinlerinin önbelleğidir ve devirle kullanıcı
  // değişebiliyor. Yerinde bırakılırsa yeni kullanıcı, sunucudan taze liste gelene kadar
  // ÖNCEKİ kullanıcının sayfa anahtarlarıyla çalışır.
  for (const key of ['currentCode', 'roleCode', 'userId', 'userName', 'tenantName', 'allowedKeys', 'employeeAccess', 'asistanAccess']) {
    localStorage.removeItem(key)
  }
  sessionStorage.removeItem('userName')
}

/**
 * Servisin token'ını bayinin kendi token'ına çevirir ve oturumu yazar.
 *
 * Başarılı olursa `true` döner ve adres temizlenir. Başarısız olursa `false` döner; çağıran
 * giriş ekranını göstermeli — devir parametreleri BİLEREK adreste bırakılır ki `/login`
 * tekrar deneyebilsin.
 */
export async function consumeHandover(handover: Handover, signal?: AbortSignal): Promise<boolean> {
  const res = await fetch(`${API_BASE_URL}/api/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: handover.token, tenantCode: handover.tenant }),
    signal
  })

  const json = await res.json().catch(() => null)
  const data = json?.data
  const accessToken = String(data?.accessToken ?? '')

  if (!res.ok || !accessToken) return false

  clearIdentityScope()

  localStorage.setItem('accessToken', accessToken)
  localStorage.setItem('tenantCode', handover.tenant)

  const userName = String(data?.username ?? data?.userName ?? '').trim()
  if (userName) {
    localStorage.setItem('userName', userName)
    sessionStorage.setItem('userName', userName)
  }

  const currentCode = String(data?.currentCode ?? '').trim()
  if (currentCode) localStorage.setItem('currentCode', currentCode)

  const roleCode = String(data?.roleCode ?? '').trim()
  if (roleCode) localStorage.setItem('roleCode', roleCode)

  // "Personele Geç" düğmesinin görünürlüğü. Devirle kullanıcı değişebildiği için
  // `clearIdentityScope` bunu da siliyor; burada YENİ kullanıcının değeriyle yazılır.
  localStorage.setItem('employeeAccess', data?.employeeAccess ? '1' : '0')
  localStorage.setItem('asistanAccess', data?.asistanAccess ? '1' : '0')

  const userId = String(data?.userId ?? '').trim()
  if (userId) localStorage.setItem('userId', userId)

  stripHandoverFromUrl()
  return true
}
