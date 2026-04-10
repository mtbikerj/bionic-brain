import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom'
import IconRail from './components/layout/IconRail'
import CommandBar from './components/layout/CommandBar'
import GraphView from './views/GraphView'
import InboxView from './views/InboxView'
import TodayView from './views/TodayView'
import NodePage from './views/NodePage'
import TypeListView from './views/TypeListView'
import TypeRegistryView from './views/TypeRegistryView'
import TypeCreateView from './views/TypeCreateView'
import AgentsView from './views/AgentsView'
import SettingsView from './views/SettingsView'
import './App.css'

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(pref) {
  const resolved =
    pref === 'light' ? 'light'
    : pref === 'dark' ? 'dark'
    : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  if (resolved === 'light') {
    document.documentElement.setAttribute('data-theme', 'light')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

// Redirect /graph/node/:id → /nodes/:id
function GraphNodeRedirect() {
  const { id } = useParams()
  return <Navigate to={`/nodes/${id}`} replace />
}

// ── App shell ─────────────────────────────────────────────────────────────────
function AppShell() {
  const navigate  = useNavigate()
  const location  = useLocation()

  // Drawer is open for any route except root
  const drawerOpen = location.pathname !== '/'

  // Theme
  useEffect(() => {
    const pref = localStorage.getItem('bb_theme') || 'system'
    applyTheme(pref)
    const onThemeChange = (e) => applyTheme(e.detail)
    window.addEventListener('bb-theme-change', onThemeChange)
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onMq = () => {
      if ((localStorage.getItem('bb_theme') || 'system') === 'system') applyTheme('system')
    }
    mq.addEventListener('change', onMq)
    return () => {
      window.removeEventListener('bb-theme-change', onThemeChange)
      mq.removeEventListener('change', onMq)
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      const tag    = e.target?.tagName?.toLowerCase()
      const inInput = ['input', 'textarea', 'select'].includes(tag) || e.target?.isContentEditable
      const mod    = e.metaKey || e.ctrlKey

      if (mod && e.key === 'k') {
        e.preventDefault()
        document.getElementById('command-bar-input')?.focus()
      } else if (mod && e.key === 'n') {
        e.preventDefault(); navigate('/nodes/new')
      } else if (mod && e.key === 'i') {
        e.preventDefault(); navigate('/inbox')
      } else if (mod && e.key === 'g') {
        e.preventDefault(); navigate('/')
      } else if (mod && e.key === ',') {
        e.preventDefault(); navigate('/settings')
      } else if (e.key === 'Escape' && drawerOpen) {
        navigate('/')
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [navigate, drawerOpen])

  return (
    <div className="app-shell">
      {/* ── Graph canvas — always rendered, full screen behind everything ── */}
      <div className="graph-layer">
        <Routes>
          {/* GraphView reads the current route to determine focal node */}
          <Route path="/*" element={<GraphView drawerOpen={drawerOpen} />} />
        </Routes>
      </div>

      {/* ── Left icon rail ── */}
      <IconRail />

      {/* ── Floating command bar ── */}
      <CommandBar drawerOpen={drawerOpen} />

      {/* ── Right drawer — slides in for any non-root route ── */}
      <div className={`right-drawer ${drawerOpen ? 'open' : ''}`}>
        <button
          className="drawer-close-btn"
          onClick={() => navigate('/')}
          title="Close  Esc"
        >
          ✕
        </button>

        <div className="drawer-scroll">
          <Routes>
            <Route path="/"                    element={null} />
            {/* Legacy redirects */}
            <Route path="/home"                element={<Navigate to="/" replace />} />
            <Route path="/search"              element={<Navigate to="/" replace />} />
            <Route path="/graph"               element={<Navigate to="/" replace />} />
            <Route path="/graph/node/:id"      element={<GraphNodeRedirect />} />
            {/* Drawer views */}
            <Route path="/nodes/:id"           element={<NodePage />} />
            <Route path="/inbox"               element={<InboxView />} />
            <Route path="/today"               element={<TodayView />} />
            <Route path="/types"               element={<TypeRegistryView />} />
            <Route path="/types/new"           element={<TypeCreateView />} />
            <Route path="/types/:name"         element={<TypeListView />} />
            <Route path="/agents"              element={<AgentsView />} />
            <Route path="/settings"            element={<SettingsView />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}
