const ACCESS_TOKEN_KEY = 'serviceOpsAccessToken'
const TENANT_CODE_KEY = 'serviceOpsTenantCode'
const USERNAME_KEY = 'serviceOpsUsername'
const USER_ID_KEY = 'serviceOpsUserId'
const USER_ROLE_KEY = 'serviceOpsUserRole'
const TECHNICIAN_ID_KEY = 'serviceOpsTechnicianId'
const DEALER_CODE_KEY = 'serviceOpsDealerCode'

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

/**
 * Yalnızca token'ı tazeler; kimliğe dair diğer alanlara dokunmaz.
 *
 * Ortak oturum uzatıldığında (buradan ya da bayiden) sunucu yeni bir token veriyor — kimlik aynı,
 * değişen tek şey bitiş anı. setSession çağırmak rol/teknisyen alanlarını yeniden yazmayı
 * gerektirirdi ve elde o bilgiler yok.
 */
export function setAccessToken(accessToken: string) {
  if (accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
}

function parseJwtPayload(token: string): any {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = parts[1]
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=')
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const json = new TextDecoder().decode(bytes)
    return JSON.parse(json)
  } catch (e) {
    console.error('Failed to parse JWT payload:', e)
    return null
  }
}

export function isAccessTokenExpired(token: string) {
  try {
    const payload = parseJwtPayload(token)
    const exp = Number(payload?.exp)
    if (!Number.isFinite(exp)) return false
    const nowSec = Math.floor(Date.now() / 1000)
    return nowSec >= exp
  } catch {
    return false
  }
}

export function isSessionValid() {
  const token = getAccessToken()
  if (!token) return false
  return !isAccessTokenExpired(token)
}

function getClaim(...names: string[]) {
  const token = getAccessToken()
  if (!token) return null
  try {
    const payload = parseJwtPayload(token)
    for (const name of names) {
      const value = payload?.[name]
      if (typeof value === 'string' && value.trim()) return value
      // A claim carrying more than one value arrives as an array — 'role' does exactly that for
      // a user holding both SuperAdmin and Admin. Only strings were accepted, so that user read
      // back as having no role at all and was treated as an ordinary one.
      if (Array.isArray(value)) {
        const first = value.find((v) => typeof v === 'string' && v.trim())
        if (first) return first
      }
    }
  } catch {
    return null
  }
  return null
}

/** Writes the value, or removes the key when there is no value. */
function writeOrClear(key: string, value: string | null | undefined) {
  if (value) localStorage.setItem(key, value)
  else localStorage.removeItem(key)
}

export function setSession(accessToken: string, tenantCode: string, username: string, opts?: { userId?: string; role?: string; technicianId?: string; dealerCode?: string }) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  localStorage.setItem(TENANT_CODE_KEY, tenantCode)
  localStorage.setItem(USERNAME_KEY, username)
  // Every optional field is written or removed, never left alone. Only truthy values used to be
  // stored, so a field the new session does not have kept the previous session's value: signing
  // in as an admin after a technician left `serviceOpsTechnicianId` behind, and the admin was
  // then read back as a technician for the rest of the session.
  writeOrClear(USER_ID_KEY, opts?.userId)
  writeOrClear(USER_ROLE_KEY, opts?.role)
  writeOrClear(TECHNICIAN_ID_KEY, opts?.technicianId)
  writeOrClear(DEALER_CODE_KEY, opts?.dealerCode)
}

export function clearSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(TENANT_CODE_KEY)
  localStorage.removeItem(USERNAME_KEY)
  localStorage.removeItem(USER_ID_KEY)
  localStorage.removeItem(USER_ROLE_KEY)
  localStorage.removeItem(TECHNICIAN_ID_KEY)
  localStorage.removeItem(DEALER_CODE_KEY)
}

export function getTenantCode() {
  return localStorage.getItem(TENANT_CODE_KEY)
}

export function getUsername() {
  return localStorage.getItem(USERNAME_KEY)
}

export function getUserId() {
  return localStorage.getItem(USER_ID_KEY) || getClaim('sub', 'nameid')
}

