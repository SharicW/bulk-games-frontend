import { io, type Socket } from 'socket.io-client';
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
  (ENV.PROD ? 'https://bulk-games-backend-production.up.railway.app' : 'http://localhost:3001');

/** helper: аккуратно склеить base + namespace */
function nsUrl(namespace: '/poker' | '/uno') {
  return `${BASE_URL.replace(/\/$/, '')}${namespace}`;
}

type Listener = (data: unknown) => void;

class BaseNsSocket {
  protected socket: Socket | null = null;
  protected listeners: Map<string, Set<Listener>> = new Map();

  constructor(
    protected namespace: '/poker' | '/uno',
    protected label: '[socket/poker]' | '[socket/uno]',
  ) {}

  /** внутренняя рассылка событий в подписчиков */
  protected emitLocal(event: string, data: unknown) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) cb(data);
  }

  on(event: string, cb: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  off(event: string, cb: Listener) {
    this.listeners.get(event)?.delete(cb);
  }

  isConnected() {
    return !!this.socket?.connected;
  }

  disconnect() {
    if (!this.socket) return;
    this.socket.disconnect();
    this.socket = null;
  }

  /** emit с ack и таймаутом — чтобы не зависало "втихую" */
  protected emitWithAck<TResp = any, TPayload = any>(
    event: string,
    payload: TPayload,
    timeoutMs = 8000,
  ): Promise<TResp> {
    return new Promise((resolve) => {
      const s = this.socket;
      if (!s) {
        resolve({ success: false, error: 'Not connected' } as any);
        return;
      }

      let done = false;
      const t = setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ success: false, error: `Timeout: ${event}` } as any);
      }, timeoutMs);

      s.emit(event, payload as any, (resp: TResp) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(resp);
      });
    });
  }

  connect(): Promise<string> {
    return new Promise((resolve, reject) => {
      // уже подключены
      if (this.socket?.connected) {
        resolve(this.socket.id);
        return;
      }

      const token = getToken(); // важно: берём актуальный токен в момент коннекта

      const s = io(nsUrl(this.namespace), {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 800,
        auth: { token },
        withCredentials: true,
      });

      this.socket = s;

      // на каждый реконнект — обновляем токен (если он поменялся после логина)
      s.io.on('reconnect_attempt', () => {
        s.auth = { token: getToken() };
      });

      s.on('connect', () => {
        console.log(this.label, 'connected:', s.id);
        // вот это чинит твой "connected: undefined"
        this.emitLocal('connect', s.id);
        resolve(s.id);
      });

      s.on('connect_error', (err: any) => {
        console.error(this.label, 'connect_error:', err?.message || err);
        this.emitLocal('connect_error', err);
        reject(err);
      });

      s.on('disconnect', (reason) => {
        console.log(this.label, 'disconnected:', reason);
        this.emitLocal('disconnect', reason);
      });

      // общий "пинг" от бэка (у тебя он называется test)
      s.on('test', (data) => {
        console.log(this.label, 'test:', data);
        this.emitLocal('test', data);
      });
    });
  }
}

/* ========================= POKER ========================= */

class PokerSocket extends BaseNsSocket {
  constructor() {
    super('/poker', '[socket/poker]');
  }

  // Состояние игры (если бэк шлёт gameState)
  bindGameState() {
    this.socket?.on('gameState', (data: ClientGameState) => {
      this.emitLocal('gameState', data);
    });
    this.socket?.on('lobbyEnded', () => this.emitLocal('lobbyEnded', null));
  }

  override async connect(): Promise<string> {
    const id = await super.connect();
    this.bindGameState();
    return id;
  }

  createLobby(): Promise<CreateLobbyResponse> {
    // на всякий: передаём gameType, чтобы бэк точно понял
    return this.emitWithAck<CreateLobbyResponse>('createLobby', { gameType: 'poker' });
  }

  joinLobby(code: string): Promise<JoinLobbyResponse> {
    return this.emitWithAck<JoinLobbyResponse>('joinLobby', { gameType: 'poker', code });
  }

  startGame(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return this.emitWithAck('startGame', { gameType: 'poker', lobbyCode });
  }

  sendAction(lobbyCode: string, action: PlayerAction, amount?: number) {
    return this.emitWithAck<{ success: boolean; error?: string }>('playerAction', {
      gameType: 'poker',
      lobbyCode,
      action,
      amount,
    });
  }

  requestState(lobbyCode: string) {
    return this.emitWithAck<{ success: boolean; gameState?: ClientGameState }>('requestState', {
      gameType: 'poker',
      lobbyCode,
    });
  }

  endLobby(lobbyCode: string) {
    return this.emitWithAck<{ success: boolean; error?: string }>('endLobby', {
      gameType: 'poker',
      lobbyCode,
    });
  }
}

export const pokerSocket = new PokerSocket();

/* ========================= UNO ========================= */

class UnoSocket extends BaseNsSocket {
  constructor() {
    super('/uno', '[socket/uno]');
  }

  bindGameState() {
    this.socket?.on('gameState', (data: UnoClientState) => {
      this.emitLocal('gameState', data);
    });
    // если бэк иногда шлёт unoState
    this.socket?.on('unoState', (data: UnoClientState) => {
      this.emitLocal('gameState', data);
    });
    this.socket?.on('lobbyEnded', () => this.emitLocal('lobbyEnded', null));
  }

  override async connect(): Promise<string> {
    const id = await super.connect();
    this.bindGameState();
    return id;
  }

  createLobby(): Promise<UnoCreateLobbyResponse> {
    return this.emitWithAck<UnoCreateLobbyResponse>('createLobby', { gameType: 'uno' });
  }

  joinLobby(code: string): Promise<UnoJoinLobbyResponse> {
    return this.emitWithAck<UnoJoinLobbyResponse>('joinLobby', { gameType: 'uno', code });
  }

  startGame(lobbyCode: string) {
    return this.emitWithAck<{ success: boolean; error?: string }>('startGame', {
      gameType: 'uno',
      lobbyCode,
    });
  }

  sendAction(lobbyCode: string, action: UnoPlayerAction) {
    return this.emitWithAck<{ success: boolean; error?: string }>('playerAction', {
      gameType: 'uno',
      lobbyCode,
      action,
    });
  }

  requestState(lobbyCode: string) {
    return this.emitWithAck<{ success: boolean; gameState?: UnoClientState }>('requestState', {
      gameType: 'uno',
      lobbyCode,
    });
  }

  endLobby(lobbyCode: string) {
    return this.emitWithAck<{ success: boolean; error?: string }>('endLobby', {
      gameType: 'uno',
      lobbyCode,
    });
  }
}

export const unoSocket = new UnoSocket();
