import { io, Socket } from 'socket.io-client';
import { getToken } from './api';

import type {
  ClientGameState,
  PlayerAction,
  CreateLobbyResponse,
  JoinLobbyResponse,
} from '../types/poker';

import type {
  UnoClientState,
  UnoPlayerAction,
  UnoCreateLobbyResponse,
  UnoJoinLobbyResponse,
} from '../types/uno';

const ENV = (import.meta as any).env as { VITE_BACKEND_URL?: string; PROD?: boolean };

const BASE_URL =
  ENV.VITE_BACKEND_URL ||
  (ENV.PROD
    ? 'https://bulk-games-backend-production.up.railway.app'
    : 'http://localhost:3001');

/** На сколько ждать ack от сервера (мс) */
const ACK_TIMEOUT_MS = 8000;

type Listener = (data: unknown) => void;

function normBaseUrl(url: string) {
  return url.replace(/\/+$/, '');
}

function nsUrl(namespace: '/poker' | '/uno') {
  return `${normBaseUrl(BASE_URL)}${namespace}`;
}

function getAuthOrNull() {
  const token = getToken();
  return token ? { token } : null;
}

/**
 * Универсальная базовая обёртка для socket.io
 * - подключение к НУЖНОМУ namespace
 * - auth берём из localStorage на момент коннекта
 * - ack с timeout, чтобы промисы не зависали вечно
 */
class BaseGameSocket<TState> {
  protected socket: Socket | null = null;
  protected listeners: Map<string, Set<Listener>> = new Map();
  private namespace: '/poker' | '/uno';

  constructor(namespace: '/poker' | '/uno') {
    this.namespace = namespace;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve();
        return;
      }

      const auth = getAuthOrNull();
      if (!auth) {
        reject(new Error('No token (not logged in)'));
        return;
      }

      this.socket = io(nsUrl(this.namespace), {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        auth, // важно: auth идёт в handshake
      });

      this.socket.on('connect', () => {
        console.log(`[socket${this.namespace}] connected:`, this.socket?.id);
        this.emitLocal('connect', null);
        resolve();
      });

      this.socket.on('connect_error', (err: unknown) => {
        console.error(`[socket${this.namespace}] connect_error:`, err);
        reject(err);
      });

      this.socket.on('disconnect', (reason: string) => {
        console.log(`[socket${this.namespace}] disconnected:`, reason);
        this.emitLocal('disconnect', null);
      });

      // общие события (если на беке так называется)
      this.socket.on('gameState', (data: TState) => {
        this.emitLocal('gameState', data);
      });

      this.socket.on('lobbyEnded', () => {
        this.emitLocal('lobbyEnded', null);
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  on(event: string, cb: Listener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  off(event: string, cb: Listener): void {
    this.listeners.get(event)?.delete(cb);
  }

  protected emitLocal(event: string, data: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.forEach((fn) => fn(data));
  }

  /**
   * emit с ack + timeout, чтобы не зависать, если сервер не слушает событие
   */
  protected emitWithAck<TRes = any>(event: string, payload: any): Promise<TRes> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ success: false, error: 'Not connected' } as any);
        return;
      }

      // На всякий случай: если токен поменялся — обновим auth перед возможным реконнектом
      const auth = getAuthOrNull();
      if (auth) this.socket.auth = auth;

      // socket.io v4: timeout() делает ack с ошибкой при таймауте
      (this.socket as any)
        .timeout(ACK_TIMEOUT_MS)
        .emit(event, payload, (err: any, response: TRes) => {
          if (err) {
            resolve({ success: false, error: 'Ack timeout' } as any);
            return;
          }
          resolve(response);
        });
    });
  }
}

/* ───────────────────────── Poker ───────────────────────── */

class PokerSocket extends BaseGameSocket<ClientGameState> {
  constructor() {
    super('/poker');
  }

  createLobby(): Promise<CreateLobbyResponse> {
    return this.emitWithAck<CreateLobbyResponse>('createLobby', {});
  }

  joinLobby(code: string): Promise<JoinLobbyResponse> {
    return this.emitWithAck<JoinLobbyResponse>('joinLobby', { code });
  }

  startGame(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return this.emitWithAck('startGame', { lobbyCode });
  }

  sendAction(
    lobbyCode: string,
    action: PlayerAction,
    amount?: number,
  ): Promise<{ success: boolean; error?: string }> {
    return this.emitWithAck('playerAction', { lobbyCode, action, amount });
  }

  requestState(
    lobbyCode: string,
  ): Promise<{ success: boolean; gameState?: ClientGameState }> {
    return this.emitWithAck('requestState', { lobbyCode });
  }

  endLobby(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return this.emitWithAck('endLobby', { lobbyCode });
  }
}

export const pokerSocket = new PokerSocket();

/* ───────────────────────── UNO ───────────────────────── */

class UnoSocket extends BaseGameSocket<UnoClientState> {
  constructor() {
    super('/uno');
  }

  // если на беке gameState/unoState оба возможны — слушаем оба
  override connect(): Promise<void> {
    return super.connect().then(() => {
      if (!this.socket) return;

      this.socket.on('unoState', (data: UnoClientState) => {
        this.emitLocal('gameState', data);
      });
    });
  }

  createLobby(): Promise<UnoCreateLobbyResponse> {
    // оставил gameType для совместимости с твоей текущей логикой
    return this.emitWithAck<UnoCreateLobbyResponse>('createLobby', { gameType: 'uno' });
  }

  joinLobby(code: string): Promise<UnoJoinLobbyResponse> {
    return this.emitWithAck<UnoJoinLobbyResponse>('joinLobby', { gameType: 'uno', code });
  }

  startGame(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return this.emitWithAck('startGame', { gameType: 'uno', lobbyCode });
  }

  sendAction(
    lobbyCode: string,
    action: UnoPlayerAction,
  ): Promise<{ success: boolean; error?: string }> {
    return this.emitWithAck('playerAction', { gameType: 'uno', lobbyCode, action });
  }

  requestState(
    lobbyCode: string,
  ): Promise<{ success: boolean; gameState?: UnoClientState }> {
    return this.emitWithAck('requestState', { gameType: 'uno', lobbyCode });
  }

  endLobby(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return this.emitWithAck('endLobby', { gameType: 'uno', lobbyCode });
  }
}

export const unoSocket = new UnoSocket();
