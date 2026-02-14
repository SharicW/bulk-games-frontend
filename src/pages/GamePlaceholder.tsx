import { useNavigate } from 'react-router-dom'

interface GamePlaceholderProps {
  game: string
}

function GamePlaceholder({ game }: GamePlaceholderProps) {
  const navigate = useNavigate()

  return (
    <div className="page-shell">
      <div className="page-header">
        <p className="eyebrow">Game</p>
        <h1>{game}</h1>
      </div>

      <div className="card" style={{ 
        marginTop: '16px', 
        textAlign: 'center', 
        padding: '64px 24px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '24px'
      }}>
        <div style={{ fontSize: '64px' }}>
          {game === 'Poker' ? '🃏' : '🎴'}
        </div>
        <div>
          <h2 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '8px' }}>Coming Soon</h2>
          <p style={{ color: 'var(--color-text-muted)' }}>
            {game} is currently under development. Check back later!
          </p>
        </div>
        <button 
          className="btn-secondary" 
          onClick={() => navigate('/main-menu')}
          style={{ maxWidth: '200px' }}
        >
          Back to Menu
        </button>
      </div>
    </div>
  )
}

export default GamePlaceholder
