import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { pokerSocket } from '../services/socket'
import { getCardImageUrl, formatCard, getSuitColor } from '../utils/cards'
import type { ClientGameState, ClientPlayer, Card, PlayerAction } from '../types/poker'
import { getBestHand, isCardInHand } from '../utils/handEval'
import tableLogo from '/assets/BULK_GAMES_LOGO.png'

const STORAGE_KEY = 'bulk_games_auth'
const USER_ID_KEY = 'bulk_games_user_id'
const STACK_STORAGE_PREFIX = 'poker_stack_'

function getOrCreateUserId(): string {
  let odotuid = localStorage.getItem(USER_ID_KEY)
  if (!odotuid) {
    odotuid = 'user_' + Math.random().toString(36).substring(2, 15)
    localStorage.setItem(USER_ID_KEY, odotuid)
  }
  return odotuid
}

function getUserProfile(): { nickname: string; avatarUrl: string | null } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const auth = JSON.parse(stored)
      if (auth.user) {
        return {
          nickname: auth.user.nickname || 'Player',
          avatarUrl: auth.user.avatarUrl || null
        }
      }
    }
  } catch {
    // ignore
  }
  return { nickname: 'Player', avatarUrl: null }
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

/**
 * Patch the local player's stack using localStorage to survive reconnects.
 * Rules:
 *  - Server sends non-1000 → authoritative, save it.
 *  - Server sends 1000 + we have a stored value → use stored (never overwrite with default).
 *  - Server sends 1000 + no stored value → first join, save 1000 as default.
 */
function patchPlayerStack(gs: ClientGameState): ClientGameState {
  const meIdx = gs.players.findIndex(p => p.playerId === gs.myPlayerId)
  if (meIdx === -1) return gs

  const me = gs.players[meIdx]
  const stored = getStoredStack(gs.lobbyCode, gs.myPlayerId)

  if (me.stack !== 1000) {
    // Non-default: authoritative value from server, persist it
    saveStack(gs.lobbyCode, gs.myPlayerId, me.stack)
    return gs
  }

  if (stored !== null) {
    // Server sent default 1000 but we have a real stored value — restore it
    const players = [...gs.players]
    players[meIdx] = { ...me, stack: stored }
    return { ...gs, players }
  }

  // First time joining this lobby (no stored value), save the default
  saveStack(gs.lobbyCode, gs.myPlayerId, 1000)
  return gs
}

// ── Card component ─────────────────────────────────────────────────