export function getUserRole() {
  return localStorage.getItem(USER_ROLE_KEY) || getClaim('role', 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role')
}

export function getTechnicianId() {
  return localStorage.getItem(TECHNICIAN_ID_KEY) || getClaim('technicianId')
}

export function getDealerCode() {
  return localStorage.getItem(DEALER_CODE_KEY) || getClaim('dealerCode')
}

/**
 * Kullanıcıya atanmış cari kodları.
 *
 * Cari yetkisi TEK BİR KOD DEĞİL, bir liste: B2B tarafında `Users.Carikodu` virgülle ayrılmış
 * kodlar tutar ve '*' "tüm cariler" demektir. Sunucu bunu böyle yorumluyor
 * (ServiceOpsPermissionService.ParseDealerCodes), arayüz ise alanın yalnızca DOLU olup
 * olmadığına bakıyordu.
 *
 * Sonucu şuydu: "tüm cariler (kısıtlamasız)" atanmış bir kullanıcıda değer '*' olduğu için alan
 * dolu sayılıyor, kullanıcı tek bir bayiye bağlıymış gibi davranılıyor ve cari seçimi
 * "Kendi bayi cariniz seçili" diyerek kilitleniyordu — oysa o kullanıcı bütün carilerle işlem
 * yapabilmeli.
 *
 * Boş dizi = kısıtlama yok.
 */
export function getDealerCodes(): string[] {
  const raw = getDealerCode()
  if (!raw) return []
  return String(raw)
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
}

/** Kullanıcı bütün carilerle çalışabiliyor mu ('*' ya da hiç kod atanmamış). */
export function hasAllDealers(): boolean {
  const codes = getDealerCodes()
  return codes.length === 0 || codes.includes('*')
}

/**
 * Kullanıcı TEK bir cariye bağlıysa o kod, değilse null.
 *
 * Cari alanının kilitlenmesi ve otomatik doldurulması yalnızca bu durumda doğrudur: seçilecek
 * başka bir şey yoktur. Birden fazla cari atanmışsa kullanıcı aralarından seçebilmeli.
 */
export function getSingleDealerCode(): string | null {
  if (hasAllDealers()) return null
  const codes = getDealerCodes()
  return codes.length === 1 ? codes[0] : null
}

/**
 * Whether this session is unrestricted, judged from what the browser holds.
 *
 * The server's answer on /api/auth/permissions is the authority; this is the local reading used
 * before that answer arrives and by code with no access to the context. It lived in three
 * separate copies — the shell, the permissions context and nothing at all in the route gate —
 * which is exactly how the menu came to show pages the gate then refused.
 */
export function isSuperAdminSession() {
  const role = (getUserRole() || '').toLowerCase()

  // Yalnızca İMZALI token'dan gelen rol. Buradan çıkarılanlar ve neden:
  //
  //   localStorage 'ssaViewMode' === 'global'  → tarayıcıdan serbestçe yazılabilen bir değerdi.
  //     DevTools'a `localStorage.ssaViewMode='global'` yazan herhangi bir kullanıcı arayüzde
  //     süper admin oluyordu: menüde bütün sayfalar açılıyor, rota kapısı geçiliyordu.
  //   username === 'ssa'  → kullanıcı adı firma yöneticisinin belirlediği bir veri; bir yetki
  //     kararı olamaz. (B2B tarafında aynı delik daha önce kapatılmıştı.)
  //   role === 'admin'  → B2B'den gelen teknisyen olmayan HERKES varsayılan olarak "Admin"
  //     etiketiyle geliyor; bu etiket bir yetki seviyesi değil.
  //
  // Bu değer yalnızca sunucunun cevabı gelmeden önceki ilk okuma içindir; yetkili kaynak
  // /api/auth/permissions yanıtındaki isSuperAdmin alanıdır (bkz. PermissionsContext).
  return role === 'superadmin' || role === 'supersuperadmin' || role === 'ssa'
}

export function isTechnicianSession() {
  // An unrestricted session is never a technician session, whatever else it carries. A user
  // whose ServiceOps record still points at a technician row keeps that id in the token even
  // after being made an admin, and the field-app route list would then lock them out of most
  // of the app.
  if (isSuperAdminSession()) return false
  const role = (getUserRole() || '').toLowerCase()
  if (role === 'admin' || role === 'müdür' || role === 'mudur' || role === 'manager' || role === 'ssa') {
    return false
  }
  return role === 'technician' || role === 'teknisyen' || !!getTechnicianId()
}

export function getTechnicianRoles(): string[] {
  const rolesStr = getClaim('technicianRoles')
  if (!rolesStr) return []
  return rolesStr.split(',').map((r: string) => r.trim()).filter(Boolean)
}
