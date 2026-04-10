import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { respondToAgent, retryAgent, createRoutingRule, updateNode, createEdge } from '../../api'
import './AgentRunPanel.css'

const STATUS_ICONS = {
  running: '⏳',
  complete: '✅',
  needs_review: '👁️',
  needs_you: '🔔',
  failed: '🚨',
}

const AGENT_LABELS = {
  summarizer: 'Summarizer',
  email_drafter: 'Email Drafter',
  meeting_processor: 'Meeting Processor',
  node_linker: 'Node Linker',
}

export default function AgentRunPanel({ run, taskId, onDone, onUpdated }) {
  const navigate = useNavigate()
  const [reply, setReply] = useState('')
  const [acting, setActing] = useState(false)
  const [error, setError] = useState(null)
  const [savingRule, setSavingRule] = useState(false)
  const [approvingLinks, setApprovingLinks] = useState([])

  if (!run) return null

  const { status, agent_name, output_summary, output_json, tokens_used,
          token_cost_estimate, error_message, question, run_id } = run

  const agentLabel = AGENT_LABELS[agent_name] || agent_name
  const icon = STATUS_ICONS[status] || '⬡'

  const act = async (fn) => {
    setActing(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    } finally {
      setActing(false)
    }
  }

  const handleMarkDone = () => act(async () => {
    await updateNode(taskId, { properties: { status: 'done' } })
    onDone?.()
  })

  const handleReply = () => act(async () => {
    const updated = await respondToAgent(run_id, reply)
    setReply('')
    onUpdated?.(updated)
  })

  const handleRetry = () => act(async () => {
    const updated = await retryAgent(run_id)
    onUpdated?.(updated)
  })

  const handleTakeOver = () => act(async () => {
    await updateNode(taskId, { properties: { status: 'in_progress' } })
    onDone?.()
  })

  const handleAlwaysRoute = async () => {
    setSavingRule(true)
    try {
      await createRoutingRule({
        pattern_description: `Auto-route to ${agent_name}`,
        executor: agent_name,
        mode: 'always',
      })
      setSavingRule(false)
    } catch (e) {
      setError(e.message)
      setSavingRule(false)
    }
  }

  const handleApproveLink = async (link) => {
    setApprovingLinks((prev) => [...prev, link.node_id])
    try {
      await createEdge({ source_id: taskId, target_id: link.node_id, type: link.edge_type })
    } catch (e) {
      setError(e.message)
    } finally {
      setApprovingLinks((prev) => prev.filter((id) => id !== link.node_id))
    }
  }

  const tokenInfo = tokens_used
    ? `${tokens_used.toLocaleString()} tokens`
    : token_cost_estimate
    ? `~${token_cost_estimate.toLocaleString()} tokens (est.)`
    : null

  return (
    <div className={`agent-run-panel agent-run-${status}`}>
      <div className="agent-run-header">
        <span className="agent-run-icon">{icon}</span>
        <span className="agent-run-title">
          {status === 'running' ? `${agentLabel} is running…` : `${agentLabel}`}
        </span>
        {tokenInfo && <span className="agent-run-tokens">{tokenInfo}</span>}
      </div>

      {status === 'running' && (
        <div className="agent-run-working">
          <div className="spinner" />
          <span>Working…</span>
        </div>
      )}

      {(status === 'complete' || status === 'needs_review') && output_summary && (
        <div className="agent-run-output">{output_summary}</div>
      )}

      {/* Node linker link suggestions */}
      {(status === 'complete' || status === 'needs_review') &&
        agent_name === 'node_linker' &&
        output_json?.links?.length > 0 && (
          <div className="agent-run-links">
            <div className="agent-run-links-title">Suggested links — approve to create:</div>
            {output_json.links.map((link) => (
              <div key={link.node_id} className="agent-run-link-row">
                <span className="agent-run-link-type">{link.edge_type}</span>
                <span
                  className="agent-run-link-target"
                  onClick={() => navigate(`/nodes/${link.node_id}`)}
                >
                  {link.node_label}
                  <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>({link.node_type})</span>
                </span>
                <span className="agent-run-link-reason">{link.reason}</span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleApproveLink(link)}
                  disabled={approvingLinks.includes(link.node_id) || acting}
                >
                  {approvingLinks.includes(link.node_id) ? '…' : 'Link'}
                </button>
              </div>
            ))}
          </div>
        )}

      {status === 'needs_you' && (
        <div className="agent-run-question">
          <div className="agent-run-q-text">{question || 'The agent needs more information:'}</div>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Your reply…"
            rows={3}
          />
        </div>
      )}

      {status === 'failed' && error_message && (
        <div className="agent-run-error">{error_message}</div>
      )}

      {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}

      <div className="agent-run-actions">
        {(status === 'complete' || status === 'needs_review') && (
          <>
            <button className="btn btn-primary btn-sm" onClick={handleMarkDone} disabled={acting}>
              {status === 'complete' ? 'Looks good — Done' : 'Approve — Done'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/nodes/${taskId}`)}>
              Open & Edit
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleRetry} disabled={acting}>
              Redo
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleAlwaysRoute}
              disabled={savingRule || acting}
              title="Create a routing rule so this agent always handles similar tasks"
            >
              {savingRule ? '…' : 'Always use this agent'}
            </button>
          </>
        )}

        {status === 'needs_you' && (
          <>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleReply}
              disabled={acting || !reply.trim()}
            >
              {acting ? <span className="spinner" /> : 'Reply'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleTakeOver} disabled={acting}>
              Take over
            </button>
          </>
        )}

        {status === 'failed' && (
          <>
            <button className="btn btn-primary btn-sm" onClick={handleRetry} disabled={acting}>
              {acting ? <span className="spinner" /> : 'Retry'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleTakeOver} disabled={acting}>
              Take over
            </button>
          </>
        )}
      </div>
    </div>
  )
}
