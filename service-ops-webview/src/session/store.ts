import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '../bridge/types';

/**
 * Kabuğun oturum kopyası.
 *
 * Oturumun ASLI web tarafında, WebView'ün kendi `localStorage`'ında. Kabuk onu yönetmiyor,
 * yalnızca dinliyor — çünkü iki işi için gerekli: konum yazmak ve cihazı bildirime kaydetmek.
 * İkisi de token ister.
 *
 * Neden ayrıca AsyncStorage'a yazılıyor: arka plan görevi uygulama arayüzü kapalıyken de
 * çalışıyor ve o anda WebView'den mesaj gelmiyor. Diskteki kopya olmazsa telefon uykudan
 * kalktığında konum servisi kimliksiz kalır ve sessizce durur.
 */

const STORAGE_KEY = 'serviceOps.session';

let current: Session | null = null;
const listeners = new Set<(session: Session | null) => void>();

export function getSession(): Session | null {
  return current;
}

export async function hydrateSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    current = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    current = null;
  }
  return current;
}

export async function setSession(session: Session | null) {
  const hadToken = !!current?.accessToken;
  current = session && session.accessToken ? session : null;

  try {
    if (current) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Disk yazılamadıysa bellek kopyası yine geçerli; uygulama açık kaldığı sürece çalışır.
  }

  const hasToken = !!current?.accessToken;
  // Dinleyiciler yalnızca gerçek bir değişimde uyarılıyor: web tarafı oturumu beş saniyede bir
  // gönderiyor, her mesajda konum servisini yeniden kurmak pil yakardı.
  if (hadToken !== hasToken || hasToken) {
    listeners.forEach(fn => fn(current));
  }
}

export function onSessionChange(fn: (session: Session | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Sunucuya kimlikli istek. Firma başına ayrı veritabanı olduğu için `X-Tenant-Code` ŞART:
 * başlık gitmezse istek varsayılan veritabanına düşer ve konum yanlış firmaya yazılır.
 */
export function authHeaders(session: Session): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.accessToken}`,
  };
  if (session.tenantCode) headers['X-Tenant-Code'] = session.tenantCode;
  return headers;
}
