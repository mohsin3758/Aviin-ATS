const TOKEN_KEY = 'airecruit_token';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface TokenPayload {
  sub: string;
  tenant_id: string;
  role: string;
  email?: string;
  full_name?: string;
  exp?: number;
}

export function decodeToken(token: string): TokenPayload | null {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

export function getTokenPayload(): TokenPayload | null {
  const token = getToken();
  if (!token) return null;
  const payload = decodeToken(token);
  if (!payload) return null;
  if (payload.exp && payload.exp * 1000 < Date.now()) {
    clearToken();
    return null;
  }
  return payload;
}

export function isAuthenticated(): boolean {
  return getTokenPayload() !== null;
}

export async function login(email: string, password: string): Promise<TokenPayload> {
  const resp = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: 'Login failed' }));
    throw new Error(err.detail ?? 'Login failed');
  }
  const { access_token } = await resp.json();
  setToken(access_token);
  return decodeToken(access_token)!;
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export { API };
