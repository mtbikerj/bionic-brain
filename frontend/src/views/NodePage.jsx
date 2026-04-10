import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { getNode, getNodeBody, setNodeBody, getNodeRelationships, deleteNode, updateNode, getType,
         routeTask, runAgent, getLatestRun, getAgents, getTypes, getNodes, createEdge } from '../api'
import NodeCreatePanel from '../components/common/NodeCreatePanel'
import AgentRunPanel from '../components/agents/AgentRunPanel'
import { useAppStore } from '../stores/appStore'
import './NodePage.css'
import '../components/common/NodeCreatePanel.css'

const TYPE_ICONS = {
  TASK: '✅', NOTE: '📄', PERSON: '👤', FILE: '📎', URL: '🌐',
  LOCATION: '📍', COIN: '🪙', AGENT_RUN: '🤖', INBOX_ITEM: '📥',
  default: '⬡',
}

export default function NodePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isNew = id === 'new'

  const [node, setNode] = useState(null)
  const [typeDef, setTypeDef] = useState(null)
  const [body, setBody] = useState(null)
  const [rels, setRels] = useState({ outgoing: [], incoming: [] })
  const [loading, setLoading] = useState(!isNew)
  const [editMode, setEditMode] = useState(true)
  const [editLabel, setEditLabel] = useState('')
  const [editType, setEditType] = useState('')
  const [editProps, setEditProps] = useState({})
  const [editLabels, setEditLabels] = useState([])
  const [allTypes, setAllTypes] = useState([])
  const [bodyText, setBodyText] = useState('')
  const [bodyEditing, setBodyEditing] = useState(false)
  const [nodesByType, setNodesByType] = useState({})
  const [addingEdge, setAddingEdge] = useState(null) // { edgeType, direction } — edgeType is from typeDef.edge_types
  // Agent state
  const [agentRun, setAgentRun] = useState(null)
  const [routing, setRouting] = useState(null)     // { agent, confidence, reason }
  const [agentLoading, setAgentLoading] = useState(false)
  const [availableAgents, setAvailableAgents] = useState([])

  const { setActiveNodeId } = useAppStore()

  const load = async () => {
    if (isNew) return
    setLoading(true)
    try {
      const [n, b, r] = await Promise.all([
        getNode(id),
        getNodeBody(id),
        getNodeRelationships(id),
      ])
      setNode(n)
      setActiveNodeId(n.id)
      setEditLabel(n.label)
      setEditType(n.type)
      setEditProps(n.properties || {})
      setEditLabels(n.labels || [])
      getTypes().then((types) => setAllTypes(types.map((t) => t.name).sort())).catch(() => {})
      setBody(b?.content)
      setBodyText(b?.content?.text || extractText(b?.content))
      setRels(r)
      const td = await getType(n.type).catch(() => null)
      setTypeDef(td)
      if (['TASK', 'NOTE', 'INBOX_ITEM'].includes(n.type) ||
          ['in_progress_agent','needs_you','needs_review','agent_complete','failed'].includes(n.status)) {
        const [run, agents] = await Promise.all([
          getLatestRun(n.id).catch(() => null),
          getAgents(n.type).catch(() => []),
        ])
        setAgentRun(run)
        setAvailableAgents(agents)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  // Fetch nodes for relationship fields so pickers and display work
  const relationshipTargetTypes = useMemo(() => {
    const seen = new Set()
    typeDef?.fields?.forEach((f) => { if (f.type === 'relationship' && f.target_type) seen.add(f.target_type) })
    typeDef?.edge_types?.forEach((e) => { if (e.target_type) seen.add(e.target_type) })
    return [...seen]
  }, [typeDef])

  useEffect(() => {
    relationshipTargetTypes.forEach((type) => {
      getNodes({ type, limit: 200 }).then((ns) =>
        setNodesByType((prev) => ({ ...prev, [type]: ns }))
      ).catch(() => {})
    })
  }, [relationshipTargetTypes.join(',')])

  // Load candidates for inverse edge types (e.g. Company needs PERSON candidates for "employs")
  const inverseSourceTypes = useMemo(() => {
    return [...new Set((rels.inverse_edge_types || []).map((iet) => iet.source_type).filter(Boolean))]
  }, [rels.inverse_edge_types])

  useEffect(() => {
    inverseSourceTypes.forEach((type) => {
      getNodes({ type, limit: 200 }).then((ns) =>
        setNodesByType((prev) => ({ ...prev, [type]: ns }))
      ).catch(() => {})
    })
  }, [inverseSourceTypes.join(',')])

  if (isNew) {
    const defaultType  = searchParams.get('type')  || undefined
    const defaultLabel = searchParams.get('label') || undefined
    return (
      <div className="node-page">
        <NodeCreatePanel
          defaultType={defaultType}
          defaultLabel={defaultLabel}
          onCreated={(node) => navigate(`/nodes/${node.id}`)}
        />
      </div>
    )
  }

  if (loading) return <div className="node-page-loading"><div className="spinner" /></div>
  if (!node) return <div className="node-page"><div style={{ padding: 32 }}>Node not found.</div></div>

  const icon = TYPE_ICONS[node.type] || TYPE_ICONS.default

  const handleSave = async () => {
    const updates = {}
    if (editLabel.trim() !== node.label) updates.label = editLabel.trim()
    if (editType !== node.type) updates.type = editType
    updates.properties = editProps
    updates.labels = editLabels
    const updated = await updateNode(id, updates)
    setNode(updated)
    setEditType(updated.type)
    setEditLabels(updated.labels || [])
    setEditMode(false)
    // Reload type def if type changed
    if (updates.type) {
      getType(updated.type).then(setTypeDef).catch(() => setTypeDef(null))
    }
  }

  const handleCancelEdit = () => {
    setEditLabel(node.label)
    setEditType(node.type)
    setEditProps(node.properties || {})
    setEditLabels(node.labels || [])
    setEditMode(false)
  }

  const handleUpgradeVersion = async () => {
    const updated = await updateNode(id, { type_version: typeDef.version })
    setNode(updated)
  }

  const handleSaveBody = async () => {
    const content = { type: 'doc', text: bodyText, version: 1 }
    await setNodeBody(id, content)
    setBody(content)
    setBodyEditing(false)
    setNode((n) => ({ ...n, has_body: true }))
  }

  const handleDelete = async () => {
    if (!confirm(`Delete "${node.label}"? This cannot be undone.`)) return
    await deleteNode(id)
    navigate(-1)
  }

  const handleRouteTask = async () => {
    setAgentLoading(true)
    setRouting(null)
    try {
      const suggestion = await routeTask(id)
      setRouting(suggestion)
    } catch (e) {
      setRouting({ agent: null, confidence: 0, reason: e.message })
    } finally {
      setAgentLoading(false)
    }
  }

  const handleRunAgent = async (agentName) => {
    setAgentLoading(true)
    setRouting(null)
    try {
      // Optimistically show running state
      setAgentRun({ status: 'running', agent_name: agentName })
      const result = await runAgent(id, agentName)
      setAgentRun(result)
      // Refresh node to pick up status change
      const updated = await getNode(id)
      setNode(updated)
    } catch (e) {
      setAgentRun({ status: 'failed', agent_name: agentName, error_message: e.message })
    } finally {
      setAgentLoading(false)
    }
  }

  const allRels = [
    ...rels.outgoing.map((r) => ({ ...r, direction: 'out', otherId: r.target_id, otherLabel: r.target_label, otherType: r.target_type, displayType: r.rel_type })),
    ...rels.incoming.map((r) => ({ ...r, direction: 'in', otherId: r.source_id, otherLabel: r.source_label, otherType: r.source_type, displayType: r.rel_label || r.rel_type })),
  ].filter((r) => !['LINKED_TO', 'BELONGS_TO'].includes(r.rel_type))

  // Fields to display: use type def order if available, else fall back to raw props
  const typeFields = typeDef?.fields?.filter((f) => !['title', 'name', 'label'].includes(f.name)) || []
  const typeFieldNames = new Set(typeFields.map((f) => f.name))
  const extraProps = Object.entries(node.properties || {}).filter(
    ([k]) => !typeFieldNames.has(k) && !['captured_at'].includes(k)
  )

  return (
    <div className="node-page">
      <div className="node-page-header">
        <div className="node-page-type">
          <span className="node-page-icon">{editMode ? (TYPE_ICONS[editType] || TYPE_ICONS.default) : icon}</span>
          {editMode ? (
            <select
              value={editType}
              onChange={(e) => setEditType(e.target.value)}
              style={{ fontWeight: 600, fontSize: 13 }}
            >
              {allTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          ) : (
            <span className="node-page-type-name">{node.type}</span>
          )}
          {!editMode && <span className="node-page-version">v{node.type_version}</span>}
        </div>
        <div className="node-page-actions">
          {editMode ? (
            <>
              <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
              <button className="btn btn-ghost btn-sm" onClick={handleCancelEdit}>Cancel</button>
            </>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setEditMode(true)}>Edit</button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>Graph</button>
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>Delete</button>
        </div>
      </div>

      {/* Title */}
      <div className="node-page-title-row">
        {editMode ? (
          <input
            autoFocus
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
            style={{ fontSize: 20, fontWeight: 600, width: '100%' }}
          />
        ) : (
          <h1 className="node-page-label">{node.label}</h1>
        )}
      </div>

      {/* Version mismatch warning */}
      {!editMode && typeDef && node.type_version < typeDef.version && (
        <div className="version-mismatch-banner">
          <span>
            This item uses an older schema (v{node.type_version} → v{typeDef.version}).
            Some fields may be missing.
          </span>
          <button className="btn btn-sm" style={{ background: 'rgba(0,0,0,0.15)', color: 'inherit' }} onClick={handleUpgradeVersion}>
            Upgrade
          </button>
        </div>
      )}

      {/* Labels */}
      {(editMode || (node.labels && node.labels.length > 0)) && (
        <div style={{ marginBottom: 20 }}>
          {editMode ? (
            <LabelEditor labels={editLabels} onChange={setEditLabels} navigate={navigate} />
          ) : (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {node.labels.map((l) => (
                <span key={l} className="label-chip">{l}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Type-defined fields */}
      {(typeFields.length > 0 || extraProps.length > 0) && (
        <section className="node-section">
          <div className="section-title">Properties</div>
          {editMode ? (
            <div className="create-form" style={{ gap: 12 }}>
              {typeFields.map((field) => (
                <DynamicField
                  key={field.name}
                  field={field}
                  value={editProps[field.name]}
                  onChange={(v) => setEditProps((p) => ({ ...p, [field.name]: v }))}
                  nodesByType={nodesByType}
                />
              ))}
            </div>
          ) : (
            <div className="node-props-grid">
              {typeFields.map((field) => {
                const val = node.properties?.[field.name]
                if (val == null || val === '') return null
                return (
                  <div key={field.name} className="node-prop">
                    <span className="node-prop-key">{field.name.replace(/_/g, ' ')}</span>
                    <span className="node-prop-val"><FieldValue field={field} value={val} /></span>
                  </div>
                )
              })}
              {extraProps.map(([k, v]) => (
                <div key={k} className="node-prop">
                  <span className="node-prop-key">{k.replace(/_/g, ' ')}</span>
                  <span className="node-prop-val">{String(v ?? '')}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Relationships */}
      <section className="node-section">
        <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Relationships</span>
          {(typeDef?.edge_types?.length > 0 || rels.inverse_edge_types?.length > 0) && !addingEdge && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {typeDef?.edge_types?.map((et) => (
                <button
                  key={`out-${et.name}`}
                  className="btn btn-ghost btn-sm"
                  onClick={() => setAddingEdge({ edgeType: et, direction: 'out' })}
                  title={`Add: this ${node.type} ${et.name} →`}
                >
                  + {et.name}
                </button>
              ))}
              {typeDef?.edge_types?.filter((et) => et.inverse).map((et) => (
                <button
                  key={`in-${et.name}`}
                  className="btn btn-ghost btn-sm"
                  onClick={() => setAddingEdge({ edgeType: et, direction: 'in' })}
                  title={`Add: other ${et.target_type || 'item'} ${et.name} this`}
                >
                  + ← {et.inverse}
                </button>
              ))}
              {rels.inverse_edge_types?.map((iet) => (
                <button
                  key={`iev-${iet.source_type}-${iet.edge_name}`}
                  className="btn btn-ghost btn-sm"
                  onClick={() => setAddingEdge({
                    edgeType: { name: iet.edge_name, target_type: iet.source_type, inverse: iet.inverse_label },
                    direction: 'in',
                  })}
                  title={`Add: ${iet.source_type} ${iet.edge_name} this`}
                >
                  + ← {iet.inverse_label}
                </button>
              ))}
            </div>
          )}
        </div>

        {addingEdge && (
          <AddConnectionPanel
            node={node}
            edgeType={addingEdge.edgeType}
            direction={addingEdge.direction}
            candidates={nodesByType[addingEdge.edgeType.target_type] || []}
            onConfirm={async (otherId) => {
              const [srcId, tgtId] = addingEdge.direction === 'out' ? [node.id, otherId] : [otherId, node.id]
              await createEdge({ from_id: srcId, to_id: tgtId, type: addingEdge.edgeType.name })
              setAddingEdge(null)
              load()
            }}
            onCancel={() => setAddingEdge(null)}
          />
        )}

        {allRels.length === 0 && !addingEdge ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No relationships yet.</div>
        ) : (
          <div className="node-rels">
            {allRels.map((r, i) => (
              <div key={i} className="chip" onClick={() => navigate(`/nodes/${r.otherId}`)}>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {r.direction === 'out' ? '→' : '←'} {r.displayType}
                </span>
                <span>{r.otherLabel || r.otherId}</span>
                {r.otherType && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{r.otherType}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Agent section — shown for actionable node types */}
      {availableAgents.length > 0 && (
        <section className="node-section">
          <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Agent</span>
            {!agentRun && !routing && !agentLoading && (
              <button className="btn btn-ghost btn-sm" onClick={handleRouteTask}>
                Route task
              </button>
            )}
          </div>

          {agentLoading && !agentRun && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13 }}>
              <div className="spinner" /> Analyzing…
            </div>
          )}

          {routing && !agentRun && (
            <div className="routing-suggestion">
              {routing.agent ? (
                <>
                  <div className="routing-suggestion-text">
                    <strong>Suggested:</strong> {routing.agent} ({Math.round(routing.confidence * 100)}% confident)
                    <br /><span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{routing.reason}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleRunAgent(routing.agent)}
                      disabled={agentLoading}
                    >
                      Run {routing.agent}
                    </button>
                    {availableAgents
                      .filter((a) => a.name !== routing.agent)
                      .map((a) => (
                        <button
                          key={a.name}
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleRunAgent(a.name)}
                          disabled={agentLoading}
                        >
                          {a.name}
                        </button>
                      ))}
                    <button className="btn btn-ghost btn-sm" onClick={() => setRouting(null)}>
                      Dismiss
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  {routing.reason || 'No agent suggested for this task.'}
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {availableAgents.map((a) => (
                      <button
                        key={a.name}
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleRunAgent(a.name)}
                        disabled={agentLoading}
                      >
                        {a.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {!routing && (
            <>
              {agentRun ? (
                <AgentRunPanel
                  run={agentRun}
                  taskId={id}
                  onDone={() => { load() }}
                  onUpdated={(updated) => { setAgentRun(updated); getNode(id).then(setNode) }}
                />
              ) : (
                !agentLoading && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {availableAgents.map((a) => (
                      <button
                        key={a.name}
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleRunAgent(a.name)}
                        title={a.description}
                      >
                        {a.icon || '⚙'} {a.name}
                      </button>
                    ))}
                  </div>
                )
              )}
            </>
          )}
        </section>
      )}

      {/* Body */}
      <section className="node-section">
        <div className="section-title">Notes</div>
        {bodyEditing ? (
          <div className="node-body-edit">
            <textarea
              rows={8}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Write notes here..."
              autoFocus
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setBodyEditing(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleSaveBody}>Save</button>
            </div>
          </div>
        ) : body ? (
          <div className="node-body-display" style={{ cursor: 'text' }} onClick={() => setBodyEditing(true)}>{bodyText || extractText(body)}</div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, cursor: 'text' }} onClick={() => setBodyEditing(true)}>No notes. Click to add.</div>
        )}
      </section>

      {/* Activity */}
      <section className="node-section">
        <div className="section-title">Activity</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          <div>Created {node.created_at ? new Date(node.created_at).toLocaleString() : '—'}</div>
          <div>Updated {node.updated_at ? new Date(node.updated_at).toLocaleString() : '—'}</div>
          <div>By {node.created_by || 'user'}</div>
        </div>
      </section>
    </div>
  )
}

// Display-only formatting by field type
function FieldValue({ field, value }) {
  if (value == null || value === '') return null
  if (field.type === 'boolean') return <>{value ? 'Yes' : 'No'}</>
  if (field.type === 'currency') return <>${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
  if (field.type === 'date') return <>{value}</>
  if (field.type === 'choice_multi' && Array.isArray(value)) return <>{value.join(', ')}</>
  if (field.type === 'relationship') return <RelationshipDisplay nodeId={value} />
  return <>{String(value)}</>
}

function RelationshipDisplay({ nodeId }) {
  const [label, setLabel] = useState(null)
  useEffect(() => {
    if (!nodeId) return
    getNode(nodeId).then((n) => setLabel(n.label)).catch(() => {})
  }, [nodeId])
  if (!nodeId) return null
  return <Link to={`/nodes/${nodeId}`} style={{ color: 'var(--accent)' }}>{label ?? nodeId}</Link>
}

// Edit controls — shared with NodeCreatePanel pattern
function DynamicField({ field, value, onChange, nodesByType = {} }) {
  const label = field.name.charAt(0).toUpperCase() + field.name.slice(1).replace(/_/g, ' ')

  if (field.type === 'relationship') {
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

  if (field.type === 'boolean') {
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
  if (field.type === 'choice_single' && field.options) {
    return (
      <div className="form-row">
        <label>{label}</label>
        <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">— select —</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    )
  }
  if (field.type === 'choice_multi' && field.options) {
    const selected = Array.isArray(value) ? value : []
    return (
      <div className="form-row">
        <label>{label}</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {field.options.map((o) => (
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
  if (field.type === 'date') {
    return (
      <div className="form-row">
        <label>{label}</label>
        <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} />
      </div>
    )
  }
  if (field.type === 'number' || field.type === 'currency') {
    return (
      <div className="form-row">
        <label>{label}{field.type === 'currency' ? ' ($)' : ''}</label>
        <input type="number" value={value || ''} onChange={(e) => onChange(parseFloat(e.target.value) || '')} step="any" />
      </div>
    )
  }
  if (field.type === 'long_text') {
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

function LabelEditor({ labels, onChange, navigate }) {
  const [input, setInput] = useState('')
  const [suggestion, setSuggestion] = useState(null) // { label, count }

  const checkLabelFrequency = async (addedLabel) => {
    try {
      const { getLabels, getTypes } = await import('../api')
      const [labelData, types] = await Promise.all([getLabels(), getTypes()])
      const entry = labelData.find((e) => e.label === addedLabel)
      if (!entry || entry.count < 10) return
      const typeNames = new Set(types.map((t) => t.name.toLowerCase()))
      if (typeNames.has(addedLabel.toLowerCase())) return // type already exists
      setSuggestion({ label: addedLabel, count: entry.count })
    } catch {
      // fail silently
    }
  }

  const add = () => {
    const l = input.trim().toLowerCase()
    if (l && !labels.includes(l)) {
      onChange([...labels, l])
      checkLabelFrequency(l)
    }
    setInput('')
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: labels.length > 0 ? 6 : 0 }}>
        {labels.map((l) => (
          <span key={l} className="label-chip label-chip-edit">
            {l}
            <button
              type="button"
              onClick={() => { onChange(labels.filter((x) => x !== l)); if (suggestion?.label === l) setSuggestion(null) }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0 4px', fontSize: 11, lineHeight: 1 }}
            >×</button>
          </span>
        ))}
      </div>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        placeholder="Add label… (Enter to add)"
        style={{ fontSize: 12, padding: '4px 8px' }}
      />
      {suggestion && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
          fontSize: 12, color: 'var(--accent)',
        }}>
          <span>💡 "{suggestion.label}" is used {suggestion.count}+ times — create a category?</span>
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            onClick={() => navigate(`/types/new?suggest=${encodeURIComponent(suggestion.label)}`)}
          >
            Create category
          </button>
          <button
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11 }}
            onClick={() => setSuggestion(null)}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

function AddConnectionPanel({ node, edgeType, direction, candidates, onConfirm, onCancel }) {
  const [selectedId, setSelectedId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const label = direction === 'out'
    ? `${node.label} → ${edgeType.name} → …`
    : `… → ${edgeType.name} → ${node.label}`

  const handleConfirm = async () => {
    if (!selectedId) return
    setSaving(true)
    setError(null)
    try {
      await onConfirm(selectedId)
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: 10,
    }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{ flex: 1, minWidth: 160 }}
          autoFocus
        >
          <option value="">— select {edgeType.target_type || 'item'} —</option>
          {candidates.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
        </select>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleConfirm}
          disabled={!selectedId || saving}
        >
          {saving ? <span className="spinner" /> : 'Add'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6 }}>{error}</div>}
    </div>
  )
}

function extractText(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (content.text) return content.text
  return ''
}
