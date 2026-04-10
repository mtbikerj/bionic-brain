import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getTodayItems, getActiveTasks } from '../api'
import NodeCard from '../components/nodes/NodeCard'
import './View.css'

const ATTENTION_ICONS = {
  needs_you: '🔔',
  needs_review: '👁️',
  agent_complete: '✅',
  failed: '🚨',
  in_progress_agent: '⏳',
}

const ATTENTION_LABELS = {
  needs_you: 'Needs You',
  needs_review: 'Needs Review',
  agent_complete: 'Complete',
  failed: 'Failed',
  in_progress_agent: 'Running',
}

export default function HomeView() {
  const [today, setToday] = useState(null)
  const [activeTasks, setActiveTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    Promise.all([
      getTodayItems().catch(() => null),
      getActiveTasks().catch(() => []),
    ]).then(([t, a]) => {
      setToday(t)
      setActiveTasks(a)
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="view-loading"><div className="spinner" /></div>

  const attention = activeTasks.filter((t) => t.status !== 'in_progress_agent')
  const running = activeTasks.filter((t) => t.status === 'in_progress_agent')

  return (
    <div className="view">
      <div className="view-header">
        <h1 className="view-title">Home</h1>
        <button className="btn btn-primary" onClick={() => navigate('/nodes/new')}>
          + New Item
        </button>
      </div>

      <div className="view-content">
        {/* Control tower strip */}
        {activeTasks.length > 0 && (
          <div className="control-tower" onClick={() => navigate('/agents')}>
            <div className="control-tower-title">
              {attention.length > 0
                ? `${attention.length} item${attention.length !== 1 ? 's' : ''} need your attention`
                : `${running.length} agent${running.length !== 1 ? 's' : ''} running`}
            </div>
            <div className="control-tower-chips">
              {activeTasks.slice(0, 5).map((t) => (
                <span
                  key={t.id}
                  className="control-tower-chip"
                  onClick={(e) => { e.stopPropagation(); navigate(`/nodes/${t.id}`) }}
                >
                  {ATTENTION_ICONS[t.status] || '⬡'} {t.label}
                  <span className="control-tower-chip-status">{ATTENTION_LABELS[t.status] || t.status}</span>
                </span>
              ))}
              {activeTasks.length > 5 && (
                <span className="control-tower-more">+{activeTasks.length - 5} more →</span>
              )}
            </div>
          </div>
        )}

        {today?.day && (
          <div className="home-section">
            <div className="section-title">Today — {today.day.label}</div>
            {today.due_today?.length > 0 && (
              <>
                <div className="home-subsection-title">Due Today</div>
                <div className="node-list">
                  {today.due_today.map((n) => <NodeCard key={n.id} node={n} />)}
                </div>
              </>
            )}
            {today.created_today?.length > 0 && (
              <>
                <div className="home-subsection-title" style={{ marginTop: 16 }}>Created Today</div>
                <div className="node-list">
                  {today.created_today.map((n) => <NodeCard key={n.id} node={n} />)}
                </div>
              </>
            )}
            {today.completed_today?.length > 0 && (
              <>
                <div className="home-subsection-title" style={{ marginTop: 16 }}>Completed Today</div>
                <div className="node-list">
                  {today.completed_today.map((n) => <NodeCard key={n.id} node={n} />)}
                </div>
              </>
            )}
            {!today.created_today?.length && !today.due_today?.length && (
              <div className="empty-state">
                <div className="empty-icon">🌅</div>
                <p>Nothing yet today. Create something or capture to Inbox.</p>
              </div>
            )}
          </div>
        )}

        {!today?.day && activeTasks.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">🧠</div>
            <p>Welcome to Bionic Brain. Start by capturing something to Inbox.</p>
          </div>
        )}
      </div>
    </div>
  )
}
