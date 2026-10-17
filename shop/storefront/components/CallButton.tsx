/**
 * SOL ALTTA YÜZEN "ARA" BUTONU (2026-09-09 kullanıcı isteği: "sol alta bi tane telefon
 * butonu koy aynı ws gibi basınca direk arasın").
 *
 * <b>Neden istemci bileşeni DEĞİL:</b> WhatsApp widget'ının aksine burada durum yok — açılan
 * bir pencere, şablon listesi ya da olay dinleyicisi bulunmuyor. Tek yaptığı `tel:` bağlantısı
 * açmak, bunu düz bir `<a>` yapıyor. Sunucuda render edilmesi hem tarayıcıya inen betiği
 * artırmıyor hem de buton ilk boyamada geliyor.
 *
 * <b>Neden sol:</b> sağ altta WhatsApp var. İkisi aynı köşeye konsaydı üst üste binerler,
 * mobilde ise ikisi birden sepet/satın alma çubuğunun üstüne düşerdi.
 *
 * Numara boşsa buton hiç çizilmez — çalışmayan bir "Ara" düğmesi, hiç düğme olmamasından kötü.
 */
export default function CallButton({ phone }: { phone?: string }) {
  const raw = (phone ?? '').trim()
  // `tel:` yalnız rakam ve baştaki + kabul eder; ekranda gösterilen boşluklu biçim bozulmasın
  // diye görünen metin ayrı tutuluyor.
  const dial = raw.replace(/(?!^\+)[^\d]/g, '')
  if (!dial) return null

  return (
    <a
      href={`tel:${dial}`}
      className="call-floating-btn"
      aria-label={`Telefonla ara: ${raw}`}
      title={`Ara: ${raw}`}
    >
      <span className="call-float-icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      </span>
      <span className="call-float-text">Ara</span>
    </a>
  )
}
