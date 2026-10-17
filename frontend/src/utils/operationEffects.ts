/**
 * İŞLEM SONUÇLARI — "ne yaptım, arkasında ne oldu" geri bildirimi.
 *
 * Kullanıcı faturayı siliyor ama stoğun geri dönüp dönmediğini, cari ekstrenin düşüp
 * düşmediğini göremiyordu. Elektrik ya da bağlantı kesildiğinde işlemin nereye kadar
 * geldiği de belirsizdi. Sunucu artık her başarılı yazma isteğinde ne olduğunu
 * `X-Operation-Effects` başlığıyla döndürüyor; burası onu okuyup ekrana taşır.
 *
 * Metin SUNUCUDAN gelir, burada üretilmez: hareket kaydına yazılan cümlelerin aynısıdır.
 * Ekranda görülen ile kayda geçen ayrı yerlerde üretilseydi biri değiştiğinde diğeri
 * sessizce eskirdi.
 */

export const OPERATION_EFFECTS_HEADER = 'X-Operation-Effects'
export const OPERATION_EFFECTS_EVENT = 'b2b:operation-effects'

export type OperationEffectsPayload = {
  /** Kullanıcının YAPTIĞI iş ("Satış Faturası … silindi"). */
  actions: string[]
  /** İşin TETİKLEDİKLERİ ("Stok: … +1 adet — Merkez Depo"). */
  effects: string[]
  /** Başlık boyutu için kırpılan satır sayısı. */
  overflow: number
  /** İsteğin gittiği yol — hangi işlem olduğunu ayırt etmek için. */
  path: string
}

/**
 * Yanıttan sonuçları çözer.
 *
 * Başlık Base64'lenmiş UTF-8 JSON'dur: HTTP başlıkları ASCII taşır, "Stok: ABC +1 adet
 * (arttı)" doğrudan konsaydı vekil sunucularda bozulurdu.
 *
 * Çözme başarısız olursa `null` döner ve İSTEK BOZULMAZ — geri bildirim işi, işin
 * kendisini düşüremez.
 */
export function readOperationEffects(response: Response, path: string): OperationEffectsPayload | null {
  try {
    const raw = response.headers.get(OPERATION_EFFECTS_HEADER)
    if (!raw) return null

    // atob bayt dizisi verir; Türkçe karakterler için UTF-8 çözümü şart.
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder('utf-8').decode(bytes))

    const clean = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
        : []

    const actions = clean(parsed?.actions)
    const effects = clean(parsed?.effects)

    if (actions.length === 0 && effects.length === 0) return null

    return {
      actions,
      effects,
      overflow: Number(parsed?.overflow) || 0,
      path,
    }
  } catch {
    return null
  }
}

/** Sonuçları dinleyen bileşenlere duyurur. */
export function publishOperationEffects(payload: OperationEffectsPayload): void {
  try {
    window.dispatchEvent(new CustomEvent<OperationEffectsPayload>(OPERATION_EFFECTS_EVENT, { detail: payload }))
  } catch {
    // ignore
  }
}
