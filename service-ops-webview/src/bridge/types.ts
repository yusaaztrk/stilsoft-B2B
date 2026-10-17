/**
 * Web ile kabuk arasındaki mesaj sözleşmesi.
 *
 * Karşılığı web tarafında `service-ops-frontend/src/native/bridge.ts`. İKİSİ BİRLİKTE
 * DEĞİŞMELİ: burada bir alan adı değişip orada değişmezse mesaj sessizce yok sayılır — hata
 * çıkmaz, sadece indirme/yazdırma/konum çalışmaz.
 */

/** Web → kabuk. */
export type WebMessage =
  | {
      type: 'session';
      accessToken: string | null;
      tenantCode: string | null;
      username: string | null;
      role: string | null;
      technicianId: string | null;
    }
  | { type: 'download'; fileName: string; mimeType: string; base64: string }
  | { type: 'print'; html: string }
  | { type: 'navigated'; path: string }
  /*
    GIRIS BILGISI SAKLAMA (2026-08-24).

    Sayfa BASARILI bir giristen sonra bunu gonderiyor; kabuk sifreleyip saklıyor ve bir
    dahaki giris ekraninda geri veriyor. Boylece teknisyen servisten bayiye gectiginde
    parola sorulmuyor.

    Yalnizca BASARILI giriste gonderilir: basarisiz denemeyi saklamak, kullaniciyi her
    acilista yanlis parolayla giris denemeye mahkum ederdi.
  */
  | { type: 'credentials:save'; tenantCode: string | null; username: string; password: string }
  /* Kullanici ACIKCA cikis yapti: kayitli bilgi silinir. Sure dolmasi bunu tetiklemez. */
  | { type: 'credentials:clear' }
  /* Giris ekrani acildi: kayitli bilgi varsa geri gonder. */
  | { type: 'credentials:request' };

/** Kabuk → web. */
export type NativeMessage =
  | { type: 'navigate'; path: string }
  | { type: 'logout' }
  /*
    `credentials:request`in cevabi. Kayit yoksa `username` bos gelir ve sayfa hicbir sey
    yapmaz — "kayit yok" ayri bir mesaj turu olmasin diye.
  */
  | {
      type: 'credentials';
      tenantCode: string | null;
      username: string;
      password: string;
    };

export type Session = Extract<WebMessage, { type: 'session' }>;

export function parseWebMessage(raw: string): WebMessage | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.type === 'string') return parsed as WebMessage;
    return null;
  } catch {
    // Sayfadaki başka bir kod da postMessage çağırabilir (üçüncü parti betikler).
    // Çözülemeyen mesaj yok sayılır; kabuk çökmemeli.
    return null;
  }
}

/** Kabuktan web'e mesaj geçiren JS. `webViewRef.injectJavaScript` ile çalıştırılır. */
export function buildInjection(message: NativeMessage): string {
  return `window.__serviceOpsNative && window.__serviceOpsNative(${JSON.stringify(message)}); true;`;
}
