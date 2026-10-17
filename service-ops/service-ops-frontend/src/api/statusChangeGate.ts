import type { StatusChangeConfirmRequest } from '../components/StatusChangeConfirm'

/**
 * DURUM DEĞİŞİKLİĞİ KAPISI — tek nokta.
 *
 * Kullanıcı kuralı (2026-08-13): "serviste yapılan her durum/state güncellemesi olan yerde" onay
 * ekranı çıkmalı. ServiceOps'ta durum değiştiren 30'dan fazla çağrı yeri var ve bunları teker
 * teker sarmak, bir tanesini unutmak demek — nitekim bu kod tabanında "yetki anahtarı tanımlandı
 * ama hiçbir yerde kontrol edilmedi" hatası daha önce yaşandı.
 *
 * Bu yüzden kapı `apiFetch`in içinde: durum değiştiren bir uca giden HER istek, gövdesi
 * gönderilmeden önce buradan geçer. Yeni bir ekran yazan kişi hiçbir şey yapmasa da onay ekranı
 * çıkar; unutma ihtimali kalmıyor.
 *
 * İki tamamlayıcı yol var:
 *  - `describeNextStatusChange(...)`: çağrı yeri, sunucuya gitmeyen bağlamı (mevcut durumun adı,
 *    eklenen görsel sayısı, hangi kalem) bir sonraki istek için bırakır. Zorunlu değil; verilmezse
 *    özet gövdeden çıkarılabildiği kadar kurulur.
 *  - `runStatusChange(...)`: TOPLU işlemler için. 12 satırı birden güncelleyen bir ekran 12 ayrı
 *    onay penceresi açmamalı; bu sarmalayıcı bir kez sorar, içerideki istekleri muaf tutar.
 */

export type StatusChangeHint = Partial<Omit<StatusChangeConfirmRequest, 'toLabel'>> & {
  /** Verilirse gövdeden okunan durum yerine bu kullanılır. */
  toLabel?: string
}

type ConfirmFn = (request: StatusChangeConfirmRequest) => Promise<boolean>

let confirmHandler: ConfirmFn | null = null
let pendingHint: { hint: StatusChangeHint; expiresAt: number } | null = null
let suppressDepth = 0

/**
 * Çağrı yerinin bıraktığı ipucunun ömrü. Kısa tutuluyor: bir ekran ipucu bırakıp isteği hiç
 * atmazsa (kullanıcı vazgeçti, doğrulama patladı), o ipucu SONRAKİ ilgisiz bir güncellemenin
 * özetine yapışmamalı.
 */
const HINT_TTL_MS = 15000

/** Onay ekranı iptal edildiğinde atılan hata. Çağrı yerleri mesajı olduğu gibi gösterebilir. */
export class StatusChangeCancelledError extends Error {
  constructor() {
    super('İşlem iptal edildi.')
    this.name = 'StatusChangeCancelledError'
  }
}

export function isStatusChangeCancelled(error: unknown): boolean {
  return error instanceof StatusChangeCancelledError
}

/** Sağlayıcı monte olduğunda kendini kaydeder; çıkarken temizler. */
export function registerStatusChangeConfirm(fn: ConfirmFn | null) {
  confirmHandler = fn
}

/** Bir sonraki durum güncellemesinin özetini zenginleştirir. */
export function describeNextStatusChange(hint: StatusChangeHint) {
  pendingHint = { hint, expiresAt: Date.now() + HINT_TTL_MS }
}

