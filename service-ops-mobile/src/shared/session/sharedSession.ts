import { API_BASE_URL } from '../config';
import { getAccessToken, getStoredSession, setAccessToken, setStoredSession } from './storage';

/**
 * Bayi (B2B) ile ORTAK oturumun mobil taraftaki istemcisi.
 *
 * Oturum süresi, uyarı zamanı ve "bu oturum kapatıldı mı" bilgisi tek bir sunucu kaydından gelir.
 * Teknisyen bayi programına hiç girmez ama süresi yine oradaki ayardan belirlenir; bir yerden
 * çıkış yapıldığında bu cihazdaki oturum da düşer.
 */
export type SessionState = {
  valid: boolean;
  revoked?: boolean;
  expiresAtUtc: string | null;
  alertBeforeMinutes: number;
  durationMinutes: number;
  accessToken?: string | null;
};

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const session = await getStoredSession();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(session?.tenantCode ? { 'X-Tenant-Code': session.tenantCode } : {}),
  };
}

/** Yeni token'ı hem token anahtarına hem de oturum kaydına yazar (kimlik alanları korunur). */
async function adoptToken(token: string): Promise<void> {
  await setAccessToken(token);
  const session = await getStoredSession();
  if (session) {
    await setStoredSession({ ...session, accessToken: token });
  }
}

/**
 * apiFetch KULLANILMIYOR: o, 401 gördüğü anda oturumu siliyor. Burada 401 zaten "oturum bitti"
 * cevabının kendisi ve kararı çağıran veriyor.
 */
export async function fetchSessionState(): Promise<SessionState | null> {
  const res = await fetch(`${API_BASE_URL}/api/auth/session-state`, { headers: await authHeaders() });

  if (res.status === 401) {
    return { valid: false, expiresAtUtc: null, alertBeforeMinutes: 0, durationMinutes: 0 };
  }

  if (!res.ok) return null;

  const json = await res.json().catch(() => null);
  if (!json) return null;

  const state: SessionState = {
    valid: Boolean(json.valid),
    revoked: Boolean(json.revoked),
    expiresAtUtc: json.expiresAtUtc ? String(json.expiresAtUtc) : null,
    alertBeforeMinutes: Number(json.alertBeforeMinutes ?? 3),
    durationMinutes: Number(json.durationMinutes ?? 60),
    accessToken: json.accessToken ? String(json.accessToken) : null,
  };

  if (state.valid && state.accessToken) {
    await adoptToken(state.accessToken);
  }

  return state;
}

export async function extendSession(): Promise<SessionState | null> {
  const res = await fetch(`${API_BASE_URL}/api/auth/extend-session`, {
    method: 'POST',
    headers: await authHeaders(),
  });

  if (res.status === 401) {
    return { valid: false, revoked: true, expiresAtUtc: null, alertBeforeMinutes: 0, durationMinutes: 0 };
  }

  if (!res.ok) return null;

  const json = await res.json().catch(() => null);
  const token = String(json?.data?.accessToken ?? '').trim();
  if (!token) return null;

  await adoptToken(token);

  return {
    valid: true,
    expiresAtUtc: json?.data?.expiresAtUtc ? String(json.data.expiresAtUtc) : null,
    alertBeforeMinutes: Number(json?.data?.alertBeforeMinutes ?? 3),
    durationMinutes: 0,
    accessToken: token,
  };
}

/** Çıkışı sunucuya bildirir: bayi tarafındaki oturum da düşer. */
export async function logoutShared(): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST', headers: await authHeaders() });
  } catch {
    // Ağ hatası çıkışı engellemez; yerel oturum her hâlükârda temizlenir.
  }
}

/** Token'ın bitiş anı (ms). Geri sayım her saniye sunucuya sorulmasın diye yerelde işliyor. */
export function decodeTokenExpiryMs(token: string | null): number | null {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      decodeBase64Url(parts[1]),
    );
    const exp = Number(payload?.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * base64url → metin.
 *
 * React Native'de `atob` her sürümde/motorda yok, `Buffer` de Node'a ait. Varsa `atob` kullanılır,
 * yoksa saf JS ile çözülür. Çıkan metin bayt-bazlı: token içindeki Türkçe karakterler bozulabilir
 * ama buradan yalnızca `exp` (sayı) okunuyor, o yüzden sonucu etkilemiyor.
 */
function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');

  const nativeAtob = (globalThis as { atob?: (input: string) => string }).atob;
  if (typeof nativeAtob === 'function') return nativeAtob(padded);

  let out = '';
  let buffer = 0;
  let bits = 0;

  for (const char of padded) {
    if (char === '=') break;
    const index = BASE64_ALPHABET.indexOf(char);
    if (index < 0) continue;

    buffer = (buffer << 6) | index;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }

  return out;
}
