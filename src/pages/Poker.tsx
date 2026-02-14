import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../hooks/useAuth'
import { pokerSocket } from '../services/socket'
import { getCardImageUrl, formatCard, getSuitColor, preloadPokerCards } from '../utils/cards'
import type { ClientGameState, ClientPlayer, Card, PlayerAction } from '../types/poker'
import { getBestHand, cardKey, type HandResult } from '../utils/handEval'
import tableLogo from '/assets/BULK_GAMES_LOGO.png'

/* Preload card images as soon as this module is imported (code-split by route) */
preloadPokerCards()

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

const IS_DEV = import.meta.env.DEV
const STACK_STORAGE_PREFIX = 'poker_stack_'

// ── DEV timing helper ────────────────────────────────────────────
const _devT0 = IS_DEV ? performance.now() : 0
let _devTTFC_logged = false

function logTTFC() {
  if (!IS_DEV || _devTTFC_logged) return
  _devTTFC_logged = true
  console.log(`[poker:perf] TTFC (first gameState render): ${(performance.now() - _devT0).toFixed(0)}ms`)
}

// ── Stack persistence helpers ──────────────────────────────────────

function getStoredStack(lobbyCode: string, odotuid: string): number | null {
  try {
    const val = localStorage.getItem(`${STACK_STORAGE_PREFIX}${lobbyCode}_${odotuid}`)
    if (val !== null) {
      const n = parseInt(val, 10)
      return isNaN(n) ? null : n
    }
  } catch { /* ignore */ }
  return null
}

function saveStack(lobbyCode: string, odotuid: string, stack: number): void {
  try {
    localStorage.setItem(`${STACK_STORAGE_PREFIX}${lobbyCode}_${odotuid}`, stack.toString())
  } catch { /* ignore */ }
}

function patchPlayerStack(gs: ClientGameState): ClientGameState {
  const meIdx = gs.players.findIndex(p => p.playerId === gs.myPlayerId)
  if (meIdx === -1) return gs

  const me = gs.players[meIdx]
  const stored = getStoredStack(gs.lobbyCode, gs.myPlayerId)

  if (me.stack !== 1000) {
    saveStack(gs.lobbyCode, gs.myPlayerId, me.stack)
    return gs
  }

  if (stored !== null) {
    const players = [...gs.players]
    players[meIdx] = { ...me, stack: stored }
    return { ...gs, players }
  }

  saveStack(gs.lobbyCode, gs.myPlayerId, 1000)
  return gs
}

// ── Card component (memoized — avoids re-render when props don't change) ──

const CardDisplay = memo(function CardDisplay({
  card,
  isHidden = false,
  highlighted = false,
  dimmed = false,
  isKicker = false,
}: {
  card: Card | null
  isHidden?: boolean
  highlighted?: boolean
  dimmed?: boolean
  isKicker?: boolean
}) {
  if (!card || isHidden) {
    return (
      <div className="poker-card poker-card--back">
        <div className="poker-card__pattern" />
      </div>
    )
  }

  const imageUrl = getCardImageUrl(card)

  const cardStyle: React.CSSProperties = highlighted
    ? { boxShadow: '0 0 0 3px #ffd700, 0 0 14px rgba(255, 215, 0, 0.5)' }
    : dimmed
      ? { opacity: 0.45, filter: 'brightness(0.7)' }
      : {}

  return (
    <div className="poker-card" style={cardStyle}>
      {imageUrl ? (
        <img src={imageUrl} alt={formatCard(card)} className="poker-card__image" decoding="async" loading="eager" />
      ) : (
        <div className="poker-card__fallback" style={{ color: getSuitColor(card.suit) }}>
          <span className="poker-card__rank">{card.rank}</span>
          <span className="poker-card__suit">
            {card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}
          </span>
        </div>
      )}
      {isKicker && (
        <span className="poker-kicker-badge">Kicker</span>
      )}
    </div>
  )
})

// ── Hand rankings guide ────────────────────────────────────────────

const HAND_RANKINGS = [
  'Royal Flush', 'Straight Flush', 'Four of a Kind', 'Full House',
  'Flush', 'Straight', 'Three of a Kind', 'Two Pair', 'One Pair', 'High Card'
]

