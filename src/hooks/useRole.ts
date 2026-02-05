import { useState, useEffect, useCallback } from 'react'

export type Role = 'host' | 'player'

const STORAGE_KEY = 'bulk_games_role'

export function useRole() {
  const [role, setRoleState] = useState<Role>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return (stored as Role) || 'player'
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, role)
  }, [role])

  const setRole = useCallback((newRole: Role) => {
    setRoleState(newRole)
  }, [])

  const toggleRole = useCallback(() => {
    setRoleState(prev => prev === 'host' ? 'player' : 'host')
  }, [])

  return { role, setRole, toggleRole }
}

// For future API integration
export async function fetchUserRole(): Promise<Role> {
  // Will call /api/me and extract role in the future
  return 'player'
}
