/**
 * sfx.ts — Centralised Sound Effects Manager
 *
 * Design goals:
 *  - Single registry: event key → array of audio file URLs (variants).
 *  - Vite glob-imports every .wav in /assets/sounds/ so they are
 *    included in the production build with hashed filenames.
 *  - Respects browser autoplay policy: play() is a no-op until
 *    sfx.unlock() is called after the first user gesture.
 *  - Per-event cooldowns prevent rapid sound spam.
 *  - Settings (enabled / volume) are persisted in localStorage.
 *  - Lightweight: uses HTMLAudioElement; no external libraries.
 */

// ── Import all .wav files via Vite so they are bundled correctly ──────────────
const _wavAssets = import.meta.glob('/assets/sounds/*.wav', {
  eager: true,
  import: 'default',
}) as Record<string, string>

/** Resolve a bare filename → Vite-processed URL (hashed in prod). */
function w(filename: string): string {
  return _wavAssets[`/assets/sounds/${filename}`] ?? `/assets/sounds/${filename}`
}

// ── Sound registry ─────────────────────────────────────────────────────────────
/**
 * Each key is a logical "event name" that game code calls via sfx.play('key').
 * Values are arrays of URLs; when multiple variants exist, one is chosen at random.
 */
const SOUNDS: Record<string, string[]> = {
  /**
   * Cards being dealt at game start (UNO initial deal; Poker hole-card deal).
   * Files: SFX_Card_Deal_Comm_New, Uno_SFX_Card_Deal_Comm_01/02/04
   */
  deal: [
    w('Uno_SFX_Card_Deal_Comm_01.wav'),
    w('Uno_SFX_Card_Deal_Comm_02.wav'),
    w('Uno_SFX_Card_Deal_Comm_04.wav'),
    w('SFX_Card_Deal_Comm_New.wav'),
  ],

  /**
   * Drawing a card from the deck (UNO draw action; Poker community card reveal).
   * Files: SFX_Card_Draw_Comm_1-4_New
   */
  draw: [
    w('SFX_Card_Draw_Comm_1_New.wav'),
    w('SFX_Card_Draw_Comm_2_New.wav'),
    w('SFX_Card_Draw_Comm_3_New.wav'),
    w('SFX_Card_Draw_Comm_4_New.wav'),
  ],

  /**
   * Local player plays a normal (non-special) card.
   * File: SFX_Card_Pick
   */
  card_play_self: [w('SFX_Card_Pick.wav')],

  /**
   * Another player plays a normal card (detected from state diff).
   * File: SFX_Card_Effect_Show_Norm_Comm_New
   */
  card_play_other: [w('SFX_Card_Effect_Show_Norm_Comm_New.wav')],

  /**
   * Subtle UI action: card hover/select, Check in Poker, "your turn" ping.
   * File: SFX_Card_Select
   */
  card_select: [w('SFX_Card_Select.wav')],

  /**
   * Punishing / aggressive card played: UNO Draw-2, Wild Draw-4; Poker bet/raise.
   * File: SFX_Card_Effect_Show_Punish_Comm_New
   */
  card_punish: [w('SFX_Card_Effect_Show_Punish_Comm_New.wav')],

  /**
   * Skip card played (any player).
   * File: SFX_Card_Effect_Stop_New
   */
  card_skip: [w('SFX_Card_Effect_Stop_New.wav')],

  /**
   * Reverse card played / direction change.
   * Files: Uno_SFX_ArrowSwitch_012, Uno_SFX_Card_Effect_UTurn_01
   */
  card_reverse: [
    w('Uno_SFX_ArrowSwitch_012.wav'),
    w('Uno_SFX_Card_Effect_UTurn_01.wav'),
  ],

  /**
   * Match / round begins.
   * File: Uno_SFX_Gamestart_02
   */
  game_start: [w('Uno_SFX_Gamestart_02.wav')],

  /**
   * Wild card played (colour picker opens); also used as a "special open" cue.
   * File: SFX_Card_OpenDeck
   */
  wild_card: [w('SFX_Card_OpenDeck.wav')],

  /**
   * Local player wins the round / game.
   * File: SFX_UI_Victory_Token_04
   */
  win: [w('SFX_UI_Victory_Token_04.wav')],

  /**
   * Game / round ends and local player did NOT win.
   * File: SFX_GameStart_End  (dual-purpose: start AND end of game session)
   */
  game_end: [w('SFX_GameStart_End.wav')],
}

