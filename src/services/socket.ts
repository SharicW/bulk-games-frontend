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

/**
 * ВАЖНО:
 * - Poker должен ходить в namespace "/poker"
 * - Uno должен ходить в namespace "/uno"
 * - Токен надо подставлять каждый раз перед connect/reconnect
 */

type Listener = (data: unknown) => void;

class BaseNS {
  protected socket: Socket | null = null;
  protected listeners: Map<string, Set<Listener>> = new Map();
  protected namespacePath: string;
  protected label: string;

  constructor(namespacePath: string, label: string) {
    this.namespacePath = namespacePath;
    this.label = label;
  }

  protected emitLocal(event: string, data: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) fn(data);
  }

  on(event: string, callback: Listener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  off(event: string, callback: Listener): void {
    this.listeners.get(event)?.delete(callback);
  }

  /**
   * Принудительно обновить auth на сокете (полезно после login/register).
   */
  refreshAuth(): void {
    if (!this.socket) return;
    this.socket.auth = { token: getToken() };
  }

  /**
   * Полный reconnect с новым токеном.
   * Вызывай после успешного login/register, если до этого сокет уже был подключен.
   */
  reconnectWithFreshToken(): Promise<void> {
    this.disconnect();
    return this.connect();
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // уже подключен
      if (this.socket?.connected) {
        resolve();
        return;
      }

      const token = getToken();

      this.socket = io(`${BASE_URL}${this.namespacePath}`, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 800,
        auth: { token }, // <-- берём токен ПРЯМО СЕЙЧАС
      });

      this.socket.on('connect', () => {
        console.log(`[socket${this.namespacePath}] connected:`, this.socket?.id);
        this.emitLocal('connect', this.socket?.id ?? null);
        resolve();
      });

      this.socket.on('connect_error', (err: any) => {
        console.error(`[socket${this.namespacePath}] connect_error:`, err?.message ?? err, err);
        reject(err);
      });

      this.socket.on('disconnect', (reason) => {
        console.log(`[socket${this.namespacePath}] disconnected:`, reason);
        this.emitLocal('disconnect', reason);
      });

      // если сервер шлёт "test" — логируем, удобно для дебага
      this.socket.on('test', (data: any) => {
        console.log(`[socket${this.namespacePath}] test:`, data);
      });
    });
  }

  disconnect(): void {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
  }

  protected ackOrTimeout<T>(emitFn: (cb: (res: T) => void) => void, ms = 8000): Promise<T> {
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(({
          success: false,
          error: 'Timeout (no ack from server)',
        } as unknown) as T);
      }, ms);

      emitFn((res: T) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(res);
      });
    });
  }

  protected ensureSocket(): Socket | null {
    if (!this.socket) return null;
    // если токен поменялся (после логина), можно обновлять перед каждым запросом
    this.socket.auth = { token: getToken() };
    return this.socket;
  }
}

/* ===================== POKER ===================== */

class PokerSocket extends BaseNS {
  constructor() {
    super('/poker', 'poker');
  }

  // слушаем gameState из poker namespace
  override connect(): Promise<void> {
    return super.connect().then(() => {
      const s = this.socket!;
      s.on('gameState', (data: ClientGameState) => this.emitLocal('gameState', data));
      s.on('lobbyEnded', () => this.emitLocal('lobbyEnded', null));
    });
  }

  createLobby(): Promise<CreateLobbyResponse> {
    const s = this.ensureSocket();
    if (!s) return Promise.resolve({ success: false, error: 'Not connected' });

    return this.ackOrTimeout<CreateLobbyResponse>((cb) => {
      s.emit('createLobby', {}, cb);
    });
  }

  joinLobby(code: string): Promise<JoinLobbyResponse> {
    const s = this.ensureSocket();
    if (!s) return Promise.resolve({ success: false, error: 'Not connected' });

    return this.ackOrTimeout<JoinLobbyResponse>((cb) => {
      s.emit('joinLobby', { code }, cb);
    });
  }

