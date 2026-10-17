/**
 * GİRİŞ SAYFASINA TEK SEFERLİK YÖNLENDİRME.
 *
 * Bir sayfa açılışında aynı anda 5-10 istek atılıyor. Oturum düştüğünde hepsi birden 401
 * alıyor ve her biri ayrı ayrı `window.location.assign('/login')` çağırıyordu: tarayıcı
 * geçmişi aynı adresle doluyor, kullanıcı geri tuşuna bastığında giriş sayfasından
 * çıkamıyordu. Yönlendirme artık işaretleniyor; ilk çağrı kazanıyor, sonrakiler sessizce
 * yok sayılıyor (denetim md. 50).
 *
 * `replace` kullanılıyor: giriş sayfası geçmişe YENİ bir kayıt eklemek yerine, oturumu
 * düşmüş sayfanın yerine geçiyor — geri tuşu kullanıcıyı erişemeyeceği sayfaya döndürmesin.
 */
let redirecting = false

export function redirectToLogin(): void {
  if (typeof window === 'undefined') return
  if (redirecting) return

  // Zaten giriş sayfasındaysak yeniden yönlendirmenin anlamı yok (sonsuz döngü riski).
  if (window.location.pathname === '/login') {
    redirecting = true
    return
  }

  redirecting = true
  window.location.replace('/login')
}

/** Yalnızca testler için: bayrağı sıfırlar. */
export function __resetRedirectGuardForTests(): void {
  redirecting = false
}
