import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import Modal from '../components/Modal'
import tableLogo from '/assets/BULK_GAMES_LOGO.png'
import { unoSocket } from '../services/socket'
import type { UnoCard, UnoCardFace, UnoClientState, UnoColor } from '../types/uno'

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
  const files = import.meta.glob('/assets/uno_cards/**/*.png', { eager: true, import: 'default' }) as Record<string, string>
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

function UnoCardImg({ card, images, className, dimmed, glow, onClick }: {
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
    <button
      type="button"
      className={`uno-card ${className || ''} ${dimmed ? 'uno-card--dim' : ''} ${glow ? 'uno-card--glow' : ''}`}
      onClick={onClick}
      disabled={!onClick}
      title={cardLabel(card.face)}
    >
      {src ? (
        <img src={src} alt={cardLabel(card.face)} loading="lazy" decoding="async" />
      ) : (
        <div className="uno-card__fallback">
          {cardLabel(card.face)}
        </div>
      )}
    </button>
  )
}

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

  const images = useMemo(() => buildUnoImages(), [])

  // Keep a stable ref to user id
  useEffect(() => {
    if (user?.id) userIdRef.current = user.id
  }, [user?.id])

  const uid = user?.id ?? ''
  const isHost = state?.hostId === uid
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
        setState(result.gameState)
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
      setState(next)
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
      unsubscribeEnd()
      unsubscribeConnect()
    }
  }, [lobbyCode, isLoggedIn, user?.id])

  const sendAction = useCallback(async (action: { type: 'play'; cardId: string; chosenColor?: UnoColor } | { type: 'draw' } | { type: 'pass' }) => {
    if (!state) return
    const result = await unoSocket.sendAction(state.lobbyCode, action)
    if (!result.success) {
      setError(result.error || 'Action failed')
      setTimeout(() => setError(null), 3000)
    }
  }, [state])

  const handleStartGame = useCallback(async () => {
    if (!state) return
    const result = await unoSocket.startGame(state.lobbyCode)
    if (!result.success) {
      setError(result.error || 'Failed to start game')
      setTimeout(() => setError(null), 3000)
    }
  }, [state])

  const handleEndLobby = useCallback(async () => {
    if (!state) return
    const result = await unoSocket.endLobby(state.lobbyCode)
    if (result.success) {
      window.close()
    } else {
      setError(result.error || 'Failed to end lobby')
      setTimeout(() => setError(null), 3000)
    }
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

        {isHost && (
          <div className="uno-header__controls">
            {state.phase === 'lobby' && state.players.length >= 2 && (
              <button className="btn-primary" onClick={handleStartGame} style={{ width: 'auto', padding: '8px 16px' }}>
                Start Game
              </button>
            )}
            <button className="btn-secondary" onClick={handleEndLobby} style={{ width: 'auto', padding: '8px 16px' }}>
              End Lobby
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
                const uno = state.phase === 'playing' && p.cardCount === 1
                const style = seatPos(idx, state.players.length)

                return (
                  <div
                    key={p.playerId}
                    className={`uno-seat ${isTurn ? 'uno-seat--active' : ''} ${isMe ? 'uno-seat--me' : ''} ${isWinner ? 'uno-seat--winner' : ''} ${!p.isConnected ? 'uno-seat--disconnected' : ''}`}
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
                const style = { transform: `translateX(${x}px) translateY(${y}px) rotate(${rot}deg)` }
                const canClick = isMyTurn && playable.has(c.id)
                const dim = isMyTurn && !playable.has(c.id)
                return (
                  <div key={c.id} className="uno-hand__card" style={style}>
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
              <button className="btn-secondary" onClick={() => (window.location.href = '/main-menu')}>
                Back to Main Menu
              </button>
            </div>
          </div>
        </div>
      )}

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
