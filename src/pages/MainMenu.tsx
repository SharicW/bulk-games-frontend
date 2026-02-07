import { useState } from 'react'
import { useRole } from '../hooks/useRole'
import { useAuth } from '../hooks/useAuth'
import GameCard from '../components/GameCard'
import Modal from '../components/Modal'
import { pokerSocket, unoSocket } from '../services/socket'

const STORAGE_KEY = 'bulk_games_auth'
const USER_ID_KEY = 'bulk_games_user_id'

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

function MainMenu() {
  const { role, toggleRole } = useRole()
  const { isLoggedIn } = useAuth()
  
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
      const odotuid = getOrCreateUserId()
      const profile = getUserProfile()

      if (game === 'poker') {
        await pokerSocket.connect()
        const result = await pokerSocket.createLobby(odotuid, profile.nickname, profile.avatarUrl)
        
        if (result.success && result.code) {
          setCreatedCode(result.code)
          setCreateModalOpen(true)
        } else {
          setError(result.error || 'Failed to create lobby')
        }
      } else {
        await unoSocket.connect()
        const result = await unoSocket.createLobby(odotuid, profile.nickname, profile.avatarUrl)

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
      const odotuid = getOrCreateUserId()
      const profile = getUserProfile()

      if (currentGame === 'poker') {
        await pokerSocket.connect()
        
        const result = await pokerSocket.joinLobby(
          joinCode.toUpperCase(),
          odotuid,
          profile.nickname,
          profile.avatarUrl
        )
        
        if (result.success) {
          setJoinModalOpen(false)
          // Open in new tab
          window.open(`/game/poker?lobby=${joinCode.toUpperCase()}`, '_blank')
        } else {
          setError(result.error || 'Failed to join lobby')
        }
      } else {
        await unoSocket.connect()
        const code = joinCode.toUpperCase()

        const result = await unoSocket.joinLobby(
          code,
          odotuid,
          profile.nickname,
          profile.avatarUrl,
        )

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
    // Open in new tab
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
          <button
            onClick={toggleRole}
            className="btn-secondary"
            style={{ padding: '8px 14px', minWidth: '80px', fontSize: '13px' }}
          >
            {role === 'host' ? 'Host' : 'Player'}
          </button>
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
            placeholder="Enter 6-character code"
            maxLength={6}
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