// ── Persist & restore settings ────────────────────────────────────────────────
function _readBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v !== 'false'
  } catch {
    return fallback
  }
}

function _readFloat(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return fallback
    const n = parseFloat(v)
    return isNaN(n) ? fallback : n
  } catch {
    return fallback
  }
}

let _enabled = _readBool('sfx_enabled', true)
let _volume = _readFloat('sfx_volume', 0.7)

// ── Browser autoplay gate ─────────────────────────────────────────────────────
let _unlocked = false

// ── Per-event cooldown (prevents rapid-fire spam) ─────────────────────────────
const DEFAULT_COOLDOWN_MS = 200
const _lastPlayed = new Map<string, number>()

// ── HTMLAudioElement cache (lazy) ─────────────────────────────────────────────
const _audioCache = new Map<string, HTMLAudioElement>()

function _getAudio(url: string): HTMLAudioElement {
  if (!_audioCache.has(url)) {
    const el = new Audio()
    el.preload = 'none'
    el.src = url
    _audioCache.set(url, el)
  }
  return _audioCache.get(url)!
}

/** Preload the most-used sounds into memory (called once after first gesture). */
function _preloadCommon(): void {
  const PRELOAD_EVENTS = ['deal', 'draw', 'card_play_self', 'card_play_other', 'card_punish']
  for (const ev of PRELOAD_EVENTS) {
    for (const url of SOUNDS[ev] ?? []) {
      const el = _getAudio(url)
      el.preload = 'auto'
    }
  }
}

// ── Subscription (lets React components re-render on settings changes) ─────────
type Listener = () => void
const _listeners = new Set<Listener>()

function _emit(): void {
  _listeners.forEach(fn => fn())
}

// ── Public SFX API ────────────────────────────────────────────────────────────
export const sfx = {
  /**
   * Initialise: preload common sounds.
   * Safe to call before user gesture (no audio plays).
   */
  init(): void {
    _preloadCommon()
  },

  /**
   * Unlock audio after the first user gesture.
   * Must be called from a click / pointerdown / keydown handler.
   * play() is a no-op until this is called.
   */
  unlock(): void {
    if (_unlocked) return
    _unlocked = true
    _preloadCommon()
    // A zero-volume play/pause satisfies Chrome's autoplay policy
    const urls = SOUNDS['card_play_self']
    if (urls?.length) {
      const el = new Audio()
      el.src = urls[0]
      el.volume = 0
      el.play().then(() => el.pause()).catch(() => { /* expected on some browsers */ })
    }
  },

  setEnabled(val: boolean): void {
    _enabled = val
    try { localStorage.setItem('sfx_enabled', String(val)) } catch { /* ignore */ }
    _emit()
  },

  setVolume(val: number): void {
    _volume = Math.max(0, Math.min(1, val))
    try { localStorage.setItem('sfx_volume', String(_volume)) } catch { /* ignore */ }
    _emit()
  },

  getEnabled(): boolean { return _enabled },
  getVolume(): number { return _volume },

  /**
   * Play a sound event.
   * @param event   Key from the SOUNDS registry.
   * @param options.cooldownMs  Per-event cooldown in ms (default 200).
   *                            Use a larger value for once-per-game events.
   */
  play(event: string, options?: { cooldownMs?: number }): void {
    if (!_enabled || !_unlocked) return

    const now = Date.now()
    const cd = options?.cooldownMs ?? DEFAULT_COOLDOWN_MS
    const last = _lastPlayed.get(event) ?? 0
    if (now - last < cd) return
    _lastPlayed.set(event, now)

    const files = SOUNDS[event]
    if (!files?.length) return

    // Pick a random variant
    const url = files.length === 1
      ? files[0]
      : files[Math.floor(Math.random() * files.length)]

    const audio = _getAudio(url)

    if (!audio.paused) {
      // Allow overlapping instances by cloning the element
      const clone = audio.cloneNode() as HTMLAudioElement
      clone.volume = _volume
      clone.play().catch(() => { /* autoplay blocked */ })
      return
    }

    audio.currentTime = 0
    audio.volume = _volume
    audio.play().catch(() => { /* autoplay blocked */ })
  },
}

/**
 * Subscribe to settings changes so React components can re-render.
 * Returns an unsubscribe function.
 */
export function subscribeSfx(listener: Listener): () => void {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