/**
 * Onayı ÇAĞRI YERİNDE, işin en başında sorar ve kapıyı bir süreliğine kapatır.
 *
 * `runStatusChange` işin tamamını sarmalayabildiği yerlerde doğru araç; ama bu kod tabanındaki
 * uzun akışlar (saha teslimi: fatura oluştur → parça düş → fotoğraf yükle → durum yaz) tek bir
 * `try/finally` bloğu içinde ve sarmalamak için yeniden yazılmaları gerekirdi.
 *
 * Bunun bir de DOĞRULUK tarafı var, sadece görünüm değil: kapı isteğin içinde olduğu için onay
 * ekranı akışın SONUNDA çıkıyordu — kullanıcı "İşleniyor..." yazısını görüyor, modal en son
 * beliriyor ve o noktada fatura ZATEN kesilmiş oluyordu. İptal edilirse fatura kesilmiş ama
 * durum yazılmamış bir kayıt kalırdı.
 *
 * Kullanımı: en başta çağır, `false` dönerse hiçbir şey yapma, `true` dönerse işe başla ve
 * bitince `release()` çağır (`finally` içinde).
 *
 *   const gate = await confirmStatusChangeAhead({ ... })
 *   if (!gate.ok) return
 *   try { ...tüm akış... } finally { gate.release() }
 */
export async function confirmStatusChangeAhead(
  request: StatusChangeConfirmRequest
): Promise<{ ok: boolean; release: () => void }> {
  const ok = await requestConfirmation(request)
  if (!ok) return { ok: false, release: () => {} }

  suppressDepth += 1
  let released = false
  return {
    ok: true,
    // Çift çağrıya karşı korumalı: `finally` içinde bir kez, hata yolunda bir kez çağrılırsa
    // sayaç eksiye düşer ve kapı KALICI olarak kapanırdı.
    release: () => {
      if (released) return
      released = true
      suppressDepth -= 1
    }
  }
}

/**
 * Toplu durum güncellemesi: bir kez sorar, içerideki istekleri kapıdan muaf tutar.
 *
 * İptal edilirse `action` HİÇ çalıştırılmaz ve `null` döner — çağrı yeri bunu "kullanıcı
 * vazgeçti" diye okumalı, hata olarak değil.
 *
 * SINIR: muafiyet süre bazlı değil, kapsam bazlı bir sayaç. `action` çalışırken başka bir yerden
 * (ör. arka planda tamamlanan bir kullanıcı tıklaması) durum güncellemesi giderse o da muaf
 * geçer. Tek iş parçacıklı ve kısa süreli olduğu için pratikte olmuyor; yine de burada yazıyor.
 */
export async function runStatusChange<T>(
  hint: StatusChangeConfirmRequest,
  action: () => Promise<T>
): Promise<T | null> {
  const ok = await requestConfirmation(hint)
  if (!ok) return null

  suppressDepth += 1
  try {
    return await action()
  } finally {
    suppressDepth -= 1
  }
}

/**
 * Durum değiştiren uçlar.
 *
 * Yalnızca SERVİS iş akışının durumları — hak ediş onayı (`/api/earnings/{id}/status`) ve rota
 * durumu (`/api/routes/{id}/status`) bilerek dışarıda: birincisi muhasebe onayı, ikincisi bir
 * günün gezi planı; ikisi de "serviste yapılan iş durumu" değil ve her ikisinde de onay ekranı
 * saha akışını yavaşlatırdı.
 */
const STATUS_ENDPOINTS = [
  /\/api\/servicerecords\/[^/]+\/status$/i,
  /\/api\/installations\/tasks\/[^/]+\/status$/i,
  /\/api\/cargotracking\/[^/]+\/status$/i,
  /\/api\/montaj\/[^/]+\/status$/i
]

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH'])

/**
 * Durum kodlarının Türkçe karşılıkları.
 *
 * İKİ ayrı enum burada birleşiyor: `ServiceStatus` (kaydın durumu) ve `InstallationTaskStatus`
 * (kalem satırının durumu). Aynı adı taşıyan iki değer yok, bu yüzden tek sözlük yetiyor.
 * Sunucudaki karşılıkları `ServiceRecordsController.GetTurkishStatus` ve
 * `montajPlanRows.STATE_LABELS` — biri değişirse burası da değişmeli, yoksa onay ekranı ham
 * İngilizce kod gösterir.
 */
