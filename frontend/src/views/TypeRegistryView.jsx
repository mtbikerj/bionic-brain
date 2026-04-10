import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getTypes, deleteType } from '../api'
import TypeEditPanel from '../components/types/TypeEditPanel'
import VersionHistoryPanel from '../components/types/VersionHistoryPanel'
import './View.css'

export default function TypeRegistryView() {
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)    // type name being edited
  const [history, setHistory] = useState(null)    // type name showing history
  const navigate = useNavigate()

  const load = async () => {
    setLoading(true)
    try {
      const ts = await getTypes()
      setTypes(ts)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (editing) {
    const typeDef = types.find((t) => t.name === editing)
    return (
      <div style={{ padding: 28, maxWidth: 680, margin: '0 auto' }}>
        <TypeEditPanel
          typeDef={typeDef}
          onSaved={() => { setEditing(null); load() }}
          onCancel={() => setEditing(null)}
        />
      </div>
    )
  }

  if (history) {
    return (
      <div style={{ padding: 28, maxWidth: 680, margin: '0 auto' }}>
        <VersionHistoryPanel typeName={history} onClose={() => setHistory(null)} />
      </div>
    )
  }

  const handleDelete = async (typeName, nodeCount) => {
    const msg = nodeCount > 0
      ? `Delete type "${typeName}"? It has ${nodeCount} node(s) — they will not be deleted but will lose their type definition.`
      : `Delete type "${typeName}"?`
    if (!confirm(msg)) return
    try {
      await deleteType(typeName)
      load()
    } catch (err) {
      alert(err.message)
    }
  }

  const userTypes = types.filter((t) => !t.is_builtin)
  const builtinTypes = types.filter((t) => t.is_builtin)

  return (
    <div className="view">
      <div className="view-header">
        <h1 className="view-title">Categories</h1>
        <button className="btn btn-primary" onClick={() => navigate('/types/new')}>
          + New Category
        </button>
      </div>
      <div className="view-content">
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <div className="spinner" />
          </div>
        ) : (
          <>
            {userTypes.length > 0 && (
              <section className="registry-section">
                <div className="registry-section-title">Your Categories</div>
                <div className="type-registry-grid">
                  {userTypes.map((t) => (
                    <TypeCard
                      key={t.name}
                      type={t}
                      onEdit={() => setEditing(t.name)}
                      onView={() => navigate(`/types/${t.name}`)}
                      onDelete={() => handleDelete(t.name, t.node_count)}
                      onHistory={() => setHistory(t.name)}
                    />
                  ))}
                </div>
              </section>
            )}

            {userTypes.length === 0 && (
              <div className="empty-state" style={{ marginBottom: 32 }}>
                <div className="empty-icon">⬡</div>
                <p>No custom categories yet.</p>
                <button className="btn btn-primary" onClick={() => navigate('/types/new')}>Create your first category</button>
              </div>
            )}

            <section className="registry-section">
              <div className="registry-section-title">Built-in Categories</div>
              <div className="type-registry-grid">
                {builtinTypes.map((t) => (
                  <TypeCard key={t.name} type={t} onView={() => navigate(`/types/${t.name}`)} onEdit={() => setEditing(t.name)} onHistory={() => setHistory(t.name)} />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function TypeCard({ type, onEdit, onView, onDelete, onHistory }) {
  return (
    <div className="type-card">
      <div className="type-card-header" onClick={onView} style={{ cursor: 'pointer' }}>
        <span className="type-card-dot" style={{ background: type.color }} />
        <span className="type-card-name">
          {type.name.charAt(0) + type.name.slice(1).toLowerCase().replace(/_/g, ' ')}
        </span>
        <span className="type-card-version">v{type.version}</span>
      </div>
      <div className="type-card-meta">
        <span>{type.fields.length} field{type.fields.length !== 1 ? 's' : ''}</span>
        <span>{type.node_count} item{type.node_count !== 1 ? 's' : ''}</span>
        {type.edge_types?.length > 0 && (
          <span>{type.edge_types.length} rel type{type.edge_types.length !== 1 ? 's' : ''}</span>
        )}
      </div>
      {type.extends && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', paddingTop: 4 }}>
          extends <span style={{ fontWeight: 600 }}>{type.extends}</span>
        </div>
      )}
      <div className="type-card-actions">
        <button className="btn btn-ghost btn-sm" onClick={onView}>View items</button>
        <button className="btn btn-ghost btn-sm" onClick={onEdit}>Edit</button>
        {type.version > 1 && onHistory && (
          <button className="btn btn-ghost btn-sm" onClick={onHistory}>History</button>
        )}
        {!type.is_builtin && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--danger, #ef4444)' }}
            onClick={onDelete}
          >Delete</button>
        )}
      </div>
    </div>
  )
}