function CardDisplay({ card, isHidden = false, highlighted = false }: { card: Card | null; isHidden?: boolean; highlighted?: boolean }) {
  if (!card || isHidden) {
    return (
      <div className="poker-card poker-card--back">
        <div className="poker-card__pattern" />
      </div>
    )
  }

  const imageUrl = getCardImageUrl(card)
  
  return (
    <div className={`poker-card${highlighted ? ' poker-card--highlighted' : ''}`}>
      {imageUrl ? (
        <img src={imageUrl} alt={formatCard(card)} className="poker-card__image" loading="lazy" decoding="async" />
      ) : (
        <div className="poker-card__fallback" style={{ color: getSuitColor(card.suit) }}>
          <span className="poker-card__rank">{card.rank}</span>
          <span className="poker-card__suit">
            {card.suit === 'hearts' ? '♥' : card.suit === 'diamonds' ? '♦' : card.suit === 'clubs' ? '♣' : '♠'}
          </span>
        </div>
      )}
    </div>
  )
}

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
  showCards
}: { 
  player: ClientPlayer
  isDealer: boolean
  isSmallBlind: boolean
  isBigBlind: boolean
  isCurrentTurn: boolean
  isMe: boolean
  isWinner: boolean
  showCards: boolean
}) {
  const positionMarker = isDealer ? 'D' : isSmallBlind ? 'SB' : isBigBlind ? 'BB' : null
  
  return (
    <div className={`poker-seat ${player.folded ? 'poker-seat--folded' : ''} ${isCurrentTurn ? 'poker-seat--active' : ''} ${isMe ? 'poker-seat--me' : ''} ${isWinner ? 'poker-seat--winner' : ''} ${!player.isConnected ? 'poker-seat--disconnected' : ''}`}>
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
      
      <div className="poker-seat__cards">
        {player.holeCards && showCards ? (
          <>
            <CardDisplay card={player.holeCards[0]} />
            <CardDisplay card={player.holeCards[1]} />
          </>
        ) : !player.folded && (
          <>
            <CardDisplay card={null} isHidden={true} />
            <CardDisplay card={null} isHidden={true} />
          </>
        )}
      </div>
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
  const { isLoggedIn } = useAuth()
  
  const [gameState, setGameState] = useState<ClientGameState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null)
  const [maxTime, setMaxTime] = useState(30)
  
  const userIdRef = useRef(getOrCreateUserId())
  const profileRef = useRef(getUserProfile())
  const timerRef = useRef<number | null>(null)
  
  // Connect and join lobby
  useEffect(() => {
    if (!lobbyCode || !isLoggedIn) {
      if (!lobbyCode && isLoggedIn) setError('No lobby code provided')
      return
    }
    
    const connect = async () => {
      try {
        await pokerSocket.connect()
        setConnected(true)
        
        const result = await pokerSocket.joinLobby(
          lobbyCode,
          userIdRef.current,
          profileRef.current.nickname,
          profileRef.current.avatarUrl
        )
        
        if (result.success && result.gameState) {
          setGameState(patchPlayerStack(result.gameState))
        } else {
          setError(result.error || 'Failed to join lobby')
        }
      } catch (err) {
        setError('Failed to connect to server')
        console.error(err)
      }
    }
    
    connect()
    
    // Listen for game state updates — patch stack on every update
    const unsubscribe = pokerSocket.on('gameState', (data) => {
      setGameState(patchPlayerStack(data as ClientGameState))
    })
    
    const unsubscribeEnd = pokerSocket.on('lobbyEnded', () => {
      setError('Lobby has been closed by the host')
    })
    
    return () => {
      unsubscribe()
      unsubscribeEnd()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [lobbyCode, isLoggedIn])
  
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
      userIdRef.current,
      action,
      amount
    )
    
    if (!result.success) {
      setError(result.error || 'Action failed')
      setTimeout(() => setError(null), 3000)
    }
  }, [gameState])
  
  const handleStartGame = useCallback(async () => {
    if (!gameState) return
    
    const result = await pokerSocket.startGame(gameState.lobbyCode, userIdRef.current)
    
    if (!result.success) {
      setError(result.error || 'Failed to start game')
      setTimeout(() => setError(null), 3000)
    }
  }, [gameState])
  
  const handleEndLobby = useCallback(async () => {
    if (!gameState) return
    
    const result = await pokerSocket.endLobby(gameState.lobbyCode, userIdRef.current)
    
    if (result.success) {
      window.close()
    } else {
      setError(result.error || 'Failed to end lobby')
      setTimeout(() => setError(null), 3000)
    }
  }, [gameState])
  
  const isHost = gameState?.hostId === userIdRef.current

  // Auth gate — block unauthenticated users
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
  
  // ── Best hand evaluation (only for local player, only with 5+ cards) ──
  const me = gameState.players.find(p => p.playerId === gameState.myPlayerId)
  const bestHand = (
    gameState.gameStarted &&
    gameState.myHoleCards.length === 2 &&
    gameState.communityCards.length >= 3 &&
    !me?.folded
  )
    ? getBestHand(gameState.myHoleCards, gameState.communityCards)
    : null
  
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
              {/* Center Logo */}
              <div className="poker-table__logo">
                <img src={tableLogo} alt="Bulk Games" />
              </div>
              
              {/* Community cards — highlight only if card is in the best 5 */}
              <div className="poker-table__community">
                {gameState.communityCards.map((card, i) => (
                  <CardDisplay key={`${card.rank}_${card.suit}`} card={card} highlighted={isCardInHand(card, bestHand)} />
                ))}
                {/* Empty placeholders */}
                {Array(5 - gameState.communityCards.length).fill(null).map((_, i) => (
                  <div key={`empty-${i}`} className="poker-card poker-card--empty" />
                ))}
              </div>
              
              {/* Pot */}
              <div className="poker-table__pot">
                <span className="poker-table__pot-label">Pot</span>
                <span key={gameState.pot} className="poker-table__pot-amount">${gameState.pot}</span>
              </div>
              
              {/* Showdown results */}
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
            
            {/* Player seats */}
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
                  showCards={player.playerId === gameState.myPlayerId || (gameState.street === 'showdown' && !player.folded)}
                />
              ))}
            </div>
          </div>
        </div>
        
        {/* Action log */}
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
      
      {/* Fixed bottom bar: hole cards + action panel */}
      {gameState.gameStarted && (
        <div className="poker-bottom-bar">
          {gameState.myHoleCards.length > 0 && (
            <div className="poker-my-cards">
              <CardDisplay card={gameState.myHoleCards[0]} highlighted={isCardInHand(gameState.myHoleCards[0], bestHand)} />
              <CardDisplay card={gameState.myHoleCards[1]} highlighted={isCardInHand(gameState.myHoleCards[1], bestHand)} />
            </div>
          )}
          {bestHand && (
            <div className="poker-hand-label">{bestHand.name}</div>
          )}
          <ActionPanel gameState={gameState} onAction={handleAction} />
        </div>
      )}
      
      {/* Waiting room */}
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
