import { io, Socket } from 'socket.io-client';
import { getToken } from './api';
import type { ClientGameState, PlayerAction, CreateLobbyResponse, JoinLobbyResponse } from '../types/poker';
import type {
  UnoClientState,
  UnoPlayerAction,
  UnoCreateLobbyResponse,
  UnoJoinLobbyResponse,
} from '../types/uno';

const ENV = (import.meta as any).env as { VITE_BACKEND_URL?: string; PROD?: boolean };
const SOCKET_URL = ENV.VITE_BACKEND_URL || (ENV.PROD
  ? 'https://bulk-games-backend-production.up.railway.app'
  : 'http://localhost:3001');

class PokerSocket {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<(data: unknown) => void>> = new Map();

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve();
        return;
      }

      this.socket = io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        auth: { token: getToken() },
      });

      this.socket.on('connect', () => {
        console.log('Socket connected');
        this.emit('connect', null);
        resolve();
      });

      this.socket.on('connect_error', (error: unknown) => {
        console.error('Socket connection error:', error);
        reject(error);
      });

      this.socket.on('disconnect', () => {
        console.log('Socket disconnected');
        this.emit('disconnect', null);
      });

      this.socket.on('gameState', (data: ClientGameState) => {
        this.emit('gameState', data);
      });

      this.socket.on('lobbyEnded', () => {
        this.emit('lobbyEnded', null);
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private emit(event: string, data: unknown): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(listener => listener(data));
    }
  }

  on(event: string, callback: (data: unknown) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  off(event: string, callback: (data: unknown) => void): void {
    this.listeners.get(event)?.delete(callback);
  }

  createLobby(): Promise<CreateLobbyResponse> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ success: false, error: 'Not connected' });
        return;
      }
      this.socket.emit('createLobby', {}, resolve);
    });
  }

  joinLobby(code: string): Promise<JoinLobbyResponse> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ success: false, error: 'Not connected' });
        return;
      }
      this.socket.emit('joinLobby', { code }, resolve);
    });
  }

  startGame(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ success: false, error: 'Not connected' });
        return;
      }
      this.socket.emit('startGame', { lobbyCode }, resolve);
    });
  }

  sendAction(
    lobbyCode: string,
    action: PlayerAction,
    amount?: number,
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ success: false, error: 'Not connected' });
        return;
      }
      this.socket.emit('playerAction', { lobbyCode, action, amount }, resolve);
    });
  }

  requestState(lobbyCode: string): Promise<{ success: boolean; gameState?: ClientGameState }> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ success: false });
        return;
      }
      this.socket.emit('requestState', { lobbyCode }, resolve);
    });
  }

  endLobby(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ success: false, error: 'Not connected' });
        return;
      }
      this.socket.emit('endLobby', { lobbyCode }, resolve);
    });
  }
}

export const pokerSocket = new PokerSocket();

class UnoSocket {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<(data: unknown) => void>> = new Map();

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve();
        return;
      }

      this.socket = io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        auth: { token: getToken() },
      });

      this.socket.on('connect', () => {
        console.log('UNO socket connected');
        this.emit('connect', null);
        resolve();
      });

      this.socket.on('connect_error', (error: unknown) => {
        console.error('UNO socket connection error:', error);
        reject(error);
      });

      this.socket.on('disconnect', () => {
        console.log('UNO socket disconnected');
        this.emit('disconnect', null);
      });

      this.socket.on('gameState', (data: UnoClientState) => {
        this.emit('gameState', data);
      });

      this.socket.on('unoState', (data: UnoClientState) => {
        this.emit('gameState', data);
      });

      this.socket.on('lobbyEnded', () => {
        this.emit('lobbyEnded', null);
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private emit(event: string, data: unknown): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(listener => listener(data));
    }
  }

  on(event: string, callback: (data: unknown) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  createLobby(): Promise<UnoCreateLobbyResponse> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ success: false, error: 'Not connected' });
        return;
      }
      this.socket.emit('createLobby', { gameType: 'uno' }, resolve);
    });
  }

  joinLobby(code: string): Promise<UnoJoinLobbyResponse> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ success: false, error: 'Not connected' });
        return;
      }
      this.socket.emit('joinLobby', { gameType: 'uno', code }, resolve);
    });
  }

  startGame(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ success: false, error: 'Not connected' });
        return;
      }
      this.socket.emit('startGame', { gameType: 'uno', lobbyCode }, resolve);
    });
  }

  sendAction(
    lobbyCode: string,
    action: UnoPlayerAction,
  ): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ success: false, error: 'Not connected' });
        return;
      }
      this.socket.emit('playerAction', { gameType: 'uno', lobbyCode, action }, resolve);
    });
  }

  requestState(lobbyCode: string): Promise<{ success: boolean; gameState?: UnoClientState }> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ success: false });
        return;
      }
      this.socket.emit('requestState', { gameType: 'uno', lobbyCode }, resolve);
    });
  }

  endLobby(lobbyCode: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ success: false, error: 'Not connected' });
        return;
      }
      this.socket.emit('endLobby', { gameType: 'uno', lobbyCode }, resolve);
    });
  }
}

export const unoSocket = new UnoSocket();
