import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { getTypes, getSavedSearches, getActiveTasks, getSettings } from '../../api'
import './Sidebar.css'

const THEME_CYCLE = { system: 'dark', dark: 'light', light: 'system' }
const THEME_ICON = { system: '💻', dark: '🌙', light: '☀️' }

const TYPE_ICONS = {
  TASK: '✅', NOTE: '📄', PERSON: '👤', FILE: '📎', URL: '🌐',
  LOCATION: '📍', YEAR: '📅', MONTH: '📅', DAY: '📅',
  AGENT_RUN: '🤖', INBOX_ITEM: '📥', default: '⬡',
}

// ── Onboarding checklist ──────────────────────────────────────────────────────
function useOnboarding(types, nodes) {
  const dismissed = localStorage.getItem('bb_onboarding_dismissed') === 'true'
  const hasSearched = !!localStorage.getItem('bb_search_history')
  const hasVisitedGraph = !!localStorage.getItem('bb_visited_graph')

  if (dismissed) return null

  const steps = [
    {
      id: 'ai',
      label: 'Set up AI',
      done: false, // resolved async below
      link: '/settings',
    },
    {
      id: 'first_item',
      label: 'Capture your first item',
      done: nodes > 0,
      link: '/inbox',
    },
    {
      id: 'category',
      label: 'Create a custom category',
      done: types.some((t) => !t.is_builtin),
      link: '/types/new',
    },
    {
      id: 'search',
      label: 'Try search',
      done: hasSearched,
      link: '/search',
    },
    {
      id: 'graph',
      label: 'Explore the graph',
      done: hasVisitedGraph,
      link: '/graph',
    },
  ]

  const allDone = steps.every((s) => s.done)
  if (allDone) {
    localStorage.setItem('bb_onboarding_dismissed', 'true')
    return null
  }

  return steps
}

function OnboardingChecklist({ steps, settings, onDismiss, navigate }) {
  // Resolve AI step using settings
  const aiDone = !!(
    (settings?.ANTHROPIC_API_KEY && settings.ANTHROPIC_API_KEY !== '') ||
    settings?.CLAUDE_CODE_ENABLED === 'true'
  )
  const resolved = steps.map((s) => s.id === 'ai' ? { ...s, done: aiDone } : s)
  const doneCount = resolved.filter((s) => s.done).length

  return (
    <div className="onboarding-checklist">
      <div className="onboarding-header">
        <span>Getting started ({doneCount}/{resolved.length})</span>
        <button className="onboarding-dismiss" onClick={onDismiss} title="Dismiss">✕</button>
      </div>
      {resolved.map((step) => (
        <button
          key={step.id}
          className={`onboarding-step${step.done ? ' done' : ''}`}
          onClick={() => !step.done && navigate(step.link)}
        >
          <span className="onboarding-check">{step.done ? '✓' : '○'}</span>
          <span>{step.label}</span>
        </button>
      ))}
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
export default function Sidebar() {
  const [types, setTypes] = useState([])
  const [savedSearches, setSavedSearches] = useState([])
  const [agentBadge, setAgentBadge] = useState(0)
  const [theme, setTheme] = useState(() => localStorage.getItem('bb_theme') || 'system')
  const [settings, setSettings] = useState(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => localStorage.getItem('bb_onboarding_dismissed') === 'true'
  )
  const navigate = useNavigate()

  const cycleTheme = () => {
    const next = THEME_CYCLE[theme] || 'system'
    setTheme(next)
    localStorage.setItem('bb_theme', next)
    window.dispatchEvent(new CustomEvent('bb-theme-change', { detail: next }))
  }

  useEffect(() => {
    getTypes().then((ts) => {
      setTypes(ts)
      setNodeCount(ts.reduce((sum, t) => sum + (t.node_count || 0), 0))
    }).catch(() => {})
    getSavedSearches().then(setSavedSearches).catch(() => {})
    getActiveTasks()
      .then((tasks) => setAgentBadge(tasks.filter((t) => t.status !== 'in_progress_agent').length))
      .catch(() => {})
    if (!onboardingDismissed) {
      getSettings().then(setSettings).catch(() => {})
    }
  }, [])

  const userTypes = types.filter(
    (t) => !t.is_builtin || ['TASK', 'NOTE', 'PERSON', 'FILE', 'URL', 'LOCATION'].includes(t.name)
  )

  const runSaved = (s) => {
    const params = new URLSearchParams({ q: s.query, mode: s.mode })
    navigate(`/search?${params}`)
  }

  const onboardingSteps = useOnboarding(types, nodeCount)

  const dismissOnboarding = () => {
    localStorage.setItem('bb_onboarding_dismissed', 'true')
    setOnboardingDismissed(true)
  }

  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-icon">🧠</span>
        <span className="brand-name">Bionic Brain</span>
      </div>

      <div className="sidebar-nav">
        <NavItem to="/home" icon="🏠" label="Home" />
        <NavItem to="/inbox" icon="📥" label="Inbox" />
        <NavItem to="/today" icon="📅" label="Today" />
        <NavItem to="/search" icon="🔍" label="Search" />
        <NavItem to="/graph" icon="🕸️" label="Graph" />
        <NavItem to="/agents" icon="🤖" label="Agents" count={agentBadge || undefined} />
      </div>

      <hr className="divider" />

      {!onboardingDismissed && onboardingSteps && (
        <>
          <OnboardingChecklist
            steps={onboardingSteps}
            settings={settings}
            onDismiss={dismissOnboarding}
            navigate={navigate}
          />
          <hr className="divider" />
        </>
      )}

      {userTypes.length > 0 && (
        <>
          <div className="sidebar-section-title">Types</div>
          <div className="sidebar-nav">
            {userTypes.map((t) => (
              <NavItem
                key={t.name}
                to={`/types/${t.name}`}
                icon={TYPE_ICONS[t.name] || TYPE_ICONS.default}
                label={t.name.charAt(0) + t.name.slice(1).toLowerCase().replace(/_/g, ' ')}
                count={t.node_count || undefined}
              />
            ))}
          </div>
          <hr className="divider" />
        </>
      )}

      {savedSearches.length > 0 && (
        <>
          <div className="sidebar-section-title">Saved Searches</div>
          <div className="sidebar-nav">
            {savedSearches.map((s) => (
              <button
                key={s.id}
                className="sidebar-item sidebar-item-btn"
                onClick={() => runSaved(s)}
                title={s.query}
              >
                <span className="sidebar-icon">{s.mode === 'nl' ? '✨' : '🔍'}</span>
                <span className="sidebar-label">{s.label}</span>
              </button>
            ))}
          </div>
          <hr className="divider" />
        </>
      )}

      <div className="sidebar-footer">
        <NavItem to="/types" icon="⬡" label="Categories" />
        <NavItem to="/settings" icon="⚙️" label="Settings" />
        <button
          className="sidebar-item sidebar-item-btn"
          onClick={cycleTheme}
          title={`Theme: ${theme} (click to cycle)`}
        >
          <span className="sidebar-icon">{THEME_ICON[theme]}</span>
          <span className="sidebar-label" style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {theme.charAt(0).toUpperCase() + theme.slice(1)} theme
          </span>
        </button>
      </div>
    </nav>
  )
}

function NavItem({ to, icon, label, count }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => 'sidebar-item' + (isActive ? ' active' : '')}
    >
      <span className="sidebar-icon">{icon}</span>
      <span className="sidebar-label">{label}</span>
      {count != null && <span className="sidebar-count">{count}</span>}
    </NavLink>
  )
}
