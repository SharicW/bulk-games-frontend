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

const ENV = (import.meta as any).env as {
  VITE_BACKEND_URL?: string;
  PROD?: boolean;
  DEV?: boolean;
};

// базовый URL без слэша на конце
const BASE_URL = (ENV.VITE_BACKEND_URL ||
  (ENV.PROD
    ? 'https://bulk-games-backend-production.up.railway.app'
    : 'http://localhost:3001'
  )).replace(/\/$/, '');

type AnyFn = (...args: any[]) => void;

class BaseGameSocket<TState> {
  protected socket: Socket | null = null;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  constructor(private namespace: string, private label: string) {}

  private makeUrl(): string {
    // namespace должен быть вида "/poker" или "/uno"
    return `${BASE_URL}${this.namespace}`;
  }

  private applyFreshAuth(): void {
    if (!this.socket) return;
    // ВАЖНО: token читаем каждый раз из localStorage
    this.socket.auth = { token: getToken() };
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve();
        return;
      }

      this.socket = io(this.makeUrl(), {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        // auth берётся на момент connect
        auth: { token: getToken() },
        withCredentials: true,
      });

      this.socket.on('connect', () => {
        console.log(`[socket/${this.label}] connected:`, this.socket?.id);
        this.emitLocal('connect', this.socket?.id);
        resolve();
      });

      this.socket.on('connect_error', (err: unknown) => {
        console.error(`[socket/${this.label}] connect_error:`, err);
        reject(err);
      });

      this.socket.on('disconnect', (reason: string) => {
        console.log(`[socket/${this.label}] disconnected:`, reason);
        this.emitLocal('disconnect', reason);
      });

      // полезно видеть, что бэк реально отдал пользователя
      this.socket.on('test', (data: any) => {
        console.log(`[socket/${this.label}] test:`, data);
        this.emitLocal('test', data);
      });

      this.socket.on('gameState', (data: TState) => {
        this.emitLocal('gameState', data);
      });

      this.socket.on('lobbyEnded', () => {
        this.emitLocal('lobbyEnded', null);
      });

      // для UNO иногда отдельное событие
      this.socket.on('unoState', (data: any) => {
        this.emitLocal('gameState', data);
      });
    });
  }

  disconnect(): void {
    if (!this.socket) return;
    this.socket.disconnect();
    this.socket = null;
  }

  /**
   * Если токен появился/поменялся после логина — вызывай это,
   * чтобы сокет переподключился уже с новым токеном.
   */
  reconnect(): Promise<void> {
    this.disconnect();
    return this.connect();
  }

  on(event: string, cb: (data: any) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  protected emitLocal(event: string, data: any): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) cb(data);
  }

  /**
   * emit с ack и таймаутом, чтобы не было ситуации "кнопка не работает" без ответа
   */
  protected emitAck<TRes = any>(event: string, payload: any, timeoutMs = 8000): Promise<TRes> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ success: false, error: 'Not connected' } as any);
        return;
      }

      this.applyFreshAuth();

      // socket.io-client: timeout().emit(event, payload, (err, res) => ...)
      // если сервер не ответил ack'ом — будет err
      (this.socket as any)
        .timeout(timeoutMs)
        .emit(event, payload, (err: any, res: TRes) => {
          if (err) {
            console.error(`[socket/${this.label}] ${event} timeout/error:`, err);
            resolve({ success: false, error: 'No response from server' } as any);
            return;
          }
          resolve(res);
        });
    });
  }
}

/* ───────────────────── Poker ───────────────────── */

class PokerSocket extends BaseGameSocket<ClientGameState> {
  constructor() {
    super('/poker', 'poker');
  }

  createLobby(): Promise<CreateLobbyResponse> {
    // на всякий — явно gameType
    return this.emitAck<CreateLobbyResponse>('createLobby', { gameType: 'poker' });
  }

  joinLobby(code: string): Promise<JoinLobbyResponse> {
    return this.emitAck<JoinLobbyResponse>('joinLobby', { gameType: 'poker', code });
  }

  startGame(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return this.emitAck('startGame', { gameType: 'poker', lobbyCode });
  }

  sendAction(
    lobbyCode: string,
    action: PlayerAction,
    amount?: number,
  ): Promise<{ success: boolean; error?: string }> {
    return this.emitAck('playerAction', { gameType: 'poker', lobbyCode, action, amount });
  }

  requestState(lobbyCode: string): Promise<{ success: boolean; gameState?: ClientGameState }> {
    return this.emitAck('requestState', { gameType: 'poker', lobbyCode });
  }

  endLobby(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return this.emitAck('endLobby', { gameType: 'poker', lobbyCode });
  }
}

export const pokerSocket = new PokerSocket();

/* ───────────────────── UNO ───────────────────── */

class UnoSocket extends BaseGameSocket<UnoClientState> {
  constructor() {
    super('/uno', 'uno');
  }

  createLobby(): Promise<UnoCreateLobbyResponse> {
    return this.emitAck<UnoCreateLobbyResponse>('createLobby', { gameType: 'uno' });
  }

  joinLobby(code: string): Promise<UnoJoinLobbyResponse> {
    return this.emitAck<UnoJoinLobbyResponse>('joinLobby', { gameType: 'uno', code });
  }

  startGame(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return this.emitAck('startGame', { gameType: 'uno', lobbyCode });
  }

  sendAction(
    lobbyCode: string,
    action: UnoPlayerAction,
  ): Promise<{ success: boolean; error?: string }> {
    return this.emitAck('playerAction', { gameType: 'uno', lobbyCode, action });
  }

  requestState(lobbyCode: string): Promise<{ success: boolean; gameState?: UnoClientState }> {
    return this.emitAck('requestState', { gameType: 'uno', lobbyCode });
  }

  endLobby(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return this.emitAck('endLobby', { gameType: 'uno', lobbyCode });
  }
}

export const unoSocket = new UnoSocket();

/* ───────── dev helpers ───────── */
if (ENV.DEV && typeof window !== 'undefined') {
  (window as any).pokerSocket = pokerSocket;
  (window as any).unoSocket = unoSocket;
}
