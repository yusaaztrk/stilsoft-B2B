/**
 * "ŞU AN BAKILAN ÜRÜN" — yüzen WhatsApp balonuna bağlam taşıyan küçük depo (2026-09-21).
 *
 * SORUN: sağ alttaki WhatsApp balonu sitenin HER sayfasında aynı genel mesajları yolluyordu
 * ("Merhaba, bir ürünün güncel fiyatı ve stok durumu hakkında bilgi alabilir miyim?").
 * Müşteri bir fırının sayfasındayken bile hangi fırından bahsettiğini yazmıyor; karşı tarafa
 * bağlamsız bir mesaj düşüyor ve satış temsilcisi "hangi ürün?" diye sormak zorunda kalıyor.
 * Telefonla/WhatsApp'la alışmış bir müşteri kitlesinde bu fazladan tur, kapanmayan satış demek.
 *
 * NEDEN REACT CONTEXT DEĞİL: balon `ClientProviders` içinde, sayfa içeriğinin YANINDA duruyor
 * (`{children}` ile kardeş). Ürün sayfası ağacın altında olduğu için oradan yukarı context
 * akmaz. Balonu ürün sayfasının içine taşımak da olmaz — her sayfada görünmesi gerekiyor.
 *
 * Çözüm: modül seviyesinde minik bir depo + `useSyncExternalStore`. Ürün sayfası açılışta
 * yazıyor, kapanışta siliyor; balon dinliyor. Tek yönlü, tek kaynak, sunucuya hiç gitmiyor.
 */

export type ChatProduct = {
  name: string
  stockCode: string
  /** Biçimlendirilmiş fiyat ("12.500,00 TL") — balon yalnız yazıya basıyor, hesap yapmıyor. */
  price: string
  /** Tam adres; müşterinin gönderdiği mesaja eklenir ki temsilci tek tıkla ürüne gitsin. */
  url: string
}

let mevcut: ChatProduct | null = null
const dinleyiciler = new Set<() => void>()

export function setChatProduct(p: ChatProduct | null) {
  mevcut = p
  for (const d of dinleyiciler) d()
}

export function getChatProduct(): ChatProduct | null {
  return mevcut
}

/** Sunucuda render sırasında ürün bağlamı YOKTUR; aksi hâlde istemci/sunucu çıktısı ayrışır. */
export function getChatProductServer(): ChatProduct | null {
  return null
}

export function subscribeChatProduct(dinleyici: () => void) {
  dinleyiciler.add(dinleyici)
  return () => {
    dinleyiciler.delete(dinleyici)
  }
}
