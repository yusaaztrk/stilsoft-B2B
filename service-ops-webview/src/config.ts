/**
 * Uygulamanın baktığı adresler.
 *
 * 2026-08-23: CANLI adreslere alındı. Önceki değerler geliştirme makinesinin LAN adresiydi
 * (`http://192.168.3.196:5173`) — o hâliyle üretilen APK sahada AÇILMAZ, WebView "Bağlanılamadı"
 * ekranı verir. Yerel ağda denemek gerekirse buraya bilgisayarın LAN adresi yazılır;
 * `localhost` YAZILAMAZ, telefonda `localhost` telefonun kendisidir.
 *
 * İkisi de AYNI kaynağı gösteriyor ve bu doğru: yayında ServiceOps API'si web arayüzüyle aynı
 * sitede duruyor (bkz. `service-ops-frontend/src/config.ts` — `window.location.origin`).
 * Ayrı adres yazılırsa konum bir veritabanına, iş kaydı başkasına gider.
 */

/** WebView'ün açtığı adres — ServiceOps web arayüzü. */
export const WEB_URL = 'https://servis.example.com';

/**
 * ServiceOps API. Kabuğun kendi istekleri (konum yazma, cihaz kaydı) buraya gider.
 *
 * WebView içindeki sayfa API'yi kendi başına buluyor; bu değer YALNIZCA native tarafın
 * istekleri için. İkisi aynı sunucuyu göstermeli, yoksa konum bir veritabanına, iş kaydı
 * başkasına yazılır.
 */
export const API_BASE_URL = 'https://servis.example.com';

/** Konumun sunucuya ne sıklıkla yazılacağı (ms). */
export const LOCATION_INTERVAL_MS = 60_000;

/** Bildirim kanalı — Android'de bildirimin sesli/öncelikli gösterilmesi buna bağlı. */
export const NOTIFICATION_CHANNEL_ID = 'job-assignments';
export const NOTIFICATION_CHANNEL_NAME = 'İş atamaları';
