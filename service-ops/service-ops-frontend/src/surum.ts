/*
  ÇALIŞAN DERLEMENİN KİMLİĞİ.

  Değer `vite.config.ts` içindeki `define` ile derleme anında gömülür. Amacı tek: ekranda eski
  davranış görüldüğünde "kod mu yanlış, kurulum mu eksik" sorusunu TAHMİNE bırakmamak.

  Kullanım — tarayıcı konsoluna tek kelime:  SERVIS_SURUM
*/
declare const __SERVIS_SURUM__: string

export const SERVIS_SURUM = __SERVIS_SURUM__

export function surumDamgasiniYaz() {
  // Konsolda kaybolmasın diye info değil, belirgin bir satır.
  console.info(`%c[SERVIS] Arayüz sürümü: ${SERVIS_SURUM}`, 'background:#111;color:#0f0;padding:2px 6px;border-radius:3px')
  ;(window as unknown as Record<string, string>).SERVIS_SURUM = SERVIS_SURUM
}
