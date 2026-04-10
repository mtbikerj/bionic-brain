import { useEffect, useState } from 'react'
import { getTypeHistory } from '../../api'

function timeAgo(ms) {
  if (!ms) return ''
  const secs = Math.floor((Date.now() - ms) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

export default function VersionHistoryPanel({ typeName, onClose }) {
  const [history, setHistory] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    getTypeHistory(typeName)
      .then(setHistory)
      .catch((e) => setError(e.message))
  }, [typeName])

  return (
    <div className="create-panel">
      <div className="create-panel-header">
        <h2>
          {typeName.charAt(0) + typeName.slice(1).toLowerCase().replace(/_/g, ' ')} — version history
        </h2>
        {onClose && <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>}
      </div>

      <div className="create-form">
        {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
        {!history && !error && <div className="spinner" />}
        {history && history.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            No schema changes recorded yet. Changes appear here after you edit and save a category's fields.
          </p>
        )}
        {history && history.length > 0 && (
          <div className="version-history-list">
            {history.map((entry) => (
              <div key={entry.version} className="version-history-entry">
                <div className="version-history-badge">v{entry.version}</div>
                <div className="version-history-body">
                  <div className="version-history-changes">{entry.changes}</div>
                  <div className="version-history-time">{timeAgo(entry.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
