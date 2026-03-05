import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth, useIsMobile } from '../hooks'
import { Modal } from '../components/Modal'
import { WinCelebration } from '../components/WinCelebration'
import { SfxControls } from '../components/SfxControls'
import tableLogo from '../assets/logo-white.svg'

import { unoSocket } from '../services/socket'
import { sfx } from '../services/sfx'
import { UnoMobileHand } from '../components/UnoMobileHand'
import { UnoDesktopHand } from '../components/UnoDesktopHand'
import type { UnoCard, UnoCardFace, UnoClientState, UnoColor } from '../types/uno'
import { useUnoMobileSync } from '../hooks/useUnoMobileSync'
import { useUnoDesktopSync } from '../hooks/useUnoDesktopSync'

/** Build CSS classes for player cosmetics from game-state data */
const BORDER_MAP: Record<string, string> = {
  border_gold: 'cosmetic-border--gold',
  border_rainbow: 'cosmetic-border--rainbow',
  border_neon: 'cosmetic-border--neon',
  border_fire: 'cosmetic-border--fire',
  border_ice: 'cosmetic-border--ice',
  border_starlight: 'cosmetic-border--starlight',
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

export type UnoFaceId =
  | `${UnoColor}_${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | `${UnoColor}_skip`
  | `${UnoColor}_reverse`
  | `${UnoColor}_draw2`
  | 'wild'
  | 'wild4'

export function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

export function faceId(face: UnoCardFace): UnoFaceId {
  if (face.kind === 'wild') return 'wild'
  if (face.kind === 'wild4') return 'wild4'
  if (face.kind === 'number') return `${face.color}_${face.value}` as UnoFaceId
  return `${face.color}_${face.kind}` as UnoFaceId
}

export function isWild(face: UnoCardFace) {
  return face.kind === 'wild' || face.kind === 'wild4'
}

export function isPlayableCard(card: UnoCardFace, top: UnoCardFace | null, currentColor: UnoColor | null): boolean {
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

export function hasColor(hand: UnoCard[], color: UnoColor) {
  return hand.some(c => c.face.kind !== 'wild' && c.face.kind !== 'wild4' && 'color' in c.face && c.face.color === color)
}

export function cardLabel(face: UnoCardFace) {
  if (face.kind === 'wild') return 'Wild'
  if (face.kind === 'wild4') return 'Wild Draw Four'
  const c = face.color[0].toUpperCase() + face.color.slice(1)
  if (face.kind === 'number') return `${c} ${face.value}`
  if (face.kind === 'draw2') return `${c} Draw Two`
  if (face.kind === 'reverse') return `${c} Reverse`
  return `${c} Skip`
}

export function hashStr(s: string) {
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

  const add = (id: UnoFaceId, filenamePattern: string) => {
    // Find any file in the glob whose path ends with this exact string name (case-insensitive)
    const matches = Object.entries(files).filter(([path]) =>
      path.toLowerCase().endsWith(filenamePattern.toLowerCase())
    )
    if (matches.length > 0) {
      if (!out[id]) out[id] = []
      out[id].push(...matches.map(m => m[1]))
    } else {
      console.error(`[UNO Asset Missing]: Could not find any files matching "${filenamePattern}"`)
    }
  }

  // Red
  add('red_0', 'Red-0.png')
  add('red_1', 'Red-1.png')
  add('red_2', 'Red-2.png')
  add('red_3', 'Red-3.png')
  add('red_4', 'Red-4.png')
  add('red_5', 'Red-5.png')
  add('red_6', 'Red-6.png')
  add('red_7', 'Red-7.png')
  add('red_8', 'Red-8.png')
  add('red_9', 'Red-9.png')
  add('red_draw2', 'Red Draw2-1.png')
  add('red_draw2', 'Red Draw2-2.png')
  add('red_skip', 'Red Skip-1.png')
  add('red_skip', 'Red Skip-3.png')
  add('red_reverse', 'Red Reverse-1.png')
  add('red_reverse', 'Red Reverse2.png')
  // Fun irregularity from the Blue folder
  add('red_skip', 'Red Skip-2.png')

  // Green
  add('green_0', 'Green-0.png')
  add('green_1', 'Green-1.png')
  add('green_2', 'Green-2.png')
  add('green_3', 'Green-3.png')
  add('green_4', 'Green-4.png')
  add('green_5', 'Green-5.png')
  add('green_6', 'Green-6.png')
  add('green_7', 'Green-7.png')
  add('green_8', 'Green-8.png')
  add('green_9', 'Green-9.png')
  add('green_draw2', 'Green Draw2-1.png')
  add('green_draw2', 'Green Draw2-2.png')
  add('green_draw2', 'Green Draw2-8.png') // From Yellow folder
  add('green_skip', 'Green Skip- 1.png')
  add('green_skip', 'Green Skip- 2.png')
  add('green_reverse', 'Green Reverse-1.png')
  add('green_reverse', 'Green Reverse-2.png')

  // Blue
  add('blue_0', 'Blue-0.png')
  add('blue_1', 'Blue-1.png')
  add('blue_2', 'Blue-2.png')
  add('blue_3', 'Blue-3.png')
  add('blue_4', 'Blue-4.png')
  add('blue_5', 'Blue-5.png')
  add('blue_6', 'Blue-6.png')
  add('blue_7', 'Blue-7.png')
  add('blue_8', 'Blue-8.png')
  add('blue_9', 'Blue-9.png')
  add('blue_draw2', 'Blue Draw2-1.png')
  add('blue_draw2', 'Blue Draw2-2.png')
  add('blue_skip', 'Blue Skip-1.png')
  add('blue_skip', 'Blue Skip-2.png')
  add('blue_skip', 'Red Skip-2.png') // Physical filename mistake handling
  add('blue_reverse', 'Blue Reverse- 1.png')
  add('blue_reverse', 'Blue Reverse- 2.png')

  // Yellow
  add('yellow_0', 'Yellow-0.png')
  add('yellow_1', 'Yellow-1.png')
  add('yellow_2', 'Yellow-2.png')
  add('yellow_3', 'Yellow-3.png')
  add('yellow_4', 'Yellow-4.png')
  add('yellow_5', 'Yellow-5.png')
  add('yellow_6', 'Yellow-6.png')
  add('yellow_7', 'Yellow-7.png')
  add('yellow_8', 'Yellow-8.png')
  add('yellow_9', 'Yellow-9.png')
  add('yellow_draw2', 'Yellow Draw2-2.png')
  add('yellow_skip', 'Yellow Skip-1.png')
  add('yellow_skip', 'Yellow Skip-2.png')
  add('yellow_reverse', 'Yellow Reverse-1.png')
  add('yellow_reverse', 'Yellow Reverse-2.png')

  // Wild
  add('wild', 'Wild-1.png')
  add('wild', 'Wild-2.png')
  add('wild', 'Wild-3.png')
  add('wild', 'Wild-4.png')

  add('wild4', 'Draw4-1.png')
  add('wild4', 'Draw4-2.png')
  add('wild4', 'Draw4-3.png')
  add('wild4', 'Draw4-4.png')

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

export const UnoCardImg = memo(function UnoCardImg({ card, images, className, glow, onCardClick }: {
  card: UnoCard
  images: Record<string, string[]>
  className?: string
  glow?: boolean
  onCardClick?: (c: UnoCard) => void
}) {
  const fId = faceId(card.face)
  const variants = images[fId] || []
  let src = variants.length ? variants[Math.abs(hashStr(card.id)) % variants.length] : null

  if (!src) {
    console.error(`[UnoCardImg] No map found for logical card ${fId}!`)
  }

  return (
    <motion.button
      type="button"
      className={`uno-card ${className || ''} ${glow ? 'uno-card--glow' : ''}`}
      onClick={() => onCardClick?.(card)}
      disabled={!onCardClick}
      title={cardLabel(card.face)}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      {src ? (
        <img src={src} alt={cardLabel(card.face)} decoding="async" loading="eager" />
      ) : (
        <div className="uno-card__fallback" data-color={'color' in card.face ? card.face.color : 'wild'}>
          {cardLabel(card.face)}
        </div>
      )}
    </motion.button>
  )
})

/** Card that "flies" from the deck to the player's hand on Draw.
 *  Shows the drawer the real card face; opponents see a card back (or nothing).
 *  drawnCard is always set before the component mounts in the normal flow
 *  (animation only starts after ACK delivers the real card).
 *  Falls back to card-back display for the rare case where ACK has no drawnCard. */
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

  // Track whether the card face was known when this component first mounted.
  // When true: render face immediately with no cross-fade from the card back.
  const cardKnownAtMountRef = useRef(drawnCard !== null)

  // motionDone: true once Framer Motion finishes the fly animation
  const [motionDone, setMotionDone] = useState(false)
  // holdTimerRef: timeout that fires onComplete when waiting for ACK
  const holdTimerRef = useRef<number | null>(null)

  // After motion completes: dismiss quickly so the hand card reveal is seamless.
  // We hold for 250ms per UX request so the card visually pauses at the hand.
  // Fallback (drawnCard null): hold up to 280ms for state-broadcast, then dismiss.
  useEffect(() => {
    if (!motionDone) return
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
    if (drawnCard) {
      holdTimerRef.current = window.setTimeout(() => onCompleteRef.current(), 250)
    } else {
      holdTimerRef.current = window.setTimeout(() => onCompleteRef.current(), 280)
    }
    return () => { if (holdTimerRef.current) clearTimeout(holdTimerRef.current) }
  }, [motionDone]) // eslint-disable-line react-hooks/exhaustive-deps

  // If card face arrives while holding (state-broadcast fallback path only),
  // cancel the long-wait timer and replace with the 250ms dismiss timer.
  useEffect(() => {
    if (!motionDone || !drawnCard) return
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current)
    holdTimerRef.current = window.setTimeout(() => onCompleteRef.current(), 250)
    return () => { if (holdTimerRef.current) clearTimeout(holdTimerRef.current) }
  }, [drawnCard, motionDone])

  // Resolve card image from the same asset map used by hand cards
  const cardSrc = drawnCard ? (() => {
    const fId = faceId(drawnCard.face)
    const variants = images[fId] || []
    return variants.length ? variants[Math.abs(hashStr(drawnCard.id)) % variants.length] : null
  })() : null

  // When the card face is known at mount, skip transitions so the face renders
  // immediately with no cross-fade flash from the card-back placeholder.
  const backInitialOpacity = cardKnownAtMountRef.current ? 0 : 1
  const faceInitialOpacity = cardKnownAtMountRef.current ? 1 : 0
  const faceTransitionDuration = cardKnownAtMountRef.current ? 0 : 0.16

  return (
    <motion.div
      className="uno-flying-card"
      initial={{ x: fromX, y: fromY, scale: 1.12, opacity: 1, rotate: -8 }}
      animate={{ x: toX, y: toY, scale: 0.88, opacity: motionDone ? 0 : 0.9, rotate: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      onAnimationComplete={() => setMotionDone(true)}
    >
      {/* Card back — hidden from the start when real face is known at mount */}
      <motion.div
        className="uno-draw-back"
        initial={{ opacity: backInitialOpacity }}
        animate={{ opacity: cardSrc ? 0 : 1 }}
        transition={{ duration: 0.14 }}
      />
      {/* Real card face — visible immediately when known at mount, fades in otherwise */}
      {cardSrc && (
        <motion.img
          src={cardSrc}
          alt=""
          draggable={false}
          className="uno-draw-face"
          initial={{ opacity: faceInitialOpacity }}
          animate={{ opacity: 1 }}
          transition={{ duration: faceTransitionDuration }}
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
      initial={{ x: fromRect.left, y: fromRect.top, scale: 1, opacity: 1, rotate: 0 }}
      animate={{ x: toX, y: toY, scale: 0.9, opacity: 0, rotate: 15 }}
      transition={{ duration: 0.28, ease: 'easeIn' }}
      onAnimationComplete={onComplete}
    >
      {src ? (
        <img src={src} className="uno-draw-face" alt="" />
      ) : (
        <div className="uno-draw-face" data-color={'color' in card.face ? card.face.color : 'wild'} />
      )}
    </motion.div>
  )
})

export default function UnoRouter() {
  const { isLoggedIn, user } = useAuth()
  const [lobbyCode, setLobbyCode] = useState<string>('')
  const [params] = useSearchParams()

  useEffect(() => {
    const code = params.get('code')
    if (code) setLobbyCode(code)
  }, [params])

  const mobileThreshold = 768
  const isMobileSize = useIsMobile(mobileThreshold)

  // Strict separation of environment logic paths
  if (isMobileSize) {
    return <UnoMobilePage lobbyCode={lobbyCode} isLoggedIn={isLoggedIn} userId={user?.id} />
  }
  return <UnoDesktopPage lobbyCode={lobbyCode} isLoggedIn={isLoggedIn} userId={user?.id} />
}
// Suppress unused-var lint for clamp (used by other utilities)
void clamp

function UnoDesktopPage({ lobbyCode, isLoggedIn, userId }: any) {
  const sync = useUnoDesktopSync(lobbyCode, isLoggedIn, userId)
  return <UnoUI lobbyCode={lobbyCode} isLoggedIn={isLoggedIn} userId={userId} sync={sync} isMobile={false} />
}

function UnoMobilePage({ lobbyCode, isLoggedIn, userId }: any) {
  const sync = useUnoMobileSync(lobbyCode, isLoggedIn, userId)
  return <UnoUI lobbyCode={lobbyCode} isLoggedIn={isLoggedIn} userId={userId} sync={sync} isMobile={true} />
}

export default function UnoRouter() {
  const [searchParams] = useSearchParams()
  const lobbyCode = (searchParams.get('lobby') || '').toUpperCase()
  const { isLoggedIn, user, loading: authLoading } = useAuth()
  const isMobile = useIsMobile()

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

  if (isMobile) {
    return <UnoMobilePage lobbyCode={lobbyCode} isLoggedIn={isLoggedIn} userId={user?.id} />
  }

  return <UnoDesktopPage lobbyCode={lobbyCode} isLoggedIn={isLoggedIn} userId={user?.id} />
}

// ─────────────────────────────────────────────────────────────────
// Shared UI Shell (Pure View Logic)
// ─────────────────────────────────────────────────────────────────
function UnoUI({ lobbyCode, isLoggedIn, userId, sync, isMobile }: {
  lobbyCode: string
  isLoggedIn: boolean
  userId: string | undefined
  sync: ReturnType<typeof useUnoDesktopSync> | ReturnType<typeof useUnoMobileSync>
  isMobile: boolean
}) {
  const { state, setState, connected, error, setError, unoPrompt, setUnoPrompt, oppDrawFlash, setOppDrawFlash, celebration } = sync

  const userIdRef = useRef<string | null>(userId || null)
  useEffect(() => { userIdRef.current = userId || null }, [userId])
  const [colorModalOpen, setColorModalOpen] = useState(false)
  const [pendingWildCardId, setPendingWildCardId] = useState<string | null>(null)

  // ── Celebration (server-driven; visible to everyone) ───────────
  const [celebration, setCelebration] = useState<null | { id: string; effectId: 'stars' | 'red_hearts' | 'black_hearts' | 'fire_burst' | 'water_burst' | 'sakura_petals' | 'gold_stars' | 'rainbow_burst' }>(null)
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

  // ── Decoupled UNO Prompt Overlay ───────────────────────────────
  // Moved to sync hook

  // ── Draw animation ─────────────────────────────────────────────
  // drawnCard is null while in-flight (card back shown), set to the real
  // card once the state update / ACK reveals it.
  const [drawFlying, setDrawFlying] = useState<{ drawnCard: UnoCard | null } | null>(null)
  // Snapshot of hand IDs captured before the draw action is sent.
  // Used to diff state updates and find the newly drawn card.
  const pendingDrawSnapRef = useRef<Set<string> | null>(null)
  // Opponent draw flash: shown when another player draws (uno:drawFx event)
  // Moved to Sync Hook
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
          setUnoPrompt(res.gameState.unoPrompt)
        }
      }).catch(() => { resyncingRef.current = false })
      // Still apply this state as a fallback
    }

    // Identical version short-circuit: stops React re-render queue spam
    if (incomingVersion === lastVersion && lastVersion > 0) {
      // Only apply independent, volatile visual state changes like prompt appearing 
      // without re-rendering the massive hands and discard pile arrays.
      if (incoming.unoPrompt?.active !== latestStateRef.current?.unoPrompt?.active) {
        setUnoPrompt(incoming.unoPrompt)
      }
      return
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
          setState((prev: UnoClientState | null) => {
            if (prev) {
              const isStateChanged = () => {
                if (prev.phase !== s.phase) return true;
                if (prev.currentPlayerIndex !== s.currentPlayerIndex) return true;
                if (prev.currentColor !== s.currentColor) return true;
                if (prev.drawPileCount !== s.drawPileCount) return true;
                if (prev.direction !== s.direction) return true;
                if (prev.mustCallUno !== s.mustCallUno) return true;
                if (prev.winnerId !== s.winnerId) return true;
                if (prev.actionLog?.length !== s.actionLog?.length) return true;
                if (prev.discardPile?.length !== s.discardPile?.length) return true;
                if (prev.players.length !== s.players.length) return true;
                for (let i = 0; i < prev.players.length; i++) {
                  if (prev.players[i].cardCount !== s.players[i].cardCount ||
                    prev.players[i].isConnected !== s.players[i].isConnected) return true;
                }
                const uid = userIdRef.current;
                if (uid) {
                  const hA = prev.hands?.[uid] || [];
                  const hB = s.hands?.[uid] || [];
                  if (hA.length !== hB.length) return true;
                  for (let i = 0; i < hA.length; i++) {
                    if (hA[i].id !== hB[i].id) return true;
                  }
                }
                if (prev.drawnPlayable?.cardId !== s.drawnPlayable?.cardId) return true;
                if (prev.unoPrompt?.active !== s.unoPrompt?.active) return true;
                return false;
              }
              if (!isStateChanged()) {
                if (IS_DEV) console.log('[uno:sync] Dropped timer/version-only update');
                return prev;
              }
            }
            return s;
          })
        }
      })
    }
  }, [])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.currentColor, myHand, topCard?.id, drawnPlayable?.cardId])

  const hasAnyPlayable = playable.size > 0

  // ── Visible hand: omit cards that are currently animated as overlays ───────
  // 1. pendingPlayCardId: card being played (flies from hand → discard pile)
  // 2. drawFlying.drawnCard: card being drawn (flies from deck → hand)
  //    Filtering it while the animation runs prevents the card from appearing
  //    in both the flying overlay and the hand simultaneously (duplicate bug).
  //    When the animation completes, setDrawFlying(null) lifts the filter and
  //    the card appears in hand seamlessly in the same React render cycle.
  const visibleHand = useMemo(() => {
    let hand = myHand
    if (pendingPlayCardId) hand = hand.filter(c => c.id !== pendingPlayCardId)
    if (drawFlying?.drawnCard) hand = hand.filter(c => c.id !== drawFlying.drawnCard!.id)

    // Stable client-side sorting: Red -> (Action) -> Green -> ... -> Yellow -> Blue -> Wild
    hand = [...hand].sort((a, b) => {
      const colorScore: Record<string, number> = { red: 1, green: 2, yellow: 3, blue: 4, wild: 5, wild4: 6 };

      const getScore = (face: UnoCardFace) =>
        face.kind === 'wild' ? colorScore.wild :
          face.kind === 'wild4' ? colorScore.wild4 :
            colorScore[face.color] || 99;

      const scoreA = getScore(a.face);
      const scoreB = getScore(b.face);

      // 1. Group by color
      if (scoreA !== scoreB) return scoreA - scoreB;

      // 2. Sort by value / action kind within same color
      const valA = a.face.kind === 'number' ? a.face.value : a.face.kind === 'skip' ? 10 : a.face.kind === 'reverse' ? 11 : a.face.kind === 'draw2' ? 12 : 13;
      const valB = b.face.kind === 'number' ? b.face.value : b.face.kind === 'skip' ? 10 : b.face.kind === 'reverse' ? 11 : b.face.kind === 'draw2' ? 12 : 13;
      if (valA !== valB) return valA - valB;

      // 3. Strict stable fallback by ID to avoid visual jitter
      return a.id.localeCompare(b.id);
    });

    return hand
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myHand, pendingPlayCardId, drawFlying?.drawnCard?.id])

  // Clear pendingPlayCardId once server confirms the card left the hand
  useEffect(() => {
    if (!pendingPlayCardId || !state) return
    const hand = state.hands?.[myPlayerId] || []
    if (!hand.some(c => c.id === pendingPlayCardId)) {
      setPendingPlayCardId(null)
    }
  }, [state, pendingPlayCardId, myPlayerId])

  // ── Drawn card detection (state-broadcast path) ─────────────────────────
  // When the server state arrives after a draw action, diff the hand against
  // the pre-draw snapshot to find the newly drawn card and reveal its face.
  // This is more reliable than relying solely on the ACK payload structure.
  useEffect(() => {
    if (!drawFlying || drawFlying.drawnCard !== null || !pendingDrawSnapRef.current) return
    const snap = pendingDrawSnapRef.current
    // state.hands[uid] contains REAL cards for the local player (server-personalised)
    const hand: UnoCard[] = state?.hands?.[myPlayerId] ?? state?.hands?.[String(myPlayerId)] ?? []
    const newCard = hand.find(c => !snap.has(c.id))
    if (!newCard) return
    pendingDrawSnapRef.current = null
    setDrawFlying(prev => prev !== null ? { drawnCard: newCard } : null)
  }, [state, drawFlying, myPlayerId])

  // ── SFX: state-diff effect — fires sounds based on game state transitions ──
  useEffect(() => {
    if (!state) {
      // prevStateRef.current = null // This ref is now in the hook
      return
    }

    // const prev = prevStateRef.current // This ref is now in the hook
    // prevStateRef.current = state // This ref is now in the hook

    // Skip sounds for the very first state load (no diff to compare)
    // if (!prev) return // This logic is now in the hook

    // ── Phase: lobby → playing (game starts) ───────────────────────────
    // This logic is now in the hook
    // if (prev.phase !== 'playing' && state.phase === 'playing') {
    //   sfx.play('game_start', { cooldownMs: 3000 })
    //   // Stagger deal sounds to mimic cards being distributed
    //   setTimeout(() => sfx.play('deal', { cooldownMs: 0 }), 250)
    //   setTimeout(() => sfx.play('deal', { cooldownMs: 0 }), 500)
    //   return
    // }

    // ── Phase: playing → finished (game over) ──────────────────────────
    // This logic is now in the hook
    // if (prev.phase === 'playing' && state.phase === 'finished') {
    //   if (state.winnerId === uid) {
    //     sfx.play('win', { cooldownMs: 3000 })
    //   } else {
    //     sfx.play('game_end', { cooldownMs: 3000 })
    //   }
    //   return
    // }

    // if (state.phase !== 'playing') return // This logic is now in the hook

    // ── Turn change: now my turn ───────────────────────────────────────
    // This logic is now in the hook
    // const prevTurnId = prev.players[prev.currentPlayerIndex]?.playerId
    // const currTurnId = state.players[state.currentPlayerIndex]?.playerId
    // if (prevTurnId !== currTurnId && currTurnId === uid) {
    //   sfx.play('card_select', { cooldownMs: 500 })
    // }

    // ── Top card changed → a card was played ──────────────────────────
    // This logic is now in the hook
    // const prevTop = prev.discardPile?.[prev.discardPile.length - 1]
    // const currTop = state.discardPile?.[state.discardPile.length - 1]

    // if (currTop && prevTop?.id !== currTop.id) {
    //   // prevTurnId is who just played; only play sounds here for OTHER players.
    //   // When the local player plays, sounds are triggered in onCardClick directly.
    //   if (prevTurnId && prevTurnId !== uid) {
    //     switch (currTop.face.kind) {
    //       case 'reverse':
    //         sfx.play('card_reverse', { cooldownMs: 300 })
    //         break
    //       case 'skip':
    //         sfx.play('card_skip', { cooldownMs: 300 })
    //         break
    //       case 'draw2':
    //       case 'wild4':
    //         sfx.play('card_punish', { cooldownMs: 300 })
    //         break
    //       case 'wild':
    //         sfx.play('wild_card', { cooldownMs: 300 })
    //         break
    //       default:
    //         sfx.play('card_play_other', { cooldownMs: 200 })
    //     }
    //   }
    // }

    // ── UNO prompt appeared ────────────────────────────────────────────
    // (no dedicated "uno call" sound file, so we reuse card_select as an attention ping)
    // This logic is now in the hook
    // if (!prev.unoPrompt?.active && state.unoPrompt?.active) {
    //   sfx.play('card_select', { cooldownMs: 1000 })
    // }
  }, [state, uid, sfx]) // sfx added to deps

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

  const onCardClick = useCallback((c: UnoCard) => {
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
  }, [isMyTurn, playable, sendAction])

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

  // Extract variables based on logic since they were used natively before
  const myPlayerId = userId ?? ''
  const isHost = state?.hostId === myPlayerId
  const isPublic = !!state?.isPublic
  const me = state?.players.find(p => p.playerId === myPlayerId) || null
  const isSpectator = !!state?.isSpectator
  const isMyTurn = state?.phase === 'playing' && state?.players[state.currentPlayerIndex]?.playerId === myPlayerId
  const currentPlayer = state?.players[state.currentPlayerIndex]
  const spectatorCount = state?.spectators?.length ?? 0

  const myHand = myPlayerId ? state?.hands?.[myPlayerId] ?? state?.hands?.[String(myPlayerId)] ?? [] : []
  const topCard = state?.discardPile?.length ? state.discardPile[state.discardPile.length - 1] : null
  const drawnPlayable = state?.drawnPlayable?.playerId === myPlayerId ? state.drawnPlayable : null
  const playable = useMemo(() => {
    const p = new Set<string>()
    if (isMyTurn && state?.phase === 'playing') {
      myHand.forEach((c: UnoCard) => {
        if (isPlayableCard(c.face, topCard ? topCard.face : null, state.currentColor)) p.add(c.id)
      })
    }
    return p
  }, [isMyTurn, state?.phase, state?.currentColor, myHand, topCard])

  const hasAnyPlayable = playable.size > 0
  const drawnPlayable = state?.drawnCardMatches && hasColor(myHand, state.currentColor as UnoColor)

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
                  <div className="uno-deck__stack">
                    <div className="uno-deck__oval" />
                  </div>
                  <div className="uno-deck__count">{state.drawPileCount}</div>
                </div>

                <div
                  className="uno-discard"
                  ref={discardRef}
                  aria-label="Discard pile"
                  data-color={state.currentColor || ''}
                >
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
                const isMe = p.playerId === myPlayerId
                const isWinner = state.phase === 'finished' && state.winnerId === p.playerId
                const uno = state.phase === 'playing' && p.cardCount === 1 && state.mustCallUno !== p.playerId

                const angle = (idx * (360 / Math.max(1, state.players.length))) - 90
                const rad = angle * (Math.PI / 180)
                const rx = 42
                const ry = 32
                const style = {
                  left: `calc(50% + ${Math.cos(rad) * rx}%)`,
                  top: `calc(50% + ${Math.sin(rad) * ry}%)`,
                }

                return <UnoPlayerSeat key={p.playerId} player={p} isTurn={isTurn} isMe={isMe} isWinner={isWinner} uno={uno} style={style} />
              })}
            </div>
          </div>
        </div>

        <UnoActionLog actionLog={state.actionLog} />
      </div>

      {state.phase === 'lobby' && (
        <div className="uno-waiting">
          <h3>Waiting for game to start...</h3>
          <p>{state.players.length} player{state.players.length !== 1 ? 's' : ''} in lobby</p>
          <div className="uno-waiting__players">
            {state.players.map((p: any) => (
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
                <div className="uno-actions__status">
                  <span className="uno-actions__turn">👁 Spectating</span>
                  <span className="muted">{currentPlayer?.nickname || 'Player'}'s turn</span>
                </div>
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

              {/* Turn timer — visible to all players */}
              {state.phase === 'playing' && (
                <UnoTimer timeRemainingMs={state.turnTimeRemaining} />
              )}

              <div className="uno-actions__buttons">
                {isMyTurn && !drawnPlayable && (
                  <button
                    className="btn-primary uno-actions__btn"
                    onClick={() => {
                      // Guard: don't start if sendAction will bail out early
                      if (!state || actionPendingRef.current) return
                      sfx.play('draw')
                      // Snapshot current hand IDs for fallback state-based detection
                      const snap = new Set(myHand.map((c: UnoCard) => c.id))
                      pendingDrawSnapRef.current = snap
                      // OPTIMISTIC: start the flying animation immediately with a card back
                      setDrawFlying({ drawnCard: null })
                      sendAction({ type: 'draw' }, {
                        onFailure: () => {
                          // Action failed — clear snapshot, reset animation
                          pendingDrawSnapRef.current = null
                          setDrawFlying(null)
                        },
                        onAck: (result: any) => {
                          // PRIMARY: ACK includes drawnCard → update flight with real face
                          if (result?.drawnCard) {
                            pendingDrawSnapRef.current = null
                            setDrawFlying({ drawnCard: result.drawnCard as UnoCard })
                            return
                          }
                          // FALLBACK A: diff the hand from ACK gameState
                          if (result?.gameState && pendingDrawSnapRef.current) {
                            const myPid = state.myPlayerId
                            const newHand: UnoCard[] =
                              result.gameState.hands?.[myPid] ??
                              result.gameState.hands?.[String(myPid)] ??
                              []
                            const newCard = newHand.find((c: UnoCard) => !snap.has(c.id))
                            if (newCard) {
                              pendingDrawSnapRef.current = null
                              setDrawFlying({ drawnCard: newCard })
                              return
                            }
                          }
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
            {isMobile ? (
              <UnoMobileHand
                visibleHand={visibleHand}
                playable={playable}
                images={images}
                isMyTurn={isMyTurn}
                onCardClick={onCardClick}
              />
            ) : (
              <UnoDesktopHand
                visibleHand={visibleHand}
                playable={playable}
                images={images}
                isMyTurn={isMyTurn}
                onCardClick={onCardClick}
              />
            )}
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
        isOpen={!!unoPrompt?.active}
        onClose={() => { }}
        title="UNO!"
      >
        {unoPrompt && (() => {
          const target = state.players.find((p: any) => p.playerId === unoPrompt!.targetPlayerId);
          const iAmTarget = unoPrompt!.targetPlayerId === uid;
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
                    left: `${unoPrompt!.buttonPos.x}%`,
                    top: `${unoPrompt!.buttonPos.y}%`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  onClick={() => {
                    sfx.play('card_select')
                    // Optimistic hide so the user isn't stuck waiting for roundtrip
                    setUnoPrompt((prev: any) => prev ? { ...prev, active: false } : null)

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

// Remove Uno component export default since UnoRouter handles it now.

// ── Isolated UI Components (Memoized to prevent ticking/layout re-renders) ──

const UnoTimer = memo(function UnoTimer({ timeRemainingMs }: { timeRemainingMs?: number | null }) {
  const [seconds, setSeconds] = useState<number | null>(null)

  useEffect(() => {
    if (timeRemainingMs === undefined || timeRemainingMs === null || timeRemainingMs <= 0) {
      setSeconds(null)
      return
    }
    const secs = Math.ceil(timeRemainingMs / 1000)
    setSeconds(secs)

    const endTime = Date.now() + timeRemainingMs
    const calc = () => Math.max(0, Math.ceil((endTime - Date.now()) / 1000))

    const interval = window.setInterval(() => {
      const s = calc()
      setSeconds(s)
      if (s <= 0) window.clearInterval(interval)
    }, 1000)

    return () => window.clearInterval(interval)
  }, [timeRemainingMs])

  if (seconds === null) return null

  return (
    <span className={`uno-timer${seconds <= 10 ? ' uno-timer--urgent' : ''}`}>
      ⏱ {seconds}s
    </span>
  )
})

const UnoPlayerSeat = memo(function UnoPlayerSeat({ player, isTurn, isMe, isWinner, uno, style }: any) {
  return (
    <div
      className={`uno-seat ${isTurn ? 'uno-seat--active' : ''} ${isMe ? 'uno-seat--me' : ''} ${isWinner ? 'uno-seat--winner' : ''} ${!player.isConnected ? 'uno-seat--disconnected' : ''} ${buildCosmeticClasses(player.equippedBorder, player.equippedEffect)}`}
      style={style}
    >
      <div className="uno-seat__avatar">
        {player.avatarUrl ? <img src={player.avatarUrl} alt={player.nickname} /> : <span>👤</span>}
      </div>
      <div className="uno-seat__info">
        <span className="uno-seat__name">{player.nickname}</span>
        <span className="uno-seat__count">{player.cardCount} cards</span>
      </div>
      {uno && <div className="uno-seat__uno">UNO!</div>}
    </div>
  )
})

const UnoActionLog = memo(function UnoActionLog({ actionLog }: { actionLog: { id: string; text: string }[] }) {
  return (
    <div className="uno-log">
      <div className="uno-log__title">Action Log</div>
      <div className="uno-log__entries">
        {actionLog.slice().reverse().map((e) => (
          <div key={e.id} className="uno-log__entry">
            <span className="uno-log__text">{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
})