function HandGuide() {
  const [open, setOpen] = useState(false)
  return (
    <div className={`poker-hand-guide ${open ? 'poker-hand-guide--open' : ''}`}>
      <button className="poker-hand-guide__toggle" onClick={() => setOpen(!open)}>
        {open ? '✕' : '?'} Hands
      </button>
      {open && (
        <ol className="poker-hand-guide__list">
          {HAND_RANKINGS.map((name, i) => (
            <li key={i}>{name}</li>
          ))}
        </ol>
      )}
    </div>
  )
}

// ── Player seat component ──────────────────────────────────────────

function PlayerSeat({ 
  player, 
  isDealer, 
  isSmallBlind, 
  isBigBlind, 
  isCurrentTurn,
  isMe,
  isWinner,
  cosmeticClasses,
}: { 
  player: ClientPlayer
  isDealer: boolean
  isSmallBlind: boolean
  isBigBlind: boolean
  isCurrentTurn: boolean
  isMe: boolean
  isWinner: boolean
  cosmeticClasses?: string
}) {
  const positionMarker = isDealer ? 'D' : isSmallBlind ? 'SB' : isBigBlind ? 'BB' : null
  
  return (
    <div className={`poker-seat ${player.folded ? 'poker-seat--folded' : ''} ${isCurrentTurn ? 'poker-seat--active' : ''} ${isMe ? 'poker-seat--me' : ''} ${isWinner ? 'poker-seat--winner' : ''} ${!player.isConnected ? 'poker-seat--disconnected' : ''} ${cosmeticClasses || ''}`}>
      <div className="poker-seat__avatar">
        {player.avatarUrl ? (
          <img src={player.avatarUrl} alt={player.nickname} />
        ) : (
          <span>👤</span>
        )}
        {positionMarker && (
          <span className="poker-seat__position">{positionMarker}</span>
        )}
      </div>
      
      <div className="poker-seat__info">
        <span className="poker-seat__name">{player.nickname}</span>
        <span className="poker-seat__stack">${player.stack}</span>
      </div>
      
      {player.lastAction && (
        <div className="poker-seat__action">
          {player.lastAction}{player.lastBet > 0 ? ` $${player.lastBet}` : ''}
        </div>
      )}
      
      {player.currentBet > 0 && (
        <div className="poker-seat__bet">
          <span className="poker-seat__bet-chip" />
          ${player.currentBet}
        </div>
      )}
      
      {/* Removed: poker-seat__cards — no hidden cards under avatars */}
    </div>
  )
}

// ── Action panel component ─────────────────────────────────────────

function ActionPanel({ 
  gameState, 
  onAction 
}: { 
  gameState: ClientGameState
  onAction: (action: PlayerAction, amount?: number) => void
}) {
  const [betAmount, setBetAmount] = useState(0)
  const currentPlayer = gameState.players[gameState.currentPlayerIndex]
  const me = gameState.players.find(p => p.playerId === gameState.myPlayerId)
  
  const isMyTurn = currentPlayer?.playerId === gameState.myPlayerId
  const toCall = gameState.currentBet - (me?.currentBet || 0)
  const canCheck = toCall === 0
  const minBet = gameState.currentBet === 0 ? gameState.bigBlind : gameState.currentBet + gameState.minRaise
  const maxBet = (me?.stack || 0) + (me?.currentBet || 0)
  
  useEffect(() => {
    setBetAmount(Math.min(minBet, maxBet))
  }, [minBet, maxBet])
  
  if (!isMyTurn || !me || me.folded || me.allIn) {
    return (
      <div className="poker-actions poker-actions--waiting">
        <span className="poker-actions__status">
          {me?.folded ? 'You folded' : me?.allIn ? 'All-in' : 'Waiting for your turn...'}
        </span>
      </div>
    )
  }
  
  const handleBetChange = (value: number) => {
    setBetAmount(Math.max(minBet, Math.min(maxBet, value)))
  }
  
  const setHalfPot = () => handleBetChange(Math.floor(gameState.pot / 2))
  const setPot = () => handleBetChange(gameState.pot)
  const setAllIn = () => handleBetChange(maxBet)
  
  return (
    <div className="poker-actions">
      <div className="poker-actions__buttons">
        <button className="btn-secondary poker-actions__btn poker-actions__btn--fold" onClick={() => onAction('fold')}>
          Fold
        </button>
        
        {canCheck ? (
          <button className="btn-primary poker-actions__btn" onClick={() => onAction('check')}>
            Check
          </button>
        ) : (
          <button className="btn-primary poker-actions__btn" onClick={() => onAction('call')}>
            Call ${Math.min(toCall, me.stack)}
          </button>
        )}
        
        {me.stack > toCall && (
          <button 
            className="btn-primary poker-actions__btn poker-actions__btn--raise" 
            onClick={() => onAction(gameState.currentBet === 0 ? 'bet' : 'raise', betAmount)}
          >
            {gameState.currentBet === 0 ? 'Bet' : 'Raise'} ${betAmount}
          </button>
        )}
      </div>
      
      {me.stack > toCall && (
        <div className="poker-actions__slider">
          <div className="poker-actions__presets">
            <button className="btn-secondary" onClick={setHalfPot}>½ Pot</button>
            <button className="btn-secondary" onClick={setPot}>Pot</button>
            <button className="btn-secondary" onClick={setAllIn}>All-in</button>
          </div>
          <input 
            type="range" 
            min={minBet} 
            max={maxBet} 
            value={betAmount}
            onChange={e => handleBetChange(parseInt(e.target.value))}
            className="poker-actions__range"
          />
          <input 
            type="number" 
            min={minBet} 
            max={maxBet} 
            value={betAmount}
            onChange={e => handleBetChange(parseInt(e.target.value) || minBet)}
            className="poker-actions__input"
          />
        </div>
      )}
    </div>
  )
}

