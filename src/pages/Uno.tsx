import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../hooks/useAuth'
import Modal from '../components/Modal'
import WinCelebration from '../components/WinCelebration'
import tableLogo from '/assets/BULK_GAMES_LOGO.png'
import { unoSocket } from '../services/socket'
import type { UnoCard, UnoCardFace, UnoClientState, UnoColor } from '../types/uno'

/** Build CSS classes for player cosmetics from game-state data */
const BORDER_MAP: Record<string, string> = {
  border_gold: 'cosmetic-border--gold',
  border_rainbow: 'cosmetic-border--rainbow',
  border_neon: 'cosmetic-border--neon',
  border_fire: 'cosmetic-border--fire',
}
const EFFECT_MAP: Record<string, string> = {
  effect_glow: 'cosmetic-effect--glow',
  effect_sparkle: 'cosmetic-effect--sparkle',
  effect_shadow: 'cosmetic-effect--shadow',
  effect_pulse: 'cosmetic-effect--pulse',
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
      initial={{ opacity: 0, scale: 0.85, y: 12 }}
      animate={{ opacity: dimmed ? 0.45 : 1, scale: 1, y: 0 }}
      whileHover={onClick ? { scale: 1.18, y: -22 } : undefined}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      style={{ transformOrigin: 'center bottom' }}
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
  const [celebration, setCelebration] = useState<null | { id: string; effectId: 'stars' | 'red_hearts' | 'black_hearts' }>(null)
  const celebrationTimerRef = useRef<number | null>(null)

  const images = useMemo(() => buildUnoImages(), [])

  // ── Version tracking for synchronization ──────────────────────
  const lastVersionRef = useRef<number>(0)
  const resyncingRef = useRef(false)

  /**
   * Apply a new UNO game state only if its version is newer than what we have.
   * If a version gap is detected, request a full resync.
   */
  const applyState = useCallback((incoming: UnoClientState) => {
    const incomingVersion = incoming.version ?? 0
    const lastVersion = lastVersionRef.current

    // Ignore stale states
    if (incomingVersion > 0 && lastVersion > 0 && incomingVersion <= lastVersion) {
      if (IS_DEV) console.log(`[uno:sync] Ignored stale state v${incomingVersion} <= v${lastVersion}`)
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
    setState(incoming)
  }, [])

  // Keep a stable ref to user id
  useEffect(() => {
    if (user?.id) userIdRef.current = user.id
  }, [user?.id])

  const uid = user?.id ?? ''
  const isHost = state?.hostId === uid
  const isPublic = !!state?.isPublic
  const me = state?.players.find(p => p.playerId === uid) || null
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
      const effectId = (p?.effectId || 'stars') as 'stars' | 'red_hearts' | 'black_hearts'
      if (!id) return
      if (IS_DEV) console.log(`[uno:celebration] id=${id} effect=${effectId}`)
      setCelebration({ id, effectId })
      if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current)
      celebrationTimerRef.current = window.setTimeout(() => setCelebration(null), 2200)
    })

    const unsubscribeEnd = unoSocket.on('lobbyEnded', () => {
      setError('Lobby has been closed by the host')
    })

    const unsubscribeConnect = unoSocket.on('connect', () => {
      if (!stopped && lobbyCode) join()
    })

    return () => {
      stopped = true
      unsubscribeState()
      unsubscribeRoster()
      unsubscribeCelebration()
      unsubscribeEnd()
      unsubscribeConnect()
      if (celebrationTimerRef.current) window.clearTimeout(celebrationTimerRef.current)
    }
  }, [lobbyCode, isLoggedIn, user?.id, applyState])

  const sendAction = useCallback(async (action: { type: 'play'; cardId: string; chosenColor?: UnoColor } | { type: 'draw' } | { type: 'pass' }) => {
    if (!state) return
    const result = await unoSocket.sendAction(state.lobbyCode, action)
    if (!result.success) {
      setError(result.error || result.reason || 'Action failed')
      setTimeout(() => setError(null), 3000)
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
    if (c.face.kind === 'wild' || c.face.kind === 'wild4') {
      setPendingWildCardId(c.id)
      setColorModalOpen(true)
      return
    }
    sendAction({ type: 'play', cardId: c.id })
  }

  const chooseWildColor = (color: UnoColor) => {
    if (!pendingWildCardId) return
    sendAction({ type: 'play', cardId: pendingWildCardId, chosenColor: color })
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
  const dirLabel = state.direction === 1 ? '↻' : '↺'
  const colorLabel = state.currentColor ? state.currentColor.toUpperCase() : '—'
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
        </div>

        <div className="uno-header__controls">
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
                <div className="uno-deck" aria-label="Draw deck">
                  <div className="uno-deck__stack" />
                  <div className="uno-deck__count">{state.drawPileCount}</div>
                </div>

                <div className="uno-discard" aria-label="Discard pile">
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
          <div className="uno-actions">
            <div className="uno-actions__status">
              {isMyTurn ? (
                <>
                  <span className="uno-actions__turn">Your turn</span>
                  {drawnPlayable ? (
                    <span className="muted">You drew a playable card — play it or pass</span>
                  ) : hasAnyPlayable ? (
                    <span className="muted">Play a card</span>
                  ) : (
                    <span className="muted">No playable cards — draw 1</span>
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
                  onClick={() => sendAction({ type: 'draw' })}
                  disabled={hasAnyPlayable}
                >
                  Draw
                </button>
              )}
              {isMyTurn && drawnPlayable && (
                <button className="btn-secondary uno-actions__btn" onClick={() => sendAction({ type: 'pass' })}>
                  Pass
                </button>
              )}
              {/* UNO/Catch buttons removed — now handled via server-driven UNO prompt modal */}
              <button className="btn-secondary uno-actions__btn" onClick={() => (window.location.href = '/main-menu')}>
                Back to Main Menu
              </button>
            </div>
          </div>

          <div className="uno-hand" aria-label="Your hand">
            <div className="uno-hand__fan">
              {myHand.map((c, i) => {
                const n = myHand.length
                const spread = clamp(n, 1, 14)
                const center = (n - 1) / 2
                const offset = (i - center)
                const rot = offset * (spread <= 6 ? 6 : 4)
                const x = offset * (spread <= 6 ? 36 : 28)
                const y = Math.abs(offset) * 2
                const wrapperStyle: React.CSSProperties = {
                  transform: `translateX(${x}px) translateY(${y}px) rotate(${rot}deg)`,
                }
                const canClick = isMyTurn && playable.has(c.id)
                const dim = isMyTurn && !playable.has(c.id)
                return (
                  <div key={c.id} className="uno-hand__card" style={wrapperStyle}>
                    <UnoCardImg
                      card={c}
                      images={images}
                      glow={canClick}
                      dimmed={dim}
                      onClick={canClick ? () => onCardClick(c) : undefined}
                    />
                  </div>
                )
              })}
            </div>
          </div>
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
        onClose={() => { setColorModalOpen(false); setPendingWildCardId(null) }}
        title="Choose a Color"
      >
        <div className="uno-color-picker">
          <button className="btn-secondary" onClick={() => chooseWildColor('red')}>Red</button>
          <button className="btn-secondary" onClick={() => chooseWildColor('green')}>Green</button>
          <button className="btn-secondary" onClick={() => chooseWildColor('blue')}>Blue</button>
          <button className="btn-secondary" onClick={() => chooseWildColor('yellow')}>Yellow</button>
        </div>
      </Modal>
    </div>
  )
}

export default Uno