const STATUS_LABELS: Record<string, string> = {
  New: 'Yeni Kayıt',
  FieldPlanned: 'Saha Planlamasında',
  Workshop: 'Atölyede',
  InRepair: 'Devam Ediyor',
  WaitingForParts: 'Parça Bekliyor',
  Ready: 'Gerçekleşti',
  InDelivery: 'Teslimatta',
  Delivered: 'Teslim Edildi',
  Cancelled: 'İptal',
  Delayed: 'Ertelendi',
  Planned: 'Planlandı',
  InProgress: 'Devam Ediyor',
  Completed: 'Gerçekleşti',
  Deferred: 'Yeni Kayıt',
  Unreachable: 'Ulaşılamadı',
  Postponed: 'Ertelendi',
  SmallProductAcceptance: 'Küçük Ev Kabul',
  WorkshopReady: 'Atölye Tamamlandı',
  DeliveryPlanning: 'Teslimat Planlaması',
  FieldCompleted: 'Sahada Tamamlandı',
  LargeProductPlanning: 'Büyük Ürün Planlama'
}

export function statusLabel(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return 'Bilinmiyor'
  return STATUS_LABELS[raw] ?? raw
}

function isStatusEndpoint(path: string): boolean {
  // Sorgu dizesi varsa atılır: `/status?force=1` de aynı uçtur.
  const clean = path.split('?')[0]
  return STATUS_ENDPOINTS.some((re) => re.test(clean))
}

function takeHint(): StatusChangeHint | null {
  if (!pendingHint) return null
  const { hint, expiresAt } = pendingHint
  pendingHint = null
  return Date.now() <= expiresAt ? hint : null
}

async function requestConfirmation(request: StatusChangeConfirmRequest): Promise<boolean> {
  // Sağlayıcı yoksa (test, izole render) akış kesilmez. Bu bir yetki kapısı değil, kullanıcıya
  // yapılan bir gösterim; kapatmak veri kaybettirmez ama işi durdurmak durdururdu.
  if (!confirmHandler) return true
  return confirmHandler(request)
}

/**
 * `apiFetch`in çağırdığı kapı. Durum değiştiren bir istekse onay ekranını açar; kullanıcı iptal
 * ederse <see cref="StatusChangeCancelledError"/> atar ve istek HİÇ gönderilmez.
 */
export async function gateStatusChange(
  path: string,
  method: string | undefined,
  body: BodyInit | null | undefined
): Promise<void> {
  if (suppressDepth > 0) return
  if (!MUTATING_METHODS.has((method ?? 'GET').toUpperCase())) return
  if (!isStatusEndpoint(path)) return

  const hint = takeHint()

  let parsed: Record<string, unknown> = {}
  if (typeof body === 'string' && body.trim().startsWith('{')) {
    try {
      parsed = JSON.parse(body) as Record<string, unknown>
    } catch {
      // Gövde okunamıyorsa özet ipucundan kurulur; isteği engellemek için sebep değil.
    }
  }

  // Not alanı uçtan uca aynı adı taşımıyor: kayıt ucu `notes`, kalem ucu `reason`, bazı ekranlar
  // `statusNote` yolluyor. Üçü de aynı şeydir — kullanıcının yazdığı açıklama.
  const noteFromBody = [parsed.notes, parsed.reason, parsed.statusNote, parsed.note]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .find((v) => v.length > 0)

  const note = hint?.note ?? noteFromBody ?? null
  const photoCount = hint?.photoCount ?? 0
  const hasPhoto = hint?.hasPhoto ?? photoCount > 0

  const ok = await requestConfirmation({
    subject: hint?.subject,
    kind: hint?.kind ?? 'Durum Güncellemesi',
    fromLabel: hint?.fromLabel ?? null,
    toLabel: hint?.toLabel ?? statusLabel(parsed.status),
    hasPhoto,
    photoCount,
    hasNote: Boolean(note && note.length > 0),
    note,
    details: hint?.details,
    warning: hint?.warning ?? null
  })

  if (!ok) throw new StatusChangeCancelledError()
}
