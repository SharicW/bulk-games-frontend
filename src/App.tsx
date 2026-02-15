import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import MainMenu from './pages/MainMenu'
import Profile from './pages/Profile'
import Shop from './pages/Shop'
import Leaderboards from './pages/Leaderboards'
import Poker from './pages/Poker'
import Uno from './pages/Uno'
import { AuthProvider } from './context/AuthContext'

function AppContent() {
  const location = useLocation()
  
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
