// ---------------------------------------------------------------------------
// Centralized localStorage access for JWT tokens and the cached user.
// Keeping this in one module avoids scattering magic string keys around and
// makes it easy to swap the storage strategy later.
// ---------------------------------------------------------------------------
import type { User } from '../../types';

const ACCESS_KEY = 'capex.access';
const REFRESH_KEY = 'capex.refresh';
const USER_KEY = 'capex.user';

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh?: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setStoredUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuthStorage(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}
