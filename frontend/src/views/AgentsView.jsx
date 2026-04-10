import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getActiveTasks, getRoutingRules, deleteRoutingRule, getCustomAgents, deleteCustomAgent } from '../api'
import AgentCreatePanel from '../components/agents/AgentCreatePanel'
import './View.css'
import './AgentsView.css'

const STATUS_ICONS = {
  in_progress_agent: '⏳',
  needs_you: '🔔',
  needs_review: '👁️',
  agent_complete: '✅',
  failed: '🚨',
}

const STATUS_LABELS = {
  in_progress_agent: 'Running',
  needs_you: 'Needs You',
  needs_review: 'Needs Review',
  agent_complete: 'Complete',
  failed: 'Failed',
}

const ATTENTION_STATUSES = ['needs_you', 'needs_review', 'agent_complete', 'failed']
const RUNNING_STATUSES = ['in_progress_agent']

export default function AgentsView() {
  const navigate = useNavigate()
  const [tasks, setTasks] = useState([])
  const [rules, setRules] = useState([])
  const [customAgents, setCustomAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null) // agent object being edited

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, r, ca] = await Promise.all([getActiveTasks(), getRoutingRules(), getCustomAgents()])
      setTasks(t)
      setRules(r)
      setCustomAgents(ca)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleDeleteRule = async (id) => {
    if (!confirm('Delete this routing rule?')) return
    try {
      await deleteRoutingRule(id)
      load()
    } catch (e) {
      alert(e.message)
    }
  }

  const handleDeleteAgent = async (name) => {
    if (!confirm(`Delete agent "${name}"?`)) return
    try {
      await deleteCustomAgent(name)
      load()
    } catch (e) {
      alert(e.message)
    }
  }

  const attention = tasks.filter((t) => ATTENTION_STATUSES.includes(t.status))
  const running = tasks.filter((t) => RUNNING_STATUSES.includes(t.status))

  if (creating || editing) {
    return (
      <div className="view">
        <div className="view-content" style={{ maxWidth: 640 }}>
          <AgentCreatePanel
            existing={editing}
            onSaved={() => { setCreating(false); setEditing(null); load() }}
            onCancel={() => { setCreating(false); setEditing(null) }}
          />
        </div>
      </div>
    )
  }

  if (loading) return <div className="view-loading"><div className="spinner" /></div>

  return (
    <div className="view">
      <div className="view-header">
        <h1 className="view-title">Agents</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ New agent</button>
          <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
        </div>
      </div>

      <div className="view-content">
        {/* Needs attention */}
        {attention.length > 0 ? (
          <section className="agents-section">
            <div className="agents-section-title">Needs Your Attention</div>
            {attention.map((t) => (
              <TaskRow key={t.id} task={t} onClick={() => navigate(`/nodes/${t.id}`)} />
            ))}
          </section>
        ) : (
          <section className="agents-section">
            <div className="agents-section-title">Needs Your Attention</div>
            <div className="agents-empty">Nothing needs your attention right now.</div>
          </section>
        )}

        {/* Running */}
        {running.length > 0 && (
          <section className="agents-section">
            <div className="agents-section-title">Running</div>
            {running.map((t) => (
              <TaskRow key={t.id} task={t} onClick={() => navigate(`/nodes/${t.id}`)} />
            ))}
          </section>
        )}

        {/* Custom agents */}
        <section className="agents-section">
          <div className="agents-section-title">Your Agents</div>
          {customAgents.length === 0 ? (
            <div className="agents-empty">
              No custom agents yet.{' '}
              <button className="btn btn-ghost btn-sm" onClick={() => setCreating(true)}>Create one</button>
            </div>
          ) : (
            customAgents.map((a) => (
              <div key={a.name} className="routing-rule-row">
                <div className="routing-rule-body">
                  <span style={{ fontSize: 16 }}>{a.icon}</span>
                  <span className="routing-rule-executor">{a.label}</span>
                  <span className="routing-rule-pattern">{a.description}</span>
                  <span className="routing-rule-type">
                    {a.suitable_for.includes('*') ? 'Any item' : a.suitable_for.join(', ')}
                  </span>
                </div>
                <div className="routing-rule-meta">
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(a)}>Edit</button>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--danger, #ef4444)' }}
                    onClick={() => handleDeleteAgent(a.name)}
                  >Delete</button>
                </div>
              </div>
            ))
          )}
        </section>

        {/* Routing rules */}
        <section className="agents-section">
          <div className="agents-section-title">Routing Rules</div>
          {rules.length === 0 ? (
            <div className="agents-empty">
              No routing rules yet. After an agent run completes, click "Always use this agent" to create one.
            </div>
          ) : (
            rules.map((r) => (
              <div key={r.id} className="routing-rule-row">
                <div className="routing-rule-body">
                  <span className="routing-rule-executor">{r.executor}</span>
                  <span className="routing-rule-pattern">{r.pattern_description}</span>
                  {r.task_type && <span className="routing-rule-type">{r.task_type}</span>}
                </div>
                <div className="routing-rule-meta">
                  <span>{r.mode}</span>
                  {r.hit_count > 0 && <span>{r.hit_count} hit{r.hit_count !== 1 ? 's' : ''}</span>}
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--danger, #ef4444)' }}
                    onClick={() => handleDeleteRule(r.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  )
}

function TaskRow({ task, onClick }) {
  const icon = STATUS_ICONS[task.status] || '⬡'
  const label = STATUS_LABELS[task.status] || task.status

  return (
    <div className="agent-task-row" onClick={onClick}>
      <span className="agent-task-icon">{icon}</span>
      <div className="agent-task-body">
        <span className="agent-task-label">{task.label}</span>
        <span className="agent-task-type">{task.type}</span>
      </div>
      <span className={`agent-task-status agent-task-status-${task.status}`}>{label}</span>
    </div>
  )
}
