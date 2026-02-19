import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../hooks/useAuth'
import Modal from '../components/Modal'
import WinCelebration from '../components/WinCelebration'
import SfxControls from '../components/SfxControls'
import tableLogo from '/assets/BULK_GAMES_LOGO.png'
import { unoSocket } from '../services/socket'
import { sfx } from '../services/sfx'
import type { UnoCard, UnoCardFace, UnoClientState, UnoColor } from '../types/uno'

/** Build CSS classes for player cosmetics from game-state data */
const BORDER_MAP: Record<string, string> = {
  border_gold: 'cosmetic-border--gold',
  border_rainbow: 'cosmetic-border--rainbow',
  border_neon: 'cosmetic-border--neon',
  border_fire: 'cosmetic-border--fire',
  border_ice: 'cosmetic-border--ice',
  border_emerald: 'cosmetic-border--emerald',
  border_purple: 'cosmetic-border--purple',
  border_ruby: 'cosmetic-border--ruby',
}
const EFFECT_MAP: Record<string, string> = {
  effect_glow: 'cosmetic-effect--glow',
  effect_sparkle: 'cosmetic-effect--sparkle',
  effect_shadow: 'cosmetic-effect--shadow',
  effect_pulse: 'cosmetic-effect--pulse',
  effect_red_hearts: 'cosmetic-effect--hearts-red',
  effect_black_hearts: 'cosmetic-effect--hearts-black',
  effect_fire_burst: 'cosmetic-effect--fire-burst',
  effect_sakura_petals: 'cosmetic-effect--sakura-petals',
  effect_gold_stars: 'cosmetic-effect--gold-stars',
  effect_rainbow_burst: 'cosmetic-effect--rainbow-burst',
}
function buildCosmeticClasses(border: string | null | undefined, effect: string | null | undefined): string {
  const classes: string[] = []
  if (border && BORDER_MAP[border]) classes.push(BORDER_MAP[border])
  if (effect && EFFECT_MAP[effect]) classes.push(EFFECT_MAP[effect])
  return classes.join(' ')
}

/* ── Preload UNO card images with priority + batch loading ──────────── */
const _unoImageFiles = import.meta.glob('/assets/uno_cards/**/*.png', { eager: true, import: 'default' }) as Record<string, string>
const _allUnoUrls = Object.values(_unoImageFiles)
const _unoLoadedUrls = new Set<string>()
let _unoPreloadStarted = false

const UNO_BATCH_SIZE = 12
const UNO_MAX_PARALLEL = 6
const IS_DEV = import.meta.env.DEV

// ── DEV timing helper ────────────────────────────────────────────
const _devT0 = IS_DEV ? performance.now() : 0
let _devTTFC_logged = false

function logTTFC() {
  if (!IS_DEV || _devTTFC_logged) return
  _devTTFC_logged = true
  console.log(`[uno:perf] TTFC (first gameState render): ${(performance.now() - _devT0).toFixed(0)}ms`)
}

function loadUnoImg(url: string): Promise<void> {
  if (_unoLoadedUrls.has(url)) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = img.onerror = () => { _unoLoadedUrls.add(url); resolve() }
    img.src = url
  })
}

async function loadUnoBatch(urls: string[]) {
  for (let i = 0; i < urls.length; i += UNO_MAX_PARALLEL) {
    await Promise.all(urls.slice(i, i + UNO_MAX_PARALLEL).map(loadUnoImg))
  }
}

function preloadUnoCards(): void {
  if (_unoPreloadStarted) return
  _unoPreloadStarted = true

  const t0 = IS_DEV ? performance.now() : 0

  // Load first batch (critical cards likely on table) immediately
  const first = _allUnoUrls.slice(0, 20)
  loadUnoBatch(first).then(() => {
    if (IS_DEV) console.log(`[uno:preload] TTFC 20 cards: ${(performance.now() - t0).toFixed(0)}ms`)
  })

  // Schedule remaining in idle batches
  const remaining = _allUnoUrls.slice(20)
  let idx = 0
  function next() {
    if (idx >= remaining.length) {
      if (IS_DEV) console.log(`[uno:preload] TTAC all ${_allUnoUrls.length} cards: ${(performance.now() - t0).toFixed(0)}ms`)
      return
    }
    const batch = remaining.slice(idx, idx + UNO_BATCH_SIZE)
    idx += UNO_BATCH_SIZE
    loadUnoBatch(batch).then(() => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(() => next())
      else setTimeout(next, 80)
    })
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => next())
  else setTimeout(next, 100)
}
preloadUnoCards()

