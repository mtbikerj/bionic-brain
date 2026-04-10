import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { suggestType, createType, getTypes } from '../api'
import './TypeCreateView.css'

const FIELD_TYPES = [
  'short_text', 'long_text', 'number', 'currency', 'date', 'datetime',
  'boolean', 'choice_single', 'choice_multi', 'relationship', 'file', 'url',
]

function typeLabel(name) {
  return name.charAt(0) + name.slice(1).toLowerCase().replace(/_/g, ' ')
}

export default function TypeCreateView() {
  const [searchParams] = useSearchParams()
  const suggestLabel = searchParams.get('suggest')

  const [messages, setMessages] = useState([
    { role: 'assistant', content: "What would you like to track? Describe it in plain English — for example, \"I want to track my coin collection\" or \"I need to manage client projects using PARA\"." }
  ])
  const [suggestions, setSuggestions] = useState([])
  const [availableTypes, setAvailableTypes] = useState([])
  const [input, setInput] = useState(suggestLabel ? `I want to create a category for "${suggestLabel}"` : '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    getTypes().then(setAvailableTypes).catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async (text) => {
    if (!text.trim() || loading) return
    setInput('')
    setError(null)

    const userMsg = { role: 'user', content: text.trim() }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setLoading(true)

    try {
      const apiConversation = nextMessages.filter((m, i) => i > 0 || m.role === 'user')
      const res = await suggestType(apiConversation)
      setMessages((prev) => [...prev, { role: 'assistant', content: res.message }])

      if (res.suggestions && res.suggestions.length > 0) {
        setSuggestions((prev) => {
          const createdNames = new Set(prev.filter(s => s.status === 'created').map(s => s.name))
          const newItems = res.suggestions
            .filter(s => !createdNames.has(s.name))
            .map((s, i) => ({
              ...s,
              edgeTypes: (s.edge_types || []).map(e => ({
                name: e.name || '',
                inverse: e.inverse || '',
                target_type: e.target_type || '',
              })),
              extendsVal: '',
              status: 'pending',
              expanded: i === 0,
              errorMsg: null,
            }))
          return [...prev.filter(s => s.status === 'created'), ...newItems]
        })
      }
    } catch (err) {
      setError(err.message)
      setMessages((prev) => prev.slice(0, -1))
    } finally {
      setLoading(false)
    }
  }

  const updateSuggestion = (name, patch) => {
    setSuggestions(prev => prev.map(s => s.name === name ? { ...s, ...patch } : s))
  }

  const handleCreate = async (suggName) => {
    const sugg = suggestions.find(s => s.name === suggName)
    if (!sugg || sugg.status !== 'pending') return
    updateSuggestion(suggName, { status: 'creating', errorMsg: null })
    try {
      await createType({
        name: sugg.name,
        fields: sugg.fields,
        color: sugg.color,
        icon: 'node',
        extends: sugg.extendsVal || null,
        edge_types: sugg.edgeTypes
          .map(e => ({
            name: e.name.trim().toUpperCase().replace(/\s+/g, '_'),
            inverse: e.inverse?.trim() || null,
            target_type: e.target_type?.trim().toUpperCase() || null,
            properties: [],
          }))
          .filter(e => e.name),
      })
      updateSuggestion(suggName, { status: 'created' })
      getTypes().then(setAvailableTypes).catch(() => {})
    } catch (err) {
      updateSuggestion(suggName, { status: 'pending', errorMsg: err.message })
    }
  }

  const handleCreateAll = async () => {
    for (const sugg of suggestions.filter(s => s.status === 'pending')) {
      await handleCreate(sugg.name)
    }
  }

  const pendingCount = suggestions.filter(s => s.status === 'pending').length
  const allCreated = suggestions.length > 0 && suggestions.every(s => s.status === 'created')

  return (
    <div className="type-create-layout">
      <div className="type-create-chat">
        <div className="type-create-header">
          <h2>New Type</h2>
        </div>

        <div className="chat-messages">
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg chat-msg-${m.role}`}>
              {m.role === 'assistant' && <span className="chat-avatar">🧠</span>}
              <div className="chat-bubble">{m.content}</div>
            </div>
          ))}
          {loading && (
            <div className="chat-msg chat-msg-assistant">
              <span className="chat-avatar">🧠</span>
              <div className="chat-bubble chat-thinking">
                <span className="dot" /><span className="dot" /><span className="dot" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {error && <div className="form-error" style={{ margin: '0 16px 8px' }}>{error}</div>}

        <div className="chat-input-row">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send(input)}
            placeholder={suggestions.length > 0 ? 'Refine or ask for more types...' : 'Describe what you want to track...'}
            disabled={loading}
            autoFocus
          />
          <button className="btn btn-primary" onClick={() => send(input)} disabled={loading || !input.trim()}>
            Send
          </button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <div className="type-suggestions-section">
          <div className="suggestions-bar">
            <span className="suggestions-bar-title">
              {suggestions.length} type{suggestions.length !== 1 ? 's' : ''} suggested
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              {pendingCount > 1 && (
                <button className="btn btn-primary btn-sm" onClick={handleCreateAll}>
                  Create all ({pendingCount})
                </button>
              )}
              {allCreated && (
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/types')}>
                  View types →
                </button>
              )}
            </div>
          </div>

          <div className="suggestions-list">
            {suggestions.map(sugg => (
              <SuggestionCard
                key={sugg.name}
                sugg={sugg}
                availableTypes={availableTypes}
                onToggle={() => updateSuggestion(sugg.name, { expanded: !sugg.expanded })}
                onFieldChange={(i, k, v) => updateSuggestion(sugg.name, {
                  fields: sugg.fields.map((f, idx) => idx === i ? { ...f, [k]: v } : f)
                })}
                onRemoveField={i => updateSuggestion(sugg.name, {
                  fields: sugg.fields.filter((_, idx) => idx !== i)
                })}
                onAddField={() => updateSuggestion(sugg.name, {
                  fields: [...sugg.fields, { name: '', type: 'short_text', required: false }]
                })}
                onEdgeTypeChange={(i, k, v) => updateSuggestion(sugg.name, {
                  edgeTypes: sugg.edgeTypes.map((e, idx) => idx === i ? { ...e, [k]: v } : e)
                })}
                onRemoveEdgeType={i => updateSuggestion(sugg.name, {
                  edgeTypes: sugg.edgeTypes.filter((_, idx) => idx !== i)
                })}
                onAddEdgeType={() => updateSuggestion(sugg.name, {
                  edgeTypes: [...sugg.edgeTypes, { name: '', inverse: '', target_type: '' }]
                })}
                onColorChange={color => updateSuggestion(sugg.name, { color })}
                onExtendsChange={val => updateSuggestion(sugg.name, { extendsVal: val })}
                onCreate={() => handleCreate(sugg.name)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function SuggestionCard({ sugg, availableTypes, onToggle, onFieldChange, onRemoveField, onAddField, onEdgeTypeChange, onRemoveEdgeType, onAddEdgeType, onColorChange, onExtendsChange, onCreate }) {
  const name = typeLabel(sugg.name)
  const isCreated = sugg.status === 'created'
  const isCreating = sugg.status === 'creating'

  return (
    <div className={`sugg-card${isCreated ? ' sugg-card-done' : ''}`}>
      <div className="sugg-card-row" onClick={onToggle}>
        <span className="sugg-card-dot" style={{ background: sugg.color }} />
        <span className="sugg-card-name">{name}</span>
        <span className="sugg-card-meta">{sugg.fields.length} fields</span>
        {isCreated ? (
          <span className="sugg-card-created-badge">✓ Created</span>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            onClick={e => { e.stopPropagation(); onCreate() }}
            disabled={isCreating}
          >
            {isCreating ? <span className="spinner" /> : 'Create'}
          </button>
        )}
        <span className="sugg-card-chevron">{sugg.expanded && !isCreated ? '▲' : '▼'}</span>
      </div>

      {sugg.errorMsg && (
        <div className="form-error" style={{ margin: '0 12px 8px', fontSize: 12 }}>{sugg.errorMsg}</div>
      )}

      {sugg.expanded && !isCreated && (
        <div className="sugg-card-body">
          <div className="sugg-card-controls">
            <input
              type="color"
              value={sugg.color}
              onChange={e => onColorChange(e.target.value)}
              style={{ width: 26, height: 26, padding: 0, border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0 }}
              title="Change color"
            />
            {availableTypes.filter(t => !t.extends).length > 0 && (
              <select
                value={sugg.extendsVal}
                onChange={e => onExtendsChange(e.target.value)}
                style={{ fontSize: 12, flex: 1 }}
              >
                <option value="">Extends — none</option>
                {availableTypes.filter(t => !t.extends).map(t => (
                  <option key={t.name} value={t.name}>{typeLabel(t.name)}</option>
                ))}
              </select>
            )}
          </div>

          <div className="suggestion-fields">
            {sugg.fields.map((f, i) => (
              <SuggestionFieldRow
                key={i}
                field={f}
                availableTypes={availableTypes}
                onChange={(k, v) => onFieldChange(i, k, v)}
                onRemove={() => onRemoveField(i)}
              />
            ))}
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 2 }} onClick={onAddField}>
              + Add field
            </button>
          </div>

          <div className="sugg-connections">
            <div className="sugg-connections-header">
              <span>Connections</span>
              <button className="btn btn-ghost btn-sm" onClick={onAddEdgeType}>+ Add</button>
            </div>
            {sugg.edgeTypes.map((et, i) => (
              <SuggestionEdgeTypeRow
                key={i}
                edgeType={et}
                typeName={name}
                availableTypes={availableTypes}
                onChange={(k, v) => onEdgeTypeChange(i, k, v)}
                onRemove={() => onRemoveEdgeType(i)}
              />
            ))}
            {sugg.edgeTypes.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No connections defined.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SuggestionFieldRow({ field, availableTypes = [], onChange, onRemove }) {
  const showOptions = ['choice_single', 'choice_multi'].includes(field.type)
  const showTargetType = field.type === 'relationship'
  return (
    <div className="suggestion-field-row">
      <input
        className="sf-name"
        value={field.name}
        onChange={e => onChange('name', e.target.value)}
        placeholder="field_name"
      />
      <select className="sf-type" value={field.type} onChange={e => onChange('type', e.target.value)}>
        {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      {showOptions && (
        <input
          className="sf-options"
          value={(field.options || []).join(', ')}
          onChange={e => onChange('options', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          placeholder="options..."
        />
      )}
      {showTargetType && (
        <select
          className="sf-options"
          value={field.target_type || ''}
          onChange={e => onChange('target_type', e.target.value)}
        >
          <option value="">— any type —</option>
          {availableTypes.map(t => (
            <option key={t.name} value={t.name}>
              {typeLabel(t.name)}
            </option>
          ))}
        </select>
      )}
      <label className="sf-req" title="Required">
        <input
          type="checkbox"
          checked={field.required || false}
          onChange={e => onChange('required', e.target.checked)}
          style={{ width: 'auto' }}
        />
        req
      </label>
      <button className="btn btn-ghost btn-sm sf-remove" onClick={onRemove} style={{ color: 'var(--danger, #ef4444)' }}>✕</button>
    </div>
  )
}

function SuggestionEdgeTypeRow({ edgeType, typeName, availableTypes, onChange, onRemove }) {
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 'var(--radius-sm)',
      padding: '8px 10px', border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>A</span>
      <span style={{ fontSize: 12, fontWeight: 500 }}>{typeName}</span>
      <input
        value={edgeType.name}
        onChange={e => onChange('name', e.target.value)}
        placeholder="e.g. is located at"
        style={{ width: 130, fontSize: 12 }}
      />
      <select
        value={edgeType.target_type || ''}
        onChange={e => onChange('target_type', e.target.value)}
        style={{ width: 120, fontSize: 12 }}
      >
        <option value="">any item type</option>
        {availableTypes.map(t => (
          <option key={t.name} value={t.name}>{typeLabel(t.name)}</option>
        ))}
      </select>
      <input
        value={edgeType.inverse || ''}
        onChange={e => onChange('inverse', e.target.value)}
        placeholder="reverse label (optional)"
        style={{ flex: 1, minWidth: 80, fontSize: 12 }}
      />
      <button className="btn btn-ghost btn-sm" onClick={onRemove} style={{ color: 'var(--danger, #ef4444)', marginLeft: 'auto' }}>
        ✕
      </button>
    </div>
  )
}
