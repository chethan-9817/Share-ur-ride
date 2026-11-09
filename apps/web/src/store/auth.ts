import type { UserDto } from '@arriveshare/shared';
import { create } from 'zustand';

/**
 * Session state. The access token lives only in memory (never localStorage) so an
 * XSS bug can't exfiltrate a long-lived credential; the refresh token is an
 * httpOnly cookie the browser sends to /api/auth/refresh.
 */
interface AuthState {
  token: string | null;
  user: UserDto | null;
  ready: boolean;
  setSession: (token: string, user: UserDto) => void;
  setUser: (user: UserDto) => void;
  clear: () => void;
  markReady: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  token: null,
  user: null,
  ready: false,
  setSession: (token, user) => set({ token, user }),
  setUser: (user) => set({ user }),
  clear: () => set({ token: null, user: null }),
  markReady: () => set({ ready: true }),
}));
