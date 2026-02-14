import { NavLink } from 'react-router-dom'
import logo from '../../assets/BULK_GAMES_LOGO.png'
import { useAuth } from '../hooks/useAuth'

function Sidebar() {
  const { user } = useAuth()

  const profileAvatar = user?.avatarUrl ? (
    <img src={user.avatarUrl} alt="User avatar" className="sidebar__avatar" />
  ) : (
    <span className="sidebar__avatar sidebar__avatar--empty" />
  )

  return (
    <aside id="sidebar">
      <div className="sidebar">
        <div className="sidebar__content">
          <div className="sidebar__brand-wrapper">
            <a href="/" className="sidebar__brand">
              <img src={logo} alt="Bulk Games" className="sidebar__brand-logo" />
            </a>
          </div>

          <div className="sidebar__main">
            <div className="sidebar__label">MAIN</div>
            <div className="sidebar__links">
              <NavLink
                to="/main-menu"
                className={({ isActive }) =>
                  `sidebar__link${isActive ? ' is-active' : ''}`
                }
              >
                <svg className="sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                <span className="sidebar__text">Main Menu</span>
              </NavLink>
              <NavLink
                to="/shop"
                className={({ isActive }) =>
                  `sidebar__link${isActive ? ' is-active' : ''}`
                }
              >
                <svg className="sidebar__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 01-8 0" />
                </svg>
                <span className="sidebar__text">Shop</span>
              </NavLink>
            </div>
          </div>

          <div className="sidebar__divider" />

          <div className="sidebar__profile">
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                `sidebar__link${isActive ? ' is-active' : ''}`
              }
            >
              {profileAvatar}
              <span className="sidebar__text">Profile</span>
            </NavLink>
          </div>
        </div>
      </div>
    </aside>
  )
}

export default Sidebar
