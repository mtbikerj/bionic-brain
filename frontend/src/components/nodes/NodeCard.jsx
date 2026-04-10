import { useNavigate } from 'react-router-dom'
import './NodeCard.css'

const TYPE_ICONS = {
  TASK: '✅', NOTE: '📄', PERSON: '👤', FILE: '📎', URL: '🌐',
  LOCATION: '📍', COIN: '🪙', AGENT_RUN: '🤖', INBOX_ITEM: '📥',
  default: '⬡',
}

const STATUS_COLORS = {
  done: 'var(--green)',
  in_progress: 'var(--blue)',
  blocked: 'var(--amber)',
  inbox: 'var(--text-muted)',
}

export default function NodeCard({ node, onClick }) {
  const navigate = useNavigate()
  const icon = TYPE_ICONS[node.type] || TYPE_ICONS.default
  const status = node.properties?.status

  const handleClick = () => {
    if (onClick) onClick(node)
    else navigate(`/nodes/${node.id}`)
  }

  return (
    <div className="node-card" onClick={handleClick}>
      <span className="node-card-icon">{icon}</span>
      <div className="node-card-body">
        <div className="node-card-label">{node.label}</div>
        <div className="node-card-meta">
          <span className="node-type-badge">{node.type}</span>
          {status && (
            <span className="node-status" style={{ color: STATUS_COLORS[status] || 'inherit' }}>
              {status.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </div>
      {node.has_body && <span className="node-has-body" title="Has notes">📝</span>}
    </div>
  )
}