  startGame(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    const s = this.ensureSocket();
    if (!s) return Promise.resolve({ success: false, error: 'Not connected' });

    return this.ackOrTimeout((cb) => {
      s.emit('startGame', { lobbyCode }, cb);
    });
  }

  sendAction(
    lobbyCode: string,
    action: PlayerAction,
    amount?: number,
  ): Promise<{ success: boolean; error?: string }> {
    const s = this.ensureSocket();
    if (!s) return Promise.resolve({ success: false, error: 'Not connected' });

    return this.ackOrTimeout((cb) => {
      s.emit('playerAction', { lobbyCode, action, amount }, cb);
    });
  }

  requestState(lobbyCode: string): Promise<{ success: boolean; gameState?: ClientGameState }> {
    const s = this.ensureSocket();
    if (!s) return Promise.resolve({ success: false });

    return this.ackOrTimeout((cb) => {
      s.emit('requestState', { lobbyCode }, cb);
    });
  }

  endLobby(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    const s = this.ensureSocket();
    if (!s) return Promise.resolve({ success: false, error: 'Not connected' });

    return this.ackOrTimeout((cb) => {
      s.emit('endLobby', { lobbyCode }, cb);
    });
  }
}

export const pokerSocket = new PokerSocket();

/* ===================== UNO ===================== */

class UnoSocket extends BaseNS {
  constructor() {
    super('/uno', 'uno');
  }

  override connect(): Promise<void> {
    return super.connect().then(() => {
      const s = this.socket!;
      // у тебя было и gameState и unoState — оставим оба
      s.on('gameState', (data: UnoClientState) => this.emitLocal('gameState', data));
      s.on('unoState', (data: UnoClientState) => this.emitLocal('gameState', data));
      s.on('lobbyEnded', () => this.emitLocal('lobbyEnded', null));
    });
  }

  createLobby(): Promise<UnoCreateLobbyResponse> {
    const s = this.ensureSocket();
    if (!s) return Promise.resolve({ success: false, error: 'Not connected' });

    return this.ackOrTimeout<UnoCreateLobbyResponse>((cb) => {
      // gameType можно не слать, т.к. мы уже в /uno, но пусть будет — не ломает
      s.emit('createLobby', { gameType: 'uno' }, cb);
    });
  }

  joinLobby(code: string): Promise<UnoJoinLobbyResponse> {
    const s = this.ensureSocket();
    if (!s) return Promise.resolve({ success: false, error: 'Not connected' });

    return this.ackOrTimeout<UnoJoinLobbyResponse>((cb) => {
      s.emit('joinLobby', { gameType: 'uno', code }, cb);
    });
  }

  startGame(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    const s = this.ensureSocket();
    if (!s) return Promise.resolve({ success: false, error: 'Not connected' });

    return this.ackOrTimeout((cb) => {
      s.emit('startGame', { gameType: 'uno', lobbyCode }, cb);
    });
  }

  sendAction(
    lobbyCode: string,
    action: UnoPlayerAction,
  ): Promise<{ success: boolean; error?: string }> {
    const s = this.ensureSocket();
    if (!s) return Promise.resolve({ success: false, error: 'Not connected' });

    return this.ackOrTimeout((cb) => {
      s.emit('playerAction', { gameType: 'uno', lobbyCode, action }, cb);
    });
  }

  requestState(lobbyCode: string): Promise<{ success: boolean; gameState?: UnoClientState }> {
    const s = this.ensureSocket();
    if (!s) return Promise.resolve({ success: false });

    return this.ackOrTimeout((cb) => {
      s.emit('requestState', { gameType: 'uno', lobbyCode }, cb);
    });
  }

  endLobby(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    const s = this.ensureSocket();
    if (!s) return Promise.resolve({ success: false, error: 'Not connected' });

    return this.ackOrTimeout((cb) => {
      s.emit('endLobby', { gameType: 'uno', lobbyCode }, cb);
    });
  }
}

export const unoSocket = new UnoSocket();
