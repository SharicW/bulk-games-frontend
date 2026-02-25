import { useContext } from 'react'
import { AuthContext } from '../context/AuthContext'

export type Role = 'host' | 'player'

export function useRole() {
  const ctx = useContext(AuthContext)
  const role: Role = ctx?.user?.role ?? 'player'

  return { role }
}
