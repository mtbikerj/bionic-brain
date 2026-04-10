import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { createNode, createEdge, getNodes, getTypes } from '../../api'
import { useAppStore } from '../../stores/appStore'
import './NodeCreatePanel.css'

const TASK_STATUSES = ['inbox', 'in_progress', 'blocked', 'done']
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent']

export default function NodeCreatePanel({ defaultType, defaultLabel, onCreated, onCancel }) {
  const [types, setTypes] = useState([])
  const [selectedType, setSelectedType] = useState(defaultType || 'NOTE')
  const [label, setLabel] = useState(defaultLabel || '')
  const [props, setProps] = useState({})
  const [connections, setConnections] = useState({})
  const [nodesByType, setNodesByType] = useState({})
  const [isInbox, setIsInbox] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const navigate = useNavigate()
  const triggerGraphReload = useAppStore((s) => s.triggerGraphReload)

  useEffect(() => {
    getTypes().then((ts) => {
      setTypes(ts)
      if (!defaultType && ts.length > 0) {
        const first = ts.find((t) => !['YEAR','MONTH','DAY','DATETIME','AGENT_RUN'].includes(t.name))
        if (first) setSelectedType(first.name)
      }
    })
  }, [defaultType])

  const typeDef = types.find((t) => t.name === selectedType)

  // Collect unique target types needed for pickers (relationship fields + edge_types)
  const targetTypes = useMemo(() => {
    const seen = new Set()
    typeDef?.fields?.forEach((f) => { if (f.type === 'relationship' && f.target_type) seen.add(f.target_type) })
    typeDef?.edge_types?.forEach((e) => { if (e.target_type) seen.add(e.target_type) })
    return [...seen]
  }, [typeDef])

  // Find edge types from OTHER types that point at selectedType (so inverse pickers show on creation)
  const inverseEdgeTypes = useMemo(() => {
    const results = []
    for (const t of types) {
      for (const et of (t.edge_types || [])) {
        if (et.target_type === selectedType && et.inverse) {
          results.push({ sourceType: t.name, edgeName: et.name, inverseLabel: et.inverse })
        }
      }
    }
    return results
  }, [types, selectedType])

  useEffect(() => {
    setConnections({})
    const allTypes = [...targetTypes, ...inverseEdgeTypes.map((iet) => iet.sourceType)]
    const unique = [...new Set(allTypes)]
    unique.forEach((type) => {
      getNodes({ type, limit: 200 }).then((ns) =>
        setNodesByType((prev) => ({ ...prev, [type]: ns }))
      ).catch(() => {})
    })
  }, [targetTypes.join(','), inverseEdgeTypes.map((iet) => iet.sourceType).join(',')])

  const setProp = (key, val) => setProps((p) => ({ ...p, [key]: val }))
  const setConnection = (key, val) => setConnections((c) => ({ ...c, [key]: val }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!label.trim()) return
    setLoading(true)
    setError(null)
    try {
      const node = await createNode({
        type: selectedType,
        label: label.trim(),
        properties: props,
        is_inbox: isInbox,
      })
      // Create outgoing edges (from this node to others, e.g. this Company EMPLOYS Person)
      for (const [edgeTypeName, targetId] of Object.entries(connections)) {
        if (targetId && !edgeTypeName.startsWith('__inv__')) {
          await createEdge({ from_id: node.id, to_id: targetId, type: edgeTypeName })
        }
      }
      // Create incoming edges (from others to this node, e.g. Company EMPLOYS this Person)
      for (const [key, sourceId] of Object.entries(connections)) {
        if (sourceId && key.startsWith('__inv__')) {
          const edgeName = key.slice(7) // strip '__inv__' prefix
          await createEdge({ from_id: sourceId, to_id: node.id, type: edgeName })
        }
      }
      triggerGraphReload()
      onCreated?.(node)
      navigate(`/nodes/${node.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="create-panel">
      <div className="create-panel-header">
        <h2>New {selectedType.charAt(0) + selectedType.slice(1).toLowerCase().replace(/_/g, ' ')}</h2>
        {onCancel && <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>}
      </div>

      <form onSubmit={handleSubmit} className="create-form">
        <div className="form-row">
          <label>Type</label>
          <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
            {types
              .filter((t) => !['YEAR','MONTH','DAY','DATETIME','AGENT_RUN','SCHEMA_VERSION'].includes(t.name))
              .map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
          </select>
        </div>

        <div className="form-row">
          <label>Title / Name *</label>
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={`Enter ${selectedType.toLowerCase()} name...`}
            required
          />
        </div>

        {/* Dynamic fields from type definition */}
        {typeDef?.fields?.filter((f) => !['title','name'].includes(f.name)).map((field) => (
          <DynamicField key={field.name} field={field} value={props[field.name]} onChange={(v) => setProp(field.name, v)} nodesByType={nodesByType} />
        ))}

        {/* Connections from edge_types (outgoing from this node) */}
        {typeDef?.edge_types?.filter((et) => et.target_type).map((et) => {
          const displayLabel = et.name.charAt(0).toUpperCase() + et.name.slice(1).toLowerCase().replace(/_/g, ' ')
          const candidates = nodesByType[et.target_type] || []
          return (
            <div key={et.name} className="form-row">
              <label>{displayLabel}</label>
              <select value={connections[et.name] || ''} onChange={(e) => setConnection(et.name, e.target.value)}>
                <option value="">— none —</option>
                {candidates.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
            </div>
          )
        })}

        {/* Inverse connections (this node is the target of another type's edge) */}
        {inverseEdgeTypes.map((iet) => {
          const key = `__inv__${iet.edgeName}`
          const displayLabel = iet.inverseLabel.charAt(0).toUpperCase() + iet.inverseLabel.slice(1).replace(/_/g, ' ')
          const candidates = nodesByType[iet.sourceType] || []
          return (
            <div key={key} className="form-row">
              <label>{displayLabel}</label>
              <select value={connections[key] || ''} onChange={(e) => setConnection(key, e.target.value)}>
                <option value="">— none —</option>
                {candidates.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
            </div>
          )
        })}

        <div className="form-row form-row-check">
          <label>
            <input
              type="checkbox"
              checked={isInbox}
              onChange={(e) => setIsInbox(e.target.checked)}
              style={{ width: 'auto', marginRight: 8 }}
            />
            Save to Inbox (classify later)
          </label>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="form-actions">
          {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
          <button type="submit" className="btn btn-primary" disabled={loading || !label.trim()}>
            {loading ? <span className="spinner" /> : `Create ${selectedType.charAt(0) + selectedType.slice(1).toLowerCase()}`}
          </button>
        </div>
      </form>
    </div>
  )
}

function DynamicField({ field, value, onChange, nodesByType = {} }) {
  const { name, type, options } = field
  const label = name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' ')

  if (type === 'relationship') {
    const candidates = nodesByType[field.target_type] || []
    return (
      <div className="form-row">
        <label>{label}</label>
        <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">— none —</option>
          {candidates.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
      </div>
    )
  }
  if (type === 'boolean') {
    return (
      <div className="form-row form-row-check">
        <label>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            style={{ width: 'auto', marginRight: 8 }}
          />
          {label}
        </label>
      </div>
    )
  }
  if (type === 'choice_single' && options) {
    return (
      <div className="form-row">
        <label>{label}</label>
        <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">— select —</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    )
  }
  if (type === 'choice_multi' && options) {
    const selected = Array.isArray(value) ? value : []
    return (
      <div className="form-row">
        <label>{label}</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {options.map((o) => (
            <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selected.includes(o)}
                onChange={(e) => {
                  const next = e.target.checked ? [...selected, o] : selected.filter((x) => x !== o)
                  onChange(next)
                }}
                style={{ width: 'auto' }}
              />
              {o}
            </label>
          ))}
        </div>
      </div>
    )
  }
  if (type === 'date') {
    return (
      <div className="form-row">
        <label>{label}</label>
        <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} />
      </div>
    )
  }
  if (type === 'number' || type === 'currency') {
    return (
      <div className="form-row">
        <label>{label}</label>
        <input type="number" value={value || ''} onChange={(e) => onChange(parseFloat(e.target.value) || '')} step="any" />
      </div>
    )
  }
  if (type === 'long_text') {
    return (
      <div className="form-row">
        <label>{label}</label>
        <textarea rows={3} value={value || ''} onChange={(e) => onChange(e.target.value)} />
      </div>
    )
  }
  return (
    <div className="form-row">
      <label>{label}</label>
      <input value={value || ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}
