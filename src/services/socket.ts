import { io, Socket } from 'socket.io-client'
import { getToken } from './api'

import type {
  ClientGameState,
  PlayerAction,
  CreateLobbyResponse,
  JoinLobbyResponse,
} from '../types/poker'

import type {
  UnoClientState,
  UnoPlayerAction,
  UnoCreateLobbyResponse,
  UnoJoinLobbyResponse,
} from '../types/uno'

const ENV = (import.meta as any).env as { VITE_BACKEND_URL?: string; PROD?: boolean }

const BASE_URL =
  ENV.VITE_BACKEND_URL ||
  (ENV.PROD ? 'https://bulk-games-backend-production.up.railway.app' : 'http://localhost:3001')

type Listener = (data: any) => void

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

/* ───────────────────────── Base socket wrapper ───────────────────────── */

class NamespacedSocket {
  protected socket: Socket | null = null
  protected listeners = new Map<string, Set<Listener>>()

  constructor(
    private namespace: '/poker' | '/uno',
    private label: string,
  ) {}

  private url(): string {
    // Важно: namespace добавляем прямо в URL
    return `${BASE_URL}${this.namespace}`
  }

  protected log(...args: any[]) {
    console.log(`[socket${this.namespace}]`, ...args)
  }

  protected emitLocal(event: string, data: any) {
    const set = this.listeners.get(event)
    if (!set) return
    for (const cb of set) cb(data)
  }

  on(event: string, cb: Listener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(cb)
    return () => this.listeners.get(event)?.delete(cb)
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const token = getToken()
      if (!token) {
        reject(new Error('No token найден в localStorage (bulk_games_token)'))
        return
      }

      if (this.socket?.connected) {
        resolve()
        return
      }

      // если сокет уже был — прибиваем, чтобы не плодить коннекты
      if (this.socket) {
        this.socket.disconnect()
        this.socket = null
      }

      this.socket = io(this.url(), {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 800,
        auth: { token }, // важно: токен именно сюда
      })

      this.socket.on('connect', () => {
        this.log('connected:', this.socket?.id)
        this.emitLocal('connect', null)
        resolve()
      })

      this.socket.on('connect_error', (err: any) => {
        this.log('connect_error:', err?.message || err)
        reject(err)
      })

      this.socket.on('disconnect', (reason: any) => {
        this.log('disconnected:', reason)
        this.emitLocal('disconnect', null)
      })

      // твой тест с бэка
      this.socket.on('test', (data: any) => {
        this.log('test:', data)
        this.emitLocal('test', data)
      })
    })
  }

  disconnect(): void {
    if (!this.socket) return
    this.socket.disconnect()
    this.socket = null
  }

  protected emitAck<T = any>(event: string, payload: any, timeoutMs = 8000): Promise<T> {
    const s = this.socket
    if (!s) return Promise.resolve({ success: false, error: 'Not connected' } as any)

    // на всякий: если токен обновился — обновим auth перед эмитом
    const token = getToken()
    if (token) (s as any).auth = { token }

    return withTimeout<T>(
      new Promise((resolve, reject) => {
        try {
          s.emit(event, payload, (resp: T) => resolve(resp))
        } catch (e) {
          reject(e)
        }
      }),
      timeoutMs,
      event,
    ).catch((e) => {
      this.log(`${event} timeout/error:`, e)
      throw e
    })
  }
}

/* ───────────────────────── Poker namespace (/poker) ───────────────────────── */

class PokerSocket extends NamespacedSocket {
  constructor() {
    super('/poker', 'poker')
    this.on('connect', () => this.log('ready'))
  }

  createLobby(): Promise<CreateLobbyResponse> {
    // если на бэке ожидается просто createLobby без payload — так и оставляем
    return this.emitAck<CreateLobbyResponse>('createLobby', {}, 8000)
  }

  joinLobby(code: string): Promise<JoinLobbyResponse> {
    return this.emitAck<JoinLobbyResponse>('joinLobby', { code }, 8000)
  }

  startGame(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return this.emitAck('startGame', { lobbyCode }, 8000)
  }

  sendAction(
    lobbyCode: string,
    action: PlayerAction,
    amount?: number,
  ): Promise<{ success: boolean; error?: string }> {
    return this.emitAck('playerAction', { lobbyCode, action, amount }, 8000)
  }

  requestState(lobbyCode: string): Promise<{ success: boolean; gameState?: ClientGameState }> {
    return this.emitAck('requestState', { lobbyCode }, 8000)
  }

  endLobby(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return this.emitAck('endLobby', { lobbyCode }, 8000)
  }
}

export const pokerSocket = new PokerSocket()

/* ───────────────────────── UNO namespace (/uno) ───────────────────────── */

class UnoSocket extends NamespacedSocket {
  constructor() {
    super('/uno', 'uno')
    this.on('connect', () => this.log('ready'))
  }

  createLobby(): Promise<UnoCreateLobbyResponse> {
    return this.emitAck<UnoCreateLobbyResponse>('createLobby', {}, 8000)
  }

  joinLobby(code: string): Promise<UnoJoinLobbyResponse> {
    return this.emitAck<UnoJoinLobbyResponse>('joinLobby', { code }, 8000)
  }

  startGame(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return this.emitAck('startGame', { lobbyCode }, 8000)
  }

  sendAction(
    lobbyCode: string,
    action: UnoPlayerAction,
  ): Promise<{ success: boolean; error?: string }> {
    return this.emitAck('playerAction', { lobbyCode, action }, 8000)
  }

  requestState(lobbyCode: string): Promise<{ success: boolean; gameState?: UnoClientState }> {
    return this.emitAck('requestState', { lobbyCode }, 8000)
  }

  endLobby(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return this.emitAck('endLobby', { lobbyCode }, 8000)
  }
}

export const unoSocket = new UnoSocket()
