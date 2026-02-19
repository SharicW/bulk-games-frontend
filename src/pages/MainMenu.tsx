import { useEffect, useMemo, useState } from 'react'
import { useRole } from '../hooks/useRole'
import { useAuth } from '../hooks/useAuth'
import GameCard from '../components/GameCard'
import Modal from '../components/Modal'
import { pokerSocket, unoSocket } from '../services/socket'
import { apiListPublicRooms, type PublicRoomInfo } from '../services/api'

function MainMenu() {
  const { role } = useRole()
  const { isLoggedIn } = useAuth()

  const [publicRooms, setPublicRooms] = useState<PublicRoomInfo[]>([])
  const roomsByKey = useMemo(() => {
    const m = new Map<string, PublicRoomInfo>()
    for (const r of publicRooms) m.set(`${r.gameType}:${r.code}`, r)
    return m
  }, [publicRooms])

  useEffect(() => {
    if (!isLoggedIn) return
    let stopped = false
    const load = async () => {
      try {
        const res = await apiListPublicRooms()
        if (!stopped) setPublicRooms(res.rooms || [])
      } catch {
        if (!stopped) setPublicRooms([])
      }
    }
    load()
    const t = window.setInterval(load, 3500)
    return () => { stopped = true; window.clearInterval(t) }
  }, [isLoggedIn])
  
  const [joinModalOpen, setJoinModalOpen] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [currentGame, setCurrentGame] = useState<'poker' | 'uno'>('poker')
  const [joinCode, setJoinCode] = useState('')
  const [createdCode, setCreatedCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleJoinClick = (game: 'poker' | 'uno') => {
    setCurrentGame(game)
    setJoinCode('')
    setError(null)
    setJoinModalOpen(true)
  }

  const handleCreateClick = async (game: 'poker' | 'uno') => {
    setCurrentGame(game)
    setError(null)
    setLoading(true)
    
    try {
      if (game === 'poker') {
        await pokerSocket.connect()
        const result = await pokerSocket.createLobby()
        
        if (result.success && result.code) {
          setCreatedCode(result.code)
          setCreateModalOpen(true)
        } else {
          setError(result.error || 'Failed to create lobby')
        }
      } else {
        await unoSocket.connect()
        const result = await unoSocket.createLobby()

        if (result.success && result.code) {
          setCreatedCode(result.code)
          setCreateModalOpen(true)
        } else {
          setError(result.error || 'Failed to create lobby')
        }
      }
    } catch (err) {
      setError('Failed to connect to server')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleJoinSubmit = async () => {
    if (joinCode.trim().length === 0) return
    
    setLoading(true)
    setError(null)
    
    try {
      if (currentGame === 'poker') {
        await pokerSocket.connect()
        
        const result = await pokerSocket.joinLobby(joinCode.toUpperCase())
        
        if (result.success) {
          setJoinModalOpen(false)
          window.open(`/game/poker?lobby=${joinCode.toUpperCase()}`, '_blank')
        } else {
          setError(result.error || 'Failed to join lobby')
        }
      } else {
        await unoSocket.connect()
        const code = joinCode.toUpperCase()

        const result = await unoSocket.joinLobby(code)

        if (result.success) {
          setJoinModalOpen(false)
          window.open(`/game/uno?lobby=${code}`, '_blank')
        } else {
          setError(result.error || 'Failed to join lobby')
        }
      }
    } catch (err) {
      setError('Failed to connect to server')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreateConfirm = () => {
    setCreateModalOpen(false)
    if (!createdCode) return
    window.open(`/game/${currentGame}?lobby=${createdCode}`, '_blank')
  }

  return (
    <div className="page-shell">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div className="page-header">
          <p className="eyebrow">Games</p>
          <h1>Main Menu</h1>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="muted" style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Role:</span>
          <span
            style={{
              padding: '8px 14px',
              minWidth: '80px',
              fontSize: '13px',
              textAlign: 'center',
              borderRadius: 'var(--radius-md, 8px)',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid var(--color-border, rgba(255,255,255,0.1))',
              color: role === 'host' ? '#fbbf24' : '#94a3b8',
              fontWeight: 600,
            }}
          >
            {role === 'host' ? 'Host' : 'Player'}
          </span>
        </div>
      </div>

      {!isLoggedIn && (
        <div className="auth-gate-banner">
          <p>You must be logged in to create or join lobbies.</p>
          <a href="/profile" className="btn-primary" style={{ textDecoration: 'none', width: 'auto', padding: '8px 20px' }}>
            Go to Profile to Login
          </a>
        </div>
      )}

      {/* Public rooms */}
      {isLoggedIn && (
        <div className="card" style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div className="eyebrow">Quick Play</div>
              <div style={{ fontSize: '18px', fontWeight: 700 }}>Public Rooms</div>
              <div className="muted" style={{ marginTop: '4px' }}>3 rooms per game, always online</div>
            </div>
          </div>

          <div className="card-grid" style={{ marginTop: '14px' }}>
            {(['POKER_PUBLIC_1', 'POKER_PUBLIC_2', 'POKER_PUBLIC_3'] as const).map((code, i) => {
              const r = roomsByKey.get(`poker:${code}`)
              const inGame = r?.status === 'in_game'
              return (
                <div key={code} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 800 }}>Poker Room {i + 1}</div>
                    <div className="muted" style={{ fontSize: '12px' }}>
                      {r ? `${r.playerCount}/${r.maxPlayers}` : '-'}
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: '13px' }}>
                    Status: {inGame ? '🔴 In game' : '🟢 Lobby'}
                  </div>
                  <button
                    className={inGame ? 'btn-secondary' : 'btn-primary'}
                    onClick={() => window.open(`/game/poker?lobby=${code}`, '_blank')}
                    style={{ width: 'auto', padding: '10px 14px' }}
                  >
                    {inGame ? '👁 Spectate' : 'Join'}
                  </button>
                </div>
              )
            })}

            {(['UNO_PUBLIC_1', 'UNO_PUBLIC_2', 'UNO_PUBLIC_3'] as const).map((code, i) => {
              const r = roomsByKey.get(`uno:${code}`)
              const inGame = r?.status === 'in_game'
              return (
                <div key={code} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 800 }}>UNO Room {i + 1}</div>
                    <div className="muted" style={{ fontSize: '12px' }}>
                      {r ? `${r.playerCount}/${r.maxPlayers}` : '-'}
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: '13px' }}>
                    Status: {inGame ? '🔴 In game' : '🟢 Lobby'}
                  </div>
                  <button
                    className={inGame ? 'btn-secondary' : 'btn-primary'}
                    onClick={() => window.open(`/game/uno?lobby=${code}`, '_blank')}
                    style={{ width: 'auto', padding: '10px 14px' }}
                  >
                    {inGame ? '👁 Spectate' : 'Join'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="card-grid" style={{ marginTop: '16px' }}>
        <GameCard
          name="Poker"
          icon="🃏"
          role={role}
          onJoin={() => handleJoinClick('poker')}
          onCreate={() => handleCreateClick('poker')}
          disabled={!isLoggedIn}
        />
        <GameCard
          name="UNO"
          icon="🎴"
          role={role}
          onJoin={() => handleJoinClick('uno')}
          onCreate={() => handleCreateClick('uno')}
          disabled={!isLoggedIn}
        />
      </div>

      <Modal
        isOpen={joinModalOpen}
        onClose={() => setJoinModalOpen(false)}
        title={`Join ${currentGame === 'poker' ? 'Poker' : 'UNO'} Lobby`}
      >
        <div className="form-group">
          <label>Lobby Code</label>
          <input
            type="text"
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Enter lobby code"
            maxLength={32}
            disabled={loading}
          />
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions">
          <button 
            className="btn-primary" 
            onClick={handleJoinSubmit} 
            disabled={joinCode.trim().length === 0 || loading}
          >
            {loading ? 'Joining...' : 'Join Game'}
          </button>
          <button className="btn-secondary" onClick={() => setJoinModalOpen(false)}>
            Cancel
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title={`${currentGame === 'poker' ? 'Poker' : 'UNO'} Lobby Created`}
      >
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <p className="muted" style={{ marginBottom: '12px' }}>Share this code with other players:</p>
          <div style={{
            fontSize: '32px',
            fontWeight: 700,
            letterSpacing: '4px',
            padding: '16px',
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
          }}>
            {createdCode}
          </div>
        </div>
        {error && <p className="field-error" style={{ textAlign: 'center' }}>{error}</p>}
        <div className="form-actions">
          <button 
            className="btn-primary" 
            onClick={handleCreateConfirm}
            disabled={!createdCode}
          >
            Enter Lobby
          </button>
          <button className="btn-secondary" onClick={() => setCreateModalOpen(false)}>
            Cancel
          </button>
        </div>
      </Modal>
    </div>
  )
}

export default MainMenu
