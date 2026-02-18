import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import MainMenu from './pages/MainMenu'
import Profile from './pages/Profile'
import Shop from './pages/Shop'
import Leaderboards from './pages/Leaderboards'
import Poker from './pages/Poker'
import Uno from './pages/Uno'
import { AuthProvider } from './context/AuthContext'
import { sfx } from './services/sfx'

function AppContent() {
  const location = useLocation()

  // ── Sound: unlock audio on first user gesture ──────────────────────────────
  // Browser autoplay policies require a user interaction before audio can play.
  // We attach one-shot listeners here (app root) so the unlock fires regardless
  // of which page the user lands on first.
  useEffect(() => {
    sfx.init() // preload common sounds (no audio plays yet)

    const unlock = () => {
      sfx.unlock()
      // Once unlocked we no longer need these listeners.
      // `{ once: true }` handles removal automatically per listener.
    }

    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })

    return () => {
      // Cleanup in case component unmounts before gesture (e.g. SSR / testing)
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  // Poker page renders standalone (no sidebar) when accessed directly
  const isPokerPage = location.pathname === '/game/poker'
  const isUnoPage = location.pathname === '/game/uno'

  if (isPokerPage) {
    return <Poker />
  }

  if (isUnoPage) {
    return <Uno />
  }

  return (
    <>
      <Sidebar />
      <main id="main">
        <div className="main-shell">
          <Routes>
            <Route path="/" element={<Navigate to="/main-menu" replace />} />
            <Route path="/main-menu" element={<MainMenu />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/shop" element={<Shop />} />
            <Route path="/leaderboards" element={<Leaderboards />} />
            <Route path="/game/poker" element={<Poker />} />
            <Route path="/game/uno" element={<Uno />} />
          </Routes>
        </div>
      </main>
    </>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
