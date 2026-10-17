import AsyncStorage from '@react-native-async-storage/async-storage';

const ACCESS_TOKEN_KEY = 'service_ops/access_token';
const SESSION_KEY = 'service_ops/session';

export type StoredSession = {
  accessToken: string;
  role?: string;
  technicianId?: string;
  tenantCode?: string;
  userId?: string;
  username?: string;
  technicianRoles?: string[];
};

export async function getAccessToken(): Promise<string | null> {
  return AsyncStorage.getItem(ACCESS_TOKEN_KEY);
}

export async function setAccessToken(token: string): Promise<void> {
  await AsyncStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export async function clearAccessToken(): Promise<void> {
  await AsyncStorage.removeItem(ACCESS_TOKEN_KEY);
}

export async function getStoredSession(): Promise<StoredSession | null> {
  const json = await AsyncStorage.getItem(SESSION_KEY);
  if (!json) return null;
  try {
    return JSON.parse(json) as StoredSession;
  } catch {
    return null;
  }
}

export async function setStoredSession(session: StoredSession): Promise<void> {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
  await AsyncStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
}

export async function clearStoredSession(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(SESSION_KEY),
    AsyncStorage.removeItem(ACCESS_TOKEN_KEY),
  ]);
}
