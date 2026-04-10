import { NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getSettings } from '../../api'
import './IconRail.css'

const THEME_CYCLE = { system: 'dark', dark: 'light', light: 'system' }
const THEME_ICON  = { system: '💻', dark: '🌙', light: '☀️' }

const NAV = [
  { to: '/',        icon: '◉',  label: 'Graph',    exact: true },
  { to: '/inbox',   icon: '📥', label: 'Inbox'   },
  { to: '/today',   icon: '📅', label: 'Today'   },
  { to: '/agents',  icon: '🤖', label: 'Agents'  },
  { to: '/types',   icon: '⬡',  label: 'Categories' },
]

export default function IconRail() {
  const navigate  = useNavigate()
  const [theme, setTheme] = useState(() => localStorage.getItem('bb_theme') || 'system')
  const [aiReady, setAiReady] = useState(false)

  useEffect(() => {
    getSettings()
      .then((s) => setAiReady(!!(s?.ANTHROPIC_API_KEY || s?.CLAUDE_CODE_ENABLED === 'true')))
      .catch(() => {})
  }, [])

  const cycleTheme = () => {
    const next = THEME_CYCLE[theme] || 'system'
    setTheme(next)
    localStorage.setItem('bb_theme', next)
    window.dispatchEvent(new CustomEvent('bb-theme-change', { detail: next }))
  }

  return (
    <nav className="icon-rail">
      {/* Brand */}
      <button className="rail-brand" onClick={() => navigate('/')} title="Bionic Brain">
        🧠
      </button>

      <div className="rail-divider" />

      {/* Primary nav */}
      <div className="rail-nav">
        {NAV.map(({ to, icon, label, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) => `rail-item${isActive ? ' active' : ''}`}
            title={label}
          >
            <span className="rail-icon">{icon}</span>
            <span className="rail-label">{label}</span>
          </NavLink>
        ))}
      </div>

      {/* Bottom actions */}
      <div className="rail-footer">
        {!aiReady && (
          <NavLink to="/settings" className="rail-item rail-warn" title="AI not configured">
            <span className="rail-icon">⚠</span>
            <span className="rail-label">Setup AI</span>
          </NavLink>
        )}
        <NavLink to="/settings" className={({ isActive }) => `rail-item${isActive ? ' active' : ''}`} title="Settings">
          <span className="rail-icon">⚙</span>
          <span className="rail-label">Settings</span>
        </NavLink>
        <button
          className="rail-item"
          onClick={cycleTheme}
          title={`Theme: ${theme}`}
        >
          <span className="rail-icon">{THEME_ICON[theme]}</span>
          <span className="rail-label">{theme}</span>
        </button>
      </div>
    </nav>
  )
}
