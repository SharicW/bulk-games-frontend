import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import MainMenu from './pages/MainMenu'
import Profile from './pages/Profile'
import GamePlaceholder from './pages/GamePlaceholder'
import Poker from './pages/Poker'
import { AuthProvider } from './context/AuthContext'

function AppContent() {
  const location = useLocation()
  
  // Poker page renders standalone (no sidebar) when accessed directly
  const isPokerPage = location.pathname === '/game/poker'
  
  if (isPokerPage) {
    return <Poker />
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
            <Route path="/game/poker" element={<Poker />} />
            <Route path="/game/uno" element={<GamePlaceholder game="UNO" />} />
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
