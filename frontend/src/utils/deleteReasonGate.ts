/**
 * SİLME NEDENİ KAPISI (2026-10-04 kullanıcı isteği: "bir şey silerken neden siliniyor diye bir
 * modal koy, neden silindiğinin kaydı da Silinen Kayıtlar'da bulunsun").
 *
 * Kapı `main.tsx`'teki tek `fetch` kancasında: silme yirmiden fazla ekrandan yapılıyor ve her
 * birine ayrı pencere eklemek yirmi dokunuş, yirmi birincisinde unutmak demekti. Sunucu nedeni
 * `X-Delete-Reason` başlığından okuyup o istekte eklenen her silme kaydına yazıyor
 * (`AppDbContext.StampDeletionReasons`).
 *
 * YALNIZ "Silinen Kayıtlar"a yazan uçlar sorulur (liste aşağıda, sunucudaki `DeletionLogs`
 * yazan silme uçlarından çıkarıldı). Bildirim, sepet, filtre gibi silmelerde neden sormak hem
 * gereksiz hem de nedenin yazılacağı bir yer yok.
 *
 * İptal edilen silmede istek HİÇ gönderilmez; çağıran ekrana başarısız bir yanıt döner.
 */

export const DELETE_REASON_HEADER = 'X-Delete-Reason'

/** `DeletionLogs` yazan silme uçları (yol küçük harfe çevrilerek eşleşir). */
const REASON_REQUIRED_PATHS: RegExp[] = [
  /^\/api\/invoices\/\d+$/,
  /^\/api\/invoices\/\d+\/lines\/\d+$/,
  /^\/api\/purchase-invoices\/\d+$/,
  /^\/api\/salesorders\/\d+$/,
  /^\/api\/salesorders\/lines\/\d+$/,
  /^\/api\/irsaliye\/\d+$/,
  /^\/api\/irsaliye\/by-no\/[^/]+$/,
  /^\/api\/bankaccounttransactions\/\d+$/,
  /^\/api\/cashaccounttransactions\/\d+$/,
  /^\/api\/bankexpenses\/\d+$/,
  /^\/api\/bankaccountdefinitions\/\d+$/,
  /^\/api\/customerchecks\/\d+$/,
  /^\/api\/payablechecks\/\d+$/,
  /^\/api\/payablenotes\/\d+$/,
  /^\/api\/loans\/\d+$/,
  /^\/api\/cari-offers\/\d+(\/proforma)?$/,
  /^\/api\/customer-offers\/\d+(\/proforma)?$/,
  /^\/api\/warehousetransfers\/\d+$/,
  /^\/api\/warranty-exchanges\/\d+$/,
  /^\/api\/productcategories\/[^/]+$/,
  /^\/api\/accounting-periods\/\d+$/,
]

/** İsteğin yolu (sorgu dizesi ve alan adı olmadan, küçük harf). */
function pathOf(url: string): string {
  try {
    return new URL(url, window.location.origin).pathname.toLowerCase().replace(/\/+$/, '')
  } catch {
    return String(url).split('?')[0].toLowerCase()
  }
}

export function needsDeleteReason(method: string | undefined, url: string): boolean {
  if ((method ?? 'GET').toUpperCase() !== 'DELETE') return false
  const p = pathOf(url)
  return REASON_REQUIRED_PATHS.some((re) => re.test(p))
}

export type DeleteReasonRequest = { path: string }
type AskFn = (req: DeleteReasonRequest) => Promise<string | null>

let handler: AskFn | null = null

/** Pencere bileşeni monte olunca kendini kaydeder; sökülünce kaydı siler. */
export function registerDeleteReasonHandler(fn: AskFn | null) {
  handler = fn
}

/*
  TOPLU SİLME TEK SORU SORAR.

  Bazı ekranlar birden çok kaydı art arda ayrı DELETE istekleriyle siliyor (kalemler, toplu
  seçim). Her biri için pencere açılsaydı kullanıcı aynı nedeni N kez yazardı. Pencere açıkken
  gelen istekler aynı cevabı bekler; cevaptan sonra 5 saniye içinde gelenler de onu kullanır
  (her kullanım süreyi tazeler — uzun bir döngü kopmaz). Elle yapılan ayrı bir silme bu
  sürede bitmez: onay penceresi ve tıklama zaten saniyeler alıyor.
*/
const REUSE_WINDOW_MS = 5000
let pending: Promise<string | null> | null = null
let lastAnswer: { reason: string; at: number } | null = null

export function obtainDeleteReason(url: string): Promise<string | null> {
  if (lastAnswer && Date.now() - lastAnswer.at < REUSE_WINDOW_MS) {
    lastAnswer.at = Date.now()
    return Promise.resolve(lastAnswer.reason)
  }
  if (pending) return pending

  const ask: Promise<string | null> = handler
    ? handler({ path: pathOf(url) })
    : Promise.resolve((window.prompt('Bu kaydı neden siliyorsunuz?') ?? '').trim() || null)

  pending = ask
    .catch(() => null)
    .then((reason) => {
      pending = null
      const clean = (reason ?? '').trim()
      if (clean) lastAnswer = { reason: clean, at: Date.now() }
      return clean || null
    })
  return pending
}

/** Başlık ASCII taşır; Türkçe metin Base64'lenmiş UTF-8 olarak gider. */
export function encodeDeleteReason(reason: string): string {
  const bytes = new TextEncoder().encode(reason)
  let bin = ''
  bytes.forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin)
}

/** İptal edilen silmede çağırana dönen yanıt — istek sunucuya hiç gitmedi. */
export function cancelledDeleteResponse(): Response {
  return new Response(
    JSON.stringify({ success: false, message: 'Silme iptal edildi: silme nedeni girilmedi.' }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  )
}
