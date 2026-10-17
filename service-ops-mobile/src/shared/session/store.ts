import { create } from 'zustand';
import { getStoredSession, setStoredSession, clearStoredSession, StoredSession } from './storage';

export type SessionState = {
  hydrated: boolean;
  accessToken: string | null;
  role?: string;
  technicianId?: string;
  tenantCode?: string;
  userId?: string;
  username?: string;
  technicianRoles?: string[];

  hydrate: () => Promise<void>;
  setSession: (session: StoredSession) => Promise<void>;
  clearSession: () => Promise<void>;
};

export const useSessionStore = create<SessionState>((set, get) => ({
  hydrated: false,
  accessToken: null,

  hydrate: async () => {
    const session = await getStoredSession();
    set({
      hydrated: true,
      accessToken: session?.accessToken ?? null,
      role: session?.role,
      technicianId: session?.technicianId,
      tenantCode: session?.tenantCode,
      userId: session?.userId,
      username: session?.username,
      technicianRoles: session?.technicianRoles,
    });
  },

  setSession: async (session: StoredSession) => {
    await setStoredSession(session);
    set({
      accessToken: session.accessToken,
      role: session.role,
      technicianId: session.technicianId,
      tenantCode: session.tenantCode,
      userId: session.userId,
      username: session.username,
      technicianRoles: session.technicianRoles,
    });
  },

  clearSession: async () => {
    await clearStoredSession();
    set({
      accessToken: null,
      role: undefined,
      technicianId: undefined,
      tenantCode: undefined,
      userId: undefined,
      username: undefined,
      technicianRoles: undefined,
    });
  },
}));