// ── Main Poker page ────────────────────────────────────────────────

function Poker() {
  const [searchParams] = useSearchParams()
  const lobbyCode = searchParams.get('lobby') || ''
  const { isLoggedIn, user, loading: authLoading } = useAuth()
  
  const [gameState, setGameState] = useState<ClientGameState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
  const [maxTime, setMaxTime] = useState(30)
  
  const timerRef = useRef<number | null>(null)

  // Showdown delay
  const showdownLockRef = useRef(false)
  const pendingStateRef = useRef<ClientGameState | null>(null)
  const showdownTimeoutRef = useRef<number | null>(null)

  // ── Version tracking for synchronization ──────────────────────
  const lastVersionRef = useRef<number>(0)
  const resyncingRef = useRef(false)
  
  /**
   * Apply a new game state only if its version is newer than what we have.
   * If a version gap is detected, request a full resync.
   */
  const applyState = useCallback((incoming: ClientGameState) => {
    const incomingVersion = incoming.version ?? 0
    const lastVersion = lastVersionRef.current

    // Ignore stale states
    if (incomingVersion > 0 && lastVersion > 0 && incomingVersion <= lastVersion) {
      if (IS_DEV) console.log(`[poker:sync] Ignored stale state v${incomingVersion} <= v${lastVersion}`)
      return
    }

    // Detect version gap → request full resync
    if (incomingVersion > lastVersion + 1 && lastVersion > 0 && !resyncingRef.current) {
      if (IS_DEV) console.warn(`[poker:sync] Version gap detected: v${lastVersion} → v${incomingVersion}, requesting resync`)
      resyncingRef.current = true
      pokerSocket.requestFullState(incoming.lobbyCode).then(res => {
        resyncingRef.current = false
        if (res.success && res.gameState) {
          const patched = patchPlayerStack(res.gameState)
          lastVersionRef.current = patched.version ?? 0
          setGameState(patched)
        }
      }).catch(() => { resyncingRef.current = false })
      // Still apply this state as a fallback (better than nothing)
    }

    lastVersionRef.current = incomingVersion
    const patched = patchPlayerStack(incoming)

    // TTFC logging
    logTTFC()

    setGameState(patched)
  }, [])

  // Connect and join lobby
  useEffect(() => {
    if (!lobbyCode || !isLoggedIn || !user) return
    
    const connect = async () => {
      try {
        await pokerSocket.connect()
        setConnected(true)
        
        const result = await pokerSocket.joinLobby(lobbyCode)
        
        if (result.success && result.gameState) {
          const patched = patchPlayerStack(result.gameState)
          lastVersionRef.current = patched.version ?? 0
          setGameState(patched)
          logTTFC()

          if (patched.showdownResults && patched.winners && patched.winners.length > 0) {
            showdownLockRef.current = true
            if (showdownTimeoutRef.current) clearTimeout(showdownTimeoutRef.current)
            showdownTimeoutRef.current = window.setTimeout(() => {
              showdownLockRef.current = false
              if (pendingStateRef.current) {
                applyState(pendingStateRef.current)
                pendingStateRef.current = null
              }
            }, 5000)
          }
        } else {
          setError(result.error || 'Failed to join lobby')
        }
      } catch (err) {
        setError('Failed to connect to server')
        console.error(err)
      }
    }
    
    connect()
    
    const unsubscribe = pokerSocket.on('gameState', (data) => {
      const incoming = data as ClientGameState

      if (showdownLockRef.current) {
        pendingStateRef.current = incoming
        return
      }

      applyState(incoming)

      if (incoming.showdownResults && incoming.winners && incoming.winners.length > 0) {
        showdownLockRef.current = true
        if (showdownTimeoutRef.current) clearTimeout(showdownTimeoutRef.current)
        showdownTimeoutRef.current = window.setTimeout(() => {
          showdownLockRef.current = false
          if (pendingStateRef.current) {
            applyState(pendingStateRef.current)
            pendingStateRef.current = null
          }
        }, 5000)
      }
    })
    
    const unsubscribeEnd = pokerSocket.on('lobbyEnded', () => {
      setError('Lobby has been closed by the host')
    })

    // On reconnect, rejoin to get fresh state
    const unsubscribeConnect = pokerSocket.on('connect', () => {
      if (lobbyCode) {
        pokerSocket.joinLobby(lobbyCode).then(result => {
          if (result.success && result.gameState) {
            const patched = patchPlayerStack(result.gameState)
            lastVersionRef.current = patched.version ?? 0
            setGameState(patched)
          }
        })
      }
    })
    
    return () => {
      unsubscribe()
      unsubscribeEnd()
      unsubscribeConnect()
      if (timerRef.current) clearInterval(timerRef.current)
      if (showdownTimeoutRef.current) clearTimeout(showdownTimeoutRef.current)
      showdownLockRef.current = false
      pendingStateRef.current = null
    }
  }, [lobbyCode, isLoggedIn, user?.id, applyState])
  
  // Timer countdown
  useEffect(() => {
    if (gameState?.turnTimeRemaining != null && gameState.turnTimeRemaining > 0) {
      const secs = Math.ceil(gameState.turnTimeRemaining / 1000)
      setMaxTime(secs)
      setTimeRemaining(secs)
      
      if (timerRef.current) clearInterval(timerRef.current)
      
      timerRef.current = window.setInterval(() => {
        setTimeRemaining(prev => {
          if (prev === null || prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } else {
      setTimeRemaining(null)
      if (timerRef.current) clearInterval(timerRef.current)
    }
    
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [gameState?.turnTimeRemaining, gameState?.currentPlayerIndex])
  
  const handleAction = useCallback(async (action: PlayerAction, amount?: number) => {
    if (!gameState) return
    
    const result = await pokerSocket.sendAction(
      gameState.lobbyCode,
      action,
      amount
    )
    
    if (!result.success) {
      setError(result.error || result.reason || 'Action failed')
      setTimeout(() => setError(null), 3000)
    }
  }, [gameState])
  
  const handleStartGame = useCallback(async () => {
    if (!gameState) return
    
    const result = await pokerSocket.startGame(gameState.lobbyCode)
    
    if (!result.success) {
      setError(result.error || result.reason || 'Failed to start game')
      setTimeout(() => setError(null), 3000)
    }
  }, [gameState])
  
  const handleEndLobby = useCallback(async () => {
    if (!gameState) return
    
    const result = await pokerSocket.endLobby(gameState.lobbyCode)
    
    if (result.success) {
      window.close()
    } else {
      setError(result.error || result.reason || 'Failed to end lobby')
      setTimeout(() => setError(null), 3000)
    }
  }, [gameState])
  
  const isHost = gameState?.hostId === user?.id

  // ── Best hand evaluation (state-tracked: only upgrade, never downgrade) ──
  // Hooks MUST be above early returns to satisfy Rules of Hooks.
  const me = gameState?.players.find(p => p.playerId === gameState?.myPlayerId) ?? null

  /**
   * Best hand evaluation — always recompute from current state.
   * The handEval.ts getBestHand() now has deterministic tie-breaking,
   * so best5 is stable and doesn't "jump" between equal combos.
   * kickerKeys come directly from the evaluator (only for pair/two-pair/trips/quads).
   */
  const bestHand = useMemo<HandResult | null>(() => {
    if (!gameState || !gameState.gameStarted || gameState.myHoleCards.length !== 2 || me?.folded) return null
    return getBestHand([...gameState.myHoleCards, ...gameState.communityCards])
  }, [gameState?.gameStarted, gameState?.myHoleCards, gameState?.communityCards, me?.folded, gameState?.version])

  const best5Keys = useMemo<Set<string>>(() => {
    if (!bestHand) return new Set()
    return new Set(bestHand.best5.map(c => cardKey(c)))
  }, [bestHand])

  const kickerKeysSet = useMemo<Set<string>>(() => {
    if (!bestHand) return new Set()
    return new Set(bestHand.kickerKeys)
  }, [bestHand])

  // DEV-only debug: print best5 and kicker keys
  if (IS_DEV && bestHand) {
    const b5 = bestHand.best5.map(c => cardKey(c)).join(', ')
    const kk = bestHand.kickerKeys.join(', ')
    console.log(`[poker:dev] hand=${bestHand.name} best5=[${b5}] kickers=[${kk}]`)
  }

  // Auth loading
  if (authLoading) {
    return (
      <div className="poker-page poker-page--standalone">
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
      <div className="poker-page poker-page--standalone">
        <div className="poker-auth-gate">
          <h2>Login Required</h2>
          <p>You must be logged in to join poker lobbies.</p>
          <a href="/profile" className="btn-primary" style={{ textDecoration: 'none' }}>
            Go to Profile to Login
          </a>
        </div>
      </div>
    )
  }
  
  if (error && !gameState) {
    return (
      <div className="poker-page poker-page--standalone">
        <div className="poker-error">
          <h2>Error</h2>
          <p>{error}</p>
          <button className="btn-primary" onClick={() => window.close()}>Close</button>
        </div>
      </div>
    )
  }
  
  if (!connected || !gameState) {
    return (
      <div className="poker-page poker-page--standalone">
        <div className="poker-loading">
          <div className="spinner" />
          <p>Connecting to lobby...</p>
        </div>
      </div>
    )
  }
  
  return (
    <div className="poker-page poker-page--standalone">
      {error && (
        <div className="poker-toast poker-toast--error">
          {error}
        </div>
      )}
      
      <div className="poker-header">
        <div className="poker-header__info">
          <span className="poker-header__code">Lobby: {gameState.lobbyCode}</span>
          <span className="poker-header__hand">Hand #{gameState.handNumber}</span>
          <span className="poker-header__street">{gameState.street.toUpperCase()}</span>
        </div>
        
        {gameState.gameStarted && <HandGuide />}
        
        {timeRemaining !== null && gameState.gameStarted && (
          <div className={`poker-header__timer ${timeRemaining <= 10 ? 'poker-header__timer--warning' : ''}`}>
            <span className="poker-header__timer-value">{timeRemaining}s</span>
            <div className="poker-header__timer-track">
              <div 
                className="poker-header__timer-bar" 
                style={{ width: `${maxTime > 0 ? (timeRemaining / maxTime) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
        
        {isHost && (
          <div className="poker-header__controls">
            {!gameState.gameStarted && gameState.players.length >= 2 && (
              <button className="btn-primary" onClick={handleStartGame}>
                Start Game
              </button>
            )}
            <button className="btn-secondary" onClick={handleEndLobby}>
              End Lobby
            </button>
          </div>
        )}
      </div>
      
      <div className="poker-main">
        <div className="poker-table-wrapper">
          <div className="poker-table">
            <div className="poker-table__felt">
              <div className="poker-table__logo">
                <img src={tableLogo} alt="Bulk Games" />
              </div>
              
              <div className="poker-table__community">
                <AnimatePresence mode="popLayout">
                  {gameState.communityCards.map((card) => {
                    const k = cardKey(card)
                    const hl = best5Keys.has(k)
                    const isK = kickerKeysSet.has(k)
                    return (
                      <motion.div
                        key={k}
                        initial={{ opacity: 0, scale: 0.85, y: 12 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: -8 }}
                        transition={{ duration: 0.22 }}
                        layout
                      >
                        <CardDisplay card={card} highlighted={hl} dimmed={bestHand !== null && !hl} isKicker={hl && isK} />
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
                {Array(5 - gameState.communityCards.length).fill(null).map((_, i) => (
                  <div key={`empty-${i}`} className="poker-card poker-card--empty" />
                ))}
              </div>
              
              <div className="poker-table__pot">
                <span className="poker-table__pot-label">Pot</span>
                <span key={gameState.pot} className="poker-table__pot-amount">${gameState.pot}</span>
              </div>
              
              {gameState.showdownResults && gameState.winners && (
                <div className="poker-showdown">
                  {gameState.showdownResults.filter(r => r.winnings > 0).map((result, i) => {
                    const player = gameState.players.find(p => p.playerId === result.playerId)
                    return (
                      <div key={i} className="poker-showdown__winner">
                        <span className="poker-showdown__name">{player?.nickname}</span>
                        <span className="poker-showdown__hand">{result.hand.name}</span>
                        <span className="poker-showdown__amount">+${result.winnings}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            
            <div className="poker-table__seats">
              {gameState.players.map((player, index) => (
                <PlayerSeat
                  key={player.playerId}
                  player={player}
                  isDealer={index === gameState.dealerIndex}
                  isSmallBlind={index === gameState.smallBlindIndex}
                  isBigBlind={index === gameState.bigBlindIndex}
                  isCurrentTurn={index === gameState.currentPlayerIndex && gameState.gameStarted}
                  isMe={player.playerId === gameState.myPlayerId}
                  isWinner={gameState.winners?.includes(player.playerId) || false}
                  cosmeticClasses={buildCosmeticClasses(player.equippedBorder, player.equippedEffect)}
                />
              ))}
            </div>
          </div>
        </div>
        
        <div className="poker-log">
          <div className="poker-log__title">Action Log</div>
          <div className="poker-log__entries">
            {gameState.showdownResults && gameState.winners && (
              gameState.showdownResults.filter(r => r.winnings > 0).map((result, i) => {
                const winner = gameState.players.find(p => p.playerId === result.playerId)
                return (
                  <div key={`w-${i}`} className="poker-log__entry poker-log__entry--winner">
                    <span className="poker-log__name">{winner?.nickname}</span>
                    <span className="poker-log__action">Winner — {result.hand.name}</span>
                    <span className="poker-log__amount">+${result.winnings}</span>
                  </div>
                )
              })
            )}
            {gameState.actionLog.slice().reverse().map((entry, i) => (
              <div key={i} className="poker-log__entry">
                <span className="poker-log__name">{entry.nickname}</span>
                <span className="poker-log__action">{entry.action}</span>
                {entry.amount && <span className="poker-log__amount">${entry.amount}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {gameState.gameStarted && (
        <div className="poker-bottom-bar">
          {gameState.myHoleCards.length > 0 && (
            <div className="poker-my-cards">
              <AnimatePresence mode="popLayout">
                {gameState.myHoleCards.map((card, i) => {
                  const k = cardKey(card)
                  const hl = best5Keys.has(k)
                  const isK = kickerKeysSet.has(k)
                  return (
                    <motion.div
                      key={k}
                      className="poker-my-cards__animated"
                      initial={{ opacity: 0, scale: 0.85, y: 12 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: -8 }}
                      transition={{ duration: 0.22, delay: i * 0.08 }}
                      whileHover={{ scale: 1.18, y: -22, zIndex: 10 }}
                      style={{ position: 'relative', zIndex: i }}
                    >
                      <CardDisplay card={card} highlighted={hl} dimmed={bestHand !== null && !hl} isKicker={hl && isK} />
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          )}
          {bestHand && (
            <div className="poker-hand-label">{bestHand.name}</div>
          )}
          <ActionPanel gameState={gameState} onAction={handleAction} />
        </div>
      )}
      
      {!gameState.gameStarted && (
        <div className="poker-waiting">
          <h3>Waiting for game to start...</h3>
          <p>{gameState.players.length} player{gameState.players.length !== 1 ? 's' : ''} in lobby</p>
          <div className="poker-waiting__players">
            {gameState.players.map(p => (
              <div key={p.playerId} className="poker-waiting__player">
                <div className="poker-waiting__avatar">
                  {p.avatarUrl ? <img src={p.avatarUrl} alt={p.nickname} /> : '👤'}
                </div>
                <span>{p.nickname}</span>
                {p.playerId === gameState.hostId && <span className="poker-waiting__host">Host</span>}
              </div>
            ))}
          </div>
          {!isHost && <p className="muted">Waiting for host to start the game...</p>}
        </div>
      )}
    </div>
  )
}

export default Poker
