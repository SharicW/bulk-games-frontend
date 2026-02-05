import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

export interface User {
  email: string
  nickname: string
  avatarUrl: string | null
  passwordHash: string // простое хеширование для localStorage
}

interface AuthState {
  isLoggedIn: boolean
  user: User | null
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  register: (email: string, password: string, nickname: string) => Promise<{ success: boolean; error?: string }>
  logout: () => void
  updateNickname: (nickname: string) => void
  updateAvatar: (avatarUrl: string | null) => void
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
}

const STORAGE_KEY = 'bulk_games_auth'
const USERS_STORAGE_KEY = 'bulk_games_users'

const defaultState: AuthState = {
  isLoggedIn: false,
  user: null,
}

// Простое хеширование для демо (в реальном приложении использовать bcrypt на сервере)
function simpleHash(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash.toString(36)
}

function getStoredUsers(): User[] {
  if (typeof window === 'undefined') return []
  const stored = localStorage.getItem(USERS_STORAGE_KEY)
  if (stored) {
    try {
      return JSON.parse(stored) as User[]
    } catch {
      return []
    }
  }
  return []
}

function saveUsers(users: User[]): void {
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users))
}

function getInitialState(): AuthState {
  if (typeof window === 'undefined') {
    return defaultState
  }

  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      return JSON.parse(stored) as AuthState
    } catch {
      return defaultState
    }
  }

  return defaultState
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => getInitialState())

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const register = useCallback(async (email: string, password: string, nickname: string): Promise<{ success: boolean; error?: string }> => {
    const users = getStoredUsers()
    
    // Проверяем существует ли пользователь
    const existingUser = users.find(u => u.email.toLowerCase() === email.toLowerCase())
    if (existingUser) {
      return { success: false, error: 'User with this email already exists' }
    }
    
    // Валидация
    if (!email || !email.includes('@')) {
      return { success: false, error: 'Please enter a valid email' }
    }
    
    if (password.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters' }
    }
    
    if (!nickname.trim()) {
      return { success: false, error: 'Please enter a nickname' }
    }
    
    // Создаём пользователя
    const newUser: User = {
      email: email.toLowerCase(),
      nickname: nickname.trim(),
      avatarUrl: null,
      passwordHash: simpleHash(password)
    }
    
    users.push(newUser)
    saveUsers(users)
    
    // Авторизуем
    setState({ isLoggedIn: true, user: newUser })
    
    return { success: true }
  }, [])

  const login = useCallback(async (email: string, password: string): Promise<{ success: boolean; error?: string }> => {
    const users = getStoredUsers()
    
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase())
    if (!user) {
      return { success: false, error: 'User not found' }
    }
    
    if (user.passwordHash !== simpleHash(password)) {
      return { success: false, error: 'Incorrect password' }
    }
    
    setState({ isLoggedIn: true, user })
    
    return { success: true }
  }, [])

  const logout = useCallback(() => {
    setState({ isLoggedIn: false, user: null })
  }, [])

  const updateNickname = useCallback((nickname: string) => {
    setState(prev => {
      if (!prev.user) return prev
      
      // Обновляем в списке пользователей
      const users = getStoredUsers()
      const userIndex = users.findIndex(u => u.email === prev.user?.email)
      if (userIndex !== -1) {
        users[userIndex].nickname = nickname
        saveUsers(users)
      }
      
      return {
        ...prev,
        user: { ...prev.user, nickname },
      }
    })
  }, [])

  const updateAvatar = useCallback((avatarUrl: string | null) => {
    setState(prev => {
      if (!prev.user) return prev
      
      // Обновляем в списке пользователей
      const users = getStoredUsers()
      const userIndex = users.findIndex(u => u.email === prev.user?.email)
      if (userIndex !== -1) {
        users[userIndex].avatarUrl = avatarUrl
        saveUsers(users)
      }
      
      return {
        ...prev,
        user: { ...prev.user, avatarUrl },
      }
    })
  }, [])

  const changePassword = useCallback(async (oldPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> => {
    const users = getStoredUsers()
    const currentUser = state.user
    
    if (!currentUser) {
      return { success: false, error: 'Not logged in' }
    }
    
    const userIndex = users.findIndex(u => u.email === currentUser.email)
    if (userIndex === -1) {
      return { success: false, error: 'User not found' }
    }
    
    if (users[userIndex].passwordHash !== simpleHash(oldPassword)) {
      return { success: false, error: 'Current password is incorrect' }
    }
    
    if (newPassword.length < 6) {
      return { success: false, error: 'New password must be at least 6 characters' }
    }
    
    users[userIndex].passwordHash = simpleHash(newPassword)
    saveUsers(users)
    
    setState(prev => ({
      ...prev,
      user: prev.user ? { ...prev.user, passwordHash: simpleHash(newPassword) } : null
    }))
    
    return { success: true }
  }, [state.user])

  const value = useMemo(
    () => ({
      ...state,
      login,
      register,
      logout,
      updateNickname,
      updateAvatar,
      changePassword,
    }),
    [state, login, register, logout, updateNickname, updateAvatar, changePassword],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Stub for future API
export async function fetchCurrentUser(): Promise<User | null> {
  return null
}
