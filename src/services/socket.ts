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

const ENV = (import.meta as any).env as { VITE_BACKEND_URL?: string; PROD?: boolean; DEV?: boolean }

const BASE_URL =
  ENV.VITE_BACKEND_URL ||
  (ENV.PROD ? 'https://bulk-games-backend-production.up.railway.app' : 'http://localhost:3001')

const IS_DEV = !!ENV.DEV

type Listener = (data: any) => void

/** ACK response from server for player actions */
export interface ActionAck {
  success: boolean
  accepted?: boolean
  reason?: string
  version?: number
  gameState?: any
  error?: string
}

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
  private _connectPromise: Promise<void> | null = null

  constructor(
    private namespace: '/poker' | '/uno',
    private label: string,
  ) {}

  private url(): string {
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
    const token = getToken()
    if (!token) {
      return Promise.reject(new Error('No token in localStorage (bulk_games_token)'))
    }

    if (this.socket?.connected) {
      return Promise.resolve()
    }

    // If already connecting, return existing promise
    if (this._connectPromise) return this._connectPromise

    // Kill previous socket to avoid duplicates
    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.disconnect()
      this.socket = null
    }

    this._connectPromise = new Promise<void>((resolve, reject) => {
      const s = io(this.url(), {
        // Prefer websocket; fall back to polling only if ws is unavailable.
        // Railway fully supports websockets so polling is rarely needed.
        transports: ['websocket', 'polling'],
        // Unlimited reconnect attempts — important for Railway cold starts.
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 800,
        reconnectionDelayMax: 5000,
        // Must be < server pingTimeout (30s) to stay alive through Railway proxy.
        timeout: 20000,
        auth: { token },
      })

      this.socket = s

      s.on('connect', () => {
        this.log('connected:', s.id)
        this._connectPromise = null
        this.emitLocal('connect', null)
        resolve()
      })

      s.on('connect_error', (err: any) => {
        this.log('connect_error:', err?.message || err)
        this._connectPromise = null
        reject(err)
      })

      s.on('disconnect', (reason: any) => {
        this.log('disconnected:', reason)
        this._connectPromise = null
        this.emitLocal('disconnect', null)
      })

      // ── Forward ALL game events from raw socket to local listeners ──
      s.on('gameState', (data: any) => {
        this.log('gameState received')
        this.emitLocal('gameState', data)
      })

      s.on('uno:roster', (data: any) => {
        this.emitLocal('uno:roster', data)
      })

      s.on('game:celebration', (data: any) => {
        if (IS_DEV) this.log('game:celebration received', data)
        this.emitLocal('game:celebration', data)
      })

      s.on('lobbyEnded', () => {
        this.log('lobbyEnded received')
        this.emitLocal('lobbyEnded', null)
      })

      s.on('test', (data: any) => {
        this.log('test:', data)
        this.emitLocal('test', data)
      })

      // UNO draw animation event for opponents (no card face, just playerId + count)
      s.on('uno:drawFx', (data: any) => {
        this.emitLocal('uno:drawFx', data)
      })
    })

    return this._connectPromise
  }

  disconnect(): void {
    this._connectPromise = null
    if (!this.socket) return
    this.socket.removeAllListeners()
    this.socket.disconnect()
    this.socket = null
  }

  protected emitAck<T = any>(event: string, payload: any, timeoutMs = 8000): Promise<T> {
    const s = this.socket
    if (!s || !s.connected) return Promise.resolve({ success: false, error: 'Not connected' } as any)

    // Update auth token in case it changed
    const token = getToken()
    if (token) (s as any).auth = { token }

    const t0 = IS_DEV ? performance.now() : 0

    return withTimeout<T>(
      new Promise((resolve, reject) => {
        try {
          s.emit(event, payload, (resp: T) => {
            if (IS_DEV) {
              const rtt = performance.now() - t0
              console.log(`[RTT:${this.label}] ${event}: ${rtt.toFixed(1)}ms`)
            }
            resolve(resp)
          })
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
    return this.emitAck<CreateLobbyResponse>('createLobby', {}, 8000)
  }

  joinLobby(code: string): Promise<JoinLobbyResponse> {
    return this.emitAck<JoinLobbyResponse>('joinLobby', { code }, 8000)
  }

  startGame(lobbyCode: string): Promise<ActionAck> {
    return this.emitAck<ActionAck>('startGame', { lobbyCode }, 8000)
  }

  sendAction(
    lobbyCode: string,
    action: PlayerAction,
    amount?: number,
  ): Promise<ActionAck> {
    return this.emitAck<ActionAck>('playerAction', { lobbyCode, action, amount }, 8000)
  }

  requestState(lobbyCode: string): Promise<{ success: boolean; gameState?: ClientGameState }> {
    return this.emitAck('requestState', { lobbyCode }, 8000)
  }

  /** Request a full state resync (e.g. when version gap is detected) */
  requestFullState(lobbyCode: string): Promise<{ success: boolean; gameState?: ClientGameState }> {
    return this.emitAck('requestState', { lobbyCode }, 8000)
  }

  endLobby(lobbyCode: string): Promise<ActionAck> {
    return this.emitAck<ActionAck>('endLobby', { lobbyCode }, 8000)
  }

  leaveLobby(lobbyCode: string): Promise<ActionAck> {
    return this.emitAck<ActionAck>('leaveLobby', { lobbyCode }, 8000)
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

  startGame(lobbyCode: string): Promise<ActionAck> {
    return this.emitAck<ActionAck>('startGame', { lobbyCode }, 8000)
  }

  sendAction(
    lobbyCode: string,
    action: UnoPlayerAction,
  ): Promise<ActionAck> {
    return this.emitAck<ActionAck>('playerAction', { lobbyCode, action }, 8000)
  }

  callUno(lobbyCode: string): Promise<ActionAck> {
    return this.sendAction(lobbyCode, { type: 'callUno' })
  }

  catchUno(lobbyCode: string): Promise<ActionAck> {
    return this.sendAction(lobbyCode, { type: 'catchUno' })
  }

  requestState(lobbyCode: string): Promise<{ success: boolean; gameState?: UnoClientState }> {
    return this.emitAck('requestState', { lobbyCode }, 8000)
  }

  /** Request a full state resync (e.g. when version gap is detected) */
  requestFullState(lobbyCode: string): Promise<{ success: boolean; gameState?: UnoClientState }> {
    return this.emitAck('requestState', { lobbyCode }, 8000)
  }

  endLobby(lobbyCode: string): Promise<ActionAck> {
    return this.emitAck<ActionAck>('endLobby', { lobbyCode }, 8000)
  }

  leaveLobby(lobbyCode: string): Promise<ActionAck> {
    return this.emitAck<ActionAck>('leaveLobby', { lobbyCode }, 8000)
  }
}

export const unoSocket = new UnoSocket()
