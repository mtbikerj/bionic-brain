import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getNodes, getType } from '../api'
import NodeCard from '../components/nodes/NodeCard'
import NodeCreatePanel from '../components/common/NodeCreatePanel'
import TypeEditPanel from '../components/types/TypeEditPanel'
import './View.css'

export default function TypeListView() {
  const { name } = useParams()
  const navigate = useNavigate()
  const [typeDef, setTypeDef] = useState(null)
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [td, ns] = await Promise.all([
        getType(name).catch(() => null),
        getNodes({ type: name, limit: 200 }),
      ])
      setTypeDef(td)
      setNodes(ns)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [name])

  if (creating) {
    return (
      <div style={{ padding: 28, maxWidth: 600, margin: '0 auto' }}>
        <NodeCreatePanel
          defaultType={name}
          onCreated={() => { setCreating(false); load() }}
          onCancel={() => setCreating(false)}
        />
      </div>
    )
  }

  if (editing && typeDef) {
    return (
      <div style={{ padding: 28, maxWidth: 680, margin: '0 auto' }}>
        <TypeEditPanel
          typeDef={typeDef}
          onSaved={() => { setEditing(false); load() }}
          onCancel={() => setEditing(false)}
        />
      </div>
    )
  }

  return (
    <div className="view">
      <div className="view-header">
        <h1 className="view-title">
          {name.charAt(0) + name.slice(1).toLowerCase().replace(/_/g, ' ')}
          {typeDef && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 14, marginLeft: 10 }}>{nodes.length}</span>}
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {typeDef && (
            <button className="btn btn-ghost" onClick={() => setEditing(true)}>Edit type</button>
          )}
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            + New {name.charAt(0) + name.slice(1).toLowerCase()}
          </button>
        </div>
      </div>
      <div className="view-content">
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <div className="spinner" />
          </div>
        ) : nodes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">⬡</div>
            <p>No {name.toLowerCase()} items yet.</p>
          </div>
        ) : (
          <div className="node-list">
            {nodes.map((n) => <NodeCard key={n.id} node={n} />)}
          </div>
        )}
      </div>
    </div>
  )
}