type UnoFaceId =
  | `${UnoColor}_${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | `${UnoColor}_skip`
  | `${UnoColor}_reverse`
  | `${UnoColor}_draw2`
  | 'wild'
  | 'wild4'

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

function faceId(face: UnoCardFace): UnoFaceId {
  if (face.kind === 'wild') return 'wild'
  if (face.kind === 'wild4') return 'wild4'
  if (face.kind === 'number') return `${face.color}_${face.value}` as UnoFaceId
  return `${face.color}_${face.kind}` as UnoFaceId
}

function isWild(face: UnoCardFace) {
  return face.kind === 'wild' || face.kind === 'wild4'
}

function isPlayableCard(card: UnoCardFace, top: UnoCardFace | null, currentColor: UnoColor | null): boolean {
  if (isWild(card)) return true
  if (!top) return true
  if (!currentColor) return true
  if (card.kind !== 'wild' && card.kind !== 'wild4' && 'color' in card && card.color === currentColor) return true
  if (top.kind === 'number') {
    if (card.kind === 'number' && card.value === top.value) return true
  } else if (top.kind === 'skip' || top.kind === 'reverse' || top.kind === 'draw2') {
    if (card.kind === top.kind) return true
  }
  return false
}

function hasColor(hand: UnoCard[], color: UnoColor) {
  return hand.some(c => c.face.kind !== 'wild' && c.face.kind !== 'wild4' && 'color' in c.face && c.face.color === color)
}

function cardLabel(face: UnoCardFace) {
  if (face.kind === 'wild') return 'Wild'
  if (face.kind === 'wild4') return 'Wild Draw Four'
  const c = face.color[0].toUpperCase() + face.color.slice(1)
  if (face.kind === 'number') return `${c} ${face.value}`
  if (face.kind === 'draw2') return `${c} Draw Two`
  if (face.kind === 'reverse') return `${c} Reverse`
  return `${c} Skip`
}

function hashStr(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return h
}

function buildUnoImages(): Record<string, string[]> {
  const files = _unoImageFiles
  const out: Record<string, string[]> = {}

  const add = (id: UnoFaceId, path: string) => {
    if (!out[id]) out[id] = []
    out[id].push(path)
  }

  const parse = (nameRaw: string): UnoFaceId | null => {
    const name = nameRaw.replace(/\.png$/i, '').trim().replace(/\s+/g, ' ')

    const wild = /^Wild(?:-\d+)?$/i.test(name)
    if (wild) return 'wild'

    const draw4 = /^Draw4(?:-\d+)?$/i.test(name)
    if (draw4) return 'wild4'

    const mNum = /^(Red|Green|Blue|Yellow)\s*-\s*([0-9])$/i.exec(name)
    if (mNum) return `${mNum[1].toLowerCase()}_${parseInt(mNum[2], 10)}` as UnoFaceId

    const mDraw2 = /^(Red|Green|Blue|Yellow)\s+Draw2/i.exec(name)
    if (mDraw2) return `${mDraw2[1].toLowerCase()}_draw2` as UnoFaceId

    const mSkip = /^(Red|Green|Blue|Yellow)\s+Skip/i.exec(name)
    if (mSkip) return `${mSkip[1].toLowerCase()}_skip` as UnoFaceId

    const mRev = /^(Red|Green|Blue|Yellow)\s+Reverse/i.exec(name)
    if (mRev) return `${mRev[1].toLowerCase()}_reverse` as UnoFaceId

    const mRev2 = /^(Red|Green|Blue|Yellow)\s+Reverse\d+/i.exec(name)
    if (mRev2) return `${mRev2[1].toLowerCase()}_reverse` as UnoFaceId

    return null
  }

  for (const [path, mod] of Object.entries(files)) {
    const file = path.split('/').pop() || ''
    const id = parse(file)
    if (id) add(id, mod)
  }

  return out
}

function seatPos(i: number, n: number) {
  const t = n <= 1 ? 0 : i / n
  const ang = (t + 0.5) * Math.PI * 2
  const rx = 46
  const ry = 34
  const x = 50 + Math.cos(ang) * rx
  const y = 50 + Math.sin(ang) * ry
  return { left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' as const }
}

const UnoCardImg = memo(function UnoCardImg({ card, images, className, dimmed, glow, onClick }: {
  card: UnoCard
  images: Record<string, string[]>
  className?: string
  dimmed?: boolean
  glow?: boolean
  onClick?: () => void
}) {
  const fId = faceId(card.face)
  const variants = images[fId] || []
  const src = variants.length ? variants[Math.abs(hashStr(card.id)) % variants.length] : null

  return (
    <motion.button
      type="button"
      className={`uno-card ${className || ''} ${dimmed ? 'uno-card--dim' : ''} ${glow ? 'uno-card--glow' : ''}`}
      onClick={onClick}
      disabled={!onClick}
      title={cardLabel(card.face)}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: dimmed ? 0.45 : 1, scale: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      {src ? (
        <img src={src} alt={cardLabel(card.face)} decoding="async" loading="eager" />
      ) : (
        <div className="uno-card__fallback">
          {cardLabel(card.face)}
        </div>
      )}
    </motion.button>
  )
})

/** Card that "flies" from the deck to the player's hand on Draw.
 *  Shows the drawer the real card face; opponents see a card back (or nothing).
 *  Holds briefly at the destination if the server ACK hasn't arrived yet
 *  (covers Railway round-trips of ~100-400ms on a 680ms animation). */
const FlyingDrawCard = memo(function FlyingDrawCard({ deckRef, handRef, drawnCard, images, onComplete }: {
  deckRef: React.RefObject<HTMLDivElement | null>
  handRef: React.RefObject<HTMLDivElement | null>
  drawnCard: UnoCard | null
  images: Record<string, string[]>
  onComplete: () => void
}) {
  // Capture rects ONCE at mount — deck/hand don't move during the flight
  const fromRef = useRef<{ x: number; y: number; toX: number; toY: number } | null>(null)
  if (!fromRef.current) {
    const deckRect = deckRef.current!.getBoundingClientRect()
    const handRect = handRef.current!.getBoundingClientRect()
    fromRef.current = {
      x: deckRect.left + deckRect.width / 2 - 43,
      y: deckRect.top + deckRect.height / 2 - 62,
      toX: handRect.left + handRect.width / 2 - 43,
      toY: handRect.bottom - 130,
    }
  }
  const { x: fromX, y: fromY, toX, toY } = fromRef.current

  // Keep a stable ref to onComplete so effects don't need it as a dep
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  // motionDone: true once Framer Motion finishes the fly animation
  const [motionDone, setMotionDone] = useState(false)
  // holdTimerRef: timeout that fires onComplete when waiting for ACK
  const holdTimerRef = useRef<number | null>(null)

  // After motion completes: if card already known → brief reveal then done;
  // otherwise hold up to 650ms for the ACK, then done regardless.
  useEffect(() => {
    if (!motionDone) return
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
    if (drawnCard) {
      holdTimerRef.current = window.setTimeout(() => onCompleteRef.current(), 320)
    } else {
      holdTimerRef.current = window.setTimeout(() => onCompleteRef.current(), 650)
    }
    return () => { if (holdTimerRef.current) clearTimeout(holdTimerRef.current) }
  }, [motionDone]) // eslint-disable-line react-hooks/exhaustive-deps

  // If ACK arrives WHILE we're holding (motionDone but waiting), cancel the
  // long-wait timer and replace with a short reveal timer instead.
  useEffect(() => {
    if (!motionDone || !drawnCard) return
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
    holdTimerRef.current = window.setTimeout(() => onCompleteRef.current(), 320)
    return () => { if (holdTimerRef.current) clearTimeout(holdTimerRef.current) }
  }, [drawnCard, motionDone])

  // Resolve card image when we know the drawn card
  const cardSrc = drawnCard ? (() => {
    const fId = faceId(drawnCard.face)
    const variants = images[fId] || []
    return variants.length ? variants[Math.abs(hashStr(drawnCard.id)) % variants.length] : null
  })() : null

  return (
    <motion.div
      className="uno-flying-card"
      initial={{ x: fromX, y: fromY, scale: 1.12, opacity: 1, rotate: -8 }}
      animate={{ x: toX, y: toY, scale: 0.88, opacity: 0.9, rotate: 0 }}
      transition={{ duration: 0.68, ease: [0.22, 0.68, 0.35, 1] }}
      onAnimationComplete={() => setMotionDone(true)}
    >
      {/* Deck-style card back — fades out when real card face is revealed */}
      <motion.div
        className="uno-draw-back"
        animate={{ opacity: cardSrc ? 0 : 1 }}
        transition={{ duration: 0.14 }}
      />
      {/* Real card face (drawer only) — fades in once ACK delivers drawnCard */}
      {cardSrc && (
        <motion.img
          src={cardSrc}
          alt=""
          draggable={false}
          className="uno-draw-face"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.16 }}
        />
      )}
    </motion.div>
  )
})

/** Brief card-back flash at the deck for opponents (via uno:drawFx event).
 *  Drawer never sees this — they have their own FlyingDrawCard. */
const OppDrawFlash = memo(function OppDrawFlash({ deckRef, onComplete }: {
  deckRef: React.RefObject<HTMLDivElement | null>
  onComplete: () => void
}) {
  const rect = deckRef.current?.getBoundingClientRect()
  if (!rect) return null
  const x = rect.left + rect.width / 2 - 43
  const y = rect.top + rect.height / 2 - 62
  return (
    <motion.div
      className="uno-flying-card"
      initial={{ x, y, scale: 0.7, opacity: 0, rotate: 0 }}
      animate={{ x, y: y - 28, scale: 1.1, opacity: 1, rotate: -6 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      onAnimationComplete={onComplete}
    >
      <div className="uno-draw-back" />
    </motion.div>
  )
})

/** Card that "flies" from the hand to the discard pile */
const FlyingCard = memo(function FlyingCard({ card, images, fromRect, discardRef, onComplete }: {
  card: UnoCard
  images: Record<string, string[]>
  fromRect: DOMRect
  discardRef: React.RefObject<HTMLDivElement | null>
  onComplete: () => void
}) {
  const fId = faceId(card.face)
  const variants = images[fId] || []
  const src = variants.length ? variants[Math.abs(hashStr(card.id)) % variants.length] : null
  const targetRect = discardRef.current?.getBoundingClientRect()
  const toX = targetRect ? targetRect.left + targetRect.width / 2 - 43 : window.innerWidth / 2 - 43
  const toY = targetRect ? targetRect.top + targetRect.height / 2 - 62 : window.innerHeight * 0.38
  return (
    <motion.div
      className="uno-flying-card"
      initial={{ x: fromRect.left + fromRect.width / 2 - 43, y: fromRect.top + fromRect.height / 2 - 62, scale: 1.12, rotate: 0, opacity: 1 }}
      animate={{ x: toX, y: toY, scale: 1, rotate: (Math.random() - 0.5) * 14, opacity: 1 }}
      transition={{ duration: 0.34, ease: [0.22, 0.68, 0.35, 1] }}
      onAnimationComplete={onComplete}
    >
      {src ? <img src={src} alt="" draggable={false} /> : <div className="uno-card__fallback">{cardLabel(card.face)}</div>}
    </motion.div>
  )
})

// Suppress unused-var lint for clamp (used by other utilities)
void clamp

function Uno() {
  const [searchParams] = useSearchParams()
  const lobbyCode = (searchParams.get('lobby') || '').toUpperCase()
  const { isLoggedIn, user, loading: authLoading } = useAuth()

  const userIdRef = useRef<string | null>(null)

  const [connected, setConnected] = useState(false)
  const [state, setState] = useState<UnoClientState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [colorModalOpen, setColorModalOpen] = useState(false)
  const [pendingWildCardId, setPendingWildCardId] = useState<string | null>(null)

  // ── Celebration (server-driven; visible to everyone) ───────────
  const [celebration, setCelebration] = useState<null | { id: string; effectId: 'stars' | 'red_hearts' | 'black_hearts' | 'fire_burst' | 'sakura_petals' | 'gold_stars' | 'rainbow_burst' }>(null)
  const celebrationTimerRef = useRef<number | null>(null)

  // ── Flying card animation state ─────────────────────────────────
  const [flyingCard, setFlyingCard] = useState<{ card: UnoCard; fromRect: DOMRect } | null>(null)
  const [showImpact, setShowImpact] = useState(false)
  const discardRef = useRef<HTMLDivElement>(null)

  const images = useMemo(() => buildUnoImages(), [])

  // ── Version tracking for synchronization ──────────────────────
  const lastVersionRef = useRef<number>(0)
  const resyncingRef = useRef(false)

  // ── Action in-flight lock ──────────────────────────────────────
  // Prevents multiple concurrent playerAction emits (avoids spam + duplicate timeouts).
  const actionPendingRef = useRef(false)
  const [actionPending, setActionPending] = useState(false)

  // ── SFX: previous state ref for diff-based sound triggers ─────
  const prevStateRef = useRef<UnoClientState | null>(null)

  // ── RAF coalesced state updates ────────────────────────────────
  // Stores the latest incoming state; a single RAF per frame applies it.
  // This prevents React render-backlog when the server emits states rapidly.
  const latestStateRef = useRef<UnoClientState | null>(null)
  const rafScheduledRef = useRef(false)

  // ── DEV: measure time from state-receive to RAF (render) ───────
  const devReceiveTimeRef = useRef<number>(0)

  // ── Pending play card (optimistic visual removal from hand) ────
  // Set on card click; card is filtered from visibleHand immediately.
  // Cleared when server confirms (card gone from hand) or on ACK failure.
  const [pendingPlayCardId, setPendingPlayCardId] = useState<string | null>(null)

  // Saved rect for wild card flying animation (captured before modal opens)
  const pendingWildFromRectRef = useRef<DOMRect | null>(null)

  // ── Draw animation ─────────────────────────────────────────────
  // drawnCard is null while in-flight (card back shown), set to the real
  // card once the state update / ACK reveals it.
  const [drawFlying, setDrawFlying] = useState<{ drawnCard: UnoCard | null } | null>(null)
  // Snapshot of hand IDs captured before the draw action is sent.
  // Used to diff state updates and find the newly drawn card.
  const pendingDrawSnapRef = useRef<Set<string> | null>(null)
  // Opponent draw flash: shown when another player draws (uno:drawFx event)
  const [oppDrawFlash, setOppDrawFlash] = useState<{ id: string } | null>(null)
  const deckRef = useRef<HTMLDivElement>(null)
  const handRef = useRef<HTMLDivElement>(null)

  /**
   * Apply a new UNO game state only if its version is newer than what we have.
   * If a version gap is detected, request a full resync.
   */
  const applyState = useCallback((incoming: UnoClientState) => {
    const incomingVersion = incoming.version ?? 0
    const lastVersion = lastVersionRef.current

    // Ignore strictly-older states.
    // Use strict less-than (<) so same-version re-broadcasts (e.g. from the
    // server bumping then immediately re-broadcasting after a reconnect) are
    // still applied.  This prevents the "players don't appear" bug where a
    // transient version revert on the server caused all subsequent same-version
    // broadcasts to be silently dropped by every connected client.
    if (incomingVersion > 0 && lastVersion > 0 && incomingVersion < lastVersion) {
      if (IS_DEV) console.log(`[uno:sync] Ignored stale state v${incomingVersion} < v${lastVersion}`)
      return
    }

    // Detect version gap → request full resync
    if (incomingVersion > lastVersion + 1 && lastVersion > 0 && !resyncingRef.current) {
      if (IS_DEV) console.warn(`[uno:sync] Version gap detected: v${lastVersion} → v${incomingVersion}, requesting resync`)
      resyncingRef.current = true
      unoSocket.requestFullState(incoming.lobbyCode).then(res => {
        resyncingRef.current = false
        if (res.success && res.gameState) {
          lastVersionRef.current = res.gameState.version ?? 0
          setState(res.gameState)
        }
      }).catch(() => { resyncingRef.current = false })
      // Still apply this state as a fallback
    }

    lastVersionRef.current = incomingVersion
    logTTFC()

    // ── Coalesce: only commit the latest state per animation frame ──────
    // If multiple states arrive in the same frame (e.g. rapid server emits),
    // we only call setState once with the freshest payload, preventing a
    // React render backlog that shows as "client delay" even when the
    // server has already moved on.
    latestStateRef.current = incoming
    if (IS_DEV) devReceiveTimeRef.current = performance.now()

    if (!rafScheduledRef.current) {
      rafScheduledRef.current = true
      requestAnimationFrame(() => {
        rafScheduledRef.current = false
        const s = latestStateRef.current
        if (s) {
          latestStateRef.current = null
          if (IS_DEV && devReceiveTimeRef.current > 0) {
            const delay = performance.now() - devReceiveTimeRef.current
            if (delay > 200) console.warn(`[uno:perf] Render delay: ${delay.toFixed(0)}ms (state→RAF)`)
          }
          setState(s)
        }
      })
    }
  }, [])

  // Keep a stable ref to user id
  useEffect(() => {
    if (user?.id) userIdRef.current = user.id
  }, [user?.id])

  const uid = user?.id ?? ''
  const isHost = state?.hostId === uid
  const isPublic = !!state?.isPublic
  const me = state?.players.find(p => p.playerId === uid) || null
  const isSpectator = !!state?.isSpectator
  const spectatorCount = state?.spectators?.length ?? 0
  const myHand = state?.hands?.[uid] || []
  const topCard = state?.discardPile?.length ? state.discardPile[state.discardPile.length - 1] : null

  const currentPlayer = state && state.players[state.currentPlayerIndex]
  const isMyTurn = !!state && state.phase === 'playing' && currentPlayer?.playerId === uid
  const drawnPlayable = state?.drawnPlayable?.playerId === uid ? state.drawnPlayable : null

  const playable = useMemo(() => {
    if (!state) return new Set<string>()
    const set = new Set<string>()
    const top = topCard?.face || null
    for (const c of myHand) {
      const ok = isPlayableCard(c.face, top, state.currentColor)
      if (!ok) continue
      if (c.face.kind === 'wild4' && state.currentColor && hasColor(myHand, state.currentColor)) continue
      if (drawnPlayable && c.id !== drawnPlayable.cardId) continue
      set.add(c.id)
    }
    return set
  }, [state, myHand, topCard, drawnPlayable])

  const hasAnyPlayable = playable.size > 0

  // ── Visible hand: omit the pending-play card immediately on click ──────────
  // This is purely visual — the card disappears from hand the instant the
  // player clicks it, before the server round-trip completes.
  const visibleHand = useMemo(
    () => (pendingPlayCardId ? myHand.filter(c => c.id !== pendingPlayCardId) : myHand),
    [myHand, pendingPlayCardId],
  )

  // Clear pendingPlayCardId once server confirms the card left the hand
  useEffect(() => {
    if (!pendingPlayCardId || !state) return
    const hand = state.hands?.[uid] || []
    if (!hand.some(c => c.id === pendingPlayCardId)) {
      setPendingPlayCardId(null)
    }
  }, [state, pendingPlayCardId, uid])

  // ── Drawn card detection (state-broadcast path) ─────────────────────────
  // When the server state arrives after a draw action, diff the hand against
  // the pre-draw snapshot to find the newly drawn card and reveal its face.
  // This is more reliable than relying solely on the ACK payload structure.
  useEffect(() => {
    if (!drawFlying || drawFlying.drawnCard !== null || !pendingDrawSnapRef.current) return
    const snap = pendingDrawSnapRef.current
    // state.hands[uid] contains REAL cards for the local player (server-personalised)
    const hand: UnoCard[] = state?.hands?.[uid] ?? state?.hands?.[String(uid)] ?? []
    const newCard = hand.find(c => !snap.has(c.id))
    if (!newCard) return
    pendingDrawSnapRef.current = null
    setDrawFlying(prev => prev !== null ? { drawnCard: newCard } : null)
  }, [state, drawFlying, uid])

  // ── SFX: state-diff effect — fires sounds based on game state transitions ──
  useEffect(() => {
    if (!state) {
      prevStateRef.current = null
      return
    }

    const prev = prevStateRef.current
    prevStateRef.current = state

    // Skip sounds for the very first state load (no diff to compare)
    if (!prev) return

    // ── Phase: lobby → playing (game starts) ───────────────────────────
    if (prev.phase !== 'playing' && state.phase === 'playing') {
      sfx.play('game_start', { cooldownMs: 3000 })
      // Stagger deal sounds to mimic cards being distributed
      setTimeout(() => sfx.play('deal', { cooldownMs: 0 }), 250)
      setTimeout(() => sfx.play('deal', { cooldownMs: 0 }), 500)
      return
    }

    // ── Phase: playing → finished (game over) ──────────────────────────
    if (prev.phase === 'playing' && state.phase === 'finished') {
      if (state.winnerId === uid) {
        sfx.play('win', { cooldownMs: 3000 })
      } else {
        sfx.play('game_end', { cooldownMs: 3000 })
      }
      return
    }

    if (state.phase !== 'playing') return

    // ── Turn change: now my turn ───────────────────────────────────────
    const prevTurnId = prev.players[prev.currentPlayerIndex]?.playerId
    const currTurnId = state.players[state.currentPlayerIndex]?.playerId
    if (prevTurnId !== currTurnId && currTurnId === uid) {
      sfx.play('card_select', { cooldownMs: 500 })
    }

    // ── Top card changed → a card was played ──────────────────────────
    const prevTop = prev.discardPile?.[prev.discardPile.length - 1]
    const currTop = state.discardPile?.[state.discardPile.length - 1]

    if (currTop && prevTop?.id !== currTop.id) {
      // prevTurnId is who just played; only play sounds here for OTHER players.
      // When the local player plays, sounds are triggered in onCardClick directly.
      if (prevTurnId && prevTurnId !== uid) {
        switch (currTop.face.kind) {
          case 'reverse':
            sfx.play('card_reverse', { cooldownMs: 300 })
            break
          case 'skip':
            sfx.play('card_skip', { cooldownMs: 300 })
            break
          case 'draw2':
          case 'wild4':
            sfx.play('card_punish', { cooldownMs: 300 })
            break
          case 'wild':
            sfx.play('wild_card', { cooldownMs: 300 })
            break
          default:
            sfx.play('card_play_other', { cooldownMs: 200 })
        }
      }
    }

    // ── UNO prompt appeared ────────────────────────────────────────────
    // (no dedicated "uno call" sound file, so we reuse card_select as an attention ping)
    if (!prev.unoPrompt?.active && state.unoPrompt?.active) {
      sfx.play('card_select', { cooldownMs: 1000 })
    }
  }, [state, uid])

  useEffect(() => {
    if (!isLoggedIn || !user) return
    if (!lobbyCode) {
      setError('No lobby code provided')
      return
    }

    let stopped = false

    const join = async () => {
      const result = await unoSocket.joinLobby(lobbyCode)
      if (stopped) return
      if (result.success && result.gameState) {
        lastVersionRef.current = result.gameState.version ?? 0
        setState(result.gameState)
        logTTFC()
        setError(null)
      } else {
        setError(result.error || 'Failed to join lobby')
      }
    }

    const connectAndJoin = async () => {
      try {
        await unoSocket.connect()
        if (stopped) return
        setConnected(true)
        await join()
      } catch (err) {
        if (!stopped) setError('Failed to connect to server')
        console.error(err)
      }
    }

    connectAndJoin()

    const unsubscribeState = unoSocket.on('gameState', (data) => {
      const next = data as UnoClientState
      if (!next || next.gameType !== 'uno') return
      applyState(next)
    })

    const unsubscribeRoster = unoSocket.on('uno:roster', (payload) => {
      const p = payload as any
      setState(prev => {
        if (!prev) return prev
        if (prev.phase !== 'lobby') return prev
        const v = Number(p?.version ?? prev.version)
        const players = Array.isArray(p?.players) ? p.players : prev.players
        return { ...prev, players, version: Math.max(prev.version ?? 0, v) }
      })
    })

    const unsubscribeCelebration = unoSocket.on('game:celebration', (payload) => {
      const p = payload as any
      const id = String(p?.id || '')
      const effectId = (p?.effectId || 'stars') as 'stars' | 'red_hearts' | 'black_hearts' | 'fire_burst' | 'sakura_petals' | 'gold_stars' | 'rainbow_burst'
      if (!id) return
      if (IS_DEV) console.log(`[uno:celebration] id=${id} effect=${effectId}`)
      setCelebration({ id, effectId })
      if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current)
      celebrationTimerRef.current = window.setTimeout(() => setCelebration(null), 4000)
    })

    const unsubscribeEnd = unoSocket.on('lobbyEnded', () => {
      setError('Lobby has been closed by the host')
    })

    const unsubscribeConnect = unoSocket.on('connect', () => {
      if (!stopped && lobbyCode) join().catch(err => {
        if (!stopped) console.warn('[uno:reconnect] join failed:', err?.message || err)
      })
    })

    // Opponent draw animation: another player drew a card (no card face)
    const unsubscribeDrawFx = unoSocket.on('uno:drawFx', (payload) => {
      const p = payload as { playerId?: string | number }
      if (!p?.playerId) return
      // Only show flash for OTHER players; drawer already has FlyingDrawCard
      if (String(p.playerId) === String(userIdRef.current)) return
      setOppDrawFlash({ id: `drawfx_${p.playerId}_${Date.now()}` })
    })

    return () => {
      stopped = true
      unsubscribeState()
      unsubscribeRoster()
      unsubscribeCelebration()
      unsubscribeEnd()
      unsubscribeConnect()
      unsubscribeDrawFx()
      if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current)
    }
  }, [lobbyCode, isLoggedIn, user?.id, applyState])

  const sendAction = useCallback(async (
    action: { type: 'play'; cardId: string; chosenColor?: UnoColor } | { type: 'draw' } | { type: 'pass' },
    { onFailure, onAck }: { onFailure?: () => void; onAck?: (result: any) => void } = {},
  ) => {
    // In-flight guard: ignore if another action is already pending.
    if (!state || actionPendingRef.current) return
    actionPendingRef.current = true
    setActionPending(true)
    const lobbyCodeSnapshot = state.lobbyCode
    try {
      const result = await unoSocket.sendAction(lobbyCodeSnapshot, action)
      if (!result.success) {
        onFailure?.()
        setError(result.error || result.reason || 'Action failed')
        setTimeout(() => setError(null), 3000)
      } else {
        onAck?.(result)
      }
    } catch (e: any) {
      // Timeout / network drop — restore any optimistic UI, show toast, resync.
      onFailure?.()
      if (IS_DEV) console.warn('[uno:sendAction] timeout/error:', e?.message)
      setError('Connection issue - resyncing...')
      setTimeout(() => setError(null), 4000)
      unoSocket.requestState(lobbyCodeSnapshot).then(res => {
        if (res.success && res.gameState) {
          lastVersionRef.current = res.gameState.version ?? 0
          setState(res.gameState)
        }
      }).catch(() => { /* ignore secondary failure */ })
    } finally {
      actionPendingRef.current = false
      setActionPending(false)
    }
  }, [state])

  const handleStartGame = useCallback(async () => {
    if (!state) return
    const result = await unoSocket.startGame(state.lobbyCode)
    if (!result.success) {
      setError(result.error || result.reason || 'Failed to start game')
      setTimeout(() => setError(null), 3000)
    }
  }, [state])

  const handleEndLobby = useCallback(async () => {
    if (!state) return
    const result = await unoSocket.endLobby(state.lobbyCode)
    if (result.success) {
      window.close()
    } else {
      setError(result.error || result.reason || 'Failed to end lobby')
      setTimeout(() => setError(null), 3000)
    }
  }, [state])

  const handleLeaveLobby = useCallback(async () => {
    if (!state) {
      window.location.href = '/main-menu'
      return
    }
    try { await unoSocket.leaveLobby(state.lobbyCode) } catch { /* ignore */ }
    window.location.href = '/main-menu'
  }, [state])

  const onCardClick = (c: UnoCard) => {
    if (!isMyTurn) return
    if (!playable.has(c.id)) return
    // Don't queue another action while one is already in-flight.
    if (actionPendingRef.current) return

    // ── Wild cards: save rect, hide card immediately, open colour picker ───
    if (c.face.kind === 'wild' || c.face.kind === 'wild4') {
      sfx.play(c.face.kind === 'wild' ? 'wild_card' : 'card_punish')
      // Capture position BEFORE the card disappears from the DOM
      const cardEl = document.querySelector(`[data-card-id="${c.id}"]`)
      pendingWildFromRectRef.current = cardEl?.getBoundingClientRect() ?? null
      // Optimistic removal from hand — instantly hides the card
      setPendingPlayCardId(c.id)
      setPendingWildCardId(c.id)
      setColorModalOpen(true)
      return
    }

    // ── Special action cards ───────────────────────────────────────
    if (c.face.kind === 'reverse') {
      sfx.play('card_reverse')
    } else if (c.face.kind === 'skip') {
      sfx.play('card_skip')
    } else if (c.face.kind === 'draw2') {
      sfx.play('card_punish')
    } else {
      // Normal numbered card
      sfx.play('card_play_self')
    }

    // Capture card position for flying animation BEFORE removing from DOM
    const cardEl = document.querySelector(`[data-card-id="${c.id}"]`)
    const fromRect = cardEl?.getBoundingClientRect()

    // Optimistic removal: card disappears from hand immediately
    setPendingPlayCardId(c.id)
    if (fromRect) setFlyingCard({ card: c, fromRect })

    sendAction({ type: 'play', cardId: c.id }, {
      // On failure: restore card in hand
      onFailure: () => setPendingPlayCardId(null),
    })
  }

  const chooseWildColor = (color: UnoColor) => {
    if (!pendingWildCardId) return
    const cardId = pendingWildCardId
    const fromRect = pendingWildFromRectRef.current

    // Start flying animation if we have a saved position
    if (fromRect) {
      const card = myHand.find(c => c.id === cardId)
      if (card) setFlyingCard({ card, fromRect })
    }
    pendingWildFromRectRef.current = null

    sendAction({ type: 'play', cardId, chosenColor: color }, {
      // On failure: restore card in hand
      onFailure: () => setPendingPlayCardId(null),
    })
    setPendingWildCardId(null)
    setColorModalOpen(false)
  }

  // Auth loading
  if (authLoading) {
    return (
      <div className="uno-page uno-page--standalone">
        <div className="poker-loading">
          <div className="spinner" />
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  // Auth gate
  if (!isLoggedIn) {
    return (
      <div className="uno-page uno-page--standalone">
        <div className="poker-auth-gate">
          <h2>Login Required</h2>
          <p>You must be logged in to join UNO lobbies.</p>
          <a href="/profile" className="btn-primary" style={{ textDecoration: 'none' }}>
            Go to Profile to Login
          </a>
        </div>
      </div>
    )
  }

  if (error && !state) {
    return (
      <div className="uno-page uno-page--standalone">
        <div className="poker-error">
          <h2>Error</h2>
          <p>{error}</p>
          <button className="btn-primary" onClick={() => window.close()}>Close</button>
        </div>
      </div>
    )
  }

  if (!connected || !state) {
    return (
      <div className="uno-page uno-page--standalone">
        <div className="poker-loading">
          <div className="spinner" />
          <p>Connecting to lobby...</p>
        </div>
      </div>
    )
  }

  const phaseLabel = state.phase === 'lobby' ? 'LOBBY' : state.phase === 'playing' ? 'PLAYING' : 'FINISHED'
  const dirLabel = state.direction === 1 ? 'CW' : 'CCW'
  const colorLabel = state.currentColor ? state.currentColor.toUpperCase() : '-'
  const winner = state.winnerId ? state.players.find(p => p.playerId === state.winnerId) : null

  return (
    <div className="uno-page uno-page--standalone">
      {error && (
        <div className="poker-toast poker-toast--error">
          {error}
        </div>
      )}

      <div className="uno-header">
        <div className="uno-header__info">
          <span className="uno-header__code">Lobby: {state.lobbyCode}</span>
          <span className="uno-header__phase">{phaseLabel}</span>
          <span className="uno-header__meta">Color: {colorLabel}</span>
          <span className="uno-header__meta">Direction: {dirLabel}</span>
          {spectatorCount > 0 && <span className="uno-header__meta">👁 {spectatorCount} spectating</span>}
          {isSpectator && <span className="uno-header__spectator-badge">Spectating</span>}
        </div>

        <div className="uno-header__controls">
          {/* ── Sound controls ─────────────────────────────────── */}
          <SfxControls />

          <button className="btn-secondary" onClick={handleLeaveLobby} style={{ width: 'auto', padding: '8px 16px' }}>
            Leave Lobby
          </button>
          {isHost && (
            <>
            {state.phase !== 'playing' && (
              <button className="btn-primary" onClick={handleStartGame} style={{ width: 'auto', padding: '8px 16px' }}>
                Start Game
              </button>
            )}
            {isHost && !isPublic && (
              <button className="btn-secondary" onClick={handleEndLobby} style={{ width: 'auto', padding: '8px 16px' }}>
                End Lobby
              </button>
            )}
            </>
          )}
        </div>
        {!isHost && isPublic && state.phase !== 'playing' && (
          <div className="uno-header__controls">
            <button className="btn-primary" onClick={handleStartGame} style={{ width: 'auto', padding: '8px 16px' }}>
              Start Game
            </button>
          </div>
        )}
      </div>

      <div className="uno-main">
        <div className="uno-table-wrapper">
          <div className="uno-table">
            <div className="uno-table__felt">
              <div className="uno-table__logo">
                <img src={tableLogo} alt="Bulk Games" />
              </div>

              <WinCelebration show={!!celebration} effectId={celebration?.effectId || 'stars'} />

              <div className="uno-center">
                <div className="uno-deck" ref={deckRef} aria-label="Draw deck">
                  <div className="uno-deck__stack" />
                  <div className="uno-deck__count">{state.drawPileCount}</div>
                </div>

                <div className="uno-discard" ref={discardRef} aria-label="Discard pile">
                  {topCard ? (
                    <UnoCardImg
                      key={topCard.id}
                      card={topCard}
                      images={images}
                      className="uno-discard__card"
                    />
                  ) : (
                    <div className="uno-discard__empty" />
                  )}
                  {showImpact && (
                    <motion.div
                      className="uno-discard__impact"
                      initial={{ scale: 0.6, opacity: 0.7 }}
                      animate={{ scale: 1.5, opacity: 0 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="uno-table__seats">
              {state.players.map((p, idx) => {
                const isTurn = state.phase === 'playing' && idx === state.currentPlayerIndex
                const isMe = p.playerId === uid
                const isWinner = state.phase === 'finished' && state.winnerId === p.playerId
                const uno = state.phase === 'playing' && p.cardCount === 1 && state.mustCallUno !== p.playerId
                const style = seatPos(idx, state.players.length)

                return (
                  <div
                    key={p.playerId}
                    className={`uno-seat ${isTurn ? 'uno-seat--active' : ''} ${isMe ? 'uno-seat--me' : ''} ${isWinner ? 'uno-seat--winner' : ''} ${!p.isConnected ? 'uno-seat--disconnected' : ''} ${buildCosmeticClasses(p.equippedBorder, p.equippedEffect)}`}
                    style={style}
                  >
                    <div className="uno-seat__avatar">
                      {p.avatarUrl ? <img src={p.avatarUrl} alt={p.nickname} /> : <span>👤</span>}
                    </div>
                    <div className="uno-seat__info">
                      <span className="uno-seat__name">{p.nickname}</span>
                      <span className="uno-seat__count">{p.cardCount} cards</span>
                    </div>
                    {uno && <div className="uno-seat__uno">UNO!</div>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="uno-log">
          <div className="uno-log__title">Action Log</div>
          <div className="uno-log__entries">
            {state.actionLog.slice().reverse().map((e) => (
              <div key={e.id} className="uno-log__entry">
                <span className="uno-log__text">{e.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {state.phase === 'lobby' && (
        <div className="uno-waiting">
          <h3>Waiting for game to start...</h3>
          <p>{state.players.length} player{state.players.length !== 1 ? 's' : ''} in lobby</p>
          <div className="uno-waiting__players">
            {state.players.map(p => (
              <div key={p.playerId} className="uno-waiting__player">
                <div className="uno-waiting__avatar">
                  {p.avatarUrl ? <img src={p.avatarUrl} alt={p.nickname} /> : '👤'}
                </div>
                <span>{p.nickname}</span>
                {p.playerId === state.hostId && <span className="uno-waiting__host">Host</span>}
              </div>
            ))}
          </div>
          {!isHost && <p className="muted">Waiting for host to start the game...</p>}
        </div>
      )}

      {state.phase === 'playing' && (
        <div className="uno-bottom-bar">
          {isSpectator ? (
            <div className="uno-actions">
              <div className="uno-actions__status">
                {state.phase === 'lobby' && (
                  <>
                    <span className="uno-actions__turn">👁 Spectating</span>
                    <span className="muted">Waiting for the game to start...</span>
                  </>
                )}
                {state.phase === 'playing' && (
                  <>
                    <span className="uno-actions__turn">👁 Spectating</span>
                    <span className="muted">{currentPlayer?.nickname || 'Player'}'s turn</span>
                  </>
                )}
                {state.phase === 'finished' && (() => {
                  const winner = state.players.find(p => p.playerId === state.winnerId)
                  return (
                    <>
                      <span className="uno-actions__turn">🏆 {winner?.nickname || 'Someone'} won!</span>
                      <span className="muted">Waiting for the next round...</span>
                    </>
                  )
                })()}
              </div>
              <div className="uno-actions__buttons">
                <button className="btn-secondary uno-actions__btn" onClick={() => (window.location.href = '/main-menu')}>
                  Back to Main Menu
                </button>
              </div>
            </div>
          ) : (
          <div className="uno-actions">
            <div className="uno-actions__status">
              {isMyTurn ? (
                <>
                  <span className="uno-actions__turn">Your turn</span>
                  {drawnPlayable ? (
                    <span className="muted">You drew a playable card - play it or pass</span>
                  ) : hasAnyPlayable ? (
                    <span className="muted">Play a card</span>
                  ) : (
                    <span className="muted">No playable cards - draw 1</span>
                  )}
                </>
              ) : (
                <>
                  <span className="uno-actions__turn">
                    {state.phase === 'playing' ? `${currentPlayer?.nickname || 'Player'}'s turn` : 'Waiting...'}
                  </span>
                  {me && <span className="muted">You have {myHand.length} cards</span>}
                </>
              )}
            </div>

            <div className="uno-actions__buttons">
              {isMyTurn && !drawnPlayable && (
                <button
                  className="btn-primary uno-actions__btn"
                  onClick={() => {
                    // Guard: don't start if sendAction will bail out early
                    if (!state || actionPendingRef.current) return
                    sfx.play('draw')
                    // Snapshot current hand IDs for both state-based and ACK-based detection
                    const snap = new Set(myHand.map((c: UnoCard) => c.id))
                    pendingDrawSnapRef.current = snap
                    // Start the flying animation immediately — don't wait for server
                    setDrawFlying({ drawnCard: null })
                    sendAction({ type: 'draw' }, {
                      onFailure: () => {
                        setDrawFlying(null)
                        pendingDrawSnapRef.current = null
                      },
                      // ACK fast-path: server returns updated gameState in the ACK
                      // before the broadcast arrives, so we can reveal the card sooner.
                      onAck: (result) => {
                        if (!result?.gameState || !pendingDrawSnapRef.current) return
                        const myPid = state.myPlayerId
                        const newHand: UnoCard[] =
                          result.gameState.hands?.[myPid] ??
                          result.gameState.hands?.[String(myPid)] ??
                          []
                        const newCard = newHand.find(
                          (c: UnoCard) => !snap.has(c.id),
                        )
                        if (newCard) {
                          pendingDrawSnapRef.current = null
                          setDrawFlying(prev => prev !== null ? { drawnCard: newCard } : null)
                        }
                        // If not found here, the state-broadcast useEffect will catch it
                      },
                    })
                  }}
                  disabled={hasAnyPlayable || actionPending}
                >
                  {actionPending ? '...' : 'Draw'}
                </button>
              )}
              {isMyTurn && drawnPlayable && (
                <button
                  className="btn-secondary uno-actions__btn"
                  onClick={() => {
                    sfx.play('card_select')
                    sendAction({ type: 'pass' })
                  }}
                  disabled={actionPending}
                >
                  {actionPending ? '...' : 'Pass'}
                </button>
              )}
              {/* UNO/Catch buttons removed — now handled via server-driven UNO prompt modal */}
              <button className="btn-secondary uno-actions__btn" onClick={() => (window.location.href = '/main-menu')}>
                Back to Main Menu
              </button>
            </div>
          </div>
          )}

          {!isSpectator && <div className="uno-hand" ref={handRef} aria-label="Your hand">
            <div className="uno-hand__fan">
              {visibleHand.map((c, i) => {
                const n = visibleHand.length
                const gap = n <= 5 ? 44 : n <= 9 ? 34 : 26
                const rotStep = n <= 5 ? 7 : n <= 9 ? 4.5 : 3
                const center = (n - 1) / 2
                const offset = i - center
                const rot = offset * rotStep
                const xVal = offset * gap
                const yVal = Math.abs(offset) * 2.5
                const canClick = isMyTurn && playable.has(c.id)
                const dim = isMyTurn && !playable.has(c.id)
                return (
                  <motion.div
                    key={c.id}
                    className="uno-hand__card"
                    data-card-id={c.id}
                    style={{ x: xVal, rotate: rot, transformOrigin: 'center bottom' }}
                    animate={{ y: yVal, zIndex: 1, scale: 1 }}
                    whileHover={canClick ? { y: yVal - 26, scale: 1.15, zIndex: 50 } : undefined}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                  >
                    <UnoCardImg
                      card={c}
                      images={images}
                      glow={canClick}
                      dimmed={dim}
                      onClick={canClick ? () => onCardClick(c) : undefined}
                    />
                  </motion.div>
                )
              })}
            </div>
          </div>}
        </div>
      )}

      {state.phase === 'finished' && (
        <div className="uno-end-overlay">
          <div className="uno-end-card">
            <h2>Game Over</h2>
            <p className="muted">{winner ? `${winner.nickname} wins!` : 'Winner decided.'}</p>
            <div className="uno-end-actions">
              {(isHost || isPublic) && (
                <button className="btn-primary" onClick={handleStartGame}>
                  Start Next Game
                </button>
              )}
              <button className="btn-secondary" onClick={() => (window.location.href = '/main-menu')}>
                Back to Main Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── UNO Prompt Modal (fair: server-driven button position) ── */}
      <Modal
        isOpen={!!state.unoPrompt?.active}
        onClose={() => {}}
        title="UNO!"
      >
        {state.unoPrompt && (() => {
          const target = state.players.find(p => p.playerId === state.unoPrompt!.targetPlayerId);
          const iAmTarget = state.unoPrompt!.targetPlayerId === uid;
          return (
            <div className="uno-prompt">
              <p className="uno-prompt__info">
                <strong>{target?.nickname || 'Player'}</strong> has 1 card left!
              </p>
              <div className="uno-prompt__arena">
                <button
                  className={`btn-primary uno-prompt__btn ${iAmTarget ? 'uno-prompt__btn--call' : 'uno-prompt__btn--catch'}`}
                  style={{
                    position: 'absolute',
                    left: `${state.unoPrompt!.buttonPos.x}%`,
                    top: `${state.unoPrompt!.buttonPos.y}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  onClick={() => {
                    sfx.play('card_select')
                    if (iAmTarget) {
                      unoSocket.callUno(state.lobbyCode);
                    } else {
                      unoSocket.catchUno(state.lobbyCode);
                    }
                  }}
                >
                  {iAmTarget ? 'UNO!' : 'Catch!'}
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      <Modal
        isOpen={colorModalOpen}
        onClose={() => {
          setColorModalOpen(false)
          setPendingWildCardId(null)
          // User cancelled — restore the card in hand
          setPendingPlayCardId(null)
          pendingWildFromRectRef.current = null
        }}
        title="Choose a Color"
      >
        <div className="uno-color-picker">
          <button className="btn-secondary" onClick={() => chooseWildColor('red')}>Red</button>
          <button className="btn-secondary" onClick={() => chooseWildColor('green')}>Green</button>
          <button className="btn-secondary" onClick={() => chooseWildColor('blue')}>Blue</button>
          <button className="btn-secondary" onClick={() => chooseWildColor('yellow')}>Yellow</button>
        </div>
      </Modal>

      {flyingCard && (
        <FlyingCard
          card={flyingCard.card}
          images={images}
          fromRect={flyingCard.fromRect}
          discardRef={discardRef}
          onComplete={() => {
            setFlyingCard(null)
            setShowImpact(true)
            setTimeout(() => setShowImpact(false), 280)
          }}
        />
      )}

      {/* Opponent draw flash: card-back pulse at deck for other players drawing */}
      {oppDrawFlash && deckRef.current && (
        <OppDrawFlash
          key={oppDrawFlash.id}
          deckRef={deckRef}
          onComplete={() => setOppDrawFlash(null)}
        />
      )}

      {/* Draw animation: card flies from deck to hand; reveals real face on ACK */}
      {drawFlying && deckRef.current && handRef.current && (
        <FlyingDrawCard
          deckRef={deckRef}
          handRef={handRef}
          drawnCard={drawFlying.drawnCard}
          images={images}
          onComplete={() => setDrawFlying(null)}
        />
      )}
    </div>
  )
}

export default Uno
