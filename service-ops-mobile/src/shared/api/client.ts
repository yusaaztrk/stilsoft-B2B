import { API_BASE_URL } from '../config';
import { clearStoredSession, getAccessToken, getStoredSession } from '../session/storage';

type ApiFetchOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
};

export async function apiFetch(path: string, options: ApiFetchOptions = {}) {
  const token = await getAccessToken();
  const session = await getStoredSession();
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(session?.tenantCode ? { 'X-Tenant-Code': session.tenantCode } : {}),
      'Content-Type': options.body
        ? 'application/json'
        : (options.headers?.['Content-Type'] ?? 'application/json'),
    },
  });

  if (res.status === 401) {
    await clearStoredSession();
    // Also clear the Zustand in-memory store so the app navigates to login
    try {
      const { useSessionStore } = await import('../session/store');
      await useSessionStore.getState().clearSession();
    } catch {
      // ignore import errors (e.g., if called outside React context)
    }
    throw new Error('Unauthorized');
  }

  return res;
}

export async function apiJson<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed (${res.status})`);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text().catch(() => '');
  if (!text.trim()) return undefined as T;

  return JSON.parse(text) as T;
}
