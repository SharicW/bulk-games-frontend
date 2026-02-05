import { useEffect, useState, useRef, ChangeEvent } from 'react'
import { useAuth } from '../hooks/useAuth'

type AuthMode = 'login' | 'register'

function Profile() {
  const { isLoggedIn, user, login, register, logout, updateNickname, updateAvatar, changePassword } = useAuth()
  
  // Auth form state
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authConfirmPassword, setAuthConfirmPassword] = useState('')
  const [authNickname, setAuthNickname] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  
  // Profile form state
  const [nickname, setNickname] = useState(user?.nickname || '')
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user?.avatarUrl || null)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    setAuthLoading(true)
    
    try {
      if (authMode === 'register') {
        if (authPassword !== authConfirmPassword) {
          setAuthError('Passwords do not match')
          setAuthLoading(false)
          return
        }
        
        const result = await register(authEmail, authPassword, authNickname)
        if (!result.success) {
          setAuthError(result.error || 'Registration failed')
        }
      } else {
        const result = await login(authEmail, authPassword)
        if (!result.success) {
          setAuthError(result.error || 'Login failed')
        }
      }
    } catch {
      setAuthError('Something went wrong')
    }
    
    setAuthLoading(false)
  }

  const handleAvatarChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = reader.result as string
        setAvatarPreview(result)
        updateAvatar(result)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleNicknameSubmit = () => {
    if (nickname.trim()) {
      updateNickname(nickname.trim())
    }
  }

  const handlePasswordSubmit = async () => {
    setPasswordError('')
    setPasswordSuccess('')
    
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }
    
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters')
      return
    }
    
    const result = await changePassword(oldPassword, newPassword)
    if (result.success) {
      setPasswordSuccess('Password changed successfully')
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } else {
      setPasswordError(result.error || 'Failed to change password')
    }
  }

  useEffect(() => {
    setNickname(user?.nickname ?? '')
    setAvatarPreview(user?.avatarUrl ?? null)
  }, [user])

  // Не авторизован - показываем форму входа/регистрации
  if (!isLoggedIn) {
    return (
      <div className="page-shell">
        <div className="page-header" style={{ marginBottom: '24px' }}>
          <p className="eyebrow">Account</p>
          <h1>Profile</h1>
        </div>

        <div className="auth-container">
          <div className="card auth-card">
            <div className="auth-tabs">
              <button 
                className={`auth-tab ${authMode === 'login' ? 'auth-tab--active' : ''}`}
                onClick={() => { setAuthMode('login'); setAuthError('') }}
              >
                Sign In
              </button>
              <button 
                className={`auth-tab ${authMode === 'register' ? 'auth-tab--active' : ''}`}
                onClick={() => { setAuthMode('register'); setAuthError('') }}
              >
                Register
              </button>
            </div>
            
            <form onSubmit={handleAuthSubmit} className="auth-form">
              {authMode === 'register' && (
                <div className="form-group">
                  <label>Nickname</label>
                  <input
                    type="text"
                    value={authNickname}
                    onChange={e => setAuthNickname(e.target.value)}
                    placeholder="Enter your nickname"
                    required
                  />
                </div>
              )}
              
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={authEmail}
                  onChange={e => setAuthEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                />
              </div>
              
              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  minLength={6}
                />
              </div>
              
              {authMode === 'register' && (
                <div className="form-group">
                  <label>Confirm Password</label>
                  <input
                    type="password"
                    value={authConfirmPassword}
                    onChange={e => setAuthConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    required
                    minLength={6}
                  />
                </div>
              )}
              
              {authError && <p className="field-error">{authError}</p>}
              
              <div className="form-actions" style={{ marginTop: '8px' }}>
                <button 
                  className="btn-primary" 
                  type="submit" 
                  disabled={authLoading}
                >
                  {authLoading ? 'Loading...' : authMode === 'login' ? 'Sign In' : 'Create Account'}
                </button>
              </div>
            </form>
            
            <p className="auth-switch muted">
              {authMode === 'login' ? (
                <>Don't have an account? <button className="auth-switch__link" onClick={() => setAuthMode('register')}>Register</button></>
              ) : (
                <>Already have an account? <button className="auth-switch__link" onClick={() => setAuthMode('login')}>Sign In</button></>
              )}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Авторизован - показываем профиль
  return (
    <div className="page-shell">
      <div className="page-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div className="page-header">
          <p className="eyebrow">Account</p>
          <h1>Profile</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="muted" style={{ fontSize: '13px' }}>{user?.email}</span>
          <button
            onClick={logout}
            className="btn-secondary"
            style={{ padding: '8px 14px', fontSize: '13px' }}
          >
            Logout
          </button>
        </div>
      </div>

      <div className="profile-grid" style={{ marginTop: '16px' }}>
        <div className="card profile-card">
          <h3 className="profile-card__title">Avatar</h3>
          <div className="profile-card__content">
            <div className="profile-avatar">
              <div className={`profile-avatar__preview${avatarPreview ? ' profile-avatar__preview--filled' : ''}`}>
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar" className="profile-avatar__image" />
                ) : (
                  <span className="profile-avatar__placeholder">👤</span>
                )}
              </div>
            </div>
            <p className="profile-card__helper muted">Upload a profile picture</p>
            <div className="profile-avatar__actions">
              <label className="file-picker">
                Choose File
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                />
              </label>
              {avatarPreview && (
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => {
                    setAvatarPreview(null)
                    updateAvatar(null)
                    if (fileInputRef.current) fileInputRef.current.value = ''
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="card profile-card">
          <h3 className="profile-card__title">Nickname</h3>
          <div className="profile-card__content">
            <div className="form-stack">
              <div className="form-group">
                <label>Display Name</label>
                <input
                  type="text"
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  placeholder="Enter your nickname"
                />
              </div>
            </div>
            <div className="form-actions">
              <button className="btn-primary" type="button" onClick={handleNicknameSubmit}>
                Save Nickname
              </button>
            </div>
          </div>
        </div>

        <div className="card profile-card">
          <h3 className="profile-card__title">Change Password</h3>
          <div className="profile-card__content">
            <div className="form-stack">
              <div className="form-group">
                <label>Current Password</label>
                <input
                  type="password"
                  value={oldPassword}
                  onChange={e => setOldPassword(e.target.value)}
                  placeholder="Enter current password"
                />
              </div>
              <div className="form-group">
                <label>New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                />
              </div>
              <div className="form-group">
                <label>Confirm New Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                />
              </div>
            </div>
            <div className="form-actions">
              <button className="btn-primary" type="button" onClick={handlePasswordSubmit}>
                Change Password
              </button>
            </div>
            {passwordError && <p className="field-error">{passwordError}</p>}
            {passwordSuccess && <p className="profile-card__helper" style={{ color: '#4ade80' }}>{passwordSuccess}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Profile
