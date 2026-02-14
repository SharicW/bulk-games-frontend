const ENV = (import.meta as any).env as { VITE_BACKEND_URL?: string; PROD?: boolean };

export const API_URL = ENV.VITE_BACKEND_URL || (ENV.PROD
  ? 'https://bulk-games-backend-production.up.railway.app'
  : 'http://localhost:3001');

const TOKEN_KEY = 'bulk_games_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request<T = any>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers as Record<string, string> ?? {}),
  };

  const res = await fetch(`${API_URL}${path}`, { ...opts, headers });
  const data = await res.json();

  if (!res.ok && !data.error) {
    throw new Error(`HTTP ${res.status}`);
  }

  return data as T;
}

/* ── Auth API ──────────────────────────────────────────────────── */

export interface ApiUser {
  id: string;
  email: string;
  nickname: string;
  avatarUrl: string | null;
  role: 'host' | 'player';
  coins: number;
  equippedBorder: string | null;
  equippedEffect: string | null;
  inventory: string[];
}

/* ── Shop types ──────────────────────────────────────────────── */

export interface ShopItem {
  id: string;
  name: string;
  type: 'border' | 'effect';
  price: number;
  description: string;
  cssClass: string;
}

interface AuthResponse {
  success: boolean;
  token?: string;
  user?: ApiUser;
  error?: string;
}

export async function apiRegister(
  email: string,
  password: string,
  nickname: string,
): Promise<AuthResponse> {
  return request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, nickname }),
  });
}

export async function apiLogin(
  email: string,
  password: string,
): Promise<AuthResponse> {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function apiLogout(): Promise<void> {
  try {
    await request('/auth/logout', { method: 'POST' });
  } catch {
    // token may already be invalid
  }
  setToken(null);
}

export async function apiGetMe(): Promise<ApiUser> {
  return request('/auth/me');
}

export async function apiUpdateMe(
  body: { nickname?: string; avatarUrl?: string | null; oldPassword?: string; newPassword?: string },
): Promise<{ success: boolean; user?: ApiUser; error?: string }> {
  return request('/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/* ── Shop API ────────────────────────────────────────────────── */

export async function apiGetShopItems(): Promise<{ items: ShopItem[] }> {
  return request('/shop/items');
}

export async function apiBuyItem(itemId: string): Promise<{ success: boolean; coins?: number; error?: string }> {
  return request('/shop/buy', {
    method: 'POST',
    body: JSON.stringify({ itemId }),
  });
}

export async function apiEquipItem(itemId: string | null, slot?: 'border' | 'effect'): Promise<{ success: boolean; error?: string }> {
  return request('/shop/equip', {
    method: 'POST',
    body: JSON.stringify(itemId ? { itemId } : { itemId: null, slot }),
  });
}

/* ── Public rooms ─────────────────────────────────────────────── */

export interface PublicRoomInfo {
  gameType: 'poker' | 'uno';
  code: string;
  playerCount: number;
  status: 'lobby' | 'in_game';
  maxPlayers: number;
}

export async function apiListPublicRooms(gameType?: 'poker' | 'uno'): Promise<{ rooms: PublicRoomInfo[] }> {
  const qs = gameType ? `?gameType=${encodeURIComponent(gameType)}` : '';
  return request(`/public/rooms${qs}`, { method: 'GET' });
}

