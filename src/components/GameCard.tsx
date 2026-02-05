import { Role } from '../hooks/useRole'

interface GameCardProps {
  name: string
  icon: string
  role: Role
  onJoin: () => void
  onCreate: () => void
}

function GameCard({ name, icon, role, onJoin, onCreate }: GameCardProps) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontSize: '32px' }}>{icon}</span>
        <h3 style={{ fontSize: '20px', fontWeight: 600, margin: 0 }}>{name}</h3>
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
        {role === 'host' && (
          <button className="btn-primary" onClick={onCreate}>
            Create Lobby
          </button>
        )}
        <button className="btn-secondary" onClick={onJoin}>
          Join Lobby
        </button>
      </div>
    </div>
  )
}

export default GameCard
