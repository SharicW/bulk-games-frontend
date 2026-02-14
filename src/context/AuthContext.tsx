import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import {
  apiRegister,
  apiLogin,
  apiLogout,
  apiGetMe,
  apiUpdateMe,
  getToken,
  setToken,
  type ApiUser,
} from '../services/api'

/* ── Types ──────────────────────────────────────────────────────── */

export interface User {
  id: string
  email: string
  nickname: string
  avatarUrl: string | null
  role: 'host' | 'player'
  coins: number
  equippedBorder: string | null
  equippedEffect: string | null
  inventory: string[]
}

interface AuthState {
  isLoggedIn: boolean
  user: User | null
  loading: boolean
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  register: (email: string, password: string, nickname: string) => Promise<{ success: boolean; error?: string }>
  logout: () => void
  updateNickname: (nickname: string) => Promise<void>
  updateAvatar: (avatarUrl: string | null) => Promise<void>
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
  refreshUser: () => Promise<void>
}

const defaultState: AuthState = {
  isLoggedIn: false,
  user: null,
  loading: true,
}

function toUser(u: ApiUser): User {
  return {
    id: u.id,
    email: u.email,
    nickname: u.nickname,
    avatarUrl: u.avatarUrl,
    role: u.role,
    coins: u.coins ?? 0,
    equippedBorder: u.equippedBorder ?? null,
    equippedEffect: u.equippedEffect ?? null,
    inventory: u.inventory ?? [],
  }
}

/* ── Context ────────────────────────────────────────────────────── */

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    // optimistic: if token exists assume logged in (will verify via /me)
    const token = getToken()
    return token ? { ...defaultState, loading: true } : { ...defaultState, loading: false }
  })

  // On mount — verify stored token
  useEffect(() => {
    const token = getToken()
    if (!token) {
      setState({ isLoggedIn: false, user: null, loading: false })
      return
    }

    let cancelled = false
    apiGetMe()
      .then(data => {
        if (cancelled) return
        setState({ isLoggedIn: true, user: toUser(data), loading: false })
      })
      .catch(() => {
        if (cancelled) return
        setToken(null)
        setState({ isLoggedIn: false, user: null, loading: false })
      })

    return () => { cancelled = true }
  }, [])

  /* ── Auth actions ────────────────────────────────────────────── */

  const register = useCallback(async (email: string, password: string, nickname: string) => {
    try {
      const res = await apiRegister(email, password, nickname)
      if (res.success && res.token && res.user) {
        setToken(res.token)
        setState({ isLoggedIn: true, user: toUser(res.user), loading: false })
        return { success: true }
      }
      return { success: false, error: res.error || 'Registration failed' }
    } catch {
      return { success: false, error: 'Something went wrong' }
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    try {
      const res = await apiLogin(email, password)
      if (res.success && res.token && res.user) {
        setToken(res.token)
        setState({ isLoggedIn: true, user: toUser(res.user), loading: false })
        return { success: true }
      }
      return { success: false, error: res.error || 'Login failed' }
    } catch {
      return { success: false, error: 'Something went wrong' }
    }
  }, [])

  const logout = useCallback(async () => {
    await apiLogout()
    setState({ isLoggedIn: false, user: null, loading: false })
  }, [])

  /* ── Profile actions ─────────────────────────────────────────── */

  const updateNickname = useCallback(async (nickname: string) => {
    const res = await apiUpdateMe({ nickname })
    if (res.success && res.user) {
      setState(prev => ({ ...prev, user: toUser(res.user!) }))
    }
  }, [])

  const updateAvatar = useCallback(async (avatarUrl: string | null) => {
    const res = await apiUpdateMe({ avatarUrl })
    if (res.success && res.user) {
      setState(prev => ({ ...prev, user: toUser(res.user!) }))
    }
  }, [])

  const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
    try {
      const res = await apiUpdateMe({ oldPassword, newPassword })
      if (res.success) return { success: true }
      return { success: false, error: res.error || 'Failed to change password' }
    } catch {
      return { success: false, error: 'Something went wrong' }
    }
  }, [])

  const refreshUser = useCallback(async () => {
    try {
      const data = await apiGetMe()
      setState(prev => ({ ...prev, user: toUser(data) }))
    } catch { /* ignore */ }
  }, [])

  const value = useMemo(
    () => ({
      ...state,
      login,
      register,
      logout,
      updateNickname,
      updateAvatar,
      changePassword,
      refreshUser,
    }),
    [state, login, register, logout, updateNickname, updateAvatar, changePassword, refreshUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
