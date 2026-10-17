/**
 * Giriş sonrası dönülecek adresin doğrulanması.
 *
 * NEDEN AYRI BİR DOSYA: bu kontrol dört yerde gerekiyor (giriş sayfası, üye ol sayfası, giriş
 * formu, sepete ekle düğmesi) ve bir yerde atlanması yeterli.
 *
 * NEDEN KONTROL ŞART — AÇIK YÖNLENDİRME: adres çubuğundaki `?donus=` değerine olduğu gibi
 * güvenilirse `/giris?donus=https://sahte-site.example` gibi bir bağlantı üretilebilir. Kullanıcı
 * GERÇEK siteye girer, doğru alan adını görür, şifresini yazar ve giriş başarılı olur olmaz
 * saldırganın sitesine düşer. Oradaki sahte "oturumunuz doğrulanamadı, tekrar girin" ekranı
 * şifreyi toplar. Bağlantının kendisi gerçek siteye gittiği için kullanıcının şüphelenmesini
 * sağlayan hiçbir işaret yok — bu yüzden kural kapalı-başarısız: tanımadığımız her değer atılır
 * ve varsayılana dönülür.
 *
 * Kabul edilenler: yalnızca tek eğik çizgiyle başlayan site içi yollar.
 * Reddedilenler:
 *  - `//baska-site.example` — tarayıcı bunu protokolü devralan mutlak adres sayar
 *  - `/\baska-site.example` — bazı tarayıcılar ters eğik çizgiyi eğik çizgi gibi çözüyor
 *  - `http://…`, `https://…`, `javascript:…` gibi şema taşıyan her şey
 *  - kontrol karakteri taşıyanlar (başlık/adres satırını bölmekte kullanılıyor)
 */
const DEFAULT_RETURN = '/hesabim'

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export function safeReturnPath(value: string | null | undefined, fallback = DEFAULT_RETURN): string {
  if (!value) return fallback

  const raw = value.trim()
  if (raw.length === 0 || raw.length > 512) return fallback

  // Tek eğik çizgiyle başlamayan hiçbir şey site içi yol değil.
  if (!raw.startsWith('/')) return fallback

  // `//host` ve `/\host`: ikisi de site dışına çıkıyor.
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback

  if (CONTROL_CHARS.test(raw)) return fallback

  // Giriş veya üyelik ekranına geri yönlendirme döngüsü oluşmasını engelle
  if (raw === '/giris' || raw.startsWith('/giris?') || raw === '/uye-ol' || raw.startsWith('/uye-ol?')) {
    return fallback
  }

  return raw
}

/**
 * Korumalı sayfaların giriş ekranına yollarken kullandığı adres.
 * Hedef adres taşınmazsa kullanıcı giriş sonrası yaptığı işi baştan yapmak zorunda kalıyor.
 */
export function loginWithReturn(target: string): string {
  return `/giris?donus=${encodeURIComponent(target)}`
}
